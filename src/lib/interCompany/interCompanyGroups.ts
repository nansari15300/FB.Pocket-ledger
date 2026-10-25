/**
 * Inter Company — user ke owned companies ko groups me organize.
 * Firestore primary; permission-denied / offline par localStorage fallback.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/firebase";
import { upsertInterCompanyPublicCompanyProfile } from "@/lib/interCompany/interCompanyPublicCompanyProfile";

/** `local` = device-only system — sirf pure local companies, SQLite IC (Firebase nahi). */
export type InterCompanyGroupVisibility = "public" | "private" | "local";

export type InterCompanyGroupMemberUser = {
  email: string;
  name?: string;
  uid?: string;
  role?: string;
};

/** companyId → display snapshot (name, code, PAN, phone) */
export type InterCompanyGroupCompanySummary = {
  name: string;
  companyCode: string;
  pan: string;
  phone: string;
};

/** System me company add karte waqt owner — Owned/Other split ke liye */
export type InterCompanyGroupCompanyOwner = {
  ownerUserId?: string;
  ownerEmail?: string;
};

export function parseInterCompanyGroupCompanyOwners(
  raw: unknown
): Record<string, InterCompanyGroupCompanyOwner> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, InterCompanyGroupCompanyOwner> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    out[id] = {
      ownerUserId: String(row.ownerUserId || "").trim() || undefined,
      ownerEmail: String(row.ownerEmail || "").toLowerCase().trim() || undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export type InterCompanyGroupDoc = {
  id: string;
  name: string;
  ownerUserId: string;
  /** System banane wale ka email — card par "Created by" */
  ownerEmail?: string;
  /** System banane wale ka display name — card par email ke niche */
  ownerDisplayName?: string;
  /** Owner ki companies is group me */
  companyIds: string[];
  /** companyId → display snapshot (name, code, PAN, phone) */
  companySummaries?: Record<string, InterCompanyGroupCompanySummary>;
  /** companyId → jis user ne system me add kiya / company owner */
  companyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
  /** Global name registry key — duplicate block */
  nameKey?: string;
  /** Shared users jinhe admin ne IC access diya — preview ke liye */
  memberUsers: InterCompanyGroupMemberUser[];
  /** Public = global search; Private = sirf aapke invites/links */
  visibility?: InterCompanyGroupVisibility;
  /** Firestore fail — sirf is device par */
  localOnly?: boolean;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
};

export type InterCompanyGroupPreview = {
  groupId: string;
  groupName: string;
  companies: { id: string; name: string }[];
  memberUsers: InterCompanyGroupMemberUser[];
};

const GROUPS = () => collection(firestore, "inter_company_groups");
const SYSTEM_NAMES = () => collection(firestore, "inter_company_system_names");
const LOCAL_GROUPS_KEY = (ownerUserId: string) => `pl-inter-company-groups::${ownerUserId}`;

/** Global duplicate check — case-insensitive Firestore doc id */
export function normalizeInterCompanySystemNameKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return "system";
  return trimmed.replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "system";
}

export class InterCompanySystemNameTakenError extends Error {
  constructor() {
    super("This system name is already taken.");
    this.name = "InterCompanySystemNameTakenError";
  }
}

function groupDocNameKey(data: { name?: unknown; nameKey?: unknown }): string {
  const rawKey = String(data.nameKey || "").trim();
  if (rawKey) return rawKey;
  return normalizeInterCompanySystemNameKey(String(data.name || ""));
}

/** Legacy + public systems — naam se global duplicate check (id se nahi) */
async function assertInterCompanySystemNameAvailable(args: {
  name: string;
  ownerUserId: string;
  exceptSystemId?: string;
}): Promise<string> {
  const nameKey = normalizeInterCompanySystemNameKey(args.name);
  const nameRef = doc(SYSTEM_NAMES(), nameKey);

  const regSnap = await getDoc(nameRef);
  if (regSnap.exists()) {
    const existingId = String(regSnap.data()?.systemId || "").trim();
    if (!args.exceptSystemId || existingId !== args.exceptSystemId) {
      throw new InterCompanySystemNameTakenError();
    }
  }

  const ownSnap = await getDocs(
    query(GROUPS(), where("ownerUserId", "==", args.ownerUserId))
  );
  for (const d of ownSnap.docs) {
    if (args.exceptSystemId && d.id === args.exceptSystemId) continue;
    if (groupDocNameKey(d.data() as { name?: string; nameKey?: string }) === nameKey) {
      throw new InterCompanySystemNameTakenError();
    }
  }

  try {
    // Sab readable groups (apne + public) — nameKey se duplicate pakdo
    const readableSnap = await getDocs(
      query(collectionGroup(firestore, "inter_company_groups"), where("nameKey", "==", nameKey), limit(20))
    );
    for (const d of readableSnap.docs) {
      if (args.exceptSystemId && d.id === args.exceptSystemId) continue;
      throw new InterCompanySystemNameTakenError();
    }

    const publicSnap = await getDocs(
      query(
        GROUPS(),
        where("visibility", "==", "public"),
        where("nameKey", "==", nameKey),
        limit(10)
      )
    );
    for (const d of publicSnap.docs) {
      if (args.exceptSystemId && d.id === args.exceptSystemId) continue;
      throw new InterCompanySystemNameTakenError();
    }
  } catch (err) {
    if (err instanceof InterCompanySystemNameTakenError) throw err;
    const trimmed = args.name.trim();
    if (trimmed.length >= 1) {
      // Legacy docs jahan nameKey missing — public naam prefix se dhundo
      const fallbackSnap = await getDocs(
        query(
          GROUPS(),
          where("visibility", "==", "public"),
          where("name", ">=", trimmed),
          where("name", "<=", trimmed + "\uf8ff"),
          limit(30)
        )
      );
      for (const d of fallbackSnap.docs) {
        if (args.exceptSystemId && d.id === args.exceptSystemId) continue;
        if (groupDocNameKey(d.data() as { name?: string; nameKey?: string }) === nameKey) {
          throw new InterCompanySystemNameTakenError();
        }
      }
    }
  }

  return nameKey;
}

/** Purane systems — registry me naam register taaki global duplicate block ho */
export async function ensureInterCompanySystemNameRegistry(args: {
  systemId: string;
  name: string;
  ownerUserId: string;
}): Promise<void> {
  const systemId = args.systemId.trim();
  const ownerUserId = args.ownerUserId.trim();
  const name = args.name.trim();
  if (!systemId || systemId.startsWith("local-") || !ownerUserId || !name) return;
  if (!canSyncInterCompanyGroupsToFirestore(ownerUserId)) return;

  const nameKey = normalizeInterCompanySystemNameKey(name);
  const nameRef = doc(SYSTEM_NAMES(), nameKey);
  const groupRef = doc(firestore, "inter_company_groups", systemId);

  try {
    await runTransaction(firestore, async (tx) => {
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists()) {
        const existingId = String(nameSnap.data()?.systemId || "").trim();
        if (existingId && existingId !== systemId) return;
      }
      tx.set(
        nameRef,
        {
          nameKey,
          name,
          systemId,
          ownerUserId,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
    await updateDoc(groupRef, { nameKey, updatedAt: serverTimestamp() });
  } catch {
    /* offline / conflict — create par dubara check */
  }
}

/** UI / pre-check — kya naam global available hai */
export async function isInterCompanySystemNameTaken(args: {
  name: string;
  ownerUserId: string;
  exceptSystemId?: string;
}): Promise<boolean> {
  try {
    await assertInterCompanySystemNameAvailable(args);
    return false;
  } catch (err) {
    if (err instanceof InterCompanySystemNameTakenError) return true;
    throw err;
  }
}

function assertLocalInterCompanySystemNameAvailable(
  ownerUserId: string,
  name: string,
  exceptGroupId?: string
): void {
  const nameKey = normalizeInterCompanySystemNameKey(name);
  const clash = readLocalGroups(ownerUserId).some(
    (g) =>
      g.id !== exceptGroupId &&
      normalizeInterCompanySystemNameKey(g.name) === nameKey
  );
  if (clash) throw new InterCompanySystemNameTakenError();
}

export function normalizeInterCompanyGroupVisibility(
  raw: unknown
): InterCompanyGroupVisibility {
  if (raw === "public") return "public";
  if (raw === "local") return "local";
  return "private";
}

/** Firestore rules — create ke liye auth.uid; local:… session par Firestore mat use karo */
export function resolveInterCompanyGroupOwnerUid(fallbackUid?: string | null): string {
  const authUid = auth.currentUser?.uid?.trim() || "";
  if (authUid && !authUid.startsWith("local:")) return authUid;
  const fb = String(fallbackUid || "").trim();
  if (fb && !fb.startsWith("local:")) return fb;
  return fb;
}

export function canSyncInterCompanyGroupsToFirestore(ownerUserId: string): boolean {
  const authUid = auth.currentUser?.uid?.trim() || "";
  return !!authUid && !authUid.startsWith("local:") && authUid === ownerUserId;
}

function readLocalGroups(ownerUserId: string): InterCompanyGroupDoc[] {
  if (typeof window === "undefined" || !ownerUserId) return [];
  try {
    const raw = localStorage.getItem(LOCAL_GROUPS_KEY(ownerUserId));
    if (!raw) return [];
    const list = JSON.parse(raw) as InterCompanyGroupDoc[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocalGroups(ownerUserId: string, groups: InterCompanyGroupDoc[]): void {
  if (typeof window === "undefined" || !ownerUserId) return;
  localStorage.setItem(LOCAL_GROUPS_KEY(ownerUserId), JSON.stringify(groups));
}

function mergeGroupLists(
  remote: InterCompanyGroupDoc[],
  local: InterCompanyGroupDoc[]
): InterCompanyGroupDoc[] {
  const map = new Map<string, InterCompanyGroupDoc>();
  remote.forEach((g) => map.set(g.id, g));
  local.filter((g) => g.localOnly).forEach((g) => map.set(g.id, g));
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function subscribeInterCompanyGroups(
  ownerUserId: string,
  onData: (groups: InterCompanyGroupDoc[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!ownerUserId) {
    onData([]);
    return () => undefined;
  }

  const pushMerged = (remote: InterCompanyGroupDoc[]) => {
    for (const g of remote) {
      if (!g?.id || !g.name) continue;
      void ensureInterCompanySystemNameRegistry({
        systemId: g.id,
        name: g.name,
        ownerUserId: g.ownerUserId,
      });
    }
    onData(mergeGroupLists(remote, readLocalGroups(ownerUserId)));
  };

  if (!canSyncInterCompanyGroupsToFirestore(ownerUserId)) {
    pushMerged([]);
    return () => undefined;
  }

  const q = query(GROUPS(), where("ownerUserId", "==", ownerUserId));
  return onSnapshot(
    q,
    (snap) => {
      pushMerged(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InterCompanyGroupDoc)));
    },
    (err) => {
      onError?.(err);
      pushMerged([]);
    }
  );
}

export async function fetchInterCompanyGroups(ownerUserId: string): Promise<InterCompanyGroupDoc[]> {
  if (!ownerUserId) return [];
  let remote: InterCompanyGroupDoc[] = [];
  if (canSyncInterCompanyGroupsToFirestore(ownerUserId)) {
    try {
      const q = query(GROUPS(), where("ownerUserId", "==", ownerUserId));
      const snap = await getDocs(q);
      remote = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InterCompanyGroupDoc));
    } catch {
      /* fallback local */
    }
  }
  return mergeGroupLists(remote, readLocalGroups(ownerUserId));
}

function createLocalGroup(args: {
  ownerUserId: string;
  name: string;
  ownerEmail?: string;
  ownerDisplayName?: string;
  visibility?: InterCompanyGroupVisibility;
  companyIds?: string[];
  memberUsers?: InterCompanyGroupMemberUser[];
}): string {
  assertLocalInterCompanySystemNameAvailable(args.ownerUserId, args.name);
  const nameKey = normalizeInterCompanySystemNameKey(args.name);
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row: InterCompanyGroupDoc = {
    id,
    name: args.name.trim(),
    nameKey,
    ownerUserId: args.ownerUserId,
    ownerEmail: String(args.ownerEmail || "").toLowerCase().trim() || undefined,
    ownerDisplayName: String(args.ownerDisplayName || "").trim() || undefined,
    visibility: normalizeInterCompanyGroupVisibility(args.visibility),
    companyIds: args.companyIds ?? [],
    memberUsers: args.memberUsers ?? [],
    localOnly: true,
  };
  const prev = readLocalGroups(args.ownerUserId);
  writeLocalGroups(args.ownerUserId, [row, ...prev]);
  return id;
}

/** Naya group — Firestore (auth.uid) ya local fallback */
export async function createInterCompanyGroup(args: {
  ownerUserId: string;
  name: string;
  ownerEmail?: string;
  ownerDisplayName?: string;
  visibility?: InterCompanyGroupVisibility;
  companyIds?: string[];
  memberUsers?: InterCompanyGroupMemberUser[];
}): Promise<{ id: string; localOnly: boolean }> {
  const ownerUserId = resolveInterCompanyGroupOwnerUid(args.ownerUserId);
  if (!ownerUserId) {
    throw new Error("Sign in required to create a system.");
  }
  const name = args.name.trim();
  if (!name) throw new Error("Enter a system name.");
  const visibility = normalizeInterCompanyGroupVisibility(args.visibility);

  assertLocalInterCompanySystemNameAvailable(ownerUserId, name);

  /** Local IC system — hamesha device par; Firestore par mat bhejo. */
  if (visibility === "local") {
    return {
      id: createLocalGroup({ ...args, ownerUserId, name, visibility: "local" }),
      localOnly: true,
    };
  }

  try {
    const nameKey = await assertInterCompanySystemNameAvailable({
      name,
      ownerUserId,
    });

    if (!canSyncInterCompanyGroupsToFirestore(ownerUserId)) {
      return { id: createLocalGroup({ ...args, ownerUserId, name, visibility }), localOnly: true };
    }

    const groupRef = doc(GROUPS());
    const nameRef = doc(SYSTEM_NAMES(), nameKey);

    await runTransaction(firestore, async (tx) => {
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists()) {
        const existingId = String(nameSnap.data()?.systemId || "").trim();
        if (existingId) throw new InterCompanySystemNameTakenError();
      }
      tx.set(groupRef, {
        name,
        nameKey,
        ownerUserId,
        ownerEmail: String(args.ownerEmail || "").toLowerCase().trim() || null,
        ownerDisplayName: String(args.ownerDisplayName || "").trim() || null,
        visibility,
        companyIds: args.companyIds ?? [],
        memberUsers: args.memberUsers ?? [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(nameRef, {
        nameKey,
        name,
        systemId: groupRef.id,
        ownerUserId,
        createdAt: serverTimestamp(),
      });
    });

    return { id: groupRef.id, localOnly: false };
  } catch (err) {
    if (err instanceof InterCompanySystemNameTakenError) throw err;
    const code = (err as { code?: string })?.code;
    if (code === "permission-denied" || code === "unavailable") {
      // Permission fail par bhi global naam duplicate mat banao (local-only)
      try {
        const taken = await isInterCompanySystemNameTaken({ name, ownerUserId });
        if (taken) throw new InterCompanySystemNameTakenError();
      } catch (inner) {
        if (inner instanceof InterCompanySystemNameTakenError) throw inner;
      }
      assertLocalInterCompanySystemNameAvailable(ownerUserId, name);
      return { id: createLocalGroup({ ...args, ownerUserId, name, visibility }), localOnly: true };
    }
    throw err;
  }
}

/** users collection — public/linked system card par creator email/name */
export async function fetchInterCompanyUserProfileByUid(
  uid: string
): Promise<{ email?: string; displayName?: string } | null> {
  const ownerUserId = String(uid || "").trim();
  if (!ownerUserId) return null;
  try {
    const snap = await getDocs(
      query(collection(firestore, "users"), where("uid", "==", ownerUserId), limit(1))
    );
    if (snap.empty) return null;
    const data = snap.docs[0].data() as { email?: string; displayName?: string; name?: string };
    return {
      email: String(data.email || "").toLowerCase().trim() || undefined,
      displayName: String(data.displayName || data.name || "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * System rename — sirf naam + nameKey; systemId / companies / joins same rehte hain.
 * Global name registry purana hata kar naya register karta hai.
 */
export async function renameInterCompanyGroup(args: {
  groupId: string;
  newName: string;
  ownerUserId: string;
}): Promise<void> {
  const ownerUserId = resolveInterCompanyGroupOwnerUid(args.ownerUserId);
  if (!ownerUserId) throw new Error("Sign in required to rename a system.");
  const newName = args.newName.trim();
  if (!newName) throw new Error("Enter a system name.");
  const groupId = args.groupId.trim();
  if (!groupId) throw new Error("System not found.");

  assertLocalInterCompanySystemNameAvailable(ownerUserId, newName, groupId);

  if (groupId.startsWith("local-")) {
    const prev = readLocalGroups(ownerUserId);
    const row = prev.find((g) => g.id === groupId);
    if (!row || row.ownerUserId !== ownerUserId) {
      throw new Error("Only the system owner can rename.");
    }
    const nameKey = normalizeInterCompanySystemNameKey(newName);
    writeLocalGroups(
      ownerUserId,
      prev.map((g) => (g.id === groupId ? { ...g, name: newName, nameKey } : g))
    );
    return;
  }

  const nameKey = await assertInterCompanySystemNameAvailable({
    name: newName,
    ownerUserId,
    exceptSystemId: groupId,
  });

  const groupRef = doc(GROUPS(), groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("System not found.");
  const groupData = groupSnap.data() as { ownerUserId?: string; name?: string; nameKey?: string };
  if (String(groupData.ownerUserId || "") !== ownerUserId) {
    throw new Error("Only the system owner can rename.");
  }

  const oldNameKey = groupDocNameKey(groupData);
  const newNameRef = doc(SYSTEM_NAMES(), nameKey);
  const oldNameRef = doc(SYSTEM_NAMES(), oldNameKey);

  await runTransaction(firestore, async (tx) => {
    // Firestore — saari reads pehle, phir writes
    const freshGroupSnap = await tx.get(groupRef);
    const takenSnap = await tx.get(newNameRef);
    const oldSnap = oldNameKey !== nameKey ? await tx.get(oldNameRef) : null;

    if (!freshGroupSnap.exists()) throw new Error("System not found.");
    const freshData = freshGroupSnap.data() as { ownerUserId?: string };
    if (String(freshData.ownerUserId || "") !== ownerUserId) {
      throw new Error("Only the system owner can rename.");
    }

    if (takenSnap.exists()) {
      const existingId = String(takenSnap.data()?.systemId || "").trim();
      if (existingId && existingId !== groupId) {
        throw new InterCompanySystemNameTakenError();
      }
    }

    tx.update(groupRef, {
      name: newName,
      nameKey,
      updatedAt: serverTimestamp(),
    });

    if (oldNameKey !== nameKey) {
      if (oldSnap?.exists() && String(oldSnap.data()?.systemId || "") === groupId) {
        tx.delete(oldNameRef);
      }
      // Registry pehle se is systemId ke liye ho to dubara create mat karo
      if (!takenSnap.exists()) {
        tx.set(newNameRef, {
          nameKey,
          name: newName,
          systemId: groupId,
          ownerUserId,
          createdAt: serverTimestamp(),
        });
      }
    }
  });
}

export async function updateInterCompanyGroup(
  groupId: string,
  patch: Partial<
    Pick<
      InterCompanyGroupDoc,
      | "name"
      | "nameKey"
      | "companyIds"
      | "memberUsers"
      | "visibility"
      | "companySummaries"
      | "companyOwners"
      | "ownerEmail"
      | "ownerDisplayName"
    >
  >,
  ownerUserId?: string
): Promise<void> {
  if (groupId.startsWith("local-")) {
    const uid = ownerUserId || "";
    const prev = readLocalGroups(uid);
    writeLocalGroups(
      uid,
      prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g))
    );
    return;
  }
  await updateDoc(doc(firestore, "inter_company_groups", groupId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** Public system — jab tak koi company joined ho delete block */
function assertPublicInterCompanySystemEmptyBeforeDelete(args: {
  visibility?: InterCompanyGroupVisibility;
  companyIds?: unknown;
}): void {
  if (normalizeInterCompanyGroupVisibility(args.visibility) !== "public") return;
  const joined =
    Array.isArray(args.companyIds) ?
      args.companyIds.filter((id) => typeof id === "string" && id.trim()).length
    : 0;
  if (joined > 0) {
    throw new Error(
      "Remove all companies from this public system before deleting."
    );
  }
}

export async function deleteInterCompanyGroup(
  groupId: string,
  ownerUserId?: string
): Promise<void> {
  if (groupId.startsWith("local-")) {
    const uid = ownerUserId || "";
    const prev = readLocalGroups(uid);
    const row = prev.find((g) => g.id === groupId);
    if (row) {
      assertPublicInterCompanySystemEmptyBeforeDelete({
        visibility: row.visibility,
        companyIds: row.companyIds,
      });
    }
    writeLocalGroups(
      uid,
      prev.filter((g) => g.id !== groupId)
    );
    return;
  }

  const groupRef = doc(firestore, "inter_company_groups", groupId);
  let nameKey: string | undefined;
  try {
    const snap = await getDoc(groupRef);
    if (snap.exists()) {
      const data = snap.data() as {
        nameKey?: string;
        name?: string;
        visibility?: InterCompanyGroupVisibility;
        companyIds?: string[];
      };
      assertPublicInterCompanySystemEmptyBeforeDelete({
        visibility: data.visibility,
        companyIds: data.companyIds,
      });
      nameKey =
        String(data.nameKey || "").trim() ||
        normalizeInterCompanySystemNameKey(String(data.name || ""));
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("before deleting")) throw err;
    /* optional read fail — delete attempt below */
  }

  await deleteDoc(groupRef);

  if (nameKey) {
    try {
      const nameRef = doc(SYSTEM_NAMES(), nameKey);
      const nameSnap = await getDoc(nameRef);
      if (nameSnap.exists() && String(nameSnap.data()?.systemId || "") === groupId) {
        await deleteDoc(nameRef);
      }
    } catch {
      /* optional */
    }
  }
}

/** Company ko ek system me add — multi-system: doosre groups se auto-remove nahi */
export async function assignCompanyToInterCompanyGroup(args: {
  groups: InterCompanyGroupDoc[];
  companyId: string;
  groupId: string | null;
  ownerUserId?: string;
  /** Add par group doc me denormalized row — public View com ke liye */
  companySummary?: InterCompanyGroupCompanySummary;
  companyOwner?: InterCompanyGroupCompanyOwner;
}): Promise<void> {
  if (!args.groupId) return;
  const target = args.groups.find((g) => g.id === args.groupId);
  if (!target || target.companyIds.includes(args.companyId)) return;

  const nextSummaries = { ...(target.companySummaries ?? {}) };
  const nextOwners = { ...(target.companyOwners ?? {}) };
  if (args.companySummary) {
    nextSummaries[args.companyId] = args.companySummary;
  }
  if (args.companyOwner) {
    nextOwners[args.companyId] = args.companyOwner;
  }
  await updateInterCompanyGroup(
    args.groupId,
    {
      companyIds: [...target.companyIds, args.companyId],
      companySummaries: nextSummaries,
      companyOwners: nextOwners,
    },
    args.ownerUserId
  );
}

/** Public system — visitor apni company add kare; stale companyIds + permission safe arrayUnion */
export async function addCompanyToPublicInterCompanySystem(args: {
  systemId: string;
  companyId: string;
  companySummary?: InterCompanyGroupCompanySummary;
  /** Public profile owner rule ke liye */
  ownerUserId?: string;
  ownerEmail?: string;
}): Promise<void> {
  const companyId = args.companyId.trim();
  const systemId = args.systemId.trim();
  if (!companyId || !systemId || systemId.startsWith("local-")) {
    throw new Error("Invalid system or company.");
  }

  const ref = doc(firestore, "inter_company_groups", systemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("System not found.");
  const data = snap.data() as InterCompanyGroupDoc;
  if (normalizeInterCompanyGroupVisibility(data.visibility) !== "public") {
    throw new Error("This system is not public.");
  }

  const existingIds = Array.isArray(data.companyIds)
    ? data.companyIds.filter((x) => typeof x === "string")
    : [];
  if (existingIds.includes(companyId)) return;

  const patch: Record<string, unknown> = {
    companyIds: arrayUnion(companyId),
    updatedAt: serverTimestamp(),
  };
  if (args.companySummary) {
    patch[`companySummaries.${companyId}`] = args.companySummary;
  }
  if (args.ownerUserId || args.ownerEmail) {
    patch[`companyOwners.${companyId}`] = {
      ownerUserId: args.ownerUserId || "",
      ownerEmail: String(args.ownerEmail || "").toLowerCase().trim(),
    };
  }
  await updateDoc(ref, patch);
  // Public system Other table — sab users code/PAN/phone read kar saken
  if (args.companySummary) {
    await upsertInterCompanyPublicCompanyProfile({
      companyId,
      summary: args.companySummary,
      ownerUserId: args.ownerUserId,
      ownerEmail: args.ownerEmail,
    });
  }
}

/** Join accept — dono companies system card me add (public: visitor; private: sirf system owner) */
export async function ensureJoinPairCompaniesInInterCompanySystem(args: {
  systemId: string;
  requesterCompanyId: string;
  targetCompanyId: string;
  actingUserId: string;
}): Promise<void> {
  const systemId = args.systemId.trim();
  const requesterCompanyId = args.requesterCompanyId.trim();
  const targetCompanyId = args.targetCompanyId.trim();
  const actingUserId = args.actingUserId.trim();
  if (!systemId || systemId.startsWith("local-") || !requesterCompanyId || !targetCompanyId) return;

  const snap = await getDoc(doc(firestore, "inter_company_groups", systemId));
  if (!snap.exists()) return;
  const data = snap.data() as InterCompanyGroupDoc;
  const visibility = normalizeInterCompanyGroupVisibility(data.visibility);

  const pairIds = [requesterCompanyId, targetCompanyId];
  const profiles = await import("@/lib/interCompany/interCompanyPublicCompanyProfile").then((m) =>
    m.fetchInterCompanyPublicCompanyProfiles(pairIds)
  );

  let companyIds = Array.isArray(data.companyIds)
    ? data.companyIds.filter((x) => typeof x === "string")
    : [];
  const companySummaries = { ...(data.companySummaries ?? {}) };
  const companyOwners = { ...(data.companyOwners ?? {}) };
  let dirtyPrivate = false;

  for (const companyId of pairIds) {
    if (companyIds.includes(companyId)) continue;

    const pub = profiles.get(companyId);
    const summary: InterCompanyGroupCompanySummary = pub
      ? {
          name: pub.name,
          companyCode: pub.companyCode,
          pan: pub.pan,
          phone: pub.phone,
        }
      : {
          name: companyId,
          companyCode: "—",
          pan: "—",
          phone: "—",
        };

    const ownerUserId = pub?.ownerUserId || "";
    const ownerEmail = pub?.ownerEmail || "";

    if (visibility === "public") {
      await addCompanyToPublicInterCompanySystem({
        systemId,
        companyId,
        companySummary: summary,
        ownerUserId: ownerUserId || undefined,
        ownerEmail: ownerEmail || undefined,
      });
      companyIds = [...companyIds, companyId];
      continue;
    }

    if (data.ownerUserId !== actingUserId) continue;

    companyIds.push(companyId);
    companySummaries[companyId] = summary;
    if (ownerUserId || ownerEmail) {
      companyOwners[companyId] = { ownerUserId, ownerEmail };
    }
    dirtyPrivate = true;
  }

  if (visibility !== "public" && dirtyPrivate && data.ownerUserId === actingUserId) {
    await updateInterCompanyGroup(
      systemId,
      { companyIds, companySummaries, companyOwners },
      data.ownerUserId
    );
  }
}

/** Owned company — is system se hatao (Leave) */
export async function removeCompanyFromInterCompanySystem(args: {
  systemId: string;
  companyId: string;
  actingUserId: string;
}): Promise<void> {
  const systemId = args.systemId.trim();
  const companyId = args.companyId.trim();
  const actingUserId = args.actingUserId.trim();
  if (!systemId || !companyId) {
    throw new Error("Invalid system or company.");
  }

  if (systemId.startsWith("local-")) {
    const uid = actingUserId || "";
    const prev = readLocalGroups(uid);
    const row = prev.find((g) => g.id === systemId);
    if (!row) throw new Error("System not found.");
    if (!row.companyIds.includes(companyId)) return;
    const nextIds = row.companyIds.filter((id) => id !== companyId);
    const nextSummaries = { ...(row.companySummaries ?? {}) };
    delete nextSummaries[companyId];
    const nextOwners = { ...(row.companyOwners ?? {}) };
    delete nextOwners[companyId];
    await updateInterCompanyGroup(
      systemId,
      { companyIds: nextIds, companySummaries: nextSummaries, companyOwners: nextOwners },
      uid
    );
    return;
  }

  const ref = doc(firestore, "inter_company_groups", systemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("System not found.");
  const data = snap.data() as InterCompanyGroupDoc;
  const visibility = normalizeInterCompanyGroupVisibility(data.visibility);

  if (!data.companyIds.includes(companyId)) return;

  const isSystemOwner = data.ownerUserId === actingUserId;
  const rowOwner = String(data.companyOwners?.[companyId]?.ownerUserId || "").trim();
  const isRowOwner = rowOwner === actingUserId;

  if (!isSystemOwner && !(visibility === "public" && isRowOwner)) {
    throw new Error("You cannot remove this company from the system.");
  }

  const nextIds = data.companyIds.filter((id) => id !== companyId);
  const nextSummaries = { ...(data.companySummaries ?? {}) };
  delete nextSummaries[companyId];
  const nextOwners = { ...(data.companyOwners ?? {}) };
  delete nextOwners[companyId];

  if (isSystemOwner) {
    await updateInterCompanyGroup(
      systemId,
      { companyIds: nextIds, companySummaries: nextSummaries, companyOwners: nextOwners },
      data.ownerUserId
    );
    return;
  }

  // Public system — company owner Leave (rules: icLeaveCompanyId + owner check)
  await updateDoc(ref, {
    companyIds: arrayRemove(companyId),
    icLeaveCompanyId: companyId,
    [`companySummaries.${companyId}`]: deleteField(),
    [`companyOwners.${companyId}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

/** Visitor ki apni groups se company hatao jab public system me add ho */
export async function removeCompanyFromUserOwnedGroups(args: {
  groups: InterCompanyGroupDoc[];
  companyId: string;
  ownerUserId: string;
  exceptGroupId?: string;
}): Promise<void> {
  const companyId = args.companyId.trim();
  const ownerUserId = args.ownerUserId.trim();
  if (!companyId || !ownerUserId) return;

  const ops: Promise<void>[] = [];
  for (const g of args.groups) {
    if (g.ownerUserId !== ownerUserId) continue;
    if (args.exceptGroupId && g.id === args.exceptGroupId) continue;
    if (!g.companyIds.includes(companyId)) continue;
    const nextSummaries = { ...(g.companySummaries ?? {}) };
    delete nextSummaries[companyId];
    ops.push(
      updateInterCompanyGroup(
        g.id,
        {
          companyIds: g.companyIds.filter((id) => id !== companyId),
          companySummaries: nextSummaries,
        },
        ownerUserId
      )
    );
  }
  await Promise.all(ops);
}

/** Company kis group me hai */
export function resolveInterCompanyGroupForCompany(
  groups: InterCompanyGroupDoc[],
  companyId: string
): InterCompanyGroupDoc | null {
  return groups.find((g) => g.companyIds.includes(companyId)) ?? null;
}

/** Invite preview — group doc se snapshot */
export function interCompanyGroupToPreview(
  group: InterCompanyGroupDoc,
  companyNameById: Map<string, string>
): InterCompanyGroupPreview {
  return {
    groupId: group.id,
    groupName: group.name,
    companies: group.companyIds.map((id) => ({
      id,
      name: companyNameById.get(id) || id,
    })),
    memberUsers: group.memberUsers ?? [],
  };
}

/** Join settings doc me companyGroupId cache */
export async function writeCompanyInterCompanyGroupId(
  companyId: string,
  groupId: string | null,
  updatedByUid: string
): Promise<void> {
  await setDoc(
    doc(firestore, "companies", companyId, "inter_company_config", "settings"),
    { companyGroupId: groupId, updatedByUid, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export function interCompanyGroupCreateErrorMessage(err: unknown): string {
  if (err instanceof InterCompanySystemNameTakenError) {
    return "This system name is already taken.";
  }
  const code = (err as { code?: string })?.code;
  if (code === "permission-denied") {
    return "Firestore permission denied — deploy firestore.rules (inter_company_groups) and sign in with Firebase.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Could not create group.";
}

/** Rename toast — create wale errors reuse, default message alag */
export function interCompanyGroupRenameErrorMessage(err: unknown): string {
  const msg = interCompanyGroupCreateErrorMessage(err);
  return msg === "Could not create group." ? "Could not rename system." : msg;
}

/** Delete toast — public system me companies joined hon to user-friendly message */
export function interCompanyGroupDeleteErrorMessage(err: unknown): string {
  const msg = interCompanyGroupCreateErrorMessage(err);
  return msg === "Could not create group." ? "Could not delete system." : msg;
}
