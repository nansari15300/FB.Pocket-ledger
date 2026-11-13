"use client";
/**
 * useVoucherOcr — wires local OCR into ANY voucher form via a small per-type adapter (see adapters.ts).
 * - Triggers when the FIRST file is added (OCR toggle on + plan allows).
 * - Fills only validated ("fill") fields; never touches approval fields.
 * - Refresh: re-runs on the first attachment; keeps user-edited fields unless "Overwrite edited" is on.
 * - Auto Post: saves via the form's own submit with `ocrAutoPost` (form forces isApproved=false).
 */
import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { runOcrOnFile } from "./engine";
import { aiDocTypeForVoucher } from "./ai/aiChatModel";
import { parseBill } from "./parser";
import { extractIdentifiers, type OcrIdentifiers } from "./identifiers";
import { learnTemplateParty, lookupTemplateParty } from "./templates";
import { clampAutoPostSeconds, getOcrPrefs, useOcrPrefs } from "./prefs";
import { buildOcrNarration, formatOcrNarrationDate, itemsNarrationTag, readDateDisplayPrefs } from "./narration";
import { AutoPostCountdownBubble } from "./AutoPostCountdownBubble";
import { useOcrPlanAllowed } from "./gate";
import { OcrFindAccountDialog } from "./OcrFindAccountDialog";
import type { OcrSuggestion } from "./OcrSuggestionsDialog";
import { OcrFieldBubbles, ocrFieldForMissing, ocrFieldForSuggestion, useOcrTabBadge, type OcrBubble } from "./OcrFieldBubbles";
import { cancelOcrHandoff, parkOcrSession, requestOcrVoucherSwitch, resumeOcrSession, sameVoucherBucket, takeOcrHandoff } from "./handoff";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { classifyAiReceipt } from "@/lib/ocr/receiptDetect/aiClassify";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { createItemSilent, findExistingItemByName } from "@/components/items/createItemSilent";
import { baseUnitConversions, normalizeItemUnitName } from "@/components/items/itemUnitPrices";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, PARTY_SYSTEM_CREDITORS_ID } from "@/lib/partySystemGroups";
import { installOcrOriginalCapture, linkOcrOriginal, takeOcrOriginal } from "./ocrOriginals";
import { registerPreOcr } from "./ocrOriginals";
import type { OcrRawResult } from "./types";
import { isOcrSelectableParty } from "./types";
import { resolveOcrItemUnit } from "./extras";
import { inferItemGroupFromName } from "./extras";
import { findOrCreateSheetSizeItemGroups, mergeMasterGroups, type MasterGroupLike } from "@/lib/masterEntityGroupWrite";
import { billVatPercent, cleanItemName, partyNamePrefill, findVat13, isOwnCompany, otherPans, pickLedgerAccount } from "./extras";
import { getBlobFromLocalFileRef, isLocalFileRef } from "@/lib/localPendingFiles";
import { fetchPbAttachmentBlob } from "@/lib/pocketbaseData/pbAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useVouchers } from "@/hooks/useVouchers";
import { detectReceipt, AUTO_SWITCH_MIN_CONF, type ReceiptDetection } from "@/lib/ocr/receiptDetect";
import { accountDisplayLabel, buildMoneyVoucherFill, pickChargeAccount, receiptNarration, suggestMaskedPayees } from "@/lib/ocr/receiptDetect/fillPaymentOut";
import { paymentAmountFromBill } from "./fillPaymentOut";
import { normalizeName } from "./normalize";
import { resolveOcrBubbles, snapshotFromForm } from "./reactiveBubbles";
import type { OcrFormAdapter } from "./adapters";
import type { OcrItemLike, OcrParsedBill, OcrPartyLike } from "./types";

export type UseVoucherOcrOptions = {
  adapter: OcrFormAdapter;
  form: UseFormReturn<any>;
  files: readonly (File | string)[];
  companyId: string | null | undefined;
  ownPan?: string | null;
  parties: readonly OcrPartyLike[];
  items: readonly OcrItemLike[];
  taxes: readonly { id: string; rate?: number | string; name?: string }[];
  autoPost: () => void;
  isEditing: boolean;
  /** Our company display name (doc-type detection: are we seller or buyer). */
  ownName?: string | null;
  /** Bank/cash accounts (payments) for "change account" suggestions. */
  accounts?: readonly { id: string; name: string; isDeleted?: boolean }[];
  /** Lets a voucher-type switch hand the attachment to the new form. */
  setFiles?: (files: (File | string)[]) => void;
  disabled?: boolean;
  /** Purchase/Sale ledger options (value/label) for the Dr account lookup. */
  ledgerAccounts?: readonly { value: string; label: string }[];
  /** Actual open tab when one form serves two types (Payment In/Direct Income, Payment/Direct Expense). */
  currentVoucherType?: string;
};

/** Voucher types the AddVoucherDialog can switch to from an OCR suggestion. */
const OCR_SWITCHABLE = ["sale", "purchase", "payment_in", "payment_out", "direct_income", "direct_expense", "contra"];
const niceType = (t: string) => voucherTypeDisplayText(t).replace(/\b\w/g, (c) => c.toUpperCase());

const LEDGER_LS = (companyId: string) => `pl.ocr.ledger.${companyId}`;
function learnedLedger(companyId: string, partyId: string): string | null {
  try { return (JSON.parse(localStorage.getItem(LEDGER_LS(companyId)) || "{}") as Record<string, string>)[partyId] ?? null; } catch { return null; }
}
export function learnLedger(companyId: string, partyId: string, accountId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(LEDGER_LS(companyId)) || "{}") as Record<string, string>;
    m[partyId] = accountId;
    localStorage.setItem(LEDGER_LS(companyId), JSON.stringify(m));
  } catch { /* ignore */ }
}

function isEmptyVal(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (v instanceof Date) return Number.isNaN(v.getTime());
  if (Array.isArray(v)) return v.every((li: any) => !li?.itemId && !Number(li?.amount));
  return false;
}

async function loadFirstFile(f: File | string, companyId?: string | null): Promise<{ blob: Blob; mime: string } | null> {
  if (typeof f !== "string") return { blob: f, mime: f.type };
  const url = f.trim();
  const asSrc = (blob: Blob | null): { blob: Blob; mime: string } | null => {
    if (!blob || blob.size === 0) return null;
    const mime = blob.type || (/\.pdf(\?|$)/i.test(url) ? "application/pdf" : "image/jpeg");
    return { blob, mime };
  };
  try {
    if (isLocalFileRef(url)) {
      return asSrc(await getBlobFromLocalFileRef(url, companyId ? { companyId } : undefined));
    }
    if (url.startsWith("pbatt:")) {
      return asSrc(await fetchPbAttachmentBlob(url));
    }
    if (/^(https?:|data:|blob:)/i.test(url)) {
      const r = await fetch(url);
      if (!r.ok) return null;
      return asSrc(await r.blob());
    }
    return null;
  } catch {
    return null;
  }
}

/** Bump when parser/engine logic changes: shown in Show OCR text to prove the browser runs the new bundle. */
export const OCR_BUILD = "2026-11-12.6";

const MONEY_TYPES = ["payment_out", "payment_in", "direct_expense", "direct_income", "contra"] as const;
const ALL_TYPE_CHOICES = ["sale", "purchase", "payment_in", "payment_out", "direct_income", "direct_expense", "contra"] as const;

function findDuplicateByRef(vouchers: readonly any[] | undefined, txnId?: string, referenceId?: string): { id: string; voucherNumber?: string; type?: string } | null {
  const needles = [txnId, referenceId].map((s) => String(s ?? "").trim()).filter((s) => s.length >= 6);
  if (!needles.length) return null;
  for (const v of vouchers ?? []) {
    const hay = `${v?.narration ?? ""} ${v?.reference ?? ""} ${v?.referenceId ?? ""} ${v?.txnId ?? ""} ${v?.billNo ?? ""}`;
    if (needles.some((n) => hay.includes(n))) return { id: String(v.id ?? ""), voucherNumber: v.voucherNumber ?? v.voucherNo, type: v.type };
  }
  return null;
}

export function useVoucherOcr(o: UseVoucherOcrOptions) {
  const planAllowed = useOcrPlanAllowed();
  // Own company straight from the company profile (not only form props) - hard guard against offering ourselves as party
  const { company: profileCompany } = useCompany();
  const { user } = useAuth();
  const ownRef = useRef<{ name: string | null; pan: string | null }>({ name: null, pan: null });
  // Bank-receipt masters (local in-memory context, no Firestore read): own Bank/Cash, parties, staff
  const { processedAccounts: vAccounts, processedParties: vParties, processedStaff: vStaff, processedExpenseAccounts: vExp, vouchers: vVouchers, processedItemGroups: vItemGroups, processedItems: vProcItems } = useVouchers();
  const mastersRef = useRef({ accounts: vAccounts, parties: vParties, staff: vStaff, expense: vExp, vouchers: vVouchers });
  mastersRef.current = { accounts: vAccounts, parties: vParties, staff: vStaff, expense: vExp, vouchers: vVouchers };
  const itemGroupsRef = useRef<MasterGroupLike[]>((vItemGroups ?? []) as MasterGroupLike[]);
  // Merge hook lists into the ref; do not replace, or just-created Sheet/size groups are lost mid Create All.
  itemGroupsRef.current = mergeMasterGroups(itemGroupsRef.current, (vItemGroups ?? []) as MasterGroupLike[]);
  const procItemsRef = useRef(vProcItems ?? []);
  procItemsRef.current = vProcItems ?? [];
  {
    const pc = profileCompany as { name?: string; pan?: string; panNumber?: string } | null | undefined;
    ownRef.current = { name: pc?.name || o.ownName || null, pan: pc?.pan || pc?.panNumber || o.ownPan || null };
  }
  // Newly created masters: re-apply once the (async) master lists contain them
  const pendingRef = useRef<{ party?: string; items: { index: number; id: string }[]; tax?: string }>({ items: [] });
  const prefs = useOcrPrefs();
  // Edit Trxn (existing voucher): no OCR at all - no Refresh bar, no auto-run, no bubbles. Add mode unchanged.
  const visible = planAllowed && prefs.enabled && !o.disabled && !o.isEditing;
  const [running, setRunning] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [ids, setIds] = useState<OcrIdentifiers | null>(null);
  const lastBillRef = useRef<OcrParsedBill | null>(null);
  const [lastBill, setLastBill] = useState<OcrParsedBill | null>(null);
  lastBillRef.current = lastBill;
  const [debugInfo, setDebugInfo] = useState<{ text: string; meanConfidence: number; reasons: string[]; filled: string[]; missing: string[] } | null>(null);
  const [suggestions, setSuggestions] = useState<OcrSuggestion[]>([]);
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null);
  const [sugOpen, setSugOpen] = useState(false); // field bubbles shown
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const [dismissedMissingKeys, setDismissedMissingKeys] = useState<Set<string>>(() => new Set());
  const [missingNow, setMissingNow] = useState<string[]>([]);
  const [createPrefill, setCreatePrefill] = useState<Record<string, string> | null>(null);
  /** OCR "Create account" — prefilled bank/cash ledger from the slip (side = which voucher field it fills). */
  const [createAccountFor, setCreateAccountFor] = useState<{ side: "from" | "to"; prefill: { accountName?: string; accountType?: "Bank" | "Cash" } } | null>(null);
  /** Single-engine OCR failed: reason dialog (engine name + server/Gemini message + hint). */
  const [ocrFail, setOcrFail] = useState<{ engine: string; message: string } | null>(null);
  const [createItemFor, setCreateItemFor] = useState<{ index: number; name: string; unit?: string; rate: number; groupId?: string; ocrGroups?: MasterGroupLike[] } | null>(null);
  const [createTaxOpen, setCreateTaxOpen] = useState(false);
  const [vatPct, setVatPct] = useState(13);
  const filledRef = useRef(new Map<string, unknown>());
  const preOcrDoneRef = useRef(false);
  const pendingAutoPostRef = useRef(false);
  /* Auto Post countdown: after OCR, wait the configured seconds (header gear, default 10) then save; bubble above Save can cancel. */
  const [apCount, setApCount] = useState<number | null>(null);
  /** OCR result (raw) that already scheduled an Auto Post -> never schedule twice for the same read. */
  const apScheduledForRef = useRef<unknown>(null);
  const apTimerRef = useRef<number | null>(null);
  const cancelAutoPostCountdown = useCallback(() => {
    if (apTimerRef.current != null) { window.clearInterval(apTimerRef.current); apTimerRef.current = null; }
    pendingAutoPostRef.current = false;
    setApCount(null);
  }, []);
  const startAutoPostCountdown = useCallback(() => {
    if (apTimerRef.current != null) window.clearInterval(apTimerRef.current);
    let n = clampAutoPostSeconds(getOcrPrefs().autoPostSeconds);
    setApCount(n);
    apTimerRef.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) { setApCount(n); return; }
      if (apTimerRef.current != null) window.clearInterval(apTimerRef.current);
      apTimerRef.current = null;
      setApCount(null);
      savedRef.current = true;
      optsRef.current.autoPost();
    }, 1000);
  }, []);
  useEffect(() => () => { if (apTimerRef.current != null) window.clearInterval(apTimerRef.current); }, []);
  const apPrefOn = useOcrPrefs().autoPost;
  useEffect(() => { if (!apPrefOn) cancelAutoPostCountdown(); }, [apPrefOn, cancelAutoPostCountdown]);
  const [preReading, setPreReading] = useState<string | null>(null);
  const lastRawRef = useRef<OcrRawResult | null>(null);
  const [readBy, setReadBy] = useState<{ engine: "google" | "azure" | "tesseract" | "gemini"; note?: string } | null>(null);
  const inputNoteRef = useRef("handoff (no OCR)");
  const optsRef = useRef(o);
  optsRef.current = o;
  /** Auto Post fired (voucher saved) -> never park this OCR session for a remount. */
  const savedRef = useRef(false);
  const mountedRef = useRef(true);
  /** Live OCR run (Gemini call): aborted when the voucher closes or the user presses Stop on the toast. */
  const ocrAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Voucher closed while reading: cancel the request so no Gemini quota is spent on a dead form.
      ocrAbortRef.current?.abort();
    };
  }, []);
  /**
   * Voucher-type switch. The bill (files + OCR text + ticked ids) is parked for the TARGET form only; the dialog then
   * remounts the form. If this form is still mounted 1.5 s later the dialog refused the switch: drop the parked bill,
   * give the original upload back and show the suggestions again (they were hidden for the switch).
   */
  const switchVoucher = useCallback((typ: string, raw: OcrRawResult, selectedIds: string[]) => {
    const files = optsRef.current.files;
    const original = takeOcrOriginal(files[0]);
    const token = requestOcrVoucherSwitch(typ, files, { raw, original, selectedIds });
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      cancelOcrHandoff(token);
      if (original && files[0]) linkOcrOriginal(files[0], original);
      setDoneIds((p) => { if (!p.has("switch")) return p; const n = new Set(p); n.delete("switch"); return n; });
      setSugOpen(true);
    }, 1500);
  }, []);

  const canWrite = useCallback((path: string) => {
    const { form } = optsRef.current;
    if (getOcrPrefs().overwriteEdited) return true;
    const cur = form.getValues(path);
    if (isEmptyVal(cur)) return true;
    if (filledRef.current.has(path)) {
      const prev = filledRef.current.get(path);
      return JSON.stringify(prev) === JSON.stringify(cur);
    }
    return !form.getFieldState(path).isDirty;
  }, []);

  const write = useCallback((path: string, value: unknown) => {
    const { form } = optsRef.current;
    form.setValue(path, value as never, { shouldDirty: true, shouldValidate: false });
    filledRef.current.set(path, form.getValues(path));
  }, []);


  const itemCreateApiRef = useRef<{
    auto: (index: number, row: { description: string; unit?: string; rate: number }, known?: { id: string; name?: string; isDeleted?: boolean }[]) => Promise<{ ok: true; id: string; reused: boolean; name: string } | { ok: false; message: string }>;
    manual: (index: number, row: { description: string; unit?: string; rate: number }) => Promise<void>;
    all: (items: { id: string }[]) => Promise<void>;
  }>(null as never);

  const applyCreatedItemToLine = useCallback((index: number, id: string, billUnit?: string) => {
    const A = optsRef.current.adapter.lineItems;
    if (!A || !id) return;
    write(`${A.path}.${index}.itemId`, id);
    const item = optsRef.current.items.find((it) => it.id === id) ?? (procItemsRef.current as { id: string }[] | undefined)?.find((it) => it.id === id);
    const unit = resolveOcrItemUnit(item as never, billUnit, optsRef.current.adapter.partySide === "seller" ? "purchase" : "sale");
    if (unit) write(`${A.path}.${index}.unit`, unit);
    pendingRef.current.items.push({ index, id });
  }, [write]);

  itemCreateApiRef.current = {
    auto: async (index, row, known) => {
      const name = cleanItemName(row.description);
      const companyId = optsRef.current.companyId;
      const uid = user?.uid;
      if (!companyId || !uid) return { ok: false, message: "You must be logged in and have a company selected." };
      const existingItems = [
        ...(known ?? []),
        ...optsRef.current.items,
        ...((procItemsRef.current ?? []) as { id: string; name?: string; isDeleted?: boolean }[]),
      ];
      const reused = findExistingItemByName(existingItems, name);
      if (reused) {
        applyCreatedItemToLine(index, reused.id, row.unit);
        setDoneIds((p) => new Set([...p, `create-item-${index}`]));
        return { ok: true, id: reused.id, reused: true, name };
      }
      let groupId: string | undefined;
      const inferred = inferItemGroupFromName(name);
      if (inferred) {
        try {
          const found = await findOrCreateSheetSizeItemGroups({
            company: profileCompany, companyId, userId: uid, size: inferred.size, parentName: inferred.parentName, existing: itemGroupsRef.current,
          });
          itemGroupsRef.current = mergeMasterGroups(itemGroupsRef.current, found.groups);
          groupId = found.childId;
        } catch {
          /* still create the item without a group */
        }
      }
      const isPurchase = optsRef.current.adapter.partySide === "seller";
      const vat = findVat13(optsRef.current.taxes);
      const u = normalizeItemUnitName(row.unit);
      const res = await createItemSilent({
        company: profileCompany, companyId, userId: uid, name, type: "item", groupId: groupId ?? null,
        purchasePrice: isPurchase ? row.rate : 0, salePrice: isPurchase ? 0 : row.rate,
        purchasePriceUnit: u || null, salePriceUnit: u || null, unitConversions: baseUnitConversions(u),
        purchaseTaxId: isPurchase ? (vat?.id ?? null) : null, saleTaxId: isPurchase ? null : (vat?.id ?? null),
        existingItems,
      });
      if (res.ok === false) return { ok: false, message: res.message };
      applyCreatedItemToLine(index, res.id, row.unit);
      setDoneIds((p) => new Set([...p, `create-item-${index}`]));
      return { ok: true, id: res.id, reused: res.reused, name };
    },
    manual: async (index, row) => {
      const name = cleanItemName(row.description);
      let groupId: string | undefined;
      const inferred = inferItemGroupFromName(name);
      const companyId = optsRef.current.companyId;
      const uid = user?.uid;
      if (inferred && companyId && uid) {
        try {
          const found = await findOrCreateSheetSizeItemGroups({
            company: profileCompany, companyId, userId: uid, size: inferred.size, parentName: inferred.parentName, existing: itemGroupsRef.current,
          });
          itemGroupsRef.current = mergeMasterGroups(itemGroupsRef.current, found.groups);
          groupId = found.childId;
        } catch { /* form still opens without group */ }
      }
      setCreateItemFor({ index, name, unit: row.unit, rate: row.rate, groupId, ocrGroups: itemGroupsRef.current });
    },
    all: async (items) => {
      const billRows = lastBillRef.current?.lineItems?.value ?? [];
      const known: { id: string; name?: string; isDeleted?: boolean }[] = [];
      let created = 0, reused = 0, failed = 0;
      const toastId = toast.loading(`Creating items 0/${items.length}`);
      for (let i = 0; i < items.length; i++) {
        toast.loading(`Creating items ${i + 1}/${items.length}`, { id: toastId });
        const id = items[i].id;
        const index = Number(id.slice("create-item-".length));
        const row = billRows[index];
        if (!row || Number.isNaN(index)) { failed++; continue; }
        const res = await itemCreateApiRef.current.auto(index, row, known);
        if (res.ok) {
          if (res.reused) reused++; else created++;
          known.push({ id: res.id, name: res.name });
        } else failed++;
      }
      const summary = `${created} created, ${reused} reused, ${failed} failed`;
      if (failed && !created && !reused) toast.error(`Create All failed (${summary})`, { id: toastId });
      else toast.success(`Items: ${summary}`, { id: toastId });
    },
  };


  const run = useCallback(
    async (reason: "auto" | "refresh" | "handoff", reuse?: { raw?: OcrRawResult; selectedIds?: string[]; direct?: File }) => {
      const opt = optsRef.current;
      // direct = ORIGINAL picked file, OCR runs BEFORE compression/append (see ocrOriginals pre-OCR gate)
      const first = reuse?.direct ?? opt.files[0];
      if (!first || running) return;
      setRunning(true);
      setOcrFail(null);
      const lead = reason === "refresh" ? "Re-reading bill" : reason === "handoff" ? "Filling from the bill already read" : "Reading bill";
      const ac = new AbortController();
      ocrAbortRef.current = ac;
      /** Stop button on the toast: cancels the in-flight Gemini/Azure request and stops the fallback chain. */
      const StopButton = () => (
        <button
          type="button"
          onClick={() => ac.abort()}
          className="ml-2 shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          Stop
        </button>
      );
      const tId = toast.loading(<span className="flex items-center gap-1">{lead}…<StopButton /></span>);
      /** Engine names go into the same toast so a silent Gemini->Azure fallback is visible. */
      const seen: string[] = [];
      const onEngine = (name: string) => {
        if (ac.signal.aborted) return;
        if (!seen.includes(name)) seen.push(name);
        const label = seen.join(" → ");
        toast.loading(<span className="flex items-center gap-1">{reason === "handoff" ? `${lead}…` : `${lead} by ${label}…`}<StopButton /></span>, { id: tId });
      };
      try {
        // Prefer the ORIGINAL full-resolution upload (attachment state holds the compressed copy)
        let raw: OcrRawResult;
        if (reuse?.raw) {
          raw = reuse.raw; // voucher-type switch: no second OCR, re-parse the same text for this form
        } else {
          const orig = takeOcrOriginal(first);
          const src = orig ? { blob: orig as Blob, mime: orig.type } : await loadFirstFile(first, opt.companyId);
          if (!src) throw new Error("Attachment could not be read for OCR");
          inputNoteRef.current = `${orig ? "ORIGINAL upload" : "stored attachment (compressed)"} ${src.mime} ${(src.blob.size / 1024).toFixed(0)} KB`;
          if (process.env.NODE_ENV !== "production") {
            console.info(`[OCR] input: ${orig ? "ORIGINAL upload" : "stored attachment (compressed)"} ${src.mime} ${(src.blob.size / 1024).toFixed(0)} KB`);
          }
          raw = await runOcrOnFile(src.blob, src.mime, {
            companyId: opt.companyId,
            enginePref: getOcrPrefs().engine,
            ownCompany: { name: ownRef.current.name, pan: ownRef.current.pan },
            ownAccounts: (mastersRef.current.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ accountName: a.accountName, accountNumber: a.accountNumber, bankName: a.bankName, accountType: a.accountType })),
            aiDocType: aiDocTypeForVoucher(opt.currentVoucherType ?? null, opt.adapter.partySide),
            onEngine,
            signal: ac.signal,
          });
        }
        lastRawRef.current = raw;
        setReadBy({ engine: raw.engine === "google" || raw.engine === "azure" || raw.engine === "gemini" ? raw.engine : "tesseract", note: raw.engineNote });
        const lowConf = raw.meanConfidence < 55;
        if (lowConf) {
          toast.message("OCR: image is not very clear", { id: tId, description: "Please confirm the highlighted fields. Nothing will be auto-saved.", duration: 5000, position: "top-right" });
        }
        const own = ownRef.current;
        /* ---------- Money documents (connectIPS, Prabhu, generic bank, handwritten): detect + classify + fill ---------- */
        {
          const M = mastersRef.current;
          const textRc: ReceiptDetection = detectReceipt(`${raw.text}\n${raw.altText ?? ""}`, {
            ownAccounts: (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType, branch: (a as { branch?: string }).branch, aliasName: (a as { aliasName?: string }).aliasName })),
            parties: (M.parties ?? []).filter((p) => !(p as { isDeleted?: boolean }).isDeleted).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName })),
            staff: (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") })),
            companyName: own.name ?? undefined,
          });
          /* Gemini already answered the money question (bank_flow + both accounts). Its JSON knows the
           * customer/beneficiary sections the compact summary text lacks, so prefer its type — but keep
           * the text parser's amount/date/charge payload when it has one. */
          const aiRc = raw.ai ? classifyAiReceipt(raw.ai.data, {
            ownAccounts: (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType, branch: (a as { branch?: string }).branch, aliasName: (a as { aliasName?: string }).aliasName })),
            parties: (M.parties ?? []).filter((p) => !(p as { isDeleted?: boolean }).isDeleted).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName })),
            staff: (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") })),
            companyName: own.name ?? undefined,
          }) : null;
          const rc: ReceiptDetection = aiRc
            ? (() => {
                /* Prefer Gemini's structured payload (holder name, charge, date, both accounts) and only borrow the
                 * text parser's extra fields — it can see raw labels the compact JSON skipped. */
                const ai = aiRc.parsed;
                const text = textRc.parsed;
                const parsed = ai && text
                  ? {
                      ...text,
                      ...ai,
                      sender: { ...text.sender, ...ai.sender },
                      beneficiary: { ...text.beneficiary, ...ai.beneficiary },
                      amount: ai.amount ?? text.amount,
                      charge: ai.charge ?? text.charge,
                      date: ai.date ?? text.date,
                      txnId: ai.txnId ?? text.txnId,
                      referenceId: ai.referenceId ?? text.referenceId,
                      particulars: ai.particulars ?? text.particulars,
                    }
                  : (ai ?? text);
                return { ...aiRc, parsed: parsed ?? null, format: textRc.parsed ? textRc.format : aiRc.format, confidence: Math.max(aiRc.confidence, textRc.confidence) };
              })()
            : textRc;
          if (rc.format && rc.format !== "tax_invoice") {
            const cur = opt.currentVoucherType ?? opt.adapter.voucherType;
            const highUnique = !!rc.voucherType && rc.typeConfidence >= AUTO_SWITCH_MIN_CONF;
            const types: string[] = rc.voucherType ? [rc.voucherType] : (rc.candidates.length ? rc.candidates : [...ALL_TYPE_CHOICES]);
            const m = rc.master;
            const masterTxt = m.kind ? `${m.kind === "own_bank" ? "own bank" : m.kind}: ${m.name ?? "-"} (${Math.round(m.score * 100)}%)` : "no master matched";
            const why = `${rc.format} document; ${rc.reason}; ${masterTxt}${rc.payeeType === "staff" ? "; payee type Staff" : ""}`;
            const ownAcc = (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType, branch: (a as { branch?: string }).branch, aliasName: (a as { aliasName?: string }).aliasName }));
            const parties = (M.parties ?? []).filter((p) => isOcrSelectableParty(p as never)).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName }));
            const staff = (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") }));
            const taxes = (opt.taxes ?? []).map((tx) => ({ id: tx.id, name: String(tx.name ?? "") }));
            const rFilled: string[] = [];
            const rMissing: string[] = [];
            const rExtra: OcrSuggestion[] = [];
            const direction = rc.voucherType === "payment_in" || rc.voucherType === "direct_income" ? "payment_in"
              : rc.voucherType === "contra" ? "contra"
              : "payment_out";
            const tabIsMoney = (MONEY_TYPES as readonly string[]).includes(cur);
            const tabMatches = !rc.voucherType || sameVoucherBucket(cur, rc.voucherType) || cur === rc.voucherType;
            const canFill = !!rc.parsed && tabIsMoney && tabMatches;
            const fillSafeOnly = !!rc.parsed && tabIsMoney && !rc.voucherType; // date/amount/narration only

            const pf = rc.parsed ? buildMoneyVoucherFill(rc.parsed, canFill ? direction : "payment_out", { ownAccounts: ownAcc, parties, staff, taxes }) : null;
            const allowWrite = !lowConf;

            if (pf && (canFill || fillSafeOnly)) {
              const F = opt.form;
              const A = opt.adapter;
              if (canFill && direction !== "contra") {
                const idPath = { party: A.party?.path ?? "partyId", staff: "staffId", tax: "taxAccountId" } as const;
                if (pf.payee) {
                  const path = idPath[pf.payee.payeeType];
                  if (allowWrite && canWrite(path) && canWrite("payeeType")) {
                    if (F.getValues("payeeType") !== pf.payee.payeeType) write("payeeType", pf.payee.payeeType);
                    write(path, pf.payee.id);
                    rFilled.push(`Payee (${pf.payee.payeeType}: ${pf.payee.name})`);
                  } else if (!allowWrite) {
                    rExtra.push({ id: "find-party", label: `Use ${pf.payee.payeeType} ${pf.payee.name}`, value: pf.payee.name, confidence: pf.payee.score, reason: "Low OCR confidence — confirm payee", apply: () => { write("payeeType", pf.payee!.payeeType); write(path, pf.payee!.id); } });
                  }
                } else {
                  if (pf.payeeName) rMissing.push("Party / payee");
                  if (pf.payeeName) {
                    const nm = pf.payeeName;
                    const unsure = pf.payeeUnsure ?? suggestMaskedPayees(nm, { parties, staff });
                    for (const u of unsure) {
                      rExtra.push({
                        id: `account-payee-${u.id}`, label: `Use ${u.payeeType} ${u.name}?`, value: `${nm} (masked / surname only)`, confidence: 0.6,
                        reason: "Surname-only match — not auto-filled",
                        apply: () => { write("payeeType", u.payeeType === "tax" ? "tax" : u.payeeType); write(idPath[u.payeeType], u.id); },
                      });
                    }
                    const bn = direction === "payment_in" ? rc.parsed!.sender : rc.parsed!.beneficiary;
                    rExtra.push({
                      id: "create-party", label: "Create new party", value: nm, confidence: 0.8,
                      reason: `Counter-party "${nm}" matches no party / staff / tax payee — opens Create Party prefilled; you confirm Save`, deferred: true,
                      apply: () => setCreatePrefill({ ...partyNamePrefill(nm), pan: "", phone: rc.parsed!.initiatorPhone ?? "", email: "", address: "", accountTypeId: PARTY_SYSTEM_CREDITORS_ID, extra: [bn.accountMasked && `Bank A/c: ${bn.accountMasked}`, bn.bankName, bn.branch].filter(Boolean).join(" | ") }),
                    });
                    rExtra.push({ id: "find-party", label: "Pick an existing account instead", value: "search by name", deferred: true, apply: () => setFindOpen(true) });
                  }
                }
              }
              if (canFill) {
                const accPath = direction === "contra" ? (A.fromAccountPath ?? "fromAccountId") : (A.accountPath ?? "accountId");
                const fromHit = pf.from;
                if (!("candidates" in fromHit)) {
                  if (allowWrite && canWrite(accPath)) { write(accPath, fromHit.id); rFilled.push(`From: ${fromHit.name}`); }
                  else if (!allowWrite) rExtra.push({ id: "account", label: "Bank / cash account", value: fromHit.name, reason: "Low OCR confidence — confirm account", apply: () => write(accPath, fromHit.id) });
                } else {
                  rMissing.push(`Bank / cash account (${fromHit.reason})`);
                  const fromIds = fromHit.candidates;
                  (fromHit.candidateNames ?? []).forEach((name, i) => {
                    const id = fromIds[i];
                    if (id) rExtra.push({ id: `account-${id}`, label: `Use ${name}`, value: name, reason: fromHit.reason, apply: () => write(accPath, id) });
                  });
                  // Neither bank is in Bank/Cash: let the user create the missing ledger prefilled from the slip.
                  const accName = rc.parsed?.sender?.accountName || rc.parsed?.sender?.bankName || own.name || "";
                  rExtra.push({
                    id: "create-account-from", label: "Create bank account (From)", value: accName || "from this slip",
                    confidence: 0.7, reason: "Opens Create Bank/Cash prefilled — you confirm Save, then it fills From", deferred: true,
                    apply: () => setCreateAccountFor({ side: "from", prefill: { accountName: accName || undefined, accountType: "Bank" } }),
                  });
                }
                if (direction === "contra" && pf.to) {
                  const toHit = pf.to;
                  const toPath = A.toAccountPath ?? "toAccountId";
                  if (!("candidates" in toHit)) {
                    if (allowWrite && canWrite(toPath)) { write(toPath, toHit.id); rFilled.push(`To: ${toHit.name}`); }
                    else if (!allowWrite) rExtra.push({ id: `account-to`, label: "To account", value: toHit.name, apply: () => write(toPath, toHit.id) });
                  } else {
                    rMissing.push(`To account (${toHit.reason})`);
                    const toIds = toHit.candidates;
                    (toHit.candidateNames ?? []).forEach((name, i) => {
                      const id = toIds[i];
                      if (id) rExtra.push({ id: `account-${id}`, label: `Use ${name} (to)`, value: name, reason: toHit.reason, apply: () => write(toPath, id) });
                    });
                    const toName = rc.parsed?.beneficiary?.accountName || rc.parsed?.beneficiary?.bankName || "";
                    rExtra.push({
                      id: "create-account-to", label: "Create bank account (To)", value: toName || "from this slip",
                      confidence: 0.7, reason: "Opens Create Bank/Cash prefilled — you confirm Save, then it fills To", deferred: true,
                      apply: () => setCreateAccountFor({ side: "to", prefill: { accountName: toName || undefined, accountType: "Bank" } }),
                    });
                  }
                }
              }
              const outTab = cur === "payment_out" || cur === "direct_expense" || cur === "contra";
              const amountPath = A.payeeAmount ?? (outTab ? "payeeAmount" : (A.amount ?? "amount"));
              if (pf.amount) {
                const topAmount = outTab ? pf.amount + (pf.charge ?? 0) : pf.amount;
                if (allowWrite && canWrite(amountPath)) { write(amountPath, pf.amount); rFilled.push(`Amount ${pf.amount}`); }
                else if (!allowWrite) rExtra.push({ id: "amount", label: "Amount", value: String(pf.amount), reason: "Low OCR confidence — confirm amount", apply: () => write(amountPath, pf.amount) });
                if (allowWrite && A.amount && A.amount !== amountPath && canWrite(A.amount)) write(A.amount, topAmount);
                if (allowWrite && amountPath !== "amount" && canWrite("amount")) write("amount", topAmount);
              } else rMissing.push("Amount");
              if (pf.date) {
                if (allowWrite && canWrite("date")) { write("date", pf.date); rFilled.push("Date"); }
                else if (!allowWrite) rExtra.push({ id: "date", label: "Date", value: pf.date.toDateString(), reason: "Low OCR confidence — confirm date", apply: () => write("date", pf.date) });
              } else rMissing.push("Date");
              if (canFill && pf.charge && (direction === "payment_out" || direction === "contra" || cur === "direct_expense")) {
                if (allowWrite && canWrite("otherChargeAmount")) { write("otherChargeAmount", pf.charge); rFilled.push(`Charge ${pf.charge}`); }
                let defId: string | null = null;
                try { defId = localStorage.getItem(`pocket-ledger:payment-out:other-charge-default:${opt.companyId || "global"}`); } catch { /* ignore */ }
                const cands = [
                  ...(M.expense ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted).map((e) => ({ id: e.id, name: String((e as { name?: string }).name ?? ""), kind: "expense" as const })),
                  ...(M.parties ?? []).filter((p) => isOcrSelectableParty(p as never)).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), kind: "party" as const })),
                  ...(M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? ""), kind: "staff" as const })),
                ];
                const ch = pickChargeAccount(cands, { bankName: rc.parsed!.sender?.bankName, defaultId: defId });
                const curCh = String(F.getValues("otherChargeAccountId") ?? "");
                if (ch && allowWrite && (!curCh || (ch.method === "detected" && canWrite("otherChargeAccountId")))) {
                  if (curCh !== ch.id) write("otherChargeAccountId", ch.id);
                  rFilled.push(`Charge account (${ch.method}: ${ch.name})`);
                } else if (!ch && !curCh) rMissing.push("Other charge account (bank charge)");
              }
              {
                const selId = String(F.getValues(direction === "contra" ? (A.fromAccountPath ?? "fromAccountId") : (A.accountPath ?? "accountId")) ?? "");
                const sel = (M.accounts ?? []).find((a) => a.id === selId);
                const fromLabel = sel ? accountDisplayLabel(sel as never) : null;
                const fullN = receiptNarration(rc.parsed!, fromLabel);
                if (getOcrPrefs().narrationStyle === "short") {
                  const toId = direction === "contra" ? String(F.getValues(A.toAccountPath ?? "toAccountId") ?? "") : "";
                  const toAcc = toId ? (M.accounts ?? []).find((a) => a.id === toId) : undefined;
                  pf.narration = buildOcrNarration({
                    style: "short",
                    voucherType: direction,
                    billNo: rc.parsed!.voucherNo || rc.parsed!.txnId || undefined,
                    partyName: pf.payee?.name ?? pf.payeeName ?? undefined,
                    dateText: pf.date ? formatOcrNarrationDate(pf.date, readDateDisplayPrefs()) : "",
                    fromName: fromLabel || undefined,
                    toName: toAcc ? accountDisplayLabel(toAcc as never) : (rc.parsed!.beneficiary?.accountName ?? undefined),
                  });
                } else pf.narration = fullN;
              }
              if (pf.narration && A.narration) {
                const curN = String(F.getValues(A.narration) ?? "");
                if (allowWrite && (!curN || canWrite(A.narration))) { write(A.narration, pf.narration); rFilled.push("Narration"); }
                else if (allowWrite && (rc.parsed!.txnId || rc.parsed!.referenceId) && rc.parsed!.txnId && !curN.includes(rc.parsed!.txnId)) { write(A.narration, `${curN} | ${pf.narration}`); rFilled.push("Narration (appended)"); }
              }
            }

            if (rc.statusWarning) {
              rExtra.push({ id: "status-failed", label: "Status warning", value: rc.statusWarning, blocked: rc.statusWarning, apply: () => undefined });
            }
            const dup = findDuplicateByRef(M.vouchers, rc.parsed?.txnId, rc.parsed?.referenceId);
            if (dup) {
              rExtra.push({
                id: "duplicate-ref",
                label: "Possible duplicate",
                value: `Txn/Ref already appears on voucher ${dup.voucherNumber || dup.id}${dup.type ? ` (${niceType(String(dup.type))})` : ""}`,
                blocked: "This reference/transaction number is already on a saved voucher",
                apply: () => undefined,
              });
            }

            const sg: OcrSuggestion[] = [...rExtra];
            if (!highUnique) {
              sg.push({
                id: "cannot-detect",
                label: "Cannot detect voucher type",
                value: "Stay on the current voucher, or switch:",
                blocked: `Current: ${niceType(cur)}`,
                apply: () => undefined,
              });
              for (const typ of types.filter((x) => x !== cur)) {
                sg.push({
                  id: `switch-${typ}`,
                  label: niceType(typ),
                  value: `from: ${niceType(cur)}`,
                  confidence: Math.max(0.3, rc.typeConfidence),
                  reason: why,
                  blocked: !OCR_SWITCHABLE.includes(typ) ? "This voucher type cannot be opened from OCR" : opt.isEditing ? "Only for new vouchers" : undefined,
                  deferred: true,
                  apply: () => switchVoucher(typ, raw, []),
                });
              }
            } else if (rc.voucherType && rc.voucherType !== cur) {
              sg.push({
                id: "switch",
                label: `Switch to ${niceType(rc.voucherType)} voucher`,
                value: `from: ${niceType(cur)}`,
                confidence: rc.typeConfidence,
                reason: why,
                blocked: !OCR_SWITCHABLE.includes(rc.voucherType) ? "This voucher type cannot be opened from OCR" : opt.isEditing ? "Only for new vouchers" : undefined,
                deferred: true,
                apply: () => switchVoucher(rc.voucherType!, raw, []),
              });
            }
            setLastBill(null);
            setReceiptTarget(sg.some((x) => x.id === "switch" && !x.blocked) ? rc.voucherType ?? null : null);
            setSuggestions(sg);
            if (reason === "refresh") { setDoneIds(new Set()); setDismissedKeys(new Set()); setDismissedMissingKeys(new Set()); }
            if (sg.some((x) => !x.blocked) || rMissing.length) setSugOpen(true);
            setMissingNow(rMissing);
            setDebugInfo({
              text: [`--- OCR build ${OCR_BUILD} | OCR engine: ${raw.engine ?? "tesseract"}${raw.engineNote ? ` (${raw.engineNote})` : ""} | document: ${rc.format} (${Math.round(rc.confidence * 100)}%)${lowConf ? " | LOW CONFIDENCE" : ""} ---`, `Type: ${rc.voucherType ?? `undecided (${types.join(" / ")})`} (${Math.round(rc.typeConfidence * 100)}%)`, why, rc.narration ? `Narration: ${rc.narration}` : "", rc.otherCharge ? `Charge: ${rc.otherCharge.amount}` : "", rc.statusWarning ?? "", "--- OCR text ---", raw.text].filter(Boolean).join("\n"),
              meanConfidence: raw.meanConfidence, reasons: [why], filled: rFilled, missing: rMissing,
            });
            const here = !!(rc.voucherType && (rc.voucherType === cur || sameVoucherBucket(cur, rc.voucherType)));
            toast.success(`OCR: ${rc.format === "connectips" ? "connectIPS" : rc.format.replace(/_/g, " ")} detected`, {
              id: tId, duration: 6000, position: "top-right",
              description: rFilled.length || rMissing.length
                ? `Filled: ${rFilled.join(", ") || "nothing"}${rMissing.length ? ` | Missing: ${rMissing.map((x) => x.split(" (")[0]).join(", ")}` : ""}`
                : here && highUnique ? `${niceType(cur)} is the right voucher.` : !highUnique ? "Cannot detect voucher type — stay on the current voucher or pick one." : `Suggested: ${types.map(niceType).join(" / ")}.`,
            });
            if ((reason === "auto" || reason === "handoff") && getOcrPrefs().autoPost && !opt.isEditing && opt.adapter.autoPost && apScheduledForRef.current !== raw) {
              const F = opt.form;
              const ok =
                !lowConf &&
                !rc.statusWarning &&
                !dup &&
                rFilled.length > 0 &&
                rMissing.length === 0 &&
                highUnique &&
                !sg.some((x) => (x.id === "switch" || x.id.startsWith("switch-")) && !x.blocked) &&
                (opt.adapter.requiredPaths ?? []).every((pth) => !isEmptyVal(F.getValues(pth)));
              if (ok) {
                apScheduledForRef.current = raw;
                if (F.getValues("isApproved") !== undefined) F.setValue("isApproved", false as never);
                toast.info("OCR Auto Post: saving as UNAPPROVED", { duration: 2500 });
                if (reuse?.direct) pendingAutoPostRef.current = true;
                else startAutoPostCountdown();
              } else {
                toast.message("OCR Auto Post skipped", { description: "Required fields missing, type is uncertain, or the document needs review.", duration: 5000 });
              }
            }
            return;
          }
        }
        const bill = parseBill(raw, { kind: opt.adapter.partySide === "seller" ? "purchase" : "sale", parties: opt.parties, items: opt.items, ownPan: own.pan, ownName: own.name });
        if (lowConf) {
          const note = "Image is not clear — please confirm";
          const flag = (f?: { status: string; note?: string }) => { if (f && f.status === "fill") { f.status = "flag"; f.note = f.note ? `${f.note}; ${note}` : note; } };
          flag(bill.date); flag(bill.dueDate); flag(bill.amount); flag(bill.total); flag(bill.subTotal); flag(bill.vat); flag(bill.discount); flag(bill.lineItems); flag(bill.partyId); flag(bill.billNo);
          bill.debug?.push(`Low OCR confidence (${Math.round(raw.meanConfidence)}%) — fields offered for confirmation, not auto-filled`);
        }
        // Counter-party block identifiers from the parser (never our own buyer block); legacy scan as fallback
        const identifiers = bill.identifiers ?? extractIdentifiers(raw.lines.map((l) => l.text), opt.ownPan, bill.pan?.value);
        // HARD GUARD: our own company is never the party. Fall back to the other PAN printed on the bill.
        if (isOwnCompany(bill.partyName?.value, identifiers.pan, own)) {
          const alt = otherPans(raw.text + "\n" + (raw.altText ?? ""), own.pan)[0];
          bill.debug?.push(`Own company (${own.name ?? "-"} / ${own.pan ?? "-"}) was picked as party - dropped${alt ? `; using other PAN ${alt}` : ""}`);
          if (isOwnCompany(bill.partyName?.value, null, own)) bill.partyName = undefined;
          identifiers.pan = alt ?? undefined;
          if (bill.partyId?.value && opt.parties.some((p) => p.id === bill.partyId!.value && isOwnCompany(p.name, p.pan, own))) bill.partyId = undefined;
          if (alt && !bill.partyId) {
            const hits = opt.parties.filter((p) => !p.isDeleted && String(p.pan ?? "").replace(/\D/g, "") === alt);
            if (hits.length === 1) bill.partyId = { value: hits[0].id, status: "fill", confidence: 0.99 };
          }
        }
        setIds(identifiers);
        setReceiptTarget(null);
        setLastBill(bill);

        // Learned template (identifier → account) when strict match failed
        if (bill.partyId?.status !== "fill" && opt.companyId) {
          const tp = lookupTemplateParty(opt.companyId, identifiers);
          const tpRow = tp ? opt.parties.find((p) => p.id === tp) : undefined;
          if (tpRow && isOcrSelectableParty(tpRow)) {
            bill.partyId = { value: tp!, status: "fill", confidence: 0.98 };
            bill.debug?.push(`Party: "${tpRow.name}" from learned supplier template (PAN/phone)`);
          } else if (tp) {
            // stale/unusable learning (e.g. a system ledger like Sales Account, or a frozen/deleted account): ignore it
            bill.debug?.push(`Party: learned template -> "${tpRow?.name ?? tp}" ignored (not selectable as a party)`);
          }
        }
        // Final guard: only a party that is an option of the Supplier/Customer combobox may be written
        if (bill.partyId?.status === "fill") {
          const row = opt.parties.find((p) => p.id === bill.partyId!.value);
          if (!isOcrSelectableParty(row)) {
            bill.debug?.push(`Party: picked "${row?.name ?? bill.partyId.value}" is not selectable (${!row ? "not in party list" : row.isFrozen ? "frozen" : row.isDeleted ? "deleted" : "system ledger"}) - not written`);
            bill.partyId = undefined;
          }
        }

        const filled: string[] = [];
        const missing: string[] = [];
        const A = opt.adapter;
        const F = opt.form;
        const filledKeys = new Set<string>();
        const markFill = (label: string, key: string) => { filled.push(label); filledKeys.add(key); };

        // Party (+ payee type for payment forms; skipped for non-party payees like Direct Expense)
        if (A.party) {
          const pt = A.party.payeeTypePath ? String(F.getValues(A.party.payeeTypePath) ?? "") : "";
          const partyApplicable = !A.party.allowedPayeeTypes || !pt || A.party.allowedPayeeTypes.includes(pt);
          if (partyApplicable) {
            if (bill.partyId?.status === "fill") {
              if (canWrite(A.party.path)) {
                if (A.party.payeeTypePath && A.party.payeeTypeValue && pt !== A.party.payeeTypeValue) write(A.party.payeeTypePath, A.party.payeeTypeValue);
                write(A.party.path, bill.partyId.value);
                markFill("Party", "party");
              } else filledKeys.add("party");
            } else missing.push("Party");
          }
        }
        if (A.date) {
          if (bill.date?.status === "fill") {
            if (canWrite(A.date)) write(A.date, bill.date.value);
            markFill("Date", "date");
          } else missing.push("Date");
        }
        if (A.dueDate && bill.dueDate?.status === "fill" && canWrite(A.dueDate)) {
          write(A.dueDate, bill.dueDate.value);
          filled.push("Due date");
        }

        // Line items (+ discount) only when totals reconciled
        if (A.lineItems) {
          if (bill.lineItems?.status === "fill") {
            const vat = bill.vat?.value ?? 0;
            const vatTax = findVat13(opt.taxes);
            if (vat > 0 && !vatTax) missing.push("VAT 13% tax account (see Suggestions)");
            {
              const rows = bill.lineItems.value.map((r) => {
                const base = A.lineItems!.makeEmpty();
                return {
                  ...base,
                  type: "item",
                  itemId: r.itemId ?? "",
                  quantity: r.quantity,
                  rate: r.rate,
                  // same unit rule as picking the item manually (item's purchase/sale unit; bill unit if it is one of the item's units)
                  unit: r.itemId
                    ? resolveOcrItemUnit(opt.items.find((it) => it.id === r.itemId) as never, r.unit, A.partySide === "seller" ? "purchase" : "sale")
                    : r.unit ?? (base.unit as string | undefined) ?? "",
                  // item's default tax like manual pick - only when the bill HAS VAT but no VAT 13% account was found
                  // (a bill without VAT must not gain tax: totals must stay the bill's)
                  ...(r.itemId && vat > 0 && !vatTax ? (() => {
                    const it = opt.items.find((i) => i.id === r.itemId) as { purchaseTaxId?: string; saleTaxId?: string } | undefined;
                    const t = A.partySide === "seller" ? it?.purchaseTaxId : it?.saleTaxId;
                    return t ? { taxAccountId: t } : {};
                  })() : {}),
                  amount: r.amount,
                  ...(vat > 0 && vatTax ? { taxAccountId: vatTax.id } : {}),
                  // TDS only with evidence on the bill; never inherit the form's stored TDS default on OCR lines
                  ...(!bill.tds ? { tdsAccountId: "" } : {}),
                };
              });
              if (canWrite(A.lineItems.path)) {
                write(A.lineItems.path, rows);
                if (!bill.tds) {
                  // Purchase/Sale forms re-apply a stored TDS default to empty lines when the line count changes
                  // (readStoredTdsDefault effect). Clear it again on the OCR lines once that effect has run.
                  const n = rows.length;
                  const clearTds = () => {
                    for (let i = 0; i < n; i++) {
                      const p = `${A.lineItems!.path}.${i}.tdsAccountId`;
                      if (String(F.getValues(p) ?? "")) F.setValue(p, "" as never, { shouldDirty: true });
                    }
                  };
                  window.setTimeout(clearTds, 0);
                  window.setTimeout(clearTds, 250);
                }
                filled.push(`Line items (${rows.length})${vat > 0 && vatTax ? " + VAT 13%" : ""}`);
                // Item descriptions are added to the narration below (full vs short setting).
              }
              filledKeys.add("lines");
              if (bill.discount?.status === "fill" && bill.discount.value > 0 && A.lineItems.discountPath && canWrite(A.lineItems.discountPath)) {
                write(A.lineItems.discountPath, bill.discount.value);
                if (A.lineItems.discountSignPath) F.setValue(A.lineItems.discountSignPath, "-" as never, { shouldDirty: true });
              }
            }
          } else missing.push(bill.lineItems ? "Line items (did not reconcile)" : "Line items");
          if (bill.total?.status !== "fill") missing.push("Total");
        }

        // Purchase/Sale ledger (Dr Purchase A/c): learned per supplier -> existing account by name -> built-in default
        let ledgerMissing = false;
        if (A.ledgerAccount) {
          const L = A.ledgerAccount;
          const opts = opt.ledgerAccounts ?? [];
          const partyNow = A.party ? String(F.getValues(A.party.path) ?? "") : "";
          const learned = partyNow && opt.companyId ? learnedLedger(opt.companyId, partyNow) : null;
          const picked = pickLedgerAccount(opts, L, learned);
          const pick = picked.value;
          const cur = String(F.getValues(L.path) ?? "");
          if (!cur || canWrite(L.path) || cur === L.systemDefault) {
            if (cur !== pick) write(L.path, pick);
            filled.push(picked.source === "learned" ? "Purchase account (learned for this supplier)" : "Purchase account");
          }
          ledgerMissing = !pick;
        }

        // Single amount (payments / contra / adjustment): write only when paymentAmountFromBill says fill
        if (A.amount) {
          const payAmt = paymentAmountFromBill(bill);
          if (payAmt?.mode === "fill") {
            if (canWrite(A.amount)) write(A.amount, payAmt.value);
            markFill("Amount", "amount");
          } else if (payAmt?.mode === "suggest") {
            missing.push(payAmt.note ? `Amount (${payAmt.note})` : "Amount");
          } else missing.push(bill.amount ? `Amount (${bill.amount.note ?? "not confirmed"})` : "Amount");
        }

        // Narration: full = current item + Bill No wording (append); short = Bill No / party / date
        if (A.narration) {
          const nStyle = getOcrPrefs().narrationStyle === "short" ? "short" : "full";
          const party = A.party ? opt.parties.find((p) => p.id === F.getValues(A.party!.path)) : undefined;
          const partyName = party?.name ?? bill.partyName?.value ?? "";
          const rawDate = bill.date?.value && !Number.isNaN(bill.date.value.getTime()) ? bill.date.value : A.date ? (F.getValues(A.date) as Date | undefined) : undefined;
          const dateText = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? formatOcrNarrationDate(rawDate, readDateDisplayPrefs()) : "";
          const free = (bill.lineItems?.value ?? []).filter((r) => !r.itemId);
          const itemsText = itemsNarrationTag(free.map((r) => ({ description: r.description, quantity: r.quantity, unit: r.unit, rate: r.rate })));
          const built = buildOcrNarration({
            style: nStyle,
            voucherType: opt.currentVoucherType ?? A.voucherType,
            billNo: bill.billNo?.value,
            partyName,
            dateText,
            itemsText,
          });
          if (nStyle === "short") {
            if (built && canWrite(A.narration) && String(F.getValues(A.narration) ?? "") !== built) {
              write(A.narration, built);
              filled.push("Narration");
            }
          } else {
            const cur0 = String(F.getValues(A.narration) ?? "");
            if (itemsText && !cur0.includes(itemsText) && canWrite(A.narration)) {
              write(A.narration, cur0 ? `${cur0} | ${itemsText}` : itemsText);
            }
            if (bill.billNo?.status === "fill") {
              const cur = String(F.getValues(A.narration) ?? "");
              if (!cur.includes(`Bill No: ${bill.billNo.value}`) && canWrite(A.narration)) {
                const tag = [`Bill No: ${bill.billNo.value}`, partyName || undefined, "OCR"].filter(Boolean).join(" | ");
                write(A.narration, cur ? `${cur} | ${tag}` : tag);
                filled.push("Bill No -> narration");
              }
            }
          }
          if (bill.billNo?.status !== "fill") missing.push("Bill No");
        }

        /* ---------------- Suggestions checklist (all unticked) ---------------- */
        const sg: OcrSuggestion[] = [];
        const pct = (n?: number) => n;
        const curParty = A.party ? F.getValues(A.party.path) : "x";
        if (bill.docType && !sameVoucherBucket(A.voucherType, bill.docType.type)) {
          const dt = bill.docType.type;
          const supported = OCR_SWITCHABLE.includes(dt);
          const nice = niceType(dt);
          sg.push({
            id: "switch", label: `Switch to ${nice} voucher`, value: `from: ${niceType(opt.currentVoucherType ?? A.voucherType)}`, confidence: bill.docType.confidence, reason: bill.docType.reason,
            blocked: supported ? (opt.isEditing ? "Only for new vouchers" : undefined) : "No return/note voucher form in this app",
            deferred: true,
            apply: (ctx) => switchVoucher(dt, raw, ctx?.selectedIds ?? []),
          });
        }
        const billIsOwn = isOwnCompany(bill.partyName?.value, identifiers.pan, own);
        if (billIsOwn) bill.debug?.push("Create party skipped: extracted name/PAN is our own company");
        if (A.party && !curParty && bill.partyId?.status === "flag" && bill.partyId.value) {
          const flagged = opt.parties.find((p) => p.id === bill.partyId!.value);
          if (flagged) {
            sg.push({
              id: "use-party",
              label: `Use ${flagged.name}`,
              value: flagged.name,
              confidence: bill.partyId.confidence,
              reason: bill.partyId.note ?? "Name shares a prefix only - confirm the party",
              apply: () => write(A.party!.path, flagged.id),
            });
          }
        }
        if (A.party && !curParty && !billIsOwn && (bill.partyName?.value || identifiers.pan)) {
          sg.push({
            id: "create-party", label: "Create new party", value: [bill.partyName?.value, identifiers.pan && `PAN ${identifiers.pan}`, identifiers.phones[0]].filter(Boolean).join(" · "),
            confidence: pct(bill.partyName?.confidence), reason: "No existing account matched by PAN / name / phone / email - opens Create Party prefilled; you confirm Save",
            deferred: true,
            apply: () => setCreatePrefill({
              ...partyNamePrefill(bill.partyName?.value), pan: identifiers.pan ?? "", phone: identifiers.phones[0] ?? "", email: identifiers.emails[0] ?? "",
              address: identifiers.address ?? "",
              accountTypeId: A.partySide === "seller" ? PARTY_SYSTEM_CREDITORS_ID : PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
              extra: [identifiers.contactPerson && `Contact: ${identifiers.contactPerson}`, identifiers.bankAccountNos[0] && `Bank A/c: ${identifiers.bankAccountNos[0]}`, identifiers.regNo && `Reg No: ${identifiers.regNo}`].filter(Boolean).join(" | "),
            }),
          });
          sg.push({ id: "find-party", label: "Pick an existing account instead", value: "search by PAN / phone / email / address / name", deferred: true, apply: () => setFindOpen(true) });
        }
        if (A.date && bill.date && bill.date.status !== "fill" && !Number.isNaN(bill.date.value.getTime())) {
          sg.push({ id: "date", label: "Date", value: bill.date.value.toDateString(), confidence: bill.date.confidence, reason: bill.date.note, apply: () => write(A.date!, bill.date!.value) });
        }
        if (A.dueDate && bill.dueDate && (bill.dueDate.status !== "fill" || !filledRef.current.has(A.dueDate))) {
          sg.push({ id: "due", label: "Due date", value: bill.dueDate.value.toDateString(), confidence: bill.dueDate.confidence, reason: bill.dueDate.note, apply: () => write(A.dueDate!, bill.dueDate!.value) });
        }
        if (A.lineItems && bill.lineItems && bill.lineItems.status !== "fill") {
          const rows = bill.lineItems.value;
          sg.push({
            id: "lines", label: `Line items (${rows.length})`, value: rows.map((r) => `${r.description} ${r.quantity}×${r.rate}=${r.amount}`).join("; "),
            confidence: bill.lineItems.confidence, reason: bill.lineItems.note,
            apply: () => write(A.lineItems!.path, rows.map((r) => ({ ...A.lineItems!.makeEmpty(), type: "item", itemId: r.itemId ?? "", quantity: r.quantity, rate: r.rate, unit: r.itemId ? resolveOcrItemUnit(optsRef.current.items.find((it) => it.id === r.itemId) as never, r.unit, A.partySide === "seller" ? "purchase" : "sale") : r.unit ?? "", amount: r.amount }))),
          });
        }
        if (A.lineItems) {
          (bill.lineItems?.value ?? []).forEach((r, index) => {
            if (r.itemId) return;
            sg.push({
              id: `create-item-${index}`, label: `Create item: ${cleanItemName(r.description)}`,
              value: [cleanItemName(r.description), r.unit, `rate ${r.rate}`].filter(Boolean).join(" | "),
              confidence: 0.8, reason: "No existing item matched. Create opens Auto Create (no form) or Manual Create (prefilled form), then the item is set on line " + (index + 1),
              deferred: true,
              apply: async (ctx) => {
                if (ctx?.mode === "auto") { await itemCreateApiRef.current.auto(index, r); return; }
                await itemCreateApiRef.current.manual(index, r);
              },
            });
          });
          const vat = bill.vat?.value ?? 0;
          // VAT suggestion whenever the bill shows VAT (even if the amount was not confirmed)
          if (vat > 0 || /\bvat\b|मू\.?\s*अ\.?\s*कर/i.test(raw.text)) {
            const vatTax = findVat13(opt.taxes);
            const rowsNow = (F.getValues(A.lineItems.path) as Record<string, unknown>[] | undefined) ?? [];
            const applied = !!vatTax && rowsNow.length > 0 && rowsNow.every((r) => r.taxAccountId === vatTax.id);
            if (!vatTax) {
              sg.push({
                id: "create-vat", label: `Create VAT ${billVatPercent(vat, bill.lineItems?.value?.reduce((a, r) => a + r.amount, 0))}% tax account`, value: vat ? `bill VAT ${vat}` : "VAT printed on bill",
                confidence: bill.vat?.confidence ?? 0.6, reason: "No 13% tax account exists - opens Create Tax prefilled \"VAT 13%\" (set rate 13); you confirm Save, then it is applied to all lines",
                deferred: true,
                apply: () => { setVatPct(billVatPercent(vat, bill.lineItems?.value?.reduce((a, r) => a + r.amount, 0))); setCreateTaxOpen(true); },
              });
            } else if (!applied) {
              sg.push({
                id: "vat", label: `Apply ${vatTax.name ?? "VAT 13%"} on all lines`, value: `VAT ${vat}`, confidence: bill.vat?.confidence ?? 0.6, reason: bill.vat?.status === "fill" ? "Reconciled with totals" : "Totals not reconciled",
                apply: () => {
                  const rows = (F.getValues(A.lineItems!.path) as Record<string, unknown>[] | undefined) ?? [];
                  write(A.lineItems!.path, rows.map((r) => ({ ...r, taxAccountId: vatTax.id })));
                },
              });
            }
          }
          if (A.ledgerAccount && ledgerMissing) {
            sg.push({ id: "create-ledger", label: "Create Purchase account", value: "Purchase A/c", blocked: "No purchase account found - create it from the Purchase Account field (+)", apply: () => undefined });
          }
          if (bill.discount && bill.discount.value > 0 && A.lineItems.discountPath && !filledRef.current.has(A.lineItems.discountPath)) {
            sg.push({ id: "disc", label: "Discount", value: String(bill.discount.value), confidence: bill.discount.confidence, reason: bill.discount.note, apply: () => {
              write(A.lineItems!.discountPath!, bill.discount!.value);
              if (A.lineItems!.discountSignPath) F.setValue(A.lineItems!.discountSignPath, "-" as never, { shouldDirty: true });
            } });
          }
        }
        if (bill.tds) sg.push({ id: "tds", label: "TDS", value: String(bill.tds.value), confidence: bill.tds.confidence, reason: "TDS needs a TDS account + verification", blocked: "Set TDS account on the line manually (hint only, per spec)", apply: () => undefined });
        if (A.amount) {
          const payAmt = paymentAmountFromBill(bill);
          if (payAmt?.mode === "suggest") {
            sg.push({
              id: payAmt.source === "total" ? "amount-total" : "amount",
              label: payAmt.source === "total" ? "Amount (= bill total)" : "Amount",
              value: String(payAmt.value),
              confidence: payAmt.confidence,
              reason: payAmt.note,
              apply: () => write(A.amount!, payAmt.value),
            });
          }
        }
        if (A.narration && bill.billNo && !String(F.getValues(A.narration) ?? "").includes(bill.billNo.value)) {
          sg.push({ id: "billno", label: "Bill No -> narration", value: bill.billNo.value, confidence: bill.billNo.confidence, apply: () => {
            const nStyle = getOcrPrefs().narrationStyle === "short" ? "short" : "full";
            const party = A.party ? opt.parties.find((p) => p.id === F.getValues(A.party!.path)) : undefined;
            const partyName = party?.name ?? bill.partyName?.value ?? "";
            const rawDate = bill.date?.value && !Number.isNaN(bill.date.value.getTime()) ? bill.date.value : A.date ? (F.getValues(A.date) as Date | undefined) : undefined;
            const dateText = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? formatOcrNarrationDate(rawDate, readDateDisplayPrefs()) : "";
            const free = (bill.lineItems?.value ?? []).filter((r) => !r.itemId);
            const itemsText = itemsNarrationTag(free.map((r) => ({ description: r.description, quantity: r.quantity, unit: r.unit, rate: r.rate })));
            const built = buildOcrNarration({ style: nStyle, voucherType: opt.currentVoucherType ?? A.voucherType, billNo: bill.billNo!.value, partyName, dateText, itemsText });
            if (nStyle === "short") write(A.narration!, built);
            else {
              const cur = String(F.getValues(A.narration!) ?? "");
              write(A.narration!, cur ? `${cur} | Bill No: ${bill.billNo!.value} | OCR` : `Bill No: ${bill.billNo!.value} | OCR`);
            }
          } });
        }
        if (A.accountPath && opt.accounts?.length) {
          const text = normalizeName(raw.text);
          const isCash = /\bcash\b|नगद/i.test(raw.text) && !/cheque|chq|bank\s*transfer|fonepay|esewa|khalti/i.test(raw.text);
          const hits = opt.accounts.filter((a) => !a.isDeleted && (() => {
            const n = normalizeName(a.name);
            return n.length >= 4 && text.includes(n);
          })());
          const pick = hits.length === 1 ? hits[0] : isCash ? opt.accounts.find((a) => /^cash/i.test(a.name)) : undefined;
          if (pick && F.getValues(A.accountPath) !== pick.id) {
            sg.push({ id: "account", label: "Bank / cash account", value: pick.name, confidence: hits.length === 1 ? 0.85 : 0.7, reason: hits.length === 1 ? "Account name appears on bill" : "Bill mentions cash payment", apply: () => write(A.accountPath!, pick.id) });
          }
        }
        if (A.voucherType === "journal") sg.push({ id: "drcr", label: "Dr / Cr side", value: "journal lines", blocked: "Journal Dr/Cr lines are never auto-filled (spec) - enter manually", apply: () => undefined });
        setSuggestions(sg);
        if (reason === "refresh") {
          setDoneIds(new Set());
          setDismissedKeys(new Set());
          setDismissedMissingKeys(new Set());
        }
        // Suggestions ticked together with a voucher switch: apply them here (same ids), keep the rest open
        const carry = new Set(reuse?.selectedIds ?? []);
        const carried = sg.filter((x) => carry.has(x.id) && !x.blocked && x.id !== "switch");
        for (const x of carried.filter((c) => !c.deferred)) await x.apply();
        const deferredCarried = carried.filter((c) => c.deferred);
        if (deferredCarried.length) window.setTimeout(() => deferredCarried.forEach((x) => void x.apply()), 300);
        if (!carried.length && sg.some((x) => !x.blocked)) setSugOpen(true);

        // Always in the "Show OCR text" panel (prod too) so live-browser failures can be read; console only in dev.
        const devDump =
          true
            ? [
                `--- OCR build ${OCR_BUILD} | ${raw.engine === "gemini" ? "AI (Gemini) voucher JSON" : raw.engine === "azure" ? "online Azure Read" : raw.engine === "google" ? "online Google Vision" : "engine PSM 6 + sparse 11"} | input ${inputNoteRef.current} ---`,
                `OCR engine: ${raw.engine ?? "tesseract"}${raw.engineNote ? ` (${raw.engineNote})` : ""}`,
                `--- dev dump: input ${inputNoteRef.current} | page ${raw.pageWidth ?? "?"}x${raw.pageHeight}px | ${raw.lines.length} lines ---`,
                ...raw.lines.map((l, i) => `L${i} y=${Math.round(l.y ?? 0)}: ${l.words?.length ? l.words.map((w) => `${w.text}@${Math.round(w.x0)}`).join(" ") : `(no boxes) ${l.text}`}`),
                `--- 2nd pass (sparse) ---`,
                ...(raw.altText ?? "").split(/\r?\n/).filter((t) => t.trim()),
              ]
            : [];
        if (process.env.NODE_ENV !== "production") console.debug("[OCR] dump\n" + [...(bill.debug ?? []), ...devDump].join("\n"));
        setDebugInfo({ text: raw.text, meanConfidence: raw.meanConfidence, reasons: [...(bill.debug ?? []), ...devDump], filled: [...filled], missing: [...new Set(missing)] });
        toast.success(filled.length ? `OCR filled by ${seen.length ? seen[seen.length - 1] : "Offline"}: ${filled.join(", ")}` : "OCR: nothing could be filled safely", { id: tId, duration: 3000, position: "top-right" });

        // Missing fields: arrow bubbles on those fields (stay until OK / X)
        setMissingNow([...new Set(missing)]);

        const partyApplies =
          !!A.party &&
          (() => {
            const pt = A.party!.payeeTypePath ? String(F.getValues(A.party!.payeeTypePath) ?? "") : "";
            return !A.party!.allowedPayeeTypes || !pt || A.party!.allowedPayeeTypes.includes(pt);
          })();
        const partyOk = !A.party || !partyApplies || !!F.getValues(A.party.path);
        void partyApplies;

        if ((reason === "auto" || reason === "handoff") && getOcrPrefs().autoPost && !opt.isEditing && apScheduledForRef.current !== raw) {
          const coreOk =
            A.autoPost &&
            partyOk &&
            (!A.date || filledKeys.has("date")) &&
            (!A.lineItems || filledKeys.has("lines")) &&
            (!A.amount || filledKeys.has("amount")) &&
            (A.requiredPaths ?? []).every((p) => !isEmptyVal(F.getValues(p)));
          if (coreOk) {
            apScheduledForRef.current = raw;
            if (F.getValues("isApproved") !== undefined) F.setValue("isApproved", false as never);
            toast.info("OCR Auto Post: saving as UNAPPROVED…", { duration: 2500 });
            // Pre-OCR path: attachment is appended (compressed) only after OCR -> post once it is in state
            if (reuse?.direct) pendingAutoPostRef.current = true;
            else startAutoPostCountdown();
          } else {
            toast.message("OCR Auto Post skipped", {
              description: A.autoPost ? "Required fields missing - review and save manually." : "This voucher type needs manual review before saving.",
              duration: 5000,
            });
          }
        }
      } catch (e) {
        const aborted = ac.signal.aborted || (e as { name?: string })?.name === "AbortError";
        if (aborted) {
          // Stopped by the user or the voucher was closed: no error toast, no fallback engine.
          toast.dismiss(tId);
        } else {
          // Single-engine mode: show WHY it failed in a dialog (not a 5 s toast the user can miss).
          setOcrFail({ engine: seen.length ? seen[seen.length - 1] : "OCR", message: e instanceof Error ? e.message : String(e) });
          toast.dismiss(tId);
        }
      } finally {
        if (ocrAbortRef.current === ac) ocrAbortRef.current = null;
        setRunning(false);
      }
    },
    [canWrite, write, running, switchVoucher]
  );

  // Voucher-type switch hand-off: receive the attachment, then OCR it here.
  const handoffRunRef = useRef<{ raw?: OcrRawResult; selectedIds?: string[] } | null>(null);
  // Files handed over by a voucher switch; kept briefly so a form's own "new voucher" hydration (setFiles([]) in an effect
  // that runs AFTER this hook's effect) cannot wipe them.
  const handoffFilesRef = useRef<{ files: (File | string)[]; until: number } | null>(null);
  useEffect(() => {
    if (!o.setFiles || o.isEditing) return;
    // only a form of the switch TARGET type takes the parked bill; a remount of this same form gets its session back
    const formType = o.currentVoucherType ?? o.adapter.voucherType;
    const h = takeOcrHandoff(formType) ?? resumeOcrSession(formType);
    if (h?.files.length) {
      handoffRunRef.current = { raw: h.raw, selectedIds: h.selectedIds };
      handoffFilesRef.current = { files: h.files, until: Date.now() + 2500 };
      linkOcrOriginal(h.files[0], h.original ?? null);
      o.setFiles(h.files);
      const setF = o.setFiles;
      window.setTimeout(() => { const g = handoffFilesRef.current; if (g && Date.now() < g.until) setF(g.files); }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Unmount with a bill + OCR result (not saved): park it so an immediate remount of the same form type keeps it
  useEffect(() => () => {
    const opt = optsRef.current;
    const raw = lastRawRef.current;
    if (!raw || !opt.files.length || savedRef.current || opt.isEditing) return;
    if ((opt.form as { formState?: { isSubmitSuccessful?: boolean } } | undefined)?.formState?.isSubmitSuccessful) return;
    parkOcrSession(opt.currentVoucherType ?? opt.adapter.voucherType, { files: [...opt.files], raw, selectedIds: [] });
  }, []);
  useEffect(() => {
    const g = handoffFilesRef.current;
    if (!g) return;
    if (Date.now() > g.until) { handoffFilesRef.current = null; return; }
    if (o.files.length === 0 && o.setFiles) o.setFiles(g.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.files]);
  useEffect(() => {
    if (handoffRunRef.current && o.files.length && visible) {
      const h = handoffRunRef.current;
      handoffRunRef.current = null;
      prevLen.current = o.files.length;
      void (h.raw ? run("handoff", { raw: h.raw, selectedIds: h.selectedIds }) : run("auto"));
    }
  }, [o.files, visible, run]);

  // Auto-trigger: first file added (0 → ≥1) on a new upload, including string refs (local:/pbatt:/https).
  // Also runs once if the first attachment is already present on mount (new voucher only; `visible` excludes edit mode).
  // Skipped when OCR already ran on the original pre-compression.
  const prevLen = useRef(0);
  useEffect(() => {
    const prev = prevLen.current;
    prevLen.current = o.files.length;
    if (!visible || prev !== 0 || o.files.length === 0) return;
    // switch hand-off re-applying its files is not a new upload (the handoff run re-uses the OCR text)
    if (handoffFilesRef.current && Date.now() < handoffFilesRef.current.until) return;
    if (preOcrDoneRef.current) {
      preOcrDoneRef.current = false;
      if (pendingAutoPostRef.current) {
        pendingAutoPostRef.current = false;
        startAutoPostCountdown();
      }
      return;
    }
    void run("auto");
  }, [o.files, visible, run]);

  // OCR-then-compress: while this form is visible, the wrapped attachment helpers ask us to read the ORIGINAL first
  useEffect(() => {
    if (!visible) return;
    return registerPreOcr(async (file: File) => {
      if (optsRef.current.files.length > 0) return; // only the first file of a new upload
      setPreReading(file.name || "bill");
      try {
        await run("auto", { direct: file });
      } finally {
        preOcrDoneRef.current = true;
        setPreReading(null);
      }
    });
  }, [visible, run]);

  // Re-apply newly created party / items / VAT once the master lists include them (the form may clear an unknown id)
  useEffect(() => {
    const pend = pendingRef.current;
    const F = o.form;
    const P = o.adapter.party;
    if (pend.party && P && o.parties.some((p) => p.id === pend.party)) {
      if (F.getValues(P.path) !== pend.party) {
        if (P.payeeTypePath && P.payeeTypeValue) F.setValue(P.payeeTypePath, P.payeeTypeValue as never, { shouldDirty: true });
        F.setValue(P.path, pend.party as never, { shouldDirty: true, shouldValidate: true });
      }
      pend.party = undefined;
    }
    const LI = o.adapter.lineItems;
    if (LI && pend.items.length) {
      pend.items = pend.items.filter(({ index, id }) => {
        if (!o.items.some((it) => it.id === id)) return true;
        const path = `${LI.path}.${index}.itemId`;
        if (F.getValues(path) !== id) F.setValue(path, id as never, { shouldDirty: true });
        // unit like manual item pick (Create Item from OCR -> item just created): keep bill qty/rate/amount
        const it = o.items.find((x) => x.id === id);
        const upath = `${LI.path}.${index}.unit`;
        const unit = resolveOcrItemUnit(it as never, String(F.getValues(upath) ?? ""), o.adapter.partySide === "seller" ? "purchase" : "sale");
        if (unit && F.getValues(upath) !== unit) F.setValue(upath, unit as never, { shouldDirty: true });
        return false;
      });
    }
    if (LI && pend.tax && o.taxes.some((t) => t.id === pend.tax)) {
      const rows = (F.getValues(LI.path) as Record<string, unknown>[] | undefined) ?? [];
      if (rows.some((r) => r.taxAccountId !== pend.tax)) F.setValue(LI.path, rows.map((r) => ({ ...r, taxAccountId: pend.tax })) as never, { shouldDirty: true });
      pend.tax = undefined;
    }
  }, [o.parties, o.items, o.taxes, o.form, o.adapter.party, o.adapter.lineItems]);

  // Remember original (uncompressed) uploads while OCR is on
  useEffect(() => (visible ? installOcrOriginalCapture() : undefined), [visible]);

  // Create Item prefill (name + purchase rate/unit) once the dialog is mounted
  useEffect(() => {
    if (!createItemFor) return;
    const t = window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("prefill-create-item-from-row", {
        // Unit selects in CreateItemDialog only list units present in unitConversions -> seed the base unit row too,
        // otherwise purchase/sale price unit stays blank even though a value was passed.
        detail: { type: "item", preserveGroupId: true, ocrGroups: createItemFor.ocrGroups ?? [], rowPayload: (() => {
          const u = normalizeItemUnitName(createItemFor.unit);
          const isPurchase = optsRef.current.adapter.partySide === "seller";
          const vat = findVat13(optsRef.current.taxes);
          return {
            name: createItemFor.name,
            purchasePrice: isPurchase ? createItemFor.rate : 0,
            salePrice: isPurchase ? 0 : createItemFor.rate,
            purchasePriceUnit: u, salePriceUnit: u, openingBalanceUnit: u,
            groupId: createItemFor.groupId || "",
            purchaseTaxId: isPurchase ? (vat?.id ?? "") : "",
            saleTaxId: isPurchase ? "" : (vat?.id ?? ""),
            ...(u ? { unitConversions: baseUnitConversions(u) } : {}),
          };
        })() },
      }));
    }, 150);
    return () => window.clearTimeout(t);
  }, [createItemFor]);

  // Learn supplier -> purchase ledger when the user picks the account themselves
  useEffect(() => {
    const L = o.adapter.ledgerAccount;
    const P = o.adapter.party;
    if (!L || !P || !o.companyId) return;
    const sub = o.form.watch((vals: Record<string, unknown>, info: { name?: string }) => {
      if (info?.name !== L.path) return;
      const v = String(vals[L.path] ?? "");
      const party = String(vals[P.path] ?? "");
      if (!v || !party || filledRef.current.get(L.path) === v) return;
      learnLedger(o.companyId!, party, v);
    });
    return () => sub.unsubscribe();
  }, [o.form, o.adapter.ledgerAccount, o.adapter.party, o.companyId]);

  const pickParty = useCallback((partyId: string) => {
    setCreatePrefill(null);
    const opt = optsRef.current;
    const P = opt.adapter.party;
    if (!P) return;
    if (P.payeeTypePath && P.payeeTypeValue) write(P.payeeTypePath, P.payeeTypeValue);
    write(P.path, partyId);
    pendingRef.current.party = partyId;
    if (ids && opt.companyId) learnTemplateParty(opt.companyId, ids, partyId);
    const L = opt.adapter.ledgerAccount;
    if (L && opt.companyId) {
      const cur = String(opt.form.getValues(L.path) ?? "");
      const learned = learnedLedger(opt.companyId, partyId);
      if (learned && learned !== cur) write(L.path, learned);
    }
    setFindOpen(false);
    toast.success("OCR: account linked - will be recognised next time");
  }, [ids, write]);

  // Bubbles stay until the field is filled or the user dismisses them (t73u). User-dismissed bubbles never return (except Refresh).

  const formVals = o.form.watch() as Record<string, unknown>;
  const liveBubbles = useMemo(() => {
    const live = resolveOcrBubbles({
      missing: missingNow,
      suggestions: suggestions.map((s) => ({ id: s.id, value: s.value, reason: s.reason })),
      dismissedMissingKeys,
      dismissedSuggestionIds: dismissedKeys,
      doneIds,
      form: snapshotFromForm(formVals, o.adapter),
      bill: lastBill
        ? {
            total: lastBill.total?.value,
            subTotal: lastBill.subTotal?.value,
            vat: lastBill.vat?.value,
            discount: lastBill.discount?.value,
            date: lastBill.date?.value,
            amount: lastBill.amount?.value,
            billNo: lastBill.billNo?.value,
          }
        : null,
      vatTaxId: findVat13(o.taxes)?.id ?? null,
    });
    const keep = new Set(live.suggestions.map((s) => s.id));
    const reasonById = new Map(live.suggestions.map((s) => [s.id, s.reason]));
    return {
      missing: live.missing,
      suggestions: suggestions.filter((s) => keep.has(s.id)).map((s) => {
        const reason = reasonById.get(s.id);
        return reason !== undefined && reason !== s.reason ? { ...s, reason } : s;
      }),
    };
  }, [missingNow, suggestions, dismissedMissingKeys, dismissedKeys, doneIds, formVals, o.adapter, o.taxes, lastBill]);

  const runApply = useCallback(async (list: OcrSuggestion[]) => {
    const sw = list.find((s) => s.id === "switch");
    if (sw) {
      setSugOpen(false);
      await sw.apply({ selectedIds: list.filter((s) => s.id !== "switch").map((s) => s.id) });
      return;
    }
    for (const s of list.filter((x) => !x.deferred)) await s.apply();
    setDoneIds((p) => new Set([...p, ...list.map((x) => x.id)]));
    for (const s of list.filter((x) => x.deferred)) await s.apply();
  }, []);
  // "Apply all" in the OCR bar: every shown, non-blocked suggestion that applies directly (no dialog / voucher switch)
  const tickedList = sugOpen ? liveBubbles.suggestions.filter((s) => !s.blocked && !s.deferred && s.id !== "switch") : [];
  const applyTicked = useCallback(() => void runApply(tickedList), [runApply, tickedList]);

  // target voucher type of a pending "Switch to X voucher" suggestion (drives bubble anchor + tab badge)
  const switchTarget = useMemo(() => {
    const s = liveBubbles.suggestions.find((x) => x.id === "switch");
    if (!s || s.blocked) return null;
    return lastBill?.docType?.type ?? receiptTarget ?? null;
  }, [liveBubbles.suggestions, lastBill, receiptTarget]);
  useOcrTabBadge(visible ? switchTarget : null);

  /* Auto-switch countdown (10 s) on the top "switch" suggestion. One per OCR result (keyed by the suggestions array).
     Cancelled by: Dismiss / X (switchTarget -> null), any other option click, user form edit, Hide, tab change, unmount. */
  const SWITCH_COUNTDOWN_S = clampAutoPostSeconds(prefs.autoSwitchSeconds);
  const autoSwitchOn = prefs.autoSwitchVoucher !== false;
  const [swCount, setSwCount] = useState<number | null>(null);
  const [swCancelledFor, setSwCancelledFor] = useState<unknown>(null);
  const swFiredForRef = useRef<unknown>(null);
  const sugListRef = useRef(suggestions);
  sugListRef.current = suggestions;
  const cancelSwitchCountdown = useCallback(() => { setSwCancelledFor(sugListRef.current); setSwCount(null); }, []);
  useEffect(() => {
    const sw = suggestions.find((x) => x.id === "switch");
    // auto-switch only for a high-confidence type (>= AUTO_SWITCH_MIN_CONF); lower ones stay a manual suggestion
    const swSure = (sw?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF;
    if (!autoSwitchOn || !visible || !sugOpen || !switchTarget || !sw || sw.blocked || !swSure || swCancelledFor === suggestions || swFiredForRef.current === suggestions) {
      setSwCount(null);
      return;
    }
    let n = SWITCH_COUNTDOWN_S;
    setSwCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) { setSwCount(n); return; }
      clearInterval(t);
      setSwCount(null);
      if (swFiredForRef.current === suggestions) return; // never switch twice
      swFiredForRef.current = suggestions;
      void runApply([sw]);
    }, 1000);
    return () => clearInterval(t);
  }, [autoSwitchOn, SWITCH_COUNTDOWN_S, visible, sugOpen, switchTarget, suggestions, swCancelledFor, runApply]);
  // user edits the form (RHF watch: type "change" only for user input, not OCR setValue) -> cancel
  const swActive = swCount != null;
  useEffect(() => {
    if (!swActive) return;
    const sub = optsRef.current.form.watch((_v: unknown, info: { type?: string }) => { if (info?.type === "change") cancelSwitchCountdown(); });
    return () => sub.unsubscribe();
  }, [swActive, cancelSwitchCountdown]);
  // manual tab change inside the same form (e.g. Payment <-> Direct Expense) -> cancel
  const curTabRef = useRef(o.currentVoucherType);
  useEffect(() => {
    if (curTabRef.current !== o.currentVoucherType) { curTabRef.current = o.currentVoucherType; cancelSwitchCountdown(); }
  }, [o.currentVoucherType, cancelSwitchCountdown]);
  const bubbles = useMemo<OcrBubble[]>(() => {
    const out = new Map<string, OcrBubble>();
    for (const m of liveBubbles.missing) {
      const key = ocrFieldForMissing(m);
      const b = out.get(`m:${key}`) ?? { key, kind: "missing" as const, title: "", items: [] };
      b.title = b.title ? `${b.title}, ${m}` : `OCR could not find: ${m}`;
      if (key === "total" && !b.items.length) {
        const t = lastBill?.total;
        if (t && t.value != null && Number.isFinite(t.value)) {
          b.items.push({
            id: "total-compare",
            label: "Bill total",
            value: `Bill total: ${t.value}`,
            confidence: t.confidence,
            reason: t.note || "This form field is calculated from the lines. Compare it with the bill.",
            apply: () => {},
          });
        }
      }
      out.set(`m:${key}`, b);
    }
    if (sugOpen) {
      for (const s of liveBubbles.suggestions) {
        const key = ocrFieldForSuggestion(s.id);
        // One popup per field: a "could not find" note joins the same field's suggestion popup instead of stacking two.
        const miss = out.get(`m:${key}`);
        if (miss) { out.delete(`m:${key}`); }
        const b = out.get(`s:${key}`) ?? { key, kind: "suggest" as const, title: "", items: [], note: miss?.title };
        b.items.push(s);
        out.set(`s:${key}`, b);
      }
      for (const [k, b] of out) {
        if (b.kind !== "suggest") continue;
        const cp = b.items.find((x) => x.id === "create-party");
        const cannot = b.items.find((x) => x.id === "cannot-detect");
        const st = b.items.find((x) => x.id === "status-failed");
        const dup = b.items.find((x) => x.id === "duplicate-ref");
        b.title = cannot
          ? "Cannot detect voucher type"
          : st
            ? "Document status is not SUCCESS"
          : dup
            ? "Possible duplicate voucher"
          : cp
            ? `Party not found — create ${(cp.value.split(" · ")[0] || "this party").trim()}?`
            : b.items.length === 1
              ? `${b.items[0].label}?`
              : `${b.items.length} suggestions for this field`;
        const ci = b.items.find((x) => x.id.startsWith("create-item-"));
        if (b.key === "lines" && ci) b.anchor = `lines#${ci.id.slice("create-item-".length)}`;
        if (b.items.some((x) => x.id === "switch")) {
          b.title = `${b.items.find((x) => x.id === "switch")!.label}? (Added Document looks like a different voucher type)`;
          // anchor to the target voucher-type tab (e.g. Purchase); falls back to the tab row / OCR bar
          if (switchTarget) b.anchor = `voucher-type-${switchTarget}`;
          if (swCount != null) b.countdown = swCount;
        }
        out.set(k, b);
      }
      // a suggestion bubble replaces the missing bubble on the same field
      for (const k of [...out.keys()]) if (k.startsWith("m:") && out.has(`s:${k.slice(2)}`)) out.delete(k);
    }
    return [...out.values()];
  }, [liveBubbles, sugOpen, switchTarget, lastBill, swCount]);

  const panel = useMemo(
    () =>
      visible ? (
        <>
          <OcrFieldBubbles
            bubbles={bubbles}
            onApply={(sg, mode) => {
              if (sg.id !== "switch") cancelSwitchCountdown();
              if (sg.id.startsWith("create-item-") && mode) { void sg.apply({ selectedIds: [], mode }); return; }
              void runApply([sg]);
            }}
            onCreateAllItems={(items) => { cancelSwitchCountdown(); void itemCreateApiRef.current.all(items); }}
            onDismiss={(b) => {
              cancelSwitchCountdown();
              if (b.kind === "missing") setDismissedMissingKeys((p) => new Set([...p, b.key]));
              else setDismissedKeys((p) => new Set([...p, ...b.items.map((x) => x.id)]));
            }}
          />
          {createPrefill ? (
            <CreatePartyDialog
              isOpen
              onOpenChange={(v) => { if (!v) setCreatePrefill(null); }}
              initialValues={createPrefill}
              onPartyCreated={pickParty}
            />
          ) : null}
          {createAccountFor ? (            <CreateBankAccountDialog
              isOpen
              onOpenChange={(v) => { if (!v) setCreateAccountFor(null); }}
              initialPrefill={createAccountFor.prefill}
              contextNote="Opened from OCR: this bank account was on the slip but is not in Bank/Cash yet. Save it, then it goes into the voucher."
              onAccountCreated={(id: string) => {
                const A = optsRef.current.adapter;
                const side = createAccountFor.side;
                const path = side === "to" ? (A.toAccountPath ?? "toAccountId") : A.voucherType === "contra" ? (A.fromAccountPath ?? "fromAccountId") : (A.accountPath ?? "accountId");
                setCreateAccountFor(null);
                if (id) {
                  write(path, id);
                  toast.success(`OCR: ${side === "to" ? "To" : "From"} account linked — will be recognised next time`);
                }
              }}
            />
          ) : null}
          {ocrFail ? (
            <Dialog open onOpenChange={(v) => { if (!v) setOcrFail(null); }}>
              <DialogContent
                overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
                className="!z-[121] max-w-md"
                onFocusOutside={(e) => e.preventDefault()}
              >
                <DialogHeader>
                  <DialogTitle>{ocrFail.engine} could not read this bill</DialogTitle>
                  <DialogDescription>
                    Only {ocrFail.engine} was used because it is the engine you selected. Nothing was filled, so nothing will be saved.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 text-xs">
                  <p className="rounded-md bg-amber-50 px-2 py-1.5 font-mono break-words text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{ocrFail.message}</p>
                  <p className="text-muted-foreground">
                    Fix the reason above and press Refresh OCR. If you want an automatic second engine, pick <b>Auto</b> in OCR settings → Switch Engine.
                  </p>
                </div>
                <div className="flex justify-end gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => setOcrFail(null)}>Close</Button>
                  <Button type="button" size="sm" onClick={() => { setOcrFail(null); void run("refresh"); }}>Refresh OCR</Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
          {createItemFor ? (
            <CreateItemDialog
              isOpen
              onOpenChange={(v) => { if (!v) setCreateItemFor(null); }}
              onItemCreated={(id: string) => {
                const A = optsRef.current.adapter.lineItems;
                const idx = createItemFor.index;
                setCreateItemFor(null);
                if (A && id) {
                  write(`${A.path}.${idx}.itemId`, id);
                  pendingRef.current.items.push({ index: idx, id });
                  toast.success(`OCR: item set on line ${idx + 1}`);
                }
              }}
            />
          ) : null}
          <CreateTaxDialog            isOpen={createTaxOpen}
            onOpenChange={setCreateTaxOpen}
            prefillTaxName={`VAT ${vatPct}%`}
            prefillTaxRate={vatPct}
            onTaxCreated={(id: string) => {
              setCreateTaxOpen(false);
              const A = optsRef.current.adapter.lineItems;
              if (!A || !id) return;
              const rows = (optsRef.current.form.getValues(A.path) as Record<string, unknown>[] | undefined) ?? [];
              write(A.path, rows.map((r) => ({ ...r, taxAccountId: id })));
              pendingRef.current.tax = id;
              toast.success("OCR: VAT applied on all lines");
            }}
          />
          {ids && o.adapter.party ? (
        <OcrFindAccountDialog
          open={findOpen}
          onOpenChange={setFindOpen}
          identifiers={ids}
          billPartyName={lastBill?.partyName?.value}
          parties={o.parties}
          onPick={pickParty}
          onCreateNew={(prefill) => { setFindOpen(false); setCreatePrefill({ ...prefill, accountTypeId: o.adapter.partySide === "seller" ? PARTY_SYSTEM_CREDITORS_ID : PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID }); }}
        />
          ) : null}
        </>
      ) : null,
    [visible, ids, findOpen, lastBill, o.parties, o.adapter.party, pickParty, bubbles, runApply, createPrefill, createItemFor, createTaxOpen, write]
  );

  // AI chat (OCR bar): current bill / last AI JSON / own company, read on demand (refs, no re-render)
  const getBillForChat = useCallback(() => {
    const f = optsRef.current.files[0];
    return f ? loadFirstFile(f, optsRef.current.companyId) : Promise.resolve(null);
  }, []);
  const getAiVoucherJson = useCallback(() => lastRawRef.current?.ai?.data ?? null, []);
  const getOwnCompany = useCallback(() => ({ name: ownRef.current.name, pan: ownRef.current.pan }), []);

  useEffect(() => { if (!visible) cancelAutoPostCountdown(); }, [visible, cancelAutoPostCountdown]);

  return {
    visible,
    running,
    hasFile: o.files.length > 0,
    /** Original being read before compression (file not attached yet). */
    preReading,
    refresh: () => void run("refresh"),
    openFindAccount: () => setFindOpen(true),
    debugInfo,
    /** Which engine produced the current file's text (Refresh bar "Read by" badge). */
    readBy,
    /** = number of suggestion BUBBLES (suggestions merged per field, e.g. Create party + Pick existing = 1). */
    suggestionsCount: new Set(liveBubbles.suggestions.filter((x) => !x.blocked).map((x) => ocrFieldForSuggestion(x.id))).size,
    /** OCR bar "Suggestions (n)": toggles all bubbles show / hide. */
    openSuggestions: () => {
      if (sugOpen) setSugOpen(false);
      else setSugOpen(true);
    },
    suggestionsShown: sugOpen,
    tickedCount: tickedList.length,
    applyTicked,
    canFindAccount: !!ids && !!o.adapter.party,
    panel: (
      <>
        {panel}
        {visible && apCount != null ? <AutoPostCountdownBubble seconds={apCount} onCancel={() => { cancelAutoPostCountdown(); toast.message("Auto save cancelled"); }} /> : null}
      </>
    ),
    /** Auto Post countdown seconds left (null = not running). */
    autoPostCountdown: apCount,
    cancelAutoPostCountdown,
    /** AI chat / teaching (OCR bar button). */
    companyId: o.companyId ?? null,
    aiDocType: aiDocTypeForVoucher(o.currentVoucherType ?? null, o.adapter.partySide),
    getBillForChat,
    getAiVoucherJson,
    getOwnCompany,
  };
}

export type VoucherOcrApi = ReturnType<typeof useVoucherOcr>;
