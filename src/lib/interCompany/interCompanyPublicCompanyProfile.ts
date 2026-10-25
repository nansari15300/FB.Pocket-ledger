/**
 * Public Inter Company profile — code / PAN / phone sab signed-in users read kar saken.
 * Company owner join/add par likhta hai; doosre users company doc read nahi kar sakte.
 */
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { Company } from "@/hooks/useCompany";
import {
  buildCompanySummary,
  type InterCompanyGroupCompanySummary,
} from "@/lib/interCompany/interCompanySystemCompaniesView";
import {
  resolveOrEnsureCompanyInterCompanyCode,
} from "@/lib/interCompany/interCompanyCompanyCode";
import type { InterCompanyGroupCompanyOwner } from "@/lib/interCompany/interCompanyGroups";

export type InterCompanyPublicCompanyProfile = InterCompanyGroupCompanySummary & {
  companyId: string;
  ownerUserId?: string;
  ownerEmail?: string;
  updatedAt?: unknown;
};

const profileRef = (companyId: string) =>
  doc(firestore, "inter_company_public_profiles", companyId);

/** Firestore se poora summary — add / backfill public system ke liye */
export async function buildCompanySummaryForPublicSystem(args: {
  companyId: string;
  companyName?: string;
  userUid?: string | null;
  userEmail?: string | null;
  role?: string | null;
  source?: Company | null;
  /** View com open par false — sirf read; Add company par true */
  allowEnsureCode?: boolean;
}): Promise<InterCompanyGroupCompanySummary> {
  const companyId = args.companyId.trim();
  if (!companyId) {
    return { name: "—", companyCode: "—", pan: "—", phone: "—" };
  }

  if (args.source?.id) {
    const fromCache = buildCompanySummary(args.source);
    if (fromCache.companyCode !== "—" || fromCache.pan !== "—" || fromCache.phone !== "—") {
      return fromCache;
    }
  }

  let name = args.companyName || args.source?.name;
  let pan = args.source?.pan;
  let phone = args.source?.phone;
  let ownerUserId = args.source?.ownerId;

  try {
    const snap = await getDoc(doc(firestore, "companies", companyId));
    if (snap.exists()) {
      const data = snap.data() as {
        name?: string;
        pan?: string;
        phone?: string;
        ownerId?: string;
      };
      name = name || data.name;
      pan = pan ?? data.pan;
      phone = phone ?? data.phone;
      ownerUserId = ownerUserId || data.ownerId;
    }
  } catch {
    /* optional */
  }

  const companyCode = await resolveOrEnsureCompanyInterCompanyCode({
    companyId,
    companyName: name,
    userUid: args.userUid,
    userEmail: args.userEmail,
    role: args.role,
    allowEnsure: args.allowEnsureCode !== false,
  });

  const summarySource: Company = {
    id: companyId,
    name: name || companyId,
    pan: pan ?? "",
    phone: phone ?? "",
    ownerId: ownerUserId,
    interCompanyCompanyCode: companyCode || undefined,
  } as Company;

  return buildCompanySummary(summarySource);
}

/** Owner company ka public profile publish — public system Other table ke liye */
export async function upsertInterCompanyPublicCompanyProfile(args: {
  companyId: string;
  summary: InterCompanyGroupCompanySummary;
  ownerUserId?: string;
  ownerEmail?: string;
}): Promise<void> {
  const companyId = args.companyId.trim();
  if (!companyId) return;

  await setDoc(
    profileRef(companyId),
    {
      companyId,
      name: args.summary.name,
      companyCode: args.summary.companyCode,
      pan: args.summary.pan,
      phone: args.summary.phone,
      ownerUserId: args.ownerUserId || "",
      ownerEmail: String(args.ownerEmail || "").toLowerCase().trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export type InterCompanyPublicProfileView = InterCompanyGroupCompanySummary & {
  ownerUserId?: string;
  ownerEmail?: string;
};

/** View com — doosre users ke liye public profile read */
export async function fetchInterCompanyPublicCompanyProfiles(
  companyIds: string[]
): Promise<Map<string, InterCompanyPublicProfileView>> {
  const map = new Map<string, InterCompanyPublicProfileView>();
  const ids = [...new Set(companyIds.filter(Boolean))];

  await Promise.all(
    ids.map(async (companyId) => {
      try {
        const snap = await getDoc(profileRef(companyId));
        if (!snap.exists()) return;
        const data = snap.data() as InterCompanyPublicCompanyProfile;
        if (!data?.name) return;
        map.set(companyId, {
          name: String(data.name),
          companyCode: String(data.companyCode || "—"),
          pan: String(data.pan || "—"),
          phone: String(data.phone || "—"),
          ownerUserId: String(data.ownerUserId || "").trim() || undefined,
          ownerEmail: String(data.ownerEmail || "").toLowerCase().trim() || undefined,
        });
      } catch {
        /* rules / offline */
      }
    })
  );

  return map;
}

/** User ki owned companies jo is public system me hain — profile publish */
export async function syncUserPublicProfilesForSystem(args: {
  systemCompanyIds: string[];
  userOwnedCompanyIds: string[];
  allCompanies: Company[];
  userUid?: string | null;
  userEmail?: string | null;
  role?: string | null;
  /** View com — code generate mat karo, sirf publish */
  allowEnsureCode?: boolean;
}): Promise<Record<string, InterCompanyGroupCompanySummary>> {
  const systemSet = new Set(args.systemCompanyIds.filter(Boolean));
  const out: Record<string, InterCompanyGroupCompanySummary> = {};
  const byId = new Map(args.allCompanies.filter((c) => c?.id).map((c) => [c.id!, c]));

  for (const companyId of args.userOwnedCompanyIds.filter(Boolean)) {
    if (!systemSet.has(companyId)) continue;
    const summary = await buildCompanySummaryForPublicSystem({
      companyId,
      source: byId.get(companyId) ?? null,
      userUid: args.userUid,
      userEmail: args.userEmail,
      role: args.role,
      allowEnsureCode: args.allowEnsureCode,
    });
    out[companyId] = summary;
    await upsertInterCompanyPublicCompanyProfile({
      companyId,
      summary,
      ownerUserId: byId.get(companyId)?.ownerId || args.userUid || undefined,
      ownerEmail: byId.get(companyId)?.ownerEmail || args.userEmail || undefined,
    });
  }

  return out;
}

/** Legacy systems — public profile se group par companyOwners backfill */
export async function backfillInterCompanyGroupCompanyOwners(args: {
  systemId: string;
  companyIds: string[];
  existing?: Record<string, InterCompanyGroupCompanyOwner>;
}): Promise<Record<string, InterCompanyGroupCompanyOwner>> {
  const systemId = args.systemId.trim();
  const merged: Record<string, InterCompanyGroupCompanyOwner> = { ...(args.existing ?? {}) };
  if (!systemId || systemId.startsWith("local-")) return merged;

  const profiles = await fetchInterCompanyPublicCompanyProfiles(args.companyIds);
  const patch: Record<string, unknown> = {};
  let dirty = false;

  for (const companyId of args.companyIds.filter(Boolean)) {
    if (merged[companyId]?.ownerUserId || merged[companyId]?.ownerEmail) continue;
    const pub = profiles.get(companyId);
    if (!pub?.ownerUserId && !pub?.ownerEmail) continue;
    merged[companyId] = {
      ownerUserId: pub.ownerUserId,
      ownerEmail: pub.ownerEmail,
    };
    patch[`companyOwners.${companyId}`] = {
      ownerUserId: pub.ownerUserId || "",
      ownerEmail: pub.ownerEmail || "",
    };
    dirty = true;
  }

  if (dirty) {
    const { doc, serverTimestamp, updateDoc } = await import("firebase/firestore");
    const { firestore } = await import("@/lib/firebase");
    await updateDoc(doc(firestore, "inter_company_groups", systemId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  return merged;
}
