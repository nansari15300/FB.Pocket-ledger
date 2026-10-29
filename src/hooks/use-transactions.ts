
"use client";

import { useMemo, useCallback, useRef } from "react";
import { startOfDay, endOfDay } from "date-fns";
import { buildDaybookDailySummary } from "@/lib/accountLedgerDaySummary";
import type { Party, Group } from "@/components/party/types";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import type { Staff, StaffGroup } from "@/components/staff/types";
import type { Tax, TaxGroup } from "@/components/tax/types";
import type { Item, ItemGroup, StockView } from "@/components/items/types";
import { useVouchers } from "./useVouchers";
import { useDate } from "./useDate";
import { useFyVoucherScope } from "@/contexts/FyVoucherScopeContext";
import {
  extractEntityBalanceFromFySnapshot,
  isLedgerDateFilterFromAtFyStart,
} from "@/lib/fyPagination/ledgerOpeningMeta";
import { hasFullLocalLedgerVoucherMirror } from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import { useCompany } from "./useCompany";
import { filterVouchersForAdminSubscriberPartyLedger } from "@/lib/adminPanelCompany/adminPanelPartyLedger";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import { type Context } from "@/components/vouchers/TransactionsTable";
import {
  typeColumnFilterHaystackFields,
  getDisplayVoucherNumber,
  getParticularsText,
  transactionRowHasFileAttachment,
} from "@/components/vouchers/transactionTableShared";
import {
  amountColumnHaystackMatchesFilter,
  columnFieldValuesHaystack,
  columnHaystackMatchesFilter,
  drCrChipKey,
  drCrColumnFilterResult,
} from "@/lib/transactionColumnHeaderFilter";
import { formatVoucherEntryTimeLocal, parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import {
  getAllocatedByVoucherId,
  getAllocatedByVoucherIdFromPaymentOuts,
  getAllocatedByVoucherIdFromPurchase,
  getAllocatedByVoucherIdFromSale,
  getAllocatedByVoucherIdFromJournal,
  buildBillWiseIncomingAllocationMaps,
  getBillWiseAllocatedToTargetWithMaps,
  isSaleOrPurchaseBillVoucherType,
  getPaymentStatus as getPaymentStatusResult,
  getPaymentInRemaining,
  getPaymentOutRemaining,
  getPaymentOutPartyLinkAmount,
  getOutflowBillWiseLinkAmount,
  getJournalPartyBillWiseAmountFromEntries,
  sumDedupedBillWiseAllocatedForVoucher,
  getAllocationTotal,
  getNetFromAllocation,
  getTaxFromAllocation,
  getTaxableFromAllocation,
  getAllocationAmountForEntityScope,
  allocationMatchesEntityScope,
  getTdsLegAllocatedByTargetId,
  OPENING_BALANCE_VOUCHER_ID,
} from "@/lib/payment-allocation-utils";
import {
  getSalePurchaseBillWiseTargetTotal,
  getSalePurchasePartyAmount,
  getSalePurchasePartyLinkTarget,
  getSalePurchaseTdsSettledAmount,
  sumVoucherLineTds,
} from "@/lib/tdsVoucher";
import {
  salePurchaseDiscountExpenseLedgerAmounts,
  salePurchaseTaxableAmount,
} from "@/lib/salePurchaseDiscountAdjustment";
import { resolveLedgerTransactionUserDisplayName } from "@/lib/ledgerUserColumnDisplay";
import {
  getInterCompanyLedgerAmounts,
  hideUnapprovedTargetInterCompanyEntityLedger,
  interCompanyKindForContext,
  interCompanyVoucherTouchesEntity,
  keepUnapprovedInterCompanyLedgerPlaceholderRow,
} from "@/lib/interCompany/interCompanyLedgerAmounts";
import {
  interCompanyVoucherViewerSide,
  shouldShowInterCompanyInDaybookOrRecent,
} from "@/lib/interCompany/interCompanyVoucherHydrate";
import { formatInterCompanyLedgerVoucherNumber } from "@/lib/interCompany/interCompanyVoucherDisplay";
import { getJournalVoucherLegs, sumJournalAmountsForAccount } from "@/lib/journalLedgerAmounts";
import {
  isSalePurchaseTdsVerifyLedgerContext,
  isUnverifiedTaxTdsBalanceRow,
  resolveSalePurchaseTdsVerifyLabel,
} from "@/lib/partyLedgerTdsView";
import { statementCheckedMessageColumn } from "@/lib/statementCheckRowMessage";

export {
  computeAccountLedgerDaySummary,
  getAccountLedgerTransactionAmounts,
  getAccountDaybookCashFlowInOut,
  buildDaybookDailySummary,
} from "@/lib/accountLedgerDaySummary";

type EntityWithItems = { id: string; items: (Item | Staff | Account | ExpenseAccount | Party)[], openingBalance?: number, [key: string]: any };

type Entity = Party | Account | Staff | Tax | Item | Group | AccountGroup | StaffGroup | TaxGroup | ItemGroup | ExpenseAccount | ExpenseGroup | EntityWithItems;

const safeToDate = (date: unknown): Date | null => parseFirestoreDateFieldToJsDate(date);

const ledgerIdEq = (value: unknown, id: string): boolean => {
    const target = String(id || "").trim();
    if (!target || value == null || value === "") return false;
    if (typeof value === "object" && value !== null && "id" in (value as Record<string, unknown>)) {
        return String((value as { id?: unknown }).id ?? "").trim() === target;
    }
    return String(value).trim() === target;
};

/** Bill-wise status pill: linked voucher nos for these types (payment_* early-return separately). */
const BILL_WISE_STATUS_LINK_TYPES = new Set([
  "sale", "sale_service", "purchase", "purchase_service",
  "payment_in", "payment_out", "direct_income", "direct_expense",
  "journal", "adjustment", "inter_company", "contra", "production",
]);

function formatBillWiseLinkedVoucherNo(v: any): string {
  if (!v) return "";
  if (v.type === "inter_company") {
    return (
      formatInterCompanyLedgerVoucherNumber(v as Record<string, unknown>) ||
      String(v.voucherNumber ?? v.voucher_number ?? "")
    ).trim();
  }
  return String(v.voucherNumber ?? v.voucher_number ?? "").trim();
}

function pushUniqueLinkedVoucherNo(list: string[], no: string): void {
  const n = String(no ?? "").trim();
  if (n && !list.includes(n)) list.push(n);
}

export const getTransactionAmounts = (
    transaction: any,
    context: Context,
    entity: any,
    stockView: StockView = 'amount',
    entityList?: Entity[],
    processedTaxes?: any[]
) => {
    const toNum = (value: any): number => {
        if (typeof value === "number") return Number.isFinite(value) ? value : 0;
        if (typeof value === "string") {
            const n = Number(value.replace(/,/g, "").trim());
            return Number.isFinite(n) ? n : 0;
        }
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    };
    let debit = 0;
    let credit = 0;
    let quantity = 0;
    let taxableAmount = 0;
    
    // Sale/Purchase edits often update `total`; prefer it over stale legacy `amount`.
    // Other voucher types still keep the old fallback behavior for 0-safe rows.
    const amount = ['sale', 'purchase', 'sale_service', 'purchase_service'].includes(transaction.type)
        ? getSalePurchasePartyAmount(transaction)
        : toNum(transaction.amount || transaction.total || 0);
    const paymentOutPayeeAmount =
        transaction.type === 'payment_out' ? getPaymentOutPartyLinkAmount(transaction) : amount;
    const paymentOutOtherChargeAmount = transaction.type === 'payment_out' ? Number(transaction.otherChargeAmount || 0) || 0 : 0;
    const directExpenseMainAmount =
        transaction.type === 'direct_expense' ? getOutflowBillWiseLinkAmount(transaction) : amount;
    const directExpenseOtherChargeAmount =
        transaction.type === 'direct_expense' ? Number(transaction.otherChargeAmount || 0) || 0 : 0;
    const contraTransferAmount =
        transaction.type === 'contra' ? getOutflowBillWiseLinkAmount(transaction) : amount;
    const contraOtherChargeAmount =
        transaction.type === 'contra' ? Number(transaction.otherChargeAmount || 0) || 0 : 0;

    if (['sale', 'purchase'].includes(transaction.type)) {
      taxableAmount = salePurchaseTaxableAmount(transaction);
    } else {
      taxableAmount = amount;
    }
    
    switch (context) {
        case "party":
            if (entity && entity.id === 'all') {
                // Handle all transaction types for "All Vouchers" view
                if (transaction.type === 'sale') {
                    debit += taxableAmount; 
                } else if (transaction.type === 'purchase') {
                    credit += taxableAmount;
                } else if (transaction.type === 'payment_out' || transaction.type === 'direct_expense') {
                    credit += amount; // Payment = Credit (money going out)
                } else if (transaction.type === 'payment_in' || transaction.type === 'direct_income') {
                    debit += amount; // Payment In = Debit (money coming in)
                }
            }
            else if (entity && entity.id === 'sales_account') {
                if (transaction.type === 'sale') credit += taxableAmount;
            }
            else if (entity && entity.id === 'purchase_account') {
                if (transaction.type === 'purchase') debit += taxableAmount;
            }
            else if (entity && transaction.partyId === entity.id) {
                if (["sale", "sale_service", "direct_income"].includes(transaction.type)) {
                  debit +=
                    transaction.type === "direct_income"
                      ? amount
                      : getSalePurchasePartyAmount(transaction);
                }
                if (transaction.type === "payment_out") debit += paymentOutPayeeAmount;
                if (["purchase", "purchase_service", "payment_in", "direct_expense"].includes(transaction.type)) {
                  if (transaction.type === "direct_expense") credit += directExpenseMainAmount;
                  else if (["purchase", "purchase_service"].includes(transaction.type))
                    credit += getSalePurchasePartyAmount(transaction);
                  else credit += toNum(transaction.amount || transaction.total || 0);
                }
            }
            if (entity && transaction.type === 'payment_out' && transaction.otherChargeAccountId === entity.id) {
                debit += paymentOutOtherChargeAmount;
            }
            if (entity && transaction.type === 'direct_expense' && transaction.otherChargeAccountId === entity.id) {
                debit += directExpenseOtherChargeAmount;
            }

            /** Party contra: sundry creditor/debtor ledger jahan party id bank leg jaisi `from/toAccountId` se juda ho — account context jaisa Dr/Cr. */
            if (
                transaction.type === "contra" &&
                entity &&
                typeof entity.id === "string" &&
                entity.id !== "all" &&
                entity.id !== "sales_account" &&
                entity.id !== "purchase_account" &&
                (transaction.fromAccountId === entity.id || transaction.toAccountId === entity.id)
            ) {
                if (transaction.toAccountId === entity.id) debit += contraTransferAmount;
                if (transaction.fromAccountId === entity.id) credit += amount;
            }
            if (entity && transaction.type === 'contra' && transaction.otherChargeAccountId === entity.id) {
                debit += contraOtherChargeAmount;
            }
            
            if (isJournalLikeVoucher(transaction) && entity?.id) {
                const journalAmt = sumJournalAmountsForAccount(transaction.entries, entity.id);
                debit += journalAmt.debit;
                credit += journalAmt.credit;
            }
            break;
            
        case "account":
            if (entity && entity.id === 'all') {
                // Handle "All Journal Vouchers" view - show all journal vouchers with total debit/credit per voucher
                const isJournalAllView = (entity as any).accountType === 'journal_view' || (entity as any).accountName?.includes('Journal');
                if (isJournalAllView && isRegularJournalLikeVoucher(transaction)) {
                    const journalAmounts = getJournalTransactionAmountsForAll(transaction);
                    debit += journalAmounts.debit;
                    credit += journalAmounts.credit;
                }
                // Handle "All Vouchers" view for contra - show all contra transactions
                else if (transaction.type === 'contra') {
                    debit += amount;
                    credit += amount;
                } else if (transaction.accountId) {
                    if (["payment_in", "direct_income", "sale"].includes(transaction.type)) debit += amount;
                    if (["payment_out", "direct_expense", "purchase"].includes(transaction.type)) credit += amount;
                }
            } else if (ledgerIdEq(transaction.accountId, String(entity.id || ""))) {
                if (["payment_in", "direct_income", "sale"].includes(transaction.type)) debit += amount;
                if (["payment_out", "direct_expense", "purchase"].includes(transaction.type)) credit += amount;
            }
            if (transaction.type === "contra") {
                const accountId = String(entity?.id || "");
                const hasToAccount = transaction.toAccountId != null && transaction.toAccountId !== "";
                const hasFromAccount = transaction.fromAccountId != null && transaction.fromAccountId !== "";
                const matchesToAccount =
                    ledgerIdEq(transaction.toAccountId, accountId) ||
                    (!hasToAccount && (ledgerIdEq(transaction.accountId, accountId) || ledgerIdEq(transaction.bankAccountId, accountId))) ||
                    ((ledgerIdEq(transaction.accountId, accountId) || ledgerIdEq(transaction.bankAccountId, accountId)) &&
                        !ledgerIdEq(transaction.fromAccountId, accountId) &&
                        !ledgerIdEq(transaction.toAccountId, accountId));
                const matchesFromAccount = hasFromAccount && ledgerIdEq(transaction.fromAccountId, accountId);
                if (matchesToAccount) debit = amount;
                if (matchesFromAccount) credit = amount;
            } else if (isJournalLikeVoucher(transaction)) {
                const journalAmt = sumJournalAmountsForAccount(transaction.entries, entity.id);
                debit += journalAmt.debit;
                credit += journalAmt.credit;
            }
            break;

        case "staff":
            if (entity && entity.id === 'all') {
                // Handle "All Vouchers" view for staff - show all add_salary transactions (net only: staff credits, exclude tax)
                if (transaction.type === 'journal' && transaction.subType === 'add_salary' && Array.isArray(transaction.entries)) {
                    transaction.entries.forEach((e: any) => {
                        if ((Number(e.credit) || 0) > 0 && !String(e.narration || '').includes('(Staff ID:')) {
                            credit += Number(e.credit || 0);
                        }
                    });
                } else if (transaction.type === 'add_salary') {
                    // Legacy add_salary vouchers stored with type=add_salary
                    if (Array.isArray(transaction.entries)) {
                        transaction.entries.forEach((e: any) => {
                            if ((Number(e.credit) || 0) > 0 && !String(e.narration || '').includes('(Staff ID:')) {
                                credit += Number(e.credit || 0);
                            }
                        });
                    } else {
                        credit += amount;
                    }
                } else if (transaction.type === 'pay_salary') {
                    // Legacy pay_salary vouchers stored with type=pay_salary
                    debit += amount;
                } else if (transaction.type === 'payment_out' && transaction.staffId) {
                    debit += paymentOutPayeeAmount;
                } else if (transaction.type === 'payment_out' && transaction.otherChargeAccountId === entity.id) {
                    debit += paymentOutOtherChargeAmount;
                } else if (transaction.type === 'payment_in' && transaction.staffId) {
                    credit += amount;
                }
            } else {
                const { debit: staffDebit, credit: staffCredit } = getStaffTransactionAmounts(transaction, [entity.id], []);
                debit += staffDebit;
                credit += staffCredit;
            }
            break;
    
        case "tax":
            const {debit: d, credit: c} = getTaxTransactionAmounts(transaction, entity.id, entityList || [])
            debit += d;
            credit += c;
            break;
    
        case "expense":
            // Individual Expense Account Logic
            if (transaction.type === 'direct_expense' && (transaction.toAccountId || transaction.expenseAccountId) === entity.id) {
                debit += directExpenseMainAmount;
            }
            // Payment mapped to expense accounts should debit the selected account.
            if (transaction.type === 'payment_out' && (transaction.expenseAccountId || transaction.toAccountId) === entity.id) {
                debit += paymentOutPayeeAmount;
            }
            if (transaction.type === 'payment_out' && transaction.otherChargeAccountId === entity.id) {
                debit += paymentOutOtherChargeAmount;
            }
            if (transaction.type === 'direct_expense' && transaction.otherChargeAccountId === entity.id) {
                debit += directExpenseOtherChargeAmount;
            }
            // Add Salary Support for Individual Expense Account
            if (transaction.type === 'journal' && transaction.subType === 'add_salary') {
                const debitEntry = transaction.entries.find((e: any) => e.accountId === entity.id && e.debit > 0);
                if(debitEntry) {
                    debit += Number(debitEntry.debit || 0);
                }
            }

            if (transaction.type === 'direct_income' && transaction.incomeAccountId === entity.id) {
                credit += amount;
            }
            // Payment In mapped to income accounts should credit the selected account.
            if (transaction.type === 'payment_in' && (transaction.incomeAccountId || transaction.toAccountId) === entity.id) {
                credit += amount;
            }
            
            // Map Sale/Purchase to the account selected on voucher (with legacy fallback ids).
            if (transaction.type === 'sale') {
                const selectedSalesAccountId = transaction.salesAccountId || transaction.incomeAccountId || 'sales_account';
                if (selectedSalesAccountId === entity.id) {
                    credit += taxableAmount;
                }
            } else if (transaction.type === 'purchase') {
                const selectedPurchaseAccountId = transaction.purchaseAccountId || transaction.expenseAccountId || 'purchase_account';
                if (selectedPurchaseAccountId === entity.id) {
                    debit += taxableAmount;
                }
            }

            if (transaction.type === 'sale' || transaction.type === 'purchase') {
                const disc = salePurchaseDiscountExpenseLedgerAmounts(transaction, entity.id);
                debit += disc.debit;
                credit += disc.credit;
            }

            if (isRegularJournalLikeVoucher(transaction)) {
                const journalAmt = sumJournalAmountsForAccount(transaction.entries, entity.id);
                debit += journalAmt.debit;
                credit += journalAmt.credit;
            }
            break;
        
        case "group":
            const { items, expenseGroupIds, ...groupEntity } = entity;
            const memberIdsInGroup = new Set((items || []).map((i: any) => i.id));
            const firstItem = items?.[0];
            
            // Check if this is "All Journal Vouchers" view - show total debit/credit for each journal transaction
            const isJournalAllView = entity.id === 'all' && (entity as any).accountType === 'journal_view';
            
            const isStaffGroup = firstItem && 'salary' in firstItem;
            const isTaxGroup = firstItem && 'rate' in firstItem;
            const isItemGroup = firstItem && ('purchasePrice' in firstItem || 'salePrice' in firstItem || 'stockQty' in firstItem || 'openingBalanceRate' in firstItem);
            const expenseGroupIdsArray = expenseGroupIds || [];
            const isExpenseGroupContext = expenseGroupIdsArray.length > 0;
            const expenseGroupId = String(entity.id || "").toLowerCase();
            const isAllowedExpenseGroupVoucher = (type: string, subType?: string) => {
                if (!isExpenseGroupContext) return true;
                // Income & Expense page: always allow Sale/Purchase family vouchers in group details.
                if (["sale", "purchase", "sale_service", "purchase_service"].includes(type)) return true;
                if (expenseGroupId === "direct_expense") return ["payment_out", "direct_expense", "purchase"].includes(type);
                if (expenseGroupId === "indirect_expense") return type === "payment_out" || type === "journal";
                if (expenseGroupId === "direct_income") return ["sale", "payment_in", "direct_income"].includes(type);
                if (expenseGroupId === "indirect_income") return type === "payment_in";
                return true;
            };

            // Expense group behavior should be derived from actual member accounts.
            const hasSalesAccount = memberIdsInGroup.has('sales_account');
            const hasPurchaseAccount = memberIdsInGroup.has('purchase_account');

            const isMemberLinkedInGroup =
                (Array.isArray(transaction.entries) &&
                  transaction.entries.some((e: any) => memberIdsInGroup.has(e.accountId))) ||
                memberIdsInGroup.has(transaction.partyId) ||
                memberIdsInGroup.has(transaction.staffId) ||
                memberIdsInGroup.has(transaction.accountId) ||
                memberIdsInGroup.has(transaction.taxAccountId) ||
                memberIdsInGroup.has(transaction.incomeAccountId) ||
                memberIdsInGroup.has(transaction.expenseAccountId) ||
                memberIdsInGroup.has(transaction.salesAccountId) ||
                memberIdsInGroup.has(transaction.purchaseAccountId) ||
                memberIdsInGroup.has(transaction.fromAccountId) ||
                memberIdsInGroup.has(transaction.toAccountId) ||
                (transaction.type === "note" && memberIdsInGroup.has(transaction.entityId));

            if (!isMemberLinkedInGroup && !isAllowedExpenseGroupVoucher(transaction.type, transaction.subType)) {
                break;
            }

            if (isStaffGroup) {
                const taxesToUse = processedTaxes || entityList?.filter((e: any) => e.rate !== undefined) || [];
                const staffAmounts = getStaffTransactionAmounts(transaction, Array.from(memberIdsInGroup) as string[], taxesToUse);
                debit += staffAmounts.debit;
                credit += staffAmounts.credit;
            
            } else if (isTaxGroup) {
                let groupDebit = 0;
                let groupCredit = 0;
                memberIdsInGroup.forEach(taxId => {
                    const taxAmounts = getTaxTransactionAmounts(transaction, taxId as string, entityList || []);
                    groupDebit += taxAmounts.debit;
                    groupCredit += taxAmounts.credit;
                });
                debit = groupDebit;
                credit = groupCredit;

            } else if (isItemGroup) {
                 const itemsArray = transaction.lineItems || transaction.items || [];
                 
                 itemsArray.forEach((li: any) => {
                     if (memberIdsInGroup.has(li.itemId)) {
                        const qty = Number(li.quantity) || 0;
                        const rate = Number(li.rate) || 0; // This is sale rate for sale transactions
                        const lineTotal = qty * rate;
                        
                        // Find the item to get purchase price
                        const item = entityList?.find((e: any) => e.id === li.itemId);

                        if (stockView === "amount") {
                            if (["purchase", "direct_income"].includes(transaction.type)) {
                                debit += lineTotal;
                            }
                            if (["sale", "direct_expense"].includes(transaction.type)) {
                                // IMPORTANT: For item group transactions, sale transactions must show purchase amount (not sale amount)
                                // This is required for stock matching - stock is valued at purchase price, not sale price
                                // Account list and group list balances use purchase rate for sale transactions
                                // Party view remains unchanged (shows sale amount) - see "party" case above
                                // Get purchase price: use totalPurchasePrice from transaction if available, otherwise use item's purchasePrice
                                const purchasePrice = transaction.totalPurchasePrice && transaction.totalPurchasePrice > 0 
                                    ? transaction.totalPurchasePrice 
                                    : (qty * (Number((item as Item)?.purchasePrice) || rate));
                                credit += purchasePrice;
                            }
                        } else {
                            if (["purchase", "direct_income"].includes(transaction.type)) debit += qty;
                            if (["sale", "direct_expense"].includes(transaction.type)) credit += qty;
                        }
                        quantity += qty;
                     }
                 });

            } else {
                // For Income/Expense groups, derive totals from member account logic so group view matches member account details.
                if (isExpenseGroupContext) {
                    const memberAccounts = ((items || []) as any[]);
                    memberAccounts.forEach((acc: any) => {
                        const amounts = getTransactionAmounts(transaction, "expense", acc, stockView, entityList, processedTaxes);
                        debit += Number(amounts.debit || 0);
                        credit += Number(amounts.credit || 0);
                    });
                } else {
                    // Generic Logic for Party and Bank/Cash Groups
                    if (isJournalAllView && isRegularJournalLikeVoucher(transaction)) {
                        const journalAmounts = getJournalTransactionAmountsForAll(transaction);
                        debit = journalAmounts.debit;
                        credit = journalAmounts.credit;
                    }
                    else if (transaction.type === 'contra') {
                        const leg = (transaction as any)._contraLeg;
                        if (leg === 'out') {
                            if (memberIdsInGroup.has(transaction.fromAccountId)) credit += amount;
                        } else if (leg === 'in') {
                            if (memberIdsInGroup.has(transaction.toAccountId)) debit += amount;
                        } else {
                            if (memberIdsInGroup.has(transaction.toAccountId)) debit += amount;
                            if (memberIdsInGroup.has(transaction.fromAccountId)) credit += amount;
                        }
                    }
                    else if (transaction.partyId && memberIdsInGroup.has(transaction.partyId)) {
                        if (["sale", "sale_service", "direct_income"].includes(transaction.type)) debit += amount;
                        if (transaction.type === "payment_out") debit += paymentOutPayeeAmount;
                        if (["purchase", "purchase_service", "payment_in"].includes(transaction.type)) credit += amount;
                        if (transaction.type === "direct_expense") credit += directExpenseMainAmount;
                    }
                    if (transaction.type === "payment_out" && memberIdsInGroup.has(transaction.otherChargeAccountId)) {
                        debit += paymentOutOtherChargeAmount;
                    }
                    if (transaction.type === "direct_expense" && memberIdsInGroup.has(transaction.otherChargeAccountId)) {
                        debit += directExpenseOtherChargeAmount;
                    }
                    if (transaction.type === "contra" && memberIdsInGroup.has(transaction.otherChargeAccountId)) {
                        debit += contraOtherChargeAmount;
                    }
                    else if (transaction.accountId && memberIdsInGroup.has(transaction.accountId)) {
                        if (["payment_in", "direct_income", "sale"].includes(transaction.type)) debit += amount;
                        if (["payment_out", "direct_expense", "purchase"].includes(transaction.type)) credit += amount;
                    }
                    else if (transaction.type === "inter_company") {
                        for (const memberId of memberIdsInGroup) {
                            const mid = String(memberId);
                            const partyIc = interCompanyKindForContext("party");
                            const bankIc = interCompanyKindForContext("account");
                            if (partyIc && interCompanyVoucherTouchesEntity(transaction, mid, partyIc)) {
                                const ic = getInterCompanyLedgerAmounts(transaction, "party", mid, amount);
                                debit += ic.debit;
                                credit += ic.credit;
                            } else if (bankIc && interCompanyVoucherTouchesEntity(transaction, mid, bankIc)) {
                                const ic = getInterCompanyLedgerAmounts(transaction, "account", mid, amount);
                                debit += ic.debit;
                                credit += ic.credit;
                            }
                        }
                    }
                }
            }
            
            // Generic Journal Processing for Groups (non-all view) - exclude salary journals and staff groups as they are handled above
            // Staff groups handle add_salary journals via getStaffTransactionAmounts, so skip generic processing for them
            // Tax groups already sum journal legs per member via getTaxTransactionAmounts above (would double count here); same for expense groups (per-member "expense" case already sums journal legs).
            if (!isJournalAllView && !isStaffGroup && !isTaxGroup && !isExpenseGroupContext && isRegularJournalLikeVoucher(transaction)) {
                // For specific account groups, only process entries matching accounts in the group
                transaction.entries.forEach((e: any) => {
                    if(memberIdsInGroup.has(e.accountId)) {
                        debit += Number(e.debit || 0);
                        credit += Number(e.credit || 0);
                    }
                });
            }
            break;

    case "item":
        const itemsArrayItem = transaction.lineItems || transaction.items;
        const lineItem = itemsArrayItem?.find((li: any) => li.itemId === entity.id);
        if (lineItem) {
             const qty = Number(lineItem.quantity) || 0;
             const rate = Number(lineItem.rate) || 0; // This is sale rate for sale transactions
             const conversions = (entity.unitConversions || []) as any[];
             const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : lineItem.unit;
             let factorToSmallest = 1;
             
             if (lineItem.unit && lineItem.unit !== smallestUnit) {
                let currentUnit = lineItem.unit;
                while (currentUnit !== smallestUnit && currentUnit) {
                    const conv = conversions.find((c: any) => c.fromUnit === currentUnit);
                    if (!conv) { factorToSmallest = 0; break; }
                    factorToSmallest *= Number(conv.conversionFactor);
                    currentUnit = conv.toUnit;
                }
             }
             if (factorToSmallest === 0) factorToSmallest = 1; 
             const convertedQty = qty * factorToSmallest;

            if (stockView === "amount") {
                if (["purchase", "direct_income"].includes(transaction.type)) {
                    debit += qty * rate;
                }
                if (["sale", "direct_expense"].includes(transaction.type)) {
                    // IMPORTANT: For item transactions, sale transactions must show purchase amount (not sale amount)
                    // This is required for stock matching - stock is valued at purchase price, not sale price
                    // Party view remains unchanged (shows sale amount) - see "party" case above
                    // Get purchase price: use totalPurchasePrice from transaction if available, otherwise use item's purchasePrice
                    const purchasePrice = transaction.totalPurchasePrice && transaction.totalPurchasePrice > 0 
                        ? transaction.totalPurchasePrice 
                        : (qty * (Number(entity.purchasePrice) || rate));
                    credit += purchasePrice;
                }
            } else { 
                if (["purchase", "direct_income"].includes(transaction.type)) debit += convertedQty;
                if (["sale", "direct_expense"].includes(transaction.type)) credit += convertedQty;
            }
            quantity = convertedQty;
        } 
        else {
            if (typeof transaction.debit === "number") debit = transaction.debit;
            if (typeof transaction.credit === "number") credit = transaction.credit;
            
            if (stockView === 'qty' && debit === 0 && credit === 0) {
                 if (typeof transaction.inQty === "number") debit = transaction.inQty;
                 else if (typeof transaction.in === "number") debit = transaction.in;

                 if (typeof transaction.outQty === "number") credit = transaction.outQty;
                 else if (typeof transaction.out === "number") credit = transaction.out;
            }
        }
      break;
    
    case "daybook":
        if (transaction.type === "journal" || transaction.type === "adjustment") {
          const legs = getJournalVoucherLegs(transaction);
          debit = legs.reduce((sum, e) => sum + toNum(e.debit), 0);
          credit = legs.reduce((sum, e) => sum + toNum(e.credit), 0);
        } else if (transaction.type === 'contra') {
          debit = amount; 
          credit = amount;
        } else if (['sale', 'payment_in', 'direct_income'].includes(transaction.type)) {
          credit = amount; // Money coming in = Credit
        } else if (['purchase', 'payment_out', 'direct_expense'].includes(transaction.type)) {
          debit = amount; // Money going out = Debit
        } else if (transaction.type === 'inter_company') {
          if (!shouldShowInterCompanyInDaybookOrRecent(transaction)) {
            debit = 0;
            credit = 0;
          } else {
            const ic = getInterCompanyLedgerAmounts(
              transaction,
              "account",
              String(transaction.companyBankAccountId || "").trim(),
              amount
            );
            if (ic.touched) {
              debit = ic.debit;
              credit = ic.credit;
            } else {
              const side = interCompanyVoucherViewerSide(transaction);
              // Fallback — Payment = Cr, Payment In = Dr (clearing)
              if (side === "source") credit = amount;
              else if (side === "target") debit = amount;
            }
          }
        }
        break;
        
    case "other":
        if (transaction.payeeName === entity.id) {
            if (transaction.type === 'payment_in' || transaction.type === 'direct_income') {
                credit += amount;
            } else if (transaction.type === 'payment_out' || transaction.type === 'direct_expense') {
                debit += amount;
            }
        }
        break;
        
    default:
        if (typeof transaction.debit === "number") debit = transaction.debit;
        if (typeof transaction.credit === "number") credit = transaction.credit;
  }

  // Inter Company — entity ledger (party/bank/staff/tax/expense); zero filter se bachne ke liye Dr/Cr set
  if (transaction.type === "inter_company" && entity?.id) {
    const ic = getInterCompanyLedgerAmounts(
      transaction,
      context,
      String(entity.id),
      amount
    );
    if (ic.touched) {
      debit = ic.debit;
      credit = ic.credit;
    }
  }

  return { debit, credit, quantity, taxableAmount };
};

export const getJournalTransactionAmountsForAll = (transaction: any) => {
    let debit = 0;
    let credit = 0;
    if (isJournalLikeVoucher(transaction)) {
        debit = transaction.entries.reduce((sum: number, e: any) => sum + Number(e.debit || 0), 0);
        credit = transaction.entries.reduce((sum: number, e: any) => sum + Number(e.credit || 0), 0);
    }
    return { debit, credit };
}

export const getStaffTransactionAmounts = (transaction: any, staffIds: string[], processedTaxes: any[]) => {
  let debit = 0;
  let credit = 0;
  let taxRate = 0;
  let taxableAmount = 0;
  let taxAmount = 0;
  let quantity = 0;
  const amount = Number(transaction.amount || transaction.total || 0);
  const paymentOutPayeeAmount =
    transaction.type === 'payment_out' && Number(transaction.payeeAmount || 0) > 0
      ? Number(transaction.payeeAmount || 0)
      : amount;
  const paymentOutOtherChargeAmount = transaction.type === 'payment_out' ? Number(transaction.otherChargeAmount || 0) || 0 : 0;

  if (transaction.type === "note") return { debit, credit, taxRate, taxableAmount, taxAmount, quantity };

  if (transaction.type === "inter_company" && transaction.staffId && staffIds.includes(transaction.staffId)) {
    const ic = getInterCompanyLedgerAmounts(transaction, "staff", transaction.staffId, amount);
    if (ic.touched) {
      debit = ic.debit;
      credit = ic.credit;
      return { debit, credit, taxRate, taxableAmount, taxAmount, quantity };
    }
  }

  if (transaction.taxAccountId) {
    const tax = processedTaxes.find(t => t.id === transaction.taxAccountId);
    if (tax) {
      taxRate = tax.rate || 0;
    }
  }

  if (transaction.type === 'payment_out' && staffIds.includes(transaction.staffId)) {
    debit = paymentOutPayeeAmount;
  } else if (transaction.type === 'payment_out' && staffIds.includes(transaction.otherChargeAccountId)) {
    debit = paymentOutOtherChargeAmount;
  } else if (transaction.type === 'pay_salary' && staffIds.includes(transaction.staffId)) {
    debit = amount;
  } else if (transaction.type === 'payment_in' && staffIds.includes(transaction.staffId)) {
    credit = amount;
  } else if (transaction.type === 'add_salary') {
      // Legacy add_salary vouchers stored with type=add_salary
      if (Array.isArray(transaction.entries)) {
        const staffEntry = transaction.entries.find((e: any) => {
          const isStaff = staffIds.includes(e.accountId);
          const hasCredit = (Number(e.credit || 0) > 0);
          const isNotTax = !processedTaxes.some(pt => pt.id === e.accountId);
          return isStaff && hasCredit && isNotTax;
        });
        if (staffEntry) {
          credit = Number(staffEntry.credit || 0);
        }
      } else if (staffIds.includes(transaction.staffId)) {
        credit = amount;
      }
  } else if (transaction.type === 'journal' && transaction.subType === 'add_salary' && Array.isArray(transaction.entries)) {
      // For add_salary journals, only process staff entries, explicitly exclude tax entries
      const staffEntry = transaction.entries.find((e: any) => {
        // Must be a staff member (in staffIds)
        const isStaff = staffIds.includes(e.accountId);
        // Must have credit (staff gets credit in add_salary)
        const hasCredit = (Number(e.credit || 0) > 0);
        // Must NOT be a tax account (double-check)
        const isNotTax = !processedTaxes.some(pt => pt.id === e.accountId);
        return isStaff && hasCredit && isNotTax;
      });
      
      if (staffEntry) {
         // Only include staff credit, never tax credit
         credit = Number(staffEntry.credit || 0);
         // Find tax entry for reference (but don't add to credit)
         const taxEntry = transaction.entries.find((taxE: any) => 
            processedTaxes.some(pt => pt.id === taxE.accountId) && 
            (taxE.narration || "").includes(`(Staff ID: ${staffEntry.accountId})`)
         );
         const taxAmountValue = taxEntry?.credit || 0;
         taxableAmount = credit + taxAmountValue;
         taxAmount = taxAmountValue;
         const relevantTax = processedTaxes.find(t => t.id === taxEntry?.accountId);
         taxRate = relevantTax?.rate || 0;
         debit = 0;
      }
  } else if (
    (transaction.type === "journal" || transaction.type === "adjustment") &&
    transaction.subType !== "add_salary"
  ) {
      // For non-add_salary journals/adjustments, only process staff entries, exclude tax entries
      transaction.entries.forEach((e: any) => {
        const isStaff = staffIds.includes(e.accountId);
        const isNotTax = !processedTaxes.some(pt => pt.id === e.accountId);
        if (isStaff && isNotTax) {
          debit += Number(e.debit || 0);
          credit += Number(e.credit || 0);
        }
      });
  }

  return { debit, credit, taxRate, taxableAmount, taxAmount, quantity };
};

function voucherLineTouchesTaxLedgerAccount(
  line: { itemId?: string; taxAccountId?: string; tdsAccountId?: string },
  accountId: string
): boolean {
  if (!accountId) return false;
  return (
    line.itemId === accountId ||
    line.taxAccountId === accountId ||
    line.tdsAccountId === accountId
  );
}

export const getTaxTransactionAmounts = (transaction: any, taxAccountId: string, processedTaxes: any[]) => {
    let debit = 0;
    let credit = 0;
    let taxableAmount = 0;
    let taxAmount = 0;
    let taxRate = 0;
    let quantity = 0;

    const tax = processedTaxes.find(t => t.id === taxAccountId);
    if (tax) taxRate = tax.rate || 0;

    if (transaction.type === "note") return { debit, credit, taxableAmount, taxAmount, taxRate, quantity };

    if (transaction.type === "inter_company") {
        const ic = getInterCompanyLedgerAmounts(transaction, "tax", taxAccountId, Number(transaction.amount || transaction.total || 0));
        if (ic.touched) {
            debit = ic.debit;
            credit = ic.credit;
            taxAmount = debit || credit;
            return { debit, credit, taxableAmount, taxAmount, taxRate, quantity };
        }
    }
    
    if (transaction.type === 'payment_out' && transaction.taxAccountId === taxAccountId) {
        const paymentOutTaxAmount = Number(transaction.payeeAmount || 0) > 0 ? Number(transaction.payeeAmount || 0) : Number(transaction.amount || transaction.total || 0);
        debit += paymentOutTaxAmount;
        taxAmount += paymentOutTaxAmount;
    } else if (transaction.type === 'payment_in' && transaction.taxAccountId === taxAccountId) {
        credit += transaction.amount || 0;
        taxAmount += transaction.amount || 0;
    } else if (transaction.lineItems) {
        transaction.lineItems.forEach((line: any) => {
            if (line.taxAccountId === taxAccountId) {
                const amount = Number(line.amount || 0);
                const taxAmt = Number(line.taxAmount || 0);
                taxableAmount += amount;
                taxAmount += taxAmt;

                if (transaction.type === 'purchase') debit += taxAmt;
                else if (transaction.type === 'sale') credit += taxAmt;
            }
            if (line.tdsAccountId === taxAccountId) {
                const tdsAmt = Number(line.tdsAmount || 0);
                if (tdsAmt > 0) {
                    taxAmount += tdsAmt;
                    if (transaction.type === "purchase") credit += tdsAmt;
                    else if (transaction.type === "sale" || transaction.type === "sale_service") debit += tdsAmt;
                }
            }
        });
        if (taxableAmount > 0 && taxAmount > 0 && taxRate === 0) {
            taxRate = (taxAmount / taxableAmount) * 100;
        }
    } else if (Array.isArray(transaction.entries)) {
        const journalAmt = sumJournalAmountsForAccount(transaction.entries, taxAccountId);
        if (journalAmt.debit > 0 || journalAmt.credit > 0) {
            taxAmount = journalAmt.debit || journalAmt.credit;
            debit += journalAmt.debit;
            credit += journalAmt.credit;
            
            if (transaction.subType === 'add_salary') {
                const staffEntry = transaction.entries.find((e: any) => e.credit > 0 && e.accountId !== taxAccountId);
                if (staffEntry) {
                    taxableAmount = staffEntry.credit + taxAmount; 
                }
                if (taxableAmount > 0 && taxAmount > 0) {
                  taxRate = (taxAmount / taxableAmount) * 100;
                }
            } else {
                const otherEntry = transaction.entries.find((e: any) => e.accountId !== taxAccountId);
                if (otherEntry) {
                    taxableAmount = otherEntry.debit || otherEntry.credit || 0;
                      if (taxableAmount > 0 && taxAmount > 0 && taxRate === 0) {
                        taxRate = (taxAmount / taxableAmount) * 100;
                    }
                }
            }
        }
    } else if (transaction.subType === 'pay_salary' && transaction.taxAccountId === taxAccountId) {
        debit += transaction.amount || 0;
        taxAmount += transaction.amount || 0;
        taxableAmount = 0; 
    }


    return { debit, credit, taxableAmount, taxAmount, taxRate, quantity };
};

/** Tax ledger books balance: Unverified TDS legs contribute 0 (UI still shows dim amount). */
function taxLedgerBooksBalanceAmounts(
  transaction: any,
  taxAccountId: string,
  amounts: { debit: number; credit: number }
): { debit: number; credit: number } {
  // Unverified TDS legs now count in running balance / period totals (UI keeps them dim).
  void transaction;
  void taxAccountId;
  return amounts;
}

const IDLE_USE_TRANSACTIONS_RESULT = {
  processedTransactions: [] as any[],
  daybookTransactions: [] as any[],
  totalTransactions: 0,
  openingBalanceForPeriod: 0,
  periodDr: 0,
  periodCr: 0,
  closingBalance: 0,
  daybookSummary: null as any,
  openingBalanceOutstanding: 0,
  openingBalanceLinkedVoucherNos: [] as string[],
  periodOpeningUnavailable: false,
  periodOpeningLoading: false,
};

/** Stable daybook entity — never inline `{ id: "daybook", items: [] }` in render (recomputes entire ledger). */
export const DAYBOOK_TRANSACTIONS_ENTITY = Object.freeze({
  id: "daybook",
  items: [] as any[],
});

/** Stable empty list for idle dashboard Recent pipeline. */
export const EMPTY_TRANSACTIONS_LIST: any[] = [];

function entityMemoDepKey(
  entity: Entity | null | undefined,
  context: Context
): string {
  if (!entity || typeof entity !== "object") return "";
  const id = "id" in entity ? String((entity as { id?: string }).id ?? "") : "";
  if (context === "daybook" || context === "other") return id;
  if (context === "group" && "items" in entity) {
    const items = ((entity as { items?: { id?: string }[] }).items || [])
      .map((i) => String(i?.id ?? ""))
      .join(",");
    return `${id}|g|${items}`;
  }
  const anyE = entity as Record<string, unknown>;
  const ob = Number(anyE.openingBalance ?? anyE.balance ?? 0);
  return `${id}|${ob}`;
}

export function useTransactions(
    entity: Entity | null | undefined,
    context: Context,
    dateRange?: { from?: Date; to?: Date },
    stockView: StockView = 'amount',
    entityList?: any[],
    passedTransactions?: any[],
    transactionContext?: string, 
    filters?: Record<string, string>,
    voucherTypes?: string[],
    journalAccountNames?: Record<string, string>,
    userNames?: Record<string, string>,
    displayUnit?: string,
    /** Daybook: sirf is user ke vouchers (summary + table); null/undefined = sab users */
    daybookUserIdFilter?: string | null,
    /** Dashboard Recent: running balance column off — skip books walk + per-row balance. */
    skipRunningBalance?: boolean,
    /** false = skip heavy voucher scan (inactive dashboard tab). */
    transactionsComputationEnabled: boolean = true,
    /** Tax statement hides Status; skip its bill-wise allocation/link scans until needed. */
    includeTaxBillWiseStatus: boolean = true
) {
    const { vouchers, processedTaxes } = useVouchers();
    const { company, companyId } = useCompany();
    const { dateSystem, formatDate, formatDateBS, formatCurrency } = useDate();
    const fy = useFyVoucherScope();

    const useExplicitDaybookVoucherList =
      context === "daybook" &&
      entity != null &&
      typeof entity === "object" &&
      "id" in entity &&
      String((entity as { id?: string }).id) === "daybook" &&
      Array.isArray(passedTransactions);

    const vouchersForMemo = useExplicitDaybookVoucherList ? passedTransactions! : vouchers;

    // Display-name maps change identity often; do not re-scan all vouchers when only labels update.
    const userNamesForFilterRef = useRef(userNames);
    userNamesForFilterRef.current = userNames;
    const journalAccountNamesForFilterRef = useRef(journalAccountNames);
    journalAccountNamesForFilterRef.current = journalAccountNames;
    // processedTaxes/allTaxes remaps on every aggregate bump — keep list via ref; dep on stable key only.
    const entityListRef = useRef(entityList);
    entityListRef.current = entityList;
    let entityListDepKey = "0";
    if (entityList?.length) {
      let key = "";
      for (const e of entityList) {
        const anyE = e as { id?: string; rate?: unknown; openingBalance?: unknown };
        key += `${anyE?.id ?? ""}:${anyE?.rate ?? ""}:${Number(anyE?.openingBalance) || 0}|`;
      }
      entityListDepKey = key;
    }

    const entityDepKey = entityMemoDepKey(entity, context);
    const dateRangeFromMs = dateRange?.from?.getTime() ?? 0;
    const dateRangeToMs = dateRange?.to?.getTime() ?? 0;
    const fyScopeKey = fy.activeScope
      ? `${fy.activeScope.policy}:${fy.activeScope.range?.fromMs ?? 0}:${fy.activeScope.range?.toMs ?? 0}`
      : "";

    const result = useMemo(() => {
        const userNames = userNamesForFilterRef.current;
        const journalAccountNames = journalAccountNamesForFilterRef.current;
        const entityList = entityListRef.current;
        if (!transactionsComputationEnabled) {
          return IDLE_USE_TRANSACTIONS_RESULT;
        }
        if (!entity) {
             return {
               processedTransactions: [],
               totalTransactions: 0,
               openingBalanceForPeriod: 0,
               periodDr: 0,
               periodCr: 0,
               closingBalance: 0,
               daybookSummary: null,
               periodOpeningUnavailable: false,
               periodOpeningLoading: false,
             };
        }
        
        // Ledger math generally needs full vouchers, but report/dashboard "All Vouchers" uses
        // pre-scoped `passedTransactions` (e.g. Pay Salary subset, Journal/Contra report lists).
        const isReportAllAccountView =
            context === "account" &&
            entity.id === "all" &&
            ((entity as any).accountType === "journal_view" ||
                (entity as any).accountType === "contra_view" ||
                String((entity as any).accountName || "").includes("All Journal") ||
                String((entity as any).accountName || "").includes("All Contra"));
        const shouldUseScopedPassedTransactions =
            entity.id === "all" &&
            Array.isArray(passedTransactions) &&
            (Boolean(transactionContext) || isReportAllAccountView);
        let transactionsToProcess = useExplicitDaybookVoucherList
            ? (passedTransactions ?? [])
            : shouldUseScopedPassedTransactions
            ? (passedTransactions ?? [])
            : (vouchers ?? []);
        if (context === "party" && !shouldUseScopedPassedTransactions) {
            transactionsToProcess = filterVouchersForAdminSubscriberPartyLedger(
                companyId,
                transactionsToProcess
            );
        }

        let entityTransactions: any[] = [];
        
        if (transactionContext && entity.id === 'all') {
            // Pre-scoped `passedTransactions` (dashboard All Vouchers deep-link): list already matches card count — do not
            // re-apply payment family filter (drops `pay_salary` type and breaks Pay Salary vs Payment parity).
            if (shouldUseScopedPassedTransactions) {
                entityTransactions = [...(transactionsToProcess ?? [])];
            } else {
            // Normalize `payment-in` / `payment-out` (URL/report context) → Firestore `type` underscore keys
            const ctx =
                transactionContext === "payment-in"
                    ? "payment_in"
                    : transactionContext === "payment-out"
                      ? "payment_out"
                      : transactionContext;
            if (ctx === "add_salary") {
                entityTransactions = transactionsToProcess.filter(
                    (v: any) => v.type === "add_salary" || (v.type === "journal" && v.subType === "add_salary")
                );
            } else if (ctx === "payment_in" || ctx === "payment_out") {
                entityTransactions = transactionsToProcess.filter((v: any) => {
                    if (ctx === "payment_in") return v.type === "payment_in" || v.type === "direct_income";
                    return v.type === "payment_out" || v.type === "direct_expense";
                });
            } else {
                entityTransactions = transactionsToProcess.filter((v: any) => v.type === ctx);
            }
            }
        } else if (context === 'group' && 'items' in entity) {
            // Check if this is "All Journal Vouchers" view
            const isJournalAllView = entity.id === 'all' && (entity as any).accountType === 'journal_view';
            if (isJournalAllView) {
                // For "All Journal Vouchers" view, show all journal transactions (excluding add_salary)
                entityTransactions = transactionsToProcess.filter((v: any) => 
                    isRegularJournalLikeVoucher(v)
                );
            } else {
                const memberIds = new Set((entity as any).items?.map((i: any) => i.id));
                const memberExpenseAccounts = ((entity as any).items || []) as any[];
                const hasSalesAccount = memberIds.has('sales_account');
                const hasPurchaseAccount = memberIds.has('purchase_account');
                const expenseGroupIds = (entity as any).expenseGroupIds || [];
                const isExpenseGroupContext = expenseGroupIds.length > 0;
                const expenseGroupId = String(entity.id || "").toLowerCase();
                const isAllowedExpenseGroupVoucher = (type: string, subType?: string) => {
                    if (!isExpenseGroupContext) return true;
                    // Income & Expense page: always allow Sale/Purchase family vouchers in group details.
                    if (["sale", "purchase", "sale_service", "purchase_service"].includes(type)) return true;
                    if (expenseGroupId === "direct_expense") return ["payment_out", "direct_expense", "purchase"].includes(type);
                    if (expenseGroupId === "indirect_expense") return type === "payment_out" || type === "journal";
                    if (expenseGroupId === "direct_income") return ["sale", "payment_in", "direct_income"].includes(type);
                    if (expenseGroupId === "indirect_income") return type === "payment_in";
                    return true;
                };
                
                entityTransactions = transactionsToProcess.filter((v: any) => {
                    if (isExpenseGroupContext) {
                        const hasMemberExpenseImpact = memberExpenseAccounts.some((acc: any) => {
                            const amounts = getTransactionAmounts(v, "expense", acc, stockView, entityList, processedTaxes);
                            return Number(amounts.debit || 0) !== 0 || Number(amounts.credit || 0) !== 0;
                        });
                        if (hasMemberExpenseImpact) return true;
                        if (v.type === "note" && memberIds.has(v.entityId)) return true;
                    }

                    const isMemberLinked =
                        (Array.isArray(v.lineItems) &&
                          v.lineItems.some(
                            (li: any) =>
                              memberIds.has(li.itemId) ||
                              memberIds.has(li.taxAccountId) ||
                              memberIds.has(li.tdsAccountId)
                          )) ||
                        v.items?.some(
                          (li: any) =>
                            memberIds.has(li.itemId) ||
                            memberIds.has(li.taxAccountId) ||
                            memberIds.has(li.tdsAccountId)
                        ) ||
                        (Array.isArray(v.entries) &&
                          v.entries.some((e: any) => memberIds.has(e.accountId))) ||
                        memberIds.has(v.partyId) ||
                        memberIds.has(v.staffId) ||
                        memberIds.has(v.accountId) ||
                        memberIds.has(v.taxAccountId) ||
                        memberIds.has(v.incomeAccountId) ||
                        memberIds.has(v.expenseAccountId) ||
                        memberIds.has(v.salesAccountId) ||
                        memberIds.has(v.purchaseAccountId) ||
                        memberIds.has(v.fromAccountId) ||
                        memberIds.has(v.toAccountId) ||
                        memberIds.has(String(v.interCompanyCounterpartyPartyId || "").trim()) ||
                        (Array.isArray(v.interCompanyLegs) &&
                          v.interCompanyLegs.some((leg: any) =>
                            memberIds.has(String(leg?.accountId || "").trim())
                          )) ||
                        (v.type === "note" && memberIds.has(v.entityId));

                    // Member-linked vouchers should always appear in group details.
                    if (isMemberLinked) return true;

                    const isSystemFallback =
                        (v.type === "sale" && hasSalesAccount) ||
                        (v.type === "purchase" && hasPurchaseAccount);
                    if (!isSystemFallback) return false;
                    return isAllowedExpenseGroupVoucher(v.type, v.subType);
                });
            }
        } else if (context === 'daybook') {
            entityTransactions = transactionsToProcess.filter((v: any) => {
              if (v?.type !== "inter_company") return true;
              return shouldShowInterCompanyInDaybookOrRecent(v as Record<string, unknown>);
            });
            // Daybook shows one day only — filter before sort/bill-wise work on full voucher set.
            if (dateRange?.from) {
                const fromDate = startOfDay(dateRange.from);
                const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
                entityTransactions = entityTransactions.filter((v: any) => {
                    const transactionDate = safeToDate(v.date);
                    if (!transactionDate) return false;
                    if (daybookUserIdFilter && String(v.userId || "") !== String(daybookUserIdFilter)) {
                        return false;
                    }
                    return transactionDate >= fromDate && transactionDate <= toDate;
                });
            }
        } else if (context === 'other') {
             entityTransactions = transactionsToProcess.filter((v: any) => v.payeeName === entity.id);
        } else if (context === 'item') {
            // For items: lineItems/items containing this item, or notes linked to this item (entityId)
            entityTransactions = transactionsToProcess.filter((v: any) =>
                (Array.isArray(v.lineItems) && v.lineItems.some((li: any) => li.itemId === entity.id)) ||
                v.items?.some((li: any) => li.itemId === entity.id) ||
                (v.type === 'note' && v.entityId === entity.id)
            );
        } else if (context === "account" && entity.id === "all") {
            // Journal/Contra reports: AccountDetails passes pre-scoped list; do not match entity.id on voucher legs.
            if (shouldUseScopedPassedTransactions) {
                entityTransactions = [...transactionsToProcess];
            } else {
                const isJournalAllView =
                    (entity as any).accountType === "journal_view" ||
                    String((entity as any).accountName || "").includes("All Journal");
                const isContraAllView =
                    (entity as any).accountType === "contra_view" ||
                    String((entity as any).accountName || "").includes("All Contra");
                if (isJournalAllView) {
                    entityTransactions = transactionsToProcess.filter(
                        (v: any) => isRegularJournalLikeVoucher(v)
                    );
                } else if (isContraAllView) {
                    entityTransactions = transactionsToProcess.filter((v: any) => v.type === "contra");
                } else {
                    entityTransactions = [];
                }
            }
        } else {
            entityTransactions = transactionsToProcess.filter((v: any) => {
                const entityIdStr = String(entity.id || "");
                if (
                  hideUnapprovedTargetInterCompanyEntityLedger(v, context, entityIdStr)
                ) {
                  return false;
                }
                // Standard filters
                if (v.partyId === entity.id ||
                v.accountId === entity.id ||
                v.staffId === entity.id ||
                v.taxAccountId === entity.id ||
                v.expenseAccountId === entity.id ||
                v.incomeAccountId === entity.id ||
                v.salesAccountId === entity.id ||
                v.purchaseAccountId === entity.id ||
                (v.type === "payment_out" && v.otherChargeAccountId === entity.id) ||
                (v.type === "direct_expense" && v.otherChargeAccountId === entity.id) ||
                (Array.isArray(v.lineItems) &&
                  v.lineItems.some((li: any) => voucherLineTouchesTaxLedgerAccount(li, entity.id))) ||
                v.items?.some((li: any) => voucherLineTouchesTaxLedgerAccount(li, entity.id)) ||
                (Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === entity.id)) ||
                (v.type === 'note' && v.entityId === entity.id) ||
                    (v.type === 'contra' && (v.fromAccountId === entity.id || v.toAccountId === entity.id)) ||
                // IC: `companyBankAccountId` + target/source entity ids — sirf staffId se kaafi nahi
                (v.type === "inter_company" &&
                    ((context === "party" && interCompanyVoucherTouchesEntity(v, entity.id, "party")) ||
                        (context === "staff" && interCompanyVoucherTouchesEntity(v, entity.id, "staff")) ||
                        (context === "account" && interCompanyVoucherTouchesEntity(v, entity.id, "bank")) ||
                        (context === "tax" && interCompanyVoucherTouchesEntity(v, entity.id, "tax")) ||
                        (context === "expense" && interCompanyVoucherTouchesEntity(v, entity.id, "expense"))))) {
                    return true;
                }
                
                // Special handling for Sales Account and Purchase Account
                // Sales Account should show all 'sale' transactions
                if (entity.id === 'sales_account' && v.type === 'sale') {
                    return true;
                }
                // Purchase Account should show all 'purchase' transactions
                if (entity.id === 'purchase_account' && v.type === 'purchase') {
                    return true;
                }
                
                return false;
            });
        }

        // Second pass: narrow by voucher type (sale/purchase/payment_*) — not for report-embedded ledgers (Anusuchi 13, etc.).
        if (
            transactionContext &&
            transactionContext !== "report" &&
            !shouldUseScopedPassedTransactions
        ) {
            const contextType = transactionContext === 'payment-in' ? 'payment_in' : 
                              transactionContext === 'payment-out' ? 'payment_out' : transactionContext;
            entityTransactions = entityTransactions.filter((v: any) => {
                // Add Salary context supports both legacy `type=add_salary` and current `journal + subType=add_salary`.
                if (contextType === 'add_salary') {
                    return v.type === 'add_salary' || (v.type === 'journal' && v.subType === 'add_salary');
                }
                if (contextType === 'payment_in' || contextType === 'payment_out') {
                    return v.type === contextType || (contextType === 'payment_in' && v.type === 'direct_income') || 
                           (contextType === 'payment_out' && v.type === 'direct_expense');
                }
                return v.type === contextType;
            });
        }
        
        let filteredByType = entityTransactions;
        if (voucherTypes && !voucherTypes.includes('all')) {
            filteredByType = entityTransactions.filter((v) => {
                const type = v.type === 'journal' && v.subType ? v.subType : v.type;
                return voucherTypes.includes(type);
            });
        }

        let filteredByColumn = filteredByType;
        
        if (filters && Object.entries(filters).some(([_, v]) => v && v !== "all")) {
            filteredByColumn = filteredByType.filter((t: any) => {
              return Object.entries(filters).every(([key, value]) => {
                if (!value || value === "all") return true;

                // File column — All / with attachment / without attachment
                if (key === "file") {
                  const hasFile = transactionRowHasFileAttachment(t);
                  if (value === "with") return hasFile;
                  if (value === "without") return !hasFile;
                  return true;
                }

                const rawSearchTerm = String(value).trim();
                const d = safeToDate(t.date);
                const entryClock = formatVoucherEntryTimeLocal(t as Record<string, unknown>);
                const nameMap = { ...journalAccountNames, ...userNames };

                // Accounts column — sirf jo Accounts cell me dikhta hai (via text included)
                if (key === "accounts") {
                  return columnHaystackMatchesFilter(getParticularsText(t, nameMap), rawSearchTerm);
                }

                // User — table cell display name only (hidden ids se cross-hit na ho)
                const userName = resolveLedgerTransactionUserDisplayName(t, userNames);

                // Amount fields
                const { debit, credit } = getTransactionAmounts(t, context, entity, stockView, entityList, processedTaxes);
                const debitStr = formatCurrency(debit, { noSuffix: true, noAnimation: true })?.toString() ?? "";
                const creditStr = formatCurrency(credit, { noSuffix: true, noAnimation: true })?.toString() ?? "";
                const balanceValue =
                    typeof t.balance === "number"
                        ? t.balance
                        : typeof t.runningBalance === "number"
                          ? t.runningBalance
                          : debit - credit;
                const balanceAbsStr = formatCurrency(Math.abs(balanceValue), { noSuffix: true, noAnimation: true })?.toString() ?? "";
                const balanceSide = balanceValue >= 0 ? "Dr" : "Cr";
                const displayVoucherNo = getDisplayVoucherNumber(t);
                const dateBs = d ? formatDateBS(d) : "";
                const dateAd = d ? formatDate(d) : "";
                const filterGroupFirstItem =
                  context === "group" && Array.isArray((entity as { items?: any[] })?.items)
                    ? ((entity as { items?: any[] }).items?.[0] ?? null)
                    : null;
                const filterGroupEntityType =
                  filterGroupFirstItem && "rate" in filterGroupFirstItem && !("accountType" in filterGroupFirstItem)
                    ? ("tax" as const)
                    : filterGroupFirstItem && "salary" in filterGroupFirstItem
                      ? ("staff" as const)
                      : filterGroupFirstItem && context === "group"
                        ? ("party" as const)
                        : undefined;
                const filterContextId =
                  context === "tax" || context === "party" || context === "staff" || context === "group"
                    ? String((entity as { id?: string })?.id ?? "")
                    : undefined;
                const salePurchaseTdsVerifyLabel = isSalePurchaseTdsVerifyLedgerContext(
                  context,
                  filterGroupEntityType
                )
                  ? resolveSalePurchaseTdsVerifyLabel(t, {
                      context,
                      contextId: filterContextId,
                      groupEntityType: filterGroupEntityType,
                    })
                  : null;
                const salePurchaseTdsVerifyCol =
                  salePurchaseTdsVerifyLabel != null
                    ? statementCheckedMessageColumn(debit, credit)
                    : null;
                // Har key sirf usi column ka visible text — kabhi dusri column fields se match mat karo
                const columnFieldsByKey: Record<string, unknown[]> = {
                    syncStatus: [
                      String(t?.__plSyncStatus || "").trim() === "sync_due" ? "sync due pending" : "synced",
                    ],
                    date: [dateBs, dateAd, entryClock].filter(Boolean),
                    date_bs: [dateBs, entryClock].filter(Boolean),
                    date_ad: [dateAd, entryClock].filter(Boolean),
                    type: typeColumnFilterHaystackFields(t, {
                      context,
                      contextId: context === "tax" ? String((entity as { id?: string })?.id ?? "") : undefined,
                      groupEntityType: filterGroupEntityType === "tax" ? "tax" : undefined,
                    }),
                    voucherNumber: [displayVoucherNo],
                    user: [userName],
                    // Each header filter matches ONLY its own column cell (amount + TDS badge text when the badge sits in that column).
                    debit: [
                      debit,
                      debitStr,
                      ...(salePurchaseTdsVerifyCol === "debit" && salePurchaseTdsVerifyLabel
                        ? [salePurchaseTdsVerifyLabel]
                        : []),
                    ],
                    credit: [
                      credit,
                      creditStr,
                      ...(salePurchaseTdsVerifyCol === "credit" && salePurchaseTdsVerifyLabel
                        ? [salePurchaseTdsVerifyLabel]
                        : []),
                    ],
                    status: [t.paymentStatus, t.status, t.isApproved === true ? "approved" : "unapproved"],
                    balance: [balanceValue, Math.abs(balanceValue), balanceAbsStr, `${balanceAbsStr} ${balanceSide}`, balanceSide],
                };
                // Debit/Credit header filters (text input + separate chip keys). Rows that carry a TDS badge are decided on the
                // processed row in TransactionsTable (badge label depends on _tdsSettled/paymentStatus/links, not on this raw row).
                // Rows without a badge: text/chip cannot match (they target the badge in the opposite column); numbers match own amount.
                // Active filters (text and/or chip) are ORed across Debit/Credit.
                if (key === "debit" || key === "credit" || key === "debitChip" || key === "creditChip") {
                  if (salePurchaseTdsVerifyLabel != null) return true;
                  const own = (k: "debit" | "credit") => {
                    const amt = k === "debit" ? debit : credit;
                    return columnFieldValuesHaystack([
                      amt,
                      k === "debit" ? debitStr : creditStr,
                      String(formatCurrency(amt, { noAnimation: true }) ?? ""),
                    ]);
                  };
                  const results = (["debit", "credit"] as const)
                    .map((k) => drCrColumnFilterResult(String(filters[k] ?? ""), String(filters[drCrChipKey(k)] ?? ""), own(k), ""))
                    .filter((r): r is boolean => r !== null);
                  return results.length === 0 || results.some(Boolean);
                }
                // Unknown column key - no match (empty haystack would hide all rows; skip instead)
                if (!Object.prototype.hasOwnProperty.call(columnFieldsByKey, key)) {
                  return true;
                }
                const columnHaystack = columnFieldValuesHaystack(columnFieldsByKey[key] ?? []);

                if (key === "debit" || key === "credit" || key === "balance") {
                    return amountColumnHaystackMatchesFilter(columnHaystack, rawSearchTerm);
                }

                return columnHaystackMatchesFilter(columnHaystack, rawSearchTerm);
              });
            });
        }

        // IMPORTANT: never sort in-place (it causes UI jitter on re-renders)
        // Use a stable, deterministic sort with a final tie-breaker.
        let sorted = filteredByColumn.slice().sort((a, b) => {
            const dateA = safeToDate(a.date)?.getTime() || 0;
            const dateB = safeToDate(b.date)?.getTime() || 0;
            
            if (dateB !== dateA) return dateA - dateB;
            
            const creationA = parseFirestoreDateFieldToJsDate(a.createdAt)?.getTime() ?? 0;
            const creationB = parseFirestoreDateFieldToJsDate(b.createdAt)?.getTime() ?? 0;
            if (creationA !== creationB) return creationA - creationB;

            // Final tie-breaker: id (prevents random reordering when timestamps are equal/missing)
            const idA = String(a.id || "");
            const idB = String(b.id || "");
            return idA.localeCompare(idB);
        });

        // Group page: show contra as two rows — Out (voucherNumberOut) and In (voucherNumberIn)
        if (context === 'group' && entity && 'items' in entity) {
          const memberIdsInGroup = new Set(((entity as EntityWithItems).items || []).map((i: any) => i.id));
          const expanded: any[] = [];
          for (const t of sorted) {
            if (t.type === 'contra') {
              if (memberIdsInGroup.has(t.fromAccountId)) {
                expanded.push({ ...t, id: `${t.id}-out`, _baseVoucherId: t.id, voucherNumber: t.voucherNumberOut ?? t.voucherNumber, _contraLeg: 'out' });
              }
              if (memberIdsInGroup.has(t.toAccountId)) {
                expanded.push({ ...t, id: `${t.id}-in`, _baseVoucherId: t.id, voucherNumber: t.voucherNumberIn ?? t.voucherNumber, _contraLeg: 'in' });
              }
              if (!memberIdsInGroup.has(t.fromAccountId) && !memberIdsInGroup.has(t.toAccountId)) {
                expanded.push(t);
              }
            } else {
              expanded.push(t);
            }
          }
          sorted = expanded;
        }

        const totalTransactions = sorted.length;
        let initialOpeningBalance: number = 0;
        
        if (context === 'group' && 'items' in entity) {
          const groupEntity = entity as EntityWithItems;
          const firstItem = groupEntity.items?.[0];
          
          const isItemGroup = firstItem && ('purchasePrice' in firstItem || 'salePrice' in firstItem || 'stockQty' in firstItem || 'openingBalanceRate' in firstItem);
          
          // Get the group's own opening balance if it exists (from processedStaffGroups, processedTaxGroups, etc.)
          const groupOpeningBalance = (groupEntity as any).openingBalance !== undefined ? Number((groupEntity as any).openingBalance) || 0 : 0;

          // Sum opening balances from items (staff, taxes, accounts, etc.)
          const itemsOpeningBalance = (groupEntity.items || []).reduce((sum: number, item: any) => {
              if (isItemGroup && stockView === 'amount') {
                  return sum + (Number(item.openingBalance) || 0) * (Number(item.openingBalanceRate) || 0);
              } 
              else {
                  // For staff, taxes, accounts, etc., use their openingBalance field
                  return sum + (Number(item.openingBalance) || 0);
              }
          }, 0);
          
          // Scoped members: sum their opening balances (0 is valid — do not fall back to group OB).
          initialOpeningBalance =
            (groupEntity.items || []).length > 0 ? itemsOpeningBalance : groupOpeningBalance;

        } else if (context === 'item' && entity) {
            // Item context: always compute from openingBalance/openingBalanceRate (handles number, string from Firestore)
            const openingBalanceDate = safeToDate((entity as any).openingBalanceDate);
            const rangeFrom = dateRange?.from ? startOfDay(dateRange.from) : null;
            const rangeTo = dateRange?.to
              ? startOfDay(dateRange.to)
              : rangeFrom;
            // OB sirf tab skip jab poora filter OB date se pehle khatam ho ("All" from<<OB pe books OB mat hatao).
            const openingNotInSelectedRange =
              Boolean(openingBalanceDate && rangeTo && openingBalanceDate > rangeTo);
            if (!openingNotInSelectedRange) {
                if (stockView === 'amount') {
                    const obQty = Number((entity as any).openingBalance) || 0;
                    const obRate = Number((entity as any).openingBalanceRate) || 0;
                    initialOpeningBalance = obQty * obRate;
                } else if (stockView === 'qty') {
                    // This is the fix. Convert opening balance qty to smallest unit
                    const item = entity as Item;
                    const conversions = (item.unitConversions || []) as any[];
                    const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');
                    
                    const getFactor = (unit: string) => {
                         if (!unit || conversions.length === 0) return 1;
                         if (unit === smallestUnit) return 1;
                         let factor = 1;
                         let currentUnit = unit;
                         for (let i=0; i < 10; i++) {
                            const conv = conversions.find((c:any) => c.fromUnit === currentUnit);
                            if (!conv) return 0; 
                            factor *= Number(conv.conversionFactor) || 1;
                            currentUnit = conv.toUnit;
                            if (currentUnit === smallestUnit) break;
                         }
                         return factor;
                    };
                    const openingUnit = (item as any).openingBalanceUnit || '';
                    const factor = getFactor(openingUnit);
                    initialOpeningBalance = (Number((entity as any).openingBalance) || 0) * factor;
                }
            }
        } else if (entity && 'openingBalance' in entity) {
            // Party/Staff (and similar): accept number or string from Firestore so bill-wise opening balance computes and shows
            const obVal = Number((entity as any).openingBalance) || 0;
            const openingBalanceDate = safeToDate((entity as any).openingBalanceDate);
            const rangeFrom = dateRange?.from ? startOfDay(dateRange.from) : null;
            const rangeTo = dateRange?.to
              ? startOfDay(dateRange.to)
              : rangeFrom;
            // "All" preset from = calendar min — OB date > from hota hai; pehle yahan OB 0 ho jata tha
            // → header closing galat, table Book Opening alag. Skip sirf jab range OB se pehle khatam.
            const openingNotInSelectedRange =
              Boolean(openingBalanceDate && rangeTo && openingBalanceDate > rangeTo);
            if (!openingNotInSelectedRange) {
                if ('type' in entity && entity.type === 'service' && stockView === 'amount') {
                    initialOpeningBalance = obVal;
                } else {
                    initialOpeningBalance = obVal;
                }
            }
        }


        const effectiveDateRange = dateRange;
        const atFyStartFilter = effectiveDateRange?.from
            ? isLedgerDateFilterFromAtFyStart(company?.country, effectiveDateRange)
            : false;
        const fullLocalVoucherMirror = hasFullLocalLedgerVoucherMirror(
          company,
          fy.activeScope
        );
        // FY-start filter + full local mirror (no server snapshot): opening = book OB + walk, same as the full-ledger chain.
        const periodOpeningBase = atFyStartFilter && !fullLocalVoucherMirror ? 0 : initialOpeningBalance;
        const requiresAuthoritativeOpening =
            !fullLocalVoucherMirror &&
            company != null &&
            isCloudLinkedCompanyStorage(company) &&
            Boolean(effectiveDateRange?.from) &&
            (fy.enabled || atFyStartFilter);

        let openingBalanceForPeriod = periodOpeningBase;
        let periodOpeningUnavailable = false;
        let periodOpeningLoading = false;
        let transactionsToDisplay = sorted;
        const isDefaultLedgerView = !effectiveDateRange?.from && !effectiveDateRange?.to;

        const openingBalanceDateForEntity = safeToDate((entity as any)?.openingBalanceDate);
        const taxLedgerEntityIdForBalance =
          context === "tax" && entity && typeof entity === "object" && "id" in entity
            ? String((entity as { id?: string }).id || "").trim()
            : "";
        const taxGroupMemberIdsForBalance =
          context === "group" && entity && "items" in entity
            ? (() => {
                const items = ((entity as EntityWithItems).items || []) as any[];
                const first = items[0];
                const isTaxGrp = !!(first && "rate" in first && !("accountType" in first));
                return isTaxGrp
                  ? items.map((it) => String(it?.id || "").trim()).filter(Boolean)
                  : ([] as string[]);
              })()
            : ([] as string[]);
        /** Display amounts stay full; books / closing walk skips Unverified TDS legs. */
        const amountsForBooksBalance = (t: any, amounts: { debit: number; credit: number }) => {
          if (taxLedgerEntityIdForBalance) {
            return taxLedgerBooksBalanceAmounts(t, taxLedgerEntityIdForBalance, amounts);
          }
          if (taxGroupMemberIdsForBalance.length > 0) {
            let debit = 0;
            let credit = 0;
            for (const taxId of taxGroupMemberIdsForBalance) {
              const part = getTaxTransactionAmounts(t, taxId, entityList || []);
              const bal = taxLedgerBooksBalanceAmounts(t, taxId, part);
              debit += bal.debit;
              credit += bal.credit;
            }
            return { debit, credit };
          }
          return amounts;
        };
        const isPrePeriodLedgerTxn = (t: any, beforeDate: Date) => {
            const transactionDate = safeToDate(t.date);
            if (!transactionDate) return false;
            // FY-start filter: match All-view divider (book OB + all pre-FY vouchers).
            if (
              (!atFyStartFilter || fullLocalVoucherMirror) &&
              openingBalanceDateForEntity &&
              transactionDate < openingBalanceDateForEntity
            ) {
              return false;
            }
            // Full-ledger chain (fullBooksBalanceByVoucherId) does not move on unapproved inter-company rows.
            if (
              fullLocalVoucherMirror &&
              (t as { type?: string }).type === "inter_company" &&
              (t as { isApproved?: boolean }).isApproved !== true
            ) {
              return false;
            }
            if (
              context === "daybook" &&
              daybookUserIdFilter &&
              String((t as any).userId || "") !== String(daybookUserIdFilter)
            ) {
              return false;
            }
            return transactionDate < beforeDate;
        };
        const reducePrePeriodOpening = (beforeDate: Date, base = periodOpeningBase) =>
          sorted
            .filter((t) => isPrePeriodLedgerTxn(t, beforeDate))
            .reduce((balance, t) => {
              const amounts = amountsForBooksBalance(
                t,
                getTransactionAmounts(t, context, entity, stockView, entityList, processedTaxes)
              );
              return balance + amounts.debit - amounts.credit;
            }, base);

        if (effectiveDateRange?.from) {
            const fromDate = startOfDay(effectiveDateRange.from);

            if (!requiresAuthoritativeOpening) {
              openingBalanceForPeriod = reducePrePeriodOpening(fromDate);
            }

            const toDate = effectiveDateRange.to ? endOfDay(effectiveDateRange.to) : endOfDay(effectiveDateRange.from);
            transactionsToDisplay = sorted.filter(t => {
                const transactionDate = safeToDate(t.date);
                return transactionDate && transactionDate >= fromDate && transactionDate <= toDate;
            });

            // Daybook: table + summary ke liye selected din par sirf chosen user ke vouchers
            if (context === "daybook" && daybookUserIdFilter) {
                transactionsToDisplay = transactionsToDisplay.filter(
                    (t: any) => String(t.userId || "") === String(daybookUserIdFilter)
                );
            }

        } else if (isDefaultLedgerView && sorted.length > 0) {
            // Last N / default master view: carry-forward from book OB through vouchers before the
            // first visible row — do not anchor on FY scope snapshot (partial window ≠ books OB).
            const firstInScopeTxn = sorted.find((t) => {
              const transactionDate = safeToDate(t.date);
              if (!transactionDate) return false;
              if (
                openingBalanceDateForEntity &&
                transactionDate < openingBalanceDateForEntity
              ) {
                return false;
              }
              if (
                context === "daybook" &&
                daybookUserIdFilter &&
                String((t as any).userId || "") !== String(daybookUserIdFilter)
              ) {
                return false;
              }
              return true;
            });
            const firstDate = firstInScopeTxn ? safeToDate(firstInScopeTxn.date) : null;
            if (firstDate) {
              openingBalanceForPeriod = reducePrePeriodOpening(startOfDay(firstDate));
            }
        }

        if (
            entity &&
            "id" in entity &&
            ["party", "account", "staff", "tax", "item", "expense"].includes(context) &&
            (fy.enabled || atFyStartFilter || Boolean(effectiveDateRange?.from))
        ) {
            const entityId = String((entity as any).id);
            const snapOb = extractEntityBalanceFromFySnapshot(fy.openingBalances, entityId);
            if (requiresAuthoritativeOpening) {
              if (snapOb != null && Number.isFinite(snapOb)) {
                openingBalanceForPeriod = snapOb;
              } else if (fy.openingBalancesLoadStatus === "unavailable") {
                openingBalanceForPeriod = 0;
                periodOpeningUnavailable = true;
              } else if (fy.openingBalancesLoadStatus === "loading") {
                openingBalanceForPeriod = 0;
                periodOpeningLoading = true;
              }
            } else if (
              !fullLocalVoucherMirror &&
              Boolean(effectiveDateRange?.from) &&
              snapOb != null &&
              Number.isFinite(snapOb)
            ) {
              // Explicit date/month filter: scope snapshot may replace local pre-period walk.
              openingBalanceForPeriod = snapOb;
            }
        }

        const skipRunningBalanceForDaybookRecent =
            skipRunningBalance === true && context === "daybook";

        /** FY merge / full SQLite mirror: books running balance = walk all entity txns (filters don't reset chain). */
        const fullBooksBalanceByVoucherId = new Map<string, number>();
        if (!skipRunningBalanceForDaybookRecent && fullLocalVoucherMirror && sorted.length > 0) {
          let booksRunning = Number(initialOpeningBalance) || 0;
          for (const t of sorted) {
            const transactionDate = safeToDate(t.date);
            if (
              openingBalanceDateForEntity &&
              transactionDate &&
              transactionDate < openingBalanceDateForEntity
            ) {
              continue;
            }
            if (
              context === "daybook" &&
              daybookUserIdFilter &&
              String((t as any).userId || "") !== String(daybookUserIdFilter)
            ) {
              continue;
            }
            const rawAmounts = getTransactionAmounts(t, context, entity, stockView, entityList, processedTaxes);
            const amounts = amountsForBooksBalance(t, rawAmounts);
            if (
              context !== "daybook" &&
              context !== "other" &&
              rawAmounts.debit === 0 &&
              rawAmounts.credit === 0 &&
              t.type !== "note"
            ) {
              const entityIdForIc =
                entity && typeof entity === "object" && "id" in entity
                  ? String((entity as { id?: string }).id || "")
                  : "";
              const keepIcPlaceholder =
                entityIdForIc &&
                keepUnapprovedInterCompanyLedgerPlaceholderRow(
                  t as Record<string, unknown>,
                  context,
                  entityIdForIc
                );
              if (!keepIcPlaceholder) continue;
            }
            if (t.type === "inter_company" && (t as { isApproved?: boolean }).isApproved !== true) {
              const id = String(t.id || "");
              if (id) fullBooksBalanceByVoucherId.set(id, booksRunning);
              continue;
            }
            booksRunning += amounts.debit - amounts.credit;
            const id = String(t.id || "");
            if (id) fullBooksBalanceByVoucherId.set(id, booksRunning);
          }
        }
        
        let runningBalance = openingBalanceForPeriod;
        // For journal "all" view, calculate cumulative balance differently
        const isJournalAllView = context === 'group' && entity && entity.id === 'all' && (entity as any).accountType === 'journal_view';

        const isDaybookContext = context === 'daybook';
        const firstItemForContext = context === 'group' && entity && 'items' in entity ? ((entity as EntityWithItems).items || [])[0] : null;
        const isTaxGroupContext = !!(firstItemForContext && 'rate' in firstItemForContext && !('accountType' in firstItemForContext));
        const isTaxContext = context === 'tax' || context === 'tax_group' || isTaxGroupContext;
        // Tax group uses the generic "group" context, but it should build bill-wise
        // indexes only when its Status column is active.
        const isBillWiseContext = context === 'party' || (context === 'group' && !isTaxGroupContext);
        const isStaffContext = context === 'staff' || (context === 'group' && !isTaxGroupContext);
        const needsTaxBillWiseStatus = isTaxContext && includeTaxBillWiseStatus;
        const isExpenseContext = context === 'expense';
        const allocatedBySale = (isBillWiseContext || needsTaxBillWiseStatus || isExpenseContext) ? getAllocatedByVoucherId(vouchers) : new Map<string, number>();
        const allocatedByPurchase = (isBillWiseContext || isStaffContext || needsTaxBillWiseStatus || isExpenseContext) ? getAllocatedByVoucherIdFromPaymentOuts(vouchers) : new Map<string, number>();
        const allocatedToSaleFromPurchase = (isBillWiseContext || needsTaxBillWiseStatus || isExpenseContext) ? getAllocatedByVoucherIdFromPurchase(vouchers) : new Map<string, number>();
        const allocatedToPurchaseFromSale = (isBillWiseContext || isStaffContext || needsTaxBillWiseStatus || isExpenseContext) ? getAllocatedByVoucherIdFromSale(vouchers) : new Map<string, number>();
        // Journal bill-wise link: journal se sale/purchase ko allocate hone wala amount – PUR row balance update ke liye.
        const allocatedFromJournal = (isBillWiseContext || needsTaxBillWiseStatus || isExpenseContext) ? getAllocatedByVoucherIdFromJournal(vouchers) : new Map<string, number>();
        const billWiseIncomingMaps =
          isBillWiseContext || needsTaxBillWiseStatus || isExpenseContext
            ? buildBillWiseIncomingAllocationMaps(vouchers ?? [])
            : null;
        // TDS-leg settlement (TDS Paid/Unpaid badge): TDS-leg links + party-side links beyond total - TDS.
        const tdsSettleMaps = billWiseIncomingMaps ?? buildBillWiseIncomingAllocationMaps(vouchers ?? []);
        const tdsLegAllocByTarget = getTdsLegAllocatedByTargetId(vouchers ?? []);
        const entityIdForLinks = entity && 'id' in entity ? (entity as any).id : undefined;
        // Keep Journal link visibility entity-aware (party/staff/account), same behavior users expect from payment in/out flow.
        const shouldScopeJournalLinksByEntity =
          context === 'party' || context === 'staff' || context === 'account' || context === 'expense';
        // Match a linked voucher against current ledger entity so voucher nos don't leak into unrelated account rows.
        const isVoucherForCurrentEntity = (v: any) => {
            if (!shouldScopeJournalLinksByEntity || !entityIdForLinks) return true;
            const currentId = String(entityIdForLinks);
            if (context === 'party') {
                if (String((v as any)?.partyId ?? '') === currentId) return true;
                if ((v as any)?.type === 'adjustment' && String((v as any)?.adjustmentTarget?.id ?? '') === currentId)
                  return true;
                if ((v as any)?.type === 'inter_company' && interCompanyVoucherTouchesEntity(v, currentId, 'party')) return true;
                if ((v as any)?.type === 'contra' && ((v as any).fromAccountId === currentId || (v as any).toAccountId === currentId))
                  return true;
                if (isJournalLikeVoucher(v as any))
                    return (v as any).entries.some((e: any) => String(e?.accountId ?? '') === currentId);
                return false;
            }
            if (context === 'staff') {
                if (String((v as any)?.staffId ?? '') === currentId) return true;
                if ((v as any)?.type === 'adjustment' && String((v as any)?.adjustmentTarget?.id ?? '') === currentId)
                  return true;
                if ((v as any)?.type === 'inter_company' && interCompanyVoucherTouchesEntity(v, currentId, 'staff')) return true;
                if (isJournalLikeVoucher(v as any))
                    return (v as any).entries.some((e: any) => String(e?.accountId ?? '') === currentId);
                return false;
            }
            if (context === 'account') {
                if ((v as any)?.type === 'adjustment' && String((v as any)?.adjustmentTarget?.id ?? '') === currentId)
                  return true;
                return (
                    String((v as any)?.accountId ?? '') === currentId ||
                    ((v as any)?.type === 'inter_company' && interCompanyVoucherTouchesEntity(v, currentId, 'bank')) ||
                    String((v as any)?.fromAccountId ?? '') === currentId ||
                    String((v as any)?.toAccountId ?? '') === currentId ||
                    String((v as any)?.bankAccountId ?? '') === currentId ||
                    (isJournalLikeVoucher(v as any) &&
                        (v as any).entries.some((e: any) => String(e?.accountId ?? '') === currentId))
                );
            }
            if (context === 'expense') {
                if (String((v as any)?.expenseAccountId ?? '') === currentId) return true;
                if (String((v as any)?.incomeAccountId ?? '') === currentId) return true;
                if (
                  (v as any)?.type === 'payment_out' &&
                  String((v as any)?.otherChargeAccountId ?? '') === currentId
                ) {
                  return true;
                }
                if (
                  (v as any)?.type === 'direct_expense' &&
                  String((v as any)?.otherChargeAccountId ?? '') === currentId
                ) {
                  return true;
                }
                if ((v as any)?.type === 'inter_company' && interCompanyVoucherTouchesEntity(v, currentId, 'expense'))
                  return true;
                if (isJournalLikeVoucher(v as any))
                  return (v as any).entries.some((e: any) => String(e?.accountId ?? '') === currentId);
                return false;
            }
            return true;
        };

        /** Har row par pura `vouchers` scan = O(rows×vouchers) — bill-wise linked status + sums par UI freeze fix; ek hi pass me indexes. */
        const voucherById = new Map<string, any>();
        const allocEdgesByTargetId = new Map<string, Array<{ src: any; alloc: unknown }>>();
        const spendWisePayOutsByLinkedReceiptId = new Map<string, any[]>();
        if (!isDaybookContext && (!isTaxContext || includeTaxBillWiseStatus)) {
          for (const v of vouchers as any[]) {
            const vid = String(v?.id ?? "");
            if (vid) voucherById.set(vid, v);

            const allocs = (v.allocations as { voucherId?: string }[] | undefined) ?? [];
            for (const alloc of allocs) {
              const tid = alloc?.voucherId;
              if (tid === undefined || tid === null || String(tid).trim() === "") continue;
              const tk = String(tid);
              const edges = allocEdgesByTargetId.get(tk);
              const edge = { src: v, alloc };
              if (edges) edges.push(edge);
              else allocEdgesByTargetId.set(tk, [edge]);
            }

            const linkedInIds = (v.linkedPaymentInIds as string[] | undefined) ?? [];
            for (const rid of linkedInIds) {
              const rk = String(rid);
              const arr = spendWisePayOutsByLinkedReceiptId.get(rk);
              if (arr) arr.push(v);
              else spendWisePayOutsByLinkedReceiptId.set(rk, [v]);
            }
          }
        }

        const isStaffSalaryBillWiseSource = (v: any) =>
          v?.type === "payment_out" ||
          v?.type === "direct_expense" ||
          isRegularJournalLikeVoucher(v);

        const getStaffAddSalaryNetAllocated = (salaryVoucherId: string, staffAccountId: string) =>
          (allocEdgesByTargetId.get(String(salaryVoucherId)) ?? []).reduce((sum, { src, alloc }) => {
            if (!isStaffSalaryBillWiseSource(src)) return sum;
            const target = voucherById.get(String(salaryVoucherId));
            return (
              sum +
              getAllocationAmountForEntityScope(
                alloc as any,
                { entityKind: "staff", accountId: String(staffAccountId || "") },
                target
              )
            );
          }, 0);

        const getStaffAddSalaryTaxAllocated = (salaryVoucherId: string, taxAccountId: string) =>
          (allocEdgesByTargetId.get(String(salaryVoucherId)) ?? []).reduce((sum, { src, alloc }) => {
            if (!isStaffSalaryBillWiseSource(src)) return sum;
            const target = voucherById.get(String(salaryVoucherId));
            return (
              sum +
              getAllocationAmountForEntityScope(
                alloc as any,
                { entityKind: "tax", accountId: String(taxAccountId || "") },
                target
              )
            );
          }, 0);

        const withBalance = transactionsToDisplay
            .map(t => {
                const amounts = getTransactionAmounts(t, context, entity, stockView, entityList, processedTaxes);
                const booksAmounts = amountsForBooksBalance(t, amounts);
                
                // Filter out transactions with zero amounts for individual accounts/groups (so irrelevant txns don't show)
                // Exception: Note vouchers; unapproved IC placeholder (pink row, balance 0) — bank approve se pehle
                if (context !== 'daybook' && context !== 'other' && amounts.debit === 0 && amounts.credit === 0 && t.type !== 'note') {
                    const entityIdForIc =
                      entity && typeof entity === 'object' && 'id' in entity ? String((entity as { id?: string }).id || '') : '';
                    const keepIcPlaceholder =
                      entityIdForIc &&
                      keepUnapprovedInterCompanyLedgerPlaceholderRow(t as Record<string, unknown>, context, entityIdForIc);
                    if (!keepIcPlaceholder) return null;
                }
                
                if (!skipRunningBalanceForDaybookRecent) {
                  const booksBalance = fullBooksBalanceByVoucherId.get(String(t.id || ""));
                  if (booksBalance != null && Number.isFinite(booksBalance)) {
                    runningBalance = booksBalance;
                  } else if (isJournalAllView && (t.type === 'journal' || t.type === 'adjustment')) {
                      // For journal transactions in "all" view, running balance should remain at opening balance
                      // Since journals balance (debit = credit), debit - credit = 0, so balance doesn't change
                      runningBalance += booksAmounts.debit - booksAmounts.credit; // This will be 0 for balanced journal entries
                  } else if (t.type === "inter_company" && (t as { isApproved?: boolean }).isApproved !== true) {
                      // IC unapproved — row dikhe, balance approve tak mat badlo
                  } else {
                      runningBalance += booksAmounts.debit - booksAmounts.credit;
                  }
                }

                // Bill-wise status and outstanding for sale/purchase in party/group/daybook context
                let paymentStatus: string | undefined;
                let isOverdue = false;
                let outstanding: number | undefined;
                if (
                  billWiseIncomingMaps &&
                  (isBillWiseContext || needsTaxBillWiseStatus || isExpenseContext) &&
                  isSaleOrPurchaseBillVoucherType(t.type)
                ) {
                    if (needsTaxBillWiseStatus && entity && "id" in entity) {
                      const taxId = String((entity as any).id || "");
                      // VAT/Sales Tax → taxAccountId; TDS → tdsAccountId (same as getTaxTransactionAmounts).
                      const total = Array.isArray((t as any).lineItems)
                        ? (t as any).lineItems.reduce((s: number, li: any) => {
                            if (String(li?.taxAccountId ?? "") === taxId) {
                              return s + (Number(li?.taxAmount) || 0);
                            }
                            if (String(li?.tdsAccountId ?? "") === taxId) {
                              return s + (Number(li?.tdsAmount) || 0);
                            }
                            return s;
                          }, 0)
                        : Number((t as any).taxAmount) || 0;
                      const allocated = (allocEdgesByTargetId.get(String(t.id)) ?? []).reduce(
                        (sum, { alloc }) =>
                          sum +
                          Math.max(
                            getAllocationAmountForEntityScope(
                              alloc as any,
                              { entityKind: "tax", accountId: taxId },
                              t
                            ),
                            getAllocationAmountForEntityScope(
                              alloc as any,
                              { entityKind: "tds", accountId: taxId },
                              t
                            )
                          ),
                        0
                      );
                      const result = getPaymentStatusResult(total, allocated, t.dueDate);
                      paymentStatus = result.isOverdue ? "overdue" : result.status;
                      isOverdue = result.isOverdue;
                      outstanding = result.outstanding;
                      // TDS-account rows (Sale TDS / Pur TDS) of Sale/Purchase: verified => Paid; else follow the PARTY status,
                      // except a fully paid party shows Partial (TDS itself is not yet verified).
                      const tdsForThisTax = Array.isArray((t as any).lineItems)
                        ? (t as any).lineItems.reduce(
                            (s: number, li: any) =>
                              String(li?.tdsAccountId ?? "") === taxId ? s + (Number(li?.tdsAmount) || 0) : s,
                            0
                          )
                        : 0;
                      if (tdsForThisTax > 0) {
                        if ((t as any).isTdsVerified === true) {
                          paymentStatus = "paid";
                          isOverdue = false;
                          outstanding = 0;
                        } else {
                          const partyAllocatedForTds = Math.max(
                            0,
                            getBillWiseAllocatedToTargetWithMaps(t, String(t.id), billWiseIncomingMaps) -
                              (tdsLegAllocByTarget.get(String(t.id)) ?? 0)
                          );
                          const partyRes = getPaymentStatusResult(
                            getSalePurchasePartyLinkTarget(t),
                            partyAllocatedForTds,
                            t.dueDate
                          );
                          if (partyRes.status === "paid" && !partyRes.isOverdue) paymentStatus = "partially_paid";
                          else paymentStatus = partyRes.isOverdue ? "overdue" : partyRes.status;
                          isOverdue = partyRes.isOverdue;
                          outstanding = tdsForThisTax;
                        }
                      }
                    } else {
                      // Row balance = net (total - TDS) - party-leg links. TDS-leg links only settle the TDS badge, not the party balance.
                      const total = getSalePurchaseBillWiseTargetTotal(t);
                      const allocated = getBillWiseAllocatedToTargetWithMaps(
                        t,
                        String(t.id),
                        billWiseIncomingMaps
                      );
                      const partyAllocated = Math.max(0, allocated - (tdsLegAllocByTarget.get(String(t.id)) ?? 0));
                      const result = getPaymentStatusResult(getSalePurchasePartyLinkTarget(t), partyAllocated, t.dueDate);
                      paymentStatus = result.isOverdue ? "overdue" : result.status;
                      isOverdue = result.isOverdue;
                      outstanding = Math.max(0, total - partyAllocated);
                    }
                }
                let tdsSettled: number | undefined;
                if (isSaleOrPurchaseBillVoucherType(t.type) && sumVoucherLineTds(t as any) > 0) {
                  tdsSettled = getSalePurchaseTdsSettledAmount(
                    t as any,
                    getBillWiseAllocatedToTargetWithMaps(t, String(t.id), tdsSettleMaps),
                    tdsLegAllocByTarget.get(String(t.id)) ?? 0
                  );
                  // Voucher 'Verify TDS' tick = TDS marked Paid without a journal (status only).
                  if ((t as any).isTdsVerified === true) tdsSettled = sumVoucherLineTds(t as any);
                }
                // Bill-wise: payment_in / payment_out - Settled when remaining 0. getPaymentInRemaining already includes t.allocations (journal link bilateral sync ke baad bhi).
                if (isBillWiseContext && (t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense')) {
                    let remaining = t.type === 'payment_in' || t.type === 'direct_income' ? getPaymentInRemaining(t) : getPaymentOutRemaining(t);
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Inter Company — bill-wise: Payment (Dr) / Payment In (Cr) jaisa per-row outstanding + Paid/Unpaid/Settled
                if (isBillWiseContext && t.type === 'inter_company') {
                    const icDebit = Number(amounts.debit) || 0;
                    const icCredit = Number(amounts.credit) || 0;
                    const remaining =
                        icDebit > 0 ? getPaymentOutRemaining(t) : icCredit > 0 ? getPaymentInRemaining(t) : 0;
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Bank/Cash account ledger: show Settled/Partial/Unpaid for payment_in, payment_out, direct_income, direct_expense
                if (context === 'account' && (t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense')) {
                    let remaining = t.type === 'payment_in' || t.type === 'direct_income' ? getPaymentInRemaining(t) : getPaymentOutRemaining(t);
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Contra: in account context use Out number on from-account, In number on to-account
                const displayVoucherNumber =
                    t.type === "contra" && context === "account" && entity && "id" in entity
                        ? entity.id === t.fromAccountId
                            ? (t.voucherNumberOut ?? t.voucherNumber)
                            : (t.voucherNumberIn ?? t.voucherNumber)
                        : t.type === "inter_company"
                          ? formatInterCompanyLedgerVoucherNumber(t as Record<string, unknown>)
                          : (t.voucherNumber ?? (t as any).voucher_number);
                // Preserve which contra leg user clicked in account ledger so edit dialog can show same current voucher leg.
                const clickedContraLeg = (t.type === 'contra' && context === 'account' && entity && 'id' in entity)
                    ? (entity.id === t.fromAccountId ? 'out' : entity.id === t.toAccountId ? 'in' : (t as any)._contraLeg)
                    : (t as any)._contraLeg;
                // Preserve ledger entity id (bank / party / staff) so Journal bill-wise sirf usi account ki Dr/Cr side use kare.
                const openedFromEntityId =
                    entity && 'id' in entity ? String((entity as any).id || "") : "";
                const openedFromAccountId =
                    context === 'account' && openedFromEntityId
                        ? openedFromEntityId
                        : context === 'party' &&
                            openedFromEntityId &&
                            !['all', 'sales_account', 'purchase_account'].includes(openedFromEntityId)
                          ? openedFromEntityId
                          : context === 'staff' && openedFromEntityId && openedFromEntityId !== 'all'
                            ? openedFromEntityId
                            : undefined;
                // Tax account ledger: show Paid/Partial/Unpaid for payment_in, payment_out, direct_income, direct_expense involving this tax
                if (needsTaxBillWiseStatus && (t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense')) {
                    const remaining = t.type === 'payment_in' || t.type === 'direct_income' ? getPaymentInRemaining(t) : getPaymentOutRemaining(t);
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Income & Expense account ledger: show Paid/Partial/Unpaid for payment_in, payment_out, direct_income, direct_expense
                if (context === 'expense' && (t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense')) {
                    const remaining = t.type === 'payment_in' || t.type === 'direct_income' ? getPaymentInRemaining(t) : getPaymentOutRemaining(t);
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Add Salary net (linkable) total: staff credits only; tax credits are linked separately. Payment outs link to net.
                const getAddSalaryNetTotal = (v: any) => {
                    if (!Array.isArray(v.entries) || v.entries.length === 0) return Number(v.total ?? v.amount ?? 0) || 0;
                    return v.entries
                        .filter((e: any) => (Number(e.credit) || 0) > 0 && !String(e.narration || '').includes('(Staff ID:'))
                        .reduce((s: number, e: any) => s + (Number(e.credit) || 0), 0);
                };
                // Staff ledger: Add Salary behaves like a bill – paid via Payment and/or Opening Balance; show Paid/Unpaid/Partial/Overdue.
                if (isStaffContext && t.type === 'journal' && t.subType === 'add_salary') {
                    const staffAccountId = entity && 'id' in entity ? String((entity as any).id || '') : '';
                    const total = getAddSalaryNetTotal(t);
                    // Payment out, direct expense, and manual journal Dr → salary links all reduce outstanding.
                    const allocated =
                      getStaffAddSalaryNetAllocated(t.id, staffAccountId) +
                      (Number((t as any).openingBalanceAllocated) || 0);
                    const result = getPaymentStatusResult(total, allocated, t.dueDate);
                    paymentStatus = result.isOverdue ? 'overdue' : result.status;
                    isOverdue = result.isOverdue;
                    outstanding = result.outstanding;
                }
                // Staff ledger: Payment / Direct Expense – outstanding = amount not yet linked to salary (for bill-wise balance column)
                if (isStaffContext && (t.type === 'payment_out' || t.type === 'direct_expense')) {
                    outstanding = getPaymentOutRemaining(t);
                }
                // Staff ledger: Payment In / Direct Income – show Paid/Partial/Unpaid so RCPT status is not "-" in staff details
                if (isStaffContext && (t.type === 'payment_in' || t.type === 'direct_income')) {
                    const remaining = getPaymentInRemaining(t);
                    const hasAllocations = ((t.allocations as { voucherId: string; amount: number }[] | undefined) || []).length > 0;
                    if (remaining <= 0) {
                        paymentStatus = 'paid';
                        isOverdue = false;
                        outstanding = 0;
                    } else if (hasAllocations) {
                        paymentStatus = 'partially_paid';
                        outstanding = remaining;
                    } else {
                        paymentStatus = 'unpaid';
                        outstanding = remaining;
                    }
                }
                // Tax ledger: Add Salary — total = is tax account ka credit (staff net nahi)
                if (needsTaxBillWiseStatus && t.type === 'journal' && t.subType === 'add_salary') {
                    const taxId = entity && 'id' in entity ? String((entity as any).id || '') : '';
                    const total = Array.isArray(t.entries)
                      ? t.entries
                          .filter(
                            (e: any) =>
                              String(e?.accountId ?? '') === taxId && (Number(e.credit) || 0) > 0
                          )
                          .reduce((s: number, e: any) => s + (Number(e.credit) || 0), 0)
                      : Number(amounts.credit) || 0;
                    const allocated = getStaffAddSalaryTaxAllocated(t.id, taxId);
                    const result = getPaymentStatusResult(total, allocated, t.dueDate);
                    paymentStatus = result.isOverdue ? 'overdue' : result.status;
                    isOverdue = result.isOverdue;
                    outstanding = result.outstanding;
                }
                // Income & Expense ledger: Add Salary – show Paid/Unpaid/Partial/Overdue same as staff
                if (isExpenseContext && t.type === 'journal' && t.subType === 'add_salary') {
                    const total = getAddSalaryNetTotal(t);
                    const allocated = allocatedByPurchase.get(t.id) ?? 0;
                    const result = getPaymentStatusResult(total, allocated, t.dueDate);
                    paymentStatus = result.isOverdue ? 'overdue' : result.status;
                    isOverdue = result.isOverdue;
                    outstanding = result.outstanding;
                }

                // Linked voucher numbers for Status column: "from X , to Y"
                let linkedFromVoucherNos: string[] = [];
                let linkedToVoucherNos: string[] = [];
                // Staff ledger should show linked voucher detail for both receipt and payment rows.
                const staffShowLinkDetails = isStaffContext && (
                    (t.type === 'journal' && t.subType === 'add_salary') ||
                    (t.type === 'journal' &&
                      Array.isArray((t as any).entries) &&
                      entityIdForLinks &&
                      (t as any).entries.some((e: any) => String(e?.accountId ?? '') === String(entityIdForLinks))) ||
                    (t.type === 'adjustment' &&
                      entityIdForLinks &&
                      String((t as any)?.adjustmentTarget?.id ?? '') === String(entityIdForLinks)) ||
                    t.type === 'payment_in' ||
                    t.type === 'direct_income' ||
                    t.type === 'payment_out' ||
                    t.type === 'direct_expense'
                );
                if ((isBillWiseContext || context === 'account' || needsTaxBillWiseStatus || context === 'expense' || staffShowLinkDetails) && (paymentStatus != null || t.type === 'sale' || t.type === 'purchase' || t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense' || t.type === 'journal' || t.type === 'adjustment' || t.type === 'inter_company')) {
                    if (t.type === 'sale' || t.type === 'purchase') {
                        const payTypes = t.type === 'sale' ? ['payment_in', 'direct_income', 'purchase', 'purchase_service', 'journal', 'adjustment', 'inter_company'] : ['payment_out', 'direct_expense', 'sale', 'sale_service', 'journal', 'adjustment', 'inter_company'];
                        const partyId = String((t as any).partyId ?? '');
                        const taxIdForLinks =
                          needsTaxBillWiseStatus && entity && "id" in entity
                            ? String((entity as any).id || "")
                            : "";
                        /** Ek source voucher se multiple allocations same target ko push na duplice kare — pehle `some()` jaisa ek no per source */
                        const seenSrcForLinkedFrom = new Set<string>();
                        for (const { src: v, alloc } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (!payTypes.includes(v.type)) continue;
                            // Tax ledger: any allocation to this bill (tax/TDS/plain) shows under Status.
                            // Do not use partyId filter with tax entityId — that hid Paid purchase links.
                            if (taxIdForLinks) {
                              if (getAllocationTotal(alloc as any) <= 0) continue;
                            } else if (entityIdForLinks && partyId) {
                                if (v.type === 'journal' || v.type === 'adjustment') {
                                    const touchesParty = String((v as any).partyId ?? '') === partyId ||
                                        (Array.isArray((v as any).entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? '') === partyId)) ||
                                        String((v as any)?.adjustmentTarget?.id ?? '') === partyId;
                                    if (!touchesParty) continue;
                                } else if (String((v as any).partyId ?? '') !== partyId) continue;
                            }
                            if (seenSrcForLinkedFrom.has(String(v.id ?? ""))) continue;
                            seenSrcForLinkedFrom.add(String(v.id ?? ""));
                            const no =
                                v.type === 'inter_company'
                                    ? formatInterCompanyLedgerVoucherNumber(v as Record<string, unknown>) || String(v.voucherNumber ?? v.voucher_number ?? '')
                                    : String(v.voucherNumber ?? v.voucher_number ?? '');
                            if (no) linkedFromVoucherNos.push(no);
                        }
                        if (Number((t as any).openingBalanceAllocated) > 0) {
                            linkedFromVoucherNos.push("Opening Balance");
                        }
                        const allocs = (t.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                        allocs.forEach((a: any) => {
                            if (!a.voucherId) return;
                            const target = voucherById.get(String(a.voucherId));
                            if (!target) return;
                            const oppTypes = t.type === 'sale' ? ['purchase', 'purchase_service'] : ['sale', 'sale_service'];
                            if (!oppTypes.includes(target.type)) return;
                            const no = target.voucherNumber ?? target.voucher_number ?? '';
                            if (no && !linkedToVoucherNos.includes(no)) linkedToVoucherNos.push(no);
                        });
                        // Do NOT set linkedToVoucherNos = [myNo] when no outgoing — avoids self-ref "to Sale Inv - 003"
                    } else if (t.type === 'journal' && t.subType === 'add_salary') {
                        /** Payment out / expense / manual journal edges → salary voucher id (entity-scoped). */
                        const seenSalarySources = new Set<string>();
                        const salaryTarget = voucherById.get(String(t.id)) ?? t;
                        const linkScope =
                          needsTaxBillWiseStatus && entity && "id" in entity
                            ? ({ entityKind: "tax" as const, accountId: String((entity as any).id || "") })
                            : isStaffContext && entity && "id" in entity
                              ? ({ entityKind: "staff" as const, accountId: String((entity as any).id || "") })
                              : null;
                        for (const { src: v, alloc } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (!isStaffSalaryBillWiseSource(v)) continue;
                            if (
                              linkScope &&
                              !allocationMatchesEntityScope(alloc as any, salaryTarget, linkScope)
                            ) {
                              continue;
                            }
                            if (seenSalarySources.has(String(v.id ?? ""))) continue;
                            seenSalarySources.add(String(v.id ?? ""));
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no) linkedFromVoucherNos.push(no);
                        }
                        // When salary is linked from Opening Balance, show OB as the source instead of a fake self-link.
                        // Tax ledger: OB on staff net must not appear as tax link source.
                        if (!needsTaxBillWiseStatus && Number((t as any).openingBalanceAllocated) > 0) {
                            linkedFromVoucherNos.push("Opening Balance");
                        }
                    } else if (t.type === 'adjustment') {
                        /** Adjustment: own allocations → linked "to"; others allocating here → linked "from". No entity filter on targets. */
                        for (const { src: v } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (v.id === t.id) continue;
                            pushUniqueLinkedVoucherNo(linkedFromVoucherNos, formatBillWiseLinkedVoucherNo(v));
                        }
                        const adjAllocs = (t.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
                        adjAllocs.forEach((a: any) => {
                            if (!a?.voucherId) return;
                            if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                                pushUniqueLinkedVoucherNo(linkedToVoucherNos, "Opening Balance");
                                return;
                            }
                            pushUniqueLinkedVoucherNo(linkedToVoucherNos, formatBillWiseLinkedVoucherNo(voucherById.get(String(a.voucherId))));
                        });
                        const adjAmountDr = Number(amounts.debit) || 0;
                        const adjAmountCr = Number(amounts.credit) || 0;
                        const adjBillAmount = Math.max(adjAmountDr, adjAmountCr);
                        if (adjBillAmount > 0) {
                            const totalAllocated = sumDedupedBillWiseAllocatedForVoucher({
                                selfVoucherId: String(t.id),
                                incomingEdges: allocEdgesByTargetId.get(String(t.id)) ?? [],
                                outgoingAllocations: adjAllocs,
                            });
                            const remaining = Math.max(0, adjBillAmount - totalAllocated);
                            const hasAnyLinks =
                                totalAllocated > 0 ||
                                linkedToVoucherNos.length > 0 ||
                                linkedFromVoucherNos.length > 0;
                            paymentStatus = remaining <= 0 ? 'paid' : hasAnyLinks ? 'partially_paid' : 'unpaid';
                            outstanding = remaining;
                            isOverdue = false;
                        }
                    } else if (t.type === 'journal' && t.subType !== 'add_salary') {
                        /** Incoming journal links: sirf wo sources jinke allocation edge is row id ko point karte hain */
                        for (const { src: v } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (v.id === t.id) continue;
                            if (!isVoucherForCurrentEntity(v)) continue;
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no && !linkedFromVoucherNos.includes(no)) linkedFromVoucherNos.push(no);
                        }
                        const ownAllocs = (t.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
                        const journalAmountDr = Number(amounts.debit) || 0;
                        const journalAmountCr = Number(amounts.credit) || 0;
                        const journalHasEntitySideAmount = journalAmountDr > 0 || journalAmountCr > 0;
                        const billWiseLinkTargetTypes = new Set([
                          'sale', 'sale_service', 'purchase', 'purchase_service',
                          'payment_in', 'payment_out', 'direct_income', 'direct_expense',
                          'journal', 'adjustment', 'inter_company',
                        ]);
                        const pushLinkedTargetNo = (target: any) => {
                            if (!target) return;
                            const no =
                                target.type === 'inter_company'
                                    ? formatInterCompanyLedgerVoucherNumber(target as Record<string, unknown>) || String(target?.voucherNumber ?? target?.voucher_number ?? '')
                                    : String(target?.voucherNumber ?? target?.voucher_number ?? '');
                            if (no && !linkedToVoucherNos.includes(no)) linkedToVoucherNos.push(no);
                        };
                        ownAllocs.forEach((a: any) => {
                            if (!a?.voucherId) return;
                            const lid = String(a?.linkedAccountId ?? "");
                            if (entityIdForLinks && lid && lid !== String(entityIdForLinks)) return;
                            if (entityIdForLinks && !lid && !journalHasEntitySideAmount) return;
                            if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                                if (!linkedToVoucherNos.includes("Opening Balance")) linkedToVoucherNos.push("Opening Balance");
                                return;
                            }
                            const target = voucherById.get(String(a.voucherId));
                            const skipTargetEntityCheck =
                                t.type === 'adjustment' && target && billWiseLinkTargetTypes.has(String(target.type ?? ''));
                            if (target && !skipTargetEntityCheck && !isVoucherForCurrentEntity(target)) return;
                            pushLinkedTargetNo(target);
                        });
                        // Adjustment bill-wise: allocations kabhi linkedAccountId/entity filter se chhoot jate hain — fallback.
                        if (t.type === 'adjustment' && linkedToVoucherNos.length === 0) {
                            ownAllocs.forEach((a: any) => {
                                if (!a?.voucherId || a.voucherId === OPENING_BALANCE_VOUCHER_ID) return;
                                pushLinkedTargetNo(voucherById.get(String(a.voucherId)));
                            });
                        }
                        // Bill-wise compute for normal journal: bilateral links count once per counter-voucher.
                        const ownAllocsForEntity = (t.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
                        const outgoingForEntity = !entityIdForLinks
                            ? ownAllocsForEntity
                            : ownAllocsForEntity.filter((a: any) => {
                                  const lid = String(a?.linkedAccountId ?? "");
                                  if (lid) return lid === String(entityIdForLinks);
                                  return journalHasEntitySideAmount;
                              });
                        const totalAllocated = sumDedupedBillWiseAllocatedForVoucher({
                            selfVoucherId: String(t.id),
                            incomingEdges: allocEdgesByTargetId.get(String(t.id)) ?? [],
                            outgoingAllocations: outgoingForEntity,
                            includeIncoming: (src) => isVoucherForCurrentEntity(src),
                        });
                        const entityJournalBill = entityIdForLinks
                            ? getJournalPartyBillWiseAmountFromEntries(t, String(entityIdForLinks))
                            : null;
                        const journalBillAmount = entityJournalBill
                            ? Math.max(entityJournalBill.debit, entityJournalBill.credit)
                            : Math.max(Number(amounts.debit) || 0, Number(amounts.credit) || 0);
                        if (journalBillAmount > 0) {
                            const remaining = Math.max(0, journalBillAmount - totalAllocated);
                            const hasAnyLinks =
                                totalAllocated > 0 ||
                                linkedToVoucherNos.length > 0 ||
                                linkedFromVoucherNos.length > 0;
                            // Keep journal status aligned with linked amount in bill-wise contexts (without affecting statement amount columns).
                            paymentStatus = remaining <= 0 ? 'paid' : hasAnyLinks ? 'partially_paid' : 'unpaid';
                            outstanding = remaining;
                            isOverdue = false;
                        }
                    } else if (t.type === 'inter_company') {
                        // Reciprocal bill-wise links: Journal/Payment → IC (incoming) + IC → others (outgoing).
                        const displayNoFor = (v: any) => {
                            if (!v) return '';
                            if (v.type === 'inter_company') {
                                return formatInterCompanyLedgerVoucherNumber(v as Record<string, unknown>) || String(v.voucherNumber ?? v.voucher_number ?? '');
                            }
                            return String(v.voucherNumber ?? v.voucher_number ?? '');
                        };
                        for (const { src: v } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (v.id === t.id) continue;
                            if (!isVoucherForCurrentEntity(v)) continue;
                            const no = displayNoFor(v);
                            if (no && !linkedFromVoucherNos.includes(no)) linkedFromVoucherNos.push(no);
                        }
                        const ownIcAllocs = (t.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
                        ownIcAllocs.forEach((a: any) => {
                            if (!a?.voucherId) return;
                            const lid = String(a?.linkedAccountId ?? "");
                            if (entityIdForLinks && lid && lid !== String(entityIdForLinks)) return;
                            if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                                if (!linkedToVoucherNos.includes("Opening Balance")) linkedToVoucherNos.push("Opening Balance");
                                return;
                            }
                            const target = voucherById.get(String(a.voucherId));
                            if (target && !isVoucherForCurrentEntity(target)) return;
                            const no = displayNoFor(target);
                            if (no && !linkedToVoucherNos.includes(no)) linkedToVoucherNos.push(no);
                        });
                        const outgoingIcForEntity = ownIcAllocs.filter((a: any) => {
                            const lid = String(a?.linkedAccountId ?? "");
                            if (entityIdForLinks && lid) return lid === String(entityIdForLinks);
                            return true;
                        });
                        const icTotalAllocated = sumDedupedBillWiseAllocatedForVoucher({
                            selfVoucherId: String(t.id),
                            incomingEdges: allocEdgesByTargetId.get(String(t.id)) ?? [],
                            outgoingAllocations: outgoingIcForEntity,
                            includeIncoming: (src) => isVoucherForCurrentEntity(src),
                        });
                        const icBillAmount = Math.max(Number(amounts.debit) || 0, Number(amounts.credit) || 0);
                        if (icBillAmount > 0) {
                            const remaining = Math.max(0, icBillAmount - icTotalAllocated);
                            const hasAnyLinks =
                                icTotalAllocated > 0 ||
                                linkedToVoucherNos.length > 0 ||
                                linkedFromVoucherNos.length > 0;
                            paymentStatus = remaining <= 0 ? 'paid' : hasAnyLinks ? 'partially_paid' : 'unpaid';
                            outstanding = remaining;
                            isOverdue = false;
                        }
                    } else if (t.type === 'payment_in' || t.type === 'payment_out' || t.type === 'direct_income' || t.type === 'direct_expense') {
                        const myNo = t.voucherNumber ?? t.voucher_number ?? '';
                        const allocs = (t.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                        // "From" side for bill-wise status: journal/IC → payment only (not spend-wise linkedPaymentInIds below).
                        const linkedFromVoucherNosBillWise: string[] = [];
                        for (const { src: v } of allocEdgesByTargetId.get(String(t.id)) ?? []) {
                            if (v.type !== 'journal' && v.type !== 'adjustment' && v.type !== 'inter_company') continue;
                            if (!isVoucherForCurrentEntity(v)) continue;
                            const no =
                                v.type === 'inter_company'
                                    ? formatInterCompanyLedgerVoucherNumber(v as Record<string, unknown>) || String(v.voucherNumber ?? v.voucher_number ?? '')
                                    : String(v.voucherNumber ?? v.voucher_number ?? '');
                            if (no && !linkedFromVoucherNos.includes(no)) {
                                linkedFromVoucherNos.push(no);
                                linkedFromVoucherNosBillWise.push(no);
                            }
                        }
                        // Bill-wise only: allocations (sale/purchase/salary/OB) — for party/staff/group billwise view we show only these in status.
                        const linkedToVoucherNosBillWise: string[] = [];
                        allocs.forEach((a: any) => {
                            if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                                linkedToVoucherNos.push("Opening Balance");
                                linkedToVoucherNosBillWise.push("Opening Balance");
                            } else {
                                const target = voucherById.get(String(a.voucherId));
                                const no = target?.voucherNumber ?? target?.voucher_number ?? '';
                                if (no) {
                                    linkedToVoucherNos.push(no);
                                    linkedToVoucherNosBillWise.push(no);
                                }
                            }
                        });
                        // Spend-wise: Payment In ↔ Payment / Contra. Do not add to BillWise — party/staff billwise status shows only bill-wise link.
                        if (t.type === 'payment_in' || t.type === 'direct_income') {
                            for (const v of spendWisePayOutsByLinkedReceiptId.get(String(t.id)) ?? []) {
                                if (v.type !== 'payment_out' && v.type !== 'direct_expense' && v.type !== 'contra') continue;
                                const no = v.voucherNumber ?? v.voucher_number ?? '';
                                if (no && !linkedToVoucherNos.includes(no)) linkedToVoucherNos.push(no);
                            }
                        } else {
                            const ids = (t.linkedPaymentInIds as string[] | undefined) || [];
                            ids.forEach((id: string) => {
                                const v = voucherById.get(String(id));
                                const no = v?.voucherNumber ?? v?.voucher_number ?? '';
                                if (no && !linkedFromVoucherNos.includes(no)) linkedFromVoucherNos.push(no);
                            });
                        }
                        // Dedupe so status shows each voucher no once (source: voucher allocations).
                        const fromDeduped = Array.from(new Set(linkedFromVoucherNos));
                        const toDeduped = Array.from(new Set(linkedToVoucherNos));
                        const fromBillWiseDeduped = Array.from(new Set(linkedFromVoucherNosBillWise));
                        const toBillWiseDeduped = Array.from(new Set(linkedToVoucherNosBillWise));
                        return {
                            ...t,
                            // Carry selected contra leg to edit dialog context.
                            _contraLeg: clickedContraLeg,
                            // Carry clicked account context so edit mode can show which account row initiated linking.
                            _openedFromAccountId: openedFromAccountId,
                            voucherNumber: displayVoucherNumber,
                            ...amounts,
                            quantity: amounts.quantity,
                            originalQuantity: t.lineItems?.find((li:any) => entity && 'id' in entity && li.itemId === entity.id)?.quantity || 0,
                            ...(skipRunningBalanceForDaybookRecent ? {} : { balance: runningBalance }),
                            paymentStatus,
                            isOverdue,
                            outstanding,
                            _tdsSettled: tdsSettled,
                            linkedFromVoucherNos: fromDeduped,
                            linkedToVoucherNos: toDeduped,
                            linkedFromVoucherNosBillWise: fromBillWiseDeduped,
                            linkedToVoucherNosBillWise: toBillWiseDeduped,
                        };
                    }
                }

                // Sale/Purchase/Add Salary: dedupe so status lists each voucher no once (source: voucher allocations).
                const fromUnique = Array.from(new Set(linkedFromVoucherNos));
                const toUnique = Array.from(new Set(linkedToVoucherNos));
                const linkedFromVoucherNosBillWise = BILL_WISE_STATUS_LINK_TYPES.has(String(t.type ?? "")) ? fromUnique : [];
                const linkedToVoucherNosBillWise = BILL_WISE_STATUS_LINK_TYPES.has(String(t.type ?? "")) ? toUnique : [];
                // Journal: clicked ledger row ki Dr/Cr side — edit dialog me sahi bill-wise card auto-select ho.
                const _journalFocusSide =
                    t.type === 'journal' &&
                    openedFromAccountId &&
                    (context === 'party' || context === 'staff' || context === 'account') &&
                    (Number(amounts.debit) > 0 || Number(amounts.credit) > 0)
                        ? (Number(amounts.debit) > 0 ? 'debit' as const : 'credit' as const)
                        : undefined;

                return {
                    ...t,
                    // Carry selected contra leg to edit dialog context.
                    _contraLeg: clickedContraLeg,
                    // Carry clicked account context so edit mode can show which account row initiated linking.
                    _openedFromAccountId: openedFromAccountId,
                    _journalFocusSide,
                    voucherNumber: displayVoucherNumber,
                    ...amounts,
                    quantity: amounts.quantity,
                    originalQuantity: t.lineItems?.find((li:any) => entity && 'id' in entity && li.itemId === entity.id)?.quantity || 0,
                    ...(skipRunningBalanceForDaybookRecent ? {} : { balance: runningBalance }),
                    paymentStatus,
                    isOverdue,
                    outstanding,
                    _tdsSettled: tdsSettled,
                    linkedFromVoucherNos: fromUnique,
                    linkedToVoucherNos: toUnique,
                    linkedFromVoucherNosBillWise,
                    linkedToVoucherNosBillWise,
                };
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);    
        
        // Recalculate totals after filtering out zero-amount transactions.
        // Tax: Unverified TDS amounts stay on the row (dim / Waiting) but are excluded from period/closing.
        const periodDr = withBalance.reduce((sum, t) => {
          const bal = amountsForBooksBalance(t, {
            debit: Number(t.debit) || 0,
            credit: Number(t.credit) || 0,
          });
          return sum + bal.debit;
        }, 0);
        const periodCr = withBalance.reduce((sum, t) => {
          const bal = amountsForBooksBalance(t, {
            debit: Number(t.debit) || 0,
            credit: Number(t.credit) || 0,
          });
          return sum + bal.credit;
        }, 0);
        const closing = openingBalanceForPeriod + periodDr - periodCr;
        
        let daybookSummary: any = null;
        if (context === "daybook" && dateRange?.from) {
            // Same vouchers + same getTransactionAmounts as AccountDetails bank ledger
            const ledgerAccounts = ((entityList as Account[]) || []) as Account[];
            const accountById = new Map(ledgerAccounts.map((a) => [String(a.id), a]));
            daybookSummary = buildDaybookDailySummary({
                accounts: ledgerAccounts as any[],
                vouchers: transactionsToProcess,
                selectedDay: startOfDay(dateRange.from),
                userIdFilter: daybookUserIdFilter,
                getLedgerAmounts: (v, accountId) => {
                    const acc = accountById.get(String(accountId)) || ({ id: accountId } as Account);
                    const { debit, credit } = getTransactionAmounts(
                        v,
                        "account",
                        acc,
                        stockView,
                        entityList,
                        processedTaxes
                    );
                    return { debit: Number(debit) || 0, credit: Number(credit) || 0 };
                },
            });
        }

        // Bill-wise: opening balance row outstanding (amount - linked) and linked voucher nos for status
        let openingBalanceOutstanding: number | undefined;
        let openingBalanceLinkedVoucherNos: string[] = [];
        const entityOB = entity && 'openingBalance' in entity ? Number((entity as any).openingBalance) || 0 : 0;
        const entityId = entity && 'id' in entity ? (entity as any).id : undefined;
        const groupOB = context === 'group' && 'items' in entity ? openingBalanceForPeriod : undefined;
        const memberIds = context === 'group' && entity && 'items' in entity
            ? new Set(((entity as EntityWithItems).items || []).map((i: any) => String(i.id)))
            : null;
        if (entityId && (context === 'staff' || context === 'party') && !atFyStartFilter) {
            const obAmount = Math.abs(entityOB);
            let totalAllocatedToOB = 0;
            if (context === 'staff') {
                // Staff OB: settled by Payment In/Direct Income (Dr OB) or Payment/Direct Expense (Cr OB), and by Add Salary (openingBalanceAllocated).
                const staffOBSettlementTypes = entityOB > 0
                    ? ['payment_in', 'direct_income']
                    : ['payment_out', 'direct_expense'];
                (vouchers as any[]).forEach((v: any) => {
                    if (!staffOBSettlementTypes.includes(v.type) || v.staffId !== entityId) return;
                    const allocs = (v.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                    allocs.forEach((a: any) => {
                        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                            totalAllocatedToOB += getAllocationTotal(a);
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no) openingBalanceLinkedVoucherNos.push(no);
                        }
                    });
                });
                // Add Salary vouchers that link this staff's OB (openingBalanceAllocated) so status and voucher no show on staff OB row
                (vouchers as any[]).forEach((v: any) => {
                    if (v.type !== 'journal' || v.subType !== 'add_salary') return;
                    const hasThisStaff = Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === entityId);
                    if (!hasThisStaff) return;
                    const obAlloc = Number((v as any).openingBalanceAllocated) || 0;
                    totalAllocatedToOB += obAlloc;
                    if (obAlloc > 0) {
                        const no = v.voucherNumber ?? v.voucher_number ?? '';
                        if (no) openingBalanceLinkedVoucherNos.push(no);
                    }
                });
                openingBalanceLinkedVoucherNos = Array.from(new Set(openingBalanceLinkedVoucherNos));
            } else if (context === 'party') {
                const payTypes = entityOB > 0 ? ['payment_in', 'direct_income'] : ['payment_out', 'direct_expense'];
                (vouchers as any[]).forEach((v: any) => {
                    if (!payTypes.includes(v.type) || String((v as any).partyId ?? '') !== String(entityId)) return;
                    const allocs = (v.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                    allocs.forEach((a: any) => {
                        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                            totalAllocatedToOB += getAllocationTotal(a);
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no) openingBalanceLinkedVoucherNos.push(no);
                        }
                    });
                });
                // Journals that allocated to OB for this party (so OB row shows all linked vouchers including JRNL).
                (vouchers as any[]).forEach((v: any) => {
                    if (v.type !== 'journal' || v.subType === 'add_salary') return;
                    const touchesParty = String((v as any).partyId ?? '') === String(entityId) ||
                        (Array.isArray((v as any).entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? '') === String(entityId)));
                    if (!touchesParty) return;
                    const allocs = (v.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
                    const obAlloc = allocs.find((a: any) => a.voucherId === OPENING_BALANCE_VOUCHER_ID);
                    if (!obAlloc) return;
                    const amt = getAllocationTotal(obAlloc);
                    totalAllocatedToOB += amt;
                    if (amt > 0) {
                        const no = v.voucherNumber ?? v.voucher_number ?? '';
                        if (no) openingBalanceLinkedVoucherNos.push(no);
                    }
                });
                let totalConsumedFromOB = 0;
                (vouchers as any[]).forEach((v: any) => {
                    if ((v.type !== 'sale' && v.type !== 'sale_service' && v.type !== 'purchase' && v.type !== 'purchase_service') || String((v as any).partyId ?? '') !== String(entityId)) return;
                    totalConsumedFromOB += Number((v as any).openingBalanceAllocated) || 0;
                    const obAlloc = Number((v as any).openingBalanceAllocated) || 0;
                    if (obAlloc > 0) {
                        const no = v.voucherNumber ?? v.voucher_number ?? '';
                        if (no) openingBalanceLinkedVoucherNos.push(no);
                    }
                });
                totalAllocatedToOB += totalConsumedFromOB;
                openingBalanceLinkedVoucherNos = Array.from(new Set(openingBalanceLinkedVoucherNos));
            }
            openingBalanceOutstanding = Math.max(0, obAmount - totalAllocatedToOB);
        } else if (context === 'group' && memberIds && groupOB != null) {
            const obAmount = Math.abs(groupOB);
            let totalAllocatedToOB = 0;
            const firstItem = entity && 'items' in entity ? ((entity as EntityWithItems).items || [])[0] : null;
            const isAccountGroup = firstItem && 'accountType' in firstItem;
            const isTaxGroup = firstItem && 'rate' in firstItem && !('accountType' in firstItem);
            if (isAccountGroup || isTaxGroup) {
                openingBalanceOutstanding = Math.max(0, obAmount);
                openingBalanceLinkedVoucherNos = [];
            } else {
            // Party group: items are Party (no salary). Staff group: items are Staff (have salary). So OB status = Paid when Payment In/Out + sale/purchase allocations cover group OB.
            const isStaffGroup = firstItem && 'salary' in firstItem;
            if (isStaffGroup) {
                // Staff group OB: Payment In/Out (same rule as staff) + Add Salary (openingBalanceAllocated) so status and voucher no show on OB row
                const staffGroupOBSettlementTypes = groupOB > 0
                    ? ['payment_in', 'direct_income']
                    : ['payment_out', 'direct_expense'];
                (vouchers as any[]).forEach((v: any) => {
                    if (!staffGroupOBSettlementTypes.includes(v.type) || !memberIds.has(String((v as any).staffId ?? ''))) return;
                    const allocs = (v.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                    allocs.forEach((a: any) => {
                        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                            totalAllocatedToOB += getAllocationTotal(a);
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no) openingBalanceLinkedVoucherNos.push(no);
                        }
                    });
                });
                (vouchers as any[]).forEach((v: any) => {
                    if (v.type !== 'journal' || v.subType !== 'add_salary') return;
                    const hasMemberStaff = Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId && memberIds.has(String(e.accountId)));
                    if (!hasMemberStaff) return;
                    const obAlloc = Number((v as any).openingBalanceAllocated) || 0;
                    totalAllocatedToOB += obAlloc;
                    if (obAlloc > 0) {
                        const no = v.voucherNumber ?? v.voucher_number ?? '';
                        if (no) openingBalanceLinkedVoucherNos.push(no);
                    }
                });
            } else {
                const payTypes = groupOB > 0 ? ['payment_in', 'direct_income'] : ['payment_out', 'direct_expense'];
                (vouchers as any[]).forEach((v: any) => {
                    if (!payTypes.includes(v.type) || !memberIds.has(String((v as any).partyId ?? ''))) return;
                    const allocs = (v.allocations as { voucherId: string; amount: number }[] | undefined) || [];
                    allocs.forEach((a: any) => {
                        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
                            totalAllocatedToOB += getAllocationTotal(a);
                            const no = v.voucherNumber ?? v.voucher_number ?? '';
                            if (no) openingBalanceLinkedVoucherNos.push(no);
                        }
                    });
                });
                let totalConsumedFromOB = 0;
                (vouchers as any[]).forEach((v: any) => {
                    if ((v.type !== 'sale' && v.type !== 'sale_service' && v.type !== 'purchase' && v.type !== 'purchase_service') || !memberIds.has(String((v as any).partyId ?? ''))) return;
                    const obAlloc = Number((v as any).openingBalanceAllocated) || 0;
                    totalConsumedFromOB += obAlloc;
                    if (obAlloc > 0) {
                        const no = v.voucherNumber ?? v.voucher_number ?? '';
                        if (no) openingBalanceLinkedVoucherNos.push(no);
                    }
                });
                totalAllocatedToOB += totalConsumedFromOB;
            }
            openingBalanceOutstanding = Math.max(0, obAmount - totalAllocatedToOB);
            openingBalanceLinkedVoucherNos = Array.from(new Set(openingBalanceLinkedVoucherNos));
            }
        }
        // Do not set `openingBalanceOutstanding` for account/tax: that field is for party/staff (and some
        // groups) bill-wise “remaining on opening”. Faking it to |period opening| made the table Balance
        // column use “outstanding” and show Settled/0 when period opening was 0, hiding the real ledger.

        return {
            processedTransactions: withBalance,
            daybookTransactions: withBalance,
            totalTransactions,
            openingBalanceForPeriod,
            periodDr,
            periodCr,
            closingBalance: closing,
            daybookSummary,
            openingBalanceOutstanding,
            openingBalanceLinkedVoucherNos,
            periodOpeningUnavailable,
            periodOpeningLoading,
        };

  }, [
    transactionsComputationEnabled,
    useExplicitDaybookVoucherList,
    entityDepKey,
    context,
    vouchersForMemo,
    companyId,
    dateRangeFromMs,
    dateRangeToMs,
    stockView,
    entityListDepKey,
    passedTransactions,
    transactionContext,
    filters,
    voucherTypes,
    daybookUserIdFilter,
    skipRunningBalance,
    includeTaxBillWiseStatus,
    company?.id,
    company?.country,
    company?.fiscalSplitMode,
    fy.enabled,
    fyScopeKey,
    fy.openingBalances,
    fy.openingBalancesLoadStatus,
  ]);

  return result;
}
function isJournalLikeVoucher(transaction: any): boolean {
    return (transaction?.type === "journal" || transaction?.type === "adjustment") && Array.isArray(transaction?.entries);
}

function isRegularJournalLikeVoucher(transaction: any): boolean {
    return isJournalLikeVoucher(transaction) && transaction?.subType !== "add_salary";
}
