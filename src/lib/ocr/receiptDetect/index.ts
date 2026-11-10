/**
 * Money-document detector registry. Add a new format by writing a ReceiptFormatDetector and pushing it to DETECTORS.
 * Specific templates (connectIPS, Prabhu) are tried first; tax invoice is bill-like (handled by parseBill).
 * Pure: no UI, no DB. Voucher type is decided by own-account identification:
 *   our account is sender  -> Payment (party missing: stay + create party; do NOT auto-switch to Direct Expense)
 *   our account is receiver -> Receipt
 *   both ours -> Contra
 * Particulars/Remarks feed the narration (and may softly hint, never auto-switch).
 */
import { nameScore } from "../../../modules/ocr/fuzzy";
import { connectIpsDetector } from "./connectIps";
import { genericBankDetector } from "./genericBank";
import { handwrittenVoucherDetector } from "./handwrittenVoucher";
import { isMaskedName } from "./genericFields";
import { companyNameMatches, pickUniqueOwnAccount } from "./match";
import { prabhuBankDetector } from "./prabhuBank";
import { taxInvoiceDetector } from "./taxInvoice";
import { isSuccessStatus, type NamedMaster, type OwnAccountLike, type ParsedReceipt, type ReceiptDetection, type ReceiptFormatDetector, type ReceiptMaster } from "./types";

export * from "./types";
export { maskedAccountMatches, bankNameMatches, matchOwnAccount, companyNameMatches, scoreOwnAccounts, pickUniqueOwnAccount } from "./match";
export { parseDocDates, parseSingleDocDate } from "../dates";
export { isMaskedName, maskedNameSuffix, parseGenericFields, parsePhone } from "./genericFields";

export const DETECTORS: ReceiptFormatDetector[] = [
  connectIpsDetector,
  prabhuBankDetector,
  handwrittenVoucherDetector,
  taxInvoiceDetector,
  genericBankDetector,
];
const MIN_CONF = 0.6;
const NAME_MIN = 0.9;
const NAME_GAP = 0.03;

export type ClassifyOptions = {
  ownAccounts: readonly OwnAccountLike[];
  companyName?: string;
  parties?: readonly NamedMaster[];
  staff?: readonly NamedMaster[];
};

export function detectReceiptFormat(text: string): { det: ReceiptFormatDetector; confidence: number } | null {
  let best: { det: ReceiptFormatDetector; confidence: number } | null = null;
  for (const det of DETECTORS) {
    const c = det.detect(text);
    if (c >= MIN_CONF && (!best || c > best.confidence)) best = { det, confidence: c };
  }
  return best;
}

/** Normalise for name matching: case, punctuation, Pvt/Private/Ltd/Limited etc. dropped. */
export function normMasterName(s?: string): string {
  return String(s ?? "").toLowerCase().replace(/\bp\.?\s*ltd\b/g, " ").replace(/\b(pvt|private|ltd|limited|co|company|inc|m\/s|ms)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Levenshtein <= 1 (one OCR slip). */
function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

export function masterNameScore(a?: string, b?: string): number {
  const x = normMasterName(a), y = normMasterName(b);
  if (!x || !y) return 0;
  if (x === y || x.replace(/ /g, "") === y.replace(/ /g, "")) return 1;
  if (oneSlip(x.replace(/ /g, ""), y.replace(/ /g, ""))) return 0.97;
  return nameScore(x, y);
}

/** Best unique name match in a pool (score >= NAME_MIN and clear gap to runner-up). */
function bestMaster(name: string, pool: readonly NamedMaster[] = []): { m: NamedMaster; score: number } | null {
  let best: { m: NamedMaster; score: number } | null = null, second = 0;
  for (const m of pool) {
    const s = Math.max(masterNameScore(name, m.name), m.aliasName ? masterNameScore(name, m.aliasName) : 0);
    if (!best || s > best.score) { if (best) second = Math.max(second, best.score); best = { m, score: s }; } else second = Math.max(second, s);
  }
  return best && best.score >= NAME_MIN && best.score - second >= NAME_GAP ? best : null;
}

function sideOwn(side: ParsedReceipt["sender"], o: ClassifyOptions) {
  return pickUniqueOwnAccount(side, o.ownAccounts);
}

/** Identify the beneficiary master: own bank (account no. / company name / own account name) > party > staff. */
export function identifyBeneficiaryMaster(p: ParsedReceipt, o: ClassifyOptions): ReceiptMaster {
  const name = p.beneficiary.accountName?.trim() ?? "";
  const acc = sideOwn(p.beneficiary, o);
  if (acc.ok) return { kind: "own_bank", id: acc.acc.id, name: acc.acc.accountName ?? name, score: Math.min(0.99, 0.7 + acc.score * 0.3) };
  if (name && o.companyName && companyNameMatches(name, o.companyName)) return { kind: "own_bank", name, score: 0.99 };
  if (!name || isMaskedName(name)) return { kind: null, name: name || undefined, score: 0 };
  const own = bestMaster(name, o.ownAccounts.map((a) => ({ id: a.id, name: a.accountName ?? "" })));
  if (own && own.score >= 0.97) return { kind: "own_bank", id: own.m.id, name: own.m.name, score: own.score };
  const party = bestMaster(name, o.parties), staff = bestMaster(name, o.staff);
  if (party && (!staff || party.score >= staff.score)) return { kind: "party", id: party.m.id, name: party.m.name, score: party.score };
  if (staff) return { kind: "staff", id: staff.m.id, name: staff.m.name, score: staff.score };
  return { kind: null, name, score: 0 };
}

type Classified = Omit<ReceiptDetection, "format" | "confidence" | "parsed">;

function statusWarning(p: ParsedReceipt): string | undefined {
  if (!p.status || isSuccessStatus(p.status)) return undefined;
  return `Document status is "${p.status}" (not SUCCESS)`;
}

function referenceHintsOutgoing(p: ParsedReceipt, companyName?: string): boolean {
  if (!companyName) return false;
  const ref = p.referenceId ?? "";
  const namePart = ref.includes(":") ? ref.split(":").slice(1).join(":") : ref;
  return companyNameMatches(namePart, companyName) || masterNameScore(namePart, companyName) >= 0.85;
}

export function classifyReceipt(p: ParsedReceipt, o: ClassifyOptions): Classified {
  const s = sideOwn(p.sender, o);
  const b = sideOwn(p.beneficiary, o);
  const master = identifyBeneficiaryMaster(p, o);
  const bOwn = master.kind === "own_bank" || b.ok;
  const ids = { senderAccountId: s.ok ? s.acc.id : undefined, beneficiaryAccountId: bOwn ? (b.ok ? b.acc.id : master.id) : undefined };
  const charge = p.charge && p.charge > 0 ? { amount: p.charge } : undefined;
  const mediator = p.referenceId?.includes(":") ? p.referenceId.split(":").slice(1).join(":").trim() : undefined;
  const outName = p.beneficiary.accountName?.trim() || null;
  const inName = p.sender.accountName?.trim() || null;
  const narration = (to?: string | null) =>
    [mediator && `connectIPS Account: ${mediator}`, to && `To: ${to}`, p.particulars, p.remarks, p.txnId && `Txn ID: ${p.txnId}`, p.referenceId && !p.txnId && `Ref: ${p.referenceId}`, p.initiatorPhone && `Initiator: ${p.initiatorPhone}`, p.voucherNo && `Voucher No: ${p.voucherNo}`]
      .filter(Boolean).join(" | ");
  const warn = statusWarning(p);

  if (s.ok && bOwn)
    return { voucherType: "contra", candidates: ["contra"], typeConfidence: Math.min(0.99, Math.min(s.score, (b.ok ? b.score : master.score) || 0.9)), master, ...ids, counterParty: null, otherCharge: charge, narration: narration(), reason: "Sender own account and beneficiary own bank/company -> contra", statusWarning: warn };

  if (s.ok) {
    const cpName = outName;
    const base = { master, ...ids, counterParty: cpName, otherCharge: charge, narration: narration(cpName), statusWarning: warn };
    if (master.kind === "party") return { ...base, voucherType: "payment_out", payeeType: "party", candidates: ["payment_out"], typeConfidence: Math.max(0.85, master.score), reason: `Sender own; beneficiary matches party "${master.name}"` };
    if (master.kind === "staff") return { ...base, voucherType: "payment_out", payeeType: "staff", candidates: ["payment_out"], typeConfidence: Math.max(0.85, master.score), reason: `Sender own; beneficiary matches staff "${master.name}" (Payment, payee type Staff)` };
    // Named (or masked) counter-party not in masters: stay on Payment and offer create-party. Do NOT auto-switch to Direct Expense.
    return { ...base, voucherType: "payment_out", candidates: ["payment_out"], typeConfidence: 0.86, partyMissing: !!cpName, reason: cpName ? `Sender own; "${cpName}" matches no party/staff/own bank — stay on Payment and offer to create the party` : "Sender own; no beneficiary name — Payment" };
  }

  if (bOwn) {
    const cpName = inName;
    const party = cpName && !isMaskedName(cpName) ? bestMaster(cpName, o.parties) : null;
    const staff = cpName && !isMaskedName(cpName) ? bestMaster(cpName, o.staff) : null;
    const hit = party && (!staff || party.score >= staff.score) ? { kind: "party" as const, ...party } : staff ? { kind: "staff" as const, ...staff } : null;
    const masterIn = hit ? { kind: hit.kind, id: hit.m.id, name: hit.m.name, score: hit.score } : { kind: null, name: cpName || undefined, score: 0 };
    return {
      voucherType: "payment_in",
      candidates: ["payment_in"],
      typeConfidence: 0.86,
      ownSideConfidence: master.score,
      master: masterIn.kind ? masterIn : master,
      ...ids,
      payeeType: hit?.kind,
      counterParty: cpName,
      otherCharge: undefined,
      narration: narration(),
      partyMissing: !!cpName && !hit,
      reason: "Beneficiary own bank/company (money in) -> Receipt; stay on Receipt if the sender is not in masters",
      statusWarning: warn,
    };
  }

  // Neither side uniquely matched. Reference Id like ACCOUNTFT:<our company> is a soft outgoing hint (not auto-switch grade).
  if (outName) {
    const base = { master, ...ids, counterParty: outName, otherCharge: charge, narration: narration(outName), statusWarning: warn };
    const note = "sender account not uniquely matched in own Bank/Cash list";
    if (master.kind === "party") return { ...base, voucherType: "payment_out", payeeType: "party", candidates: ["payment_out"], typeConfidence: Math.min(0.84, master.score), reason: `Beneficiary "${outName}" is party "${master.name}" (not own) -> money out likely; ${note}` };
    if (master.kind === "staff") return { ...base, voucherType: "payment_out", payeeType: "staff", candidates: ["payment_out"], typeConfidence: Math.min(0.84, master.score), reason: `Beneficiary "${outName}" is staff "${master.name}" -> money out likely; ${note}` };
    const outgoing = referenceHintsOutgoing(p, o.companyName);
    return { ...base, voucherType: null, candidates: ["payment_out", "payment_in", "direct_expense", "direct_income", "contra"], typeConfidence: outgoing ? 0.7 : 0.5, partyMissing: true, reason: outgoing ? `Reference mentions our company; "${outName}" is not in masters — likely Payment, but type is not unique` : `Beneficiary "${outName}" is not own company/bank; ${note}` };
  }

  return { voucherType: null, candidates: ["payment_in", "payment_out", "direct_income", "direct_expense", "contra"], typeConfidence: 0, master, ...ids, counterParty: null, otherCharge: undefined, narration: narration(), reason: "Neither side is a unique own account/company and no beneficiary name", statusWarning: warn };
}

export function detectReceipt(text: string, o: ClassifyOptions): ReceiptDetection {
  const f = detectReceiptFormat(text);
  if (!f) return { format: null, confidence: 0, parsed: null, voucherType: null, candidates: [], typeConfidence: 0, master: { kind: null, score: 0 }, counterParty: null, reason: "No known receipt format" };
  if (f.det.billLike) {
    return { format: f.det.format, confidence: f.confidence, parsed: null, voucherType: null, candidates: [], typeConfidence: 0, master: { kind: null, score: 0 }, counterParty: null, reason: `${f.det.format} detected — use the bill/invoice parser` };
  }
  const parsed = f.det.parse(text);
  return { format: f.det.format, confidence: f.confidence, parsed, ...classifyReceipt(parsed, o) };
}
