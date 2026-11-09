/**
 * Centralized system card — owned + other companies (View com popup).
 * Owned = current user's companies in this system; Other = everyone else's.
 */
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import { readCompanyInterCompanyCode, isUserCompanyOwner } from "@/lib/interCompany/interCompanyCompanyCode";
import type {
  InterCompanyGroupCompanyOwner,
  InterCompanyGroupCompanySummary,
} from "@/lib/interCompany/interCompanyGroups";
import { normalizeInterCompanyPhone } from "@/lib/interCompany/interCompanyPhone";
import type { InterCompanyPublicProfileView } from "@/lib/interCompany/interCompanyPublicCompanyProfile";
import { getLocalCompanyById } from "@/lib/localCompanyStore";

export type InterCompanySystemCompanyRow = {
  id: string;
  name: string;
  companyCode: string;
  pan: string;
  phone: string;
  ownerUserId?: string;
};

/** Group doc par denormalized display — public system me doosre users read kar saken */
export type { InterCompanyGroupCompanySummary } from "@/lib/interCompany/interCompanyGroups";

/** `generateCompanyId` slug_shortId — shortId name se alag; sirf slug readable banao */
export function displayNameFromCompanyId(companyId: string): string {
  const raw = companyId.trim();
  if (!raw) return "—";
  const idx = raw.lastIndexOf("_");
  if (idx > 0) {
    const suffix = raw.slice(idx + 1);
    // UUID/timestamp shortId — company code nahi, name slug hi dikhao
    if (/^[a-z0-9]{6,8}$/i.test(suffix)) {
      const slug = raw.slice(0, idx);
      return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim() || raw;
    }
  }
  return raw;
}

function formatPan(raw: unknown): string {
  return (
    String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || "—"
  );
}

function rowFromCompanyFields(args: {
  companyId: string;
  name?: unknown;
  interCompanyCompanyCode?: unknown;
  pan?: unknown;
  phone?: unknown;
  ownerUserId?: string;
}): InterCompanySystemCompanyRow {
  const name =
    String(args.name || "")
      .trim() || displayNameFromCompanyId(args.companyId);
  return {
    id: args.companyId,
    name,
    companyCode:
      readCompanyInterCompanyCode({
        interCompanyCompanyCode:
          args.interCompanyCompanyCode != null ? String(args.interCompanyCompanyCode) : undefined,
      }) || "—",
    pan: formatPan(args.pan),
    phone: normalizeInterCompanyPhone(args.phone != null ? String(args.phone) : undefined) || "—",
    ownerUserId: args.ownerUserId,
  };
}

/** Firestore / local SQLite se company display — cache miss par Other table ke liye */
async function resolveCompaniesFromRemote(
  companyIds: string[]
): Promise<Map<string, InterCompanySystemCompanyRow>> {
  const map = new Map<string, InterCompanySystemCompanyRow>();
  const ids = [...new Set(companyIds.filter(Boolean))];
  await Promise.all(
    ids.map(async (companyId) => {
      try {
        const snap = await getDoc(doc(firestore, "companies", companyId));
        if (snap.exists()) {
          const data = snap.data() as {
            name?: string;
            ownerId?: string;
            interCompanyCompanyCode?: string;
            pan?: string;
            phone?: string;
          };
          map.set(
            companyId,
            rowFromCompanyFields({
              companyId,
              name: data.name,
              interCompanyCompanyCode: data.interCompanyCompanyCode,
              pan: data.pan,
              phone: data.phone,
              ownerUserId: String(data.ownerId || "").trim() || undefined,
            })
          );
          return;
        }
      } catch {
        /* permission / offline */
      }

      try {
        const local = await getLocalCompanyById(companyId, { includeDeleted: true });
        if (local) {
          map.set(companyId, mapCompanyToSystemRow(local as Company));
        }
      } catch {
        /* optional local mirror */
      }
    })
  );
  return map;
}

/** Add / save par group doc me companySummaries likhne ke liye */
export function buildCompanySummary(source: Company): InterCompanyGroupCompanySummary {
  const row = mapCompanyToSystemRow(source);
  return {
    name: row.name,
    companyCode: row.companyCode,
    pan: row.pan,
    phone: row.phone,
  };
}

export function buildCompanySummariesForIds(
  companyIds: string[],
  allCompanies: Company[]
): Record<string, InterCompanyGroupCompanySummary> {
  const byId = new Map(allCompanies.filter((c) => c?.id).map((c) => [c.id!, c]));
  const out: Record<string, InterCompanyGroupCompanySummary> = {};
  for (const id of companyIds.filter(Boolean)) {
    const c = byId.get(id);
    if (c) out[id] = buildCompanySummary(c);
  }
  return out;
}

function mapCompanyToSystemRow(c: Company): InterCompanySystemCompanyRow {
  return {
    id: c.id!,
    name: String(c.name || c.id || "").trim() || "—",
    companyCode: readCompanyInterCompanyCode(c) || "—",
    pan: String(c.pan || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || "—",
    phone: normalizeInterCompanyPhone(c.phone) || "—",
    ownerUserId: c.ownerId || undefined,
  };
}

/** Group summary + public profile merge — dash wale field par public profile prefer */
function mergeCompanyDisplaySummary(
  summary?: InterCompanyGroupCompanySummary,
  publicProfile?: InterCompanyGroupCompanySummary
): InterCompanyGroupCompanySummary | undefined {
  if (!summary && !publicProfile) return undefined;
  if (!summary) return publicProfile;
  if (!publicProfile) return summary;
  const pick = (primary: string, fallback: string) =>
    primary && primary !== "—" ? primary : fallback && fallback !== "—" ? fallback : primary || fallback || "—";
  return {
    name: String(summary.name || publicProfile.name || "").trim() || "—",
    companyCode: pick(summary.companyCode, publicProfile.companyCode),
    pan: pick(summary.pan, publicProfile.pan),
    phone: pick(summary.phone, publicProfile.phone),
  };
}

function rowFromId(
  companyId: string,
  byId: Map<string, Company>,
  remoteById: Map<string, InterCompanySystemCompanyRow>,
  summaries: Map<string, InterCompanyGroupCompanySummary>,
  publicProfiles: Map<string, InterCompanyGroupCompanySummary>,
  ownerUserId?: string
): InterCompanySystemCompanyRow {
  const c = byId.get(companyId);
  if (c) {
    const row = mapCompanyToSystemRow(c);
    return { ...row, ownerUserId: row.ownerUserId || ownerUserId };
  }

  const remote = remoteById.get(companyId);
  if (remote) {
    return { ...remote, ownerUserId: remote.ownerUserId || ownerUserId };
  }

  const merged = mergeCompanyDisplaySummary(
    summaries.get(companyId),
    publicProfiles.get(companyId)
  );
  if (merged) {
    return {
      id: companyId,
      name: merged.name,
      companyCode: merged.companyCode,
      pan: merged.pan,
      phone: merged.phone,
      ownerUserId,
    };
  }

  // Cache/Firestore/summary miss — doc id se sirf name; code alag column
  return {
    id: companyId,
    name: displayNameFromCompanyId(companyId),
    companyCode: "—",
    pan: "—",
    phone: "—",
    ownerUserId,
  };
}

/** Logged-in user ki sirf owned company ids — shared/current company include mat karo */
export function resolveUserOwnedCompanyIds(args: {
  allCompanies: Company[];
  userUid?: string | null;
  userEmail?: string | null;
  /** Firestore resolveOwnedCompaniesForUser se extra ids */
  extraOwnedIds?: string[];
}): string[] {
  const uid = String(args.userUid || "").trim();
  const email = String(args.userEmail || "").toLowerCase().trim();
  const set = new Set<string>();

  for (const id of args.extraOwnedIds || []) {
    if (!id) continue;
    const cached = (args.allCompanies || []).find((c) => c.id === id);
    // Shared company — Firestore resolve list me galti se na aaye
    if (cached?.isOwned === false) continue;
    if (
      cached &&
      !isUserCompanyOwner({ company: cached, userUid: uid, userEmail: email })
    ) {
      continue;
    }
    set.add(id);
  }

  for (const c of args.allCompanies || []) {
    if (!c?.id || c.isOwned === false) continue;
    if (isUserCompanyOwner({ company: c, userUid: uid, userEmail: email })) {
      set.add(c.id);
    }
  }

  return Array.from(set);
}

/** Company id viewer ka hai — ownerId / ownerEmail se (shared login safe) */
export function isCompanyOwnedByViewer(args: {
  companyId: string;
  allCompanies: Company[];
  userUid?: string | null;
  userEmail?: string | null;
  ownerByCompanyId?: Map<string, string>;
}): boolean {
  const companyId = args.companyId.trim();
  if (!companyId) return false;

  const c = (args.allCompanies || []).find((x) => x.id === companyId);
  if (c?.isOwned === false) return false;

  if (
    c &&
    isUserCompanyOwner({
      company: c,
      userUid: args.userUid,
      userEmail: args.userEmail,
    })
  ) {
    return true;
  }

  const uid = String(args.userUid || "").trim();
  const ownerId = args.ownerByCompanyId?.get(companyId);
  return !!(uid && ownerId && uid === ownerId);
}

function uidMatches(a?: string | null, b?: string | null): boolean {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  return !!(x && y && x === y);
}

function emailMatches(a?: string | null, b?: string | null): boolean {
  const x = String(a || "").toLowerCase().trim();
  const y = String(b || "").toLowerCase().trim();
  return !!(x && y && x === y);
}

function ownerRecordMatchesViewer(
  recorded: InterCompanyGroupCompanyOwner | undefined,
  viewerUid: string,
  viewerEmail: string
): boolean | null {
  if (!recorded?.ownerUserId && !recorded?.ownerEmail) return null;
  if (uidMatches(recorded.ownerUserId, viewerUid)) return true;
  if (emailMatches(recorded.ownerEmail, viewerEmail)) return true;
  return false;
}

/**
 * System me company viewer ki hai ya doosre user ki.
 * companyOwners > public profile > Firestore owned query; baaki → Other (cache use mat karo).
 */
export function viewerOwnsSystemCompany(args: {
  companyId: string;
  viewerUid?: string | null;
  viewerEmail?: string | null;
  publicProfiles: Map<string, InterCompanyPublicProfileView>;
  systemCompanyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
  /** resolveOwnedCompaniesForUser — sirf Firestore owner query ids */
  firestoreOwnedIds?: Set<string>;
}): boolean {
  const viewerUid = String(args.viewerUid || "").trim();
  const viewerEmail = String(args.viewerEmail || "").toLowerCase().trim();
  if (!viewerUid && !viewerEmail) return false;

  const companyId = args.companyId.trim();
  if (!companyId) return false;

  const fromGroup = ownerRecordMatchesViewer(
    args.systemCompanyOwners?.[companyId],
    viewerUid,
    viewerEmail
  );
  if (fromGroup !== null) return fromGroup;

  const pub = args.publicProfiles.get(companyId);
  const fromProfile = ownerRecordMatchesViewer(
    pub?.ownerUserId || pub?.ownerEmail
      ? { ownerUserId: pub.ownerUserId, ownerEmail: pub.ownerEmail }
      : undefined,
    viewerUid,
    viewerEmail
  );
  if (fromProfile !== null) return fromProfile;

  // Sirf Firestore owner query — allCompanies cache par depend mat karo
  if (args.firestoreOwnedIds?.has(companyId)) return true;

  return false;
}

/** Split system.companyIds — owned = viewer ki owned companies, other = baaki sab */
export async function loadInterCompanySystemCompaniesView(args: {
  systemCompanyIds: string[];
  /** Firestore resolveOwnedCompaniesForUser ids — fallback jab profile/companyOwners na ho */
  firestoreOwnedIds?: string[];
  allCompanies: Company[];
  userUid?: string | null;
  userEmail?: string | null;
  /** Public system — doosre users ke companies ka denormalized snapshot */
  companySummaries?: Record<string, InterCompanyGroupCompanySummary>;
  /** Group doc — company add karte waqt likha owner */
  companyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
}): Promise<{ owned: InterCompanySystemCompanyRow[]; linkedOther: InterCompanySystemCompanyRow[] }> {
  const byId = new Map(
    (args.allCompanies || []).filter((c) => c?.id).map((c) => [c.id!, c])
  );
  const summaries = new Map(
    Object.entries(args.companySummaries || {}).filter(([id, s]) => id && s?.name)
  );

  const firestoreOwnedSet = new Set((args.firestoreOwnedIds || []).filter(Boolean));

  const missingFromCache = args.systemCompanyIds.filter((id) => !byId.has(id));
  const [remoteById, publicProfiles] = await Promise.all([
    resolveCompaniesFromRemote(missingFromCache),
    import("@/lib/interCompany/interCompanyPublicCompanyProfile").then((m) =>
      m.fetchInterCompanyPublicCompanyProfiles(args.systemCompanyIds)
    ),
  ]);

  const ownerByCompanyId = new Map<string, string>();
  const ownerEmailByCompanyId = new Map<string, string>();
  for (const c of args.allCompanies || []) {
    if (c.id && c.ownerId) ownerByCompanyId.set(c.id, c.ownerId);
    if (c.id && c.ownerEmail) {
      ownerEmailByCompanyId.set(c.id, String(c.ownerEmail).toLowerCase().trim());
    }
  }
  remoteById.forEach((row, id) => {
    if (row.ownerUserId) ownerByCompanyId.set(id, row.ownerUserId);
  });

  publicProfiles.forEach((entry, id) => {
    if (entry.ownerUserId) ownerByCompanyId.set(id, entry.ownerUserId);
    if (entry.ownerEmail) ownerEmailByCompanyId.set(id, entry.ownerEmail);
  });

  const systemCompanyOwners: Record<string, InterCompanyGroupCompanyOwner> = {
    ...(args.companyOwners ?? {}),
  };
  publicProfiles.forEach((entry, id) => {
    if (systemCompanyOwners[id]?.ownerUserId || systemCompanyOwners[id]?.ownerEmail) return;
    if (!entry.ownerUserId && !entry.ownerEmail) return;
    systemCompanyOwners[id] = {
      ownerUserId: entry.ownerUserId,
      ownerEmail: entry.ownerEmail,
    };
  });

  const owned: InterCompanySystemCompanyRow[] = [];
  const linkedOther: InterCompanySystemCompanyRow[] = [];

  for (const id of args.systemCompanyIds.filter(Boolean)) {
    const ownerId = ownerByCompanyId.get(id) || "";
    const row = rowFromId(id, byId, remoteById, summaries, publicProfiles, ownerId || undefined);
    const isOwned = viewerOwnsSystemCompany({
      companyId: id,
      viewerUid: args.userUid,
      viewerEmail: args.userEmail,
      publicProfiles,
      systemCompanyOwners,
      firestoreOwnedIds: firestoreOwnedSet,
    });
    if (isOwned) {
      owned.push(row);
    } else {
      linkedOther.push(row);
    }
  }

  owned.sort((a, b) => a.name.localeCompare(b.name));
  linkedOther.sort((a, b) => a.name.localeCompare(b.name));

  return { owned, linkedOther };
}

/**
 * View com — joined partners jo system.companyIds me nahi (accept ke baad missing).
 * Owned / Other split same rules; Joined badge linkedCompanyIds se.
 */
export async function appendJoinedPartnersToSystemView(args: {
  owned: InterCompanySystemCompanyRow[];
  linkedOther: InterCompanySystemCompanyRow[];
  /** Selected owned company ke joined + accepted join partners */
  joinedPartnerIds: string[];
  allCompanies: Company[];
  userUid?: string | null;
  userEmail?: string | null;
  companyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
}): Promise<{ owned: InterCompanySystemCompanyRow[]; linkedOther: InterCompanySystemCompanyRow[] }> {
  const existing = new Set(
    [...args.owned, ...args.linkedOther].map((r) => r.id).filter(Boolean)
  );
  const toFetch = args.joinedPartnerIds.filter((id) => id && !existing.has(id));
  if (!toFetch.length) {
    return { owned: args.owned, linkedOther: args.linkedOther };
  }

  const publicProfiles = await import("@/lib/interCompany/interCompanyPublicCompanyProfile").then((m) =>
    m.fetchInterCompanyPublicCompanyProfiles(toFetch)
  );
  const firestoreOwnedSet = new Set(
    resolveUserOwnedCompanyIds({
      allCompanies: args.allCompanies,
      userUid: args.userUid,
      userEmail: args.userEmail,
    })
  );

  const systemCompanyOwners: Record<string, InterCompanyGroupCompanyOwner> = {
    ...(args.companyOwners ?? {}),
  };
  publicProfiles.forEach((entry, id) => {
    if (systemCompanyOwners[id]?.ownerUserId || systemCompanyOwners[id]?.ownerEmail) return;
    if (!entry.ownerUserId && !entry.ownerEmail) return;
    systemCompanyOwners[id] = {
      ownerUserId: entry.ownerUserId,
      ownerEmail: entry.ownerEmail,
    };
  });

  const owned = [...args.owned];
  const linkedOther = [...args.linkedOther];

  for (const companyId of toFetch) {
    const pub = publicProfiles.get(companyId);
    const row: InterCompanySystemCompanyRow = pub
      ? {
          id: companyId,
          name: pub.name,
          companyCode: pub.companyCode,
          pan: pub.pan,
          phone: pub.phone,
          ownerUserId: pub.ownerUserId,
        }
      : {
          id: companyId,
          name: displayNameFromCompanyId(companyId),
          companyCode: "—",
          pan: "—",
          phone: "—",
        };

    const isOwned = viewerOwnsSystemCompany({
      companyId,
      viewerUid: args.userUid,
      viewerEmail: args.userEmail,
      publicProfiles,
      systemCompanyOwners,
      firestoreOwnedIds: firestoreOwnedSet,
    });

    if (isOwned) owned.push(row);
    else linkedOther.push(row);
    existing.add(companyId);
  }

  owned.sort((a, b) => a.name.localeCompare(b.name));
  linkedOther.sort((a, b) => a.name.localeCompare(b.name));

  return { owned, linkedOther };
}

/** Logged-in user ki kam se kam ek owned company is system me hai */
export function userHasOwnCompanyInSystem(args: {
  systemCompanyIds: string[];
  userOwnedCompanyIds: string[];
  allCompanies?: Company[];
  userUid?: string | null;
  userEmail?: string | null;
}): boolean {
  const ownedSet = new Set(
    resolveUserOwnedCompanyIds({
      allCompanies: args.allCompanies || [],
      userUid: args.userUid,
      userEmail: args.userEmail,
      extraOwnedIds: args.userOwnedCompanyIds,
    })
  );
  return args.systemCompanyIds.some((id) => ownedSet.has(id));
}
