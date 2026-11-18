import assert from "node:assert/strict";
import {
  RECENT_OCR_DATE_FILTER_INTRO,
  collectRecentOcrPostedCalendarDates,
  filterRecentOcrByPostedDay,
  getRecentOcrPostedDate,
  isRecentOcrPostedOnDay,
  recentOcrDateFilterIntro,
  startOfLocalDay,
} from "../../src/modules/ocr/recentOcrPostedDate";

const voucherDay = new Date(2023, 7, 4, 10, 0, 0); // 2023-08-04, voucher date only
const postedToday = new Date(2026, 10, 18, 16, 25, 0);
const postedTodayLater = new Date(2026, 10, 18, 21, 5, 0);
const postedYesterday = new Date(2026, 10, 17, 8, 0, 0);
const today = new Date(2026, 10, 18, 9, 0, 0);

assert.equal(getRecentOcrPostedDate({ createdAt: postedToday, date: voucherDay })?.getTime(), postedToday.getTime());
assert.equal(
  getRecentOcrPostedDate({ date: voucherDay }, { createdAt: postedToday, date: voucherDay })?.getTime(),
  postedToday.getTime(),
);
assert.equal(getRecentOcrPostedDate({ date: voucherDay }, { date: voucherDay }), null);
assert.equal(getRecentOcrPostedDate({ createdAt: postedToday.getTime() })?.getTime(), postedToday.getTime());
assert.ok(isRecentOcrPostedOnDay(postedTodayLater, today));
assert.equal(isRecentOcrPostedOnDay(postedYesterday, today), false);
assert.equal(isRecentOcrPostedOnDay(null, today), false);

const rows = [
  { id: "a", createdAt: postedToday, date: voucherDay },
  { id: "b", createdAt: postedYesterday, date: today },
  { id: "c", date: today },
  { id: "d" },
];
const voucherById = new Map([["d", { createdAt: postedTodayLater }]]);
assert.deepEqual(
  filterRecentOcrByPostedDay(rows, today, voucherById).map((row) => row.id),
  ["a", "d"],
);
assert.deepEqual(
  collectRecentOcrPostedCalendarDates([
    { createdAt: postedToday, date: voucherDay },
    { createdAt: postedTodayLater, date: voucherDay },
    { createdAt: postedYesterday, date: today },
    { date: today },
  ]).map((date) => startOfLocalDay(date).getTime()).sort(),
  [startOfLocalDay(postedYesterday).getTime(), startOfLocalDay(postedToday).getTime()],
);

assert.equal(recentOcrDateFilterIntro("en"), RECENT_OCR_DATE_FILTER_INTRO.en);
assert.equal(recentOcrDateFilterIntro("hi"), RECENT_OCR_DATE_FILTER_INTRO.hi);
assert.equal(recentOcrDateFilterIntro("ne"), RECENT_OCR_DATE_FILTER_INTRO.ne);
assert.equal(recentOcrDateFilterIntro("fr"), RECENT_OCR_DATE_FILTER_INTRO.en);
assert.equal(recentOcrDateFilterIntro(undefined), RECENT_OCR_DATE_FILTER_INTRO.en);
assert.match(RECENT_OCR_DATE_FILTER_INTRO.en, /posted date/i);
assert.doesNotMatch(RECENT_OCR_DATE_FILTER_INTRO.en, /uses the voucher date/);
console.log("recentOcrPostedDate selftest: OK");
