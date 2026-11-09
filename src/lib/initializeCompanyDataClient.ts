"use client";

import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { writeBatch } from "@/lib/writeGateway/firestoreMutationsInternal";
import { firestore } from "@/lib/plClientSession";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { writeEntity } from "@/lib/writeGateway";
import { updateCompanyRootFirestore } from "@/lib/writeGateway/companyRootFirestore";

const DEFAULT_VOUCHER_SETTINGS = {
  autoVoucherNumbering: {
    sale: true, sale_service: true, purchase: true, purchase_service: true,
    payment_in: true, payment_out: true, contra: true, direct_income: true,
    direct_expense: true, journal: true, note: true, add_salary: true, pay_salary: true, pay_emi: true,
  },
  allowVoucherNumberEditing: {
    sale: false, sale_service: false, purchase: false, purchase_service: false,
    payment_in: false, payment_out: false, contra: false, direct_income: false,
    direct_expense: false, journal: false, note: false, add_salary: false, pay_salary: false, pay_emi: false,
  },
  allowRateEditing: { sale: true, purchase: true },
  voucherPrefixes: {
    sale: ["Sale Inv"], sale_service: ["SER-"], purchase: ["PUR-"], purchase_service: ["SER-"],
    payment_in: ["RCPT-"], payment_out: ["PYMT-"], contra: ["CNTR-"], direct_income: ["DINC-"],
    direct_expense: ["DEXP-"], journal: ["JRNL-"], note: ["NOTE-"], add_salary: ["ADD-SAL-"], pay_salary: ["PYSAL-"],
    pay_emi: ["EMI-"],
  },
  enableVoucherPrefixSelection: {
    sale: false, sale_service: false, purchase: false, purchase_service: false,
    payment_in: false, payment_out: false, contra: false, direct_income: false,
    direct_expense: false, journal: false, note: false, add_salary: false, pay_salary: false, pay_emi: false,
  },
  enableLinkPaymentToTxns: false,
};

const groupsToCreate = [
  { col: "groups", id: "assets", name: "Assets", type: "Asset", isSystemReserved: true, isReportOnly: true },
  { col: "groups", id: "liabilities", name: "Liabilities", type: "Liability", isSystemReserved: true, isReportOnly: true },
  { col: "groups", id: "income", name: "Income", type: "Income", isSystemReserved: true, isReportOnly: true },
  { col: "groups", id: "expenses", name: "Expenses", type: "Expense", isSystemReserved: true, isReportOnly: true },
  { col: "groups", id: "equity", name: "Equity", type: "Equity", isSystemReserved: true, isReportOnly: true },
  { col: "groups", id: "sundry_debtors", name: "Sundry Debtors", type: "Asset", parentId: "assets", isSystemReserved: true, isReportOnly: false },
  { col: "groups", id: "sundry_creditors", name: "Sundry Creditors", type: "Liability", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },
  { col: "tax_groups", id: "duties_taxes", name: "Duties & Taxes", type: "Tax", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },
  { col: "account_groups", id: "bank_accounts_group", name: "Bank Accounts", type: "Bank", parentId: "assets", isSystemReserved: true, isReportOnly: false },
  { col: "account_groups", id: "cash_in_hand_group", name: "Cash-in-Hand", type: "Cash", parentId: "assets", isSystemReserved: true, isReportOnly: false },
  { col: "staff_groups", id: "loans_liabilities", name: "Loans & Liabilities", type: "Liability", parentId: "liabilities", isSystemReserved: true, isReportOnly: false },
  { col: "staff_groups", id: "staff_system", name: "Staff", type: "General", parentId: "loans_liabilities", isSystemReserved: true, isReportOnly: false },
  { col: "staff_groups", id: "ungrouped_staff", name: "Ungrouped", type: "General", parentId: "loans_liabilities", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
  { col: "tax_groups", id: "ungrouped_tax", name: "Ungrouped", type: "General", parentId: "duties_taxes", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
  { col: "account_groups", id: "ungrouped_account", name: "Ungrouped", type: "General", parentId: "bank_accounts_group", isSystemReserved: false, isReportOnly: false, isAutoUngrouped: true },
] as const;

const accountsToCreate = [
  { col: "parties", id: "owners_capital", name: "Owner's Capital", groupId: "equity", isSystemReserved: true },
  { col: "parties", id: "opening_balance_ledger", name: "Opening Balance", groupId: "equity", isSystemReserved: true, isSystemAccount: true },
  { col: "taxes", id: "vat_sales_tax", name: "VAT / Sales Tax", groupId: "duties_taxes", rate: 13, isSystemReserved: true },
] as const;

const itemGroupsToCreate = [
  { id: "stock_items", name: "Stock Items" },
  { id: "services", name: "Services" },
  { id: "ungrouped_item", name: "Ungrouped", isAutoUngrouped: true },
] as const;

/** Web + static fallback: ek hi Firestore batch — `initializeCompanyDataClient` ka purana behaviour. */
async function commitInitializeCompanyDataFirestoreBatch(companyId: string, userId: string): Promise<void> {
  const batch = writeBatch(firestore);
  const companyRef = doc(firestore, "companies", companyId);

  for (const g of groupsToCreate) {
    const ref = doc(firestore, `companies/${companyId}/${g.col}`, g.id);
    batch.set(ref, {
      name: g.name,
      type: g.type,
      parentId: (g as { parentId?: string }).parentId ?? null,
      companyId,
      ownerId: userId,
      isDeleted: false,
      isSystemReserved: g.isSystemReserved ?? false,
      isReportOnly: (g as { isReportOnly?: boolean }).isReportOnly ?? false,
      isAutoUngrouped: (g as { isAutoUngrouped?: boolean }).isAutoUngrouped ?? false,
      createdAt: serverTimestamp(),
    });
  }

  for (const acc of accountsToCreate) {
    const ref = doc(firestore, `companies/${companyId}/${acc.col}`, acc.id);
    batch.set(ref, {
      name: acc.name,
      groupId: acc.groupId,
      accountType: (acc as { accountType?: string }).accountType ?? null,
      type: (acc as { type?: string }).type ?? null,
      defaultVoucherTypes: (acc as { defaultVoucherTypes?: string[] }).defaultVoucherTypes ?? [],
      rate: (acc as { rate?: number }).rate ?? 0,
      openingBalance: 0,
      openingBalanceDate: null,
      companyId,
      ownerId: userId,
      isDeleted: false,
      isSystemReserved: acc.isSystemReserved ?? false,
      isSystemAccount: (acc as { isSystemAccount?: boolean }).isSystemAccount ?? false,
      createdAt: serverTimestamp(),
    });
  }

  for (const ig of itemGroupsToCreate) {
    const ref = doc(firestore, `companies/${companyId}/item_groups`, ig.id);
    batch.set(ref, {
      name: ig.name,
      companyId,
      ownerId: userId,
      isDeleted: false,
      isSystemReserved: (ig as { isAutoUngrouped?: boolean }).isAutoUngrouped ? false : true,
      isAutoUngrouped: (ig as { isAutoUngrouped?: boolean }).isAutoUngrouped ?? false,
      debit: 0,
      credit: 0,
      balance: 0,
      createdAt: serverTimestamp(),
    });
  }

  batch.update(companyRef, { ...DEFAULT_VOUCHER_SETTINGS });
  await batch.commit();
}

/** Static + SQLite registry: subcollections `writeEntity` (SQLite + outbox); root voucher defaults Firestore patch (company_docs table nahi). */
async function commitInitializeCompanyDataStaticLedger(companyId: string, userId: string): Promise<void> {
  const createdAt = Date.now();
  for (const g of groupsToCreate) {
    const r = await writeEntity({
      companyId,
      collectionName: g.col,
      docId: g.id,
      operation: "create",
      data: {
        name: g.name,
        type: g.type,
        parentId: (g as { parentId?: string }).parentId ?? null,
        companyId,
        ownerId: userId,
        isDeleted: false,
        isSystemReserved: g.isSystemReserved ?? false,
        isReportOnly: (g as { isReportOnly?: boolean }).isReportOnly ?? false,
        isAutoUngrouped: (g as { isAutoUngrouped?: boolean }).isAutoUngrouped ?? false,
        createdAt,
      },
    });
    if (!r.ok) throw new Error("error" in r ? r.error : `init group ${g.col}/${g.id}`);
  }
  for (const acc of accountsToCreate) {
    const r = await writeEntity({
      companyId,
      collectionName: acc.col,
      docId: acc.id,
      operation: "create",
      data: {
        name: acc.name,
        groupId: acc.groupId,
        accountType: (acc as { accountType?: string }).accountType ?? null,
        type: (acc as { type?: string }).type ?? null,
        defaultVoucherTypes: (acc as { defaultVoucherTypes?: string[] }).defaultVoucherTypes ?? [],
        rate: (acc as { rate?: number }).rate ?? 0,
        openingBalance: 0,
        openingBalanceDate: null,
        companyId,
        ownerId: userId,
        isDeleted: false,
        isSystemReserved: acc.isSystemReserved ?? false,
        isSystemAccount: (acc as { isSystemAccount?: boolean }).isSystemAccount ?? false,
        createdAt,
      },
    });
    if (!r.ok) throw new Error("error" in r ? r.error : `init ${acc.col}/${acc.id}`);
  }
  for (const ig of itemGroupsToCreate) {
    const r = await writeEntity({
      companyId,
      collectionName: "item_groups",
      docId: ig.id,
      operation: "create",
      data: {
        name: ig.name,
        companyId,
        ownerId: userId,
        isDeleted: false,
        isSystemReserved: (ig as { isAutoUngrouped?: boolean }).isAutoUngrouped ? false : true,
        isAutoUngrouped: (ig as { isAutoUngrouped?: boolean }).isAutoUngrouped ?? false,
        debit: 0,
        credit: 0,
        balance: 0,
        createdAt,
      },
    });
    if (!r.ok) throw new Error("error" in r ? r.error : `init item_groups/${ig.id}`);
  }
  await updateCompanyRootFirestore(companyId, DEFAULT_VOUCHER_SETTINGS as Record<string, unknown>);
}

/**
 * Client-only: Creates default groups, accounts, and company settings for a new company.
 * Must run in browser so Firestore uses the signed-in user's auth (server action has no auth).
 */
export async function initializeCompanyDataClient(companyId: string, userId: string): Promise<void> {
  if (isStaticAppBuild()) {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    // Registry row ke bina `writeEntity` remote branch par chala jata — pehli cloud create ke liye purana batch safe fallback.
    if (reg) {
      await commitInitializeCompanyDataStaticLedger(companyId, userId);
      return;
    }
    await commitInitializeCompanyDataFirestoreBatch(companyId, userId);
    return;
  }
  await commitInitializeCompanyDataFirestoreBatch(companyId, userId);
}
