"use client";

import type { ComponentProps } from "react";
import { AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
} from "@/lib/ledgerHeaderChrome";

/** Messages → Reminder tab "Link to" values (AlarmsTab `contextOptions`). */
export type LedgerReminderContext =
  | "Party"
  | "Staff"
  | "Bank/Cash"
  | "Tax"
  | "Items"
  | "Income/Expense";

/**
 * Phase 1: Reminder button sirf Messages → Reminder tab par prefilled form kholta hai.
 * Internal tab value `alarms` hi rehta hai.
 */
export function buildLedgerReminderHref({
  context,
  entityId,
  title,
}: {
  context?: LedgerReminderContext | null;
  entityId?: string | null;
  title?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("tab", "alarms");
  if (context) params.set("reminderContext", context);
  if (context && entityId) params.set("reminderEntityId", entityId);
  const cleanTitle = String(title ?? "").trim();
  if (cleanTitle) params.set("reminderTitle", cleanTitle);
  return `/messages?${params.toString()}`;
}

type LedgerHeaderReminderButtonProps = {
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  onClick?: ComponentProps<typeof Button>["onClick"];
  disabled?: boolean;
};

/** Ledger txn ribbon — reminder immediately right of Print. */
export function LedgerHeaderReminderButton({
  className,
  variant = "outline",
  onClick,
  disabled,
}: LedgerHeaderReminderButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      className={cn(LEDGER_HEADER_PILL_ICON_CN, className)}
      data-theme-detail="reminder"
      aria-label="Reminder"
      title="Reminder"
      onClick={onClick}
      disabled={disabled}
    >
      <AlarmClock className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
    </Button>
  );
}
