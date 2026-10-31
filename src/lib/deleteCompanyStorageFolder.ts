"use client";

/**
 * Restore overwrite (with attachments): company ke Firebase Storage prefixes wipe.
 * Data-only restore iske bina chale — purane HTTPS URLs reuse hote hain.
 */
import { ref, list, deleteObject, type StorageReference } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "@/lib/firebase";
import { withOnlineTriggerScope } from "@/lib/onlineTriggerLog";
import {
  buildCompanyStorageWipePrefixes,
  buildVoucherStorageScanPrefixes,
} from "@/lib/companyStorageWipePrefixes";

async function deleteStorageTree(root: StorageReference): Promise<number> {
  return withOnlineTriggerScope(
    { feature: "storage-wipe", codePath: "deleteCompanyStorageFolder.deleteStorageTree" },
    async () => {
  let deleted = 0;

  async function walk(r: StorageReference): Promise<void> {
    let pageToken: string | undefined;
    do {
      const page = await list(r, {
        maxResults: 200,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of page.items) {
        try {
          await deleteObject(item);
          deleted += 1;
        } catch {
          /* already gone / permission */
        }
      }
      for (const prefix of page.prefixes) {
        await walk(prefix);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  await walk(root);
  return deleted;
    }
  );
}

export { buildCompanyStorageWipePrefixes, buildVoucherStorageScanPrefixes } from "@/lib/companyStorageWipePrefixes";

/** Company permanent delete / recycle bin empty — poora company Storage prefix wipe. */
export async function deleteCompanyFirebaseStorageFolder(input: {
  companyId: string;
  companyName?: string;
}): Promise<{ deleted: number; prefixes: string[] }> {
  return wipeCompanyFirebaseStorageForRestore(input);
}

function storageObjectLeafName(fullPath: string): string {
  return fullPath.split("/").pop() || fullPath;
}

/** Voucher permanent delete: `{voucherId}_*` objects under type folder (orphan duplicates bhi). */
export async function deleteVoucherFirebaseStorageObjects(input: {
  companyId: string;
  voucherId: string;
  voucherType?: string;
}): Promise<number> {
  const cid = String(input.companyId || "").trim();
  const vid = String(input.voucherId || "").trim();
  if (!cid || !vid) return 0;
  return withOnlineTriggerScope(
    {
      feature: "storage-wipe",
      codePath: "deleteCompanyStorageFolder.deleteVoucherFirebaseStorageObjects",
      voucherType: input.voucherType || "—",
      header: input.voucherId,
    },
    async () => {
  const prefixes = buildVoucherStorageScanPrefixes({
    companyId: cid,
    voucherType: input.voucherType,
  });
  let deleted = 0;
  for (const prefix of prefixes) {
    try {
      deleted += await deleteStorageTreeMatchingVoucherId(ref(storage, prefix), vid);
    } catch (e) {
      console.warn("[deleteVoucherStorage] prefix skipped", prefix, e);
    }
  }
  return deleted;
    }
  );
}

async function deleteStorageTreeMatchingVoucherId(
  root: StorageReference,
  voucherId: string
): Promise<number> {
  let deleted = 0;
  const needle = `${voucherId}_`;

  async function walk(r: StorageReference): Promise<void> {
    let pageToken: string | undefined;
    do {
      const page = await list(r, {
        maxResults: 200,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of page.items) {
        const leaf = storageObjectLeafName(item.fullPath);
        if (!leaf.startsWith(needle)) continue;
        try {
          await deleteObject(item);
          deleted += 1;
        } catch {
          /* already gone / permission */
        }
      }
      for (const prefix of page.prefixes) {
        await walk(prefix);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  await walk(root);
  return deleted;
}

/** Replace-current + with attachments: purani bucket files hatao, phir nayi upload. */
export async function wipeCompanyFirebaseStorageForRestore(input: {
  companyId: string;
  companyName?: string;
}): Promise<{ deleted: number; prefixes: string[] }> {
  return withOnlineTriggerScope(
    {
      feature: "storage-wipe",
      codePath: "deleteCompanyStorageFolder.wipeCompanyFirebaseStorageForRestore",
      header: input.companyName || input.companyId,
    },
    async () => {
  const prefixes = buildCompanyStorageWipePrefixes(input);
  let deleted = 0;
  for (const prefix of prefixes) {
    try {
      deleted += await deleteStorageTree(ref(storage, prefix));
    } catch (e) {
      console.warn("[wipeCompanyStorage] prefix skipped", prefix, e);
    }
  }
  return { deleted, prefixes };
    }
  );
}
