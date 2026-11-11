"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { isSameDay } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { proDashboardRibbonClass } from "@/lib/proTheme";
import { openPrintDirect } from "@/lib/printDirect";
import { MonthYearFilter } from "@/components/dashboard/MonthYearFilter";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";

export type StockSectionKind = "sale" | "purchase" | "low-stock";

export type StockSectionItem = {
  id: string;
  name: string;
  qty: number;
  unit: string;
  rate: number;
  value: number;
  salesQty: number;
  salesValue: number;
  purchaseQty: number;
  purchaseValue: number;
  smallestUnit: string;
  warningLevel?: number;
};

type DateRangeValue = { from?: Date; to?: Date };

export type StockSectionDetailsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: StockSectionKind | null;
  saleItems: StockSectionItem[];
  purchaseItems: StockSectionItem[];
  lowStockItems: Array<StockSectionItem & { warningLevel: number }>;
  stockDateRange: DateRangeValue | undefined;
  setStockDateRange: (range: DateRangeValue | undefined) => void;
};

const SECTION_META: Record<
  StockSectionKind,
  { title: string; ribbonIndex: number; empty: string }
> = {
  sale: { title: "Sale Items", ribbonIndex: 3, empty: "No sale items" },
  purchase: { title: "Purchase Items", ribbonIndex: 4, empty: "No purchase items" },
  "low-stock": { title: "Low Stock Items", ribbonIndex: 5, empty: "No low stock items" },
};

type SortKey = "name" | "amount" | "qty" | "min" | "shortfall";
type SortDir = "asc" | "desc";

function defaultSort(section: StockSectionKind): { key: SortKey; dir: SortDir } {
  if (section === "low-stock") return { key: "shortfall", dir: "desc" };
  return { key: "amount", dir: "desc" };
}

function formatDateRangeText(
  stockDateRange: DateRangeValue | undefined,
  dateSystem: string,
  formatDate: (d: Date) => string,
  formatDateBS: (d: Date) => string,
): string {
  if (!stockDateRange?.from) return "All Time";
  const from = stockDateRange.from;
  const to = stockDateRange.to || from;
  const fromBS = formatDateBS(from);
  const toBS = formatDateBS(to);
  const fromAD = formatDate(from);
  const toAD = formatDate(to);
  if (dateSystem === "AD") return `AD: ${fromAD}${!isSameDay(from, to) ? ` to ${toAD}` : ""}`;
  if (dateSystem === "BS") return `BS: ${fromBS}${!isSameDay(from, to) ? ` to ${toBS}` : ""}`;
  return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
}

type PrintCell = {
  text?: string;
  bold?: boolean;
  fontSize?: number;
  alignment?: string;
  colSpan?: number;
  noWrap?: boolean;
};

const thClass =
  "h-9 px-4 align-middle font-bold text-black whitespace-nowrap border-b border-border/75";
const tdClass = "px-4 py-2 align-middle whitespace-nowrap border-b border-border/65";

export function StockSectionDetailsDialog(props: StockSectionDetailsDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && props.section ? (
        <StockSectionDetailsBody key={props.section} {...props} section={props.section} />
      ) : null}
    </Dialog>
  );
}

type StockSectionDetailsBodyProps = Omit<StockSectionDetailsDialogProps, "open" | "onOpenChange" | "section"> & {
  section: StockSectionKind;
};

function StockSectionDetailsBody({
  section,
  saleItems,
  purchaseItems,
  lowStockItems,
  stockDateRange,
  setStockDateRange,
}: StockSectionDetailsBodyProps) {
  const { formatCurrency, formatCurrencyForPrint, formatDate, formatDateBS, dateSystem } = useDate();
  const { company } = useCompany();
  const activeSection = section;
  const meta = SECTION_META[activeSection];
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort(activeSection).key);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort(activeSection).dir);

  const sourceItems: Array<StockSectionItem & { warningLevel?: number }> =
    activeSection === "sale"
      ? saleItems
      : activeSection === "purchase"
        ? purchaseItems
        : lowStockItems;

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sourceItems.filter((item) => item.name.toLowerCase().includes(q))
      : sourceItems.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) * (sortDir === "asc" ? 1 : -1);
      }
      if (sortKey === "amount") {
        const av = activeSection === "purchase" ? a.purchaseValue : a.salesValue;
        const bv = activeSection === "purchase" ? b.purchaseValue : b.salesValue;
        if (av !== bv) return (av - bv) * dir;
        return a.name.localeCompare(b.name);
      }
      if (sortKey === "qty") {
        const av =
          activeSection === "low-stock"
            ? Number(a.qty)
            : activeSection === "purchase"
              ? a.purchaseQty
              : a.salesQty;
        const bv =
          activeSection === "low-stock"
            ? Number(b.qty)
            : activeSection === "purchase"
              ? b.purchaseQty
              : b.salesQty;
        if (av !== bv) return (av - bv) * dir;
        return a.name.localeCompare(b.name);
      }
      if (sortKey === "min") {
        const av = Number(a.warningLevel) || 0;
        const bv = Number(b.warningLevel) || 0;
        if (av !== bv) return (av - bv) * dir;
        return a.name.localeCompare(b.name);
      }
      const aGap = (Number(a.warningLevel) || 0) - Number(a.qty);
      const bGap = (Number(b.warningLevel) || 0) - Number(b.qty);
      if (aGap !== bGap) return (aGap - bGap) * dir;
      if (Number(a.qty) !== Number(b.qty)) return Number(a.qty) - Number(b.qty);
      return a.name.localeCompare(b.name);
    });
    return filtered;
  }, [sourceItems, query, sortKey, sortDir, activeSection]);

  const totalAmount = useMemo(() => {
    if (activeSection === "sale") {
      return visibleItems.reduce((sum, item) => sum + (Number(item.salesValue) || 0), 0);
    }
    if (activeSection === "purchase") {
      return visibleItems.reduce((sum, item) => sum + (Number(item.purchaseValue) || 0), 0);
    }
    return 0;
  }, [visibleItems, activeSection]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  };

  const sortMark = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const handlePrint = () => {
    const range = formatDateRangeText(stockDateRange, dateSystem, formatDate, formatDateBS);
    const money = (value: number) => formatCurrencyForPrint(value, { noSuffix: true, noAnimation: true });
    let body: PrintCell[][];
    let widths: Array<string | number>;
    if (activeSection === "low-stock") {
      widths = ["*", 75, 75];
      body = [
        [
          { text: "Item Name", bold: true, fontSize: 8 },
          { text: "Current Qty", bold: true, fontSize: 8, alignment: "right" },
          { text: "Min Stock", bold: true, fontSize: 8, alignment: "right" },
        ],
      ];
      visibleItems.forEach((item) => {
        const unit = item.smallestUnit || item.unit;
        body.push([
          { text: item.name, fontSize: 7, noWrap: false },
          { text: `${Number(item.qty).toFixed(2)} ${unit}`, fontSize: 7, alignment: "right" },
          {
            text: `${Number(item.warningLevel || 0).toFixed(2)} ${unit}`,
            fontSize: 7,
            alignment: "right",
          },
        ]);
      });
    } else {
      widths = ["*", 75, 85];
      const amountLabel = activeSection === "sale" ? "Sale Amount" : "Purchase Amount";
      body = [
        [
          { text: "Item Name", bold: true, fontSize: 8 },
          { text: "Qty", bold: true, fontSize: 8, alignment: "right" },
          { text: amountLabel, bold: true, fontSize: 8, alignment: "right" },
        ],
      ];
      visibleItems.forEach((item) => {
        const qty = activeSection === "sale" ? item.salesQty : item.purchaseQty;
        const amount = activeSection === "sale" ? item.salesValue : item.purchaseValue;
        body.push([
          { text: item.name, fontSize: 7, noWrap: false },
          { text: `${qty.toFixed(2)} ${item.smallestUnit || item.unit}`, fontSize: 7, alignment: "right" },
          { text: money(amount), fontSize: 7, alignment: "right" },
        ]);
      });
      body.push([
        {
          text: activeSection === "sale" ? "Total Sale Amount" : "Total Purchase Amount",
          bold: true,
          fontSize: 8,
          colSpan: 2,
        },
        {},
        { text: money(totalAmount), bold: true, fontSize: 8, alignment: "right" },
      ]);
    }

    openPrintDirect(
      {
        company: {
          name: company?.name || "",
          address: company?.address,
          phone: company?.phone,
          pan: company?.pan,
          logoUrl: company?.logoUrl,
        },
        dateSystem,
        title: meta.title,
        dateRangeText: range,
        context: "daybook",
        vouchersCount: 0,
        openingBalance: 0,
        transactions: [],
        customContent: [
          {
            table: { widths, body },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0,
              paddingLeft: () => 2,
              paddingRight: () => 2,
              paddingTop: () => 2,
              paddingBottom: () => 2,
            },
          },
        ],
      },
      true,
    );
  };

  const preventSelectDismiss = (event: { target: EventTarget | null; preventDefault: () => void }) => {
    const target = event.target as HTMLElement;
    if (target?.closest?.("[data-radix-select-content]")) event.preventDefault();
  };

  return (
      <DialogContent
        data-pl-stock-section-popup={activeSection}
        className={cn(
          "dashboard-financial-popup max-w-4xl p-0 h-[90vh] rounded-lg flex flex-col",
          "app-chrome-top-ribbon overflow-hidden",
          proDashboardRibbonClass(meta.ribbonIndex),
        )}
        onPointerDownOutside={preventSelectDismiss}
        onInteractOutside={preventSelectDismiss}
      >
        <DialogHeader className="px-4 pt-4 pb-2 border-b flex flex-row justify-between items-center">
          <div className="flex flex-col">
            <DialogTitle className="font-bold text-black">{meta.title}</DialogTitle>
          </div>
          <div
            className="flex items-center gap-2 mr-12"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="[&_button]:h-9"
            >
              <MonthYearFilter
                dateRange={stockDateRange}
                setDateRange={(range) => setStockDateRange(range)}
                dateSystem={dateSystem}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handlePrint();
              }}
              className="h-9 flex items-center gap-2"
            >
              Print <Printer className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 px-4 py-4 flex flex-col min-h-0 min-w-0 gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search item name"
            className="h-9 max-w-sm"
            aria-label="Search item name"
          />
          <div className="border rounded-lg flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain">
              <table className="w-full min-w-max border-collapse">
                <thead className="sticky top-0 bg-background/90 z-10">
                  <tr>
                    <th className={cn(thClass, "text-left border-r border-border/40")}>
                      <button type="button" className="font-bold text-black" onClick={() => toggleSort("name")}>
                        Item Name{sortMark("name")}
                      </button>
                    </th>
                    {activeSection === "low-stock" ? (
                      <>
                        <th className={cn(thClass, "text-right border-r border-border/40")}>
                          <button type="button" className="font-bold text-black" onClick={() => toggleSort("qty")}>
                            Current Qty{sortMark("qty")}
                          </button>
                        </th>
                        <th className={cn(thClass, "text-right")}>
                          <button type="button" className="font-bold text-black" onClick={() => toggleSort("min")}>
                            Min Stock{sortMark("min")}
                          </button>
                        </th>
                      </>
                    ) : (
                      <>
                        <th className={cn(thClass, "text-right border-r border-border/40")}>
                          <button type="button" className="font-bold text-black" onClick={() => toggleSort("amount")}>
                            Amount{sortMark("amount")}
                          </button>
                        </th>
                        <th className={cn(thClass, "text-right")}>
                          <button type="button" className="font-bold text-black" onClick={() => toggleSort("qty")}>
                            Quantity{sortMark("qty")}
                          </button>
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td className={cn(tdClass, "text-center text-muted-foreground")} colSpan={3}>
                        {meta.empty}
                      </td>
                    </tr>
                  ) : activeSection === "low-stock" ? (
                    visibleItems.map((item, index) => (
                      <tr key={`low-${item.id}-${index}`}>
                        <td className={cn(tdClass, "font-medium border-r border-border/40")}>{item.name}</td>
                        <td className={cn(tdClass, "text-right font-bold text-amber-600 border-r border-border/40")}>
                          {Number(item.qty).toFixed(2)} {item.smallestUnit || item.unit}
                        </td>
                        <td className={cn(tdClass, "text-right text-muted-foreground")}>
                          {Number(item.warningLevel || 0).toFixed(2)} {item.smallestUnit || item.unit}
                        </td>
                      </tr>
                    ))
                  ) : (
                    visibleItems.map((item, index) => {
                      const amount = activeSection === "sale" ? item.salesValue : item.purchaseValue;
                      const qty = activeSection === "sale" ? item.salesQty : item.purchaseQty;
                      const amountClass = activeSection === "sale" ? "text-green-600" : "text-red-600";
                      return (
                        <tr key={`${activeSection}-${item.id}-${index}`}>
                          <td className={cn(tdClass, "font-medium border-r border-border/40")}>{item.name}</td>
                          <td className={cn(tdClass, "text-right font-bold border-r border-border/40", amountClass)}>
                            {formatCurrency(amount, { noSuffix: true, duration: 2 })}
                          </td>
                          <td className={cn(tdClass, "text-right")}>
                            {qty.toFixed(2)} {item.smallestUnit || item.unit}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {activeSection !== "low-stock" && visibleItems.length > 0 ? (
                  <tfoot className="bg-muted/50">
                    <tr>
                      <td className="px-4 py-2 align-middle font-bold whitespace-nowrap border-r" colSpan={1}>
                        {activeSection === "sale" ? "Total Sale Amount" : "Total Purchase Amount"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2 text-right align-middle font-bold whitespace-nowrap",
                          activeSection === "sale" ? "text-green-600" : "text-red-600",
                        )}
                      >
                        {formatCurrency(totalAmount, { noSuffix: true })}
                      </td>
                      <td className="px-4 py-2" />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </DialogContent>
  );
}
