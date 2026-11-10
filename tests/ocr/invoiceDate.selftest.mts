/**
 * Bill SI-00780 prints both INVOICE DATE 12/08/2026 (AD, actually MM/DD = 2026-08-12)
 * and INVOICE MITI 27/04/2083 (BS). The old parser stopped at the first labeled date,
 * treated 12/08/2026 as DD/MM-vs-MM/DD ambiguous (NaN), and never filled the form date
 * (it stayed on today). Resolve by cross-checking AD against BS with bsToAd/adToBs.
 * Fixture text is taken from the real photo /workspace/ocr-bills/pratik-SI-00780.png.
 * Run: npx tsx tests/ocr/invoiceDate.selftest.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adToBs, bsToAd } from "../../src/lib/bs-date";
import { defaultVoucherDateWindow, localYmd, parseDocDates, resolveBillDate } from "../../src/lib/ocr/dates";
import { parseBill } from "../../src/modules/ocr/parser";
import type { OcrRawResult } from "../../src/modules/ocr/types";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; for (const d of dbg ?? []) console.log("   dbg:", d); }
};
const raw = (text: string): OcrRawResult => {
  const lines = text.split(/\r?\n/).filter((t) => t.trim());
  return { text, lines: lines.map((t, i) => ({ text: t, confidence: 80, y: 40 + i * 30 })), meanConfidence: 80, pageHeight: 40 + 30 * Math.max(20, lines.length) };
};
const parse = (text: string) =>
  parseBill(raw(text), { kind: "purchase" as never, parties: [], items: [], ownPan: "303687786", ownName: "New parsa Engineering WorkShop Demo Company" });

const ad = bsToAd({ y: 2083, m: 4, d: 27 });
ok(localYmd(ad) === "2026-08-12", `converter: 2083-04-27 BS -> 2026-08-12 AD (got ${localYmd(ad)})`);
const bsBack = adToBs(new Date(2026, 7, 12));
ok(bsBack.y === 2083 && bsBack.m === 4 && bsBack.d === 27, `converter: 2026-08-12 AD -> 2083-04-27 BS (got ${bsBack.y}-${bsBack.m}-${bsBack.d})`);
ok(!(adToBs(new Date(2026, 11, 8)).m === 4 && adToBs(new Date(2026, 11, 8)).d === 27), "12/08/2026 as DD/MM (Dec 8) does NOT equal Miti 27/04/2083");

const window = defaultVoucherDateWindow(new Date(2026, 10, 10)); // 10 Nov 2026

{
  const r = resolveBillDate("INVOICE DATE : 12/08/2026 7:04:00PM\nINVOICE MITI : 27/04/2083", window);
  ok(!!r && localYmd(r.date) === "2026-08-12" && r.status === "fill", `both labels: 12/08/2026 is MM/DD because it agrees with Miti 27/04/2083: ${r ? `${localYmd(r.date)} ${r.status} ${r.via}` : "null"}`);
  ok(r?.via === "ad+bs-agree", `via ad+bs-agree: ${r?.via}`);
}
{
  const r = resolveBillDate("INVOICE MITI : 27/04/2083", window);
  ok(!!r && localYmd(r.date) === "2026-08-12" && r.status === "fill", `miti only: ${r ? `${localYmd(r.date)} ${r.status} ${r.via}` : "null"}`);
}
{
  const r = resolveBillDate("INVOICE DATE : 12/08/2026 7:04:00PM", window);
  ok(!!r && localYmd(r.date) === "2026-08-12" && r.status === "fill", `AD only, Dec 8 is out of window, Aug 12 is in: ${r ? `${localYmd(r.date)} ${r.status} ${r.note ?? r.via}` : "null"}`);
}
{
  const r = resolveBillDate("Invoice Mit1 : 15/07/2083\nDat3 : 01/11/2026", window);
  ok(!!r && localYmd(r.date) === "2026-11-01" && r.status === "fill", `bright-photo labels Mit1 + Dat3 still resolve to 2026-11-01: ${r ? `${localYmd(r.date)} ${r.status}` : "null"}`);
}

const text = fx("pratik-SI-00780-real.txt");
ok(/INVOICE DATE\s*:?\s*12\/08\/2026/i.test(text) && /INVOICE MITI\s*:?\s*27\/04\/2083/i.test(text), "fixture has both printed dates");
{
  const b = parse(text);
  ok(localYmd(b.date?.value) === "2026-08-12" && b.date?.status === "fill", `parseBill SI-00780 fills 2026-08-12 (not today, not flagged): ${localYmd(b.date?.value)} ${b.date?.status} ${b.date?.note ?? ""}`, b.debug);
  ok(b.billNo?.value === "SI-00780", `Bill No SI-00780: ${b.billNo?.value}`);
}

// Old parseDocDates still flags a lone 12/08/2026 as ambiguous (NaN) — bill resolve is what fills it.
{
  const old = parseDocDates("12/08/2026");
  ok(old.length >= 1 && (old[0].ambiguous || Number.isNaN(old[0].date.getTime())), "parseDocDates keeps 12/08/2026 ambiguous for non-bill callers");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
