"use client";

import * as React from "react";
import { format } from "date-fns";
import { useDate } from "@/hooks/useDate";
import { cn } from "@/lib/utils";
import { reminderTimeMs, type ReminderAlarm } from "@/components/messages/AlarmsTab";
import { reminderContextLabel, reminderEntityKey, useReminderEntityOptions } from "@/hooks/useReminderEntityOptions";
import { useCompanyReminderUsers } from "@/hooks/useCompanyReminderUsers";

export type ReminderCardData = Pick<ReminderAlarm, "title" | "datetime" | "message" | "users" | "context" | "entityId"> &
  Partial<Pick<ReminderAlarm, "notified" | "remindBeforeMinutes">>;

/**
 * Shared reminder card (ReminderPreviewDialog + AlarmPopup): title/account, date-time, message, For, Link to.
 * Sirf presentational; data AlarmsTab helpers se aata hai.
 */
export function ReminderCard({
  alarm,
  statusText,
  className,
}: {
  alarm: ReminderCardData;
  statusText?: string | null;
  className?: string;
}) {
  const { dateSystem, formatDateBS } = useDate();
  const { formatUsers } = useCompanyReminderUsers();
  const { byKey } = useReminderEntityOptions();

  const opt = alarm.context ? byKey.get(reminderEntityKey(alarm.context, alarm.entityId)) : undefined;
  const accountName = opt?.name ?? "";
  const ms = reminderTimeMs(alarm.datetime);
  const when = Number.isFinite(ms)
    ? dateSystem === "AD"
      ? format(new Date(ms), "PPP p")
      : `${formatDateBS(new Date(ms))} ${format(new Date(ms), "p")}`
    : "-";
  const link = alarm.context
    ? `${reminderContextLabel(alarm.context)}${accountName ? ` · ${accountName}` : ""}`
    : "";
  const before = Number(alarm.remindBeforeMinutes) > 0 ? Number(alarm.remindBeforeMinutes) : 0;

  return (
    <div className={cn("space-y-1 rounded-lg border p-3", className)}>
      <p className="break-words font-semibold">{alarm.title || accountName || "Reminder"}</p>
      <p className="text-sm text-muted-foreground">
        {when}
        {before ? ` (remind ${before >= 60 ? `${before / 60} hour` : `${before} min`} before)` : ""}
      </p>
      {alarm.message ? (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{alarm.message}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">For: {formatUsers(alarm.users)}</p>
      {link ? <p className="text-xs text-muted-foreground">Link to: {link}</p> : null}
      {statusText ? <p className="text-xs text-muted-foreground">{statusText}</p> : null}
    </div>
  );
}