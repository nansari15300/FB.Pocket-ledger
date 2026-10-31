"use client";

/**
 * Pocket Ledger Server (PocketBase) company: pull ALL server files to this device in the background.
 *
 * - One manifest request set (`pl_attachments`: id, file, size, updated) names every file; files that are
 *   not on the device yet are downloaded 3 at a time and kept in IndexedDB (web) / the data folder (EXE, APK).
 *   Nothing is held in RAM: the bytes go straight to the device cache.
 * - Resume: the device cache itself is the checkpoint (a restart re-reads the manifest, skips files already
 *   stored, and continues). A change cursor (`updated`) makes later runs fetch only new / changed files.
 * - New files made by other devices are queued after every data pull and realtime event
 *   (`queuePbFilesSync`, debounced), so they arrive without any click.
 * - Progress: `usePbFilesPullProgress()` (done / total).
 */

import { getValidPocketBaseAuth, pbListAll, pbQuote } from "@/lib/pocketbaseData/pbClient";
import { activePocketBaseCompanyId, isActivePocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { downloadPbAttachmentToDevice, PB_ATTACHMENT_PREFIX } from "@/lib/pocketbaseData/pbAttachments";
import {
  getPbFilesPullProgress,
  resetPbFilesPullProgress,
  setPbFilesPullProgress,
} from "@/lib/pocketbaseData/pbSyncProgress";

type ManifestRow = { id?: string; file?: string; size?: number; updated?: string };
type FilesCursor = { url: string; maxUpdated: string; total: number };

const CURSOR_KEY = "pl_pb_files_cursor_v1:";
const AUTO_OFF_KEY = "pl_pb_files_auto_off_v1:";
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const MAX_CONSECUTIVE_FAILS = 10;

function readCursor(companyId: string): FilesCursor | null {
  try {
    const raw = localStorage.getItem(CURSOR_KEY + companyId);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<FilesCursor>;
    if (!c || typeof c.url !== "string" || typeof c.maxUpdated !== "string") return null;
    return { url: c.url, maxUpdated: c.maxUpdated, total: Number(c.total) || 0 };
  } catch {
    return null;
  }
}
function writeCursor(companyId: string, c: FilesCursor | null): void {
  try {
    if (c) localStorage.setItem(CURSOR_KEY + companyId, JSON.stringify(c));
    else localStorage.removeItem(CURSOR_KEY + companyId);
  } catch {
    /* ignore */
  }
}
export function isPbFilesAutoPullOff(companyId: string): boolean {
  try {
    return localStorage.getItem(AUTO_OFF_KEY + companyId) === "1";
  } catch {
    return false;
  }
}
function setAutoOff(companyId: string, off: boolean): void {
  try {
    if (off) localStorage.setItem(AUTO_OFF_KEY + companyId, "1");
    else localStorage.removeItem(AUTO_OFF_KEY + companyId);
  } catch {
    /* ignore */
  }
}

const running = new Map<string, AbortController>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const rerun = new Set<string>();
let autoRetries = 0;
let persistAsked = false;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

function waitOnline(signal: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      resolve();
    };
    window.addEventListener("online", done, { once: true });
    signal.addEventListener("abort", done, { once: true });
  });
}

async function storageFreeBytes(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    if (typeof est.quota !== "number" || typeof est.usage !== "number") return null;
    return Math.max(0, est.quota - est.usage);
  } catch {
    return null;
  }
}

/** Run one pull now (single flight per company). Resolves when finished / stopped. */
export async function runPbFilesSync(companyId: string, opts?: { full?: boolean; manual?: boolean }): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid || typeof window === "undefined") return;
  if (running.has(cid)) {
    rerun.add(cid);
    return;
  }
  if (!opts?.manual && isPbFilesAutoPullOff(cid)) return;
  const auth = getValidPocketBaseAuth();
  if (!auth || !isActivePocketBaseCompanyId(cid)) return;
  const ac = new AbortController();
  running.set(cid, ac);
  const stillValid = () =>
    !ac.signal.aborted && !!getValidPocketBaseAuth() && isActivePocketBaseCompanyId(cid);
  try {
    if (opts?.manual) setAutoOff(cid, false);
    resetPbFilesPullProgress({ companyId: cid, phase: "listing", message: "Checking server files..." });
    await waitOnline(ac.signal);
    if (!stillValid()) return;

    const { ensurePocketBaseCompany } = await import("@/lib/pocketbaseData/pbSync");
    const companyRec = await ensurePocketBaseCompany(cid);
    const prior = opts?.full ? null : readCursor(cid);
    const cur = prior && prior.url === auth.url ? prior : null;
    let filter = `company = ${pbQuote(companyRec)} && deleted = false && file != ""`;
    if (cur?.maxUpdated) filter += ` && updated >= ${pbQuote(cur.maxUpdated)}`;
    const manifest = await pbListAll<ManifestRow>("pl_attachments", filter, { fields: "id,file,size,updated" });
    if (!stillValid()) return;

    let maxUpdated = cur?.maxUpdated || "";
    const rows: { ref: string; size: number }[] = [];
    for (const m of manifest) {
      const id = String(m.id || "");
      const file = String(m.file || "");
      if (!id || !file) continue;
      rows.push({ ref: `${PB_ATTACHMENT_PREFIX}${id}/${file}`, size: Number(m.size) || 0 });
      const up = String(m.updated || "");
      if (up && up > maxUpdated) maxUpdated = up;
    }

    // Which files are already on the device (resume point)?
    const { isOfflineCachedAttachmentOnDevice } = await import("@/lib/offlineAttachmentUrlCache");
    const todo: { ref: string; size: number }[] = [];
    let done = 0;
    setPbFilesPullProgress({ total: rows.length, done: 0 }, true);
    for (let i = 0; i < rows.length; i += 8) {
      if (!stillValid()) return;
      const chunk = rows.slice(i, i + 8);
      const have = await Promise.all(chunk.map((r) => isOfflineCachedAttachmentOnDevice(r.ref).catch(() => false)));
      chunk.forEach((r, k) => {
        if (have[k]) done++;
        else todo.push(r);
      });
      setPbFilesPullProgress({ done });
    }
    const remainingBytes = todo.reduce((s, r) => s + r.size, 0);
    setPbFilesPullProgress({ done, remainingBytes }, true);

    if (todo.length === 0) {
      if (cur) writeCursor(cid, { url: auth.url, maxUpdated, total: cur.total });
      else writeCursor(cid, { url: auth.url, maxUpdated, total: rows.length });
      setPbFilesPullProgress({ phase: "done", message: "" }, true);
      return;
    }

    // Storage check (warning; the browser tab is paused when the files clearly do not fit).
    if (!persistAsked) {
      persistAsked = true;
      try {
        void navigator.storage?.persist?.();
      } catch {
        /* ignore */
      }
    }
    const free = await storageFreeBytes();
    if (free != null && remainingBytes > 0 && remainingBytes > free * 0.95) {
      const mb = (n: number) => `${Math.ceil(n / 1048576)} MB`;
      setPbFilesPullProgress(
        {
          phase: "paused",
          message: `Not enough free storage: files need about ${mb(remainingBytes)}, free ${mb(free)}. Free some space, then press "Download all files".`,
        },
        true
      );
      return;
    }

    // Download queue
    setPbFilesPullProgress({ phase: "downloading", message: "" }, true);
    let next = 0;
    let failed = 0;
    let missing = 0;
    let consecutiveFails = 0;
    let aborted = false;
    const worker = async () => {
      while (!aborted && stillValid()) {
        const idx = next++;
        if (idx >= todo.length) return;
        const item = todo[idx]!;
        let res: "cached" | "downloaded" | "missing" | "failed" = "failed";
        for (let attempt = 0; attempt < MAX_ATTEMPTS && stillValid(); attempt++) {
          await waitOnline(ac.signal);
          res = await downloadPbAttachmentToDevice(item.ref, ac.signal);
          if (res !== "failed") break;
          await sleep(1200 * 2 ** attempt, ac.signal);
        }
        if (res === "cached" || res === "downloaded") {
          done++;
          consecutiveFails = 0;
          setPbFilesPullProgress({ done, remainingBytes: Math.max(0, remainingBytes - item.size) });
        } else if (res === "missing") {
          missing++;
          setPbFilesPullProgress({ missing });
        } else {
          failed++;
          consecutiveFails++;
          setPbFilesPullProgress({ failed });
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
            aborted = true;
            setPbFilesPullProgress(
              { phase: "error", message: "Files are not being saved (storage full or server unreachable). Will retry later." },
              true
            );
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (!stillValid()) return;

    if (failed === 0 && !aborted) {
      writeCursor(cid, { url: auth.url, maxUpdated, total: (cur ? cur.total : 0) + (cur ? todo.length : rows.length) });
      setPbFilesPullProgress({ phase: "done", message: missing ? `${missing} file(s) are no longer on the server.` : "" }, true);
      autoRetries = 0;
    } else {
      if (!aborted) {
        setPbFilesPullProgress(
          { phase: "error", message: `${failed} file(s) could not be downloaded; retrying later.` },
          true
        );
      }
      // Cursor not advanced: the next run re-reads the manifest and continues from what is on the device.
      if (autoRetries < 3) {
        autoRetries++;
        queuePbFilesSync(cid, { delayMs: 120_000 * autoRetries });
      }
    }
  } catch (e) {
    console.warn("[pbFiles] pull failed", e instanceof Error ? e.message : e);
    setPbFilesPullProgress({ phase: "error", message: "Could not read the server file list; retrying later." }, true);
    if (autoRetries < 3) {
      autoRetries++;
      queuePbFilesSync(cid, { delayMs: 60_000 * autoRetries });
    }
  } finally {
    running.delete(cid);
    if (rerun.delete(cid)) queuePbFilesSync(cid, { delayMs: 1500 });
    if (typeof window !== "undefined" && getPbFilesPullProgress().phase !== "idle") {
      void import("@/lib/attachmentLoadReady").then((m) => m.requestAttachmentUiRefresh()).catch(() => {});
    }
  }
}

/**
 * Queue a (debounced) file pull for the company. Cheap to call after every data pull / realtime event:
 * the run only lists files newer than its cursor and skips what is already on the device.
 */
export function queuePbFilesSync(companyId: string, opts?: { full?: boolean; delayMs?: number }): void {
  const cid = String(companyId || "").trim();
  if (!cid || typeof window === "undefined") return;
  if (isPbFilesAutoPullOff(cid)) {
    if (!getPbFilesPullProgress().autoOff) setPbFilesPullProgress({ autoOff: true, companyId: cid }, true);
    return;
  }
  const prev = timers.get(cid);
  if (prev) clearTimeout(prev);
  timers.set(
    cid,
    setTimeout(() => {
      timers.delete(cid);
      void runPbFilesSync(cid, { full: opts?.full });
    }, Math.max(0, opts?.delayMs ?? 2500))
  );
}

/** App start / sign-in / company switch: continue (or begin) the file pull of the active company. */
export function resumePbFilesSync(): void {
  const cid = activePocketBaseCompanyId();
  if (!cid || !getValidPocketBaseAuth()) return;
  autoRetries = 0;
  queuePbFilesSync(cid, { delayMs: 4000 });
}

/** Stop the running pull (sign-out / switch). */
export function stopPbFilesSync(companyId?: string): void {
  for (const [cid, ac] of Array.from(running)) {
    if (!companyId || cid === companyId) ac.abort();
  }
  for (const [cid, t] of Array.from(timers)) {
    if (!companyId || cid === companyId) {
      clearTimeout(t);
      timers.delete(cid);
    }
  }
}

/** "Download all files" button: start now, re-checking everything (also re-enables the automatic pull). */
export function startPbFilesSyncManual(companyId?: string): void {
  const cid = companyId || activePocketBaseCompanyId();
  if (!cid) return;
  autoRetries = 0;
  void runPbFilesSync(cid, { full: true, manual: true });
}

/** How much of this device's storage the server files use. */
export async function getPbFilesDeviceUsage(): Promise<{ count: number; bytes: number; free: number | null; quota: number | null }> {
  const { scanOrClearOfflineCachedAttachmentsByPrefix } = await import("@/lib/offlineAttachmentUrlCache");
  const { count, bytes } = await scanOrClearOfflineCachedAttachmentsByPrefix(PB_ATTACHMENT_PREFIX, false);
  let free: number | null = null;
  let quota: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && typeof est.quota === "number" && typeof est.usage === "number") {
      quota = est.quota;
      free = Math.max(0, est.quota - est.usage);
    }
  } catch {
    /* ignore */
  }
  return { count, bytes, free, quota };
}

/**
 * "Clear files cache": remove the server files stored on this device (documents / vouchers stay).
 * Files are fetched again one by one when opened; the automatic full pull stays off until the user
 * presses "Download all files".
 */
export async function clearPbFilesCache(): Promise<{ count: number; bytes: number }> {
  stopPbFilesSync();
  const { scanOrClearOfflineCachedAttachmentsByPrefix } = await import("@/lib/offlineAttachmentUrlCache");
  const out = await scanOrClearOfflineCachedAttachmentsByPrefix(PB_ATTACHMENT_PREFIX, true);
  for (const cid of Array.from(new Set([activePocketBaseCompanyId()].filter(Boolean)))) {
    writeCursor(cid, null);
    setAutoOff(cid, true);
  }
  resetPbFilesPullProgress({ phase: "idle", autoOff: true, companyId: activePocketBaseCompanyId() });
  return out;
}
