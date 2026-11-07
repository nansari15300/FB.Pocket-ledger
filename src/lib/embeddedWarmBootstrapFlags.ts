"use client";

import { withoutWebAppBasePath } from "@/lib/webAppBasePath";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { VOUCHER_FORM_MASTER_COLLECTION_PATHS } from "@/lib/ledgerActiveMasterCollections";

/**
 * APK + EXE: background sync/outbox bina poori registry+listener rebuild — page shake / auto re-render kam.
 */
export function embeddedClientPrefersQuietBackgroundSync(): boolean {
  return isElectronDesktopApp() || isCapacitorNativeApp();
}

/** APK/EXE ledger screens — background SQLite bump sirf in collections se merge (staff/items par page shake kam). */
export function sqliteBumpCollectionNeededOnLedgerRoute(pathname: string, collection: string): boolean {
  const route = withoutWebAppBasePath(String(pathname || "")).toLowerCase();
  const coll = String(collection || "").trim();
  if (route.startsWith("/party")) {
    return coll === "parties" || coll === "groups" || coll === "vouchers" || coll === "expense_accounts";
  }
  if (route.startsWith("/bank-cash")) {
    return coll === "bank_accounts" || coll === "account_groups" || coll === "vouchers";
  }
  if (route.startsWith("/dashboard")) {
    return (
      coll === "vouchers" ||
      coll === "parties" ||
      coll === "groups" ||
      coll === "staff" ||
      coll === "staff_groups" ||
      coll === "taxes" ||
      coll === "tax_groups" ||
      coll === "bank_accounts" ||
      coll === "account_groups" ||
      coll === "expense_accounts"
    );
  }
  if (route.startsWith("/payment-in") || route.startsWith("/payment-out")) {
    return coll === "vouchers" || coll === "parties" || coll === "bank_accounts" || coll === "staff" || coll === "taxes";
  }
  if (route.startsWith("/gallery")) {
    return coll === "vouchers";
  }
  if (route === "/reports" || route === "/reports/" || route.startsWith("/reports/")) {
    return VOUCHER_FORM_MASTER_COLLECTION_PATHS.has(coll);
  }
  return true;
}

/** Party / bank detail — background merge thoda debounce (scroll shake kam). */
export function embeddedSqliteBumpDebounceMs(pathname: string): number {
  if (!embeddedClientPrefersQuietBackgroundSync()) return 1_500;
  const route = withoutWebAppBasePath(String(pathname || "")).toLowerCase();
  if (route.startsWith("/party") || route.startsWith("/bank-cash")) return 2_500;
  return 1_500;
}

/**
 * APK/static: `runOfflineFullWarmSync` ek baar poora ho chuka ho to startup par
 * `getIdToken` + idle plan-sync kam chalao — attachment IndexedDB prefetch / SQLite ko pehle saans.
 * Logout par prefix clear taaki naye session me pehli baar wapas normal bootstrap ho.
 */

const KEY_PREFIX = "pl_embedded_full_warm_ok_v1:";

/** Account / company warm pehle ho chuka? */
export function readEmbeddedFullWarmSucceeded(uid: string | null | undefined): boolean {
  if (typeof window === "undefined" || !uid?.trim()) return false;
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${uid.trim()}`) === "1";
  } catch {
    return false;
  }
}

/** Warm sync successfully finished — current Firebase uid ke liye flag (multi-account safe). */
export function markEmbeddedFullWarmSucceeded(uid: string | null | undefined): void {
  if (typeof window === "undefined" || !uid?.trim()) return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${uid.trim()}`, "1");
  } catch {
    /* private mode / quota */
  }
}

/**
 * Startup par idle plan-sync / token refresh skip — React `user.uid` kabhi `local:…` synthetic hota hai
 * jabki warm flag Firebase `auth.currentUser.uid` pe lagta hai; dono me se koi bhi match ho to skip.
 */
export function shouldSkipEmbeddedStartupAuthChurn(
  uidFromReact: string | null | undefined,
  uidFromAuth: string | null | undefined
): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (const u of [uidFromReact, uidFromAuth]) {
      const t = u?.trim();
      if (t && window.localStorage.getItem(`${KEY_PREFIX}${t}`) === "1") return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Logout: saare warm-ok flags hatao taaki agli login pe pehla session phir se aggressive sync kar sake. */
export function clearEmbeddedWarmBootstrapFlags(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
