"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT,
} from "@/lib/firebaseLedgerSyncMode";
import { ensureGlobalSyncModeSettingsHydrated } from "@/lib/globalSyncModeSettings";
import {
  DELTA_FIRESTORE_LISTENERS,
  FIRESTORE_LISTENER_TOGGLES_EVENT,
  LIVE_FIRESTORE_LISTENERS,
  adminSyncModeTab,
  isFirestoreListenerEnabled,
  setFirestoreListenerEnabled,
  type FirestoreListenerDef,
  type FirestoreListenerTab,
} from "@/lib/firestoreListenerToggles";

function ListenerRows({ items }: { items: FirestoreListenerDef[] }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const onToggle = () => bump((n) => n + 1);
    window.addEventListener(FIRESTORE_LISTENER_TOGGLES_EVENT, onToggle);
    return () => window.removeEventListener(FIRESTORE_LISTENER_TOGGLES_EVENT, onToggle);
  }, []);

  return (
    <ul className="divide-y rounded-md border">
      {items.map((item) => {
        const on = isFirestoreListenerEnabled(item.id);
        return (
          <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <p className="text-xs text-muted-foreground">{item.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              <Label htmlFor={item.id} className="text-xs text-muted-foreground">
                {on ? "On" : "Off"}
              </Label>
              <Switch
                id={item.id}
                checked={on}
                onCheckedChange={(checked) => setFirestoreListenerEnabled(item.id, checked)}
                aria-label={`${item.label} listener`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FirestoreListenerTogglePanel({ embedded }: { embedded?: boolean } = {}) {
  const [adminTab, setAdminTab] = useState<FirestoreListenerTab>(() =>
    typeof window === "undefined" ? "live" : adminSyncModeTab()
  );
  const [viewTab, setViewTab] = useState<FirestoreListenerTab>(adminTab);

  useEffect(() => {
    void ensureGlobalSyncModeSettingsHydrated().then(() => {
      const next = adminSyncModeTab();
      setAdminTab(next);
      setViewTab(next);
    });
    const sync = () => {
      const next = adminSyncModeTab();
      setAdminTab(next);
    };
    window.addEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, sync);
  }, []);

  const inUse = viewTab === adminTab;
  const items = viewTab === "live" ? LIVE_FIRESTORE_LISTENERS : DELTA_FIRESTORE_LISTENERS;

  return (
    <div className={cn("space-y-3", !embedded && "rounded-md border p-3")}>
      {embedded ? null : (
      <div>
        <h3 className="text-sm font-semibold">Firestore listeners</h3>
        <p className="text-xs text-muted-foreground">
          Admin Global Settings chooses Live or Delta for the whole app. Open the other tab to
          see its list — it stays not in use until Admin switches mode.
        </p>
      </div>
      )}
      <div className="flex gap-1 rounded-md bg-muted/60 p-1">
        {(["live", "delta"] as const).map((tab) => {
          const selected = viewTab === tab;
          const isAdmin = adminTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setViewTab(tab)}
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-sm font-medium",
                selected ? "bg-background" : "text-muted-foreground"
              )}
            >
              {tab === "live" ? "Live" : "Delta"}
              {isAdmin ? (
                <span className="ml-2 text-[10px] font-normal text-green-700 dark:text-green-400">
                  in use
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!inUse ? (
        <p className="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Not in use. Admin mode is {adminTab === "live" ? "Live" : "Delta"}. Switches here are
          saved, but these listeners do not run until Admin turns this mode on.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          These listeners are running now (if their switch is On). Off unbinds that Firestore
          snapshot on this device.
        </p>
      )}
      <ListenerRows items={items} />
    </div>
  );
}
