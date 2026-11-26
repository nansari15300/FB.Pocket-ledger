/**
 * Pure tests for voucher allocations / fileUrls field merge.
 * Run: npx --yes tsx tests/sync/voucherFieldMerge.selftest.mts
 */
import {
  allocationStableKey,
  collectLocalFileRefs,
  mergeAllocationsLists,
  mergeFileUrlsLists,
  mergeVoucherConflictFields,
  stripLocalFileRefsDeep,
} from "../../src/lib/sync/voucherFieldMerge";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n  got:    ${sa}\n  expect: ${sb}`);
}

// keys
assert(allocationStableKey({ voucherId: "S1", entityTxnId: "S1::party::p1" }) === "S1::party::p1", "entity key");
assert(allocationStableKey({ voucherId: "S1", linkedAccountId: "p1" }) === "S1::p1", "linked key");

// local newer narration must keep incoming allocation (no field stamp = union)
{
  const merged = mergeAllocationsLists({
    local: [{ voucherId: "S1", amount: 10 }],
    incoming: [{ voucherId: "S2", amount: 20 }],
    localFieldMs: 0,
    incomingFieldMs: 0,
    localDocMs: 200,
    incomingDocMs: 100,
  });
  const keys = merged.map(allocationStableKey).sort();
  eq(keys, ["S1", "S2"], "legacy union keeps both adds");
}

// newer allocationsUpdatedAt is authoritative for deletes
{
  const merged = mergeAllocationsLists({
    local: [
      { voucherId: "S1", amount: 10 },
      { voucherId: "S2", amount: 20 },
    ],
    incoming: [{ voucherId: "S1", amount: 10 }],
    localFieldMs: 100,
    incomingFieldMs: 200,
    localDocMs: 100,
    incomingDocMs: 200,
  });
  eq(merged.map(allocationStableKey), ["S1"], "newer field stamp drops removed allocation");
}

// older incoming cannot delete a local allocation when local field is newer
{
  const merged = mergeAllocationsLists({
    local: [
      { voucherId: "S1", amount: 10 },
      { voucherId: "S2", amount: 20 },
    ],
    incoming: [{ voucherId: "S1", amount: 10 }],
    localFieldMs: 300,
    incomingFieldMs: 100,
    localDocMs: 300,
    incomingDocMs: 100,
  });
  const keys = merged.map(allocationStableKey).sort();
  eq(keys, ["S1", "S2"], "older incoming does not delete");
}

// tombstone on newer side removes the key
{
  const merged = mergeAllocationsLists({
    local: [{ voucherId: "S1", amount: 10 }],
    incoming: [{ voucherId: "S1", amount: 10, deleted: true }],
    localFieldMs: 100,
    incomingFieldMs: 200,
    localDocMs: 100,
    incomingDocMs: 200,
  });
  eq(merged, [], "newer tombstone removes allocation");
}

// fileUrls: adopt pbatt over local on same index
{
  const merged = mergeFileUrlsLists({
    local: ["local:abc"],
    incoming: ["pbatt:rec1/x.jpg"],
    localFieldMs: 0,
    incomingFieldMs: 0,
    localDocMs: 50,
    incomingDocMs: 50,
    incomingHasField: true,
    localHasField: true,
  });
  eq(merged, ["pbatt:rec1/x.jpg"], "adopt pbatt over local:");
}

// newer empty fileUrls is an intentional clear
{
  const merged = mergeFileUrlsLists({
    local: ["pbatt:rec1/x.jpg"],
    incoming: [],
    localFieldMs: 100,
    incomingFieldMs: 200,
    localDocMs: 100,
    incomingDocMs: 200,
    incomingHasField: true,
    localHasField: true,
  });
  eq(merged, [], "newer empty fileUrls clears");
}

// strip local: from payload
{
  const stripped = stripLocalFileRefsDeep({
    fileUrls: ["local:abc", "pbatt:r/f.jpg"],
    note: "hello",
    nested: { url: "local:xyz" },
  });
  eq(stripped, { fileUrls: ["pbatt:r/f.jpg"], note: "hello", nested: {} }, "strip local refs");
  const refs = [...collectLocalFileRefs({ fileUrls: ["local:abc", "pbatt:r/f.jpg"] })];
  eq(refs, ["local:abc"], "collect only local refs");
}

// conflict merge keeps incoming allocation on a newer local narration
{
  const r = mergeVoucherConflictFields(
    { id: "V1", narration: "new", allocations: [{ voucherId: "S1", amount: 10 }], lastEditedAt: 200 },
    { id: "V1", narration: "old", allocations: [{ voucherId: "S2", amount: 5 }], lastEditedAt: 100 },
    { localDocMs: 200, incomingDocMs: 100 }
  );
  const keys = (r.doc.allocations as { voucherId: string }[]).map((a) => a.voucherId).sort();
  eq(keys, ["S1", "S2"], "conflict merge unions allocations");
  assert(r.doc.narration === "new", "local newer keeps narration");
  assert(r.allocationsChanged, "allocationsChanged");
}

console.log("voucherFieldMerge.selftest: ok");
