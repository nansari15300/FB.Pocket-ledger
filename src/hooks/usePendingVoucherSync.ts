"use client";

import * as React from "react";
import { syncPendingFiles } from "@/lib/localPendingFiles";
import { syncPendingMasterMutations } from "@/lib/localPendingMasters";
import { syncPendingVoucherMutations } from "@/lib/localPendingVouchers";
import { syncPendingRecycleBinMutations } from "@/lib/localPendingRecycleBin";
import { deleteCompanyComplete } from "@/lib/actions/deleteCompanyAction";
import { useOnlineStatus } from "./use-online-status";
import { useAuth } from "./useAuth";
import { isServerQuotaHoldActive, SERVER_QUOTA_HOLD_END_EVENT } from "@/lib/serverQuotaHold";

/** Phase 2 hotfix: background retry interval for pending (failed) attachment uploads. */
const PENDING_SYNC_RETRY_MS = 2 * 60 * 1000;

type UsePendingVoucherSyncOptions = {
  enabled?: boolean;
};

export function usePendingVoucherSync({ enabled = true }: UsePendingVoucherSyncOptions = {}) {
  const { isOnline } = useOnlineStatus();
  const { user } = useAuth();
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<{ synced: number; failed: number } | null>(null);
  const syncingRef = React.useRef(false);

  const runSync = React.useCallback(async () => {
    if (!enabled || !isOnline || syncingRef.current) return { synced: 0, failed: 0 };
    // Quota / billing pause: send nothing; SERVER_QUOTA_HOLD_END_EVENT triggers a retry.
    if (isServerQuotaHoldActive()) return { synced: 0, failed: 0 };
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const masterResult = await syncPendingMasterMutations();
      const voucherResult = await syncPendingVoucherMutations();
      const fileResult = await syncPendingFiles();
      const recycleResult = await syncPendingRecycleBinMutations({
        userId: user?.uid,
        deleteCompanyComplete,
      });
      const result = {
        synced: voucherResult.synced + masterResult.synced + fileResult.synced + recycleResult.synced,
        failed: voucherResult.failed + masterResult.failed + fileResult.failed + recycleResult.failed,
      };
      setLastResult(result);
      return result;
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [enabled, isOnline, user?.uid]);

  React.useEffect(() => {
    if (!enabled || !isOnline) return;
    void runSync();
  }, [enabled, isOnline, runSync]);

  // Phase 2 hotfix: keep retrying pending local files until they upload (periodic + quota-hold end + tab visible).
  React.useEffect(() => {
    if (!enabled || !isOnline || typeof window === "undefined") return;
    const retry = () => {
      void runSync().catch(() => undefined);
    };
    const id = window.setInterval(retry, PENDING_SYNC_RETRY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener(SERVER_QUOTA_HOLD_END_EVENT, retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(SERVER_QUOTA_HOLD_END_EVENT, retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, isOnline, runSync]);

  return {
    isOnline,
    isSyncing,
    lastResult,
    runSync,
  };
}
