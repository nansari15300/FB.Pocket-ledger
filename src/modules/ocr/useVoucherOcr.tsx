"use client";
/**
 * useVoucherOcr — wires online OCR providers and Gemini into ANY voucher form via a per-type adapter (see adapters.ts).
 * - File attachment does not trigger OCR; the user starts a scan with Refresh OCR, or Gallery hands off a runner scan.
 * - Fills only validated ("fill") fields; never touches approval fields.
 * - Refresh: re-runs on the first attachment; keeps user-edited fields unless "Overwrite edited" is on.
 * - Auto Post: saves via the form's own submit with `ocrAutoPost` (form forces isApproved=false).
 */
import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { OcrRunError, runOcrOnFile } from "./engine";
import { aiDocTypeForVoucher } from "./ai/aiChatModel";
import { parseBill } from "./parser";
import { extractIdentifiers, type OcrIdentifiers } from "./identifiers";
import { learnTemplateParty, lookupTemplateParty } from "./templates";
import { clampAutoPostSeconds, getOcrPrefs, setOcrPrefs, useOcrPrefs } from "./prefs";
import { ensureManualOcrProfile, resolveVoucherAutoPost, useManualOcrProfile } from "./manualProfile";
import { buildOcrNarration, formatOcrNarrationDate, itemsNarrationTag, readDateDisplayPrefs } from "./narration";
import { AutoPostCountdownBubble } from "./AutoPostCountdownBubble";
import { useOcrPlanAllowed } from "./gate";
import { OcrFindAccountDialog } from "./OcrFindAccountDialog";
import type { OcrSuggestion } from "./OcrSuggestionsDialog";
import { OcrFieldBubbles, ocrFieldForMissing, ocrFieldForSuggestion, useOcrTabBadge, type OcrBubble } from "./OcrFieldBubbles";
import { cancelOcrHandoff, OCR_MANUAL_SWITCH_EVENT, parkOcrSession, queueOcrHandoff, requestOcrVoucherSwitch, resumeOcrSession, sameVoucherBucket, setRunnerDuplicateCheckOff, takeOcrHandoff, carriedValueWrites, collectOcrUserValues, type OcrCarriedValues } from "./handoff";
import { aiAmountCheck } from "./ai/aiVoucher";
import { getOcrOwnAliases } from "./ownAliases";
import { defaultDueDaysFor, partyCreditDaysOf, resolveOcrDueDate } from "./dueDate";
import { mapAiJournalLines } from "./journalLines";
import { fmtOcr, ocrRunStrings, type OcrFailKind } from "./ocrRunStrings";
import { markAiModelAvailable, markAiModelUnavailable, unavailableAiModels } from "./ai/aiModelAvailability";
import { readAutoPostDuplicateAction } from "./autoPostDuplicatePolicy";
import { loadOcrEngineOptions } from "./engineChoices";
import { ocrMissingFieldKeys } from "./missingFieldKeys";
import { findDuplicateVoucher, type CandidateVoucher, type DuplicateMatch } from "@/lib/voucherDuplicateGuard";
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
import { Combobox } from "@/components/ui/combobox";
import { PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, PARTY_SYSTEM_CREDITORS_ID } from "@/lib/partySystemGroups";
import { installOcrOriginalCapture, linkOcrOriginal, takeOcrOriginal } from "./ocrOriginals";
import type { OcrRawResult } from "./types";
import { isOcrSelectableParty } from "./types";
import { resolveOcrItemUnit } from "./extras";
import { inferItemGroupFromName } from "./extras";
import { findOrCreateSheetSizeItemGroups, mergeMasterGroups, type MasterGroupLike } from "@/lib/masterEntityGroupWrite";
import { billVatPercent, cleanItemName, partyNamePrefill, findVat13, isOwnCompany, otherPans, pickLedgerAccount } from "./extras";
import { OcrAiError, ocrAiErrorCode, ocrAiErrorText, ocrAiFailKind, type OcrAiModelOption, type OcrAiMasterProposal, type OcrAiVoucherPatch } from "./ai/aiClient";
import { getBlobFromLocalFileRef, isLocalFileRef } from "@/lib/localPendingFiles";
import { fetchPbAttachmentBlob } from "@/lib/pocketbaseData/pbAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useVouchers } from "@/hooks/useVouchers";
import { detectReceipt, AUTO_SWITCH_MIN_CONF, type ReceiptDetection } from "@/lib/ocr/receiptDetect";
import { accountDisplayLabel, buildMoneyVoucherFill, pickChargeAccount, receiptNarration, suggestMaskedPayees } from "@/lib/ocr/receiptDetect/fillPaymentOut";
import type { ParsedReceipt } from "@/lib/ocr/receiptDetect/types";
import { paymentAmountFromBill } from "./fillPaymentOut";
import { devanagariDigitsToAscii, normalizeName } from "./normalize";
import { nameScore } from "./fuzzy";
import { matchPartyIdentity } from "./masterMatch";
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
  /** Form-specific business guards that must pass before OCR Auto Post saves. */
  validateAutoPost?: () => string[];
  disabled?: boolean;
  /** Purchase/Sale ledger options (value/label) for the Dr account lookup. */
  ledgerAccounts?: readonly { value: string; label: string }[];
  /** Actual open tab when one form serves two types (Payment In/Direct Income, Payment/Direct Expense). */
  currentVoucherType?: string;
};

/** Voucher types the AddVoucherDialog can switch to from an OCR suggestion. */
const OCR_SWITCHABLE = ["sale", "purchase", "payment_in", "payment_out", "direct_income", "direct_expense", "contra", "journal"];
/** AI types that open a bill / journal form: the text money detectors must not re-route them to a payment form. */
const AI_BILL_TYPES = ["sale", "purchase", "credit_note", "debit_note", "journal"];
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

function isItemMasterPath(path: string): boolean {
  return /(?:^|\.)(?:lineItems|items)(?:\.\d+)?\.(?:itemId|serviceId)$/i.test(path);
}

/** Ignore Gemini's generated type explanation; it is metadata, not text printed on the bill. */
function billShowsVat(text: string | undefined, vatAmount?: number): boolean {
  if (Number(vatAmount) > 0) return true;
  const billText = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:VOUCHER|DOCUMENT)\s+TYPE\s*:/i.test(line))
    .join("\n");
  return /\bvat\b|\bgst\b|मू\.?\s*अ\.?\s*कर/i.test(billText) ||
    /(?:^|\n)\s*tax(?:\s+(?:amount|rate))?\s*(?:[:=\-]\s*)?\d[\d,.]*\s*%?/im.test(billText);
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
export const OCR_BUILD = "2026-11-18.1";

const MONEY_TYPES = ["payment_out", "payment_in", "direct_expense", "direct_income", "contra"] as const;
const ALL_TYPE_CHOICES = ["sale", "purchase", "payment_in", "payment_out", "direct_income", "direct_expense", "contra"] as const;

/** Fail popup chooser: other engines for one more scan ("gemini:<model>" | "cloud:google" | "cloud:azure"). */
type OcrFailChoiceInput = { engine: string; model?: string; fallbackModel?: string; models?: OcrAiModelOption[]; cloud?: { google: boolean; azure: boolean } };
function ocrFailChoices(f: OcrFailChoiceInput, FS: ReturnType<typeof ocrRunStrings>["fail"]): { value: string; label: string; failed: boolean }[] {
  return [
    ...(f.models ?? []).map((m) => ({
      value: `gemini:${m.id}`,
      label: fmtOcr(FS.engineGemini, { model: m.label && m.label !== m.id ? `${m.label} · ${m.id}` : m.id }),
      failed: f.engine === "Gemini" && (m.id === f.model || m.id === f.fallbackModel),
    })),
    ...(f.cloud?.azure ? [{ value: "cloud:azure", label: FS.engineAzure, failed: f.engine === "Azure" }] : []),
    ...(f.cloud?.google ? [{ value: "cloud:google", label: FS.engineGoogle, failed: f.engine === "Google" }] : []),
  ];
}

/** A voucher-type switch suggestion is pending (not blocked). */
function switchPendingIn(list: readonly OcrSuggestion[]): boolean {
  return list.some((x) => (x.id === "switch" || x.id.startsWith("switch-")) && !x.blocked);
}

/** The pending switch will fire by itself (same rule as the auto-switch countdown effect): the target form then re-runs this handoff. */
function switchWillAutoFire(list: readonly OcrSuggestion[]): boolean {
  if (getOcrPrefs().autoSwitchVoucher === false) return false;
  const sw = list.find((x) => x.id === "switch");
  return !!sw && !sw.blocked && (sw.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF;
}

function findDuplicateByRef(vouchers: readonly any[] | undefined, txnId?: string, referenceId?: string, chequeNumber?: string): { id: string; voucherNumber?: string; type?: string } | null {
  const needles = [txnId, referenceId, chequeNumber].map((s) => String(s ?? "").trim()).filter((s) => s.length >= 6);
  if (!needles.length) return null;
  for (const v of vouchers ?? []) {
    const hay = `${v?.narration ?? ""} ${v?.reference ?? ""} ${v?.referenceId ?? ""} ${v?.txnId ?? ""} ${v?.billNo ?? ""}`;
    if (needles.some((n) => hay.includes(n))) return { id: String(v.id ?? ""), voucherNumber: v.voucherNumber ?? v.voucherNo, type: v.type };
  }
  return null;
}

/** Confirmation toast after toggling translate-to-English. */
function flashTranslatePref(on: boolean) {
  toast.success(on ? "Translate to English: ON" : "Translate to English: OFF", {
    id: "pl-ocr-translate-pref",
    description: on
      ? "Every OCR slip will be translated to English. Reset in OCR settings."
      : "Slips will be read in their original language.",
    duration: 4500,
    position: "top-right",
  });
}

/**
 * OCR text me non-English script hai? Devanagari / Bengali / Tamil / Telugu / Gujarati / Punjabi /
 * Arabic / Thai / CJK blocks. Latin-only text (English, en-US/UK/IN spelling) translate offer nahi karta.
 */
function looksNonEnglishOcrText(text: string | undefined): boolean {
  const t = String(text ?? "");
  if (!t) return false;
  return /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(t);
}

function translatedOcrText(value: string | undefined, translations: readonly { source: string; english: string }[] | undefined): string | undefined {
  const original = String(value ?? "");
  if (!original || !looksNonEnglishOcrText(original) || !translations?.length) return undefined;
  let translated = original;
  for (const t of [...translations].sort((a, b) => b.source.length - a.source.length)) {
    if (!t.source || !t.english || !looksNonEnglishOcrText(t.source) || !translated.includes(t.source)) continue;
    translated = translated.split(t.source).join(t.english);
  }
  return translated !== original && !looksNonEnglishOcrText(translated) ? translated : undefined;
}

function addPrecomputedEnglish(suggestions: OcrSuggestion[], raw: OcrRawResult): OcrSuggestion[] {
  const translations = raw.ai?.data.english_translations;
  if (!translations?.length) return suggestions;
  return suggestions.map((s) => {
    const englishValue = translatedOcrText(s.value, translations);
    const primaryName = s.id === "create-party" ? s.value.split(" · ")[0]
      : s.id === "create-expense-account" ? s.value
      : s.id.startsWith("create-item-") ? s.value.split(" | ")[0]
      : s.id.startsWith("create-account-") ? s.value
      : "";
    const englishMasterName = s.englishMasterName ?? translatedOcrText(primaryName, translations);
    const displayEnglish = s.englishValue ?? englishValue;
    return displayEnglish || englishMasterName ? { ...s, englishValue: displayEnglish, englishMasterName } : s;
  });
}

export function useVoucherOcr(o: UseVoucherOcrOptions) {
  const planAllowed = useOcrPlanAllowed();
  // Own company straight from the company profile (not only form props) - hard guard against offering ourselves as party
  const { company: profileCompany } = useCompany();
  /* Decision 2 (2026-11-18): hand-opened vouchers follow Voucher Post Setting → Manual Runner
   * (engine, Auto Post, countdown, Overwrite edited, item rule), not device-local OCR prefs. */
  const manualOcrCompanyId = String((profileCompany as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || o.companyId || "");
  const manualOcrProfile = useManualOcrProfile(manualOcrCompanyId);
  const manualOcrProfileRef = useRef(manualOcrProfile);
  manualOcrProfileRef.current = manualOcrProfile;
  const manualOcrCompanyIdRef = useRef(manualOcrCompanyId);
  manualOcrCompanyIdRef.current = manualOcrCompanyId;
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
  /** Last OCR's money payload + label sources — lets the narration follow a later From/To dropdown change. */
  const lastMoneyRef = useRef<{ parsed: ParsedReceipt; direction: "payment_out" | "payment_in" | "contra" } | null>(null);
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
  const [ocrFail, setOcrFail] = useState<{ engine: string; message: string; detail?: string; code?: string; retryAfter?: number; kind?: OcrFailKind; model?: string; fallbackModel?: string; models?: OcrAiModelOption[]; cloud?: { google: boolean; azure: boolean } } | null>(null);
  /** Fail popup model chooser: model for the next "Read with this model" (this scan only). */
  const [failPick, setFailPick] = useState("");
  const [possibleBankCharge, setPossibleBankCharge] = useState<number | null>(null);
  const possibleBankChargeResolverRef = useRef<((includeCharge: boolean) => void) | null>(null);
  const [createItemFor, setCreateItemFor] = useState<{ index: number; name: string; unit?: string; rate: number; groupId?: string; ocrGroups?: MasterGroupLike[] } | null>(null);
  const [createTaxOpen, setCreateTaxOpen] = useState(false);
  const [vatPct, setVatPct] = useState(13);
  const [vatPickerOpen, setVatPickerOpen] = useState(false);
  const [vatPickerId, setVatPickerId] = useState("");
  const filledRef = useRef(new Map<string, unknown>());
  const handoffAutoPostRef = useRef(false);
  const handoffAutoPostOverrideRef = useRef<boolean | undefined>(undefined);
  /** Voucher opened by the Gallery runner (Semi / Full): its profile settings travel with every type switch. */
  const handoffRunnerJobRef = useRef(false);
  /** Full Auto Post: save right after autofill, no countdown. */
  const handoffAutoPostImmediateRef = useRef(false);
  const handoffAutoPostSecondsRef = useRef<number | undefined>(undefined);
  const handoffOverwriteEditedRef = useRef<boolean | undefined>(undefined);
  const handoffAllowSaveWithoutItemsRef = useRef(false);
  const handoffEnginePrefRef = useRef<import("./prefs").OcrEnginePref | undefined>(undefined);
  const handoffCloudProviderRef = useRef<"google" | "azure" | undefined>(undefined);
  /** Runner handoff "Check for duplicate vouchers" = false: no duplicate detect / bubble / save block for this voucher. */
  const handoffDupCheckOffRef = useRef(false);
  const handoffDueDaysRef = useRef<{ sale?: number | null; purchase?: number | null } | undefined>(undefined);
  /** Manual type change: what the user typed in the previous form; written back over the OCR re-map. */
  const handoffUserValuesRef = useRef<OcrCarriedValues | undefined>(undefined);
  const runnerHeldForHandoffRef = useRef(false);
  const localAutoPostPendingRef = useRef(false);
  /* Auto Post countdown: after OCR, wait the configured seconds (header gear, default 10) then save; bubble above Save can cancel. */
  const [apCount, setApCount] = useState<number | null>(null);
  /** OCR result (raw) that already scheduled an Auto Post -> never schedule twice for the same read. */
  const apScheduledForRef = useRef<unknown>(null);
  const apTimerRef = useRef<number | null>(null);
  const cancelAutoPostCountdown = useCallback(() => {
    if (apTimerRef.current != null) { window.clearInterval(apTimerRef.current); apTimerRef.current = null; }
    localAutoPostPendingRef.current = false;
    setApCount(null);
  }, []);
  const startAutoPostCountdown = useCallback(() => {
    if (apTimerRef.current != null) window.clearInterval(apTimerRef.current);
    if (handoffAutoPostRef.current) localAutoPostPendingRef.current = true;
    const immediate = handoffRunnerJobRef.current && handoffAutoPostImmediateRef.current;
    let n = immediate ? 1 : clampAutoPostSeconds(handoffAutoPostSecondsRef.current ?? manualOcrProfileRef.current.autoPostSeconds);
    if (!immediate) setApCount(n);
    apTimerRef.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) { setApCount(n); return; }
      if (apTimerRef.current != null) window.clearInterval(apTimerRef.current);
      apTimerRef.current = null;
      setApCount(null);
      if (localAutoPostPendingRef.current && typeof navigator !== "undefined" && !navigator.onLine) {
        toast.info("Local Auto post paused", { description: "This PC is offline. Auto post will continue when the connection returns." });
        return;
      }
      if (handoffAutoPostRef.current && runnerHeldForHandoffRef.current) {
        localAutoPostPendingRef.current = true;
        return;
      }
      localAutoPostPendingRef.current = false;
      savedRef.current = true;
      optsRef.current.autoPost();
    }, immediate ? 0 : 1000);
  }, []);
  const askPossibleBankCharge = useCallback((amount: number) => new Promise<boolean>((resolve) => {
    possibleBankChargeResolverRef.current = resolve;
    setPossibleBankCharge(amount);
  }), []);
  const resolvePossibleBankCharge = useCallback((includeCharge: boolean) => {
    const resolve = possibleBankChargeResolverRef.current;
    possibleBankChargeResolverRef.current = null;
    setPossibleBankCharge(null);
    resolve?.(includeCharge);
  }, []);
  useEffect(() => () => {
    possibleBankChargeResolverRef.current?.(false);
    possibleBankChargeResolverRef.current = null;
  }, []);
  useEffect(() => {
    const resumeLocalAutoPost = () => {
      if (localAutoPostPendingRef.current && apTimerRef.current == null) startAutoPostCountdown();
    };
    window.addEventListener("online", resumeLocalAutoPost);
    return () => window.removeEventListener("online", resumeLocalAutoPost);
  }, [startAutoPostCountdown]);
  useEffect(() => () => { if (apTimerRef.current != null) window.clearInterval(apTimerRef.current); }, []);
  const apPrefOn = manualOcrProfile.autoPost;
  useEffect(() => { if (!apPrefOn && handoffAutoPostOverrideRef.current !== true) cancelAutoPostCountdown(); }, [apPrefOn, cancelAutoPostCountdown]);
  const lastRawRef = useRef<OcrRawResult | null>(null);
  /** Manual voucher selection outranks OCR's type suggestion for this reused scan. */
  const manualTypeSwitchRef = useRef(false);
  const [readBy, setReadBy] = useState<{ engine: "google" | "azure" | "gemini"; note?: string } | null>(null);
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
  /* Runner (Semi + Full Auto): a type switch that was expected to auto-fire but did not happen (dialog refused,
   * countdown cancelled / blocked, no target) must reach the runner, or the job waits forever. Once per OCR result. */
  /** One toast slot per voucher form: re-runs (runner resume) update the same toast instead of stacking new ones. */
  const toastKeyRef = useRef(`ocr-${Math.random().toString(36).slice(2)}`);
  /** Last "required fields missing" sent to the runner for this scan + the form values it was checked against. */
  const lastRunnerMissingRef = useRef<{ raw: unknown; sig: string; detail: Record<string, unknown> } | null>(null);
  const formSig = useCallback(() => {
    try { return JSON.stringify(optsRef.current.form.getValues()); } catch { return ""; }
  }, []);
  const sendRunnerMissing = useCallback((detail: Record<string, unknown>) => {
    lastRunnerMissingRef.current = { raw: lastRawRef.current, sig: formSig(), detail };
    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-required-fields-missing", { detail }));
  }, [formSig]);
  const runnerSwitchWatchRef = useRef<number | null>(null);
  const runnerSwitchNotifiedForRef = useRef<unknown>(null);
  const clearRunnerSwitchWatch = useCallback(() => {
    if (runnerSwitchWatchRef.current != null) { window.clearTimeout(runnerSwitchWatchRef.current); runnerSwitchWatchRef.current = null; }
  }, []);
  const notifyRunnerSwitchStalled = useCallback(() => {
    clearRunnerSwitchWatch();
    const opt = optsRef.current;
    const raw = lastRawRef.current;
    if (!mountedRef.current || !handoffAutoPostRef.current || savedRef.current || opt.isEditing) return;
    if (runnerSwitchNotifiedForRef.current === raw) return;
    runnerSwitchNotifiedForRef.current = raw;
    const label = ocrRunStrings().voucherTypeSwitchPending;
    sendRunnerMissing({ companyId: opt.companyId, missing: [label], fieldKeys: ocrMissingFieldKeys([label]), voucherType: opt.currentVoucherType ?? opt.adapter.voucherType, itemAmountMismatch: false, amountCheckReasons: [] });
  }, [clearRunnerSwitchWatch, sendRunnerMissing]);
  /** Armed when a runner handoff leaves the save to the auto-switch: countdown + margin, then report if still here. */
  const armRunnerSwitchWatch = useCallback(() => {
    clearRunnerSwitchWatch();
    const ms = (clampAutoPostSeconds(getOcrPrefs().autoSwitchSeconds) + 6) * 1000;
    runnerSwitchWatchRef.current = window.setTimeout(() => {
      runnerSwitchWatchRef.current = null;
      if (!mountedRef.current || apScheduledForRef.current === lastRawRef.current) return;
      notifyRunnerSwitchStalled();
    }, ms);
  }, [clearRunnerSwitchWatch, notifyRunnerSwitchStalled]);
  useEffect(() => () => { if (runnerSwitchWatchRef.current != null) window.clearTimeout(runnerSwitchWatchRef.current); }, []);

  const switchVoucher = useCallback((typ: string, raw: OcrRawResult, selectedIds: string[]) => {
    const files = optsRef.current.files;
    const original = takeOcrOriginal(files[0]);
    // Keep Gallery Auto post's rules when OCR changes the dialog from its initial Sale
    // form to the detected voucher type (often Purchase). Without this, the target form
    // loses both Auto post and Save without the item, then pauses on an unmatched item.
    const token = requestOcrVoucherSwitch(typ, files, {
      raw,
      original,
      selectedIds,
      // Runner job: carry every runner setting. Hand-opened voucher: undefined -> Manual Runner profile decides.
      runnerJob: handoffRunnerJobRef.current || undefined,
      autoPostImmediate: handoffRunnerJobRef.current ? handoffAutoPostImmediateRef.current : undefined,
      autoPost: handoffRunnerJobRef.current ? handoffAutoPostRef.current : undefined,
      autoPostSeconds: handoffAutoPostSecondsRef.current,
      overwriteEdited: handoffOverwriteEditedRef.current,
      allowSaveWithoutItems: handoffAllowSaveWithoutItemsRef.current,
      enginePref: handoffEnginePrefRef.current,
      cloudProvider: handoffCloudProviderRef.current,
      checkDuplicateVouchers: handoffDupCheckOffRef.current ? false : undefined,
      defaultDueDays: handoffDueDaysRef.current,
    });
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      cancelOcrHandoff(token);
      if (original && files[0]) linkOcrOriginal(files[0], original);
      setDoneIds((p) => { if (!p.has("switch")) return p; const n = new Set(p); n.delete("switch"); return n; });
      setSugOpen(true);
      // Runner job: the switch was refused, so this form will not auto-post either -> let the runner apply its rule.
      if (handoffAutoPostRef.current) notifyRunnerSwitchStalled();
    }, 1500);
  }, [notifyRunnerSwitchStalled]);

  // A user can change the voucher tab after OCR has already read the attachment.
  // Carry that cached OCR result to the new form so its adapter can reuse matching
  // fields and show its normal missing-field suggestions without another OCR call.
  useEffect(() => {
    const onManualVoucherSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ toType?: string }>).detail;
      const opt = optsRef.current;
      const raw = lastRawRef.current;
      const targetType = detail?.toType;
      if (!targetType || !raw || !opt.files.length || opt.isEditing) return;
      const currentType = opt.currentVoucherType ?? opt.adapter.voucherType;
      if (currentType === targetType) return;

      cancelAutoPostCountdown();
      const original = takeOcrOriginal(opt.files[0]);
      /* Values the USER typed here (not OCR fills) travel by meaning, so the new form never loses them. */
      const A = opt.adapter;
      const F = opt.form;
      const userValues: OcrCarriedValues = collectOcrUserValues(
        { date: A.date, dueDate: A.dueDate, narration: A.narration, amount: A.amount, party: A.party?.path, account: A.accountPath },
        (path) => F.getValues(path),
        (path, v) => !(filledRef.current.has(path) && JSON.stringify(filledRef.current.get(path)) === JSON.stringify(v)) && F.getFieldState(path).isDirty,
        isEmptyVal,
      );
      /* Decision 9: a Gallery runner voucher keeps ALL its runner profile settings on a manual type change
       * (engine, Auto Post on or off, countdown, duplicate check, due days...). A normal voucher stays manual. */
      const runnerHandoff = handoffRunnerJobRef.current === true;
      queueOcrHandoff(targetType, opt.files, {
        raw,
        original,
        selectedIds: [],
        manualTypeSwitch: true,
        userValues: Object.keys(userValues).length ? userValues : undefined,
        ...(runnerHandoff
          ? {
              runnerJob: true,
              autoPostImmediate: handoffAutoPostImmediateRef.current,
              autoPost: handoffAutoPostRef.current,
              autoPostSeconds: handoffAutoPostSecondsRef.current,
              overwriteEdited: handoffOverwriteEditedRef.current,
              allowSaveWithoutItems: handoffAllowSaveWithoutItemsRef.current,
              enginePref: handoffEnginePrefRef.current,
              cloudProvider: handoffCloudProviderRef.current,
              checkDuplicateVouchers: handoffDupCheckOffRef.current ? false : undefined,
              defaultDueDays: handoffDueDaysRef.current,
            }
          : { autoPost: false, allowSaveWithoutItems: false }),
      });
    };
    window.addEventListener(OCR_MANUAL_SWITCH_EVENT, onManualVoucherSwitch);
    return () => window.removeEventListener(OCR_MANUAL_SWITCH_EVENT, onManualVoucherSwitch);
  }, [cancelAutoPostCountdown]);

  const canWrite = useCallback((path: string) => {
    const { form } = optsRef.current;
    if (handoffOverwriteEditedRef.current ?? manualOcrProfileRef.current.overwriteEdited) return true;
    const cur = form.getValues(path);
    if (isEmptyVal(cur)) return true;
    if (filledRef.current.has(path)) {
      const prev = filledRef.current.get(path);
      return JSON.stringify(prev) === JSON.stringify(cur);
    }
    return !form.getFieldState(path).isDirty;
  }, []);
  /** Same gate, reachable from callbacks declared after it (copilot patch) without re-creating them. */
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;

  const write = useCallback((path: string, value: unknown) => {
    const { form } = optsRef.current;
    form.setValue(path, value as never, { shouldDirty: true, shouldValidate: false });
    filledRef.current.set(path, form.getValues(path));
  }, []);


  const itemCreateApiRef = useRef<{
    auto: (index: number, row: { description: string; unit?: string; rate: number }, known?: { id: string; name?: string; isDeleted?: boolean }[]) => Promise<{ ok: true; id: string; reused: boolean; name: string } | { ok: false; message: string }>;
    manual: (index: number, row: { description: string; unit?: string; rate: number }) => Promise<void>;
    all: (items: { id: string; englishValue?: string }[], language?: "original" | "english") => Promise<void>;
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
    all: async (items, language) => {
      const billRows = lastBillRef.current?.lineItems?.value ?? [];
      const known: { id: string; name?: string; isDeleted?: boolean }[] = [];
      let created = 0, reused = 0, failed = 0;
      const toastId = toast.loading(`Creating items 0/${items.length}`);
      for (let i = 0; i < items.length; i++) {
        toast.loading(`Creating items ${i + 1}/${items.length}`, { id: toastId });
        const id = items[i].id;
        const index = Number(id.slice("create-item-".length));
        const sourceRow = billRows[index];
        const englishDescription = items[i].englishValue?.split(" | ")[0];
        const row = language === "english" && sourceRow
          ? { ...sourceRow, description: englishDescription || translatedOcrText(sourceRow.description, lastRawRef.current?.ai?.data.english_translations) || sourceRow.description }
          : sourceRow;
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
    async (reason: "auto" | "refresh" | "handoff", reuse?: { raw?: OcrRawResult; selectedIds?: string[]; enginePref?: import("./prefs").OcrEnginePref; cloudProvider?: "google" | "azure"; resumeCurrentForm?: boolean; manualTypeSwitch?: boolean; aiModel?: string }) => {
      const opt = optsRef.current;
      const first = opt.files[0];
      if (!first || running) return;
      manualTypeSwitchRef.current = reuse?.manualTypeSwitch === true;
      /* Manual tab switch of a gallery runner voucher: auto-post stays on, validated against the current form. */
      const manualRunnerSwitch = reuse?.manualTypeSwitch === true && reason === "handoff" && handoffAutoPostRef.current;
      /** Runner job: its own Auto Post. Hand-opened voucher: Manual Runner profile (an explicit "off" handoff wins). */
      const autoPostWanted = (why: "auto" | "refresh" | "handoff") => resolveVoucherAutoPost({
        runnerJob: why === "handoff" && handoffRunnerJobRef.current,
        override: why === "handoff" ? handoffAutoPostOverrideRef.current : undefined,
        runnerAutoPost: handoffAutoPostRef.current,
        manual: manualOcrProfileRef.current,
      });
      /** Manual type change: the user's own values from the previous form win over the OCR re-map (applied once). */
      const applyCarriedUserValues = () => {
        const carried = reuse?.manualTypeSwitch ? handoffUserValuesRef.current : undefined;
        if (!carried) return;
        handoffUserValuesRef.current = undefined;
        const A = opt.adapter;
        const F = opt.form;
        for (const [key, path, v] of carriedValueWrites(carried, { date: A.date, dueDate: A.dueDate, narration: A.narration, amount: A.amount, party: A.party?.path, account: A.accountPath })) {
          if (key === "party") {
            if (!A.party || !opt.parties.some((p) => p.id === v)) continue;
            if (A.party.payeeTypePath && A.party.payeeTypeValue) F.setValue(A.party.payeeTypePath, A.party.payeeTypeValue as never, { shouldDirty: true });
          }
          F.setValue(path, v as never, { shouldDirty: true, shouldValidate: false });
        }
      };
      setRunning(true);
      setOcrFail(null);
      const PS = ocrRunStrings().progress;
      const lead = reason === "refresh" ? PS.rereading : reason === "handoff" ? PS.filling : PS.reading;
      const ac = new AbortController();
      ocrAbortRef.current = ac;
      /** Stop button on the toast: cancels the in-flight Gemini/cloud request. */
      const StopButton = () => (
        <button
          type="button"
          onClick={() => ac.abort()}
          className="ml-2 shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          {PS.stop}
        </button>
      );
      const tId = toast.loading(<span className="flex items-center gap-1">{lead}<StopButton /></span>, { id: `${toastKeyRef.current}-run` });
      /** The selected engine name (and the Gemini model being requested) is shown in the same toast. */
      const seen: string[] = [];
      let aiModelName = "";
      const showProgress = () => {
        if (ac.signal.aborted || !seen.length) return;
        const label = seen.map((n) => (n === "Gemini" && aiModelName ? `${n} (${aiModelName})` : n)).join(" → ");
        const text = reason === "handoff" ? lead : fmtOcr(reason === "refresh" ? PS.rereadingBy : PS.readingBy, { engine: label });
        toast.loading(<span className="flex items-center gap-1">{text}<StopButton /></span>, { id: tId });
      };
      const onEngine = (name: string) => {
        if (!seen.includes(name)) seen.push(name);
        showProgress();
      };
      const onAiModel = (m: string) => { aiModelName = m; showProgress(); };
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
          /* Decision 6: the engine is explicit — popup choice, else the runner's engine, else Manual Runner's. */
          const pickedEngine = reuse?.aiModel ? "ai" as const : reuse?.enginePref;
          const manualOcr = pickedEngine || handoffEnginePrefRef.current ? null : await ensureManualOcrProfile(manualOcrCompanyIdRef.current);
          raw = await runOcrOnFile(src.blob, src.mime, {
            companyId: opt.companyId,
            enginePref: pickedEngine ?? handoffEnginePrefRef.current ?? manualOcr?.enginePref ?? "auto",
            aiModel: reuse?.aiModel,
            onAiModel,
            cloudProvider: pickedEngine ? reuse?.cloudProvider : (handoffCloudProviderRef.current ?? (manualOcr?.cloudProvider || undefined)),
            ownCompany: { name: ownRef.current.name, pan: ownRef.current.pan },
            ownAccounts: (mastersRef.current.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ accountName: a.accountName, aliasName: (a as { aliasName?: string }).aliasName, accountNumber: a.accountNumber, bankName: a.bankName, accountType: a.accountType })),
            aiDocType: aiDocTypeForVoucher(opt.currentVoucherType ?? null, opt.adapter.partySide),
            onEngine,
            signal: ac.signal,
          });
          /* Server read it with the fallback Gemini model (first model was busy): small note, nothing blocks. */
          if (raw.ai?.model) markAiModelAvailable(opt.companyId, raw.ai.model);
          if (raw.ai?.fallbackUsed) {
            toast.message(fmtOcr(ocrRunStrings().fail.fallbackNote, { primary: raw.ai.primaryModel || "Gemini", model: raw.ai.model || "Gemini" }), { duration: 4000, position: "top-right" });
          }
        }
        lastRawRef.current = raw;
        if ((reason === "handoff" && !reuse?.manualTypeSwitch) || reason === "refresh") {
          window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-scan-succeeded", {
            detail: { companyId: String((profileCompany as any)?.authoritativeCompanyId || opt.companyId || "") },
          }));
        }
        setReadBy({ engine: raw.engine === "google" || raw.engine === "azure" || raw.engine === "gemini" ? raw.engine : "google", note: raw.engineNote });
        const lowConf = raw.meanConfidence < 55;
        if (lowConf) {
          toast.message("OCR: image is not very clear", { id: tId, description: "Please confirm the highlighted fields. Nothing will be auto-saved.", duration: 5000, position: "top-right" });
        }
        const own = ownRef.current;
        /* ---------- Money documents (connectIPS, Prabhu, generic bank, handwritten): detect + classify + fill ---------- */
        {
          const M = mastersRef.current;
          /* "Our own names on bank slips": Gemini has them in its prompt; the text detectors get them here. */
          const ownAliases = raw.engine === "gemini" ? undefined : await getOcrOwnAliases(opt.companyId).catch(() => undefined);
          const aiBillType = !!raw.ai?.data.voucher_type && AI_BILL_TYPES.includes(raw.ai.data.voucher_type);
          const textRcAll: ReceiptDetection = detectReceipt(`${raw.text}\n${raw.altText ?? ""}`, {
            ownAccounts: (M.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType, branch: (a as { branch?: string }).branch, aliasName: (a as { aliasName?: string }).aliasName })),
            parties: (M.parties ?? []).filter((p) => !(p as { isDeleted?: boolean }).isDeleted).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), aliasName: (p as { aliasName?: string }).aliasName })),
            staff: (M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? "") })),
            companyName: own.name ?? undefined,
            ownAliases,
          });
          /* Gemini chose a bill / journal / note: honour it; the text money detectors only decide for non-AI engines
           * or when Gemini itself chose a money type. */
          const textRc: ReceiptDetection = aiBillType
            ? { format: null, confidence: 0, parsed: null, voucherType: null, candidates: [], typeConfidence: 0, master: { kind: null, score: 0 }, counterParty: null, reason: `AI chose ${raw.ai?.data.voucher_type}` }
            : textRcAll;
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
            const detectedDirection = rc.voucherType === "payment_in" || rc.voucherType === "direct_income" ? "payment_in"
              : rc.voucherType === "contra" ? "contra"
              : "payment_out";
            // On a manual type change, map the already-read document into the selected form's
            // fields. The type may intentionally differ from OCR's suggestion, so use the
            // destination form's flow and let its normal missing-field bubbles flag conflicts.
            const direction = reuse?.manualTypeSwitch
              ? cur === "contra" ? "contra" : cur === "payment_in" || cur === "direct_income" ? "payment_in" : "payment_out"
              : detectedDirection;
            const tabIsMoney = (MONEY_TYPES as readonly string[]).includes(cur);
            const tabMatches = !rc.voucherType || sameVoucherBucket(cur, rc.voucherType) || cur === rc.voucherType;
            const canFill = !!rc.parsed && tabIsMoney && (tabMatches || reuse?.manualTypeSwitch === true);
            const fillSafeOnly = !!rc.parsed && tabIsMoney && !rc.voucherType; // date/amount/narration only

            const pf = rc.parsed ? buildMoneyVoucherFill(rc.parsed, canFill ? direction : "payment_out", { ownAccounts: ownAcc, parties, staff, taxes }) : null;
            // Money vouchers use a separate payee matcher. An exact counter-party PAN must
            // win there too, regardless of voucher tab or payee-name score.
            const moneyPan = devanagariDigitsToAscii(String(raw.ai?.data.party_pan ?? "")).replace(/\D/g, "");
            const ownPanDigits = devanagariDigitsToAscii(String(own.pan ?? "")).replace(/\D/g, "");
            const selectedPayeeTypeForPan = String(opt.form.getValues("payeeType") ?? "");
            if (pf && canFill && direction !== "contra" && moneyPan.length === 9 && moneyPan !== ownPanDigits && (!selectedPayeeTypeForPan || selectedPayeeTypeForPan === "party")) {
              const moneyPartyMap = new Map<string, OcrPartyLike>();
              for (const party of M.parties ?? []) moneyPartyMap.set(party.id, { ...party });
              for (const party of opt.parties ?? []) {
                const current = moneyPartyMap.get(party.id);
                moneyPartyMap.set(party.id, current ? { ...current, ...party, pan: party.pan || current.pan, panNo: party.panNo || current.panNo, vatNo: party.vatNo || current.vatNo } : party);
              }
              const panMatch = matchPartyIdentity({ pan: moneyPan }, [...moneyPartyMap.values()].filter((p) => isOcrSelectableParty(p as never)));
              if (panMatch.decision === "auto" && panMatch.best) {
                pf.payee = { payeeType: "party", id: panMatch.best.item.id, name: String(panMatch.best.item.name ?? ""), score: 1 };
                pf.payeeName = panMatch.best.item.name ?? pf.payeeName;
                pf.payeeUnsure = undefined;
              }
            }
            const allowWrite = !lowConf;
            let includedBankCharge: number | null = null;
            if (
              pf && canFill && direction === "contra" && raw.ai?.data.doc_kind === "bank_transfer" &&
              raw.ai.data.bank_flow === "own_to_own" && pf.charge == null &&
              rc.parsed?.charge == null && raw.ai.data.transfer_charges == null && allowWrite &&
              canWrite("otherChargeAmount") &&
              Number(opt.form.getValues("otherChargeAmount") || 0) === 0
            ) {
              const amount = Number(pf.amount);
              const candidateCharge = Math.round(amount) % 100;
              // A small non-zero remainder on a confirmed company bank-to-bank transfer is only a
              // suspicion; ask before treating it as a bank fee (e.g. 15,010 → possible Rs. 10 fee).
              if (Number.isFinite(amount) && candidateCharge > 0 && candidateCharge < 100) {
                const includeCharge = await askPossibleBankCharge(candidateCharge);
                if (includeCharge) {
                  // The OCR amount is the total debited from the source account. Split the
                  // suspected fee out of that total instead of adding it on top of the transfer.
                  includedBankCharge = candidateCharge;
                  if (canWrite("otherChargeAmount")) {
                    write("otherChargeAmount", candidateCharge);
                  }
                  const chargeCandidates = [
                    ...(M.expense ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted).map((e) => ({ id: e.id, name: String((e as { name?: string }).name ?? ""), kind: "expense" as const })),
                    ...(M.parties ?? []).filter((p) => isOcrSelectableParty(p as never)).map((p) => ({ id: p.id, name: String((p as { name?: string }).name ?? ""), kind: "party" as const })),
                    ...(M.staff ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => ({ id: x.id, name: String((x as { name?: string }).name ?? ""), kind: "staff" as const })),
                  ];
                  let defaultId: string | null = null;
                  try {
                    defaultId = localStorage.getItem(`pocket-ledger:contra:other-charge-default:${opt.companyId || "global"}`) ||
                      localStorage.getItem(`pocket-ledger:payment-out:other-charge-default:${opt.companyId || "global"}`);
                  } catch { /* ignore */ }
                  const chargeAccount = pickChargeAccount(chargeCandidates, { bankName: rc.parsed?.sender?.bankName, defaultId });
                  if (chargeAccount && allowWrite && canWrite("otherChargeAccountId")) write("otherChargeAccountId", chargeAccount.id);
                  if (!chargeAccount) rMissing.push("Other charge account (bank transfer charge)");
                }
              }
            }

            if (pf && (canFill || fillSafeOnly)) {
              const F = opt.form;
              const A = opt.adapter;
              const selectedPayeeType = String(F.getValues("payeeType") ?? "");
              if (cur === "direct_expense" && selectedPayeeType === "expense" && !String(F.getValues("expenseAccountId") ?? "").trim()) {
                const expenseName = raw.ai?.data.lines.find((line) => line.side === "dr" && line.kind === "expense" && line.name)?.name?.trim();
                if (expenseName) {
                  const normalizedExpenseName = normalizeName(expenseName);
                  const expenseMatches = (M.expense ?? [])
                    .filter((expense) => !(expense as { isDeleted?: boolean }).isDeleted)
                    .map((expense) => ({ expense, score: nameScore(normalizedExpenseName, normalizeName(String((expense as { name?: string }).name ?? ""))) }))
                    .filter(({ score }) => score >= 0.82)
                    .sort((a, b) => b.score - a.score);
                  const bestExpenseMatch = expenseMatches[0];
                  const bestExpense = bestExpenseMatch?.expense as { id: string; name?: string } | undefined;
                  if (bestExpense && bestExpenseMatch) {
                    rExtra.push({
                      id: `use-expense-account-${bestExpense.id}`,
                      label: `Use expense account ${bestExpense.name || expenseName}`,
                      value: expenseName,
                      confidence: bestExpenseMatch.score,
                      reason: "This expense ledger looks like the name printed on the voucher; confirm before using it.",
                      apply: () => {
                        write("payeeType", "expense");
                        write("expenseAccountId", bestExpense.id);
                      },
                    });
                  }
                  rExtra.push({
                    id: "create-expense-account",
                    label: `Create expense account ${expenseName}`,
                    value: expenseName,
                    confidence: 0.8,
                    reason: "The voucher names this debit-side expense ledger. Create it or choose an existing expense account.",
                    deferred: true,
                    apply: () => { window.dispatchEvent(new CustomEvent("pl:ocr:create-expense-account", { detail: { name: expenseName } })); },
                  });
                  rExtra.push({
                    id: "open-expense-account-picker",
                    label: "Choose an existing expense account",
                    value: expenseName,
                    reason: "Open the expense account list and choose the matching account.",
                    apply: () => { window.dispatchEvent(new CustomEvent("pl:ocr:open-expense-account-picker")); },
                  });
                }
              }
              if (canFill && direction !== "contra") {
                const idPath = { party: A.party?.path ?? "partyId", staff: "staffId", tax: "taxAccountId" } as const;
                if (pf.payee) {
                  const path = idPath[pf.payee.payeeType];
                  // Don't reinterpret a selected Expense payee as a Party just
                  // because OCR found a receiver name on the bank slip.
                  if ((!selectedPayeeType || selectedPayeeType === pf.payee.payeeType) && allowWrite && canWrite(path) && canWrite("payeeType")) {
                    if (selectedPayeeType !== pf.payee.payeeType) write("payeeType", pf.payee.payeeType);
                    write(path, pf.payee.id);
                    rFilled.push(`Payee (${pf.payee.payeeType}: ${pf.payee.name})`);
                  } else if ((!selectedPayeeType || selectedPayeeType === pf.payee.payeeType) && !allowWrite) {
                    rExtra.push({ id: "find-party", label: `Use ${pf.payee.payeeType} ${pf.payee.name}`, value: pf.payee.name, confidence: pf.payee.score, reason: "Low OCR confidence — confirm payee", apply: () => { write("payeeType", pf.payee!.payeeType); write(path, pf.payee!.id); } });
                  }
                } else {
                  const payeeEntityCanBeParty = !selectedPayeeType || selectedPayeeType === "party";
                  if (pf.payeeName && payeeEntityCanBeParty) rMissing.push("Party / payee");
                  if (pf.payeeName && payeeEntityCanBeParty) {
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
                      /* Phone is deliberately NOT prefilled from initiatorPhone: that is the SENDER's number
                       * (our own account holder on a Prabhu/connectIPS slip), so it belongs to us, never to the
                       * party being created. Bank details below come from the beneficiary side only. */
                      apply: (ctx) => {
                        const englishName = ctx?.englishValue?.split(" · ")[0] || translatedOcrText(nm, raw.ai?.data.english_translations);
                        const chosenName = ctx?.language === "english" ? englishName ?? nm : nm;
                        const prefill = partyNamePrefill(chosenName);
                        setCreatePrefill({ ...prefill, aliasName: chosenName !== nm ? nm : prefill.aliasName, pan: "", phone: "", email: "", address: "", accountTypeId: PARTY_SYSTEM_CREDITORS_ID, extra: [bn.accountMasked && `Bank A/c: ${bn.accountMasked}`, bn.bankName, bn.branch].filter(Boolean).join(" | ") });
                      },
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
                    apply: (ctx) => {
                      const accountName = ctx?.language === "english" ? ctx.englishValue ?? translatedOcrText(accName, raw.ai?.data.english_translations) ?? accName : accName;
                      setCreateAccountFor({ side: "from", prefill: { accountName: accountName || undefined, accountType: "Bank" } });
                    },
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
                      apply: (ctx) => {
                        const accountName = ctx?.language === "english" ? ctx.englishValue ?? translatedOcrText(toName, raw.ai?.data.english_translations) ?? toName : toName;
                        setCreateAccountFor({ side: "to", prefill: { accountName: accountName || undefined, accountType: "Bank" } });
                      },
                    });
                  }
                }
              }
              const outTab = cur === "payment_out" || cur === "direct_expense" || cur === "contra";
              const amountPath = A.payeeAmount ?? (outTab ? "payeeAmount" : (A.amount ?? "amount"));
              if (pf.amount) {
                const payeeAmount = Math.max(0, pf.amount - (direction === "contra" ? (includedBankCharge ?? 0) : 0));
                const topAmount = outTab ? pf.amount + (pf.charge ?? 0) : pf.amount;
                if (allowWrite && canWrite(amountPath)) { write(amountPath, payeeAmount); rFilled.push(`Amount ${payeeAmount}`); }
                else if (!allowWrite) rExtra.push({ id: "amount", label: "Amount", value: String(payeeAmount), reason: "Low OCR confidence — confirm amount", apply: () => write(amountPath, payeeAmount) });
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
                /* Contra "To" must name the destination ledger, not the slip's plain beneficiary name —
                 * "To: New Parsa Engineering Workshop" hid which bank the money landed in. Read the field the
                 * fill step just wrote so a manual pick (From/To dropdown) is reflected too. */
                const toIdForLabel = direction === "contra" ? String(F.getValues(A.toAccountPath ?? "toAccountId") ?? "") : "";
                const toAccForLabel = toIdForLabel ? (M.accounts ?? []).find((a) => a.id === toIdForLabel) : undefined;
                const toLabel = direction === "contra" && toAccForLabel ? `To: ${accountDisplayLabel(toAccForLabel as never)}` : null;
                const fullN = receiptNarration(rc.parsed!, fromLabel, toLabel);
                if (getOcrPrefs().narrationStyle === "short") {
                  const toId = direction === "contra" ? String(F.getValues(A.toAccountPath ?? "toAccountId") ?? "") : "";
                  const toAcc = toId ? (M.accounts ?? []).find((a) => a.id === toId) : undefined;
                  pf.narration = buildOcrNarration({
                    style: "short",
                    voucherType: direction,
                    billNo: rc.parsed!.voucherNo || rc.parsed!.txnId || undefined,
                    chequeNo: rc.parsed!.chequeNumber || undefined,
                    partyName: pf.payee?.name ?? pf.payeeName ?? undefined,
                    dateText: pf.date ? formatOcrNarrationDate(pf.date, readDateDisplayPrefs()) : "",
                    fromName: fromLabel || undefined,
                    toName: toAcc ? accountDisplayLabel(toAcc as never) : (rc.parsed!.beneficiary?.accountName ?? undefined),
                  });
                } else pf.narration = fullN;
                lastMoneyRef.current = { parsed: rc.parsed!, direction };
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
            const prefsNow = getOcrPrefs();
            /** Gemini/AI: local-language text (Devanagari ya koi bhi non-English) — translation offer. */
            const aiLocalText = raw.engine === "gemini" && looksNonEnglishOcrText(raw.text);
            if (aiLocalText && !prefsNow.translateToEnglish) {
              rExtra.push({
                id: "ocr-language",
                label: "Local language detected",
                value: "Gemini ne kuch text local language (नेपाली/हिन्दी) me padha hai.",
                reason: "Item names, party name aur narration English me chahiye?",
                apply: () => undefined,
              });
              rExtra.push({
                id: "ocr-translate",
                label: "Translate to English",
                value: "Item names, party aur narration English me (numbers same rahenge)",
                apply: () => { setOcrPrefs({ translateToEnglish: true }); flashTranslatePref(true); },
              });
              rExtra.push({
                id: "ocr-translate-default",
                label: "Translate to English & set as default",
                value: "Har slip ka text automatically English me translate hoga — OCR settings se reset kar sakte hain",
                apply: () => { setOcrPrefs({ translateToEnglish: true }); flashTranslatePref(true); },
              });
            } else if (prefsNow.translateToEnglish && aiLocalText) {
              rExtra.push({
                id: "ocr-translate-off",
                label: "Translation is ON",
                value: "Har slip ka text English me translate ho raha hai",
                apply: () => { setOcrPrefs({ translateToEnglish: false }); flashTranslatePref(false); },
              });
            }
            const dupCheckOff = reason === "handoff" && handoffDupCheckOffRef.current;
            const dup = dupCheckOff ? null : findDuplicateByRef(M.vouchers, rc.parsed?.txnId, rc.parsed?.referenceId, rc.parsed?.chequeNumber);
            /* Dr = Cr and Grand Total vs amount in words (AI): a failure is the runner's "amount mismatch". */
            const moneyAmountCheck = raw.ai ? aiAmountCheck(raw.ai.data) : null;
            const moneyAmountMismatch = !!moneyAmountCheck && !moneyAmountCheck.ok;
            if (moneyAmountMismatch && canFill) {
              const label = ocrRunStrings().amountMismatch;
              if (!rMissing.includes(label)) rMissing.push(label);
            }
            if (dup) {
              rExtra.push({
                id: "duplicate-ref",
                label: "Possible duplicate",
                value: `Txn/Ref/Cheque number already appears on voucher ${dup.voucherNumber || dup.id}${dup.type ? ` (${niceType(String(dup.type))})` : ""}`,
                blocked: "This reference, transaction, or cheque number is already on a saved voucher",
                apply: () => undefined,
              });
            }

            if (direction === "contra" && canFill && allowWrite && opt.validateAutoPost) {
              for (const issue of opt.validateAutoPost()) {
                if (issue && !rMissing.includes(issue)) rMissing.push(issue);
              }
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
            setSuggestions(addPrecomputedEnglish(sg, raw));
            if (reason === "refresh") { setDoneIds(new Set()); setDismissedKeys(new Set()); setDismissedMissingKeys(new Set()); }
            if (sg.some((x) => !x.blocked) || rMissing.length) setSugOpen(true);
            setMissingNow(rMissing);
            setDebugInfo({
              text: [`--- OCR build ${OCR_BUILD} | OCR engine: ${raw.engine ?? "online"}${raw.engineNote ? ` (${raw.engineNote})` : ""} | document: ${rc.format} (${Math.round(rc.confidence * 100)}%)${lowConf ? " | LOW CONFIDENCE" : ""} ---`, `Type: ${rc.voucherType ?? `undecided (${types.join(" / ")})`} (${Math.round(rc.typeConfidence * 100)}%)${raw.ai?.data.voucher_type ? ` | Gemini said: ${raw.ai.data.voucher_type}${raw.ai.data.voucher_type_reason ? ` — ${raw.ai.data.voucher_type_reason}` : ""}` : ""}`, why, rc.narration ? `Narration: ${rc.narration}` : "", rc.otherCharge ? `Charge: ${rc.otherCharge.amount}` : "", rc.statusWarning ?? "", moneyAmountCheck && !moneyAmountCheck.ok ? `Amount check: ${moneyAmountCheck.reasons.join("; ")}` : "", "--- OCR text ---", raw.text, raw.printedText ? `--- Printed text (AI raw_text) ---\n${raw.printedText}` : ""].filter(Boolean).join("\n"),
              meanConfidence: raw.meanConfidence, reasons: [why], filled: rFilled, missing: rMissing,
            });
            const here = !!(rc.voucherType && (rc.voucherType === cur || sameVoucherBucket(cur, rc.voucherType)));
            toast.success(`OCR: ${rc.format === "connectips" ? "connectIPS" : rc.format.replace(/_/g, " ")} detected`, {
              id: tId, duration: 6000, position: "top-right",
              description: rFilled.length || rMissing.length
                ? `Filled: ${rFilled.join(", ") || "nothing"}${rMissing.length ? ` | Missing: ${rMissing.map((x) => x.split(" (")[0]).join(", ")}` : ""}`
                : here && highUnique ? `${niceType(cur)} is the right voucher.` : !highUnique ? "Cannot detect voucher type — stay on the current voucher or pick one." : `Suggested: ${types.map(niceType).join(" / ")}.`,
            });
            if ((!reuse?.manualTypeSwitch || manualRunnerSwitch) && (reason === "auto" || reason === "handoff") && autoPostWanted(reason) && !opt.isEditing && opt.adapter.autoPost && apScheduledForRef.current !== raw) {
              /* User-typed values from the previous tab go in before the check, so they are saved and never overwritten. */
              if (manualRunnerSwitch) applyCarriedUserValues();
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
                startAutoPostCountdown();
              } else {
                const details = rMissing.length
                  ? `Needs review: ${rMissing.join(", ")}.`
                  : "Required fields are missing, type is uncertain, or the document needs review.";
                toast.message("OCR Auto Post skipped", { id: `${toastKeyRef.current}-skip`, description: details, duration: 5000 });
                /* Pending type switch: if it auto-fires, the target form re-runs this handoff (wait, no event).
                 * If it will not (ambiguous / low confidence / auto-switch off), tell the runner so it never hangs. */
                const moneySwitchPending = switchPendingIn(sg);
                const moneyAutoSwitch = moneySwitchPending && switchWillAutoFire(sg);
                const moneyMissing = moneySwitchPending ? [...rMissing, ocrRunStrings().voucherTypeSwitchPending] : rMissing;
                if (reason === "handoff" && handoffAutoPostRef.current && moneyAutoSwitch) armRunnerSwitchWatch();
                if (reason === "handoff" && handoffAutoPostRef.current && moneyMissing.length && !moneyAutoSwitch) {
                  sendRunnerMissing({ companyId: opt.companyId, missing: [...new Set(moneyMissing)], fieldKeys: ocrMissingFieldKeys(moneyMissing), voucherType: opt.adapter.voucherType, itemAmountMismatch: moneyAmountMismatch, amountCheckReasons: moneyAmountCheck?.reasons ?? [] });
                }
              }
            }
            return;
          }
        }
        // The voucher form's option list can lag one render behind the shared master hook
        // when the gallery runner opens the form. Merge both sources so the first handoff
        // scan sees the same current party masters that a later manual Refresh sees.
        const partyMap = new Map<string, OcrPartyLike>();
        for (const party of mastersRef.current.parties ?? []) partyMap.set(party.id, { ...party });
        for (const party of opt.parties ?? []) {
          const current = partyMap.get(party.id);
          partyMap.set(party.id, current ? {
            ...current,
            ...party,
            pan: party.pan || current.pan,
            panNo: party.panNo || current.panNo,
            vatNo: party.vatNo || current.vatNo,
            address: party.address || current.address,
            billingAddress: party.billingAddress || current.billingAddress,
            phone: party.phone || current.phone,
            mobile: party.mobile || current.mobile,
          } : party);
        }
        const currentParties = [...partyMap.values()];
        const bill = parseBill(raw, { kind: opt.adapter.partySide === "seller" ? "purchase" : "sale", parties: currentParties, items: opt.items, ownPan: own.pan, ownName: own.name });
        // The parser and AI matcher use conservative fuzzy thresholds. Before raising a
        // "create party" suggestion, honor an unambiguous normalized exact-name match
        // from the same selectable master list used by the Customer/Supplier combobox.
        if (bill.partyId?.status !== "fill" && bill.partyName?.value) {
          const normalizedPartyName = normalizeName(bill.partyName.value);
          const exactPartyMatches = normalizedPartyName
              ? currentParties.filter((party) =>
                isOcrSelectableParty(party) &&
                [party.name, party.aliasName].some((name) => name && normalizeName(name) === normalizedPartyName),
              )
            : [];
          if (exactPartyMatches.length === 1) {
            bill.partyId = { value: exactPartyMatches[0].id, status: "fill", confidence: 0.99 };
            bill.debug?.push(`Party: matched "${exactPartyMatches[0].name}" by exact normalized name`);
          }
        }
        if (lowConf) {
          const note = "Image is not clear — please confirm";
          const flag = (f?: { status: string; note?: string }) => { if (f && f.status === "fill") { f.status = "flag"; f.note = f.note ? `${f.note}; ${note}` : note; } };
          flag(bill.date); flag(bill.dueDate); flag(bill.amount); flag(bill.total); flag(bill.subTotal); flag(bill.vat); flag(bill.discount); flag(bill.lineItems); flag(bill.partyId); flag(bill.billNo);
          bill.debug?.push(`Low OCR confidence (${Math.round(raw.meanConfidence)}%) — fields offered for confirmation, not auto-filled`);
        }
        // Counter-party block identifiers from the parser (never our own buyer block); legacy scan as fallback
        const identifiers = bill.identifiers ?? extractIdentifiers(raw.lines.map((l) => l.text), opt.ownPan, bill.pan?.value);
        // Exact PAN is the strongest party identity across every voucher adapter.
        // Apply it again at the form boundary so no voucher-specific name matcher can
        // leave a false "Party not found" when OCR and one selectable master share PAN.
        const printedPartyPan = devanagariDigitsToAscii(String(identifiers.pan ?? bill.pan?.value ?? "")).replace(/\D/g, "");
        if (printedPartyPan.length === 9) {
          const panHits = currentParties.filter((party) =>
            isOcrSelectableParty(party) &&
            [party.pan, party.panNo, party.vatNo].some((value) => devanagariDigitsToAscii(String(value ?? "")).replace(/\D/g, "") === printedPartyPan),
          );
          if (panHits.length === 1) {
            bill.partyId = { value: panHits[0].id, status: "fill", confidence: 1 };
            bill.debug?.push(`Party: selected "${panHits[0].name}" by exact PAN ${printedPartyPan} across voucher types`);
          } else if (panHits.length > 1) {
            bill.partyId = undefined;
            bill.debug?.push(`Party: PAN ${printedPartyPan} belongs to multiple selectable masters; left for review`);
          }
        }
        // HARD GUARD: our own company is never the party. Fall back to the other PAN printed on the bill.
        if (isOwnCompany(bill.partyName?.value, identifiers.pan, own)) {
          const alt = otherPans(raw.text + "\n" + (raw.altText ?? ""), own.pan)[0];
          bill.debug?.push(`Own company (${own.name ?? "-"} / ${own.pan ?? "-"}) was picked as party - dropped${alt ? `; using other PAN ${alt}` : ""}`);
          if (isOwnCompany(bill.partyName?.value, null, own)) bill.partyName = undefined;
          identifiers.pan = alt ?? undefined;
          if (bill.partyId?.value && currentParties.some((p) => p.id === bill.partyId!.value && isOwnCompany(p.name, p.pan, own))) bill.partyId = undefined;
          if (alt && !bill.partyId) {
            const hits = currentParties.filter((p) => isOcrSelectableParty(p) && [p.pan, p.panNo, p.vatNo].some((value) => String(value ?? "").replace(/\D/g, "") === alt));
            if (hits.length === 1) bill.partyId = { value: hits[0].id, status: "fill", confidence: 0.99 };
          }
        }
        setIds(identifiers);
        setReceiptTarget(null);
        setLastBill(bill);

        // Learned template (identifier → account) when strict match failed
        if (bill.partyId?.status !== "fill" && opt.companyId) {
          const tp = lookupTemplateParty(opt.companyId, identifiers);
          const tpRow = tp ? currentParties.find((p) => p.id === tp) : undefined;
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
          const row = currentParties.find((p) => p.id === bill.partyId!.value);
          if (!isOcrSelectableParty(row)) {
            bill.debug?.push(`Party: picked "${row?.name ?? bill.partyId.value}" is not selectable (${!row ? "not in party list" : row.isFrozen ? "frozen" : row.isDeleted ? "deleted" : "system ledger"}) - not written`);
            bill.partyId = undefined;
          }
        }

        const filled: string[] = [];
        const missing: string[] = [];
        const A = opt.adapter;
        const F = opt.form;
        const vat = bill.vat?.value ?? 0;
        const vatMentioned = billShowsVat(raw.text, vat);
        const vatTax = findVat13(opt.taxes);
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
        /* Due date: printed > bill credit days > party credit days > Common Setting default days (Sale / Purchase).
         * Never required: when nothing applies the field stays as the form has it. */
        if (A.dueDate && bill.dueDate?.status !== "fill" && (A.voucherType === "sale" || A.voucherType === "purchase")) {
          const kind = A.voucherType;
          const partyRow = bill.partyId?.status === "fill" ? (mastersRef.current.parties ?? []).find((p) => p.id === bill.partyId!.value) ?? opt.parties.find((p) => p.id === bill.partyId!.value) : undefined;
          const runnerDays = reason === "handoff" ? handoffDueDaysRef.current?.[kind] : undefined;
          const due = resolveOcrDueDate({
            printedDue: bill.dueTerms?.printedDue ?? null,
            billCreditDays: bill.dueTerms?.creditDays ?? null,
            billDate: bill.date?.status === "fill" ? bill.date.value : null,
            partyCreditDays: partyCreditDaysOf(partyRow),
            defaultDays: runnerDays !== undefined ? runnerDays : defaultDueDaysFor(opt.companyId, kind),
          });
          if (due) {
            const S = ocrRunStrings();
            bill.dueDate = { value: due.date, status: "fill", confidence: due.source === "printed" ? 0.95 : 0.9, note: fmtOcr(S.dueSource[due.source], { days: due.days ?? "" }) };
            bill.debug?.push(`Due date: ${due.date.toDateString()} (${due.source}${due.days != null ? ` ${due.days} days` : ""})`);
          }
        }
        if (A.dueDate && bill.dueDate?.status === "fill" && canWrite(A.dueDate)) {
          write(A.dueDate, bill.dueDate.value);
          filled.push(bill.dueDate.note ? `${ocrRunStrings().dueDate} (${bill.dueDate.note})` : ocrRunStrings().dueDate);
        }

        // Line items (+ discount) only when totals reconciled
        if (A.lineItems) {
          if (bill.lineItems?.status === "fill") {
            if (vatMentioned && !vatTax) missing.push("VAT tax account (see Suggestions)");
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
                  amount: r.amount,
                  ...(vatMentioned && vatTax ? { taxAccountId: vatTax.id } : {}),
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
                filled.push(`Line items (${rows.length})${vatMentioned && vatTax ? " + VAT 13%" : ""}`);
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
        const selectedPayeeType = A.party?.payeeTypePath ? String(F.getValues(A.party.payeeTypePath) ?? "") : "";
        const partyApplicable = !A.party?.allowedPayeeTypes || !selectedPayeeType || A.party.allowedPayeeTypes.includes(selectedPayeeType);
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
        if (A.party && partyApplicable && !curParty && bill.partyId?.status === "flag" && bill.partyId.value) {
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
        if (A.party && partyApplicable && !curParty && !billIsOwn && (bill.partyName?.value || identifiers.pan)) {
          sg.push({
            id: "create-party", label: "Create new party", value: [bill.partyName?.value, identifiers.pan && `PAN ${identifiers.pan}`, identifiers.phones[0]].filter(Boolean).join(" · "),
            confidence: pct(bill.partyName?.confidence), reason: "No existing account matched by PAN / name / phone / email - opens Create Party prefilled; you confirm Save",
            deferred: true,
            apply: (ctx) => {
              const sourceName = bill.partyName?.value ?? "";
              const englishName = ctx?.englishValue?.split(" · ")[0] || translatedOcrText(sourceName, raw.ai?.data.english_translations);
              const chosenName = ctx?.language === "english" ? englishName ?? sourceName : sourceName;
              const prefill = partyNamePrefill(chosenName);
              setCreatePrefill({
                ...prefill, aliasName: chosenName !== sourceName ? sourceName : prefill.aliasName, pan: identifiers.pan ?? "", phone: identifiers.phones[0] ?? "", email: identifiers.emails[0] ?? "",
                address: identifiers.address ?? "",
                accountTypeId: A.partySide === "seller" ? PARTY_SYSTEM_CREDITORS_ID : PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
                extra: [identifiers.contactPerson && `Contact: ${identifiers.contactPerson}`, identifiers.bankAccountNos[0] && `Bank A/c: ${identifiers.bankAccountNos[0]}`, identifiers.regNo && `Reg No: ${identifiers.regNo}`].filter(Boolean).join(" | "),
              });
            },
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
            apply: () => {
              const taxId = vatTax?.id ?? pendingRef.current.tax;
              write(A.lineItems!.path, rows.map((r) => ({ ...A.lineItems!.makeEmpty(), type: "item", itemId: r.itemId ?? "", quantity: r.quantity, rate: r.rate, unit: r.itemId ? resolveOcrItemUnit(optsRef.current.items.find((it) => it.id === r.itemId) as never, r.unit, A.partySide === "seller" ? "purchase" : "sale") : r.unit ?? "", amount: r.amount, ...(vatMentioned && taxId ? { taxAccountId: taxId } : {}) })));
              if (pendingRef.current.tax === taxId) pendingRef.current.tax = undefined;
            },
          });
        }
        if (A.lineItems) {
          (bill.lineItems?.value ?? []).forEach((r, index) => {
            if (r.itemId) return;
            const englishDescription = translatedOcrText(r.description, raw.ai?.data.english_translations);
            const englishItemName = englishDescription ? cleanItemName(englishDescription) : undefined;
            sg.push({
              id: `create-item-${index}`, label: `Create item: ${cleanItemName(r.description)}`,
              value: [cleanItemName(r.description), r.unit, `rate ${r.rate}`].filter(Boolean).join(" | "),
              englishValue: englishItemName ? [englishItemName, r.unit, `rate ${r.rate}`].filter(Boolean).join(" | ") : undefined,
              englishMasterName: englishItemName,
              confidence: 0.8, reason: "Create opens a prefilled item form. After saving, the item is selected on line " + (index + 1),
              deferred: true,
              apply: async (ctx) => {
                const row = ctx?.language === "english"
                  ? { ...r, description: ctx.englishValue?.split(" | ")[0] || translatedOcrText(r.description, raw.ai?.data.english_translations) || r.description }
                  : r;
                if (ctx?.mode === "auto") { await itemCreateApiRef.current.auto(index, row); return; }
                await itemCreateApiRef.current.manual(index, row);
              },
            });
          });
          // Only actual bill evidence can trigger VAT handling; AI type explanations are excluded.
          if (vatMentioned) {
            const rowsNow = (F.getValues(A.lineItems.path) as Record<string, unknown>[] | undefined) ?? [];
            const applied = !!vatTax && rowsNow.length > 0 && rowsNow.every((r) => r.taxAccountId === vatTax.id);
            if (!vatTax) {
              sg.push({
                id: "create-vat", label: `Create VAT ${billVatPercent(vat, bill.lineItems?.value?.reduce((a, r) => a + r.amount, 0))}% tax account`, value: vat ? `bill VAT ${vat}` : "VAT printed on bill",
                confidence: bill.vat?.confidence ?? 0.6, reason: "No 13% tax account exists - opens Create Tax prefilled \"VAT 13%\" (set rate 13); you confirm Save, then it is applied to all lines",
                deferred: true,
                apply: () => { setVatPct(billVatPercent(vat, bill.lineItems?.value?.reduce((a, r) => a + r.amount, 0))); setCreateTaxOpen(true); },
              });
            } else if (!applied && bill.lineItems?.status === "fill") {
              sg.push({
                id: "vat", label: `Apply ${vatTax.name ?? "VAT 13%"} on all lines`, value: `VAT ${vat}`, confidence: bill.vat?.confidence ?? 0.6, reason: bill.vat?.status === "fill" ? "Reconciled with totals" : "Totals not reconciled",
                apply: () => {
                  const rows = (F.getValues(A.lineItems!.path) as Record<string, unknown>[] | undefined) ?? [];
                  write(A.lineItems!.path, rows.map((r) => ({ ...r, taxAccountId: vatTax.id })));
                },
              });
            }
            if (!vatTax && opt.taxes.length) {
              sg.push({
                id: "choose-vat", label: "Choose existing tax account", value: `${opt.taxes.length} tax account(s) available`,
                reason: "Select the tax account printed on the bill; you can also create a new VAT account.",
                deferred: true,
                apply: () => {
                  setVatPickerId(opt.taxes[0]?.id ?? "");
                  setVatPickerOpen(true);
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
        /* Journal: Gemini's Dr/Cr lines -> journal rows (each ledger looked up in the master list its kind names). */
        if (A.journalLines) {
          const S = ocrRunStrings();
          const aiLines = raw.ai?.data.lines ?? [];
          if (aiLines.length >= 2) {
            const Mj = mastersRef.current;
            const named = (xs: readonly unknown[] | undefined) => (xs ?? []).filter((x) => !(x as { isDeleted?: boolean }).isDeleted).map((x) => {
              const r = x as { id: string; name?: string; accountName?: string; aliasName?: string };
              return { id: r.id, name: String(r.name ?? r.accountName ?? ""), aliasName: r.aliasName };
            });
            const mapped = mapAiJournalLines(aiLines, {
              accounts: (Mj.accounts ?? []).filter((a) => !a.isDeleted).map((a) => ({ id: a.id, accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType, branch: (a as { branch?: string }).branch, aliasName: (a as { aliasName?: string }).aliasName })),
              parties: named((Mj.parties ?? []).filter((p) => isOcrSelectableParty(p as never))),
              staff: named(Mj.staff as readonly unknown[]),
              ledgers: named(Mj.expense as readonly unknown[]),
              taxes: named(opt.taxes as readonly unknown[]),
            });
            if (canWrite(A.journalLines.path)) {
              write(A.journalLines.path, mapped.rows);
              filled.push(S.journalLines);
            }
            for (const u of mapped.unmatched) missing.push(fmtOcr(S.journalLineAccount, { n: u.index + 1, name: u.name }));
          } else {
            missing.push(S.journalNoLines);
          }
        }
        setSuggestions(addPrecomputedEnglish(sg, raw));
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
                `--- OCR build ${OCR_BUILD} | ${raw.engine === "gemini" ? "AI (Gemini) voucher JSON" : raw.engine === "azure" ? "online Azure Read" : raw.engine === "google" ? "online Google Vision" : "online provider"} | input ${inputNoteRef.current} ---`,
                `OCR engine: ${raw.engine ?? "online"}${raw.engineNote ? ` (${raw.engineNote})` : ""}`,
                `--- dev dump: input ${inputNoteRef.current} | page ${raw.pageWidth ?? "?"}x${raw.pageHeight}px | ${raw.lines.length} lines ---`,
                ...raw.lines.map((l, i) => `L${i} y=${Math.round(l.y ?? 0)}: ${l.words?.length ? l.words.map((w) => `${w.text}@${Math.round(w.x0)}`).join(" ") : `(no boxes) ${l.text}`}`),
                `--- 2nd pass (sparse) ---`,
                ...(raw.altText ?? "").split(/\r?\n/).filter((t) => t.trim()),
              ]
            : [];
        if (process.env.NODE_ENV !== "production") console.debug("[OCR] dump\n" + [...(bill.debug ?? []), ...devDump].join("\n"));
        setDebugInfo({ text: raw.printedText ? `${raw.text}\n--- Printed text (AI raw_text) ---\n${raw.printedText}` : raw.text, meanConfidence: raw.meanConfidence, reasons: [...(bill.debug ?? []), ...devDump], filled: [...filled], missing: [...new Set(missing)] });
        toast.success(filled.length ? `OCR filled by ${seen.length ? seen[seen.length - 1] : "OCR"}: ${filled.join(", ")}` : "OCR: nothing could be filled safely", { id: tId, duration: 3000, position: "top-right" });
        /* Fresh scan: bump the counter so the Pocket AI panel (if open) starts a new chat for THIS bill. */
        setFillSeq((n) => n + 1);

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

        if ((!reuse?.manualTypeSwitch || manualRunnerSwitch) && (reason === "auto" || reason === "handoff") && autoPostWanted(reason) && !opt.isEditing && apScheduledForRef.current !== raw) {
          /* Manual runner tab switch: carried user values first, then validate the CURRENT form (like Resume). */
          if (manualRunnerSwitch) applyCarriedUserValues();
          const resumeCurrentForm = reuse?.resumeCurrentForm === true || manualRunnerSwitch;
          const voucherRowsForCheck = A.lineItems ? ((F.getValues(A.lineItems.path) as Array<Record<string, unknown>> | undefined) ?? []) : [];
          const unresolvedItems = A.lineItems
            ? resumeCurrentForm
              ? voucherRowsForCheck.map((line, index) => !String(line.itemId || line.serviceId || "").trim() ? `Item on line ${index + 1}` : "").filter(Boolean)
              : bill.lineItems?.status === "fill"
                ? bill.lineItems.value.map((line, index) => !line.itemId ? `Item on line ${index + 1}` : "").filter(Boolean)
                : []
            : [];
          const billItemRowCount = bill.lineItems?.value.length;
          const voucherItemRowCount = A.lineItems ? voucherRowsForCheck.length : undefined;
          const itemRowCountMismatch = typeof billItemRowCount === "number" && typeof voucherItemRowCount === "number" && billItemRowCount !== voucherItemRowCount;
          const billItemAmount = bill.lineItems?.value.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
          const voucherItemAmount = voucherRowsForCheck.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
          const expectedItemAmount = bill.subTotal?.value != null
            ? Number(bill.subTotal.value) + (Number(bill.discount?.value) || 0)
            : bill.total?.value != null
              ? Number(bill.total.value) - (Number(bill.vat?.value) || 0) + (Number(bill.discount?.value) || 0)
              : undefined;
          const rowAmountMismatch = typeof expectedItemAmount === "number" && (bill.lineItems?.value.length ?? 0) > 0 && (
            resumeCurrentForm
              ? Math.abs(voucherItemAmount - expectedItemAmount) > 1
              : Math.abs((billItemAmount ?? 0) - expectedItemAmount) > 1 || Math.abs(voucherItemAmount - expectedItemAmount) > 1
          );
          /* AI cross-check (Dr = Cr, Grand Total vs item sum vs amount in words) is the same runner rule. */
          const aiAmountMismatch = bill.amountCheck?.ok === false;
          const itemAmountMismatch = rowAmountMismatch || aiAmountMismatch;
          const amountMismatchLabel = aiAmountMismatch && !rowAmountMismatch ? [ocrRunStrings().amountMismatch] : [];
          const allowSaveWithoutItems = reason === "handoff" && handoffRunnerJobRef.current
            ? handoffAllowSaveWithoutItemsRef.current
            : manualOcrProfileRef.current.itemRule === "save-without";
          const missingRequiredPaths = (A.requiredPaths ?? [])
            .filter((path) => !(allowSaveWithoutItems && isItemMasterPath(path)))
            .filter((path) => isEmptyVal(F.getValues(path)))
            .map((path) => `Required ${path.split(".").pop()?.replace(/Id$/, "").replace(/([A-Z])/g, " $1").trim() || "field"}`);
          const hasCurrentFieldEdit = (path: string) => {
            const field = F.getFieldState(path);
            return field.isDirty || field.isTouched || filledRef.current.has(path);
          };
          const missingDateInBill = missing.some((field) => /date/i.test(field));
          const missingAmountInBill = missing.some((field) => /amount|total/i.test(field));
          const missingPartyInBill = missing.some((field) => /party|customer|supplier/i.test(field));
          const currentDateOk = !A.date || (!isEmptyVal(F.getValues(A.date)) && (!resumeCurrentForm || !missingDateInBill || hasCurrentFieldEdit(A.date)));
          const currentPartyOk = partyOk && (!resumeCurrentForm || !missingPartyInBill || !A.party || hasCurrentFieldEdit(A.party.path));
          const currentAmountOk = !A.amount || (!isEmptyVal(F.getValues(A.amount)) && (!resumeCurrentForm || !missingAmountInBill || hasCurrentFieldEdit(A.amount)));
          const currentLineItemsOk = !A.lineItems || (!voucherRowsForCheck.length ? false : (allowSaveWithoutItems || unresolvedItems.length === 0));
          const currentLedgerOk = !A.ledgerAccount || !isEmptyVal(F.getValues(A.ledgerAccount.path));
          const rawMissingVatAccount = vatMentioned && !vatTax;
          const currentVatAccountMissing = rawMissingVatAccount && (!voucherRowsForCheck.length || voucherRowsForCheck.some((line) => !String(line.taxAccountId || "").trim()));
          const hasMissingVatAccount = resumeCurrentForm ? currentVatAccountMissing : rawMissingVatAccount;
          const requiredMissing = resumeCurrentForm
            ? [
                ...(A.party && !currentPartyOk ? ["Party"] : []),
                ...(A.date && !currentDateOk ? ["Date"] : []),
                ...(A.lineItems && !voucherRowsForCheck.length ? ["Line items"] : []),
                ...(allowSaveWithoutItems ? [] : unresolvedItems),
                ...(itemRowCountMismatch ? [`Item row count mismatch (bill: ${billItemRowCount}, voucher: ${voucherItemRowCount})`] : []),
                ...(rowAmountMismatch ? [`Item row amount does not match bill amount (rows: ${voucherItemAmount}, bill: ${expectedItemAmount})`] : []),
                ...amountMismatchLabel,
                ...missingRequiredPaths,
                ...(ledgerMissing && !currentLedgerOk ? ["Purchase account"] : []),
                ...(hasMissingVatAccount ? ["VAT tax account"] : []),
                ...(A.amount && !currentAmountOk ? ["Amount"] : []),
                ...(A.accountPath && isEmptyVal(F.getValues(A.accountPath)) ? ["Bank/cash account"] : []),
              ]
            : [
                ...missing.filter((field) => field !== "Bill No"),
                ...(allowSaveWithoutItems ? [] : unresolvedItems),
                ...(itemRowCountMismatch ? [`Item row count mismatch (bill: ${billItemRowCount}, voucher: ${voucherItemRowCount})`] : []),
                ...(rowAmountMismatch ? [`Item row amount does not match bill amount (rows: ${billItemAmount}, bill: ${expectedItemAmount})`] : []),
                ...amountMismatchLabel,
                ...missingRequiredPaths,
                ...(ledgerMissing ? ["Purchase account"] : []),
                ...(A.accountPath && isEmptyVal(F.getValues(A.accountPath)) ? ["Bank/cash account"] : []),
              ];
          const coreOk =
            A.autoPost &&
            currentPartyOk &&
            (resumeCurrentForm ? currentDateOk : (!A.date || filledKeys.has("date"))) &&
            (resumeCurrentForm ? currentLineItemsOk : (!A.lineItems || filledKeys.has("lines") || (allowSaveWithoutItems && voucherRowsForCheck.length > 0))) &&
            !itemRowCountMismatch &&
            !itemAmountMismatch &&
            (unresolvedItems.length === 0 || allowSaveWithoutItems) &&
            (resumeCurrentForm ? currentLedgerOk : !ledgerMissing) &&
            !hasMissingVatAccount &&
            (resumeCurrentForm ? currentAmountOk : (!A.amount || filledKeys.has("amount"))) &&
            (A.requiredPaths ?? []).every((p) =>
              (allowSaveWithoutItems && isItemMasterPath(p)) || !isEmptyVal(F.getValues(p)),
            );
          /* Invoice duplicate gate (the Money path has its own !dup gate): gallery handoff auto-post only,
           * skipped when the runner turned "Check for duplicate vouchers" off. Same fingerprint as the form's
           * live duplicate bubble: date, total, party / ledger, bill no, narration. */
          /* Pending voucher-type switch (same gate as the Money path): never start the save countdown on this form. */
          const invoiceSwitchPending = switchPendingIn(sg);
          const invoiceAutoSwitch = invoiceSwitchPending && switchWillAutoFire(sg);
          let invoiceDup: DuplicateMatch | null = null;
          if (coreOk && !invoiceSwitchPending && reason === "handoff" && handoffAutoPostRef.current && !handoffDupCheckOffRef.current) {
            const strOrUndef = (v: unknown) => String(v ?? "").trim() || undefined;
            const totalForDup = Number(bill.total?.value ?? 0) || voucherItemAmount;
            try {
              invoiceDup = findDuplicateVoucher(mastersRef.current.vouchers as unknown as CandidateVoucher[], {
                type: A.voucherType,
                date: A.date ? F.getValues(A.date) : undefined,
                amount: totalForDup,
                fromAccountId: A.party ? strOrUndef(F.getValues(A.party.path)) : undefined,
                toAccountId: A.ledgerAccount ? strOrUndef(F.getValues(A.ledgerAccount.path)) : undefined,
                narration: A.narration ? String(F.getValues(A.narration) ?? "") : undefined,
                ref: strOrUndef(bill.billNo?.value),
              });
            } catch {
              invoiceDup = null;
            }
          }
          let invoiceDupBlocksSave = false;
          if (invoiceDup) {
            const dupCompanyId = String((profileCompany as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || opt.companyId || "");
            window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-detected", {
              detail: {
                matchId: invoiceDup.id,
                voucherNumber: invoiceDup.voucherNumber,
                summary: invoiceDup.summary,
                dateText: invoiceDup.dateText,
                amount: String(invoiceDup.amount ?? ""),
                reasons: invoiceDup.reasons,
              },
            }));
            const dupAction = await readAutoPostDuplicateAction(dupCompanyId);
            if (dupAction !== "save-anyway") {
              invoiceDupBlocksSave = true;
              const fileUrl = opt.files.find((f): f is string => typeof f === "string") ?? "";
              const fileObj = opt.files.find((f) => typeof f !== "string") as File | undefined;
              window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-block-save", {
                detail: { companyId: dupCompanyId, fileUrl, fileName: fileObj?.name ?? "" },
              }));
            }
          }
          if (coreOk && invoiceDupBlocksSave) {
            /* move-to-duplicates / pause-for-review: the runner moves or pauses this document; no save countdown. */
            apScheduledForRef.current = raw;
          } else if (invoiceAutoSwitch) {
            /* The auto-switch countdown opens the detected type; that form re-runs this handoff and auto-posts there. */
            if (A.autoPost && reason === "handoff" && handoffAutoPostRef.current) armRunnerSwitchWatch();
          } else if (coreOk && !invoiceSwitchPending) {
            apScheduledForRef.current = raw;
            if (F.getValues("isApproved") !== undefined) F.setValue("isApproved", false as never);
            toast.info("OCR Auto Post: saving as UNAPPROVED…", { duration: 2500 });
            // Pre-OCR path: attachment is appended (compressed) only after OCR -> post once it is in state
            startAutoPostCountdown();
          } else {
            const skipNames = [...new Set([...requiredMissing, ...(invoiceSwitchPending ? [ocrRunStrings().voucherTypeSwitchPending] : [])])];
            toast.message("OCR Auto Post skipped", {
              id: `${toastKeyRef.current}-skip`,
              description: A.autoPost ? `Required fields missing - review and save manually.${skipNames.length ? ` (${skipNames.join(", ")})` : ""}` : "This voucher type needs manual review before saving.",
              duration: 5000,
            });
            /* A switch that will not fire by itself: report it so the runner applies its rule instead of waiting forever. */
            if (A.autoPost && reason === "handoff" && handoffAutoPostRef.current) {
              const baseMissing = requiredMissing.length ? requiredMissing : invoiceSwitchPending ? [] : ["Required voucher fields"];
              const fieldNames = [...new Set(invoiceSwitchPending ? [...baseMissing, ocrRunStrings().voucherTypeSwitchPending] : baseMissing)];
              sendRunnerMissing({ companyId: opt.companyId, missing: fieldNames, fieldKeys: ocrMissingFieldKeys(fieldNames), voucherType: A.voucherType, itemRowCountMismatch, itemAmountMismatch, amountCheckReasons: bill.amountCheck?.reasons ?? [] });
            }
          }
        }
      } catch (e) {
        const aborted = ac.signal.aborted || (e as { name?: string })?.name === "AbortError";
        if (aborted) {
          // Stopped by the user or the voucher was closed: no error toast, no fallback engine.
          toast.dismiss(tId);
        } else {
          // Single-engine mode: show WHY it failed in a dialog (not a 5 s toast the user can miss).
          // Friendly text (quota / overloaded / key) + retry hint; raw server message kept as detail.
          const code = ocrAiErrorCode(e);
          const rawMsg = e instanceof Error ? e.message : String(e);
          const friendly = code === "unknown" || code === "network" && !/overloaded|unavailable|503|quota/i.test(rawMsg)
            ? (e instanceof Error ? e.message : String(e))
            : ocrAiErrorText(e);
          const retryAfter = e instanceof OcrAiError || e instanceof OcrRunError ? e.retryAfter : 0;
          if (reason === "handoff" && handoffAutoPostRef.current) {
            const companyId = String((profileCompany as any)?.authoritativeCompanyId || optsRef.current.companyId || "");
            const failureMessage = friendly === rawMsg ? friendly : `${friendly}\nServer detail: ${rawMsg}`;
            window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-scan-failed", {
              /* code / status / retryAfter let the runner tell a 429 rate limit (retry) from quota / key / forbidden
               * (stop) and from "unreadable" (file problem -> failed). See OcrRunError in engine.ts. */
              detail: {
                companyId,
                message: failureMessage,
                code: e instanceof OcrRunError ? e.code : code,
                status: e instanceof OcrRunError || e instanceof OcrAiError ? e.status : 0,
                retryAfter,
                engine: e instanceof OcrRunError ? e.engine : undefined,
              },
            }));
          }
          /* Model names for the popup: server error body first, else the model we asked for; list for the chooser. */
          /* Auto mode reports the cloud provider that really ran (OcrRunError.engine), not just "Online OCR". */
          const failEngine = e instanceof OcrRunError && e.engine === "google" ? "Google"
            : e instanceof OcrRunError && e.engine === "azure" ? "Azure"
            : seen.length ? seen[seen.length - 1] : "OCR";
          const errModels = e as { model?: unknown; fallbackModel?: unknown };
          let failedModel = typeof errModels?.model === "string" && errModels.model ? errModels.model : aiModelName;
          const fallbackModel = typeof errModels?.fallbackModel === "string" ? errModels.fallbackModel : "";
          const failKind = ocrAiFailKind(e);
          /* Chooser: usable Gemini models + Azure / Google Vision (only when their key is configured). */
          let aiModels: OcrAiModelOption[] = [];
          let cloudChoices = { google: false, azure: false };
          if (opt.companyId) {
            try {
              const eo = await loadOcrEngineOptions(opt.companyId);
              if (failEngine === "Gemini" && !failedModel) failedModel = eo.geminiActive;
              /* "Not available for this key": remember it (per company, 1 day) and never offer it again in the chooser. */
              if (failEngine === "Gemini" && failKind === "model" && failedModel) markAiModelUnavailable(opt.companyId, failedModel);
              const blocked = unavailableAiModels(opt.companyId);
              aiModels = eo.geminiModels.filter((m) => !blocked.has(m.id));
              cloudChoices = { google: eo.google, azure: eo.azure };
            } catch { /* chooser stays hidden */ }
          }
          const choiceInput = { engine: failEngine, model: failedModel || undefined, fallbackModel: fallbackModel || undefined, models: aiModels, cloud: cloudChoices };
          setFailPick(ocrFailChoices(choiceInput, ocrRunStrings().fail).find((c) => !c.failed)?.value ?? "");
          setOcrFail({
            ...choiceInput,
            message: friendly,
            /* Raw server text only in the collapsible "Server detail"; the reason line is translated (kind). */
            detail: rawMsg || undefined,
            code,
            retryAfter,
            kind: failKind,
          });
          toast.dismiss(tId);
        }
      } finally {
        if (ocrAbortRef.current === ac) ocrAbortRef.current = null;
        /* Manual type change: the user's own values win over the OCR re-map (no-op if already applied before auto-post). */
        applyCarriedUserValues();
        setRunning(false);
      }
    },
    [canWrite, write, running, switchVoucher, armRunnerSwitchWatch, sendRunnerMissing]
  );

  // Stop holds the active voucher in place. Start reuses the last OCR result
  // against the form's current values, so corrected fields can continue without
  // rescanning the document or picking another queue item.
  useEffect(() => {
    const companyForEvent = () => String((profileCompany as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || optsRef.current.companyId || "");
    const matchesRunnerVoucher = (detail: { companyId?: string; fileUrl?: string; fileName?: string }) => {
      const opt = optsRef.current;
      if (String(detail.companyId || "") !== companyForEvent() || !detail.fileUrl || !opt.files.length) return false;
      return opt.files.some((file) => typeof file === "string"
        ? file.trim() === String(detail.fileUrl).trim()
        : Boolean(detail.fileName && file.name === detail.fileName));
    };
    const onRunnerHold = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileId?: string; fileUrl?: string; fileName?: string; held?: boolean }>).detail;
      if (!detail || !matchesRunnerVoucher(detail) || typeof detail.held !== "boolean") return;
      runnerHeldForHandoffRef.current = detail.held;
      if (detail.held && handoffAutoPostRef.current) {
        cancelAutoPostCountdown();
        // A successful validation may have started its countdown just before
        // Stop was clicked. Reset the guard so Start can validate the edited form.
        apScheduledForRef.current = null;
      }
    };
    const onDuplicateBlocksSave = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileUrl?: string; fileName?: string }>).detail;
      if (!detail || !matchesRunnerVoucher(detail)) return;
      // Runner turned "Check for duplicate vouchers" off: a duplicate never stops this voucher's save.
      if (handoffDupCheckOffRef.current) return;
      // Duplicate action (move or pause) wins over the independent OCR save timer.
      // Otherwise the form can save while the runner is still moving the file.
      cancelAutoPostCountdown();
    };
    const onResumeCurrentVoucher = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileId?: string; fileUrl?: string; fileName?: string; forceRetry?: boolean }>).detail;
      const opt = optsRef.current;
      if (!detail?.fileId || !matchesRunnerVoucher(detail)) return;
      runnerHeldForHandoffRef.current = false;
      handoffAutoPostRef.current = true;
      apScheduledForRef.current = null;
      const raw = lastRawRef.current;
      /* Runner auto-resume fires on any form change, including OCR's own writes. If the form is exactly as it was
       * when this scan was reported incomplete, do not re-apply OCR (that writes again -> resume again -> loop):
       * repeat the same answer so the runner stays paused quietly. */
      const lastMissing = lastRunnerMissingRef.current;
      if (!detail.forceRetry && raw && lastMissing && lastMissing.raw === raw && lastMissing.sig === formSig()) {
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-required-fields-missing", { detail: lastMissing.detail })), 0);
        return;
      }
      void (raw
          ? run("handoff", { raw, resumeCurrentForm: true })
        : run("handoff", { enginePref: handoffEnginePrefRef.current, cloudProvider: handoffCloudProviderRef.current }));
    };
    window.addEventListener("pl:gallery:auto-post-current-voucher-hold", onRunnerHold);
    window.addEventListener("pl:gallery:auto-post-duplicate-block-save", onDuplicateBlocksSave);
    window.addEventListener("pl:gallery:auto-post-resume-current-voucher", onResumeCurrentVoucher);
    return () => {
      window.removeEventListener("pl:gallery:auto-post-current-voucher-hold", onRunnerHold);
      window.removeEventListener("pl:gallery:auto-post-duplicate-block-save", onDuplicateBlocksSave);
      window.removeEventListener("pl:gallery:auto-post-resume-current-voucher", onResumeCurrentVoucher);
    };
  }, [cancelAutoPostCountdown, profileCompany, run, formSig]);

  // Voucher-type switch hand-off: receive the attachment, then OCR it here.
  const handoffRunRef = useRef<{ raw?: OcrRawResult; selectedIds?: string[]; autoPost?: boolean; autoPostSeconds?: number; overwriteEdited?: boolean; allowSaveWithoutItems?: boolean; manualTypeSwitch?: boolean; enginePref?: import("./prefs").OcrEnginePref; cloudProvider?: "google" | "azure" } | null>(null);
  // Files handed over by a voucher switch; kept briefly so a form's own "new voucher" hydration (setFiles([]) in an effect
  // that runs AFTER this hook's effect) cannot wipe them.
  const handoffFilesRef = useRef<{ files: (File | string)[]; until: number } | null>(null);
  useEffect(() => {
    if (!o.setFiles || o.isEditing) return;
    // only a form of the switch TARGET type takes the parked bill; a remount of this same form gets its session back
    const formType = o.currentVoucherType ?? o.adapter.voucherType;
    const h = takeOcrHandoff(formType) ?? resumeOcrSession(formType);
    if (h?.files.length) {
      handoffRunRef.current = { raw: h.raw, selectedIds: h.selectedIds, autoPost: h.autoPost, autoPostSeconds: h.autoPostSeconds, overwriteEdited: h.overwriteEdited, allowSaveWithoutItems: h.allowSaveWithoutItems, manualTypeSwitch: h.manualTypeSwitch, enginePref: h.enginePref, cloudProvider: h.cloudProvider };
      handoffRunnerJobRef.current = h.runnerJob === true;
      handoffAutoPostImmediateRef.current = h.runnerJob === true && h.autoPostImmediate === true;
      handoffAutoPostRef.current = h.autoPost === true;
      handoffAutoPostOverrideRef.current = h.autoPost;
      handoffAutoPostSecondsRef.current = h.autoPostSeconds;
      handoffOverwriteEditedRef.current = h.overwriteEdited;
      handoffAllowSaveWithoutItemsRef.current = h.allowSaveWithoutItems === true;
      handoffEnginePrefRef.current = h.enginePref;
      handoffCloudProviderRef.current = h.cloudProvider;
      handoffDupCheckOffRef.current = h.checkDuplicateVouchers === false;
      setRunnerDuplicateCheckOff(handoffDupCheckOffRef.current);
      handoffDueDaysRef.current = h.defaultDueDays;
      handoffUserValuesRef.current = h.userValues;
      handoffFilesRef.current = { files: h.files, until: Date.now() + 2500 };
      linkOcrOriginal(h.files[0], h.original ?? null);
      o.setFiles(h.files);
      const setF = o.setFiles;
      window.setTimeout(() => { const g = handoffFilesRef.current; if (g && Date.now() < g.until) setF(g.files); }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The runner's "duplicate check off" belongs to this voucher only: clear it when the form closes.
  useEffect(() => () => { if (handoffDupCheckOffRef.current) setRunnerDuplicateCheckOff(false); }, []);
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
      void (h.raw ? run("handoff", { raw: h.raw, selectedIds: h.selectedIds, manualTypeSwitch: h.manualTypeSwitch }) : run("handoff", { enginePref: h.enginePref, cloudProvider: h.cloudProvider }));
    }
  }, [o.files, visible, run]);

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

  const runApply = useCallback(async (list: OcrSuggestion[], language?: "original" | "english", englishValue?: string) => {
    const sw = list.find((s) => s.id === "switch");
    if (sw) {
      setSugOpen(false);
      await sw.apply({ selectedIds: list.filter((s) => s.id !== "switch").map((s) => s.id), language, englishValue });
      return;
    }
    for (const s of list.filter((x) => !x.deferred)) await s.apply({ selectedIds: [], language, englishValue });
    setDoneIds((p) => new Set([...p, ...list.map((x) => x.id)]));
    for (const s of list.filter((x) => x.deferred)) await s.apply({ selectedIds: [], language, englishValue });
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
    if (!autoSwitchOn || manualTypeSwitchRef.current || !visible || !sugOpen || !switchTarget || !sw || sw.blocked || !swSure || swCancelledFor === suggestions || swFiredForRef.current === suggestions) {
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
        const createExpense = b.items.find((x) => x.id === "create-expense-account");
        if (createExpense) {
          const existingExpense = b.items.find((x) => x.id.startsWith("use-expense-account-"));
          b.title = `${existingExpense ? "Confirm expense account" : "Expense account not found"} — choose or create “${createExpense.value}”?`;
          b.anchor = "expense-account";
        }
        if (b.key === "lines" && ci) b.anchor = `lines#${ci.id.slice("create-item-".length)}`;
        if (b.items.some((x) => x.id === "switch")) {
          b.title = `${b.items.find((x) => x.id === "switch")!.label}? (Added Document looks like a different voucher type)`;
          // anchor to the target voucher-type tab (e.g. Purchase); falls back to the tab row / OCR bar
          if (switchTarget) b.anchor = `voucher-type-${switchTarget}`;
          if (swCount != null) b.countdown = swCount;
        }
        b.englishTitle = translatedOcrText(b.title, lastRawRef.current?.ai?.data.english_translations);
        if (!b.englishTitle && cp?.englishMasterName) b.englishTitle = b.title.replace(cp.value.split(" · ")[0], cp.englishMasterName);
        if (!b.englishTitle && ci?.englishMasterName) b.englishTitle = b.title.replace(ci.label.replace(/^Create item:\s*/, ""), ci.englishMasterName);
        out.set(k, b);
      }
      // a suggestion bubble replaces the missing bubble on the same field
      for (const k of [...out.keys()]) if (k.startsWith("m:") && out.has(`s:${k.slice(2)}`)) out.delete(k);
    }
    // Sirf info wale (bina action) "OCR could not find" popups nahi dikhte; action wale (Apply/Create/Switch) bubbles rehte hain.
    return [...out.values()].filter((b) => b.kind !== "missing");
  }, [liveBubbles, sugOpen, switchTarget, lastBill, swCount]);

  const panel = useMemo(
    () =>
      visible ? (
        <>
          <OcrFieldBubbles
            bubbles={bubbles}
            onApply={(sg, mode, language, englishValue) => {
              if (sg.id !== "switch") cancelSwitchCountdown();
              if (sg.id.startsWith("create-item-") && mode) { void sg.apply({ selectedIds: [], mode, language, englishValue }); return; }
              void runApply([sg], language, englishValue);
            }}
            onCreateAllItems={(items, language) => { cancelSwitchCountdown(); void itemCreateApiRef.current.all(items, language); }}
            onDismiss={(b) => {
              cancelSwitchCountdown();
              if (b.kind === "missing") setDismissedMissingKeys((p) => new Set([...p, b.key]));
              else setDismissedKeys((p) => new Set([...p, ...b.items.map((x) => x.id)]));
            }}
          />
          <Dialog open={possibleBankCharge != null} onOpenChange={(open) => { if (!open && possibleBankChargeResolverRef.current) resolvePossibleBankCharge(false); }}>
            <DialogContent
              overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
              className="!z-[121] max-w-sm"
              onFocusOutside={(event) => event.preventDefault()}
            >
              <DialogHeader>
                <DialogTitle>Possible bank transfer charge</DialogTitle>
                <DialogDescription>
                  This looks like a transfer between your own bank accounts. Does the Rs. {possibleBankCharge ?? 0} remainder represent a bank charge included in the total? Yes will split it out without increasing the source account total.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => resolvePossibleBankCharge(false)}>No, keep as is</Button>
                <Button type="button" onClick={() => resolvePossibleBankCharge(true)}>Yes, split out charge</Button>
              </div>
            </DialogContent>
          </Dialog>
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
                className="!z-[121] w-[calc(100vw-1.5rem)] max-w-lg overflow-x-hidden [&>*]:min-w-0"
                onFocusOutside={(e) => e.preventDefault()}
              >
                {(() => {
                  /* All text from ocrRunStrings (UI language); raw server text only under "Server detail". */
                  const FS = ocrRunStrings().fail;
                  const kind: OcrFailKind = ocrFail.kind ?? (ocrFail.code === "quota" ? "quota" : "other");
                  const ra = ocrFail.retryAfter ?? 0;
                  const wait = ra > 0 ? (ra < 60 ? fmtOcr(FS.waitSec, { n: ra }) : fmtOcr(FS.waitMin, { n: Math.round(ra / 60) })) : "";
                  const busy = kind === "overloaded" || kind === "fallback_failed" || kind === "timeout" || kind === "network";
                  /* Any failure another usable engine could fix (not sign-in / OCR switched off): offer it for this scan only. */
                  const choices = ocrFailChoices(ocrFail, FS);
                  const canPickModel = kind !== "not_signed_in" && kind !== "disabled" && choices.some((c) => !c.failed);
                  const reasonText = fmtOcr(FS.reason[kind], { model: ocrFail.model || "Gemini", fallback: ocrFail.fallbackModel || FS.otherModel });
                  const reasonLine = `${reasonText}${wait && (busy || kind === "quota") ? ` ${fmtOcr(FS.retryIn, { wait })}` : ""}`;
                  return (
                    <>
                      <DialogHeader>
                        <DialogTitle>{fmtOcr(FS.title, { engine: ocrFail.engine })}</DialogTitle>
                        <DialogDescription>{fmtOcr(FS.onlyEngine, { engine: ocrFail.engine })}</DialogDescription>
                      </DialogHeader>
                      {ocrFail.model ? (
                        <p className="min-w-0 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                          {ocrFail.fallbackModel ? fmtOcr(FS.modelsTried, { model: ocrFail.model, fallback: ocrFail.fallbackModel }) : fmtOcr(FS.modelTried, { model: ocrFail.model })}
                        </p>
                      ) : null}
                      <div className="w-full min-w-0 space-y-2 text-xs">
                        <p className="flex w-full min-w-0 items-start gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-2 py-1.5 font-medium text-amber-950 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{reasonLine}</span>
                        </p>
                        {ocrFail.detail ? (
                          <details className="min-w-0 text-[11px] text-muted-foreground">
                            <summary className="cursor-pointer select-none">{FS.serverDetail}</summary>
                            <p className="mt-1 font-mono [overflow-wrap:anywhere]">{ocrFail.detail}</p>
                          </details>
                        ) : null}
                        <p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                          {kind === "quota" ? FS.hintQuota : busy ? FS.hintBusy : FS.hintOther}
                        </p>
                        {canPickModel ? (
                          <div className="w-full min-w-0 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/40">
                            <label className="block font-medium [overflow-wrap:anywhere]" htmlFor="ocr-fail-model-pick">{FS.pickModel}</label>
                            <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                              <select
                                id="ocr-fail-model-pick"
                                className="h-7 w-full min-w-0 max-w-full flex-1 basis-40 truncate rounded-md border border-input bg-background px-1.5 text-xs"
                                value={failPick}
                                onChange={(ev) => setFailPick(ev.target.value)}
                              >
                                {choices.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.failed ? `${c.label} ${FS.failedTag}` : c.label}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                size="sm"
                                className="h-auto min-h-7 max-w-full shrink-0 whitespace-normal"
                                disabled={!failPick}
                                onClick={() => {
                                  const pick = failPick;
                                  setOcrFail(null);
                                  /* This scan only: saved engine prefs and the saved Gemini model stay as they are. */
                                  if (pick.startsWith("gemini:")) void run("refresh", { aiModel: pick.slice("gemini:".length) });
                                  else if (pick === "cloud:google" || pick === "cloud:azure") void run("refresh", { enginePref: "online", cloudProvider: pick === "cloud:google" ? "google" : "azure" });
                                }}
                              >
                                {FS.readWithModel}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
                        <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal" onClick={() => setOcrFail(null)}>{FS.close}</Button>
                        <Button type="button" size="sm" className="h-auto min-h-8 whitespace-normal" onClick={() => { setOcrFail(null); void run("refresh"); }}>{FS.refresh}</Button>
                      </div>
                    </>
                  );
                })()}
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
                  applyCreatedItemToLine(idx, id, createItemFor.unit);
                  setDoneIds((prev) => new Set([...prev, `create-item-${idx}`]));
                  toast.success(`OCR: item set on line ${idx + 1}`);
                  // A runner handoff pauses when this item is missing. Once the
                  // user creates it, resume this same voucher and revalidate the
                  // current form; unrelated/manual voucher dialogs stay manual.
                  if (handoffAutoPostRef.current && runnerHeldForHandoffRef.current) {
                    window.setTimeout(() => {
                      window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", {
                        detail: {
                          companyId: String((profileCompany as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || optsRef.current.companyId || ""),
                          held: false,
                        },
                      }));
                    }, 0);
                  }
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
              const hasFilledRows = rows.some((r) => String(r.itemId ?? "").trim() || Number(r.amount) > 0 || Number(r.rate) > 0);
              pendingRef.current.tax = hasFilledRows ? undefined : id;
              setMissingNow((prev) => prev.filter((field) => field !== "VAT tax account (see Suggestions)"));
              setDoneIds((prev) => new Set([...prev, "create-vat", "choose-vat", "vat"]));
              toast.success("OCR: VAT applied on all lines");
            }}
          />
          <Dialog open={vatPickerOpen} onOpenChange={setVatPickerOpen}>
            <DialogContent
              overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
              className="!z-[121] max-w-md"
              onFocusOutside={(e) => e.preventDefault()}
            >
              <DialogHeader>
                <DialogTitle>Choose a tax account</DialogTitle>
                <DialogDescription>Select the tax account shown on this bill. It will be applied to the bill lines.</DialogDescription>
              </DialogHeader>
              <Combobox
                options={o.taxes.map((tax) => ({ value: tax.id, label: `${tax.name || "Tax account"} (${tax.rate ?? 0}%)` }))}
                value={vatPickerId}
                onChange={setVatPickerId}
                placeholder="Select tax account"
                searchPlaceholder="Search tax accounts..."
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setVatPickerOpen(false)}>Cancel</Button>
                <Button
                  type="button"
                  disabled={!vatPickerId}
                  onClick={() => {
                    const id = vatPickerId;
                    const LI = optsRef.current.adapter.lineItems;
                    if (LI && id) {
                      const rows = (optsRef.current.form.getValues(LI.path) as Record<string, unknown>[] | undefined) ?? [];
                      const hasFilledRows = rows.some((r) => String(r.itemId ?? "").trim() || Number(r.amount) > 0 || Number(r.rate) > 0);
                      if (rows.length) {
                        write(LI.path, rows.map((r) => ({ ...r, taxAccountId: id })));
                      }
                      pendingRef.current.tax = hasFilledRows ? undefined : id;
                    }
                    setMissingNow((prev) => prev.filter((field) => field !== "VAT tax account (see Suggestions)"));
                    setDoneIds((prev) => new Set([...prev, "choose-vat", "create-vat", "vat"]));
                    setVatPickerOpen(false);
                    toast.success("OCR: tax account applied to bill lines");
                  }}
                >
                  Apply tax
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
    [visible, ids, findOpen, lastBill, o.parties, o.taxes, o.adapter.party, pickParty, bubbles, runApply, possibleBankCharge, resolvePossibleBankCharge, createPrefill, createItemFor, createTaxOpen, vatPickerOpen, vatPickerId, applyCreatedItemToLine, profileCompany, write]
  );

  // AI chat (OCR bar): current bill / last AI JSON / own company, read on demand (refs, no re-render)
  const getBillForChat = useCallback(() => {
    const f = optsRef.current.files[0];
    return f ? loadFirstFile(f, optsRef.current.companyId) : Promise.resolve(null);
  }, []);
  const getAiVoucherJson = useCallback(() => {
    const { form, adapter: A } = optsRef.current;
    const values = form.getValues() as Record<string, unknown>;
    const fields: { key: string; label: string; path: string }[] = [
      ...(A.date ? [{ key: "date", label: "Date", path: A.date }] : []),
      ...(A.dueDate ? [{ key: "due_date", label: "Due date", path: A.dueDate }] : []),
      ...(A.narration ? [{ key: "narration", label: "Narration", path: A.narration }] : []),
      ...(A.amount ? [{ key: "amount", label: "Amount", path: A.amount }] : []),
      ...(A.party ? [{ key: "party_name", label: "Party", path: A.party.path }] : []),
      ...(A.accountPath ? [{ key: "account_name", label: "Bank / cash account", path: A.accountPath }] : []),
      ...(A.fromAccountPath ? [{ key: "account_name", label: "From account", path: A.fromAccountPath }] : []),
      ...(A.toAccountPath ? [{ key: "to_account_name", label: "To account", path: A.toAccountPath }] : []),
    ];
    const masterNames = (list: readonly { id?: string; name?: string; accountName?: string; isDeleted?: boolean }[] | undefined) =>
      (list ?? []).filter((x) => !x.isDeleted).map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? x.accountName ?? "") })).filter((x) => x.id && x.name);
    const M = mastersRef.current as typeof mastersRef.current & { accounts?: readonly { id?: string; accountName?: string; isDeleted?: boolean }[]; parties?: readonly { id?: string; name?: string; isDeleted?: boolean }[] };
    const voucherType = optsRef.current.currentVoucherType ?? A.voucherType;
    const moneyFields = ["voucher_type", "voucher_type_reason", "doc_kind", "bank_flow", "bank_flow_reason", "party_name", "date_ad", "date_bs", "grand_total", "payment_mode", "transfer_mode", "transfer_reference", "transfer_charges", "debit_account", "debit_bank", "credit_account", "credit_bank", "account_holder_name", "beneficiary_name", "lines", "uncertain_fields", "notes"];
    const billFields = ["voucher_type", "voucher_type_reason", "doc_kind", "our_company_role", "party_name", "party_pan", "party_address", "party_phone", "invoice_no", "date_ad", "date_bs", "due_date", "credit_days", "amount_in_words", "items", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "grand_total", "uncertain_fields", "notes"];
    const aiData = lastRawRef.current?.ai?.data as unknown as Record<string, unknown> | undefined;
    const relevantKeys = ["payment_in", "payment_out", "receipt", "payment", "contra", "direct_expense", "direct_income"].includes(String(voucherType)) ? moneyFields : billFields;
    const ocrResult = aiData ? Object.fromEntries(relevantKeys.filter((key) => {
      const value = aiData[key];
      return value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
    }).map((key) => [key, aiData[key]])) : null;
    return {
      voucher_type: voucherType,
      form_schema: fields.map(({ key, label }) => ({ key, label })),
      current_values: Object.fromEntries(fields.map(({ key, path }) => {
        const id = String(values[path] ?? "");
        if (key === "party_name") return [key, masterNames(M.parties).find((x) => x.id === id)?.name ?? (id ? "(selected master)" : "")];
        if (["account_name", "to_account_name"].includes(key)) return [key, masterNames(M.accounts).find((x) => x.id === id)?.name ?? (id ? "(selected master)" : "")];
        return [key, values[path] ?? ""];
      })),
      ocr_result: ocrResult,
    };
  }, []);
  const getOwnCompany = useCallback(() => ({ name: ownRef.current.name, pan: ownRef.current.pan }), []);

  useEffect(() => { if (!visible) cancelAutoPostCountdown(); }, [visible, cancelAutoPostCountdown]);

  /* ===== Pocket AI helpers (split view) =====================================================
   * The copilot never touches the form directly: it hands a patch back, and these functions are the
   * only place a chat answer is written into the live form. Same canWrite() gate as the OCR fill, so a
   * copilot cannot overwrite a field the user is not allowed to edit. */

  /** Party/bank/staff/expense/income name lists — what the company already has. */
  const getMasters = useCallback(() => {
    const M = mastersRef.current;
    const names = (list: readonly { name?: unknown; isDeleted?: boolean }[] | undefined) =>
      (list ?? []).filter((x) => !x.isDeleted).map((x) => String(x.name ?? "").trim()).filter(Boolean);
    const M2 = M as { accounts?: readonly { accountName?: unknown; isDeleted?: boolean }[]; parties?: readonly { name?: unknown }[]; staff?: readonly { name?: unknown }[]; taxes?: readonly { name?: unknown }[] };
    return {
      parties: names(M2.parties as never),
      banks: (M2.accounts ?? []).filter((a) => !a.isDeleted).map((a) => String(a.accountName ?? "").trim()).filter(Boolean),
      staff: names(M2.staff as never),
      /* The app has no separate expense/income master list on this form; taxes are the closest ledger
       * pool the copilot can name, so it is sent so Gemini does not invent a "missing" ledger. */
      expenses: names(M2.taxes as never),
      incomes: [],
    };
  }, []);

  /**
   * Write a chat patch into the live form. Only fields the adapter actually has for this voucher type
   * are written; the returned labels tell the chat bubble what really changed ("Narration", "Date"…).
   */
  const applyPatch = useCallback((patch: OcrAiVoucherPatch): string[] => {
    const { form, adapter: A } = optsRef.current;
    const done: string[] = [];
    const set = (path: string | undefined, value: unknown, label: string) => {
      if (!path || value == null || value === "") return;
      if (!canWriteRef.current(path)) return;
      const current = form.getValues(path as never);
      if (current !== null && current !== undefined && current !== "" && current !== 0) return;
      form.setValue(path as never, value as never, { shouldDirty: true, shouldValidate: true });
      filledRef.current.set(path, value);
      done.push(label);
    };
    if (patch.date) set(A.date ?? "date", patch.date, "Date");
    if (patch.due_date && A.dueDate) set(A.dueDate, patch.due_date, "Due date");
    if (patch.narration) set(A.narration ?? "narration", patch.narration, "Narration");
    if (patch.amount != null) set(A.payeeAmount && (A.voucherType === "payment_out" || A.voucherType === "contra") ? A.payeeAmount : A.amount ?? "amount", patch.amount, "Amount");
    if (patch.voucher_number) set("voucherNumber", patch.voucher_number, "Voucher No.");
    if (patch.reference) set("referenceId", patch.reference, "Ref");
    if (patch.party_name && A.party) {
      const parties = (mastersRef.current.parties ?? []) as { id: string; name?: string; isDeleted?: boolean }[];
      const target = patch.party_name.trim().toLocaleLowerCase();
      const match = parties.find((p) => !p.isDeleted && String(p.name ?? "").trim().toLocaleLowerCase() === target);
      if (match) set(A.party.path, match.id, "Party");
    }
    if (patch.account_name) {
      const accounts = (mastersRef.current.accounts ?? []) as { id: string; accountName?: string; isDeleted?: boolean }[];
      const target = patch.account_name.trim().toLocaleLowerCase();
      const match = accounts.find((a) => !a.isDeleted && String(a.accountName ?? "").trim().toLocaleLowerCase() === target);
      const path = A.voucherType === "contra" ? A.fromAccountPath : A.accountPath;
      if (match && path) set(path, match.id, "Bank / cash account");
    }
    if (patch.to_account_name && A.toAccountPath) {
      const accounts = (mastersRef.current.accounts ?? []) as { id: string; accountName?: string; isDeleted?: boolean }[];
      const target = patch.to_account_name.trim().toLocaleLowerCase();
      const match = accounts.find((a) => !a.isDeleted && String(a.accountName ?? "").trim().toLocaleLowerCase() === target);
      if (match) set(A.toAccountPath, match.id, "To account");
    }
    return done;
  }, []);

  /** Amber badges from the copilot's missing_masters list (name only; the master form is opened by the user). */
  const [copilotMissing, setCopilotMissing] = useState<{ kind: string; name: string; hint?: string }[]>([]);
  const setCopilotMissingCb = useCallback((list: { kind: string; name: string; hint?: string }[]) => setCopilotMissing(list), []);
  /** Increments on every completed OCR fill; the copilot panel remounts on a new value (new scan = new chat). */
  const [fillSeq, setFillSeq] = useState(0);

  /**
   * "Create & link" in the copilot chat: opens the app's own Create-master dialog prefilled. The copilot
   * only fills what the paper printed — the user still confirms Save, and the new master is linked by the
   * same code path the OCR bubbles already use.
   */
  const createMasterFromProposal = useCallback((m: OcrAiMasterProposal) => {
    if (m.kind === "party") {
      setCreatePrefill({
        ...partyNamePrefill(m.name),
        aliasName: m.alias ?? m.name.toUpperCase(),
        pan: m.pan ?? "",
        phone: m.phone ?? "",
        email: m.email ?? "",
        address: m.address ?? "",
        accountTypeId: optsRef.current.adapter.partySide === "seller" ? PARTY_SYSTEM_CREDITORS_ID : PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
      });
      return;
    }
    /* bank / staff / expense / income: no inline create dialog on this form — guide the user to the
     * master page instead of silently doing nothing. */
    toast.message(`Create ${m.kind}: ${m.name}`, {
      description: m.account_no ? `Bank A/c ${m.account_no}${m.bank_name ? ` (${m.bank_name})` : ""} — open the master page to add it, then Refresh OCR.` : "Open the master page to add it, then Refresh OCR to link it.",
      duration: 8000,
    });
  }, []);

  /**
   * Keep the OCR narration in step with the account dropdowns.
   * The narration is produced once at fill time from whatever ledger was picked then. On a contra the whole
   * point is naming both banks ("… Prabhu Bank (Bank) | To: … Himalayan Bank (Bank)"), so when the user later
   * picks or corrects From/To — or creates the missing ledger — the text must be rewritten, not left stale.
   * Only rewrites when the user has not typed their own narration.
   */
  useEffect(() => {
    if (!visible) return;
    const { form, adapter: A } = optsRef.current;
    const money = lastMoneyRef.current;
    if (!money) return;
    const nPath = A.narration ?? "narration";
    const lastOurs = filledRef.current.get(nPath);
    const cur = String(form.getValues(nPath) ?? "");
    if (lastOurs != null && cur !== String(lastOurs)) return; // user edited it — hands off
    const accounts = (mastersRef.current.accounts ?? []) as { id: string; accountName?: string; accountType?: string }[];
    const fromId = String(form.getValues(A.voucherType === "contra" ? (A.fromAccountPath ?? "fromAccountId") : (A.accountPath ?? "accountId")) ?? "");
    const toId = money.direction === "contra" ? String(form.getValues(A.toAccountPath ?? "toAccountId") ?? "") : "";
    const fromAcc = fromId ? (accounts ?? []).find((a) => a.id === fromId) : undefined;
    const toAcc = toId ? (accounts ?? []).find((a) => a.id === toId) : undefined;
    const next = receiptNarration(
      money.parsed,
      fromAcc ? accountDisplayLabel(fromAcc as never) : null,
      money.direction === "contra" && toAcc ? `To: ${accountDisplayLabel(toAcc as never)}` : null,
    );
    if (!next || next === cur) return;
    form.setValue(nPath, next as never, { shouldDirty: true, shouldValidate: false });
    filledRef.current.set(nPath, next);
  }, [visible, receiptTarget, mastersRef.current.accounts, suggestions, doneIds]);

  return {
    visible,
    running,
    hasFile: o.files.length > 0,
    /** Original being read before compression (file not attached yet). */
    preReading: null,
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
    /* ---- Pocket AI (split view). Only used when prefs.aiCopilot is ON; the classic flow above is
     * untouched when it is OFF, so nothing here changes existing behaviour. ---- */
    copilotEnabled: prefs.aiCopilot === true,
    copilot: {
      statusLine: debugInfo
        ? `${debugInfo.filled.length ? "Filled" : "Read"}: ${(o.currentVoucherType ?? o.adapter.voucherType ?? "voucher").replace(/_/g, " ")}${readBy?.engine ? ` · ${readBy.engine === "gemini" ? "Gemini" : readBy.engine}` : ""}`
        : null,
      missingFields: debugInfo?.missing ?? [],
      /** Master name lists so the copilot can tell a real miss from a spelling variant. */
      getMasters,
      /** Apply a chat patch to the live form (only known, writable fields). Returns the labels written. */
      applyPatch,
      /** Open the app's Create-master dialog prefilled from a copilot proposal. */
      createMasterFromProposal,
      setCopilotMissing: setCopilotMissingCb,
      /** Names the copilot reported as missing (amber list). */
      missingMasters: copilotMissing,
      /** Bumps after each OCR fill, so the copilot panel knows a fresh scan landed and opens afresh. */
      fillSeq,
    },
  };
}

export type VoucherOcrApi = ReturnType<typeof useVoucherOcr>;
