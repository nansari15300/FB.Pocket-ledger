
"use client";

import { useEffect } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { CompanyProvider } from "@/hooks/useCompany";
import { GateProvider } from "@/contexts/GateContext";
import { DateProvider } from "@/hooks/useDate";
import { VoucherProvider } from "@/hooks/useVouchers";
import { BalanceModeProvider } from "@/contexts/BalanceModeContext";
import { DialogBackHandlerProvider } from "@/contexts/DialogBackHandlerContext";
import { FirebaseErrorListener } from "@/components/FirebaseErrorListener";
import { PrintLogoPreloader } from "@/components/PrintLogoPreloader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePresence } from "@/hooks/usePresence";
import { ThemeProvider } from "@/hooks/useTheme";
import { CapacitorAndroidBackButton } from "@/components/CapacitorAndroidBackButton";
import { AppUiZoomBootstrap } from "@/components/layout/AppUiZoomBootstrap";
import { VoucherOutboxFlushManager } from "@/components/VoucherOutboxFlushManager";
import { PocketBaseLiveSyncManager } from "@/components/PocketBaseLiveSyncManager";
import { PocketBaseSyncProgressBadge } from "@/components/PocketBaseFilesStatus";
import { LocalCompanyCloudSyncManager } from "@/components/LocalCompanyCloudSyncManager";
import { CapacitorDriveOAuthReturnHandler } from "@/components/CapacitorDriveOAuthReturnHandler";
import { DriveOAuthReturnBootstrap } from "@/components/DriveOAuthReturnBootstrap";
import { PendingRestoreCloudPushManager } from "@/components/PendingRestoreCloudPushManager";
import { StaticFastResumeSyncManager } from "@/components/StaticFastResumeSyncManager";
import { ElectronForegroundUiWake } from "@/components/ElectronForegroundUiWake";
import { OnlineResumeRouteShield } from "@/components/OnlineResumeRouteShield";
import { OfflineWarmSyncManager } from "@/components/OfflineWarmSyncManager";
import { CompanyAttachmentOfflineBackfillManager } from "@/components/CompanyAttachmentOfflineBackfillManager";
import { LocalCompanySqliteWarmBootstrap } from "@/components/LocalCompanySqliteWarmBootstrap";
import { FiscalAutoSplitBootstrap } from "@/components/settings/FiscalAutoSplitBootstrap";
import { FyVoucherScopeBootstrap } from "@/components/fyPagination/FyVoucherScopeBootstrap";
import { FySnapshotSaveBootstrap } from "@/components/fyPagination/FySnapshotSaveBootstrap";
import { FyMasterOpeningSaveBootstrap } from "@/components/fyPagination/FyMasterOpeningSaveBootstrap";
import { PlServerAttachmentPreloadManager } from "@/components/PlServerAttachmentPreloadManager";
import { LiveMirrorFolderMissingDialog } from "@/components/LiveMirrorFolderMissingDialog";
import { AppAlertDialog } from "@/components/AppAlertDialog";
import { FirstDeviceCompanyHydrationOverlay } from "@/components/FirstDeviceCompanyHydrationOverlay";
import { EmbeddedDeviceLockGate } from "@/components/EmbeddedDeviceLockGate";
import { EmbeddedAppDeferredShell } from "@/components/EmbeddedAppDeferredShell";
import { EmbeddedDeviceLockSessionProvider } from "@/contexts/EmbeddedDeviceLockSessionContext";
import { EmbeddedLogoutProvider } from "@/contexts/EmbeddedLogoutContext";
import { EmbeddedOfflineFirestoreTransport } from "@/components/EmbeddedOfflineFirestoreTransport";
import { FirstLoginWarmGateProvider } from "@/contexts/FirstLoginWarmGateContext";
import { MobileDetailSummaryCollapseProvider } from "@/contexts/MobileDetailSummaryCollapseContext";
import { EmbeddedAttachmentPrefetchProvider } from "@/contexts/EmbeddedAttachmentPrefetchContext";
import { CrossCompanyAttachmentAccessBridge } from "@/components/CrossCompanyAttachmentAccessBridge";
import { DevPlHostBridgeWorker } from "@/components/DevPlHostBridgeWorker";
import { ServerShareableCompaniesBridge } from "@/components/ServerShareableCompaniesBridge";
import { PlServerAccessBootstrap } from "@/components/settings/PlServerAccessBootstrap";
import { PlRemoteClientLandingBootstrap } from "@/components/settings/PlRemoteClientLandingBootstrap";
import { PlServerGateLandingBootstrap } from "@/components/settings/PlServerGateLandingBootstrap";
import { PlFirebaseAuthHandoffBootstrap } from "@/components/settings/PlFirebaseAuthHandoffBootstrap";
import "@/lib/adminData/plServerMyCompanyHandoff";
import { PlAppHubCompanyReturnBootstrap } from "@/components/settings/PlAppHubCompanyReturnBootstrap";
import { PlServerClientDeltaManager } from "@/components/settings/PlServerClientDeltaManager";
import { PlServerLiveSyncManager } from "@/components/settings/PlServerLiveSyncManager";
import { LocalServerShareAutoConnectManager } from "@/components/settings/LocalServerShareAutoConnectManager";
import { PlServerAuthoritativeReplayManager } from "@/components/PlServerAuthoritativeReplayManager";
import { FirebaseLedgerDeltaSyncManager } from "@/components/FirebaseLedgerDeltaSyncManager";
import { DaybookWedgeSyncManager } from "@/components/wedge/DaybookWedgeSyncManager";
import { WebAppBasePathUrlGuard } from "@/components/WebAppBasePathUrlGuard";
import { PlUiHealthBrakeGate } from "@/components/debug/PlUiHealthBrakeGate";
import { ClientHealthGlobalBootstrap } from "@/components/debug/ClientHealthGlobalBootstrap";
import { ClientHealthMonitorBootstrap } from "@/components/debug/ClientHealthMonitorBootstrap";
import { ClientHealthMonitorSnapshotSync } from "@/components/debug/ClientHealthMonitorSnapshotSync";
import { OnlineTriggerLogBootstrap } from "@/components/debug/OnlineTriggerLogBootstrap";
import { CountryAppGate } from "@/components/country/CountryAppGate";

/** Local-only app start: sql.js init pehle se — refresh par company turant SQLite se load. */
function SqlitePrewarmBootstrap() {
  useEffect(() => {
    void import("@/lib/localSqlite").then((m) => m.getBrowserDb());
  }, []);
  return null;
}

function EmbeddedStartupPrimeBootstrap() {
  useEffect(() => {
    void primeLocalFileRefMetaRuntimeCache();
  }, []);
  return null;
}
import { PlServerGateLedgerBootstrap } from "@/components/settings/PlServerGateLedgerBootstrap";
import { PlDeltaExportDevBridge } from "@/components/settings/PlDeltaExportDevBridge";
import { PlServerGateRefreshBootstrap } from "@/components/settings/PlServerGateRefreshBootstrap";
import { PlServerHostAttachmentDeltaBootstrap } from "@/components/settings/PlServerHostAttachmentDeltaBootstrap";
import { PlServerCompanyDetectionAuditRunner } from "@/components/PlServerCompanyDetectionAuditRunner";
import { ReleaseUpdateCheck } from "@/components/ReleaseUpdateCheck";
import { primeLocalFileRefMetaRuntimeCache } from "@/lib/localPendingFiles";
import { isPerfDebugEnabled } from "@/lib/perfDebug";
import { ensureClientRandomUUIDPolyfill } from "@/lib/clientRandomUUID";

function PresenceManager() {
    usePresence();
    return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
    useEffect(() => {
      ensureClientRandomUUIDPolyfill();
      void import("@/lib/plServerFirebaseHitTrace").then((m) => m.installPlServerFirebaseNetworkTrace());
      try {
        sessionStorage.removeItem("pl_chunk_reload_v1");
      } catch {
        /* noop */
      }
    }, []);
    useEffect(() => {
      if (!isPerfDebugEnabled()) return;
      if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
      // Freeze diagnostics: long tasks (>50ms) console me print karo taaki blocking source correlate ho.
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 40) continue;
          console.warn("[PL-PERF] long-task", {
            durationMs: Math.round(entry.duration * 10) / 10,
            startMs: Math.round(entry.startTime * 10) / 10,
            route: window.location.pathname,
          });
        }
      });
      try {
        obs.observe({ type: "longtask", buffered: false } as PerformanceObserverInit);
      } catch {
        // Browser without longtask support: skip silently.
      }
      return () => obs.disconnect();
    }, []);
    return (
      <ThemeProvider>
        <AuthProvider>
            <ClientHealthGlobalBootstrap />
            <OnlineTriggerLogBootstrap />
            <EmbeddedDeviceLockSessionProvider>
            <FirebaseErrorListener />
            {/* EXE/APK: PIN pehle — SQLite/sync baad me (`EmbeddedAppDeferredShell`) */}
            <EmbeddedDeviceLockGate />
            <EmbeddedAppDeferredShell>
            <PlServerCompanyDetectionAuditRunner />
            <EmbeddedOfflineFirestoreTransport />
            <GateProvider>
            <CompanyProvider>
                <ClientHealthMonitorSnapshotSync />
                <ClientHealthMonitorBootstrap />
                <EmbeddedStartupPrimeBootstrap />
                <SqlitePrewarmBootstrap />
                <CrossCompanyAttachmentAccessBridge />
                <ServerShareableCompaniesBridge />
                <FirebaseLedgerDeltaSyncManager />
                <DevPlHostBridgeWorker />
                <PlServerHostAttachmentDeltaBootstrap />
                <PlServerAccessBootstrap />
                <PlFirebaseAuthHandoffBootstrap />
                <PlAppHubCompanyReturnBootstrap />
                <PlServerGateRefreshBootstrap />
                <PlRemoteClientLandingBootstrap />
                <PlServerGateLandingBootstrap />
                <PlServerClientDeltaManager />
                <PlServerLiveSyncManager />
                <LocalServerShareAutoConnectManager />
                <PlServerAuthoritativeReplayManager />
                <PlServerGateLedgerBootstrap />
                <PlDeltaExportDevBridge />
                <EmbeddedLogoutProvider>
                <EmbeddedAttachmentPrefetchProvider>
                {/* APK/static pehli login: full warm chalte waqt background warm band — gate overlay set karti hai */}
                <FirstLoginWarmGateProvider>
                <CapacitorAndroidBackButton />
                <AppUiZoomBootstrap />
                <WebAppBasePathUrlGuard />
                <StaticFastResumeSyncManager />
                <ElectronForegroundUiWake />
                {/* Offline→online: dashboard/company silent jump block; sync background me chale */}
                <OnlineResumeRouteShield />
                {/* Online par masters/vouchers/plans SQLite + IndexedDB attachments preload */}
                <OfflineWarmSyncManager />
                {/* Online: mirror ki saari attachment URLs IndexedDB/native — offline par open jaisa online */}
                <CompanyAttachmentOfflineBackfillManager />
                <PlServerAttachmentPreloadManager />
                <LocalCompanySqliteWarmBootstrap />
                <LiveMirrorFolderMissingDialog />
                <AppAlertDialog />
                <ReleaseUpdateCheck />
                <PresenceManager />
                <PrintLogoPreloader />
                <PlUiHealthBrakeGate>
                <DateProvider>
                    <BalanceModeProvider>
                        <DialogBackHandlerProvider>
                            <VoucherProvider>
                                <FyVoucherScopeBootstrap>
                                <FiscalAutoSplitBootstrap />
                                <FySnapshotSaveBootstrap />
                                <FyMasterOpeningSaveBootstrap />
                                <VoucherOutboxFlushManager />
                                <PocketBaseLiveSyncManager />
<PocketBaseSyncProgressBadge />
                                <DaybookWedgeSyncManager />
                                <LocalCompanyCloudSyncManager />
                                <CapacitorDriveOAuthReturnHandler />
                                <DriveOAuthReturnBootstrap />
                                <PendingRestoreCloudPushManager />
                                <TooltipProvider>
                                    <MobileDetailSummaryCollapseProvider>
                                      <CountryAppGate>{children}</CountryAppGate>
                                    </MobileDetailSummaryCollapseProvider>
                                </TooltipProvider>
                                </FyVoucherScopeBootstrap>
                            </VoucherProvider>
                        </DialogBackHandlerProvider>
                    </BalanceModeProvider>
                </DateProvider>
                </PlUiHealthBrakeGate>
                {/* Pehli device login: web = short hydrate; APK/static = data mirror splash + background attachment cache */}
                <FirstDeviceCompanyHydrationOverlay />
                </FirstLoginWarmGateProvider>
                </EmbeddedAttachmentPrefetchProvider>
                </EmbeddedLogoutProvider>
            </CompanyProvider>
            </GateProvider>
            </EmbeddedAppDeferredShell>
            </EmbeddedDeviceLockSessionProvider>
        </AuthProvider>
      </ThemeProvider>
    )
}
