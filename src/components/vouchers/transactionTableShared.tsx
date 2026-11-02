"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, History, CheckCircle, CheckCheck, CheckSquare, Printer, MousePointerClick, RefreshCw, Loader2, CircleOff, Trash2 } from "lucide-react";
import { StatementCheckedRowMessageLabel } from "@/components/vouchers/StatementCheckedRowMessageLabel";
import { statementCheckedMessageColumn } from "@/lib/statementCheckRowMessage";
import { VoucherAttachmentFileIndicator } from "@/components/vouchers/VoucherAttachmentFileIndicator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AttachmentHoverPortal } from "@/components/vouchers/AttachmentHoverPortal";
import { NoFileAwareHoverPortal } from "@/components/vouchers/AttachmentNoFileEye";
import { MultiAttachmentPortalPreview } from "@/components/vouchers/attachmentHoverPreviewBody";
import { differenceInDays } from "date-fns";
import { shouldAutoWarmAttachmentForLedgerRow } from "@/lib/fyPagination/attachmentFyAutoLoadPolicy";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";
import usePermissions from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/use-mobile";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/utils";
import { isTransactionColumnVisible } from "@/lib/transactionVisibleColumnShow";
import {
  LEDGER_TDS_ROW_FLAG,
  SALE_PURCHASE_TDS_UNVERIFIED_MESSAGE,
  SALE_PURCHASE_TDS_VERIFIED_MESSAGE,
  isLedgerTdsTableRow,
  isSalePurchaseTdsVerifyLedgerContext,
  isUnverifiedLedgerTdsBillRow,
  isUnverifiedTaxTdsBalanceRow,
  ledgerTdsRowAmountToneClass,
  ledgerTdsTypeDisplayLabel,
  ledgerTdsTypePillDrCrSide,
  resolveSalePurchaseTdsVerifyLabel,
  taxAccountIsTdsVerifyLegOnVoucher,
} from "@/lib/partyLedgerTdsView";
import { Switch } from "@/components/ui/switch";
import { isLedgerTransactionPeerPendingChange, isLedgerTransactionUnapproved } from "@/lib/ledgerPendingApproval";
import { toast } from "sonner";
import { txnSelectedMainRowCn, txnSelectedNarrationRowCn, txnTableIconBtnCn } from "@/lib/listSelectionChrome";
import { getAllocationTotal } from "@/lib/payment-allocation-utils";
import type { Item } from "@/components/items/types";
import { motion } from "framer-motion";
import { FISCAL_YEAR_PARTITION_ROW_TYPE } from "@/lib/fiscalPartitionRows";
import { FY_OPENING_ROW_TYPE } from "@/lib/fyPagination/fyOpeningRows";
import {
  buildFiscalMergePartitionBannerSplitForDateSystem,
  buildFyOpeningPillSplit,
  buildFyPartitionOpeningPillLabel,
  parseFiscalPartitionBoundaryMs,
} from "@/lib/fiscalYearLabel";
import { useFyOpeningPillFormat } from "@/hooks/useFyOpeningPillFormat";
import { FyOpeningPillFormatPill } from "@/components/vouchers/FyOpeningPillFormatPill";
import {
  LEDGER_ENTITY_BALANCE_COL_PX,
  LEDGER_ENTITY_TYPE_COL_PX,
  LEDGER_ENTITY_USER_COL_PX,
  LEDGER_TDS_AMOUNT_CELL_PAD_CN,
  LEDGER_TDS_AMOUNT_COL_PX,
  LEDGER_TDS_TAXABLE_CELL_PAD_CN,
  LEDGER_TDS_TAXABLE_COL_PX,
  LEDGER_TDS_VOUCHER_NO_COL_PX,
  LEDGER_TDS_USER_CELL_PAD_CN,
  LEDGER_TDS_ROW_TEXT_CELL_PAD_CN,
  LEDGER_TDS_DR_CR_AMOUNT_CELL_CN,
  LEDGER_TDS_DR_CR_COL_PX,
  LEDGER_TDS_FILE_COL_PX,
  LEDGER_TDS_FILE_CELL_PAD_CN,
  LEDGER_BOTH_DATE_BS_AD_GAP_PX,
  LEDGER_BOTH_DATE_BS_CELL_PAD_CN,
  LEDGER_ENTITY_DATE_BS_COL_PX,
  LEDGER_TDS_DATE_TO_TYPE_GAP_PX,
  LEDGER_TDS_DATE_COL_PX,
  LEDGER_TDS_LAST_DATE_CELL_PAD_CN,
  LEDGER_TXN_BALANCE_TO_MENU_PAD_CN,
  LEDGER_TXN_ROW_MENU_CELL_CN,
  LEDGER_TXN_BODY_CELL_PAD_CN,
  LEDGER_TXN_COL_MAX_GAP_PAD_CN,
  LEDGER_TXN_DR_CR_AMOUNT_CELL_CN,
  LEDGER_TXN_DR_CR_COL_PX,
} from "@/lib/ledgerHeaderChrome";
import {
  FiscalPartitionClosingSummaryTableRows,
  type FiscalPartitionColumnLayout,
} from "@/components/vouchers/FiscalPartitionClosingSummaryBlock";
import type { FiscalPartitionClosingSummary } from "@/lib/fiscalPartitionClosingSummary";
import { getAttachmentFormatLabel, getAttachmentFormatLabelFromHints } from "@/lib/attachmentFormatLabel";
import { getLocalFileRefMetaSync, isLocalFileRef } from "@/lib/localPendingFiles";

/**
 * Single-attachment double-click open: "pdf" (URL ext or local: meta hints), "unknown" (local: without
 * hints - openAttachmentInApp sniffs), null = no direct open (images keep the portal behaviour).
 */
function txnAttachmentOpenKind(url: string): "pdf" | "unknown" | null {
  if (getAttachmentFormatLabel(url) === "PDF") return "pdf";
  if (!isLocalFileRef(url)) return null;
  const meta = getLocalFileRefMetaSync(url);
  const lbl = getAttachmentFormatLabelFromHints(meta?.fileName ?? null, meta?.contentType ?? null);
  if (lbl === "PDF") return "pdf";
  return lbl ? null : "unknown";
}
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
import { companyRequiresLocalAttachmentUrlsOnly } from "@/lib/staticAttachmentDisplayUrl";
import { getVoucherAttachmentUrlsForUi, voucherAttachmentUiOptionsForCompany } from "@/lib/voucherAttachmentNormalize";
import { formatVoucherEntryTimeLocal, parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { getJournalVoucherLegs } from "@/lib/journalLedgerAmounts";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { drCrChipKey, drCrOppositeKey, tdsBadgeHighlightQuery } from "@/lib/transactionColumnHeaderFilter";

/** File column / attachment thumb — row dblclick se voucher edit na khule (EXE/web). */
function stopTxnRowOpenFromFilePreview(e: React.SyntheticEvent): void {
  e.stopPropagation();
}

function isTxnFilePreviewInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "[data-pl-txn-file-cell],[data-pl-txn-file-thumb],[data-pl-txn-file-nofile],[data-attachment-index],[data-attachment-preview-portal]"
    )
  );
}
import {
  isRecurringBsMonthlyAutoVoucherForLedgerUserDisplay,
  resolveLedgerTransactionUserDisplayName,
  shouldShowAutoRecurringSwitchInLedgerUserCell,
} from "@/lib/ledgerUserColumnDisplay";
import { isInterCompanyVoucherEditDeleteBlocked } from "@/lib/interCompany/interCompanyVoucherHydrate";
import {
  sharedUserCanApproveInterCompanyVoucher,
  sharedUserCanEditInterCompanyVoucher,
} from "@/lib/interCompany/interCompanyVoucherAccess";

/**
 * Ledger row Dr/Cr/Balance: kabhi Firestore/legacy `debit`/`credit` object ho — table me `[object Object]` na aaye.
 * Animated `formatCurrency` ReactNode ko `String()` se mat ghumao.
 */
function toLedgerAmount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  if (v != null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.toNumber === "function") {
      try {
        const n = Number((o.toNumber as () => unknown)());
        if (Number.isFinite(n)) return n;
      } catch {
        /* ignore */
      }
    }
    if ("amount" in o) return toLedgerAmount(o.amount);
  }
const n = Number(v as number);
  return Number.isFinite(n) ? n : 0;
}

export function getDisplayVoucherNumber(t: any): string {
  if (!t) return "";
  const rawVoucherNumber = String(t.voucherNumber ?? t.voucher_number ?? "").trim();
  if (t.type !== "contra") return rawVoucherNumber;
  const outNo = String(t.voucherNumberOut ?? "").trim();
  const inNo = String(t.voucherNumberIn ?? "").trim();
  if (rawVoucherNumber) return rawVoucherNumber;
  return outNo || inNo || "";
}

function getContraVoucherSearchAliases(t: any): string[] {
  if (!t || t.type !== "contra") return [];
  const aliases = new Set<string>(["cntr", "contra"]);
  const outNo = String(t.voucherNumberOut ?? "").trim();
  const inNo = String(t.voucherNumberIn ?? "").trim();
  const rawVoucherNumber = String(t.voucherNumber ?? t.voucher_number ?? "").trim();

  if (outNo) {
    aliases.add(outNo);
    aliases.add("out");
    aliases.add("cntr out");
    aliases.add("contra out");
    aliases.add("cntra out");
  }
  if (inNo) {
    aliases.add(inNo);
    aliases.add("in");
    aliases.add("cntr in");
    aliases.add("contra in");
    aliases.add("cntra in");
  }
  if (rawVoucherNumber) {
    const lower = rawVoucherNumber.toLowerCase();
    if (/\bout\b/.test(lower)) {
      aliases.add("out");
      aliases.add("cntr out");
      aliases.add("contra out");
      aliases.add("cntra out");
    }
    if (/\bin\b/.test(lower)) {
      aliases.add("in");
      aliases.add("cntr in");
      aliases.add("contra in");
      aliases.add("cntra in");
    }
  }
  return Array.from(aliases);
}

export type Context =
  | "party"
  | "group"
  | "daybook"
  | "account"
  | "staff"
  | "tax"
  | "tax_group"
  | "item"
  | "expense"
  | "note"
  | "other";

export type Transaction = Record<string, any>;
export type FileColumnDisplayMode = "preview" | "tick";
export type FileColumnFilterMode = "all" | "with" | "without";

export const TXN_FILE_COLUMN_VIEW_PREF_KEY = "pocket-ledger:transactions:file-column-view:v1";

export function readSavedFileColumnViewPrefs(): {
  displayMode: FileColumnDisplayMode;
  showAll: boolean;
  filterMode: FileColumnFilterMode;
} {
  if (typeof window === "undefined") return { displayMode: "preview", showAll: false, filterMode: "all" };
  try {
    const raw = window.localStorage.getItem(TXN_FILE_COLUMN_VIEW_PREF_KEY);
    if (!raw) return { displayMode: "preview", showAll: false, filterMode: "all" };
    const parsed = JSON.parse(raw) as { displayMode?: unknown; showAll?: unknown; filterMode?: unknown };
    const displayMode: FileColumnDisplayMode = parsed.displayMode === "tick" ? "tick" : "preview";
    const filterMode =
      parsed.filterMode === "with" || parsed.filterMode === "without" ? parsed.filterMode : "all";
    return { displayMode, showAll: displayMode === "preview" && parsed.showAll === true, filterMode };
  } catch {
    return { displayMode: "preview", showAll: false, filterMode: "all" };
  }
}

export function saveFileColumnViewPrefs(
  displayMode: FileColumnDisplayMode,
  showAll: boolean,
  filterMode: FileColumnFilterMode
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    TXN_FILE_COLUMN_VIEW_PREF_KEY,
    JSON.stringify({ displayMode, showAll: displayMode === "preview" && showAll === true, filterMode })
  );
}

/** Portal preview — stable memo taaki table re-render / reuse-border tick par fetch/spinner reset na ho. */
function StableAttachmentPortalPreview({
  urls,
  companyId,
  voucherId,
}: {
  urls: readonly string[];
  companyId?: string | null;
  voucherId?: string | null;
}) {
  // Join by content — parent har render pe naya `urls` array deta hai; `urls` ko dep mat banao warna
  // MultiAttachmentPreview har tick pe remount → fetch cancel → portal spinner forever (origin/green row zyada).
  const urlsKey = urls.map((u) => String(u || "").trim()).filter(Boolean).join("\x1e");
  const stableUrls = React.useMemo(
    () => (urlsKey ? urlsKey.split("\x1e") : []),
    [urlsKey]
  );
  return React.useMemo(
    () => (
      <MultiAttachmentPortalPreview
        urls={stableUrls}
        companyId={companyId}
        voucherId={voucherId}
      />
    ),
    [stableUrls, companyId, voucherId]
  );
}

/**
 * Ledger row par attachment — File column filter (with / without / all).
 */
export function transactionRowHasFileAttachment(t: { fileUrls?: unknown; unassignedFile?: unknown } | null | undefined): boolean {
  return getVoucherAttachmentUrlsForUi(t).length > 0;
}

/**
 * Opening balance row — File column: entity `documentFileUrls` par voucher jaisa hover preview + green tick (`local:` refs supported).
 */
export function OpeningBalanceFileCellContent({
  fileUrls,
  displayMode = "preview",
  showAll = false,
}: {
  fileUrls?: readonly string[] | null;
  displayMode?: FileColumnDisplayMode;
  showAll?: boolean;
}) {
  const { company } = useCompany();
  const localLedgerOnly = companyRequiresLocalAttachmentUrlsOnly(company);
  const urls = Array.isArray(fileUrls)
    ? fileUrls.map((u) => String(u)).filter((s) => s.length > 0)
    : [];
  if (urls.length === 0) {
    return <span>-</span>;
  }

  const indicator =
    showAll && displayMode === "preview" ? (
      <span className="inline-flex items-center gap-1">
        {urls.map((url, index) => (
          <span key={`${url}:${index}`} data-attachment-index={index}>
            <VoucherAttachmentFileIndicator
              urls={[url]}
              displayMode="preview"
              aria-label={`Attachment ${index + 1}`}
            />
          </span>
        ))}
      </span>
    ) : (
      <VoucherAttachmentFileIndicator urls={urls} displayMode={displayMode} aria-label="Has attachment" />
    );

  // Files tick OFF: still allow click — openAttachmentInApp opens local cache only (no download).
  const serverFb =
    company?.id && urls.length > 0
      ? { companyId: company.id, voucherId: "", clientFileUrls: urls }
      : undefined;
  const singlePdfOpen =
    urls.length === 1 && txnAttachmentOpenKind(urls[0]!) !== null
      ? (e: React.MouseEvent<HTMLDivElement>) => {
          e.stopPropagation();
          void openAttachmentInApp(urls[0]!, {
            kind: txnAttachmentOpenKind(urls[0]!) === "pdf" ? "pdf" : undefined,
            localLedgerOnly,
            serverFallback: serverFb,
            gateCompany: company,
          });
        }
      : undefined;

  return (
    <span
      data-pl-txn-file-cell=""
      className="inline-flex"
      onClick={stopTxnRowOpenFromFilePreview}
      onDoubleClick={stopTxnRowOpenFromFilePreview}
    >
      <NoFileAwareHoverPortal urls={urls}
        triggerClassName="inline-flex cursor-pointer"
        onPreviewDoubleClick={singlePdfOpen}
        galleryUrls={urls.length > 1 ? urls : undefined}
        preview={<StableAttachmentPortalPreview urls={urls} companyId={company?.id} />}
      >
        {indicator}
      </NoFileAwareHoverPortal>
    </span>
  );
}

export function MobileTransactionFilePreview({
  transaction,
  showAll = false,
  suppressAutoThumbLoad = false,
}: {
  transaction?: { fileUrls?: unknown; unassignedFile?: unknown; id?: unknown; date?: unknown } | null;
  /** File column "Show all" — ON: har file alag thumb; OFF: ek thumb (mixed source/reuse → 50/50 frame). */
  showAll?: boolean;
  suppressAutoThumbLoad?: boolean;
}) {
  const { company } = useCompany();
  const voucherAttachmentUiOpts = React.useMemo(() => voucherAttachmentUiOptionsForCompany(company), [company]);
  const urls = getVoucherAttachmentUrlsForUi(transaction, voucherAttachmentUiOpts).map((u) => String(u)).filter((s) => s.length > 0);
  if (urls.length === 0) return null;
  const localLedgerOnly = companyRequiresLocalAttachmentUrlsOnly(company);
  const serverFallback =
    company?.id
      ? {
          companyId: company.id,
          voucherId: String(transaction?.id || ""),
          clientFileUrls: urls,
        }
      : undefined;
  const portalPreviewUrls = showAll ? urls : [urls[0]!];
  const singlePdfOpen =
    !showAll && urls.length === 1 && txnAttachmentOpenKind(urls[0]!) !== null
      ? (e: React.MouseEvent<HTMLDivElement>) => {
          e.stopPropagation();
          void openAttachmentInApp(urls[0]!, {
            kind: txnAttachmentOpenKind(urls[0]!) === "pdf" ? "pdf" : undefined,
            localLedgerOnly,
            serverFallback,
            gateCompany: company,
          });
        }
      : undefined;

  const indicator =
    showAll && urls.length > 1 ? (
      <span className="inline-flex items-center gap-1">
        {urls.map((url, index) => (
          <span key={`${url}:${index}`} data-attachment-index={index}>
            <VoucherAttachmentFileIndicator
              urls={[url]}
              displayMode="preview"
              size="sm"
              aria-label={`Attachment ${index + 1}`}
              companyId={company?.id}
              voucherId={String(transaction?.id || "")}
              clientFileUrls={urls}
              suppressAutoThumbLoad={suppressAutoThumbLoad}
            />
          </span>
        ))}
      </span>
    ) : (
      <VoucherAttachmentFileIndicator
        urls={urls}
        displayMode="preview"
        size="sm"
        aria-label="Open attachment preview"
        companyId={company?.id}
        voucherId={String(transaction?.id || "")}
        clientFileUrls={urls}
        suppressAutoThumbLoad={suppressAutoThumbLoad}
      />
    );

  return (
    <span
      data-pl-txn-file-cell=""
      className="inline-flex"
      onClick={stopTxnRowOpenFromFilePreview}
      onDoubleClick={stopTxnRowOpenFromFilePreview}
    >
    <NoFileAwareHoverPortal urls={urls}
      triggerClassName="inline-flex h-7 shrink-0 cursor-pointer items-center justify-center overflow-visible rounded bg-transparent"
      onPreviewDoubleClick={singlePdfOpen}
      galleryUrls={urls.length > 1 ? urls : undefined}
      preview={
        <StableAttachmentPortalPreview
          urls={portalPreviewUrls}
          companyId={company?.id}
          voucherId={String(transaction?.id || "")}
        />
      }
    >
      {indicator}
    </NoFileAwareHoverPortal>
    </span>
  );
}

const safeToDate = (date: any): Date | null => {
  // Transaction rows may come from Firestore, local SQLite, or backup JSON; one parser keeps date/dueDate stable.
  return parseFirestoreDateFieldToJsDate(date);
};

export const getConversionFactor = (
  item: Item | undefined,
  displayUnit: string | undefined
): number => {
  if (!item || !displayUnit) return 1;
  const conversions = (item.unitConversions || []) as any[];
  if (conversions.length === 0) return 1;
  const smallestUnit =
    conversions.length > 0
      ? conversions[conversions.length - 1].toUnit
      : (item as any).openingBalanceUnit || "";
  if (displayUnit === smallestUnit) return 1;
  let factor = 1;
  let currentUnit = displayUnit;
  let attempts = 0;
  while (currentUnit !== smallestUnit && currentUnit && attempts < 10) {
    const conv = conversions.find((c: any) => c.fromUnit === currentUnit);
    if (!conv) return 1;
    factor *= Number(conv.conversionFactor) || 1;
    currentUnit = conv.toUnit;
    attempts++;
  }
  return factor > 0 ? factor : 1;
};

export const formatQuantity = (val: number) =>
  Math.abs(val).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export type GetDisplayTypeOpts = {
  context?: string;
  contextId?: string;
  groupEntityType?: string | null;
};

/** Tax ledger: sale/purchase jo TDS account pe aaye — type me TDS sale / TDS Purchase. */
function taxLedgerSalePurchaseHitsTds(t: any, taxAccountId?: string): boolean {
  const lines = Array.isArray(t?.lineItems) ? t.lineItems : [];
  if (lines.length === 0) return false;
  const taxId = String(taxAccountId ?? "").trim();
  return lines.some((li: any) => {
    const tdsAmt = Number(li?.tdsAmount) || 0;
    if (tdsAmt <= 0) return false;
    if (!taxId) return Boolean(String(li?.tdsAccountId ?? "").trim());
    return String(li?.tdsAccountId ?? "").trim() === taxId;
  });
}

export const getDisplayType = (t: any, opts?: GetDisplayTypeOpts) => {
  if (!t.type) return "";
  if (t.type === FY_OPENING_ROW_TYPE) {
    const pill = String(t._ledgerOpeningPillLabel || "").trim();
    if (pill) return pill;
    const rowDate = parseFirestoreDateFieldToJsDate(t.date);
    if (rowDate) return buildFyPartitionOpeningPillLabel(null, rowDate);
    return "fy opening";
  }
  if (t.type === "journal" && t.subType === "add_salary") return "Add Salary";
  if (t.type === "journal" && t.isTdsJournal === true) return "TDS Journal";
  if (t.type === "inter_company") return "Inter Company";
  if (t.type === "tds" || t._ledgerTdsRow || t[LEDGER_TDS_ROW_FLAG]) {
    return ledgerTdsTypeDisplayLabel(t._ledgerTdsSide);
  }
  const isTaxLedgerCtx =
    opts?.context === "tax" || (opts?.context === "group" && opts?.groupEntityType === "tax");
  if (
    isTaxLedgerCtx &&
    (t.type === "sale" ||
      t.type === "sale_service" ||
      t.type === "purchase" ||
      t.type === "purchase_service") &&
    taxLedgerSalePurchaseHitsTds(t, opts?.contextId)
  ) {
    if (t.type === "purchase" || t.type === "purchase_service") return "TDS Purchase";
    return "TDS sale";
  }
  return voucherTypeDisplayText(t.type);
};

/** Type column header filter haystack — display label + raw type + common shortcuts (e.g. ic → Inter Company). */
export function typeColumnFilterHaystackFields(t: any, opts?: GetDisplayTypeOpts): unknown[] {
  const displayType = getDisplayType(t, opts);
  const rawType = String(t?.type || "").trim();
  const fields: unknown[] = [displayType, rawType, rawType.replace(/_/g, " ")];
  if (rawType === "inter_company") {
    fields.push("ic", "intercompany", "inter co");
  }
  if (rawType === "journal" && t?.isTdsJournal === true) {
    fields.push("TDS Journal", "tds journal", "tds");
  }
  if (displayType === "TDS sale" || displayType === "TDS Purchase") {
    fields.push("TDS sale", "TDS Purchase", "tds sale", "tds purchase", "tds");
  }
  return fields;
}

/** Journal + Adjustment — multi-leg vouchers (`entries[]` ya `lines[]`). */
function isJournalOrAdjustmentEntries(t: any): boolean {
  if (t?.type !== "journal" && t?.type !== "adjustment") return false;
  return getJournalVoucherLegs(t).length > 0;
}

function journalEntryAccountLabel(e: any, names: Record<string, string>): string {
  const fromEntry = String(e?.accountName ?? "").trim();
  if (fromEntry) return fromEntry;
  const id = e?.accountId;
  if (!id) return "N/A";
  return names[String(id)] || "—";
}

function journalLikeEntriesFallbackLabel(t: any): string {
  return t.type === "adjustment" ? "Adjustment" : "Journal";
}

function getTransactionSyncStatus(t: any): "synced" | "sync_due" {
  return String(t?.__plSyncStatus || "").trim() === "sync_due" ? "sync_due" : "synced";
}

function TransactionSyncStatusCell({
  transaction,
  ensureMinGaps,
  syncInFlight,
  onSyncNow,
}: {
  transaction: any;
  ensureMinGaps?: boolean;
  syncInFlight?: boolean;
  onSyncNow?: (transaction: any) => void;
}) {
  const status = getTransactionSyncStatus(transaction);
  if (status === "synced") {
    return (
      <TableCell className={cn("text-center align-middle", ensureMinGaps && "min-w-[78px] px-[5px]")}>
        <span className="inline-flex items-center justify-center rounded-full text-green-600" title="Synced">
          <CheckCircle className="h-4 w-4" />
        </span>
      </TableCell>
    );
  }
  return (
    <TableCell className={cn("text-center align-middle", ensureMinGaps && "min-w-[78px] px-[5px]")}>
      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-amber-500/60 bg-amber-50 pl-2 pr-1 text-[10px] font-semibold text-amber-700">
        {syncInFlight ? "Syncing" : "Sync due"}
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-amber-100 disabled:cursor-wait"
          title={syncInFlight ? "Syncing this voucher" : "Sync this voucher now"}
          disabled={syncInFlight}
          onClick={(event) => {
            event.stopPropagation();
            onSyncNow?.(transaction);
          }}
        >
          {syncInFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </span>
    </TableCell>
  );
}

/** Type column pill: row amount Dr → green, Cr → red (`note` alag — neutral rehta hai). */
export type TxnDrCrSide = "dr" | "cr";

export function resolveTxnDrCrSide(debit: number, credit: number, signedBalance?: number): TxnDrCrSide | null {
  const dr = Number(debit) || 0;
  const cr = Number(credit) || 0;
  if (dr > 0 && cr <= 0) return "dr";
  if (cr > 0 && dr <= 0) return "cr";
  if (dr > 0 && cr > 0) return dr >= cr ? "dr" : "cr";
  if (typeof signedBalance === "number" && signedBalance !== 0) {
    return signedBalance >= 0 ? "dr" : "cr";
  }
  return null;
}

/** Voucher row se Dr/Cr side — spend-wise linked amount bhi debit/credit columns jaisa. */
export function resolveTxnDrCrSideFromTransaction(
  t: any,
  opts?: { spendWiseLinkedAmount?: number }
): TxnDrCrSide | null {
  if (!t || t.type === "note") return null;
  let debit = toLedgerAmount(t.debit);
  let credit = toLedgerAmount(t.credit);
  const linked = opts?.spendWiseLinkedAmount;
  if (typeof linked === "number" && linked > 0) {
    const isOutflow =
      t.type === "payment_out" ||
      t.type === "direct_expense" ||
      Number(t.credit) > 0;
    if (isOutflow) {
      debit = 0;
      credit = linked;
    } else {
      debit = linked;
      credit = 0;
    }
  }
  const bal =
    typeof t.balance === "number"
      ? t.balance
      : typeof t.runningBalance === "number"
        ? t.runningBalance
        : undefined;
  return resolveTxnDrCrSide(debit, credit, bal);
}

/** Reverted IC voucher — type column pill blue (Dr/Cr dono equal hone par green na dikhe). */
export function isInterCompanyReversedVoucher(t: { type?: string; interCompanyReversed?: boolean } | null | undefined): boolean {
  return String(t?.type || "") === "inter_company" && t?.interCompanyReversed === true;
}

/** Type pill classes — Dr green / Cr red; reverted IC = blue; `null` = default outline. */
export function voucherTypePillClassName(
  side: TxnDrCrSide | null,
  opts?: { interCompanyReversed?: boolean }
): string {
  const base = "inline-flex h-6 items-center rounded-xl px-2.5 font-medium";
  if (opts?.interCompanyReversed) {
    return cn(
      base,
      "border-blue-600/50 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-600/40"
    );
  }
  if (side === "dr") {
    return cn(
      base,
      "border-green-600/50 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 dark:border-green-600/40"
    );
  }
  if (side === "cr") {
    return cn(
      base,
      "border-red-600/50 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 dark:border-red-600/40"
    );
  }
  return base;
}

/** Note voucher: Firestore par entityName + entityId — Daybook Accounts column ke liye */
export const getNoteLinkedEntityLabel = (t: any, names: Record<string, string> = {}) => {
  const fromDoc = typeof t.entityName === "string" && t.entityName.trim() ? t.entityName.trim() : "";
  const fromMap = t.entityId ? names[t.entityId] : "";
  return fromDoc || fromMap || (t.entityId ? String(t.entityId) : "") || "N/A";
};

export const getParticularsText = (t: any, names: Record<string, string> = {}) => {
  const getName = (id: string | undefined) => (id ? (names[id] || "—") : "N/A");
  if (t.type === "sale") {
    const partyName = getName(t.partyId);
    const accountName = getName(t.accountId);
    return accountName && accountName !== "N/A" ? `To: ${partyName} (via ${accountName})` : `To: ${partyName}`;
  }
  if (t.type === "purchase") {
    const partyName = getName(t.partyId);
    const accountName = getName(t.accountId);
    return accountName && accountName !== "N/A" ? `From: ${partyName} (via ${accountName})` : `From: ${partyName}`;
  }
  if (t.type === "payment_in") {
    const payeeName = names[t.partyId] || names[t.staffId] || names[t.taxAccountId] || names[t.incomeAccountId] || t.payeeName || "N/A";
    const accountName = getName(t.accountId);
    return accountName && accountName !== "N/A" ? `From: ${payeeName} (via ${accountName})` : `From: ${payeeName}`;
  }
  if (t.type === "payment_out") {
    const payeeName = names[t.partyId] || names[t.staffId] || names[t.taxAccountId] || names[t.expenseAccountId] || t.payeeName || "N/A";
    const accountName = getName(t.accountId);
    return accountName && accountName !== "N/A" ? `To: ${payeeName} (via ${accountName})` : `To: ${payeeName}`;
  }
  if (t.type === "contra") return `${getName(t.fromAccountId)} to ${getName(t.toAccountId)}`;
  if (t.type === "direct_income") {
    const incomeAccountName = getName(t.incomeAccountId);
    const accountName = getName(t.accountId);
    return accountName && accountName !== "N/A" ? `By: ${incomeAccountName} (via ${accountName})` : `By: ${incomeAccountName}`;
  }
  if (t.type === "direct_expense") {
    const toAccountId = t.toAccountId || t.expenseAccountId;
    const toAccountName = getName(toAccountId);
    const accountName = getName(t.fromAccountId || t.accountId);
    return accountName && accountName !== "N/A" ? `To: ${toAccountName} (via ${accountName})` : `To: ${toAccountName}`;
  }
  if (isJournalOrAdjustmentEntries(t)) {
    const legs = getJournalVoucherLegs(t);
    const dr = legs.filter((e) => (Number(e.debit) || 0) > 0).map((e) => `Dr: ${journalEntryAccountLabel(e, names)}`);
    const cr = legs.filter((e) => (Number(e.credit) || 0) > 0).map((e) => `Cr: ${journalEntryAccountLabel(e, names)}`);
    return [...dr, ...cr].join(", ");
  }
  if (t.type === "note") return `Note for: ${getNoteLinkedEntityLabel(t, names)}`;
  return t.narration || "";
};

/** One account / opposite side only (for mobile card - no "From/To X (via Y)"). */
export const getOppositeAccountLabel = (
  t: any,
  names: Record<string, string> = {},
  context?: Context,
  contextId?: string,
  groupEntityType?: "party" | "account" | "staff" | "tax" | "expense" | "item"
): string => {
  const getName = (id: string | undefined) => {
    if (!id) return "";
    const n = String(names[id] || "").trim();
    // Missing map → empty so payment_in/out fallbacks (payeeName / labels) run on APK.
    if (!n || n === "—" || n === "-") return "";
    return n;
  };
  // Keep voucher title clean: hide placeholder-only labels like "—, —".
  const sanitizeOpposite = (raw: string): string => {
    const text = String(raw || "").trim();
    if (!text) return "";
    const normalized = text.replace(/[,\s]/g, "");
    if (!normalized) return "";
    return /^[—-]+$/.test(normalized) ? "" : text;
  };
  const labelFromJournalEntry = (e: any) => {
    const raw = String(e?.accountName ?? "").trim();
    if (raw) return raw;
    const id = e?.accountId;
    return id ? getName(id) : "N/A";
  };
  const getPartyDisplay = (partyId: string | undefined) => {
    // Item-ledger rows can carry partyName even when id->name map is incomplete.
    const fromMap = partyId ? names[partyId] : undefined;
    return fromMap || t.partyName || t.payeeName || "—";
  };
  if (context === "item" && (t.type === "sale" || t.type === "purchase")) {
    return getPartyDisplay(t.partyId);
  }
  if (context === "item" && t.type === "note") {
    // Item details note row should display linked item/entity name in Party column.
    return getNoteLinkedEntityLabel(t, names);
  }
  // Party context: show opposite/counter account (bank, expense, etc.) not the current party
  if (context === "party" && contextId) {
    const partyInTx =
      t.partyId === contextId ||
      (isJournalOrAdjustmentEntries(t) && t.entries.some((e: any) => e?.accountId === contextId));
    if (partyInTx) {
      if (t.type === "sale") return getName(t.salesAccountId || "sales_account") || "Sales Account";
      if (t.type === "purchase") return getName(t.purchaseAccountId || "purchase_account") || "Purchase Account";
      if (t.type === "payment_in") return getName(t.accountId) || "Receipt";
      if (t.type === "payment_out") return getName(t.accountId) || getName(t.fromAccountId) || "Payment";
      if (t.type === "direct_income") return getName(t.accountId) || "Direct Income";
      if (t.type === "direct_expense") return getName(t.fromAccountId) || getName(t.accountId) || "Direct Expense";
      if (t.type === "contra") return getName(t.fromAccountId) || getName(t.toAccountId);
      if (isJournalOrAdjustmentEntries(t)) {
        const partyEntry = t.entries.find((e: any) => e?.accountId === contextId);
        const oppositeSide = partyEntry ? ((Number(partyEntry?.debit) || 0) > 0 ? "credit" : "debit") : "debit";
        const oppositeEntry = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId && (Number(e?.[oppositeSide]) || 0) > 0);
        if (oppositeEntry?.accountId) return sanitizeOpposite(labelFromJournalEntry(oppositeEntry));
        const anyOther = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId);
        if (anyOther?.accountId) return sanitizeOpposite(labelFromJournalEntry(anyOther));
        return journalLikeEntriesFallbackLabel(t);
      }
      if (t.type === "note") return getNoteLinkedEntityLabel(t, names);
    }
  }
  // Tax group: sale/purchase show party (opposite of tax), not Sales/Purchase account
  if (context === "group" && groupEntityType === "tax" && (t.type === "sale" || t.type === "purchase")) {
    return getName(t.partyId);
  }
  // Item group: sale/purchase should show party (same as item details Party column).
  if (context === "group" && groupEntityType === "item" && (t.type === "sale" || t.type === "purchase")) {
    return getPartyDisplay(t.partyId);
  }
  if (context === "group" && groupEntityType === "item" && t.type === "note") {
    // Item-group note rows should display linked item/entity name in Party column.
    return getNoteLinkedEntityLabel(t, names);
  }
  // Group context: sale/purchase show Sales/Purchase account (party group, etc.)
  if (context === "group" && (t.type === "sale" || t.type === "purchase")) {
    if (t.type === "sale") return getName(t.salesAccountId || "sales_account") || "Sales Account";
    if (t.type === "purchase") return getName(t.purchaseAccountId || "purchase_account") || "Purchase Account";
  }
  // Account group: show opposite (party/staff/tax/income/expense) for payments, like bank details
  if (context === "group" && groupEntityType === "account") {
    if (t.type === "payment_in") return (t.partyId && getName(t.partyId)) || (t.staffId && getName(t.staffId)) || (t.taxAccountId && getName(t.taxAccountId)) || (t.incomeAccountId && getName(t.incomeAccountId)) || t.payeeName || "N/A";
    if (t.type === "payment_out") return (t.partyId && getName(t.partyId)) || (t.staffId && getName(t.staffId)) || (t.taxAccountId && getName(t.taxAccountId)) || (t.expenseAccountId && getName(t.expenseAccountId)) || t.payeeName || "N/A";
    if (t.type === "direct_income") return getName(t.incomeAccountId);
    if (t.type === "direct_expense") return getName(t.toAccountId || t.expenseAccountId);
    if (t.type === "contra") return getName(t.fromAccountId) || getName(t.toAccountId);
    if (isJournalOrAdjustmentEntries(t)) {
      const parts = t.entries.slice(0, 2).map((e: any) => labelFromJournalEntry(e));
      return sanitizeOpposite(parts.join(", ")) || journalLikeEntriesFallbackLabel(t);
    }
  }
  // Account (bank) context: show opposite account - Sales/Purchase for sale/purchase, party for payments, etc.
  const accountInTx = context === "account" && contextId && (
    t.accountId === contextId ||
    (t.type === "contra" && (t.fromAccountId === contextId || t.toAccountId === contextId)) ||
    (isJournalOrAdjustmentEntries(t) && t.entries.some((e: any) => e?.accountId === contextId))
  );
  if (accountInTx) {
    if (t.type === "sale") return getName(t.salesAccountId || "sales_account") || "Sales Account";
    if (t.type === "purchase") return getName(t.purchaseAccountId || "purchase_account") || "Purchase Account";
    if (t.type === "payment_in") return (t.partyId && getName(t.partyId)) || (t.staffId && getName(t.staffId)) || (t.taxAccountId && getName(t.taxAccountId)) || (t.incomeAccountId && getName(t.incomeAccountId)) || t.payeeName || "N/A";
    if (t.type === "payment_out") return (t.partyId && getName(t.partyId)) || (t.staffId && getName(t.staffId)) || (t.taxAccountId && getName(t.taxAccountId)) || (t.expenseAccountId && getName(t.expenseAccountId)) || t.payeeName || "N/A";
    if (t.type === "direct_income") return getName(t.incomeAccountId);
    if (t.type === "direct_expense") return getName(t.toAccountId || t.expenseAccountId);
    if (t.type === "contra") return getName(t.fromAccountId === contextId ? t.toAccountId : t.fromAccountId);
    if (isJournalOrAdjustmentEntries(t)) {
      const accountEntry = t.entries.find((e: any) => e?.accountId === contextId);
      const oppositeSide = accountEntry ? ((Number(accountEntry?.debit) || 0) > 0 ? "credit" : "debit") : "debit";
      const oppositeEntry = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId && (Number(e?.[oppositeSide]) || 0) > 0);
      if (oppositeEntry?.accountId) return sanitizeOpposite(labelFromJournalEntry(oppositeEntry));
      const anyOther = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId);
      if (anyOther?.accountId) return sanitizeOpposite(labelFromJournalEntry(anyOther));
      return journalLikeEntriesFallbackLabel(t);
    }
  }
  // Expense ledger rows should also resolve an actual opposite account next to voucher number.
  const expenseInTx =
    context === "expense" &&
    contextId &&
    (t.expenseAccountId === contextId ||
      t.incomeAccountId === contextId ||
      t.toAccountId === contextId ||
      t.accountId === contextId ||
      (isJournalOrAdjustmentEntries(t) && t.entries.some((e: any) => e?.accountId === contextId)));
  if (expenseInTx) {
    if (t.type === "direct_expense") return sanitizeOpposite(getName(t.fromAccountId || t.accountId));
    if (t.type === "direct_income") return sanitizeOpposite(getName(t.accountId));
    if (t.type === "payment_in") {
      return sanitizeOpposite(
        (t.partyId && getName(t.partyId)) ||
        (t.staffId && getName(t.staffId)) ||
        (t.taxAccountId && getName(t.taxAccountId)) ||
        t.payeeName ||
        getName(t.accountId)
      );
    }
    if (t.type === "payment_out") {
      return sanitizeOpposite(
        (t.partyId && getName(t.partyId)) ||
        (t.staffId && getName(t.staffId)) ||
        (t.taxAccountId && getName(t.taxAccountId)) ||
        t.payeeName ||
        getName(t.fromAccountId || t.accountId)
      );
    }
    if (isJournalOrAdjustmentEntries(t)) {
      const selectedEntry = t.entries.find((e: any) => e?.accountId === contextId);
      const oppositeSide = selectedEntry ? ((Number(selectedEntry?.debit) || 0) > 0 ? "credit" : "debit") : "debit";
      const oppositeEntry = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId && (Number(e?.[oppositeSide]) || 0) > 0);
      if (oppositeEntry?.accountId) return sanitizeOpposite(labelFromJournalEntry(oppositeEntry));
      const anyOther = t.entries.find((e: any) => e?.accountId && e.accountId !== contextId);
      if (anyOther?.accountId) return sanitizeOpposite(labelFromJournalEntry(anyOther));
      return journalLikeEntriesFallbackLabel(t);
    }
  }
  const isStaffContext =
    context === "staff" ||
    (context === "group" && (t?.subType === "add_salary" || !!t?.staffId));
  const staffId = isStaffContext ? contextId : undefined;
  const taxId = t.taxAccountId as string | undefined;

  if (isStaffContext) {
    const isTaxLikeId = (id: string | undefined) => {
      if (!id) return false;
      if (taxId && id === taxId) return true;
      const label = (names[id] || "").toLowerCase();
      return label.includes("tax") || label.includes("tds") || label.includes("vat");
    };
    const pickFirstValidId = (ids: Array<string | undefined>) =>
      ids.find((id) => id && id !== staffId && !isTaxLikeId(id));

    // Payment in/out: show bank account (opposite of staff)
    if (t.type === "payment_in" || t.type === "payment_out") {
      const bankId = t.type === "payment_in" ? t.accountId : (t.fromAccountId || t.accountId);
      if (bankId) return getName(bankId);
      const oppositeId = pickFirstValidId([
        t.accountId,
        t.fromAccountId,
        t.toAccountId,
        t.expenseAccountId,
        t.incomeAccountId,
        t.partyId,
      ]);
      return oppositeId ? getName(oppositeId) : t.payeeName || "N/A";
    }

    if (t.type === "journal" && t.subType === "add_salary" && Array.isArray(t.entries)) {
      const nonStaffEntries = t.entries.filter((e: any) => e?.accountId && e.accountId !== staffId);
      const expenseEntry =
        nonStaffEntries.find((e: any) => (Number(e?.debit) || 0) > 0 && !isTaxLikeId(e.accountId)) ||
        nonStaffEntries.find((e: any) => (Number(e?.debit) || 0) > 0) ||
        nonStaffEntries.find((e: any) => !isTaxLikeId(e.accountId)) ||
        nonStaffEntries[0];
      if (expenseEntry?.accountId) return sanitizeOpposite(labelFromJournalEntry(expenseEntry));
      return "Add Salary";
    }

    if (isJournalOrAdjustmentEntries(t)) {
      const selectedEntry = t.entries.find((e: any) => e?.accountId === staffId);
      const preferredSide = (Number(selectedEntry?.credit) || 0) > 0 ? "debit" : "credit";
      const nonStaffEntries = t.entries.filter((e: any) => e?.accountId && e.accountId !== staffId);
      const oppositeEntry =
        nonStaffEntries.find((e: any) => (Number(e?.[preferredSide]) || 0) > 0 && !isTaxLikeId(e.accountId)) ||
        nonStaffEntries.find((e: any) => !isTaxLikeId(e.accountId)) ||
        nonStaffEntries[0];
      if (oppositeEntry?.accountId) return sanitizeOpposite(labelFromJournalEntry(oppositeEntry));
    }
  }

  if (t.type === "sale") return getName(t.partyId);
  if (t.type === "purchase") return getName(t.partyId);
  // Tax context: add_salary → staff; sale/purchase already party above; payment → party/staff if set
  const isTaxContext = context === "tax" || context === "tax_group";
  if (isTaxContext && t.type === "journal" && t.subType === "add_salary" && Array.isArray(t.entries)) {
    const staffNames = t.entries
      .filter((e: any) => {
        const credit = Number(e.credit) || 0;
        if (credit <= 0) return false;
        return !String(e.narration || "").includes("(Staff ID:");
      })
      .map((e: any) => getName(e.accountId))
      .filter(Boolean);
    if (staffNames.length > 0) return sanitizeOpposite(staffNames.join(", "));
  }
  if (isTaxContext && (t.type === "payment_in" || t.type === "payment_out")) {
    if (t.partyId) return getName(t.partyId);
    if (t.staffId) return getName(t.staffId);
    const bankId = t.type === "payment_in" ? t.accountId : (t.fromAccountId || t.accountId);
    if (bankId) return getName(bankId);
  }
  if (t.type === "payment_in") {
    return (
      names[t.partyId] ||
      names[t.staffId] ||
      names[t.taxAccountId] ||
      names[t.incomeAccountId] ||
      t.payeeName ||
      getName(t.accountId) ||
      "Receipt"
    );
  }
  if (t.type === "payment_out") {
    return (
      names[t.partyId] ||
      names[t.staffId] ||
      names[t.taxAccountId] ||
      names[t.expenseAccountId] ||
      names[t.toAccountId] ||
      t.payeeName ||
      getName(t.accountId) ||
      "Payment"
    );
  }
  if (t.type === "contra") return getName(t.toAccountId) || getName(t.fromAccountId);
  if (t.type === "direct_income") return getName(t.incomeAccountId);
  if (t.type === "direct_expense") return getName(t.toAccountId || t.expenseAccountId);
  if (isJournalOrAdjustmentEntries(t)) {
    const parts = t.entries.slice(0, 2).map((e: any) => labelFromJournalEntry(e));
    return sanitizeOpposite(parts.join(", ")) || journalLikeEntriesFallbackLabel(t);
  }
  if (t.type === "note") return getNoteLinkedEntityLabel(t, names);
  return t.narration || "";
};

/**
 * Mobile "Search transactions" text blob: voucher, narration, particulars, opposite account (card title), user display, etc.
 */
export function getTransactionQuickSearchHaystack(
  t: any,
  names: Record<string, string> = {},
  context?: Context,
  contextId?: string,
  groupEntityType?: "party" | "account" | "staff" | "tax" | "expense" | "item"
): string {
  const chunks: string[] = [
    getDisplayVoucherNumber(t),
    t?.voucherNumberOut,
    t?.voucherNumberIn,
    getDisplayType(t),
    voucherTypeSearchText(t?.type),
    t?.narration,
    typeof t?.partyName === "string" ? t.partyName : "",
    typeof t?.payeeName === "string" ? t.payeeName : "",
    typeof t?.userDisplayName === "string" ? t.userDisplayName : "",
    typeof t?.userName === "string" ? t.userName : "",
    getParticularsText(t, names),
    ...getContraVoucherSearchAliases(t),
  ];
  const uid = t?.userId;
  if (uid && names[uid]) chunks.push(names[uid]);
  if (isRecurringBsMonthlyAutoVoucherForLedgerUserDisplay(t)) chunks.push("Auto");
  if (context && contextId) {
    chunks.push(getOppositeAccountLabel(t, names, context, contextId, groupEntityType));
  }
  // Status badge + TDS Verified/Unverified — substring search (e.g. "veri" → Unverified)
  const paymentStatus = String((t as any)?.paymentStatus || "").toLowerCase();
  if (paymentStatus === "paid") chunks.push("Paid");
  else if (paymentStatus === "unpaid") chunks.push("Unpaid");
  else if (paymentStatus === "partially_paid") chunks.push("Partial", "partially_paid");
  else if (paymentStatus === "overdue" || (t as any)?.isOverdue) chunks.push("Overdue");
  if (isSalePurchaseTdsVerifyLedgerContext(context, groupEntityType)) {
    const tdsLabel = resolveSalePurchaseTdsVerifyLabel(t, {
      context,
      contextId,
      groupEntityType,
    });
    if (tdsLabel) chunks.push(tdsLabel);
  }
  return chunks.filter(Boolean).join(" ").toLowerCase();
}

const isStatusJournalOrNote = (t: any) =>
  t.type === "journal" || t.type === "note";

const isStatusJournalOrNoteOrContra = (t: any) =>
  t.type === "journal" || t.type === "note" || t.type === "contra";

/** context: on staff/group or tax ledger, Add Salary shows Paid/Unpaid/Partial/Overdue (like party), not "Journal". */
export const getStatusLabel = (t: any, context?: string) => {
  const isStaffContext = context === "staff" || context === "group";
  const isTaxContext = context === "tax" || context === "tax_group";
  const isAddSalary = t.type === "journal" && t.subType === "add_salary";
  
  // Always show real status for Add Salary transactions if paymentStatus exists
  if (isAddSalary) {
    const status = (t as any).paymentStatus;
    if (status === "paid") return "Paid";
    if (status === "unpaid") return "Unpaid";
    if (status === "partially_paid") return "Partial";
    if (status === "overdue" || (t as any).isOverdue) return "Overdue";
    // If no paymentStatus but has allocations, check payment status
    const allocations = (t.allocations as any[] | undefined) || [];
    const linkedFrom = (t.linkedFromVoucherNos as string[] | undefined) || [];
    const linkedTo = (t.linkedToVoucherNos as string[] | undefined) || [];
    if (allocations.length > 0 || linkedFrom.length > 0 || linkedTo.length > 0) {
      // Has payment links, check if fully paid
      const amount = Number(t.amount ?? t.total ?? t.debit ?? t.credit ?? 0) || 0;
      if (amount > 0) {
        const totalLinked = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        if (totalLinked >= amount) return "Paid";
        if (totalLinked > 0) return "Partial";
      }
    }
    // Default to Unpaid if no payment status info
    return "Unpaid";
  }
  
  if (isStaffContext && (t.type === "payment_out" || t.type === "direct_expense")) {
    const amountPaid = Number(t.amount ?? t.total ?? 0) || 0;
    const allocations = (t.allocations as any[] | undefined) || [];
    const totalLinked = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
    if (amountPaid <= 0) return "Unpaid";
    if (totalLinked >= amountPaid) return "Paid";
    if (totalLinked > 0) return "Partial";
    return "Unpaid";
  }
  if (t.type === "contra") return "Contra";
  if (t.type === "adjustment") return "Adjustment";
  // Party TDS details rows — Paid / Unpaid / Partial / Overdue from TDS-leg (or parent) paymentStatus.
  if (t.type === "tds" || (t as any)._ledgerTdsRow) {
    const status = (t as any).paymentStatus;
    if (status === "paid") return "Paid";
    if (status === "unpaid") return "Unpaid";
    if (status === "partially_paid") return "Partial";
    if (status === "overdue" || (t as any).isOverdue) return "Overdue";
    return "Unpaid";
  }
  // Linked settlement payment/journal on party TDS details (entity-wise).
  if ((t as any)._ledgerTdsSettlementRow) {
    const status = (t as any).paymentStatus;
    if (status === "paid") return "Paid";
    if (status === "unpaid") return "Unpaid";
    if (status === "partially_paid") return "Partial";
    if (status === "overdue" || (t as any).isOverdue) return "Overdue";
    return "Unpaid";
  }
  // Bill-wise journal: use paymentStatus (Paid/Partial/Unpaid) when set by use-transactions, same as sale/purchase.
  if (t.type === "journal" && !isAddSalary) {
    const status = (t as any).paymentStatus;
    if (status === "paid") return "Paid";
    if (status === "unpaid") return "Unpaid";
    if (status === "partially_paid") return "Partial";
    if (status === "overdue" || (t as any).isOverdue) return "Overdue";
    // No paymentStatus: fall back to "Journal" (e.g. statement view, non-bill-wise)
  }
  if (isStatusJournalOrNote(t)) return t.type === "journal" ? "Journal" : "Note";
  const status = (t as any).paymentStatus;
  if (status === "paid") return "Paid";
  if (status === "unpaid") return "Unpaid";
  if (status === "partially_paid") return "Partial";
  if (status === "overdue" || (t as any).isOverdue) return "Overdue";
  return "";
};

function transactionHasPartialPayment(t: any): boolean {
  const ps = String((t as any).paymentStatus || "");
  if (ps === "partially_paid") return true;
  if (ps === "paid") return false;
  const out = Number((t as any).outstanding);
  if (Number.isFinite(out) && out > 0) {
    const total =
      Number(t.total ?? t.amount ?? ((t.subTotal ?? 0) - (t.discount ?? 0) + (t.tax ?? 0))) || 0;
    if (total > 0 && out < total - 1e-6) return true;
  }
  const allocations = ((t as any).allocations as any[] | undefined) || [];
  if (allocations.length > 0) {
    const amount = Number(t.amount ?? t.total ?? t.debit ?? t.credit ?? 0) || 0;
    if (amount > 0) {
      const totalLinked = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      if (totalLinked > 0 && totalLinked < amount - 1e-6) return true;
    }
  }
  return false;
}

export function transactionIsOverdueStatus(t: any): boolean {
  if ((t as any).isOverdue || (t as any).paymentStatus === "overdue") return true;
  const out = Number((t as any).outstanding);
  if (!(Number.isFinite(out) && out > 0)) return false;
  const due = safeToDate((t as any).dueDate);
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueOnly = new Date(due);
  dueOnly.setHours(0, 0, 0, 0);
  return today > dueOnly;
}

/** Bill-wise: partial + overdue → ek hi pill. */
export const STATUS_LABEL_PARTIAL_OVERDUE = "Partial/Overdue";

export function getStatusLabels(t: any, context?: string): string[] {
  const overdue = transactionIsOverdueStatus(t);
  const partial = transactionHasPartialPayment(t);
  if (overdue && partial) return [STATUS_LABEL_PARTIAL_OVERDUE];
  const single = getStatusLabel(t, context);
  return single ? [single] : [];
}

/** Status pill outline colors — Adjustment: Dr green, Cr red (party bill-wise ledger). */
export function getStatusBadgeOutlineClassName(
  statusLabel: string,
  transaction: any,
  opts?: { debit?: number; credit?: number }
): string {
  if (statusLabel === "Adjustment") {
    const dr = Number(opts?.debit ?? toLedgerAmount(transaction.debit)) || 0;
    const cr = Number(opts?.credit ?? toLedgerAmount(transaction.credit)) || 0;
    if (dr > 0) return "text-green-600 border-green-600/50";
    if (cr > 0) return "text-red-600 border-red-600/50";
  }

  if (["Journal", "Note", "Contra", "Salary"].includes(statusLabel)) {
    return "text-muted-foreground border-muted-foreground/40";
  }

  if (statusLabel === "Settled" || statusLabel === "Paid" || (transaction as any).paymentStatus === "paid") {
    return "text-green-600 border-green-600/50";
  }

  if (
    statusLabel === STATUS_LABEL_PARTIAL_OVERDUE ||
    statusLabel === "Partial" ||
    statusLabel === "Unpaid" ||
    statusLabel === "Overdue" ||
    (transaction as any).paymentStatus === "unpaid" ||
    (transaction as any).paymentStatus === "partially_paid" ||
    (transaction as any).isOverdue ||
    (transaction as any).paymentStatus === "overdue"
  ) {
    return "text-red-600 border-red-600/50";
  }

  return "text-muted-foreground";
}

/** Days overdue (today - dueDate). Returns 0 if not overdue or no dueDate. */
const getOverdueDays = (t: any): number => {
  if (!transactionIsOverdueStatus(t)) return 0;
  const due = safeToDate(t.dueDate);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueOnly = new Date(due);
  dueOnly.setHours(0, 0, 0, 0);
  if (today <= dueOnly) return 0;
  return differenceInDays(today, dueOnly);
};


/** Status detail: list all linked voucher nos only (no "from"/"to" prefix). When billWiseOnly: ONLY bill-wise fields — never fall back to spend-wise–mixed linkedFromVoucherNos. */
export const getStatusDetail = (t: any, opts?: { billWiseOnly?: boolean }) => {
  const billWiseOnly = opts?.billWiseOnly === true;
  const fromRaw = (
    billWiseOnly
      ? (t.linkedFromVoucherNosBillWise as string[] | undefined)
      : (t.linkedFromVoucherNos as string[] | undefined)
  ) || [];
  const toRaw = (
    billWiseOnly ? (t.linkedToVoucherNosBillWise as string[] | undefined) : (t.linkedToVoucherNos as string[] | undefined)
  ) || [];
  const all = Array.from(new Set([...fromRaw, ...toRaw])).filter(Boolean);
  if (billWiseOnly && all.length === 0) {
    const fromMixed = (t.linkedFromVoucherNos as string[] | undefined) || [];
    const toMixed = (t.linkedToVoucherNos as string[] | undefined) || [];
    const mixed = Array.from(new Set([...fromMixed, ...toMixed])).filter(Boolean);
    if (mixed.length === 0) return "";
    return mixed.join(", ");
  }
  if (all.length === 0) return "";
  return all.join(", ");
};

/** Chunk status detail (comma-separated voucher nos) into 2–3 lines for wrap (2 nos per line). */
export const getStatusDetailLines = (statusDetail: string): string[] => {
  if (!statusDetail?.trim()) return [];
  const parts = statusDetail.split(",").map((s) => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts.slice(i, i + 2).join(", "));
  }
  return lines;
};

/** Same as getStatusDetail but returns array of voucher strings for per-voucher styling (e.g. cyclical colors). */
export const getStatusDetailVouchers = (t: any, opts?: { billWiseOnly?: boolean }): string[] => {
  const billWiseOnly = opts?.billWiseOnly === true;
  const fromRaw = (
    billWiseOnly
      ? (t.linkedFromVoucherNosBillWise as string[] | undefined)
      : (t.linkedFromVoucherNos as string[] | undefined)
  ) || [];
  const toRaw = (
    billWiseOnly ? (t.linkedToVoucherNosBillWise as string[] | undefined) : (t.linkedToVoucherNos as string[] | undefined)
  ) || [];
  const merged = Array.from(new Set([...fromRaw, ...toRaw])).filter(Boolean);
  if (billWiseOnly && merged.length === 0) {
    const fromMixed = (t.linkedFromVoucherNos as string[] | undefined) || [];
    const toMixed = (t.linkedToVoucherNos as string[] | undefined) || [];
    return Array.from(new Set([...fromMixed, ...toMixed])).filter(Boolean);
  }
  return merged;
};

/** Cyclical 3 colors for multi-voucher display: 1st Blue, 2nd Gray, 3rd Green, then repeat. */
const LINKED_VOUCHER_COLOR_CLASSES = ["text-blue-600", "text-gray-600", "text-green-600"] as const;
const LINKED_VOUCHER_COLOR_CLASSES_BILLWISE = ["text-blue-600", "text-pink-600", "text-green-600"] as const;
export const getLinkedVoucherColorClass = (index: number): string =>
  LINKED_VOUCHER_COLOR_CLASSES[index % 3];

/** Renders voucher list in 2-per-line with cyclical Blue / Gray / Green (or Pink in bill-wise). Reusable for status detail and opening balance. */
export function LinkedVouchersColored({
  vouchers,
  vouchersPerLine = 2,
  className,
  align = "center",
  billWisePink = false,
  /** Print parity: inline " + " separators with flex-wrap across Status+Balance width. */
  wrapInline = false,
  onVoucherClick,
  activeVoucherNo,
}: {
  vouchers: string[];
  vouchersPerLine?: number;
  className?: string;
  align?: "start" | "center" | "end";
  /** Bill-wise: use pink instead of gray for voucher details below status. */
  billWisePink?: boolean;
  wrapInline?: boolean;
  /** Bill-wise status: temporary link-preview grouping (session only). */
  onVoucherClick?: (voucherNo: string, e: React.MouseEvent) => void;
  activeVoucherNo?: string | null;
}) {
  const activeNorm = activeVoucherNo ? String(activeVoucherNo).trim().toLowerCase() : "";
  const renderVoucher = (v: string, globalIdx: number, colorClass: string) => {
    const isActive = activeNorm && v.trim().toLowerCase() === activeNorm;
    if (!onVoucherClick) {
      return <span className={colorClass}>{v}</span>;
    }
    return (
      <button
        type="button"
        className={cn(
          colorClass,
          "font-inherit text-inherit p-0 border-0 bg-transparent cursor-pointer hover:underline",
          isActive && "underline font-bold ring-1 ring-blue-400/60 rounded-sm"
        )}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onVoucherClick(v, e);
        }}
      >
        {v}
      </button>
    );
  };
  if (!vouchers?.length) return null;
  if (wrapInline) {
    const justifyClass =
      align === "end" ? "justify-end" : align === "start" ? "justify-start" : "justify-center";
    return (
      <div className={cn("flex flex-wrap items-center gap-y-[1px] text-[10px]", justifyClass, className)}>
        {vouchers.map((v, globalIdx) => {
          const colorClass = billWisePink
            ? LINKED_VOUCHER_COLOR_CLASSES_BILLWISE[globalIdx % 3]
            : getLinkedVoucherColorClass(globalIdx);
          return (
            <React.Fragment key={globalIdx}>
              {globalIdx > 0 ? <span className="text-black"> + </span> : null}
              {renderVoucher(v, globalIdx, colorClass)}
            </React.Fragment>
          );
        })}
      </div>
    );
  }
  const lines: string[][] = [];
  for (let i = 0; i < vouchers.length; i += vouchersPerLine) {
    lines.push(vouchers.slice(i, i + vouchersPerLine));
  }
  const alignClass = align === "end" ? "items-end" : align === "start" ? "items-start" : "items-center";
  return (
    <div className={cn("flex flex-col gap-[1px] text-[10px]", alignClass, className)}>
      {lines.map((lineVouchers, lineIdx) => (
        <span key={lineIdx} className="block">
          {lineVouchers.map((v, j) => {
            const globalIdx = lineIdx * vouchersPerLine + j;
            const colorClass = billWisePink ? LINKED_VOUCHER_COLOR_CLASSES_BILLWISE[globalIdx % 3] : getLinkedVoucherColorClass(globalIdx);
            return (
              <React.Fragment key={globalIdx}>
                {j > 0 ? ", " : null}
                {renderVoucher(v, globalIdx, colorClass)}
              </React.Fragment>
            );
          })}
        </span>
      ))}
    </div>
  );
}

const LINKED_VOUCHERS_COLLAPSED_COUNT = 2;

type LinkedVouchersColoredProps = {
  vouchers: string[];
  vouchersPerLine?: number;
  className?: string;
  align?: "start" | "center" | "end";
  billWisePink?: boolean;
  wrapInline?: boolean;
  onVoucherClick?: (voucherNo: string, e: React.MouseEvent) => void;
  activeVoucherNo?: string | null;
};

/** Bill-wise status: pehle 2 linked voucher nos, baaki "Show more" / "Show less". */
export function LinkedVouchersColoredCollapsible({
  vouchers,
  collapsedCount = LINKED_VOUCHERS_COLLAPSED_COUNT,
  ...rest
}: LinkedVouchersColoredProps & { collapsedCount?: number }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!vouchers?.length) return null;
  const needToggle = vouchers.length > collapsedCount;
  const visible =
    needToggle && !expanded ? vouchers.slice(0, collapsedCount) : vouchers;
  const hiddenCount = vouchers.length - collapsedCount;

  return (
    <div className={cn("flex flex-col min-w-0", rest.align === "start" ? "items-start" : rest.align === "end" ? "items-end" : "items-center")}>
      <LinkedVouchersColored vouchers={visible} {...rest} />
      {needToggle ? (
        <button
          type="button"
          className="mt-0.5 text-[9px] font-semibold text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show less" : `Show more (+${hiddenCount})`}
        </button>
      ) : null}
    </div>
  );
}

/** Bill-wise print parity: linked voucher / overdue detail spans Status + Balance columns in narration sub-rows. */
export function BillWiseLinkedDetailCells({
  vouchers,
  overdueText,
  billWisePink = true,
  showStatus,
  hideStatusColumn,
  showBalance,
  hideBalanceColumn,
  ensureMinGaps,
}: {
  vouchers: string[];
  overdueText?: React.ReactNode;
  billWisePink?: boolean;
  showStatus: boolean;
  hideStatusColumn?: boolean;
  showBalance: boolean;
  hideBalanceColumn?: boolean;
  ensureMinGaps?: boolean;
}) {
  const hasDetail = (vouchers?.length ?? 0) > 0 || overdueText != null;
  if (!showStatus || hideStatusColumn) return null;
  const spanBoth = hasDetail && showBalance && !hideBalanceColumn;

  if (!hasDetail) {
    return (
      <>
        <TableCell className={cn("text-center align-top py-0", ensureMinGaps && "min-w-[95px] px-[5px]")} />
        {showBalance && !hideBalanceColumn && (
          <TableCell
            className={cn(
              "text-right align-top py-0 tabular-nums",
              ensureMinGaps && LEDGER_TXN_BALANCE_TO_MENU_PAD_CN
            )}
            style={ensureMinGaps ? { minWidth: LEDGER_ENTITY_BALANCE_COL_PX } : undefined}
          />
        )}
      </>
    );
  }

  return (
    <>
      <TableCell
        colSpan={spanBoth ? 2 : 1}
        className={cn(
          "text-left text-[10px] leading-tight align-top py-0 text-black whitespace-normal break-words",
          ensureMinGaps && (spanBoth ? "min-w-[210px] px-[5px]" : "min-w-[95px] px-[5px]")
        )}
      >
        <div className="flex flex-col items-start gap-[1px] min-w-0">
          <LinkedVouchersColoredCollapsible vouchers={vouchers} wrapInline align="start" billWisePink={billWisePink} />
          {overdueText ? <span className="block font-medium text-red-600">{overdueText}</span> : null}
        </div>
      </TableCell>
      {showBalance && !hideBalanceColumn && !spanBoth && (
        <TableCell
          className={cn(
            "text-right align-top py-0 tabular-nums",
            ensureMinGaps && LEDGER_TXN_BALANCE_TO_MENU_PAD_CN
          )}
          style={ensureMinGaps ? { minWidth: LEDGER_ENTITY_BALANCE_COL_PX } : undefined}
        />
      )}
    </>
  );
}

/** Chunk OB linked voucher nos into 2–3 lines (no "to" prefix). Used by TransactionsTable and BillwiseTransactionTable. */
export function openingBalanceLinkedLines(nos: string[]): string[] {
  if (!nos?.length) return [];
  const deduped = Array.from(new Set(nos));
  const lines: string[] = [];
  for (let i = 0; i < deduped.length; i += 2) {
    lines.push(deduped.slice(i, i + 2).join(", "));
  }
  return lines;
}

export const TransactionRow = React.memo(
  ({
    transaction,
    showNarration,
    userNames,
    journalAccountNames,
    accountNames,
    context,
    contextId,
    groupEntityType,
    stockView,
    displayUnit,
    item,
    onRowClick,
    onAddLink,
    onHistoryVoucher,
    onMoveVoucherToRecycleBin,
    onApproveVoucher,
    onUnapproveVoucher,
    onApproveAllVisible,
    showApproveAll = false,
    onRowSelect,
    isSelected,
    isRelatedBlink = false,
    isSelectedRowBlink = false,
    getDisplayValue,
    isTaxContext,
    isBalanceMasked,
    hideBalanceColumn,
    hideStatusColumn,
    visibleColumns,
    useOutstandingForBalance,
    isBillWise,
    ensureMinGaps = false,
    showFileColumn = false,
    fileDisplayMode = "preview",
    fileShowAll = false,
    showItemPartyColumn = true,
    isSpendWiseChild = false,
    isSpendWiseGroupFirst = false,
    isSpendWiseGroupLast = false,
    spendWiseRunningBalance,
    spendWiseGroupColorIndex,
    spendWiseGroupSize,
    blinkMode,
    animateLayout = false,
    statusBillWiseOnly = false,
    /** Party ledger: use default true — unapproved (`isApproved` !== true) pink main + narration row */
    highlightPendingApproval = true,
    /** Bill-wise + fiscal divider: full table colspan for banner row. */
    fullRowColSpan,
    /** FY merge divider: previous period Total Dr/Cr + closing balance block. */
    fiscalPartitionClosingSummary,
    fiscalPartitionColumnLayout,
    /** Recent/top Search: global pink highlight (sirf is query). Column header filters alag — `columnFilters`. */
    textSearchHighlight,
    /** Column header filter values — highlight sirf usi column cell me. */
    columnFilters,
    /** List index: main + narration dono rows ko same gray/white stripe (nth-child odd/even se alag nahi). */
    txnStripeIndex,
    /** Check mode: keyboard focus row (scroll-into-view) */
    isCheckModeFocused = false,
    /** Check mode: Space mark — halka green bg (border nahi) */
    isCheckModeMarked = false,
    /** 3-dot Mark as checked — amber row + Dr/Cr message (check mode se alag) */
    isStatementChecked = false,
    onMarkAsChecked,
    /** Spend-wise group card: 3-dot me Select + Print */
    spendWiseInGroupCard = false,
    showSpendWiseGroupMenuActions = false,
    onPrintRow,
    syncInFlight = false,
    onSyncNow,
    /** IC row badge: ledger se edit + Change Detected compare dialog */
    onInterCompanyChangeDetectedClick,
    /** Enabled recurring templates se active trigger ids — switch sirf in par (dashboard jaisa). */
    activeRecurringTriggerVoucherIds = null,
    showOpeningBalanceAmount = true,
    onToggleOpeningBalanceAmount,
    onStatusLinkedVoucherClick,
    statusLinkedVoucherPreviewActive,
    enforceCurrentFyAttachmentAutoLoad = false,
  }: any) => {
    const { company } = useCompany();
    const { format: fyOpeningPillFormat } = useFyOpeningPillFormat();
    const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } = useDate();
    const localLedgerOnly = companyRequiresLocalAttachmentUrlsOnly(company);
    const voucherAttachmentUiOpts = React.useMemo(() => voucherAttachmentUiOptionsForCompany(company), [company]);
    /* Main + narration hover ek block — narration par mouse par bhi dono rows highlight (globals.css [data-pl-txn-hovered]) */
    const [pairHovered, setPairHovered] = React.useState(false);
    const mainRowRef = React.useRef<HTMLTableRowElement>(null);
    const narrRowRef = React.useRef<HTMLTableRowElement>(null);
    const onPairHoverEnter = React.useCallback(() => setPairHovered(true), []);
    const clearPairHoverIfLeavingBlock = React.useCallback((e: React.MouseEvent) => {
      const rel = e.relatedTarget;
      if (rel instanceof Node) {
        if (mainRowRef.current?.contains(rel) || narrRowRef.current?.contains(rel)) return;
      }
      setPairHovered(false);
    }, []);
    const txnLayoutKey = `${String((transaction as { id?: unknown })?.id ?? "")}:${txnStripeIndex ?? ""}:${animateLayout ? 1 : 0}`;
    const [txnLayoutLayerHot, setTxnLayoutLayerHot] = React.useState(true);
    const [txnLayoutAnimating, setTxnLayoutAnimating] = React.useState(false);
    React.useEffect(() => {
      setTxnLayoutLayerHot(true);
    }, [txnLayoutKey]);
    const startTxnLayoutAnim = React.useCallback(() => setTxnLayoutAnimating(true), []);
    const finishTxnLayoutLayer = React.useCallback(() => {
      setTxnLayoutAnimating(false);
      setTxnLayoutLayerHot(false);
    }, []);

    // Merge fiscal mode: FY ke beech full-width divider — amounts / row actions nahi.
    if (transaction.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      const span = typeof fullRowColSpan === "number" && fullRowColSpan > 0 ? fullRowColSpan : 12;
      const boundaryMs = parseFiscalPartitionBoundaryMs(transaction);
      const partitionDate = boundaryMs != null ? new Date(boundaryMs) : null;
      const partitionLabels =
        partitionDate && !Number.isNaN(partitionDate.getTime())
          ? buildFiscalMergePartitionBannerSplitForDateSystem(
              company,
              partitionDate,
              dateSystem,
              formatDate,
              company?.fiscalPartitionLabel ?? null,
              fyOpeningPillFormat
            )
          : null;
      const closingEndLabel =
        partitionLabels?.closingEndLabel ??
        (typeof (transaction as any)._partitionLabel === "string" && (transaction as any)._partitionLabel
          ? (transaction as any)._partitionLabel
          : "── Closing fiscal period · New fiscal period ──");
      const newStartLabel =
        partitionLabels?.newStartLabel ??
        closingEndLabel;
      const summary = fiscalPartitionClosingSummary as FiscalPartitionClosingSummary | null | undefined;
      const showDrCr = company?.showDrCr !== false;
      const formatAmt = (n: number) =>
        formatCurrencyForPrint(n, { noSuffix: true, context: "transaction", noAnimation: true });

      const columnLayout = fiscalPartitionColumnLayout as FiscalPartitionColumnLayout | undefined;
      const layout: FiscalPartitionColumnLayout =
        columnLayout && columnLayout.leadingColSpan >= 0
          ? columnLayout
          : {
              leadingColSpan: Math.max(0, span - 2 - 1),
              showDebit: true,
              showCredit: true,
              showStatus: false,
              showBalance: true,
              trailingMenuCol: 1,
            };

      const MotionTr = motion.tr;

      return (
        <>
          {summary ? (
            <FiscalPartitionClosingSummaryTableRows
              summary={summary}
              formatAmount={formatAmt}
              showDrCr={showDrCr}
              layout={layout}
              partitionClosingEndLabel={closingEndLabel}
              rowClassName=""
              TableRowComponent={
                MotionTr as unknown as React.ComponentType<React.HTMLAttributes<HTMLTableRowElement>>
              }
              onRowClickStop={(e) => e.stopPropagation()}
            />
          ) : null}
          <MotionTr
            layout={animateLayout ? "position" : false}
            layoutDependency={txnLayoutKey}
            initial={false}
            data-row="fiscal-partition-label"
            className="cursor-default bg-background hover:!bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <TableCell colSpan={span} className="py-1 px-3 text-left align-middle bg-background">
              <span className="text-xs font-semibold normal-case tracking-wide text-foreground">
                {newStartLabel}
              </span>
            </TableCell>
          </MotionTr>
        </>
      );
    }

    const isFyOpeningRow = transaction.type === FY_OPENING_ROW_TYPE;
    const isSpendWiseInGroup = isSpendWiseGroupFirst || isSpendWiseGroupLast || isSpendWiseChild || (transaction as any)._spendWiseGroupFirst;
    const hasSpendWiseColor = typeof spendWiseGroupColorIndex === "number";
    const swColor = hasSpendWiseColor && (spendWiseGroupColorIndex === 1 ? "green" : spendWiseGroupColorIndex === 2 ? "pink" : "blue");
    // Bank spend-wise: split-group page edges — bank Account / Group details set _spendWisePageShow*; else full-group first/last.
    const effSpendTop =
      typeof (transaction as any)._spendWisePageShowTopEdge === "boolean"
        ? (transaction as any)._spendWisePageShowTopEdge
        : isSpendWiseGroupFirst;
    const effSpendBottom =
      typeof (transaction as any)._spendWisePageShowBottomEdge === "boolean"
        ? (transaction as any)._spendWisePageShowBottomEdge
        : isSpendWiseGroupLast;
    const useRowSpendBorders = hasSpendWiseColor && !spendWiseInGroupCard;
    const spendWiseBorderFirst = useRowSpendBorders && effSpendTop && cn(
      "[&>td]:border-t-2 [&>td]:border-b-0 [&>td]:border-solid",
      swColor === "green" && "[&>td]:border-t-green-500 [&>td:first-child]:border-l-green-500 [&>td:last-child]:border-r-green-500",
      swColor === "pink" && "[&>td]:border-t-pink-500 [&>td:first-child]:border-l-pink-500 [&>td:last-child]:border-r-pink-500",
      swColor === "blue" && "[&>td]:border-t-blue-500 [&>td:first-child]:border-l-blue-500 [&>td:last-child]:border-r-blue-500",
      "[&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2",
      "[&>td:first-child]:rounded-tl-xl [&>td:last-child]:rounded-tr-xl [&>td:first-child]:overflow-hidden [&>td:last-child]:overflow-hidden"
    );
    const spendWiseBorderMid = useRowSpendBorders && !effSpendTop && !effSpendBottom && isSpendWiseInGroup && cn(
      "[&>td]:border-t-0 [&>td]:border-b-0 [&>td]:border-solid",
      swColor === "green" && "[&>td:first-child]:border-l-green-500 [&>td:last-child]:border-r-green-500",
      swColor === "pink" && "[&>td:first-child]:border-l-pink-500 [&>td:last-child]:border-r-pink-500",
      swColor === "blue" && "[&>td:first-child]:border-l-blue-500 [&>td:last-child]:border-r-blue-500",
      "[&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2"
    );
    const isMobileView = useIsMobile();
    const showCol = (key: string) =>
      isTransactionColumnVisible(visibleColumns, key, {
        isMobileView,
        forceDateOnMobile: true,
      });
    const { effectiveNotificationSettings, company: icAccessCompany } = useCompany();
    const { user, customUser } = useAuth();
    const currentUserUid = user?.uid ?? null;
    const currentUserDisplayName = customUser?.displayName || user?.displayName || user?.email || null;
    const { can, canDeleteVoucher } = usePermissions();
  const isIcRow = (t: unknown) => {
    const link = (t as { interCompanyLink?: { linkId?: string } } | null)?.interCompanyLink;
    return !!(link && String(link.linkId || "").trim());
  };
  /** IC rows: separate "Approve IC voucher" permission (either side); others: approve_transactions. */
  const canApproveThisRow = (t: unknown) =>
    isIcRow(t) ? sharedUserCanApproveInterCompanyVoucher(icAccessCompany, can) : can("approve_transactions");
  const canEditIcRows = sharedUserCanEditInterCompanyVoucher(icAccessCompany, can);
    const isNote = context === "note";
    const { settings: animationSettings } = useAnimationSettings();
    const isRowAnimationEnabled = animationSettings?.rows?.enabled === true;
    const rawRowDuration = isRowAnimationEnabled ? animationSettings.rows.duration : 0;
    const rowAnimationDuration = rawRowDuration;
    const txnLayoutOn = Boolean(animateLayout && isRowAnimationEnabled);
    const txnLayoutTransition = txnLayoutOn
      ? { duration: rowAnimationDuration, ease: "easeInOut" as const, layout: { duration: rowAnimationDuration, ease: "easeInOut" as const } }
      : { duration: 0 };
    const txnLayoutStyle = txnLayoutOn && txnLayoutLayerHot
      ? ({
          isolation: "isolate",
          willChange: "transform",
          ...(txnLayoutAnimating ? { zIndex: 4 } : {}),
        } as const)
      : undefined;
    const isNumberAnimationEnabled = animationSettings?.numbers?.enabled === true;
    const numberAnimationDuration = isNumberAnimationEnabled ? (animationSettings?.numbers?.duration ?? 2.5) : 0;

    const d = safeToDate(transaction.date);
    const fyOpeningPillSplit =
      isFyOpeningRow && d
        ? buildFyOpeningPillSplit(company, d, dateSystem, fyOpeningPillFormat)
        : null;
    // Desktop table me bhi mobile card wali same entry-time priority dikhani hai: createdAt -> edited/updated -> voucher date.
    const entryClock = formatVoucherEntryTimeLocal(transaction as Record<string, unknown>);
    let debit = toLedgerAmount(transaction.debit);
    let credit = toLedgerAmount(transaction.credit);
    let balance = toLedgerAmount(transaction.balance);
    const spendWiseGroupBalance =
      typeof spendWiseRunningBalance === "number" ? spendWiseRunningBalance : null;
    if (typeof (transaction as any)._spendWiseLedgerRunningBalance === "number") {
      balance = Number((transaction as any)._spendWiseLedgerRunningBalance);
    } else if (typeof spendWiseRunningBalance === "number") {
      balance = spendWiseRunningBalance;
    }
    const spendWiseBlinkBalance = spendWiseGroupBalance ?? balance;
    const spendWiseLinkedAmount = (transaction as any)._spendWiseLinkedAmount;
    if (isSpendWiseChild && typeof spendWiseLinkedAmount === "number" && spendWiseLinkedAmount > 0) {
      const isOutflow = (transaction.type === "payment_out" || transaction.type === "direct_expense") || (Number(transaction.credit) > 0);
      if (isOutflow) {
        debit = 0;
        credit = spendWiseLinkedAmount;
      } else {
        debit = spendWiseLinkedAmount;
        credit = 0;
      }
    }
    if (context === "item" && stockView === "qty" && item) {
      const factor = getConversionFactor(item, displayUnit);
      debit = debit / factor;
      credit = credit / factor;
      balance = balance / factor;
    }
    const fyOpeningDrCrSide: TxnDrCrSide | null = isFyOpeningRow
      ? resolveTxnDrCrSide(debit, credit, balance) ?? (Number(balance) >= 0 ? "dr" : "cr")
      : null;

    const isLedgerTdsRow = isLedgerTdsTableRow(transaction as { type?: string; [LEDGER_TDS_ROW_FLAG]?: boolean });
    const ledgerTdsAmountToneCn = isLedgerTdsRow ? ledgerTdsRowAmountToneClass(transaction) : null;
    const tdsLedgerRowLayout = ensureMinGaps && (showCol("tdsTaxable") || showCol("tdsAmount"));
    const tdsRowTextPadCn = tdsLedgerRowLayout ? LEDGER_TDS_ROW_TEXT_CELL_PAD_CN : null;
    // TDS Paid/Unpaid badge (statement AND bill-wise): TDS Balance rows, tax page, and
    // TDS-bearing Sale/Purchase (party) / Add Salary (staff) rows on the regular Account Balance page.
    const showTdsVerifyBadge =
      isLedgerTdsRow ||
      context === "tax" ||
      (context === "group" && groupEntityType === "tax") ||
      isSalePurchaseTdsVerifyLedgerContext(context, groupEntityType);
    const salePurchaseTdsVerifyLabel = showTdsVerifyBadge && isSalePurchaseTdsVerifyLedgerContext(context, groupEntityType)
      ? resolveSalePurchaseTdsVerifyLabel(transaction, { context, contextId, groupEntityType })
      : null;
    const salePurchaseTdsVerifyCol =
      salePurchaseTdsVerifyLabel != null ? statementCheckedMessageColumn(debit, credit) : null;
    const isTaxPageTdsVerifyRow =
      context === "tax" || (context === "group" && groupEntityType === "tax");
    const taxCtxIdForTdsBalance = isTaxPageTdsVerifyRow ? String(contextId ?? "").trim() : "";
    const isTaxTdsUnverifiedRow = Boolean(
      taxCtxIdForTdsBalance && isUnverifiedTaxTdsBalanceRow(transaction, taxCtxIdForTdsBalance)
    );
    const isTaxTdsVerifiedRow = Boolean(
      taxCtxIdForTdsBalance &&
        taxAccountIsTdsVerifyLegOnVoucher(transaction, taxCtxIdForTdsBalance) &&
        salePurchaseTdsVerifyLabel === SALE_PURCHASE_TDS_VERIFIED_MESSAGE
    );
    // Party/staff TDS details: same dim + Waiting as tax page for Unverified bill legs.
    const isPartyStaffTdsUnverifiedRow = Boolean(isUnverifiedLedgerTdsBillRow(transaction));
    const isPartyStaffTdsVerifiedRow = Boolean(
      isLedgerTdsRow &&
        !isPartyStaffTdsUnverifiedRow &&
        salePurchaseTdsVerifyLabel === SALE_PURCHASE_TDS_VERIFIED_MESSAGE
    );
    const isTdsUnverifiedBooksRow = false as boolean;
    const isTdsVerifiedBooksRow = false as boolean;
    const taxTdsAmountWeightCn = isTdsUnverifiedBooksRow
      ? "font-normal [&>*]:opacity-45"
      : isTdsVerifiedBooksRow
        ? "font-bold"
        : null;
    const salePurchaseTdsVerifyBadge = salePurchaseTdsVerifyLabel ? (
      <span
        data-tds-verify-badge={salePurchaseTdsVerifyLabel === SALE_PURCHASE_TDS_VERIFIED_MESSAGE ? "verified" : "unverified"}
        className={cn(
          // italic glyphs stick out of the box — extra pr + w-max/shrink-0 so the fill covers the full label
          "inline-flex w-max shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-solid box-border pl-2 pr-3 py-0 text-[9px] font-bold italic leading-4",
          salePurchaseTdsVerifyLabel === SALE_PURCHASE_TDS_VERIFIED_MESSAGE
            ? "!border-green-700 bg-green-100 text-green-800 dark:!border-green-400 dark:bg-green-950/40 dark:text-green-200"
            : "!border-amber-600 bg-amber-100 text-amber-900 dark:!border-amber-400 dark:bg-amber-950/40 dark:text-amber-200"
        )}
      >
        {(() => { const hlQ = [String(textSearchHighlight ?? "").trim(), tdsBadgeHighlightQuery(
            String((salePurchaseTdsVerifyCol && columnFilters && columnFilters[drCrOppositeKey(salePurchaseTdsVerifyCol)]) || ""),
            salePurchaseTdsVerifyLabel,
            String((salePurchaseTdsVerifyCol && columnFilters && columnFilters[drCrChipKey(drCrOppositeKey(salePurchaseTdsVerifyCol))]) || "")
          )].filter(Boolean).join(" "); return hlQ ? (highlightQueryInText(salePurchaseTdsVerifyLabel, hlQ) as React.ReactNode) : salePurchaseTdsVerifyLabel; })()}
      </span>
    ) : null;
    const tdsVerifyDrCrMinPx =
      tdsLedgerRowLayout || salePurchaseTdsVerifyLabel != null
        ? LEDGER_TDS_DR_CR_COL_PX
        : LEDGER_TXN_DR_CR_COL_PX;

    // Blink animation: Dr/Cr/Balance numerals + Dr/Cr suffix only — not group border / full cell (see MainRow, no row-level animate).
    const activeBlinkModes = Array.isArray(blinkMode) ? blinkMode : [];
    const shouldBlinkByAll =
      activeBlinkModes.includes("all") &&
      isSpendWiseGroupLast &&
      hasSpendWiseColor &&
      spendWiseBlinkBalance !== 0 &&
      !isBalanceMasked;
    const shouldBlinkByGroup =
      activeBlinkModes.includes("group") &&
      isSpendWiseGroupLast &&
      hasSpendWiseColor &&
      spendWiseBlinkBalance !== 0 &&
      !isBalanceMasked &&
      (spendWiseGroupSize ?? 0) > 1;
    const shouldBlinkByRowMode =
      activeBlinkModes.includes("row") &&
      isSelectedRowBlink &&
      hasSpendWiseColor &&
      !isBalanceMasked;
    const shouldRowModeSameVoucherBlink =
      activeBlinkModes.includes("row") &&
      hasSpendWiseColor &&
      !isBalanceMasked &&
      (isRelatedBlink || isSelectedRowBlink);
    const isGroupBalanceNonZero = shouldBlinkByAll || shouldBlinkByGroup || shouldBlinkByRowMode;
    const shouldAnimateSpendWiseAmountText =
      isGroupBalanceNonZero ||
      shouldRowModeSameVoucherBlink ||
      ((isRelatedBlink || isSelectedRowBlink) && !isSelected);

    const formatAnimatedAmountText = (value: number) =>
      formatCurrencyForPrint(value, { noSuffix: true, context: "transaction" });

    const formatBalanceCell = (value: number) => {
      const isItemQty = context === "item" && stockView === "qty";
      if (isItemQty)
        return `${formatQuantity(value)} ${displayUnit || ""}`;
      const absValue = Math.abs(value);
      const suffix = value >= 0 ? "Dr" : "Cr";
      const formattedText = `${formatAnimatedAmountText(absValue)} ${suffix}`;
      return (
        <span className={cn("font-bold", value >= 0 ? "text-green-700" : "text-red-700")}>
          {isNumberAnimationEnabled && numberAnimationDuration > 0 ? (
            <AnimatedNumber
              value={absValue}
              duration={numberAnimationDuration}
              formatter={(n) => `${formatAnimatedAmountText(Math.abs(Number(n) || 0))} ${suffix}`}
            />
          ) : (
            formattedText
          )}
        </span>
      );
    };

    // Per-row outstanding: Dr amount (sale, payment_out) → Dr balance; Cr amount (payment_in, purchase) → Cr balance.
    const getOutstandingBalanceDisplay = () => {
      const out = Number((transaction as any).outstanding) || 0;
      const hasDrAmount = (Number(debit) || 0) > 0;
      const value = hasDrAmount ? out : -out;
      return formatBalanceCell(value);
    };

    /** Daybook search highlight: string pe column+global `hl`, `AnimatedNumber` jaisa ReactNode seedha */
    const renderHlDrCr = (formatted: React.ReactNode, columnKey: "debit" | "credit" | "balance") =>
      typeof formatted === "string" || typeof formatted === "number"
        ? hlForColumn(columnKey)(String(formatted))
        : formatted;

    const renderFyOpeningDrCrCell = (side: "dr" | "cr") => {
      const colKey: "debit" | "credit" = side === "dr" ? "debit" : "credit";
      const drAmt = Number(debit) || 0;
      const crAmt = Number(credit) || 0;
      const amount = side === "dr" ? drAmt : crAmt;
      if (!onToggleOpeningBalanceAmount) {
        return amount > 0 ? renderHlDrCr(formatAmountCell(amount), colKey) : renderHlDrCr("-", colKey);
      }
      if (!showOpeningBalanceAmount) {
        return side === "dr" ? (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpeningBalanceAmount(e);
            }}
          >
            Show Amount
          </button>
        ) : (
          renderHlDrCr("-", colKey)
        );
      }
      if (amount > 0) return renderHlDrCr(formatAmountCell(amount), colKey);
      const showHideToggle =
        (side === "cr" && drAmt > 0) ||
        (side === "dr" && crAmt > 0) ||
        (side === "dr" && drAmt <= 0 && crAmt <= 0);
      if (showHideToggle) {
        return (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpeningBalanceAmount(e);
            }}
          >
            Hide Amount
          </button>
        );
      }
      return renderHlDrCr("-", colKey);
    };

    // User column — recurring BS-month = Auto; "Auto" snapshot se IC/payment flicker na ho
    const displayName = resolveLedgerTransactionUserDisplayName(transaction, userNames, {
      currentUserUid,
      currentUserDisplayName,
    });
    const names = { ...journalAccountNames, ...userNames, ...(accountNames || {}) };
    const globalHlQ = String(textSearchHighlight ?? "").trim();
    const hlForColumn = (columnKey: string) => {
      const colQ = String((columnFilters && columnFilters[columnKey]) || "").trim();
      const q = [globalHlQ, colQ].filter(Boolean).join(" ");
      const amountCol = columnKey === "debit" || columnKey === "credit";
      return (s: string) => (q ? (highlightQueryInText(s, q, amountCol ? { amount: true } : undefined) as React.ReactNode) : s);
    };
    const hl = hlForColumn(""); // global only (narration / misc)
    const isItemPartyContext = context === "item" || (context === "group" && groupEntityType === "item");
    // AnimatedNumber is a React node (cannot be highlighted): use plain text while a Debit/Credit filter is typed.
    const drCrFilterTyping = Boolean(
      String((columnFilters && columnFilters.debit) || "").trim() || String((columnFilters && columnFilters.credit) || "").trim()
    );
    const shouldDisableAmountTextAnimation =
      (context === "daybook" && globalHlQ.length > 0) || (context === "item" && stockView === "qty") || drCrFilterTyping;

    const formatAmountCell = (val: number) => {
      const n = toLedgerAmount(val);
      if (n === 0) return "-";
      if (context === "item" && stockView === "qty") {
        return `${formatQuantity(n)} ${displayUnit || ""}`;
      }
      if (!isNumberAnimationEnabled || numberAnimationDuration <= 0 || shouldDisableAmountTextAnimation) {
        return getDisplayValue(n);
      }
      return (
        <AnimatedNumber
          value={n}
          duration={numberAnimationDuration}
          formatter={(next) => formatAnimatedAmountText(Number(next) || 0)}
        />
      );
    };

    const isPeerPendingChange = isLedgerTransactionPeerPendingChange(
      transaction as { type?: string; interCompanyPeerPending?: unknown }
    );

    const mainRowContent = (
      <>
        {showCol("syncStatus") && (
          <TransactionSyncStatusCell
            transaction={transaction}
            ensureMinGaps={ensureMinGaps}
            syncInFlight={syncInFlight}
            onSyncNow={onSyncNow}
          />
        )}
        {showCol("date") &&
          (() => {
            const hasTdsLedgerCols = showCol("tdsTaxable") || showCol("tdsAmount");
            const bsDateMinPx =
              LEDGER_ENTITY_DATE_BS_COL_PX +
              (dateSystem === "Both" ? LEDGER_BOTH_DATE_BS_AD_GAP_PX : 0);
            const tdsLastDateMinPx = hasTdsLedgerCols ? LEDGER_TDS_DATE_COL_PX : 112;
            const lastDatePad =
              ensureMinGaps && hasTdsLedgerCols
                ? LEDGER_TDS_LAST_DATE_CELL_PAD_CN
                : ensureMinGaps
                  ? "min-w-[112px] px-[5px]"
                  : undefined;
            const tdsDateCellStyle =
              ensureMinGaps && hasTdsLedgerCols
                ? {
                    minWidth: `${tdsLastDateMinPx}px`,
                    maxWidth: `${tdsLastDateMinPx}px`,
                  }
                : undefined;
            return dateSystem === "Both" ? (
              <>
                <TableCell
                  className={cn(
                    ensureMinGaps ? LEDGER_BOTH_DATE_BS_CELL_PAD_CN : undefined,
                    hasTdsLedgerCols && "overflow-x-clip"
                  )}
                  style={ensureMinGaps ? { minWidth: `${bsDateMinPx}px` } : undefined}
                >
                  {d ? hlForColumn("date_bs")(formatDateBS(d)) : ""}
                </TableCell>
                <TableCell
                  data-pl-ledger-txn-last-date-cell=""
                  className={cn(
                    typeof lastDatePad === "string" ? lastDatePad : undefined,
                    "whitespace-nowrap",
                    (hasTdsLedgerCols || ensureMinGaps) && "overflow-x-clip"
                  )}
                  style={tdsDateCellStyle}
                >
                  {d ? hlForColumn("date_ad")(formatDate(d)) : ""}
                  {entryClock ? (
                    <span className="ml-1 inline-block text-[10px] text-foreground/70">
                      {hlForColumn("date_ad")(entryClock)}
                    </span>
                  ) : null}
                </TableCell>
              </>
            ) : (
              <TableCell
                data-pl-ledger-txn-last-date-cell=""
                className={cn(
                  typeof lastDatePad === "string" ? lastDatePad : undefined,
                  "whitespace-nowrap",
                  (hasTdsLedgerCols || ensureMinGaps) && "overflow-x-clip"
                )}
                style={tdsDateCellStyle}
              >
                {d ? hlForColumn("date")(dateSystem === "AD" ? formatDate(d) : formatDateBS(d)) : ""}
                {entryClock ? (
                  <span className="ml-1 inline-block text-[10px] text-foreground/70">
                    {hlForColumn("date")(entryClock)}
                  </span>
                ) : null}
              </TableCell>
            );
          })()}
        {showCol("type") && (
          <TableCell
            data-pl-ledger-txn-type-cell=""
            className={cn(
              "align-middle",
              tdsLedgerRowLayout ? "overflow-x-clip" : "overflow-visible",
              tdsRowTextPadCn ?? (ensureMinGaps && LEDGER_TXN_COL_MAX_GAP_PAD_CN)
            )}
            style={
              ensureMinGaps
                ? tdsLedgerRowLayout
                  ? {
                      minWidth: `${LEDGER_ENTITY_TYPE_COL_PX}px`,
                      maxWidth: `${LEDGER_ENTITY_TYPE_COL_PX}px`,
                    }
                  : {
                      minWidth:
                        spendWiseInGroupCard ||
                        isSpendWiseChild ||
                        isSpendWiseGroupFirst ||
                        typeof spendWiseGroupColorIndex === "number"
                          ? Math.max(112, LEDGER_ENTITY_TYPE_COL_PX)
                          : LEDGER_ENTITY_TYPE_COL_PX,
                    }
                : undefined
            }
          >
            {isFyOpeningRow && fyOpeningPillSplit ? (
              <FyOpeningPillFormatPill>
                <Badge
                  variant="outline"
                  className={cn(
                    voucherTypePillClassName(fyOpeningDrCrSide ?? "dr"),
                    "w-fit max-w-none shrink-0 whitespace-nowrap"
                  )}
                >
                  {hlForColumn("type")(fyOpeningPillSplit.typePill)}
                </Badge>
              </FyOpeningPillFormatPill>
            ) : (transaction as { _ledgerTdsRow?: boolean; type?: string })[LEDGER_TDS_ROW_FLAG] ||
              (transaction as { type?: string }).type === "tds" ? (
              <Badge
                variant="outline"
                className={cn(
                  voucherTypePillClassName(ledgerTdsTypePillDrCrSide(transaction)),
                  "w-fit max-w-none shrink-0 whitespace-nowrap"
                )}
              >
                {hlForColumn("type")(getDisplayType(transaction, { context, contextId, groupEntityType }))}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className={cn(
                  voucherTypePillClassName(
                    isNote || transaction.type === "note"
                      ? "dr"
                      : resolveTxnDrCrSide(debit, credit, balance),
                    { interCompanyReversed: isInterCompanyReversedVoucher(transaction) }
                  ),
                  "w-fit max-w-none shrink-0 whitespace-nowrap"
                )}
              >
                {hlForColumn("type")(getDisplayType(transaction, { context, contextId, groupEntityType }))}
              </Badge>
            )}
          </TableCell>
        )}
        {showCol("voucherNo") && (
          <TableCell
            className={cn(
              ensureMinGaps &&
                (tdsLedgerRowLayout
                  ? cn(LEDGER_TXN_BODY_CELL_PAD_CN, "max-w-none overflow-x-clip")
                  : cn("min-w-[105px]", LEDGER_TXN_BODY_CELL_PAD_CN))
            )}
            style={
              ensureMinGaps && tdsLedgerRowLayout
                ? {
                    minWidth: `${Math.max(LEDGER_TDS_VOUCHER_NO_COL_PX, 105)}px`,
                    maxWidth: `${Math.max(LEDGER_TDS_VOUCHER_NO_COL_PX, 105)}px`,
                  }
                : undefined
            }
          >
            <span className="inline-flex max-w-full flex-wrap items-center gap-1">
              {fyOpeningPillSplit?.voucherPill ? (
                <FyOpeningPillFormatPill>
                  <Badge
                    variant="outline"
                    className={cn(
                      voucherTypePillClassName(fyOpeningDrCrSide ?? "dr"),
                      "max-w-full whitespace-nowrap"
                    )}
                  >
                    {hlForColumn("voucherNumber")(fyOpeningPillSplit.voucherPill)}
                  </Badge>
                </FyOpeningPillFormatPill>
              ) : (
              <span className="whitespace-nowrap">
                {hlForColumn("voucherNumber")(getDisplayVoucherNumber(transaction))}
              </span>
              )}
              {isPeerPendingChange ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 cursor-pointer items-center rounded-full border border-blue-600/50 bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm hover:bg-blue-600 dark:border-blue-400/50 dark:bg-blue-600 dark:hover:bg-blue-500"
                  title="Peer company saved changes — click to review and apply"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onInterCompanyChangeDetectedClick?.(transaction);
                  }}
                >
                  Change Detected
                </button>
              ) : null}
            </span>
          </TableCell>
        )}
        {context === "daybook" && (
          <TableCell className="max-w-[260px] min-w-[210px] overflow-hidden">
            <span className="block truncate" title={getParticularsText(transaction, names)}>
              {hlForColumn("accounts")(getParticularsText(transaction, names))}
            </span>
          </TableCell>
        )}
        {/* Item + Item-group page: Party/Entity column should respect page-level show/hide toggle. */}
        {isItemPartyContext && showItemPartyColumn && (
          <TableCell className="max-w-[180px] overflow-hidden text-muted-foreground" style={{ maxWidth: 90 }}>
            {(() => {
              const partyLabel = getOppositeAccountLabel(transaction, names, context, contextId, groupEntityType);
              return (
                <span className="block truncate" title={typeof partyLabel === "string" ? partyLabel : undefined}>
                  {partyLabel}
                </span>
              );
            })()}
          </TableCell>
        )}
        {showCol("user") && context !== "note" && (
          <TableCell
            className={cn(
              ensureMinGaps &&
                (tdsLedgerRowLayout
                  ? cn(LEDGER_TDS_USER_CELL_PAD_CN, "overflow-x-clip")
                  : "px-[5px]"),
              !isMobileView && shouldShowAutoRecurringSwitchInLedgerUserCell(transaction)
                ? "min-w-[148px]"
                : tdsLedgerRowLayout
                  ? "min-w-[148px]"
                  : "max-w-[150px] min-w-[120px] overflow-hidden",
            )}
            style={
              ensureMinGaps && tdsLedgerRowLayout
                ? { minWidth: `${LEDGER_ENTITY_USER_COL_PX}px`, maxWidth: `${LEDGER_ENTITY_USER_COL_PX}px` }
                : undefined
            }
          >
            {(() => {
              const showAutoRecurringSwitch = shouldShowAutoRecurringSwitchInLedgerUserCell(
                transaction,
                activeRecurringTriggerVoucherIds,
              );
              // PC / web / EXE table: Auto recurring ON → user name + switch (mobile = text only).
              if (!isMobileView && showAutoRecurringSwitch) {
                return (
                  <span
                    className="inline-flex max-w-full items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="whitespace-nowrap" title={displayName}>
                      {hlForColumn("user")(displayName)}
                    </span>
                    <Switch
                      checked
                      disabled
                      aria-label="Auto recurring voucher"
                      className="shrink-0 origin-center scale-[0.72] border-2 border-green-600 data-[state=checked]:border-green-600 dark:border-green-500 dark:data-[state=checked]:border-green-500"
                    />
                  </span>
                );
              }
              return (
                <span className="block whitespace-nowrap" title={displayName}>
                  {hlForColumn("user")(displayName)}
                </span>
              );
            })()}
          </TableCell>
        )}
        {showFileColumn && (
          <TableCell
            data-pl-txn-file-cell=""
            className={cn(
              "text-center align-middle",
              tdsLedgerRowLayout ? LEDGER_TDS_FILE_CELL_PAD_CN : ensureMinGaps && "min-w-[44px] px-[5px]"
            )}
            style={
              ensureMinGaps && tdsLedgerRowLayout ? { minWidth: `${LEDGER_TDS_FILE_COL_PX}px` } : undefined
            }
            onClick={stopTxnRowOpenFromFilePreview}
            onDoubleClick={stopTxnRowOpenFromFilePreview}
          >
            {(() => {
              const rowUrls = getVoucherAttachmentUrlsForUi(transaction, voucherAttachmentUiOpts);
              if (rowUrls.length === 0) {
                return <span className="flex w-full justify-center">-</span>;
              }
              const suppressAutoThumbLoad =
                enforceCurrentFyAttachmentAutoLoad &&
                !shouldAutoWarmAttachmentForLedgerRow(company?.country, transaction?.date, true);
              const indicator =
                fileShowAll && fileDisplayMode === "preview" ? (
                  <span className="inline-flex items-center gap-1">
                    {rowUrls.map((url, index) => (
                      <span key={`${url}:${index}`} data-attachment-index={index}>
                        <VoucherAttachmentFileIndicator
                          urls={[url]}
                          displayMode="preview"
                          aria-label={`Attachment ${index + 1}`}
                          companyId={company?.id}
                          voucherId={String(transaction.id || "")}
                          clientFileUrls={rowUrls}
                          suppressAutoThumbLoad={suppressAutoThumbLoad}
                        />
                      </span>
                    ))}
                  </span>
                ) : (
                  <VoucherAttachmentFileIndicator
                    urls={rowUrls}
                    displayMode={fileDisplayMode}
                    aria-label="Has attachment"
                    companyId={company?.id}
                    voucherId={String(transaction.id || "")}
                    clientFileUrls={rowUrls}
                    suppressAutoThumbLoad={suppressAutoThumbLoad}
                  />
                );
              // Files tick OFF: portal still opens local cache only (openAttachmentInApp — no download).
              const serverFb = company?.id
                ? {
                    companyId: company.id,
                    voucherId: String(transaction.id || ""),
                    clientFileUrls: rowUrls,
                  }
                : undefined;
              const singlePdfOpen =
                rowUrls.length === 1 && txnAttachmentOpenKind(rowUrls[0]!) !== null
                  ? (e: React.MouseEvent<HTMLDivElement>) => {
                      e.stopPropagation();
                      void openAttachmentInApp(rowUrls[0]!, {
                        kind: txnAttachmentOpenKind(rowUrls[0]!) === "pdf" ? "pdf" : undefined,
                        localLedgerOnly,
                        serverFallback: serverFb,
                        gateCompany: company,
                      });
                    }
                  : undefined;
              const filePreview = (
                <NoFileAwareHoverPortal urls={rowUrls}
                  triggerClassName="inline-flex cursor-pointer"
                  onPreviewDoubleClick={singlePdfOpen}
                  galleryUrls={rowUrls.length > 1 ? rowUrls : undefined}
                  preview={
                    <StableAttachmentPortalPreview
                      urls={rowUrls}
                      companyId={company?.id}
                      voucherId={String(transaction.id || "")}
                    />
                  }
                >
                  {indicator}
                </NoFileAwareHoverPortal>
              );
              return tdsLedgerRowLayout ? (
                <div className="flex w-full justify-center">{filePreview}</div>
              ) : (
                filePreview
              );
            })()}
          </TableCell>
        )}
        {showCol("tdsTaxable") && (
          <TableCell
            className={cn(
              // TDS ledger: left-aligned under header text.
              "text-left tabular-nums align-middle",
              ledgerTdsAmountToneCn,
              tdsRowTextPadCn ?? (ensureMinGaps && LEDGER_TDS_TAXABLE_CELL_PAD_CN)
            )}
            style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_TAXABLE_COL_PX}px` } : undefined}
          >
            {renderHlDrCr(formatAmountCell(Number(transaction._tdsTaxable) || 0), "debit")}
          </TableCell>
        )}
        {showCol("tdsAmount") && (
          <TableCell
            className={cn(
              "text-left tabular-nums align-middle",
              ledgerTdsAmountToneCn ?? "font-semibold",
              tdsRowTextPadCn ?? (ensureMinGaps && LEDGER_TDS_AMOUNT_CELL_PAD_CN)
            )}
            style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_AMOUNT_COL_PX}px` } : undefined}
          >
            {/* Settlement (linked) rows: amount only in Dr/Cr — blank TDS Amount. */}
            {(transaction as { _ledgerTdsSettlementRow?: boolean })._ledgerTdsSettlementRow
              ? renderHlDrCr("-", "credit")
              : renderHlDrCr(formatAmountCell(Number(transaction._tdsAmount) || 0), "credit")}
          </TableCell>
        )}
        {showCol("dr") && (
          <TableCell
            className={cn(
              tdsLedgerRowLayout ? "text-left" : "text-right",
              "tabular-nums",
              taxTdsAmountWeightCn
                ? cn(taxTdsAmountWeightCn, "text-green-700")
                : ledgerTdsAmountToneCn ?? "font-semibold text-green-700",
              ensureMinGaps &&
                (tdsLedgerRowLayout || salePurchaseTdsVerifyLabel != null
                  ? LEDGER_TDS_DR_CR_AMOUNT_CELL_CN
                  : LEDGER_TXN_DR_CR_AMOUNT_CELL_CN),
              tdsLedgerRowLayout && "text-left"
            )}
            style={ensureMinGaps ? { minWidth: `${tdsVerifyDrCrMinPx}px` } : undefined}
          >
            {isFyOpeningRow ? (
              renderFyOpeningDrCrCell("dr")
            ) : salePurchaseTdsVerifyCol === "debit" && salePurchaseTdsVerifyBadge ? (
              <span className={cn("inline-flex w-full", tdsLedgerRowLayout ? "justify-start" : "justify-end")}>{salePurchaseTdsVerifyBadge}</span>
            ) : isStatementChecked && statementCheckedMessageColumn(debit, credit) === "debit" ? (
              <StatementCheckedRowMessageLabel className="w-full" align="end" />
            ) : (
              renderHlDrCr(formatAmountCell(debit), "debit")
            )}
          </TableCell>
        )}
        {showCol("cr") && (
          <TableCell
            className={cn(
              tdsLedgerRowLayout ? "text-left" : "text-right",
              "tabular-nums",
              taxTdsAmountWeightCn
                ? cn(taxTdsAmountWeightCn, "text-red-700")
                : ledgerTdsAmountToneCn ?? "font-semibold text-red-700",
              ensureMinGaps &&
                (tdsLedgerRowLayout || salePurchaseTdsVerifyLabel != null
                  ? LEDGER_TDS_DR_CR_AMOUNT_CELL_CN
                  : LEDGER_TXN_DR_CR_AMOUNT_CELL_CN),
              tdsLedgerRowLayout && "text-left"
            )}
            style={ensureMinGaps ? { minWidth: `${tdsVerifyDrCrMinPx}px` } : undefined}
          >
            {isFyOpeningRow ? (
              renderFyOpeningDrCrCell("cr")
            ) : salePurchaseTdsVerifyCol === "credit" && salePurchaseTdsVerifyBadge ? (
              <span className={cn("inline-flex w-full", tdsLedgerRowLayout ? "justify-start" : "justify-end")}>{salePurchaseTdsVerifyBadge}</span>
            ) : isStatementChecked && statementCheckedMessageColumn(debit, credit) === "credit" ? (
              <StatementCheckedRowMessageLabel className="w-full" align="end" />
            ) : (
              renderHlDrCr(formatAmountCell(credit), "credit")
            )}
          </TableCell>
        )}
        {showCol("status") && !hideStatusColumn &&
          (() => {
            if (isFyOpeningRow) {
              return (
                <TableCell className={cn("text-center align-middle", ensureMinGaps && "min-w-[95px] px-[5px]")}>
                  <span className="font-semibold text-muted-foreground">-</span>
                </TableCell>
              );
            }
            const isDashboardAddSalary =
              context === "daybook" &&
              transaction.type === "journal" &&
              transaction.subType === "add_salary";
            const statusLabels = isDashboardAddSalary
              ? ["Salary"]
              : getStatusLabels(transaction, context);
            const statusDetailText = getStatusDetail(transaction, { billWiseOnly: statusBillWiseOnly });
            const statusDetailVouchersForRow = getStatusDetailVouchers(transaction, { billWiseOnly: statusBillWiseOnly });
            // Keep status voucher-link text tied to the shared "Show Narration" toggle.
            const showStatusDetailText = showNarration && !!statusDetailText;
            // Bill-wise: linked voucher nos directly under status pill (Adjustment / Journal / Paid etc.).
            const showStatusDetailUnderBadge = isBillWise && statusDetailVouchersForRow.length > 0;
            const isOverdueRow =
              statusLabels.includes("Overdue") ||
              statusLabels.includes(STATUS_LABEL_PARTIAL_OVERDUE) ||
              transactionIsOverdueStatus(transaction);
            const overdueDays = isOverdueRow ? getOverdueDays(transaction) : 0;
            // Keep status badge vertically centered like amount cells in every view.
            return (
              <TableCell className={cn("text-center align-middle", ensureMinGaps && "min-w-[95px] px-[5px]")}>
                {/* In bill-wise mode, switch to vertical stack only when detail text is visible. */}
                <div className="flex min-h-6 flex-col items-center justify-center gap-0.5 leading-tight">
                  {statusLabels.length > 0 ? (
                    statusLabels.map((statusLabel) => (
                      <Badge
                        key={statusLabel}
                        variant="outline"
                        className={cn(
                          "inline-flex h-6 items-center rounded-xl px-2.5 font-medium leading-none shrink-0",
                          getStatusBadgeOutlineClassName(statusLabel, transaction, { debit, credit })
                        )}
                      >
                        {hlForColumn("status")(statusLabel)}
                      </Badge>
                    ))
                  ) : (
                    <Badge
                      variant="outline"
                      className="inline-flex h-6 items-center rounded-xl px-2.5 font-medium leading-none shrink-0 text-muted-foreground"
                    >
                      {hlForColumn("status")("-")}
                    </Badge>
                  )}
                  {showStatusDetailUnderBadge && (
                    <LinkedVouchersColoredCollapsible
                      vouchers={statusDetailVouchersForRow}
                      align="center"
                      billWisePink={isBillWise}
                      className="text-[10px] leading-tight"
                      onVoucherClick={onStatusLinkedVoucherClick}
                      activeVoucherNo={statusLinkedVoucherPreviewActive}
                    />
                  )}
                  {isOverdueRow && overdueDays > 0 && (
                    <span className="text-[10px] text-red-600 font-medium leading-tight text-center">
                      {hlForColumn("status")(`${overdueDays} ${overdueDays === 1 ? "day" : "days"}`)}
                    </span>
                  )}
                </div>
              </TableCell>
            );
          })()}
        {showCol("runningBalance") && !hideBalanceColumn &&
          (() => {
            const fyOpeningSignedBalance =
              isFyOpeningRow
                ? useOutstandingForBalance &&
                  typeof (transaction as any)._billWiseOpeningSigned === "number" &&
                  Number.isFinite((transaction as any)._billWiseOpeningSigned)
                  ? (transaction as any)._billWiseOpeningSigned
                  : Math.abs(balance) > 1e-6
                    ? balance
                    : debit > 0
                      ? debit
                      : credit > 0
                        ? -credit
                        : 0
                : null;
            const out = Number((transaction as any).outstanding) || 0;
            const hasDrAmount = (Number(debit) || 0) > 0;
            const isStaffPaymentOut = (context === "staff" || context === "group") && (transaction.type === "payment_out" || transaction.type === "direct_expense");
            // In bill-wise mode, normal journals should reflect linkable remaining amount on the same row (per-row closing balance).
            const isJournalWithOutstanding =
              transaction.type === "journal" &&
              (transaction as any).subType !== "add_salary" &&
              (transaction as any).outstanding != null;
            const journalOutstandingSigned = isJournalWithOutstanding ? (debit > 0 ? out : -out) : 0;
            // When useOutstandingForBalance: Dr amount → Dr balance, Cr amount → Cr balance (match amount column).
            const displayValue =
              fyOpeningSignedBalance != null
                ? fyOpeningSignedBalance
                : useOutstandingForBalance && isJournalWithOutstanding
                ? journalOutstandingSigned
                : useOutstandingForBalance
                ? (isTaxContext ? (hasDrAmount ? out : -out) : (isStaffPaymentOut ? out : (hasDrAmount ? out : -out)))
                : balance;
            // When balance/outstanding is 0 show "Settled" (running balance and bill-wise both)
            const valueToShow = fyOpeningSignedBalance != null ? fyOpeningSignedBalance : useOutstandingForBalance ? displayValue : balance;
            const isZeroBalance =
              !isBalanceMasked &&
              !(isFyOpeningRow && !showOpeningBalanceAmount) &&
              fyOpeningSignedBalance == null &&
              typeof valueToShow === "number" &&
              Math.abs(valueToShow) < 1e-6;
            const balanceToneCn = isLedgerTdsRow
              ? ledgerTdsAmountToneCn
              : isZeroBalance
                ? "text-green-700"
                : displayValue >= 0
                  ? "text-green-700"
                  : "text-red-700";
            return (
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  "font-semibold",
                  balanceToneCn,
                  isTdsVerifiedBooksRow && "font-bold",
                  ensureMinGaps && LEDGER_TXN_BALANCE_TO_MENU_PAD_CN
                )}
                style={ensureMinGaps ? { minWidth: LEDGER_ENTITY_BALANCE_COL_PX } : undefined}
                {...(isZeroBalance && !isLedgerTdsRow
                  ? { "data-cell-settled": "true" }
                  : {})}
              >
                {isBalanceMasked ? (
                  "*****"
                ) : isFyOpeningRow && !showOpeningBalanceAmount ? (
                  "-"
                ) : isZeroBalance && !isLedgerTdsRow ? (
                  <span
                    className={cn(
                      "font-bold text-green-700",
                      shouldAnimateSpendWiseAmountText && "animate-spend-wise-balance-blink"
                    )}
                  >
                    Settled
                  </span>
                ) : (
                  <span
                    className={cn(
                      "inline",
                      isTdsVerifiedBooksRow && "font-bold",
                      shouldAnimateSpendWiseAmountText && !isZeroBalance && "animate-spend-wise-balance-blink"
                    )}
                  >
                    {renderHlDrCr(
                      useOutstandingForBalance ? formatBalanceCell(displayValue) : formatBalanceCell(balance),
                      "balance"
                    )}
                  </span>
                )}
              </TableCell>
            );
          })()}
        <TableCell
          className={ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-11 min-w-[44px] p-1 text-center align-middle"}
          data-pl-txn-row-menu=""
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-pl-txn-icon-btn=""
                data-pl-txn-row-menu-trigger=""
                className={cn(txnTableIconBtnCn, "relative h-8 w-3 min-w-[12px] shrink-0 p-0")}
              >
                <span
                  aria-hidden="true"
                  className="absolute right-[4px] top-1/2 -translate-y-1/2 text-base leading-none text-muted-foreground"
                >
                  ⋮
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onMarkAsChecked ? (
                <DropdownMenuItem
                  onClick={() => onMarkAsChecked()}
                  className="flex items-center gap-2"
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {isStatementChecked ? "Unmark as reconciled" : "Mark as reconciled"}
                </DropdownMenuItem>
              ) : null}
              {showSpendWiseGroupMenuActions ? (
                <>
                  <DropdownMenuItem
                    onClick={() => onRowSelect?.(transaction)}
                    className="flex items-center gap-2"
                  >
                    <MousePointerClick className="h-3.5 w-3.5" />
                    Select
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPrintRow?.()} className="flex items-center gap-2">
                    <Printer className="h-3.5 w-3.5" />
                    Print
                  </DropdownMenuItem>
                </>
              ) : null}
              {/* Add Link action intentionally removed from 3-dot menu as per latest UX requirement. */}
              {!isFyOpeningRow &&
                canApproveThisRow(transaction) &&
                effectiveNotificationSettings?.approve?.on !== false &&
                effectiveNotificationSettings?.approve?.onTransaction !== false &&
                (transaction as any).isApproved !== true && (
                  <DropdownMenuItem onClick={() => onApproveVoucher?.(transaction)} className="flex items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Approve
                  </DropdownMenuItem>
                )}
              {!isFyOpeningRow &&
                canApproveThisRow(transaction) &&
                effectiveNotificationSettings?.approve?.on !== false &&
                effectiveNotificationSettings?.approve?.onTransaction !== false &&
                (transaction as any).isApproved === true && (
                  <DropdownMenuItem onClick={() => onUnapproveVoucher?.(transaction)} className="flex items-center gap-2">
                    <CircleOff className="h-3.5 w-3.5" />
                    Mark as unapproved
                  </DropdownMenuItem>
                )}
              {can("approve_transactions") &&
                effectiveNotificationSettings?.approve?.on !== false &&
                effectiveNotificationSettings?.approve?.onTransaction !== false &&
                showApproveAll &&
                onApproveAllVisible && (
                  <DropdownMenuItem onClick={() => onApproveAllVisible()} className="flex items-center gap-2">
                    <CheckCheck className="h-3.5 w-3.5" />
                    Approve All
                  </DropdownMenuItem>
                )}
              {!isFyOpeningRow &&
                (() => {
                  const icViewOnly =
                    isInterCompanyVoucherEditDeleteBlocked(transaction as Record<string, unknown>) ||
                    (isIcRow(transaction) && !canEditIcRows);
                  return (
                    <DropdownMenuItem onClick={() => onRowClick?.(transaction)} className="flex items-center gap-2">
                      <Pencil className="h-3.5 w-3.5" />
                      {icViewOnly ? "View" : "Edit"}
                    </DropdownMenuItem>
                  );
                })()}
              {can('view_voucher_history') && onHistoryVoucher && (
                <DropdownMenuItem onClick={() => onHistoryVoucher?.(transaction)} className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5" />
                  History
                </DropdownMenuItem>
              )}
              {onMoveVoucherToRecycleBin &&
                canDeleteVoucher(transaction as { isApproved?: boolean }) &&
                !isFyOpeningRow &&
                transaction?.id &&
                transaction.type !== FISCAL_YEAR_PARTITION_ROW_TYPE && (
                  <DropdownMenuItem
                    onClick={() => onMoveVoucherToRecycleBin(transaction)}
                    className="flex items-center gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Move to recycle bin
                  </DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </>
    );

    const isPendingApproval =
      !isFyOpeningRow &&
      highlightPendingApproval &&
      isLedgerTransactionUnapproved(transaction as { isApproved?: boolean; type?: string; id?: string });
    // Peer change-detect blue wins over unapproved pink when both present
    const showPendingApprovalPink = isPendingApproval && !isPeerPendingChange;
    const narrationText =
      transaction.type === "note" ? transaction.title : transaction.narration;
    const narrationLabel = transaction.type === "note" ? "Title" : "Narration";
    const dateCols = dateSystem === "Both" ? 2 : 1;
    const colsThroughCredit =
      visibleColumns == null
        ? (showCol("syncStatus") ? 1 : 0) + dateCols + 1 + 1 + (context === "daybook" ? 1 : 0) + (isItemPartyContext && showItemPartyColumn ? 1 : 0) + (context !== "note" ? 1 : 0) + (showFileColumn ? 1 : 0) + 1 + 1
        : (showCol("syncStatus") ? 1 : 0) +
          (showCol("date") ? dateCols : 0) +
          (showCol("type") ? 1 : 0) +
          (showCol("voucherNo") ? 1 : 0) +
          (context === "daybook" ? 1 : 0) +
          (isItemPartyContext && showItemPartyColumn ? 1 : 0) +
          (showCol("user") && context !== "note" ? 1 : 0) +
          (showFileColumn ? 1 : 0) +
          (showCol("tdsTaxable") ? 1 : 0) +
          (showCol("tdsAmount") ? 1 : 0) +
          (showCol("dr") ? 1 : 0) +
          (showCol("cr") ? 1 : 0);
    const statusDetailText = getStatusDetail(transaction, { billWiseOnly: statusBillWiseOnly });
    const statusDetailVouchers = getStatusDetailVouchers(transaction, { billWiseOnly: statusBillWiseOnly });
    const showNarrationRow =
      (showNarration && narrationText) ||
      (!isBillWise &&
        !isFyOpeningRow &&
        showCol("status") &&
        !hideStatusColumn &&
        statusDetailVouchers.length > 0);
    const spendWiseBorderLast = useRowSpendBorders && effSpendBottom && !showNarrationRow && cn(
      "[&>td]:border-b-2 [&>td]:border-solid [&>td]:pb-1",
      !effSpendTop && "[&>td]:border-t-0",
      swColor === "green" && "[&>td]:border-b-green-500 [&>td:first-child]:border-l-green-500 [&>td:last-child]:border-r-green-500",
      swColor === "pink" && "[&>td]:border-b-pink-500 [&>td:first-child]:border-l-pink-500 [&>td:last-child]:border-r-pink-500",
      swColor === "blue" && "[&>td]:border-b-blue-500 [&>td:first-child]:border-l-blue-500 [&>td:last-child]:border-r-blue-500",
      "[&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2",
      "[&>td:first-child]:rounded-bl-xl [&>td:last-child]:rounded-br-xl [&>td:first-child]:overflow-hidden [&>td:last-child]:overflow-hidden"
    );
    const spendWiseBorderLastNarr = useRowSpendBorders && effSpendBottom && showNarrationRow && cn(
      "[&>td]:border-b-0 [&>td]:border-solid",
      !effSpendTop && "[&>td]:border-t-0",
      swColor === "green" && "[&>td:first-child]:border-l-green-500 [&>td:last-child]:border-r-green-500",
      swColor === "pink" && "[&>td:first-child]:border-l-pink-500 [&>td:last-child]:border-r-pink-500",
      swColor === "blue" && "[&>td:first-child]:border-l-blue-500 [&>td:last-child]:border-r-blue-500",
      "[&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2"
    );
    // Keep narration row width identical to data rows in every mode; status/running/actions are rendered as separate cells.
    const narrationColSpan = colsThroughCredit;

    const inSpendWiseGroup = hasSpendWiseColor && (isSpendWiseGroupFirst || isSpendWiseGroupLast || isSpendWiseChild);
    /** Spend-wise row type: inflow (payment in / direct income / contra in) = green bg; outflow (payment out / direct expense / contra out) = dim white, smaller text, 30px left gap */
    const isSpendWiseInflowRow = inSpendWiseGroup && (
      transaction.type === "payment_in" ||
      transaction.type === "direct_income" ||
      (transaction.type === "contra" && context === "account" && contextId && transaction.toAccountId === contextId) ||
      (transaction.type === "contra" && (transaction.debit ?? 0) > 0) // Contra In (debit) = inflow, green on both details and group page
    );
    const isSpendWiseOutflowRow = inSpendWiseGroup && (
      transaction.type === "payment_out" ||
      transaction.type === "direct_expense" ||
      (transaction.type === "contra" && context === "account" && contextId && transaction.fromAccountId === contextId)
    );
    /** In group details (context "group") contra child rows are not classified as outflow (no single account contextId), so give them 30px indent by treating any non-inflow child as indent-worthy. */
    /** Bank group: standalone out Cr rows (payment_out, direct_expense, contra with credit) also get left indent like PYMT row. */
    const spendWiseGroupStandaloneOutflow =
      context === "group" &&
      (isSpendWiseGroupFirst && isSpendWiseGroupLast) &&
      (transaction.type === "payment_out" ||
        transaction.type === "direct_expense" ||
        (transaction.type === "contra" && (transaction.credit ?? 0) > 0));
    const spendWiseChildNeedsIndent =
      isSpendWiseOutflowRow || (context === "group" && isSpendWiseChild && !isSpendWiseInflowRow) || spendWiseGroupStandaloneOutflow;
    /** Extra gap below last row of each group so containers don't touch during layout animation */
    const groupGapBottom = "[&>td]:pb-3";
    // Page split: effSpendBottom = visible “close” of group box (no next page) — padding/border matches that, not only logical last.
    const spendWiseMainInset = inSpendWiseGroup && cn(
      spendWiseChildNeedsIndent ? "[&>td:first-child]:pl-[30px]" : "[&>td:first-child]:pl-[6px]",
      "[&>td:last-child]:pr-[6px]",
      isSpendWiseGroupFirst && "[&>td]:pt-[6px]",
      effSpendBottom && !showNarrationRow && cn("[&>td]:pb-[6px]", groupGapBottom),
      !isSpendWiseGroupFirst && "[&>td]:pt-[3px]"
    );
    const spendWiseNarrInset = inSpendWiseGroup && cn(
      spendWiseChildNeedsIndent ? "[&>td:first-child]:pl-[30px]" : "[&>td:first-child]:pl-[6px]",
      "[&>td:last-child]:pr-[6px]",
      effSpendBottom && cn("[&>td]:pb-[6px]", groupGapBottom),
      !effSpendBottom && "[&>td]:pb-[3px]"
    );

    const rowExitTransition = { transition: { duration: 0 } };
    const txnStripeMod =
      typeof txnStripeIndex === "number" ? txnStripeIndex % 2 : null;
    const txnStripeAttr = txnStripeMod !== null ? String(txnStripeMod) : undefined;
    /* Spend-wise / pending / selected par apna rang — sirf normal rows par gray-white alternate */
    /* Stripe backgrounds: globals.css + tone (green/blue) — no semi-transparent muted overlay here. */
    const txnStripeBgClass = "";
    /* Check mode: marked = green bg; focused (selected) row par orange border bhi rahe */
    const txnRowSelectedChrome = isSelected;
    /* Spend-wise: theme CSS ko group color / inflow-outflow tint batane ke liye data attrs */
    const spendWiseEdgeAttr = hasSpendWiseColor
      ? [effSpendTop ? "top" : "", effSpendBottom ? "bottom" : "", !effSpendTop && !effSpendBottom && isSpendWiseInGroup ? "mid" : ""]
          .filter(Boolean)
          .join(" ") || undefined
      : undefined;
    const handleRowDoubleClick = (e: React.MouseEvent) => {
      if (isTxnFilePreviewInteractionTarget(e.target)) return;
      if (isFyOpeningRow) {
        toast.message("This row cannot be edit", { duration: 2000 });
        return;
      }
      onRowClick?.(transaction);
    };

    const MainRow = (
      <motion.tr
        layout={txnLayoutOn ? "position" : false}
        layoutDependency={txnLayoutKey}
        initial={false}
        exit={rowExitTransition}
        transition={txnLayoutTransition}
        style={txnLayoutStyle}
        onLayoutAnimationStart={startTxnLayoutAnim}
        onLayoutAnimationComplete={finishTxnLayoutLayer}
        data-pl-txn-layout-animating={txnLayoutAnimating ? "" : undefined}
        onClick={() => onRowSelect?.(transaction)}
        onDoubleClick={handleRowDoubleClick}
        data-txn-stripe={txnStripeAttr}
        /* Theme stripe rules (globals.css) se bachne + pink !important target */
        data-pl-pending-approval={showPendingApprovalPink ? "" : undefined}
        data-pl-peer-pending={isPeerPendingChange ? "" : undefined}
        /* globals.css [data-pl-txn-selected] — theme stripe/bg par orange box dikhe */
        ref={mainRowRef}
        onMouseEnter={onPairHoverEnter}
        onMouseLeave={clearPairHoverIfLeavingBlock}
        data-pl-txn-hovered={pairHovered ? "" : undefined}
        data-pl-txn-selected={txnRowSelectedChrome ? "" : undefined}
        data-pl-check-marked={isCheckModeMarked ? "" : undefined}
        data-pl-statement-checked={isStatementChecked ? "" : undefined}
        data-pl-fy-opening-row={isFyOpeningRow ? "" : undefined}
        data-check-focus={isCheckModeFocused ? "true" : undefined}
        data-pl-spend-wise-group={useRowSpendBorders ? swColor : undefined}
        data-pl-spend-edge={useRowSpendBorders ? spendWiseEdgeAttr : undefined}
        data-pl-spend-in-group-card={spendWiseInGroupCard ? "" : undefined}
        data-pl-spend-wise-inflow={isSpendWiseInflowRow ? "" : undefined}
        data-pl-spend-wise-outflow={
          isSpendWiseOutflowRow || spendWiseGroupStandaloneOutflow ? "" : undefined
        }
        className={cn(
          "transaction-main-row min-h-[28px] cursor-pointer text-foreground",
          txnStripeBgClass,
          isSpendWiseChild && "pl-6 text-sm [&>td]:py-1",
          isSpendWiseChild && !isSelected && !isSpendWiseInflowRow && !isSpendWiseOutflowRow && !spendWiseChildNeedsIndent && "bg-muted/20 [&>td]:bg-muted/20",
          isSpendWiseInflowRow && !isSelected && "bg-green-100 dark:bg-green-900/30 [&>td]:bg-green-100 [&>td]:dark:bg-green-900/30 hover:bg-green-200 [&>td]:hover:bg-green-200 [&>td]:dark:hover:bg-green-900/40",
          (isSpendWiseOutflowRow || (context === "group" && isSpendWiseChild && !isSpendWiseInflowRow) || spendWiseGroupStandaloneOutflow) && !isSelected && "bg-gray-50 dark:bg-gray-900/20 [&>td]:bg-gray-50 [&>td]:dark:bg-gray-900/20 [&>td]:text-xs",
          spendWiseMainInset,
          spendWiseBorderFirst,
          spendWiseBorderLast,
          spendWiseBorderLastNarr,
          spendWiseBorderMid,
          isNote && !isSelected && "bg-amber-50 [&>td]:bg-amber-50 hover:bg-amber-100 [&>td]:hover:bg-amber-100",
          /* Statement / non–spend-wise: full pink band — bank, item, tax, reports, etc. */
          showPendingApprovalPink && !isSelected && !inSpendWiseGroup &&
            cn(
              "bg-pink-100 dark:bg-pink-950/40 [&>td]:bg-pink-100 [&>td]:dark:bg-pink-950/40 hover:bg-pink-200 dark:hover:bg-pink-950/50 [&>td]:hover:bg-pink-200 [&>td]:dark:hover:bg-pink-950/50",
              !showNarrationRow && "outline outline-1 outline-black/30 dark:outline-white/30 outline-offset-0"
            ),
          /* Spend-wise group: green/gray pe bhi unapproved dikhe — tint override + ring */
          showPendingApprovalPink && !isSelected && inSpendWiseGroup &&
            "[&>td]:!bg-pink-100/90 dark:[&>td]:!bg-pink-950/45 [&>td]:hover:!bg-pink-200/95 dark:hover:[&>td]:!bg-pink-950/55 ring-2 ring-inset ring-pink-500/45 dark:ring-pink-400/35",
          isPeerPendingChange && !isSelected && !inSpendWiseGroup &&
            cn(
              "bg-blue-100 dark:bg-blue-950/40 [&>td]:bg-blue-100 [&>td]:dark:bg-blue-950/40 hover:bg-blue-200 dark:hover:bg-blue-950/50 [&>td]:hover:bg-blue-200 [&>td]:dark:hover:bg-blue-950/50",
              !showNarrationRow && "outline outline-1 outline-black/30 dark:outline-white/30 outline-offset-0"
            ),
          isPeerPendingChange && !isSelected && inSpendWiseGroup &&
            "[&>td]:!bg-blue-100/90 dark:[&>td]:!bg-blue-950/45 [&>td]:hover:!bg-blue-200/95 dark:hover:[&>td]:!bg-blue-950/55 ring-2 ring-inset ring-blue-500/45 dark:ring-blue-400/35",
          txnRowSelectedChrome && !isStatementChecked && txnSelectedMainRowCn(showNarrationRow),
          // Spend-wise blink: animation on Dr/Cr/Balance text only (see shouldAnimateSpendWiseAmountText), not on tr/border.
          // Keep transaction row compact when narration is visible (override default TableCell p-1).
          showNarrationRow && "[&>td]:pt-0.5 [&>td]:pb-0",
          /* No narration: bottom padding so separator stays visible (not covered by next row chrome) */
          !showNarrationRow && "[&>td]:pb-1",
          showNarration &&
            (narrationText || (!hideStatusColumn && getStatusDetail(transaction, { billWiseOnly: statusBillWiseOnly })))
            ? "border-b-0"
            : (isSpendWiseGroupFirst || isSpendWiseChild || isSpendWiseGroupLast)
              ? "border-b-0"
              : "border-b",
          // Spend-wise pill: main↔narration ke beech line mat; statement rows par black divider.
          !inSpendWiseGroup && "border-black",
          inSpendWiseGroup && showNarrationRow && "[&>td]:border-b-0"
        )}
      >
        {mainRowContent}
      </motion.tr>
    );

    const isOverdueForSubRow = transactionIsOverdueStatus(transaction);
    const overdueDaysForSubRow = isOverdueForSubRow ? getOverdueDays(transaction) : 0;
    // Keep voucher-link + overdue helper beside narration in same row.
    // Overdue age sits under the status pill on the main row (Overdue page parity) — not in narration sub-row.
    const overdueSubText = "";
    const NarrationRow = showNarrationRow ? (
      <motion.tr
        layout={txnLayoutOn ? "position" : false}
        layoutDependency={txnLayoutKey}
        initial={false}
        exit={rowExitTransition}
        transition={txnLayoutTransition}
        style={txnLayoutStyle}
        onLayoutAnimationStart={startTxnLayoutAnim}
        onLayoutAnimationComplete={finishTxnLayoutLayer}
        data-pl-txn-layout-animating={txnLayoutAnimating ? "" : undefined}
        role="button"
        tabIndex={-1}
        ref={narrRowRef}
        onMouseEnter={onPairHoverEnter}
        onMouseLeave={clearPairHoverIfLeavingBlock}
        onClick={() => onRowSelect?.(transaction)}
        onDoubleClick={handleRowDoubleClick}
        data-txn-stripe={txnStripeAttr}
        data-pl-pending-approval={showPendingApprovalPink ? "" : undefined}
        data-pl-peer-pending={isPeerPendingChange ? "" : undefined}
        data-pl-txn-hovered={pairHovered ? "" : undefined}
        data-pl-txn-selected={txnRowSelectedChrome ? "" : undefined}
        data-pl-check-marked={isCheckModeMarked ? "" : undefined}
        data-pl-statement-checked={isStatementChecked ? "" : undefined}
        data-pl-spend-wise-group={useRowSpendBorders ? swColor : undefined}
        data-pl-spend-edge={useRowSpendBorders ? spendWiseEdgeAttr : undefined}
        data-pl-spend-in-group-card={spendWiseInGroupCard ? "" : undefined}
        data-pl-spend-wise-inflow={isSpendWiseInflowRow ? "" : undefined}
        data-pl-spend-wise-outflow={
          isSpendWiseOutflowRow || spendWiseGroupStandaloneOutflow ? "" : undefined
        }
        className={cn(
          "narration-row cursor-pointer",
          !spendWiseInGroupCard && "border-b",
          txnStripeBgClass,
          /* Sirf neeche horizontal line — left/right vertical border mat ([&>td]:border-black se side line aa jati thi) */
          !inSpendWiseGroup && "border-b border-black [&>td]:border-x-0 [&>td]:border-t-0 [&>td]:border-b-0",
          isBillWise && "-mt-1.5",
          spendWiseNarrInset,
          /* Group card: narration par upar ki line mat (txn + narration ek block) */
          spendWiseInGroupCard && "[&>td]:border-t-0 [&>td]:border-b-0",
          effSpendBottom && !spendWiseInGroupCard && cn(
            "[&>td]:border-b-2 [&>td]:border-t-0 [&>td]:border-solid [&>td]:pb-0.5",
            swColor === "green" && "[&>td]:border-b-green-500 [&>td:first-child]:border-l-green-500 [&>td:last-child]:border-r-green-500",
            swColor === "pink" && "[&>td]:border-b-pink-500 [&>td:first-child]:border-l-pink-500 [&>td:last-child]:border-r-pink-500",
            swColor === "blue" && "[&>td]:border-b-blue-500 [&>td:first-child]:border-l-blue-500 [&>td:last-child]:border-r-blue-500",
            "[&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2",
            "[&>td:first-child]:rounded-bl-xl [&>td:last-child]:rounded-br-xl [&>td:first-child]:overflow-hidden [&>td:last-child]:overflow-hidden"
          ),
          /* Side borders sirf main row par — narration par dubara mat (beech line hat jati hai) */
          showPendingApprovalPink && !isSelected && !inSpendWiseGroup &&
            "bg-pink-100 dark:bg-pink-950/40 [&>td]:bg-pink-100 [&>td]:dark:bg-pink-950/40 hover:bg-pink-200 dark:hover:bg-pink-950/50 [&>td]:hover:bg-pink-200 [&>td]:dark:hover:bg-pink-950/50",
          showPendingApprovalPink && !isSelected && inSpendWiseGroup &&
            "[&>td]:!bg-pink-100/90 dark:[&>td]:!bg-pink-950/45 [&>td]:hover:!bg-pink-200/95 ring-2 ring-inset ring-pink-500/40 dark:ring-pink-400/30",
          isPeerPendingChange && !isSelected && !inSpendWiseGroup &&
            "bg-blue-100 dark:bg-blue-950/40 [&>td]:bg-blue-100 [&>td]:dark:bg-blue-950/40 hover:bg-blue-200 dark:hover:bg-blue-950/50 [&>td]:hover:bg-blue-200 [&>td]:dark:hover:bg-blue-950/50",
          isPeerPendingChange && !isSelected && inSpendWiseGroup &&
            "[&>td]:!bg-blue-100/90 dark:[&>td]:!bg-blue-950/45 [&>td]:hover:!bg-blue-200/95 ring-2 ring-inset ring-blue-500/40 dark:ring-blue-400/30",
          txnRowSelectedChrome && !isStatementChecked
            ? txnSelectedNarrationRowCn()
            : isSpendWiseChild && !isSpendWiseInflowRow && !isSpendWiseOutflowRow && !spendWiseChildNeedsIndent && "bg-muted/20 [&>td]:bg-muted/20",
          isSpendWiseInflowRow && !isSelected && "bg-green-100 dark:bg-green-900/30 [&>td]:bg-green-100 [&>td]:dark:bg-green-900/30 hover:bg-green-200 [&>td]:hover:bg-green-200 [&>td]:dark:hover:bg-green-900/40",
          (isSpendWiseOutflowRow || (context === "group" && isSpendWiseChild && !isSpendWiseInflowRow) || spendWiseGroupStandaloneOutflow) && !isSelected && "bg-gray-50 dark:bg-gray-900/20 [&>td]:bg-gray-50 [&>td]:dark:bg-gray-900/20 [&>td]:text-xs",
          isNote && !isSelected && "bg-amber-50 hover:bg-amber-100 [&>td]:bg-amber-50 [&>td]:hover:bg-amber-100",
          !isSelected &&
            !isStatementChecked &&
            !showPendingApprovalPink &&
            !isPeerPendingChange &&
            !isSpendWiseChild &&
            !isNote &&
            "hover:bg-muted/20 [&>td]:hover:bg-muted/20",
          // Avoid extra bottom expansion in sub-row; we only want a small top gap.
          "md:[&>td]:pb-0"
        )}
      >
        <TableCell
          colSpan={narrationColSpan}
          className={cn(
            "px-3 text-[11px] italic leading-tight align-top whitespace-normal break-words w-full min-w-0 overflow-hidden",
            // Keep narration text pure black in all row states.
            "text-black",
            // Keep narration text exactly 2px below the main transaction row.
            isBillWise ? "pt-[1px] pb-0" : "pt-[1px] pb-0",
            inSpendWiseGroup && "pr-[10px]"
          )}
        >
          {narrationText ? (
            <span className="block min-w-0 overflow-hidden break-words font-normal" style={{ overflowWrap: "anywhere" }}>
              <span className="not-italic">{narrationLabel}:</span> {hl(String(narrationText))}
            </span>
          ) : null}
        </TableCell>
        {/* Bill-wise: linked vouchers Status se Balance tak wrap (print jaisa); spend-wise: sirf Status column. */}
        {isBillWise ? (
          <BillWiseLinkedDetailCells
            vouchers={[]}
            overdueText={overdueSubText ? hl(overdueSubText) : undefined}
            billWisePink
            showStatus={showCol("status")}
            hideStatusColumn={hideStatusColumn}
            showBalance={showCol("runningBalance")}
            hideBalanceColumn={hideBalanceColumn}
            ensureMinGaps={ensureMinGaps}
          />
        ) : (
          <>
            {showCol("status") && !hideStatusColumn && (
              <TableCell
                className={cn(
                  "text-center text-[10px] leading-tight align-top py-0 text-black",
                  isOverdueForSubRow && overdueDaysForSubRow > 0 && "font-medium",
                  ensureMinGaps && "min-w-[95px] px-[5px]"
                )}
              >
                <div className="flex flex-col items-center gap-[1px]">
                  <LinkedVouchersColoredCollapsible
                    vouchers={statusDetailVouchers}
                    align="center"
                    billWisePink={isBillWise}
                    onVoucherClick={onStatusLinkedVoucherClick}
                    activeVoucherNo={statusLinkedVoucherPreviewActive}
                  />
                  {overdueSubText ? (
                    <span className="block font-medium text-red-600">{hl(overdueSubText)}</span>
                  ) : null}
                </div>
              </TableCell>
            )}
            {showCol("runningBalance") && !hideBalanceColumn && (
              <TableCell
                className={cn("text-right tabular-nums", ensureMinGaps && LEDGER_TXN_BALANCE_TO_MENU_PAD_CN)}
                style={ensureMinGaps ? { minWidth: LEDGER_ENTITY_BALANCE_COL_PX } : undefined}
              />
            )}
          </>
        )}
        <TableCell className={ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0"} />
      </motion.tr>
    ) : null;

    return (
      <>
        {MainRow}
        {NarrationRow}
      </>
    );
  }
);
TransactionRow.displayName = "TransactionRow";
