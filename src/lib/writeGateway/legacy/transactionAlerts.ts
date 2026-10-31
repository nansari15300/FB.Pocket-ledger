"use client";

import { addDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { collection, serverTimestamp, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, firestoreNetworkDisabledByApi } from "@/lib/firebase";
import type { Company } from "@/hooks/useCompany";
import { getEffectiveNotificationSettings } from "@/lib/localUserNotificationSettings";
import { preferLocalLedgerReads } from "@/lib/apkOnlineFirestoreWritePolicy";

const ONE_LAKH = 100000;

export type TransactionAlertKind = "deleted" | "edited" | "large_amount" | "auto_created";

export type TransactionAlertPayload = {
  kind: TransactionAlertKind;
  voucherId?: string;
  voucherNumber?: string;
  voucherType?: string;
  amount?: number;
  performedByUserId?: string;
  performedByEmail?: string;
  performedByName?: string;
  /** For kind "edited": list of what changed, e.g. ["Amount", "Narration", "Date"] */
  changes?: string[];
};

async function resolveUidFromUserRef(userRefId?: string, email?: string): Promise<string | null> {
  if (preferLocalLedgerReads() || firestoreNetworkDisabledByApi) {
    return userRefId || null;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return userRefId || null;
  }
  if (userRefId) {
    const snap = await getDoc(doc(firestore, "users", userRefId));
    if (snap.exists()) {
      const data: any = snap.data();
      return data?.uid || snap.id || null;
    }
  }
  if (email) {
    const q = query(collection(firestore, "users"), where("email", "==", email));
    const s = await getDocs(q);
    if (!s.empty) {
      const d: any = s.docs[0].data();
      return d?.uid || s.docs[0].id || null;
    }
  }
  // Fallback: many companies already store Firebase Auth uid directly as ownerId/shared uid.
  return userRefId || null;
}

/** Normalize value for comparison (Timestamp → ms, Date → ms, else as-is). */
function normVal(v: unknown): unknown {
  if (v == null) return v;
  const d = (v as { toDate?: () => Date }).toDate;
  if (typeof d === "function") return d.call(v).getTime();
  if (v instanceof Date) return v.getTime();
  return v;
}

/**
 * Returns human-readable labels for fields that changed between old and new objects.
 * Use for "Transaction edited" alerts so we can show "Amount changed, Narration changed", etc.
 */
export function getChangedFieldLabels(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  fields: { key: string; label: string }[]
): string[] {
  const out: string[] = [];
  for (const { key, label } of fields) {
    const a = normVal(oldObj[key]);
    const b = normVal(newObj[key]);
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) continue;
    if (String(a).trim() === String(b).trim()) continue;
    out.push(label);
  }
  return out;
}

/**
 * Sends an alert to the company owner (admin) if Edits and bigger amount add alert is enabled.
 * Alert appears in Messages → Alerts tab.
 */
export async function sendTransactionAlert(
  companyId: string,
  company: Company | null,
  payload: TransactionAlertPayload
): Promise<{ success: boolean; error?: string }> {
  if (!company || !companyId?.trim()) return { success: true };

  // Owner ke Firebase uid par merge: Firestore `notificationSettings` + **`localUserNotificationSettings`** (Settings → local save).
  const ownerUid = await resolveUidFromUserRef(company.ownerId, company.ownerEmail);
  const prefs = getEffectiveNotificationSettings(company, ownerUid, companyId);
  // Explicit off hi roke — default merged shape me `on: true` (reference jaisa behaviour jab kuch save na ho).
  if (prefs.transactionAlerts?.on === false) return { success: true };

  // Only company admin (owner) receives transaction alerts; not shared users.
  const recipientUserIds = new Set<string>();
  if (ownerUid) recipientUserIds.add(ownerUid);

  if (recipientUserIds.size === 0) return { success: true };

  // Local/offline: Firebase alerts queue mat — save flow background me hang na ho.
  if (
    preferLocalLedgerReads(company) ||
    firestoreNetworkDisabledByApi ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    return { success: true };
  }

  // Do not send "edited" alert when the editor is the company admin (owner).
  if (payload.kind === "edited" && payload.performedByUserId && ownerUid && payload.performedByUserId === ownerUid) {
    return { success: true };
  }

  const currencySym = company?.currencySymbol ?? "Rs.";
  const by =
    payload.performedByName
      ? (payload.performedByEmail ? `${payload.performedByName} (${payload.performedByEmail})` : payload.performedByName)
      : (payload.performedByEmail || payload.performedByUserId || "Someone");
  let message: string;
  switch (payload.kind) {
    case "deleted":
      message = `Transaction deleted: ${payload.voucherNumber || payload.voucherType || "Voucher"} (by ${by}).`;
      break;
    case "edited": {
      message = `Transaction edited: ${payload.voucherNumber || payload.voucherType || "Voucher"} (by ${by}).`;
      if (payload.changes && payload.changes.length > 0) {
        message += ` Changes: ${payload.changes.join(", ")}.`;
      }
      break;
    }
    case "large_amount": {
      const amt =
        payload.amount != null
          ? `${currencySym} ${payload.amount.toLocaleString("en-IN")}`
          : `> ${currencySym} 1,00,000`;
      message = `Large amount added: ${payload.voucherNumber || payload.voucherType || "Voucher"} — ${amt} (by ${by}).`;
      break;
    }
    case "auto_created":
      // Recurring monthly engine: owner ko dedicated "auto created voucher" message bhejo.
      message = `Auto created voucher: ${payload.voucherNumber || payload.voucherType || "Voucher"} (by ${by}).`;
      break;
    default:
      message = `Transaction activity (by ${by}).`;
  }

  try {
    const writeOps = Array.from(recipientUserIds).map(async (recipientUserId) => {
      const docData: Record<string, unknown> = {
        recipientUserId,
        message,
        timestamp: serverTimestamp(),
        isRead: false,
        type: "transaction_alert",
        companyId,
        kind: payload.kind,
      };
      if (payload.voucherId != null) docData.voucherId = payload.voucherId;
      if (payload.voucherNumber != null) docData.voucherNumber = payload.voucherNumber;
      if (payload.voucherType != null) docData.voucherType = payload.voucherType;
      if (payload.amount != null) {
        docData.amount = payload.amount;
        docData.amountFormatted = `${currencySym} ${payload.amount.toLocaleString("en-IN")}`;
      }
      if (payload.performedByUserId || payload.performedByEmail) {
        docData.attemptedBy = {
          uid: payload.performedByUserId || "",
          email: payload.performedByEmail || "",
          ...(payload.performedByName ? { name: payload.performedByName } : {}),
        };
      }
      if (payload.kind === "edited" && payload.changes && payload.changes.length > 0) {
        docData.changes = payload.changes;
      }
      await addDoc(collection(firestore, "admin_notifications"), docData);
    });
    await Promise.all(writeOps);
    return { success: true };
  } catch (err: any) {
    console.error("sendTransactionAlert failed:", err);
    return { success: false, error: err?.message };
  }
}

/** Returns true if amount is more than 1 lakh (100,000). */
export function isAmountOverOneLakh(amount: number): boolean {
  return typeof amount === "number" && !Number.isNaN(amount) && amount > ONE_LAKH;
}

/**
 * Legacy/old builds ke "new transaction added" alerts hide karne ka guard.
 * User request: normal added notifications band, sirf `large_amount` naya alert dikhna chahiye.
 */
export function isSuppressibleNewTransactionAlert(alert: {
  kind?: unknown;
  type?: unknown;
  message?: unknown;
}): boolean {
  const type = String(alert.type ?? "").toLowerCase();
  if (type !== "transaction_alert") return false;
  const kind = String(alert.kind ?? "").toLowerCase();
  if (kind === "large_amount") return false;
  if (kind === "added" || kind === "created" || kind === "new" || kind === "new_transaction") return true;
  const msg = String(alert.message ?? "").toLowerCase();
  if (msg.includes("large amount")) return false;
  return msg.includes("transaction added") || msg.includes("new transaction");
}
