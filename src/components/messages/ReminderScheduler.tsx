"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import {
  fireDueReminder,
  reminderDueMs,
  subscribePendingReminders,
  type ReminderAlarm,
} from "@/components/messages/AlarmsTab";

/** Har 5 sec current time se due check (notifyAt ?? datetime <= now). */
const DUE_RECHECK_MS = 5 * 1000;

/**
 * App-wide reminder firing (dashboard layout me AlarmPopup ke saath mount).
 * Pehle ye loop sirf Messages page par chalta tha. Ab har screen par: due reminder claim-first
 * (`notified:true`) hota hai, phir admin_notifications banta hai jise global AlarmPopup dikhata hai.
 * Data code `AlarmsTab.tsx` ke exported helpers me hai (is file me koi firebase / pbCompat import nahi).
 */
export function ReminderScheduler() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { userNames } = useVouchers();
  const [pending, setPending] = React.useState<ReminderAlarm[]>([]);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const inFlightRef = React.useRef<Set<string>>(new Set());
  const ownerIdRef = React.useRef<string | null>(null);
  const userNamesRef = React.useRef<Record<string, string> | undefined>(undefined);
  ownerIdRef.current = ((company as any)?.ownerId as string | undefined) ?? null;
  userNamesRef.current = userNames;

  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), DUE_RECHECK_MS);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (!companyId || !user?.uid) {
      setPending([]);
      return;
    }
    const unsub = subscribePendingReminders(companyId, (list) => {
      setPending(list);
      setNowMs(Date.now());
    });
    return () => unsub();
  }, [companyId, user?.uid]);

  React.useEffect(() => {
    if (!companyId || !user?.uid) return;
    const due = pending.filter((a) => {
      if (inFlightRef.current.has(a.id)) return false;
      const dueMs = reminderDueMs(a);
      return Number.isFinite(dueMs) && dueMs <= nowMs;
    });
    if (due.length === 0) return;
    for (const a of due) inFlightRef.current.add(a.id);
    void (async () => {
      let fired = 0;
      for (const a of due) {
        try {
          const ok = await fireDueReminder(companyId, a, {
            ownerId: ownerIdRef.current,
            createdByName: (uid) => (uid ? userNamesRef.current?.[uid] || uid : null),
          });
          if (ok) fired += 1;
        } catch {
          // Agli 5 sec check par dobara koshish (claim nahi hua to).
        } finally {
          inFlightRef.current.delete(a.id);
        }
      }
      if (fired > 0) toast.info(`${fired} reminder(s) are due! Check your alerts.`);
    })();
  }, [pending, nowMs, companyId, user?.uid]);

  return null;
}