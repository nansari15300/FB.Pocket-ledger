"use client";

import * as React from "react";
import { format } from "date-fns";
import { AlarmClock, AlarmPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  isReminderDeleted,
  isReminderVisibleToUser,
  reminderTimeMs,
  subscribeCompanyReminders,
  type ReminderAlarm,
} from "@/components/messages/AlarmsTab";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import { reminderContextLabel } from "@/hooks/useReminderEntityOptions";
import { useCompanyReminderUsers } from "@/hooks/useCompanyReminderUsers";
import { REMINDER_PREVIEW_OPEN_EVENT } from "@/lib/reminderPreviewEvents";

/**
 * Header "Test" button -> ye preview popup (window event se khulta hai, dashboard layout me mount).
 * Latest visible (non-deleted) reminder dikhata hai; na ho to empty state + "Set New Reminder"
 * jo LedgerReminderDialog bina account ke kholta hai.
 */
export function ReminderPreviewDialog() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { dateSystem, formatDateBS } = useDate();
  const { formatUsers } = useCompanyReminderUsers();
  const [open, setOpen] = React.useState(false);
  const [reminders, setReminders] = React.useState<ReminderAlarm[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [editor, setEditor] = React.useState<{
    open: boolean;
    context: LedgerReminderContext | null;
    entityId: string | null;
    title: string | null;
  }>({ open: false, context: null, entityId: null, title: null });

  React.useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(REMINDER_PREVIEW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REMINDER_PREVIEW_OPEN_EVENT, onOpen);
  }, []);

  React.useEffect(() => {
    if (!open || !companyId) {
      setLoaded(false);
      return;
    }
    const unsub = subscribeCompanyReminders(companyId, (list) => {
      setReminders(list);
      setLoaded(true);
    });
    return () => unsub();
  }, [open, companyId]);

  const latest = React.useMemo(() => {
    const ownerId = ((company as any)?.ownerId as string | undefined) ?? null;
    const me = { uid: user?.uid ?? null, email: user?.email ?? null };
    const visible = reminders.filter((a) => !isReminderDeleted(a) && isReminderVisibleToUser(a, me, ownerId));
    const sortKey = (a: ReminderAlarm) => {
      const c = reminderTimeMs((a as any).createdAt);
      return Number.isFinite(c) ? c : reminderTimeMs(a.datetime);
    };
    visible.sort((a, b) => (sortKey(b) || 0) - (sortKey(a) || 0));
    return visible[0] ?? null;
  }, [reminders, company, user?.uid, user?.email]);

  const displayDateTime = (value: any): string => {
    const ms = reminderTimeMs(value);
    if (!Number.isFinite(ms)) return "-";
    const d = new Date(ms);
    return dateSystem === "AD" ? format(d, "PPP p") : `${formatDateBS(d)} ${format(d, "p")}`;
  };

  const openEditor = (a: ReminderAlarm | null) => {
    setOpen(false);
    setEditor({
      open: true,
      context: ((a?.context as LedgerReminderContext) || null),
      entityId: a?.entityId || null,
      title: null,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-primary" />
              Reminder
            </DialogTitle>
            <DialogDescription>Latest reminder</DialogDescription>
          </DialogHeader>
          {!loaded ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>
          ) : latest ? (
            <div className="space-y-1 rounded-lg border p-3">
              <p className="break-words font-semibold">{latest.title}</p>
              <p className="text-sm text-muted-foreground">{displayDateTime(latest.datetime)}</p>
              {latest.message ? (
                <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{latest.message}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">For: {formatUsers(latest.users)}</p>
              {latest.context ? (
                <p className="text-xs text-muted-foreground">Link to: {reminderContextLabel(latest.context)}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {latest.notified ? "Notified" : "Upcoming"}
              </p>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No reminders set.</p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {latest ? (
              <Button onClick={() => openEditor(latest)}>
                <AlarmPlus className="mr-2 h-4 w-4" /> Open Reminders
              </Button>
            ) : (
              <Button onClick={() => openEditor(null)} disabled={!loaded}>
                <AlarmPlus className="mr-2 h-4 w-4" /> Set New Reminder
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editor.open ? (
        <LedgerReminderDialog
          open={editor.open}
          onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
          context={editor.context}
          entityId={editor.entityId}
          title={editor.title}
        />
      ) : null}
    </>
  );
}