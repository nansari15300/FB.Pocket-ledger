"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { collection, query, where, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlarmPlus, Check, Clock } from "lucide-react";
import { toast } from "sonner";

type AlarmDoc = {
  id: string;
  title: string;
  datetime: any;
  notifyAt?: any;
  message?: string;
  users: string[];
  notified?: boolean;
  context?: string;
  entityId?: string;
};

const SNOOZE_MINUTES = 10;
const NOTIFY_BEFORE_MINUTES = 5;

export function EntityAlarmPopup({ context, entityId }: { context: string; entityId: string }) {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const [alarm, setAlarm] = React.useState<AlarmDoc | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  React.useEffect(() => {
    if (!companyId || !context || !entityId || !user) {
      setAlarm(null);
      return;
    }
    const q = query(
      collection(firestore, `companies/${companyId}/alarms`),
      where("context", "==", context),
      where("entityId", "==", entityId),
      where("notified", "==", false)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AlarmDoc));
      const forUser = docs.filter((a) => {
        if (company?.ownerId === user.uid) return true;
        if (a.users?.length && user.email && a.users.includes(user.email)) return true;
        return false;
      });
      setAlarm(forUser[0] ?? null);
    });
    return () => unsub();
  }, [companyId, context, entityId, user?.uid, user?.email, company?.ownerId]);

  const handleDone = async () => {
    if (!alarm?.id || !companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      const alarmRef = doc(firestore, `companies/${companyId}/alarms`, alarm.id);
      await updateDoc(alarmRef, { notified: true });
      setAlarm(null);
      toast.success("Alarm marked as done.");
    } catch (e) {
      toast.error("Failed to mark alarm as done.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSnooze = async () => {
    if (!alarm?.id || !companyId || isProcessing) return;
    setIsProcessing(true);
    try {
      const alarmRef = doc(firestore, `companies/${companyId}/alarms`, alarm.id);
      const alarmSnap = await getDoc(alarmRef);
      if (!alarmSnap.exists()) {
        setAlarm(null);
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
      setAlarm(null);
      toast.success(`Alarm snoozed by ${SNOOZE_MINUTES} minutes.`);
    } catch (e) {
      toast.error("Failed to snooze alarm.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!alarm) return null;

  return (
    <Dialog open={!!alarm} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmPlus className="h-5 w-5 text-primary" />
            {alarm.title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
          {alarm.message || "Reminder for this " + context.toLowerCase() + "."}
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
