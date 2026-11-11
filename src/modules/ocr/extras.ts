/** Pure OCR decision helpers (shared by useVoucherOcr and the node regression test). */
import { ownNameRule, textHasOwnName } from "./ownCompany";
import type { OcrParsedBill } from "./types";
import { normalizeName, parseStrictAmount } from "./normalize";

export type TaxLike = { id: string; rate?: number | string; name?: string; isDeleted?: boolean };
export type OptionLike = { value: string; label: string };

export function findVat13<T extends TaxLike>(taxes: readonly T[]): T | undefined {
  const r13 = taxes.filter((t) => !t.isDeleted && Number(t.rate) === 13);
  return r13.find((t) => /vat/i.test(t.name ?? "")) ?? r13[0];
}

/** Dr Purchase account: learned per supplier -> existing account by name -> built-in system account. Never "create" while one exists. */
export function pickLedgerAccount(
  options: readonly OptionLike[],
  cfg: { systemDefault: string; nameRx: RegExp },
  learned?: string | null
): { value: string; source: "learned" | "name" | "system" } {
  if (learned && (learned === cfg.systemDefault || options.some((o) => o.value === learned))) return { value: learned, source: "learned" };
  const byName = options.find((o) => cfg.nameRx.test(o.label));
  if (byName) return { value: byName.value, source: "name" };
  return { value: cfg.systemDefault, source: "system" };
}

export type ExtraPlan = {
  vat: { kind: "none" } | { kind: "apply"; taxId: string } | { kind: "create"; prefillName: string };
  createItems: { index: number; name: string; unit?: string; rate: number }[];
  showDiscount: boolean;
  partyAccountType: "creditors" | "debtors";
};

export function planOcrExtras(bill: OcrParsedBill, o: { taxes: readonly TaxLike[]; partySide: "seller" | "buyer" }): ExtraPlan {
  const vatAmt = bill.vat?.value ?? 0;
  const vt = findVat13(o.taxes);
  return {
    vat: vatAmt > 0 ? (vt ? { kind: "apply", taxId: vt.id } : { kind: "create", prefillName: "VAT 13%" }) : { kind: "none" },
    createItems: (bill.lineItems?.value ?? [])
      .map((r, index) => ({ index, name: r.description, unit: r.unit, rate: r.rate, itemId: r.itemId }))
      .filter((r) => !r.itemId)
      .map(({ itemId: _i, ...r }) => ({ ...r, name: cleanItemName(r.name) })),
    showDiscount: (bill.discount?.value ?? 0) > 0,
    partyAccountType: o.partySide === "seller" ? "creditors" : "debtors",
  };
}

/** True when a name/PAN is OUR company (company profile) - never offered as the party. */
export function isOwnCompany(name: string | undefined | null, pan: string | undefined | null, own: { name?: string | null; pan?: string | null }): boolean {
  const digits = (v?: string | null) => String(v ?? "").replace(/\D/g, "");
  if (pan && own.pan && digits(pan) === digits(own.pan)) return true;
  if (name && own.name) {
    const a = normalizeName(name), b = normalizeName(own.name);
    if (a && b && (a === b || (a.length > 6 && (a.includes(b) || b.includes(a))))) return true;
    // tolerant prefix rule ("New parsa Engineering WorkShop Demo Company" vs "NEW PARSA ENGINEERING WORKSHOP PVT. LTD.")
    if (textHasOwnName(name, ownNameRule(own.name))) return true;
  }
  return false;
}

/** Inventory units that may leak into an OCR item name (qty + unit). MM is a size, not a qty unit. */
const QTY_UNIT_WORDS = new Set([
  "pc", "pcs", "pc5", "cs",
  "no", "nos", "piece", "pieces",
  "ltr", "ltrs", "litre", "litres", "liter", "liters", "l",
  "kg", "kgs", "gm", "gms", "gram", "grams", "g",
  "mtr", "mtrs", "meter", "meters", "metre", "metres", "mt", "mts",
  "box", "boxes", "bag", "bags", "set", "sets",
  "pkt", "pkts", "packet", "packets",
  "doz", "dozen", "ft", "feet", "foot",
]);

/** True for PCS/NOS/KG/... and OCR misreads (CS, 2CS, 7CS, deg-cs, PC5, P CS). */
export function isOcrQtyUnit(token: string): boolean {
  const raw = String(token ?? "").trim();
  if (!raw) return false;
  const n = raw.replace(/[\u00b0\u00ba]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!n || n.length > 8) return false;
  if (QTY_UNIT_WORDS.has(n)) return true;
  const stripped = n.replace(/^[0-9]/, "");
  return !!stripped && stripped !== n && QTY_UNIT_WORDS.has(stripped);
}

function isSizeBreak(head: string): boolean {
  const h = head.trim();
  return /[xX'"\u2019\u201d]$/.test(h) || /\d\s*[xX]$/.test(h);
}

/** Drop a leaked trailing qty + unit ("4.000 2CS", "5,000 CS", "1.000 deg-cs"). Keeps sizes such as 8'X135FT. */
export function stripTrailingQtyUnit(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) {
    const two = /^(.*)\s+([\d,]+(?:\.\d+)?)\s+(p)\s+(cs)\s*$/i.exec(t);
    if (two && two[1].trim() && !isSizeBreak(two[1])) {
      t = two[1].trim();
      continue;
    }
    const one = /^(.*)\s+([\d,]+(?:\.\d+)?)\s+(\S+)\s*$/.exec(t);
    if (one && one[1].trim() && isOcrQtyUnit(one[3]) && !isSizeBreak(one[1])) {
      t = one[1].trim();
      continue;
    }
    break;
  }
  return t;
}

export function descriptionHasLeakedQtyUnit(s: string): boolean {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return !!t && stripTrailingQtyUnit(t) !== t;
}

const ITEM_NOUNS = /^(?:angles?|channels?|sheets?|plates?|pipes?|beams?|rods?|bars?|flats?|tubes?|coils?|wires?|strips?|joists?|girders?)\b/i;
const KEEP_LEADING_PREFIX = /^(?:ms|hr|cr|gi|ss|gp|cg|tmt|hysd|ctd|tor|isi|isa|ismc|ismb|isjb|mc|mb|ub|uc|upvc|cpvc|pvc|hdpe|ppr|hsd|tata|sail|jsw|jindal)$/i;

/** Leading S.N. / row marks (fr208, 12., 12) and short OCR junk before a known item noun (Lil ANGLE). Conservative: keep 2-letter grade prefixes such as HE, MS, HR. */
export function stripLeadingOcrJunk(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:s\.?\s*n\.?|sl\.?|no\.?)[\s.:#-]*/i, "");
  t = t.replace(/^(?:#\s*)?(?:[a-z]{1,3})?\d{1,4}[a-z]?[.)]?(?=\s)/i, "");
  t = t.replace(/^\s+/, "");
  const m = /^([A-Za-z]{3,4})\s+(.+)$/.exec(t);
  if (m && !KEEP_LEADING_PREFIX.test(m[1]) && ITEM_NOUNS.test(m[2])) t = m[2];
  return t;
}

/** "3 SMM" / "3SMM" -> "3.5MM" (S misread as 5). Does not change "3.5SMM" or a lone "SMM". */
export function restoreSmmAsFiveMm(s: string): string {
  return s
    .replace(/(\d)\s+SMM\b/gi, "$1.5MM")
    .replace(/(?<![\d.])(\d)SMM\b/gi, "$1.5MM");
}

/** Drop trailing zeros after the decimal (4.000 -> 4, 4.500 -> 4.5). Keeps up to 3 significant decimals (65.663). */
export function canonicalOcrQty(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(n.toFixed(3));
}

/**
 * Parse a qty token. "4.000" -> 4, "4.500" -> 4.5.
 * "5,000" (comma, 3 digits): treat as 5 (qty decimals 5.000) unless rate*qty ~= amount prefers 5000.
 */
export function parseOcrQtyToken(raw: string, ctx?: { rate?: number; amount?: number }): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const candidates: number[] = [];
  const add = (v: number) => {
    if (Number.isFinite(v) && v > 0 && !candidates.includes(v)) candidates.push(v);
  };
  const comma3 = /^(\d{1,3}),(\d{3})$/.exec(s);
  if (comma3) {
    add(Number(comma3[1]));
    add(Number(comma3[1] + comma3[2]));
    add(Number(`${comma3[1]}.${comma3[2]}`));
  }
  if (/^\d{1,12}(?:\.\d{1,4})?$/.test(s)) add(Number(s));
  const strict = parseStrictAmount(s);
  if (strict != null) add(strict);

  const rate = ctx?.rate;
  const amount = ctx?.amount;
  if (rate && amount && rate > 0 && candidates.length) {
    const tol = Math.max(0.6, 0.005 * amount);
    const fit = candidates.filter((q) => Math.abs(q * rate - amount) <= tol);
    if (fit.length === 1) return canonicalOcrQty(fit[0]);
    if (fit.length > 1) {
      fit.sort((a, b) => Math.abs(a * rate - amount) - Math.abs(b * rate - amount));
      return canonicalOcrQty(fit[0]);
    }
  }
  if (comma3) return canonicalOcrQty(Number(comma3[1]));
  if (candidates.length) return canonicalOcrQty(candidates[0]);
  return null;
}

/** Restore a size decimal OCR often drops ("3 5MM" / "3,5 mm" -> "3.5MM"). Does not change "35MM". */
export function restoreItemSizeDecimal(s: string): string {
  return s
    .replace(/(\d)\s+(\d{1,2})\s*(mm)\b/gi, "$1.$2MM")
    .replace(/(\d)\s*,\s*(\d{1,2})\s*(mm)\b/gi, "$1.$2MM")
    .replace(/(\d+[.,]\d{1,2})\s*(mm)\b/gi, (_m, n: string) => `${String(n).replace(",", ".")}MM`);
}

/**
 * OCR sometimes reads the "x" of a 3-part size as "%" ("ANGLE 40x40%5" -> "ANGLE 40x40x5").
 * Only touches N?N?N size patterns (separators x/X/A-/%) that contain a "%"; a lone "13%" or "5%" is unchanged.
 */
export function restoreItemSizeSeparators(s: string): string {
  return s.replace(
    /(\d+(?:\.\d+)?)\s*([xX\u00D7%])\s*(\d+(?:\.\d+)?)\s*([xX\u00D7%])\s*(\d+(?:\.\d+)?)(?![\d.]*\s*%)/g,
    (m: string, a: string, s1: string, b: string, s2: string, c: string) => {
      if (s1 !== "%" && s2 !== "%") return m;
      const x = s1 === "X" || s2 === "X" ? "X" : "x";
      return `${a}${s1 === "%" ? x : s1}${b}${s2 === "%" ? x : s2}${c}`;
    }
  );
}

/** Restore size decimals and strip a leaked trailing qty+unit. Keeps bill codes such as <HSD>. */
export function normalizeItemDescription(desc: string): string {
  let s = stripLeadingOcrJunk(desc.replace(/\s+/g, " ").trim());
  s = restoreItemSizeDecimal(restoreSmmAsFiveMm(restoreItemSizeSeparators(s)));
  s = stripTrailingQtyUnit(s).replace(/\s+/g, " ").trim();
  return s || desc.trim();
}

/** "(Diesel <HSD>" -> "Diesel": drop leading punctuation, bracketed codes, leaked qty/unit; keep size. */
export function cleanItemName(desc: string): string {
  let s = desc.replace(/<[^>]*>?/g, " ").replace(/\([^)]*\)/g, " ").replace(/^[^\p{L}\d]+/u, "").replace(/[^\p{L}\d)"'\u2019]+$/u, "").replace(/\s+/g, " ").trim();
  s = normalizeItemDescription(s);
  return s || desc.trim();
}

export type InferredItemGroup = { parentName: "Sheet" | "Angles"; size: string };

/**
 * Sheet or Plate followed by a size like 3.5MM / 12MM -> parent "Sheet", child the size.
 * Angle followed by a size like 40x40x5 -> parent "Angles", child "Angle 40x40x5".
 */
export function inferItemGroupFromName(raw: string): InferredItemGroup | null {
  const name = cleanItemName(raw);
  const kind = /\b(?:sheets?|plates?)\b/i.exec(name);
  if (!kind || kind.index == null) return inferAngleGroup(name);
  const after = name.slice(kind.index + kind[0].length);
  const size = /\b(\d+(?:\.\d+)?)MM\b/i.exec(after);
  if (!size) return null;
  return { parentName: "Sheet", size: `${size[1]}MM` };
}

function inferAngleGroup(name: string): InferredItemGroup | null {
  const kind = /\bangles?\b/i.exec(name);
  if (!kind || kind.index == null) return null;
  const after = name.slice(kind.index + kind[0].length);
  const size = /\b\d+(?:\.\d+)?(?:\s*[xX×*]\s*\d+(?:\.\d+)?){1,2}\b/.exec(after);
  if (!size) return null;
  return { parentName: "Angles", size: `Angle ${size[0].replace(/\s*[xX×*]\s*/g, "x")}` };
}

/** Other PANs printed on the bill (9 digits), excluding ours - fallback counter-party when the parsed party was our own company. */
export function otherPans(text: string, ownPan?: string | null): string[] {
  const own = String(ownPan ?? "").replace(/\D/g, "");
  const out: string[] = [];
  // only lines carrying a PAN / VAT No label (HSN codes and phone numbers are 9 digits too)
  for (const line of text.split(/\r?\n/)) {
    if (!/pan|vat|पान|स्थायी/i.test(line)) continue;
    for (const m of line.matchAll(/(?<!\d)(\d{9})(?!\d)/g)) if (m[1] !== own && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** VAT % from the bill (VAT / taxable), defaulting to Nepal's 13%. */
export function billVatPercent(vat?: number, taxable?: number): number {
  if (vat && taxable && taxable > 0) {
    const p = Math.round((vat / taxable) * 100);
    if (p > 0 && p <= 30) return p;
  }
  return 13;
}

/** Bill party name -> clean account name (drop "M/s", stray punctuation, ALL CAPS -> Title Case). */
export function cleanPartyName(raw: string): string {
  let s = raw.replace(/^\s*(m\s*\/\s*s\.?|messrs\.?)\s*/i, "").replace(/[|_:;,.\-\s]+$/g, "").replace(/^[^\p{L}\d]+/u, "").replace(/\s+/g, " ").trim();
  if (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s)) s = s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

/** Create Party prefill: cleaned name + raw bill text as Alias Name when they differ. */
export function partyNamePrefill(raw: string | undefined | null): { name: string; aliasName: string } {
  const r = String(raw ?? "").replace(/\s+/g, " ").trim();
  const name = cleanPartyName(r);
  return { name, aliasName: r && r !== name ? r : "" };
}

/* ---------------- Item line unit (same rule as manual item pick in Sale/Purchase forms) ---------------- */
const UNIT_SYN: Record<string, string> = {
  l: "ltr", lt: "ltr", ltr: "ltr", ltrs: "ltr", litre: "ltr", litres: "ltr", liter: "ltr", liters: "ltr",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", no: "pcs",
  kg: "kg", kgs: "kg", kilo: "kg", kilogram: "kg", kilograms: "kg",
  g: "gm", gm: "gm", gms: "gm", gram: "gm", grams: "gm",
  mtr: "mtr", m: "mtr", meter: "mtr", metre: "mtr", meters: "mtr",
  box: "box", boxes: "box", bag: "bag", bags: "bag", set: "set", sets: "set", pkt: "pkt", packet: "pkt",
};
const unitKey = (u: string) => { const k = String(u ?? "").toLowerCase().replace(/[^a-z]/g, ""); return UNIT_SYN[k] ?? k; };

/**
 * Unit to write on an OCR line once its item is known. Manual pick in the forms sets
 * purchase: item.purchasePriceUnit || unitConversions[0].fromUnit; sale: item.salePriceUnit || unitConversions[0].fromUnit.
 * The bill's unit wins only when it is one of the item's own units (matched loosely: "Ltr" = "Liter"), written in the item's spelling.
 */
export function resolveOcrItemUnit(
  item: { purchasePriceUnit?: string | null; salePriceUnit?: string | null; unitConversions?: unknown } | null | undefined,
  billUnit: string | null | undefined,
  side: "purchase" | "sale"
): string {
  if (!item) return String(billUnit ?? "");
  const conv = (Array.isArray(item.unitConversions) ? item.unitConversions : []) as { fromUnit?: string; toUnit?: string }[];
  const units = [...new Set([item.purchasePriceUnit, item.salePriceUnit, ...conv.flatMap((c) => [c?.fromUnit, c?.toUnit])].filter((u): u is string => typeof u === "string" && !!u.trim()))];
  if (billUnit && billUnit.trim()) {
    const hit = units.find((u) => unitKey(u) === unitKey(billUnit));
    if (hit) return hit;
  }
  const def = (side === "purchase" ? item.purchasePriceUnit : item.salePriceUnit) || conv[0]?.fromUnit || "";
  return def || String(billUnit ?? "");
}
