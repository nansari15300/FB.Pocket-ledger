"use client";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { Company } from "@/hooks/useCompany";
import { getEffectiveNotificationSettings } from "@/lib/localUserNotificationSettings";
import { getLocalCompanyById } from "@/lib/localCompanyStore";

/** Recycle bin alert — voucher / master / company. */
export type RecycleBinEntityKind = "voucher" | "master" | "company";

export type RecycleBinMovedAlertPayload = {
  entityKind: RecycleBinEntityKind;
  entityId: string;
  entityName: string;
  /** Firestore subcollection path (masters) — e.g. parties, bank_accounts. */
  collectionPath?: string;
  voucherNumber?: string;
  voucherType?: string;
  performedByUserId?: string;
  performedByEmail?: string;
  performedByName?: string;
};

const COLLECTION_LABELS: Record<string, string> = {
  parties: "Party",
  groups: "Party Group",
  bank_accounts: "Bank/Cash Account",
  account_groups: "Account Group",
  staff: STAFF_ENTITY_LABEL,
  staff_groups: "Staff Group",
  items: "Item",
  item_groups: "Item Group",
  taxes: "Tax",
  tax_groups: "Tax Group",
  expense_accounts: "Expense Account",
  vouchers: "Voucher",
  unassigned_documents: "Unassigned File",
};

async function resolveUidFromUserRef(userRefId?: string, email?: string): Promise<string | null> {
  if (userRefId) {
    const snap = await getDoc(doc(firestore, "users", userRefId));
    if (snap.exists()) {
      const data: Record<string, unknown> = snap.data() as Record<string, unknown>;
      return (data?.uid as string) || snap.id || null;
    }
  }
  if (email) {
    const q = query(collection(firestore, "users"), where("email", "==", email));
    const s = await getDocs(q);
    if (!s.empty) {
      const d = s.docs[0].data() as Record<string, unknown>;
      return (d?.uid as string) || s.docs[0].id || null;
    }
  }
  return userRefId || null;
}

function masterTypeLabel(collectionPath?: string): string {
  if (!collectionPath) return "Record";
  return COLLECTION_LABELS[collectionPath] || collectionPath.replace(/_/g, " ");
}

function buildMovedMessage(payload: RecycleBinMovedAlertPayload, by: string): string {
  const name = payload.entityName?.trim() || "Unnamed";
  switch (payload.entityKind) {
    case "voucher":
      return `Voucher moved to recycle bin: ${payload.voucherNumber || name} (by ${by}).`;
    case "company":
      return `Company moved to recycle bin: ${name} (by ${by}).`;
    case "master":
      return `${masterTypeLabel(payload.collectionPath)} moved to recycle bin: ${name} (by ${by}).`;
    default:
      return `Moved to recycle bin: ${name} (by ${by}).`;
  }
}

/**
 * Item recycle bin me aaya — Messages → Alerts me dikhao (owner only, transaction alerts on ho).
 */
export async function sendRecycleBinMovedAlert(
  companyId: string,
  company: Company | null,
  payload: RecycleBinMovedAlertPayload
): Promise<{ success: boolean; error?: string }> {
  if (!company || !companyId?.trim() || !payload.entityId?.trim()) return { success: true };

  const ownerUid = await resolveUidFromUserRef(company.ownerId, company.ownerEmail);
  const prefs = getEffectiveNotificationSettings(company, ownerUid, companyId);
  if (prefs.transactionAlerts?.on === false) return { success: true };

  const recipientUserIds = new Set<string>();
  if (ownerUid) recipientUserIds.add(ownerUid);
  if (recipientUserIds.size === 0) return { success: true };

  const by =
    payload.performedByName
      ? payload.performedByEmail
        ? `${payload.performedByName} (${payload.performedByEmail})`
        : payload.performedByName
      : payload.performedByEmail || payload.performedByUserId || "Someone";

  const message = buildMovedMessage(payload, by);

  try {
    // Purana in_bin alert hatao — dubara move par ek hi row.
    await removeRecycleBinAlerts(companyId, payload.entityId);

    const writeOps = Array.from(recipientUserIds).map(async (recipientUserId) => {
      const docData: Record<string, unknown> = {
        recipientUserId,
        message,
        timestamp: serverTimestamp(),
        isRead: false,
        type: "recycle_bin_alert",
        kind: "recycle_bin",
        recycleBinStatus: "in_bin",
        companyId,
        entityKind: payload.entityKind,
        entityId: payload.entityId,
        entityName: payload.entityName,
      };
      if (payload.collectionPath) docData.collectionPath = payload.collectionPath;
      if (payload.voucherNumber) docData.voucherNumber = payload.voucherNumber;
      if (payload.voucherType) docData.voucherType = payload.voucherType;
      if (payload.entityKind === "voucher") {
        docData.voucherId = payload.entityId;
      }
      if (payload.performedByUserId || payload.performedByEmail) {
        docData.attemptedBy = {
          uid: payload.performedByUserId || "",
          email: payload.performedByEmail || "",
          ...(payload.performedByName ? { name: payload.performedByName } : {}),
        };
      }
      await addDoc(collection(firestore, "admin_notifications"), docData);
    });
    await Promise.all(writeOps);
    return { success: true };
  } catch (err: unknown) {
    console.error("sendRecycleBinMovedAlert failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Restore ya recycle bin se hard delete — alert list se hatao.
 */
export async function removeRecycleBinAlerts(
  companyId: string,
  entityId: string
): Promise<void> {
  const cid = companyId?.trim();
  const eid = entityId?.trim();
  if (!cid || !eid) return;

  try {
    const q = query(
      collection(firestore, "admin_notifications"),
      where("companyId", "==", cid),
      where("type", "==", "recycle_bin_alert"),
      where("entityId", "==", eid)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    console.warn("removeRecycleBinAlerts failed:", err);
  }
}

/** `writeEntity` / master delete: collection path se entity kind infer. */
export function inferRecycleBinEntityKind(collectionName: string): RecycleBinEntityKind {
  if (collectionName === "vouchers") return "voucher";
  if (collectionName === "companies") return "company";
  return "master";
}

export function displayNameFromRecycleBinPatch(
  collectionName: string,
  data: Record<string, unknown>
): string {
  const name =
    data.name ??
    data.accountName ??
    data.voucherNumber ??
    data.quotationNumber ??
    data.title ??
    `Unnamed ${masterTypeLabel(collectionName)}`;
  return String(name);
}

/** UI `updateDoc` soft-delete ke baad alert — `writeEntity` ke alawa masters ke liye. */
export async function fireRecycleBinMovedAlertForCompanyDoc(
  companyId: string,
  collectionPath: string,
  entityId: string,
  entityName: string,
  performer?: { uid?: string; email?: string | null; name?: string | null }
): Promise<void> {
  const cid = companyId?.trim();
  const eid = entityId?.trim();
  if (!cid || !eid) return;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const fsCompanyId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim();
  void sendRecycleBinMovedAlert(fsCompanyId, (reg as Company) ?? null, {
    entityKind: inferRecycleBinEntityKind(collectionPath),
    entityId: eid,
    entityName: entityName?.trim() || eid,
    collectionPath,
    performedByUserId: performer?.uid,
    performedByEmail: performer?.email ?? undefined,
    performedByName: performer?.name ?? undefined,
  });
}
