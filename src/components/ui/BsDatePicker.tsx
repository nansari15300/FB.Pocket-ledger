"use client";
import * as React from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as Icon } from "lucide-react";
import { type BSDate, canConvertAdDateToBs } from "@/lib/bs-date";
import type { DateRange } from "@/components/ui/ad-calendar";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useCalendarMonths } from "@/hooks/use-mobile";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { VOUCHER_DIALOG_CALENDAR_POPOVER_CN } from "@/lib/dialogShellChrome";

type BsDatePickerBaseProps = {
  numberOfMonths?: number;
  transactionDates?: Date[];
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  /** Mobile-only Recent Transactions jaisa: trigger par calendar icon nahin — lucide Icon hide */
  hideTriggerIcon?: boolean;
  /** Range mode me empty/`from`-only fallback text (default: "Pick a date range") */
  rangeEmptyLabel?: string;
  /** true = `data-theme-detail="date-range"` mat lagao — global black border override avoid (recon ribbon blue pill). */
  skipDateRangeThemeDetail?: boolean;
  /** Nested ledger edit dialog ke upar calendar popover (z-index). */
  popoverContentClassName?: string;
  /** Optional popover placement (e.g. Date Converter mobile). */
  popoverSide?: React.ComponentProps<typeof PopoverContent>["side"];
  popoverAlign?: React.ComponentProps<typeof PopoverContent>["align"];
  showDateConverterButton?: boolean;
  /** Master ledger: "Last 10" clears filter + reloads default FY voucher scope. */
  masterLedgerDatePresets?: boolean;
  /** Hide the range preset chips (7 days, Month, F Y, ...) inside the calendar. */
  hideRangePresets?: boolean;
  /** With master presets: footer rows/page → 10 on "Last 10". */
  ledgerPaginationReset?: import("@/lib/ledgerLast10View").LedgerPaginationResetHandlers | null;
  /**
   * Optional control rendered visually inside the date pill (e.g. an intro (i)).
   * Kept outside the calendar trigger so clicking it does not open the picker.
   */
  trailing?: React.ReactNode;
};

type BsDatePickerConditionalProps =
  | {
      isRange?: true;
      valueAD?: DateRange;
      onChangeAD: (date?: DateRange | undefined) => void;
    }
  | {
      isRange: false;
      valueAD?: Date;
      onChangeAD: (date?: Date | undefined) => void;
    };

type BsDatePickerProps = BsDatePickerBaseProps & BsDatePickerConditionalProps;


/** AD day can convert to BS (nepali-date-converter + datex-bs extended map). */
function isValidForBS(date?: Date | null): boolean {
    if (!date) return false;
    if (!(date instanceof Date)) return false;
    return canConvertAdDateToBs(date);
}

/** AD date ko calendar noon pe — BS/ad-calendar ke saath timezone drift avoid */
function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

export default function BsDatePicker({
  valueAD,
  onChangeAD,
  numberOfMonths: numberOfMonthsProp,
  transactionDates = [],
  isRange: isRangeProp,
  disabled = false,
  children,
  className,
  hideTriggerIcon = false,
  rangeEmptyLabel,
  skipDateRangeThemeDetail = false,
  popoverContentClassName,
  popoverSide,
  popoverAlign,
  showDateConverterButton = true,
  masterLedgerDatePresets = false,
  hideRangePresets = false,
  ledgerPaginationReset,
  trailing,
}: BsDatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const { formatDateBS } = useDate();
  const { company } = useCompany();
  const calendarMonths = useCalendarMonths(); // mobile: 1 month, PC: 2 months (date range)
  const isRange = isRangeProp ?? true;
  const numberOfMonths = numberOfMonthsProp ?? (isRange ? calendarMonths : 1);
  
  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    // ✅ FINAL FIX: Do NOT use startOfDay. Use Noon (12:00 PM).
    
    // १. मितिको Year, Month, Day निकाल्ने (Timezone Issue हटाउन)
    const y = adDate.getFullYear();
    const m = adDate.getMonth();
    const d = adDate.getDate();

    // २. नयाँ मिति बनाउने तर समय १२ बजे (12:00:00) राख्ने
    // यसले गर्दा UTC मा जाँदा पनि दिन घट्दैन (किनकि 12:00 - 5:45 = 06:15 हुन्छ, जुन सोही दिन हो)
    const normalizedAdDate = new Date(y, m, d, 12, 0, 0, 0); 

    // ❌ startOfDay(normalizedAdDate) - यो प्रयोग नगर्नुहोस, यसले फेरि समस्या ल्याउँछ।

    if (!isRange) {
        (onChangeAD as (date?: Date) => void)(normalizedAdDate);
        setOpen(false);
    } else {
        const range = valueAD as DateRange | undefined;
        let newRange: DateRange | undefined;
        
        if (!range?.from || (range.from && range.to)) {
            // First date selection or reset - don't close calendar
            newRange = { from: normalizedAdDate, to: undefined };
        } else {
            // Second date selection - only close when both dates are set
            // समय १२ बजे भएकोले तुलना (Comparison) सही हुन्छ
            if (normalizedAdDate < range.from) {
                newRange = { from: normalizedAdDate, to: range.from };
            } else {
                newRange = { from: range.from, to: normalizedAdDate };
            }
            // Only close calendar when both from and to are set
            if (newRange.from && newRange.to) {
                setOpen(false);
            }
        }
        (onChangeAD as (date?: DateRange) => void)(newRange);
    }
  }

  const emptyRangeText = () => rangeEmptyLabel ?? "Pick a date range";

  const displayValue = () => {
    if (children) return children;
    if (!valueAD) return isRange ? emptyRangeText() : "Pick a date";

    if (isRange) {
        const range = valueAD as DateRange | undefined;
        if (!range?.from) return emptyRangeText();
        const fromBS = isValidForBS(range.from) ? formatDateBS(range.from) : "";
        const toBS = range.to && isValidForBS(range.to) ? formatDateBS(range.to) : "";
        if (fromBS && toBS) {
          if (fromBS === toBS) return fromBS;
          return `${fromBS} - ${toBS}`;
        }
        return fromBS;
    }

    const singleDate = valueAD as Date;
    if (!isValidForBS(singleDate)) return "Select BS Date";
    return formatDateBS(singleDate);
  }

  const triggerButton = (
    <Button
      variant="outline"
      className={cn(
        "w-auto justify-start text-left h-[27px] min-h-[27px] px-2 gap-1 min-w-0",
        hideTriggerIcon && "gap-0",
        masterLedgerDatePresets
          ? "font-semibold text-blue-900"
          : cn("font-normal", !valueAD && "text-muted-foreground"),
        className,
        trailing && "pr-6",
      )}
      disabled={disabled}
      onClick={() => setOpen(true)}
      {...(skipDateRangeThemeDetail ? {} : { "data-theme-detail": "date-range" })}
    >
      {!hideTriggerIcon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate min-w-0">{displayValue()}</span>
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      {trailing ? (
        <div
          className={cn(
            "relative inline-flex min-w-0",
            typeof className === "string" && className.includes("w-full") && "w-full",
          )}
        >
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <div
            className="absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center"
            data-pl-date-pill-trailing=""
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {trailing}
          </div>
        </div>
      ) : (
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      )}
      <PopoverContent
        side={popoverSide}
        align={popoverAlign ?? "start"}
        collisionPadding={16}
        className={cn(
          "w-auto p-0",
          VOUCHER_DIALOG_CALENDAR_POPOVER_CN,
          // Narrow viewports: keep popover in screen; inner NepaliCalendar scrolls (presets + calendar)
          "max-w-[calc(100vw-1rem)] sm:max-w-none",
          popoverContentClassName
        )}
      >
        <NepaliCalendar
            onSelect={handleNepaliSelect}
            valueAD={valueAD}
            isRange={isRange}
            numberOfMonths={numberOfMonths}
            transactionDates={transactionDates}
            disabled={disabled}
            rangePresetSlot={
              isRange && !hideRangePresets
                ? masterLedgerDatePresets
                  ? (
                      <MasterLedgerDateRangePresetRow
                        disabled={disabled}
                        country={company?.country}
                        ledgerPaginationReset={ledgerPaginationReset}
                        onDateRangeChange={(range) => {
                          (onChangeAD as (date?: DateRange | undefined) => void)(range);
                        }}
                        onApply={(r) => {
                          (onChangeAD as (date?: DateRange | undefined) => void)(r);
                          setOpen(false);
                        }}
                        onAfterDefault={() => setOpen(false)}
                      />
                    )
                  : (
                      <DateRangePresetRow
                        disabled={disabled}
                        country={company?.country}
                        onApply={(r) => {
                          (onChangeAD as (date?: DateRange | undefined) => void)(r);
                          setOpen(false);
                        }}
                        onApplyDefault={() => {
                          (onChangeAD as (date?: DateRange | undefined) => void)(undefined);
                          setOpen(false);
                        }}
                      />
                    )
                : undefined
            }
            showDateConverterButton={showDateConverterButton}
        />
      </PopoverContent>
    </Popover>
  );
}