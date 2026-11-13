/**
 * Money-document -> Payment / Receipt / Contra form values (pure).
 * Unified own-account scorer (mask + bank + branch + title) is used for both classification and fill.
 */
import { parseSingleDocDate } from "../dates";
import { isMaskedName, maskedNameSuffix } from "./genericFields";
import { masterNameScore } from "./index";
import { bankNameMatches, pickUniqueOwnAccount, type OwnAccountScore } from "./match";
import type { NamedMaster, OwnAccountLike, ParsedReceipt, ReceiptAccountSide as ReceiptSide } from "./types";

export type PayeeMatch = { payeeType: "party" | "staff" | "tax"; id: string; name: string; score: number };
export type FromAccountMatch =
  | { ok: true; id: string; name: string; method: string; reason: string }
  | { ok: false; candidates: string[]; candidateNames?: string[]; reason: string };

const NAME_MIN = 0.9, NAME_GAP = 0.03;

export function matchPayee(name: string | undefined | null, m: { parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[]; taxes?: readonly NamedMaster[] }): PayeeMatch | null {
  const q = String(name ?? "").trim();
  if (!q || isMaskedName(q)) return null; // surname-only / masked -> not sure (caller may suggest)
  const all: PayeeMatch[] = [];
  const add = (kind: PayeeMatch["payeeType"], pool?: readonly NamedMaster[]) => (pool ?? []).forEach((x) => {
    const s = Math.max(masterNameScore(q, x.name), x.aliasName ? masterNameScore(q, x.aliasName) : 0);
    all.push({ payeeType: kind, id: x.id, name: x.name, score: s });
  });
  add("party", m.parties); add("staff", m.staff); add("tax", m.taxes);
  all.sort((a, b) => b.score - a.score || (a.payeeType === "party" ? -1 : 1));
  const [b, s] = all;
  if (!b || b.score < NAME_MIN) return null;
  if (s && s.id !== b.id && b.score - s.score < NAME_GAP) return null; // ambiguous
  return b;
}

/** Masked names like "****** DHAMI": suggest parties whose last token matches, never auto-fill. */
export function suggestMaskedPayees(name: string | undefined | null, m: { parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[] }): PayeeMatch[] {
  const suf = maskedNameSuffix(name ?? undefined);
  if (!suf) return [];
  const q = suf.toLowerCase();
  const hits: PayeeMatch[] = [];
  const add = (kind: PayeeMatch["payeeType"], pool?: readonly NamedMaster[]) => {
    for (const x of pool ?? []) {
      const last = String(x.name ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
      const aliasLast = String(x.aliasName ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
      if (last === q || aliasLast === q) hits.push({ payeeType: kind, id: x.id, name: x.name, score: 0.6 });
    }
  };
  add("party", m.parties); add("staff", m.staff);
  return hits;
}

const words = (s?: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const accText = (a: OwnAccountLike) => words(`${a.accountName ?? ""} ${a.bankName ?? ""} ${a.branch ?? ""}`);

/**
 * connectIPS prints only "Nabiullah Ansari" (the account holder), no bank and a masked A/c, so the number
 * never proves anything. Feed the printed name into the side so the proof-weighted matcher can still find
 * the ledger by holder name — account-number/bank hits always outrank it inside match.ts.
 */
function withName(side: ReceiptSide, p: ParsedReceipt): ReceiptSide {
  const holder = side.accountName || p.sender.accountName || p.beneficiary.accountName;
  return holder && !side.accountName ? { ...side, accountName: holder } : side;
}

/** "paid from Prabhu Itahari" / "paid frm NIC" in Particulars or Remarks. */
export function paidFromPhrase(p: Pick<ParsedReceipt, "particulars" | "remarks">): string | null {
  const t = `${p.particulars ?? ""} ; ${p.remarks ?? ""}`;
  const m = t.match(/\bpaid\s*fr(?:o|0)?m\s*[:\-]?\s*([A-Za-z0-9 .&'-]{2,60}?)(?=\s*(?:[;|,]|$|\bto\b|\bfor\b))/i);
  return m ? m[1].trim() : null;
}

export function matchFromAccount(p: ParsedReceipt, own: readonly OwnAccountLike[], side: "sender" | "beneficiary" = "sender"): FromAccountMatch {
  const live = own.filter((a) => a.id);
  const phrase = side === "sender" ? paidFromPhrase(p) : null;
  if (phrase) {
    const q = words(phrase);
    const sc = live.map((a) => ({ a, s: masterNameScore(phrase, a.accountName) })).sort((x, y) => y.s - x.s);
    // Every account sharing the best score is a real tie (two ledgers with the same company name) — never a coin flip.
    let byPhrase: OwnAccountLike[] = sc.length && sc[0].s >= NAME_MIN ? sc.filter((x) => x.s >= sc[0].s - NAME_GAP).map((x) => x.a) : sc.filter((x) => x.s >= NAME_MIN).map((x) => x.a);
    if (!byPhrase.length) byPhrase = live.filter((a) => q.length >= 3 && accText(a).includes(q));
    if (!byPhrase.length) byPhrase = live.filter((a) => bankNameMatches(phrase, a.bankName));
    if (byPhrase.length === 1) {
      const a = byPhrase[0];
      return { ok: true, id: a.id, name: a.accountName ?? a.id, method: "paid-from", reason: `"paid from ${phrase}"` };
    }
  }
  const picked = pickUniqueOwnAccount(withName(side === "sender" ? p.sender : p.beneficiary, p), live);
  // tsconfig has strict:false (no strictNullChecks), so discriminated-union narrowing on `.ok` does not apply.
  if ("candidates" in picked) {
    const tied = picked.candidates;
    return {
      ok: false,
      candidates: tied.map((c) => c.acc.id),
      candidateNames: tied.map((c) => c.acc.accountName ?? c.acc.id),
      reason: picked.reason,
    };
  }
  return { ok: true, id: picked.acc.id, name: picked.acc.accountName ?? picked.acc.id, method: picked.method, reason: picked.reason };
}

/** "17-Oct-2026 01:44:04 PM" / "06 Nov 2026" / "15/07/2083" -> local Date. */
export function parseReceiptDate(s?: string): Date | null {
  return parseSingleDocDate(s ?? "");
}

/** Same text as the From Bank/Cash dropdown trigger: "Prabhu Bank Limited (Bank)". */
export function accountDisplayLabel(a?: Pick<OwnAccountLike, "accountName" | "accountType"> | null): string {
  if (!a?.accountName) return "";
  return a.accountType ? `${a.accountName} (${a.accountType})` : String(a.accountName);
}

export function receiptNarration(p: ParsedReceipt, fromLabel?: string | null, toLabel?: string | null): string {
  const mediator = p.referenceId?.includes(":") ? p.referenceId.split(":").slice(1).join(":").trim() : undefined;
  const to = toLabel ?? (p.beneficiary.accountName ? `To: ${p.beneficiary.accountName}` : undefined);
  const from = fromLabel || undefined;
  return [
    mediator && `connectIPS Account: ${mediator}`,
    from,
    to,
    p.particulars,
    p.remarks,
    p.txnId && `Txn ID: ${p.txnId}`,
    p.referenceId && p.referenceId !== p.txnId && !mediator && `Ref: ${p.referenceId}`,
    p.initiatorPhone && `Initiator: ${p.initiatorPhone}`,
    p.voucherNo && `Voucher No: ${p.voucherNo}`,
  ].filter(Boolean).join(" | ");
}

export type PaymentOutFill = {
  payee: PayeeMatch | null;
  payeeName: string | null;
  payeeUnsure?: PayeeMatch[];
  from: FromAccountMatch;
  to?: FromAccountMatch;
  amount?: number;
  charge?: number;
  date: Date | null;
  narration: string;
  txnId?: string;
  referenceId?: string;
  status?: string;
};

export type MoneyDirection = "payment_out" | "payment_in" | "contra";

export function buildPaymentOutFill(p: ParsedReceipt, m: { ownAccounts: readonly OwnAccountLike[]; parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[]; taxes?: readonly NamedMaster[] }): PaymentOutFill {
  return buildMoneyVoucherFill(p, "payment_out", m);
}

export function buildMoneyVoucherFill(
  p: ParsedReceipt,
  direction: MoneyDirection,
  m: { ownAccounts: readonly OwnAccountLike[]; parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[]; taxes?: readonly NamedMaster[] },
): PaymentOutFill {
  const ourSide = direction === "payment_in" ? "beneficiary" : "sender";
  const otherSide = direction === "payment_in" ? "sender" : "beneficiary";
  const payeeName = (otherSide === "sender" ? p.sender.accountName : p.beneficiary.accountName)?.trim() || null;
  const from = matchFromAccount(p, m.ownAccounts, ourSide);
  const to = direction === "contra" ? matchFromAccount(p, m.ownAccounts, "beneficiary") : undefined;
  const payee = direction === "contra" ? null : matchPayee(payeeName, m);
  const payeeUnsure = !payee && isMaskedName(payeeName ?? undefined) ? suggestMaskedPayees(payeeName, m) : undefined;
  const fromLabel = from.ok ? accountDisplayLabel(m.ownAccounts.find((a) => a.id === from.id) as never) : null;
  const toLabel = to?.ok ? `To: ${accountDisplayLabel(m.ownAccounts.find((a) => a.id === to.id) as never)}` : (direction === "payment_out" || direction === "contra" ? (p.beneficiary.accountName ? `To: ${p.beneficiary.accountName}` : null) : (p.sender.accountName ? `From: ${p.sender.accountName}` : null));
  return {
    payee, payeeName, payeeUnsure,
    from, to,
    amount: p.amount && p.amount > 0 ? p.amount : undefined,
    charge: p.charge && p.charge > 0 ? p.charge : undefined,
    date: parseReceiptDate(p.date),
    narration: receiptNarration(p, fromLabel, toLabel),
    txnId: p.txnId,
    referenceId: p.referenceId,
    status: p.status,
  };
}

/* ---- Other-charge account picking (bank charge ledger) ---- */
export type ChargeCandidate = { id: string; name: string; kind?: "expense" | "party" | "staff" };
export type ChargeAccountPick = { id: string; name: string; method: "detected" | "default"; score: number } | null;

function chargeNameScore(name: string, bank?: string): number {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return 0;
  let s = 0;
  if (/\bbank\s*charges?\b/.test(n)) s = 1;
  else if (/\b(service|transaction|transfer|ips|connectips)\s*charges?\b/.test(n)) s = 0.8;
  else if (/\bcommissions?\b/.test(n)) s = 0.6;
  else if (/\bcharges?\b/.test(n)) s = 0.5;
  if (!s) return 0;
  const b = String(bank || "").toLowerCase().replace(/^\s*\d+\s*-\s*/, "").replace(/\b(bank|limited|ltd|pvt|private)\b/g, " ").replace(/[^a-z0-9 ]+/g, " ").trim();
  const bw = b.split(/\s+/).filter((w) => w.length >= 3);
  if (bw.length && bw.some((w) => n.includes(w))) s += 0.15;
  return s;
}

/** OCR-detected charge ledger wins; else saved default (if still valid); else null. Expense ledgers preferred. */
export function pickChargeAccount(cands: readonly ChargeCandidate[], opts: { bankName?: string; defaultId?: string | null } = {}): ChargeAccountPick {
  const scored = cands
    .map((c) => ({ c, s: chargeNameScore(c.name, opts.bankName) + (c.kind && c.kind !== "expense" ? -0.3 : 0) }))
    .filter((x) => x.s > 0.2)
    .sort((a, b) => b.s - a.s);
  if (scored.length && (scored.length === 1 || scored[0].s - scored[1].s >= 0.05)) {
    return { id: scored[0].c.id, name: scored[0].c.name, method: "detected", score: scored[0].s };
  }
  const d = String(opts.defaultId || "").trim();
  if (d) {
    const hit = cands.find((c) => c.id === d);
    if (hit) return { id: hit.id, name: hit.name, method: "default", score: 0 };
  }
  // Tie among detected and no default: take first only if it's a clear "bank charge" expense
  if (scored.length && scored[0].s >= 1 && scored[0].c.kind !== "party" && scored[0].c.kind !== "staff" && scored[0].s - scored[1].s > 0) {
    return { id: scored[0].c.id, name: scored[0].c.name, method: "detected", score: scored[0].s };
  }
  return null;
}
