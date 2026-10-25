/**
 * Bank-receipt detector registry. Add a new bank/receipt UI by writing a ReceiptFormatDetector and pushing it to DETECTORS.
 * Pure: no UI, no DB. Voucher type is decided by MASTER identification:
 *   sender own?  (Customer Account Details matched to own Bank/Cash by account no.)
 *   master       (Beneficiary Account Name -> own company/bank | party | staff; or beneficiary account no. -> own bank)
 * Particulars/Remarks only feed the narration.
 */
import { nameScore } from "../../../modules/ocr/fuzzy";
import { connectIpsDetector } from "./connectIps";
import { companyNameMatches, matchOwnAccount } from "./match";
import type { NamedMaster, OwnAccountLike, ParsedReceipt, ReceiptDetection, ReceiptFormatDetector, ReceiptMaster } from "./types";

export * from "./types";
export { maskedAccountMatches, bankNameMatches, matchOwnAccount, companyNameMatches } from "./match";

export const DETECTORS: ReceiptFormatDetector[] = [connectIpsDetector];
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

/** Identify the beneficiary master: own bank (account no. / company name / own account name) > party > staff. */
export function identifyBeneficiaryMaster(p: ParsedReceipt, o: ClassifyOptions): ReceiptMaster {
  const name = p.beneficiary.accountName?.trim() ?? "";
  const acc = matchOwnAccount(p.beneficiary, o.ownAccounts);
  if (acc) return { kind: "own_bank", id: acc.acc.id, name: acc.acc.accountName ?? name, score: Math.min(0.99, 0.7 + acc.score * 0.3) };
  if (name && o.companyName && companyNameMatches(name, o.companyName)) return { kind: "own_bank", name, score: 0.99 };
  if (!name) return { kind: null, score: 0 };
  const own = bestMaster(name, o.ownAccounts.map((a) => ({ id: a.id, name: a.accountName ?? "" })));
  if (own && own.score >= 0.97) return { kind: "own_bank", id: own.m.id, name: own.m.name, score: own.score };
  const party = bestMaster(name, o.parties), staff = bestMaster(name, o.staff);
  if (party && (!staff || party.score >= staff.score)) return { kind: "party", id: party.m.id, name: party.m.name, score: party.score };
  if (staff) return { kind: "staff", id: staff.m.id, name: staff.m.name, score: staff.score };
  return { kind: null, name, score: 0 };
}

type Classified = Omit<ReceiptDetection, "format" | "confidence" | "parsed">;

export function classifyReceipt(p: ParsedReceipt, o: ClassifyOptions): Classified {
  const s = matchOwnAccount(p.sender, o.ownAccounts);
  const master = identifyBeneficiaryMaster(p, o);
  const bOwn = master.kind === "own_bank";
  const ids = { senderAccountId: s?.acc.id, beneficiaryAccountId: bOwn ? master.id : undefined };
  const charge = p.charge && p.charge > 0 ? { amount: p.charge } : undefined;
  const mediator = p.referenceId?.includes(":") ? p.referenceId.split(":").slice(1).join(":").trim() : undefined;
  const cpName = p.beneficiary.accountName?.trim() || null;
  const narration = (to?: string | null) => [mediator && `connectIPS Account: ${mediator}`, to && `To: ${to}`, p.particulars, p.remarks, p.txnId && `Txn ID: ${p.txnId}`].filter(Boolean).join(" | ");

  if (s && bOwn)
    return { voucherType: "contra", candidates: ["contra"], typeConfidence: Math.min(0.99, master.score), master, ...ids, counterParty: null, otherCharge: charge, narration: narration(), reason: "Sender own account and beneficiary own bank/company -> contra" };
  if (s) {
    const base = { master, ...ids, counterParty: cpName, otherCharge: charge, narration: narration(cpName) };
    if (master.kind === "party") return { ...base, voucherType: "payment_out", payeeType: "party", candidates: ["payment_out"], typeConfidence: master.score, reason: `Sender own; beneficiary matches party "${master.name}"` };
    if (master.kind === "staff") return { ...base, voucherType: "payment_out", payeeType: "staff", candidates: ["payment_out"], typeConfidence: master.score, reason: `Sender own; beneficiary matches staff "${master.name}" (Payment Out, payee type Staff)` };
    return { ...base, voucherType: "direct_expense", candidates: ["direct_expense", "payment_out"], typeConfidence: 0.5, reason: cpName ? `Sender own; "${cpName}" matches no party/staff/own bank` : "Sender own; no beneficiary name" };
  }
  if (bOwn)
    return { voucherType: null, candidates: ["payment_in", "direct_income"], typeConfidence: 0.5, ownSideConfidence: master.score, master, ...ids, counterParty: null, otherCharge: undefined, narration: narration(), reason: "Beneficiary own bank/company (money in); sender not own and has no name on connectIPS -> Receipt or Direct Income" };
  // Neither side matched by account no.: a named beneficiary that is NOT us means the money went OUT from us
  // (connectIPS slip is the sender's copy). Party/staff match is decisive; otherwise Payment Out first, Direct Expense next.
  if (cpName) {
    const base = { master, ...ids, counterParty: cpName, otherCharge: charge, narration: narration(cpName) };
    const note = "sender account not in own Bank/Cash list";
    if (master.kind === "party") return { ...base, voucherType: "payment_out", payeeType: "party", candidates: ["payment_out"], typeConfidence: Math.min(0.9, master.score), reason: `Beneficiary "${cpName}" is party "${master.name}" (not own) -> money out; ${note}` };
    if (master.kind === "staff") return { ...base, voucherType: "payment_out", payeeType: "staff", candidates: ["payment_out"], typeConfidence: Math.min(0.9, master.score), reason: `Beneficiary "${cpName}" is staff "${master.name}" -> money out (payee type Staff); ${note}` };
    return { ...base, voucherType: null, candidates: ["payment_out", "direct_expense", "payment_in", "direct_income", "contra"], typeConfidence: 0.6, reason: `Beneficiary "${cpName}" is not own company/bank -> money out likely; no party/staff match; ${note}` };
  }
  return { voucherType: null, candidates: ["payment_in", "payment_out", "direct_income", "direct_expense", "contra"], typeConfidence: 0, master, ...ids, counterParty: null, otherCharge: undefined, narration: narration(), reason: "Neither side is an own account/company and no beneficiary name" };
}

export function detectReceipt(text: string, o: ClassifyOptions): ReceiptDetection {
  const f = detectReceiptFormat(text);
  if (!f) return { format: null, confidence: 0, parsed: null, voucherType: null, candidates: [], typeConfidence: 0, master: { kind: null, score: 0 }, counterParty: null, reason: "No known receipt format" };
  const parsed = f.det.parse(text);
  return { format: f.det.format, confidence: f.confidence, parsed, ...classifyReceipt(parsed, o) };
}
