"use client";

/**
 * Header button only: leftover Firebase Storage URLs on this company's transactions
 * (`fileUrls` / `unassignedFile.url`) → fetch once → `pl_attachments` → `pbatt:` and drop the Firebase URL.
 * Never runs on its own (no prefetch / no thumb hook).
 */

import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { beginFirebaseMigrateFetchAllow } from "@/lib/plServerFirebaseHitTrace";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { getVoucherAttachmentUrlsForUi, normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";

export const FIREBASE_STORAGE_QUOTA_MESSAGE =
  "Your Firebase Storage is still replying quota exceeded.";

export type FirebaseVoucherMigrateProgress = {
  phase: "scan" | "probe" | "copy" | "done";
  done: number;
  total: number;
  label: string;
};

export type FirebaseVoucherMigrateScan = {
  voucherCount: number;
  urlCount: number;
};

export type FirebaseVoucherMigrateResult = {
  moved: number;
  vouchersPatched: number;
  skipped: number;
  failed: number;
  quotaExceeded?: boolean;
  message: string;
};

type VoucherHit = {
  id: string;
  fileUrls: string[];
  unassignedUrl: string;
  unassignedFile: Record<string, unknown> | null;
  firebaseUrls: string[];
};

function isFirebaseTxnUrl(raw: string): boolean {
  const u = String(raw || "").trim();
  if (!u) return false;
  if (u.startsWith("pbatt:") || u.startsWith("local:") || u.startsWith("blob:") || u.startsWith("data:")) {
    return false;
  }
  const l = u.toLowerCase();
  return (
    l.includes("firebasestorage.googleapis.com") ||
    l.includes("firebasestorage.app") ||
    (l.includes("googleapis.com") && l.includes("/o/")) ||
    l.includes("storage.googleapis.com")
  );
}

function fileNameFromFirebaseUrl(url: string): string {
  try {
    const path = tryGetStoragePathFromFirebaseDownloadUrl(url) || url.split("?")[0];
    const last = decodeURIComponent(String(path.split("/").pop() || "file"));
    const name = last.replace(/[\\/:*?"<>|]+/g, "_").trim();
    return name || "file";
  } catch {
    return "file";
  }
}

function stableFirebaseKey(url: string): string {
  return tryGetStoragePathFromFirebaseDownloadUrl(url) || String(url || "").split("?")[0].trim();
}

function unassignedUrlOf(row: Record<string, unknown>): string {
  const uf = row.unassignedFile;
  if (!uf || typeof uf !== "object") return "";
  return String((uf as { url?: unknown }).url || "").trim();
}

function parseVoucherHit(id: string, data: Record<string, unknown>): VoucherHit | null {
  const fileUrls = getVoucherAttachmentUrlsForUi({
    fileUrls: data.fileUrls,
    unassignedFile: data.unassignedFile,
  });
  const unassignedUrl = unassignedUrlOf(data);
  const firebaseUrls = [...new Set([...fileUrls, unassignedUrl].filter(isFirebaseTxnUrl))];
  if (!firebaseUrls.length) return null;
  const uf = data.unassignedFile;
  return {
    id,
    fileUrls: normalizeFileUrlsField(data.fileUrls),
    unassignedUrl,
    unassignedFile: uf && typeof uf === "object" ? { ...(uf as Record<string, unknown>) } : null,
    firebaseUrls,
  };
}

async function loadHits(companyId: string): Promise<VoucherHit[]> {
  const { listCompanyDocRawRowsWithFirebaseUrlHint, listCompanyDocsFromBrowserDb, deserializeLocalDbValue } =
    await import("@/lib/localCompanyDocMirror");
  const raw = await listCompanyDocRawRowsWithFirebaseUrlHint(companyId, "vouchers");
  const hits: VoucherHit[] = [];
  const seen = new Set<string>();
  const ingest = (id: string, data: Record<string, unknown>) => {
    if (data.isDeleted === true) return;
    const hit = parseVoucherHit(id, data);
    if (!hit || seen.has(hit.id)) return;
    seen.add(hit.id);
    hits.push(hit);
  };
  for (const row of raw) {
    try {
      const parsed = JSON.parse(row.data) as Record<string, unknown>;
      const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
      ingest(String(row.id || data.id || ""), data);
    } catch {
      /* skip bad row */
    }
  }
  if (hits.length) return hits;
  const all = (await listCompanyDocsFromBrowserDb(companyId, "vouchers")) as Record<string, unknown>[];
  for (const row of all) {
    ingest(String(row.id || ""), row);
  }
  return hits;
}

type FirebaseFetchResult = {
  blob: Blob | null;
  quota: boolean;
  status: number | null;
};

function looksLikeQuotaBody(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("quota") ||
    t.includes("exceeded") ||
    t.includes("payment required") ||
    t.includes("resource_exhausted")
  );
}

async function fetchFirebaseUrlFromNetwork(url: string, signal?: AbortSignal): Promise<FirebaseFetchResult> {
  if (!/^https?:\/\//i.test(url)) return { blob: null, quota: false, status: null };
  const release = beginFirebaseMigrateFetchAllow(url);
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal });
    const status = res.status;
    if (status === 402 || status === 429) return { blob: null, quota: true, status };
    if (!res.ok) {
      let quota = false;
      try {
        quota = looksLikeQuotaBody(await res.text());
      } catch {
        quota = false;
      }
      return { blob: null, quota, status };
    }
    const blob = await res.blob();
    if (blob && blob.size > 0) {
      const ct = String(blob.type || "").toLowerCase();
      if (ct.includes("json") || ct.includes("text")) {
        try {
          const text = await blob.text();
          if (looksLikeQuotaBody(text)) return { blob: null, quota: true, status };
        } catch {
          /* binary */
        }
      }
      return { blob, quota: false, status };
    }
    return { blob: null, quota: false, status };
  } catch {
    return { blob: null, quota: false, status: null };
  } finally {
    release();
  }
}

async function blobForFirebaseUrl(url: string, signal?: AbortSignal): Promise<FirebaseFetchResult> {
  try {
    const { tryOfflineCachedAttachmentBlobMultiKey } = await import("@/lib/offlineAttachmentUrlCache");
    const cached = await tryOfflineCachedAttachmentBlobMultiKey(url);
    if (cached && cached.size > 0) return { blob: cached, quota: false, status: 200 };
  } catch {
    /* cache optional */
  }
  return fetchFirebaseUrlFromNetwork(url, signal);
}

function quotaResult(extra?: Partial<FirebaseVoucherMigrateResult>): FirebaseVoucherMigrateResult {
  return {
    moved: 0,
    vouchersPatched: 0,
    skipped: 0,
    failed: 0,
    quotaExceeded: true,
    message: FIREBASE_STORAGE_QUOTA_MESSAGE,
    ...extra,
  };
}

export async function scanFirebaseVoucherAttachmentUrls(
  companyId: string
): Promise<FirebaseVoucherMigrateScan> {
  const cid = String(companyId || "").trim();
  if (!cid) return { voucherCount: 0, urlCount: 0 };
  const hits = await loadHits(cid);
  const urls = new Set<string>();
  for (const h of hits) for (const u of h.firebaseUrls) urls.add(u);
  return { voucherCount: hits.length, urlCount: urls.size };
}

export async function migrateFirebaseVoucherAttachmentsToPb(
  companyId: string,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (p: FirebaseVoucherMigrateProgress) => void;
  }
): Promise<FirebaseVoucherMigrateResult> {
  const cid = String(companyId || "").trim();
  const empty: FirebaseVoucherMigrateResult = {
    moved: 0,
    vouchersPatched: 0,
    skipped: 0,
    failed: 0,
    message: "No leftover Firebase files on this company's transactions.",
  };
  if (!cid) return empty;
  if (!isPocketBaseOnlyAppSession() || !getValidPocketBaseAuth()) {
    return { ...empty, message: "Sign in to Pocket Ledger Server first." };
  }

  const progress = opts?.onProgress ?? (() => {});
  progress({ phase: "scan", done: 0, total: 1, label: "Looking for leftover Firebase files…" });
  const hits = await loadHits(cid);
  const uniqueUrls = [...new Set(hits.flatMap((h) => h.firebaseUrls))];
  if (!uniqueUrls.length) {
    progress({ phase: "done", done: 1, total: 1, label: empty.message });
    return empty;
  }

  const probeUrl = uniqueUrls.find((u) => /^https?:\/\//i.test(u));
  let probedBlob: Blob | null = null;
  if (probeUrl) {
    progress({
      phase: "probe",
      done: 0,
      total: uniqueUrls.length,
      label: "Testing Firebase Storage connection…",
    });
    const probe = await fetchFirebaseUrlFromNetwork(probeUrl, opts?.signal);
    if (opts?.signal?.aborted) return { ...empty, message: "Stopped." };
    if (probe.quota) {
      progress({ phase: "done", done: 0, total: uniqueUrls.length, label: FIREBASE_STORAGE_QUOTA_MESSAGE });
      return quotaResult();
    }
    probedBlob = probe.blob;
  }

  const { ensurePocketBaseCompany, pbDeviceId } = await import("@/lib/pocketbaseData/pbSync");
  const pbCompanyId = await ensurePocketBaseCompany(cid, { createIfMissing: false });
  const { uploadBlobAsPocketBaseAttachment } = await import("@/lib/pocketbaseData/pbAttachments");
  const { computeSha256HexFromStringUtf8 } = await import("@/lib/security/sha256Hex");
  const { seedOfflineAttachmentCacheFromBlob } = await import("@/lib/offlineAttachmentUrlCache");
  const { patchVoucherFields } = await import("@/lib/writeGateway/voucherActionsClient");
  const deviceId = pbDeviceId();
  const urlToPb = new Map<string, string>();
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < uniqueUrls.length; i++) {
    if (opts?.signal?.aborted) break;
    const url = uniqueUrls[i]!;
    progress({
      phase: "copy",
      done: i,
      total: uniqueUrls.length,
      label: `Copying file ${i + 1} of ${uniqueUrls.length}…`,
    });
    const got =
      i === 0 && probeUrl === url && probedBlob
        ? { blob: probedBlob, quota: false, status: 200 }
        : await blobForFirebaseUrl(url, opts?.signal);
    if (got.quota) {
      progress({ phase: "done", done: i, total: uniqueUrls.length, label: FIREBASE_STORAGE_QUOTA_MESSAGE });
      return quotaResult({ moved: urlToPb.size, failed: failed + 1 });
    }
    const blob = got.blob;
    if (!blob) {
      failed += 1;
      continue;
    }
    const owner = hits.find((h) => h.firebaseUrls.includes(url));
    const hex = await computeSha256HexFromStringUtf8(stableFirebaseKey(url));
    const appId = `att_fb_${hex.slice(0, 40)}`;
    try {
      const ref = await uploadBlobAsPocketBaseAttachment({
        pbCompanyId,
        blob,
        fileName: fileNameFromFirebaseUrl(url),
        sourceUrl: url,
        ownerColl: "vouchers",
        ownerAppId: owner?.id || "",
        deviceId,
        appId,
        signal: opts?.signal,
      });
      if (!ref) {
        failed += 1;
        continue;
      }
      urlToPb.set(url, ref);
      void seedOfflineAttachmentCacheFromBlob(ref, blob);
      void seedOfflineAttachmentCacheFromBlob(url, blob);
    } catch {
      failed += 1;
    }
  }

  let vouchersPatched = 0;
  for (const hit of hits) {
    if (opts?.signal?.aborted) break;
    const nextUrls = hit.fileUrls.map((u) => urlToPb.get(u) || u);
    const nextUnassigned = urlToPb.get(hit.unassignedUrl) || hit.unassignedUrl;
    const urlsChanged = nextUrls.some((u, i) => u !== hit.fileUrls[i]);
    const unassignedChanged = nextUnassigned !== hit.unassignedUrl;
    if (!urlsChanged && !unassignedChanged) {
      if (hit.firebaseUrls.some((u) => !urlToPb.has(u))) skipped += 1;
      continue;
    }
    const partial: Record<string, unknown> = {};
    if (urlsChanged) partial.fileUrls = nextUrls;
    if (unassignedChanged) {
      partial.unassignedFile = nextUnassigned
        ? { ...(hit.unassignedFile || {}), url: nextUnassigned }
        : null;
    }
    try {
      await patchVoucherFields(cid, hit.id, partial);
      vouchersPatched += 1;
    } catch {
      failed += 1;
    }
  }

  try {
    const { requestAttachmentUiRefresh } = await import("@/lib/attachmentLoadReady");
    requestAttachmentUiRefresh();
  } catch {
    /* optional */
  }

  const moved = urlToPb.size;
  const message =
    moved === 0
      ? failed
        ? `Could not copy ${failed} Firebase file(s). The old URL is still on those transactions.`
        : empty.message
      : `Moved ${moved} file(s) to Pocket Ledger Server on ${vouchersPatched} transaction(s).` +
        (failed ? ` ${failed} file(s) could not be downloaded.` : "");
  progress({ phase: "done", done: uniqueUrls.length, total: uniqueUrls.length, label: message });
  return { moved, vouchersPatched, skipped, failed, message };
}
