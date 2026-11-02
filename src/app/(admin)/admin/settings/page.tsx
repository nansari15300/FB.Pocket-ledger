"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { adminServerWriteBlocked } from "@/lib/adminData/adminServerMode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { adminServerSetDoc, getDocFromServer, isAdminServerDataActive } from "@/lib/pocketbaseData/pbReadSeam";
import { Fingerprint, Loader2, Search } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import PermissionsManager from "@/components/admin/PermissionsManager";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PermissionGroups, type PermissionGroup } from "@/lib/permissions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { firestore } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_VOUCHER_LOAD_SETTINGS,
  normalizeVoucherLoadSettings,
  writeCachedVoucherLoadSettings,
  type VoucherLoadMode,
  type VoucherLoadSettings,
} from "@/lib/voucherLoadModeSettings";
import {
  DEFAULT_GLOBAL_SYNC_MODE_SETTINGS,
  normalizeGlobalSyncModeSettings,
  writeCachedGlobalSyncModeSettings,
  type GlobalSyncMode,
  type GlobalSyncModeSettings,
} from "@/lib/globalSyncModeSettings";
import {
  DEFAULT_ONLINE_DATA_SERVER_SETTINGS,
  DEFAULT_POCKETBASE_SERVER_URL,
  ONLINE_DATA_SERVER_SETTINGS_COLLECTION,
  ONLINE_DATA_SERVER_SETTINGS_ID,
  POCKETBASE_BACKEND_NOT_IMPLEMENTED_MESSAGE,
  getActiveOnlineDataServer,
  normalizeOnlineDataServerSettings,
  pocketBaseUrlDraftValue,
  resolvePocketBaseServerUrl,
  writeCachedOnlineDataServerSettings,
  type OnlineDataServerSettings,
} from "@/lib/onlineDataServer";
import { OnlineDataServerTable } from "@/components/settings/OnlineDataServerTable";

/** Always green track/thumb — All (left) and Lazy load (right); only knob side changes. */
const alwaysGreenSwitchClass = cn(
  "!border-2 !border-green-400 !bg-green-100",
  "data-[state=checked]:!border-green-400 data-[state=checked]:!bg-green-100",
  "data-[state=unchecked]:!border-green-400 data-[state=unchecked]:!bg-green-100",
  "dark:!border-green-500 dark:!bg-green-900/45",
  "dark:data-[state=checked]:!border-green-500 dark:data-[state=checked]:!bg-green-900/45",
  "dark:data-[state=unchecked]:!border-green-500 dark:data-[state=unchecked]:!bg-green-900/45",
  "[&>span:last-child]:!bg-green-400",
  "dark:[&>span:last-child]:!bg-green-400"
);

const VOUCHER_LOAD_HELP = {
  title: "Company voucher data load",
  body:
    "Lazy load — current behaviour: vouchers hydrate by date range (and Company Selector Data tick for a full pull).\n\nAll — on company open, if this device has no full voucher mirror or it is older than 7 days, pull all voucher documents from Firebase into SQLite (data only, not attachment files). Applies to every user after save. Does not change Files sync. Default is Lazy load.",
};

const SYNC_MODE_HELP = {
  title: "Company sync mode",
  body:
    "Delta — SQLite + change feed. Only fetches changed documents. Firebase uses _pl_change_log; Pocket Ledger Server uses pl_change_log. Smooth on low internet.\n\nLive — real-time collection updates across devices in ~300ms. Firebase uses Firestore listeners; Pocket Ledger Server uses collection realtime.\n\nApplies globally to all users and companies after save (Firebase and Pocket Ledger Server).",
};

const ONLINE_DATA_SERVER_HELP = {
  title: "Online data server",
  body:
    "Choose the server where online company data and files are saved. Applies to every user after save; users see it read-only on the Gate page.\n\nFirebase - current cloud backend (Firestore + Storage).\n\nPocket Ledger Server - self-hosted PocketBase. Data sync for it is not built yet: while it is selected, data still saves to Firebase. New online companies record the selected server.",
};

function GlobalSettingsPage() {
  useAdminAccess(["SuperAdmin"]);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeGroup, setActiveGroup] = useState<PermissionGroup>(PermissionGroups[0]);

  const [voucherLoad, setVoucherLoad] = useState<VoucherLoadSettings>(DEFAULT_VOUCHER_LOAD_SETTINGS);
  const [voucherLoadLoading, setVoucherLoadLoading] = useState(true);
  const [voucherLoadSaving, setVoucherLoadSaving] = useState(false);

  const [syncMode, setSyncMode] = useState<GlobalSyncModeSettings>(DEFAULT_GLOBAL_SYNC_MODE_SETTINGS);
  const [syncModeLoading, setSyncModeLoading] = useState(true);
  const [syncModeSaving, setSyncModeSaving] = useState(false);

  const [onlineServer, setOnlineServer] = useState<OnlineDataServerSettings>(DEFAULT_ONLINE_DATA_SERVER_SETTINGS);
  const [onlineServerLoading, setOnlineServerLoading] = useState(true);
  const [onlineServerSaving, setOnlineServerSaving] = useState(false);
  const [pocketbaseUrlDraft, setPocketbaseUrlDraft] = useState(DEFAULT_ONLINE_DATA_SERVER_SETTINGS.pocketbaseUrl);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) return PermissionGroups;
    return PermissionGroups.filter((group) =>
      group.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm]);

  const loadVoucherLoadSettings = useCallback(async () => {
    setVoucherLoadLoading(true);
    try {
      const snap = await getDocFromServer(doc(firestore, "app_settings", "voucher_load"));
      const next = normalizeVoucherLoadSettings(snap.exists() ? snap.data() : undefined);
      setVoucherLoad(next);
      writeCachedVoucherLoadSettings(next);
    } catch {
      setVoucherLoad(DEFAULT_VOUCHER_LOAD_SETTINGS);
      toast({ title: "Could not load voucher load settings", variant: "destructive" });
    } finally {
      setVoucherLoadLoading(false);
    }
  }, [toast]);

  const loadSyncModeSettings = useCallback(async () => {
    setSyncModeLoading(true);
    try {
      const snap = await getDocFromServer(doc(firestore, "app_settings", "sync_mode"));
      const next = normalizeGlobalSyncModeSettings(snap.exists() ? snap.data() : undefined);
      setSyncMode(next);
      writeCachedGlobalSyncModeSettings(next);
    } catch {
      setSyncMode(DEFAULT_GLOBAL_SYNC_MODE_SETTINGS);
      toast({ title: "Could not load sync mode settings", variant: "destructive" });
    } finally {
      setSyncModeLoading(false);
    }
  }, [toast]);

  const loadOnlineDataServerSettings = useCallback(async () => {
    setOnlineServerLoading(true);
    try {
      const snap = await getDocFromServer(
        doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID)
      );
      const next = normalizeOnlineDataServerSettings(snap.exists() ? snap.data() : undefined);
      setOnlineServer(next);
      setPocketbaseUrlDraft(pocketBaseUrlDraftValue(next.pocketbaseUrl));
      writeCachedOnlineDataServerSettings(next);
    } catch {
      setOnlineServer(DEFAULT_ONLINE_DATA_SERVER_SETTINGS);
      setPocketbaseUrlDraft(pocketBaseUrlDraftValue(DEFAULT_ONLINE_DATA_SERVER_SETTINGS.pocketbaseUrl));
      toast({ title: "Could not load online data server settings", variant: "destructive" });
    } finally {
      setOnlineServerLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadVoucherLoadSettings();
    void loadSyncModeSettings();
    void loadOnlineDataServerSettings();
  }, [loadVoucherLoadSettings, loadSyncModeSettings, loadOnlineDataServerSettings]);

  const saveVoucherLoadMode = async (mode: VoucherLoadMode) => {
    const viaServer = isAdminServerDataActive();
    if (!viaServer && adminServerWriteBlocked()) return;
    setVoucherLoadSaving(true);
    const prev = voucherLoad;
    const next: VoucherLoadSettings = {
      ...voucherLoad,
      mode,
      updatedAtMs: Date.now(),
    };
    setVoucherLoad(next);
    try {
      if (viaServer) await adminServerSetDoc("app_settings/voucher_load", next);
      else await setDoc(doc(firestore, "app_settings", "voucher_load"), next, { merge: true });
      writeCachedVoucherLoadSettings(next);
      toast({
        title: "Saved",
        description:
          mode === "all"
            ? "All companies: full voucher data load when missing or older than 7 days."
            : "All companies: lazy load (hydrate by date range) — current behaviour.",
      });
    } catch {
      setVoucherLoad(prev);
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setVoucherLoadSaving(false);
    }
  };

  const saveSyncMode = async (mode: GlobalSyncMode) => {
    const viaServer = isAdminServerDataActive();
    if (!viaServer && adminServerWriteBlocked()) return;
    setSyncModeSaving(true);
    const prev = syncMode;
    const next: GlobalSyncModeSettings = {
      mode,
      updatedAtMs: Date.now(),
    };
    setSyncMode(next);
    try {
      if (viaServer) await adminServerSetDoc("app_settings/sync_mode", next);
      else await setDoc(doc(firestore, "app_settings", "sync_mode"), next, { merge: true });
      writeCachedGlobalSyncModeSettings(next);
      toast({
        title: "Saved",
        description:
          mode === "full_online"
            ? "Global sync mode: Live (real-time collection updates on Firebase and Pocket Ledger Server)."
            : "Global sync mode: Delta (SQLite + change-feed only — low traffic).",
      });
    } catch {
      setSyncMode(prev);
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSyncModeSaving(false);
    }
  };

  const saveOnlineDataServer = async (patch: Partial<Pick<OnlineDataServerSettings, "serverId" | "pocketbaseUrl">>) => {
    const viaServer = isAdminServerDataActive();
    if (!viaServer && adminServerWriteBlocked()) return;
    setOnlineServerSaving(true);
    const prev = onlineServer;
    const next: OnlineDataServerSettings = {
      ...onlineServer,
      ...patch,
      updatedAtMs: Date.now(),
    };
    setOnlineServer(next);
    try {
      if (viaServer) {
        await adminServerSetDoc(`${ONLINE_DATA_SERVER_SETTINGS_COLLECTION}/${ONLINE_DATA_SERVER_SETTINGS_ID}`, next);
      } else {
        await setDoc(doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID), next, {
          merge: true,
        });
      }
      writeCachedOnlineDataServerSettings(next);
      setPocketbaseUrlDraft(pocketBaseUrlDraftValue(next.pocketbaseUrl));
      const server = getActiveOnlineDataServer(next);
      toast({
        title: "Saved",
        description: server.implemented
          ? `Online data server: ${server.name}.`
          : `Online data server: ${server.name}. ${POCKETBASE_BACKEND_NOT_IMPLEMENTED_MESSAGE}`,
      });
    } catch {
      setOnlineServer(prev);
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setOnlineServerSaving(false);
    }
  };

  /** Switch checked = Lazy load (right). Unchecked = All (left). */
  const lazyChecked = voucherLoad.mode === "lazy";

  /** Switch checked = Live (right). Unchecked = Delta (left). */
  const liveChecked = syncMode.mode === "full_online";

  return (
    <div className="flex h-full flex-col gap-3 px-[3px] md:gap-[30px] md:p-[30px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-[30px]">
        {/* Card 1: Company voucher data load */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Company voucher data load</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <AppFreshInfoButton
                    size="sm"
                    aria-label="About voucher load modes"
                    title="Voucher load help"
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[80] w-[min(92vw,22rem)] space-y-2 p-3 text-left" data-pl-intro="">
                  <p className="text-sm font-semibold">{VOUCHER_LOAD_HELP.title}</p>
                  <div className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {VOUCHER_LOAD_HELP.body}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            {voucherLoadLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Label
                  htmlFor="voucher-load-mode-switch"
                  className={cn(
                    "min-w-[2.5rem] cursor-pointer text-sm font-medium",
                    !lazyChecked ? "text-green-700 dark:text-green-300" : "text-muted-foreground"
                  )}
                >
                  All
                </Label>
                <Switch
                  id="voucher-load-mode-switch"
                  checked={lazyChecked}
                  disabled={voucherLoadSaving}
                  onCheckedChange={(checked) => {
                    void saveVoucherLoadMode(checked ? "lazy" : "all");
                  }}
                  aria-label="Voucher load mode: All or Lazy load"
                  className={alwaysGreenSwitchClass}
                />
                <Label
                  htmlFor="voucher-load-mode-switch"
                  className={cn(
                    "cursor-pointer text-sm font-medium",
                    lazyChecked ? "text-green-700 dark:text-green-300" : "text-muted-foreground"
                  )}
                >
                  Lazy load
                </Label>
                {voucherLoadSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Company sync mode (Live / Delta) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Company sync mode</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <AppFreshInfoButton
                    size="sm"
                    aria-label="About company sync modes"
                    title="Company sync help"
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[80] w-[min(92vw,22rem)] space-y-2 p-3 text-left" data-pl-intro="">
                  <p className="text-sm font-semibold">{SYNC_MODE_HELP.title}</p>
                  <div className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {SYNC_MODE_HELP.body}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            {syncModeLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Label
                  htmlFor="company-sync-mode-switch"
                  className={cn(
                    "min-w-[2.5rem] cursor-pointer text-sm font-medium",
                    !liveChecked ? "text-green-700 dark:text-green-300" : "text-muted-foreground"
                  )}
                >
                  Delta
                </Label>
                <Switch
                  id="company-sync-mode-switch"
                  checked={liveChecked}
                  disabled={syncModeSaving}
                  onCheckedChange={(checked) => {
                    void saveSyncMode(checked ? "full_online" : "local");
                  }}
                  aria-label="Company sync mode: Delta or Live"
                  className={alwaysGreenSwitchClass}
                />
                <Label
                  htmlFor="company-sync-mode-switch"
                  className={cn(
                    "cursor-pointer text-sm font-medium",
                    liveChecked ? "text-green-700 dark:text-green-300" : "text-muted-foreground"
                  )}
                >
                  Live
                </Label>
                {syncModeSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 3: Online data server (Firebase / Pocket Ledger Server) */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Online data server</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <AppFreshInfoButton
                    size="sm"
                    aria-label="About online data server"
                    title="Online data server help"
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[80] w-[min(92vw,22rem)] space-y-2 p-3 text-left" data-pl-intro="">
                  <p className="text-sm font-semibold">{ONLINE_DATA_SERVER_HELP.title}</p>
                  <div className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {ONLINE_DATA_SERVER_HELP.body}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <CardDescription>Where online company data and files are saved for all users.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {onlineServerLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading.
              </div>
            ) : (
              <>
                <OnlineDataServerTable
                  settings={onlineServer}
                  onSelect={(id) => {
                    if (id !== onlineServer.serverId) void saveOnlineDataServer({ serverId: id });
                  }}
                  disabled={onlineServerSaving}
                  idPrefix="admin-online-data-server"
                />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[14rem] flex-1 space-y-1">
                    <Label htmlFor="admin-pocketbase-url" className="text-xs">
                      Pocket Ledger Server URL
                    </Label>
                    <Input
                      id="admin-pocketbase-url"
                      value={pocketbaseUrlDraft}
                      onChange={(e) => setPocketbaseUrlDraft(e.target.value)}
                      placeholder={resolvePocketBaseServerUrl(DEFAULT_ONLINE_DATA_SERVER_SETTINGS)}
                      disabled={onlineServerSaving}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      onlineServerSaving ||
                      (pocketbaseUrlDraft.trim() || DEFAULT_POCKETBASE_SERVER_URL) === onlineServer.pocketbaseUrl
                    }
                    onClick={() => {
                      void saveOnlineDataServer({
                        pocketbaseUrl: pocketbaseUrlDraft.trim() || DEFAULT_POCKETBASE_SERVER_URL,
                      });
                    }}
                  >
                    Save URL
                  </Button>
                  {onlineServerSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid h-full grid-cols-1 gap-3 md:gap-[30px] md:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-3 md:gap-[30px]">
          <Card>
            <CardHeader>
              <CardTitle>Global Settings</CardTitle>
              <CardDescription>Manage system-wide configurations.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search permission groups..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2">
              <ScrollArea className="h-[calc(100vh-28rem)]">
                {filteredGroups.map((group) => (
                  <Button
                    key={group.title}
                    variant={activeGroup.title === group.title ? "secondary" : "ghost"}
                    className="w-full justify-start gap-3"
                    onClick={() => setActiveGroup(group)}
                  >
                    <Fingerprint className="h-5 w-5" />
                    <span>{group.title}</span>
                  </Button>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card className="h-full">
            <CardContent className="p-6">
              {activeGroup ? (
                <PermissionsManager selectedGroup={activeGroup} />
              ) : (
                <p>Select a group to manage permissions.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default GlobalSettingsPage;
