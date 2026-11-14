"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from "@/lib/pbCompat/firestore";
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
};

const SETTINGS_DOC_ID = "server_auto_ocr";
const CLAIM_STALE_MS = 5 * 60_000;
const LOCAL_SCHEDULE_KEY = "pl.gallery.auto-ocr.local.schedule.v1";

function mimeFor(row: UnassignedRow): string {
  const name = String(row.name || row.url || "").toLowerCase();
  if (String(row.type || "").toLowerCase() === "pdf" || name.split(/[?#]/)[0].endsWith(".pdf")) return "application/pdf";
  if (name.split(/[?#]/)[0].endsWith(".png")) return "image/png";
  if (name.split(/[?#]/)[0].endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function billFor(raw: OcrRawResult, kind: "sale" | "purchase", parties: readonly unknown[], items: readonly unknown[], ownName?: string | null, ownPan?: string | null): OcrParsedBill {
  return parseBill(raw, { kind, parties: parties as never, items: items as never, ownName, ownPan });
}

function safeInvoiceTarget(raw: OcrRawResult, parties: readonly any[], items: readonly any[], ownName?: string | null, ownPan?: string | null): { type: "sale" | "purchase"; bill: OcrParsedBill } | { error: string } {
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
  if (bill.lineItems.value.some((line) => !line.itemId || !items.some((item) => String(item?.id || "") === line.itemId && item?.isDeleted !== true))) {
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
  const settingsRef = useMemo(() => fsId ? doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID) : null, [fsId]);
  const canRun = settingsReady && settings.enabled && settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId &&
    !!fsId && !settingsDialogOpen;
  const canControlRunner = settings.enabled && settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId && !!fsId;
  const [rows, setRows] = useState<UnassignedRow[]>([]);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherData, setVoucherData] = useState<Record<string, unknown> | null>(null);
  const [processDialogVisible, setProcessDialogVisible] = useState(true);
  const [runnerHeld, setRunnerHeld] = useState(false);
  const [activeProcess, setActiveProcess] = useState<{ id: string; name: string } | null>(null);
  const activeJobRef = useRef<UnassignedRow | null>(null);
  const busyRef = useRef(false);
  const runnerHeldRef = useRef(false);
  const runnerStartedRef = useRef(false);
  const drainQueueRef = useRef(false);
  const staleRetryTimerRef = useRef<number | null>(null);
  const manualRetryIdsRef = useRef<Set<string>>(new Set());
  const processPendingRef = useRef<() => Promise<void>>(async () => {});
  const savedJobRef = useRef(false);
  const handledMissingJobIdRef = useRef("");
  const rowsRef = useRef<UnassignedRow[]>([]);
  const settingsRefValue = useRef(settings);
  settingsRefValue.current = settings;
  rowsRef.current = rows;
  runnerHeldRef.current = runnerHeld;
  const clearManualRetryId = useCallback((id: string) => {
    manualRetryIdsRef.current.delete(id);
    if (manualRetryIdsRef.current.size === 0 && !settingsRefValue.current.runOnUpload) drainQueueRef.current = false;
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
      if (current.autoOcrStatus === "complete" || current.autoOcrStatus === "failed") return false;
      if (current.autoOcrStatus === "processing" && Date.now() - Number(current.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) return false;
      tx.update(rowRef, {
        autoOcrStatus: "processing",
        autoOcrStartedAtMs: Date.now(),
        autoOcrDeviceId: deviceId,
        autoOcrUserId: user.uid,
        autoOcrProvider: scanEngine,
        autoOcrError: "",
      });
      return true;
    });
    if (!claimed) return false;
    activeJobRef.current = { ...row, autoOcrProvider: scanEngine };
    handledMissingJobIdRef.current = "";
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
        queueOcrHandoff("sale", [url], { autoPost: true, enginePref, cloudProvider });
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
      if (!itemRows?.length) throw new Error("No active item masters are available for this company.");

      const raw = await runOcrOnFile(blob, blob.type || mimeFor(row), {
        companyId: fsId,
        enginePref,
        cloudProvider,
        ownCompany: { name: (company as any)?.name || "", pan: (company as any)?.pan || (company as any)?.panNumber || "" },
      });
      scannedRaw = raw;
      if (!navigator.onLine) throw new Error("This PC went offline before Auto post could save.");
      const target = safeInvoiceTarget(raw, partyRows, itemRows, (company as any)?.name, (company as any)?.pan || (company as any)?.panNumber);
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
      queueOcrHandoff(target.type, [url], { raw, autoPost: true });
      setVoucherOpen(true);
      // The normal voucher form applies its own field, duplicate, permission, and totals guards,
      // then saves through the regular voucher action path as UNAPPROVED.
      toast.info("Local Auto post is reading this invoice", { description: "OCR is running on this admin PC. The voucher will save only if the form’s safeguards pass." });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRequiredDataIssue = /customer or supplier could not be matched|invoice date needs manual review|invoice total could not be verified|(?:invoice )?items do not match|line items did not pass|tds needs a manual|no active parties|no active item masters|could not confidently identify this as a sale or purchase/i.test(message);
      if (settingsRefValue.current.missingFieldAction === "pause-and-hold" && isRequiredDataIssue && row.url) {
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
    if (!canRun || !navigator.onLine || busyRef.current || runnerHeldRef.current) return;
    if (settings.runOnUpload || runnerStartedRef.current) drainQueueRef.current = true;
    if (!drainQueueRef.current || masters.loading) return;
    const next = rowsRef.current.find((row) =>
      row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" && row.isDeleted !== true && row.deleted !== true &&
      row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed" &&
      (manualRetryIdsRef.current.size === 0 || manualRetryIdsRef.current.has(row.id)) &&
      !(row.autoOcrStatus === "processing" && Date.now() - Number(row.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS)
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
    const openedForm = await processOne(next);
    if (!openedForm) {
      busyRef.current = false;
      window.setTimeout(() => void processPendingRef.current(), 0);
    }
  }, [canRun, masters.loading, processOne, settings.runOnUpload]);
  processPendingRef.current = processPending;

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
      drainQueueRef.current = true;
      void processPendingRef.current();
    };
    window.addEventListener("pl:gallery:auto-post-retry", onRetryRequested);
    return () => window.removeEventListener("pl:gallery:auto-post-retry", onRetryRequested);
  }, [canRun, fsId]);

  useEffect(() => {
    const publishState = () => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-process-state", {
      detail: { companyId: fsId, active: Boolean(activeProcess), fileName: activeProcess?.name || "", visible: processDialogVisible, held: runnerHeld, controlAvailable: canControlRunner },
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
    const onHold = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; held?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId || typeof detail?.held !== "boolean") return;
      runnerHeldRef.current = detail.held;
      runnerStartedRef.current = !detail.held;
      setRunnerHeld(detail.held);
      if (!detail.held) {
        drainQueueRef.current = true;
        window.setTimeout(() => void processPendingRef.current(), 0);
      }
    };
    const onRequiredFieldsMissing = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; missing?: string[] }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job || handledMissingJobIdRef.current === job.id) return;
      handledMissingJobIdRef.current = job.id;
      const missing = Array.isArray(detail.missing) ? detail.missing.map((field) => String(field || "").trim()).filter(Boolean) : [];
      const message = `Required information is missing: ${missing.join(", ") || "review the highlighted fields"}.`;
      if (settingsRefValue.current.missingFieldAction === "fail-and-continue") {
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
      setRunnerHeld(true);
      setProcessDialogVisible(true);
      toast.message("Auto post paused for review", { description: `${message} The voucher is still open; use Start runner after handling it.` });
    };
    window.addEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
    window.addEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
    window.addEventListener("pl:gallery:auto-post-runner-hold", onHold);
    window.addEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
    return () => {
      window.removeEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
      window.removeEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
      window.removeEventListener("pl:gallery:auto-post-runner-hold", onHold);
      window.removeEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
    };
  }, [activeProcess, canControlRunner, clearManualRetryId, failJob, fsId, processDialogVisible, runnerHeld]);

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
      await failJob(job, "Auto post was closed before a voucher was saved.", job.autoOcrProvider);
    }
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
