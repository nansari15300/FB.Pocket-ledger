/**
 * Legacy C→C clearing parties `IC Company "{peer company}"` → `IC Account "{peer account}"`
 * + peer entity meta (party list me company naam niche).
 */

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { collection, doc } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  formatInterCompanyAccountClearingPartyName,
  isInterCompanyAccountClearingPartyName,
  isInterCompanyCompanyClearingPartyName,
  readInterCompanyClearingMode,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { normalizeInterCompanyTargetPostMode } from "@/lib/interCompany/interCompanyPostingLegs";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { companyUsesSqliteRecycleBinSource } from "@/lib/recycleBinEntityLifecycle";
import { writeEntity } from "@/lib/writeGateway";
import { interCompanyUsesLocalLedgerTransport } from "@/lib/interCompany/localInterCompanyPolicy";

type PartyRow = Record<string, unknown> & { id: string };
type VoucherRow = Record<string, unknown> & { id: string };

function voucherDateMs(v: VoucherRow): number {
  const raw = v.date ?? v.voucherDate ?? v.createdAt;
  if (!raw) return 0;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 0 : raw.getTime();
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    const d = (raw as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function readPeerEntityFromJournalVoucher(v: VoucherRow): {
  kind: string;
  id: string;
  label: string;
} | null {
  if (String(v.type || "").trim() !== "inter_company") return null;
  if (v.isDeleted === true) return null;
  if (normalizeInterCompanyTargetPostMode(v.interCompanyTargetPostMode) !== "journal") return null;

  const link = v.interCompanyLink as { role?: string } | null | undefined;
  const role = String(link?.role || "").trim();
  if (role === "source") {
    const kind = String(v.targetEntityKind || "").trim().toLowerCase();
    const id = String(v.targetEntityId || "").trim();
    const label = String(v.targetEntityLabel || "").trim();
    if (!id && !label) return null;
    return { kind: kind || "party", id, label: label || id };
  }
  if (role === "target") {
    const kind = String(v.sourceEntityKind || "").trim().toLowerCase();
    const id = String(v.sourceEntityId || "").trim();
    const label = String(v.sourceEntityLabel || "").trim();
    if (!id && !label) return null;
    return { kind: kind || "party", id, label: label || id };
  }
  return null;
}

function partyNeedsLegacyCompanyNameRepair(party: PartyRow): boolean {
  if (party.isDeleted === true) return false;
  if (readInterCompanyClearingMode(party) !== "company") return false;
  if (isInterCompanyCompanyClearingPartyName(party.name)) return true;
  if (
    isInterCompanyAccountClearingPartyName(party.name) &&
    !String(party.interCompanyPeerEntityLabel || "").trim()
  ) {
    return true;
  }
  return false;
}

async function listParties(companyId: string): Promise<PartyRow[]> {
  try {
    if (await companyUsesSqliteRecycleBinSource(companyId)) {
      const rows = await listCompanyDocsFromBrowserDb(companyId, "parties", {
        includeSoftDeleted: true,
      });
      return rows
        .map((r) => ({ ...r, id: String(r.id || "").trim() }))
        .filter((r) => r.id && r.isDeleted !== true) as PartyRow[];
    }
  } catch {
    /* fall through */
  }
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/parties`));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as PartyRow)
      .filter((r) => r.isDeleted !== true);
  } catch {
    return [];
  }
}

async function listVouchers(companyId: string): Promise<VoucherRow[]> {
  try {
    if (await companyUsesSqliteRecycleBinSource(companyId)) {
      const rows = await listCompanyDocsFromBrowserDb(companyId, "vouchers", {
        includeSoftDeleted: true,
      });
      return rows
        .map((r) => ({ ...r, id: String(r.id || "").trim() }))
        .filter((r) => r.id) as VoucherRow[];
    }
  } catch {
    /* fall through */
  }
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/vouchers`));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as VoucherRow);
  } catch {
    return [];
  }
}

async function patchParty(companyId: string, partyId: string, patch: Record<string, unknown>): Promise<void> {
  if (await interCompanyUsesLocalLedgerTransport(companyId)) {
    const res = await writeEntity({
      companyId,
      collectionName: "parties",
      docId: partyId,
      operation: "update",
      data: patch,
    });
    if (res.ok === false) throw new Error(res.error || "Failed to repair IC party");
    return;
  }
  await updateDoc(doc(firestore, `companies/${companyId}/parties`, partyId), patch);
}

/**
 * @returns repaired party count
 */
export async function repairLegacyInterCompanyCompanyClearingPartyNames(
  companyId: string
): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) return 0;

  const [parties, vouchers] = await Promise.all([listParties(cid), listVouchers(cid)]);
  const candidates = parties.filter(partyNeedsLegacyCompanyNameRepair);
  if (candidates.length === 0) return 0;

  const vouchersByPartyId = new Map<string, VoucherRow[]>();
  for (const v of vouchers) {
    const partyId = String(v.interCompanyCounterpartyPartyId || "").trim();
    if (!partyId) continue;
    const list = vouchersByPartyId.get(partyId) || [];
    list.push(v);
    vouchersByPartyId.set(partyId, list);
  }

  let repaired = 0;
  for (const party of candidates) {
    const linked = (vouchersByPartyId.get(party.id) || [])
      .map((v) => ({ v, entity: readPeerEntityFromJournalVoucher(v) }))
      .filter((row): row is { v: VoucherRow; entity: { kind: string; id: string; label: string } } =>
        Boolean(row.entity)
      )
      .sort((a, b) => voucherDateMs(b.v) - voucherDateMs(a.v));

    const best = linked[0]?.entity;
    if (!best) continue;

    const nextName = formatInterCompanyAccountClearingPartyName(best.label);
    const patch: Record<string, unknown> = {
      name: nextName,
      interCompanyClearingMode: "company",
      interCompanyPeerEntityKind: best.kind,
      interCompanyPeerEntityId: best.id,
      interCompanyPeerEntityLabel: best.label,
    };
    const peerCompanyName = String(party.interCompanyPeerCompanyName || "").trim();
    if (peerCompanyName) patch.interCompanyPeerCompanyName = peerCompanyName;

    if (
      String(party.name || "").trim() === nextName &&
      String(party.interCompanyPeerEntityLabel || "").trim() === best.label
    ) {
      continue;
    }

    try {
      await patchParty(cid, party.id, patch);
      repaired += 1;
    } catch (err) {
      console.warn("[IC] repair legacy company clearing party failed:", party.id, err);
    }
  }

  return repaired;
}
