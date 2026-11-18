/** Party ledger widen plan (2026-11-18). Run: npx tsx tests/fyPagination/entityWiden.selftest.mts */
import assert from "node:assert/strict";
import {
  entityVoucherStats,
  entityWidenAction,
  planEntityWidenFromMs,
  voucherDateToMs,
} from "../../src/lib/fyPagination/entityWidenPlan";
import { bumpFyScopeGeneration, currentFyScopeGeneration } from "../../src/lib/fyPagination/scopeGeneration";

const at = (iso: string) => new Date(iso).getTime();
const monthStart = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

// Date shapes seen in the local mirror / PocketBase rows.
const ms = 1690880251452;
assert.equal(voucherDateToMs(new Date(ms)), ms);
assert.equal(voucherDateToMs(ms), ms);
assert.equal(voucherDateToMs(new Date(ms).toISOString()), ms);
assert.equal(voucherDateToMs({ seconds: 1690880251, nanoseconds: 452000000 }), ms);
assert.equal(voucherDateToMs({ __fsTs: true, seconds: 1690880251, nanoseconds: 452000000 }), ms);
assert.equal(voucherDateToMs({ toDate: () => new Date(ms) }), ms);
assert.equal(voucherDateToMs(null), null);
assert.equal(voucherDateToMs("not a date"), null);

// Hydro Nepal case: one 2080 bill (2023-08-01) and one 2083 bill (2026-08-01); a deleted one older still.
const HYDRO = "party_mwltqakf_2b4a1679-756";
const vouchers = [
  { id: "v1", partyId: HYDRO, date: { seconds: at("2023-08-01T08:30:00Z") / 1000 } },
  { id: "v3", partyId: HYDRO, date: { seconds: at("2026-08-01T10:51:00Z") / 1000 } },
  { id: "vdel", partyId: HYDRO, isDeleted: true, date: { seconds: at("2020-01-01T00:00:00Z") / 1000 } },
  { id: "other", partyId: "party_x", date: { seconds: at("2019-01-01T00:00:00Z") / 1000 } },
];
const stats = entityVoucherStats(vouchers, (v) => v.partyId === HYDRO);
assert.equal(stats.count, 2, "deleted and other-party vouchers are not counted");
assert.equal(stats.oldestMs, at("2023-08-01T08:30:00Z"), "oldest live party voucher");

// Scope sits at 1 Sep 2026 (default min-10 scope). Old walk stopped after 6 empty months (~Feb 2026).
const scopeFrom = monthStart("2026-09-15T12:00:00Z");
const jump = entityWidenAction({ scopeFromMs: scopeFrom, stats });
assert.equal(jump.kind, "jump");
assert.equal(jump.kind === "jump" && jump.fromMs, monthStart("2023-08-01T08:30:00Z"), "jumps straight to the 2080 bill month");
assert.ok(jump.kind === "jump" && jump.fromMs <= stats.oldestMs!, "jump start covers the oldest voucher");

// Asian Thai: only a 2080 bill, nothing recent -> still jumps (old walk gave up after 6 empty months).
const asian = entityVoucherStats(
  [{ partyId: "asian", date: new Date("2023-08-22T10:48:37Z") }],
  (v) => v.partyId === "asian"
);
const asianPlan = entityWidenAction({ scopeFromMs: scopeFrom, stats: asian });
assert.equal(asianPlan.kind, "jump");
assert.equal(asianPlan.kind === "jump" && asianPlan.fromMs, monthStart("2023-08-22T10:48:37Z"));

// All party vouchers already inside scope -> nothing to do.
assert.deepEqual(
  entityWidenAction({ scopeFromMs: monthStart("2023-07-10T00:00:00Z"), stats }),
  { kind: "done" }
);
// No local rows (partial Firebase mirror) -> keep the old month walk.
assert.deepEqual(entityWidenAction({ scopeFromMs: scopeFrom, stats: { count: 0, oldestMs: null } }), { kind: "walk" });
assert.deepEqual(entityWidenAction({ scopeFromMs: scopeFrom, stats: null }), { kind: "walk" });

// Calendar floor clamp.
const floor = at("2024-01-01T00:00:00Z");
assert.equal(planEntityWidenFromMs({ scopeFromMs: scopeFrom, oldestEntityMs: at("2023-08-01T00:00:00Z"), floorMs: floor }), floor);
assert.equal(planEntityWidenFromMs({ scopeFromMs: floor, oldestEntityMs: at("2023-08-01T00:00:00Z"), floorMs: floor }), null);

// Scope generation: a date-range load bumps it so an in-flight widen stops.
const g0 = currentFyScopeGeneration("c1");
assert.equal(bumpFyScopeGeneration("c1"), g0 + 1);
assert.equal(currentFyScopeGeneration("c1"), g0 + 1);
assert.equal(currentFyScopeGeneration("c2"), 0, "per company");

console.log("entityWiden selftest: all passed");
