/** Sheet/size group lookup (no create, no delete). Run: npx tsx tests/ocr/itemGroupFindOrCreate.selftest.mts */
import { findExistingItemByName, itemNamesMatch } from "../../src/components/items/createItemSilent";
import { findExistingMasterGroup, mergeMasterGroups, type MasterGroupLike } from "../../src/lib/masterEntityGroupWrite";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

const stock = { id: "stock_items", name: "Stock Items", parentId: null };
const sheetA = { id: "sheet-a", name: "Sheet", parentId: "stock_items" };
const child12 = { id: "sz-12", name: "12MM", parentId: "sheet-a" };
const sheetB = { id: "sheet-b", name: "Sheet", parentId: "stock_items" };
const child3 = { id: "sz-3", name: "3MM", parentId: "sheet-b" };

eq("finds Sheet under Stock Items (case/space)", findExistingMasterGroup([stock, sheetA, child12], "  sheet ", "stock_items")?.id, "sheet-a");
eq("finds Sheet at stock-items level even if parent id is the Stock Items row name-match", findExistingMasterGroup([stock, { id: "sheet-x", name: "SHEET", parentId: "stock_items" }], "Sheet", "stock_items")?.id, "sheet-x");
eq("prefers the Sheet under Stock Items over a nested Sheet", findExistingMasterGroup([
  stock, sheetA, child12, { id: "sheet-nested", name: "Sheet", parentId: "sz-12" },
], "Sheet", "stock_items")?.id, "sheet-a");
eq("size child under that parent", findExistingMasterGroup([sheetA, child12, child3], "12MM", "sheet-a")?.id, "sz-12");
eq("size child is not taken from a different parent when the chosen parent has it", findExistingMasterGroup([sheetA, sheetB, child12, child3], "12MM", "sheet-a")?.id, "sz-12");
eq("same-name size under another Sheet is reused rather than missing", findExistingMasterGroup([sheetA, sheetB, child3], "3MM", "sheet-a")?.id, "sz-3");
eq("unknown size is not found", findExistingMasterGroup([sheetA, child12], "3MM", "sheet-a"), undefined);

const merged = mergeMasterGroups(
  [sheetA, child12],
  [stock, sheetA, child12],
  [sheetB, child3],
);
eq("merge unions by id, keeps just-created groups", merged.map((g) => g.id).sort(), ["sheet-a", "sheet-b", "sz-12", "sz-3", "stock_items"].sort());
eq("merge does not invent a third Sheet", merged.filter((g) => String(g.name).toLowerCase() === "sheet").map((g) => g.id).sort(), ["sheet-a", "sheet-b"].sort());

eq("item name match is normalized", itemNamesMatch("HR  SHEET 3MM", "hr sheet 3mm"), true);
eq("find existing item by normalized name (skip deleted)", findExistingItemByName([
  { id: "old", name: "HR SHEET 3MM", isDeleted: true },
  { id: "live", name: "hr sheet 3mm" },
], "HR SHEET 3MM")?.id, "live");
eq("no item match", findExistingItemByName([{ id: "x", name: "MS PLATE 12MM" }], "HR SHEET 3MM"), undefined);

const _unused: MasterGroupLike[] = [];
void _unused;

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
