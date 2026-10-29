/**
 * Inter Company — company-level 12-char alphanumeric code (letters + digits mix).
 */
import { collection, doc, limit, query, updateDoc, where } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getLocalCompanyById, listLocalCompanies, upsertLocalCompany } from "@/lib/localCompanyStore";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

/** Company Code — exactly 12 chars, A–Z + 0–9, dono types zaroori */
export const INTER_COMPANY_COMPANY_CODE_LEN = 12;
export const INTER_COMPANY_COMPANY_CODE_MIN = INTER_COMPANY_COMPANY_CODE_LEN;
export const INTER_COMPANY_COMPANY_CODE_MAX = INTER_COMPANY_COMPANY_CODE_LEN;

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomAlnumChar(): string {
  return ALNUM[Math.floor(Math.random() * ALNUM.length)]!;
}

/** Input clean — uppercase A–Z / 0–9, max 12 */
export function normalizeInterCompanyCompanyCode(input: string | null | undefined): string {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, INTER_COMPANY_COMPANY_CODE_LEN);
}

/** Valid: 12 chars + kam se kam ek letter aur ek digit */
export function isValidInterCompanyCompanyCode(input: string | null | undefined): boolean {
  const c = normalizeInterCompanyCompanyCode(input);
  if (c.length !== INTER_COMPANY_COMPANY_CODE_LEN) return false;
  return /[A-Z]/.test(c) && /[0-9]/.test(c);
}

export function readCompanyInterCompanyCode(
  company: { interCompanyCompanyCode?: string | null } | null | undefined
): string {
  const raw = normalizeInterCompanyCompanyCode(company?.interCompanyCompanyCode);
  return isValidInterCompanyCompanyCode(raw) ? raw : "";
}

/** Naya random code — naam prefix + alphanumeric suffix (letter + digit mix) */
export function generateInterCompanyCompanyCode(companyName?: string): string {
  const prefix = String(companyName || "CO")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, "X");

  let rest = "";
  for (let i = 0; i < INTER_COMPANY_COMPANY_CODE_LEN - prefix.length; i++) {
    rest += randomAlnumChar();
  }
  let code = (prefix + rest).slice(0, INTER_COMPANY_COMPANY_CODE_LEN);

  if (!/[0-9]/.test(code)) {
    const idx =
      INTER_COMPANY_COMPANY_CODE_LEN - 1 - Math.floor(Math.random() * Math.min(4, code.length));
    code =
      code.slice(0, idx) + String(Math.floor(Math.random() * 10)) + code.slice(idx + 1);
  }
  if (!/[A-Z]/.test(code)) {
    code = `X${code.slice(1)}`;
  }
  return code.slice(0, INTER_COMPANY_COMPANY_CODE_LEN);
}

async function mirrorCompanyCodeToLocal(
  companyId: string,
  code: string,
  seed?: { name?: string; ownerId?: string; ownerEmail?: string | null }
): Promise<void> {
  try {
    const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (localRow) {
      await upsertLocalCompany({
        ...(localRow as Parameters<typeof upsertLocalCompany>[0]),
        id: companyId,
        interCompanyCompanyCode: code,
      });
      return;
    }
    // Online-only company — minimal SQLite row taaki email login par code reload par na khoye
    if (seed?.ownerId || seed?.name) {
      await upsertLocalCompany({
        id: companyId,
        name: seed.name || companyId,
        ownerId: seed.ownerId || "",
        ownerEmail: seed.ownerEmail ?? null,
        interCompanyCompanyCode: code,
        storageOption: "firebase",
        syncPolicy: "online",
        syncedFromCloud: true,
      } as Parameters<typeof upsertLocalCompany>[0]);
    }
  } catch (err) {
    console.warn("[interCompany] Local company code mirror skipped", err);
  }
}

/** Read-only — shared users Firestore se code dikha saken (write nahi) */
export async function fetchCompanyInterCompanyCode(companyId: string): Promise<string> {
  if (!companyId) return "";

  try {
    const local = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fromLocal = readCompanyInterCompanyCode(local as { interCompanyCompanyCode?: string });
    if (fromLocal) return fromLocal;
  } catch {
    /* optional */
  }

  if (!isLocalOnlyMode()) {
    try {
      const snap = await getDoc(doc(firestore, "companies", companyId));
      if (snap.exists()) {
        const code = readCompanyInterCompanyCode(
          snap.data() as { interCompanyCompanyCode?: string }
        );
        if (code) {
          await mirrorCompanyCodeToLocal(companyId, code);
          return code;
        }
      }
    } catch (err) {
      console.warn("[interCompany] Firestore company code fetch skipped", err);
    }
  }

  return "";
}

/** User company ka owner hai — email login par ownerId mismatch handle */
export function isUserCompanyOwner(args: {
  company?: { ownerId?: string; ownerEmail?: string } | null;
  userUid?: string | null;
  userEmail?: string | null;
}): boolean {
  const uid = String(args.userUid || "").trim();
  const email = String(args.userEmail || "").toLowerCase().trim();
  const ownerId = String(args.company?.ownerId || "").trim();
  const ownerEmail = String(args.company?.ownerEmail || "").toLowerCase().trim();
  if (uid && ownerId && uid === ownerId) return true;
  if (email && ownerEmail && email === ownerEmail) return true;
  return false;
}

/** Owner / admin hi naya code Firestore par likh sakta hai */
export function canWriteCompanyInterCompanyCode(args: {
  company?: { ownerId?: string; ownerEmail?: string; isOwned?: boolean } | null;
  userUid?: string | null;
  userEmail?: string | null;
  role?: string | null;
}): boolean {
  const role = String(args.role || "").trim();
  if (role === "SuperAdmin" || role === "CompanyAdmin") return true;
  if (isUserCompanyOwner(args)) return true;
  return args.company?.isOwned === true;
}

/** Firestore company doc se owner check — context company incomplete ho to bhi */
async function loadCompanyDocForCode(companyId: string): Promise<{
  name?: string;
  ownerId?: string;
  ownerEmail?: string;
} | null> {
  if (!companyId || isLocalOnlyMode()) return null;
  try {
    const snap = await getDoc(doc(firestore, "companies", companyId));
    if (!snap.exists()) return null;
    return snap.data() as { name?: string; ownerId?: string; ownerEmail?: string };
  } catch {
    return null;
  }
}

/**
 * Display + backfill — pehle valid code fetch; missing par owner/admin ke liye naya generate.
 * Email login: owner check Firestore doc se (context isOwned par depend nahi).
 */
export async function resolveOrEnsureCompanyInterCompanyCode(args: {
  companyId: string;
  companyName?: string;
  userUid?: string | null;
  userEmail?: string | null;
  role?: string | null;
  /** false = sirf read / fetch, generate mat karo */
  allowEnsure?: boolean;
}): Promise<string> {
  if (!isInterCompanySystemEnabled()) return "";
  const companyId = args.companyId.trim();
  if (!companyId) return "";

  const existing = await fetchCompanyInterCompanyCode(companyId);
  if (existing) return existing;

  if (args.allowEnsure === false) return "";

  const docRow = await loadCompanyDocForCode(companyId);
  const canWriteOwner = canWriteCompanyInterCompanyCode({
    company: docRow ?? undefined,
    userUid: args.userUid,
    userEmail: args.userEmail,
    role: args.role,
  });
  // getDoc ok + valid code nahi — shared member bhi pehli backfill (Firestore rule match)
  const canWrite = canWriteOwner || (!existing && !!docRow);

  if (!canWrite) return "";

  return ensureCompanyInterCompanyCode(companyId, args.companyName || docRow?.name);
}

async function isInterCompanyCompanyCodeTakenLocally(
  code: string,
  excludeCompanyId?: string
): Promise<boolean> {
  try {
    const companies = await listLocalCompanies({ includeDeleted: true });
    for (const row of companies) {
      if (excludeCompanyId && row.id === excludeCompanyId) continue;
      if (readCompanyInterCompanyCode(row as { interCompanyCompanyCode?: string }) === code) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function isInterCompanyCompanyCodeTakenInFirestore(
  code: string,
  excludeCompanyId?: string
): Promise<boolean> {
  try {
    const snap = await getDocs(
      query(
        collection(firestore, "companies"),
        where("interCompanyCompanyCode", "==", code),
        limit(1)
      )
    );
    if (snap.empty) return false;
    const hit = snap.docs[0]!;
    return !excludeCompanyId || hit.id !== excludeCompanyId;
  } catch (err) {
    console.warn("[interCompany] Firestore company code uniqueness check skipped", err);
    return false;
  }
}

/** Unique 12-char alphanumeric code — create / migration backfill */
export async function generateUniqueInterCompanyCompanyCode(
  excludeCompanyId?: string,
  companyName?: string,
  maxAttempts = 12
): Promise<string> {
  if (!isInterCompanySystemEnabled()) return "";
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateInterCompanyCompanyCode(companyName);
    if (!isValidInterCompanyCompanyCode(candidate)) continue;
    if (await isInterCompanyCompanyCodeTakenLocally(candidate, excludeCompanyId)) continue;
    if (!isLocalOnlyMode()) {
      if (await isInterCompanyCompanyCodeTakenInFirestore(candidate, excludeCompanyId)) continue;
    }
    return candidate;
  }
  throw new Error("unique_inter_company_company_code_failed");
}

/** Parallel ensure se alag-alag random code generate na ho — blink fix */
const ensureCompanyCodeInflight = new Map<string, Promise<string>>();

/**
 * Valid alphanumeric code missing / sirf digits ya purana format — naya generate + persist.
 */
export async function ensureCompanyInterCompanyCode(
  companyId: string,
  companyName?: string
): Promise<string> {
  if (!isInterCompanySystemEnabled() || !companyId) return "";

  const inflight = ensureCompanyCodeInflight.get(companyId);
  if (inflight) return inflight;

  const task = (async () => {
    const existing = await fetchCompanyInterCompanyCode(companyId);
    if (existing) return existing;

    let mirrorSeed: { name?: string; ownerId?: string; ownerEmail?: string | null } | undefined;

    if (!isLocalOnlyMode()) {
      try {
        const snap = await getDoc(doc(firestore, "companies", companyId));
        if (snap.exists()) {
          const data = snap.data() as {
            name?: string;
            ownerId?: string;
            ownerEmail?: string;
          };
          companyName = companyName || data.name;
          mirrorSeed = {
            name: data.name,
            ownerId: data.ownerId,
            ownerEmail: data.ownerEmail ?? null,
          };
        }
      } catch {
        /* optional name for prefix */
      }
    }

    const next = await generateUniqueInterCompanyCompanyCode(companyId, companyName);
    const payload = { interCompanyCompanyCode: next };

    try {
      if (!isLocalOnlyMode()) {
        await updateDoc(doc(firestore, "companies", companyId), payload);
      }
    } catch (err) {
      console.warn("[interCompany] Firestore company code backfill skipped", err);
    }

    await mirrorCompanyCodeToLocal(
      companyId,
      next,
      mirrorSeed ?? { name: companyName || companyId, ownerId: "", ownerEmail: null }
    );
    return next;
  })();

  ensureCompanyCodeInflight.set(companyId, task);
  try {
    return await task;
  } finally {
    ensureCompanyCodeInflight.delete(companyId);
  }
}
