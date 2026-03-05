import { NextRequest, NextResponse } from "next/server";

const USER_COOKIE = "orch_uid";

const imageOsTypeMap: Record<string, "linux" | "windows"> = {
  ubuntu2404: "linux",
  ubuntu2204: "linux",
  debian12: "linux",
  "kali-latest": "linux",
  archlinux: "linux",
  win2022: "windows",
  "ubuntu-24.04": "linux",
  "ubuntu-22.04": "linux",
  "debian-12": "linux"
};

const imageIdAliasMap: Record<string, string> = {
  ubuntu2404: "ubuntu-24.04",
  ubuntu2204: "ubuntu-22.04",
  debian12: "debian-12",
  kali: "kali-latest",
  arch: "archlinux"
};

type TopicApi = {
  id: string;
  label: string;
  type: "azure" | "custom";
  allowCustomCredentials: boolean;
  images: Array<{
    id: string;
    label: string;
    osType: "linux" | "windows";
    sourceMode: "marketplace" | "custom-image";
    imageId: string;
    fixedUsername?: string;
    fixedPassword?: string;
  }>;
};

function mockResponse(path: string[], method: string) {
  if (method === "GET" && path.join("/") === "catalog") {
    return NextResponse.json({
      images: [
        { key: "ubuntu-24.04", label: "Ubuntu 24.04 LTS", osType: "linux" },
        { key: "ubuntu-22.04", label: "Ubuntu 22.04 LTS", osType: "linux" },
        { key: "debian-12", label: "Debian 12", osType: "linux" },
        { key: "kali-latest", label: "Kali Linux", osType: "linux" },
        { key: "archlinux", label: "Arch Linux (compat image)", osType: "linux" },
        { key: "win2022", label: "Windows Server 2022", osType: "windows" }
      ],
      topics: [
        {
          id: "azure",
          label: "Azure",
          type: "azure",
          allowCustomCredentials: true,
          images: [
            {
              id: "ubuntu-24.04",
              label: "Ubuntu 24.04 LTS",
              osType: "linux",
              sourceMode: "marketplace",
              imageId: "ubuntu-24.04"
            },
            {
              id: "win2022",
              label: "Windows Server 2022",
              osType: "windows",
              sourceMode: "marketplace",
              imageId: "win2022"
            }
          ]
        }
      ],
      vmSizes: ["Standard_B2s"],
      mocked: true
    });
  }

  if (method === "GET" && path.join("/") === "topics") {
    return NextResponse.json({
      items: [
        {
          id: "azure",
          label: "Azure",
          type: "azure",
          allowCustomCredentials: true,
          images: [
            {
              id: "ubuntu-24.04",
              label: "Ubuntu 24.04 LTS",
              osType: "linux",
              sourceMode: "marketplace",
              imageId: "ubuntu-24.04"
            },
            {
              id: "win2022",
              label: "Windows Server 2022",
              osType: "windows",
              sourceMode: "marketplace",
              imageId: "win2022"
            }
          ]
        }
      ],
      mocked: true
    });
  }

  if (method === "GET" && path.join("/") === "vms") {
    return NextResponse.json([], { status: 200 });
  }

  if (method === "GET" && path.join("/") === "images") {
    return NextResponse.json({ items: [], mocked: true });
  }

  if (method === "POST" && path.join("/") === "vms/start") {
    return NextResponse.json(
      {
        vmName: "demo-vm",
        adminPassword: "demo-password",
        remote: {
          noVncUrl: "https://novnc.com/noVNC/vnc.html"
        },
        mocked: true
      },
      { status: 201 }
    );
  }

  if (method === "POST" && path.join("/") === "images/upload-init") {
    return NextResponse.json(
      {
        uploadUrl: "https://example.blob.core.windows.net/custom-images/demo.vhd?sig=mock",
        blobUrl: "https://example.blob.core.windows.net/custom-images/demo.vhd",
        blobName: "demo.vhd",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        mocked: true
      },
      { status: 201 }
    );
  }

  if (method === "POST" && path.join("/") === "images/upload-complete") {
    return NextResponse.json(
      {
        ok: true,
        imageName: "demo-image",
        imageId: "/subscriptions/mock/resourceGroups/mock/providers/Microsoft.Compute/images/demo-image",
        topicId: "lab-web",
        mocked: true
      },
      { status: 201 }
    );
  }

  return NextResponse.json({ ok: true, mocked: true });
}

function getOrCreateUserId(request: NextRequest) {
  const existing = request.cookies.get(USER_COOKIE)?.value;
  if (existing && existing.trim().length > 0) {
    return { userId: existing, isNew: false };
  }

  return { userId: crypto.randomUUID(), isNew: true };
}

function withUserCookie(response: NextResponse, userId: string, setCookie: boolean) {
  if (!setCookie) {
    return response;
  }

  response.cookies.set(USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  return response;
}

function buildBackendUrl(path: string[]) {
  const base = process.env.ORCHESTRATOR_API_BASE_URL;
  if (!base) {
    throw new Error("Missing ORCHESTRATOR_API_BASE_URL");
  }

  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.join("/");
  return `${normalized}/${suffix}`;
}

async function forward(request: NextRequest, path: string[]) {
  const apiKey = process.env.ORCHESTRATOR_API_KEY;
  const baseUrl = process.env.ORCHESTRATOR_API_BASE_URL;
  const { userId, isNew } = getOrCreateUserId(request);

  if (!apiKey || !baseUrl) {
    return withUserCookie(mockResponse(path, request.method.toUpperCase()), userId, isNew);
  }

  let targetPath = [...path];
  let targetMethod = request.method;
  let targetBodyText = request.method !== "GET" ? await request.text() : undefined;

  if (request.method === "POST" && path.length === 3 && path[0] === "vms" && path[2] === "delete") {
    targetPath = ["vms", path[1]];
    targetMethod = "DELETE";
    targetBodyText = undefined;
  }

  if (request.method === "POST" && path.length === 1 && path[0] === "vms") {
    const parsed = targetBodyText
      ? (JSON.parse(targetBodyText) as Record<string, string | undefined>)
      : {};
    const requestedImageId = String(parsed.image ?? "ubuntu-24.04");
    const imageId = imageIdAliasMap[requestedImageId] ?? requestedImageId;
    const osType = imageOsTypeMap[imageId] ?? "linux";
    const topicId = String(parsed.topicId ?? "azure");

    targetPath = ["vms", "start"];
    targetMethod = "POST";
    targetBodyText = JSON.stringify({
      vmName: parsed.name,
      topicId,
      imageId,
      osType,
      vmSize: parsed.vmSize,
      sourceMode: topicId === "azure" ? "marketplace" : "custom-image",
      username: parsed.username,
      password: parsed.password
    });
  }

  if (request.method === "POST" && path.length === 3 && path[0] === "vms" && path[2] === "extend") {
    targetPath = ["vms", path[1], "extend"];
    targetBodyText = JSON.stringify({ minutes: 120 });
  }

  const url = buildBackendUrl(targetPath);

  const init: RequestInit = {
    method: targetMethod,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-user-id": userId
    },
    cache: "no-store"
  };

  if (targetMethod !== "GET" && targetBodyText) {
    init.body = targetBodyText;
  }

  const response = await fetch(url, init);
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = { ok: response.ok };
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "catalog") {
    const catalog = payload as {
      images?: Array<{ id?: string; key?: string; label?: string; osType?: "linux" | "windows" }>;
      topics?: TopicApi[];
      vmSizes?: string[];
    };

    const normalized = {
      images: (catalog.images ?? []).map((image) => ({
        key: image.key ?? image.id ?? "ubuntu-22.04",
        label: image.label ?? image.key ?? image.id ?? "Unnamed image",
        osType: image.osType ?? "linux"
      })),
      topics: catalog.topics ?? [],
      vmSizes: ["Standard_B2s"]
    };

    return withUserCookie(NextResponse.json(normalized, { status: response.status }), userId, isNew);
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "vms") {
    const vmList = payload as {
      items?: Array<{
        name?: string;
        publicIp?: string;
        provisioningState?: string;
        tags?: Record<string, string>;
      }>;
    };

    const normalized = (vmList.items ?? []).map((vm) => {
      const tags = vm.tags ?? {};
      const stateFromTag = tags.vmState;
      const provisioning = (vm.provisioningState ?? "").toLowerCase();

      const status =
        stateFromTag === "running" || stateFromTag === "deallocated"
          ? stateFromTag
          : provisioning.includes("failed")
            ? "failed"
            : provisioning.includes("succeeded")
              ? "running"
              : "creating";

      return {
        name: vm.name ?? "unknown-vm",
        osType: tags.osType === "windows" ? "windows" : "linux",
        image: tags.sourceImage ?? "unknown",
        topicId: tags.topicId ?? "azure",
        vmSize: tags.vmSize ?? "Standard_B2s",
        username: tags.adminUsername ?? "azureuser",
        password: tags.displayPassword ?? "",
        expiresAt: tags.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status,
        publicIp: vm.publicIp ?? ""
      };
    });

    return withUserCookie(NextResponse.json(normalized, { status: response.status }), userId, isNew);
  }

  return withUserCookie(NextResponse.json(payload, { status: response.status }), userId, isNew);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return forward(request, params.path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return forward(request, params.path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return forward(request, params.path);
}
