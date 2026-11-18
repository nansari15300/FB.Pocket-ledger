import assert from "node:assert/strict";
import {
  countCompanyVoucherFiles,
  countFilesFromExtractedFields,
  countVoucherAttachmentFiles,
  isAliveVoucherForFileCount,
} from "../../src/modules/ocr/companyFileCountCore";

assert.equal(countVoucherAttachmentFiles({ fileUrls: ["a.png", "b.png"] }), 2);
assert.equal(countVoucherAttachmentFiles({ fileUrls: ["  ", ""] }), 0);
assert.equal(countVoucherAttachmentFiles({ fileUrls: "one.jpg" }), 1);
assert.equal(countVoucherAttachmentFiles({ fileUrls: [] }), 0);
assert.equal(countVoucherAttachmentFiles({ fileUrls: [], unassignedFile: { url: "legacy.jpg" } }), 0);
assert.equal(countVoucherAttachmentFiles({ unassignedFile: { url: "legacy.jpg" } }), 1);
assert.equal(countVoucherAttachmentFiles({ fileUrls: undefined, unassignedFile: { url: "legacy.jpg" } }), 1);
assert.equal(countVoucherAttachmentFiles(null), 0);

assert.equal(isAliveVoucherForFileCount({ id: "a", fileUrls: ["x"] }), true);
assert.equal(isAliveVoucherForFileCount({ id: "a", isDeleted: true, fileUrls: ["x"] }), false);
assert.equal(isAliveVoucherForFileCount({ id: "a", deleted: true, fileUrls: ["x"] }), false);
assert.equal(isAliveVoucherForFileCount({ id: "a", _pbHardDeleted: true, fileUrls: ["x"] }), false);

assert.equal(
  countCompanyVoucherFiles([
    { id: "live", fileUrls: ["a.png", "b.png"] },
    { id: "gone", isDeleted: true, fileUrls: ["c.png"] },
    { id: "legacy", unassignedFile: { url: "legacy.jpg" } },
  ]),
  3
);

assert.equal(countFilesFromExtractedFields(["a.png", ""], "array", "legacy.jpg"), 1);
assert.equal(countFilesFromExtractedFields([], "array", "legacy.jpg"), 0);
assert.equal(countFilesFromExtractedFields(null, "null", "legacy.jpg"), 1);
assert.equal(countFilesFromExtractedFields(undefined, null, "legacy.jpg"), 1);
assert.equal(countFilesFromExtractedFields("one.jpg", "text", "legacy.jpg"), 1);
assert.equal(countFilesFromExtractedFields('["a.png","b.png"]', "array", ""), 2);
assert.equal(countFilesFromExtractedFields([], "array", ""), 0);

console.log("companyFileCount selftest: OK");
