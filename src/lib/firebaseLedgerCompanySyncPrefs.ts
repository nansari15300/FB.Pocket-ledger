"use client";

import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";

export const FIREBASE_LEDGER_COMPANY_SYNC_PREFS_KEY = "pl_firebase_ledger_company_sync_prefs_v1";
export const FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT =
  "pl-firebase-ledger-company-sync-prefs-changed";
export const FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT = "pl-firebase-ledger-company-registry-pull";

export type FirebaseLedgerCompanySyncPrefsChangedDetail = {
  companyIds?: string[];
};

export type FirebaseLedgerCompanySyncEntry = {
  /**
   * Legacy “Sync” column — now mirrors Data (UI no longer shows Sync).
   * Keep field so older builds / listeners stay compatible.
   */
  selected: boolean;
  /** Ledger / SQLite doc sync (no attachment files). Default off until user ticks + Save. */
  data: boolean;
  /** Attachment file download / prefetch — requires Data + Files tick. */
  attachments: boolean;
};

export type FirebaseLedgerCompanySyncPrefs = {
  companies: Record<string, FirebaseLedgerCompanySyncEntry>;
};

const EMPTY_ENTRY: FirebaseLedgerCompanySyncEntry = {
  selected: false,
  data: false,
  attachments: false,
};

function normalizeEntry(raw: unknown): FirebaseLedgerCompanySyncEntry {
  if (!raw || typeof raw !== "object") return { ...EMPTY_ENTRY };
  const row = raw as Partial<FirebaseLedgerCompanySyncEntry>;
  // Data is the user-facing tick; selected follows data (Sync column removed).
  const data = row.data === true;
  const attachments = data && row.attachments === true;
  return { selected: data, data, attachments };
}

export function readFirebaseLedgerCompanySyncPrefs(): FirebaseLedgerCompanySyncPrefs {
  if (typeof window === "undefined") return { companies: {} };
  try {
    const raw = window.localStorage.getItem(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_KEY);
    if (!raw) return { companies: {} };
    const parsed = JSON.parse(raw) as { companies?: Record<string, unknown> };
    const companies: Record<string, FirebaseLedgerCompanySyncEntry> = {};
    for (const [id, entry] of Object.entries(parsed.companies || {})) {
      const cid = String(id || "").trim();
      if (!cid) continue;
      companies[cid] = normalizeEntry(entry);
    }
    return { companies };
  } catch {
    return { companies: {} };
  }
}

export function saveFirebaseLedgerCompanySyncPrefs(
  prefs: FirebaseLedgerCompanySyncPrefs,
  detail?: FirebaseLedgerCompanySyncPrefsChangedDetail
): void {
  if (typeof window === "undefined") return;
  const companies: Record<string, FirebaseLedgerCompanySyncEntry> = {};
  for (const [id, entry] of Object.entries(prefs.companies || {})) {
    const cid = String(id || "").trim();
    if (!cid) continue;
    companies[cid] = normalizeEntry(entry);
  }
  try {
    window.localStorage.setItem(
      FIREBASE_LEDGER_COMPANY_SYNC_PREFS_KEY,
      JSON.stringify({ companies })
    );
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, {
        detail: detail ?? { companyIds: Object.keys(companies) },
      })
    );
  } catch {
    /* ignore */
  }
}

export function getFirebaseLedgerCompanySyncEntry(companyId: string): FirebaseLedgerCompanySyncEntry {
  const id = String(companyId || "").trim();
  if (!id) return { ...EMPTY_ENTRY };
  return readFirebaseLedgerCompanySyncPrefs().companies[id] ?? { ...EMPTY_ENTRY };
}

export function patchFirebaseLedgerCompanySyncEntry(
  companyId: string,
  patch: Partial<FirebaseLedgerCompanySyncEntry>
): FirebaseLedgerCompanySyncPrefs {
  const id = String(companyId || "").trim();
  const prefs = readFirebaseLedgerCompanySyncPrefs();
  if (!id) return prefs;
  const prev = prefs.companies[id] ?? { ...EMPTY_ENTRY };
  const next = normalizeEntry({ ...prev, ...patch });
  const out = { companies: { ...prefs.companies, [id]: next } };
  saveFirebaseLedgerCompanySyncPrefs(out, { companyIds: [id] });
  return out;
}

/** Replace many company entries at once (Online tab Save). */
export function replaceFirebaseLedgerCompanySyncEntries(
  entries: Record<string, FirebaseLedgerCompanySyncEntry>
): FirebaseLedgerCompanySyncPrefs {
  const prefs = readFirebaseLedgerCompanySyncPrefs();
  const companies = { ...prefs.companies };
  for (const [id, entry] of Object.entries(entries || {})) {
    const cid = String(id || "").trim();
    if (!cid) continue;
    companies[cid] = normalizeEntry(entry);
  }
  const out = { companies };
  saveFirebaseLedgerCompanySyncPrefs(out, { companyIds: Object.keys(entries || {}) });
  return out;
}

function dataSyncEntryEnabledForIds(registryId: string, authoritativeId?: string): boolean {
  const registry = String(registryId || "").trim();
  const auth = String(authoritativeId || "").trim();
  if (registry && getFirebaseLedgerCompanySyncEntry(registry).data === true) return true;
  if (auth && auth !== registry && getFirebaseLedgerCompanySyncEntry(auth).data === true) return true;
  return false;
}

/** Global switch ON + company Data ticked (after Save). */
export function isFirebaseLedgerCompanyDataSyncEnabled(
  companyId: string,
  company?: { authoritativeCompanyId?: string } | null
): boolean {
  if (isFirebaseLedgerDataSyncDisabled()) return false;
  const registry = String(companyId || "").trim();
  if (!registry) return false;
  // Pocket Ledger Server companies: online data is on PocketBase, never Firestore listeners/pulls.
  if (isPocketBaseCompany(registry, company)) return false;
  const auth = String(company?.authoritativeCompanyId || "").trim();
  return dataSyncEntryEnabledForIds(registry, auth || undefined);
}

/**
 * Same global switch + company Data tick as Firebase, for Pocket Ledger Server (PocketBase)
 * companies: outbox push + server pull run only when this is true.
 */
export function isPocketBaseCompanyDataSyncEnabled(
  companyId: string,
  company?: { authoritativeCompanyId?: string } | null
): boolean {
  if (isFirebaseLedgerDataSyncDisabled()) return false;
  const registry = String(companyId || "").trim();
  if (!registry || !isPocketBaseCompany(registry, company)) return false;
  const auth = String(company?.authoritativeCompanyId || "").trim();
  return dataSyncEntryEnabledForIds(registry, auth || undefined);
}

/**
 * Company Selector Files tick — attachment download / prefetch / network fetch of existing cloud files.
 * Untick does NOT block uploading newly added local files (see upload helper).
 */
export function isFirebaseLedgerCompanyAttachmentSyncEnabled(
  companyId: string,
  company?: { authoritativeCompanyId?: string } | null
): boolean {
  if (!isFirebaseLedgerCompanyDataSyncEnabled(companyId, company)) return false;
  const registry = String(companyId || "").trim();
  const auth = String(company?.authoritativeCompanyId || "").trim();
  if (registry && getFirebaseLedgerCompanySyncEntry(registry).attachments === true) return true;
  if (auth && auth !== registry && getFirebaseLedgerCompanySyncEntry(auth).attachments === true) {
    return true;
  }
  return false;
}

/**
 * New/local attachment upload to cloud — requires Data tick only.
 * Files untick stops download; uploads of newly added files still allowed.
 */
export function isFirebaseLedgerCompanyAttachmentUploadEnabled(
  companyId: string,
  company?: { authoritativeCompanyId?: string } | null
): boolean {
  return isFirebaseLedgerCompanyDataSyncEnabled(companyId, company);
}
