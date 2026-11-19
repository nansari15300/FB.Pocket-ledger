import assert from "node:assert/strict";
import { adToBs, bsToAd, getBSMonthDays } from "../../src/lib/bs-date";
import {
  COMPANY_DOC_DATE_FILTER_INTRO,
  COMPANY_DOC_MIN_VISIBLE_FILES,
  companyDocDateFilterIntro,
  countCompanyDocFilesByMonthWindow,
  defaultCompanyDocMonthRange,
  endOfLocalDay,
  parseCompanyDocVoucherDate,
  selectCompanyDocFilesByDateRule,
  startOfLocalDay,
} from "../../src/modules/ocr/companyDocDateWindow";

assert.equal(COMPANY_DOC_MIN_VISIBLE_FILES, 20);

const now = new Date(2026, 10, 19, 9, 44, 0); // 19 Nov 2026
const adMonth = defaultCompanyDocMonthRange(now, "AD");
assert.equal(adMonth.from.getTime(), startOfLocalDay(new Date(2026, 10, 1)).getTime());
assert.equal(adMonth.to.getTime(), endOfLocalDay(new Date(2026, 10, 30)).getTime());

const bs = adToBs(now);
const bsMonth = defaultCompanyDocMonthRange(now, "BS");
const bsDays = getBSMonthDays(bs.y)[bs.m - 1] ?? 30;
assert.equal(bsMonth.from.getTime(), startOfLocalDay(bsToAd({ y: bs.y, m: bs.m, d: 1 })).getTime());
assert.equal(bsMonth.to.getTime(), endOfLocalDay(bsToAd({ y: bs.y, m: bs.m, d: bsDays })).getTime());
assert.deepEqual(defaultCompanyDocMonthRange(now, "Both"), defaultCompanyDocMonthRange(now, "BS"));

const monthFromMs = adMonth.from.getTime();
const monthToMs = adMonth.to.getTime();

function file(id: string, date: Date) {
  return { id, dateMs: date.getTime() };
}

function ids(rows: Array<{ id: string }>) {
  return rows.map((row) => row.id);
}

const nov5 = new Date(2026, 10, 5, 10, 0, 0);
const nov18 = new Date(2026, 10, 18, 16, 0, 0);
const nov19 = new Date(2026, 10, 19, 8, 0, 0);
const oct31 = new Date(2026, 9, 31, 12, 0, 0);
const oct15 = new Date(2026, 9, 15, 9, 0, 0);
const jul2023 = new Date(2023, 7, 4, 10, 0, 0); // other FY
const dec1 = new Date(2026, 11, 1, 9, 0, 0); // next month, must stay out of default

const earlier30 = Array.from({ length: 30 }, (_, i) =>
  file(`old-${String(i + 1).padStart(2, "0")}`, new Date(2026, 9, 30 - i, 12, 0, 0)),
);

// This month has exactly 20 — only those 20, even if earlier files exist.
{
  const thisMonth = Array.from({ length: 20 }, (_, i) =>
    file(`nov-${String(i + 1).padStart(2, "0")}`, new Date(2026, 10, 1 + i, 10, 0, 0)),
  );
  const result = selectCompanyDocFilesByDateRule([...thisMonth, ...earlier30], {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.thisMonthCount, 20);
  assert.equal(result.earlierFilledCount, 0);
  assert.equal(result.filledFromEarlier, false);
  assert.deepEqual(ids(result.selected), ids(thisMonth).sort((a, b) => b.localeCompare(a)));
}

// This month has 25 — show all 25, do not cap at 20 or add earlier.
{
  const thisMonth = Array.from({ length: 25 }, (_, i) =>
    file(`nov-${String(i + 1).padStart(2, "0")}`, new Date(2026, 10, 1 + (i % 28), 11, 0, 0)),
  );
  const result = selectCompanyDocFilesByDateRule([...thisMonth, file("oct", oct31)], {
    mode: "default-month",
    now,
    dateSystem: "AD",
  });
  assert.equal(result.selected.length, 25);
  assert.equal(result.thisMonthCount, 25);
  assert.equal(result.filledFromEarlier, false);
  assert.ok(result.selected.every((row) => row.id.startsWith("nov-")));
}

// This month has 5, many earlier — 5 + 15 newest earlier = 20.
{
  const thisMonth = [
    file("nov-19", nov19),
    file("nov-18", nov18),
    file("nov-05", nov5),
    file("nov-05b", nov5),
    file("nov-05c", new Date(2026, 10, 5, 9, 0, 0)),
  ];
  const result = selectCompanyDocFilesByDateRule([...thisMonth, ...earlier30, file("future", dec1)], {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.thisMonthCount, 5);
  assert.equal(result.earlierFilledCount, 15);
  assert.equal(result.selected.length, 20);
  assert.equal(result.filledFromEarlier, true);
  assert.deepEqual(
    ids(result.selected).filter((id) => id.startsWith("old-")),
    earlier30.slice(0, 15).map((row) => row.id),
  );
  assert.ok(!result.selected.some((row) => row.id === "future"));
  // Newest first overall: 19 Nov, then 18 Nov, then 5 Nov files, then 31 Oct...
  assert.equal(result.selected[0].id, "nov-19");
  assert.equal(result.selected[1].id, "nov-18");
  assert.equal(result.selected[2].id, "nov-05"); // same day as nov-05, later id? nov-05 vs nov-05b — same date, id localeCompare: "nov-05" < "nov-05b" so nov-05b is after nov-05 if equal date? localeCompare: nov-05 < nov-05b, cmp returns a.id.localeCompare so smaller id first when dates equal? Wait we want newest first; same date then id. "nov-05".localeCompare("nov-05b") is negative, so nov-05 comes first.
}

// Same-date earlier files stop at exactly 20 (may split a day).
{
  const thisMonth = [file("nov-19", nov19)];
  const sameMorning = Array.from({ length: 25 }, (_, i) =>
    file(`oct-same-${String(i + 1).padStart(2, "0")}`, new Date(2026, 9, 20, 10, 0, 0)),
  );
  const result = selectCompanyDocFilesByDateRule([...thisMonth, ...sameMorning], {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.selected.length, 20);
  assert.equal(result.earlierFilledCount, 19);
}

// This month has 1, company has 16 including other FY — show all 16.
{
  const files = [
    file("nov-only", nov19),
    ...Array.from({ length: 11 }, (_, i) => file(`fy-now-${i + 1}`, new Date(2026, 9, 20 - i, 8, 0, 0))),
    file("PUR-80-81-001", jul2023),
    file("Sale-80-81-002", new Date(2023, 8, 1, 9, 0, 0)),
    file("Sale-80-81-003", new Date(2023, 8, 2, 9, 0, 0)),
    file("PUR-81-82-001", new Date(2024, 7, 10, 9, 0, 0)),
  ];
  const result = selectCompanyDocFilesByDateRule(files, {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.selected.length, 16);
  assert.equal(result.thisMonthCount, 1);
  assert.equal(result.earlierFilledCount, 15);
  assert.ok(result.selected.some((row) => row.id === "PUR-80-81-001"));
  assert.equal(result.selected[0].id, "nov-only");
}

// This month empty, 10 earlier — show all 10.
{
  const result = selectCompanyDocFilesByDateRule(earlier30.slice(0, 10), {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.selected.length, 10);
  assert.equal(result.thisMonthCount, 0);
  assert.equal(result.filledFromEarlier, true);
}

// This month empty, 25 earlier — 20 newest earlier only.
{
  const result = selectCompanyDocFilesByDateRule(earlier30.slice(0, 25), {
    mode: "default-month",
    monthFromMs,
    monthToMs,
  });
  assert.equal(result.selected.length, 20);
  assert.deepEqual(ids(result.selected), earlier30.slice(0, 20).map((row) => row.id));
}

// Next-month files never enter the default window, even when we need fill.
{
  const result = selectCompanyDocFilesByDateRule(
    [file("nov", nov19), file("future-1", dec1), file("future-2", new Date(2026, 11, 5))],
    { mode: "default-month", monthFromMs, monthToMs },
  );
  assert.deepEqual(ids(result.selected), ["nov"]);
}

// Invalid dates are skipped.
{
  const result = selectCompanyDocFilesByDateRule(
    [file("nov", nov19), { id: "bad", dateMs: Number.NaN }, { id: "also-bad", dateMs: Number.POSITIVE_INFINITY }],
    { mode: "default-month", monthFromMs, monthToMs },
  );
  assert.deepEqual(ids(result.selected), ["nov"]);
}

assert.equal(parseCompanyDocVoucherDate(nov19)?.getTime(), nov19.getTime());
assert.equal(parseCompanyDocVoucherDate(nov19.getTime())?.getTime(), nov19.getTime());
assert.equal(parseCompanyDocVoucherDate({ seconds: nov19.getTime() / 1000 })?.getTime(), nov19.getTime());
assert.equal(parseCompanyDocVoucherDate({ toDate: () => nov19 })?.getTime(), nov19.getTime());
assert.equal(parseCompanyDocVoucherDate(null), null);
assert.equal(parseCompanyDocVoucherDate("not a date"), null);

// Custom range: exact window, no min-20 fill, no cap when more than 20.
{
  const customFrom = startOfLocalDay(new Date(2026, 10, 18)).getTime();
  const customTo = endOfLocalDay(new Date(2026, 10, 18)).getTime();
  const files = [
    file("on-day", nov18),
    file("on-day-2", new Date(2026, 10, 18, 21, 0, 0)),
    file("this-month-other", nov5),
    file("earlier", oct15),
    ...Array.from({ length: 30 }, (_, i) => file(`flood-${i}`, new Date(2026, 10, 18, 1, i, 0))),
  ];
  const result = selectCompanyDocFilesByDateRule(files, {
    mode: "custom-range",
    customFromMs: customFrom,
    customToMs: customTo,
  });
  assert.equal(result.selected.length, 32);
  assert.equal(result.filledFromEarlier, false);
  assert.ok(!result.selected.some((row) => row.id === "this-month-other" || row.id === "earlier"));
  assert.equal(result.selected[0].id, "on-day-2");
}

// Custom range with only one file, or none, stays exact.
{
  const customFrom = startOfLocalDay(oct15).getTime();
  const customTo = endOfLocalDay(oct15).getTime();
  const one = selectCompanyDocFilesByDateRule(
    [file("hit", oct15), file("nov", nov19), file("oct31", oct31)],
    { mode: "custom-range", customFromMs: customFrom, customToMs: customTo },
  );
  assert.deepEqual(ids(one.selected), ["hit"]);
  const empty = selectCompanyDocFilesByDateRule([file("nov", nov19)], {
    mode: "custom-range",
    customFromMs: customFrom,
    customToMs: customTo,
  });
  assert.deepEqual(ids(empty.selected), []);
}

const counts = countCompanyDocFilesByMonthWindow(
  [file("nov", nov19), file("oct", oct31), file("future", dec1), { id: "bad", dateMs: Number.NaN }],
  monthFromMs,
  monthToMs,
);
assert.deepEqual(counts, { thisMonth: 1, earlier: 1 });

assert.equal(companyDocDateFilterIntro("en"), COMPANY_DOC_DATE_FILTER_INTRO.en);
assert.equal(companyDocDateFilterIntro("hi"), COMPANY_DOC_DATE_FILTER_INTRO.hi);
assert.equal(companyDocDateFilterIntro("ne"), COMPANY_DOC_DATE_FILTER_INTRO.ne);
assert.equal(companyDocDateFilterIntro("fr"), COMPANY_DOC_DATE_FILTER_INTRO.en);
assert.equal(companyDocDateFilterIntro(undefined), COMPANY_DOC_DATE_FILTER_INTRO.en);
assert.match(COMPANY_DOC_DATE_FILTER_INTRO.en, /this month/i);
assert.match(COMPANY_DOC_DATE_FILTER_INTRO.en, /20/);
assert.match(COMPANY_DOC_DATE_FILTER_INTRO.hi, /20/);
assert.match(COMPANY_DOC_DATE_FILTER_INTRO.ne, /२०/);
assert.match(COMPANY_DOC_DATE_FILTER_INTRO.en, /kept exactly|pick yourself/i);

console.log("companyDocDateWindow selftest: OK");
