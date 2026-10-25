"use client";

/**
 * "Login as recovery mode?" session marker (desktop app only, super admin only).
 * While it is set, the app shows only the /recovery page: the root page, the app pages and the
 * admin pages all send the user there. Back / Logout on that page clears it.
 * The marker only opens the read-only list of this PC's SQLite companies; every upload is checked
 * again by the server (main admin token required).
 */

import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

const KEY = "pl_recovery_mode_v1";
export const RECOVERY_ROUTE = "/recovery";

export type RecoveryModeState = {
  email: string;
  atMs: number;
  /** The Pocket Ledger Server confirmed the main admin at sign-in (else: sign in to the server before a push). */
  serverVerified: boolean;
};

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  return !!e && getSuperAdminEmails().some((x) => x.trim().toLowerCase() === e);
}

/** The recovery option can be offered at all (desktop app). */
export function recoveryModeSupported(): boolean {
  return isElectronDesktopApp();
}

export function readRecoveryMode(): RecoveryModeState | null {
  if (typeof window === "undefined" || !recoveryModeSupported()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<RecoveryModeState>) : null;
    if (!v || !isSuperAdminEmail(v.email)) return null;
    return { email: String(v.email).toLowerCase(), atMs: Number(v.atMs) || 0, serverVerified: v.serverVerified === true };
  } catch {
    return null;
  }
}

export function isRecoveryModeActive(): boolean {
  return readRecoveryMode() !== null;
}

/** "/recovery", "/recovery/" and "/recovery/index.html" (static export, trailingSlash) are all the recovery page. */
export function isRecoveryRoutePath(pathname: string | null | undefined): boolean {
  const p = String(pathname || "")
    .split(/[?#]/)[0]
    .replace(/\/index\.html?$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/\/+$/, "");
  return p === RECOVERY_ROUTE || p.startsWith(`${RECOVERY_ROUTE}/`);
}

const REDIRECT_GUARD_KEY = "pl_recovery_redirect_guard_v1";
const REDIRECT_GUARD_WINDOW_MS = 10_000;
const REDIRECT_GUARD_MAX = 6;

/**
 * Safety guard for recovery-mode redirects in this tab: false once there were too many in a short
 * time, so a redirect ping-pong stops instead of reloading the page over and over.
 */
export function allowRecoveryRedirect(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(REDIRECT_GUARD_KEY);
    const prev = raw ? (JSON.parse(raw) as { n?: number; t?: number }) : null;
    const startedAt = Number(prev?.t) || 0;
    const fresh = startedAt > 0 && now - startedAt < REDIRECT_GUARD_WINDOW_MS;
    const n = fresh ? (Number(prev?.n) || 0) + 1 : 1;
    window.sessionStorage.setItem(REDIRECT_GUARD_KEY, JSON.stringify({ n, t: fresh ? startedAt : now }));
    return n <= REDIRECT_GUARD_MAX;
  } catch {
    return true;
  }
}

export function writeRecoveryMode(state: RecoveryModeState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state) window.localStorage.setItem(KEY, JSON.stringify(state));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}