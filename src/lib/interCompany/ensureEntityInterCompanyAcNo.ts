/**
 * Party / bank / staff / tax / expense — missing interCompanyAccountNo backfill.
 */
import { doc, updateDoc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { firestore } from "@/lib/firebase";
import {
  firestoreCollectionForEntityKind,
  generateUniqueEntityInterCompanyAcNo,
  isValidInterCompanyAcNo,
  normalizeInterCompanyAcNo,
  readInterCompanyAcNoFromDoc,
  type InterCompanyAcEntityKind,
} from "@/lib/interCompany/interCompanyAccountNo";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalOnlyMode } from "@/lib/localMode";

async function mirrorEntityAcNoToLocal(
  companyId: string,
  collectionName: string,
  entityId: string,
  acNo: string
): Promise<void> {
  try {
    const local = await getCompanyDocFromBrowserDb(companyId, collectionName, entityId);
    if (!local) return;
    await upsertCompanyDocInBrowserDb(companyId, collectionName, entityId, {
      ...(local as Record<string, unknown>),
      interCompanyAccountNo: acNo,
    });
  } catch (err) {
    console.warn("[interCompany] Local entity A/c No mirror skipped", err);
  }
}

/** Master edit / open par entity A/c No ensure */
export async function ensureEntityInterCompanyAcNo(
  companyId: string,
  kind: InterCompanyEntityKind,
  entityId: string
): Promise<string> {
  if (!companyId || !entityId) return "";
  const collectionName = firestoreCollectionForEntityKind(kind);
  const exclude = { kind: kind as InterCompanyAcEntityKind, companyId, entityId };

  try {
    const local = await getCompanyDocFromBrowserDb(companyId, collectionName, entityId);
    const fromLocal = readInterCompanyAcNoFromDoc(local as { interCompanyAccountNo?: string });
    if (isValidInterCompanyAcNo(fromLocal, kind)) {
      return normalizeInterCompanyAcNo(fromLocal);
    }
  } catch {
    /* optional */
  }

  if (!isLocalOnlyMode()) {
    try {
      const snap = await getDoc(
        doc(firestore, `companies/${companyId}/${collectionName}/${entityId}`)
      );
      if (snap.exists()) {
        const fromFs = readInterCompanyAcNoFromDoc(
          snap.data() as { interCompanyAccountNo?: string }
        );
        if (isValidInterCompanyAcNo(fromFs, kind)) {
          const normalized = normalizeInterCompanyAcNo(fromFs);
          await mirrorEntityAcNoToLocal(companyId, collectionName, entityId, normalized);
          return normalized;
        }
      }
    } catch (err) {
      console.warn("[interCompany] Firestore entity A/c No read skipped", err);
    }
  }

  const next = await generateUniqueEntityInterCompanyAcNo(kind, exclude);
  const payload = { interCompanyAccountNo: next };

  try {
    if (!isLocalOnlyMode()) {
      await updateDoc(doc(firestore, `companies/${companyId}/${collectionName}/${entityId}`), payload);
    }
  } catch (err) {
    console.warn("[interCompany] Firestore entity A/c No backfill skipped", err);
  }

  await mirrorEntityAcNoToLocal(companyId, collectionName, entityId, next);
  return next;
}
