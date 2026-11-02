"use client";

/**
 * Company | green Switch (always) | Bank — i icon inside the track (knob ke opposite side).
 * Tone = header file-preview switch (pale mint + green border).
 */
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import {
  BANK_LEDGER_DRCR_PERSPECTIVE_INFO,
  type BankLedgerDrCrPerspective,
} from "@/lib/bankLedgerDrCrPerspective";

type Props = {
  perspective: BankLedgerDrCrPerspective;
  onPerspectiveChange: (next: BankLedgerDrCrPerspective) => void;
  className?: string;
  compact?: boolean;
};

const alwaysGreenSwitchClass = cn(
  // Light green track + green border (bg se thoda darker) — header tone se thoda zyada green
  "!border-2 !border-green-400 !bg-green-100",
  "data-[state=checked]:!border-green-400 data-[state=checked]:!bg-green-100",
  "data-[state=unchecked]:!border-green-400 data-[state=unchecked]:!bg-green-100",
  "dark:!border-green-500 dark:!bg-green-900/45",
  "dark:data-[state=checked]:!border-green-500 dark:data-[state=checked]:!bg-green-900/45",
  "dark:data-[state=unchecked]:!border-green-500 dark:data-[state=unchecked]:!bg-green-900/45",
  // Knob always vivid green
  "[&>span:last-child]:!bg-green-400",
  "dark:[&>span:last-child]:!bg-green-400"
);

export function BankLedgerDrCrPerspectiveSwitch({
  perspective,
  onPerspectiveChange,
  className,
  compact = false,
}: Props) {
  const isBank = perspective === "bank";
  /** Knob Bank (right) pe ho to i left; Company (left) pe knob ho to i right */
  const infoOnRight = !isBank;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        compact ? "text-[11px]" : "text-xs",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Label
        htmlFor="bank-ledger-drcr-perspective"
        className={cn(
          "cursor-pointer select-none whitespace-nowrap font-medium",
          !isBank ? "text-green-700 dark:text-green-300" : "text-muted-foreground",
          compact && "text-[10px] sm:text-[11px]"
        )}
        onClick={() => onPerspectiveChange("company")}
      >
        Company
      </Label>

      <div className="relative shrink-0">
        <Switch
          id="bank-ledger-drcr-perspective"
          data-pl-bank-drcr-perspective-switch=""
          checked={isBank}
          onCheckedChange={(on) => onPerspectiveChange(on ? "bank" : "company")}
          aria-label="Toggle Company or Bank Dr/Cr perspective"
          title={isBank ? "Bank perspective" : "Company perspective"}
          className={alwaysGreenSwitchClass}
        />

        <Popover>
          <PopoverTrigger asChild>
            <AppFreshInfoButton
              size="embedded"
              data-pl-bank-drcr-perspective-info=""
              className={cn(
                "absolute top-1/2 z-[2] -translate-y-1/2 shadow-none",
                infoOnRight ? "right-[2px]" : "left-[3px]"
              )}
              aria-label="About Company vs Bank Dr/Cr"
              title="Company vs Bank Dr/Cr help"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </PopoverTrigger>
          <PopoverContent align="end" className="z-[80] w-[min(92vw,22rem)] space-y-2 p-3 text-left" data-pl-intro="">
            <p className="text-sm font-semibold">{BANK_LEDGER_DRCR_PERSPECTIVE_INFO.title}</p>
            <div className="space-y-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {BANK_LEDGER_DRCR_PERSPECTIVE_INFO.body}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Label
        htmlFor="bank-ledger-drcr-perspective"
        className={cn(
          "cursor-pointer select-none whitespace-nowrap font-medium",
          isBank ? "text-green-700 dark:text-green-300" : "text-muted-foreground",
          compact && "text-[10px] sm:text-[11px]"
        )}
        onClick={() => onPerspectiveChange("bank")}
      >
        Bank
      </Label>
    </div>
  );
}
