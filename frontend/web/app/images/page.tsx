"use client";

import { FormEvent, useEffect, useState } from "react";

type ManagedImage = {
  id?: string;
  name?: string;
  location?: string;
  tags?: Record<string, string>;
};

type UploadInitResponse = {
  uploadUrl: string;
  blobUrl: string;
  blobName: string;
  expiresAt: string;
};

export default function ImagesPage() {
  const [images, setImages] = useState<ManagedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    imageName: "",
    areaId: "lab-web",
    areaLabel: "Lab Web",
    username: "student",
    password: "student123!",
    osType: "linux" as "linux" | "windows"
  });

  async function loadImages() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/orchestrator/images", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Could not load managed images.");
      }

      const data = (await res.json()) as { items?: ManagedImage[] };
      setImages(data.items ?? []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadImages();
  }, []);

  function isValidImageFile(file: File) {
    const name = file.name.toLowerCase();
    return name.endsWith(".vhd") || name.endsWith(".vhdx") || name.endsWith(".img");
  }

  async function createImage(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!selectedFile) {
      setError("Please select an image file first.");
      return;
    }

    if (!isValidImageFile(selectedFile)) {
      setError("Only .vhd, .vhdx or .img files are allowed.");
      return;
    }

    if (!form.imageName.trim() || !form.areaId.trim() || !form.username.trim() || !form.password.trim()) {
      setError("Please fill all required fields.");
      return;
    }

    setUploading(true);

    try {
      const initRes = await fetch("/api/orchestrator/images/upload-init", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType: selectedFile.type || "application/octet-stream"
        })
      });

      const initPayload = (await initRes.json().catch(() => ({}))) as UploadInitResponse & { error?: string };
      if (!initRes.ok) {
        throw new Error(initPayload.error ?? "Upload initialization failed.");
      }

      const uploadRes = await fetch(initPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "x-ms-version": "2023-11-03",
          "content-type": selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      });

      if (!uploadRes.ok) {
        throw new Error("Uploading file to Azure Storage failed.");
      }

      const completeRes = await fetch("/api/orchestrator/images/upload-complete", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          blobUrl: initPayload.blobUrl,
          imageName: form.imageName,
          imageLabel: form.imageName,
          topicId: form.areaId,
          topicLabel: form.areaLabel,
          username: form.username,
          password: form.password,
          osType: form.osType
        })
      });

      const completePayload = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) {
        throw new Error(completePayload.error ?? "Creating managed image failed.");
      }

      setMessage("Image uploaded and added to the selected area successfully.");
      setSelectedFile(null);
      setForm((current) => ({ ...current, imageName: "" }));
      await loadImages();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pm-shell">
      <header className="pm-topbar">
        <div>
          <h1>Image Menu</h1>
          <p>Upload image files to Azure and assign them to an area</p>
        </div>
        <div className="pm-top-actions">
          <a className="btn btn-ghost" href="/">
            Home
          </a>
          <button className="btn btn-ghost" onClick={() => void loadImages()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <main className="pm-grid pm-grid-images">
        <section className="pm-card">
          <h2>Upload New Image</h2>
          <p className="pm-help">
            Select an image file, set area and credentials, then click Create.
          </p>

          <form className="pm-form" onSubmit={createImage}>
            <label>
              Image File
              <input
                type="file"
                accept=".vhd,.vhdx,.img"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>

            <label>
              Image Name
              <input
                value={form.imageName}
                onChange={(event) => setForm((current) => ({ ...current, imageName: event.target.value }))}
                placeholder="e.g. web-lab-image-v1"
                required
              />
            </label>

            <label>
              Area ID
              <input
                value={form.areaId}
                onChange={(event) => setForm((current) => ({ ...current, areaId: event.target.value }))}
                required
              />
            </label>

            <label>
              Area Label
              <input
                value={form.areaLabel}
                onChange={(event) => setForm((current) => ({ ...current, areaLabel: event.target.value }))}
                required
              />
            </label>

            <label>
              OS Type
              <select
                value={form.osType}
                onChange={(event) =>
                  setForm((current) => ({ ...current, osType: event.target.value as "linux" | "windows" }))
                }
              >
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
              </select>
            </label>

            <label>
              Username
              <input
                value={form.username}
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                required
              />
            </label>

            <button className="btn btn-primary" type="submit" disabled={uploading}>
              {uploading ? "Creating..." : "Create"}
            </button>
          </form>

          {selectedFile ? <p className="pm-muted">Selected: {selectedFile.name}</p> : null}
          {message ? <p className="pm-feedback">{message}</p> : null}
          {error ? <p className="pm-error">{error}</p> : null}
        </section>

        <section className="pm-card pm-card-fill">
          <div className="pm-panel-headline">
            <h2>Stored Images</h2>
            <button className="btn btn-ghost" onClick={() => void loadImages()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {images.length === 0 ? (
            <p className="pm-muted">No managed images found.</p>
          ) : (
            <div className="pm-vm-list">
              {images.map((image) => (
                <button type="button" key={image.id ?? image.name} className="pm-vm-item">
                  <span className="pm-vm-main">{image.name ?? "Unnamed image"}</span>
                  <span className="pm-vm-meta">Area: {image.tags?.orchTopicLabel ?? image.tags?.orchTopic ?? "-"}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
