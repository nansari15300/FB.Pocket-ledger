/**
 * Online OCR (Azure Read / Vision) without word geometry returns a tax-invoice table one CELL per line:
 *   "S.N" / "HS CODE" / "PARTICULARS" / "ALT QTY" / "QTY" / "UOM" / "RATE" / "AMOUNT"
 *   "1" / "7208" / "HR SHEET 4MM" / "2.000 PCS" / "179.500" / "KG" / "98.00" / "17,591.00" ...
 * and totals as "SUB TOTAL" with "84,343.30" on the next line (sometimes after "REMARKS : SC").
 * This rebuilds one line per item row (cells placed at their header column x, so the normal header
 * parser reads QTY, not ALT QTY) and joins each totals label with its amount. A row ends when
 * qty x rate = amount holds (works without S.N, e.g. a missing "4", or with "12 8311" merged). Pure.
 */
import { parseStrictAmount } from "./normalize";
import type { OcrWord } from "./types";

export type CellTableLine = { text: string; words?: OcrWord[] };
type Role = "sn" | "hs" | "desc" | "alt" | "qty" | "unit" | "rate" | "amount";

const HEAD: [Role, RegExp][] = [
  ["sn", /^(s\.?\s*n\.?|sn|sl\.?(\s*no\.?)?|s\.?\s*no\.?)$|^क्र\.?\s*सं\.?$/i],
  ["hs", /^(hs\s*code|hsn(\s*code)?|h\.s\.?\s*code)$/i],
  ["alt", /^alt\.?\s*(qty|quantity)$/i],
  ["desc", /^(particulars?|description(\s*of\s*goods)?|items?(\s*name)?|details|goods)$|^विवरण$/i],
  ["qty", /^(q\.?\s*t?\.?\s*y\.?|qnty|quantity)$|^(परिमाण|मात्रा)$/i],
  ["unit", /^(unit|uom)$|^इकाई$/i],
  ["rate", /^(rate|price|unit\s*price)$|^दर$/i],
  ["amount", /^(amount|amt|total)$|^(रकम|राशि)$/i],
];
const ALPHA = /[A-Za-z\u0900-\u097F]{2,}/;
const NUM_UNIT = /^\d[\d,]*(?:\.\d+)?\s*[A-Za-z]{2,5}\.?$/;
const UNIT_WORD = /^[A-Za-z]{1,5}\.?$/;
const STOP = /^(sub\s*-?\s*total|total\b|discount|taxable|vat\b|grand|net\s*(amount|total)|amount\s*in\s*words|in\s*words|round\s*-?\s*off)/i;
const TOTAL_LABEL =
  /^(sub\s*-?\s*total|total(\s*amount)?|discount(\s*amount)?|taxable(\s*(amount|value|total))?|vat(\s*\(?\d{1,2}(\.\d+)?\s*%\)?)?|\d{1,2}(\.\d+)?\s*%\s*vat|grand\s*total|net\s*(amount|total|payable)|round\s*-?\s*off|tds)\s*:?$/i;

function roleOf(t: string): Role | null {
  const s = t.trim();
  if (s.length > 24) return null;
  for (const [r, re] of HEAD) if (re.test(s)) return r;
  return null;
}

/** Number candidates for a cell ("39,800" may be qty 39.8). */
function numCands(t: string): number[] {
  const out: number[] = [];
  const v = parseStrictAmount(t);
  if (v != null && v > 0) out.push(v);
  const c3 = /^(\d{1,3}),(\d{3})$/.exec(t);
  if (c3) {
    const d = Number(`${c3[1]}.${c3[2]}`);
    if (d > 0 && !out.includes(d)) out.push(d);
  }
  return out;
}
const isNum = (t: string) => /^[\d,]+(\.\d+)?$/.test(t) && numCands(t).length > 0;

type Row = { sn: string[]; desc: string; alt?: string; qty: string; unit?: string; rate: string; amount: string };

/** Cells of one item row -> roles, when qty x rate = amount (amount = last cell). */
function solveRow(cells: string[]): Row | null {
  if (cells.length < 4) return null;
  const last = cells[cells.length - 1];
  if (!isNum(last)) return null;
  const a = numCands(last)[0];
  if (!(a >= 1)) return null;
  const di = cells.findIndex((c) => ALPHA.test(c) && !NUM_UNIT.test(c) && !UNIT_WORD.test(c));
  if (di < 0) return null;
  const tol = Math.max(0.6, 0.005 * a);
  let best: { qi: number; ri: number; score: number } | null = null;
  for (let qi = di + 1; qi < cells.length - 1; qi++) {
    if (!isNum(cells[qi])) continue;
    for (let ri = qi + 1; ri < cells.length - 1; ri++) {
      if (!isNum(cells[ri])) continue;
      for (const q of numCands(cells[qi]))
        for (const r of numCands(cells[ri])) {
          if (Math.abs(q * r - a) > tol) continue;
          const score = ri * 10 + qi - Math.abs(q * r - a);
          if (!best || score > best.score) best = { qi, ri, score };
        }
    }
  }
  if (!best) return null;
  const between = cells.slice(best.qi + 1, best.ri);
  // every cell after the amount's rate must be the amount: nothing unexplained between rate and amount
  if (best.ri !== cells.length - 2) return null;
  const descParts: string[] = [];
  let alt: string | undefined;
  for (const c of cells.slice(di, best.qi)) {
    if (NUM_UNIT.test(c) || (/^\d/.test(c) && !ALPHA.test(c))) alt = alt ? `${alt} ${c}` : c;
    else descParts.push(c);
  }
  return {
    sn: cells.slice(0, di).flatMap((c) => c.split(/\s+/)).filter(Boolean),
    desc: descParts.join(" "),
    alt,
    qty: cells[best.qi],
    unit: between.find((c) => UNIT_WORD.test(c)),
    rate: cells[best.ri],
    amount: last,
  };
}

function word(text: string, cx: number, y: number): OcrWord {
  const w = Math.max(24, text.length * 9);
  return { text, x0: cx - w / 2, x1: cx + w / 2, y0: y, y1: y + 20, conf: 92 };
}

/** Rebuilt lines (words only on the table header / item rows), or null when the text is not cell-per-line. */
export function rebuildCellPerLineTable(textsIn: string[]): { lines: CellTableLine[]; notes: string[] } | null {
  const texts = textsIn.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  const notes: string[] = [];
  // 1) header block: >= 4 consecutive one-cell lines, Amount + >= 3 of desc/qty/unit/rate/amount
  let h0 = -1;
  let head: Role[] = [];
  let headTexts: string[] = [];
  for (let i = 0; i < texts.length && h0 < 0; i++) {
    const roles: Role[] = [];
    let j = i;
    while (j < texts.length) {
      const r = roleOf(texts[j]);
      if (!r || roles.includes(r)) break;
      roles.push(r);
      j++;
    }
    const core = roles.filter((r) => r === "desc" || r === "qty" || r === "unit" || r === "rate" || r === "amount").length;
    if (roles.length >= 4 && roles.includes("amount") && core >= 3) {
      h0 = i;
      head = roles;
      headTexts = texts.slice(i, j);
    }
  }
  const out: CellTableLine[] = [];
  let k = 0;
  let rows = 0;
  if (h0 >= 0) {
    const COLW = 160;
    const colX = new Map<Role, number>(head.map((r, i) => [r, 80 + i * COLW]));
    const xOf = (r: Role): number => {
      const x = colX.get(r);
      if (x != null) return x;
      const order: Role[] = ["sn", "hs", "desc", "alt", "qty", "unit", "rate", "amount"];
      // missing column: just right of the nearest earlier known column
      for (let i = order.indexOf(r) - 1; i >= 0; i--) {
        const p = colX.get(order[i]);
        if (p != null) return p + COLW / 3;
      }
      return 40;
    };
    for (; k < h0; k++) out.push({ text: texts[k] });
    const headY = 0;
    out.push({ text: headTexts.join(" "), words: headTexts.map((t, i) => word(t, xOf(head[i]), headY)) });
    k = h0 + head.length;
    let buf: string[] = [];
    const flushBuf = () => {
      for (const c of buf) out.push({ text: c });
      buf = [];
    };
    for (; k < texts.length; k++) {
      const t = texts[k];
      if (STOP.test(t)) break;
      buf.push(t);
      const r = solveRow(buf);
      if (r) {
        const ws: OcrWord[] = [];
        r.sn.forEach((s, i) => ws.push(word(s, i === 0 ? xOf("sn") : xOf("hs"), 0)));
        if (r.desc) ws.push(word(r.desc, xOf("desc"), 0));
        ws.push(word(r.qty, xOf("qty"), 0));
        if (r.unit) ws.push(word(r.unit, xOf("unit"), 0));
        ws.push(word(r.rate, xOf("rate"), 0));
        ws.push(word(r.amount, xOf("amount"), 0));
        out.push({ text: ws.map((w) => w.text).join(" "), words: ws });
        rows++;
        buf = [];
      } else if (buf.length > 14) {
        // runaway: the first cell is not part of an item row
        out.push({ text: buf.shift()! });
      }
    }
    flushBuf();
    if (rows) notes.push(`Cell-per-line table (no word boxes): header ${head.join("/")} + ${rows} item row(s) rebuilt by qty x rate = amount`);
  }
  // 2) totals: label line without an amount + the nearest following amount-only line
  const rest = texts.slice(k);
  const used = new Set<number>();
  const merged: CellTableLine[] = [];
  let pairs = 0;
  for (let i = 0; i < rest.length; i++) {
    if (used.has(i)) continue;
    const t = rest[i];
    let joined = false;
    if (TOTAL_LABEL.test(t)) {
      for (let j = i + 1; j < Math.min(rest.length, i + 5); j++) {
        if (used.has(j)) continue;
        if (TOTAL_LABEL.test(rest[j])) break; // that amount belongs to the next label
        if (isNum(rest[j]) || /^[\d,]+\.\d{2}$/.test(rest[j])) {
          used.add(j);
          merged.push({ text: `${t} ${rest[j]}` });
          pairs++;
          joined = true;
          break;
        }
      }
    }
    if (!joined) merged.push({ text: t });
  }
  if (pairs) notes.push(`Totals: ${pairs} label(s) joined with the amount on a following line`);
  if (!rows && pairs < 2) return null;
  return { lines: [...out, ...merged], notes };
}
