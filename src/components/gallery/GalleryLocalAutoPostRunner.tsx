"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { getOrCreateDeviceId } from "@/lib/writeGateway/legacy/deviceLimitClient";
import { fetchAttachmentRefBlob } from "@/lib/attachmentRefBlobFetch";
import { fetchPbAttachmentBlob } from "@/lib/pocketbaseData/pbAttachments";
import { parseBill } from "@/modules/ocr/parser";
import { runOcrOnFile } from "@/modules/ocr/engine";
import { queueOcrHandoff } from "@/modules/ocr/handoff";
import { isOcrSelectableParty } from "@/modules/ocr/types";
import type { OcrParsedBill, OcrRawResult } from "@/modules/ocr/types";
import { DEFAULT_GALLERY_QUEUE_SEQUENCE, DEFAULT_GALLERY_SORT_ORDER, normalizeGalleryQueueSequence, normalizeGallerySortOrder, orderGalleryQueue, type GalleryQueueSequence, type GallerySortOrder } from "@/components/gallery/galleryQueueSequence";

type LocalAutoPostSettings = {
  enabled: boolean;
  processingMode: "semi" | "full";
  runLocation: "local-pc" | "server";
  runOnUpload: boolean;
  runOnSchedule: boolean;
  scheduleMode: "interval" | "date-time";
  scheduleMinutes: number;
  scheduleDate: string;
  scheduleTime: string;
  scanEngine: "gemini" | "google" | "azure";
  localRunnerUid: string;
  localRunnerDeviceId: string;
  missingFieldAction: "fail-and-continue" | "pause-and-hold";
  missingFieldRules: {
    debitMaster: "fail-and-continue" | "pause-and-hold";
    creditMaster: "fail-and-continue" | "pause-and-hold";
    item: "fail-and-continue" | "pause-and-hold" | "save-without";
    date: "fail-and-continue" | "pause-and-hold";
    tax: "fail-and-continue" | "pause-and-hold";
    other: "fail-and-continue" | "pause-and-hold";
  };
  itemRowMismatchAction: "fail-and-continue" | "pause-and-hold";
  amountMismatchAction: "fail-and-continue" | "pause-and-hold";
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: "move-to-duplicates" | "save-anyway" | "pause-for-review";
  queueSequence: GalleryQueueSequence;
  gallerySortOrder: GallerySortOrder;
};

type UnassignedRow = {
  id: string;
  url?: string;
  path?: string;
  name?: string;
  type?: string;
  status?: string;
  isDeleted?: boolean;
  deleted?: boolean;
  autoOcrStatus?: string;
  autoOcrProvider?: "gemini" | "google" | "azure";
  autoOcrStartedAtMs?: number;
  autoOcrDeviceId?: string;
  autoPostIgnoreDuplicateOnce?: boolean;
  restoredFromDuplicateAtMs?: number;
  updatedAt?: unknown;
};

const SETTINGS_DOC_ID = "server_auto_ocr";
const CLAIM_STALE_MS = 5 * 60_000;
const LOCAL_SCHEDULE_KEY = "pl.gallery.auto-ocr.local.schedule.v1";
const RATE_LIMIT_RETRY_BASE_MS = 5_000;
const RATE_LIMIT_RETRY_MAX_MS = 60_000;

function isServerRateLimitError(error: unknown): boolean {
  const e = error as { status?: unknown; message?: unknown } | null;
  return Number(e?.status) === 429 || /too many requests|rate.?limit/i.test(String(e?.message ?? ""));
}

function queueClaimVersion(row: UnassignedRow): string {
  const updatedAt = row.updatedAt as { toMillis?: () => number; seconds?: number } | undefined;
  const editedAt = typeof updatedAt?.toMillis === "function"
    ? updatedAt.toMillis()
    : Number(updatedAt?.seconds || 0);
  return [row.status || "", row.autoOcrStatus || "", row.autoOcrStartedAtMs || 0, row.restoredFromDuplicateAtMs || 0, editedAt].join(":");
}

function mimeFor(row: UnassignedRow): string {
  const name = String(row.name || row.url || "").toLowerCase();
  if (String(row.type || "").toLowerCase() === "pdf" || name.split(/[?#]/)[0].endsWith(".pdf")) return "application/pdf";
  if (name.split(/[?#]/)[0].endsWith(".png")) return "image/png";
  if (name.split(/[?#]/)[0].endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function missingRuleKey(value: string, voucherType?: string): keyof LocalAutoPostSettings["missingFieldRules"] {
  const text = value.toLowerCase();
  if (/item|line/.test(text)) return "item";
  if (/date/.test(text)) return "date";
  if (/tax|vat|tds/.test(text)) return "tax";
  const partyLike = /party|customer|supplier|payee|staff/.test(text);
  const accountLike = /bank|cash|ledger|purchase account|sales account|account/.test(text);
  if (partyLike || accountLike) {
    const type = String(voucherType || "").toLowerCase();
    if (partyLike && (type === "sale" || type === "payment_out" || type === "direct_expense")) return "debitMaster";
    if (partyLike && (type === "purchase" || type === "payment_in" || type === "direct_income")) return "creditMaster";
    if (accountLike && (type === "sale" || type === "payment_out" || type === "direct_expense")) return "creditMaster";
    if (accountLike && (type === "purchase" || type === "payment_in" || type === "direct_income")) return "debitMaster";
    if (/credit|cr\b|supplier|payee/.test(text)) return "creditMaster";
    return "debitMaster";
  }
  return "other";
}

function billFor(raw: OcrRawResult, kind: "sale" | "purchase", parties: readonly unknown[], items: readonly unknown[], ownName?: string | null, ownPan?: string | null): OcrParsedBill {
  return parseBill(raw, { kind, parties: parties as never, items: items as never, ownName, ownPan });
}

function safeInvoiceTarget(raw: OcrRawResult, parties: readonly any[], items: readonly any[], ownName?: string | null, ownPan?: string | null, allowSaveWithoutItems = false): { type: "sale" | "purchase"; bill: OcrParsedBill } | { error: string } {
  if (raw.meanConfidence < 55) return { error: "Image text is unclear; review it manually." };
  const sale = billFor(raw, "sale", parties, items, ownName, ownPan);
  const purchase = billFor(raw, "purchase", parties, items, ownName, ownPan);
  const matches = [
    ...(sale.docType?.type === "sale" ? [{ type: "sale" as const, bill: sale }] : []),
    ...(purchase.docType?.type === "purchase" ? [{ type: "purchase" as const, bill: purchase }] : []),
  ].filter((x) => (x.bill.docType?.confidence ?? 0) >= 0.85);
  if (matches.length !== 1) return { error: "Could not confidently identify this as a sale or purchase invoice." };
  const { type, bill } = matches[0];
  const party = bill.partyId?.status === "fill" ? parties.find((p) => String(p?.id || "") === bill.partyId?.value) : null;
  if (!isOcrSelectableParty(party)) return { error: "A unique, active customer or supplier could not be matched." };
  if (bill.date?.status !== "fill" || !(bill.date.value instanceof Date) || Number.isNaN(bill.date.value.getTime())) {
    return { error: "The invoice date needs manual review." };
  }
  if (bill.total?.status !== "fill" || !Number.isFinite(bill.total.value) || bill.total.value <= 0) {
    return { error: "The invoice total could not be verified." };
  }
  if (bill.lineItems?.status !== "fill" || !bill.lineItems.value.length) return { error: "Invoice line items did not pass the totals check." };
  if (bill.lineItems.value.some((line) => (!line.itemId && !allowSaveWithoutItems) || (line.itemId && !items.some((item) => String(item?.id || "") === line.itemId && item?.isDeleted !== true)))) {
    return { error: "One or more invoice items do not match an active item master." };
  }
  if (bill.tds?.status === "fill" && bill.tds.value > 0) return { error: "TDS needs a manual account and verification." };
  return { type, bill };
}

export function GalleryLocalAutoPostRunner({
  settings,
  settingsDialogOpen,
  isCompanyAdmin,
  settingsReady,
}: {
  settings: LocalAutoPostSettings;
  settingsDialogOpen: boolean;
  isCompanyAdmin: boolean;
  settingsReady: boolean;
}) {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const masters = useVouchers();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const fsId = String((company as any)?.authoritativeCompanyId || companyId || "").trim();
  const runnerHoldStorageKey = `pl.gallery.auto-post.runner-hold.v1:${fsId}:${deviceId}`;
  const readRunnerHeld = (key: string) => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(key) === "held"; } catch { return false; }
  };
  const settingsRef = useMemo(() => fsId ? doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID) : null, [fsId]);
  const canRun = settingsReady && settings.enabled && settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId &&
    !!fsId && !settingsDialogOpen;
  const canControlRunner = settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId && !!fsId;
  const [rows, setRows] = useState<UnassignedRow[]>([]);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherData, setVoucherData] = useState<Record<string, unknown> | null>(null);
  const [processDialogVisible, setProcessDialogVisible] = useState(true);
  const [runnerHeld, setRunnerHeld] = useState(() => readRunnerHeld(runnerHoldStorageKey));
  const [runnerHoldLoadedFor, setRunnerHoldLoadedFor] = useState(runnerHoldStorageKey);
  const [activeProcess, setActiveProcess] = useState<{ id: string; name: string } | null>(null);
  const activeJobRef = useRef<UnassignedRow | null>(null);
  const lastScanErrorRef = useRef<{ jobId: string; message: string } | null>(null);
  const busyRef = useRef(false);
  const runnerHeldRef = useRef(runnerHeld);
  const runnerStartedRef = useRef(!runnerHeld);
  const drainQueueRef = useRef(false);
  const staleRetryTimerRef = useRef<number | null>(null);
  const rateLimitRetryTimerRef = useRef<number | null>(null);
  const rateLimitUntilRef = useRef(0);
  const rateLimitAttemptRef = useRef(0);
  const claimBlockedVersionsRef = useRef(new Map<string, string>());
  const manualRetryIdsRef = useRef<Set<string>>(new Set());
  const processPendingRef = useRef<() => Promise<void>>(async () => {});
  const savedJobRef = useRef(false);
  const handledMissingJobIdRef = useRef("");
  const handledDuplicateJobIdRef = useRef("");
  const rowsRef = useRef<UnassignedRow[]>([]);
  const galleryQueueOrderRef = useRef<{ companyId: string; fileIds: string[] }>({ companyId: "", fileIds: [] });
  const settingsRefValue = useRef(settings);
  settingsRefValue.current = settings;
  rowsRef.current = rows;
  runnerHeldRef.current = runnerHeld;
  useEffect(() => {
    const held = readRunnerHeld(runnerHoldStorageKey);
    runnerHeldRef.current = held;
    runnerStartedRef.current = !held;
    setRunnerHeld(held);
    setRunnerHoldLoadedFor(runnerHoldStorageKey);
  }, [runnerHoldStorageKey]);
  const clearManualRetryId = useCallback((id: string) => {
    manualRetryIdsRef.current.delete(id);
    if (manualRetryIdsRef.current.size === 0 && !settingsRefValue.current.runOnUpload) drainQueueRef.current = false;
  }, []);

  const deferForServerRateLimit = useCallback((error: unknown) => {
    const attempt = Math.min(rateLimitAttemptRef.current + 1, 5);
    rateLimitAttemptRef.current = attempt;
    const delayMs = Math.min(RATE_LIMIT_RETRY_BASE_MS * (2 ** (attempt - 1)), RATE_LIMIT_RETRY_MAX_MS);
    rateLimitUntilRef.current = Date.now() + delayMs;
    if (rateLimitRetryTimerRef.current != null) window.clearTimeout(rateLimitRetryTimerRef.current);
    rateLimitRetryTimerRef.current = window.setTimeout(() => {
      rateLimitRetryTimerRef.current = null;
      rateLimitUntilRef.current = 0;
      if (!runnerHeldRef.current && settingsRefValue.current.enabled) {
        drainQueueRef.current = true;
        void processPendingRef.current();
      }
    }, delayMs);
    toast.message("Auto post is waiting for the server", {
      description: `Pocket Ledger Server is busy. It will retry in ${Math.ceil(delayMs / 1000)} seconds.`,
    });
    console.warn("[GalleryLocalAutoPost] server rate limited the queue claim", error);
  }, []);

  useEffect(() => () => {
    if (rateLimitRetryTimerRef.current != null) window.clearTimeout(rateLimitRetryTimerRef.current);
  }, []);

  const writeStatus = useCallback(async (row: UnassignedRow, patch: Record<string, unknown>) => {
    if (!fsId) return;
    await setDoc(doc(firestore, `companies/${fsId}/unassigned_documents`, row.id), {
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [fsId]);

  const failJob = useCallback(async (row: UnassignedRow, message: string, provider = settingsRefValue.current.scanEngine || "gemini") => {
    try {
      await writeStatus(row, {
        autoOcrStatus: "failed",
        autoOcrError: message.slice(0, 500),
        autoOcrProvider: provider,
        autoOcrFinishedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[GalleryLocalAutoPost] failed to record scan error", error);
    }
  }, [writeStatus]);

  const processOne = useCallback(async (row: UnassignedRow) => {
    if (!fsId || !user?.uid || !navigator.onLine) return false;
    const scanEngine = settingsRefValue.current.scanEngine || "gemini";
    const rowRef = doc(firestore, `companies/${fsId}/unassigned_documents`, row.id);
    const claimed = await runTransaction(firestore, async (tx) => {
      const snapshot = await tx.get(rowRef);
      if (!snapshot.exists()) return false;
      const current = snapshot.data() as Record<string, unknown>;
      if (current.isDeleted === true || current.deleted === true || current.status === "ASSIGNED" || current.status === "LOCKED") return false;
      const restoredFromDuplicate = Number(current.restoredFromDuplicateAtMs || 0) > 0;
      if ((current.autoOcrStatus === "complete" || current.autoOcrStatus === "failed") && !restoredFromDuplicate) return false;
      if (current.autoOcrStatus === "processing" && Date.now() - Number(current.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) return false;
      tx.update(rowRef, {
        autoOcrStatus: "processing",
        autoOcrStartedAtMs: Date.now(),
        autoOcrDeviceId: deviceId,
        autoOcrUserId: user.uid,
        autoOcrProvider: scanEngine,
        autoOcrError: "",
        restoredFromDuplicateAtMs: 0,
        duplicateOfVoucherId: "",
        duplicateOfVoucherNumber: "",
        duplicateReason: "",
        duplicateReasons: [],
        duplicateOcrNarration: "",
        duplicateMatchedNarration: "",
        duplicateMatchedRef: "",
        duplicateMatchedAmount: 0,
        duplicateMatchedDateText: "",
        duplicateIncomingRef: "",
      });
      return true;
    });
    if (!claimed) return false;
    rateLimitAttemptRef.current = 0;
    rateLimitUntilRef.current = 0;
    activeJobRef.current = { ...row, autoOcrProvider: scanEngine };
    lastScanErrorRef.current = null;
    handledMissingJobIdRef.current = "";
    handledDuplicateJobIdRef.current = "";
    savedJobRef.current = false;
    setProcessDialogVisible(settingsRefValue.current.processingMode === "semi");
    setActiveProcess({ id: row.id, name: row.name || "Document" });

    let scannedRaw: OcrRawResult | null = null;
    try {
      const url = String(row.url || "").trim();
      if (!url) throw new Error("Document has no attachment URL.");
      const enginePref = scanEngine === "gemini" ? "ai" as const : "online" as const;
      const cloudProvider = scanEngine === "google" ? "google" as const : scanEngine === "azure" ? "azure" as const : undefined;
      if (settingsRefValue.current.processingMode === "semi") {
        // Open the regular voucher first. The explicit OCR handoff starts one scan with the
        // selected engine; normal manually attached vouchers remain manual-scan only.
        savedJobRef.current = false;
        setVoucherData({
          defaultTab: "sale",
        unassignedFile: { id: row.id, url, path: row.path || "", name: row.name || "" },
          fileUrls: [url],
        });
        queueOcrHandoff("sale", [url], { autoPost: true, allowSaveWithoutItems: settingsRefValue.current.missingFieldRules.item === "save-without", enginePref, cloudProvider });
        setVoucherOpen(true);
        toast.info("Semi automatic scan started", { description: "The file is attached to its voucher. It will save automatically only when all required checks pass; otherwise this dialog stays open for review." });
        return true;
      }
      const blob = url.startsWith("pbatt:")
        ? await fetchPbAttachmentBlob(url)
        : await fetchAttachmentRefBlob(url, { companyId: fsId });
      if (!blob?.size) throw new Error("Could not download the document to this PC.");
      if (!navigator.onLine) throw new Error("This PC went offline before the scan could finish.");

      const partyRows = masters.processedParties as any[];
      const itemRows = masters.processedItems as any[];
      if (!partyRows?.length) throw new Error("No active parties are available for this company.");
      if (!itemRows?.length && settingsRefValue.current.missingFieldRules.item !== "save-without") throw new Error("No active item masters are available for this company.");

      const raw = await runOcrOnFile(blob, blob.type || mimeFor(row), {
        companyId: fsId,
        enginePref,
        cloudProvider,
        ownCompany: { name: (company as any)?.name || "", pan: (company as any)?.pan || (company as any)?.panNumber || "" },
      });
      scannedRaw = raw;
      if (!navigator.onLine) throw new Error("This PC went offline before Auto post could save.");
      const allowSaveWithoutItems = settingsRefValue.current.missingFieldRules.item === "save-without";
      const target = safeInvoiceTarget(raw, partyRows, itemRows, (company as any)?.name, (company as any)?.pan || (company as any)?.panNumber, allowSaveWithoutItems);
      if ("error" in target) {
        throw new Error(target.error);
      }

      savedJobRef.current = false;
      setVoucherData({
        defaultTab: target.type,
        date: target.bill.date?.value ?? new Date(),
        unassignedFile: { id: row.id, url, path: row.path || "", name: row.name || "" },
        fileUrls: [url],
      });
      queueOcrHandoff(target.type, [url], { raw, autoPost: true, allowSaveWithoutItems });
      setVoucherOpen(true);
      // The normal voucher form applies its own field, duplicate, permission, and totals guards,
      // then saves through the regular voucher action path as UNAPPROVED.
      toast.info("Local Auto post is reading this invoice", { description: "OCR is running on this admin PC. The voucher will save only if the form’s safeguards pass." });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRequiredDataIssue = /customer or supplier could not be matched|invoice date needs manual review|invoice total could not be verified|(?:invoice )?items do not match|line items did not pass|tds needs a manual|no active parties|no active item masters|could not confidently identify this as a sale or purchase/i.test(message);
      const isItemAmountMismatch = /line items did not pass the totals check/i.test(message);
      const ruleKey = missingRuleKey(message);
      const missingAction = isItemAmountMismatch
        ? settingsRefValue.current.amountMismatchAction
        : settingsRefValue.current.missingFieldRules?.[ruleKey] ?? settingsRefValue.current.missingFieldAction;
      if (missingAction === "fail-and-continue" && isRequiredDataIssue) {
        await failJob(row, message, scanEngine);
        clearManualRetryId(row.id);
        activeJobRef.current = null;
        setActiveProcess(null);
        toast.message("Auto post skipped this file", { description: `${message} The runner will continue with the next file.` });
        return false;
      }
      if (missingAction === "pause-and-hold" && isRequiredDataIssue && row.url) {
        const url = String(row.url).trim();
        runnerHeldRef.current = true;
        runnerStartedRef.current = false;
        setRunnerHeld(true);
        setProcessDialogVisible(true);
        setVoucherData({ defaultTab: "sale", unassignedFile: { id: row.id, url, path: row.path || "", name: row.name || "" }, fileUrls: [url] });
        if (scannedRaw) queueOcrHandoff("sale", [url], { raw: scannedRaw, autoPost: false });
        setVoucherOpen(true);
        toast.message("Auto post paused for review", { description: message });
        return true;
      }
      if (settingsRefValue.current.processingMode === "full") {
        await failJob(row, message, scanEngine);
        clearManualRetryId(row.id);
        activeJobRef.current = null;
        setActiveProcess(null);
        toast.message("Full Auto post skipped this file", { description: `${message} The runner will continue with the next file.` });
        return false;
      }
      if (row.url) {
        toast.message("Auto post paused for review", { description: message });
        setProcessDialogVisible(true);
        const url = String(row.url).trim();
        setVoucherData({ defaultTab: "sale", unassignedFile: { id: row.id, url, path: row.path || "", name: row.name || "" }, fileUrls: [url] });
        setVoucherOpen(true);
        return true;
      }
      await failJob(row, message, scanEngine);
      clearManualRetryId(row.id);
      activeJobRef.current = null;
      setActiveProcess(null);
      toast.message("Local Auto post needs review", { description: message });
      return false;
    }
  }, [clearManualRetryId, company, deviceId, failJob, fsId, masters.processedItems, masters.processedParties, user?.uid]);

  const processPending = useCallback(async () => {
    if (!canRun || runnerHoldLoadedFor !== runnerHoldStorageKey || !navigator.onLine || busyRef.current || runnerHeldRef.current || Date.now() < rateLimitUntilRef.current) return;
    if (settings.runOnUpload || runnerStartedRef.current) drainQueueRef.current = true;
    if (!drainQueueRef.current || masters.loading) return;
    const storedColumns = typeof window !== "undefined" ? Number(localStorage.getItem("galleryPreviewColumns") || 2) : 2;
    const queueSequence = normalizeGalleryQueueSequence(settings.queueSequence || DEFAULT_GALLERY_QUEUE_SEQUENCE);
    const sortOrder = normalizeGallerySortOrder(settings.gallerySortOrder || DEFAULT_GALLERY_SORT_ORDER);
    const orderedQueueRows = orderGalleryQueue(rowsRef.current, queueSequence, storedColumns, sortOrder);
    const publishedQueue = galleryQueueOrderRef.current;
    if (publishedQueue.companyId === fsId && publishedQueue.fileIds.length) {
      const rank = new Map(publishedQueue.fileIds.map((id, index) => [id, index]));
      const fallbackRank = new Map(orderedQueueRows.map((row, index) => [row.id, index]));
      orderedQueueRows.sort((a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        (fallbackRank.get(a.id) ?? 0) - (fallbackRank.get(b.id) ?? 0)
      );
    }
    const next = orderedQueueRows.find((row) =>
      (() => {
        const blockedVersion = claimBlockedVersionsRef.current.get(row.id);
        const currentVersion = queueClaimVersion(row);
        if (blockedVersion && blockedVersion !== currentVersion) claimBlockedVersionsRef.current.delete(row.id);
        return row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" && row.isDeleted !== true && row.deleted !== true &&
          ((row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed") || Number(row.restoredFromDuplicateAtMs || 0) > 0) &&
          (manualRetryIdsRef.current.size === 0 || manualRetryIdsRef.current.has(row.id)) &&
          !(row.autoOcrStatus === "processing" && Date.now() - Number(row.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) &&
          blockedVersion !== currentVersion;
      })()
    );
    if (!next) {
      const lockedRow = rowsRef.current.find((row) => row.autoOcrStatus === "processing" && Date.now() - Number(row.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS);
      if (lockedRow) {
        if (staleRetryTimerRef.current != null) window.clearTimeout(staleRetryTimerRef.current);
        const retryIn = Math.max(1_000, CLAIM_STALE_MS - (Date.now() - Number(lockedRow.autoOcrStartedAtMs || 0)) + 250);
        staleRetryTimerRef.current = window.setTimeout(() => {
          staleRetryTimerRef.current = null;
          drainQueueRef.current = true;
          void processPendingRef.current();
        }, retryIn);
        return;
      }
      if (manualRetryIdsRef.current.size > 0) {
        if (staleRetryTimerRef.current != null) window.clearTimeout(staleRetryTimerRef.current);
        staleRetryTimerRef.current = window.setTimeout(() => {
          staleRetryTimerRef.current = null;
          drainQueueRef.current = true;
          void processPendingRef.current();
        }, 500);
        return;
      }
      drainQueueRef.current = false;
      return;
    }
    if (staleRetryTimerRef.current != null) {
      window.clearTimeout(staleRetryTimerRef.current);
      staleRetryTimerRef.current = null;
    }
    busyRef.current = true;
    let openedForm = false;
    try {
      openedForm = await processOne(next);
    } catch (error) {
      busyRef.current = false;
      if (isServerRateLimitError(error)) {
        deferForServerRateLimit(error);
        return;
      }
      console.error("[GalleryLocalAutoPost] could not claim the next document", error);
      toast.error("Auto post could not start this document", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      return;
    }
    if (!openedForm) {
      // A stale gallery snapshot can keep presenting a document the server just rejected
      // (for example, it was claimed/deleted on another tab). Don't hammer the same claim;
      // reconsider it only after its server-visible state changes.
      claimBlockedVersionsRef.current.set(next.id, queueClaimVersion(next));
      busyRef.current = false;
      window.setTimeout(() => void processPendingRef.current(), 500);
    }
  }, [canRun, deferForServerRateLimit, masters.loading, processOne, runnerHoldLoadedFor, runnerHoldStorageKey, settings.gallerySortOrder, settings.queueSequence, settings.runOnUpload]);
  processPendingRef.current = processPending;

  useEffect(() => {
    if (!fsId) return;
    const onQueueOrder = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileIds?: string[] }>).detail;
      if (String(detail?.companyId || "") !== fsId || !Array.isArray(detail?.fileIds)) return;
      galleryQueueOrderRef.current = {
        companyId: fsId,
        fileIds: detail.fileIds.map((id) => String(id || "").trim()).filter(Boolean),
      };
    };
    window.addEventListener("pl:gallery:auto-post-queue-order", onQueueOrder);
    return () => window.removeEventListener("pl:gallery:auto-post-queue-order", onQueueOrder);
  }, [fsId]);

  useEffect(() => {
    const onRetryRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileIds?: string[] }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      const ids = Array.isArray(detail?.fileIds) ? detail.fileIds.map((id) => String(id || "")).filter(Boolean) : [];
      if (!ids.length) return;
      if (!canRun) {
        toast.message("Retry is not running on this device", { description: "Open Gallery on the selected Local PC admin device and try again." });
        return;
      }
      ids.forEach((id) => manualRetryIdsRef.current.add(id));
      const requeuePatch = {
        status: "FREE",
        isDeleted: false,
        deleted: false,
        autoOcrStatus: "queued",
        autoOcrError: "",
        autoOcrProvider: "",
        autoOcrFinishedAt: null,
        autoOcrStartedAtMs: 0,
        autoOcrDeviceId: "",
        autoOcrUserId: "",
        autoOcrVoucherId: "",
        restoredFromDuplicateAtMs: 0,
        duplicateOfVoucherId: "",
        duplicateOfVoucherNumber: "",
        duplicateReason: "",
        duplicateReasons: [],
        duplicateOcrNarration: "",
        duplicateMatchedNarration: "",
        duplicateMatchedRef: "",
        duplicateMatchedAmount: 0,
        duplicateMatchedDateText: "",
        duplicateIncomingRef: "",
        movedAtMs: 0,
      };
      rowsRef.current = rowsRef.current.map((row) => ids.includes(row.id) ? { ...row, ...requeuePatch } : row);
      setRows(rowsRef.current);
      drainQueueRef.current = true;
      void Promise.all(ids.map((id) => writeStatus({ id }, requeuePatch)))
        .then(() => processPendingRef.current())
        .catch((error) => {
          ids.forEach(clearManualRetryId);
          toast.error("Could not requeue document", { description: error instanceof Error ? error.message : String(error) });
        });
    };
    window.addEventListener("pl:gallery:auto-post-retry", onRetryRequested);
    return () => window.removeEventListener("pl:gallery:auto-post-retry", onRetryRequested);
  }, [canRun, clearManualRetryId, fsId, writeStatus]);

  useEffect(() => {
    const publishState = () => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-process-state", {
      detail: { companyId: fsId, active: Boolean(activeProcess), fileName: activeProcess?.name || "", visible: processDialogVisible, held: runnerHeld || !settings.enabled, enabled: settings.enabled, controlAvailable: canControlRunner },
    }));
    publishState();
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; visible?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId || typeof detail?.visible !== "boolean") return;
      setProcessDialogVisible(detail.visible);
    };
    const onStateRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || String(detail.companyId) === fsId) publishState();
    };
    const onOcrFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; message?: string }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job || !String(detail?.message || "").trim()) return;
      lastScanErrorRef.current = { jobId: job.id, message: String(detail.message).trim().slice(0, 500) };
    };
    const onOcrSuccess = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job) return;
      if (lastScanErrorRef.current?.jobId === job.id) lastScanErrorRef.current = null;
    };
    const onHold = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; held?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId || typeof detail?.held !== "boolean") return;
      if (!settings.enabled && detail.held === false) return;
      runnerHeldRef.current = detail.held;
      runnerStartedRef.current = !detail.held;
      try { window.localStorage.setItem(runnerHoldStorageKey, detail.held ? "held" : "running"); } catch { /* persistence is best-effort */ }
      setRunnerHeld(detail.held);
      if (!detail.held) {
        drainQueueRef.current = true;
        window.setTimeout(() => void processPendingRef.current(), 0);
      }
    };
    const onRequiredFieldsMissing = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; missing?: string[]; voucherType?: string; itemRowCountMismatch?: boolean; itemAmountMismatch?: boolean }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job || handledMissingJobIdRef.current === job.id) return;
      handledMissingJobIdRef.current = job.id;
      const missing = Array.isArray(detail.missing) ? detail.missing.map((field) => String(field || "").trim()).filter(Boolean) : [];
      const message = `Required information is missing: ${missing.join(", ") || "review the highlighted fields"}.`;
      const actions: Array<"pause-and-hold" | "fail-and-continue" | "save-without"> = [];
      if (detail.itemRowCountMismatch) actions.push(settingsRefValue.current.itemRowMismatchAction);
      if (detail.itemAmountMismatch) actions.push(settingsRefValue.current.amountMismatchAction);
      const genericMissing = missing.filter((field) => !/item row count mismatch|item row amount does not match|line items(?: \(did not reconcile\))?$/i.test(field));
      actions.push(...genericMissing.map((field) => settingsRefValue.current.missingFieldRules?.[missingRuleKey(field, detail.voucherType)]).filter(Boolean) as Array<"pause-and-hold" | "fail-and-continue" | "save-without">);
      const shouldPause = actions.includes("pause-and-hold") || (!actions.length && settingsRefValue.current.missingFieldAction === "pause-and-hold");
      const shouldFail = actions.includes("fail-and-continue") || (!actions.length && settingsRefValue.current.missingFieldAction === "fail-and-continue");
      if (shouldFail && !shouldPause) {
        void (async () => {
          await failJob(job, message, job.autoOcrProvider);
          clearManualRetryId(job.id);
          activeJobRef.current = null;
          savedJobRef.current = true;
          setActiveProcess(null);
          setVoucherOpen(false);
          setVoucherData(null);
          busyRef.current = false;
          toast.message("Auto post moved to failed", { description: `${message} The runner will continue with the next file.` });
          if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
        })();
        return;
      }
      runnerHeldRef.current = true;
      runnerStartedRef.current = false;
      try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
      setRunnerHeld(true);
      setProcessDialogVisible(true);
      toast.message("Auto post paused for review", { description: `${message} The voucher is still open; use Start runner after handling it.` });
    };
    const onDuplicateDetected = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId?: string; voucherNumber?: string; summary?: string; dateText?: string; amount?: string; reasons?: string[] }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.matchId || "") === "" || !job || handledDuplicateJobIdRef.current === job.id || !settingsRefValue.current.checkDuplicateVouchers) return;
      handledDuplicateJobIdRef.current = job.id;
      if (job.autoPostIgnoreDuplicateOnce) {
        void writeStatus(job, { autoPostIgnoreDuplicateOnce: false }).catch(() => {});
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-action-completed", { detail: { matchId: detail.matchId } }));
        toast.message("Duplicate override applied", { description: "You chose Post anyway for this document, so the runner is continuing." });
        return;
      }
      if (settingsRefValue.current.duplicateVoucherAction === "save-anyway") {
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-action-completed", { detail: { matchId: detail.matchId } }));
        toast.message("Possible duplicate: continuing", { description: "The selected rule allows this voucher to save; the runner will continue afterward." });
        return;
      }
      if (settingsRefValue.current.duplicateVoucherAction === "pause-for-review") {
        runnerHeldRef.current = true;
        runnerStartedRef.current = false;
        try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
        setRunnerHeld(true);
        setProcessDialogVisible(true);
        toast.message("Possible duplicate: runner paused", { description: "Review this voucher, then use Start runner to continue." });
        return;
      }
      void (async () => {
        try {
          const reason = `Possible duplicate of voucher ${String(detail.voucherNumber || "").trim() || String(detail.matchId || "unknown")}: ${String(detail.summary || "matching transaction found")}`;
          const destination = doc(firestore, `companies/${fsId}/duplicate_documents`, job.id);
          const source = doc(firestore, `companies/${fsId}/unassigned_documents`, job.id);
          await setDoc(destination, {
            ...job,
            id: job.id,
            status: "DUPLICATE",
            autoOcrStatus: "duplicate",
            duplicateOfVoucherId: String(detail.matchId || ""),
            duplicateOfVoucherNumber: String(detail.voucherNumber || ""),
            duplicateReason: reason,
            duplicateReasons: Array.isArray(detail.reasons) ? detail.reasons : [],
            movedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          await deleteDoc(source);
          clearManualRetryId(job.id);
          activeJobRef.current = null;
          setActiveProcess(null);
          busyRef.current = false;
          setVoucherOpen(false);
          setVoucherData(null);
          toast.success("Moved to Duplicate Documents", { description: "The auto runner is continuing with the next file." });
          if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
        } catch (error) {
          handledDuplicateJobIdRef.current = "";
          toast.error("Could not move the duplicate document", { description: error instanceof Error ? error.message : String(error) });
        }
      })();
    };
    window.addEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
    window.addEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
    window.addEventListener("pl:gallery:auto-post-scan-failed", onOcrFailure);
    window.addEventListener("pl:gallery:auto-post-scan-succeeded", onOcrSuccess);
    window.addEventListener("pl:gallery:auto-post-runner-hold", onHold);
    window.addEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
    window.addEventListener("pl:gallery:auto-post-duplicate-detected", onDuplicateDetected);
    return () => {
      window.removeEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
      window.removeEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
      window.removeEventListener("pl:gallery:auto-post-scan-failed", onOcrFailure);
      window.removeEventListener("pl:gallery:auto-post-scan-succeeded", onOcrSuccess);
      window.removeEventListener("pl:gallery:auto-post-runner-hold", onHold);
      window.removeEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
      window.removeEventListener("pl:gallery:auto-post-duplicate-detected", onDuplicateDetected);
    };
  }, [activeProcess, canControlRunner, clearManualRetryId, failJob, fsId, processDialogVisible, runnerHeld, runnerHoldStorageKey, settings.enabled]);

  useEffect(() => {
    if (!canRun || masters.loading || !drainQueueRef.current) return;
    void processPending();
  }, [canRun, masters.loading, processPending]);

  useEffect(() => {
    if (!canRun || !fsId) {
      setRows([]);
      return;
    }
    const q = query(collection(firestore, `companies/${fsId}/unassigned_documents`), orderBy("uploadedAt", "asc"));
    return onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UnassignedRow, "id">) }));
      rowsRef.current = next;
      setRows(next);
    }, (error) => console.warn("[GalleryLocalAutoPost] could not watch Unassigned Documents", error));
  }, [canRun, fsId]);

  useEffect(() => {
    if (!canRun || (!settings.runOnUpload && !runnerStartedRef.current)) return;
    drainQueueRef.current = true;
    void processPending();
  }, [canRun, processPending, rows, settings.runOnUpload, runnerHeld]);

  useEffect(() => {
    if (!canRun || !settings.runOnSchedule) return;
    if (settings.scheduleMode === "interval") {
      const timer = window.setInterval(() => {
        drainQueueRef.current = true;
        void processPendingRef.current();
      }, Math.max(1, settings.scheduleMinutes) * 60_000);
      return () => window.clearInterval(timer);
    }
    const key = `${fsId}:${settings.scheduleDate}:${settings.scheduleTime}`;
    const marker = `${LOCAL_SCHEDULE_KEY}:${key}`;
    const check = () => {
      if (!navigator.onLine || !settings.scheduleDate || !settings.scheduleTime) return;
      const scheduledAt = new Date(`${settings.scheduleDate}T${settings.scheduleTime}:00`).getTime();
      if (!Number.isFinite(scheduledAt) || Date.now() < scheduledAt || localStorage.getItem(marker) === "done") return;
      localStorage.setItem(marker, "done");
      drainQueueRef.current = true;
      void processPendingRef.current();
    };
    check();
    const timer = window.setInterval(check, 15_000);
    return () => window.clearInterval(timer);
  }, [canRun, fsId, processPending, settings.runOnSchedule, settings.scheduleDate, settings.scheduleMode, settings.scheduleMinutes, settings.scheduleTime]);

  useEffect(() => {
    const onOnline = () => {
      if (settingsRefValue.current.runOnUpload) drainQueueRef.current = true;
      void processPendingRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const closeJob = useCallback(async (status: "saved" | "cancelled", voucherId?: string) => {
    const job = activeJobRef.current;
    if (!job) return;
    const scanError = lastScanErrorRef.current?.jobId === job.id ? lastScanErrorRef.current.message : "";
    if (status === "saved") {
      savedJobRef.current = true;
      try {
        await writeStatus(job, {
          autoOcrStatus: "complete",
          autoOcrError: "",
          autoOcrVoucherId: voucherId || "",
          autoOcrFinishedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn("[GalleryLocalAutoPost] voucher saved but gallery status update failed", error);
      }
    } else if (!savedJobRef.current) {
      const message = scanError
        ? `${scanError.slice(0, 440)}\nVoucher closed before save.`
        : "Auto post was closed before a voucher was saved.";
      await failJob(job, message, job.autoOcrProvider);
    }
    lastScanErrorRef.current = null;
    clearManualRetryId(job.id);
    activeJobRef.current = null;
    setActiveProcess(null);
    busyRef.current = false;
    setVoucherOpen(false);
    setVoucherData(null);
    if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
  }, [clearManualRetryId, failJob, writeStatus]);

  return (
    <AddVoucherDialog
      isOpen={voucherOpen}
      onOpenChange={(next) => {
        setVoucherOpen(next);
        if (!next && activeJobRef.current) void closeJob("cancelled");
      }}
      voucher={undefined}
      defaultVoucherData={voucherData}
      hideAutoProcessDialog={voucherOpen && !processDialogVisible}
      autoProcessVisibilityToggle={activeProcess ? (
        <button type="button" className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md" onClick={() => setProcessDialogVisible(false)}>
          Hide process
        </button>
      ) : null}
      suppressDashboardRedirectGuard
      onVoucherAction={(status: "saved" | "cancelled", _saveAndNew?: boolean, newId?: string) => void closeJob(status, newId)}
    />
  );
}
