import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { deleteCompanyComplete } from "@/lib/actions/deleteCompanyAction";
import { resolveCompanyRecycleRootForId, companyRecycleMustSkipFirestore } from "@/lib/companyRecycleRoot";

/**
 * Recycle bin se company permanently hataane ke baad Firestore align karo.
 * Local / PL-server: yahan Firestore mat chhedo (same-id online production doc corrupt).
 * Online only: soft-hide (`movedToAdminRecycleAt`) ya hard delete.
 */
export async function finalizeCompanyPermanentDeleteOnServer(
    companyId: string,
    quickDelete: boolean,
    userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const cid = String(companyId || "").trim();
    const uid = String(userId || "").trim();
    if (!cid) return { ok: false, error: "Invalid company id" };
    if (!uid) return { ok: false, error: "Not signed in" };

    try {
        const { root } = await resolveCompanyRecycleRootForId(cid);
        if (companyRecycleMustSkipFirestore(root)) {
            return { ok: true };
        }

        const snap = await getDoc(doc(firestore, "companies", cid));
        if (!snap.exists()) {
            return { ok: true };
        }

        if (quickDelete) {
            const result = await deleteCompanyComplete(cid, uid);
            if (!result.success) return { ok: false, error: result.error || "Permanent delete failed" };
            return { ok: true };
        }
        await updateDoc(doc(firestore, "companies", cid), {
            movedToAdminRecycleAt: serverTimestamp(),
        });
        return { ok: true };
    } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "permission-denied" || code === "PERMISSION_DENIED") {
            // Server doc missing / rules — local row hataane ke liye SQLite path aage chal sakta hai.
            return { ok: true };
        }
        return { ok: false, error: e instanceof Error ? e.message : "Firestore update failed" };
    }
}
