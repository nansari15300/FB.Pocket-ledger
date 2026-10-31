"use client";

import { addDoc, deleteDoc, setDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { collection, deleteField, doc, query, serverTimestamp, where, type Unsubscribe } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getPlServerSharedCompanies } from "@/lib/plServerAccessContext";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { preferLocalLedgerReads } from "@/lib/apkOnlineFirestoreWritePolicy";
import { buildReconciliationLedgerSnapshot } from "@/lib/reconciliation/ledgerSnapshot";
import type {
  ReconciliationEntityType,
  ReconciliationShare,
  ReconciliationShareScope,
  ReconciliationAccountOption,
} from "@/lib/reconciliation/types";
import { reconciliationEntityCollection, RECON_ENTITY_OPTIONS_UI } from "@/lib/reconciliation/types";
import {
  sendReconciliationShareAlert,
  sendReconciliationAcceptedAlert,
  sendReconciliationRequestAgainAlert,
  sendReconciliationUnlinkedAlert,
} from "@/lib/reconciliation/notifications";
import { reconciliationViewerSide } from "@/lib/reconciliation/sideMeta";
import {
  DRIVE_RECON_CHANGED_EVENT,
  getDriveLocalReconciliationShare,
  isDriveLocalReconciliationShareId,
  listDriveLocalReconciliationSharesForViewer,
  loadReconciliationPartyAccountsFromLocalMirror,
  pullDriveLocalReconciliationLinksForCompany,
  refreshDriveLocalReconciliationSideSnapshot,
  saveDriveLocalReconciliationRowComment,
  unlinkDriveLocalReconciliationShare,
} from "@/lib/reconciliation/driveLocalReconciliation";

const SHARES = () => collection(firestore, "reconciliation_shares");

/** Company staff ke liye mirror — top-level list + isCompanyUser(get) query aksar permission-denied deti hai. */
const COMPANY_SHARES = (companyId: string) =>
  collection(firestore, `companies/${companyId}/reconciliation_shares`);

const companyShareIndexRef = (companyId: string, shareId: string) =>
  doc(firestore, `companies/${companyId}/reconciliation_shares`, shareId);

/** Top-level share doc ko sender/receiver company subcollections me sync — shared role staff yahi padhte hain. */
export async function syncReconciliationShareToCompanyIndexes(
  share: ReconciliationShare,
  opts?: { removeFromCompanyIds?: string[] }
): Promise<void> {
  const shareId = String(share.id || "").trim();
  if (!shareId) return;
  const { id: _id, ...rest } = share;
  const payload = { ...rest };
  const writes: Promise<unknown>[] = [];
  for (const removeCid of opts?.removeFromCompanyIds || []) {
    const rc = String(removeCid || "").trim();
    if (rc) {
      writes.push(deleteDoc(companyShareIndexRef(rc, shareId)).catch(() => {}));
    }
  }
  const senderCid = String(share.senderCompanyId || "").trim();
  const receiverCid = String(share.receiverCompanyId || "").trim();
  if (senderCid) {
    writes.push(setDoc(companyShareIndexRef(senderCid, shareId), payload, { merge: true }));
  }
  if (receiverCid && receiverCid !== senderCid) {
    writes.push(setDoc(companyShareIndexRef(receiverCid, shareId), payload, { merge: true }));
  }
  await Promise.all(writes);
}

/**
 * Purane shares jinka company index nahi bana — participant/owner dialog kholte waqt index likho.
 * Staff sirf subcollection se padh sakta hai; pehli baar owner/sender ko dialog khulwana zaroori ho sakta hai.
 */
export async function backfillReconciliationShareCompanyIndex(
  companyId: string,
  userId: string,
  opts?: { tryCompanyScopedQuery?: boolean }
): Promise<number> {
  const cid = String(companyId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) return 0;
  const map = new Map<string, ReconciliationShare>();
  const ingest = (docs: { id: string; data: () => Record<string, unknown> }[]) => {
    for (const d of docs) {
      const s = { id: d.id, ...d.data() } as ReconciliationShare;
      if (s.senderCompanyId === cid || s.receiverCompanyId === cid) map.set(d.id, s);
    }
  };
  const participantQueries = [
    query(SHARES(), where("senderUserId", "==", uid)),
    query(SHARES(), where("targetUserId", "==", uid)),
    query(SHARES(), where("receiverUserId", "==", uid)),
  ];
  for (const q of participantQueries) {
    try {
      const snap = await getDocs(q);
      ingest(snap.docs);
    } catch (err) {
      console.warn("[reconciliation_shares] backfill participant query:", err);
    }
  }
  if (opts?.tryCompanyScopedQuery) {
    for (const field of ["senderCompanyId", "receiverCompanyId"] as const) {
      try {
        const snap = await getDocs(query(SHARES(), where(field, "==", cid)));
        ingest(snap.docs);
      } catch (err) {
        console.warn(`[reconciliation_shares] backfill ${field} query:`, err);
      }
    }
  }
  await Promise.all([...map.values()].map((s) => syncReconciliationShareToCompanyIndexes(s).catch(() => {})));
  return map.size;
}

/** Company ke saare ledger accounts — share/link dropdown. */
export async function loadReconciliationAccountsForCompany(companyId: string): Promise<ReconciliationAccountOption[]> {
  if (!companyId) return [];
  // Abhi sirf Party accounts load — bank/staff/tax/expense baad me enable karenge
  const localParties = await loadReconciliationPartyAccountsFromLocalMirror(companyId);
  if (localParties.length > 0) {
    return localParties.map((p) => ({
      id: p.id,
      name: p.name,
      entityType: "party" as ReconciliationEntityType,
      collection: "parties",
    }));
  }
  const all = await Promise.all(
    RECON_ENTITY_OPTIONS_UI.map(async ({ value, collection: col }) => {
      const snap = await getDocs(collection(firestore, `companies/${companyId}/${col}`));
      return snap.docs
        .map((d) => {
          const data = d.data() as { name?: string; accountName?: string; isDeleted?: boolean };
          if (data.isDeleted === true) return null;
          const displayName = (data.name || data.accountName || d.id).trim() || d.id;
          return { id: d.id, name: displayName, entityType: value, collection: col };
        })
        .filter(Boolean) as ReconciliationAccountOption[];
    })
  );
  return all.flat().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function resolveUserByIdOrEmail(input: string): Promise<{ uid: string; email?: string } | null> {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const byId = await getDoc(doc(firestore, "users", raw));
  if (byId.exists()) {
    const d = byId.data() as { uid?: string; email?: string };
    return { uid: d.uid || byId.id, email: d.email };
  }
  const q = query(collection(firestore, "users"), where("uid", "==", raw));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const d = snap.docs[0].data() as { uid?: string; email?: string };
    return { uid: d.uid || snap.docs[0].id, email: d.email };
  }
  const qEmail = query(collection(firestore, "users"), where("email", "==", raw));
  const snapEmail = await getDocs(qEmail);
  if (!snapEmail.empty) {
    const d = snapEmail.docs[0].data() as { uid?: string; email?: string };
    return { uid: d.uid || snapEmail.docs[0].id, email: d.email };
  }
  return null;
}

export async function createReconciliationShare(params: {
  senderUserId: string;
  senderUserEmail?: string;
  senderCompanyId: string;
  senderCompanyName: string;
  senderEntityType: ReconciliationEntityType;
  senderAccountId: string;
  senderAccountName: string;
  shareScope: ReconciliationShareScope;
  dateFrom?: string | null;
  dateTo?: string | null;
  targetUserId: string;
  targetUserEmail?: string;
}): Promise<string> {
  const senderCollection = reconciliationEntityCollection(params.senderEntityType);
  const snapshot = await buildReconciliationLedgerSnapshot({
    companyId: params.senderCompanyId,
    accountId: params.senderAccountId,
    collection: senderCollection,
    shareScope: params.shareScope,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  const ref = await addDoc(SHARES(), {
    ...params,
    senderCollection,
    status: "pending",
    senderLedgerSnapshot: snapshot.rows,
    senderOpeningBalance: snapshot.openingBalance,
    senderSnapshotAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Company subcollection mirror — shared staff list yahi se load karte hain
  await syncReconciliationShareToCompanyIndexes({
    id: ref.id,
    ...params,
    senderCollection,
    status: "pending",
    senderLedgerSnapshot: snapshot.rows,
    senderOpeningBalance: snapshot.openingBalance,
  } as ReconciliationShare).catch((err) => console.warn("[reconciliation_shares] index sync on create:", err));
  await sendReconciliationShareAlert({
    shareId: ref.id,
    recipientUserId: params.targetUserId,
    senderUserId: params.senderUserId,
    senderCompanyId: params.senderCompanyId,
    senderCompanyName: params.senderCompanyName,
    senderAccountName: params.senderAccountName,
    senderUserEmail: params.senderUserEmail,
  });
  return ref.id;
}

export async function linkReconciliationShare(params: {
  shareId: string;
  receiverUserId: string;
  receiverUserEmail?: string;
  receiverCompanyId: string;
  receiverCompanyName: string;
  receiverEntityType: ReconciliationEntityType;
  receiverAccountId: string;
  receiverAccountName: string;
}): Promise<void> {
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = shareSnap.data() as ReconciliationShare;
  const receiverCollection = reconciliationEntityCollection(params.receiverEntityType);
  const snapshot = await buildReconciliationLedgerSnapshot({
    companyId: params.receiverCompanyId,
    accountId: params.receiverAccountId,
    collection: receiverCollection,
    shareScope: share.shareScope,
    dateFrom: share.dateFrom,
    dateTo: share.dateTo,
  });
  await updateDoc(shareRef, {
    status: "linked",
    receiverUserId: params.receiverUserId,
    receiverCompanyId: params.receiverCompanyId,
    receiverCompanyName: params.receiverCompanyName,
    receiverEntityType: params.receiverEntityType,
    receiverAccountId: params.receiverAccountId,
    receiverAccountName: params.receiverAccountName,
    receiverCollection,
    receiverLedgerSnapshot: snapshot.rows,
    receiverOpeningBalance: snapshot.openingBalance,
    receiverSnapshotAt: serverTimestamp(),
    linkedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Linked share — receiver company index bhi update
  await syncReconciliationShareToCompanyIndexes({
    ...share,
    id: params.shareId,
    status: "linked",
    receiverUserId: params.receiverUserId,
    receiverCompanyId: params.receiverCompanyId,
    receiverCompanyName: params.receiverCompanyName,
    receiverEntityType: params.receiverEntityType,
    receiverAccountId: params.receiverAccountId,
    receiverAccountName: params.receiverAccountName,
    receiverCollection,
    receiverLedgerSnapshot: snapshot.rows,
    receiverOpeningBalance: snapshot.openingBalance,
  } as ReconciliationShare).catch((err) => console.warn("[reconciliation_shares] index sync on link:", err));
  await sendReconciliationAcceptedAlert({
    shareId: params.shareId,
    senderUserId: share.senderUserId,
    receiverUserId: params.receiverUserId,
    receiverUserEmail: params.receiverUserEmail,
    receiverCompanyId: params.receiverCompanyId,
    receiverCompanyName: params.receiverCompanyName,
    receiverAccountName: params.receiverAccountName,
  });
}

/** Linked share par galat company/account — receiver apni side dubara link kare */
export async function changeLinkedReconciliationShare(params: {
  shareId: string;
  receiverUserId: string;
  receiverCompanyId: string;
  receiverCompanyName: string;
  receiverEntityType: ReconciliationEntityType;
  receiverAccountId: string;
  receiverAccountName: string;
}): Promise<void> {
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = shareSnap.data() as ReconciliationShare;
  if (share.status !== "linked") throw new Error("Share is not linked yet");
  const isReceiver =
    share.receiverUserId === params.receiverUserId || share.targetUserId === params.receiverUserId;
  if (!isReceiver) throw new Error("Only the linked user can change company");

  const receiverCollection = reconciliationEntityCollection(params.receiverEntityType);
  const sameAsBefore =
    share.receiverCompanyId === params.receiverCompanyId &&
    share.receiverAccountId === params.receiverAccountId &&
    share.receiverEntityType === params.receiverEntityType;
  if (sameAsBefore) throw new Error("Select a different company or account");

  const snapshot = await buildReconciliationLedgerSnapshot({
    companyId: params.receiverCompanyId,
    accountId: params.receiverAccountId,
    collection: receiverCollection,
    shareScope: share.shareScope,
    dateFrom: share.dateFrom,
    dateTo: share.dateTo,
  });

  await updateDoc(shareRef, {
    receiverUserId: params.receiverUserId,
    receiverCompanyId: params.receiverCompanyId,
    receiverCompanyName: params.receiverCompanyName,
    receiverEntityType: params.receiverEntityType,
    receiverAccountId: params.receiverAccountId,
    receiverAccountName: params.receiverAccountName,
    receiverCollection,
    receiverLedgerSnapshot: snapshot.rows,
    receiverOpeningBalance: snapshot.openingBalance,
    receiverSnapshotAt: serverTimestamp(),
    rowComments: deleteField(), // naya ledger — purane row id comments invalid
    updatedAt: serverTimestamp(),
  });
  const oldReceiverCo = String(share.receiverCompanyId || "").trim();
  await syncReconciliationShareToCompanyIndexes(
    {
      ...share,
      id: params.shareId,
      receiverUserId: params.receiverUserId,
      receiverCompanyId: params.receiverCompanyId,
      receiverCompanyName: params.receiverCompanyName,
      receiverEntityType: params.receiverEntityType,
      receiverAccountId: params.receiverAccountId,
      receiverAccountName: params.receiverAccountName,
      receiverCollection,
      receiverLedgerSnapshot: snapshot.rows,
      receiverOpeningBalance: snapshot.openingBalance,
    } as ReconciliationShare,
    oldReceiverCo && oldReceiverCo !== params.receiverCompanyId ? { removeFromCompanyIds: [oldReceiverCo] } : undefined
  ).catch((err) => console.warn("[reconciliation_shares] index sync on change receiver:", err));
}

/** Linked share par sender apni company/account badle — receiver side same rehti hai. */
export async function changeSenderLinkedReconciliationShare(params: {
  shareId: string;
  senderUserId: string;
  senderCompanyId: string;
  senderCompanyName: string;
  senderEntityType: ReconciliationEntityType;
  senderAccountId: string;
  senderAccountName: string;
}): Promise<void> {
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = shareSnap.data() as ReconciliationShare;
  if (share.status !== "linked") throw new Error("Share is not linked yet");
  if (share.senderUserId !== params.senderUserId) throw new Error("Only the sender can change their side");

  const senderCollection = reconciliationEntityCollection(params.senderEntityType);
  const sameAsBefore =
    share.senderCompanyId === params.senderCompanyId &&
    share.senderAccountId === params.senderAccountId &&
    share.senderEntityType === params.senderEntityType;
  if (sameAsBefore) throw new Error("Select a different company or account");

  const snapshot = await buildReconciliationLedgerSnapshot({
    companyId: params.senderCompanyId,
    accountId: params.senderAccountId,
    collection: senderCollection,
    shareScope: share.shareScope,
    dateFrom: share.dateFrom,
    dateTo: share.dateTo,
  });

  await updateDoc(shareRef, {
    senderCompanyId: params.senderCompanyId,
    senderCompanyName: params.senderCompanyName,
    senderEntityType: params.senderEntityType,
    senderAccountId: params.senderAccountId,
    senderAccountName: params.senderAccountName,
    senderCollection,
    senderLedgerSnapshot: snapshot.rows,
    senderOpeningBalance: snapshot.openingBalance,
    senderSnapshotAt: serverTimestamp(),
    rowComments: deleteField(),
    updatedAt: serverTimestamp(),
  });
  const oldSenderCo = String(share.senderCompanyId || "").trim();
  await syncReconciliationShareToCompanyIndexes(
    {
      ...share,
      id: params.shareId,
      senderCompanyId: params.senderCompanyId,
      senderCompanyName: params.senderCompanyName,
      senderEntityType: params.senderEntityType,
      senderAccountId: params.senderAccountId,
      senderAccountName: params.senderAccountName,
      senderCollection,
      senderLedgerSnapshot: snapshot.rows,
      senderOpeningBalance: snapshot.openingBalance,
    } as ReconciliationShare,
    oldSenderCo && oldSenderCo !== params.senderCompanyId ? { removeFromCompanyIds: [oldSenderCo] } : undefined
  ).catch((err) => console.warn("[reconciliation_shares] index sync on change sender:", err));
}

/** Koi bhi participant apni linked side hata de — share revoked, history fields rehti hain. */
export async function unlinkReconciliationShare(params: {
  shareId: string;
  userId: string;
  userEmail?: string;
}): Promise<void> {
  if (isDriveLocalReconciliationShareId(params.shareId)) {
    await unlinkDriveLocalReconciliationShare(params);
    return;
  }
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = { id: shareSnap.id, ...shareSnap.data() } as ReconciliationShare;
  if (share.status !== "linked") throw new Error("Share is not linked");
  const isParticipant =
    share.senderUserId === params.userId ||
    share.receiverUserId === params.userId ||
    share.targetUserId === params.userId;
  if (!isParticipant) throw new Error("Only a linked participant can unlink");

  const iAmSender = share.senderUserId === params.userId;
  const actorCompanyName = iAmSender ? share.senderCompanyName : share.receiverCompanyName || "—";
  const actorAccountName = iAmSender ? share.senderAccountName : share.receiverAccountName || "—";
  const otherCompanyName = iAmSender ? share.receiverCompanyName || "—" : share.senderCompanyName;
  const otherAccountName = iAmSender ? share.receiverAccountName || "—" : share.senderAccountName;
  const otherUserId = iAmSender
    ? share.receiverUserId || share.targetUserId
    : share.senderUserId;

  await updateDoc(shareRef, {
    status: "revoked",
    unlinkedByUserId: params.userId,
    unlinkedByUserEmail: params.userEmail || deleteField(),
    unlinkedAt: serverTimestamp(),
    rowComments: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await syncReconciliationShareToCompanyIndexes({
    ...share,
    status: "revoked",
    unlinkedByUserId: params.userId,
    unlinkedByUserEmail: params.userEmail,
  } as ReconciliationShare).catch((err) => console.warn("[reconciliation_shares] index sync on unlink:", err));

  if (otherUserId && otherUserId !== params.userId) {
    await sendReconciliationUnlinkedAlert({
      shareId: params.shareId,
      recipientUserId: otherUserId,
      actorUserId: params.userId,
      actorUserEmail: params.userEmail,
      actorCompanyName: actorCompanyName || "—",
      actorAccountName: actorAccountName || "—",
      otherCompanyName: otherCompanyName || "—",
      otherAccountName: otherAccountName || "—",
      companyIdForAlert: iAmSender ? share.senderCompanyId : share.receiverCompanyId || share.senderCompanyId,
    });
  }
}

/** Revoked share dubara pending — receiver fields clear, target ko request again alert/chat. */
export async function requestReconciliationShareAgain(params: {
  shareId: string;
  userId: string;
  userEmail?: string;
}): Promise<void> {
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = { id: shareSnap.id, ...shareSnap.data() } as ReconciliationShare;
  if (share.status !== "revoked") throw new Error("Share is not unlinked");
  const isParticipant =
    share.senderUserId === params.userId ||
    share.receiverUserId === params.userId ||
    share.targetUserId === params.userId;
  if (!isParticipant) throw new Error("Only a participant can request again");

  const iAmSender = share.senderUserId === params.userId;
  // Sender hi apni company ka ledger refresh kar sakta hai — receiver ke paas permission nahi hoti
  const updatePayload: Record<string, unknown> = {
    status: "pending",
    receiverUserId: deleteField(),
    receiverCompanyId: deleteField(),
    receiverCompanyName: deleteField(),
    receiverEntityType: deleteField(),
    receiverAccountId: deleteField(),
    receiverAccountName: deleteField(),
    receiverCollection: deleteField(),
    receiverLedgerSnapshot: deleteField(),
    receiverOpeningBalance: deleteField(),
    receiverSnapshotAt: deleteField(),
    linkedAt: deleteField(),
    unlinkedByUserId: deleteField(),
    unlinkedByUserEmail: deleteField(),
    unlinkedAt: deleteField(),
    rowComments: deleteField(),
    updatedAt: serverTimestamp(),
  };

  if (iAmSender) {
    const snapshot = await buildReconciliationLedgerSnapshot({
      companyId: share.senderCompanyId,
      accountId: share.senderAccountId,
      collection: share.senderCollection,
      shareScope: share.shareScope,
      dateFrom: share.dateFrom,
      dateTo: share.dateTo,
    });
    updatePayload.senderLedgerSnapshot = snapshot.rows;
    updatePayload.senderOpeningBalance = snapshot.openingBalance;
    updatePayload.senderSnapshotAt = serverTimestamp();
  }

  await updateDoc(shareRef, updatePayload);
  const oldReceiverCo = String(share.receiverCompanyId || "").trim();
  await syncReconciliationShareToCompanyIndexes(
    {
      ...share,
      status: "pending",
      receiverUserId: undefined,
      receiverCompanyId: undefined,
      receiverCompanyName: undefined,
      receiverEntityType: undefined,
      receiverAccountId: undefined,
      receiverAccountName: undefined,
      receiverCollection: undefined,
      receiverLedgerSnapshot: undefined,
      receiverOpeningBalance: undefined,
    } as ReconciliationShare,
    oldReceiverCo ? { removeFromCompanyIds: [oldReceiverCo] } : undefined
  ).catch((err) => console.warn("[reconciliation_shares] index sync on request again:", err));

  const recipientUserId =
    params.userId === share.senderUserId
      ? share.targetUserId
      : share.senderUserId;

  await sendReconciliationRequestAgainAlert({
    shareId: params.shareId,
    recipientUserId,
    actorUserId: params.userId,
    actorUserEmail: params.userEmail,
    senderCompanyId: share.senderCompanyId,
    senderCompanyName: share.senderCompanyName,
    senderAccountName: share.senderAccountName,
  });
}

export async function refreshReconciliationSideSnapshot(params: {
  shareId: string;
  side: "sender" | "receiver";
}): Promise<void> {
  if (isDriveLocalReconciliationShareId(params.shareId)) {
    await refreshDriveLocalReconciliationSideSnapshot(params);
    return;
  }
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) throw new Error("Share not found");
  const share = { id: shareSnap.id, ...shareSnap.data() } as ReconciliationShare;
  if (params.side === "sender") {
    const snapshot = await buildReconciliationLedgerSnapshot({
      companyId: share.senderCompanyId,
      accountId: share.senderAccountId,
      collection: share.senderCollection,
      shareScope: share.shareScope,
      dateFrom: share.dateFrom,
      dateTo: share.dateTo,
    });
    await updateDoc(shareRef, {
      senderLedgerSnapshot: snapshot.rows,
      senderOpeningBalance: snapshot.openingBalance,
      senderSnapshotAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncReconciliationShareToCompanyIndexes({
      ...share,
      senderLedgerSnapshot: snapshot.rows,
      senderOpeningBalance: snapshot.openingBalance,
    }).catch((err) => console.warn("[reconciliation_shares] index sync on refresh sender:", err));
  } else {
    if (!share.receiverCompanyId || !share.receiverAccountId) throw new Error("Receiver not linked");
    const snapshot = await buildReconciliationLedgerSnapshot({
      companyId: share.receiverCompanyId,
      accountId: share.receiverAccountId,
      collection: share.receiverCollection || reconciliationEntityCollection(share.receiverEntityType || "party"),
      shareScope: share.shareScope,
      dateFrom: share.dateFrom,
      dateTo: share.dateTo,
    });
    await updateDoc(shareRef, {
      receiverLedgerSnapshot: snapshot.rows,
      receiverOpeningBalance: snapshot.openingBalance,
      receiverSnapshotAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncReconciliationShareToCompanyIndexes({
      ...share,
      receiverLedgerSnapshot: snapshot.rows,
      receiverOpeningBalance: snapshot.openingBalance,
    }).catch((err) => console.warn("[reconciliation_shares] index sync on refresh receiver:", err));
  }
}

export async function getReconciliationShare(
  shareId: string,
  companyId?: string
): Promise<ReconciliationShare | null> {
  const id = String(shareId || "").trim();
  if (!id) return null;
  if (isDriveLocalReconciliationShareId(id)) {
    return getDriveLocalReconciliationShare(id);
  }
  try {
    const snap = await getDoc(doc(firestore, "reconciliation_shares", id));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as ReconciliationShare;
  } catch {
    /* participant nahi / rules — company index niche */
  }
  const cid = String(companyId || "").trim();
  if (cid) {
    try {
      const idx = await getDoc(companyShareIndexRef(cid, id));
      if (idx.exists()) return { id, ...idx.data() } as ReconciliationShare;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function subscribeReconciliationSharesForUser(
  userId: string,
  onData: (shares: ReconciliationShare[]) => void
): Unsubscribe {
  return subscribeReconciliationSharesForViewer(userId, undefined, onData);
}

/**
 * Reconciliation shares — participant uid + company subcollection mirror (shared staff).
 * Top-level senderCompanyId/receiverCompanyId queries rules me get() ki wajah se aksar fail — index primary hai.
 */
export function subscribeReconciliationSharesForViewer(
  userId: string,
  companyId: string | undefined,
  onData: (shares: ReconciliationShare[]) => void
): Unsubscribe {
  if (!userId) {
    onData([]);
    return () => {};
  }
  const cid = String(companyId || "").trim();
  // PL Server staff companies (local_* / access-context shared): Firestore company recon path permission-denied loop → EXE lag/crash.
  // Keep uid-level + Drive/local shares; skip company-scoped Firestore queries.
  const skipCompanyScopedFirestore =
    Boolean(cid.startsWith("local_")) ||
    (cid
      ? getPlServerSharedCompanies().some((r) => String(r.id || "").trim() === cid)
      : false);
  const sentQ = query(SHARES(), where("senderUserId", "==", userId));
  const recvQ = query(SHARES(), where("targetUserId", "==", userId));
  const linkedRecvQ = query(SHARES(), where("receiverUserId", "==", userId));
  const senderCoQ =
    cid && !skipCompanyScopedFirestore ? query(SHARES(), where("senderCompanyId", "==", cid)) : null;
  const receiverCoQ =
    cid && !skipCompanyScopedFirestore ? query(SHARES(), where("receiverCompanyId", "==", cid)) : null;
  const companyIdxQ = cid && !skipCompanyScopedFirestore ? query(COMPANY_SHARES(cid)) : null;
  let sent: ReconciliationShare[] = [];
  let recv: ReconciliationShare[] = [];
  let linkedRecv: ReconciliationShare[] = [];
  let senderCo: ReconciliationShare[] = [];
  let receiverCo: ReconciliationShare[] = [];
  let companyIdx: ReconciliationShare[] = [];
  /** Participant se mile shares ka index lazily likho — purane shares staff ko dikhne ke liye */
  let indexSyncInFlight = false;
  const maybeSyncCompanyIndexes = (rows: ReconciliationShare[]) => {
    if (!cid || indexSyncInFlight) return;
    const forCompany = rows.filter((s) => s.senderCompanyId === cid || s.receiverCompanyId === cid);
    if (!forCompany.length) return;
    indexSyncInFlight = true;
    void Promise.all(forCompany.map((s) => syncReconciliationShareToCompanyIndexes(s).catch(() => {}))).finally(
      () => {
        indexSyncInFlight = false;
      }
    );
  };
  const emit = () => {
    const map = new Map<string, ReconciliationShare>();
    [...sent, ...recv, ...linkedRecv, ...senderCo, ...receiverCo, ...companyIdx].forEach((s) => map.set(s.id, s));
    for (const s of listDriveLocalReconciliationSharesForViewer(userId, cid)) {
      map.set(s.id, s);
    }
    onData(Array.from(map.values()).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
  };
  const onListenError = (label: string) => (err: unknown) => {
    console.warn(`[reconciliation_shares] ${label} listener:`, err);
    if (label === "sent") sent = [];
    if (label === "target") recv = [];
    if (label === "receiver") linkedRecv = [];
    if (label === "senderCompany") senderCo = [];
    if (label === "receiverCompany") receiverCo = [];
    if (label === "companyIndex") companyIdx = [];
    emit();
  };
  const unsubs: Unsubscribe[] = [
    onSnapshot(
      sentQ,
      (snap) => {
        sent = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
        maybeSyncCompanyIndexes(sent);
        emit();
      },
      onListenError("sent")
    ),
    onSnapshot(
      recvQ,
      (snap) => {
        recv = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
        maybeSyncCompanyIndexes(recv);
        emit();
      },
      onListenError("target")
    ),
    onSnapshot(
      linkedRecvQ,
      (snap) => {
        linkedRecv = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
        maybeSyncCompanyIndexes(linkedRecv);
        emit();
      },
      onListenError("receiver")
    ),
  ];
  if (senderCoQ) {
    unsubs.push(
      onSnapshot(
        senderCoQ,
        (snap) => {
          senderCo = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
          emit();
        },
        onListenError("senderCompany")
      )
    );
  }
  if (receiverCoQ) {
    unsubs.push(
      onSnapshot(
        receiverCoQ,
        (snap) => {
          receiverCo = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
          emit();
        },
        onListenError("receiverCompany")
      )
    );
  }
  if (companyIdxQ) {
    unsubs.push(
      onSnapshot(
        companyIdxQ,
        (snap) => {
          companyIdx = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
          emit();
        },
        onListenError("companyIndex")
      )
    );
  }
  const onDriveReconChanged = () => emit();
  if (typeof window !== "undefined") {
    window.addEventListener(DRIVE_RECON_CHANGED_EVENT, onDriveReconChanged);
    emit();
  }
  return () => {
    unsubs.forEach((u) => u());
    if (typeof window !== "undefined") {
      window.removeEventListener(DRIVE_RECON_CHANGED_EVENT, onDriveReconChanged);
    }
  };
}

/** Drive-synced local companies — recon links pull (background). */
export { pullDriveLocalReconciliationLinksForCompany };

/** Linked share jahan current company + account involved ho — company index primary (shared staff). */
export function subscribeLinkedSharesForAccount(
  companyId: string,
  accountId: string,
  userId: string | undefined,
  onData: (shares: ReconciliationShare[]) => void
): Unsubscribe {
  const cid = String(companyId || "").trim();
  const aid = String(accountId || "").trim();
  if (!cid || !aid) {
    onData([]);
    return () => {};
  }
  const filterLinkedForAccount = (rows: ReconciliationShare[]) =>
    rows.filter(
      (s) =>
        s.status === "linked" &&
        ((s.senderCompanyId === cid && s.senderAccountId === aid) ||
          (s.receiverCompanyId === cid && s.receiverAccountId === aid))
    );
  let fromCompanyIndex: ReconciliationShare[] = [];
  let fromViewer: ReconciliationShare[] = [];
  const emit = () => {
    const map = new Map<string, ReconciliationShare>();
    [...fromCompanyIndex, ...fromViewer].forEach((s) => map.set(s.id, s));
    onData(filterLinkedForAccount(Array.from(map.values())));
  };
  const skipCompanyScopedFirestore =
    cid.startsWith("local_") ||
    getPlServerSharedCompanies().some((r) => String(r.id || "").trim() === cid);
  const unsubs: Unsubscribe[] = [];
  if (!skipCompanyScopedFirestore) {
    unsubs.push(
      onSnapshot(
        query(COMPANY_SHARES(cid)),
        (snap) => {
          fromCompanyIndex = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReconciliationShare);
          emit();
        },
        (err) => {
          console.warn("[reconciliation_shares] account company index listener:", err);
          fromCompanyIndex = [];
          emit();
        }
      )
    );
  }
  const uid = String(userId || "").trim();
  if (uid) {
    unsubs.push(
      subscribeReconciliationSharesForViewer(uid, cid, (all) => {
        fromViewer = all;
        emit();
      })
    );
  } else {
    emit();
  }
  return () => unsubs.forEach((u) => u());
}

/** Right table (remote snapshot) ke comments kis map me — viewer ke hisaab se. */
export function remoteReconciliationCommentSide(
  share: ReconciliationShare,
  userId: string,
  companyId?: string
): "sender" | "receiver" {
  return reconciliationViewerSide(share, userId, companyId) === "sender" ? "receiver" : "sender";
}

/** Left (You) table: dusre user ne meri row par jo comment likha — us map ka side. */
export function otherPartyCommentsOnMyRowsSide(
  share: ReconciliationShare,
  userId: string,
  companyId?: string
): "sender" | "receiver" {
  return reconciliationViewerSide(share, userId, companyId) === "sender" ? "sender" : "receiver";
}

/** Reconciling remote row comment save — Firestore share doc `rowComments`. */
export async function saveReconciliationRowComment(params: {
  shareId: string;
  side: "sender" | "receiver";
  rowId: string;
  comment: string;
}): Promise<void> {
  if (isDriveLocalReconciliationShareId(params.shareId)) {
    await saveDriveLocalReconciliationRowComment(params);
    return;
  }
  const trimmed = String(params.comment || "").trim();
  const shareRef = doc(firestore, "reconciliation_shares", params.shareId);
  await updateDoc(shareRef, {
    [`rowComments.${params.side}.${params.rowId}`]: trimmed ? trimmed : deleteField(),
    updatedAt: serverTimestamp(),
  });
  // Company index mirror — shared staff ko comment + green icon turant dikhe
  try {
    const snap = await getDoc(shareRef);
    if (snap.exists()) {
      await syncReconciliationShareToCompanyIndexes({
        id: snap.id,
        ...snap.data(),
      } as ReconciliationShare);
    }
  } catch (err) {
    console.warn("[reconciliation_shares] index sync after comment save:", err);
  }
}

/** You-side double-click edit — Firestore + SQLite mirror (APK/local) dono try karo */
export async function fetchVoucherForReconciliationEdit(
  companyId: string,
  voucherId: string
): Promise<Record<string, unknown> | null> {
  if (!companyId || !voucherId) return null;

  // Offline / SQLite-first companies — pehle local mirror
  if (preferLocalLedgerReads()) {
    const localFirst = await getCompanyDocFromBrowserDb(companyId, "vouchers", voucherId);
    if (localFirst) return { ...localFirst, id: voucherId } as Record<string, unknown>;
  }

  try {
    const snap = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, voucherId));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as Record<string, unknown>;
    }
  } catch {
    /* offline / permission — local fallback niche */
  }

  // Firestore miss → SQLite / browser DB (APK par aksar yahi hota hai)
  const local = await getCompanyDocFromBrowserDb(companyId, "vouchers", voucherId);
  if (local) return { ...local, id: voucherId } as Record<string, unknown>;

  return null;
}
