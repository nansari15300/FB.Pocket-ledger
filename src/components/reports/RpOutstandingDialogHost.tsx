"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { LEDGER_HEADER_PILL_CN, LEDGER_HEADER_PILL_ICON_SIZE_CN } from "@/lib/ledgerHeaderChrome";
import { useDate } from "@/hooks/useDate";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVouchers } from "@/hooks/useVouchers";
import { getCurrentMonthDateRange } from "@/components/dashboard/MonthYearFilter";
import type { DateRange } from "@/components/ui/ad-calendar";
import { openPrintDirect } from "@/lib/printDirect";
import { computeReceivablesPayablesFinancialSummary } from "@/lib/receivablesPayablesFinancialSummary";
import {
  buildRpDialogSections,
  countRpDeadlineAccountsForDate,
  countRpDeadlineDueAccounts,
  countRpDialogSide,
  filterRpDialogSectionsForDeadlineDue,
  filterRpDialogSectionsForDeadlineDate,
  formatRpDeadlineYmd,
  normalizeReceivablesPayablesSummary,
  RP_DEADLINE_DEFAULT_NARRATION,
  rpDeadlineReminderTitle,
  rpDialogKindToReminderContext,
  readRpDeadlinesFromStorage,
  readRpDeadlineNarrationsFromStorage,
  rpDialogRowSelectionKey,
  RP_DIALOG_FILTER_OPTIONS,
  sumRpDialogSide,
  writeRpDeadlinesToStorage,
  writeRpDeadlineNarrationsToStorage,
  wasRpDeadlineDialogAutoShownToday,
  markRpDeadlineDialogAutoShownToday,
  parseRpDeadlineYmd,
  type RpDeadlineNarrationsMap,
  type RpDeadlinesMap,
  type RpDialogRow,
} from "@/lib/receivablesPayablesDialogUi";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { ReceivablesPayablesDialogFooter } from "@/components/reports/ReceivablesPayablesDialogFooter";
import { ReceivablesPayablesMobileSidePills } from "@/components/reports/ReceivablesPayablesMobileSidePills";
import {
  ReceivablesPayablesDialogEntityList,
  rpDialogListScrollHandlers,
  rpDialogPreventDismissForNestedPopover,
  RP_DIALOG_SHELL_ATTR,
  RP_DIALOG_HEADER_DIVIDER_CN,
} from "@/components/reports/ReceivablesPayablesDialogEntityList";
import { useReceivablesPayablesLedgerPopup } from "@/components/reports/ReceivablesPayablesLedgerPopup";
import { useReceivablesPayablesEntityVisibility } from "@/hooks/useReceivablesPayablesEntityVisibility";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { RP_DIALOG_SCROLL_CN } from "@/lib/receivablesPayablesEntityKeys";
import { useServerReceivablesPayablesSummary } from "@/hooks/useServerReceivablesPayablesSummary";
import { useRpOutstandingDialog } from "@/contexts/RpOutstandingDialogContext";
import { usePersistedResizableDialogSize } from "@/lib/usePersistedResizableDialogSize";
import { ResizableDialogEdgeHandles } from "@/components/ui/ResizableDialogEdgeHandles";
import type { ReceivablesPayablesSideTab } from "@/components/reports/ReceivablesPayablesMobileSidePills";

const RP_DIALOG_RESIZABLE_OPTIONS = {
  minW: 640,
  minH: 420,
  defaultW: (vw: number) => Math.min(1152, Math.floor(vw * 0.92)),
  defaultH: (vh: number) => Math.floor(vh * 0.90),
};

export function RpOutstandingDialogHost() {
  const { can } = usePermissions();
  const { company } = useCompany();
  const isMobile = useIsMobile();
  const { formatCurrency, formatCurrencyForPrint, dateSystem, formatDate, formatDateBS } = useDate();
  const {
    open,
    tab,
    filter: receivablePayableFilter,
    setOutstandingOpen,
    setOutstandingTab,
    setOutstandingFilter,
    openOutstandingDialog,
  } = useRpOutstandingDialog();

  const {
    vouchers,
    loading,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
  } = useVouchers();

  const [receivablesDateRange] = useState<DateRange | undefined>(() => getCurrentMonthDateRange(dateSystem));
  const [rpDeadlines, setRpDeadlines] = useState<RpDeadlinesMap>({});
  const [rpDeadlineNarrations, setRpDeadlineNarrations] = useState<RpDeadlineNarrationsMap>({});
  const [reminderTarget, setReminderTarget] = useState<{
    side: "receivables" | "payables";
    row: RpDialogRow;
  } | null>(null);
  const [autoDeadlineView, setAutoDeadlineView] = useState(false);
  const [allDeadlineView, setAllDeadlineView] = useState(false);
  const [deadlineNarrationDraft, setDeadlineNarrationDraft] = useState<{
    companyId: string;
    key: string;
    accountName: string;
    ymd: string;
    narration: string;
  } | null>(null);

  const { filterSummary: filterRpSummary } = useReceivablesPayablesEntityVisibility();
  const rpListMotion = useMasterListRowMotion();
  const rpListScrollHandlers = rpDialogListScrollHandlers(rpListMotion);
  const rpLedgerPopup = useReceivablesPayablesLedgerPopup();

  const {
    size: dialogSize,
    position: dialogPosition,
    handleResizeStart,
    handleDragStart,
    resizable: dialogResizable,
  } = usePersistedResizableDialogSize(open, !isMobile, "pl-rp-dialog-bounds-v6", RP_DIALOG_RESIZABLE_OPTIONS);

  const {
    summary: serverRpSummary,
    loading: serverRpLoading,
    useClientFallback: serverRpClientFb,
    preferServer: preferServerRp,
  } = useServerReceivablesPayablesSummary({
    companyId: company?.id,
    storageOption: company?.storageOption,
    receivablesDateRange,
    enabled: true,
  });

  const needClientRp = !preferServerRp || serverRpClientFb || (!serverRpSummary && !serverRpLoading);

  const clientFinancialSummary = useMemo(() => {
    if (!needClientRp) {
      return computeReceivablesPayablesFinancialSummary({
        vouchers,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        processedExpenseAccounts: expenseAccounts,
        receivablesDateRange,
        loading: true,
      });
    }
    return computeReceivablesPayablesFinancialSummary({
      vouchers,
      processedParties,
      processedStaff,
      processedTaxes,
      processedAccounts,
      processedExpenseAccounts: expenseAccounts,
      receivablesDateRange,
      loading: !!loading,
    });
  }, [
    needClientRp,
    loading,
    vouchers,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    receivablesDateRange,
  ]);

  const rawFinancialSummary = useMemo(() => {
    let raw;
    if (preferServerRp && !serverRpClientFb && serverRpSummary) raw = serverRpSummary;
    else if (preferServerRp && !serverRpClientFb && serverRpLoading) {
      raw = computeReceivablesPayablesFinancialSummary({
        vouchers,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        processedExpenseAccounts: expenseAccounts,
        receivablesDateRange,
        loading: true,
      });
    } else raw = clientFinancialSummary;
    return normalizeReceivablesPayablesSummary(raw);
  }, [
    preferServerRp,
    serverRpClientFb,
    serverRpSummary,
    serverRpLoading,
    clientFinancialSummary,
    vouchers,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    receivablesDateRange,
  ]);

  const financialSummary = useMemo(
    () => filterRpSummary(rawFinancialSummary),
    [rawFinancialSummary, filterRpSummary]
  );

  useEffect(() => {
    const id = company?.id;
    if (!id) {
      setRpDeadlines({});
      setRpDeadlineNarrations({});
      return;
    }
    setRpDeadlines(readRpDeadlinesFromStorage(id));
    setRpDeadlineNarrations(readRpDeadlineNarrationsFromStorage(id));
  }, [company?.id]);

  const handleRpDeadlineChange = useCallback(
    (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null, narration?: string) => {
      const id = company?.id;
      if (!id) return;
      const key = rpDialogRowSelectionKey(side, row);
      setRpDeadlines((prev) => {
        const next = { ...prev };
        if (ymd) next[key] = ymd;
        else delete next[key];
        writeRpDeadlinesToStorage(id, next);
        return next;
      });
      if (!ymd) {
        setRpDeadlineNarrations((prev) => {
          const next = { ...prev };
          delete next[key];
          writeRpDeadlineNarrationsToStorage(id, next);
          return next;
        });
        setDeadlineNarrationDraft((draft) => draft?.key === key ? null : draft);
        return;
      }
      if (narration !== undefined) {
        // Reminder popup already collected the message: save it directly, skip the narration dialog.
        const text = narration.trim() || RP_DEADLINE_DEFAULT_NARRATION;
        setRpDeadlineNarrations((prev) => {
          const next = { ...prev, [key]: text };
          writeRpDeadlineNarrationsToStorage(id, next);
          return next;
        });
        setDeadlineNarrationDraft((draft) => draft?.key === key ? null : draft);
        return;
      }
      setDeadlineNarrationDraft({
        companyId: id,
        key,
        accountName: row.party,
        ymd,
        narration: rpDeadlineNarrations[key] || "Need to call the party to ask payment",
      });
    },
    [company?.id, rpDeadlineNarrations]
  );

  const saveRpDeadlineNarration = useCallback(() => {
    if (!deadlineNarrationDraft) return;
    const { companyId, key, narration } = deadlineNarrationDraft;
    setRpDeadlineNarrations((prev) => {
      const next = { ...prev, [key]: narration.trim() || "Need to call the party to ask payment" };
      writeRpDeadlineNarrationsToStorage(companyId, next);
      return next;
    });
    setDeadlineNarrationDraft(null);
  }, [deadlineNarrationDraft]);

  const receivablesDialogSections = useMemo(
    () => buildRpDialogSections("receivables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );
  const payablesDialogSections = useMemo(
    () => buildRpDialogSections("payables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );
  const receivablesAllCategorySections = useMemo(
    () => buildRpDialogSections("receivables", financialSummary, "all"),
    [financialSummary]
  );
  const payablesAllCategorySections = useMemo(
    () => buildRpDialogSections("payables", financialSummary, "all"),
    [financialSummary]
  );
  const receivablesDialogCount = useMemo(
    () => countRpDialogSide("receivables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );
  const payablesDialogCount = useMemo(
    () => countRpDialogSide("payables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );

  const rpDeadlineDueCount = useMemo(
    () => countRpDeadlineDueAccounts(financialSummary, "all", rpDeadlines, new Date()),
    [financialSummary, rpDeadlines]
  );
  const todayDeadlineYmd = formatRpDeadlineYmd(new Date());
  const rpDeadlineTodayCount = useMemo(
    () => countRpDeadlineAccountsForDate(financialSummary, "all", rpDeadlines, todayDeadlineYmd),
    [financialSummary, rpDeadlines, todayDeadlineYmd]
  );
  const rpDeadlineAllCount = useMemo(
    () => countRpDeadlineAccountsForDate(financialSummary, "all", rpDeadlines, null),
    [financialSummary, rpDeadlines]
  );

  const receivablesDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDue(receivablesDialogSections, "receivables", rpDeadlines, new Date()),
    [receivablesDialogSections, rpDeadlines]
  );
  const payablesDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDue(payablesDialogSections, "payables", rpDeadlines, new Date()),
    [payablesDialogSections, rpDeadlines]
  );
  const receivablesTodayDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDate(receivablesAllCategorySections, "receivables", rpDeadlines, todayDeadlineYmd),
    [receivablesAllCategorySections, rpDeadlines, todayDeadlineYmd]
  );
  const payablesTodayDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDate(payablesAllCategorySections, "payables", rpDeadlines, todayDeadlineYmd),
    [payablesAllCategorySections, rpDeadlines, todayDeadlineYmd]
  );
  const receivablesAllDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDate(receivablesAllCategorySections, "receivables", rpDeadlines, null),
    [receivablesAllCategorySections, rpDeadlines]
  );
  const payablesAllDeadlineSections = useMemo(
    () => filterRpDialogSectionsForDeadlineDate(payablesAllCategorySections, "payables", rpDeadlines, null),
    [payablesAllCategorySections, rpDeadlines]
  );
  const visibleReceivablesDeadlineSections = autoDeadlineView
    ? receivablesTodayDeadlineSections
    : allDeadlineView
      ? receivablesAllDeadlineSections
      : receivablesDeadlineSections;
  const visiblePayablesDeadlineSections = autoDeadlineView
    ? payablesTodayDeadlineSections
    : allDeadlineView
      ? payablesAllDeadlineSections
      : payablesDeadlineSections;

  const receivablesPayablesDialogListTotals = useMemo(
    () => ({
      receivableSum: sumRpDialogSide("receivables", financialSummary, receivablePayableFilter),
      payableSum: sumRpDialogSide("payables", financialSummary, receivablePayableFilter),
    }),
    [financialSummary, receivablePayableFilter]
  );

  const receivablesPayablesDialogBalance = useMemo(() => {
    const { receivableSum, payableSum } = receivablesPayablesDialogListTotals;
    const amount = Math.abs(receivableSum - payableSum);
    if (receivableSum > payableSum) return { amount, side: "receivable" as const };
    if (payableSum > receivableSum) return { amount, side: "payable" as const };
    return { amount: 0, side: "equal" as const };
  }, [receivablesPayablesDialogListTotals]);

  const formatRpDialogAmount = (amount: number, absAmount = false) =>
    formatCurrency(absAmount ? Math.abs(amount) : amount, {
      noSuffix: true,
      showDrCr: true,
      context: "transaction",
    });
  const formatRpDeadlineDisplay = useCallback((ymd: string) => {
    const date = parseRpDeadlineYmd(ymd);
    if (!date) return ymd;
    return dateSystem === "BS" ? formatDateBS(date) : formatDate(date);
  }, [dateSystem, formatDate, formatDateBS]);

  const openRpDeadlineReminder = useCallback(
    (side: "receivables" | "payables", row: RpDialogRow) => {
      setReminderTarget({ side, row });
    },
    []
  );

  const rpDeadlineRowProps = useMemo(
    () => ({
      deadlines: rpDeadlines,
      deadlineNarrations: rpDeadlineNarrations,
      onDeadlineChange: handleRpDeadlineChange,
      onOpenDeadlineReminder: openRpDeadlineReminder,
      showDeadlineControls: true,
    }),
    [rpDeadlines, rpDeadlineNarrations, handleRpDeadlineChange, openRpDeadlineReminder]
  );

  const handleSelectTab = useCallback(
    (nextTab: ReceivablesPayablesSideTab) => {
      setAutoDeadlineView(false);
      setAllDeadlineView(false);
      setOutstandingTab(nextTab);
    },
    [setOutstandingTab]
  );

  const handleShowAllDeadlines = useCallback(() => {
    setAutoDeadlineView(false);
    setAllDeadlineView(true);
    setOutstandingTab("deadline");
  }, [setOutstandingTab]);

  const rpDataReady = !loading && !(preferServerRp && serverRpLoading);

  useEffect(() => {
    if (!rpDataReady || !company?.id || !can("view_receivable_payable_summary")) return;
    if (rpDeadlineTodayCount <= 0) return;
    if (wasRpDeadlineDialogAutoShownToday(company.id)) return;
    markRpDeadlineDialogAutoShownToday(company.id);
    setAutoDeadlineView(true);
    setAllDeadlineView(false);
    setOutstandingFilter("all");
    openOutstandingDialog("deadline");
  }, [rpDataReady, company?.id, rpDeadlineTodayCount, can, openOutstandingDialog, setOutstandingFilter]);

  const handlePrint = () => {
    const filterLabel =
      RP_DIALOG_FILTER_OPTIONS.find((o) => o.id === receivablePayableFilter)?.label ??
      receivablePayableFilter;
    const printTotalReceivable = sumRpDialogSide("receivables", financialSummary, receivablePayableFilter);
    const printTotalPayable = sumRpDialogSide("payables", financialSummary, receivablePayableFilter);
    const buildTableBody = (side: "receivables" | "payables") => {
      const sections = buildRpDialogSections(side, financialSummary, receivablePayableFilter);
      const body: any[] = [["Account", { text: "Amount", alignment: "right" }]];
      for (const section of sections) {
        if (section.rows.length === 0) continue;
        body.push([
          { text: `${section.label} (${section.rows.length})`, bold: true, color: "#64748b" },
          "",
        ]);
        for (const item of section.rows) {
          body.push([
            item.party,
            {
              text: formatCurrencyForPrint(Math.abs(item.balance), { noSuffix: true, noAnimation: true }),
              alignment: "right",
            },
          ]);
        }
      }
      return body;
    };
    const receivablesBody = buildTableBody("receivables");
    const payablesBody = buildTableBody("payables");
    receivablesBody.push([
      { text: "Total Receivable", bold: true, alignment: "right" },
      {
        text: formatCurrencyForPrint(printTotalReceivable, { noSuffix: true, noAnimation: true }),
        bold: true,
        alignment: "right",
        color: "#059669",
      },
    ]);
    payablesBody.push([
      { text: "Total Payable", bold: true, alignment: "right" },
      {
        text: formatCurrencyForPrint(printTotalPayable, { noSuffix: true, noAnimation: true }),
        bold: true,
        alignment: "right",
        color: "#DC2626",
      },
    ]);
    const printRecCount = countRpDialogSide("receivables", financialSummary, receivablePayableFilter);
    const printPayCount = countRpDialogSide("payables", financialSummary, receivablePayableFilter);
    const asOfDate = dateSystem === "BS" ? formatDateBS(new Date()) : formatDate(new Date());
    openPrintDirect(
      {
        company: {
          name: company?.name || "",
          pan: company?.pan,
          phone: company?.phone,
          address: company?.address,
          decimalPlaces: company?.decimalPlaces,
          showDrCr: company?.showDrCr,
          showCurrencySymbol: company?.showCurrencySymbol,
          logoUrl: company?.logoUrl,
        },
        dateSystem,
        title: `Receivables & Payables (${filterLabel})`,
        context: "daybook",
        dateRangeText: `As of ${asOfDate}`,
        vouchersCount: printRecCount + printPayCount,
        openingBalance: 0,
        transactions: [],
        showNarration: false,
        customContent: [
          {
            columns: [
              {
                width: "*",
                stack: [
                  { text: "Receivables", style: "subheader", color: "#059669" },
                  {
                    table: { headerRows: 1, widths: ["*", "auto"], body: receivablesBody },
                    layout: "lightHorizontalLines",
                    margin: [0, 5, 0, 15],
                  },
                ],
              },
              {
                width: "*",
                stack: [
                  { text: "Payables", style: "subheader", color: "#DC2626" },
                  {
                    table: { headerRows: 1, widths: ["*", "auto"], body: payablesBody },
                    layout: "lightHorizontalLines",
                  },
                ],
              },
            ],
            columnGap: 20,
          },
        ],
      },
      true
    );
  };

  const printAction = (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handlePrint();
      }}
      className={cn(
        "data-pl-rp-side-pill pl-chrome-btn-drop shrink-0 flex items-center gap-1.5 border border-solid !border-[1px] !border-blue-300",
        chromeProPillCn,
        LEDGER_HEADER_PILL_CN
      )}
    >
      Print <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
    </Button>
  );
  const allDeadlinesAction = (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleShowAllDeadlines();
      }}
      data-pl-rp-side-pill-active={allDeadlineView ? "" : undefined}
      className={cn(
        "data-pl-rp-side-pill pl-chrome-btn-drop shrink-0 border border-solid !border-[1px]",
        allDeadlineView ? "!border-green-600" : "!border-blue-300",
        chromeProPillCn,
        LEDGER_HEADER_PILL_CN
      )}
      title="Show all accounts with a collection deadline"
    >
      All ({rpDeadlineAllCount})
    </Button>
  );

  if (!can("view_receivable_payable_summary")) return null;

  return (
    <>
                                <Dialog open={open} onOpenChange={(nextOpen) => {
                                    setOutstandingOpen(nextOpen);
                                    if (nextOpen) setOutstandingFilter("all");
                                    if (!nextOpen) {
                                        setOutstandingTab("both");
                                        setAutoDeadlineView(false);
                                        setAllDeadlineView(false);
                                        rpLedgerPopup.resetDialogInteraction();
                                    }
                                }}>
                                    <DialogContent
                                        hideCloseButton
                                        overlayClassName="bg-black/45 backdrop-blur-none"
                                        className={cn(
                                            "z-50 p-0",
                                            dialogResizable
                                                ? "md:!left-0 md:!top-0 md:!translate-x-0 md:!translate-y-0 md:w-full md:h-full md:max-w-none md:max-h-none md:border-0 md:bg-transparent md:shadow-none md:rounded-none overflow-visible pointer-events-none"
                                                : "dashboard-financial-popup max-w-6xl h-[90vh] rounded-lg overflow-hidden flex flex-col"
                                        )}
                                        onPointerDownOutside={rpDialogPreventDismissForNestedPopover}
                                        onInteractOutside={rpDialogPreventDismissForNestedPopover}
                                        {...RP_DIALOG_SHELL_ATTR}
                                    >
                                        <div
                                            className={cn(
                                                "dashboard-financial-popup rounded-lg border bg-background shadow-2xl flex flex-col overflow-hidden relative pointer-events-auto",
                                                dialogResizable ? "" : "w-full h-full"
                                            )}
                                            style={
                                                dialogResizable
                                                    ? {
                                                          position: "fixed",
                                                          left: dialogPosition.x,
                                                          top: dialogPosition.y,
                                                          width: dialogSize.w,
                                                          height: dialogSize.h,
                                                          maxWidth: "98vw",
                                                          maxHeight: "95vh",
                                                      }
                                                    : undefined
                                            }
                                        >
                                            <DialogClose className="absolute right-3.5 top-3.5 z-30 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white/80 text-gray-600 shadow-sm transition-colors hover:bg-white hover:text-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-red-400">
                                                <X className="h-4 w-4" />
                                                <span className="sr-only">Close</span>
                                            </DialogClose>
                                            <DialogHeader
                                                className={cn(
                                                    "shrink-0 flex flex-col border-0 select-none pr-12",
                                                    !isMobile && "cursor-grab active:cursor-grabbing",
                                                    isMobile ? "space-y-0 px-3 pb-1.5 pt-1.5" : "space-y-2 p-4 pb-3"
                                                )}
                                                onMouseDown={!isMobile ? handleDragStart : undefined}
                                            >
                                            <DialogTitle className={cn("whitespace-nowrap text-base md:text-lg", isMobile && "sr-only")}>
                                                Receivables & Payables Details
                                            </DialogTitle>
                                            {autoDeadlineView ? (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {printAction}
                                                    {allDeadlinesAction}
                                                </div>
                                            ) : isMobile ? (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <ReceivablesPayablesMobileSidePills
                                                        tab={tab}
                                                        receivablesCount={receivablesDialogCount}
                                                        payablesCount={payablesDialogCount}
                                                        deadlineCount={rpDeadlineDueCount}
                                                        onSelect={handleSelectTab}
                                                    />
                                                    {printAction}
                                                    {allDeadlinesAction}
                                                </div>
                                            ) : (
                                                <div className="flex w-full items-center gap-2">
                                                    <Tabs
                                                        value={
                                                            tab === "both"
                                                                ? "receivables"
                                                                : tab
                                                        }
                                                        onValueChange={(v) => handleSelectTab(v as ReceivablesPayablesSideTab)}
                                                        className="min-w-0 flex-1"
                                                    >
                                                        <TabsList className="inline-flex h-auto w-auto gap-1 rounded-full bg-transparent p-0">
                                                            <TabsTrigger
                                                                value="receivables"
                                                                className={cn(
                                                                    "data-pl-rp-side-pill pl-chrome-btn-drop rounded-full border border-solid px-2.5 py-0.5 text-xs shadow-none",
                                                                    "data-[state=active]:!border-[1px] data-[state=active]:!border-green-600",
                                                                    "data-[state=inactive]:!border-[1px] data-[state=inactive]:!border-blue-300",
                                                                    chromeProPillCn,
                                                                    LEDGER_HEADER_PILL_CN
                                                                )}
                                                            >
                                                                Receivables ({receivablesDialogCount})
                                                            </TabsTrigger>
                                                            <TabsTrigger
                                                                value="payables"
                                                                className={cn(
                                                                    "data-pl-rp-side-pill pl-chrome-btn-drop rounded-full border border-solid px-2.5 py-0.5 text-xs shadow-none",
                                                                    "data-[state=active]:!border-[1px] data-[state=active]:!border-green-600",
                                                                    "data-[state=inactive]:!border-[1px] data-[state=inactive]:!border-blue-300",
                                                                    chromeProPillCn,
                                                                    LEDGER_HEADER_PILL_CN
                                                                )}
                                                            >
                                                                Payables ({payablesDialogCount})
                                                            </TabsTrigger>
                                                            <TabsTrigger
                                                                value="deadline"
                                                                className={cn(
                                                                    "data-pl-rp-side-pill pl-chrome-btn-drop rounded-full border border-solid px-2.5 py-0.5 text-xs shadow-none",
                                                                    "data-[state=active]:!border-[1px] data-[state=active]:!border-green-600",
                                                                    "data-[state=inactive]:!border-[1px] data-[state=inactive]:!border-blue-300",
                                                                    chromeProPillCn,
                                                                    LEDGER_HEADER_PILL_CN
                                                                )}
                                                            >
                                                                Deadline ({rpDeadlineDueCount})
                                                            </TabsTrigger>
                                                        </TabsList>
                                                    </Tabs>
                                                    {printAction}
                                                    {allDeadlinesAction}
                                                </div>
                                            )}
                                        </DialogHeader>
                                        <div className={RP_DIALOG_HEADER_DIVIDER_CN} aria-hidden />
                                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-2 pt-[3px] pb-0">
                                            {isMobile || autoDeadlineView ? (
                                                <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-0", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                    {tab === "deadline" ? (
                                                        <div className="flex min-h-0 flex-col gap-3">
                                                            {visibleReceivablesDeadlineSections.length > 0 ? (
                                                                <div className="min-h-0">
                                                                    <h3 className="mb-2 text-base font-semibold text-green-600">Receivables</h3>
                                                                    <ReceivablesPayablesDialogEntityList
                                                                        sections={visibleReceivablesDeadlineSections}
                                                                        side="receivables"
                                                                        formatAmount={formatRpDialogAmount}
                                                                        isMobile={isMobile}
                                                                        listMotion={rpListMotion}
                                                                        selectedKey={rpLedgerPopup.selectedKey}
                                                                        onSelectRow={rpLedgerPopup.selectRow}
                                                                        onOpenRow={rpLedgerPopup.openRowLedger}
                                                                        {...rpDeadlineRowProps}
                                                                    />
                                                                </div>
                                                            ) : null}
                                                            {visiblePayablesDeadlineSections.length > 0 ? (
                                                                <div className="min-h-0">
                                                                    <h3 className="mb-2 text-base font-semibold text-red-600">Payables</h3>
                                                                    <ReceivablesPayablesDialogEntityList
                                                                        sections={visiblePayablesDeadlineSections}
                                                                        side="payables"
                                                                        formatAmount={formatRpDialogAmount}
                                                                        isMobile={isMobile}
                                                                        listMotion={rpListMotion}
                                                                        selectedKey={rpLedgerPopup.selectedKey}
                                                                        onSelectRow={rpLedgerPopup.selectRow}
                                                                        onOpenRow={rpLedgerPopup.openRowLedger}
                                                                        {...rpDeadlineRowProps}
                                                                    />
                                                                </div>
                                                            ) : null}
                                                            {visibleReceivablesDeadlineSections.length === 0 &&
                                                            visiblePayablesDeadlineSections.length === 0 ? (
                                                                <p className="py-8 text-center text-sm text-muted-foreground">
                                                                    {autoDeadlineView
                                                                        ? "No accounts have a payment deadline today."
                                                                        : allDeadlineView
                                                                          ? "No accounts have a collection deadline with an outstanding balance."
                                                                          : "No accounts are due on or before today with an outstanding balance."}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                    {(tab === "receivables" || tab === "both") && (
                                                            <ReceivablesPayablesDialogEntityList
                                                                sections={receivablesDialogSections}
                                                                side="receivables"
                                                                formatAmount={formatRpDialogAmount}
                                                                isMobile={isMobile}
                                                                listMotion={rpListMotion}
                                                                selectedKey={rpLedgerPopup.selectedKey}
                                                                onSelectRow={rpLedgerPopup.selectRow}
                                                                onOpenRow={rpLedgerPopup.openRowLedger}
                                                                {...rpDeadlineRowProps}
                                                            />
                                                    )}
                                                    {tab === "payables" && (
                                                            <ReceivablesPayablesDialogEntityList
                                                                sections={payablesDialogSections}
                                                                side="payables"
                                                                formatAmount={formatRpDialogAmount}
                                                                isMobile={isMobile}
                                                                listMotion={rpListMotion}
                                                                selectedKey={rpLedgerPopup.selectedKey}
                                                                onSelectRow={rpLedgerPopup.selectRow}
                                                                onOpenRow={rpLedgerPopup.openRowLedger}
                                                                {...rpDeadlineRowProps}
                                                            />
                                                    )}
                                                </div>
                                            ) : tab === "deadline" ? (
                                                <div className={cn("grid min-h-0 flex-1 min-w-0 grid-cols-2 gap-4 overflow-y-auto", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                    <div className="flex min-h-0 flex-col">
                                                        <h3 className="mb-0.5 shrink-0 text-lg font-semibold text-green-600">Receivables</h3>
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={visibleReceivablesDeadlineSections}
                                                            side="receivables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                    </div>
                                                    <div className="flex min-h-0 flex-col">
                                                        <h3 className="mb-0.5 shrink-0 text-lg font-semibold text-red-600">Payables</h3>
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={visiblePayablesDeadlineSections}
                                                            side="payables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="grid flex-1 min-h-0 min-w-0 grid-cols-2 gap-4">
                                                    <div className="flex flex-col min-h-0 h-full">
                                                        <h3 className="text-lg font-semibold mb-0.5 text-green-600 shrink-0">Receivables ({receivablesDialogCount})</h3>
                                                        <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0.5", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                            <ReceivablesPayablesDialogEntityList
                                                                sections={receivablesDialogSections}
                                                                side="receivables"
                                                                formatAmount={formatRpDialogAmount}
                                                                isMobile={isMobile}
                                                                listMotion={rpListMotion}
                                                                selectedKey={rpLedgerPopup.selectedKey}
                                                                onSelectRow={rpLedgerPopup.selectRow}
                                                                onOpenRow={rpLedgerPopup.openRowLedger}
                                                                {...rpDeadlineRowProps}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col min-h-0 h-full">
                                                        <h3 className="text-lg font-semibold mb-0.5 text-red-600 shrink-0">Payables ({payablesDialogCount})</h3>
                                                        <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0.5", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                            <ReceivablesPayablesDialogEntityList
                                                                sections={payablesDialogSections}
                                                                side="payables"
                                                                formatAmount={formatRpDialogAmount}
                                                                isMobile={isMobile}
                                                                listMotion={rpListMotion}
                                                                selectedKey={rpLedgerPopup.selectedKey}
                                                                onSelectRow={rpLedgerPopup.selectRow}
                                                                onOpenRow={rpLedgerPopup.openRowLedger}
                                                                {...rpDeadlineRowProps}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <ReceivablesPayablesDialogFooter
                                            receivableSum={receivablesPayablesDialogListTotals.receivableSum}
                                            payableSum={receivablesPayablesDialogListTotals.payableSum}
                                            balance={receivablesPayablesDialogBalance}
                                            isMobile={isMobile}
                                            formatAmount={(amount) =>
                                                formatCurrency(amount, { noSuffix: true, context: "transaction" })
                                            }
                                        />
                                        {dialogResizable ? (
                                            <ResizableDialogEdgeHandles onResizeStart={handleResizeStart} allSides />
                                        ) : null}
                                        </div>
                                    </DialogContent>
      </Dialog>
      <Dialog
        open={!!deadlineNarrationDraft}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeadlineNarrationDraft(null);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-4">
          <DialogHeader>
            <DialogTitle>Payment call narration</DialogTitle>
            {deadlineNarrationDraft ? (
              <p className="truncate text-sm text-muted-foreground">{deadlineNarrationDraft.accountName}</p>
            ) : null}
          </DialogHeader>
          {deadlineNarrationDraft ? (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm font-medium">
                Deadline date <span className="text-xs font-normal text-muted-foreground">(read-only)</span>
                <Input value={formatRpDeadlineDisplay(deadlineNarrationDraft.ymd)} readOnly />
              </label>
              <label className="block space-y-1 text-sm font-medium">
                Narration
                <Textarea
                  rows={3}
                  value={deadlineNarrationDraft.narration}
                  onChange={(event) =>
                    setDeadlineNarrationDraft((draft) =>
                      draft ? { ...draft, narration: event.target.value } : draft
                    )
                  }
                  placeholder="Need to call the party to ask payment"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDeadlineNarrationDraft(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={saveRpDeadlineNarration}>
                  Save narration
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {reminderTarget ? (
        <LedgerReminderDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setReminderTarget(null);
          }}
          context={rpDialogKindToReminderContext(reminderTarget.row.kind)}
          entityId={reminderTarget.row.entityId}
          title={reminderTarget.row.party}
          initialTitle={rpDeadlineReminderTitle(reminderTarget.row.party)}
          initialMessage={
            rpDeadlineNarrations[rpDialogRowSelectionKey(reminderTarget.side, reminderTarget.row)] ||
            RP_DEADLINE_DEFAULT_NARRATION
          }
          initialDate={(() => {
            const ymd = rpDeadlines[rpDialogRowSelectionKey(reminderTarget.side, reminderTarget.row)];
            return ymd ? parseRpDeadlineYmd(ymd) : null;
          })()}
          forceBsDatePicker
          onSaved={(info) => {
            // Keep Due / Today / All deadline filters + counts working: mirror the reminder date into old deadline storage.
            if (
              info.entityId !== reminderTarget.row.entityId ||
              info.context !== rpDialogKindToReminderContext(reminderTarget.row.kind)
            ) {
              return;
            }
            const d = new Date(info.date);
            d.setHours(12, 0, 0, 0);
            handleRpDeadlineChange(reminderTarget.side, reminderTarget.row, formatRpDeadlineYmd(d), info.message);
          }}
        />
      ) : null}
      {rpLedgerPopup.popup}
    </>
  );
}
