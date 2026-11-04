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
import { Loader2, Trash2, AlarmPlus, Edit, Calendar as CalendarIcon, XCircle } from "lucide-react";
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
};

export type ReminderAlarm = Alarm;

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
}): Omit<Alarm, "id"> {
  let hours = parseInt(input.hour, 10);
  if (input.period === "PM" && hours < 12) hours += 12;
  if (input.period === "AM" && hours === 12) hours = 0;

  const finalDateTime = new Date(input.date);
  finalDateTime.setHours(hours, parseInt(input.minute, 10), 0, 0);
  const notifyAt = new Date(finalDateTime.getTime() - 5 * 60 * 1000);

  return {
    title: input.title,
    datetime: finalDateTime,
    notifyAt: Timestamp.fromDate(notifyAt),
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
  
  const [alarmToEdit, setAlarmToEdit] = React.useState<Alarm | null>(null);
  const [newAlarmTitle, setNewAlarmTitle] = React.useState("");
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(new Date());
  const [selectedHour, setSelectedHour] = React.useState("10");
  const [selectedMinute, setSelectedMinute] = React.useState("00");
  const [selectedPeriod, setSelectedPeriod] = React.useState("AM");
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

  const AlarmList = ({ list, title, onSelectAll, isExpiredList }: {list: Alarm[], title: string, onSelectAll: (check: boolean) => void, isExpiredList?: boolean }) => {
    const areAllSelected = list.length > 0 && list.every(a => selectedAlarms.has(a.id));

    return (
        <Card className="flex flex-col h-full">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle>{title}</CardTitle>
                    <div className="flex items-center space-x-2">
                        <Checkbox id={`select-all-${title}`} checked={areAllSelected} onCheckedChange={(c) => onSelectAll(c as boolean)} />
                        <label htmlFor={`select-all-${title}`} className="text-sm font-medium">Select All</label>
                    </div>
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
                            <div key={alarm.id} className="flex items-center justify-between p-3 border rounded-lg gap-4">
                                <div className="flex items-center gap-4">
                                    <Checkbox checked={selectedAlarms.has(alarm.id)} onCheckedChange={(c) => handleSelectAlarm(alarm.id, c as boolean)} />
                                    <div>
                                        <p className="font-semibold">{alarm.title}</p>
                                        <p className="text-sm text-muted-foreground">
                                        {displayDateTime}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                        For: {formatUsers(alarm.users)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditClick(alarm)}><Edit className="h-4 w-4 text-blue-600"/></Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setItemToDelete(alarm)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                </div>
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
      <div ref={reminderFormRef} className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">{alarmToEdit ? 'Edit Reminder' : 'Set New Reminder'}</h3>
        <div className="space-y-4">
          <Input
            placeholder="Reminder Title..."
            value={newAlarmTitle}
            onChange={(e) => setNewAlarmTitle(e.target.value)}
          />
            <div className={cn("flex gap-2", dateSystem === "Both" && "gap-2")}>
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <div className="flex-1 min-w-0">
                  <BsDatePicker
                    valueAD={selectedDate}
                    onChangeAD={(d) => setSelectedDate(d ?? undefined)}
                    isRange={false}
                    className="w-full"
                  />
                </div>
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      {selectedDate
                        ? dateSystem === "Both"
                          ? formatDate(selectedDate)
                          : format(selectedDate, "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="flex w-auto flex-col space-y-2 p-2">
                    <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} />
                  </PopoverContent>
                </Popover>
              )}
            </div>
             <div className="flex items-center justify-center gap-2">
                <label className="text-sm font-medium text-foreground">Time</label>
                <Input type="number" aria-label="Hour" value={selectedHour} onChange={e => setSelectedHour(e.target.value)} onBlur={() => { if (selectedHour.trim() === "") setSelectedHour("10"); }} className="w-20 text-center" placeholder="HH" maxLength={2} />
                <span>:</span>
                <Input type="number" aria-label="Minute" value={selectedMinute} onChange={e => setSelectedMinute(e.target.value)} onBlur={() => { if (selectedMinute.trim() === "") setSelectedMinute("00"); }} className="w-20 text-center" placeholder="MM" maxLength={2} />
                 <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                    <SelectTrigger className="w-24"><SelectValue/></SelectTrigger>
                    <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
                </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <Combobox options={contextOptions} value={selectedContext} onChange={setSelectedContext} placeholder="Link to..." />
               <Combobox options={entityOptions} value={selectedEntityId} onChange={setSelectedEntityId} placeholder="Select entity..." />
            </div>
           <Combobox 
            options={userOptions}
            value={selectedUsers}
            onMultiChange={setSelectedUsers}
            placeholder="Select users to notify..."
            isMultiSelect
          />
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
          <Button className="w-full" onClick={handleSetOrUpdateAlarm} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <AlarmPlus className="mr-2 h-4 w-4" />} 
            {alarmToEdit ? 'Update Reminder' : 'Set Reminder'}
          </Button>
           {alarmToEdit && <Button variant="outline" size="sm" onClick={() => setAlarmToEdit(null)}>Cancel Edit</Button>}
        </div>
      </div>
      
        <div className="flex flex-col gap-4 min-h-0">
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
                </TabsList>
                <TabsContent value="upcoming" className="mt-4 flex-1">
                   <AlarmList list={upcomingAlarms} title="Upcoming Reminders" onSelectAll={(checked) => {
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
                   }} />
                </TabsContent>
                <TabsContent value="expired" className="mt-4 flex-1">
                   <AlarmList list={expiredAlarms} title="Expired Reminders" isExpiredList onSelectAll={(checked) => {
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
                   }} />
                </TabsContent>
            </Tabs>
        </div>
    </div>
     <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reminder?</AlertDialogTitle>
            <AlertDialogDescription>This reminder will be moved to Deleted history. You can restore it from the Reminder popup.</AlertDialogDescription>
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
