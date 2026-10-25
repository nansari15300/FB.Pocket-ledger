"use client";

/**
 * Local-first outbox flush: voucher JSON may still contain `local:uuid` (IndexedDB pending blobs).
 * Firestore + other devices cannot resolve those — upload bytes to Storage here and swap in HTTPS URLs.
 */
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  getPendingPayloadForLocalRef,
  removePendingFile,
  isLocalFileRef,
  resolvePendingAttachmentCloudSyncProvider,
} from "@/lib/localPendingFiles";
import { Timestamp } from "firebase/firestore";
import { tryResolveRemoteUrlForStaleLocalAttachment } from "@/lib/resolveVoucherAttachmentRemoteUrl";
import { normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import {
  buildPendingAttachmentStorageObjectPath,
  buildVoucherAttachmentStoragePath,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";

export async function hydrateVoucherLocalAttachmentsForServer(
  fsCompanyId: string,
  docFields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cid = String(fsCompanyId || "").trim();
  if (!cid) return docFields;
  if (isFirebaseLedgerDataSyncDisabled()) return docFields;
  // Edit during restore: pehle is file ko upload karke HTTPS banao, phir save (background batch keep running).

  const typeRaw = docFields.type;
  const voucherType =
    typeof typeRaw === "string" && typeRaw.trim() !== "" ? typeRaw.trim() : "voucher";
  const localCloudProvider = await resolvePendingAttachmentCloudSyncProvider(cid);
  if (localCloudProvider) {
    // Local Google Drive company: bytes ka owner cloud-sync cycle hai; yahan Firebase Storage URL mat banao.
    return docFields;
  }
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(cid);

  // APK/native: `getPendingFiles()` sab rows ek saath read karta hai — koi row read fail / skip ho to
  // `find` miss ho kar flush throw → `local:` server tak kabhi nahi pahunchta. Preview jaisa per-id path use karo.
  let out: Record<string, unknown> = { ...docFields };

  if (out.fileUrls !== undefined && out.fileUrls !== null) {
    const urlsRaw = normalizeFileUrlsField(out.fileUrls);
    const next: string[] = [];
    let anyLocal = false;
    const voucherId = String(out.id ?? "").trim();
    for (const entry of urlsRaw) {
      if (!isLocalFileRef(entry)) {
        next.push(entry);
        continue;
      }
      anyLocal = true;
      const item = await getPendingPayloadForLocalRef(entry);
      if (!item?.blob) {
        const resolved = voucherId
          ? await tryResolveRemoteUrlForStaleLocalAttachment(cid, voucherId, entry, urlsRaw)
          : null;
        if (resolved) {
          next.push(resolved);
          continue;
        }
        // RULE: bytes not on this device (another device's local: ref) => keep the ref AS-IS. Never drop it;
        // only the owning device uploads its file and patches the URL.
        console.warn(`[sync] Attachment bytes not on this device for ${entry} - keeping ref as-is`);
        next.push(entry);
        continue;
      }
      const objectPath = buildVoucherAttachmentStoragePath({
        companyId: cid,
        usePocketLedger,
        voucherType,
        fileName: item.fileName || "file",
        voucherId,
      });
      const storageRef = ref(storage, objectPath);
      await uploadBytes(storageRef, item.blob, {
        contentType: item.contentType || "application/octet-stream",
      });
      const httpsUrl = await getDownloadURL(storageRef);
      try {
        const { incrementCompanyStorage } = await import("@/lib/storageUsageClient");
        await incrementCompanyStorage(cid, {
          attachmentsBytes: item.blob.size,
          storageBytes: item.blob.size,
        });
      } catch {
        /* usage counter non-fatal */
      }
      await removePendingFile(item.id);
      next.push(httpsUrl);
    }
    out = { ...out, fileUrls: anyLocal ? next : urlsRaw };
  }

  const uf = out.unassignedFile;
  if (uf && typeof uf === "object" && uf !== null) {
    const ufo = uf as Record<string, unknown>;
    const urlStr = ufo.url;
    if (typeof urlStr === "string" && isLocalFileRef(urlStr)) {
      const item = await getPendingPayloadForLocalRef(urlStr);
      if (!item?.blob) {
        // RULE: keep another device's local: ref as-is (never clear it).
        console.warn(`[sync] unassignedFile bytes not on this device for ${urlStr} - keeping ref as-is`);
        return out;
      }
      const objectPath = buildVoucherAttachmentStoragePath({
        companyId: cid,
        usePocketLedger,
        voucherType,
        fileName: item.fileName || "file",
        voucherId: String(out.id ?? "").trim() || undefined,
      });
      const storageRef = ref(storage, objectPath);
      await uploadBytes(storageRef, item.blob, {
        contentType: item.contentType || "application/octet-stream",
      });
      const httpsUrl = await getDownloadURL(storageRef);
      try {
        const { incrementCompanyStorage } = await import("@/lib/storageUsageClient");
        await incrementCompanyStorage(cid, {
          attachmentsBytes: item.blob.size,
          storageBytes: item.blob.size,
        });
      } catch {
        /* non-fatal */
      }
      await removePendingFile(item.id);
      out = {
        ...out,
        unassignedFile: {
          ...ufo,
          url: httpsUrl,
          path: objectPath,
        },
      };
    }
  }

  return out;
}

/** Firestore Timestamp / Date / Geo-like — deep walk me mutate mat karo. */
function shouldRecurseIntoObjectForLocalHydrate(val: unknown): boolean {
  if (val === null || typeof val !== "object") return false;
  if (Array.isArray(val)) return true;
  if (val instanceof Date) return false;
  if (val instanceof Timestamp) return false;
  if (typeof (val as { toDate?: unknown }).toDate === "function") return false;
  return true;
}

/** Ek `local:` ref ko Storage pe daal ke download URL — pending meta ka `storagePathPrefix` use (party/item/…). */
async function uploadOnePendingLocalRefToHttps(fsCompanyId: string, entry: string): Promise<string | null> {
  const cid = String(fsCompanyId || "").trim();
  if (await resolvePendingAttachmentCloudSyncProvider(cid)) {
    console.warn(
      "[sync] Local cloud-sync attachment must upload through the selected provider, not Firebase Storage:",
      entry
    );
    return null;
  }
  const item = await getPendingPayloadForLocalRef(entry);
  if (!item?.blob) {
    console.warn(
      `[sync] Pending attachment bytes missing for ${entry} (masters/avatar/item) — skip; re-attach if needed.`
    );
    return null;
  }
  // Same object path as `syncOnePendingFile` — duplicate `Date.now()` leafs se bachao.
  // Pehle `getDownloadURL` mat await karo (auth/network hang se company enter block ho sakta hai).
  const prefix = String(item.storagePathPrefix || "").trim() || `orphan-files/${cid}`;
  const objectPath = buildPendingAttachmentStorageObjectPath({
    storagePathPrefix: prefix,
    pendingFileId: item.id,
    fileName: item.fileName || "file",
  });
  const storageRef = ref(storage, objectPath);
  await uploadBytes(storageRef, item.blob, {
    contentType: item.contentType || "application/octet-stream",
  });
  const httpsUrl = await getDownloadURL(storageRef);
  try {
    const { incrementCompanyStorage } = await import("@/lib/storageUsageClient");
    await incrementCompanyStorage(cid, {
      attachmentsBytes: item.blob.size,
      storageBytes: item.blob.size,
    });
  } catch {
    /* usage counter non-fatal */
  }
  await removePendingFile(item.id);
  return httpsUrl;
}

/**
 * Outbox flush: vouchers ke alawa parties/staff/items… me `fileUrl` / `documentFileUrls` / `avatarUrl` wagaira `local:` ho to yahan HTTPS.
 * (Voucher branch `hydrateVoucherLocalAttachmentsForServer` — `unassignedFile.path` + `type` folder ke liye alag.)
 */
export async function hydratePendingLocalFileRefsDeep(
  fsCompanyId: string,
  docFields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cid = String(fsCompanyId || "").trim();
  if (!cid) return docFields;

  async function walk(v: unknown): Promise<unknown> {
    if (typeof v === "string") {
      if (!isLocalFileRef(v)) return v;
      const uploaded = await uploadOnePendingLocalRefToHttps(cid, v);
      return uploaded ?? v;
    }
    if (Array.isArray(v)) {
      const mapped = await Promise.all(v.map((x) => walk(x)));
      return mapped.filter((x) => x !== null && x !== undefined && x !== "");
    }
    if (!shouldRecurseIntoObjectForLocalHydrate(v)) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      out[k] = (await walk(o[k])) as unknown;
    }
    return out;
  }

  return (await walk(docFields)) as Record<string, unknown>;
}
