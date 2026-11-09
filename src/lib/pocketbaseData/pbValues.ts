/**
 * Firestore value sentinels for the client, without the Firebase SDK.
 *
 * The write gateway understands the same markers when it sends a change to the Pocket Ledger Server,
 * so `serverTimestamp()`, `increment(1)`, `arrayUnion(...)` and `deleteField()` keep their meaning
 * without pulling `firebase/firestore` into the bundle.
 */

export type PbFieldValueMarker = {
  readonly methodName: string;
  readonly __isPbFieldValue: true;
  isEqual(other: unknown): boolean;
};

function marker(methodName: string, extra?: Record<string, unknown>): PbFieldValueMarker {
  const full = `FieldValue.${methodName}`;
  return {
    methodName: full,
    __isPbFieldValue: true,
    ...(extra || {}),
    isEqual(other: unknown) {
      return !!other && typeof other === "object" && (other as { methodName?: unknown }).methodName === full;
    },
  };
}

export type ServerTimestampMarker = PbFieldValueMarker & { __isPbFieldValue: true };
export type DeleteFieldMarker = PbFieldValueMarker & { __isPbFieldValue: true };
export type IncrementMarker = PbFieldValueMarker & { __isPbFieldValue: true; operand: number };
export type ArrayUnionMarker = PbFieldValueMarker & { __isPbFieldValue: true; elements: unknown[] };
export type ArrayRemoveMarker = PbFieldValueMarker & { __isPbFieldValue: true; elements: unknown[] };

/** Matches the `FieldValue` type the app annotates. */
export type FieldValue =
  | ServerTimestampMarker
  | DeleteFieldMarker
  | IncrementMarker
  | ArrayUnionMarker
  | ArrayRemoveMarker;

/** `FieldValue.serverTimestamp()` */
export function serverTimestamp(): ServerTimestampMarker {
  return marker("serverTimestamp") as ServerTimestampMarker;
}

/** `FieldValue.delete()` */
export function deleteField(): DeleteFieldMarker {
  return marker("delete") as DeleteFieldMarker;
}

/** `FieldValue.increment(n)` */
export function increment(n: number): IncrementMarker {
  return marker("increment", { operand: Number(n) || 0 }) as IncrementMarker;
}

/** `FieldValue.arrayUnion(...)` */
export function arrayUnion(...elements: unknown[]): ArrayUnionMarker {
  return marker("arrayUnion", { elements }) as ArrayUnionMarker;
}

/** `FieldValue.arrayRemove(...)` */
export function arrayRemove(...elements: unknown[]): ArrayRemoveMarker {
  return marker("arrayRemove", { elements }) as ArrayRemoveMarker;
}

export function isFieldValue(v: unknown): v is FieldValue {
  return !!v && typeof v === "object" && (v as { __isPbFieldValue?: unknown }).__isPbFieldValue === true;
}

/**
 * `Timestamp` stand-in: same fields and helpers the app calls. The write gateway stores it as the
 * server's own `{__fsTs, seconds, nanoseconds}` JSON, and reads hand back instances of this class.
 */
export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = Math.trunc(seconds) || 0;
    this.nanoseconds = Math.max(0, Math.min(999_999_999, Math.trunc(nanoseconds) || 0));
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  static fromMillis(ms: number): Timestamp {
    const safe = Number.isFinite(ms) ? ms : Date.now();
    return new Timestamp(Math.floor(safe / 1000), (safe % 1000) * 1e6);
  }
  static fromDate(d: Date): Timestamp {
    return Timestamp.fromMillis(d.getTime());
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
  }
}

/** `FieldPath.documentId()` — order by document id. */
class PbFieldPath {
  readonly methodName = "FieldPath.documentId";
  readonly documentId = true;
}

export const FieldPath = {
  documentId(): PbFieldPath {
    return new PbFieldPath();
  },
};

/** Turn Firestore-style JSON (`{__fsTs:true,...}`) back into `Timestamp` values. */
export function decodeTimestamps<T>(v: T): T {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map((x) => decodeTimestamps(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o = v as { __fsTs?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (o.__fsTs === true && typeof o.seconds === "number") {
      return new Timestamp(o.seconds, Number(o.nanoseconds) || 0) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = decodeTimestamps(x);
    return out as unknown as T;
  }
  return v;
}

/** Turn `Date` / `Timestamp` into the stored JSON (server expects `{__fsTs}`). */
export function encodeTimestamps(v: unknown): unknown {
  if (v instanceof Timestamp) return { __fsTs: true, seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v instanceof Date) {
    const ms = v.getTime();
    return { __fsTs: true, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
  }
  return v;
}
