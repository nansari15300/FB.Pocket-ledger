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

export function collectItemUnits(
  conversions: ItemUnitConversion[] | null | undefined,
  extraUnits: Array<string | null | undefined> = [],
): string[] {
  const set = new Set<string>();
  for (const raw of conversions ?? []) {
    const c = rowOf(raw);
    if (c.fromUnit) set.add(c.fromUnit);
    if (c.toUnit) set.add(c.toUnit);
  }
  for (const extra of extraUnits) {
    const n = String(extra ?? "").trim();
    if (n) set.add(n);
  }
  return [...set];
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
