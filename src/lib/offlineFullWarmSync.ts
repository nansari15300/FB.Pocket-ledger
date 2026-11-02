"use client";

/**
 * Online hone par: plans localStorage merge, Firestore company root → SQLite pseudo-collection,
 * saari master/voucher mirrors parallel pull + attachment bytes prefetch (HTTPS signed URL + raw Storage object-path).
 * `OfflineWarmSyncManager` ise debounced call karta — UI block na ho.
 */

import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { Company } from "@/hooks/useCompany";
import {
  COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS,
  pullAllCompanySubcollectionsFromFirestoreToLocalDb,
} from "@/lib/firestoreToLocalCompanyPull";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import { writeCachedPlansRecord } from "@/lib/plansCatalogCache";
import type { Plan, PlanId } from "@/config/plans";
import { decryptFirestoreCompanyDocIfNeeded, type ServerBackupCryptoContext } from "@/lib/serverBackupEncryption";
import { listCompanyDocsFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { stampLocalMirrorBackedByFirestore } from "@/lib/localMirrorServerMeta";
import {
  isOfflineCachedAttachmentOnDevice,
  prefetchHttpsAttachmentUrls,
} from "@/lib/offlineAttachmentUrlCache";
import {
  beginAttachmentPrefetchVoucherLookupSession,
  endAttachmentPrefetchVoucherLookupSession,
  maybeNotifyAttachmentPrefetchBatchSummary,
  maybeNotifyAttachmentPrefetchFailure,
} from "@/lib/attachmentPrefetchUserNotice";
import {
  indexVoucherRowsForAttachmentLookup,
  registerAttachmentVoucherLookupKeys,
  type AttachmentVoucherHit,
} from "@/lib/attachmentPrefetchVoucherLookup";
import {
  getCrossCompanyAttachmentAccessPolicy,
  isCrossCompanyAttachmentVisibleToUser,
} from "@/lib/crossCompanyAttachmentAccess";
import { peekAttachmentPrefetchPrioritySnapshot } from "@/lib/attachmentPrefetchPriorityBuffer";
import { looksLikeFirebaseStorageObjectPath } from "@/lib/firebaseStorageDownloadUrl";
import {
  ATTACHMENT_HOLD_CLIPBOARD_PREFIX,
  normalizeAttachmentUrlForDevicePreview,
} from "@/lib/attachmentHoldClipboard";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { auth } from "@/lib/firebase";
import { markEmbeddedFullWarmSucceeded } from "@/lib/embeddedWarmBootstrapFlags";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { isDeviceLocalCompany, isServerGateCompany, shouldReadLedgerFromSqliteOnly } from "@/lib/companyStorageKind";
import { shouldUseAttachmentLazyLoad } from "@/lib/webAttachmentLazyLoadPolicy";

/** `_firestore_company_root` SQLite row — authoritative company snapshot for offline dashboards */
export const COMPANY_ROOT_MIRROR_COLLECTION = "_firestore_company_root";
export const COMPANY_ROOT_MIRROR_DOC_ID = "_snapshot";

/** `useVouchers`/billing jaisi shape — Pull + mirror Firestore realtime ke liye (`OfflineWarmSyncManager` multi-company warm bhi yahi filter). */
export function isCloudBackedCompanyShape(c: Company | null): boolean {
  if (!c) return false;
  const so = String((c as { storageOption?: string }).storageOption || "").toLowerCase();
  if (so === "local") return false;
  if (so === "firebase") return true;
  if ((c as { syncedFromCloud?: boolean }).syncedFromCloud === true) return true;
  if (String((c as { syncPolicy?: string }).syncPolicy || "").toLowerCase() === "online") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyC = c as any;
  if (String(anyC.authoritativeCompanyId || "").trim().length > 0) return true;
  return false;
}

/** APK/EXE: cloud Firebase + server-gate mirrored companies (SQLite me HTTPS URLs). */
export function shouldPrefetchAttachmentsForCompany(c: Company | null): boolean {
  if (!c) return false;
  if (isCloudBackedCompanyShape(c)) return true;
  if (isServerGateCompany(c)) return true;
  // Device-local / Drive-sync SQLite ledger — web + static dono par attachment warm.
  if (shouldReadLedgerFromSqliteOnly(c) || isDeviceLocalCompany(c)) return true;
  return false;
}

const SCRAPE_SKIP_KEYS = new Set([
  "_meta",
  "history",
  "changelog",
  "approvalHistory",
]);

/** Forensic: warm/scrape/prefetch proof — `NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG=1`. */
function offlineWarmForensicEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG === "1";
}

/** Nested doc se attachment URLs scrape — HTTPS + raw `voucher-files/` / `companies/` paths (prefetch + IndexedDB same keys). */
export function scrapeHttpsAttachmentUrlsFromDocTree(
  value: unknown,
  out: Set<string>,
  depth: number,
  /** Parent object key — `fileUrls` par non-HTTPS/non-object strings forensic ke liye. */
  parentKey?: string
): void {
  if (depth > 28) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s.length >= 8000) {
      if (offlineWarmForensicEnabled() && s.length >= 8000) {
        console.warn("[FORENSIC_SCRAPE_SKIP]", {
          reason: "string_too_long",
          length: s.length,
          parentKey: parentKey ?? null,
        });
      }
      return;
    }
    if (s.startsWith("http://") || s.startsWith("https://")) {
      out.add(s);
      return;
    }
    // Mirror/Firestore kabhi signed URL ke bina sirf Storage path string rakhta hai — pehle yahan miss → warm sync offline thumb nahi bharta tha.
    if (looksLikeFirebaseStorageObjectPath(s)) {
      out.add(s);
      return;
    }
    // Local/Drive refs + clipboard marker — embedded preload inhe bhi IndexedDB me bharta hai.
    if (isLocalFileRef(s) || isDriveFileRef(s)) {
      out.add(s);
      return;
    }
    if (s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) {
      const norm = normalizeAttachmentUrlForDevicePreview(s);
      if (norm) out.add(norm);
      return;
    }
    if (offlineWarmForensicEnabled() && parentKey === "fileUrls") {
      console.warn("[FORENSIC_SCRAPE_FILEURLS_NON_PREFETCHABLE]", {
        parentKey,
        valueSample: s.length > 800 ? `${s.slice(0, 800)}…` : s,
        looksLikeFirebaseStorageObjectPath: false,
        note: "voucher.fileUrls_slot_not_https_and_not_object_path_prefetch_will_skip",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scrapeHttpsAttachmentUrlsFromDocTree(item, out, depth + 1, parentKey);
    return;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      // History/changelog blobs nahi scrape — noise + size
      if (skipAttachmentScrapeKey(k)) continue;
      scrapeHttpsAttachmentUrlsFromDocTree(o[k], out, depth + 1, k);
    }
  }
}

/** Nested keys skip — `_meta`/history/`__pl*` mirror noise */
function skipAttachmentScrapeKey(key: string): boolean {
  if (SCRAPE_SKIP_KEYS.has(key)) return true;
  if (/^__pl/i.test(key)) return true;
  if (/^__/i.test(key) && key.length > 60) return true;
  return false;
}

export async function scrapeLocalMirrorAttachmentUrls(localCompanyId: string): Promise<Set<string>> {
  const scraped = await scrapeLocalMirrorAttachmentUrlsWithVoucherIndex(localCompanyId);
  return scraped.urls;
}

/** Mirror scrape ke baad kitni attachment URLs abhi disk/IDB par nahi — incremental sync + progress bar gate. */
export async function countPendingAttachmentDownloadsForCompany(
  localCompanyId: string
): Promise<{ total: number; pending: number }> {
  const trim = localCompanyId.trim();
  if (!trim) return { total: 0, pending: 0 };
  const urls = [...(await scrapeLocalMirrorAttachmentUrls(trim))];
  if (urls.length === 0) return { total: 0, pending: 0 };
  const batch = 16;
  let pending = 0;
  for (let i = 0; i < urls.length; i += batch) {
    const slice = urls.slice(i, i + batch);
    const hits = await Promise.all(slice.map((u) => isOfflineCachedAttachmentOnDevice(u)));
    pending += hits.filter((onDevice) => !onDevice).length;
  }
  return { total: urls.length, pending };
}

/** Warm prefetch: URL set + scrape-time voucher index (exact voucher no. toast ke liye). */
export async function scrapeLocalMirrorAttachmentUrlsWithVoucherIndex(localCompanyId: string): Promise<{
  urls: Set<string>;
  voucherByAttachmentKey: Map<string, AttachmentVoucherHit>;
}> {
  const out = new Set<string>();
  const voucherByAttachmentKey = new Map<string, AttachmentVoucherHit>();
  const paths = COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS as unknown as readonly string[];
  for (const collection of paths) {
    const rows = await listCompanyDocsFromBrowserDb(localCompanyId, collection, { forBackupMerge: true });
    if (collection === "vouchers") {
      indexVoucherRowsForAttachmentLookup(rows, localCompanyId, voucherByAttachmentKey);
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const id = String(r.id || "").trim();
        if (!id) continue;
        const hit: AttachmentVoucherHit = {
          id,
          voucherNumber: String(r.voucherNumber || "").trim() || id,
          type: String(r.type || "").trim(),
          companyId: localCompanyId,
        };
        const rowUrls = new Set<string>();
        scrapeHttpsAttachmentUrlsFromDocTree(row, rowUrls, 0);
        for (const u of rowUrls) {
          registerAttachmentVoucherLookupKeys(voucherByAttachmentKey, u, hit, localCompanyId);
        }
      }
    }
    for (const row of rows) {
      scrapeHttpsAttachmentUrlsFromDocTree(row, out, 0);
    }
  }

  const policy = getCrossCompanyAttachmentAccessPolicy();
  const accessible =
    policy.accessibleCompanyIds.size > 0
      ? policy.accessibleCompanyIds
      : new Set([localCompanyId]);
  const filteredUrls = new Set<string>();
  for (const u of out) {
    if (isCrossCompanyAttachmentVisibleToUser(u, localCompanyId, accessible)) {
      filteredUrls.add(u);
    }
  }
  return { urls: filteredUrls, voucherByAttachmentKey };
}

async function mergePlansIntoLocalStorageBestEffort(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(firestore, "app_settings", "plans"));
    if (!snap.exists()) return false;
    const data = snap.data() as Record<string, unknown>;
    const list = mergeAppSettingsPlansDoc(data);
    const merged = {} as Record<PlanId, Plan>;
    for (const p of list) merged[p.id as PlanId] = p;
    writeCachedPlansRecord(merged);
    return true;
  } catch {
    return false;
  }
}

/**
 * Companies/{fsCompanyId} → SQLite `_firestore_company_root` — billing/plan fields offline dikhen
 */
async function mirrorCompanyFirestoreDocToSQLite(
  fsCompanyId: string,
  localCompanyId: string,
  company: Company | null
): Promise<boolean> {
  try {
    const snap = await getDoc(doc(firestore, "companies", fsCompanyId));
    if (!snap.exists()) return false;
    const cryptoCtx: ServerBackupCryptoContext | null = company
      ? { encryptServerBackupSalt: (company as Company & { encryptServerBackupSalt?: string }).encryptServerBackupSalt }
      : null;
    let payload = { id: snap.id, ...(snap.data() as Record<string, unknown>) } as Record<string, unknown>;
    const dec = await decryptFirestoreCompanyDocIfNeeded(
      payload as Record<string, unknown> & { id: string },
      cryptoCtx,
      localCompanyId
    );
    if (dec) payload = dec as Record<string, unknown>;
    const stamped = stampLocalMirrorBackedByFirestore(payload as Record<string, unknown>);
    await upsertCompanyDocInBrowserDb(localCompanyId, COMPANY_ROOT_MIRROR_COLLECTION, COMPANY_ROOT_MIRROR_DOC_ID, stamped, {
      notify: false,
      force: true,
    });
    return true;
  } catch (e) {
    console.warn("[offlineFullWarmSync] company root mirror failed", e);
    return false;
  }
}

export type OfflineFullWarmSyncResult = {
  plansOk: boolean;
  companyRootOk: boolean;
  subcollections: Array<{ path: string; count: number }>;
  attachmentUrlsSeen: number;
  prefetchCachedNew: number;
  prefetchSkippedCache: number;
  prefetchFailures: number;
};

/** First-login overlay: SQLite subcollection pull + attachment URL queue progress */
export type OfflineFullWarmProgressEvent =
  | { kind: "data_subcollection"; localCompanyId: string; path: string; completed: number; total: number }
  | { kind: "attachment_item"; localCompanyId: string; done: number; total: number };

export async function runOfflineFullWarmSync(options: {
  company: Company | null;
  localCompanyId: string;
  /** AbortController — tab switch ya app background par cancel */
  signal?: AbortSignal;
  /** Startup responsiveness mode: keep attachment prefetch off unless explicitly enabled. */
  includeAttachmentPrefetch?: boolean;
  /** Account-wide warm: har company ke baad bootstrap flag mat lagao — sirf poori queue ke baad. */
  skipWarmBootstrapFlag?: boolean;
  /** Pehli-login loading rows — har subcollection / har attachment attempt */
  onProgress?: (e: OfflineFullWarmProgressEvent) => void;
}): Promise<OfflineFullWarmSyncResult | null> {
  const {
    company,
    localCompanyId,
    signal,
    onProgress,
    includeAttachmentPrefetch = false,
    skipWarmBootstrapFlag = false,
  } = options;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  if (!localCompanyId?.trim()) return null;
  if (!isCloudBackedCompanyShape(company)) return null;
  // Data tick OFF: no Firestore warm download — Local SQLite stays as-is for offline UI.
  const { isOnlineCompanyLedgerCloudSyncAllowed } = await import("@/lib/onlineCompanySelectorSyncPolicy");
  if (!isOnlineCompanyLedgerCloudSyncAllowed(localCompanyId, company)) return null;

  const fsCompanyId = String((company as { authoritativeCompanyId?: string }).authoritativeCompanyId || localCompanyId).trim();
  const isEmbeddedClient =
    typeof window !== "undefined" ? isEmbeddedOfflinePreloadClient() : false;

  const result: OfflineFullWarmSyncResult = {
    plansOk: false,
    companyRootOk: false,
    subcollections: [],
    attachmentUrlsSeen: 0,
    prefetchCachedNew: 0,
    prefetchSkippedCache: 0,
    prefetchFailures: 0,
  };

  if (signal?.aborted) return null;

  result.plansOk = await mergePlansIntoLocalStorageBestEffort();

  if (signal?.aborted) return result;

  result.companyRootOk = await mirrorCompanyFirestoreDocToSQLite(fsCompanyId, localCompanyId.trim(), company);

  if (signal?.aborted) return result;

  const localTrim = localCompanyId.trim();
  result.subcollections = await pullAllCompanySubcollectionsFromFirestoreToLocalDb(
    fsCompanyId,
    localTrim,
    company,
    {
      onSubcollectionDone: (info) => {
        onProgress?.({
          kind: "data_subcollection",
          localCompanyId: localTrim,
          path: info.path,
          completed: info.completed,
          total: info.total,
        });
      },
    }
  );

  if (signal?.aborted) return result;

  if (!includeAttachmentPrefetch || shouldUseAttachmentLazyLoad(company)) {
    // Explicit startup policy / online lazy: skip global attachment crawl/download.
    result.attachmentUrlsSeen = 0;
    result.prefetchCachedNew = 0;
    result.prefetchSkippedCache = 0;
    result.prefetchFailures = 0;
    onProgress?.({ kind: "attachment_item", localCompanyId: localTrim, done: 1, total: 1 });
  } else {
    const scraped = await scrapeLocalMirrorAttachmentUrlsWithVoucherIndex(localTrim);
    const urls = scraped.urls;
    result.attachmentUrlsSeen = urls.size;
    beginAttachmentPrefetchVoucherLookupSession(scraped.voucherByAttachmentKey, localTrim);
    try {
    const prefetch = await prefetchHttpsAttachmentUrls(urls, {
      concurrency: 6,
      // Auto-full cache mode: embedded app me strict warm caps se files offline miss ho rahi thi; upper budget badhao.
      maxTotalBytesApprox: isEmbeddedClient ? 2_500 * 1024 * 1024 : 350 * 1024 * 1024,
      maxUrls: isEmbeddedClient ? 20_000 : 2600,
      // Ledger visible rows (buffer) pehle — baaki mirror URLs same run me peeche, skip nahi
      prioritizeUrls: peekAttachmentPrefetchPrioritySnapshot(),
      signal,
      onItemDone: (done, total) => {
        onProgress?.({ kind: "attachment_item", localCompanyId: localTrim, done, total });
      },
      // Attachment sync diagnostics: specific URL failures / retries ko trace karne ke liye concise item logs.
      onItemLog: (ev) => {
        if (ev.ok) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[offlineFullWarmSync:item]", { ok: true, attempt: ev.attempt, status: ev.status, note: ev.note, url: ev.url });
          }
        } else {
          console.warn("[offlineFullWarmSync:item]", {
            ok: false,
            attempt: ev.attempt,
            status: ev.status,
            retryable: ev.retryable,
            note: ev.note,
            url: ev.url,
          });
          maybeNotifyAttachmentPrefetchFailure(ev, { mirrorCompanyId: localTrim });
        }
      },
    });
    result.prefetchCachedNew = prefetch.cachedNew;
    result.prefetchSkippedCache = prefetch.skippedAlreadyCached;
    result.prefetchFailures = prefetch.failed + prefetch.skippedBudget;
    maybeNotifyAttachmentPrefetchBatchSummary({
      failedCount: prefetch.failed,
      companyName: company?.name ?? null,
      companyId: localTrim,
    });
    } finally {
      endAttachmentPrefetchVoucherLookupSession();
    }
  }

  try {
    if (process.env.NODE_ENV === "development") {
      console.debug("[offlineFullWarmSync] done", {
        fsCompanyId,
        vouchersApprox: result.subcollections.find((s) => s.path === "vouchers")?.count,
        urls: result.attachmentUrlsSeen,
        cachedNew: result.prefetchCachedNew,
      });
    }
  } catch {
    /* ignore */
  }

  // APK/EXE: agli cold start par idle `getIdToken`/plan-sync attachment race kam kare — account-wide warm me ek baar end par lagta hai
  if (!skipWarmBootstrapFlag) {
    try {
      markEmbeddedFullWarmSucceeded(auth.currentUser?.uid ?? null);
    } catch {
      /* ignore */
    }
  }

  return result;
}

/** SQLite mirror se scrape + HTTPS prefetch summary — data overlay ke baad background strip ke liye. */
export type EmbeddedAttachmentPrefetchSummary = {
  attachmentUrlsSeen: number;
  prefetchCachedNew: number;
  prefetchSkippedCache: number;
  prefetchFailures: number;
};

/**
 * Data warm ke baad alag call: attachment bytes IndexedDB/native cache — UI block nahi, header % chal sakta hai.
 */
/** Optional caps — `CompanyAttachmentOfflineBackfillManager` web/PWA par bhi “poora mirror” prefetch chalata hai. */
export type AttachmentPrefetchOverrides = {
  maxUrls?: number;
  maxTotalBytesApprox?: number;
  concurrency?: number;
};

export async function runEmbeddedAttachmentPrefetchPhase(args: {
  company: Company | null;
  localCompanyId: string;
  signal?: AbortSignal;
  onProgressPercent?: (pct: number) => void;
  /** Default: embedded vs browser alag budget; backfill manager yahan aggressive values bhej sakta hai. */
  prefetchOverrides?: AttachmentPrefetchOverrides;
  /** Post-sync pass: header % 0 par reset na ho (fast already-cached skip). */
  continueProgress?: boolean;
}): Promise<EmbeddedAttachmentPrefetchSummary | null> {
  const { company, localCompanyId, signal, onProgressPercent, prefetchOverrides, continueProgress } =
    args;
  if (offlineWarmForensicEnabled()) {
    console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", {
      phase: "entry",
      localCompanyId: localCompanyId.trim(),
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      shouldPrefetchAttachmentsForCompany: shouldPrefetchAttachmentsForCompany(company),
    });
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    onProgressPercent?.(100);
    if (offlineWarmForensicEnabled()) {
      console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", {
        phase: "early_exit_offline_navigator",
        navigatorOnLine: false,
      });
    }
    return null;
  }
  const trim = localCompanyId.trim();
  if (!trim || !shouldPrefetchAttachmentsForCompany(company)) {
    onProgressPercent?.(100);
    if (offlineWarmForensicEnabled()) {
      console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", {
        phase: "early_exit_not_prefetch_eligible_or_empty_company_id",
        trim,
        shouldPrefetchAttachmentsForCompany: shouldPrefetchAttachmentsForCompany(company),
      });
    }
    return null;
  }

  if (shouldUseAttachmentLazyLoad(company)) {
    onProgressPercent?.(100);
    return { attachmentUrlsSeen: 0, prefetchCachedNew: 0, prefetchSkippedCache: 0, prefetchFailures: 0 };
  }

  const isEmbeddedClient =
    typeof window !== "undefined" ? isEmbeddedOfflinePreloadClient() : false;

  const scraped = await scrapeLocalMirrorAttachmentUrlsWithVoucherIndex(trim);
  const urls = scraped.urls;
  const attachmentUrlsSeen = urls.size;
  beginAttachmentPrefetchVoucherLookupSession(scraped.voucherByAttachmentKey, trim);
  try {
  if (offlineWarmForensicEnabled()) {
    console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", {
      phase: "post_scrape_local_mirror",
      urlsScrapedDistinctCount: attachmentUrlsSeen,
      sampleScrapedUrls: [...urls].slice(0, 50),
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  if (signal?.aborted) {
    onProgressPercent?.(0);
    return { attachmentUrlsSeen, prefetchCachedNew: 0, prefetchSkippedCache: 0, prefetchFailures: 0 };
  }

  if (attachmentUrlsSeen === 0) {
    onProgressPercent?.(100);
    if (offlineWarmForensicEnabled()) {
      console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", { phase: "early_exit_zero_urls_after_scrape" });
    }
    return { attachmentUrlsSeen: 0, prefetchCachedNew: 0, prefetchSkippedCache: 0, prefetchFailures: 0 };
  }

  if (!continueProgress) {
    onProgressPercent?.(0);
  }
  const defaultMaxUrls = isEmbeddedClient ? 20_000 : 2600;
  const defaultBudget = isEmbeddedClient ? 2_500 * 1024 * 1024 : 350 * 1024 * 1024;
  const prefetch = await prefetchHttpsAttachmentUrls(urls, {
    concurrency: Math.max(1, Math.min(12, prefetchOverrides?.concurrency ?? 6)),
    maxTotalBytesApprox: prefetchOverrides?.maxTotalBytesApprox ?? defaultBudget,
    maxUrls: prefetchOverrides?.maxUrls ?? defaultMaxUrls,
    prioritizeUrls: peekAttachmentPrefetchPrioritySnapshot(),
    signal,
    mirrorCompanyId: trim,
    skipLeadingZeroReport: continueProgress === true,
    onItemDone: (done, total) => {
      const pct = total <= 0 ? 100 : Math.min(100, Math.round((done / Math.max(1, total)) * 100));
      onProgressPercent?.(pct);
    },
    onItemLog: (ev) => {
      if (offlineWarmForensicEnabled()) {
        console.warn("[FORENSIC_EMBEDDED_PREFETCH_ITEM]", ev);
      }
      if (ev.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[runEmbeddedAttachmentPrefetchPhase:item]", { ok: true, url: ev.url });
        }
      } else {
        console.warn("[runEmbeddedAttachmentPrefetchPhase:item]", { ok: false, url: ev.url, note: ev.note });
        maybeNotifyAttachmentPrefetchFailure(ev, { mirrorCompanyId: trim });
      }
    },
  });

  onProgressPercent?.(100);
  maybeNotifyAttachmentPrefetchBatchSummary({
    failedCount: prefetch.failed,
    companyName: company?.name ?? null,
    companyId: trim,
  });
  if (offlineWarmForensicEnabled()) {
    console.warn("[FORENSIC_EMBEDDED_PREFETCH_PHASE]", {
      phase: "complete",
      attachmentUrlsSeen,
      prefetchCachedNew: prefetch.cachedNew,
      prefetchSkippedCache: prefetch.skippedAlreadyCached,
      prefetchFailedRaw: prefetch.failed,
      prefetchSkippedBudget: prefetch.skippedBudget,
      prefetchFailuresTotal: prefetch.failed + prefetch.skippedBudget,
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  return {
    attachmentUrlsSeen,
    prefetchCachedNew: prefetch.cachedNew,
    prefetchSkippedCache: prefetch.skippedAlreadyCached,
    prefetchFailures: prefetch.failed + prefetch.skippedBudget,
  };
  } finally {
    endAttachmentPrefetchVoucherLookupSession();
  }
}
