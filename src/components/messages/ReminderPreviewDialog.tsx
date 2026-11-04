"use client";

import * as React from "react";
import { AlarmClock, AlarmPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
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
  getReminderAlarm,
  isReminderDeleted,
  isReminderVisibleToUser,
  reminderTimeMs,
  subscribeCompanyReminders,
  type ReminderAlarm,
} from "@/components/messages/AlarmsTab";
import { ReminderCard } from "@/components/messages/ReminderCard";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import {
  ALARM_POPUP_STATE_EVENT,
  REMINDER_EDIT_OPEN_EVENT,
  REMINDER_PREVIEW_OPEN_EVENT,
  isAlarmPopupActive,
  type ReminderEditOpenDetail,
} from "@/lib/reminderPreviewEvents";

type EditorState = {
  open: boolean;
  context: LedgerReminderContext | null;
  entityId: string | null;
  editAlarm: ReminderAlarm | null;
  /** Har open par naya key: LedgerReminderDialog panel fresh mount ho. */
  key: number;
};

/**
 * Header "Test" button -> ye preview popup (window event se khulta hai, dashboard layout me mount).
 * Saath hi global LedgerReminderDialog host: AlarmPopup "Extend date & time" yahin EDIT mode kholta hai.
 * Ek waqt me ek popup: AlarmPopup khula ho to preview band rehta hai.
 */
export function ReminderPreviewDialog() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  const [reminders, setReminders] = React.useState<ReminderAlarm[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState>({
    open: false,
    context: null,
    entityId: null,
    editAlarm: null,
    key: 0,
  });
  const companyIdRef = React.useRef<string | null>(null);
  companyIdRef.current = companyId ?? null;

  React.useEffect(() => {
    const onOpen = () => {
      // Alarm popup dikh raha hai to preview nahi kholte (alarm hi samne rahe).
      if (isAlarmPopupActive()) return;
      setOpen(true);
    };
    const onAlarmState = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail === true) setOpen(false);
    };
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<ReminderEditOpenDetail>).detail;
      const cid = detail?.companyId || companyIdRef.current;
      if (!detail?.alarmId || !cid) return;
      void getReminderAlarm(cid, detail.alarmId)
        .then((alarm) => {
          if (!alarm || isReminderDeleted(alarm)) {
            toast.error("Reminder not found.");
            return;
          }
          setOpen(false);
          setEditor((s) => ({
            open: true,
            context: (alarm.context as LedgerReminderContext) || null,
            entityId: alarm.entityId || null,
            editAlarm: alarm,
            key: s.key + 1,
          }));
        })
        .catch(() => toast.error("Failed to load reminder."));
    };
    window.addEventListener(REMINDER_PREVIEW_OPEN_EVENT, onOpen);
    window.addEventListener(ALARM_POPUP_STATE_EVENT, onAlarmState);
    window.addEventListener(REMINDER_EDIT_OPEN_EVENT, onEdit);
    return () => {
      window.removeEventListener(REMINDER_PREVIEW_OPEN_EVENT, onOpen);
      window.removeEventListener(ALARM_POPUP_STATE_EVENT, onAlarmState);
      window.removeEventListener(REMINDER_EDIT_OPEN_EVENT, onEdit);
    };
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

  const openEditor = (a: ReminderAlarm | null) => {
    setOpen(false);
    setEditor((s) => ({
      open: true,
      context: ((a?.context as LedgerReminderContext) || null),
      entityId: a?.entityId || null,
      editAlarm: null,
      key: s.key + 1,
    }));
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
            <ReminderCard alarm={latest} statusText={latest.notified ? "Notified" : "Upcoming"} />
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
          key={editor.key}
          open={editor.open}
          onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
          context={editor.context}
          entityId={editor.entityId}
          title={null}
          editAlarm={editor.editAlarm}
        />
      ) : null}
    </>
  );
}