/**
 * AI (Gemini) structured answer -> ReceiptDetection.
 *
 * The text detectors only see the compact summary Gemini returns (no full paper text), so the slip's
 * customer/beneficiary sections are missing there. Gemini's JSON already carries them as
 * `bank_flow` + `debit_account` / `credit_account` / `transfer_charges` / `transfer_reference`,
 * so money documents are classified from that instead of hoping the text rules re-derive it.
 */
import type { OcrAiVoucher } from "../../../modules/ocr/ai/aiVoucher";
import { nameScore } from "../../../modules/ocr/fuzzy";
import { companyNameMatches, pickUniqueOwnAccount } from "./match";
import { isMaskedName } from "./genericFields";
import type { ClassifyOptions, ReceiptDetection } from "./index";
import type { NamedMaster } from "./types";

/** Best unique name in a pool (kept local: `bestMaster` in index.ts is private to avoid a cycle). */
function bestMaster(name: string, pool: readonly NamedMaster[] = []): { m: NamedMaster; score: number } | null {
  let best: { m: NamedMaster; score: number } | null = null;
  let second = 0;
  for (const m of pool) {
    const s = Math.max(nameScore(name, m.name), m.aliasName ? nameScore(name, m.aliasName) : 0);
    if (!best || s > best.score) { if (best) second = Math.max(second, best.score); best = { m, score: s }; }
    else second = Math.max(second, s);
  }
  return best && best.score >= 0.9 && best.score - second >= 0.03 ? best : null;
}
const isMoneyKind = (d: OcrAiVoucher) =>
  d.doc_kind === "bank_transfer" || d.doc_kind === "cheque" || d.doc_kind === "deposit_slip" ||
  d.bank_flow === "own_to_own" || d.bank_flow === "in" || d.bank_flow === "out" ||
  /connectips|ips|rtgs|cheque|deposit\s*slip|bank\s*transfer/i.test(String(d.transfer_mode ?? ""));

/** Gemini gave us no usable money-flow answer: let the text detectors decide. */
export function classifyAiReceipt(d: OcrAiVoucher, o: ClassifyOptions): ReceiptDetection | null {
  if (!isMoneyKind(d)) return null;
  const flow = d.bank_flow;
  if (flow !== "own_to_own" && flow !== "in" && flow !== "out") return null;

  const debit = { accountMasked: d.debit_account ?? undefined, bankName: d.debit_bank ?? undefined, accountName: d.account_holder_name ?? undefined };
  const credit = { accountMasked: d.credit_account ?? undefined, bankName: d.credit_bank ?? undefined, accountName: d.beneficiary_name ?? d.party_name ?? undefined };
  const senderPick = pickUniqueOwnAccount(debit, o.ownAccounts);
  const creditPick = pickUniqueOwnAccount(credit, o.ownAccounts);
  /* Beneficiary "Account Name" is our company on a bank-to-bank slip (nobody sells to themselves):
   * that alone makes the receiving ledger ours -> contra, even before the account number matches. */
  const creditIsCompany = !!d.beneficiary_name && !!o.companyName && companyNameMatches(d.beneficiary_name, o.companyName);
  /* Gemini can contradict its own bank_flow: it wrote "Both customer and beneficiary accounts belong to our
   * company" yet answered out. That printed reason is evidence too — honour it before falling back. */
  const reasonSaysBoth = /both\s+(?:customer|sender|debit).{0,40}(?:beneficiary|credit).{0,40}(?:our|same)/i.test(String(d.bank_flow_reason ?? ""));
  const destOurs = creditPick.ok || creditIsCompany;
  const effectiveFlow = flow === "out" && senderPick.ok && (destOurs || reasonSaysBoth) ? "own_to_own" : flow;
  const charge = d.transfer_charges != null && d.transfer_charges > 0 ? { amount: d.transfer_charges } : undefined;
  const narration = [
    d.account_holder_name && `connectIPS Account: ${d.account_holder_name}`,
    d.party_name && flow !== "in" ? `To: ${d.party_name}` : d.party_name ? `From: ${d.party_name}` : null,
    d.transfer_mode, d.transfer_reference && `Ref: ${d.transfer_reference}`,
  ].filter(Boolean).join(" | ");

  /* Gemini's JSON is the only place the payer name exists on a connectIPS slip (the compact text summary prints
   * it once as "connectIPS Account: X"). Handing it to the fill step is what lets a ledger named after the
   * company be found from the holder name alone (via its Alias Name, or a 50%+ name match + proof). */
  const aiParsed = {
    sender: { accountName: d.account_holder_name ?? undefined, bankName: d.debit_bank ?? undefined, accountMasked: d.debit_account ?? undefined },
    beneficiary: { accountName: d.beneficiary_name ?? d.party_name ?? undefined, bankName: d.credit_bank ?? undefined, accountMasked: d.credit_account ?? undefined },
    date: d.date_ad ?? d.date_bs ?? undefined,
    amount: d.grand_total ?? undefined,
    charge: d.transfer_charges ?? undefined,
    referenceId: d.transfer_reference ?? undefined,
    particulars: d.party_name ?? undefined,
  };

  const base = {
    format: "connectips",
    confidence: 0.95,
    parsed: aiParsed,
    counterParty: d.party_name ?? null,
    otherCharge: charge,
    narration,
    reason: `AI: ${d.doc_kind ?? "money document"}, flow ${effectiveFlow === flow ? flow : `${flow} → own_to_own (beneficiary name is our company)`}${d.bank_flow_reason ? ` (${d.bank_flow_reason.slice(0, 120)})` : ""}`,
  };

  if (effectiveFlow === "own_to_own") {
    return {
      ...base,
      voucherType: "contra",
      candidates: ["contra"],
      typeConfidence: 0.95,
      master: { kind: "own_bank", id: senderPick.ok ? senderPick.acc.id : creditPick.ok ? creditPick.acc.id : undefined, score: 0.95 },
      senderAccountId: senderPick.ok ? senderPick.acc.id : undefined,
      beneficiaryAccountId: creditPick.ok ? creditPick.acc.id : undefined,
      partyMissing: false,
    };
  }

  if (effectiveFlow === "out") {
    const name = d.party_name ?? null;
    const party = name && !isMaskedName(name) ? bestMaster(name, o.parties) : null;
    const staff = name && !isMaskedName(name) ? bestMaster(name, o.staff) : null;
    const hit = party && (!staff || party.score >= staff.score) ? { kind: "party" as const, ...party } : staff ? { kind: "staff" as const, ...staff } : null;
    return {
      ...base,
      voucherType: "payment_out",
      candidates: ["payment_out"],
      typeConfidence: 0.9,
      master: hit ? { kind: hit.kind, id: hit.m.id, name: hit.m.name, score: hit.score } : { kind: null, name: name ?? undefined, score: 0 },
      payeeType: hit?.kind,
      senderAccountId: senderPick.ok ? senderPick.acc.id : undefined,
      partyMissing: !!name && !hit,
    };
  }

  // in
  const name = d.party_name ?? null;
  const ownIn = (name && o.companyName && companyNameMatches(name, o.companyName)) || creditPick.ok;
  const party = name && !isMaskedName(name) ? bestMaster(name, o.parties) : null;
  const staff = name && !isMaskedName(name) ? bestMaster(name, o.staff) : null;
  const hit = party && (!staff || party.score >= staff.score) ? { kind: "party" as const, ...party } : staff ? { kind: "staff" as const, ...staff } : null;
  return {
    ...base,
    voucherType: "payment_in",
    candidates: ["payment_in"],
    typeConfidence: 0.9,
    master: hit && !ownIn ? { kind: hit.kind, id: hit.m.id, name: hit.m.name, score: hit.score } : { kind: ownIn ? "own_bank" : null, id: creditPick.ok ? creditPick.acc.id : undefined, name: name ?? undefined, score: ownIn ? 0.95 : 0 },
    payeeType: hit && !ownIn ? hit.kind : undefined,
    beneficiaryAccountId: creditPick.ok ? creditPick.acc.id : undefined,
    partyMissing: !!name && !hit && !ownIn,
  };
}
