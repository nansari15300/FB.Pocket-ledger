/**
 * Google Cloud Vision (and its drag-and-drop demo) can return Devanagari bills with a space between EVERY
 * akshara / digit / Latin letter: "क र वि ज क", "ज म्मा", "4 4 2 4 7 7 9", "S h r e s t h a O i l".
 * This module re-joins such text so the bill parser sees words and numbers again. Normal text (tesseract,
 * or Vision text that already has word spaces) is left alone - see `isSpacedOcrText`.
 *
 * Limits (the spacing carries no word-boundary information):
 * - a run of spaced Devanagari aksharas becomes ONE word ("टैं की ब ना ए को" -> "टैंकीबनाएको");
 * - spaced Latin letters are split at lower->Upper changes only ("S h r e s t h a O i l" -> "Shrestha Oil").
 */

const DEV_DIGITS = "०१२३४५६७८९";
const DEVA_RE = /^[\u0900-\u097F\u200c\u200d]+$/;
const DEVA_DIGIT_RE = /^[०-९]$/;
const DIGIT_RE = /^[0-9]$/;
const LATIN_RE = /^[A-Za-z]$/;
/** Devanagari letters/marks only (no digits, no danda). */
const DEVA_LETTERS_RE = /^[\u0900-\u0963\u0970-\u097F\u200c\u200d]+$/;

export function devanagariDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
}

/** One akshara-sized Devanagari token: a consonant cluster (with halant joins) + matras, at most 6 code points. */
function isAksharaToken(t: string): boolean {
  return DEVA_LETTERS_RE.test(t) && [...t].length <= 6;
}

type Kind = "deva" | "digit" | "latin" | "punct" | "word";
function kindOf(t: string): Kind {
  if (DIGIT_RE.test(t) || DEVA_DIGIT_RE.test(t)) return "digit";
  if (LATIN_RE.test(t)) return "latin";
  if (isAksharaToken(t)) return "deva";
  if (/^[.,:;/\-()]$/.test(t)) return "punct";
  return "word";
}

/**
 * True when most tokens are single aksharas / single characters (the "every character spaced" Vision layout).
 * Checked on the whole text, so a normal word-spaced bill never gets re-joined.
 */
export function isSpacedOcrText(text: string): boolean {
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length < 12) return false;
  let single = 0;
  let deva = 0;
  let devaSingle = 0;
  for (const t of toks) {
    const k = kindOf(t);
    if (k === "digit" || k === "latin" || k === "punct") single++;
    if (DEVA_RE.test(t) && !/[०-९]/.test(t)) {
      deva++;
      // a spaced akshara is short: 1 consonant (+ cluster) + matras; real words are mostly longer
      if ([...t].length <= 3) devaSingle++;
    }
  }
  const singleRatio = (single + devaSingle) / toks.length;
  return singleRatio >= 0.6 && (deva === 0 || devaSingle / deva >= 0.6);
}

/** Split a joined Latin run at lower->Upper changes: "ShresthaOilSuppfires" -> "Shrestha Oil Suppfires". */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Re-join ONE spaced line. Devanagari digits become ASCII digits inside numbers. */
export function joinSpacedLine(line: string): string {
  const toks = line.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const k = kindOf(toks[i]);
    if (k === "deva" || k === "digit" || k === "latin") {
      // run of same-class single tokens (digits + latin letters form one alnum run: "NA6RHA")
      const cls = k === "deva" ? "deva" : "alnum";
      let j = i;
      let buf = "";
      while (j < toks.length) {
        const kj = kindOf(toks[j]);
        const cj = kj === "deva" ? "deva" : kj === "digit" || kj === "latin" ? "alnum" : null;
        if (cj !== cls) break;
        buf += toks[j];
        j++;
      }
      buf = devanagariDigits(buf);
      out.push(cls === "alnum" && /[A-Za-z]/.test(buf) ? splitCamel(buf) : buf);
      i = j;
      continue;
    }
    out.push(k === "word" ? toks[i] : toks[i]);
    i++;
  }
  // glue punctuation: "20 / 05 / 2083" -> "20/05/2083", "Sanisre - 10" -> "Sanisre-10", "नं ." -> "नं.", "x ," -> "x,"
  let s = out.join(" ");
  s = s.replace(/\s+([.,])/g, "$1");
  s = s.replace(/(\S)\s*([/\-])\s*(?=\S)/g, "$1$2");
  s = s.replace(/\s+:\s*/g, ": ");
  return s.replace(/\s+/g, " ").trim();
}

/** Re-join a whole OCR text when it is in the spaced layout; otherwise return it unchanged. */
export function joinSpacedOcrText(text: string): { text: string; joined: boolean } {
  if (!isSpacedOcrText(text)) return { text, joined: false };
  const lines = text.split(/\r?\n/).map((l) => (l.trim() ? joinSpacedLine(l) : ""));
  return { text: lines.join("\n"), joined: true };
}
