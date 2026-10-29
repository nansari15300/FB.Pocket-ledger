"use client";

/**
 * Session cache for ledger attachments whose URL exists but the remote file has no bytes
 * (HTTP 404/410 or an empty / 0-byte body). Used by the File column to show an eye icon
 * (explanation popup on click) instead of a broken thumbnail / viewer.
 *
 * - In-memory Map + sessionStorage mirror (survives reload within the tab session, not across sessions).
 * - Probe results that are NOT "no bytes" are only cached for a short TTL so a failing probe is not repeated
 *   for every re-render / refresh tick.
 */

import { useCallback, useSyncExternalStore } from "react";

const SS_KEY = "pl_attachment_no_file_v1";
const MAX_KEEP = 500;
const PROBE_TIMEOUT_MS = 8000;
const PROBE_SOFT_TTL_MS = 60_000;

export type RemoteAttachmentBytesProbe = "no-bytes" | "has-bytes" | "unknown";

const noFileUrls = new Set<string>();
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

/**
 * Inferred "no file" verdicts: the load path returned no bytes (and no server answer could confirm bytes exist),
 * e.g. Firebase Storage object missing, `local:` ref never uploaded, CORS-blocked HEAD. Memory only (not persisted)
 * and expires, so a transient failure heals itself.
 */
const INFERRED_TTL_MS = 3 * 60_000;
const inferredNoFile = new Map<string, number>();
function hasInferred(u: string): boolean {
  const until = inferredNoFile.get(u);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    inferredNoFile.delete(u);
    return false;
  }
  return true;
}

function key(raw: string | null | undefined): string {
  return String(raw || "").trim();
}

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(SS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const u of arr) if (typeof u === "string" && u) noFileUrls.add(u);
  } catch {
    /* optional */
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const arr = [...noFileUrls];
    window.sessionStorage.setItem(SS_KEY, JSON.stringify(arr.slice(Math.max(0, arr.length - MAX_KEEP))));
  } catch {
    /* quota / private mode */
  }
}

function emit(): void {
  version += 1;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function isAttachmentNoFile(raw: string | null | undefined): boolean {
  const u = key(raw);
  if (!u) return false;
  loadOnce();
  return noFileUrls.has(u) || hasInferred(u);
}

/** Load returned no bytes and the server could not confirm otherwise: show the eye for a while (not persisted). */
export function markAttachmentNoFileInferred(raw: string | null | undefined): void {
  const u = key(raw);
  if (!u) return;
  loadOnce();
  if (noFileUrls.has(u) || hasInferred(u)) return;
  inferredNoFile.set(u, Date.now() + INFERRED_TTL_MS);
  emit();
}

export function markAttachmentNoFile(raw: string | null | undefined): void {
  const u = key(raw);
  if (!u) return;
  loadOnce();
  inferredNoFile.delete(u);
  if (noFileUrls.has(u)) return;
  noFileUrls.add(u);
  persist();
  emit();
}

/** File became available (thumb built / user refreshed) - forget the "no file" verdict. */
export function clearAttachmentNoFile(raw: string | null | undefined): void {
  const u = key(raw);
  if (!u) return;
  loadOnce();
  softProbeCache.delete(u);
  const hadInferred = inferredNoFile.delete(u);
  if (!noFileUrls.delete(u)) {
    if (hadInferred) emit();
    return;
  }
  persist();
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True when the list is non-empty and EVERY url has a cached "no file" verdict. */
export function useAttachmentNoFile(urls: readonly string[] | null | undefined): boolean {
  const joined = (urls || []).map(key).filter(Boolean).join("\u0001");
  const getSnapshot = useCallback((): boolean => {
    if (!joined) return false;
    loadOnce();
    return joined.split("\u0001").every((u) => noFileUrls.has(u) || hasInferred(u));
  }, [joined]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Exposed for debugging / tests. */
export function getAttachmentNoFileVersion(): number {
  return version;
}

const softProbeCache = new Map<string, { at: number; result: RemoteAttachmentBytesProbe }>();
const inflight = new Map<string, Promise<RemoteAttachmentBytesProbe>>();

async function runProbe(url: string): Promise<RemoteAttachmentBytesProbe> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    let res = await fetch(url, { method: "HEAD", cache: "no-store", signal: ctrl?.signal });
    if (res.status === 405 || res.status === 501) {
      // HEAD not allowed: ask for the first byte only.
      res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Range: "bytes=0-0" },
        signal: ctrl?.signal,
      });
      try {
        void res.body?.cancel();
      } catch {
        /* ignore */
      }
      if (res.status === 416) return "no-bytes";
      const cr = res.headers.get("content-range");
      if (cr && /\/0\s*$/.test(cr)) return "no-bytes";
    }
    if (res.status === 404 || res.status === 410) return "no-bytes";
    if (res.ok) {
      const len = res.headers.get("content-length");
      if (len !== null && len.trim() !== "" && Number(len) === 0) return "no-bytes";
      return "has-bytes";
    }
    return "unknown";
  } catch {
    // network / CORS / abort: cannot tell - never claim "no file".
    return "unknown";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * HEAD-probe a remote https attachment. "no-bytes" = server says the object is gone (404/410)
 * or has zero length. Anything uncertain returns "unknown" (never flags the row).
 */
export function probeRemoteAttachmentBytes(raw: string | null | undefined): Promise<RemoteAttachmentBytesProbe> {
  const u = key(raw);
  if (!u || !/^https?:\/\//i.test(u)) return Promise.resolve("unknown");
  loadOnce();
  if (noFileUrls.has(u)) return Promise.resolve("no-bytes");
  const soft = softProbeCache.get(u);
  if (soft && Date.now() - soft.at < PROBE_SOFT_TTL_MS) return Promise.resolve(soft.result);
  const running = inflight.get(u);
  if (running) return running;
  const p = runProbe(u)
    .then((result) => {
      if (result !== "no-bytes") softProbeCache.set(u, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      inflight.delete(u);
    });
  inflight.set(u, p);
  return p;
}