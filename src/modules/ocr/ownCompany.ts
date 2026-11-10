/**
 * Own-company recognition on a bill (ACR). Pure, no UI / DB.
 * - PAN/VAT: the company profile's 9-digit PAN anywhere in a segment (spaces / dashes between digits tolerated).
 * - Name: tolerant prefix match. Case-insensitive, punctuation-free, Pvt/Private/Ltd/Limited/Co/Company dropped,
 *   trailing profile words like "Demo Company..." ignored. The first meaningful tokens must appear in order
 *   (all tokens for names of <= 3 tokens, else max(3, 70% of tokens)); one OCR slip per long token allowed.
 *   A partial (prefix) match must contain at least one distinctive (non-generic) token, so
 *   "New Engineering Workshop" never matches "New Parsa Engineering Workshop".
 */

/** Legal-form words: never part of the comparison (Pvt = Private, Ltd = Limited). */
const LEGAL = new Set(["pvt", "private", "p", "ltd", "limited", "co", "company", "inc", "ms", "m", "s", "llc", "plc", "corp", "corporation"]);
/** Profile-only trailing words: everything from here on is ignored ("... Demo Company"). */
const TRAILING_CUT = /^(demo|test|testing|sample|trial|dummy|copy|backup)$/;
/** Common business words: a PARTIAL name match made only of these is not trusted. */
const GENERIC = new Set([
  "new", "shree", "shri", "sri", "the", "and", "of", "nepal", "nepali", "engineering", "engineers", "workshop", "works", "work",
  "trade", "trading", "traders", "trader", "center", "centre", "store", "stores", "suppliers", "supplier", "supply", "suppliers",
  "enterprises", "enterprise", "industries", "industry", "udhyog", "udyog", "hardware", "general", "group", "international",
  "service", "services", "solutions", "home", "house", "mart", "shop", "concern", "brothers", "sons", "associates",
]);

export function ownTokens(s: string): string[] {
  return String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\bp\s*\.\s*ltd\b/g, " pvt ltd ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** Meaningful tokens of OUR company name (legal words dropped, "Demo Company…" tail cut). */
export function ownNameTokens(name: string): string[] {
  const out: string[] = [];
  for (const t of ownTokens(name)) {
    if (TRAILING_CUT.test(t)) break;
    if (LEGAL.has(t)) continue;
    out.push(t);
  }
  // truncated display tail like "Compn" / "Comp" / "Compa"
  while (out.length > 1 && /^comp[a-z]{0,4}$/.test(out[out.length - 1])) out.pop();
  return out;
}

function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

export type OwnNameRule = { tokens: string[]; need: number } | null;

/** Which tokens must be found. null = name unusable (too short / empty). */
export function ownNameRule(name?: string | null): OwnNameRule {
  const tokens = ownNameTokens(name ?? "");
  if (!tokens.length || tokens.join("").length < 4) return null;
  const n = tokens.length;
  const need = n <= 3 ? n : Math.max(3, Math.ceil(0.7 * n));
  const head = tokens.slice(0, need);
  // partial match needs a distinctive token; a full match of an all-generic name is allowed
  if (need < n && head.every((t) => GENERIC.has(t) || t.length < 4)) return { tokens, need: n };
  return { tokens, need };
}

/** True when the text contains our company name (tolerant prefix rule above). */
export function textHasOwnName(text: string, rule: OwnNameRule): boolean {
  if (!rule) return false;
  const head = rule.tokens.slice(0, rule.need);
  const tt = ownTokens(text).filter((t) => !LEGAL.has(t));
  for (let i = 0; i + head.length <= tt.length; i++) {
    if (head.every((h, k) => oneSlip(h, tt[i + k]))) return true;
  }
  // merged / split words by OCR ("NewParsa Engineering", "Engi neering"): squashed compare, long names only
  const sq = head.join("");
  return sq.length >= 12 && tt.join("").includes(sq);
}

/** Digits-only PAN check (9 digits) on a text. */
export function textHasOwnPan(text: string, ownPan?: string | null): boolean {
  const own = String(ownPan ?? "").replace(/\D/g, "");
  if (own.length !== 9) return false;
  return new RegExp(`(?<!\\d)${own}(?!\\d)`).test(String(text ?? "").replace(/(\d)[\s-](?=\d)/g, "$1"));
}
