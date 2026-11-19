/**
 * Parse English / Hindi / Nepali amount-in-words lines, and tell when two
 * amounts differ only by common handwritten / Devanagari digit confusions
 * (४↔८, १↔९, ३↔८, ३↔९, …). Used to cross-check Gemini totals without
 * changing the existing English word parser behaviour for unambiguous lines.
 */
const WORD_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const WORD_SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000,
  million: 1000000, crore: 10000000, crores: 10000000, billion: 1000000000,
};

/** Nepali + Hindi cardinals (1–20, tens) and common compounds. */
const NE_UNITS: Record<string, number> = {
  "शून्य": 0, "सुन्ना": 0, "सिफर": 0,
  "एक": 1, "एकै": 1,
  "दुई": 2, "दुइ": 2, "दो": 2, "दोन": 2,
  "तीन": 3,
  "चार": 4,
  "पाँच": 5, "पांच": 5, "पाच": 5,
  "छ": 6, "छह": 6, "छः": 6,
  "सात": 7,
  "आठ": 8,
  "नौ": 9, "नव": 9,
  "दश": 10, "दस": 10,
  "एघार": 11, "ग्यारह": 11,
  "बाह्र": 12, "बारह": 12,
  "तेह्र": 13, "तेरह": 13,
  "चौध": 14, "चौदह": 14, "चउद": 14,
  "पन्ध्र": 15, "पंद्रह": 15,
  "सोह्र": 16, "सोलह": 16,
  "सत्र": 17, "सत्रह": 17,
  "अठार": 18, "अठाह्र": 18,
  "उन्नाइस": 19, "उन्नीस": 19, "उन्नाईस": 19,
  "बीस": 20, "बिस": 20,
  "एक्काइस": 21, "इक्कीस": 21,
  "बाइस": 22, "बाईस": 22,
  "तेइस": 23, "तेईस": 23,
  "चौबीस": 24,
  "पच्चीस": 25, "पचीस": 25, "पच्चिस": 25,
  "छब्बीस": 26, "छबीस": 26,
  "सत्ताइस": 27, "सत्ताईस": 27,
  "अट्ठाइस": 28, "अठ्ठाइस": 28, "अट्ठाईस": 28,
  "उनन्तीस": 29, "उनतीस": 29,
  "तीस": 30, "तिस": 30,
  "चालीस": 40, "चालिस": 40,
  "पचास": 50,
  "साठी": 60, "साठ": 60,
  "सत्तरी": 70, "सत्तर": 70,
  "अस्सी": 80, "असी": 80,
  "नब्बे": 90, "नव्वे": 90,
};

const NE_SCALES: Record<string, number> = {
  "सय": 100, "सौ": 100, "सैकडा": 100,
  "हजार": 1000, "सहस्र": 1000,
  "लाख": 100000, "लक्ष": 100000,
  "करोड": 10000000, "करोड़": 10000000,
  "अरब": 1000000000,
};

const NE_SKIP = new Set([
  "मात्र", "मात्रै", "केवल", "भर", "रकम", "जम्मा", "बराबर",
  "अक्षरेपी", "अक्षरमा", "अक्षरले", "अक्षरी", "अक्षरेपि",
  "रुपैयाँ", "रुपैया", "रुपया", "रुपये", "रुपयामात्र",
  "रु", "रू", "rs", "npr", "nrs", "only", "and", "rupees", "rupee",
  "in", "words", "amount", "total", "grand", "the", "of", "sum", "net",
  "नेपाली", "indian",
]);

/** Pairs that are commonly mixed up in handwriting or Devanagari OCR. */
const CONFUSABLE_DIGITS = new Set([
  "14", "19", "17",
  "38", "39",
  "48",
  "03", "08", "06",
  "56", "69",
  "89",
  "79",
]);

function devanagariDigitsToLatin(s: string): string {
  return String(s ?? "").replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

function parseEnglishWords(s: string): number | null {
  const words = s.replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0, cur = 0, seen = false;
  for (const w of words) {
    if (w in WORD_UNITS) { cur += WORD_UNITS[w]; seen = true; }
    else if (w === "hundred") { cur = (cur || 1) * 100; seen = true; }
    else if (w in WORD_SCALES) { total += (cur || 1) * WORD_SCALES[w]; cur = 0; seen = true; }
    else if (/^(rupees?|rs|npr|nrs|only|and|nepali|indian|in|words?|amount|total|grand|the|of|sum|net)$/.test(w)) continue;
    else return null;
  }
  return seen ? total + cur : null;
}

function parseIndicWords(raw: string): number | null {
  const t = raw.normalize("NFC").replace(/[\u0964\u0965.,/|:-]+/g, " ");
  const words = t.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  let total = 0, cur = 0, seen = false;
  for (const rawW of words) {
    const w = rawW.replace(/^[^\u0900-\u097F]+|[^\u0900-\u097Fa-zA-Z]+$/g, "");
    if (!w) continue;
    const lower = w.toLowerCase();
    if (NE_SKIP.has(w) || NE_SKIP.has(lower)) continue;
    if (w === "र" || w === "एवं" || w === "तथा") continue;
    if (w in NE_UNITS) { cur += NE_UNITS[w]; seen = true; continue; }
    if (w in NE_SCALES) {
      const scale = NE_SCALES[w];
      if (scale === 100) cur = (cur || 1) * 100;
      else { total += (cur || 1) * scale; cur = 0; }
      seen = true;
      continue;
    }
    if (lower in WORD_UNITS) { cur += WORD_UNITS[lower]; seen = true; continue; }
    if (lower === "hundred") { cur = (cur || 1) * 100; seen = true; continue; }
    if (lower in WORD_SCALES) { total += (cur || 1) * WORD_SCALES[lower]; cur = 0; seen = true; continue; }
    // Unknown leftover Latin/Devanagari token: fail only if it looks like a word, not a stray mark.
    if (/[\u0900-\u097Fa-zA-Z]/.test(w)) return null;
  }
  return seen ? total + cur : null;
}

/**
 * "Rupees Ten Thousand Two Hundred Fifty and Paisa Fifty Only" -> 10250.5.
 * Also "Rs. 10,250/- only", "चौध हजार दुई सय मात्र", "अक्षरेपी रु. चौध हजार दुई सय मात्र".
 * Returns null when the words cannot be read as one number.
 */
export function parseAmountInWords(raw: string | null | undefined): number | null {
  const original = String(raw ?? "");
  const t0 = devanagariDigitsToLatin(original).toLowerCase();
  if (!t0.trim() && !original.trim()) return null;
  const hasIndicScale = /(?:हजार|सय|सौ|लाख|लक्ष|करोड|करोड़)/.test(original);
  const digits = t0.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (digits && digits.length === 1 && !/[a-z]{3,}\s+(?:hundred|thousand|lakh|crore)/.test(t0) && !hasIndicScale) {
    return Number(digits[0]);
  }
  const parseEnglish = (s: string): number | null => parseEnglishWords(s);
  const paisaMarker = /\b(?:paisa|paise)\b/.exec(t0);
  if (paisaMarker?.index != null) {
    const andIndex = t0.lastIndexOf(" and ", paisaMarker.index);
    if (andIndex >= 0) {
      const rupees = parseEnglish(t0.slice(0, andIndex));
      const paisa = parseEnglish(t0.slice(andIndex + 5, paisaMarker.index));
      if (rupees != null && paisa != null) return rupees + paisa / 100;
    }
  }
  const [rupeePart, paisaPart] = t0.split(/\b(?:and\s+)?(?:paisa|paise|paisa\.)\b/);
  const r = parseEnglish(rupeePart ?? "");
  if (r != null) {
    const p = paisaPart != null ? parseEnglish(paisaPart) : 0;
    return r + (p ? p / 100 : 0);
  }
  return parseIndicWords(original);
}

function amountDigitString(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function digitsAreConfusable(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length !== 1 || b.length !== 1) return false;
  const key = a < b ? a + b : b + a;
  return CONFUSABLE_DIGITS.has(key);
}

/**
 * True when `a` and `b` have the same number of digits and every differing
 * digit is a known handwritten / Devanagari confusion (at least one difference).
 */
export function digitConfusionExplains(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
  const sa = amountDigitString(a);
  const sb = amountDigitString(b);
  if (!sa || !sb || sa.length !== sb.length) return false;
  let diffs = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] === sb[i]) continue;
    if (sa[i] === "." || sb[i] === "." || !digitsAreConfusable(sa[i], sb[i])) return false;
    diffs++;
  }
  return diffs >= 1;
}

/** 4-digit years that differ from `year` by one confusable digit. */
export function confusedYearAlternatives(year: number): number[] {
  const s = String(Math.trunc(year));
  if (!/^\d{4}$/.test(s)) return [];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (const d of "0123456789") {
      if (d === s[i] || !digitsAreConfusable(s[i], d)) continue;
      const n = Number(s.slice(0, i) + d + s.slice(i + 1));
      if (!out.includes(n)) out.push(n);
    }
  }
  return out.sort((x, y) => x - y);
}
