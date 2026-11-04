/**
 * 2s hold copy/paste: clipboard me compact marker + optional same-tab blob sid.
 * Paste (voucher forms): saved `src` ref ho to wahi URL reuse; sirf unsaved File / sid-only → naya File upload.
 */
import { storage } from "@/lib/firebase";
import { ref, getBlob } from "@/lib/pocketbaseData/pbStorage";
import { getBlobFromLocalFileRef, isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import {
  getRemoteAttachmentBlobPreferOfflineCache,
} from "@/lib/offlineAttachmentUrlCache";
import { getBlobFromAttachmentRefPreferLocalFirst } from "@/lib/attachmentPreviewResolve";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
export const ATTACHMENT_HOLD_CLIPBOARD_PREFIX = "PL_ATTACH_V1:";

export type AttachmentHoldPayloadV1 = {
  v: 1;
  /** HTTPS / http / data: / local: ref */
  src?: string;
  /** Firebase Storage object path (optional; speeds up SDK read) */
  p?: string;
  /** Original filename hint */
  n?: string;
  /** MIME hint */
  t?: string;
  /** Same-tab only: in-memory blob entry id */
  sid?: string;
  /** Source company id — paste par same-company reuse vs cross-company copy. */
  c?: string;
  /** Source place key (`vouchers/id`) — reuse badge green origin. */
  o?: string;
};

const SESSION_BACKUP_KEY = "pl_attach_hold_clip_backup";
/** EXE multi-tab / APK: same origin tabs share last PL copy via localStorage. */
const LOCAL_CROSS_TAB_BACKUP_KEY = "pl_attach_hold_clip_cross_tab_v1";
const SAME_TAB_TTL_MS = 15 * 60 * 1000;
const SAME_TAB_MAX = 8;

const sameTabBlobs = new Map<string, { blob: Blob; createdAt: number }>();

function embeddedSharesAttachmentHoldAcrossTabs(): boolean {
  if (typeof window === "undefined") return false;
  // Web bhi multi-tab: Tab A copy → Tab B paste (localStorage); EXE/APK pehle se.
  return true;
}

function writeHoldClipboardBackup(encoded: string): void {
  if (!encoded.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return;
  try {
    sessionStorage.setItem(SESSION_BACKUP_KEY, encoded);
  } catch {
    /* private mode */
  }
  if (!embeddedSharesAttachmentHoldAcrossTabs()) return;
  try {
    localStorage.setItem(LOCAL_CROSS_TAB_BACKUP_KEY, encoded);
  } catch {
    /* quota / private mode */
  }
}

function readHoldClipboardBackupFromStores(): string | null {
  // EXE/APK multi-tab: `localStorage` sab tabs share karta hai — is tab ka purana `sessionStorage` doosri tab ke copy ko block na kare.
  if (embeddedSharesAttachmentHoldAcrossTabs()) {
    try {
      const local = localStorage.getItem(LOCAL_CROSS_TAB_BACKUP_KEY);
      if (local?.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return local;
    } catch {
      /* */
    }
  }
  try {
    const session = sessionStorage.getItem(SESSION_BACKUP_KEY);
    if (session?.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return session;
  } catch {
    /* */
  }
  if (!embeddedSharesAttachmentHoldAcrossTabs()) return null;
  try {
    const local = localStorage.getItem(LOCAL_CROSS_TAB_BACKUP_KEY);
    if (local?.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return local;
  } catch {
    /* */
  }
  return null;
}

function firstPersistableAttachmentRefInPlainText(text: string): string | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return null;

  const candidates: string[] = [trimmed];
  const line = trimmed.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (line && line !== trimmed) candidates.push(line);
  const urlMatch = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch?.[0]) candidates.push(urlMatch[0]);
  const localMatch = trimmed.match(/local:[^\s<>"']+/i);
  if (localMatch?.[0]) candidates.push(localMatch[0]);
  const driveMatch = trimmed.match(/drive:[^\s<>"']+/i);
  if (driveMatch?.[0]) candidates.push(driveMatch[0]);
  const pbMatch = trimmed.match(/pbatt:[^\s<>"']+/i);
  if (pbMatch?.[0]) candidates.push(pbMatch[0]);

  for (const raw of candidates) {
    const ref = String(raw || "").trim();
    if (!ref) continue;
    if (
      ref.startsWith("http://") ||
      ref.startsWith("https://") ||
      isLocalFileRef(ref) ||
      ref.startsWith("drive:") ||
      ref.startsWith("pbatt:") ||
      ref.startsWith("companies/") ||
      ref.startsWith("voucher-files/")
    ) {
      return ref;
    }
  }
  return null;
}

/** OS clipboard me sirf HTTPS / local: / drive: link ho to bhi paste payload banao. */
function encodePayloadFromPlainClipboardLine(text: string): string | null {
  const ref = firstPersistableAttachmentRefInPlainText(text);
  if (!ref) return null;
  const payload = buildHoldPayloadFromPreviewSource({ file: ref });
  if (!payload) return null;
  return encodePayload(payload);
}

/** PL marker ya koi bhi plain attachment link / path → paste payload. */
export function parseAttachmentHoldPayloadFromAnyText(raw: string): AttachmentHoldPayloadV1 | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const marker = trimmed.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)
    ? trimmed
    : (() => {
        const idx = trimmed.indexOf(ATTACHMENT_HOLD_CLIPBOARD_PREFIX);
        if (idx < 0) return null;
        return trimmed.slice(idx).split(/\s/)[0]?.trim() || null;
      })();
  if (marker) {
    const parsed = parseAttachmentHoldClipboardText(marker);
    if (parsed) return parsed;
  }
  const encoded = encodePayloadFromPlainClipboardLine(trimmed);
  if (!encoded) return null;
  return parseAttachmentHoldClipboardText(encoded);
}

function pruneSameTab() {
  const now = Date.now();
  for (const [k, v] of sameTabBlobs) {
    if (now - v.createdAt > SAME_TAB_TTL_MS) sameTabBlobs.delete(k);
  }
  while (sameTabBlobs.size > SAME_TAB_MAX) {
    const first = sameTabBlobs.keys().next().value as string | undefined;
    if (first === undefined) break;
    sameTabBlobs.delete(first);
  }
}

export function putSameTabBlobForHoldCopy(blob: Blob): string {
  pruneSameTab();
  const sid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  sameTabBlobs.set(sid, { blob, createdAt: Date.now() });
  return sid;
}

/** Paste par blob mat hatao — jab tak naya copy na ho, bar-bar paste same file se ho sake */
function getSameTabBlob(sid: string): Blob | null {
  pruneSameTab();
  const e = sameTabBlobs.get(sid);
  if (!e || e.blob.size === 0) return null;
  e.createdAt = Date.now();
  return e.blob;
}

/** Session backup dubara likho — multi-paste ke baad bhi last copy readable rahe */
export function refreshAttachmentHoldSessionBackup(payload: AttachmentHoldPayloadV1): void {
  writeHoldClipboardBackup(encodePayload(payload));
}

function encodePayload(p: AttachmentHoldPayloadV1): string {
  const json = JSON.stringify(p);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf-8").toString("base64");
  return `${ATTACHMENT_HOLD_CLIPBOARD_PREFIX}${b64}`;
}

/** Voucher / hover preview: clipboard marker ko asli `local:` / `drive:` / https ref me karo. */
export function normalizeAttachmentUrlForDevicePreview(raw: string): string {
  const s = String(raw || "").trim();
  if (!s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return s;
  const payload = parseAttachmentHoldClipboardText(s);
  const src = String(payload?.src || "").trim();
  return src || s;
}

export function parseAttachmentHoldClipboardText(raw: string): AttachmentHoldPayloadV1 | null {
  const s = String(raw || "").trim();
  if (!s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return null;
  const b64 = s.slice(ATTACHMENT_HOLD_CLIPBOARD_PREFIX.length);
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const o = JSON.parse(json) as AttachmentHoldPayloadV1;
    if (o?.v !== 1) return null;
    return o;
  } catch {
    return null;
  }
}

export type WriteAttachmentHoldClipboardOpts = {
  /**
   * Clipboard line user ko dikhe (HTTPS link); session me hamesha PL marker — `readText` URL ho to bhi paste session se chal sakta hai.
   */
  clipboardDisplayUrl?: string | null;
};

export async function writeAttachmentHoldClipboard(
  payload: AttachmentHoldPayloadV1,
  opts?: WriteAttachmentHoldClipboardOpts
): Promise<boolean> {
  const encoded = encodePayload(payload);
  writeHoldClipboardBackup(encoded);
  const persistable = persistableAttachmentRefFromHoldPayload(payload);
  const raw = String(opts?.clipboardDisplayUrl || persistable || "").trim();
  const usePlain =
    raw.length > 0 &&
    !raw.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX) &&
    !raw.startsWith("blob:") &&
    !raw.startsWith("data:") &&
    (raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      isLocalFileRef(raw) ||
      isDriveFileRef(raw));
  const toWrite = usePlain ? raw : encoded;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(toWrite);
      return true;
    }
  } catch {
    /* permission / insecure context */
  }
  return false;
}

export async function readAttachmentHoldClipboardText(): Promise<string | null> {
  const payload = await resolveAttachmentHoldPayloadForPaste();
  return payload ? encodePayload(payload) : null;
}

/** Paste / reuse: form `files[]` me ref pehle se hai? (`PL_ATTACH` marker bhi match). */
export function voucherFormFilesIncludePersistableRef(
  currentFiles: readonly (File | string)[],
  ref: string
): boolean {
  const target = String(ref || "").trim();
  if (!target) return false;
  const targetPath = tryGetStoragePathFromFirebaseDownloadUrl(target);
  return currentFiles.some((f) => {
    if (typeof f !== "string") return false;
    const s = String(f).trim();
    if (!s) return false;
    if (s === target) return true;
    const norm = normalizeAttachmentUrlForDevicePreview(s);
    if (norm === target) return true;
    if (!targetPath) return false;
    const sp =
      tryGetStoragePathFromFirebaseDownloadUrl(s) ||
      tryGetStoragePathFromFirebaseDownloadUrl(norm);
    return Boolean(sp && sp === targetPath);
  });
}

function attachmentHoldPayloadReuseScore(payload: AttachmentHoldPayloadV1 | null): number {
  if (!payload) return 0;
  const ref = persistableAttachmentRefFromHoldPayload(payload);
  if (ref && (isLocalFileRef(ref) || isDriveFileRef(ref))) return 4;
  if (ref && (ref.startsWith("companies/") || ref.startsWith("voucher-files/"))) return 3;
  if (ref && (ref.startsWith("http://") || ref.startsWith("https://"))) return 2;
  if (ref) return 2;
  if (payload.sid) return 1;
  return 0;
}

/**
 * Paste button / Ctrl+V: OS clipboard + session/local backup — local:/drive: src wale payload ko
 * plain https clipboard line se prefer karo (local company paste fail fix).
 */
export async function resolveAttachmentHoldPayloadForPaste(): Promise<AttachmentHoldPayloadV1 | null> {
  let fromOs: AttachmentHoldPayloadV1 | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const t = (await navigator.clipboard.readText())?.trim();
      if (t) fromOs = parseAttachmentHoldPayloadFromAnyText(t);
    }
  } catch {
    /* permission / insecure context */
  }

  const fromStoresRaw = readHoldClipboardBackupFromStores();
  const fromStores = fromStoresRaw ? parseAttachmentHoldClipboardText(fromStoresRaw) : null;

  const osScore = attachmentHoldPayloadReuseScore(fromOs);
  const storeScore = attachmentHoldPayloadReuseScore(fromStores);
  if (storeScore > osScore) return fromStores;
  if (osScore > 0) return fromOs;
  return fromStores ?? fromOs;
}

/** EXE multi-tab: doosri tab me copy hone par Paste chip refresh ke liye. */
export const ATTACHMENT_HOLD_CROSS_TAB_BACKUP_KEY = LOCAL_CROSS_TAB_BACKUP_KEY;

/** Copy source se Blob — paste ke liye naya File banane me (dubara upload ho). */
export async function fetchBlobForAttachmentHoldPaste(
  payload: AttachmentHoldPayloadV1,
  signal?: AbortSignal,
  options?: { companyId?: string }
): Promise<{ blob: Blob; fileName: string; contentType: string } | null> {
  if (payload.sid) {
    const blob = getSameTabBlob(payload.sid);
    if (!blob || blob.size === 0) return null;
    const fileName = payload.n || "attachment";
    const contentType = payload.t || blob.type || "application/octet-stream";
    return { blob, fileName, contentType };
  }

  const src = String(payload.src || "").trim();
  const path = String(payload.p || "").trim();
  const companyId = String(options?.companyId || "").trim() || undefined;

  if (src && isLocalFileRef(src)) {
    const b = await getBlobFromLocalFileRef(src, companyId ? { companyId } : undefined);
    if (!b || b.size === 0) return null;
    return {
      blob: b,
      fileName: payload.n || "attachment",
      contentType: payload.t || b.type || "application/octet-stream",
    };
  }

  if (src && isDriveFileRef(src)) {
    const b = await getBlobFromAttachmentRefPreferLocalFirst(src, { companyId });
    if (!b || b.size === 0 || signal?.aborted) return null;
    return {
      blob: b,
      fileName: payload.n || src.split("/").pop() || "attachment",
      contentType: payload.t || b.type || "application/octet-stream",
    };
  }

  if (src && src.startsWith("pbatt:")) {
    const { fetchPbAttachmentBlob } = await import("@/lib/pocketbaseData/pbAttachments");
    const b = await fetchPbAttachmentBlob(src);
    if (!b || b.size === 0 || signal?.aborted) return null;
    const fileName = payload.n || src.split("/").pop() || "attachment";
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const guessed =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "pdf"
              ? "application/pdf"
              : "";
    return {
      blob: b,
      fileName,
      contentType: payload.t || b.type || guessed || "application/octet-stream",
    };
  }

  if (path && !path.includes("://")) {
    try {
      const storageRef = ref(storage, path);
      const blob = await getBlob(storageRef);
      if (signal?.aborted || !blob || blob.size === 0) return null;
      return {
        blob,
        fileName: payload.n || path.split("/").pop() || "attachment",
        contentType: payload.t || blob.type || "application/octet-stream",
      };
    } catch {
      /* fall through to URL */
    }
  }

  if (src.startsWith("data:")) {
    const res = await fetch(src, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return {
      blob,
      fileName: payload.n || "attachment",
      contentType: payload.t || blob.type || "application/octet-stream",
    };
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    let blob: Blob | null = await getRemoteAttachmentBlobPreferOfflineCache(src, signal, {
      companyId,
    });
    if ((!blob || blob.size === 0) && !signal?.aborted) {
      const res = await fetch(src, { mode: "cors", credentials: "omit", signal });
      if (res.ok) blob = await res.blob();
    }
    if (!blob || blob.size === 0) return null;
    const inferredPath = path || tryGetStoragePathFromFirebaseDownloadUrl(src) || "";
    if (!path && inferredPath) {
      try {
        const storageRef = ref(storage, inferredPath);
        const b2 = await getBlob(storageRef);
        if (b2 && b2.size > 0) {
          return {
            blob: b2,
            fileName: payload.n || src.split("/").pop()?.split("?")[0] || "attachment",
            contentType: payload.t || b2.type || blob.type || "application/octet-stream",
          };
        }
      } catch {
        /* use fetched blob */
      }
    }
    return {
      blob,
      fileName: payload.n || src.split("/").pop()?.split("?")[0] || "attachment",
      contentType: payload.t || blob.type || "application/octet-stream",
    };
  }

  return null;
}

export function blobToFile(blob: Blob, fileName: string, contentType: string): File {
  const type = contentType || blob.type || "application/octet-stream";
  return new File([blob], fileName, { type });
}

/** Copy/paste: voucher `fileUrls` me save ho sakne wala ref (`https`, `local:`, `drive:`, …). */
export function persistableAttachmentRefFromHoldPayload(
  payload: AttachmentHoldPayloadV1
): string | null {
  const src = normalizeAttachmentUrlForDevicePreview(String(payload.src || "").trim());
  if (src && !src.startsWith("blob:")) return src;
  const path = String(payload.p || "").trim();
  if (path && !path.includes("://")) return path;
  return null;
}

/** FilePreview / avatar se hold-copy payload banana */
export function buildHoldPayloadFromPreviewSource(params: {
  file: File | string;
  storagePath?: string;
  /** Owning company — paste same-company link vs cross-company copy. */
  companyId?: string;
  /** Source voucher/master place — green origin for reuse badge. */
  placeKey?: string | null;
}): AttachmentHoldPayloadV1 | null {
  const { file, storagePath, companyId, placeKey } = params;
  const c = String(companyId || "").trim() || undefined;
  const o = String(placeKey || "").trim() || undefined;
  if (typeof file === "string") {
    const src = file.trim();
    if (!src) return null;
    let p = storagePath?.trim() || "";
    if (!p && (src.startsWith("http://") || src.startsWith("https://"))) {
      p = tryGetStoragePathFromFirebaseDownloadUrl(src) || "";
    }
    let n = "";
    try {
      n = decodeURIComponent(src.split("/").pop()?.split("?")[0] || "");
    } catch {
      n = src.split("/").pop()?.split("?")[0] || "";
    }
    return {
      v: 1,
      src,
      p: p || undefined,
      n: n || undefined,
      c,
      o,
    };
  }
  // Unsaved File: same-tab sid + clipboard (clipboard text still works cross-action same tab)
  const sid = putSameTabBlobForHoldCopy(file);
  return {
    v: 1,
    sid,
    n: file.name,
    t: file.type || undefined,
    c,
    o,
  };
}

/** Source company from hold payload / storage path / URL. */
export function companyIdFromAttachmentHoldPayload(
  payload: AttachmentHoldPayloadV1 | null | undefined
): string | null {
  if (!payload) return null;
  const direct = String(payload.c || "").trim();
  if (direct) return direct;
  const path = String(payload.p || "").trim();
  if (path) {
    const fromPath = companyIdFromStorageObjectPath(path);
    if (fromPath) return fromPath;
  }
  const src = String(payload.src || "").trim();
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const sp = tryGetStoragePathFromFirebaseDownloadUrl(src);
    if (sp) return companyIdFromStorageObjectPath(sp);
  }
  return null;
}

function companyIdFromStorageObjectPath(path: string): string | null {
  const p = String(path || "").replace(/^\/+/, "").trim();
  if (!p) return null;
  const m = /^(?:pocket-ledger|voucher-files|companies|parties-files|staff-files|items-files)\/([^/]+)\//i.exec(
    p
  );
  return m?.[1]?.trim() || null;
}

/**
 * Local registry id vs Storage/Firestore path id — same company often looks different.
 * Missing source → prefer same-company URL reuse (no re-upload).
 */
export async function attachmentHoldCompaniesMatch(
  sourceCompanyId: string | null | undefined,
  targetCompanyId: string | null | undefined
): Promise<boolean> {
  const src = String(sourceCompanyId || "").trim();
  const tgt = String(targetCompanyId || "").trim();
  if (!src || !tgt) return true;
  if (src === tgt) return true;
  try {
    const { resolveAuthoritativeFirestoreCompanyId } = await import(
      "@/lib/resolveAuthoritativeFirestoreCompanyId"
    );
    const a = String((await resolveAuthoritativeFirestoreCompanyId(src)) || "").trim();
    const b = String((await resolveAuthoritativeFirestoreCompanyId(tgt)) || "").trim();
    if (a && b && a === b) return true;
    if (a && (a === tgt || a === src)) return true;
    if (b && (b === tgt || b === src)) return true;
  } catch {
    /* prefer reuse over accidental re-upload */
  }
  return false;
}
