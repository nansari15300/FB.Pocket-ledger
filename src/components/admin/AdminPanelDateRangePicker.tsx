"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import BsDatePicker from "@/components/ui/BsDatePicker";
import AdCalendar, { type DateRange } from "@/components/ui/ad-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { useDate } from "@/hooks/useDate";
import { useCalendarMonths } from "@/hooks/use-mobile";
import {
  LEDGER_DATE_RANGE_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
} from "@/lib/ledgerHeaderChrome";
import { cn } from "@/lib/utils";

type AdminPanelDateRangePickerProps = {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  transactionDates?: Date[];
  /** Defer Radix pickers until client mount (admin dashboard hydration). */
  ready?: boolean;
  /** Extra clear control beside pills (party ledger jaisa X). */
  showClearButton?: boolean;
  /** Same height as `Input` / `h-9` filter row (default: ledger ~27px pills). */
  matchInputHeight?: boolean;
};

export function AdminPanelDateRangePicker({
  value,
  onChange,
  className,
  transactionDates,
  ready = true,
  showClearButton = true,
  matchInputHeight = false,
}: AdminPanelDateRangePickerProps) {
  const { dateSystem } = useDate();
  const calendarMonths = useCalendarMonths();
  const [adOpen, setAdOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange | undefined>(value);

  useEffect(() => {
    setTempRange(value);
  }, [value]);

  const hasRange = Boolean(value?.from || value?.to);

  const datePillCn = matchInputHeight
    ? "h-9 min-h-9 shrink-0 px-3 text-sm font-semibold text-blue-900"
    : LEDGER_DATE_RANGE_PILL_CN;
  const clearIconCn = matchInputHeight ? "h-9 w-9 min-h-9 shrink-0" : LEDGER_HEADER_PILL_ICON_CN;

  const adLabel = () => {
    if (!value?.from) return <span>Pick a date range</span>;
    if (value.to) {
      return (
        <>
          {format(value.from, "LLL dd, y")} - {format(value.to, "LLL dd, y")}
        </>
      );
    }
    return format(value.from, "LLL dd, y");
  };

  if (!ready) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        className={cn("pointer-events-none min-w-[200px] justify-start opacity-90", datePillCn)}
        aria-hidden
      >
        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
        <span>Loading date filters…</span>
      </Button>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {(dateSystem === "BS" || dateSystem === "Both") && (
        <BsDatePicker
          isRange
          valueAD={value}
          onChangeAD={(range) => onChange(range as DateRange | undefined)}
          transactionDates={transactionDates}
          className={cn("w-auto", datePillCn)}
        />
      )}
      {(dateSystem === "AD" || dateSystem === "Both") && (
        <Popover open={adOpen} onOpenChange={setAdOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              id="admin-panel-date-range"
              variant="outline"
              className={cn("justify-start text-left w-auto", datePillCn)}
              data-theme-detail="date-range"
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5" />
              {adLabel()}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <AdCalendar
              rangePresetSlot={
                <DateRangePresetRow
                  onApply={(r) => {
                    const next = { from: r.from, to: r.to };
                    setTempRange(next);
                    onChange(next);
                    setAdOpen(false);
                  }}
                  onApplyDefault={() => {
                    setTempRange(undefined);
                    onChange(undefined);
                    setAdOpen(false);
                  }}
                />
              }
              valueAD={tempRange}
              isRange
              numberOfMonths={calendarMonths}
              transactionDates={transactionDates}
              onSelect={(adDate) => {
                const range = tempRange;
                if (!range?.from || (range.from && range.to)) {
                  setTempRange({ from: adDate, to: undefined });
                } else if (adDate < range.from) {
                  const next = { from: adDate, to: range.from };
                  setTempRange(next);
                  onChange(next);
                  setAdOpen(false);
                } else {
                  const next = { from: range.from, to: adDate };
                  setTempRange(next);
                  onChange(next);
                  setAdOpen(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      {showClearButton && hasRange ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(clearIconCn, "text-muted-foreground hover:text-foreground")}
          aria-label="Clear date filter"
          onClick={() => {
            setTempRange(undefined);
            onChange(undefined);
          }}
        >
          <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
        </Button>
      ) : null}
    </div>
  );
}
