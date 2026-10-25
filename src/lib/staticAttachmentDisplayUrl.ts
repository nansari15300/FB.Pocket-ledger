"use client";

import { isPbAttachmentRef, resolvePbAttachmentDisplay } from "@/lib/pocketbaseData/pbAttachments";
import {
  companyRowUsesSqliteLedgerWrites,
  isServerGateCompany,
  shouldReadLedgerFromSqliteOnly,
} from "@/lib/companyStorageKind";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import { isFirebaseLedgerCompanyAttachmentSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { localCompanyAttachmentStrategy } from "@/lib/companyAttachmentStrategies/localCompanyAttachmentStrategy";
import { onlineCompanyAttachmentStrategy } from "@/lib/companyAttachmentStrategies/onlineCompanyAttachmentStrategy";
import { serverCompanyAttachmentStrategy } from "@/lib/companyAttachmentStrategies/serverCompanyAttachmentStrategy";
import type {
  AttachmentDisplayOptions,
  AttachmentDisplayResult,
  CompanyAttachmentMode,
} from "@/lib/companyAttachmentStrategies/types";

export type StaticAttachmentDisplayResult = AttachmentDisplayResult;
export type StaticAttachmentDisplayOptions = AttachmentDisplayOptions;
type CompanyStrategyRow = {
  id?: string;
  name?: string;
  ownerId?: string;
  plServerShared?: boolean;
  storageOption?: string | null;
  syncPolicy?: string | null;
  syncedFromCloud?: boolean;
  authoritativeCompanyId?: string;
} | null | undefined;

export function companyAttachmentMode(
  company: CompanyStrategyRow,
  options?: { localLedgerOnly?: boolean; companyMode?: CompanyAttachmentMode }
): CompanyAttachmentMode {
  if (options?.companyMode) return options.companyMode;
  if (company && isServerGateCompany(company)) return "server";
  // Files OFF / explicit cache-only — before cloud/sqlite classification.
  if (options?.localLedgerOnly === true) return "local";
  // Online cloud company: ledger SQLite-first ho sakta hai; attachment strategy online rahe (Files tick network gate).
  if (company && isCloudBackedCompanyShape(company as never)) return "online";
  if (company && shouldReadLedgerFromSqliteOnly(company)) return "local";
  return "online";
}

function strategyForMode(mode: CompanyAttachmentMode) {
  if (mode === "server") return serverCompanyAttachmentStrategy;
  if (mode === "local") return localCompanyAttachmentStrategy;
  return onlineCompanyAttachmentStrategy;
}

/** Local/server ledger: static app me HTTPS thumbnail mat, disk/cache/server endpoint se dikhao. */
export function companyRequiresLocalAttachmentUrlsOnly(
  company: CompanyStrategyRow
): boolean {
  return strategyForMode(companyAttachmentMode(company)).requiresLocalAttachmentUrlsOnly;
}

/**
 * Gallery / list thumbs: kab device-cache-only (Firebase Storage network mat).
 * Online + Files tick ON: SQLite-first ledger ke bawajood network lazy load allow.
 * Online + Files OFF / Local / PL: device cache + `local:` only.
 */
export function companyUsesLocalAttachmentSourcesOnly(
  company: CompanyStrategyRow
): boolean {
  if (isLocalOnlyMode()) return true;
  if (!company) return false;

  // Online Firebase company: SQLite-first ledger ≠ Files block.
  if (isCloudBackedCompanyShape(company as never)) {
    const cid = String(company.id || "").trim();
    if (!cid) return true;
    return !isFirebaseLedgerCompanyAttachmentSyncEnabled(cid);
  }

  return (
    shouldReadLedgerFromSqliteOnly(company) ||
    companyRowUsesSqliteLedgerWrites(company) ||
    companyRequiresLocalAttachmentUrlsOnly(company)
  );
}

/** EXE/APK online company: local cache first; local/server company: only local/server bytes. */
export function prefersLocalAttachmentDisplayFirst(
  company: CompanyStrategyRow
): boolean {
  const strategy = strategyForMode(companyAttachmentMode(company));
  const pref = strategy.prefersLocalAttachmentDisplayFirst;
  return typeof pref === "function" ? pref() : pref;
}

/** Save strategy boundary: local + PL server + online Firebase write SQLite-first. */
export function companyStrategyUsesSqliteFirstLedgerWrites(
  company: CompanyStrategyRow
): boolean {
  const value = strategyForMode(companyAttachmentMode(company)).usesSqliteFirstLedgerWrites;
  if (typeof value === "function") return (value as () => boolean)();
  return Boolean(value);
}

/** Public resolver: delegates to the isolated local/server/online attachment strategy. */
export async function resolveStaticAttachmentDisplay(
  rawUrl: string,
  options?: StaticAttachmentDisplayOptions
): Promise<StaticAttachmentDisplayResult> {
  // Pocket Ledger Server (PocketBase) attachment link: bytes from the server, shown as a blob URL.
  if (isPbAttachmentRef(rawUrl)) return resolvePbAttachmentDisplay(rawUrl);
  const mode = options?.companyMode ?? (options?.localLedgerOnly === true ? "local" : "online");
  return strategyForMode(mode).resolveAttachmentDisplay(rawUrl, options);
}
