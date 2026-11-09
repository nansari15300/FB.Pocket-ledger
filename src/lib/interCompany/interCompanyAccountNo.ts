/**
 * Inter-company A/c No — prefix + 14 digit (15 total); company legacy 15-digit bhi valid.
 */
import { collection, collectionGroup, limit, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { firestore } from "@/lib/plClientSession";
import { listLocalCompanies } from "@/lib/localCompanyStore";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

/** UI maxLength / validation — 1 prefix + 14 digits */
export const INTER_COMPANY_AC_NO_LENGTH = 15;
export const INTER_COMPANY_AC_NUMERIC_LEN = 14;

export type InterCompanyAcEntityKind = InterCompanyEntityKind | "company";

/** Master type → start letter */
export const INTER_COMPANY_AC_PREFIX: Record<InterCompanyAcEntityKind, string> = {
  company: "C",
  party: "P",
  bank: "B",
  staff: "S",
  tax: "T",
  expense: "E",
};

const PREFIXES = "PBSTEC";
const NUM_MIN = 100_000_000_000_000;
const NUM_MAX = 999_999_999_999_999;

const COLLECTION_GROUP_BY_KIND: Record<
  Exclude<InterCompanyAcEntityKind, "company">,
  string
> = {
  party: "parties",
  bank: "bank_accounts",
  staff: "staff",
  tax: "taxes",
  expense: "expense_accounts",
};

export type InterCompanyAcNoExclude = {
  kind: InterCompanyAcEntityKind;
  companyId?: string;
  entityId?: string;
};

/** Naya prefixed A/c No (P/B/S/T/E/C + 14 random digits) */
export function generatePrefixedInterCompanyAcNo(kind: InterCompanyAcEntityKind): string {
  const prefix = INTER_COMPANY_AC_PREFIX[kind];
  const range = NUM_MAX - NUM_MIN + 1;
  const n = NUM_MIN + Math.floor(Math.random() * range);
  return `${prefix}${n}`;
}

/** Legacy company-only 15 digit (purani rows) */
export function generateLegacyCompanyInterCompanyAcNo(): string {
  const range = NUM_MAX - NUM_MIN + 1;
  const n = NUM_MIN + Math.floor(Math.random() * range);
  return String(n);
}

/** Type + digits normalize; legacy sirf company 15-digit */
export function normalizeInterCompanyAcNo(input: string | null | undefined): string {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!raw) return "";
  const prefixed = raw.match(new RegExp(`^([${PREFIXES}])(\\d*)$`));
  if (prefixed) {
    const p = prefixed[1]!;
    const digits = prefixed[2]!.replace(/\D/g, "").slice(0, INTER_COMPANY_AC_NUMERIC_LEN);
    return p + digits;
  }
  return raw.replace(/\D/g, "").slice(0, INTER_COMPANY_AC_NO_LENGTH);
}

export function readInterCompanyAcNoFromDoc(
  doc: { interCompanyAccountNo?: string | null } | null | undefined
): string {
  const raw = normalizeInterCompanyAcNo(doc?.interCompanyAccountNo);
  return isValidInterCompanyAcNo(raw) ? raw : "";
}

/** Company row — prefixed C… ya legacy 15-digit */
export function readCompanyInterCompanyAcNo(
  company: { interCompanyAccountNo?: string | null } | null | undefined
): string {
  return readInterCompanyAcNoFromDoc(company);
}

/** Valid: P/B/S/T/E/C + 14 digits, ya legacy company 15-digit */
export function isValidInterCompanyAcNo(
  input: string | null | undefined,
  expectedKind?: InterCompanyAcEntityKind
): boolean {
  const n = normalizeInterCompanyAcNo(input);
  if (!n) return false;
  const prefixed = n.match(new RegExp(`^([${PREFIXES}])(\\d{${INTER_COMPANY_AC_NUMERIC_LEN}})$`));
  if (prefixed) {
    if (!expectedKind) return true;
    return prefixed[1] === INTER_COMPANY_AC_PREFIX[expectedKind];
  }
  if (/^\d{15}$/.test(n)) {
    return !expectedKind || expectedKind === "company";
  }
  return false;
}

export function interCompanyAcNoPrefix(acNo: string): string | null {
  const n = normalizeInterCompanyAcNo(acNo);
  const m = n.match(new RegExp(`^([${PREFIXES}])`));
  return m ? m[1]! : /^\d{15}$/.test(n) ? "C" : null;
}

function docMatchesExclude(
  snapId: string,
  snapCompanyId: string | undefined,
  exclude: InterCompanyAcNoExclude | undefined
): boolean {
  if (!exclude) return false;
  if (exclude.kind === "company") return exclude.entityId === snapId;
  return exclude.entityId === snapId && exclude.companyId === snapCompanyId;
}

/** SQLite / browser mirror — global duplicate */
async function isInterCompanyAcNoTakenLocally(
  acNo: string,
  exclude?: InterCompanyAcNoExclude
): Promise<boolean> {
  try {
    const companies = await listLocalCompanies({ includeDeleted: true });
    for (const row of companies) {
      if (docMatchesExclude(row.id, undefined, exclude)) continue;
      if (readCompanyInterCompanyAcNo(row as { interCompanyAccountNo?: string }) === acNo) {
        return true;
      }
    }
    const collNames = Object.values(COLLECTION_GROUP_BY_KIND);
    for (const c of companies) {
      const cid = c.id;
      if (!cid) continue;
      for (const coll of collNames) {
        const docs = await listCompanyDocsFromBrowserDb(cid, coll, { includeSoftDeleted: true });
        for (const d of docs) {
          const id = String((d as { id?: string }).id ?? "");
          if (docMatchesExclude(id, cid, exclude)) continue;
          const stored = readInterCompanyAcNoFromDoc(d as { interCompanyAccountNo?: string });
          if (stored === acNo) return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Firestore — companies + collectionGroup masters */
async function isInterCompanyAcNoTakenInFirestore(
  acNo: string,
  exclude?: InterCompanyAcNoExclude
): Promise<boolean> {
  try {
    const companySnap = await getDocs(
      query(collection(firestore, "companies"), where("interCompanyAccountNo", "==", acNo), limit(1))
    );
    if (!companySnap.empty) {
      const hit = companySnap.docs[0]!;
      if (!docMatchesExclude(hit.id, undefined, exclude)) return true;
    }

    for (const cg of Object.values(COLLECTION_GROUP_BY_KIND)) {
      const snap = await getDocs(
        query(collectionGroup(firestore, cg), where("interCompanyAccountNo", "==", acNo), limit(1))
      );
      if (snap.empty) continue;
      const hit = snap.docs[0]!;
      const data = hit.data() as { companyId?: string };
      if (!docMatchesExclude(hit.id, data.companyId, exclude)) return true;
    }
  } catch (err) {
    console.warn("[interCompany] Firestore A/c No uniqueness check skipped", err);
    return false;
  }
  return false;
}

/** Unique prefixed number — create / backfill */
export async function generateUniqueEntityInterCompanyAcNo(
  kind: InterCompanyAcEntityKind,
  exclude?: InterCompanyAcNoExclude,
  maxAttempts = 12
): Promise<string> {
  if (!isInterCompanySystemEnabled()) return "";
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generatePrefixedInterCompanyAcNo(kind);
    if (await isInterCompanyAcNoTakenLocally(candidate, exclude)) continue;
    if (!isLocalOnlyMode()) {
      if (await isInterCompanyAcNoTakenInFirestore(candidate, exclude)) continue;
    }
    return candidate;
  }
  throw new Error("unique_inter_company_ac_no_failed");
}

/** @deprecated alias — company create / backfill */
export async function generateUniqueInterCompanyAccountNo(
  excludeCompanyId?: string,
  maxAttempts = 12
): Promise<string> {
  return generateUniqueEntityInterCompanyAcNo(
    "company",
    excludeCompanyId ? { kind: "company", entityId: excludeCompanyId } : undefined,
    maxAttempts
  );
}

/** Create payload helper */
export async function interCompanyAcNoForNewEntity(
  kind: InterCompanyAcEntityKind
): Promise<string> {
  return generateUniqueEntityInterCompanyAcNo(kind);
}

export function firestoreCollectionForEntityKind(
  kind: Exclude<InterCompanyAcEntityKind, "company">
): string {
  return COLLECTION_GROUP_BY_KIND[kind];
}
