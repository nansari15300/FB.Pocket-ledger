"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { collection, query, where, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlarmClock, BellOff, CalendarClock, Check, Clock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ReminderCard, type ReminderCardData } from "@/components/messages/ReminderCard";
import { markAlarmNotificationsReadForAll, normalizeRemindBefore } from "@/components/messages/AlarmsTab";
import { openReminderEditor, setAlarmPopupActive } from "@/lib/reminderPreviewEvents";

type AlarmNotification = {
  id: string;
  recipientUserId: string;
  type: string;
  alarmId?: string;
  companyId?: string;
  message?: string;
  alarmTitle?: string;
  isRead?: boolean;
  context?: string | null;
  entityId?: string | null;
  alarmForUsers?: string[];
  alarmDatetime?: any;
};

const SNOOZE_MINUTES = 10;
/** Teeno buttons ki ek hi height / size (ek row me fit). */
const ALARM_BTN = "h-8 min-w-0 flex-1 gap-1 px-2 text-xs";

export function AlarmPopup() {
  const { user } = useAuth();
  const [alarmNotification, setAlarmNotification] = React.useState<AlarmNotification | null>(null);
  const [alarmRecord, setAlarmRecord] = React.useState<ReminderCardData | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [confirmOffAll, setConfirmOffAll] = React.useState(false);

  React.useEffect(() => {
    if (!user?.uid) {
      setAlarmNotification(null);
      return;
    }
    const q = query(
      collection(firestore, "admin_notifications"),
      where("recipientUserId", "==", user.uid),
      where("type", "==", "alarm"),
      where("isRead", "==", false)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const first = snapshot.docs[0];
      if (first) {
        setAlarmNotification({ id: first.id, ...first.data() } as AlarmNotification);
      } else {
        setAlarmNotification(null);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // Ek waqt me ek popup: alarm dikhe to ReminderPreviewDialog band / blocked.
  const isOpen = !!alarmNotification;
  React.useEffect(() => {
    setAlarmPopupActive(isOpen);
  }, [isOpen]);
  React.useEffect(() => () => setAlarmPopupActive(false), []);

  // Card ke liye poora alarm record (For / Link to / remind before).
  const alarmKey = alarmNotification ? `${alarmNotification.companyId}|${alarmNotification.alarmId}` : "";
  React.useEffect(() => {
    setAlarmRecord(null);
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId) return;
    let cancelled = false;
    getDoc(doc(firestore, `companies/${alarmNotification.companyId}/alarms`, alarmNotification.alarmId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        setAlarmRecord(snap.data() as ReminderCardData);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmKey]);

  const handleDone = async () => {
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      const alarmRef = doc(firestore, `companies/${alarmNotification.companyId}/alarms`, alarmNotification.alarmId);
      await updateDoc(alarmRef, { notified: true });
      const notifRef = doc(firestore, "admin_notifications", alarmNotification.id);
      await updateDoc(notifRef, { isRead: true });
      setAlarmNotification(null);
      toast.success("Reminder marked as done.");
    } catch (e) {
      toast.error("Failed to mark reminder as done.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSnooze = async () => {
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      const alarmRef = doc(firestore, `companies/${alarmNotification.companyId}/alarms`, alarmNotification.alarmId);
      const alarmSnap = await getDoc(alarmRef);
      if (!alarmSnap.exists()) {
        await updateDoc(doc(firestore, "admin_notifications", alarmNotification.id), { isRead: true });
        setAlarmNotification(null);
        setIsProcessing(false);
        return;
      }
      const data = alarmSnap.data();
      const currentDatetime = data?.datetime?.toDate ? data.datetime.toDate() : new Date(data?.datetime);
      const newDatetime = new Date(currentDatetime.getTime() + SNOOZE_MINUTES * 60 * 1000);
      newDatetime.setSeconds(0, 0);
      // Record ka apna "Remind before" (purane records me nahi -> 0 = At time).
      const remindBeforeMinutes = normalizeRemindBefore(data?.remindBeforeMinutes);
      const newNotifyAt = new Date(newDatetime.getTime() - remindBeforeMinutes * 60 * 1000);
      await updateDoc(alarmRef, {
        datetime: newDatetime,
        notifyAt: Timestamp.fromDate(newNotifyAt),
        notified: false,
      });
      const notifRef = doc(firestore, "admin_notifications", alarmNotification.id);
      await updateDoc(notifRef, { isRead: true });
      setAlarmNotification(null);
      toast.success(`Reminder snoozed by ${SNOOZE_MINUTES} minutes.`);
    } catch (e) {
      toast.error("Failed to snooze reminder.");
    } finally {
      setIsProcessing(false);
    }
  };

  /** Extend date & time: notification read (dobara popup na ho), phir LedgerReminderDialog EDIT mode me. */
  const handleExtend = async () => {
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId || isProcessing) return;
    setIsProcessing(true);
    const target = { alarmId: alarmNotification.alarmId, companyId: alarmNotification.companyId };
    try {
      await updateDoc(doc(firestore, "admin_notifications", alarmNotification.id), { isRead: true });
      setAlarmNotification(null);
      setAlarmPopupActive(false);
      openReminderEditor(target);
    } catch (e) {
      toast.error("Failed to open reminder.");
    } finally {
      setIsProcessing(false);
    }
  };

  /** Off all: is alarm ke sab users ke notifications read (sabka popup band). Done sirf current user ke liye hi hai. */
  const handleOffAll = async () => {
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      await markAlarmNotificationsReadForAll(alarmNotification.companyId, alarmNotification.alarmId);
      // Apna record bhi pakka read (agar query me na aaya ho).
      await updateDoc(doc(firestore, "admin_notifications", alarmNotification.id), { isRead: true });
      setAlarmNotification(null);
      toast.success("Reminder turned off for all users.");
    } catch (e) {
      toast.error("Failed to turn off reminder for all users.");
    } finally {
      setIsProcessing(false);
      setConfirmOffAll(false);
    }
  };

  if (!alarmNotification) return null;

  const cardData: ReminderCardData = alarmRecord ?? {
    title: alarmNotification.alarmTitle || "",
    datetime: alarmNotification.alarmDatetime ?? null,
    message: alarmNotification.message && alarmNotification.message !== alarmNotification.alarmTitle ? alarmNotification.message : undefined,
    users: Array.isArray(alarmNotification.alarmForUsers) ? alarmNotification.alarmForUsers : [],
    context: alarmNotification.context || undefined,
    entityId: alarmNotification.entityId || undefined,
  };

  return (
    <Dialog open={!!alarmNotification} onOpenChange={() => {}}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5 text-primary" />
            Reminder
          </DialogTitle>
          <DialogDescription>This reminder is due now</DialogDescription>
        </DialogHeader>
        <ReminderCard alarm={cardData} />
        {/* 3 buttons hamesha ek row me (mobile ~320px bhi): chhote label, icons sirf sm+ par. */}
        <div className="flex w-full flex-nowrap gap-1.5">
          <Button variant="outline" size="sm" className={ALARM_BTN} onClick={handleSnooze} disabled={isProcessing} title={`Snooze (+${SNOOZE_MINUTES} min)`}>
            <Clock className="hidden h-3.5 w-3.5 shrink-0 sm:inline" />
            <span className="truncate">Snooze {SNOOZE_MINUTES}m</span>
          </Button>
          <Button variant="outline" size="sm" className={ALARM_BTN} onClick={handleExtend} disabled={isProcessing} title="Extend date & time">
            <CalendarClock className="hidden h-3.5 w-3.5 shrink-0 sm:inline" />
            <span className="truncate">Extend</span>
          </Button>
          <Button variant="outline" size="sm" className={ALARM_BTN} onClick={() => setConfirmOffAll(true)} disabled={isProcessing} title="Off for all users">
            <BellOff className="hidden h-3.5 w-3.5 shrink-0 sm:inline" />
            <span className="truncate">Off all</span>
          </Button>
          <Button size="sm" className={ALARM_BTN} onClick={handleDone} disabled={isProcessing} title="Done">
            <Check className="hidden h-3.5 w-3.5 shrink-0 sm:inline" />
            <span className="truncate">Done</span>
          </Button>
        </div>
        <AlertDialog open={confirmOffAll} onOpenChange={(o) => { if (!isProcessing) setConfirmOffAll(o); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off this reminder for all users?</AlertDialogTitle>
              <AlertDialogDescription>
                The reminder popup will close for every user who received it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleOffAll(); }}
                disabled={isProcessing}
              >
                Off for all
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}