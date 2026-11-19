import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

type SqlDb = {
  exec(sql: string): void;
  prepare(sql: string): { run: (...a: unknown[]) => void; get: () => Record<string, unknown> };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => SqlDb;
};

/**
 * PocketBase DynamicModel string fields cannot scan SQL NULL.
 * CAST(json_extract(...) AS TEXT) leaves missing keys as NULL, which throws
 * "converting NULL to string is unsupported". gallery-counts then returns 500
 * and the client falls back to the FY-scoped local Company Doc count.
 * Hook SQL must COALESCE those extracts to ''.
 */

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE pl_vouchers (
    company TEXT,
    deleted INTEGER,
    data TEXT
  );
`);
db.prepare("INSERT INTO pl_vouchers (company, deleted, data) VALUES (?, 0, ?)").run(
  "h353ic0cdqa2qof",
  JSON.stringify({
    companyId: "demo-compnany_f21b7bb6",
    fileUrls: ["pbatt:one"],
    // isDeleted / _pbHardDeleted / unassignedFile omitted on purpose
  })
);

const bare = db.prepare(
  "SELECT CAST(json_extract(data, '$.isDeleted') AS TEXT) AS is_deleted, " +
    "CAST(json_extract(data, '$._pbHardDeleted') AS TEXT) AS hard_deleted, " +
    "CAST(json_extract(data, '$.unassignedFile.url') AS TEXT) AS uf_url, " +
    "CAST(json_extract(data, '$.fileUrls') AS TEXT) AS file_urls, " +
    "CAST(json_type(data, '$.fileUrls') AS TEXT) AS file_urls_type " +
    "FROM pl_vouchers"
).get() as Record<string, unknown>;

assert.equal(bare.is_deleted, null);
assert.equal(bare.hard_deleted, null);
assert.equal(bare.uf_url, null);
assert.equal(typeof bare.file_urls, "string");
assert.equal(bare.file_urls_type, "array");

const safe = db.prepare(
  "SELECT COALESCE(CAST(json_extract(data, '$.isDeleted') AS TEXT), '') AS is_deleted, " +
    "COALESCE(CAST(json_extract(data, '$._pbHardDeleted') AS TEXT), '') AS hard_deleted, " +
    "COALESCE(CAST(json_extract(data, '$.unassignedFile.url') AS TEXT), '') AS uf_url, " +
    "COALESCE(CAST(json_extract(data, '$.fileUrls') AS TEXT), '') AS file_urls, " +
    "COALESCE(CAST(json_type(data, '$.fileUrls') AS TEXT), '') AS file_urls_type " +
    "FROM pl_vouchers"
).get() as Record<string, unknown>;

assert.equal(safe.is_deleted, "");
assert.equal(safe.hard_deleted, "");
assert.equal(safe.uf_url, "");
assert.equal(safe.file_urls_type, "array");
assert.ok(String(safe.file_urls).includes("pbatt:one"));
db.close();

const hookPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../PocketLedger-Server/sub-server/pb_hooks/lib/company_file_count.js"
);
assert.equal(fs.existsSync(hookPath), true, "sibling hook source should exist: " + hookPath);
const hookSrc = fs.readFileSync(hookPath, "utf8");
for (const col of [
  "$.isDeleted",
  "$._pbHardDeleted",
  "$.unassignedFile.url",
  "$.fileUrls",
  "$.deleted",
  "$.status",
  "$.autoOcrStatus",
  "$.uploadedAt",
  "$.autoOcrVoucherId",
  "$.autoOcrProvider",
  "$.autoOcrRunnerMode",
]) {
  const wrapped = new RegExp(
    String.raw`COALESCE\(CAST\(json_(?:extract|type)\(data, '${col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\) AS TEXT\), ''\)`
  );
  assert.match(hookSrc, wrapped, "hook SQL must COALESCE " + col);
}

console.log("galleryCountSqlNull selftest: OK");