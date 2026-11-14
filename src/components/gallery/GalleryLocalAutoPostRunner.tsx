"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { getOrCreateClientDeviceId } from "@/lib/security/deviceIdentity";
import { fetchAttachmentRefBlob } from "@/lib/attachmentRefBlobFetch";
import { fetchPbAttachmentBlob } from "@/lib/pocketbaseData/pbAttachments";
import { parseBill } from "@/modules/ocr/parser";
import { runTesseractOnFile } from "@/modules/ocr/engine";
import { queueOcrHandoff } from "@/modules/ocr/handoff";
import { isOcrSelectableParty } from "@/modules/ocr/types";
import type { OcrParsedBill, OcrRawResult } from "@/modules/ocr/types";

type LocalAutoPostSettings = {
  enabled: boolean;
  runLocation: "local-pc" | "server";
  runOnUpload: boolean;
  runOnSchedule: boolean;
  scheduleMode: "interval" | "date-time";
  scheduleMinutes: number;
  scheduleDate: string;
  scheduleTime: string;
  localRunnerUid: string;
  localRunnerDeviceId: string;
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
  const deviceId = useMemo(() => getOrCreateClientDeviceId(), []);
  const fsId = String((company as any)?.authoritativeCompanyId || companyId || "").trim();
  const settingsRef = useMemo(() => fsId ? doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID) : null, [fsId]);
  const canRun = settingsReady && settings.enabled && settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId &&
    !!fsId && !settingsDialogOpen;
  const [rows, setRows] = useState<UnassignedRow[]>([]);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherData, setVoucherData] = useState<Record<string, unknown> | null>(null);
  const activeJobRef = useRef<UnassignedRow | null>(null);
  const busyRef = useRef(false);
  const drainQueueRef = useRef(false);
  const processPendingRef = useRef<() => Promise<void>>(async () => {});
  const savedJobRef = useRef(false);
  const rowsRef = useRef<UnassignedRow[]>([]);
  const settingsRefValue = useRef(settings);
  settingsRefValue.current = settings;
  rowsRef.current = rows;

  const writeStatus = useCallback(async (row: UnassignedRow, patch: Record<string, unknown>) => {
    if (!fsId) return;
    await setDoc(doc(firestore, `companies/${fsId}/unassigned_documents`, row.id), {
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [fsId]);

  const failJob = useCallback(async (row: UnassignedRow, message: string) => {
    try {
      await writeStatus(row, {
        autoOcrStatus: "failed",
        autoOcrError: message.slice(0, 500),
        autoOcrProvider: "local-tesseract",
        autoOcrFinishedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[GalleryLocalAutoPost] failed to record scan error", error);
    }
  }, [writeStatus]);

  const processOne = useCallback(async (row: UnassignedRow) => {
    if (!fsId || !user?.uid || !navigator.onLine) return false;
    const rowRef = doc(firestore, `companies/${fsId}/unassigned_documents`, row.id);
    const claimed = await runTransaction(firestore, async (tx) => {
      const snapshot = await tx.get(rowRef);
      if (!snapshot.exists()) return false;
      const current = snapshot.data() as Record<string, unknown>;
      if (current.isDeleted === true || current.deleted === true || current.status === "ASSIGNED" || current.status === "LOCKED") return false;
      if (current.autoOcrStatus === "complete" || current.autoOcrStatus === "failed") return false;
      if (current.autoOcrStatus === "processing" && current.autoOcrDeviceId !== deviceId && Date.now() - Number(current.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) return false;
      tx.update(rowRef, {
        autoOcrStatus: "processing",
        autoOcrStartedAtMs: Date.now(),
        autoOcrDeviceId: deviceId,
        autoOcrUserId: user.uid,
        autoOcrProvider: "local-tesseract",
        autoOcrError: "",
      });
      return true;
    });
    if (!claimed) return false;

    try {
      const url = String(row.url || "").trim();
      if (!url) throw new Error("Document has no attachment URL.");
      const blob = url.startsWith("pbatt:")
        ? await fetchPbAttachmentBlob(url)
        : await fetchAttachmentRefBlob(url, { companyId: fsId });
      if (!blob?.size) throw new Error("Could not download the document to this PC.");
      if (!navigator.onLine) throw new Error("This PC went offline before the scan could finish.");

      const raw = await runTesseractOnFile(blob, blob.type || mimeFor(row));
      if (!navigator.onLine) throw new Error("This PC went offline before Auto post could save.");
      const partyRows = masters.processedParties as any[];
      const itemRows = masters.processedItems as any[];
      if (!partyRows?.length || !itemRows?.length) throw new Error("Company parties or items are still loading.");
      const target = safeInvoiceTarget(raw, partyRows, itemRows, (company as any)?.name, (company as any)?.pan || (company as any)?.panNumber);
      if ("error" in target) throw new Error(target.error);

      activeJobRef.current = row;
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
      await failJob(row, message);
      toast.message("Local Auto post needs review", { description: message });
      return false;
    }
  }, [company, deviceId, failJob, fsId, masters.processedItems, masters.processedParties, user?.uid]);

  const processPending = useCallback(async () => {
    if (!canRun || !navigator.onLine || busyRef.current) return;
    if (settings.runOnUpload) drainQueueRef.current = true;
    if (!drainQueueRef.current) return;
    const next = rowsRef.current.find((row) =>
      row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" && row.isDeleted !== true && row.deleted !== true &&
      row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed" &&
      !(row.autoOcrStatus === "processing" && row.autoOcrDeviceId !== deviceId && Date.now() - Number(row.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS)
    );
    if (!next) {
      drainQueueRef.current = false;
      return;
    }
    busyRef.current = true;
    const openedForm = await processOne(next);
    if (!openedForm) {
      busyRef.current = false;
      window.setTimeout(() => void processPendingRef.current(), 0);
    }
  }, [canRun, processOne, settings.runOnUpload]);
  processPendingRef.current = processPending;

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
    if (!canRun || !settings.runOnUpload) return;
    drainQueueRef.current = true;
    void processPending();
  }, [canRun, processPending, rows, settings.runOnUpload]);

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
      await failJob(job, "Auto post was closed before a voucher was saved.");
    }
    activeJobRef.current = null;
    busyRef.current = false;
    setVoucherOpen(false);
    setVoucherData(null);
    window.setTimeout(() => void processPendingRef.current(), 0);
  }, [failJob, writeStatus]);

  return (
    <AddVoucherDialog
      isOpen={voucherOpen}
      onOpenChange={(next) => {
        setVoucherOpen(next);
        if (!next && activeJobRef.current) void closeJob("cancelled");
      }}
      voucher={undefined}
      defaultVoucherData={voucherData}
      suppressDashboardRedirectGuard
      onVoucherAction={(status: "saved" | "cancelled", _saveAndNew?: boolean, newId?: string) => void closeJob(status, newId)}
    />
  );
}
