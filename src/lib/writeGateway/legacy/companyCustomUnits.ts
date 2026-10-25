"use client";

/**
 * Company-level unit labels for voucher lines (Sale/Purchase): merge item-derived units with
 * `companies/{id}.customUnits` so "+ Add unit" persists and dropdowns stay deduped (case-insensitive).
 */

import { doc, updateDoc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { updateCompanyDocRoot } from "@/lib/companyDocsClient";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  companyRootSettingsUseLocalStore,
  type PersistCompanyRootSettingsResult,
} from "@/lib/persistCompanyRootSettings";
import { shouldPersistPermissionConfigViaPlServerHost } from "@/lib/plServerCompanyMetaSync";
/** Normalize Firestore/local JSON into string[] (ignores non-strings). */
export function parseCustomUnitsArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Dedupe by lowercase; first spelling wins. Sorted A–Z for stable dropdown order.
 */
export function mergeUnitsForDropdown(...groups: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const g of groups) {
    for (const u of g) {
      const t = (u || "").trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Whether `units` contains `value` (case-insensitive). */
export function unitListHas(units: string[], value: string | undefined | null): boolean {
  if (value == null || value === "") return true;
  const k = value.trim().toLowerCase();
  if (!k) return true;
  return units.some((u) => u.trim().toLowerCase() === k);
}

type CompanyStorageLike = {
  id?: string;
  storageOption?: string | null;
  syncedFromCloud?: boolean;
  syncPolicy?: string | null;
  plServerShared?: boolean;
  authoritativeCompanyId?: string;
} | null | undefined;

export type PersistCustomUnitOptions = {
  companyId: string | null | undefined;
  /** Active company row — routes local vs online persistence (same as company root settings). */
  company?: CompanyStorageLike;
  /** Trimmed unit label from combobox (add-new or pick). */
  unitLabel: string;
  /** After SQLite / Firestore write — refresh `useCompany` local registry. */
  reloadLocalCompanyRegistry: () => void;
  /** Online: bump Firestore listeners if needed (optional). */
  triggerSync?: () => void;
};

/**
 * Append `unitLabel` to company `customUnits` if not already present (case-insensitive).
 * Local / PL / offline company → SQLite registry; online → Firestore `companies/{id}`.
 */
export async function persistCustomUnitIfNew(
  opts: PersistCustomUnitOptions
): Promise<PersistCompanyRootSettingsResult | void> {
  const { companyId, company, unitLabel, reloadLocalCompanyRegistry, triggerSync } = opts;
  const t = unitLabel.trim();
  if (!t || !companyId) return;

  const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
  const companyLike = company ?? localRow;
  const companyForStore = companyLike as {
    storageOption?: string;
    syncedFromCloud?: boolean;
    plServerShared?: boolean;
    syncPolicy?: string;
    authoritativeCompanyId?: string;
  } | null | undefined;
  const preferLocal =
    companyRootSettingsUseLocalStore(companyForStore) ||
    (await shouldPersistPermissionConfigViaPlServerHost(companyId, companyForStore));

  if (preferLocal) {
    if (!localRow) return;
    const prev = parseCustomUnitsArray(localRow.customUnits);
    if (prev.some((u) => u.toLowerCase() === t.toLowerCase())) return;
    const merged = mergeUnitsForDropdown(prev, [t]);
    await upsertLocalCompany({
      ...localRow,
      customUnits: merged,
      id: companyId,
      updatedAt: Date.now(),
    } as LocalCompanyDoc);
    void updateCompanyDocRoot(companyId, { customUnits: merged });
    reloadLocalCompanyRegistry();
    triggerSync?.();
    return "local";
  }

  const ref = doc(firestore, "companies", companyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const fromServer = parseCustomUnitsArray(snap.data()?.customUnits);
  if (fromServer.some((u) => u.toLowerCase() === t.toLowerCase())) return;
  const merged = mergeUnitsForDropdown(fromServer, [t]);
  await updateDoc(ref, { customUnits: merged });
  try {
    if (localRow) {
      await upsertLocalCompany({
        ...localRow,
        customUnits: merged,
        id: companyId,
        updatedAt: Date.now(),
      } as LocalCompanyDoc);
    }
  } catch {
    /* online-only / no local DB */
  }
  reloadLocalCompanyRegistry();
  triggerSync?.();
  return "firestore";
}
