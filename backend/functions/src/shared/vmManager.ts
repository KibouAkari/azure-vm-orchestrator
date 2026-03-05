import { getAzureClients } from "./azureClients.js";
import { getMarketplaceImage, marketplaceCatalog } from "./catalog.js";
import { getConfig } from "./config.js";
import { generatePassword } from "./password.js";
import net from "node:net";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import { randomUUID } from "node:crypto";

type StartVmInput = {
  vmName?: string;
  ownerId: string;
  sourceMode: "marketplace" | "custom-image";
  imageId: string;
  osType: "linux" | "windows";
  vmSize?: string;
  topicId?: string;
  adminUsername?: string;
  adminPassword?: string;
  allowedClientCidr?: string;
  skipPrewarmedPool?: boolean;
  skipGatewayRegistration?: boolean;
};

export type TopicImage = {
  id: string;
  label: string;
  osType: "linux" | "windows";
  sourceMode: "marketplace" | "custom-image";
  imageId: string;
  fixedUsername?: string;
  fixedPassword?: string;
};

export type TopicDefinition = {
  id: string;
  label: string;
  type: "azure" | "custom";
  allowCustomCredentials: boolean;
  images: TopicImage[];
};

type UploadInitResult = {
  uploadUrl: string;
  blobUrl: string;
  blobName: string;
  expiresAt: string;
};

const POOL_OWNER_ID = "__prewarmed_pool__";


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

function sanitizeUploadFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.bin";
}

function sanitizeAdminUsername(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);

  if (!normalized || /^[0-9]/.test(normalized)) {
    return "azureuser";
  }

  return normalized;
}

function hasPasswordComplexity(password: string, username: string) {
  if (password.length < 12 || password.length > 123) {
    return false;
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    return false;
  }

  const loweredPassword = password.toLowerCase();
  const loweredUsername = username.toLowerCase();
  if (loweredUsername && loweredPassword.includes(loweredUsername)) {
    return false;
  }

  return true;
}

function toCompliantPassword(password: string, username: string) {
  const trimmed = password.trim();
  if (hasPasswordComplexity(trimmed, username)) {
    return trimmed;
  }

  const seed = trimmed.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "labpass";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  const candidate = `Az!${seed}9Z@${suffix}`;

  if (hasPasswordComplexity(candidate, username)) {
    return candidate;
  }

  return `Az!LabPass9Z@${suffix}`;
}

function sanitizeTopicId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function sanitizeImageLabel(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9- ]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function sanitizeManagedImageName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || `img-${Date.now()}`;
}

function getStorageAccountFromBlobUrl(blobUrl: string) {
  try {
    const parsed = new URL(blobUrl);
    const host = parsed.hostname;
    const account = host.split(".")[0];
    return account || "";
  } catch {
    return "";
  }
}

async function getStorageSharedKeyCredential(storageAccountName: string) {
  const config = getConfig();
  const { subscriptionId } = config;
  const credential = new DefaultAzureCredential();

  const { StorageManagementClient } = await import("@azure/arm-storage");
  const storage = new StorageManagementClient(credential, subscriptionId);

  const account = await storage.storageAccounts.getProperties(config.resourceGroup, storageAccountName);
  if (!account.name) {
    throw new Error("Storage account not found.");
  }

  const keys = await storage.storageAccounts.listKeys(config.resourceGroup, storageAccountName);
  const keyValue = keys.keys?.[0]?.value;
  if (!keyValue) {
    throw new Error("Unable to retrieve storage account key.");
  }

  return new StorageSharedKeyCredential(storageAccountName, keyValue);
}

export async function prepareImageUpload(fileName: string, contentType?: string): Promise<UploadInitResult> {
  const config = getConfig();
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "vhd";
  const allowed = new Set(["vhd", "vhdx", "img"]);
  if (!allowed.has(extension)) {
    throw new Error("Only image files (.vhd, .vhdx, .img) are allowed.");
  }

  const safeName = sanitizeUploadFileName(fileName).replace(/\.[^.]+$/, "");
  const blobName = `${Date.now()}-${safeName}-${randomUUID().slice(0, 8)}.${extension}`;

  const accountName = config.imageStorageAccount;
  const containerName = config.imageStorageContainer;
  const sharedKey = await getStorageSharedKeyCredential(accountName);
  const expiresOn = new Date(Date.now() + 30 * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      expiresOn,
      permissions: BlobSASPermissions.parse("cw"),
      protocol: SASProtocol.Https,
      contentType: contentType || "application/octet-stream"
    },
    sharedKey
  );

  const blobUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;
  const uploadUrl = `${blobUrl}?${sas.toString()}`;

  return {
    uploadUrl,
    blobUrl,
    blobName,
    expiresAt: expiresOn.toISOString()
  };
}

export async function completeImageUpload(input: {
  blobUrl: string;
  imageName: string;
  imageLabel?: string;
  topicId: string;
  topicLabel?: string;
  username: string;
  password: string;
  osType: "linux" | "windows";
}) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const normalizedTopicId = sanitizeTopicId(input.topicId);
  if (!normalizedTopicId || normalizedTopicId === "azure") {
    throw new Error("Topic id is invalid or reserved.");
  }

  const storageAccount = getStorageAccountFromBlobUrl(input.blobUrl);
  if (storageAccount !== config.imageStorageAccount) {
    throw new Error("Blob URL must belong to the configured orchestrator image storage account.");
  }

  const managedImageName = sanitizeManagedImageName(input.imageName);
  const sanitizedUsername = sanitizeAdminUsername(input.username);
  const sanitizedLabel = sanitizeImageLabel(input.imageLabel ?? managedImageName) || managedImageName;

  const created = await compute.images.beginCreateOrUpdateAndWait(config.resourceGroup, managedImageName, {
    location: config.location,
    storageProfile: {
      osDisk: {
        osType: input.osType === "windows" ? "Windows" : "Linux",
        osState: "Generalized",
        blobUri: input.blobUrl,
        caching: "ReadWrite",
        storageAccountType: "Standard_LRS"
      }
    },
    tags: {
      managedBy: "orchestrator",
      orchTopic: normalizedTopicId,
      orchTopicLabel: (input.topicLabel?.trim() || titleCaseTopic(normalizedTopicId)).slice(0, 60),
      orchLabel: sanitizedLabel,
      orchOsType: input.osType,
      orchFixedUsername: sanitizedUsername,
      orchFixedPassword: input.password.trim(),
      orchSourceBlob: input.blobUrl,
      createdAt: new Date().toISOString()
    }
  });

  return {
    ok: true,
    imageName: created.name,
    imageId: created.id,
    topicId: normalizedTopicId
  };
}

function createLinuxCloudInit(adminUsername: string) {
  const content = `#cloud-config
packages:
  - xfce4-session
  - xfce4-panel
  - xfce4-settings
  - xfdesktop4
  - thunar
  - xfce4-terminal
  - dbus-x11
  - xorgxrdp
  - xrdp
write_files:
  - path: /etc/xrdp/startwm.sh
    permissions: "0755"
    content: |
      #!/bin/sh
      unset DBUS_SESSION_BUS_ADDRESS
      unset XDG_RUNTIME_DIR
      exec startxfce4

  - path: /etc/skel/.xsession
    permissions: "0644"
    content: |
      startxfce4
runcmd:
  - systemctl daemon-reload
  - adduser xrdp ssl-cert || true
  - install -m 0644 /etc/skel/.xsession /home/${adminUsername}/.xsession || true
  - chown ${adminUsername}:${adminUsername} /home/${adminUsername}/.xsession || true
  - systemctl enable xrdp
  - systemctl start xrdp
`;

  return Buffer.from(content).toString("base64");
}

function nowPlusMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function isTcpPortOpen(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function isHttpReady(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildViewerAutoLoginUrl(baseUrl: string, connectionName: string) {
  try {
    const tokenBody = new URLSearchParams({ username: "viewer", password: "viewer" });
    const tokenResponse = await fetch(`${baseUrl}api/tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: tokenBody.toString()
    });

    if (!tokenResponse.ok) {
      return undefined;
    }

    const tokenPayload = (await tokenResponse.json()) as {
      authToken?: string;
      dataSource?: string;
    };

    if (!tokenPayload.authToken || !tokenPayload.dataSource) {
      return undefined;
    }

    const connectionsResponse = await fetch(
      `${baseUrl}api/session/data/${tokenPayload.dataSource}/connections?token=${encodeURIComponent(tokenPayload.authToken)}`
    );

    if (!connectionsResponse.ok) {
      return undefined;
    }

    const connections = (await connectionsResponse.json()) as Record<string, unknown>;
    const connectionEntry = Object.entries(connections).find(([, value]) => {
      const candidate = value as { name?: string };
      return candidate.name === connectionName;
    });

    if (!connectionEntry) {
      return undefined;
    }

    const connectionId = connectionEntry[0];

    return `${baseUrl}#/client/${encodeURIComponent(`c/${connectionId}`)}?token=${encodeURIComponent(
      tokenPayload.authToken
    )}`;
  } catch {
    return undefined;
  }
}

function normalizeGatewayBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function registerGatewayConnection(
  vmName: string,
  osType: "linux" | "windows",
  privateIp: string,
  vmUsername: string,
  vmPassword: string
) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const protocol = "rdp";
  const safeVmName = sanitizeVmName(vmName);
  const gatewayUsername = osType === "windows" ? `.\\${vmUsername}` : vmUsername;
  const encoded = {
    name: Buffer.from(safeVmName, "utf8").toString("base64"),
    protocol: Buffer.from(protocol, "utf8").toString("base64"),
    host: Buffer.from(privateIp, "utf8").toString("base64"),
    username: Buffer.from(gatewayUsername, "utf8").toString("base64"),
    password: Buffer.from(vmPassword, "utf8").toString("base64")
  };

  const script = [
    "set -euo pipefail",
    "MAPPING=/opt/guac/user-mapping.xml",
    `export ORCH_CONN_NAME_B64='${encoded.name}'`,
    `export ORCH_PROTOCOL_B64='${encoded.protocol}'`,
    `export ORCH_HOST_B64='${encoded.host}'`,
    `export ORCH_USER_B64='${encoded.username}'`,
    `export ORCH_PASS_B64='${encoded.password}'`,
    "mkdir -p /opt/guac",
    "if [ ! -f \"$MAPPING\" ]; then",
    "  cat > \"$MAPPING\" <<'EOF'",
    "<user-mapping>",
    "  <authorize username=\"viewer\" password=\"viewer\">",
    "  </authorize>",
    "</user-mapping>",
    "EOF",
    "fi",
    `python3 - <<'PY'`,
    "import base64, os",
    "import xml.etree.ElementTree as ET",
    "path='/opt/guac/user-mapping.xml'",
    "name=base64.b64decode(os.environ['ORCH_CONN_NAME_B64']).decode('utf-8')",
    "protocol=base64.b64decode(os.environ['ORCH_PROTOCOL_B64']).decode('utf-8')",
    "hostname=base64.b64decode(os.environ['ORCH_HOST_B64']).decode('utf-8')",
    "username=base64.b64decode(os.environ['ORCH_USER_B64']).decode('utf-8')",
    "password=base64.b64decode(os.environ['ORCH_PASS_B64']).decode('utf-8')",
    "tree=ET.parse(path)",
    "root=tree.getroot()",
    "auth=None",
    "for candidate in root.findall('authorize'):",
    "    if candidate.attrib.get('username')=='viewer':",
    "        auth=candidate",
    "        break",
    "if auth is None:",
    "    auth=ET.SubElement(root,'authorize',{'username':'viewer','password':'viewer'})",
    "for c in list(auth.findall('connection')):",
    "    if c.attrib.get('name')==name:",
    "        auth.remove(c)",
    "conn=ET.SubElement(auth,'connection',{'name':name})",
    "ET.SubElement(conn,'protocol').text=protocol",
    "ET.SubElement(conn,'param',{'name':'hostname'}).text=hostname",
    "ET.SubElement(conn,'param',{'name':'port'}).text='3389'",
    "ET.SubElement(conn,'param',{'name':'username'}).text=username",
    "ET.SubElement(conn,'param',{'name':'password'}).text=password",
    "ET.SubElement(conn,'param',{'name':'security'}).text='any'",
    "ET.SubElement(conn,'param',{'name':'ignore-cert'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'enable-font-smoothing'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'enable-full-window-drag'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'enable-menu-animations'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'enable-themes'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'clipboard-encoding'}).text='UTF-8'",
    "ET.SubElement(conn,'param',{'name':'disable-copy'}).text='false'",
    "ET.SubElement(conn,'param',{'name':'disable-paste'}).text='false'",
    "ET.SubElement(conn,'param',{'name':'enable-drive'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'create-drive-path'}).text='true'",
    "ET.SubElement(conn,'param',{'name':'drive-name'}).text='Shared'",
    "ET.SubElement(conn,'param',{'name':'resize-method'}).text='display-update'",
    "ET.SubElement(conn,'param',{'name':'enable-wallpaper'}).text='false'",
    "ET.SubElement(conn,'param',{'name':'disable-audio'}).text='true'",
    "ET.indent(tree, space='  ')",
    "tree.write(path, encoding='utf-8', xml_declaration=False)",
    "PY",
    "docker restart guacamole >/dev/null 2>&1 || true"
  ];

  await compute.virtualMachines.beginRunCommandAndWait(config.resourceGroup, config.gatewayVmName, {
    commandId: "RunShellScript",
    script
  });
}

async function removeGatewayConnection(vmName: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);
  const safeVmName = sanitizeVmName(vmName);

  const script = [
    "set -euo pipefail",
    "MAPPING=/opt/guac/user-mapping.xml",
    "if [ ! -f \"$MAPPING\" ]; then exit 0; fi",
    "python3 - <<'PY'",
    "import xml.etree.ElementTree as ET",
    "path='/opt/guac/user-mapping.xml'",
    "tree=ET.parse(path)",
    "root=tree.getroot()",
    `name='${safeVmName}'`,
    "for auth in root.findall('authorize'):",
    "    for conn in list(auth.findall('connection')):",
    "        if conn.attrib.get('name')==name:",
    "            auth.remove(conn)",
    "ET.indent(tree, space='  ')",
    "tree.write(path, encoding='utf-8', xml_declaration=False)",
    "PY",
    "docker restart guacamole >/dev/null 2>&1 || true"
  ];

  await compute.virtualMachines.beginRunCommandAndWait(config.resourceGroup, config.gatewayVmName, {
    commandId: "RunShellScript",
    script
  });
}

async function resolvePrivateIp(vmName: string, tags?: Record<string, string>) {
  const config = getConfig();
  const { network } = getAzureClients(config.subscriptionId);

  const tagIp = tags?.privateIp;
  if (tagIp) {
    return tagIp;
  }

  const nicName = `nic-${vmName}`;
  try {
    const nic = await network.networkInterfaces.get(config.resourceGroup, nicName);
    return nic.ipConfigurations?.[0]?.privateIPAddress ?? "";
  } catch {
    return "";
  }
}

async function listPrewarmedVms(topicId: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const items: Array<{ name?: string; tags?: Record<string, string> }> = [];

  for await (const entry of compute.virtualMachines.list(config.resourceGroup)) {
    const vm = entry as {
      name?: string;
      tags?: Record<string, string>;
    };
    const tags = vm.tags ?? {};
    if (
      vm.name &&
      tags.managedBy === "orchestrator" &&
      tags.prewarmed === "true" &&
      tags.poolTopic === topicId
    ) {
      items.push(vm);
    }
  }

  return items;
}

function scorePrewarmedMatch(
  tags: Record<string, string>,
  input: { sourceMode: "marketplace" | "custom-image"; imageId: string; osType: "linux" | "windows"; adminUsername?: string }
) {
  let score = 0;
  if (tags.vmState === "deallocated") {
    score += 10;
  }
  if (tags.sourceMode === input.sourceMode) {
    score += 6;
  }
  if (tags.sourceImage === input.imageId) {
    score += 8;
  }
  if (tags.osType === input.osType) {
    score += 4;
  }
  if (input.adminUsername && tags.adminUsername === input.adminUsername) {
    score += 2;
  }
  return score;
}

async function findAvailablePrewarmedVm(input: {
  topicId: string;
  sourceMode: "marketplace" | "custom-image";
  imageId: string;
  osType: "linux" | "windows";
  adminUsername?: string;
}) {
  const candidates = await listPrewarmedVms(input.topicId);
  const deallocated = candidates.filter((vm) => {
    const tags = vm.tags ?? {};
    return (
      tags.vmState === "deallocated" &&
      tags.sourceMode === input.sourceMode &&
      tags.sourceImage === input.imageId &&
      tags.osType === input.osType
    );
  });
  const ranked = deallocated
    .map((vm) => ({ vm, score: scorePrewarmedMatch(vm.tags ?? {}, input) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.vm;
}

async function pruneExtraPrewarmedVms(topicId: string, keepVmName?: string) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);
  const candidates = await listPrewarmedVms(topicId);

  const deallocated = candidates
    .filter((vm) => vm.name && (vm.tags ?? {}).vmState === "deallocated")
    .sort((a, b) => {
      const aTs = Number((a.tags ?? {}).createdAt ?? "0");
      const bTs = Number((b.tags ?? {}).createdAt ?? "0");
      return bTs - aTs;
    });

  const protectedVm = keepVmName ?? deallocated[0]?.name;
  const extras = deallocated.filter((vm) => vm.name && vm.name !== protectedVm);

  await Promise.all(
    extras.map(async (vm) => {
      if (!vm.name) {
        return;
      }
      try {
        await compute.virtualMachines.beginDeleteAndWait(config.resourceGroup, vm.name);
      } catch {
        // best-effort cleanup
      }
    })
  );

  return protectedVm;
}

async function ensurePrewarmedVmForTopic(input: {
  topicId: string;
  sourceMode: "marketplace" | "custom-image";
  imageId: string;
  osType: "linux" | "windows";
  vmSize?: string;
  adminUsername: string;
  adminPassword: string;
}) {
  const topicId = input.topicId.trim().toLowerCase();
  if (!topicId || topicId === "azure") {
    return;
  }

  const existing = await findAvailablePrewarmedVm({
    topicId,
    sourceMode: input.sourceMode,
    imageId: input.imageId,
    osType: input.osType,
    adminUsername: sanitizeAdminUsername(input.adminUsername)
  });
  if (existing?.name) {
    await pruneExtraPrewarmedVms(topicId, existing.name);
    return;
  }

  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);
  const vmName = sanitizeVmName(`pool-${topicId}-${Date.now().toString().slice(-6)}`);

  await startVm({
    vmName,
    ownerId: POOL_OWNER_ID,
    sourceMode: input.sourceMode,
    imageId: input.imageId,
    osType: input.osType,
    vmSize: input.vmSize,
    topicId,
    adminUsername: input.adminUsername,
    adminPassword: input.adminPassword,
    skipPrewarmedPool: true,
    skipGatewayRegistration: true
  });

  await compute.virtualMachines.beginPowerOffAndWait(config.resourceGroup, vmName);

  const vm = await compute.virtualMachines.get(config.resourceGroup, vmName);
  const tags = vm.tags ?? {};

  await compute.virtualMachines.beginUpdateAndWait(config.resourceGroup, vmName, {
    tags: {
      ...tags,
      ownerId: POOL_OWNER_ID,
      prewarmed: "true",
      poolTopic: topicId,
      createdAt: String(Date.now()),
      vmState: "deallocated",
      expiresAt: nowPlusMinutes(60 * 24 * 30)
    }
  });

  await pruneExtraPrewarmedVms(topicId, vmName);
}

async function tryClaimPrewarmedVm(input: StartVmInput) {
  const topicId = (input.topicId ?? "").trim().toLowerCase();
  if (!topicId || topicId === "azure") {
    return undefined;
  }

  const requestedUsername = sanitizeAdminUsername(input.adminUsername ?? getConfig().vmAdminUsername);
  const candidate = await findAvailablePrewarmedVm({
    topicId,
    sourceMode: input.sourceMode,
    imageId: input.imageId,
    osType: input.osType,
    adminUsername: requestedUsername
  });
  if (!candidate?.name) {
    return undefined;
  }

  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);
  const vmName = candidate.name;
  const currentTags = candidate.tags ?? {};
  const claimToken = randomUUID();
  const vmSize = input.vmSize ?? currentTags.vmSize ?? (input.osType === "windows" ? config.vmSizeWindows : config.vmSizeLinux);
  const adminUsername = requestedUsername;
  const displayPassword = input.adminPassword?.trim() ? input.adminPassword.trim() : currentTags.displayPassword ?? generatePassword();
  const adminPassword = currentTags.authPassword ?? toCompliantPassword(displayPassword, adminUsername);
  const expiresAt = nowPlusMinutes(config.vmLifetimeMin);

  await compute.virtualMachines.beginUpdateAndWait(config.resourceGroup, vmName, {
    tags: {
      ...currentTags,
      ownerId: input.ownerId,
      prewarmed: "false",
      poolClaimToken: claimToken,
      topicId,
      sourceMode: input.sourceMode,
      sourceImage: input.imageId,
      osType: input.osType,
      adminUsername,
      displayPassword,
      authPassword: adminPassword,
      vmSize,
      vmState: "running",
      expiresAt,
      allowedClientCidr: input.allowedClientCidr ?? config.allowedClientCidr
    }
  });

  const verified = await compute.virtualMachines.get(config.resourceGroup, vmName);
  if ((verified.tags ?? {}).poolClaimToken !== claimToken) {
    return undefined;
  }

  await compute.virtualMachines.beginStartAndWait(config.resourceGroup, vmName);

  const tags = verified.tags ?? {};
  const privateIp = await resolvePrivateIp(vmName, tags);

  if (!input.skipGatewayRegistration) {
    void registerGatewayConnection(vmName, input.osType, privateIp, adminUsername, adminPassword).catch(() => {
      // viewer-status keeps retrying
    });
  }

  void ensurePrewarmedVmForTopic({
    topicId,
    sourceMode: input.sourceMode,
    imageId: input.imageId,
    osType: input.osType,
    vmSize,
    adminUsername,
    adminPassword
  }).catch(() => {
    // best-effort replenishment
  });

  const gatewayBaseUrl = normalizeGatewayBaseUrl(config.gatewayBaseUrl);

  return {
    vmName,
    ownerId: input.ownerId,
    adminUsername,
    adminPassword: displayPassword,
    publicIp: "",
    privateIp,
    expiresAt,
    remote: {
      ssh: `ssh ${adminUsername}@${privateIp}`,
      rdp: `${privateIp}:3389`,
      vnc: "",
      noVncUrl: `${gatewayBaseUrl}#/`,
      rdpWebUrl: `${gatewayBaseUrl}#/`,
      rdpWebUsername: "viewer",
      rdpWebPassword: "viewer"
    }
  };
}

export async function startVm(input: StartVmInput) {
  if (!input.skipPrewarmedPool) {
    const claimed = await tryClaimPrewarmedVm(input);
    if (claimed) {
      return claimed;
    }
  }

  const config = getConfig();
  const { compute, network } = getAzureClients(config.subscriptionId);

  const baseName = sanitizeVmName(
    input.vmName ?? `${input.osType}-${Date.now().toString().slice(-7)}`
  );

  const vmName = baseName.length > 0 ? baseName : `vm-${Date.now().toString().slice(-7)}`;
  const nicName = `nic-${vmName}`;

  const adminUsername = sanitizeAdminUsername(input.adminUsername ?? config.vmAdminUsername);
  const requestedPassword = input.adminPassword?.trim() ? input.adminPassword.trim() : generatePassword();
  const displayPassword = requestedPassword;
  const adminPassword = toCompliantPassword(requestedPassword, adminUsername);

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

  const marketplacePlan =
    input.sourceMode === "marketplace"
      ? (() => {
          const image = getMarketplaceImage(input.imageId);
          return image?.plan;
        })()
      : undefined;

  const customImageId = input.sourceMode === "custom-image" ? input.imageId : undefined;

  const vmSize =
    input.vmSize ?? (input.osType === "windows" ? config.vmSizeWindows : config.vmSizeLinux);

  const expiresAt = nowPlusMinutes(config.vmLifetimeMin);

  const nic = await network.networkInterfaces.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    nicName,
    {
      location: config.location,
      ipConfigurations: [
        {
          name: "ipconfig1",
          subnet: { id: config.subnetId },
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

  const privateIp = nic.ipConfigurations?.[0]?.privateIPAddress ?? "";

  await compute.virtualMachines.beginCreateOrUpdateAndWait(config.resourceGroup, vmName, {
    location: config.location,
    plan: marketplacePlan,
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
      customData:
        input.osType === "linux"
          ? createLinuxCloudInit(adminUsername)
          : undefined
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
      prewarmed: "false",
      topicId: input.topicId ?? "azure",
      sourceMode: input.sourceMode,
      sourceImage: input.imageId,
      osType: input.osType,
      adminUsername,
      privateIp,
      displayPassword,
      authPassword: adminPassword,
      vmSize,
      vmState: "running",
      expiresAt,
      allowedClientCidr: input.allowedClientCidr ?? config.allowedClientCidr
    }
  });

  if (!input.skipGatewayRegistration) {
    void registerGatewayConnection(vmName, input.osType, privateIp, adminUsername, adminPassword).catch(() => {
      // async registration; viewer-status will continue retrying until ready
    });
  }

  const topicId = (input.topicId ?? "").trim().toLowerCase();
  if (!input.skipPrewarmedPool && topicId && topicId !== "azure") {
    void ensurePrewarmedVmForTopic({
      topicId,
      sourceMode: input.sourceMode,
      imageId: input.imageId,
      osType: input.osType,
      vmSize,
      adminUsername,
      adminPassword: displayPassword
    }).catch(() => {
      // best-effort replenishment
    });
  }

  const gatewayBaseUrl = normalizeGatewayBaseUrl(config.gatewayBaseUrl);

  return {
    vmName,
    ownerId: input.ownerId,
    adminUsername,
    adminPassword: displayPassword,
    publicIp: "",
    privateIp,
    expiresAt,
    remote: {
      ssh: `ssh ${adminUsername}@${privateIp}`,
      rdp: `${privateIp}:3389`,
      vnc: "",
      noVncUrl: `${gatewayBaseUrl}#/`,
      rdpWebUrl: `${gatewayBaseUrl}#/`,
      rdpWebUsername: "viewer",
      rdpWebPassword: "viewer"
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
    if (vm.tags.prewarmed === "true") {
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

      const tags = vm.tags ?? {};
      let ipAddress = tags.privateIp ?? "";

      if (!ipAddress) {
        const nicName = `nic-${vm.name}`;
        try {
          const nic = await network.networkInterfaces.get(config.resourceGroup, nicName);
          ipAddress = nic.ipConfigurations?.[0]?.privateIPAddress ?? "";
        } catch {
          ipAddress = "";
        }
      }

      return {
        name: vm.name,
        location: vm.location,
        provisioningState: vm.provisioningState,
        publicIp: ipAddress,
        tags
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

  let ipAddress = vm.tags?.privateIp ?? "";
  if (!ipAddress) {
    const nicName = `nic-${vmName}`;
    try {
      const nic = await network.networkInterfaces.get(config.resourceGroup, nicName);
      ipAddress = nic.ipConfigurations?.[0]?.privateIPAddress ?? "";
    } catch {
      ipAddress = "";
    }
  }

  return {
    name: vmName,
    statuses,
    provisioningState: vm.provisioningState,
    publicIp: ipAddress,
    tags: vm.tags ?? {}
  };
}

export async function getViewerStatus(vmName: string, ownerId: string) {
  const config = getConfig();
  const { network } = getAzureClients(config.subscriptionId);

  const vm = await assertVmOwnership(vmName, ownerId);
  const tags = vm.tags ?? {};
  const osType = tags.osType === "windows" ? "windows" : "linux";

  let ipAddress = tags.privateIp ?? "";
  if (!ipAddress) {
    const nicName = `nic-${vmName}`;
    try {
      const nic = await network.networkInterfaces.get(config.resourceGroup, nicName);
      ipAddress = nic.ipConfigurations?.[0]?.privateIPAddress ?? "";
    } catch {
      ipAddress = "";
    }
  }

  const gatewayBaseUrl = normalizeGatewayBaseUrl(config.gatewayBaseUrl);

  if (!ipAddress) {
    return {
      ready: false,
      progress: 10,
      phase: "private-ip",
      message: "Waiting for private VM network...",
      osType
    };
  }

  const rdpOpen = await isTcpPortOpen(ipAddress, 3389, 2500);
  const gatewayHttpReady = await isHttpReady(gatewayBaseUrl, 3000);

  if (!gatewayHttpReady) {
    return {
      ready: false,
      progress: rdpOpen ? 72 : 44,
      phase: "gateway-starting",
      message: "Central gateway is starting...",
      osType,
      viewerUrl: gatewayBaseUrl
    };
  }

  const autoLoginUrl = await buildViewerAutoLoginUrl(gatewayBaseUrl, sanitizeVmName(vmName));

  if (autoLoginUrl) {
    return {
      ready: true,
      progress: 100,
      phase: "ready",
      message: "Viewer is ready.",
      osType,
      viewerUrl: autoLoginUrl,
      credentials: {
        username: "viewer",
        password: "viewer"
      }
    };
  }

  const progress = rdpOpen ? 86 : 58;
  const phase = rdpOpen ? "registering" : "rdp-starting";
  const message = rdpOpen
    ? "Registering VM in central gateway..."
    : osType === "windows"
      ? "Windows RDP service is starting..."
      : "Linux desktop service is starting...";

  return {
    ready: false,
    progress,
    phase,
    message,
    osType,
    viewerUrl: gatewayBaseUrl
  };
}

export async function uploadFileToVm(
  vmName: string,
  ownerId: string,
  fileName: string,
  contentBase64: string
) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const vm = await assertVmOwnership(vmName, ownerId);
  const tags = vm.tags ?? {};
  const osType = tags.osType === "windows" ? "windows" : "linux";
  const vmAdminUsername = tags.adminUsername ?? config.vmAdminUsername;

  const safeFileName = sanitizeUploadFileName(fileName);
  const decodedBytes = Buffer.from(contentBase64, "base64").byteLength;
  if (decodedBytes > 2 * 1024 * 1024) {
    throw new Error("File is too large. Maximum upload size is 2 MB.");
  }

  if (osType === "linux") {
    const script = [
      `mkdir -p /home/${vmAdminUsername}/Downloads`,
      `cat > /tmp/${safeFileName}.b64 <<'EOF'`,
      contentBase64,
      "EOF",
      `base64 -d /tmp/${safeFileName}.b64 > /home/${vmAdminUsername}/Downloads/${safeFileName}`,
      `chown ${vmAdminUsername}:${vmAdminUsername} /home/${vmAdminUsername}/Downloads/${safeFileName}`,
      `rm -f /tmp/${safeFileName}.b64`
    ];

    await compute.virtualMachines.beginRunCommandAndWait(config.resourceGroup, vmName, {
      commandId: "RunShellScript",
      script
    });
  } else {
    const script = [
      `$content = \"${contentBase64}\"`,
      "$bytes = [Convert]::FromBase64String($content)",
      "$targetDir = \"C:\\Users\\Public\\Downloads\"",
      "New-Item -ItemType Directory -Force -Path $targetDir | Out-Null",
      `$targetFile = Join-Path $targetDir \"${safeFileName}\"`,
      "[System.IO.File]::WriteAllBytes($targetFile, $bytes)"
    ];

    await compute.virtualMachines.beginRunCommandAndWait(config.resourceGroup, vmName, {
      commandId: "RunPowerShellScript",
      script
    });
  }

  return {
    ok: true,
    vmName,
    fileName: safeFileName,
    destination:
      osType === "linux"
        ? `/home/${vmAdminUsername}/Downloads/${safeFileName}`
        : `C:\\Users\\Public\\Downloads\\${safeFileName}`
  };
}

function titleCaseTopic(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function listTopics(): Promise<TopicDefinition[]> {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);

  const topics = new Map<string, TopicDefinition>();

  topics.set("azure", {
    id: "azure",
    label: "Azure",
    type: "azure",
    allowCustomCredentials: true,
    images: marketplaceCatalog.map((image) => ({
      id: image.id,
      label: image.label,
      osType: image.osType,
      sourceMode: "marketplace",
      imageId: image.id
    }))
  });

  for await (const entry of compute.images.listByResourceGroup(config.resourceGroup)) {
    const image = entry as {
      id?: string;
      name?: string;
      tags?: Record<string, string>;
    };

    if (!image.id || !image.name) {
      continue;
    }

    const tags = image.tags ?? {};
    const rawTopic = tags.orchTopic ?? tags.topic ?? "custom";
    const topicId = sanitizeTopicId(rawTopic) || "custom";
    const topicLabel = tags.orchTopicLabel ?? titleCaseTopic(topicId);
    const osType = tags.orchOsType === "windows" ? "windows" : "linux";

    const existingTopic = topics.get(topicId);
    if (!existingTopic) {
      topics.set(topicId, {
        id: topicId,
        label: topicLabel,
        type: topicId === "azure" ? "azure" : "custom",
        allowCustomCredentials: false,
        images: []
      });
    }

    const topic = topics.get(topicId);
    if (!topic) {
      continue;
    }

    topic.images.push({
      id: image.name,
      label: tags.orchLabel ?? image.name,
      osType,
      sourceMode: "custom-image",
      imageId: image.id,
      fixedUsername: tags.orchFixedUsername,
      fixedPassword: tags.orchFixedPassword
    });
  }

  return Array.from(topics.values()).filter((topic) => topic.images.length > 0 || topic.id === "azure");
}

export async function registerCustomImage(input: {
  imageIdOrName: string;
  topicId: string;
  topicLabel?: string;
  label?: string;
  osType: "linux" | "windows";
  username: string;
  password: string;
}) {
  const config = getConfig();
  const { compute } = getAzureClients(config.subscriptionId);
  const normalizedTopicId = sanitizeTopicId(input.topicId);

  if (!normalizedTopicId || normalizedTopicId === "azure") {
    throw new Error("Topic id is invalid or reserved.");
  }

  if (!input.username.trim() || !input.password.trim()) {
    throw new Error("Fixed username and password are required for custom topics.");
  }

  let image = await compute.images.get(config.resourceGroup, input.imageIdOrName).catch(() => undefined);

  if (!image && input.imageIdOrName.includes("/")) {
    for await (const candidate of compute.images.listByResourceGroup(config.resourceGroup)) {
      if (candidate.id === input.imageIdOrName) {
        image = candidate;
        break;
      }
    }
  }

  if (!image?.name) {
    throw new Error("Managed image was not found in this resource group.");
  }

  const tags = {
    ...(image.tags ?? {}),
    managedBy: "orchestrator",
    orchTopic: normalizedTopicId,
    orchTopicLabel: (input.topicLabel?.trim() || titleCaseTopic(normalizedTopicId)).slice(0, 60),
    orchLabel: (input.label?.trim() || image.name).slice(0, 80),
    orchOsType: input.osType,
    orchFixedUsername: sanitizeAdminUsername(input.username),
    orchFixedPassword: input.password.trim()
  };

  const updated = await compute.images.beginCreateOrUpdateAndWait(config.resourceGroup, image.name, {
    location: image.location ?? config.location,
    hyperVGeneration: image.hyperVGeneration,
    sourceVirtualMachine: image.sourceVirtualMachine,
    storageProfile: image.storageProfile,
    tags
  });

  return {
    ok: true,
    imageName: updated.name,
    imageId: updated.id,
    topicId: normalizedTopicId
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

  try {
    await network.networkInterfaces.beginDeleteAndWait(config.resourceGroup, nicName);
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

  try {
    await removeGatewayConnection(vmName);
  } catch {
    // ignore gateway cleanup failures
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
