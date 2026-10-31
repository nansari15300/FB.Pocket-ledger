/**
 * Public Inter Company systems — global search + user link list ("Add to my system").
 */
import { deleteDoc, setDoc } from "@/lib/writeGateway/pbWrites";
import { collection, doc, limit, query, serverTimestamp, where, type Unsubscribe } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  normalizeInterCompanyGroupVisibility,
  parseInterCompanyGroupCompanyOwners,
  type InterCompanyGroupDoc,
} from "@/lib/interCompany/interCompanyGroups";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

export type InterCompanyPublicSystemLink = {
  id: string;
  userId: string;
  systemId: string;
  systemName: string;
  ownerUserId: string;
};

const GROUPS = () => collection(firestore, "inter_company_groups");
const LINKS = () => collection(firestore, "inter_company_public_system_links");

function linkDocId(userId: string, systemId: string): string {
  return `${userId}__${systemId}`;
}

function mapGroupDoc(id: string, data: Record<string, unknown>): InterCompanyGroupDoc {
  const rawSummaries = data.companySummaries;
  const companySummaries =
    rawSummaries && typeof rawSummaries === "object" && !Array.isArray(rawSummaries)
      ? (rawSummaries as InterCompanyGroupDoc["companySummaries"])
      : undefined;
  return {
    id,
    name: String(data.name || "").trim() || id,
    ownerUserId: String(data.ownerUserId || "").trim(),
    ownerEmail: String(data.ownerEmail || "").toLowerCase().trim() || undefined,
    ownerDisplayName: String(data.ownerDisplayName || "").trim() || undefined,
    companyIds: Array.isArray(data.companyIds)
      ? data.companyIds.filter((x) => typeof x === "string")
      : [],
    companySummaries,
    companyOwners: parseInterCompanyGroupCompanyOwners(data.companyOwners),
    memberUsers: Array.isArray(data.memberUsers) ? data.memberUsers : [],
    visibility: normalizeInterCompanyGroupVisibility(data.visibility),
  };
}

/** Fetch one system — owner or public visibility */
export async function fetchInterCompanyGroupById(
  groupId: string
): Promise<InterCompanyGroupDoc | null> {
  if (!groupId || groupId.startsWith("local-")) return null;
  try {
    const snap = await getDoc(doc(firestore, "inter_company_groups", groupId));
    if (!snap.exists()) return null;
    return mapGroupDoc(snap.id, snap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Global public system search by name (prefix + client contains filter) */
export async function searchPublicInterCompanySystems(args: {
  nameQuery: string;
  excludeOwnerUserId?: string;
  excludeSystemIds?: string[];
  maxResults?: number;
}): Promise<InterCompanyGroupDoc[]> {
  const q = args.nameQuery.trim();
  if (q.length < 2) return [];

  const excludeIds = new Set(args.excludeSystemIds ?? []);
  const maxResults = args.maxResults ?? 12;
  const qLower = q.toLowerCase();

  try {
    const snap = await getDocs(
      query(
        GROUPS(),
        where("visibility", "==", "public"),
        where("name", ">=", q),
        where("name", "<=", q + "\uf8ff"),
        limit(40)
      )
    );

    const rows = snap.docs
      .map((d) => mapGroupDoc(d.id, d.data() as Record<string, unknown>))
      .filter((g) => g.visibility === "public")
      .filter((g) => !excludeIds.has(g.id))
      .filter((g) => !args.excludeOwnerUserId || g.ownerUserId !== args.excludeOwnerUserId)
      .filter((g) => g.name.toLowerCase().includes(qLower))
      .sort((a, b) => a.name.localeCompare(b.name));

    return rows.slice(0, maxResults);
  } catch (err) {
    console.warn("[IC public systems] search:", err);
    return [];
  }
}

/** Realtime — user's linked public systems (full group docs) */
export function subscribeLinkedPublicInterCompanySystems(
  userId: string,
  onData: (systems: InterCompanyGroupDoc[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !userId) {
    onData([]);
    return () => undefined;
  }

  return onSnapshot(
    query(LINKS(), where("userId", "==", userId)),
    async (snap) => {
      const links = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          userId: String(data.userId || ""),
          systemId: String(data.systemId || ""),
          systemName: String(data.systemName || ""),
          ownerUserId: String(data.ownerUserId || ""),
        } satisfies InterCompanyPublicSystemLink;
      });

      const systems = (
        await Promise.all(links.map((l) => fetchInterCompanyGroupById(l.systemId)))
      ).filter(Boolean) as InterCompanyGroupDoc[];

      onData(systems);
    },
    (err) => {
      onError?.(err);
      onData([]);
    }
  );
}

/** Bookmark a public system on this user's list */
export async function addLinkedPublicInterCompanySystem(args: {
  userId: string;
  systemId: string;
}): Promise<void> {
  const system = await fetchInterCompanyGroupById(args.systemId);
  if (!system) throw new Error("System not found.");
  if (system.visibility !== "public") {
    throw new Error("Only public systems can be added.");
  }
  if (system.ownerUserId === args.userId) {
    throw new Error("You already own this system.");
  }

  await setDoc(doc(LINKS(), linkDocId(args.userId, args.systemId)), {
    userId: args.userId,
    systemId: system.id,
    systemName: system.name,
    ownerUserId: system.ownerUserId,
    linkedAt: serverTimestamp(),
  });
}

/** Remove bookmark — does not delete the original system */
export async function removeLinkedPublicInterCompanySystem(args: {
  userId: string;
  systemId: string;
}): Promise<void> {
  await deleteDoc(doc(LINKS(), linkDocId(args.userId, args.systemId)));
}
