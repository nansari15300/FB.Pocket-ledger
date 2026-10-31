
"use client";

import type { Report } from "./report-data";
import { PlaceholderPage } from "../layout/PlaceholderPage";
import { useReportPartyView } from "@/contexts/ReportPartyViewContext";
import { DaybookReport } from "@/components/reports/DaybookReport";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import { collectionGroup, query, where, collection } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import React, { useState } from "react";
import type { Account } from "@/components/bank-cash/types";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import FinancialSummary from "@/components/reports/FinancialSummary";
import { TrialBalancePage } from "./TrialBalance";
import { BalanceSheetPage } from "./BalanceSheet";
import { ProfitAndLossPage } from "./ProfitAndLoss";
import { CashFlowStatementPage } from "./CashFlowStatement";
import AccountsStatementPage from "@/app/(dashboard)/reports/accounts-statement/page";
import PartyLedgerPage from "@/app/(dashboard)/reports/partyledger/page";
import BankStatementPage from "@/app/(dashboard)/reports/bank-statement/page";
import StaffStatementPage from "@/app/(dashboard)/reports/staff-statement/page";
import IncomeStatementPage from "@/app/(dashboard)/reports/income-statement/page";
import StockSummaryPage from "@/app/(dashboard)/reports/stock-summary/page";
import PartyStatementPage from "@/app/(dashboard)/reports/party-statement/page";
import ExpenseStatementPage from "@/app/(dashboard)/reports/expense-statement/page";
import ItemStatementPage from "@/app/(dashboard)/reports/item-statement/page";
import TaxStatementPage from "@/app/(dashboard)/reports/tax-statement/page";
import { SaleReportDetail } from "./SaleReportDetail";
import { PurchaseReportDetail } from "./PurchaseReportDetail";
import { PaymentInReportDetail } from "./PaymentInReportDetail";
import { PaymentOutReportDetail } from "./PaymentOutReportDetail";
import { AddSalaryReportDetail } from "./AddSalaryReportDetail";
import { ContraReportDetail } from "./ContraReportDetail";
import { JournalReportDetail } from "./JournalReportDetail";
import { NotesReportDetail } from "./NotesReportDetail";
import { LoanOverviewReportDetail } from "./LoanOverviewReportDetail";
import { Anusuchi13Report } from "./Anusuchi13Report";
import { GSTR1Report } from "./GSTR1";
import { GSTR2Report } from "./GSTR2";
import { GSTR3BReport } from "./GSTR3B";

export function ReportDetails({ report }: { report: Report }) {
    const { companyId } = useCompany();
    const { vouchers, loading } = useFyScopedVouchers();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const { setShowBillWiseToggle } = useReportPartyView();

    React.useEffect(() => {
      const isPartyReport = report.id === "group-statement" || report.id === "accounts-statement";
      if (!isPartyReport) setShowBillWiseToggle(false);
    }, [report.id, setShowBillWiseToggle]);
   
    React.useEffect(() => {
        if (!companyId) {
            setAccounts([]);
            return;
        }

        const accountsQuery = query(collection(firestore, `companies/${companyId}/bank_accounts`));
        
        const unsubAccounts = onSnapshot(accountsQuery, (snapshot) => {
            setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account)));
        });

        return () => {
            unsubAccounts();
        };

    }, [companyId]);

  if (report.id === "sale") {
    return <SaleReportDetail />;
  }

  if (report.id === "purchase") {
    return <PurchaseReportDetail />;
  }

  // Direct embedded components (no iframe - faster, no loading issues)
  if (report.id === "payment-in") {
    return <PaymentInReportDetail />;
  }
  if (report.id === "payment-out") {
    return <PaymentOutReportDetail />;
  }
  if (report.id === "add-salary") {
    return <AddSalaryReportDetail />;
  }
  if (report.id === "contra") {
    return <ContraReportDetail />;
  }
  if (report.id === "journal") {
    return <JournalReportDetail />;
  }

  if (report.id === 'day-book') {
    return <DaybookReport />;
  }

  if (report.id === 'financialsummary') {
    return <FinancialSummary />;
  }

  if (report.id === 'trialbalance') {
      return <TrialBalancePage />;
  }
  
  if (report.id === 'balancesheet') {
    return <BalanceSheetPage />;
  }

  if (report.id === 'profitandloss') {
    // Income & Expense entry: open shared P&L UI in income-exp mode.
    return <ProfitAndLossPage reportLabel={report.name} reportVariant="income-exp" />;
  }
  if (report.id === 'profitandloss-party-wise') {
    // Party Wise entry: open same P&L UI with party-wise data mode.
    return <ProfitAndLossPage reportLabel={report.name} reportVariant="party-wise" />;
  }
  if (report.id === 'profitandloss-bill-wise') {
    // Bill Wise entry: open same P&L UI with bill-wise data mode.
    return <ProfitAndLossPage reportLabel={report.name} reportVariant="bill-wise" />;
  }
  
  if (report.id === 'cashflow') {
    return <CashFlowStatementPage />;
  }
  
  if (report.id === 'accounts-statement') {
    return (
      <AccountsStatementPage
        onPartySelectionChange={(isParty) => setShowBillWiseToggle(isParty)}
      />
    );
  }
  
  if (report.id === 'group-statement') {
    return (
      <AccountsStatementPage
        onPartySelectionChange={(isParty) => setShowBillWiseToggle(isParty)}
        mode="group"
      />
    );
  }

  // Legacy report IDs - kept for backward compatibility but not shown in report list
  if (report.id === 'partyledger') {
    return <PartyLedgerPage />;
  }
  
  if (report.id === 'bank-statement') {
    return <BankStatementPage />;
  }

  if (report.id === 'staff-statement') {
    return <StaffStatementPage />;
  }
  
  if (report.id === 'income-statement') {
    return <IncomeStatementPage />;
  }

  if (report.id === 'stock-summary') {
    return <StockSummaryPage />;
  }
  
  // Tax Report entry should open tax statement page with responsive mobile/desktop behavior.
  if (report.id === 'tax-statement' || report.id === 'tax-report') {
    return <TaxStatementPage />;
  }

  if (report.id === 'gst-report-1') {
    return <GSTR1Report />;
  }

  if (report.id === 'gst-report-2') {
    return <GSTR2Report />;
  }

  if (report.id === 'gst-report-3b') {
    return <GSTR3BReport />;
  }

  if (report.id === 'party-statement') {
    return <PartyStatementPage />;
  }

  if (report.id === 'expense-statement') {
    return <ExpenseStatementPage />;
  }

  if (report.id === 'item-statement') {
    return <ItemStatementPage />;
  }

  if (report.id === 'notes') {
    return <NotesReportDetail />;
  }

  if (report.id === "loan-overview") {
    return <LoanOverviewReportDetail />;
  }

  if (report.id === 'anusuchi-13') {
    return <Anusuchi13Report />;
  }

  return (
    <div className="p-4 h-full">
      <PlaceholderPage
        title={report.name}
        description={`This is a placeholder for the ${report.name} report. Functionality to generate and view this report will be added soon.`}
      />
    </div>
  );
}
