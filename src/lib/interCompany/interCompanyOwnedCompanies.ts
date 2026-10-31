/**
 * User ki owned companies — View com / system UI (Firestore ownerId / ownerEmail).
 */
import { collection, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

export async function resolveOwnedCompaniesForUser(
  uid: string,
  email?: string
): Promise<{ id: string; name: string }[]> {
  const map = new Map<string, string>();
  const addFromSnap = (snap: { docs: { id: string; data: () => unknown }[] }) => {
    snap.docs.forEach((d) => {
      const data = d.data() as { name?: string };
      map.set(d.id, String(data.name || "Company").trim() || "Company");
    });
  };

  try {
    if (uid) {
      const byOwner = await getDocs(
        query(collection(firestore, "companies"), where("ownerId", "==", uid))
      );
      addFromSnap(byOwner);
    }

    const em = (email || "").trim().toLowerCase();
    if (em) {
      const byEmail = await getDocs(
        query(collection(firestore, "companies"), where("ownerEmail", "==", em))
      );
      addFromSnap(byEmail);
    }
  } catch (err) {
    console.warn("[interCompany] resolveOwnedCompaniesForUser skipped:", err);
  }

  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}
