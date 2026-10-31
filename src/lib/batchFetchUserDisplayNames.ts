"use client";

import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

/** Firestore `where('…','in', …)` discrete values cap. */
export const FIRESTORE_UID_IN_CHUNK = 30;

/** User doc snapshot → voucher “User column” text; email prefix heuristic raw-uid avoidance. */
export function displayNameFromUserFirestoreDoc(
  data: Record<string, unknown> | undefined,
  docId: string
): string | null {
  if (!data) return null;
  const uid = (data.uid as string) || docId;
  if (!uid) return null;
  const email = typeof data.email === "string" ? data.email : "";
  const emailPrefix = email.includes("@") ? email.split("@")[0] : "";
  const raw = (data.displayName || data.name || emailPrefix || null) as string | null;
  if (!raw || raw === "Unknown" || raw === "N/A") return null;
  const isUIDPattern =
    raw.length > 15 && /^[a-zA-Z0-9_-]+$/.test(raw) && !raw.includes("@") && !raw.includes(" ");
  const name = isUIDPattern && emailPrefix ? emailPrefix : raw;
  return name || null;
}

/**
 * Bulk uid → display name WITHOUT `getDocs(collection(users))` (poor scalability + freezes UI).
 */
export async function batchFetchUserDisplayNamesFromFirestore(
  uidList: string[],
  shouldAbort: () => boolean = () => false
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(uidList.map((u) => String(u || "").trim()).filter(Boolean))];
  if (!uniq.length) return out;
  for (let i = 0; i < uniq.length; i += FIRESTORE_UID_IN_CHUNK) {
    if (shouldAbort()) return out;
    const chunk = uniq.slice(i, i + FIRESTORE_UID_IN_CHUNK);
    try {
      const q = query(collection(firestore, "users"), where("uid", "in", chunk));
      const snap = await getDocs(q);
      snap.docs.forEach((docSnap) => {
        const nm = displayNameFromUserFirestoreDoc(docSnap.data() as Record<string, unknown>, docSnap.id);
        if (!nm) return;
        const data = docSnap.data() as { uid?: string };
        const u = typeof data.uid === "string" && data.uid.trim() ? data.uid : docSnap.id;
        if ((out[u] || "") !== nm) out[u] = nm;
      });
    } catch {
      /* rights / offline — per-uid fallback below */
    }
  }
  const stale = uniq.filter((u) => !out[u]);
  const USER_UID_FETCH_PARALLEL = 12;
  for (let j = 0; j < stale.length; j += USER_UID_FETCH_PARALLEL) {
    if (shouldAbort()) return out;
    const slice = stale.slice(j, j + USER_UID_FETCH_PARALLEL);
    await Promise.all(
      slice.map(async (uid) => {
        try {
          const dq = query(collection(firestore, "users"), where("uid", "==", uid));
          const ds = await getDocs(dq);
          let data = ds.docs[0]?.data() as Record<string, unknown> | undefined;
          if (!data) {
            const legacy = await getDoc(doc(firestore, "users", uid));
            if (legacy.exists()) data = legacy.data() as Record<string, unknown>;
          }
          const nm = displayNameFromUserFirestoreDoc(data, uid);
          if (nm && (out[uid] || "") !== nm) out[uid] = nm;
        } catch {
          /* skip */
        }
      })
    );
  }
  return out;
}

export type AppUserProfileByEmail = {
  email: string;
  photoURL?: string;
  displayName?: string;
  uid?: string;
};

function photoFromUserDoc(data: Record<string, unknown>): string | undefined {
  for (const key of ["photoURL", "photoUrl", "avatarUrl", "avatar"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Google profile photo — chhota size reliable load ke liye. */
export function normalizeGooglePhotoUrl(url?: string | null): string | undefined {
  const raw = String(url ?? "").trim();
  if (!raw) return undefined;
  if (raw.includes("googleusercontent.com")) {
    const base = raw.split("=")[0];
    return `${base}=s96-c`;
  }
  return raw;
}

/** Firestore users — email case mismatch par bhi profile (photo + name) resolve. */
export async function fetchAppUserProfileByEmail(email: string): Promise<AppUserProfileByEmail | null> {
  const trimmed = String(email || "").trim();
  const lower = trimmed.toLowerCase();
  if (!lower.includes("@")) return null;
  const variants = [...new Set([trimmed, lower].filter(Boolean))];
  for (const em of variants) {
    try {
      const snap = await getDocs(query(collection(firestore, "users"), where("email", "==", em)));
      const docSnap = snap.docs[0];
      if (!docSnap) continue;
      const data = docSnap.data() as Record<string, unknown>;
      const resolvedEmail = String(data.email || em).trim().toLowerCase();
      return {
        email: resolvedEmail,
        photoURL: normalizeGooglePhotoUrl(photoFromUserDoc(data)),
        displayName:
          typeof data.displayName === "string"
            ? data.displayName.trim()
            : typeof data.name === "string"
              ? data.name.trim()
              : undefined,
        uid: typeof data.uid === "string" ? data.uid : docSnap.id,
      };
    } catch {
      /* offline / rules */
    }
  }
  return null;
}

/** Share panel — har email ke liye profile (batch me sequential, Firestore `in` cap safe). */
export async function fetchAppUserProfilesByEmails(emails: string[]): Promise<AppUserProfileByEmail[]> {
  const seen = new Set<string>();
  const out: AppUserProfileByEmail[] = [];
  for (const raw of emails) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key.includes("@") || seen.has(key)) continue;
    seen.add(key);
    const profile = await fetchAppUserProfileByEmail(raw);
    if (profile) out.push(profile);
  }
  return out;
}
