
/* No 'use server' - static export compatible */

import { updateDoc, addDoc, writeBatch, setDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { doc, collection, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/plClientSession';
import { ensureSuperAdminInSharedEmails } from '@/lib/superAdminEmails';
import { diff } from 'deep-object-diff';
import { moveFilesToVoucherDate } from "@/lib/storage"; // Import the move function
import { getEffectiveHistorySettings } from "@/lib/voucherHistoryUtils";
import { coerceVoucherDateForStamp, toIsoDateStamp } from "@/lib/voucherDateStamp";
import { LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY, PL_CLIENT_OFFLINE_FIRST_PERSIST_MS } from "@/lib/localMirrorServerMeta";

/**
 * 1. Auto-setup function: Creates default groups and accounts for each menu.
 */
export async function initializeCompanyData(companyId: string, userId: string) {
  const batch = writeBatch(firestore);

  // --- 1. Default Groups for each menu ---
  // Note: Groups with isReportOnly: true are only shown in reports, not in list pages
  const groupsToCreate = [
    // For Parties Menu - Report-only groups (main parent groups)
    { col: "groups", id: "assets", name: "Assets", type: "Asset", isSystemReserved: true, isReportOnly: true },
    { col: "groups", id: "liabilities", name: "Liabilities", type: "Liability", isSystemReserved: true, isReportOnly: true },
    { col: "groups", id: "income", name: "Income", type: "Income", isSystemReserved: true, isReportOnly: true },
    { col: "groups", id: "expenses", name: "Expenses", type: "Expense", isSystemReserved: true, isReportOnly: true },
    { col: "groups", id: "equity", name: "Equity", type: "Equity", isSystemReserved: true, isReportOnly: true },
    // User-visible groups (shown in list pages)
    { col: "groups", id: "sundry_debtors", name: "Sundry Debtors", type: "Asset", parentId: "assets", isSystemReserved: true, isReportOnly: false },
    { col: "groups", id: "sundry_creditors", name: "Sundry Creditors", type: "Liability", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },

    // For Tax Menu
    { col: "tax_groups", id: "duties_taxes", name: "Duties & Taxes", type: "Tax", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },

    // For Bank & Cash Menu
    { col: "account_groups", id: "bank_accounts_group", name: "Bank Accounts", type: "Bank", parentId: "assets", isSystemReserved: true, isReportOnly: false },
    { col: "account_groups", id: "cash_in_hand_group", name: "Cash-in-Hand", type: "Cash", parentId: "assets", isSystemReserved: true, isReportOnly: false },

    // For Income & Expense Menu
    { col: "expense_groups", id: "direct_income", name: "Direct Income", type: "Income", parentId: "income", isSystemReserved: false, isReportOnly: false },
    { col: "expense_groups", id: "indirect_income", name: "Indirect Income", type: "Income", parentId: "income", isSystemReserved: false, isReportOnly: false },
    { col: "expense_groups", id: "direct_expense", name: "Direct Expenses", type: "Expense", parentId: "expenses", isSystemReserved: false, isReportOnly: false },
    { col: "expense_groups", id: "indirect_expense", name: "Indirect Expenses", type: "Expense", parentId: "expenses", isSystemReserved: false, isReportOnly: false },
    
    // For Staff Menu
    { col: "staff_groups", id: "loans_liabilities", name: "Loans & Liabilities", type: "Liability", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },
    { col: "staff_groups", id: "staff_system", name: "Staff", type: "General", parentId: "loans_liabilities", isSystemReserved: true, isReportOnly: false },
    // Auto-created Ungrouped buckets (kept hidden in UI lists unless real ungrouped records exist).
    { col: "staff_groups", id: "ungrouped_staff", name: "Ungrouped", type: "General", parentId: "loans_liabilities", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
    { col: "tax_groups", id: "ungrouped_tax", name: "Ungrouped", type: "General", parentId: "duties_taxes", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
    { col: "account_groups", id: "ungrouped_account", name: "Ungrouped", type: "General", parentId: "bank_accounts_group", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
    { col: "expense_groups", id: "ungrouped_expense", name: "Ungrouped", type: "General", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
  ];

  groupsToCreate.forEach((g) => {
    const ref = doc(firestore, `companies/${companyId}/${g.col}`, g.id);
    batch.set(ref, {
      name: g.name,
      type: g.type,
      parentId: g.parentId || null,
      companyId,
      ownerId: userId,
      isDeleted: false,
      isSystemReserved: g.isSystemReserved || false,
      isReportOnly: (g as any).isReportOnly || false,
      // Flag auto-created Ungrouped docs so UI can hide base row until needed.
      isAutoUngrouped: (g as any).isAutoUngrouped || false,
      createdAt: serverTimestamp(),
    });
  });

  // --- 2. Default Accounts/Ledgers for each menu ---
  const accountsToCreate = [
    // Parties & core accounts
    { col: "parties", id: "owners_capital", name: "Owner's Capital", groupId: "equity", isSystemReserved: true },
    // Opening Balance ledger under Capital Account for automatic double-entry
    { col: "parties", id: "opening_balance_ledger", name: "Opening Balance", groupId: "equity", isSystemReserved: true, isSystemAccount: true },

    // Tax Account
    { col: "taxes", id: "vat_sales_tax", name: "VAT / Sales Tax", groupId: "duties_taxes", rate: 13, isSystemReserved: true },

    // Expense & Income Accounts
    { col: "expense_accounts", id: "sales_account", name: "Sales Account", groupId: "direct_income", type: "Income", isSystemReserved: true },
    { col: "expense_accounts", id: "purchase_account", name: "Purchase Account", groupId: "direct_expense", type: "Expense", isSystemReserved: true },
  ];

  accountsToCreate.forEach((acc) => {
    const ref = doc(firestore, `companies/${companyId}/${acc.col}`, acc.id);
    batch.set(ref, {
      name: acc.name,
      groupId: acc.groupId,
      accountType: (acc as any).accountType || null,
      rate: (acc as any).rate || 0,
      openingBalance: 0,
      openingBalanceDate: null, 
      companyId,
      ownerId: userId,
      isDeleted: false,
      isSystemReserved: acc.isSystemReserved || false,
      isSystemAccount: (acc as any).isSystemAccount || false,
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();
}


/**
 * Utility: deep diff comparison for two objects
 */
function getChanges(oldData: any, newData: any) {
  const changes: Record<string, { from: any; to: any }> = {};
  const ignoredFields = [
    "history", "createdAt", "updatedAt", "id", "isDeleted",
    "deletedAt", "balance", "credit", "debit",
    LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY,
    PL_CLIENT_OFFLINE_FIRST_PERSIST_MS,
  ];

  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

  keys.forEach((key) => {
    if (ignoredFields.includes(key)) return;

    let oldVal = oldData?.[key];
    let newVal = newData?.[key];
    if (
      key === "amount" &&
      String(newData?.type || "").toLowerCase() === "journal" &&
      (newVal === undefined || newVal === null) &&
      newData != null &&
      newData.total !== undefined &&
      newData.total !== null
    ) {
      const tn = Number(newData.total);
      if (Number.isFinite(tn)) newVal = tn;
    }

    // Handle Timestamps/Dates by converting to ISO strings for comparison
    if ((oldVal instanceof Date || (oldVal && oldVal.toDate instanceof Function)) && (newVal instanceof Date || (newVal && newVal.toDate instanceof Function))) {
        const oldD = coerceVoucherDateForStamp(oldVal);
        const newD = coerceVoucherDateForStamp(newVal);
        const oldTime = oldD ? oldD.toISOString() : "";
        const newTime = newD ? newD.toISOString() : "";
        if(oldTime !== newTime) {
             changes[key] = { from: oldData?.[key] ?? null, to: newData?.[key] ?? null };
        }
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { from: oldVal ?? null, to: newData?.[key] ?? null };
    }
  });
  return changes;
}


/**
 * Recursively remove undefined values from an object.
 * Firestore does not support `undefined`.
 */
function removeUndefined(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  } else if (obj !== null && typeof obj === 'object') {
    // This handles Firestore Timestamps and other objects without iterating their keys
    if (obj instanceof Date || (obj && 'toDate' in obj && typeof obj.toDate === 'function')) {
        return obj;
    }
    return Object.keys(obj).reduce((acc, key) => {
      const value = obj[key];
      if (value !== undefined) {
        // @ts-ignore
        acc[key] = removeUndefined(value);
      }
      return acc;
    }, {});
  }
  return obj;
}


/**
 * Save Voucher or Update Voucher with History
 * ✅ Edit हुँदा date change भए filePaths भएका files नयाँ date folder मा move हुन्छ
 * ✅ Move भएपछि voucher मा files (नयाँ नाम) update हुन्छ
 */
export async function saveVoucher(
  companyId: string,
  userId: string,
  voucherData: any,
  voucherId?: string | null
) {
  const cleanVoucherData = removeUndefined(voucherData);
  const voucherPath = `companies/${companyId}/vouchers`;
  const voucherRef = voucherId ? doc(firestore, voucherPath, voucherId) : null;

  // Convert date string back to Date object if it's a string
  if (typeof cleanVoucherData.date === "string") {
    cleanVoucherData.date = new Date(cleanVoucherData.date);
  }

  // Set top-level type for sale/purchase if lineItems exist
  if (cleanVoucherData.lineItems) {
    if (cleanVoucherData.type === "sale_service" || cleanVoucherData.type === "sale") {
      cleanVoucherData.type = "sale";
    } else if (cleanVoucherData.type === "purchase_service" || cleanVoucherData.type === "purchase") {
      cleanVoucherData.type = "purchase";
    } else if (!cleanVoucherData.type) {
      cleanVoucherData.type = "sale";
    }
  }

  // -------------------------
  // NEW voucher
  // -------------------------
  if (!voucherRef) {
    const docRef = await addDoc(collection(firestore, voucherPath), {
      ...cleanVoucherData,
      companyId,
      userId,
      createdAt: serverTimestamp(),
      history: [
        {
          changedAt: new Date(),
          changedBy: userId,
          changes: { created: { from: "N/A", to: "Created" } },
        },
      ],
    });
    const newId = docRef.id;

    // Unassigned → voucher: move file from unassigned folder to voucher folder, then update doc
    const uf = cleanVoucherData.unassignedFile as { id?: string; url?: string; path?: string; name?: string } | undefined;
    if (uf?.path && uf?.name && typeof uf.path === "string" && typeof uf.name === "string") {
      const voucherType = cleanVoucherData.type || "sale";
      const voucherDate = cleanVoucherData.date instanceof Date ? cleanVoucherData.date : new Date(cleanVoucherData.date);
      const companySnap = await getDoc(doc(firestore, "companies", companyId));
      const companyName = companySnap.data()?.name as string | undefined;
      const moveResult = await moveFilesToVoucherDate({
        companyId,
        companyName,
        voucherType,
        voucherDate,
        voucherId: newId,
        files: [{ oldPath: uf.path, fileName: uf.name }],
      });
      if (moveResult?.success && Array.isArray(moveResult.moved) && moveResult.moved.length > 0) {
        const m = moveResult.moved[0];
        const newUrl = m.url;
        const newPath = m.newPath;
        const fileUrls = (Array.isArray(cleanVoucherData.fileUrls) ? cleanVoucherData.fileUrls : []) as string[];
        const updatedFileUrls = fileUrls.map((u) => (u === uf.url ? newUrl : u));
        const files = [{ url: newUrl, storagePath: newPath, name: newPath.split("/").pop() || uf.name }];
        await updateDoc(docRef, {
          fileUrls: updatedFileUrls,
          files,
          unassignedFile: null,
        });
      }
    }

    return { id: newId };
  }

  // -------------------------
  // EDIT existing voucher
  // -------------------------
  const oldSnap = await getDoc(voucherRef);
  if (!oldSnap.exists()) throw new Error("Voucher not found");

  const oldData = oldSnap.data();

  // Don't pass server-generated fields back for diffing.
  const { createdAt, updatedAt, ...restOfOldData } = oldData as any;

  const changedFields = getChanges(restOfOldData, cleanVoucherData);

  // If no changes, do nothing
  if (Object.keys(changedFields).length === 0) {
    return { id: voucherId };
  }

  const oldDate = coerceVoucherDateForStamp((oldData as any)?.date);
  const newDate = coerceVoucherDateForStamp(cleanVoucherData?.date);
  const oldStamp = toIsoDateStamp(oldDate);
  const newStamp = toIsoDateStamp(newDate);

  // ✅ If date changed and voucher has filePaths, move them
  let movedFileObjects: any[] | null = null;
  
  if (oldDate && newDate && oldStamp && newStamp && oldStamp !== newStamp) {
    const voucherType = cleanVoucherData?.type || (oldData as any)?.type || "sale";
    const filesToMove = (oldData as any)?.files || [];

    if (Array.isArray(filesToMove) && filesToMove.length > 0) {
      const companySnap = await getDoc(doc(firestore, 'companies', companyId));
      const companyName = companySnap.data()?.name;
      const moveResult = await moveFilesToVoucherDate({
        companyId,
        companyName: companyName,
        voucherType,
        voucherDate: newDate,
        voucherId: voucherRef.id,
        files: filesToMove.map((f: any) => ({
          oldPath: f.storagePath,
          fileName: f.name,
        })),
      });

      if (moveResult?.success && Array.isArray(moveResult.moved)) {
        movedFileObjects = moveResult.moved.map((m: any) => ({
            url: m.url,
            storagePath: m.newPath,
            name: m.newPath.split('/').pop(),
        }));
      }
    }
  }

  const existingHistory = Array.isArray((oldData as any).history) ? (oldData as any).history : [];
  const { enabled: historyEnabled, limit: historyLimit, fullBehavior } = await getEffectiveHistorySettings(companyId);

  // When block_edit: disallow editing if history is already at limit
  if (historyEnabled && fullBehavior === 'block_edit' && existingHistory.length >= historyLimit) {
    throw new Error("Voucher history limit reached. Cannot edit until history is cleared or settings allow overwriting.");
  }

  const newEntry = {
    changedAt: new Date(),
    changedBy: userId,
    changes: changedFields,
  };
  const newHistory = historyEnabled ? [newEntry, ...existingHistory].slice(0, historyLimit) : existingHistory;

  // ✅ Update payload (filePaths only if moved)
  const updatePayload: any = {
    ...cleanVoucherData,
    lastEditedBy: userId,
    updatedAt: serverTimestamp(),
    history: newHistory,
  };

  if (movedFileObjects) {
    updatePayload.files = movedFileObjects;
  }

  // Preserve allocation fields set by "Link to Txns" (form does not own this field; use server value)
  const voucherType = cleanVoucherData?.type || (oldData as any)?.type;
  if (voucherType === "sale" || voucherType === "purchase") {
    const serverOB = (oldData as any)?.openingBalanceAllocated;
    if (serverOB !== undefined && serverOB !== null) {
      updatePayload.openingBalanceAllocated = Number(serverOB) || 0;
    }
  }

  // Update Firestore
  await updateDoc(voucherRef, updatePayload);

  // Return updated document
  return { id: voucherRef.id };
}

/**
 * Reset (clear) voucher history on server.
 * Deletes all history entries for the voucher. Use only when user has reset_voucher_history permission.
 */
export async function resetVoucherHistory(companyId: string, voucherId: string) {
  const voucherRef = doc(firestore, `companies/${companyId}/vouchers`, voucherId);
  const snap = await getDoc(voucherRef);
  if (!snap.exists()) throw new Error("Voucher not found");
  await updateDoc(voucherRef, { history: [] });
  return { success: true };
}

export async function createCompanyFromBackup(backupData: any, userId: string, userEmail: string): Promise<string> {
  if (!backupData.companyDetails || !backupData.companyDetails[0]) {
    throw new Error("Backup file is missing company details.");
  }

  const companyDetails = backupData.companyDetails[0];
  const newCompanyRef = doc(collection(firestore, "companies"));
  const newCompanyId = newCompanyRef.id;

  const { id: oldId, ownerId, ownerEmail, ...restCompanyDetails } = companyDetails;

  const newCompanyData = {
    ...restCompanyDetails,
    ownerId: userId,
    ownerEmail: userEmail,
    sharedWith: [],
    sharedWithEmails: ensureSuperAdminInSharedEmails([userEmail]),
    createdAt: serverTimestamp(),
    isDeleted: false,
  };

  await setDoc(newCompanyRef, newCompanyData);

  const collectionsToRestore = [
    "parties", "groups", "bank_accounts", "account_groups",
    "staff", "staff_groups", "items", "item_groups",
    "taxes", "tax_groups", "expense_accounts", "expense_groups", "vouchers",
  ];

  const safeTimestamp = (val: any): Timestamp | null => {
    if (!val) return null;
    if (val.seconds !== undefined && val.nanoseconds !== undefined) {
        return new Timestamp(val.seconds, val.nanoseconds);
    }
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  };

  let batch = writeBatch(firestore);
  let count = 0;

  for (const colName of collectionsToRestore) {
    const docs = backupData[colName];
    if (docs && Array.isArray(docs)) {
      for (const docData of docs) {
        const { id: originalId, ...data } = docData;
        
        const finalData = {
            ...data,
            companyId: newCompanyId, 
            isDeleted: data.isDeleted ?? false,
            date: safeTimestamp(data.date),
            openingBalanceDate: safeTimestamp(data.openingBalanceDate),
            createdAt: safeTimestamp(data.createdAt) || serverTimestamp(),
            amount: (data.amount === "" || data.amount === null || data.amount === undefined) ? (data.total || 0) : Number(data.amount),
        };

        const docRef = doc(firestore, `companies/${newCompanyId}/${colName}`, originalId);
        batch.set(docRef, removeUndefined(finalData));
        
        count++;
        if (count >= 450) {
          await batch.commit();
          batch = writeBatch(firestore);
          count = 0;
        }
      }
    }
  }

  await batch.commit();
  return newCompanyId;
}

