"use client";

/**
 * Cross-company ledger copy: source party ke ledger par jo vouchers aate hain unhe target company + target party par
 * `saveVoucher` se likhta hai. Dubara copy par naya doc nahi: `crossCopySourceRef` + Compare-signature match se merge update.
 */

import { collection, query, Timestamp, where, doc } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { saveVoucher } from "@/lib/voucherActionsClient";
import { voucherTouchesPartyLedger } from "@/lib/voucherTouchesPartyLedger";
import { getRpLedgerDebitCredit, type RpLedgerContext } from "@/lib/receivablesPayablesLedgerAmounts";
import { isLocalOnlyMode } from "@/lib/localMode";
import { getCompanyDocFromBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { formatVoucherNumber, parseVoucherNumberPart, normalizePrefix } from "@/lib/voucherNumberFormat";

/** VoucherSettings defaults se align — prefix na mile to yahi fallback */
const DEFAULT_PREFIX_LABELS: Record<string, string> = {
  sale: "Sale Inv",
  sale_service: "SER-",
  purchase: "PUR-",
  purchase_service: "SER-",
  payment_in: "RCPT-",
  payment_out: "PYMT-",
  contra: "CNTR-",
  direct_income: "DINC-",
  direct_expense: "DEXP-",
  journal: "JRNL-",
  note: "NOTE-",
  add_salary: "ADD-SAL-",
  pay_salary: "PAY-SAL-",
  opening_balance: "OB-",
  production: "PROD-",
};

export type CopyLedgerMode = "batch" | "sequential";

export type CopyLedgerProgress = { done: number; total: number; currentLabel?: string };

export type CopyLedgerComparisonRow = {
  id: string;
  voucherNumber: string;
  type: string;
  /** Journal add_salary etc. — ledger Type column ke liye (`getDisplayType`). */
  subType?: string;
  rawDate?: unknown;
  dateLabel: string;
  narration: string;
  amount: number;
  debit: number;
  credit: number;
  drCrSameAsSource: boolean;
  missingReferenceIds: string[];
  /** Cross-company copy: Compare me left/right same row par — signature collision se bachne ke liye (A→B / B→A dono). */
  crossCopySourceRef?: { companyId: string; voucherId: string };
};

/** Numbering + Firestore query grouping — ek batch mein same key share karte hue counter badhta hai */
function getNumberingKey(v: Record<string, unknown>): string {
  const t = (v.type as string) || "unknown";
  if (t === "journal" && v.subType === "add_salary") return "journal|add_salary";
  if (t === "payment_out" && v.subType === "pay_salary") return "payment_out|pay_salary";
  if (t === "sale" || t === "purchase") {
    const li = (v.lineItems as Array<{ type?: string }> | undefined)?.[0]?.type || "item";
    return `${t}|${li === "service" ? "service" : "item"}`;
  }
  return t;
}

/** `company.voucherPrefixes` lookup key — Create* forms jaisa */
function getPrefixKeyFromVoucher(v: Record<string, unknown>): string {
  const t = v.type as string;
  if (t === "journal" && v.subType === "add_salary") return "add_salary";
  if (t === "payment_out" && v.subType === "pay_salary") return "pay_salary";
  if (t === "sale") {
    const li = (v.lineItems as Array<{ type?: string }> | undefined)?.[0]?.type || "item";
    return li === "service" ? "sale_service" : "sale";
  }
  if (t === "purchase") {
    const li = (v.lineItems as Array<{ type?: string }> | undefined)?.[0]?.type || "item";
    return li === "service" ? "purchase_service" : "purchase";
  }
  return String(t || "unknown");
}

/** Firestore Timestamp / plain object — clone mein preserve */
function deepCloneVoucherPreserveDates(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp) return v;
  if (typeof v === "object" && v !== null && typeof (v as Timestamp).toDate === "function") {
    try {
      const d = (v as Timestamp).toDate();
      return Timestamp.fromDate(d);
    } catch {
      /* fallthrough */
    }
  }
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map((x) => deepCloneVoucherPreserveDates(x));
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = deepCloneVoucherPreserveDates(o[k]) as unknown;
    return out;
  }
  return v;
}

/** Map key: exact id ya trim — Firestore / form kabhi space mismatch karta hai. */
function resolveIdFromMap(id: string, idMap: Record<string, string>): string {
  if (idMap[id]) return idMap[id];
  const t = id.trim();
  if (idMap[t]) return idMap[t];
  return id;
}

/**
 * Journal `entries[].accountId` multi-leg — `replaceIdsDeep` ke baad bhi explicit remap taaki target company ids pakke likhein.
 * (Kuch shapes me nested clone se miss ho sakta tha; form me "Select account" = galat company UUID.)
 */
function remapJournalEntryLinesForCrossCompanyCopy(remapped: Record<string, unknown>, idMap: Record<string, string>): void {
  const entries = remapped.entries;
  if (!Array.isArray(entries)) return;
  remapped.entries = entries.map((e) => {
    if (!e || typeof e !== "object") return e;
    const row = { ...(e as Record<string, unknown>) };
    const aid = row.accountId;
    if (typeof aid === "string" && aid) {
      row.accountId = resolveIdFromMap(aid, idMap);
    } else if (aid && typeof aid === "object" && "id" in (aid as Record<string, unknown>)) {
      // Firestore ref-like — sirf string map karo taaki save payload me target party id ho (Compare Side B filter).
      const idStr = String((aid as { id?: unknown }).id ?? "").trim();
      if (idStr) row.accountId = resolveIdFromMap(idStr, idMap);
    }
    return row;
  });
}

/** Copy ke turant baad UI merge: local-first me voucher SQLite me hota hai, Firestore `getDoc` khaali ho sakta hai. */
async function readTargetVoucherAfterSave(
  targetCompanyId: string,
  voucherId: string
): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(firestore, `companies/${targetCompanyId}/vouchers`, voucherId));
  if (snap.exists()) {
    return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
  }
  if (isLocalOnlyMode()) {
    const local = await getCompanyDocFromBrowserDb(targetCompanyId, "vouchers", voucherId);
    if (local) return local;
  }
  return null;
}

/** Journal: Firestore kabhi top-level `debit`/`credit`/`total` entries se align nahi — copy ke baad form + mismatch check dono entries se sync. */
function syncJournalTopLevelAmountsFromEntries(remapped: Record<string, unknown>): void {
  if (String(remapped.type) !== "journal" || !Array.isArray(remapped.entries)) return;
  let dr = 0;
  let cr = 0;
  for (const e of remapped.entries as Array<Record<string, unknown>>) {
    dr += toAmount(e.debit);
    cr += toAmount(e.credit);
  }
  remapped.debit = dr;
  remapped.credit = cr;
  // CreateJournalForm `total` = debit sum (balanced journal me Dr sum = Cr sum).
  remapped.total = dr;
}

/** Copy sanity: journal ke liye Dr/Cr entries se — taaki top-level 0 hone par bhi mismatch false positive na ho. */
function getDebitCreditForCopySanityCheck(v: Record<string, unknown>): { dr: number; cr: number } {
  const t = String(v.type || "");
  if (t === "journal" && Array.isArray(v.entries)) {
    let dr = 0;
    let cr = 0;
    for (const e of v.entries as Array<Record<string, unknown>>) {
      dr += toAmount(e.debit);
      cr += toAmount(e.credit);
    }
    return { dr, cr };
  }
  return { dr: toAmount(v.debit), cr: toAmount(v.credit) };
}

/** Generic id mapping: jitne source ids map me hain unhe deep object me replace karo. */
function replaceIdsDeep(value: unknown, idMap: Record<string, string>): unknown {
  if (typeof value === "string" && value) {
    return resolveIdFromMap(value, idMap);
  }
  if (Array.isArray(value)) return value.map((x) => replaceIdsDeep(x, idMap));
  if (value && typeof value === "object") {
    if (value instanceof Timestamp) return value;
    if (typeof (value as Timestamp).toDate === "function") {
      try {
        return value;
      } catch {
        /* fallthrough */
      }
    }
    if (value instanceof Date) return value;
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = replaceIdsDeep(o[k], idMap) as unknown;
    return out;
  }
  return value;
}

function toAmount(n: unknown): number {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(n) : 0;
  return Number.isFinite(x) ? x : 0;
}

/** Recycle bin / soft-delete — ledger rows me mat dikhao. */
function isActiveLedgerVoucher(v: Record<string, unknown>): boolean {
  if (v.isDeleted === true) return false;
  if (v.deletedAt != null && v.deletedAt !== "") return false;
  return true;
}

function toDateLabel(raw: unknown): string {
  if (!raw) return "—";
  try {
    if (raw instanceof Date) return isNaN(raw.getTime()) ? "—" : raw.toLocaleDateString();
    if (raw instanceof Timestamp) return raw.toDate().toLocaleDateString();
    if (typeof raw === "object" && raw !== null && "toDate" in (raw as Record<string, unknown>)) {
      const d = (raw as { toDate?: () => Date }).toDate?.();
      return d instanceof Date && !isNaN(d.getTime()) ? d.toLocaleDateString() : "—";
    }
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
    }
    return "—";
  } catch {
    return "—";
  }
}

/** Voucher account/party references jo cross-company map check me kaam aayenge. */
export function collectVoucherReferenceIds(v: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (raw: unknown) => {
    const s = raw != null && String(raw).trim() ? String(raw).trim() : "";
    if (s) out.add(s);
  };
  // Common voucher reference fields
  add(v.partyId);
  add(v.accountId);
  add(v.staffId);
  add(v.taxAccountId);
  add(v.expenseAccountId);
  add(v.incomeAccountId);
  add(v.salesAccountId);
  add(v.purchaseAccountId);
  if (v.type === "note") add(v.entityId);
  if (v.type === "contra") {
    add(v.fromAccountId);
    add(v.toAccountId);
  }
  if (Array.isArray(v.entries)) (v.entries as Array<Record<string, unknown>>).forEach((e) => add(e?.accountId));
  if (Array.isArray(v.lineItems)) {
    (v.lineItems as Array<Record<string, unknown>>).forEach((li) => {
      add(li?.itemId);
      add(li?.taxAccountId);
    });
  }
  if (Array.isArray(v.items)) (v.items as Array<Record<string, unknown>>).forEach((li) => add(li?.itemId));
  return Array.from(out);
}

/**
 * Selected ledger leg ko chhod kar baaki refs — sync/compare me "opposite" accounts check (party line khud map hoti hai).
 */
export function collectOppositeReferenceIdsForCompare(v: Record<string, unknown>, selectedLedgerId: string): string[] {
  const sel = String(selectedLedgerId || "").trim();
  return collectVoucherReferenceIds(v).filter((id) => id !== sel);
}

/** Ledger/recon row narration — Note voucher ka `title` (party txn table jaisa). */
export function ledgerNarrationFromVoucher(v: Record<string, unknown>): string {
  if (String(v.type || "") === "note") {
    const title = String(v.title || "").trim();
    if (title) return title;
  }
  const narration = String(v.narration || "").trim();
  return narration || "-";
}

/** Sync ledger compare popup — entity bucket → same Dr/Cr rules as party/staff/bank detail ledger. */
export type CopyCompareLedgerContext = RpLedgerContext | "auto";

const COPY_COMPARE_AUTO_CONTEXTS: RpLedgerContext[] = ["party", "staff", "account", "tax", "expense"];

export function copyCompareBucketToLedgerContext(
  bucket: "all" | "party" | "bank" | "staff" | "tax" | "income_expense"
): CopyCompareLedgerContext {
  switch (bucket) {
    case "party":
      return "party";
    case "staff":
      return "staff";
    case "bank":
      return "account";
    case "tax":
      return "tax";
    case "income_expense":
      return "expense";
    default:
      return "auto";
  }
}

export function reconciliationCollectionToLedgerContext(collection: string): RpLedgerContext {
  switch (String(collection || "").trim()) {
    case "bank_accounts":
      return "account";
    case "staff":
      return "staff";
    case "taxes":
      return "tax";
    case "expense_accounts":
      return "expense";
    default:
      return "party";
  }
}

/** Detail ledger jaisa is entity ki leg — payment_out party/staff par Dr, bank par Cr, etc. */
export function resolveCopyCompareLedgerDebitCredit(
  v: Record<string, unknown>,
  entityId: string,
  context: CopyCompareLedgerContext = "party"
): { debit: number; credit: number } {
  const id = String(entityId || "").trim();
  if (!id || !v) return { debit: 0, credit: 0 };
  if (context !== "auto") {
    return getRpLedgerDebitCredit(v, id, context);
  }
  for (const ctx of COPY_COMPARE_AUTO_CONTEXTS) {
    const r = getRpLedgerDebitCredit(v, id, ctx);
    if (r.debit > 0 || r.credit > 0) return r;
  }
  return getRpLedgerDebitCredit(v, id, "party");
}

/**
 * Compare list builder: selected vouchers ke liye missing target references + dr/cr check metadata.
 * `targetKnownIds` me woh ids do jo target company me valid hain (e.g. target parties ids).
 */
export function buildCopyLedgerComparison(params: {
  vouchers: Array<Record<string, unknown>>;
  sourcePartyId: string;
  selectedVoucherIds?: string[];
  idMap?: Record<string, string>;
  targetKnownIds: Set<string>;
  ledgerContext?: CopyCompareLedgerContext;
}): { rows: CopyLedgerComparisonRow[]; unresolvedIds: string[] } {
  const { vouchers, sourcePartyId, selectedVoucherIds, idMap, targetKnownIds, ledgerContext = "party" } = params;
  const selectedSet = new Set((selectedVoucherIds || []).map((x) => String(x)));
  const effectiveMap = { ...(idMap || {}) };
  const unresolved = new Set<string>();
  const rows: CopyLedgerComparisonRow[] = [];
  for (const v of vouchers) {
    if (!isActiveLedgerVoucher(v)) continue;
    if (!voucherTouchesPartyLedger(v, sourcePartyId)) continue;
    const id = String(v.id || "");
    if (selectedSet.size > 0 && !selectedSet.has(id)) continue;
    // Sirf opposite legs: selected ledger id ko missing list me mat gino (voucher complete = doosri side B me honi chahiye).
    const refs = collectOppositeReferenceIdsForCompare(v, sourcePartyId);
    const missingReferenceIds: string[] = [];
    for (const srcId of refs) {
      const mapped = effectiveMap[srcId] || srcId;
      if (!targetKnownIds.has(mapped)) {
        missingReferenceIds.push(srcId);
        unresolved.add(srcId);
      }
    }
    // Is ledger account ki leg — party/staff/bank detail ledger ke same Dr/Cr rules.
    const legAmounts = resolveCopyCompareLedgerDebitCredit(v, sourcePartyId, ledgerContext);
    let debit = legAmounts.debit;
    let credit = legAmounts.credit;
    const amount = toAmount(Math.max(debit, credit, toAmount(v.total ?? v.amount ?? 0)));
    const crefRaw = v.crossCopySourceRef as { companyId?: string; voucherId?: string } | undefined;
    const crossCopySourceRef =
      crefRaw?.companyId && crefRaw?.voucherId
        ? { companyId: String(crefRaw.companyId), voucherId: String(crefRaw.voucherId) }
        : undefined;
    const subTypeRaw = v.subType;
    rows.push({
      id,
      voucherNumber: String(v.voucherNumber || "—"),
      type: String(v.type || "voucher"),
      subType: subTypeRaw != null && String(subTypeRaw).trim() !== "" ? String(subTypeRaw) : undefined,
      rawDate: v.date,
      dateLabel: toDateLabel(v.date),
      narration: ledgerNarrationFromVoucher(v),
      amount,
      debit,
      credit,
      drCrSameAsSource: true,
      missingReferenceIds,
      crossCopySourceRef,
    });
  }
  return { rows, unresolvedIds: Array.from(unresolved) };
}

/** Ek visual row — Left/Right match ya ek side khali (sync preview alignment). */
export type CompareLedgerPair = {
  left: CopyLedgerComparisonRow | null;
  right: CopyLedgerComparisonRow | null;
};

/** Raw date → local calendar day key (Left/Right same din match). */
function parseRawDateForCompare(raw: unknown): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (raw && typeof raw === "object" && "toDate" in (raw as Record<string, unknown>)) {
    try {
      const d = (raw as { toDate?: () => Date }).toDate?.();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function normalizeDateKeyLocal(raw: unknown): string {
  const d = parseRawDateForCompare(raw);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Narration compare: trim, collapse spaces, casefold — "-" ko empty treat (buildCopyLedgerComparison default). */
function normalizeNarrationForCompare(s: string): string {
  const t = (s || "").trim();
  const u = t === "-" ? "" : t;
  return u.replace(/\s+/g, " ").toLowerCase();
}

/**
 * `prepareVoucherForCrossCompanyCopy` pehli line `[Copied #hex] note` prepend karta hai — pair row match me hatao taaki left/right same logical narration par align ho.
 */
function stripNarrationCrossCopyMarker(raw: string): string {
  const t = String(raw || "").trim();
  if (!t || t === "-") return t;
  const line0 = (t.split("\n")[0] ?? "").trim();
  if (/^\[Copied[^\]]+\]/.test(line0)) {
    const rest = t.includes("\n") ? t.slice(t.indexOf("\n") + 1).trim() : "";
    return rest || "-";
  }
  return t;
}

function normalizeNarrationForPairMatch(narration: string): string {
  return normalizeNarrationForCompare(stripNarrationCrossCopyMarker(narration));
}

function roundMoneyCompare(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Match key: date (local day) + type + narration + Dr + Cr.
 * Duplicate signatures: queue per side — greedy one-to-one pairing.
 */
function compareRowMatchSignature(row: CopyLedgerComparisonRow): string {
  const dk = normalizeDateKeyLocal(row.rawDate);
  const t = String(row.type || "").trim().toLowerCase();
  const n = normalizeNarrationForPairMatch(row.narration);
  const dr = roundMoneyCompare(row.debit || 0);
  const cr = roundMoneyCompare(row.credit || 0);
  return `${dk}|${t}|${n}|${dr}|${cr}`;
}

/**
 * Same logical key as Compare pairing — `[Copied #…]` narration ignore; dubara copy par duplicate target row detect karne ke liye.
 */
export function computeVoucherMatchSignature(v: Record<string, unknown>): string {
  let debit = toAmount(v.debit);
  let credit = toAmount(v.credit);
  const amount = toAmount(v.total ?? v.amount ?? Math.max(debit, credit));
  if (debit === 0 && credit === 0 && amount > 0) {
    const t = String(v.type || "");
    if (t === "purchase" || t === "payment_out" || t === "direct_expense") credit = amount;
    else debit = amount;
  }
  const row: CopyLedgerComparisonRow = {
    id: String(v.id || ""),
    voucherNumber: "",
    type: String(v.type || "voucher"),
    rawDate: v.date,
    dateLabel: "",
    narration: ledgerNarrationFromVoucher(v),
    amount,
    debit,
    credit,
    drCrSameAsSource: true,
    missingReferenceIds: [],
  };
  return compareRowMatchSignature(row);
}

type TargetSigIndexEntry = { id: string; voucherNumber: string; narration: string };

/** crossCopySourceRef — same source voucher dubara copy = isi target row par merge (JRNL-003 + JRNL-001 duplicate se bache). */
type CrossCopySourceRef = { companyId: string; voucherId: string };

function narrationPairNormalizedEqual(a: string, b: string): boolean {
  return normalizeNarrationForPairMatch(a) === normalizeNarrationForPairMatch(b);
}

/** Firestore + SQLite same id — baad wala row authoritative (local-first pending write). */
function mergeVoucherDocsByIdPreferLater<T extends { id?: unknown }>(a: T[], b: T[]): T[] {
  const m = new Map<string, T>();
  a.forEach((x) => m.set(String(x.id), x));
  b.forEach((x) => m.set(String(x.id), x));
  return Array.from(m.values());
}

/** Target par merge: pehle sourceRef index, phir signature (purane docs ke bina ref). */
async function loadTargetPartyVoucherMergeIndexes(
  targetCompanyId: string,
  targetPartyId: string
): Promise<{ bySig: Map<string, TargetSigIndexEntry>; byCopyRef: Map<string, TargetSigIndexEntry> }> {
  const bySig = new Map<string, TargetSigIndexEntry>();
  const byCopyRef = new Map<string, TargetSigIndexEntry>();
  const snap = await getDocs(collection(firestore, `companies/${targetCompanyId}/vouchers`));
  let fsDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  if (isLocalOnlyMode()) {
    const localRows = await listCompanyDocsFromBrowserDb(targetCompanyId, "vouchers");
    fsDocs = mergeVoucherDocsByIdPreferLater(fsDocs, localRows as Array<{ id: string } & Record<string, unknown>>);
  }
  for (const data of fsDocs) {
    if ((data as { isDeleted?: boolean }).isDeleted === true) continue;
    if (!voucherTouchesPartyLedger(data, targetPartyId)) continue;
    const entry: TargetSigIndexEntry = {
      id: String(data.id ?? ""),
      voucherNumber: String((data as { voucherNumber?: string }).voucherNumber || ""),
      narration: ledgerNarrationFromVoucher(data as Record<string, unknown>),
    };
    const sig = computeVoucherMatchSignature(data);
    if (!bySig.has(sig)) bySig.set(sig, entry);
    const cref = (data as { crossCopySourceRef?: CrossCopySourceRef }).crossCopySourceRef;
    if (cref?.companyId && cref?.voucherId) {
      const k = `${cref.companyId}|${cref.voucherId}`;
      if (!byCopyRef.has(k)) byCopyRef.set(k, entry);
    }
  }
  return { bySig, byCopyRef };
}

/**
 * Compare-before-sync: pehle `crossCopySourceRef` se exact source↔target row (copy ke baad bhi same line);
 * bache hue par purana signature match (date/type/narration/Dr/Cr).
 */
export type PairCompareLedgerRowsOptions = {
  leftCompanyId?: string;
  rightCompanyId?: string;
};

function pairCompareLedgerRowsBySignatureOnly(
  leftRows: CopyLedgerComparisonRow[],
  rightRows: CopyLedgerComparisonRow[]
): CompareLedgerPair[] {
  const sig = compareRowMatchSignature;
  const rightQueues = new Map<string, number[]>();
  rightRows.forEach((r, idx) => {
    const k = sig(r);
    if (!rightQueues.has(k)) rightQueues.set(k, []);
    rightQueues.get(k)!.push(idx);
  });
  const usedRight = new Set<number>();
  const pairs: CompareLedgerPair[] = [];
  for (const left of leftRows) {
    const k = sig(left);
    const q = rightQueues.get(k);
    if (q && q.length > 0) {
      const j = q.shift()!;
      usedRight.add(j);
      pairs.push({ left, right: rightRows[j] });
    } else {
      pairs.push({ left, right: null });
    }
  }
  rightRows.forEach((r, idx) => {
    if (!usedRight.has(idx)) {
      pairs.push({ left: null, right: r });
    }
  });
  return pairs;
}

export function pairCompareLedgerRows(
  leftRows: CopyLedgerComparisonRow[],
  rightRows: CopyLedgerComparisonRow[],
  opts?: PairCompareLedgerRowsOptions
): CompareLedgerPair[] {
  const leftCid = String(opts?.leftCompanyId || "").trim();
  const rightCid = String(opts?.rightCompanyId || "").trim();
  const leftById = new Map<string, number>();
  leftRows.forEach((r, i) => {
    if (r.id) leftById.set(String(r.id), i);
  });
  const rightById = new Map<string, number>();
  rightRows.forEach((r, i) => {
    if (r.id) rightById.set(String(r.id), i);
  });
  const usedLeftIdx = new Set<number>();
  const usedRightIdx = new Set<number>();
  const refPairs: CompareLedgerPair[] = [];
  // A→B: target (right) par copy — ref = source company + left voucher id.
  if (leftCid) {
    for (let ri = 0; ri < rightRows.length; ri++) {
      const cref = rightRows[ri].crossCopySourceRef;
      if (!cref || cref.companyId !== leftCid || !cref.voucherId) continue;
      const li = leftById.get(String(cref.voucherId));
      if (li === undefined || usedLeftIdx.has(li) || usedRightIdx.has(ri)) continue;
      usedLeftIdx.add(li);
      usedRightIdx.add(ri);
      refPairs.push({ left: leftRows[li], right: rightRows[ri] });
    }
  }
  // B→A: target (left) par copy — ref = source company + right voucher id.
  if (rightCid) {
    for (let li = 0; li < leftRows.length; li++) {
      if (usedLeftIdx.has(li)) continue;
      const cref = leftRows[li].crossCopySourceRef;
      if (!cref || cref.companyId !== rightCid || !cref.voucherId) continue;
      const ri = rightById.get(String(cref.voucherId));
      if (ri === undefined || usedRightIdx.has(ri)) continue;
      usedLeftIdx.add(li);
      usedRightIdx.add(ri);
      refPairs.push({ left: leftRows[li], right: rightRows[ri] });
    }
  }
  const leftForSig: CopyLedgerComparisonRow[] = [];
  leftRows.forEach((l, i) => {
    if (!usedLeftIdx.has(i)) leftForSig.push(l);
  });
  const rightForSig: CopyLedgerComparisonRow[] = [];
  rightRows.forEach((r, i) => {
    if (!usedRightIdx.has(i)) rightForSig.push(r);
  });
  return [...refPairs, ...pairCompareLedgerRowsBySignatureOnly(leftForSig, rightForSig)];
}

/** Ek row ki sort time (purani date upar) — `rawDate` parse fail ho to end me. */
function compareRowSortTimeMs(row: CopyLedgerComparisonRow | null): number {
  if (!row) return Number.MAX_SAFE_INTEGER;
  const d = parseRawDateForCompare(row.rawDate);
  return d && !isNaN(d.getTime()) ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

/** Pair ki ek hi timeline position: jis side par date ho usme se chhoti (purani) date. */
function pairChronologicalSortKey(pair: CompareLedgerPair): number {
  const a = pair.left ? compareRowSortTimeMs(pair.left) : Number.MAX_SAFE_INTEGER;
  const b = pair.right ? compareRowSortTimeMs(pair.right) : Number.MAX_SAFE_INTEGER;
  return Math.min(a, b);
}

/**
 * Pair list ko date ke hisaab se mix sort: chhoti (purani) date upar, badi neeche.
 * Pehle `pairCompareLedgerRows` se match rows, phir yeh sort — dono companies ki entries ek timeline par.
 */
export function sortComparePairsChronologically(pairs: CompareLedgerPair[]): CompareLedgerPair[] {
  return pairs.slice().sort((p, q) => {
    const tp = pairChronologicalSortKey(p);
    const tq = pairChronologicalSortKey(q);
    if (tp !== tq) return tp - tq;
    const vp = `${p.left?.voucherNumber ?? ""}|${p.right?.voucherNumber ?? ""}`;
    const vq = `${q.left?.voucherNumber ?? ""}|${q.right?.voucherNumber ?? ""}`;
    const vc = vp.localeCompare(vq, undefined, { numeric: true });
    if (vc !== 0) return vc;
    return `${p.left?.id ?? ""}|${p.right?.id ?? ""}`.localeCompare(`${q.left?.id ?? ""}|${q.right?.id ?? ""}`);
  });
}

/** Target company mein is numbering group ka max serial (prefix match) */
async function getMaxVoucherNumberForKey(
  targetCompanyId: string,
  company: Record<string, unknown>,
  v: Record<string, unknown>
): Promise<number> {
  const nk = getNumberingKey(v);
  const prefixKey = getPrefixKeyFromVoucher(v);
  const rawPrefixes = (company as { voucherPrefixes?: Record<string, string[]> }).voucherPrefixes?.[prefixKey];
  const VOUCHER_PREFIX =
    Array.isArray(rawPrefixes) && rawPrefixes[0] ? rawPrefixes[0] : DEFAULT_PREFIX_LABELS[prefixKey] || "V-";

  let docs: Array<Record<string, unknown>> = [];

  if (nk === "journal|add_salary") {
    const q = query(
      collection(firestore, `companies/${targetCompanyId}/vouchers`),
      where("type", "==", "journal"),
      where("subType", "==", "add_salary")
    );
    docs = (await getDocs(q)).docs.map((d) => d.data() as Record<string, unknown>);
  } else if (nk === "payment_out|pay_salary") {
    const q = query(
      collection(firestore, `companies/${targetCompanyId}/vouchers`),
      where("type", "==", "payment_out"),
      where("subType", "==", "pay_salary")
    );
    docs = (await getDocs(q)).docs.map((d) => d.data() as Record<string, unknown>);
  } else if (nk.startsWith("sale|") || nk.startsWith("purchase|")) {
    const type = v.type as string;
    const li0 = (v.lineItems as Array<{ type?: string }> | undefined)?.[0]?.type || "item";
    const q = query(collection(firestore, `companies/${targetCompanyId}/vouchers`), where("type", "==", type));
    docs = (await getDocs(q))
      .docs.map((d) => d.data() as Record<string, unknown>)
      // Sale / purchase: item vs service alag numbering — CreateSaleForm jaisa lineItems[0].type match
      .filter((data) => ((data.lineItems as Array<{ type?: string }> | undefined)?.[0]?.type || "item") === li0);
  } else {
    const t = v.type as string;
    const q = query(collection(firestore, `companies/${targetCompanyId}/vouchers`), where("type", "==", t));
    docs = (await getDocs(q)).docs.map((d) => d.data() as Record<string, unknown>);
    if (t === "journal") {
      docs = docs.filter((data) => data.subType !== "add_salary");
    }
    if (t === "payment_out") {
      docs = docs.filter((data) => data.subType !== "pay_salary");
    }
  }

  let maxNum = 0;
  for (const data of docs) {
    const numStr = data.voucherNumber as string | undefined;
    if (numStr && (numStr.startsWith(normalizePrefix(VOUCHER_PREFIX)) || numStr.startsWith(VOUCHER_PREFIX))) {
      const num = parseVoucherNumberPart(numStr, VOUCHER_PREFIX);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return maxNum;
}

type NumberCache = Map<string, { max: number; prefix: string }>;

async function assignNextVoucherNumber(
  targetCompanyId: string,
  company: Record<string, unknown>,
  v: Record<string, unknown>,
  cache: NumberCache
): Promise<string> {
  const key = getNumberingKey(v);
  let entry = cache.get(key);
  if (!entry) {
    const maxFromFs = await getMaxVoucherNumberForKey(targetCompanyId, company, v);
    const prefixKey = getPrefixKeyFromVoucher(v);
    const rawPrefixes = (company as { voucherPrefixes?: Record<string, string[]> }).voucherPrefixes?.[prefixKey];
    const prefix =
      Array.isArray(rawPrefixes) && rawPrefixes[0] ? rawPrefixes[0] : DEFAULT_PREFIX_LABELS[prefixKey] || "V-";
    entry = { max: maxFromFs, prefix };
    cache.set(key, entry);
  }
  entry.max += 1;
  return formatVoucherNumber(entry.prefix, entry.max);
}

/** Naya doc: id/history/allocation/links strip + party remap + naya number */
function prepareVoucherForCrossCompanyCopy(
  raw: Record<string, unknown>,
  idMap: Record<string, string>,
  nextVoucherNumber: string,
  accountNote?: string,
  noteColorHex?: string,
  opts?: { crossCopySourceRef?: CrossCopySourceRef }
): Record<string, unknown> {
  const cloned = deepCloneVoucherPreserveDates(raw) as Record<string, unknown>;
  const remapped = replaceIdsDeep(cloned, idMap) as Record<string, unknown>;
  // Journal multi-leg: entries[].accountId target company me pakka map ho (deep replace edge cases).
  remapJournalEntryLinesForCrossCompanyCopy(remapped, idMap);
  // Journal doc ke total/Dr/Cr entries ke saath align — saveVoucher / UI mismatch kam.
  syncJournalTopLevelAmountsFromEntries(remapped);

  delete remapped.id;
  delete remapped.createdAt;
  delete remapped.updatedAt;
  delete remapped.deletedAt;
  delete remapped.history;
  delete remapped.approvedAt;
  delete remapped.approvedByUserId;
  delete remapped.approvedByUserName;
  delete remapped.allocations;
  // Keep file links when user expects attachment links in copied voucher.

  remapped.voucherNumber = nextVoucherNumber;
  delete remapped.companyId;

  if (opts?.crossCopySourceRef) {
    remapped.crossCopySourceRef = opts.crossCopySourceRef;
  }

  if (accountNote?.trim()) {
    const prev = typeof remapped.narration === "string" ? remapped.narration : "";
    const color = String(noteColorHex || "#f97316").trim();
    // Copy marker ko narration ke top par prepend karo taaki copied vouchers list me turant identify ho sake.
    const marker = `[Copied ${color}] ${accountNote.trim()}`;
    remapped.narration = marker + (prev ? `\n${prev}` : "");
  }

  return remapped;
}

function voucherDateMs(v: Record<string, unknown>): number {
  const d = v.date as unknown;
  if (d && typeof d === "object" && "toDate" in d && typeof (d as { toDate?: () => Date }).toDate === "function") {
    try {
      const dt = (d as { toDate: () => Date }).toDate();
      return dt instanceof Date && !isNaN(dt.getTime()) ? dt.getTime() : 0;
    } catch {
      return 0;
    }
  }
  if (d instanceof Date) return d.getTime();
  if (d instanceof Timestamp) {
    try {
      return d.toDate().getTime();
    } catch {
      return 0;
    }
  }
  return 0;
}

export type CopyLedgerResult = {
  success: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
  /** Target company me abhi save/update hua doc — Compare me turant row dikhane ke liye (refetch/listener delay bypass). */
  writtenTargetDocs?: Array<Record<string, unknown>>;
};

/**
 * Source company vouchers list se party ledger wale vouchers filter karke target company mein create karta hai.
 * `batch` = back-to-back saves; `sequential` = har save ke baad chhota delay taaki progress UI dikhe.
 */
export async function executeCopyLedgerCrossCompany(params: {
  userId: string;
  /** Dubara copy merge ke liye — target par `crossCopySourceRef` match. */
  sourceCompanyId: string;
  targetCompanyId: string;
  sourcePartyId: string;
  targetPartyId: string;
  vouchers: Array<Record<string, unknown>>;
  selectedVoucherIds?: string[];
  idMap?: Record<string, string>;
  mode: CopyLedgerMode;
  accountNote?: string;
  noteColorHex?: string;
  onProgress?: (p: CopyLedgerProgress) => void;
}): Promise<CopyLedgerResult> {
  const {
    userId,
    sourceCompanyId,
    targetCompanyId,
    sourcePartyId,
    targetPartyId,
    vouchers,
    selectedVoucherIds,
    idMap,
    mode,
    accountNote,
    noteColorHex,
    onProgress,
  } = params;

  const selectedSet = new Set((selectedVoucherIds || []).map((x) => String(x)));
  const effectiveMap = { ...(idMap || {}), [sourcePartyId]: targetPartyId };

  const list = (vouchers || [])
    .filter((v) => voucherTouchesPartyLedger(v, sourcePartyId))
    .filter((v) => selectedSet.size === 0 || selectedSet.has(String(v.id || "")))
    .slice()
    .sort((a, b) => voucherDateMs(a) - voucherDateMs(b));

  const companySnap = await getDoc(doc(firestore, "companies", targetCompanyId));
  const company = (companySnap.exists() ? companySnap.data() : {}) as Record<string, unknown>;

  // Dubara copy: pehle `crossCopySourceRef`, phir same signature ([Copied] narration ignore) — naya row nahi, merge update.
  let { bySig: targetSigIndex, byCopyRef: targetCopyRefIndex } = await loadTargetPartyVoucherMergeIndexes(
    targetCompanyId,
    targetPartyId
  );

  const cache: NumberCache = new Map();
  const errors: Array<{ id: string; message: string }> = [];
  let success = 0;
  let failed = 0;
  /** Har successful save ke baad `getDoc` — UI list me same tick merge ho sake. */
  const writtenTargetDocs: Array<Record<string, unknown>> = [];

  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const id = String(v.id ?? "?");

    if (mode === "sequential" && i > 0) {
      // One-by-one mode visibly slower + progress update friendly.
      await new Promise((r) => setTimeout(r, 220));
    }

    try {
      const sig = computeVoucherMatchSignature(v);
      const copyRefKey = `${sourceCompanyId}|${String(v.id || "")}`;
      const copyRef: CrossCopySourceRef = { companyId: sourceCompanyId, voucherId: String(v.id || "") };
      const prepareOpts = { crossCopySourceRef: copyRef };

      const existing = targetCopyRefIndex.get(copyRefKey) ?? targetSigIndex.get(sig);

        if (existing) {
        const payload = prepareVoucherForCrossCompanyCopy(
          v,
          effectiveMap,
          existing.voucherNumber,
          accountNote,
          noteColorHex,
          prepareOpts
        );
        const srcDc = getDebitCreditForCopySanityCheck(v);
        const payDc = getDebitCreditForCopySanityCheck(payload);
        if (toAmount(payDc.dr) !== toAmount(srcDc.dr) || toAmount(payDc.cr) !== toAmount(srcDc.cr)) {
          throw new Error("Debit/Credit mismatch while preparing copied voucher.");
        }
        // Sirf tab [Copied] line rakho jab source narration (norm) badal gaya ho; warna purani target narration (ek hi [Copied] line).
        if (narrationPairNormalizedEqual(ledgerNarrationFromVoucher(v), existing.narration)) {
          payload.narration = existing.narration;
        }
        await saveVoucher(targetCompanyId, userId, payload, existing.id);
        const rowExisting = await readTargetVoucherAfterSave(targetCompanyId, existing.id);
        if (rowExisting) writtenTargetDocs.push(rowExisting);
        const entry: TargetSigIndexEntry = {
          id: existing.id,
          voucherNumber: String(payload.voucherNumber ?? existing.voucherNumber),
          narration: String(payload.narration ?? ""),
        };
        targetSigIndex.set(sig, entry);
        targetCopyRefIndex.set(copyRefKey, entry);
      } else {
        const nextNum = await assignNextVoucherNumber(targetCompanyId, company, v, cache);
        const payload = prepareVoucherForCrossCompanyCopy(v, effectiveMap, nextNum, accountNote, noteColorHex, prepareOpts);
        const srcDcNew = getDebitCreditForCopySanityCheck(v);
        const payDcNew = getDebitCreditForCopySanityCheck(payload);
        if (toAmount(payDcNew.dr) !== toAmount(srcDcNew.dr) || toAmount(payDcNew.cr) !== toAmount(srcDcNew.cr)) {
          throw new Error("Debit/Credit mismatch while preparing copied voucher.");
        }
        const saved = await saveVoucher(targetCompanyId, userId, payload, null);
        const rowNew = await readTargetVoucherAfterSave(targetCompanyId, saved.id);
        if (rowNew) writtenTargetDocs.push(rowNew);
        const entry: TargetSigIndexEntry = {
          id: saved.id,
          voucherNumber: String(payload.voucherNumber ?? ""),
          narration: String(payload.narration ?? ""),
        };
        targetSigIndex.set(sig, entry);
        targetCopyRefIndex.set(copyRefKey, entry);
      }
      success++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ id, message });
    }

    const label =
      typeof v.voucherNumber === "string" && v.voucherNumber
        ? String(v.voucherNumber)
        : String(v.type ?? "voucher");
    onProgress?.({ done: i + 1, total: list.length, currentLabel: label });
  }

  return {
    success,
    failed,
    errors,
    ...(writtenTargetDocs.length > 0 ? { writtenTargetDocs } : {}),
  };
}
