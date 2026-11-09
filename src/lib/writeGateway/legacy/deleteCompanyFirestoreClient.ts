"use client";

/**
 * Company permanent delete / restore — Firestore client (static export / APK / web sab).
 * Pehle `deleteCompanyActionStub` sirf error return karta tha ("app mode").
 */
import { deleteDoc, updateDoc, writeBatch } from "@/lib/writeGateway/firestoreMutationsInternal";
import { collection, deleteField, doc, limit, query } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { deleteCompanyFirebaseStorageFolder } from "@/lib/deleteCompanyStorageFolder";

/** `companies/{id}` ke neeche jo subcollections app me use hoti hain — root delete se pehle khali karo. */
const COMPANY_SUBCOLLECTIONS = [
  "parties",
  "groups",
  "bank_accounts",
  "account_groups",
  "staff",
  "staff_groups",
  "items",
  "item_groups",
  "taxes",
  "tax_groups",
  "vouchers",
  "unassigned_documents",
  "expense_accounts",
  "expense_groups",
  "alarms",
  "payments",
  "loans",
  "loan_schedules",
  "loan_transactions",
  "loan_rate_history",
  "loan_charges",
  "loan_audit_logs",
  "loan_settings",
  "loan_documents",
  /** HR module (pl_docs, keyed by company + coll + app_id). */
  "hr_attendance",
  "hr_leaves",
  "hr_payroll",
] as const;

async function deleteAllDocumentsInCollection(collectionPath: string): Promise<void> {
  const colRef = collection(firestore, collectionPath);
  for (;;) {
    const snap = await getDocs(query(colRef, limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(firestore);
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }
}

export async function deleteCompanyComplete(
  companyId: string,
  _userId: string
): Promise<{ success: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { success: false, error: "Invalid company id" };

  try {
    let companyName = "";
    try {
      const snap = await getDoc(doc(firestore, "companies", cid));
      if (snap.exists()) {
        companyName = String((snap.data() as { name?: string } | undefined)?.name || "");
      }
    } catch {
      /* optional */
    }

    try {
      await deleteCompanyFirebaseStorageFolder({ companyId: cid, companyName });
    } catch (e) {
      console.warn("[deleteCompanyComplete] storage folder wipe failed", cid, e);
    }

    for (const sub of COMPANY_SUBCOLLECTIONS) {
      await deleteAllDocumentsInCollection(`companies/${cid}/${sub}`);
    }
    await deleteDoc(doc(firestore, "companies", cid));
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Company delete failed",
    };
  }
}

export async function restoreCompany(
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { success: false, error: "Invalid company id" };

  try {
    await updateDoc(doc(firestore, "companies", cid), {
      isDeleted: false,
      deletedAt: null,
      movedToAdminRecycleAt: deleteField(),
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Restore failed",
    };
  }
}
