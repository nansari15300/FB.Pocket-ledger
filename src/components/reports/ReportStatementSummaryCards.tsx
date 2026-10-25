"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import { getDisplayType } from "@/components/vouchers/transactionTableShared";
import { isUnverifiedTaxTdsBalanceRow, type PartyTdsBalanceSummary } from "@/lib/partyLedgerTdsView";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ReportStatementSummaryCardData = {
  title: string;
  amount: number;
  color: string;
  selected?: boolean;
  onClick?: () => void;
  filterKey?: string | null;
};

export const SALE_TDS_BALANCE_CARD_TITLE = "Sale TDS Balance";
export const PUR_TDS_BALANCE_CARD_TITLE = "Pur TDS Balance";
export const ADD_SALARY_TDS_BALANCE_CARD_TITLE = "Add Salary TDS Balance";

export const REPORT_DETAIL_SUMMARY_CARDS_ROW_WRAP_CN =
  "box-border flex w-full min-w-0 flex-nowrap justify-start gap-2 px-2 pt-0.5 pb-2 overflow-x-auto scrollbar-slim-dim flex-shrink-0 border-b bg-slate-50/90";

export function isReportTdsBalanceCardTitle(title: string) {
  const normalized = title.toLowerCase().trim();
  return (
    normalized === SALE_TDS_BALANCE_CARD_TITLE.toLowerCase() ||
    normalized === PUR_TDS_BALANCE_CARD_TITLE.toLowerCase() ||
    normalized === ADD_SALARY_TDS_BALANCE_CARD_TITLE.toLowerCase()
  );
}

export function reportTdsFilterSide(filterKey: string | null | undefined): "sale" | "purchase" | null {
  if (!filterKey) return null;
  const raw = filterKey.startsWith("summary:") ? filterKey.slice(8) : filterKey;
  const normalized = raw.toLowerCase().trim();
  if (normalized === SALE_TDS_BALANCE_CARD_TITLE.toLowerCase()) return "sale";
  if (
    normalized === PUR_TDS_BALANCE_CARD_TITLE.toLowerCase() ||
    normalized === ADD_SALARY_TDS_BALANCE_CARD_TITLE.toLowerCase()
  ) {
    return "purchase";
  }
  return null;
}

export function buildPartyTdsReportSummaryCards(
  summary: PartyTdsBalanceSummary | null | undefined,
  opts?: { staffSalaryTds?: boolean }
): ReportStatementSummaryCardData[] {
  if (!summary?.hasAny) return [];
  const cards: ReportStatementSummaryCardData[] = [];
  if (summary.saleTds > 0) {
    cards.push({
      title: SALE_TDS_BALANCE_CARD_TITLE,
      amount: summary.saleTds,
      color: "text-green-600",
      filterKey: `summary:${SALE_TDS_BALANCE_CARD_TITLE}`,
    });
  }
  if (summary.purchaseTds > 0) {
    const title = opts?.staffSalaryTds ? ADD_SALARY_TDS_BALANCE_CARD_TITLE : PUR_TDS_BALANCE_CARD_TITLE;
    cards.push({
      title,
      amount: -summary.purchaseTds,
      color: "text-red-600",
      filterKey: `summary:${title}`,
    });
  }
  return cards;
}

export function insertReportCardsAfterNetBalance<T extends { title: string }>(cards: T[], extra: T[]): T[] {
  if (!extra.length) return cards;
  const idx = cards.findIndex((card) => ["Balance", "Account Balance", "Net Balance"].includes(card.title));
  if (idx < 0) return [...extra, ...cards];
  return [...cards.slice(0, idx + 1), ...extra, ...cards.slice(idx + 1)];
}

const ReportStatementSummaryCard = React.memo(function ReportStatementSummaryCard({
  title,
  amount,
  color,
  selected,
  onClick,
}: ReportStatementSummaryCardData) {
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const showDrCr = title.toLowerCase().includes("balance") || title.toLowerCase() === "unverified tds";
  const formatted = formatCurrency(amount, { showDrCr });
  const titleStr = formatCurrencyForPrint(amount, { showDrCr });
  return (
    <Card
      data-pl-report-balance-card-surface=""
      data-pl-bank-report-balance-card-surface=""
      data-pl-report-balance-card-selected={selected ? "true" : undefined}
      className={cn(
        "h-12 min-h-12 min-w-0 w-full overflow-hidden rounded-lg border px-2 py-1.5 shadow-none",
        "pl-dashboard-tone-card",
        selected ? "pl-dashboard-ribbon-sky border-blue-500" : "pl-dashboard-ribbon-emerald",
        onClick && "w-max min-w-[100px] border-emerald-500",
        selected && "border-blue-500"
      )}
    >
      <div className={cn("flex min-w-0 flex-col justify-center gap-0.5", title === "Net Balance" && "pr-4")}>
        <p className="whitespace-nowrap text-[10px] font-semibold leading-tight text-muted-foreground">{title}</p>
        <p
          className={cn("whitespace-nowrap text-sm font-bold tabular-nums leading-tight", color)}
          title={titleStr}
        >
          {formatted}
        </p>
      </div>
    </Card>
  );
}, (prev, next) =>
  prev.title === next.title &&
  prev.amount === next.amount &&
  prev.color === next.color &&
  prev.selected === next.selected &&
  prev.filterKey === next.filterKey
);

/** Party Statement left panel — Balance/Sales top row, Purchases/Money In/Out bottom row. */
export function ReportStatementSummaryCardsGrid({
  cards,
  className,
}: {
  cards: ReportStatementSummaryCardData[];
  className?: string;
}) {
  const topRow = cards.slice(0, 2);
  const bottomRow = cards.slice(2);
  return (
    <div className={cn("min-w-0 space-y-1.5", className)} data-pl-party-statement-summary>
      <div className="grid grid-cols-2 gap-1.5">
        {topRow.map((card) => (
          <ReportStatementSummaryCard key={card.title} {...card} />
        ))}
      </div>
      {bottomRow.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {bottomRow.map((card) => (
            <ReportStatementSummaryCard key={card.title} {...card} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** PC report: cards sit in the account header (next to name), not a separate top strip. */
export function ReportHeaderSummaryCards({
  cards,
  className,
}: {
  cards?: ReportStatementSummaryCardData[] | null;
  className?: string;
}) {
  if (!cards?.length) return null;
  return (
    <div
      data-pl-report-header-summary-cards=""
      className={cn("min-w-0 flex-1 overflow-x-auto scrollbar-slim-dim", className)}
    >
      <ReportStatementSummaryCardsRow cards={cards} className="w-max min-w-0 flex-shrink-0 overflow-visible" />
    </div>
  );
}

/** Mobile horizontal strip - same card chrome as grid.
 * Click behaviour: 1st click on a card = its filter (card.onClick). Click on the already-selected card =
 * dropdown of ALL cards (label + amount); pick one -> apply its filter + scroll it into view. Esc / outside closes.
 */
export function ReportStatementSummaryCardsRow({
  cards,
  className,
}: {
  cards: ReportStatementSummaryCardData[];
  className?: string;
}) {
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const [pickerFor, setPickerFor] = React.useState<string | null>(null);
  const pendingScrollRef = React.useRef<string | null>(null);

  /** Strip-only card elements (dropdown copies are never registered here). */
  const stripCardEls = React.useRef(new Map<string, HTMLElement>());
  const scrollTimers = React.useRef<number[]>([]);

  /** Strip ke apne overflow-x container par scrollLeft compute karke card center karo. */
  const scrollCardIntoView = React.useCallback((title: string) => {
    const run = () => {
      const el = stripCardEls.current.get(title);
      if (!el || !el.isConnected) return;
      let sc: HTMLElement | null = el.parentElement;
      while (sc && !(sc.scrollWidth > sc.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowX))) {
        sc = sc.parentElement;
      }
      if (!sc) return;
      const left = el.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft;
      const target = left - (sc.clientWidth - el.offsetWidth) / 2;
      sc.scrollLeft = Math.max(0, Math.min(target, sc.scrollWidth - sc.clientWidth));
    };
    scrollTimers.current.forEach((t) => window.clearTimeout(t));
    requestAnimationFrame(() => requestAnimationFrame(run));
    scrollTimers.current = [60, 200, 400].map((ms) => window.setTimeout(run, ms));
  }, []);
  React.useEffect(() => () => scrollTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const selectedTitle = cards.find((c) => c.selected)?.title ?? null;
  React.useEffect(() => {
    if (selectedTitle) scrollCardIntoView(selectedTitle);
  }, [selectedTitle, scrollCardIntoView]);

  const renderCardButton = (card: ReportStatementSummaryCardData, buttonClassName: string) => (
    <Popover
      open={pickerFor === card.title}
      onOpenChange={(open) => {
        if (!open) setPickerFor((prev) => (prev === card.title ? null : prev));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={card.selected}
          aria-haspopup={card.selected ? "listbox" : undefined}
          data-pl-bank-report-balance-card=""
          data-pl-summary-card-title={card.title}
          ref={(node) => {
            if (node) stripCardEls.current.set(card.title, node);
            else if (stripCardEls.current.get(card.title)?.isConnected === false) stripCardEls.current.delete(card.title);
          }}
          onClick={(e) => {
            if (card.selected && cards.length > 1) {
              e.preventDefault();
              setPickerFor((prev) => (prev === card.title ? null : card.title));
              return;
            }
            setPickerFor(null);
            card.onClick?.();
          }}
          className={buttonClassName}
        >
          <ReportStatementSummaryCard {...card} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-auto max-w-[90vw] p-1.5"
        /* Close par focus trigger (purana card) par lautne se browser use scroll-into-view kar deta tha
           aur hamara scroll override ho jata tha - isliye focus restore band, phir picked card scroll. */
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (pendingScrollRef.current) {
            const t = pendingScrollRef.current;
            pendingScrollRef.current = null;
            scrollCardIntoView(t);
          }
        }}
      >
        <ReportSummaryCardPickerList
          cards={cards}
          onPick={(picked) => {
            pendingScrollRef.current = picked.title;
            setPickerFor(null);
            if (!picked.selected) picked.onClick?.();
            scrollCardIntoView(picked.title);
          }}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      ref={rowRef}
      data-pl-report-statement-summary-cards-row=""
      className={cn("flex flex-nowrap gap-2 overflow-visible", className)}
    >
      {cards.map((card) => card.title === "Net Balance" ? (
        <div key={card.title} className="relative flex h-12 w-max min-w-[100px] shrink-0 items-stretch">
          {renderCardButton(card, "h-full w-max min-w-[100px] rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          <ReportNetBalanceInfoButton />
        </div>
      ) : card.onClick ? (
        <React.Fragment key={card.title}>
          {renderCardButton(card, "h-12 w-max min-w-[100px] shrink-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        </React.Fragment>
      ) : (
        <div key={card.title} className="flex h-12 w-max min-w-[100px] shrink-0 items-stretch"><ReportStatementSummaryCard {...card} /></div>
      ))}
    </div>
  );
}

/** Dropdown rows: every summary card (label + Dr/Cr amount colour), current one marked. */
function ReportSummaryCardPickerList({
  cards,
  onPick,
}: {
  cards: ReportStatementSummaryCardData[];
  onPick: (card: ReportStatementSummaryCardData) => void;
}) {
  return (
    <ul role="listbox" className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-0.5" data-pl-report-summary-card-picker="">
      {cards.map((c) => (
        <li key={c.title} className="flex">
          <button
            type="button"
            role="option"
            aria-selected={!!c.selected}
            disabled={!c.onClick}
            onClick={() => onPick(c)}
            className="h-12 w-full min-w-[160px] rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&>*]:w-full"
          >
            <ReportStatementSummaryCard {...c} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReportNetBalanceInfoButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="About Net Balance" className="absolute right-1 top-1 z-10 rounded-full p-0.5 text-slate-600 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="z-[100] w-64 p-2 text-xs leading-relaxed">
        Shows the actual all-time balance. Date and voucher filters do not change this card.
      </PopoverContent>
    </Popover>
  );
}

export function buildReportVoucherTypeCards(
  transactions: any[],
  context: string,
  contextId?: string,
  groupEntityType?: string,
  summaryTitles: string[] = []
): ReportStatementSummaryCardData[] {
  const totals = new Map<string, number>();
  const covered = new Set(summaryTitles.map((title) => title.trim().toLowerCase()));
  for (const transaction of transactions) {
    const title = getReportVoucherTypeKey(transaction, context, contextId, groupEntityType);
    if (!title || /opening/i.test(title)) continue;
    if (isCoveredBySummaryCard(title, transaction, covered)) continue;
    const amount = Math.abs(Number(transaction?.debit) || Number(transaction?.credit) || Number(transaction?.amount) || Number(transaction?.total) || 0);
    totals.set(title, (totals.get(title) ?? 0) + amount);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, amount]) => ({
    title, amount, color: "text-red-600", filterKey: title,
  }));
}

function isCoveredBySummaryCard(title: string, transaction: any, summaryTitles: Set<string>) {
  const normalized = title.toLowerCase().replace(/_/g, " ").trim();
  const type = String(transaction?.type ?? "").toLowerCase();
  const coveredBy = (card: string) => summaryTitles.has(card);
  if ((type === "sale" || type === "sale_service" || /^tds sale/.test(normalized)) && coveredBy("sales")) return true;
  if ((type === "purchase" || type === "purchase_service" || /^tds purchase/.test(normalized)) && coveredBy("purchases")) return true;
  if (type === "payment_in" && coveredBy("money in")) return true;
  if (type === "payment_out" && coveredBy("money out")) return true;
  if (type === "direct_income" && coveredBy("income")) return true;
  if (type === "direct_expense" && coveredBy("expense")) return true;
  if (type === "journal" && transaction?.subType === "add_salary" && coveredBy("add salary")) return true;
  return false;
}

export function reportVoucherMatchesSummaryCard(
  transaction: any,
  title: string,
  context: string,
  contextId?: string,
  groupEntityType?: string
) {
  const normalizedTitle = title.toLowerCase().trim();
  const voucherTitle = getReportVoucherTypeKey(transaction, context, contextId, groupEntityType).toLowerCase();
  const type = String(transaction?.type ?? "").toLowerCase();
  if (normalizedTitle === "unverified tds") {
    return context === "tax" && Boolean(contextId) && isUnverifiedTaxTdsBalanceRow(transaction, contextId);
  }
  if (isReportTdsBalanceCardTitle(title)) {
    const side = reportTdsFilterSide(`summary:${title}`);
    const rowSide = String(transaction?._ledgerTdsSide ?? "").toLowerCase();
    if (side && rowSide) return rowSide === side;
    if (side === "sale") return type === "sale" || type === "sale_service" || /^tds sale/.test(voucherTitle);
    if (side === "purchase") {
      return (
        type === "purchase" ||
        type === "purchase_service" ||
        /^tds purchase/.test(voucherTitle) ||
        (type === "journal" && transaction?.subType === "add_salary")
      );
    }
    return false;
  }
  if (normalizedTitle === "sales") return type === "sale" || type === "sale_service" || /^tds sale/.test(voucherTitle);
  if (normalizedTitle === "purchases") return type === "purchase" || type === "purchase_service" || /^tds purchase/.test(voucherTitle);
  if (normalizedTitle === "money in") return type === "payment_in" || ((type === "journal" || type === "contra") && transaction?.subType !== "add_salary" && (Number(transaction?.credit) || 0) > 0);
  if (normalizedTitle === "money out") return type === "payment_out" || ((type === "journal" || type === "contra") && transaction?.subType !== "add_salary" && (Number(transaction?.debit) || 0) > 0);
  if (normalizedTitle === "income") return type === "direct_income";
  if (normalizedTitle === "expense") return type === "direct_expense";
  if (normalizedTitle === "add salary") return type === "journal" && transaction?.subType === "add_salary";
  return false;
}

export function reportMobileSummaryCardTitle(title: string) {
  if (title === "Balance" || title === "Account Balance") return "Net Balance";
  if (title === "Money In") return "Receipt";
  if (title === "Money Out") return "Payment Out";
  return title;
}

export function makeMobileReportSummaryCards(
  cards: ReportStatementSummaryCardData[],
  selectedFilter: string | null,
  onSelect: (filter: string | null) => void,
  transactions?: any[],
  context?: string,
  contextId?: string,
  groupEntityType?: string
): ReportStatementSummaryCardData[] {
  const visibleCards = transactions && context
    ? filterReportCardsToExistingVouchers(cards, transactions, context, contextId, groupEntityType)
    : cards;
  return visibleCards.map((card) => {
    // The all-time balance card is the reset / show-all action. The display
    // title is rewritten to "Net Balance" below, so recognize the source
    // titles here before assigning a summary filter key.
    const isNetBalanceCard = ["Balance", "Account Balance", "Net Balance"].includes(card.title);
    const filterKey = isNetBalanceCard ? null : card.filterKey ?? `summary:${card.title}`;
    return {
      ...card,
      title: reportMobileSummaryCardTitle(card.title),
      filterKey,
      selected: selectedFilter === filterKey,
      onClick: () => onSelect(selectedFilter === filterKey ? null : filterKey),
    };
  });
}

export function filterReportCardsToExistingVouchers(
  cards: ReportStatementSummaryCardData[],
  transactions: any[],
  context: string,
  contextId?: string,
  groupEntityType?: string
) {
  return cards.filter((card) => {
    if (card.title === "Balance" || card.title === "Account Balance" || card.title === "Net Balance") return true;
    if (isReportTdsBalanceCardTitle(card.title)) return true;
    return transactions.some((transaction) => card.filterKey?.startsWith("summary:")
      ? reportVoucherMatchesSummaryCard(transaction, card.filterKey.slice(8), context, contextId, groupEntityType)
      : card.filterKey
        ? getReportVoucherTypeKey(transaction, context, contextId, groupEntityType) === card.filterKey
        : reportVoucherMatchesSummaryCard(transaction, card.title, context, contextId, groupEntityType));
  });
}

export function getReportVoucherTypeKey(
  transaction: any,
  context: string,
  contextId?: string,
  groupEntityType?: string
) {
  return getDisplayType(transaction, { context, contextId, groupEntityType }).trim();
}
