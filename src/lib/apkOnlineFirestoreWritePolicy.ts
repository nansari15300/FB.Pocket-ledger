"use client";

/**
 * Embedded (Capacitor APK + static web export): ledger writes hamesha SQLite/outbox-first — online/offline same path.
 * `writeEntity` / `saveVoucher` isi module se align; user "Server writes" toggle hata diya gaya.
 */

import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { companyRowUsesSqliteLedgerWrites } from "@/lib/companyStorageKind";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { companyStrategyUsesSqliteFirstLedgerWrites } from "@/lib/staticAttachmentDisplayUrl";
import { isFirebaseLedgerDeltaSqliteTransportMode } from "@/lib/firebaseLedgerSyncPolicy";

/**
 * Voucher/attachment pipeline: `navigator.onLine === false` par Storage `uploadBytes` / `getDownloadURL` await mat karo —
 * forms `local:` + IndexedDB stage karein aur `saveVoucher` SQLite/outbox path le (flush pe hydrate).
 */
export function isClientNavigatorOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return !navigator.onLine;
}

/** Purana toggle hata — static/APK par kabhi seedha Firestore ledger write force nahi. */
export function shouldForceFirestoreWritesOnStaticOrApk(): boolean {
  return false;
}

/**
 * deltaa (all platforms): vouchers/masters SQLite + outbox.
 * live web online companies: SQLite-first via online attachment strategy + outbox flush.
 */
export function apkEmbeddedSqliteFirstWritesPreferred(): boolean {
  if (isFirebaseLedgerDeltaSqliteTransportMode()) return true;
  // User decision 2026-10-22: WEB behaves like EXE/APK - GLOBAL local-first writes for every company
  // (SQLite-wasm company_docs + sync_outbox, files staged as local: pending, background sync + retries).
  // Emergency kill switch (per browser): localStorage "pl_web_local_first_writes_off" = "1".
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("pl_web_local_first_writes_off") === "1") return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** Voucher forms: duplicate check / backdate — Firestore `getDoc` offline mat. */
export function preferLocalLedgerReads(
  company?: { storageOption?: string | null; syncedFromCloud?: boolean } | null
): boolean {
  if (isPlServerThinStaffClient()) return true;
  if (company && companyRowUsesSqliteLedgerWrites(company)) return true;
  if (company && isOfflineCompanyStorage(company)) return true;
  if (company && companyStrategyUsesSqliteFirstLedgerWrites(company)) return true;
  return isLocalOnlyMode() || apkEmbeddedSqliteFirstWritesPreferred() || isClientNavigatorOffline();
}

/** Outbox enqueue ke baad turant flush — embedded offline par band (console Write spam + hang). */
export function shouldAutoFlushOutboxAfterEnqueue(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isClientNavigatorOffline()) return false;
  return navigator.onLine;
}

/** True sirf Capacitor + company row explicitly `storageOption: local` nahi */
export function apkCloudFirestoreMasterWriteFromCompanyShape(company: { storageOption?: string } | null | undefined): boolean {
  if (!isCapacitorNativeApp() || !company) return false;
  return String(company.storageOption ?? "").toLowerCase() !== "local";
}

/**
 * SQLite/outbox voucher path — local + PL Server + Online Firebase (save local, background sync).
 */
export async function apkCloudCompanyUsesSqliteFirstWrites(companyId: string): Promise<boolean> {
  if (isPlServerThinStaffClient()) return true;
  if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
  const cid = String(companyId || "").trim();
  if (!cid) return false;

  try {
    const row = await getLocalCompanyById(cid, { includeDeleted: true });
    if (row) {
      return companyStrategyUsesSqliteFirstLedgerWrites(row) || companyRowUsesSqliteLedgerWrites(row);
    }
  } catch {
    /* SQLite unavailable — niche fallback */
  }

  if (isStaticAppBuild()) return true;

  if (!isLocalOnlyMode()) return false;
  if (!isCapacitorNativeApp()) return true;
  try {
    const row = await getLocalCompanyById(companyId);
    return String(row?.storageOption ?? "").toLowerCase() === "local";
  } catch {
    return true;
  }
}

/** Master/item forms: mirror `EditItemDialog` / party — `company` sync available */
export function apkEntityWriteUsesLocalSqliteMirror(company: { storageOption?: string; syncedFromCloud?: boolean } | null | undefined): boolean {
  if (isPlServerThinStaffClient()) return true;
  if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
  if (company && companyStrategyUsesSqliteFirstLedgerWrites(company)) return true;
  if (company && companyRowUsesSqliteLedgerWrites(company)) return true;
  if (company && isOfflineCompanyStorage(company)) return true;
  if (!isLocalOnlyMode()) return false;
  if (!company || !isCapacitorNativeApp()) return true;
  return String(company.storageOption ?? "").toLowerCase() === "local";
}

/**
 * Master dialogs: SQLite mirror lists — skip collection `onSnapshot` (billing + offline stability).
 * deltaa: hamesha (web/EXE/APK/iOS). live APK local-only cloud: pehle jaisa.
 */
export function apkCloudEntityMasterReadFromSqliteMirror(
  company: { storageOption?: string } | null | undefined
): boolean {
  if (isPlServerThinStaffClient()) return true;
  if (isFirebaseLedgerDeltaSqliteTransportMode()) return true;
  return apkCloudFirestoreMasterWriteFromCompanyShape(company) && isLocalOnlyMode();
}

/**
 * APK + Firestore company (`storageOption` ≠ local) + device offline ⇒ UI: view-only (Save/Copy/Delete band; Cancel chalu).
 * EXE/desktop: `isCapacitorNativeApp` false — hamesha false.
 * Static build: hamesha local save — view-only kabhi nahi.
 * PlServer staff: SQLite mirror + pending sync — offline Save allowed (online company jaisa).
 */
export function apkCloudCompanyOfflineViewOnly(
  company: { storageOption?: string } | null | undefined,
  navigatorOnline: boolean
): boolean {
  if (isPlServerThinStaffClient()) return false;
  if (!isCapacitorNativeApp() || !company) return false;
  if (String(company.storageOption ?? "").toLowerCase() === "local") return false;
  /** Static/APK embedded: offline par bhi SQLite/outbox — Save band mat karo. */
  if (apkEmbeddedSqliteFirstWritesPreferred()) return false;
  return !navigatorOnline;
}

/** Web dev shell — Capacitor/static/Electron nahi; company routing tests ke liye. */
export function isWebBrowserLedgerShell(): boolean {
  return !isCapacitorNativeApp() && !isStaticAppBuild() && !isElectronDesktopApp();
}
