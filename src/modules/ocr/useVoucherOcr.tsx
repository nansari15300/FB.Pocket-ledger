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
import { parseBill } from "./parser";
import { extractIdentifiers, type OcrIdentifiers } from "./identifiers";
import { learnTemplateParty, lookupTemplateParty } from "./templates";
import { clampAutoPostSeconds, getOcrPrefs, useOcrPrefs } from "./prefs";
import { AutoPostCountdownBubble } from "./AutoPostCountdownBubble";
import { useOcrPlanAllowed } from "./gate";
import { OcrFindAccountDialog } from "./OcrFindAccountDialog";
import type { OcrSuggestion } from "./OcrSuggestionsDialog";
import { OcrFieldBubbles, ocrFieldForMissing, ocrFieldForSuggestion, useOcrTabBadge, type OcrBubble } from "./OcrFieldBubbles";
import { requestOcrVoucherSwitch, sameVoucherBucket, takeOcrHandoff } from "./handoff";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, PARTY_SYSTEM_CREDITORS_ID } from "@/lib/partySystemGroups";
import { installOcrOriginalCapture, linkOcrOriginal, takeOcrOriginal } from "./ocrOriginals";
import { registerPreOcr } from "./ocrOriginals";
import type { OcrRawResult } from "./types";
import { isOcrSelectableParty } from "./types";
import { resolveOcrItemUnit } from "./extras";
import { billVatPercent, cleanItemName, partyNamePrefill, findVat13, isOwnCompany, otherPans, pickLedgerAccount } from "./extras";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { detectReceipt, type ReceiptDetection } from "@/lib/ocr/receiptDetect";
import { accountDisplayLabel, buildPaymentOutFill, pickChargeAccount, receiptNarration } from "@/lib/ocr/receiptDetect/fillPaymentOut";
import { normalizeName } from "./normalize";
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
  /** Actual open tab when one form serves two types (Payment In/Direct Income, Payment Out/Direct Expense). */
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

async function loadFirstFile(f: File | string): Promise<{ blob: Blob; mime: string } | null> {
  if (typeof f !== "string") return { blob: f, mime: f.type };
  try {
    const r = await fetch(f);
    if (!r.ok) return null;
    const blob = await r.blob();
    return { blob, mime: blob.type || (/\.pdf(\?|$)/i.test(f) ? "application/pdf" : "image/jpeg") };
  } catch {
    return null;
  }
}

/** Bump when parser/engine logic changes: shown in Show OCR text to prove the browser runs the new bundle. */
export const OCR_BUILD = "2026-10-21.5";

export function useVoucherOcr(o: UseVoucherOcrOptions) {
  const planAllowed = useOcrPlanAllowed();
  // Own company straight from the company profile (not only form props) - hard guard against offering ourselves as party
  const { company: profileCompany } = useCompany();
  const ownRef = useRef<{ name: string | null; pan: string | null }>({ name: null, pan: null });
  // Bank-receipt masters (local in-memory context, no Firestore read): own Bank/Cash, parties, staff
  const { processedAccounts: vAccounts, processedParties: vParties, processedStaff: vStaff, processedExpenseAccounts: vExp } = useVouchers();
  const mastersRef = useRef({ accounts: vAccounts, parties: vParties, staff: vStaff, expense: vExp });
  mastersRef.current = { accounts: vAccounts, parties: vParties, staff: vStaff, expense: vExp };
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
  const [lastBill, setLastBill] = useState<OcrParsedBill | null>(null);
  const [debugInfo, setDebugInfo] = useState<{ text: string; meanConfidence: number; reasons: string[]; filled: string[]; missing: string[] } | null>(null);
  const [suggestions, setSuggestions] = useState<OcrSuggestion[]>([]);
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null);
  const [sugOpen, setSugOpen] = useState(false); // field bubbles shown
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const [missingNow, setMissingNow] = useState<string[]>([]);
  const [createPrefill, setCreatePrefill] = useState<Record<string, string> | null>(null);
  const [createItemFor, setCreateItemFor] = useState<{ index: number; name: string; unit?: string; rate: number } | null>(null);
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
      optsRef.current.autoPost();
    }, 1000);
  }, []);
  useEffect(() => () => { if (apTimerRef.current != null) window.clearInterval(apTimerRef.current); }, []);
  const apPrefOn = useOcrPrefs().autoPost;
  useEffect(() => { if (!apPrefOn) cancelAutoPostCountdown(); }, [apPrefOn, cancelAutoPostCountdown]);
  const [preReading, setPreReading] = useState<string | null>(null);
  const lastRawRef = useRef<OcrRawResult | null>(null);
  const inputNoteRef = useRef("handoff (no OCR)");
  const optsRef = useRef(o);
  optsRef.current = o;

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

  const run = useCallback(
    async (reason: "auto" | "refresh" | "handoff", reuse?: { raw?: OcrRawResult; selectedIds?: string[]; direct?: File }) => {
      const opt = optsRef.current;
      // direct = ORIGINAL picked file, OCR runs BEFORE compression/append (see ocrOriginals pre-OCR gate)
      const first = reuse?.direct ?? opt.files[0];
      if (!first || running) return;
      setRunning(true);
      const tId = toast.loading(reason === "refresh" ? "OCR: re-reading bill…" : reason === "handoff" ? "OCR: filling from the bill already read…" : "OCR: reading bill…");
      try {
        // Prefer the ORIGINAL full-resolution upload (attachment state holds the compressed copy)
        let raw: OcrRawResult;
        if (reuse?.raw) {
          raw = reuse.raw; // voucher-type switch: no second OCR, re-parse the same text for this form
        } else {
          const orig = takeOcrOriginal(first);
          const src = orig ? { blob: orig as Blob, mime: orig.type } : await loadFirstFile(first);
          if (!src) throw new Error("Attachment could not be read for OCR");
          inputNoteRef.current = `${orig ? "ORIGINAL upload" : "stored attachment (compressed)"} ${src.mime} ${(src.blob.size / 1024).toFixed(0)} KB`;
          if (process.env.NODE_ENV !== "production") {
            console.info(`[OCR] input: ${orig ? "ORIGINAL upload" : "stored attachment (compressed)"} ${src.mime} ${(src.blob.size / 1024).toFixed(0)} KB`);
          }
          raw = await runOcrOnFile(src.blob, src.mime);
        }
        lastRawRef.current = raw;
        if (raw.meanConfidence < 55) {
          setDebugInfo({ text: raw.text, meanConfidence: raw.meanConfidence, reasons: ["Average confidence below 55% - nothing filled"], filled: [], missing: [] });
          toast.error("OCR: image is not clear", { id: tId, description: "Nothing was filled. Retake a sharper, well-lit photo.", duration: 5000, position: "top-right" });
          return;
        }
        const own = ownRef.current;
        /* ---------- Bank receipt (connectIPS etc.): detect + suggest voucher type only; no field filling yet ---------- */
        {
          const M = mastersRef.current;
          const rc: ReceiptDetection = detectReceipt(`${raw.text}\n${raw.altText ?? ""}`, {
            ownAccounts: (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType })),
            parties: (M.parties ?? []).filter((p) => !(p as { isDeleted?: boolean }).isDeleted).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName })),
            staff: (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") })),
            companyName: own.name ?? undefined,
          });
          if (rc.format) {
            const cur = opt.currentVoucherType ?? opt.adapter.voucherType;
            const types: string[] = rc.voucherType ? [rc.voucherType] : rc.candidates;
            const m = rc.master;
            const masterTxt = m.kind ? `${m.kind === "own_bank" ? "own bank" : m.kind}: ${m.name ?? "-"} (${Math.round(m.score * 100)}%)` : "no master matched";
            const why = `${rc.format} receipt; ${rc.reason}; ${masterTxt}${rc.payeeType === "staff" ? "; payee type Staff" : ""}`;
            /* Payment Out tab only (not Direct Expense): fill payee / from-account / amount / charge / date / narration */
            const rFilled: string[] = [];
            const rMissing: string[] = [];
            const rExtra: OcrSuggestion[] = [];
            if (rc.parsed && opt.adapter.voucherType === "payment_out" && cur === "payment_out") {
              const F = opt.form;
              const pf = buildPaymentOutFill(rc.parsed, {
                ownAccounts: (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType })),
                parties: (M.parties ?? []).filter((p) => isOcrSelectableParty(p as never)).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName })),
                staff: (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") })),
                taxes: (opt.taxes ?? []).map((t) => ({ id: t.id, name: String(t.name ?? "") })),
              });
              const idPath = { party: "partyId", staff: "staffId", tax: "taxAccountId" } as const;
              if (pf.payee) {
                const path = idPath[pf.payee.payeeType];
                if (canWrite(path) && canWrite("payeeType")) {
                  if (F.getValues("payeeType") !== pf.payee.payeeType) write("payeeType", pf.payee.payeeType);
                  write(path, pf.payee.id);
                  rFilled.push(`Payee (${pf.payee.payeeType}: ${pf.payee.name})`);
                }
              } else {
                rMissing.push("Party / payee");
                if (pf.payeeName) {
                  const nm = pf.payeeName;
                  const bn = rc.parsed.beneficiary;
                  rExtra.push({
                    id: "create-party", label: "Create new party", value: nm, confidence: 0.8,
                    reason: `Beneficiary "${nm}" matches no party / staff / tax payee - opens Create Party prefilled; you confirm Save`, deferred: true,
                    apply: () => setCreatePrefill({ ...partyNamePrefill(nm), pan: "", phone: "", email: "", address: "", accountTypeId: PARTY_SYSTEM_CREDITORS_ID, extra: [bn.accountMasked && `Bank A/c: ${bn.accountMasked}`, bn.bankName, bn.branch].filter(Boolean).join(" | ") }),
                  });
                  rExtra.push({ id: "find-party", label: "Pick an existing account instead", value: "search by name", deferred: true, apply: () => setFindOpen(true) });
                }
              }
              if (pf.from.ok) {
                if (canWrite("accountId")) { write("accountId", pf.from.id); rFilled.push(`From: ${pf.from.name}`); }
              } else rMissing.push(`Bank / cash account (${pf.from.reason})`);
              /* Party row amount = `payeeAmount`; form derives top `amount` (Amount Paid) = payeeAmount + charge. */
              if (pf.amount && canWrite("payeeAmount")) { write("payeeAmount", pf.amount); rFilled.push(`Amount ${pf.amount}`); }
              if (pf.amount && canWrite("amount")) write("amount", pf.amount + (pf.charge ?? 0));
              if (pf.date && canWrite("date")) { write("date", pf.date); rFilled.push("Date"); }
              if (pf.charge) {
                if (canWrite("otherChargeAmount")) { write("otherChargeAmount", pf.charge); rFilled.push(`Charge ${pf.charge}`); }
                {
                  let defId: string | null = null;
                  try { defId = localStorage.getItem(`pocket-ledger:payment-out:other-charge-default:${opt.companyId || "global"}`); } catch { /* ignore */ }
                  const cands = [
                    ...(M.expense ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted).map((e) => ({ id: e.id, name: String((e as { name?: string }).name ?? ""), kind: "expense" as const })),
                    ...(M.parties ?? []).filter((p) => isOcrSelectableParty(p as never)).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), kind: "party" as const })),
                    ...(M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? ""), kind: "staff" as const })),
                  ];
                  const ch = pickChargeAccount(cands, { bankName: rc.parsed.sender?.bankName, defaultId: defId });
                  const curCh = String(F.getValues("otherChargeAccountId") ?? "");
                  if (ch && (!curCh || (ch.method === "detected" && canWrite("otherChargeAccountId")))) {
                    if (curCh !== ch.id) write("otherChargeAccountId", ch.id);
                    rFilled.push(`Charge account (${ch.method}: ${ch.name})`);
                  } else if (!ch && !curCh) rMissing.push("Other charge account (bank charge)");
                }
              }
              /* Narration uses the account actually selected in From Bank/Cash (OCR match or user pick). */
              {
                const selId = String(F.getValues("accountId") ?? "");
                const sel = (M.accounts ?? []).find((a) => a.id === selId);
                pf.narration = receiptNarration(rc.parsed, sel ? accountDisplayLabel(sel as never) : null);
              }
              if (pf.narration) {
                const curN = String(F.getValues("narration") ?? "");
                if (!curN || canWrite("narration")) { write("narration", pf.narration); rFilled.push("Narration"); }
                else if (rc.parsed.txnId && !curN.includes(rc.parsed.txnId)) { write("narration", `${curN} | ${pf.narration}`); rFilled.push("Narration (appended)"); }
              }
            }
            const sg: OcrSuggestion[] = [...rExtra, ...types.filter((t) => t !== cur).map((t, i) => ({
              id: i === 0 ? "switch" : `switch-${t}`, label: `Switch to ${niceType(t)} voucher${rc.voucherType ? "" : i === 0 ? " (likely)" : " (alternative)"}`,
              value: `from: ${niceType(cur)}`, confidence: rc.voucherType ? rc.typeConfidence : Math.max(0.3, rc.typeConfidence - i * 0.1), reason: why,
              blocked: !OCR_SWITCHABLE.includes(t) ? "This voucher type cannot be opened from OCR" : opt.isEditing ? "Only for new vouchers" : undefined,
              deferred: true,
              apply: () => requestOcrVoucherSwitch(t, optsRef.current.files, { raw, original: takeOcrOriginal(optsRef.current.files[0]), selectedIds: [] }),
            }))];
            setLastBill(null);
            setReceiptTarget(sg[0] && !sg[0].blocked ? types.filter((t) => t !== cur)[0] ?? null : null);
            setSuggestions(sg);
            if (reason === "refresh") { setDoneIds(new Set()); setDismissedKeys(new Set()); }
            if (sg.some((x) => !x.blocked)) setSugOpen(true);
            setMissingNow(rMissing);
            setDebugInfo({
              text: [`--- OCR build ${OCR_BUILD} | bank receipt: ${rc.format} (${Math.round(rc.confidence * 100)}%) ---`, `Type: ${rc.voucherType ?? `undecided (${rc.candidates.join(" / ")})`}`, why, rc.narration ? `Narration (not filled yet): ${rc.narration}` : "", rc.otherCharge ? `Charge: ${rc.otherCharge.amount}` : "", "--- OCR text ---", raw.text].filter(Boolean).join("\n"),
              meanConfidence: raw.meanConfidence, reasons: [why], filled: rFilled, missing: rMissing,
            });
            const here = types.includes(cur);
            toast.success(`OCR: ${rc.format === "connectips" ? "connectIPS" : rc.format} receipt detected`, {
              id: tId, duration: 6000, position: "top-right",
              description: rFilled.length || rMissing.length
                ? `Filled: ${rFilled.join(", ") || "nothing"}${rMissing.length ? ` | Missing: ${rMissing.map((x) => x.split(" (")[0]).join(", ")}` : ""}`
                : here && types.length === 1 ? `${niceType(cur)} is the right voucher. Fields are not auto-filled for this voucher type yet.` : `Suggested: ${types.map(niceType).join(" / ")}. Fields are not auto-filled yet.`,
            });
            /* Auto Post for bank receipts (direct attach OR after a voucher-type switch hand-off): only when this tab was filled
               (Payment Out), nothing is missing, and no other voucher type is suggested. Once per OCR read. */
            if ((reason === "auto" || reason === "handoff") && getOcrPrefs().autoPost && !opt.isEditing && opt.adapter.autoPost && apScheduledForRef.current !== raw) {
              const F = opt.form;
              const ok =
                rFilled.length > 0 &&
                rMissing.length === 0 &&
                !sg.some((x) => (x.id === "switch" || x.id.startsWith("switch-")) && !x.blocked) &&
                (opt.adapter.requiredPaths ?? []).every((pth) => !isEmptyVal(F.getValues(pth)));
              if (ok) {
                apScheduledForRef.current = raw;
                if (F.getValues("isApproved") !== undefined) F.setValue("isApproved", false as never);
                toast.info("OCR Auto Post: saving as UNAPPROVED", { duration: 2500 });
                if (reuse?.direct) pendingAutoPostRef.current = true;
                else startAutoPostCountdown();
              } else {
                toast.message("OCR Auto Post skipped", { description: "Required fields missing - review and save manually.", duration: 5000 });
              }
            }
            return;
          }
        }
        const bill = parseBill(raw, { kind: opt.adapter.partySide === "seller" ? "purchase" : "sale", parties: opt.parties, items: opt.items, ownPan: own.pan, ownName: own.name });
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
                // Free-form rows (no matching item): keep the bill description in narration
                const free = bill.lineItems.value.filter((r) => !r.itemId);
                if (free.length && A.narration) {
                  const cur = String(F.getValues(A.narration) ?? "");
                  const tag = `Items: ${free.map((r) => `${r.description} ${r.quantity}${r.unit ? " " + r.unit : ""} x ${r.rate}`).join("; ")}`;
                  if (!cur.includes(tag)) write(A.narration, cur ? `${cur} | ${tag}` : tag);
                }
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

        // Single amount (payments / contra / adjustment)
        if (A.amount) {
          if (bill.amount?.status === "fill") {
            if (canWrite(A.amount)) write(A.amount, bill.amount.value);
            markFill("Amount", "amount");
          } else missing.push(bill.amount ? `Amount (${bill.amount.note ?? "not confirmed"})` : "Amount");
        }

        // Narration: append only (never replace)
        if (A.narration) {
          if (bill.billNo?.status === "fill") {
            const cur = String(F.getValues(A.narration) ?? "");
            if (!cur.includes(`Bill No: ${bill.billNo.value}`)) {
              const party = A.party ? opt.parties.find((p) => p.id === F.getValues(A.party!.path)) : undefined;
              const tag = [`Bill No: ${bill.billNo.value}`, party?.name ?? bill.partyName?.value, "OCR"].filter(Boolean).join(" | ");
              write(A.narration, cur ? `${cur} | ${tag}` : tag);
              filled.push("Bill No → narration");
            }
          } else missing.push("Bill No");
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
            apply: (ctx) => requestOcrVoucherSwitch(dt, optsRef.current.files, { raw, original: takeOcrOriginal(optsRef.current.files[0]), selectedIds: ctx?.selectedIds ?? [] }),
          });
        }
        const billIsOwn = isOwnCompany(bill.partyName?.value, identifiers.pan, own);
        if (billIsOwn) bill.debug?.push("Create party skipped: extracted name/PAN is our own company");
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
              value: [r.description, r.unit, `rate ${r.rate}`].filter(Boolean).join(" · "),
              confidence: 0.8, reason: "No existing item matched - opens Create Item prefilled (name, purchase rate, unit); you confirm Save, then it is set on line " + (index + 1),
              deferred: true,
              apply: () => setCreateItemFor({ index, name: cleanItemName(r.description), unit: r.unit, rate: r.rate }),
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
        if (A.amount && bill.amount && bill.amount.status !== "fill") {
          sg.push({ id: "amount", label: "Amount", value: String(bill.amount.value), confidence: bill.amount.confidence, reason: bill.amount.note, apply: () => write(A.amount!, bill.amount!.value) });
        } else if (A.amount && !bill.amount && bill.total) {
          sg.push({ id: "amount-total", label: "Amount (= bill total)", value: String(bill.total.value), confidence: bill.total.confidence, reason: bill.total.note, apply: () => write(A.amount!, bill.total!.value) });
        }
        if (A.narration && bill.billNo && !String(F.getValues(A.narration) ?? "").includes(bill.billNo.value)) {
          sg.push({ id: "billno", label: "Bill No → narration", value: bill.billNo.value, confidence: bill.billNo.confidence, apply: () => {
            const cur = String(F.getValues(A.narration!) ?? "");
            write(A.narration!, cur ? `${cur} | Bill No: ${bill.billNo!.value} | OCR` : `Bill No: ${bill.billNo!.value} | OCR`);
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
                `--- OCR build ${OCR_BUILD} | engine PSM 6 + sparse 11 | input ${inputNoteRef.current} ---`,
                `--- dev dump: input ${inputNoteRef.current} | page ${raw.pageWidth ?? "?"}x${raw.pageHeight}px | ${raw.lines.length} lines ---`,
                ...raw.lines.map((l, i) => `L${i} y=${Math.round(l.y ?? 0)}: ${(l.words ?? []).map((w) => `${w.text}@${Math.round(w.x0)}`).join(" ")}`),
                `--- 2nd pass (sparse) ---`,
                ...(raw.altText ?? "").split(/\r?\n/).filter((t) => t.trim()),
              ]
            : [];
        if (process.env.NODE_ENV !== "production") console.debug("[OCR] dump\n" + [...(bill.debug ?? []), ...devDump].join("\n"));
        setDebugInfo({ text: raw.text, meanConfidence: raw.meanConfidence, reasons: [...(bill.debug ?? []), ...devDump], filled: [...filled], missing: [...new Set(missing)] });
        toast.success(filled.length ? `OCR filled: ${filled.join(", ")}` : "OCR: nothing could be filled safely", { id: tId, duration: 3000, position: "top-right" });

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
        toast.error("OCR failed", { id: tId, description: e instanceof Error ? e.message : String(e), duration: 5000, position: "top-right" });
      } finally {
        setRunning(false);
      }
    },
    [canWrite, write, running]
  );

  // Voucher-type switch hand-off: receive the attachment, then OCR it here.
  const handoffRunRef = useRef<{ raw?: OcrRawResult; selectedIds?: string[] } | null>(null);
  // Files handed over by a voucher switch; kept briefly so a form's own "new voucher" hydration (setFiles([]) in an effect
  // that runs AFTER this hook's effect) cannot wipe them.
  const handoffFilesRef = useRef<{ files: (File | string)[]; until: number } | null>(null);
  useEffect(() => {
    const h = takeOcrHandoff();
    if (h?.files.length && o.setFiles) {
      handoffRunRef.current = { raw: h.raw, selectedIds: h.selectedIds };
      handoffFilesRef.current = { files: h.files, until: Date.now() + 2500 };
      linkOcrOriginal(h.files[0], h.original ?? null);
      o.setFiles(h.files);
      const setF = o.setFiles;
      window.setTimeout(() => { const g = handoffFilesRef.current; if (g && Date.now() < g.until) setF(g.files); }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Auto-trigger: first file added (0 → ≥1) on a new upload (skipped when OCR already ran on the original pre-compression)
  const prevLen = useRef(o.files.length);
  useEffect(() => {
    const prev = prevLen.current;
    prevLen.current = o.files.length;
    if (!visible || prev !== 0 || o.files.length === 0) return;
    if (typeof o.files[0] === "string") return;
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
        detail: { type: "item", rowPayload: (() => {
          const raw = String(createItemFor.unit ?? "").trim();
          const u = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
          return {
            name: createItemFor.name, purchasePrice: createItemFor.rate,
            purchasePriceUnit: u, salePriceUnit: u, openingBalanceUnit: u,
            ...(u ? { unitConversions: [{ fromUnit: u, toUnit: "", conversionFactor: 1 }] } : {}),
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

  // No auto-hide (user decision): missing-field bubbles stay until OK / X; suggestion bubbles until an option / Dismiss / X / Hide.

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
  const tickedList = sugOpen ? suggestions.filter((s) => !s.blocked && !s.deferred && s.id !== "switch" && !doneIds.has(s.id) && !dismissedKeys.has(s.id)) : [];
  const applyTicked = useCallback(() => void runApply(tickedList), [runApply, tickedList]);

  // target voucher type of a pending "Switch to X voucher" suggestion (drives bubble anchor + tab badge)
  const switchTarget = useMemo(() => {
    const s = suggestions.find((x) => x.id === "switch");
    if (!s || s.blocked || doneIds.has("switch") || dismissedKeys.has("switch")) return null;
    return lastBill?.docType?.type ?? receiptTarget ?? null;
  }, [suggestions, doneIds, dismissedKeys, lastBill, receiptTarget]);
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
    if (!autoSwitchOn || !visible || !sugOpen || !switchTarget || !sw || sw.blocked || swCancelledFor === suggestions || swFiredForRef.current === suggestions) {
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
  // manual tab change inside the same form (e.g. Payment Out <-> Direct Expense) -> cancel
  const curTabRef = useRef(o.currentVoucherType);
  useEffect(() => {
    if (curTabRef.current !== o.currentVoucherType) { curTabRef.current = o.currentVoucherType; cancelSwitchCountdown(); }
  }, [o.currentVoucherType, cancelSwitchCountdown]);
  const bubbles = useMemo<OcrBubble[]>(() => {
    const out = new Map<string, OcrBubble>();
    for (const m of missingNow) {
      const key = ocrFieldForMissing(m);
      const b = out.get(`m:${key}`) ?? { key, kind: "missing" as const, title: "", items: [] };
      b.title = b.title ? `${b.title}, ${m}` : `OCR could not find: ${m}`;
      out.set(`m:${key}`, b);
    }
    if (sugOpen) {
      for (const s of suggestions) {
        if (doneIds.has(s.id)) continue;
        if (dismissedKeys.has(s.id)) continue; // per-suggestion-id dismiss (X / Dismiss closes only that bubble)
        const key = ocrFieldForSuggestion(s.id);
        const b = out.get(`s:${key}`) ?? { key, kind: "suggest" as const, title: "", items: [] };
        b.items.push(s);
        out.set(`s:${key}`, b);
      }
      for (const [k, b] of out) {
        if (b.kind !== "suggest") continue;
        const cp = b.items.find((x) => x.id === "create-party");
        b.title = cp
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
  }, [missingNow, sugOpen, suggestions, doneIds, dismissedKeys, switchTarget, lastBill, swCount]);

  const panel = useMemo(
    () =>
      visible ? (
        <>
          <OcrFieldBubbles
            bubbles={bubbles}
            onApply={(sg) => { if (sg.id !== "switch") cancelSwitchCountdown(); void runApply([sg]); }}
            onDismiss={(b) => {
              cancelSwitchCountdown();
              if (b.kind === "missing") setMissingNow((p) => p.filter((m) => ocrFieldForMissing(m) !== b.key));
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
          <CreateTaxDialog
            isOpen={createTaxOpen}
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
    /** = number of suggestion BUBBLES (suggestions merged per field, e.g. Create party + Pick existing = 1). */
    suggestionsCount: new Set(suggestions.filter((x) => !x.blocked && !doneIds.has(x.id) && !dismissedKeys.has(x.id)).map((x) => ocrFieldForSuggestion(x.id))).size,
    /** OCR bar "Suggestions (n)": toggles all bubbles show / hide. */
    openSuggestions: () => {
      if (sugOpen) setSugOpen(false);
      else { setDismissedKeys(new Set()); setSugOpen(true); }
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
  };
}

export type VoucherOcrApi = ReturnType<typeof useVoucherOcr>;
