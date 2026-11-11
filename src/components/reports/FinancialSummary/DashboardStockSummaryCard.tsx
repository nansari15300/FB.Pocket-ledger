"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { startOfDay, endOfDay, isSameDay } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { proDashboardRibbonClass } from "@/lib/proTheme";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { openPrintDirect } from "@/lib/printDirect";
import { MonthYearFilter } from "@/components/dashboard/MonthYearFilter";
import { financialSummaryHairlineRowClass } from "@/components/reports/FinancialSummary/financialSummaryCardStyles";

// Helper function to safely convert date
const safeToDate = (date: any): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (date.toDate instanceof Function) return date.toDate();
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? null : parsed;
};

type StockSummaryItem = {
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
};

type OverallStockSummary = {
  items: StockSummaryItem[];
  totalStockValue: number;
  topSaleItems: StockSummaryItem[];
  topPurchaseItems: StockSummaryItem[];
  lowStockItems: Array<StockSummaryItem & { warningLevel: number }>;
};

export type DashboardStockSummaryCardProps = {
  /** Dashboard stock tab ke liye poori voucher list (FY scope filtered). */
  vouchers: any[];
  /** Item masters — `stockQty` / `purchasePrice` yahan se aate hain. */
  processedItems: any[];
    /** `View Details` / print available. */
    showDetails?: boolean;
    /**
     * Tab active hai? `false` → card koi server call / heavy scan nahi karta.
     * Dashboard Stock tab sirf open hone par `true` bhejta hai.
     */
    active?: boolean;
    className?: string;
};

/**
 * Dashboard "Stock" tab ka akela card: Total Stock Value + Top 5 Sale/Purchase items.
 * Purana Summary tab wala card yahin alag — Summary tab me stock card nahi rehta.
 */
export function DashboardStockSummaryCard({
  vouchers,
  processedItems,
  showDetails = true,
  active = true,
  className,
}: DashboardStockSummaryCardProps) {
  const { formatCurrency, formatDate, formatDateBS, dateSystem } = useDate();
  const { company } = useCompany();
  const [stockDateRange, setStockDateRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const [stockSummaryOpen, setStockSummaryOpen] = useState(false);
  /** Top items list size — user 5 / 10 / 15 / 20 choose kar sakta hai. */
  const [topN, setTopN] = useState<number>(10);

  const overallStockSummary = useMemo<OverallStockSummary>(() => {
    // Tab band hai → kuch mat ginо (server/local scan bhi nahi).
    if (!active) {
      return { items: [], totalStockValue: 0, topSaleItems: [], topPurchaseItems: [], lowStockItems: [] };
    }
    // Default = full period (all stock). Only an explicitly picked month filters the list.
    let filteredVouchers = vouchers;
    if (stockDateRange?.from) {
      const fromDate = startOfDay(stockDateRange.from);
      const toDate = stockDateRange.to ? endOfDay(stockDateRange.to) : endOfDay(fromDate);
      filteredVouchers = vouchers.filter((v) => {
        const txDate = safeToDate(v.date);
        if (!txDate) return false;
        const normalizedTxDate = startOfDay(txDate);
        return normalizedTxDate >= fromDate && normalizedTxDate <= toDate;
      });
    }

    let totalValue = 0;
    const itemMeta = (processedItems || []).map((item) => {
      const conversions = (item.unitConversions || []) as any[];
      const smallestUnit =
        conversions.length > 0 ? conversions[conversions.length - 1].toUnit : item.openingBalanceUnit || "";

      const getFactorToSmallest = (unit: string): number => {
        if (!unit || conversions.length === 0 || unit === smallestUnit) return 1;
        let factor = 1;
        let current = unit;
        for (let i = 0; i < 10; i++) {
          const conv = conversions.find((c) => c.fromUnit === current);
          if (!conv) return 0;
          factor *= Number(conv.conversionFactor) || 1;
          current = conv.toUnit;
          if (current === smallestUnit) break;
        }
        return factor;
      };

      const purchasePriceUnit = item.purchasePriceUnit || smallestUnit;
      const purchasePriceFactor = getFactorToSmallest(purchasePriceUnit);
      const purchasePriceInSmallestUnit =
        purchasePriceFactor > 0 ? (item.purchasePrice || 0) / purchasePriceFactor : 0;
      const value = (item.stockQty || 0) * purchasePriceInSmallestUnit;
      return { item, smallestUnit, getFactorToSmallest, value };
    });
    // Total alag reduce se (render ke andar closure mutation mat karo).
    totalValue = itemMeta.reduce((sum, m) => sum + (Number(m.value) || 0), 0);

    const metaById = new Map(itemMeta.map((m) => [String(m.item.id), m]));
    const movement = new Map<
      string,
      { salesQty: number; salesValue: number; purchaseQty: number; purchaseValue: number }
    >();

    for (const v of filteredVouchers) {
      if (v.type !== "sale" && v.type !== "purchase") continue;
      const lines = v.lineItems;
      if (!Array.isArray(lines)) continue;
      const seen = new Set<string>();
      for (const lineItem of lines) {
        const itemId = String(lineItem?.itemId || "");
        if (!itemId || seen.has(itemId)) continue;
        const meta = metaById.get(itemId);
        if (!meta) continue;
        seen.add(itemId);
        const qty = Number(lineItem.quantity) || 0;
        const lineValue = qty * (Number(lineItem.rate) || 0);
        const standardizedQty = qty * meta.getFactorToSmallest(lineItem.unit);
        const row =
          movement.get(itemId) || { salesQty: 0, salesValue: 0, purchaseQty: 0, purchaseValue: 0 };
        if (v.type === "sale") {
          row.salesQty += standardizedQty;
          row.salesValue += lineValue;
        } else {
          row.purchaseQty += standardizedQty;
          row.purchaseValue += lineValue;
        }
        movement.set(itemId, row);
      }
    }

    const itemsWithSales: StockSummaryItem[] = itemMeta.map(({ item, smallestUnit, value }) => {
      const move = movement.get(String(item.id)) || {
        salesQty: 0,
        salesValue: 0,
        purchaseQty: 0,
        purchaseValue: 0,
      };
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        qty: item.stockQty || 0,
        unit: smallestUnit,
        rate: item.purchasePrice || 0,
        value,
        salesQty: move.salesQty,
        salesValue: move.salesValue,
        purchaseQty: move.purchaseQty,
        purchaseValue: move.purchaseValue,
        smallestUnit,
      };
    });

    // Date range picked → sirf wahi items jinme us period ka sale/purchase hai.
    let filteredItems = itemsWithSales;
    if (stockDateRange?.from) {
      filteredItems = itemsWithSales.filter(
        (item) => item.salesQty > 0 || item.purchaseQty > 0 || item.salesValue > 0 || item.purchaseValue > 0
      );
      totalValue = filteredItems.reduce((sum, item) => sum + item.value, 0);
    }

    filteredItems = [...filteredItems].sort((a, b) => Number(b.value) - Number(a.value));

    const topSaleItems = [...filteredItems]
      .filter((i) => i.salesQty > 0 || i.salesValue > 0)
      .sort((a, b) => b.salesValue - a.salesValue)
      .slice(0, topN);
    const topPurchaseItems = [...filteredItems]
      .filter((i) => i.purchaseQty > 0 || i.purchaseValue > 0)
      .sort((a, b) => b.purchaseValue - a.purchaseValue)
      .slice(0, topN);

    // Low stock: item master ka `lowStockWarning` threshold; qty usse kam/barabar = low.
    // Threshold apni unit me ho sakta hai (Pcs/Kg/Gm) — compare karne se pehle smallest unit me convert.
    // Warning set na ho to item skip (0 matlab "no warning", stock out mat samjho).
    const warningById = new Map<string, number>();
    for (const raw of processedItems || []) {
      const warn = Number(raw?.lowStockWarning ?? 0);
      if (!Number.isFinite(warn) || warn <= 0) continue;

      const warnUnit = String(raw?.lowStockWarningUnit || "").trim();
      let warnInSmallest = warn;
      if (warnUnit) {
        const conversions = ((raw?.unitConversions || []) as any[]);
        const smallest =
          conversions.length > 0 ? conversions[conversions.length - 1].toUnit : raw?.openingBalanceUnit || "";
        if (warnUnit !== smallest && conversions.length > 0) {
          // warnUnit → smallest tak ka factor
          let factor = 1;
          let current = warnUnit;
          for (let i = 0; i < 10; i++) {
            const conv = conversions.find((c: any) => c.fromUnit === current);
            if (!conv) break;
            factor *= Number(conv.conversionFactor) || 1;
            current = conv.toUnit;
            if (current === smallest) break;
          }
          warnInSmallest = warn * factor;
        }
      }
      warningById.set(String(raw?.id ?? ""), warnInSmallest);
    }
    const lowStockItems = filteredItems
      .map((item) => ({ ...item, warningLevel: warningById.get(item.id) ?? 0 }))
      .filter((item) => item.warningLevel > 0 && Number(item.qty) <= item.warningLevel)
      .sort((a, b) => {
        // Sabse zyada shortfall pehle (warning - qty), phir chhota stock, phir naam.
        const aGap = a.warningLevel - Number(a.qty);
        const bGap = b.warningLevel - Number(b.qty);
        if (bGap !== aGap) return bGap - aGap;
        if (Number(a.qty) !== Number(b.qty)) return Number(a.qty) - Number(b.qty);
        return a.name.localeCompare(b.name);
      })
      .slice(0, topN);

    return {
      items: filteredItems,
      totalStockValue: totalValue,
      topSaleItems,
      topPurchaseItems,
      lowStockItems,
    };
  }, [processedItems, vouchers, stockDateRange, active, topN]);

  const handlePrintStock = () => {
    let dateRangeText = "All Time";
    if (stockDateRange?.from) {
      const from = stockDateRange.from;
      const to = stockDateRange.to || from;
      const fromBS = formatDateBS(from);
      const toBS = formatDateBS(to);
      const fromAD = formatDate(from);
      const toAD = formatDate(to);
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${!isSameDay(from, to) ? ` to ${toAD}` : ""}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${!isSameDay(from, to) ? ` to ${toBS}` : ""}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }

    const body: any[] = [
      [
        { text: "Item Name", bold: true, fontSize: 8 },
        { text: "Qty", bold: true, fontSize: 8, alignment: "right" },
        { text: "Rate", bold: true, fontSize: 8, alignment: "right" },
        { text: "Value", bold: true, fontSize: 8, alignment: "right" },
      ],
    ];
    overallStockSummary.items.forEach((i) => {
      body.push([
        { text: i.name, fontSize: 7, noWrap: false },
        { text: `${i.qty.toFixed(2)} ${i.unit}`, fontSize: 7, alignment: "right" },
        { text: formatCurrency(i.rate, { noSuffix: true, noAnimation: true }), fontSize: 7, alignment: "right" },
        { text: formatCurrency(i.value, { noSuffix: true, noAnimation: true }), fontSize: 7, alignment: "right" },
      ]);
    });
    body.push([
      { text: "Total Stock Value", bold: true, fontSize: 8, colSpan: 3 },
      {},
      {},
      {
        text: formatCurrency(overallStockSummary.totalStockValue, { noSuffix: true, noAnimation: true }),
        bold: true,
        fontSize: 8,
        alignment: "right",
      },
    ]);

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
        title: "Stock Summary",
        dateRangeText,
        context: "daybook",
        vouchersCount: 0,
        openingBalance: 0,
        transactions: [],
        customContent: [
          {
            table: {
              widths: ["*", 65, 65, 75],
              body,
            },
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
      true
    );
  };

  return (
    <Card
      data-pl-stock-summary-card=""
      className={cn(
        "app-chrome-top-ribbon transition-colors flex flex-col w-full min-h-0 self-stretch overflow-hidden",
        proDashboardRibbonClass(0),
        className
      )}
    >
      {/* Header row main card ke andar: title + total value + filters */}
      <div className="shrink-0 border-b border-border/50 bg-transparent px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <CardTitle className="text-base whitespace-nowrap min-w-0">Stock Summary</CardTitle>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                Total Stock Value
              </span>
              <span
                className={cn(
                  "text-lg font-bold whitespace-nowrap tabular-nums",
                  overallStockSummary.totalStockValue >= 0 ? "text-green-600" : "text-red-600"
                )}
              >
                {formatCurrency(overallStockSummary.totalStockValue, { noSuffix: true, duration: 2 })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v) || 10)}>
              <SelectTrigger
                aria-label="Top items count"
                data-pl-stock-top-select=""
                className="h-8 w-[104px] text-xs !border !border-[1px] !border-solid !border-blue-500 !bg-white !text-black shadow-none"
              >
                <SelectValue placeholder="Top 10" />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    Top {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <MonthYearFilter
              dateRange={stockDateRange}
              setDateRange={(r) => setStockDateRange(r)}
              dateSystem={dateSystem}
            />
          </div>
        </div>
      </div>

      {/* Section cards — Top Sale | Top Purchase | Low Stock */}
      <CardContent className="p-3 flex flex-col min-h-0 flex-1">
        <ScrollArea className="flex-1 min-h-0 pr-3 -mr-1">
          <div className="pb-2 grid gap-3 md:grid-cols-3 md:items-start">
              {/* Top Sale */}
              <Card
                data-pl-stock-summary-section="sale"
                className={cn("app-chrome-top-ribbon transition-colors overflow-hidden", proDashboardRibbonClass(3))}
              >
                <CardContent className="p-3">
                  <h4 className="text-xs font-semibold mb-1.5 text-center">Top {topN} Sale Items</h4>
                  <div className="space-y-1">
                    {overallStockSummary.topSaleItems.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">No sale items</p>
                    ) : (
                      overallStockSummary.topSaleItems.map((item, index) => (
                        <div
                          key={`sale-top-${item.id}-${index}`}
                          data-pl-summary-hairline-row=""
                          className={cn(financialSummaryHairlineRowClass, "text-sm pt-1.5")}
                        >
                          <span className="font-semibold min-w-0 truncate">{item.name}</span>
                          <div className="text-right shrink-0 whitespace-nowrap">
                            <p className="font-bold text-green-600">
                              {formatCurrency(item.salesValue, { noSuffix: true, duration: 2 })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.salesQty.toFixed(2)} {item.smallestUnit}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Top Purchase */}
              <Card
                data-pl-stock-summary-section="purchase"
                className={cn("app-chrome-top-ribbon transition-colors overflow-hidden", proDashboardRibbonClass(4))}
              >
                <CardContent className="p-3">
                  <h4 className="text-xs font-semibold mb-1.5 text-center">Top {topN} Purchase Items</h4>
                  <div className="space-y-1">
                    {overallStockSummary.topPurchaseItems.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">No purchase items</p>
                    ) : (
                      overallStockSummary.topPurchaseItems.map((item, index) => (
                        <div
                          key={`purchase-top-${item.id}-${index}`}
                          data-pl-summary-hairline-row=""
                          className={cn(financialSummaryHairlineRowClass, "text-sm pt-1.5")}
                        >
                          <span className="font-semibold min-w-0 truncate">{item.name}</span>
                          <div className="text-right shrink-0 whitespace-nowrap">
                            <p className="font-bold text-red-600">
                              {formatCurrency(item.purchaseValue, { noSuffix: true, duration: 2 })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.purchaseQty.toFixed(2)} {item.smallestUnit}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Low Stock */}
              <Card
                data-pl-stock-summary-section="low-stock"
                className={cn("app-chrome-top-ribbon transition-colors overflow-hidden", proDashboardRibbonClass(5))}
              >
                <CardContent className="p-3">
                  <h4 className="text-xs font-semibold mb-1.5 text-center">Low Stock Items</h4>
                  <div className="space-y-1">
                    {overallStockSummary.lowStockItems.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        No low stock items
                      </p>
                    ) : (
                      overallStockSummary.lowStockItems.map((item, index) => (
                        <div
                          key={`low-stock-${item.id}-${index}`}
                          data-pl-summary-hairline-row=""
                          className={cn(financialSummaryHairlineRowClass, "text-sm pt-1.5")}
                        >
                          <span className="font-semibold min-w-0 truncate">{item.name}</span>
                          <div className="text-right shrink-0 whitespace-nowrap">
                            <p className="font-bold text-amber-600">
                              {Number(item.qty).toFixed(2)} {item.smallestUnit}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              min {Number(item.warningLevel).toFixed(2)} {item.smallestUnit}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
        </ScrollArea>
      </CardContent>

      {showDetails && (
        <div className="shrink-0 text-right px-1">
          <Dialog open={stockSummaryOpen} onOpenChange={setStockSummaryOpen}>
            <DialogTrigger asChild>
              <Button variant="link" size="sm" className="h-auto p-0">
                View Details
              </Button>
            </DialogTrigger>
              <DialogContent
                className="dashboard-financial-popup max-w-4xl p-0 h-[90vh] rounded-lg flex flex-col"
                onPointerDownOutside={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-radix-select-content]")) e.preventDefault();
                }}
                onInteractOutside={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-radix-select-content]")) e.preventDefault();
                }}
              >
                <DialogHeader className="px-4 pt-4 pb-2 border-b flex flex-row justify-between items-center">
                  <div className="flex flex-col">
                    <DialogTitle className="font-bold text-black">Stock Summary Details</DialogTitle>
                  </div>
                  <div
                    className="flex items-center gap-2 mr-12"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="[&_button]:h-9">
                      <MonthYearFilter
                        dateRange={stockDateRange}
                        setDateRange={(r) => setStockDateRange(r)}
                        dateSystem={dateSystem}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrintStock();
                      }}
                      className="h-9 flex items-center gap-2"
                    >
                      Print <Printer className="h-4 w-4" />
                    </Button>
                  </div>
                </DialogHeader>
                <div className="flex-1 px-4 py-4 flex flex-col min-h-0 min-w-0">
                  <div className="border rounded-lg flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                    <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain">
                      <table className="w-full min-w-max border-collapse">
                        <thead className="sticky top-0 bg-background z-10">
                          <tr>
                            <th className="h-9 px-4 text-left align-middle font-bold text-black whitespace-nowrap border-b border-border/75 border-r border-border/40">
                              Item Name
                            </th>
                            <th className="h-9 px-4 text-right align-middle font-bold text-black whitespace-nowrap border-b border-border/75 border-r border-border/40">
                              Quantity
                            </th>
                            <th className="h-9 px-4 text-right align-middle font-bold text-black whitespace-nowrap border-b border-border/75 border-r border-border/40">
                              Rate
                            </th>
                            <th className="h-9 px-4 text-right align-middle font-bold text-black whitespace-nowrap border-b border-border/75">
                              Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {overallStockSummary.items.map((item, i) => (
                            <tr key={i}>
                              <td className="px-4 py-2 align-middle font-medium whitespace-nowrap border-b border-border/65 border-r border-border/40">
                                {item.name}
                              </td>
                              <td className="px-4 py-2 text-right align-middle whitespace-nowrap border-b border-border/65 border-r border-border/40">
                                {item.qty.toFixed(2)} {item.unit}
                              </td>
                              <td className="px-4 py-2 text-right align-middle whitespace-nowrap border-b border-border/65 border-r border-border/40">
                                {formatCurrency(item.rate, { noSuffix: true })}
                              </td>
                              <td className="px-4 py-2 text-right align-middle font-bold whitespace-nowrap border-b border-border/65">
                                {formatCurrency(item.value, { noSuffix: true })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/50">
                          <tr>
                            <td className="px-4 py-2 align-middle font-bold whitespace-nowrap border-r" colSpan={3}>
                              Total Stock Value
                            </td>
                            <td className="px-4 py-2 text-right align-middle font-bold text-green-600 whitespace-nowrap">
                              {formatCurrency(overallStockSummary.totalStockValue, { noSuffix: true })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
      )}
    </Card>
  );
}
