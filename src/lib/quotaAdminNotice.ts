/**
 * Quota / billing errors (Storage storage/quota-exceeded 402, Firestore resource-exhausted, billing disabled):
 * never console.error'd (firebase.ts filter swallows them, so no Next.js dev overlay). Instead a small
 * centered card is shown ONLY to super admins (existing check: signed-in email in getSuperAdminEmails()).
 * Throttled: max once per 30 min per error kind. Plain DOM, cheap, non-blocking.
 */
import { getSuperAdminEmails } from "@/lib/superAdminEmails";

const THROTTLE_MS = 30 * 60 * 1000;
const lastShown = new Map<string, number>();
let cardEl: HTMLDivElement | null = null;

const STORAGE_QUOTA_RE = /storage\/quota-exceeded|quota for bucket/i;
const FIRESTORE_QUOTA_RE = /resource[-_ ]?exhausted/i;
const BILLING_RE = /billing account|billing is disabled|billing has been disabled|billing_disabled|billing not enabled|requires billing/i;

/** Which quota/billing kind a console/rejection text is, or null if it is not one. */
export function quotaErrorKind(text: string): "storage" | "firestore" | "billing" | null {
  const t = String(text || "");
  if (STORAGE_QUOTA_RE.test(t)) return "storage";
  if (BILLING_RE.test(t) && /firebase|firestore|storage/i.test(t)) return "billing";
  if (FIRESTORE_QUOTA_RE.test(t)) return "firestore";
  return null;
}

function isSuperAdminEmail(email: string | null | undefined): boolean {
  const e = String(email || "").toLowerCase().trim();
  if (!e) return false;
  return getSuperAdminEmails().some((x) => (x || "").toLowerCase().trim() === e);
}

function shortMessage(text: string): string {
  const m = /Firebase Storage:[^"(]*(?:\([^)]*\))?|Quota[^"]{0,160}|resource[-_ ]?exhausted[^"]{0,120}/i.exec(text);
  const s = (m ? m[0] : text).replace(/\s+/g, " ").trim();
  return s.length > 220 ? s.slice(0, 219) + "\u2026" : s;
}

/**
 * Popups (admin quota card + "Server paused" card) only at page load / app start: a quota error detected within
 * STARTUP_WINDOW_MS of this module loading (initial listeners / first outbox flush / startup probe). Never from a
 * user-initiated save/edit/approve (noteUserInitiatedServerAction) or later background work in the session.
 */
const PAGE_LOADED_AT = Date.now();
const STARTUP_WINDOW_MS = 20_000;
let userActionStarted = false;

/** Call when the user starts a save/edit/approve: popups are suppressed for the rest of this page load. */
export function noteUserInitiatedServerAction(): void {
  userActionStarted = true;
}

export function quotaPopupAllowedNow(): boolean {
  if (userActionStarted) return false;
  return Date.now() - PAGE_LOADED_AT <= STARTUP_WINDOW_MS;
}

/** Module state = per page load (reset on refresh / app restart). */
const quotaKindsSeenThisPageLoad = new Set<string>();

/** True after any quota/billing error this page load (admin popup gating does not apply). */
export function hasQuotaErrorThisPageLoad(): boolean {
  return quotaKindsSeenThisPageLoad.size > 0;
}

export function notifyQuotaErrorForAdmin(text: string, userEmail: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const kind = quotaErrorKind(text);
  if (!kind) return;
  quotaKindsSeenThisPageLoad.add(kind);
  // Only the FIRST quota detection after a page load / app restart may show the popup. Later errors in the
  // same page session stay silent (30-min pause + local save still happen elsewhere).
  if (!quotaPopupAllowedNow()) return;
  if (!isSuperAdminEmail(userEmail)) return;
  const now = Date.now();
  if (now - (lastShown.get(kind) || 0) < THROTTLE_MS) return;
  lastShown.set(kind, now);
  const item = {
    kind,
    title:
      kind === "storage" ? "Firebase Storage quota exceeded" : kind === "billing" ? "Firebase billing issue" : "Firestore quota exceeded",
    message:
      kind === "firestore"
        ? "Firestore quota exceeded (resource-exhausted). Server reads/writes are paused for 30 min."
        : shortMessage(text),
  };
  if (!pendingPopup.admin.some((a) => a.kind === kind)) pendingPopup.admin.push(item);
  scheduleCombinedQuotaPopup();
}

/* ---------- One combined popup (pause card + admin quota details), coalesced ~1.5s ---------- */

type AdminQuotaItem = { kind: string; title: string; message: string };
const pendingPopup: { pauseHhmm: string | null; admin: AdminQuotaItem[] } = { pauseHhmm: null, admin: [] };
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
const COALESCE_MS = 1500;

/** serverQuotaHold calls this instead of showing its own card. */
export function queueQuotaPauseNotice(hhmm: string): void {
  if (typeof document === "undefined") return;
  pendingPopup.pauseHhmm = hhmm;
  scheduleCombinedQuotaPopup();
}

function scheduleCombinedQuotaPopup(): void {
  if (cardEl) {
    // Already showing (late arrival in the same burst): re-render merged content, keep same OK/timer.
    renderCombinedQuotaPopup(false);
    return;
  }
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    renderCombinedQuotaPopup(true);
  }, COALESCE_MS);
}

function renderCombinedQuotaPopup(fresh: boolean): void {
  if (typeof document === "undefined") return;
  const { pauseHhmm, admin } = pendingPopup;
  if (!pauseHhmm && admin.length === 0) return;
  try {
    cardEl?.remove();
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-live", "assertive");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;";
    const card = document.createElement("div");
    card.style.cssText =
      "pointer-events:auto;max-width:420px;width:calc(100vw - 32px);background:#fff;color:#0f172a;border:1px solid " +
      (admin.length ? "rgb(239 68 68)" : "rgb(16 185 129)") +
      ";border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.25);padding:16px;font:14px/1.4 system-ui,sans-serif;text-align:center;";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;margin-bottom:6px;";
    title.textContent = pauseHhmm
      ? `Server paused due to quota until ${pauseHhmm}`
      : admin.map((a) => a.title).join(" + ");
    card.append(title);
    if (pauseHhmm) {
      const desc = document.createElement("div");
      desc.style.cssText = "font-size:12px;color:#475569;margin-bottom:10px;";
      desc.textContent = "Changes are saved on this device and will sync automatically when the pause ends.";
      card.append(desc);
    }
    if (admin.length) {
      const sec = document.createElement("div");
      sec.style.cssText =
        "font-size:12px;color:#7f1d1d;background:#fef2f2;border-radius:6px;padding:8px;margin-bottom:12px;text-align:left;word-break:break-word;";
      const h = document.createElement("div");
      h.style.cssText = "font-weight:600;margin-bottom:4px;";
      h.textContent = "Admin: detected quota issue" + (admin.length > 1 ? "s" : "");
      sec.append(h);
      for (const a of admin) {
        const row = document.createElement("div");
        row.style.cssText = "margin-top:2px;";
        const b = document.createElement("b");
        b.textContent = a.title + ": ";
        row.append(b, document.createTextNode(a.message));
        sec.append(row);
      }
      const foot = document.createElement("div");
      foot.style.cssText = "margin-top:4px;color:#94a3b8;";
      foot.textContent = "(admin only; hidden from console)";
      sec.append(foot);
      card.append(sec);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    ok.style.cssText =
      "min-width:72px;height:32px;border-radius:6px;border:0;background:rgb(16 185 129);color:#fff;font-weight:600;cursor:pointer;";
    const close = () => {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      wrap.remove();
      if (cardEl === wrap) cardEl = null;
      pendingPopup.pauseHhmm = null;
      pendingPopup.admin = [];
    };
    ok.addEventListener("click", close);
    card.append(ok);
    wrap.append(card);
    document.body.appendChild(wrap);
    cardEl = wrap;
    if (fresh || !autoCloseTimer) {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(close, 20_000);
    } else {
      // re-render: rebind the running auto-close to the new element
      clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(close, 20_000);
    }
  } catch {
    /* ignore */
  }
}
