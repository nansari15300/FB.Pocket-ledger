"use client";

import { useEffect, useRef } from "react";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { listLocalCompanies, getLocalCompanyById, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { readCloudSyncConfigFromCompany, shouldUseLocalCloudSync } from "@/lib/localCloudSync/companyConfig";
import { purgeAllLocalCompaniesMissingOnDrive } from "@/lib/localCloudSync/driveCompanyFolderLifecycle";
import { isLocalCloudSyncCycleRunning, runLocalCloudSyncCycle } from "@/lib/localCloudSync/engine";
import { logLocalCloudSync } from "@/lib/localCloudSync/logger";
import { MIN_CLOUD_SYNC_TICK_MS } from "@/lib/localCloudSync/types";
import { hasDriveApiAuthSession, waitForFirebaseAuthReady } from "@/lib/firebaseAuthForApi";
import { isLocalGoogleDriveSyncDisabled } from "@/lib/localCloudSync/driveSyncDisabled";

const MAX_BACKGROUND_CLOUD_SYNC_TICK_MS = 60_000;
const DRIVE_PURGE_CHECK_MS = 10 * 60 * 1000;
const FORCE_ACTIVE_EVENT_COOLDOWN_MS = 60_000;

function isCompanySyncDue(row: LocalCompanyDoc, now: number): boolean {
  const cfg = readCloudSyncConfigFromCompany(row);
  const intervalMs = cfg.cloudSyncIntervalSec * 1000;
  const lastSyncAt = cfg.cloudSyncLastSyncAt ?? 0;
  return now - lastSyncAt >= intervalMs;
}

function nextCompanySyncDelayMs(row: LocalCompanyDoc, now: number): number | null {
  const cfg = readCloudSyncConfigFromCompany(row);
  if (!cfg.cloudSyncEnabled || !cfg.cloudSyncProvider) return null;
  const intervalMs = cfg.cloudSyncIntervalSec * 1000;
  const lastSyncAt = cfg.cloudSyncLastSyncAt ?? 0;
  return Math.max(0, lastSyncAt + intervalMs - now);
}

async function runScheduledDriveSyncForCompany(
  row: LocalCompanyDoc,
  options?: { force?: boolean }
): Promise<void> {
  const cid = String(row.id || "").trim();
  if (!cid) return;
  if (isLocalGoogleDriveSyncDisabled()) return;
  if (!(await shouldUseLocalCloudSync(cid))) return;
  const cfg = readCloudSyncConfigFromCompany(row);
  if (!cfg.cloudSyncEnabled) return;

  const now = Date.now();
  const force = options?.force === true;
  if (!force && !isCompanySyncDue(row, now)) return;
  if (isLocalCloudSyncCycleRunning(cid)) return;

  await runLocalCloudSyncCycle(cid, { force: true });
}

/** Har MIN tick: enabled Drive companies — interval due par force sync (manual Force sync jaisa). */
export function LocalCompanyCloudSyncManager() {
  const { company, clearCompanyId, reloadLocalCompanyRegistry } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();
  const runningRef = useRef(false);
  const lastDrivePurgeAtRef = useRef(0);
  const lastForceActiveEventAtRef = useRef(0);
  const activeCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeCompanyIdRef.current = company?.id ?? null;
  }, [company?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isLocalGoogleDriveSyncDisabled()) return;

    let timerId: number | null = null;
    let cancelled = false;

    const computeNextDelay = async (): Promise<number> => {
      try {
        const companies = await listLocalCompanies();
        const now = Date.now();
        let best = MAX_BACKGROUND_CLOUD_SYNC_TICK_MS;
        for (const c of companies) {
          if (!(await shouldUseLocalCloudSync(c.id))) continue;
          const delay = nextCompanySyncDelayMs(c, now);
          if (delay == null) continue;
          best = Math.min(best, delay);
        }
        return Math.max(MIN_CLOUD_SYNC_TICK_MS, Math.min(best, MAX_BACKGROUND_CLOUD_SYNC_TICK_MS));
      } catch {
        return MAX_BACKGROUND_CLOUD_SYNC_TICK_MS;
      }
    };

    const scheduleNext = async () => {
      if (cancelled) return;
      const delay = await computeNextDelay();
      if (cancelled) return;
      if (timerId != null) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => void tick(), delay);
    };

    const tick = async (options?: { forceActive?: boolean }) => {
      if (runningRef.current) {
        await scheduleNext();
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await scheduleNext();
        return;
      }
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible" &&
        options?.forceActive !== true
      ) {
        await scheduleNext();
        return;
      }
      await waitForFirebaseAuthReady();
      if (!hasDriveApiAuthSession()) {
        await scheduleNext();
        return;
      }

      runningRef.current = true;
      try {
        const now = Date.now();
        if (now - lastDrivePurgeAtRef.current >= DRIVE_PURGE_CHECK_MS) {
          lastDrivePurgeAtRef.current = now;
          const purged = await purgeAllLocalCompaniesMissingOnDrive(user?.uid ?? null);
          if (purged.length > 0) {
            reloadLocalCompanyRegistry();
            if (company?.id && purged.some((p) => p.companyId === company.id)) {
              clearCompanyId();
            }
            for (const row of purged) {
              toast({
                title: "Company removed",
                description: `"${row.companyName}" Google Drive par nahi mili (sync ON) — is device se hata di.`,
              });
            }
          }
        }

        const companies = await listLocalCompanies();
        const activeId = activeCompanyIdRef.current;
        const ordered = activeId
          ? [
              ...companies.filter((c) => c.id === activeId),
              ...companies.filter((c) => c.id !== activeId),
            ]
          : companies;

        for (const c of ordered) {
          const isActive = c.id === activeId;
          await runScheduledDriveSyncForCompany(c, {
            force: options?.forceActive === true && isActive,
          });
        }
      } catch (e) {
        logLocalCloudSync("background tick error", e);
      } finally {
        runningRef.current = false;
        await scheduleNext();
      }
    };

    timerId = window.setTimeout(() => void tick(), 10_000);

    const requestForceActiveTick = () => {
      const now = Date.now();
      if (now - lastForceActiveEventAtRef.current < FORCE_ACTIVE_EVENT_COOLDOWN_MS) return;
      lastForceActiveEventAtRef.current = now;
      void tick({ forceActive: true });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") requestForceActiveTick();
    };
    const onFocus = () => requestForceActiveTick();
    const onOnline = () => requestForceActiveTick();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [company?.id, clearCompanyId, reloadLocalCompanyRegistry, toast, user?.uid]);

  /** Company switch — turant force sync taaki dusre device ka data jaldi aaye. */
  useEffect(() => {
    const cid = String(company?.id || "").trim();
    if (!cid) return;
    if (isLocalGoogleDriveSyncDisabled()) return;
    void (async () => {
      const reg = await getLocalCompanyById(cid, { includeDeleted: true });
      if (!reg) return;
      await runScheduledDriveSyncForCompany(reg, { force: true });
    })();
  }, [company?.id]);

  return null;
}
