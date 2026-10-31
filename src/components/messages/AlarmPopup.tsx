"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { collection, query, where, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlarmPlus, Check, Clock } from "lucide-react";
import { toast } from "sonner";

type AlarmNotification = {
  id: string;
  recipientUserId: string;
  type: string;
  alarmId?: string;
  companyId?: string;
  message?: string;
  alarmTitle?: string;
  isRead?: boolean;
};

const SNOOZE_MINUTES = 10;
const NOTIFY_BEFORE_MINUTES = 5;

export function AlarmPopup() {
  const { user } = useAuth();
  const [alarmNotification, setAlarmNotification] = React.useState<AlarmNotification | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

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

  const handleDone = async () => {
    if (!alarmNotification?.alarmId || !alarmNotification?.companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      const alarmRef = doc(firestore, `companies/${alarmNotification.companyId}/alarms`, alarmNotification.alarmId);
      await updateDoc(alarmRef, { notified: true });
      const notifRef = doc(firestore, "admin_notifications", alarmNotification.id);
      await updateDoc(notifRef, { isRead: true });
      setAlarmNotification(null);
      toast.success("Alarm marked as done.");
    } catch (e) {
      toast.error("Failed to mark alarm as done.");
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
      const newNotifyAt = new Date(newDatetime.getTime() - NOTIFY_BEFORE_MINUTES * 60 * 1000);
      await updateDoc(alarmRef, {
        datetime: newDatetime,
        notifyAt: Timestamp.fromDate(newNotifyAt),
        notified: false,
      });
      const notifRef = doc(firestore, "admin_notifications", alarmNotification.id);
      await updateDoc(notifRef, { isRead: true });
      setAlarmNotification(null);
      toast.success(`Alarm snoozed by ${SNOOZE_MINUTES} minutes.`);
    } catch (e) {
      toast.error("Failed to snooze alarm.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!alarmNotification) return null;

  return (
    <Dialog open={!!alarmNotification} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmPlus className="h-5 w-5 text-primary" />
            {alarmNotification.alarmTitle || "Alarm"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
          {alarmNotification.message || "Reminder."}
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={handleSnooze} disabled={isProcessing}>
            <Clock className="h-4 w-4 mr-1" /> Snooze (+{SNOOZE_MINUTES} min)
          </Button>
          <Button size="sm" onClick={handleDone} disabled={isProcessing}>
            <Check className="h-4 w-4 mr-1" /> Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
