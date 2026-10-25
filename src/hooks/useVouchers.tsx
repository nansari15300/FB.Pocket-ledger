
"use client";

import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { registerMasterAliases } from "@/lib/masterAliasIndex";
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useRef, useCallback, startTransition } from "react";
import { usePathname } from "next/navigation";
// Full collection queries: web cloud bhi pura voucher list (no orderBy/limit window).
import { collectionGroup, query, where, collection, doc } from "firebase/firestore";
import { onSnapshot, getDoc, getDocs, getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "./useCompany";
import { useAuth } from "./useAuth";
import { useFyVoucherScope } from "@/contexts/FyVoucherScopeContext";
import {
  filterVouchersToFyScope,
  mergeFyHydratedWithLiveVouchers,
} from "@/lib/fyPagination/scopeFilter";
import usePermissions from "./usePermissions";
import type { Party, Group } from "@/components/party/types";
import type { Staff, StaffGroup } from "@/components/staff/types";
import { normalizeStaffSystemGroupRow } from "@/lib/staffSystemGroups";
import { ensureStaffModuleSystemGroups } from "@/lib/staffModuleSystemGroups";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import { normalizeBankAccountRow } from "@/lib/bankAccountDisplayName";
import { coerceBankAccountIsSpecial } from "@/lib/bankAccountSpecialFlags";
import type { Tax, TaxGroup } from "@/components/tax/types";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import type { Item, ItemGroup } from "@/components/items/types";
import type { CompanyBackupCollection } from "@/lib/companyBackupCollections";
import { setMastersPrintSnapshot } from "@/lib/printMastersSnapshot";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isStaticApkLedgerTransportMode } from "@/lib/staticApkLedgerArchitecture";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import {
  FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT,
} from "@/lib/firebaseLedgerSyncMode";
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isOnlineCompanyLedgerCloudSyncAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import { shouldBindFirebaseLedgerCollectionLiveListeners } from "@/lib/firebaseLedgerSyncPolicy";
import { isLiveCollectionListenerEnabled } from "@/lib/firestoreListenerToggles";
import {
  BROWSER_DB_COLLECTION_BUMP,
  listCompanyDocsFromBrowserDb,
  listVoucherSummaryProjectionFromBrowserDb,
  mirrorCollectionDocsToBrowserDbSilent,
  notifyBrowserDbCollectionUpdated,
  upsertCompanyDocInBrowserDb,
  mirrorDocEditTimeMs,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import { listVoucherMirrorRowsIncrementally } from "@/lib/incrementalVoucherMirrorRead";
import { getLocalAuthToken, getLocalAuthUser, LOCAL_AUTH_CHANGED_EVENT } from "@/lib/localApiClient";
import {
  mergeRemoteSnapshotWithLocalOnlyDocs,
  pullCompanySubcollectionFromFirestoreToLocalDb,
} from "@/lib/firestoreToLocalCompanyPull";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { decryptFirestoreCompanyDocIfNeeded } from "@/lib/serverBackupEncryption";
import {
  PL_CLIENT_OFFLINE_FIRST_PERSIST_MS,
  stripLocalMirrorMetaForUiRow,
} from "@/lib/localMirrorServerMeta";
import {
  masterEntityProfileUiFields,
  type MasterEntityPatchCollection,
} from "@/lib/masterEntityLiveUpdate";
import {
  subscribeVoucherLivePatch,
  voucherAttachmentUiFingerprint,
} from "@/lib/voucherFormAttachmentSave";
import { subscribeMasterLivePatch } from "@/lib/masterEntityLivePatch";
import {
  activeMasterCollectionPathsForRoute,
  VOUCHER_FORM_MASTER_COLLECTION_PATHS,
} from "@/lib/ledgerActiveMasterCollections";
import { DASHBOARD_TAB_CHANGED_EVENT } from "@/lib/dashboardTabPanels";
import {
  collectionsForMobileRoutePullRefresh,
  MOBILE_ROUTE_PULL_REFRESH_EVENT,
  type MobileRoutePullRefreshDetail,
} from "@/lib/mobileRoutePullRefresh";
import { normalizeVoucherRowAttachmentsForUi, getVoucherAttachmentUrlsForUi, stripTransientVoucherAttachmentFields } from "@/lib/voucherAttachmentNormalize";
import { protectClearedAttachmentsFromStalePatch, resolveUrlsAgainstAttachmentIntent, shouldPreserveIntendedVoucherAttachments, logAttachWipe } from "@/lib/attachmentDeleteTrace";
import {
  applyLocalApprovalHoldToRows,
  applyLocalApprovalHoldToVoucherList,
  mergeVoucherRowKeepingLocalApproval,
} from "@/lib/ledgerPendingApproval";
import {
  applyLocalBillWiseLinkHoldToRows,
  applyLocalBillWiseLinkHoldToVoucherList,
  voucherBillWiseAllocationsUiFingerprint,
} from "@/lib/ledgerPendingBillWiseLinks";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { parseLocalCompanyUserRows } from "@/lib/localCompanyUsers";
import {
  buildBillWiseIncomingAllocationMaps,
  getBillWiseAllocatedToTargetWithMaps,
  getPaymentStatus as getPaymentStatusResult,
  getSalePurchaseBillWiseLinkNos,
  getTdsLegAllocatedByTargetId,
  isSaleOrPurchaseBillVoucherType,
} from "@/lib/payment-allocation-utils";
import { getSalePurchasePartyLinkTarget } from "@/lib/tdsVoucher";
import { shouldSuppressTransientCompanyClear } from "@/lib/apkLedgerRouteShield";
import { isCurrentUserSharedOnCompanyRow } from "@/lib/companyOnlineIntegrity";
import {
  PL_SERVER_CLIENT_DELTA_EVENT,
  type PlServerClientDeltaEventDetail,
} from "@/lib/plServerClientCompanyDelta";
import {
  companyRowUsesSqliteLedgerWrites,
  isPureLocalLedgerCompany,
  shouldReadLedgerFromSqliteOnly,
  shouldStripTransientVoucherAttachmentUrls,
} from "@/lib/companyStorageKind";
import { isPlServerSharedCompanyRow } from "@/lib/plServerAccessContext";
import { embeddedClientPrefersQuietBackgroundSync, embeddedSqliteBumpDebounceMs, sqliteBumpCollectionNeededOnLedgerRoute } from "@/lib/embeddedWarmBootstrapFlags";
import { livePullDevLog } from "@/lib/plServerLivePullDevLog";
import { RESTORE_CLOUD_VOUCHERS_REFRESH_EVENT } from "@/lib/restoreCloudBackgroundSync";
import { resolveInterCompanyLegsForVoucher } from "@/lib/interCompany/interCompanyPostingLegs";
import {
  interCompanyVoucherViewerSide,
  isInterCompanyVisibleOnTargetBank,
  readInterCompanyCompanyBankId,
} from "@/lib/interCompany/interCompanyVoucherHydrate";
import { getInterCompanyLedgerAmounts } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { resolveInterCompanyOtherChargeKindFromVoucher } from "@/lib/interCompany/resolveInterCompanyOtherChargeKind";
import { isRecurringAutoUserDisplayLabel } from "@/lib/interCompany/interCompanyVoucherHistory";
import { backfillInterCompanySourceApprovedFlags } from "@/lib/interCompany/interCompanyVisibilityBackfill";
import {
  batchFetchUserDisplayNamesFromFirestore,
  displayNameFromUserFirestoreDoc,
} from "@/lib/batchFetchUserDisplayNames";
import { buildPartyLedgerAggregateMap } from "@/lib/partyListLedgerBalance";
import { filterVouchersForAdminSubscriberPartyLedger } from "@/lib/adminPanelCompany/adminPanelPartyLedger";

/** Offline company: vouchers me `userId` aksar owner ka Firebase uid ya `local` — sirf `user.uid` match se shared user ko 0 rows. */
function localCompanyRoleAllowsViewAll(role: string | undefined): boolean {
  const r = String(role || "")
    .toLowerCase()
    .trim()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  return ["manager", "editor", "accountant", "owner"].includes(r);
}

// --- Report-only party IDs: show only in reports, never in voucher/entity dropdowns or lists ---
export const REPORT_ONLY_PARTY_IDS = ["owners_capital", "opening_balance_ledger"] as const;
// --- System accounts hidden from party/account dropdowns in vouchers (Sale, Purchase, etc.) ---
const PARTY_SELECTION_HIDDEN_IDS = ["sales_account", "purchase_account"] as const;

// --- Types ---
type ProcessedParty = Party & { debit: number; credit: number; balance: number; isSystemAccount?: boolean };
export type ProcessedStaff = Staff & { debit: number; credit: number; balance: number };
export type ProcessedAccount = Account & { debit: number; credit: number; balance: number };
type ProcessedTax = Tax & { debit: number; credit: number; balance: number };
type ProcessedItem = Item & { stockInQty?: number, stockOutQty?: number, stockQty?: number; displayStockQty?: number; };
type ProcessedItemGroup = ItemGroup & { debit: number; credit: number; balance: number; };
type ProcessedGroup = Group & { debit: number; credit: number; balance: number; };
type ProcessedAccountGroup = AccountGroup & { debit: number; credit: number; balance: number; };
export type ProcessedStaffGroup = StaffGroup & { debit: number; credit: number; balance: number; };
type ProcessedTaxGroup = TaxGroup & { debit: number; credit: number; balance: number; };
type ProcessedExpenseAccount = ExpenseAccount & { debit: number; credit: number; balance: number; };
type ProcessedExpenseGroup = ExpenseGroup & { debit: number; credit: number; balance: number; };

type VoucherContextType = {
  vouchers: any[];
  /** Unfiltered vouchers for allocation computation when view filter would undercount Other Linked. */
  vouchersAll: any[];
  loading: boolean;
  processedParties: ProcessedParty[];
  /** Parties for dropdowns/lists only; excludes Opening Balance & Owner's Capital (report-only). */
  processedPartiesForSelection: ProcessedParty[];
  processedStaff: ProcessedStaff[];
  processedAccounts: ProcessedAccount[];
  processedTaxes: ProcessedTax[];
  expenseAccounts: ExpenseAccount[];
  processedItems: ProcessedItem[];
  processedItemGroups: ProcessedItemGroup[];
  processedGroups: ProcessedGroup[];
  processedAccountGroups: ProcessedAccountGroup[];
  processedStaffGroups: ProcessedStaffGroup[];
  processedTaxGroups: ProcessedTaxGroup[];
  processedExpenseAccounts: ProcessedExpenseAccount[];
  processedExpenseGroups: ProcessedExpenseGroup[];
  journalAccountNames: Record<string, string>;
  userNames: Record<string, string>;
  /** Overdue sale/purchase transactions across all parties (for "Overdue Vouchers" view). */
  overdueTransactions: Array<{
    id: string;
    type: string;
    date: any;
    voucherNumber: string;
    partyId: string;
    partyName: string;
    total: number;
    outstanding: number;
    debit: number;
    credit: number;
    dueDate?: any;
    isOverdue: boolean;
    paymentStatus: string;
    overdueImportant?: boolean;
    userId?: string;
    userName?: string;
    narration?: string;
    fileUrls?: string[];
    unassignedFile?: unknown;
    createdAt?: any;
    lastEditedAt?: any;
    updatedAt?: any;
    linkedFromVoucherNos?: string[];
    linkedToVoucherNos?: string[];
    linkedFromVoucherNosBillWise?: string[];
    linkedToVoucherNosBillWise?: string[];
  }>;
  hasOverdueTransactions: boolean;
  /** Entity profile edit save — turant list/detail UI update (Firestore snapshot se pehle). */
  patchMasterEntity: (
    collection: MasterEntityPatchCollection,
    id: string,
    patch: Record<string, unknown>
  ) => void;
};

/** Browser SQLite se aaye vouchers ko Firestore jaisa `date` order mein lao. */
function sortDocsByDateField(data: any[], orderByField: string): any[] {
  const copy = [...data];
  copy.sort((a: any, b: any) => {
    const dateA = parseFirestoreDateFieldToJsDate(a[orderByField])?.getTime() ?? 0;
    const dateB = parseFirestoreDateFieldToJsDate(b[orderByField])?.getTime() ?? 0;
    return dateA - dateB;
  });
  return copy;
}

/** VoucherProvider sets this — module helpers ko company context ke bina strip flag. */
let voucherUiStripTransientAttachments = false;

function voucherAttachmentUiNormalizeOptions():
  | { stripTransientAttachments: boolean }
  | undefined {
  return voucherUiStripTransientAttachments ? { stripTransientAttachments: true } : undefined;
}

/** React/forms me SQLite-only mirror META leak na ho — runtime list state sirf strip. */
function stripMirrorMetaForEntityListRow(row: any): any {
  if (!row || typeof row !== "object") return row;
  const syncStatus =
    row.__plSyncStatus === "sync_due" || row[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS] != null
      ? "sync_due"
      : "synced";
  const stripped = stripLocalMirrorMetaForUiRow(row as Record<string, unknown>);
  return normalizeVoucherRowAttachmentsForUi(
    { ...stripped, __plSyncStatus: syncStatus },
    voucherAttachmentUiNormalizeOptions()
  );
}

function maybeQueueTransientAttachmentCleanup(
  companyId: string,
  rows: readonly Record<string, unknown>[]
): void {
  if (!voucherUiStripTransientAttachments || !companyId || !rows.length) return;
  for (const row of rows) {
    if (!row?.id) continue;
    const { row: cleaned, changed } = stripTransientVoucherAttachmentFields(row);
    if (!changed) continue;
    void upsertCompanyDocInBrowserDb(companyId, "vouchers", String(row.id), cleaned, {
      notify: false,
      skipPlanMutationGate: true,
    }).catch(() => {});
  }
}

/** SQLite bootstrap / prefetch: Firestore-merge jaisi strip taaki META forms me na jaye. */
function sqliteCachedRowsForSetter(cached: any[], orderByField?: string): any[] {
  const alive = cached.filter((x) => x?.isDeleted !== true);
  const base = orderByField ? sortDocsByDateField(alive, orderByField) : alive;
  return base.map(stripMirrorMetaForEntityListRow);
}

/**
 * Ledger masters already hook state me ho to voucher-linked ids ko direct map se naam do;
 * sequential `getDoc` per voucher id (400+ rows) Chrome hang / "Page Unresponsive" trigger karta tha — plan limits se unrelated.
 */
function buildJournalLinkedEntityNameLookup(
  parties: Party[],
  staff: Staff[],
  accounts: Account[],
  taxes: Tax[],
  expenseAccounts: ExpenseAccount[],
  items: Item[]
): Map<string, string> {
  const m = new Map<string, string>();
  const put = (id: unknown, nm: unknown) => {
    if (id == null || id === "") return;
    const name = typeof nm === "string" ? nm.trim() : "";
    if (!name || name === "Unknown" || name === "N/A") return;
    m.set(String(id), name);
  };
  parties.forEach((p) => put(p?.id, p?.name));
  staff.forEach((s) => put(s?.id, s?.name));
  accounts.forEach((a) => put(a?.id, (a as Account)?.accountName));
  taxes.forEach((t) => put(t?.id, t?.name));
  expenseAccounts.forEach((e) => put(e?.id, e?.name));
  items.forEach((it) => put(it?.id, it?.name));
  return m;
}

/**
 * Parties / … ke baad jo ids bachen — cloud mode me bounded parallel Firestore probe (sirf zaroorat par).
 */
async function resolveJournalAccountFirestoreParallel(
  companyDocId: string,
  ids: string[],
  shouldAbort: () => boolean,
  concurrency: number
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!companyDocId || !ids.length) return out;

  async function probeOne(accountId: string): Promise<{ id: string; name: string } | null> {
    const collectionsToSearch = ["parties", "bank_accounts", "staff", "items", "expense_accounts", "taxes", "users"] as const;
    const nameFields = ["name", "accountName", "name", "name", "name", "name", "displayName"] as const;
    for (let i = 0; i < collectionsToSearch.length; i++) {
      const collectionName = collectionsToSearch[i];
      const nameField = nameFields[i];
      try {
        if (collectionName === "users") {
          const dq = query(collection(firestore, "users"), where("uid", "==", accountId));
          const snap = await getDocs(dq);
          const d = snap.docs[0]?.data() as Record<string, unknown> | undefined;
          if (d && d[nameField] != null && String(d[nameField]).trim()) {
            return { id: accountId, name: String(d[nameField]).trim() };
          }
        } else {
          const docRef = doc(firestore, `companies/${companyDocId}/${collectionName}`, accountId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const name = docSnap.data()?.[nameField] as string | undefined;
            if (name && String(name).trim()) return { id: accountId, name: String(name).trim() };
          }
        }
      } catch {
        /* next collection */
      }
    }
    return { id: accountId, name: "Unknown Account" };
  }

  for (let k = 0; k < ids.length; k += concurrency) {
    if (shouldAbort()) return out;
    const slice = ids.slice(k, k + concurrency);
    const settled = await Promise.all(slice.map((id) => probeOne(id)));
    for (const row of settled) {
      if (row && row.name && row.name !== "Unknown Account") out[row.id] = row.name;
    }
  }
  return out;
}

function rowMissingResolvedTimestamp(prevRow: any, mergedRow: any): boolean {
  if (!prevRow || !mergedRow) return false;
  return (
    (!prevRow.createdAt && mergedRow.createdAt) ||
    (!prevRow.lastEditedAt && mergedRow.lastEditedAt) ||
    (!prevRow.updatedAt && mergedRow.updatedAt)
  );
}

/** Profile/attachment edit par purani row na rakho jab merge fingerprint timestamps same ho. */
function rowMissingProfileFields(prevRow: any, mergedRow: any): boolean {
  if (!prevRow || !mergedRow) return false;
  return masterEntityProfileUiFields(prevRow) !== masterEntityProfileUiFields(mergedRow);
}

/** Voucher `fileUrls` delete/replace par purani row na rakho. */
function rowMissingVoucherAttachmentFields(prevRow: any, mergedRow: any): boolean {
  if (!prevRow || !mergedRow) return false;
  // Explicit empty on cache = intentional remove — stale SQLite/snapshot HTTPS is NOT an "upgrade".
  const prevExplicitEmpty =
    Object.prototype.hasOwnProperty.call(prevRow, "fileUrls") &&
    Array.isArray(prevRow.fileUrls) &&
    prevRow.fileUrls.length === 0;
  const prevUrls = getVoucherAttachmentUrlsForUi(prevRow);
  const nextUrls = getVoucherAttachmentUrlsForUi(mergedRow);
  if (prevExplicitEmpty && nextUrls.length > 0) {
    return false;
  }
  // Partial trim (3→2): fuller incoming list is NOT a missing-field upgrade.
  // (Removed: blocked cross-device partial add when nextUrls.length > prevUrls.length.)
  return voucherAttachmentUiFingerprint(prevRow) !== voucherAttachmentUiFingerprint(mergedRow);
}

/** Master rows: newer `editTimeMs` wins — FY hydrate re-read stale SQLite se book OB na wipe ho. */
function mergeMasterEntityRowKeepingNewer(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingMs = mirrorDocEditTimeMs(existing as Record<string, unknown>);
  const incomingMs = mirrorDocEditTimeMs(incoming as Record<string, unknown>);
  if (existingMs > incomingMs) return { ...incoming, ...existing, id: existing.id };
  if (incomingMs > existingMs) return { ...existing, ...incoming, id: incoming.id };
  return { ...existing, ...incoming, id: incoming.id };
}

/** Parties/items/… — local cache merge; optional date sort sirf vouchers ke liye. */
function mergeEntityListsById(prev: any[], cached: any[], orderByField?: string): any[] {
  if (!cached.length) return prev.filter(isAliveDoc);
  const map = new Map<string, any>(prev.filter(isAliveDoc).map((v: any) => [v.id, v]));
  for (const v of cached) {
    if (!isAliveDoc(v)) continue;
    const existing = map.get(v.id);
    map.set(
      v.id,
      orderByField
        ? mergeVoucherRowKeepingLocalApproval(existing, v)
        : mergeMasterEntityRowKeepingNewer(existing, v)
    );
  }
  const merged = [...map.values()].filter(isAliveDoc);
  const sorted = orderByField ? sortDocsByDateField(merged, orderByField) : merged;
  return sorted.map(stripMirrorMetaForEntityListRow);
}

/** EXE/static: Firestore snapshot / SQLite re-read har baar naya array — data same ho to React re-render skip. */
function entityListUiFingerprint(rows: readonly any[]): string {
  if (!rows?.length) return "0";
  let alive = 0;
  let parts = `${rows.length}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.isDeleted === true) continue;
    const id = String(r.id ?? "");
    if (!id) continue;
    alive++;
    const tsField = (v: unknown) => {
      if (v == null) return "";
      const sec = (v as { seconds?: number }).seconds;
      return typeof sec === "number" ? String(sec) : String(v);
    };
    parts += `\x1f${id}\x1e${tsField(r.updatedAt)}\x1e${tsField(r.lastEditedAt)}\x1e${tsField(r.createdAt)}\x1e${tsField(r.date)}\x1e${
      r.isApproved === true ? 1 : 0
    }\x1e${tsField(r.approvedAt)}\x1e${masterEntityProfileUiFields(r)}\x1e${voucherBillWiseAllocationsUiFingerprint(r)}`;
    if (String(r.type || "") === "inter_company") {
      const legs = Array.isArray(r.interCompanyLegs) ? r.interCompanyLegs.length : 0;
      parts += `\x1e${legs}\x1e${r.interCompanySourceApproved === true ? 1 : 0}`;
    }
    parts += `\x1e${voucherAttachmentUiFingerprint(r)}`;
  }
  return `${alive}|${parts}`;
}

/** Snapshot/mirror full replace: keep intentional cleared avatar / voucher attachments against stale HTTPS. */
function masterAvatarIsIntentionallyCleared(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || typeof row !== "object") return false;
  // Edit save patches `fileUrl: ""` — stale snapshot HTTPS revive mat hone do.
  if (!Object.prototype.hasOwnProperty.call(row, "fileUrl")) return false;
  const u = String((row as { fileUrl?: unknown }).fileUrl ?? "").trim();
  if (!u) return true;
  const low = u.toLowerCase();
  return low === "null" || low === "undefined" || low === "none" || low === "n/a";
}

function masterAvatarUrlNonEmpty(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || typeof row !== "object") return false;
  const u = String((row as { fileUrl?: unknown }).fileUrl ?? "").trim();
  if (!u) return false;
  const low = u.toLowerCase();
  return low !== "null" && low !== "undefined" && low !== "none" && low !== "n/a";
}

function preserveClearedAttachmentsInList(prev: any[], next: any[], companyId?: string): any[] {
  if (!Array.isArray(prev) || !Array.isArray(next) || !prev.length || !next.length) return next;
  const prevById = new Map(prev.filter(isAliveDoc).map((v: any) => [String(v.id), v]));
  const cid = String(companyId || "").trim();
  let changed = false;
  const out = next.map((row: any) => {
    if (!row?.id) return row;
    const old = prevById.get(String(row.id));
    if (!old) return row;
    let nextRow = row;
    const vid = String(row.id);
    const nextUrls = getVoucherAttachmentUrlsForUi(nextRow);
    const oldUrls = getVoucherAttachmentUrlsForUi(old);

    const oldExplicitEmptyFileUrls =
      Object.prototype.hasOwnProperty.call(old, "fileUrls") &&
      Array.isArray(old.fileUrls) &&
      old.fileUrls.length === 0;
    // Empty → add is valid (paste/reuse). Only block when durable clear-intent says so.
    if (
      oldExplicitEmptyFileUrls &&
      nextUrls.length > 0 &&
      cid &&
      shouldPreserveIntendedVoucherAttachments(cid, vid, nextUrls)
    ) {
      changed = true;
      logAttachWipe({
        source: "useVouchers.preserveClearedAttachmentsInList",
        reason: "blocked_empty_to_add_by_clear_intent",
        companyId: cid,
        voucherId: vid,
        beforeUrls: nextUrls,
        afterUrls: [],
        extra: { oldUrls },
      });
      nextRow = { ...nextRow, fileUrls: [], files: [], unassignedFile: null };
    } else if (cid && shouldPreserveIntendedVoucherAttachments(cid, vid, nextUrls)) {
      const keep =
        resolveUrlsAgainstAttachmentIntent(cid, vid, nextUrls) ??
        (Array.isArray(old.fileUrls) ? (old.fileUrls as string[]) : oldUrls);
      if (nextUrls.length !== keep.length || nextUrls.some((u, i) => u !== keep[i])) {
        changed = true;
        logAttachWipe({
          source: "useVouchers.preserveClearedAttachmentsInList",
          reason: "forced_intended_urls",
          companyId: cid,
          voucherId: vid,
          beforeUrls: nextUrls,
          afterUrls: keep,
        });
        nextRow = {
          ...nextRow,
          fileUrls: keep,
          files: [],
          unassignedFile: keep.length === 0 ? null : (nextRow.unassignedFile ?? old.unassignedFile ?? null),
        };
      }
    }

    // Masters avatar only — documents/array fields yahan touch mat karo.
    if (masterAvatarIsIntentionallyCleared(old) && masterAvatarUrlNonEmpty(nextRow)) {
      changed = true;
      nextRow = { ...nextRow, fileUrl: "" };
    }

    return nextRow;
  });
  return changed ? out : next;
}

/** `commitEntityListSetter` module helper — current company for trim intent. */
let commitEntityListCompanyId = "";

function commitEntityListSetter<T>(setter: StateSetter<T>, next: T[]): void {
  // PL rematch ke baad masters update low priority — sort row FLIP ke saath compete na kare.
  startTransition(() => {
    setter((prev) => {
      const preserved = preserveClearedAttachmentsInList(
        prev as any[],
        next as any[],
        commitEntityListCompanyId
      ) as T[];
      return entityListUiFingerprint(prev as any[]) === entityListUiFingerprint(preserved as any[])
        ? prev
        : preserved;
    });
  });
}

/** FREEZE: low-priority voucher list updates — dashboard boot freeze; see AGENTS.md. */
function applyLocalLedgerHoldsToVoucherList(prev: any[], next: any[]): any[] {
  const heldApprove = applyLocalApprovalHoldToVoucherList(prev as any[], next as any[]);
  return applyLocalBillWiseLinkHoldToVoucherList(prev as any[], heldApprove as any[]) as any[];
}

function applyLocalLedgerHoldsToRows(rows: any[]): any[] {
  return applyLocalBillWiseLinkHoldToRows(applyLocalApprovalHoldToRows(rows as any[]) as any[]) as any[];
}

function commitVouchersSetter(setter: StateSetter<any>, next: any[]): void {
  startTransition(() => {
    setter((prev) => {
      const held = applyLocalLedgerHoldsToVoucherList(prev as any[], next as any[]);
      const preserved = preserveClearedAttachmentsInList(
        prev as any[],
        held as any[],
        commitEntityListCompanyId
      );
      return entityListUiFingerprint(prev as any[]) === entityListUiFingerprint(preserved as any[])
        ? prev
        : preserved;
    });
  });
}

function commitCollectionListSetter(path: string, setter: StateSetter<any>, next: any[]): void {
  if (path === "vouchers") commitVouchersSetter(setter, next);
  else commitEntityListSetter(setter, next);
}

/** SQLite re-read with identical rows: keep the same array ref (no state change / re-render loop). */
function keepPrevIfSameUiList(prev: any[], next: any[]): any[] {
  if (prev === next) return prev;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return next;
  return entityListUiFingerprint(prev) === entityListUiFingerprint(next) ? prev : next;
}

function mergeEntityListsByIdOrKeepPrev(prev: any[], cached: any[], orderByField?: string): any[] {
  const merged = mergeEntityListsById(prev, cached, orderByField).filter(isAliveDoc);
  if (entityListUiFingerprint(prev) !== entityListUiFingerprint(merged)) return merged;
  const prevById = new Map(prev.filter(isAliveDoc).map((v: any) => [String(v.id), v]));
  const cid = String(commitEntityListCompanyId || "").trim();
  let needsUpgrade = false;
  const upgraded = merged.map((row) => {
    const old = prevById.get(String(row.id));
    if (!old) return row;
    const oldExplicitEmpty =
      Object.prototype.hasOwnProperty.call(old, "fileUrls") &&
      Array.isArray(old.fileUrls) &&
      old.fileUrls.length === 0;
    const nextUrls = getVoucherAttachmentUrlsForUi(row);
    // Never revive cleared attachments from a fuller incoming row (mirror/snapshot race)
    // — but allow genuine empty→add when no clear-intent is active.
    if (
      oldExplicitEmpty &&
      nextUrls.length > 0 &&
      cid &&
      shouldPreserveIntendedVoucherAttachments(cid, String(row.id), nextUrls)
    ) {
      return old;
    }
    if (masterAvatarIsIntentionallyCleared(old) && masterAvatarUrlNonEmpty(row)) {
      return { ...row, fileUrl: "" };
    }
    if (
      rowMissingResolvedTimestamp(old, row) ||
      rowMissingProfileFields(old, row) ||
      rowMissingVoucherAttachmentFields(old, row) ||
      (!oldExplicitEmpty &&
        getVoucherAttachmentUrlsForUi(old).length === 0 &&
        nextUrls.length > 0)
    ) {
      needsUpgrade = true;
      return row;
    }
    return old;
  });
  return needsUpgrade ? upgraded : prev;
}

function processedMasterUiFingerprint(
  rows: ReadonlyArray<{
    id?: string;
    balance?: number;
    debit?: number;
    credit?: number;
    name?: string;
    accountName?: string;
    isDeleted?: boolean;
  }>
): string {
  if (!rows?.length) return "0";
  let s = `${rows.length}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.isDeleted) continue;
    s += `\x1f${String(r.id ?? "")}\x1e${Number(r.balance) || 0}\x1e${Number(r.debit) || 0}\x1e${
      Number(r.credit) || 0
    }\x1e${String(r.name || r.accountName || "")}\x1e${masterEntityProfileUiFields(r as Record<string, unknown>)}`;
  }
  return s;
}

function recordUiFingerprint(rec: Record<string, string>): string {
  const keys = Object.keys(rec);
  if (!keys.length) return "0";
  keys.sort();
  return keys.map((k) => `${k}\x1e${rec[k]}`).join("\x1f");
}

function overdueTransactionsUiFingerprint(
  list: VoucherContextType["overdueTransactions"]
): string {
  if (!list?.length) return "0";
  return `${list.length}|${list.map((t) => `${t.id}\x1e${t.outstanding}`).join("\x1f")}`;
}

/** Context consumer re-render tab sirf jab ledger/display data sach me badla ho — background array ref churn nahi. */
function voucherContextUiFingerprint(v: VoucherContextType): string {
  return [
    v.loading ? "1" : "0",
    entityListUiFingerprint(v.vouchers),
    entityListUiFingerprint(v.vouchersAll),
    processedMasterUiFingerprint(v.processedParties),
    processedMasterUiFingerprint(v.processedPartiesForSelection),
    processedMasterUiFingerprint(v.processedStaff),
    processedMasterUiFingerprint(v.processedAccounts),
    processedMasterUiFingerprint(v.processedTaxes),
    processedMasterUiFingerprint(v.processedExpenseAccounts),
    processedMasterUiFingerprint(v.processedItems),
    processedMasterUiFingerprint(v.processedGroups),
    processedMasterUiFingerprint(v.processedAccountGroups),
    processedMasterUiFingerprint(v.processedStaffGroups),
    processedMasterUiFingerprint(v.processedTaxGroups),
    processedMasterUiFingerprint(v.processedItemGroups),
    processedMasterUiFingerprint(v.processedExpenseGroups),
    recordUiFingerprint(v.journalAccountNames),
    recordUiFingerprint(v.userNames),
    overdueTransactionsUiFingerprint(v.overdueTransactions),
    v.hasOverdueTransactions ? "1" : "0",
  ].join("\n");
}

function keepVoucherContextDisplayIfUnchanged(
  prev: VoucherContextType,
  next: VoucherContextType
): VoucherContextType {
  if (
    voucherContextUiFingerprint(prev) === voucherContextUiFingerprint(next) &&
    prev.loading === next.loading
  ) {
    return prev;
  }
  return next;
}

type CloudBackedCompanyShape = {
  storageOption?: string;
  syncedFromCloud?: boolean;
  syncPolicy?: string;
  authoritativeCompanyId?: string;
  encryptServerBackupSalt?: string | null;
} | null;

/** Local-first APK/static: ye flags Firestore realtime + server bootstrap enable karte hain */
function isCloudBackedCompany(c: CloudBackedCompanyShape): boolean {
  if (!c) return false;
  const so = String(c.storageOption || "").toLowerCase();
  // Explicit offline-first row — `isExplicitLocalRegistryRow` me ambiguous overlap avoid
  if (so === "local") return false;
  if (so === "firebase") return true;
  if (c.syncedFromCloud === true) return true;
  if (String(c.syncPolicy || "").toLowerCase() === "online") return true;
  if (String(c.authoritativeCompanyId || "").trim().length > 0) return true;
  return false;
}

const VoucherContext = createContext<VoucherContextType>({
  vouchers: [],
  vouchersAll: [],
  loading: true,
  processedParties: [],
  processedPartiesForSelection: [],
  processedStaff: [],
  processedAccounts: [],
  processedTaxes: [],
  expenseAccounts: [],
  processedItems: [],
  processedItemGroups: [],
  processedGroups: [],
  processedAccountGroups: [],
  processedStaffGroups: [],
  processedTaxGroups: [],
  processedExpenseAccounts: [],
  processedExpenseGroups: [],
  journalAccountNames: {},
  userNames: {},
  overdueTransactions: [],
  hasOverdueTransactions: false,
  patchMasterEntity: () => {},
});

// Helper for generic state setters
type StateSetter<T> = React.Dispatch<React.SetStateAction<T[]>>;
/** Recycle Bin safety: isDeleted=true row app ke normal screens par kabhi na dikhe. */
const isAliveDoc = (row: any) => row?.isDeleted !== true;
const HEAVY_LEDGER_SKIP_ROUTE_PREFIXES = ["/company", "/admin", "/distributor-signup", "/gate"] as const;
const HEAVY_LEDGER_SKIP_ROUTES = new Set(["/", ""]);

function masterRouteSegment(pathname: string): string {
  let route = String(pathname || "").trim().toLowerCase();
  if (route.startsWith("/app/")) route = route.slice(4) || "/";
  return route.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
}

/** Overdue virtual account — sirf Party master page par chahiye; Reports/nav par skip se main-thread save. */
function routeNeedsOverdueVoucherScan(pathname: string): boolean {
  return masterRouteSegment(pathname) === "party";
}

/** Master collections config — prefetch/listener/filter sab jagah same source. */
type MasterCollectionConfig = {
  path: string;
  setter: StateSetter<any>;
  isGroup?: boolean;
  orderByField?: string;
};

type SqliteLedgerRouteHint = {
  usesSqlite: boolean;
  ownerMatchesUser: boolean;
};

function shouldSkipHeavyVoucherBootstrap(pathname: string): boolean {
  const route = String(pathname || "").trim().toLowerCase();
  // Keep voucher provider idle on non-ledger routes so startup/select-company clicks stay responsive.
  if (HEAVY_LEDGER_SKIP_ROUTES.has(route)) return true;
  return HEAVY_LEDGER_SKIP_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
}

/*
 * FREEZE: Dashboard boot — SQLite-first voucher load, idle full merge, no UI freeze.
 * See AGENTS.md "Freeze: Dashboard boot — SQLite-first, no UI freeze".
 */
type SqliteApplyRowsFn = <T,>(
  setter: StateSetter<T>,
  cached: T[],
  orderByField?: string,
  collectionPath?: string
) => void;

function scheduleIdleWork(work: () => void): void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(work, { timeout: 2500 });
    return;
  }
  setTimeout(work, 16);
}

/** Voucher rows are parsed in cooperative slices; masters keep the normal small-list reader. */
function listCompanyCollectionForVoucherUi(companyId: string, collectionPath: string): Promise<any[]> {
  if (collectionPath === "vouchers") return listVoucherMirrorRowsIncrementally(companyId);
  return listCompanyDocsFromBrowserDb(companyId, collectionPath, { forBackupMerge: true });
}

function isDashboardVouchersOnlyPrefetch(
  pathname: string,
  collections: ReadonlyArray<{ path: string }>
): boolean {
  const route = String(pathname || "").trim().toLowerCase();
  if (!route.startsWith("/dashboard")) return false;
  return collections.length > 0 && collections.every((c) => c.path === "vouchers");
}

/** FREEZE: projection first, full JSON merge idle — see AGENTS.md dashboard boot freeze. */
function loadVouchersFromSqliteFastFirst(args: {
  companyId: string;
  setter: StateSetter<any>;
  orderByField?: string;
  applySqliteRows: SqliteApplyRowsFn;
  isStale: () => boolean;
  onLiteApplied?: () => void;
}): Promise<void> {
  const { companyId, setter, orderByField, applySqliteRows, isStale, onLiteApplied } = args;
  return listVoucherSummaryProjectionFromBrowserDb(companyId, { forBackupMerge: true })
    .then((lite) => {
      if (isStale() || !lite.length) return;
      startTransition(() => {
        if (isStale()) return;
        applySqliteRows(
          setter,
          lite.map((r) => ({
            id: r.id,
            type: r.type || "sale",
            date: r.date || null,
            amount: Number(r.amount || 0),
          })),
          orderByField,
          "vouchers"
        );
      });
      onLiteApplied?.();
    })
    .catch(() => {})
    .then(() => {
      scheduleIdleWork(() => {
        if (isStale()) return;
        void listVoucherMirrorRowsIncrementally(companyId)
          .then((cached) => {
            if (isStale()) return;
            startTransition(() => {
              if (isStale()) return;
              applySqliteRows(setter, cached, orderByField, "vouchers");
            });
          })
          .catch(() => {});
      });
    });
}

export const VoucherProvider = ({
  children,
  /** Copy-to / compare nested provider: shell route filter ignore karke voucher-form masters load. */
  voucherFormMasterScope = false,
}: {
  children: ReactNode;
  voucherFormMasterScope?: boolean;
}) => {
  const { companyId, company, clearCompanyId } = useCompany();
  commitEntityListCompanyId = String(companyId || "").trim();
  const pathname = usePathname() || "";
  const [dashboardTabScopeVersion, setDashboardTabScopeVersion] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTab = () => setDashboardTabScopeVersion((v) => v + 1);
    window.addEventListener(DASHBOARD_TAB_CHANGED_EVENT, onTab);
    return () => window.removeEventListener(DASHBOARD_TAB_CHANGED_EVENT, onTab);
  }, []);
  /** Gate/settings shells vs ledger — pathname string har sidebar click pe change; boolean sirf shell enter/exit. */
  const ledgerBootstrapActive = !shouldSkipHeavyVoucherBootstrap(pathname);
  const { user, customUser, loading: authLoading } = useAuth();
  const { can } = usePermissions();
  const isServerGateCompanyContext =
    isPlServerSharedCompanyRow(company, null) ||
    (!!companyId && isPlServerSharedCompanyRow({ id: companyId }, null));
  // Selected company may be local even when user is online; server-gate delta rows bhi SQLite ledger.
  const isLocalCompanySelected =
    isLocalOnlyMode() ||
    companyRowUsesSqliteLedgerWrites(company) ||
    isServerGateCompanyContext;
  /** Web dev Firebase mode: company context hydrate se pehle SQLite row se ledger route hint. */
  const [sqliteLedgerRouteHint, setSqliteLedgerRouteHint] = useState<SqliteLedgerRouteHint>({
    usesSqlite: false,
    ownerMatchesUser: false,
  });
  const sqliteLedgerRouteHintRef = useRef(sqliteLedgerRouteHint);
  const commitSqliteLedgerRouteHint = useCallback((next: SqliteLedgerRouteHint) => {
    const prev = sqliteLedgerRouteHintRef.current;
    if (prev.usesSqlite === next.usesSqlite && prev.ownerMatchesUser === next.ownerMatchesUser) return;
    sqliteLedgerRouteHintRef.current = next;
    setSqliteLedgerRouteHint(next);
  }, []);
  useEffect(() => {
    if (!companyId) {
      commitSqliteLedgerRouteHint({ usesSqlite: false, ownerMatchesUser: false });
      return;
    }
    if (companyRowUsesSqliteLedgerWrites(company)) {
      commitSqliteLedgerRouteHint({
        usesSqlite: true,
        ownerMatchesUser: String(company?.ownerId || "") === String(user?.uid || ""),
      });
      return;
    }
    let cancelled = false;
    void getLocalCompanyById(companyId, { includeDeleted: true })
      .then((row) => {
        if (cancelled) return;
        const usesSqlite = !!row && companyRowUsesSqliteLedgerWrites(row);
        commitSqliteLedgerRouteHint({
          usesSqlite,
          ownerMatchesUser: usesSqlite && String(row?.ownerId || "") === String(user?.uid || ""),
        });
      })
      .catch(() => {
        if (!cancelled) {
          commitSqliteLedgerRouteHint({ usesSqlite: false, ownerMatchesUser: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, company?.storageOption, company?.syncPolicy, company?.syncedFromCloud, company?.ownerId, user?.uid, commitSqliteLedgerRouteHint]);
  useEffect(() => {
    voucherUiStripTransientAttachments = shouldStripTransientVoucherAttachmentUrls(company);
    return () => {
      voucherUiStripTransientAttachments = false;
    };
  }, [
    company,
    company?.storageOption,
    company?.syncPolicy,
    company?.plServerShared,
    company?.localOnly,
    company?.firestoreSyncDisabled,
  ]);
  const usesSqliteLedgerForSelectedCompany =
    isLocalCompanySelected || sqliteLedgerRouteHint.usesSqlite;
  /** Offline unlock same-tab: isCompanyReady / prefetch dubara (localStorage pehle listener ke baad update hota hai). */
  const [localAuthEpoch, setLocalAuthEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setLocalAuthEpoch((n) => n + 1);
    window.addEventListener(LOCAL_AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LOCAL_AUTH_CHANGED_EVENT, bump);
  }, []);
  const [ledgerSyncModeEpoch, setLedgerSyncModeEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setLedgerSyncModeEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, bump);
  }, []);
  const [onlineSyncPrefsEpoch, setOnlineSyncPrefsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setOnlineSyncPrefsEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
  }, []);

  /** Same company par listener rebind — poora page spinner mat dikhao (EXE/APK party/bank shake). */
  const hasWarmLedgerDataRef = useRef(false);
  const lastCompanyIdRef = useRef<string | null>(null);
  /** Route nav pe already-hydrated SQLite collections dubara JSON.parse mat — APK sidebar 15–20s lag. */
  const warmSqliteCollectionPathsRef = useRef<Set<string>>(new Set());
  /** Async SQLite/Firestore callbacks purani company ke liye late na aayein. */
  const companyDataLoadEpochRef = useRef(0);
  /** Mobile pull refresh stages SQLite bumps so the visible page stays on its current rows until commit. */
  const mobilePullRefreshHoldRef = useRef<{
    companyId: string;
    collections: Set<string>;
    pendingCollections: Set<string>;
  } | null>(null);
  const mobilePullRefreshMergeRef = useRef<{
    companyId: string;
    merge: (collection: string) => Promise<void>;
  } | null>(null);
  /** Intentional clears only (company switch / gate-shell). Accidental [] = shared-user blink. */
  const allowEmptyVoucherWipeRef = useRef(false);
  const companyIdForWipeGuardRef = useRef<string | null>(companyId);
  companyIdForWipeGuardRef.current = companyId ?? null;
  const pathnameForWipeGuardRef = useRef(pathname);
  pathnameForWipeGuardRef.current = pathname;

  const [vouchers, setVouchersRaw] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(loading);
  const setLoadingIfChanged = useCallback((next: boolean) => {
    if (loadingRef.current === next) return;
    loadingRef.current = next;
    setLoading(next);
  }, []);
  const voucherForensicPrevRef = useRef<{ companyId: string; rows: any[] }>({ companyId: "", rows: [] });
  const stableLiveVoucherListenerRef = useRef<{
    key: string;
    unsubscribe: () => void;
  } | null>(null);

  /** Same-company pe accidental empty replace block; /gate + company-switch allow wipe. */
  const setVouchers = useCallback((action: React.SetStateAction<any[]>) => {
    setVouchersRaw((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      const sameCompanyWarm =
        !!companyIdForWipeGuardRef.current &&
        lastCompanyIdRef.current === companyIdForWipeGuardRef.current;
      const blockEmptyWipe =
        !allowEmptyVoucherWipeRef.current &&
        sameCompanyWarm &&
        Array.isArray(next) &&
        next.length === 0 &&
        Array.isArray(prev) &&
        prev.length > 0 &&
        !shouldSkipHeavyVoucherBootstrap(pathnameForWipeGuardRef.current);
      if (blockEmptyWipe) {
        void import("@/lib/plServerLiveChangeTrace")
          .then(({ plServerVoucherForensicTrace, voucherIdFingerprint }) =>
            plServerVoucherForensicTrace("ui_block_empty_voucher_wipe", {
              companyId: companyIdForWipeGuardRef.current,
              beforeCount: prev.length,
              beforeFingerprint: voucherIdFingerprint(prev),
              pathname: pathnameForWipeGuardRef.current,
              stack: new Error().stack?.split("\n").slice(1, 9).join(" | "),
            })
          )
          .catch(() => undefined);
        return prev;
      }
      if (Array.isArray(next) && next.length === 0 && Array.isArray(prev) && prev.length > 0) {
        void import("@/lib/plServerLiveChangeTrace")
          .then(({ plServerVoucherForensicTrace, voucherIdFingerprint }) =>
            plServerVoucherForensicTrace("ui_empty_voucher_wipe_allowed", {
              companyId: companyIdForWipeGuardRef.current,
              beforeCount: prev.length,
              beforeFingerprint: voucherIdFingerprint(prev),
              pathname: pathnameForWipeGuardRef.current,
              allowFlag: allowEmptyVoucherWipeRef.current,
              skipHeavy: shouldSkipHeavyVoucherBootstrap(pathnameForWipeGuardRef.current),
              lastCompanyId: lastCompanyIdRef.current,
              stack: new Error().stack?.split("\n").slice(1, 9).join(" | "),
            })
          )
          .catch(() => undefined);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      stableLiveVoucherListenerRef.current?.unsubscribe();
      stableLiveVoucherListenerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = String(companyId || "").trim();
    const prev = voucherForensicPrevRef.current;
    if (id && prev.companyId === id && prev.rows.length > vouchers.length) {
      void import("@/lib/plServerLiveChangeTrace")
        .then(({ plServerVoucherForensicTrace, voucherIdFingerprint }) =>
          plServerVoucherForensicTrace("ui_voucher_state_shrank", {
            companyId: id,
            beforeCount: prev.rows.length,
            beforeFingerprint: voucherIdFingerprint(prev.rows),
            afterCount: vouchers.length,
            afterFingerprint: voucherIdFingerprint(vouchers),
            pathname,
            loading,
          })
        )
        .catch(() => undefined);
    }
    voucherForensicPrevRef.current = { companyId: id, rows: vouchers };
  }, [companyId, loading, pathname, vouchers]);

  // Apply View Own / View All Records: show only own vouchers when user doesn't have view_all_records
  const viewAllRecords = can("view_all_records");
  const vouchersForDisplay = useMemo(() => {
    // Defensive guard: agar stale source se deleted voucher aa bhi gaya, view layer se hata do.
    // Approve All hold: stale reload row ko unapproved dikhaye to bhi pink wapas na aaye.
    const activeVouchers = applyLocalLedgerHoldsToRows((vouchers || []).filter(isAliveDoc));
    const applyTargetIcVisibility = <T extends { type?: string }>(list: T[]): T[] =>
      list.filter((v) => {
        if (String(v?.type || "") !== "inter_company") return true;
        return isInterCompanyVisibleOnTargetBank(v as Record<string, unknown>);
      });
    if (!user?.uid) return [];
    const localUser =
      isLocalCompanySelected && companyId ? getLocalAuthUser(companyId) : null;
    // Local + manager/editor: permissionConfig kabhi galat ho to bhi pura ledger dikhao (voucher userId owner uid hota hai).
    const localStaffSeeAll =
      isLocalCompanySelected &&
      !!localUser &&
      localCompanyRoleAllowsViewAll(localUser.role);
    if (viewAllRecords || localStaffSeeAll) return applyTargetIcVisibility(activeVouchers);

    // P2P server-gate: gate token se company access mil chuka — local company login na ho to pura ledger dikhao.
    if (isServerGateCompanyContext && !localUser) {
      return applyTargetIcVisibility(activeVouchers);
    }

    // Local + viewer/data-entry: apni rows — userId local id / `local` / Firebase uid
    if (isLocalCompanySelected && localUser?.id) {
      const uid = String(user.uid);
      const lid = String(localUser.id);
      const lname = (localUser.username || "").toLowerCase().trim();
      return applyTargetIcVisibility(
        activeVouchers.filter((v) => {
          const vid = v.userId != null ? String(v.userId) : "";
          if (vid === uid || vid === lid) return true;
          if (lname && vid.toLowerCase() === lname) return true;
          if (vid === "local" || vid === "local_guest_user") return true;
          return false;
        })
      );
    }

    return applyTargetIcVisibility(activeVouchers.filter((v) => v.userId === user.uid));
  }, [vouchers, viewAllRecords, user?.uid, isLocalCompanySelected, companyId, localAuthEpoch]);

  // Target IC: source pehle approve ho chuka ho to `interCompanySourceApproved` backfill (bank/recent ke liye).
  // IMPORTANT: scan raw `vouchers`, not `vouchersForDisplay` — display already hides unflagged target IC rows.
  const icBackfillGenRef = useRef(0);
  useEffect(() => {
    if (!companyId || !vouchers.length) return;
    const rawAlive = (vouchers || []).filter(isAliveDoc);
    const needsBackfill = rawAlive.some(
      (v) =>
        String(v?.type || "") === "inter_company" &&
        interCompanyVoucherViewerSide(v as Record<string, unknown>) === "target" &&
        (v as Record<string, unknown>).interCompanySourceApproved !== true
    );
    if (!needsBackfill) return;
    const gen = ++icBackfillGenRef.current;
    const timer = setTimeout(() => {
      void backfillInterCompanySourceApprovedFlags(
        companyId,
        rawAlive as Array<Record<string, unknown> & { id?: string }>
      ).then(() => {
        if (gen !== icBackfillGenRef.current) return;
        /* Firestore listener vouchers refresh karega */
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [companyId, vouchers]);
  
  const [parties, setParties] = useState<Party[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [unprocessedExpenseAccounts, setUnprocessedExpenseAccounts] = useState<ExpenseAccount[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [staffGroups, setStaffGroups] = useState<StaffGroup[]>([]);
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<ExpenseGroup[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [journalAccountNames, setJournalAccountNames] = useState<Record<string, string>>({});
  /** Warm SQLite path set but in-memory list empty → route/bootstrap must re-read (dev refresh / dashboard→party). */
  const masterListCountsRef = useRef<Record<string, number>>({});
  masterListCountsRef.current = {
    vouchers: vouchers.length,
    parties: parties.length,
    staff: staff.length,
    bank_accounts: accounts.length,
    taxes: taxes.length,
    expense_accounts: unprocessedExpenseAccounts.length,
    items: items.length,
    item_groups: itemGroups.length,
    groups: groups.length,
    account_groups: accountGroups.length,
    staff_groups: staffGroups.length,
    tax_groups: taxGroups.length,
    expense_groups: expenseGroups.length,
  };
  const sqliteCollectionWarmWithRows = (path: string): boolean => {
    if (!warmSqliteCollectionPathsRef.current.has(path)) return false;
    const n = masterListCountsRef.current[path];
    return n === undefined ? true : n > 0;
  };
  const staffModuleSystemGroupsEnsuredRef = useRef("");

  useEffect(() => {
    const cid = String(companyId || "").trim();
    const uid = String(user?.uid || company?.ownerId || "").trim();
    if (!cid || !uid || staffModuleSystemGroupsEnsuredRef.current === cid) return;
    staffModuleSystemGroupsEnsuredRef.current = cid;
    void ensureStaffModuleSystemGroups(cid, uid);
  }, [companyId, user?.uid, company?.ownerId]);

  /** Voucher attachment save — turant vouchers cache patch (ledger/dialog live). */
  const patchVoucherInCache = useCallback((voucherId: string, patch: Record<string, unknown>) => {
    if (!voucherId?.trim()) return;
    setVouchers((prev) => {
      const idx = prev.findIndex((v) => String(v?.id) === String(voucherId));
      if (idx < 0) {
        // Naya create: SQLite bump se pehle attachment patch — pehle `idx < 0` par skip se fileUrls list me nahi dikhte the.
        if (process.env.NODE_ENV !== "production") {
          void import("@/lib/attachmentDeleteTrace").then((m) =>
            m.traceAttachmentRowChange({
              source: "useVouchers.patchVoucherInCache.append",
              companyId,
              voucherId,
              prevRow: null,
              nextRow: { ...patch, id: voucherId },
            })
          );
        }
        return [{ ...patch, id: voucherId }, ...prev];
      }
      // Mirror full-doc patch stale HTTPS revive block; attachment-only form save patch allow.
      let safePatch = patch;
      try {
        const existing = prev[idx] as Record<string, unknown>;
        safePatch = protectClearedAttachmentsFromStalePatch(existing, patch, {
          companyId: companyId ?? undefined,
          voucherId,
        });
      } catch {
        safePatch = patch;
      }
      const merged = { ...prev[idx], ...safePatch, id: voucherId };
      if (process.env.NODE_ENV !== "production") {
        void import("@/lib/attachmentDeleteTrace").then((m) =>
          m.traceAttachmentRowChange({
            source: "useVouchers.patchVoucherInCache",
            companyId,
            voucherId,
            prevRow: prev[idx] as Record<string, unknown>,
            nextRow: merged as Record<string, unknown>,
          })
        );
      }
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
  }, [companyId]);

  /** Approve All: ek setState — N CustomEvent se sirf pehli row paint / baaki SQLite bump se revert. */
  const patchVouchersInCache = useCallback((voucherIds: string[], patch: Record<string, unknown>) => {
    const idSet = new Set((voucherIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    if (!idSet.size) return;
    setVouchers((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        const id = String(row?.id || "").trim();
        if (!id || !idSet.has(id)) return row;
        changed = true;
        let safePatch = patch;
        try {
          safePatch = protectClearedAttachmentsFromStalePatch(row as Record<string, unknown>, patch, {
            companyId: companyId ?? undefined,
            voucherId: id,
          });
        } catch {
          safePatch = patch;
        }
        return { ...row, ...safePatch, id };
      });
      return changed ? next : prev;
    });
  }, [companyId]);

  // Voucher form save: attachment / IC peer-pending patch — ledger/dialog bina refresh update.
  useEffect(() => {
    if (!companyId) return;
    return subscribeVoucherLivePatch((detail) => {
      if (detail.companyId !== companyId) return;
      if (Array.isArray(detail.voucherIds) && detail.voucherIds.length > 0) {
        patchVouchersInCache(detail.voucherIds, detail.patch);
        return;
      }
      patchVoucherInCache(detail.voucherId, detail.patch);
    });
  }, [companyId, patchVoucherInCache, patchVouchersInCache]);

  /** Entity edit save — turant raw masters state patch (list fingerprint + processed recompute). */
  const patchMasterEntity = useCallback(
    (
      collection: MasterEntityPatchCollection,
      id: string,
      patch: Record<string, unknown>,
      opts?: { insertIfMissing?: boolean }
    ) => {
      if (!id?.trim()) return;
      // Avatar clear: `null`/`undefined` → `""` taaki snapshot revive detect ho sake.
      const safePatch = { ...patch };
      if (Object.prototype.hasOwnProperty.call(safePatch, "fileUrl")) {
        const raw = safePatch.fileUrl;
        const u = String(raw ?? "").trim();
        const low = u.toLowerCase();
        if (!u || low === "null" || low === "undefined" || low === "none" || low === "n/a") {
          safePatch.fileUrl = "";
        }
      }
      const applyPatch = <T extends { id: string }>(setter: StateSetter<T>) => {
        setter((prev) => {
          const idx = prev.findIndex((row) => String(row.id) === String(id));
          if (idx < 0) {
            const allowInsert =
              opts?.insertIfMissing === true ||
              (isServerGateCompanyContext && collection === "bank_accounts" && safePatch.accountName);
            if (allowInsert) {
              const label = String(safePatch.name ?? safePatch.accountName ?? "").trim();
              if (!label && collection !== "items") return prev;
              const inserted = { ...safePatch, id } as T;
              return [...prev, inserted];
            }
            return prev;
          }
          const merged = { ...prev[idx], ...safePatch, id } as T;
          const next = prev.slice();
          next[idx] = merged;
          return next;
        });
      };
      switch (collection) {
        case "parties":
          applyPatch(setParties);
          break;
        case "staff":
          applyPatch(setStaff);
          break;
        case "bank_accounts":
          applyPatch(setAccounts);
          break;
        case "taxes":
          applyPatch(setTaxes);
          break;
        case "items":
          applyPatch(setItems);
          break;
        case "expense_accounts":
          applyPatch(setUnprocessedExpenseAccounts);
          break;
        case "expense_groups":
          applyPatch(setExpenseGroups);
          break;
        default:
          break;
      }
    },
    [isServerGateCompanyContext]
  );

  // Master add/edit — same-tab + cross-tab/EXE live patch (voucher jaisa).
  useEffect(() => {
    if (!companyId) return;
    return subscribeMasterLivePatch((detail) => {
      if (detail.companyId !== companyId) return;
      patchMasterEntity(detail.collection, detail.docId, detail.patch, {
        insertIfMissing: detail.insertIfMissing,
      });
    });
  }, [companyId, patchMasterEntity]);

  /** Stale-deps se effect storm na ho: async name fetch closure me fresh cache (plan limits unrelated hang fix). */
  const journalAccountNamesRef = useRef<Record<string, string>>({});
  journalAccountNamesRef.current = journalAccountNames;
  const userNamesRef = useRef<Record<string, string>>({});
  userNamesRef.current = userNames;
  /** Firestore snapshot → SQLite batch mirror debounce (static); unmount pe clear. */
  const mirrorSnapshotTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** EXE: background sync ke dauran har SQLite write par list merge batch — scroll/jump kam. */
  const sqliteBumpMergeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    if (lastCompanyIdRef.current === companyId) return;
    companyDataLoadEpochRef.current += 1;
    // Company switch par purana company data turant clear karo (offline stale merge avoid).
    allowEmptyVoucherWipeRef.current = true;
    setVouchers([]);
    allowEmptyVoucherWipeRef.current = false;
    setParties([]);
    setStaff([]);
    setAccounts([]);
    setTaxes([]);
    setUnprocessedExpenseAccounts([]);
    setItems([]);
    setItemGroups([]);
    setGroups([]);
    setAccountGroups([]);
    setStaffGroups([]);
    setTaxGroups([]);
    setExpenseGroups([]);
    setJournalAccountNames({});
    setUserNames({});
    hasWarmLedgerDataRef.current = false;
    warmSqliteCollectionPathsRef.current = new Set();
    setLoadingIfChanged(true);
    previousData.current = {
      vouchers: [],
      vouchersAll: [],
      processedParties: [],
      processedPartiesForSelection: [],
      processedStaff: [],
      processedAccounts: [],
      processedTaxes: [],
      expenseAccounts: [],
      processedItems: [],
      processedItemGroups: [],
      processedGroups: [],
      processedAccountGroups: [],
      processedStaffGroups: [],
      processedTaxGroups: [],
      processedExpenseAccounts: [],
      processedExpenseGroups: [],
      overdueTransactions: [],
      hasOverdueTransactions: false,
      journalAccountNames: {},
      userNames: {},
      patchMasterEntity: () => {},
    };
    lastCompanyIdRef.current = companyId ?? null;
  }, [companyId, setVouchers, setLoadingIfChanged]);

  // Pre-fill current user name so transaction User column shows correctly (no fetch delay)
  useEffect(() => {
    if (!user?.uid) return;
    const name = customUser?.displayName || user.displayName || user.email || "You";
    setUserNames((prev) => (prev[user.uid] === name ? prev : { ...prev, [user.uid]: name }));
  }, [user?.uid, user?.displayName, user?.email, customUser?.displayName]);

  const previousData = useRef<Omit<VoucherContextType, 'loading'>>({
      vouchers: [],
      vouchersAll: [],
      processedParties: [],
      processedPartiesForSelection: [],
      processedStaff: [],
      processedAccounts: [],
      processedTaxes: [],
      expenseAccounts: [],
      processedItems: [],
      processedItemGroups: [],
      processedGroups: [],
      processedAccountGroups: [],
      processedStaffGroups: [],
      processedTaxGroups: [],
      processedExpenseAccounts: [],
      processedExpenseGroups: [],
      overdueTransactions: [],
      hasOverdueTransactions: false,
      journalAccountNames: {},
      userNames: {},
      patchMasterEntity: () => {},
  });

  /** Har render par latest company — snapshot decrypt / pull me stale closure na ho */
  const companyRef = useRef(company);
  companyRef.current = company;

  /**
   * Pehle poora `company` object effect deps me tha — plan sync / naam / fiscal UI se reference badalta,
   * Firestore listeners teardown + 600ms delay → tab wapas aane par 4–5s blank. Sirf sync-relevant fields.
   */
  const voucherListenerCompanyKey = useMemo(() => {
    if (!companyId) return "";
    const c = (company || null) as CloudBackedCompanyShape | null;
    const storageOpt = String(c?.storageOption ?? "").toLowerCase().trim();
    const stickyWarmSameCompany =
      hasWarmLedgerDataRef.current && lastCompanyIdRef.current === companyId;
    const looksSqliteOrPl =
      stickyWarmSameCompany ||
      storageOpt === "local" ||
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      isPlServerSharedCompanyRow(company, null) ||
      isPlServerSharedCompanyRow({ id: companyId }, null) ||
      companyRowUsesSqliteLedgerWrites(company);
    // Shared PL-gate: company null↔row / pending|id key remount = wipe cycle. Keep companyId-stable.
    if (looksSqliteOrPl) {
      return `sqlite|${companyId}`;
    }
    if (!company || company.id !== companyId) return `pending|${companyId}`;
    // Local/EXE restore me `sharedWithEmails` non-array ho sakta hai; listener key build me spread crash mat hone do.
    const sharedList = Array.isArray((company as any)?.sharedWithEmails)
      ? ((company as any).sharedWithEmails as unknown[])
      : [];
    const shared = JSON.stringify(
      sharedList.map((e) => String(e).toLowerCase().trim()).sort()
    );
    return [
      companyId,
      company.id,
      String(c?.storageOption ?? ""),
      String(c?.syncPolicy ?? ""),
      c?.syncedFromCloud === true ? "1" : "0",
      String(c?.authoritativeCompanyId ?? "").trim(),
      String(c?.encryptServerBackupSalt ?? "").trim(),
      String(company.ownerId ?? ""),
      String(company.ownerEmail ?? "").toLowerCase().trim(),
      shared,
    ].join("|");
  }, [
    companyId,
    company?.id,
    (company as CloudBackedCompanyShape | undefined)?.storageOption,
    (company as CloudBackedCompanyShape | undefined)?.syncPolicy,
    (company as CloudBackedCompanyShape | undefined)?.syncedFromCloud,
    (company as CloudBackedCompanyShape | undefined)?.authoritativeCompanyId,
    (company as CloudBackedCompanyShape | undefined)?.encryptServerBackupSalt,
    (company as { plServerShared?: boolean } | undefined)?.plServerShared,
    company?.ownerId,
    company?.ownerEmail,
    company?.sharedWithEmails,
  ]);

  // Stable key: `company.sharedWithEmails` is a NEW array on every company-row refresh (e.g. after a voucher save
  // bumps the registry/storage counters) - as a raw dep it re-ran the whole fetch effect (full SQLite reload of all
  // vouchers + loading/blank table + multi-second main-thread task). Compare by content instead.
  const sharedWithEmailsKey = Array.isArray(company?.sharedWithEmails)
    ? (company!.sharedWithEmails as unknown[]).map((e) => String(e ?? "")).join("|")
    : String(company?.sharedWithEmails ?? "");

  // --- Data Fetching Logic ---
  useEffect(() => {
    const keepWarmUi = hasWarmLedgerDataRef.current && lastCompanyIdRef.current === companyId;
    console.info("[PL-DEBUG-SAVE] useVouchers fetch effect run", { companyId, keepWarmUi, t: Math.round(performance.now()) });

    if (authLoading) {
      if (!keepWarmUi) setLoadingIfChanged(true);
      return;
    }

    const company = companyRef.current;
    const isServerGateCompanyContext =
      isPlServerSharedCompanyRow(company, null) ||
      (!!companyId && isPlServerSharedCompanyRow({ id: companyId }, null));

    const resetAllStates = () => {
      const alreadyEmpty =
        vouchers.length === 0 &&
        parties.length === 0 &&
        staff.length === 0 &&
        accounts.length === 0 &&
        taxes.length === 0 &&
        unprocessedExpenseAccounts.length === 0 &&
        items.length === 0 &&
        itemGroups.length === 0 &&
        groups.length === 0 &&
        accountGroups.length === 0 &&
        staffGroups.length === 0 &&
        taxGroups.length === 0 &&
        expenseGroups.length === 0;
      if (alreadyEmpty) return;
      const clearIfNeeded = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>) => {
        setter((prev) => (prev.length > 0 ? [] : prev));
      };
      allowEmptyVoucherWipeRef.current = true;
      clearIfNeeded(setVouchers); clearIfNeeded(setParties); clearIfNeeded(setStaff); clearIfNeeded(setAccounts);
      clearIfNeeded(setTaxes); clearIfNeeded(setUnprocessedExpenseAccounts); clearIfNeeded(setItems);
      clearIfNeeded(setItemGroups); clearIfNeeded(setGroups); clearIfNeeded(setAccountGroups);
      clearIfNeeded(setStaffGroups); clearIfNeeded(setTaxGroups); clearIfNeeded(setExpenseGroups);
      allowEmptyVoucherWipeRef.current = false;
    };

    if (!ledgerBootstrapActive) {
      // Gate/settings: listeners band. Same-company warm ledger mat mitao — wapas aate hi 15–20s SQLite reload.
      if (!keepWarmUi) {
        resetAllStates();
        hasWarmLedgerDataRef.current = false;
        warmSqliteCollectionPathsRef.current = new Set();
      }
      setLoadingIfChanged(false);
      return;
    }

    // सिंक पेन्डिङ भए वा कम्पनी अपूर्ण भए listener नलगाउने (permission denied रोक्न)।
    // Local/offline company: sharedWithEmails Firebase share hai — SQLite wale users ke liye valid local session kaafi.
    const shouldUseLocalCompanyData = usesSqliteLedgerForSelectedCompany;
    const emailNorm = (e: string) => String(e || "").toLowerCase().trim();
    const userEmailNorm = user?.email ? emailNorm(user.email) : "";
    // EXE/local restore me `sharedWithEmails` kabhi array ke bajay object/string aa sakta hai; `.some` crash avoid.
    const sharedWithEmails = Array.isArray((company as any)?.sharedWithEmails)
      ? ((company as any).sharedWithEmails as unknown[])
      : [];
    const sharedEmailOk =
      !!userEmailNorm && sharedWithEmails.some((e) => emailNorm(String(e)) === userEmailNorm);
    const sharedOnCompanyRow = isCurrentUserSharedOnCompanyRow(
      company as Parameters<typeof isCurrentUserSharedOnCompanyRow>[0],
      { uid: user?.uid ?? "", email: user?.email ?? null }
    );
    const hasLocalUnlockedSession =
      shouldUseLocalCompanyData && !!companyId && !!getLocalAuthToken(companyId);
    const isServerGateLedgerRow =
      isPureLocalLedgerCompany(company as Parameters<typeof isPureLocalLedgerCompany>[0]) ||
      isServerGateCompanyContext;
    const isCompanyReady =
      company?.ownerId === user?.uid ||
      !!company?.ownerEmail ||
      sharedEmailOk ||
      sharedOnCompanyRow ||
      hasLocalUnlockedSession ||
      isServerGateLedgerRow ||
      isServerGateCompanyContext ||
      (sqliteLedgerRouteHint.usesSqlite && sqliteLedgerRouteHint.ownerMatchesUser);
    if (!companyId || !user || !isCompanyReady) {
      // Shared PL: company-row/share-list flicker → isCompanyReady false. Gate/shell pe wipe OK;
      // ledger pe warm same-company mat mitao (pichhla broad keepWarm /gate pe bhi rok deta tha).
      if (!companyId || !keepWarmUi) {
        resetAllStates();
        // Refresh boot: companyId hai par shared row abhi hydrate ho rahi — khali list mat dikhao.
        if (companyId && user && !isCompanyReady) {
          setLoadingIfChanged(true);
        } else {
          setLoadingIfChanged(false);
        }
      } else {
        void import("@/lib/plServerLiveChangeTrace")
          .then(({ plServerVoucherForensicTrace }) =>
            plServerVoucherForensicTrace("ui_skip_reset_ready_flicker", {
              companyId,
              hasUser: !!user,
              isCompanyReady,
              isServerGateCompanyContext,
              ownerEmailPresent: !!company?.ownerEmail,
              sharedEmailOk,
              hasLocalUnlockedSession,
              pathname,
            })
          )
          .catch(() => undefined);
      }
      return;
    }
    /** Subcollections Firestore par isi doc id ke neeche — authoritativeCompanyId upload/Stripe ke baad; `storageOption: local` par hamesha registry id (online backup → local restore ke baad purana cloud id mat use karo) */
    const storageOptionLocal = String((company as CloudBackedCompanyShape)?.storageOption || "").toLowerCase() === "local";
    const fsCompanyId = storageOptionLocal
      ? String(companyId || "").trim() || companyId
      : String(
          (company as CloudBackedCompanyShape)?.authoritativeCompanyId || companyId || ""
        ).trim() || companyId;

    /** Data tick OFF → Local SQLite dikhao; Firestore masters/vouchers pull/upload band (all platforms). */
    const cloudLedgerSyncAllowed = isOnlineCompanyLedgerCloudSyncAllowed(
      companyId,
      company as Parameters<typeof isOnlineCompanyLedgerCloudSyncAllowed>[1]
    );

    const allCollectionsToPrefetch: MasterCollectionConfig[] = [
      { path: "vouchers", setter: setVouchers, orderByField: "date" },
      { path: "parties", setter: setParties },
      { path: "staff", setter: setStaff },
      { path: "bank_accounts", setter: setAccounts },
      { path: "taxes", setter: setTaxes },
      { path: "expense_accounts", setter: setUnprocessedExpenseAccounts },
      { path: "items", setter: setItems },
      { path: "item_groups", setter: setItemGroups },
      { path: "groups", setter: setGroups },
      { path: "account_groups", setter: setAccountGroups },
      { path: "staff_groups", setter: setStaffGroups },
      { path: "tax_groups", setter: setTaxGroups },
      { path: "expense_groups", setter: setExpenseGroups },
    ];
    /** Active page collections hi prefetch/listen — nested voucher dialog par full voucher-form scope. */
    const routePathForBootstrap = pathnameForWipeGuardRef.current || pathname;
    const activeCollectionPaths = activeMasterCollectionPathsForRoute(
      routePathForBootstrap,
      voucherFormMasterScope
    );
    const collectionsToPrefetch = allCollectionsToPrefetch.filter((c) => activeCollectionPaths.has(c.path));

    // Pure offline row: Firestore try mat karo — warna getDoc fail / empty se web jaisa reset ho sakta hai
    const isExplicitLocalRegistryRow =
      isServerGateCompanyContext ||
      (shouldUseLocalCompanyData &&
        (companyRowUsesSqliteLedgerWrites(company) || sqliteLedgerRouteHint.usesSqlite));

    /** Company switch / unmount: SQLite callbacks must not write after teardown. */
    let cancelled = false;
    const loadEpoch = companyDataLoadEpochRef.current;

    const skipWarmSqlitePath = (path: string) =>
      keepWarmUi && sqliteCollectionWarmWithRows(path);

    const applySqliteRows = <T,>(
      setter: StateSetter<T>,
      cached: T[],
      orderByField?: string,
      collectionPath?: string
    ) => {
      if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
      const next = sqliteCachedRowsForSetter(cached as any[], orderByField) as T[];
      // Company switch / cold: REPLACE. Same-company late read after warm: merge so in-flight save na mite.
      // Cross-company merge (prev A + next B) = Recent Txn 100+150 mix — refresh pe theek.
      setter((prev) => {
        if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return prev;
        const prevAlive = (prev as any[]).filter(isAliveDoc);
        if (!prevAlive.length || !hasWarmLedgerDataRef.current) {
          return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, next as any[])) as any;
        }
        const merged = mergeEntityListsByIdOrKeepPrev(prevAlive, next as any[], orderByField) as any[];
        // Warm sqlite/lite projection `isApproved` drop karta tha — party approve ke baad bank/staff pink reh jata.
        return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, merged)) as any;
      });
      if (collectionPath && !cancelled && loadEpoch === companyDataLoadEpochRef.current) {
        warmSqliteCollectionPathsRef.current.add(collectionPath);
      }
    };

    /* FREEZE: dashboard lite SQLite paint before full voucher parse — AGENTS.md dashboard boot freeze. */
    const dashboardVouchersOnly = isDashboardVouchersOnlyPrefetch(
      routePathForBootstrap,
      collectionsToPrefetch
    );
    let sqliteBootReadyMarked = false;
    const markSqliteBootReady = () => {
      if (sqliteBootReadyMarked || cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
      sqliteBootReadyMarked = true;
      hasWarmLedgerDataRef.current = true;
      setLoadingIfChanged(false);
    };
    const markDashboardLitePainted = () => {
      if (!dashboardVouchersOnly) return;
      markSqliteBootReady();
    };
    const isSqliteStale = () => cancelled || loadEpoch !== companyDataLoadEpochRef.current;
    const makeVouchersSqliteLoader = (setter: StateSetter<any>, orderByField?: string) =>
      loadVouchersFromSqliteFastFirst({
        companyId,
        setter,
        orderByField,
        applySqliteRows,
        isStale: isSqliteStale,
        onLiteApplied: markDashboardLitePainted,
      });
    const runSqlitePrefetchSplit = (
      loadSqliteChunk: (items: typeof collectionsToPrefetch) => Promise<void>,
      critical: typeof collectionsToPrefetch,
      secondary: typeof collectionsToPrefetch
    ) => {
      if (dashboardVouchersOnly) {
        void loadSqliteChunk(collectionsToPrefetch).finally(() => {
          markSqliteBootReady();
        });
        return;
      }
      void loadSqliteChunk(critical).finally(() => {
        markSqliteBootReady();
      });
      void loadSqliteChunk(secondary);
    };

    // Pocket Ledger Server (PocketBase) companies: lists read the local SQLite mirror; the server pull
    // updates it and bumps `pl_server_pull`, so no Firestore listeners / pulls for these.
    const pocketBaseLedgerCompany = isPocketBaseCompany(companyId, companyRef.current);
    if (isExplicitLocalRegistryRow || pocketBaseLedgerCompany) {
    if (!keepWarmUi) setLoadingIfChanged(true);
      // Tier-1: masters only — `vouchers` SQLite read (JSON parse) hazaar+ rows par EXE me 30–90s lagata; spinner tab tak band na ho.
      // Vouchers secondary chunk me: parties list pehle paint, totals snapshot/listeners ke baad refresh.
      const CRITICAL_SQLITE_PATHS = new Set(["parties", "groups", "bank_accounts", "expense_accounts"]);
      const loadSqliteChunk = (items: typeof collectionsToPrefetch): Promise<void> =>
        Promise.all(
          items.map(({ path, setter, orderByField }) =>
            (skipWarmSqlitePath(path)
              ? Promise.resolve()
              : path === "vouchers"
              ? makeVouchersSqliteLoader(setter, orderByField)
              : listCompanyDocsFromBrowserDb(companyId, path, { forBackupMerge: true })
                  .then((cached) => {
                    applySqliteRows(setter, cached, orderByField, path);
                  })
                  .catch(() => {}))
          )
        ).then(() => undefined);
      const critical = collectionsToPrefetch.filter((c) => CRITICAL_SQLITE_PATHS.has(c.path));
      const secondary = collectionsToPrefetch.filter((c) => !CRITICAL_SQLITE_PATHS.has(c.path));
      runSqlitePrefetchSplit(loadSqliteChunk, critical, secondary);
      return () => {
        cancelled = true;
      };
    }

    // Local APK: har online / ambiguous row ke liye pehle SQLite, phir server doc check — purane SQLite me syncedFromCloud missing ho to bhi cloud data milega
    if (shouldUseLocalCompanyData) {
    if (!keepWarmUi) setLoadingIfChanged(true);
      // EXE/static: `vouchers` mirror = sabse bada table — ise critical me mat rakho warna Promise.all yahi pe minute leta hai.
      // Pehle parties/groups/staff/taxes/banks + expense_accounts; vouchers + items baaki secondary chunk (loading tab tak band).
      const CRITICAL_SQLITE_PATHS = new Set([
        "parties",
        "groups",
        "bank_accounts",
        "staff",
        "taxes",
        "expense_accounts",
      ]);
      const loadSqliteChunk = (items: typeof collectionsToPrefetch): Promise<void> =>
        Promise.all(
          items.map(({ path, setter, orderByField }) =>
            (skipWarmSqlitePath(path)
              ? Promise.resolve()
              : path === "vouchers"
              ? makeVouchersSqliteLoader(setter, orderByField)
              : listCompanyDocsFromBrowserDb(companyId, path, { forBackupMerge: true })
                  .then((cached) => {
                    applySqliteRows(setter, cached, orderByField, path);
                  })
                  .catch(() => {}))
          )
        ).then(() => undefined);
      const critical = collectionsToPrefetch.filter((c) => CRITICAL_SQLITE_PATHS.has(c.path));
      const secondary = collectionsToPrefetch.filter((c) => !CRITICAL_SQLITE_PATHS.has(c.path));
      runSqlitePrefetchSplit(loadSqliteChunk, critical, secondary);
    }

    if (shouldReadLedgerFromSqliteOnly(companyRef.current as Parameters<typeof shouldReadLedgerFromSqliteOnly>[0])) {
      return () => {
        cancelled = true;
      };
    }

    const allowCollectionLiveListeners =
      cloudLedgerSyncAllowed && shouldBindFirebaseLedgerCollectionLiveListeners();
    if (!allowCollectionLiveListeners) {
      stableLiveVoucherListenerRef.current?.unsubscribe();
      stableLiveVoucherListenerRef.current = null;
    }

    /**
     * deltaa (web/EXE/APK/iOS): SQLite UI + one-shot getDocs transport pull.
     * No collection `onSnapshot` — remote edits only via `_pl_change_log`.
     */
    if (!allowCollectionLiveListeners) {
      if (!shouldUseLocalCompanyData && !isExplicitLocalRegistryRow) {
        if (!keepWarmUi) setLoadingIfChanged(true);
        const CRITICAL_SQLITE_PATHS = new Set([
          "parties",
          "groups",
          "bank_accounts",
          "staff",
          "taxes",
          "expense_accounts",
        ]);
        const loadSqliteChunk = (items: typeof collectionsToPrefetch): Promise<void> =>
          Promise.all(
            items.map(({ path, setter, orderByField }) =>
              skipWarmSqlitePath(path)
                ? Promise.resolve()
                : path === "vouchers"
                  ? makeVouchersSqliteLoader(setter, orderByField)
                  : listCompanyDocsFromBrowserDb(companyId, path, { forBackupMerge: true })
                      .then((cached) => {
                        if (!cached) return;
                        applySqliteRows(setter, cached, orderByField, path);
                      })
                      .catch(() => {})
            )
          ).then(() => undefined);
        const critical = collectionsToPrefetch.filter((c) => CRITICAL_SQLITE_PATHS.has(c.path));
        const secondary = collectionsToPrefetch.filter((c) => !CRITICAL_SQLITE_PATHS.has(c.path));
        runSqlitePrefetchSplit(loadSqliteChunk, critical, secondary);
      } else if (!cancelled && loadEpoch === companyDataLoadEpochRef.current) {
        hasWarmLedgerDataRef.current = true;
        setLoadingIfChanged(false);
      }

      const online =
        typeof navigator === "undefined" || navigator.onLine !== false;
      // deltaa / no collection listeners: one-shot Firestore → SQLite + UI when Data tick is on.
      if (
        cloudLedgerSyncAllowed &&
        online &&
        isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape)
      ) {
        void (async () => {
          const CONCURRENCY = 4;
          for (let i = 0; i < collectionsToPrefetch.length; i += CONCURRENCY) {
            if (cancelled) break;
            const chunk = collectionsToPrefetch.slice(i, i + CONCURRENCY);
            await Promise.all(
              chunk.map(async ({ path, setter, orderByField }) => {
                try {
                  const remoteData = await pullCompanySubcollectionFromFirestoreToLocalDb(
                    fsCompanyId,
                    companyId,
                    path,
                    companyRef.current,
                    orderByField
                  );
                  if (cancelled || !remoteData.length) return;
                  commitCollectionListSetter(
                    path,
                    setter,
                    sqliteCachedRowsForSetter(remoteData, orderByField) as any[]
                  );
                  notifyBrowserDbCollectionUpdated(companyId, path, {
                    immediate: true,
                    source: "firebase_delta_pull",
                  });
                } catch {
                  /* change-feed will retry per-doc */
                }
              })
            );
          }
        })();
      }

      return () => {
        cancelled = true;
      };
    }

    // Hybrid Firestore ↔ SQLite — live mode only (collection onSnapshot).
    const unsubRef = { current: [] as (() => void)[] };

    const companyRootDocRef = doc(firestore, "companies", fsCompanyId);

    /** Static/APK/local-first: offline jaisa SQLite pehle; online par bhi getDocFromServer gate mat lagao. */
    const embeddedLocalFirstBoot =
      isStaticAppBuild() ||
      (typeof window !== "undefined" && isCapacitorNativeApp()) ||
      isLocalOnlyMode();

    /** `firestoreRemotePullAttempt`: root server verify ke baad hi Firestore→SQLite ek baar pull; offline native par false */
    const bindHybridFirestoreToCompany = (opts: { firestoreRemotePullAttempt: boolean }) => {
      if (cancelled) return;
      const routeScopedPrefetchCollections = collectionsToPrefetch.filter((c) => c.path !== "vouchers");
      // Cloud firebase company ko bhi mirror chahiye: purane guard me sirf `storageOption===local`/static — offline par SQLite khali → sirf wo screens jahan pehle online snapshot mila usable tha (PWA/APK overlap).
      // Web cloud boot: the live listeners below already download AND mirror every collection to SQLite, so this extra full getDocs is skipped there.
      // SQLite-first builds (APK/EXE static/local-only) keep it so the offline mirror is ready before listeners attach.
      const shouldSqliteHydratePullFromFirestore =
        embeddedLocalFirstBoot &&
        cloudLedgerSyncAllowed &&
        opts.firestoreRemotePullAttempt &&
        (shouldUseLocalCompanyData || isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape));

      // Initial full-collection `getDocs` parallel (chunked): sequential wait se user offline hue to adhuri mirror (# critical paths only pehle nahi poora bootstrap).
      if (shouldSqliteHydratePullFromFirestore) {
        void (async () => {
          const CONCURRENCY = 4;
          for (let i = 0; i < routeScopedPrefetchCollections.length; i += CONCURRENCY) {
            if (cancelled) break;
            const chunk = routeScopedPrefetchCollections.slice(i, i + CONCURRENCY);
            await Promise.all(
              chunk.map(async ({ path, setter, orderByField }) => {
                try {
                  const remoteData = await pullCompanySubcollectionFromFirestoreToLocalDb(
                    fsCompanyId,
                    companyId,
                    path,
                    companyRef.current,
                    orderByField
                  );
                  if (!remoteData.length) return;
                  if (!cancelled) {
                    commitCollectionListSetter(
                      path,
                      setter,
                      sqliteCachedRowsForSetter(remoteData, orderByField) as any[]
                    );
                  }
                } catch {
                  /* onSnapshot neeche incremental mirror */
                }
              })
            );
          }
        })();
      }
      if (!shouldUseLocalCompanyData && !embeddedLocalFirstBoot && vouchers.length === 0) setLoadingIfChanged(true);

      const attachListeners = () => {
        if (cancelled) return;
      const allCollectionsToFetch: MasterCollectionConfig[] = [
      { path: 'vouchers', setter: setVouchers, isGroup: false, orderByField: 'date' },
      { path: 'parties', setter: setParties },
      { path: 'staff', setter: setStaff },
      { path: 'bank_accounts', setter: setAccounts },
      { path: 'taxes', setter: setTaxes },
      { path: 'expense_accounts', setter: setUnprocessedExpenseAccounts },
      { path: 'items', setter: setItems },
      { path: 'item_groups', setter: setItemGroups },
      { path: 'groups', setter: setGroups },
      { path: 'account_groups', setter: setAccountGroups },
      { path: 'staff_groups', setter: setStaffGroups },
      { path: 'tax_groups', setter: setTaxGroups },
      { path: 'expense_groups', setter: setExpenseGroups },
    ];
      /** Listener sirf active page collections par bind — route switch par cleanup + naya bind. */
      const stableVoucherCollection = allCollectionsToFetch.find((c) => c.path === "vouchers");
      const collectionsToFetch = allCollectionsToFetch.filter(
        (c) =>
          c.path !== "vouchers" &&
          activeCollectionPaths.has(c.path) &&
          isLiveCollectionListenerEnabled(c.path)
      );

      /** Full-collection listener — web cloud par bhi poori voucher list (50-cap window hataya). */
      const collectionListenerQuery = (path: string, isGroup: boolean | undefined) => {
        if (isGroup) {
          return query(collectionGroup(firestore, path), where("companyId", "==", fsCompanyId));
        }
        return query(collection(firestore, `companies/${fsCompanyId}/${path}`));
      };

      const bindCollectionListener = (
        { path, setter, isGroup, orderByField }: MasterCollectionConfig,
        opts?: { stableKey?: string; onFirstResult?: () => void }
      ) => {
        const q = collectionListenerQuery(path, isGroup);
        // Decrypted rows cached per listener: later snapshots only re-decrypt docs that actually changed (docChanges), not the whole collection.
        const decryptedById = new Map<string, any>();
        let decryptChain: Promise<void> = Promise.resolve();
        let decryptSeeded = false;
        return onSnapshot(q, (snapshot) => {
          opts?.onFirstResult?.();
          if (cancelled && !opts?.stableKey) return;
          if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
          const co = companyRef.current;
          const cryptoCtx = co ? { encryptServerBackupSalt: co.encryptServerBackupSalt } : null;
          void (async () => {
            // Serialized so overlapping snapshots cannot apply their changes out of order.
            const decryptStep = decryptChain.then(async () => {
              const changedDocs = decryptSeeded
                ? snapshot.docChanges().filter((ch) => ch.type !== "removed").map((ch) => ch.doc)
                : snapshot.docs;
              if (decryptSeeded) {
                snapshot.docChanges().forEach((ch) => {
                  if (ch.type === "removed") decryptedById.delete(ch.doc.id);
                });
              } else {
                decryptedById.clear();
              }
              const decrypted = await Promise.all(
                changedDocs.map(async (d) => {
                  const raw = { ...d.data(), id: d.id } as Record<string, unknown> & { id: string };
                  // SDK pending (unacknowledged) write => not server-backed; stamp skips it (localMirrorServerMeta).
                  if (d.metadata.hasPendingWrites) raw.__plSdkPendingWrite = true;
                  return { id: d.id, row: await decryptFirestoreCompanyDocIfNeeded(raw, cryptoCtx, companyId) };
                })
              );
              for (const { id, row } of decrypted) {
                if (row == null) decryptedById.delete(id);
                else decryptedById.set(id, row);
              }
              decryptSeeded = true;
            });
            decryptChain = decryptStep.catch(() => {
              decryptSeeded = false;
            });
            await decryptStep;
            const data = Array.from(decryptedById.values()).filter((item: any) => item.isDeleted !== true);
            if (cancelled && !opts?.stableKey) return;
            if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
            if (orderByField) {
              data.sort((a: any, b: any) => {
                const dateA = parseFirestoreDateFieldToJsDate(a[orderByField])?.getTime() ?? 0;
                const dateB = parseFirestoreDateFieldToJsDate(b[orderByField])?.getTime() ?? 0;
                return dateA - dateB;
              });
            }
            let dataForUi = data;
            if (!isGroup) {
              const preferLocal =
                String(companyRef.current?.storageOption || "").toLowerCase() === "local";
              let skipOrphanSqliteDelete = false;
              try {
                const { isCompanyPendingRestoreCloudPush } = await import(
                  "@/lib/restoreCloudBackgroundSync"
                );
                skipOrphanSqliteDelete = isCompanyPendingRestoreCloudPush(companyId);
              } catch {
                /* optional */
              }
              dataForUi = await mergeRemoteSnapshotWithLocalOnlyDocs(companyId, path, data, orderByField, {
                preferLocalSqliteWhenIdsConflict: preferLocal || skipOrphanSqliteDelete,
                skipOrphanSqliteDelete,
              });
            }
            const rowsForSetter = Array.isArray(dataForUi)
              ? dataForUi.map(stripMirrorMetaForEntityListRow)
              : dataForUi;
            // Har synced cloud company ke liye `company_docs` me debounced bake — airplane mode par pura ledger/masters SQLite se (sirf jo screen kholi thi wala data nahi).
            const persistSqliteFromSnap =
              !isGroup &&
              (shouldUseLocalCompanyData ||
                isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape));
            // SQLite is the UI source on web + EXE + APK. Firestore snapshot is transport only.
            // Old web-live path painted `rowsForSetter` (server snapshot) → F5: local narration 1s, then revert.
            const sqliteUiFirst = persistSqliteFromSnap && !isGroup;
            if (sqliteUiFirst) {
              await mirrorCollectionDocsToBrowserDbSilent(companyId, path, dataForUi, {
                cloudBackedOfflineCache: persistSqliteFromSnap && !shouldUseLocalCompanyData,
              });
              if (cancelled && !opts?.stableKey) return;
              if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
              const commitSqliteRowsToUi = async () => {
                if (cancelled && !opts?.stableKey) return;
                if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
                try {
                  const cached = await listCompanyCollectionForVoucherUi(companyId, path);
                  const alive = (cached as any[]).filter((x) => x?.isDeleted !== true);
                  commitCollectionListSetter(path, setter, sqliteCachedRowsForSetter(alive, orderByField));
                } catch {
                  commitCollectionListSetter(path, setter, rowsForSetter);
                }
              };
              if (embeddedClientPrefersQuietBackgroundSync()) {
                const uiDebounceKey = `${companyId}::${path}::sqlite-ui`;
                clearTimeout(mirrorSnapshotTimersRef.current[uiDebounceKey]);
                mirrorSnapshotTimersRef.current[uiDebounceKey] = setTimeout(() => {
                  void commitSqliteRowsToUi();
                }, embeddedSqliteBumpDebounceMs(pathname));
              } else {
                await commitSqliteRowsToUi();
              }
            } else {
              // Snapshot = puri subcollection (Recent / dashboard dono ke liye sahi totals) — web hybrid default.
              commitCollectionListSetter(path, setter, rowsForSetter);
              if (persistSqliteFromSnap) {
                const debounceKey = `${companyId}::${path}`;
                clearTimeout(mirrorSnapshotTimersRef.current[debounceKey]);
                mirrorSnapshotTimersRef.current[debounceKey] = setTimeout(() => {
                  void mirrorCollectionDocsToBrowserDbSilent(companyId, path, dataForUi, {
                    cloudBackedOfflineCache: persistSqliteFromSnap && !shouldUseLocalCompanyData,
                  });
                }, 500);
              }
            }
          })();
        }, (error: any) => {
          opts?.onFirstResult?.();
          try {
            if (error?.code === 'unavailable' || error?.code === 'deadline-exceeded' || error?.message?.includes('network')) {
              listCompanyCollectionForVoucherUi(companyId, path)
                .then((cached) => {
                  if ((cancelled && !opts?.stableKey) || !cached.length) return;
                  if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
                  setter((prev) => mergeEntityListsByIdOrKeepPrev(prev, cached, orderByField));
                })
                .catch(() => {});
              return;
            }
            if (error?.code === 'permission-denied' || error?.code === 'PERMISSION_DENIED' || (error?.message && String(error.message).includes('permission'))) {
              console.warn(`[PERMISSION_DENIED TRACK] source=useVouchers path=companies/${companyId}/${path}`, { companyId, path, code: error?.code });
              if (isLocalOnlyMode()) {
                console.warn(`[Firestore] PERMISSION_DENIED in local mode for path: companies/${companyId}/${path}. Skipping clearCompanyId to keep current screen stable.`);
                return;
              }
              const co = companyRef.current;
              if (!co) {
                console.warn(`[Firestore] PERMISSION_DENIED but company not loaded yet – skipping clear to avoid Settings redirect.`);
                return;
              }
              const isOwner = co.ownerId === user?.uid || (!!co.ownerEmail && !!user?.email && co.ownerEmail.toLowerCase().trim() === user.email.toLowerCase().trim());
              if (!isOwner) {
                if (shouldSuppressTransientCompanyClear()) {
                  console.warn(
                    `[Firestore] PERMISSION_DENIED (shared user): skip clearCompanyId during APK save shield — companies/${companyId}/${path}`
                  );
                  return;
                }
                // EXE/static shared user: SQLite mirror se padho — clearCompanyId → auto-select loop (React #185) avoid.
                if (isStaticApkLedgerTransportMode() || isElectronDesktopApp()) {
                  console.warn(
                    `[Firestore] PERMISSION_DENIED (shared user): SQLite fallback, skip clearCompanyId — companies/${companyId}/${path}`
                  );
                  listCompanyCollectionForVoucherUi(companyId, path)
                    .then((cached) => {
                      if ((cancelled && !opts?.stableKey) || !cached.length) return;
                      if (opts?.stableKey && stableLiveVoucherListenerRef.current?.key !== opts.stableKey) return;
                      setter((prev) => mergeEntityListsByIdOrKeepPrev(prev, cached, orderByField));
                    })
                    .catch(() => {});
                  return;
                }
                console.warn(`[Firestore] PERMISSION_DENIED for path: companies/${companyId}/${path}. Clearing invalid company selection.`, { companyId, path });
                try { clearCompanyId(); } catch (_) {}
              } else {
                console.warn(`[Firestore] PERMISSION_DENIED for path: companies/${companyId}/${path}. You are owner – check Firestore rules deploy or auth.`, { companyId, path });
              }
              return;
            }
            console.error(`Error fetching ${path}:`, error?.message || error);
          } catch (_) {}
        });
      };

      const stableVoucherKey = `${companyId}::${fsCompanyId}::${user?.uid || ""}::live-vouchers`;
      if (
        stableVoucherCollection &&
        activeCollectionPaths.has("vouchers") &&
        isLiveCollectionListenerEnabled("vouchers")
      ) {
        if (stableLiveVoucherListenerRef.current?.key !== stableVoucherKey) {
          stableLiveVoucherListenerRef.current?.unsubscribe();
          stableLiveVoucherListenerRef.current = {
            key: stableVoucherKey,
            unsubscribe: bindCollectionListener(stableVoucherCollection, { stableKey: stableVoucherKey }),
          };
        }
      } else if (stableLiveVoucherListenerRef.current) {
        stableLiveVoucherListenerRef.current.unsubscribe();
        stableLiveVoucherListenerRef.current = null;
      }

      // The same listener reports its first snapshot/error, so no second onSnapshot per collection is needed just to clear loading.
      const unsubscribersPending: Array<() => void> = [];
      const initialFetches = collectionsToFetch.map((config) => new Promise<boolean>((resolve) => {
        let done = false;
        const onFirstResult = () => { if (!done) { done = true; resolve(true); } };
        unsubscribersPending.push(bindCollectionListener(config, { onFirstResult }));
      }));
      const unsubscribers = unsubscribersPending;
      unsubRef.current = unsubscribers;

      const coPrefetch = companyRef.current;
      const prefetchFromSqlite =
        shouldUseLocalCompanyData ||
        String(coPrefetch?.storageOption || "").toLowerCase() === "firebase";
      if (prefetchFromSqlite) {
        for (const { path: p, setter: setCol, orderByField: obf } of collectionsToFetch) {
          listCompanyCollectionForVoucherUi(companyId, p)
            .then((cached) => {
              if (cancelled || !cached.length) return;
              const alive = (cached as any[]).filter((x) => x?.isDeleted !== true);
              setCol((prev) =>
                mergeEntityListsByIdOrKeepPrev(prev, obf ? sortDocsByDateField(alive, obf) : alive, obf)
              );
            })
            .catch(() => {});
        }
      }

      if (embeddedLocalFirstBoot) {
        // SQLite / stale-first pehle paint — saari collection snapshots ka wait mat karo.
        if (!cancelled) {
          hasWarmLedgerDataRef.current = true;
          setLoadingIfChanged(false);
        }
      } else {
        Promise.all(initialFetches).then(() => {
          if (!cancelled) {
            hasWarmLedgerDataRef.current = true;
            setLoadingIfChanged(false);
          }
        });
      }
      };
      const firestoreListenDelayMs =
        shouldUseLocalCompanyData || embeddedLocalFirstBoot ? 0 : 600;
      setTimeout(attachListeners, firestoreListenDelayMs);
    };

    // Airplane / cold wifi off: `firebase` storage company ko bhi pehle mirror hydrate —
    // warna sirf UI; `getDocFromServer` fail → niche catch tak bind kabhi lagta hi nahi tha (masters khali).
    const hydrateFromMirrorWhenOffline =
      typeof navigator !== "undefined" && navigator.onLine === false;

    if (hydrateFromMirrorWhenOffline || embeddedLocalFirstBoot) {
      bindHybridFirestoreToCompany({
        firestoreRemotePullAttempt:
          cloudLedgerSyncAllowed &&
          (shouldUseLocalCompanyData || isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape)),
      });
    } else {
      // Data untick: stay on Local SQLite — no company-root server verify / Firestore bind.
      if (!cloudLedgerSyncAllowed) {
        const loadLocalOnlyMasters = (): Promise<void> =>
          Promise.all(
            collectionsToPrefetch.map(({ path, setter, orderByField }) =>
              skipWarmSqlitePath(path)
                ? Promise.resolve()
                : path === "vouchers"
                  ? makeVouchersSqliteLoader(setter, orderByField)
                  : listCompanyDocsFromBrowserDb(companyId, path, { forBackupMerge: true })
                      .then((cached) => {
                        applySqliteRows(setter, cached, orderByField, path);
                      })
                      .catch(() => {})
            )
          ).then(() => undefined);
        void loadLocalOnlyMasters().finally(() => {
          if (!cancelled && loadEpoch === companyDataLoadEpochRef.current) {
            hasWarmLedgerDataRef.current = true;
            setLoadingIfChanged(false);
          }
        });
        return () => {
          cancelled = true;
        };
      }
      getDocFromServer(companyRootDocRef)
        .then((snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            console.log("Company doc not in Firestore yet... skipping listeners.");
            setLoadingIfChanged(false);
            if (!shouldUseLocalCompanyData) {
              resetAllStates();
            }
            return;
          }
          const data = snap.data();
          const docOwnerId = data?.ownerId ?? "";
          const docOwnerEmail = (data?.ownerEmail ?? "").toString().toLowerCase().trim();
          const userEmail = (user?.email ?? "").toLowerCase().trim();
          // Company doc me malformed `sharedWithEmails` aaye to `.map` crash se loading loop avoid.
          const sharedRaw = Array.isArray((data as any)?.sharedWithEmails)
            ? ((data as any).sharedWithEmails as unknown[])
            : [];
          const sharedEmails: string[] = sharedRaw.map((e) => String(e).toLowerCase().trim());
          const isOwner = docOwnerId === user?.uid || docOwnerEmail === userEmail;
          const isShared = userEmail && sharedEmails.includes(userEmail);
          if (!isOwner && !isShared) {
            console.log(
              "Company doc owner mismatch or not shared with user... skipping listeners."
            );
            setLoadingIfChanged(false);
            if (!shouldUseLocalCompanyData) {
              resetAllStates();
            }
            return;
          }
          bindHybridFirestoreToCompany({
            firestoreRemotePullAttempt:
              cloudLedgerSyncAllowed &&
              (shouldUseLocalCompanyData ||
                isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape)),
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const ec = typeof err === "object" && err !== null ? (err as { code?: string }).code : "";
          const msg =
            typeof err === "object" && err !== null ? String((err as Error).message || "") : "";
          const networkLike =
            (typeof navigator !== "undefined" && navigator.onLine === false) ||
            ec === "unavailable" ||
            ec === "deadline-exceeded" ||
            ec === "failed-precondition" ||
            msg.toLowerCase().includes("network") ||
            msg.toLowerCase().includes("failed to fetch");

          // APK local company + stale build path (purana guard) + reachable-Firestore-fail mirrors
          if (networkLike || (shouldUseLocalCompanyData && isStaticAppBuild())) {
            bindHybridFirestoreToCompany({
              firestoreRemotePullAttempt:
                cloudLedgerSyncAllowed &&
                (networkLike
                  ? false
                  : shouldUseLocalCompanyData ||
                    isCloudBackedCompany(companyRef.current as CloudBackedCompanyShape)),
            });
            return;
          }
          // Non-network rejection: bind mat karo; spinner band
          setLoadingIfChanged(false);
        });
    }

    return () => {
      cancelled = true;
      for (const t of Object.values(mirrorSnapshotTimersRef.current)) clearTimeout(t);
      mirrorSnapshotTimersRef.current = {};
      unsubRef.current.forEach(u => u());
      unsubRef.current = [];
    };
  }, [companyId, voucherListenerCompanyKey, user?.uid, user?.email, authLoading, localAuthEpoch, ledgerSyncModeEpoch, onlineSyncPrefsEpoch, ledgerBootstrapActive, voucherFormMasterScope, sqliteLedgerRouteHint.usesSqlite, sqliteLedgerRouteHint.ownerMatchesUser, company?.id, company?.storageOption, company?.syncPolicy, company?.syncedFromCloud, company?.ownerId, company?.ownerEmail, sharedWithEmailsKey, setLoadingIfChanged]);

  // Sidebar/route change: pehle se warm company pe missing masters hi SQLite se — full teardown/spinner mat.
  useEffect(() => {
    if (authLoading || !companyId || !user) return;
    if (!ledgerBootstrapActive) return;
    if (lastCompanyIdRef.current !== companyId) return;

    const allCollectionsToPrefetch: MasterCollectionConfig[] = [
      { path: "vouchers", setter: setVouchers, orderByField: "date" },
      { path: "parties", setter: setParties },
      { path: "staff", setter: setStaff },
      { path: "bank_accounts", setter: setAccounts },
      { path: "taxes", setter: setTaxes },
      { path: "expense_accounts", setter: setUnprocessedExpenseAccounts },
      { path: "items", setter: setItems },
      { path: "item_groups", setter: setItemGroups },
      { path: "groups", setter: setGroups },
      { path: "account_groups", setter: setAccountGroups },
      { path: "staff_groups", setter: setStaffGroups },
      { path: "tax_groups", setter: setTaxGroups },
      { path: "expense_groups", setter: setExpenseGroups },
    ];
    const needed = activeMasterCollectionPathsForRoute(pathname, voucherFormMasterScope);
    const missing = allCollectionsToPrefetch.filter(
      (c) => needed.has(c.path) && !sqliteCollectionWarmWithRows(c.path)
    );
    if (!missing.length) return;

    let cancelled = false;
    const loadEpoch = companyDataLoadEpochRef.current;
    const applySqliteRows = <T,>(
      setter: StateSetter<T>,
      cached: T[],
      orderByField?: string,
      collectionPath?: string
    ) => {
      if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
      const next = sqliteCachedRowsForSetter(cached as any[], orderByField) as T[];
      setter((prev) => {
        if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return prev;
        const prevAlive = (prev as any[]).filter(isAliveDoc);
        if (!prevAlive.length || !hasWarmLedgerDataRef.current) {
          return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, next as any[])) as any;
        }
        const merged = mergeEntityListsByIdOrKeepPrev(prevAlive, next as any[], orderByField) as any[];
        // Warm sqlite/lite projection `isApproved` drop karta tha — party approve ke baad bank/staff pink reh jata.
        return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, merged)) as any;
      });
      if (collectionPath && !cancelled && loadEpoch === companyDataLoadEpochRef.current) {
        warmSqliteCollectionPathsRef.current.add(collectionPath);
      }
    };

    const loadOne = async ({ path, setter, orderByField }: MasterCollectionConfig) => {
      if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
      if (path === "vouchers") {
        try {
          const lite = await listVoucherSummaryProjectionFromBrowserDb(companyId, { forBackupMerge: true });
          if (!cancelled && loadEpoch === companyDataLoadEpochRef.current && lite.length) {
            applySqliteRows(
              setter,
              lite.map((r) => ({
                id: r.id,
                type: r.type || "sale",
                date: r.date || null,
                amount: Number(r.amount || 0),
              })),
              orderByField
            );
          }
        } catch {
          /* ignore */
        }
        if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
        try {
          const cached = await listVoucherMirrorRowsIncrementally(companyId);
          applySqliteRows(setter, cached, orderByField, path);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        const cached = await listCompanyDocsFromBrowserDb(companyId, path, { forBackupMerge: true });
        applySqliteRows(setter, cached, orderByField, path);
      } catch {
        /* ignore */
      }
    };

    const yieldToPaint = () =>
      new Promise<void>((resolve) => {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });

    void (async () => {
      // Dashboard / full-route: saari missing collections ek saath mat — pehle vouchers, phir baaki yield ke saath
      // taaki sidebar click pe page turant paint ho (party/bank jaisa).
      const voucherFirst = missing.filter((c) => c.path === "vouchers");
      const rest = missing.filter((c) => c.path !== "vouchers");
      for (const c of voucherFirst) {
        await loadOne(c);
        if (cancelled) return;
      }
      for (const c of rest) {
        await yieldToPaint();
        if (cancelled) return;
        await loadOne(c);
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    pathname,
    voucherFormMasterScope,
    companyId,
    authLoading,
    parties.length,
    groups.length,
    user?.uid,
    ledgerBootstrapActive,
    dashboardTabScopeVersion,
  ]);

  // Party/Bank pe rehte hue bhi dashboard masters idle me warm — Dashboard/Reports/Gallery click pe missing load freeze na ho.
  useEffect(() => {
    if (authLoading || !companyId || !user) return;
    if (!ledgerBootstrapActive) return;
    if (lastCompanyIdRef.current !== companyId) return;
    if (!hasWarmLedgerDataRef.current) return;

    const allCollectionsToPrefetch: MasterCollectionConfig[] = [
      { path: "vouchers", setter: setVouchers, orderByField: "date" },
      { path: "parties", setter: setParties },
      { path: "staff", setter: setStaff },
      { path: "bank_accounts", setter: setAccounts },
      { path: "taxes", setter: setTaxes },
      { path: "expense_accounts", setter: setUnprocessedExpenseAccounts },
      { path: "items", setter: setItems },
      { path: "item_groups", setter: setItemGroups },
      { path: "groups", setter: setGroups },
      { path: "account_groups", setter: setAccountGroups },
      { path: "staff_groups", setter: setStaffGroups },
      { path: "tax_groups", setter: setTaxGroups },
      { path: "expense_groups", setter: setExpenseGroups },
    ];
    const neededPaths = activeMasterCollectionPathsForRoute(pathname, voucherFormMasterScope);
    const missing = allCollectionsToPrefetch.filter(
      (c) => neededPaths.has(c.path) && !sqliteCollectionWarmWithRows(c.path)
    );
    if (!missing.length) return;

    let cancelled = false;
    const loadEpoch = companyDataLoadEpochRef.current;
    const applySqliteRows = <T,>(
      setter: StateSetter<T>,
      cached: T[],
      orderByField?: string,
      collectionPath?: string
    ) => {
      if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
      const next = sqliteCachedRowsForSetter(cached as any[], orderByField) as T[];
      setter((prev) => {
        if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return prev;
        const prevAlive = (prev as any[]).filter(isAliveDoc);
        if (!prevAlive.length || !hasWarmLedgerDataRef.current) {
          return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, next as any[])) as any;
        }
        const merged = mergeEntityListsByIdOrKeepPrev(prevAlive, next as any[], orderByField) as any[];
        // Warm sqlite/lite projection `isApproved` drop karta tha — party approve ke baad bank/staff pink reh jata.
        return keepPrevIfSameUiList(prev as any[], applyLocalLedgerHoldsToVoucherList(prevAlive, merged)) as any;
      });
      if (collectionPath && !cancelled && loadEpoch === companyDataLoadEpochRef.current) {
        warmSqliteCollectionPathsRef.current.add(collectionPath);
      }
    };

    const yieldToPaint = () =>
      new Promise<void>((resolve) => {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });

    const run = async () => {
      for (const { path, setter, orderByField } of missing) {
        if (cancelled || loadEpoch !== companyDataLoadEpochRef.current) return;
        if (sqliteCollectionWarmWithRows(path)) continue;
        try {
          if (path === "vouchers") {
            const cached = await listCompanyCollectionForVoucherUi(companyId, path);
            applySqliteRows(setter, cached, orderByField, path);
          } else {
            const cached = await listCompanyCollectionForVoucherUi(companyId, path);
            applySqliteRows(setter, cached, orderByField, path);
          }
        } catch {
          /* ignore */
        }
        await yieldToPaint();
      }
    };

    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (cancelled) return;
      void run();
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(start, { timeout: 4000 });
    } else {
      timeoutHandle = setTimeout(start, 1800);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
    };
  }, [
    companyId,
    authLoading,
    loading,
    user?.uid,
    ledgerBootstrapActive,
    pathname,
    dashboardTabScopeVersion,
    voucherFormMasterScope,
  ]);

  // Single-doc / write-path upsert ke baad merge (notify) — collections ke hisaab se state update.
  useEffect(() => {
    const co = company as CloudBackedCompanyShape | null | undefined;
    const shouldListenSqliteBump =
      !!companyId &&
      (isLocalOnlyMode() ||
        companyRowUsesSqliteLedgerWrites(co as Parameters<typeof companyRowUsesSqliteLedgerWrites>[0]) ||
        sqliteLedgerRouteHint.usesSqlite ||
        isCloudBackedCompany(co) ||
        isServerGateCompanyContext);
      if (shouldSkipHeavyVoucherBootstrap(pathname)) return;
    if (!shouldListenSqliteBump) return;

    const mergeCollectionFromSqliteBump = (
      coll: string,
      opts?: { remoteIncoming?: boolean; reloadFromIdb?: boolean }
    ): Promise<void> => {
      livePullDevLog("react_refresh", {
        companyId,
        collection: coll,
        pathname,
        remoteIncoming: opts?.remoteIncoming === true,
      });
      const bumpCompanyId = String(companyId || "").trim();
      const bumpEpoch = companyDataLoadEpochRef.current;
      return (async () => {
        try {
          // Same-tab PL pull already wrote sql.js — full IDB export/reload freezes EXE (30–50s menu lag).
          // Cross-renderer host IPC clears cache before bump; listCompanyDocs reopens lazily.
          if (opts?.reloadFromIdb) {
            const { clearBrowserDbCache } = await import("@/lib/localSqlite");
            clearBrowserDbCache();
          }
          if (
            !bumpCompanyId ||
            bumpCompanyId !== String(companyIdForWipeGuardRef.current || "").trim() ||
            bumpEpoch !== companyDataLoadEpochRef.current
          ) {
            return;
          }
          const cached = await listCompanyCollectionForVoucherUi(bumpCompanyId, coll);
          if (
            bumpCompanyId !== String(companyIdForWipeGuardRef.current || "").trim() ||
            bumpEpoch !== companyDataLoadEpochRef.current
          ) {
            return;
          }
          if (!cached.length && !opts?.remoteIncoming) {
            if (opts?.remoteIncoming) {
              void import("@/lib/plServerLiveChangeTrace").then(({ plServerLiveChangeTrace }) =>
                plServerLiveChangeTrace("ui_merge_remote_empty", { companyId: bumpCompanyId, collection: coll })
              );
            }
            return;
          }
          const aliveCached = (cached as any[]).filter(isAliveDoc);
          if (coll === "vouchers" && companyId) {
            maybeQueueTransientAttachmentCleanup(companyId, aliveCached);
          }
          // Full company collection from SQLite = source of truth. Merge-with-prev cross-company mix karta hai
          // (A vouchers + B vouchers) jab stale bump company switch ke baad complete ho.
          const replaceRows = (rows: any[], orderByField?: string) => {
            const next = orderByField ? sortDocsByDateField(rows, orderByField) : rows;
            return next.map(stripMirrorMetaForEntityListRow);
          };
          switch (coll) {
            case "vouchers":
              if (opts?.remoteIncoming) allowEmptyVoucherWipeRef.current = true;
              try {
                const normalizedRows = replaceRows(
                  aliveCached.map((r) =>
                    normalizeVoucherRowAttachmentsForUi(r, voucherAttachmentUiNormalizeOptions())
                  ),
                  "date"
                );
                if (process.env.NODE_ENV !== "production") {
                  void import("@/lib/attachmentDeleteTrace").then((m) => {
                    for (const row of normalizedRows) {
                      const id = String((row as { id?: string })?.id || "").trim();
                      if (!id) continue;
                      const urls = Array.isArray((row as { fileUrls?: unknown }).fileUrls)
                        ? ((row as { fileUrls: string[] }).fileUrls || [])
                        : [];
                      if (urls.length === 0) continue;
                      m.traceAttachmentUrlsChange({
                        source: opts?.remoteIncoming
                          ? "useVouchers.sqliteBump.remoteIncoming"
                          : "useVouchers.sqliteBump",
                        companyId: bumpCompanyId,
                        voucherId: id,
                        prevUrls: [],
                        nextUrls: urls,
                        extra: { note: "non-empty fileUrls after sqlite bump (check REVIVE if intent was empty)" },
                      });
                    }
                  });
                }
                commitVouchersSetter(setVouchers, normalizedRows);
              } finally {
                if (opts?.remoteIncoming) allowEmptyVoucherWipeRef.current = false;
              }
              break;
            case "parties":
              commitEntityListSetter(setParties, replaceRows(aliveCached));
              break;
            case "staff":
              commitEntityListSetter(setStaff, replaceRows(aliveCached));
              break;
            case "bank_accounts":
              commitEntityListSetter(
                setAccounts,
                replaceRows(
                  aliveCached.map((row) => normalizeBankAccountRow(row as Record<string, unknown>))
                )
              );
              break;
            case "taxes":
              commitEntityListSetter(setTaxes, replaceRows(aliveCached));
              break;
            case "expense_accounts":
              commitEntityListSetter(setUnprocessedExpenseAccounts, replaceRows(aliveCached));
              break;
            case "items":
              commitEntityListSetter(setItems, replaceRows(aliveCached));
              break;
            case "item_groups":
              commitEntityListSetter(setItemGroups, replaceRows(aliveCached));
              break;
            case "groups":
              commitEntityListSetter(setGroups, replaceRows(aliveCached));
              break;
            case "account_groups":
              commitEntityListSetter(setAccountGroups, replaceRows(aliveCached));
              break;
            case "staff_groups":
              commitEntityListSetter(setStaffGroups, replaceRows(aliveCached));
              break;
            case "tax_groups":
              commitEntityListSetter(setTaxGroups, replaceRows(aliveCached));
              break;
            case "expense_groups":
              commitEntityListSetter(setExpenseGroups, replaceRows(aliveCached));
              break;
            default:
              break;
          }
          if (opts?.remoteIncoming) {
            void import("@/lib/plServerLiveChangeTrace").then(({ plServerLiveChangeTrace }) =>
              plServerLiveChangeTrace("ui_merge_remote_applied", {
                companyId: bumpCompanyId,
                collection: coll,
                rowCount: aliveCached.length,
              })
            );
          }
        } catch {
          /* optional merge */
        }
      })();
    };

    const mobilePullRefreshMergeEntry = {
      companyId: String(companyId || "").trim(),
      merge: (coll: string) => mergeCollectionFromSqliteBump(coll),
    };
    mobilePullRefreshMergeRef.current = mobilePullRefreshMergeEntry;

    const onBump = (ev: Event) => {
      const d = (ev as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!d || d.companyId !== companyId || !d.collection) return;
      const coll = d.collection;
      const refreshHold = mobilePullRefreshHoldRef.current;
      if (refreshHold?.companyId === d.companyId && refreshHold.collections.has(coll)) {
        refreshHold.pendingCollections.add(coll);
        return;
      }
      const remoteHostWrite = d.source === "pl_host_remote_write";
      const plServerPull = d.source === "pl_server_pull";
      const firebaseDeltaPull = d.source === "firebase_delta_pull";
      const remoteIncoming = remoteHostWrite || plServerPull || firebaseDeltaPull;
      if (remoteHostWrite || plServerPull) {
        void import("@/lib/plServerLiveChangeTrace")
          .then(({ plServerLiveChangeTrace }) =>
            plServerLiveChangeTrace("ui_merge_remote_bump", {
              companyId,
              collection: coll,
              source: d.source,
            })
          )
          .catch(() => undefined);
      }
      if (isServerGateCompanyContext || remoteIncoming) {
        const key = `${companyId}::${coll}`;
        const prevTimer = sqliteBumpMergeTimersRef.current[key];
        if (prevTimer) clearTimeout(prevTimer);
        sqliteBumpMergeTimersRef.current[key] = setTimeout(() => {
          delete sqliteBumpMergeTimersRef.current[key];
          mergeCollectionFromSqliteBump(coll, {
            remoteIncoming,
            reloadFromIdb: remoteHostWrite,
          });
        }, 80);
        return;
      }
      // Active page ke bahar collection bump ignore — unnecessary background merge avoid.
      // Dashboard/gallery: active paths vouchers-only ho sakte hain, lekin route bump list (masters) phir bhi merge ho.
      if (d.immediate === true) {
        mergeCollectionFromSqliteBump(coll, {
          remoteIncoming,
          reloadFromIdb: remoteHostWrite,
        });
        return;
      }
      const activePaths = activeMasterCollectionPathsForRoute(pathname, voucherFormMasterScope);
      const routeWantsBump = sqliteBumpCollectionNeededOnLedgerRoute(pathname, coll);
      if (!activePaths.has(coll) && !routeWantsBump) return;
      if (
        embeddedClientPrefersQuietBackgroundSync() &&
        !routeWantsBump &&
        !activePaths.has(coll)
      ) {
        return;
      }
      if (embeddedClientPrefersQuietBackgroundSync()) {
        const debounceMs = embeddedSqliteBumpDebounceMs(pathname);
        const key = `${companyId}::${coll}`;
        const prevTimer = sqliteBumpMergeTimersRef.current[key];
        if (prevTimer) clearTimeout(prevTimer);
        sqliteBumpMergeTimersRef.current[key] = setTimeout(() => {
          delete sqliteBumpMergeTimersRef.current[key];
          mergeCollectionFromSqliteBump(coll);
        }, debounceMs);
        return;
      }
      mergeCollectionFromSqliteBump(coll);
    };
    const mergeActiveCollectionsFromServerDelta = () => {
      const paths = activeMasterCollectionPathsForRoute(pathname, voucherFormMasterScope);
      const refreshHold = mobilePullRefreshHoldRef.current;
      for (const coll of paths) {
        if (refreshHold?.companyId === companyId && refreshHold.collections.has(coll)) {
          refreshHold.pendingCollections.add(coll);
          continue;
        }
        mergeCollectionFromSqliteBump(coll);
      }
    };

    const onServerDelta = (ev: Event) => {
      const d = (ev as CustomEvent<PlServerClientDeltaEventDetail>).detail;
      if (!d?.companyIds?.includes(companyId)) return;
      const refreshPlServerLive = () => {
        const paths = new Set<string>(["vouchers", ...activeMasterCollectionPathsForRoute(pathname, voucherFormMasterScope)]);
        const refreshHold = mobilePullRefreshHoldRef.current;
        for (const coll of paths) {
          if (refreshHold?.companyId === companyId && refreshHold.collections.has(coll)) {
            refreshHold.pendingCollections.add(coll);
            continue;
          }
          const key = `${companyId}::${coll}`;
          const prevTimer = sqliteBumpMergeTimersRef.current[key];
          if (prevTimer) clearTimeout(prevTimer);
          sqliteBumpMergeTimersRef.current[key] = setTimeout(() => {
            delete sqliteBumpMergeTimersRef.current[key];
            mergeCollectionFromSqliteBump(coll, { remoteIncoming: true });
          }, 80);
        }
      };
      if (isServerGateCompanyContext) {
        refreshPlServerLive();
        return;
      }
      if (embeddedClientPrefersQuietBackgroundSync()) {
        const key = `${companyId}::server-delta`;
        const prevTimer = sqliteBumpMergeTimersRef.current[key];
        if (prevTimer) clearTimeout(prevTimer);
        sqliteBumpMergeTimersRef.current[key] = setTimeout(() => {
          delete sqliteBumpMergeTimersRef.current[key];
          mergeActiveCollectionsFromServerDelta();
        }, embeddedSqliteBumpDebounceMs(pathname));
        return;
      }
      mergeActiveCollectionsFromServerDelta();
    };

    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    window.addEventListener(PL_SERVER_CLIENT_DELTA_EVENT, onServerDelta);
    const onRestoreVouchersRefresh = (ev: Event) => {
      const d = (ev as CustomEvent<{ companyId?: string }>).detail;
      if (!d?.companyId || d.companyId !== companyId) return;
      const restoreCompanyId = String(d.companyId).trim();
      const restoreEpoch = companyDataLoadEpochRef.current;
      listVoucherMirrorRowsIncrementally(restoreCompanyId)
        .then((cached) => {
          if (
            restoreCompanyId !== String(companyIdForWipeGuardRef.current || "").trim() ||
            restoreEpoch !== companyDataLoadEpochRef.current
          ) {
            return;
          }
          if (!cached.length) return;
          const aliveCached = (cached as any[])
            .filter(isAliveDoc)
            .map((r) => normalizeVoucherRowAttachmentsForUi(r, voucherAttachmentUiNormalizeOptions()));
          if (voucherUiStripTransientAttachments) {
            maybeQueueTransientAttachmentCleanup(restoreCompanyId, aliveCached);
          }
          commitVouchersSetter(setVouchers, sortDocsByDateField(aliveCached, "date").map(stripMirrorMetaForEntityListRow));
        })
        .catch(() => {});
    };
    window.addEventListener(RESTORE_CLOUD_VOUCHERS_REFRESH_EVENT, onRestoreVouchersRefresh);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      window.removeEventListener(PL_SERVER_CLIENT_DELTA_EVENT, onServerDelta);
      window.removeEventListener(RESTORE_CLOUD_VOUCHERS_REFRESH_EVENT, onRestoreVouchersRefresh);
      if (mobilePullRefreshMergeRef.current === mobilePullRefreshMergeEntry) {
        mobilePullRefreshMergeRef.current = null;
      }
      for (const t of Object.values(sqliteBumpMergeTimersRef.current)) clearTimeout(t);
      sqliteBumpMergeTimersRef.current = {};
    };
  }, [
    companyId,
    company?.storageOption,
    company?.syncedFromCloud,
    company?.syncPolicy,
    company?.authoritativeCompanyId,
    pathname,
    voucherFormMasterScope,
    sqliteLedgerRouteHint.usesSqlite,
    isServerGateCompanyContext,
  ]);

  /** Mobile pull-to-refresh: route-scoped SQLite + server (no global date / full master storm). */
  useEffect(() => {
    const onMobilePull = async (ev: Event) => {
      const detail = (ev as CustomEvent<MobileRoutePullRefreshDetail>).detail;
      const refreshPath = detail?.pathname || pathname;
      const collections = collectionsForMobileRoutePullRefresh(refreshPath);
      const cid = String(companyId || "").trim();
      if (!companyId || !cid || !collections.length) {
        detail?.resolve?.();
        return;
      }

      const refreshHold = {
        companyId: cid,
        collections: new Set<string>([
          ...collections,
          ...activeMasterCollectionPathsForRoute(refreshPath),
        ]),
        pendingCollections: new Set<string>(),
      };
      mobilePullRefreshHoldRef.current = refreshHold;

      try {
        if (isPocketBaseCompany(cid, company)) {
          const { pullPocketBaseCompanyToLocal } = await import("@/lib/pocketbaseData/pbSync");
          try {
            await pullPocketBaseCompanyToLocal(cid);
          } catch {
            /* Offline: keep the cached collection for the final display pass. */
          }
        } else if (isServerGateCompanyContext) {
          const { refreshPlServerDisplayCacheCompany } = await import("@/lib/plServerDisplayCache");
          const plServerCollections = collections.filter(
            (coll): coll is CompanyBackupCollection => coll !== "quotations"
          );
          await refreshPlServerDisplayCacheCompany(cid, {
            pullFullLedger: false,
            focusCollections: plServerCollections,
          });
        } else {
          const co = company as CloudBackedCompanyShape | null | undefined;
          const online = typeof navigator === "undefined" || navigator.onLine !== false;
          const cloudLedgerSyncAllowed = isOnlineCompanyLedgerCloudSyncAllowed(
            cid,
            company as Parameters<typeof isOnlineCompanyLedgerCloudSyncAllowed>[1]
          );
          const storageOptionLocal = String(co?.storageOption || "").toLowerCase() === "local";
          const fsCompanyId = storageOptionLocal
            ? cid
            : String(co?.authoritativeCompanyId || cid).trim() || cid;
          const tryFirestore =
            cloudLedgerSyncAllowed && online && co && isCloudBackedCompany(co);

          for (const coll of collections) {
            if (tryFirestore && coll !== "quotations") {
              try {
                await pullCompanySubcollectionFromFirestoreToLocalDb(
                  fsCompanyId,
                  cid,
                  coll,
                  company,
                  coll === "vouchers" ? "date" : undefined
                );
              } catch {
                /* Offline or sync disabled: keep the cached collection for the final display pass. */
              }
            }
          }
        }

        // Announce every route collection only after its server/cache refresh pass has finished.
        for (const coll of collections) {
          notifyBrowserDbCollectionUpdated(cid, coll, {
            immediate: true,
            source: "mobile_pull_refresh",
          });
        }

        const mergeEntry = mobilePullRefreshMergeRef.current;
        if (mergeEntry?.companyId === cid) {
          const initialCollections = new Set<string>([
            ...collections,
            ...refreshHold.pendingCollections,
          ]);
          refreshHold.pendingCollections.clear();
          await Promise.all([...initialCollections].map((coll) => mergeEntry.merge(coll)));

          // Pick up any in-scope SQLite changes that arrived while the final read/merge was running.
          while (refreshHold.pendingCollections.size) {
            const pending = [...refreshHold.pendingCollections];
            refreshHold.pendingCollections.clear();
            await Promise.all(pending.map((coll) => mergeEntry.merge(coll)));
          }
        }

        if (mobilePullRefreshHoldRef.current === refreshHold) {
          mobilePullRefreshHoldRef.current = null;
        }
        detail?.resolve?.();
      } catch (e) {
        if (mobilePullRefreshHoldRef.current === refreshHold) {
          mobilePullRefreshHoldRef.current = null;
        }
        detail?.reject?.(e);
      }
    };

    window.addEventListener(MOBILE_ROUTE_PULL_REFRESH_EVENT, onMobilePull);
    return () => window.removeEventListener(MOBILE_ROUTE_PULL_REFRESH_EVENT, onMobilePull);
  }, [companyId, company, pathname, isServerGateCompanyContext]);

  /** Voucher/account/user display names: masters se pehle, bounded Firestore chunk — `collection('users')` full scan hata (400+ vouchers / large user base = hang). */
  useEffect(() => {
    if (!vouchersForDisplay.length) return;

    let cancelled = false;
    const debounceMs = vouchersForDisplay.length > 120 ? 450 : 200;
    const timer = window.setTimeout(() => {
      void (async () => {
        const idsToFetch = new Set<string>();
        const userIdsToFetch = new Set<string>();

        vouchersForDisplay.forEach((v) => {
          if (v.userId) userIdsToFetch.add(v.userId);
          const accountFields = [
            "partyId",
            "accountId",
            "fromAccountId",
            "toAccountId",
            "staffId",
            "taxAccountId",
            "incomeAccountId",
            "expenseAccountId",
          ];
          accountFields.forEach((field) => {
            if (v[field]) idsToFetch.add(v[field]);
          });
          (v.entries || []).forEach((e: any) => {
            if (e.accountId) idsToFetch.add(e.accountId);
          });
          (v.lines || []).forEach((line: any) => {
            if (line?.accountId) idsToFetch.add(line.accountId);
          });
        });

        const newAccountNames: Record<string, string> = {};
        const masterLookup = buildJournalLinkedEntityNameLookup(
          parties,
          staff,
          accounts,
          taxes,
          unprocessedExpenseAccounts,
          items
        );
        const journalSnapshot = journalAccountNamesRef.current;

        for (const id of idsToFetch) {
          if (!id) continue;
          const sid = String(id);
          if (journalSnapshot[sid]) continue;
          const fromMaster = masterLookup.get(sid);
          if (fromMaster) newAccountNames[sid] = fromMaster;
        }

        const firestoreAccountIds = [...idsToFetch]
          .map((id) => String(id))
          .filter((sid) => sid && !journalSnapshot[sid] && !newAccountNames[sid]);

        if (!cancelled && !isLocalCompanySelected && companyId && firestoreAccountIds.length) {
          const fromFs = await resolveJournalAccountFirestoreParallel(
            companyId,
            firestoreAccountIds,
            () => cancelled,
            12
          );
          Object.assign(newAccountNames, fromFs);
        }

        const newUserNames: Record<string, string> = {};
        const localUserNameById: Record<string, string> = {};
        const localSessionUser = isLocalCompanySelected && companyId ? getLocalAuthUser(companyId) : null;
        const localSessionDisplayName =
          (localSessionUser?.displayName || localSessionUser?.username || "").trim() ||
          (((company as any)?.adminUsername as string) || "").trim() ||
          "Admin";

        localUserNameById["local"] = localSessionDisplayName;
        localUserNameById["local_guest_user"] = localSessionDisplayName;
        if (localSessionUser?.id) localUserNameById[String(localSessionUser.id)] = localSessionDisplayName;
        if (localSessionUser?.username) localUserNameById[String(localSessionUser.username)] = localSessionDisplayName;

        const nameSnapshot = userNamesRef.current;
        vouchersForDisplay.forEach((v: any) => {
          const uid = v?.userId;
          let fromVoucher = v?.userDisplayName || v?.userName || null;
          if (fromVoucher && String(fromVoucher).toLowerCase().trim() === "local") {
            fromVoucher = localSessionDisplayName;
          }
          if (!uid || !fromVoucher) return;
          // "Auto" uid map me mat daalo — baaki rows ke liye asli naam Firestore se aaye
          if (isRecurringAutoUserDisplayLabel(fromVoucher)) return;
          if (fromVoucher !== "Unknown" && fromVoucher !== "N/A") {
            if ((nameSnapshot[uid] || "") !== fromVoucher) {
              newUserNames[uid] = fromVoucher;
            }
          }
        });

        if (isLocalCompanySelected && companyId) {
          try {
            const localDoc = await getLocalCompanyById(companyId);
            const localUsers = parseLocalCompanyUserRows(
              (localDoc as { localCompanyUsers?: unknown } | null)?.localCompanyUsers
            );
            localUsers.forEach((u) => {
              const display = (u.displayName || u.username || "").trim();
              if (!display) return;
              if (u.id) localUserNameById[String(u.id)] = display;
              if (u.username) localUserNameById[String(u.username)] = display;
            });
          } catch {
            // Non-blocking: voucher grid naam fallback chain se bhar sakta hai.
          }
        }

        const currentUserName = user ? (customUser?.displayName || user.displayName || user.email || "You") : "";

        for (const uid of userIdsToFetch) {
          if (!uid) continue;
          if (newUserNames[uid]) continue;
          const existingUn = nameSnapshot[uid] || "";
          if (existingUn && existingUn !== "Unknown" && existingUn !== "N/A") continue;

          if (uid === user?.uid && currentUserName) {
            if (existingUn !== currentUserName) newUserNames[uid] = currentUserName;
            continue;
          }
          if (localUserNameById[uid]) {
            const resolved = localUserNameById[uid];
            if (existingUn !== resolved) newUserNames[uid] = resolved;
            continue;
          }

          const ownerEmail = (company as any)?.ownerEmail as string | undefined;
          const ownerPrefix = ownerEmail?.includes("@") ? ownerEmail.split("@")[0] : "";
          if (uid === (company as any)?.ownerId && ownerPrefix) {
            if (existingUn !== ownerPrefix) newUserNames[uid] = ownerPrefix;
            continue;
          }

          const sharedUser = ((company as any)?.sharedWith || []).find((su: any) => su?.uid === uid);
          if (sharedUser?.name) {
            const sharedName = String(sharedUser.name);
            if (existingUn !== sharedName) newUserNames[uid] = sharedName;
            continue;
          }
        }

        const uidsNeedingFirestore = [...userIdsToFetch].filter((uid) => {
          if (!uid || isLocalCompanySelected || cancelled) return false;
          if (newUserNames[uid]) return false;
          const ex = nameSnapshot[uid] || "";
          return !ex || ex === "Unknown" || ex === "N/A";
        });

        if (uidsNeedingFirestore.length && !cancelled) {
          const bulkFetched = await batchFetchUserDisplayNamesFromFirestore(uidsNeedingFirestore, () => cancelled);
          for (const [uidKey, nm] of Object.entries(bulkFetched)) {
            if (!nm || nm === "Unknown" || nm === "N/A") continue;
            if ((nameSnapshot[uidKey] || "") !== nm) newUserNames[uidKey] = nm;
          }
        }

        if (cancelled) return;

        if (Object.keys(newAccountNames).length > 0) {
          setJournalAccountNames((prev) => ({ ...prev, ...newAccountNames }));
        }
        if (Object.keys(newUserNames).length > 0) {
          setUserNames((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [uid, name] of Object.entries(newUserNames)) {
              if ((next[uid] || "") !== name) {
                next[uid] = name;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      })();
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    vouchersForDisplay,
    parties,
    staff,
    accounts,
    taxes,
    unprocessedExpenseAccounts,
    items,
    companyId,
    isLocalCompanySelected,
    company,
    user,
    customUser,
  ]);


  // --- Optimization: Calculate Aggregates ONCE ---
  // This replaces the nested loops. We loop vouchers once and build Maps.
  const voucherAggregates = useMemo(() => {
    const partyIdSet = new Set((parties || []).map((p) => p.id));
    const partyVouchersForBalance = filterVouchersForAdminSubscriberPartyLedger(
      companyId,
      vouchersForDisplay
    );
    const partyMap = buildPartyLedgerAggregateMap(partyVouchersForBalance, partyIdSet);
    const staffMap = new Map<string, { debit: number; credit: number }>();
    const accountMap = new Map<string, { debit: number; credit: number }>();
    const taxMap = new Map<string, { debit: number; credit: number }>();
    const expenseMap = new Map<string, { debit: number; credit: number }>();
    
    // For items, we need specific stock tracking
    const itemMap = new Map<string, { debit: number; credit: number; stockIn: number; stockOut: number }>();

    // Helper to safely add to map
    const addVal = (map: Map<string, any>, id: string, type: 'debit' | 'credit', val: number) => {
        if (!id) return;
        const current = map.get(id) || { debit: 0, credit: 0, stockIn: 0, stockOut: 0 };
        if (type === 'debit') current.debit += val;
        else current.credit += val;
        map.set(id, current);
    };

    // Pre-create Item Map for faster Unit Conversion lookup inside the loop
    const itemConfigMap = new Map<string, Item>();
    items.forEach(i => itemConfigMap.set(i.id, i));
    const staffIdSet = new Set((staff || []).map((s) => s.id));

    vouchersForDisplay.forEach(v => {
        const amount = Number(v.amount || v.total || 0);
        const subTotal = Number(v.subTotal || amount);
        const paymentOutPayeeAmount =
          v.type === "payment_out" && Number(v.payeeAmount || 0) > 0
            ? Number(v.payeeAmount || 0)
            : amount;
        const paymentOutOtherChargeAmount =
          v.type === "payment_out" ? Number(v.otherChargeAmount || 0) || 0 : 0;

        // --- Staff Logic ---
        if (v.type === "journal" && v.subType === "add_salary" && Array.isArray(v.entries)) {
            v.entries.forEach((entry: any) => {
                if (staffIdSet.has(entry.accountId)) {
                  addVal(staffMap, entry.accountId, 'credit', Number(entry.credit || 0));
                }
            });
        } else if (v.staffId) {
            if (v.type === "payment_out") {
                addVal(staffMap, v.staffId, 'debit', paymentOutPayeeAmount);
            } else if (v.type === "payment_in") {
                addVal(staffMap, v.staffId, 'credit', amount);
            }
        }
        
        // Party list balance: `buildPartyLedgerAggregateMap` (ledger-aligned) — loop ke baad merge nahi

        // --- Sale/Purchase accounts (respect selected account on voucher; keep legacy fallback ids) ---
        if (v.type === "sale") {
            const selectedSalesAccountId = v.salesAccountId || v.incomeAccountId || "sales_account";
            addVal(expenseMap, selectedSalesAccountId, 'credit', subTotal);
        } else if (v.type === "purchase") {
            const selectedPurchaseAccountId = v.purchaseAccountId || v.expenseAccountId || "purchase_account";
            addVal(expenseMap, selectedPurchaseAccountId, 'debit', subTotal);
        }

        // --- Account Logic ---
        const fromAccId = v.fromAccountId || v.accountId;
        if (fromAccId) {
             if (['payment_in', 'direct_income', 'sale'].includes(v.type)) addVal(accountMap, fromAccId, 'debit', amount);
             else if (['payment_out', 'direct_expense', 'purchase'].includes(v.type)) addVal(accountMap, fromAccId, 'credit', amount);
        }
        
        // Contra Logic for Accounts
        if (v.type === 'contra') {
            if (v.toAccountId) addVal(accountMap, v.toAccountId, 'debit', amount);
            if (v.fromAccountId) addVal(accountMap, v.fromAccountId, 'credit', amount);
        }

        // --- Tax Logic ---
        if (v.taxAccountId) {
             if (v.type === 'payment_out') addVal(taxMap, v.taxAccountId, 'debit', paymentOutPayeeAmount);
             else if (v.type === 'payment_in') addVal(taxMap, v.taxAccountId, 'credit', amount);
        }

        // --- Direct/Indirect Income-Expense (Expense Accounts) ---
        // Receipt mapped to income account.
        if (v.type === "payment_in") {
            const incomeAccId = v.incomeAccountId || v.toAccountId;
            if (incomeAccId) addVal(expenseMap, incomeAccId, 'credit', amount);
        }
        // Payment mapped to expense account.
        if (v.type === "payment_out") {
            const expenseAccId = v.expenseAccountId || v.toAccountId;
            if (expenseAccId) addVal(expenseMap, expenseAccId, 'debit', paymentOutPayeeAmount);
            if (v.otherChargeAccountId && paymentOutOtherChargeAmount > 0) {
              if (partyIdSet.has(String(v.otherChargeAccountId))) {
                addVal(partyMap, v.otherChargeAccountId, 'debit', paymentOutOtherChargeAmount);
              } else if (staffIdSet.has(v.otherChargeAccountId)) {
                addVal(staffMap, v.otherChargeAccountId, 'debit', paymentOutOtherChargeAmount);
              } else {
                addVal(expenseMap, v.otherChargeAccountId, 'debit', paymentOutOtherChargeAmount);
              }
            }
        }

        // Inter Company — bank + staff/tax/expense legs (party → `buildPartyLedgerAggregateMap`)
        if (v.type === "inter_company") {
            if (!isInterCompanyVisibleOnTargetBank(v as Record<string, unknown>)) {
                // Target: source approve se pehle bank map me mat jodo
            } else {
            const icVoucher = v as Record<string, unknown>;
            const legs = resolveInterCompanyLegsForVoucher(icVoucher);
            const bankId = readInterCompanyCompanyBankId(icVoucher);
            if (bankId) {
                const icBank = getInterCompanyLedgerAmounts(icVoucher, "account", bankId, amount);
                if (icBank.touched) {
                    if (icBank.debit > 0) addVal(accountMap, bankId, "debit", icBank.debit);
                    if (icBank.credit > 0) addVal(accountMap, bankId, "credit", icBank.credit);
                }
            }
            const ocAmt = Math.round((Number(icVoucher.otherChargeAmount) || 0) * 100) / 100;
            const ocId = String(icVoucher.otherChargeAccountId || "").trim();
            const hasOtherChargeLeg =
              ocId &&
              ocAmt > 0 &&
              legs.some(
                (leg) =>
                  String(leg.accountId) === ocId &&
                  leg.debit > 0 &&
                  (leg.kind === "party" || leg.kind === "staff" || leg.kind === "expense")
              );

            if (legs.length > 0) {
                legs.forEach((leg) => {
                    if (leg.kind === "party") return;
                    // Clearing bank upar already; destination bank / staff / tax / expense
                    if (leg.kind === "bank") {
                        if (bankId && String(leg.accountId) === bankId) return;
                        const icDestBank = getInterCompanyLedgerAmounts(
                            icVoucher,
                            "account",
                            leg.accountId,
                            amount
                        );
                        if (!icDestBank.touched) return;
                        if (icDestBank.debit > 0) addVal(accountMap, leg.accountId, "debit", icDestBank.debit);
                        if (icDestBank.credit > 0) addVal(accountMap, leg.accountId, "credit", icDestBank.credit);
                        return;
                    }
                    const context =
                        leg.kind === "staff"
                              ? ("staff" as const)
                              : leg.kind === "tax"
                                ? ("tax" as const)
                                : ("expense" as const);
                    const icEntity = getInterCompanyLedgerAmounts(
                        icVoucher,
                        context,
                        leg.accountId,
                        amount
                    );
                    if (!icEntity.touched) return;
                    const map =
                        context === "staff"
                              ? staffMap
                              : context === "tax"
                                ? taxMap
                                : expenseMap;
                    if (icEntity.debit > 0) addVal(map, leg.accountId, "debit", icEntity.debit);
                    if (icEntity.credit > 0) addVal(map, leg.accountId, "credit", icEntity.credit);
                });
            }
            if (!hasOtherChargeLeg && ocId && ocAmt > 0) {
                const resolvedOcKind = resolveInterCompanyOtherChargeKindFromVoucher(icVoucher);
                const context =
                    resolvedOcKind === "staff"
                        ? ("staff" as const)
                        : resolvedOcKind === "expense"
                          ? ("expense" as const)
                          : resolvedOcKind === "party"
                            ? ("party" as const)
                            : null;
                if (context) {
                    const icEntity = getInterCompanyLedgerAmounts(icVoucher, context, ocId, amount);
                    if (icEntity.touched) {
                        const map =
                            context === "staff"
                                ? staffMap
                                : context === "expense"
                                  ? expenseMap
                                  : partyMap;
                        if (icEntity.debit > 0) addVal(map, ocId, "debit", icEntity.debit);
                        if (icEntity.credit > 0) addVal(map, ocId, "credit", icEntity.credit);
                    }
                }
            }
            }
        }
        if (v.type === "direct_income" && v.incomeAccountId) {
            addVal(expenseMap, v.incomeAccountId, 'credit', amount);
        } else if (["direct_expense"].includes(v.type)) {
            const toAccId = v.toAccountId || v.expenseAccountId;
            if (toAccId) addVal(expenseMap, toAccId, 'debit', amount);
        }

        // --- Line Items (For Tax & Items) ---
        if (v.lineItems && Array.isArray(v.lineItems)) {
            v.lineItems.forEach((line: any) => {
                // Line Tax
                if (line.taxAccountId && line.taxAmount) {
                      const tAmt = Number(line.taxAmount);
                      if (v.type === 'purchase') addVal(taxMap, line.taxAccountId, 'debit', tAmt);
                      else if (v.type === 'sale') addVal(taxMap, line.taxAccountId, 'credit', tAmt);
                }
                if (line.tdsAccountId && line.tdsAmount) {
                      const tdsAmt = Number(line.tdsAmount);
                      // Unverified TDS legs count in tax list balance (same as ledger header).
                      if (tdsAmt > 0) {
                        if (v.type === "purchase" || v.type === "purchase_service")
                          addVal(taxMap, line.tdsAccountId, "credit", tdsAmt);
                        else if (v.type === "sale" || v.type === "sale_service")
                          addVal(taxMap, line.tdsAccountId, "debit", tdsAmt);
                      }
                }

                // --- Item Stock Logic ---
                if (line.itemId) {
                    const item = itemConfigMap.get(line.itemId);
                    if (item) {
                        const current = itemMap.get(line.itemId) || { debit: 0, credit: 0, stockIn: 0, stockOut: 0 };
                        const qty = Number(line.quantity) || 0;
                        const rate = Number(line.rate) || 0;
                        const lineAmount = qty * rate;

                        if (v.type === 'purchase') current.debit += lineAmount;
                        if (v.type === 'sale') {
                           current.credit += v.totalPurchasePrice && v.totalPurchasePrice > 0 ? v.totalPurchasePrice : (qty * (item.purchasePrice || rate));
                        }

                        const conversions = (item.unitConversions || []) as any[];
                        const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');
                        
                        // Helper to get factor (inline to access closures)
                        let factor = 1;
                        if (line.unit && line.unit !== smallestUnit) {
                            let currentUnit = line.unit;
                             // Basic loop to find path to smallest unit. 
                             // Optimized: assuming direct chain for now or simple list match
                             // Logic: If I have 1 Box, and 1 Box = 10 Pcs (Base). Factor is 10.
                             // Loop: Find conversion where fromUnit == currentUnit. 
                             let found = false;
                             // Limit loop to prevent infinite
                             for(let k=0; k<10; k++) {
                                 const conv = conversions.find((c:any) => c.fromUnit === currentUnit);
                                 if(!conv) break;
                                 factor *= Number(conv.conversionFactor) || 1;
                                 currentUnit = conv.toUnit;
                                 if(currentUnit === smallestUnit) {
                                     found = true;
                                     break;
                                 }
                             }
                        }

                        const standardizedQty = qty * factor;

                        if (v.type === 'purchase') current.stockIn += standardizedQty;
                        if (v.type === 'sale') current.stockOut += standardizedQty;

                        itemMap.set(line.itemId, current);
                    }
                }
            });
        }

        // --- Journal & Adjustment Entries ---
        if ((v.type === "journal" || v.type === "adjustment") && Array.isArray(v.entries)) {
            v.entries.forEach((entry: any) => {
                const d = Number(entry.debit || 0);
                const c = Number(entry.credit || 0);
                if (entry.accountId) {
                    if (v.type === "adjustment" || v.subType !== 'add_salary') { // add_salary staff handled above
                       addVal(staffMap, entry.accountId, 'debit', d); addVal(staffMap, entry.accountId, 'credit', c);
                    }
                    addVal(accountMap, entry.accountId, 'debit', d); addVal(accountMap, entry.accountId, 'credit', c);
                    // Add Salary tax legs (Verified and Unverified) count toward tax list balance.
                    const skipUnverifiedAddSalaryTax = false;
                    if (!skipUnverifiedAddSalaryTax) {
                      addVal(taxMap, entry.accountId, "debit", d);
                      addVal(taxMap, entry.accountId, "credit", c);
                    }
                    addVal(expenseMap, entry.accountId, 'debit', d); addVal(expenseMap, entry.accountId, 'credit', c);
                }
            });
        }
    });

    return { partyMap, staffMap, accountMap, taxMap, expenseMap, itemMap };
  }, [vouchersForDisplay, items, staff, parties, companyId]); // parties: ledger-aligned partyMap


 const processedParties: ProcessedParty[] = useMemo(() => {
    // Return early if the necessary data isn't loaded yet.
    if (loading || !parties || !unprocessedExpenseAccounts) {
        return previousData.current.processedParties || [];
    }
    const regularParties = parties.map(p => {
        const stats = voucherAggregates.partyMap.get(p.id) || { debit: 0, credit: 0 };
        // For Opening Balance ledger, balance should equal openingBalance (no transactions)
        const isOpeningBalanceLedger = p.id === 'opening_balance_ledger';
        const balance = isOpeningBalanceLedger 
          ? (Number(p.openingBalance) || 0)
          : (Number(p.openingBalance) || 0) + stats.debit - stats.credit;
        return {
            ...p,
            openingBalance: Number(p.openingBalance) || 0, // Preserve openingBalance field
            debit: isOpeningBalanceLedger ? (balance > 0 ? balance : 0) : stats.debit,
            credit: isOpeningBalanceLedger ? (balance < 0 ? Math.abs(balance) : 0) : stats.credit,
            balance,
            isSystemAccount: (p as any).isSystemReserved || (p as any).isSystemAccount || false,
        };
    }).filter(p => !p.isDeleted);
    
    const systemIds = ['sales_account', 'purchase_account'];
    const systemParties = systemIds.map(id => {
        const stats = voucherAggregates.expenseMap.get(id) || { debit: 0, credit: 0 };
        const originalAcc = unprocessedExpenseAccounts.find(a => a.id === id);
        return {
            id,
            name: originalAcc?.name || (id === 'sales_account' ? 'Sales Account' : 'Purchase Account'),
            groupId: id === 'sales_account' ? 'income' : 'expenses',
            debit: stats.debit,
            credit: stats.credit,
            balance: stats.debit - stats.credit,
            isSystemAccount: (originalAcc as any)?.isSystemReserved || true
        } as ProcessedParty;
    }).filter(sp => sp.debit !== 0 || sp.credit !== 0);

    return [...regularParties, ...systemParties];
}, [parties, voucherAggregates.partyMap, voucherAggregates.expenseMap, unprocessedExpenseAccounts, loading]);

  const processedPartiesForSelection: ProcessedParty[] = useMemo(
    () => processedParties.filter(
      (p) => !REPORT_ONLY_PARTY_IDS.includes(p.id as any) && !PARTY_SELECTION_HIDDEN_IDS.includes(p.id as any)
    ),
    [processedParties]
  );

  const { overdueTransactions, hasOverdueTransactions } = useMemo(() => {
    if (!routeNeedsOverdueVoucherScan(pathname)) {
      return { overdueTransactions: [], hasOverdueTransactions: false };
    }
    const cid = String(companyId || "").trim();
    if (
      cid &&
      !isOnlineCompanyLedgerCloudSyncAllowed(
        cid,
        company as Parameters<typeof isOnlineCompanyLedgerCloudSyncAllowed>[1]
      )
    ) {
      return { overdueTransactions: [], hasOverdueTransactions: false };
    }
    const partyNameById = new Map(processedParties.map((p) => [p.id, p.name]));
    const billWiseIncoming = buildBillWiseIncomingAllocationMaps(vouchersForDisplay);
    const tdsLegAllocByTarget = getTdsLegAllocatedByTargetId(vouchersForDisplay);
    const list: VoucherContextType["overdueTransactions"] = [];
    for (const v of vouchersForDisplay) {
      if (!isSaleOrPurchaseBillVoucherType(v.type) || !v.partyId) continue;
      const total = Number(v.total ?? v.amount ?? ((v.subTotal ?? 0) - (v.discount ?? 0) + (v.tax ?? 0))) || 0;
      const allocated = getBillWiseAllocatedToTargetWithMaps(v, String(v.id), billWiseIncoming);
      // Overdue follows party-leg link target (total - TDS); shown outstanding still includes the TDS leg.
      const partyAllocated = Math.max(0, allocated - (tdsLegAllocByTarget.get(String(v.id)) ?? 0));
      const result = getPaymentStatusResult(getSalePurchasePartyLinkTarget({ ...v, total }), partyAllocated, v.dueDate);
      if (!result.isOverdue) continue;
      const partyName = partyNameById.get(v.partyId) ?? v.partyId;
      const netTotal = getSalePurchasePartyLinkTarget({ ...v, total });
      const outstanding = Math.max(0, netTotal - partyAllocated);
      const debit = v.type === "sale" ? netTotal : 0;
      const credit = v.type === "purchase" ? netTotal : 0;
      const linkNos = getSalePurchaseBillWiseLinkNos(vouchersForDisplay, { id: v.id, type: v.type });
      const fallbackUserId =
        v.userId ||
        v.createdBy ||
        v.createdByUserId ||
        v.changedBy ||
        v.uid;
      const fallbackUserName =
        v.userDisplayName ||
        v.userName ||
        v.createdByName ||
        v.changedByName ||
        undefined;
      list.push({
        id: v.id,
        type: v.type,
        date: v.date,
        voucherNumber: v.voucherNumber ?? v.id,
        partyId: v.partyId,
        partyName,
        total,
        outstanding,
        debit,
        credit,
        dueDate: v.dueDate,
        isOverdue: true,
        paymentStatus: result.status === "partially_paid" ? "partially_paid" : "overdue",
        ...linkNos,
        overdueImportant: (v as { overdueImportant?: boolean }).overdueImportant === true,
        userId: fallbackUserId,
        userName: fallbackUserName,
        narration: (v as any).narration,
        fileUrls: Array.isArray((v as any).fileUrls) ? (v as any).fileUrls : undefined,
        unassignedFile: (v as any).unassignedFile,
        createdAt: (v as any).createdAt,
        lastEditedAt: (v as any).lastEditedAt,
        updatedAt: (v as any).updatedAt,
      });
    }
    return { overdueTransactions: list, hasOverdueTransactions: list.length > 0 };
  }, [vouchersForDisplay, processedParties, companyId, company, onlineSyncPrefsEpoch, pathname]);

  const processedStaff: ProcessedStaff[] = useMemo(() => {
    return staff.map(s => {
        const stats = voucherAggregates.staffMap.get(s.id) || { debit: 0, credit: 0 };
        return {
            ...s,
            openingBalance: Number(s.openingBalance) || 0,
            debit: stats.debit,
            credit: stats.credit,
            balance: (Number(s.openingBalance) || 0) + stats.debit - stats.credit
        };
    }).filter(s => !s.isDeleted);
  }, [staff, voucherAggregates.staffMap]);

  const processedAccounts: ProcessedAccount[] = useMemo(() => {
    return accounts.map((a) => {
        const row = normalizeBankAccountRow(a as Record<string, unknown>) as Account;
        const stats = voucherAggregates.accountMap.get(row.id) || { debit: 0, credit: 0 };
        return {
            ...row,
            isSpecial: coerceBankAccountIsSpecial(row.isSpecial),
            debit: stats.debit,
            credit: stats.credit,
            balance: (Number(row.openingBalance) || 0) + stats.debit - stats.credit
        };
    }).filter(a => !a.isDeleted);
  }, [accounts, voucherAggregates.accountMap]);

  const processedTaxes: ProcessedTax[] = useMemo(() => {
    return taxes.map(t => {
        const stats = voucherAggregates.taxMap.get(t.id) || { debit: 0, credit: 0 };
        return {
            ...t,
            debit: stats.debit,
            credit: stats.credit,
            balance: (Number(t.openingBalance) || 0) + stats.debit - stats.credit
        };
    }).filter(t => !t.isDeleted);
  }, [taxes, voucherAggregates.taxMap]);

  const processedExpenseAccounts: ProcessedExpenseAccount[] = useMemo(() => {
    return unprocessedExpenseAccounts.map(e => {
        const stats = voucherAggregates.expenseMap.get(e.id) || { debit: 0, credit: 0 };
        return {
            ...e,
            debit: stats.debit,
            credit: stats.credit,
            balance: (Number((e as any).openingBalance) || 0) + stats.debit - stats.credit
        };
    }).filter(e => !e.isDeleted);
  }, [unprocessedExpenseAccounts, voucherAggregates.expenseMap]);
  
  const expenseAccounts = processedExpenseAccounts;

  // --- Item Processing ---
  // Using the pre-calculated itemMap from aggregates
  const processedItems: ProcessedItem[] = useMemo(() => {
    return items.map(item => {
        const stats = voucherAggregates.itemMap.get(item.id) || { debit: 0, credit: 0, stockIn: 0, stockOut: 0 };
        const newItem: ProcessedItem = { ...item, ...stats }; // Copy stats directly

        const conversions = (item.unitConversions || []) as any[];
        const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');
        
        const getFactor = (unit: string) => {
             if (!unit || conversions.length === 0) return 1;
             if (unit === smallestUnit) return 1;
             let factor = 1;
             let currentUnit = unit;
             for (let i=0; i < 10; i++) { // safety break
                const conv = conversions.find((c:any) => c.fromUnit === currentUnit);
                if (!conv) return 0; 
                factor *= Number(conv.conversionFactor) || 1;
                currentUnit = conv.toUnit;
                if (currentUnit === smallestUnit) break;
             }
             return factor;
        };
        const openingUnit = (item as any).openingBalanceUnit || (conversions.length > 0 ? conversions[0].fromUnit : "");
        const openingStockInSmallest = (Number(item.openingBalance) || 0) * (openingUnit ? getFactor(openingUnit) : 1);
        
        // Calculate Final Stock Qty
        newItem.stockQty = openingStockInSmallest + (stats.stockIn || 0) - (stats.stockOut || 0);
        
        // Calculate Financial Balance
        newItem.balance = (Number(item.openingBalance) || 0) * (Number(item.openingBalanceRate) || 0) + stats.debit - stats.credit;

        // Calculate Display Qty
        const displayUnitFactor = getFactor((item as any).displayUnit || smallestUnit || '');
        
        newItem.displayStockQty = displayUnitFactor > 0 ? newItem.stockQty / displayUnitFactor : 0;
        
        return newItem;
      });
  }, [items, voucherAggregates.itemMap]); // Only re-run if items or aggregated stats change


  // --- Group Processing (Standard Aggregation) ---
  const processGroups = useCallback((groups: any[], items: any[]) => {
      const groupMap = new Map<string, any>();
      groups.forEach(g => groupMap.set(g.id, { ...g, debit: 0, credit: 0, balance: 0, openingBalance: Number(g.openingBalance || 0) }));

      items.forEach(item => {
          if (item.groupId && groupMap.has(item.groupId)) {
              const g = groupMap.get(item.groupId);
              const isItemGroup = 'purchasePrice' in item;

              if (isItemGroup) {
                // For item groups, balance = opening value + purchase values - cogs
                g.debit += item.debit || 0;
                g.credit += item.credit || 0;
                const itemOpeningValue = (Number(item.openingBalance) || 0) * (Number(item.openingBalanceRate) || 1);
                g.openingBalance += itemOpeningValue;
              } else {
                // For other groups, use standard debit/credit
                g.debit += item.debit || 0;
                g.credit += item.credit || 0;
                g.openingBalance += (Number(item.openingBalance) || 0);
              }
          }
      });
      
      const sortedGroups = [...groupMap.values()].sort((a,b) => (a.parentId ? 1 : -1));
      
      sortedGroups.forEach(g => {
         g.balance = g.openingBalance + g.debit - g.credit; 
      });
      
       sortedGroups.forEach(g => {
         if (g.parentId && groupMap.has(g.parentId)) {
             const parent = groupMap.get(g.parentId);
             parent.debit += g.debit;
             parent.credit += g.credit;
             parent.openingBalance += g.openingBalance;
             parent.balance = parent.openingBalance + parent.debit - parent.credit;
         }
      });

      return Array.from(groupMap.values()).filter(g => !g.isDeleted);
  }, []);

  const staffGroupsForProcessing = useMemo(
    () => staffGroups.map((g) => normalizeStaffSystemGroupRow(g)),
    [staffGroups]
  );
  const processedGroups = useMemo(() => processGroups(groups, processedParties), [groups, processedParties, processGroups]);
  const processedStaffGroups = useMemo(
    () => processGroups(staffGroupsForProcessing, processedStaff),
    [staffGroupsForProcessing, processedStaff, processGroups]
  );
  const processedAccountGroups = useMemo(() => processGroups(accountGroups, processedAccounts), [accountGroups, processedAccounts, processGroups]);
  const processedTaxGroups = useMemo(() => processGroups(taxGroups, processedTaxes), [taxGroups, processedTaxes, processGroups]);
  const processedItemGroups = useMemo(() => processGroups(itemGroups, processedItems), [itemGroups, processedItems, processGroups]);
  const processedExpenseGroups = useMemo(() => processGroups(expenseGroups, processedExpenseAccounts), [expenseGroups, processedExpenseAccounts, processGroups]);

  // Alias Name search in every master Combobox (see src/lib/masterAliasIndex.ts) - registered synchronously during render.
  useMemo(() => {
    for (const rows of [processedParties, processedStaff, processedAccounts, processedTaxes, processedExpenseAccounts, processedItems,
      groups, staffGroups, accountGroups, taxGroups, itemGroups, expenseGroups] as ReadonlyArray<unknown>[]) registerMasterAliases(rows);
  }, [processedParties, processedStaff, processedAccounts, processedTaxes, processedExpenseAccounts, processedItems, groups, staffGroups, accountGroups, taxGroups, itemGroups, expenseGroups]);

  // Pre-load names from collections (available immediately) so transactions show names, not UIDs
  const journalAccountNamesMerged = useMemo(() => {
    const preloaded: Record<string, string> = {};
    processedParties.forEach((p) => { preloaded[p.id] = p.name; });
    processedAccounts.forEach((a) => { preloaded[a.id] = a.accountName; });
    processedStaff.forEach((s) => { preloaded[s.id] = s.name; });
    processedTaxes.forEach((t) => { preloaded[t.id] = t.name; });
    processedExpenseAccounts.forEach((e) => { preloaded[e.id] = e.name; });
    processedItems.forEach((i) => { preloaded[i.id] = i.name; });
    // Fetched names first; master lists win so async "Unknown Account" never overwrites real entity names.
    return { ...journalAccountNames, ...preloaded };
  }, [processedParties, processedAccounts, processedStaff, processedTaxes, processedExpenseAccounts, processedItems, journalAccountNames]);
  
  const value = useMemo(() => {
    const currentData = {
        vouchers: vouchersForDisplay,
        // `vouchersAll` bhi alive-only rakho; reports/status logic me deleted voucher leak na ho.
        vouchersAll: applyLocalLedgerHoldsToRows(vouchers.filter(isAliveDoc)),
        loading,
        processedParties, 
        processedPartiesForSelection, 
        processedStaff, 
        processedAccounts, 
        processedTaxes, 
        expenseAccounts, 
        processedItems, 
        processedItemGroups, 
        processedGroups, 
        processedAccountGroups, 
        processedStaffGroups, 
        processedTaxGroups,
        processedExpenseAccounts,
        processedExpenseGroups,
        journalAccountNames: journalAccountNamesMerged,
        userNames,
        overdueTransactions,
        hasOverdueTransactions,
        patchMasterEntity,
    };
    
    return currentData;
  }, [
    vouchersForDisplay, vouchers, loading, processedParties, processedPartiesForSelection, processedStaff, processedAccounts, 
    processedTaxes, expenseAccounts, processedItems, processedItemGroups, 
    processedGroups, processedAccountGroups, processedStaffGroups, processedTaxGroups,
    processedExpenseAccounts, processedExpenseGroups, journalAccountNamesMerged, userNames,
    overdueTransactions, hasOverdueTransactions, patchMasterEntity
  ]);

  /** Jis company ka data last stable render me dikha (same-company refresh vs company switch alag karte hain). */
  const lastStableDisplayCompanyIdRef = useRef<string | null>(null);

  // Company badalte hi stable ref hatao — warna purani id se `sameCompany === true` ho kar display path galat ho (nested dialog / fast switch).
  useEffect(() => {
    lastStableDisplayCompanyIdRef.current = null;
  }, [companyId]);

  // Update ref in useEffect to avoid accessing refs during render
  useEffect(() => {
    if (!loading) {
      previousData.current = value;
      // Loading complete: ab is company ka snapshot “stable” maan sakte hain (nested dialog target change ke baad bhi).
      lastStableDisplayCompanyIdRef.current = companyId ? String(companyId) : null;
    }
  }, [loading, value, companyId]);

  // Use state to track the display value to avoid ref access during render
  const [displayValue, setDisplayValue] = useState(() => value);
  const displayValueRef = useRef(displayValue);

  useEffect(() => {
    let next = value;
    if (loading) {
      const sameCompany =
        lastStableDisplayCompanyIdRef.current != null &&
        companyId != null &&
        String(lastStableDisplayCompanyIdRef.current) === String(companyId);
      if (sameCompany) {
        next = {
          ...previousData.current,
          loading: true,
        };
      }
    }
    const kept = keepVoucherContextDisplayIfUnchanged(displayValueRef.current, next);
    if (kept === displayValueRef.current) return;
    displayValueRef.current = kept;
    setDisplayValue(kept);
  }, [loading, value, companyId]);

  // Latest master balances for print-masters PDF (openPrintDirect reads snapshot).
  useEffect(() => {
    if (loading) {
      setMastersPrintSnapshot(null);
      return;
    }
    const toEntries = (
      list: Array<{ name?: string; accountName?: string; balance: number; isDeleted?: boolean }>
    ) =>
      list
        .filter((x) => !x.isDeleted)
        .map((x) => ({
          name: String(x.name || x.accountName || "").trim() || "—",
          balance: Number(x.balance) || 0,
        }));

    setMastersPrintSnapshot({
      party: toEntries(processedParties),
      partyGroup: toEntries(processedGroups),
      bankCash: toEntries(processedAccounts),
      bankCashGroup: toEntries(processedAccountGroups),
      staff: toEntries(processedStaff),
      staffGroup: toEntries(processedStaffGroups),
      tax: toEntries(processedTaxes),
      taxGroup: toEntries(processedTaxGroups),
      item: toEntries(processedItems),
      itemGroup: toEntries(processedItemGroups),
      expense: toEntries(processedExpenseAccounts),
      expenseGroup: toEntries(processedExpenseGroups),
    });
  }, [
    loading,
    processedParties,
    processedGroups,
    processedAccounts,
    processedAccountGroups,
    processedStaff,
    processedStaffGroups,
    processedTaxes,
    processedTaxGroups,
    processedItems,
    processedItemGroups,
    processedExpenseAccounts,
    processedExpenseGroups,
  ]);

  return (
    <VoucherContext.Provider value={displayValue}>
      {children}
    </VoucherContext.Provider>
  );
};

export const useVouchers = () => {
  const context = useContext(VoucherContext);
  if (context === undefined) {
    throw new Error("useVouchers must be used within a VoucherProvider");
  }
  // FY/month scope: har page jo `useVouchers` use kare (party, staff, bank, forms…) same filtered list dekhe.
  const fy = useFyVoucherScope();
  const scopedVouchers = useMemo(() => {
    if (!fy.enabled || !fy.activeScope) return context.vouchers;
    const merged = mergeFyHydratedWithLiveVouchers(
      fy.hydratedVouchers || [],
      context.vouchers || []
    );
    // Soft-delete live patch ke baad FY hydrate me tombstone na dikhe (refresh ke bina).
    return filterVouchersToFyScope(
      merged,
      fy.activeScope,
      fy.loadedRanges,
      fy.scopedVoucherIds
    ).filter((v: { isDeleted?: boolean }) => v?.isDeleted !== true);
  }, [
    context.vouchers,
    fy.enabled,
    fy.activeScope,
    fy.loadedRanges,
    fy.hydratedVouchers,
    fy.scopedVoucherIds,
  ]);

  const scopedVouchersAll = useMemo(() => {
    if (!fy.enabled || !fy.activeScope) return context.vouchersAll;
    const mergedAll = mergeFyHydratedWithLiveVouchers(
      fy.hydratedVouchers || [],
      context.vouchersAll || []
    );
    return filterVouchersToFyScope(
      mergedAll,
      fy.activeScope,
      fy.loadedRanges,
      fy.scopedVoucherIds
    ).filter((v: { isDeleted?: boolean }) => v?.isDeleted !== true);
  }, [
    context.vouchersAll,
    fy.enabled,
    fy.activeScope,
    fy.loadedRanges,
    fy.hydratedVouchers,
    fy.scopedVoucherIds,
  ]);

  return useMemo(() => {
    if (!fy.enabled || !fy.activeScope) return context;
    if (scopedVouchers === context.vouchers && scopedVouchersAll === context.vouchersAll) {
      return context;
    }
    return { ...context, vouchers: scopedVouchers, vouchersAll: scopedVouchersAll };
  }, [context, fy.enabled, fy.activeScope, scopedVouchers, scopedVouchersAll]);
};

/** Shell route par voucher forms ke liye saare masters (party/staff/tax/bank/expense/…) loaded hon. */
export function routeHasVoucherFormMastersLoaded(pathname: string): boolean {
  const paths = activeMasterCollectionPathsForRoute(pathname, false);
  for (const p of VOUCHER_FORM_MASTER_COLLECTION_PATHS) {
    if (!paths.has(p)) return false;
  }
  return true;
}

/** Shell route par `bank_accounts` prefetch ho rahe hon (voucher dialog ke liye). */
export function routeHasVoucherBankAccountsLoaded(pathname: string): boolean {
  return activeMasterCollectionPathsForRoute(pathname, false).has("bank_accounts");
}
