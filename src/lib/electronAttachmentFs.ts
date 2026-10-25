"use client";

import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

type PlElectronAttachmentsApi = {
  writeFile: (args: {
    relativePath: string;
    base64: string;
  }) => Promise<{ ok?: boolean; error?: string }>;
  writeFileBinary?: (args: {
    relativePath: string;
    buffer: ArrayBuffer;
  }) => Promise<{ ok?: boolean; error?: string; bytes?: number }>;
  readFile: (args: {
    relativePath: string;
  }) => Promise<{ ok?: boolean; base64?: string; error?: string }>;
  deleteFile: (relativePath: string) => Promise<{ ok?: boolean; error?: string }>;
  exists: (relativePath: string) => Promise<{ ok?: boolean; exists?: boolean; error?: string }>;
  /** Batch fs.stat size (no read); null = missing. Needs EXE restart after main/preload update. */
  statSizes?: (relativePaths: string[]) => Promise<{ ok?: boolean; sizes?: (number | null)[]; error?: string }>;
};

/** EXE: real on-disk sizes for data-folder paths (batched, chunks of 200). Missing / old EXE -> empty map. */
export async function electronStatAttachmentSizes(relativePaths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const api = electronAttachmentsApi();
  if (!api?.statSizes || relativePaths.length === 0) return out;
  for (let i = 0; i < relativePaths.length; i += 200) {
    const chunk = relativePaths.slice(i, i + 200);
    try {
      const resp = await api.statSizes(chunk);
      if (resp?.ok !== true || !Array.isArray(resp.sizes)) continue;
      chunk.forEach((p, k) => {
        const s = resp.sizes![k];
        if (typeof s === "number" && s >= 0) out.set(p, s);
      });
    } catch {
      /* fallback: stored size */
    }
  }
  return out;
}

function electronAttachmentsApi(): PlElectronAttachmentsApi | null {
  if (typeof window === "undefined" || !isElectronDesktopApp()) return null;
  const api = (window as unknown as { plElectronAttachments?: PlElectronAttachmentsApi })
    .plElectronAttachments;
  if (!api?.writeFile || !api?.readFile) return null;
  return api;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result || "");
      resolve(dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl);
    };
    r.onerror = () => reject(r.error ?? new Error("blob read failed"));
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(base64Raw: string, contentType?: string | null): Blob {
  const bin = atob(base64Raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

/** EXE userData/pl-attachments/... — renderer IPC via preload. */
export async function electronWriteAttachmentBlob(relativePath: string, blob: Blob): Promise<boolean> {
  const api = electronAttachmentsApi();
  if (!api) return false;
  const rel = String(relativePath || "").trim();
  if (!rel) return false;
  try {
    if (api.writeFileBinary) {
      const resp = await api.writeFileBinary({ relativePath: rel, buffer: await blob.arrayBuffer() });
      if (resp.ok === true) return true;
      console.warn("[electronAttachmentFs] writeFileBinary failed", { rel, error: resp.error });
    }
    const base64 = await blobToBase64(blob);
    const resp = await api.writeFile({ relativePath: rel, base64 });
    if (resp.ok !== true && process.env.NODE_ENV !== "production") {
      console.warn("[electronAttachmentFs] writeFile failed", { rel, error: resp.error });
    }
    return resp.ok === true;
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[electronAttachmentFs] write threw", {
        rel,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return false;
  }
}

export async function electronReadAttachmentBlob(
  relativePath: string,
  contentType?: string | null
): Promise<Blob | null> {
  const api = electronAttachmentsApi();
  if (!api) return null;
  const rel = String(relativePath || "").trim();
  if (!rel) return null;
  try {
    const resp = await api.readFile({ relativePath: rel });
    if (!resp.ok || !resp.base64) return null;
    const blob = base64ToBlob(resp.base64, contentType);
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export async function electronDeleteAttachmentBlob(relativePath: string): Promise<void> {
  const api = electronAttachmentsApi();
  if (!api) return;
  const rel = String(relativePath || "").trim();
  if (!rel) return;
  try {
    await api.deleteFile(rel);
  } catch {
    /* ignore */
  }
}

export async function electronAttachmentBlobExists(relativePath: string): Promise<boolean> {
  const api = electronAttachmentsApi();
  if (!api) return false;
  const rel = String(relativePath || "").trim();
  if (!rel) return false;
  try {
    const resp = await api.exists(rel);
    return resp.ok === true && resp.exists === true;
  } catch {
    return false;
  }
}

const ELECTRON_DISPLAY_URL_MAX = 120;
const electronDisplayUrlByPath = new Map<string, string>();
const electronDisplayUrlLru: string[] = [];

/** Disk read par galat/empty MIME — EXE `<img>` preview ke liye JPEG/PNG infer (`.jfif` = JPEG). */
async function blobWithPreviewMime(
  blob: Blob,
  contentType?: string | null,
  relativePath?: string
): Promise<Blob> {
  const ct = String(contentType || blob.type || "").toLowerCase();
  if (ct.startsWith("image/") && !ct.includes("octet-stream")) return blob;
  const lower = String(relativePath || "").toLowerCase();
  if (/\.(jpe?g|jfif|pjpeg)$/.test(lower)) return new Blob([blob], { type: "image/jpeg" });
  if (lower.endsWith(".png")) return new Blob([blob], { type: "image/png" });
  if (lower.endsWith(".gif")) return new Blob([blob], { type: "image/gif" });
  if (lower.endsWith(".webp")) return new Blob([blob], { type: "image/webp" });
  if (blob.size >= 2) {
    try {
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (head[0] === 0xff && head[1] === 0xd8) return new Blob([blob], { type: "image/jpeg" });
      if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
        return new Blob([blob], { type: "image/png" });
      }
    } catch {
      /* ignore */
    }
  }
  return blob;
}

/** Voucher thumbnail / preview: disk read → stable session `blob:` (revoke on replace only). */
export async function electronAttachmentDisplayUrlFromPath(
  relativePath: string,
  contentType?: string | null
): Promise<string | null> {
  const rel = String(relativePath || "").trim();
  if (!rel) return null;
  const cached = electronDisplayUrlByPath.get(rel);
  if (cached) return cached;
  const raw = await electronReadAttachmentBlob(rel, contentType);
  if (!raw || raw.size <= 0) return null;
  const blob = await blobWithPreviewMime(raw, contentType, rel);
  const url = URL.createObjectURL(blob);
  const prev = electronDisplayUrlByPath.get(rel);
  if (prev && prev !== url) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      /* ignore */
    }
  }
  electronDisplayUrlByPath.set(rel, url);
  const idx = electronDisplayUrlLru.indexOf(rel);
  if (idx >= 0) electronDisplayUrlLru.splice(idx, 1);
  electronDisplayUrlLru.push(rel);
  while (electronDisplayUrlLru.length > ELECTRON_DISPLAY_URL_MAX) {
    const drop = electronDisplayUrlLru.shift();
    if (!drop) break;
    const ou = electronDisplayUrlByPath.get(drop);
    electronDisplayUrlByPath.delete(drop);
    if (ou) {
      try {
        URL.revokeObjectURL(ou);
      } catch {
        /* ignore */
      }
    }
  }
  return url;
}
