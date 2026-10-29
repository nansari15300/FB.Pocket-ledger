/**
 * Reverse index: email → companies that added this user on IC Connect User tab.
 * Firestore:
 *   companies/{companyId}/ic_connect_invites/{emailDocId}
 *   companies/{companyId}.icConnectInvitedEmailsLower[]  (list query fallback)
 * Local mirror: pl-ic-connect-invites-by-email::{email}
 */
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import type {
  InterCompanyConnectMasterVisibility,
  InterCompanyConnectUserEntry,
} from "@/lib/interCompany/interCompanyConnectUsers";
import {
  normalizeConnectMasterVisibility,
  loadInterCompanyConnectUsers,
} from "@/lib/interCompany/interCompanyConnectUsers";
import { isPureLocalInterCompanyCompany } from "@/lib/interCompany/localInterCompanyPolicy";

export type InterCompanyConnectInviteHost = {
  hostCompanyId: string;
  hostCompanyName?: string;
  showCompanyName: boolean;
  showMasters: boolean;
  masterVisibility: InterCompanyConnectMasterVisibility;
  updatedAt?: string;
};

function normalizeEmail(email: string): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function emailToConnectInviteDocId(email: string): string {
  return normalizeEmail(email).replace(/@/g, "_at_").replace(/\./g, "_dot_");
}

const LOCAL_INVITES_KEY = (email: string) =>
  `pl-ic-connect-invites-by-email::${normalizeEmail(email)}`;

function companyDocRef(companyId: string) {
  return doc(firestore, "companies", companyId);
}

function companyInviteDocRef(companyId: string, email: string): DocumentReference {
  return doc(firestore, "companies", companyId, "ic_connect_invites", emailToConnectInviteDocId(email));
}

function entryToInviteHost(
  companyId: string,
  entry: InterCompanyConnectUserEntry,
  hostCompanyName?: string
): InterCompanyConnectInviteHost {
  return {
    hostCompanyId: companyId,
    hostCompanyName: hostCompanyName?.trim() || undefined,
    showCompanyName: entry.showCompanyName !== false,
    showMasters: entry.showMasters === true,
    masterVisibility: normalizeConnectMasterVisibility(entry.masterVisibility),
    updatedAt: new Date().toISOString(),
  };
}

function inviteHostFromFirestoreDoc(
  companyId: string,
  row: Record<string, unknown>
): InterCompanyConnectInviteHost {
  return {
    hostCompanyId: companyId,
    hostCompanyName: String(row.hostCompanyName || "").trim() || undefined,
    showCompanyName: row.showCompanyName !== false,
    showMasters: row.showMasters === true,
    masterVisibility: normalizeConnectMasterVisibility(
      row.masterVisibility as Partial<InterCompanyConnectMasterVisibility>
    ),
    updatedAt: String(row.updatedAt || "").trim() || undefined,
  };
}

/** Pehle se saved connect_users local cache — same device / offline bootstrap. */
function scanLocalConnectUserCachesForEmail(email: string): InterCompanyConnectInviteHost[] {
  if (typeof window === "undefined" || !email) return [];
  const normalized = normalizeEmail(email);
  const prefix = "pl-inter-company-connect-users::";
  const out: InterCompanyConnectInviteHost[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const companyId = key.slice(prefix.length).trim();
      if (!companyId) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { users?: InterCompanyConnectUserEntry[] };
      if (!Array.isArray(parsed.users)) continue;
      const entry = parsed.users.find((u) => normalizeEmail(u.email) === normalized);
      if (!entry) continue;
      out.push(entryToInviteHost(companyId, entry));
    }
  } catch {
    /* ignore */
  }
  return out;
}

function readLocalInviteHosts(email: string): InterCompanyConnectInviteHost[] {
  if (typeof window === "undefined" || !email) return [];
  try {
    const raw = localStorage.getItem(LOCAL_INVITES_KEY(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { hosts?: Record<string, InterCompanyConnectInviteHost> };
    if (!parsed.hosts || typeof parsed.hosts !== "object") return [];
    return Object.values(parsed.hosts).filter((h) => h?.hostCompanyId);
  } catch {
    return [];
  }
}

function writeLocalInviteHosts(email: string, hosts: Record<string, InterCompanyConnectInviteHost>): void {
  if (typeof window === "undefined" || !email) return;
  try {
    localStorage.setItem(LOCAL_INVITES_KEY(email), JSON.stringify({ hosts }));
  } catch {
    /* ignore */
  }
}

function mergeInviteHosts(
  ...groups: InterCompanyConnectInviteHost[][]
): InterCompanyConnectInviteHost[] {
  const byId = new Map<string, InterCompanyConnectInviteHost>();
  for (const h of groups.flat()) {
    if (!h.hostCompanyId) continue;
    const prev = byId.get(h.hostCompanyId);
    byId.set(h.hostCompanyId, prev ? { ...prev, ...h } : h);
  }
  return [...byId.values()].sort((a, b) =>
    (a.hostCompanyName || a.hostCompanyId).localeCompare(b.hostCompanyName || b.hostCompanyId)
  );
}

function companyIdFromInviteDocRef(ref: DocumentReference): string {
  return String(ref.parent?.parent?.id || "").trim();
}

async function loadConnectInvitesFromCompanyQuery(
  email: string
): Promise<InterCompanyConnectInviteHost[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  try {
    const snap = await getDocs(
      query(
        collection(firestore, "companies"),
        where("icConnectInvitedEmailsLower", "array-contains", normalized)
      )
    );
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        hostCompanyId: d.id,
        hostCompanyName: String(data.name || "").trim() || undefined,
        showCompanyName: true,
        showMasters: false,
        masterVisibility: normalizeConnectMasterVisibility(undefined),
      } satisfies InterCompanyConnectInviteHost;
    });
  } catch {
    return [];
  }
}

async function loadConnectInvitesFromCollectionGroup(
  email: string
): Promise<InterCompanyConnectInviteHost[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  try {
    const snap = await getDocs(
      query(collectionGroup(firestore, "ic_connect_invites"), where("email", "==", normalized))
    );
    return snap.docs
      .map((d) => {
        const companyId = companyIdFromInviteDocRef(d.ref);
        if (!companyId) return null;
        return inviteHostFromFirestoreDoc(companyId, d.data() as Record<string, unknown>);
      })
      .filter(Boolean) as InterCompanyConnectInviteHost[];
  } catch {
    return [];
  }
}

export async function loadConnectInvitesForEmail(
  email: string | null | undefined
): Promise<InterCompanyConnectInviteHost[]> {
  const normalized = normalizeEmail(email || "");
  if (!normalized) return [];

  const local = mergeInviteHosts(
    readLocalInviteHosts(normalized),
    scanLocalConnectUserCachesForEmail(normalized)
  );
  const remote = mergeInviteHosts(
    await loadConnectInvitesFromCollectionGroup(normalized),
    await loadConnectInvitesFromCompanyQuery(normalized)
  );
  const merged = mergeInviteHosts(remote, local);
  writeLocalInviteHosts(normalized, Object.fromEntries(merged.map((h) => [h.hostCompanyId, h])));
  return merged;
}

export function subscribeConnectInvitesForEmail(
  email: string | null | undefined,
  onData: (hosts: InterCompanyConnectInviteHost[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled()) {
    onData([]);
    return () => undefined;
  }
  const normalized = normalizeEmail(email || "");
  if (!normalized) {
    onData([]);
    return () => undefined;
  }

  let cancelled = false;
  const emitLocal = () => {
    onData(
      mergeInviteHosts(readLocalInviteHosts(normalized), scanLocalConnectUserCachesForEmail(normalized))
    );
  };
  emitLocal();

  const mergeAndEmit = (remote: InterCompanyConnectInviteHost[]) => {
    if (cancelled) return;
    const merged = mergeInviteHosts(
      remote,
      readLocalInviteHosts(normalized),
      scanLocalConnectUserCachesForEmail(normalized)
    );
    writeLocalInviteHosts(normalized, Object.fromEntries(merged.map((h) => [h.hostCompanyId, h])));
    onData(merged);
  };

  const inviteQuery = query(
    collectionGroup(firestore, "ic_connect_invites"),
    where("email", "==", normalized)
  );

  const unsubGroup = onSnapshot(
    inviteQuery,
    (snap) => {
      const hosts = snap.docs
        .map((d) => {
          const companyId = companyIdFromInviteDocRef(d.ref);
          if (!companyId) return null;
          return inviteHostFromFirestoreDoc(companyId, d.data() as Record<string, unknown>);
        })
        .filter(Boolean) as InterCompanyConnectInviteHost[];
      mergeAndEmit(hosts);
    },
    (err) => {
      onError?.(err);
      void loadConnectInvitesFromCompanyQuery(normalized).then((rows) => {
        if (!cancelled) mergeAndEmit(rows);
      });
    }
  );

  const companyListQuery = query(
    collection(firestore, "companies"),
    where("icConnectInvitedEmailsLower", "array-contains", normalized)
  );
  const unsubCompanies = onSnapshot(
    companyListQuery,
    (snap) => {
      const fromCompanies = snap.docs.map((d) => {
        const data = d.data();
        return {
          hostCompanyId: d.id,
          hostCompanyName: String(data.name || "").trim() || undefined,
          showCompanyName: true,
          showMasters: false,
          masterVisibility: normalizeConnectMasterVisibility(undefined),
        } satisfies InterCompanyConnectInviteHost;
      });
      if (fromCompanies.length) {
        mergeAndEmit(fromCompanies);
      }
    },
    () => {
      /* collection group is primary */
    }
  );

  return () => {
    cancelled = true;
    unsubGroup();
    unsubCompanies();
  };
}

/** After Connect User save — sync reverse invites for added/removed emails. */
export async function syncConnectUserInvitesForCompany(args: {
  companyId: string;
  users: InterCompanyConnectUserEntry[];
  hostCompanyName?: string;
  previousUsers?: InterCompanyConnectUserEntry[];
}): Promise<void> {
  const { companyId, users, hostCompanyName } = args;
  if (!companyId) return;

  const previousUsers =
    args.previousUsers ?? (await loadInterCompanyConnectUsers(companyId));
  const prevEmails = new Set(previousUsers.map((u) => normalizeEmail(u.email)).filter(Boolean));
  const nextEmails = new Set(users.map((u) => normalizeEmail(u.email)).filter(Boolean));
  const removedEmails = [...prevEmails].filter((e) => !nextEmails.has(e));

  const isLocal = await isPureLocalInterCompanyCompany(companyId);
  const invitedEmailsLower = users.map((u) => normalizeEmail(u.email)).filter(Boolean);

  for (const entry of users) {
    const email = normalizeEmail(entry.email);
    if (!email) continue;
    const host = entryToInviteHost(companyId, entry, hostCompanyName);

    const localHosts = Object.fromEntries(
      readLocalInviteHosts(email).map((h) => [h.hostCompanyId, h])
    );
    localHosts[companyId] = host;
    writeLocalInviteHosts(email, localHosts);

    if (isLocal) continue;

    try {
      await setDoc(
        companyInviteDocRef(companyId, email),
        {
          email,
          hostCompanyId: companyId,
          hostCompanyName: host.hostCompanyName ?? null,
          showCompanyName: host.showCompanyName,
          showMasters: host.showMasters,
          masterVisibility: host.masterVisibility,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("[IC connect invites] invite doc write failed:", err);
    }
  }

  for (const email of removedEmails) {
    const localHosts = Object.fromEntries(
      readLocalInviteHosts(email).map((h) => [h.hostCompanyId, h])
    );
    delete localHosts[companyId];
    writeLocalInviteHosts(email, localHosts);

    if (isLocal) continue;

    try {
      await deleteDoc(companyInviteDocRef(companyId, email));
    } catch {
      /* ignore */
    }
  }

  if (isLocal) return;

  try {
    await updateDoc(companyDocRef(companyId), {
      icConnectInvitedEmailsLower: invitedEmailsLower,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[IC connect invites] company icConnectInvitedEmailsLower update failed:", err);
    try {
      await setDoc(
        companyDocRef(companyId),
        {
          icConnectInvitedEmailsLower: invitedEmailsLower,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      /* offline */
    }
  }

  // Legacy top-level doc cleanup (older builds)
  for (const email of [...nextEmails, ...removedEmails]) {
    try {
      await updateDoc(doc(firestore, "ic_connect_invites", emailToConnectInviteDocId(email)), {
        [`hosts.${companyId}`]: deleteField(),
      });
    } catch {
      /* ignore */
    }
  }
}

export function connectInviteLabelForPartner(
  companyName: string,
  grant: InterCompanyConnectInviteHost | undefined
): string {
  if (grant && grant.showCompanyName === false) return "Connected company";
  return companyName;
}
