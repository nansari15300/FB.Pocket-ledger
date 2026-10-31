/**
 * Purani companies par missing interCompanyAccountNo backfill (Firestore + local mirror).
 */
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  generateUniqueInterCompanyAccountNo,
  isValidInterCompanyAcNo,
  normalizeInterCompanyAcNo,
} from "@/lib/interCompany/interCompanyAccountNo";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

/** Local SQLite row par A/c No mirror — online company bina local row ke bhi chal sakti hai. */
async function mirrorInterCompanyAcNoToLocal(companyId: string, acNo: string): Promise<void> {
  try {
    const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!localRow) return;
    await upsertLocalCompany({
      ...(localRow as Parameters<typeof upsertLocalCompany>[0]),
      id: companyId,
      interCompanyAccountNo: acNo,
    });
  } catch (err) {
    console.warn("[interCompany] Local A/c No mirror skipped", err);
  }
}

/**
 * Agar valid A/c No nahi hai to unique generate + persist.
 * Company select / open par bhi call ho sakta hai — party edit zaroori nahi.
 */
export async function ensureCompanyInterCompanyAcNo(companyId: string): Promise<string> {
  if (!isInterCompanySystemEnabled() || !companyId) return "";

  try {
    const local = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fromLocal = (local as { interCompanyAccountNo?: string } | null)?.interCompanyAccountNo;
    if (isValidInterCompanyAcNo(fromLocal)) {
      return normalizeInterCompanyAcNo(fromLocal);
    }
  } catch {
    /* local read optional */
  }

  if (!isLocalOnlyMode()) {
    try {
      const snap = await getDoc(doc(firestore, "companies", companyId));
      if (snap.exists()) {
        const fromFs = (snap.data() as { interCompanyAccountNo?: string }).interCompanyAccountNo;
        if (isValidInterCompanyAcNo(fromFs)) {
          const normalized = normalizeInterCompanyAcNo(fromFs);
          await mirrorInterCompanyAcNoToLocal(companyId, normalized);
          return normalized;
        }
      }
    } catch (err) {
      console.warn("[interCompany] Firestore A/c No read skipped", err);
    }
  }

  const next = await generateUniqueInterCompanyAccountNo(companyId);
  const payload = { interCompanyAccountNo: next };

  try {
    if (!isLocalOnlyMode()) {
      await updateDoc(doc(firestore, "companies", companyId), payload);
    }
  } catch (err) {
    console.warn("[interCompany] Firestore A/c No backfill skipped", err);
  }

  await mirrorInterCompanyAcNoToLocal(companyId, next);
  return next;
}
