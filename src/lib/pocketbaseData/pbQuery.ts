/**
 * Firestore-free `Query` for the Pocket Ledger Server.
 *
 * The query keeps the *filters and order* as plain data (`__plQuery`), which `pbReadSeam` evaluates
 * against the device's SQLite mirror / the server rows. Nothing here talks to Firestore, so a query
 * object can be built on any screen without touching the network.
 *
 * Surface kept from the Firestore client (`where` / `orderBy` / `limit` / `startAfter` / `get` /
 * `onSnapshot` / `withConverter` / `ref`) because that is how the app builds its lists.
 */

import { decodeTimestamps, encodeTimestamps, FieldPath, Timestamp } from "@/lib/pocketbaseData/pbValues";
import {
  isPbCollectionRef,
  PbCollectionReference,
  PbDocumentReference,
  pbRefPath,
  refSegmentsFrom,
  type Converter,
} from "@/lib/pocketbaseData/pbRef";

export type PbWhereOp =
  | "<"
  | "<="
  | "=="
  | "!="
  | ">="
  | ">"
  | "array-contains"
  | "in"
  | "not-in"
  | "array-contains-any";

export type PbFilter =
  | { kind: "field"; field: string[]; key: boolean; op: PbWhereOp; value: unknown }
  | { kind: "and" | "or"; filters: PbFilter[] };

export type PbOrderBy = { field: string[]; key: boolean; dir: "asc" | "desc" };

export type PbBound = { position: unknown[]; inclusive: boolean };

export type PbQuerySpec = {
  collection: string[];
  filters: PbFilter[];
  orderBy: PbOrderBy[];
  limit: number | null;
  limitToLast: boolean;
  startAt: PbBound | null;
  endAt: PbBound | null;
  startAfter: PbBound | null;
  endBefore: PbBound | null;
};

/** Field path as segments; `FieldPath.documentId()` becomes the `__name__` key. */
function fieldSegments(field: unknown): { field: string[]; key: boolean } {
  if (field && typeof field === "object" && (field as { documentId?: unknown }).documentId === true) {
    return { field: ["__name__"], key: true };
  }
  if (field && typeof field === "object" && Array.isArray((field as { __segments?: unknown }).__segments)) {
    const segs = (field as { __segments: string[] }).__segments.map(String);
    const key = segs.length === 1 && segs[0] === "__name__";
    return { field: segs, key };
  }
  const raw = String(field ?? "");
  const segs = raw.split(".").filter(Boolean);
  const key = segs.length === 1 && segs[0] === "__name__";
  return { field: segs.length ? segs : ["__name__"], key };
}

/** `where(a, "==", b)` | `where(new Filter(...))` | `where(a, "in", [...])` */
function buildFilter(args: readonly unknown[]): PbFilter {
  const first = args[0] as { __plFilter?: PbFilter } | undefined;
  if (first && first.__plFilter) return first.__plFilter;
  const [field, op, value] = args as [unknown, string, unknown];
  const { field: segs, key } = fieldSegments(field);
  return {
    kind: "field",
    field: segs,
    key,
    op: String(op) as PbWhereOp,
    value: encodeTimestamps(value),
  };
}

function valuesOf(...args: unknown[]): unknown[] {
  // startAfter(a, b) or startAfter([a, b])
  if (args.length === 1 && Array.isArray(args[0])) return (args[0] as unknown[]).map(encodeTimestamps);
  return args.map(encodeTimestamps);
}

export class PbQuery {
  readonly kind = "query";
  readonly type = "query";
  readonly __isPbRef = true;
  readonly __plQuery: PbQuerySpec;
  readonly converter: Converter | null;

  constructor(spec: PbQuerySpec, converter: Converter | null = null) {
    this.__plQuery = spec;
    this.converter = converter;
  }

  /** `query.type` — `"query"` or `"collection"` (code checks this to pick a hook). */
  get queryType(): string {
    return "query";
  }

  static fromCollection(collection: PbCollectionReference | string[], converter: Converter | null = null): PbQuery {
    return new PbQuery(
      {
        collection: Array.isArray(collection) ? collection : collection.__segments,
        filters: [],
        orderBy: [],
        limit: null,
        limitToLast: false,
        startAt: null,
        endAt: null,
        startAfter: null,
        endBefore: null,
      },
      converter
    );
  }

  private next(patch: Partial<PbQuerySpec>): PbQuery {
    return new PbQuery({ ...this.__plQuery, ...patch }, this.converter);
  }

  get path(): string {
    return this.__plQuery.collection.join("/");
  }

  /** `query.ref` — the collection this query runs on. */
  get ref(): PbCollectionReference {
    return new PbCollectionReference(this.__plQuery.collection);
  }

  get firestore(): unknown {
    return { __plServerStore: true };
  }

  withConverter(converter: Converter | null): PbQuery {
    return new PbQuery(this.__plQuery, converter);
  }

  where(fieldOrFilter: unknown, op?: string, value?: unknown): PbQuery {
    const f = op === undefined ? buildFilter([fieldOrFilter]) : buildFilter([fieldOrFilter, op, value]);
    return this.next({ filters: [...this.__plQuery.filters, f] });
  }

  orderBy(field: unknown, dir: "asc" | "desc" = "asc"): PbQuery {
    const { field: segs, key } = fieldSegments(field);
    return this.next({
      orderBy: [...this.__plQuery.orderBy, { field: segs, key, dir: dir === "desc" ? "desc" : "asc" }],
    });
  }

  limit(n: number): PbQuery {
    return this.next({ limit: Math.max(0, Math.floor(n)), limitToLast: false });
  }

  limitToLast(n: number): PbQuery {
    return this.next({ limit: Math.max(0, Math.floor(n)), limitToLast: true });
  }

  startAt(...args: unknown[]): PbQuery {
    return this.next({ startAt: { position: valuesOf(...args), inclusive: true } });
  }

  startAfter(...args: unknown[]): PbQuery {
    return this.next({ startAfter: { position: valuesOf(...args), inclusive: false } });
  }

  endAt(...args: unknown[]): PbQuery {
    return this.next({ endAt: { position: valuesOf(...args), inclusive: true } });
  }

  endBefore(...args: unknown[]): PbQuery {
    return this.next({ endBefore: { position: valuesOf(...args), inclusive: false } });
  }

  isEqual(other: unknown): boolean {
    return (
      !!other &&
      typeof other === "object" &&
      JSON.stringify((other as { __plQuery?: unknown }).__plQuery ?? null) === JSON.stringify(this.__plQuery)
    );
  }
}

/** Result of `collectionGroup(name)` — a query over every collection with that name. */
export class PbCollectionGroupQuery extends PbQuery {
  readonly groupId: string;
  constructor(name: string, converter: Converter | null = null) {
    super(
      {
        collection: [String(name)],
        filters: [],
        orderBy: [],
        limit: null,
        limitToLast: false,
        startAt: null,
        endAt: null,
        startAfter: null,
        endBefore: null,
      },
      converter
    );
    this.groupId = String(name);
  }
}

/** `collection(db, ...parts)` */
export function pbCollection(...args: readonly unknown[]): PbCollectionReference {
  const first = args[0];
  if (first && typeof first === "object" && isPbCollectionRef(first)) return first;
  // Split slash paths the same way Firestore does ("companies/id/coll" -> 3 segments).
  // Separate-segment and existing ref-object callers still go through refSegmentsFrom.
  return new PbCollectionReference(refSegmentsFrom(args));
}

/** `doc(db, ...parts)` or `doc(collectionRef, id)`. */
export function pbDoc(...args: readonly unknown[]): PbDocumentReference {
  const first = args[0];
  if (first && typeof first === "object" && (first as { kind?: unknown }).kind === "collection") {
    const [id] = args.slice(1) as [string?];
    return (first as PbCollectionReference).doc(id === undefined ? undefined : String(id));
  }
  return new PbDocumentReference(refSegmentsFrom(args));
}

export { FieldPath, Timestamp, decodeTimestamps, encodeTimestamps, pbRefPath };
