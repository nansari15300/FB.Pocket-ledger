/**
 * Sirf `writeGateway/**` + `localVoucherOutbox` yahan se Firestore mutation APIs import karein —
 * ESLint `no-restricted-imports` baaki `src/lib` (aur baad mein UI) me direct `firebase/firestore` mutation import rokta hai.
 */

import {
  addDoc as firestoreAddDoc,
  collection,
  deleteDoc as firestoreDeleteDoc,
  doc,
  getDoc as firestoreGetDoc,
  runTransaction as firestoreRunTransaction,
  serverTimestamp,
  setDoc as firestoreSetDoc,
  updateDoc as firestoreUpdateDoc,
  writeBatch as firestoreWriteBatch,
  type CollectionReference,
  type DocumentReference,
  type Transaction,
  type WriteBatch,
} from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { isPocketBaseCompanyId, notePocketBaseRootWrite, listPocketBaseCompanyIds } from "@/lib/pocketbaseData/pbCompanyRegistry";
import type { PbBatchOp, PbExpect, PbOpResult, PbWriteMode } from "@/lib/pocketbaseData/pbSync";
import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import {
  makeUdocWrite,
  udocCollectionPath,
  udocCommit,
  udocDocPath,
  udocReadDoc,
  type UdocWrite,
} from "@/lib/pocketbaseData/pbGlobalDocs";

export { collection, doc, serverTimestamp };
/** Raw Firestore transaction (Firebase-only paths, e.g. the outbox flush). */
export { firestoreRunTransaction };

type LedgerDocPath = {
  fsCompanyId: string;
  collectionName: string;
  docId: string;
};

function parseLedgerDocPath(ref: unknown): LedgerDocPath | null {
  const path = String((ref as { path?: unknown } | null)?.path || "").trim();
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 4) return null;
  if (parts[0] !== "companies") return null;
  const [, fsCompanyId, collectionName, docId] = parts;
  if (!fsCompanyId || !collectionName || !docId || collectionName.startsWith("_")) return null;
  return { fsCompanyId, collectionName, docId };
}

function parseLedgerCollectionPath(ref: unknown): { fsCompanyId: string; collectionName: string } | null {
  const path = String((ref as { path?: unknown } | null)?.path || "").trim();
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 3) return null;
  if (parts[0] !== "companies") return null;
  const [, fsCompanyId, collectionName] = parts;
  if (!fsCompanyId || !collectionName || collectionName.startsWith("_")) return null;
  return { fsCompanyId, collectionName };
}

/** Path segments of a Firestore ref (`companies/{id}/...`). */
function refPathParts(ref: unknown): string[] {
  return String((ref as { path?: unknown } | null)?.path || "")
    .split("/")
    .filter(Boolean);
}

/** `companies/{pbCompany}/_pl_change_log/...` - Firestore change feed is not used for PocketBase companies. */
function isPocketBaseChangeLogRef(ref: unknown): boolean {
  const p = refPathParts(ref);
  return p.length >= 3 && p[0] === "companies" && p[2] === "_pl_change_log" && isPocketBaseCompanyId(p[1]);
}

/** Store server results in the local SQLite mirror (lists refresh via the collection bump). */
async function mirrorPocketBaseResults(companyId: string, results: PbOpResult[]): Promise<void> {
  if (!results.length) return;
  try {
    const [{ upsertCompanyDocInBrowserDb }, { pbRecordToAppDoc }] = await Promise.all([
      import("@/lib/localCompanyDocMirror"),
      import("@/lib/pocketbaseData/pbSync"),
    ]);
    for (const r of results) {
      await upsertCompanyDocInBrowserDb(
        companyId,
        r.coll,
        r.id,
        pbRecordToAppDoc({ app_id: r.id, data: r.data, deleted: r.exists === false }),
        { force: true, notify: true, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
      );
    }
  } catch {
    /* mirror is refreshed by the next pull */
  }
}

/** Several writes of one PocketBase company in one server transaction, then mirrored locally. */
async function commitPocketBaseOps(companyId: string, ops: PbBatchOp[], expects?: PbExpect[]): Promise<PbOpResult[]> {
  const { pbBatchWrite } = await import("@/lib/pocketbaseData/pbSync");
  const results = await pbBatchWrite(companyId, ops, expects);
  await mirrorPocketBaseResults(companyId, results);
  return results;
}

/**
 * Pocket Ledger Server routing: company data docs of a PocketBase company go to the server
 * (and the local SQLite mirror) instead of Firestore. The company root doc stays in Firestore.
 */
async function writePocketBaseLedgerDoc(
  parsed: LedgerDocPath,
  data: Record<string, unknown> | null,
  mode: PbWriteMode
): Promise<void> {
  await commitPocketBaseOps(parsed.fsCompanyId, [
    { coll: parsed.collectionName, id: parsed.docId, mode, data: data || {} },
  ]);
}

/** set / update / delete call -> general document store write. */
function udocWriteOf(kind: "set" | "update" | "delete", path: string, args: unknown[]): UdocWrite {
  if (kind === "set") {
    return makeUdocWrite(path, setOptionsMode(args[2]) === "merge" ? "merge" : "set", (args[1] as Record<string, unknown>) || {});
  }
  if (kind === "update") return makeUdocWrite(path, "update", updateArgsToPatch(args));
  return makeUdocWrite(path, "delete");
}

/** `update(ref, data)` or `update(ref, "field", value, ...)` -> dotted-path patch. */
function updateArgsToPatch(args: unknown[]): Record<string, unknown> {
  if (typeof args[1] === "string" || (args[1] && typeof args[1] === "object" && "_internalPath" in (args[1] as object))) {
    const patch: Record<string, unknown> = {};
    for (let i = 1; i + 1 < args.length; i += 2) patch[String(args[i])] = args[i + 1];
    return patch;
  }
  return (args[1] as Record<string, unknown>) || {};
}

function setOptionsMode(opts: unknown): PbWriteMode {
  const o = (opts as { merge?: unknown; mergeFields?: unknown } | undefined) || {};
  return o.merge === true || Array.isArray(o.mergeFields) ? "merge" : "set";
}

/** batch / transaction call -> server op */
function callToPbOp(kind: "set" | "update" | "delete", pb: LedgerDocPath, args: unknown[]): PbBatchOp {
  const base = { coll: pb.collectionName, id: pb.docId };
  if (kind === "set") return { ...base, mode: setOptionsMode(args[2]), data: (args[1] as Record<string, unknown>) || {} };
  if (kind === "update") return { ...base, mode: "update", data: updateArgsToPatch(args) };
  return { ...base, mode: "delete", data: { isDeleted: true, deletedAtMs: Date.now() } };
}

/** True when a server session exists: server-only sign-in, or a Google/Firebase login that minted a PB token. */
function hasServerSession(): boolean {
  try {
    if (isPocketBaseAppSessionActive()) return true;
  } catch {
    /* fall through */
  }
  try {
    return !!getValidPocketBaseAuth();
  } catch {
    return false;
  }
}

function pocketBaseLedgerPath(ref: unknown): LedgerDocPath | null {
  const parsed = parseLedgerDocPath(ref);
  return parsed && isPocketBaseCompanyId(parsed.fsCompanyId) ? parsed : null;
}

/** `companies/{pbCompany}` (company root doc of a Pocket Ledger Server company). */
function pocketBaseRootCompanyId(ref: unknown): string | null {
  const p = refPathParts(ref);
  return p.length === 2 && p[0] === "companies" && isPocketBaseCompanyId(p[1]) ? p[1] : null;
}

/**
 * Company root of a PocketBase company: Firestore stays the main copy (company list, gate,
 * member passwords); after the Firestore write succeeds the same change goes to the server
 * (pl_companies + pl_company_members) in the background. A failed server write is retried by
 * the next pull (root marked dirty).
 */
function mirrorPocketBaseCompanyRoot(companyId: string, data: Record<string, unknown>, mode: PbWriteMode): void {
  if (mode === "delete") return;
  const rootMode = mode;
  notePocketBaseRootWrite(companyId, 1);
  void import("@/lib/pocketbaseData/pbSync")
    .then((m) => m.pbWriteCompanyRoot(companyId, data, rootMode))
    .catch(() => {
      /* pbWriteCompanyRoot marks the root dirty itself */
    })
    .finally(() => notePocketBaseRootWrite(companyId, -1));
}

/**
 * Server login (pl_users, no Firebase session): the company root of a PocketBase company is
 * written to the server only (no Firestore copy) and a failure is thrown to the caller.
 */
async function writePocketBaseRootServerOnly(
  companyId: string,
  data: Record<string, unknown>,
  mode: "set" | "merge" | "update"
): Promise<void> {
  notePocketBaseRootWrite(companyId, 1);
  try {
    const m = await import("@/lib/pocketbaseData/pbSync");
    await m.pbWriteCompanyRoot(companyId, data, mode, { throwOnError: true });
  } finally {
    notePocketBaseRootWrite(companyId, -1);
  }
}

function scheduleLedgerChangeLog(ref: unknown, op: "create" | "update" | "delete"): void {
  const parsed = parseLedgerDocPath(ref);
  if (!parsed) return;
  if (isPocketBaseCompanyId(parsed.fsCompanyId)) return;
  const safe = `${Date.now()}_${parsed.collectionName}_${parsed.docId}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 180);
  const changeRef = doc(firestore, `companies/${parsed.fsCompanyId}/_pl_change_log`, safe);
  void firestoreSetDoc(changeRef, {
    collectionName: parsed.collectionName,
    docId: parsed.docId,
    op,
    at: serverTimestamp(),
    source: "firestoreMutationsInternal",
  }).catch(() => {
    /* change feed is best-effort; target write already succeeded */
  });
}

export const setDoc: typeof firestoreSetDoc = (async (...args: unknown[]) => {
  if (isPocketBaseChangeLogRef(args[0])) return;
  const udocSet = udocDocPath(args[0]);
  if (udocSet) {
    await udocCommit([udocWriteOf("set", udocSet, args)]);
    return;
  }
  const pb = pocketBaseLedgerPath(args[0]);
  if (pb) {
    await writePocketBaseLedgerDoc(pb, (args[1] as Record<string, unknown>) || {}, setOptionsMode(args[2]));
    return;
  }
  // Company root of a PocketBase company: the server is the only copy (both logins). Firestore is
  // authentication only — it must not hold a second, drifting copy of the company profile.
  const sessionRootId = hasServerSession() ? pocketBaseRootCompanyId(args[0]) : null;
  if (sessionRootId) {
    const mode = setOptionsMode(args[2]);
    await writePocketBaseRootServerOnly(sessionRootId, (args[1] as Record<string, unknown>) || {}, mode === "merge" ? "merge" : "set");
    return;
  }
  const result = await (firestoreSetDoc as (...inner: unknown[]) => Promise<void>)(...args);
  scheduleLedgerChangeLog(args[0], "update");
  const rootId = pocketBaseRootCompanyId(args[0]);
  if (rootId) mirrorPocketBaseCompanyRoot(rootId, (args[1] as Record<string, unknown>) || {}, setOptionsMode(args[2]));
  return result;
}) as typeof firestoreSetDoc;

export const updateDoc: typeof firestoreUpdateDoc = (async (...args: unknown[]) => {
  const udocUpd = udocDocPath(args[0]);
  if (udocUpd) {
    await udocCommit([udocWriteOf("update", udocUpd, args)]);
    return;
  }
  const pb = pocketBaseLedgerPath(args[0]);
  if (pb) {
    // updateDoc(ref, data) or updateDoc(ref, "field", value, ...)
    await writePocketBaseLedgerDoc(pb, updateArgsToPatch(args), "update");
    return;
  }
  const sessionRootId = hasServerSession() ? pocketBaseRootCompanyId(args[0]) : null;
  if (sessionRootId) {
    await writePocketBaseRootServerOnly(sessionRootId, updateArgsToPatch(args), "update");
    return;
  }
  const result = await (firestoreUpdateDoc as (...inner: unknown[]) => Promise<void>)(...args);
  scheduleLedgerChangeLog(args[0], "update");
  const rootId = pocketBaseRootCompanyId(args[0]);
  if (rootId) mirrorPocketBaseCompanyRoot(rootId, updateArgsToPatch(args), "update");
  return result;
}) as typeof firestoreUpdateDoc;

export const deleteDoc: typeof firestoreDeleteDoc = (async (...args: unknown[]) => {
  if (isPocketBaseChangeLogRef(args[0])) return;
  const udocDel = udocDocPath(args[0]);
  if (udocDel) {
    await udocCommit([udocWriteOf("delete", udocDel, args)]);
    return;
  }
  const pb = pocketBaseLedgerPath(args[0]);
  if (pb) {
    // soft delete on the server so other devices see it
    await writePocketBaseLedgerDoc(pb, { isDeleted: true, deletedAtMs: Date.now() }, "delete");
    return;
  }
  const result = await (firestoreDeleteDoc as (...inner: unknown[]) => Promise<void>)(...args);
  scheduleLedgerChangeLog(args[0], "delete");
  return result;
}) as typeof firestoreDeleteDoc;

export const addDoc: typeof firestoreAddDoc = (async (...args: unknown[]) => {
  const udocColl = udocCollectionPath(args[0]);
  if (udocColl) {
    const newRef = doc(args[0] as CollectionReference);
    await udocCommit([makeUdocWrite(`${udocColl}/${newRef.id}`, "set", (args[1] as Record<string, unknown>) || {})]);
    return newRef;
  }
  const pbColl = parseLedgerCollectionPath(args[0]);
  if (pbColl && isPocketBaseCompanyId(pbColl.fsCompanyId)) {
    // same auto-id as Firestore (generated locally), written to the server
    const ref = doc(args[0] as CollectionReference);
    await writePocketBaseLedgerDoc(
      { fsCompanyId: pbColl.fsCompanyId, collectionName: pbColl.collectionName, docId: ref.id },
      (args[1] as Record<string, unknown>) || {},
      "set"
    );
    return ref;
  }
  const result = await (firestoreAddDoc as (...inner: unknown[]) => Promise<DocumentReference>)(...args);
  const parsed = parseLedgerCollectionPath(args[0]);
  if (parsed && result?.id) {
    scheduleLedgerChangeLog(doc(firestore, `companies/${parsed.fsCompanyId}/${parsed.collectionName}`, result.id), "create");
  }
  return result;
}) as typeof firestoreAddDoc;

/* ------------------------------------------------------------------ */
/* batches, transactions, reads (Pocket Ledger Server companies)       */
/* ------------------------------------------------------------------ */

/** Firebase-only device (no PocketBase company): plain Firestore, unchanged. */
function noPocketBaseCompanies(): boolean {
  try {
    return listPocketBaseCompanyIds().length === 0;
  } catch {
    return true;
  }
}

/**
 * `writeBatch`: PocketBase company docs are committed in one server transaction per company
 * (`/api/pl/data/batch`, all or nothing); every other doc goes to a normal Firestore batch.
 */
export const writeBatch: typeof firestoreWriteBatch = ((fs: Parameters<typeof firestoreWriteBatch>[0]) => {
  if (noPocketBaseCompanies() && !isPocketBaseAppSessionActive()) return firestoreWriteBatch(fs);
  const calls: { kind: "set" | "update" | "delete"; args: unknown[] }[] = [];
  let committed = false;
  const guard = () => {
    if (committed) throw new Error("A write batch can no longer be used after commit() has been called.");
  };
  const batch = {
    set(...args: unknown[]) {
      guard();
      calls.push({ kind: "set", args });
      return batch;
    },
    update(...args: unknown[]) {
      guard();
      calls.push({ kind: "update", args });
      return batch;
    },
    delete(...args: unknown[]) {
      guard();
      calls.push({ kind: "delete", args });
      return batch;
    },
    async commit(): Promise<void> {
      guard();
      committed = true;
      const pbByCompany = new Map<string, PbBatchOp[]>();
      const udocBatch: UdocWrite[] = [];
      let fsBatch: WriteBatch | null = null;
      for (const c of calls) {
        if (isPocketBaseChangeLogRef(c.args[0])) continue;
        const up = udocDocPath(c.args[0]);
        if (up) {
          udocBatch.push(udocWriteOf(c.kind, up, c.args));
          continue;
        }
        const pb = pocketBaseLedgerPath(c.args[0]);
        if (pb) {
          const list = pbByCompany.get(pb.fsCompanyId) || [];
          list.push(callToPbOp(c.kind, pb, c.args));
          pbByCompany.set(pb.fsCompanyId, list);
        } else {
          fsBatch = fsBatch || firestoreWriteBatch(fs);
          (fsBatch[c.kind] as (...a: unknown[]) => unknown)(...c.args);
        }
      }
      for (const [companyId, ops] of pbByCompany) await commitPocketBaseOps(companyId, ops);
      if (udocBatch.length) await udocCommit(udocBatch);
      if (fsBatch) await fsBatch.commit();
      for (const c of calls) {
        const rootId = c.kind === "delete" ? null : pocketBaseRootCompanyId(c.args[0]);
        if (!rootId) continue;
        if (c.kind === "set") mirrorPocketBaseCompanyRoot(rootId, (c.args[1] as Record<string, unknown>) || {}, setOptionsMode(c.args[2]));
        else mirrorPocketBaseCompanyRoot(rootId, updateArgsToPatch(c.args), "update");
      }
    },
  };
  return batch as unknown as WriteBatch;
}) as typeof firestoreWriteBatch;

type PbDocRead = { exists: boolean; data: Record<string, unknown> | null };

/** Minimal DocumentSnapshot for a server / mirror read. */
function pbSnapshot(ref: unknown, r: PbDocRead): unknown {
  const data = r.exists && r.data ? r.data : undefined;
  return {
    id: String((ref as { id?: unknown })?.id || ""),
    ref,
    exists: () => r.exists,
    data: () => (data ? { ...data } : undefined),
    get: (field: unknown) => {
      let cur: unknown = data;
      for (const part of String(field).split(".")) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    },
    metadata: { hasPendingWrites: false, fromCache: false },
  };
}

class PocketBaseTxFallback extends Error {
  constructor() {
    super("firestore transaction");
    this.name = "PocketBaseTxFallback";
  }
}

const MIXED_TX_MESSAGE = "Pocket Ledger Server: one transaction cannot mix server company data with Firebase documents";

/** Firestore transaction that refuses PocketBase company docs (they must never reach Firestore). */
function runGuardedFirestoreTransaction<T>(
  fs: Parameters<typeof firestoreRunTransaction>[0],
  updateFn: (tx: Transaction) => Promise<T>,
  options?: Parameters<typeof firestoreRunTransaction>[2]
): Promise<T> {
  // PocketBase company root docs written in the transaction: copied to the server afterwards
  let rootIds = new Set<string>();
  const noteRoot = (ref: unknown) => {
    const id = pocketBaseRootCompanyId(ref);
    if (id) rootIds.add(id);
  };
  const run = firestoreRunTransaction(
    fs,
    (realTx) => {
      rootIds = new Set<string>();
      const check = (ref: unknown) => {
        if (pocketBaseLedgerPath(ref)) throw new Error(MIXED_TX_MESSAGE);
      };
      const tx = {
        get: (ref: unknown) => {
          check(ref);
          return (realTx.get as (r: unknown) => unknown)(ref);
        },
        set: (...a: unknown[]) => {
          if (isPocketBaseChangeLogRef(a[0])) return tx;
          check(a[0]);
          (realTx.set as (...x: unknown[]) => unknown)(...a);
          noteRoot(a[0]);
          return tx;
        },
        update: (...a: unknown[]) => {
          check(a[0]);
          (realTx.update as (...x: unknown[]) => unknown)(...a);
          noteRoot(a[0]);
          return tx;
        },
        delete: (ref: unknown) => {
          if (isPocketBaseChangeLogRef(ref)) return tx;
          check(ref);
          realTx.delete(ref as DocumentReference);
          return tx;
        },
      };
      return updateFn(tx as unknown as Transaction);
    },
    options
  );
  return run.then((value) => {
    if (rootIds.size) {
      const ids = Array.from(rootIds);
      void import("@/lib/pocketbaseData/pbSync")
        .then(async (m) => {
          for (const id of ids) await m.pbPushCompanyRootFromFirestore(id);
        })
        .catch(() => {
          /* next pull retries (root marked dirty) */
        });
    }
    return value;
  });
}

/**
 * `runTransaction`: for a PocketBase company, reads come from the server and all writes are
 * committed in one server transaction that first checks the read docs did not change
 * (version check -> 409 -> the callback is re-run, max 5 times, like Firestore).
 * Firebase documents: the normal Firestore transaction.
 */
export const runTransaction: typeof firestoreRunTransaction = (async <T>(
  fs: Parameters<typeof firestoreRunTransaction>[0],
  updateFn: (tx: Transaction) => Promise<T>,
  options?: Parameters<typeof firestoreRunTransaction>[2]
): Promise<T> => {
  if (noPocketBaseCompanies() && !isPocketBaseAppSessionActive()) return firestoreRunTransaction(fs, updateFn, options);
  const { pbReadAppDoc } = await import("@/lib/pocketbaseData/pbSync");
  const { PocketBaseRequestError } = await import("@/lib/pocketbaseData/pbClient");
  const maxAttempts = Math.max(1, Math.min(5, Number(options?.maxAttempts) || 5));
  for (let attempt = 1; ; attempt++) {
    let companyId: string | null = null;
    let fallback = false;
    const expects: PbExpect[] = [];
    const seen = new Set<string>();
    const ops: PbBatchOp[] = [];
    const udocOps: UdocWrite[] = [];
    const pbRef = (ref: unknown): LedgerDocPath => {
      const pb = pocketBaseLedgerPath(ref);
      if (!pb) {
        if (companyId) throw new Error(MIXED_TX_MESSAGE);
        fallback = true;
        throw new PocketBaseTxFallback();
      }
      if (companyId && companyId !== pb.fsCompanyId) {
        throw new Error("Pocket Ledger Server: one transaction can only change one company");
      }
      companyId = pb.fsCompanyId;
      return pb;
    };
    const tx = {
      async get(ref: unknown) {
        const up = udocDocPath(ref);
        if (up) {
          if (companyId) throw new Error(MIXED_TX_MESSAGE);
          return pbSnapshot(ref, await udocReadDoc(up));
        }
        const pb = pbRef(ref);
        const r = await pbReadAppDoc(pb.fsCompanyId, pb.collectionName, pb.docId);
        const key = `${pb.collectionName}/${pb.docId}`;
        if (!seen.has(key)) {
          seen.add(key);
          expects.push({ coll: pb.collectionName, id: pb.docId, exists: r.exists, version: r.exists ? r.version : undefined });
        }
        return pbSnapshot(ref, r);
      },
      set(...a: unknown[]) {
        const up = udocDocPath(a[0]);
        if (up) {
          udocOps.push(udocWriteOf("set", up, a));
          return tx;
        }
        if (!isPocketBaseChangeLogRef(a[0])) ops.push(callToPbOp("set", pbRef(a[0]), a));
        return tx;
      },
      update(...a: unknown[]) {
        const up = udocDocPath(a[0]);
        if (up) {
          udocOps.push(udocWriteOf("update", up, a));
          return tx;
        }
        ops.push(callToPbOp("update", pbRef(a[0]), a));
        return tx;
      },
      delete(ref: unknown) {
        const up = udocDocPath(ref);
        if (up) {
          udocOps.push(udocWriteOf("delete", up, [ref]));
          return tx;
        }
        if (!isPocketBaseChangeLogRef(ref)) ops.push(callToPbOp("delete", pbRef(ref), [ref]));
        return tx;
      },
    };
    let result: T;
    try {
      result = await updateFn(tx as unknown as Transaction);
    } catch (e) {
      if (fallback && !companyId) return runGuardedFirestoreTransaction(fs, updateFn, options);
      throw e;
    }
    if (udocOps.length) {
      if (companyId || ops.length) throw new Error(MIXED_TX_MESSAGE);
      await udocCommit(udocOps);
      return result;
    }
    if (fallback && !companyId) return runGuardedFirestoreTransaction(fs, updateFn, options);
    if (!companyId || !ops.length) return result;
    try {
      await commitPocketBaseOps(companyId, ops, expects);
      return result;
    } catch (e) {
      if (e instanceof PocketBaseRequestError && e.status === 409 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 40)));
        continue;
      }
      throw e;
    }
  }
}) as typeof firestoreRunTransaction;

/**
 * `getDoc`: a PocketBase company doc is read from the server (fresh), or from the local
 * SQLite mirror when the server is not reachable. Everything else: Firestore.
 */
export const getDoc: typeof firestoreGetDoc = (async (...args: unknown[]) => {
  const up = udocDocPath(args[0]);
  if (up) return pbSnapshot(args[0], await udocReadDoc(up));
  const pb = pocketBaseLedgerPath(args[0]);
  if (!pb) return (firestoreGetDoc as (...inner: unknown[]) => Promise<unknown>)(...args);
  let r: PbDocRead;
  try {
    const { pbReadAppDoc } = await import("@/lib/pocketbaseData/pbSync");
    r = await pbReadAppDoc(pb.fsCompanyId, pb.collectionName, pb.docId);
  } catch {
    const { getCompanyDocFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    const local = (await getCompanyDocFromBrowserDb(pb.fsCompanyId, pb.collectionName, pb.docId)) as
      | Record<string, unknown>
      | null;
    r = { exists: !!local, data: local };
  }
  return pbSnapshot(args[0], r);
}) as typeof firestoreGetDoc;

export type { CollectionReference, DocumentReference };
