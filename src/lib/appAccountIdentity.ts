"use client";

import { auth } from "@/lib/plClientSession";

const APP_ACCOUNT_IDENTITY_KEY = "pl_app_account_identity_v1";

export function normalizeAppAccountIdentity(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function readCurrentAppAccountIdentity(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = normalizeAppAccountIdentity(window.localStorage.getItem(APP_ACCOUNT_IDENTITY_KEY));
    if (stored) return stored;
  } catch {
    /* storage can be unavailable */
  }
  try {
    const fromAuth = normalizeAppAccountIdentity(auth.currentUser?.email || auth.currentUser?.uid);
    if (fromAuth) return fromAuth;
  } catch {
    /* auth optional during cold start */
  }
  return "";
}

export function writeCurrentAppAccountIdentity(value: unknown): { changed: boolean; previous: string; current: string } {
  const current = normalizeAppAccountIdentity(value);
  if (typeof window === "undefined") return { changed: false, previous: "", current };
  let previous = "";
  try {
    previous = readCurrentAppAccountIdentity();
    if (current) window.localStorage.setItem(APP_ACCOUNT_IDENTITY_KEY, current);
    else window.localStorage.removeItem(APP_ACCOUNT_IDENTITY_KEY);
  } catch {
    /* storage can be unavailable */
  }
  return { changed: Boolean(previous && current && previous !== current), previous, current };
}
