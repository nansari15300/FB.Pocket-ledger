"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { getOrCreateDeviceId } from "@/lib/writeGateway/legacy/deviceLimitClient";
import { claimDuplicateAutoMove, releaseDuplicateAutoMove } from "@/lib/galleryDuplicateMove";
import { OCR_SWITCH_EVENT, queueOcrHandoff } from "@/modules/ocr/handoff";
import { activeRunnerFromSettings, enforceProfileRules, type AutoPostMode } from "@/components/gallery/autoPostMode";
import {
  AUTO_POST_FORM_VALUES_CHANGED,
  AUTO_POST_PAUSE_CAUSE_RESOLVED,
  AUTO_POST_VOUCHER_TYPE_CHANGED,
  isSameMissingSet,
  isTypeSwitchPendingMissing,
  shouldAutoResume,
  type PauseCause,
} from "@/components/gallery/autoPostPauseResume";
import { DEFAULT_GALLERY_QUEUE_SEQUENCE, DEFAULT_GALLERY_SORT_ORDER, normalizeGalleryQueueSequence, normalizeGallerySortOrder, orderGalleryQueue, type GalleryQueueSequence, type GallerySortOrder } from "@/components/gallery/galleryQueueSequence";
import { initialRunRemaining, normalizeScanRunLimit } from "@/components/gallery/scanRunLimit";
import {
  classifyOcrFailure,
  fatalOcrMessage,
  isAmountMismatchField,
  isIdleRunState,
  isItemRowCountMismatchField,
  isMissingItemMasterField,
  missingFieldRuleKey,
  OCR_RETRY_LIMIT,
  OCR_UNAVAILABLE_MESSAGE,
  ocrHandoffDefaultDueDays,
  rateLimitWaitMs,
  recordRateLimitCall,
  retryBackoffMs,
  shouldBeginNewBudget,
  shouldSkipScheduleTick,
  startBudgetReason,
  resetRunCounterState,
  shouldHoldWhenQueueEmpty,
  shouldRestoreRunOnLoad,
  shouldStopDrainAfterJob,
} from "@/components/gallery/autoPostRunPolicy";
import { AUTO_POST_UI, useAutoPostUiCopy } from "@/components/gallery/autoPostUiCopy";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type LocalAutoPostSettings = {
  enabled: boolean;
  processingMode: "semi" | "full";
  runLocation: "local-pc" | "server";
  runOnUpload: boolean;
  runOnSchedule: boolean;
  maxVouchersPerRun: number | "all";
  scheduleMode: "interval" | "date-time";
  scheduleMinutes: number;
  scheduleDate: string;
  scheduleTime: string;
  autoSaveEnabled: boolean;
  overwriteEdited: boolean;
  autoSaveSeconds: number;
  scanEngine: "gemini" | "google" | "azure" | "auto";
  maxCallsPerMinute: number;
  localRunnerUid: string;
  localRunnerDeviceId: string;
  missingFieldAction: "fail-and-continue" | "pause-and-hold";
  missingFieldRules: {
    debitMaster: "fail-and-continue" | "pause-and-hold";
    creditMaster: "fail-and-continue" | "pause-and-hold";
    item: "fail-and-continue" | "pause-and-hold" | "save-without";
    date: "fail-and-continue" | "pause-and-hold";
    tax: "fail-and-continue" | "pause-and-hold";
    other: "fail-and-continue" | "pause-and-hold";
  };
  itemRowMismatchAction: "fail-and-continue" | "pause-and-hold";
  amountMismatchAction: "fail-and-continue" | "pause-and-hold";
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: "move-to-duplicates" | "save-anyway" | "pause-for-review";
  defaultDueDaysSale: number | null;
  defaultDueDaysPurchase: number | null;
  queueSequence: GalleryQueueSequence;
  gallerySortOrder: GallerySortOrder;
  activeRunnerMode?: AutoPostMode;
  runnerProfiles?: unknown;
};

type UnassignedRow = {
  id: string;
  url?: string;
  path?: string;
  name?: string;
  type?: string;
  status?: string;
  uploadedAt?: unknown;
  isDeleted?: boolean;
  deleted?: boolean;
  autoOcrStatus?: string;
  autoOcrProvider?: "gemini" | "google" | "azure" | "auto";
  autoOcrStartedAtMs?: number;
  autoOcrHeartbeatAtMs?: number;
  autoOcrDeviceId?: string;
  autoPostIgnoreDuplicateOnce?: boolean;
  restoredFromDuplicateAtMs?: number;
  updatedAt?: unknown;
};

type AutoOcrProvider = "auto" | "gemini" | "google" | "azure";
const AUTO_OCR_PROVIDERS: readonly AutoOcrProvider[] = ["auto", "gemini", "google", "azure"];

function normalizeAutoOcrProvider(value: unknown): AutoOcrProvider {
  const raw = String(value ?? "").trim().toLowerCase();
  return (AUTO_OCR_PROVIDERS as readonly string[]).includes(raw) ? (raw as AutoOcrProvider) : "auto";
}

const SETTINGS_DOC_ID = "server_auto_ocr";
const CLAIM_STALE_MS = 5 * 60_000;
const CLAIM_HEARTBEAT_MS = 10_000;
const CLAIM_HEARTBEAT_STALE_MS = 35_000;
const LOCAL_SCHEDULE_KEY = "pl.gallery.auto-ocr.local.schedule.v1";
/** Web Lock held by the tab that is processing a job; it dies with the tab (refresh / close). */
const jobLockName = (fsId: string, rowId: string) => `pl.gallery.auto-post.job:${fsId}:${rowId}`;
function webLocks(): LockManager | null {
  try { return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null; } catch { return null; }
}
const RATE_LIMIT_RETRY_BASE_MS = 5_000;
const RATE_LIMIT_RETRY_MAX_MS = 60_000;

function isServerRateLimitError(error: unknown): boolean {
  const e = error as { status?: unknown; message?: unknown } | null;
  return Number(e?.status) === 429 || /too many requests|rate.?limit/i.test(String(e?.message ?? ""));
}

function queueClaimVersion(row: UnassignedRow): string {
  const updatedAt = row.updatedAt as { toMillis?: () => number; seconds?: number } | undefined;
  const editedAt = typeof updatedAt?.toMillis === "function"
    ? updatedAt.toMillis()
    : Number(updatedAt?.seconds || 0);
  return [row.status || "", row.autoOcrStatus || "", row.autoOcrStartedAtMs || 0, row.restoredFromDuplicateAtMs || 0, editedAt].join(":");
}

function unassignedAfterRunnerCancel(row: UnassignedRow): Record<string, unknown> {
  const data = { ...row } as Record<string, unknown>;
  delete data.id;
  return {
    ...data,
    status: "FREE",
    isDeleted: false,
    deleted: false,
    autoOcrStatus: "queued",
    autoOcrError: "",
    autoOcrProvider: "",
    autoOcrFinishedAt: null,
    autoOcrStartedAtMs: 0,
    autoOcrHeartbeatAtMs: 0,
    autoOcrDeviceId: "",
    autoOcrUserId: "",
    autoOcrVoucherId: "",
    autoPostIgnoreDuplicateOnce: false,
    restoredFromDuplicateAtMs: 0,
    duplicateOfVoucherId: "",
    duplicateOfVoucherNumber: "",
    duplicateReason: "",
    duplicateReasons: [],
    duplicateOcrNarration: "",
    duplicateMatchedNarration: "",
    duplicateMatchedRef: "",
    duplicateMatchedAmount: 0,
    duplicateMatchedDateText: "",
    duplicateIncomingRef: "",
    movedAtMs: 0,
  };
}


function normalizeRunnerVoucherTab(value: unknown): string {
  const type = String(value || "").trim().toLowerCase().replace(/[\s-]/g, "_");
  const allowed = new Set([
    "sale", "purchase", "payment_in", "payment_out", "contra", "journal",
    "direct_income", "direct_expense", "note", "debit_note", "credit_note",
    "production", "adjustment", "salary",
  ]);
  return allowed.has(type) ? type : "sale";
}

export function GalleryLocalAutoPostRunner({
  settings,
  settingsDialogOpen,
  isCompanyAdmin,
  settingsReady,
}: {
  settings: LocalAutoPostSettings;
  settingsDialogOpen: boolean;
  isCompanyAdmin: boolean;
  settingsReady: boolean;
}) {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const { t: tUi } = useAutoPostUiCopy();
  const masters = useVouchers();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const fsId = String((company as any)?.authoritativeCompanyId || companyId || "").trim();
  const runnerHoldStorageKey = `pl.gallery.auto-post.runner-hold.v1:${fsId}:${deviceId}`;
  const readRunnerHeld = (key: string) => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(key) === "held"; } catch { return false; }
  };
  const settingsRef = useMemo(() => fsId ? doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID) : null, [fsId]);
  const canRun = settingsReady && settings.enabled && settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId &&
    !!fsId && !settingsDialogOpen;
  const canControlRunner = settings.runLocation === "local-pc" && isCompanyAdmin &&
    !!user?.uid && settings.localRunnerUid === user.uid && settings.localRunnerDeviceId === deviceId && !!fsId;
  const [rows, setRows] = useState<UnassignedRow[]>([]);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherData, setVoucherData] = useState<Record<string, unknown> | null>(null);
  const [processDialogVisible, setProcessDialogVisible] = useState(true);
  const [runnerHeld, setRunnerHeld] = useState(() => readRunnerHeld(runnerHoldStorageKey));
  const [runnerHoldLoadedFor, setRunnerHoldLoadedFor] = useState(runnerHoldStorageKey);
  const [activeProcess, setActiveProcess] = useState<{ id: string; name: string } | null>(null);
  const activeJobRef = useRef<UnassignedRow | null>(null);
  const lastScanErrorRef = useRef<{ jobId: string; message: string } | null>(null);
  const busyRef = useRef(false);
  const runnerHeldRef = useRef(runnerHeld);
  const runnerStartedRef = useRef(!runnerHeld);
  const drainQueueRef = useRef(false);
  const staleRetryTimerRef = useRef<number | null>(null);
  const rateLimitRetryTimerRef = useRef<number | null>(null);
  const rateLimitUntilRef = useRef(0);
  const rateLimitAttemptRef = useRef(0);
  const claimBlockedVersionsRef = useRef(new Map<string, string>());
  /* The Unassigned snapshot comes from this browser's local copy; claims read the server. When the local copy is
   * stale (e.g. a file already "failed" on the server still looks waiting here), card No. 1 is rejected on every
   * Start and the runner reports "no files". Keep the server state for that row until the local copy changes. */
  const serverRowOverridesRef = useRef(new Map<string, { staleVersion: string; data: Record<string, unknown> | null }>());
  const lastClaimServerRowRef = useRef<{ id: string; data: Record<string, unknown> | null } | null>(null);
  const applyServerRowOverrides = (list: UnassignedRow[]): UnassignedRow[] => {
    const overrides = serverRowOverridesRef.current;
    if (!overrides.size) return list;
    const out: UnassignedRow[] = [];
    for (const row of list) {
      const o = overrides.get(row.id);
      if (!o) { out.push(row); continue; }
      if (queueClaimVersion(row) !== o.staleVersion) { overrides.delete(row.id); out.push(row); continue; }
      if (o.data) out.push({ ...row, ...(o.data as Partial<UnassignedRow>), id: row.id });
    }
    return out;
  };
  const healRowFromServer = (row: UnassignedRow, data: Record<string, unknown> | null) => {
    serverRowOverridesRef.current.set(row.id, { staleVersion: queueClaimVersion(row), data });
    rowsRef.current = applyServerRowOverrides(rowsRef.current);
    setRows(rowsRef.current);
    if (!data || !fsId) return;
    // Repair the local copy too (same call the sync uses when the server rejects a stale local write).
    void import("@/lib/localCompanyDocMirror")
      .then(({ upsertCompanyDocInBrowserDb }) => upsertCompanyDocInBrowserDb(fsId, "unassigned_documents", row.id, { ...data, id: row.id }, {
        force: true, notify: true, skipPlanMutationGate: true, skipCloudSyncEnqueue: true,
      }))
      .catch((error) => console.warn("[GalleryLocalAutoPost] could not refresh the local Unassigned copy", error));
  };
  const manualRetryIdsRef = useRef<Set<string>>(new Set());
  /** Retry pressed while no run was draining: stop after the retried files (a Start run keeps going). */
  const retryOnlyRunRef = useRef(false);
  const processPendingRef = useRef<() => Promise<void>>(async () => {});
  const savedJobRef = useRef(false);
  const handledMissingJobIdRef = useRef("");
  const saveWithoutRetryJobIdRef = useRef("");
  const handledDuplicateJobIdRef = useRef("");
  const pauseCauseRef = useRef<PauseCause | null>(null);
  const lastMissingRef = useRef<{ jobId: string; missing: string[]; fieldKeys: string[] } | null>(null);
  const autoResumeTimerRef = useRef<number | null>(null);
  const autoResumeArmedRef = useRef(true);
  const ignoreFormChangedUntilRef = useRef(0);
  const skipCurrentJobIdRef = useRef("");
  const rowsRef = useRef<UnassignedRow[]>([]);
  const cancelledJobIdsRef = useRef(new Set<string>());
  const galleryQueueOrderRef = useRef<{
    companyId: string;
    fileIds: string[];
    queueSequence: GalleryQueueSequence | null;
    gallerySortOrder: GallerySortOrder | null;
    columns: number | null;
  }>({ companyId: "", fileIds: [], queueSequence: null, gallerySortOrder: null, columns: null });
  const settingsRefValue = useRef(settings);
  settingsRefValue.current = settings;
  rowsRef.current = rows;
  runnerHeldRef.current = runnerHeld;
  const runRemainingRef = useRef<number | null>(null);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const scannedThisRunRef = useRef(0);
  const runQueueTotalRef = useRef(0);
  const budgetExhaustedToastRef = useRef(false);
  const startAttemptRef = useRef(false);
  const startBlockedReasonRef = useRef("");
  const startBlockedSeqRef = useRef(0);
  const publishProcessStateRef = useRef<() => void>(() => {});
  const wantRestoreRunningRef = useRef(false);
  const rowsReadyRef = useRef(false);
  const countEligibleRows = (list: UnassignedRow[]) => list.filter((row) =>
    !!row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" &&
    row.isDeleted !== true && row.deleted !== true &&
    ((row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed") || Number(row.restoredFromDuplicateAtMs || 0) > 0)
  ).length;
  const isStaleProcessingClaim = (row: { autoOcrHeartbeatAtMs?: unknown; autoOcrStartedAtMs?: unknown }) => {
    const heartbeatAt = Number(row.autoOcrHeartbeatAtMs || row.autoOcrStartedAtMs || 0);
    if (!Number.isFinite(heartbeatAt) || heartbeatAt <= 0) return true;
    return Date.now() - heartbeatAt >= CLAIM_HEARTBEAT_STALE_MS;
  };
  const publishStartBlocked = (reason: string) => {
    startBlockedReasonRef.current = reason;
    startBlockedSeqRef.current += 1;
    startAttemptRef.current = false;
    publishProcessStateRef.current();
  };
  const clearStartBlocked = () => {
    startBlockedReasonRef.current = "";
    startAttemptRef.current = false;
  };
  const startBlockedCanRunReason = () => {
    if (!settingsReady) return AUTO_POST_UI.startBlockedSettingsLoading;
    if (!settingsRefValue.current.enabled) return AUTO_POST_UI.startBlockedNotEnabled;
    if (settingsRefValue.current.runLocation !== "local-pc") return AUTO_POST_UI.startBlockedDeviceMismatch;
    if (!isCompanyAdmin) return AUTO_POST_UI.startBlockedNotAdmin;
    if (!user?.uid || settingsRefValue.current.localRunnerUid !== user.uid || settingsRefValue.current.localRunnerDeviceId !== deviceId) return AUTO_POST_UI.startBlockedDeviceMismatch;
    if (!fsId) return AUTO_POST_UI.startBlockedDeviceMismatch;
    if (settingsDialogOpen) return AUTO_POST_UI.startBlockedSettingsOpen;
    if (runnerHoldLoadedFor !== runnerHoldStorageKey) return AUTO_POST_UI.startBlockedSettingsLoading;
    return AUTO_POST_UI.startBlockedNotEnabled;
  };
  const callTimesRef = useRef<number[]>([]);
  const ocrRetryCountRef = useRef(0);
  const rateLimitWaitTimerRef = useRef<number | null>(null);
  const ocrRetryTimerRef = useRef<number | null>(null);
  const waitMessageRef = useRef("");
  const waitUntilRef = useRef(0);
  const [waitBanner, setWaitBanner] = useState<{ message: string; seconds: number } | null>(null);
  const [scheduleStartPrompt, setScheduleStartPrompt] = useState(false);
  const suppressCancelRef = useRef(false);
  const runState = () => ({
    busy: busyRef.current,
    draining: drainQueueRef.current,
    remaining: runRemainingRef.current,
    held: runnerHeldRef.current,
  });
  const beginScanRun = () => {
    runRemainingRef.current = initialRunRemaining(normalizeScanRunLimit(settingsRefValue.current.maxVouchersPerRun));
    scannedThisRunRef.current = 0;
    ocrRetryCountRef.current = 0;
    drainQueueRef.current = true;
    budgetExhaustedToastRef.current = false;
    runQueueTotalRef.current = Math.max(pendingIdsRef.current.size, countEligibleRows(rowsRef.current));
  };
  const resetScanRunCounter = () => {
    runRemainingRef.current = initialRunRemaining(normalizeScanRunLimit(settingsRefValue.current.maxVouchersPerRun));
    scannedThisRunRef.current = 0;
  };
  const consumeScanRunSlot = () => {
    if (runRemainingRef.current == null) return;
    runRemainingRef.current = Math.max(0, runRemainingRef.current - 1);
    scannedThisRunRef.current += 1;
    if (runRemainingRef.current === 0) drainQueueRef.current = false;
  };
  const clearWaitBanner = () => {
    waitMessageRef.current = "";
    waitUntilRef.current = 0;
    setWaitBanner(null);
  };
  const startWaitCountdown = (untilMs: number, messagePrefix = AUTO_POST_UI.limitReachedPrefix) => {
    waitUntilRef.current = untilMs;
    const tick = () => {
      const leftMs = Math.max(0, waitUntilRef.current - Date.now());
      const seconds = Math.ceil(leftMs / 1000);
      waitMessageRef.current = `${messagePrefix}${seconds}${AUTO_POST_UI.limitReachedSuffix}`;
      setWaitBanner({ message: waitMessageRef.current, seconds });
      if (leftMs <= 0) {
        if (rateLimitWaitTimerRef.current != null) window.clearTimeout(rateLimitWaitTimerRef.current);
        rateLimitWaitTimerRef.current = null;
        clearWaitBanner();
        if (!runnerHeldRef.current) {
          drainQueueRef.current = drainQueueRef.current || runRemainingRef.current !== 0;
          void processPendingRef.current();
        }
        return;
      }
      rateLimitWaitTimerRef.current = window.setTimeout(tick, 250);
    };
    if (rateLimitWaitTimerRef.current != null) window.clearTimeout(rateLimitWaitTimerRef.current);
    tick();
  };
  useEffect(() => {
    const held = readRunnerHeld(runnerHoldStorageKey);
    runnerHeldRef.current = held;
    runnerStartedRef.current = !held;
    setRunnerHeld(held);
    setRunnerHoldLoadedFor(runnerHoldStorageKey);
    // Saved "running" must resume on load; otherwise the UI looks live but drain is off
    // until the user presses Stop and then Start.
    wantRestoreRunningRef.current = !held;
  }, [runnerHoldStorageKey]);
  useEffect(() => {
    if (runnerHoldLoadedFor !== runnerHoldStorageKey) return;
    if (!wantRestoreRunningRef.current || runnerHeld) return;
    if (!canRun || masters.loading) return;
    wantRestoreRunningRef.current = false;
    // Decision 5: Start-only mode never starts by itself after a reload — it waits for Start.
    if (!shouldRestoreRunOnLoad(settingsRefValue.current, false)) {
      runnerHeldRef.current = true;
      runnerStartedRef.current = false;
      drainQueueRef.current = false;
      try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
      setRunnerHeld(true);
      return;
    }
    startAttemptRef.current = true;
    beginScanRun();
    busyRef.current = false;
    void processPendingRef.current();
  }, [canRun, masters.loading, runnerHeld, runnerHoldLoadedFor, runnerHoldStorageKey]);
  const clearManualRetryId = useCallback((id: string) => {
    const wasManualRetry = manualRetryIdsRef.current.delete(id);
    const retriesLeft = manualRetryIdsRef.current.size;
    // Only a retry-only run stops here; a Start run must go on to the next file (Start-only stalled after file 1).
    if (shouldStopDrainAfterJob({ wasManualRetry, retriesLeft, retryOnlyRun: retryOnlyRunRef.current, runOnUpload: settingsRefValue.current.runOnUpload })) drainQueueRef.current = false;
    if (retriesLeft === 0) retryOnlyRunRef.current = false;
  }, []);

  const deferForServerRateLimit = useCallback((error: unknown) => {
    const attempt = Math.min(rateLimitAttemptRef.current + 1, 5);
    rateLimitAttemptRef.current = attempt;
    const delayMs = Math.min(RATE_LIMIT_RETRY_BASE_MS * (2 ** (attempt - 1)), RATE_LIMIT_RETRY_MAX_MS);
    rateLimitUntilRef.current = Date.now() + delayMs;
    if (rateLimitRetryTimerRef.current != null) window.clearTimeout(rateLimitRetryTimerRef.current);
    rateLimitRetryTimerRef.current = window.setTimeout(() => {
      rateLimitRetryTimerRef.current = null;
      rateLimitUntilRef.current = 0;
      if (!runnerHeldRef.current && settingsRefValue.current.enabled) {
        drainQueueRef.current = true;
        void processPendingRef.current();
      }
    }, delayMs);
    toast.message("Auto post is waiting for the server", {
      description: `Pocket Ledger Server is busy. It will retry in ${Math.ceil(delayMs / 1000)} seconds.`,
    });
    console.warn("[GalleryLocalAutoPost] server rate limited the queue claim", error);
  }, []);

  useEffect(() => () => {
    if (rateLimitRetryTimerRef.current != null) window.clearTimeout(rateLimitRetryTimerRef.current);
    if (rateLimitWaitTimerRef.current != null) window.clearTimeout(rateLimitWaitTimerRef.current);
    if (ocrRetryTimerRef.current != null) window.clearTimeout(ocrRetryTimerRef.current);
    if (autoResumeTimerRef.current != null) window.clearTimeout(autoResumeTimerRef.current);
  }, []);

  const writeStatus = useCallback(async (row: UnassignedRow, patch: Record<string, unknown>) => {
    if (!fsId) return;
    await setDoc(doc(firestore, `companies/${fsId}/unassigned_documents`, row.id), {
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [fsId]);

  useEffect(() => {
    if (!activeProcess) return;
    const heartbeat = () => {
      const job = activeJobRef.current;
      if (!job || job.id !== activeProcess.id) return;
      void writeStatus(job, { autoOcrHeartbeatAtMs: Date.now() }).catch((error) => {
        console.warn("[GalleryLocalAutoPost] could not renew processing lease", error);
      });
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, CLAIM_HEARTBEAT_MS);
    /* Hold a Web Lock while this tab owns the job: after a page refresh the lock is gone, so the next
     * Start can requeue the job at once instead of waiting for the 35 s heartbeat to go stale. */
    let stopped = false;
    let releaseLock: (() => void) | null = null;
    const locks = webLocks();
    if (locks && fsId) {
      void locks.request(jobLockName(fsId, activeProcess.id), () => new Promise<void>((resolve) => {
        if (stopped) resolve();
        else releaseLock = resolve;
      })).catch(() => { /* lock is only an optimisation */ });
    }
    return () => {
      stopped = true;
      window.clearInterval(timer);
      releaseLock?.();
    };
  }, [activeProcess, fsId, writeStatus]);

  /** A "processing" claim made by THIS device whose tab is gone (no Web Lock held) — e.g. left by a page refresh. */
  const isOwnOrphanClaim = useCallback(async (row: UnassignedRow) => {
    if (row.autoOcrStatus !== "processing" || !fsId || row.autoOcrDeviceId !== deviceId) return false;
    if (activeJobRef.current?.id === row.id) return false;
    const locks = webLocks();
    if (!locks) return false;
    try {
      const name = jobLockName(fsId, row.id);
      const state = await locks.query();
      return ![...(state.held ?? []), ...(state.pending ?? [])].some((l) => l.name === name);
    } catch {
      return false;
    }
  }, [deviceId, fsId]);

  const failJob = useCallback(async (row: UnassignedRow, message: string, provider = settingsRefValue.current.scanEngine || "gemini") => {
    try {
      await writeStatus(row, {
        autoOcrStatus: "failed",
        autoOcrHeartbeatAtMs: 0,
        autoOcrError: message.slice(0, 500),
        autoOcrProvider: provider,
        autoOcrFinishedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[GalleryLocalAutoPost] failed to record scan error", error);
    }
  }, [writeStatus]);


  const holdRunner = useCallback(() => {
    runnerHeldRef.current = true;
    runnerStartedRef.current = false;
    drainQueueRef.current = false;
    try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
    if (autoResumeTimerRef.current != null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
    pauseCauseRef.current = null;
    autoResumeArmedRef.current = false;
    setRunnerHeld(true);
  }, [runnerHoldStorageKey]);

  const toastBudgetExhaustedIfNeeded = () => {
    if (budgetExhaustedToastRef.current) return;
    const leftover = countEligibleRows(rowsRef.current);
    const scanned = scannedThisRunRef.current;
    if (scanned <= 0 || leftover <= 0) return;
    const total = Math.max(runQueueTotalRef.current, scanned + leftover);
    budgetExhaustedToastRef.current = true;
    toast.message(
      tUi(AUTO_POST_UI.scannedPressStart)
        .replace("{scanned}", String(scanned))
        .replace("{total}", String(total)),
    );
    holdRunner();
  };

  const openRunnerVoucher = useCallback((row: UnassignedRow, url: string, voucherType?: string) => {
    const scanEngine = settingsRefValue.current.scanEngine || "gemini";
    const enginePref = scanEngine === "gemini" ? "ai" as const
      : scanEngine === "auto" ? "auto" as const
        : "online" as const;
    // Decision 6: always the profile's engine; "auto" is resolved to a keyed engine inside the OCR engine.
    const cloudProvider = scanEngine === "google" ? "google" as const
      : scanEngine === "azure" ? "azure" as const
        : undefined;
    const fullAuto = activeRunnerFromSettings(settingsRefValue.current) === "full";
    // Open the detected voucher type when one is known; otherwise fall back to Sale.
    // The runner no longer pre-scans here (server OCR path classifies in the form).
    const tab = normalizeRunnerVoucherTab(voucherType);
    savedJobRef.current = false;
    setVoucherData({
      defaultTab: tab,
      unassignedFile: { id: row.id, url, path: row.path || "", name: row.name || "" },
      fileUrls: [url],
    });
    callTimesRef.current = recordRateLimitCall(callTimesRef.current);
    queueOcrHandoff(tab, [url], {
      runnerJob: true,
      // Decision 10: Full saves directly (no window, no countdown); Semi shows the window and countdown.
      autoPost: fullAuto ? true : settingsRefValue.current.autoSaveEnabled,
      autoPostImmediate: fullAuto,
      autoPostSeconds: settingsRefValue.current.autoSaveSeconds,
      overwriteEdited: settingsRefValue.current.overwriteEdited,
      allowSaveWithoutItems: settingsRefValue.current.missingFieldRules.item === "save-without",
      enginePref,
      cloudProvider,
      checkDuplicateVouchers: settingsRefValue.current.checkDuplicateVouchers,
      defaultDueDays: ocrHandoffDefaultDueDays(settingsRefValue.current),
    });
    setVoucherOpen(true);
  }, []);

  const releaseToUnassigned = useCallback(async (row: UnassignedRow, note = "") => {
    try {
      await writeStatus(row, {
        autoOcrStatus: "queued",
        autoOcrError: note.slice(0, 500),
        autoOcrStartedAtMs: 0,
        autoOcrHeartbeatAtMs: 0,
        autoOcrDeviceId: "",
        autoOcrUserId: "",
        autoOcrFinishedAt: null,
      });
    } catch (error) {
      console.warn("[GalleryLocalAutoPost] could not return document to Unassigned", error);
    }
  }, [writeStatus]);

  const processOne = useCallback(async (row: UnassignedRow) => {
    if (!fsId || !user?.uid || !navigator.onLine) return false;
    const scanEngine = settingsRefValue.current.scanEngine || "gemini";
    const rowRef = doc(firestore, `companies/${fsId}/unassigned_documents`, row.id);
    lastClaimServerRowRef.current = null;
    const claimed = await runTransaction(firestore, async (tx) => {
      const snapshot = await tx.get(rowRef);
      if (!snapshot.exists()) { lastClaimServerRowRef.current = { id: row.id, data: null }; return false; }
      const current = snapshot.data() as Record<string, unknown>;
      lastClaimServerRowRef.current = { id: row.id, data: current };
      if (current.isDeleted === true || current.deleted === true || current.status === "ASSIGNED" || current.status === "LOCKED") return false;
      const restoredFromDuplicate = Number(current.restoredFromDuplicateAtMs || 0) > 0;
      if ((current.autoOcrStatus === "complete" || current.autoOcrStatus === "failed") && !restoredFromDuplicate) return false;
      if (current.autoOcrStatus === "processing" && Date.now() - Number(current.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) return false;
      tx.update(rowRef, {
        autoOcrStatus: "processing",
        autoOcrStartedAtMs: Date.now(),
        autoOcrHeartbeatAtMs: Date.now(),
        autoOcrDeviceId: deviceId,
        autoOcrUserId: user.uid,
        autoOcrProvider: scanEngine,
        // Runner mode at post time; Gallery Recent OCR picks the User column label from it.
        autoOcrRunnerMode: activeRunnerFromSettings(settingsRefValue.current),
        autoOcrError: "",
        restoredFromDuplicateAtMs: 0,
        duplicateOfVoucherId: "",
        duplicateOfVoucherNumber: "",
        duplicateReason: "",
        duplicateReasons: [],
        duplicateOcrNarration: "",
        duplicateMatchedNarration: "",
        duplicateMatchedRef: "",
        duplicateMatchedAmount: 0,
        duplicateMatchedDateText: "",
        duplicateIncomingRef: "",
      });
      return true;
    });
    if (!claimed) return false;
    consumeScanRunSlot();
    rateLimitAttemptRef.current = 0;
    rateLimitUntilRef.current = 0;
    cancelledJobIdsRef.current.delete(row.id);
    activeJobRef.current = { ...row, autoOcrProvider: scanEngine };
    lastScanErrorRef.current = null;
    handledMissingJobIdRef.current = "";
    saveWithoutRetryJobIdRef.current = "";
    handledDuplicateJobIdRef.current = "";
    pauseCauseRef.current = null;
    lastMissingRef.current = null;
    autoResumeArmedRef.current = true;
    savedJobRef.current = false;
    setProcessDialogVisible(activeRunnerFromSettings(settingsRefValue.current) !== "full" || !settingsRefValue.current.autoSaveEnabled);
    setActiveProcess({ id: row.id, name: row.name || "Document" });
    ocrRetryCountRef.current = 0;

    try {
      const url = String(row.url || "").trim();
      if (!url) throw new Error("Document has no attachment URL.");
      openRunnerVoucher(row, url);
      const mode = settingsRefValue.current.processingMode;
      toast.info(mode === "full" ? "Full Auto post started" : "Semi automatic scan started", {
        description: "The file is attached to its voucher. OCR will classify the voucher type, fill the form, and save only when required checks pass.",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(row, message, scanEngine);
      clearManualRetryId(row.id);
      activeJobRef.current = null;
      setActiveProcess(null);
      toast.message("Auto post skipped this file", { description: `${message} The runner will continue with the next file.` });
      return false;
    }
  }, [clearManualRetryId, deviceId, failJob, fsId, user?.uid, openRunnerVoucher]);

  const processPending = useCallback(async () => {
    const reportStartBlocked = (reason: string) => {
      if (startAttemptRef.current) publishStartBlocked(reason);
    };
    if (!canRun || runnerHoldLoadedFor !== runnerHoldStorageKey || !navigator.onLine || busyRef.current || runnerHeldRef.current || Date.now() < rateLimitUntilRef.current) {
      if (startAttemptRef.current) {
        let reason: string = startBlockedCanRunReason();
        if (canRun && runnerHoldLoadedFor === runnerHoldStorageKey) {
          if (!navigator.onLine) reason = AUTO_POST_UI.startBlockedOffline;
          else if (busyRef.current) reason = AUTO_POST_UI.startBlockedBusy;
          else if (Date.now() < rateLimitUntilRef.current) reason = AUTO_POST_UI.startBlockedRateLimit;
        }
        reportStartBlocked(reason);
      }
      return;
    }
    if (runRemainingRef.current === 0) {
      drainQueueRef.current = false;
      toastBudgetExhaustedIfNeeded();
      reportStartBlocked(AUTO_POST_UI.startBlockedBudgetZero);
      return;
    }
    if (masters.loading) {
      reportStartBlocked(AUTO_POST_UI.startBlockedMastersLoading);
      return;
    }
    if (!drainQueueRef.current) return;
    const queueSequence = normalizeGalleryQueueSequence(settings.queueSequence || DEFAULT_GALLERY_QUEUE_SEQUENCE);
    const sortOrder = normalizeGallerySortOrder(settings.gallerySortOrder || DEFAULT_GALLERY_SORT_ORDER);
    const publishedQueue = galleryQueueOrderRef.current;
    const publishedOrderMatchesSettings = publishedQueue.companyId === fsId &&
      publishedQueue.queueSequence === queueSequence &&
      publishedQueue.gallerySortOrder === sortOrder;
    const rowById = new Map(rowsRef.current.map((row) => [row.id, row]));
    const storedColumns = typeof window !== "undefined" ? Number(localStorage.getItem("galleryPreviewColumns") || 2) : 2;
    const numberedRows = rowsRef.current.filter((row) =>
      !!row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" &&
      row.isDeleted !== true && row.deleted !== true &&
      ((row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed") || Number(row.restoredFromDuplicateAtMs || 0) > 0)
    );
    // The gallery can publish its numbered order before this listener mounts.
    // Use that order when available; otherwise derive the same order from the
    // shared sequence/sort and saved column count so Start never waits forever.
    const fallbackOrder = orderGalleryQueue(numberedRows, queueSequence, storedColumns, sortOrder);
    const fallbackRank = new Map(fallbackOrder.map((row, index) => [row.id, index]));
    const publishedOrderComplete = publishedOrderMatchesSettings && publishedQueue.fileIds.length === numberedRows.length &&
      publishedQueue.fileIds.length > 0 && numberedRows.every((row) => publishedQueue.fileIds.includes(row.id));
    const orderedQueueRows = publishedOrderComplete
      ? [...numberedRows].sort((a, b) => {
          const rankA = publishedQueue.fileIds.indexOf(a.id);
          const rankB = publishedQueue.fileIds.indexOf(b.id);
          return (rankA < 0 ? Number.MAX_SAFE_INTEGER : rankA) - (rankB < 0 ? Number.MAX_SAFE_INTEGER : rankB) ||
            (fallbackRank.get(a.id) ?? 0) - (fallbackRank.get(b.id) ?? 0);
        })
      : fallbackOrder;
    // Only consider the first numbered card. Skipping an unavailable/blocked
    // No. 1 and opening No. 2 makes the runner disagree with the gallery badge.
    const first = orderedQueueRows[0];
    if (first?.autoOcrStatus === "processing") {
      /* Own claim from a refresh, or stale processing (heartbeat older than the threshold, including a missing heartbeat). */
      const ownOrphan = await isOwnOrphanClaim(first);
      if (ownOrphan || isStaleProcessingClaim(first)) {
        const rowRef = doc(firestore, `companies/${fsId}/unassigned_documents`, first.id);
        const requeuePatch = {
          autoOcrStatus: "queued",
          autoOcrStartedAtMs: 0,
          autoOcrHeartbeatAtMs: 0,
          autoOcrDeviceId: "",
          autoOcrUserId: "",
          autoOcrError: "Previous run was interrupted; queued to retry.",
        };
        let requeueServerCopy: { data: Record<string, unknown> | null } | null = null;
        const attemptRequeue = async () => runTransaction(firestore, async (tx) => {
          const snapshot = await tx.get(rowRef);
          if (!snapshot.exists()) { requeueServerCopy = { data: null }; return false; }
          const current = snapshot.data() as Record<string, unknown>;
          requeueServerCopy = current.autoOcrStatus !== "processing" ? { data: current } : null;
          const currentHeartbeat = Number(current.autoOcrHeartbeatAtMs || current.autoOcrStartedAtMs || 0);
          if (current.autoOcrStatus !== "processing") return false;
          const stale = !currentHeartbeat || Date.now() - currentHeartbeat >= CLAIM_HEARTBEAT_STALE_MS;
          if (!stale && !(ownOrphan && current.autoOcrDeviceId === deviceId)) return false;
          tx.update(rowRef, requeuePatch);
          return true;
        });
        let recovered = false;
        let requeueError: unknown = null;
        for (let attempt = 0; attempt < 2 && !recovered; attempt += 1) {
          try {
            recovered = await attemptRequeue() === true;
            if (!recovered && attempt === 0) continue;
          } catch (error) {
            requeueError = error;
            console.warn("[GalleryLocalAutoPost] could not requeue a stale processing document", error);
          }
        }
        if (recovered) {
          const queued = { ...first, ...requeuePatch };
          rowsRef.current = rowsRef.current.map((row) => row.id === first.id ? queued : row);
          setRows(rowsRef.current);
          window.setTimeout(() => void processPendingRef.current(), 0);
          return;
        }
        const staleLocal = requeueServerCopy as { data: Record<string, unknown> | null } | null;
        if (staleLocal) {
          // Server no longer has it "processing" (or it is gone): the local copy was stale.
          healRowFromServer(first, staleLocal.data);
          window.setTimeout(() => void processPendingRef.current(), 0);
          return;
        }
        if (startAttemptRef.current) {
          reportStartBlocked(AUTO_POST_UI.startBlockedRequeueFailed);
        } else {
          toast.error(tUi(AUTO_POST_UI.startBlockedRequeueFailed), {
            description: requeueError instanceof Error ? requeueError.message : undefined,
          });
        }
        return;
      }
    }
    const next = first && (() => {
      const blockedVersion = claimBlockedVersionsRef.current.get(first.id);
      const currentVersion = queueClaimVersion(first);
      if (blockedVersion && blockedVersion !== currentVersion) claimBlockedVersionsRef.current.delete(first.id);
      const eligible = first.url && first.status !== "ASSIGNED" && first.status !== "LOCKED" && first.isDeleted !== true && first.deleted !== true &&
        ((first.autoOcrStatus !== "complete" && first.autoOcrStatus !== "failed") || Number(first.restoredFromDuplicateAtMs || 0) > 0) &&
        (manualRetryIdsRef.current.size === 0 || manualRetryIdsRef.current.has(first.id)) &&
        !(first.autoOcrStatus === "processing" && Date.now() - Number(first.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS) &&
        blockedVersion !== currentVersion;
      return eligible ? first : undefined;
    })();
    if (!next) {
      const lockedRow = rowsRef.current.find((row) => row.autoOcrStatus === "processing" && Date.now() - Number(row.autoOcrStartedAtMs || 0) < CLAIM_STALE_MS);
      if (lockedRow && await isOwnOrphanClaim(lockedRow)) {
        /* Our own claim left by a page refresh: free it now and try again right away. */
        await releaseToUnassigned(lockedRow, "Previous run was interrupted; queued to retry.");
        rowsRef.current = rowsRef.current.map((row) => row.id === lockedRow.id
          ? { ...row, autoOcrStatus: "queued", autoOcrStartedAtMs: 0, autoOcrHeartbeatAtMs: 0, autoOcrDeviceId: "", autoOcrUserId: "" }
          : row);
        setRows(rowsRef.current);
        window.setTimeout(() => void processPendingRef.current(), 0);
        return;
      }
      if (lockedRow) {
        if (staleRetryTimerRef.current != null) window.clearTimeout(staleRetryTimerRef.current);
        const heartbeatAt = Number(lockedRow.autoOcrHeartbeatAtMs || lockedRow.autoOcrStartedAtMs || 0);
        const retryIn = Math.max(1_000, CLAIM_HEARTBEAT_STALE_MS - (Date.now() - heartbeatAt) + 250);
        staleRetryTimerRef.current = window.setTimeout(() => {
          staleRetryTimerRef.current = null;
          drainQueueRef.current = true;
          void processPendingRef.current();
        }, retryIn);
        reportStartBlocked(AUTO_POST_UI.startBlockedFirstCard);
        return;
      }
      if (manualRetryIdsRef.current.size > 0) {
        if (staleRetryTimerRef.current != null) window.clearTimeout(staleRetryTimerRef.current);
        staleRetryTimerRef.current = window.setTimeout(() => {
          staleRetryTimerRef.current = null;
          drainQueueRef.current = true;
          void processPendingRef.current();
        }, 500);
        return;
      }
      // Snapshot has not arrived yet — keep drain on and wait; do not toast "no files".
      if (!rowsReadyRef.current) return;
      drainQueueRef.current = false;
      reportStartBlocked(AUTO_POST_UI.startBlockedNoFiles);
      // Decision 5: in Start-only mode an empty queue ends the run (stopped / idle, saved for reloads).
      if (shouldHoldWhenQueueEmpty(settingsRefValue.current) && !runnerHeldRef.current) holdRunner();
      return;
    }
    if (staleRetryTimerRef.current != null) {
      window.clearTimeout(staleRetryTimerRef.current);
      staleRetryTimerRef.current = null;
    }
    const maxCalls = Math.max(1, Math.min(15, Math.round(Number(settingsRefValue.current.maxCallsPerMinute) || 5)));
    const waitMs = rateLimitWaitMs(callTimesRef.current, maxCalls);
    if (waitMs > 0) {
      startWaitCountdown(Date.now() + waitMs);
      reportStartBlocked(AUTO_POST_UI.startBlockedRateLimit);
      return;
    }
    clearStartBlocked();
    busyRef.current = true;
    let openedForm = false;
    try {
      openedForm = await processOne(next);
    } catch (error) {
      busyRef.current = false;
      if (isServerRateLimitError(error)) {
        deferForServerRateLimit(error);
        return;
      }
      console.error("[GalleryLocalAutoPost] could not claim the next document", error);
      toast.error("Auto post could not start this document", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      return;
    }
    const serverCopy = lastClaimServerRowRef.current?.id === next.id ? lastClaimServerRowRef.current : null;
    lastClaimServerRowRef.current = null;
    if (!openedForm && serverCopy && queueClaimVersion({ ...next, ...(serverCopy.data ?? {}), id: next.id } as UnassignedRow) !== queueClaimVersion(next)) {
      // Local copy was stale: use the server state for this card and go straight to the next one.
      healRowFromServer(next, serverCopy.data);
      busyRef.current = false;
      window.setTimeout(() => void processPendingRef.current(), 0);
      return;
    }
    if (!openedForm) {
      // A stale gallery snapshot can keep presenting a document the server just rejected
      // (for example, it was claimed/deleted on another tab). Don't hammer the same claim;
      // reconsider it only after its server-visible state changes.
      claimBlockedVersionsRef.current.set(next.id, queueClaimVersion(next));
      busyRef.current = false;
      window.setTimeout(() => void processPendingRef.current(), 500);
    }
  }, [canRun, deferForServerRateLimit, deviceId, fsId, isCompanyAdmin, isOwnOrphanClaim, masters.loading, processOne, releaseToUnassigned, runnerHoldLoadedFor, runnerHoldStorageKey, settings.gallerySortOrder, settings.queueSequence, settings.runOnUpload, settingsDialogOpen, settingsReady, tUi, user?.uid, holdRunner]);
  processPendingRef.current = processPending;

  useEffect(() => {
    if (!fsId) return;
    const onQueueOrder = (event: Event) => {
      const detail = (event as CustomEvent<{
        companyId?: string;
        fileIds?: string[];
        queueSequence?: GalleryQueueSequence;
        gallerySortOrder?: GallerySortOrder;
        columns?: number;
      }>).detail;
      if (String(detail?.companyId || "") !== fsId || !Array.isArray(detail?.fileIds)) return;
      galleryQueueOrderRef.current = {
        companyId: fsId,
        fileIds: detail.fileIds.map((id) => String(id || "").trim()).filter(Boolean),
        queueSequence: detail.queueSequence ? normalizeGalleryQueueSequence(detail.queueSequence) : null,
        gallerySortOrder: detail.gallerySortOrder ? normalizeGallerySortOrder(detail.gallerySortOrder) : null,
        columns: Number(detail.columns) || null,
      };
      if (drainQueueRef.current && !runnerHeldRef.current) void processPendingRef.current();
    };
    window.addEventListener("pl:gallery:auto-post-queue-order", onQueueOrder);
    return () => window.removeEventListener("pl:gallery:auto-post-queue-order", onQueueOrder);
  }, [fsId]);

  useEffect(() => {
    const onRetryRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; fileIds?: string[] }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      const ids = Array.isArray(detail?.fileIds) ? detail.fileIds.map((id) => String(id || "")).filter(Boolean) : [];
      if (!ids.length) return;
      if (!canRun) {
        toast.message("Retry is not running on this device", { description: "Open Gallery on the selected Local PC admin device and try again." });
        return;
      }
      // Retry while nothing is draining = process just these files, then stop. Retry during a run = the run goes on.
      if (manualRetryIdsRef.current.size === 0) retryOnlyRunRef.current = !drainQueueRef.current;
      ids.forEach((id) => manualRetryIdsRef.current.add(id));
      const requeuePatch = {
        status: "FREE",
        isDeleted: false,
        deleted: false,
        autoOcrStatus: "queued",
        autoOcrError: "",
        autoOcrProvider: normalizeAutoOcrProvider(""),
        autoOcrFinishedAt: null,
        autoOcrStartedAtMs: 0,
        autoOcrDeviceId: "",
        autoOcrUserId: "",
        autoOcrVoucherId: "",
        restoredFromDuplicateAtMs: 0,
        duplicateOfVoucherId: "",
        duplicateOfVoucherNumber: "",
        duplicateReason: "",
        duplicateReasons: [],
        duplicateOcrNarration: "",
        duplicateMatchedNarration: "",
        duplicateMatchedRef: "",
        duplicateMatchedAmount: 0,
        duplicateMatchedDateText: "",
        duplicateIncomingRef: "",
        movedAtMs: 0,
      };
      rowsRef.current = rowsRef.current.map((row) => ids.includes(row.id) ? { ...row, ...requeuePatch } : row);
      setRows(rowsRef.current);
      if (shouldBeginNewBudget(startBudgetReason(runState()))) beginScanRun();
      else if (runRemainingRef.current !== 0) drainQueueRef.current = true;
      void Promise.all(ids.map((id) => writeStatus({ id }, requeuePatch)))
        .then(() => processPendingRef.current())
        .catch((error) => {
          ids.forEach(clearManualRetryId);
          toast.error("Could not requeue document", { description: error instanceof Error ? error.message : String(error) });
        });
    };
    window.addEventListener("pl:gallery:auto-post-retry", onRetryRequested);
    return () => window.removeEventListener("pl:gallery:auto-post-retry", onRetryRequested);
  }, [canRun, clearManualRetryId, fsId, writeStatus]);

  useEffect(() => {
    const publishState = () => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-process-state", {
      detail: {
        companyId: fsId,
        active: Boolean(activeProcess) || Boolean(waitBanner),
        fileName: activeProcess?.name || "",
        visible: processDialogVisible,
        held: runnerHeld || !settings.enabled,
        enabled: settings.enabled,
        controlAvailable: canControlRunner,
        mode: activeRunnerFromSettings(settings),
        waitMessage: waitBanner?.message || "",
        waitSeconds: waitBanner?.seconds || 0,
        startBlockedReason: startBlockedReasonRef.current,
        startBlockedSeq: startBlockedSeqRef.current,
      },
    }));
    publishProcessStateRef.current = publishState;
    publishState();
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; visible?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId || typeof detail?.visible !== "boolean") return;
      setProcessDialogVisible(detail.visible);
    };
    const onStateRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || String(detail.companyId) === fsId) publishState();
    };
    const onOcrFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; message?: string; code?: string; status?: number; retryAfter?: number; engine?: string }>).detail;
      const job = activeJobRef.current;
      const message = String(detail?.message || "").trim();
      if (String(detail?.companyId || "") !== fsId || !job || !message) return;
      lastScanErrorRef.current = { jobId: job.id, message: message.slice(0, 500) };
      const kind = classifyOcrFailure(message, detail.code, detail.status, detail.retryAfter);
      if (kind === "unreadable") {
        void (async () => {
          await failJob(job, message || AUTO_POST_UI.movedUnreadable, job.autoOcrProvider);
          clearManualRetryId(job.id);
          ocrRetryCountRef.current = 0;
          activeJobRef.current = null;
          savedJobRef.current = true;
          suppressCancelRef.current = true;
          setVoucherOpen(false);
          setVoucherData(null);
          setActiveProcess(null);
          busyRef.current = false;
          toast.message("Document moved to Auto post failed", { description: `${message} The runner will continue with the next file.` });
          if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
        })();
        return;
      }
      if (kind === "fatal-auth") {
        const stopMessage = fatalOcrMessage(kind, `${detail.code || ""} ${message}`) || message;
        void (async () => {
          await releaseToUnassigned(job, stopMessage);
          clearManualRetryId(job.id);
          ocrRetryCountRef.current = 0;
          activeJobRef.current = null;
          suppressCancelRef.current = true;
          setVoucherOpen(false);
          setVoucherData(null);
          setActiveProcess(null);
          busyRef.current = false;
          holdRunner();
          toast.error(tUi(stopMessage));
        })();
        return;
      }
      if (kind === "retryable" || kind === "other") {
        const attempt = ocrRetryCountRef.current + 1;
        if (attempt <= OCR_RETRY_LIMIT) {
          ocrRetryCountRef.current = attempt;
          const delay = retryBackoffMs(attempt);
          startWaitCountdown(Date.now() + delay);
          if (ocrRetryTimerRef.current != null) window.clearTimeout(ocrRetryTimerRef.current);
          ocrRetryTimerRef.current = window.setTimeout(() => {
            ocrRetryTimerRef.current = null;
            clearWaitBanner();
            const current = activeJobRef.current;
            const url = String(current?.url || "").trim();
            if (!current || current.id !== job.id || !url || runnerHeldRef.current) return;
            suppressCancelRef.current = true;
            setVoucherOpen(false);
            setVoucherData(null);
            window.setTimeout(() => {
              openRunnerVoucher(current, url);
              suppressCancelRef.current = false;
            }, 0);
          }, delay);
          return;
        }
        void (async () => {
          await releaseToUnassigned(job, tUi(OCR_UNAVAILABLE_MESSAGE));
          clearManualRetryId(job.id);
          ocrRetryCountRef.current = 0;
          activeJobRef.current = null;
          suppressCancelRef.current = true;
          setVoucherOpen(false);
          setVoucherData(null);
          setActiveProcess(null);
          busyRef.current = false;
          holdRunner();
          toast.error(tUi(OCR_UNAVAILABLE_MESSAGE));
        })();
      }
    };
    const onOcrSuccess = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job) return;
      if (lastScanErrorRef.current?.jobId === job.id) lastScanErrorRef.current = null;
      ocrRetryCountRef.current = 0;
    };
    const applyHoldState = (held: boolean) => {
      runnerHeldRef.current = held;
      runnerStartedRef.current = !held;
      try { window.localStorage.setItem(runnerHoldStorageKey, held ? "held" : "running"); } catch { /* persistence is best-effort */ }
      setRunnerHeld(held);
      const activeJob = activeJobRef.current;
      if (activeJob && voucherOpen) {
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-current-voucher-hold", {
          detail: { companyId: fsId, fileId: activeJob.id, fileUrl: activeJob.url, fileName: activeJob.name, held },
        }));
      }
      if (!held) {
        handledMissingJobIdRef.current = "";
        handledDuplicateJobIdRef.current = "";
        pauseCauseRef.current = null;
        const queueAllowed = settingsRefValue.current.enabled && activeRunnerFromSettings(settingsRefValue.current) !== "manual";
        const resumingCurrent = !!(activeJob && voucherOpen);
        if (queueAllowed) {
          // Start always begins a new run (refill budget, enable drain) even if a job
          // is leftover or the previous budget is 0. Resume of an open voucher keeps the budget.
          if (!resumingCurrent || runRemainingRef.current === 0) {
            beginScanRun();
            if (!resumingCurrent) busyRef.current = false;
          } else if (shouldBeginNewBudget(startBudgetReason(runState()))) beginScanRun();
          else if (runRemainingRef.current !== 0) drainQueueRef.current = true;
        }
        if (resumingCurrent) {
          ignoreFormChangedUntilRef.current = Date.now() + 1000;
          window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-resume-current-voucher", {
            detail: { companyId: fsId, fileId: activeJob.id, fileUrl: activeJob.url, fileName: activeJob.name },
          }));
        } else if (queueAllowed) {
          window.setTimeout(() => void processPendingRef.current(), 0);
        }
      }
    };
    const onHold = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; held?: boolean; allowWithSchedule?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId || typeof detail?.held !== "boolean") return;
      if (detail.held === false) startAttemptRef.current = true;
      if (!settings.enabled && detail.held === false) {
        if (!(activeJobRef.current && voucherOpen)) {
          publishStartBlocked(AUTO_POST_UI.startBlockedNotEnabled);
          return;
        }
      } else if (detail.held === false && settingsRefValue.current.runOnSchedule && !detail.allowWithSchedule) {
        startAttemptRef.current = false;
        setScheduleStartPrompt(true);
        return;
      }
      if (detail.held === false && !(activeJobRef.current && voucherOpen)) {
        if (!canRun) {
          publishStartBlocked(startBlockedCanRunReason());
          return;
        }
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          publishStartBlocked(AUTO_POST_UI.startBlockedOffline);
          return;
        }
      }
      applyHoldState(detail.held);
    };
    const onResetCounter = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      // Decision 11: Reset only refills the file counter. It never starts or resumes processing.
      const next = resetRunCounterState(initialRunRemaining(normalizeScanRunLimit(settingsRefValue.current.maxVouchersPerRun)), { draining: drainQueueRef.current });
      runRemainingRef.current = next.remaining;
      scannedThisRunRef.current = next.scanned;
      budgetExhaustedToastRef.current = false;
      const remaining = runRemainingRef.current;
      toast.message(
        remaining == null
          ? tUi(AUTO_POST_UI.scanCounterResetAll)
          : tUi(AUTO_POST_UI.scanCounterReset).replace("{count}", String(remaining)),
      );
    };
    const onScheduleDisabled = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; ok?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      if (detail.ok) applyHoldState(false);
    };
    const onRequiredFieldsMissing = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; missing?: string[]; fieldKeys?: string[]; voucherType?: string; itemRowCountMismatch?: boolean; itemAmountMismatch?: boolean }>).detail;
      const job = activeJobRef.current;
      if (String(detail?.companyId || "") !== fsId || !job || handledMissingJobIdRef.current === job.id) return;
      handledMissingJobIdRef.current = job.id;
      const missing = Array.isArray(detail.missing) ? detail.missing.map((field) => String(field || "").trim()).filter(Boolean) : [];
      const fieldKeys = Array.isArray(detail.fieldKeys) ? detail.fieldKeys.map((key) => String(key || "").trim()).filter(Boolean) : [];
      const typePending = isTypeSwitchPendingMissing(missing, fieldKeys);
      // Decision 10: rules come from the active runner profile; Full Auto Post never pauses for review.
      const runnerMode = activeRunnerFromSettings(settingsRefValue.current);
      const rules = enforceProfileRules(runnerMode, { ...settingsRefValue.current, missingFieldAction: runnerMode === "full" ? "fail-and-continue" as const : settingsRefValue.current.missingFieldAction });
      const message = `Required information is missing: ${missing.join(", ") || "review the highlighted fields"}.`;
      const actions: Array<"pause-and-hold" | "fail-and-continue" | "save-without"> = [];
      if (detail.itemRowCountMismatch || missing.some(isItemRowCountMismatchField)) actions.push(rules.itemRowMismatchAction);
      if (detail.itemAmountMismatch || missing.some(isAmountMismatchField)) actions.push(rules.amountMismatchAction);
      const genericMissing = missing.filter((field) => !isItemRowCountMismatchField(field) && !isAmountMismatchField(field));
      const isMissingItem = (field: string) => isMissingItemMasterField(field);
      const saveWithoutOnlyItemIssue = genericMissing.length > 0 &&
        genericMissing.every(isMissingItem) &&
        rules.missingFieldRules.item === "save-without" &&
        saveWithoutRetryJobIdRef.current !== job.id;
      for (const field of genericMissing) {
        if (isMissingItem(field)) {
          const itemAction = rules.missingFieldRules.item;
          if (itemAction !== "save-without") actions.push(itemAction);
          continue;
        }
        const rule = rules.missingFieldRules?.[missingFieldRuleKey(field, detail.voucherType)];
        if (rule) actions.push(rule);
      }
      const useLegacyFallback = !actions.length && !saveWithoutOnlyItemIssue;
      const shouldPause = typePending || actions.includes("pause-and-hold") || (useLegacyFallback && rules.missingFieldAction === "pause-and-hold");
      const shouldFail = !typePending && (actions.includes("fail-and-continue") || (useLegacyFallback && rules.missingFieldAction === "fail-and-continue"));
      if (saveWithoutOnlyItemIssue) {
        // Re-run the current form once with the already-carried Save without item override.
        // A persistent validation error then falls through to the configured review fallback.
        saveWithoutRetryJobIdRef.current = job.id;
        handledMissingJobIdRef.current = "";
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-resume-current-voucher", {
          detail: { companyId: fsId, fileId: job.id, fileUrl: job.url, fileName: job.name, forceRetry: true },
        }));
        return;
      }
      if (shouldFail && !shouldPause) {
        void (async () => {
          await failJob(job, message, job.autoOcrProvider);
          clearManualRetryId(job.id);
          activeJobRef.current = null;
          savedJobRef.current = true;
          setActiveProcess(null);
          setVoucherOpen(false);
          setVoucherData(null);
          busyRef.current = false;
          toast.message("Auto post moved to failed", { description: `${message} The runner will continue with the next file.` });
          if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
        })();
        return;
      }
      const prevMissing = lastMissingRef.current;
      const sameMissing = !!(prevMissing && prevMissing.jobId === job.id && (
        (prevMissing.fieldKeys.length > 0 && fieldKeys.length > 0)
          ? isSameMissingSet(prevMissing.fieldKeys, fieldKeys)
          : isSameMissingSet(prevMissing.missing, missing)
      ));
      pauseCauseRef.current = { kind: typePending ? "voucher-type" : "required-fields", jobId: job.id, missing, fieldKeys };
      lastMissingRef.current = { jobId: job.id, missing, fieldKeys };
      runnerHeldRef.current = true;
      runnerStartedRef.current = false;
      try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
      setRunnerHeld(true);
      setProcessDialogVisible(true);
      window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-current-voucher-hold", {
        detail: { companyId: fsId, fileId: job.id, fileUrl: job.url, fileName: job.name, held: true },
      }));
      if (sameMissing) {
        autoResumeArmedRef.current = false;
        return;
      }
      autoResumeArmedRef.current = true;
      toast.message("Auto post paused for review", { description: `${message} The voucher is still open; use Resume runner after handling it.` });
    };
    const onSkipCurrent = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      const job = activeJobRef.current;
      if (
        String(detail?.companyId || "") !== fsId ||
        !job ||
        !voucherOpen ||
        !runnerHeldRef.current ||
        skipCurrentJobIdRef.current === job.id
      ) return;
      skipCurrentJobIdRef.current = job.id;
      const message = "Skipped by user while Auto post was paused for review.";
      void (async () => {
        try {
          // A restored duplicate is normally eligible for one fresh scan. Once
          // the user explicitly skips it, keep it in failed instead of retrying.
          await writeStatus(job, {
            autoOcrStatus: "failed",
            autoOcrError: message,
            autoOcrProvider: job.autoOcrProvider || settingsRefValue.current.scanEngine || "gemini",
            autoOcrFinishedAt: serverTimestamp(),
            restoredFromDuplicateAtMs: 0,
          });
          rowsRef.current = rowsRef.current.map((row) => row.id === job.id
            ? { ...row, autoOcrStatus: "failed", autoOcrError: message, restoredFromDuplicateAtMs: 0 }
            : row);
          setRows(rowsRef.current);
          clearManualRetryId(job.id);
          lastScanErrorRef.current = null;
          handledMissingJobIdRef.current = "";
          handledDuplicateJobIdRef.current = "";
          activeJobRef.current = null;
          savedJobRef.current = true;
          setActiveProcess(null);
          setVoucherOpen(false);
          setVoucherData(null);
          busyRef.current = false;
          runnerHeldRef.current = false;
          runnerStartedRef.current = true;
          if (runRemainingRef.current !== 0) drainQueueRef.current = true;
          try { window.localStorage.setItem(runnerHoldStorageKey, "running"); } catch { /* best-effort persistence */ }
          setRunnerHeld(false);
          toast.message("Document moved to Auto post failed", { description: "The runner is continuing with the next file." });
          window.setTimeout(() => void processPendingRef.current(), 0);
        } catch (error) {
          toast.error("Could not move the document to Auto post failed", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        } finally {
          skipCurrentJobIdRef.current = "";
        }
      })();
    };
    const onDuplicateDetected = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId?: string; voucherNumber?: string; summary?: string; dateText?: string; amount?: string; reasons?: string[]; action?: "move" }>).detail;
      const job = activeJobRef.current;
      const forceMove = detail?.action === "move";
      if (String(detail?.matchId || "") === "" || !job || (handledDuplicateJobIdRef.current === job.id && !forceMove) || !settingsRefValue.current.checkDuplicateVouchers) return;
      handledDuplicateJobIdRef.current = job.id;
      if (!forceMove && job.autoPostIgnoreDuplicateOnce) {
        void writeStatus(job, { autoPostIgnoreDuplicateOnce: false }).catch(() => {});
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-action-completed", { detail: { matchId: detail.matchId } }));
        toast.message("Duplicate override applied", { description: "You chose Post anyway for this document, so the runner is continuing." });
        return;
      }
      if (!forceMove && settingsRefValue.current.duplicateVoucherAction === "save-anyway") {
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-action-completed", { detail: { matchId: detail.matchId } }));
        toast.message("Possible duplicate: continuing", { description: "The selected rule allows this voucher to save; the runner will continue afterward." });
        return;
      }
      // Stop the OCR countdown before moving/reviewing this document. The form's
      // auto-save timer is separate from the duplicate bubble and otherwise could
      // save the voucher while this async move is still being written.
      if (forceMove || settingsRefValue.current.duplicateVoucherAction !== "save-anyway") {
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-block-save", {
          detail: {
            companyId: fsId,
            fileUrl: String(job.url || ""),
            fileName: String(job.name || ""),
          },
        }));
      }
      if (!forceMove && settingsRefValue.current.duplicateVoucherAction === "pause-for-review") {
        runnerHeldRef.current = true;
        runnerStartedRef.current = false;
        try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* persistence is best-effort */ }
        setRunnerHeld(true);
        setProcessDialogVisible(true);
        pauseCauseRef.current = { kind: "duplicate", jobId: job.id, missing: [] };
        autoResumeArmedRef.current = true;
        toast.message("Possible duplicate: runner paused", { description: "Review this voucher, then use Resume runner to continue." });
        return;
      }
      if (!forceMove && runnerHeldRef.current) {
        // Stopping the runner means the user is taking over this voucher. Do not
        // apply the automatic duplicate-move rule while they are reviewing it.
        toast.message("Runner stopped: duplicate left in Unassigned", {
          description: "The document will stay here while you review or cancel the voucher.",
        });
        return;
      }
      const matchKey = String(detail.matchId || job.id || "");
      if (!claimDuplicateAutoMove(matchKey)) return;
      void (async () => {
        try {
          const reason = `Possible duplicate of voucher ${String(detail.voucherNumber || "").trim() || String(detail.matchId || "unknown")}: ${String(detail.summary || "matching transaction found")}`;
          const destination = doc(firestore, `companies/${fsId}/duplicate_documents`, job.id);
          const source = doc(firestore, `companies/${fsId}/unassigned_documents`, job.id);
          const restoreCancelledDocument = async () => {
            await setDoc(source, { ...unassignedAfterRunnerCancel(job), updatedAt: serverTimestamp() }, { merge: true });
            await deleteDoc(destination);
          };
          if (cancelledJobIdsRef.current.has(job.id)) {
            releaseDuplicateAutoMove(matchKey);
            return;
          }
          await setDoc(destination, {
            ...job,
            id: job.id,
            status: "DUPLICATE",
            autoOcrStatus: "duplicate",
            duplicateOfVoucherId: String(detail.matchId || ""),
            duplicateOfVoucherNumber: String(detail.voucherNumber || ""),
            duplicateReason: reason,
            duplicateReasons: Array.isArray(detail.reasons) ? detail.reasons : [],
            movedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          if (cancelledJobIdsRef.current.has(job.id)) {
            await restoreCancelledDocument();
            releaseDuplicateAutoMove(matchKey);
            return;
          }
          await deleteDoc(source);
          if (cancelledJobIdsRef.current.has(job.id)) {
            await restoreCancelledDocument();
            releaseDuplicateAutoMove(matchKey);
            return;
          }
          clearManualRetryId(job.id);
          activeJobRef.current = null;
          setActiveProcess(null);
          busyRef.current = false;
          setVoucherOpen(false);
          setVoucherData(null);
          window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-action-completed", { detail: { matchId: detail.matchId } }));
          toast.success("Moved to Duplicate Documents", {
            description: runnerHeldRef.current
              ? "The duplicate was moved. Use Resume runner when you are ready to continue."
              : "The auto runner is continuing with the next file.",
          });
          if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
        } catch (error) {
          handledDuplicateJobIdRef.current = "";
          releaseDuplicateAutoMove(matchKey);
          toast.error("Could not move the duplicate document", { description: error instanceof Error ? error.message : String(error) });
        }
      })();
    };
    const onDuplicateMoveRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId?: string; voucherNumber?: string; summary?: string; dateText?: string; amount?: string; reasons?: string[] }>).detail;
      if (!detail?.matchId || !activeJobRef.current) return;
      onDuplicateDetected(new CustomEvent("pl:gallery:auto-post-duplicate-detected", {
        detail: { ...detail, action: "move" },
      }));
    };
    const clearAutoResumeTimer = () => {
      if (autoResumeTimerRef.current != null) {
        window.clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
    };
    const scheduleAutoResume = () => {
      if (!shouldAutoResume(activeRunnerFromSettings(settingsRefValue.current))) return;
      if (!autoResumeArmedRef.current || !runnerHeldRef.current) return;
      const cause = pauseCauseRef.current;
      const job = activeJobRef.current;
      if (!cause || !job || cause.jobId !== job.id || !voucherOpen) return;
      clearAutoResumeTimer();
      autoResumeTimerRef.current = window.setTimeout(() => {
        autoResumeTimerRef.current = null;
        if (!shouldAutoResume(activeRunnerFromSettings(settingsRefValue.current))) return;
        if (!autoResumeArmedRef.current || !runnerHeldRef.current || !voucherOpen) return;
        const currentCause = pauseCauseRef.current;
        const currentJob = activeJobRef.current;
        if (!currentCause || !currentJob || currentCause.jobId !== currentJob.id) return;
        autoResumeArmedRef.current = false;
        applyHoldState(false);
      }, 400);
    };
    const onFormValuesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      if (Date.now() < ignoreFormChangedUntilRef.current) return;
      if (pauseCauseRef.current?.kind !== "required-fields") return;
      autoResumeArmedRef.current = true;
      scheduleAutoResume();
    };
    const onPauseCauseResolved = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; companyId?: string }>).detail;
      if (detail?.companyId && String(detail.companyId) !== fsId) return;
      const cause = pauseCauseRef.current;
      if (!cause) return;
      if (detail?.kind && detail.kind !== cause.kind) return;
      autoResumeArmedRef.current = true;
      scheduleAutoResume();
    };
    const onVoucherTypeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (detail?.companyId && String(detail.companyId) !== fsId) return;
      if (!pauseCauseRef.current) return;
      autoResumeArmedRef.current = true;
      scheduleAutoResume();
    };
    const onOcrTypeSwitch = () => {
      if (!pauseCauseRef.current) return;
      autoResumeArmedRef.current = true;
      scheduleAutoResume();
    };
    window.addEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
    window.addEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
    window.addEventListener("pl:gallery:auto-post-scan-failed", onOcrFailure);
    window.addEventListener("pl:gallery:auto-post-scan-succeeded", onOcrSuccess);
    window.addEventListener("pl:gallery:auto-post-runner-hold", onHold);
    window.addEventListener("pl:gallery:auto-post-runner-reset", onResetCounter);
    window.addEventListener("pl:gallery:auto-post-schedule-disabled", onScheduleDisabled);
    window.addEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
    window.addEventListener("pl:gallery:auto-post-skip-current", onSkipCurrent);
    window.addEventListener("pl:gallery:auto-post-duplicate-detected", onDuplicateDetected);
    window.addEventListener("pl:gallery:auto-post-duplicate-move-requested", onDuplicateMoveRequested);
    window.addEventListener(AUTO_POST_FORM_VALUES_CHANGED, onFormValuesChanged);
    window.addEventListener(AUTO_POST_PAUSE_CAUSE_RESOLVED, onPauseCauseResolved);
    window.addEventListener(AUTO_POST_VOUCHER_TYPE_CHANGED, onVoucherTypeChanged);
    window.addEventListener(OCR_SWITCH_EVENT, onOcrTypeSwitch);
    return () => {
      window.removeEventListener("pl:gallery:auto-post-process-visibility", onVisibility);
      window.removeEventListener("pl:gallery:auto-post-process-state-request", onStateRequest);
      window.removeEventListener("pl:gallery:auto-post-scan-failed", onOcrFailure);
      window.removeEventListener("pl:gallery:auto-post-scan-succeeded", onOcrSuccess);
      window.removeEventListener("pl:gallery:auto-post-runner-hold", onHold);
      window.removeEventListener("pl:gallery:auto-post-runner-reset", onResetCounter);
      window.removeEventListener("pl:gallery:auto-post-schedule-disabled", onScheduleDisabled);
      window.removeEventListener("pl:gallery:auto-post-required-fields-missing", onRequiredFieldsMissing);
      window.removeEventListener("pl:gallery:auto-post-skip-current", onSkipCurrent);
      window.removeEventListener("pl:gallery:auto-post-duplicate-detected", onDuplicateDetected);
      window.removeEventListener("pl:gallery:auto-post-duplicate-move-requested", onDuplicateMoveRequested);
      window.removeEventListener(AUTO_POST_FORM_VALUES_CHANGED, onFormValuesChanged);
      window.removeEventListener(AUTO_POST_PAUSE_CAUSE_RESOLVED, onPauseCauseResolved);
      window.removeEventListener(AUTO_POST_VOUCHER_TYPE_CHANGED, onVoucherTypeChanged);
      window.removeEventListener(OCR_SWITCH_EVENT, onOcrTypeSwitch);
    };
  }, [activeProcess, canControlRunner, clearManualRetryId, failJob, fsId, holdRunner, openRunnerVoucher, processDialogVisible, releaseToUnassigned, runnerHeld, runnerHoldStorageKey, settings.enabled, tUi, voucherOpen, waitBanner, writeStatus]);

  useEffect(() => {
    if (!canRun || masters.loading || !drainQueueRef.current) return;
    void processPending();
  }, [canRun, masters.loading, processPending]);

  useEffect(() => {
    if (!canRun || !fsId) {
      rowsReadyRef.current = false;
      setRows([]);
      return;
    }
    rowsReadyRef.current = false;
    const q = query(collection(firestore, `companies/${fsId}/unassigned_documents`), orderBy("uploadedAt", "asc"));
    return onSnapshot(q, (snapshot) => {
      const next = applyServerRowOverrides(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UnassignedRow, "id">) })));
      rowsRef.current = next;
      rowsReadyRef.current = true;
      setRows(next);
    }, (error) => console.warn("[GalleryLocalAutoPost] could not watch Unassigned Documents", error));
  }, [canRun, fsId]);

  useEffect(() => {
    if (!canRun) return;
    const pendingIds = rows
      .filter((row) =>
        !!row.url && row.status !== "ASSIGNED" && row.status !== "LOCKED" &&
        row.isDeleted !== true && row.deleted !== true &&
        ((row.autoOcrStatus !== "complete" && row.autoOcrStatus !== "failed") || Number(row.restoredFromDuplicateAtMs || 0) > 0)
      )
      .map((row) => row.id);
    const hasNewArrival = pendingIds.some((id) => !pendingIdsRef.current.has(id));
    pendingIdsRef.current = new Set(pendingIds);
    if (!settings.runOnUpload && !runnerStartedRef.current) return;
    if (settings.runOnUpload && hasNewArrival && isIdleRunState(runState())) {
      beginScanRun();
      void processPending();
      return;
    }
    if (drainQueueRef.current) void processPending();
  }, [canRun, processPending, rows, settings.runOnUpload, runnerHeld]);

  useEffect(() => {
    if (!canRun || !settings.runOnSchedule) return;
    const onScheduleTick = () => {
      if (shouldSkipScheduleTick(runState())) return;
      if (shouldBeginNewBudget("idle-schedule")) beginScanRun();
      void processPendingRef.current();
    };
    if (settings.scheduleMode === "interval") {
      const timer = window.setInterval(onScheduleTick, Math.max(1, settings.scheduleMinutes) * 60_000);
      return () => window.clearInterval(timer);
    }
    const key = `${fsId}:${settings.scheduleDate}:${settings.scheduleTime}`;
    const marker = `${LOCAL_SCHEDULE_KEY}:${key}`;
    const check = () => {
      if (!navigator.onLine || !settings.scheduleDate || !settings.scheduleTime) return;
      const scheduledAt = new Date(`${settings.scheduleDate}T${settings.scheduleTime}:00`).getTime();
      if (!Number.isFinite(scheduledAt) || Date.now() < scheduledAt || localStorage.getItem(marker) === "done") return;
      if (shouldSkipScheduleTick(runState())) return;
      localStorage.setItem(marker, "done");
      if (shouldBeginNewBudget("idle-schedule")) beginScanRun();
      void processPendingRef.current();
    };
    check();
    const timer = window.setInterval(check, 15_000);
    return () => window.clearInterval(timer);
  }, [canRun, fsId, processPending, settings.runOnSchedule, settings.scheduleDate, settings.scheduleMode, settings.scheduleMinutes, settings.scheduleTime]);

  useEffect(() => {
    const onOnline = () => {
      if (settingsRefValue.current.runOnUpload && isIdleRunState(runState())) beginScanRun();
      void processPendingRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const closeJob = useCallback(async (status: "saved" | "cancelled", voucherId?: string) => {
    const job = activeJobRef.current;
    if (!job) return;
    if (autoResumeTimerRef.current != null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
    pauseCauseRef.current = null;
    autoResumeArmedRef.current = false;
    if (status === "saved") {
      savedJobRef.current = true;
      try {
        await writeStatus(job, {
          autoOcrStatus: "complete",
          autoOcrHeartbeatAtMs: 0,
          autoOcrError: "",
          autoOcrVoucherId: voucherId || "",
          autoOcrFinishedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn("[GalleryLocalAutoPost] voucher saved but gallery status update failed", error);
      }
    } else if (!savedJobRef.current) {
      // Cancel is a user decision, not an OCR/post failure. Return the document
      // to its original Unassigned place and hold the queue so it cannot reopen
      // immediately while the user is taking over manually.
      runnerHeldRef.current = true;
      runnerStartedRef.current = false;
      cancelledJobIdsRef.current.add(job.id);
      try { window.localStorage.setItem(runnerHoldStorageKey, "held"); } catch { /* best-effort persistence */ }
      setRunnerHeld(true);
      try {
        await setDoc(
          doc(firestore, `companies/${fsId}/unassigned_documents`, job.id),
          { ...unassignedAfterRunnerCancel(job), updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (error) {
        console.warn("[GalleryLocalAutoPost] could not return cancelled document to Unassigned", error);
        toast.error("The document could not be returned to Unassigned", {
          description: error instanceof Error ? error.message : "Please refresh and check the document status.",
        });
      }
    }
    lastScanErrorRef.current = null;
    clearManualRetryId(job.id);
    activeJobRef.current = null;
    setActiveProcess(null);
    busyRef.current = false;
    setVoucherOpen(false);
    setVoucherData(null);
    if (!runnerHeldRef.current) window.setTimeout(() => void processPendingRef.current(), 0);
  }, [clearManualRetryId, runnerHoldStorageKey, writeStatus]);

  return (
    <>
    <AddVoucherDialog
      isOpen={voucherOpen}
      onOpenChange={(next) => {
        setVoucherOpen(next);
        if (!next && activeJobRef.current && !suppressCancelRef.current) void closeJob("cancelled");
        if (next) suppressCancelRef.current = false;
      }}
      voucher={undefined}
      defaultVoucherData={voucherData}
      hideAutoProcessDialog={voucherOpen && !processDialogVisible}
      autoProcessVisibilityToggle={activeProcess ? (
        <button type="button" className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md" onClick={() => setProcessDialogVisible(false)}>
          Hide process
        </button>
      ) : null}
      suppressDashboardRedirectGuard
      onVoucherAction={(status: "saved" | "cancelled", _saveAndNew?: boolean, newId?: string) => void closeJob(status, newId)}
    />
    <AlertDialog open={scheduleStartPrompt} onOpenChange={(next) => { if (!next) setScheduleStartPrompt(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{AUTO_POST_UI.scheduleOnPrompt}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">{AUTO_POST_UI.scheduleOnPrompt}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setScheduleStartPrompt(false)}>{AUTO_POST_UI.no}</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            setScheduleStartPrompt(false);
            window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-disable-schedule", { detail: { companyId: fsId } }));
          }}>{AUTO_POST_UI.yes}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
