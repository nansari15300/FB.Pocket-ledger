"use client";

import * as React from "react";
import { format, isPast } from "date-fns";
import { AlarmPlus, Calendar as CalendarIcon, Edit, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Combobox } from "@/components/ui/combobox";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  buildReminderAlarmData,
  createReminderAlarm,
  isReminderDeleted,
  reminderTimeMs,
  restoreReminderAlarm,
  softDeleteReminderAlarms,
  subscribeCompanyReminders,
  updateReminderAlarm,
  type ReminderAlarm,
} from "@/components/messages/AlarmsTab";
import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import {
  parseReminderEntityKey,
  reminderContextLabel,
  reminderEntityKey,
  useReminderEntityOptions,
} from "@/hooks/useReminderEntityOptions";
import { useCompanyReminderUsers } from "@/hooks/useCompanyReminderUsers";

type LedgerReminderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: LedgerReminderContext | null;
  entityId?: string | null;
  title?: string | null;
};

const NO_ACCOUNT = "__no_account__";
const MAX_ACCOUNT_OPTIONS = 200;

/**
 * Ledger Details header Reminder button (aur header Test popup) -> Reminder popup.
 * Left: Set New / Edit Reminder form (account dropdown = sab accounts, default opener ka account; users multi-select).
 * Right: selected account ke reminders: Upcoming / History / Deleted (soft delete + restore).
 * Save path Messages -> Reminder tab (AlarmsTab) ke exported helpers hi hain.
 */
export function LedgerReminderDialog({ open, onOpenChange, context, entityId, title }: LedgerReminderDialogProps) {
  const [isProcessing, setIsProcessing] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isProcessing) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[90dvh] w-[95vw] max-w-xl flex-col gap-4 overflow-hidden sm:max-w-[560px]">
        {/* DialogContent band hone par unmount hota hai, isliye har open par form fresh (title prefill, aaj, 10:00 AM). */}
        <LedgerReminderPanel
          context={context}
          entityId={entityId}
          title={title}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function toDate(value: any): Date | null {
  const ms = reminderTimeMs(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function LedgerReminderPanel({
  context,
  entityId,
  title,
  isProcessing,
  setIsProcessing,
  onClose,
}: Omit<LedgerReminderDialogProps, "open" | "onOpenChange"> & {
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const { user } = useAuth();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { options: entityOptions, byKey } = useReminderEntityOptions();
  const { userOptions, defaultUsers, formatUsers } = useCompanyReminderUsers();

  const initialKey = reminderEntityKey(context, entityId) || NO_ACCOUNT;
  const [accountKey, setAccountKey] = React.useState<string>(initialKey);
  const autoTitleRef = React.useRef<string>(String(title ?? "").trim());

  const [editing, setEditing] = React.useState<ReminderAlarm | null>(null);
  const [reminderTitle, setReminderTitle] = React.useState(() => String(title ?? "").trim());
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(() => new Date());
  const [selectedHour, setSelectedHour] = React.useState("10");
  const [selectedMinute, setSelectedMinute] = React.useState("00");
  const [selectedPeriod, setSelectedPeriod] = React.useState("AM");
  const [message, setMessage] = React.useState("");
  const [selectedUsers, setSelectedUsers] = React.useState<string[]>(defaultUsers);
  const usersTouchedRef = React.useRef(false);

  const [reminders, setReminders] = React.useState<ReminderAlarm[]>([]);
  const [listTab, setListTab] = React.useState("upcoming");
  const [itemToDelete, setItemToDelete] = React.useState<ReminderAlarm | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  // Auth der se aaye to default "You" set karo (user ne khud badla na ho to).
  React.useEffect(() => {
    if (usersTouchedRef.current || editing) return;
    setSelectedUsers((prev) => (prev.length ? prev : defaultUsers));
  }, [defaultUsers, editing]);

  React.useEffect(() => {
    if (!companyId) {
      setReminders([]);
      return;
    }
    const unsub = subscribeCompanyReminders(companyId, (list) => setReminders(list));
    return () => unsub();
  }, [companyId]);

  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  const selected = parseReminderEntityKey(accountKey);
  const selectedOption = byKey.get(accountKey);
  const selectedName = selectedOption?.name || (selected && reminderEntityKey(context, entityId) === accountKey ? String(title ?? "").trim() : "");

  const accountOptions = React.useMemo(() => {
    const base = [{ value: NO_ACCOUNT, label: "No account (general reminder)" }, ...entityOptions];
    // Opener ka account list me na ho (abhi load nahi hua) to bhi default dikhe.
    if (accountKey !== NO_ACCOUNT && !byKey.has(accountKey)) {
      const p = parseReminderEntityKey(accountKey);
      const name = String(title ?? "").trim() || p?.entityId || accountKey;
      base.splice(1, 0, { value: accountKey, label: `${name} (${reminderContextLabel(p?.context)})` } as any);
    }
    return base;
  }, [entityOptions, byKey, accountKey, title]);

  const handleAccountChange = (value: string) => {
    const next = value || NO_ACCOUNT;
    setAccountKey(next);
    const opt = byKey.get(next);
    const nextName = opt?.name ?? "";
    const current = reminderTitle.trim();
    if (!editing && (current === "" || current === autoTitleRef.current)) {
      setReminderTitle(nextName);
    }
    autoTitleRef.current = nextName;
  };

  const { upcoming, history, deleted } = React.useMemo(() => {
    const scoped = selected
      ? reminders.filter((a) => a.context === selected.context && a.entityId === selected.entityId)
      : reminders;
    const up: ReminderAlarm[] = [];
    const hist: ReminderAlarm[] = [];
    const del: ReminderAlarm[] = [];
    for (const a of scoped) {
      if (isReminderDeleted(a)) {
        del.push(a);
        continue;
      }
      const ms = reminderTimeMs(a.datetime);
      const past = Number.isFinite(ms) ? ms <= nowMs : false;
      if (a.notified === true || past) hist.push(a);
      else up.push(a);
    }
    up.sort((a, b) => reminderTimeMs(a.datetime) - reminderTimeMs(b.datetime));
    hist.sort((a, b) => reminderTimeMs(b.datetime) - reminderTimeMs(a.datetime));
    del.sort((a, b) => (reminderTimeMs(b.deletedAt) || 0) - (reminderTimeMs(a.deletedAt) || 0));
    return { upcoming: up, history: hist, deleted: del };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders, selected?.context, selected?.entityId, nowMs]);

  const resetForm = () => {
    setEditing(null);
    setReminderTitle(selectedName || "");
    autoTitleRef.current = selectedName || "";
    setSelectedDate(new Date());
    setSelectedHour("10");
    setSelectedMinute("00");
    setSelectedPeriod("AM");
    setMessage("");
    usersTouchedRef.current = false;
    setSelectedUsers(defaultUsers);
  };

  const handleEditClick = (alarm: ReminderAlarm) => {
    setEditing(alarm);
    setReminderTitle(alarm.title || "");
    const alarmDate = toDate(alarm.datetime) ?? new Date();
    setSelectedDate(alarmDate);
    let hour = alarmDate.getHours();
    let period = "AM";
    if (hour >= 12) {
      period = "PM";
      if (hour > 12) hour -= 12;
    }
    if (hour === 0) hour = 12;
    setSelectedHour(String(hour).padStart(2, "0"));
    setSelectedMinute(String(alarmDate.getMinutes()).padStart(2, "0"));
    setSelectedPeriod(period);
    setMessage(alarm.message || "");
    usersTouchedRef.current = true;
    setSelectedUsers(Array.isArray(alarm.users) ? alarm.users : []);
    const key = reminderEntityKey(alarm.context, alarm.entityId);
    setAccountKey(key || NO_ACCOUNT);
    autoTitleRef.current = alarm.title || "";
  };

  const handleSave = async () => {
    const cleanTitle = reminderTitle.trim();
    if (!cleanTitle || !selectedDate || !companyId) {
      toast.error("Missing Information", { description: "Please provide a title and date/time for the reminder." });
      return;
    }
    setIsProcessing(true);
    try {
      const alarmData = buildReminderAlarmData({
        title: cleanTitle,
        date: selectedDate,
        hour: selectedHour,
        minute: selectedMinute,
        period: selectedPeriod,
        message,
        users: selectedUsers,
        context: selected?.context,
        entityId: selected?.entityId,
      });
      if (editing) {
        await updateReminderAlarm(companyId, editing.id, alarmData);
        toast.success("Reminder Updated", { description: `Your reminder for "${cleanTitle}" has been updated.` });
      } else {
        await createReminderAlarm(companyId, alarmData, user?.uid ?? null);
        toast.success("Reminder Set", { description: `A reminder for "${cleanTitle}" has been scheduled.` });
      }
      resetForm();
      setListTab("upcoming");
    } catch {
      toast.error("Failed to set/update reminder.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (alarm: ReminderAlarm) => {
    if (!companyId) return;
    setIsProcessing(true);
    try {
      await softDeleteReminderAlarms(companyId, [alarm.id], user?.uid ?? null);
      if (editing?.id === alarm.id) resetForm();
      toast.success("Reminder deleted.");
    } catch {
      toast.error("Failed to delete reminder.");
    } finally {
      setIsProcessing(false);
      setItemToDelete(null);
    }
  };

  const handleRestore = async (alarm: ReminderAlarm) => {
    if (!companyId) return;
    setIsProcessing(true);
    try {
      await restoreReminderAlarm(companyId, alarm);
      toast.success("Reminder restored.");
    } catch {
      toast.error("Failed to restore reminder.");
    } finally {
      setIsProcessing(false);
    }
  };

  const displayDateTime = (value: any): string => {
    const d = toDate(value);
    if (!d) return "-";
    return dateSystem === "AD" ? format(d, "PPP p") : `${formatDateBS(d)} ${format(d, "p")}`;
  };

  const linkLabel = (a: ReminderAlarm): string => {
    if (!a.context) return "";
    const opt = byKey.get(reminderEntityKey(a.context, a.entityId));
    const ctx = reminderContextLabel(a.context);
    return opt ? `${opt.name} (${ctx})` : ctx;
  };

  const renderList = (list: ReminderAlarm[], kind: "upcoming" | "history" | "deleted") => {
    if (list.length === 0) {
      return <p className="pt-8 text-center text-sm text-muted-foreground">No reminders in this category.</p>;
    }
    return (
      <div className="space-y-3">
        {list.map((alarm) => {
          const link = !selected ? linkLabel(alarm) : "";
          const isEditingThis = editing?.id === alarm.id;
          return (
            <div
              key={alarm.id}
              className={cn(
                "flex items-start justify-between gap-3 rounded-lg border p-3",
                isEditingThis && "border-primary bg-primary/5",
              )}
            >
              <div className="min-w-0">
                <p className="break-words font-semibold">{alarm.title}</p>
                <p className="text-sm text-muted-foreground">{displayDateTime(alarm.datetime)}</p>
                {alarm.message ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{alarm.message}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">For: {formatUsers(alarm.users)}</p>
                {link ? <p className="text-xs text-muted-foreground">Link to: {link}</p> : null}
                {kind === "history" ? (
                  <p className="text-xs text-muted-foreground">{alarm.notified ? "Notified" : "Expired"}</p>
                ) : null}
                {kind === "deleted" ? (
                  <p className="text-xs text-muted-foreground">Deleted: {displayDateTime(alarm.deletedAt)}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {kind === "deleted" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => void handleRestore(alarm)}
                    disabled={isProcessing}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" /> Restore
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Edit"
                      aria-label="Edit reminder"
                      onClick={() => handleEditClick(alarm)}
                      disabled={isProcessing}
                    >
                      <Edit className="h-4 w-4 text-primary" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Delete"
                      aria-label="Delete reminder"
                      onClick={() => setItemToDelete(alarm)}
                      disabled={isProcessing}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlarmPlus className="h-5 w-5 text-primary" />
          {editing ? "Edit Reminder" : "Set New Reminder"}
        </DialogTitle>
        <DialogDescription>
          {selected
            ? `Link to: ${reminderContextLabel(selected.context)}${selectedName ? ` - ${selectedName}` : ""}`
            : "General reminder (all reminders are listed)"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <div className="flex min-w-0 shrink-0 flex-col">
          <Tabs value={listTab} onValueChange={setListTab} className="flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="upcoming" className="flex-1">Upcoming ({upcoming.length})</TabsTrigger>
              <TabsTrigger value="history" className="flex-1">History ({history.length})</TabsTrigger>
              <TabsTrigger value="deleted" className="flex-1">Deleted ({deleted.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="upcoming" className="mt-3 max-h-[35dvh] overflow-y-auto">
              {renderList(upcoming, "upcoming")}
            </TabsContent>
            <TabsContent value="history" className="mt-3 max-h-[35dvh] overflow-y-auto">
              {renderList(history, "history")}
            </TabsContent>
            <TabsContent value="deleted" className="mt-3 max-h-[35dvh] overflow-y-auto">
              {renderList(deleted, "deleted")}
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Account</label>
            <Combobox
              options={accountOptions}
              value={accountKey}
              onChange={(v) => handleAccountChange(v)}
              placeholder="Select account..."
              searchPlaceholder="Search account..."
              maxVisibleOptions={MAX_ACCOUNT_OPTIONS}
              autoFocusSearchOnOpen
            />
          </div>
          <Input
            placeholder="Reminder Title..."
            value={reminderTitle}
            onChange={(e) => setReminderTitle(e.target.value)}
          />
          <div className="flex gap-2">
            {(dateSystem === "BS" || dateSystem === "Both") && (
              <div className="min-w-0 flex-1">
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
                  <Button
                    variant="outline"
                    className={cn("flex-1 justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}
                  >
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
            <Input
              type="number"
              aria-label="Hour"
              value={selectedHour}
              onChange={(e) => setSelectedHour(e.target.value)}
              onBlur={() => { if (selectedHour.trim() === "") setSelectedHour("10"); }}
              className="w-20 text-center"
              placeholder="HH"
              maxLength={2}
            />
            <span className="text-foreground">:</span>
            <Input
              type="number"
              aria-label="Minute"
              value={selectedMinute}
              onChange={(e) => setSelectedMinute(e.target.value)}
              onBlur={() => { if (selectedMinute.trim() === "") setSelectedMinute("00"); }}
              className="w-20 text-center"
              placeholder="MM"
              maxLength={2}
            />
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Notify users</label>
            <Combobox
              options={userOptions}
              value={selectedUsers}
              onMultiChange={(values) => {
                usersTouchedRef.current = true;
                setSelectedUsers(values);
              }}
              placeholder="Select users to notify..."
              isMultiSelect
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Message (optional)</label>
            <Textarea
              placeholder="Add a message for the reminder notification..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[80px] resize-none"
              maxLength={500}
            />
          </div>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onClose} disabled={isProcessing}>
          Close
        </Button>
        {editing ? (
          <Button variant="outline" onClick={resetForm} disabled={isProcessing}>
            Cancel Edit
          </Button>
        ) : null}
        <Button onClick={handleSave} disabled={isProcessing}>
          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlarmPlus className="mr-2 h-4 w-4" />}
          {editing ? "Update Reminder" : "Set Reminder"}
        </Button>
      </DialogFooter>

      <AlertDialog open={!!itemToDelete} onOpenChange={(o) => { if (!o) setItemToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              This reminder will be moved to Deleted history. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => itemToDelete && void handleDelete(itemToDelete)}
              disabled={isProcessing}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}