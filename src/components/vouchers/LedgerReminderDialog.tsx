"use client";

import * as React from "react";
import { format } from "date-fns";
import { AlarmPlus, Calendar as CalendarIcon, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { buildReminderAlarmData, createReminderAlarm } from "@/components/messages/AlarmsTab";
import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";

type LedgerReminderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: LedgerReminderContext | null;
  entityId?: string | null;
  title?: string | null;
};

/**
 * Ledger Details header Reminder button → isi page par reminder banane ka popup.
 * Save path Messages → Reminder tab (AlarmsTab) wala hi hai: `buildReminderAlarmData` + `createReminderAlarm`.
 */
export function LedgerReminderDialog({ open, onOpenChange, context, entityId, title }: LedgerReminderDialogProps) {
  const [isProcessing, setIsProcessing] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isProcessing) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        {/* DialogContent band hone par unmount hota hai, isliye har open par form fresh (title prefill, aaj, 10:00 AM). */}
        <LedgerReminderForm
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

function LedgerReminderForm({
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
  const { dateSystem, formatDate } = useDate();

  const [reminderTitle, setReminderTitle] = React.useState(() => String(title ?? "").trim());
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(() => new Date());
  const [selectedHour, setSelectedHour] = React.useState("10");
  const [selectedMinute, setSelectedMinute] = React.useState("00");
  const [selectedPeriod, setSelectedPeriod] = React.useState("AM");
  const [message, setMessage] = React.useState("");

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
        users: [],
        context: context || undefined,
        entityId: context && entityId ? entityId : undefined,
      });
      await createReminderAlarm(companyId, alarmData, user?.uid ?? null);
      toast.success("Reminder Set", { description: `A reminder for "${cleanTitle}" has been scheduled.` });
      setIsProcessing(false);
      onClose();
    } catch {
      toast.error("Failed to set/update reminder.");
      setIsProcessing(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlarmPlus className="h-5 w-5 text-primary" />
          Set New Reminder
        </DialogTitle>
        {context ? (
          <DialogDescription>
            Link to: {context}
            {title ? ` · ${title}` : ""}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="space-y-4">
        <Input
          placeholder="Reminder Title..."
          value={reminderTitle}
          onChange={(e) => setReminderTitle(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2">
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
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onClose} disabled={isProcessing}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isProcessing}>
          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlarmPlus className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
