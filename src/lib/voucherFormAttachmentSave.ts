"use client";

import {
  clearLedgerVouchersLocallyApproved,
  markLedgerVouchersLocallyApproved,
} from "@/lib/ledgerPendingApproval";
import { tryResolveRemoteUrlForStaleLocalAttachment } from "@/lib/resolveVoucherAttachmentRemoteUrl";
import { isLocalFileRef, getBlobFromLocalFileRef } from "@/lib/localPendingFiles";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import {
  ATTACHMENT_HOLD_CLIPBOARD_PREFIX,
  parseAttachmentHoldClipboardText,
} from "@/lib/attachmentHoldClipboard";
import {
  buildVoucherAttachmentStoragePath,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";
import { storage } from "@/lib/plClientSession";
import { ref as storageRef, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import {
  dedupeVoucherAttachmentUrlList,
  getVoucherAttachmentUrlsForUi,
} from "@/lib/voucherAttachmentNormalize";
import { resolveFormAttachmentUrlsForEditSave } from "@/lib/formAttachmentEditHelper";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyAttachmentUploadEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  buildLockedPdfFileUrlsForSave,
  readLockPdfAsPdfPreference,
  readLockedPdfFileUrlsFromRow,
} from "@/lib/attachmentPdfOptions";

/**
 * Form `files` state me `PL_ATTACH_V1:local:uuid` clipboard marker strings ho sakti hain (paste / Reuse).
 * Inko save se pehle underlying `src` ref me normalize karo — warna upload block skip hota tha aur Firestore me `local:` save hota tha.
 */
export function normalizeFormFileUrlsForSave(rawUrls: string[]): string[] {
  return rawUrls
    .map((u) => {
      const s = String(u || "").trim();
      if (!s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return s;
      const payload = parseAttachmentHoldClipboardText(s);
      const src = String(payload?.src || "").trim();
      return src || null;
    })
    .filter((u): u is string => Boolean(u));
}

/** Standard web (non-Electron/APK/static) — production jaisa Firebase HTTPS upload path. */
export function isStandardWebBrowserClient(): boolean {
  if (typeof navigator === "undefined") return false;
  return !isElectronDesktopApp() && !isCapacitorNativeApp() && !isStaticAppBuild();
}

/** Local / Drive sync company — web par Firebase materialize mat karo (syncPendingFiles / Drive cycle). */
async function shouldSkipWebFirebaseMaterializeForCompany(companyId: string): Promise<boolean> {
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  if (!isFirebaseLedgerCompanyAttachmentUploadEnabled(companyId)) return true;
  const cid = String(companyId || "").trim();
  if (!cid) return true;
  const { apkCloudCompanyUsesSqliteFirstWrites } = await import("@/lib/apkOnlineFirestoreWritePolicy");
  if (await apkCloudCompanyUsesSqliteFirstWrites(cid)) return true;
  const { shouldUseLocalCloudSync } = await import("@/lib/localCloudSync/companyConfig");
  if (await shouldUseLocalCloudSync(cid)) return true;
  return false;
}

/** SQLite/outbox pipeline — inline web upload mat karo; outbox `hydrateVoucherLocalAttachmentsForServer` ek hi bytes upload kare. */
async function shouldDeferInlineFirebaseAttachmentUpload(companyId: string): Promise<boolean> {
  if (await shouldSkipWebFirebaseMaterializeForCompany(companyId)) return true;
  const cid = String(companyId || "").trim();
  if (!cid) return true;
  try {
    const { apkEmbeddedSqliteFirstWritesPreferred } = await import("@/lib/apkOnlineFirestoreWritePolicy");
    if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
    const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
    const { isOnlineCompanyLedgerCloudSyncAllowed } = await import("@/lib/onlineCompanySelectorSyncPolicy");
    const row = await getLocalCompanyById(cid, { includeDeleted: true });
    if (!isOnlineCompanyLedgerCloudSyncAllowed(cid, row)) {
      return true;
    }
  } catch {
    /* defer if unsure — duplicate Storage object se better missing inline */
  }
  return false;
}

/**
 * `saveVoucher` Firestore path: form se aaye `local:` / `PL_ATTACH_V1:` ko save se pehle HTTPS me badlo.
 * Har voucher type par kaam kare (sirf Payment In/Out forms par depend na ho).
 */
export async function materializeVoucherAttachmentsInSavePayload(params: {
  companyId: string;
  voucherId?: string | null;
  data: Record<string, unknown>;
  /** Edit: form open / pre-save doc URLs — kept `local:` dubara upload na ho. */
  editBaselineUrls?: readonly string[];
  editOldDocRemoteUrls?: readonly string[];
}): Promise<void> {
  if (isFirebaseLedgerDataSyncDisabled()) return;
  const cid = String(params.companyId || "").trim();
  if (!cid) return;
  if (!isFirebaseLedgerCompanyAttachmentUploadEnabled(cid)) return;
  if (!isStandardWebBrowserClient()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const rawUrls = Array.isArray(params.data.fileUrls)
    ? params.data.fileUrls.filter((u): u is string => typeof u === "string")
    : [];
  if (rawUrls.length === 0) return;
  const storageFolder = String(params.data.type || "attachments").trim() || "attachments";
  params.data.fileUrls = await materializeVoucherFileUrlsForWebSave({
    companyId: cid,
    voucherIdHint: params.voucherId ?? null,
    storageFolder,
    rawUrls: normalizeFormFileUrlsForSave(rawUrls),
    editBaselineUrls: params.editBaselineUrls,
    editOldDocRemoteUrls: params.editOldDocRemoteUrls,
  });
}

/**
 * Web save path: payload banne se pehle `local:` refs ko Firebase HTTPS me promote karo.
 * Isse Firestore row me `PL/local` marker persist hone ke chances kam hote hain.
 */
export async function materializeVoucherFileUrlsForWebSave(params: {
  companyId: string;
  voucherIdHint?: string | null;
  storageFolder: string;
  rawUrls: string[];
  editBaselineUrls?: readonly string[];
  editOldDocRemoteUrls?: readonly string[];
}): Promise<string[]> {
  const cid = String(params.companyId || "").trim();
  const storageFolder = String(params.storageFolder || "attachments").trim() || "attachments";
  const voucherIdHint = String(params.voucherIdHint || "").trim() || "web";
  const normalized = normalizeFormFileUrlsForSave(params.rawUrls);
  if (!cid) return normalized;
  // Embedded/offline clients par existing pending-sync flow hi source of truth hai.
  if (isElectronDesktopApp() || isCapacitorNativeApp() || isStaticAppBuild()) return normalized;
  if (typeof navigator !== "undefined" && !navigator.onLine) return normalized;
  if (await shouldSkipWebFirebaseMaterializeForCompany(cid)) return normalized;

  const hasEditBaseline =
    (params.editBaselineUrls?.length ?? 0) > 0 || (params.editOldDocRemoteUrls?.length ?? 0) > 0;
  if (hasEditBaseline) {
    return resolveFormAttachmentUrlsForEditSave({
      baselineUrls: params.editBaselineUrls,
      oldDocRemoteUrls: params.editOldDocRemoteUrls,
      finalUrls: normalized,
      uploadLocal: (localUrl) =>
        uploadLocalRefToFirebaseIfWebOnline(cid, voucherIdHint, localUrl, storageFolder),
      tryResolveStaleLocal:
        voucherIdHint && voucherIdHint !== "web"
          ? (localUrl, clientUrls) =>
              tryResolveRemoteUrlForStaleLocalAttachment(cid, voucherIdHint, localUrl, clientUrls)
          : undefined,
    });
  }

  const out: string[] = [];
  for (const raw of normalized) {
    const u = String(raw || "").trim();
    if (!u) continue;
    if (!isLocalFileRef(u)) {
      out.push(u);
      continue;
    }
    const uploaded = await uploadLocalRefToFirebaseIfWebOnline(cid, voucherIdHint, u, storageFolder);
    out.push(uploaded || u);
  }
  return out.filter((u, i) => out.indexOf(u) === i);
}

/** Save payload: stale `files[]` metadata EXE par removed attachment dubara na dikhaye. */
export function voucherAttachmentFieldsForSave(
  fileUrls: string[],
  opts?: {
    existingLockedPdfFileUrls?: readonly string[];
    canUnlockLockedPdf?: boolean;
  }
): {
  fileUrls: string[];
  files: [];
  unassignedFile: null;
  lockedPdfFileUrls?: string[];
} {
  const fields = {
    fileUrls,
    files: [] as [],
    unassignedFile: null,
  };

  const lockedPdfFileUrls = buildLockedPdfFileUrlsForSave({
    lockPdfAsPdf: readLockPdfAsPdfPreference(false),
    existingLocked: opts?.existingLockedPdfFileUrls,
    finalFileUrls: fileUrls,
    canUnlockLockedPdf: opts?.canUnlockLockedPdf ?? false,
  });

  if (lockedPdfFileUrls.length === 0) return fields;
  return { ...fields, lockedPdfFileUrls };
}

export function voucherAttachmentLockSaveOpts(
  row: Record<string, unknown> | null | undefined,
  canUnlockLockedPdf: boolean
): {
  existingLockedPdfFileUrls: string[];
  canUnlockLockedPdf: boolean;
} {
  return {
    existingLockedPdfFileUrls: readLockedPdfFileUrlsFromRow(row ?? null),
    canUnlockLockedPdf,
  };
}

/** Web online: nayi File → Firebase Storage (pocket-ledger ya legacy prefix). */
export async function uploadVoucherAttachmentFileToFirebase(params: {
  companyId: string;
  voucherType: string;
  file: File;
  voucherId?: string;
}): Promise<string> {
  const cid = String(params.companyId || "").trim();
  const voucherType = String(params.voucherType || "journal").trim() || "journal";
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(cid);
  const path = buildVoucherAttachmentStoragePath({
    companyId: cid,
    usePocketLedger,
    voucherType,
    fileName: params.file.name,
    voucherId: params.voucherId,
  });
  const sRef = storageRef(storage, path);
  const snap = await uploadBytes(sRef, params.file);
  return getDownloadURL(snap.ref);
}

/**
 * EXE/APK/static par skip (syncPendingFiles background me karta hai).
 */
async function uploadLocalRefToFirebaseIfWebOnline(
  companyId: string,
  voucherId: string,
  localUrl: string,
  storageFolder: string
): Promise<string | null> {
  if (isFirebaseLedgerDataSyncDisabled()) return null;
  if (isElectronDesktopApp() || isCapacitorNativeApp() || isStaticAppBuild()) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  if (await shouldDeferInlineFirebaseAttachmentUpload(companyId)) return null;
  try {
    const blob = await getBlobFromLocalFileRef(localUrl);
    if (!blob) return null;
    // Filename: UUID se ya fallback
    const uuidPart = localUrl.replace("local:", "").replace(/[^a-z0-9-]/gi, "");
    const ext = blob.type ? `.${blob.type.split("/")[1] || "bin"}` : "";
    const fileName = `${uuidPart}${ext}`;
    const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(companyId);
    const path = buildVoucherAttachmentStoragePath({
      companyId,
      usePocketLedger,
      voucherType: storageFolder,
      fileName,
      voucherId,
    });
    const sRef = storageRef(storage, path);
    const snap = await uploadBytes(sRef, blob);
    return await getDownloadURL(snap.ref);
  } catch {
    return null;
  }
}

/** `saveVoucher` ke baad `local:` → HTTPS upgrade. Web online: IndexedDB blob → Firebase upload; fallback: Firestore lookup. */
export async function resolvePersistedVoucherFileUrlsAfterSave(
  companyId: string,
  voucherId: string,
  urls: readonly string[],
  storageFolder = "attachments"
): Promise<string[]> {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return [...urls];
  const row = (await getCompanyDocFromBrowserDb(cid, "vouchers", vid).catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const { baselineUrls, remoteUrls } = (await import("@/lib/formAttachmentEditHelper")).readVoucherAttachmentBaselineFromRow(
    row
  );

  return resolveFormAttachmentUrlsForEditSave({
    baselineUrls,
    oldDocRemoteUrls: remoteUrls.length > 0 ? remoteUrls : undefined,
    finalUrls: urls,
    uploadLocal: (localUrl) => uploadLocalRefToFirebaseIfWebOnline(cid, vid, localUrl, storageFolder),
    tryResolveStaleLocal: (localUrl, clientUrls) =>
      tryResolveRemoteUrlForStaleLocalAttachment(cid, vid, localUrl, clientUrls),
  });
}

/** Parent `voucher.fileUrls` outbox/Firestore lag se purani list bheje to form state mat overwrite karo. */
export function isLocalToRemoteAttachmentUpgrade(saved: readonly string[], incoming: readonly string[]): boolean {
  if (saved.length !== incoming.length) return false;
  return saved.every((u, i) => {
    const inc = incoming[i];
    if (!inc) return false;
    return u === inc || (isLocalFileRef(u) && !isLocalFileRef(inc));
  });
}

/** Voucher row fingerprint — `fileUrls`/`files` change par vouchers context live update. */
export function voucherAttachmentUiFingerprint(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const urls = getVoucherAttachmentUrlsForUi(row).join("\x1e");
  const filesMeta = Array.isArray(row.files) ? row.files.length : 0;
  const uf =
    row.unassignedFile && typeof row.unassignedFile === "object"
      ? String((row.unassignedFile as { url?: string }).url || "").trim()
      : "";
  return `${urls}\x1d${filesMeta}\x1d${uf}`;
}

/** Post-save vouchers cache patch — `files: []` taaki purani metadata UI me na dikhe. */
export function buildVoucherAttachmentLivePatch(fileUrls: readonly string[]): {
  fileUrls: string[];
  files: [];
  unassignedFile: null;
} {
  return voucherAttachmentFieldsForSave(
    fileUrls.filter((u): u is string => typeof u === "string" && Boolean(String(u).trim()))
  );
}

export const VOUCHER_ATTACHMENT_SAVED_EVENT = "pocket-ledger-voucher-attachment-saved";

const VOUCHER_LIVE_PATCH_BROADCAST = "pocket-ledger-voucher-live-patch-bc";
const VOUCHER_LIVE_PATCH_STORAGE_KEY = "pl-voucher-live-patch";

export type VoucherLivePatchDetail = {
  companyId: string;
  voucherId: string;
  /** Approve All: ek setState me kai ids. */
  voucherIds?: string[];
  patch: Record<string, unknown>;
};

/** Save / link ke turant baad `useVouchers` cache patch — ledger + dialogs bina refresh. */
export function dispatchVoucherLivePatch(
  companyId: string,
  voucherId: string,
  patch: Record<string, unknown>
): void {
  if (typeof window === "undefined" || !companyId?.trim() || !voucherId?.trim()) return;
  if (patch?.isApproved === true) {
    markLedgerVouchersLocallyApproved([voucherId.trim()]);
  } else if (patch?.isApproved === false) {
    clearLedgerVouchersLocallyApproved([voucherId.trim()]);
  }
  const detail: VoucherLivePatchDetail = {
    companyId: companyId.trim(),
    voucherId: voucherId.trim(),
    patch,
  };
  window.dispatchEvent(
    new CustomEvent(VOUCHER_ATTACHMENT_SAVED_EVENT, {
      detail,
    })
  );
  // Sibling tab / EXE strip — same company pe Change Detected bina hard refresh
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(VOUCHER_LIVE_PATCH_BROADCAST);
      channel.postMessage(detail);
      channel.close();
    }
  } catch {
    /* optional */
  }
  try {
    window.localStorage.setItem(
      VOUCHER_LIVE_PATCH_STORAGE_KEY,
      JSON.stringify({ ...detail, at: Date.now() })
    );
    window.localStorage.removeItem(VOUCHER_LIVE_PATCH_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/** Approve All: har id pe alag CustomEvent mat — ek hi React setState. */
export function dispatchVoucherLivePatchMany(
  companyId: string,
  voucherIds: string[],
  patch: Record<string, unknown>
): void {
  const ids = Array.from(new Set((voucherIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (typeof window === "undefined" || !companyId?.trim() || !ids.length) return;
  if (patch?.isApproved === true) {
    markLedgerVouchersLocallyApproved(ids);
  } else if (patch?.isApproved === false) {
    clearLedgerVouchersLocallyApproved(ids);
  }
  const detail: VoucherLivePatchDetail = {
    companyId: companyId.trim(),
    voucherId: ids[0],
    voucherIds: ids,
    patch,
  };
  window.dispatchEvent(
    new CustomEvent(VOUCHER_ATTACHMENT_SAVED_EVENT, {
      detail,
    })
  );
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(VOUCHER_LIVE_PATCH_BROADCAST);
      channel.postMessage(detail);
      channel.close();
    }
  } catch {
    /* optional */
  }
}

/** useVouchers — same-tab CustomEvent + multi-tab BroadcastChannel / storage. */
export function subscribeVoucherLivePatch(
  listener: (detail: VoucherLivePatchDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<VoucherLivePatchDetail>).detail;
    if (detail?.companyId && detail?.voucherId) listener(detail);
  };
  window.addEventListener(VOUCHER_ATTACHMENT_SAVED_EVENT, onCustom);

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(VOUCHER_LIVE_PATCH_BROADCAST);
      channel.addEventListener("message", (event: MessageEvent<VoucherLivePatchDetail>) => {
        const detail = event.data;
        if (detail?.companyId && detail?.voucherId) listener(detail);
      });
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== VOUCHER_LIVE_PATCH_STORAGE_KEY || !event.newValue) return;
    try {
      const detail = JSON.parse(event.newValue) as VoucherLivePatchDetail;
      if (detail?.companyId && detail?.voucherId) listener(detail);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(VOUCHER_ATTACHMENT_SAVED_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
    if (channel) {
      channel.close();
      channel = null;
    }
  };
}

/** Save ke turant baad `useVouchers` cache update — har voucher form se (Payment/Sale/Journal…). */
export function dispatchVoucherAttachmentSaved(
  companyId: string,
  voucherId: string,
  fileUrls: readonly string[],
  options?: { previousUrls?: readonly string[] }
): void {
  const urls = fileUrls.filter((u): u is string => typeof u === "string" && Boolean(String(u).trim()));
  void import("@/lib/attachmentDeleteTrace").then((m) => {
    // Empty + partial trim (3→2) dono intent — warna stale Firestore HTTPS list wapas aa jati hai.
    m.markAttachmentDeleteIntent({
      companyId,
      voucherId,
      intendedUrls: urls,
      previousUrls: options?.previousUrls,
      source: "dispatchVoucherAttachmentSaved",
    });
    if (process.env.NODE_ENV !== "production") {
      m.traceAttachmentUrlsChange({
        source: "dispatchVoucherAttachmentSaved",
        companyId,
        voucherId,
        prevUrls: null,
        nextUrls: fileUrls,
      });
    }
  });
  dispatchVoucherLivePatch(companyId, voucherId, buildVoucherAttachmentLivePatch(fileUrls));
}

/**
 * Form save ke baad: `local:` → resolve + vouchers cache patch + UI ke liye persisted URL list.
 * EXE/static par pehli create par cache me row na ho to bhi `dispatchVoucherAttachmentSaved` stub append karta hai.
 */
export async function applyVoucherAttachmentsAfterFormSave(params: {
  companyId: string;
  voucherId: string;
  rawFileUrls: readonly string[];
  storageFolder: string;
  /** Edit save se pehle ki list — delete intent / blockedUrls ke liye. */
  previousUrls?: readonly string[];
}): Promise<string[]> {
  const cid = String(params.companyId || "").trim();
  const vid = String(params.voucherId || "").trim();
  let raw = params.rawFileUrls.filter(
    (u): u is string => typeof u === "string" && Boolean(String(u).trim())
  );
  if (!cid || !vid) return dedupeVoucherAttachmentUrlList(raw);

  // Form save list authoritative — remove/empty ke baad stale DB list se files wapas mat lao.
  // `local:` → HTTPS upgrade only in-place for the same slot; never grow vs raw.
  const resolved = await resolvePersistedVoucherFileUrlsAfterSave(cid, vid, raw, params.storageFolder);
  const persisted = dedupeVoucherAttachmentUrlList(
    raw.map((u, i) => {
      const r = resolved[i];
      if (!r) return u;
      if (r === u) return r;
      if (isLocalFileRef(u) && !isLocalFileRef(r)) return r;
      return u;
    })
  );
  dispatchVoucherAttachmentSaved(cid, vid, persisted, {
    previousUrls: params.previousUrls,
  });
  return persisted;
}

/**
 * Har voucher form: save ke turant baad attachment cache patch (local) + outbox flush background.
 * Dialog close pehle ho sakta hai — Firestore sync network pe block na kare.
 */
export async function finalizeVoucherAttachmentsAfterFormSave(params: {
  companyId: string;
  voucherId: string;
  rawFileUrls: readonly string[];
  storageFolder: string;
  previousUrls?: readonly string[];
}): Promise<string[]> {
  const persisted = await applyVoucherAttachmentsAfterFormSave(params);
  scheduleBackgroundOutboxFlushAfterFormSave();
  return persisted;
}

/** Online/local sqlite-first: outbox flush background — Save UI turant band ho. */
export function scheduleBackgroundOutboxFlushAfterFormSave(): void {
  void (async () => {
    try {
      const { shouldAutoFlushOutboxAfterEnqueue } = await import("@/lib/apkOnlineFirestoreWritePolicy");
      if (!shouldAutoFlushOutboxAfterEnqueue()) return;
      const { flushVoucherOutbox } = await import("@/lib/localVoucherOutbox");
      await flushVoucherOutbox();
    } catch (err) {
      console.warn("[scheduleBackgroundOutboxFlushAfterFormSave] outbox flush", err);
    }
  })();
}

/**
 * Post-save snapshot authoritative: parent `voucher.fileUrls` listener lag se purani zyada list form/ledger overwrite na kare.
 * Web + EXE dono — delete+add ke baad refresh ki zarurat kam.
 */
export function incomingVoucherFileUrlsLookStaleVersusSaved(
  saved: readonly string[],
  incoming: readonly string[]
): boolean {
  const snap = saved.map((u) => String(u || "").trim()).filter(Boolean);
  const inc = incoming.map((u) => String(u || "").trim()).filter(Boolean);
  if (snap.length === 0 && inc.length === 0) return false;
  if (JSON.stringify(snap) === JSON.stringify(inc)) return false;
  if (isLocalToRemoteAttachmentUpgrade(snap, inc)) return false;
  // User ne saari files hata di — parent/Firestore lag se non-empty list stale hai (empty.every() pe bharosa mat).
  if (snap.length === 0 && inc.length > 0) return true;
  // User ne file hata kar nayi add ki: parent ab bhi purani URLs ke saath aata hai.
  if (snap.length > 0 && inc.length > snap.length && snap.every((u) => inc.includes(u))) return true;
  if (snap.length > 0 && inc.length > 0) {
    const overlap = snap.filter((u) => inc.includes(u)).length;
    if (overlap === 0) return true;
    if (snap.length !== inc.length && snap.some((u) => !inc.includes(u)) && inc.some((u) => !snap.includes(u))) {
      return true;
    }
  }
  if (snap.length < inc.length && snap.every((u) => inc.includes(u))) return true;
  if (snap.length > inc.length && snap.some((u) => !inc.includes(u))) return true;
  return false;
}
