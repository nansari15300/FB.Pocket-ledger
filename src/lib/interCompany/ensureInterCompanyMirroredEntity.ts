/**
 * Inter Company — optional entity (party/staff/tax/expense) jo ek side select kare,
 * uska mirror doc peer company ke apne ledger me — naam "IC {company code} {full name}".
 * Sirf reference/availability ke liye; is side ka apna posting leg entityId nahi badalta
 * (save pair logic same rehta hai — mirror sirf peer company ke masters me visible hota hai).
 */
import { setDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";
import { restoreCompanySubdocFromRecycleBin } from "@/lib/recycleBinEntityLifecycle";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { writeEntity } from "@/lib/writeGateway";
import { interCompanyUsesLocalLedgerTransport } from "@/lib/interCompany/localInterCompanyPolicy";

/** Bank optional entity mirror nahi hota — clearing account alag concept hai. */
const MIRRORED_COLLECTION_BY_KIND: Partial<Record<InterCompanyEntityKind, string>> = {
  party: "parties",
  staff: "staff",
  tax: "taxes",
  expense: "expense_accounts",
};

function mirroredEntityDocId(originCompanyId: string, originEntityId: string): string {
  const safeCompany = String(originCompanyId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32);
  const safeEntity = String(originEntityId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `ic_mirror_${safeCompany}_${safeEntity}`;
}

/** "IC {code} {full name}" — company code jaisa WWW; person/entity naam kabhi mat todo. */
export function formatInterCompanyMirroredEntityName(companyCode: string, fullName: string): string {
  const code = String(companyCode || "").trim();
  const name = String(fullName || "").trim() || "Account";
  return code ? `IC ${code} ${name}` : `IC ${name}`;
}

export function isInterCompanyMirroredEntityKindSupported(kind: InterCompanyEntityKind): boolean {
  return kind in MIRRORED_COLLECTION_BY_KIND;
}

/**
 * Peer company me mirror entity create/update — same kind (party/staff/tax/expense).
 * Idempotent — origin company + origin entity id se deterministic docId (dubara save par duplicate nahi).
 */
export async function ensureInterCompanyMirroredEntity(args: {
  /** Jis company me mirror banega (peer) */
  peerCompanyId: string;
  /** Jis company ne originally entity select ki */
  originCompanyId: string;
  originCompanyCode: string;
  originEntityId: string;
  entityKind: InterCompanyEntityKind;
  entityFullName: string;
  ownerId: string;
}): Promise<string | null> {
  const collectionName = MIRRORED_COLLECTION_BY_KIND[args.entityKind];
  if (!collectionName) return null;

  const peerCompanyId = String(args.peerCompanyId || "").trim();
  const originCompanyId = String(args.originCompanyId || "").trim();
  const originEntityId = String(args.originEntityId || "").trim();
  const fullName = String(args.entityFullName || "").trim();
  if (!peerCompanyId || !originCompanyId || !originEntityId || !fullName) return null;
  // Peer khud hi origin — mirror ki zaroorat nahi (same company ke andar).
  if (peerCompanyId === originCompanyId) return null;

  const docId = mirroredEntityDocId(originCompanyId, originEntityId);
  const displayName = formatInterCompanyMirroredEntityName(args.originCompanyCode, fullName);
  const docRef = doc(firestore, `companies/${peerCompanyId}/${collectionName}`, docId);

  const localRow = await getCompanyDocFromBrowserDb(peerCompanyId, collectionName, docId);
  const existingSnap = localRow ? null : await getDoc(docRef).catch(() => null);
  const existingData = (localRow || (existingSnap?.exists() ? existingSnap.data() : null)) as
    | Record<string, unknown>
    | null;

  if (existingData) {
    if (existingData.isDeleted === true) {
      await restoreCompanySubdocFromRecycleBin(peerCompanyId, collectionName, docId);
    }
    if (String(existingData.name || "") !== displayName) {
      const patch = { name: displayName };
      if (await interCompanyUsesLocalLedgerTransport(peerCompanyId)) {
        const res = await writeEntity({ companyId: peerCompanyId, collectionName, docId, operation: "update", data: patch });
        if (res.ok === false) console.warn("[IC] mirror entity name sync failed:", res.error);
      } else {
        try {
          await updateDoc(docRef, patch);
        } catch (err) {
          console.warn("[IC] mirror entity name sync failed:", err);
        }
      }
    }
    return docId;
  }

  const interCompanyAccountNo = await interCompanyAcNoForNewEntity(args.entityKind);
  const body: Record<string, unknown> = {
    name: displayName,
    companyId: peerCompanyId,
    ownerId: args.ownerId || "",
    isDeleted: false,
    isInterCompanyMirroredEntity: true,
    interCompanyMirrorOriginCompanyId: originCompanyId,
    interCompanyMirrorOriginEntityId: originEntityId,
    interCompanyMirrorOriginEntityKind: args.entityKind,
    interCompanyAccountNo,
  };
  if (args.entityKind === "party") {
    Object.assign(body, { groupId: "sundry_debtors", openingBalance: 0, balance: 0, debit: 0, credit: 0 });
  } else {
    Object.assign(body, { openingBalance: 0, balance: 0 });
  }

  if (await interCompanyUsesLocalLedgerTransport(peerCompanyId)) {
    const res = await writeEntity({ companyId: peerCompanyId, collectionName, docId, operation: "create", data: body });
    if (res.ok === false) {
      console.warn("[IC] mirror entity create failed:", res.error);
      return null;
    }
    return docId;
  }

  try {
    await setDoc(docRef, { ...body, createdAt: new Date() });
  } catch (err) {
    console.warn("[IC] mirror entity create failed:", err);
    return null;
  }
  return docId;
}
