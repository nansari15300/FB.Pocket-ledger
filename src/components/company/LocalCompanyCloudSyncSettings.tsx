"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CloudSyncHelpPopover } from "@/components/company/CloudSyncHelpPopover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useToast } from "@/hooks/use-toast";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  disconnectGoogleDrive,
  getGoogleDriveAuthUrl,
  openGoogleDriveOAuthUrl,
  resolveDriveOAuthReturnPath,
} from "@/lib/driveAuthClient";
import { markDriveOAuthReturnGrace } from "@/lib/driveOAuthReturnGrace";
import { getLocalCloudSyncStatus, runLocalCloudSyncCycle } from "@/lib/localCloudSync/engine";
import { runManualDriveAttachmentRehydrate } from "@/lib/localCloudSync/driveFullReupload";
import { backfillLocalDocsToCloudSyncOutbox } from "@/lib/localCloudSync/backfillOutbox";
import { ensureFreshDriveSyncWhenDriveFolderMissing } from "@/lib/localCloudSync/driveFullReupload";
import {
  confirmDriveFolderRepairNow,
  isDriveFolderRepairBlockedMessage,
  readDriveFolderRepairState,
} from "@/lib/localCloudSync/driveFolderRepair";
import { setCloudSyncCursor } from "@/lib/localCloudSync/queue";
import { ensureCloudSyncDriveEncryptionSalt } from "@/lib/localCloudSync/driveEncryption";
import { patchLocalCompanyCloudSyncFields, readCloudSyncConfigFromCompany, isEligibleLocalDriveSyncCompanyRow, localRegistryFieldsForDriveSyncLedger } from "@/lib/localCloudSync/companyConfig";
import type { CloudSyncIntervalSec } from "@/lib/localCloudSync/types";
import {
  CLOUD_SYNC_INTERVAL_SEC_OPTIONS,
  formatCloudSyncCountdownLabel,
  formatCloudSyncIntervalLabel,
} from "@/lib/localCloudSync/types";
import {
  aggregateSyncSummaryForRange,
  CLOUD_SYNC_SUMMARY_RANGE_OPTIONS,
  CLOUD_SYNC_SUMMARY_RESET_OPTIONS,
  emptyCloudSyncLastSyncSummary,
  type CloudSyncSummaryRange,
  type CloudSyncSummaryResetRange,
} from "@/lib/localCloudSync/syncSummaryHistory";
import { forceReencryptDriveIfNeeded } from "@/lib/localCloudSync/forceReencryptDrive";
import {
  cloudSyncEncryptCard,
  cloudSyncFirebaseReconcileCard,
  cloudSyncStatusCard,
  cloudSyncLastSyncSummaryCard,
  cloudSyncSettingsPageShell,
  companyProfileChromeRoot,
} from "@/lib/companyProfileChrome";
import { DriveShareUsersPanel } from "@/components/company/DriveShareUsersPanel";
import { JoinSharedLocalCompanyDialog } from "@/components/company/JoinSharedLocalCompanyDialog";
import { formatDistanceToNow } from "date-fns";
import { Check, ChevronDown, Cloud, FileSearch, Loader2, Pause, Play, RefreshCw, Save, Share2 } from "lucide-react";
import { settingsViewHref } from "@/lib/appNavHref";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ToastAction } from "@/components/ui/toast";
import {
  CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG,
  isCloudSyncEncryptionKeyRequiredError,
} from "@/lib/localCloudSync/driveEncryption";
import {
  FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG,
  LOCAL_UNLOCK_ONLY_DRIVE_MSG,
  getDriveApiUser,
  hasDriveApiAuthSession,
  isLocalSyntheticAuthUid,
  isStoredDriveAuthError,
  waitForFirebaseAuthReady,
} from "@/lib/firebaseAuthForApi";
import {
  PL_DRIVE_CLOUD_SYNC_STATUS_EVENT,
  PL_DRIVE_FOLDER_REPAIR_EVENT,
  type DriveCloudSyncStatusDetail,
  type DriveFolderRepairNeededDetail,
} from "@/lib/localCloudSync/driveCloudSyncUiEvents";
import { readLocalFirebaseReconcileConfig } from "@/lib/localFirebaseReconcile";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

type Props = {
  companyId: string;
  company: LocalCompanyDoc | Record<string, unknown>;
  companyOptions?: Array<{ id: string; name?: string }>;
  onCompanySelect?: (companyId: string) => void;
};

/** Sync card error — encryption / auth / generic alag message. */
function renderCloudSyncStatusError(
  lastError: string | null,
  localSyntheticAuth: boolean
): ReactNode {
  if (!lastError && localSyntheticAuth) {
    return (
      <p className="text-xs text-destructive">
        {LOCAL_UNLOCK_ONLY_DRIVE_MSG}{" "}
        <Link href="/" className="underline font-medium hover:no-underline">
          Sign in with Google
        </Link>
      </p>
    );
  }
  if (!lastError) return null;
  if (isCloudSyncEncryptionKeyRequiredError(lastError)) {
    return (
      <p className="text-xs text-destructive">
        {CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG}{" "}
        <Link href="/settings?view=company" className="underline font-medium hover:no-underline">
          Open Company Profile
        </Link>
      </p>
    );
  }
  if (isStoredDriveAuthError(lastError)) {
    return (
      <p className="text-xs text-destructive">
        {localSyntheticAuth ? LOCAL_UNLOCK_ONLY_DRIVE_MSG : lastError}{" "}
        {localSyntheticAuth ? (
          <Link href="/" className="underline font-medium hover:no-underline">
            Sign in with Google
          </Link>
        ) : (
          <>Then click Connect account below.</>
        )}
      </p>
    );
  }
  return <p className="text-xs text-destructive">Error: {lastError}</p>;
}

/** Sirf device-local companies — Firestore companies par ye card hide. */
export function LocalCompanyCloudSyncSettings({ companyId, company, companyOptions, onCompanySelect }: Props) {
  const { user } = useAuth();
  const { reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const { toast } = useToast();
  const router = useRouter();
  const [joinOpen, setJoinOpen] = useState(false);

  const openCompanyProfile = () => {
    router.push("/settings?view=company");
  };
  const showEncryptionKeyRequiredToast = () => {
    toast({
      variant: "destructive",
      title: "Sync failed",
      description: CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG,
      duration: 8000,
      action: (
        <ToastAction altText="Open Company Profile" onClick={openCompanyProfile}>
          Open Company Profile
        </ToastAction>
      ),
    });
  };

  const [busy, setBusy] = useState(false);
  const [rehydrateBusy, setRehydrateBusy] = useState(false);
  const [summaryRange, setSummaryRange] = useState<CloudSyncSummaryRange>("last");
  const [status, setStatus] = useState({
    pending: 0,
    pendingFiles: 0,
    pendingVouchers: 0,
    lastSyncAt: null as number | null,
    status: "idle",
    lastError: null as string | null,
    lastSyncSummary: {
      addedFiles: 0,
      addedVouchers: 0,
      uploadedFiles: 0,
      uploadedVouchers: 0,
      downloadedFiles: 0,
      downloadedVouchers: 0,
    },
    syncSummaryHistory: [] as Array<{
      at: number;
      addedFiles: number;
      addedVouchers: number;
      uploadedFiles: number;
      uploadedVouchers: number;
      downloadedFiles: number;
      downloadedVouchers: number;
    }>,
    syncSummaryResetAt: null as number | null,
  });
  const [liveSyncProgress, setLiveSyncProgress] = useState({
    uploadedFiles: 0,
    uploadedVouchers: 0,
    downloadedFiles: 0,
    downloadedVouchers: 0,
  });
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairNowMs, setRepairNowMs] = useState(() => Date.now());
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  const [driveFolderRepairLive, setDriveFolderRepairLive] = useState<{
    detectedAt: number;
    autoRepairAt: number;
  } | null>(() => readDriveFolderRepairState(company));
  const lastRepairPromptAtRef = useRef(0);

  const displayedSyncSummary = useMemo(
    () =>
      aggregateSyncSummaryForRange(
        summaryRange,
        status.syncSummaryHistory,
        status.lastSyncSummary,
        summaryRange === "last" ? status.syncSummaryResetAt : null
      ),
    [summaryRange, status.syncSummaryHistory, status.lastSyncSummary, status.syncSummaryResetAt]
  );
  const displayedUploadedFiles = Math.max(displayedSyncSummary.uploadedFiles, liveSyncProgress.uploadedFiles);
  const displayedUploadedVouchers = Math.max(displayedSyncSummary.uploadedVouchers, liveSyncProgress.uploadedVouchers);
  const displayedDownloadedFiles = Math.max(displayedSyncSummary.downloadedFiles, liveSyncProgress.downloadedFiles);
  const displayedDownloadedVouchers = Math.max(
    displayedSyncSummary.downloadedVouchers,
    liveSyncProgress.downloadedVouchers
  );

  const cfg = readCloudSyncConfigFromCompany(company);
  const driveFolderRepair = driveFolderRepairLive;
  const localFirebaseCfg = readLocalFirebaseReconcileConfig(company);

  useEffect(() => {
    if (!driveFolderRepair) return;
    const id = window.setInterval(() => setRepairNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [driveFolderRepair]);

  const [enabled, setEnabled] = useState(cfg.cloudSyncEnabled);
  const [firebaseReconcileEnabled, setFirebaseReconcileEnabled] = useState(localFirebaseCfg.enabled);
  const [encryptDriveData, setEncryptDriveData] = useState(cfg.cloudSyncEncryptDriveData);
  const [encryptDriveFiles, setEncryptDriveFiles] = useState(cfg.cloudSyncEncryptDriveFiles);
  // Background sync interval — registry se load, dropdown change par save.
  const [syncIntervalSec, setSyncIntervalSec] = useState<CloudSyncIntervalSec>(cfg.cloudSyncIntervalSec);
  // Next auto-sync countdown — lastSyncAt + interval se target; har 1 sec UI update.
  const nextSyncAtMsRef = useRef(Date.now() + cfg.cloudSyncIntervalSec * 1000);
  const [nextSyncInSec, setNextSyncInSec] = useState<number>(cfg.cloudSyncIntervalSec);
  /** Untick / toggle ke baad parent company refresh se checkbox wapas tick na ho jab tak Save na ho. */
  const settingsDirtyRef = useRef(false);
  // Local unlock synthetic uid — UI signed-in dikhe par Firebase token nahi hota.
  const localSyntheticAuth = isLocalSyntheticAuthUid(user?.uid);
  const driveSyncDisabled = isLocalGoogleDriveSyncDisabled();
  const driveControlsDisabled = busy || driveSyncDisabled;
  const driveConnected = enabled && !driveSyncDisabled;

  useEffect(() => {
    if (settingsDirtyRef.current) return;
    const next = readCloudSyncConfigFromCompany(company);
    const localNext = readLocalFirebaseReconcileConfig(company);
    setEnabled(next.cloudSyncEnabled);
    setEncryptDriveData(next.cloudSyncEncryptDriveData);
    setEncryptDriveFiles(next.cloudSyncEncryptDriveFiles);
    setSyncIntervalSec(next.cloudSyncIntervalSec);
    setFirebaseReconcileEnabled(localNext.enabled);
  }, [company]);

  useEffect(() => {
    setDriveFolderRepairLive(readDriveFolderRepairState(company));
  }, [company]);

  useEffect(() => {
    if (!driveFolderRepairLive) return;
    if (driveFolderRepairLive.detectedAt <= lastRepairPromptAtRef.current) return;
    lastRepairPromptAtRef.current = driveFolderRepairLive.detectedAt;
    setRepairDialogOpen(true);
  }, [driveFolderRepairLive]);

  useEffect(() => {
    const onRepairNeeded = (event: Event) => {
      const detail = (event as CustomEvent<DriveFolderRepairNeededDetail>).detail;
      if (String(detail?.companyId || "") !== companyId) return;
      const detectedAt = Number(detail.detectedAt);
      const autoRepairAt = Number(detail.autoRepairAt);
      if (!Number.isFinite(detectedAt) || detectedAt <= 0) return;
      if (!Number.isFinite(autoRepairAt) || autoRepairAt <= 0) return;
      setDriveFolderRepairLive({ detectedAt, autoRepairAt });
      reloadLocalCompanyRegistry();
      if (detectedAt > lastRepairPromptAtRef.current) {
        lastRepairPromptAtRef.current = detectedAt;
        setRepairDialogOpen(true);
      }
    };
    window.addEventListener(PL_DRIVE_FOLDER_REPAIR_EVENT, onRepairNeeded);
    return () => window.removeEventListener(PL_DRIVE_FOLDER_REPAIR_EVENT, onRepairNeeded);
  }, [companyId, reloadLocalCompanyRegistry]);

  const refreshStatus = useCallback(async () => {
    const [s, reg] = await Promise.all([
      getLocalCloudSyncStatus(companyId),
      getLocalCompanyById(companyId, { includeDeleted: true }),
    ]);
    setDriveFolderRepairLive(readDriveFolderRepairState(reg));
    setStatus({
      pending: s.pending,
      pendingFiles: s.pendingFiles,
      pendingVouchers: s.pendingVouchers,
      lastSyncAt: s.lastSyncAt,
      status: s.status,
      lastError: s.lastError,
      lastSyncSummary: s.lastSyncSummary,
      syncSummaryHistory: s.syncSummaryHistory,
      syncSummaryResetAt: s.syncSummaryResetAt,
    });
  }, [companyId]);

  const resetSyncSummaryCounts = useCallback(
    async (range: CloudSyncSummaryResetRange) => {
      const resetAt = Date.now();
      const nextLastSummary = emptyCloudSyncLastSyncSummary();
      await patchLocalCompanyCloudSyncFields(companyId, {
        cloudSyncLastSyncSummary: nextLastSummary,
        cloudSyncSummaryResetAt: resetAt,
      });
      setStatus((prev) => ({
        ...prev,
        lastSyncSummary: nextLastSummary,
        syncSummaryResetAt: resetAt,
      }));
      const label = CLOUD_SYNC_SUMMARY_RESET_OPTIONS.find((o) => o.value === range)?.label ?? range;
      toast({
        title: "Sync counts reset",
        description: `Summary display reset from now. History is kept for time-range review.`,
      });
    },
    [companyId, toast]
  );

  const summaryRangeLabel =
    CLOUD_SYNC_SUMMARY_RANGE_OPTIONS.find((o) => o.value === summaryRange)?.label ?? summaryRange;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, enabled]);

  // Firebase sign-in ke baad purana auth error hatao + ek retry (local unlock ≠ Google sign-in).
  useEffect(() => {
    if (!enabled || driveSyncDisabled) return;
    let cancelled = false;
    void (async () => {
      await waitForFirebaseAuthReady();
      if (cancelled) return;
      if (!hasDriveApiAuthSession()) return;
      if (!isStoredDriveAuthError(status.lastError)) return;
      await patchLocalCompanyCloudSyncFields(companyId, {
        cloudSyncStatus: "idle",
        cloudSyncLastError: null,
      });
      await refreshStatus();
      void runLocalCloudSyncCycle(companyId, { force: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, enabled, user?.uid, status.lastError, refreshStatus, driveSyncDisabled]);

  // Card me last sync / pending live update — har 5 sec poll jab sync ON ho.
  useEffect(() => {
    if (!enabled || driveSyncDisabled) return;
    const id = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(id);
  }, [enabled, refreshStatus, driveSyncDisabled]);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<DriveCloudSyncStatusDetail>).detail;
      if (String(detail?.companyId || "") !== companyId) return;
      if (detail.status !== "syncing") {
        setLiveSyncProgress({
          uploadedFiles: 0,
          uploadedVouchers: 0,
          downloadedFiles: 0,
          downloadedVouchers: 0,
        });
        void refreshStatus();
        return;
      }
      setLiveSyncProgress((prev) => ({
        uploadedFiles: Math.max(prev.uploadedFiles, Number(detail.progress?.uploadedFiles) || 0),
        uploadedVouchers: Math.max(prev.uploadedVouchers, Number(detail.progress?.uploadedVouchers) || 0),
        downloadedFiles: Math.max(prev.downloadedFiles, Number(detail.progress?.downloadedFiles) || 0),
        downloadedVouchers: Math.max(prev.downloadedVouchers, Number(detail.progress?.downloadedVouchers) || 0),
      }));
    };
    window.addEventListener(PL_DRIVE_CLOUD_SYNC_STATUS_EVENT, onProgress);
    return () => window.removeEventListener(PL_DRIVE_CLOUD_SYNC_STATUS_EVENT, onProgress);
  }, [companyId, refreshStatus]);

  // Next sync target — last successful sync + interval; interval badle to ab se dubara count.
  useEffect(() => {
    const anchor = status.lastSyncAt ?? Date.now();
    nextSyncAtMsRef.current = anchor + syncIntervalSec * 1000;
  }, [status.lastSyncAt, syncIntervalSec]);

  // Live sec countdown — syncing/busy par 0, warna remaining seconds.
  useEffect(() => {
    if (!enabled || driveSyncDisabled) return;
    const tick = () => {
      if (status.status === "syncing" || busy) {
        setNextSyncInSec(0);
        return;
      }
      setNextSyncInSec(Math.max(0, Math.ceil((nextSyncAtMsRef.current - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [enabled, status.status, status.lastSyncAt, syncIntervalSec, busy, driveSyncDisabled]);

  if (!isEligibleLocalDriveSyncCompanyRow(company)) return null;

  const saveConfig = async (patch: Partial<LocalCompanyDoc>) => {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!reg) return;
    const keepLocalLedger =
      patch.cloudSyncEnabled === true ||
      readCloudSyncConfigFromCompany(reg).cloudSyncEnabled === true ||
      readCloudSyncConfigFromCompany({ ...reg, ...patch }).cloudSyncEnabled === true;
    await upsertLocalCompany({
      ...reg,
      ...(keepLocalLedger ? localRegistryFieldsForDriveSyncLedger() : {}),
      ...patch,
    } as LocalCompanyDoc);
    reloadLocalCompanyRegistry();
  };

  const onToggleEnabled = (checked: boolean) => {
    if (driveSyncDisabled) return;
    settingsDirtyRef.current = true;
    setEnabled(checked);
  };

  const toggleSyncPaused = async () => {
    if (driveSyncDisabled || busy) return;
    const nextEnabled = !enabled;
    setBusy(true);
    try {
      await patchLocalCompanyCloudSyncFields(companyId, {
        cloudSyncEnabled: nextEnabled,
        cloudSyncProvider: nextEnabled ? "google_drive" : null,
        cloudSyncStatus: "idle",
        cloudSyncLastError: null,
      });
      await saveConfig({
        cloudSyncEnabled: nextEnabled,
        cloudSyncProvider: nextEnabled ? "google_drive" : null,
        cloudSyncStatus: "idle",
        cloudSyncLastError: null,
      });
      settingsDirtyRef.current = false;
      setEnabled(nextEnabled);
      await refreshStatus();
      if (nextEnabled) void runLocalCloudSyncCycle(companyId, { force: true });
      toast({
        title: nextEnabled ? "Drive sync resumed" : "Drive sync paused",
        description: nextEnabled
          ? "Background Drive sync is active again."
          : "Background Drive sync is paused for this company.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: nextEnabled ? "Resume failed" : "Pause failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onSyncIntervalChange = async (sec: CloudSyncIntervalSec) => {
    if (driveSyncDisabled) return;
    setSyncIntervalSec(sec);
    await patchLocalCompanyCloudSyncFields(companyId, { cloudSyncIntervalSec: sec });
    reloadLocalCompanyRegistry();
  };

  const saveEncryptionFlags = async (data: boolean, files: boolean, forceReencrypt: boolean) => {
    if (driveSyncDisabled) return;
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const salt =
      data || files
        ? ensureCloudSyncDriveEncryptionSalt(String(reg?.cloudSyncDriveEncryptionSalt ?? ""))
        : String(reg?.cloudSyncDriveEncryptionSalt ?? "").trim() || null;
    await saveConfig({
      cloudSyncEncryptDriveData: data,
      cloudSyncEncryptDriveFiles: files,
      cloudSyncEncryptDrive: data || files,
      ...(salt ? { cloudSyncDriveEncryptionSalt: salt } : {}),
    });
    if (forceReencrypt && (data || files)) {
      setBusy(true);
      try {
        const { dataOps, files: fileCount } = await forceReencryptDriveIfNeeded(companyId);
        toast({
          title: "Encryption applied on Drive",
          description: `Re-encrypted ${dataOps} data ops and ${fileCount} files on Google Drive.`,
        });
        void runLocalCloudSyncCycle(companyId, { force: true });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Force encrypt failed",
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setBusy(false);
      }
    } else if (data || files) {
      toast({
        title: "Drive encryption updated",
        description:
          "If a company password is set in Company Profile, all staff use it as the key. Otherwise use login username and password.",
      });
    }
  };

  const onToggleEncryptDriveData = async (checked: boolean) => {
    setEncryptDriveData(checked);
    await saveEncryptionFlags(checked, encryptDriveFiles, checked);
  };

  const onToggleEncryptDriveFiles = async (checked: boolean) => {
    setEncryptDriveFiles(checked);
    await saveEncryptionFlags(encryptDriveData, checked, checked);
  };

  const saveAllCloudSyncSettings = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
      const salt =
        encryptDriveData || encryptDriveFiles
          ? ensureCloudSyncDriveEncryptionSalt(String(reg?.cloudSyncDriveEncryptionSalt ?? ""))
          : String(reg?.cloudSyncDriveEncryptionSalt ?? "").trim() || null;
      await patchLocalCompanyCloudSyncFields(companyId, {
        cloudSyncEnabled: enabled,
        cloudSyncProvider: enabled ? "google_drive" : null,
        cloudSyncStatus: "idle",
        cloudSyncLastError: null,
        cloudSyncEncryptDriveData: encryptDriveData,
        cloudSyncEncryptDriveFiles: encryptDriveFiles,
        cloudSyncEncryptDrive: encryptDriveData || encryptDriveFiles,
        cloudSyncIntervalSec: syncIntervalSec,
        ...(salt ? { cloudSyncDriveEncryptionSalt: salt } : {}),
      });
      await saveConfig({
        localFirebaseReconcileEnabled: firebaseReconcileEnabled,
      });
      settingsDirtyRef.current = false;
      reloadLocalCompanyRegistry();
      if (enabled) {
        const freshDrive = await ensureFreshDriveSyncWhenDriveFolderMissing(companyId);
        await backfillLocalDocsToCloudSyncOutbox(companyId, freshDrive ? { force: true } : undefined);
        void runLocalCloudSyncCycle(companyId, { force: true });
      }
      toast({
        title: "Settings saved",
        description: enabled
          ? "Drive sync settings saved for this company."
          : "Drive sync is turned off for this company.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const connectDrive = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      const firebaseUser = await getDriveApiUser();
      markDriveOAuthReturnGrace(companyId);
      const { url } = await getGoogleDriveAuthUrl({
        returnPath: resolveDriveOAuthReturnPath(settingsViewHref("local_cloud_sync")),
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? undefined,
        formData: { companyId },
      });
      await openGoogleDriveOAuthUrl(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: isLocalSyntheticAuthUid(user?.uid) ? "Google sign-in required" : "Drive connect failed",
        description:
          msg === FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG || isLocalSyntheticAuthUid(user?.uid)
            ? LOCAL_UNLOCK_ONLY_DRIVE_MSG
            : msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnectDrive = async () => {
    if (driveSyncDisabled) return;
    setBusy(true);
    try {
      await disconnectGoogleDrive();
      toast({ title: "Disconnected", description: "Google Drive unlinked." });
      await refreshStatus();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Disconnect failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const forceSync = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      const backfilled = await backfillLocalDocsToCloudSyncOutbox(companyId, { force: true });
      const res = await runLocalCloudSyncCycle(companyId, { force: true });
      await refreshStatus();
      if (!res.ok) {
        const err = res.error ?? "Unknown error";
        if (isCloudSyncEncryptionKeyRequiredError(err)) {
          showEncryptionKeyRequiredToast();
        } else if (isDriveFolderRepairBlockedMessage(err)) {
          await refreshStatus();
          reloadLocalCompanyRegistry();
          setRepairDialogOpen(true);
        } else {
          toast({ variant: "destructive", title: "Sync failed", description: err });
        }
      } else {
        toast({
          title: "Sync complete",
          description:
            backfilled > 0
              ? `Backfilled ${backfilled} local rows · uploaded ${res.uploaded}, downloaded ${res.downloaded}.`
              : `Uploaded ${res.uploaded}, downloaded ${res.downloaded} operations.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDriveFolderRepair = async () => {
    setRepairDialogOpen(false);
    setDriveFolderRepairLive(null);
    setRepairBusy(true);
    try {
      const ok = await confirmDriveFolderRepairNow(companyId);
      reloadLocalCompanyRegistry();
      await refreshStatus();
      if (!ok) {
        setRepairDialogOpen(true);
        toast({
          variant: "destructive",
          title: "Repair failed",
          description: "Could not prepare a new Drive folder. Use the owner account.",
        });
        return;
      }
      toast({
        title: "New Drive folder queued",
        description: "Uploading your local data to a fresh Pocket Ledger folder now.",
      });
      void runLocalCloudSyncCycle(companyId, { force: true });
    } finally {
      setRepairBusy(false);
    }
  };

  /** Admin / doosre device par data na dikhe — cursor 0 karke saari Drive ops dubara download. */
  const redownloadFromDrive = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      await setCloudSyncCursor(companyId, { lastSyncedOp: 0, lastError: null, syncStatus: "idle" });
      const res = await runLocalCloudSyncCycle(companyId, { force: true });
      await refreshStatus();
      if (!res.ok) {
        const err = res.error ?? "Unknown error";
        if (isCloudSyncEncryptionKeyRequiredError(err)) {
          showEncryptionKeyRequiredToast();
        } else {
          toast({ variant: "destructive", title: "Re-download failed", description: err });
        }
      } else {
        toast({
          title: "Re-download complete",
          description: `Downloaded ${res.downloaded} operations from Drive.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const checkDriveAttachments = async () => {
    if (driveSyncDisabled) {
      toast({ title: "Drive sync disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });
      return;
    }
    setRehydrateBusy(true);
    try {
      const res = await runManualDriveAttachmentRehydrate(companyId);
      await refreshStatus();
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Attachment check failed",
          description: res.error ?? "Unknown error",
        });
        return;
      }
      const repaired = res.reuploadedDriveRefs + res.requeuedLocalFiles + res.uploadedPendingFiles;
      toast({
        title: repaired > 0 ? "Attachments repaired" : "No missing attachments",
        description:
          repaired > 0
            ? `Re-uploaded ${res.reuploadedDriveRefs} file(s), re-queued ${res.requeuedLocalFiles}, uploaded ${res.uploadedPendingFiles} pending.`
            : "All checked Drive attachment refs are present, or local copies are unavailable.",
      });
    } finally {
      setRehydrateBusy(false);
    }
  };

  return (
    <Card
      className={cn(cloudSyncSettingsPageShell, "flex min-h-0 flex-1 flex-col overflow-hidden")}
      {...{ [companyProfileChromeRoot]: "" }}
    >
      <CardHeader className="shrink-0">
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-emerald-900 dark:text-emerald-100">
          <Cloud className="h-4 w-4 shrink-0" />
          <span>Drive sync (local company)</span>
          <CloudSyncHelpPopover
            label="About Drive sync"
            description={
              <>
                <p>
                  Each company gets a Google Drive folder with <span className="font-mono">opening/</span>,{" "}
                  <span className="font-mono">data/</span>, <span className="font-mono">attachments/</span>, and{" "}
                  <span className="font-mono">backup/</span>.
                </p>
                <p>
                  Attachments go under <span className="font-mono">attachments/vouchers/</span>,{" "}
                  <span className="font-mono">attachments/parties/</span>, etc., then a date folder (AD / BS per
                  settings).
                </p>
                <p>
                  Every save creates a delta JSON file under <span className="font-mono">data/ops/</span> (not a
                  separate folder per voucher type for operations).
                </p>
              </>
            }
          />
          {/* Enable sync — (i) icon ke right, same header row */}
          <div className="flex items-center gap-2 ml-0.5">
            <Checkbox
              id="local-company-cloud-sync-enabled"
              checked={enabled}
              onCheckedChange={(v) => onToggleEnabled(v === true)}
              disabled={driveSyncDisabled}
            />
            <Label
              htmlFor="local-company-cloud-sync-enabled"
              className={cn("text-sm font-normal", driveSyncDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}
            >
              Enable Drive sync
            </Label>
          </div>
        </CardTitle>
      </CardHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4">
        {driveSyncDisabled ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
            {LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE}
          </p>
        ) : null}
          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,13fr)] gap-4 items-stretch">
            {/* Left 35% — sync, encrypt, folder options */}
            <div className="flex w-full min-w-0 flex-col space-y-4 order-2 lg:order-1 min-h-0">
              <div className={cloudSyncFirebaseReconcileCard}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Label
                      htmlFor="local-company-firebase-reconcile-enabled"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Firebase reconcile (invited ledger only)
                    </Label>
                    <CloudSyncHelpPopover
                      label="Firebase reconcile (invited ledger only)"
                      description={
                        <>
                          <p>
                            When Google Drive sync is off and this is enabled, only the{" "}
                            <strong>linked reconciliation</strong> account is sent to Firebase, not the full company.
                          </p>
                          <p>
                            Related voucher ledger lines are included only when they fall within the shared date range.
                          </p>
                          <p>
                            <strong>Files and attachments are not sent to Firebase</strong>; only data such as amount,
                            date, and narration is included.
                          </p>
                          <p>This mode is automatically paused while Drive sync is active to avoid conflicts.</p>
                        </>
                      }
                    />
                  </div>
                  <Checkbox
                    id="local-company-firebase-reconcile-enabled"
                    checked={firebaseReconcileEnabled}
                    onCheckedChange={(v) => {
                      settingsDirtyRef.current = true;
                      setFirebaseReconcileEnabled(v === true);
                    }}
                    disabled={busy || driveConnected}
                  />
                </div>
                {driveConnected ? (
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    Google Drive sync is active, so Firebase reconcile is temporarily paused to avoid conflicts.
                  </p>
                ) : null}
              </div>

              <div className={cloudSyncEncryptCard}>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-foreground">Encrypt on Google Drive (AES)</p>
                  <CloudSyncHelpPopover
                    label="Encryption"
                    description={
                      <>
                        <p>
                          Encryption key: <strong>Company Profile password</strong> (all staff) or this device&apos;s{" "}
                          <strong>company login username + password</strong>.
                        </p>
                        <p>
                          <strong>Encrypt data (JSON):</strong> <span className="font-mono">data/ops/</span> and{" "}
                          <span className="font-mono">opening/</span> — turning on re-encrypts any plain files on Drive.
                        </p>
                        <p>
                          <strong>Encrypt files (attachments):</strong> voucher and item files stored as{" "}
                          <span className="font-mono">.plenc.json</span>.
                        </p>
                      </>
                    }
                  />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="local-company-cloud-sync-encrypt-data"
                    checked={encryptDriveData}
                    onCheckedChange={(v) => void onToggleEncryptDriveData(v === true)}
                    disabled={driveControlsDisabled}
                  />
                  <Label htmlFor="local-company-cloud-sync-encrypt-data" className="text-sm font-normal cursor-pointer">
                    Encrypt data (JSON)
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="local-company-cloud-sync-encrypt-files"
                    checked={encryptDriveFiles}
                    onCheckedChange={(v) => void onToggleEncryptDriveFiles(v === true)}
                    disabled={driveControlsDisabled}
                  />
                  <Label htmlFor="local-company-cloud-sync-encrypt-files" className="text-sm font-normal cursor-pointer">
                    Encrypt files (attachments)
                  </Label>
                </div>
              </div>

              {driveFolderRepair && enabled ? (
                <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <p className="font-medium">Drive folder not found</p>
                  <p className="mt-1 text-xs sm:text-sm">
                    The Pocket Ledger folder on Google Drive is missing or inaccessible. Sync is paused so duplicate
                    folders are not created. Confirm to upload to a new folder now, or wait{" "}
                    <strong>
                      {Math.max(0, Math.ceil((driveFolderRepair.autoRepairAt - repairNowMs) / 1000))} sec
                    </strong>{" "}
                    for automatic repair.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 rounded-full"
                    disabled={repairBusy || driveControlsDisabled}
                    onClick={() => void confirmDriveFolderRepair()}
                  >
                    {repairBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create new folder now"}
                  </Button>
                </div>
              ) : null}

              {/* Sync summary — compact grid table */}
              <div className={cloudSyncLastSyncSummaryCard}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="font-medium text-sm text-foreground shrink-0">Sync summary</p>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 rounded-full border-sky-300 bg-sky-50 px-2.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-55"
                      onClick={() => void toggleSyncPaused()}
                      disabled={driveControlsDisabled}
                    >
                      {enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      <span>{enabled ? "Pause" : "Resume"}</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 min-w-[6.5rem] max-w-[9rem] shrink-0 justify-between gap-1 px-2 text-xs font-normal"
                      >
                        <span className="truncate">{summaryRangeLabel}</span>
                        <ChevronDown className="size-3 shrink-0 opacity-50" />
                      </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[8.5rem]">
                      {CLOUD_SYNC_SUMMARY_RANGE_OPTIONS.map((opt) => (
                        <DropdownMenuItem
                          key={opt.value}
                          className="text-xs"
                          onSelect={() => setSummaryRange(opt.value)}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-3.5",
                              summaryRange === opt.value ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {opt.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="text-xs">Reset count</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-[8.5rem]">
                          {CLOUD_SYNC_SUMMARY_RESET_OPTIONS.map((opt) => (
                            <DropdownMenuItem
                              key={opt.value}
                              className="text-xs"
                              onSelect={() => void resetSyncSummaryCounts(opt.value)}
                            >
                              {opt.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="overflow-hidden rounded-md border border-black/25 bg-white/55 dark:border-emerald-900/55 dark:bg-emerald-950/25">
                  <table className="w-full table-fixed text-xs border-collapse">
                    <colgroup>
                      <col />
                      <col className="w-[30%]" />
                      <col className="w-[30%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="border-b border-r border-black/25 py-1.5 px-2 text-left font-medium dark:border-emerald-900/55">
                          Action
                        </th>
                        <th className="border-b border-r border-black/25 py-1.5 px-2 text-center font-medium dark:border-emerald-900/55">
                          file
                        </th>
                        <th className="border-b border-black/25 py-1.5 px-2 text-center font-medium dark:border-emerald-900/55">
                          voucher
                        </th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      <tr>
                        <td className="border-b border-r border-black/25 py-1.5 px-2 font-medium capitalize text-muted-foreground dark:border-emerald-900/55">
                          queue
                        </td>
                        <td className="border-b border-r border-black/25 py-1.5 px-2 text-center dark:border-emerald-900/55">
                          {status.pendingFiles}
                        </td>
                        <td className="border-b border-black/25 py-1.5 px-2 text-center dark:border-emerald-900/55">
                          {status.pendingVouchers}
                        </td>
                      </tr>
                      <tr>
                        <td className="border-b border-r border-black/25 py-1.5 px-2 font-medium capitalize text-muted-foreground dark:border-emerald-900/55">
                          uploaded
                        </td>
                        <td className="border-b border-r border-black/25 py-1.5 px-2 text-center dark:border-emerald-900/55">
                          {displayedUploadedFiles}
                        </td>
                        <td className="border-b border-black/25 py-1.5 px-2 text-center dark:border-emerald-900/55">
                          {displayedUploadedVouchers}
                        </td>
                      </tr>
                      <tr>
                        <td className="border-r border-black/25 py-1.5 px-2 font-medium capitalize text-muted-foreground dark:border-emerald-900/55">
                          downloaded
                        </td>
                        <td className="border-r border-black/25 py-1.5 px-2 text-center dark:border-emerald-900/55">
                          {displayedDownloadedFiles}
                        </td>
                        <td className="py-1.5 px-2 text-center">{displayedDownloadedVouchers}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Left column — sync status */}
              <div className={cloudSyncStatusCard}>
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">Sync status</p>
                  <p>
                    Last sync:{" "}
                    <strong>
                      {status.lastSyncAt ? formatDistanceToNow(status.lastSyncAt, { addSuffix: true }) : "never"}
                    </strong>
                  </p>
                  <p>
                    Pending sync: <strong>{status.pending}</strong>
                  </p>
                  <p>
                    Status: <strong>{enabled ? status.status : "paused"}</strong>
                  </p>
                  <p>
                    Next sync:{" "}
                    <strong>
                      {!enabled
                        ? "paused"
                        : status.status === "syncing" || busy
                          ? "now"
                          : formatCloudSyncCountdownLabel(nextSyncInSec)}
                    </strong>
                  </p>
                </div>
                {renderCloudSyncStatusError(status.lastError, localSyntheticAuth)}
                <div className="space-y-2">
                  <Label htmlFor="cloud-sync-interval-select" className="text-xs">
                    Sync interval
                  </Label>
                  <Select
                    value={String(syncIntervalSec)}
                    disabled={driveControlsDisabled}
                    onValueChange={(v) => void onSyncIntervalChange(Number(v) as CloudSyncIntervalSec)}
                  >
                    <SelectTrigger id="cloud-sync-interval-select" className="h-9 w-full max-w-[10rem] text-sm">
                      <SelectValue placeholder="Interval" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLOUD_SYNC_INTERVAL_SEC_OPTIONS.map((sec) => (
                        <SelectItem key={sec} value={String(sec)}>
                          {formatCloudSyncIntervalLabel(sec)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Right 65% — Share company on Drive (poori card height) */}
            <div className="flex w-full min-w-0 order-1 lg:order-2 h-full min-h-0 flex-col">
              <DriveShareUsersPanel
                  companyId={companyId}
                  companyName={typeof company.name === "string" ? company.name : undefined}
                  company={company}
                  companyOptions={companyOptions}
                  onCompanySelect={onCompanySelect}
                  disabled={driveControlsDisabled}
                  onUsersChanged={reloadLocalCompanyRegistry}
                />
            </div>
          </div>
        </div>

        {/* Footer — sync actions; hamesha card ke niche fixed, content overlap nahi */}
        <footer className="shrink-0 border-t border-emerald-200/80 bg-emerald-50/70 px-6 py-3 shadow-[0_-2px_8px_rgba(16,185,129,0.06)] dark:border-emerald-900/50 dark:bg-emerald-950/35">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
          {enabled ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                disabled={driveControlsDisabled}
                onClick={() => void connectDrive()}
              >
                Connect account
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                disabled={driveControlsDisabled}
                onClick={() => void disconnectDrive()}
              >
                Disconnect
              </Button>
            </>
          ) : null}
          {enabled ? (
            <>
              <Button
                type="button"
                size="sm"
                className="rounded-full bg-emerald-600 px-4 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                disabled={driveControlsDisabled}
                onClick={() => void forceSync()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Force sync now
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                disabled={driveControlsDisabled}
                onClick={() => void redownloadFromDrive()}
              >
                Re-download from Drive
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                disabled={driveControlsDisabled || rehydrateBusy}
                onClick={() => void checkDriveAttachments()}
              >
                {rehydrateBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <FileSearch className="h-4 w-4 mr-1.5" />
                )}
                Check attachments
              </Button>
              <CloudSyncHelpPopover
                label="Sync status & actions"
                hasError={!!status.lastError || localSyntheticAuth}
                description={
                  <>
                    <p>
                      <strong>Connect account:</strong> link Google Drive on this device for upload/download.
                    </p>
                    <p>
                      <strong>Disconnect:</strong> remove the Drive link from this device (data on Drive stays).
                    </p>
                    <p>
                      <strong>Force sync now:</strong> upload pending changes and download updates from Drive.
                    </p>
                    <p>
                      <strong>Re-download from Drive:</strong> reset sync cursor and pull all operations again (use when
                      another device has data but this one does not).
                    </p>
                    <p>
                      <strong>Check attachments:</strong> scan all local attachment refs on Drive; re-upload any
                      missing files (runs automatically every 6 hours; use this button anytime).
                    </p>
                    <hr className="border-border my-2" />
                    <p>
                      Status: <strong>{status.status}</strong>
                    </p>
                    <p>
                      Pending operations: <strong>{status.pending}</strong>
                    </p>
                    <p>
                      Last sync:{" "}
                      <strong>
                        {status.lastSyncAt ? formatDistanceToNow(status.lastSyncAt, { addSuffix: true }) : "never"}
                      </strong>
                    </p>
                    {renderCloudSyncStatusError(status.lastError, localSyntheticAuth)}
                  </>
                }
              />
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full px-4"
            disabled={driveControlsDisabled}
            onClick={() => void saveAllCloudSyncSettings()}
          >
            <Save className="h-4 w-4 mr-1.5" />
            Save
          </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full px-4 ml-auto shrink-0"
            disabled={driveControlsDisabled}
            onClick={() => setJoinOpen(true)}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Join shared local company
          </Button>
        </div>
        </footer>
      </div>

      <JoinSharedLocalCompanyDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onJoined={() => {
          reloadLocalCompanyRegistry();
          triggerSync();
        }}
      />

      <AlertDialog open={repairDialogOpen} onOpenChange={setRepairDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drive folder missing</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  The Pocket Ledger company folder on Google Drive was deleted or is inaccessible. Sync is paused so
                  duplicate folders are not created.
                </p>
                {repairBusy ? (
                  <p>Creating a new Drive folder and starting upload now…</p>
                ) : driveFolderRepair ? (
                  <p>
                    Create a new folder now, or wait{" "}
                    <strong>
                      {Math.max(0, Math.ceil((driveFolderRepair.autoRepairAt - repairNowMs) / 1000))} sec
                    </strong>{" "}
                    for automatic repair.
                  </p>
                ) : (
                  <p>Create a new folder now, or wait up to 2 minutes for automatic repair.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={repairBusy}>Wait</AlertDialogCancel>
            <AlertDialogAction
              disabled={repairBusy || driveControlsDisabled}
              onClick={(e) => {
                e.preventDefault();
                void confirmDriveFolderRepair();
              }}
            >
              {repairBusy ? "Preparing…" : "Create new folder now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
