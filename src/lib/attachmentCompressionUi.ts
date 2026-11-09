"use client";

import { useSyncExternalStore } from "react";
import { toast as sonnerToast } from "sonner";
import {
  VOUCHER_SONNER_SUCCESS_MS,
  VOUCHER_SONNER_TOAST_CN,
  VOUCHER_SONNER_TOAST_POSITION,
} from "@/lib/voucherSaveUi";
import {
  isServerGateCompany,
  isStrictLocalOnlyCompany,
  type CompanyStorageRow,
} from "@/lib/companyStorageKind";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { isDriveCloudSyncLocalRegistryRow } from "@/lib/driveRestoredLocalCompany";
import type { Entitlements } from "@/config/plans";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";

/**
 * Shared UX for voucher-style attachments: compress first, then cap.
 * Images: Online ≤100KB; Local / PL Server / Drive ≤150KB (soft floor ~50KB on defaults).
 * Admin From–To band (e.g. 30–35 KB): output stays inside that range.
 * PDFs stay on the larger 0.5MB band (raster quality).
 *
 * Same image caps apply to masters (party/staff/bank/tax/item), company logo,
 * gallery, and admin uploads via `compressImageForCompany`.
 */

/** PDF / legacy reject ceiling after compress. */
export const ATTACHMENT_MAX_SIZE_MB = 0.5;

/** Online (Firestore) image post-compress ceiling. */
export const ONLINE_IMAGE_MAX_KB = 100;

/** Local, PL Server, Drive image post-compress ceiling. */
export const LOCAL_LIKE_IMAGE_MAX_KB = 150;

/** Soft floor — don't chase smaller than this if already under max. */
export const IMAGE_SOFT_MIN_KB = 50;

const imageCompressionListeners = new Set<() => void>();
let imageCompressionCount = 0;

const compressionProgressListeners = new Set<() => void>();
let compressionProgressActive = false;
let compressionProgressPercent = 0;
let compressionProgressShownAt = 0;
let compressionFinishTimer: ReturnType<typeof setTimeout> | null = null;
let compressionProgressSnapshot = { active: false, percent: 0 };
const COMPRESSION_PROGRESS_SERVER_SNAPSHOT = { active: false, percent: 0 };

const COMPRESSION_PROGRESS_MIN_VISIBLE_MS = 650;
const COMPRESSION_TOAST_ID = "pl-attachment-compression-progress";

export class AttachmentCompressionCancelledError extends Error {
  constructor() {
    super("Attachment compression cancelled");
    this.name = "AttachmentCompressionCancelledError";
  }
}

let compressionAbortController: AbortController | null = null;
/** Cancel ke baad in-flight onProgress loading toast dubara na banaye. */
let compressionUserCancelled = false;

/** Naya save / add-file batch — purana compress abort. */
export function beginAttachmentCompressionAbortScope(): AbortSignal {
  compressionAbortController?.abort();
  compressionUserCancelled = false;
  compressionAbortController = new AbortController();
  return compressionAbortController.signal;
}

export function endAttachmentCompressionAbortScope(): void {
  compressionAbortController = null;
}

export function cancelAttachmentCompressionWork(): void {
  compressionUserCancelled = true;
  compressionAbortController?.abort();
  compressionAbortController = null;
  dismissAttachmentCompressionProgressToast();
}

export function isAttachmentCompressionUserCancelled(): boolean {
  return compressionUserCancelled;
}

export function getAttachmentCompressionAbortSignal(): AbortSignal | undefined {
  return compressionAbortController?.signal;
}

export function throwIfAttachmentCompressionAborted(signal?: AbortSignal | null): void {
  const active = signal ?? compressionAbortController?.signal;
  if (active?.aborted) throw new AttachmentCompressionCancelledError();
}

export function isAttachmentCompressionCancelledError(error: unknown): boolean {
  return error instanceof AttachmentCompressionCancelledError;
}

function syncCompressionSonnerToast(percent: number): void {
  sonnerToast.loading(`Attachment compressing… ${percent}%`, {
    id: COMPRESSION_TOAST_ID,
    position: VOUCHER_SONNER_TOAST_POSITION,
    duration: Infinity,
    classNames: { toast: VOUCHER_SONNER_TOAST_CN },
  });
}

function getCompressionProgressSnapshot(): { active: boolean; percent: number } {
  if (
    compressionProgressSnapshot.active === compressionProgressActive &&
    compressionProgressSnapshot.percent === compressionProgressPercent
  ) {
    return compressionProgressSnapshot;
  }
  compressionProgressSnapshot = {
    active: compressionProgressActive,
    percent: compressionProgressPercent,
  };
  return compressionProgressSnapshot;
}

function emitCompressionProgressChange(): void {
  compressionProgressListeners.forEach((listener) => listener());
}

export function setAttachmentCompressionProgress(percent: number): void {
  if (compressionUserCancelled || compressionAbortController?.signal.aborted) return;
  const next = Math.min(100, Math.max(0, Math.round(percent)));
  if (!compressionProgressActive) compressionProgressShownAt = Date.now();
  if (compressionFinishTimer) {
    clearTimeout(compressionFinishTimer);
    compressionFinishTimer = null;
  }
  compressionProgressActive = true;
  compressionProgressPercent = next;
  syncCompressionSonnerToast(next);
  emitCompressionProgressChange();
}

/** Compress loading toast turant hatao — success / next row alag stack me dikhe. */
export function dismissAttachmentCompressionProgressToast(): void {
  if (compressionFinishTimer) {
    clearTimeout(compressionFinishTimer);
    compressionFinishTimer = null;
  }
  compressionProgressActive = false;
  compressionProgressPercent = 0;
  compressionProgressShownAt = 0;
  sonnerToast.dismiss(COMPRESSION_TOAST_ID);
  emitCompressionProgressChange();
}

export function finishAttachmentCompressionProgress(): void {
  // Already at 100%: turant hatáo — warna "Saving…" ke saath spinner 100% chipak jata hai.
  if (compressionProgressPercent >= 100) {
    dismissAttachmentCompressionProgressToast();
    return;
  }
  const elapsed = compressionProgressShownAt ? Date.now() - compressionProgressShownAt : 0;
  const wait = Math.max(0, COMPRESSION_PROGRESS_MIN_VISIBLE_MS - elapsed);
  if (compressionFinishTimer) clearTimeout(compressionFinishTimer);
  compressionFinishTimer = setTimeout(() => {
    compressionFinishTimer = null;
    dismissAttachmentCompressionProgressToast();
  }, wait);
}

export function showAttachmentCompressionDoneToast(message: string): void {
  dismissAttachmentCompressionProgressToast();
  sonnerToast.success(message, {
    position: VOUCHER_SONNER_TOAST_POSITION,
    duration: VOUCHER_SONNER_SUCCESS_MS,
    classNames: { toast: VOUCHER_SONNER_TOAST_CN },
  });
}

export function isAttachmentCompressionProgressActive(): boolean {
  return compressionProgressActive;
}

/** Cancel — console error nahi; chhota info toast (duplicate id se ek hi). */
export function showAttachmentCompressionCancelledToast(): void {
  sonnerToast.message("Attachment compression cancelled", {
    id: "pl-attachment-compression-cancelled",
    position: VOUCHER_SONNER_TOAST_POSITION,
    duration: VOUCHER_SONNER_SUCCESS_MS,
    classNames: { toast: VOUCHER_SONNER_TOAST_CN },
  });
}

/** Batch compress: file index + inner 0–100 → overall %. */
export function reportAttachmentCompressionProgress(
  fileIndex: number,
  fileCount: number,
  fileInnerPct = 0
): void {
  if (fileCount <= 0) {
    setAttachmentCompressionProgress(100);
    return;
  }
  const overall = ((fileIndex + fileInnerPct / 100) / fileCount) * 100;
  setAttachmentCompressionProgress(Math.max(1, Math.min(99, Math.round(overall))));
}

/** Multi-file parallel compress — har file ka % average karke overall toast update. */
export function createParallelAttachmentCompressionReporter(
  fileCount: number,
  silent?: boolean
): (fileIndex: number, fileInnerPct: number) => void {
  const inner = new Array(Math.max(0, fileCount)).fill(0);
  return (fileIndex, fileInnerPct) => {
    if (silent || fileCount <= 0 || fileIndex < 0 || fileIndex >= fileCount) return;
    inner[fileIndex] = fileInnerPct;
    const overall = inner.reduce((sum, pct) => sum + pct, 0) / fileCount;
    setAttachmentCompressionProgress(Math.max(1, Math.min(99, Math.round(overall))));
  };
}

export function useAttachmentCompressionProgress(): { active: boolean; percent: number } {
  return useSyncExternalStore(
    (listener) => {
      compressionProgressListeners.add(listener);
      return () => compressionProgressListeners.delete(listener);
    },
    getCompressionProgressSnapshot,
    () => COMPRESSION_PROGRESS_SERVER_SNAPSHOT
  );
}

function emitImageCompressionChange(): void {
  imageCompressionListeners.forEach((listener) => listener());
}

function beginImageCompressionProcessing(): () => void {
  imageCompressionCount += 1;
  emitImageCompressionChange();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    imageCompressionCount = Math.max(0, imageCompressionCount - 1);
    emitImageCompressionChange();
  };
}

export function isImageCompressionProcessing(): boolean {
  return imageCompressionCount > 0;
}

/** Masters / logo / gallery — Save disable + Compressing UI. */
export function useImageCompressionProcessing(): boolean {
  return useSyncExternalStore(
    (listener) => {
      imageCompressionListeners.add(listener);
      return () => imageCompressionListeners.delete(listener);
    },
    isImageCompressionProcessing,
    () => false
  );
}

export function attachmentMaxBytes(): number {
  return ATTACHMENT_MAX_SIZE_MB * 1024 * 1024;
}

function isOnlineFirebaseCompressBandCompany(
  company: CompanyStorageRow | null | undefined
): boolean {
  if (!company) return false;
  const so = String(company.storageOption ?? "").toLowerCase().trim();
  if (so === "local") return false;
  if (so === "firebase") return true;
  if (company.syncedFromCloud === true) return true;
  if (String(company.syncPolicy ?? "").toLowerCase() === "online") return true;
  if (String(company.authoritativeCompanyId ?? "").trim()) return true;
  return false;
}

/** Local / PL / Drive → Offline band; Firebase online → Online band (admin 40–45 KB). */
export function companyUsesRelaxedImageAttachmentCap(
  company: CompanyStorageRow | null | undefined
): boolean {
  if (!company) return false;
  if (isOnlineFirebaseCompressBandCompany(company)) return false;
  if (isServerGateCompany(company)) return true;
  if (isDriveCloudSyncLocalRegistryRow(company as never)) return true;
  if (isStrictLocalOnlyCompany(company)) return true;
  const so = String(company.storageOption ?? "").toLowerCase().trim();
  if (so === "local" || so === "drive") return true;
  if (String(company.syncPolicy ?? "").toLowerCase() === "offline") return true;
  if (isOfflineCompanyStorage(company as Parameters<typeof isOfflineCompanyStorage>[0])) return true;
  return false;
}

export type CompressImageKbBand = { minKb: number; maxKb: number };

function readEntitlementKb(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Plan entitlements → From–To KB band; 0 = platform default side. */
export function compressImageKbBandFromEntitlements(
  entitlements: Partial<Entitlements> | undefined,
  useLocalLimit: boolean
): CompressImageKbBand {
  const defaultMax = useLocalLimit ? LOCAL_LIKE_IMAGE_MAX_KB : ONLINE_IMAGE_MAX_KB;
  const defaultMin = IMAGE_SOFT_MIN_KB;
  const e = entitlements ?? {};

  const localMaxKb = readEntitlementKb(e.maxCompressImageKbLocal);
  const localMinKb = readEntitlementKb(e.minCompressImageKbLocal);
  const onlineMaxKb = readEntitlementKb(e.maxCompressImageKb);
  const onlineMinKb = readEntitlementKb(e.minCompressImageKb);

  // Local company -> Local keys; Online (Firebase / PocketBase) company -> Online keys.
  // If a side has neither Max nor Min set (empty / 0), the whole side falls back to the other side's
  // pair (Online -> Local values, as requested; Local -> Online for legacy plans), then platform default.
  // Pair-wise (not per field) so a lone Online Max never mixes with a Local Min.
  const localHasValue = localMaxKb > 0 || localMinKb > 0;
  const onlineHasValue = onlineMaxKb > 0 || onlineMinKb > 0;
  let maxKb: number;
  let minKb: number;
  if (useLocalLimit) {
    const useOwn = localHasValue || !onlineHasValue;
    maxKb = useOwn ? localMaxKb : onlineMaxKb;
    minKb = useOwn ? localMinKb : onlineMinKb;
  } else {
    const useOwn = onlineHasValue || !localHasValue;
    maxKb = useOwn ? onlineMaxKb : localMaxKb;
    minKb = useOwn ? onlineMinKb : localMinKb;
  }
  if (maxKb <= 0) maxKb = defaultMax;
  if (minKb <= 0) {
    // Legacy: sirf To set tha — From ≈ 90% of To; defaults par platform floor.
    minKb = maxKb !== defaultMax ? Math.max(8, Math.floor(maxKb * 0.9)) : defaultMin;
  }
  if (minKb > maxKb) [minKb, maxKb] = [maxKb, minKb];
  maxKb = Math.max(1, maxKb);
  minKb = Math.max(1, Math.min(minKb, maxKb));
  return { minKb, maxKb };
}

/** @deprecated Use `compressImageKbBandFromEntitlements` — max side of band. */
export function compressImageMaxKbFromEntitlements(
  entitlements: Partial<Entitlements> | undefined,
  useLocalLimit: boolean
): number {
  return compressImageKbBandFromEntitlements(entitlements, useLocalLimit).maxKb;
}

export function attachmentImageKbBandForCompany(
  company?: CompanyStorageRow | null,
  entitlements?: Partial<Entitlements> | null,
  opts?: { forceOnlineBand?: boolean }
): CompressImageKbBand {
  // Pocket Ledger Server (PocketBase) companies are online companies: use the Online plan keys
  // (maxCompressImageKb / minCompressImageKb), not the device-local ones.
  const useLocal = opts?.forceOnlineBand === true ? false : companyUsesRelaxedImageAttachmentCap(company);
  if (entitlements) {
    return compressImageKbBandFromEntitlements(entitlements, useLocal);
  }
  const maxKb = useLocal ? LOCAL_LIKE_IMAGE_MAX_KB : ONLINE_IMAGE_MAX_KB;
  return { minKb: IMAGE_SOFT_MIN_KB, maxKb };
}

export function attachmentImageMaxKbForCompany(
  company?: CompanyStorageRow | null,
  entitlements?: Partial<Entitlements> | null
): number {
  return attachmentImageKbBandForCompany(company, entitlements).maxKb;
}

async function resolveCompressionPlanId(
  companyId: string,
  companyRow?: CompanyStorageRow | null
): Promise<PlanId> {
  const { resolveEffectivePlanIdForVoucherQuota } = await import("@/lib/companyPlanLocalCache");
  const sqliteHint = companyRow as { planId?: string | null; planExpiryMs?: unknown } | null | undefined;
  let planId = resolveEffectivePlanIdForVoucherQuota(companyId, sqliteHint ?? null);
  if (planId === "basic") {
    try {
      const { auth } = await import("@/lib/plClientSession");
      const uid = auth.currentUser?.uid?.trim();
      if (uid) {
        const { readAccountPlanLocalCache } = await import("@/lib/accountPlanLocalCache");
        const accountPlan = readAccountPlanLocalCache(uid)?.planId;
        if (accountPlan && accountPlan !== "basic") {
          planId = normalizePlanIdForClient(accountPlan);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return planId;
}

async function resolvePlanEntitlementsForCompany(
  companyId: string,
  companyRow?: CompanyStorageRow | null
): Promise<Partial<Entitlements>> {
  try {
    const { resolvePlansCatalogForEntitlements } = await import("@/lib/plansCatalogCache");
    const { getPlanFromPlans } = await import("@/hooks/useLivePlans");
    const planId = await resolveCompressionPlanId(companyId, companyRow);
    const plans = await resolvePlansCatalogForEntitlements();
    return getPlanFromPlans(plans, planId).entitlements;
  } catch {
    return {};
  }
}

export function attachmentImageMaxBytesForCompany(
  company?: CompanyStorageRow | null,
  entitlements?: Partial<Entitlements> | null
): number {
  return attachmentImageMaxKbForCompany(company, entitlements) * 1024;
}

const attachmentImageKbBandCache = new Map<
  string,
  { band: CompressImageKbBand; atMs: number }
>();
const ATTACHMENT_IMAGE_KB_BAND_CACHE_MS = 60 * 1000;

/** Resolve From–To KB band from company id. Unknown → online 50–100 KB. */
export async function resolveAttachmentImageKbBand(
  companyId?: string | null
): Promise<CompressImageKbBand> {
  const cid = String(companyId || "").trim();
  if (!cid) return { minKb: IMAGE_SOFT_MIN_KB, maxKb: ONLINE_IMAGE_MAX_KB };
  const cached = attachmentImageKbBandCache.get(cid);
  if (cached && Date.now() - cached.atMs < ATTACHMENT_IMAGE_KB_BAND_CACHE_MS) {
    return cached.band;
  }
  try {
    const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
    const row = (await getLocalCompanyById(cid, { includeDeleted: true })) as CompanyStorageRow | null;
    const entitlements = await resolvePlanEntitlementsForCompany(cid, row);
    let forceOnlineBand = false;
    try {
      const { isPocketBaseCompany } = await import("@/lib/pocketbaseData/pbCompanyRegistry");
      forceOnlineBand = isPocketBaseCompany(cid, row as never);
    } catch {
      forceOnlineBand = false;
    }
    const band = attachmentImageKbBandForCompany(row, entitlements ?? {}, { forceOnlineBand });
    attachmentImageKbBandCache.set(cid, { band, atMs: Date.now() });
    return band;
  } catch {
    return { minKb: IMAGE_SOFT_MIN_KB, maxKb: ONLINE_IMAGE_MAX_KB };
  }
}

/** Resolve image cap from company id (registry). Unknown / missing → online 100KB. */
export async function resolveAttachmentImageMaxBytes(
  companyId?: string | null
): Promise<number> {
  const band = await resolveAttachmentImageKbBand(companyId);
  return band.maxKb * 1024;
}

/**
 * After `compressVoucherAttachment` / `compressFile`, if size still exceeds `maxBytes`
 * (default 0.5 MB for PDF), show this toast.
 */
export function attachmentStillTooLargeToastFields(maxMb: number = ATTACHMENT_MAX_SIZE_MB): {
  title: string;
  description: string;
} {
  return {
    title: "File Still Too Large",
    description: `After compression the file is still over ${maxMb} MB. Try a smaller PDF or image.`,
  };
}

export function attachmentImageStillTooLargeToastFields(maxKb: number): {
  title: string;
  description: string;
} {
  return {
    title: "File Still Too Large",
    description: `After compression the image is still over ${maxKb} KB. Try a smaller photo.`,
  };
}

/** Masters / logo / gallery — progressive image compress to company cap. Never size-rejects. */
export async function compressImageForCompany(
  file: File,
  companyId?: string | null
): Promise<{ file: File; maxBytes: number; maxKb: number; minKb: number }> {
  const end = beginImageCompressionProcessing();
  try {
    const band = await resolveAttachmentImageKbBand(companyId);
    const maxBytes = band.maxKb * 1024;
    setAttachmentCompressionProgress(1);
    const { compressVoucherAttachment } = await import("@/lib/compression");
    const out = await compressVoucherAttachment(file, maxBytes, {
      minKB: band.minKb,
      onProgress: (pct) => setAttachmentCompressionProgress(pct),
    });
    return { file: out, maxBytes, maxKb: band.maxKb, minKb: band.minKb };
  } finally {
    setAttachmentCompressionProgress(100);
    finishAttachmentCompressionProgress();
    end();
  }
}

/**
 * Master documents: images → company image cap; PDFs → 0.5MB band.
 * Non image/pdf returned as-is.
 */
export async function compressMasterAttachmentForCompany(
  file: File,
  companyId?: string | null
): Promise<{ file: File; maxBytes: number; kind: "image" | "pdf" | "other" }> {
  const t = (file.type || "").toLowerCase();
  const isPdf = t === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = t.startsWith("image/");
  if (isImage) {
    const r = await compressImageForCompany(file, companyId);
    return { file: r.file, maxBytes: r.maxBytes, kind: "image" };
  }
  if (isPdf) {
    const maxBytes = attachmentMaxBytes();
    const { compressVoucherAttachment } = await import("@/lib/compression");
    const out = await compressVoucherAttachment(file, maxBytes);
    return { file: out, maxBytes, kind: "pdf" };
  }
  return { file, maxBytes: file.size, kind: "other" };
}
