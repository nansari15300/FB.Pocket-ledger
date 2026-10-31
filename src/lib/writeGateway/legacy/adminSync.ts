import { setDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import type { User } from "@/lib/pbCompat/auth";

/**
 * Ensures Firestore has users/{uid} and optional app_settings/admin_config so
 * isAdmin() returns true before admin pages (e.g. companies) run getDocs.
 * Call this before any admin-only Firestore read when the user is SuperAdmin/CompanyAdmin.
 */
export async function ensureAdminSync(
  authUser: User | null,
  role: string | undefined
): Promise<void> {
  if (!authUser || (role !== "SuperAdmin" && role !== "CompanyAdmin")) return;
  // Server login: Firestore is off for this session (writes would hang); the server holds the user.
  if (isPocketBaseAppSessionActive()) return;

  const uidDocRef = doc(firestore, "users", authUser.uid);
  await setDoc(
    uidDocRef,
    { id: authUser.uid, uid: authUser.uid, role },
    { merge: true }
  );

  const email = (authUser.email ?? "").trim();
  if (!email) return;

  try {
    const adminConfigRef = doc(firestore, "app_settings", "admin_config");
    const adminSnap = await getDoc(adminConfigRef);
    const existing =
      (adminSnap.exists() ? adminSnap.data()?.superAdminEmails : null) ?? [];
    const list = Array.isArray(existing) ? [...existing] : [];
    if (!list.includes(email)) {
      list.push(email);
      await setDoc(adminConfigRef, { superAdminEmails: list }, { merge: true });
    }
  } catch {
    // ignore
  }
}
