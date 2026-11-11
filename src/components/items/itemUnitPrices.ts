/** Purchase/Sale unit-price rows (same rules as CreateItemDialog). */

export type ItemUnitConversion = {
  fromUnit?: string;
  toUnit?: string;
  conversionFactor?: number | string;
};

export type ItemUnitPriceRow = {
  purchase: number;
  sale: number;
  purchaseTax: number;
  saleTax: number;
};

export function normalizeItemUnitName(unit: string | null | undefined): string {
  const u = String(unit ?? "").trim();
  if (!u) return "";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function rowOf(c: ItemUnitConversion): { fromUnit: string; toUnit: string; conversionFactor: number } {
  return {
    fromUnit: String(c?.fromUnit ?? "").trim(),
    toUnit: String(c?.toUnit ?? "").trim(),
    conversionFactor: Number(c?.conversionFactor ?? 1) || 1,
  };
}

/**
 * Create/Edit Item only fills Purchase/Sale Unit Prices when conversions[0].toUnit is set.
 * A single bill unit with no factor becomes an identity row (1 Kg = 1 Kg).
 */
export function baseUnitConversions(
  unit: string | null | undefined,
  existing?: ItemUnitConversion[] | null,
): { fromUnit: string; toUnit: string; conversionFactor: number }[] {
  const u = normalizeItemUnitName(unit);
  if (Array.isArray(existing) && existing.length > 0) {
    return existing.map((raw, i) => {
      const c = rowOf(raw);
      const fromUnit = c.fromUnit || (i === 0 ? u : "");
      const toUnit = c.toUnit || fromUnit;
      return { fromUnit, toUnit, conversionFactor: c.conversionFactor || 1 };
    }).filter((c) => c.fromUnit || c.toUnit);
  }
  if (!u) return [];
  return [{ fromUnit: u, toUnit: u, conversionFactor: 1 }];
}

/**
 * Item ki units sirf unitConversions se (order: pehli fromUnit → … → base unit). Trimmed, duplicate-free.
 * Price / low-stock / opening units yahan nahi jode jaate, taaki hatai gayi unit list me wapas na aaye.
 */
export function deriveItemUnits(conversions: ItemUnitConversion[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const raw of conversions ?? []) {
    const c = rowOf(raw);
    if (c.fromUnit) set.add(c.fromUnit);
    if (c.toUnit) set.add(c.toUnit);
  }
  return [...set];
}

/**
 * Conversions se units. `extraUnits` sirf tab use hote hain jab conversions me koi unit hi na ho
 * (legacy item bina conversion ke); warna chain ke bahar ki (stale) unit nahi judti.
 */
export function collectItemUnits(
  conversions: ItemUnitConversion[] | null | undefined,
  extraUnits: Array<string | null | undefined> = [],
): string[] {
  const units = deriveItemUnits(conversions);
  if (units.length) return units;
  const set = new Set<string>();
  for (const extra of extraUnits) {
    const n = String(extra ?? "").trim();
    if (n) set.add(n);
  }
  return [...set];
}

/**
 * Edit Item jaisa chain: row i>0 ka fromUnit = row i-1 ka toUnit (UI me yahi dikhta hai).
 * Poori khaali rows hat jaati hain. Names trimmed (case wahi).
 */
export function chainUnitConversions(
  conversions: ItemUnitConversion[] | null | undefined,
): { fromUnit: string; toUnit: string; conversionFactor: number }[] {
  const out: { fromUnit: string; toUnit: string; conversionFactor: number }[] = [];
  for (const raw of conversions ?? []) {
    const c = rowOf(raw);
    const fromUnit = out.length ? out[out.length - 1].toUnit : c.fromUnit;
    if (!fromUnit && !c.toUnit) continue;
    out.push({ fromUnit, toUnit: c.toUnit, conversionFactor: c.conversionFactor });
  }
  return out;
}

function taxExclusiveBase(price: number, taxRate: number, inclusive: boolean): number {
  const p = Number(price) || 0;
  if (!inclusive || !taxRate) return p;
  return parseFloat((p / (1 + taxRate / 100)).toFixed(10));
}

function factorDownToSmallest(
  startUnit: string,
  smallestUnit: string,
  conversions: { fromUnit: string; toUnit: string; conversionFactor: number }[],
): number {
  if (!startUnit || !smallestUnit || startUnit === smallestUnit) return 1;
  let factor = 1;
  let current = startUnit;
  const guard = new Set<string>();
  while (current !== smallestUnit) {
    if (guard.has(current)) return 0;
    guard.add(current);
    const conv = conversions.find((c) => c.fromUnit === current);
    if (!conv) return 0;
    factor *= conv.conversionFactor || 1;
    current = conv.toUnit;
  }
  return factor;
}

export function computeItemUnitPrices(opts: {
  conversions?: ItemUnitConversion[] | null;
  units?: string[];
  purchasePrice?: number | string | null;
  salePrice?: number | string | null;
  purchasePriceUnit?: string | null;
  salePriceUnit?: string | null;
  purchaseTaxRate?: number;
  saleTaxRate?: number;
  purchaseInclusive?: boolean;
  saleInclusive?: boolean;
}): Record<string, ItemUnitPriceRow> {
  const conversions = baseUnitConversions(
    opts.purchasePriceUnit || opts.salePriceUnit,
    opts.conversions,
  );
  const units = (opts.units && opts.units.length ? opts.units : collectItemUnits(conversions, [opts.purchasePriceUnit, opts.salePriceUnit])).filter(Boolean);
  const prices: Record<string, ItemUnitPriceRow> = {};
  if (!units.length) return prices;
  const smallestUnit = (conversions.length && conversions[conversions.length - 1].toUnit) || units[units.length - 1];
  if (!smallestUnit) return prices;

  const purchaseTaxRate = Number(opts.purchaseTaxRate) || 0;
  const saleTaxRate = Number(opts.saleTaxRate) || 0;
  let basePurchase = taxExclusiveBase(Number(opts.purchasePrice) || 0, purchaseTaxRate, !!opts.purchaseInclusive);
  let baseSale = taxExclusiveBase(Number(opts.salePrice) || 0, saleTaxRate, !!opts.saleInclusive);

  const downPurchase = factorDownToSmallest(String(opts.purchasePriceUnit ?? "").trim(), smallestUnit, conversions);
  if (opts.purchasePriceUnit && smallestUnit && opts.purchasePriceUnit !== smallestUnit) {
    basePurchase /= (downPurchase || 1);
  }
  const downSale = factorDownToSmallest(String(opts.salePriceUnit ?? "").trim(), smallestUnit, conversions);
  if (opts.salePriceUnit && smallestUnit && opts.salePriceUnit !== smallestUnit) {
    baseSale /= (downSale || 1);
  }

  for (const unit of units) {
    const factor = unit === smallestUnit ? 1 : factorDownToSmallest(unit, smallestUnit, conversions);
    const purchase = basePurchase * factor;
    const sale = baseSale * factor;
    prices[unit] = {
      purchase,
      sale,
      purchaseTax: purchase * (purchaseTaxRate / 100),
      saleTax: sale * (saleTaxRate / 100),
    };
  }
  return prices;
}

/** Item ka base unit = aakhri conversion ka toUnit (khaali ho to aakhri unit). */
export function itemBaseUnit(conversions: ItemUnitConversion[] | null | undefined): string {
  const rows = (conversions ?? []).map(rowOf);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].toUnit) return rows[i].toUnit;
  }
  const units = deriveItemUnits(conversions);
  return units[units.length - 1] || "";
}

export const ITEM_UNIT_FIELD_KEYS = [
  "purchasePriceUnit",
  "salePriceUnit",
  "lowStockWarningUnit",
  "openingBalanceUnit",
] as const;
export type ItemUnitFieldKey = (typeof ITEM_UNIT_FIELD_KEYS)[number];
export type ItemUnitFieldValues = Partial<Record<ItemUnitFieldKey, string | null | undefined>>;

/**
 * Selected units (purchase/sale price, low stock, opening stock) ko current unit set pe laao.
 * - Unit list me hai (pehla akshar case-insensitive) → list wali spelling.
 * - Hat gayi / list me nahi → base unit.
 * - Khaali ("") → khaali hi rahe.
 * - Conversions me koi unit nahi: whenNoUnits "clear" (default) → "", "keep" → jaisa hai.
 * Sirf `state` me di gayi keys check hoti hain; `patch` me sirf badli hui keys.
 */
export function normalizeItemUnits(
  conversions: ItemUnitConversion[] | null | undefined,
  state: ItemUnitFieldValues,
  opts: { whenNoUnits?: "clear" | "keep" } = {},
): {
  units: string[];
  baseUnit: string;
  values: Partial<Record<ItemUnitFieldKey, string>>;
  patch: Partial<Record<ItemUnitFieldKey, string>>;
} {
  const units = deriveItemUnits(conversions);
  const baseUnit = itemBaseUnit(conversions);
  const values: Partial<Record<ItemUnitFieldKey, string>> = {};
  const patch: Partial<Record<ItemUnitFieldKey, string>> = {};
  for (const key of ITEM_UNIT_FIELD_KEYS) {
    if (!(key in state)) continue;
    const original = String(state[key] ?? "");
    const current = original.trim();
    let next = current;
    if (current) {
      if (!units.length) {
        next = opts.whenNoUnits === "keep" ? current : "";
      } else if (!units.includes(current)) {
        const wanted = normalizeItemUnitName(current);
        next = units.find((u) => normalizeItemUnitName(u) === wanted) || baseUnit;
      }
    }
    values[key] = next;
    if (next !== original) patch[key] = next;
  }
  return { units, baseUnit, values, patch };
}

/**
 * Form values (load / save) par normalizeItemUnits lagao.
 * chain: true → row i>0 ka fromUnit = row i-1 ka toUnit (Edit Item jaisa; rows ki ginti same rehti hai).
 * Conversions me koi unit na ho to values jaise ke taise (legacy data na mite).
 */
export function normalizeItemUnitFields<T extends ItemUnitFieldValues & { unitConversions?: unknown }>(
  values: T,
  opts: { chain?: boolean } = {},
): T {
  const rows = Array.isArray(values.unitConversions) ? (values.unitConversions as ItemUnitConversion[]) : [];
  const synced = opts.chain
    ? rows.map((row, i) => (i === 0 ? row : { ...row, fromUnit: String(rows[i - 1]?.toUnit ?? "") }))
    : rows;
  const state: ItemUnitFieldValues = {};
  for (const key of ITEM_UNIT_FIELD_KEYS) {
    if (key in values) state[key] = values[key];
  }
  const { units, patch } = normalizeItemUnits(opts.chain ? chainUnitConversions(synced) : synced, state);
  if (!units.length) return values;
  return {
    ...values,
    ...(opts.chain ? { unitConversions: synced } : {}),
    ...patch,
  } as T;
}

/* ---------- Margin (Add/Edit Item, sirf UI; save nahi hota). Rate = tax ke bina. ---------- */

export type MarginMode = "amount" | "percent";
export type ParsedMargin = { mode: MarginMode; value: number };

function round2(n: number): number {
  return Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
}

/** "100" → amount 100, "10%" → percent 10. Khaali / adhoora ("-", "abc") → null. */
export function parseMargin(text: string | null | undefined): ParsedMargin | null {
  const s = String(text ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const isPercent = s.endsWith("%");
  const num = (isPercent ? s.slice(0, -1) : s).trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(num)) return null;
  const value = Number(num);
  if (!Number.isFinite(value)) return null;
  return { mode: isPercent ? "percent" : "amount", value };
}

/** Sale rate = purchase + amount, ya purchase × (1 + pct/100). 2 decimals. */
export function applyMargin(purchaseRate: number, margin: ParsedMargin): number {
  const p = Number(purchaseRate) || 0;
  return margin.mode === "percent" ? round2(p * (1 + margin.value / 100)) : round2(p + margin.value);
}

/** Margin wapas nikaalo. Percent me purchase 0 ho to null (blank). 2 decimals. */
export function deriveMargin(purchaseRate: number, saleRate: number, mode: MarginMode): number | null {
  const p = Number(purchaseRate) || 0;
  const s = Number(saleRate) || 0;
  if (mode === "percent") {
    if (!p) return null;
    return round2(((s - p) / p) * 100);
  }
  return round2(s - p);
}

export function formatMargin(value: number | null, mode: MarginMode): string {
  if (value == null || !Number.isFinite(value)) return "";
  return mode === "percent" ? `${value.toFixed(2)}%` : value.toFixed(2);
}

/**
 * Kisi unit ka sale rate (tax ke bina) `targetRate` chahiye → form ka `salePrice` (salePriceUnit me,
 * inclusive ho to tax sahit) kitna ho. Wahi computeItemUnitPrices path use hota hai, alag price logic nahi.
 * Chain toota ho (us unit ka rate 0) to null.
 */
export function salePriceForUnitRate(opts: {
  conversions?: ItemUnitConversion[] | null;
  units?: string[];
  unit: string;
  targetRate: number;
  salePriceUnit?: string | null;
  saleTaxRate?: number;
  saleInclusive?: boolean;
}): number | null {
  const base = { conversions: opts.conversions, units: opts.units, salePriceUnit: opts.salePriceUnit };
  const perOne = computeItemUnitPrices({ ...base, salePrice: 1, saleTaxRate: 0, saleInclusive: false })[opts.unit]?.sale;
  if (!perOne || !Number.isFinite(perOne)) return null;
  const taxMul = opts.saleInclusive ? 1 + (Number(opts.saleTaxRate) || 0) / 100 : 1;
  const exact = (Number(opts.targetRate) / perOne) * taxMul;
  if (!Number.isFinite(exact)) return null;
  const want = round2(Number(opts.targetRate));
  for (const decimals of [2, 4, 6]) {
    const candidate = Number(exact.toFixed(decimals));
    const rate = computeItemUnitPrices({
      ...base,
      salePrice: candidate,
      saleTaxRate: opts.saleTaxRate,
      saleInclusive: opts.saleInclusive,
    })[opts.unit]?.sale;
    if (rate != null && round2(rate) === want) return candidate;
  }
  return Number(exact.toFixed(6));
}

/** Rate tax ke bina (computeItemUnitPrices jaisa inclusive strip). */
export function rateWithoutTax(price: number | string | null | undefined, taxRate?: number, inclusive?: boolean): number {
  return taxExclusiveBase(Number(price) || 0, Number(taxRate) || 0, !!inclusive);
}

/**
 * Margin (amount / %) se form ka `salePrice` — Margin card aur Sale Price pills dono yahi use karte hain.
 * `unit` ka purchase rate (tax ke bina) + margin = us unit ka sale rate; phir salePriceForUnitRate.
 * Item me koi unit hi na ho to seedha rate (inclusive ho to tax jod kar). Percent + purchase 0 → null.
 */
export function salePriceFromMargin(opts: {
  conversions?: ItemUnitConversion[] | null;
  units?: string[];
  unit?: string | null;
  purchaseRate: number;
  margin: ParsedMargin;
  salePriceUnit?: string | null;
  saleTaxRate?: number;
  saleInclusive?: boolean;
}): number | null {
  const purchaseRate = Number(opts.purchaseRate) || 0;
  if (opts.margin.mode === "percent" && !purchaseRate) return null;
  const targetRate = applyMargin(purchaseRate, opts.margin);
  const unit = String(opts.unit ?? "").trim();
  if (unit) {
    const viaUnits = salePriceForUnitRate({
      conversions: opts.conversions,
      units: opts.units,
      unit,
      targetRate,
      salePriceUnit: opts.salePriceUnit,
      saleTaxRate: opts.saleTaxRate,
      saleInclusive: opts.saleInclusive,
    });
    if (viaUnits != null) return viaUnits;
    if (deriveItemUnits(opts.conversions).length) return null; // units hain par chain toota
  }
  const taxMul = opts.saleInclusive ? 1 + (Number(opts.saleTaxRate) || 0) / 100 : 1;
  return round2(targetRate * taxMul);
}
