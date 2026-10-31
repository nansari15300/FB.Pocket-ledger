"use client";

import { normalizeAttachmentUrlForDevicePreview } from "@/lib/attachmentHoldClipboard";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyAttachmentSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import type { Company } from "@/hooks/useCompany";
import { shouldUseAttachmentLazyLoad } from "@/lib/webAttachmentLazyLoadPolicy";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { looksLikeFirebaseStorageDownloadUrl } from "@/lib/storageGetBlobFromDownloadUrl";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";

const EXPLICIT_GRANT_MS = 8 * 60 * 1000;

function normUrl(raw: string): string {
  return normalizeAttachmentUrlForDevicePreview(String(raw || "").trim());
}

function normCompanyId(cid: string | null | undefined): string {
  return String(cid || "").trim();
}

/** Company Selector Files tick (+ global cloud sync) — remote Firebase/HTTP bytes allowed? */
export function isOnlineCompanyAttachmentFilesTickEnabled(companyId: string | null | undefined): boolean {
  const cid = normCompanyId(companyId);
  if (!cid) return true;
  if (isFirebaseLedgerDataSyncDisabled()) return false;
  return isFirebaseLedgerCompanyAttachmentSyncEnabled(cid);
}

const visiblePageUrlsByCompany = new Map<string, Set<string>>();
const explicitGrantUntil = new Map<string, number>();

function grantKey(companyId: string, url: string): string {
  return `${companyId}::${normUrl(url)}`;
}

/** Ledger table current page — sirf in URLs par network fetch (web + Files ON). */
export function setVisiblePageAttachmentUrls(
  companyId: string | null | undefined,
  urls: readonly string[]
): void {
  const cid = normCompanyId(companyId);
  if (!cid) return;
  const set = new Set<string>();
  for (const raw of urls) {
    const u = normUrl(raw);
    if (u) set.add(u);
  }
  visiblePageUrlsByCompany.set(cid, set);
}

/** User ne edit / open / hover portal click kiya — is URL ke liye network allow. */
export function grantExplicitAttachmentNetworkFetch(
  url: string,
  companyId?: string | null
): void {
  const cid = normCompanyId(companyId);
  const u = normUrl(url);
  if (!cid || !u) return;
  explicitGrantUntil.set(grantKey(cid, u), Date.now() + EXPLICIT_GRANT_MS);
}

export function grantExplicitAttachmentNetworkFetchBatch(
  urls: readonly string[],
  companyId?: string | null
): void {
  for (const u of urls) grantExplicitAttachmentNetworkFetch(u, companyId);
}

function hasExplicitGrant(url: string, companyId: string): boolean {
  const key = grantKey(companyId, url);
  const until = explicitGrantUntil.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    explicitGrantUntil.delete(key);
    return false;
  }
  return true;
}

function isOnVisiblePage(url: string, companyId: string): boolean {
  const set = visiblePageUrlsByCompany.get(companyId);
  if (!set || set.size === 0) return false;
  return set.has(normUrl(url));
}

export type AttachmentNetworkFetchOpts = {
  companyId?: string | null;
  /** When set, embedded Online companies use the same visible-page gate as web. */
  company?: Company | null;
  /** EXE/APK / embedded — visible-page list mat lagao. */
  bypassVisiblePageCheck?: boolean;
  /** Edit form open / user click open / hover intentional load. */
  explicitUserRequest?: boolean;
};

/** Remote attachment HTTP/Firebase Storage fetch allowed? (local cache reads alag.) */
export function isRemoteAttachmentNetworkFetchAllowed(
  url: string,
  opts?: AttachmentNetworkFetchOpts
): boolean {
  const trimmed = String(url || "").trim();
  if (!trimmed) return false;
  if (isLocalFileRef(trimmed) || isDriveFileRef(trimmed)) return true;

  const cid = normCompanyId(opts?.companyId);
  // PocketBase company: no Files tick, no visible-page or older-FY click rule.
  if (cid && isPocketBaseCompany(cid, opts?.company)) return true;
  if (cid && !isOnlineCompanyAttachmentFilesTickEnabled(cid)) {
    return false;
  }

  if (opts?.explicitUserRequest) return true;
  if (cid && hasExplicitGrant(trimmed, cid)) return true;

  if (opts?.bypassVisiblePageCheck || !shouldUseAttachmentLazyLoad(opts?.company, cid)) {
    return true;
  }

  if (!cid) return false;
  return isOnVisiblePage(trimmed, cid);
}

export function isRemoteHttpsAttachmentUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  if (isLocalFileRef(u) || isDriveFileRef(u)) return false;
  return looksLikeFirebaseStorageDownloadUrl(u) || /^https?:\/\//i.test(u);
}
