"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import React, { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableCaption,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, Loader2, Printer, CalendarIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { openPrintDirect } from "@/lib/printDirect";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { useTransactions } from "@/hooks/use-transactions";
import { cn } from "@/lib/utils";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { format, startOfDay, endOfDay } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";

type CashFlowRow = {
  id: string;
  particulars: string;
  group: "Operating" | "Investing" | "Financing";
  inflow: number;
  outflow: number;
  transactions?: any[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNepaliCurrency = (n: number) =>
  n === 0
    ? "-"
    : new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);

export function CashFlowStatementPage() {
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const { vouchers, loading, journalAccountNames, userNames } = useFyScopedVouchers();
  const { company } = useCompany();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [activeRow, setActiveRow] = useState<CashFlowRow | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const cashFlowData = useMemo((): CashFlowRow[] => {
    const operating: CashFlowRow[] = [];
    const investing: CashFlowRow[] = [];
    const financing: CashFlowRow[] = [];

    vouchers.forEach((v) => {
      const amount = v.total || v.amount || 0;
      let row: Omit<CashFlowRow, "id"> | null = null;

      switch (v.type) {
        case "sale":
        case "payment_in":
        case "direct_income":
          row = { particulars: `From ${voucherTypeDisplayText(v.type)}`, group: "Operating", inflow: amount, outflow: 0, transactions: [v] };
          break;
        case "purchase":
        case "payment_out":
        case "direct_expense":
           row = { particulars: `To ${voucherTypeDisplayText(v.type)}`, group: "Operating", inflow: 0, outflow: amount, transactions: [v] };
           break;
        case "journal":
          // Simplified: Assuming journals affect financing/investing based on narration
          if (v.narration?.toLowerCase().includes("capital")) {
            const credit = v.entries?.reduce((sum: number, e: any) => sum + (e.credit || 0), 0) || 0;
            row = { particulars: "Capital Introduced", group: "Financing", inflow: credit, outflow: 0, transactions: [v] };
          } else if (v.narration?.toLowerCase().includes("loan")) {
             const credit = v.entries?.reduce((sum: number, e: any) => sum + (e.credit || 0), 0) || 0;
             row = { particulars: "Loan Received", group: "Financing", inflow: credit, outflow: 0, transactions: [v] };
          }
          break;
      }
      
      if (row) {
        const id = `${row.group}-${row.particulars}`;
        if (row.group === 'Operating') operating.push({id, ...row});
        else if (row.group === 'Investing') investing.push({id, ...row});
        else if (row.group === 'Financing') financing.push({id, ...row});
      }
    });

    const aggregated: Record<string, CashFlowRow> = {};
    [...operating, ...investing, ...financing].forEach(row => {
        if (!aggregated[row.id]) {
            aggregated[row.id] = { ...row };
        } else {
            aggregated[row.id].inflow += row.inflow;
            aggregated[row.id].outflow += row.outflow;
            aggregated[row.id].transactions?.push(...(row.transactions || []));
        }
    });

    return Object.values(aggregated);
  }, [vouchers]);

  const filtered = useMemo(() => {
    let sortedData = [...cashFlowData];
    if (sortDesc) {
      sortedData.sort((a, b) => (b.inflow - b.outflow) - (a.inflow - a.outflow));
    } else {
      sortedData.sort((a, b) => (a.inflow - a.outflow) - (b.inflow - b.outflow));
    }
    if (query) {
      return sortedData.filter((row) =>
        row.particulars.toLowerCase().includes(query.toLowerCase()) ||
        row.group.toLowerCase().includes(query.toLowerCase())
      );
    }
    return sortedData;
  }, [cashFlowData, query, sortDesc]);

  const totals = useMemo(() => {
    const operating = filtered.filter(r => r.group === 'Operating').reduce((sum, r) => sum + r.inflow - r.outflow, 0);
    const investing = filtered.filter(r => r.group === 'Investing').reduce((sum, r) => sum + r.inflow - r.outflow, 0);
    const financing = filtered.filter(r => r.group === 'Financing').reduce((sum, r) => sum + r.inflow - r.outflow, 0);
    const net = operating + investing + financing;
    return { operating: round2(operating), investing: round2(investing), financing: round2(financing), net: round2(net) };
  }, [filtered]);

  // Process transactions for activeRow with running balance
  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    activeRow ? { id: 'daybook', items: [] } : null,
    'daybook',
    dateRange,
    undefined,
    undefined,
    activeRow?.transactions,
    undefined,
    undefined,
    undefined,
    journalAccountNames,
    userNames
  );

  const openDetail = (id: string) => {
    const row = cashFlowData.find(r => r.id === id);
    if (row) setActiveRow(row);
  };
  const closeDrawer = () => setActiveRow(null);

  const handlePrintDetail = () => {
    if (!company || !activeRow) return;
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    openPrintDirect({
      company: {
        name: company.name,
        pan: company.pan,
        phone: company.phone,
        address: company.address,
        decimalPlaces: company.decimalPlaces,
        showDrCr: company.showDrCr,
        showCurrencySymbol: company.showCurrencySymbol,
        logoUrl: company.logoUrl,
      },
      title: `Cash Flow: ${activeRow.particulars} · ${activeRow.group}`,
      context: "daybook",
      dateSystem: dateSystem as "AD" | "BS" | "Both",
      dateRangeText: dateRangeText,
      vouchersCount: processedTransactions?.length ?? 0,
      openingBalance: openingBalanceForPeriod || 0,
      transactions: processedTransactions ?? [],
      journalAccountNames: journalAccountNames,
      userNames: userNames,
    }, true);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="pb-[72px] p-0.5 w-full h-full overflow-y-auto">
      <Card className="border-2 border-foreground/20">
        <CardHeader className="px-4 pt-4">
          <CardTitle className="text-2xl">Cash Flow Statement</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className={cn("flex items-center gap-2 py-3", isMobile && "overflow-x-auto min-w-0")}>
            <div className={cn("flex items-center gap-2 shrink-0", isMobile && "min-w-[400px]")}>
              <div className="relative w-full max-w-sm min-w-[200px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
                <Input
                  placeholder="Search particulars or group…"
                  className="pl-8"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => setSortDesc((s) => !s)}>
                <ArrowUpDown className="mr-2 h-4 w-4" /> Sort by Net Flow
              </Button>
            </div>
          </div>

          <div className={cn("w-full", isMobile && "overflow-x-auto")}>
            <div className={cn("rounded-2xl border", isMobile && "min-w-[600px]")}>
              <div className={isMobile ? "overflow-y-auto max-h-[60vh]" : ""}>
              <Table className={cn(isMobile && "min-w-[600px]")}>
                <TableCaption>Click a row to view transaction details.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36px] text-center">#</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Inflow</TableHead>
                    <TableHead className="text-right">Outflow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No matching records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r, i) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/60"
                        onClick={() => openDetail(r.id)}
                      >
                        <TableCell className="text-center">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.particulars}</TableCell>
                        <TableCell>{r.group}</TableCell>
                        <TableCell className="text-right tabular-nums">{toNepaliCurrency(r.inflow)}</TableCell>
                        <TableCell className="text-right tabular-nums">{toNepaliCurrency(r.outflow)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </div>
          </div>

          <div className={cn("grid gap-4 mt-4", isMobile ? "grid-cols-1" : "grid-cols-4")}>
            <Card>
              <CardHeader><CardTitle>Net Operating</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold text-right">{toNepaliCurrency(totals.operating)}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Net Investing</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold text-right">{toNepaliCurrency(totals.investing)}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Net Financing</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold text-right">{toNepaliCurrency(totals.financing)}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Net Cash Flow</CardTitle></CardHeader>
              <CardContent className={`text-2xl font-bold text-right ${totals.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                {totals.net >= 0 ? `${toNepaliCurrency(totals.net)} Inflow` : `${toNepaliCurrency(Math.abs(totals.net))} Outflow`}
              </CardContent>
            </Card>
          </div>

          <p className="mt-2 text-sm opacity-80">Note: Cash Flow Statement shows changes in cash from Operating, Investing, and Financing activities.</p>
        </CardContent>
      </Card>

      <Dialog open={!!activeRow} onOpenChange={(open) => !open && closeDrawer()}>
        <DialogContent className={cn(
          "h-[90vh] max-h-[90vh] w-max min-w-[320px] max-w-[95vw] flex flex-col gap-0 overflow-hidden"
        )}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="pr-8 truncate">
              {activeRow?.particulars} · {activeRow?.group}
            </DialogTitle>
          </DialogHeader>

          {/* Row summary - all column data */}
          {activeRow && (
            <div className="px-4 py-3 border-b bg-muted/30 flex-shrink-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b hover:bg-transparent">
                    <TableHead className="font-semibold">Particulars</TableHead>
                    <TableHead className="font-semibold">Group</TableHead>
                    <TableHead className="text-right font-semibold">Inflow</TableHead>
                    <TableHead className="text-right font-semibold">Outflow</TableHead>
                    <TableHead className="text-right font-semibold">Net Flow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-muted/50">
                    <TableCell className="font-medium">{activeRow.particulars}</TableCell>
                    <TableCell>{activeRow.group}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-600">{toNepaliCurrency(activeRow.inflow)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">{toNepaliCurrency(activeRow.outflow)}</TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums font-medium",
                      activeRow.inflow - activeRow.outflow >= 0 ? "text-green-600" : "text-red-600"
                    )}>
                      {toNepaliCurrency(activeRow.inflow - activeRow.outflow)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Transaction details */}
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto px-4 py-2">
            {activeRow && (
              <>
                <p className="text-sm font-medium text-muted-foreground mb-2">Transaction details</p>
                <div className="min-w-0 w-max">
                  <TransactionsTable
                    transactions={processedTransactions || []}
                    context="daybook"
                    openingBalance={openingBalanceForPeriod || 0}
                    periodDr={periodDr || 0}
                    periodCr={periodCr || 0}
                    closingBalance={closingBalance || 0}
                    journalAccountNames={journalAccountNames}
                    userNames={userNames}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 flex-1">
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <BsDatePicker
                  isRange
                  valueAD={dateRange}
                  onChangeAD={(range) => {
                    if (range) {
                      const normalizedRange: DateRange = {
                        from: range.from ? startOfDay(range.from) : undefined,
                        to: range.to ? endOfDay(range.to) : undefined,
                      };
                      setDateRange(normalizedRange);
                    } else {
                      setDateRange(undefined);
                    }
                  }}
                  className="w-auto"
                />
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-auto justify-start text-left font-normal flex-shrink-0",
                        !dateRange && "text-muted-foreground",
                        dateSystem === "Both" && "w-[240px]"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={asCalendarRange(dateRange)}
                      onSelect={(range) => {
                        if (range) {
                          const normalizedRange: DateRange = {
                            from: range.from ? startOfDay(range.from) : undefined,
                            to: range.to ? endOfDay(range.to) : undefined,
                          };
                          setDateRange(normalizedRange);
                          setIsCalendarOpen(false);
                        } else {
                          setDateRange(undefined);
                          setIsCalendarOpen(false);
                        }
                      }}
                      numberOfMonths={calendarMonths}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {dateRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateRange(undefined)}
                  className="flex-shrink-0"
                >
                  Clear
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={handlePrintDetail} className="gap-2" disabled={!activeRow}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button variant="outline" onClick={closeDrawer}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
