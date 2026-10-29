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

export function isPackedServerManageCompany(
  c: { id?: unknown; name?: unknown } | null | undefined
): boolean {
  if (!c) return false;
  if (String(c.id || "").trim() === SERVER_MANAGE_COMPANY_ID) return true;
  return String(c.name || "").trim().toLowerCase() === SERVER_MANAGE_COMPANY_NAME;
}

export function filterPackedMyCompanyRows<T extends { id?: unknown; name?: unknown }>(rows: T[]): T[] {
  if (isCountryPublicPackedApp()) {
    return rows.filter((row) => !isPackedServerManageCompany(row));
  }
  if (!isPlServerPackedApp()) return rows;
  return rows.filter((row) => isPackedServerManageCompany(row));
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
