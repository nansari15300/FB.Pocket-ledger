"use client";

import { updateDoc, writeBatch, addDoc, deleteDoc } from "@/lib/writeGateway/pbWrites";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { useAuth } from "@/hooks/useAuth";
import { collection, query, orderBy, doc, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
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
import { useVouchers } from "@/hooks/useVouchers";
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
};

export function AlarmsTab() {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const { processedPartiesForSelection, processedStaff, processedAccounts, processedTaxes, processedItems, expenseAccounts } = useVouchers();
  const { dateSystem, formatDate, formatDateBS } = useDate();

  const [alarms, setAlarms] = React.useState<Alarm[]>([]);
  
  const [alarmToEdit, setAlarmToEdit] = React.useState<Alarm | null>(null);
  const [newAlarmTitle, setNewAlarmTitle] = React.useState("");
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(new Date());
  const [selectedHour, setSelectedHour] = React.useState("12");
  const [selectedMinute, setSelectedMinute] = React.useState("00");
  const [selectedPeriod, setSelectedPeriod] = React.useState("PM");
  const [selectedContext, setSelectedContext] = React.useState("");
  const [selectedEntityId, setSelectedEntityId] = React.useState("");
  const [newAlarmMessage, setNewAlarmMessage] = React.useState("");
  
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [itemToDelete, setItemToDelete] = React.useState<Alarm | null>(null);
  const [selectedUsers, setSelectedUsers] = React.useState<string[]>([]);
  const [selectedAlarms, setSelectedAlarms] = React.useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = React.useState(new Date());

  const contextOptions = [
    { value: 'Party', label: 'Party' },
    { value: 'Staff', label: STAFF_ENTITY_LABEL },
    { value: 'Bank/Cash', label: 'Bank/Cash Account' },
    { value: 'Tax', label: 'Tax' },
    { value: 'Items', label: 'Items' },
    { value: 'Income/Expense', label: 'Income/Expense Account' },
  ];

  const entityOptions = React.useMemo(() => {
    switch (selectedContext) {
      case "Party": return processedPartiesForSelection.map(p => ({ value: p.id, label: p.name }));
      case "Staff": return processedStaff.map(s => ({ value: s.id, label: s.name }));
      case "Bank/Cash": return processedAccounts.map(a => ({ value: a.id, label: a.accountName }));
      case "Tax": return processedTaxes.map(t => ({ value: t.id, label: t.name }));
      case "Items": return processedItems.map(i => ({ value: i.id, label: i.name }));
      case "Income/Expense": return expenseAccounts.map(e => ({ value: e.id, label: e.name }));
      default: return [];
    }
  }, [selectedContext, processedPartiesForSelection, processedStaff, processedAccounts, processedTaxes, processedItems, expenseAccounts]);

  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
      if (!companyId) return;
      const q = query(collection(firestore, `companies/${companyId}/alarms`), orderBy("datetime", "desc"));
      const unsub = onSnapshot(q, (snapshot) => {
          setAlarms(snapshot.docs.map(d => ({id: d.id, ...d.data()} as Alarm)))
      });
      return () => unsub();
  }, [companyId]);

  const companyUsers = React.useMemo(() => {
    if (!company) return [];
    const owner = { id: company.ownerEmail, name: "Owner" };
    const shared = (company.sharedWith || []).map((u: any) => ({
      id: u.email,
      name: u.name || u.email,
    }));
    const all = [owner, ...shared];
    const unique = Array.from(new Map(all.map(item => [item.id, item])).values());
    return unique;
  }, [company]);
  
  const userOptions = React.useMemo(() => companyUsers.map(u => ({ value: u.id, label: u.name })), [companyUsers]);

  const handleSetOrUpdateAlarm = async () => {
    if (!newAlarmTitle || !selectedDate || !companyId) {
       toast.error("Missing Information", { description: "Please provide a title and date/time for the alarm."});
       return;
    };
    
    let hours = parseInt(selectedHour, 10);
    if (selectedPeriod === "PM" && hours < 12) hours += 12;
    if (selectedPeriod === "AM" && hours === 12) hours = 0; 

    const finalDateTime = new Date(selectedDate);
    finalDateTime.setHours(hours, parseInt(selectedMinute, 10), 0, 0);
    const notifyAt = new Date(finalDateTime.getTime() - 5 * 60 * 1000);

    setIsProcessing(true);
    try {
        const alarmData: Omit<Alarm, 'id'> = {
            title: newAlarmTitle,
            datetime: finalDateTime,
            notifyAt: Timestamp.fromDate(notifyAt),
            message: newAlarmMessage.trim() || undefined,
            users: selectedUsers,
            context: selectedContext || undefined,
            entityId: selectedEntityId || undefined,
            notified: false,
        };
        
        if (alarmToEdit) {
            await updateDoc(doc(firestore, `companies/${companyId}/alarms`, alarmToEdit.id), alarmData);
            toast.success("Alarm Updated", { description: `Your alarm for "${newAlarmTitle}" has been updated.`});
        } else {
             await addDoc(collection(firestore, `companies/${companyId}/alarms`), {
                ...alarmData,
                createdAt: serverTimestamp(),
                createdBy: user?.uid ?? null,
            });
            toast.success("Alarm Set", { description: `An alarm for "${newAlarmTitle}" has been scheduled.`})
        }
        
        // Reset form
        setAlarmToEdit(null);
        setNewAlarmTitle("");
        setNewAlarmMessage("");
        setSelectedDate(new Date());
        setSelectedUsers([]);
        setSelectedContext('');
        setSelectedEntityId('');
    } catch (e) {
        toast.error("Failed to set/update alarm.");
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
    const batch = writeBatch(firestore);
    selectedAlarms.forEach(id => {
        const docRef = doc(firestore, `companies/${companyId}/alarms`, id);
        batch.delete(docRef);
    });
    try {
        await batch.commit();
        toast.success(`${selectedAlarms.size} alarm(s) deleted.`);
        setSelectedAlarms(new Set());
    } catch (e) {
        toast.error("Failed to delete selected alarms.");
    } finally {
        setIsProcessing(false);
    }
  }

  const handleDelete = async (item: Alarm) => {
    if (!companyId) return;
    setIsProcessing(true);
    try {
      await deleteDoc(doc(firestore, `companies/${companyId}/alarms`, item.id));
      toast.success("Alarm deleted.");
    } catch(err) {
      toast.error("Failed to delete alarm.");
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
                    <p className="text-sm text-muted-foreground text-center pt-8">No alarms in this category.</p>
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
                                        For: {alarm.users.length === 0 ? "You" : alarm.users.join(', ')}
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
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">{alarmToEdit ? 'Edit Alarm' : 'Set New Alarm'}</h3>
        <div className="space-y-4">
          <Input
            placeholder="Alarm Title..."
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
                <Input type="number" value={selectedHour} onChange={e => setSelectedHour(e.target.value)} className="w-20 text-center" placeholder="HH" maxLength={2} />
                <span>:</span>
                <Input type="number" value={selectedMinute} onChange={e => setSelectedMinute(e.target.value)} className="w-20 text-center" placeholder="MM" maxLength={2} />
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
              placeholder="Add a message for the alarm notification..."
              value={newAlarmMessage}
              onChange={(e) => setNewAlarmMessage(e.target.value)}
              className="min-h-[80px] resize-none"
              maxLength={500}
            />
          </div>
          <Button className="w-full" onClick={handleSetOrUpdateAlarm} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <AlarmPlus className="mr-2 h-4 w-4" />} 
            {alarmToEdit ? 'Update Alarm' : 'Set Alarm'}
          </Button>
           {alarmToEdit && <Button variant="outline" size="sm" onClick={() => setAlarmToEdit(null)}>Cancel Edit</Button>}
        </div>
      </div>
      
        <div className="flex flex-col gap-4 min-h-0">
             <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Manage Alarms</h3>
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
                   <AlarmList list={upcomingAlarms} title="Upcoming Alarms" onSelectAll={(checked) => {
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
                   <AlarmList list={expiredAlarms} title="Expired Alarms" isExpiredList onSelectAll={(checked) => {
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
            <AlertDialogTitle>Delete Alarm?</AlertDialogTitle>
            <AlertDialogDescription>This alarm will be permanently deleted.</AlertDialogDescription>
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
