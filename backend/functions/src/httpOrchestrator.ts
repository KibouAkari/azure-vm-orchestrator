import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConfig } from "./shared/config.js";
import {
  completeImageUpload,
  createImageFromVm,
  deleteVm,
  extendVm,
  getViewerStatus,
  getVmStatus,
  listManagedImages,
  listTopics,
  prepareImageUpload,
  registerCustomImage,
  listVms,
  resumeVm,
  startVm,
  stopVm,
  uploadFileToVm,
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

async function resolveStartProfile(body: {
  topicId?: string;
  image?: string;
  imageId?: string;
  vmSize?: string;
  username?: string;
  password?: string;
  vmName?: string;
  name?: string;
}) {
  const topicId = (body.topicId ?? "azure").trim().toLowerCase();
  const requestedImage = body.imageId ?? body.image;

  if (topicId === "azure") {
    if (!requestedImage) {
      throw new Error("image is required for Azure topic");
    }

    return {
      vmName: body.vmName ?? body.name,
      sourceMode: "marketplace" as const,
      imageId: requestedImage,
      osType: inferOsType(requestedImage),
      vmSize: body.vmSize,
      topicId: "azure",
      adminUsername: body.username,
      adminPassword: body.password
    };
  }

  const topics = await listTopics();
  const topic = topics.find((entry) => entry.id === topicId);
  if (!topic || topic.type !== "custom") {
    throw new Error("Unknown custom topic");
  }

  if (!requestedImage) {
    throw new Error("image is required for custom topic");
  }

  const image = topic.images.find((entry) => entry.id === requestedImage || entry.imageId === requestedImage);
  if (!image) {
    throw new Error("Image not found in selected topic");
  }

  return {
    vmName: body.vmName ?? body.name,
    sourceMode: image.sourceMode,
    imageId: image.imageId,
    osType: image.osType,
    vmSize: body.vmSize,
    topicId,
    adminUsername: image.fixedUsername,
    adminPassword: image.fixedPassword
  };
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
      const topics = await listTopics();
      const azureTopic = topics.find((topic) => topic.id === "azure");
      const images = azureTopic?.images.map((image) => ({
        id: image.id,
        label: image.label,
        osType: image.osType,
        mode: image.sourceMode
      })) ?? [];

      return response(200, { images, topics, vmSizes: ["Standard_B2s"] });
    }

    if (method === "GET" && route.length === 1 && route[0] === "topics") {
      return response(200, { items: await listTopics() });
    }

    if (method === "GET" && route.length === 1 && route[0] === "vms") {
      return response(200, { items: await listVms(ownerId) });
    }

    if (method === "POST" && route.length === 1 && route[0] === "vms") {
      const body = (await request.json()) as {
        name?: string;
        image?: string;
        topicId?: string;
        vmSize?: string;
        username?: string;
        password?: string;
      };

      const profile = await resolveStartProfile(body);

      const data = await startVm({
        vmName: profile.vmName,
        ownerId,
        sourceMode: profile.sourceMode,
        imageId: profile.imageId,
        osType: profile.osType,
        vmSize: profile.vmSize,
        topicId: profile.topicId,
        adminUsername: profile.adminUsername,
        adminPassword: profile.adminPassword
      });

      return response(201, data);
    }

    if (method === "POST" && route.length === 2 && route[0] === "vms" && route[1] === "start") {
      const body = (await request.json()) as {
        vmName?: string;
        topicId?: string;
        sourceMode?: "marketplace" | "custom-image";
        imageId: string;
        osType: "linux" | "windows";
        vmSize?: string;
        username?: string;
        password?: string;
        allowedClientCidr?: string;
      };

      const profile = await resolveStartProfile({
        vmName: body.vmName,
        topicId: body.topicId,
        imageId: body.imageId,
        vmSize: body.vmSize,
        username: body.username,
        password: body.password
      });

      const data = await startVm({
        vmName: profile.vmName,
        ownerId,
        sourceMode: profile.sourceMode,
        imageId: profile.imageId,
        osType: profile.osType,
        vmSize: profile.vmSize,
        topicId: profile.topicId,
        adminUsername: profile.adminUsername,
        adminPassword: profile.adminPassword,
        allowedClientCidr: body.allowedClientCidr
      });

      return response(201, data);
    }

    if (method === "POST" && route.length === 2 && route[0] === "images" && route[1] === "register") {
      const body = (await request.json()) as {
        imageIdOrName?: string;
        topicId?: string;
        topicLabel?: string;
        label?: string;
        osType?: "linux" | "windows";
        username?: string;
        password?: string;
      };

      if (
        !body?.imageIdOrName ||
        !body.topicId ||
        !body.osType ||
        !body.username ||
        !body.password
      ) {
        return response(400, {
          error: "imageIdOrName, topicId, osType, username and password are required"
        });
      }

      return response(
        201,
        await registerCustomImage({
          imageIdOrName: body.imageIdOrName,
          topicId: body.topicId,
          topicLabel: body.topicLabel,
          label: body.label,
          osType: body.osType,
          username: body.username,
          password: body.password
        })
      );
    }

    if (method === "POST" && route.length === 2 && route[0] === "images" && route[1] === "upload-init") {
      const body = (await request.json()) as { fileName?: string; contentType?: string };
      if (!body?.fileName) {
        return response(400, { error: "fileName is required" });
      }

      return response(201, await prepareImageUpload(body.fileName, body.contentType));
    }

    if (method === "POST" && route.length === 2 && route[0] === "images" && route[1] === "upload-complete") {
      const body = (await request.json()) as {
        blobUrl?: string;
        imageName?: string;
        imageLabel?: string;
        topicId?: string;
        topicLabel?: string;
        username?: string;
        password?: string;
        osType?: "linux" | "windows";
      };

      if (
        !body?.blobUrl ||
        !body.imageName ||
        !body.topicId ||
        !body.username ||
        !body.password ||
        !body.osType
      ) {
        return response(400, {
          error: "blobUrl, imageName, topicId, username, password and osType are required"
        });
      }

      return response(
        201,
        await completeImageUpload({
          blobUrl: body.blobUrl,
          imageName: body.imageName,
          imageLabel: body.imageLabel,
          topicId: body.topicId,
          topicLabel: body.topicLabel,
          username: body.username,
          password: body.password,
          osType: body.osType
        })
      );
    }

      if (method === "POST" && route.length === 3 && route[0] === "vms" && route[2] === "files") {
        const body = (await request.json()) as { fileName?: string; contentBase64?: string };
        if (!body?.fileName || !body?.contentBase64) {
          return response(400, { error: "fileName and contentBase64 are required" });
        }

        return response(200, await uploadFileToVm(route[1], ownerId, body.fileName, body.contentBase64));
      }

    if (method === "GET" && route.length === 3 && route[0] === "vms" && route[2] === "status") {
      return response(200, await getVmStatus(route[1], ownerId));
    }

    if (method === "GET" && route.length === 3 && route[0] === "vms" && route[2] === "viewer-status") {
      return response(200, await getViewerStatus(route[1], ownerId));
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
