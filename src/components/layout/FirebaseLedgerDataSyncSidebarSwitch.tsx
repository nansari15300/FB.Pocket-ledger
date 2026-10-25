"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Cloud } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  FIREBASE_LEDGER_DATA_SYNC_DISABLED_FORCE,
  isFirebaseLedgerDataSyncEnabled,
  setFirebaseLedgerDataSyncEnabled,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import { requestOnlineCompanyRegistryPull } from "@/lib/mirrorOnlineCompaniesFromFirestore";
import { isServerOnlyLoginSession } from "@/lib/pocketbaseData/serverSessionCompanyScope";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  sidebarOpen: boolean;
};

/**
 * Sidebar: Cloud data sync on/off — web + static/EXE/APK.
 * Off = ledger Firestore upload/download band; plan sync chalu.
 */
export function FirebaseLedgerDataSyncSidebarSwitch({ sidebarOpen }: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(() => isFirebaseLedgerDataSyncEnabled());
  const locked = FIREBASE_LEDGER_DATA_SYNC_DISABLED_FORCE !== null;
  const toggleLockRef = useRef(false);

  const applyEnabled = useCallback((next: boolean) => {
    setEnabled(next);
  }, []);

  const refresh = useCallback(() => {
    applyEnabled(isFirebaseLedgerDataSyncEnabled());
  }, [applyEnabled]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ disabled?: boolean }>).detail;
      if (detail && typeof detail.disabled === "boolean") {
        applyEnabled(!detail.disabled);
        return;
      }
      refresh();
    };
    refresh();
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onChange);
    };
  }, [applyEnabled, refresh]);

  const onCheckedChange = useCallback(
    (next: boolean) => {
      if (locked || toggleLockRef.current) return;
      if (next === isFirebaseLedgerDataSyncEnabled()) return;

      toggleLockRef.current = true;
      setFirebaseLedgerDataSyncEnabled(next);
      applyEnabled(next);
      if (next) {
        requestOnlineCompanyRegistryPull();
      }
      toast({
        title: next ? "Cloud data sync ON" : "Cloud data sync OFF",
        description: next
          ? isServerOnlyLoginSession()
            ? "Online companies come from the Pocket Ledger Server in this session."
            : "Company list pulled from Firebase. Online tab me tick karke data / files sync chuniye."
          : "Ledger + attachments stay on this device. Plan sync still works.",
      });
      window.setTimeout(() => {
        toggleLockRef.current = false;
      }, 350);
    },
    [applyEnabled, locked, toast]
  );

  const title = enabled
    ? "Cloud data sync ON — ledger + attachment upload/download"
    : "Cloud data sync OFF — local SQLite only (no Firebase Storage calls)";

  if (!sidebarOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-center rounded-md px-2 py-2 text-sidebar-foreground",
              "hover:bg-sidebar-accent",
              locked && "opacity-60 cursor-not-allowed"
            )}
            aria-label={title}
            title={title}
            disabled={locked}
            onClick={() => onCheckedChange(!enabled)}
          >
            {enabled ? <Cloud className="size-5" /> : <CloudOff className="size-5 text-amber-600" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2",
        !enabled && "bg-amber-500/10"
      )}
      title={title}
    >
      {enabled ? (
        <Cloud className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <CloudOff className="size-4 shrink-0 text-amber-600" />
      )}
      <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-sidebar-foreground">
        Cloud data sync
      </span>
      <Switch
        checked={enabled}
        onCheckedChange={onCheckedChange}
        disabled={locked}
        aria-label={title}
      />
    </div>
  );
}

/** Company unlock / credential dialog — sidebar jaisa toggle, compact row. */
export function FirebaseLedgerDataSyncInlineSwitch({ className }: { className?: string }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(() => isFirebaseLedgerDataSyncEnabled());
  const locked = FIREBASE_LEDGER_DATA_SYNC_DISABLED_FORCE !== null;

  useEffect(() => {
    const onChange = () => setEnabled(isFirebaseLedgerDataSyncEnabled());
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onChange);
  }, []);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5",
        className
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-none">Cloud data sync</p>
        <p className="text-xs text-muted-foreground leading-snug">
          {enabled
            ? isServerOnlyLoginSession()
              ? "Online ledger loads from the Pocket Ledger Server."
              : "Online ledger Firestore se load hoga."
            : "Abhi OFF — unlock ke baad data nahi aayega jab tak ON na karein."}
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={locked}
        onCheckedChange={(next) => {
          if (locked || next === enabled) return;
          setFirebaseLedgerDataSyncEnabled(next);
          setEnabled(next);
          if (next) {
            requestOnlineCompanyRegistryPull();
          }
          toast({
            title: next ? "Cloud data sync ON" : "Cloud data sync OFF",
            description: next
              ? isServerOnlyLoginSession()
                ? "Online companies come from the Pocket Ledger Server in this session."
                : "Company list Firebase se aayegi. Online tab me company + Data / Files tick karein."
              : "Sirf local SQLite — online upload/download band.",
          });
        }}
        aria-label="Cloud data sync"
      />
    </div>
  );
}
