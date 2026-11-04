"use client";

import { updateDoc, writeBatch, addDoc } from "@/lib/writeGateway/pbWrites";

import * as React from "react";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { useAuth } from "@/hooks/useAuth";
import { collection, query, orderBy, where, doc, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isPast, isToday, isSameDay, isYesterday, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, AlarmPlus, Edit, Calendar as CalendarIcon, XCircle, RotateCcw } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useReminderEntityOptions, REMINDER_CONTEXT_OPTIONS } from "@/hooks/useReminderEntityOptions";
import { useCompanyReminderUsers } from "@/hooks/useCompanyReminderUsers";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BsDatePicker from "@/components/ui/BsDatePicker";


type Alarm = {
  id: string;
  title: string;
  datetime: any;
  notifyAt?: any;
  message?: string;
  users: string[];
  notified?: boolean;
  context?: string;
  entityId?: string;
  /** Soft delete (Reminder v2): normal lists me hidden, popup ke "Deleted" tab me dikhte hain. */
  deleted?: boolean;
  deletedAt?: any;
  deletedBy?: string | null;
  createdAt?: any;
  createdBy?: string | null;
  /** Kitne minute pehle notify karna (0 = At time). Purane records me nahi hota -> 0. */
  remindBeforeMinutes?: number;
};

export type ReminderAlarm = Alarm;

export const REMIND_BEFORE_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "At time" },
  { value: "5", label: "5 min before" },
  { value: "10", label: "10 min before" },
  { value: "15", label: "15 min before" },
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 hour before" },
];

export function normalizeRemindBefore(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Shared reminder save path: AlarmsTab aur LedgerReminderDialog (Details pages) dono yahi use karte hain,
 * taaki popup se bana reminder bhi Reminder tab me dikhe aur same tarah fire ho.
 */
export function buildReminderAlarmData(input: {
  title: string;
  date: Date;
  hour: string;
  minute: string;
  period: string;
  message?: string;
  users?: string[];
  context?: string;
  entityId?: string;
  remindBeforeMinutes?: number;
}): Omit<Alarm, "id"> {
  let hours = parseInt(input.hour, 10);
  if (input.period === "PM" && hours < 12) hours += 12;
  if (input.period === "AM" && hours === 12) hours = 0;

  const finalDateTime = new Date(input.date);
  finalDateTime.setHours(hours, parseInt(input.minute, 10), 0, 0);
  const remindBeforeMinutes = normalizeRemindBefore(input.remindBeforeMinutes);
  const notifyAt = new Date(finalDateTime.getTime() - remindBeforeMinutes * 60 * 1000);

  return {
    title: input.title,
    datetime: finalDateTime,
    notifyAt: Timestamp.fromDate(notifyAt),
    remindBeforeMinutes,
    message: input.message?.trim() || undefined,
    users: input.users ?? [],
    context: input.context || undefined,
    entityId: input.entityId || undefined,
    notified: false,
  };
}

export async function createReminderAlarm(
  companyId: string,
  alarmData: Omit<Alarm, "id">,
  createdBy: string | null,
): Promise<void> {
  await addDoc(collection(firestore, `companies/${companyId}/alarms`), {
    ...alarmData,
    createdAt: serverTimestamp(),
    createdBy,
  });
}

/*
 * Reminder v2 data helpers. Saare alarms read/write/subscribe/notification yahin rehte hain (existing imports),
 * naye files (LedgerReminderDialog, ReminderScheduler, ReminderPreviewDialog) sirf ye helpers import karte hain.
 * Baad me Firebase Master ka `src/lib/pocketbaseData/reminders.ts` aaye to ye helpers wahan shift honge.
 */
const alarmsPath = (companyId: string) => `companies/${companyId}/alarms`;

/**
 * AlarmPopup "Off all": is alarm ke SAB users ke unread admin_notifications read kar do
 * (har user ka global AlarmPopup listener `isRead==false` par hai, isliye sabka popup band ho jata hai).
 * Alarm bhi `notified:true` (dobara fire na ho). Returns kitne notifications band hue.
 */
export async function markAlarmNotificationsReadForAll(companyId: string, alarmId: string): Promise<number> {
  const snap = await getDocs(query(collection(firestore, "admin_notifications"), where("alarmId", "==", alarmId)));
  const targets = snap.docs.filter((d) => {
    const n = d.data() as any;
    return n?.type === "alarm" && n?.isRead !== true && (!n?.companyId || n.companyId === companyId);
  });
  const batch = writeBatch(firestore);
  for (const d of targets) batch.update(doc(firestore, "admin_notifications", d.id), { isRead: true });
  batch.update(doc(firestore, alarmsPath(companyId), alarmId), { notified: true });
  await batch.commit();
  return targets.length;
}

/** Ek reminder record (AlarmPopup card / Extend edit ke liye). */
export async function getReminderAlarm(companyId: string, alarmId: string): Promise<Alarm | null> {
  const snap = await getDoc(doc(firestore, alarmsPath(companyId), alarmId));
  if (!snap.exists()) return null;
  return { id: alarmId, ...(snap.data() as any) } as Alarm;
}

export function reminderTimeMs(value: any): number {
  if (value == null) return NaN;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/** Due jab `(notifyAt ?? datetime) <= now`. */
export function reminderDueMs(a: Pick<Alarm, "notifyAt" | "datetime">): number {
  const notifyMs = reminderTimeMs(a?.notifyAt);
  return Number.isFinite(notifyMs) ? notifyMs : reminderTimeMs(a?.datetime);
}

export function isReminderDeleted(a: Pick<Alarm, "deleted"> | null | undefined): boolean {
  return a?.deleted === true;
}

/** Owner sab dekhta hai; baaki ko apne banaye hue ya jinke `users` me unka email ho. */
export function isReminderVisibleToUser(
  a: Alarm,
  viewer: { uid?: string | null; email?: string | null },
  ownerId?: string | null,
): boolean {
  if (ownerId && viewer.uid && viewer.uid === ownerId) return true;
  if (a.createdBy && viewer.uid && a.createdBy === viewer.uid) return true;
  const email = String(viewer.email ?? "").trim().toLowerCase();
  if (email && Array.isArray(a.users) && a.users.some((u) => String(u ?? "").trim().toLowerCase() === email)) return true;
  return false;
}

/** Company ke saare alarms (deleted bhi), datetime desc. */
export function subscribeCompanyReminders(companyId: string, onChange: (list: Alarm[]) => void): () => void {
  const q = query(collection(firestore, alarmsPath(companyId)), orderBy("datetime", "desc"));
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Alarm)));
  });
}

/** Edit: `buildReminderAlarmData` se naya notifyAt; notified hamesha false. */
export async function updateReminderAlarm(companyId: string, alarmId: string, alarmData: Omit<Alarm, "id">): Promise<void> {
  await updateDoc(doc(firestore, alarmsPath(companyId), alarmId), { ...alarmData, notified: false });
}

/** Soft delete: record rehta hai (Deleted history), notified:true taaki fire na ho. */
export async function softDeleteReminderAlarms(companyId: string, alarmIds: string[], deletedBy: string | null): Promise<void> {
  if (!alarmIds.length) return;
  const batch = writeBatch(firestore);
  const deletedAt = Timestamp.fromDate(new Date());
  for (const id of alarmIds) {
    batch.update(doc(firestore, alarmsPath(companyId), id), {
      deleted: true,
      deletedAt,
      deletedBy: deletedBy ?? null,
      notified: true,
    });
  }
  await batch.commit();
}

/** Restore: time abhi aage hai to dobara fire hoga, warna History me jaata hai. */
export async function restoreReminderAlarm(companyId: string, alarm: Alarm): Promise<void> {
  const dueMs = reminderDueMs(alarm);
  const stillAhead = Number.isFinite(dueMs) && dueMs > Date.now();
  await updateDoc(doc(firestore, alarmsPath(companyId), alarm.id), {
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    notified: !stillAhead,
  });
}

/** Scheduler: abhi tak fire na hue (notified==false), non-deleted alarms. */
export function subscribePendingReminders(companyId: string, onChange: (list: Alarm[]) => void): () => void {
  const q = query(collection(firestore, alarmsPath(companyId)), where("notified", "==", false));
  return onSnapshot(q, (snapshot) => {
    onChange(
      snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Alarm))
        .filter((a) => !isReminderDeleted(a)),
    );
  });
}

/**
 * Ek due reminder fire karo (claim-first): pehle fresh read, phir `notified:true` (claim), phir
 * admin_notifications (AlarmPopup isi ko sunta hai, har screen par). Pehle ye Messages page ka loop tha.
 * Returns true agar is call ne fire kiya.
 */
export async function fireDueReminder(
  companyId: string,
  alarm: Alarm,
  opts: { ownerId?: string | null; createdByName?: (uid: string | null | undefined) => string | null },
): Promise<boolean> {
  const alarmRef = doc(firestore, alarmsPath(companyId), alarm.id);
  const fresh = await getDoc(alarmRef);
  if (!fresh.exists()) return false;
  const data = { id: alarm.id, ...(fresh.data() as any) } as Alarm;
  if (data.notified === true || isReminderDeleted(data)) return false;
  const dueMs = reminderDueMs(data);
  if (!Number.isFinite(dueMs) || dueMs > Date.now()) return false;

  // Claim first: dusre tab / user ka scheduler isse dobara fire na kare.
  await updateDoc(alarmRef, { notified: true });

  let targetUserIds: string[] = [];
  if (Array.isArray(data.users) && data.users.length > 0) {
    const qUsers = query(collection(firestore, "users"), where("email", "in", data.users.slice(0, 10)));
    const userSnaps = await getDocs(qUsers);
    targetUserIds = userSnaps.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .map((u: any) => u.uid || u.id)
      .filter(Boolean);
  }
  if (targetUserIds.length === 0 && opts.ownerId) targetUserIds.push(opts.ownerId);

  for (const userId of Array.from(new Set(targetUserIds))) {
    await addDoc(collection(firestore, "admin_notifications"), {
      recipientUserId: userId,
      type: "alarm",
      alarmId: data.id,
      message: data.message || data.title || `REMINDER: ${data.title}`,
      alarmTitle: data.title,
      timestamp: serverTimestamp(),
      isRead: false,
      companyId,
      context: data.context || null,
      entityId: data.entityId || null,
      alarmForUsers: Array.isArray(data.users) ? data.users : [],
      alarmCreatedBy: data.createdBy ?? null,
      alarmCreatedByName: opts.createdByName?.(data.createdBy) ?? null,
      alarmCreatedAt: data.createdAt ?? null,
      alarmDatetime: data.datetime ?? null,
      alarmNotifyAt: data.notifyAt ?? null,
    });
  }
  return true;
}

export function AlarmsTab() {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const { options: reminderEntityOptions } = useReminderEntityOptions();
  const { userOptions, defaultUsers, formatUsers } = useCompanyReminderUsers();
  const { dateSystem, formatDate, formatDateBS } = useDate();

  const [alarms, setAlarms] = React.useState<Alarm[]>([]);
  const [deletedAlarms, setDeletedAlarms] = React.useState<Alarm[]>([]);
  
  const [alarmToEdit, setAlarmToEdit] = React.useState<Alarm | null>(null);
  const [newAlarmTitle, setNewAlarmTitle] = React.useState("");
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(new Date());
  const [selectedHour, setSelectedHour] = React.useState("10");
  const [selectedMinute, setSelectedMinute] = React.useState("00");
  const [selectedPeriod, setSelectedPeriod] = React.useState("AM");
  const [remindBefore, setRemindBefore] = React.useState("0");
  // Remind before: custom N min (1-1440) sirf is reminder ke liye; REMIND_BEFORE_OPTIONS permanent nahi badalta.
  const remindBeforeOptions = React.useMemo(() => {
    if (REMIND_BEFORE_OPTIONS.some((o) => o.value === remindBefore)) return REMIND_BEFORE_OPTIONS;
    const n = normalizeRemindBefore(remindBefore);
    return n > 0 ? [...REMIND_BEFORE_OPTIONS, { value: String(n), label: `${n} min before` }] : REMIND_BEFORE_OPTIONS;
  }, [remindBefore]);
  const remindBeforeCustomAdd = React.useCallback((typed: string) => {
    if (!/^\d+$/.test(typed)) return null;
    const n = parseInt(typed, 10);
    if (n < 1 || n > 1440) return null;
    if (remindBeforeOptions.some((o) => o.value === String(n))) return null;
    return { value: String(n), label: `Add: ${n} min before` };
  }, [remindBeforeOptions]);
  const [selectedContext, setSelectedContext] = React.useState("");
  const [selectedEntityId, setSelectedEntityId] = React.useState("");
  const [newAlarmMessage, setNewAlarmMessage] = React.useState("");
  
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [itemToDelete, setItemToDelete] = React.useState<Alarm | null>(null);
  const [selectedUsers, setSelectedUsers] = React.useState<string[]>([]);
  const [selectedAlarms, setSelectedAlarms] = React.useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = React.useState(new Date());
  const reminderFormRef = React.useRef<HTMLDivElement>(null);
  const reminderPrefillDoneRef = React.useRef(false);

  const contextOptions = REMINDER_CONTEXT_OPTIONS;

  // "Select users to notify" trigger text (display only): 1 = naam, 2 = "A, B", >2 = "N users", sab = "All", khali = placeholder.
  const usersTriggerLabel = React.useMemo(() => {
    if (!selectedUsers.length) return undefined;
    if (selectedUsers.includes("all") || (userOptions.length > 0 && selectedUsers.length >= userOptions.length)) return "All";
    const names = selectedUsers.map((v) => userOptions.find((o) => o.value === v)?.label || v);
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(", ");
    return `${names.length} users`;
  }, [selectedUsers, userOptions]);

  const entityOptions = React.useMemo(() => {
    if (!selectedContext) return [];
    return reminderEntityOptions
      .filter((o) => o.context === selectedContext)
      .map((o) => ({ value: o.entityId, label: o.name }));
  }, [selectedContext, reminderEntityOptions]);

  // Default "users" = sirf current user (explicit email), jab tak form khali ho.
  React.useEffect(() => {
    if (alarmToEdit) return;
    setSelectedUsers((prev) => (prev.length ? prev : defaultUsers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultUsers]);

  // Ledger header Reminder button: /messages?tab=alarms&reminderContext=..&reminderEntityId=..&reminderTitle=..
  // Read once on mount, prefill the form, then strip the reminder* params so a reload does not re-prefill.
  React.useEffect(() => {
    if (reminderPrefillDoneRef.current || typeof window === "undefined") return;
    reminderPrefillDoneRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get("reminderContext") ?? "";
    const entityId = params.get("reminderEntityId") ?? "";
    const title = (params.get("reminderTitle") ?? "").trim();
    if (!ctx && !entityId && !title) return;
    const validContexts: string[] = REMINDER_CONTEXT_OPTIONS.map((o) => o.value);
    const validCtx = validContexts.includes(ctx) ? ctx : "";
    setAlarmToEdit(null);
    setSelectedContext(validCtx);
    setSelectedEntityId(validCtx && entityId ? entityId : "");
    if (title) setNewAlarmTitle(title);
    params.delete("reminderContext");
    params.delete("reminderEntityId");
    params.delete("reminderTitle");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    const focusTimer = window.setTimeout(() => {
      const formEl = reminderFormRef.current;
      if (!formEl) return;
      formEl.scrollIntoView({ block: "start", behavior: "smooth" });
      formEl.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }, 150);
    return () => window.clearTimeout(focusTimer);
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
      if (!companyId) return;
      const q = query(collection(firestore, `companies/${companyId}/alarms`), orderBy("datetime", "desc"));
      const unsub = onSnapshot(q, (snapshot) => {
          setAlarms(snapshot.docs.map(d => ({id: d.id, ...d.data()} as Alarm)).filter(a => !isReminderDeleted(a)))
      });
      return () => unsub();
  }, [companyId]);

  // Deleted tab: soft-deleted reminders (popup jaisa), alag subscription; upar wali query unchanged.
  React.useEffect(() => {
      if (!companyId) { setDeletedAlarms([]); return; }
      const unsub = subscribeCompanyReminders(companyId, (list) => {
          setDeletedAlarms(
              list
                  .filter((a) => isReminderDeleted(a))
                  .sort((a, b) => (reminderTimeMs(b.deletedAt) || 0) - (reminderTimeMs(a.deletedAt) || 0))
          );
      });
      return () => unsub();
  }, [companyId]);


  const handleSetOrUpdateAlarm = async () => {
    if (!newAlarmTitle || !selectedDate || !companyId) {
       toast.error("Missing Information", { description: "Please provide a title and date/time for the reminder."});
       return;
    };
    
    setIsProcessing(true);
    try {
        const alarmData: Omit<Alarm, 'id'> = buildReminderAlarmData({
            title: newAlarmTitle,
            date: selectedDate,
            hour: selectedHour,
            minute: selectedMinute,
            period: selectedPeriod,
            message: newAlarmMessage,
            users: selectedUsers,
            context: selectedContext,
            entityId: selectedEntityId,
            remindBeforeMinutes: Number(remindBefore),
        });
        
        if (alarmToEdit) {
            await updateReminderAlarm(companyId, alarmToEdit.id, alarmData);
            toast.success("Reminder Updated", { description: `Your reminder for "${newAlarmTitle}" has been updated.`});
        } else {
             await createReminderAlarm(companyId, alarmData, user?.uid ?? null);
            toast.success("Reminder Set", { description: `A reminder for "${newAlarmTitle}" has been scheduled.`})
        }
        
        // Reset form
        setAlarmToEdit(null);
        setNewAlarmTitle("");
        setNewAlarmMessage("");
        setSelectedDate(new Date());
        setSelectedUsers(defaultUsers);
        setRemindBefore("0");
        setSelectedContext('');
        setSelectedEntityId('');
    } catch (e) {
        toast.error("Failed to set/update reminder.");
    } finally {
        setIsProcessing(false);
    }
  };
  
  const handleEditClick = (alarm: Alarm) => {
    setAlarmToEdit(alarm);
    setNewAlarmTitle(alarm.title);
    const alarmDate = alarm.datetime?.toDate ? alarm.datetime.toDate() : new Date(alarm.datetime);
    setSelectedDate(alarmDate);

    let hour = alarmDate.getHours();
    let period = "AM";
    if (hour >= 12) {
        period = "PM";
        if (hour > 12) hour -= 12;
    }
    if (hour === 0) hour = 12;
    
    setSelectedHour(String(hour).padStart(2, '0'));
    setSelectedMinute(String(alarmDate.getMinutes()).padStart(2, '0'));
    setSelectedPeriod(period);
    setRemindBefore(String(normalizeRemindBefore(alarm.remindBeforeMinutes)));

    setSelectedUsers(alarm.users || []);
    setSelectedContext(alarm.context || "");
    setSelectedEntityId(alarm.entityId || "");
    setNewAlarmMessage(alarm.message || "");
  };
  
  const handleDeleteSelected = async () => {
    if (!companyId || selectedAlarms.size === 0) return;
    setIsProcessing(true);
    try {
        await softDeleteReminderAlarms(companyId, Array.from(selectedAlarms), user?.uid ?? null);
        toast.success(`${selectedAlarms.size} reminder(s) deleted.`);
        setSelectedAlarms(new Set());
    } catch (e) {
        toast.error("Failed to delete selected reminders.");
    } finally {
        setIsProcessing(false);
    }
  }

  const handleDelete = async (item: Alarm) => {
    if (!companyId) return;
    setIsProcessing(true);
    try {
      await softDeleteReminderAlarms(companyId, [item.id], user?.uid ?? null);
      toast.success("Reminder deleted.");
    } catch(err) {
      toast.error("Failed to delete reminder.");
    } finally {
      setIsProcessing(false);
      setItemToDelete(null);
    }
  }

  const handleRestore = async (item: Alarm) => {
    if (!companyId) return;
    setIsProcessing(true);
    try {
      await restoreReminderAlarm(companyId, item);
      toast.success("Reminder restored.");
    } catch(err) {
      toast.error("Failed to restore reminder.");
    } finally {
      setIsProcessing(false);
    }
  }

  const handleSelectAlarm = (id: string, checked: boolean) => {
    setSelectedAlarms(prev => {
        const newSet = new Set(prev);
        if (checked) {
            newSet.add(id);
        } else {
            newSet.delete(id);
        }
        return newSet;
    });
  }
  
  const { upcomingAlarms, expiredAlarms } = React.useMemo(() => {
    const upcoming: Alarm[] = [];
    const expired: Alarm[] = [];
    alarms.forEach(alarm => {
        const alarmDate = alarm.datetime?.toDate ? alarm.datetime.toDate() : new Date(alarm.datetime);
        if (isPast(alarmDate)) {
            expired.push(alarm);
        } else {
            upcoming.push(alarm);
        }
    });
    return { upcomingAlarms: upcoming.sort((a,b) => (a.datetime?.toDate ? a.datetime.toDate().getTime() : 0) - (b.datetime?.toDate ? b.datetime.toDate().getTime() : 0)), expiredAlarms: expired };
  }, [alarms, currentTime]);

  // Plain render function (not a component): inline component type remounted the DOM every 1s clock tick -> hover-lift jitter.
  const renderAlarmList = ({ list, title, onSelectAll, isExpiredList, isDeletedList }: {list: Alarm[], title: string, onSelectAll: (check: boolean) => void, isExpiredList?: boolean, isDeletedList?: boolean }) => {
    const areAllSelected = list.length > 0 && list.every(a => selectedAlarms.has(a.id));

    return (
        <Card className="flex flex-col h-full">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle>{title}</CardTitle>
                    {!isDeletedList && <div className="flex items-center space-x-2">
                        <Checkbox id={`select-all-${title}`} checked={areAllSelected} onCheckedChange={(c) => onSelectAll(c as boolean)} />
                        <label htmlFor={`select-all-${title}`} className="text-sm font-medium">Select All</label>
                    </div>}
                </div>
            </CardHeader>
            <CardContent className="flex-1">
              <ScrollArea className="h-full">
                <div className="space-y-3">
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center pt-8">No reminders in this category.</p>
                  ) : (
                    list.map((alarm) => {
                        const alarmDate = alarm.datetime?.toDate ? alarm.datetime.toDate() : new Date(alarm.datetime);
                        const displayDateTime = dateSystem === 'AD' ? format(alarmDate, "PPP p") : `${formatDateBS(alarmDate)} ${format(alarmDate, 'p')}`;
                        return (
                            <div key={alarm.id} className="flex items-center justify-between p-3 border rounded-lg gap-4" data-pl-reminder-item>
                                <div className="flex items-center gap-4">
                                    {!isDeletedList && <Checkbox checked={selectedAlarms.has(alarm.id)} onCheckedChange={(c) => handleSelectAlarm(alarm.id, c as boolean)} />}
                                    <div>
                                        <p className="font-semibold">{alarm.title}</p>
                                        <p className="text-sm text-muted-foreground">
                                        {displayDateTime}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                        For: {formatUsers(alarm.users)}
                                        </p>
                                        {isDeletedList && (
                                        <p className="text-xs text-muted-foreground">
                                        Deleted: {(() => { const ms = reminderTimeMs(alarm.deletedAt); if (!ms) return "-"; const d = new Date(ms); return dateSystem === 'AD' ? format(d, "PPP p") : `${formatDateBS(d)} ${format(d, 'p')}`; })()}
                                        </p>
                                        )}
                                    </div>
                                </div>
                                {isDeletedList ? (
                                <div className="flex items-center gap-1">
                                    <Button variant="outline" size="sm" onClick={() => void handleRestore(alarm)} disabled={isProcessing}><RotateCcw className="mr-1 h-4 w-4" /> Restore</Button>
                                </div>
                                ) : (
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditClick(alarm)}><Edit className="h-4 w-4 text-blue-600"/></Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setItemToDelete(alarm)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                </div>
                                )}
                            </div>
                        )
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
        </Card>
    )
  }

  return (
    <Card className="h-full flex flex-col">
    <div className="grid grid-cols-1 md:grid-cols-[400px_1fr] gap-6 p-6 flex-1 min-h-0">
      <div ref={reminderFormRef} className="flex flex-col gap-4" data-pl-reminder-form>
        <h3 className="text-lg font-semibold">{alarmToEdit ? 'Edit Reminder' : 'Set New Reminder'}</h3>
        <div className="space-y-4">
          <Input
            placeholder="Reminder Title..."
            value={newAlarmTitle}
            onChange={(e) => setNewAlarmTitle(e.target.value)}
            className="h-10 min-h-10"
          />
            {/* Date + H + M + AM/PM: ek row, char boxes same size (h-10, flex-1 basis), left-aligned, narrow par wrap. */}
            <div className="flex flex-wrap items-center justify-start gap-2">
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <div className="flex-[1.3_1_0%] min-w-[8.5rem]">
                  <BsDatePicker
                    valueAD={selectedDate}
                    onChangeAD={(d) => setSelectedDate(d ?? undefined)}
                    isRange={false}
                    className="h-10 min-h-10 w-full truncate"
                  />
                </div>
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-10 min-h-10 flex-[1.3_1_0%] min-w-[8.5rem] justify-start px-2 text-left font-normal", !selectedDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      <span className="min-w-0 truncate">
                      {selectedDate
                        ? dateSystem === "Both"
                          ? formatDate(selectedDate)
                          : format(selectedDate, "PPP")
                        : "Pick a date"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="flex w-auto flex-col space-y-2 p-2">
                    <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} />
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex flex-[3_1_0%] min-w-[12.5rem] flex-nowrap gap-2">
                <div className="relative flex-1 basis-0 min-w-[4rem]">
                  <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">H</span>
                  <Input type="number" aria-label="Hour" value={selectedHour} onChange={e => setSelectedHour(e.target.value)} onBlur={() => { if (selectedHour.trim() === "") setSelectedHour("10"); }} className="h-10 min-h-10 w-full pl-6 text-center" placeholder="H" maxLength={2} />
                </div>
                <div className="relative flex-1 basis-0 min-w-[4rem]">
                  <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">M</span>
                  <Input type="number" aria-label="Minute" value={selectedMinute} onChange={e => setSelectedMinute(e.target.value)} onBlur={() => { if (selectedMinute.trim() === "") setSelectedMinute("00"); }} className="h-10 min-h-10 w-full pl-6 text-center" placeholder="M" maxLength={2} />
                </div>
                 <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                    <SelectTrigger className="h-10 min-h-10 flex-1 basis-0 min-w-[4rem]" aria-label="AM/PM"><SelectValue/></SelectTrigger>
                    <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 basis-0 flex-col items-stretch gap-2">
                <label className="text-sm font-medium text-foreground">Remind before</label>
                <Combobox
                  options={remindBeforeOptions}
                  value={remindBefore}
                  onChange={(v) => setRemindBefore(v)}
                  customAddForSearch={remindBeforeCustomAdd}
                  placeholder="Remind before..."
                  triggerClassName="h-10 min-h-10 w-full"
                  popoverContentClassName="pl-reminder-combo-popover"
                />
              </div>
              <div className="flex min-w-0 flex-1 basis-0 flex-col items-stretch gap-2">
                <label className="text-sm font-medium text-foreground">Users</label>
                <Combobox
                  options={userOptions}
                  value={selectedUsers}
                  onMultiChange={setSelectedUsers}
                  placeholder="Select users to notify..."
                  isMultiSelect
                  multiTriggerLabel={usersTriggerLabel}
                  triggerClassName="h-10 min-h-10 w-full"
                  popoverContentClassName="pl-reminder-combo-popover"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <Combobox options={contextOptions} value={selectedContext} onChange={setSelectedContext} placeholder="Link to..." triggerClassName="h-10 min-h-10" popoverContentClassName="pl-reminder-combo-popover" />
               <Combobox options={entityOptions} value={selectedEntityId} onChange={setSelectedEntityId} placeholder="Select entity..." triggerClassName="h-10 min-h-10" popoverContentClassName="pl-reminder-combo-popover" />
            </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Message (optional)</label>
            <Textarea
              placeholder="Add a message for the reminder notification..."
              value={newAlarmMessage}
              onChange={(e) => setNewAlarmMessage(e.target.value)}
              className="min-h-[80px] resize-none"
              maxLength={500}
            />
          </div>
          <Button className="w-auto px-6" onClick={handleSetOrUpdateAlarm} disabled={isProcessing} data-pl-reminder-submit>
            {isProcessing ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <AlarmPlus className="mr-2 h-4 w-4" />} 
            {alarmToEdit ? 'Update Reminder' : 'Set Reminder'}
          </Button>
           {alarmToEdit && <Button variant="outline" size="sm" onClick={() => setAlarmToEdit(null)}>Cancel Edit</Button>}
        </div>
      </div>
      
        <div className="flex flex-col gap-4 min-h-0" data-pl-reminder-list>
             <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Manage Reminders</h3>
                <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={selectedAlarms.size === 0 || isProcessing}>
                     {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                    <Trash2 className="mr-2 h-4 w-4"/> Delete Selected ({selectedAlarms.size})
                </Button>
            </div>
            <Tabs defaultValue="upcoming" className="flex-1 flex flex-col min-h-0">
                <TabsList className="w-full">
                    <TabsTrigger value="upcoming" className="flex-1">Upcoming ({upcomingAlarms.length})</TabsTrigger>
                    <TabsTrigger value="expired" className="flex-1">Expired ({expiredAlarms.length})</TabsTrigger>
                    <TabsTrigger value="deleted" className="flex-1">Deleted ({deletedAlarms.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="upcoming" className="mt-4 flex-1">
                   {renderAlarmList({ list: upcomingAlarms, title: "Upcoming Reminders", onSelectAll: (checked) => {
                        const upcomingIds = upcomingAlarms.map(a => a.id);
                        setSelectedAlarms(prev => {
                            const newSet = new Set(prev);
                            if(checked) {
                                upcomingIds.forEach(id => newSet.add(id));
                            } else {
                                upcomingIds.forEach(id => newSet.delete(id));
                            }
                            return newSet;
                        })
                   } })}
                </TabsContent>
                <TabsContent value="expired" className="mt-4 flex-1">
                   {renderAlarmList({ list: expiredAlarms, title: "Expired Reminders", isExpiredList: true, onSelectAll: (checked) => {
                        const expiredIds = expiredAlarms.map(a => a.id);
                        setSelectedAlarms(prev => {
                            const newSet = new Set(prev);
                            if(checked) {
                                expiredIds.forEach(id => newSet.add(id));
                            } else {
                                expiredIds.forEach(id => newSet.delete(id));
                            }
                            return newSet;
                        })
                   } })}
                </TabsContent>
                <TabsContent value="deleted" className="mt-4 flex-1">
                   {renderAlarmList({ list: deletedAlarms, title: "Deleted Reminders", isDeletedList: true, onSelectAll: () => {} })}
                </TabsContent>
            </Tabs>
        </div>
    </div>
     <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reminder?</AlertDialogTitle>
            <AlertDialogDescription>This reminder will be moved to Deleted history. You can restore it from the Deleted tab.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => itemToDelete && handleDelete(itemToDelete)} disabled={isProcessing} className="bg-destructive hover:bg-destructive/90">
              {isProcessing && <Loader2 className="animate-spin mr-2 h-4 w-4"/>} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
