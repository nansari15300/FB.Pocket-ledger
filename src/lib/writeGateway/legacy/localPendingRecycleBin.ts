"use client";

import { doc, deleteDoc, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { openDB } from "@/lib/offlineDb";

const STORE = "pendingRecycleBinMutations";

export type PendingRecycleBinItem = {
  id: string;
  collectionPath: string;
  isCompany?: boolean;
};

export type PendingRecycleBinMutation = {
  id: string;
  companyId: string | null;
  action: "permanent_delete" | "empty_bin";
  /** For permanent_delete: single item. */
  item?: PendingRecycleBinItem & { isCompany?: boolean };
  /** For empty_bin: list of items and optional company ids. */
  items?: PendingRecycleBinItem[];
  companyIds?: string[];
  /** Stored at queue time so sync uses same behaviour as when user clicked. */
  quickDelete: boolean;
  createdAt?: number;
};

export function generatePendingRecycleBinMutationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `rb_${crypto.randomUUID()}`;
  return `rb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function putPendingRecycleBinMutation(payload: PendingRecycleBinMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ ...payload, createdAt: payload.createdAt ?? Date.now() });
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

export async function getPendingRecycleBinMutations(): Promise<PendingRecycleBinMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result || []).sort((a: PendingRecycleBinMutation, b: PendingRecycleBinMutation) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function removePendingRecycleBinMutation(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
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

/** Resolve storage path from doc data (filePaths, storagePath, path). */
function getStoragePath(filePath: string): string | null {
  if (!filePath || typeof filePath !== "string") return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const encoded = url.pathname.split("/o/")[1];
      if (encoded) return decodeURIComponent(encoded.split("?")[0]);
    }
    if (trimmed.startsWith("companies/")) return trimmed;
    return trimmed;
  } catch {
    return null;
  }
}

async function deleteStorageFilesForDoc(data: Record<string, unknown>): Promise<void> {
  const { ref, deleteObject } = await import("firebase/storage");
  const { storage } = await import("@/lib/firebase");
  const paths: string[] = [];
  if (Array.isArray(data.filePaths)) paths.push(...(data.filePaths as string[]));
  if (data.storagePath && typeof data.storagePath === "string") paths.push(data.storagePath);
  if (data.path && typeof data.path === "string") paths.push(data.path);
  for (const filePath of paths) {
    const storagePath = getStoragePath(filePath);
    if (!storagePath) continue;
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      // File may already be missing
    }
  }
}

/** Flush one queued recycle bin mutation to server. */
export async function syncOnePendingRecycleBinMutation(
  mutation: PendingRecycleBinMutation,
  _options?: { userId?: string; deleteCompanyComplete?: (id: string, uid: string) => Promise<{ success: boolean; error?: string }> }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { quickDelete } = mutation;

    if (mutation.action === "permanent_delete" && mutation.item) {
      const item = mutation.item;
      if (item.isCompany || item.collectionPath === "companies") {
        if (quickDelete && _options?.deleteCompanyComplete && _options?.userId) {
          const result = await _options.deleteCompanyComplete(item.id, _options.userId);
          if (!result.success) return { success: false, error: result.error };
        } else {
          await updateDoc(doc(firestore, "companies", item.id), { movedToAdminRecycleAt: serverTimestamp() });
        }
      } else if (mutation.companyId) {
        const docPath = `companies/${mutation.companyId}/${item.collectionPath}/${item.id}`;
        const docRef = doc(firestore, docPath);
        if (quickDelete) {
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) await deleteStorageFilesForDoc(docSnap.data() as Record<string, unknown>);
          await deleteDoc(docRef);
        } else {
          await updateDoc(docRef, { movedToAdminRecycleAt: serverTimestamp() });
        }
      }
    } else if (mutation.action === "empty_bin" && mutation.companyId) {
      if (mutation.companyIds?.length) {
        for (const cid of mutation.companyIds) {
          if (quickDelete && _options?.deleteCompanyComplete && _options?.userId) {
            const result = await _options.deleteCompanyComplete(cid, _options.userId);
            if (!result.success) return { success: false, error: result.error };
          } else {
            await updateDoc(doc(firestore, "companies", cid), { movedToAdminRecycleAt: serverTimestamp() });
          }
        }
      }
      const items = mutation.items ?? [];
      if (quickDelete) {
        for (const item of items) {
          const docPath = `companies/${mutation.companyId}/${item.collectionPath}/${item.id}`;
          const docRef = doc(firestore, docPath);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) await deleteStorageFilesForDoc(docSnap.data() as Record<string, unknown>);
          await deleteDoc(docRef);
        }
      } else {
        const batch = writeBatch(firestore);
        for (const item of items) {
          batch.update(doc(firestore, `companies/${mutation.companyId}/${item.collectionPath}/${item.id}`), { movedToAdminRecycleAt: serverTimestamp() });
        }
        await batch.commit();
      }
    }

    await removePendingRecycleBinMutation(mutation.id);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

/** Sync all pending recycle bin mutations. Call when online. */
export async function syncPendingRecycleBinMutations(options?: {
  userId?: string;
  deleteCompanyComplete?: (id: string, uid: string) => Promise<{ success: boolean; error?: string }>;
}): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingRecycleBinMutations();
  let synced = 0;
  let failed = 0;
  for (const mutation of pending) {
    const result = await syncOnePendingRecycleBinMutation(mutation, options);
    if (result.success) synced++;
    else failed++;
  }
  return { synced, failed };
}
