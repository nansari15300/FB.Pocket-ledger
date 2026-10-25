/**
 * IC clearing party — C→C aur A→A dono ke liye ek hi row (peer + entity):
 * `IC Account "{peer account}"` + peer company niche — `ic_acct_*`
 * (entity missing ho to legacy `ic_peer_*` fallback)
 */

import { collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import {
  formatInterCompanyAccountClearingPartyName,
  isInterCompanyCounterpartyPartyName,
  type InterCompanyClearingMode,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { restoreCompanySubdocFromRecycleBin } from "@/lib/recycleBinEntityLifecycle";
import {
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { writeEntity } from "@/lib/writeGateway";
import { interCompanyUsesLocalLedgerTransport } from "@/lib/interCompany/localInterCompanyPolicy";

export function interCompanyCounterpartyDocId(peerCompanyId: string): string {
  const safe = String(peerCompanyId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `ic_peer_${safe}`;
}

export function interCompanyAccountClearingDocId(args: {
  peerCompanyId: string;
  peerEntityKind: string;
  peerEntityId: string;
}): string {
  const peer = String(args.peerCompanyId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 28);
  const kind = String(args.peerEntityKind || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 12);
  const ent = String(args.peerEntityId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  return `ic_acct_${peer}_${kind}_${ent}`.slice(0, 96);
}

/** C→C / A→A — peer+entity par ek canonical id; entity na ho to peer-level legacy. */
export function resolveInterCompanyClearingDocId(args: {
  peerCompanyId: string;
  peerEntityKind?: string;
  peerEntityId?: string;
}): string {
  const peerEntityKind = String(args.peerEntityKind || "").trim().toLowerCase();
  const peerEntityId = String(args.peerEntityId || "").trim();
  if (peerEntityKind && peerEntityId) {
    return interCompanyAccountClearingDocId({
      peerCompanyId: args.peerCompanyId,
      peerEntityKind,
      peerEntityId,
    });
  }
  return interCompanyCounterpartyDocId(args.peerCompanyId);
}

function isActiveCounterpartyRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || row.isDeleted === true) return false;
  const id = String(row.id || "").trim();
  if (row.isInterCompanyCounterparty === true) return true;
  if (id.startsWith("ic_peer_") || id.startsWith("ic_acct_")) return true;
  return isInterCompanyCounterpartyPartyName(row.name);
}

async function listPartyRows(companyId: string): Promise<Record<string, unknown>[]> {
  try {
    const local = await listCompanyDocsFromBrowserDb(companyId, "parties", {
      includeSoftDeleted: true,
    });
    if (local.length > 0) return local;
  } catch {
    /* fall through */
  }
  try {
    const snap = await getDocs(collection(firestore, `companies/${companyId}/parties`));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  } catch {
    return [];
  }
}

function preferClearingPartyId(rows: Array<Record<string, unknown>>): string | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const rank = (id: string) => {
      if (id.startsWith("ic_acct_")) return 2;
      if (id.startsWith("ic_peer_")) return 1;
      return 0;
    };
    const aRank = rank(String(a.id || "").trim());
    const bRank = rank(String(b.id || "").trim());
    if (aRank !== bRank) return bRank - aRank;
    const aAbs = Math.abs(Number(a.balance) || 0);
    const bAbs = Math.abs(Number(b.balance) || 0);
    if (aAbs !== bAbs) return bAbs - aAbs;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  const id = String(sorted[0]?.id || "").trim();
  return id || null;
}

/**
 * Prefer canonical id; warna pehla matching row (C→C / A→A mode alag — peer+entity same).
 */
export function pickInterCompanyCounterpartyPartyId(args: {
  peerCompanyId: string;
  displayName: string;
  parties: Array<Record<string, unknown>>;
  clearingMode?: InterCompanyClearingMode;
  peerEntityKind?: string;
  peerEntityId?: string;
}): string | null {
  const peerCompanyId = String(args.peerCompanyId || "").trim();
  const displayName = String(args.displayName || "").trim();
  const peerEntityKind = String(args.peerEntityKind || "").trim().toLowerCase();
  const peerEntityId = String(args.peerEntityId || "").trim();
  const canonicalId = resolveInterCompanyClearingDocId({
    peerCompanyId,
    peerEntityKind,
    peerEntityId,
  });

  const active = args.parties.filter((r) => isActiveCounterpartyRow(r));
  if (active.some((r) => String(r.id || "").trim() === canonicalId)) {
    return canonicalId;
  }

  const byPeer = active.filter(
    (r) => String(r.interCompanyPeerCompanyId || "").trim() === peerCompanyId
  );

  if (peerEntityKind && peerEntityId) {
    const byEntity = byPeer.filter(
      (r) =>
        String(r.interCompanyPeerEntityKind || "")
          .trim()
          .toLowerCase() === peerEntityKind &&
        String(r.interCompanyPeerEntityId || "").trim() === peerEntityId
    );
    const byEntityId = preferClearingPartyId(byEntity);
    if (byEntityId) return byEntityId;
  }

  if (displayName) {
    const byName = byPeer.filter((r) => String(r.name || "").trim() === displayName);
    const byNameId = preferClearingPartyId(byName);
    if (byNameId) return byNameId;
  }

  if (!peerEntityKind || !peerEntityId) {
    const byPeerOnly = preferClearingPartyId(byPeer);
    if (byPeerOnly) return byPeerOnly;
  }

  return null;
}

async function syncCounterpartyPartyMeta(
  companyId: string,
  docId: string,
  patch: Record<string, unknown>,
  existingData: Record<string, unknown>
): Promise<void> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (existingData[k] !== v) next[k] = v;
  }
  if (Object.keys(next).length === 0) return;

  if (await interCompanyUsesLocalLedgerTransport(companyId)) {
    const res = await writeEntity({
      companyId,
      collectionName: "parties",
      docId,
      operation: "update",
      data: next,
    });
    if (res.ok === false) {
      console.warn("[IC] counterparty meta sync failed:", res.error);
    }
    return;
  }

  try {
    await updateDoc(doc(firestore, `companies/${companyId}/parties`, docId), next);
  } catch (err) {
    console.warn("[IC] counterparty meta sync failed:", err);
  }
}

export type EnsureInterCompanyCounterpartyArgs = {
  companyId: string;
  peerCompanyId: string;
  peerCompanyName: string;
  side: "source" | "target";
  ownerId: string;
  /** Default company — Company→Company clearing. */
  clearingMode?: InterCompanyClearingMode;
  /** Account→Account — peer company ka selected entity. */
  peerEntityKind?: InterCompanyEntityKind | string;
  peerEntityId?: string;
  peerEntityLabel?: string;
};

/** Source / target clearing — mode ke hisaab se IC Company ya IC Account. */
export async function ensureInterCompanyCounterpartyParty(
  args: EnsureInterCompanyCounterpartyArgs
): Promise<string> {
  const companyId = String(args.companyId || "").trim();
  const peerCompanyId = String(args.peerCompanyId || "").trim();
  const peerCompanyName = String(args.peerCompanyName || "Company").trim() || "Company";
  let clearingMode: InterCompanyClearingMode = args.clearingMode === "account" ? "account" : "company";
  const peerEntityKind = String(args.peerEntityKind || "").trim().toLowerCase();
  const peerEntityId = String(args.peerEntityId || "").trim();
  const peerEntityLabel = String(args.peerEntityLabel || "").trim();

  // Account mode bina entity ke — company clearing pe fallback (save block na ho)
  if (clearingMode === "account" && (!peerEntityKind || !peerEntityId)) {
    clearingMode = "company";
  }

  const accountDisplayLabel = peerEntityLabel || peerEntityId || peerCompanyName;
  const displayName = formatInterCompanyAccountClearingPartyName(accountDisplayLabel);

  const canonicalId = resolveInterCompanyClearingDocId({
    peerCompanyId,
    peerEntityKind,
    peerEntityId,
  });

  const metaPatch: Record<string, unknown> = {
    name: displayName,
    isInterCompanyCounterparty: true,
    interCompanyPeerCompanyId: peerCompanyId,
    interCompanyPeerCompanyName: peerCompanyName,
  };
  if (peerEntityKind && peerEntityId) {
    metaPatch.interCompanyPeerEntityKind = peerEntityKind;
    metaPatch.interCompanyPeerEntityId = peerEntityId;
    metaPatch.interCompanyPeerEntityLabel = peerEntityLabel || peerEntityId;
  }

  const partyRef = doc(firestore, `companies/${companyId}/parties`, canonicalId);
  const localCanonical = await getCompanyDocFromBrowserDb(companyId, "parties", canonicalId);
  let firestoreCanonical: Record<string, unknown> | null = null;
  if (!localCanonical) {
    try {
      const snap = await getDoc(partyRef);
      if (snap.exists()) firestoreCanonical = snap.data() as Record<string, unknown>;
    } catch {
      /* local-only / offline */
    }
  }

  const canonicalData = (localCanonical || firestoreCanonical) as Record<string, unknown> | null;
  if (canonicalData) {
    if (canonicalData.isDeleted === true) {
      await restoreCompanySubdocFromRecycleBin(companyId, "parties", canonicalId);
    }
    await syncCounterpartyPartyMeta(companyId, canonicalId, metaPatch, canonicalData);
    return canonicalId;
  }

  const parties = await listPartyRows(companyId);
  const reusedId = pickInterCompanyCounterpartyPartyId({
    peerCompanyId,
    displayName,
    parties,
    clearingMode,
    peerEntityKind,
    peerEntityId,
  });
  if (reusedId) {
    const row =
      parties.find((r) => String(r.id || "").trim() === reusedId) ||
      (await getCompanyDocFromBrowserDb(companyId, "parties", reusedId)) ||
      {};
    if ((row as Record<string, unknown>).isDeleted === true) {
      await restoreCompanySubdocFromRecycleBin(companyId, "parties", reusedId);
    }
    await syncCounterpartyPartyMeta(
      companyId,
      reusedId,
      metaPatch,
      row as Record<string, unknown>
    );
    return reusedId;
  }

  const groupId = args.side === "source" ? "sundry_debtors" : "sundry_creditors";
  const interCompanyAccountNo = await interCompanyAcNoForNewEntity("party");
  const body = {
    name: displayName,
    companyId,
    ownerId: args.ownerId || "",
    groupId,
    openingBalance: 0,
    balance: 0,
    debit: 0,
    credit: 0,
    isDeleted: false,
    isInterCompanyCounterparty: true,
    interCompanyClearingMode: clearingMode,
    interCompanyPeerCompanyId: peerCompanyId,
    interCompanyPeerCompanyName: peerCompanyName,
    interCompanyCounterpartySide: args.side,
    interCompanyAccountNo,
    ...(peerEntityKind && peerEntityId
      ? {
          interCompanyPeerEntityKind: peerEntityKind,
          interCompanyPeerEntityId: peerEntityId,
          interCompanyPeerEntityLabel: peerEntityLabel || peerEntityId,
        }
      : {}),
  };

  if (await interCompanyUsesLocalLedgerTransport(companyId)) {
    const res = await writeEntity({
      companyId,
      collectionName: "parties",
      docId: canonicalId,
      operation: "create",
      data: body,
    });
    if (res.ok === false) throw new Error(res.error || "Failed to create IC counterparty party");
    return canonicalId;
  }

  await setDoc(partyRef, { ...body, createdAt: new Date() });
  return canonicalId;
}
