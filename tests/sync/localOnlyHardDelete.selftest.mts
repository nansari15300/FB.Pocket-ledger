import {
  decideNeverSyncedLocalDoc,
  docHasCrossLinkFields,
  pendingDocPathMatches,
  computePushLocalCount,
  neverSyncedFailReasons,
  localOnlyHardDeleteConfirmText,
  type NeverSyncedSignals,
} from "../../src/lib/localOnlyHardDeleteRules";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const base: NeverSyncedSignals = {
  hasLocalDoc: true,
  mirrorBackedByFirestore: false,
  hasUnsentCreateRow: true,
  firestoreCache: "absent",
  inFlight: false,
  hasCrossLinks: false,
  referencedElsewhere: false,
};
eq("all pass => hard", decideNeverSyncedLocalDoc(base), true);
for (const k of ["hasLocalDoc", "mirrorBackedByFirestore", "hasUnsentCreateRow", "inFlight", "hasCrossLinks", "referencedElsewhere"] as const) {
  eq(`flip ${k} => soft`, decideNeverSyncedLocalDoc({ ...base, [k]: !base[k] }), false);
}
eq("cache synced => soft", decideNeverSyncedLocalDoc({ ...base, firestoreCache: "synced" }), false);
eq("cache unknown => soft", decideNeverSyncedLocalDoc({ ...base, firestoreCache: "unknown" }), false);
// Quota case: SDK holds an unacknowledged setDoc; listener stamped the mirror flag; no outbox row.
eq(
  "cache pending + mirror stamp + no outbox row => hard",
  decideNeverSyncedLocalDoc({ ...base, firestoreCache: "pending", mirrorBackedByFirestore: true, hasUnsentCreateRow: false }),
  true
);
eq("cache pending + in flight => soft", decideNeverSyncedLocalDoc({ ...base, firestoreCache: "pending", inFlight: true }), false);
eq("cache pending + linked => soft", decideNeverSyncedLocalDoc({ ...base, firestoreCache: "pending", hasCrossLinks: true }), false);

eq("plain doc no links", docHasCrossLinkFields({ amount: 5, allocations: [] }), false);
eq("allocations zero rows => no link", docHasCrossLinkFields({ allocations: [{ id: "x", amount: 0 }] }), false);
eq("allocations with amount => link", docHasCrossLinkFields({ allocations: [{ id: "x", amount: 50 }] }), true);
eq("reasons empty when ok", neverSyncedFailReasons(base).length, 0);
eq("reason mirror", neverSyncedFailReasons({ ...base, mirrorBackedByFirestore: true }).length, 1);
eq("interCompany => link", docHasCrossLinkFields({ interCompanyPairId: "p1" }), true);
eq("recurring => link", docHasCrossLinkFields({ recurringTemplateId: "r1" }), true);
eq("empty linked => no", docHasCrossLinkFields({ linkedVoucherId: "" }), false);

eq("docPath match", pendingDocPathMatches("companies/c1/vouchers/v1", "vouchers", "v1"), true);
eq("docPath other id", pendingDocPathMatches("companies/c1/vouchers/v2", "vouchers", "v1"), false);

// Failed voucher row + its pending file => 1 (old formula double counted with notOnOnline).
eq(
  "push: row + file same doc",
  computePushLocalCount([{ outboxId: "o1", collectionName: "vouchers", docId: "v1" }], [
    { id: "f1", docPath: "companies/c1/vouchers/v1" },
  ]),
  1
);
eq(
  "push: 2 rows (create+update) + unrelated file + dup file",
  computePushLocalCount(
    [
      { outboxId: "o1", collectionName: "vouchers", docId: "v1" },
      { outboxId: "o2", collectionName: "parties", docId: "p1" },
      { outboxId: "o2", collectionName: "parties", docId: "p1" },
    ],
    [
      { id: "f9", docPath: "companies/c1/vouchers/v9" },
      { id: "f9", docPath: "companies/c1/vouchers/v9" },
    ]
  ),
  3
);
eq("text voucher", localOnlyHardDeleteConfirmText("vouchers"), "This voucher is only on this device (not synced online). Deleting will remove it permanently.");
eq("text master", localOnlyHardDeleteConfirmText("parties"), "This record is only on this device (not synced online). Deleting will remove it permanently.");
eq("push: empty", computePushLocalCount([], []), 0);

console.log(fails ? `${fails} FAILED` : "ALL PASS");
if (fails) process.exit(1);
