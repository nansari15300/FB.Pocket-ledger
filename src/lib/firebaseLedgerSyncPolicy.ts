"use client";

/**
 * Effective Firebase ledger sync policy (single gate for web / EXE / APK / iOS).
 *
 * Live Firebase listeners are the product default across web, EXE, APK, and iOS.
 *
 * Rules:
 * - deltaa (`local`): SQLite + outbox transport; NO collection `onSnapshot`; only `_pl_change_log` live feed.
 * - live (`full_online`): route-scoped collection listeners (legacy billing-heavy path).
 */

import {
  getFirebaseLedgerSyncMode,
  type FirebaseLedgerSyncMode,
} from "@/lib/firebaseLedgerSyncMode";
import { isFirebaseLedgerDataSyncEnabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { readCachedGlobalSyncModeSettings } from "@/lib/globalSyncModeSettings";
import { isFirestoreListenerEnabled } from "@/lib/firestoreListenerToggles";

/** Where the effective mode came from — UI move to admin plans only needs this resolver. */
export type FirebaseLedgerSyncPolicySource = "device_preference" | "plan_override" | "build_default";

export type FirebaseLedgerSyncPlanOverride = {
  /** Force sync mode; omit to leave device preference. */
  syncMode?: FirebaseLedgerSyncMode;
  /** false = cloud ledger sync forbidden (e.g. Basic plan). */
  cloudDataSyncAllowed?: boolean;
  /** false = hide/disable user deltaa/live switch (plan locks mode). */
  allowUserModeSwitch?: boolean;
};

/**
 * Global product policy from SuperAdmin settings (`app_settings/sync_mode`).
 */
export function getFirebaseLedgerSyncPlanOverride(): FirebaseLedgerSyncPlanOverride | null {
  const globalMode = readCachedGlobalSyncModeSettings().mode;
  return {
    syncMode: globalMode,
    cloudDataSyncAllowed: true,
    allowUserModeSwitch: false,
  };
}

export type FirebaseLedgerSyncPolicy = {
  /** Effective mode after plan override. */
  syncMode: FirebaseLedgerSyncMode;
  source: FirebaseLedgerSyncPolicySource;
  /** Cloud ledger upload/download allowed (global toggle ∩ plan). */
  cloudDataSyncAllowed: boolean;
  /** User may flip deltaa/live in UI. */
  allowUserModeSwitch: boolean;
  /** SQLite-first reads/writes + outbox; Firestore is transport only. */
  usesSqliteTransport: boolean;
  /** Full-collection / master `onSnapshot` allowed (live mode only). */
  collectionLiveListenersAllowed: boolean;
  /** `_pl_change_log` listener + per-doc pull (deltaa only, when cloud sync on). */
  changeFeedDeltaSyncAllowed: boolean;
};

export function resolveFirebaseLedgerSyncPolicy(): FirebaseLedgerSyncPolicy {
  const plan = getFirebaseLedgerSyncPlanOverride();
  const deviceMode = getFirebaseLedgerSyncMode();
  let syncMode: FirebaseLedgerSyncMode = deviceMode;
  let source: FirebaseLedgerSyncPolicySource = "device_preference";

  if (plan?.syncMode === "local" || plan?.syncMode === "full_online") {
    syncMode = plan.syncMode;
    source = "plan_override";
  }

  const cloudDataSyncAllowed =
    (plan?.cloudDataSyncAllowed !== false) && isFirebaseLedgerDataSyncEnabled();
  const allowUserModeSwitch = plan?.allowUserModeSwitch !== false;
  const usesSqliteTransport = syncMode === "local";
  const collectionLiveListenersAllowed = syncMode === "full_online" && cloudDataSyncAllowed;
  const changeFeedDeltaSyncAllowed = usesSqliteTransport && cloudDataSyncAllowed;

  return {
    syncMode,
    source,
    cloudDataSyncAllowed,
    allowUserModeSwitch,
    usesSqliteTransport,
    collectionLiveListenersAllowed,
    changeFeedDeltaSyncAllowed,
  };
}

/** deltaa effective (plan or device). */
export function isFirebaseLedgerDeltaSqliteTransportMode(): boolean {
  return resolveFirebaseLedgerSyncPolicy().usesSqliteTransport;
}

/** Bind Firestore collection live listeners? False in deltaa on every platform. */
export function shouldBindFirebaseLedgerCollectionLiveListeners(): boolean {
  return resolveFirebaseLedgerSyncPolicy().collectionLiveListenersAllowed;
}

/** Bind `_pl_change_log` + doc pulls. */
export function shouldBindFirebaseLedgerChangeFeed(): boolean {
  return (
    resolveFirebaseLedgerSyncPolicy().changeFeedDeltaSyncAllowed &&
    isFirestoreListenerEnabled("delta.change_log")
  );
}
