import type { OwnAccountLike, ReceiptAccountSide } from "./types";
import { accountProof, matchMasters } from "../../../modules/ocr/masterMatch";

/** Keep digits and mask wildcards; normalize # x X to *. */
export function maskDigits(s?: string): string {
  return String(s ?? "").replace(/[^0-9*#xX]/g, "").replace(/[#xX]/g, "*");
}

const words = (s?: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/^\s*\d+\s*-\s*/, "")
    .replace(/\b(limited|ltd|pvt|private|bank|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Masked account match: visible prefix, suffix, and mid-span digits against a full (or stored) number.
 * Mask chars: * # x X. No equal-length requirement (so 208***010 and 054##68800011 work).
 * Requires >= 3 visible trailing digits.
 */
export function maskedAccountMatches(masked?: string, full?: string): boolean {
  const m = maskDigits(masked);
  const f = maskDigits(full).replace(/\*/g, "");
  if (!m || !f) return false;
  if (!m.includes("*")) return m === f;
  const pre = m.match(/^\d*/)?.[0] ?? "";
  const suf = (m.match(/\d*$/)?.[0] ?? "");
  if (suf.length < 3) return false;
  if (pre && !f.startsWith(pre)) return false;
  if (!f.endsWith(suf)) return false;
  const parts = m.split("*").filter(Boolean);
  if (parts.length >= 3) {
    let cursor = pre.length;
    const end = f.length - suf.length;
    for (const part of parts.slice(1, -1)) {
      const idx = f.indexOf(part, cursor);
      if (idx < 0 || idx + part.length > end) return false;
      cursor = idx + part.length;
    }
  }
  const visible = m.replace(/\*/g, "");
  return visible.length <= f.length;
}

export function bankNameMatches(a?: string, b?: string): boolean {
  const x = words(a), y = words(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function branchWord(s?: string): string {
  return words(String(s ?? "").replace(/^\s*\d+\s*-\s*/, "")).replace(/\b(branch|br|office)\b/g, " ").replace(/\s+/g, " ").trim();
}

const accText = (a: OwnAccountLike) => words(`${a.accountName ?? ""} ${a.bankName ?? ""} ${a.branch ?? ""}`);

export type OwnAccountScore = {
  acc: OwnAccountLike;
  score: number;
  reasons: string[];
  method: "account-no" | "branch" | "bank" | "name" | "none";
};

const TIE_GAP = 0.08;

/** Score every own Bank/Cash account against one slip side. One scorer for classify + fill. */
export function scoreOwnAccounts(side: ReceiptAccountSide, own: readonly OwnAccountLike[]): OwnAccountScore[] {
  const out: OwnAccountScore[] = [];
  for (const acc of own) {
    if (!acc?.id) continue;
    let s = 0;
    const reasons: string[] = [];
    let method: OwnAccountScore["method"] = "none";
    if (maskedAccountMatches(side.accountMasked, acc.accountNumber)) {
      const vis = maskDigits(side.accountMasked).replace(/\*/g, "").length;
      s += vis >= 8 ? 0.75 : vis >= 6 ? 0.7 : 0.65;
      reasons.push(`acc no. ${side.accountMasked}`);
      method = "account-no";
    }
    if (bankNameMatches(side.bankName, acc.bankName) || bankNameMatches(side.bankName, acc.accountName)) {
      s += 0.2;
      reasons.push(`bank "${String(side.bankName ?? "").replace(/^\s*\d+\s*-\s*/, "").trim()}"`);
      if (method === "none") method = "bank";
    }
    const br = branchWord(side.branch);
    if (br && (accText(acc).includes(br) || branchWord(acc.branch) === br || branchWord(acc.accountName).includes(br))) {
      s += 0.15;
      reasons.push(`branch "${br}"`);
      if (method === "none" || method === "bank") method = "branch";
    }
    if (side.accountName && words(side.accountName) && words(side.accountName) === words(acc.accountName)) {
      s += 0.1;
      reasons.push("account name");
      if (method === "none") method = "name";
    }
    if (s > 0) out.push({ acc, score: s, reasons, method });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export type UniqueOwnAccount =
  | { ok: true; acc: OwnAccountLike; score: number; method: OwnAccountScore["method"]; reason: string }
  | { ok: false; candidates: OwnAccountScore[]; reason: string };

/** Unique top score → auto-fill; near-tie → candidates for a pick popup. */
export function pickUniqueOwnAccount(side: ReceiptAccountSide, own: readonly OwnAccountLike[]): UniqueOwnAccount {
  const scored = scoreOwnAccounts(side, own);
  if (!scored.length) {
    const bank = String(side.bankName ?? "").replace(/^\s*\d+\s*-\s*/, "").trim();
    // No account-number/bank/branch hit: fall back to proof-weighted NAME matching so a 50%+ account
    // name with supporting evidence still resolves, while a bare 50-90% name is offered, not filled.
    if (side.accountName) {
      const m = matchMasters(side.accountName, own, (a) => [String(a.accountName ?? ""), String(a.bankName ?? "")], (a) =>
        accountProof(
          { accountNumber: side.accountMasked, bankName: side.bankName, branch: side.branch },
          { accountNumber: a.accountNumber, bankName: a.bankName, branch: a.branch },
        ));
      if (m.decision === "auto" && m.best) {
        return { ok: true, acc: m.best.item, score: m.best.name, method: "name", reason: `${Math.round(m.best.name * 100)}% name + ${m.best.proof.reasons.join(", ")}` };
      }
      if (m.decision === "suggest" && m.best) {
        return { ok: false, candidates: [{ acc: m.best.item, score: m.best.name, reasons: [m.reason], method: "name" }], reason: `Low match ${Math.round(m.best.name * 100)}% — confirm this account` };
      }
      if (m.decision === "pick" && m.candidates.length) {
        return { ok: false, candidates: m.candidates.map((c) => ({ acc: c.item, score: c.name, reasons: [m.reason], method: "name" as const })), reason: m.reason };
      }
    }
    return { ok: false, candidates: [], reason: `no own Bank/Cash account matches${bank ? ` "${bank}"` : " the sender/receiver"}` };
  }
  const top = scored.filter((x) => x.score >= scored[0].score - TIE_GAP);
  const reason = `${scored[0].reasons.join(", ")}`;
  if (top.length === 1) {
    return { ok: true, acc: top[0].acc, score: top[0].score, method: top[0].method, reason };
  }
  return { ok: false, candidates: top, reason: `${top.length} own accounts still match (${reason})` };
}

/** @deprecated use pickUniqueOwnAccount — kept as a thin wrapper for older call sites. */
export function matchOwnAccount(side: ReceiptAccountSide, own: readonly OwnAccountLike[]): { acc: OwnAccountLike; score: number } | null {
  const p = pickUniqueOwnAccount(side, own);
  return p.ok ? { acc: p.acc, score: p.score } : null;
}

const corp = (s?: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|p\.?\s*ltd|co|company|inc)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Fuzzy company-name equality ignoring Pvt/Private/Ltd/Limited, case and punctuation. */
export function companyNameMatches(a?: string, b?: string): boolean {
  const x = corp(a), y = corp(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, "") === y.replace(/ /g, "")) return true;
  if (Math.abs(x.length - y.length) > 1 || x.length < 6) return false;
  let i = 0, j = 0, e = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i++; j++; }
    else {
      e++;
      if (x.length > y.length) i++;
      else if (y.length > x.length) j++;
      else { i++; j++; }
    }
    if (e > 1) return false;
  }
  return e + (x.length - i) + (y.length - j) <= 1;
}
