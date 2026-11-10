/** Item purchase/sale unit-price rows + base conversions. Run: npx tsx tests/ocr/itemUnitPrices.selftest.mts */
import { baseUnitConversions, collectItemUnits, computeItemUnitPrices, normalizeItemUnitName } from "../../src/components/items/itemUnitPrices";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};
const close = (label: string, got: number, want: number, eps = 0.0001) => {
  const ok = Math.abs(got - want) < eps;
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + got + (ok ? "" : " want " + want));
};

eq("normalize kg -> Kg", normalizeItemUnitName("kg"), "Kg");
eq("identity conversion when only a unit is given", baseUnitConversions("Kg", []), [{ fromUnit: "Kg", toUnit: "Kg", conversionFactor: 1 }]);
eq("empty unit and no rows -> empty conversions", baseUnitConversions("", []), []);
eq("fills missing toUnit from fromUnit", baseUnitConversions("Kg", [{ fromUnit: "Kg", toUnit: "", conversionFactor: 1 }]), [{ fromUnit: "Kg", toUnit: "Kg", conversionFactor: 1 }]);
eq("keeps a real conversion chain", baseUnitConversions("Box", [{ fromUnit: "Box", toUnit: "Kg", conversionFactor: 10 }]), [{ fromUnit: "Box", toUnit: "Kg", conversionFactor: 10 }]);
eq("collect units includes price unit even if conversions empty", collectItemUnits([], ["Kg"]), ["Kg"]);

const ex = computeItemUnitPrices({
  conversions: [],
  purchasePrice: 93,
  purchasePriceUnit: "Kg",
  purchaseTaxRate: 13,
  purchaseInclusive: false,
  salePrice: 0,
  salePriceUnit: "Kg",
});
close("exclusive rate is the purchase price", ex.Kg.purchase, 93);
close("exclusive tax is 13% of rate", ex.Kg.purchaseTax, 93 * 0.13);
close("exclusive total is rate + tax", ex.Kg.purchase + ex.Kg.purchaseTax, 93 * 1.13);

const inc = computeItemUnitPrices({
  conversions: baseUnitConversions("Kg"),
  purchasePrice: 93,
  purchasePriceUnit: "Kg",
  purchaseTaxRate: 13,
  purchaseInclusive: true,
  salePrice: 0,
  salePriceUnit: "Kg",
});
const incRate = 93 / 1.13;
close("inclusive rate is price / (1+tax)", inc.Kg.purchase, incRate);
close("inclusive tax is rate * tax%", inc.Kg.purchaseTax, incRate * 0.13);
close("inclusive total equals the entered price", inc.Kg.purchase + inc.Kg.purchaseTax, 93);

const sale = computeItemUnitPrices({
  conversions: [],
  salePrice: 200,
  salePriceUnit: "Kg",
  saleTaxRate: 13,
  saleInclusive: false,
  purchasePrice: 0,
  purchasePriceUnit: "Kg",
});
close("sale exclusive rate", sale.Kg.sale, 200);
close("sale exclusive tax", sale.Kg.saleTax, 26);
close("sale exclusive total", sale.Kg.sale + sale.Kg.saleTax, 226);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
