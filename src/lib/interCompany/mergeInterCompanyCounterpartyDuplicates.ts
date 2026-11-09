/**
 * Same peer / same `IC Company "…"` naam ke duplicate clearing parties
 * → ek winner; vouchers remap; losers purge.
 */

import { collection } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  interCompanyClearingPartyDedupeKeys,
  isInterCompanyCompanyClearingParty,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { purgeInterCompanyCounterpartyPartyIfUnused } from "@/lib/interCompany/cleanupInterCompanyCounterpartyParty";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { companyUsesSqliteRecycleBinSource } from "@/lib/recycleBinEntityLifecycle";
import { patchVoucherFields } from "@/lib/writeGateway/voucherActionsClient";

type PartyRow = Record<string, unknown> & { id: string };

function remapLegsAccountId(legs: unknown, fromId: string, toId: string): unknown {
  if (!Array.isArray(legs) || fromId === toId) return legs;
  return legs.map((leg) => {
    if (!leg || typeof leg !== "object") return leg;
    const row = leg as Record<string, unknown>;
    if (String(row.accountId || "").trim() !== fromId) return leg;
    return { ...row, accountId: toId };
  });
}

function pickWinner(rows: PartyRow[]): PartyRow {
  const sorted = [...rows].sort((a, b) => {
    const rank = (id: string) => {
      if (String(id).startsWith("ic_acct_")) return 2;
      if (String(id).startsWith("ic_peer_")) return 1;
      return 0;
    };
    const aCanon = rank(String(a.id));
    const bCanon = rank(String(b.id));
    if (aCanon !== bCanon) return bCanon - aCanon;
    const aAbs = Math.abs(Number(a.balance) || 0);
    const bAbs = Math.abs(Number(b.balance) || 0);
    if (aAbs !== bAbs) return bAbs - aAbs;
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted[0]!;
}

/** Union party ids — same peer+account (C→C / A→A duplicates). */
export function groupDuplicateInterCompanyClearingPartyIds(
  parties: Array<{
    id: string;
    name?: string;
    interCompanyPeerCompanyId?: string;
    interCompanyPeerEntityKind?: string;
    interCompanyPeerEntityId?: string;
    interCompanyClearingMode?: string;
    isInterCompanyCounterparty?: boolean;
    isInterCompanyMirroredEntity?: boolean;
  }>
): string[][] {
  const clearing = parties.filter((p) => isInterCompanyCompanyClearingParty(p));
  if (clearing.length <= 1) return [];

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) || id;
    if (p !== id) {
      const root = find(p);
      parent.set(id, root);
      return root;
    }
    return id;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of clearing) parent.set(p.id, p.id);

  const byKey = new Map<string, string>();
  for (const p of clearing) {
    const keys = interCompanyClearingPartyDedupeKeys(p);
    for (const key of keys) {
      const prev = byKey.get(key);
      if (prev) union(prev, p.id);
      byKey.set(key, p.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const p of clearing) {
    const root = find(p.id);
    const list = groups.get(root) || [];
    list.push(p.id);
    groups.set(root, list);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
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

async function listVouchers(companyId: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  try {
    if (await companyUsesSqliteRecycleBinSource(companyId)) {
      const rows = await listCompanyDocsFromBrowserDb(companyId, "vouchers", {
        includeSoftDeleted: true,
      });
      return rows
        .map((r) => ({ ...r, id: String(r.id || "").trim() }))
        .filter((r) => r.id) as Array<Record<string, unknown> & { id: string }>;
    }
  } catch {
    /* fall through */
  }
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/vouchers`));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  } catch {
    return [];
  }
}

async function remapVouchersPartyId(
  companyId: string,
  fromId: string,
  toId: string,
  vouchers: Array<Record<string, unknown> & { id: string }>
): Promise<number> {
  if (!fromId || !toId || fromId === toId) return 0;
  let n = 0;
  for (const v of vouchers) {
    if (String(v.type || "") !== "inter_company") continue;
    if (v.isDeleted === true) continue;

    const patch: Record<string, unknown> = {};
    if (String(v.interCompanyCounterpartyPartyId || "").trim() === fromId) {
      patch.interCompanyCounterpartyPartyId = toId;
    }
    if (String(v.partyId || "").trim() === fromId) {
      patch.partyId = toId;
    }
    const remappedLegs = remapLegsAccountId(v.interCompanyLegs, fromId, toId);
    if (remappedLegs !== v.interCompanyLegs) {
      patch.interCompanyLegs = remappedLegs;
    }
    if (Object.keys(patch).length === 0) continue;
    try {
      await patchVoucherFields(companyId, v.id, patch);
      n += 1;
    } catch (err) {
      console.warn("[IC] remap counterparty party on voucher failed:", v.id, err);
    }
  }
  return n;
}

/**
 * Company me duplicate IC Company clearing parties merge.
 * @returns merged loser count
 */
export async function mergeDuplicateInterCompanyCounterpartyParties(
  companyId: string
): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) return 0;

  const parties = await listParties(cid);
  const idGroups = groupDuplicateInterCompanyClearingPartyIds(parties);
  if (idGroups.length === 0) return 0;

  const byId = new Map(parties.map((p) => [p.id, p]));
  const vouchers = await listVouchers(cid);
  let losersRemoved = 0;

  for (const ids of idGroups) {
    const rows = ids.map((id) => byId.get(id)).filter(Boolean) as PartyRow[];
    if (rows.length < 2) continue;
    const winner = pickWinner(rows);
    const losers = rows.filter((r) => r.id !== winner.id);

    for (const loser of losers) {
      await remapVouchersPartyId(cid, loser.id, winner.id, vouchers);
      // Local snapshot update so next remaps see new ids if same voucher listed twice
      for (const v of vouchers) {
        if (String(v.interCompanyCounterpartyPartyId || "").trim() === loser.id) {
          v.interCompanyCounterpartyPartyId = winner.id;
        }
        if (String(v.partyId || "").trim() === loser.id) v.partyId = winner.id;
        v.interCompanyLegs = remapLegsAccountId(v.interCompanyLegs, loser.id, winner.id);
      }
      try {
        const ok = await purgeInterCompanyCounterpartyPartyIfUnused({
          companyId: cid,
          partyId: loser.id,
        });
        if (ok) losersRemoved += 1;
      } catch (err) {
        console.warn("[IC] purge duplicate counterparty failed:", loser.id, err);
      }
    }
  }

  return losersRemoved;
}
