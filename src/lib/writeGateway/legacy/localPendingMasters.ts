"use client";

import { addDoc, updateDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { collection, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { openDB } from "@/lib/offlineDb";
import { emitLocalMutationEvent, subscribeLocalMutationEvent } from "@/lib/localMutationEvents";
import { isLocalFileRef, uploadPendingLocalFileRef } from "@/lib/localPendingFiles";

const STORE = "pendingMasterMutations";
const MAPPING_STORE = "pendingMasterIdMappings";
const PENDING_MASTER_EVENT = "pending-master-mutations-updated";

export type PendingMasterCollection =
  | "groups"
  | "account_groups"
  | "tax_groups"
  | "staff_groups"
  | "expense_groups"
  | "item_groups"
  | "parties"
  | "staff"
  | "taxes"
  | "bank_accounts"
  | "expense_accounts"
  | "items";

export type PendingMasterReferenceField = {
  field: string;
  collection: PendingMasterCollection;
};

export type PendingMasterMutation = {
  id: string;
  companyId: string;
  collection: PendingMasterCollection;
  operation: "create" | "update";
  localRecord: Record<string, any>;
  serverData: Record<string, any>;
  referenceFields?: PendingMasterReferenceField[];
  openingBalanceSync?: {
    oldOpeningBalance: number;
    newOpeningBalance: number;
  };
  createdAt?: number;
};

type PendingMasterIdMapping = {
  id: string;
  companyId: string;
  collection: PendingMasterCollection;
  localId: string;
  serverId: string;
  createdAt: number;
};

function emitPendingMasterUpdated() {
  // Notify this tab plus sibling tabs so offline-created masters appear live without a manual refresh.
  emitLocalMutationEvent(PENDING_MASTER_EVENT);
}

export function generatePendingMasterMutationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `local_${crypto.randomUUID()}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function putPendingMasterMutation(payload: PendingMasterMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // Persist the local optimistic record so list pages can show it immediately before server sync succeeds.
    store.put({ ...payload, createdAt: payload.createdAt ?? Date.now() });
    tx.oncomplete = () => {
      db.close();
      emitPendingMasterUpdated();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getPendingMasterMutations(): Promise<PendingMasterMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result || []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function removePendingMasterMutation(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      emitPendingMasterUpdated();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function createPendingMasterIdMappingKey(
  companyId: string,
  collection: PendingMasterCollection,
  localId: string
) {
  return `${companyId}:${collection}:${localId}`;
}

async function putPendingMasterIdMapping(
  companyId: string,
  collection: PendingMasterCollection,
  localId: string,
  serverId: string
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAPPING_STORE, "readwrite");
    const store = tx.objectStore(MAPPING_STORE);
    // Persist local->server IDs so parent pending records can resolve references after refresh/retry.
    const payload: PendingMasterIdMapping = {
      id: createPendingMasterIdMappingKey(companyId, collection, localId),
      companyId,
      collection,
      localId,
      serverId,
      createdAt: Date.now(),
    };
    store.put(payload);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getPendingMasterIdMapping(
  companyId: string,
  collection: PendingMasterCollection,
  localId: string
): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAPPING_STORE, "readonly");
    const store = tx.objectStore(MAPPING_STORE);
    const req = store.get(createPendingMasterIdMappingKey(companyId, collection, localId));
    req.onsuccess = () => {
      db.close();
      resolve(req.result?.serverId ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function syncOnePendingMasterMutation(
  item: PendingMasterMutation
): Promise<{ success: boolean; error?: string }> {
  try {
    const resolvedServerData = { ...item.serverData };
    // Resolve nested local IDs before flushing so dependent offline-created masters can sync in order.
    for (const refField of item.referenceFields ?? []) {
      const currentValue = resolvedServerData[refField.field];
      if (typeof currentValue !== "string" || !currentValue.startsWith("local_")) continue;
      const resolvedId = await getPendingMasterIdMapping(item.companyId, refField.collection, currentValue);
      if (!resolvedId) {
        return {
          success: false,
          error: `Unresolved local reference for ${refField.field}: ${currentValue}`,
        };
      }
      resolvedServerData[refField.field] = resolvedId;
    }
    // Replace any queued local file refs with real storage URLs before writing the master document to Firestore.
    const uploadedServerData = await resolvePendingMasterFileRefs(item.companyId, item.collection, resolvedServerData);
    if (item.operation === "create") {
      const docRef = await addDoc(collection(firestore, `companies/${item.companyId}/${item.collection}`), {
        ...uploadedServerData,
        // Always stamp server create time during flush so queued local rows settle into the normal collection shape.
        createdAt: serverTimestamp(),
      });
      if (
        ["parties", "bank_accounts", "staff", "taxes", "expense_accounts"].includes(item.collection) &&
        Math.abs(Number(uploadedServerData.openingBalance) || 0) > 0.01
      ) {
        // Mirror the online create side-effect so offline-created masters keep opening-balance capital in sync after flush.
        const { balanceOpeningBalanceWithCapital } = await import("@/lib/voucherActionsClient");
        await balanceOpeningBalanceWithCapital(
          item.companyId,
          item.collection as "parties" | "bank_accounts" | "staff" | "taxes" | "expense_accounts",
          docRef.id,
          0,
          Number(uploadedServerData.openingBalance) || 0
        );
      }
      if (typeof item.localRecord?.id === "string" && item.localRecord.id.startsWith("local_")) {
        await putPendingMasterIdMapping(item.companyId, item.collection, item.localRecord.id, docRef.id);
      }
    } else if (item.operation === "update") {
      let targetId = item.localRecord?.id as string | undefined;
      if (!targetId) {
        return { success: false, error: "Missing localRecord.id for update mutation" };
      }
      if (targetId.startsWith("local_")) {
        const resolvedTargetId = await getPendingMasterIdMapping(item.companyId, item.collection, targetId);
        if (!resolvedTargetId) {
          return { success: false, error: `Unresolved local target for update: ${targetId}` };
        }
        targetId = resolvedTargetId;
      }
      await updateDoc(doc(firestore, `companies/${item.companyId}/${item.collection}`, targetId), uploadedServerData);
      if (
        item.openingBalanceSync &&
        ["parties", "bank_accounts", "staff", "taxes", "expense_accounts"].includes(item.collection) &&
        Math.abs(item.openingBalanceSync.newOpeningBalance - item.openingBalanceSync.oldOpeningBalance) > 0.01
      ) {
        // Keep capital opening-balance adjustment consistent when edits flush later from offline queue.
        const { balanceOpeningBalanceWithCapital } = await import("@/lib/voucherActionsClient");
        await balanceOpeningBalanceWithCapital(
          item.companyId,
          item.collection as "parties" | "bank_accounts" | "staff" | "taxes" | "expense_accounts",
          targetId,
          item.openingBalanceSync.oldOpeningBalance,
          item.openingBalanceSync.newOpeningBalance
        );
      }
    } else {
      return { success: false, error: `Unsupported master mutation: ${item.operation}` };
    }
    await removePendingMasterMutation(item.id);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function resolvePendingMasterFileRefs(
  companyId: string,
  collection: PendingMasterCollection,
  value: any
): Promise<any> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => resolvePendingMasterFileRefs(companyId, collection, entry)));
  }
  if (value instanceof Date || value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (!isLocalFileRef(value)) return value;
    // Keep offline master images/files under a collection-specific folder once sync is allowed again.
    return uploadPendingLocalFileRef(value, `master-files/${companyId}/${collection}`);
  }
  if (typeof value !== "object") {
    return value;
  }

  const resolvedObject: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    // Walk the full server payload so fileUrl-like fields on any queued master can upload later.
    resolvedObject[key] = await resolvePendingMasterFileRefs(companyId, collection, nestedValue);
  }
  return resolvedObject;
}

export async function syncPendingMasterMutations(): Promise<{ synced: number; failed: number }> {
  const pending = (await getPendingMasterMutations()).sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
  );
  let synced = 0;
  let failed = 0;
  for (const item of pending) {
    const result = await syncOnePendingMasterMutation(item);
    if (result.success) synced++;
    else failed++;
  }
  return { synced, failed };
}

export function subscribePendingMasterMutations(listener: () => void) {
  // Reuse the shared multi-tab notifier so all tabs react when local pending masters change.
  return subscribeLocalMutationEvent(PENDING_MASTER_EVENT, listener);
}
