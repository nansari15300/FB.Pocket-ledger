/**
 * Global server quota pause (30 min). Started ONLY by quota / billing errors (resource-exhausted,
 * HTTP 429/402, gRPC 8, storage/quota-exceeded, billing disabled in a server reply). NOT persisted across
 * refresh: every page load starts cleared (stale key removed) and tries the server once normally.
 * The localStorage key only informs other already-open tabs. While active, the sync outbox does not send
 * (rows stay queued locally). When it ends (or is cleared manually) SERVER_QUOTA_HOLD_END_EVENT
 * ("pl-online-trigger-quota-hold") fires and the outbox flush manager resumes.
 *
 * Manual clear: DevTools console `window.__plClearServerQuotaHold()`, or simply reload the page.
 */
export const SERVER_QUOTA_HOLD_MS = 30 * 60 * 1000;
export const SERVER_QUOTA_HOLD_STORAGE_KEY = "pl_online_trigger_quota_hold_until";
export const SERVER_QUOTA_HOLD_END_EVENT = "pl-online-trigger-quota-hold";
export const SERVER_QUOTA_HOLD_CHANGED_EVENT = "pl-server-quota-hold-changed";

let holdUntil = 0;
let loaded = false;
let endTimer: ReturnType<typeof setTimeout> | null = null;

function readStored(): number {
  try {
    const n = Number(localStorage.getItem(SERVER_QUOTA_HOLD_STORAGE_KEY) || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function emit(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(name));
  } catch {
    /* ignore */
  }
}

function armEndTimer(): void {
  if (typeof window === "undefined") return;
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  const wait = holdUntil - Date.now();
  if (wait <= 0) return;
  endTimer = setTimeout(() => {
    endTimer = null;
    const stored = readStored();
    if (stored > Date.now()) {
      holdUntil = stored; // another tab extended it
      armEndTimer();
      return;
    }
    endHold();
  }, Math.min(wait + 50, 2_147_000_000));
}

function endHold(): void {
  holdUntil = 0;
  try {
    localStorage.removeItem(SERVER_QUOTA_HOLD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit(SERVER_QUOTA_HOLD_CHANGED_EVENT);
  emit(SERVER_QUOTA_HOLD_END_EVENT);
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  // Refresh always re-checks the server: drop any stale hold left by a previous load.
  holdUntil = 0;
  try {
    localStorage.removeItem(SERVER_QUOTA_HOLD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== SERVER_QUOTA_HOLD_STORAGE_KEY && e.key !== null) return;
    const was = holdUntil > Date.now();
    holdUntil = readStored();
    const now = holdUntil > Date.now();
    if (now) armEndTimer();
    emit(SERVER_QUOTA_HOLD_CHANGED_EVENT);
    if (was && !now) emit(SERVER_QUOTA_HOLD_END_EVENT);
  });
  (window as unknown as { __plClearServerQuotaHold?: () => void }).__plClearServerQuotaHold = clearServerQuotaHold;
}

/** Cheap (memory read); safe to call per request. */
export function isServerQuotaHoldActive(): boolean {
  ensureLoaded();
  return Date.now() < holdUntil;
}

export function getQuotaHoldUntil(): number {
  ensureLoaded();
  return Date.now() < holdUntil ? holdUntil : 0;
}

let noticeEl: HTMLDivElement | null = null;

/**
 * Small centered notice (plain DOM, no React): card with OK, auto-dismiss after 10s.
 * The full-screen wrapper ignores pointer events, so the rest of the app stays usable.
 */
// Legacy separate card; superseded by quotaAdminNotice.queueQuotaPauseNotice (kept for reference).
export function showQuotaPauseNotice(hhmm: string): void {
  if (typeof document === "undefined") return;
  try {
    noticeEl?.remove();
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-live", "assertive");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;";
    const card = document.createElement("div");
    card.style.cssText =
      "pointer-events:auto;max-width:360px;width:calc(100vw - 32px);background:#fff;color:#0f172a;border:1px solid rgb(16 185 129);" +
      "border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.25);padding:16px;font:14px/1.4 system-ui,sans-serif;text-align:center;";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;margin-bottom:6px;";
    title.textContent = `Server paused due to quota until ${hhmm}`;
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:12px;color:#475569;margin-bottom:12px;";
    desc.textContent = "Changes are saved on this device and will sync automatically when the pause ends.";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    ok.style.cssText =
      "min-width:72px;height:32px;border-radius:6px;border:0;background:rgb(16 185 129);color:#fff;font-weight:600;cursor:pointer;";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      wrap.remove();
      if (noticeEl === wrap) noticeEl = null;
    };
    ok.addEventListener("click", close);
    card.append(title, desc, ok);
    wrap.append(card);
    document.body.appendChild(wrap);
    noticeEl = wrap;
    timer = setTimeout(close, 20_000);
  } catch {
    /* ignore */
  }
}

/** Module state = per page load (reset on refresh / app restart). */
let quotaPauseNoticeShownThisPageLoad = false;

/** Start a fresh hold (no-op while one is active). Returns true when a new hold started. */
export function startServerQuotaHold(): boolean {
  ensureLoaded();
  if (Date.now() < holdUntil) return false;
  holdUntil = Date.now() + SERVER_QUOTA_HOLD_MS;
  try {
    localStorage.setItem(SERVER_QUOTA_HOLD_STORAGE_KEY, String(holdUntil));
  } catch {
    /* ignore */
  }
  armEndTimer();
  emit(SERVER_QUOTA_HOLD_CHANGED_EVENT);
  const until = new Date(holdUntil);
  const hhmm = `${String(until.getHours()).padStart(2, "0")}:${String(until.getMinutes()).padStart(2, "0")}`;
  // "Server paused" card: only for the first hold started after a page load / app restart.
  if (!quotaPauseNoticeShownThisPageLoad) {
    // Startup only (never from a user save or later background work) - see quotaAdminNotice.quotaPopupAllowedNow.
    void import("@/lib/quotaAdminNotice")
      .then((m) => {
        if (!m.quotaPopupAllowedNow() || quotaPauseNoticeShownThisPageLoad) return;
        quotaPauseNoticeShownThisPageLoad = true;
        // One combined centered popup with the admin quota details (coalesced ~1.5s in quotaAdminNotice).
        m.queueQuotaPauseNotice(hhmm);
      })
      .catch(() => undefined);
  }
  return true;
}

/** Manual resume (also exposed as window.__plClearServerQuotaHold). */
export function clearServerQuotaHold(): void {
  ensureLoaded();
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  endHold();
}