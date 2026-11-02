"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { chromeProPillCn } from "@/lib/chromePillButton";

/** Filter Dr/Cr pills jaisa — chromeProPillCn + theme override data attr. */
const footerSummaryCardCn = cn("rounded-md px-2 py-1 max-md:flex max-md:min-h-0 max-md:items-center max-md:justify-center max-md:py-0", chromeProPillCn);

type EntityListDrCrSummaryProps = {
  expenseSystemBalance: number;
  incomeSystemBalance: number;
  formatAmount: (
    amount: number,
    options?: { showDrCr?: boolean; hideCurrencySymbol?: boolean }
  ) => React.ReactNode;
  className?: string;
};

function SummaryCard({
  amount,
  toneClassName,
}: {
  amount: React.ReactNode;
  toneClassName?: string;
}) {
  return (
    <div data-pl-footer-drcr-balance-card="" className={cn("min-w-0 flex-1", footerSummaryCardCn)}>
      <p
        className={cn(
          "truncate text-center text-xs font-bold tabular-nums leading-tight max-md:text-[15px] max-md:leading-[1.05]",
          toneClassName,
        )}
      >
        {amount}
      </p>
    </div>
  );
}

const FOOTER_INTRO =
  "Left: Expenses system group filtered total (Dr). Right: Income system group filtered total (Cr). Balance after search and footer filter.";

/** Footer — Card 1 (Expenses Dr) | Intro pill | Card 2 (Income Cr). */
export function EntityListDrCrBalanceSummary({
  expenseSystemBalance,
  incomeSystemBalance,
  formatAmount,
  className,
}: EntityListDrCrSummaryProps) {
  const expenseTone = expenseSystemBalance >= 0 ? "text-green-600" : "text-red-600";
  const incomeTone = incomeSystemBalance >= 0 ? "text-green-600" : "text-red-600";
  const amountOptions = { showDrCr: true, hideCurrencySymbol: true } as const;

  return (
    <div
      className={cn(
        "pl-mlc-footer-summary-row w-full min-w-0 px-2 max-md:px-[2px] pb-1 pt-1.5 max-md:py-px max-md:pb-px max-md:pt-px",
        className,
      )}
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1.5 max-md:items-stretch">
        <SummaryCard
          amount={formatAmount(expenseSystemBalance, amountOptions)}
          toneClassName={expenseTone}
        />
        <Popover>
          <PopoverTrigger asChild>
            <AppFreshInfoButton size="sm" aria-label="Intro" />
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 text-sm" data-pl-intro="">
            <p className="mb-1 font-semibold text-blue-900">Intro</p>
            <p className="text-muted-foreground">{FOOTER_INTRO}</p>
          </PopoverContent>
        </Popover>
        <SummaryCard
          amount={formatAmount(incomeSystemBalance, amountOptions)}
          toneClassName={incomeTone}
        />
      </div>
    </div>
  );
}
