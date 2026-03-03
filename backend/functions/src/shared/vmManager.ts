import { getAzureClients } from "./azureClients.js";
import { getMarketplaceImage } from "./catalog.js";
import { getConfig } from "./config.js";
import { generatePassword } from "./password.js";

type StartVmInput = {
  vmName?: string;
  ownerId: string;
  sourceMode: "marketplace" | "custom-image";
  imageId: string;
  osType: "linux" | "windows";
  vmSize?: string;
  allowedClientCidr?: string;
};

async function assertVmOwnership(vmName: string, ownerId: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await compute.virtualMachines.get(config.resourceGroup, vmName);
  const tags = vm.tags ?? {};

  if (tags.managedBy !== "orchestrator") {
    throw new Error("VM is not managed by orchestrator");
  }

  if (tags.ownerId !== ownerId) {
    throw new Error("VM does not belong to current user");
  }

  return vm;
}

function sanitizeVmName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function createLinuxCloudInit() {
  const content = `#cloud-config
package_update: true
packages:
  - xfce4
  - xfce4-goodies
  - xrdp
  - x11vnc
  - novnc
  - websockify
runcmd:
  - systemctl enable xrdp
  - systemctl start xrdp
  - mkdir -p /opt/novnc
  - if [ -d /usr/share/novnc ]; then ln -s /usr/share/novnc/* /opt/novnc/ || true; fi
`;

  return Buffer.from(content).toString("base64");
}

function nowPlusMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export async function startVm(input: StartVmInput) {
  const config = getConfig();
  const { compute, network } = getAzureClients(config.subscriptionId);

  const baseName = sanitizeVmName(
    input.vmName ?? `${input.osType}-${Date.now().toString().slice(-7)}`
  );

  const vmName = baseName.length > 0 ? baseName : `vm-${Date.now().toString().slice(-7)}`;
  const pipName = `pip-${vmName}`;
  const nicName = `nic-${vmName}`;

  const adminUsername = config.vmAdminUsername;
  const adminPassword = generatePassword();

  const imageReference =
    input.sourceMode === "marketplace"
      ? (() => {
          const image = getMarketplaceImage(input.imageId);
          if (!image) {
            throw new Error(`Unknown marketplace image id: ${input.imageId}`);
          }
          return {
            publisher: image.publisher,
            offer: image.offer,
            sku: image.sku,
            version: image.version
          };
        })()
      : undefined;

  const customImageId = input.sourceMode === "custom-image" ? input.imageId : undefined;

  const vmSize =
    input.vmSize ?? (input.osType === "windows" ? config.vmSizeWindows : config.vmSizeLinux);

  const expiresAt = nowPlusMinutes(config.vmLifetimeMin);

  const publicIp = await network.publicIPAddresses.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    pipName,
    {
      location: config.location,
      publicIPAllocationMethod: "Static",
      sku: { name: "Standard" },
      tags: {
        ownerId: input.ownerId,
        managedBy: "orchestrator",
        vmName
      }
    }
  );

  const nic = await network.networkInterfaces.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    nicName,
    {
      location: config.location,
      ipConfigurations: [
        {
          name: "ipconfig1",
          subnet: { id: config.subnetId },
          publicIPAddress: { id: publicIp.id },
          primary: true
        }
      ],
      tags: {
        ownerId: input.ownerId,
        managedBy: "orchestrator",
        vmName
      }
    }
  );

  await compute.virtualMachines.beginCreateOrUpdateAndWait(config.resourceGroup, vmName, {
    location: config.location,
    hardwareProfile: { vmSize: vmSize as never },
    storageProfile:
      input.sourceMode === "marketplace"
        ? {
            imageReference,
            osDisk: {
              createOption: "FromImage",
              deleteOption: "Delete"
            }
          }
        : {
            imageReference: { id: customImageId },
            osDisk: {
              createOption: "FromImage",
              deleteOption: "Delete"
            }
          },
    osProfile: {
      computerName: vmName,
      adminUsername,
      adminPassword,
      linuxConfiguration:
        input.osType === "linux"
          ? {
              disablePasswordAuthentication: false,
              provisionVMAgent: true
            }
          : undefined,
      windowsConfiguration:
        input.osType === "windows"
          ? {
              provisionVMAgent: true,
              enableAutomaticUpdates: true
            }
          : undefined,
      customData: input.osType === "linux" ? createLinuxCloudInit() : undefined
    },
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id,
          primary: true,
          deleteOption: "Delete"
        }
      ]
    },
    tags: {
      ownerId: input.ownerId,
      managedBy: "orchestrator",
      sourceMode: input.sourceMode,
      sourceImage: input.imageId,
      osType: input.osType,
      vmSize,
      vmState: "running",
      expiresAt,
      allowedClientCidr: input.allowedClientCidr ?? config.allowedClientCidr
    }
  });

  const finalIp = await network.publicIPAddresses.get(config.resourceGroup, pipName);

  return {
    vmName,
    ownerId: input.ownerId,
    adminUsername,
    adminPassword,
    publicIp: finalIp.ipAddress ?? "",
    expiresAt,
    remote: {
      ssh: `ssh ${adminUsername}@${finalIp.ipAddress}`,
      rdp: `${finalIp.ipAddress}:3389`,
      vnc: `${finalIp.ipAddress}:5901`,
      noVncUrl: `http://${finalIp.ipAddress}:6080/vnc.html?autoconnect=true&resize=scale`
    }
  };
}

export async function listVms(ownerId?: string) {
  const config = getConfig();
  const { compute, network } = getAzureClients(config.subscriptionId);

  const all: unknown[] = [];
  for await (const vm of compute.virtualMachines.list(config.resourceGroup)) {
    all.push(vm);
  }

  const filtered = all.filter((entry) => {
    const vm = entry as { tags?: Record<string, string> };
    if (!vm.tags?.managedBy || vm.tags.managedBy !== "orchestrator") {
      return false;
    }
    if (!ownerId) {
      return true;
    }
    return vm.tags.ownerId === ownerId;
  });

  const result = await Promise.all(
    filtered.map(async (entry) => {
      const vm = entry as {
        name?: string;
        location?: string;
        provisioningState?: string;
        tags?: Record<string, string>;
      };

      const pipName = `pip-${vm.name}`;
      let ipAddress = "";
      try {
        const pip = await network.publicIPAddresses.get(config.resourceGroup, pipName);
        ipAddress = pip.ipAddress ?? "";
      } catch {
        ipAddress = "";
      }

      return {
        name: vm.name,
        location: vm.location,
        provisioningState: vm.provisioningState,
        publicIp: ipAddress,
        tags: vm.tags ?? {}
      };
    })
  );

  return result;
}

export async function getVmStatus(vmName: string, ownerId: string) {
  const config = getConfig();
  const { compute, network } = getAzureClients(config.subscriptionId);

  await assertVmOwnership(vmName, ownerId);

  const vm = await compute.virtualMachines.get(config.resourceGroup, vmName, {
    expand: "instanceView"
  });

  const statuses = vm.instanceView?.statuses?.map((status) => status.displayStatus ?? status.code) ?? [];

  const pipName = `pip-${vmName}`;
  let ipAddress = "";
  try {
    const pip = await network.publicIPAddresses.get(config.resourceGroup, pipName);
    ipAddress = pip.ipAddress ?? "";
  } catch {
    ipAddress = "";
  }

  return {
    name: vmName,
    statuses,
    provisioningState: vm.provisioningState,
    publicIp: ipAddress,
    tags: vm.tags ?? {}
  };
}

export async function stopVm(vmName: string, ownerId: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await assertVmOwnership(vmName, ownerId);
  const tags = vm.tags ?? {};

  await compute.virtualMachines.beginPowerOffAndWait(config.resourceGroup, vmName);

  await compute.virtualMachines.beginUpdateAndWait(config.resourceGroup, vmName, {
    tags: {
      ...tags,
      vmState: "deallocated"
    }
  });

  return { ok: true, vmName, status: "stopped" };
}

export async function resumeVm(vmName: string, ownerId: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await assertVmOwnership(vmName, ownerId);
  const tags = vm.tags ?? {};

  await compute.virtualMachines.beginStartAndWait(config.resourceGroup, vmName);

  await compute.virtualMachines.beginUpdateAndWait(config.resourceGroup, vmName, {
    tags: {
      ...tags,
      vmState: "running"
    }
  });

  return { ok: true, vmName, status: "running" };
}

export async function extendVm(vmName: string, minutes: number, ownerId: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await assertVmOwnership(vmName, ownerId);
  const currentTags = vm.tags ?? {};
  const expiresAt = nowPlusMinutes(minutes);

  await compute.virtualMachines.beginUpdateAndWait(config.resourceGroup, vmName, {
    tags: {
      ...currentTags,
      expiresAt
    }
  });

  return { ok: true, vmName, expiresAt };
}

export async function deleteVm(vmName: string, ownerId?: string) {
  const config = getConfig();
  const { compute, network } = getAzureClients(config.subscriptionId);

  if (ownerId) {
    await assertVmOwnership(vmName, ownerId);
  }

  let osDiskName = "";
  try {
    const vm = await compute.virtualMachines.get(config.resourceGroup, vmName);
    osDiskName = vm.storageProfile?.osDisk?.name ?? "";
  } catch {
    osDiskName = "";
  }

  await compute.virtualMachines.beginDeleteAndWait(config.resourceGroup, vmName);

  const nicName = `nic-${vmName}`;
  const pipName = `pip-${vmName}`;

  try {
    await network.networkInterfaces.beginDeleteAndWait(config.resourceGroup, nicName);
  } catch {
    // ignore
  }

  try {
    await network.publicIPAddresses.beginDeleteAndWait(config.resourceGroup, pipName);
  } catch {
    // ignore
  }

  if (osDiskName) {
    try {
      await compute.disks.beginDeleteAndWait(config.resourceGroup, osDiskName);
    } catch {
      // ignore
    }
  }

  return { ok: true, vmName, deleted: true };
}

export async function listManagedImages() {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const images: unknown[] = [];
  for await (const image of compute.images.listByResourceGroup(config.resourceGroup)) {
    images.push(image);
  }

  return images.map((entry) => {
    const image = entry as {
      id?: string;
      name?: string;
      location?: string;
      tags?: Record<string, string>;
      hyperVGeneration?: string;
      provisioningState?: string;
    };

    return {
      id: image.id,
      name: image.name,
      location: image.location,
      hyperVGeneration: image.hyperVGeneration,
      provisioningState: image.provisioningState,
      tags: image.tags ?? {}
    };
  });
}

export async function createImageFromVm(vmName: string, imageName: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await compute.virtualMachines.get(config.resourceGroup, vmName);
  if (!vm.id) {
    throw new Error(`VM id not found for ${vmName}`);
  }

  const image = await compute.images.beginCreateOrUpdateAndWait(config.resourceGroup, imageName, {
    location: config.location,
    sourceVirtualMachine: {
      id: vm.id
    },
    tags: {
      managedBy: "orchestrator",
      sourceVm: vmName,
      createdAt: new Date().toISOString()
    }
  });

  return {
    id: image.id,
    name: image.name,
    location: image.location
  };
}

export async function cleanupExpiredVms() {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const candidates: string[] = [];
  for await (const vm of compute.virtualMachines.list(config.resourceGroup)) {
    if (!vm.name || !vm.tags) {
      continue;
    }

    if (vm.tags.managedBy !== "orchestrator") {
      continue;
    }

    const expiry = vm.tags.expiresAt;
    if (!expiry) {
      continue;
    }

    const expiresAtMs = Date.parse(expiry);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs < Date.now()) {
      candidates.push(vm.name);
    }
  }

  const deleted: string[] = [];
  for (const vmName of candidates) {
    await deleteVm(vmName);
    deleted.push(vmName);
  }

  return {
    scanned: candidates.length,
    deleted
  };
}
