import { parseSingleDocDate, parseDocDates } from "../../src/lib/ocr/dates";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

const d1 = parseSingleDocDate("06 Nov 2026 08:36 AM");
ok(!!d1 && d1.getFullYear() === 2026 && d1.getMonth() === 10 && d1.getDate() === 6, "06 Nov 2026 08:36 AM");

const d2 = parseSingleDocDate("06-Nov-2026 11:03:29");
ok(!!d2 && d2.getFullYear() === 2026 && d2.getMonth() === 10 && d2.getDate() === 6, "06-Nov-2026 11:03:29");

const d3 = parseSingleDocDate("17-Oct-2026 01:44:04 PM");
ok(!!d3 && d3.getFullYear() === 2026 && d3.getMonth() === 9 && d3.getDate() === 17, "17-Oct-2026");

const d4 = parseSingleDocDate("15/07/2083");
ok(!!d4 && !Number.isNaN(d4.getTime()), "15/07/2083 BS DMY parses to a Date");
const d4b = parseSingleDocDate("2083/07/15");
ok(!!d4 && !!d4b && d4.getTime() === d4b.getTime(), "15/07/2083 equals 2083/07/15");

const d5 = parseSingleDocDate("19-07-2083");
ok(!!d5 && !Number.isNaN(d5.getTime()), "19-07-2083 handwritten miti");

ok(parseDocDates("no date here").length === 0, "no date");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
