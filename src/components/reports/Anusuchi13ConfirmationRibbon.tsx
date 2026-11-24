"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LEDGER_HEADER_PILL_CN } from "@/lib/ledgerHeaderChrome";
import type { Anusuchi13ConfirmationFilter } from "@/lib/reports/anusuchi13Confirmation";
import { formatAnusuchi13FyRangeLabel } from "@/lib/reports/anusuchi13Confirmation";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useMemo } from "react";

const FILTER_OPTIONS: { id: Anusuchi13ConfirmationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sent", label: "Confirmation send" },
  { id: "unsent", label: "Confirmation unsend" },
  { id: "completed", label: "Confirmation completed" },
  { id: "uncompleted", label: "Confirmation uncompleted" },
];

type Props = {
  confirmationRunning: boolean;
  onConfirmationRunningChange: (next: boolean) => void;
  confirmationFilter: Anusuchi13ConfirmationFilter;
  onConfirmationFilterChange: (next: Anusuchi13ConfirmationFilter) => void;
  counts: Record<Anusuchi13ConfirmationFilter, number>;
  fyOptions: string[];
  selectedFyKey: string;
  onSelectedFyKeyChange: (next: string) => void;
  className?: string;
};

export function Anusuchi13ConfirmationRibbon({
  confirmationRunning,
  onConfirmationRunningChange,
  confirmationFilter,
  onConfirmationFilterChange,
  counts,
  fyOptions,
  selectedFyKey,
  onSelectedFyKeyChange,
  className,
}: Props) {
  const { company } = useCompany();
  const { formatDateBySystem } = useDate();

  const fyLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const key of fyOptions) {
      map[key] = formatAnusuchi13FyRangeLabel(company?.country, key, formatDateBySystem);
    }
    return map;
  }, [fyOptions, company?.country, formatDateBySystem]);

  const selectedFyLabel = fyLabels[selectedFyKey] ?? selectedFyKey;

  const fyTriggerWidthCh = useMemo(() => {
    const longest = Math.max(
      selectedFyLabel.length,
      ...Object.values(fyLabels).map((label) => label.length),
      12
    );
    return longest + 2.5;
  }, [selectedFyLabel, fyLabels]);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto scrollbar-slim-dim",
        className
      )}
    >
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
        <Checkbox
          checked={confirmationRunning}
          onCheckedChange={(v) => onConfirmationRunningChange(v === true)}
          aria-label={confirmationRunning ? "Confirmation running" : "Start Confirmation"}
        />
        <span className="whitespace-nowrap text-sm font-semibold text-blue-950">
          {confirmationRunning ? "Confirmation running" : "Start Confirmation"}
        </span>
      </label>

      <Select value={selectedFyKey} onValueChange={onSelectedFyKeyChange}>
        <SelectTrigger
          data-pl-toolbar-field=""
          data-pl-anusuchi-fy-select=""
          className={cn(
            LEDGER_HEADER_PILL_CN,
            "h-7 min-h-7 w-fit max-w-none shrink-0 border border-blue-300 bg-white px-2 text-xs text-blue-950",
            "focus:border-blue-400 focus-visible:border-blue-400",
            "[&>span]:max-w-none [&>span]:truncate-none [&>span]:whitespace-nowrap"
          )}
          style={{ width: `${fyTriggerWidthCh}ch` }}
          title={selectedFyLabel}
        >
          <SelectValue placeholder="FY">{selectedFyLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="w-max min-w-[var(--radix-select-trigger-width)] max-w-[92vw]">
          {fyOptions.map((key) => (
            <SelectItem key={key} value={key} className="whitespace-nowrap text-xs">
              {fyLabels[key] ?? key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {confirmationRunning ? (
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1">
          {FILTER_OPTIONS.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              variant={confirmationFilter === id ? "default" : "outline"}
              size="sm"
              className={cn(
                LEDGER_HEADER_PILL_CN,
                "h-7 min-h-7 shrink-0 whitespace-nowrap px-2 text-[11px]"
              )}
              onClick={() => onConfirmationFilterChange(id)}
            >
              {label} {counts[id]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
