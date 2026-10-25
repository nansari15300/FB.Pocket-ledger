/**
 * connectIPS receipt -> Payment Out form values (pure). Used by useVoucherOcr only on the Payment Out tab.
 * Payee (Dr): Beneficiary Account Name vs party / staff / tax names only.
 * From (Cr): own Bank/Cash only, from Customer Account Details (bank -> branch -> masked acc no.) + "paid from <x>" in Particulars/Remarks.
 */
import { masterNameScore } from "./index";
import { bankNameMatches, maskedAccountMatches } from "./match";
import type { NamedMaster, OwnAccountLike, ParsedReceipt } from "./types";

export type PayeeMatch = { payeeType: "party" | "staff" | "tax"; id: string; name: string; score: number };
export type FromAccountMatch =
  | { ok: true; id: string; name: string; method: string; reason: string }
  | { ok: false; candidates: string[]; reason: string };

const NAME_MIN = 0.9, NAME_GAP = 0.03;

export function matchPayee(name: string | undefined | null, m: { parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[]; taxes?: readonly NamedMaster[] }): PayeeMatch | null {
  const q = String(name ?? "").trim();
  if (!q) return null;
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

const stripCode = (s?: string) => String(s ?? "").replace(/^\s*\d+\s*-\s*/, "").trim();
const words = (s?: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const branchWord = (s?: string) => words(stripCode(s)).replace(/\b(branch|br|office)\b/g, " ").replace(/\s+/g, " ").trim();
const accText = (a: OwnAccountLike) => words(`${a.accountName ?? ""} ${a.bankName ?? ""}`);

/** "paid from Prabhu Itahari" / "paid frm NIC" in Particulars or Remarks. */
export function paidFromPhrase(p: Pick<ParsedReceipt, "particulars" | "remarks">): string | null {
  const t = `${p.particulars ?? ""} ; ${p.remarks ?? ""}`;
  const m = t.match(/\bpaid\s*fr(?:o|0)?m\s*[:\-]?\s*([A-Za-z0-9 .&'-]{2,60}?)(?=\s*(?:[;|,]|$|\bto\b|\bfor\b))/i);
  return m ? m[1].trim() : null;
}

export function matchFromAccount(p: ParsedReceipt, own: readonly OwnAccountLike[]): FromAccountMatch {
  const live = own.filter((a) => a.id);
  const phrase = paidFromPhrase(p);
  let byPhrase: OwnAccountLike[] = [];
  if (phrase) {
    const q = words(phrase);
    // strongest first: account name ~ phrase, then phrase contained in account text, then bank name only
    const sc = live.map((a) => ({ a, s: masterNameScore(phrase, a.accountName) })).sort((x, y) => y.s - x.s);
    byPhrase = sc[0] && sc[0].s >= NAME_MIN && (!sc[1] || sc[0].s - sc[1].s >= NAME_GAP) ? [sc[0].a] : sc.filter((x) => x.s >= NAME_MIN).map((x) => x.a);
    if (!byPhrase.length) byPhrase = live.filter((a) => q.length >= 3 && accText(a).includes(q));
    if (!byPhrase.length) byPhrase = live.filter((a) => bankNameMatches(phrase, a.bankName));
  }
  const bank = stripCode(p.sender.bankName);
  let c = bank ? live.filter((a) => bankNameMatches(bank, a.bankName) || bankNameMatches(bank, a.accountName)) : [];
  const steps: string[] = [];
  if (bank) steps.push(`bank "${bank}": ${c.length}`);
  if (c.length > 1) {
    const br = branchWord(p.sender.branch);
    const n = br ? c.filter((a) => accText(a).includes(br)) : [];
    if (br) steps.push(`branch "${br}": ${n.length}`);
    if (n.length) c = n;
  }
  if (c.length > 1 && p.sender.accountMasked) {
    const n = c.filter((a) => maskedAccountMatches(p.sender.accountMasked, a.accountNumber));
    steps.push(`acc no. ${p.sender.accountMasked}: ${n.length}`);
    if (n.length) c = n;
  }
  // "paid from" phrase decides (and confirms/narrows a bank match)
  if (byPhrase.length === 1) {
    const a = byPhrase[0];
    const agrees = !c.length || c.some((x) => x.id === a.id);
    return { ok: true, id: a.id, name: a.accountName ?? a.id, method: "paid-from", reason: `"paid from ${phrase}"${agrees ? "" : " (overrides Customer Account bank)"}; ${steps.join(", ")}` };
  }
  if (byPhrase.length > 1 && c.length) {
    const n = c.filter((x) => byPhrase.some((b) => b.id === x.id));
    if (n.length === 1) c = n;
  }
  if (c.length === 1) return { ok: true, id: c[0].id, name: c[0].accountName ?? c[0].id, method: steps.length > 2 ? "account-no" : steps.length > 1 ? "branch" : "bank", reason: steps.join(", ") };
  return { ok: false, candidates: c.map((a) => a.id), reason: c.length ? `${c.length} own accounts still match (${steps.join(", ")})` : `no own Bank/Cash account matches ${bank ? `"${bank}"` : "the sender"}${phrase ? ` or "paid from ${phrase}"` : ""}` };
}

const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** "17-Oct-2026 01:44:04 PM" -> local Date (AD; the form converts for BS display itself). Date part only. */
export function parseReceiptDate(s?: string): Date | null {
  const m = String(s ?? "").match(/(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3})[a-z]*\s*[-/ ]\s*(\d{4})/);
  if (m && MON[m[2].toLowerCase()] != null) { const d = new Date(+m[3], MON[m[2].toLowerCase()], +m[1]); return Number.isNaN(d.getTime()) ? null : d; }
  const n = String(s ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (n) return new Date(+n[1], +n[2] - 1, +n[3]);
  return null;
}

/** Same text as the From Bank/Cash dropdown trigger: "Prabhu Bank Limited (Bank)". */
export function accountDisplayLabel(a?: Pick<OwnAccountLike, "accountName" | "accountType"> | null): string {
  if (!a?.accountName) return "";
  return a.accountType ? `${a.accountName} (${a.accountType})` : String(a.accountName);
}

export function receiptNarration(p: ParsedReceipt, fromLabel?: string | null): string {
  const mediator = p.referenceId?.includes(":") ? p.referenceId.split(":").slice(1).join(":").trim() : undefined;
  return [mediator && `connectIPS Account: ${mediator}`, fromLabel || undefined, p.beneficiary.accountName && `To: ${p.beneficiary.accountName}`, p.particulars, p.remarks, p.txnId && `Txn ID: ${p.txnId}`].filter(Boolean).join(" | ");
}

export type PaymentOutFill = {
  payee: PayeeMatch | null;
  payeeName: string | null;
  from: FromAccountMatch;
  amount?: number;
  charge?: number;
  date: Date | null;
  narration: string;
};

export function buildPaymentOutFill(p: ParsedReceipt, m: { ownAccounts: readonly OwnAccountLike[]; parties?: readonly NamedMaster[]; staff?: readonly NamedMaster[]; taxes?: readonly NamedMaster[] }): PaymentOutFill {
  const payeeName = p.beneficiary.accountName?.trim() || null;
  const from = matchFromAccount(p, m.ownAccounts);
  return {
    payee: matchPayee(payeeName, m), payeeName,
    from,
    amount: p.amount && p.amount > 0 ? p.amount : undefined,
    charge: p.charge && p.charge > 0 ? p.charge : undefined,
    date: parseReceiptDate(p.date),
    narration: receiptNarration(p, from.ok ? accountDisplayLabel(m.ownAccounts.find((a) => a.id === from.id)) : null),
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
