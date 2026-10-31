"use client";

/**
 * Attachment lazy load: visible-page + hover/click grant (web + EXE/APK online companies).
 * Local / PL Server embedded shells keep company-wide warm for `local:` refs.
 */

import type { Company } from "@/hooks/useCompany";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { readFirebaseLedgerCompanySyncPrefs } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { companyUsesOnlineSelectorSyncTicks } from "@/lib/onlineCompanySelectorSyncPolicy";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";

/** Web browser, or embedded Online (Company Selector) company — same lazy rules. */
export function shouldUseAttachmentLazyLoad(
  company?: Company | null,
  companyId?: string | null
): boolean {
  if (typeof window === "undefined") return false;
  // PocketBase companies: files are pulled to the device (no visible-page / click-to-load rule).
  if (isPocketBaseCompany(companyId, company)) return false;
  if (!isEmbeddedOfflinePreloadClient()) return true;
  if (company != null) return companyUsesOnlineSelectorSyncTicks(company);
  const id = String(companyId || "").trim();
  if (!id) return false;
  try {
    const prefs = readFirebaseLedgerCompanySyncPrefs();
    return Object.prototype.hasOwnProperty.call(prefs.companies, id);
  } catch {
    return false;
  }
}

/** @deprecated Prefer `shouldUseAttachmentLazyLoad(company)` when company row is available. */
export function isWebBrowserAttachmentLazyLoad(company?: Company | null): boolean {
  return shouldUseAttachmentLazyLoad(company);
}

/** Skip company-wide scrape / header % full-file prefetch. */
export function shouldSkipCompanyWideAttachmentPrefetchOnWeb(company?: Company | null): boolean {
  return shouldUseAttachmentLazyLoad(company);
}

/**
 * Idle list warm must not pull full blobs for every visible URL again
 * (thumb path already caches permanently when preview loads).
 */
export function shouldSkipVisibleRowFullIdlePrewarmOnWeb(company?: Company | null): boolean {
  return shouldUseAttachmentLazyLoad(company);
}

/**
 * Green-tick / ready queue must not force Firebase download —
 * cache hit or URL presence is enough; full bytes on hover/click/thumb path.
 */
export function shouldSkipForcedAttachmentWarmQueueOnWeb(company?: Company | null): boolean {
  return shouldUseAttachmentLazyLoad(company);
}
