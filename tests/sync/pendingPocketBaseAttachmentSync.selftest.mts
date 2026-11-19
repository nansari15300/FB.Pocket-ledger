import assert from "node:assert/strict";
import {
  applyLocalToPbattRefs,
  collectLocalRefs,
  decidePendingPocketBaseAttachmentSync,
  docHasLocalRef,
  localRefFromId,
  parseCompanyDocPath,
  pendingBlobIsUsable,
  rewriteLoopbackPocketBaseFileUrlForDisplay,
  shouldScanPendingFileForSync,
} from "../../src/lib/pendingPocketBaseAttachmentSyncLogic";

assert.deepEqual(parseCompanyDocPath("companies/abc/vouchers/cntr-1"), {
  companyId: "abc",
  collection: "vouchers",
  docId: "cntr-1",
});
assert.equal(parseCompanyDocPath("companies/abc/vouchers"), null);
assert.equal(parseCompanyDocPath("local:81f91636-2340-4f22-9884-ba8b4fe96263"), null);

assert.equal(pendingBlobIsUsable({ size: 12 }), true);
assert.equal(pendingBlobIsUsable({ size: 0 }), false);
assert.equal(pendingBlobIsUsable(null), false);
assert.equal(pendingBlobIsUsable(undefined), false);

const localId = "81f91636-2340-4f22-9884-ba8b4fe96263";
const localRef = localRefFromId(localId);
const voucher = {
  id: "CNTR-Out-001",
  fileUrls: [localRef, "https://example.com/other.png"],
};
assert.equal(docHasLocalRef(voucher, localId), true);
assert.equal(docHasLocalRef({ unassignedFile: { url: localRef } }, localId), true);
assert.equal(docHasLocalRef({ fileUrls: ["pbatt:rec123/receipt.jpg"] }, localId), false);
assert.deepEqual([...collectLocalRefs(voucher)], [localRef]);

assert.deepEqual(decidePendingPocketBaseAttachmentSync({ hasBlob: false, doc: voucher, localId }), {
  action: "skip_missing_blob",
});
assert.deepEqual(decidePendingPocketBaseAttachmentSync({ hasBlob: true, doc: null, localId }), {
  action: "skip_not_in_doc",
});
assert.deepEqual(
  decidePendingPocketBaseAttachmentSync({
    hasBlob: true,
    doc: { fileUrls: ["pbatt:rec123/receipt.jpg"] },
    localId,
  }),
  { action: "skip_not_in_doc" },
);
assert.deepEqual(decidePendingPocketBaseAttachmentSync({ hasBlob: true, doc: voucher, localId }), {
  action: "upload_and_patch",
});

const converted = applyLocalToPbattRefs(voucher, { [localRef]: "pbatt:abc123def4567/receipt.jpg" });
assert.deepEqual(converted.fileUrls, ["pbatt:abc123def4567/receipt.jpg", "https://example.com/other.png"]);
assert.deepEqual(voucher.fileUrls, [localRef, "https://example.com/other.png"]);

assert.equal(
  shouldScanPendingFileForSync({ firebaseUploadEnabled: false, pocketBaseAttachmentSyncEnabled: true }),
  true,
);
assert.equal(
  shouldScanPendingFileForSync({ firebaseUploadEnabled: false, pocketBaseAttachmentSyncEnabled: false }),
  false,
);
assert.equal(
  shouldScanPendingFileForSync({ firebaseUploadEnabled: true, pocketBaseAttachmentSyncEnabled: false }),
  true,
);

const loopback = "http://127.0.0.1:8090/api/files/pl_stored_files/rec1/bill.jpg";
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay(loopback, "http://192.168.1.10:8090"),
  "http://192.168.1.10:8090/api/files/pl_stored_files/rec1/bill.jpg",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay(loopback, "http://laptop:3000/pb"),
  "http://laptop:3000/pb/api/files/pl_stored_files/rec1/bill.jpg",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay(
    "http://192.168.1.10:8090/api/files/pl_stored_files/rec1/bill.jpg",
    "http://192.168.1.10:8090",
  ),
  "http://192.168.1.10:8090/api/files/pl_stored_files/rec1/bill.jpg",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay("local:abc", "http://192.168.1.10:8090"),
  "local:abc",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay("http://127.0.0.1:8090/api/health", "http://192.168.1.10:8090"),
  "http://127.0.0.1:8090/api/health",
);

console.log("pendingPocketBaseAttachmentSync selftest: OK");
