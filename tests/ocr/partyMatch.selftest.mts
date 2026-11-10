/** Party token-coverage matching (OCR). Run: npx tsx tests/ocr/partyMatch.selftest.mts */
import { tokenCoverageScore } from "../../src/modules/ocr/fuzzy";
import { parseBill } from "../../src/modules/ocr/parser";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};
const ge = (label: string, got: number, min: number) => {
  const ok = got >= min;
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want >= " + JSON.stringify(min)));
};
const between = (label: string, got: number, lo: number, hi: number) => {
  const ok = got > lo && got < hi;
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : ` want (${lo}, ${hi})`));
};

const MASTER = "Pratik Trade Center Pvt.Ltd Safiullah";
const BILL = "PRATIK TRADE CENTER PVT.LTD.";

ge("main: bill Pvt.Ltd vs master with trailing Safiullah", tokenCoverageScore(BILL, MASTER), 0.95);
eq("main score is fill-level 1", tokenCoverageScore(BILL, MASTER), 1);
eq("Private/Limited vs Pvt.Ltd either side (bill legal form)", tokenCoverageScore("PRATIK TRADE CENTER PRIVATE LIMITED", MASTER), 1);
eq("Private/Limited vs Pvt.Ltd either side (master legal form)", tokenCoverageScore(BILL, "Pratik Trade Center Private Limited Safiullah"), 1);
eq("exact same name, mixed case/punct", tokenCoverageScore("pratik trade center pvt. ltd.", "Pratik Trade Center Pvt.Ltd"), 1);
between("short shared prefix only: PRATIK TRADE", tokenCoverageScore("PRATIK TRADE", MASTER), 0, 0.95);
eq("short prefix is suggestion-level 0.6", tokenCoverageScore("PRATIK TRADE", MASTER), 0.6);
between("diverge after shared prefix", tokenCoverageScore("PRATIK TRADE CONCERN PVT.LTD.", MASTER), 0, 0.95);
eq("diverge is suggestion-level 0.6", tokenCoverageScore("PRATIK TRADE CONCERN PVT.LTD.", MASTER), 0.6);
between("extra words on the bill only", tokenCoverageScore("PRATIK TRADE CENTER PVT.LTD. SAFIULLAH", "Pratik Trade Center Pvt.Ltd"), 0, 0.95);
eq("extra bill words are not fill", tokenCoverageScore("PRATIK TRADE CENTER PVT.LTD. SAFIULLAH", "Pratik Trade Center Pvt.Ltd") < 0.95, true);
eq("unrelated name", tokenCoverageScore("Shree Hardware", MASTER), 0);
eq("empty query", tokenCoverageScore("", MASTER), 0);
eq("whitespace candidate", tokenCoverageScore(BILL, "   "), 0);

const rawBill = (name: string) => {
  const text = [
    name,
    "Birgunj-10, Adarshanagar, Parsa",
    "Phone : 051-523456",
    "TAX INVOICE",
    "Invoice No : SI-02833 Date : 2083/07/15",
    "Customer Name : NEW PARSA ENGINEERING WORKSHOP",
    "Address : Birgunj, Parsa",
    "PAN No : 303687786",
    "Grand Total 47008.00",
  ].join("\n");
  return { text, meanConfidence: 90, lines: text.split("\n").map((t, i) => ({ text: t, confidence: 90, y: i * 20 })) };
};
const ctx = (parties: { id: string; name: string }[]) => ({ kind: "purchase" as const, parties, items: [], ownPan: "303687786", ownName: "New Parsa Engineering Workshop" });
const pratikMaster = { id: "pt1", name: MASTER };
{
  const r = parseBill(rawBill(BILL) as never, ctx([pratikMaster, { id: "other", name: "Shree Hardware" }]) as never);
  eq("parser: Pratik bill vs master with trailing Safiullah fills", r.partyId?.status === "fill" && r.partyId?.value === "pt1", true);
}
{
  const r = parseBill(rawBill("PRATIK TRADE") as never, ctx([pratikMaster, { id: "other", name: "Shree Hardware" }]) as never);
  eq("parser: short prefix is flag/suggestion only", r.partyId?.status === "flag" && r.partyId?.value === "pt1", true);
  eq("parser: short prefix does not auto-fill", r.partyId?.status !== "fill", true);
}
{
  const r = parseBill(rawBill(BILL) as never, ctx([
    { id: "pt1", name: MASTER },
    { id: "pt2", name: "Pratik Trade Center Pvt.Ltd Biratnagar" },
  ]) as never);
  eq("parser: two fill-level masters tie -> no fill", r.partyId?.status === "fill", false);
  eq("parser: two fill-level masters tie -> no single party value written as fill", r.partyId == null || r.partyId.status !== "fill", true);
}

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
