"use client";

import { updateDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { openDB } from "@/lib/offlineDb";
import {
  approveVoucherWithHistory,
  saveVoucher,
  syncBillWiseAllocationsToTargetVouchers,
  updateVoucherSpendWiseLinks,
  type SaveVoucherApproveOption,
} from "@/lib/writeGateway/voucherActionsClient";
import { applyAdvancesAllocationsToServer, type LinkAdvancesMode } from "@/components/vouchers/LinkAdvancesToVoucherDialog";
import { getPendingMasterIdMapping, type PendingMasterCollection } from "@/lib/localPendingMasters";
import type { Allocation } from "@/lib/payment-allocation-utils";
import { emitLocalMutationEvent, subscribeLocalMutationEvent } from "@/lib/localMutationEvents";
import { isLocalFileRef, uploadPendingLocalFileRef } from "@/lib/localPendingFiles";

const STORE = "pendingVoucherMutations";
export const CURRENT_SAVED_VOUCHER_TOKEN = "__CURRENT_SAVED_VOUCHER__";
const PENDING_VOUCHER_EVENT = "pending-voucher-mutations-updated";

const ACCOUNT_LIKE_MASTER_COLLECTIONS: PendingMasterCollection[] = [
  "parties",
  "bank_accounts",
  "staff",
  "taxes",
  "expense_accounts",
  "items",
];

const VOUCHER_REFERENCE_FIELD_COLLECTIONS: Record<string, PendingMasterCollection[]> = {
  partyId: ["parties"],
  staffId: ["staff"],
  accountId: ACCOUNT_LIKE_MASTER_COLLECTIONS,
  fromAccountId: ACCOUNT_LIKE_MASTER_COLLECTIONS,
  toAccountId: ACCOUNT_LIKE_MASTER_COLLECTIONS,
  expenseAccountId: ["expense_accounts"],
  // Direct income still stores "income account" against the expense_accounts master list.
  incomeAccountId: ["expense_accounts"],
  taxAccountId: ["taxes"],
  itemId: ["items"],
};

export type PendingVoucherSpendWiseUpdate = {
  voucherId: string;
  // Keep reverse spend-wise rows serializable so local-first save can flush them later without rereading dialog state.
  linkedPaymentInIds: string[];
  linkedPaymentInAmounts: Record<string, number>;
};

export type PendingVoucherAdvanceLinkSync = {
  mode: LinkAdvancesMode;
  targetPartyId: string;
  balanceKind?: "tax" | "net" | "all";
  linkedAmounts: Record<string, number>;
  vouchers: any[];
  showOBRow: boolean;
};

export type PendingVoucherSalaryLinkSync = {
  previousSalaryLinkMap?: Record<string, { taxAmount: number; netAmount: number }>;
  salaryLinkMap: Record<string, { taxAmount: number; netAmount: number }>;
  openingBalanceAllocated: number;
};

export type PendingVoucherMutation = {
  id: string;
  companyId: string;
  userId: string;
  voucherData: any;
  voucherId?: string | null;
  previousAllocations?: any[];
  spendWiseUpdates?: PendingVoucherSpendWiseUpdate[];
  advanceLinkSync?: PendingVoucherAdvanceLinkSync;
  salaryLinkSync?: PendingVoucherSalaryLinkSync;
  originalVoucherIdToDelete?: string | null;
  approveAfterSave?: SaveVoucherApproveOption;
  createdAt?: number;
};

function emitPendingVoucherUpdated() {
  // Notify this tab plus sibling tabs so offline-saved vouchers update all open tabs instantly.
  emitLocalMutationEvent(PENDING_VOUCHER_EVENT);
}

export function generatePendingVoucherMutationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pending_voucher_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export async function putPendingVoucherMutation(payload: PendingVoucherMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // Preserve the full local-first save request so every form can flush the same mutation later.
    store.put({ ...payload, createdAt: payload.createdAt ?? Date.now() });
    tx.oncomplete = () => {
      db.close();
      emitPendingVoucherUpdated();
      resolve();
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getPendingVoucherMutations(): Promise<PendingVoucherMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const rows = (req.result || []) as PendingVoucherMutation[];
      resolve(rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function removePendingVoucherMutation(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      emitPendingVoucherUpdated();
      resolve();
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export function subscribePendingVoucherMutations(listener: () => void) {
  // Reuse the shared multi-tab notifier so all tabs react when local pending vouchers change.
  return subscribeLocalMutationEvent(PENDING_VOUCHER_EVENT, listener);
}

export async function syncOnePendingVoucherMutation(
  item: PendingVoucherMutation
): Promise<{ success: boolean; savedId?: string; error?: string }> {
  try {
    // Resolve any nested local master ids before flushing queued vouchers to Firestore.
    const resolvedVoucherData = await resolveVoucherMasterReferences(item.companyId, item.voucherData);
    const uploadedVoucherData = await resolvePendingVoucherFileRefs(item.companyId, resolvedVoucherData);
    const savedDoc = await saveVoucher(
      item.companyId,
      item.userId,
      uploadedVoucherData,
      item.voucherId ?? null,
      item.approveAfterSave
    );

    const savedId = savedDoc.id;

    // Keep conversion/delete side-effects consistent with the live save path after the server write succeeds.
    if (item.originalVoucherIdToDelete) {
      await updateDoc(doc(firestore, `companies/${item.companyId}/vouchers`, item.originalVoucherIdToDelete), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        convertedToType: uploadedVoucherData?.type,
        convertedToVoucherNumber: uploadedVoucherData?.voucherNumber,
      });
    }

    if (Array.isArray(item.spendWiseUpdates) && item.spendWiseUpdates.length > 0) {
      for (const update of item.spendWiseUpdates) {
        // Offline-created vouchers do not know their real Firestore id yet, so resolve the placeholder after save.
        const resolvedIds = update.linkedPaymentInIds.map((id) =>
          id === CURRENT_SAVED_VOUCHER_TOKEN ? savedId : id
        );
        const resolvedAmounts = Object.fromEntries(
          Object.entries(update.linkedPaymentInAmounts).map(([key, value]) => [
            key === CURRENT_SAVED_VOUCHER_TOKEN ? savedId : key,
            value,
          ])
        );
        await updateVoucherSpendWiseLinks(
          item.companyId,
          update.voucherId,
          resolvedIds,
          resolvedAmounts,
          item.userId
        );
      }
    }

    if (Array.isArray(uploadedVoucherData?.allocations)) {
      await syncBillWiseAllocationsToTargetVouchers(
        item.companyId,
        savedId,
        uploadedVoucherData.allocations,
        Array.isArray(item.previousAllocations) ? item.previousAllocations : []
      );
    }

    if (item.advanceLinkSync) {
      // Sale/Purchase local dialogs keep bill-wise allocations outside voucherData, so flush them after the saved voucher id is known.
      await applyAdvancesAllocationsToServer({
        companyId: item.companyId,
        mode: item.advanceLinkSync.mode,
        targetVoucherId: savedId,
        targetPartyId: await resolveLocalVoucherReference(
          item.companyId,
          "partyId",
          item.advanceLinkSync.targetPartyId
        ),
        balanceKind: item.advanceLinkSync.balanceKind,
        linkedAmounts: item.advanceLinkSync.linkedAmounts,
        vouchers: item.advanceLinkSync.vouchers,
        showOBRow: item.advanceLinkSync.showOBRow,
      });
    }

    if (item.salaryLinkSync) {
      const voucherPath = `companies/${item.companyId}/vouchers`;
      const desiredMap = normaliseSalaryLinkMap(item.salaryLinkSync.salaryLinkMap);
      const previousMap = normaliseSalaryLinkMap(item.salaryLinkSync.previousSalaryLinkMap || {});
      // Salary bill-wise sync must mirror the form logic so payment-out source vouchers and OB allocation stay aligned.
      const sourceVoucherIds = new Set<string>([
        ...Object.keys(previousMap),
        ...Object.keys(desiredMap),
      ]);
      for (const paymentOutId of sourceVoucherIds) {
        const poRef = doc(firestore, voucherPath, paymentOutId);
        const snap = await getDoc(poRef);
        if (!snap.exists()) continue;
        const data = snap.data();
        const allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
        const idx = allocations.findIndex((a) => a.voucherId === savedId);
        const desired = desiredMap[paymentOutId] ?? { taxAmount: 0, netAmount: 0 };
        if (desired.taxAmount <= 0 && desired.netAmount <= 0) {
          if (idx >= 0) {
            allocations.splice(idx, 1);
            await updateDoc(poRef, { allocations });
          }
          continue;
        }
        const nextEntry: Allocation = {
          voucherId: savedId,
          amount: desired.taxAmount + desired.netAmount,
          taxAmount: desired.taxAmount,
          netAmount: desired.netAmount,
        };
        if (idx >= 0) allocations[idx] = nextEntry;
        else allocations.push(nextEntry);
        await updateDoc(poRef, { allocations });
      }
      await updateDoc(doc(firestore, voucherPath, savedId), {
        openingBalanceAllocated: Number(item.salaryLinkSync.openingBalanceAllocated) || 0,
      });
    }

    // If the queued mutation represents create+approve, mirror the live path that approves newly created vouchers after save.
    if (item.approveAfterSave && !item.voucherId) {
      await approveVoucherWithHistory(
        item.companyId,
        savedId,
        item.approveAfterSave.approvedByUserId,
        item.approveAfterSave.approvedByName
      );
    }

    // Notify UI so the voucher stays visible until the next Firestore snapshot (avoids 1-sec disappear when going online).
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(VOUCHER_SYNCED_EVENT, {
          detail: { companyId: item.companyId, savedId, voucherData: uploadedVoucherData },
        })
      );
    }
    await removePendingVoucherMutation(item.id);
    return { success: true, savedId };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

/** Last-write-wins: same voucher (id or number) from multiple devices – only sync the latest. */
function pickLatestPerVoucher(pending: PendingVoucherMutation[]): PendingVoucherMutation[] {
  const byKey = new Map<string, PendingVoucherMutation>();
  for (const item of pending) {
    const key = item.voucherId ?? `${item.voucherData?.voucherNumber ?? ""}:${item.voucherData?.type ?? ""}:${item.id}`;
    const existing = byKey.get(key);
    if (!existing || (item.createdAt ?? 0) > (existing.createdAt ?? 0)) byKey.set(key, item);
  }
  return Array.from(byKey.values()).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

const VOUCHER_SYNCED_EVENT = "voucher-synced";

export function subscribeVoucherSynced(handler: (payload: { companyId: string; savedId: string; voucherData: any }) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const custom = e as CustomEvent<{ companyId: string; savedId: string; voucherData: any }>;
    if (custom.detail?.companyId && custom.detail?.savedId) handler(custom.detail);
  };
  window.addEventListener(VOUCHER_SYNCED_EVENT, listener);
  return () => window.removeEventListener(VOUCHER_SYNCED_EVENT, listener);
}

export async function syncPendingVoucherMutations(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingVoucherMutations();
  const toSync = pickLatestPerVoucher(pending);
  let synced = 0;
  let failed = 0;
  for (const item of toSync) {
    const result = await syncOnePendingVoucherMutation(item);
    if (result.success) synced++;
    else failed++;
  }
  return { synced, failed };
}

export async function hasPendingVoucherMutationForVoucher(
  companyId: string,
  voucherId?: string | null
): Promise<boolean> {
  if (!companyId || !voucherId) return false;
  const pending = await getPendingVoucherMutations();
  // Prevent duplicate queue entries for the same voucher until the user decides to save again from the latest draft.
  return pending.some((item) => item.companyId === companyId && item.voucherId === voucherId);
}

export async function getPendingVoucherMutationByVoucherId(
  companyId: string,
  voucherId?: string | null
): Promise<PendingVoucherMutation | null> {
  if (!companyId || !voucherId) return null;
  const pending = await getPendingVoucherMutations();
  return pending.find((item) => item.companyId === companyId && item.voucherId === voucherId) ?? null;
}

export async function getLatestVoucherFromServer(
  companyId: string,
  voucherId: string
): Promise<any | null> {
  const snap = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, voucherId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function normaliseSalaryLinkMap(map: Record<string, { taxAmount: number; netAmount: number }>) {
  return Object.entries(map).reduce<Record<string, { taxAmount: number; netAmount: number }>>((acc, [voucherId, value]) => {
    const taxAmount = Number(value?.taxAmount) || 0;
    const netAmount = Number(value?.netAmount) || 0;
    if (taxAmount > 0 || netAmount > 0) {
      acc[voucherId] = { taxAmount, netAmount };
    }
    return acc;
  }, {});
}

async function resolveVoucherMasterReferences(companyId: string, value: any, fieldName?: string): Promise<any> {
  if (Array.isArray(value)) {
    const resolvedEntries = await Promise.all(
      value.map((entry) => resolveVoucherMasterReferences(companyId, entry))
    );
    return resolvedEntries;
  }
  if (value instanceof Date || value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return resolveLocalVoucherReference(companyId, fieldName, value);
  }
  if (typeof value !== "object") {
    return value;
  }

  const resolvedObject: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    // Walk the full voucher payload so nested arrays like lineItems/entries/rawMaterials also get resolved.
    resolvedObject[key] = await resolveVoucherMasterReferences(companyId, nestedValue, key);
  }
  return resolvedObject;
}

async function resolveLocalVoucherReference(companyId: string, fieldName: string | undefined, value: string) {
  if (!fieldName || !value.startsWith("local_")) {
    return value;
  }
  const collections = VOUCHER_REFERENCE_FIELD_COLLECTIONS[fieldName];
  if (!collections?.length) {
    return value;
  }
  for (const collection of collections) {
    const resolvedId = await getPendingMasterIdMapping(companyId, collection, value);
    if (resolvedId) {
      return resolvedId;
    }
  }
  throw new Error(`Unresolved local voucher reference for ${fieldName}: ${value}`);
}

async function resolvePendingVoucherFileRefs(companyId: string, value: any): Promise<any> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => resolvePendingVoucherFileRefs(companyId, entry)));
  }
  if (value instanceof Date || value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (!isLocalFileRef(value)) return value;
    // Upload queued offline attachments into the voucher file area before the server voucher write.
    return uploadPendingLocalFileRef(value, `voucher-files/${companyId}`);
  }
  if (typeof value !== "object") {
    return value;
  }

  const resolvedObject: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    // Walk the whole voucher payload so any nested local file refs become durable URLs during sync.
    resolvedObject[key] = await resolvePendingVoucherFileRefs(companyId, nestedValue);
  }
  return resolvedObject;
}
