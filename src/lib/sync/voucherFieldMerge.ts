/**
 * Field-level merge for voucher `allocations` and `fileUrls`.
 *
 * Used when two devices edit the same voucher (link allocation vs narration, or
 * concurrent links) so a newer doc timestamp does not drop the other device's
 * allocations, and a full SET is never required to reconcile those fields.
 *
 * Deletions: if either side stamped `allocationsUpdatedAt` / `fileUrlsUpdatedAt`,
 * the newer field timestamp is authoritative for the whole list (adds + deletes).
 * Legacy rows without a field stamp are unioned by stable key so we never drop
 * an incoming or local add. Per-item `deleted: true` (or amount 0 + deleted)
 * tombstones win when their side's timestamp is newer.
 */

export type AllocMergeItem = {
  voucherId?: unknown;
  amount?: unknown;
  taxableAmount?: unknown;
  taxAmount?: unknown;
  netAmount?: unknown;
  linkedAccountId?: unknown;
  entityTxnId?: unknown;
  deleted?: unknown;
  [k: string]: unknown;
};

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Stable identity for one bill-wise allocation row. */
export function allocationStableKey(a: AllocMergeItem | null | undefined): string {
  if (!a) return "";
  const ent = str(a.entityTxnId);
  if (ent) return ent;
  const vid = str(a.voucherId);
  const lid = str(a.linkedAccountId);
  return lid ? `${vid}::${lid}` : vid;
}

function isAllocTombstone(a: AllocMergeItem): boolean {
  return a.deleted === true;
}

function fieldMs(doc: Record<string, unknown> | null | undefined, key: string): number {
  if (!doc) return 0;
  const n = Number(doc[key]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function readAllocationsUpdatedAt(doc: Record<string, unknown> | null | undefined): number {
  return fieldMs(doc, "allocationsUpdatedAt");
}

export function readFileUrlsUpdatedAt(doc: Record<string, unknown> | null | undefined): number {
  return fieldMs(doc, "fileUrlsUpdatedAt");
}

function listAllocations(doc: Record<string, unknown> | null | undefined): AllocMergeItem[] {
  const raw = doc?.allocations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is AllocMergeItem => !!x && typeof x === "object");
}

/**
 * Merge two allocation lists.
 * - If exactly one side (or the newer side) has `allocationsUpdatedAt`, that side
 *   wins for deletions; keys only on the older side are dropped.
 * - If neither side has a field stamp (legacy): union by key (no implicit deletes).
 * - Same key on both: the side with the newer field/doc timestamp wins; a newer
 *   tombstone removes the key from the result.
 */
export function mergeAllocationsLists(opts: {
  local: AllocMergeItem[];
  incoming: AllocMergeItem[];
  localFieldMs: number;
  incomingFieldMs: number;
  localDocMs: number;
  incomingDocMs: number;
}): AllocMergeItem[] {
  const localTs = opts.localFieldMs > 0 ? opts.localFieldMs : opts.localDocMs;
  const incomingTs = opts.incomingFieldMs > 0 ? opts.incomingFieldMs : opts.incomingDocMs;
  const haveFieldStamp = opts.localFieldMs > 0 || opts.incomingFieldMs > 0;
  const incomingNewer = incomingTs > localTs;
  const localNewer = localTs > incomingTs;
  // When a field stamp exists, the newer field (or doc if only one side stamped) is
  // authoritative for deletes. Tie with stamps: union (don't drop either add).
  const dropLocalOnly = haveFieldStamp && incomingNewer && opts.incomingFieldMs > 0;
  const dropIncomingOnly = haveFieldStamp && localNewer && opts.localFieldMs > 0;

  const map = new Map<string, { item: AllocMergeItem; ts: number; from: "local" | "incoming" }>();
  const put = (item: AllocMergeItem, ts: number, from: "local" | "incoming") => {
    const key = allocationStableKey(item);
    if (!key) return;
    const prev = map.get(key);
    if (!prev || ts >= prev.ts) map.set(key, { item, ts, from });
  };
  for (const a of opts.local) put(a, localTs, "local");
  for (const a of opts.incoming) put(a, incomingTs, "incoming");

  const out: AllocMergeItem[] = [];
  for (const [key, rec] of map) {
    const inLocal = opts.local.some((a) => allocationStableKey(a) === key);
    const inIncoming = opts.incoming.some((a) => allocationStableKey(a) === key);
    if (!inIncoming && dropLocalOnly) continue;
    if (!inLocal && dropIncomingOnly) continue;
    if (isAllocTombstone(rec.item)) continue;
    out.push(rec.item);
  }
  return out;
}

const LOCAL_PREFIX = "local:";

export function isLocalFileRef(url: unknown): url is string {
  return typeof url === "string" && url.startsWith(LOCAL_PREFIX) && url.length > LOCAL_PREFIX.length;
}

export function isServerFileRef(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length > 0 &&
    (url.startsWith("pbatt:") || /^https?:\/\//i.test(url))
  );
}

export function listFileUrls(doc: Record<string, unknown> | null | undefined): string[] {
  const raw = doc?.fileUrls;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim());
}

/**
 * Strip every `local:` ref from a value (deep). Used so a payload is never
 * sent to the server with device-only file refs.
 */
export function stripLocalFileRefsDeep<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return isLocalFileRef(v) ? undefined : v;
    if (Array.isArray(v)) return v.map(walk).filter((x) => x !== undefined);
    if (v == null || typeof v !== "object") return v;
    if (v instanceof Date) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      const e = walk(val);
      if (e !== undefined) out[k] = e;
    }
    return out;
  };
  return walk(value) as T;
}

/** Collect `pbatt:` (and https) refs from a voucher / doc so the receiver can download exactly those files. */
export function collectRemoteFileRefs(v: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("pbatt:") || /^https?:\/\//i.test(s)) into.add(s);
    return into;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectRemoteFileRefs(x, into);
    return into;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) collectRemoteFileRefs(x, into);
  }
  return into;
}

export function collectLocalFileRefs(v: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof v === "string") {
    if (isLocalFileRef(v)) into.add(v);
    return into;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectLocalFileRefs(x, into);
    return into;
  }
  if (v && typeof v === "object" && !(v instanceof Date) && typeof (v as { toDate?: unknown }).toDate !== "function") {
    for (const x of Object.values(v as Record<string, unknown>)) collectLocalFileRefs(x, into);
  }
  return into;
}

/**
 * Merge fileUrls. Prefer `pbatt:` / https over `local:` for the same slot.
 * If `fileUrlsUpdatedAt` is present, the newer field stamp is authoritative
 * (including intentional empty = delete all). Legacy: union server refs and
 * keep unresolved local refs only if the other side has no replacement.
 */
export function mergeFileUrlsLists(opts: {
  local: string[];
  incoming: string[];
  localFieldMs: number;
  incomingFieldMs: number;
  localDocMs: number;
  incomingDocMs: number;
  incomingHasField: boolean;
  localHasField: boolean;
}): string[] {
  const localTs = opts.localFieldMs > 0 ? opts.localFieldMs : opts.localDocMs;
  const incomingTs = opts.incomingFieldMs > 0 ? opts.incomingFieldMs : opts.incomingDocMs;
  const haveFieldStamp = opts.localFieldMs > 0 || opts.incomingFieldMs > 0;

  if (haveFieldStamp) {
    if (opts.incomingFieldMs > opts.localFieldMs) return opts.incoming.filter((u) => !isLocalFileRef(u) || opts.incoming.includes(u));
    if (opts.localFieldMs > opts.incomingFieldMs) {
      // Still adopt incoming pbatt: over local: on the same index / as replacements.
      return adoptServerRefs(opts.local, opts.incoming);
    }
  }

  if (opts.incomingHasField && opts.incoming.length === 0 && incomingTs >= localTs) return [];
  if (opts.localHasField && opts.local.length === 0 && localTs > incomingTs) {
    return opts.incoming.filter(isServerFileRef);
  }

  return adoptServerRefs(opts.local, opts.incoming);
}

function adoptServerRefs(local: string[], incoming: string[]): string[] {
  const incomingServer = incoming.filter(isServerFileRef);
  const used = new Set<string>();
  const byIndex = local.map((u, i) => {
    if (isLocalFileRef(u) && isServerFileRef(incoming[i])) {
      used.add(incoming[i]!);
      return incoming[i]!;
    }
    if (isServerFileRef(u)) {
      used.add(u);
      return u;
    }
    return u;
  });
  const extra = incomingServer.filter((u) => !used.has(u) && !byIndex.includes(u));
  // Drop local: that still have no server twin — caller may resolve them separately.
  const merged = [...byIndex, ...extra];
  return merged;
}

export type VoucherFieldMergeResult = {
  doc: Record<string, unknown>;
  allocationsChanged: boolean;
  fileUrlsChanged: boolean;
};

function fingerprintAlloc(list: AllocMergeItem[]): string {
  return list
    .map((a) => `${allocationStableKey(a)}:${num(a.amount)}:${num(a.taxAmount)}:${num(a.netAmount)}:${num(a.taxableAmount)}:${a.deleted === true ? "d" : ""}`)
    .sort()
    .join("|");
}

function fingerprintUrls(list: string[]): string {
  return list.join("\n");
}

export function mergeVoucherConflictFields(
  local: Record<string, unknown>,
  incoming: Record<string, unknown>,
  opts?: { localDocMs?: number; incomingDocMs?: number }
): VoucherFieldMergeResult {
  const localDocMs = opts?.localDocMs ?? 0;
  const incomingDocMs = opts?.incomingDocMs ?? 0;
  const localAllocs = listAllocations(local);
  const incomingAllocs = listAllocations(incoming);
  const mergedAllocs = mergeAllocationsLists({
    local: localAllocs,
    incoming: incomingAllocs,
    localFieldMs: readAllocationsUpdatedAt(local),
    incomingFieldMs: readAllocationsUpdatedAt(incoming),
    localDocMs,
    incomingDocMs,
  });
  const localUrls = Object.prototype.hasOwnProperty.call(local, "fileUrls") ? listFileUrls(local) : [];
  const incomingUrls = Object.prototype.hasOwnProperty.call(incoming, "fileUrls") ? listFileUrls(incoming) : [];
  const mergedUrls = mergeFileUrlsLists({
    local: localUrls,
    incoming: incomingUrls,
    localFieldMs: readFileUrlsUpdatedAt(local),
    incomingFieldMs: readFileUrlsUpdatedAt(incoming),
    localDocMs,
    incomingDocMs,
    incomingHasField: Object.prototype.hasOwnProperty.call(incoming, "fileUrls"),
    localHasField: Object.prototype.hasOwnProperty.call(local, "fileUrls"),
  });

  const allocationsChanged = fingerprintAlloc(localAllocs) !== fingerprintAlloc(mergedAllocs);
  const fileUrlsChanged = fingerprintUrls(localUrls) !== fingerprintUrls(mergedUrls);

  const fieldMsAlloc = Math.max(readAllocationsUpdatedAt(local), readAllocationsUpdatedAt(incoming));
  const fieldMsFiles = Math.max(readFileUrlsUpdatedAt(local), readFileUrlsUpdatedAt(incoming));

  const doc: Record<string, unknown> = { ...local };
  // Prefer incoming scalar fields when incoming is newer; keep local otherwise.
  // Always overlay the merged arrays.
  if (incomingDocMs > localDocMs) {
    for (const [k, v] of Object.entries(incoming)) {
      if (k === "allocations" || k === "fileUrls") continue;
      doc[k] = v;
    }
  }
  doc.allocations = mergedAllocs;
  doc.fileUrls = mergedUrls;
  if (fieldMsAlloc > 0) doc.allocationsUpdatedAt = fieldMsAlloc;
  if (fieldMsFiles > 0) doc.fileUrlsUpdatedAt = fieldMsFiles;
  return { doc, allocationsChanged, fileUrlsChanged };
}

/** True when the merge brought in allocations or file refs the local copy did not have. */
export function voucherFieldMergeChanged(result: VoucherFieldMergeResult): boolean {
  return result.allocationsChanged || result.fileUrlsChanged;
}
