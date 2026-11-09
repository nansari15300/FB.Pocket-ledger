"use client";

import { collection, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { LocalCompanyDoc } from "@/lib/localCompanyStore";
import type { ReconciliationShare, ReconciliationShareScope } from "@/lib/reconciliation/types";
import { isRowInDateRange, shareDocDateRange } from "@/lib/reconciliation/ledgerSnapshot";
import { voucherTouchesPartyLedger } from "@/lib/voucherTouchesPartyLedger";

type CompanyLike = LocalCompanyDoc | Record<string, unknown> | null | undefined;

export type InvitedReconciliationLedger = {
  collection: string;
  accountId: string;
  shareScope: ReconciliationShareScope;
  dateFrom?: string | null;
  dateTo?: string | null;
};

const ENTITY_COLLECTIONS = new Set([
  "parties",
  "bank_accounts",
  "staff",
  "taxes",
  "expense_accounts",
]);

const invitedLedgerCache = new Map<string, { at: number; ledgers: InvitedReconciliationLedger[] }>();
const INVITED_LEDGER_CACHE_MS = 30_000;

function isExplicitLocalOnlyCompanyRow(company: CompanyLike): boolean {
  const c = company ?? {};
  const soRaw = (c as Record<string, unknown>).storageOption;
  const storageOption =
    typeof soRaw === "string" && soRaw.trim() !== "" ? soRaw.toLowerCase().trim() : "";
  const syncPolicy = String((c as Record<string, unknown>).syncPolicy || "").toLowerCase();
  const syncedFromCloud = (c as Record<string, unknown>).syncedFromCloud === true;
  const hasAuthoritative = String((c as Record<string, unknown>).authoritativeCompanyId || "").trim().length > 0;
  return (
    storageOption === "local" &&
    !syncedFromCloud &&
    !hasAuthoritative &&
    syncPolicy !== "online"
  );
}

export type LocalFirebaseReconcileConfig = {
  enabled: boolean;
  blockedByDrive: boolean;
  active: boolean;
};

export function readLocalFirebaseReconcileConfig(company: CompanyLike): LocalFirebaseReconcileConfig {
  const c = company ?? {};
  const enabled = (c as Record<string, unknown>).localFirebaseReconcileEnabled === true;
  const driveConnected =
    (c as Record<string, unknown>).cloudSyncEnabled === true &&
    String((c as Record<string, unknown>).cloudSyncProvider || "").trim().length > 0;
  const active = isExplicitLocalOnlyCompanyRow(c) && enabled && !driveConnected;
  return {
    enabled,
    blockedByDrive: driveConnected,
    active,
  };
}

function ledgersFromShare(companyId: string, share: ReconciliationShare): InvitedReconciliationLedger[] {
  if (share.status !== "linked") return [];
  const cid = String(companyId || "").trim();
  const out: InvitedReconciliationLedger[] = [];
  const scope = share.shareScope ?? "all";
  const base = {
    shareScope: scope,
    dateFrom: share.dateFrom ?? null,
    dateTo: share.dateTo ?? null,
  };
  if (share.senderCompanyId === cid && share.senderAccountId && share.senderCollection) {
    out.push({
      collection: String(share.senderCollection).trim(),
      accountId: String(share.senderAccountId).trim(),
      ...base,
    });
  }
  if (share.receiverCompanyId === cid && share.receiverAccountId && share.receiverCollection) {
    out.push({
      collection: String(share.receiverCollection).trim(),
      accountId: String(share.receiverAccountId).trim(),
      ...base,
    });
  }
  return out;
}

/** Linked reconciliation shares — is company ke invited ledger refs. */
export async function loadInvitedReconciliationLedgers(companyId: string): Promise<InvitedReconciliationLedger[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const cached = invitedLedgerCache.get(cid);
  if (cached && Date.now() - cached.at < INVITED_LEDGER_CACHE_MS) return cached.ledgers;

  const ledgers: InvitedReconciliationLedger[] = [];
  try {
    const snap = await getDocs(
      query(
        collection(firestore, `companies/${cid}/reconciliation_shares`),
        where("status", "==", "linked")
      )
    );
    for (const d of snap.docs) {
      const share = { id: d.id, ...d.data() } as ReconciliationShare;
      ledgers.push(...ledgersFromShare(cid, share));
    }
  } catch {
    /* offline / rules — empty */
  }

  const deduped = Array.from(
    new Map(ledgers.map((l) => [`${l.collection}:${l.accountId}`, l] as const)).values()
  );
  invitedLedgerCache.set(cid, { at: Date.now(), ledgers: deduped });
  return deduped;
}

export function invalidateInvitedReconciliationLedgerCache(companyId?: string): void {
  const cid = String(companyId || "").trim();
  if (cid) invitedLedgerCache.delete(cid);
  else invitedLedgerCache.clear();
}

function voucherRawDateIso(voucher: Record<string, unknown>): string {
  const raw = voucher.date ?? voucher.voucherDate ?? voucher.createdAt;
  if (!raw) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "object" && raw !== null && "toDate" in (raw as Record<string, unknown>)) {
    try {
      const d = (raw as { toDate?: () => Date }).toDate?.();
      return d instanceof Date ? d.toISOString() : "";
    } catch {
      return "";
    }
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

function voucherInLedgerShareScope(voucher: Record<string, unknown>, ledger: InvitedReconciliationLedger): boolean {
  if (ledger.shareScope !== "date_range") return true;
  const iso = voucherRawDateIso(voucher);
  if (!iso) return false;
  const range = shareDocDateRange(ledger);
  return isRowInDateRange(iso, range?.from ?? null, range?.to ?? null);
}

function voucherTouchesInvitedLedger(
  voucher: Record<string, unknown>,
  ledger: InvitedReconciliationLedger
): boolean {
  if (!voucherTouchesPartyLedger(voucher, ledger.accountId)) return false;
  return voucherInLedgerShareScope(voucher, ledger);
}

/** Sirf linked reconciliation ledger + uske vouchers (data-only) Firebase par. */
export async function canReconcileLocalDocViaFirebase(
  company: CompanyLike,
  companyId: string,
  collectionName: string,
  docId: string,
  payload?: Record<string, unknown>
): Promise<boolean> {
  const cfg = readLocalFirebaseReconcileConfig(company);
  if (!cfg.active) return false;

  const collection = String(collectionName || "").trim().toLowerCase();
  const id = String(docId || "").trim();
  if (!collection || !id) return false;

  const ledgers = await loadInvitedReconciliationLedgers(companyId);
  if (ledgers.length === 0) return false;

  if (ENTITY_COLLECTIONS.has(collection)) {
    return ledgers.some((l) => l.collection === collection && l.accountId === id);
  }

  if (collection === "vouchers") {
    const v = payload ?? {};
    return ledgers.some((l) => voucherTouchesInvitedLedger(v, l));
  }

  return false;
}

/** @deprecated use canReconcileLocalDocViaFirebase */
export async function canReconcileLocalCollectionViaFirebase(
  company: CompanyLike,
  collectionName: string
): Promise<boolean> {
  void company;
  void collectionName;
  return false;
}

/** Invited-ledger Firebase flush — attachments / file refs hatao (data-only). */
export function stripAttachmentFieldsForInvitedLedgerReconcile(
  collectionName: string,
  doc: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...doc };
  if (collectionName === "vouchers") {
    delete next.fileUrls;
  } else {
    delete next.fileUrl;
    delete next.avatarUrl;
    delete next.logoUrl;
  }
  return next;
}
