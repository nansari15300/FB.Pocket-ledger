"use client";

/**
 * Google Cloud Vision online OCR - client wrapper for the Pocket Ledger Server (PocketBase) hooks.
 *
 * The Vision API key lives on the server only. This client sends the key once when an admin saves it
 * (`saveOcrCloudKey`) and never stores, caches or logs it. Every call uses the app's signed-in
 * PocketBase session (`pbRequest`).
 *
 * Endpoints:
 * - POST/DELETE /api/ocr-cloud/key
 * - GET  /api/ocr-cloud/status?company=
 * - POST /api/ocr-cloud/company
 * - POST /api/ocr-cloud/vision
 */

import {
  PocketBaseNotSignedInError,
  PocketBaseRequestError,
  pbRequest,
} from "@/lib/pocketbaseData/pbClient";

const VISION_TIMEOUT_MS = 60_000;

/**
 * Plausible Vision key shape (only used to enable the Save button — the server validates the real key).
 * Placeholder keys (`AIzaTEST…`) are allowed here so the flow can be exercised without a live key.
 */
export function looksLikeVisionKeyInput(key: string): boolean {
  return /^AIza[0-9A-Za-z_-]{25,}$/.test(String(key || "").trim());
}

export type OcrCloudErrorCode =
  | "disabled"
  | "no_key"
  | "forbidden"
  | "quota"
  | "network"
  | "not_signed_in"
  | "unknown";

const SERVER_ERROR_CODES: ReadonlySet<string> = new Set(["disabled", "no_key", "forbidden", "quota", "network"]);

export class OcrCloudError extends Error {
  code: OcrCloudErrorCode;
  /** HTTP status from the server (0 when the request never reached it). */
  status: number;
  constructor(code: OcrCloudErrorCode, message: string, status = 0) {
    super(message);
    this.name = "OcrCloudError";
    this.code = code;
    this.status = status;
  }
}

export function isOcrCloudError(err: unknown): err is OcrCloudError {
  return err instanceof OcrCloudError;
}

export type OcrCloudSharedUser = {
  userId: string;
  name?: string;
  email?: string;
  allowed: boolean;
};

export type OcrCloudStatus = {
  /** Server has the OCR cloud feature turned on. */
  serverOcrEnabled: boolean;
  /** Current user is owner/admin of this company (can add/delete the key and change access). */
  isAdmin: boolean;
  hasKey: boolean;
  /** Last 4 characters of the saved key, for display only. */
  keyLast4?: string;
  companyEnabled: boolean;
  /** Current user may run cloud OCR for this company right now. */
  canUse: boolean;
  /** Admin only: shared users of the company and whether each may use cloud OCR. */
  sharedUsers?: OcrCloudSharedUser[];
  /** Admin only: the server can encrypt + store a key (PL_VISION_MASTER_KEY configured). */
  canSaveKey?: boolean;
};

export type OcrCloudCompanyOptions = {
  company: string;
  /** Turn cloud OCR on/off for the company. */
  enabled?: boolean;
  /** With `allowed`: grant or revoke one shared user's access. */
  sharedUserId?: string;
  allowed?: boolean;
};

export type OcrCloudVisionPage = {
  text: string;
  [extra: string]: unknown;
};

export type OcrCloudVisionResult = {
  text: string;
  pages?: OcrCloudVisionPage[];
};

export type OcrCloudVisionOptions = {
  languageHints?: string[];
  signal?: AbortSignal;
};

function readServerCode(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as { code?: unknown; data?: unknown };
  if (typeof d.code === "string") return d.code;
  if (d.data && typeof d.data === "object") {
    const inner = (d.data as { code?: unknown }).code;
    if (typeof inner === "string") return inner;
  }
  return "";
}

/** Turns any failure into an `OcrCloudError`. Never includes request bodies (the key) in the message. */
function toOcrCloudError(err: unknown): OcrCloudError {
  if (err instanceof OcrCloudError) return err;
  if (err instanceof PocketBaseNotSignedInError) {
    return new OcrCloudError("not_signed_in", "Not signed in to Pocket Ledger Server", 401);
  }
  if (err instanceof PocketBaseRequestError) {
    const raw = readServerCode(err.data);
    if (SERVER_ERROR_CODES.has(raw)) return new OcrCloudError(raw as OcrCloudErrorCode, err.message, err.status);
    if (err.status === 401) return new OcrCloudError("not_signed_in", err.message, err.status);
    if (err.status === 403) return new OcrCloudError("forbidden", err.message, err.status);
    if (err.status === 429) return new OcrCloudError("quota", err.message, err.status);
    if (err.status === 0 || err.status >= 502) return new OcrCloudError("network", err.message, err.status);
    return new OcrCloudError("unknown", err.message, err.status);
  }
  // fetch failure / timeout / abort
  const msg = err instanceof Error ? err.message : "Request failed";
  return new OcrCloudError("network", msg, 0);
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  try {
    return (await pbRequest(path, init)) as T;
  } catch (e) {
    throw toOcrCloudError(e);
  }
}

function asBool(v: unknown): boolean {
  return v === true;
}

function normalizeStatus(raw: unknown): OcrCloudStatus {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: OcrCloudStatus = {
    serverOcrEnabled: asBool(o.serverOcrEnabled),
    isAdmin: asBool(o.isAdmin),
    hasKey: asBool(o.hasKey),
    companyEnabled: asBool(o.companyEnabled),
    canUse: asBool(o.canUse),
  };
  if (typeof o.keyLast4 === "string" && o.keyLast4) out.keyLast4 = o.keyLast4;
  if (typeof o.canSaveKey === "boolean") out.canSaveKey = o.canSaveKey;
  if (Array.isArray(o.sharedUsers)) {
    out.sharedUsers = o.sharedUsers
      .filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
      .map((u) => ({
        userId: String(u.userId ?? u.id ?? ""),
        ...(typeof u.name === "string" ? { name: u.name } : {}),
        ...(typeof u.email === "string" ? { email: u.email } : {}),
        allowed: asBool(u.allowed),
      }))
      .filter((u) => !!u.userId);
  }
  return out;
}

/** Cloud OCR status for the signed-in user and company. */
export async function getOcrCloudStatus(companyId: string): Promise<OcrCloudStatus> {
  const q = encodeURIComponent(String(companyId || ""));
  const raw = await call<unknown>(`/api/ocr-cloud/status?company=${q}`, { method: "GET" });
  return normalizeStatus(raw);
}

/** Admin: save (or replace) the Google Vision key on the server. The key is not kept on this device.
 *  `companyId` lets the server verify the caller is an admin of the company whose settings are open. */
export async function saveOcrCloudKey(key: string, companyId?: string): Promise<void> {
  const k = String(key || "").trim();
  if (!k) throw new OcrCloudError("no_key", "Key is empty");
  const body: Record<string, unknown> = { key: k };
  if (companyId) body.company = companyId;
  await call<unknown>("/api/ocr-cloud/key", { method: "POST", body });
}

/** Admin: delete the saved Google Vision key from the server. */
export async function deleteOcrCloudKey(companyId?: string): Promise<void> {
  await call<unknown>("/api/ocr-cloud/key", { method: "DELETE", body: companyId ? { company: companyId } : {} });
}

/** Admin: enable/disable cloud OCR for a company, or grant/revoke one shared user. */
export async function setOcrCloudCompany(opts: OcrCloudCompanyOptions): Promise<void> {
  const body: Record<string, unknown> = { company: opts.company };
  if (typeof opts.enabled === "boolean") body.enabled = opts.enabled;
  if (opts.sharedUserId) {
    body.sharedUserId = opts.sharedUserId;
    if (typeof opts.allowed === "boolean") body.allowed = opts.allowed;
  }
  await call<unknown>("/api/ocr-cloud/company", { method: "POST", body });
}

/** Run Google Cloud Vision OCR on the server. `imageBase64` is the raw base64 (no `data:` prefix needed). */
export async function ocrCloudVision(
  companyId: string,
  imageBase64: string,
  opts: OcrCloudVisionOptions = {}
): Promise<OcrCloudVisionResult> {
  const img = String(imageBase64 || "").replace(/^data:[^;,]*;base64,/, "");
  const body: Record<string, unknown> = { company: companyId, imageBase64: img };
  if (opts.languageHints?.length) body.languageHints = opts.languageHints;
  const raw = await call<unknown>("/api/ocr-cloud/vision", {
    method: "POST",
    body,
    timeoutMs: VISION_TIMEOUT_MS,
    signal: opts.signal,
  });
  const o = (raw && typeof raw === "object" ? raw : {}) as { text?: unknown; pages?: unknown };
  const out: OcrCloudVisionResult = { text: typeof o.text === "string" ? o.text : "" };
  if (Array.isArray(o.pages)) {
    out.pages = o.pages
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ ...p, text: typeof p.text === "string" ? p.text : "" }));
  }
  return out;
}
