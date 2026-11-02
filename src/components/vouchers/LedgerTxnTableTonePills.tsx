"use client";

import { cn } from "@/lib/utils";
import { chromePillActive, chromeProPillCn } from "@/lib/chromePillButton";
import { useTheme } from "@/hooks/useTheme";
import type { LedgerTxnTableTone } from "@/lib/ledgerTxnTableTone";

const TONE_OPTS = [
  { id: "default", label: "Default" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
] as const;

/** Closing-balance row: Default / Green / Blue table tone — Pro theme only. */
export function LedgerTxnTableTonePills({
  value,
  onChange,
}: {
  value: LedgerTxnTableTone;
  onChange: (next: LedgerTxnTableTone) => void;
}) {
  const { theme } = useTheme();
  if (theme !== "theme-pro") return null;

  return (
    <div
      className="flex shrink-0 flex-nowrap items-center gap-1"
      data-pl-txn-table-tone-pills=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {TONE_OPTS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={cn(
            chromeProPillCn,
            "h-7 rounded-full px-2.5 text-[11px] font-semibold",
            value === opt.id && chromePillActive
          )}
          aria-pressed={value === opt.id}
          onClick={(e) => {
            e.stopPropagation();
            onChange(opt.id);
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
