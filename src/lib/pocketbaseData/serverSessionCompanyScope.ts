"use client";

import { companyUsesPocketBase, isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

/**
 * "Pocket Ledger Server login only" session scope for company lists.
 * Same marker as pbAppSession / firebase.ts (`pl_app_session_kind_v1 === "pocketbase"`).
 * Read live so a PocketBase login without a full remount still hides Firebase company rows.
 */
const PB_APP_SESSION_KIND_KEY = "pl_app_session_kind_v1";

function readServerOnlyLoginMarker(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PB_APP_SESSION_KIND_KEY) === "pocketbase";
  } catch {
    return false;
  }
}

/** True while this browser session is Pocket Ledger Server (PocketBase) login — not Google/Firebase. */
export function isServerOnlyLoginSession(): boolean {
  return readServerOnlyLoginMarker();
}

/** Firebase cloud company row (cached registry / SQLite / shared-with-me) - hidden in a server-only session. */
export function isFirebaseCloudRowHiddenInServerSession(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const row = c as {
    id?: unknown;
    storageOption?: unknown;
    syncedFromCloud?: unknown;
    plServerShared?: unknown;
    onlineServerId?: unknown;
    onlineDataBackend?: unknown;
  };
  if (row.plServerShared === true) return false;
  if (isPocketBaseCompanyId(String(row.id ?? "")) || companyUsesPocketBase(row)) return false;
  if (row.syncedFromCloud === true) return true;
  const so = String(row.storageOption ?? "").toLowerCase().trim();
  return so === "firebase" || so === "drive";
}

/** Drops Firebase company rows when `active` (default: this page is a server-only login session). */
export function filterFirebaseCompaniesForServerSession<T>(
  rows: T[],
  active: boolean = isServerOnlyLoginSession()
): T[] {
  if (!active || !Array.isArray(rows)) return rows;
  return rows.filter((r) => !isFirebaseCloudRowHiddenInServerSession(r));
}