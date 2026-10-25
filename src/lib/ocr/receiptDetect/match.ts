import type { OwnAccountLike, ReceiptAccountSide } from "./types";

const digits = (s?: string) => String(s ?? "").replace(/[^0-9*xX]/g, "").replace(/[xX]/g, "*");
const words = (s?: string) => String(s ?? "").toLowerCase().replace(/^\s*\d+\s*-\s*/, "").replace(/\b(limited|ltd|pvt|private|bank|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Masked account match: "054**********013" vs "05400000123456013".
 * Visible prefix and suffix must match; full length checked when the mask keeps it.
 * Unmasked masked-side = exact match. Needs >=3 visible trailing digits.
 */
export function maskedAccountMatches(masked?: string, full?: string): boolean {
  const m = digits(masked), f = digits(full).replace(/\*/g, "");
  if (!m || !f) return false;
  if (!m.includes("*")) return m === f;
  const pre = m.match(/^\d*/)![0], suf = m.match(/\d*$/)![0].slice(-3); // last 3 digits decide
  if (suf.length < 3) return false;
  if (!f.startsWith(pre) || !f.endsWith(suf)) return false;
  if (f.length !== m.length && Math.abs(f.length - m.length) > 2) return false; // tolerate OCR dropping/adding a star or two
  return true;
}

export function bankNameMatches(a?: string, b?: string): boolean {
  const x = words(a), y = words(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Returns the matched own account + score (account no. strongest, bank name / account name secondary). */
export function matchOwnAccount(side: ReceiptAccountSide, own: readonly OwnAccountLike[]): { acc: OwnAccountLike; score: number } | null {
  let best: { acc: OwnAccountLike; score: number } | null = null;
  for (const acc of own) {
    let s = 0;
    const accNo = maskedAccountMatches(side.accountMasked, acc.accountNumber);
    if (accNo) s += 0.7;
    if (bankNameMatches(side.bankName, acc.bankName) || bankNameMatches(side.bankName, acc.accountName)) s += 0.2;
    if (side.accountName && words(side.accountName) && words(side.accountName) === words(acc.accountName)) s += 0.1;
    if (!accNo) s = Math.min(s, 0.3); // never count as own without account-number match
    if (s >= 0.7 && (!best || s > best.score)) best = { acc, score: s };
  }
  return best;
}

const corp = (s?: string) => String(s ?? "").toLowerCase().replace(/\b(pvt|private|ltd|limited|p\.?\s*ltd|co|company|inc)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
/** Fuzzy company-name equality ignoring Pvt/Private/Ltd/Limited, case and punctuation. */
export function companyNameMatches(a?: string, b?: string): boolean {
  const x = corp(a), y = corp(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, "") === y.replace(/ /g, "")) return true;
  // tolerate one OCR char slip on longer names
  if (Math.abs(x.length - y.length) > 1 || x.length < 6) return false;
  let i = 0, j = 0, e = 0;
  while (i < x.length && j < y.length) { if (x[i] === y[j]) { i++; j++; } else { e++; if (x.length > y.length) i++; else if (y.length > x.length) j++; else { i++; j++; } } if (e > 1) return false; }
  return e + (x.length - i) + (y.length - j) <= 1;
}
