import { isInterCompanyCounterpartyPartyName } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getCompanyDocFromBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import {
  companyUsesSqliteRecycleBinSource,
  permanentDeleteCompanySubdocFromRecycleBin,
} from "@/lib/recycleBinEntityLifecycle";

export function isInterCompanyAutoPartyRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.isInterCompanyCounterparty === true) return true;
  const id = String(row.id || "").trim();
  if (id.startsWith("ic_peer_")) return true;
  return isInterCompanyCounterpartyPartyName(row.name);
}

async function readPartyRow(
  companyId: string,
  partyId: string
): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  const pid = String(partyId || "").trim();
  if (!cid || !pid) return null;
  const local = await getCompanyDocFromBrowserDb(cid, "parties", pid);
  if (local) return local;
  try {
    const snap = await getDoc(doc(firestore, `companies/${cid}/parties`, pid));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Record<string, unknown>) } as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Active (non-deleted) inter_company vouchers jo is IC counterparty party ko reference karte hain. */
export async function countActiveInterCompanyVouchersForCounterpartyParty(
  companyId: string,
  partyId: string
): Promise<number> {
  const cid = String(companyId || "").trim();
  const pid = String(partyId || "").trim();
  if (!cid || !pid) return 0;

  let rows: Record<string, unknown>[] = [];
  try {
    if (await companyUsesSqliteRecycleBinSource(cid)) {
      rows = await listCompanyDocsFromBrowserDb(cid, "vouchers", { includeSoftDeleted: true });
    } else {
      const snap = await getDocs(
        query(collection(firestore, `companies/${cid}/vouchers`), where("interCompanyCounterpartyPartyId", "==", pid))
      );
      rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    }
  } catch {
    return 1;
  }

  return rows.filter(
    (v) =>
      String(v.type || "") === "inter_company" &&
      v.isDeleted !== true &&
      String(v.interCompanyCounterpartyPartyId || "").trim() === pid
  ).length;
}

/** IC auto party permanently delete — jab koi active IC voucher na ho. */
export async function purgeInterCompanyCounterpartyPartyIfUnused(args: {
  companyId: string;
  partyId: string;
}): Promise<boolean> {
  const companyId = String(args.companyId || "").trim();
  const partyId = String(args.partyId || "").trim();
  if (!companyId || !partyId) return false;

  const party = await readPartyRow(companyId, partyId);
  if (!party || !isInterCompanyAutoPartyRow(party)) return false;

  const active = await countActiveInterCompanyVouchersForCounterpartyParty(companyId, partyId);
  if (active > 0) return false;

  await permanentDeleteCompanySubdocFromRecycleBin(companyId, "parties", partyId);
  return true;
}

/** @deprecated Use purgeInterCompanyCounterpartyPartyIfUnused — soft-delete Firestore ghost banata tha. */
export async function softDeleteInterCompanyCounterpartyPartyIfUnused(args: {
  companyId: string;
  partyId: string;
  deletedByUid: string;
}): Promise<boolean> {
  void args.deletedByUid;
  return purgeInterCompanyCounterpartyPartyIfUnused({
    companyId: args.companyId,
    partyId: args.partyId,
  });
}

/** Company ke saare unused IC auto parties permanently hatao. */
export async function reconcileUnusedInterCompanyCounterpartyParties(args: {
  companyId: string;
  deletedByUid: string;
}): Promise<number> {
  void args.deletedByUid;
  const companyId = String(args.companyId || "").trim();
  if (!companyId) return 0;

  let parties: Record<string, unknown>[] = [];
  try {
    if (await companyUsesSqliteRecycleBinSource(companyId)) {
      parties = await listCompanyDocsFromBrowserDb(companyId, "parties", { includeSoftDeleted: true });
    } else {
      const snap = await getDocs(collection(firestore, `companies/${companyId}/parties`));
      parties = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    }
  } catch {
    return 0;
  }

  let removed = 0;
  for (const row of parties) {
    if (!isInterCompanyAutoPartyRow(row)) continue;
    const partyId = String(row.id || "").trim();
    if (!partyId) continue;
    try {
      const ok = await purgeInterCompanyCounterpartyPartyIfUnused({ companyId, partyId });
      if (ok) removed += 1;
    } catch (err) {
      console.warn("[IC] purge unused counterparty party:", err);
    }
  }
  return removed;
}
