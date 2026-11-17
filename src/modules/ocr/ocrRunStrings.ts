"use client";
/**
 * Voucher OCR fill messages added for the AI voucher types / amount checks / due date / journal lines.
 * Same language system as aiChatStrings (src/lib/i18n/plLangStorage UI language); English is the fallback.
 * Plain function (not a hook): read at fill time inside the OCR run, so the current UI language is used.
 */
import { readPlLangs, type PlLangs } from "@/lib/i18n/plLangStorage";

export type OcrRunStrings = {
  /** Missing-field label when Dr/Cr, Grand Total / item sum / amount in words disagree. */
  amountMismatch: string;
  /** Filled-field label: due date + where it came from. */
  dueDate: string;
  dueSource: { printed: string; bill_credit_days: string; party_credit_days: string; default_days: string };
  /** Filled-field label: journal Dr/Cr lines. */
  journalLines: string;
  /** Missing-field label for a journal line whose ledger is not in the masters: {n} = line no, {name} = printed name. */
  journalLineAccount: string;
  /** Missing-field label when the AI gave no Dr/Cr lines for a journal. */
  journalNoLines: string;
};

const EN: OcrRunStrings = {
  amountMismatch: "Amount mismatch (Dr / Cr, total or amount in words)",
  dueDate: "Due date",
  dueSource: { printed: "printed on the bill", bill_credit_days: "{days} credit days on the bill", party_credit_days: "{days} credit days of the party", default_days: "{days} days (Common Setting)" },
  journalLines: "Journal Dr / Cr lines",
  journalLineAccount: "Journal line {n} account: {name}",
  journalNoLines: "Journal Dr / Cr lines",
};

const HI: OcrRunStrings = {
  amountMismatch: "रकम मेल नहीं खाती (Dr / Cr, कुल या शब्दों में रकम)",
  dueDate: "देय तिथि",
  dueSource: { printed: "बिल पर छपी", bill_credit_days: "बिल पर {days} दिन उधार", party_credit_days: "पार्टी के {days} दिन उधार", default_days: "{days} दिन (कॉमन सेटिंग)" },
  journalLines: "जर्नल Dr / Cr लाइनें",
  journalLineAccount: "जर्नल लाइन {n} का खाता: {name}",
  journalNoLines: "जर्नल Dr / Cr लाइनें",
};

const NE: OcrRunStrings = {
  amountMismatch: "रकम मिलेन (Dr / Cr, जम्मा वा अक्षरमा रकम)",
  dueDate: "भुक्तानी मिति",
  dueSource: { printed: "बिलमा छापिएको", bill_credit_days: "बिलमा {days} दिन उधारो", party_credit_days: "पार्टीको {days} दिन उधारो", default_days: "{days} दिन (कमन सेटिङ)" },
  journalLines: "जर्नल Dr / Cr लाइनहरू",
  journalLineAccount: "जर्नल लाइन {n} को खाता: {name}",
  journalNoLines: "जर्नल Dr / Cr लाइनहरू",
};

const TABLES: Record<string, OcrRunStrings> = { en: EN, hi: HI, ne: NE };

export function ocrRunStrings(langs?: PlLangs): OcrRunStrings {
  let l: PlLangs | undefined = langs;
  if (!l) { try { l = readPlLangs(); } catch { l = undefined; } }
  return (l && TABLES[l.ui]) || EN;
}

/** "{n}" / "{name}" / "{days}" placeholders. */
export function fmtOcr(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
