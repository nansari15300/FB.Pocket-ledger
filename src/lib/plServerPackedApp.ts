import {
  currentAppHostname,
  detectCountryFromHost,
  isCountryPublicAppHost,
} from "@/lib/countryAppHosts";

/**
 * True when this bundle was packed into Pocket Ledger Server `pb_public/app`
 * (`PL_SERVER_PACK=1`). Same origin as the server panel — not EXE/APK/hosted web.
 */
export function isPlServerPackedApp(): boolean {
  return process.env.NEXT_PUBLIC_PL_SERVER_PACK === "1";
}

function packedAppHost(): string {
  return currentAppHostname();
}

/** `{cc}.pocket-ledger.com` (np, in, …) = normal companies on that country server — not My Company books. */
export function isCountryPublicPackedApp(): boolean {
  return isPlServerPackedApp() && isCountryPublicAppHost(packedAppHost());
}

/** nepal / np.pocket-ledger.com = Nepal public packed app. */
export function isNepalPublicPackedApp(): boolean {
  if (!isCountryPublicPackedApp()) return false;
  return detectCountryFromHost(packedAppHost())?.cc === "np";
}

/** Server panel / servernp / local :8090 — only "server manage company". */
export function isPackedMyCompanyOnly(): boolean {
  if (!isPlServerPackedApp()) return false;
  return !isCountryPublicPackedApp();
}

/** Packed My Company — only this company (server books), never SuperAdmin's other ledgers. */
export const SERVER_MANAGE_COMPANY_NAME = "server manage company";
export const SERVER_MANAGE_COMPANY_ID = "server-manage-company";

/** Fixed company-code written by ensureServerManageCompany (only this company ever has it). */
export const SERVER_MANAGE_COMPANY_CODE = "SRVMNGCO";

/**
 * Server-manage company marker: fixed id, then fixed inter-company code, then (legacy) name.
 */
export function isPackedServerManageCompany(
  c: { id?: unknown; name?: unknown; interCompanyCompanyCode?: unknown } | null | undefined
): boolean {
  if (!c) return false;
  if (String(c.id || "").trim() === SERVER_MANAGE_COMPANY_ID) return true;
  if (String(c.interCompanyCompanyCode || "").trim().toUpperCase() === SERVER_MANAGE_COMPANY_CODE) return true;
  return String(c.name || "").trim().toLowerCase() === SERVER_MANAGE_COMPANY_NAME;
}

const SERVER_MANAGE_MODE_KEY = "pl_server_my_company_mode_v1";

/**
 * Normal app (EXE / web / dev :3000) opened from Server panel -> My Company
 * (?from=pl-server). Tab-scoped (sessionStorage) so it never leaks into a normal session.
 */
export function isServerManageCompanyModeActive(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(SERVER_MANAGE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markServerManageCompanyMode(on: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (on) window.sessionStorage.setItem(SERVER_MANAGE_MODE_KEY, "1");
    else window.sessionStorage.removeItem(SERVER_MANAGE_MODE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when only the server-manage company may be shown (server area). */
export function isServerManageOnlyScope(): boolean {
  if (isPlServerPackedApp()) return isPackedMyCompanyOnly();
  return isServerManageCompanyModeActive();
}

export function filterPackedMyCompanyRows<T extends { id?: unknown; name?: unknown; interCompanyCompanyCode?: unknown }>(
  rows: T[]
): T[] {
  if (isCountryPublicPackedApp()) {
    return rows.filter((row) => !isPackedServerManageCompany(row));
  }
  if (isPlServerPackedApp()) {
    return rows.filter((row) => isPackedServerManageCompany(row));
  }
  // Normal app: server-manage company is hidden everywhere, except inside the My Company handoff
  // from the server panel, where ONLY that company is listed.
  if (isServerManageCompanyModeActive()) {
    return rows.filter((row) => isPackedServerManageCompany(row));
  }
  return rows.filter((row) => !isPackedServerManageCompany(row));
}

/** Packed My Company talks to this PocketBase (panel + API), never :3000 / 127.0.0.1 default. */
export function plServerPackedSameOrigin(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.location.origin || "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}
