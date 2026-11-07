
"use client";

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, ReactNode, useCallback, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./useAuth";
import { collection, query, where, Timestamp, doc } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDocs, getDocsFromServer, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import {
  auth,
  firestore,
  ensureEmbeddedFirestoreOnlineForCloudCompanyLoad,
  syncEmbeddedFirestoreTransportFromNavigator,
} from "@/lib/firebase";
import type { PermissionConfig } from "./usePermissions";
import {
  isLiveFirestoreCompanyRegistry,
  isLocalOnlyMode,
  isOfflineSqliteCompanyRegistry,
} from "@/lib/localMode";
import { markActiveAttachmentCompanyId, markSuppressFirestorePermissionForCompany } from "@/lib/firestorePermissionSuppress";
import {
  getLocalCompanyById,
  listLocalCompanies,
  localCompanyRowIsDeleted,
  removeLocalCompanyById,
  upsertLocalCompany,
} from "@/lib/localCompanyStore";
import { mergeSharedWithIntoLocalCompanyUsers, parseLocalCompanyUserRows } from "@/lib/localCompanyUsers";
import { companyRolesAuthorityExcludesFirebase } from "@/lib/permissionConfigSource";
import { isLocalCompanyVisibleToAppAccount } from "@/lib/localCompanyMembership";
import { higherPlanByTier, normalizePlanIdForClient, planTierIndex, type PlanId } from "@/config/plans";
import type { BillingFrozenPlanSnapshot } from "@/lib/billingFrozenPlanSnapshots";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import type { CompanyDemoteReason } from "@/lib/companyDemote";
import {
  isCurrentUserOwnerOfCompanyRow,
  isCurrentUserSharedOnCompanyRow,
  reconcileOnlineMirrorsWithServer,
  resolveCompanyIsOwnedForUser,
} from "@/lib/companyOnlineIntegrity";
import {
  isPureLocalLedgerCompany,
  isStructuralSqliteOnlyLedgerCompany,
  shouldReadLedgerFromSqliteOnly,
  isDeviceLocalCompany,
  isLocalSelectorCompanyRow,
  isStrictLocalOnlyCompany,
  stampPureLocalDeviceCompanyRow,
} from "@/lib/companyStorageKind";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT } from "@/lib/firebaseLedgerDataSyncDisabled";
import { getBillingApiIdToken } from "@/lib/firebaseAuthForApi";
import { FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isLocalBackupRestoredCompanyRow, readLocalBackupRestoreSelectionGrace } from "@/lib/localBackupRestoreCompany";
import {
  isProtectedDriveLocalRegistryRow,
  readDriveRestoreSelectionGrace,
} from "@/lib/driveRestoredLocalCompany";
import { overlayOwnerAccountPlanOnLocalCompany } from "@/lib/accountPlanForOwner";
import { readDriveOAuthReturnGrace } from "@/lib/driveOAuthReturnGrace";
import { BUMP_LOCAL_COMPANY_REGISTRY_EVENT } from "@/lib/applyStripePlanToLocalCompany";
import { isRestoreCloudFileUploadLocked, readPendingRestoreCloudPush } from "@/lib/restoreCloudBackgroundSync";
import { clearCompanyPlanLocalCache, readCompanyPlanLocalCache } from "@/lib/companyPlanLocalCache";
import {
  syncCompanyPlanFromServer,
  markDailyAuthoritativePlanSyncDone,
  PLAN_SERVER_SYNC_INTERVAL_MS,
  PLAN_SERVER_SYNC_STALE_INTERVAL_MS,
  PLAN_SYNC_STALE_AFTER_MS,
  readPlanAuthoritativeSyncTimestamp,
  recomputePlanSyncBannerState,
  shouldRunDailyAuthoritativePlanSync,
  type PlanSyncBannerState,
  type SyncCompanyPlanResult,
} from "@/lib/companyPlanServerSync";
import {
  getEffectiveNotificationSettings,
  NOTIFICATION_PREFS_CHANGED_EVENT,
} from "@/lib/localUserNotificationSettings";
import type { LinkAllocationSettings } from "@/lib/linkAllocationSettings";
import {
  getLocalFiscalSplitOrDefaults,
  LOCAL_FISCAL_SPLIT_CHANGED_EVENT,
  readLocalFiscalSplit,
} from "@/lib/localFiscalSplitStore";
import {
  scheduleBackfillCloudFiscalSplitFromLocal,
  seedLocalFiscalSplitFromCompanyDocIfNeeded,
} from "@/lib/persistFiscalSplitSettings";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import { filterSharedOnlyCompaniesForSuperAdminInMainApp } from "@/lib/companySuperAdminFilter";
import { getActiveGate, writeActiveGateId } from "@/lib/gates/gateStore";
import {
  filterCompaniesForActiveGate,
  isLocalServerGate,
  pickGateAwareAutoSelectCompanyId,
  activateGate,
} from "@/lib/gates/gateRuntime";
import { mergePlServerSharedCompaniesIntoRegistry, getPlServerContextGateId, shouldMergePlServerSharedIntoRegistry, PL_SERVER_ACCESS_CONTEXT_EVENT, isListedPlServerSharedCompany } from "@/lib/plServerAccessContext";
import { isServerGateCompany } from "@/lib/companyStorageKind";
import {
  filterPackedMyCompanyRows,
  isPackedServerManageCompany,
  isPlServerPackedApp,
  isServerManageOnlyScope,
} from "@/lib/plServerPackedApp";
import {
  isCompanyAllowedOnActiveServerGate,
  shouldRetainServerGateCompanySelection,
} from "@/lib/plServerRemoteCompanyLogin";
import { PL_SERVER_CLIENT_DELTA_EVENT } from "@/lib/plServerClientCompanyDelta";
import {
  shouldSkipFirestoreCompanyRegistryOnPlStaff,
  tracePlServerFirebaseHit,
} from "@/lib/plServerFirebaseHitTrace";
import { companyRowMatchesSelectionId } from "@/lib/plServerHostCompanyId";
import { PL_GATE_CHANGED_EVENT } from "@/lib/gates/gateTypes";
import { sharedCompanyQueryKey, sharedCompanyQuerySpecs, resolveFirestoreAuthEmail, ownerEmailQueryVariants } from "@/lib/sharedWithEmailsQuery";
import {
  pullOnlineCompanyRegistryFromFirestore,
  purgeGhostOnlineCompanyDeltas,
  resolveMirrorUserEmail,
} from "@/lib/mirrorOnlineCompaniesFromFirestore";
import {
  isPocketBaseSessionUser,
  PB_APP_SESSION_EVENTS,
  pullPocketBaseCompanyRegistry,
} from "@/lib/pocketbaseData/pbAppSession";
import { companyUsesPocketBase, isPocketBaseCompanyId, isPocketBaseCompanyPruned } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { prunePocketBaseCompaniesMissingOnServer } from "@/lib/pocketbaseData/pbRegistryPrune";

/**
 * Server login (pl_users): Firebase cloud companies stay hidden - only Pocket Ledger Server
 * companies plus local / offline ones are listed (Firestore is never touched in that session).
 */
import {
  isFirebaseCloudRowHiddenInServerSession,
  isServerOnlyLoginSession,
} from "@/lib/pocketbaseData/serverSessionCompanyScope";
import { clearSelectedCompanyId, pinBootSelectedCompanyId, readSelectedCompanyId, writeSelectedCompanyId } from "@/lib/selectedCompanyStorage";
import {
  isAdminPanelCompanyLedgerMode,
  isAdminPanelCompanyLocalId,
  resolveAppCompanyIdAfterAdminPanel,
} from "@/lib/adminPanelCompany/ledgerMode";
import { shouldSuppressTransientCompanyClear, shouldDeferMissingCompanyRedirectNative } from "@/lib/apkLedgerRouteShield";
import { plDbgCompanyRecovery } from "@/lib/plDebugCompanyRecovery";
import { ensureCompanyInterCompanyAcNo } from "@/lib/interCompany/ensureCompanyInterCompanyAcNo";
import {
  readCompanyInterCompanyCode,
  resolveOrEnsureCompanyInterCompanyCode,
} from "@/lib/interCompany/interCompanyCompanyCode";
import { readCompanyInterCompanyAcNo } from "@/lib/interCompany/interCompanyAccountNo";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import { plNavDbg, plNavDbgCritical, plNavDbgIdHint } from "@/lib/plNavRedirectDebug";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import {
  logCompanyOnlinePlFlip,
  markStickyPlServerCompanyId,
  shouldPreferPlServerOverCloudRow,
  shouldRetainPlServerCompanyShape,
} from "@/lib/companyOnlinePlFlipTrace";
import { PL_SERVER_COMPANY_META_UPDATED_EVENT } from "@/lib/plServerCompanyMetaSync";
import {
  embeddedClientRequiresServerPlanSyncWhenOnline,
  shouldSkipPeriodicPlanSyncForLocalOnlyMode,
} from "@/lib/planSyncClientPolicy";
import { isHostedPlanSyncDisabled } from "@/lib/hostedPlanSyncDisabled";
import { shouldSkipEmbeddedStartupAuthChurn } from "@/lib/embeddedWarmBootstrapFlags";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { withoutWebAppBasePath } from "@/lib/webAppBasePath";
import { plCallerFrame, plCallerStack, plRegistryPullDebug } from "@/lib/registryPullDebug";
import { isPbOnlySession } from "@/lib/pocketbaseData/userDisplayNameSession";

export type DisplaySettings = {
    showDebit?: boolean;
    showCredit?: boolean;
    showBalance?: boolean;
    showTotalDebit?: boolean;
    showTotalCredit?: boolean;
    /** Poori app me date reference: AD, BS, ya dono (toolbar / forms / recurring labels). */
    calendarDateSystem?: "AD" | "BS" | "Both";
};

/** Owner-controlled profile-plan rows that shared users may see for this company. Missing = visible. */
export type SharedUserProfilePlanRows = Partial<
  Record<
    | "allStorage"
    | "dailyVoucher"
    | "monthlyVoucher"
    | "onlineSlots"
    | "localSlots"
    | "usersDevices"
    | "attachments"
    | "storage"
    | "expiry",
    boolean
  >
>;

/** Per-type notification visibility: master on/off + where to show (entity pages, list pages, transaction rows). */
export type NotificationTypeSettings = {
    on?: boolean;
    onEntity?: boolean;
    onList?: boolean;
    onTransaction?: boolean;
};

/** When on, admin (company owner) receives alerts. onEntity = sidebar Messages menu, onTabs = Alerts tab badge, onList = chat/conversation list. */
export type TransactionAlertsSettings = {
    on?: boolean;
    onEntity?: boolean;
    onTabs?: boolean;
    onList?: boolean;
};

export type NotificationSettings = {
    approve?: NotificationTypeSettings;
    message?: NotificationTypeSettings;
    transactionAlerts?: TransactionAlertsSettings;
};

export type IdSettings = {
    party?: boolean;
    bank?: boolean;
    staff?: boolean;
    tax?: boolean;
    item?: boolean;
}

export type HandoverInfo = {
  email: string;
  initiatedAt: Timestamp;
};

export type Company = {
    id: string;
    name: string;
    address?: string;
    pan?: string;
    phone?: string;
    email?: string;
    logoUrl?: string | null;
    password?: string;
    /** Company Profile — offline/shared cloud unlock ke liye (Firestore doc). */
    adminUsername?: string | null;
    ownerId: string;
    ownerEmail?: string;
    sharedWith?: any[];
    sharedWithEmails?: string[];
    permissionConfig?: PermissionConfig;
    fiscalYearStart?: Timestamp;
    fiscalYearEnd?: Timestamp;
    voucherPrefixes?: Record<string, string[]>;
    autoVoucherNumbering?: Record<string, boolean>;
    /** Default true — auto voucher nos embed FY span from voucher date (e.g. PUR-82-83-002). */
    autoVoucherIncludeFy?: boolean;
    voucherNumberFyFormat?: "short" | "mixed" | "full";
    allowVoucherNumberEditing?: Record<string, boolean>;
    enableVoucherPrefixSelection?: Record<string, boolean>;
    allowRateEditing?: Record<string, boolean>;
    idSettings?: IdSettings;
    backDateEntryDays?: number;
    backDateEditDays?: number;
    backDateDeleteDays?: number;
    decimalPlaces?: number;
    showDrCr?: boolean;
    showCurrencySymbol?: boolean;
    /** Currency symbol to display (e.g. "Rs.", "₹", "$"). Default "Rs." */
    currencySymbol?: string;
    /** ISO 4217 — country se default; company profile currency dropdown se override. */
    currencyCode?: string;
    displaySettings?: DisplaySettings;
    /** Sale/Purchase line grid column labels (Voucher Settings — company-wide). */
    salePurchaseLineColumnLabels?: import("@/lib/salePurchaseLineColumnLabels").SalePurchaseLineColumnLabels;
    /** Default discount adjustment expense account — sale/purchase forms (company-wide). */
    saleDiscountExpenseAccountId?: string;
    purchaseDiscountExpenseAccountId?: string;
    /** Anusuchi 13 report — default minimum FY transaction (company-wide; fallback 100000). */
    anusuchi13DefaultThreshold?: number;
    isApprovalEnabled?: boolean;
    isOwned?: boolean;
    planId?: string;
    planExpiry?: Timestamp;
    /** Firestore / SQLite mirror — billing + offline sync ke liye numeric expiry (Timestamp ke saath). */
    planExpiryMs?: number;
    /** Active Stripe subscription id — expiry miss par server `current_period_end` se repair. */
    stripeSubscriptionId?: string;
    /** Owner billing checkbox — `invoice.payment_failed` par 3 din grace + notice (Stripe subscription). */
    billingAutoRenew?: boolean;
    billingAutoRenewFailureNoticeEn?: string;
    billingAutoRenewFailureNoticeUntilMs?: number;
    /** Pure device-local company (no cloud ledger sync). */
    localOnly?: boolean;
    /** Firestore ledger sync intentionally off for this company. */
    firestoreSyncDisabled?: boolean;
    /**
     * Paid expiry ke baad renew na ho to Basic — default ON; owner billing se `false` kar sakta hai.
     * Server `sync-plan` par `applyExpiredPaidPlanAutoDowngrade` is flag ko dekhta hai.
     */
    autoDowngradeToBasicWhenExpired?: boolean;
    /** Set when a paid plan is applied (Stripe fulfill); good proxy for “joined” paid subscription date. */
    planUpgradedAt?: Timestamp;
    /** Paid upgrade ke waqt chhode hue tier ka usage/credit snapshot — UI frozen pills + server truth. */
    billingFrozenUsageLedger?: BillingFrozenPlanSnapshot[];
    /** In tiers par downgrade / “Just change plan” block (e.g. Advance lock after Advance→Pro). */
    billingBlockedDowngradePlanIds?: string[];
    settings?: Record<string, boolean>;
    allowAttachments?: boolean;
    isDeleted?: boolean; 
    /** Admin recycle-bin hidden marker: normal app company list se always hide. */
    movedToAdminRecycleAt?: unknown;
    handoverTo?: string | null;
    handoverStatus?: 'pending' | 'accepted' | null;
    handoverInitiatedAt?: Timestamp | null;
    storageOption?: 'firebase' | 'drive' | 'local';
    /** Online data server (e.g. "pocketbase"); read by companyStorageKind / onlineDataServer. */
    onlineServerId?: string | null;
    onlineDataBackend?: string | null;
    /** PL Server gate se mirrored / shared company — Server tab + SQLite-only ledger. */
    plServerShared?: boolean;
    /** Firestore mirror / SQLite row: company cloud se aayi */
    syncedFromCloud?: boolean;
    /** Local-first: online vs offline sync mode (company root). */
    syncPolicy?: 'online' | 'offline';
    /** Jab Firestore doc missing / access lost — local-only demote timestamp. */
    demotedFromOnlineAt?: number;
    /** Demote ka reason — UI info banner + I-icon copy. */
    demoteReason?: CompanyDemoteReason;
    /** Enable "Link Payment to Txns" feature (allocate payment to invoices). */
    enableLinkPaymentToTxns?: boolean;
    /**
     * Settings → Link allocation: which sources may settle multi-account voucher legs
     * (Add Salary / Sale / Purchase). Missing = same-entity only (default).
     */
    linkAllocation?: LinkAllocationSettings;
    /** Header "Copy ledger" + cross-company party ledger tools — role `copy_ledger_cross_company` bhi chahiye. */
    enableCrossCompanyLedgerCopy?: boolean;
    /** Header Share for Reconciliation + linked account compare — plan + role alag. */
    enableShareForReconciliation?: boolean;
    /** Country selected when company was created (e.g. Nepal for VAT reports). */
    country?: string;
    /** Inter-company network: 15-digit company A/c No (auto-generated on create / company open). */
    interCompanyAccountNo?: string;
    /** Inter-company: SWIFT-style company code (UI — alag numeric A/c No se). */
    interCompanyCompanyCode?: string;
    /** Approve & message notification on/off and where to show (entity, list, transaction). */
    notificationSettings?: NotificationSettings;
    /** Profile plan rows the company owner allows shared users to see. Missing rows stay visible. */
    sharedUserProfilePlanRows?: SharedUserProfilePlanRows;
    /** Tracked usage for plan limits (bytes). */
    attachmentsUsedBytes?: number;
    storageUsedBytes?: number;
    /** If false, shared users can only use one device; when they log in on a new device, they must log out from this device or replace the old one. Plan max devices still applies. */
    userCanUseMultiDevice?: boolean;
    /** Plan-wise: enable voucher edit history. Company can further toggle. */
    voucherHistoryEnabled?: boolean;
    /** Max history entries per voucher (capped by plan). */
    voucherHistoryLimit?: number;
    /** When history full: block_edit = disallow edit; allow_edit_delete_last = allow edit, overwrite oldest. */
    voucherHistoryFullBehavior?: 'block_edit' | 'allow_edit_delete_last';
    /** Recurring auto vouchers: app-open month-end generator controls. */
    recurringVoucherSettings?: {
      enabled?: boolean;
      runScope?: "owner_only" | "all_users" | "selected_users";
      allowedUserIds?: string[];
      /** @deprecated — Manage Sharing → Recurring Auto Voucher permissions. */
      voucherAutoEditorsScope?: "all_configure_users" | "owner_only" | "selected_users";
      voucherAutoEditorsUserIds?: string[];
    };
    /** Firestore `companies/{id}` — local SQLite id alag ho to sync-plan yahan se */
    authoritativeCompanyId?: string;
    /** Outstanding (R/P) dialog + dashboard card: hidden category ids — owner only edit. */
    receivablesPayablesHiddenCategories?: string[];
    /** Server offline-license window end (`sync-plan` har online + max 20d chunk) */
    offlineLicenseValidUntilMs?: number;
    /**
     * Fiscal split — device `localFiscalSplitStore` + company root doc (SQLite / Firestore) merge.
     * `getFiscalMergePartitionDateFromCompany` / ledger divider isi pe chalta hai.
     */
    fiscalSplitMode?: "off" | "merge";
    fiscalMergePartitionAt?: Timestamp | { toDate: () => Date } | null;
    fiscalMergePartitionAtIsos?: string[] | null;
    fiscalMergeTickedFyKeys?: string[] | null;
    fiscalPartitionLabel?: string | null;
    /** Fiscal split root version used to update device-local settings from newer cloud changes. */
    fiscalSplitUpdatedAtMs?: number | null;
    /** Sale/Purchase line "+ Add unit" — persisted labels (deduped) for dropdown without retyping. */
    customUnits?: string[];
    /**
     * Server backup (outbox flush): same `companies/{id}/subcollections` paths; payload AES-GCM in `plEncrypted*` fields.
     * Default OFF. Key material comes from the company login session (username+password → sessionStorage), not a separate passphrase.
     */
    encryptServerBackup?: boolean;
    /** PBKDF2 salt (base64 on company doc); combined with session-derived key from successful local login. */
    encryptServerBackupSalt?: string;
};

/** Main app visibility guard: recycle-bin hidden/admin-hidden company selector me na aaye. */
function isCompanyVisibleInMainApp(row: { isDeleted?: unknown; movedToAdminRecycleAt?: unknown }): boolean {
  return row.isDeleted !== true && row.movedToAdminRecycleAt == null;
}

function normalizeFiscalPartitionIsos(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
    .map((v) => v.trim());
  return out.length ? out : null;
}

/** Firestore/SQLite row + device-local fiscal split → single `company` shape for ledgers. */
function mergeCompanyWithLocalFiscal(base: Company | null, cid: string | null): Company | null {
  if (!base) return null;
  const companyKey = cid ?? base.id;
  const localStored = readLocalFiscalSplit(companyKey);
  const local = localStored ?? getLocalFiscalSplitOrDefaults(companyKey);
  const cloudIsos = normalizeFiscalPartitionIsos(base.fiscalMergePartitionAtIsos);
  const cloudMerge = base.fiscalSplitMode === "merge" && Boolean(cloudIsos?.length);
  const localConfigured =
    local.fiscalSplitConfiguredByUser ||
    (local.fiscalSplitMode === "merge" &&
      Boolean(local.fiscalMergePartitionAtIsos?.length || local.fiscalMergePartitionAtIso));
  const cloudUpdatedAtMs = Number(base.fiscalSplitUpdatedAtMs) || 0;
  const localUpdatedAtMs = Number(local.fiscalSplitUpdatedAtMs) || 0;
  const cloudIsNewer = cloudUpdatedAtMs > localUpdatedAtMs;

  if (cloudIsNewer) {
    const useCloudMerge = cloudMerge && Boolean(cloudIsos?.length);
    const iso = useCloudMerge ? cloudIsos?.[0] ?? null : null;
    return {
      ...base,
      fiscalSplitMode: useCloudMerge ? "merge" : "off",
      fiscalMergePartitionAt: iso ? { toDate: () => new Date(iso) } : null,
      fiscalMergePartitionAtIsos: useCloudMerge ? cloudIsos : null,
      fiscalMergeTickedFyKeys: useCloudMerge ? base.fiscalMergeTickedFyKeys ?? null : null,
      fiscalPartitionLabel: useCloudMerge ? base.fiscalPartitionLabel ?? null : null,
    };
  }

  if (!localConfigured && !localStored && cloudMerge && cloudIsos) {
    const iso = cloudIsos[0] ?? null;
    return {
      ...base,
      fiscalSplitMode: "merge",
      fiscalMergePartitionAt: iso ? { toDate: () => new Date(iso) } : null,
      fiscalMergePartitionAtIsos: cloudIsos,
      fiscalMergeTickedFyKeys: base.fiscalMergeTickedFyKeys ?? null,
      fiscalPartitionLabel: base.fiscalPartitionLabel ?? null,
    };
  }

  const isos =
    local.fiscalSplitMode === "merge"
      ? local.fiscalMergePartitionAtIsos ?? (local.fiscalMergePartitionAtIso ? [local.fiscalMergePartitionAtIso] : null)
      : null;
  const iso = isos?.[0] ?? null;
  return {
    ...base,
    fiscalSplitMode: local.fiscalSplitMode,
    fiscalMergePartitionAt:
      local.fiscalSplitMode === "merge" && iso ? { toDate: () => new Date(iso) } : null,
    fiscalMergePartitionAtIsos: isos,
    fiscalMergeTickedFyKeys: local.fiscalMergeTickedFyKeys,
    fiscalPartitionLabel: local.fiscalPartitionLabel,
  };
}

/** Stripe / SQLite / Firestore mix: expiry compare ke liye ms */
function planExpiryMsFromCompanyShape(c: Company): number | null {
  const a = c as unknown as { planExpiryMs?: unknown };
  if (typeof a.planExpiryMs === "number" && Number.isFinite(a.planExpiryMs)) return a.planExpiryMs;
  const pe = c.planExpiry;
  if (pe && typeof (pe as Timestamp).toMillis === "function") return (pe as Timestamp).toMillis();
  return null;
}

/** Company doc (Firestore `doc.data()` ya SQLite JSON) se last-write ms — cloud mirror stale overwrite avoid. */
function companyDocUpdatedAtMs(row: Record<string, unknown>): number {
  const u = row.updatedAt;
  if (u != null && typeof u === "object" && "toMillis" in u && typeof (u as { toMillis?: () => number }).toMillis === "function") {
    try {
      const ms = (u as { toMillis: () => number }).toMillis();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }
  if (typeof u === "number" && Number.isFinite(u)) return u;
  return 0;
}

/**
 * Same companyId par Firestore snapshot + SQLite mirror — listener pe cloud Basic aur local Pro race;
 * local paid / nayi expiry UI me overlay (local-first company + paid edge).
 */
function mergeOnlineCompanyWithLocalPlanOverlay(online: Company, localNorm: Company): Company {
  const raw = localNorm as unknown as {
    storageOption?: string;
    syncPolicy?: string;
    syncedFromCloud?: boolean;
    planExpiryMs?: number;
    planUpgradedAtMs?: number;
    lastStripeCheckoutSessionId?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    authoritativeCompanyId?: string;
    offlineLicenseValidUntilMs?: number;
  };

  // Local restore / device SQLite: billing cloud se merge ho sakta hai — ledger path kabhi Firestore par mat flip.
  // Cloud sync kill-switch yahan mat lagao — sirf structural local/server rows Online tab se Local me mat bhejo.
  if (isStructuralSqliteOnlyLedgerCompany(localNorm)) {
    return {
      ...localNorm,
      planId: higherPlanByTier(online.planId, localNorm.planId),
      planExpiry: localNorm.planExpiry ?? online.planExpiry,
      ...(typeof raw.planExpiryMs === "number" ? { planExpiryMs: raw.planExpiryMs } : {}),
      ...(typeof raw.planUpgradedAtMs === "number" ? { planUpgradedAtMs: raw.planUpgradedAtMs } : {}),
      ...(raw.lastStripeCheckoutSessionId ? { lastStripeCheckoutSessionId: raw.lastStripeCheckoutSessionId } : {}),
      ...(raw.stripeCustomerId ? { stripeCustomerId: raw.stripeCustomerId } : {}),
      ...(raw.stripeSubscriptionId ? { stripeSubscriptionId: raw.stripeSubscriptionId } : {}),
      ...(typeof raw.offlineLicenseValidUntilMs === "number"
        ? { offlineLicenseValidUntilMs: raw.offlineLicenseValidUntilMs }
        : {}),
      storageOption: "local",
      syncPolicy: (raw.syncPolicy as string) || "offline",
      syncedFromCloud: false,
      demoteReason: (localNorm as { demoteReason?: string }).demoteReason,
      demotedFromOnlineAt: (localNorm as { demotedFromOnlineAt?: number }).demotedFromOnlineAt,
    } as Company;
  }

  const le = planExpiryMsFromCompanyShape(localNorm);
  const oe = planExpiryMsFromCompanyShape(online);
  const lp = normalizePlanIdForClient(localNorm.planId);
  const op = normalizePlanIdForClient(online.planId);
  const onlineUpMs =
    typeof (online as unknown as { planUpgradedAtMs?: unknown }).planUpgradedAtMs === "number" &&
    Number.isFinite((online as unknown as { planUpgradedAtMs: number }).planUpgradedAtMs)
      ? (online as unknown as { planUpgradedAtMs: number }).planUpgradedAtMs
      : 0;
  const localUpMs =
    typeof raw.planUpgradedAtMs === "number" && Number.isFinite(raw.planUpgradedAtMs) ? raw.planUpgradedAtMs : 0;
  // Admin / sync-plan ne Firestore par naya `planUpgradedAtMs` likha ho — SQLite purana paid tier mat chipkao (billing UI turant sahi).
  if (onlineUpMs > localUpMs) return online;
  // Tier Firestore par neeche (demote) lekin SQLite ab bhi upar — server authoritative.
  if (planTierIndex(op) < planTierIndex(lp)) return online;

  const isLocalFirst =
    raw?.storageOption === "local" ||
    raw?.syncPolicy === "offline" ||
    raw?.syncedFromCloud !== true;
  let useLocal = false;
  if (isLocalFirst) useLocal = true;
  // HATA: `localPaid && onlineBasic` — Firestore downgrade/basic authoritative ho tab bhi purana SQLite pro-plus `higherPlanByTier` se chipak jata tha (checkout vs profile mismatch).
  else if (le != null && oe != null && le > oe) useLocal = true;
  else if (le != null && oe == null) useLocal = true;

  if (!useLocal) return online;

  // Firestore `basic` + online-style row: stale SQLite paid tier merge mat karo (`isLocalFirst` galat true ho to bhi).
  if (op === "basic" && String(raw.storageOption || "").toLowerCase() !== "local") {
    return online;
  }

  // SQLite `basic` + Firestore `pro-plus` jab `isLocalFirst` galat true ho (purana mirror flags) — sirf local planId mat chipkao;
  // dono me se zyada tier lo taaki shared user owner subscription dekh sake.
  const mergedPlan = {
    ...online,
    planId: higherPlanByTier(online.planId, localNorm.planId),
    planExpiry: localNorm.planExpiry ?? online.planExpiry,
    ...(typeof raw.planExpiryMs === "number" ? { planExpiryMs: raw.planExpiryMs } : {}),
    ...(typeof raw.planUpgradedAtMs === "number" ? { planUpgradedAtMs: raw.planUpgradedAtMs } : {}),
    ...(raw.lastStripeCheckoutSessionId ? { lastStripeCheckoutSessionId: raw.lastStripeCheckoutSessionId } : {}),
    ...(raw.stripeCustomerId ? { stripeCustomerId: raw.stripeCustomerId } : {}),
    ...(raw.stripeSubscriptionId ? { stripeSubscriptionId: raw.stripeSubscriptionId } : {}),
    ...(raw.authoritativeCompanyId ? { authoritativeCompanyId: raw.authoritativeCompanyId } : {}),
    ...(typeof raw.offlineLicenseValidUntilMs === "number"
      ? { offlineLicenseValidUntilMs: raw.offlineLicenseValidUntilMs }
      : {}),
  } as Company;

  // SQLite me `storageOption: local` (restore/offline) — Firestore row me abhi bhi "firebase" ho sakta hai; spread se merged list galat ho jati thi → sync upsert + vouchers cloud path = data "gayab"
  if (String(raw.storageOption || "").toLowerCase() === "local") {
    return {
      ...mergedPlan,
      storageOption: "local",
      syncPolicy: (raw.syncPolicy as string) || "offline",
      syncedFromCloud: false,
      demoteReason: (localNorm as { demoteReason?: string }).demoteReason,
      demotedFromOnlineAt: (localNorm as { demotedFromOnlineAt?: number }).demotedFromOnlineAt,
    } as Company;
  }

  return mergedPlan;
}

/** Background cloud-sync tick fields — in-memory company ref stable rakho jab sirf ye badlen. */
const COMPANY_CLOUD_SYNC_VOLATILE_KEYS = [
  "cloudSyncLastSyncAt",
  "cloudSyncStatus",
  "cloudSyncLastError",
  "cloudSyncLastSyncSummary",
  "updatedAt",
] as const;

function companyLedgerUiFingerprint(company: Company | null | undefined): string {
  if (!company) return "";
  const row = { ...company } as Record<string, unknown>;
  for (const key of COMPANY_CLOUD_SYNC_VOLATILE_KEYS) delete row[key];
  return JSON.stringify(row);
}

/** Host/local SQLite settings — PL shape retain ke baad bhi root fields merge karo (voucher/decimal/share). */
function mergePlHostCompanyMetaFields(prev: Company, next: Company): Company {
  const keys = [
    "permissionConfig",
    "localCompanyUsers",
    "sharedWith",
    "voucherPrefixes",
    "autoVoucherNumbering",
    "autoVoucherIncludeFy",
    "voucherNumberFyFormat",
    "allowVoucherNumberEditing",
    "allowRateEditing",
    "enableVoucherPrefixSelection",
    "enableLinkPaymentToTxns",
    "linkAllocation",
    "enableCrossCompanyLedgerCopy",
    "enableShareForReconciliation",
    "spendWiseEnabled",
    "spendWiseOppositeVoucherEditable",
    "requirePaymentLinkByRole",
    "voucherHistoryEnabled",
    "voucherHistoryLimit",
    "voucherHistoryFullBehavior",
    "recurringVoucherSettings",
    "decimalPlaces",
    "showDrCr",
    "showCurrencySymbol",
    "currencyCode",
    "currencySymbol",
    "displaySettings",
    "anusuchi13DefaultThreshold",
    "name",
    "address",
    "pan",
    "phone",
    "email",
    "logoUrl",
    "adminUsername",
  ] as const;
  const prevRec = prev as Company & Record<string, unknown>;
  const nextRec = next as Company & Record<string, unknown>;
  let changed = false;
  const merged: Company & Record<string, unknown> = { ...prevRec };
  for (const key of keys) {
    if (!(key in nextRec) || nextRec[key] === undefined) continue;
    if (JSON.stringify(prevRec[key] ?? null) === JSON.stringify(nextRec[key] ?? null)) continue;
    (merged as Record<string, unknown>)[key] = nextRec[key];
    changed = true;
  }
  return changed ? (merged as Company) : prev;
}

function keepCompanyRefIfLedgerUnchanged(prev: Company | null, next: Company | null): Company | null {
  if (!next) return null;
  if (!prev) return next;
  if (prev.id !== next.id) return next;
  // Dual Firebase+PL same id: cloud stamp se PL row overwrite = header Sync/Recon + voucher blink.
  if (shouldRetainPlServerCompanyShape(prev, next)) {
    const merged = mergePlHostCompanyMetaFields(prev, next);
    // Only block Firebase/cloud stamps from wiping host SQLite roles.
    // Host Manage Sharing / meta pull brings next.localCompanyUsers from SQLite — keep those.
    const nextIsCloudStamp =
      isCloudLinkedCompanyStorage(next) && !companyRolesAuthorityExcludesFirebase(next);
    if (nextIsCloudStamp) {
      (merged as { permissionConfig?: unknown }).permissionConfig = (
        prev as { permissionConfig?: unknown }
      ).permissionConfig;
      (merged as { localCompanyUsers?: unknown }).localCompanyUsers = (
        prev as { localCompanyUsers?: unknown }
      ).localCompanyUsers;
      (merged as { sharedWith?: unknown }).sharedWith = (prev as { sharedWith?: unknown }).sharedWith;
    }
    logCompanyOnlinePlFlip("keepRef_retain_pl_block_cloud", {
      before: prev,
      after: next,
      source: "keepCompanyRefIfLedgerUnchanged",
      extra: { metaMerged: merged !== prev, nextIsCloudStamp },
    });
    return merged;
  }
  if (companyLedgerUiFingerprint(prev) === companyLedgerUiFingerprint(next)) {
    return mergePlHostCompanyMetaFields(prev, next);
  }
  return next;
}

function planSyncBannerStatesEqual(a: PlanSyncBannerState, b: PlanSyncBannerState): boolean {
  return (
    a.lastSuccessAtMs === b.lastSuccessAtMs &&
    a.isStale === b.isStale &&
    a.needsOnlinePlanSync === b.needsOnlinePlanSync &&
    a.offlineLicenseValidUntilMs === b.offlineLicenseValidUntilMs &&
    a.offlineLicenseExpired === b.offlineLicenseExpired &&
    a.isBrowserOnline === b.isBrowserOnline &&
    a.planSyncInFlight === b.planSyncInFlight
  );
}

type CompanyContextType = {
  companyId: string | null;
  company: Company | null;
  /** Active gate + server token filter — header / day-to-day UI. */
  allCompanies: Company[];
  /** Poori registry (owned + shared) — Gate page / company picker detail. */
  allCompaniesRegistry: Company[];
  loading: boolean;
  /** Light tick: plan-banner + online Firestore listeners re-attach (company root / sharing change). */
  triggerSync: () => void;
  /** Static/local-only: poori company list + cloud mirror dubara — party/voucher save par mat chalao. */
  reloadLocalCompanyRegistry: () => void;
  /** Create Company: SQLite save ke turant baad list + selection — registry reload race se form wapas na khule. */
  adoptNewLocalCompany: (row: import("@/lib/localCompanyStore").LocalCompanyDoc) => void;
  /** Local-only registry reload counter — SQLite company row refresh (e.g. Edit Company “Existing users”). */
  localCompanyRegistryEpoch: number;
  setCompanyId: (companyId: string) => void;
  clearCompanyId: (opts?: { force?: boolean; reason?: string }) => void;
  /** Server → local sync UX: 3d stale, 20d “go online”, offline license expiry */
  planAuthoritativeSync: PlanSyncBannerState;
  /** Manual: POST `/api/company/sync-plan` → SQLite overwrite + banner; avatar “Sync plan” se. */
  refreshAuthoritativePlan: () => Promise<SyncCompanyPlanResult>;
  /** LocalStorage + current user: badges/sidebar — Firestore company row sirf fallback (unsynced company bhi). */
  effectiveNotificationSettings: NotificationSettings;
};

// Exporting context so specific surfaces (e.g. voucher dialog) can override `companyId`/`company`
// for nested forms ke save target without touching global app state. Outer pages bina disturb hue rehte hain.
export const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

/** Trailing slash hataune; optional `/app` prefix hata ke route match karo. */
function normalizeAppPath(p: string): string {
  return withoutWebAppBasePath((p || "").replace(/\/+$/, "") || "/");
}

/** Browser URL (Capacitor WebView ma `href` reliable) */
function getBrowserPathname(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URL(window.location.href).pathname || window.location.pathname || "";
  } catch {
    return window.location.pathname || "";
  }
}

/**
 * In routes ma "pick company" push mat karo — Settings + sidebar footer static/APK ma pathname delay hunda timer galat fire hunchha.
 * NOTE: `if (t === "/") return true` harek candidate ma hataeko — mix `["/","/settings"]` ma settings miss hunthyo.
 */
function pathExemptFromAutoSelectCompanyPush(t: string): boolean {
  if (isAdminPanelCompanyLedgerMode()) return true;
  const p = normalizeAppPath(t);
  if (p === "/not-authorized") return true;
  if (p.startsWith("/company") || p.startsWith("/admin") || p.startsWith("/settings")) return true;
  if (p.startsWith("/gate")) return true;
  if (p.startsWith("/messages")) return true;
  if (p.startsWith("/billing")) return true;
  if (p.startsWith("/backup")) return true;
  if (p.startsWith("/import-export")) return true;
  if (p.startsWith("/recycle-bin")) return true;
  if (p.startsWith("/distributor-signup")) return true;
  if (p.startsWith("/embed")) return true;
  // Reconciling compare — static refresh par company picker push na ho
  if (p.startsWith("/reconciliation")) return true;
  return false;
}

function shouldSkipMissingCompanyRedirect(pathA: string, pathB: string): boolean {
  const a = normalizeAppPath(pathA);
  const b = normalizeAppPath(pathB);
  const uniq = a === b ? [a] : [a, b];
  for (const t of uniq) {
    if (pathExemptFromAutoSelectCompanyPush(t)) return true;
  }
  // Hydration / khali path: dubai "/" matra
  if (uniq.every((t) => t === "/")) return true;
  return false;
}

/** Local-first: company switch pe turant SQLite hydrate; Firestore global mirror default ~1.5 min (delete/share revoke). */
const LOCAL_REGISTRY_GLOBAL_MIRROR_DELAY_MS = 90_000;

/** APK/`build:static`/Capacitor: shared companies bhi jaldi registry me — 90s defer se pehle sirf ek row dikhne jaisa UX. */
function embeddedStaticRegistryDeferMs(): number {
  if (isStaticAppBuild()) return 1_600;
  if (typeof window !== "undefined" && isCapacitorNativeApp()) return 1_600;
  return LOCAL_REGISTRY_GLOBAL_MIRROR_DELAY_MS;
}

/** Legacy owner migration: kuch companies ka `ownerId` अभी bhi old `users/{docId}` par ho sakta hai, isliye uid + userDocId dono query karo. */
function resolveOwnerIdQueryCandidates(
  firebaseUid: string | null | undefined,
  userDocId: string | null | undefined
): string[] {
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
  };
  add(firebaseUid);
  add(userDocId);
  return Array.from(seen);
}

/** Plan-only sync is allowed for local SQLite rows; `sync-plan` keeps ledger identity local. */
function canRunServerPlanSyncForCompanyRow(row: Company | null | undefined): boolean {
  if (!row) return false;
  if (isServerGateCompany(row) || row.plServerShared === true) return true;
  const storage = String((row.storageOption || "local") as string).toLowerCase().trim();
  const authoritative = String((row.authoritativeCompanyId || "") as string).trim();
  if (storage === "local" && !authoritative) return true;
  return true;
}

/** Online shared: list/SQLite race — khali list par 0ms grace = turant clear */
const LIST_RECOVERY_ONLINE_EMPTY_GRACE_MS = 4500;
const LIST_RECOVERY_ONLINE_NONEMPTY_GRACE_MS = 3200;
/** `deferPulse` infinite loop guard — React #185 (max update depth) slow PC + stale registry. */
const LIST_RECOVERY_MAX_DEFER_PULSES = 24;

/** Refresh boot: gate/list/server-access settle hone se pehle pinned company mat clear karo (EXE SQLite/Firestore slow). */
function companyRefreshBootGraceMs(): number {
  if (isElectronDesktopApp()) return 12_000;
  if (isStaticAppBuild() || isCapacitorNativeApp()) return 9000;
  return 4500;
}

function shouldDeferRefreshBootCompanyClear(
  companyId: string,
  mountedAtMs: number,
  bootPinnedId: string
): boolean {
  const id = String(companyId || "").trim();
  const pinned = String(bootPinnedId || readSelectedCompanyId() || "").trim();
  if (!id || !pinned || id !== pinned) return false;
  if (Date.now() - mountedAtMs >= companyRefreshBootGraceMs()) return false;
  plDbgCompanyRecovery("refreshBoot:deferClear", { companyId: id, ageMs: Date.now() - mountedAtMs });
  return true;
}

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const [companyId, setCompanyIdState] = useState<string | null>(null);
  const [company, setCompanyRaw] = useState<Company | null>(null);
  /** Har setCompany call-site ka tag — minified stack se source nahi milta. */
  const setCompanyFrom = useCallback((source: string, action: React.SetStateAction<Company | null>) => {
    setCompanyRaw((prev) => {
      let next = typeof action === "function" ? action(prev) : action;
      if (prev === next) return prev;
      if (shouldRetainPlServerCompanyShape(prev, next)) {
        // Merge host meta (roles/permissions) — do not drop SQLite saves by returning raw prev.
        const kept = keepCompanyRefIfLedgerUnchanged(prev, next);
        logCompanyOnlinePlFlip("retain_pl_block_cloud", {
          before: prev,
          after: next,
          source,
          extra: { keptSameRef: kept === prev },
        });
        return kept;
      }
      if (
        next &&
        (next.plServerShared === true ||
          isServerGateCompany(next) ||
          shouldPreferPlServerOverCloudRow(next))
      ) {
        markStickyPlServerCompanyId(next.id);
      }
      logCompanyOnlinePlFlip("setCompany", {
        before: prev,
        after: next,
        source,
      });
      return next;
    });
  }, []);
  const setCompany = useCallback(
    (action: React.SetStateAction<Company | null>) => setCompanyFrom("untagged", action),
    [setCompanyFrom]
  );
  /** Local fiscal split save/tab change — merged `company` dubara banao. */
  const [fiscalLocalEpoch, setFiscalLocalEpoch] = useState(0);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  /** Unfiltered owned + shared — Gate page / picker detail (SuperAdmin main-app filter se alag). */
  const [allCompaniesRegistry, setAllCompaniesRegistry] = useState<Company[]>([]);
  /** setCompanyId turant list se row dhundhne ke liye — render ke saath sync ref. */
  const allCompaniesLiveRef = useRef<Company[]>([]);
  /** Gate check / recovery: UI-filter se pehle poori registry (refresh boot race). */
  const allCompaniesRegistryLiveRef = useRef<Company[]>([]);
  const allCompaniesUnfilteredLiveRef = useRef<Company[]>([]);
  /** Mount par session/local se read — refresh boot grace me isi id ko clear mat karo. */
  const bootPinnedCompanyIdRef = useRef<string>("");
  /** Refresh: stored companyId ke saath SQLite row turant hydrate — list recovery grace se pehle vouchers/parties load. */
  const bootSqliteHydrateAttemptedRef = useRef<string | null>(null);
  const [gateEpoch, setGateEpoch] = useState(0);
  /** Gate id change vs list refresh — sirf gate switch par incompatible selection clear karo. */
  const prevGateIdForSelectionRef = useRef<string>(getActiveGate().id);
  useLayoutEffect(() => {
    const onGate = () => setGateEpoch((n) => n + 1);
    window.addEventListener(PL_GATE_CHANGED_EVENT, onGate);
    return () => window.removeEventListener(PL_GATE_CHANGED_EVENT, onGate);
  }, []);
  useEffect(() => {
    const onAccessContext = () => {
      setGateEpoch((n) => n + 1);
      const cid = companyIdLiveRef.current;
      if (!cid) return;
      const registrySourceRaw =
        allCompaniesRegistryLiveRef.current.length > 0
          ? allCompaniesRegistryLiveRef.current
          : allCompaniesUnfilteredLiveRef.current;
      if (registrySourceRaw.length === 0) return;
      const registry = shouldMergePlServerSharedIntoRegistry()
        ? mergePlServerSharedCompaniesIntoRegistry(registrySourceRaw)
        : registrySourceRaw;
      const row = registry.find((c) => c.id === cid);
      if (row) {
        setCompanyFrom("plAccessContext:registryRow:keepRef", (prev) => (prev?.id === cid ? keepCompanyRefIfLedgerUnchanged(prev, row) : prev));
      }
    };
    window.addEventListener(PL_SERVER_ACCESS_CONTEXT_EVENT, onAccessContext);
    return () => window.removeEventListener(PL_SERVER_ACCESS_CONTEXT_EVENT, onAccessContext);
  }, []);
  /** Host Role Permissions bump → selected company context me permissionConfig/local users turant merge. */
  useEffect(() => {
    const onMeta = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      const eventCid = String(detail?.companyId || "").trim();
      const liveCid = String(companyIdLiveRef.current || "").trim();
      if (!eventCid && !liveCid) return;
      const loadId = liveCid || eventCid;
      // Staff: event host id, selected client slug — dono allow.
      if (liveCid && eventCid && liveCid !== eventCid) {
        const rowHint =
          allCompaniesRegistryLiveRef.current.find((c) => c.id === liveCid) ||
          allCompaniesUnfilteredLiveRef.current.find((c) => c.id === liveCid);
        const hostAlias = String(
          (rowHint as { plServerHostCompanyId?: string } | undefined)?.plServerHostCompanyId ||
            (rowHint as { authoritativeCompanyId?: string } | undefined)?.authoritativeCompanyId ||
            ""
        ).trim();
        if (eventCid !== hostAlias && liveCid !== hostAlias) return;
      }
      void (async () => {
        try {
          const row = await getLocalCompanyById(loadId, { includeDeleted: true });
          if (!row || companyIdLiveRef.current !== loadId) return;
          const patch = {
            ...(row as unknown as Company),
            id: loadId,
            name: typeof row.name === "string" ? row.name : loadId,
          } as Company;
          setCompanyFrom("plServerCompanyMeta:sqlite:keepRef", (prev) =>
            prev?.id === loadId ? keepCompanyRefIfLedgerUnchanged(prev, patch) : prev
          );
        } catch {
          /* ignore */
        }
      })();
    };
    window.addEventListener(PL_SERVER_COMPANY_META_UPDATED_EVENT, onMeta);
    return () => window.removeEventListener(PL_SERVER_COMPANY_META_UPDATED_EVENT, onMeta);
  }, [setCompanyFrom]);
  useEffect(() => {
    allCompaniesRegistryLiveRef.current = allCompaniesRegistry;
  }, [allCompaniesRegistry]);

  const allCompaniesForUi = useMemo(() => {
    allCompaniesUnfilteredLiveRef.current = allCompanies;
    const activeGate = getActiveGate();
    const registry =
      shouldMergePlServerSharedIntoRegistry() ? mergePlServerSharedCompaniesIntoRegistry(allCompanies) : allCompanies;
    const byGate = filterCompaniesForActiveGate(registry, activeGate);
    const visibleAll = registry.filter(
      (c) => c && c.isDeleted !== true && c.movedToAdminRecycleAt == null
    );
    const useGateFallback = byGate.length === 0 && visibleAll.length > 0;
    const baseForUi = useGateFallback ? visibleAll : byGate;
    allCompaniesLiveRef.current = baseForUi;
    return baseForUi;
  }, [allCompanies, gateEpoch]);
  const [loading, setLoading] = useState(true);
  /** Online mode: company doc / sharing change par listener re-subscribe (light). */
  const [registryVersion, setRegistryVersion] = useState(0);
  /** Firestore listener `already-exists` par controlled re-subscribe trigger — APK fresh boot me company list blank avoid. */
  const [companyFirestoreListenerRetryEpoch, setCompanyFirestoreListenerRetryEpoch] = useState(0);
  /** Local-only APK: heavy registry effect sirf jab list/mirror sach me badla ho — registryVersion se alag. */
  const [localRegistryEpoch, setLocalRegistryEpoch] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  /** Route change par hook deps stable rakhne ke liye — filter + ref; warna local/snapshot effect dubara + setLoading (header company chooser hide). */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  /** SuperAdmin: merge pehle; pathname sirf filter — alag effect. */
  const latestOnlineMergedUnfilteredRef = useRef<Company[]>([]);
  const latestLocalNormalizedCompaniesRef = useRef<Company[]>([]);
  const { user, customUser, loading: authLoading } = useAuth();
  const ownedSnapRef = useRef<any>(null);
  const ownedLegacySnapRef = useRef<any>(null);
  const sharedSnapRef = useRef<any>(null);
  /** Case variants: `array-contains` lowercase + legacy exact auth email. */
  const sharedSnapByVariantRef = useRef<Map<string, { docs: readonly unknown[] }>>(new Map());
  const ownedByEmailSnapRef = useRef<any>(null);
  const ownedByEmailSnapByVariantRef = useRef<Map<string, { docs: readonly unknown[] }>>(new Map());
  /** Doc-snapshot async callback stale company switch na kare — `setCompany` se pehle match karo. */
  const companyIdLiveRef = useRef<string | null>(null);
  /** Deferred Firestore registry mirror cancel — company switch / unmount pe timer clear. */
  const deferredLocalRegistryMirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `localRegistryEpoch` pehli value store — mount par mirror nahi; sirf bump par turant mirror. */
  const lastLocalRegistryEpochForMirrorRef = useRef<number | null>(null);
  /** SQLite company list ek baar hydrate ho chuka — epoch-only refresh par loading flash mat karo. */
  const sqliteRegistryListHydratedRef = useRef(false);
  /** Firestore `triggerUpdate` — `reloadLocalCompanyRegistry` par SQLite rows turant selector me. */
  const triggerRegistryUpdateRef = useRef<(() => void) | null>(null);
  /** After Pocket Ledger Server companies were pruned from this device (server no longer lists them). */
  const pbPrunedHandlerRef = useRef<((activePruned: boolean) => void) | null>(null);
  const isSuperAdmin = customUser?.role === "SuperAdmin";
  const isSuperAdminByEmail = useMemo(() => {
    const e = (user?.email || "").toLowerCase().trim();
    if (!e) return false;
    return getSuperAdminEmails().some((x) => (x || "").toLowerCase().trim() === e);
  }, [user?.email]);
  const isSuperAdminUser = isSuperAdmin || isSuperAdminByEmail;
  /** Local + online dono: `app_settings/plans` merged entitlements (sirf static config/plans nahi). */
  const livePlans = useLivePlans();
  // Har plans-snapshot par naya object → `normalizeLocalCompany` unstable tha → deps wale effects (local registry + Firestore list) bar-bar → useVouchers listeners reset = "auto refresh" feel.
  const livePlansRef = useRef(livePlans);
  livePlansRef.current = livePlans;

  const triggerSync = useCallback(() => {
    // Offline→online: ye bump `useCompany` + `useVouchers` listeners re-bind karta — full reload nahi, lekin "refresh" jaisa.
    setRegistryVersion((v) => v + 1);
  }, []);
  const reloadLocalCompanyRegistry = useCallback(() => {
    plRegistryPullDebug("reloadLocalCompanyRegistry", "bump", () => ({ caller: plCallerFrame(5) }));
    setLocalRegistryEpoch((v) => v + 1);
  }, []);
  const scheduleCompanyFirestoreListenerRetry = useCallback((source: string) => {
    // Firestore Target-ID collision par ek hi bounded retry schedule karo; tight loop se UI churn avoid.
    if (companyListenerRetryTimerRef.current) return;
    companyListenerRetryTimerRef.current = setTimeout(() => {
      companyListenerRetryTimerRef.current = null;
      void syncEmbeddedFirestoreTransportFromNavigator();
      void ensureEmbeddedFirestoreOnlineForCloudCompanyLoad();
      setCompanyFirestoreListenerRetryEpoch((v) => v + 1);
    }, 320);
    console.warn("[useCompany] scheduling Firestore listener retry", { source });
  }, []);

  companyIdLiveRef.current = companyId;

  useEffect(() => {
    return () => {
      // Unmount par pending retry timer clean rakho taaki stale setState warning na aaye.
      if (companyListenerRetryTimerRef.current) {
        clearTimeout(companyListenerRetryTimerRef.current);
        companyListenerRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ companyId?: string }>).detail;
      if (!d?.companyId || d.companyId === companyId) setFiscalLocalEpoch((n) => n + 1);
    };
    window.addEventListener(LOCAL_FISCAL_SPLIT_CHANGED_EVENT, on as EventListener);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key?.startsWith("pl_fiscal_split_v1_")) setFiscalLocalEpoch((n) => n + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LOCAL_FISCAL_SPLIT_CHANGED_EVENT, on as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [companyId]);

  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [planSyncInFlight, setPlanSyncInFlight] = useState(false);
  const [planAuthoritativeSync, setPlanAuthoritativeSync] = useState<PlanSyncBannerState>({
    lastSuccessAtMs: null,
    isStale: false,
    needsOnlinePlanSync: false,
    offlineLicenseValidUntilMs: null,
    offlineLicenseExpired: false,
    isBrowserOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    planSyncInFlight: false,
  });
  /** Har browser par alag — notification settings save par CustomEvent se recompute */
  const [notificationPrefsEpoch, bumpNotificationPrefs] = useState(0);
  useEffect(() => {
    const onEvt = () => bumpNotificationPrefs((n) => n + 1);
    window.addEventListener(NOTIFICATION_PREFS_CHANGED_EVENT, onEvt);
    // Doosri tab me localStorage save — isi browser me effective prefs refresh
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("pl_notif_v1_")) onEvt();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NOTIFICATION_PREFS_CHANGED_EVENT, onEvt);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const effectiveNotificationSettings = useMemo(
    () => getEffectiveNotificationSettings(company, user?.uid, companyId),
    [company, companyId, user?.uid, notificationPrefsEpoch]
  );

  useEffect(() => {
    if (!companyId) {
      setPlanAuthoritativeSync({
        lastSuccessAtMs: null,
        isStale: false,
        needsOnlinePlanSync: false,
        offlineLicenseValidUntilMs: null,
        offlineLicenseExpired: false,
        isBrowserOnline,
        planSyncInFlight,
      });
      return;
    }
    setPlanAuthoritativeSync((prev) => {
      const next = recomputePlanSyncBannerState(companyId, company, {
        online: isBrowserOnline,
        planSyncInFlight,
      });
      return planSyncBannerStatesEqual(prev, next) ? prev : next;
    });
  }, [companyId, registryVersion, company, isBrowserOnline, planSyncInFlight]);

  /**
   * Company open / switch: missing Inter Co. A/c No — auto unique generate.
   * Party edit khole bina; owned company par Firestore + SQLite backfill.
   */
  useEffect(() => {
    if (!isInterCompanySystemEnabled()) return;
    if (!companyId?.trim() || !company) return;
    if (company.isOwned === false) return;
    const existingAc = readCompanyInterCompanyAcNo(company);
    if (existingAc) return;

    const cid = companyId.trim();
    let cancelled = false;
    void ensureCompanyInterCompanyAcNo(cid).then((ac) => {
      if (cancelled || !ac) return;
      reloadLocalCompanyRegistry();
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, company?.isOwned, company?.interCompanyAccountNo, reloadLocalCompanyRegistry]);

  /**
   * Company open: Company Code — shared user Firestore fetch; owner/admin generate if missing.
   */
  useEffect(() => {
    if (!isInterCompanySystemEnabled()) return;
    if (!companyId?.trim() || !company) return;
    const existingCode = readCompanyInterCompanyCode(company);
    if (existingCode) return;

    const cid = companyId.trim();
    const companyName = company.name;
    let cancelled = false;
    void resolveOrEnsureCompanyInterCompanyCode({
      companyId: cid,
      companyName,
      userUid: user?.uid,
      userEmail: user?.email,
      role: customUser?.role,
      allowEnsure: true,
    }).then((code) => {
      if (cancelled || !code) return;
      reloadLocalCompanyRegistry();
    });

    return () => {
      cancelled = true;
    };
  }, [
    companyId,
    company?.name,
    (company as { interCompanyCompanyCode?: string } | null)?.interCompanyCompanyCode,
    customUser?.role,
    user?.email,
    user?.uid,
    reloadLocalCompanyRegistry,
  ]);

  // Billing success → local SQLite plan patch ke baad list dubara load (offline company).
  // Loop guard: bump bursts 500 ms me coalesce; registry content (volatile timestamps chhod kar, deep + order-stable)
  // same ho to reload skip (max ek forced reload / 10 s). Pehle har bump = reload → writers dubara bump → ~1/s self-loop.
  useEffect(() => {
    const COALESCE_MS = 500;
    const FORCE_RELOAD_MS = 10_000;
    const VOLATILE_KEY =
      /(^updated|At$|AtMs$|UntilMs$|^last(Seen|Verified|Synced|Sync|Login|Active|Opened|Pull|Push)|heartbeat|syncedAt|Epoch$)/i;
    /** Deep, key-sorted, volatile-free JSON (arrays sorted by element JSON) - fingerprint order se independent. */
    const stableJson = (value: unknown, depth = 0): string => {
      if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
      if (depth > 6) return '"<deep>"';
      if (Array.isArray(value)) {
        return `[${value.map((v) => stableJson(v, depth + 1)).sort().join(",")}]`;
      }
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => !VOLATILE_KEY.test(k) && o[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k], depth + 1)}`).join(",")}}`;
    };
    type RowSnap = Map<string, string>; // top-level key -> stable JSON
    let timer: number | undefined;
    let disposed = false;
    let lastSnap: Map<string, RowSnap> | null = null;
    let lastReloadAt = 0;
    const snapshotRegistry = async (): Promise<Map<string, RowSnap>> => {
      const rows = await listLocalCompanies({ includeDeleted: true });
      const out = new Map<string, RowSnap>();
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const m: RowSnap = new Map();
        for (const k of Object.keys(o).sort()) {
          if (VOLATILE_KEY.test(k) || o[k] === undefined) continue;
          m.set(k, stableJson(o[k]));
        }
        out.set(String(o.id ?? ""), m);
      }
      return out;
    };
    const diffSnap = (a: Map<string, RowSnap>, b: Map<string, RowSnap>): string[] => {
      const cut = (s: string | undefined) => (s === undefined ? "<none>" : s.length > 80 ? `${s.slice(0, 80)}…` : s);
      const lines: string[] = [];
      for (const id of new Set([...a.keys(), ...b.keys()])) {
        const ra = a.get(id);
        const rb = b.get(id);
        if (!ra || !rb) {
          lines.push(`company ${id}: ${ra ? "removed" : "added"}`);
          continue;
        }
        const changed: string[] = [];
        for (const k of new Set([...ra.keys(), ...rb.keys()])) {
          if (ra.get(k) !== rb.get(k)) changed.push(`${k}: ${cut(ra.get(k))} -> ${cut(rb.get(k))}`);
        }
        if (changed.length) lines.push(`company ${id}: ${changed.slice(0, 6).join(" | ")}`);
      }
      return lines.slice(0, 5);
    };
    const flush = async () => {
      timer = undefined;
      let snap: Map<string, RowSnap> | null = null;
      try {
        snap = await snapshotRegistry();
      } catch {
        snap = null;
      }
      if (disposed) return;
      const now = Date.now();
      const diff = snap && lastSnap ? diffSnap(lastSnap, snap) : null;
      if (diff && diff.length === 0 && now - lastReloadAt < FORCE_RELOAD_MS) {
        plRegistryPullDebug("bumpEventSkip", "skip: registry unchanged", () => ({ sinceLastReloadMs: now - lastReloadAt }));
        return;
      }
      if (diff && diff.length > 0) {
        plRegistryPullDebug("bumpEventDiff", `registry changed: ${diff.join(" || ")}`);
      }
      lastSnap = snap;
      lastReloadAt = now;
      reloadLocalCompanyRegistry();
    };
    const onBump = () => {
      // Sync dispatch → is stack me emitter frames bhi hote hain (loop source pakadne ke liye).
      plRegistryPullDebug("bumpEvent", "received", () => ({ stack: plCallerStack(3, 14).join("  <-  ") }));
      if (timer != null) return;
      timer = window.setTimeout(() => void flush(), COALESCE_MS);
    };
    window.addEventListener(BUMP_LOCAL_COMPANY_REGISTRY_EVENT, onBump);
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener(BUMP_LOCAL_COMPANY_REGISTRY_EVENT, onBump);
    };
  }, [reloadLocalCompanyRegistry]);

  // Track mount time to avoid clearing companyId during initial Firestore load (static/Capacitor race)
  const mountedAtRef = useRef<number>(Date.now());
  /** SQLite recovery merge ke baad dubara full registry bump avoid — ref sirf duplicate recovery guard. */
  const listRecoverySyncForIdRef = useRef<string | null>(null);
  const hasCheckedStorageRef = useRef(false);
  /** Logout par company clear thoda defer — `auth.currentUser` verify (static WebView race). */
  const clearCompanyOnLogoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `already-exists` burst me multiple timers na banen — single retry window guard. */
  const companyListenerRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Company list `loading` false hone par recovery effect dubara chalane ke liye bump.
   * `loading` ko useEffect deps me mat rakho — Fast Refresh/HMR par deps array size badalne se React error aata hai.
   */
  const [loadingPulse, setLoadingPulse] = useState(0);
  const listRecoveryDeferPulseCountRef = useRef(0);
  const listRecoveryDeferPulseCompanyRef = useRef<string>("");
  const scheduleListRecoveryDeferPulse = useCallback((reason: string) => {
    const cid = companyIdLiveRef.current?.trim() || "";
    if (cid !== listRecoveryDeferPulseCompanyRef.current) {
      listRecoveryDeferPulseCompanyRef.current = cid;
      listRecoveryDeferPulseCountRef.current = 0;
    }
    if (listRecoveryDeferPulseCountRef.current >= LIST_RECOVERY_MAX_DEFER_PULSES) {
      plDbgCompanyRecovery("listRecovery:deferPulse:cap", { companyId: cid, reason });
      return;
    }
    listRecoveryDeferPulseCountRef.current += 1;
    window.setTimeout(() => setLoadingPulse((p) => p + 1), 400);
  }, []);
  const prevLoadingForRecoveryRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingForRecoveryRef.current && !loading) {
      setLoadingPulse((p) => p + 1);
    }
    prevLoadingForRecoveryRef.current = loading;
  }, [loading]);

  useLayoutEffect(() => {
    try {
      // Multi-tab: prefer this tab's saved company so refresh does not jump to another tab's company.
      const storedCompanyId = resolveAppCompanyIdAfterAdminPanel(readSelectedCompanyId());
      if (storedCompanyId && storedCompanyId.trim()) {
        const pinned = storedCompanyId.trim();
        bootPinnedCompanyIdRef.current = pinned;
        // Refresh boot: sirf is tab pin — global `companyId` mat likho (doosri tab ka selection overwrite na ho).
        pinBootSelectedCompanyId(pinned);
        setCompanyIdState(pinned);
        // `loading` true rehne par voucher route master prefetch `if (loading) return` — party list empty (dev refresh).
        setLoading(false);
      } else {
        setLoading(false);
      }
    } finally {
      hasCheckedStorageRef.current = true;
    }
  }, []);
  
  /** `clearCompanyId` ke turant baad auto-select same company → permission-denied loop (shared EXE user). */
  const suppressAutoSelectUntilRef = useRef(0);
  const AUTO_SELECT_AFTER_CLEAR_SUPPRESS_MS = 15_000;

  const clearCompanyId = useCallback((opts?: { force?: boolean; reason?: string }) => {
    const liveId = String(companyIdLiveRef.current || "").trim();
    if (
      !opts?.force &&
      isAdminPanelCompanyLedgerMode() &&
      isAdminPanelCompanyLocalId(liveId)
    ) {
      return;
    }
    if (
      !opts?.force &&
      liveId &&
      shouldDeferRefreshBootCompanyClear(liveId, mountedAtRef.current, bootPinnedCompanyIdRef.current)
    ) {
      plDbgCompanyRecovery("clearCompanyId:deferredRefreshBoot", { companyId: liveId });
      return;
    }
    // Shared PL-gate blink root: delta/list/reconcile clearCompanyId → auto-select → clear loop (~1s).
    // Sirf logout / gate switch / explicit user clear allow.
    const allowClearReasons = new Set(["logout", "gate_switch", "user_clear", "company_deleted"]);
    let gateType = "?";
    try {
      gateType = getActiveGate().type;
    } catch {
      /* ignore */
    }
    if (
      liveId &&
      gateType === "local_server" &&
      shouldPreferPlServerOverCloudRow({ id: liveId }) &&
      !allowClearReasons.has(String(opts?.reason || ""))
    ) {
      logCompanyOnlinePlFlip("clearCompanyId_blocked_pl_gate", {
        before: companyIdLiveRef.current
          ? ({ id: liveId, plServerShared: true, storageOption: "local" } as Company)
          : null,
        after: null,
        source: `clearCompanyId:blocked reason=${opts?.reason || "none"} force=${opts?.force === true}`,
        extra: { force: opts?.force === true, reason: opts?.reason || null },
      });
      plDbgCompanyRecovery("clearCompanyId:blockedPlGate", {
        companyId: liveId,
        force: opts?.force === true,
        reason: opts?.reason || null,
      });
      return;
    }
    const err = new Error();
    const st = typeof err.stack === "string" ? err.stack.split("\n").slice(1, 10).join(" | ") : "";
    plDbgCompanyRecovery("clearCompanyId", { stackHint: st, reason: opts?.reason || null });
    plNavDbgCritical("useCompany.clearCompanyId", { stackHint: st.slice(0, 400), reason: opts?.reason || null });
    suppressAutoSelectUntilRef.current = Date.now() + AUTO_SELECT_AFTER_CLEAR_SUPPRESS_MS;
    // Clear both tab override and global fallback when user leaves/deletes the active company.
    clearSelectedCompanyId();
    setCompanyIdState(null);
    setCompanyFrom("clearCompanyId:null", null);
    // Poori company list mat hatao — mirror/list reload par auto-select [0] flicker + rapid switch hota tha.
  }, [setCompanyFrom]);

  useEffect(() => {
    if (!companyId) return;
    if (loading) return;
    // Refresh boot: list / gate filter settle hone se pehle stored company mat clear karo.
    if (Date.now() - mountedAtRef.current < companyRefreshBootGraceMs()) return;
    const registrySourceRaw =
      allCompaniesRegistryLiveRef.current.length > 0
        ? allCompaniesRegistryLiveRef.current
        : allCompaniesUnfilteredLiveRef.current;
    if (registrySourceRaw.length === 0) return;
    const activeGate = getActiveGate();
    const registrySource = shouldMergePlServerSharedIntoRegistry()
      ? mergePlServerSharedCompaniesIntoRegistry(registrySourceRaw)
      : registrySourceRaw;
    const gateSwitched = prevGateIdForSelectionRef.current !== activeGate.id;
    prevGateIdForSelectionRef.current = activeGate.id;
    const allowedForGate = filterCompaniesForActiveGate(registrySource, activeGate);
    if (!allowedForGate.some((c) => companyRowMatchesSelectionId(c, companyId))) {
      const selectedRow =
        registrySource.find((c) => companyRowMatchesSelectionId(c, companyId)) ??
        registrySource.find((c) => c.id === companyId);
      const localSqliteHit = latestLocalNormalizedCompaniesRef.current.find((c) => c.id === companyId);
      // List/Firestore refresh: user ne Local tab se device company chuni ho to online gate par bhi mat hatao.
      if (!gateSwitched && localSqliteHit && isDeviceLocalCompany(localSqliteHit)) {
        plDbgCompanyRecovery("gateFilter:keepDeviceLocalSqliteSelection", { companyId, gateId: activeGate.id });
        return;
      }
      if (!gateSwitched && selectedRow && isDeviceLocalCompany(selectedRow) && isLocalSelectorCompanyRow(selectedRow)) {
        plDbgCompanyRecovery("gateFilter:keepDeviceLocalSelection", { companyId, gateId: activeGate.id });
        return;
      }
      if (!gateSwitched && selectedRow && isCompanyVisibleInMainApp(selectedRow)) {
        plDbgCompanyRecovery("gateFilter:keepExplicitSelection", { companyId, gateId: activeGate.id });
        return;
      }
      if (!gateSwitched && selectedRow && isServerGateCompany(selectedRow)) {
        plDbgCompanyRecovery("gateFilter:keepServerGateSelection", { companyId, gateId: activeGate.id });
        return;
      }
      if (!gateSwitched && activeGate.type === "local_server" && isCompanyAllowedOnActiveServerGate(companyId, activeGate)) {
        plDbgCompanyRecovery("gateFilter:keepServerGatePreview", { companyId, gateId: activeGate.id });
        return;
      }
      if (
        !gateSwitched &&
        activeGate.type === "local_server" &&
        shouldPreferPlServerOverCloudRow({ id: companyId, ...(selectedRow || {}) })
      ) {
        plDbgCompanyRecovery("gateFilter:keepPlPreferSticky", { companyId, gateId: activeGate.id });
        return;
      }
      if (shouldDeferRefreshBootCompanyClear(companyId, mountedAtRef.current, bootPinnedCompanyIdRef.current)) {
        return;
      }
      // Gate switch par auto-select purani (device) company na uthaye — clear ↔ select loop avoid.
      suppressAutoSelectUntilRef.current = Date.now() + AUTO_SELECT_AFTER_CLEAR_SUPPRESS_MS;
      clearCompanyId({ reason: gateSwitched ? "gate_switch" : undefined });
    }
  }, [companyId, gateEpoch, clearCompanyId, loading, allCompaniesForUi]);

  const setCompanyId = useCallback((newCompanyId: string) => {
    if (isRestoreCloudFileUploadLocked()) {
      const job = readPendingRestoreCloudPush();
      const nextId = String(newCompanyId || "").trim();
      if (job && job.companyId !== nextId) return;
    }
    // Debug: APK par save ke baad company switch race — hr set dikhao (flag ON par only).
    plNavDbg("useCompany.setCompanyId", { hint: plNavDbgIdHint(newCompanyId), len: String(newCompanyId || "").length });
    writeSelectedCompanyId(newCompanyId);
    const nextId = String(newCompanyId || "").trim();
    if (nextId) bootPinnedCompanyIdRef.current = nextId;
    // Purani company row turant hatao — warna useVouchers stale `companyRef` se galat SQLite gate / merge kare.
    const fromList =
      allCompaniesLiveRef.current.find((c) => c.id === nextId) ??
      allCompaniesRegistryLiveRef.current.find((c) => c.id === nextId) ??
      latestLocalNormalizedCompaniesRef.current.find((c) => c.id === nextId) ??
      null;
    const fromListStamped = fromList ? stampPureLocalDeviceCompanyRow(fromList) : null;
    if (fromListStamped) {
      if (
        getActiveGate().type === "local_server" ||
        fromListStamped.plServerShared === true ||
        isServerGateCompany(fromListStamped)
      ) {
        markStickyPlServerCompanyId(nextId);
      }
      setCompanyFrom("useCompany.setCompanyId:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, fromListStamped));
      setLoading(false);
    } else {
      setCompanyFrom("useCompany.setCompanyId:null", null);
      setLoading(true);
      void (async () => {
        try {
          const row = await getLocalCompanyById(nextId);
          if (!row || companyIdLiveRef.current !== nextId) return;
          const norm = stampPureLocalDeviceCompanyRow({
            ...(row as unknown as Company),
            id: row.id,
            name: typeof row.name === "string" ? row.name : row.id,
            storageOption: "local",
            syncPolicy: "offline",
            syncedFromCloud: false,
          } as Company);
          setCompanyFrom("useCompany.setCompanyId:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, norm));
          setLoading(false);
        } catch {
          if (companyIdLiveRef.current === nextId) setLoading(false);
        }
      })();
    }
    setCompanyIdState(nextId);
    if (nextId) {
      markActiveAttachmentCompanyId(nextId);
    }
    if (fromListStamped && isLocalSelectorCompanyRow(fromListStamped)) {
      markSuppressFirestorePermissionForCompany(nextId);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pl-company-switched", { detail: { companyId: nextId } }));
    }
  }, []);

  const normalizeLocalCompany = useCallback((raw: Company): Company => {
    // Local-first: planId + Firestore live plans (admin entitlements) — static DEFAULT_PLANS se align karo.
    let planId = normalizePlanIdForClient(raw.planId);
    let rawMs = (raw as unknown as { planExpiryMs?: unknown }).planExpiryMs;
    const sqliteMs = typeof rawMs === "number" && Number.isFinite(rawMs) ? rawMs : null;
    // localStorage plan cache: server sync / Stripe ke baad mirror ne Basic likh diya ho to bhi limits sahi
    let stripeSessionFromPlanCache: string | undefined;
    const cached = readCompanyPlanLocalCache(String(raw.id || ""));
    if (cached) {
      const cp = normalizePlanIdForClient(cached.planId);
      const rawUpRaw = (raw as unknown as { planUpgradedAtMs?: unknown }).planUpgradedAtMs;
      const rawUpMs =
        typeof rawUpRaw === "number" && Number.isFinite(rawUpRaw) ? rawUpRaw : 0;
      const cacheT = cached.updatedAtMs ?? 0;
      const tierFromRow = planTierIndex(planId);
      const tierFromCache = planTierIndex(cp);
      // Firestore par plan switch cache ke baad — ya server tier cache se kam — purana Pro localStorage mat lao (SuperAdmin demote / sync-plan).
      const serverSwitchNewerThanCache = rawUpMs > cacheT;
      const serverTierLowerThanCache = tierFromRow < tierFromCache;
      if (serverSwitchNewerThanCache || serverTierLowerThanCache) {
        clearCompanyPlanLocalCache(String(raw.id || ""));
      } else {
        const sqliteBasic = planId === "basic";
        const cachePaid = cp !== "basic";
        const expBetter = sqliteMs == null || cached.planExpiryMs > sqliteMs;
        if (cachePaid && sqliteBasic) {
          planId = cp;
          rawMs = cached.planExpiryMs;
          stripeSessionFromPlanCache = cached.lastStripeCheckoutSessionId;
        } else if (cachePaid && expBetter && planTierIndex(cp) > planTierIndex(planId)) {
          planId = cp;
          rawMs = cached.planExpiryMs;
          stripeSessionFromPlanCache = cached.lastStripeCheckoutSessionId;
        } else if (cachePaid && expBetter && planTierIndex(cp) === planTierIndex(planId)) {
          rawMs = cached.planExpiryMs;
          stripeSessionFromPlanCache = cached.lastStripeCheckoutSessionId;
        }
      }
    }
    const planExpiryFromMs =
      typeof rawMs === "number" && Number.isFinite(rawMs) ? Timestamp.fromMillis(rawMs) : undefined;
    const plan = getPlanFromPlans(livePlansRef.current, planId as PlanId);
    const currentUid = (user?.uid || "").trim();
    const isDriveSharedJoin =
      (raw as { driveSharedJoin?: unknown }).driveSharedJoin === true;
    const shareUser = { uid: currentUid, email: user?.email ?? null };
    const isOwnedByCurrentUser = isCurrentUserOwnerOfCompanyRow(raw, shareUser);
    const isSharedWithCurrentUser = isCurrentUserSharedOnCompanyRow(raw, shareUser);
    return overlayOwnerAccountPlanOnLocalCompany(
      {
        ...raw,
        planId,
        ...(typeof rawMs === "number" && Number.isFinite(rawMs) ? { planExpiryMs: rawMs } : {}),
        ...(planExpiryFromMs ? { planExpiry: planExpiryFromMs } : {}),
        ...(stripeSessionFromPlanCache ? { lastStripeCheckoutSessionId: stripeSessionFromPlanCache } : {}),
        // Drive-shared local join → "Shared Companies Local" (online shared jaisa owner email).
        isOwned: isDriveSharedJoin
          ? false
          : isOwnedByCurrentUser
            ? true
            : isSharedWithCurrentUser
              ? false
              : resolveCompanyIsOwnedForUser(raw, shareUser),
        allowAttachments:
          typeof raw.allowAttachments === "boolean"
            ? raw.allowAttachments
            : plan.entitlements.canAddFileImagePdf === true,
        voucherHistoryEnabled:
          typeof raw.voucherHistoryEnabled === "boolean"
            ? raw.voucherHistoryEnabled
            : plan.entitlements.voucherHistoryEnabled === true,
        voucherHistoryLimit:
          typeof raw.voucherHistoryLimit === "number"
            ? raw.voucherHistoryLimit
            : Number(plan.entitlements.voucherHistoryLimit) || 0,
        userCanUseMultiDevice:
          typeof raw.userCanUseMultiDevice === "boolean"
            ? raw.userCanUseMultiDevice
            : plan.entitlements.hasMultiDeviceSync === true,
      } as Company,
      allCompaniesLiveRef.current,
      user?.uid,
      user?.email
    );
  }, [user?.email, user?.uid]);

  const adoptNewLocalCompany = useCallback(
    (row: import("@/lib/localCompanyStore").LocalCompanyDoc) => {
      const nextId = String(row?.id || "").trim();
      if (!nextId) return;
      writeSelectedCompanyId(nextId);
      const normalized = stampPureLocalDeviceCompanyRow(
        normalizeLocalCompany({
          ...(row as unknown as Company),
          id: nextId,
          name: typeof row.name === "string" ? row.name : nextId,
          storageOption: "local",
          syncPolicy: "offline",
          syncedFromCloud: false,
        } as Company)
      );
      latestLocalNormalizedCompaniesRef.current = [
        ...latestLocalNormalizedCompaniesRef.current.filter((c) => c.id !== nextId),
        normalized,
      ];
      setAllCompaniesRegistry((prev) => {
        const rest = prev.filter((c) => c.id !== nextId);
        return [...rest, normalized];
      });
      setAllCompanies((prev) => {
        const merged = prev.some((c) => c.id === nextId)
          ? prev.map((c) => (c.id === nextId ? normalized : c))
          : [...prev, normalized];
        return filterSharedOnlyCompaniesForSuperAdminInMainApp(
          merged,
          user,
          isSuperAdminUser,
          pathnameRef.current
        );
      });
      setCompanyFrom("setCompany:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, normalized));
      setCompanyIdState(nextId);
      markActiveAttachmentCompanyId(nextId);
      markSuppressFirestorePermissionForCompany(nextId);
      setLoading(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pl-company-switched", { detail: { companyId: nextId } }));
      }
    },
    [normalizeLocalCompany, user, isSuperAdminUser]
  );

  useEffect(() => {
    if (!hasCheckedStorageRef.current) return;
    const id = String(companyId || "").trim();
    if (!id) return;

    let cancelled = false;
    void (async () => {
      try {
        const row = await getLocalCompanyById(id);
        if (cancelled || !row) return;
        const normalized = normalizeLocalCompany(row as unknown as Company);
        if (!isCompanyVisibleInMainApp(normalized)) return;

        const sqliteIsLocalLedger = shouldReadLedgerFromSqliteOnly(
          normalized as Parameters<typeof shouldReadLedgerFromSqliteOnly>[0]
        );
        const contextIsLocalLedger =
          company?.id === id &&
          shouldReadLedgerFromSqliteOnly(company as Parameters<typeof shouldReadLedgerFromSqliteOnly>[0]);
        if (!sqliteIsLocalLedger) {
          if (company?.id === id) return;
          if (bootSqliteHydrateAttemptedRef.current === id) return;
          bootSqliteHydrateAttemptedRef.current = id;
        } else if (contextIsLocalLedger) {
          return;
        }

        setCompanyFrom("setCompany:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, normalized));
        setAllCompanies((prev) => {
          const idx = prev.findIndex((c) => c.id === id);
          if (idx < 0) return [...prev, normalized];
          if (!sqliteIsLocalLedger) return prev;
          const next = [...prev];
          next[idx] = mergeOnlineCompanyWithLocalPlanOverlay(prev[idx], normalized);
          return next;
        });
        setLoading(false);
        if (isServerGateCompany(normalized)) {
          const gateId = getPlServerContextGateId();
          if (gateId) {
            const active = getActiveGate();
            if (active.id !== gateId || active.type !== "local_server") activateGate(gateId);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, company?.id, company?.storageOption, normalizeLocalCompany]);

  /** Local-only heavy path: Firestore owned/shared → SQLite mirror + stale purge; deferred / bump / cold-start ke liye. */
  type LocalRegistryMirrorMode = "deferred" | "immediate-empty" | "registry-bump";
  const performLocalRegistryFirestoreMirrorImpl = useCallback(
    async (opts: { mode: LocalRegistryMirrorMode }) => {
      // Thin staff: live Firestore listeners skip — lekin one-shot Online registry mirror
      // chalne do (warna Online tab kabhi SQLite cache / kabhi khali).
      const touchLoading = opts.mode === "immediate-empty";
      if (touchLoading) setLoading(true);
      try {
        if (shouldSkipFirestoreCompanyRegistryOnPlStaff()) {
          tracePlServerFirebaseHit("firestore_companies", {
            source: `performLocalRegistryFirestoreMirror:${opts.mode}`,
            action: "allowed_sidechannel",
          });
        }
        const mirrorEmail = resolveMirrorUserEmail(user, customUser);
        // Owned pull sirf uid se chal sakta hai; shared ke liye email baad me retry — pehle email na hone par poora mirror skip hota tha.
        const mirrorUser = user?.uid ? { uid: user.uid, email: mirrorEmail || "" } : null;

        let ownedMirrorIds = new Set<string>();
        let sharedOnlyMirrorIds = new Set<string>();
        let cloudMirrorAllowedIds: Set<string> | null = null;
        let mirroredRows: Awaited<ReturnType<typeof pullOnlineCompanyRegistryFromFirestore>>["rows"] = [];

        if (mirrorUser) {
          try {
            // Server login (pl_users): the company list comes from Pocket Ledger Server, not Firestore.
            const result = isPocketBaseSessionUser(user)
              ? await pullPocketBaseCompanyRegistry()
              : await pullOnlineCompanyRegistryFromFirestore(
                  mirrorUser,
                  resolveOwnerIdQueryCandidates(user!.uid, customUser?.userDocId)
                );
            mirroredRows = result.rows;
            ownedMirrorIds = result.ownedIds;
            sharedOnlyMirrorIds = result.sharedOnlyIds;
            cloudMirrorAllowedIds = result.cloudAllowedIds;
          } catch (e) {
            console.warn("[useCompany] pullOnlineCompanyRegistryFromFirestore failed", e);
            cloudMirrorAllowedIds = null;
          }
        }

        if (
          cloudMirrorAllowedIds !== null &&
          cloudMirrorAllowedIds.size > 0 &&
          mirrorUser
        ) {
          await purgeGhostOnlineCompanyDeltas(mirrorUser, cloudMirrorAllowedIds);
        }
        const shareUser = mirrorUser ?? {
          uid: user?.uid || "",
          email: resolveMirrorUserEmail(user, customUser) || null,
        };
        const pbLoginSession = isPocketBaseSessionUser(user);
        const stampCloudMirrorRow = (norm: Company, isOwned: boolean): Company => ({
          ...norm,
          isOwned,
          storageOption: "firebase",
          syncedFromCloud: true,
        });
        const stampPocketBaseMirrorRow = (norm: Company, isOwned: boolean): Company => ({
          ...norm,
          isOwned,
          onlineServerId: "pocketbase",
          onlineDataBackend: "pocketbase",
          syncedFromCloud: false,
        });
        /** Staff PL-share: Firestore me same id online company zinda ho to UI/SQLite pe cloud stamp mat chipkao. */
        const preferPlServerOverCloud = (row: { id?: string; plServerHostCompanyId?: string; plServerShared?: boolean } | null | undefined) =>
          shouldPreferPlServerOverCloudRow(row);

        const companyById = new Map<string, Company>();
        for (const row of mirroredRows) {
          // Staff device: PL share list me ye company hai to Firestore mirror row skip —
          // warna pehle firebase stamp → baad me local server-gate → A↔B flip.
          if (preferPlServerOverCloud({ id: row.id })) continue;
          const norm = normalizeLocalCompany({
            id: row.id,
            ...row.data,
            ...(pbLoginSession
              ? { onlineServerId: "pocketbase", onlineDataBackend: "pocketbase", syncedFromCloud: false }
              : { storageOption: "firebase", syncedFromCloud: true }),
            isOwned: row.isOwned,
          } as Company);
          if (!isCompanyVisibleInMainApp(norm)) continue;
          const isOwned = ownedMirrorIds.has(norm.id)
            ? true
            : sharedOnlyMirrorIds.has(norm.id)
              ? false
              : resolveCompanyIsOwnedForUser(norm, shareUser);
          companyById.set(
            norm.id,
            pbLoginSession ? stampPocketBaseMirrorRow(norm, isOwned) : stampCloudMirrorRow(norm, isOwned)
          );
        }

        const localCompanies = await listLocalCompanies();
        for (const c of localCompanies) {
          const norm = normalizeLocalCompany(c as unknown as Company);
          if (!isCompanyVisibleInMainApp(norm)) continue;
          if (!isLocalCompanyVisibleToAppAccount(c, user)) continue;
          if (isPocketBaseCompanyPruned(norm.id)) continue;
          if (pbLoginSession && isFirebaseCloudRowHiddenInServerSession(norm)) continue;
          if (isStrictLocalOnlyCompany(norm)) {
            companyById.set(norm.id, {
              ...norm,
              isOwned: true,
              storageOption: "local",
              syncPolicy: "offline",
              syncedFromCloud: false,
              localOnly: true,
              localPersistence: "sqlite",
              firestoreSyncDisabled: true,
              authoritativeCompanyId: "",
            } as Company);
            continue;
          }
          // Heal: pehle cloud stamp se `syncedFromCloud:true` chipak gaya ho to bhi PL-share row ko local server-gate rakho.
          if (preferPlServerOverCloud(norm)) {
            const existingCloud = companyById.get(norm.id);
            // Same Firebase id pe Online row pehle se hai to PL demote mat karo (Server/Local mix).
            if (existingCloud && isCloudLinkedCompanyStorage(existingCloud)) {
              continue;
            }
            companyById.set(norm.id, {
              ...norm,
              isOwned: false,
              storageOption: "local",
              syncPolicy: "offline",
              syncedFromCloud: false,
              plServerShared: true,
            } as Company);
            continue;
          }
          if (isStructuralSqliteOnlyLedgerCompany(norm)) {
            companyById.set(norm.id, {
              ...norm,
              isOwned: user?.uid ? resolveCompanyIsOwnedForUser(norm, shareUser) : norm.isOwned,
            });
            continue;
          }
          if (isCloudLinkedCompanyStorage(norm) && !isServerGateCompany(norm)) {
            const cloudOwned = ownedMirrorIds.has(norm.id)
              ? true
              : sharedOnlyMirrorIds.has(norm.id)
                ? false
                : resolveCompanyIsOwnedForUser(norm, shareUser);
            // Static EXE/APK: Firestore pull pehle companyById me aata hai — sirf SQLite norm mat chipkao
            // (warna web par save hui permissionConfig / sharedWith EXE par stale rehti thi).
            const fromMirror = companyById.get(norm.id);
            const mergedCloudLinked = fromMirror
              ? mergeOnlineCompanyWithLocalPlanOverlay(fromMirror, norm)
              : norm;
            companyById.set(norm.id, stampCloudMirrorRow(mergedCloudLinked, cloudOwned));
            continue;
          }
          const isOwnerLocalBackup =
            Boolean(user?.uid) &&
            resolveCompanyIsOwnedForUser(norm, shareUser) &&
            (isDeviceLocalCompany(norm) ||
              isLocalBackupRestoredCompanyRow(norm as Record<string, unknown>) ||
              isProtectedDriveLocalRegistryRow(norm as Record<string, unknown>, shareUser));
          if (isOwnerLocalBackup) {
            companyById.set(norm.id, {
              ...norm,
              isOwned: true,
              storageOption: "local",
              syncedFromCloud: false,
              syncPolicy: "offline",
            });
            continue;
          }
          const fromMirror = companyById.get(norm.id);
          if (fromMirror) {
            companyById.set(norm.id, mergeOnlineCompanyWithLocalPlanOverlay(fromMirror, norm));
            continue;
          }
          if (!user?.uid) {
            companyById.set(norm.id, norm);
            continue;
          }
          let isOwned = resolveCompanyIsOwnedForUser(norm, shareUser);
          if (ownedMirrorIds.has(norm.id)) {
            companyById.set(norm.id, stampCloudMirrorRow(norm, true));
            continue;
          }
          if (sharedOnlyMirrorIds.has(norm.id)) {
            companyById.set(norm.id, stampCloudMirrorRow(norm, false));
            continue;
          }
          const isSharedMirror =
            !isOwned &&
            isCurrentUserSharedOnCompanyRow(norm, shareUser) &&
            (norm as { syncedFromCloud?: boolean }).syncedFromCloud === true;
          if (isSharedMirror) {
            companyById.set(norm.id, stampCloudMirrorRow(norm, false));
            continue;
          }
          companyById.set(norm.id, { ...norm, isOwned });
        }

        // Never re-upsert a Pocket Ledger Server company that was just pruned (server hard-deleted it).
        const normalizedLocalCompanies = Array.from(companyById.values()).filter(
          (c) => !isPocketBaseCompanyPruned(c.id)
        );
        await Promise.all(normalizedLocalCompanies.map((c) => upsertLocalCompany(c as any)));
        latestLocalNormalizedCompaniesRef.current = normalizedLocalCompanies;

        // Web Firebase mode: live onSnapshot listeners authoritative — mirror sirf SQLite cache update kare.
        if (isLiveFirestoreCompanyRegistry(isBrowserOnline)) {
          plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:sqliteCacheOnlyWeb", {
            mode: opts.mode,
            count: normalizedLocalCompanies.length,
            idsSample: normalizedLocalCompanies.slice(0, 8).map((c) => c.id),
          });
          triggerRegistryUpdateRef.current?.();
          return;
        }

        const filteredLocals = filterSharedOnlyCompaniesForSuperAdminInMainApp(
          normalizedLocalCompanies,
          user,
          isSuperAdminUser,
          pathnameRef.current
        );
        plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:setList", {
          mode: opts.mode,
          count: filteredLocals.length,
          idsSample: filteredLocals.slice(0, 8).map((c) => c.id),
          liveCompanyId: companyIdLiveRef.current,
          ledgerShield: shouldSuppressTransientCompanyClear(),
        });
        setAllCompaniesRegistry(normalizedLocalCompanies);
        setAllCompanies(filteredLocals);
        const liveId = companyIdLiveRef.current;
        if (!liveId) {
          setCompanyFrom("performLocalRegistryFirestoreMirror:setList:null", null);
          return;
        }
        const selected = await getLocalCompanyById(liveId);
        const norm = selected ? normalizeLocalCompany(selected as unknown as Company) : null;
        if (!norm || !isCompanyVisibleInMainApp(norm)) {
          // Save/outbox: SQLite read null — pehle clear mat karo (`shouldSuppress…` me ledger shield ~26s)
          if (shouldSuppressTransientCompanyClear()) {
            plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:selectedInvisible:shieldHold", {
              liveId,
              ledgerShield: true,
            });
            return;
          }
          if (readDriveOAuthReturnGrace(liveId)) {
            plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:selectedInvisible:oauthGraceHold", {
              liveId,
            });
            return;
          }
          const gate = getActiveGate();
          if (
            gate.type === "local_server" &&
            liveId &&
            (isCompanyAllowedOnActiveServerGate(liveId, gate) || (norm && isServerGateCompany(norm)))
          ) {
            if (norm) setCompanyFrom("performLocalRegistryFirestoreMirror:selectedInvisible:oauthGraceHold:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, norm));
            plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:keepServerGate", { liveId });
            return;
          }
          if (gate.type === "local_server" && liveId && (await shouldRetainServerGateCompanySelection(liveId))) {
            plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:keepServerGateAsync", { liveId });
            return;
          }
          plDbgCompanyRecovery("performLocalRegistryFirestoreMirror:selectedInvisible:clearAndPush", {
            liveId,
            hasNormRow: Boolean(norm),
          });
          clearCompanyId();
          const p = normalizeAppPath(pathnameRef.current ?? "");
          if (!pathExemptFromAutoSelectCompanyPush(p)) {
            plNavDbgCritical("useCompany.router.push./company [performLocalRegistry]", {
              pathname: p,
              liveIdHint: String(liveId || "").slice(0, 8),
            });
            router.push("/company");
          }
          return;
        }
        setCompanyFrom("performLocalRegistryFirestoreMirror:selectedInvisible:clearAndPush:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, norm));
      } finally {
        if (touchLoading) setLoading(false);
      }
    },
    [user?.uid, user?.email, customUser?.userDocId, customUser?.email, normalizeLocalCompany, isSuperAdminUser, clearCompanyId, router, isBrowserOnline]
  );

  /**
   * Registry mirror throttle (securetoken / Firestore flood guard): ek waqt me ek hi pull;
   * pichla pull ~15 s ke andar khatam hua ho to background trigger skip. User actions (`bypassThrottle`),
   * cold-start `immediate-empty` aur email change hamesha chalte hain (in-flight ho to ek trailing run).
   * Data / sync semantics same - sirf repeat frequency limit.
   */
  const REGISTRY_MIRROR_MIN_GAP_MS = 15_000;
  const registryMirrorInFlightRef = useRef<Promise<void> | null>(null);
  const registryMirrorLastDoneAtRef = useRef(0);
  const registryMirrorLastEmailRef = useRef<string | null>(null);
  const registryMirrorTrailingRef = useRef(false);
  const registryMirrorUserInputsRef = useRef({ user, customUser });
  registryMirrorUserInputsRef.current = { user, customUser };
  const performLocalRegistryFirestoreMirror = useMemo(() => {
    const run = (opts: {
      mode: LocalRegistryMirrorMode;
      bypassThrottle?: boolean;
      source?: string;
    }): Promise<void> => {
      const inputs = registryMirrorUserInputsRef.current;
      const emailNow = resolveMirrorUserEmail(inputs.user, inputs.customUser) || "";
      const emailChanged = registryMirrorLastEmailRef.current !== emailNow;
      const bypass = !!opts.bypassThrottle || opts.mode === "immediate-empty" || emailChanged;
      const inFlight = registryMirrorInFlightRef.current;
      if (inFlight) {
        if (bypass) registryMirrorTrailingRef.current = true;
        plRegistryPullDebug("registryMirror", "skip: pull in flight", () => ({
          mode: opts.mode,
          source: opts.source,
          trailingQueued: bypass,
          caller: plCallerFrame(5),
        }));
        return inFlight;
      }
      const sinceLastMs = Date.now() - registryMirrorLastDoneAtRef.current;
      if (!bypass && sinceLastMs < REGISTRY_MIRROR_MIN_GAP_MS) {
        plRegistryPullDebug("registryMirror", "skip: recent pull", () => ({
          mode: opts.mode,
          source: opts.source,
          sinceLastMs,
          caller: plCallerFrame(5),
        }));
        return Promise.resolve();
      }
      plRegistryPullDebug("registryMirrorRun", "run", () => ({
        mode: opts.mode,
        source: opts.source,
        bypass,
        sinceLastMs,
        caller: plCallerFrame(5),
      }));
      registryMirrorLastEmailRef.current = emailNow;
      const p = (async () => {
        try {
          await performLocalRegistryFirestoreMirrorImpl({ mode: opts.mode });
        } finally {
          registryMirrorLastDoneAtRef.current = Date.now();
          registryMirrorInFlightRef.current = null;
        }
      })();
      registryMirrorInFlightRef.current = p;
      return p.then(() => {
        if (!registryMirrorTrailingRef.current) return;
        registryMirrorTrailingRef.current = false;
        return run({ mode: "registry-bump", bypassThrottle: true, source: "trailing" });
      });
    };
    return run;
  }, [performLocalRegistryFirestoreMirrorImpl]);

  useEffect(() => {
    const onMirror = () => {
      void (async () => {
        if (!isLocalServerGate(getActiveGate())) return;
        try {
          const rawLocals = await listLocalCompanies();
          const normalizedLocalCompanies = rawLocals
            .filter((c) => isLocalCompanyVisibleToAppAccount(c, user))
            .map((c) => normalizeLocalCompany(c as unknown as Company))
            .filter(isCompanyVisibleInMainApp);
          const filtered = filterSharedOnlyCompaniesForSuperAdminInMainApp(
            normalizedLocalCompanies,
            user,
            isSuperAdminUser,
            pathnameRef.current
          );
          setAllCompaniesRegistry(normalizedLocalCompanies);
          setAllCompanies(filtered);
          const liveId = companyIdLiveRef.current;
          if (!liveId) return;
          const sel = await getLocalCompanyById(liveId);
          if (!sel) return;
          if (!isLocalCompanyVisibleToAppAccount(sel, user)) {
            // Shared PL staff: SQLite row me Firebase share emails nahi hote — membership false → clear loop.
            if (
              shouldPreferPlServerOverCloudRow(sel) ||
              shouldPreferPlServerOverCloudRow({ id: liveId }) ||
              isServerGateCompany(sel as Company)
            ) {
              markStickyPlServerCompanyId(liveId);
              setCompanyFrom("plDeltaMirror:keepPlGateDespiteLocalMembership", (prev) =>
                keepCompanyRefIfLedgerUnchanged(prev, normalizeLocalCompany(sel as unknown as Company))
              );
              return;
            }
            clearCompanyId({ force: true, reason: "user_clear" });
            setCompanyFrom("plDeltaMirror:membershipFail:null", null);
            return;
          }
          setCompanyFrom("plDeltaMirror:updater", (prev) =>
            keepCompanyRefIfLedgerUnchanged(prev, normalizeLocalCompany(sel as unknown as Company))
          );
        } catch {
          /* ignore */
        }
      })();
    };
    window.addEventListener(PL_SERVER_CLIENT_DELTA_EVENT, onMirror);
    return () => window.removeEventListener(PL_SERVER_CLIENT_DELTA_EVENT, onMirror);
  }, [normalizeLocalCompany, isSuperAdminUser, user, clearCompanyId]);

  /**
   * Firestore authoritative plan → SQLite / plan cache (POST sync-plan).
   * `recordDailySuccess`: sirf calendar-day idle sync — dubara POST avoid (load kam).
   */
  const refreshAuthoritativePlan = useCallback(
    async (options?: { recordDailySuccess?: boolean }): Promise<SyncCompanyPlanResult> => {
      if (!user || !companyId?.trim() || authLoading) {
        return { ok: false, applied: false, reason: "no_context" };
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return { ok: false, applied: false, reason: "offline" };
      }

      const cid = companyId.trim();
      const rowHint =
        allCompaniesLiveRef.current.find((c) => c.id === cid) ??
        allCompaniesRegistryLiveRef.current.find((c) => c.id === cid) ??
        null;
      const tryPlServerHostPlan =
        shouldMergePlServerSharedIntoRegistry() &&
        !!rowHint &&
        (isServerGateCompany(rowHint) ||
          rowHint?.plServerShared === true ||
          !isCurrentUserOwnerOfCompanyRow(rowHint, { uid: user.uid, email: user.email ?? null }));

      setPlanSyncInFlight(true);
      try {
        if (tryPlServerHostPlan) {
          const { refreshPlServerHostPlanForLocalCompany } = await import("@/lib/plServerHostPlanSync");
          const r = await refreshPlServerHostPlanForLocalCompany(cid);
          const rowAfter = await getLocalCompanyById(cid);
          if (rowAfter && r.ok && r.applied) {
            const norm = normalizeLocalCompany(rowAfter as unknown as Company);
            setCompanyFrom("refreshAuthoritativePlan:keepRef", (prev) => (prev?.id === cid ? keepCompanyRefIfLedgerUnchanged(prev, norm) : prev));
            setAllCompanies((prev) => {
              const idx = prev.findIndex((c) => c.id === cid);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = norm;
              return next;
            });
          } else if (r.ok) {
            setGateEpoch((n) => n + 1);
          }
          if (r.ok || isHostedPlanSyncDisabled()) {
            return r;
          }
        }

        if (isHostedPlanSyncDisabled()) {
          return { ok: true, applied: false, reason: "hosted_plan_sync_disabled" };
        }

        const row = await getLocalCompanyById(cid);
        const firebaseCompanyId =
          String(row?.authoritativeCompanyId || cid).trim() || cid;
        const r = await syncCompanyPlanFromServer({
          firebaseCompanyId,
          localCompanyId: cid,
          getIdToken: () => getBillingApiIdToken(user),
          firebaseUid: user.uid,
          ownedCompaniesHint: allCompaniesLiveRef.current,
        });
        const rowAfter = await getLocalCompanyById(cid);
        if (rowAfter && r.ok && r.applied) {
          const norm = normalizeLocalCompany(rowAfter as unknown as Company);
          setCompanyFrom("setCompany:keepRef", (prev) => (prev?.id === cid ? keepCompanyRefIfLedgerUnchanged(prev, norm) : prev));
          setAllCompanies((prev) => {
            const idx = prev.findIndex((c) => c.id === cid);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = norm;
            return next;
          });
        }
        setPlanAuthoritativeSync((prev) => {
          const next = recomputePlanSyncBannerState(cid, rowAfter as { offlineLicenseValidUntilMs?: number } | null, {
            online: typeof navigator !== "undefined" ? navigator.onLine : true,
            planSyncInFlight: false,
          });
          return planSyncBannerStatesEqual(prev, next) ? prev : next;
        });
        if (r.ok && options?.recordDailySuccess && user.uid) {
          markDailyAuthoritativePlanSyncDone(user.uid);
        }
        return r;
      } finally {
        setPlanSyncInFlight(false);
      }
    },
    [user, companyId, authLoading, normalizeLocalCompany]
  );

  /**
   * Login + selected company: online-only live plan sync; offline par timer band.
   * ⚠️ MAT HATANA — static/APK local companies: online = live sync-plan + subscribe entitlements (see planSyncClientPolicy.ts).
   */
  const planPeriodicSyncInFlightRef = useRef(false);
  const planSyncChainTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!user || !companyId || authLoading) return;
    if (isHostedPlanSyncDisabled()) return;

    let cancelled = false;

    const runDailyIdleSync = () => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (!user.uid || !shouldRunDailyAuthoritativePlanSync(user.uid)) return;
      void refreshAuthoritativePlan({ recordDailySuccess: true });
    };

    const embeddedClient = embeddedClientRequiresServerPlanSyncWhenOnline();
    const skipIdlePlanSyncBoot =
      isLocalOnlyMode() &&
      embeddedClient &&
      shouldSkipEmbeddedStartupAuthChurn(user?.uid, auth.currentUser?.uid);
    // Sirf pure web local-only skip; static/native par local SQLite ho tab bhi online plan sync chalao.
    const skipOnlinePlanSyncForLocalOnly = shouldSkipPeriodicPlanSyncForLocalOnlyMode(isLocalOnlyMode());

    const canSyncNow = () => {
      if (cancelled) return false;
      if (typeof navigator !== "undefined" && !navigator.onLine) return false;
      if (skipOnlinePlanSyncForLocalOnly) return false;
      return true;
    };

    const runOnlineSync = () => {
      if (!canSyncNow() || planPeriodicSyncInFlightRef.current) return;
      planPeriodicSyncInFlightRef.current = true;
      void refreshAuthoritativePlan().finally(() => {
        planPeriodicSyncInFlightRef.current = false;
        if (!cancelled && canSyncNow()) scheduleNextPlanSync();
      });
    };

    const clearPlanSyncChain = () => {
      if (planSyncChainTimerRef.current !== undefined && typeof window !== "undefined") {
        window.clearTimeout(planSyncChainTimerRef.current);
        planSyncChainTimerRef.current = undefined;
      }
    };

    /** Online: stale ho to ~1 min, warna 5 min — offline par chain stop */
    const scheduleNextPlanSync = () => {
      clearPlanSyncChain();
      if (!canSyncNow() || typeof window === "undefined") return;
      const last = readPlanAuthoritativeSyncTimestamp(companyId);
      const stale =
        last != null && Date.now() - last > PLAN_SYNC_STALE_AFTER_MS;
      const delay = stale ? PLAN_SERVER_SYNC_STALE_INTERVAL_MS : PLAN_SERVER_SYNC_INTERVAL_MS;
      planSyncChainTimerRef.current = window.setTimeout(() => {
        planSyncChainTimerRef.current = undefined;
        runOnlineSync();
      }, delay);
    };

    const startOnlinePlanSync = () => {
      if (!canSyncNow()) return;
      runOnlineSync();
    };

    const stopOnlinePlanSync = () => {
      clearPlanSyncChain();
    };

    let planSyncIdleCallbackId: number | undefined;
    let planSyncIdleFallbackTimerId: number | undefined;
    let deferredLazyPlanTimer: number | null = null;
    if (typeof window === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const win = window;

    const onBrowserOnline = () => {
      setIsBrowserOnline(true);
      if (skipOnlinePlanSyncForLocalOnly) return;
      startOnlinePlanSync();
    };

    const onBrowserOffline = () => {
      setIsBrowserOnline(false);
      stopOnlinePlanSync();
      setPlanSyncInFlight(false);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && canSyncNow()) runOnlineSync();
    };

    win.addEventListener("online", onBrowserOnline);
    win.addEventListener("offline", onBrowserOffline);
    document.addEventListener("visibilitychange", onVisible);

    setIsBrowserOnline(navigator.onLine);
    if (navigator.onLine && !skipOnlinePlanSyncForLocalOnly) {
      if (!skipIdlePlanSyncBoot) {
        if ("requestIdleCallback" in win && typeof win.requestIdleCallback === "function") {
          planSyncIdleCallbackId = win.requestIdleCallback(() => runDailyIdleSync(), { timeout: 2500 });
        } else {
          planSyncIdleFallbackTimerId = win.setTimeout(() => runDailyIdleSync(), 1200);
        }
      } else {
        deferredLazyPlanTimer = win.setTimeout(() => runDailyIdleSync(), 60_000);
      }
      startOnlinePlanSync();
    }

    return () => {
      cancelled = true;
      stopOnlinePlanSync();
      planPeriodicSyncInFlightRef.current = false;
      if (deferredLazyPlanTimer != null) {
        win.clearTimeout(deferredLazyPlanTimer);
        deferredLazyPlanTimer = null;
      }
      if (planSyncIdleCallbackId !== undefined && "cancelIdleCallback" in win) {
        try {
          win.cancelIdleCallback(planSyncIdleCallbackId);
        } catch {
          /* ignore */
        }
      }
      if (planSyncIdleFallbackTimerId !== undefined) {
        win.clearTimeout(planSyncIdleFallbackTimerId);
      }
      win.removeEventListener("online", onBrowserOnline);
      win.removeEventListener("offline", onBrowserOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, companyId, authLoading, refreshAuthoritativePlan]);

  /**
   * Company select (priority): turant server plan → SQLite/cache — PlServer shared pehle, list race ka wait nahi.
   * Static/native local-only: shared user ko bhi online plan sync — MAT HATANA (planSyncClientPolicy.ts).
   */
  const planSelectSyncInFlightRef = useRef(false);
  useEffect(() => {
    if (!user?.uid || !companyId?.trim() || authLoading) return;
    if (shouldSkipPeriodicPlanSyncForLocalOnlyMode(isLocalOnlyMode())) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    let cancelled = false;
    void (async () => {
      const cid = companyId.trim();
      let row =
        allCompaniesLiveRef.current.find((c) => c.id === cid) ??
        allCompaniesRegistryLiveRef.current.find((c) => c.id === cid) ??
        null;
      if (!row) {
        try {
          const fromSql = await getLocalCompanyById(cid);
          row = fromSql ? normalizeLocalCompany(fromSql as unknown as Company) : null;
        } catch {
          row = null;
        }
      }
      if (cancelled || !row || !canRunServerPlanSyncForCompanyRow(row)) return;

      const isServerShared = isServerGateCompany(row) || row.plServerShared === true;
      const isLocalPlanOnly =
        isDeviceLocalCompany(row) && !String((row.authoritativeCompanyId || "") as string).trim();
      const isSharedUser = !isCurrentUserOwnerOfCompanyRow(row, {
        uid: user.uid,
        email: user.email ?? null,
      });
      if (!isServerShared && !isSharedUser && !isLocalPlanOnly) return;

      if (!isServerShared && !isLocalPlanOnly) {
        const activeGate = getActiveGate();
        const inGateList = filterCompaniesForActiveGate(allCompaniesLiveRef.current, activeGate).some(
          (c) => c.id === cid
        );
        if (!inGateList) return;
      }

      if (planSelectSyncInFlightRef.current) return;
      planSelectSyncInFlightRef.current = true;
      planPeriodicSyncInFlightRef.current = true;
      try {
        await refreshAuthoritativePlan();
      } finally {
        planSelectSyncInFlightRef.current = false;
        planPeriodicSyncInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- burst sirf company switch par
  }, [companyId, user?.uid, authLoading, gateEpoch, refreshAuthoritativePlan, normalizeLocalCompany]);

  // Static/APK offline: SQLite + getDocs mirror. Online par web jaisa live listeners (niche wala effect).
  useEffect(() => {
    if (!isOfflineSqliteCompanyRegistry(isBrowserOnline)) return;
    // Storage clean / fresh install: auth restore hone se pehle mirror mat chalao — shared email-query fail ho jati hai.
    if (authLoading) return;
    let cancelled = false;
    let retryMirrorT1: number | undefined;
    let retryMirrorT2: number | undefined;
    let retryMirrorT3: number | undefined;
    if (deferredLocalRegistryMirrorTimerRef.current) {
      clearTimeout(deferredLocalRegistryMirrorTimerRef.current);
      deferredLocalRegistryMirrorTimerRef.current = null;
    }

    void (async () => {
      const liveCompanyId = companyIdLiveRef.current;
      const epochOnlyRefresh = sqliteRegistryListHydratedRef.current && !!liveCompanyId;
      if (liveCompanyId && !epochOnlyRefresh) setLoading(true);
      let needImmediateFullMirror = false;
      try {
        const rawLocals = await listLocalCompanies();
        if (cancelled) return;
        const normalizedLocalCompanies = rawLocals
          .filter((c) => isLocalCompanyVisibleToAppAccount(c, user))
          .map((c) => normalizeLocalCompany(c as unknown as Company))
          .filter(isCompanyVisibleInMainApp);
        latestLocalNormalizedCompaniesRef.current = normalizedLocalCompanies;
        const filteredFast = filterSharedOnlyCompaniesForSuperAdminInMainApp(
          normalizedLocalCompanies,
          user,
          isSuperAdminUser,
          pathnameRef.current
        );
        plDbgCompanyRecovery("localOnlyRegistry:SQLite:setList", {
          count: filteredFast.length,
          idsSample: filteredFast.slice(0, 8).map((c) => c.id),
          liveCompanyId: companyIdLiveRef.current,
          ledgerShield: shouldSuppressTransientCompanyClear(),
        });
        setAllCompaniesRegistry(normalizedLocalCompanies);
        setAllCompanies(filteredFast);
        sqliteRegistryListHydratedRef.current = true;

        if (!liveCompanyId) {
          setCompanyFrom("localOnlyRegistry:SQLite:setList:null", null);
          setLoading(false);
          // Cache clear: SQLite khali + uid — email late ho to bhi owned Firestore pull chale.
          needImmediateFullMirror = normalizedLocalCompanies.length === 0 && !!user?.uid;
        } else {
          const sel = await getLocalCompanyById(liveCompanyId);
          if (cancelled) return;
          if (!sel) {
            needImmediateFullMirror = true;
            setCompanyFrom("localOnlyRegistry:SQLite:setList:null", null);
          } else if (!isLocalCompanyVisibleToAppAccount(sel, user)) {
            clearCompanyId({ force: true });
            setCompanyFrom("localOnlyRegistry:SQLite:setList:null", null);
          } else {
            setCompanyFrom("localOnlyRegistry:SQLite:setList:updater", (prev) =>
              keepCompanyRefIfLedgerUnchanged(prev, normalizeLocalCompany(sel as unknown as Company))
            );
          }
          setLoading(false);
        }
      } catch {
        if (companyIdLiveRef.current) setCompanyFrom("setCompany:null", null);
        setLoading(false);
        needImmediateFullMirror = !!user?.uid;
      }

      if (cancelled) return;
      if (isLocalServerGate(getActiveGate())) return;
      const mirrorEmail = resolveMirrorUserEmail(user, customUser);
      if (!user?.uid) return;

      const runMirror = (mode: LocalRegistryMirrorMode) =>
        performLocalRegistryFirestoreMirror({ mode }).catch((e) => {
          console.warn("[useCompany] performLocalRegistryFirestoreMirror failed", { mode, error: e });
        });

      const scheduleSharedMirrorRetries = () => {
        retryMirrorT1 = window.setTimeout(() => void runMirror("registry-bump"), 3500);
        retryMirrorT2 = window.setTimeout(() => void runMirror("registry-bump"), 12000);
        // Storage clean ke baad auth/email kabhi 12s se late — ek aur pull.
        retryMirrorT3 = window.setTimeout(() => void runMirror("registry-bump"), 25_000);
      };

      if (needImmediateFullMirror) {
        void runMirror("immediate-empty");
      } else if (isEmbeddedOfflinePreloadClient() || isLocalOnlyMode()) {
        // Static/EXE/APK: owned SQLite me ho to bhi shared turant pull — web listener jaisa (UI block mat karo).
        void runMirror("deferred");
      } else {
        deferredLocalRegistryMirrorTimerRef.current = setTimeout(() => {
          deferredLocalRegistryMirrorTimerRef.current = null;
          void runMirror("deferred");
        }, embeddedStaticRegistryDeferMs());
      }

      // Email late / shared miss: dubara mirror (login ke 3s / 12s / 25s baad).
      if (!mirrorEmail || isEmbeddedOfflinePreloadClient() || isLocalOnlyMode()) {
        scheduleSharedMirrorRetries();
      }
    })();

    return () => {
      cancelled = true;
      if (retryMirrorT1 != null) window.clearTimeout(retryMirrorT1);
      if (retryMirrorT2 != null) window.clearTimeout(retryMirrorT2);
      if (retryMirrorT3 != null) window.clearTimeout(retryMirrorT3);
      if (deferredLocalRegistryMirrorTimerRef.current) {
        clearTimeout(deferredLocalRegistryMirrorTimerRef.current);
        deferredLocalRegistryMirrorTimerRef.current = null;
      }
    };
  }, [
    user?.uid,
    user?.email,
    customUser?.userDocId,
    customUser?.email,
    authLoading,
    isBrowserOnline,
    normalizeLocalCompany,
    isSuperAdminUser,
    performLocalRegistryFirestoreMirror,
    localRegistryEpoch,
    clearCompanyId,
  ]);

  // Cache clear / fresh install: SQLite khali ho to online local-only par bhi turant Firestore pull (pehle sirf offline path).
  useEffect(() => {
    if (!isLocalOnlyMode() || authLoading || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const locals = await listLocalCompanies();
        if (cancelled) return;
        const visible = locals.filter((c) => isCompanyVisibleInMainApp(c as Company));
        if (visible.length > 0) return;
        await performLocalRegistryFirestoreMirror({ mode: "immediate-empty" });
      } catch (e) {
        console.warn("[useCompany] cold-start empty-registry mirror failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user?.uid,
    user?.email,
    customUser?.email,
    authLoading,
    performLocalRegistryFirestoreMirror,
  ]);

  // Pehle sirf uid se owned mirror ho chuka ho — email aate hi shared companies dubara pull.
  const prevMirrorEmailRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLocalOnlyMode() || authLoading || !user?.uid) return;
    const emailNow = resolveMirrorUserEmail(user, customUser) || "";
    const prev = prevMirrorEmailRef.current;
    prevMirrorEmailRef.current = emailNow || null;
    if (!emailNow || prev) return;
    void performLocalRegistryFirestoreMirror({ mode: "registry-bump" }).catch(() => {});
  }, [user?.uid, user?.email, customUser?.email, authLoading, performLocalRegistryFirestoreMirror]);

  // `reloadLocalCompanyRegistry` bump: turant Firestore mirror (Stripe/demote) + deferred timer cancel taaki double-sync na ho.
  useEffect(() => {
    if (!isOfflineSqliteCompanyRegistry(isBrowserOnline) && !isLocalOnlyMode()) return;
    if (lastLocalRegistryEpochForMirrorRef.current === null) {
      lastLocalRegistryEpochForMirrorRef.current = localRegistryEpoch;
      return;
    }
    if (lastLocalRegistryEpochForMirrorRef.current === localRegistryEpoch) return;
    lastLocalRegistryEpochForMirrorRef.current = localRegistryEpoch;
    if (deferredLocalRegistryMirrorTimerRef.current) {
      clearTimeout(deferredLocalRegistryMirrorTimerRef.current);
      deferredLocalRegistryMirrorTimerRef.current = null;
    }
    if (isLocalServerGate(getActiveGate())) {
      void (async () => {
        try {
          const rawLocals = await listLocalCompanies();
          const normalizedLocalCompanies = rawLocals
            .map((c) => normalizeLocalCompany(c as unknown as Company))
            .filter(isCompanyVisibleInMainApp);
          const filtered = filterSharedOnlyCompaniesForSuperAdminInMainApp(
            normalizedLocalCompanies,
            user,
            isSuperAdminUser,
            pathnameRef.current
          );
          setAllCompaniesRegistry(normalizedLocalCompanies);
          setAllCompanies(filtered);
          const liveId = companyIdLiveRef.current;
          if (liveId) {
            const sel = await getLocalCompanyById(liveId);
            if (sel) {
              setCompanyFrom("setCompany:updater", (prev) =>
                keepCompanyRefIfLedgerUnchanged(prev, normalizeLocalCompany(sel as unknown as Company))
              );
            }
          }
        } catch {
          /* ignore */
        }
      })();
      return;
    }
    void performLocalRegistryFirestoreMirror({ mode: "registry-bump" }).catch(() => {});
    triggerRegistryUpdateRef.current?.();
  }, [localRegistryEpoch, performLocalRegistryFirestoreMirror, isBrowserOnline]);

  useEffect(() => {
    if (isLocalOnlyMode()) return;

    if (clearCompanyOnLogoutTimerRef.current) {
      clearTimeout(clearCompanyOnLogoutTimerRef.current);
      clearCompanyOnLogoutTimerRef.current = null;
    }
    if (authLoading) return;
    if (user) {
      if (customUser?.companyId && !companyId) {
        setCompanyId(customUser.companyId);
      }
      return;
    }
    const logoutClearDelayMs = isLocalOnlyMode() ? 2600 : 400;
    clearCompanyOnLogoutTimerRef.current = setTimeout(() => {
      clearCompanyOnLogoutTimerRef.current = null;
      try {
        if (auth.currentUser) return;
      } catch {
        /* ignore */
      }
      // Embedded shell me transient auth null aane par selected company turant clear mat karo.
      clearCompanyId({ reason: "logout" });
    }, logoutClearDelayMs);
    return () => {
      if (clearCompanyOnLogoutTimerRef.current) {
        clearTimeout(clearCompanyOnLogoutTimerRef.current);
        clearCompanyOnLogoutTimerRef.current = null;
      }
    };
  }, [user, customUser, companyId, clearCompanyId, setCompanyId, authLoading]);

  pbPrunedHandlerRef.current = (activePruned: boolean) => {
    reloadLocalCompanyRegistry();
    if (activePruned) {
      clearCompanyId({ force: true, reason: "pb_company_pruned" });
      router.push("/company");
    }
  };
  const handleSnapshotUpdate = useCallback(async (ownedSnap: any, sharedSnap: any, ownedByEmailSnap?: any, localCompanies?: Company[]) => {
    const isOwnedByUser = (c: Company) =>
      c.ownerId === user?.uid ||
      (!!c.ownerEmail && !!user?.email && c.ownerEmail.toLowerCase().trim() === user.email!.toLowerCase().trim());
    // Server snapshots se admin-hidden rows bhi drop karo so super-admin normal app me na dekhe.
    // Firestore row seedha map: planId alias (`proplus`) + entitlements normalizeLocalCompany se — shared list me pehle hi sahi tier.
    const owned = ownedSnap.docs
      .map((doc: any) => normalizeLocalCompany({ id: doc.id, ...doc.data() } as Company))
      .filter(isCompanyVisibleInMainApp);
    const shared = sharedSnap.docs
      .map((doc: any) => normalizeLocalCompany({ id: doc.id, ...doc.data() } as Company))
      .filter(isCompanyVisibleInMainApp);
    const ownedByEmail =
      ownedByEmailSnap?.docs
        ?.map((doc: any) => normalizeLocalCompany({ id: doc.id, ...doc.data() } as Company))
        .filter(isCompanyVisibleInMainApp) ?? [];

    /** Firestore doc abhi bhi query me hai lekin `isDeleted: true` — SQLite mirror purana ho to merge se dubara list me mat lao */
    const deletedOnFirestore = new Set<string>();
    for (const snap of [ownedSnap, sharedSnap, ownedByEmailSnap]) {
      snap?.docs?.forEach((doc: { id: string; data: () => Record<string, unknown> }) => {
        const d = doc.data() || {};
        if (d?.isDeleted === true || d?.movedToAdminRecycleAt != null) deletedOnFirestore.add(doc.id);
      });
    }

    const companyMap = new Map<string, Company>();
    const liveSharedIds = new Set(shared.map((c: Company) => c.id));
    const liveOwnedIds = new Set([
      ...owned.map((c: Company) => c.id),
      ...ownedByEmail.map((c: Company) => c.id),
    ]);
    const liveFirestoreIds = new Set<string>([...liveSharedIds, ...liveOwnedIds]);
    const revokedSharedMirrorIds: string[] = [];
    const preferPlServerOverCloudSnap = (row: { id?: string; plServerHostCompanyId?: string; plServerShared?: boolean } | null | undefined) =>
      shouldPreferPlServerOverCloudRow(row);

    owned.forEach((c: Company) => {
      // Staff PL-share same id — Firestore owned snap se online mat banao (owner Firebase login + staff share race).
      if (preferPlServerOverCloudSnap(c)) return;
      companyMap.set(c.id, { ...c, isOwned: true, ownerId: c.ownerId || user?.uid || '', ownerEmail: c.ownerEmail || user?.email || '' });
    });
    ownedByEmail.forEach((c: Company) => {
      if (preferPlServerOverCloudSnap(c)) return;
      const prev = companyMap.get(c.id);
      if (!prev) {
        companyMap.set(c.id, { ...c, isOwned: true });
        return;
      }
      // Email-owned company shared list me pehle isOwned:false aa sakti hai — hamesha owner mark karo
      companyMap.set(c.id, { ...prev, ...c, isOwned: true });
    });
    shared.forEach((c: Company) => {
        if (preferPlServerOverCloudSnap(c)) return;
        if (!companyMap.has(c.id)) {
            companyMap.set(c.id, {
              ...c,
              isOwned: isOwnedByUser(c) ? true : false,
            });
        }
    });

    const shareUser = { uid: user?.uid || "", email: user?.email ?? null };

    // Snapshot race: partial listener tick par shared row briefly missing ho sakti hai — lekin live revoke par stale cache mat dikhao.
    if (shareUser.uid) {
      for (const c of latestOnlineMergedUnfilteredRef.current) {
        if (companyMap.has(c.id)) continue;
        if (!isCompanyVisibleInMainApp(c)) continue;
        if (isCurrentUserOwnerOfCompanyRow(c, shareUser)) continue;
        const offlineLocal =
          String((c.storageOption || "local")).toLowerCase() === "local" &&
          (c as { syncedFromCloud?: boolean }).syncedFromCloud !== true;
        if (offlineLocal) continue;
        const sharedOnlyRow = c.isOwned === false;
        if (sharedOnlyRow && !liveSharedIds.has(c.id) && !liveOwnedIds.has(c.id)) {
          revokedSharedMirrorIds.push(c.id);
          continue;
        }
        if (sharedOnlyRow || isCurrentUserSharedOnCompanyRow(c, shareUser)) {
          companyMap.set(c.id, { ...c, isOwned: false });
        }
      }
    }

    // Merge local DB companies — live plan entitlements ke liye normalizeLocalCompany (online jaisa).
    for (const c of localCompanies || []) {
      if (!isLocalCompanyVisibleToAppAccount(c as never, user)) continue;
      // Pocket Ledger Server company removed from this device because the server no longer lists it.
      if (isPocketBaseCompanyPruned(c.id)) continue;
      const normalized = normalizeLocalCompany(c);
      const row = c as unknown as import("@/lib/localCompanyStore").LocalCompanyDoc;
      const isStrictLocalOnlyRow = isStrictLocalOnlyCompany(row as Company);
      const isPlServerRow =
        isServerGateCompany(row as Company) ||
        (row as { plServerShared?: unknown }).plServerShared === true ||
        isListedPlServerSharedCompany(row as Company);
      // Firestore recycle/delete markers PL-server / restored-local staff rows ko list se mat hatao.
      if (deletedOnFirestore.has(c.id) && !isStrictLocalOnlyRow && !isPlServerRow) continue;
      if (isStrictLocalOnlyRow) {
        companyMap.set(c.id, {
          ...normalized,
          isOwned: true,
          storageOption: "local",
          syncPolicy: "offline",
          syncedFromCloud: false,
          localOnly: true,
          localPersistence: "sqlite",
          firestoreSyncDisabled: true,
          authoritativeCompanyId: "",
        } as Company);
        continue;
      }
      // Server-gate mirrored row — Firestore doc nahi; shared-local ghost purge se mat hatao.
      // Heal corrupted `syncedFromCloud:true` too (staff flip root).
      if (isPlServerRow) {
        const existingSg = companyMap.get(c.id);
        companyMap.set(c.id, {
          ...(existingSg ?? normalized),
          ...normalized,
          plServerShared: true,
          isOwned: false,
          storageOption: "local",
          syncPolicy: "offline",
          syncedFromCloud: false,
        } as Company);
        continue;
      }
      const existing = companyMap.get(c.id);
      if (!existing) {
        const isDriveSharedJoin =
          (row as { driveSharedJoin?: unknown }).driveSharedJoin === true;
        const isPureLocalRow = isDeviceLocalCompany(row as Company);
        const isOwnerRow =
          !user?.uid ||
          isCurrentUserOwnerOfCompanyRow(row, { uid: user.uid, email: user?.email ?? null });
        const shareUserForRow = user?.uid
          ? { uid: user.uid, email: user?.email ?? null }
          : null;
        const isDriveRegistryRow = isProtectedDriveLocalRegistryRow(
          row as Record<string, unknown>,
          shareUserForRow
        );
        if (
          ((isPureLocalRow || isLocalBackupRestoredCompanyRow(row as Record<string, unknown>)) &&
            isOwnerRow) ||
          isDriveRegistryRow
        ) {
          companyMap.set(
            c.id,
            overlayOwnerAccountPlanOnLocalCompany(
              normalized,
              Array.from(companyMap.values()),
              user?.uid,
              user?.email ?? null
            )
          );
          continue;
        }
        if (
          user?.uid &&
          !isOwnerRow &&
          !isDriveSharedJoin &&
          !isDriveRegistryRow
        ) {
          const isOnlineMirrorRow =
            !isPureLocalRow ||
            (row as { syncedFromCloud?: boolean }).syncedFromCloud === true;
          if (isOnlineMirrorRow) {
            if (!liveFirestoreIds.has(c.id)) {
              revokedSharedMirrorIds.push(c.id);
              continue;
            }
            const shareUser = { uid: user.uid, email: user?.email ?? null };
            const isSharedRow = isCurrentUserSharedOnCompanyRow(normalized, shareUser);
            companyMap.set(c.id, {
              ...normalized,
              isOwned: isSharedRow ? false : isOwnedByUser(normalized),
            });
            continue;
          }
          // Shared online mirror revoke — device-local owner rows upar `isPureLocalRow && isOwnerRow` se safe.
          revokedSharedMirrorIds.push(c.id);
          continue;
        }
        companyMap.set(c.id, normalized);
      } else {
        companyMap.set(c.id, mergeOnlineCompanyWithLocalPlanOverlay(existing as Company, normalized));
      }
    }

    if (user?.uid && revokedSharedMirrorIds.length) {
      const uniqueRevoked = [...new Set(revokedSharedMirrorIds)];
      await Promise.all(
        uniqueRevoked.map((id) => removeLocalCompanyById(id, { firebaseUid: user.uid }))
      );
      reloadLocalCompanyRegistry();
    }

    const unfilteredMerged = Array.from(companyMap.values());
    latestOnlineMergedUnfilteredRef.current = unfilteredMerged;
    setAllCompaniesRegistry(unfilteredMerged);
    let mergedCompanies = filterSharedOnlyCompaniesForSuperAdminInMainApp(
      unfilteredMerged,
      user,
      isSuperAdminUser,
      pathnameRef.current
    );
    plDbgCompanyRecovery("handleSnapshotUpdate:setList", {
      mergedCount: mergedCompanies.length,
      idsSample: mergedCompanies.slice(0, 12).map((c) => c.id),
      liveCompanyId: companyIdLiveRef.current,
      selectedVisibleInMerged: (() => {
        const id = companyIdLiveRef.current;
        if (!id) return null;
        const row = mergedCompanies.find((c) => c.id === id);
        return row ? isCompanyVisibleInMainApp(row) : false;
      })(),
      ledgerShield: shouldSuppressTransientCompanyClear(),
    });
    // Sync engine: persist all online-category companies to local DB on every server snapshot update.
    // PL-server shared rows kabhi bhi yahan se firebase mat likho (staff flip).
    const onlineCompanies = mergedCompanies.filter((c) => {
      if (((c.storageOption || "firebase") as string).toLowerCase() === "local") return false;
      if ((c as { plServerShared?: unknown }).plServerShared === true) return false;
      if (isListedPlServerSharedCompany(c)) return false;
      if (isServerGateCompany(c)) return false;
      return true;
    });
    // IMPORTANT: company selector/active company ko mirror writes ka wait na karna pade.
    // Pehle UI list hydrate karo, phir SQLite mirror writes background me chalao.
    setAllCompanies(mergedCompanies);
    setLoading(false);
    void Promise.all(
      onlineCompanies.map(async (c) => {
        const existing = await getLocalCompanyById(c.id, { includeDeleted: true });
        const prevUsers = existing
          ? parseLocalCompanyUserRows((existing as { localCompanyUsers?: unknown }).localCompanyUsers)
          : [];
        const sw = Array.isArray((c as { sharedWith?: unknown }).sharedWith)
          ? ((c as { sharedWith: unknown[] }).sharedWith as any[])
          : [];
        // Same id Online + PL/local/Drive: SQLite role root is NOT Firebase sharedWith.
        const excludeFirebaseRoles =
          !!existing && companyRolesAuthorityExcludesFirebase(existing as Company);
        const mergedLocalUsers = excludeFirebaseRoles
          ? prevUsers
          : mergeSharedWithIntoLocalCompanyUsers(prevUsers, sw);
        // Device-local / Drive-sync / PL-server row — Firestore mirror se storageOption mat overwrite karo.
        if (
          existing &&
          (excludeFirebaseRoles ||
            isStructuralSqliteOnlyLedgerCompany(existing as Company) ||
            (existing as { plServerShared?: unknown }).plServerShared === true ||
            isListedPlServerSharedCompany(existing as Company))
        ) {
          await upsertLocalCompany({
            ...existing,
            ...(isListedPlServerSharedCompany(existing as Company) ||
            (existing as { plServerShared?: unknown }).plServerShared === true
              ? {
                  storageOption: "local",
                  syncPolicy: "offline",
                  syncedFromCloud: false,
                  plServerShared: true,
                }
              : {}),
            // Keep device/PL/Drive roles — do not stamp Firebase sharedWith.role
            localCompanyUsers:
              (existing as { localCompanyUsers?: unknown }).localCompanyUsers ?? mergedLocalUsers,
          } as import("@/lib/localCompanyStore").LocalCompanyDoc);
          return;
        }
        if (isPocketBaseCompanyId(c.id) || companyUsesPocketBase(c)) {
          await upsertLocalCompany({
            ...(c as any),
            onlineServerId: "pocketbase",
            onlineDataBackend: "pocketbase",
            syncedFromCloud: false,
            localCompanyUsers: mergedLocalUsers,
          } as any);
          return;
        }
        await upsertLocalCompany({
          ...(c as any),
          storageOption: "firebase",
          syncPolicy: "online",
          syncedFromCloud: true,
          localCompanyUsers: mergedLocalUsers,
        } as any);
      })
    ).catch((error) => {
      // Background mirror failure se foreground company load block nahi karna.
      console.warn("Background company mirror sync failed:", error);
    });
  }, [user?.uid, user?.email, normalizeLocalCompany, isSuperAdminUser, reloadLocalCompanyRegistry]);

  useEffect(() => {
    // Static/APK offline: SQLite registry (upar wala effect). Online + web: live Firestore onSnapshot.
    if (!isLiveFirestoreCompanyRegistry(isBrowserOnline)) {
      return;
    }
    // PL thin staff / remote client: live `companies` onSnapshot mat chalao.
    // Online tab ke liye one-shot SQLite+Firestore mirror (listeners nahi).
    if (shouldSkipFirestoreCompanyRegistryOnPlStaff()) {
      tracePlServerFirebaseHit("firestore_companies", {
        source: "useCompany.liveCompanyRegistry",
        action: "blocked",
      });
      let cancelled = false;
      void performLocalRegistryFirestoreMirror({ mode: "registry-bump" })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (authLoading) return;
    if (!user?.uid) {
      setAllCompanies([]);
      setAllCompaniesRegistry([]);
      if(!authLoading) setLoading(false);
      ownedSnapRef.current = null;
      ownedLegacySnapRef.current = null;
      sharedSnapRef.current = null;
      return;
    };

    if (isPocketBaseSessionUser(user)) {
      // Server login (pl_users, no Firebase session): company list from Pocket Ledger Server
      // (pl_companies the user owns or is a member of). No Firestore listeners.
      let disposed = false;
      let inFlight = false;
      setLoading(true);
      ownedSnapRef.current = null;
      ownedLegacySnapRef.current = null;
      sharedSnapRef.current = null;
      sharedSnapByVariantRef.current.clear();
      ownedByEmailSnapRef.current = null;
      ownedByEmailSnapByVariantRef.current.clear();
      const asDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
      const triggerPbUpdate = () => {
        void (async () => {
          let localRows: Company[] = [];
          try {
            localRows = (await listLocalCompanies())
              .filter((c: any) => isCompanyVisibleInMainApp(c))
              .filter((c) => isLocalCompanyVisibleToAppAccount(c, user))
              .filter((c) => !isFirebaseCloudRowHiddenInServerSession(c))
              .map((c) => normalizeLocalCompany(c as unknown as Company));
          } catch {
            localRows = [];
          }
          if (disposed) return;
          await handleSnapshotUpdate(
            ownedSnapRef.current ?? { docs: [] },
            sharedSnapRef.current ?? { docs: [] },
            undefined,
            localRows
          );
        })();
      };
      let lastPbRegistryRefreshAt = 0;
      const refreshFromServer = async () => {
        if (inFlight || disposed) return;
        inFlight = true;
        lastPbRegistryRefreshAt = Date.now();
        try {
          const res = await pullPocketBaseCompanyRegistry();
          if (disposed) return;
          ownedSnapRef.current = { docs: res.rows.filter((r) => r.isOwned).map((r) => asDoc(r.id, r.data)) };
          sharedSnapRef.current = { docs: res.rows.filter((r) => !r.isOwned).map((r) => asDoc(r.id, r.data)) };
          // Successful, non-empty pull only: drop device copies of PB companies the server no longer has.
          if (res.presentIds.size > 0) {
            try {
              const pruned = await prunePocketBaseCompaniesMissingOnServer({
                serverIds: res.presentIds,
                user: { uid: user?.uid ?? null, email: user?.email ?? null },
                activeCompanyId: companyIdLiveRef.current,
              });
              if (pruned.prunedIds.length && !disposed) pbPrunedHandlerRef.current?.(pruned.activePruned);
            } catch (pe) {
              console.warn("[useCompany] pruning server-deleted companies failed", pe);
            }
          }
        } catch (e) {
          if (disposed) return;
          console.warn("[useCompany] Pocket Ledger Server company list failed (keeping the last list)", e);
          if (!ownedSnapRef.current && !sharedSnapRef.current) {
            // Offline / server down on first load: this device's copies of server companies.
            try {
              const rows = (await listLocalCompanies()).filter((c) => isPocketBaseCompanyId(c.id));
              const asData = (c: unknown) => ({ ...(c as Record<string, unknown>) });
              ownedSnapRef.current = { docs: rows.filter((c) => (c as { isOwned?: unknown }).isOwned !== false).map((c) => asDoc(c.id, asData(c))) };
              sharedSnapRef.current = { docs: rows.filter((c) => (c as { isOwned?: unknown }).isOwned === false).map((c) => asDoc(c.id, asData(c))) };
            } catch {
              /* empty list */
            }
          }
        } finally {
          inFlight = false;
        }
        if (!disposed) triggerPbUpdate();
      };
      const onRootUpdated = () => void refreshFromServer();
      window.addEventListener("pl-pb-company-root-updated", onRootUpdated);
      for (const name of PB_APP_SESSION_EVENTS) window.addEventListener(name, onRootUpdated);
      // Company list (pl_companies): light 10 min poll, visible tab only; also on focus / tab visible (max 1 per 60s).
      const poll = window.setInterval(() => {
        if (document.visibilityState === "visible") void refreshFromServer();
      }, 600_000);
      const onRegistryVisible = () => {
        if (document.visibilityState === "visible" && Date.now() - lastPbRegistryRefreshAt >= 60_000) void refreshFromServer();
      };
      document.addEventListener("visibilitychange", onRegistryVisible);
      window.addEventListener("focus", onRegistryVisible);
      triggerRegistryUpdateRef.current = () => void refreshFromServer();
      void refreshFromServer();
      return () => {
        disposed = true;
        window.clearInterval(poll);
        document.removeEventListener("visibilitychange", onRegistryVisible);
        window.removeEventListener("focus", onRegistryVisible);
        window.removeEventListener("pl-pb-company-root-updated", onRootUpdated);
        for (const name of PB_APP_SESSION_EVENTS) window.removeEventListener(name, onRootUpdated);
        triggerRegistryUpdateRef.current = null;
        ownedSnapRef.current = null;
        sharedSnapRef.current = null;
      };
    }

    void ensureEmbeddedFirestoreOnlineForCloudCompanyLoad();
    setLoading(true);
    // Reset refs when user changes
    ownedSnapRef.current = null;
    ownedLegacySnapRef.current = null;
    sharedSnapRef.current = null;
    sharedSnapByVariantRef.current.clear();
    ownedByEmailSnapByVariantRef.current.clear();

    const ownerIdCandidates = resolveOwnerIdQueryCandidates(user.uid, customUser?.userDocId);
    const ownedQuery = query(collection(firestore, "companies"), where("ownerId", "==", ownerIdCandidates[0] || user.uid));
    const ownedLegacyQuery =
      ownerIdCandidates.length > 1
        ? query(collection(firestore, "companies"), where("ownerId", "==", ownerIdCandidates[1]!))
        : null;
    const firestoreAuthEmail = resolveFirestoreAuthEmail(user.email);
    const sharedQuerySpecs = sharedCompanyQuerySpecs(firestoreAuthEmail);
    const ownedByEmailVariants = ownerEmailQueryVariants(firestoreAuthEmail);

    const needsOwnedByEmail = ownedByEmailVariants.length > 0;
    /** Offline / slow Firestore: dono snapshot refs null reh sakte — pehle `listLocalCompanies` se trigger bina iske company list + loading kabhi settle nahi hoti (online backup → local restore → refresh par blank). */
    const emptySnap = (): { docs: readonly unknown[] } => ({ docs: [] });
    /** Har snapshot par taaza SQLite — purana cache delete ke baad bhi company dikhata tha; recycle bin move ke baad live list */
    const triggerUpdate = () => {
      void (async () => {
        const ownedPrimary = ownedSnapRef.current ?? emptySnap();
        const ownedLegacy = ownedLegacySnapRef.current ?? emptySnap();
        const owned = {
          docs: [...ownedPrimary.docs, ...ownedLegacy.docs],
        };
        const shared = sharedSnapRef.current ?? emptySnap();
        const ownedByEmail = needsOwnedByEmail ? (ownedByEmailSnapRef.current ?? emptySnap()) : undefined;
        let localRows: Company[] = [];
        try {
          localRows = (await listLocalCompanies())
            // SQLite fallback path me bhi same guard rakho (refresh pe hidden row leak na ho).
            .filter((c: any) => isCompanyVisibleInMainApp(c))
            .filter((c) => isLocalCompanyVisibleToAppAccount(c, user))
            .map((c) => normalizeLocalCompany(c as unknown as Company));
        } catch {
          localRows = [];
        }
        await handleSnapshotUpdate(owned, shared, ownedByEmail, localRows);
      })();
    };

    const mergeOwnedByEmailSnapshots = () => {
      const byId = new Map<string, unknown>();
      for (const snap of ownedByEmailSnapByVariantRef.current.values()) {
        for (const d of snap.docs) {
          const doc = d as { id: string };
          byId.set(doc.id, d);
        }
      }
      ownedByEmailSnapRef.current = { docs: [...byId.values()] };
    };

    const markOwnedByEmailVariantFailed = (emailVariant: string) => {
      ownedByEmailSnapByVariantRef.current.set(emailVariant, emptySnap());
      mergeOwnedByEmailSnapshots();
      triggerUpdate();
    };

    const unsubOwned = onSnapshot(ownedQuery, (snap) => {
      ownedSnapRef.current = snap;
      triggerUpdate();
    }, (err: any) => {
      if (String(err?.code || "") === "already-exists") {
        // Firestore SDK watch target collision: listener chain ko clean retry do.
        scheduleCompanyFirestoreListenerRetry("owned");
      }
      if (err?.code === 'permission-denied' || err?.code === 'PERMISSION_DENIED' || String(err?.message || '').includes('permission')) {
        console.warn('[PERMISSION_DENIED TRACK] source=useCompany query=owned (companies where ownerId==uid)', { code: err?.code });
        ownedSnapRef.current = emptySnap();
        triggerUpdate();
        return;
      }
      console.error("Owned Companies listener error:", err);
    });
    
    const mergeSharedSnapshots = () => {
      const byId = new Map<string, unknown>();
      for (const snap of sharedSnapByVariantRef.current.values()) {
        for (const d of snap.docs) {
          const doc = d as { id: string };
          byId.set(doc.id, d);
        }
      }
      sharedSnapRef.current = { docs: [...byId.values()] };
    };

    const markSharedVariantFailed = (spec: ReturnType<typeof sharedCompanyQuerySpecs>[number]) => {
      const key = sharedCompanyQueryKey(spec);
      sharedSnapByVariantRef.current.set(key, emptySnap());
      mergeSharedSnapshots();
      triggerUpdate();
    };

    const unsubSharedList =
      sharedQuerySpecs.length > 0
        ? sharedQuerySpecs.map((spec) =>
            onSnapshot(
              query(
                collection(firestore, "companies"),
                where(spec.field, "array-contains", spec.value)
              ),
              (snap) => {
                sharedSnapByVariantRef.current.set(sharedCompanyQueryKey(spec), snap);
                mergeSharedSnapshots();
                triggerUpdate();
              },
              (err: any) => {
                if (String(err?.code || "") === "already-exists") {
                  scheduleCompanyFirestoreListenerRetry("shared");
                }
                if (
                  err?.code === "permission-denied" ||
                  err?.code === "PERMISSION_DENIED" ||
                  String(err?.message || "").includes("permission")
                ) {
                  console.warn(
                    "[PERMISSION_DENIED TRACK] source=useCompany query=shared (companies sharedWithEmails/Lower)",
                    { code: err?.code, field: spec.field, value: spec.value }
                  );
                } else {
                  console.warn("Shared Companies listener error:", err);
                }
                markSharedVariantFailed(spec);
              }
            )
          )
        : [];
    if (!sharedQuerySpecs.length) {
      sharedSnapRef.current = null;
      sharedSnapByVariantRef.current.clear();
    }

    const unsubOwnedLegacy = ownedLegacyQuery
      ? onSnapshot(ownedLegacyQuery, (snap) => {
          ownedLegacySnapRef.current = snap;
          triggerUpdate();
        }, (err: any) => {
          if (String(err?.code || "") === "already-exists") {
            // Firestore SDK watch target collision: listener chain ko clean retry do.
            scheduleCompanyFirestoreListenerRetry("ownedLegacy");
          }
          if (err?.code === 'permission-denied' || err?.code === 'PERMISSION_DENIED' || String(err?.message || '').includes('permission')) {
            console.warn('[PERMISSION_DENIED TRACK] source=useCompany query=ownedLegacy (companies where ownerId==legacyUserDocId)', { code: err?.code });
            ownedLegacySnapRef.current = emptySnap();
            triggerUpdate();
            return;
          }
          console.error("Owned legacy-id companies listener error:", err);
        })
      : () => {};
    if (!ownedLegacyQuery) ownedLegacySnapRef.current = null;

    const unsubOwnedByEmail =
      ownedByEmailVariants.length > 0
        ? ownedByEmailVariants.map((emailVariant) =>
            onSnapshot(
              query(collection(firestore, "companies"), where("ownerEmail", "==", emailVariant)),
              (snap) => {
                ownedByEmailSnapByVariantRef.current.set(emailVariant, snap);
                mergeOwnedByEmailSnapshots();
                triggerUpdate();
              },
              (err: any) => {
                if (String(err?.code || "") === "already-exists") {
                  scheduleCompanyFirestoreListenerRetry("ownedByEmail");
                }
                if (
                  err?.code === "permission-denied" ||
                  err?.code === "PERMISSION_DENIED" ||
                  String(err?.message || "").includes("permission")
                ) {
                  console.warn(
                    "[PERMISSION_DENIED TRACK] source=useCompany query=ownedByEmail — deploy firestore.rules (ownerEmail list)",
                    { code: err?.code, emailVariant }
                  );
                } else {
                  console.warn("Owned by email companies listener error:", err);
                }
                markOwnedByEmailVariantFailed(emailVariant);
              }
            )
          )
        : [];
    if (!ownedByEmailVariants.length) ownedByEmailSnapRef.current = null;

    triggerUpdate();
    triggerRegistryUpdateRef.current = triggerUpdate;

    return () => {
      triggerRegistryUpdateRef.current = null;
        unsubOwned();
        unsubOwnedLegacy();
        unsubSharedList.forEach((u) => u());
        unsubOwnedByEmail.forEach((u) => u());
        ownedSnapRef.current = null;
        ownedLegacySnapRef.current = null;
        sharedSnapRef.current = null;
        sharedSnapByVariantRef.current.clear();
        ownedByEmailSnapRef.current = null;
        ownedByEmailSnapByVariantRef.current.clear();
    }
}, [user?.uid, user?.email, customUser?.userDocId, authLoading, isSuperAdmin, handleSnapshotUpdate, registryVersion, companyFirestoreListenerRetryEpoch, scheduleCompanyFirestoreListenerRetry, isBrowserOnline, gateEpoch, user, normalizeLocalCompany, isSuperAdminUser, performLocalRegistryFirestoreMirror]);

  // Cloud data sync toggle: registry dubara merge — online companies Local tab me mat leak hon.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSyncToggle = () => {
      triggerRegistryUpdateRef.current?.();
      void performLocalRegistryFirestoreMirror({ mode: "registry-bump", bypassThrottle: true, source: "event:dataSyncToggle" }).catch(() => {});
    };
    const onRegistryPull = () => {
      triggerRegistryUpdateRef.current?.();
      void performLocalRegistryFirestoreMirror({ mode: "registry-bump", bypassThrottle: true, source: "event:registryPull" }).catch(() => {});
    };
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onSyncToggle);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT, onRegistryPull);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onSyncToggle);
      window.removeEventListener(FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT, onRegistryPull);
    };
  }, [performLocalRegistryFirestoreMirror]);

  /** Chuni gayi company par direct doc snapshot — sirf Firebase/cloud-backed rows; local SQLite par mat. */
  useEffect(() => {
    if (!isLiveFirestoreCompanyRegistry(isBrowserOnline)) return;
    if (!companyId?.trim() || !user?.uid) return;

    const activeRow =
      allCompaniesLiveRef.current.find((c) => c.id === companyId) ??
      allCompaniesRegistryLiveRef.current.find((c) => c.id === companyId) ??
      (company?.id === companyId ? company : null);
    // PL-gate / sticky PL share: Firestore company doc listener mat lagao — online stamp flip = header Sync/Recon blink.
    if (shouldPreferPlServerOverCloudRow(activeRow) || shouldPreferPlServerOverCloudRow({ id: companyId })) {
      return;
    }
    if (!isCloudBackedCompanyShape(activeRow)) return;

    let cancelled = false;
    const ref = doc(firestore, "companies", companyId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        void (async () => {
          if (!snap.exists()) return;
          const data = snap.data() || {};
          if (data.isDeleted === true || data.movedToAdminRecycleAt != null) return;

          const raw = { id: snap.id, ...data } as Company;
          const onlineNorm = normalizeLocalCompany(raw);
          let merged: Company = onlineNorm;
          try {
            const localRow = await getLocalCompanyById(companyId);
            if (localRow && !cancelled) {
              merged = mergeOnlineCompanyWithLocalPlanOverlay(
                onlineNorm,
                normalizeLocalCompany(localRow as unknown as Company)
              );
            }
          } catch {
            merged = onlineNorm;
          }
          if (cancelled || merged.id !== companyIdLiveRef.current) return;

          setCompanyFrom("activeCompanyDoc:firestoreSnap:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, merged));
          plDbgCompanyRecovery("activeCompanyDoc:listRowMerge", {
            companyId: merged.id,
            isDeleted: merged.isDeleted === true,
            movedToRecycle: merged.movedToAdminRecycleAt != null,
          });
          setAllCompanies((prev) => {
            const i = prev.findIndex((c) => c.id === merged.id);
            if (i < 0) return prev;
            const next = [...prev];
            next[i] = merged;
            return next;
          });
        })();
      },
      (err: unknown) => {
        const code =
          err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
        if (code === "already-exists") {
          // Active doc listener bhi same watch target collision se gir sakta hai — full company listener cycle retry.
          scheduleCompanyFirestoreListenerRetry("activeCompanyDoc");
        }
        if (code === "permission-denied" || code === "PERMISSION_DENIED") {
          console.warn("[PERMISSION_DENIED TRACK] source=useCompany doc=companies/{companyId}", { companyId });
          return;
        }
        console.error("Active company doc listener error:", err);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [companyId, user?.uid, company, normalizeLocalCompany, scheduleCompanyFirestoreListenerRetry, isBrowserOnline]);

  // Har "online" SQLite row ke liye Firestore root verify — static/APK: mirror ke baad (shared SQLite abhi khali na ho).
  useEffect(() => {
    if (!user?.uid || authLoading) return;
    if (isLocalOnlyMode()) return;
    let cancelled = false;
    const selectedAtStart = companyId;
    (async () => {
      const result = await reconcileOnlineMirrorsWithServer({
        uid: user.uid,
        email: user.email ?? null,
      });
      if (cancelled) return;
      if (selectedAtStart && result.removedIds.includes(selectedAtStart)) {
        if (
          shouldPreferPlServerOverCloudRow({ id: selectedAtStart }) ||
          shouldSuppressTransientCompanyClear() ||
          readLocalBackupRestoreSelectionGrace(selectedAtStart) ||
          readDriveRestoreSelectionGrace(selectedAtStart)
        ) {
          plDbgCompanyRecovery("reconcileOnline:selectedRemoved:shieldHold", { selectedAtStart });
          plNavDbg("useCompany.reconcileOnline:shieldHold skip clear", { selectedAtStart });
          return;
        }
        plDbgCompanyRecovery("reconcileOnline:selectedRemoved:clear+pushCompany", { selectedAtStart });
        plNavDbgCritical("useCompany.router.push./company [reconcileOnlineMirrors]", { selectedAtStart });
        clearCompanyId({ reason: "company_deleted" });
        router.push("/company");
      }
      if (result.changed) reloadLocalCompanyRegistry();
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.email, authLoading, companyId, clearCompanyId, router, reloadLocalCompanyRegistry, registryVersion]);

  useEffect(() => {
    if (!companyId) {
      setCompanyFrom("companyIdNull:clearRow", null);
      listRecoverySyncForIdRef.current = null;
      listRecoveryDeferPulseCountRef.current = 0;
      listRecoveryDeferPulseCompanyRef.current = "";
      return;
    }

    const companyFromList =
      allCompaniesForUi.find((c) => companyRowMatchesSelectionId(c, companyId)) ??
      allCompaniesRegistry.find((c) => companyRowMatchesSelectionId(c, companyId));
    plDbgCompanyRecovery("listRecovery:tick", {
      companyId,
      listLen: allCompaniesForUi.length,
      inList: Boolean(companyFromList),
      listRowMainVisible: companyFromList ? isCompanyVisibleInMainApp(companyFromList) : null,
      loading,
      ledgerShield: shouldSuppressTransientCompanyClear(),
    });
    if (companyFromList && isCompanyVisibleInMainApp(companyFromList)) {
      setCompanyFrom("listRecovery:tick:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, companyFromList));
      setLoading(false);
      listRecoverySyncForIdRef.current = null;
      listRecoveryDeferPulseCountRef.current = 0;
      return;
    }
    if (companyFromList && !isCompanyVisibleInMainApp(companyFromList)) {
      // Safety: hidden/deleted company stale list me ho to selection turant clear karo (mobile + desktop same behavior).
      // APK/static: voucher save ke baad list merge pe `isCompanyVisibleInMainApp` ek beat ke liye false ho sakta hai — shield window me clear mat karo (niche SQLite path jaisa).
      if (shouldSuppressTransientCompanyClear()) {
        plDbgCompanyRecovery("listRecovery:listRowNotMainVisible:deferPulse", { companyId });
        scheduleListRecoveryDeferPulse("listRowNotMainVisible");
        return;
      }
      if (shouldDeferRefreshBootCompanyClear(companyId, mountedAtRef.current, bootPinnedCompanyIdRef.current)) {
        scheduleListRecoveryDeferPulse("listRowNotMainVisible:refreshBoot");
        return;
      }
      plDbgCompanyRecovery("listRecovery:listRowNotMainVisible:clear", { companyId });
      setCompanyFrom("listRecovery:listRowNotMainVisible:clear:null", null);
      listRecoverySyncForIdRef.current = null;
      clearCompanyId();
      return;
    }

    // Pehle `allCompanies.length === 0` guard tha — SQLite recovery kabhi fire nahi hoti thi jab list empty/loading.
    // List settle: `loading` ref se (deps me `loading` nahi — HMR stable); `loadingPulse` se false transition par re-run.
    if (loading) return;

    // Online shared: khali list par bhi grace (sidebar nav)
    let graceMs = allCompaniesForUi.length === 0 ? 0 : 2000;
    if (user?.uid) {
      graceMs = allCompaniesForUi.length === 0 ? LIST_RECOVERY_ONLINE_EMPTY_GRACE_MS : LIST_RECOVERY_ONLINE_NONEMPTY_GRACE_MS;
    }
    if (isElectronDesktopApp() || isStaticAppBuild() || isCapacitorNativeApp()) {
      graceMs = Math.max(graceMs, companyRefreshBootGraceMs());
    }
    if (Date.now() - mountedAtRef.current < graceMs) return;

    let cancelled = false;
    void (async () => {
      // Approve/outbox / heavy writes: SQLite "busy" throw kar sakta hai — pehle wala catch+clear galat /company redirect karta tha APK par.
      let localRow: Awaited<ReturnType<typeof getLocalCompanyById>> | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 120 * attempt));
          localRow = await getLocalCompanyById(companyId);
          break;
        } catch {
          localRow = null;
          if (attempt === 2) {
            plDbgCompanyRecovery("listRecovery:getLocalBusy:skipClear", { companyId });
            console.warn(
              "[useCompany] getLocalCompanyById failed after retries (likely DB busy); skip clearCompanyId to avoid wrong /company redirect."
            );
            return;
          }
        }
      }
      if (cancelled) return;
      if (localRow) {
        const normalized = normalizeLocalCompany(localRow as unknown as Company);
        if (!isCompanyVisibleInMainApp(normalized)) {
          // SQLite recovery path: admin-hidden/deleted row ko list me dobara merge mat karo.
          if (shouldSuppressTransientCompanyClear()) {
            plDbgCompanyRecovery("listRecovery:sqliteNotMainVisible:deferPulse", { companyId });
            scheduleListRecoveryDeferPulse("sqliteNotMainVisible");
            return;
          }
          plDbgCompanyRecovery("listRecovery:sqliteNotMainVisible:clear", { companyId });
          setCompanyFrom("listRecovery:sqliteNotMainVisible:clear:null", null);
          listRecoverySyncForIdRef.current = null;
          clearCompanyId();
          return;
        }
        plDbgCompanyRecovery("listRecovery:sqliteMergeIntoList", { companyId });
        setCompanyFrom("listRecovery:sqliteMergeIntoList:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, normalized));
        setLoading(false);
        setAllCompanies((prev) => {
          if (prev.some((c) => c.id === companyId)) return prev;
          return [...prev, normalized];
        });
        // SQLite se row merge ho chuka — listener/ registry reload se poora UI mat hilaao.
        listRecoverySyncForIdRef.current = companyId;
        return;
      }
      // Shared user: SQLite mirror baad me — Firestore doc se recover + upsert (sidebar /company clear kam)
      if (!localRow && user?.uid && !isPbOnlySession()) {
        try {
          const snap = await getDoc(doc(firestore, "companies", companyId));
          if (snap.exists()) {
            const data = snap.data() || {};
            if (data.isDeleted !== true && data.movedToAdminRecycleAt == null) {
              const raw = { id: snap.id, ...data } as Company;
              const normalized = normalizeLocalCompany(raw);
              if (isCompanyVisibleInMainApp(normalized)) {
                plDbgCompanyRecovery("listRecovery:firestoreFallbackMerge", { companyId });
                setCompanyFrom("listRecovery:firestoreFallbackMerge:keepRef", (prev) => keepCompanyRefIfLedgerUnchanged(prev, normalized));
                setLoading(false);
                setAllCompanies((prev) => {
                  if (prev.some((c) => c.id === companyId)) return prev;
                  return [...prev, normalized];
                });
                listRecoverySyncForIdRef.current = companyId;
                void upsertLocalCompany(
                  normalized as unknown as import("@/lib/localCompanyStore").LocalCompanyDoc
                ).catch(() => undefined);
                return;
              }
            }
          }
        } catch {
          plDbgCompanyRecovery("listRecovery:firestoreFallbackDeniedOrErr", { companyId });
        }
      }
      console.log("Company not found in user's list, clearing local state.");
      const gate = getActiveGate();
      if (gate.type === "local_server" && isCompanyAllowedOnActiveServerGate(companyId, gate)) {
        plDbgCompanyRecovery("listRecovery:keepServerGatePreview", { companyId });
        return;
      }
      if (gate.type === "local_server" && (await shouldRetainServerGateCompanySelection(companyId))) {
        plDbgCompanyRecovery("listRecovery:keepServerGateAsync", { companyId });
        return;
      }
      if (shouldSuppressTransientCompanyClear()) {
        plDbgCompanyRecovery("listRecovery:notInSqlite:deferPulse", { companyId });
        scheduleListRecoveryDeferPulse("notInSqlite");
        return;
      }
      if (readLocalBackupRestoreSelectionGrace(companyId)) {
        plDbgCompanyRecovery("listRecovery:notInSqlite:restoreGraceDefer", { companyId });
        setTimeout(() => setLoadingPulse((p) => p + 1), 600);
        return;
      }
      if (readDriveOAuthReturnGrace(companyId)) {
        plDbgCompanyRecovery("listRecovery:notInSqlite:oauthGraceDefer", { companyId });
        setTimeout(() => setLoadingPulse((p) => p + 1), 600);
        return;
      }
      plDbgCompanyRecovery("listRecovery:notInSqlite:clear", { companyId });
      clearCompanyId();
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, allCompaniesForUi, allCompaniesRegistry, loadingPulse, clearCompanyId, normalizeLocalCompany, user?.uid, scheduleListRecoveryDeferPulse]);

  /** Refresh boot: companyId storage se aa gaya lekin row abhi null — list/registry aate hi turant hydrate (shared user masters). */
  useEffect(() => {
    if (!hasCheckedStorageRef.current) return;
    const id = String(companyId || "").trim();
    if (!id || company?.id === id) return;

    const fromList =
      allCompaniesForUi.find((c) => companyRowMatchesSelectionId(c, id)) ??
      allCompaniesRegistry.find((c) => companyRowMatchesSelectionId(c, id)) ??
      allCompaniesLiveRef.current.find((c) => companyRowMatchesSelectionId(c, id)) ??
      allCompaniesRegistryLiveRef.current.find((c) => companyRowMatchesSelectionId(c, id)) ??
      null;
    if (!fromList || !isCompanyVisibleInMainApp(fromList)) return;

    setCompanyFrom("bootPinned:listHydrate:keepRef", (prev) =>
      keepCompanyRefIfLedgerUnchanged(prev, fromList)
    );
    setLoading(false);
  }, [companyId, company?.id, allCompaniesForUi, allCompaniesRegistry, setCompanyFrom]);

  useEffect(() => {
    if (companyId) return;
    if (loading || authLoading) return;
    if (!user) return;
    try {
      const persisted = resolveAppCompanyIdAfterAdminPanel(readSelectedCompanyId())?.trim();
      if (persisted) {
        if (readDriveOAuthReturnGrace(persisted)) {
          setCompanyId(persisted);
          plNavDbg("useCompany.autoSelect:oauthGraceHydrate", { hint: plNavDbgIdHint(persisted) });
          return;
        }
        setCompanyId(persisted);
        plNavDbg("useCompany.autoSelect:hydratePersisted", { hint: plNavDbgIdHint(persisted) });
        return;
      }
    } catch {
      /* ignore */
    }
    const gateScoped = allCompaniesLiveRef.current;
    if (!gateScoped || gateScoped.length === 0) return;
    if (Date.now() < suppressAutoSelectUntilRef.current) return;
    const livePath = normalizeAppPath(getBrowserPathname());
    if (pathExemptFromAutoSelectCompanyPush(livePath)) return;
    const pick = pickGateAwareAutoSelectCompanyId(gateScoped, getActiveGate());
    if (!pick) return;
    setCompanyId(pick);
    plNavDbg("useCompany.autoSelectFirstCompany (companyId was null)", {
      firstHint: plNavDbgIdHint(pick),
      listLen: gateScoped.length,
    });
  }, [companyId, allCompaniesForUi, gateEpoch, setCompanyId, user, loading, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    // Wait for initial localStorage read before any redirect (static/Capacitor race)
    if (!hasCheckedStorageRef.current) return;

    const pathTrim = normalizeAppPath(pathname ?? "");
    const winPath = normalizeAppPath(getBrowserPathname());

    // pathname stale + companyId brief null → timer le /company (static build Settings)
    if (shouldSkipMissingCompanyRedirect(pathTrim, winPath)) {
        return;
    }

    // Firestore companies list abhi load: companyId baad me list se / localStorage se set ho sakta — /company jaldi mat kholo.
    if (user && loading && !companyId) {
      return;
    }

    if (!companyId && user) {
        queueMicrotask(() => {
          // Fast SQLite/local writes: persisted company id turant hai, React `companyId` ek frame baad hydrate — stale null avoid
          try {
            if (companyIdLiveRef.current) return;
            const redo = resolveAppCompanyIdAfterAdminPanel(readSelectedCompanyId())?.trim();
            if (redo) {
              setCompanyIdState(redo);
              plNavDbg("useCompany.persistedHydrate.microtask", { hint: plNavDbgIdHint(redo) });
            }
          } catch {
            /* ignore */
          }
        });

        try {
            // Refresh recovery must use per-tab company first, otherwise another tab's last selection wins.
            const storedCompanyId = resolveAppCompanyIdAfterAdminPanel(readSelectedCompanyId());
            const stored = storedCompanyId?.trim();
            const bootPinned = bootPinnedCompanyIdRef.current?.trim();
            if (!stored && bootPinned) {
              plNavDbg("useCompany.redirectHydrate:bootPinnedRef", { hint: plNavDbgIdHint(bootPinned) });
              setCompanyId(bootPinned);
              return;
            }
            if (!stored) {
                // Static/Capacitor/EXE: IndexedDB + Firestore slow — localStorage/sync ke liye zyada grace
                const bootGraceRemaining = Math.max(
                  0,
                  companyRefreshBootGraceMs() - (Date.now() - mountedAtRef.current)
                );
                const REDIRECT_DELAY_MS = Math.max(1400, bootGraceRemaining + 250);
                plNavDbg("useCompany.scheduleMissingCompanyRedirect", {
                  pathname: winPath,
                  delayMs: REDIRECT_DELAY_MS,
                  shieldActive: shouldSuppressTransientCompanyClear(),
                  bootGraceRemaining,
                });
                const id = setTimeout(() => {
                    const again = readSelectedCompanyId()?.trim() || bootPinnedCompanyIdRef.current?.trim();
                    if (again) {
                        plNavDbg("useCompany.redirectTimer:storedReappeared", { hint: plNavDbgIdHint(again) });
                        setCompanyId(again);
                        return;
                    }
                    const live = normalizeAppPath(getBrowserPathname());
                    if (shouldSkipMissingCompanyRedirect(live, live)) return;
                    if (Date.now() - mountedAtRef.current < companyRefreshBootGraceMs()) {
                      plDbgCompanyRecovery("redirectNoStoredCompany:refreshBootGraceHold", {});
                      plNavDbg("useCompany.router.push./company TIMER BLOCKED refreshBootGrace", { live });
                      return;
                    }
                    // Persisted-pin delay vs React hydrate (APK/EXE turant-SQLite path)
                    if (shouldDeferMissingCompanyRedirectNative(companyIdLiveRef.current)) {
                      plDbgCompanyRecovery("redirectNoStoredCompany:nativeHydrationDeferHold", {});
                      plNavDbg("useCompany.router.push./company TIMER BLOCKED hydrationDefer", { live });
                      return;
                    }
                    // APK save / ledger shield: storage flush + ~26s race me `/company` mat kholo.
                    if (shouldSuppressTransientCompanyClear()) {
                      plDbgCompanyRecovery("redirectNoStoredCompany:shieldHold", {});
                      plNavDbg("useCompany.router.push./company TIMER BLOCKED shield", { live });
                      return;
                    }
                    plDbgCompanyRecovery("redirectNoStoredCompany:push.company", { live });
                    plNavDbgCritical("useCompany.router.push./company [missingCompanyId delayed]", {
                      live,
                      delayMs: REDIRECT_DELAY_MS,
                    });
                    router.push("/company");
                }, REDIRECT_DELAY_MS);
                return () => clearTimeout(id);
            } else {
                setCompanyId(stored);
            }
        } catch (_) {
            const live = normalizeAppPath(getBrowserPathname());
            if (!shouldSkipMissingCompanyRedirect(pathTrim, live)) {
                // Fast local hydrate: React null, storage me id — transient push mat karo
                if (shouldDeferMissingCompanyRedirectNative(companyId)) {
                  plDbgCompanyRecovery("redirectNoStoredCompany:catch:nativeHydrationDefer", {});
                  return;
                }
                // Fallback catch path me bhi guard respect karo taaki transient read-error se save ke turant baad `/company` na khule.
                if (shouldSuppressTransientCompanyClear()) {
                  plDbgCompanyRecovery("redirectNoStoredCompany:catch:shieldHold", {});
                  return;
                }
                plNavDbgCritical("useCompany.router.push./company [missingCompany catch path]", { live });
                router.push("/company");
            }
        }
    }
  }, [companyId, pathname, router, user, authLoading, loading, setCompanyId]);

  /** SuperAdmin: /admin vs main app — list sirf filter se update; Firestore/SQLite route pe dubara nahi. */
  useEffect(() => {
    if (!user) return;
    // Static/APK offline: mirror setAllCompanies — pathname par ref se dubara likhne se shared rows gayab ho jati thi.
    if (isOfflineSqliteCompanyRegistry(isBrowserOnline)) return;
    const raw = latestOnlineMergedUnfilteredRef.current;
    if (raw.length === 0) return;
    setAllCompaniesRegistry(raw);
    setAllCompanies(
      filterSharedOnlyCompaniesForSuperAdminInMainApp(raw, user, isSuperAdminUser, pathname)
    );
  }, [pathname, user, isSuperAdminUser, isBrowserOnline]);

  const companyWithLocalFiscal = useMemo(
    () => mergeCompanyWithLocalFiscal(company, companyId),
    [company, companyId, fiscalLocalEpoch]
  );

  useEffect(() => {
    const cid = String(companyId || company?.id || "").trim();
    if (!cid || !company) return;
    const seeded = seedLocalFiscalSplitFromCompanyDocIfNeeded(cid, company);
    if (seeded) {
      setFiscalLocalEpoch((n) => n + 1);
      return;
    }
    const local = readLocalFiscalSplit(cid) ?? getLocalFiscalSplitOrDefaults(cid);
    scheduleBackfillCloudFiscalSplitFromLocal({
      companyId: cid,
      company,
      payload: local,
      reloadLocalCompanyRegistry,
      triggerSync,
    });
  }, [companyId, company, reloadLocalCompanyRegistry, triggerSync]);

  /**
   * Server-only login: every list handed to the UI (header switcher, company page, shared-with-me) drops
   * Firebase rows - including ones restored from the SQLite / localStorage registry cache. A Firebase company
   * still selected from an older session is deselected and the picker opens.
   */
  const serverOnlyLoginScope = isServerOnlyLoginSession() || isPocketBaseSessionUser(user);
  // Normal app (non-packed): hide the server-manage company from every list; inside the server panel
  // My Company handoff show ONLY that company. Packed builds are scoped by their own consumers.
  const scopeServerManageRows = <T extends { id?: unknown; name?: unknown; interCompanyCompanyCode?: unknown }>(
    rows: T[]
  ): T[] => (isPlServerPackedApp() ? rows : filterPackedMyCompanyRows(rows));
  const allCompaniesForUiScoped = useMemo(
    () =>
      scopeServerManageRows(
        serverOnlyLoginScope
          ? allCompaniesForUi.filter((c) => !isFirebaseCloudRowHiddenInServerSession(c))
          : allCompaniesForUi
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverOnlyLoginScope, allCompaniesForUi]
  );
  const allCompaniesRegistryScoped = useMemo(
    () =>
      scopeServerManageRows(
        serverOnlyLoginScope
          ? allCompaniesRegistry.filter((c) => !isFirebaseCloudRowHiddenInServerSession(c))
          : allCompaniesRegistry
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverOnlyLoginScope, allCompaniesRegistry]
  );
  // Selected company not allowed in this scope (normal app: server-manage company; server handoff: any other).
  const serverManageScopeBlocked = (() => {
    if (isPlServerPackedApp()) return false;
    if (isServerManageOnlyScope()) {
      return !!companyWithLocalFiscal && !isPackedServerManageCompany(companyWithLocalFiscal);
    }
    return (
      isPackedServerManageCompany(companyWithLocalFiscal) ||
      (!!companyId && isPackedServerManageCompany({ id: companyId }))
    );
  })();
  const firebaseCompanyBlockedForSession =
    serverManageScopeBlocked ||
    (serverOnlyLoginScope && !!companyWithLocalFiscal && isFirebaseCloudRowHiddenInServerSession(companyWithLocalFiscal));
  const firebaseCompanyDeselectCountRef = useRef(0);
  useEffect(() => {
    if (!firebaseCompanyBlockedForSession) return;
    // Auto-select loops guard: the exposed company stays null either way.
    if (firebaseCompanyDeselectCountRef.current >= 3) return;
    firebaseCompanyDeselectCountRef.current += 1;
    try {
      clearSelectedCompanyId();
    } catch {
      /* ignore */
    }
    clearCompanyId({ force: true, reason: "user_clear" });
    const live = String(pathnameRef.current || "");
    if (!/(^|\/)company\/?$/.test(live)) router.replace("/company");
  }, [firebaseCompanyBlockedForSession, clearCompanyId, router]);

  const companyContextValue = useMemo(
    () => ({
      companyId: firebaseCompanyBlockedForSession ? null : companyId,
      company: firebaseCompanyBlockedForSession ? null : companyWithLocalFiscal,
      loading,
      triggerSync,
      reloadLocalCompanyRegistry,
      adoptNewLocalCompany,
      localCompanyRegistryEpoch: localRegistryEpoch,
      setCompanyId,
      clearCompanyId,
      allCompanies: allCompaniesForUiScoped,
      allCompaniesRegistry: allCompaniesRegistryScoped,
      planAuthoritativeSync,
      refreshAuthoritativePlan: () => refreshAuthoritativePlan(),
      effectiveNotificationSettings,
    }),
    [
      companyId,
      companyWithLocalFiscal,
      firebaseCompanyBlockedForSession,
      loading,
      triggerSync,
      reloadLocalCompanyRegistry,
      adoptNewLocalCompany,
      localRegistryEpoch,
      setCompanyId,
      clearCompanyId,
      allCompaniesForUiScoped,
      allCompaniesRegistryScoped,
      planAuthoritativeSync,
      refreshAuthoritativePlan,
      effectiveNotificationSettings,
    ]
  );

  return (
    <CompanyContext.Provider value={companyContextValue}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return context;
};
