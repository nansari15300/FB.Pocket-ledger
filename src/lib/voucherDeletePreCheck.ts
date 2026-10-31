"use client";

import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import type { Company } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import { companyRowUsesSqliteLedgerWrites, isServerGateCompany } from "@/lib/companyStorageKind";
import { isLocalOnlyMode } from "@/lib/localMode";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { parseFirestoreDateFieldToJsDate, resolveVoucherDateForBackdateCheck } from "@/lib/voucherDateNormalize";

export const VOUCHER_DELETE_DEBUG_FILTER = "[VoucherDeleteDebug]";

function errorForVoucherDeleteDebug(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { message: String(error ?? "") };
  const err = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
  return {
    name: typeof err.name === "string" ? err.name : undefined,
    code: typeof err.code === "string" ? err.code : undefined,
    message: typeof err.message === "string" ? err.message : String(error),
  };
}

export function voucherDeleteDebugLog(event: string, data?: Record<string, unknown>): void {
  if (typeof console === "undefined") return;
  console.info(VOUCHER_DELETE_DEBUG_FILTER, event, data ?? {});
}

export function resolveVoucherDeleteBackdateDate(
  voucherData: Record<string, unknown> | null | undefined,
  debug?: Record<string, unknown>
): Date | undefined {
  if (!voucherData) return undefined;
  const rawDate = voucherData["date"];
  const resolved = resolveVoucherDateForBackdateCheck(rawDate);
  if (resolved) {
    voucherDeleteDebugLog("delete_date_resolved", {
      ...debug,
      source: "voucher_date",
      rawType: typeof rawDate,
      iso: resolved.toISOString(),
    });
    return resolved;
  }

  const fallback =
    parseFirestoreDateFieldToJsDate(voucherData["createdAt"]) ??
    parseFirestoreDateFieldToJsDate(voucherData["lastEditedAt"]) ??
    parseFirestoreDateFieldToJsDate(voucherData["updatedAt"]);
  if (fallback) {
    voucherDeleteDebugLog("delete_date_resolved", {
      ...debug,
      source: "entry_timestamp_fallback",
      raw: String(rawDate ?? ""),
      iso: fallback.toISOString(),
    });
    return fallback;
  }

  voucherDeleteDebugLog("delete_date_unresolved", {
    ...debug,
    raw: String(rawDate ?? ""),
  });
  return undefined;
}

/** PL server / SQLite ledger: Firestore voucher read permission-denied se delete block mat karo. */
export function shouldUseSqliteVoucherForDeletePreCheck(
  company: (Company & { plServerShared?: boolean }) | null | undefined
): boolean {
  if (isLocalOnlyMode()) return true;
  if (isPlServerThinStaffClient()) return true;
  if (!company) return false;
  if (String(company.storageOption || "").toLowerCase() === "local") return true;
  if (isServerGateCompany(company)) return true;
  if (companyRowUsesSqliteLedgerWrites(company)) return true;
  return false;
}

async function shouldUseSqliteVoucherForDeletePreCheckAsync(
  companyId: string,
  company: (Company & { plServerShared?: boolean }) | null | undefined
): Promise<boolean> {
  if (shouldUseSqliteVoucherForDeletePreCheck(company)) return true;
  const id = String(companyId || "").trim();
  if (!id) return false;
  try {
    const localRow = await getLocalCompanyById(id, { includeDeleted: true });
    const useSqlite = shouldUseSqliteVoucherForDeletePreCheck(
      localRow as unknown as Company & { plServerShared?: boolean }
    );
    voucherDeleteDebugLog("company_registry_detect", {
      companyId: id,
      found: Boolean(localRow),
      useSqlite,
      storageOption: String((localRow as { storageOption?: unknown } | null)?.storageOption ?? ""),
      plServerShared: (localRow as { plServerShared?: unknown } | null)?.plServerShared === true,
      plServerGateId: String((localRow as { plServerGateId?: unknown } | null)?.plServerGateId ?? ""),
      plServerHostCompanyId: String((localRow as { plServerHostCompanyId?: unknown } | null)?.plServerHostCompanyId ?? ""),
    });
    return useSqlite;
  } catch (e) {
    voucherDeleteDebugLog("company_registry_error", { companyId: id, error: errorForVoucherDeleteDebug(e) });
    return false;
  }
}

export async function loadVoucherDataForDeletePreCheck(args: {
  companyId: string;
  voucherId: string;
  company?: Company | null;
  fallbackVoucher?: Record<string, unknown> | null;
  vouchers?: Array<{ id?: string } & Record<string, unknown>> | null;
}): Promise<{ voucherData: Record<string, unknown> | null; exists: boolean }> {
  const companyId = String(args.companyId || "").trim();
  const voucherId = String(args.voucherId || "").trim();
  voucherDeleteDebugLog("precheck_start", {
    companyId,
    voucherId,
    hasCompany: Boolean(args.company),
    companyStorageOption: String((args.company as { storageOption?: unknown } | null | undefined)?.storageOption ?? ""),
    companyPlServerShared: (args.company as { plServerShared?: unknown } | null | undefined)?.plServerShared === true,
  });
  if (!companyId || !voucherId) {
    voucherDeleteDebugLog("precheck_missing_ids", { companyId, voucherId });
    return { voucherData: null, exists: false };
  }

  const fromMemory =
    args.fallbackVoucher ??
    args.vouchers?.find((v) => String(v.id || "") === voucherId) ??
    null;

  const localRow = await getCompanyDocFromBrowserDb(companyId, "vouchers", voucherId, {
    includeDeleted: true,
  }).catch((e) => {
    voucherDeleteDebugLog("sqlite_read_error", { companyId, voucherId, error: errorForVoucherDeleteDebug(e) });
    return null;
  });

  voucherDeleteDebugLog("precheck_sources", {
    companyId,
    voucherId,
    hasLocalRow: Boolean(localRow),
    hasFallbackVoucher: Boolean(args.fallbackVoucher),
    hasMemoryRow: Boolean(fromMemory),
    localDeleted: (localRow as { isDeleted?: unknown } | null)?.isDeleted === true,
    memoryDeleted: (fromMemory as { isDeleted?: unknown } | null)?.isDeleted === true,
  });

  if (await shouldUseSqliteVoucherForDeletePreCheckAsync(companyId, args.company)) {
    const row = localRow ?? fromMemory;
    voucherDeleteDebugLog("precheck_result_sqlite", {
      companyId,
      voucherId,
      exists: Boolean(row),
      source: localRow ? "sqlite" : fromMemory ? "memory" : "none",
      type: String((row as { type?: unknown } | null)?.type ?? ""),
      voucherNumber: String((row as { voucherNumber?: unknown } | null)?.voucherNumber ?? ""),
      isApproved: (row as { isApproved?: unknown } | null)?.isApproved === true,
    });
    return {
      voucherData: row as Record<string, unknown> | null,
      exists: Boolean(row),
    };
  }

  if (fromMemory || localRow) {
    const row = fromMemory ?? localRow;
    voucherDeleteDebugLog("precheck_result_cached", {
      companyId,
      voucherId,
      source: fromMemory ? "memory" : "sqlite",
      type: String((row as { type?: unknown } | null)?.type ?? ""),
      voucherNumber: String((row as { voucherNumber?: unknown } | null)?.voucherNumber ?? ""),
      isApproved: (row as { isApproved?: unknown } | null)?.isApproved === true,
    });
    return { voucherData: (fromMemory ?? localRow) as Record<string, unknown>, exists: true };
  }

  try {
    const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, voucherId));
    voucherDeleteDebugLog("precheck_result_firestore", {
      companyId,
      voucherId,
      exists: voucherDoc.exists(),
    });
    return {
      voucherData: voucherDoc.exists() ? (voucherDoc.data() as Record<string, unknown>) : null,
      exists: voucherDoc.exists(),
    };
  } catch (e) {
    voucherDeleteDebugLog("firestore_read_error", { companyId, voucherId, error: errorForVoucherDeleteDebug(e) });
    return {
      voucherData: null,
      exists: false,
    };
  }
}
