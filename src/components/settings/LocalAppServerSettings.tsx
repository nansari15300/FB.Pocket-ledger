"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useLivePlans } from "@/hooks/useLivePlans";
import { getPlan, type PlanId } from "@/config/plans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { resolveLocalAppServerAllowed } from "@/lib/localAppServerEntitlement";
import {
  getElectronLocalServerApi,
  resolveLocalAppServerSharingPort,
  type LocalAppServerConfig,
  type LocalAppServerRole,
  type LocalAppServerStatus,
} from "@/lib/electronLocalServer";
import { LocalPlServerSharePanel } from "@/components/settings/LocalPlServerSharePanel";
import { LocalPlServerSharedCompaniesPicker } from "@/components/settings/LocalPlServerSharedCompaniesPicker";
import { SettingsInfoTip, SettingsLabelWithInfo } from "@/components/settings/SettingsInfoTip";
import { isLocalAppServerDevPreview, isBrowserLoopbackDevHost } from "@/lib/localAppServerDevPreview";
import {
  buildPlServerInviteUrlList,
  effectiveSelectedInviteUrls,
  filterPlServerInviteUrlsForRemoteListing,
  isPlServerInviteUrlSelected,
  normalizePlServerListingUrl,
  normalizePublicHostField,
} from "@/lib/plServerPublicHostUrl";
import { fetchPublicIpAddress } from "@/lib/fetchPublicIpAddress";
import { persistDevClientAccessToken } from "@/lib/plServerAccessContext";
import { rememberPlServerPortsFromStatus } from "@/lib/plSharingPortRegistry";
import { normalizeSharedLocalCompanyIds } from "@/lib/plServerHostSharedCompanyIds";
import { Copy, Loader2, RefreshCw, Server } from "lucide-react";
import { cn } from "@/lib/utils";

/** Server page — Backup & Restore jaisa green / sky tone cards. */
const serverCardSoftSkyBorderCn = "pl-backup-soft-box pl-backup-soft-box-sky rounded-lg";
const serverCardSoftGreenBorderCn = "pl-backup-soft-box pl-backup-soft-box-emerald rounded-lg";
const serverCardToneGreenCn = "pl-dashboard-tone-card pl-dashboard-ribbon-emerald shadow-none";
const serverCardToneSkyCn = "pl-dashboard-tone-card pl-dashboard-ribbon-sky shadow-none";

export function LocalAppServerSettings() {
  const { toast } = useToast();
  const { user, customUser } = useAuth();
  const { allCompanies, allCompaniesRegistry } = useCompany();
  const livePlansRecord = useLivePlans();
  const [status, setStatus] = useState<LocalAppServerStatus | null>(null);
  const [draft, setDraft] = useState<LocalAppServerConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publicIpDetecting, setPublicIpDetecting] = useState(false);
  const publicHostUserEditedRef = useRef(false);
  const publicHostDetectGenRef = useRef(0);

  const planId = resolveEffectiveAccountPlanId(allCompanies, user?.uid, null);
  const livePlan = livePlansRecord[planId as PlanId] ?? getPlan(planId);
  const allowed = resolveLocalAppServerAllowed({
    planId,
    livePlan,
    customUser: customUser as Record<string, unknown> | null,
  });
  const devMode = isLocalAppServerDevPreview();
  const loopbackWeb = isBrowserLoopbackDevHost();
  const [apiAvailable, setApiAvailable] = useState(false);
  const [apiProbing, setApiProbing] = useState(true);
  const [plServerUsersCompanyId, setPlServerUsersCompanyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof window !== "undefined" && (window as unknown as { plElectronLocalServer?: unknown }).plElectronLocalServer) {
        if (!cancelled) {
          setApiAvailable(true);
          setApiProbing(false);
        }
        return;
      }
      if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_PL_DEV_LOCAL_SERVER === "1") {
        if (!cancelled) {
          setApiAvailable(true);
          setApiProbing(false);
        }
        return;
      }
      if (!loopbackWeb) {
        if (!cancelled) setApiProbing(false);
        return;
      }
      try {
        const res = await fetch("/api/dev-pl-local-server", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getStatus" }),
        });
        if (!cancelled) setApiAvailable(res.ok);
      } catch {
        if (!cancelled) setApiAvailable(false);
      } finally {
        if (!cancelled) setApiProbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loopbackWeb]);

  const isServerRole = draft?.appRole === "server" || draft?.appRole === "both";

  const plServerUsersCompanyName = useMemo(() => {
    if (!plServerUsersCompanyId) return "";
    return (
      allCompaniesRegistry.find((c) => c.id === plServerUsersCompanyId)?.name || plServerUsersCompanyId
    );
  }, [allCompaniesRegistry, plServerUsersCompanyId]);

  const inviteUrlOptions = useMemo(() => {
    if (!status || !draft || !isServerRole) return [] as string[];
    const port = resolveLocalAppServerSharingPort(status);
    if (!port) return [];
    return buildPlServerInviteUrlList({
      urls: status.urls,
      publicHost: draft.publicHost,
      port,
    });
  }, [status, draft, isServerRole]);

  const inviteUrlDisplayOptions = useMemo(
    () => filterPlServerInviteUrlsForRemoteListing(inviteUrlOptions),
    [inviteUrlOptions]
  );

  const toggleInviteUrlSelection = useCallback(
    (url: string, checked: boolean) => {
      if (!draft) return;
      const current = effectiveSelectedInviteUrls(inviteUrlOptions, draft.selectedInviteUrls);
      const norm = normalizePlServerListingUrl(url);
      if (!norm) return;
      let next: string[];
      if (checked) {
        next = [...new Set([...current, norm])];
      } else {
        next = current.filter((u) => normalizePlServerListingUrl(u) !== norm);
      }
      if (next.length === 0) {
        toast({
          variant: "destructive",
          title: "At least one address required",
          description: "Share invites ke liye kam se kam ek server address tick hona chahiye.",
        });
        return;
      }
      setDraft((d) => (d ? { ...d, selectedInviteUrls: next } : d));
      const api = getElectronLocalServerApi();
      void api?.setConfig({ selectedInviteUrls: next }).catch(() => undefined);
    },
    [draft, inviteUrlOptions, toast]
  );

  const autoDetectPublicHost = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!draft || !isServerRole) return null;
      if (draft.bindMode === "localhost") return null;
      if (!opts?.force && publicHostUserEditedRef.current) return null;
      if (!opts?.force && draft.publicHost.trim()) return draft.publicHost.trim();
      if (typeof navigator !== "undefined" && !navigator.onLine) return null;

      const gen = ++publicHostDetectGenRef.current;
      setPublicIpDetecting(true);
      try {
        const ip = await fetchPublicIpAddress();
        if (gen !== publicHostDetectGenRef.current) return null;
        if (!ip) return null;
        if (!opts?.force && publicHostUserEditedRef.current) return null;
        setDraft((d) => {
          if (!d || !ip) return d;
          if (!opts?.force && d.publicHost.trim()) return d;
          return { ...d, publicHost: ip };
        });
        return ip;
      } finally {
        if (gen === publicHostDetectGenRef.current) setPublicIpDetecting(false);
      }
    },
    [draft, isServerRole]
  );

  useEffect(() => {
    if (loading || !draft || !isServerRole) return;
    if (draft.bindMode === "localhost") return;
    if (draft.publicHost.trim()) return;
    const timer = window.setTimeout(() => {
      void autoDetectPublicHost();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, draft, isServerRole, autoDetectPublicHost]);

  const refresh = useCallback(async () => {
    const api = getElectronLocalServerApi();
    if (!api) {
      setLoading(false);
      return;
    }
    try {
      const [st, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);
      rememberPlServerPortsFromStatus(st);
      setStatus(st);
      setDraft(cfg);
      publicHostUserEditedRef.current = Boolean(cfg.publicHost?.trim());
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not read server settings",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: label });
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  };

  if (apiProbing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server
          </CardTitle>
          <CardDescription>Checking local server bridge…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!apiAvailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server
          </CardTitle>
          <CardDescription>
            Browser web dev: run <code className="text-xs">npm run dev</code> on this PC (Next.js with API routes),
            then open <code className="text-xs">http://localhost:3000</code> — static-only side servers cannot host
            Settings → Server. Packaged app: use Pocket Ledger EXE / Linux.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server
          </CardTitle>
          <CardDescription>
            Your plan does not include the local server feature, or an administrator has turned it off for your
            account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/billing">View plans</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const saveAndRestart = () =>
    void run(async () => {
      const api = getElectronLocalServerApi();
      if (!api || !draft) return;
      if (devMode) {
        persistDevClientAccessToken("");
      }
      let publicHost = normalizePublicHostField(draft.publicHost, draft.port);
      if (!publicHost && draft.bindMode !== "localhost") {
        const detected = await fetchPublicIpAddress();
        if (detected) publicHost = detected;
      }
      const result = (await api.restart({
        port: draft.port,
        bindMode: draft.bindMode,
        autoStartOnBoot: draft.autoStartOnBoot,
        userWantsRunning: true,
        appRole: draft.appRole,
        remoteServerUrl: draft.remoteServerUrl,
        clientAccessToken: "",
        publicHost,
        requireRemoteAccessToken: false,
        selectedInviteUrls: draft.selectedInviteUrls,
        sharedLocalCompanyIds: normalizeSharedLocalCompanyIds(draft.sharedLocalCompanyIds),
        showServerSwitchInHeader: draft.showServerSwitchInHeader === true,
      })) as { status?: LocalAppServerStatus };
      if (result?.status) {
        setStatus(result.status);
      }
      window.dispatchEvent(new Event("pl-server-header-switch-config-changed"));
      toast({
        title: "Saved",
        description: "Reload tabs if pages do not refresh.",
      });
    });

  const saveNetworkAndBootSettings = () =>
    void run(async () => {
      const api = getElectronLocalServerApi();
      if (!api || !draft) return;
      let publicHost = normalizePublicHostField(draft.publicHost, draft.port);
      if (!publicHost && draft.bindMode !== "localhost") {
        const detected = await fetchPublicIpAddress();
        if (detected) {
          publicHost = detected;
          setDraft((d) => (d ? { ...d, publicHost: detected } : d));
        }
      }
      await api.setConfig({
        autoStartOnBoot: draft.autoStartOnBoot,
        publicHost,
        selectedInviteUrls: draft.selectedInviteUrls,
      });
      toast({
        title: "Saved",
        description: draft.autoStartOnBoot
          ? "Public address and auto-start on PC restart are saved."
          : "Public address saved. Auto-start on PC restart is off.",
      });
    });

  const saveServerSetupSettings = () =>
    void run(async () => {
      const api = getElectronLocalServerApi();
      if (!api || !draft) return;
      const result = await api.restart({
        appRole: draft.appRole,
        port: draft.port,
        bindMode: draft.bindMode,
        showServerSwitchInHeader: draft.showServerSwitchInHeader === true,
      });
      if (result.status) setStatus(result.status);
      window.dispatchEvent(new Event("pl-server-header-switch-config-changed"));
      toast({ title: "Server setup saved" });
    });

  const serverSharingButtons = isServerRole ? (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={busy || (status?.sharingActive ?? status?.running)}
        onClick={() =>
          void run(async () => {
            const api = getElectronLocalServerApi();
            if (!api) return;
            await api.start();
            toast({ title: "Server started" });
          })
        }
      >
        Start server
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={busy || !(status?.sharingActive ?? status?.running)}
        onClick={() =>
          void run(async () => {
            const api = getElectronLocalServerApi();
            if (!api) return;
            await api.stop();
            toast({ title: "Server stopped" });
          })
        }
      >
        Stop sharing
      </Button>
    </>
  ) : null;

  const saveSettingsButton = (
    <Button type="button" disabled={busy} onClick={saveAndRestart}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Save settings{isServerRole ? " & restart server" : ""}
    </Button>
  );

  const topBottomActionBar =
    !loading && draft ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {isServerRole ? (
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <Checkbox
              checked={draft.showServerSwitchInHeader === true}
              onCheckedChange={(checked) =>
                setDraft((current) =>
                  current ? { ...current, showServerSwitchInHeader: checked === true } : current
                )
              }
            />
            <span>Add switch on header</span>
          </label>
        ) : null}
        {serverSharingButtons}
        {saveSettingsButton}
      </div>
    ) : null;

  return (
    <div className="min-w-0 overflow-x-hidden space-y-4" data-pl-server-settings>
      <div className="hidden max-md:sr-only md:flex md:flex-wrap md:items-start md:justify-between md:gap-x-4 md:gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
            <Server className="h-5 w-5" />
            Server
            <SettingsInfoTip
              label="Server"
              description="Host local companies from this PC and share users by Gmail."
            />
          </h2>
        </div>
        {!loading && draft ? topBottomActionBar : null}
      </div>

      {loading || !draft ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2 md:items-stretch md:gap-6">
            <Card className={cn("flex h-full min-w-0 flex-col overflow-hidden", serverCardToneGreenCn)}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Server setup</CardTitle>
                <CardDescription>Role, port, and listen mode for this PC.</CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 space-y-3">
                {isServerRole ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        status?.running
                          ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"
                          : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                      }
                    >
                      {status?.sharingActive ?? status?.running
                        ? `Sharing on — port ${status.port}`
                        : status?.appUiServing
                          ? `This PC only (sharing off) — port ${status.port}`
                          : "Stopped"}
                    </span>
                    {status?.port &&
                    status?.configuredPort &&
                    status.port !== status.configuredPort ? (
                      <span className="text-xs text-amber-800">
                        Running on {status.port} (saved port {status.configuredPort} was busy — Save &amp;
                        restart again after freeing {status.configuredPort})
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className={cn(serverCardSoftGreenBorderCn, "space-y-3 p-3 sm:p-4")}>
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-4">
                    <div className="flex w-fit max-w-full shrink-0 flex-col gap-1.5">
                      <SettingsLabelWithInfo
                        label="This app runs as"
                        infoLabel="This app runs as"
                        infoDescription="Choose Server only or Server + normal app to host companies on this PC."
                        labelClassName="whitespace-nowrap text-xs sm:text-sm"
                      />
                      <select
                        className="h-9 w-max max-w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                        value={draft.appRole === "client" ? "server" : draft.appRole}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, appRole: e.target.value as LocalAppServerRole } : d
                          )
                        }
                      >
                        <option value="server">Server only (host for others)</option>
                        <option value="both">Server + normal app</option>
                      </select>
                    </div>

                    {isServerRole ? (
                      <>
                        <div className="min-w-[min(100%,5.5rem)] flex-1 basis-[5.5rem] space-y-1.5 sm:max-w-[7rem]">
                          <SettingsLabelWithInfo
                            htmlFor="pl-server-port"
                            label="Port"
                            infoLabel="Port"
                            infoDescription={
                              <>
                                Change port here, then <strong>Save settings &amp; restart server</strong> below. Status
                                badge shows the real listening port (use that in Gate / APK).
                              </>
                            }
                            labelClassName="text-xs sm:text-sm"
                          />
                          <Input
                            id="pl-server-port"
                            type="number"
                            min={1024}
                            max={65535}
                            className="h-9"
                            value={draft.port}
                            onChange={(e) =>
                              setDraft((d) =>
                                d ? { ...d, port: Math.min(65535, Math.max(1, Number(e.target.value) || 3000)) } : d
                              )
                            }
                          />
                        </div>

                        <div className="min-w-[min(100%,10rem)] flex-1 basis-[10rem] space-y-1.5 sm:max-w-[14rem]">
                          <Label className="text-xs sm:text-sm">Listen on</Label>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                            value={draft.bindMode}
                            onChange={(e) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      bindMode:
                                        e.target.value === "lan"
                                          ? "lan"
                                          : e.target.value === "internet"
                                            ? "internet"
                                            : "localhost",
                                    }
                                  : d
                              )
                            }
                          >
                            <option value="localhost">This PC only</option>
                            <option value="lan">LAN (same network)</option>
                            <option value="internet">Internet (LAN + port forward)</option>
                          </select>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" size="sm" className="h-9" disabled={busy} onClick={saveServerSetupSettings}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isServerRole ? (
              <Card className={cn("flex h-full min-w-0 flex-col overflow-hidden", serverCardToneSkyCn)}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Network &amp; access</CardTitle>
                  <CardDescription>Public address, auto-start, and share invite URLs.</CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3">
                  <div className={cn(serverCardSoftSkyBorderCn, "space-y-4 p-3 sm:p-4")}>
                    <div className="flex flex-wrap items-end gap-x-3 gap-y-4">
                      <div className="min-w-[min(100%,12rem)] flex-1 basis-0 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <SettingsLabelWithInfo
                            htmlFor="pl-public-host"
                            label="Public hostname or IP (port forward)"
                            infoLabel="Public hostname or IP"
                            infoDescription={
                              <>
                                <p>Used in share invites. Edit only if you use DDNS instead of raw IP.</p>
                                {status?.portForwardHint ? (
                                  <p className="mt-2">{status.portForwardHint}</p>
                                ) : (
                                  <p className="mt-2">
                                    Router me TCP port forward: external port → this PC LAN IP + server port. Firewall me
                                    port allow karein.
                                  </p>
                                )}
                                {draft.bindMode === "localhost" ? (
                                  <p className="mt-2">
                                    Choose LAN or Internet above to auto-fill your public IP for remote share invites.
                                  </p>
                                ) : null}
                                {!draft.publicHost.trim() && draft.bindMode !== "localhost" ? (
                                  <p className="mt-2">Will auto-detect on save when this field is empty.</p>
                                ) : null}
                              </>
                            }
                          />
                          {draft.bindMode !== "localhost" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={busy || publicIpDetecting}
                              onClick={() => {
                                publicHostUserEditedRef.current = false;
                                setDraft((d) => (d ? { ...d, publicHost: "" } : d));
                                void autoDetectPublicHost({ force: true });
                              }}
                            >
                              {publicIpDetecting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {publicIpDetecting ? "Detecting…" : "Detect public IP"}
                            </Button>
                          ) : null}
                        </div>
                        <Input
                          id="pl-public-host"
                          className="h-9"
                          placeholder={
                            draft.bindMode === "localhost"
                              ? "Enable LAN or Internet listen mode for auto-detect"
                              : publicIpDetecting
                                ? "Detecting your public IP…"
                                : "Auto-detected when empty — or enter DDNS hostname"
                          }
                          value={draft.publicHost}
                          onChange={(e) => {
                            publicHostUserEditedRef.current = true;
                            setDraft((d) => (d ? { ...d, publicHost: e.target.value } : d));
                          }}
                        />
                        {publicIpDetecting ? (
                          <p className="text-xs text-muted-foreground">
                            Looking up your public IPv4 (ipify / AWS checkip)…
                          </p>
                        ) : null}
                      </div>

                      <div className="flex min-w-[min(100%,12rem)] flex-1 basis-0 flex-col gap-1.5">
                        <SettingsLabelWithInfo
                          htmlFor="pl-auto-start"
                          label="Auto-start when PC restarts"
                          infoLabel="Auto-start when PC restarts"
                          infoDescription="App opens at Windows login and the local sharing server starts automatically after each app launch (including after installing a new build). Code and disk caches reset on version update."
                          labelClassName="text-xs sm:text-sm"
                        />
                        <div className="flex h-9 w-full items-center justify-center rounded-md border px-3">
                          <Switch
                            id="pl-auto-start"
                            checked={draft.autoStartOnBoot}
                            onCheckedChange={(v) =>
                              setDraft((d) =>
                                d ? { ...d, autoStartOnBoot: v, ...(v ? { userWantsRunning: true } : {}) } : d
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {inviteUrlDisplayOptions.length > 0 ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-foreground">Server addresses</p>
                          <SettingsInfoTip
                            label="Server addresses"
                            description={
                              <>
                                <p>LAN and public IP addresses (sent in share invites).</p>
                                <p className="mt-1.5">
                                  Tick the addresses to include in Messages — unticked URLs are not sent.
                                </p>
                              </>
                            }
                          />
                        </div>
                        <ul className="flex flex-wrap gap-2">
                          {inviteUrlDisplayOptions.map((u) => (
                            <li
                              key={u}
                              className="flex min-w-[min(100%,14rem)] flex-1 items-start gap-2 rounded-md border border-sky-200/70 bg-sky-50/40 px-2 py-1.5"
                            >
                              <Checkbox
                                id={`pl-invite-url-${u}`}
                                className="pl-backup-checkbox-sky mt-0.5"
                                checked={isPlServerInviteUrlSelected(u, inviteUrlOptions, draft?.selectedInviteUrls)}
                                onCheckedChange={(v) => toggleInviteUrlSelection(u, v === true)}
                              />
                              <label
                                htmlFor={`pl-invite-url-${u}`}
                                className="min-w-0 flex-1 cursor-pointer break-all font-mono text-muted-foreground"
                              >
                                {u}
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={() => void copyText(u, "URL")}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="flex justify-end pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={busy || publicIpDetecting}
                        onClick={saveNetworkAndBootSettings}
                      >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {isServerRole ? (
            <>
              <LocalPlServerSharedCompaniesPicker
                allCompaniesRegistry={allCompaniesRegistry}
                configuredIds={draft.sharedLocalCompanyIds}
                onConfiguredIdsChange={(ids) =>
                  setDraft((d) => (d ? { ...d, sharedLocalCompanyIds: ids } : d))
                }
                selectedCompanyId={plServerUsersCompanyId}
                onSelectedCompanyIdChange={setPlServerUsersCompanyId}
                disabled={busy}
              />

              <Card className={cn("flex h-full min-w-0 flex-col overflow-hidden", serverCardToneSkyCn)}>
                <CardContent className="min-w-0 p-3">
                  <LocalPlServerSharePanel
                    companyId={plServerUsersCompanyId}
                    companyName={plServerUsersCompanyName}
                    allCompaniesRegistry={allCompaniesRegistry}
                    serverStatus={status}
                    sharedLocalCompanyIds={draft.sharedLocalCompanyIds}
                    onCompanySelect={setPlServerUsersCompanyId}
                    disabled={busy}
                    variant="settings"
                  />
                </CardContent>
              </Card>
            </>
          ) : null}

          <div className="pt-1">{topBottomActionBar}</div>
        </div>
      )}
    </div>
  );
}
