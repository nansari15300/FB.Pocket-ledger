
'use client';

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { useIsMobile, MobileViewProvider } from "@/hooks/use-mobile";
import { DashboardProvider } from "@/hooks/useDashboard";
import { usePathname, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatEntitlementCapLabel, getNextPaidUpgrade } from "@/config/plans";
import { useState, useEffect, useMemo, useCallback, useRef, forwardRef } from "react";
import { MobileRoutePullRefreshProvider } from "@/contexts/MobileRoutePullRefreshContext";
import { GlobalMobilePullRefresh } from "@/components/layout/GlobalMobilePullRefresh";
import { useAuth } from "@/hooks/useAuth";
import { useEmbeddedLogout } from "@/contexts/EmbeddedLogoutContext";
import { useToast } from "@/hooks/use-toast";
import { MobileFloatingButton, ReportsMobileReportListFab } from "@/components/layout/MobileFloatingButton";
import { CompanyDemotedBanner } from "@/components/company/CompanyDemotedBanner";
import { PermissionReverifyBanner } from "@/components/permission/PermissionReverifyBanner";
import { PlanAuthoritativeSyncBanner } from "@/components/company/PlanAuthoritativeSyncBanner";
import { PlServerAuthoritativePendingBanner } from "@/components/PlServerAuthoritativePendingBanner";
import { PlServerReadSyncHealthBanner } from "@/components/PlServerReadSyncHealthBanner";
import { FileHoverPreviewProvider } from "@/contexts/FileHoverPreviewContext";
import { ReportPartyViewProvider } from "@/contexts/ReportPartyViewContext";
import { ReportListProvider } from "@/contexts/ReportListContext";
import { SettingsListProvider } from "@/contexts/SettingsListContext";
import { useSidebar } from "@/components/ui/sidebar";
import {
  useEdgeSwipeDocumentCapture,
  type EdgeSwipeDocumentOptions,
} from "@/hooks/useMobileEdgeSwipe";
import { AlarmPopup } from "@/components/messages/AlarmPopup";
import { RpOutstandingDialogProvider } from "@/contexts/RpOutstandingDialogContext";
import { DeviceLimitProvider, useDeviceLimitContext } from "@/contexts/DeviceLimitContext";
import { resolvePlanIdForActiveCompany } from "@/lib/accountPlanForOwner";
import { DEFAULT_PLANS, type PlanId } from "@/config/plans";
import { getPlanFromPlans, useLivePlans } from "@/hooks/useLivePlans";
import { withoutWebAppBasePath } from "@/lib/webAppBasePath";
import { useMarkMessagesDelivered } from "@/hooks/useMarkMessagesDelivered";
import { useCompany } from "@/hooks/useCompany";
import { getOrCreateDeviceId, getDeviceLabel, resolveDeviceLabelForFirestoreAsync, removeThisDevice } from "@/lib/deviceLimitClient";
import { shortDeviceLabelForList, deviceLabelTooltipIfTruncated } from "@/lib/deviceLabelDisplay";
import { armDashboardRedirectGuard } from "@/lib/protectFromUnwantedDashboardRedirect";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { activateOnlineGateForCompanyPicker } from "@/lib/gates/gateClientDefaults";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { toast } from "sonner";
import { apkCloudCompanyOfflineViewOnly, apkCloudFirestoreMasterWriteFromCompanyShape } from "@/lib/apkOnlineFirestoreWritePolicy";
import { countSyncOutboxRowsForCompany } from "@/lib/localVoucherOutbox";
import { PL_APK_LEDGER_WRITE_ARM_EVENT } from "@/lib/apkLedgerRouteShield";
// APK par `[PL-NAV]` traces screen pe — adb/browser ki zarurat kam (flags: `plNavRedirectDebug.ts` header)
import { PlNavDebugOnDeviceOverlay } from "@/components/debug/PlNavDebugOnDeviceOverlay";
import { DashboardDocumentTitleSync } from "@/components/layout/DashboardDocumentTitleSync";
import { AdminPanelCompanyLedgerBootstrap } from "@/adminPanelCompany/components/AdminPanelCompanyLedgerBootstrap";
import { PrefetchDashboardChunk } from "@/components/dashboard/PrefetchDashboardChunk";
import { ElectronTabStripSyncBridge } from "@/components/layout/ElectronTabStripSyncBridge";
import { RecurringVoucherAutoRunner } from "@/components/vouchers/RecurringVoucherAutoRunner";
import { PendingAttachmentSyncBridge } from "@/components/vouchers/PendingAttachmentSyncBridge";
import { BackupRunGlobalBanner } from "@/components/settings/BackupRunGlobalBanner";
import { RestoreCloudPushGlobalBanner } from "@/components/RestoreCloudPushGlobalBanner";
import { AutoBackupScheduler } from "@/components/settings/AutoBackupScheduler";
import { WebAppOnlineAccessGate } from "@/components/auth/WebAppOnlineAccessGate";
import { AdRuntimeBootstrap } from "@/components/ads/AdRuntimeBootstrap";
import { AdLockedScreenBanner } from "@/components/ads/AdLockedScreenBanner";
import { collection, doc, deleteDoc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import { getDocs, getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase"; // device-limit overlay: companies/{id}/devices + users lookup
import { Settings, Monitor, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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


/** APK + cloud company offline: amber strip sirf ~2s — lambi “view only” strip na chipke (`useEffect` timed dismiss). */
function ApkCloudOfflineViewBanner() {
  const { company } = useCompany();
  const online = useNavigatorOnline();
  const offlineViewOnly = apkCloudCompanyOfflineViewOnly(company, online);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!offlineViewOnly) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const tid = window.setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(tid);
  }, [offlineViewOnly]);

  if (!visible) return null;
  return (
    <div className="border-b border-border/60 bg-amber-500/15 py-1.5 text-center text-[11px] font-medium text-amber-950 dark:text-amber-100 sm:text-xs">
      Offline — view only. Full edit when you are back online.
    </div>
  );
}

/**
 * Offline → online: pehle emerald strip layout shift karti thi (`border-b` neeche content dhakel deta).
 * Sonner toast = same acknowledgement, scroll/layout stable (`StaticFastResumeSyncManager` defer ke saath).
 */
function ApkCloudOnlineSyncToast() {
  const online = useNavigatorOnline();
  const { companyId, company } = useCompany();
  const prevOnlineRef = useRef(online);

  useEffect(() => {
    const wasOffline = prevOnlineRef.current === false;
    prevOnlineRef.current = online;
    if (!(wasOffline && online)) return;
    const cid = companyId?.trim();
    if (!cid) return;

    let cancelled = false;

    void (async () => {
      const pending = await countSyncOutboxRowsForCompany(cid);
      const mirrorCloudCompany = apkCloudFirestoreMasterWriteFromCompanyShape(company);
      if (cancelled) return;

      let msg: string | null = null;
      if (pending > 0) {
        msg = "You're online — pending changes are syncing.";
      } else if (mirrorCloudCompany) {
        msg = "You're online — local data sync starting.";
      }
      if (!msg) return;
      // Fixed `id` = duplicate reconnect burst me ek hi toast update
      toast.success(msg, { id: "pl-apk-online-sync-ack", duration: 4200 });
    })();

    return () => {
      cancelled = true;
    };
  }, [online, companyId, company]);

  return null;
}

function DeviceLimitBanner() {
  const { deviceLimitReached, deviceCount, maxDevices } = useDeviceLimitContext();
  const { user } = useAuth();
  const { company, allCompanies } = useCompany();
  const accountPlanId = useMemo(
    () =>
      user?.uid && company
        ? resolvePlanIdForActiveCompany(company, allCompanies, user.uid, user.email)
        : ("basic" as PlanId),
    [allCompanies, user?.uid, user?.email, company?.planId, company]
  );
  const canUpgrade = getNextPaidUpgrade(accountPlanId) != null;
  if (!deviceLimitReached) return null;
  return (
    <div className="bg-amber-500 text-amber-950 text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 flex-wrap">
      <Smartphone className="h-4 w-4 shrink-0" />
      <span>
        Device limit reached ({deviceCount}/{formatEntitlementCapLabel(maxDevices)}). Sync from this
        device is blocked.
      </span>
      {canUpgrade ? (
        <Link href="/billing" className="underline font-semibold hover:no-underline">
          Upgrade to add more devices
        </Link>
      ) : (
        <Link href="/billing?addon=device" className="underline font-semibold hover:no-underline">
          Buy device add-on
        </Link>
      )}
    </div>
  );
}

type DeviceItem = { id: string; userId: string; lastActive: string; ts: number; deviceType?: "mobile" | "desktop" };

function DeviceLimitOverlay() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { requestEmbeddedLogout } = useEmbeddedLogout();
  const { company, companyId, allCompanies } = useCompany();
  const livePlansForDeviceUi = useLivePlans();
  /** Header profile jaisa effective plan — overlay par limit explain karne ke liye */
  const deviceOverlayAccountPlanId = useMemo(
    () =>
      user?.uid && company
        ? resolvePlanIdForActiveCompany(company, allCompanies, user.uid, user.email)
        : ("basic" as PlanId),
    [allCompanies, user?.uid, user?.email, company?.planId, company]
  );
  const deviceOverlayPlan = useMemo(
    () => getPlanFromPlans(livePlansForDeviceUi, deviceOverlayAccountPlanId),
    [livePlansForDeviceUi, deviceOverlayAccountPlanId]
  );
  const deviceOverlayPlanName =
    DEFAULT_PLANS[deviceOverlayAccountPlanId]?.name ?? String(deviceOverlayAccountPlanId);
  const canUpgradePlan = getNextPaidUpgrade(deviceOverlayAccountPlanId) != null;
  const { toast } = useToast();
  const router = useRouter();
  const goSwitchCompany = useCallback(() => {
    activateOnlineGateForCompanyPicker();
    router.push("/company");
  }, [router]);
  const { deviceLimitReached, singleDeviceOnly, replaceOffer, noPermissionNewDevice, kickedAndBlocked, deviceCount, maxDevices, refreshDeviceCheck, performReplaceAndRefresh, clearKickedAndRefresh } = useDeviceLimitContext();
  const [replacing, setReplacing] = useState(false);
  const [deviceIdShort, setDeviceIdShort] = useState("");
  const [thisDeviceLabel, setThisDeviceLabel] = useState("");
  const [activeDevices, setActiveDevices] = useState<DeviceItem[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState<DeviceItem | null>(null);
  const [rejoining, setRejoining] = useState(false);
  const [showReplaceDeviceSelect, setShowReplaceDeviceSelect] = useState(false);

  const isCompanyOwner = !!company && (company.ownerId === user?.uid || (user?.email && company.ownerEmail === user.email));
  const ownerId = company?.ownerId ?? "";
  const currentDeviceId = typeof window !== "undefined" ? getOrCreateDeviceId() : "";
  /** Native device label row: UA se mobile/desktop — `shortDeviceLabelForList` fallback. */
  const thisDeviceNavKind = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mobile|Android|iPhone|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        ? ("mobile" as const)
        : ("desktop" as const),
    [],
  );
  const thisDeviceLabelShort = useMemo(
    () => shortDeviceLabelForList(thisDeviceLabel || undefined, thisDeviceNavKind),
    [thisDeviceLabel, thisDeviceNavKind],
  );
  const thisDeviceLabelTip = useMemo(
    () => deviceLabelTooltipIfTruncated(thisDeviceLabel || undefined, thisDeviceLabelShort),
    [thisDeviceLabel, thisDeviceLabelShort],
  );

  useEffect(() => {
    const id = getOrCreateDeviceId();
    setDeviceIdShort(id ? `...${id.slice(-8)}` : "");
    setThisDeviceLabel(typeof window !== "undefined" ? getDeviceLabel() : "");
    // Native: `Device.getInfo()` se static label — overlay me bhi wahi dikhe (web par sirf UA, pehle se sync)
    void (async () => {
      try {
        const label = await resolveDeviceLabelForFirestoreAsync();
        if (label) setThisDeviceLabel(label);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!companyId || (!deviceLimitReached && !kickedAndBlocked)) {
      setActiveDevices((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const devicesRef = collection(firestore, "companies", companyId, "devices");
    const unsub = onSnapshot(devicesRef, (snap) => {
      const list: DeviceItem[] = snap.docs.map((d) => {
        const data = d.data();
        const la = data?.lastActive;
        const ts = la && typeof la.toMillis === "function" ? la.toMillis() : 0;
        const lastActive = ts ? new Date(ts).toLocaleString() : "—";
        const deviceType = (data?.deviceType === "mobile" || data?.deviceType === "desktop" ? data.deviceType : undefined) as DeviceItem["deviceType"];
        return { id: d.id, userId: data?.userId ?? "", lastActive, ts, deviceType };
      });
      list.sort((a, b) => {
        const aOwner = a.userId === ownerId;
        const bOwner = b.userId === ownerId;
        if (aOwner && !bOwner) return -1;
        if (!aOwner && bOwner) return 1;
        return b.ts - a.ts;
      });
      setActiveDevices(list);
    });
    return () => unsub();
  }, [companyId, deviceLimitReached, kickedAndBlocked, ownerId]);

  const userIdsKey = useMemo(() => activeDevices.map((d) => d.userId).filter(Boolean).sort().join(","), [activeDevices]);

  useEffect(() => {
    if (!isCompanyOwner || activeDevices.length === 0) return;
    const userIds = [...new Set(activeDevices.map((d) => d.userId).filter(Boolean))];
    let cancelled = false;
    const map: Record<string, string> = {};
    Promise.all(
      userIds.map(async (uid) => {
        if (cancelled) return;
        const byId = await getDoc(doc(firestore, "users", uid));
        let d: Record<string, unknown> | null = byId.exists() ? byId.data() : null;
        if (!d) {
          const byUid = await getDocs(query(collection(firestore, "users"), where("uid", "==", uid)));
          d = byUid.docs[0]?.data() ?? null;
        }
        if (cancelled) return;
        if (d) {
          const raw = (d.displayName as string)?.trim() || (d.name as string)?.trim() || (d.email as string) || "";
          map[uid] = raw && raw !== uid && !/^[a-zA-Z0-9]{20,32}$/.test(raw) ? raw : "—";
        } else {
          map[uid] = "—";
        }
      })
    ).then(() => {
      if (!cancelled) setUserNames((prev) => ({ ...prev, ...map }));
    });
    return () => { cancelled = true; };
  }, [isCompanyOwner, userIdsKey]);

  const handleKickOut = async (device: DeviceItem, onSuccess?: () => void) => {
    if (!companyId) return;
    setKickingId(device.id);
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "devices", device.id));
      toast({ title: "Device removed", description: "That device will see slot full and can switch company or remove that device." });
      setConfirmKick(null);
      onSuccess?.();
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to remove device", variant: "destructive" });
    } finally {
      setKickingId(null);
    }
  };

  const isAdminDevice = (d: DeviceItem) => d.userId === ownerId;
  const myDevices = activeDevices.filter((d) => d.userId === user?.uid);
  const isNewUserNoSlot = !isCompanyOwner && myDevices.length === 0;

  if (!deviceLimitReached && !kickedAndBlocked) return null;
  if (pathname?.startsWith("/billing") || pathname?.startsWith("/settings")) return null;

  if (kickedAndBlocked && !isCompanyOwner) {
    const myDevicesHere = activeDevices.filter((d) => d.userId === user?.uid);
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm p-6 overflow-y-auto">
        <Smartphone className="h-12 w-12 text-amber-500 shrink-0" />
        <p className="text-center font-medium text-lg">You were removed from this company&apos;s devices List.</p>
        <p className="text-center text-muted-foreground text-sm font-medium"><span className="font-semibold text-foreground">Company:</span> {company?.name || "—"}</p>
        <p className="text-center text-muted-foreground text-sm max-w-sm">
          Kick one of your devices below; this device will be added in its place.
        </p>
        {myDevicesHere.length > 0 && (
          <div className="w-full max-w-md rounded-lg border bg-muted/30 px-3 py-2 text-left">
            <p className="text-xs font-semibold text-foreground mb-2">Your devices in this company — kick one to add this device in its place</p>
            <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
              {myDevicesHere.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                    <span className="font-medium text-foreground">{d.deviceType === "mobile" ? "Mobile" : "Desktop"}</span>
                    <span className="shrink-0 text-muted-foreground">{d.lastActive}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="shrink-0 h-7 text-xs"
                    onClick={() => setConfirmKick(d)}
                    disabled={!!kickingId}
                  >
                    {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    <span className="ml-1">Kick out</span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={async () => {
              setRejoining(true);
              try {
                await clearKickedAndRefresh();
              } finally {
                setRejoining(false);
              }
            }}
            disabled={rejoining}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {rejoining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={rejoining ? "ml-2" : ""}>{rejoining ? "Rejoining…" : "Use this device again"}</span>
          </Button>
          <Button
            variant="outline"
            onClick={goSwitchCompany}
            className="rounded-md px-4 py-2 text-sm"
          >
            Switch company
          </Button>
          <Button variant="outline" onClick={() => requestEmbeddedLogout()} className="rounded-md px-4 py-2 text-sm">
            Logout
          </Button>
        </div>
        <AlertDialog open={!!confirmKick} onOpenChange={(open) => !open && setConfirmKick(null)}>
          <AlertDialogContent>
            <AlertDialogTitle>Kick out this device?</AlertDialogTitle>
            <AlertDialogDescription>
              That device will be removed from the company. You can then use this device again to rejoin.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => confirmKick && handleKickOut(confirmKick)}
              >
                Kick out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  const showReplaceOfferDialog = replaceOffer && !isCompanyOwner;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm p-6 overflow-y-auto">
      <Smartphone className="h-12 w-12 text-amber-500 shrink-0" />
      <p className="text-center font-medium text-lg">
        Device limit reached ({deviceCount}/{formatEntitlementCapLabel(maxDevices)})
      </p>
      <p className="text-center text-base font-semibold text-foreground">
        Current plan: {deviceOverlayPlanName}
      </p>
      {/* `maxDevices` hook se = profile wala effective account plan (highest owned tier) */}
      <p className="text-center text-xs text-muted-foreground max-w-md px-2">
        {deviceOverlayPlan.entitlements.hasMultiDeviceSync ? (
          <span>
            {formatEntitlementCapLabel(maxDevices)} device slot
            {maxDevices !== 1 ? "s" : ""} for this account
            {deviceOverlayAccountPlanId === "pro-plus"
              ? " (top plan — add more via add-on)"
              : ""}
          </span>
        ) : (
          <span>Multi-device sync is off for this plan (1 device)</span>
        )}
      </p>
      <div className="w-full max-w-sm rounded-lg border bg-muted/50 px-3 py-2 text-left text-xs text-muted-foreground space-y-1">
        <p><span className="font-medium text-foreground">User name:</span> {(user?.displayName ?? "").toString().trim() || (user?.email ? user.email.split("@")[0] : "") || "—"}</p>
        <p><span className="font-medium text-foreground">User email:</span> {user?.email || "—"}</p>
        <p><span className="font-medium text-foreground">Company:</span> {company?.name || "—"}</p>
        <p>
          <span className="font-medium text-foreground">This device:</span>{" "}
          {thisDeviceLabel ? (
            <span
              className="cursor-default underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
              title={thisDeviceLabelTip}
            >
              {thisDeviceLabelShort}
            </span>
          ) : (
            "—"
          )}
        </p>
      </div>

      {showReplaceOfferDialog && (
        <div className="w-full max-w-md space-y-4">
          {!showReplaceDeviceSelect ? (
            <>
              {myDevices.length > 0 && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-left">
                  <p className="text-xs font-semibold text-foreground mb-2">Your devices in this company — kick one to free a slot, or click Yes to choose which device to replace</p>
                  <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
                    {myDevices.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                          <span className="font-medium text-foreground">{d.deviceType === "mobile" ? "Mobile" : "Desktop"}</span>
                          <span className="shrink-0 text-muted-foreground">{d.lastActive}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="shrink-0 h-7 text-xs"
                          onClick={() => setConfirmKick(d)}
                          disabled={!!kickingId}
                        >
                          {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          <span className="ml-1">Kick out</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="rounded-lg border bg-muted/30 p-4 text-center space-y-4">
                <p className="text-sm font-medium text-foreground">
                  To use this device instead? Click Yes to choose which device to remove, or kick one above. This device will be added in its place.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    onClick={() => setShowReplaceDeviceSelect(true)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Yes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/company")}
                  >
                    No
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">No: you will be taken to company selection.</p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-left">
              <p className="text-xs font-semibold text-foreground mb-2">Select which device to remove. This device will be added in its place and this company will open.</p>
              <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
                {myDevices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                      <span className="font-medium text-foreground">{d.deviceType === "mobile" ? "Mobile" : "Desktop"}</span>
                      <span className="shrink-0 text-muted-foreground">{d.lastActive}</span>
                    </span>
                    <Button
                      size="sm"
                      className="shrink-0 h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => handleKickOut(d, () => refreshDeviceCheck())}
                      disabled={!!kickingId}
                    >
                      {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      <span className={kickingId === d.id ? "ml-1" : ""}>Replace with this device</span>
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowReplaceDeviceSelect(false)}>
                Back
              </Button>
            </div>
          )}
        </div>
      )}

      {!showReplaceOfferDialog && isCompanyOwner && activeDevices.length > 0 && (
        <div className="w-full max-w-md rounded-lg border bg-muted/30 px-3 py-2 text-left">
          <p className="text-xs font-semibold text-foreground mb-2">All synced devices — remove one to free a slot</p>
          <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
            {activeDevices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                  <span className="font-medium text-foreground truncate">{isAdminDevice(d) ? "Admin" : (userNames[d.userId] ?? "—")}</span>
                  <span className="font-mono truncate text-muted-foreground">...{d.id.slice(-8)}</span>
                </span>
                <span className="shrink-0 hidden sm:inline">{d.lastActive}</span>
                {isAdminDevice(d) && d.id === currentDeviceId ? (
                  <span className="text-muted-foreground shrink-0">(this device)</span>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="shrink-0 h-7 text-xs"
                    onClick={() => setConfirmKick(d)}
                    disabled={!!kickingId}
                  >
                    {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    <span className="ml-1">Kick out</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Link
            href="/settings?view=devices"
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-primary hover:underline"
          >
            <Settings className="h-3.5 w-3.5" />
            Device sync
          </Link>
        </div>
      )}

      {!showReplaceOfferDialog && !noPermissionNewDevice && !isCompanyOwner && myDevices.length > 0 && !singleDeviceOnly && (
        <div className="w-full max-w-md rounded-lg border bg-muted/30 px-3 py-2 text-left">
          <p className="text-xs font-semibold text-foreground mb-2">Your device(s) using the limit — kick one to free a slot for this device</p>
          <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
            {myDevices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                  <span className="font-mono truncate">...{d.id.slice(-8)}</span>
                </span>
                <span className="shrink-0">{d.lastActive}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="shrink-0 h-7 text-xs"
                  onClick={() => setConfirmKick(d)}
                  disabled={!!kickingId}
                >
                  {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  <span className="ml-1">Kick out</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!showReplaceOfferDialog && !noPermissionNewDevice && singleDeviceOnly && !isCompanyOwner && myDevices.length > 0 && (
        <div className="w-full max-w-md rounded-lg border bg-muted/30 px-3 py-2 text-left">
          <p className="text-xs font-semibold text-foreground mb-2">You can only use one device. The following device is already signed in. Please log out from this device, or replace it with this device.</p>
          <ul className="text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
            {myDevices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  {d.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 shrink-0" /> : <Monitor className="h-3.5 w-3.5 shrink-0" />}
                  <span className="font-mono truncate">...{d.id.slice(-8)}</span>
                </span>
                <span className="shrink-0">{d.lastActive}</span>
                <Button
                  size="sm"
                  className="shrink-0 h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => setConfirmKick(d)}
                  disabled={!!kickingId}
                >
                  {kickingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  <span className="ml-1">Replace with this device</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!showReplaceOfferDialog && isCompanyOwner && activeDevices.length === 0 && (
        <Link
          href="/settings?view=devices"
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <Settings className="h-4 w-4" />
          Device sync
        </Link>
      )}

      {!showReplaceOfferDialog && noPermissionNewDevice && !isCompanyOwner ? (
        <>
          <p className="text-center text-muted-foreground text-sm max-w-sm">
            No permission to use multi device. You can only use one device. Join this device to kick the previous one, or contact company admin or switch company.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={async () => {
                setReplacing(true);
                try {
                  await performReplaceAndRefresh();
                } finally {
                  setReplacing(false);
                }
              }}
              disabled={replacing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {replacing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={replacing ? "ml-2" : ""}>Join this device</span>
            </Button>
            <Button
              variant="outline"
              onClick={goSwitchCompany}
              className="rounded-md px-4 py-2 text-sm"
            >
              Switch company
            </Button>
            <Button
              variant="outline"
              onClick={() => requestEmbeddedLogout()}
              className="rounded-md px-4 py-2 text-sm"
            >
              Logout
            </Button>
          </div>
        </>
      ) : !showReplaceOfferDialog && isCompanyOwner ? (
        <>
          <p className="text-center text-muted-foreground text-sm max-w-sm">
            This device is not allowed for this company. Remove a device above or switch company
            {canUpgradePlan ? " or upgrade your plan" : " or buy a device add-on"}.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={goSwitchCompany}
              className="rounded-md px-4 py-2 text-sm"
            >
              Switch company
            </Button>
            {canUpgradePlan ? (
              <Link
                href="/billing"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Upgrade to add more devices
              </Link>
            ) : (
              <Link
                href="/billing?addon=device"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Buy device add-on
              </Link>
            )}
            <Link
              href="/settings?view=devices"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <Settings className="h-4 w-4 mr-1.5" />
              Device sync
            </Link>
          </div>
        </>
      ) : !showReplaceOfferDialog && singleDeviceOnly ? (
        <p className="text-center text-muted-foreground text-sm max-w-sm">
          Log out from this device or use &quot;Replace with this device&quot; above to use this device instead.
        </p>
      ) : !showReplaceOfferDialog && isNewUserNoSlot ? (
        <>
          <p className="text-center text-muted-foreground text-sm max-w-sm">
            Slot full for this company. Change company or logout.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={goSwitchCompany}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Change company
            </Button>
            <Button
              variant="outline"
              onClick={() => requestEmbeddedLogout()}
              className="rounded-md px-4 py-2 text-sm"
            >
              Logout
            </Button>
          </div>
        </>
      ) : !showReplaceOfferDialog ? (
        <p className="text-center text-muted-foreground text-sm max-w-sm">
          Kick out one of your devices above to free a slot for this device.
        </p>
      ) : null}

      {!showReplaceOfferDialog && !noPermissionNewDevice && (
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Button
            onClick={async () => {
              setRejoining(true);
              try {
                await clearKickedAndRefresh();
              } finally {
                setRejoining(false);
              }
            }}
            disabled={rejoining}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {rejoining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={rejoining ? "ml-2" : ""}>{rejoining ? "Rejoining…" : "Rejoin"}</span>
          </Button>
          <Button variant="outline" onClick={() => requestEmbeddedLogout()} className="rounded-md px-4 py-2 text-sm">
            Logout
          </Button>
        </div>
      )}

      <AlertDialog open={!!confirmKick} onOpenChange={(open) => !open && setConfirmKick(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{singleDeviceOnly && myDevices.some((d) => d.id === confirmKick?.id) ? "Replace with this device?" : "Remove device?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {singleDeviceOnly && myDevices.some((d) => d.id === confirmKick?.id)
              ? "The other device will be signed out. This device will then be used for this company."
              : "This device will be signed out and removed from the list. The user can sign in again if within the device limit."}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmKick && handleKickOut(confirmKick, singleDeviceOnly && myDevices.some((d) => d.id === confirmKick.id) ? refreshDeviceCheck : undefined)}
              className={singleDeviceOnly && myDevices.some((d) => d.id === confirmKick?.id) ? undefined : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
            >
              {singleDeviceOnly && myDevices.some((d) => d.id === confirmKick?.id) ? "Replace with this device" : "Kick out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Stable opts ref — har render naya `{}` na bane warna `resize` effect bar-bar chale */
/** `preventDefault` edge strip — LTR swipe = menu; ~4mm taaki detail back button (px-2) tap na mare */
const LEFT_EDGE_OPEN_APP_MENU_OPTS: EdgeSwipeDocumentOptions = {
  edgeWidthMm: 4,
  blockOverscrollHistoryOnLeftEdge: true,
};

/**
 * `/company` jaise bare routes par `main` swipe nahi tha — `document` capture se har page (embed chhod kar).
 */
function GlobalLeftEdgeOpenAppMenuSwipe() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { isOpen, setIsOpen } = useSidebar();
  const openMenu = useCallback(() => setIsOpen(true), [setIsOpen]);
  const skipEmbed = Boolean(pathname?.startsWith("/embed"));
  const enabled = Boolean(isMobile && !isOpen && !skipEmbed);
  useEdgeSwipeDocumentCapture(enabled, "left", openMenu, LEFT_EDGE_OPEN_APP_MENU_OPTS);
  return null;
}

/** Mobile: `touch-pan-y` vertical scroll; baen swipe ab `GlobalLeftEdgeOpenAppMenuSwipe` document par */
const DashboardMainShell = forwardRef<
  HTMLElement,
  { children: React.ReactNode; className?: string }
>(function DashboardMainShell({ children, className }, ref) {
  const isMobile = useIsMobile();
  return (
    <main ref={ref} className={cn("relative", isMobile && "touch-pan-y overscroll-y-contain", className)}>
      {children}
    </main>
  );
});

function LayoutContent({ children }: { children: React.ReactNode }) {
    const isMobile = useIsMobile();
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const dashboardMainScrollRef = useRef<HTMLElement>(null);
    const noLayoutPageScrollRef = useRef<HTMLDivElement>(null);
    const embedPageScrollRef = useRef<HTMLDivElement>(null);

    // Settings / gallery / billing / loans: body scroll band — andar panel scroll (outer chain `min-h-0`).
    useEffect(() => {
        if (
          pathname?.startsWith("/settings") ||
          pathname?.startsWith("/gallery") ||
          pathname?.startsWith("/billing/statement") ||
          pathname?.startsWith("/loans")
        ) {
            document.documentElement.style.overflow = "hidden";
            document.body.style.overflow = "hidden";
            return () => {
                document.documentElement.style.overflow = "";
                document.body.style.overflow = "";
            };
        }
    }, [pathname]);
    useMarkMessagesDelivered();

    // Bundled **static** + native / narrow mobile, **ya native remote-WebView** (live site NEXT_PUBLIC_STATIC_BUILD=0): submit/guard latch.
    useEffect(() => {
      if (typeof window === "undefined") return;
      const narrowStaticMobile =
        isStaticAppBuild() &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 767px)").matches;
      const nativeCap = isCapacitorNativeApp();
      if (!(nativeCap || (isStaticAppBuild() && (narrowStaticMobile || isMobile)))) return;

      const handleSubmit = () => {
        const livePath = withoutWebAppBasePath(window.location.pathname || "/").toLowerCase();
        if (livePath === "/" || livePath === "/company" || livePath === "/company/create") return;
        // Web mobile: intentional dashboard submit — shield mat lagao (native/APK ko `apkLedgerRouteShield` event dhak leta hai).
        if (livePath === "/dashboard" && !nativeCap) return;
        armDashboardRedirectGuard(router, { isMobile: isMobile || narrowStaticMobile, durationMs: 12_000 });
      };
      /** Voucher `saveVoucher` / `patchVoucherFields` jahan form submit kabhi bubble nahi karta — sirf APK eligible (module andar gate). */
      const handleLedgerShieldEvent = () => {
        armDashboardRedirectGuard(router, { isMobile: true, durationMs: 12_000 });
      };
      document.addEventListener("submit", handleSubmit, true);
      document.addEventListener(PL_APK_LEDGER_WRITE_ARM_EVENT, handleLedgerShieldEvent, true);
      return () => {
        document.removeEventListener("submit", handleSubmit, true);
        document.removeEventListener(PL_APK_LEDGER_WRITE_ARM_EVENT, handleLedgerShieldEvent, true);
      };
    }, [isMobile, router]);

    const noLayoutPages = ["/company/create"];
    const isEmbedRoute = pathname?.startsWith("/embed");
    const normalizedPath = (pathname ?? "").replace(/\/$/, "");
    const isDashboardHomeRoute =
      normalizedPath === "/dashboard" || normalizedPath.endsWith("/dashboard");

    if (noLayoutPages.includes(pathname)) {
        return (
            <>
                <GlobalLeftEdgeOpenAppMenuSwipe />
                {/* Mobile: `/company` par bhi horizontal edge “back” kam — `app-container` yahan nahi */}
                <MobileRoutePullRefreshProvider>
                  <div
                    ref={noLayoutPageScrollRef}
                    className={cn("relative", isMobile && "overscroll-x-none h-full min-h-0 w-full min-w-0")}
                  >
                    <GlobalMobilePullRefresh scrollRef={noLayoutPageScrollRef} />
                    {children}
                  </div>
                </MobileRoutePullRefreshProvider>
            </>
        );
    }

    // Embed routes: content only (no app sidebar/header) — used when shown inside reports iframe
    if (isEmbedRoute) {
        return (
            <>
                <GlobalLeftEdgeOpenAppMenuSwipe />
                <MobileRoutePullRefreshProvider>
                  <div
                    ref={embedPageScrollRef}
                    className={cn("relative h-full w-full overflow-hidden bg-background", isMobile && "overscroll-x-none")}
                  >
                    <GlobalMobilePullRefresh scrollRef={embedPageScrollRef} />
                    {children}
                  </div>
                </MobileRoutePullRefreshProvider>
            </>
        );
    }

    return (
         <>
            <GlobalLeftEdgeOpenAppMenuSwipe />
            <AlarmPopup />
            <RpOutstandingDialogProvider>
            {/* Month-end recurring vouchers: app-open trigger runner (company settings + user scope aware). */}
            <RecurringVoucherAutoRunner />
            <PendingAttachmentSyncBridge />
            <AutoBackupScheduler />
            <ReportListProvider>
              <SettingsListProvider>
              <ReportPartyViewProvider>
                <DeviceLimitProvider>
                  <div
                    id="app-container"
                    className={cn(
                      "relative flex bg-background",
                      /** Mobile + desktop: `100vh`/h-screen Windows taskbar ke niche leak ho sakta hai (Electron); `dvh` visible area ke hisaab se */
                      "h-dvh max-h-dvh min-h-0",
                      /** Mobile: horizontal edge overscroll se OS/browser history back kam ho */
                      isMobile && "overscroll-x-none",
                      (pathname?.startsWith("/settings") ||
                        pathname?.startsWith("/gallery") ||
                        pathname?.startsWith("/billing/statement") ||
                        pathname?.startsWith("/loans")) &&
                        "overflow-hidden"
                    )}
                  >
                    <AppSidebar />
                    <div
                      className={cn(
                        "flex min-h-0 flex-1 flex-col overflow-hidden",
                        !isMobile && "border-l app-main-border",
                        /** Sirf system safe-area — extra 1rem hata: mobile par page home button ke zyada qareeb */
                        isMobile && "pb-[env(safe-area-inset-bottom,0px)]"
                      )}
                    >
                      <AppHeader />
                      <RestoreCloudPushGlobalBanner />
                      <BackupRunGlobalBanner />
                      <PermissionReverifyBanner />
<CompanyDemotedBanner />
                      <PlanAuthoritativeSyncBanner />
                      <AdLockedScreenBanner />
                      <ApkCloudOfflineViewBanner />
                      <PlServerAuthoritativePendingBanner />
                      <PlServerReadSyncHealthBanner />
                      <ApkCloudOnlineSyncToast />
                      <MobileRoutePullRefreshProvider>
                        <DashboardMainShell
                          ref={dashboardMainScrollRef}
                          className={cn(
                            "flex min-h-0 flex-1 flex-col",
                            pathname?.startsWith("/settings") ||
                              pathname?.startsWith("/gallery") ||
                              pathname?.startsWith("/billing/statement") ||
                              pathname?.startsWith("/loans") ||
                              (isDashboardHomeRoute && !isMobile)
                              ? "overflow-hidden"
                              : cn(
                                  "overflow-y-auto [scrollbar-gutter:stable]",
                                  isDashboardHomeRoute && isMobile && "scrollbar-slim-dim",
                                )
                          )}
                        >
                          <GlobalMobilePullRefresh scrollRef={dashboardMainScrollRef} />
                          {children}
                        </DashboardMainShell>
                      </MobileRoutePullRefreshProvider>
                      <MobileFloatingButton />
                      {/* Mobile reports detail: PanelRight sheet trigger — footer daen */}
                      <ReportsMobileReportListFab />
                    </div>
                    <DeviceLimitOverlay />
                  </div>
                </DeviceLimitProvider>
              </ReportPartyViewProvider>
              </SettingsListProvider>
            </ReportListProvider>
            </RpOutstandingDialogProvider>
        </>
    )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WebAppOnlineAccessGate>
      <AdRuntimeBootstrap>
      <MobileViewProvider>
        <SidebarProvider>
          <DashboardProvider>
            {/* Global preview switch: Off / Hover / Click — attachments + profile plan menu */}
            <FileHoverPreviewProvider>
              {/* Overlay LayoutContent ke bahar: `/company` jaisi bare routes par bhi trace dikhai de */}
              <DashboardDocumentTitleSync />
              <AdminPanelCompanyLedgerBootstrap />
              <PrefetchDashboardChunk />
              <ElectronTabStripSyncBridge />
              <PlNavDebugOnDeviceOverlay />
              <LayoutContent>{children}</LayoutContent>
            </FileHoverPreviewProvider>
          </DashboardProvider>
        </SidebarProvider>
      </MobileViewProvider>
      </AdRuntimeBootstrap>
    </WebAppOnlineAccessGate>
  );
}
