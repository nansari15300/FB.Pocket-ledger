import "server-only";

import { serverDb } from "@/lib/server/appDb";
import { adminServerHardDeleteDeletedCompany } from "@/lib/server/adminRecycleBinDeleteCompany";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

function ownsDeletedCompany(data: Record<string, unknown>, uid: string, email: string | undefined): boolean {
    const oid = String(data.ownerId || "").trim();
    if (oid && uid && oid === uid) return true;
    const oe = String(data.ownerEmail || "").toLowerCase().trim();
    const ue = String(email || "").toLowerCase().trim();
    return !!(oe && ue && oe === ue);
}

function readQuickDeleteFromConfig(data: Record<string, unknown> | undefined): boolean {
    if (!data) return false;
    return data.quickDelete === true;
}

/**
 * Normal user recycle bin: company `isDeleted` + owner match ho to Admin SDK se finalize —
 * `movedToAdminRecycleAt` set (quick delete OFF) ya poori hard delete (quick delete ON).
 * Client `updateDoc` / rules mismatch se "Permanent delete failed" aata tha.
 */
export async function ownerFinalizeCompanyRecycleBinOnServer(params: {
    companyId: string;
    uid: string;
    email: string | undefined;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const cid = String(params.companyId || "").trim();
    if (!cid) return { ok: false, error: "Invalid company id" };

    try {
        const db = serverDb();
        const ref = db.collection("companies").doc(cid);
        const snap = await ref.get();
        if (!snap.exists) return { ok: true };

        const data = (snap.data() || {}) as Record<string, unknown>;
        if (data.isDeleted !== true) {
            return { ok: false, error: "Company is not in the recycle bin." };
        }
        if (!ownsDeletedCompany(data, params.uid, params.email)) {
            return { ok: false, error: "forbidden" };
        }

        const cfgSnap = await db.doc("config/recycleBin").get();
        const quickDelete = readQuickDeleteFromConfig(
            cfgSnap.exists ? (cfgSnap.data() as Record<string, unknown>) : undefined
        );

        if (quickDelete) {
            await adminServerHardDeleteDeletedCompany(cid);
        } else {
            await ref.update({
                movedToAdminRecycleAt: serverTimestamp(),
            });
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "finalize_failed" };
    }
}
