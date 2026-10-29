#!/usr/bin/env node
// Pocket Ledger: copy Firebase (Firestore) companies to the Pocket Ledger Server (PocketBase).
//
// DRY RUN BY DEFAULT: reads Firebase, asks the server what would change, prints the plan.
// Nothing is written anywhere unless --apply is given.
//
//   node scripts/pl-migrate-firebase.mjs --list
//   node scripts/pl-migrate-firebase.mjs --company=<firebaseCompanyId>[,<id2>]            (dry run)
//   node scripts/pl-migrate-firebase.mjs --company=<id> --apply                           (migrate)
//   options: --server=http://127.0.0.1:8090   --report=<file.json>   --keep-firestore-passwords
//            --fixture=<file.json>  (test source instead of Firebase; --apply then edits that file)
//
// Needs on the server PC:  set PL_MIGRATE_KEY=<24+ random characters>  and
//   pocketbase pl-migrate-arm --minutes=60   (same env var; run in the sub-server folder)
// Firebase Admin credentials: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
// (from the environment or this project's .env.local / .env). Secrets are never printed.
//
// --apply, per company: owner account + company + members + password hashes -> documents ->
// verify (row counts + every password checked against the server hash) -> only then the plain
// passwords in Firestore are removed (replaced by hasPassword: true). Firestore data is never deleted.
// Safe to re-run: unchanged rows are skipped; a newer row on the server is kept.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEVICE = "firebase-migration";
const PAGE = 300;
const MAX_BATCH_DOCS = 400;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
// Firestore subcollections that are not company data on the server (APP-DATA-MAP.md)
const SKIP = new Set(["presence", "devices", "device_commands", "device_history", "attachment_registry"]);

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (n) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
const flag = (n) => argv.includes(`--${n}`);
const APPLY = flag("apply");
const LIST = flag("list");
const KEEP_FS_PW = flag("keep-firestore-passwords");
const FIXTURE = opt("fixture");
const REPORT = opt("report");
const companiesArg = (opt("company") || "").split(",").map((s) => s.trim()).filter(Boolean);

function loadEnvFile(p) {
  try {
    for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch { /* optional */ }
}
if (!FIXTURE) { loadEnvFile(path.join(ROOT, ".env.local")); loadEnvFile(path.join(ROOT, ".env")); }

const SERVER = String(opt("server") || process.env.PL_MIGRATE_SERVER || "http://127.0.0.1:8090").replace(/\/+$/, "");
const KEY = process.env.PL_MIGRATE_KEY || "";
let SOURCE = null;

// ---------- value encoding (same as the app's pbSync encodeValue) ----------
function tsOf(ms) { return { __fsTs: true, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 }; }
function encode(v) {
  if (v === null || v === undefined) return v === null ? null : undefined;
  if (typeof v === "bigint") return String(v);
  if (typeof v === "function") return undefined;
  if (v instanceof Date) return tsOf(v.getTime());
  if (typeof v !== "object") return v;
  if (typeof v.toMillis === "function" && typeof v.seconds === "number") {
    return { __fsTs: true, seconds: v.seconds, nanoseconds: v.nanoseconds || 0 };
  }
  if (typeof v.path === "string" && v.firestore) return v.path; // DocumentReference
  if (typeof v.latitude === "number" && typeof v.longitude === "number" && Object.keys(v).length <= 2) {
    return { latitude: v.latitude, longitude: v.longitude };
  }
  if (v instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(v))) return undefined;
  if (Array.isArray(v)) return v.map((x) => { const e = encode(x); return e === undefined ? null : e; });
  if (v.__ts !== undefined && Object.keys(v).length === 1) return tsOf(Number(v.__ts)); // fixture timestamp
  const out = {};
  for (const k of Object.keys(v)) { const e = encode(v[k]); if (e !== undefined) out[k] = e; }
  return out;
}
function msOf(v) {
  if (typeof v === "number" && isFinite(v)) return Math.trunc(v);
  if (v && typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  if (typeof v === "string") { const t = Date.parse(v); return isFinite(t) ? t : 0; }
  return 0;
}
function docAt(data, fallbackMs) {
  return msOf(data.updatedAtMs) || msOf(data.updatedAt) || fallbackMs || Date.now();
}
const normEmail = (v) => String(v || "").trim().toLowerCase();
function memberPw(m) { for (const k of ["password", "pass", "pwd"]) if (typeof m[k] === "string" && m[k]) return m[k]; return ""; }

// ---------- sources ----------
class FixtureSource {
  // { companies: { <id>: { data: {...}, updatedAtMs?, collections: { <coll>: { <docId>: {...} } } } } }
  constructor(file) { this.file = file; this.json = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  async listCompanies() {
    return Object.keys(this.json.companies || {}).map((id) => ({ id, data: this.json.companies[id].data || {} }));
  }
  async getCompany(id) {
    const c = (this.json.companies || {})[id];
    return c ? { id, data: c.data || {}, updatedAtMs: c.updatedAtMs || 0 } : null;
  }
  async listCollections(id) { return Object.keys(this.json.companies[id].collections || {}); }
  async *pages(id, coll) {
    const all = Object.entries(this.json.companies[id].collections[coll] || {});
    for (let i = 0; i < all.length; i += PAGE) {
      yield all.slice(i, i + PAGE).map(([docId, data]) => ({ id: docId, data, updatedMs: 0 }));
    }
  }
  async count(id, coll) { return Object.keys(this.json.companies[id].collections[coll] || {}).length; }
  async clearPasswords(id, plan) {
    const c = this.json.companies[id];
    const r = applyClear(c.data, plan);
    if (r.changed) fs.writeFileSync(this.file, JSON.stringify(this.json, null, 2) + "\n");
    return r;
  }
}

class FirestoreSource {
  constructor() {
    const require = createRequire(path.join(ROOT, "package.json"));
    const admin = require("firebase-admin");
    const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
    let privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
    if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase Admin env missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
    }
    const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    this.admin = admin;
    this.app = app;
    this.db = app.firestore();
  }
  async close() { await this.app.delete(); }
  async listCompanies() {
    const snap = await this.db.collection("companies").select("name", "ownerEmail", "ownerId", "sharedWithEmails").get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  async getCompany(id) {
    const s = await this.db.collection("companies").doc(id).get();
    if (!s.exists) return null;
    return { id, data: s.data(), updatedAtMs: s.updateTime ? s.updateTime.toMillis() : 0 };
  }
  async listCollections(id) {
    const cols = await this.db.collection("companies").doc(id).listCollections();
    return cols.map((c) => c.id);
  }
  async *pages(id, coll) {
    const ref = this.db.collection("companies").doc(id).collection(coll);
    let last = null;
    for (;;) {
      let q = ref.orderBy("__name__").limit(PAGE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) return;
      yield snap.docs.map((d) => ({ id: d.id, data: d.data(), updatedMs: d.updateTime ? d.updateTime.toMillis() : 0 }));
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) return;
    }
  }
  async count(id, coll) {
    const s = await this.db.collection("companies").doc(id).collection(coll).count().get();
    return s.data().count;
  }
  async clearPasswords(id, plan) {
    const ref = this.db.collection("companies").doc(id);
    const FV = this.admin.firestore.FieldValue;
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const data = s.data() || {};
      // shallow copies only: Timestamps etc. inside sharedWith entries stay real Firestore values
      const copy = { password: data.password, sharedWith: Array.isArray(data.sharedWith) ? data.sharedWith.slice() : undefined };
      const r = applyClear(copy, plan);
      if (!r.changed) return r;
      const upd = { plServerMigration: { atMs: Date.now(), by: DEVICE } };
      if (r.root) { upd.password = FV.delete(); upd.hasPassword = true; }
      if (r.members) upd.sharedWith = copy.sharedWith; // same entries, password fields removed
      tx.update(ref, upd);
      return r;
    });
  }
}

// remove only the passwords that were verified on the server AND are still the same text
function applyClear(data, plan) {
  const r = { changed: false, root: false, members: 0 };
  if (plan.root && typeof data.password === "string" && data.password === plan.root) {
    delete data.password;
    data.hasPassword = true;
    r.root = true;
    r.changed = true;
  }
  if (Array.isArray(data.sharedWith)) {
    data.sharedWith = data.sharedWith.map((m) => {
      if (!m || typeof m !== "object") return m;
      const pw = plan.members[normEmail(m.email)];
      if (!pw || memberPw(m) !== pw) return m;
      const c = { ...m };
      delete c.password; delete c.pass; delete c.pwd;
      c.hasPassword = true;
      r.members++;
      r.changed = true;
      return c;
    });
  }
  return r;
}

// ---------- server ----------
async function call(route, body) {
  const res = await fetch(`${SERVER}/api/pl/migrate/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PL-Migrate-Key": KEY },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(`server ${route}: HTTP ${res.status} ${(json && json.message) || ""}`.trim());
  return json;
}

function add(into, coll, counts) {
  into[coll] = into[coll] || {};
  for (const k of Object.keys(counts || {})) into[coll][k] = (into[coll][k] || 0) + counts[k];
}

async function migrateCompany(src, id, useServer) {
  const rep = { company: id, mode: APPLY ? "apply" : "dry-run", ok: true, errors: [], warnings: [] };
  const c = await src.getCompany(id);
  if (!c) { rep.ok = false; rep.errors.push("not found in source"); return rep; }
  const raw = c.data || {};
  const data = encode(raw);
  rep.name = String(raw.name || "");
  rep.ownerEmail = normEmail(raw.ownerEmail);
  const shared = Array.isArray(raw.sharedWith) ? raw.sharedWith.filter((m) => m && typeof m === "object") : [];
  const memberPws = {};
  for (const m of shared) { const em = normEmail(m.email); const pw = memberPw(m); if (em && pw) memberPws[em] = pw; }
  const rootPw = typeof raw.password === "string" ? raw.password : "";
  rep.source = {
    members: shared.length,
    plainPasswords: { companyPassword: !!rootPw, memberPasswords: Object.keys(memberPws).length },
    collections: {}, skipped: {},
  };
  for (const pw of [rootPw, ...Object.values(memberPws)]) {
    if (pw && pw.length > 71) { rep.ok = false; rep.errors.push("a password is longer than 71 characters (server limit)"); }
  }

  // collections
  const colls = (await src.listCollections(id)).sort();
  const take = [];
  for (const coll of colls) {
    if (coll.startsWith("_") || SKIP.has(coll) || !/^[A-Za-z0-9_]+$/.test(coll)) {
      rep.source.skipped[coll] = await src.count(id, coll);
    } else take.push(coll);
  }

  let plan = null;
  if (useServer) {
    const r = await call("company", {
      apply: APPLY && rep.ok,
      company: { id, data, ownerUid: raw.ownerId || "", ownerEmail: raw.ownerEmail || "", ownerName: raw.ownerName || "", updatedAtMs: docAt(raw, c.updatedAtMs) },
    });
    if (!r.ok) { rep.ok = false; rep.errors.push(`conflict: ${r.conflict}`); }
    plan = r.plan || null;
    rep.server = { company: plan };
  }
  if (!rep.ok && APPLY) return rep; // never write documents when the company step failed

  const serverCounts = {};
  for (const coll of take) {
    let n = 0;
    let batch = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      if (useServer) {
        const r = await call("docs", { apply: APPLY, company: id, docs: batch });
        add(serverCounts, coll, (r.counts || {})[coll]);
        if (r.keptServer && r.keptServer.length) rep.warnings.push(`server copy is newer (kept): ${r.keptServer.slice(0, 5).join(", ")}`);
      }
      batch = []; bytes = 0;
    };
    for await (const page of src.pages(id, coll)) {
      for (const d of page) {
        const enc = encode(d.data) || {};
        const op = { coll, id: d.id, data: enc, at: docAt(enc, d.updatedMs) };
        const size = Buffer.byteLength(JSON.stringify(op));
        if (batch.length && (batch.length >= MAX_BATCH_DOCS || bytes + size > MAX_BATCH_BYTES)) await flush();
        batch.push(op); bytes += size; n++;
      }
    }
    await flush();
    rep.source.collections[coll] = n;
  }
  if (useServer) rep.server.documents = serverCounts;
  if (!APPLY || !useServer) {
    rep.firestorePasswordClear = {
      wouldClearCompanyPassword: !!rootPw && !KEEP_FS_PW,
      wouldClearMemberPasswords: KEEP_FS_PW ? 0 : Object.keys(memberPws).length,
      note: "only in --apply, and only after each password is verified against the server hash",
    };
    return rep;
  }

  // verify
  const v = await call("verify", { company: id, counts: rep.source.collections, passwords: { root: rootPw || null, members: memberPws } });
  rep.verify = { counts: v.counts, passwords: { company: v.passwords.root, members: v.passwords.members } };
  for (const coll of Object.keys(rep.source.collections)) {
    const x = (v.counts || {})[coll];
    const bad = (serverCounts[coll] || {}).unsupported || (serverCounts[coll] || {}).bad;
    if (!x || x.server < x.source || bad) { rep.ok = false; rep.errors.push(`count check failed: ${coll}`); }
  }
  if (rootPw && v.passwords.root !== true) { rep.ok = false; rep.errors.push("company password hash not verified"); }
  const verified = {};
  for (const em of Object.keys(memberPws)) {
    if (v.passwords.members[em] === true) verified[em] = memberPws[em];
    else { rep.ok = false; rep.errors.push(`member password not verified: ${em}`); }
  }
  // clear plain passwords in Firestore only when everything above is verified
  if (KEEP_FS_PW) rep.firestorePasswordClear = { skipped: "--keep-firestore-passwords" };
  else if (!rep.ok) rep.firestorePasswordClear = { skipped: "verification failed; nothing cleared" };
  else {
    const r = await src.clearPasswords(id, { root: rootPw && v.passwords.root === true ? rootPw : "", members: verified });
    rep.firestorePasswordClear = { companyPassword: r.root, memberPasswords: r.members };
  }
  if (plan && plan.owner && plan.owner.needsServerPassword) {
    rep.warnings.push(`owner ${plan.owner.email} has no server password yet: run pl-app-user upsert ${plan.owner.email}`);
  }
  return rep;
}

function printRep(r) {
  const L = [];
  L.push(`\n=== ${r.company}  ${r.name ? `"${r.name}"` : ""}  [${r.mode}]  ${r.ok ? "OK" : "PROBLEM"}`);
  L.push(`owner: ${r.ownerEmail || "-"}`);
  if (r.source) {
    L.push(`members in sharedWith: ${r.source.members}; plain passwords: company=${r.source.plainPasswords.companyPassword ? "yes" : "no"}, members=${r.source.plainPasswords.memberPasswords}`);
    L.push(`documents: ${Object.entries(r.source.collections).map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
    if (Object.keys(r.source.skipped).length) L.push(`skipped (not server data): ${Object.entries(r.source.skipped).map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
  if (r.server && r.server.company) {
    const p = r.server.company;
    L.push(`server: owner ${p.owner.action}${p.owner.needsServerPassword ? " (needs a server password)" : ""}; company ${p.company.action}; company password ${p.rootPassword}; member passwords ${JSON.stringify(p.memberPasswords)}`);
  }
  if (r.server && r.server.documents) L.push(`server documents: ${JSON.stringify(r.server.documents)}`);
  if (r.verify) L.push(`verify: ${JSON.stringify(r.verify.counts)}; passwords company=${r.verify.passwords.company} members=${JSON.stringify(r.verify.passwords.members)}`);
  if (r.firestorePasswordClear) L.push(`firestore plain passwords: ${JSON.stringify(r.firestorePasswordClear)}`);
  for (const w of r.warnings || []) L.push(`warning: ${w}`);
  for (const e of r.errors || []) L.push(`error: ${e}`);
  console.log(L.join("\n"));
}

async function main() {
  const src = FIXTURE ? new FixtureSource(path.resolve(FIXTURE)) : new FirestoreSource();
  SOURCE = src;
  if (LIST) {
    for (const c of await src.listCompanies()) {
      const d = c.data || {};
      console.log(`${c.id}\t${d.name || ""}\t${d.ownerEmail || ""}\tshared=${Array.isArray(d.sharedWithEmails) ? d.sharedWithEmails.length : 0}`);
    }
    return 0;
  }
  if (!companiesArg.length) { console.log("Give --company=<id>[,<id>] or --list"); return 2; }
  const useServer = KEY.length >= 24;
  if (!useServer) {
    if (APPLY) { console.log("--apply needs PL_MIGRATE_KEY (24+ chars) and pocketbase pl-migrate-arm"); return 2; }
    console.log("PL_MIGRATE_KEY not set: source-only dry run (no server comparison).");
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN (nothing is written)"}  server=${useServer ? SERVER : "-"}  source=${FIXTURE ? "fixture" : "firestore"}`);
  const reports = [];
  for (const id of companiesArg) {
    let r;
    try { r = await migrateCompany(src, id, useServer); } catch (err) {
      r = { company: id, mode: APPLY ? "apply" : "dry-run", ok: false, errors: [String((err && err.message) || err)], warnings: [] };
    }
    printRep(r);
    reports.push(r);
  }
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, reports }, null, 2) + "\n");
  return reports.every((r) => r.ok) ? 0 : 1;
}

// exitCode (not process.exit): avoids a libuv crash on Windows while fetch sockets close
main().then((code) => { process.exitCode = code; }, (err) => { console.error(String((err && err.message) || err)); process.exitCode = 1; })
  .finally(() => { if (SOURCE && SOURCE.close) SOURCE.close().catch(() => {}); });
