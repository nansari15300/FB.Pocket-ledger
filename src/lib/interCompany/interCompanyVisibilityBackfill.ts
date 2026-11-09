/**
 * Purane target IC copies — source pehle approve ho chuka ho to `interCompanySourceApproved` backfill.
 */
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  interCompanyVoucherViewerSide,
  readInterCompanyLink,
} from "@/lib/interCompany/interCompanyVoucherHydrate";
import { patchVoucherFields } from "@/lib/voucherActionsClient";

/** Ek company load par max kitne target docs check karein */
const BACKFILL_LIMIT = 30;

export async function backfillInterCompanySourceApprovedFlags(
  companyId: string,
  vouchers: Array<Record<string, unknown> & { id?: string }>
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;

  const targets = vouchers.filter((v) => {
    if (String(v.type || "") !== "inter_company") return false;
    if (interCompanyVoucherViewerSide(v) !== "target") return false;
    if (v.interCompanySourceApproved === true) return false;
    return !!String(v.id || "").trim();
  });

  for (const row of targets.slice(0, BACKFILL_LIMIT)) {
    const vid = String(row.id || "").trim();
    const link = readInterCompanyLink(row);
    if (!link?.peerCompanyId || !link?.peerVoucherId) continue;
    try {
      const snap = await getDoc(
        doc(firestore, `companies/${link.peerCompanyId}/vouchers`, link.peerVoucherId)
      );
      if (!snap.exists()) continue;
      const peer = snap.data() as Record<string, unknown>;
      if (peer?.isApproved !== true) continue;
      await patchVoucherFields(cid, vid, { interCompanySourceApproved: true });
    } catch {
      /* offline */
    }
  }
}
