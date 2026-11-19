import assert from "node:assert/strict";
import {
  countGalleryBadgeDocs,
  countVisibleGalleryDocs,
  hasGalleryUploadedAt,
  isGalleryDocumentVisibleInMode,
} from "../../src/modules/ocr/galleryDocVisibility";
import {
  combineGalleryBadgeCount,
  countLocalPendingNotOnServer,
  isOfflinePendingUnassignedFile,
  listLocalPendingNotOnServer,
  mergeOfflinePendingIntoUnassigned,
} from "../../src/modules/ocr/galleryOfflinePending";
import {
  GALLERY_OFFLINE_PENDING_INTRO,
  GALLERY_OFFLINE_PENDING_MARK,
  galleryOfflinePendingIntro,
  galleryOfflinePendingMark,
} from "../../src/modules/ocr/galleryOfflinePendingIntro";
import {
  asTrustedCount,
  parseCompanyFileCount,
  parseGalleryServerCounts,
} from "../../src/modules/ocr/galleryServerCountParse";

assert.equal(hasGalleryUploadedAt(undefined), false);
assert.equal(hasGalleryUploadedAt(null), false);
assert.equal(hasGalleryUploadedAt(""), false);
assert.equal(hasGalleryUploadedAt("null"), false);
assert.equal(hasGalleryUploadedAt({}), false);
assert.equal(hasGalleryUploadedAt(1_700_000_000_000), true);
assert.equal(hasGalleryUploadedAt("2026-11-18T12:00:00.000Z"), true);
assert.equal(hasGalleryUploadedAt({ seconds: 1_700_000_000 }), true);
assert.equal(hasGalleryUploadedAt({ toMillis: () => 1 }), true);

const live = { id: "a", status: "FREE", uploadedAt: "2026-11-18T12:00:00.000Z" };
const failed = { id: "b", status: "FREE", autoOcrStatus: "failed", uploadedAt: "2026-11-18T12:00:00.000Z" };
const assigned = { id: "c", status: "ASSIGNED", uploadedAt: "2026-11-18T12:00:00.000Z" };
const stub = { id: "d", movedToAdminRecycleAt: 1 };
const deleted = { id: "e", _pbHardDeleted: true, uploadedAt: "2026-11-18T12:00:00.000Z" };

assert.equal(isGalleryDocumentVisibleInMode(live, "unassigned"), true);
assert.equal(isGalleryDocumentVisibleInMode(failed, "unassigned"), false);
assert.equal(isGalleryDocumentVisibleInMode(failed, "auto-failed"), true);
assert.equal(isGalleryDocumentVisibleInMode(assigned, "unassigned"), false);
assert.equal(isGalleryDocumentVisibleInMode(stub, "unassigned"), false);
assert.equal(isGalleryDocumentVisibleInMode(deleted, "unassigned"), false);
assert.equal(isGalleryDocumentVisibleInMode(live, "duplicate"), true);

assert.equal(countVisibleGalleryDocs([live, failed, assigned, stub, deleted], "unassigned"), 1);
assert.equal(countVisibleGalleryDocs([live, failed, assigned, stub, deleted], "auto-failed"), 1);

const badges = countGalleryBadgeDocs({
  unassignedDocs: [live, failed, assigned, stub, deleted],
  duplicateDocs: [live, stub],
  companyFiles: 16,
});
assert.deepEqual(badges, { unassigned: 1, autoPostFailed: 1, duplicate: 1, companyFiles: 16 });

assert.equal(isOfflinePendingUnassignedFile({ url: "local:81f91636-2340-4f22-9884-ba8b4fe96263" }), true);
assert.equal(isOfflinePendingUnassignedFile({ url: "pbatt:abc", offlinePending: true }), true);
assert.equal(isOfflinePendingUnassignedFile({ url: "pbatt:abc" }), false);

const pending = [
  { id: "p1", url: "local:aaa", offlinePending: true },
  { id: "live", url: "local:bbb", offlinePending: true },
];
assert.deepEqual(listLocalPendingNotOnServer(pending, ["live"]).map((row) => row.id), ["p1"]);
assert.equal(countLocalPendingNotOnServer(pending, ["live"]), 1);
assert.equal(combineGalleryBadgeCount(10, 2), 12);
assert.equal(combineGalleryBadgeCount(10, 0), 10);
assert.deepEqual(mergeOfflinePendingIntoUnassigned<{ id: string }>([live], pending).map((row) => row.id), ["p1", "live", "a"]);

assert.equal(galleryOfflinePendingIntro("en"), GALLERY_OFFLINE_PENDING_INTRO.en);
assert.equal(galleryOfflinePendingIntro("hi"), GALLERY_OFFLINE_PENDING_INTRO.hi);
assert.equal(galleryOfflinePendingIntro("ne"), GALLERY_OFFLINE_PENDING_INTRO.ne);
assert.equal(galleryOfflinePendingIntro("fr"), GALLERY_OFFLINE_PENDING_INTRO.en);
assert.match(GALLERY_OFFLINE_PENDING_INTRO.en, /no internet/i);
assert.match(GALLERY_OFFLINE_PENDING_INTRO.hi, /\u0907\u0902\u091f\u0930\u0928\u0947\u091f/);
assert.match(GALLERY_OFFLINE_PENDING_INTRO.ne, /\u0907\u0928\u094d\u091f\u0930\u0928\u0947\u091f/);
assert.equal(galleryOfflinePendingMark("en"), "Offline");
assert.equal(galleryOfflinePendingMark("hi"), GALLERY_OFFLINE_PENDING_MARK.hi);
assert.equal(galleryOfflinePendingMark("ne"), GALLERY_OFFLINE_PENDING_MARK.ne);

assert.equal(asTrustedCount(0), 0);
assert.equal(asTrustedCount(16), 16);
assert.equal(asTrustedCount(9.7), 9);
assert.equal(asTrustedCount("4"), 4);
assert.equal(asTrustedCount(" 1 "), 1);
assert.equal(asTrustedCount(null), null);
assert.equal(asTrustedCount(undefined), null);
assert.equal(asTrustedCount(""), null);
assert.equal(asTrustedCount("   "), null);
assert.equal(asTrustedCount(false), null);
assert.equal(asTrustedCount(true), null);
assert.equal(asTrustedCount(-1), null);
assert.equal(asTrustedCount(NaN), null);

assert.deepEqual(
  parseGalleryServerCounts({
    ok: true,
    company: "demo-compnany_f21b7bb6",
    unassigned: 9,
    duplicate: 4,
    autoPostFailed: 1,
    companyFiles: 16,
  }),
  { unassigned: 9, duplicate: 4, autoPostFailed: 1, companyFiles: 16 }
);
assert.deepEqual(
  parseGalleryServerCounts({
    ok: true,
    unassigned: 0,
    duplicate: 0,
    autoPostFailed: 0,
    companyFiles: 0,
  }),
  { unassigned: 0, duplicate: 0, autoPostFailed: 0, companyFiles: 0 }
);
assert.throws(() => parseGalleryServerCounts(null), /invalid gallery counts/);
assert.throws(() => parseGalleryServerCounts({}), /invalid gallery counts/);
assert.throws(
  () => parseGalleryServerCounts({ unassigned: 0, duplicate: 0, autoPostFailed: 0, companyFiles: 0 }),
  /invalid gallery counts/
);
assert.throws(
  () => parseGalleryServerCounts({ ok: false, unassigned: 9, duplicate: 4, autoPostFailed: 1, companyFiles: 16 }),
  /invalid gallery counts/
);
assert.throws(
  () => parseGalleryServerCounts({ ok: true, unassigned: null, duplicate: 4, autoPostFailed: 1, companyFiles: 16 }),
  /invalid gallery counts/
);
assert.throws(
  () => parseGalleryServerCounts({ ok: true, unassigned: "", duplicate: 4, autoPostFailed: 1, companyFiles: 16 }),
  /invalid gallery counts/
);
assert.throws(
  () => parseGalleryServerCounts({ ok: true, unassigned: 9, duplicate: 4, autoPostFailed: 1 }),
  /invalid gallery counts/
);

assert.equal(parseCompanyFileCount({ ok: true, fileCount: 16 }), 16);
assert.equal(parseCompanyFileCount({ ok: true, fileCount: 0 }), 0);
assert.throws(() => parseCompanyFileCount({ fileCount: 16 }), /invalid file count/);
assert.throws(() => parseCompanyFileCount({ ok: true, fileCount: null }), /invalid file count/);
assert.throws(() => parseCompanyFileCount({ ok: true, fileCount: "" }), /invalid file count/);
assert.throws(() => parseCompanyFileCount({ ok: false, fileCount: 16 }), /invalid file count/);

console.log("galleryCounts selftest: OK");
