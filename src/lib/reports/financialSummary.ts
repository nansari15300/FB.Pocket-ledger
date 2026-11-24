/* eslint-disable @typescript-eslint/no-explicit-any */
import { endOfDay, startOfDay, subDays, startOfMonth, format } from "date-fns";
import {
  computeReceivablesPayablesFinancialSummary,
  safeToDateRp,
  type ReceivablesPayablesFinancialSummary,
} from "@/lib/receivablesPayablesFinancialSummary";
import { computeRpLedgerAlignedBalance } from "@/lib/receivablesPayablesLedgerAmounts";
import { getTransactionAmounts as getLedgerTransactionAmounts } from "@/hooks/use-transactions";
import type { FinancialSummaryDateRange } from "@/lib/reports/financialSummaryPresets";
import {
  adToBs,
  addBsMonths,
  bsToAd,
  getBSMonthDays,
  NEPALI_MONTHS,
} from "@/lib/bs-date";

export type FinancialSummaryMetric = {
  total: number;
  previous?: number;
};

export type FinancialSummaryPlRow = {
  id: string;
  name: string;
  amount: number;
  level: number;
  isGroup: boolean;
  isTotal?: boolean;
  branch?: "income" | "expense";
  subRows: FinancialSummaryPlRow[];
};

export type FinancialSummaryMonthlyPoint = {
  key: string;
  label: string;
  revenue: number;
  expense: number;
  netProfit: number;
};

export type FinancialSummary = {
  period: FinancialSummaryDateRange;
  comparisonPeriod?: FinancialSummaryDateRange;
  hasData: boolean;
  revenue: FinancialSummaryMetric;
  directCost: FinancialSummaryMetric;
  grossProfit: FinancialSummaryMetric;
  operatingExpenses: FinancialSummaryMetric;
  operatingProfit: FinancialSummaryMetric;
  financeCost: FinancialSummaryMetric;
  netProfit: FinancialSummaryMetric;
  cashAndBank: FinancialSummaryMetric;
  receivable: FinancialSummaryMetric;
  payable: FinancialSummaryMetric;
  profitLossRows: FinancialSummaryPlRow[];
  profitLossIncomeRows: FinancialSummaryPlRow[];
  profitLossExpenseRows: FinancialSummaryPlRow[];
  assets: {
    cashAndBank: number;
    receivables: number;
    inventory: number;
    other: number;
    total: number;
  };
  liabilities: {
    payables: number;
    loans: number;
    other: number;
    total: number;
  };
  equity: {
    capital: number;
    retainedEarnings: number;
    currentProfit: number;
    total: number;
  };
  workingCapital: {
    cashAndBank: number;
    receivables: number;
    inventory: number;
    payables: number;
    net: number;
  };
  isBalanced: boolean;
  balanceDifference: number;
  monthlyChart: FinancialSummaryMonthlyPoint[];
};

export type FinancialSummaryInput = {
  vouchers: any[];
  processedParties: any[];
  processedStaff: any[];
  processedTaxes: any[];
  processedAccounts: any[];
  processedExpenseAccounts: any[];
  processedExpenseGroups: any[];
  processedItems: any[];
  period: FinancialSummaryDateRange;
  comparisonPeriod?: FinancialSummaryDateRange;
  dateSystem?: "AD" | "BS" | "Both";
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const INCOME_ROOT_IDS = new Set([
  "income",
  "direct_income",
  "indirect_income",
  "sales_account",
]);

const DIRECT_COST_ROOT_IDS = new Set([
  "direct_expense",
  "purchase_account",
]);

const NOMINAL_GROUP_IDS = new Set([
  "income",
  "expenses",
  "direct_income",
  "indirect_income",
  "direct_expense",
  "indirect_expense",
]);

function vouchersOnOrBefore(vouchers: any[], asOf: Date): any[] {
  const cutoff = endOfDay(asOf);
  return vouchers.filter((v) => {
    const d = safeToDateRp(v.date);
    return d && d <= cutoff;
  });
}

function balanceAsOf(
  openingBalance: number,
  vouchers: any[],
  entityId: string,
  context: "account" | "party" | "staff" | "tax" | "expense",
  asOf: Date,
  processedTaxes: any[] = []
): number {
  const filtered = vouchersOnOrBefore(vouchers, asOf);
  return computeRpLedgerAlignedBalance(
    openingBalance,
    filtered,
    entityId,
    context,
    processedTaxes
  );
}

/** Authoritative ledger balance as of a date (opening balance + vouchers on/before asOf). */
export function ledgerBalanceAsOf(
  openingBalance: number,
  vouchers: any[],
  entityId: string,
  context: "account" | "party" | "staff" | "tax" | "expense",
  asOf: Date,
  processedTaxes: any[] = []
): number {
  return balanceAsOf(openingBalance, vouchers, entityId, context, asOf, processedTaxes);
}

/** Ledger balance using all supplied vouchers (no as-of cutoff). */
export function ledgerBalanceFromVouchers(
  openingBalance: number,
  vouchers: any[],
  entityId: string,
  context: "account" | "party" | "staff" | "tax" | "expense",
  processedTaxes: any[] = []
): number {
  return computeRpLedgerAlignedBalance(
    openingBalance,
    vouchers,
    entityId,
    context,
    processedTaxes
  );
}

function periodExpenseAccountMovement(
  account: any,
  vouchers: any[],
  period: FinancialSummaryDateRange,
  isIncome: boolean,
  processedTaxes: any[]
): number {
  const ob = Number(account.openingBalance) || 0;
  const id = String(account.id || "");
  const beforeStart = subDays(startOfDay(period.from), 1);
  const balanceBefore = balanceAsOf(ob, vouchers, id, "expense", beforeStart, processedTaxes);
  const balanceAfter = balanceAsOf(ob, vouchers, id, "expense", period.to, processedTaxes);
  if (isIncome) return round2(balanceBefore - balanceAfter);
  return round2(balanceAfter - balanceBefore);
}

function buildGroupMaps(groups: ReadonlyArray<any>) {
  const byId = new Map<string, any>();
  for (const g of groups) {
    if (g?.id) byId.set(g.id, g);
  }

  const incomeGroupIds = new Set<string>();
  const expenseGroupIds = new Set<string>();

  const resolveRoot = (groupId: string | undefined): string | undefined => {
    if (!groupId) return undefined;
    let current = groupId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      if (INCOME_ROOT_IDS.has(current)) return "income";
      if (current === "expenses" || DIRECT_COST_ROOT_IDS.has(current)) {
        if (current === "direct_expense" || current === "purchase_account") return "direct_expense";
        if (current === "indirect_expense") return "indirect_expense";
        return "expenses";
      }
      const g = byId.get(current);
      if (!g?.parentId) break;
      current = String(g.parentId);
    }
    return undefined;
  };

  for (const g of groups) {
    const root = resolveRoot(g.id);
    if (root === "income") {
      incomeGroupIds.add(g.id);
    }
    if (root === "expenses" || root === "direct_expense" || root === "indirect_expense") {
      expenseGroupIds.add(g.id);
    }
  }

  return { byId, incomeGroupIds, expenseGroupIds, resolveRoot };
}

function isFinanceAccount(name: string, groupName: string): boolean {
  const text = `${name} ${groupName}`.toLowerCase();
  return (
    text.includes("interest") ||
    text.includes("finance") ||
    text.includes("bank charge") ||
    text.includes("loan charge")
  );
}

function isLoanEntity(name: string, groupName: string, groupId: string): boolean {
  const text = `${name} ${groupName} ${groupId}`.toLowerCase();
  return text.includes("loan");
}

function isNominalGroupId(groupId: string | undefined, groups: any[]): boolean {
  if (!groupId) return false;
  if (NOMINAL_GROUP_IDS.has(groupId)) return true;
  const g = groups.find((x) => x.id === groupId);
  const name = String(g?.name || "").toLowerCase();
  return (
    name.includes("income") ||
    name.includes("expense") ||
    name.includes("sales") ||
    name.includes("purchase")
  );
}

function classifyExpenseAccount(
  acc: any,
  incomeGroupIds: Set<string>,
  expenseGroupIds: Set<string>
): "income" | "direct_cost" | "operating" | "finance" | "other" {
  if (acc.id === "sales_account" || (acc.groupId && incomeGroupIds.has(acc.groupId))) {
    return "income";
  }
  const groupId = String(acc.groupId || "");
  const groupName = String(
    acc.groupName || acc.parentGroupName || ""
  ).toLowerCase();
  const name = String(acc.name || "").toLowerCase();

  if (acc.id === "purchase_account" || groupId === "direct_expense" || DIRECT_COST_ROOT_IDS.has(groupId)) {
    return "direct_cost";
  }
  if (isFinanceAccount(name, groupName)) return "finance";
  if (
    acc.id === "purchase_account" ||
    expenseGroupIds.has(groupId) ||
    acc.type === "Expense" ||
    acc.type === "Salary"
  ) {
    return "operating";
  }
  if ((acc.balance || 0) < 0) return "income";
  return "operating";
}

function sumRpSide(rows: { balance: number }[], absolute = false): number {
  return round2(
    rows.reduce((s, r) => s + (absolute ? Math.abs(Number(r.balance) || 0) : Number(r.balance) || 0), 0)
  );
}

function computeCashAndBankAsOf(
  processedAccounts: any[],
  vouchers: any[],
  processedItems: any[],
  processedTaxes: any[],
  asOf: Date
): number {
  const cutoff = endOfDay(asOf);
  let total = 0;
  for (const acc of processedAccounts) {
    const ob = Number(acc.openingBalance) || 0;
    let balance = ob;
    const accountObDate = safeToDateRp((acc as any).openingBalanceDate);
    const periodTx = vouchers.filter((v) => {
      const txDate = safeToDateRp(v.date);
      if (accountObDate && txDate && txDate < accountObDate) return false;
      return txDate && txDate <= cutoff;
    });
    for (const v of periodTx) {
      const { debit, credit } = getLedgerTransactionAmounts(
        v,
        "account",
        acc,
        "amount",
        processedItems,
        processedTaxes
      );
      balance += (Number(debit) || 0) - (Number(credit) || 0);
    }
    if (acc.accountType === "Cash" || acc.accountType === "Bank") {
      total += balance;
    }
  }
  return round2(total);
}

function computeInventoryValue(processedItems: any[]): number {
  return round2(
    processedItems.reduce((sum, item) => {
      if (item.type !== "item" && item.type !== "finished_good") return sum;
      const qty = Number(item.stockQty) || 0;
      const rate = Number(item.purchasePrice) || 0;
      return sum + qty * rate;
    }, 0)
  );
}

const EXPENSE_ROOT_IDS = new Set([
  "expenses",
  "direct_expense",
  "indirect_expense",
  "purchase_account",
]);

function resolvePlRowBranch(
  item: { id: string; isGroup: boolean; parentId?: string },
  incomeGroupIds: Set<string>
): "income" | "expense" {
  if (item.id === "sales_account" || INCOME_ROOT_IDS.has(item.id) || incomeGroupIds.has(item.id)) {
    return "income";
  }
  if (EXPENSE_ROOT_IDS.has(item.id)) return "expense";
  if (!item.isGroup && item.parentId && incomeGroupIds.has(String(item.parentId))) {
    return "income";
  }
  return "expense";
}

function promoteSystemBranchRoots(rows: FinancialSummaryPlRow[]): FinancialSummaryPlRow[] {
  const promoted: FinancialSummaryPlRow[] = [];
  for (const row of rows) {
    if (row.id === "income" || row.id === "expenses") {
      promoted.push(...row.subRows);
      continue;
    }
    promoted.push(row);
  }
  return promoted.filter((row) => Math.abs(row.amount) > 0.005 || row.subRows.length > 0);
}

function splitProfitLossRows(rows: FinancialSummaryPlRow[]): {
  income: FinancialSummaryPlRow[];
  expense: FinancialSummaryPlRow[];
} {
  const income = promoteSystemBranchRoots(rows.filter((row) => row.branch === "income"));
  const expense = promoteSystemBranchRoots(rows.filter((row) => row.branch === "expense"));
  return { income, expense };
}

function buildProfitLossHierarchy(
  processedExpenseAccounts: any[],
  processedExpenseGroups: any[],
  vouchers: any[],
  period: FinancialSummaryDateRange,
  processedTaxes: any[]
): FinancialSummaryPlRow[] {
  const { incomeGroupIds, expenseGroupIds } = buildGroupMaps(processedExpenseGroups);

  type Node = FinancialSummaryPlRow & { parentId?: string };
  const accountRows: Node[] = [];

  for (const acc of processedExpenseAccounts) {
    const bucket = classifyExpenseAccount(acc, incomeGroupIds, expenseGroupIds);
    const isIncome = bucket === "income";
    const amount = periodExpenseAccountMovement(acc, vouchers, period, isIncome, processedTaxes);
    if (Math.abs(amount) <= 0.005) continue;

    accountRows.push({
      id: String(acc.id),
      name: String(acc.name || acc.accountName || "Account"),
      amount: Math.abs(amount),
      level: 0,
      isGroup: false,
      branch: isIncome ? "income" : "expense",
      parentId: acc.groupId,
      subRows: [],
    });
  }

  const groupNodes: Node[] = processedExpenseGroups.map((g) => ({
    id: String(g.id),
    name: String(g.name || g.id),
    amount: 0,
    level: 0,
    isGroup: true,
    branch: resolvePlRowBranch({ id: String(g.id), isGroup: true, parentId: g.parentId }, incomeGroupIds),
    parentId: g.parentId,
    subRows: [],
  }));

  const itemsMap = new Map<string, Node>();
  for (const g of groupNodes) itemsMap.set(g.id, { ...g, subRows: [] });
  for (const a of accountRows) itemsMap.set(a.id, { ...a, subRows: [] });

  const roots: Node[] = [];
  itemsMap.forEach((item) => {
    const parentId = item.parentId;
    if (parentId && itemsMap.has(String(parentId))) {
      itemsMap.get(String(parentId))!.subRows.push(item);
    } else {
      roots.push(item);
    }
  });

  const rollUp = (item: Node, depth: number): number => {
    item.level = depth;
    if (!item.isGroup) return item.amount;
    let total = 0;
    for (const sub of item.subRows) total += rollUp(sub, depth + 1);
    item.amount = round2(total);
    return item.amount;
  };

  roots.forEach((r) => rollUp(r, 0));

  const prune = (items: Node[]): FinancialSummaryPlRow[] =>
    items
      .map((item) => ({
        ...item,
        subRows: item.isGroup ? prune(item.subRows as Node[]) : [],
      }))
      .filter((item) => !item.isGroup || item.subRows.length > 0 || item.amount > 0.005);

  return prune(roots);
}

function aggregatePlTotals(
  processedExpenseAccounts: any[],
  processedExpenseGroups: any[],
  vouchers: any[],
  period: FinancialSummaryDateRange,
  processedTaxes: any[]
) {
  const { incomeGroupIds, expenseGroupIds } = buildGroupMaps(processedExpenseGroups);

  let revenue = 0;
  let directCost = 0;
  let operatingExpenses = 0;
  let financeCost = 0;

  for (const acc of processedExpenseAccounts) {
    const bucket = classifyExpenseAccount(acc, incomeGroupIds, expenseGroupIds);
    const isIncome = bucket === "income";
    const movement = periodExpenseAccountMovement(acc, vouchers, period, isIncome, processedTaxes);
    if (Math.abs(movement) <= 0.005) continue;

    switch (bucket) {
      case "income":
        revenue += movement;
        break;
      case "direct_cost":
        directCost += movement;
        break;
      case "finance":
        financeCost += movement;
        break;
      case "operating":
      case "other":
        operatingExpenses += movement;
        break;
    }
  }

  revenue = round2(revenue);
  directCost = round2(directCost);
  operatingExpenses = round2(operatingExpenses);
  financeCost = round2(financeCost);
  const grossProfit = round2(revenue - directCost);
  const operatingProfit = round2(grossProfit - operatingExpenses);
  const netProfit = round2(operatingProfit - financeCost);

  return { revenue, directCost, grossProfit, operatingExpenses, operatingProfit, financeCost, netProfit };
}

function computeRpSnapshot(
  input: Omit<FinancialSummaryInput, "period" | "comparisonPeriod">,
  asOf: Date
): ReceivablesPayablesFinancialSummary {
  return computeReceivablesPayablesFinancialSummary({
    vouchers: input.vouchers,
    processedParties: input.processedParties,
    processedStaff: input.processedStaff,
    processedTaxes: input.processedTaxes,
    processedAccounts: input.processedAccounts,
    processedExpenseAccounts: input.processedExpenseAccounts,
    receivablesDateRange: { from: undefined, to: asOf },
  });
}

function computeReceivableKpi(rp: ReceivablesPayablesFinancialSummary): number {
  const notOb = (r: { party: string }) => r.party !== "Opening Balance";
  return round2(
    sumRpSide(rp.receivables.parties.filter(notOb)) +
      sumRpSide(rp.receivables.staff.filter(notOb)) +
      sumRpSide(rp.receivables.taxes.filter(notOb))
  );
}

function computePayableKpi(rp: ReceivablesPayablesFinancialSummary): number {
  const notOb = (r: { party: string }) => r.party !== "Opening Balance";
  return round2(
    sumRpSide(rp.payables.parties.filter(notOb), true) +
      sumRpSide(rp.payables.staff.filter(notOb), true) +
      sumRpSide(rp.payables.taxes.filter(notOb), true)
  );
}

function buildBalanceSheetSnapshot(
  input: Omit<FinancialSummaryInput, "period" | "comparisonPeriod">,
  asOf: Date,
  periodNetProfit: number
): Pick<
  FinancialSummary,
  "assets" | "liabilities" | "equity" | "isBalanced" | "balanceDifference"
> {
  const {
    vouchers,
    processedParties,
    processedTaxes,
    processedAccounts,
    processedExpenseGroups,
    processedItems,
  } = input;

  const cashAndBank = computeCashAndBankAsOf(
    processedAccounts,
    vouchers,
    processedItems,
    processedTaxes,
    asOf
  );

  const rp = computeRpSnapshot(input, asOf);
  const receivables = computeReceivableKpi(rp);
  const payables = computePayableKpi(rp);
  const inventory = computeInventoryValue(processedItems);

  let loans = 0;
  let capital = 0;
  const retained = 0;
  let otherAssets = 0;
  let otherLiabilities = 0;

  const partyGroupName = (groupId: string | undefined) =>
    processedParties.find((p) => p.groupId === groupId)?.groupName ||
    processedExpenseGroups.find((g) => g.id === groupId)?.name ||
    "";

  for (const p of processedParties) {
    if (p.id === "opening_balance_ledger") continue;
    if (isNominalGroupId(p.groupId, processedExpenseGroups)) continue;
    const ob = Number(p.openingBalance) || 0;
    const bal = balanceAsOf(ob, vouchers, String(p.id), "party", asOf, processedTaxes);
    const gName = String(p.groupName || partyGroupName(p.groupId) || "");
    if (p.groupId === "equity" || gName.toLowerCase().includes("capital")) {
      capital += Math.abs(bal);
      continue;
    }
    if (isLoanEntity(String(p.name), gName, String(p.groupId || ""))) {
      if (bal < 0) loans += Math.abs(bal);
      else if (bal > 0) otherAssets += bal;
      continue;
    }
    if (bal > 0) otherAssets += bal;
    else if (bal < 0) otherLiabilities += Math.abs(bal);
  }

  for (const acc of processedAccounts) {
    if (acc.accountType === "Cash" || acc.accountType === "Bank") continue;
    const ob = Number(acc.openingBalance) || 0;
    const bal = balanceAsOf(ob, vouchers, String(acc.id), "account", asOf, processedTaxes);
    const gName = String(acc.groupName || "");
    if (isLoanEntity(String(acc.accountName || acc.name), gName, String(acc.groupId || ""))) {
      if (bal < 0) loans += Math.abs(bal);
      else if (bal > 0) otherAssets += bal;
      continue;
    }
    if (bal > 0) otherAssets += bal;
    else if (bal < 0) otherLiabilities += Math.abs(bal);
  }

  const assetsTotal = round2(cashAndBank + receivables + inventory + otherAssets);
  const liabilitiesTotal = round2(payables + loans + otherLiabilities);
  const currentProfit = periodNetProfit;
  const equityTotal = round2(capital + retained + currentProfit);
  const liabEquityTotal = round2(liabilitiesTotal + equityTotal);
  const balanceDifference = round2(assetsTotal - liabEquityTotal);

  return {
    assets: {
      cashAndBank,
      receivables,
      inventory,
      other: round2(otherAssets),
      total: assetsTotal,
    },
    liabilities: {
      payables,
      loans: round2(loans),
      other: round2(otherLiabilities),
      total: liabilitiesTotal,
    },
    equity: {
      capital: round2(capital),
      retainedEarnings: round2(retained),
      currentProfit,
      total: equityTotal,
    },
    isBalanced: Math.abs(balanceDifference) < 0.02,
    balanceDifference,
  };
}

function clipToPeriod(
  from: Date,
  to: Date,
  period: FinancialSummaryDateRange
): FinancialSummaryDateRange | null {
  const clippedFrom = from < period.from ? period.from : from;
  const clippedTo = to > period.to ? period.to : to;
  if (clippedFrom > clippedTo) return null;
  return { from: clippedFrom, to: clippedTo };
}

function monthlyPointFromRange(
  key: string,
  label: string,
  processedExpenseAccounts: any[],
  processedExpenseGroups: any[],
  vouchers: any[],
  monthRange: FinancialSummaryDateRange,
  processedTaxes: any[]
): FinancialSummaryMonthlyPoint {
  const totals = aggregatePlTotals(
    processedExpenseAccounts,
    processedExpenseGroups,
    vouchers,
    monthRange,
    processedTaxes
  );
  return {
    key,
    label,
    revenue: totals.revenue,
    expense: round2(totals.directCost + totals.operatingExpenses + totals.financeCost),
    netProfit: totals.netProfit,
  };
}

function bsMonthAdBounds(y: number, m: number): { from: Date; to: Date } {
  const days = getBSMonthDays(y)[m - 1] || 30;
  return {
    from: startOfDay(bsToAd({ y, m, d: 1 })),
    to: endOfDay(bsToAd({ y, m, d: days })),
  };
}

function bsMonthChartLabel(y: number, m: number, dateSystem: "BS" | "Both"): string {
  const fullBs = NEPALI_MONTHS[m - 1] ?? "";
  if (dateSystem === "BS") return fullBs;
  const adStart = bsToAd({ y, m, d: 1 });
  return `${fullBs} / ${format(adStart, "MMMM")}`;
}

function buildMonthlyChart(
  processedExpenseAccounts: any[],
  processedExpenseGroups: any[],
  vouchers: any[],
  period: FinancialSummaryDateRange,
  processedTaxes: any[],
  dateSystem: "AD" | "BS" | "Both" = "AD"
): FinancialSummaryMonthlyPoint[] {
  const useBsMonths = dateSystem === "BS" || dateSystem === "Both";
  if (useBsMonths) {
    const startBs = adToBs(period.from);
    const endBs = adToBs(period.to);
    const points: FinancialSummaryMonthlyPoint[] = [];
    let y = startBs.y;
    let m = startBs.m;
    const endIdx = endBs.y * 12 + endBs.m - 1;
    let guard = 0;
    while (y * 12 + m - 1 <= endIdx && guard < 36) {
      const bounds = bsMonthAdBounds(y, m);
      const monthRange = clipToPeriod(bounds.from, bounds.to, period);
      if (monthRange) {
        points.push(
          monthlyPointFromRange(
            `${y}-${String(m).padStart(2, "0")}`,
            bsMonthChartLabel(y, m, dateSystem),
            processedExpenseAccounts,
            processedExpenseGroups,
            vouchers,
            monthRange,
            processedTaxes
          )
        );
      }
      const next = addBsMonths(y, m, 1);
      y = next.y;
      m = next.m;
      guard += 1;
    }
    return points;
  }

  const points: FinancialSummaryMonthlyPoint[] = [];
  let cursor = startOfMonth(period.from);
  const end = startOfMonth(period.to);
  while (cursor <= end) {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    const monthRange = clipToPeriod(monthStart, monthEnd, period);
    if (monthRange) {
      points.push(
        monthlyPointFromRange(
          format(cursor, "yyyy-MM"),
          format(cursor, "MMMM"),
          processedExpenseAccounts,
          processedExpenseGroups,
          vouchers,
          monthRange,
          processedTaxes
        )
      );
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return points;
}

function hasAnyData(summary: Omit<FinancialSummary, "hasData">, vouchers: any[], period: FinancialSummaryDateRange): boolean {
  if (
    Math.abs(summary.revenue.total) > 0.005 ||
    Math.abs(summary.netProfit.total) > 0.005 ||
    Math.abs(summary.assets.total) > 0.005
  ) {
    return true;
  }
  const from = startOfDay(period.from);
  const to = endOfDay(period.to);
  return vouchers.some((v) => {
    const d = safeToDateRp(v.date);
    return d && d >= from && d <= to;
  });
}

export function computeFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  const {
    vouchers,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedTaxes,
    period,
    comparisonPeriod,
    dateSystem,
  } = input;

  const currentTotals = aggregatePlTotals(
    processedExpenseAccounts,
    processedExpenseGroups,
    vouchers,
    period,
    processedTaxes
  );

  let previousTotals: ReturnType<typeof aggregatePlTotals> | undefined;
  if (comparisonPeriod) {
    previousTotals = aggregatePlTotals(
      processedExpenseAccounts,
      processedExpenseGroups,
      vouchers,
      comparisonPeriod,
      processedTaxes
    );
  }

  const rpCurrent = computeRpSnapshot(input, period.to);
  const cashAndBank = computeCashAndBankAsOf(
    input.processedAccounts,
    vouchers,
    input.processedItems,
    processedTaxes,
    period.to
  );

  let prevCash = undefined;
  let prevRec = undefined;
  let prevPay = undefined;
  if (comparisonPeriod) {
    prevCash = computeCashAndBankAsOf(
      input.processedAccounts,
      vouchers,
      input.processedItems,
      processedTaxes,
      comparisonPeriod.to
    );
    const rpPrev = computeRpSnapshot(input, comparisonPeriod.to);
    prevRec = computeReceivableKpi(rpPrev);
    prevPay = computePayableKpi(rpPrev);
  }

  const bs = buildBalanceSheetSnapshot(input, period.to, currentTotals.netProfit);
  const profitLossRows = buildProfitLossHierarchy(
    processedExpenseAccounts,
    processedExpenseGroups,
    vouchers,
    period,
    processedTaxes
  );
  const { income: profitLossIncomeRows, expense: profitLossExpenseRows } =
    splitProfitLossRows(profitLossRows);
  const monthlyChart = buildMonthlyChart(
    processedExpenseAccounts,
    processedExpenseGroups,
    vouchers,
    period,
    processedTaxes,
    dateSystem
  );

  const summary: FinancialSummary = {
    period,
    comparisonPeriod,
    revenue: { total: currentTotals.revenue, previous: previousTotals?.revenue },
    directCost: { total: currentTotals.directCost, previous: previousTotals?.directCost },
    grossProfit: { total: currentTotals.grossProfit, previous: previousTotals?.grossProfit },
    operatingExpenses: {
      total: currentTotals.operatingExpenses,
      previous: previousTotals?.operatingExpenses,
    },
    operatingProfit: {
      total: currentTotals.operatingProfit,
      previous: previousTotals?.operatingProfit,
    },
    financeCost: { total: currentTotals.financeCost, previous: previousTotals?.financeCost },
    netProfit: { total: currentTotals.netProfit, previous: previousTotals?.netProfit },
    cashAndBank: { total: cashAndBank, previous: prevCash },
    receivable: { total: computeReceivableKpi(rpCurrent), previous: prevRec },
    payable: { total: computePayableKpi(rpCurrent), previous: prevPay },
    profitLossRows,
    profitLossIncomeRows,
    profitLossExpenseRows,
    ...bs,
    workingCapital: {
      cashAndBank: bs.assets.cashAndBank,
      receivables: bs.assets.receivables,
      inventory: bs.assets.inventory,
      payables: bs.liabilities.payables,
      net: round2(
        bs.assets.cashAndBank + bs.assets.receivables + bs.assets.inventory - bs.liabilities.payables
      ),
    },
    monthlyChart,
    hasData: false,
  };

  summary.hasData = hasAnyData(summary, vouchers, period);
  return summary;
}

export function getFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  return computeFinancialSummary(input);
}

/**
 * Authoritative net profit from nominal (income/expense) ledger balances.
 * Shared by Financial Summary and Balance Sheet — do not duplicate formula elsewhere.
 */
export function computeNetProfitFromExpenseLedgerBalances(
  processedExpenseAccounts: ReadonlyArray<any>,
  processedExpenseGroups: ReadonlyArray<any>
): number {
  const { incomeGroupIds, expenseGroupIds } = buildGroupMaps(processedExpenseGroups);
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const acc of processedExpenseAccounts) {
    const bucket = classifyExpenseAccount(acc, incomeGroupIds, expenseGroupIds);
    const bal = Number(acc.balance) || 0;
    if (bucket === "income") {
      totalIncome += -bal;
    } else {
      totalExpenses += bal;
    }
  }

  return round2(totalIncome - totalExpenses);
}

/** Net profit from nominal ledgers as of a date (Balance Sheet point-in-time). */
export function computeNetProfitFromExpenseLedgerBalancesAsOf(
  processedExpenseAccounts: ReadonlyArray<any>,
  processedExpenseGroups: ReadonlyArray<any>,
  vouchers: ReadonlyArray<any>,
  processedTaxes: ReadonlyArray<any>,
  asOf: Date
): number {
  const { incomeGroupIds, expenseGroupIds } = buildGroupMaps(processedExpenseGroups);
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const acc of processedExpenseAccounts) {
    const bucket = classifyExpenseAccount(acc, incomeGroupIds, expenseGroupIds);
    const bal = balanceAsOf(
      Number(acc.openingBalance) || 0,
      [...vouchers],
      String(acc.id),
      "expense",
      asOf,
      [...processedTaxes]
    );
    if (bucket === "income") {
      totalIncome += -bal;
    } else {
      totalExpenses += bal;
    }
  }

  return round2(totalIncome - totalExpenses);
}

/** Net profit from nominal ledgers using full voucher list (no as-of cutoff). */
export function computeNetProfitFromExpenseLedgerBalancesWithVouchers(
  processedExpenseAccounts: ReadonlyArray<any>,
  processedExpenseGroups: ReadonlyArray<any>,
  vouchers: ReadonlyArray<any>,
  processedTaxes: ReadonlyArray<any>
): number {
  const { incomeGroupIds, expenseGroupIds } = buildGroupMaps(processedExpenseGroups);
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const acc of processedExpenseAccounts) {
    const bucket = classifyExpenseAccount(acc, incomeGroupIds, expenseGroupIds);
    const bal = computeRpLedgerAlignedBalance(
      Number(acc.openingBalance) || 0,
      [...vouchers],
      String(acc.id),
      "expense",
      [...processedTaxes]
    );
    if (bucket === "income") {
      totalIncome += -bal;
    } else {
      totalExpenses += bal;
    }
  }

  return round2(totalIncome - totalExpenses);
}
