import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "./shared/config.js";
import {
  createImageFromVm,
  deleteVm,
  extendVm,
  getVmStatus,
  listManagedImages,
  listVms,
  resumeVm,
  startVm,
  stopVm
} from "./shared/vmManager.js";

function response(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body
  };
}

function unauthorized() {
  return response(401, { error: "Unauthorized" });
}

function getOwnerId(request: HttpRequest) {
  return request.headers.get("x-user-id") ?? "anonymous";
}

function hasValidApiKey(request: HttpRequest) {
  const config = getConfig();
  const key = request.headers.get("x-api-key");
  return Boolean(key && key === config.apiKey);
}

function inferOsType(imageId: string): "linux" | "windows" {
  return imageId.toLowerCase().includes("win") ? "windows" : "linux";
}

async function handleRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    if (!hasValidApiKey(request)) {
      return unauthorized();
    }

    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const ownerId = getOwnerId(request);

    const orchestratorIndex = segments.findIndex((segment) => segment === "orchestrator");
    const route = orchestratorIndex >= 0 ? segments.slice(orchestratorIndex + 1) : segments;

    if (method === "GET" && route.length === 1 && route[0] === "catalog") {
      const images = [
        { id: "ubuntu-22.04", label: "Ubuntu 22.04 LTS", osType: "linux", mode: "marketplace" },
        { id: "debian-12", label: "Debian 12", osType: "linux", mode: "marketplace" },
        { id: "win2022", label: "Windows Server 2022", osType: "windows", mode: "marketplace" }
      ];

      return response(200, { images });
    }

    if (method === "GET" && route.length === 1 && route[0] === "vms") {
      return response(200, { items: await listVms(ownerId) });
    }

    if (method === "POST" && route.length === 1 && route[0] === "vms") {
      const body = (await request.json()) as {
        name?: string;
        image?: string;
        vmSize?: string;
      };

      if (!body?.image) {
        return response(400, { error: "image is required" });
      }

      const data = await startVm({
        vmName: body.name,
        ownerId,
        sourceMode: "marketplace",
        imageId: body.image,
        osType: inferOsType(body.image),
        vmSize: body.vmSize
      });

      return response(201, data);
    }

    if (method === "POST" && route.length === 2 && route[0] === "vms" && route[1] === "start") {
      const body = (await request.json()) as {
        vmName?: string;
        sourceMode?: "marketplace" | "custom-image";
        imageId: string;
        osType: "linux" | "windows";
        vmSize?: string;
        allowedClientCidr?: string;
      };

      if (!body?.imageId || !body?.osType) {
        return response(400, { error: "imageId and osType are required" });
      }

      const data = await startVm({
        vmName: body.vmName,
        ownerId,
        sourceMode: body.sourceMode ?? "marketplace",
        imageId: body.imageId,
        osType: body.osType,
        vmSize: body.vmSize,
        allowedClientCidr: body.allowedClientCidr
      });

      return response(201, data);
    }

    if (method === "GET" && route.length === 3 && route[0] === "vms" && route[2] === "status") {
      return response(200, await getVmStatus(route[1], ownerId));
    }

    if (method === "POST" && route.length === 3 && route[0] === "vms" && route[2] === "start") {
      return response(200, await resumeVm(route[1], ownerId));
    }

    if (method === "POST" && route.length === 3 && route[0] === "vms" && route[2] === "stop") {
      return response(200, await stopVm(route[1], ownerId));
    }

    if (method === "POST" && route.length === 3 && route[0] === "vms" && route[2] === "extend") {
      const body = (await request.json()) as { minutes?: number };
      const minutes = Math.max(5, Number(body?.minutes ?? 60));
      return response(200, await extendVm(route[1], minutes, ownerId));
    }

    if (method === "DELETE" && route.length === 2 && route[0] === "vms") {
      return response(200, await deleteVm(route[1], ownerId));
    }

    if (method === "GET" && route.length === 1 && route[0] === "images") {
      return response(200, { items: await listManagedImages() });
    }

    if (method === "POST" && route.length === 2 && route[0] === "images" && route[1] === "from-vm") {
      const body = (await request.json()) as { vmName?: string; imageName?: string };
      if (!body?.vmName || !body?.imageName) {
        return response(400, { error: "vmName and imageName are required" });
      }

      return response(201, await createImageFromVm(body.vmName, body.imageName));
    }

    return response(404, { error: "Route not found", route, method });
  } catch (error) {
    context.error("orchestrator error", error);
    return response(500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
}

app.http("orchestrator", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "orchestrator/{*segments}",
  handler: handleRequest
});
