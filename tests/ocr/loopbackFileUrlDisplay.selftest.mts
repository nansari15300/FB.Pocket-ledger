import assert from "node:assert/strict";
import { rewriteLoopbackPocketBaseFileUrlForDisplay } from "../../src/lib/pendingPocketBaseAttachmentSyncLogic";
import { decideUnassignedUploadPersist } from "../../src/modules/ocr/unassignedUploadPersist";
import { normalizeAttachmentUrlForDevicePreview, unwrapAttachmentHoldClipboardRef } from "../../src/lib/attachmentHoldClipboard";

const loopbackStored = "http://127.0.0.1:8090/api/files/pl_stored_files/abc123/bill.jpg";
const localhostStored = "http://localhost:8090/api/files/pl_attachments/abc123/bill.pdf?token=x";
const lanBase = "http://192.168.1.10:8090";
const proxyBase = "http://laptop:3000/pb";

assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay(loopbackStored, lanBase),
  "http://192.168.1.10:8090/api/files/pl_stored_files/abc123/bill.jpg",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay(localhostStored, proxyBase),
  "http://laptop:3000/pb/api/files/pl_attachments/abc123/bill.pdf?token=x",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay("pbatt:rec1/bill.jpg", lanBase),
  "pbatt:rec1/bill.jpg",
);
assert.equal(
  rewriteLoopbackPocketBaseFileUrlForDisplay("http://127.0.0.1:8090/api/health", lanBase),
  "http://127.0.0.1:8090/api/health",
);

assert.equal(
  normalizeAttachmentUrlForDevicePreview(loopbackStored, lanBase),
  "http://192.168.1.10:8090/api/files/pl_stored_files/abc123/bill.jpg",
);
assert.equal(
  normalizeAttachmentUrlForDevicePreview(localhostStored, proxyBase),
  "http://laptop:3000/pb/api/files/pl_attachments/abc123/bill.pdf?token=x",
);
assert.equal(normalizeAttachmentUrlForDevicePreview("pbatt:rec1/bill.jpg", lanBase), "pbatt:rec1/bill.jpg");
assert.equal(normalizeAttachmentUrlForDevicePreview("local:abc", lanBase), "local:abc");
assert.equal(
  normalizeAttachmentUrlForDevicePreview(
    "http://192.168.1.10:8090/api/files/pl_stored_files/abc123/bill.jpg",
    lanBase,
  ),
  "http://192.168.1.10:8090/api/files/pl_stored_files/abc123/bill.jpg",
);

assert.deepEqual(
  decideUnassignedUploadPersist({ url: "pbatt:rec1/file.jpg", path: "pbatt:rec1/file.jpg" }),
  { action: "store", url: "pbatt:rec1/file.jpg", path: "pbatt:rec1/file.jpg" },
);
assert.deepEqual(
  decideUnassignedUploadPersist({ url: loopbackStored, path: "companies/x/unassigned/y" }),
  { action: "offline_pending" },
);
assert.deepEqual(decideUnassignedUploadPersist(null), { action: "offline_pending" });
assert.deepEqual(decideUnassignedUploadPersist({ url: "", path: "" }), { action: "offline_pending" });

assert.equal(unwrapAttachmentHoldClipboardRef(loopbackStored), loopbackStored);
assert.equal(unwrapAttachmentHoldClipboardRef("pbatt:rec1/bill.jpg"), "pbatt:rec1/bill.jpg");

console.log("loopbackFileUrlDisplay selftest: OK");