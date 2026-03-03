"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

type VmSummary = {
  name: string;
  osType: "windows" | "linux";
  image: string;
  vmSize: string;
  username: string;
  expiresAt: string;
  status: "running" | "deallocated" | "creating" | "failed";
  publicIp?: string;
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
  vmSizes: string[];
};

type ViewerVm = {
  name: string;
  url: string;
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
      vmSizes?: string[];
    };

const initialForm = {
  name: "",
  image: "ubuntu2204",
  vmSize: "Standard_B2s",
  username: "azureuser",
  password: "",
  publicKey: ""
};

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
  const defaultPort = osType === "windows" ? "6080" : "6080";
  return `https://${ip}:${defaultPort}/vnc.html?autoconnect=true&resize=remote`;
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

  return {
    images: images.filter((image) => image.key.length > 0),
    vmSizes:
      Array.isArray(payload?.vmSizes) && payload.vmSizes.length > 0
        ? payload.vmSizes
        : ["Standard_B2s", "Standard_B2ms", "Standard_D2s_v5"]
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
  const [creating, setCreating] = useState(false);
  const [showCreatePanel, setShowCreatePanel] = useState(true);
  const [updatingVm, setUpdatingVm] = useState<string | null>(null);
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

  const orderedVms = useMemo(() => {
    if (orderedNames.length === 0) {
      return vms;
    }

    const vmMap = new Map(vms.map((vm) => [vm.name, vm]));
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
  }, [orderedNames, vms]);

  const activeVm = orderedVms.find((vm) => vm.name === activeVmName) ?? orderedVms[0] ?? null;
  const secondaryVm =
    splitView && secondaryVmName
      ? orderedVms.find((vm) => vm.name === secondaryVmName) ?? null
      : null;

  const openViewerVms: ViewerVm[] = [activeVm, secondaryVm]
    .filter((vm): vm is VmSummary => Boolean(vm && vm.publicIp))
    .map((vm) => ({
      name: vm.name,
      url: viewerUrl(vm.publicIp, vm.osType)
    }));

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
    if (orderedNames.length > 0) {
      localStorage.setItem(dragStorageKey, JSON.stringify(orderedNames));
    }
  }, [orderedNames]);

  useEffect(() => {
    if (catalog?.images.length) {
      const selectedImage = catalog.images.find((image) => image.key === form.image);
      setSelectedImagePreview(selectedImage?.label ?? "");
    }
  }, [catalog, form.image]);

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

  async function loadState(initial: boolean) {
    try {
      const [catalogRes, vmRes] = await Promise.all([
        fetch("/api/orchestrator/catalog"),
        fetch("/api/orchestrator/vms")
      ]);

      if (!catalogRes.ok || !vmRes.ok) {
        throw new Error("Could not load data.");
      }

      const catalogData = normalizeCatalogPayload((await catalogRes.json()) as CatalogApiPayload);
      const vmData = normalizeVmPayload((await vmRes.json()) as VmApiPayload);

      setCatalog(catalogData);
      setVms(vmData);

      if (initial && vmData.length > 0 && !activeVmName) {
        setActiveVmName(vmData[0].name);
      }

      if (initial && orderedNames.length === 0) {
        setOrderedNames(vmData.map((vm) => vm.name));
      }

      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  async function createVm(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/orchestrator/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: form.name,
          image: form.image,
          vmSize: form.vmSize,
          username: form.username,
          password: form.password || undefined,
          publicKey: form.publicKey || undefined
        })
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to create VM.");
      }

      setForm(initialForm);
      setFeedback("VM creation started. The list will refresh automatically.");
      await loadState(false);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function invokeVmAction(vmName: string, action: "start" | "stop" | "delete" | "extend") {
    setUpdatingVm(vmName + action);
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

      setFeedback(`Action ${action} started for ${vmName}.`);
      await loadState(false);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setUpdatingVm(null);
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

  const imageOptions = catalog?.images ?? [];
  const vmSizeOptions = catalog?.vmSizes ?? [];

  return (
    <div className="pm-shell">
      <header className="pm-topbar">
        <div>
          <h1>Azure VM Deck</h1>
          <p>Simple Control Panel • Drag & Drop links • Live VM actions</p>
        </div>
        <div className="pm-top-actions">
          <button className="btn btn-ghost" onClick={() => void loadState(false)}>
            Refresh
          </button>
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
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="dev-win-01"
                  pattern="[a-zA-Z0-9-]{3,24}"
                />
              </label>

              <label>
                OS Image
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

              <label>
                VM Size
                <select
                  value={form.vmSize}
                  onChange={(event) => setForm((current) => ({ ...current, vmSize: event.target.value }))}
                >
                  {vmSizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Username
                <input
                  required
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                />
              </label>

              <label>
                Password (Windows or optional for Linux)
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                />
              </label>

              <label>
                SSH Public Key (Linux optional)
                <textarea
                  rows={3}
                  value={form.publicKey}
                  onChange={(event) => setForm((current) => ({ ...current, publicKey: event.target.value }))}
                />
              </label>

              <button className="btn btn-primary" type="submit" disabled={creating || !catalog}>
                {creating ? "Creating..." : "Create VM"}
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
                      {vm.osType.toUpperCase()} • {vm.vmSize}
                    </span>
                    <span className="pm-vm-meta">Expires {new Date(vm.expiresAt).toLocaleString()}</span>
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
                    disabled={Boolean(updatingVm)}
                    onClick={() => void invokeVmAction(activeVm.name, "start")}
                  >
                    Resume
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={Boolean(updatingVm)}
                    onClick={() => void invokeVmAction(activeVm.name, "stop")}
                  >
                    Pause
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={Boolean(updatingVm)}
                    onClick={() => void invokeVmAction(activeVm.name, "extend")}
                  >
                    Extend +2h
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={Boolean(updatingVm)}
                    onClick={() => void invokeVmAction(activeVm.name, "delete")}
                  >
                    Terminate
                  </button>
                </div>
              ) : null}
            </div>

            {activeVm ? (
              <div className="pm-vm-details">
                <p>Status: {activeVm.status}</p>
                <p>Image: {activeVm.image}</p>
                <p>Public IP: {activeVm.publicIp ?? "pending"}</p>
                <p>Auto-shutdown: {new Date(activeVm.expiresAt).toLocaleString()}</p>
                <p>Budget mode: Pause reduces compute costs.</p>
              </div>
            ) : (
              <p className="pm-muted">Create or select a VM to see details.</p>
            )}
          </div>

          {activeVm ? <div className="pm-card pm-viewer-card">
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

                const url = viewerUrl(vm.publicIp, vm.osType);

                return (
                  <div className="pm-viewer-instance" key={vm.name + index}>
                    <div className="pm-viewer-instance-head">
                      <span>{vm.name}</span>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="pm-open-link">
                          Open noVNC in new tab
                        </a>
                      ) : null}
                    </div>
                    {url ? (
                      <iframe
                        title={`viewer-${vm.name}`}
                        src={url}
                        allow="fullscreen; clipboard-read; clipboard-write; autoplay"
                        allowFullScreen
                      />
                    ) : (
                      <p className="pm-muted">Viewer will be available as soon as a public IP is assigned.</p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pm-clipboard-panel">
              <h3>noVNC Transfer Tools</h3>
              <p className="pm-help">
                Recommendation: open noVNC in a new tab first, then use the noVNC toolbar for clipboard and fullscreen.
              </p>
              <textarea
                value={clipboardText}
                onChange={(event) => setClipboardText(event.target.value)}
                placeholder="Prepare text here, then paste it in noVNC with Ctrl/Cmd+V."
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
