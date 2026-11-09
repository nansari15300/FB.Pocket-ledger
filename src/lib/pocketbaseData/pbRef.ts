/**
 * Firestore-free document / collection references.
 *
 * The app's code was written against the Firestore client SDK and builds references with
 * `doc(firestore, "companies", id, "vouchers", vid)`. Building a reference never touches the network,
 * so the same calls keep working while the data is served by the Pocket Ledger Server: the reference
 * is just the path segments, and the read/write helpers in `pbCompat/firestore.ts` route those
 * segments to the server (via `pbReadSeam` / `pbWriteGateway`).
 *
 * Kept intentionally close to the Firestore surface the app uses:
 *   ref.id, ref.path, ref.parent, ref.parent.parent, ref.withConverter(), ref.collection(),
 *   ref.doc(), collection.ref / collection.parent, query ref equality.
 */

export type Converter = {
  toFirestore?: (value: unknown) => unknown;
  fromFirestore?: (snapshot: unknown, options?: unknown) => unknown;
};

export type PbRefKind = "doc" | "collection" | "query";

function cleanSegments(parts: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const s = String(p ?? "").trim();
    // "a/b/c" is accepted the same way Firestore accepts it.
    if (!s) {
      throw new Error("Invalid path segment");
    }
    if (s.includes("/")) {
      for (const seg of s.split("/")) if (seg) out.push(seg);
      continue;
    }
    out.push(s);
  }
  if (!out.length) throw new Error("Invalid path");
  return out;
}

/** Build path segments from `doc(db, ...parts)` / `collection(db, ...parts)` arguments. */
export function refSegmentsFrom(parts: readonly unknown[]): string[] {
  // A leading Firestore-ish db handle is not part of the path.
  const skipDb = parts.length > 1 && typeof parts[0] === "object" && parts[0] !== null && !Array.isArray(parts[0]) && !(parts[0] as { __segments?: unknown }).__segments;
  const rest = skipDb ? parts.slice(1) : parts;
  const flat: unknown[] = [];
  for (const p of rest) {
    if (p && typeof p === "object" && Array.isArray((p as { __segments?: unknown }).__segments)) {
      flat.push(...((p as { __segments: string[] }).__segments));
    } else {
      flat.push(p);
    }
  }
  return cleanSegments(flat);
}

export class PbDocumentReference {
  readonly kind: PbRefKind = "doc";
  readonly __segments: string[];
  readonly converter: Converter | null;
  /** Marks this as our reference (routes and seams test with `instanceof`). */
  readonly __isPbRef = true;

  constructor(segments: string[], converter: Converter | null = null) {
    // A document path has an even number of segments ("collection/id").
    if (segments.length % 2 !== 0) throw new Error(`Invalid document path: ${segments.join("/")}`);
    this.__segments = segments;
    this.converter = converter;
  }

  get id(): string {
    return this.__segments[this.__segments.length - 1] ?? "";
  }

  get path(): string {
    return this.__segments.join("/");
  }

  /** Firestore returns the parent *collection* reference for a document. */
  get parent(): PbCollectionReference | null {
    if (this.__segments.length < 2) return null;
    return new PbCollectionReference(this.__segments.slice(0, -1));
  }

  get firestore(): unknown {
    return PB_FIRESTORE_HANDLE;
  }

  withConverter(converter: Converter | null): PbDocumentReference {
    return new PbDocumentReference(this.__segments, converter);
  }

  collection(name: string): PbCollectionReference {
    return new PbCollectionReference([...this.__segments, String(name)]);
  }

  isEqual(other: unknown): boolean {
    return (
      !!other &&
      typeof other === "object" &&
      Array.isArray((other as { __segments?: unknown }).__segments) &&
      (other as { __segments: string[] }).__segments.join("/") === this.path
    );
  }

  toString(): string {
    return this.path;
  }
}

export class PbCollectionReference {
  readonly kind: PbRefKind = "collection";
  readonly __segments: string[];
  readonly converter: Converter | null;
  readonly __isPbRef = true;

  /** `ref.type` — `"collection"`; `useCollection` uses this to tell a ref from a query. */
  readonly type = "collection";

  constructor(segments: string[], converter: Converter | null = null) {
    // A collection path has an odd number of segments ("collection" or "collection/id/sub").
    if (segments.length % 2 !== 1) throw new Error(`Invalid collection path: ${segments.join("/")}`);
    this.__segments = segments;
    this.converter = converter;
  }

  get id(): string {
    return this.__segments[this.__segments.length - 1] ?? "";
  }

  get path(): string {
    return this.__segments.join("/");
  }

  /** Parent *document* reference for a subcollection. */
  get parent(): PbDocumentReference | null {
    if (this.__segments.length < 3) return null;
    return new PbDocumentReference(this.__segments.slice(0, -1));
  }

  get firestore(): unknown {
    return PB_FIRESTORE_HANDLE;
  }

  withConverter(converter: Converter | null): PbCollectionReference {
    return new PbCollectionReference(this.__segments, converter);
  }

  doc(id?: string): PbDocumentReference {
    if (id === undefined || id === "") {
      // Firestore generates an id when none is given (addDoc uses this).
      return new PbDocumentReference([...this.__segments, autoId()], this.converter);
    }
    return new PbDocumentReference([...this.__segments, ...cleanSegments([id])], this.converter);
  }

  isEqual(other: unknown): boolean {
    return (
      !!other &&
      typeof other === "object" &&
      Array.isArray((other as { __segments?: unknown }).__segments) &&
      (other as { __segments: string[] }).__segments.join("/") === this.path
    );
  }

  toString(): string {
    return this.path;
  }
}

/** Placeholder `db` handed around as `firestore`; it only carries no path of its own. */
export const PB_FIRESTORE_HANDLE = Object.freeze({
  __plServerStore: true,
  app: { name: "[PL]" },
  toJSON() {
    return { type: "pb-firestore" };
  },
});

/** Firestore-style 20-char auto id (no external dependency). */
export function autoId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(20);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export function isPbDocRef(v: unknown): v is PbDocumentReference {
  return !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "doc" && Array.isArray((v as { __segments?: unknown }).__segments);
}

export function isPbCollectionRef(v: unknown): v is PbCollectionReference {
  return !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "collection" && Array.isArray((v as { __segments?: unknown }).__segments);
}

/** Path of any reference-shaped value (`path` string or `__segments` array). */
export function pbRefPath(ref: unknown): string | null {
  if (!ref || typeof ref !== "object") return null;
  const segs = (ref as { __segments?: unknown }).__segments;
  if (Array.isArray(segs)) return segs.map(String).join("/");
  const p = (ref as { path?: unknown }).path;
  return typeof p === "string" ? p : null;
}
