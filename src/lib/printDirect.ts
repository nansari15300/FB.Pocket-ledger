
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { format as formatDateFns } from "date-fns";
import { AD_DATE_FORMATS, BS_DATE_FORMATS } from "@/lib/dateFormatOptions";
import type { ADFormatKey, BSFormatKey } from "@/lib/dateFormatOptions";
import { formatBsFromAD } from "@/lib/bs-date";
// @ts-ignore - pdfmake types may not be available
import type { TDocumentDefinitions, Content, TableCell } from "pdfmake/interfaces";
import type { Item } from "@/components/items/types";
import { getAllocationTotal, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import { shouldUseInAppPdfPreviewOverlay } from "@/lib/shouldUseInAppPdfPreview";
import { showInAppPdfPreview } from "@/lib/inAppPdfPreview";
import {
  FISCAL_YEAR_PARTITION_ROW_TYPE,
  getFiscalMergePartitionsFromCompany,
  insertFiscalPartitionRowsMulti,
  type FiscalMergePartitionEntry,
} from "@/lib/fiscalPartitionRows";
import type { FiscalPartitionClosingSummary } from "@/lib/fiscalPartitionClosingSummary";
import {
  buildFiscalMergePartitionBannerLabelForDateSystem,
  buildFiscalMergePartitionBannerSplitForDateSystem,
  buildFyOpeningPillSplit,
} from "@/lib/fiscalYearLabel";
import { getPrintColorPalette, type PrintColorMode } from "@/lib/printColorPalette";
import { getInterCompanyLedgerAmounts } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { sumJournalAmountsForAccount } from "@/lib/journalLedgerAmounts";
import type { Context as LedgerContext } from "@/components/vouchers/transactionTableShared";
import type { AccountConfirmationSummary } from "@/lib/reports/accountConfirmationSummary";
import {
  injectSpendWiseEmbeddedOpeningPrintRows,
  resolveLedgerOpeningPrintRows,
  type LedgerOpeningPrintRow,
} from "@/lib/ledgerOpeningBalanceDisplay";
import { FY_OPENING_ROW_TYPE } from "@/lib/fyPagination/fyOpeningRows";
import { readFyOpeningPillFormat } from "@/lib/fyOpeningPillFormat";
import {
  getFyPartitionRowBackground,
  readFyPartitionRowColor,
} from "@/lib/fyPartitionRowColor";

function resolvePrintFiscalMergePartitions(
  payload: {
    company?: {
      country?: string;
      fiscalYearStart?: unknown;
      fiscalYearEnd?: unknown;
      fiscalSplitMode?: string;
      fiscalMergePartitionAt?: unknown;
      fiscalMergePartitionAtIsos?: string[] | null;
      fiscalPartitionLabel?: string | null;
    };
    fiscalMergePartitions?: FiscalMergePartitionEntry[];
    fiscalMergePartitionAt?: Date | null;
    fiscalPartitionLabel?: string | null;
  },
  dateSystem: PrintPayload["dateSystem"],
  formatDate?: (d: Date) => string
): FiscalMergePartitionEntry[] {
  const optionalNote = payload.fiscalPartitionLabel ?? payload.company?.fiscalPartitionLabel ?? null;
  const relabel = (at: Date): string =>
    buildFiscalMergePartitionBannerLabelForDateSystem(
      payload.company,
      at,
      dateSystem,
      formatDate,
      optionalNote,
      readFyOpeningPillFormat()
    );

  if (payload.fiscalMergePartitions?.length) {
    return payload.fiscalMergePartitions.map((part) => ({
      at: part.at,
      label: relabel(part.at),
    }));
  }
  if (payload.company) {
    const fromCompany = getFiscalMergePartitionsFromCompany(payload.company);
    if (fromCompany.length) {
      return fromCompany.map((at) => ({ at, label: relabel(at) }));
    }
  }
  const partAt =
    payload.fiscalMergePartitionAt instanceof Date
      ? payload.fiscalMergePartitionAt
      : payload.fiscalMergePartitionAt
        ? new Date(payload.fiscalMergePartitionAt as unknown as string)
        : null;
  if (partAt && !isNaN(partAt.getTime())) {
    return [{ at: partAt, label: relabel(partAt) }];
  }
  return [];
}

/** Party/staff print: FY merge divider ke liye company fiscal fields payload me bhejo. */
export function companyFiscalFieldsForPrint(
  company: Record<string, unknown> | null | undefined
): {
  country?: string;
  fiscalYearStart?: unknown;
  fiscalYearEnd?: unknown;
  fiscalSplitMode?: string;
  fiscalMergePartitionAt?: unknown;
  fiscalMergePartitionAtIsos?: string[] | null;
  fiscalPartitionLabel?: string | null;
} {
  if (!company) return {};
  return {
    country: typeof company.country === "string" ? company.country : undefined,
    fiscalYearStart: company.fiscalYearStart,
    fiscalYearEnd: company.fiscalYearEnd,
    fiscalSplitMode: typeof company.fiscalSplitMode === "string" ? company.fiscalSplitMode : undefined,
    fiscalMergePartitionAt: company.fiscalMergePartitionAt,
    fiscalMergePartitionAtIsos: Array.isArray(company.fiscalMergePartitionAtIsos)
      ? (company.fiscalMergePartitionAtIsos as string[])
      : undefined,
    fiscalPartitionLabel:
      typeof company.fiscalPartitionLabel === "string" ? company.fiscalPartitionLabel : null,
  };
}

function parsePrintPartitionBoundaryMs(row: any): number | null {
  const id = String(row?.id || "");
  const match = /^__fiscal_partition_(\d+)_/.exec(id);
  if (!match) return null;
  const ms = Number(match[1]);
  return Number.isFinite(ms) ? ms : null;
}

function printLedgerTypeLabel(row: any): string {
  const pill = String(row?._ledgerOpeningPillLabel || "").trim();
  if (pill) return pill;
  const type = String(row?.type || "");
  if (type === FY_OPENING_ROW_TYPE) return "fy opening";
  return voucherTypeDisplayText(type);
}

function pushFyOpeningPrintRowAfterPartition(
  out: any[],
  partitionRow: any,
  runningBalance: number,
  company?: PrintPayload["company"],
  dateSystem: PrintPayload["dateSystem"] = "AD"
): void {
  const boundaryMs = parsePrintPartitionBoundaryMs(partitionRow);
  if (boundaryMs == null) return;
  const partitionDate = new Date(boundaryMs);
  const pillSplit = buildFyOpeningPillSplit(company ?? null, partitionDate, dateSystem);
  const signed = Number.isFinite(runningBalance) ? runningBalance : 0;
  const abs = Math.abs(signed);
  out.push({
    id: `__fy_opening_${boundaryMs}`,
    type: FY_OPENING_ROW_TYPE,
    _ledgerOpeningPillLabel: pillSplit.typePill,
    _fyOpeningVoucherPillLabel: pillSplit.voucherPill,
    _fyOpeningSynthetic: true,
    date: partitionDate,
    voucherNumber: pillSplit.voucherPill ?? "-",
    debit: signed > 0 ? abs : 0,
    credit: signed < 0 ? abs : 0,
    balance: signed,
    runningBalance: signed,
    narration: "",
  });
}

const DEFAULT_AD_FORMAT: ADFormatKey = "yyyy-MM-dd";
const DEFAULT_BS_FORMAT: BSFormatKey = "MMM DD, YYYY";

function getStoredDateFormatAD(): ADFormatKey {
  if (typeof window === "undefined") return DEFAULT_AD_FORMAT;
  const stored = localStorage.getItem("dateFormatAD") as ADFormatKey | null;
  if (stored && AD_DATE_FORMATS.some((f) => f.value === stored)) return stored;
  return DEFAULT_AD_FORMAT;
}

function getStoredDateFormatBS(): BSFormatKey {
  if (typeof window === "undefined") return DEFAULT_BS_FORMAT;
  const stored = localStorage.getItem("dateFormatBS") as BSFormatKey | null;
  if (stored && BS_DATE_FORMATS.some((f) => f.value === stored)) return stored;
  return DEFAULT_BS_FORMAT;
}


// pdfmake vs vfs_fonts type mismatch: vfs can be string in types but object at runtime; cast to satisfy TS
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs ?? (pdfFonts as any).vfs;

/** Get PDF buffer from pdfmake doc. Always uses callback so hooks that require "getBuffer(cb)" work; also handles Promise return. */
function getPdfBuffer(pdfDoc: unknown): Promise<Uint8Array | Buffer> {
  return new Promise((resolve, reject) => {
    const cb = (dataOrErr: Uint8Array | Buffer | Error, buf?: Uint8Array | Buffer) => {
      if (dataOrErr instanceof Error) reject(dataOrErr);
      else if (buf !== undefined) resolve(buf);
      else resolve(dataOrErr as Uint8Array | Buffer);
    };
    try {
      const result = (pdfDoc as { getBuffer(cb: (data: Uint8Array | Buffer) => void): Promise<Uint8Array | Buffer> | void }).getBuffer(cb);
      if (result != null && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<Uint8Array | Buffer>).then(resolve).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function getPdfBufferWithTimeout(pdfDoc: unknown, ms: number): Promise<Uint8Array | Buffer> {
  return Promise.race([
    getPdfBuffer(pdfDoc),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Print timed out. Please try again.")), ms)),
  ]);
}

export type Context =
  | "party" | "account" | "staff" | "tax" | "item"
  | "sale" | "purchase" | "payment_in" | "payment_out"
  | "journal" | "contra" | "direct_income" | "direct_expense" | "note"
  | "daybook"
  | "group"
  | "expense"
  | "overdue"
  | "other";
  
export type DaybookSummary = {
  bank: { yesterday: number; in: number; out: number; today: number };
  cash: { yesterday: number; in: number; out: number; today: number };
  total: { yesterday: number; in: number; out: number; today: number };
  /** Optional: per bank/cash account breakdown (Daybook UI expand) */
  bankAccounts?: Array<{ id: string; name: string; yesterday: number; in: number; out: number; today: number }>;
  cashAccounts?: Array<{ id: string; name: string; yesterday: number; in: number; out: number; today: number }>;
} | null;

export type PrintPayload = {
  company: {
    name: string;
    pan?: string;
    phone?: string;
    address?: string,
    decimalPlaces?: number;
    showDrCr?: boolean;
    showCurrencySymbol?: boolean;
    logoUrl?: string | null;
    country?: string;
    fiscalYearStart?: unknown;
    fiscalYearEnd?: unknown;
    fiscalSplitMode?: string;
    fiscalMergePartitionAt?: unknown;
    fiscalMergePartitionAtIsos?: string[] | null;
    fiscalPartitionLabel?: string | null;
  };
  title: string;
  context: Context;
  contextId?: string | null;
  dateSystem: "AD" | "BS" | "Both";
  dateRangeText: string;
  vouchersCount: number;
  openingBalance: number;
  /** Entity print: OB row Date column (party/bank/item…) */
  openingBalanceDate?: unknown;
  /** Entity print: OB ke neeche narration line */
  openingBalanceNarration?: string | null;
  /** Ledger page print: master books OB (Book Opening row). */
  booksOpeningBalance?: number;
  /** Ledger page print: page 1 / slice start — Book Opening row dikhao. */
  ledgerShowBookOpeningRow?: boolean;
  /** Ledger page print: date filter active — Dated Opening row date = range from. */
  ledgerDateFilterActive?: boolean;
  /** Ledger page print: page 2+ Dated row date = prev page last txn date. */
  openingBalancePeriodStartDate?: unknown;
  /** Ledger page print: master OB date range check (stacked Book row). */
  ledgerDateRange?: { from?: Date | null; to?: Date | null };
  /** Ledger page print: footer period totals (check mode adjusted). */
  ledgerPagePeriodDr?: number;
  ledgerPagePeriodCr?: number;
  ledgerPageClosingBalance?: number;
  transactions: any[];
  showNarration?: boolean;
  journalAccountNames?: Record<string, string>;
  daybookSummary?: DaybookSummary | null;
  itemsData?: any; // For sale/purchase context
  party?: any; // For sale context
  customContent?: Content[];
  userNames?: Record<string, string>;
  stockView?: 'qty' | 'amount';
  displayUnit?: string;
  /** When true (party/group), print table with Status column like bill wise view. */
  billWise?: boolean;
  /** Bill-wise: Opening Balance outstanding (for Status: Paid/Partial/Unpaid) */
  openingBalanceOutstanding?: number;
  /** Bill-wise: Voucher numbers linked to Opening Balance (e.g. ["Sale Inv1"]) */
  openingBalanceLinkedVoucherNos?: string[];
  /** Match print columns with table column visibility toggles. */
  visibleColumns?: Partial<Record<"date" | "type" | "voucherNo" | "user" | "file" | "dr" | "cr" | "status" | "runningBalance", boolean>>;
  /** Include note vouchers in print only when UI toggle is enabled. */
  includeNotes?: boolean;
  /** Keep incoming transaction order (used for spend-wise grouped order). */
  preserveOrder?: boolean;
  /** Print using spend-wise row values/order (account/bank spend-wise view). */
  spendWise?: boolean;
  /** Bank/Cash print: override Debit/Credit column titles (e.g. Deposit / Withdraw). */
  debitColumnHeaderLabel?: string;
  creditColumnHeaderLabel?: string;
  /** Bill-wise: vouchers for allocation amount lookup (voucher details with amount in print). */
  vouchers?: any[];
  /** Bill-wise linked voucher detail density selected in Print options. */
  printLinkedVouchersMode?: "all" | "max2";
  /** Merge fiscal: nayi FY ki pehli din (AD) — table jaisa PDF me divider. */
  fiscalMergePartitionAt?: Date | null;
  /** Merge fiscal: multiple partition starts (preferred over single `fiscalMergePartitionAt`). */
  fiscalMergePartitions?: FiscalMergePartitionEntry[];
  /** Optional custom divider line (same as company settings). */
  fiscalPartitionLabel?: string | null;
  /** openPrintDirect: dialog mat dikhao (chhota receipt / programmatic). */
  skipPrintOptionsDialog?: boolean;
  /** Anusuchi-13 confirmation report: show Confirmation / Statement / Both print tabs. */
  printConfirmationTabs?: boolean;
  /** Selected confirmation print tab. Set by the print options dialog. */
  printReportKind?: "confirmation" | "statement" | "both";
  /** Dedicated account confirmation letter data. */
  confirmationSummary?: AccountConfirmationSummary;
  confirmationFyLabel?: string;
  confirmationFyRangeLabel?: string;
  confirmationRecipientName?: string;
  confirmationRecipientPan?: string;
  confirmationRecipientAddress?: string;
  confirmationLetterDate?: string;
  /** Full ledger rows used by Both mode instead of the currently paged screen slice. */
  statementAllTransactions?: any[];
  /** PDF header me logo / placeholder — false = bilkul na (dialog ya manual). */
  printIncludeLogo?: boolean;
  /** PDF header me company name, address, phone, PAN — false par sirf date range line. */
  printIncludeCompanyDetails?: boolean;
  /** Mobile print option: report title + total vouchers line toggle. */
  printIncludeTitle?: boolean;
  /** Print options: color (green/red) vs black & white PDF amounts. */
  printColorMode?: PrintColorMode;
};

// ------------ LOGO CACHE (preload for instant print) ------------
const logoCache = new Map<string, string>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error ?? new Error("blob read failed"));
    r.readAsDataURL(blob);
  });
}

/** HTTP/Firebase logo → pdfmake data URL. EXE static me `/api/image-proxy` nahi — Storage SDK + localhost proxy. */
async function fetchLogoAsDataUrl(logoUrl: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const url = String(logoUrl || "").trim();
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  if (url.startsWith("http")) {
    try {
      const { tryGetBlobFromFirebaseStorageDownloadUrl } = await import(
        "@/lib/storageGetBlobFromDownloadUrl"
      );
      const blob = await tryGetBlobFromFirebaseStorageDownloadUrl(url);
      if (blob && blob.size > 0) {
        return await blobToDataUrl(blob);
      }
    } catch (e) {
      console.warn("Could not load company logo via Storage:", e);
    }
  }

  // Next dev / hosted web — server proxy (CORS-safe); static export me route 404 ho sakta hai
  try {
    const baseUrl = window.location.origin;
    const res = await fetch(`${baseUrl}/api/image-proxy?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const { dataUrl } = await res.json();
      if (dataUrl) return dataUrl;
    }
  } catch (e) {
    console.warn("Could not load company logo via image-proxy:", e);
  }
  return null;
}

async function resolveLogoDataUrl(logoUrl: string): Promise<string | null> {
  const url = String(logoUrl || "").trim();
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (!url.startsWith("http")) return null;
  const cached = logoCache.get(url);
  if (cached) return cached;
  const dataUrl = await fetchLogoAsDataUrl(url);
  if (dataUrl) logoCache.set(url, dataUrl);
  return dataUrl;
}

/** Print/PDF se pehle logo resolve — cache miss par bhi await (EXE me pehle skip ho jata tha). */
async function applyLogoToPrintPayload(payload: PrintPayload): Promise<PrintPayload> {
  if (payload.printIncludeLogo === false) {
    return { ...payload, company: { ...payload.company, logoUrl: undefined } };
  }
  const raw = payload.company.logoUrl;
  if (!raw || raw.startsWith("data:")) return payload;
  if (!raw.startsWith("http")) return payload;
  const dataUrl = await resolveLogoDataUrl(raw);
  if (!dataUrl) {
    return { ...payload, company: { ...payload.company, logoUrl: undefined } };
  }
  return { ...payload, company: { ...payload.company, logoUrl: dataUrl } };
}

/** Preload company logo so print opens instantly. Call when company has logoUrl. */
export function preloadCompanyLogo(logoUrl: string | null | undefined): void {
  if (!logoUrl || !logoUrl.startsWith("http")) return;
  if (logoCache.has(logoUrl)) return;
  void resolveLogoDataUrl(logoUrl);
}

// ------------ PUBLIC ------------
export async function openPrintDirect(payload: PrintPayload, iframeTargetIdOrNewTab?: boolean | string | Window) {
  if (typeof window === "undefined") return;

  // APK / static site / mobile: nayi tab blob weak — preview yahi (inAppPdfPreview + PDF.js jahan chahiye)
  const isIframeId = typeof iframeTargetIdOrNewTab === "string";
  const isTargetWindow =
    typeof Window !== "undefined" &&
    iframeTargetIdOrNewTab != null &&
    iframeTargetIdOrNewTab instanceof Window;
  const useInAppPdfOverlay = shouldUseInAppPdfPreviewOverlay() && !isIframeId && !isTargetWindow;

  /** Naya tab sirf PDF ready + Continue ke baad — warna khali tab + options modaal eksaath kharab UX */
  let printWindow: Window | null = null;
  const useNewTab =
    !useInAppPdfOverlay &&
    typeof iframeTargetIdOrNewTab !== "string" &&
    !(iframeTargetIdOrNewTab && typeof (iframeTargetIdOrNewTab as Window).location !== "undefined");

  let effectivePayload: PrintPayload = payload;
  let printDestination: "internal" | "external" = "internal";
  let printMasterTypes: import("@/lib/printMastersTypes").MasterPrintKind[] | undefined;
  let printIncludeZeroBalanceMasters = false;
  let printMasterIncludeBalance = true;
  if (!payload.skipPrintOptionsDialog) {
    const { promptPrintOptions } = await import("@/components/print/PrintOptionsPrompt");
    const opts = await promptPrintOptions({
      showConfirmationTabs: payload.printConfirmationTabs === true,
      showLinkedVoucherOptions: payload.billWise === true,
      initial: {
        printIncludeNarration: payload.showNarration,
        printIncludeNotes: payload.includeNotes,
        printLinkedVouchersMode: payload.printLinkedVouchersMode ?? "all",
        // User/File: print dialog hamesha off — ledger me column on ho tab bhi; user khud tick kare.
      },
    });
    if (!opts) {
      return;
    }
    printDestination = opts.printDestination === "external" ? "external" : "internal";
    printMasterTypes = opts.printMasterTypes;
    printIncludeZeroBalanceMasters = opts.printIncludeZeroBalanceMasters === true;
    printMasterIncludeBalance = opts.printMasterIncludeBalance !== false;
    effectivePayload = {
      ...payload,
      printIncludeLogo: opts.printIncludeLogo,
      printIncludeCompanyDetails: opts.printIncludeCompanyDetails,
      // Print options dialog (PC + mobile/APK): user choices override narration/title/columns safely.
      showNarration:
        typeof opts.printIncludeNarration === "boolean"
          ? opts.printIncludeNarration
          : payload.showNarration,
      includeNotes:
        typeof opts.printIncludeNotes === "boolean"
          ? opts.printIncludeNotes
          : payload.includeNotes,
      printIncludeTitle:
        typeof opts.printIncludeTitle === "boolean"
          ? opts.printIncludeTitle
          : payload.printIncludeTitle,
      visibleColumns: {
        ...(payload.visibleColumns ?? {}),
        ...(typeof opts.printIncludeUserColumn === "boolean" ? { user: opts.printIncludeUserColumn } : {}),
        ...(typeof opts.printIncludeFileColumn === "boolean" ? { file: opts.printIncludeFileColumn } : {}),
      },
      printColorMode: opts.printColorMode ?? "color",
      printLinkedVouchersMode: opts.printLinkedVouchersMode ?? payload.printLinkedVouchersMode ?? "all",
      ...(opts.printReportKind
        ? {
            printReportKind: opts.printReportKind,
            title:
              opts.printReportKind === "confirmation"
                ? `${payload.title} - Confirmation`
                : opts.printReportKind === "both"
                  ? `${payload.title} - Confirmation and Statement`
                  : payload.title,
          }
        : {}),
    };
  }

  // Logo: pdfmake ke liye data URL — EXE/APK static me Storage fetch await (cache miss par skip na ho)
  const processedPayload = await applyLogoToPrintPayload(effectivePayload);

  // Print masters tick = skip current screen report; PDF is masters list only (4 columns per page).
  const mastersOnly = (printMasterTypes?.length ?? 0) > 0;
  let docDefinition: TDocumentDefinitions;
  if (mastersOnly) {
    const { buildMastersOnlyDocDefinition, getStoredDateSystemForMastersPrint } = await import(
      "@/lib/printMastersPdf"
    );
    // Masters print: always use app date setting (localStorage), not ledger payload dateSystem.
    const dateSystem = getStoredDateSystemForMastersPrint();
    docDefinition = buildMastersOnlyDocDefinition({
      company: processedPayload.company,
      printIncludeLogo: processedPayload.printIncludeLogo,
      printIncludeCompanyDetails: processedPayload.printIncludeCompanyDetails,
      printColorMode: processedPayload.printColorMode,
      masterTypes: printMasterTypes!,
      includeZeroBalance: printIncludeZeroBalanceMasters,
      printMasterIncludeBalance,
      dateSystem,
    });
  } else {
    const isConfirmation = processedPayload.printReportKind === "confirmation";
    const isBoth = processedPayload.printReportKind === "both";
    if ((isConfirmation || isBoth) && processedPayload.confirmationSummary) {
      const confirmationDoc = buildAccountConfirmationDocDefinition(processedPayload);
      if (isBoth) {
        const statementPayload = processedPayload.statementAllTransactions
          ? {
              ...processedPayload,
              transactions: processedPayload.statementAllTransactions,
              vouchersCount: processedPayload.statementAllTransactions.length,
              openingBalance: processedPayload.confirmationSummary?.openingBalance ?? processedPayload.openingBalance,
              booksOpeningBalance: undefined,
              ledgerShowBookOpeningRow: false,
              ledgerDateFilterActive: false,
              openingBalancePeriodStartDate: undefined,
              ledgerPagePeriodDr: undefined,
              ledgerPagePeriodCr: undefined,
              ledgerPageClosingBalance: undefined,
            }
          : processedPayload;
        const statementDoc = buildDocDefinition(statementPayload);
        docDefinition = {
          ...confirmationDoc,
          content: [
            ...(Array.isArray(confirmationDoc.content) ? confirmationDoc.content : [confirmationDoc.content]),
            { text: "", pageBreak: "before" },
            ...(Array.isArray(statementDoc.content) ? statementDoc.content : [statementDoc.content]),
          ],
          styles: { ...(confirmationDoc.styles ?? {}), ...(statementDoc.styles ?? {}) },
        };
      } else {
        docDefinition = confirmationDoc;
      }
    } else {
      const statementPayload = processedPayload.printReportKind === "statement" && processedPayload.statementAllTransactions
        ? {
            ...processedPayload,
            transactions: processedPayload.statementAllTransactions,
            vouchersCount: processedPayload.statementAllTransactions.length,
            openingBalance: processedPayload.confirmationSummary?.openingBalance ?? processedPayload.openingBalance,
            booksOpeningBalance: undefined,
            ledgerShowBookOpeningRow: false,
            ledgerDateFilterActive: false,
            openingBalancePeriodStartDate: undefined,
            ledgerPagePeriodDr: undefined,
            ledgerPagePeriodCr: undefined,
            ledgerPageClosingBalance: undefined,
          }
        : processedPayload;
      docDefinition = buildDocDefinition(statementPayload);
    }
  }
  const pdfDoc = pdfMake.createPdf(docDefinition);

  try {
    const buffer = await getPdfBufferWithTimeout(pdfDoc, 60000);
    const blob = new Blob([buffer as BlobPart], { type: "application/pdf" });

    // External — system PDF app / browser tab (APK: FileOpener / Chrome)
    if (printDestination === "external") {
      const safeTitle = String(mastersOnly ? "masters-list" : effectivePayload.title || "pocket-ledger")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 80);
      const { openPdfBlobInExternalViewer } = await import("@/lib/openPdfExternal");
      await openPdfBlobInExternalViewer(blob, `${safeTitle || "pocket-ledger"}.pdf`);
      return;
    }

    const blobUrl = URL.createObjectURL(blob);

    if (typeof iframeTargetIdOrNewTab === "string") {
      const iframe = document.getElementById(iframeTargetIdOrNewTab) as HTMLIFrameElement;
      if (iframe) {
        iframe.src = blobUrl;
      } else {
        URL.revokeObjectURL(blobUrl);
      }
    } else if (useInAppPdfOverlay) {
      // Toolbar: preview + Print + Share + Close — sab app bhitra
      showInAppPdfPreview(blobUrl, () => URL.revokeObjectURL(blobUrl), {
        title: effectivePayload.title || "Print preview",
        fileName: `pocket-ledger-${Date.now()}.pdf`,
      });
    } else if (iframeTargetIdOrNewTab && typeof (iframeTargetIdOrNewTab as Window).location !== "undefined") {
      (iframeTargetIdOrNewTab as Window).location.href = blobUrl;
    } else if (useNewTab) {
      // Continue + PDF tayar hone ke baad tab kholo; popup block ho to iframe fallback
      printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.location.href = blobUrl;
      } else {
        // Capacitor / Electron / Android WebView: window.open null — iframe + print ya download
        const iframe = document.createElement("iframe");
        iframe.setAttribute("title", "Print preview");
        iframe.setAttribute(
          "aria-label",
          "Print preview"
        );
        iframe.style.cssText =
          "position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;border:0;background:#fff";
        document.body.appendChild(iframe);
        const cleanup = () => {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* ignore */
          }
          iframe.remove();
        };
        iframe.onload = () => {
          try {
            const w = iframe.contentWindow;
            if (w) {
              w.focus();
              w.print();
            }
          } catch (e) {
            console.warn("[printDirect] iframe.print failed, download fallback", e);
            try {
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = `pocket-ledger-print-${Date.now()}.pdf`;
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              a.remove();
            } catch {
              /* ignore */
            }
            setTimeout(cleanup, 3000);
            return;
          }
          try {
            iframe.contentWindow?.addEventListener?.("afterprint", cleanup);
          } catch {
            /* ignore */
          }
          setTimeout(cleanup, 120000);
        };
        iframe.onerror = () => cleanup();
        iframe.src = blobUrl;
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("Print failed:", e);
    // Production ma tab band na garne: error dekhaune (tab ~20ms ma band hune fix)
    if (printWindow && !printWindow.closed) {
      try {
        printWindow.document.open();
        printWindow.document.write(
          "<html><head><title>Print failed</title></head><body style=\"display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0;padding:1rem;text-align:center;\">" +
            "<div><h2>Print failed</h2><p>" + escapeHtml(errMsg) + "</p><p>Check console for details.</p></div></body></html>"
        );
        printWindow.document.close();
      } catch (_) {
        printWindow.close();
      }
    }
    throw e;
  }
}

function escapeHtml(s: string): string {
  const el = document.createElement("div");
  el.textContent = s;
  return el.innerHTML;
}

/** Returns PDF blob for sharing. Uses same payload processing as openPrintDirect. */
export async function getPdfBlob(payload: PrintPayload): Promise<Blob | null> {
  if (typeof window === "undefined") return null;

  const processedPayload = await applyLogoToPrintPayload(payload);

  const docDefinition =
    processedPayload.printReportKind === "confirmation" && processedPayload.confirmationSummary
      ? buildAccountConfirmationDocDefinition(processedPayload)
      : buildDocDefinition(processedPayload);
  const pdfDoc = pdfMake.createPdf(docDefinition);
  const buffer = await getPdfBuffer(pdfDoc);
  return new Blob([buffer as BlobPart], { type: "application/pdf" });
}

// ------------ HELPERS ------------
const isIdMatch = (id1: any, id2: any) => String(id1) === String(id2);
const findItem = (items: any[], id: any) => items?.find((i: any) => isIdMatch(i.id, id));
const isColVisible = (
  p: PrintPayload,
  key: "date" | "type" | "voucherNo" | "user" | "file" | "dr" | "cr" | "status" | "runningBalance"
) => {
  if (p.visibleColumns) return p.visibleColumns[key] !== false;
  // Preserve legacy print layout unless caller explicitly sends user/file visibility.
  if (key === "user" || key === "file") return false;
  return true;
};
const isBillWiseContext = (p: PrintPayload) =>
  Boolean(p.billWise && (p.context === "party" || p.context === "group" || p.context === "staff" || p.context === "account"));

const LEDGER_PRINT_BODY_FONT = 9;

const isWideLedgerPrintContext = (p: PrintPayload) =>
  ["party", "staff", "tax", "account", "group", "expense"].includes(p.context);

// --- UPDATED: Dynamic Font Size Calculator ---
// यो फङ्सनले अब धेरै लामो टेक्स्ट नभएसम्म फन्ट साइज घटाउँदैन।
const getAutoFontSize = (text: string | number, baseSize: number): number => {
    const str = String(text);
    // सामान्यतया २० क्यारेक्टर सम्म A4 साइजमा अटाउँछ (जब अरु कोलम auto हुन्छन्)
    if (str.length > 35) return Math.max(6, baseSize - 4); // एकदमै ठूलो डाटा
    if (str.length > 28) return Math.max(7, baseSize - 2); // धेरै ठूलो डाटा
    if (str.length > 22) return Math.max(8, baseSize - 1); // अलि ठूलो डाटा
    return baseSize; // Normal size
};


// ------------ INTERNALS ------------

function confirmationBalanceText(value: number, formatCurrencyForPrint: Function): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0000001) return "-";
  return formatCurrencyForPrint(value);
}

function confirmationAmountText(value: number, formatCurrencyForPrint: Function): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0000001) return "-";
  return formatCurrencyForPrint(Math.abs(value), { noSuffix: true });
}

function confirmationSideAmountText(
  debit: number,
  credit: number,
  formatCurrencyForPrint: Function,
  palette: { debit: string; credit: string }
): any {
  const values: any[] = [];
  if (Math.abs(debit) >= 0.0000001) values.push({ text: `${confirmationAmountText(debit, formatCurrencyForPrint)} Dr`, color: palette.debit });
  if (Math.abs(credit) >= 0.0000001) {
    if (values.length) values.push({ text: "\n" });
    values.push({ text: `${confirmationAmountText(credit, formatCurrencyForPrint)} Cr`, color: palette.credit });
  }
  return values.length ? { text: values } : "-";
}

function addConfirmationAmount(target: any, amount: any): void {
  target.exVatDr += Number(amount.exVatDr) || 0;
  target.exVatCr += Number(amount.exVatCr) || 0;
  target.vatDr += Number(amount.vatDr) || 0;
  target.vatCr += Number(amount.vatCr) || 0;
  target.totalDr += Number(amount.totalDr) || 0;
  target.totalCr += Number(amount.totalCr) || 0;
}

/** Formal letter used by the Anusuchi-13 Confirmation print tab. */
function buildAccountConfirmationDocDefinition(p: PrintPayload): TDocumentDefinitions {
  const summary = p.confirmationSummary!;
  const { formatCurrencyForPrint } = getFormatters(p);
  const palette = getPrintColorPalette(p.printColorMode);
  const includeLogo = p.printIncludeLogo !== false && Boolean(p.company.logoUrl);
  const includeCompanyDetails = p.printIncludeCompanyDetails !== false;
  const companyContact = [p.company.phone ? `Phone: ${p.company.phone}` : "", p.company.pan ? `PAN: ${p.company.pan}` : ""]
    .filter(Boolean)
    .join(" | ");
  const recipientName = p.confirmationRecipientName || p.title;
  const recipientDetails = [
    `To: ${recipientName}`,
    p.confirmationRecipientPan ? `PAN/VAT no: ${p.confirmationRecipientPan}` : "",
    p.confirmationRecipientAddress || "",
  ].filter(Boolean);
  const activityRow = (label: string, amount: any) => [
    label,
    confirmationSideAmountText(amount.exVatDr, amount.exVatCr, formatCurrencyForPrint, palette),
    confirmationSideAmountText(amount.vatDr, amount.vatCr, formatCurrencyForPrint, palette),
    confirmationSideAmountText(amount.totalDr, amount.totalCr, formatCurrencyForPrint, palette),
  ];
  const activityRows = [
    activityRow("Sales Turnover", summary.sales),
    activityRow("Sales Return", summary.salesReturn),
    activityRow("Purchase Turnover", summary.purchases),
    activityRow("Purchase Return", summary.purchaseReturn),
    activityRow("Receipt / Payment", summary.payments),
    activityRow("TDS Deducted", { exVatDr: 0, exVatCr: 0, vatDr: 0, vatCr: 0, totalDr: 0, totalCr: summary.tdsDeducted }),
  ];
  const totalActivity = ["Total", { exVatDr: 0, exVatCr: 0, vatDr: 0, vatCr: 0, totalDr: 0, totalCr: 0 }] as [string, any];
  for (const amount of [summary.sales, summary.salesReturn, summary.purchases, summary.purchaseReturn, summary.payments]) {
    addConfirmationAmount(totalActivity[1], amount);
  }
  totalActivity[1].totalCr += summary.tdsDeducted;
  if (summary.openingBalance >= 0) {
    totalActivity[1].totalDr += summary.openingBalance;
  } else {
    totalActivity[1].totalCr += Math.abs(summary.openingBalance);
  }
  const rows = [
    [
      { text: "Particulars", bold: true },
      { text: "Amount\nExcluding VAT", bold: true, alignment: "center" },
      { text: "VAT Amount", bold: true, alignment: "center" },
      { text: "Total Amount", bold: true, alignment: "center" },
    ],
    ["Opening Balance", "", "", confirmationSideAmountText(Math.max(0, summary.openingBalance), Math.max(0, -summary.openingBalance), formatCurrencyForPrint, palette)],
    ...activityRows,
    ["Total", confirmationSideAmountText(totalActivity[1].exVatDr, totalActivity[1].exVatCr, formatCurrencyForPrint, palette), confirmationSideAmountText(totalActivity[1].vatDr, totalActivity[1].vatCr, formatCurrencyForPrint, palette), confirmationSideAmountText(totalActivity[1].totalDr, totalActivity[1].totalCr, formatCurrencyForPrint, palette)],
    [
      Math.abs(summary.closingBalance) < 0.0000001
        ? { text: [{ text: "Closing Balance\n" }, { text: "Settled", color: "#16803c", bold: true }] }
        : "Closing Balance",
      "",
      "",
      confirmationSideAmountText(Math.max(0, summary.closingBalance), Math.max(0, -summary.closingBalance), formatCurrencyForPrint, palette),
    ],
  ];

  const header: Content = {
    stack: [
      ...(includeLogo ? [{ image: p.company.logoUrl!, fit: [58, 58], alignment: "center", margin: [0, 0, 0, 4] }] : []),
      ...(includeCompanyDetails
        ? [
            { text: p.company.name, style: "companyName", alignment: "center" },
            { text: p.company.address || "", style: "companyAddress", alignment: "center" },
            { text: companyContact, style: "companyContact", alignment: "center" },
          ]
        : []),
      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: "#1f6b89" }], margin: [0, 8, 0, 22] },
    ],
  };

  return {
    pageSize: "A4",
    pageMargins: [55, 32, 55, 58],
    header,
    footer: () => ({
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: "Contact Us:", bold: true, fontSize: 11 },
            { text: companyContact || p.company.phone || "", fontSize: 9 },
          ],
          color: "white",
          fillColor: "#176784",
          margin: [38, 9, 38, 9],
        }]],
      },
      layout: "noBorders",
    } as any),
    content: [
      { text: `Date: ${p.confirmationLetterDate || new Date().toLocaleDateString("en-CA")}`, alignment: "right", fontSize: 9, margin: [0, 0, 0, 18] },
      ...recipientDetails.map((text) => ({ text, fontSize: 9, margin: [0, 0, 0, 5] })),
      { text: `Subject: Account Confirmation for ${p.confirmationFyLabel || p.confirmationFyRangeLabel || p.dateRangeText}`, bold: true, decoration: "underline", alignment: "center", margin: [0, 10, 0, 22] },
      { text: "Dear Sir/Madam,", fontSize: 9, margin: [0, 0, 0, 16] },
      { text: `As per our account records, all the transactions with your organization for the FY ${p.confirmationFyRangeLabel || p.confirmationFyLabel || p.dateRangeText} are as follows:`, fontSize: 9, lineHeight: 1.25, margin: [0, 0, 0, 14] },
      {
        table: { headerRows: 1, widths: ["*", 125, 95, 125], body: rows },
        layout: {
          fillColor: (rowIndex: number) => rowIndex === 0 ? "#d9d9d9" : null,
          hLineWidth: () => 0.7,
          vLineWidth: () => 0.7,
          hLineColor: () => "#111111",
          vLineColor: () => "#111111",
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        fontSize: 8.5,
        margin: [0, 0, 0, 20],
      },
      { text: "We would highly appreciate it if you could kindly review and confirm the above account details. Please provide your duly signed and sealed confirmation as acknowledgment of the above account balance.", fontSize: 9, lineHeight: 1.3, margin: [0, 0, 0, 10] },
      { text: "Should there be any discrepancies, please inform us of the difference along with the reason within 7 days; failure to reconcile within 7 days will be assumed that the account is reconciled with us.", fontSize: 9, lineHeight: 1.3, margin: [0, 0, 0, 18] },
      { text: "Thank you for your co-operation.", fontSize: 9, margin: [0, 0, 0, 26] },
      {
        columns: [
          { stack: [{ text: "____________________________", fontSize: 9 }, { text: "For and on behalf of", bold: true, fontSize: 8 }, { text: p.company.name, bold: true, fontSize: 9 }, { text: "Authorized Signatory", fontSize: 8 }], width: "50%" },
          { stack: [{ text: "____________________________", fontSize: 9 }, { text: "Acceptance on behalf of", bold: true, fontSize: 8 }, { text: recipientName, bold: true, fontSize: 9 }, { text: "Name / Designation / Seal", fontSize: 8 }], width: "50%" },
        ],
      },
    ],
    styles: {
      companyName: { fontSize: 16, bold: true, color: "#1e5f86" },
      companyAddress: { fontSize: 10, bold: true, margin: [0, 2, 0, 0] },
      companyContact: { fontSize: 8, margin: [0, 2, 0, 0] },
    },
    defaultStyle: { font: "Roboto" },
  } as TDocumentDefinitions;
}

function buildDocDefinition(p: PrintPayload): TDocumentDefinitions {
  const computed = computeRows(p);
  const { rows: embeddedRows, skipStandaloneOpeningRow } = injectSpendWiseEmbeddedOpeningPrintRows(
    computed.rows,
    {
      spendWise: p.spendWise,
      context: p.context,
      openingBalance: Number(p.openingBalance) || 0,
      booksOpeningBalance: p.booksOpeningBalance,
      ledgerShowBookOpeningRow: p.ledgerShowBookOpeningRow,
      ledgerDateFilterActive: p.ledgerDateFilterActive,
      openingBalancePeriodStartDate: p.openingBalancePeriodStartDate,
      openingBalanceDate: p.openingBalanceDate,
      ledgerDateRange: p.ledgerDateRange,
      openingBalanceNarration: p.openingBalanceNarration,
      showNarration: p.showNarration,
      transactions: p.transactions,
    }
  );
  const rows = embeddedRows;
  const { periodDr, periodCr, closing } = computed;
  const { formatDate, formatDateBS, formatCurrencyForPrint, formatRunning, numToWords } = getFormatters(p);
  const voucherRowCount = rows.filter(
    (r: any) => r?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE && r?.type !== FY_OPENING_ROW_TYPE
  ).length;
  const palette = getPrintColorPalette(p.printColorMode);

  const includeLogo = p.printIncludeLogo !== false;
  const includeCompanyDetails = p.printIncludeCompanyDetails !== false;

  const LOGO_SIZE = 60; // 48 * 1.25
  const LOGO_LEFT_INSET = 20;
  const LOGO_TOP_INSET = 20; // space from top of paper (20px)
  /** Company logo na ho to header me site QR (print / PDF preview dono yahi definition). */
  const POCKET_LEDGER_SITE_URL = "https://pocket-ledger.com";

  // Company lines print toggle: off par sirf period (date range) text — table neeche waisa hi
  const periodLine =
    (p.dateRangeText || "").trim().length > 0
      ? [{ text: p.dateRangeText, style: "body", alignment: "center", margin: [0, 5, 0, 0] }]
      : [];
  const companyInfoStack: Content = {
    stack: includeCompanyDetails
      ? [
          { text: p.company.name, style: "header", alignment: "center" },
          { text: p.company.address || "", style: "sub", alignment: "center", margin: [0, 2, 0, 0] },
          {
            text: [p.company.phone ? `Phone: ${p.company.phone}` : "", p.company.pan ? `PAN: ${p.company.pan}` : ""]
              .filter(Boolean)
              .join(" | "),
            style: "sub",
            alignment: "center",
          },
          ...periodLine,
        ]
      : periodLine.length
        ? periodLine
        : [{ text: "", margin: [0, 0, 0, 0] }],
    margin: [0, LOGO_TOP_INSET, 0, 0],
  };

  // pdfmake `qr` — company logo missing par app domain scan ho sake (types me `qr` kabhi missing ho).
  const noLogoPlaceholder = {
    qr: POCKET_LEDGER_SITE_URL,
    fit: LOGO_SIZE,
    margin: [LOGO_LEFT_INSET, LOGO_TOP_INSET, 0, 0],
  } as Content;

  const leftColumnContent: Content = includeLogo
    ? p.company.logoUrl
      ? { image: "companyLogo", width: LOGO_SIZE, height: LOGO_SIZE, margin: [LOGO_LEFT_INSET, LOGO_TOP_INSET, 0, 0] }
      : noLogoPlaceholder
    : { text: "", margin: [0, 0, 0, 0] };

  const leftRightColumnWidth = LOGO_SIZE + LOGO_LEFT_INSET;

  const header: Content = includeLogo
    ? {
        columns: [
          { ...leftColumnContent, width: leftRightColumnWidth },
          { stack: [companyInfoStack], width: "*" },
          { width: leftRightColumnWidth, text: "" },
        ],
        margin: [0, 0, 0, 10],
      }
    : {
        columns: [{ stack: [companyInfoStack], width: "*" }],
        margin: [0, 0, 0, 10],
      };

  /** Har page: baen pocket-ledger.com (link), daayan page X of Y */
  const footer = (currentPage: number, pageCount: number): Content => {
    return {
      columns: [
        {
          text: "pocket-ledger.com",
          link: "https://pocket-ledger.com",
          decoration: "underline",
          color: palette.link,
          alignment: "left",
          fontSize: 8,
          margin: [8, 0, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          fontSize: 8,
          margin: [0, 0, 8, 0],
        },
      ],
      margin: [0, 10, 0, 12],
    };
  };

const reportTitleContent: Content = {
    columns: [
        // Keep report labels compact as requested (about 50% smaller).
        { text: p.title, style: 'subheader', fontSize: 8, alignment: 'left', width: '*' },
        voucherRowCount > 0
          ? { text: `Total Vouchers: ${voucherRowCount}`, style: 'subheader', fontSize: 8, alignment: 'right', width: 'auto' }
          : { text: "", width: 'auto' },
    ],
    margin: [0, 0, 0, 5],
  };

const daybookSummaryContent = (summary: DaybookSummary): Content => {
    if (!summary) return { text: '' };
    const { formatRunning } = getFormatters(p);
    const positiveColor = palette.debit;
    const negativeColor = palette.credit;

    return {
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => '#ddd',
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
        table: {
            widths: ['*', 'auto', '*'],
            body: [
                 [
                    {
                        stack: [
                            { text: [{ text: 'Yesterday Bank: ', bold: true }, { text: formatRunning(summary.bank.yesterday), color: summary.bank.yesterday >= 0 ? positiveColor : negativeColor }] },
                            { text: [{ text: 'Yesterday Cash: ', bold: true }, { text: formatRunning(summary.cash.yesterday), color: summary.cash.yesterday >= 0 ? positiveColor : negativeColor }] }
                        ],
                        fontSize: 8,
                    },
                    {
                       stack: [
                            { text: [{ text: 'Total Bank+Cash Balance: ', bold: true, color: palette.labelBlue}, { text: formatRunning(summary.total.today), bold: true, color: summary.total.today >= 0 ? positiveColor : negativeColor }] }
                       ],
                       alignment: 'center',
                       margin: [0, 5, 0, 0],
                       fontSize: 8,
                    },
                    {
                        stack: [
                            { text: [{ text: 'Today Bank: ', bold: true }, { text: formatRunning(summary.bank.today), color: summary.bank.today >= 0 ? positiveColor : negativeColor }] },
                            { text: [{ text: 'Today Cash: ', bold: true }, { text: formatRunning(summary.cash.today), color: summary.cash.today >= 0 ? positiveColor : negativeColor }] }
                        ],
                        alignment: 'right',
                        fontSize: 8,
                    },
                ],
            ]
        },
        margin: [0, 5, 0, 10],
    };
};

  const body: Content[] = [];
  
  if (p.context === 'daybook' && p.daybookSummary) {
    body.push({
        columns: [
            { text: p.title, style: 'subheader', alignment: 'left', width: '*' },
            { text: '(Note: Summary is for Bank & Cash only)', alignment: 'center', fontSize: 8, italics: true, color: palette.muted, width: '*'},
            { text: `Total Vouchers: ${voucherRowCount}`, style: 'subheader', alignment: 'right', width: '*' }
        ],
        margin: [0, 0, 0, 5],
    });
    body.push(daybookSummaryContent(p.daybookSummary));
  }
  else if (p.context === 'sale' && p.transactions.length === 1) {
     const date = p.transactions[0]?.date?.toDate ? p.transactions[0].date.toDate() : new Date(p.transactions[0]?.date);
     const headerContent: Content = {
        columns: [
            {
                stack: [
                    { text: [{text: 'Customer Name: ', bold: true}, p.party.name] },
                    { text: [{text: 'PAN/VAT: ', bold: true}, p.party.pan || ''] },
                    { text: [{text: 'Address: ', bold: true}, p.party.address || ''] },
                    { text: [{text: 'Contact: ', bold: true}, p.party.phone || ''] },
                ],
                style: 'body',
                alignment: 'left',
            },
            {
                 stack: [
                    { text: [{text: 'Invoice No: ', bold: true}, p.transactions[0].voucherNumber] },
                    { text: [{text: 'Date (AD): ', bold: true}, formatDate(date)] },
                    { text: [{text: 'Date (BS): ', bold: true}, formatDateBS(date)] },
                ],
                style: 'body',
                alignment: 'right',
            }
        ],
        margin: [0, 5, 0, 10],
    };
     body.push(headerContent);
  }
  else {
    // Print option: optionally hide report title block while keeping table content intact.
    if (p.printIncludeTitle !== false) {
      body.push(reportTitleContent);
    }
    if (p.context !== 'daybook' && p.context !== 'sale' && p.context !== 'overdue') {
        
        const factor = p.context === 'item' && p.stockView === 'qty' 
            ? getConversionFactor(findItem(p.itemsData, p.contextId), p.displayUnit) 
            : 1;

        const closingText = p.context === 'item' && p.stockView === 'qty' 
        ? `${(closing / factor).toFixed(2)} ${p.displayUnit || ''}` 
        : formatRunning(closing)

        // --- UPDATED: Top Closing Balance Layout ---
        // अब यसले 'auto' width प्रयोग गर्छ जसले गर्दा दायाँबाट बायाँतिर स्पेस लिन्छ
        body.push({
          columns: [
              { text: '', width: '*' }, // Left space fills remaining
              {
                  text: `Closing Balance: ${closingText}`,
                  alignment: 'right',
                  width: 'auto', // Takes only needed space
                  bold: true,
                  color: palette.balanceSigned(closing),
                  noWrap: true,
                  // Keep top closing-balance label same size as "Total Vouchers".
                  fontSize: getAutoFontSize(closingText, 8) // Apply dynamic font
              }
          ],
          margin: [0, 5, 0, 10],
        });
    }
  }
  
  const tableHeader = buildTableHeader(p);
  const useLandscapePrint = shouldUseLandscapeLedgerPrint(tableHeader);
  const tableFooter = buildTableFooter(p, periodDr, periodCr, closing, formatCurrencyForPrint, formatRunning, tableHeader, numToWords);
  const openingBalanceRow = skipStandaloneOpeningRow
    ? null
    : buildOpeningBalanceRow(
        p,
        formatRunning,
        formatCurrencyForPrint,
        formatDate,
        formatDateBS,
        tableHeader.length
      );

  const tableColumnCount = tableHeader.length;
  const columnWidths = getColumnWidths(p, {
    landscape: useLandscapePrint,
    columnCount: tableColumnCount,
  });
  const syncedColumnWidths =
    columnWidths.length === tableColumnCount
      ? columnWidths
      : Array.from({ length: tableColumnCount }, (_, i) => columnWidths[i] ?? "*");

  const padPrintRow = (row: TableCell[]): TableCell[] => {
    const copy = [...row];
    ensureRowLength(copy, tableColumnCount);
    return copy;
  };

  const tableLayout: Content = {
    table: {
      headerRows: 1,
      widths: syncedColumnWidths,
      body: [
        padPrintRow(tableHeader),
        ...(openingBalanceRow ?? []).map(padPrintRow),
        ...rows.flatMap((row, rowIdx) =>
          buildTableRow(
            row,
            rows[rowIdx + 1],
            p,
            formatDate,
            formatDateBS,
            formatCurrencyForPrint,
            formatRunning,
            tableColumnCount
          ).map(padPrintRow)
        ),
        ...tableFooter.map(padPrintRow),
      ]
    },
     layout: {
       hLineWidth: (i: number, node: any) => {
           if (i === 0 || i === 1) return 1;
           if (i > 1) {
               const currentRow = node.table.body[i];
               const nextRow = node.table.body[i + 1];
               const currentIsNarration = currentRow && currentRow.some((cell: any) => cell && cell.style === 'narrationRow');
               const currentIsSpendGap = currentRow && currentRow.some((cell: any) => cell && cell.style === 'spendWiseGapRow');
               const nextIsSpendGap = nextRow && nextRow.some((cell: any) => cell && cell.style === 'spendWiseGapRow');
               if (currentIsNarration || currentIsSpendGap || nextIsSpendGap) return 0;
           }
           if (tableFooter.length > 0 && i === node.table.body.length - tableFooter.length) return 1;
           if (i === node.table.body.length) return 1;
           
           return 0.5;
       },
      vLineWidth: () => (p.spendWise ? 0.5 : 0),
      vLineColor: () => "#cccccc",
      hLineColor: (i: number, node:any) => {
          if(i === 1 || (i === node.table.body.length - 1 && tableFooter.length > 0)) return 'black';
          return '#aaa'
      },
      paddingLeft: () => (isWideLedgerPrintContext(p) ? 6 : 4),
      paddingRight: () => (isWideLedgerPrintContext(p) ? 6 : 4),
      paddingTop: (i: number, node: any) => {
          if (i > 0) {
              const row = node.table.body[i];
               if (row && (row as any[]).some(cell => cell && (cell.style === 'narrationRow' || cell.style === 'spendWiseGapRow'))) {
                   return 0;
               }
          }
          return 4;
      },
      paddingBottom: (i: number, node: any) => {
          const nextRow = node.table.body[i + 1];
          const row = node.table.body[i];
          const nextIsNarration = nextRow && (nextRow as any[]).some((cell: any) => cell && cell.style === 'narrationRow');
          const currentIsNarration = row && (row as any[]).some((cell: any) => cell && cell.style === 'narrationRow');
          const currentIsSpendGap = row && (row as any[]).some((cell: any) => cell && cell.style === 'spendWiseGapRow');
          const nextIsSpendGap = nextRow && (nextRow as any[]).some((cell: any) => cell && cell.style === 'spendWiseGapRow');
          if (currentIsSpendGap || nextIsSpendGap) return 0;
          if (nextIsNarration) return 0;
          if (currentIsNarration) return 0;
          return 2;
      },
    }
  };

  if (p.customContent) {
    body.push(...p.customContent);
  } else {
    body.push(tableLayout);
  }
  
  const docDef: TDocumentDefinitions = {
    pageSize: "A4",
    ...(useLandscapePrint ? { pageOrientation: "landscape" as const } : {}),
    pageMargins: [PRINT_SIDE_MARGIN_PT, 100, PRINT_SIDE_MARGIN_PT, 40],
    header: header,
    footer: footer,
    content: body,
    styles: {
      // Keep top labels slightly smaller for cleaner print header.
      header: { fontSize: 16, bold: true },
      sub: { fontSize: 9, color: '#555' },
      subheader: { fontSize: 12, bold: true, margin: [0, 0, 0, 0] },
      body: { fontSize: 9 },
      spendWiseGapRow: { fontSize: 1, color: "#ffffff" },
    }
  };
  if (includeLogo && p.company.logoUrl) {
    (docDef as any).images = { companyLogo: p.company.logoUrl };
  }
  return docDef;
}

function computeRows(payload: PrintPayload) {
  if (payload.context === 'overdue') {
    const toTime = (d: any) => {
      if (!d) return 0;
      const t = d?.toDate ? d.toDate() : new Date(d);
      return t instanceof Date && !isNaN(t.getTime()) ? t.getTime() : 0;
    };
    const list = Array.isArray(payload.transactions) ? payload.transactions : [];
    const sorted = [...list].sort((a, b) => toTime(a.date) - toTime(b.date));
    let running = 0;
    const rowsAsc = sorted.map((t) => {
      const debit = typeof t.debit === 'number' ? t.debit : 0;
      const credit = typeof t.credit === 'number' ? t.credit : 0;
      running += (debit - credit);
      return { ...t, debit, credit, runningBalance: running };
    });
    const periodDr = rowsAsc.reduce((sum, row) => sum + row.debit, 0);
    const periodCr = rowsAsc.reduce((sum, row) => sum + row.credit, 0);
    return { rows: rowsAsc, periodDr, periodCr, closing: periodDr - periodCr };
  }

  if (payload.spendWise === true) {
    // Spend-wise print: preserve prepared row values/order from UI instead of rebuilding statement running logic.
    const includeNotes = payload.includeNotes === true;
    const base = [...payload.transactions]
      .filter((t: any) => !(t as any)?._spendWiseSpacer)
      .filter((t: any) => includeNotes || t.type !== "note");
    const prepared = payload.preserveOrder
      ? base
      : base.sort(
          (a: any, b: any) =>
            (a.date?.toDate ? a.date.toDate() : new Date(a.date)).getTime() -
            (b.date?.toDate ? b.date.toDate() : new Date(b.date)).getTime()
        );

    const mergePartitionsSpend = resolvePrintFiscalMergePartitions(payload, payload.dateSystem);
    const preparedWithPart =
      mergePartitionsSpend.length
        ? insertFiscalPartitionRowsMulti(prepared, mergePartitionsSpend)
        : prepared;

    let lastSpendWiseBal: number | null = null;
    const rows: any[] = [];
    for (const t of preparedWithPart) {
      if (t.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
        const bal = lastSpendWiseBal ?? (Number(payload.openingBalance) || 0);
        rows.push({ ...t, debit: 0, credit: 0, runningBalance: bal });
        if (mergePartitionsSpend.length) {
          pushFyOpeningPrintRowAfterPartition(rows, t, bal, payload.company, payload.dateSystem);
        }
        continue;
      }
      if (t.type === FY_OPENING_ROW_TYPE) continue;
      let debit = Number(t.debit) || 0;
      let credit = Number(t.credit) || 0;
      const linkedAmt = Number((t as any)._spendWiseLinkedAmount) || 0;
      if ((t as any)._spendWiseChild && linkedAmt > 0) {
        const isOutflow = (t.type === "payment_out" || t.type === "direct_expense") || (Number(t.credit) > 0);
        if (isOutflow) {
          debit = 0;
          credit = linkedAmt;
        } else {
          debit = linkedAmt;
          credit = 0;
        }
      }
      const spendWiseBalance =
        typeof (t as any)._spendWiseLedgerRunningBalance === "number"
          ? Number((t as any)._spendWiseLedgerRunningBalance)
          : typeof (t as any)._spendWiseRunningBalance === "number"
            ? Number((t as any)._spendWiseRunningBalance)
            : Number(t.balance ?? t.runningBalance) || 0;
      lastSpendWiseBal = spendWiseBalance;
      rows.push({ ...t, debit, credit, runningBalance: spendWiseBalance });
    }

    const periodDr = rows.reduce((sum, row) => sum + (Number(row.debit) || 0), 0);
    const periodCr = rows.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
    // Spend-wise UI groups can restart per group; closing should follow accounting total, not last displayed group balance.
    const closing = (Number(payload.openingBalance) || 0) + periodDr - periodCr;
    return { rows, periodDr, periodCr, closing };
  }

  // Respect UI note toggle and selected order (statement/bill-wise/spend-wise) in print rows.
  const includeNotes = payload.includeNotes === true;
  const filtered = [...payload.transactions].filter((t) => includeNotes || t.type !== "note");
  const sorted = payload.preserveOrder
    ? filtered
    : filtered.sort(
        (a, b) =>
          (a.date?.toDate ? a.date.toDate() : new Date(a.date)).getTime() -
          (b.date?.toDate ? b.date.toDate() : new Date(b.date)).getTime()
      );

  const mergePartitions = resolvePrintFiscalMergePartitions(payload, payload.dateSystem);
  const sortedWithPart =
    mergePartitions.length ? insertFiscalPartitionRowsMulti(sorted, mergePartitions) : sorted;

  const openingBalNum = typeof payload.openingBalance === 'number' ? payload.openingBalance : 0;
  let runningBalance = openingBalNum;
  
  const itemForContext = payload.context === 'item' ? findItem(payload.itemsData, payload.contextId) : undefined;

  const rowsAsc: any[] = [];
  let fySegmentDr = 0;
  let fySegmentCr = 0;
  for (const t of sortedWithPart) {
    if ((t as any).type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      rowsAsc.push({
        ...(t as any),
        debit: 0,
        credit: 0,
        runningBalance,
        _partitionClosingSummary: {
          totalDr: fySegmentDr,
          totalCr: fySegmentCr,
          closingBalance: runningBalance,
        } satisfies FiscalPartitionClosingSummary,
      });
      fySegmentDr = 0;
      fySegmentCr = 0;
      if (mergePartitions.length) {
        pushFyOpeningPrintRowAfterPartition(rowsAsc, t, runningBalance, payload.company, payload.dateSystem);
      }
      continue;
    }
    if ((t as any).type === FY_OPENING_ROW_TYPE) continue;
    const { debit, credit } = getTransactionAmounts(
      t,
      payload.context,
      itemForContext || payload.contextId,
      payload.stockView,
      payload.itemsData
    );
    const dueDate = t.dueDate ?? t.due_date;
    const row = {
      ...t,
      debit,
      credit,
      runningBalance,
      dueDate,
      due_date: t.due_date ?? t.dueDate,
      isOverdue: t.isOverdue,
      paymentStatus: t.paymentStatus,
      linkedFromVoucherNos: t.linkedFromVoucherNos,
      linkedToVoucherNos: t.linkedToVoucherNos,
      linkedFromVoucherNosBillWise: t.linkedFromVoucherNosBillWise,
      linkedToVoucherNosBillWise: t.linkedToVoucherNosBillWise,
    };
    if (t.type === "opening_balance" && typeof t.runningBalance === "number") {
      runningBalance = t.runningBalance;
      fySegmentDr += debit;
      fySegmentCr += credit;
      rowsAsc.push({ ...row, runningBalance });
      continue;
    }
    runningBalance += debit - credit;
    fySegmentDr += debit;
    fySegmentCr += credit;
    rowsAsc.push({ ...row, runningBalance });
  }

  const periodDr =
    typeof payload.ledgerPagePeriodDr === "number"
      ? payload.ledgerPagePeriodDr
      : rowsAsc.reduce((sum, row) => sum + row.debit, 0);
  const periodCr =
    typeof payload.ledgerPagePeriodCr === "number"
      ? payload.ledgerPagePeriodCr
      : rowsAsc.reduce((sum, row) => sum + row.credit, 0);
  const closingBalance =
    typeof payload.ledgerPageClosingBalance === "number"
      ? payload.ledgerPageClosingBalance
      : openingBalNum + periodDr - periodCr;

  return { rows: rowsAsc, periodDr, periodCr, closing: closingBalance };
}


function getTransactionAmounts(t: any, context: Context, entityOrId?: any, stockView?: 'qty' | 'amount', items?: any[]) {
  let debit = 0, credit = 0;
  const amount = parseFloat(String(t.total ?? t.amount ?? 0));
  const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
  
  const isIdMatch = (id1: any, id2: any) => String(id1) === String(id2);

  // Special Handling for Opening Balance transactions
  if (t.type === 'opening_balance') {
    if (typeof t.debit === "number") debit = t.debit;
    if (typeof t.credit === "number") credit = t.credit;
    return { debit, credit };
  }

  // Special Handling for System Accounts
  if (isIdMatch(entityId, 'sales_account')) {
    if (t.type === 'sale') credit += (t.subTotal - (t.discount || 0));
    return { debit, credit };
  }
  if (isIdMatch(entityId, 'purchase_account')) {
    if (t.type === 'purchase') debit += (t.subTotal - (t.discount || 0));
    return { debit, credit };
  }

  switch (context) {
    case "party":
      if (entityOrId && entityId === 'all') { // This is for group statement / All Vouchers view
          if (t.type === 'sale') {
              credit += amount; 
          } else if (t.type === 'purchase') {
              debit += amount;
          } else if (t.type === 'payment_out' || t.type === 'direct_expense') {
              credit += amount; // Payment = Credit (money going out)
          } else if (t.type === 'payment_in' || t.type === 'direct_income') {
              debit += amount; // Payment In = Debit (money coming in)
          }
      } 
      else if (entityOrId && t.partyId === entityId) {
          if (["sale", "payment_out", "direct_income"].includes(t.type)) debit += amount;
          if (["purchase", "payment_in", "direct_expense"].includes(t.type)) credit += amount;
      }
      
      if (t.type === 'journal' && t.entries) {
        t.entries.forEach((entry: any) => {
          if (isIdMatch(entry.accountId, entityId)) {
            debit += parseFloat(String(entry.debit || 0));
            credit += parseFloat(String(entry.credit || 0));
          }
        });
      }
      break;

    case "account":
      if (entityOrId && entityId === 'all') {
        // Handle "All Vouchers" view for accounts
        // Check if it's journal or contra by transaction type when contextId is 'all'
        if (t.type === 'journal' && t.subType !== 'add_salary') {
          // For "All Journal Vouchers" view, sum all debit and credit entries
          if (t.entries && Array.isArray(t.entries)) {
            debit = t.entries.reduce((sum: number, e: any) => sum + parseFloat(String(e.debit || 0)), 0);
            credit = t.entries.reduce((sum: number, e: any) => sum + parseFloat(String(e.credit || 0)), 0);
          }
        } else if (t.type === 'contra') {
          // Contra: Debit To Account, Credit From Account
          debit = amount; // To Account gets debit
          credit = amount; // From Account gets credit
        } else if (t.accountId) {
          if (["payment_in","direct_income", "sale"].includes(t.type)) debit = amount;
          if (["payment_out","direct_expense", "purchase"].includes(t.type)) credit = amount;
        }
      } else {
        if (["payment_in","direct_income", "sale"].includes(t.type) && isIdMatch(t.accountId, entityId)) debit = amount;
        if (["payment_out","direct_expense", "purchase"].includes(t.type) && isIdMatch(t.accountId, entityId)) credit = amount;
        if (t.type === "contra") {
          if (isIdMatch(t.toAccountId, entityId)) debit = amount; 
          if (isIdMatch(t.fromAccountId, entityId)) credit = amount; 
        }
        if (t.type === 'journal' && t.entries) {
          t.entries.forEach((entry: any) => {
            if (isIdMatch(entry.accountId, entityId)) {
              debit += parseFloat(String(entry.debit || 0));
              credit += parseFloat(String(entry.credit || 0));
            }
          });
        }
      }
      break;

    case "staff":
      if (entityOrId && entityId === 'all') {
        // Handle "All Vouchers" view for staff - show all add_salary transactions
        if (t.type === 'journal' && t.subType === 'add_salary' && Array.isArray(t.entries)) {
          // For add_salary, sum all staff credit entries
          t.entries.forEach((e: any) => {
            if (e.credit > 0) {
              credit += parseFloat(String(e.credit || 0));
            }
          });
        } else if (t.type === 'payment_out' && t.staffId) {
          debit = amount;
        } else if (t.type === 'payment_in' && t.staffId) {
          credit = amount;
        }
      } else if (isIdMatch(t.staffId, entityId)) {
        if (t.type === "payment_out") debit = amount;
        if (t.type === "payment_in")  credit = amount;
      }
      if (t.type === 'journal' && t.entries) {
        t.entries.forEach((entry: any) => {
          if (isIdMatch(entry.accountId, entityId)) {
            credit += parseFloat(String(entry.credit || 0));
            debit += parseFloat(String(entry.debit || 0));
          }
        });
      }
      break;

    case "tax":
         if (isIdMatch(t.taxAccountId, entityId)) {
            if (t.type === 'payment_in') credit += amount;
            else if (t.type === 'payment_out') debit += amount;
        }
        if (t.lineItems) {
            t.lineItems.forEach((line: any) => {
            if (isIdMatch(line.taxAccountId, entityId)) {
                if (t.type === "purchase") debit += line.taxAmount || 0;
                else if (t.type === "sale") credit += line.taxAmount || 0;
            }
            });
        }
         if (t.type === 'journal' && t.entries) {
          t.entries.forEach((entry: any) => {
            if (isIdMatch(entry.accountId, entityId)) {
              debit += parseFloat(String(entry.debit || 0));
              credit += parseFloat(String(entry.credit || 0));
            }
          });
        }
        break;

    case "expense":
        if (isIdMatch(t.expenseAccountId, entityId) || isIdMatch(t.incomeAccountId, entityId)) {
            if (t.type === 'direct_expense') debit = amount;
            if (t.type === 'direct_income') credit = amount;
        }
        if (t.type === 'journal' && t.entries) {
            const journalAmt = sumJournalAmountsForAccount(t.entries, entityId);
            debit += journalAmt.debit;
            credit += journalAmt.credit;
        }
        break;

    case "daybook":
         if (['sale', 'payment_in', 'direct_income'].includes(t.type)) debit = amount;
         if (['purchase', 'payment_out', 'direct_expense'].includes(t.type)) credit = amount;
         if (['journal', 'contra'].includes(t.type)) {
            debit = amount; 
            credit = amount;
         }
         break;

    case "item":
        let lineItem = (t.lineItems || t.items)?.find((li:any) => isIdMatch(li.itemId, entityId));

        if (!lineItem && isIdMatch(t.itemId, entityId)) {
            lineItem = t; 
        }

        if (lineItem) {
            const qty = parseFloat(String(lineItem.quantity || lineItem.qty || 0));
            const rate = parseFloat(String(lineItem.rate || 0));
            const itemData = entityOrId as any | undefined;
            
            let convertedQty = qty;
            if (stockView === 'qty') {
                const conversions = (itemData?.unitConversions || []) as any[];
                const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : lineItem.unit;
                let factorToSmallest = 1;
                
                if (lineItem.unit && lineItem.unit !== smallestUnit) {
                    let current = lineItem.unit;
                    let attempts = 0;
                    while (current !== smallestUnit && current && attempts < 5) {
                        const conv = conversions.find((c: any) => c.fromUnit === current);
                        if (!conv) { factorToSmallest = 0; break; }
                        factorToSmallest *= Number(conv.conversionFactor);
                        current = conv.toUnit;
                        attempts++;
                    }
                }
                if (factorToSmallest === 0) factorToSmallest = 1; 
                convertedQty = qty * factorToSmallest;
            }

            const type = t.type ? t.type.toLowerCase() : '';

            if (["purchase", "direct_income", "credit_note", "sales_return", "stock_in", "opening"].includes(type)) {
                if (stockView === 'qty') {
                     debit = convertedQty;
                } else {
                     debit = (lineItem.amount) ? parseFloat(lineItem.amount) : (qty * rate);
                }
            }
            else if (["sale", "direct_expense", "debit_note", "purchase_return", "stock_out"].includes(type)) {
                if (stockView === 'qty') {
                     credit = convertedQty;
                } else {
                     const purchasePrice = Number(itemData?.purchasePrice || rate);
                     credit = qty * purchasePrice;
                }
            }
            else if (type === 'journal') {
                 if (lineItem.type === 'debit') {
                    debit = stockView === 'qty' ? convertedQty : (qty * rate);
                 } else if (lineItem.type === 'credit') {
                    credit = stockView === 'qty' ? convertedQty : (qty * rate);
                 }
            }
        } 
        else {
            if (typeof t.debit === "number") debit = t.debit;
            if (typeof t.credit === "number") credit = t.credit;
            
            if (stockView === 'qty' && debit === 0 && credit === 0) {
                 if (typeof t.inQty === "number") debit = t.inQty;
                 else if (typeof t.in === "number") debit = t.in;

                 if (typeof t.outQty === "number") credit = t.outQty;
                 else if (typeof t.out === "number") credit = t.out;
            }
        }
      break;

    default:
      if (typeof t.debit === "number") debit = t.debit;
      if (typeof t.credit === "number") credit = t.credit;
  }

  // Inter Company — print me bhi ledger jaisa Dr/Cr (ek side / dono side legs)
  if (t.type === "inter_company" && entityId && entityId !== "all") {
    const icContexts: LedgerContext[] = ["party", "account", "staff", "tax", "expense"];
    if (icContexts.includes(context as LedgerContext)) {
      const ic = getInterCompanyLedgerAmounts(
        t,
        context as LedgerContext,
        entityId,
        amount
      );
      if (ic.touched) {
        debit = ic.debit;
        credit = ic.credit;
      }
    }
  }

  return { debit, credit };
}

// ----- FORMATTERS -----
const getFormatters = (p: PrintPayload) => {
    const decimalPlaces = p.company.decimalPlaces;
    const showDrCr = p.company.showDrCr ?? true;
    const showCurrencySymbol = p.company.showCurrencySymbol ?? true;
    const isZeroDecimal = decimalPlaces === 0;

    const currencyOptions: Intl.NumberFormatOptions = {
        style: 'decimal',
        minimumFractionDigits: isZeroDecimal ? 0 : (decimalPlaces ?? 2),
        maximumFractionDigits: isZeroDecimal ? 20 : (decimalPlaces ?? 2),
    };

    const dateFormatAD = getStoredDateFormatAD();
    const dateFormatBS = getStoredDateFormatBS();

    const formatDate = (date: Date): string => {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      try {
        return formatDateFns(date, dateFormatAD);
      } catch {
        return date.toLocaleDateString('en-CA');
      }
    };

    const formatDateBS = (date: Date): string => {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      const bs = formatBsFromAD(date, dateFormatBS);
      return bs !== "" ? bs : formatDate(date);
    };

    const formatCurrencyForPrint = (n: number, opts?: { noSuffix?: boolean}) => {
        if (typeof n !== 'number' || isNaN(n)) return '-';
        if (n === 0 && !opts?.noSuffix) return '-';
        
        let formatted = Math.abs(n).toLocaleString('en-IN', currencyOptions);
        if (showCurrencySymbol) {
            formatted = `Rs. ${formatted}`;
        }

        if (opts?.noSuffix) {
            return n < 0 ? `-${formatted}` : formatted;
        }
        
        const suffix = n >= 0 ? "Dr" : "Cr";
        if (showDrCr) {
            return `${formatted} ${suffix}`;
        }
        
        return n < 0 ? `-${formatted}` : formatted;
    }


    const formatRunning = (n: number) => {
        if (typeof n !== 'number') return '-';
        if (p.context === 'item' && p.stockView === 'qty') {
             const val = n.toLocaleString('en-IN', {
                minimumFractionDigits: isZeroDecimal ? 0 : (decimalPlaces ?? 2),
                maximumFractionDigits: isZeroDecimal ? 20 : (decimalPlaces ?? 2),
            });
            // Append unit if qty view
            return `${val} ${p.displayUnit || ''}`;
        }
        let v = Math.abs(n).toLocaleString('en-IN', currencyOptions);
        if(showCurrencySymbol) v = `Rs. ${v}`;

        if (!showDrCr) return v;
        const drCr = n >= 0 ? "Dr" : "Cr";
        return `${v} ${drCr}`;
    };

     const numToWords = (num: number): string => {
        const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        const inWords = (n: number): string => {
            if (n < 20) return a[n];
            let digit = n % 10;
            return `${b[Math.floor(n / 10)]} ${a[digit]}`.trim();
        };
        const toWords = (n: number): string => {
            if (n === 0) return 'zero';
            const crore = Math.floor(n / 10000000);
            const lakh = Math.floor((n % 10000000) / 100000);
            const thousand = Math.floor((n % 100000) / 1000);
            const hundreds = Math.floor((n % 1000) / 1000);
            const remainder = n % 100;
            let str = '';
            if (crore > 0) str += `${inWords(crore)} crore `;
            if (lakh > 0) str += `${inWords(lakh)} lakh `;
            if (thousand > 0) str += `${inWords(thousand)} thousand `;
            if (hundreds > 0) str += `${inWords(hundreds)} hundred `;
            if (remainder > 0) str += inWords(remainder);
            return str.trim();
        };
        const [integerPart, decimalPart] = num.toFixed(2).split('.').map(Number);
        let words = toWords(integerPart);
        if (decimalPart > 0) words += ` and ${toWords(decimalPart)} paisa`;
        return words.replace(/\s+/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    return { formatDate, formatDateBS, formatCurrencyForPrint, formatRunning, numToWords };
}

// ----- PDFMAKE TABLE BUILDERS -----

/** pdfMake requires each row to have exactly column-count elements. Pad with {} so row length matches. */
function ensureRowLength(row: TableCell[], expectedLength: number): TableCell[] {
  while (row.length < expectedLength) row.push({});
  return row;
}

const buildOpeningBalanceRow = (
  p: PrintPayload,
  formatRunning: Function,
  formatCurrencyForPrint: Function,
  formatDate: Function,
  formatDateBS: Function,
  colSpan: number
): TableCell[][] | null => {
  const palette = getPrintColorPalette(p.printColorMode);
  if (p.context === "daybook" || p.context === "sale" || p.context === "overdue") return null;

  const openingRows = resolveLedgerOpeningPrintRows({
    context: p.context,
    openingBalance: Number(p.openingBalance) || 0,
    booksOpeningBalance: p.booksOpeningBalance,
    ledgerShowBookOpeningRow: p.ledgerShowBookOpeningRow,
    ledgerDateFilterActive: p.ledgerDateFilterActive,
    openingBalancePeriodStartDate: p.openingBalancePeriodStartDate,
    masterOpeningBalanceDate: p.openingBalanceDate,
    dateRange: p.ledgerDateRange,
    country: p.company?.country,
  });

  const isBillWise = isBillWiseContext(p);
  const showDr = isColVisible(p, "dr");
  const showCr = isColVisible(p, "cr");
  const showStatus = isBillWise && isColVisible(p, "status");
  const showBalance = isColVisible(p, "runningBalance");
  const showType = isColVisible(p, "type");
  const showDate = isColVisible(p, "date");
  const showVoucherNo = isColVisible(p, "voucherNo");
  const showUser = isColVisible(p, "user");
  const showFile = isColVisible(p, "file");
  const visibleDataCols = [showDr, showCr, showStatus, showBalance].filter(Boolean).length;

  const factor =
    p.context === "item" && p.stockView === "qty"
      ? getConversionFactor(findItem(p.itemsData, p.contextId), p.displayUnit)
      : 1;

  const buildOneRow = (
    spec: LedgerOpeningPrintRow,
    applyBillWiseExtras: boolean
  ): TableCell[][] => {
    const openingBalNum = spec.signedBalance / factor;
    const openingText = formatRunning(openingBalNum);
    let displayOpeningText: string = typeof openingText === "string" ? openingText : "-";
    if (p.context === "item" && p.stockView === "qty") {
      displayOpeningText = `${openingBalNum.toFixed(2)} ${p.displayUnit || ""}`.trim() || "-";
    }

    const openingBalanceDr = openingBalNum > 0 ? openingBalNum : 0;
    const openingBalanceCr = openingBalNum < 0 ? Math.abs(openingBalNum) : 0;

    let displayOpeningBalanceDr = "-";
    let displayOpeningBalanceCr = "-";
    if (p.context === "item" && p.stockView === "qty") {
      displayOpeningBalanceDr =
        openingBalanceDr > 0 ? `${openingBalanceDr.toFixed(2)} ${p.displayUnit || ""}`.trim() : "-";
      displayOpeningBalanceCr =
        openingBalanceCr > 0 ? `${openingBalanceCr.toFixed(2)} ${p.displayUnit || ""}`.trim() : "-";
    } else {
      displayOpeningBalanceDr =
        openingBalanceDr > 0 ? formatCurrencyForPrint(openingBalanceDr, { noSuffix: true }) : "-";
      displayOpeningBalanceCr =
        openingBalanceCr > 0 ? formatCurrencyForPrint(openingBalanceCr, { noSuffix: true }) : "-";
    }

    const obAmount = Math.abs(openingBalNum);
    const obOutstanding = applyBillWiseExtras
      ? p.openingBalanceOutstanding ?? obAmount
      : obAmount;
    const signedOutstanding = openingBalNum >= 0 ? obOutstanding : -obOutstanding;
    const balanceDisplayText = applyBillWiseExtras
      ? p.context === "item" && p.stockView === "qty"
        ? `${Math.abs(signedOutstanding).toFixed(2)} ${p.displayUnit || ""}`.trim()
        : formatRunning(signedOutstanding)
      : displayOpeningText;

    const balanceCell: TableCell = {
      text: balanceDisplayText,
      alignment: "right",
      bold: true,
      color: palette.balanceSigned(signedOutstanding),
      fontSize: getAutoFontSize(typeof balanceDisplayText === "string" ? balanceDisplayText : "", 9),
      noWrap: true,
    };
    const debitCell: TableCell = {
      text: displayOpeningBalanceDr,
      alignment: "right",
      bold: true,
      color: palette.debit,
      fontSize: getAutoFontSize(displayOpeningBalanceDr, 9),
      noWrap: true,
    };
    const creditCell: TableCell = {
      text: displayOpeningBalanceCr,
      alignment: "right",
      bold: true,
      color: palette.credit,
      fontSize: getAutoFontSize(displayOpeningBalanceCr, 9),
      noWrap: true,
    };

    const dateCells: TableCell[] = [];
    if (showDate) {
      const d = spec.rowDate;
      if (p.dateSystem === "Both") {
        dateCells.push({
          text: d ? formatDateBS(d) : "",
          fontSize: 9,
          noWrap: true,
        });
        dateCells.push({
          text: d ? formatDate(d) : "",
          fontSize: 9,
          noWrap: true,
        });
      } else {
        dateCells.push({
          text: d ? (p.dateSystem === "AD" ? formatDate(d) : formatDateBS(d)) : "",
          fontSize: 9,
          noWrap: true,
        });
      }
    }

    const metaColSpan =
      (showVoucherNo ? 1 : 0) +
      (p.context === "daybook" ? 1 : 0) +
      (showUser ? 1 : 0) +
      (showFile ? 1 : 0);
    const leadingLabelColSpan = dateCells.length + (showType ? 1 : 0) + metaColSpan;

    const row: TableCell[] = [...dateCells];

    if (showType) {
      row.push({
        text: spec.pillLabel,
        bold: true,
        fontSize: LEDGER_PRINT_BODY_FONT,
        noWrap: true,
      });
      if (showVoucherNo) row.push({ text: "", fontSize: 9, noWrap: true });
      if (p.context === "daybook") row.push({ text: "", fontSize: 9, noWrap: true });
      if (showUser) row.push({ text: "", fontSize: 9, noWrap: true });
      if (showFile) row.push({ text: "-", fontSize: 9, alignment: "center", noWrap: true });
    } else if (metaColSpan > 0) {
      row.push({
        text: spec.pillLabel,
        colSpan: metaColSpan,
        bold: true,
        alignment: "left",
        fontSize: 9,
        noWrap: true,
      });
      for (let i = 1; i < metaColSpan; i++) row.push({});
    } else if (dateCells.length === 0) {
      row.push({
        text: spec.pillLabel,
        colSpan: 1,
        bold: true,
        alignment: "left",
        fontSize: 9,
        noWrap: true,
      });
    }

    if (leadingLabelColSpan < 1 && visibleDataCols === 0) {
      return [[{ text: spec.pillLabel, colSpan, bold: true, alignment: "left", fontSize: 9, noWrap: true }]];
    }

    if (applyBillWiseExtras && isBillWise) {
      const obStatusLabel =
        obOutstanding <= 0 ? "Paid" : obOutstanding >= obAmount ? "Unpaid" : "Partial";
      const obNos = p.openingBalanceLinkedVoucherNos ?? [];
      const vouchers = p.vouchers ?? [];
      const partyId = p.contextId ?? "";
      const getOBAmountForVoucher = (no: string): number => {
        const v = vouchers.find((x: any) => (x.voucherNumber ?? x.voucher_number ?? "") === no);
        if (!v) return 0;
        if (
          v.type === "sale" ||
          v.type === "sale_service" ||
          v.type === "purchase" ||
          v.type === "purchase_service"
        )
          return Number((v as any).openingBalanceAllocated) || 0;
        const allocs =
          (v.allocations as { voucherId: string; linkedAccountId?: string }[] | undefined) || [];
        const obAlloc = allocs.find((a: any) => a.voucherId === OPENING_BALANCE_VOUCHER_ID);
        if (!obAlloc) return 0;
        if (v.type === "journal" && (obAlloc as any).linkedAccountId && partyId)
          return String((obAlloc as any).linkedAccountId) === String(partyId)
            ? getAllocationTotal(obAlloc)
            : 0;
        return getAllocationTotal(obAlloc);
      };
      const decimalPlaces = p.company.decimalPlaces ?? 2;
      const visibleObNos = p.printLinkedVouchersMode === "max2" ? obNos.slice(0, 2) : obNos;
      const hiddenObNosCount = obNos.length - visibleObNos.length;
      const obDetailContent =
        obNos.length && p.showNarration
          ? visibleObNos.flatMap((no, i) => {
              const amt = vouchers.length ? getOBAmountForVoucher(no) : 0;
              const displayNo = no === "Opening Balance" ? "Opening" : no;
              const label = amt > 0 ? `${displayNo}) ${formatVoucherAmount(amt, decimalPlaces)}` : displayNo;
              return [
                ...(i > 0 ? [{ text: " + ", fontSize: 7 }] : []),
                { text: label, color: palette.billWiseVoucher(i), fontSize: 7 },
              ];
            })
          : [];
      if (hiddenObNosCount > 0 && p.showNarration) {
        obDetailContent.push({
          text: ` + More (+${hiddenObNosCount})`,
          color: p.printColorMode === "bw" ? "#000000" : "#2563eb",
          fontSize: 7,
        });
      }
      const statusCell: TableCell = {
        text: obStatusLabel,
        color: obStatusLabel === "Paid" ? palette.paid : palette.unpaid,
        fontSize: 9,
        alignment: "left",
        noWrap: true,
      };
      if (showDr) row.push(debitCell);
      if (showCr) row.push(creditCell);
      if (showStatus) row.push(statusCell);
      if (showBalance) row.push(balanceCell);
      ensureRowLength(row, colSpan);
      if (obDetailContent.length === 0) return [row];
      const subRow: TableCell[] = [{ text: "", colSpan: leadingLabelColSpan, style: "narrationRow" }];
      for (let i = 1; i < leadingLabelColSpan; i++) subRow.push({ text: "" });
      if (showDr) subRow.push({ text: "", style: "narrationRow" });
      if (showCr) subRow.push({ text: "", style: "narrationRow" });
      const obDetailColSpan = (showStatus ? 1 : 0) + (showBalance ? 1 : 0);
      if (obDetailColSpan > 0) {
        subRow.push({
          text: obDetailContent,
          colSpan: obDetailColSpan,
          alignment: "left",
          style: "narrationRow",
          noWrap: false,
        });
        for (let i = 1; i < obDetailColSpan; i++) subRow.push({ text: "" });
      }
      ensureRowLength(subRow, colSpan);
      return [row, subRow];
    }

    if (showDr) row.push(debitCell);
    if (showCr) row.push(creditCell);
    if (showBalance) row.push(balanceCell);
    ensureRowLength(row, colSpan);
    return [row];
  };

  const result: TableCell[][] = [];
  openingRows.forEach((spec, index) => {
    const applyBillWiseExtras = isBillWise && index === openingRows.length - 1;
    result.push(...buildOneRow(spec, applyBillWiseExtras));
  });

  const narrationTrimmed = (p.openingBalanceNarration ?? "").trim();
  if (p.showNarration && narrationTrimmed && result.length > 0) {
    const lastMainRow = result[result.length - 1];
    const narrationSpan = Math.max(1, colSpan - visibleDataCols);
    const subRow: TableCell[] = [
      {
        text: [{ text: "Narration: ", bold: true }, narrationTrimmed],
        colSpan: narrationSpan,
        fontSize: 8,
        italics: true,
        style: "narrationRow",
      },
    ];
    for (let i = 1; i < narrationSpan; i++) subRow.push({});
    for (let i = narrationSpan; i < colSpan; i++) subRow.push({});
    ensureRowLength(subRow, colSpan);
    result.push(subRow);
  }

  return result.length > 0 ? result : null;
};

/** Minimum left/right page margin (6 mm) — table must fit inside remaining width. */
const PRINT_SIDE_MARGIN_MM = 6;
const PRINT_SIDE_MARGIN_PT = (PRINT_SIDE_MARGIN_MM * 72) / 25.4;

/** Ledger print: 7+ visible columns → landscape (e.g. Both date + type + voucher + Dr/Cr/Balance = 7). */
const PRINT_LANDSCAPE_COLUMN_THRESHOLD = 7;

function shouldUseLandscapeLedgerPrint(tableHeader: TableCell[]): boolean {
  return tableHeader.length >= PRINT_LANDSCAPE_COLUMN_THRESHOLD;
}

function ledgerPrintContentWidthPt(landscape: boolean): number {
  const pageWidthPt = landscape ? 841.89 : 595.28;
  return pageWidthPt - 2 * PRINT_SIDE_MARGIN_PT;
}

const buildTableHeader = (p: PrintPayload): TableCell[] => {
  const boldHeader = (text: string): TableCell => ({ text, bold: true, fontSize: LEDGER_PRINT_BODY_FONT, noWrap: true });
  
  if (p.context === 'sale' && p.transactions.length === 1) {
      return [boldHeader('S.N.'), boldHeader('Particulars'), boldHeader('Qty'), boldHeader('Rate'), {text: 'Amount', bold: true, fontSize: 9, alignment: 'right'}];
  }
  
  if (p.context === 'overdue') {
    const h: TableCell[] = [];
    if (p.dateSystem === 'Both') {
      h.push(boldHeader('Date (BS)'), boldHeader('Date (AD)'));
    } else {
      h.push(boldHeader('Date'));
    }
    h.push(boldHeader('Type'), boldHeader('Voucher No.'), boldHeader('Party (Account)'));
    h.push(
      { text: 'Debit', bold: true, fontSize: 9, alignment: 'right', noWrap: true },
      { text: 'Credit', bold: true, fontSize: 9, alignment: 'right', noWrap: true },
      { text: 'Status', bold: true, fontSize: 9, alignment: 'left', noWrap: true },
      { text: 'Net Balance', bold: true, fontSize: 9, alignment: 'right', noWrap: true }
    );
    return h;
  }
  
  let headers: TableCell[] = [];
  if (isColVisible(p, "date")) {
    if (p.dateSystem === 'Both') {
      headers.push(boldHeader('Date (BS)'), boldHeader('Date (AD)'));
    } else {
      headers.push(boldHeader('Date'));
    }
  }
  if (isColVisible(p, "type")) headers.push(boldHeader('Voucher Type'));
  if (isColVisible(p, "voucherNo")) headers.push(boldHeader('Voucher No.'));
  
  if (p.context === 'daybook') {
      headers.push(boldHeader('Particulars'));
  }
  if (isColVisible(p, "user")) headers.push(boldHeader('User'));
  if (isColVisible(p, "file")) headers.push(boldHeader('File'));

  const debitLabel =
    p.debitColumnHeaderLabel ??
    (p.context === 'item' && p.stockView === 'qty' ? 'In' : 'Debit');
  const creditLabel =
    p.creditColumnHeaderLabel ??
    (p.context === 'item' && p.stockView === 'qty' ? 'Out' : 'Credit');
  const balanceLabel = p.context === 'item' && p.stockView === 'qty' ? 'Stock' : 'Balance';

  const isBillWise = isBillWiseContext(p);
  if (isColVisible(p, "dr")) headers.push({ text: debitLabel, bold: true, fontSize: 9, alignment: 'right', noWrap: true });
  if (isColVisible(p, "cr")) headers.push({ text: creditLabel, bold: true, fontSize: 9, alignment: 'right', noWrap: true });
  if (isBillWise && isColVisible(p, "status")) {
    headers.push({ text: 'Status', bold: true, fontSize: 9, alignment: 'left', noWrap: true });
  }
  if (isColVisible(p, "runningBalance")) headers.push({ text: balanceLabel, bold: true, fontSize: 9, alignment: 'right', noWrap: true });
  
  return headers;
}

const getParticularsText = (row: any, journalAccountNames?: Record<string, string>): string => {
  if (row.type === 'journal' || row.type === 'contra') {
      return row.narration || 'Journal Entry';
  }
  if (row.partyName) return row.partyName;
  return row.narration || row.type;
};

const formatBillStatus = (paymentStatus?: string, isOverdue?: boolean): string => {
  if (isOverdue) return 'Overdue';
  if (!paymentStatus) return '';
  if (paymentStatus === 'paid') return 'Paid';
  if (paymentStatus === 'partially_paid') return 'Partial';
  if (paymentStatus === 'unpaid') return 'Unpaid';
  return paymentStatus;
};

const getBillStatusLabelForPrint = (t: any, context: Context, isOverdue?: boolean): string => {
  if (isOverdue) return "Overdue";
  const isStaffLikeContext = context === "staff" || context === "group";
  const isAddSalary = t.type === "journal" && t.subType === "add_salary";

  if (isAddSalary) {
    const status = t.paymentStatus;
    if (status === "paid") return "Paid";
    if (status === "unpaid") return "Unpaid";
    if (status === "partially_paid") return "Partial";
    if (status === "overdue" || t.isOverdue) return "Overdue";
    // Keep print fallback aligned with table UI when paymentStatus is missing on Add Salary.
    const allocations = (t.allocations as any[] | undefined) || [];
    const linkedFrom = (t.linkedFromVoucherNos as string[] | undefined) || [];
    const linkedTo = (t.linkedToVoucherNos as string[] | undefined) || [];
    if (allocations.length > 0 || linkedFrom.length > 0 || linkedTo.length > 0) {
      const amount = Number(t.amount ?? t.total ?? t.debit ?? t.credit ?? 0) || 0;
      if (amount > 0) {
        const totalLinked = allocations.reduce((sum, a) => sum + getAllocationTotal(a), 0);
        if (totalLinked >= amount) return "Paid";
        if (totalLinked > 0) return "Partial";
      }
    }
    return "Unpaid";
  }

  if (isStaffLikeContext && (t.type === "payment_out" || t.type === "direct_expense")) {
    // Staff/group bill-wise: payment out should show Paid/Partial/Unpaid from allocations even without paymentStatus.
    const amountPaid = Number(t.amount ?? t.total ?? 0) || 0;
    const allocations = (t.allocations as any[] | undefined) || [];
    const totalLinked = allocations.reduce((sum, a) => sum + getAllocationTotal(a), 0);
    if (amountPaid <= 0) return "Unpaid";
    if (totalLinked >= amountPaid) return "Paid";
    if (totalLinked > 0) return "Partial";
    return "Unpaid";
  }

  return formatBillStatus(t.paymentStatus, false);
};

// Voucher detail amount: decimal .00 hide karo, warna dikhao.
const formatVoucherAmount = (n: number, decimalPlaces = 2): string => {
  if (typeof n !== "number" || isNaN(n)) return "0";
  const abs = Math.abs(n);
  const factor = Math.pow(10, decimalPlaces);
  const isWhole = Math.round(abs * factor) % factor === 0;
  if (isWhole) return abs.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return abs.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: decimalPlaces });
};

// Build status-detail: VoucherNo) Amount + VoucherNo) Amount format, decimal .00 hide.
// Returns content for pdfmake: string (simple) or array of { text, color } for multi-color.
const getStatusDetailForPrint = (
  t: any,
  opts?: {
    billWiseOnly?: boolean;
    vouchers?: any[];
    formatCurrency?: (n: number, o?: any) => string;
    decimalPlaces?: number;
    /** Print options Color vs B&W — bill-wise voucher detail colors */
    colorMode?: PrintColorMode;
    linkedVouchersMode?: "all" | "max2";
  }
): string | Array<{ text: string; color?: string; fontSize?: number }> => {
  const billWiseOnly = opts?.billWiseOnly === true;
  const palette = getPrintColorPalette(opts?.colorMode);
  const from = (
    billWiseOnly
      ? (t.linkedFromVoucherNosBillWise as string[] | undefined)
      : (t.linkedFromVoucherNos as string[] | undefined)
  ) || [];
  const to = (
    billWiseOnly ? (t.linkedToVoucherNosBillWise as string[] | undefined) : (t.linkedToVoucherNos as string[] | undefined)
  ) || [];
  if (from.length === 0 && to.length === 0) return "";
  const vouchers = opts?.vouchers ?? [];
  const decimalPlaces = opts?.decimalPlaces ?? 2;
  const getAmountForFrom = (voucherNo: string): number => {
    if (voucherNo === "Opening Balance") return Number((t as any).openingBalanceAllocated) || 0;
    const v = vouchers.find((x: any) => (x.voucherNumber ?? x.voucher_number ?? "") === voucherNo);
    if (!v?.allocations) return 0;
    const a = (v.allocations as any[]).find((a: any) => a.voucherId === t.id);
    return a ? getAllocationTotal(a) : 0;
  };
  const getAmountForTo = (voucherNo: string): number => {
    if (voucherNo === "Opening Balance") {
      const allocs = (t.allocations as { voucherId: string; amount?: number }[] | undefined) || [];
      const a = allocs.find((al: any) => al.voucherId === OPENING_BALANCE_VOUCHER_ID);
      return a ? getAllocationTotal(a) : 0;
    }
    const allocs = (t.allocations as { voucherId: string; amount?: number }[] | undefined) || [];
    const target = vouchers.find((x: any) => (x.voucherNumber ?? x.voucher_number ?? "") === voucherNo);
    if (!target) return 0;
    const a = allocs.find((al: any) => al.voucherId === target.id);
    return a ? getAllocationTotal(a) : 0;
  };
  // Combine from first then to, dedupe (no "from"/"to" prefix in print).
  const deduped: { no: string; getAmt: (no: string) => number }[] = [];
  const seen2 = new Set<string>();
  for (const { no, getAmt } of [...from.map((no) => ({ no, getAmt: getAmountForFrom })), ...to.map((no) => ({ no, getAmt: getAmountForTo }))]) {
    if (seen2.has(no)) continue;
    seen2.add(no);
    deduped.push({ no, getAmt });
  }
  if (deduped.length === 0) return "";
  const fontSize = 7;
  const content: Array<{ text: string; color?: string; fontSize?: number }> = [];
  const visible = opts?.linkedVouchersMode === "max2" ? deduped.slice(0, 2) : deduped;
  visible.forEach(({ no, getAmt }, i) => {
    if (i > 0) content.push({ text: " + ", fontSize });
    const amt = vouchers.length ? getAmt(no) : 0;
    const displayNo = no === "Opening Balance" ? "Opening" : no;
    const label = amt > 0 ? `${displayNo}) ${formatVoucherAmount(amt, decimalPlaces)}` : displayNo;
    const color = palette.billWiseVoucher(i);
    content.push({ text: label, color, fontSize });
  });
  const hiddenCount = deduped.length - visible.length;
  if (hiddenCount > 0) {
    content.push({
      text: ` + More (+${hiddenCount})`,
      color: opts?.colorMode === "bw" ? "#000000" : "#2563eb",
      fontSize,
    });
  }
  return content;
};

function getOverdueDays(dueDate: any): number {
  if (!dueDate) return 0;
  let due: Date;
  if (typeof dueDate.toDate === 'function') {
    due = dueDate.toDate();
  } else if (typeof (dueDate as { seconds?: number }).seconds === 'number') {
    due = new Date((dueDate as { seconds: number }).seconds * 1000);
  } else {
    due = new Date(dueDate);
  }
  if (isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueOnly = new Date(due);
  dueOnly.setHours(0, 0, 0, 0);
  if (today <= dueOnly) return 0;
  return Math.floor((today.getTime() - dueOnly.getTime()) / (24 * 60 * 60 * 1000));
}

const SPEND_WISE_PRINT_HGRID_COLOR = "#aaaaaa";
/** App `spend-wise-gap-row` = 12px — print gap row margin (pt) se match */
const SPEND_WISE_PRINT_GROUP_GAP_MARGIN_PT = 4.5;

function spendWiseRowGroupId(row: any): string {
  return String(row?._spendWiseGroupId ?? "").trim();
}

/** Group box band — last row on page / print slice par bhi bottom edge (pagination clip). */
function spendWiseGroupEndsAfterRow(row: any, nextRow: any | undefined): boolean {
  if (row?._spendWiseGroupLast === true) return true;
  const gid = spendWiseRowGroupId(row);
  if (!nextRow || nextRow.type === FISCAL_YEAR_PARTITION_ROW_TYPE) return true;
  const nextGid = spendWiseRowGroupId(nextRow);
  if (!gid || !nextGid || nextGid !== gid) return true;
  return false;
}

function buildSpendWisePrintGroupBottomCap(colCount: number, color: string): TableCell[] {
  return Array.from({ length: colCount }, (_, idx) => ({
    text: "",
    border: [idx === 0, false, idx === colCount - 1, true],
    borderColor: [color, color, color, color],
    margin: [0, 0, 0, 0],
  }));
}

function buildSpendWisePrintGroupGapRow(colCount: number): TableCell[] {
  const row: TableCell[] = [
    {
      text: " ",
      colSpan: colCount,
      style: "spendWiseGapRow",
      border: [false, false, false, false],
      margin: [0, SPEND_WISE_PRINT_GROUP_GAP_MARGIN_PT, 0, SPEND_WISE_PRINT_GROUP_GAP_MARGIN_PT],
    },
  ];
  for (let i = 1; i < colCount; i++) row.push({});
  return row;
}

function appendSpendWiseGroupTail(resultRows: TableCell[][], colCount: number, color: string): void {
  resultRows.push(buildSpendWisePrintGroupBottomCap(colCount, color));
  resultRows.push(buildSpendWisePrintGroupGapRow(colCount));
}

/** Spend-wise print group box — top/bottom + left/right side lines (screen card jaisa). */
function applySpendWisePrintBorders(
  cells: TableCell[],
  opts: { top: boolean; bottom: boolean; color: string }
): TableCell[] {
  const count = cells.length;
  if (count === 0) return cells;

  const bottomColor = opts.bottom ? opts.color : SPEND_WISE_PRINT_HGRID_COLOR;

  const ensureCellText = (c: any) => {
    const hasRenderableContent =
      "text" in c ||
      "stack" in c ||
      "table" in c ||
      "columns" in c ||
      "image" in c ||
      "canvas" in c ||
      "svg" in c ||
      "qr" in c ||
      "ul" in c ||
      "ol" in c;
    if (!hasRenderableContent) c.text = "";
    return c;
  };

  const first: any = cells[0];
  const colSpan = typeof first?.colSpan === "number" ? first.colSpan : 1;
  // Narration sub-row: ek hi cell poori width span karti hai — right rail isi cell par lagao.
  if (colSpan >= count) {
    const c = ensureCellText(typeof first === "object" && first !== null ? { ...first } : { text: "" });
    c.border = [true, opts.top, true, true];
    c.borderColor = [
      opts.color,
      opts.top ? opts.color : SPEND_WISE_PRINT_HGRID_COLOR,
      opts.color,
      bottomColor,
    ];
    const out: TableCell[] = [c];
    for (let i = 1; i < count; i++) out.push({});
    return out;
  }

  return cells.map((cell, idx) => {
    const c: any = typeof cell === "object" && cell !== null ? { ...cell } : { text: String(cell ?? "") };
    ensureCellText(c);
    c.border = [idx === 0, opts.top, idx === count - 1, true];
    c.borderColor = [
      idx === 0 ? opts.color : SPEND_WISE_PRINT_HGRID_COLOR,
      opts.top ? opts.color : SPEND_WISE_PRINT_HGRID_COLOR,
      idx === count - 1 ? opts.color : SPEND_WISE_PRINT_HGRID_COLOR,
      bottomColor,
    ];
    return c as TableCell;
  });
}

function countPrintLeadingColsBeforeDrCr(p: PrintPayload): number {
  let n = 0;
  if (isColVisible(p, "date")) n += p.dateSystem === "Both" ? 2 : 1;
  if (isColVisible(p, "type")) n += 1;
  if (isColVisible(p, "voucherNo")) n += 1;
  if (p.context === "daybook") n += 1;
  if (isColVisible(p, "user")) n += 1;
  if (isColVisible(p, "file")) n += 1;
  return n;
}

function countPrintTrailingColsAfterDrCr(p: PrintPayload): number {
  let n = 0;
  if (isBillWiseContext(p) && isColVisible(p, "status")) n += 1;
  if (isColVisible(p, "runningBalance")) n += 1;
  return n;
}

/** Leading cols: poori width par FY End + Total (ek line, wrap nahi). */
function appendPartitionTotalLeadingCells(
  row: TableCell[],
  p: PrintPayload,
  closingEndLabel: string
): void {
  const leading = countPrintLeadingColsBeforeDrCr(p);
  const endText = (closingEndLabel || "").trim();
  const labelCell: TableCell = {
    alignment: "right",
    fontSize: LEDGER_PRINT_BODY_FONT,
    margin: [0, 4, 0, 4],
    noWrap: true,
    text: endText
      ? [
          { text: endText, bold: true, color: "#000000" },
          { text: "   ", color: "#000000" },
          { text: "Total", bold: true, color: "#000000" },
        ]
      : [{ text: "Total", bold: true, color: "#000000" }],
  };

  if (leading <= 0) {
    row.push(labelCell);
    return;
  }
  row.push({ ...labelCell, colSpan: leading });
  for (let i = 1; i < leading; i++) row.push({});
}

function buildFyPartitionClosingSummaryPrintRows(
  summary: FiscalPartitionClosingSummary,
  p: PrintPayload,
  colCount: number,
  formatCurrencyForPrint: Function,
  formatRunning: Function,
  showDrCr: boolean,
  closingEndLabel?: string
): TableCell[][] {
  const palette = getPrintColorPalette(p.printColorMode);
  const rowFill =
    p.printColorMode === "bw"
      ? null
      : getFyPartitionRowBackground(readFyPartitionRowColor("end"));
  const showDr = isColVisible(p, "dr");
  const showCr = isColVisible(p, "cr");
  const fmt = (val: number) => formatCurrencyForPrint(Math.abs(val), { noSuffix: true });
  const balanceText =
    showDrCr && typeof formatRunning === "function"
      ? formatRunning(summary.closingBalance)
      : (() => {
          const core = fmt(summary.closingBalance);
          if (!showDrCr) return core;
          return summary.closingBalance >= 0 ? `${core} Dr` : `${core} Cr`;
        })();
  const showStatus = isColVisible(p, "status") && isBillWiseContext(p);
  const showBalance = isColVisible(p, "runningBalance");

  const cells: TableCell[] = [];
  appendPartitionTotalLeadingCells(cells, p, closingEndLabel || "");
  if (showDr) {
    cells.push({
      text: fmt(summary.totalDr),
      alignment: "right",
      bold: true,
      fontSize: LEDGER_PRINT_BODY_FONT,
      color: palette.debit,
      margin: [0, 4, 0, 4],
      noWrap: true,
    });
  }
  if (showCr) {
    cells.push({
      text: fmt(summary.totalCr),
      alignment: "right",
      bold: true,
      fontSize: LEDGER_PRINT_BODY_FONT,
      color: palette.credit,
      margin: [0, 4, 0, 4],
      noWrap: true,
    });
  }
  if (showStatus) {
    cells.push({
      text: "-",
      alignment: "center",
      bold: true,
      fontSize: LEDGER_PRINT_BODY_FONT,
      margin: [0, 4, 0, 4],
    });
  }
  if (showBalance) {
    cells.push({
      text: balanceText,
      alignment: "right",
      bold: true,
      fontSize: LEDGER_PRINT_BODY_FONT,
      color: palette.balanceSigned(summary.closingBalance),
      margin: [0, 4, 0, 4],
      noWrap: true,
    });
  }

  ensureRowLength(cells, colCount);
  if (rowFill) {
    cells.forEach((cell) => {
      // pdfmake colSpan placeholders must remain plain `{}`; a fillColor-only
      // placeholder is treated as an invalid document node.
      if (cell && typeof cell === "object" && Object.keys(cell).length > 0) {
        cell.fillColor = rowFill;
      }
    });
  }
  return [cells];
}

const buildTableRow = (row: any, nextRow: any | undefined, p: PrintPayload, formatDate: Function, formatDateBS: Function, formatCurrencyForPrint: Function, formatRunning: Function, ledgerColCount: number): TableCell[][] => {
    const palette = getPrintColorPalette(p.printColorMode);
    if (row.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      const n = Math.max(1, ledgerColCount);
      const boundaryMs = parsePrintPartitionBoundaryMs(row);
      const partitionDate = boundaryMs != null ? new Date(boundaryMs) : null;
      const fmtStyle = readFyOpeningPillFormat();
      const optionalNote = p.fiscalPartitionLabel ?? p.company?.fiscalPartitionLabel ?? null;
      const split =
        partitionDate && !Number.isNaN(partitionDate.getTime())
          ? buildFiscalMergePartitionBannerSplitForDateSystem(
              p.company,
              partitionDate,
              p.dateSystem,
              formatDate as (d: Date) => string,
              optionalNote,
              fmtStyle
            )
          : null;
      const closingEndLabel =
        split?.closingEndLabel ??
        (typeof row._partitionLabel === "string" && row._partitionLabel
          ? row._partitionLabel
          : "── Closing fiscal period · New fiscal period ──");
      const newStartLabel = split?.newStartLabel ?? closingEndLabel;
      const startRowFill =
        p.printColorMode === "bw"
          ? null
          : getFyPartitionRowBackground(readFyPartitionRowColor("start"));
      const startCell: TableCell = {
        text: newStartLabel,
        colSpan: n,
        alignment: "left",
        bold: true,
        fontSize: LEDGER_PRINT_BODY_FONT,
        color: "#000000",
        margin: [0, 4, 0, 4],
        noWrap: true,
        ...(startRowFill ? { fillColor: startRowFill } : {}),
      };
      const newStartRow: TableCell[] = [startCell];
      for (let i = 1; i < n; i++) newStartRow.push({});
      const summary = row._partitionClosingSummary as FiscalPartitionClosingSummary | undefined;
      if (summary && (summary.totalDr > 0 || summary.totalCr > 0 || summary.closingBalance !== 0)) {
        const showDrCr = p.company?.showDrCr !== false;
        return [
          ...buildFyPartitionClosingSummaryPrintRows(
            summary,
            p,
            n,
            formatCurrencyForPrint,
            formatRunning,
            showDrCr,
            closingEndLabel
          ),
          newStartRow,
        ];
      }
      return [newStartRow];
    }

    if (row.type === FY_OPENING_ROW_TYPE || row._fyOpeningSynthetic === true) {
      const rawDate = row.date instanceof Date ? row.date : row.date ? new Date(row.date) : null;
      const validDate = rawDate instanceof Date && !isNaN(rawDate.getTime()) ? rawDate : null;
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      const signed = Number(row.runningBalance ?? row.balance) || 0;

      const dateCells: TableCell[] = [];
      if (isColVisible(p, "date")) {
        if (p.dateSystem === "Both") {
          dateCells.push({ text: validDate ? formatDateBS(validDate) : "", fontSize: LEDGER_PRINT_BODY_FONT, noWrap: true });
          dateCells.push({ text: validDate ? formatDate(validDate) : "", fontSize: LEDGER_PRINT_BODY_FONT, noWrap: true });
        } else {
          dateCells.push({
            text: validDate ? (p.dateSystem === "AD" ? formatDate(validDate) : formatDateBS(validDate)) : "",
            fontSize: LEDGER_PRINT_BODY_FONT,
            noWrap: true,
          });
        }
      }

      const pillSplit = validDate ? buildFyOpeningPillSplit(p.company, validDate, p.dateSystem) : null;
      const typeText = pillSplit?.typePill ?? printLedgerTypeLabel(row);
      const voucherPillText = pillSplit?.voucherPill ?? null;
      const mainRow: TableCell[] = [...dateCells];
      if (isColVisible(p, "type")) {
        mainRow.push({
          text: typeText,
          bold: true,
          fontSize: LEDGER_PRINT_BODY_FONT,
          noWrap: true,
        });
      }
      if (isColVisible(p, "voucherNo")) {
        mainRow.push({
          text: voucherPillText ?? "-",
          bold: Boolean(voucherPillText),
          fontSize: LEDGER_PRINT_BODY_FONT,
          noWrap: true,
        });
      }
      if (isColVisible(p, "user")) mainRow.push({ text: "", fontSize: LEDGER_PRINT_BODY_FONT });
      if (isColVisible(p, "file")) mainRow.push({ text: "-", fontSize: LEDGER_PRINT_BODY_FONT, alignment: "center" });

      const balanceValue = isBillWiseContext(p)
        ? signed
        : signed;
      const balanceText = formatRunning(balanceValue);

      if (isColVisible(p, "dr")) {
        mainRow.push({
          text: debit > 0 ? formatCurrencyForPrint(debit, { noSuffix: true }) : "-",
          alignment: "right",
          color: palette.debit,
          fontSize: 9,
          bold: true,
          noWrap: true,
        });
      }
      if (isColVisible(p, "cr")) {
        mainRow.push({
          text: credit > 0 ? formatCurrencyForPrint(credit, { noSuffix: true }) : "-",
          alignment: "right",
          color: palette.credit,
          fontSize: 9,
          bold: true,
          noWrap: true,
        });
      }
      if (isBillWiseContext(p) && isColVisible(p, "status")) {
        mainRow.push({ text: "-", fontSize: 8, alignment: "left" });
      }
      if (isColVisible(p, "runningBalance")) {
        mainRow.push({
          text: balanceText,
          alignment: "right",
          bold: true,
          color: palette.balanceSigned(balanceValue),
          fontSize: getAutoFontSize(typeof balanceText === "string" ? balanceText : "", 9),
          noWrap: true,
        });
      }
      ensureRowLength(mainRow, ledgerColCount);
      return [mainRow];
    }

    if (row._spendWiseEmbeddedOpening === true && p.spendWise === true) {
      const pillLabel = row._spendWiseOpeningPillLabel || "Opening Balance";
      const rawDate = row.date instanceof Date ? row.date : row.date ? new Date(row.date) : null;
      const validDate = rawDate instanceof Date && !isNaN(rawDate.getTime()) ? rawDate : null;
      const openingBalNum = Number(row.runningBalance) || 0;
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      const narration = String(row.narration || "").trim();
      const spendWiseColor = palette.spendWiseBorder(Number(row._spendWiseGroupColorIndex) || 0);

      const dateCells: TableCell[] = [];
      if (isColVisible(p, "date")) {
        if (p.dateSystem === "Both") {
          dateCells.push({ text: validDate ? formatDateBS(validDate) : "", fontSize: 9, noWrap: true });
          dateCells.push({ text: validDate ? formatDate(validDate) : "", fontSize: 9, noWrap: true });
        } else {
          dateCells.push({
            text: validDate ? (p.dateSystem === "AD" ? formatDate(validDate) : formatDateBS(validDate)) : "",
            fontSize: 9,
            noWrap: true,
          });
        }
      }

      const showTypeCol = isColVisible(p, "type");
      const showVoucherNoCol = isColVisible(p, "voucherNo");
      const showUserCol = isColVisible(p, "user");
      const showFileCol = isColVisible(p, "file");
      const spendMetaColSpan =
        (showVoucherNoCol ? 1 : 0) + (showUserCol ? 1 : 0) + (showFileCol ? 1 : 0);

      const mainRow: TableCell[] = [...dateCells];
      if (showTypeCol) {
        mainRow.push({ text: pillLabel, bold: true, fontSize: 9, noWrap: true });
        if (showVoucherNoCol) mainRow.push({ text: "", fontSize: 9 });
        if (showUserCol) mainRow.push({ text: "", fontSize: 9 });
        if (showFileCol) mainRow.push({ text: "-", fontSize: 9, alignment: "center", noWrap: true });
      } else if (spendMetaColSpan > 0) {
        mainRow.push({
          text: pillLabel,
          colSpan: spendMetaColSpan,
          bold: true,
          alignment: "left",
          fontSize: 9,
          noWrap: true,
        });
        for (let i = 1; i < spendMetaColSpan; i++) mainRow.push({});
      }
      if (isColVisible(p, "dr")) {
        mainRow.push({
          text: debit > 0 ? formatCurrencyForPrint(debit, { noSuffix: true }) : "-",
          alignment: "right",
          color: palette.debit,
          fontSize: 9,
          bold: true,
          noWrap: true,
        });
      }
      if (isColVisible(p, "cr")) {
        mainRow.push({
          text: credit > 0 ? formatCurrencyForPrint(credit, { noSuffix: true }) : "-",
          alignment: "right",
          color: palette.credit,
          fontSize: 9,
          bold: true,
          noWrap: true,
        });
      }
      if (isBillWiseContext(p) && isColVisible(p, "status")) {
        mainRow.push({ text: "-", fontSize: 9, alignment: "left", noWrap: true });
      }
      if (isColVisible(p, "runningBalance")) {
        mainRow.push({
          text: formatRunning(openingBalNum),
          alignment: "right",
          bold: true,
          color: palette.balanceSigned(openingBalNum),
          fontSize: 9,
          noWrap: true,
        });
      }
      ensureRowLength(mainRow, ledgerColCount);

      const mainHasSubRow = Boolean(p.showNarration && narration);
      const groupEnds = spendWiseGroupEndsAfterRow(row, nextRow);
      const mainTop = row._spendWiseGroupFirst === true;
      const mainBottom = groupEnds ? false : false;
      const resultRows: TableCell[][] = [
        applySpendWisePrintBorders(mainRow, { top: mainTop, bottom: mainBottom, color: spendWiseColor }),
      ];

      if (mainHasSubRow) {
        const subRow: TableCell[] = [
          {
            text: [{ text: "Narration: ", bold: true }, narration],
            colSpan: mainRow.length,
            fontSize: 7,
            italics: true,
            style: "narrationRow",
            margin: [10, 0, 0, 0],
          },
        ];
        for (let i = 1; i < mainRow.length; i++) subRow.push({});
        const subBottom = false;
        resultRows.push(
          applySpendWisePrintBorders(subRow, { top: false, bottom: subBottom, color: spendWiseColor })
        );
      }
      if (groupEnds) appendSpendWiseGroupTail(resultRows, mainRow.length, spendWiseColor);
      return resultRows;
    }

    const d = row.date?.toDate ? row.date.toDate() : new Date(row.date);
    const narration = row.narration || row.content || "";
    
    if (p.context === 'overdue') {
      const validDate = d instanceof Date && !isNaN(d.getTime()) ? d : new Date(0);
      const dateCells: TableCell[] = p.dateSystem === 'Both'
        ? [{ text: formatDateBS(validDate), fontSize: 9, noWrap: true }, { text: formatDate(validDate), fontSize: 9, noWrap: true }]
        : [{ text: p.dateSystem === 'AD' ? formatDate(validDate) : formatDateBS(validDate), fontSize: 9, noWrap: true }];
      const typeText = voucherTypeDisplayText(row.type || '');
      const voucherNo = row.voucherNumber || row.id || '';
      const partyName = row.partyName || '';
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      const days = getOverdueDays(row.dueDate);
      const daysText = days > 0 ? `${days} day${days === 1 ? '' : 's'}` : '';
      const statusContentMain = daysText
        ? { text: 'Overdue', fontSize: 9, color: palette.overdue, bold: true, noWrap: true }
        : { text: 'Overdue', fontSize: 9, color: palette.overdue, noWrap: true };
      const isCreditSide = row.type === 'purchase';
      const balanceVal = isCreditSide ? -Number(row.outstanding) : Number(row.outstanding);
      const balanceText = formatRunning(balanceVal);
      const mainRow: TableCell[] = [
        ...dateCells,
        { text: typeText, fontSize: 9, noWrap: true },
        { text: voucherNo, fontSize: 9, noWrap: true },
        { text: partyName, fontSize: 9, noWrap: true },
        { text: debit > 0 ? formatCurrencyForPrint(debit, { noSuffix: true }) : '-', alignment: 'right', color: palette.debit, fontSize: 9, noWrap: true },
        { text: credit > 0 ? formatCurrencyForPrint(credit, { noSuffix: true }) : '-', alignment: 'right', color: palette.credit, fontSize: 9, noWrap: true },
        statusContentMain,
        { text: balanceText, alignment: 'right', bold: true, color: palette.balanceSigned(balanceVal), fontSize: 9, noWrap: true },
      ];
      const n = mainRow.length;
      const narrationSpan = n - 2;
      const narrationText = row.narration || row.content || 'No narration';
      const subRow: TableCell[] = [
        { text: p.showNarration ? [{ text: 'Narration: ', bold: true }, narrationText] : '', colSpan: narrationSpan, fontSize: 8, italics: true, margin: [0, 0, 0, 0], style: 'narrationRow' },
      ];
      for (let i = 1; i < narrationSpan; i++) subRow.push({});
      subRow.push({ text: daysText, fontSize: 8, color: palette.overdue, alignment: 'left', noWrap: true });
      subRow.push({ text: '' });
      ensureRowLength(subRow, n);
      return [mainRow, subRow];
    }
    
    if (p.context === 'sale' && p.transactions.length === 1) {
        return (row.lineItems || []).map((item: any, index: number) => [
            { text: index + 1, fontSize: 9 },
            { text: findItem(p.itemsData, item.itemId)?.name || 'N/A', fontSize: 9 },
            { text: item.quantity, fontSize: 9 },
            { text: formatCurrencyForPrint(item.rate, { noSuffix: true }), fontSize: 9 },
            { text: formatCurrencyForPrint(item.amount, { noSuffix: true }), alignment: 'right', fontSize: 9 }
        ]);
    }
    
    const wideLedgerPrint = isWideLedgerPrintContext(p);
    const dateCells: TableCell[] = [];
    if (isColVisible(p, "date")) {
      const dateTextOpts: Partial<TableCell> = {
        fontSize: LEDGER_PRINT_BODY_FONT,
        noWrap: true,
        margin: wideLedgerPrint ? [0, 0, 4, 0] : undefined,
      };
      if (p.dateSystem === 'Both') {
          dateCells.push({ text: formatDateBS(d), ...dateTextOpts }); 
          dateCells.push({ text: formatDate(d), ...dateTextOpts }); 
      } else {
          dateCells.push({
            text: p.dateSystem === 'AD' ? formatDate(d) : formatDateBS(d),
            ...dateTextOpts,
          }); 
      }
    }
    
    const typeLabel = printLedgerTypeLabel(row);
    const voucherType = {
      text: typeLabel,
      fontSize: LEDGER_PRINT_BODY_FONT,
      noWrap: true,
      margin: wideLedgerPrint ? [0, 0, 4, 0] : undefined,
    };
    const voucherNoText = String(row.voucherNumber || row.invoiceNumber || "");
    const voucherNo = {
      text: voucherNoText,
      fontSize: LEDGER_PRINT_BODY_FONT,
      noWrap: true,
      margin: wideLedgerPrint ? [0, 0, 4, 0] : undefined,
    };
    
    const { debit, credit } = row;
    
    const factor = p.context === 'item' && p.stockView === 'qty' ? getConversionFactor(findItem(p.itemsData, p.contextId), p.displayUnit) : 1;

    // --- USE DYNAMIC FONT SIZE ---
    const debitText = debit > 0 ? (p.context === 'item' && p.stockView === 'qty' ? `${(debit / factor).toFixed(2)} ${p.displayUnit || ''}` : formatCurrencyForPrint(debit / factor, { noSuffix: true })) : '-';
    const creditText = credit > 0 ? (p.context === 'item' && p.stockView === 'qty' ? `${(credit / factor).toFixed(2)} ${p.displayUnit || ''}` : formatCurrencyForPrint(credit / factor, { noSuffix: true })) : '-';

    // DR/CR colors: print options Color vs B&W (palette)
    const debitContent: TableCell = { 
        text: debitText, 
        alignment: 'right', 
        color: palette.debit,
        fontSize: getAutoFontSize(debitText, 9), 
        noWrap: true 
    }; 
    const creditContent: TableCell = { 
        text: creditText, 
        alignment: 'right', 
        color: palette.credit,
        fontSize: getAutoFontSize(creditText, 9), 
        noWrap: true 
    }; 

    // For bill-wise print, use outstanding balance (each row balance) instead of running balance
    const isBillWise = isBillWiseContext(p);
    let balanceValue: number;
    let balanceText: string;
    
    if (isBillWise) {
      // Use outstanding balance for bill-wise (each row balance)
      // Outstanding is always positive, sign depends on transaction type
      const outstanding = Number(row.outstanding) || 0;
      const isCreditSide = ["sale", "payment_in", "direct_income"].includes(row.type);
      // For sale/payment_in/direct_income: outstanding positive = Dr (receivable)
      // For purchase/payment_out/direct_expense: outstanding positive = Cr (payable)
      // So: sale shows outstanding as Dr, purchase shows outstanding as Cr
      balanceValue = isCreditSide ? outstanding : -outstanding;
      balanceText = formatRunning(balanceValue);
    } else {
      // Use running balance for statement view
      let runningBalance = row.runningBalance;
      runningBalance = runningBalance / factor;
      balanceValue = runningBalance;
      balanceText = formatRunning(runningBalance);
    }
    
    if (p.context === 'item' && p.stockView === 'qty') {
         balanceText = `${balanceValue.toFixed(2)} ${p.displayUnit || ''}`;
    }

    const balanceContent: any = { 
        text: balanceText, 
        alignment: 'right', 
        color: palette.balanceSigned(balanceValue),
        fontSize: getAutoFontSize(balanceText, 9), 
        bold: true, 
        noWrap: true 
    }; 
    
    const mainRow: TableCell[] = [...dateCells];
    if (isColVisible(p, "type")) mainRow.push(voucherType);
    if (isColVisible(p, "voucherNo")) mainRow.push(voucherNo);

    if (p.context === 'daybook') {
        mainRow.push({ text: getParticularsText(row, p.journalAccountNames), fontSize: 8 });
    }
    if (isColVisible(p, "user")) {
      const resolvedUserName = row.userId ? p.userNames?.[row.userId] : undefined;
      const userLabel =
        (resolvedUserName && resolvedUserName !== "Unknown" && resolvedUserName !== "N/A" ? resolvedUserName : undefined) ||
        row.userDisplayName ||
        row.userName ||
        "N/A";
      mainRow.push({ text: String(userLabel), fontSize: 9, noWrap: true });
    }
    if (isColVisible(p, "file")) {
      const hasFile = Array.isArray(row.fileUrls) && row.fileUrls.length > 0;
      mainRow.push({ text: hasFile ? "Yes" : "-", fontSize: 9, alignment: 'center' as const, noWrap: true });
    }

    // Overdue days: same logic as overdue context — use dueDate/due_date so "xx days" shows in party/account print
    const dueDateRaw = row.dueDate ?? row.due_date;
    const overdueDays =
      (row.type === 'sale' || row.type === 'purchase') ? getOverdueDays(dueDateRaw)
      : row.isOverdue ? getOverdueDays(dueDateRaw)
      : 0;
    const overdueDaysText = overdueDays > 0 ? `${overdueDays} day${overdueDays === 1 ? '' : 's'}` : '';
    const isOverdueRow = Boolean(row.isOverdue || row.paymentStatus === 'overdue' || ((row.type === 'sale' || row.type === 'purchase') && overdueDays > 0));

    let statusContent: TableCell | null = null;
    if (isBillWise) {
      const isAllVouchersView = p.context === 'account' && p.contextId === 'all';
      const isJournalTransaction = row.type === 'journal' && row.subType !== 'add_salary';
      const isContraTransaction = row.type === 'contra';

      if (isAllVouchersView && (isJournalTransaction || isContraTransaction)) {
        statusContent = { text: voucherTypeDisplayText(row.type), fontSize: 9, alignment: 'left' as const };
      } else {
        const isOverdueDisplay = row.isOverdue || overdueDays > 0;
        // Keep bill-wise status text in print aligned with table logic for staff/group rows.
        const statusLabel = getBillStatusLabelForPrint(row, p.context, isOverdueDisplay);
        const statusColor =
          statusLabel === "Paid"
            ? palette.paid
            : statusLabel === "Overdue" || statusLabel === "Unpaid" || statusLabel === "Partial"
              ? palette.unpaid
              : undefined;
        statusContent = { text: statusLabel || '-', fontSize: 9, alignment: 'left' as const, color: statusColor };
      }
    }
    // Match printed columns with currently selected UI columns.
    if (isColVisible(p, "dr")) mainRow.push(debitContent);
    if (isColVisible(p, "cr")) mainRow.push(creditContent);
    if (isBillWise && isColVisible(p, "status")) {
      mainRow.push(
        statusContent ?? { text: "-", fontSize: 9, alignment: "left" as const, noWrap: true }
      );
    }
    if (isColVisible(p, "runningBalance")) mainRow.push(balanceContent);

    const isSpendWiseOutRow = Boolean(
      p.spendWise === true &&
      (
        row._spendWiseChild === true ||
        row.type === "payment_out" ||
        row.type === "direct_expense" ||
        (row.type === "contra" && (Number(row.credit) || 0) > (Number(row.debit) || 0))
      )
    );
    const spendWiseMainFontSize = isSpendWiseOutRow ? 7 : 9;
    // Spend-wise print: in-flow rows look prominent; out-flow rows look smaller (like table view).
    for (let i = 0; i < mainRow.length; i++) {
      const c: any = mainRow[i];
      if (c && typeof c === "object") {
        c.fontSize = spendWiseMainFontSize;
        if (isSpendWiseOutRow && i === 0) {
          // Out rows start further right to mimic table child indentation.
          c.margin = [12, 0, 0, 0];
        }
      }
    }

    // Spend-wise print: draw grouped container borders (top/bottom + left/right sides).
    const inSpendWiseGroup = Boolean(
      p.spendWise === true &&
      (row._spendWiseEmbeddedOpening === true ||
        row._spendWiseGroupFirst === true ||
        row._spendWiseChild === true ||
        row._spendWiseGroupLast === true)
    );
    const spendWiseColor = palette.spendWiseBorder(Number(row._spendWiseGroupColorIndex) || 0);

    const statusDetailText =
      isBillWise && p.showNarration
        ? getStatusDetailForPrint(row, {
            billWiseOnly: true,
            vouchers: p.vouchers,
            decimalPlaces: p.company.decimalPlaces ?? 2,
            colorMode: p.printColorMode,
            linkedVouchersMode: p.printLinkedVouchersMode,
          })
        : "";
    const mainHasSubRow = Boolean(
      (isBillWise && (p.showNarration && (narration || statusDetailText || overdueDaysText || isOverdueRow))) ||
      (!isBillWise && p.showNarration && narration)
    );
    const groupEnds = spendWiseGroupEndsAfterRow(row, nextRow);
    const mainTop = row._spendWiseGroupFirst === true;
    const mainBottom = false;

    ensureRowLength(mainRow, ledgerColCount);
    const mainRowFinal: TableCell[] = inSpendWiseGroup
      ? applySpendWisePrintBorders(mainRow, { top: mainTop, bottom: mainBottom, color: spendWiseColor })
      : mainRow;
    ensureRowLength(mainRowFinal, ledgerColCount);

    const resultRows: TableCell[][] = [mainRowFinal];

    // Keep print narration behavior aligned with UI toggle and current bill-wise status details.
    const showBillWiseSubRow = isBillWise && (p.showNarration && (narration || statusDetailText || overdueDaysText || isOverdueRow));
    if (showBillWiseSubRow || (!isBillWise && p.showNarration && narration)) {
      const narrationParts: Array<string | { text: string; bold?: boolean; fontSize?: number; color?: string; italics?: boolean }> = [];
      if (p.showNarration && narration) {
        narrationParts.push({ text: 'Narration: ', bold: true, fontSize: 7, color: 'black' });
        narrationParts.push({ text: String(narration), color: 'black', fontSize: 7, italics: true });
      }
      const statusParts: Array<string | { text: string | any[]; bold?: boolean; fontSize?: number; color?: string; italics?: boolean }> = [];
      if (p.showNarration && statusDetailText) {
        if (Array.isArray(statusDetailText)) {
          statusParts.push({ text: statusDetailText });
        } else {
          statusParts.push({ text: statusDetailText, color: 'black', fontSize: 7 });
        }
      }
      if (p.showNarration && (overdueDaysText || isOverdueRow)) {
        const overdueOnly = overdueDaysText || 'Overdue';
        if (statusParts.length > 0) statusParts.push({ text: ', ', color: 'black', fontSize: 7 });
        statusParts.push({ text: overdueOnly, color: palette.overdue, fontSize: 7, italics: false });
      }
      const subRow: TableCell[] = [];
      if (isBillWise && isColVisible(p, "status")) {
        // Voucher details: ek hi cell, Status + Balance dono columns span karke — double nahi, width badha ke balance tak.
        const hasBalanceCol = isColVisible(p, "runningBalance");
        const narrationSpan = Math.max(1, mainRow.length - (hasBalanceCol ? 2 : 1));
        subRow.push({
          text: narrationParts.length > 0 ? (narrationParts as any) : '',
          colSpan: narrationSpan,
          alignment: 'left',
          margin: [p.spendWise ? 10 : 0, 0, 0, 0],
          style: 'narrationRow',
          noWrap: false,
        });
        for (let i = 1; i < narrationSpan; i++) subRow.push({});
        const voucherDetailColSpan = hasBalanceCol ? 2 : 1;
        subRow.push({
          text: statusParts.length > 0 ? (statusParts as any) : "",
          colSpan: voucherDetailColSpan,
          alignment: "left",
          style: "narrationRow",
          noWrap: false,
        });
        for (let i = 1; i < voucherDetailColSpan; i++) subRow.push({});
        ensureRowLength(subRow, ledgerColCount);
      } else {
        subRow.push({
          text: narrationParts.length > 0 ? (narrationParts as any) : '',
          colSpan: mainRow.length,
          alignment: 'left',
          // Keep narration/details slightly indented from the left in spend-wise print.
          margin: [p.spendWise ? 10 : 0, 0, 0, 0],
          style: 'narrationRow',
          noWrap: false,
        });
        for (let i = 1; i < mainRow.length; i++) subRow.push({});
      }
      const subTop = false;
      const subBottom = false;
      ensureRowLength(subRow, ledgerColCount);
      const subRowFinal: TableCell[] = inSpendWiseGroup
        ? applySpendWisePrintBorders(subRow, { top: subTop, bottom: subBottom, color: spendWiseColor })
        : subRow;
      ensureRowLength(subRowFinal, ledgerColCount);
      resultRows.push(subRowFinal);
    }

    if (inSpendWiseGroup && groupEnds) {
      appendSpendWiseGroupTail(resultRows, ledgerColCount, spendWiseColor);
    }

    for (const r of resultRows) ensureRowLength(r, ledgerColCount);
    return resultRows;
}


const buildTableFooter = (p: PrintPayload, periodDr: number, periodCr: number, closing: number, formatCurrencyForPrint: Function, formatRunning: Function, header: TableCell[], numToWords: Function): TableCell[][] => {
    const palette = getPrintColorPalette(p.printColorMode);
    if (p.context === 'daybook') return [];
    
    if (p.context === 'overdue') {
      const n = header.length;
      const labelColSpan = n - 4; // Total label spans up to Debit; then Debit, Credit, Status, Balance
      const footerRow: TableCell[] = [
        { text: 'Total', colSpan: labelColSpan, bold: true, alignment: 'left', fontSize: 10, noWrap: true },
        ...Array.from({ length: labelColSpan - 1 }, () => ({})),
        { text: formatCurrencyForPrint(periodDr, { noSuffix: true }), bold: true, fontSize: 10, color: palette.debit, alignment: 'right', noWrap: true },
        { text: formatCurrencyForPrint(periodCr, { noSuffix: true }), bold: true, fontSize: 10, color: palette.credit, alignment: 'right', noWrap: true },
        { text: '-', bold: true, fontSize: 10, alignment: 'left', noWrap: true },
        { text: formatRunning(closing), bold: true, fontSize: 10, color: palette.balanceSigned(closing), alignment: 'right', noWrap: true },
      ];
      return [footerRow];
    }
    
    const boldCell = (text: string|number, alignment: 'left'|'right' = 'right'): TableCell => ({ text, bold: true, alignment, fontSize: 10 });
    
    // Calculate opening balance debit and credit for including in Period Total
    const factor = p.context === 'item' && p.stockView === 'qty' ? getConversionFactor(findItem(p.itemsData, p.contextId), p.displayUnit) : 1;
    const openingBalNum = (p.openingBalance ?? 0) / factor;
    const openingBalanceDr = openingBalNum > 0 ? openingBalNum : 0;
    const openingBalanceCr = openingBalNum < 0 ? Math.abs(openingBalNum) : 0;
    
    // Include opening balance in Period Total
    const totalDr = periodDr + openingBalanceDr;
    const totalCr = periodCr + openingBalanceCr;
    
    if (p.context === 'sale' && p.transactions.length === 1) {
        const saleData = p.transactions[0];
        const subTotal = saleData.subTotal || 0;
        const discount = saleData.discount || 0;
        const tax = saleData.tax || 0;
        const total = saleData.total || 0;
        const taxableAmount = subTotal - discount;

        return [
            [
                { text: 'Sub Total', colSpan: 4, alignment: 'right', bold: true, fontSize: 9 }, {}, {}, {},
                { text: formatCurrencyForPrint(subTotal, { noSuffix: true }), alignment: 'right', bold: true, fontSize: 9 }
            ],
            [
                { text: 'Discount', colSpan: 4, alignment: 'right', bold: true, fontSize: 9 }, {}, {}, {},
                { text: formatCurrencyForPrint(discount, { noSuffix: true }), alignment: 'right', bold: true, fontSize: 9 }
            ],
             [
                { text: 'Taxable Amount', colSpan: 4, alignment: 'right', bold: true, fontSize: 9 }, {}, {}, {},
                { text: formatCurrencyForPrint(taxableAmount, { noSuffix: true }), alignment: 'right', bold: true, fontSize: 9 }
            ],
            [
                { text: 'Tax', colSpan: 4, alignment: 'right', bold: true, fontSize: 9 }, {}, {}, {},
                { text: formatCurrencyForPrint(tax, { noSuffix: true }), alignment: 'right', bold: true, fontSize: 9 }
            ],
            [
                { text: 'Grand Total', colSpan: 4, alignment: 'right', bold: true, fontSize: 10 }, {}, {}, {},
                { text: formatCurrencyForPrint(total, { noSuffix: true }), alignment: 'right', bold: true, fontSize: 10 }
            ],
             [
                { text: [{text: 'In Words: ', bold: true}, numToWords(total)], colSpan: 5, alignment: 'left', fontSize: 9, italics: true}, {}, {}, {}, {}
             ]
        ];
    }
    
    const isBillWise = isBillWiseContext(p);
    const showDr = isColVisible(p, "dr");
    const showCr = isColVisible(p, "cr");
    const showStatus = isBillWise && isColVisible(p, "status");
    const showBalance = isColVisible(p, "runningBalance");
    const numDataCols = [showDr, showCr, showStatus, showBalance].filter(Boolean).length;
    const labelColCount = header.length - numDataCols;
    if (header.length < 1 || numDataCols === 0) return [];

    const footerRow: TableCell[] = [];
    if (labelColCount > 0) {
      appendLedgerPrintFooterLabelCells(footerRow, p, "Period Total:");
    }

    const formatFooterValue = (val: number) => {
        if (p.context === 'item' && p.stockView === 'qty') {
            return `${(val/factor).toFixed(2)} ${p.displayUnit || ''}`;
        }
        return formatCurrencyForPrint(val, {noSuffix: true});
    }

    let footerClosingText = formatRunning(closing);
    if (p.context === 'item' && p.stockView === 'qty') {
         footerClosingText = `${(closing / factor).toFixed(2)} ${p.displayUnit || ''}`;
    }

    // --- USE DYNAMIC FONT SIZE FOR FOOTER ---
    // Use totalDr and totalCr which include opening balance
    const debitText = formatFooterValue(totalDr);
    const creditText = formatFooterValue(totalCr);

    if (showDr) footerRow.push({ text: debitText, bold: true, fontSize: getAutoFontSize(debitText, 10), color: palette.debit, alignment: 'right', noWrap: true });
    if (showCr) footerRow.push({ text: creditText, bold: true, fontSize: getAutoFontSize(creditText, 10), color: palette.credit, alignment: 'right', noWrap: true });
    if (showStatus) {
      footerRow.push({ text: '-', bold: true, fontSize: 10, alignment: 'left', noWrap: true });
    }
    if (showBalance) footerRow.push({ text: footerClosingText, bold: true, fontSize: getAutoFontSize(footerClosingText, 10), color: palette.balanceSigned(closing), alignment: 'right', noWrap: true });
    
    ensureRowLength(footerRow, header.length);
    return [footerRow];
}

type LedgerPrintWidthKey =
  | "date"
  | "dateBs"
  | "dateAd"
  | "type"
  | "voucherNo"
  | "daybook"
  | "user"
  | "file"
  | "dr"
  | "cr"
  | "status"
  | "balance";

/** Relative weights when many columns — widths sum to 100% so table stays inside page. */
const LEDGER_PRINT_COL_WEIGHT: Record<LedgerPrintWidthKey, number> = {
  date: 10,
  dateBs: 9,
  dateAd: 9,
  type: 10,
  voucherNo: 18,
  daybook: 14,
  user: 8,
  file: 5,
  dr: 13,
  cr: 13,
  status: 9,
  balance: 16,
};

/** Fixed width (pt) for amount/status columns when column count ≤ 6 — label cols share remaining `*`. */
const LEDGER_PRINT_FIXED_COL_WIDTH_PT: Partial<Record<LedgerPrintWidthKey, number>> = {
  dr: 76,
  cr: 76,
  status: 50,
  balance: 86,
};

const LEDGER_PRINT_MANY_COL_THRESHOLD = 7;

/** Label cells before Dr/Cr/Status/Balance — one per header column (no colSpan; pdfMake footer alignment). */
function appendLedgerPrintFooterLabelCells(footerRow: TableCell[], p: PrintPayload, labelText: string): void {
  const empty: TableCell = { text: "" };
  const labelCells: TableCell[] = [];
  if (isColVisible(p, "date")) {
    if (p.dateSystem === "Both") labelCells.push(empty, empty);
    else labelCells.push(empty);
  }
  if (isColVisible(p, "type")) labelCells.push(empty);
  if (isColVisible(p, "voucherNo")) labelCells.push(empty);
  if (p.context === "daybook") labelCells.push(empty);
  if (isColVisible(p, "user")) labelCells.push(empty);
  if (isColVisible(p, "file")) labelCells.push(empty);

  if (labelCells.length === 0) {
    footerRow.push({
      text: labelText,
      bold: true,
      alignment: "right",
      fontSize: 10,
      noWrap: true,
    });
    return;
  }

  labelCells[labelCells.length - 1] = {
    text: labelText,
    bold: true,
    alignment: "right",
    fontSize: 10,
    noWrap: true,
  };
  footerRow.push(...labelCells);
}

function collectLedgerPrintWidthKeys(p: PrintPayload): LedgerPrintWidthKey[] {
  const keys: LedgerPrintWidthKey[] = [];
  if (isColVisible(p, "date")) {
    if (p.dateSystem === "Both") keys.push("dateBs", "dateAd");
    else keys.push("date");
  }
  if (isColVisible(p, "type")) keys.push("type");
  if (isColVisible(p, "voucherNo")) keys.push("voucherNo");
  if (p.context === "daybook") keys.push("daybook");
  if (isColVisible(p, "user")) keys.push("user");
  if (isColVisible(p, "file")) keys.push("file");
  if (isColVisible(p, "dr")) keys.push("dr");
  if (isColVisible(p, "cr")) keys.push("cr");
  if (isBillWiseContext(p) && isColVisible(p, "status")) keys.push("status");
  if (isColVisible(p, "runningBalance")) keys.push("balance");
  return keys;
}

function buildWideLedgerPercentColumnWidths(keys: LedgerPrintWidthKey[]): (string | number)[] {
  const total = keys.reduce((sum, key) => sum + LEDGER_PRINT_COL_WEIGHT[key], 0);
  if (total <= 0) return ["*"];
  return keys.map((key) => `${((LEDGER_PRINT_COL_WEIGHT[key] / total) * 100).toFixed(2)}%`);
}

/** Scale fixed amount-column widths so fixed + label minimums fit inside printable width. */
function scaleFixedAmountColumnWidths(
  keys: LedgerPrintWidthKey[],
  contentWidthPt: number
): Partial<Record<LedgerPrintWidthKey, number>> {
  const scaled: Partial<Record<LedgerPrintWidthKey, number>> = {};
  const amountKeys = keys.filter((k) => LEDGER_PRINT_FIXED_COL_WIDTH_PT[k] != null);
  if (amountKeys.length === 0) return scaled;

  const labelCount = keys.length - amountKeys.length;
  const labelReservePt = Math.min(contentWidthPt * 0.55, labelCount * 52);
  let budget = Math.max(120, contentWidthPt - labelReservePt);

  let desired = amountKeys.reduce((sum, k) => sum + (LEDGER_PRINT_FIXED_COL_WIDTH_PT[k] ?? 0), 0);
  if (desired <= budget) {
    for (const k of amountKeys) scaled[k] = LEDGER_PRINT_FIXED_COL_WIDTH_PT[k];
    return scaled;
  }

  const scale = budget / desired;
  for (const k of amountKeys) {
    scaled[k] = Math.max(52, Math.floor((LEDGER_PRINT_FIXED_COL_WIDTH_PT[k] ?? 0) * scale));
  }
  return scaled;
}

/** Party/staff ledger print: ≤6 cols → fixed amount pt + flex labels; 7+ → % widths (fits A4). */
function buildWideLedgerPrintColumnWidths(
  p: PrintPayload,
  opts: { columnCount: number; landscape: boolean }
): (string | number)[] {
  const keys = collectLedgerPrintWidthKeys(p);
  if (keys.length <= 0) return ["*"];

  if (opts.columnCount >= LEDGER_PRINT_MANY_COL_THRESHOLD) {
    return buildWideLedgerPercentColumnWidths(keys);
  }

  const contentWidthPt = ledgerPrintContentWidthPt(opts.landscape);
  const fixedByKey = scaleFixedAmountColumnWidths(keys, contentWidthPt);

  return keys.map((key) => {
    const fixed = fixedByKey[key];
    if (fixed != null) return fixed;
    if (key === "date" || key === "dateBs" || key === "dateAd") return "auto";
    if (key === "file") return "auto";
    return "*";
  });
}

const getColumnWidths = (
  p: PrintPayload,
  opts?: { landscape?: boolean; columnCount?: number }
): (string | number)[] => {
  const landscape = opts?.landscape === true;
  const columnCount = opts?.columnCount ?? collectLedgerPrintWidthKeys(p).length;
  if (p.context === 'sale' && p.transactions.length === 1) {
    return ['auto', '*', 'auto', 'auto', 'auto'];
  }
  
  if (p.context === 'overdue') {
    const w: (string | number)[] = [];
    if (p.dateSystem === 'Both') w.push(46, 46);
    else w.push(48);
    w.push(40, '*', 50, 50, 44, 76);
    return w;
  }

  const wideLedger = ["party", "staff", "tax", "account", "group", "expense"].includes(p.context);
  if (wideLedger) {
    return buildWideLedgerPrintColumnWidths(p, { landscape, columnCount });
  }
  
  const widths: (string | number)[] = [];
  let flexAssigned = false;
  const pushFlex = () => {
    if (!flexAssigned) {
      widths.push("*");
      flexAssigned = true;
    } else {
      widths.push("auto");
    }
  };
  
  if (isColVisible(p, "date")) {
    if (p.dateSystem === 'Both') {
      widths.push('auto', 'auto');
    } else {
      widths.push('auto');
    }
  }
  
  if (isColVisible(p, "type")) widths.push('auto');
  if (isColVisible(p, "voucherNo")) pushFlex();
  
  if (p.context === 'daybook') {
      pushFlex();
  }
  if (isColVisible(p, "user")) widths.push('auto');
  if (isColVisible(p, "file")) widths.push('auto');

  if (isColVisible(p, "dr")) widths.push('auto');
  if (isColVisible(p, "cr")) widths.push('auto');
  if (isBillWiseContext(p) && isColVisible(p, "status")) {
    widths.push('auto');
  }
  if (isColVisible(p, "runningBalance")) widths.push('auto');

  return widths;
};

// --- GET CONVERSION FACTOR (Helper specific to print logic) ---
const getConversionFactor = (item: Item | undefined, displayUnit: string | undefined): number => {
    if (!item || !displayUnit) return 1;
    const conversions = (item.unitConversions || []) as any[];
    if (conversions.length === 0) return 1;
    const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : '';
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
