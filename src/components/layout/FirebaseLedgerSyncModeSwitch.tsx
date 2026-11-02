"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT,
  setFirebaseLedgerSyncMode,
  type FirebaseLedgerSyncMode,
} from "@/lib/firebaseLedgerSyncMode";
import { resolveFirebaseLedgerSyncPolicy } from "@/lib/firebaseLedgerSyncPolicy";

type Props = {
  sidebarOpen: boolean;
  compact?: boolean;
};

const RULE_TEXT =
  "deltaa: SQLite first on every platform (web/EXE/APK/iOS). Saves queue to Firebase; remote edits use only the _pl_change_log feed (no collection live listeners). live: full Firebase collection listeners — higher read cost. Mode can later be forced from Admin → plan settings.";

export function FirebaseLedgerSyncModeSwitch({ sidebarOpen, compact }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<FirebaseLedgerSyncMode>("local");
  const [allowSwitch, setAllowSwitch] = useState(true);

  const refresh = useCallback(() => {
    const policy = resolveFirebaseLedgerSyncPolicy();
    setMode((prev) => (prev === policy.syncMode ? prev : policy.syncMode));
    setAllowSwitch((prev) => (prev === policy.allowUserModeSwitch ? prev : policy.allowUserModeSwitch));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  const fullOnline = mode === "full_online";
  const title = fullOnline
    ? "live: Firebase collection listeners"
    : "deltaa: SQLite + change-feed only (no collection snapshots)";

  const onCheckedChange = (checked: boolean) => {
    if (!allowSwitch) {
      toast({
        title: "Sync mode locked",
        description: "Your plan controls deltaa/live. Change it in Admin plan settings when available.",
        variant: "destructive",
      });
      return;
    }
    const next: FirebaseLedgerSyncMode = checked ? "full_online" : "local";
    setFirebaseLedgerSyncMode(next);
    setMode(next);
    toast({
      title: next === "local" ? "deltaa mode" : "live mode",
      description:
        next === "local"
          ? "Collection snapshots off. Only _pl_change_log detects remote edits."
          : "Full online Firebase collection listeners are active.",
    });
  };

  if (!sidebarOpen) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center rounded-md px-2 py-2 text-sidebar-foreground hover:bg-sidebar-accent"
        aria-label={title}
        title={title}
        onClick={() => onCheckedChange(!fullOnline)}
      >
        <span className="text-[10px] font-semibold text-emerald-700">{fullOnline ? "live" : "deltaa"}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md bg-emerald-500/10 px-2 py-2",
        compact ? "space-y-1" : "space-y-1.5"
      )}
      title={title}
    >
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
        <span
          className={cn(
            "truncate text-[11px]",
            !fullOnline ? "font-semibold text-emerald-700" : "text-muted-foreground"
          )}
        >
          deltaa
        </span>
        <Switch
          checked={fullOnline}
          onCheckedChange={onCheckedChange}
          disabled={!allowSwitch}
          aria-label={title}
          className={cn(
            "w-[64px]",
            // Dono sides green track + knob
            "!border-green-300 !bg-green-100/80",
            "data-[state=checked]:!border-green-300 data-[state=checked]:!bg-green-100/80",
            "data-[state=unchecked]:!border-green-300 data-[state=unchecked]:!bg-green-100/80",
            "dark:!border-green-700 dark:!bg-green-900/40",
            "dark:data-[state=checked]:!border-green-700 dark:data-[state=checked]:!bg-green-900/40",
            "[&>span:last-child]:!bg-green-400"
          )}
        />
        <span
          className={cn(
            "truncate text-right text-[11px]",
            fullOnline ? "font-semibold text-emerald-700" : "text-muted-foreground"
          )}
        >
          live
        </span>
        <button
          type="button"
          className="rounded-full p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground"
          aria-label="Sync mode rules"
          title={RULE_TEXT}
          data-pl-intro=""
        >
          <Info className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
