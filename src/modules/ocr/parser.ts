/**
 * Rule-based bill parser (spec §4–§7). STRICT: a field is "fill" only when format validation
 * (and the cross-check where one applies) passes; otherwise "flag" (shown, not filled) or absent.
 *
 * Layout model: full lines (tables / totals) + gap-split SEGMENTS (key: value pairs). Two-column
 * headers ("Address : Inaruwa      Nepali Date : 2083/07/01") become separate segments, so a label's
 * value always stops at the next column.
 */
import { parseDocDates, defaultVoucherDateWindow, resolveBillDate } from "@/lib/ocr/dates";
import { joinSpacedOcrText } from "@/lib/ocr/devanagariJoin";
import { canonicalizeNepaliBill } from "@/lib/ocr/nepaliBill";
import { rebuildCellPerLineTable } from "./cellTable";
import { amountsInLine, fixDigitConfusions, normalizeName, normalizeOcrLine, parseStrictAmount } from "./normalize";
import { bestUniqueMatch, nameScore, namesOf, tokenCoverageScore } from "./fuzzy";
import { devanagariToRoman, nameSkeleton } from "./translit";
import { isOcrSelectableParty } from "./types";
import { ownNameRule, panConfusionDistance, textHasOwnName, textHasOwnPan, textHasOwnPanLoose } from "./ownCompany";
import { canonicalOcrQty, descriptionHasLeakedQtyUnit, normalizeItemDescription, parseOcrQtyToken } from "./extras";
import { aiCounterParty, applyAiToBill } from "./ai/aiVoucher";
import type { OcrIdentifiers } from "./identifiers";
import type {
  OcrItemLike,
  OcrLineItem,
  OcrParsedBill,
  OcrPartyLike,
  OcrRawResult,
  OcrVoucherKind,
  OcrWord,
} from "./types";

type L = { text: string; conf: number; rel: number; y: number; words: OcrWord[] };
type Seg = { text: string; conf: number; rel: number; y: number; x0: number; x1: number; h: number; line: number };

const RX = {
  dateLabel: /\b(invoice\s*date|bill\s*date|nepali\s*date|invoice\s*m[il1]t[il1]|m[il1]t[il1]|dated|dat[e3])\b|मिति|दिनांक|तारीख/i,
  dueLabel: /\b(due\s*date)\b|भुक्तानी\s*मिति|अन्तिम\s*मिति/i,
  printLabel: /\bprint(ed)?\s*(time|date)|\btime\b/i,
  panLabel: /\b(pan|vat)\s*(reg\.?)?\s*(no\.?|number)?\b|स्थायी\s*लेखा|स्था\.?\s*ले\.?\s*नं|प्यान|भ्याट/i,
  buyerLabel: /\b(buyer|customer|bill\s*to|purchaser|party\s*name|m\/s|sold\s*to)\b|क्रेता|ग्राहक/i,
  sellerLabel: /\b(seller|supplier|vendor)\b|विक्रेता/i,
  billLabel: /\b(bill|[il1|]nvo[il1]ce|[il1|]nv|receipt|ref)\.?\s*(n[o0](?![a-z])|number|#|mo(?![a-z]))\.?|बिल\s*(नं|नम्बर)|रसिद\s*नं|बीजक\s*सं/i,
  phoneLabel: /\b(phone|ph|tel|mobile|mob|contact)\b|फोन|मोबाइल/i,
  addressLabel: /\b(address|addr)\b|ठेगाना/i,
  payMode: /\b(mode\s*of\s*payment|payment\s*mode|paid\s*by|payment\s*method)\b/i,
  grand: /\b(gr[a@]nd\s*(t[o0]t[a@][l1i]|amount)|g\.\s*total|net\s*(amount|total|payable)|total\s*amount|bill\s*amount|invoice\s*total)\b|कुल\s*जम्मा|कुल\s*रकम|कुल\s*योग/i,
  plainTotal: /\b(sub\s*-?\s*)?total\b(?!\s*(packages?|qty|quantity|amount|items?|in\s*words))/gi,
  taxable: /\b(taxable\s*(amount|value|total)?|sub\s*-?\s*total|amount\s*before\s*tax)\b|करयोग्य\s*रकम/i,
  vat: /(\b\d{1,2}(\.\d+)?\s*%\s*)?\bvat\b(?!\s*(no|reg|number))|मू\.?\s*अ\.?\s*क\.?|मूल्य\s*अभिवृद्धि\s*कर/i,
  discount: /\bdiscount\b|छुट|छूट/i,
  tds: /\btds\b|अग्रिम\s*कर\s*कट्टी|स्रोतमा\s*कर\s*कट्टी/i,
  roundOff: /\bround\s*-?\s*off\b/i,
  rowStop: /\b(total|sub\s*-?\s*total|discount|taxable|vat|grand|amount\s*in\s*words)\b|जम्मा/i,
  head: {
    sn: /^(s\.?\s*n\.?|sn|sl\.?)$|क्र\.?\s*सं/i,
    desc: /\b(particulars|description|item|details|goods)\b|विवरण/i,
    qty: /^\W*(q\.?\s*t?\.?\s*y|qnty|quantity)\W*$|परिमाण|मात्रा/i,
    unit: /^\W*(unit|uom)\W*$|इकाई/i,
    rate: /^\W*(rate|price)\W*$|दर/i,
    amount: /^\W*(amount|amt|total)\W*$|रकम|राशि/i,
  },
};

const UNIT_MAP: [RegExp, string][] = [
  [/^l\.?t?r?\.?s?$|^lit(re|er)?s?$|^lr$/i, "Ltr"],
  [/^pcs?\.?$|^nos?\.?$|^piece?s?$/i, "Pcs"],
  [/^kgs?\.?$/i, "Kg"],
  [/^(g|gm|gms)\.?$/i, "Gm"],
  [/^mtrs?\.?$|^m$/i, "Mtr"],
  [/^(box|bag|set|pkt|doz|dozen|ft)\.?$/i, ""],
  [/^(पिस|केजी|लिटर|थान|बोरा)$/, ""],
];
/** Business-name words that mark the seller's name line in a bill header. */
const COMPANY_WORD =
  /\b(pvt|private|ltd|limited|trade|traders?|trading|cent(er|re)|suppliers?|enterprises?|udh?yog|industries|stores?|hardware|company|co\.|concern|mart|suppliers|steel|engineering|works?(hop)?)\b|प्रा\.?\s*लि|ट्रेडर्स|उद्योग|सप्लायर्स/i;

const UNIT_CANON = ["ltr", "lr", "pcs", "pc", "nos", "kg", "kgs", "gm", "mtr", "box", "bag", "set", "pkt", "doz"];
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function normUnit(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.replace(/[|\]\[}{]/g, "").trim();
  for (const [re, v] of UNIT_MAP) if (re.test(t)) return v || t;
  // one OCR slip (Wr / Lt / Pc5): accept only a UNIQUE known unit at edit distance 1
  if (t.length >= 2) {
    const near = UNIT_CANON.filter((u) => Math.abs(u.length - t.length) <= 1 && lev(u, t.toLowerCase()) === 1);
    if (near.length >= 1) {
      const mapped = new Set(near.map((u) => normUnit(u)));
      if (mapped.size === 1) return [...mapped][0];
    }
  }
  return undefined;
}

function f<T>(value: T, status: "fill" | "flag", confidence: number, note?: string) {
  return { value, status, confidence, note };
}

/* -------------------------------- LAYOUT -------------------------------- */
function buildSegments(lines: L[], pageW: number): Seg[] {
  const segs: Seg[] = [];
  lines.forEach((l, li) => {
    const ws = [...l.words].sort((a, b) => a.x0 - b.x0);
    if (!ws.length) {
      segs.push({ text: l.text, conf: l.conf, rel: l.rel, y: l.y, x0: 0, x1: pageW, h: 0, line: li });
      return;
    }
    const charW = ws.reduce((a, w) => a + (w.x1 - w.x0), 0) / Math.max(1, ws.reduce((a, w) => a + w.text.length, 0));
    const gap = Math.max(pageW * 0.045, charW * 4);
    let cur: OcrWord[] = [ws[0]];
    const flush = () => {
      const text = normalizeOcrLine(cur.map((w) => w.text).join(" ").replace(/[|]/g, " "));
      if (text.trim())
        segs.push({
          text,
          conf: cur.reduce((a, w) => a + w.conf, 0) / cur.length / 100,
          rel: l.rel,
          y: l.y,
          x0: cur[0].x0,
          x1: cur[cur.length - 1].x1,
          h: Math.max(...cur.map((w) => w.y1 - w.y0)),
          line: li,
        });
    };
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].x0 - ws[i - 1].x1 > gap) {
        flush();
        cur = [];
      }
      cur.push(ws[i]);
    }
    flush();
  });
  return segs;
}

/** Value after a label inside a segment; if empty, the next segment to the right on the same line. */
function valueAfter(segs: Seg[], i: number, re: RegExp): string {
  const s = segs[i];
  const m = re.exec(s.text);
  let v = m ? s.text.slice(m.index + m[0].length) : "";
  v = v.replace(/^[\s:.;#-]+/, "").trim();
  if (!v) {
    const next = segs.filter((x) => x.line === s.line && x.x0 > s.x1).sort((a, b) => a.x0 - b.x0)[0];
    v = next ? next.text.replace(/^[\s:.;#-]+/, "").trim() : "";
  }
  return v;
}

/* ---------------------------------- DATE ---------------------------------- */
type DateCand = { date: Date | null; ambiguous: boolean };

function dateCandidates(text: string): DateCand[] {
  return parseDocDates(text, defaultVoucherDateWindow()).map((x) => {
    const okDate = x.date && !Number.isNaN(x.date.getTime()) ? x.date : null;
    return { date: okDate, ambiguous: x.ambiguous };
  });
}

/* --------------------------------- AMOUNTS -------------------------------- */
/** First amount AFTER the label (same line), bottom-most labeled line wins. */
function amountAfterLabel(lines: L[], re: RegExp, exclude?: RegExp): { value: number; conf: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].text;
    if (exclude && exclude.test(t)) continue;
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const ms = [...t.matchAll(g)];
    if (!ms.length) continue;
    const last = ms[ms.length - 1];
    const tail = t
      .slice((last.index ?? 0) + last[0].length)
      .replace(/\b\d+(\.\d+)?\s*%/g, " ")
      // photo OCR: decimal point read as a space / missing on totals lines ("62,360 32", "479.694 80" -> x.32 / x.80)
      .replace(/(?<![\d.,])(\d{1,3}(?:[,.]\d{3})+|\d{4,})\s(\d{2})(?![\d.,])/g, (_m, a: string, b: string) => `${a.replace(/[.,]/g, "")}.${b}`);
    const nums = amountsInLine(tail);
    if (nums.length) return { value: nums[0], conf: lines[i].conf };
  }
  return null;
}

/* -------------------------------- LINE ITEMS ------------------------------ */
type Col = "sn" | "desc" | "qty" | "unit" | "rate" | "amount";
const NUM_ONLY = /^[\d,]+(\.\d+)?$/;

const QTY_UNIT_LEAK = /\d[\d,]*(?:\.\d+)?\s+(?:pcs?|nos?|pieces?|ltr|ltrs|litres?|liters?|kgs?|gms?|grams?|mtrs?|meters?|metres?|box(?:es)?|bags?|sets?|pkts?|packets?|doz(?:en)?|ft)\.?\b/i;

function finalizeItemDescription(...cands: (string | undefined | null)[]): string {
  // "Item" is the placeholder of an already-finalized empty candidate (tripletRow): never prefer it over real text
  const cleaned = cands.map((c) => (c ? normalizeItemDescription(c) : "")).filter((c) => c && c !== "Item");
  const withSize = cleaned.find((c) => /\d+(?:\.\d+)?MM\b/i.test(c));
  return withSize || cleaned[0] || "Item";
}

function preferTripletDescription(headerDesc: string, tripletDesc: string): string {
  if (descriptionHasLeakedQtyUnit(headerDesc) && !descriptionHasLeakedQtyUnit(tripletDesc)) return finalizeItemDescription(tripletDesc, headerDesc);
  return finalizeItemDescription(headerDesc, tripletDesc);
}


/** Any 3 numbers on a line with qty x rate ~= amount (rounded-qty tolerance), description = text before them. */
function tripletRow(words: string[]): OcrLineItem | null {
  const toks = words.map((t) => t.replace(/[|\]\[}{()]/g, "")).filter(Boolean);
  // OCR often drops the decimal point on low-res photos ("175.20000" -> "17520000"):
  // a dot-less token also yields v/10^k candidates; qty x rate = amount picks the right one.
  const nums: { i: number; v: number; shifted: boolean; k: number }[] = [];
  // typical decimals printed on this line (e.g. "11,504.16000" -> 5): a restored decimal is likely the same width
  const decs = toks.filter((t) => /^[\d,]+\.\d+$/.test(t)).map((t) => t.split(".")[1].length);
  const D = decs.length ? Math.max(...decs) : 2;
  toks.forEach((t, i) => {
    if (NUM_ONLY.test(t)) {
      const v = parseStrictAmount(t);
      if (v != null && v > 0) {
        nums.push({ i, v, shifted: false, k: 0 });
        const digits = t.replace(/,/g, "");
        if (!digits.includes(".") && digits.length >= 4)
          for (let k = 1; k <= 6 && k < digits.length; k++) nums.push({ i, v: Number(digits) / 10 ** k, shifted: true, k });
      }
      // "5,000" as qty-decimals (5.000 -> 5) when rate*qty = amount prefers it
      const comma3 = /^(\d{1,3}),(\d{3})$/.exec(t);
      if (comma3) {
        const dec = Number(comma3[1]);
        if (dec > 0 && (v == null || dec !== v)) nums.push({ i, v: dec, shifted: false, k: 0 });
        const asDec = Number(comma3[1] + "." + comma3[2]);
        if (asDec > 0 && asDec !== dec) nums.push({ i, v: asDec, shifted: false, k: 0 });
      }
    }
  });
  if (nums.length < 3) return null;
  let best: { q: (typeof nums)[0]; r: (typeof nums)[0]; a: (typeof nums)[0]; err: number /* rank score */ } | null = null;
  for (let x = 0; x < nums.length; x++)
    for (let y = x + 1; y < nums.length; y++)
      for (let z = y + 1; z < nums.length; z++) {
        const [q, r, a] = [nums[x], nums[y], nums[z]];
        if (q.i === r.i || r.i === a.i || q.i === a.i) continue;
        if (a.v < 1 || q.v > 1e6) continue;
        const err = Math.abs(q.v * r.v - a.v);
        // rank: later amount column, fewer recovered decimals, smaller error
        const shifts = +q.shifted + +r.shifted + +a.shifted;
        const width = [q, r, a].filter((n) => n.shifted).reduce((acc, n) => acc + Math.min(Math.abs(n.k - D), Math.abs(n.k - 2)), 0);
        const score = a.i * 100 - shifts * 10 - width * 3 - err;
        if (err <= Math.max(0.6, 0.005 * a.v) && (!best || score > best.err)) best = { q, r, a, err: score };
      }
  if (!best) return null;
  const firstAlpha = toks.findIndex((t) => /[A-Za-z\u0900-\u097F]{2,}/.test(t));
  const descToks = firstAlpha >= 0 && firstAlpha < best.q.i ? toks.slice(firstAlpha, best.q.i) : [];
  const between = toks.slice(best.q.i + 1, best.r.i).find((t) => !NUM_ONLY.test(t));
  return { description: finalizeItemDescription(descToks.join(" ").trim()), quantity: canonicalOcrQty(best.q.v), unit: normUnit(between), rate: best.r.v, amount: best.a.v };
}

function scanTripletRows(lines: L[], from: number, dbg: (m: string) => void): OcrLineItem[] {
  const rows: OcrLineItem[] = [];
  for (let i = from; i < lines.length; i++) {
    if (i > from && RX.rowStop.test(lines[i].text) && rows.length) break;
    const r = tripletRow(lines[i].words.map((w) => w.text));
    if (r) {
      rows.push(r);
      dbg(`Row (qty x rate = amount scan) line ${i}: ${r.description} ${r.quantity} ${r.unit ?? ""} x ${r.rate} = ${r.amount}`);
    }
  }
  return rows;
}

/** Single item row: printed "Total Qty/Packages" confirms the quantity (fixes 656.6 x 17.52 vs 65.66 x 175.20). */
function confirmQtyFromTotals(lines: L[], rows: OcrLineItem[], dbg: (m: string) => void) {
  if (rows.length !== 1) return;
  const line = lines.find((l) => /total\s*(packages?|qty|quantity|pcs)/i.test(l.text));
  if (!line) return;
  const m = /(packages?|qty|quantity|pcs)\W*([\d,]+\.\d+|\d+)/i.exec(line.text);
  const tq = m ? Number(m[2].replace(/,/g, "")) : NaN;
  if (!(tq > 0)) return;
  const r = rows[0];
  // Printed Total Qty is AUTHORITATIVE (keeps 3 decimals, e.g. 65.663 not 65.66) when it fits amount / rate.
  for (const c of [tq, Math.floor(tq * 100) / 100, Math.round(tq * 100) / 100]) {
    if (Math.abs(c - r.quantity) < 0.0005) return; // already exact
    const rate = Math.abs(c * r.rate - r.amount) <= 0.05 ? r.rate : Math.round((r.amount / c) * 100) / 100;
    if (Math.abs(c * rate - r.amount) <= Math.max(0.6, 0.005 * r.amount)) {
      dbg(`Row "${r.description}": qty ${r.quantity} x ${r.rate} -> ${c} x ${rate} (confirmed by "${line.text.trim()}")`);
      rows[0] = { ...r, quantity: canonicalOcrQty(c), rate };
      return;
    }
  }
}

function parseLineItems(lines: L[], dbg: (m: string) => void): { rows: OcrLineItem[]; flagged: number } | null {
  const out = parseLineItemsInner(lines, dbg);
  if (out?.rows.length) {
    confirmQtyFromTotals(lines, out.rows, dbg);
    out.rows = out.rows.map((r) => ({ ...r, description: normalizeItemDescription(r.description) || r.description }));
  }
  return out;
}

const TOTALS_RX = /\b(sub\s*total|total|taxable|vat|tax|discount|grand|round|in\s*words|amount\s*in)\b/i;

function scanRateAmountRows(lines: L[], from: number, dbg: (m: string) => void): OcrLineItem[] {
  const tq = totalsQty(lines);
  const out: OcrLineItem[] = [];
  for (const l of lines.slice(from)) {
    const t = normalizeOcrLine(l.text);
    if (TOTALS_RX.test(t) || /\b(pan|vat\s*no|invoice|bill\s*no|date|mob|phone|tel)\b/i.test(t)) continue;
    const m = /^(.*?[A-Za-z][^\d]*?)[\s=:|-]*([\d,]+(?:\.\d+)?)\s*[|\s]\s*([\d,]+(?:\.\d+)?)\s*\|?\s*$/.exec(t);
    if (!m) continue;
    const desc = m[1].replace(/[\s=:|-]+$/, "").trim();
    if (desc.replace(/[^A-Za-z]/g, "").length < 3) continue;
    const rate = Number(m[2].replace(/,/g, ""));
    const amount = Math.round(Number(m[3].replace(/,/g, "")) * 100) / 100;
    if (!(rate > 0) || !(amount > 0) || rate > amount) continue;
    let q: number | null = null;
    let how = "";
    if (tq && Math.abs(tq * rate - amount) <= Math.max(0.05, 0.0005 * amount)) { q = tq; how = "Total Qty line"; }
    else {
      const c = Math.round((amount / rate) * 1000) / 1000;
      if (Math.abs(c * rate - amount) <= 0.05) { q = c; how = "amount / rate"; }
    }
    if (q == null) {
      dbg(`Row "${l.text}": rate ${rate} / amount ${amount} but qty could not be confirmed`);
      continue;
    }
    out.push({ description: finalizeItemDescription(desc), quantity: canonicalOcrQty(q), rate, amount });
    dbg(`Row "${l.text}": no qty column; ${q} x ${rate} = ${amount} (qty from ${how})`);
  }
  return out;
}

function parseLineItemsInner(lines: L[], dbg: (m: string) => void): { rows: OcrLineItem[]; flagged: number } | null {
  const res = parseLineItemsByHeader(lines, dbg);
  if (res && res.rows.length) return res;
  // Fallback: header missing/misread or every row rejected - scan for qty x rate = amount lines
  const startAt = res?.head ?? 0;
  const rows = scanTripletRows(lines, startAt, dbg);
  if (rows.length) return { rows, flagged: 0 };
  // Fallback 2: row printed with only RATE and AMOUNT (qty column lost, e.g. "Diesel <HSD> = 175.20000 | 11,504.16000").
  // Qty comes from the printed Total Qty/Packages (authoritative) or amount / rate when that is a clean 3-decimal number.
  const pair = scanRateAmountRows(lines, startAt, dbg);
  if (pair.length) return { rows: pair, flagged: 0 };
  dbg("Line items: no line with qty x rate = amount found");
  return res ? { rows: [], flagged: res.flagged } : null;
}

function totalsQty(lines: L[]): number | null {
  const line = lines.find((l) => /total\s*(packages?|qty|quantity|pcs)/i.test(l.text));
  const m = line ? /(packages?|qty|quantity|pcs)\W*([\d,]+\.\d+|\d+)/i.exec(line.text) : null;
  const v = m ? Number(m[2].replace(/,/g, "")) : NaN;
  return v > 0 ? v : null;
}

function recoverQtyRate(rateTok: string, amount: number, tq: number | null): { q: number; r: number; how: string } | null {
  const tol = Math.max(0.6, 0.005 * amount);
  const digits = rateTok.replace(/[^\d.]/g, "");
  const cands: { r: number; k: number }[] = [];
  if (digits) {
    if (digits.includes(".")) cands.push({ r: Number(digits), k: 0 });
    else for (let k = 0; k <= 6 && k < digits.length; k++) cands.push({ r: Number(digits) / 10 ** k, k });
  }
  if (!cands.length) return null; // no rate column read -> not an item row
  if (tq) {
    const r = Math.round((amount / tq) * 100) / 100;
    if (Math.abs(tq * r - amount) <= tol && cands.some((c) => Math.abs(c.r - r) < 0.01))
      return { q: tq, r, how: "Total Qty line" };
  }
  let best: { q: number; r: number; score: number } | null = null;
  for (const c of cands) {
    if (!(c.r > 0)) continue;
    const q = Math.round((amount / c.r) * 1000) / 1000;
    if (!(q > 0) || q > 1e5 || Math.abs(q * c.r - amount) > tol) continue;
    const clean = Math.abs(q - Math.round(q * 100) / 100) * c.r <= tol; // qty with <= 2-3 decimals
    if (!clean) continue;
    const score = -Math.abs(c.k - 5) - Math.abs(c.k - 2) * 0.1;
    if (!best || score > best.score) best = { q, r: c.r, score };
  }
  return best ? { q: best.q, r: best.r, how: "qty = amount / rate" } : null;
}

function parseLineItemsByHeader(lines: L[], dbg: (m: string) => void): { rows: OcrLineItem[]; flagged: number; head: number } | null {
  let head = -1;
  let cols: { col: Col; cx: number; x0: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const found: { col: Col; cx: number; x0: number }[] = [];
    const headWords = lines[i].words;
    for (let wi = 0; wi < headWords.length; wi++) {
      const w = headWords[wi];
      const t = w.text.replace(/[|\]\[}{]/g, "");
      const prev = wi > 0 ? headWords[wi - 1].text.replace(/[|\]\[}{]/g, "") : "";
      for (const c of Object.keys(RX.head) as Col[]) {
        if (c === "qty" && (/^alt$/i.test(prev) || /^alt\s*qty$/i.test(t))) continue;
        if (RX.head[c].test(t) && !found.some((x) => x.col === c)) found.push({ col: c, cx: (w.x0 + w.x1) / 2, x0: w.x0 });
      }
    }
    const score = found.filter((x) => x.col !== "sn").length;
    if (score >= 3 && found.some((x) => x.col === "amount")) {
      head = i;
      cols = found;
      break;
    }
  }
  if (head < 0) {
    dbg("Line items: no table header (need >=3 of Description / Qty / Unit / Rate|Price / Amount)");
    return null;
  }
  dbg(`Line items: header at line ${head}: ${cols.map((c) => c.col).join(", ")}`);
  const desc = cols.find((c) => c.col === "desc");
  const numCols = cols.filter((c) => c.col !== "desc" && c.col !== "sn");
  const rows: OcrLineItem[] = [];
  let flagged = 0;
  for (let i = head + 1; i < lines.length; i++) {
    const l = lines[i];
    if (RX.rowStop.test(l.text)) break;
    const words = l.words.map((w) => ({ ...w, text: w.text.replace(/[|\]\[}{]/g, "") })).filter((w) => w.text);
    if (!words.some((w) => /\d/.test(w.text))) continue;
    const cell: Partial<Record<Col, string[]>> = {};
    const descWords: string[] = [];
    const rightWords: string[] = [];
    for (const w of words) {
      const cx = (w.x0 + w.x1) / 2;
      const isNum = NUM_ONLY.test(w.text);
      // nearest numeric column (by centre); words left of the first numeric column belong to description
      const firstNumX = Math.min(...numCols.map((c) => c.cx)) - (desc ? Math.abs(Math.min(...numCols.map((c) => c.cx)) - desc.cx) / 2 : 0);
      if (cx < firstNumX) {
        descWords.push(w.text);
        continue;
      }
      rightWords.push(w.text);
      let best = numCols[0];
      for (const c of numCols) if (Math.abs(c.cx - cx) < Math.abs(best.cx - cx)) best = c;
      if (best.col === "unit" && isNum) {
        // numbers never go to Unit: pick nearest numeric column instead
        const alt = numCols.filter((c) => c.col !== "unit").sort((a, b) => Math.abs(a.cx - cx) - Math.abs(b.cx - cx))[0];
        if (alt) best = alt;
      }
      (cell[best.col] ??= []).push(w.text);
    }
    // description: drop S.N ("1."), HSN codes (6-8 digits) at the start
    // description: drop leading S.N / HSN tokens (pure digits, dots, OCR'd column bars like "1.|27101930")
    let k0 = 0;
    while (k0 < descWords.length && /^[\d.,)|lI]+$/.test(descWords[k0]) && /\d/.test(descWords[k0])) k0++;
    const description = descWords.slice(k0).join(" ").trim();
    let fbDesc: string | null = null;
    let rate = cell.rate?.length ? parseStrictAmount(cell.rate.join("")) : null;
    let amount = cell.amount?.length ? parseStrictAmount(cell.amount.join("")) : null;
    let qty = cell.qty?.length ? parseOcrQtyToken(cell.qty.join(""), { rate: rate ?? undefined, amount: amount ?? undefined }) : null;
    let unit = normUnit(cell.unit?.join(""));
    const okRow = (q: number | null, r: number | null, a: number | null) =>
      q != null && r != null && a != null && q > 0 && r > 0 && Math.abs(q * r - a) <= Math.max(0.6, 0.005 * a);
    if (!okRow(qty, rate, amount)) {
      // Fallback when a header word was missed/misread: column ORDER Qty [Unit] Rate Amount, validated by qty x rate = amount
      const nums: number[] = [];
      let unitTok: string | undefined;
      const firstAlpha = words.findIndex((w) => /[A-Za-z\u0900-\u097F]{2,}/.test(w.text));
      const after = firstAlpha >= 0 ? words.slice(firstAlpha).map((w) => w.text) : rightWords;
      const firstNum = after.findIndex((t) => NUM_ONLY.test(t));
      const descFb = firstNum > 0 ? after.slice(0, firstNum).join(" ") : "";
      for (const t of firstNum >= 0 ? after.slice(firstNum) : []) {
        if (NUM_ONLY.test(t)) {
          const v = parseStrictAmount(t);
          if (v != null) nums.push(v);
        } else if (nums.length === 1 && !unitTok) unitTok = t;
      }
      if (nums.length >= 3) {
        const [q, r, a] = nums.slice(-3);
        if (okRow(q, r, a)) {
          qty = q; rate = r; amount = a;
          if (descFb) fbDesc = descFb;
          unit = unit ?? normUnit(unitTok);
          dbg(`Row "${description}": columns taken by order (qty x rate = amount verified)`);
        }
      }
    }
    if (qty == null || rate == null || amount == null || !(qty > 0) || !(rate > 0)) {
      const t = tripletRow(words.map((w) => w.text));
      if (t) {
        rows.push({ ...t, description: preferTripletDescription(description, t.description), unit: unit ?? t.unit });
        dbg(`Row "${l.text}": columns incomplete; recovered ${t.quantity} x ${t.rate} = ${t.amount}`);
        continue;
      }
      // qty unreadable (e.g. "es66"): qty = amount / rate, rate decimal restored if needed, confirmed by Total Qty when printed
      // Skip rows with no item name (e.g. a stray "44.00  1,661.60" under the table).
      if (amount != null && amount >= 1 && description.replace(/[^A-Za-z\u0900-\u097F]/g, "").length >= 3) {
        const rec = recoverQtyRate(cell.rate?.join("") ?? "", amount, totalsQty(lines));
        if (rec) {
          rows.push({ description: finalizeItemDescription(description), quantity: canonicalOcrQty(rec.q), unit, rate: rec.r, amount });
          dbg(`Row "${l.text}": qty unreadable; recovered ${rec.q} x ${rec.r} = ${amount} (${rec.how})`);
          continue;
        }
      }
      const numericCells = [qty, rate, amount].filter((x) => x != null).length;
      if (numericCells < 2 || description.replace(/[^A-Za-z\u0900-\u097F]/g, "").length < 3) {
        dbg(`Row "${l.text}": ignored (not an item row - ${numericCells} number column(s), desc="${description}")`);
        continue;
      }
      dbg(`Row "${l.text}": missing qty/rate/amount (qty=${qty} rate=${rate} amount=${amount})`);
      flagged++;
      continue;
    }
    if (Math.abs(qty * rate - amount) > Math.max(0.6, 0.005 * amount)) {
      const t = tripletRow(words.map((w) => w.text));
      if (t) {
        rows.push({ ...t, description: preferTripletDescription(description, t.description), unit: unit ?? t.unit });
        dbg(`Row "${description}": ${qty} x ${rate} != ${amount}; recovered ${t.quantity} x ${t.rate} = ${t.amount} (decimal point restored)`);
        continue;
      }
      dbg(`Row "${description}": ${qty} x ${rate} != ${amount}`);
      flagged++;
      continue;
    }
    {
      const t = tripletRow(words.map((w) => w.text));
      rows.push({ description: finalizeItemDescription(t?.description, description, fbDesc), quantity: canonicalOcrQty(qty), unit: unit ?? t?.unit, rate, amount });
    }
  }
  return { rows, flagged, head: head + 1 };
}

/* ---------------------------------- MAIN ---------------------------------- */
export type ParseContext = {
  kind: OcrVoucherKind;
  parties: readonly OcrPartyLike[];
  items: readonly OcrItemLike[];
  ownPan?: string | null;
  ownName?: string | null;
};

/** OCR often splits "3,097.20" into "3,097" + "20". Merge those tokens on a line. */
function mergeSplitAmountWords(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    if (b && /^(?:\d{1,3}(?:,\d{3})+|\d{4,})$/.test(a.text) && /^\d{2}$/.test(b.text)) {
      out.push({ ...a, text: `${a.text}.${b.text}`, x1: b.x1, y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) });
      i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Google Vision text with every akshara/digit spaced ("ज म्मा", "4 4 2 4 7 7 9") is re-joined, and Nepali-labelled
 * bills (क्रेताको नाम, बिजक नं., कुल जम्मा ...) become canonical English-labelled lines. Other text is untouched.
 */
export function prepareOcrRawForParse(raw: OcrRawResult): { raw: OcrRawResult; notes: string[] } {
  const joined = joinSpacedOcrText(raw.text ?? "");
  const src = joined.joined ? joined.text.split(/\r?\n/).filter((t) => t.trim()) : raw.lines.map((l) => l.text);
  const canon = canonicalizeNepaliBill(src);
  const texts = canon.applied ? canon.lines : src;
  // Online OCR without word boxes (Azure/Vision text only): table cells arrive one per line -> rebuild rows + totals
  const noGeometry = !raw.lines.some((l) => (l.words?.length ?? 0) > 0);
  const cells = noGeometry ? rebuildCellPerLineTable(texts) : null;
  if (!joined.joined && !canon.applied && !cells) return { raw, notes: [] };
  const rows: { text: string; words?: OcrWord[] }[] = cells ? cells.lines : texts.map((t) => ({ text: t }));
  const n = rows.length;
  const conf = raw.meanConfidence || 90;
  const lines = rows.map((r, i) => {
    const y = 40 + i * 30;
    const words = r.words?.length
      ? r.words.map((w) => ({ ...w, y0: y, y1: y + 20, conf: w.conf || conf }))
      // synthetic word boxes by character offset (10px per char) so table columns line up
      : [...r.text.matchAll(/\S+/g)].map((m) => ({ text: m[0], x0: (m.index ?? 0) * 10, x1: ((m.index ?? 0) + m[0].length) * 10, y0: y, y1: y + 20, conf }));
    return { text: r.text.replace(/\s+/g, " ").trim(), confidence: conf, y, words };
  });
  return {
    raw: {
      ...raw,
      text: canon.applied || joined.joined ? texts.join("\n") : raw.text,
      lines,
      pageHeight: 40 + 30 * Math.max(20, n),
      pageWidth: Math.max(400, ...lines.flatMap((l) => l.words.map((w) => w.x1))),
    },
    notes: [...(joined.joined ? ["Spaced OCR text (Vision): characters re-joined"] : []), ...canon.notes, ...(cells?.notes ?? [])],
  };
}

export function parseBill(rawIn: OcrRawResult, ctx: ParseContext): OcrParsedBill {
  const prepared = prepareOcrRawForParse(rawIn);
  const raw = prepared.raw;
  const H = raw.pageHeight || 1;
  const W = raw.pageWidth || Math.max(1, ...raw.lines.flatMap((l) => (l.words ?? []).map((w) => w.x1)));
  const lines: L[] = raw.lines
    .map((l) => {
      const words = mergeSplitAmountWords(l.words ?? []);
      const text = normalizeOcrLine((words.length ? words.map((w) => w.text).join(" ") : l.text).replace(/[|]/g, " "));
      return { text, conf: l.confidence / 100, rel: l.y / H, y: l.y, words };
    })
    .filter((l) => l.text);
  const segs = buildSegments(lines, W);
  const out: OcrParsedBill = { debug: [] };
  const dbg = (m: string) => out.debug!.push(m);
  for (const n of prepared.notes) dbg(n);
  if (raw.preprocess || raw.passNote) dbg(`OCR pass: ${raw.preprocess ?? "standard"}${raw.passNote ? ` | ${raw.passNote}` : ""}`);
  const own = (ctx.ownPan || "").replace(/\D/g, "");
  const ownName = ctx.ownName ? normalizeName(ctx.ownName) : "";

  /* ---- Blocks: where is OUR company, where is the counter-party ---- */
  // Own company: profile PAN (digits) or tolerant name prefix ("New parsa Engineering WorkShop Demo Company" matches
  // "NEW PARSA ENGINEERING WORKSHOP"); a name split over two OCR lines is matched with the segment below it.
  const ownRule = ownNameRule(ctx.ownName);
  const ownKnown = own.length === 9 || !!ownRule;
  // exact PAN anywhere; one OCR-confused digit tolerated only on a PAN-labelled segment (over-lit photo: 303687786 -> 303687788)
  const isOwnPanSeg = (s: Seg) => textHasOwnPan(s.text, own) || (RX.panLabel.test(s.text) && textHasOwnPanLoose(s.text, own));
  const isOwnNameSeg = (s: Seg) => (ownName.length >= 4 && normalizeName(s.text).includes(ownName)) || textHasOwnName(s.text, ownRule);
  const isOwnSeg = (s: Seg) => isOwnPanSeg(s) || isOwnNameSeg(s);
  const below = (s: Seg) => segs.find((t) => t.line === s.line + 1 && (t.x1 <= t.x0 || (t.x0 < s.x1 && t.x1 > s.x0)));
  const ownNameAcross = (s: Seg) => {
    const nx = below(s);
    return !!nx && !isOwnNameSeg(nx) && textHasOwnName(`${s.text} ${nx.text}`, ownRule);
  };
  const buyerLabelSeg = segs.find((s) => RX.buyerLabel.test(s.text));
  const buyerY = buyerLabelSeg?.y ?? null;
  const ownPanSeg = segs.find(isOwnPanSeg);
  const ownNameSeg = segs.find(isOwnNameSeg) ?? segs.find(ownNameAcross);
  const ownSeg = [ownPanSeg, ownNameSeg].filter((x): x is Seg => !!x).sort((a, b) => a.y - b.y)[0];
  // No Bill To / Customer label read (faded photo: "Customer Name" -> "ner Nas"): a short document title
  // ("TAX INVOICE") with another company's name line above it splits seller (above) from buyer (below).
  const titleSeg = buyerY != null ? undefined : segs.find(
    (s) => /\b(tax\s*invoice|invoice|estimate|quotation|bill\s*of\s*supply)\b|कर\s*बीजक/i.test(s.text) &&
      (s.text.match(/\p{L}+/gu) ?? []).length <= 4 && !RX.billLabel.test(s.text)
  );
  const titleY =
    titleSeg && segs.some((s) => s.y < titleSeg.y - 2 && COMPANY_WORD.test(s.text) && !isOwnSeg(s)) ? titleSeg.y : null;
  const sideOf = (s: Seg): "seller" | "buyer" =>
    buyerY != null ? (s.y >= buyerY - 2 ? "buyer" : "seller")
    : RX.sellerLabel.test(s.text) ? "seller"
    : titleY != null ? (s.y > titleY + 2 ? "buyer" : "seller")
    : s.rel <= 0.2 ? "seller" : "buyer";
  let ourSide: "seller" | "buyer" | null = null;
  if (ownSeg) ourSide = sideOf(ownSeg);
  // how we found ourselves: PAN 0.95, name 0.9, both agreeing 0.97
  const ownBy: "pan" | "name" | "pan+name" | null = !ownSeg ? null
    : ownPanSeg && ownNameSeg && sideOf(ownPanSeg) === sideOf(ownNameSeg) ? "pan+name"
    : ownSeg === ownPanSeg ? "pan" : "name";
  dbg(`Own company: ${ownKnown ? `profile "${ctx.ownName ?? "-"}" (match tokens: ${ownRule ? ownRule.tokens.slice(0, ownRule.need).join(" ") : "-"}) / PAN ${own || "-"}` : "no company name/PAN in profile"}; found by ${ownBy ?? "-"}${ownSeg ? ` at "${ownSeg.text}"` : ""}`);
  // Counter-party block: purchase -> seller (above the buyer block); sale -> buyer block
  const counterSide: "seller" | "buyer" = ourSide ? (ourSide === "buyer" ? "seller" : "buyer") : ctx.kind === "purchase" ? "seller" : "buyer";
  const sellerTop = buyerY != null ? (s: Seg) => s.y < buyerY - 2 : titleY != null ? (s: Seg) => s.y <= titleY + 2 : (s: Seg) => s.rel <= 0.3;
  const counterSegs = segs.filter((s) => (counterSide === "seller" ? sellerTop(s) : !sellerTop(s) && s.rel < 0.6)).filter((s) => !isOwnSeg(s));
  dbg(`Layout: ${lines.length} lines, ${segs.length} segments; our company = ${ourSide ?? "not found"}; counter-party block = ${counterSide} (${counterSegs.length} segments)`);

  /* ---- Date / due date (labeled AD + BS, cross-checked) ---- */
  {
    const dateText = [raw.text, ...lines.map((l) => l.text), ...segs.map((s) => s.text)].filter(Boolean).join("\n");
    const resolved = resolveBillDate(dateText, defaultVoucherDateWindow());
    if (resolved) out.date = f(resolved.date, resolved.status, resolved.confidence, resolved.note);
  }
  if (!out.date) dbg("Date: no BS/AD date found");
  else dbg(`Date: ${out.date.status} ${localYmd(out.date.value)}${out.date.note ? ` (${out.date.note})` : ""}`);
  const dueIdx = segs.findIndex((s) => RX.dueLabel.test(s.text));
  if (dueIdx >= 0) {
    const c = dateCandidates(valueAfter(segs, dueIdx, RX.dueLabel))[0];
    if (c?.date && !c.ambiguous) {
      const ok = !out.date?.value || c.date >= out.date.value;
      out.dueDate = f(c.date, ok ? "fill" : "flag", ok ? 0.92 : 0.5, ok ? undefined : "Due date before bill date");
    }
  }

  /* ---- Counter-party PAN ---- */
  const panIn = (txt: string) => txt.replace(/(\d)[\s-](?=\d)/g, "$1").match(/(?<!\d)\d{9}(?!\d)/)?.[0] ?? null;
  const pans: string[] = [];
  segs.forEach((s, i) => {
    if (!RX.panLabel.test(s.text)) return;
    const p = panIn(valueAfter(segs, i, RX.panLabel)) ?? panIn(s.text);
    if (p && p !== own && panConfusionDistance(p, own) > 1 && counterSegs.includes(s) && !pans.includes(p)) pans.push(p);
  });
  if (!pans.length) {
    // label-less 9-digit number in the counter block (not a phone)
    counterSegs.forEach((s) => {
      const p = panIn(s.text);
      if (p && p !== own && panConfusionDistance(p, own) > 1 && !RX.phoneLabel.test(s.text) && !pans.includes(p)) pans.push(p);
    });
  }
  // AI engine: Gemini's counter-party (buyer on our sale, seller on our purchase; never our company) replaces the
  // layout guess - the text here is only a summary built from Gemini's JSON.
  const aiCp = rawIn.ai ? aiCounterParty(rawIn.ai.data, ctx.ownPan, ctx.ownName) : null;
  const pan = aiCp ? aiCp.pan : pans.length === 1 ? pans[0] : null;
  if (pan) out.pan = f(pan, "fill", 0.95);
  dbg(pans.length ? `PAN (counter-party): ${pans.join(", ")}${pan ? "" : " - ambiguous"}` : "PAN: no counter-party PAN found");

  /* ---- Counter-party name ---- */
  let partyName: { text: string; conf: number; seg?: Seg } | null = null;
  if (counterSide === "seller") {
    const cands = counterSegs.filter(
      (s) =>
        /\p{L}{3,}/u.test(s.text) &&
        !RX.panLabel.test(s.text) && !RX.billLabel.test(s.text) && !RX.dateLabel.test(s.text) &&
        !RX.phoneLabel.test(s.text) && !RX.addressLabel.test(s.text) &&
        !/invoice|bill|tax|estimate|receipt|<<|>>|quotation/i.test(s.text) &&
        (s.text.match(/\p{L}+/gu) ?? []).length >= 2
    );
    // Over-lit photos give garbage header lines ("rar [ar [vow] RAE amount"): drop non-word lines, prefer a line
    // by height with a company word (Pvt / Ltd / Trade / Center ...) counting 1.5x, then the top-most.
    const words = (t: string): string[] => t.match(/\p{L}+/gu) ?? [];
    const wordLike = (t: string) => {
      const ws = words(t);
      const good = ws.filter((w) => w.length >= 3 && /[aeiouyअ-औा-ौ]/i.test(w) && !/(.)\1\1/i.test(w)).length;
      return ws.length ? good / ws.length : 0;
    };
    const junk = (t: string) => /[[\]{}<>@#$%^*=~_\\]/.test(t) || wordLike(t) < 0.5;
    const companyWord = (t: string) => COMPANY_WORD.test(t);
    const clean = cands.filter((x) => !junk(x.text));
    const pool0 = clean.length ? clean : cands;
    const weight = (x: Seg) => x.h * (companyWord(x.text) ? 1.5 : 1);
    const big = pool0.sort((a, b) => weight(b) - weight(a) || Number(companyWord(b.text)) - Number(companyWord(a.text)) || a.y - b.y)[0];
    // stray OCR quote / bar at the edges ('"RATIK TRADE ...' -> 'RATIK TRADE ...')
    if (big) partyName = { text: big.text.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.)]+$/u, ""), conf: big.conf, seg: big };
    if (cands.length !== clean.length) dbg(`Party name: skipped ${cands.length - clean.length} garbled header line(s)`);
  } else {
    const i = segs.findIndex((s) => RX.buyerLabel.test(s.text) && !isOwnSeg(s));
    if (i >= 0) {
      const v = valueAfter(segs, i, RX.buyerLabel);
      if (v) partyName = { text: v, conf: segs[i].conf, seg: segs[i] };
    }
  }
  if (partyName) out.partyName = f(partyName.text, "flag", partyName.conf);
  if (aiCp) {
    partyName = aiCp.name ? { text: aiCp.name, conf: 0.9 } : null;
    if (partyName) out.partyName = f(partyName.text, "flag", 0.9);
    else delete out.partyName;
  }

  /* ---- Identifiers (counter-party block only) ---- */
  const ids: OcrIdentifiers = { pan: pan ?? undefined, phones: [], emails: [], bankAccountNos: [] };
  const blockText = counterSegs.map((s) => s.text).join("\n");
  for (const m of blockText.matchAll(/(?<![\d])(?:\+?977[\s-]?)?(9[678]\d{8})(?!\d)/g)) if (!ids.phones.includes(m[1])) ids.phones.push(m[1]);
  for (const s of counterSegs.filter((x) => RX.phoneLabel.test(x.text))) {
    for (const m of s.text.matchAll(/(?<![\d])(0\d{1,2})[\s-]{0,2}(\d{6,7})(?!\d)/g)) {
      const v = `${m[1]}-${m[2]}`;
      if (!ids.phones.includes(v)) ids.phones.push(v);
    }
  }
  for (const m of blockText.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) ids.emails.push(m[0].toLowerCase());
  if (counterSide === "seller") {
    const labeled = counterSegs.findIndex((s) => RX.addressLabel.test(s.text));
    if (labeled >= 0) ids.address = valueAfter(counterSegs, labeled, RX.addressLabel) || undefined;
    else if (partyName?.seg) {
      const below = counterSegs
        .filter((s) => s.y > partyName!.seg!.y && !RX.phoneLabel.test(s.text) && !RX.panLabel.test(s.text) && !/@/.test(s.text) && /\p{L}{3,}/u.test(s.text))
        .sort((a, b) => a.y - b.y)[0];
      if (below) ids.address = below.text;
    }
  } else {
    const i = segs.findIndex((s, k) => RX.addressLabel.test(s.text) && !sellerTop(s) && k >= 0);
    if (i >= 0) ids.address = valueAfter(segs, i, RX.addressLabel) || undefined;
  }
  if (ids.address) ids.address = ids.address.replace(/\s*-\s+(?=\d)/g, "-").replace(/\s+,/g, ",").replace(/[\s:;,|.\-]+$/, "").trim();
  for (const s of counterSegs) {
    if (!/\b(a\/?c|acc(?:oun)?t)\s*(no|number|#)?\b|खाता\s*नं/i.test(s.text)) continue;
    const m = s.text.replace(/(\d)[\s-](?=\d)/g, "$1").match(/(?<!\d)\d{8,20}(?!\d)/);
    if (m) ids.bankAccountNos.push(m[0]);
  }
  const contact = counterSegs.find((s) => /\b(contact\s*person|attn\.?|prop(?:rietor)?\.?)\b|सम्पर्क\s*व्यक्ति|प्रोप्राइटर/i.test(s.text));
  if (contact) ids.contactPerson = contact.text.replace(/^.*?(person|attn\.?|prop(?:rietor)?\.?|व्यक्ति|प्रोप्राइटर)\s*[:.-]?\s*/i, "").slice(0, 60);
  const pm = segs.findIndex((s) => RX.payMode.test(s.text));
  if (pm >= 0) {
    const v = valueAfter(segs, pm, RX.payMode).split(/\s{2,}/)[0].trim();
    if (v) out.paymentMode = ids.paymentMode = v;
  }
  if (aiCp) {
    ids.pan = pan ?? undefined;
    if (aiCp.address) ids.address = aiCp.address;
    ids.phones = [...aiCp.phones, ...ids.phones.filter((p) => !aiCp.phones.includes(p))];
  }
  out.identifiers = ids;
  dbg(`Identifiers${aiCp ? " (AI counter-party)" : ""}: name="${partyName?.text ?? "-"}" PAN=${ids.pan ?? "-"} phones=${ids.phones.join("/") || "-"} address="${ids.address ?? "-"}" payment=${ids.paymentMode ?? "-"}`);

  /* ---- Party match: PAN exact, then strict fuzzy name ---- */
  // system ledgers that ride along in the party list (Sales/Purchase Account, Owner's Capital, Opening Balance) are never a bill party
  const pool = ctx.parties.filter(isOcrSelectableParty);
  // 1) PAN / VAT No exact (highest priority, regardless of name). Own company PAN never selects a party.
  const ownPanD = String(ctx.ownPan ?? "").replace(/\D/g, "");
  const panOf = (p: (typeof pool)[number]) => [p.pan, p.panNo, p.vatNo].map((x) => String(x ?? "").replace(/\D/g, "")).filter(Boolean);
  if (pan && pan !== ownPanD) {
    const hits = pool.filter((p) => panOf(p).includes(pan));
    if (hits.length === 1) { out.partyId = f(hits[0].id, "fill", 0.99); dbg(`Party: "${hits[0].name}" by PAN ${pan}`); }
    else if (hits.length > 1) out.partyId = f("", "flag", 0.5, "Several parties share this PAN");
  }
  // 2) Phone (last 10 digits, counter-party block only) - strong signal when unique
  if (!out.partyId && ids.phones.length) {
    const tail = (x: unknown) => String(x ?? "").replace(/\D/g, "").slice(-10);
    const billPh = new Set(ids.phones.map(tail).filter((x) => x.length >= 7));
    const hits = pool.filter((p) => [p.phone, p.mobile].map(tail).some((x) => x.length >= 7 && billPh.has(x)));
    if (hits.length === 1) { out.partyId = f(hits[0].id, "fill", 0.97); dbg(`Party: "${hits[0].name}" by phone`); }
  }
  if (!out.partyId && partyName) {
    const best = bestUniqueMatch(normalizeName(partyName.text), pool, (p) => namesOf(p).map(normalizeName), 0.95, 0.1);
    if (best) out.partyId = f(best.item.id, "fill", best.score);
  }
  // Alias / script-insensitive pass: bill name vs party name + Alias Name by sound skeleton
  // (Roman bill <-> Devanagari alias, minor spelling drift). Stricter: unique, long enough.
  if (!out.partyId && partyName) {
    // transliterate BEFORE normalizeName (it strips Devanagari vowel marks as non-letters)
    const sk = (x: string) => nameSkeleton(normalizeName(devanagariToRoman(x)));
    const q = sk(partyName.text);
    if (q.replace(/ /g, "").length >= 5) {
      const best = bestUniqueMatch(q, pool, (p) => namesOf(p).map(sk).filter((x) => x.replace(/ /g, "").length >= 3), 0.9, 0.1);
      if (best) {
        out.partyId = f(best.item.id, "fill", Math.min(best.score, 0.95));
        dbg(`Party: matched "${best.item.name}" by name/alias sound (${Math.round(best.score * 100)}%)`);
      }
    }
  }
  // Token coverage (after 0.95 name + skeleton fill attempts): bill tokens as an ordered prefix of the master.
  // Unique score >= 0.95 fills; unique 0.6 is suggestion/flag only; ties never fill.
  if (!out.partyId && partyName) {
    const scored = pool
      .map((p) => ({
        p,
        score: Math.max(0, ...namesOf(p).map((x) => tokenCoverageScore(partyName.text, x))),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (top) {
      const tied = scored.filter((x) => x.score === top.score);
      if (tied.length === 1) {
        if (top.score >= 0.95) {
          out.partyId = f(top.p.id, "fill", top.score);
          dbg(`Party: matched "${top.p.name}" by token coverage (${Math.round(top.score * 100)}%)`);
        } else if (top.score >= 0.6) {
          out.partyId = f(top.p.id, "flag", top.score, "Name shares a prefix only - confirm the party");
          dbg(`Party: "${top.p.name}" token coverage ${Math.round(top.score * 100)}% (suggestion only)`);
        }
      } else {
        dbg(`Party: token coverage tied between ${tied.map((t) => t.p.name).join(" / ")} (${Math.round(top.score * 100)}%) - not filled`);
      }
    }
  }
  {
    // TEMP debug (Copy all): party candidates + best name/alias scores
    const qn = partyName ? normalizeName(partyName.text) : "";
    const top = qn
      ? pool
          .map((p) => ({ n: p.name, a: p.aliasName ?? "", s: Math.max(0, ...namesOf(p).map((x) => nameScore(qn, normalizeName(x)))), k: Math.max(0, ...namesOf(p).map((x) => nameScore(nameSkeleton(normalizeName(devanagariToRoman(qn))), nameSkeleton(normalizeName(devanagariToRoman(x)))))) }))
          .sort((a, b) => Math.max(b.s, b.k) - Math.max(a.s, a.k))
          .slice(0, 3)
      : [];
    dbg(`Party candidates: ${ctx.parties.length} received, ${pool.length} active, ${pool.filter((p) => (p.aliasName ?? "").trim()).length} with alias; query "${qn || "-"}"; best: ${top.map((t) => `${t.n}${t.a ? ` [alias "${t.a}"]` : ""} name ${Math.round(t.s * 100)}% / sound ${Math.round(t.k * 100)}%`).join("; ") || "-"}; picked ${out.partyId?.value ?? "none"}`);
  }
  // Over-lit photo misreads PAN digits (619727215 -> 818727218): unique master PAN within 3 OCR-confusable digits
  // (6/8/5/9/3/0, 1/7/4) is a SUGGESTION only (flag), never a fill.
  if (!out.partyId && pan) {
    const near = pool
      .map((p) => ({ p, d: Math.min(...panOf(p).map((x) => panConfusionDistance(pan, x))) }))
      .filter((x) => x.d >= 1 && x.d <= 3);
    if (near.length === 1) {
      const real = panOf(near[0].p).find((x) => panConfusionDistance(pan, x) === near[0].d)!;
      out.partyId = f(near[0].p.id, "flag", 0.7, `PAN read as ${pan}; closest party PAN ${real} - confirm`);
      out.pan = f(real, "flag", 0.7, `PAN read as ${pan} (unclear print)`);
      dbg(`Party: "${near[0].p.name}" by near PAN ${real} (read ${pan}, ${near[0].d} confusable digit(s)) - suggestion only`);
    }
  }
  if (!out.partyId) dbg(pan ? `Party: no account has PAN ${pan}; name "${partyName?.text ?? "-"}" had no unique match >= 95%` : `Party: no PAN; name "${partyName?.text ?? "-"}" had no unique match >= 95%`);

  /* ---- Bill no (OCR digit confusions fixed per part: B3 -> 83) ---- */
  for (let i = 0; i < segs.length; i++) {
    if (!RX.billLabel.test(segs[i].text)) continue;
    const v = valueAfter(segs, i, RX.billLabel);
    const tok = /^[A-Za-z0-9][A-Za-z0-9\-/]{0,24}/.exec(v)?.[0];
    if (tok && /\d/.test(tok) && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(tok)) {
      const fixed = tok.split(/([-/])/).map(fixDigitConfusions).join("").toUpperCase();
      out.billNo = f(fixed, "fill", segs[i].conf);
      break;
    }
  }
  if (!out.billNo) {
    // label lost on an over-lit photo: invoice-series token like "SI-02833" in the header (suggestion only)
    for (const s of segs) {
      if (s.rel > 0.45 || RX.phoneLabel.test(s.text) || RX.panLabel.test(s.text)) continue;
      const m = /(?<![A-Za-z0-9])([A-Z]{1,4})[-/](\d{3,7})(?![\d/.-])/.exec(s.text);
      if (m) {
        out.billNo = f(`${m[1]}-${m[2]}`, "flag", 0.6, "Bill No label not read - confirm");
        dbg(`Bill No: unlabeled series token "${out.billNo.value}" (suggestion)`);
        break;
      }
    }
  }
  if (!out.billNo) dbg("Bill No: no Bill/Invoice No label with a value");

  /* ---- Amounts ---- */
  const grand = amountAfterLabel(lines, RX.grand);
  const plain = amountAfterLabel(lines, RX.plainTotal, /\bgrand\b|\btaxable\b|\bsub\s*-?\s*total\b/i);
  const taxableL = amountAfterLabel(lines, RX.taxable);
  const vat = amountAfterLabel(lines, RX.vat);
  const disc = amountAfterLabel(lines, RX.discount);
  const tds = amountAfterLabel(lines, RX.tds);
  const round = amountAfterLabel(lines, RX.roundOff);
  const altNums = new Set((raw.altText ?? "").split(/\r?\n/).flatMap((t) => amountsInLine(normalizeOcrLine(t))).map((n) => n.toFixed(2)));

  const items = parseLineItems(lines, dbg);
  const S = items?.rows.reduce((a, r) => a + r.amount, 0) ?? 0;
  const discount = disc?.value ?? 0;
  // Taxable base: item rows when parsed, else the printed Taxable / Total (never 0 -> would let VAT pose as grand total)
  const taxable = S > 0 ? S - discount : taxableL?.value ?? plain?.value ?? 0;
  let tax = vat?.value ?? 0;
  // printed Taxable/Total missing -> derive taxable = grand - VAT (when both printed)
  const derivedTaxable = !plain && !taxableL && grand && vat ? Math.round((grand.value - vat.value) * 100) / 100 : null;
  // Printed "Total" with a dropped decimal point (e.g. "1150416" for 11,504.16): restore when it then equals the line sum
  let plainValue = plain?.value ?? null;
  if (plainValue != null && S > 0 && Math.abs(S - plainValue) > 1) {
    for (const k of [1, 2, 3, 4, 5]) {
      const v = Math.round((plainValue / 10 ** k) * 100) / 100;
      if (Math.abs(v - S) <= 0.05) {
        dbg(`Total ${plainValue} -> ${v} (decimal point restored)`);
        plainValue = v;
        break;
      }
    }
  }
  // Dropped decimal point on printed Taxable / Grand Total ("47969480", "54205512"): restore when it then fits
  // the other printed totals (Taxable + VAT = Grand, VAT = 13% of Taxable).
  const restoreTo = (v: number, target: number) => {
    for (const k of [1, 2, 3]) {
      const x = Math.round((v / 10 ** k) * 100) / 100;
      if (Math.abs(x - target) <= 1) return x;
    }
    return null;
  };
  if (grand && taxableL && vat) {
    const want = (gv: number, tv: number, vv: number) => Math.abs(tv + vv - gv) <= 1;
    if (!want(grand.value, taxableL.value, vat.value)) {
      const g2 = restoreTo(grand.value, taxableL.value + vat.value);
      const t2 = restoreTo(taxableL.value, grand.value - vat.value);
      const v2 = restoreTo(vat.value, grand.value - taxableL.value);
      if (g2 != null) { dbg(`Grand ${grand.value} -> ${g2} (decimal point restored)`); grand.value = g2; }
      else if (t2 != null) { dbg(`Taxable ${taxableL.value} -> ${t2} (decimal point restored)`); taxableL.value = t2; }
      else if (v2 != null) { dbg(`VAT ${vat.value} -> ${v2} (decimal point restored from Grand - Taxable)`); vat.value = v2; }
    }
  }
  const check1 =
    (plainValue == null || Math.abs(S - plainValue) <= 1) &&
    (!taxableL || Math.abs(taxable - taxableL.value) <= 1) &&
    (derivedTaxable == null || Math.abs(taxable - derivedTaxable) <= 1);
  if (vat && taxable > 0 && Math.abs(vat.value - taxable * 0.13) > 1) {
    for (const k of [2, 3, 4, 5]) {
      const v = Math.round((vat.value / 10 ** k) * 100) / 100;
      if (Math.abs(v - taxable * 0.13) <= 1) {
        dbg(`VAT ${vat.value} -> ${v} (decimal point restored)`);
        vat.value = v;
        tax = v;
        break;
      }
    }
  }
  tax = vat?.value ?? tax;
  if (vat && grand && Math.abs(vat.value - (grand.value * 13) / 113) > 1 && Math.abs(vat.value - taxable * 0.13) > 1) {
    const v = restoreTo(vat.value, (grand.value * 13) / 113);
    if (v != null) {
      dbg(`VAT ${vat.value} -> ${v} (decimal point restored from Grand x 13/113)`);
      vat.value = v;
      tax = v;
    }
  }
  const check2 = !vat || Math.abs(tax - Math.round(taxable * 0.13 * 100) / 100) <= 1;
  const expected = Math.round((taxable + tax + (round?.value ?? 0)) * 100) / 100;
  let grandValue = grand?.value ?? null;
  let grandNote = "";
  if (grandValue == null && taxable > 0 && expected > tax && altNums.has(expected.toFixed(2))) {
    grandValue = expected;
    grandNote = " (grand total read by 2nd OCR pass)";
  }
  // Unlabeled grand total: largest trailing money value on a line AFTER the VAT line that equals taxable + VAT (±0.05)
  if (grandValue == null && taxable > 0 && tax > 0) {
    const vi = lines.findIndex((l) => RX.vat.test(l.text));
    let best: number | null = null;
    for (const l of lines.slice(Math.max(0, vi))) {
      const nums = amountsInLine(normalizeOcrLine(l.text));
      const last = nums[nums.length - 1];
      if (last != null && Math.abs(last - expected) <= 0.05 && (best == null || last > best)) best = last;
    }
    if (best != null) {
      grandValue = best;
      grandNote = " (unlabeled trailing amount = taxable + VAT)";
    }
  }
  const check3 = grandValue != null && Math.abs(expected - grandValue) <= 1;
  dbg(`Totals: S=${S.toFixed(2)} total=${plain?.value ?? "-"} taxable=${taxableL?.value ?? "-"} disc=${discount} vat=${vat?.value ?? "-"} grand=${grandValue ?? "-"}${grandNote} | check1(sum/taxable)=${check1} check2(VAT13%)=${check2} check3(grand)=${check3}`);
  const reconciled = !!items && items.rows.length > 0 && items.flagged === 0 && check1 && check2 && check3;

  if (items?.rows.length) {
    const itemPool = ctx.items.filter((i) => !i.isDeleted);
    items.rows = items.rows.map((r) => {
      const n = normalizeName(r.description.replace(/<[^>]*>/g, " "));
      const exact = itemPool.filter((i) => namesOf(i).some((x) => normalizeName(x) === n));
      if (exact.length === 1) return { ...r, itemId: exact[0].id };
      const best = bestUniqueMatch(n, itemPool, (i) => namesOf(i).map(normalizeName), 0.92, 0.08);
      return best ? { ...r, itemId: best.item.id } : r;
    });
  }
  // Printed totals agree with each other (Taxable x 13% = VAT, Taxable + VAT = Grand) even though the item rows
  // did not reconcile (a faded / misread row): totals are trustworthy on their own -> fill them, items stay flagged.
  const printedBase = taxableL?.value ?? (plainValue != null ? Math.round((plainValue - discount) * 100) / 100 : null);
  const totalsSelfConsistent =
    !reconciled && printedBase != null && printedBase > 0 && !!vat && grand != null &&
    Math.abs(vat.value - printedBase * 0.13) <= 1 && Math.abs(printedBase + vat.value - grand.value) <= 1;
  if (totalsSelfConsistent) dbg(`Totals: printed Taxable ${printedBase} + VAT ${vat!.value} = Grand ${grand!.value} (self-consistent) -> filled; line items ${items?.rows.length ? "flagged" : "not read"}`);
  if (reconciled) {
    out.lineItems = f(items!.rows, "fill", 0.95);
    if (taxableL ?? plain) out.subTotal = f((taxableL ?? plain)!.value, "fill", 0.95);
    if (disc) out.discount = f(discount, "fill", 0.95);
    if (vat) out.vat = f(tax, "fill", 0.95);
    out.total = f(grandValue!, "fill", 0.97);
  } else if (totalsSelfConsistent) {
    out.subTotal = f((taxableL ?? plain)!.value, "fill", 0.9);
    if (disc) out.discount = f(discount, "fill", 0.9);
    out.vat = f(vat!.value, "fill", 0.9);
    out.total = f(grand!.value, "fill", 0.92);
    if (items?.rows.length) out.lineItems = f(items.rows, "flag", 0.5, "Line items did not reconcile");
  } else {
    if (grandValue != null) out.total = f(grandValue, "flag", grand?.conf ?? 0.6, "Totals did not reconcile with line items");
    if (items?.rows.length) out.lineItems = f(items.rows, "flag", 0.5, "Line items did not reconcile");
    if (vat) out.vat = f(tax, "flag", vat.conf, "Not reconciled");
    if (disc) out.discount = f(discount, "flag", disc.conf, "Not reconciled");
  }
  if (tds) out.tds = f(tds.value, "flag", tds.conf, "TDS is hint-only");

  // Single amount (payments / contra / adjustment)
  const recv = amountAfterLabel(lines, /\b(received|paid|amount\s*paid|amount\s*received|cheque\s*amount)\b|प्राप्त\s*रकम|भुक्तानी\s*रकम/i);
  const cand = reconciled ? grandValue! : totalsSelfConsistent ? grand!.value : (grandValue ?? recv?.value ?? null);
  if (cand != null && cand > 0) {
    if (reconciled) out.amount = f(cand, "fill", 0.97);
    else if (totalsSelfConsistent) out.amount = f(cand, "fill", 0.92);
    else {
      const seen = lines.reduce((n, l) => n + amountsInLine(l.text).filter((v) => Math.abs(v - cand) < 0.005).length, 0) + (altNums.has(cand.toFixed(2)) ? 1 : 0);
      dbg(`Amount: candidate ${cand} seen ${seen} time(s) (need 2 unless totals reconcile)`);
      out.amount = seen >= 2 ? f(cand, "fill", 0.92) : f(cand, "flag", 0.6, "Amount seen only once - not confirmed");
    }
  }

  out.docType = detectDocType(lines, ourSide, { ownBy, ownKnown, counterPan: pans.length > 0, items: !!items?.rows.length });
  if (out.docType) dbg(`Document type: ${out.docType.type} ${Math.round(out.docType.confidence * 100)}% (${out.docType.reason})`);
  else dbg(`Document type: not determined (${ownKnown ? "not an invoice/bill, or a bank slip / receipt without our company" : "no company name/PAN in the company profile"})`);
  // AI (Gemini) answer: its fields override the text parse above (kept where Gemini left a field null), then our checks run on them
  if (rawIn.ai) applyAiToBill(out, rawIn.ai, { parties: ctx.parties, items: ctx.items, ownPan: ctx.ownPan, ownName: ctx.ownName, normUnit });
  return out;
}

/**
 * Bill type relative to OUR company.
 * Invoices / bills (rules in order):
 *   1. our company in the seller / header block (before Bill To / Customer) -> Sale; in the Customer / Bill To block -> Purchase
 *      (PAN 0.95, name 0.90, both 0.97; "Tax Invoice" / "Bill To" with our name on the buyer side +0.03)
 *   2. our company not on the bill at all -> Purchase (0.86 when the profile has a name/PAN and the bill is clearly an
 *      invoice: Tax Invoice title, counter-party PAN or item lines; else 0.6 = suggestion only)
 * Bank slips / cheques / deposit receipts never use the invoice rules (receipt detector / fallback).
 */
export function detectDocType(
  lines: { text: string }[],
  ourSide: "seller" | "buyer" | null,
  ev: { ownBy?: "pan" | "name" | "pan+name" | null; ownKnown?: boolean; counterPan?: boolean; items?: boolean } = {},
): OcrParsedBill["docType"] {
  const all = lines.map((l) => l.text).join("\n");
  const taxInv = /tax\s*invoice|कर\s*बीजक/i.test(all);
  const bankSlip = !taxInv && /\b(cheque|deposit\s*slip|deposit\s*voucher|cash\s*deposit|fund\s*transfer|beneficiary|transaction\s*id|connect\s*ips|fonepay|esewa|khalti)\b/i.test(all);
  const title =
    /credit\s*note|क्रेडिट\s*नोट/i.test(all) ? "credit_note"
    : /debit\s*note|डेबिट\s*नोट/i.test(all) ? "debit_note"
    : taxInv ? "invoice"
    : /\b(money\s*)?receipt\b|रसिद|भरपाई/i.test(all) ? "receipt"
    : /payment\s*voucher|paid\s*to/i.test(all) ? "payment"
    : /invoice|\bbill\b|बीजक|बिल/i.test(all) || (ev.items && !bankSlip) ? "invoice"
    : null;
  if (!title) return undefined;
  if (title === "credit_note" || title === "debit_note") return { type: title, confidence: 0.9, reason: `title "${title.replace("_", " ")}"` };
  if (title === "payment") return { type: "payment_out", confidence: 0.8, reason: "payment voucher / paid to" };
  const by = ev.ownBy ?? "name";
  const why = ourSide === "seller" ? `our company (${by}) in seller/header block` : `our company (${by}) in Customer / Bill To block`;
  if (title === "receipt") {
    if (!ourSide) return undefined;
    return { type: ourSide === "seller" ? "payment_in" : "payment_out", confidence: 0.85, reason: `receipt; ${why}` };
  }
  if (bankSlip) return undefined; // bank documents: fallback (receipt detector), never the invoice rules
  const base = by === "pan+name" ? 0.97 : by === "pan" ? 0.95 : 0.9;
  if (ourSide === "seller") return { type: "sale", confidence: base, reason: `invoice issued BY us: ${why}` };
  if (ourSide === "buyer") {
    const kw = taxInv || /\bbill\s*to\b/i.test(all);
    return { type: "purchase", confidence: Math.min(0.98, base + (kw ? 0.03 : 0)), reason: `invoice addressed TO us: ${why}${kw ? " + Tax Invoice / Bill To" : ""}` };
  }
  const strong = !!ev.ownKnown && (taxInv || !!ev.counterPan || !!ev.items);
  return {
    type: "purchase",
    confidence: strong ? 0.86 : 0.6,
    reason: ev.ownKnown ? "invoice; our company name/PAN not on the bill -> Purchase" : "invoice; company profile has no name/PAN -> Purchase (unconfirmed)",
  };
}
