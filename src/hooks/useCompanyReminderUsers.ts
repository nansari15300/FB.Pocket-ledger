"use client";

import * as React from "react";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";

export type ReminderUserOption = { value: string; label: string };

/**
 * Reminder "users" field = company users ke emails (owner + sharedWith), jaise Messages -> Reminder tab.
 * Default: sirf current user (`[user.email]`), explicit store hota hai. Purane empty records owner ko jaate hain.
 */
export function useCompanyReminderUsers() {
  const { company } = useCompany();
  const { user } = useAuth();
  const myEmail = String(user?.email ?? "").trim();

  const userOptions = React.useMemo<ReminderUserOption[]>(() => {
    const list: ReminderUserOption[] = [];
    const seen = new Set<string>();
    const add = (email: unknown, label: unknown) => {
      const e = String(email ?? "").trim();
      if (!e) return;
      const key = e.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ value: e, label: String(label ?? "").trim() || e });
    };
    if (myEmail) add(myEmail, "You");
    const c = company as any;
    if (c?.ownerEmail) add(c.ownerEmail, "Owner");
    for (const u of (c?.sharedWith || []) as any[]) add(u?.email, u?.name || u?.email);
    return list;
  }, [company, myEmail]);

  const defaultUsers = React.useMemo(() => (myEmail ? [myEmail] : []), [myEmail]);

  const formatUsers = React.useCallback(
    (users?: string[] | null): string => {
      if (!users || users.length === 0) return "Owner";
      return users
        .map((email) => {
          const e = String(email ?? "").trim();
          if (myEmail && e.toLowerCase() === myEmail.toLowerCase()) return "You";
          const opt = userOptions.find((o) => o.value.toLowerCase() === e.toLowerCase());
          return opt?.label || e;
        })
        .join(", ");
    },
    [myEmail, userOptions],
  );

  return { userOptions, defaultUsers, formatUsers, myEmail };
}