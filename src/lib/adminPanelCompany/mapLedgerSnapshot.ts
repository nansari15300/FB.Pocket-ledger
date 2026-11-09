import type admin from "@/lib/server/pbAdminTypes";



function msFrom(data: Record<string, unknown>): number {

  const posted = data.postedAt as admin.firestore.Timestamp | undefined;

  const created = data.createdAt as admin.firestore.Timestamp | undefined;

  return posted?.toMillis?.() ?? created?.toMillis?.() ?? Date.now();

}



export function mapAdminPanelPartyToLedgerDoc(id: string, data: Record<string, unknown>) {

  return {

    id,

    name: String(data.name ?? "Subscriber"),

    email: String(data.email ?? ""),

    phone: String(data.phone ?? ""),

    address: String(data.address ?? ""),

    openingBalance: Number(data.openingBalance) || 0,

    type: String(data.type ?? "subscriber"),

    isApproved: true,

  };

}



export function mapAdminPanelBankToLedgerDoc(id: string, data: Record<string, unknown>) {

  const accountType = String(data.accountType ?? "Bank");

  return {

    id,

    name: String(data.name ?? "Bank"),

    bankName: String(data.bankName ?? ""),

    accountNumber: String(data.accountNumber ?? ""),

    accountType: accountType === "Cash" ? "Cash" : "Bank",

    openingBalance: Number(data.openingBalance) || 0,

  };

}



export function mapAdminPanelItemToLedgerDoc(id: string, data: Record<string, unknown>) {

  return {

    id,

    name: String(data.name ?? "Service"),

    type: String(data.type ?? "service"),

    salePrice: Number(data.salePrice) || 0,

    purchasePrice: Number(data.purchasePrice) || 0,

    salePriceUnit: String(data.salePriceUnit ?? ""),

    purchasePriceUnit: String(data.purchasePriceUnit ?? ""),

    groupId: String(data.groupId ?? ""),

    saleTaxId: String(data.saleTaxId ?? ""),

    purchaseTaxId: String(data.purchaseTaxId ?? ""),

    systemGenerated: data.systemGenerated === true,

    catalogSource: data.catalogSource != null ? String(data.catalogSource) : undefined,

    openingBalance: Number(data.openingBalance) || 0,

    stockQty: 0,

    isApproved: true,

  };

}



export function mapAdminPanelStaffToLedgerDoc(id: string, data: Record<string, unknown>) {

  return {

    id,

    name: String(data.name ?? "Staff"),

    email: String(data.email ?? ""),

    phone: String(data.phone ?? ""),

    role: String(data.role ?? "accountant"),

    salary: Number(data.salary) || 0,

  };

}



export function mapAdminPanelTaxToLedgerDoc(id: string, data: Record<string, unknown>) {

  return {

    id,

    name: String(data.name ?? "Tax"),

    rate: Number(data.rate) || 0,

  };

}



export function mapAdminPanelExpenseToLedgerDoc(id: string, data: Record<string, unknown>) {

  return {

    id,

    name: String(data.name ?? "Expense"),

    type: "expense",

  };

}



export function mapAdminPanelVoucherToLedgerDoc(id: string, data: Record<string, unknown>) {

  const amount = Number(data.amount) || 0;

  const voucherType = String(data.voucherType ?? "journal");

  const type =

    voucherType === "sale"

      ? "sale"

      : voucherType === "purchase"

        ? "purchase"

        : voucherType === "payment_out"

          ? "payment_out"

          : voucherType === "payment_in"

            ? "payment_in"

            : voucherType === "add_salary"

              ? "salary"

              : "journal";



  const partyId = String(data.partyId ?? "").trim();

  const bankId = String(data.bankAccountId ?? data.accountId ?? "").trim();

  const dateMs = msFrom(data);

  const narration = String(data.narration ?? "");

  const salesAmount = Number(data.salesAmount) || amount;

  const taxAmount = Number(data.taxAmount) || 0;

  const taxLedgerId = String(data.taxAccountId ?? data.taxLedgerAccountId ?? "tax-payable").trim();

  const salesAccountId = String(data.salesAccountId ?? "subscription-sales").trim();



  const entries: Array<Record<string, unknown>> = [];

  if (type === "sale" && partyId) {

    entries.push({ accountId: partyId, debit: amount, credit: 0 });

    entries.push({ accountId: salesAccountId, debit: 0, credit: salesAmount });

    if (taxAmount > 0) {

      entries.push({ accountId: taxLedgerId, debit: 0, credit: taxAmount });

    }

  } else if (type === "payment_in" && partyId) {

    entries.push({ accountId: bankId || "gateway-clearing", debit: amount, credit: 0 });

    entries.push({ accountId: partyId, debit: 0, credit: amount });

  } else if (type === "payment_out" && partyId) {

    entries.push({ accountId: partyId, debit: amount, credit: 0 });

    entries.push({ accountId: bankId || "gateway-clearing", debit: 0, credit: amount });

  } else {

    entries.push({ accountId: String(data.debitAccount ?? "agent-commission-expense"), debit: amount, credit: 0 });

    entries.push({ accountId: String(data.creditAccount ?? "agent-commission-payable"), debit: 0, credit: amount });

  }



  const bankAccountId = type === "payment_in" || type === "payment_out" ? bankId || undefined : undefined;

  const accountIdForBank =

    type === "payment_in" || type === "payment_out" ? bankAccountId : undefined;



  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : undefined;

  const allocations = Array.isArray(data.allocations) ? data.allocations : undefined;



  const voucherPrefix =
    type === "payment_in" ? "RCPT" : type === "payment_out" ? "PYMT" : "APC";

  return {

    id,

    type,

    voucherNumber: `${voucherPrefix}-${id.slice(-8).toUpperCase()}`,

    date: new Date(dateMs).toISOString().slice(0, 10),

    dateMs,

    amount,

    total: Number(data.total) || amount,

    subTotal: Number(data.subTotal) || salesAmount,

    salesAmount,

    taxAmount,

    narration,

    partyId,

    partyName: String(data.partyName ?? ""),

    accountId: accountIdForBank,

    bankAccountId,

    salesAccountId: type === "sale" ? salesAccountId : undefined,

    taxAccountId: taxAmount > 0 ? taxLedgerId : undefined,

    paymentStatus: data.paymentStatus != null ? String(data.paymentStatus) : undefined,

    allocations,

    lineItems,

    isApproved: true,

    locked: data.locked === true,

    systemGenerated: data.systemGenerated === true,

    kind: data.kind != null ? String(data.kind) : undefined,

    userDisplayName: data.userDisplayName != null ? String(data.userDisplayName) : undefined,

    planId: data.planId != null ? String(data.planId) : undefined,

    subscriptionTermKey:
      data.subscriptionTermKey != null ? String(data.subscriptionTermKey) : undefined,

    entries,

  };

}


