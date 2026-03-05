"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

type VmSummary = {
  name: string;
  osType: "windows" | "linux";
  image: string;
  topicId?: string;
  vmSize: string;
  username: string;
  password?: string;
  expiresAt: string;
  status: "running" | "deallocated" | "creating" | "failed";
  publicIp?: string;
};

type Topic = {
  id: string;
  label: string;
  type: "azure" | "custom";
  allowCustomCredentials: boolean;
  images: Array<{
    id: string;
    label: string;
    osType: "windows" | "linux";
    sourceMode: "marketplace" | "custom-image";
    imageId: string;
    fixedUsername?: string;
    fixedPassword?: string;
  }>;
};

type VmCatalog = {
  images: Array<{
    key: string;
    label: string;
    osType: "windows" | "linux";
    publisher?: string;
    offer?: string;
    sku?: string;
    version?: string;
  }>;
  topics?: Topic[];
  vmSizes: string[];
};

type ChaosMode = "none" | "errors" | "void" | "penguins" | "rickroll" | "matrix" | "glitchrain";
type VoidPhase = "sucking" | "dark";

type ChaosAlert = {
  id: number;
  top: number;
  left: number;
  message: string;
};

type PenguinDrop = {
  id: number;
  left: number;
  duration: number;
  delay: number;
  size: number;
};

type MatrixChar = {
  id: number;
  left: number;
  duration: number;
  delay: number;
  content: string;
};

type GlitchLine = {
  id: number;
  text: string;
  delay: number;
};

type ViewerStatus = {
  ready: boolean;
  progress: number;
  phase: string;
  message: string;
  osType: "linux" | "windows";
  viewerUrl?: string;
  rdp?: string;
};

type VmApiPayload = VmSummary[] | { items?: VmSummary[] };
type CatalogApiPayload =
  | VmCatalog
  | {
      images?: Array<{
        key?: string;
        id?: string;
        label?: string;
        osType?: "windows" | "linux";
      }>;
      topics?: Topic[];
      vmSizes?: string[];
    };

const initialForm = {
  name: "",
  topicId: "azure",
  image: "ubuntu-24.04",
  username: "azureuser",
  password: ""
};

const lowCostVmSize = "Standard_B2s";

const dragStorageKey = "vm-order";

const errorMessages = [
  "Hypervisor says: not today.",
  "Kernel panic (just kidding... maybe).",
  "Unexpected penguin in sector 7.",
  "You unlocked debug chaos mode.",
  "The cloud became weather.",
  "VM refused to be virtual today."
];

const matrixGlyphs = "01アイウエオカキクケコサシスセソABCDEFGHIJKLMNOPQRSTUVWXYZ$#%*";
const glitchSnippets = [
  "sudo init chaos --force",
  "injecting visual corruption layer...",
  "allocating infinite panic buffer",
  "/dev/universe: write failed",
  "vm_fabric: segmentation of reality detected",
  "recoverable? false"
];

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function viewerUrl(ip?: string, osType?: VmSummary["osType"]): string {
  if (!ip) {
    return "";
  }

  const isPublicIp = !/^10\.|^172\.(1[6-9]|2\d|3[0-1])\.|^192\.168\./.test(ip);
  if (!isPublicIp) {
    return "";
  }

  if (osType === "linux") {
    const sslipHost = `${ip.replace(/\./g, "-")}.sslip.io`;
    return `https://${sslipHost}/guacamole/`;
  }

  return `http://${ip}:6080/vnc.html?autoconnect=true&resize=remote`;
}

function formatRemainingTime(expiresAtIso: string, nowMs: number) {
  const expiresAtMs = new Date(expiresAtIso).getTime();
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function normalizeVmPayload(payload: VmApiPayload): VmSummary[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
}

function canonicalVmName(value: string) {
  return value.trim().toLowerCase();
}

function sanitizeVmName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function dedupeVmsByName(items: VmSummary[]) {
  const seen = new Set<string>();
  const deduped: VmSummary[] = [];

  for (const item of items) {
    const key = canonicalVmName(item.name);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeCatalogPayload(payload: CatalogApiPayload): VmCatalog {
  const rawImages = (Array.isArray(payload?.images) ? payload.images : []) as Array<{
    key?: string;
    id?: string;
    label?: string;
    osType?: "windows" | "linux";
  }>;

  const images = rawImages.map((image) => ({
    key: image.key ?? image.id ?? "",
    label: image.label ?? image.key ?? image.id ?? "Unnamed image",
    osType: image.osType ?? "linux"
  }));

  const rawTopics = Array.isArray(payload?.topics) ? payload.topics : [];
  const topics = rawTopics.length
    ? rawTopics
    : [
        {
          id: "azure",
          label: "Azure",
          type: "azure" as const,
          allowCustomCredentials: true,
          images: images.map((image) => ({
            id: image.key,
            label: image.label,
            osType: image.osType,
            sourceMode: "marketplace" as const,
            imageId: image.key
          }))
        }
      ];

  return {
    images: images.filter((image) => image.key.length > 0),
    topics,
    vmSizes: [lowCostVmSize]
  };
}

export function VmDashboard() {
  const [catalog, setCatalog] = useState<VmCatalog | null>(null);
  const [vms, setVms] = useState<VmSummary[]>([]);
  const [orderedNames, setOrderedNames] = useState<string[]>([]);
  const [activeVmName, setActiveVmName] = useState<string | null>(null);
  const [secondaryVmName, setSecondaryVmName] = useState<string | null>(null);
  const [splitView, setSplitView] = useState(false);
  const [selectedImagePreview, setSelectedImagePreview] = useState("");
  const [creatingCount, setCreatingCount] = useState(0);
  const [pendingCreations, setPendingCreations] = useState<VmSummary[]>([]);
  const [showCreatePanel, setShowCreatePanel] = useState(true);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [draggedVm, setDraggedVm] = useState<string | null>(null);
  const [clipboardText, setClipboardText] = useState("");
  const [chaosMode, setChaosMode] = useState<ChaosMode>("none");
  const [voidPhase, setVoidPhase] = useState<VoidPhase>("sucking");
  const [chaosAlerts, setChaosAlerts] = useState<ChaosAlert[]>([]);
  const [penguins, setPenguins] = useState<PenguinDrop[]>([]);
  const [matrixChars, setMatrixChars] = useState<MatrixChar[]>([]);
  const [glitchLines, setGlitchLines] = useState<GlitchLine[]>([]);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [viewerStatusByVm, setViewerStatusByVm] = useState<Record<string, ViewerStatus>>({});
  const [viewerUrlByVm, setViewerUrlByVm] = useState<Record<string, string>>({});
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [catalogFetchedAt, setCatalogFetchedAt] = useState(0);

  const visibleVms = useMemo(() => {
    if (pendingCreations.length === 0) {
      return dedupeVmsByName(vms);
    }

    const existing = new Set(vms.map((vm) => canonicalVmName(vm.name)));
    const optimistic = pendingCreations.filter((vm) => !existing.has(canonicalVmName(vm.name)));
    return dedupeVmsByName([...optimistic, ...vms]);
  }, [pendingCreations, vms]);

  const orderedVms = useMemo(() => {
    if (orderedNames.length === 0) {
      return visibleVms;
    }

    const vmMap = new Map(visibleVms.map((vm) => [vm.name, vm]));
    const ordered: VmSummary[] = [];

    orderedNames.forEach((name) => {
      const vm = vmMap.get(name);
      if (vm) {
        ordered.push(vm);
        vmMap.delete(name);
      }
    });

    vmMap.forEach((vm) => ordered.push(vm));
    return ordered;
  }, [orderedNames, visibleVms]);

  const activeVm = orderedVms.find((vm) => vm.name === activeVmName) ?? orderedVms[0] ?? null;
  const secondaryVm =
    splitView && secondaryVmName
      ? orderedVms.find((vm) => vm.name === secondaryVmName) ?? null
      : null;

  useEffect(() => {
    const savedOrder = localStorage.getItem(dragStorageKey);
    if (savedOrder) {
      try {
        const parsed: string[] = JSON.parse(savedOrder);
        setOrderedNames(parsed);
      } catch {
        localStorage.removeItem(dragStorageKey);
      }
    }
  }, []);

  useEffect(() => {
    const targetVms = (splitView ? [activeVm, secondaryVm] : [activeVm]).filter(
      (vm): vm is VmSummary => Boolean(vm && vm.publicIp && vm.status === "running")
    );

    if (targetVms.length === 0) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      await Promise.all(
        targetVms.map(async (vm) => {
          try {
            const response = await fetch(`/api/orchestrator/vms/${vm.name}/viewer-status?t=${Date.now()}`, {
              cache: "no-store"
            });

            if (!response.ok) {
              return;
            }

            const status = (await response.json()) as ViewerStatus;
            if (cancelled) {
              return;
            }

            setViewerStatusByVm((current) => ({
              ...current,
              [canonicalVmName(vm.name)]: status
            }));

            if (status.ready && status.viewerUrl) {
              const key = canonicalVmName(vm.name);
              setViewerUrlByVm((current) => {
                if (current[key]) {
                  return current;
                }
                return {
                  ...current,
                  [key]: status.viewerUrl ?? ""
                };
              });
            }
          } catch {
            if (cancelled) {
              return;
            }
            setViewerStatusByVm((current) => ({
              ...current,
              [canonicalVmName(vm.name)]: {
                ready: false,
                progress: 20,
                phase: "checking",
                message: "Checking viewer services...",
                osType: vm.osType
              }
            }));
          }
        })
      );
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeVm, secondaryVm, splitView]);

  useEffect(() => {
    if (orderedNames.length > 0) {
      localStorage.setItem(dragStorageKey, JSON.stringify(orderedNames));
    }
  }, [orderedNames]);

  useEffect(() => {
    const topic = (catalog?.topics ?? []).find((entry) => entry.id === form.topicId);
    if (topic?.images.length) {
      const selectedImage = topic.images.find((image) => image.id === form.image);
      setSelectedImagePreview(selectedImage?.label ?? "");
      return;
    }

    if (catalog?.images.length) {
      const selectedImage = catalog.images.find((image) => image.key === form.image);
      setSelectedImagePreview(selectedImage?.label ?? "");
    }
  }, [catalog, form.image, form.topicId]);

  useEffect(() => {
    if (!catalog?.topics?.length) {
      return;
    }

    const topic = catalog.topics.find((entry) => entry.id === form.topicId) ?? catalog.topics[0];
    if (!topic) {
      return;
    }

    const hasImage = topic.images.some((image) => image.id === form.image);
    const nextImage = hasImage ? form.image : topic.images[0]?.id ?? "";

    setForm((current) => {
      const next = { ...current };
      let changed = false;
      if (current.topicId !== topic.id) {
        next.topicId = topic.id;
        changed = true;
      }
      if (nextImage && current.image !== nextImage) {
        next.image = nextImage;
        changed = true;
      }
      if (topic.type === "custom") {
        const image = topic.images.find((entry) => entry.id === (nextImage || current.image));
        const nextUsername = image?.fixedUsername ?? current.username;
        const nextPassword = image?.fixedPassword ?? current.password;
        if (next.username !== nextUsername) {
          next.username = nextUsername;
          changed = true;
        }
        if (next.password !== nextPassword) {
          next.password = nextPassword;
          changed = true;
        }
        if (next.name !== "") {
          next.name = "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [catalog, form.topicId, form.image]);

  useEffect(() => {
    if (!activeVmName && orderedVms[0]) {
      setActiveVmName(orderedVms[0].name);
    }

    if (
      activeVmName &&
      orderedVms.length > 0 &&
      !orderedVms.some((vm) => vm.name === activeVmName)
    ) {
      setActiveVmName(orderedVms[0]?.name ?? null);
    }

    if (
      secondaryVmName &&
      orderedVms.length > 0 &&
      !orderedVms.some((vm) => vm.name === secondaryVmName)
    ) {
      setSecondaryVmName(null);
    }
  }, [activeVmName, orderedVms, secondaryVmName]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadState(false);
    }, 10000);

    void loadState(true);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (chaosMode !== "void") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r") {
        restoreUniverse();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chaosMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  async function loadState(initial: boolean) {
    if (!initial) {
      setRefreshing(true);
    }

    try {
      const shouldRefreshCatalog =
        initial || !catalog || Date.now() - catalogFetchedAt > 60_000;

      const vmRes = await fetch(`/api/orchestrator/vms?t=${Date.now()}`, { cache: "no-store" });
      if (!vmRes.ok) {
        throw new Error("Could not load data.");
      }
      const vmData = normalizeVmPayload((await vmRes.json()) as VmApiPayload);

      const dedupedVmData = dedupeVmsByName(vmData);
      setVms(dedupedVmData);
      setViewerStatusByVm((current) => {
        const next: Record<string, ViewerStatus> = {};
        dedupedVmData.forEach((vm) => {
          const key = canonicalVmName(vm.name);
          if (current[key]) {
            next[key] = current[key];
          }
        });
        return next;
      });
      setViewerUrlByVm((current) => {
        const next: Record<string, string> = {};
        dedupedVmData.forEach((vm) => {
          const key = canonicalVmName(vm.name);
          if (current[key]) {
            next[key] = current[key];
          }
        });
        return next;
      });
      setPendingCreations((current) =>
        current.filter(
          (pending) => !dedupedVmData.some((vm) => canonicalVmName(vm.name) === canonicalVmName(pending.name))
        )
      );

      if (initial && dedupedVmData.length > 0 && !activeVmName) {
        setActiveVmName(dedupedVmData[0].name);
      }

      if (initial && orderedNames.length === 0) {
        setOrderedNames(dedupedVmData.map((vm) => vm.name));
      }

      if (shouldRefreshCatalog) {
        const catalogRes = await fetch(`/api/orchestrator/catalog?t=${Date.now()}`, { cache: "no-store" });
        if (catalogRes.ok) {
          const catalogData = normalizeCatalogPayload((await catalogRes.json()) as CatalogApiPayload);
          setCatalog(catalogData);
          setCatalogFetchedAt(Date.now());
        }
      }

      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      if (!initial) {
        setRefreshing(false);
      }
    }
  }

  async function createVm(event: FormEvent) {
    event.preventDefault();
    setCreatingCount((current) => current + 1);
    setFeedback(null);
    setError(null);

    const topic = (catalog?.topics ?? []).find((entry) => entry.id === form.topicId) ?? null;
    const isAzureTopic = (topic?.type ?? "azure") === "azure";

    if (isAzureTopic && !form.name.trim()) {
      setError("VM name is required for Azure.");
      setCreatingCount((current) => Math.max(0, current - 1));
      return;
    }

    if (!form.image) {
      setError("Please select an image.");
      setCreatingCount((current) => Math.max(0, current - 1));
      return;
    }

    const generatedName = `${form.topicId || "vm"}-${Date.now().toString().slice(-6)}`;
    const requestedName = isAzureTopic ? form.name : generatedName;
    const sanitizedName = sanitizeVmName(requestedName);
    const optimisticName = sanitizedName.length > 0 ? sanitizedName : requestedName.trim();
    const selectedTopicImage = topic?.images.find((image) => image.id === form.image);
    const effectiveUsername =
      topic?.type === "custom" ? selectedTopicImage?.fixedUsername ?? form.username : form.username;
    const effectivePassword =
      topic?.type === "custom" ? selectedTopicImage?.fixedPassword ?? form.password : form.password;

    const optimisticVm: VmSummary = {
      name: optimisticName,
      osType: selectedTopicImage?.osType ?? (form.image.includes("win") ? "windows" : "linux"),
      image: form.image,
      topicId: form.topicId,
      vmSize: lowCostVmSize,
      username: effectiveUsername,
      password: topic?.type === "custom" ? effectivePassword : "",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: "creating",
      publicIp: ""
    };

    setPendingCreations((current) => {
      if (current.some((vm) => vm.name === optimisticVm.name)) {
        return current;
      }
      return [optimisticVm, ...current];
    });
    setViewerStatusByVm((current) => ({
      ...current,
      [canonicalVmName(optimisticName)]: {
        ready: false,
        progress: 8,
        phase: "creating",
        message: "Allocating VM and network...",
        osType: optimisticVm.osType
      }
    }));
    setViewerUrlByVm((current) => {
      const next = { ...current };
      delete next[canonicalVmName(optimisticName)];
      return next;
    });

    try {
      const response = await fetch("/api/orchestrator/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: isAzureTopic ? optimisticName : undefined,
          topicId: form.topicId,
          image: form.image,
          vmSize: lowCostVmSize,
          username: isAzureTopic ? form.username : undefined,
          password: isAzureTopic ? form.password || undefined : undefined
        })
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to create VM.");
      }

      setForm((current) => ({
        ...initialForm,
        topicId: current.topicId,
        image: (catalog?.topics ?? []).find((entry) => entry.id === current.topicId)?.images[0]?.id ?? initialForm.image
      }));
      setFeedback("VM creation started. You can already queue another VM now.");
      await loadState(false);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreatingCount((current) => Math.max(0, current - 1));
    }
  }

  function downloadRdpFile(vm: VmSummary) {
    if (!vm.publicIp) {
      setError("Public IP is not ready yet.");
      return;
    }

    const content = [
      "screen mode id:i:2",
      "use multimon:i:0",
      "desktopwidth:i:1920",
      "desktopheight:i:1080",
      "session bpp:i:32",
      `full address:s:${vm.publicIp}:3389`,
      `username:s:${vm.username}`
    ].join("\r\n");

    const blob = new Blob([content], { type: "application/x-rdp" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${vm.name}.rdp`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handleTransferDrop(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setDroppedFiles((current) => [...current, ...Array.from(files)]);
    setFeedback(`${files.length} file(s) added to transfer staging.`);
  }

  async function uploadFilesToVm(vm: VmSummary) {
    if (droppedFiles.length === 0) {
      setError("Please select at least one file first.");
      return;
    }

    setUploadingFiles(true);
    setError(null);
    setFeedback(null);

    try {
      for (const file of droppedFiles) {
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const value = typeof reader.result === "string" ? reader.result : "";
            const marker = "base64,";
            const idx = value.indexOf(marker);
            if (idx === -1) {
              reject(new Error(`Failed to encode ${file.name}`));
              return;
            }
            resolve(value.slice(idx + marker.length));
          };
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        });

        const response = await fetch(`/api/orchestrator/vms/${vm.name}/files`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileName: file.name,
            contentBase64
          })
        });

        if (!response.ok) {
          const details = await response.json().catch(() => ({}));
          throw new Error(details.error ?? `Upload failed for ${file.name}`);
        }
      }

      setFeedback(`Uploaded ${droppedFiles.length} file(s) to ${vm.name} Downloads folder.`);
      setDroppedFiles([]);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingFiles(false);
    }
  }

  async function invokeVmAction(vmName: string, action: "start" | "stop" | "delete" | "extend") {
    const actionToken = `${vmName}:${action}`;
    setPendingActions((current) => {
      const next = new Set(current);
      next.add(actionToken);
      return next;
    });
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch(`/api/orchestrator/vms/${vmName}/${action}`, {
        method: "POST"
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? `Action ${action} failed.`);
      }

      if (action === "delete") {
        setVms((current) => current.filter((vm) => canonicalVmName(vm.name) !== canonicalVmName(vmName)));
        setPendingCreations((current) =>
          current.filter((vm) => canonicalVmName(vm.name) !== canonicalVmName(vmName))
        );
        setViewerStatusByVm((current) => {
          const next = { ...current };
          delete next[canonicalVmName(vmName)];
          return next;
        });
        setViewerUrlByVm((current) => {
          const next = { ...current };
          delete next[canonicalVmName(vmName)];
          return next;
        });
        setOrderedNames((current) => current.filter((name) => canonicalVmName(name) !== canonicalVmName(vmName)));
        setActiveVmName((current) => {
          if (current && canonicalVmName(current) !== canonicalVmName(vmName)) {
            return current;
          }
          const next = orderedVms.find((vm) => canonicalVmName(vm.name) !== canonicalVmName(vmName));
          return next?.name ?? null;
        });
        setSecondaryVmName((current) =>
          current && canonicalVmName(current) === canonicalVmName(vmName) ? null : current
        );
        setFeedback(`VM ${vmName} terminated.`);
        void loadState(false);
        return;
      }

      setFeedback(`Action ${action} started for ${vmName}.`);
      await loadState(false);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionToken);
        return next;
      });
    }
  }

  function handleDragStart(vmName: string) {
    setDraggedVm(vmName);
  }

  function handleDrop(vmName: string) {
    if (!draggedVm || draggedVm === vmName) {
      setDraggedVm(null);
      return;
    }

    const names = orderedVms.map((vm) => vm.name);
    const draggedIndex = names.indexOf(draggedVm);
    const targetIndex = names.indexOf(vmName);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedVm(null);
      return;
    }

    names.splice(draggedIndex, 1);
    names.splice(targetIndex, 0, draggedVm);
    setOrderedNames(names);
    setDraggedVm(null);
  }

  function triggerChaos() {
    const mode = randomFrom<Exclude<ChaosMode, "none">>([
      "errors",
      "void",
      "penguins",
      "rickroll",
      "matrix",
      "glitchrain"
    ]);

    setChaosMode(mode);

    if (mode === "errors") {
      setChaosAlerts([
        {
          id: Date.now(),
          top: 14,
          left: 20,
          message: randomFrom(errorMessages)
        }
      ]);
      return;
    }

    if (mode === "void") {
      setVoidPhase("sucking");
      setTimeout(() => setVoidPhase("dark"), 3200);
      return;
    }

    if (mode === "penguins") {
      const drops = Array.from({ length: 48 }, (_, idx) => ({
        id: idx,
        left: Math.random() * 92,
        duration: 1.8 + Math.random() * 2.8,
        delay: Math.random() * 2.1,
        size: 20 + Math.random() * 36
      }));
      setPenguins(shuffle(drops));
      return;
    }

    if (mode === "matrix") {
      const rain = Array.from({ length: 140 }, (_, idx) => ({
        id: idx,
        left: Math.random() * 100,
        duration: 1.8 + Math.random() * 3.2,
        delay: Math.random() * 2.6,
        content: matrixGlyphs[Math.floor(Math.random() * matrixGlyphs.length)]
      }));
      setMatrixChars(rain);
      return;
    }

    if (mode === "glitchrain") {
      const lines = Array.from({ length: 28 }, (_, idx) => ({
        id: idx,
        text: randomFrom(glitchSnippets),
        delay: idx * 0.09
      }));
      setGlitchLines(lines);
      return;
    }
  }

  function closeChaosAlert(id: number) {
    setChaosAlerts((current) => {
      const remaining = current.filter((alert) => alert.id !== id);
      if (remaining.length >= 12) {
        return remaining;
      }

      const spawned = Array.from({ length: 2 }, (_, idx) => ({
        id: Date.now() + idx + Math.floor(Math.random() * 5000),
        top: Math.floor(8 + Math.random() * 70),
        left: Math.floor(3 + Math.random() * 75),
        message: randomFrom(errorMessages)
      }));

      return [...remaining, ...spawned];
    });
  }

  function restoreUniverse() {
    setChaosMode("none");
    setVoidPhase("sucking");
    setChaosAlerts([]);
    setPenguins([]);
    setMatrixChars([]);
    setGlitchLines([]);
  }

  const topics = catalog?.topics ?? [];
  const selectedTopic = topics.find((topic) => topic.id === form.topicId) ?? topics[0] ?? null;
  const imageOptions =
    selectedTopic?.images.map((image) => ({
      key: image.id,
      label: image.label,
      osType: image.osType
    })) ??
    catalog?.images ?? [];
  const vmSizeOptions = catalog?.vmSizes ?? [lowCostVmSize];
  const viewerConnected = Boolean(activeVm?.publicIp && activeVm.status === "running");

  return (
    <div className="pm-shell">
      <header className="pm-topbar">
        <div>
          <h1>Azure VM Deck</h1>
          <p>Simple Control Panel • Drag & Drop links • Live VM actions</p>
        </div>
        <div className="pm-top-actions">
          <button className="btn btn-ghost" onClick={() => void loadState(false)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <a className="btn btn-ghost" href="/images">
            Image Menu
          </a>
          <button className="btn btn-chaos" onClick={triggerChaos}>
            CHAOS v3
          </button>
          {chaosMode !== "none" ? (
            <button className="btn btn-ghost" onClick={restoreUniverse}>
              Restore
            </button>
          ) : null}
        </div>
      </header>

      <main className="pm-grid">
        <aside className="pm-sidebar">
          <section className="pm-card">
            <div className="pm-panel-headline">
              <h2>Add New VM</h2>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setShowCreatePanel((current) => !current)}
              >
                {showCreatePanel ? "Hide" : "Show"}
              </button>
            </div>
            {showCreatePanel ? (
              <form className="pm-form" onSubmit={createVm}>
              <label>
                Bereich
                <select
                  value={form.topicId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      topicId: event.target.value
                    }))
                  }
                >
                  {(catalog?.topics ?? []).map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTopic?.type === "azure" ? (
              <label>
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="dev-win-01"
                  pattern="[a-zA-Z0-9-]{3,24}"
                />
              </label>
              ) : (
                <label>
                  Aufgabe/Template
                  <input value={selectedTopic?.label ?? "Custom"} readOnly />
                </label>
              )}

              <label>
                {selectedTopic?.type === "azure" ? "OS Image" : "Hinterlegte VM"}
                <select
                  value={form.image}
                  onChange={(event) => setForm((current) => ({ ...current, image: event.target.value }))}
                >
                  {imageOptions.map((image) => (
                    <option key={image.key} value={image.key}>
                      {image.label}
                    </option>
                  ))}
                </select>
                {selectedImagePreview ? <small>{selectedImagePreview}</small> : null}
              </label>

              {selectedTopic?.type === "azure" ? (
                <label>
                  VM Size (fixed low-cost)
                  <input value={vmSizeOptions[0] ?? lowCostVmSize} readOnly />
                </label>
              ) : null}

              {selectedTopic?.type === "azure" ? (
                <>
                  <label>
                    Username
                    <input
                      required
                      value={form.username}
                      onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    />
                  </label>

                  <label>
                    Password (Windows oder optional Linux)
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Vorgegebenes Username
                    <input value={form.username || "(auto)"} readOnly />
                  </label>
                  <label>
                    Vorgegebenes Password
                    <input value={form.password || "(auto)"} readOnly />
                  </label>
                </>
              )}

              <button className="btn btn-primary" type="submit" disabled={!catalog}>
                {creatingCount > 0
                  ? `Create VM (${creatingCount} in progress)`
                  : selectedTopic?.type === "azure"
                    ? "Create VM"
                    : "Start Aufgabe-VM"}
              </button>
              </form>
            ) : (
              <p className="pm-muted">The form is collapsed. Click "Show" to create a VM.</p>
            )}
          </section>

          <section className="pm-card pm-card-fill">
            <h2>Active VMs</h2>
            <p className="pm-help">Drag to reorder.</p>

            <div className="pm-vm-list">
              {orderedVms.length === 0 ? <p className="pm-muted">No VMs yet.</p> : null}
              {orderedVms.map((vm) => {
                const isActive = vm.name === activeVm?.name;
                return (
                  <button
                    key={vm.name}
                    className={`pm-vm-item ${isActive ? "active" : ""}`}
                    onClick={() => setActiveVmName(vm.name)}
                    draggable
                    onDragStart={() => handleDragStart(vm.name)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(vm.name)}
                  >
                    <span className="pm-dot" data-status={vm.status} />
                    <span className="pm-vm-main">{vm.name}</span>
                    <span className="pm-vm-meta">
                      {vm.osType.toUpperCase()} • {(vm.topicId ?? "azure").toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="pm-main">
          <div className="pm-card">
            <div className="pm-main-head">
              <h2>{activeVm ? `VM: ${activeVm.name}` : "Select a VM"}</h2>
              {activeVm ? (
                <div className="pm-actions">
                  <button
                    className="btn btn-ghost"
                    disabled={pendingActions.has(`${activeVm.name}:start`)}
                    onClick={() => void invokeVmAction(activeVm.name, "start")}
                  >
                    Resume
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={pendingActions.has(`${activeVm.name}:stop`)}
                    onClick={() => void invokeVmAction(activeVm.name, "stop")}
                  >
                    Pause
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={pendingActions.has(`${activeVm.name}:extend`)}
                    onClick={() => void invokeVmAction(activeVm.name, "extend")}
                  >
                    Extend +2h
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={pendingActions.has(`${activeVm.name}:delete`)}
                    onClick={() => void invokeVmAction(activeVm.name, "delete")}
                  >
                    Terminate
                  </button>
                </div>
              ) : null}
            </div>

            {activeVm ? (
              <div className="pm-vm-details pm-vm-details-cool">
                <span className="pm-chip">Status: {activeVm.status === "creating" ? "creating" : activeVm.status}</span>
                <span className="pm-chip">Bereich: {(activeVm.topicId ?? "azure").toUpperCase()}</span>
                <span className="pm-chip">Image: {activeVm.image}</span>
                <span className="pm-chip">IP: {activeVm.publicIp ?? "pending"}</span>
                <span className="pm-chip">Username: {activeVm.username || "(pending)"}</span>
                {activeVm.password ? <span className="pm-chip">Password: {activeVm.password}</span> : null}
                <span className="pm-chip">Shutdown: {new Date(activeVm.expiresAt).toLocaleTimeString()}</span>
                <span className="pm-chip pm-chip-accent">Time left: {formatRemainingTime(activeVm.expiresAt, nowMs)}</span>
              </div>
            ) : (
              <p className="pm-muted">Create or select a VM to see details.</p>
            )}
          </div>

          {activeVm ? <div className={`pm-card pm-viewer-card ${viewerConnected ? "connected" : ""}`}>
            <div className="pm-viewer-head">
              <h2>Viewer</h2>
              <div className="pm-viewer-actions">
                <button className="btn btn-ghost" onClick={() => setSplitView((current) => !current)}>
                  {splitView ? "Single" : "Split"}
                </button>
              </div>
            </div>

            {splitView && activeVm ? (
              <div className="pm-split-selector">
                <label>
                  Second VM
                  <select
                    value={secondaryVmName ?? ""}
                    onChange={(event) => setSecondaryVmName(event.target.value || null)}
                  >
                    <option value="">None</option>
                    {orderedVms
                      .filter((vm) => vm.name !== activeVm.name)
                      .map((vm) => (
                        <option key={vm.name} value={vm.name}>
                          {vm.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            ) : null}

            <div className={splitView ? "pm-viewer-split" : "pm-viewer-single"}>
              {(splitView ? [activeVm, secondaryVm] : [activeVm]).map((vm, index) => {
                if (!vm) {
                  return null;
                }

                const key = canonicalVmName(vm.name);
                const viewerStatus = viewerStatusByVm[key];
                const stableViewerUrl = viewerUrlByVm[key];
                const url = stableViewerUrl || viewerStatus?.viewerUrl || viewerUrl(vm.publicIp, vm.osType);
                const viewerReady = Boolean(viewerStatus?.ready);
                const progress = vm.status === "creating" ? 12 : Math.max(12, Math.min(100, viewerStatus?.progress ?? 22));
                const progressText = viewerStatus?.message ?? "Preparing viewer services...";

                return (
                  <div className="pm-viewer-instance" key={vm.name + index}>
                    <div className="pm-viewer-instance-head">
                      <span>{vm.name}</span>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="pm-open-link">
                          Open viewer in new tab
                        </a>
                      ) : null}
                    </div>
                    {!vm.publicIp || vm.status === "creating" ? (
                      <div className="pm-loading-box">
                        <div className="pm-spinner" />
                        <p className="pm-muted">VM is provisioning. Viewer will open automatically once ready.</p>
                        <div className="pm-progress-wrap">
                          <div className="pm-progress-bar" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="pm-muted">{progress}% • {progressText}</p>
                      </div>
                    ) : vm.osType === "windows" ? (
                      <div className="pm-remote-box">
                        {!viewerReady ? (
                          <>
                            <div className="pm-spinner" />
                            <p className="pm-muted">Preparing Windows viewer session...</p>
                            <div className="pm-progress-wrap">
                              <div className="pm-progress-bar" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="pm-muted">{progress}% • {progressText}</p>
                            <p className="pm-remote-line">RDP fallback: {vm.publicIp ? `${vm.publicIp}:3389` : "private"}</p>
                          </>
                        ) : (
                          <iframe
                            title={`viewer-${vm.name}`}
                            src={url}
                            allow="fullscreen; clipboard-read; clipboard-write; autoplay"
                            tabIndex={0}
                            onLoad={(event) => {
                              try {
                                (event.currentTarget as HTMLIFrameElement).focus();
                              } catch {
                                // ignore focus errors
                              }
                            }}
                            allowFullScreen
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        {!viewerReady ? (
                          <div className="pm-loading-box">
                            <div className="pm-spinner" />
                            <p className="pm-muted">Linux uses RDP Web Gateway (Guacamole).</p>
                            <p className="pm-remote-line">Preparing automatic session login...</p>
                            <div className="pm-progress-wrap">
                              <div className="pm-progress-bar" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="pm-muted">{progress}% • {progressText}</p>
                          </div>
                        ) : (
                          <iframe
                            title={`viewer-${vm.name}`}
                            src={url}
                            allow="fullscreen; clipboard-read; clipboard-write; autoplay"
                            tabIndex={0}
                            onLoad={(event) => {
                              try {
                                (event.currentTarget as HTMLIFrameElement).focus();
                              } catch {
                                // ignore focus errors
                              }
                            }}
                            allowFullScreen
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pm-clipboard-panel">
              <h3>Viewer Transfer Tools</h3>
              <p className="pm-help">
                Drag files into staging, then use RDP drive sharing (Windows) or SCP/SSH (Linux) for transfer.
              </p>
              <div
                className="pm-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleTransferDrop(event.dataTransfer.files);
                }}
              >
                <p>Drop files here for transfer staging</p>
                <label className="pm-upload-btn">
                  Select files
                  <input
                    type="file"
                    multiple
                    onChange={(event) => handleTransferDrop(event.target.files)}
                  />
                </label>
              </div>
              {droppedFiles.length > 0 ? (
                <div className="pm-file-list">
                  {droppedFiles.map((file, index) => (
                    <p key={`${file.name}-${index}`}>{file.name}</p>
                  ))}
                  {activeVm ? (
                    <button
                      className="btn btn-primary"
                      disabled={uploadingFiles}
                      onClick={() => void uploadFilesToVm(activeVm)}
                    >
                      {uploadingFiles ? "Sending..." : "Send files to VM Downloads"}
                    </button>
                  ) : null}
                  <button className="btn btn-ghost" onClick={() => setDroppedFiles([])}>
                    Clear staged files
                  </button>
                </div>
              ) : null}
              <textarea
                value={clipboardText}
                onChange={(event) => setClipboardText(event.target.value)}
                placeholder="Prepare text here, then paste it in the VM viewer with Ctrl/Cmd+V."
              />
              <div className="pm-clipboard-actions">
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setClipboardText(text);
                    } catch {
                      setError("Clipboard read is not allowed by the browser.");
                    }
                  }}
                >
                  Paste
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(clipboardText);
                      setFeedback("Text copied to your local clipboard.");
                    } catch {
                      setError("Clipboard write is not allowed by the browser.");
                    }
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          </div> : null}

          {feedback ? <p className="pm-feedback">{feedback}</p> : null}
          {error ? <p className="pm-error">{error}</p> : null}
        </section>
      </main>

      {chaosMode === "errors" ? (
        <div className="pm-chaos-overlay">
          {chaosAlerts.map((alert) => (
            <div
              key={alert.id}
              className="pm-chaos-alert"
              style={{ top: `${alert.top}%`, left: `${alert.left}%` }}
            >
              <p>💥 {alert.message}</p>
              <button onClick={() => closeChaosAlert(alert.id)}>Close</button>
            </div>
          ))}
        </div>
      ) : null}

      {chaosMode === "void" ? (
        <div className={`pm-void-overlay ${voidPhase === "dark" ? "dark" : ""}`}>
          {voidPhase === "sucking" ? (
            <>
              <div className="pm-black-hole" />
              <p className="pm-void-text">Gravity spike detected. Hold on...</p>
            </>
          ) : (
            <div className="pm-void-end">
              <h2>Oops. The universe was garbage-collected.</h2>
              <p>Press R to restore reality.</p>
              <button className="btn btn-primary" onClick={restoreUniverse}>
                Restore universe
              </button>
            </div>
          )}
        </div>
      ) : null}

      {chaosMode === "penguins" ? (
        <div className="pm-penguin-overlay">
          {penguins.map((penguin) => (
            <span
              key={penguin.id}
              className="pm-penguin"
              style={{
                left: `${penguin.left}%`,
                animationDuration: `${penguin.duration}s`,
                animationDelay: `${penguin.delay}s`,
                fontSize: `${penguin.size}px`
              }}
            >
              🐧
            </span>
          ))}
          <p className="pm-penguin-caption">Penguin patch deployed successfully.</p>
        </div>
      ) : null}

      {chaosMode === "rickroll" ? (
        <div className="pm-rickroll-overlay">
          <div className="pm-rickroll-card">
            <div className="pm-rickroll-head">
              <h3>Emergency stream injection</h3>
              <button onClick={restoreUniverse}>Stop chaos</button>
            </div>
            <iframe
              title="rickroll"
              src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=0"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      ) : null}

      {chaosMode === "matrix" ? (
        <div className="pm-matrix-overlay">
          {matrixChars.map((char) => (
            <span
              key={char.id}
              className="pm-matrix-char"
              style={{
                left: `${char.left}%`,
                animationDuration: `${char.duration}s`,
                animationDelay: `${char.delay}s`
              }}
            >
              {char.content}
            </span>
          ))}
          <div className="pm-matrix-message">
            <h3>Matrix takeover complete.</h3>
            <p>Reality is now running in read-only mode.</p>
            <button className="btn btn-ghost" onClick={restoreUniverse}>
              Exit matrix
            </button>
          </div>
        </div>
      ) : null}

      {chaosMode === "glitchrain" ? (
        <div className="pm-glitch-overlay">
          <div className="pm-glitch-static" />
          <div className="pm-terminal-card">
            <h3>terminal rain / corruption feed</h3>
            <div className="pm-terminal-lines">
              {glitchLines.map((line) => (
                <p
                  key={line.id}
                  style={{ animationDelay: `${line.delay}s` }}
                >{`> ${line.text}`}</p>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={restoreUniverse}>
              Reboot visuals
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
