"use client";

import { useReconciledPointGuard } from "@/components/vouchers/ReconciledPointGuardContext";
import { addDoc } from "@/lib/writeGateway/pbWrites";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch, type Resolver, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
  MutableRefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { VoucherNumberInputWithRefresh } from "@/components/vouchers/VoucherNumberInputWithRefresh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Checkbox } from "../ui/checkbox";
import { SalePurchaseTdsVerifyTick } from "@/components/vouchers/SalePurchaseTdsVerifyTick";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";

import { CalendarIcon, Loader2, PlusCircle, Trash2, Printer, Upload, FileText, ArrowDownUp, ArrowRight, Link2, History, CheckCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { nestedVoucherAlertShell } from "@/lib/dialogShellChrome";
import { mapPartiesForVoucherCombobox } from "@/lib/masterAccountFreeze/comboboxOptions";
import { format, startOfDay } from "date-fns";
import { toast as sonnerToast } from "sonner";
import {
  replaceVoucherSaveLoadingWithShortSuccess,
  beginVoucherSaveLoadingOrBlock,
  voucherSaveErrorToast,
  runWithVoucherLinkSaveProgress,
} from "@/lib/voucherSaveUi";

import { useToast } from "@/hooks/use-toast";
import {
  mergeUnitsForDropdown,
  parseCustomUnitsArray,
  persistCustomUnitIfNew,
  unitListHas,
} from "@/lib/companyCustomUnits";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { useDate } from "@/hooks/useDate";
import { useVouchers } from "@/hooks/useVouchers";
import { shouldBindFirebaseLedgerCollectionLiveListeners } from "@/lib/firebaseLedgerSyncPolicy";
import { listCompanyDocsFromBrowserDb, BROWSER_DB_COLLECTION_BUMP } from "@/lib/localCompanyDocMirror";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResetLinkStateOnCopyTargetCompany } from "@/hooks/useResetLinkStateOnCopyTargetCompany";
import { useCopyDraftFirstSave } from "@/hooks/useCopyDraftFirstSave";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_MOBILE_ATTACH_TILE_SLOT, VOUCHER_MOBILE_ATTACH_PREVIEW_CLASS, VOUCHER_MOBILE_ATTACH_ADD_SURFACE_CLASS, VOUCHER_DESKTOP_ATTACH_TILE_SLOT, VOUCHER_DESKTOP_ATTACH_PREVIEW_CLASS, VOUCHER_DESKTOP_ATTACH_ADD_SURFACE_CLASS } from "@/components/vouchers/voucherButtonStyles";
import { saveVoucher, isVoucherLimitError, softDeleteVoucherMoveToRecycleBin } from "@/lib/voucherActionsClient";
import {
  getVoucherConvertOriginalId,
  getVoucherEditConvertPresentation,
  isVoucherEditConverting,
  markVoucherConvertedInRecycleBin,
} from "@/lib/voucherEditConvert";
import { VoucherEditConvertConfirmDialog } from "@/components/vouchers/VoucherEditConvertConfirmDialog";
import { useVoucherEditConvertSubmitGate } from "@/hooks/useVoucherEditConvertSubmitGate";
import { normalizePrefix } from "@/lib/voucherNumberFormat";
import { getNextVoucherNumberForCompany, resolveCompanyVoucherPrefixList } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { loadVoucherDataForDeletePreCheck, resolveVoucherDeleteBackdateDate } from "@/lib/voucherDeletePreCheck";
import { preferLocalLedgerReads } from "@/lib/apkOnlineFirestoreWritePolicy";
import { sendTransactionAlert, isAmountOverOneLakh, getChangedFieldLabels } from "@/lib/transactionAlerts";
import { LinkAdvancesToVoucherDialog, applyAdvancesAllocationsToServer } from "@/components/vouchers/LinkAdvancesToVoucherDialog";
import { useAdvancesLinkableCount, useTaxAccountLinkableCount } from "@/hooks/useAdvancesForVoucher";
import { LinkSectionInfoDialog } from "@/components/vouchers/LinkSectionInfoDialog";
import { getLinkedAmountsToVoucher, getLinkedAmountRowsFromPending, getOutgoingLinkedAmountRows, mergeLinkedRows, hasPaymentLinks, getAllocationTotal, allocationEntityTxnId, getTaxFromAllocation, getNetFromAllocation, buildBillWiseEntityTxnId, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import { getSalePurchasePartyLinkTarget } from "@/lib/tdsVoucher";
import {
  resolveSalePurchaseBillWiseLegs,
  salePurchaseLinkSectionTitle,
  salePurchaseLinkButtonLabel,
  type SalePurchaseBillWiseLegKind,
} from "@/lib/salePurchaseBillWiseLinkLegs";
import {
  collectSalePurchaseTaxAndTdsAccountIds,
  getSalePurchaseLinkAllocation,
} from "@/lib/linkAllocationSettings";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";

import { firestore, storage } from "@/lib/firebase";
import { collection, query, where, serverTimestamp, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { getDocs, getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { useRouter } from 'next/navigation';

import type { Party } from "@/components/party/types";
import type { Item } from "@/components/items/types";
import type { Tax, TaxGroup } from "@/components/tax/types";

import BsDatePicker from "@/components/ui/BsDatePicker";
import { Combobox } from "../ui/combobox";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { appendCompressedVoucherAttachmentsToState as __frozenAppendAttachments, handleVoucherAttachmentInputChange as __frozenAttachmentInputChange, useVoucherAttachmentProcessing } from "@/lib/appendCompressedVoucherAttachments";
import { ocrWrapAppend, ocrWrapInputChange } from "@/modules/ocr";
/** OCR reads the ORIGINAL upload: frozen helpers wrapped at the call site only (helper code unchanged). */
const appendCompressedVoucherAttachmentsToState = ocrWrapAppend(__frozenAppendAttachments);
const handleVoucherAttachmentInputChange = ocrWrapInputChange(__frozenAttachmentInputChange);
import { voucherAttachmentUrlsForFormState } from "@/lib/voucherAttachmentNormalize";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { VoucherAttachmentPcDropRow } from "@/components/vouchers/VoucherAttachmentPcDropRow";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { CreateTaxDialog } from "../tax/CreateTaxDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { VoucherPdfAsImageToggle } from "@/components/vouchers/VoucherPdfAsImageToggle";
import { shouldSuggestPdfAsImage } from "@/lib/voucherAttachmentPdfAsImage";
import { resolveVoucherAttachmentsBeforeSave } from "@/lib/voucherFormAttachmentsBeforeSave";
import { useVoucherAttachmentPostSaveSync } from "@/hooks/useVoucherAttachmentPostSaveSync";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  applyVoucherAttachmentsAfterFormSave,
  finalizeVoucherAttachmentsAfterFormSave,
  voucherAttachmentFieldsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import { CreateBankAccountDialog } from "../bank-cash/CreateBankAccountDialog";
import { AddVoucherDialog } from "./AddVoucherDialog";
import { CreateExpenseAccountDialog } from "../expenses/CreateExpenseAccountDialog";
import {
  buildVoucherLineItemComboboxOptions,
  comboboxValueFromLineItemId,
  lineItemIdFromComboboxValue,
  normalizeVoucherLineItemForForm,
} from "@/components/vouchers/voucherLineItemCombobox";
import { SalePurchaseTdsLineUi } from "@/components/vouchers/SalePurchaseTdsLineUi";
import { SalePurchaseLineAmountInput } from "@/components/vouchers/SalePurchaseLineAmountInput";
import { SalePurchaseDiscountAdjustmentRow } from "@/components/vouchers/SalePurchaseDiscountAdjustmentRow";
import { SalePurchaseTotalsSummaryAmount } from "@/components/vouchers/SalePurchaseTotalsSummaryAmount";
import {
  normalizeSalePurchaseDiscountSign,
  resolveAdjustmentExpenseAccountId,
  salePurchaseDiscountNetEffect,
} from "@/lib/salePurchaseDiscountAdjustment";
import {
  readCompanyDiscountExpenseDefault,
  SALE_PURCHASE_TOTALS_SUMMARY_BOX_DESKTOP,
  SALE_PURCHASE_TOTALS_SUMMARY_BOX_MOBILE,
  SALE_PURCHASE_TOTALS_SUMMARY_ROW,
} from "@/lib/salePurchaseDiscountDefault";
import {
  calcLineTdsAmount,
  lineTaxableBaseForTds,
  readStoredTdsDefault,
} from "@/lib/tdsVoucher";
import {
  getSalePurchaseDesktopLineGridStyle,
  SALE_PURCHASE_DESKTOP_LINE_GRID_CLASS,
  SALE_PURCHASE_DESKTOP_LINE_BODY_CELL,
  SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_DIVIDERS,
  SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_FRAME,
  SALE_PURCHASE_DESKTOP_LINE_TABLE_INNER,
  SALE_PURCHASE_VOUCHER_DESKTOP_BODY,
  mapSalePurchaseLineTaxComboboxOptions,
  withSelectedHiddenTax,
  resolveSalePurchaseLineColumnLabels,
  SALE_PURCHASE_LINE_DESKTOP_COMBOBOX_PROPS,
  SALE_PURCHASE_LINE_ITEM_COMBOBOX_PROPS,
  SALE_PURCHASE_DESKTOP_LINE_ITEM_CELL,
  SALE_PURCHASE_LINE_NUMBER_INPUT_CLASS,
  SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL,
  SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS,
  salePurchaseLineNumberInputStyle,
  salePurchaseLineMoneyInputStyle,
  formatSalePurchaseLineMoneyDisplay,
  SALE_PURCHASE_LINE_MONEY_INPUT_FIELD_PROPS,
  SALE_PURCHASE_DESKTOP_LINE_DELETE_HEADER,
  SALE_PURCHASE_DESKTOP_LINE_DELETE_CELL,
  SALE_PURCHASE_DESKTOP_LINE_DELETE_BUTTON_CLASS,
} from "@/lib/salePurchaseLineColumnLabels";
import {
  ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS,
  isAdminPanelSubscriptionCatalogItemId,
  normalizeSubscriptionCatalogLineUnit,
} from "@/lib/adminPanelCompany/subscriptionCatalogItemPricing";
import { enrichSubscriptionMirrorSaleLineItemsForForm } from "@/lib/adminPanelCompany/subscriptionCatalogItemClient";


const fileSchema = z.object({
  file: z.instanceof(File),
  preview: z.string(),
});

/** Optional line string — null from Firestore/SQLite → "" before zod string check. */
const optionalLineString = () => z.preprocess((val) => (val == null ? "" : val), z.string().optional());

const lineItemSchema = z.object({
  type: z.enum(["item", "service"]),
  // itemId optional: user can save with just Qty + Rate (free-form line)
  itemId: optionalLineString(),
  quantity: z.coerce.number().min(0, "Quantity must be positive."),
  rate: z.coerce.number().min(0, "Rate must be positive."),
  unit: optionalLineString(),
  amount: z.coerce.number(),
  taxAccountId: optionalLineString(),
  taxAmount: z.coerce.number().optional(),
  tdsAccountId: optionalLineString(),
  tdsAmount: z.coerce.number().optional(),
  isTaxInclusive: z.boolean(),
  /** Sale only: checkbox beside rate — when false, rate follows item price (read-only). Role still needs edit_item_rates_in_vouchers + company allow. */
  allowManualRate: z.boolean().default(true),
});

const formSchema = z.object({
  partyId: z.string().min(1, "Please select a customer."),
  salesAccountId: z.string().optional(),
  date: z.date({ message: "A date is required." }),
  voucherNumber: z.string().min(1, "Voucher number is required."),
  lineItems: z.array(lineItemSchema).min(1, "Please add at least one item."),
  narration: z.string().optional(),
  dueDate: z.date().optional().nullable(),
  /** Overdue page Important filter — Due Date ke niche tick */
  overdueImportant: z.boolean().optional().default(false),
  subTotal: z.coerce.number(),
  totalPurchasePrice: z.coerce.number().optional(),
  discount: z.coerce.number().optional(),
  discountSign: z.enum(["+", "-"]).optional(),
  discountExpenseAccountId: z.string().optional(),
  tax: z.coerce.number().min(0).optional(),
  tds: z.coerce.number().min(0).optional(),
  /** TDS selected hone par party/tax ledger pe Verified / Unverified */
  isTdsVerified: z.boolean().optional().default(false),
  total: z.coerce.number(),
  unassignedFile: z.any().optional(), // Keep unassignedFile data
  isApproved: z.boolean().optional(),
});

export type SaleFormValues = z.infer<typeof formSchema>;

/** RHF+zod errors को save पर toast description के लिए एक string में बाँधता है */
function formatSaleFormValidationErrors(errors: FieldErrors<SaleFormValues>): string {
  const errorMessages: string[] = [];
  if (errors.partyId?.message) errorMessages.push(`Customer: ${errors.partyId.message}`);
  if (errors.date?.message) errorMessages.push(`Date: ${errors.date.message}`);
  if (errors.voucherNumber?.message) errorMessages.push(`Voucher No.: ${errors.voucherNumber.message}`);
  if (errors.lineItems) {
    const lineItems = errors.lineItems as Record<
      number,
      { itemId?: { message?: string }; quantity?: { message?: string }; rate?: { message?: string }; amount?: { message?: string } }
    > | undefined;
    Object.entries(lineItems ?? {}).forEach(([idxStr, itemError]) => {
      const index = parseInt(idxStr, 10);
      if (itemError) {
        if (itemError.itemId?.message) errorMessages.push(`Item ${index + 1}: ${itemError.itemId.message}`);
        if (itemError.quantity?.message) errorMessages.push(`Item ${index + 1} Quantity: ${itemError.quantity.message}`);
        if (itemError.rate?.message) errorMessages.push(`Item ${index + 1} Rate: ${itemError.rate.message}`);
        if (itemError.amount?.message) errorMessages.push(`Item ${index + 1} Amount: ${itemError.amount.message}`);
      }
    });
  }
  if (errors.subTotal?.message) errorMessages.push(`Sub Total: ${errors.subTotal.message}`);
  if (errors.total?.message) errorMessages.push(`Total: ${errors.total.message}`);
  return errorMessages.length > 0 ? errorMessages.join(", ") : "Please check the form and try again.";
}

/* --------------------------------- CONSTS -------------------------------- */

// MAX_ATTACHMENTS is now from permissions: fileAttachmentLimits.maxFileCount

// Desktop line grid: Unit (3rd track) Qty + 15px — header/cell thoda wider; baaki Qty jaisa.
const TH_BASE = "px-2 py-2 bg-muted/50 font-semibold text-sm box-border whitespace-nowrap";
const TD_BASE = "px-2 py-1 box-border";
const FLAT_INPUT = "h-9 w-full border-0 shadow-none focus-visible:ring-0 rounded-none";
const FLAT_SELECT_TRIGGER = "h-9 w-full border-0 shadow-none focus-visible:ring-0 rounded-none";

/* ------------------------------ HELPER FUNCS ------------------------------ */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Qty — amount se derive karte waqt 6 decimal (2000÷175 = 11.428571, save par amount 2000 hi rahe) */
const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;

/** Sale line: item ki default sale unit — amount type par khali unit par auto-select */
function getItemDefaultSaleUnit(item: { id?: string; salePriceUnit?: string; unitConversions?: unknown[] }): string {
  if (item.id && isAdminPanelSubscriptionCatalogItemId(item.id)) {
    return item.salePriceUnit || ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS[ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS.length - 1];
  }
  const conversions = (item.unitConversions || []) as { fromUnit?: string }[];
  return item.salePriceUnit || conversions[0]?.fromUnit || "";
}

function saleLineUnitOptionsForItem(
  selectedItem: { id: string; unitConversions?: unknown[] } | undefined,
  companyUnitsMerged: string[]
): string[] {
  if (!selectedItem) return companyUnitsMerged;
  const fromConv =
    (selectedItem.unitConversions as { fromUnit?: string; toUnit?: string }[])?.flatMap((uc) => [
      uc.fromUnit,
      uc.toUnit,
    ])?.filter((v, i, a) => Boolean(v) && a.indexOf(v) === i) || [];
  if (isAdminPanelSubscriptionCatalogItemId(selectedItem.id)) {
    return Array.from(new Set([...ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS, ...fromConv]));
  }
  return fromConv.length > 0 ? fromConv : companyUnitsMerged;
}

/** Qty × rate → line amount (tax inclusive/exclusive) */
function calcSaleLineAmountFromQty(
  qty: number,
  rate: number,
  taxRate: number,
  isTaxInclusive: boolean
): { amount: number; taxAmount: number } {
  if (isTaxInclusive) {
    const amount = round2(qty * (rate / (1 + taxRate)));
    return { amount, taxAmount: round2(amount * taxRate) };
  }
  const amount = round2(qty * rate);
  return { amount, taxAmount: round2(amount * taxRate) };
}

/** Amount type → qty (6 decimal — amount save value preserve) */
function calcSaleLineQtyFromAmount(
  amount: number,
  rate: number,
  taxRate: number,
  isTaxInclusive: boolean
): number {
  if (amount <= 0 || rate <= 0) return 0;
  if (isTaxInclusive) {
    return round6((amount * (1 + taxRate)) / rate);
  }
  return round6(amount / rate);
}

/** Edit/load: saved amount ≠ qty×rate → amount-driven line (amount overwrite na ho) */
function savedSaleAmountDiffersFromQtyCalc(
  qty: number,
  rate: number,
  savedAmount: number,
  taxRate: number,
  isTaxInclusive: boolean
): boolean {
  if (rate <= 0 || savedAmount <= 0) return false;
  const { amount: derived } = calcSaleLineAmountFromQty(qty, rate, taxRate, isTaxInclusive);
  return Math.abs(round2(derived) - round2(savedAmount)) >= 0.01;
}

type SaleLineCalcMode = "qty" | "amount";

function createEmptySaleLineItem(type: "item" | "service" = "item") {
  return {
    type,
    itemId: "",
    quantity: 1,
    rate: 0,
    unit: "",
    amount: 0,
    taxAccountId: "",
    taxAmount: 0,
    tdsAccountId: "",
    tdsAmount: 0,
    isTaxInclusive: false,
    allowManualRate: true,
  };
}

function getInitialFormValues(voucher?: any): SaleFormValues {
  if (!voucher) {
    return {
      partyId: "",
      salesAccountId: "sales_account",
      date: startOfDay(new Date()),
      voucherNumber: "",
      narration: "",
      dueDate: undefined,
      overdueImportant: false,
      lineItems: [createEmptySaleLineItem("item")],
      subTotal: 0,
      totalPurchasePrice: 0,
      discount: 0,
      discountSign: "-",
      discountExpenseAccountId: "",
      tax: 0,
      tds: 0,
      isTdsVerified: false,
      total: 0,
      unassignedFile: null, // सुरुमा null राख्ने
      isApproved: false,
    };
  }

  const copiedVoucher = JSON.parse(JSON.stringify(voucher));
  const attachmentEntries = voucherAttachmentUrlsForFormState(voucher);
  // Restore/cache dueDate may be `{ seconds, nanoseconds }`; parse it exactly like voucher date.
  const dueDate = parseFirestoreDateFieldToJsDate(voucher.dueDate ?? voucher.due_date) ?? undefined;
  const subscriptionTermKey =
    voucher.subscriptionTermKey ?? voucher.subscription_term_key ?? null;
  const lineItemsEnriched = Array.isArray(copiedVoucher.lineItems)
    ? enrichSubscriptionMirrorSaleLineItemsForForm(voucher, copiedVoucher.lineItems)
    : copiedVoucher.lineItems;
  const lineItemsNorm = Array.isArray(lineItemsEnriched)
    ? lineItemsEnriched.map((li: any) => {
        const base = normalizeVoucherLineItemForForm(li);
        const itemId = String(base.itemId ?? "").trim();
        return {
          ...base,
          name: li.name ?? base.name,
          unit: normalizeSubscriptionCatalogLineUnit(itemId, base.unit, subscriptionTermKey),
        };
      })
    : lineItemsEnriched;
  return {
    ...copiedVoucher,
    lineItems: lineItemsNorm,
    // List/cache se `date` kabhi plain `{ seconds, nanoseconds }` — `new Date(obj)` Invalid → UI/save "aaj" jaisa
    date: parseFirestoreDateFieldToJsDate(voucher.date) ?? startOfDay(new Date()),
    dueDate: dueDate ?? undefined,
    overdueImportant: voucher.overdueImportant === true,
    discount: voucher.discount || 0,
    discountSign: normalizeSalePurchaseDiscountSign(voucher.discountSign),
    discountExpenseAccountId: String(voucher.discountExpenseAccountId ?? ""),
    tax: voucher.tax || 0,
    tds: voucher.tds || 0,
    isTdsVerified: voucher.isTdsVerified === true,
    fileUrls: attachmentEntries,
    files: attachmentEntries.map((entry) => ({
      file: typeof File !== "undefined" && entry instanceof File ? entry : null,
      preview: typeof entry === "string" ? entry : "",
    })),
    salesAccountId: voucher.salesAccountId || 'sales_account',
    unassignedFile: voucher.unassignedFile || null,
    isApproved: voucher.isApproved ?? false,
  };
}

/* --------------------------------- MAIN ---------------------------------- */

export function CreateSaleForm({
  voucher,
  onVoucherAction,
  onOpenHistory,
  showHistoryButton,
  editingDisabled = false,
  deleteDisabledWhenLinked = false,
  showApproveButton = false,
  showSaveAndApproveOnCreate = false,
  onApprove,
  isApproving = false,
  onEffectiveLinksChange,
  copySaveTargetCompanyId,
  copyMismatchCategories,
  onCopyMissingCategory,
  isCopyingMissingMasters = false,
  copyMasterDraftRequest,
  recurringVoucherSaveBlocked = false,
  recurringVoucherAuxiliaryDirty = false,
}: {
  voucher?: any;
  onVoucherAction?: (status: 'saved' | 'cancelled', isSaveAndNew?: boolean, newId?: string) => void;
  onOpenHistory?: () => void;
  showHistoryButton?: boolean;
  editingDisabled?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onApprove?: () => void;
  isApproving?: boolean;
  /** Report effective has-links so dialog can hide banner and enable fields when user unlinks locally. */
  onEffectiveLinksChange?: (hasLinks: boolean | undefined) => void;
  copySaveTargetCompanyId?: string;
  copyMismatchCategories?: string[];
  onCopyMissingCategory?: (category: string) => void;
  isCopyingMissingMasters?: boolean;
  copyMasterDraftRequest?: {
    category: string;
    targetCompanyName: string;
    sourceCollection: string;
    sourceName: string;
    sourceRowPayload?: Record<string, unknown>;
  } | null;
  recurringVoucherSaveBlocked?: boolean;
  recurringVoucherAuxiliaryDirty?: boolean;
}) {
  /* ------------------------------ HOOKS/STATE ----------------------------- */
  const isMounted = useRef(true);
  type ProcessedItem = Item & { stockInQty?: number; stockOutQty?: number; stockQty?: number; displayStockQty?: number; };
  const { vouchers, processedParties, processedPartiesForSelection, processedTaxes, processedAccounts, expenseAccounts, processedExpenseGroups, processedItems, loading: vouchersLoading } = useVouchers();
  const [items, setItems] = useState<Item[]>([]);
  const { toast } = useToast();
  const { company, companyId, reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const lineColLabels = useMemo(() => resolveSalePurchaseLineColumnLabels(company), [company]);
  const lineTaxComboboxOptions = useMemo(
    () => mapSalePurchaseLineTaxComboboxOptions(processedTaxes),
    [processedTaxes]
  );
  const { user, customUser } = useAuth();
  const { role, can, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const reconGuard = useReconciledPointGuard();
  const { dateSystem, formatCurrency, formatCurrencyForPrint, formatDate, formatDateBS } = useDate();
  const router = useRouter();
  const isMobile = useIsMobile();
  /** Sirf saved + dialog-linked par file band; nayi txn par voucher.id nahi ho to attach hamesha allowed. */
  const fileAttachLockedByDialog = !!voucher?.id && deleteDisabledWhenLinked;

  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  /** Naye party save ke turant baad parties sync se pehle stale-master effect `partyId` na wipe kare. */
  const pendingPartyIdUntilInPartiesListRef = useRef<string | null>(null);
  /** Items listener pehli snapshot se pehle stale-master effect saved `itemId` na clear kare. */
  const itemsListHydratedRef = useRef(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  // Sales Account combobox: allow creating a new income/expense account inline.
  const [isCreateExpenseAccountOpen, setIsCreateExpenseAccountOpen] = useState(false);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  const [files, setFiles] = useState<(File | string)[]>([]);
  /** Dono attachment rows ke liye ek hi stable URL list (har render naya `.filter` = thumb flash). */
  const attachmentClientFileUrlsForPreview = useMemo(
    () => files.filter((f): f is string => typeof f === "string"),
    [files]
  );
  const [savePdfAsImage, setSavePdfAsImage] = useState(false);
  const showPdfAsImageToggle = useMemo(
    () =>
      allowAttachments &&
      fileAttachmentLimits.maxFileCount > 0 &&
      (fileAttachmentLimits.allowPDF || shouldSuggestPdfAsImage(files)),
    [allowAttachments, fileAttachmentLimits.maxFileCount, fileAttachmentLimits.allowPDF, files]
  );
  const initialFilesRef = useRef<string[]>([]);
  /** Post-save parent `voucher.fileUrls` stale snapshot se form overwrite rokne ke liye. */
  const savedFileUrlsSnapshotRef = useRef<string[] | null>(null);
  /** Skip reset when same voucher updates (liveVoucher) and user has edits — fixes unlink → change fields → save. */
  const lastResetVoucherIdRef = useRef<string | null>(null);
  /** Line id → qty-driven ya amount-driven calc (amount field se qty derive) */
  const lineCalcModeRef = useRef<Map<string, SaleLineCalcMode>>(new Map());
  /** Voucher badle to calc mode dubara seed — edit par amount 2000 preserve */
  const lineCalcSeededVoucherKeyRef = useRef<string | null>(null);
  const [taxRowIndex, setTaxRowIndex] = useState<number | null>(null);
  const [tdsRowIndex, setTdsRowIndex] = useState<number | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDueDateCalendarOpen, setIsDueDateCalendarOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLinkAdvancesOpen, setIsLinkAdvancesOpen] = useState(false);
  // Link section visibility: add mode hidden by default; edit mode auto-show only when links already exist.
  const [showLinkSections, setShowLinkSections] = useState(false);
  const [pendingLinkAllocations, setPendingLinkAllocations] = useState<Record<string, number> | null>(null);
  const [pendingLinkLeg, setPendingLinkLeg] = useState<{
    kind: SalePurchaseBillWiseLegKind;
    accountId: string;
  } | null>(null);
  const [billWiseLinkLegKey, setBillWiseLinkLegKey] = useState<string>("");
  /** Link dialog Done already persisted — skip post-save apply + dirty flag. */
  const billWiseLinksPersistedOnDialogRef = useRef(false);
  /** Edit hydrate + line calc settle hone se pehle Save mat enable (Payment / Journal jaisa). */
  const [editBaselineHydrated, setEditBaselineHydrated] = useState(() => !voucher?.id);
  const editBaselineVoucherIdRef = useRef<string | null>(null);
  const resetLinksOnCopyTargetChange = useCallback(() => {
    billWiseLinksPersistedOnDialogRef.current = false;
    setPendingLinkAllocations(null);
    setPendingLinkLeg(null);
    setShowLinkSections(false);
    setIsLinkAdvancesOpen(false);
    onEffectiveLinksChange?.(false);
  }, [onEffectiveLinksChange]);
  useResetLinkStateOnCopyTargetCompany(copySaveTargetCompanyId, resetLinksOnCopyTargetChange);
  const {
    resolveVoucherIdForSave,
    isPermissionEdit,
    markCopiedDraftPersisted,
    isCopiedDraftFirstInsert,
  } = useCopyDraftFirstSave(copySaveTargetCompanyId);
  // Keep "Read me" help controlled from this form so sale link section can open the shared multilingual guide.
  const [linkSectionInfoOpen, setLinkSectionInfoOpen] = useState(false);
  const isEditing = !!voucher?.id;
  const isEditingAndConverting = isVoucherEditConverting(voucher, "sale");
  const convertPresentation = useMemo(
    () => getVoucherEditConvertPresentation(voucher as Record<string, unknown> | undefined, "sale"),
    [voucher]
  );
  const {
    convertConfirmOpen,
    setConvertConfirmOpen,
    gateConvertSubmit,
    confirmConvertSubmit,
  } = useVoucherEditConvertSubmitGate(isEditingAndConverting);
  
  const form = useForm<SaleFormValues>({
    resolver: zodResolver(formSchema) as Resolver<SaleFormValues>,
    defaultValues: getInitialFormValues(voucher),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });
  const desktopLineGridStyle = useMemo(
    () => getSalePurchaseDesktopLineGridStyle(lineColLabels, fields.length > 1),
    [lineColLabels, fields.length]
  );
  const lineFieldIdsKey = useMemo(() => fields.map((f) => f.id).join("|"), [fields]);

  const [itemType, setItemType] = useState<"item" | "service">("item");
  const isCompanyAdmin = role === "owner" || customUser?.role === "CompanyAdmin" || customUser?.role === "SuperAdmin";
  const showApprovalCheckbox = false; // Approval is handled via the Approve button, not a checkbox

const { isDirty: _isFormFieldsDirty } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f: any) => typeof f === 'string') as string[];
    const newFiles    = files.filter((f: any) => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u: any, i: number) => u !== init[i]);
  })();
  const isFormDirtyRaw =
    _isFormFieldsDirty ||
    _isFileDirty ||
    (pendingLinkAllocations != null && !billWiseLinksPersistedOnDialogRef.current) ||
    recurringVoucherAuxiliaryDirty;
  const isFormDirty = editBaselineHydrated && isFormDirtyRaw;
  // Effect deps mein isFormDirty mat rakho — file/field dirty hote hi effect dubara chal kar naye voucher template ka khali partyId set kar deta tha
  const watchedLineItems = useWatch({ control: form.control, name: "lineItems", defaultValue: [] });
  const watchedDiscount = useWatch({ control: form.control, name: "discount" });
  const watchedDiscountSign = useWatch({ control: form.control, name: "discountSign" });
  const partyId = form.watch("partyId");
  const lineItemTaxId = watchedLineItems[0]?.taxAccountId;
  
  const primaryLineItemType = useMemo(() => {
    return watchedLineItems.length > 0 && watchedLineItems[0].type === "service" ? "service" : "item";
  }, [watchedLineItems]);
  
  const partyBalance = useMemo(() => {
    if (!partyId) return null;
    return processedParties.find(p => p.id === partyId)?.balance;
  }, [partyId, processedParties]);
  
  const selectedTax = useMemo(() => processedTaxes.find((t) => t.id === lineItemTaxId), [lineItemTaxId, processedTaxes]);
  // Income group IDs: groups under Income (traverse parentId chain up to income)
  const incomeGroupIds = useMemo(() => {
    const groups = processedExpenseGroups || [];
    const groupMap = new Map(groups.map((g: any) => [g.id, g]));
    const ids = new Set<string>();
    const isIncomeRoot = (id: string) => {
      const s = String(id || "").toLowerCase();
      return s === "income" || s === "direct_income" || s === "indirect_income";
    };
    const hasIncomeAncestor = (g: any, visited = new Set<string>()): boolean => {
      if (!g || visited.has(g.id)) return false;
      visited.add(g.id);
      const parentId = String(g.parentId || "").toLowerCase();
      const type = String(g.type || "").toLowerCase();
      if (isIncomeRoot(g.id) || parentId === "income" || type === "income") return true;
      if (g.parentId && groupMap.has(g.parentId)) return hasIncomeAncestor(groupMap.get(g.parentId), visited);
      return false;
    };
    groups.forEach((g: any) => {
      if (hasIncomeAncestor(g)) ids.add(g.id);
    });
    return ids;
  }, [processedExpenseGroups]);
  const salesAccountOptions = useMemo(() => {
    const opts = expenseAccounts
      .filter((a: any) => incomeGroupIds.has(a.groupId) || (a as any).type === "Income")
      .map((p: any) => ({ value: p.id, label: p.name }));
    // Only add sales_account fallback when list is empty (no income accounts yet)
    if (opts.length === 0) {
      return [{ value: "sales_account", label: "Sales Account" }];
    }
    return opts;
  }, [expenseAccounts, incomeGroupIds]);
  const discountExpenseAccountOptions = useMemo(() => {
    return expenseAccounts
      .filter((a: any) => !incomeGroupIds.has(a.groupId) && String(a.type ?? "").toLowerCase() !== "income")
      .map((a: any) => ({ value: a.id, label: a.name }));
  }, [expenseAccounts, incomeGroupIds]);
  useEffect(() => {
    const current = String(form.getValues("discountExpenseAccountId") ?? "").trim();
    if (current) return;
    const companyDefault = isEditing ? "" : readCompanyDiscountExpenseDefault("sale", company);
    const adjId =
      companyDefault || resolveAdjustmentExpenseAccountId(expenseAccounts as any[]);
    if (adjId) {
      form.setValue("discountExpenseAccountId", adjId, { shouldDirty: false, shouldValidate: false });
    }
  }, [company, expenseAccounts, form, isEditing]);
  // All unique units from all items – base list for line rows when no item selected (merged with company.customUnits below)
  const allCompanyUnits = useMemo(() => {
    const units = new Set<string>();
    (items || []).forEach((item: any) => {
      const convs = (item.unitConversions || []) as { fromUnit?: string; toUnit?: string }[];
      convs.forEach((uc) => {
        if (uc.fromUnit) units.add(uc.fromUnit);
        if (uc.toUnit) units.add(uc.toUnit);
      });
      const ob = item.openingBalanceUnit;
      if (ob) units.add(ob);
      if (item.salePriceUnit) units.add(String(item.salePriceUnit));
      if (item.purchasePriceUnit) units.add(String(item.purchasePriceUnit));
    });
    return Array.from(units).sort();
  }, [items]);
  // Firestore/SQLite `customUnits` + item-derived — so blank item row still shows kg etc. and saved "+ Add unit" labels
  const companyUnitsMerged = useMemo(
    () => mergeUnitsForDropdown(allCompanyUnits, parseCustomUnitsArray(company?.customUnits)),
    [allCompanyUnits, company?.customUnits]
  );
  /** "+ Add unit" par company doc update — next row / next voucher par list se milega */
  const onPersistNewUnit = useCallback(
    (comboboxVal: string, unitLabel: string) => {
      if (comboboxVal !== "add-new" || !unitLabel.trim()) return;
      void persistCustomUnitIfNew({
        companyId,
        company,
        unitLabel,
        reloadLocalCompanyRegistry,
        triggerSync,
      }).catch((e) => {
        console.error("persistCustomUnitIfNew", e);
        toast({ variant: "destructive", title: "Could not save unit list", description: "Check connection and try again." });
      });
    },
    [company, companyId, reloadLocalCompanyRegistry, triggerSync, toast]
  );

  const voucherIdForLinks = isCopiedDraftFirstInsert ? undefined : (voucher?.id ?? savedVoucherId ?? undefined);
  const saleFormTotal = Number(form.watch("total") ?? 0) || 0;
  const billWiseLegs = useMemo(
    () =>
      resolveSalePurchaseBillWiseLegs({
        lineItems: watchedLineItems,
        partyId: String(partyId || ""),
        partyName: processedParties.find((p) => p.id === partyId)?.name ?? "Party",
        partyAmount: getSalePurchasePartyLinkTarget({
          total: saleFormTotal,
          lineItems: watchedLineItems,
        }),
        taxes: processedTaxes,
      }),
    [watchedLineItems, partyId, processedParties, saleFormTotal, processedTaxes]
  );
  const activeBillWiseLeg = useMemo(() => {
    if (!billWiseLegs.length) return null;
    const found = billWiseLegs.find((l) => `${l.kind}:${l.accountId}` === billWiseLinkLegKey);
    return found || billWiseLegs[0];
  }, [billWiseLegs, billWiseLinkLegKey]);
  useEffect(() => {
    if (!billWiseLegs.length) {
      setBillWiseLinkLegKey("");
      return;
    }
    if (!billWiseLegs.some((l) => `${l.kind}:${l.accountId}` === billWiseLinkLegKey)) {
      setBillWiseLinkLegKey(`${billWiseLegs[0].kind}:${billWiseLegs[0].accountId}`);
    }
  }, [billWiseLegs, billWiseLinkLegKey]);

  const pendingMatchesActiveLeg =
    pendingLinkAllocations != null &&
    !!pendingLinkLeg &&
    !!activeBillWiseLeg &&
    pendingLinkLeg.kind === activeBillWiseLeg.kind &&
    pendingLinkLeg.accountId === activeBillWiseLeg.accountId;

  // Incoming: who allocated to us. Outgoing: we allocated to Purchase (sale return). When pending is set for active leg, show only pending so unlink reflects immediately.
  const effectiveLinkedRows = useMemo(() => {
    const leg = activeBillWiseLeg;
    const fetchKind = leg && leg.kind !== "party" ? "tax" : "net";
    if (pendingMatchesActiveLeg && vouchers?.length) {
      const incoming = getLinkedAmountRowsFromPending(pendingLinkAllocations!, vouchers, "sale");
      let outgoing = getOutgoingLinkedAmountRows(vouchers, voucherIdForLinks, "sale", fetchKind);
      const pendingIds = new Set(Object.keys(pendingLinkAllocations!));
      outgoing = outgoing.filter((r) => r.paymentVoucherId && pendingIds.has(r.paymentVoucherId));
      return mergeLinkedRows(incoming, outgoing);
    }
    const incoming = getLinkedAmountsToVoucher(vouchers, voucherIdForLinks, "sale", fetchKind);
    let outgoing = getOutgoingLinkedAmountRows(vouchers, voucherIdForLinks, "sale", fetchKind);
    let rows = mergeLinkedRows(incoming, outgoing);
    if (leg && voucherIdForLinks && vouchers?.length) {
      const wantEt = buildBillWiseEntityTxnId({
        voucherId: voucherIdForLinks,
        entityKind: leg.kind,
        accountId: leg.accountId,
      });
      rows = rows.filter((row) => {
        const srcId = row.paymentVoucherId;
        if (!srcId || srcId === OPENING_BALANCE_VOUCHER_ID) return leg.kind === "party";
        const src = (vouchers as any[]).find((v) => String(v.id) === String(srcId));
        const allocs = (src?.allocations as any[] | undefined) || [];
        const hit = allocs.find((a) => String(a.voucherId) === String(voucherIdForLinks));
        if (!hit) return false;
        const et = allocationEntityTxnId(hit);
        if (et) return et === wantEt;
        if (leg.kind === "party") return getNetFromAllocation(hit) > 0 || getAllocationTotal(hit) > 0;
        return getTaxFromAllocation(hit) > 0;
      });
    }
    return rows;
  }, [
    vouchers,
    voucherIdForLinks,
    pendingLinkAllocations,
    pendingMatchesActiveLeg,
    isCopiedDraftFirstInsert,
    activeBillWiseLeg,
  ]);
  const linkedAmountRows = effectiveLinkedRows;
  const totalLinked = useMemo(() => linkedAmountRows.reduce((s, r) => s + r.amount, 0), [linkedAmountRows]);
  const activeLegOutstanding = useMemo(() => {
    const legTotal = Number(activeBillWiseLeg?.totalAmount) || 0;
    return Math.max(0, legTotal - totalLinked);
  }, [activeBillWiseLeg, totalLinked]);
  const voucherHasAnyBillWiseLinks = useMemo(() => {
    if (pendingLinkAllocations != null && Object.keys(pendingLinkAllocations).length > 0) return true;
    if (!voucherIdForLinks || !vouchers?.length) return false;
    return (
      getLinkedAmountsToVoucher(vouchers, voucherIdForLinks, "sale", "all").length > 0 ||
      getOutgoingLinkedAmountRows(vouchers, voucherIdForLinks, "sale", "all").length > 0
    );
  }, [vouchers, voucherIdForLinks, pendingLinkAllocations]);
  // Report effective link state to dialog so banner/fields follow local unlink (pending = {} → no links → enable edit)
  useEffect(() => {
    if (!onEffectiveLinksChange) return;
    if (pendingLinkAllocations === null) {
      if (!billWiseLinksPersistedOnDialogRef.current) {
        onEffectiveLinksChange(undefined);
      }
      return;
    }
    onEffectiveLinksChange(linkedAmountRows.length > 0);
  }, [onEffectiveLinksChange, pendingLinkAllocations, linkedAmountRows.length]);

  useEffect(() => {
    billWiseLinksPersistedOnDialogRef.current = false;
  }, [voucher?.id]);
  // Convert to Record for dialog initial state so edit link page shows correct tick (avoids stale vouchers)
  const effectiveLinkedAmountsForDialog = useMemo(() => {
    const r: Record<string, number> = {};
    for (const row of linkedAmountRows) {
      if (row.paymentVoucherId) r[row.paymentVoucherId] = row.amount;
    }
    return r;
  }, [linkedAmountRows]);
  /** Per payment_in: total voucher amount and total allocated (for Amount, Linked on others, Linked on current columns). */
  const paymentVoucherDetails = useMemo(() => {
    const m = new Map<string, { total: number; totalAllocated: number }>();
    if (!vouchers?.length) return m;
    for (const v of vouchers) {
      if (v.type !== "payment_in" && v.type !== "direct_income") continue;
      const total = Number((v as any).amount ?? (v as any).total ?? 0) || 0;
      const allocations = ((v as any).allocations as { amount?: number; voucherId?: string }[] | undefined) || [];
      const totalAllocated = allocations.reduce((s, a) => s + getAllocationTotal(a as any), 0);
      m.set(v.id, { total, totalAllocated });
    }
    return m;
  }, [vouchers]);
  /** Bill wise: same count as Link to Cr popup (OB row + payment in/purchase list). Message uses "bcz" spelling. */
  const billWiseLinkableCount = useAdvancesLinkableCount(
    "sale",
    partyId,
    voucher?.id ?? savedVoucherId ?? undefined,
    vouchers ?? [],
    processedParties.find((p) => p.id === partyId)?.openingBalance ?? 0
  );
  const hasItemEditLock = voucherHasAnyBillWiseLinks;
  const isEditMode = !!voucher?.id;
  const canRenderBillWiseSection = isEditing || !!partyId;
  const shouldShowBillWiseSection = canRenderBillWiseSection && (showLinkSections || (isEditMode && voucherHasAnyBillWiseLinks));
  const shouldShowLinkButton = canRenderBillWiseSection && !shouldShowBillWiseSection;
  const activeLinkBalanceKind =
    activeBillWiseLeg?.kind === "tax" || activeBillWiseLeg?.kind === "tds" ? "tax" : "net";
  const activeLinkButtonLabel = salePurchaseLinkButtonLabel(
    activeBillWiseLeg?.kind ?? "party",
    "sale"
  );
  const activeLinkSectionTitle = salePurchaseLinkSectionTitle(activeBillWiseLeg?.kind ?? "party");
  const taxTdsLinkableCount = useTaxAccountLinkableCount(
    activeBillWiseLeg?.kind === "tax" || activeBillWiseLeg?.kind === "tds"
      ? activeBillWiseLeg.accountId
      : null,
    voucher?.id ?? savedVoucherId ?? undefined,
    vouchers ?? []
  );
  const activeLegLinkableCount =
    activeBillWiseLeg?.kind === "tax" || activeBillWiseLeg?.kind === "tds"
      ? taxTdsLinkableCount
      : billWiseLinkableCount;
  const saleLinkAllocationPrefs = getSalePurchaseLinkAllocation(company, "sale");
  const partyLegCrossEntityAccountIds = useMemo(() => {
    const fromLines = collectSalePurchaseTaxAndTdsAccountIds(watchedLineItems);
    return {
      taxAccountIds: saleLinkAllocationPrefs.allowTaxOnPartyAmount ? fromLines.taxAccountIds : [],
      tdsAccountIds: [] as string[], // party leg target excludes TDS; TDS is linked via its own TDS leg (no double settle)
    };
  }, [
    watchedLineItems,
    saleLinkAllocationPrefs.allowTaxOnPartyAmount,
    saleLinkAllocationPrefs.allowTdsOnPartyAmount,
  ]);

  useEffect(() => {
    if (isEditMode && voucherHasAnyBillWiseLinks) setShowLinkSections(true);
  }, [isEditMode, voucherHasAnyBillWiseLinks]);

  const transactionDates = useMemo(() => {
    if (!vouchers?.length) return [];
    return vouchers.map((v) => {
      const d = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      return d && !isNaN(d.getTime()) ? startOfDay(d) : null;
    }).filter(Boolean) as Date[];
  }, [vouchers]);

  const allProcessedItems = useMemo(() => {
    if (!items || !vouchers) return [];
    return items.map((item) => {
        const newItem: ProcessedItem = { 
            ...item, 
            debit: 0, 
            credit: 0, 
            balance: (Number(item.openingBalance) || 0) * (Number(item.openingBalanceRate) || 0),
            stockInQty: 0,
            stockOutQty: 0,
            stockQty: Number(item.openingBalance) || 0,
        };
        
        const conversions = (item.unitConversions || []) as any[];
        const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');

        const getFactor = (unit: string): number => {
            if (!unit || conversions.length === 0) return 1;
            if (unit === smallestUnit) return 1;
            
            let factor = 1;
            let currentUnit = unit;
            
            for (let i=0; i < 10; i++) { // safety break
                const conv = conversions.find(c => c.fromUnit === currentUnit);
                if (!conv) return 0; // Should not happen in a valid chain
                factor *= Number(conv.conversionFactor) || 1;
                currentUnit = conv.toUnit;
                if (currentUnit === smallestUnit) break;
            }
            return factor;
        };
        
        vouchers.forEach((v) => {
          if (v.lineItems?.some((li: any) => li.itemId === item.id)) {
              const itemInVoucher = v.lineItems.find((li: any) => li.itemId === item.id);
              if (v.type === 'purchase') {
                  newItem.debit += (Number(itemInVoucher.quantity) || 0) * (Number(itemInVoucher.rate) || 0);
                  if (newItem.stockInQty !== undefined && itemInVoucher.unit) {
                    newItem.stockInQty += (Number(itemInVoucher.quantity) || 0) * getFactor(itemInVoucher.unit);
                  }
              } else if (v.type === 'sale') {
                  const purchasePrice = Number(item.purchasePrice) || Number(itemInVoucher.rate);
                  const qty = Number(itemInVoucher.quantity) || 0;
                  newItem.credit += v.totalPurchasePrice && v.totalPurchasePrice > 0 ? v.totalPurchasePrice : (qty * purchasePrice);
                  if (newItem.stockOutQty !== undefined && itemInVoucher.unit) {
                    newItem.stockOutQty += (Number(itemInVoucher.quantity) || 0) * getFactor(itemInVoucher.unit);
                  }
              }
          }
        });

        newItem.balance = (Number(item.openingBalance) || 0) * (Number(item.openingBalanceRate) || 0) + newItem.debit - newItem.credit;
        
        const openingUnit = (item as any).openingBalanceUnit || (conversions.length > 0 ? conversions[0].fromUnit : "");
        const openingStockInSmallest = (Number(item.openingBalance) || 0) * (openingUnit ? getFactor(openingUnit) : 1);
        
        const closingStockInSmallest = openingStockInSmallest + (newItem.stockInQty || 0) - (newItem.stockOutQty || 0);
        
        newItem.stockQty = closingStockInSmallest;
        
        const displayUnitFactor = getFactor((item as any).displayUnit || smallestUnit || '');
        
        newItem.displayStockQty = displayUnitFactor > 0 ? newItem.stockQty / displayUnitFactor : 0;
        
        return newItem;
      });
  }, [items, vouchers]);

  /* --------------------------- COMPANY CONFIG FLAGS ----------------------- */

  const isAutoVoucherEnabled =
    company?.autoVoucherNumbering?.[
      primaryLineItemType === "service" ? "sale_service" : "sale"
    ] ?? true;

  const isVoucherEditingAllowed =
    company?.allowVoucherNumberEditing?.[
      primaryLineItemType === "service" ? "sale_service" : "sale"
    ] ?? false;

  const isPrefixSelectionEnabled =
    company?.enableVoucherPrefixSelection?.[
      primaryLineItemType === "service" ? "sale_service" : "sale"
    ] ?? false;

  // Role (share settings) + company voucher switch; per-line allowManualRate toggles the actual input.
  const canEditRates = can('edit_item_rates_in_vouchers');
  const companyAllowsLineRateEdit = company?.allowRateEditing?.sale ?? true;
  const isRateEditingAllowed = companyAllowsLineRateEdit && canEditRates;
  /** Rate box disabled when row locked, role/company disallow manual rates, or line toggle off (uses watchedLineItems from useWatch). */
  const saleRateDisabled = (idx: number, rowLocked: boolean) =>
    rowLocked ||
    !isRateEditingAllowed ||
    watchedLineItems?.[idx]?.allowManualRate === false;

  /* ----------------------------- EFFECTS: DATA ---------------------------- */

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!companyId) {
      itemsListHydratedRef.current = false;
      return;
    }
    itemsListHydratedRef.current = false;

    if (!shouldBindFirebaseLedgerCollectionLiveListeners()) {
      const applyRows = (rows: Item[]) => {
        itemsListHydratedRef.current = true;
        setItems(rows.filter((i) => !i.isDeleted));
      };
      applyRows(processedItems as Item[]);
      const onBump = (ev: Event) => {
        const d = (ev as CustomEvent<{ companyId?: string; collection?: string }>).detail;
        if (!d || d.companyId !== companyId || d.collection !== "items") return;
        void listCompanyDocsFromBrowserDb(companyId, "items", { forBackupMerge: true })
          .then((cached) => applyRows(cached as Item[]))
          .catch(() => {});
      };
      window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      return () => window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    }

     const unsubItems = onSnapshot(
      query(collection(firestore, `companies/${companyId}/items`)),
      (snapshot) => {
        itemsListHydratedRef.current = true;
        setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Item)).filter(i => !i.isDeleted));
      }
    );

    return () => {
      unsubItems();
    };
  }, [companyId, processedItems]);

  useVoucherAttachmentPostSaveSync({
    traceSource: "CreateSaleForm",
    companyId,
    voucher,
    savedVoucherId,
    files,
    setFiles,
    initialFilesRef,
    savedFileUrlsSnapshotRef,
    isFileDirty: _isFileDirty,
    setSavePdfAsImage,
  });

  useEffect(() => {
    if (voucher?.id) {
      const isSameVoucher = lastResetVoucherIdRef.current === voucher.id;
      // Edit: `liveVoucher` / context har snapshot par naya ref — pehle sirf `isFormDirty` true par skip tha;
      // dirty false + race par bhi `reset` date/line wipe kar deta tha. Same `id` = dubara reset mat karo.
      if (isSameVoucher) return;
      const vid = voucher.id;
      lastResetVoucherIdRef.current = vid;
      editBaselineVoucherIdRef.current = vid;
      setEditBaselineHydrated(false);
      const initialValues = getInitialFormValues(voucher);
      form.reset(initialValues, { keepDirty: false, keepDirtyValues: false });
      const li0 = initialValues.lineItems?.[0];
      if (li0?.type === "service" || li0?.type === "item") {
        setItemType(li0.type);
      }
      setSavedVoucherId(vid);
      const urlsToSet = allowAttachments ? voucherAttachmentUrlsForFormState(voucher) : [];
      if (Array.isArray(urlsToSet)) {
        setFiles(urlsToSet);
        initialFilesRef.current = urlsToSet.filter((f: any) => typeof f === 'string') as string[];
        setSavePdfAsImage(shouldSuggestPdfAsImage(urlsToSet));
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (editBaselineVoucherIdRef.current !== vid) return;
          form.reset(form.getValues(), { keepValues: true, keepDirty: false, keepDirtyValues: false });
          setEditBaselineHydrated(true);
        });
      });
    } else if (voucher) {
      // Recon sync / copy draft — poora sale form load (sirf partyId setValue se lineItems/total save fail)
      const cref = voucher.crossCopySourceRef as { companyId?: string; voucherId?: string } | undefined;
      const syncDraftKey =
        cref?.companyId && cref?.voucherId
          ? `sync:${cref.companyId}|${cref.voucherId}`
          : `new:${String(voucher.type || "sale")}|${String(voucher.partyId || "")}|${String(voucher.narration || "").slice(0, 40)}`;
      if (lastResetVoucherIdRef.current === syncDraftKey && isFormDirty) return;
      const isFirstNewSaleHydrate = lastResetVoucherIdRef.current !== syncDraftKey;
      lastResetVoucherIdRef.current = syncDraftKey;
      setSavedVoucherId(null);
      if (isFirstNewSaleHydrate) {
        const initialValues = getInitialFormValues(voucher);
        form.reset(initialValues);
        const li0 = initialValues.lineItems?.[0];
        if (li0?.type === "service" || li0?.type === "item") {
          setItemType(li0.type);
        }
        const urlsToSet = allowAttachments ? voucherAttachmentUrlsForFormState(voucher) : [];
        if (Array.isArray(urlsToSet)) {
          setFiles(urlsToSet);
          initialFilesRef.current = urlsToSet.filter((f: any) => typeof f === "string") as string[];
          setSavePdfAsImage(shouldSuggestPdfAsImage(urlsToSet));
        }
      }
    } else {
      lastResetVoucherIdRef.current = null;
      editBaselineVoucherIdRef.current = null;
      setEditBaselineHydrated(true);
    }
  }, [voucher, form, allowAttachments]);

  // Voucher/draft badle → line calc mode reset (edit load par amount-driven detect dubara)
  useEffect(() => {
    const key = voucher?.id
      ? String(voucher.id)
      : voucher
        ? `draft:${String(voucher.partyId || "")}:${String(voucher.voucherNumber || "")}`
        : "new";
    if (lineCalcSeededVoucherKeyRef.current !== key) {
      lineCalcModeRef.current.clear();
      lineCalcSeededVoucherKeyRef.current = key;
    }
  }, [voucher?.id, voucher?.partyId, voucher?.voucherNumber, voucher]);

  /* ---------------------- AUTO VOUCHER NUMBER GENERATION ------------------ */

  const fetchVoucherNumber = useCallback(
    async (prefix?: string, lineItemType?: "item" | "service") => {
      if (!companyId || !company || !isAutoVoucherEnabled) return;
      const liType = lineItemType ?? primaryLineItemType;
      try {
        const nextNo = await getNextVoucherNumberForCompany({
          companyId,
          companyDoc: company as Record<string, unknown>,
          voucherLike: { type: "sale", lineItems: [{ type: liType }] },
          selectedPrefix: prefix,
          voucherDate: form.getValues("date"),
        });
        form.setValue("voucherNumber", nextNo);
      } catch (err) {
        console.error("fetchVoucherNumber error:", err);
      }
    },
    [companyId, company, form, primaryLineItemType, isAutoVoucherEnabled]
  );

  useEffect(() => {
    // Edit-convert par bhi naya type prefix/number turant regenerate karo (voucher.id hone par bhi).
    if ((!savedVoucherId || isEditingAndConverting) && isAutoVoucherEnabled) {
      fetchVoucherNumber();
    }
  }, [voucher?.id, savedVoucherId, isEditingAndConverting, fetchVoucherNumber, primaryLineItemType, company, isAutoVoucherEnabled]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(voucher?.id && savedVoucherId && !isEditingAndConverting),
    shouldFetchNextOnDateChange: Boolean((!savedVoucherId || isEditingAndConverting) && isAutoVoucherEnabled),
    fetchVoucherNumber: () => fetchVoucherNumber(),
    resolvePrefix: () => {
      const key = primaryLineItemType === "service" ? "sale_service" : "sale";
      const list = resolveCompanyVoucherPrefixList(key, company?.voucherPrefixes?.[key]);
      return resolvePrefixFromVoucherNumber(String(form.getValues("voucherNumber") || ""), list, list[0]);
    },
  });

  /* ---------------------------- TOTALS CALC LOGIC ------------------------- */

    const getUnitBasedPrice = (item: Item, unit: string, priceType: 'sale' | 'purchase'): number => {
    const conversions = (item.unitConversions || []) as any[];
    if (conversions.length === 0) {
      return priceType === 'sale' ? item.salePrice : item.purchasePrice;
    }

    const smallestUnit = conversions[conversions.length - 1].toUnit;

    const basePrice = priceType === 'sale' ? item.salePrice : item.purchasePrice;
    const baseUnit = priceType === 'sale' ? item.salePriceUnit : (item as any).purchasePriceUnit;

    let smallestUnitPrice = basePrice;
    if (baseUnit && baseUnit !== smallestUnit) {
      let factor = 1;
      let current = baseUnit;
      while (current !== smallestUnit) {
        const conv = conversions.find((c) => c.fromUnit === current);
        if (!conv) { factor = 0; break; }
        factor *= Number(conv.conversionFactor) || 1;
        current = conv.toUnit;
      }
      smallestUnitPrice = basePrice / (factor || 1);
    }
    
    let targetPrice = smallestUnitPrice;
    if (unit !== smallestUnit) {
      let factor = 1;
      let current = unit;
       while (current !== smallestUnit) {
          const conv = conversions.find((c) => c.fromUnit === current);
          if (!conv) { factor = 0; break; }
          factor *= Number(conv.conversionFactor) || 1;
          current = conv.toUnit;
        }
      targetPrice *= factor;
    }
    
    return targetPrice;
  };

  const markLineQtyDriven = useCallback((lineId: string) => {
    lineCalcModeRef.current.set(lineId, "qty");
  }, []);

  const markLineAmountDriven = useCallback((lineId: string) => {
    lineCalcModeRef.current.set(lineId, "amount");
  }, []);

  /** Amount type: unit khali → base unit; rate 0 → item master se rate (qty derive ke liye) */
  const prepareLineForAmountEntry = useCallback(
    (index: number, itemId: string): { unit: string; rate: number } => {
      const sel = allProcessedItems.find((i) => i.id === itemId);
      if (!sel) return { unit: "", rate: 0 };

      let unit = String(form.getValues(`lineItems.${index}.unit`) ?? "").trim();
      if (!unit) {
        unit = getItemDefaultSaleUnit(sel);
        if (unit) {
          form.setValue(`lineItems.${index}.unit`, unit, { shouldDirty: true });
        }
      }

      let rate = Number(form.getValues(`lineItems.${index}.rate`) ?? 0);
      if (rate <= 0 && unit) {
        rate = getUnitBasedPrice(sel, unit, "sale");
      }
      // Unit set hai par rate 0 — base unit ka rate try karo
      if (rate <= 0) {
        const baseUnit = getItemDefaultSaleUnit(sel);
        if (baseUnit) {
          const baseRate = getUnitBasedPrice(sel, baseUnit, "sale");
          if (baseRate > 0) {
            unit = baseUnit;
            rate = baseRate;
            form.setValue(`lineItems.${index}.unit`, unit, { shouldDirty: true });
          }
        }
      }
      if (rate > 0) {
        const curRate = Number(form.getValues(`lineItems.${index}.rate`) ?? 0);
        if (curRate !== rate) {
          form.setValue(`lineItems.${index}.rate`, rate, { shouldDirty: true });
        }
      }
      return { unit, rate };
    },
    [allProcessedItems, form]
  );

  const handleLineAmountChange = useCallback(
    (index: number, lineId: string, raw: string, fieldOnChange: (v: number) => void) => {
      const itemId = form.getValues(`lineItems.${index}.itemId`);
      if (!itemId) return;
      markLineAmountDriven(lineId);
      const { rate } = prepareLineForAmountEntry(index, itemId);
      const parsed = raw === "" ? 0 : Number(raw);
      const amount = Number.isFinite(parsed) ? round2(parsed) : 0;
      fieldOnChange(amount);

      // Amount type par qty turant fill — sirf useEffect par mat chhodo
      const taxId = String(form.getValues(`lineItems.${index}.taxAccountId`) ?? "");
      const taxRow = processedTaxes.find((t) => t.id === taxId);
      const taxRate = taxRow ? Number(taxRow.rate) / 100 : 0;
      const isTaxInclusive = !!form.getValues(`lineItems.${index}.isTaxInclusive`);
      const qty = calcSaleLineQtyFromAmount(amount, rate, taxRate, isTaxInclusive);
      form.setValue(`lineItems.${index}.quantity`, qty, { shouldDirty: true });
    },
    [form, markLineAmountDriven, prepareLineForAmountEntry, processedTaxes]
  );

  useEffect(() => {
    const taxMap = new Map<string, number>(processedTaxes.map((t) => [t.id, Number(t.rate) / 100]));

    let subTotal = 0;
    let totalTax = 0;
    let totalTds = 0;
    let totalPurchasePrice = 0;
    const tdsRateMap = new Map<string, number>(processedTaxes.map((t) => [t.id, Number(t.rate) / 100]));

    (watchedLineItems || []).forEach((item, index) => {
      const lineId = fields[index]?.id;
      const taxRate = taxMap.get(String(item?.taxAccountId)) ?? 0;
      const rate = Number(item?.rate ?? 0);
      const qty = Number(item?.quantity ?? 0);

      // Pehli baar: saved amount ≠ qty×rate → amount mode (edit par 2000 → 2000.25 na ho)
      let mode: SaleLineCalcMode = lineId ? lineCalcModeRef.current.get(lineId) ?? "qty" : "qty";
      if (lineId && !lineCalcModeRef.current.has(lineId)) {
        const savedAmount = round2(Number(item?.amount ?? 0));
        if (
          item.itemId &&
          rate > 0 &&
          savedAmount > 0 &&
          savedSaleAmountDiffersFromQtyCalc(qty, rate, savedAmount, taxRate, !!item.isTaxInclusive)
        ) {
          lineCalcModeRef.current.set(lineId, "amount");
          mode = "amount";
        } else {
          lineCalcModeRef.current.set(lineId, "qty");
        }
      }

      let amount = 0;
      let taxAmount = 0;
      let effectiveQty = qty;

      if (mode === "amount") {
        amount = round2(Number(item?.amount ?? 0));
        let effectiveRate = rate;
        // Rate 0 ho to item master se resolve — amount se qty derive ho sake
        if (effectiveRate <= 0 && item.itemId) {
          const itemData = allProcessedItems.find((i) => i.id === item.itemId);
          if (itemData) {
            const unitForRate =
              String(item.unit ?? "").trim() || getItemDefaultSaleUnit(itemData);
            effectiveRate = unitForRate ? getUnitBasedPrice(itemData, unitForRate, "sale") : 0;
            if (effectiveRate <= 0) {
              const baseUnit = getItemDefaultSaleUnit(itemData);
              effectiveRate = baseUnit ? getUnitBasedPrice(itemData, baseUnit, "sale") : 0;
            }
            if (effectiveRate > 0 && rate !== effectiveRate) {
              form.setValue(`lineItems.${index}.rate`, effectiveRate, {
                shouldDirty: false,
                shouldTouch: false,
                shouldValidate: false,
              });
            }
          }
        }
        effectiveQty = calcSaleLineQtyFromAmount(amount, effectiveRate, taxRate, !!item.isTaxInclusive);
        taxAmount = round2(amount * taxRate);

        const currQty = Number(form.getValues(`lineItems.${index}.quantity`) ?? 0);
        if (currQty !== effectiveQty) {
          form.setValue(`lineItems.${index}.quantity`, effectiveQty, {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          });
        }
        const currTaxAmt = Number(form.getValues(`lineItems.${index}.taxAmount`) ?? 0);
        if (currTaxAmt !== taxAmount) {
          form.setValue(`lineItems.${index}.taxAmount`, taxAmount, {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          });
        }
      } else {
        const derived = calcSaleLineAmountFromQty(qty, rate, taxRate, !!item.isTaxInclusive);
        amount = derived.amount;
        taxAmount = derived.taxAmount;

        const currAmount = Number(form.getValues(`lineItems.${index}.amount`) ?? 0);
        const currTaxAmt = Number(form.getValues(`lineItems.${index}.taxAmount`) ?? 0);

        if (currAmount !== amount) {
          form.setValue(`lineItems.${index}.amount`, amount, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        }
        if (currTaxAmt !== taxAmount) {
          form.setValue(`lineItems.${index}.taxAmount`, taxAmount, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        }
      }

      const itemData = allProcessedItems.find((i) => i.id === item.itemId);
      const purchasePriceForLine = itemData ? getUnitBasedPrice(itemData, item.unit || "", "purchase") : 0;
      totalPurchasePrice += effectiveQty * purchasePriceForLine;

      subTotal += amount;
      totalTax += taxAmount;
      const taxableBase = lineTaxableBaseForTds({ amount });
      const tdsAmount = calcLineTdsAmount(taxableBase, String(item?.tdsAccountId ?? ""), tdsRateMap);
      totalTds += tdsAmount;
      const currTdsAmt = Number(form.getValues(`lineItems.${index}.tdsAmount`) ?? 0);
      if (currTdsAmt !== tdsAmount) {
        form.setValue(`lineItems.${index}.tdsAmount`, tdsAmount, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      }
    });

    subTotal = round2(subTotal);
    totalTax = round2(totalTax);
    totalTds = round2(totalTds);
    const discountMag = round2(Math.max(0, Number(watchedDiscount ?? 0)));
    const discountNet = salePurchaseDiscountNetEffect(
      normalizeSalePurchaseDiscountSign(watchedDiscountSign),
      discountMag
    );
    const total = round2(subTotal + discountNet + totalTax);

    const currSubTotal = Number(form.getValues("subTotal") ?? 0);
    const currTotalPurchase = Number(form.getValues("totalPurchasePrice") ?? 0);
    const currTax = Number(form.getValues("tax") ?? 0);
    const currTds = Number(form.getValues("tds") ?? 0);
    const currTotal = Number(form.getValues("total") ?? 0);

    if (currSubTotal !== subTotal) {
      form.setValue("subTotal", subTotal, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (currTotalPurchase !== totalPurchasePrice) {
      form.setValue("totalPurchasePrice", totalPurchasePrice, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (currTax !== totalTax) {
      form.setValue("tax", totalTax, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (currTds !== totalTds) {
      form.setValue("tds", totalTds, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (currTotal !== total) {
      form.setValue("total", total, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
  }, [watchedLineItems, watchedDiscount, watchedDiscountSign, processedTaxes, form, allProcessedItems, fields.length, lineFieldIdsKey]);

  /* ------------------------------ HANDLERS -------------------------------- */

  const handleToggleAllInclusive = useCallback(
    (checked: boolean | "indeterminate") => {
      const val = checked === true;
      (watchedLineItems || []).forEach((_, idx) => {
        form.setValue(`lineItems.${idx}.isTaxInclusive`, val, {
          shouldDirty: true,
        });
      });
    },
    [form, watchedLineItems]
  );
  
  // Ref so handleFormSubmit always calls the latest processAndSave without listing it as a dep
  const processAndSaveRef = useRef<((data: any, opts?: any) => Promise<any>) | null>(null);

  // Validated payload `data` से save — `getValues()` से date कभी-कभी miss होकर coerce में "आज" भर जाता था
  const runValidatedSubmit = useCallback(
    (e: React.FormEvent, options: { saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean; ocrAutoPost?: boolean } = {}) => {
      void form.handleSubmit(
        async (data) => {
          await processAndSaveRef.current?.(data, options);
        },
        (errors) => {
          sonnerToast.error("Validation Failed", { description: formatSaleFormValidationErrors(errors) });
        }
      )(e);
    },
    [form]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent, options: { saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean; ocrAutoPost?: boolean } = {}) => {
      e.preventDefault();
      gateConvertSubmit(() => runValidatedSubmit(e, options));
    },
    [gateConvertSubmit, runValidatedSubmit]
  );

  /* OCR (local): first attachment -> autofill; Auto Post saves UNAPPROVED via the same validated submit. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.sale(() => createEmptySaleLineItem("item") as unknown as Record<string, unknown>),
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((company as { name?: string } | null)?.name) || null,
    companyId,
    ownPan: ((company as { pan?: string; panNumber?: string } | null)?.pan ?? (company as { panNumber?: string } | null)?.panNumber) || null,
    parties: (processedParties || []) as never,
    items: (processedItems || []) as never,
    taxes: (processedTaxes || []) as never,
    autoPost: () => runValidatedSubmit({ preventDefault() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing,
    disabled: !!editingDisabled,
  });

   const processAndSave = useCallback(
    async (
      data: SaleFormValues,
      { saveAndNew, print, approveAfterSave, ocrAutoPost }: { saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean; ocrAutoPost?: boolean } = {}
    ): Promise<string | null> => {
      if (!user || !companyId || !company) {
        sonnerToast.error("Error", { description: "Login and company selection required." });
        return null;
      }

      if (reconGuard) {
        const allowed = await reconGuard.checkAndConfirmReconciledDate({
          companyId,
          voucherDate: data.date,
          partyId: data.partyId,
          allVouchers: vouchers,
        });
        if (!allowed) {
          if (isMounted.current) setIsLoading(false);
          return null;
        }
      }

      const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving sale...");
      if (toastId == null) return null;
      if (isMounted.current) setIsLoading(true);

      try {
        // Permission check: create or edit — `data.date` + `getValues` dono se parse (Timestamp/plain JSON mix)
        const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
        const submitDate =
          parseFirestoreDateFieldToJsDate(data.date) ?? parseFirestoreDateFieldToJsDate(form.getValues("date"));
        if (!submitDate) {
          sonnerToast.error("Error", {
            id: toastId,
            description: "Invalid transaction date. Please pick the date again.",
          });
          if (isMounted.current) setIsLoading(false);
          return null;
        }

        if (isEdit) {
          // Check edit permission - determine ownership
          // Static/APK: SQLite mirror se ownership — save se pehle Firestore `getDoc` await mat (hang → toast flash, dialog open).
          const fetchVoucher = preferLocalLedgerReads()
            ? undefined
            : async (cid: string, vid: string) => {
                const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
                return voucherDoc.exists() ? voucherDoc.data() : null;
              };
          const isOwnRecord = await determineVoucherOwnership(voucher, savedVoucherId, vouchers, user.uid, companyId, fetchVoucher);
          const currentVoucher = voucher ?? (savedVoucherId && vouchers ? vouchers.find((v: any) => v.id === savedVoucherId) : null);
          assertCanEdit(canEditRecord, isOwnRecord, currentVoucher);
          
          // Check backdate limit for edit — server/cache ki original date (plain seconds bhi)
          let originalVoucherDate = submitDate;
          if (voucher?.date != null) {
            originalVoucherDate = parseFirestoreDateFieldToJsDate(voucher.date) ?? submitDate;
          } else if (savedVoucherId) {
            const existingVoucher = vouchers.find(v => v.id === savedVoucherId);
            if (existingVoucher?.date != null) {
              originalVoucherDate = parseFirestoreDateFieldToJsDate(existingVoucher.date) ?? submitDate;
            } else if (companyId && !preferLocalLedgerReads()) {
              const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, savedVoucherId));
              if (voucherDoc.exists()) {
                const voucherData = voucherDoc.data();
                originalVoucherDate = parseFirestoreDateFieldToJsDate(voucherData?.date) ?? submitDate;
              }
            }
          }
          assertCanPerformBackdated(canPerformBackdatedAction, "edit", originalVoucherDate);
        } else {
          // Check create permission
          assertCan(can, "create_records");
          
          // Check backdate limit for create
          assertCanPerformBackdated(canPerformBackdatedAction, "create", submitDate);
        }
        const lineItemsWithTax = data.lineItems.map((li) => ({
          ...li,
          quantity: round6(Number(li.quantity)),
          amount: round2(Number(li.amount ?? 0)),
          taxAmount: round2(Number(li.taxAmount ?? 0)),
          tdsAccountId: String(li.tdsAccountId ?? "").trim(),
          tdsAmount: round2(Number(li.tdsAmount ?? 0)),
          // Bina item = blank; select karke save par id Firestore me persist ho.
          itemId: String(li.itemId ?? "").trim(),
        }));
        const tdsTotal = round2(
          lineItemsWithTax.reduce((s, li) => s + (Number(li.tdsAmount) || 0), 0)
        );

        const submissionData = {
          ...data,
          date: submitDate,
          lineItems: lineItemsWithTax,
          tds: tdsTotal,
          isTdsVerified: tdsTotal > 0 && data.isTdsVerified === true,
          type: "sale",
          ...(voucher?.quotationId
            ? {
                quotationId: String(voucher.quotationId),
                quotationNumber: String(voucher.quotationNumber || ""),
              }
            : {}),
        };

        /** Convert / Copy-draft: Firestore `saveVoucher` 4th arg — copy pehli bar null hona chahiye (stale id overwrite na ho). */
        const originalVoucherIdToDelete: string | null = isEditingAndConverting
          ? getVoucherConvertOriginalId(voucher)
          : null;
        const idArgForFirestore = resolveVoucherIdForSave({
          savedVoucherId,
          originalVoucherIdToDelete,
        });

        const attachResult = await resolveVoucherAttachmentsBeforeSave({
          companyId,
          company,
          files,
          savePdfAsImage,
          lockedPdfSource: voucher,
          storageFolder: "sale",
          maxFileCount: fileAttachmentLimits.maxFileCount,
          idArgForFirestore,
          isEditingAndConverting,
          onStorageLimitBlocked: (message) => {
            sonnerToast.error("Storage limit reached", { id: toastId, description: message });
            if (isMounted.current) setIsLoading(false);
          },
        });
        if (!attachResult) return null;

        const existingFileUrls = attachResult.fileUrls;
        let preGeneratedVoucherId = attachResult.preGeneratedVoucherId;

        let finalData = {
          ...submissionData,
          ...voucherAttachmentFieldsForSave(existingFileUrls, voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))),
          // OCR Auto Post: hamesha UNAPPROVED (admin auto-approve bhi nahi).
        isApproved: ocrAutoPost ? false : isCompanyAdmin ? true : (data.isApproved ?? voucher?.isApproved ?? false),
        };
        // Keep opening balance link from current voucher (set by Link to Txns); copy-draft pehli save par stale savedVoucherId se purani row na uthao
        const currentSale = isCopiedDraftFirstInsert
          ? null
          : (savedVoucherId && vouchers ? vouchers.find((v: any) => v.id === savedVoucherId) : voucher);
        const obAlloc = currentSale != null ? (currentSale as any).openingBalanceAllocated : undefined;
        if (obAlloc !== undefined && obAlloc !== null && Number(obAlloc) >= 0) {
          (finalData as any).openingBalanceAllocated = Number(obAlloc) || 0;
        }
        
        if (!idArgForFirestore) delete (finalData as { id?: string }).id;

        const isEditForApprove = !!voucher?.id && !originalVoucherIdToDelete;
        const approverName = customUser?.displayName || user?.displayName || user?.email || user?.uid;
        const savedDoc = await saveVoucher(
          companyId,
          user.uid,
          finalData,
          idArgForFirestore,
          approveAfterSave ? { approvedByUserId: user.uid, approvedByName: approverName } : undefined,
          preGeneratedVoucherId ? { preGeneratedVoucherId } : undefined
        );

        let docId: string | null | undefined;
        if (savedDoc && savedDoc.id) {
            markCopiedDraftPersisted();
            docId = savedDoc.id;
            if (isMounted.current) setSavedVoucherId(docId);
            if (originalVoucherIdToDelete) {
              await markVoucherConvertedInRecycleBin(companyId, originalVoucherIdToDelete, {
                convertedToType: "sale",
                convertedToVoucherNumber: finalData.voucherNumber,
                convertedToVoucherId: docId,
                deletedBy: user.uid,
              });
            }
        } else {
            throw new Error("Failed to save voucher and get ID.");
        }

        const successDescription =
          approveAfterSave && savedDoc?.id
            ? isEditForApprove
              ? "Sale updated and approved."
              : "Sale saved and approved."
            : "Sale invoice saved successfully.";
        replaceVoucherSaveLoadingWithShortSuccess(toastId, "Success", successDescription);
        if (isMounted.current) setIsLoading(false);

        if (!saveAndNew) {
          onVoucherAction?.("saved", false, docId ?? undefined);
        }

        if (docId && companyId) {
          const rawUrls = ((finalData.fileUrls as string[]) || existingFileUrls).filter(
            (u): u is string => typeof u === "string" && Boolean(String(u).trim())
          );
          try {
            const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
              companyId,
              voucherId: docId,
              rawFileUrls: rawUrls,
              storageFolder: "sale",
              previousUrls: initialFilesRef.current,
            });
            if (!isMounted.current) return null;
            savedFileUrlsSnapshotRef.current = [...persistedUrls];
            setFiles(persistedUrls);
            initialFilesRef.current = persistedUrls;
          } catch (attachErr) {
            console.warn("[CreateSaleForm] post-save attachment finalize", attachErr);
          }
        }

        const needsLinkSyncOnSave =
          pendingLinkAllocations !== null &&
          !billWiseLinksPersistedOnDialogRef.current &&
          !!(companyId && docId && vouchers?.length);

        // Baaki linkage / alerts / print background — Save & Close par dialog turant band (Firestore row already persisted).
        const postSaveTail = async () => {
          if (needsLinkSyncOnSave) {
            const partyIdForLink = data.partyId ?? form.getValues("partyId");
            if (partyIdForLink) {
              const partyForOb = processedParties.find((p) => p.id === partyIdForLink);
              const showOBRow = Number(partyForOb?.openingBalance ?? 0) < 0;
              const linkLeg = pendingLinkLeg ?? activeBillWiseLeg;
              const linkBalanceKind =
                linkLeg?.kind === "tax" || linkLeg?.kind === "tds" ? "tax" : "net";
              const linkResult = await runWithVoucherLinkSaveProgress(async () => {
                await applyAdvancesAllocationsToServer({
                  companyId,
                  mode: "sale",
                  targetVoucherId: docId,
                  targetPartyId: partyIdForLink,
                  balanceKind: linkBalanceKind,
                  linkEntityKind: linkLeg?.kind ?? "party",
                  linkAccountId: linkLeg?.accountId ?? partyIdForLink,
                  linkCrossEntityTaxAccountIds:
                    linkLeg?.kind === "party" ? partyLegCrossEntityAccountIds.taxAccountIds : undefined,
                  linkCrossEntityTdsAccountIds:
                    linkLeg?.kind === "party" ? partyLegCrossEntityAccountIds.tdsAccountIds : undefined,
                  linkedAmounts: pendingLinkAllocations,
                  vouchers,
                  showOBRow: linkLeg?.kind === "party" ? showOBRow : false,
                });
                if (isMounted.current) {
                  setPendingLinkAllocations(null);
                  setPendingLinkLeg(null);
                  billWiseLinksPersistedOnDialogRef.current = false;
                }
              });
              if (!linkResult.ok) {
                sonnerToast.error("Sale saved but linking advances failed.", { duration: 4500 });
              }
            }
          }
          // New create: saveVoucher(approveAfterSave) already set isApproved — skip second approve lookup.
          if (companyId && company) {
            const isEditHist = !!voucher?.id;
            const amount = Number((finalData as any).total) || 0;
            const vid = docId ?? voucher?.id;
            if (isEditHist) {
              const changes = getChangedFieldLabels(
                { ...voucher, date: voucher?.date, total: (voucher as any)?.total, narration: (voucher as any)?.narration, voucherNumber: (voucher as any)?.voucherNumber, partyId: (voucher as any)?.partyId },
                { ...finalData, date: (finalData as any).date, total: (finalData as any).total, narration: (finalData as any).narration, voucherNumber: (finalData as any).voucherNumber, partyId: (finalData as any).partyId },
                [
                  { key: "total", label: "Amount" },
                  { key: "narration", label: "Narration" },
                  { key: "date", label: "Date" },
                  { key: "voucherNumber", label: "Voucher number" },
                  { key: "partyId", label: "Party" },
                ]
              );
              await sendTransactionAlert(companyId, company, {
                kind: "edited",
                voucherId: vid,
                voucherNumber: finalData.voucherNumber,
                voucherType: "sale",
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
                changes: changes.length > 0 ? changes : undefined,
              });
            } else if (isAmountOverOneLakh(amount)) {
              await sendTransactionAlert(companyId, company, {
                kind: "large_amount",
                voucherId: vid,
                voucherNumber: finalData.voucherNumber,
                voucherType: "sale",
                amount,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
              });
            }
          }
          if (print && docId) {
            window.open(`/sale/invoice/${docId}`, "_blank");
          }
          if (saveAndNew && isMounted.current) {
            form.reset(getInitialFormValues());
            setFiles([]);
            setSavePdfAsImage(false);
            setSavedVoucherId(null);
            await fetchVoucherNumber();
          }
          if (saveAndNew && isMounted.current) {
            onVoucherAction?.("saved", true, docId ?? undefined);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.error("[CreateSaleForm] post-save tail", err);
            sonnerToast.error("Saved — background sync issue", {
              description: err instanceof Error ? err.message : "Advances/link or alerts may finish late.",
              duration: 4500,
            });
          });
          return docId;
        }

        await postSaveTail();
        return docId;

      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          sonnerToast.error("Permission Denied", { id: toastId, description: error.message });
        } else if (isVoucherLimitError(error)) {
          sonnerToast.error("Voucher limit reached", { id: toastId, description: error.message, action: { label: "Upgrade", onClick: () => window.location.assign("/billing") } });
        } else {
          console.error("Error preparing save operation: ", error);
          voucherSaveErrorToast(toastId, error, "An error occurred before saving.");
        }
        return null;
      } finally {
        if (isMounted.current) setIsLoading(false);
      }
    },
    // pendingLinkAllocations, vouchers, processedParties: required so link data is persisted to server on Save (avoids stale closure)
    [companyId, user, files, savePdfAsImage, onVoucherAction, form, savedVoucherId, company, voucher, isEditingAndConverting, fetchVoucherNumber, pendingLinkAllocations, pendingLinkLeg, activeBillWiseLeg, partyLegCrossEntityAccountIds, vouchers, processedParties, resolveVoucherIdForSave, isPermissionEdit, markCopiedDraftPersisted, isCopiedDraftFirstInsert]
  );


  const handleDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;

    try {
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: voucherIdToDelete,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: vouchers as Array<{ id?: string } & Record<string, unknown>> | null,
      });
      if (!canDeleteVoucher(voucherData)) {
        throw new PermissionDeniedError(
          (voucherData as any)?.isApproved
            ? "You do not have permission to delete approved vouchers."
            : "You do not have permission to delete records."
        );
      }
      if (voucherData && hasPaymentLinks(voucherData)) {
        toast({ variant: "destructive", title: "Cannot Delete", description: "First unlink linked transactions." });
        return;
      }
      if (voucherDocExists && voucherData) {
        const voucherDate = resolveVoucherDeleteBackdateDate(voucherData, {
          form: "sale",
          companyId,
          voucherId: voucherIdToDelete,
        });
        assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
      }
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast({
          variant: "destructive",
          title: "Permission Denied",
          description: error.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to check permissions.",
        });
      }
      return;
    }
    
    setIsLoading(true);
    try {
      await softDeleteVoucherMoveToRecycleBin(companyId, voucherIdToDelete, user?.uid || "");
      toast({
        title: "Voucher Moved to Bin",
        description: "The sale invoice has been moved to the recycle bin.",
      });
      if (onVoucherAction) onVoucherAction('cancelled');
    } catch (err) {
      console.error("delete sale error:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete voucher.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;

    try {
      assertCanPermanentDeleteFromForm(can, role);
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: voucherIdToDelete,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: vouchers as Array<{ id?: string } & Record<string, unknown>> | null,
      });
      if (!canDeleteVoucher(voucherData)) {
        throw new PermissionDeniedError(
          (voucherData as any)?.isApproved
            ? "You do not have permission to delete approved vouchers."
            : "You do not have permission to delete records."
        );
      }
      if (voucherData && hasPaymentLinks(voucherData)) {
        toast({ variant: "destructive", title: "Cannot Delete", description: "First unlink linked transactions." });
        return;
      }
      if (voucherDocExists && voucherData) {
        const voucherDate = resolveVoucherDeleteBackdateDate(voucherData, {
          form: "sale",
          companyId,
          voucherId: voucherIdToDelete,
        });
        assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
      }
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast({
          variant: "destructive",
          title: "Permission Denied",
          description: error.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to check permissions.",
        });
      }
      return;
    }

    setIsLoading(true);
    try {
      await permanentDeleteVoucherFromForm(companyId, voucherIdToDelete);
      toast({
        title: "Sale deleted permanently.",
        description: "The sale invoice has been permanently deleted.",
      });
      setIsDeleteDialogOpen(false);
      if (onVoucherAction) onVoucherAction("cancelled");
    } catch (err) {
      console.error("permanent delete sale error:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to permanently delete sale.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!allowAttachments) return;
    await handleVoucherAttachmentInputChange(e, {
      companyId,
      currentFiles: files,
      maxFiles: fileAttachmentLimits.maxFileCount || 0,
      allowImage: fileAttachmentLimits.allowImage,
      allowPDF: fileAttachmentLimits.allowPDF,
      setFiles,
      toast,
    });
  };

  const handleTaxCreated = (newTaxId: string) => {
    if (taxRowIndex !== null) {
      form.setValue(`lineItems.${taxRowIndex}.taxAccountId`, newTaxId);
    }
    if (tdsRowIndex !== null) {
      form.setValue(`lineItems.${tdsRowIndex}.tdsAccountId`, newTaxId);
    }
    setIsCreateTaxOpen(false);
    setTaxRowIndex(null);
    setTdsRowIndex(null);
  };

  const openCreateTdsTaxDialog = useCallback((lineIndex: number, prefillName?: string) => {
    setTdsRowIndex(lineIndex);
    setTaxRowIndex(null);
    setIsCreateTaxOpen(true);
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: prefillName }));
    }, 100);
  }, []);

  /* ------------------------- DERIVED MEMOS / WATCHES ---------------------- */

  const voucherPrefixes = useMemo(() => {
    const prefixKey = primaryLineItemType === "service" ? "sale_service" : "sale";
    return resolveCompanyVoucherPrefixList(
      prefixKey,
      company?.voucherPrefixes?.[prefixKey]
    );
  }, [company, primaryLineItemType]);
  // Keep ref current so handleFormSubmit always calls latest version
  processAndSaveRef.current = processAndSave;

  const [subTotal, total, tax, tds, totalPurchasePrice] = useWatch({
    control: form.control,
    name: ["subTotal", "total", "tax", "tds", "totalPurchasePrice"],
  });

  useEffect(() => {
    if (isEditing) return;
    const def = readStoredTdsDefault("sale", companyId || "");
    if (!def) return;
    (form.getValues("lineItems") || []).forEach((li: { tdsAccountId?: string }, i: number) => {
      if (!String(li?.tdsAccountId || "").trim()) {
        form.setValue(`lineItems.${i}.tdsAccountId`, def, { shouldDirty: false, shouldTouch: false });
      }
    });
  }, [companyId, form, fields.length, isEditing]);
  
  const filteredItems = useMemo(() => items.filter((i) => i.type === itemType && !i.isDeleted), [items, itemType]);
  
  const itemOptions = useMemo(
    () =>
      buildVoucherLineItemComboboxOptions({
        filteredItems,
        allProcessedItems,
        items: items ?? [],
        watchedLineItems,
      }),
    [filteredItems, allProcessedItems, watchedLineItems, items]
  );

  /** Items/Services tab — line type + voucher prefix/number sync (har click par). */
  const handleItemTypeTabChange = useCallback(
    (next: "item" | "service") => {
      if (deleteDisabledWhenLinked) return;
      if (next === itemType) return;
      setItemType(next);
      let lines = form.getValues("lineItems") || [];
      if (lines.length === 0) {
        append(createEmptySaleLineItem(next));
        lines = form.getValues("lineItems") || [];
      }
      lines.forEach((li, idx) => {
        form.setValue(`lineItems.${idx}.type`, next, { shouldDirty: true });
        const itemId = String(li.itemId || "").trim();
        if (!itemId) return;
        const row = allProcessedItems.find((i) => i.id === itemId);
        if (row && row.type !== next) {
          form.setValue(`lineItems.${idx}.itemId`, "", { shouldDirty: true });
          form.setValue(`lineItems.${idx}.rate`, 0, { shouldDirty: true });
          form.setValue(`lineItems.${idx}.amount`, 0, { shouldDirty: true });
          form.setValue(`lineItems.${idx}.unit`, "", { shouldDirty: true });
        }
      });
      if ((!savedVoucherId || isEditingAndConverting) && isAutoVoucherEnabled) {
        void fetchVoucherNumber(undefined, next);
      }
    },
    [
      deleteDisabledWhenLinked,
      itemType,
      form,
      append,
      allProcessedItems,
      savedVoucherId,
      isEditingAndConverting,
      isAutoVoucherEnabled,
      fetchVoucherNumber,
    ]
  );

  useEffect(() => {
    if (voucher?.id || savedVoucherId) return;
    if ((form.getValues("lineItems") || []).length > 0) return;
    append(createEmptySaleLineItem(itemType));
  }, [voucher?.id, savedVoucherId, fields.length, itemType, append, form]);
  
  const availableAccounts = useMemo(() => processedAccounts.filter(acc => !acc.isSpecial), [processedAccounts]);
  /** Save & Copy To: mismatch categories source-driven rakho; source me item na ho to item Copy chip hide. */
  const copyDraftMasterHelpersEnabled = Boolean(copySaveTargetCompanyId && onCopyMissingCategory);
  // Source voucher me actual item mismatch mila tabhi blank item row par Copy chip dikhao.
  const hasSourceItemMismatch = Boolean(copyMismatchCategories?.includes("item"));
  const salesAccountId = form.watch("salesAccountId");
  const showCopyPartyFromSource = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return false;
    const pid = String(partyId || "").trim();
    if (!pid) return true;
    return !processedParties.some((p: any) => p.id === pid);
  }, [copyDraftMasterHelpersEnabled, partyId, processedParties]);
  const showCopySalesAccountFromSource = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return false;
    const sid = String(salesAccountId || "").trim();
    // Copy chip tabhi dikhao jab value blank ho ya options me missing ho; fallback-selected value par force na karo.
    if (!sid) return true;
    return !salesAccountOptions.some((o: { value: string }) => o.value === sid);
  }, [copyDraftMasterHelpersEnabled, salesAccountId, salesAccountOptions]);
  const highlightPartyLabelCopyMismatch = showCopyPartyFromSource;
  const highlightSalesAccountLabelCopyMismatch = showCopySalesAccountFromSource;
  const saleLineNeedsCopyItem = useCallback(
    (idx: number) => {
      if (!copyDraftMasterHelpersEnabled) return false;
      const li = watchedLineItems?.[idx] as Record<string, unknown> | undefined;
      if (!li) return false;
      const iid = String(li.itemId || "").trim();
      // Blank item row par Copy tabhi dikhao jab source voucher me item mismatch aaya ho.
      if (!iid) return hasSourceItemMismatch;
      return !(items || []).some((it: Item) => it.id === iid);
    },
    [copyDraftMasterHelpersEnabled, watchedLineItems, items, hasSourceItemMismatch]
  );
  const saleLineNeedsCopyTax = useCallback(
    (idx: number) => {
      if (!copyDraftMasterHelpersEnabled) return false;
      const li = watchedLineItems?.[idx] as Record<string, unknown> | undefined;
      if (!li) return false;
      const tid = String(li.taxAccountId || "").trim();
      // Item jaisa: khali tax field bhi copy-draft mode me mismatch (header Tax + Copy dikhane ke liye).
      if (!tid) return true;
      const taxOk = Boolean(processedTaxes.some((t: any) => t.id === tid));
      if (taxOk) return false;
      return true;
    },
    [copyDraftMasterHelpersEnabled, watchedLineItems, processedTaxes]
  );
  /** Desktop line grid: Copy chip header row me — koi bhi line mismatch ho to dikhao (Purchase jaisa). */
  const desktopHeaderCopyItem = useMemo(
    () =>
      copyDraftMasterHelpersEnabled &&
      (watchedLineItems || []).some((_, idx) => saleLineNeedsCopyItem(idx)),
    [copyDraftMasterHelpersEnabled, watchedLineItems, saleLineNeedsCopyItem]
  );
  const desktopHeaderCopyTax = useMemo(
    () =>
      copyDraftMasterHelpersEnabled &&
      (watchedLineItems || []).some((_, idx) => saleLineNeedsCopyTax(idx)),
    [copyDraftMasterHelpersEnabled, watchedLineItems, saleLineNeedsCopyTax]
  );

  /** Copy-draft: sirf prefilled dialogs — auto-create nahin (`AddVoucherDialog` se request). */
  useEffect(() => {
    if (!copyMasterDraftRequest) return;
    const req = copyMasterDraftRequest;
    const targetLabel = req.targetCompanyName || "company";
    const payload = req.sourceRowPayload;
    const sc = String(req.sourceCollection || "");
    const nm = String(req.sourceName || "").trim();

    if (payload && sc === "items") {
      setIsCreateItemOpen(true);
      setTimeout(() => {
        document.dispatchEvent(
          new CustomEvent("prefill-create-item-from-row", {
            detail: {
              rowPayload: payload,
              type: primaryLineItemType === "service" ? "service" : "item",
            },
          })
        );
      }, 90);
      sonnerToast.message(`Item prefilled from source → save adds to "${targetLabel}".`);
      return;
    }
    if (payload && sc === "taxes") {
      setIsCreateTaxOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-tax-from-row", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Tax prefilled from source → save adds to "${targetLabel}".`);
      return;
    }

    if (!nm) return;
    switch (req.category) {
      case "party":
        setIsCreatePartyOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-party-name", { detail: nm })), 80);
        sonnerToast.message(`Party prefilled → save adds to "${targetLabel}".`);
        return;
      case "tax":
        setIsCreateTaxOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: nm })), 80);
        sonnerToast.message(`Tax prefilled → save adds to "${targetLabel}".`);
        return;
      case "item":
        setIsCreateItemOpen(true);
        setTimeout(() => {
          document.dispatchEvent(
            new CustomEvent("prefill-create-item-name", { detail: { name: nm, type: primaryLineItemType === "service" ? "service" : "item" } })
          );
        }, 80);
        sonnerToast.message(`Item prefilled → save adds to "${targetLabel}".`);
        return;
      case "account":
        setIsCreateExpenseAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
        sonnerToast.message(`Sales account prefilled → save adds under "${targetLabel}".`);
        return;
      default:
        break;
    }
  }, [copyMasterDraftRequest, primaryLineItemType]);

  /** Dusra tab/item delete hone par stale master IDs toast + clear. */
  useEffect(() => {
    if (vouchersLoading || !companyId) return;
    // Static APK/EXE: nested provider / company toggle par items + parties briefly []; sale edit par line/customer false clear na ho.
    if (
      voucher?.id &&
      processedParties.length === 0 &&
      items.length === 0 &&
      processedTaxes.length === 0 &&
      expenseAccounts.length === 0
    ) {
      return;
    }
    const missing: string[] = [];
    const pid = String(partyId || "").trim();
    // Customer clear tabhi jab party list hydrate ho chuki ho; partial load me false missing avoid.
    if (pid && processedParties.length > 0 && !processedParties.some((p: any) => p.id === pid)) {
      if (pendingPartyIdUntilInPartiesListRef.current !== pid) {
        missing.push("customer");
        form.setValue("partyId", "");
      }
    }
    const sah = String(form.getValues("salesAccountId") || "").trim();
    if (sah && sah !== "sales_account" && !salesAccountOptions.some((o: { value: string }) => o.value === sah)) {
      // Save & Copy To: orphan source sales-ledger id par pehla income A/c auto mat — `CreatePurchaseForm` jaisa placeholder.
      if (copySaveTargetCompanyId) {
        form.setValue("salesAccountId", "sales_account");
      } else {
        missing.push("sales account");
        form.setValue("salesAccountId", salesAccountOptions[0]?.value || "sales_account");
      }
    }
    (watchedLineItems || []).forEach((line: Record<string, unknown>, idx: number) => {
      const iid = String(line?.itemId || "").trim();
      // Line row ka item dubara sirf existence check — type toggle se filtered list me na chhute.
      const itemRows = items ?? [];
      // Items listener hydrate hone se pehle saved itemId mat hatao (parties pehle aa jate hain).
      if (iid && itemsListHydratedRef.current && !itemRows.some((it: Item) => it.id === iid)) {
        const subMirror =
          String(voucher?.kind ?? "") === "subscription-payment" ||
          (voucher as { systemGenerated?: boolean })?.systemGenerated === true;
        if (subMirror && isAdminPanelSubscriptionCatalogItemId(iid)) {
          return;
        }
        missing.push(`line ${idx + 1} item`);
        form.setValue(`lineItems.${idx}.itemId`, "");
      }
      const tid = String(line?.taxAccountId || "").trim();
      if (tid && processedTaxes.length > 0 && !processedTaxes.some((t: any) => t.id === tid)) {
        missing.push(`line ${idx + 1} tax`);
        form.setValue(`lineItems.${idx}.taxAccountId`, "");
      }
    });
    if (missing.length > 0) {
      sonnerToast.error("Master no longer exists", {
        description: `Removed: ${[...new Set(missing)].join(", ")}. Pick again.`,
      });
    }
  }, [
    vouchersLoading,
    companyId,
    partyId,
    processedParties,
    salesAccountOptions,
    items,
    watchedLineItems,
    processedTaxes,
    form,
    copySaveTargetCompanyId,
    voucher?.kind,
    voucher?.systemGenerated,
  ]);

  // Pending party ab listener ke baad list me — ref clear (Payment jaisa create-party race fix).
  useEffect(() => {
    const pend = pendingPartyIdUntilInPartiesListRef.current;
    if (!pend) return;
    if (processedParties.some((p: any) => p.id === pend)) {
      pendingPartyIdUntilInPartiesListRef.current = null;
    }
  }, [processedParties]);

  // User ne aur party choose kiya to pending-create guard hata do.
  useEffect(() => {
    const pend = pendingPartyIdUntilInPartiesListRef.current;
    const pid = String(partyId || "").trim();
    if (pend && pid && pid !== pend) {
      pendingPartyIdUntilInPartiesListRef.current = null;
    }
  }, [partyId]);

  /* --------------------------------- RENDER -------------------------------- */

  return (
    <>
      <Form {...form}>
        <form onSubmit={handleFormSubmit} className="h-full flex flex-col min-w-0 w-full max-w-full">
          {/* PC: Radix ScrollArea viewport nested overflow clip karti hai—yahan native overflow-auto se horizontal scrollbar milta hai; footer form ke bahar hi rehta hai. */}
          <div
            className={cn(
              "flex-1 min-h-0 min-w-0 w-full",
              isMobile
                ? "overflow-y-auto overflow-x-hidden [scrollbar-width:thin]"
                : /* w-2 = vertical track patla (pehle sirf h-2 tha — horizontal patla, vertical mota) */
                  // Tablet + PC-view touch drag fix: content area gesture se horizontal + vertical scroll dono chalna chahiye.
                  "overflow-auto pr-6 -mr-6 touch-pan-x touch-pan-y [scrollbar-width:thin] [WebkitOverflowScrolling:touch]"
            )}
          >
            <div
              className={cn(
                "space-y-6 bg-slate-100 px-[2px]",
                isMobile
                  ? "min-w-0 w-full max-w-full overflow-x-hidden [&>*]:max-w-full [&>*]:min-w-0"
                  : cn(SALE_PURCHASE_VOUCHER_DESKTOP_BODY)
              )}
            >
              {/* Main voucher info section: Invoice/Date/Party/Sales A/c in one consistent container color. */}
              {/* Main voucher info block: deepen blue so it is not dim compared to green item section. */}
              <div className={cn("rounded-lg border border-sky-400 bg-sky-100 p-1", !isMobile && "w-full")}>
              {isMobile ? (
                <>
                  {/* Mobile: Prefix + Invoice + Date एक row में; `date` को `voucherNumber` के अंदर nest नहीं — वरना RHF में date submit तक bind नहीं होती */}
                  {(() => {
                    const hasPrefix = isPrefixSelectionEnabled && voucherPrefixes.length > 0;
                    const hasDateBS = dateSystem === 'BS' || dateSystem === 'Both';
                    const hasDateAD = dateSystem === 'AD' || dateSystem === 'Both';
                    const colCount = (hasPrefix ? 1 : 0) + 1 + (hasDateBS ? 1 : 0) + (hasDateAD ? 1 : 0);
                    return (
                      <>
                        <div className="grid gap-[2px] w-full min-w-0 max-w-full" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                          <FormField
                            control={form.control}
                            name="voucherNumber"
                            render={({ field: voucherField }: any) => (
                              <>
                                {hasPrefix && (
                                  <FormItem className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Prefix</FormLabel>
                                    <Select onValueChange={(prefix) => fetchVoucherNumber(prefix)} value={voucherPrefixes.find((p) => voucherField.value?.startsWith(normalizePrefix(p)) || voucherField.value?.startsWith(p)) || voucherPrefixes[0]} disabled={deleteDisabledWhenLinked}>
                                      <SelectTrigger className="h-9 w-full min-w-0 max-w-full text-xs px-1 [&>span]:truncate">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {voucherPrefixes.map((p) => (
                                          <SelectItem key={p} value={p}>
                                            {p}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </FormItem>
                                )}
                                <FormItem className="min-w-0 w-full overflow-hidden">
                                  <FormLabel className="text-xs truncate">Invoice No.</FormLabel>
                                  <FormControl>
                                    <VoucherNumberInputWithRefresh placeholder="e.g. INV-001" {...voucherField} chromeSize="sm" className="h-9 text-xs px-2 min-w-0 max-w-full truncate w-full" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                                  </FormControl>
                                </FormItem>
                              </>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field: dateField }: any) => (
                              <>
                                {hasDateBS && (
                                  <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Date (BS)</FormLabel>
                                    <div className="min-w-0 w-full overflow-hidden">
                                      <BsDatePicker valueAD={dateField.value} onChangeAD={(d) => { if (d) d.setHours(12, 0, 0, 0); dateField.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} transactionDates={transactionDates} className="h-9 text-xs w-full" disabled={deleteDisabledWhenLinked} />
                                    </div>
                                  </FormItem>
                                )}
                                {hasDateAD && (
                                  <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Date</FormLabel>
                                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button variant="outline" className={cn("h-9 pl-2 pr-2 text-left font-normal text-xs w-full min-w-0 max-w-full truncate", !dateField.value && "text-muted-foreground")} disabled={deleteDisabledWhenLinked}>
                                            {dateField.value ? formatDate(dateField.value) : <span className="text-xs">Pick date</span>}
                                            <CalendarIcon className="ml-auto h-3 w-3 shrink-0 opacity-50" />
                                          </Button>
                                        </FormControl>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-0 z-[102]" align="start">
                                        <Calendar mode="single" selected={dateField.value} onSelect={(date) => { if (date) date.setHours(12, 0, 0, 0); dateField.onChange(date); setIsCalendarOpen(false); }} initialFocus modifiers={{ hasTransactions: transactionDates }} modifiersClassNames={{ hasTransactions: "has-transactions" }} />
                                      </PopoverContent>
                                    </Popover>
                                  </FormItem>
                                )}
                              </>
                            )}
                          />
                        </div>
                        <div className="flex flex-col gap-0">
                          <FormField control={form.control} name="voucherNumber" render={() => <FormMessage />} />
                          <FormField control={form.control} name="date" render={() => <FormMessage />} />
                        </div>
                      </>
                    );
                  })()}
                  {/* Mobile row uses fixed 2-column grid so long Sales A/c text cannot resize Party field. */}
                  <div className="grid grid-cols-2 gap-[2px] w-full min-w-0 max-w-full overflow-hidden">
                    <FormField
                      control={form.control}
                      name="partyId"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                          <div className="flex justify-between items-center mb-1 gap-1">
                            <FormLabel className={cn("text-xs", highlightPartyLabelCopyMismatch && "font-semibold text-red-600")}>
                              Party
                            </FormLabel>
                            {showCopyPartyFromSource && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-5 shrink-0 px-1.5 text-[9px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                onClick={() => onCopyMissingCategory?.("party")}
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                            {partyBalance !== null && partyBalance !== undefined && (
                              <FormLabel className={cn("text-[10px] font-semibold mr-[2px]", partyBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                {formatCurrencyForPrint(partyBalance, { noSuffix: true, noAnimation: true })} {partyBalance >= 0 ? 'Dr' : 'Cr'}
                              </FormLabel>
                            )}
                          </div>
                          {/* Keep combobox width locked inside Party column on mobile. */}
                          <div className="flex gap-1 w-full min-w-0 overflow-hidden">
                            <Combobox
                              triggerClassName="h-9 w-full min-w-0 max-w-full overflow-hidden"
                              options={mapPartiesForVoucherCombobox(processedPartiesForSelection)}
                              value={field.value}
                              onChange={(val, newName) => {
                                if (val === "add-new") {
                                  setIsCreatePartyOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(
                                      new CustomEvent("prefill-create-party-name", {
                                        detail: newName,
                                      })
                                    );
                                  }, 100);
                                } else {
                                  field.onChange(val);
                                }
                              }}
                              placeholder="Select customer"
                              addNewLabel="+ Add New Party"
                              disabled={deleteDisabledWhenLinked}
                            />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="salesAccountId"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="ledger" className="min-w-0 w-full overflow-hidden">
                          <div className="flex justify-between items-center mb-1 gap-1">
                            <FormLabel className={cn("text-xs", highlightSalesAccountLabelCopyMismatch && "font-semibold text-red-600")}>
                              Sales A/c
                            </FormLabel>
                            {showCopySalesAccountFromSource && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-5 shrink-0 px-1.5 text-[9px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                onClick={() => onCopyMissingCategory?.("account")}
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                          </div>
                          {/* Keep Sales A/c combobox from stretching row width on long labels. */}
                          <div className="flex gap-1 w-full min-w-0 overflow-hidden">
                            <Combobox
                              triggerClassName="h-9 w-full min-w-0 max-w-full overflow-hidden"
                              // Sales account should show only Income-group accounts.
                              options={salesAccountOptions}
                              value={field.value}
                              onChange={(val, newName) => {
                                // Support inline account creation from Sales Account selector.
                                if (val === "add-new") {
                                  setIsCreateExpenseAccountOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: newName }));
                                  }, 100);
                                } else {
                                  field.onChange(val);
                                }
                              }}
                              placeholder="Select account"
                              addNewLabel="+ Add New Account"
                              disabled={deleteDisabledWhenLinked}
                            />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* PC View: Customer, Sales Account, Prefix, Invoice No., Date(s). When payment linked (deleteDisabledWhenLinked), all fields here and in Items are locked; only Narration, Due Date and Link for bill wise stay editable. */}
                  {(() => {
                    const hasPrefix = isPrefixSelectionEnabled && voucherPrefixes.length > 0;
                    const hasDateBS = dateSystem === 'BS' || dateSystem === 'Both';
                    const hasDateAD = dateSystem === 'AD' || dateSystem === 'Both';
                    const colCount = 2 + (hasPrefix ? 1 : 0) + 1 + (hasDateBS ? 1 : 0) + (hasDateAD ? 1 : 0);
                    return (
                      <div className="grid gap-2 w-full items-end" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(max-content, 1fr))` }}>
                        <FormField
                          control={form.control}
                          name="partyId"
                          render={({ field }: any) => (
                            <FormItem data-ocr-field="party" className="min-w-0 w-full overflow-hidden flex flex-col">
                              <div className="flex items-center gap-1 flex-wrap w-full">
                                <FormLabel className={cn("truncate shrink-0", highlightPartyLabelCopyMismatch && "font-semibold text-red-600")}>
                                  Customer (Dr.)
                                </FormLabel>
                                {showCopyPartyFromSource && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-6 shrink-0 px-2 text-[10px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                    onClick={() => onCopyMissingCategory?.("party")}
                                    disabled={isCopyingMissingMasters}
                                  >
                                    {isCopyingMissingMasters ? "…" : "Copy"}
                                  </Button>
                                )}
                                {partyBalance !== null && partyBalance !== undefined && (
                                  <FormLabel className={cn("text-xs font-semibold ml-auto shrink-0", partyBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                    {partyBalance >= 0 ? `Rec: ${formatCurrencyForPrint(partyBalance, { noSuffix: true, noAnimation: true })} Dr` : `Pay: ${formatCurrencyForPrint(Math.abs(partyBalance), { noSuffix: true, noAnimation: true })} Cr`}
                                  </FormLabel>
                                )}
                              </div>
                              <Combobox
                                triggerClassName="h-10 w-full min-w-0"
                                options={mapPartiesForVoucherCombobox(processedPartiesForSelection)}
                                value={field.value}
                                onChange={(val, newName) => {
                                  if (val === "add-new") {
                                    setIsCreatePartyOpen(true);
                                    setTimeout(() => { document.dispatchEvent(new CustomEvent("prefill-create-party-name", { detail: newName })); }, 100);
                                  } else field.onChange(val);
                                }}
                                placeholder="Select a customer"
                                addNewLabel="+ Add New Party"
                                disabled={deleteDisabledWhenLinked}
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="salesAccountId"
                          render={({ field }: any) => (
                            <FormItem data-ocr-field="ledger" className="min-w-0 w-full overflow-hidden flex flex-col">
                              <div className="flex items-center justify-between gap-2">
                                <FormLabel className={cn("truncate", highlightSalesAccountLabelCopyMismatch && "font-semibold text-red-600")}>
                                  Sales Account (Cr.)
                                </FormLabel>
                                {showCopySalesAccountFromSource && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-6 shrink-0 px-2 text-[10px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                    onClick={() => onCopyMissingCategory?.("account")}
                                    disabled={isCopyingMissingMasters}
                                  >
                                    {isCopyingMissingMasters ? "…" : "Copy"}
                                  </Button>
                                )}
                              </div>
                              <Combobox
                                triggerClassName="h-10 w-full min-w-0"
                                // Sales account should show only Income-group accounts.
                                options={salesAccountOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                  // Support inline account creation from Sales Account selector.
                                  if (val === "add-new") {
                                    setIsCreateExpenseAccountOpen(true);
                                    setTimeout(() => {
                                      document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: newName }));
                                    }, 100);
                                  } else {
                                    field.onChange(val);
                                  }
                                }}
                                placeholder="Select sales account"
                                addNewLabel="+ Add New Account"
                                disabled={deleteDisabledWhenLinked}
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {hasPrefix && (
                          <FormField
                            control={form.control}
                            name="voucherNumber"
                            render={({ field }: any) => (
                              <FormItem className="min-w-0 w-full overflow-hidden flex flex-col">
                                <FormLabel className="truncate">Prefix</FormLabel>
                                <Select onValueChange={(prefix) => fetchVoucherNumber(prefix)} value={voucherPrefixes.find((p) => field.value?.startsWith(normalizePrefix(p)) || field.value?.startsWith(p)) || voucherPrefixes[0]} disabled={deleteDisabledWhenLinked}>
                                  <SelectTrigger className="h-10 w-full min-w-0 shrink-0">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {voucherPrefixes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                        )}
                        <FormField
                          control={form.control}
                          name="voucherNumber"
                          render={({ field }: any) => (
                            <FormItem className="min-w-0 w-full overflow-hidden flex flex-col">
                              <FormLabel className="truncate">Invoice No.</FormLabel>
                              <FormControl>
                                <VoucherNumberInputWithRefresh placeholder="e.g. INV-001" {...field} className="h-10 w-full min-w-0 shrink-0" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="date"
                          render={({ field }: any) => (
                            <>
                              {hasDateBS && (
                                <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden flex flex-col">
                                  <FormLabel className="truncate">Date (BS)</FormLabel>
                                  <BsDatePicker valueAD={field.value} onChangeAD={(d) => { if (d) d.setHours(12, 0, 0, 0); field.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} transactionDates={transactionDates} className="h-10 w-full shrink-0" disabled={deleteDisabledWhenLinked} />
                                  <FormMessage />
                                </FormItem>
                              )}
                              {hasDateAD && (
                                <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden flex flex-col">
                                  <FormLabel className="truncate">Date</FormLabel>
                                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button variant="outline" className={cn("h-10 w-full min-w-0 shrink-0 pl-3 text-left font-normal", !field.value && "text-muted-foreground")} disabled={deleteDisabledWhenLinked}>
                                          {field.value ? formatDate(field.value) : "Pick a date"}
                                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 z-[102]" align="start">
                                      <Calendar mode="single" selected={field.value} onSelect={(date) => { if (date) date.setHours(12, 0, 0, 0); field.onChange(date); setIsCalendarOpen(false); }} initialFocus modifiers={{ hasTransactions: transactionDates }} modifiersClassNames={{ hasTransactions: "has-transactions" }} />
                                    </PopoverContent>
                                  </Popover>
                                  <FormMessage />
                                </FormItem>
                              )}
                            </>
                          )}
                        />
                      </div>
                    );
                  })()}
                </>
              )}
              </div>

              {/* Item section ribbon: keep one consistent green tone so this category is visually clear. */}
              <div className={cn(
                "border border-emerald-300/80 rounded-lg relative bg-emerald-50 p-1",
                isMobile ? "w-[calc(100%-4px)] mx-auto px-[2px] overflow-hidden min-w-0" : "w-full px-[2px] overflow-visible"
              )}>
                {/* Keep item/service selector inside the same item section container for unified color grouping. */}
                <div className={cn("mb-2", isMobile && "flex justify-start")}>
                  <Tabs value={itemType} onValueChange={(v) => handleItemTypeTabChange(v as "item" | "service")} className={cn(isMobile && "w-auto")}>
                    <TabsList className={cn(
                      isMobile && "flex gap-[2px] px-[2px]"
                    )}>
                      <TabsTrigger 
                        value="item" 
                        className={cn(isMobile && "flex-shrink-0")}
                        style={isMobile ? { width: '25mm', maxWidth: '25mm' } : undefined}
                      >
                        Items
                      </TabsTrigger>
                      <TabsTrigger 
                        value="service" 
                        className={cn(isMobile && "flex-shrink-0")}
                        style={isMobile ? { width: '25mm', maxWidth: '25mm' } : undefined}
                      >
                        Services
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {isMobile ? (
                  // Mobile View: No scrollable container, broken rows
                  <div className="w-full">
                    {/* Mobile Rows */}
                    {fields.map((line, index) => {
                  const selectedItem = allProcessedItems.find(
                    (i) => i.id === form.getValues(`lineItems.${index}.itemId`)
                  );

                  // When item selected: use item's units; else item-derived + persisted customUnits (creatable)
                  const unitOptions = saleLineUnitOptionsForItem(selectedItem, companyUnitsMerged);
                  const itemFieldsDisabled = hasItemEditLock || deleteDisabledWhenLinked;

                  return (
                    isMobile ? (
                      // Mobile View: Broken into multiple rows
                      <div key={line.id} className="border-t px-[2px] py-2 space-y-2">
                        {/* Row 1: Item + Copy (Save & Copy To target company) */}
                        <div className="w-full px-[2px]">
                          <div className="flex items-start gap-1 w-full min-w-0">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.itemId`}
                              render={({ field }: any) => (
                                <FormItem data-ocr-field="lines" className="min-w-0 flex-1 w-full">
                                <Combobox
                                  options={itemOptions}
                                  value={comboboxValueFromLineItemId(field.value)}
                                  disabled={itemFieldsDisabled}
                                  onChange={(val, newName) => {
                                    if (val === "add-new") {
                                      setIsCreateItemOpen(true);
                                      setTimeout(() => {
                                        document.dispatchEvent(
                                          new CustomEvent("prefill-create-item-name", {
                                            detail: { name: newName, type: itemType },
                                          })
                                        );
                                      }, 100);
                                    } else {
                                      const itemId = lineItemIdFromComboboxValue(val);
                                      field.onChange(itemId);
                                      markLineQtyDriven(line.id);
                                      const sel = itemId
                                        ? allProcessedItems.find((i) => i.id === itemId)
                                        : undefined;
                                      if (sel) {
                                        const defaultUnit = getItemDefaultSaleUnit(sel);
                                        const rate = getUnitBasedPrice(sel, defaultUnit, 'sale');
                                        form.setValue(`lineItems.${index}.rate`, rate, { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.unit`, defaultUnit, { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.taxAccountId`, sel.saleTaxId || "", { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.type`, itemType, { shouldDirty: true });
                                      }
                                    }
                                  }}
                                  placeholder={`Select ${itemType}`}
                                  addNewLabel={`+ Add New ${itemType === "item" ? "Item" : "Service"}`}
                                />
                              </FormItem>
                            )}
                          />
                            {saleLineNeedsCopyItem(index) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 shrink-0 px-2 text-[9px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                onClick={() => onCopyMissingCategory?.("item")}
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Row 2 & 3: Qty/Unit and Rate/Tax in 2 columns with 6px gap */}
                        <div className="flex gap-[6px] mx-[2px]">
                          {/* Left Column: Qty (top) and Rate (bottom) */}
                          <div className="flex-1 space-y-2">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.quantity`}
                              render={({ field }: any) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Qty</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      {...field}
                                      value={field.value ?? ""}
                                      step="0.000001"
                                      min={0}
                                      className="h-9 text-xs text-right tabular-nums"
                                      disabled={itemFieldsDisabled}
                                      onChange={(e) => {
                                        markLineQtyDriven(line.id);
                                        field.onChange(e);
                                      }}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.rate`}
                              render={({ field }: any) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Rate</FormLabel>
                                  {/* Row: Slot `id` sirf Input par — TooltipProvider Fragment pe merge na ho */}
                                  <div className="flex w-full min-w-0 items-center gap-1">
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <FormControl>
                                            <Input
                                              type="number"
                                              {...field}
                                              onChange={(e) => {
                                                markLineQtyDriven(line.id);
                                                field.onChange(e);
                                              }}
                                              disabled={saleRateDisabled(index, itemFieldsDisabled)}
                                              className={cn("h-9 min-w-0 flex-1 text-xs text-right", saleRateDisabled(index, itemFieldsDisabled) && 'bg-muted cursor-not-allowed')}
                                              title={
                                                !canEditRates
                                                  ? "No role permission to edit rates"
                                                  : !companyAllowsLineRateEdit
                                                    ? "Sale rate editing is off in Voucher Settings"
                                                    : watchedLineItems?.[index]?.allowManualRate === false
                                                      ? "Tick the checkbox to edit rate on this line"
                                                      : undefined
                                              }
                                            />
                                          </FormControl>
                                        </TooltipTrigger>
                                        {!isRateEditingAllowed && !canEditRates ? (
                                          <TooltipContent>
                                            <p>No permission to edit item rates</p>
                                          </TooltipContent>
                                        ) : !isRateEditingAllowed && canEditRates && !companyAllowsLineRateEdit ? (
                                          <TooltipContent>
                                            <p>Turn on &quot;Allow Rate Editing&quot; for Sale in Voucher Settings</p>
                                          </TooltipContent>
                                        ) : isRateEditingAllowed && watchedLineItems?.[index]?.allowManualRate === false ? (
                                          <TooltipContent>
                                            <p>Tick the checkbox next to rate to enable editing</p>
                                          </TooltipContent>
                                        ) : null}
                                      </Tooltip>
                                    </TooltipProvider>
                                    {isRateEditingAllowed && !itemFieldsDisabled && (
                                      <FormField
                                        control={form.control}
                                        name={`lineItems.${index}.allowManualRate`}
                                        render={({ field: manualRateField }: any) => (
                                          <FormItem className="m-0 shrink-0 space-y-0">
                                            <FormControl>
                                              <Checkbox
                                                checked={manualRateField.value !== false}
                                                onCheckedChange={(c) => manualRateField.onChange(c === true)}
                                                aria-label="Allow editing item rate on this line"
                                                title={manualRateField.value !== false ? "Rate edit enabled" : "Rate edit disabled"}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />
                                    )}
                                  </div>
                                </FormItem>
                              )}
                            />
                          </div>
                          {/* Right column: Unit trigger ko chhoti screen par bhi ≥12ch — cramped placeholder avoid. */}
                          <div className="flex-1 min-w-[calc(8.5rem+15px)] space-y-2">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.unit`}
                              render={({ field }: any) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Unit</FormLabel>
                                  <FormControl>
                                    <div className="w-full [&_button]:h-9 [&_button]:w-full [&_button]:text-xs">
                                      <Combobox
                                        options={[
                                          ...unitOptions.map((u) => ({ value: u, label: u })),
                                          ...(field.value && !unitListHas(unitOptions, field.value) ? [{ value: field.value, label: field.value }] : []),
                                        ]}
                                        value={field.value}
                                        disabled={itemFieldsDisabled}
                                        onChange={(val, newName) => {
                                          const unitVal = val === "add-new" ? (newName || "").trim() : val;
                                          markLineQtyDriven(line.id);
                                          field.onChange(unitVal);
                                          onPersistNewUnit(val, unitVal);
                                          const sel = allProcessedItems.find((i) => i.id === form.getValues(`lineItems.${index}.itemId`));
                                          if (sel && unitVal) {
                                            const newRate = getUnitBasedPrice(sel, unitVal, 'sale');
                                            form.setValue(`lineItems.${index}.rate`, newRate, { shouldDirty: true });
                                          }
                                        }}
                                        placeholder="Unit"
                                        addNewLabel="+ Add unit"
                                        triggerLabelMinCh={12}
                                      />
                                    </div>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.taxAccountId`}
                              render={({ field }: any) => (
                                <FormItem data-ocr-field="tax">
                                  {/* Copy chip visible => Tax label red; resolved selection => normal label color. */}
                                  <FormLabel className={cn("text-xs", saleLineNeedsCopyTax(index) && "text-red-600 font-semibold")}>Tax</FormLabel>
                                  <FormControl>
                                    <div className="[&_button]:h-[35px] [&_button]:text-xs">
                                      <Combobox
                                        options={withSelectedHiddenTax(lineTaxComboboxOptions, processedTaxes, field.value)}
                                        value={field.value}
                                        disabled={itemFieldsDisabled}
                                        onChange={(val, newName) => {
                                          if (val === "add-new") {
                                            setTaxRowIndex(index);
                                            setIsCreateTaxOpen(true);
                                            setTimeout(() => {
                                                document.dispatchEvent(new CustomEvent('prefill-create-tax-name', { detail: newName }));
                                            }, 100);
                                          } else {
                                            field.onChange(val === "none" ? "" : val);
                                          }
                                        }}
                                        placeholder={lineColLabels.tax}
                                        addNewLabel="+ Add New Tax"
                                        {...SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS}
                                      />
                                    </div>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>

                        <SalePurchaseTdsLineUi
                          control={form.control}
                          index={index}
                          side="sale"
                          showDefaultControl={!isEditing}
                          companyId={companyId || ""}
                          processedTaxes={processedTaxes}
                          taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                          disabled={itemFieldsDisabled}
                          onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                          variant="mobile"
                          taxableLabel={lineColLabels.taxable}
                          tdsLabel={lineColLabels.tds}
                          tdsAmountLabel={lineColLabels.tdsAmount}
                          tdsPlaceholder={lineColLabels.tds}
                        />

                        {/* Row 4: Tax Inc, Tax Amt and Amount */}
                        <div className="flex gap-[2px] px-[2px]">
                          <div className="flex-1">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.isTaxInclusive`}
                              render={({ field }: any) => (
                                <FormItem>
                                  <div className="flex items-center justify-between gap-1">
                                    {/* Copy chip visible => Tax Inc label red; resolved selection => normal label color. */}
                                    <FormLabel className={cn("text-xs", saleLineNeedsCopyTax(index) && "text-red-600 font-semibold")}>Tax Inc.</FormLabel>
                                    {saleLineNeedsCopyTax(index) && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-5 shrink-0 px-1.5 text-[9px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                        onClick={() => onCopyMissingCategory?.("tax")}
                                        disabled={isCopyingMissingMasters}
                                      >
                                        {isCopyingMissingMasters ? "…" : "Copy"}
                                      </Button>
                                    )}
                                  </div>
                                  <div className="flex items-center h-9">
                                    <FormControl>
                                      <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={itemFieldsDisabled} />
                                    </FormControl>
                                  </div>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="flex-1">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.taxAmount`}
                              render={({ field }: any) => (
                                <FormItem>
                                  <FormLabel className="text-xs">{lineColLabels.taxAmount}</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      {...field}
                                      readOnly
                                      className="h-9 text-xs text-right bg-muted"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="flex-1">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.amount`}
                              render={({ field }: any) => {
                                const lineAmountEditable =
                                  Boolean(watchedLineItems?.[index]?.itemId) && !itemFieldsDisabled;
                                return (
                                <FormItem>
                                  <FormLabel className="text-xs">{lineColLabels.amount}</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      {...field}
                                      value={field.value ?? ""}
                                      readOnly={!lineAmountEditable}
                                      disabled={!lineAmountEditable}
                                      title={lineAmountEditable ? "Amount type karo — unit (base) aur qty auto fill" : "Pehle item select karo"}
                                      className={cn(
                                        "h-9 text-xs text-right tabular-nums",
                                        !lineAmountEditable && "bg-muted"
                                      )}
                                      onChange={(e) =>
                                        handleLineAmountChange(index, line.id, e.target.value, field.onChange)
                                      }
                                    />
                                  </FormControl>
                                </FormItem>
                                );
                              }}
                            />
                          </div>
                        </div>

                        {/* Remove Line */}
                        {fields.length > 1 && (
                          <div className="flex justify-end px-[2px]">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={itemFieldsDisabled}
                              onClick={() => remove(index)}
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Desktop View: Original grid layout
                      <div
                        key={line.id}
                        className={cn(SALE_PURCHASE_DESKTOP_LINE_GRID_CLASS, "divide-x divide-border border-t")}
                        style={desktopLineGridStyle}
                      >
                        <div className={cn(TD_BASE, "flex flex-col")}>
                          <div className="flex items-start gap-1 w-full min-w-0">
                            <FormField
                              control={form.control}
                              name={`lineItems.${index}.itemId`}
                              render={({ field }: any) => (
                                <FormItem data-ocr-field="lines" className="min-w-0 flex-1 w-full">
                                <Combobox
                                  options={itemOptions}
                                  value={comboboxValueFromLineItemId(field.value)}
                                  disabled={itemFieldsDisabled}
                                  onChange={(val, newName) => {
                                    if (val === "add-new") {
                                      setIsCreateItemOpen(true);
                                      setTimeout(() => {
                                        document.dispatchEvent(
                                          new CustomEvent("prefill-create-item-name", {
                                            detail: { name: newName, type: itemType },
                                          })
                                        );
                                      }, 100);
                                    } else {
                                      const itemId = lineItemIdFromComboboxValue(val);
                                      field.onChange(itemId);
                                      markLineQtyDriven(line.id);
                                      const sel = itemId
                                        ? allProcessedItems.find((i) => i.id === itemId)
                                        : undefined;
                                      if (sel) {
                                        const defaultUnit = getItemDefaultSaleUnit(sel);
                                        const rate = getUnitBasedPrice(sel, defaultUnit, 'sale');
                                        form.setValue(`lineItems.${index}.rate`, rate, { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.unit`, defaultUnit, { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.taxAccountId`, sel.saleTaxId || "", { shouldDirty: true });
                                        form.setValue(`lineItems.${index}.type`, itemType, { shouldDirty: true });
                                      }
                                    }
                                  }}
                                  placeholder={`Select ${itemType}`}
                                  addNewLabel={`+ Add New ${itemType === "item" ? "Item" : "Service"}`}
                                />
                              </FormItem>
                            )}
                          />
                            {saleLineNeedsCopyItem(index) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 shrink-0 px-2 text-[10px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                onClick={() => onCopyMissingCategory?.("item")}
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className={cn(TD_BASE, "flex items-center justify-end")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.quantity`}
                            render={({ field }: any) => (
                              <FormControl>
                                <Input type="number" {...field} step="0.000001" min={0} className={cn(FLAT_INPUT, "text-right tabular-nums")} disabled={itemFieldsDisabled} onChange={(e) => { markLineQtyDriven(line.id); field.onChange(e); }} />
                              </FormControl>
                            )}
                          />
                        </div>

                        <div className={TD_BASE}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.unit`}
                            render={({ field }: any) => (
                              <FormItem className="w-full">
                                <FormControl>
                                  <div className="w-full [&_button]:h-9 [&_button]:w-full [&_button]:text-xs">
                                    <Combobox
                                      options={[
                                        ...unitOptions.map((u) => ({ value: u, label: u })),
                                        ...(field.value && !unitListHas(unitOptions, field.value) ? [{ value: field.value, label: field.value }] : []),
                                      ]}
                                      value={field.value}
                                      disabled={itemFieldsDisabled}
                                      onChange={(val, newName) => {
                                        const unitVal = val === "add-new" ? (newName || "").trim() : val;
                                        markLineQtyDriven(line.id);
                                        field.onChange(unitVal);
                                        onPersistNewUnit(val, unitVal);
                                        const sel = allProcessedItems.find((i) => i.id === form.getValues(`lineItems.${index}.itemId`));
                                        if (sel && unitVal) {
                                          const newRate = getUnitBasedPrice(sel, unitVal, 'sale');
                                          form.setValue(`lineItems.${index}.rate`, newRate, { shouldDirty: true });
                                        }
                                      }}
                                      placeholder="Unit"
                                      addNewLabel="+ Add unit"
                                      triggerLabelMinCh={12}
                                    />
                                  </div>
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className={cn(TD_BASE, "flex items-center justify-end")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.rate`}
                            render={({ field }: any) => (
                              <div className="flex w-full min-w-0 items-center justify-end gap-1">
                                {/* Table rate: FormControl sirf Input — TooltipProvider Slot child Fragment `id` error */}
                                <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          {...field}
                                          onChange={(e) => {
                                            markLineQtyDriven(line.id);
                                            field.onChange(e);
                                          }}
                                          disabled={saleRateDisabled(index, itemFieldsDisabled)}
                                          className={cn(FLAT_INPUT, "min-w-0 flex-1 text-right", saleRateDisabled(index, itemFieldsDisabled) && 'bg-muted cursor-not-allowed')}
                                          title={
                                            !canEditRates
                                              ? "No role permission to edit rates"
                                              : !companyAllowsLineRateEdit
                                                ? "Sale rate editing is off in Voucher Settings"
                                                : watchedLineItems?.[index]?.allowManualRate === false
                                                  ? "Tick the checkbox to edit rate on this line"
                                                  : undefined
                                          }
                                        />
                                      </FormControl>
                                    </TooltipTrigger>
                                    {!isRateEditingAllowed && !canEditRates ? (
                                      <TooltipContent>
                                        <p>No permission to edit item rates</p>
                                      </TooltipContent>
                                    ) : !isRateEditingAllowed && canEditRates && !companyAllowsLineRateEdit ? (
                                      <TooltipContent>
                                        <p>Turn on &quot;Allow Rate Editing&quot; for Sale in Voucher Settings</p>
                                      </TooltipContent>
                                    ) : isRateEditingAllowed && watchedLineItems?.[index]?.allowManualRate === false ? (
                                      <TooltipContent>
                                        <p>Tick the checkbox next to rate to enable editing</p>
                                      </TooltipContent>
                                    ) : null}
                                  </Tooltip>
                                </TooltipProvider>
                                {isRateEditingAllowed && !itemFieldsDisabled && (
                                  <FormField
                                    control={form.control}
                                    name={`lineItems.${index}.allowManualRate`}
                                    render={({ field: manualRateField }: any) => (
                                      <FormItem className="m-0 shrink-0 space-y-0">
                                        <FormControl>
                                          <Checkbox
                                            checked={manualRateField.value !== false}
                                            onCheckedChange={(c) => manualRateField.onChange(c === true)}
                                            aria-label="Allow editing item rate on this line"
                                            title={manualRateField.value !== false ? "Rate edit enabled" : "Rate edit disabled"}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                )}
                              </div>
                            )}
                          />
                        </div>

                        <div className={cn(TD_BASE, "flex items-center justify-center")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.isTaxInclusive`}
                            render={({ field }: any) => (
                              <FormItem className="flex items-center shrink-0 m-0 space-y-0">
                                <FormControl>
                                  <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={itemFieldsDisabled} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <SalePurchaseTdsLineUi
                          control={form.control}
                          index={index}
                          side="sale"
                          showDefaultControl={!isEditing}
                          companyId={companyId || ""}
                          processedTaxes={processedTaxes}
                          taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                          disabled={itemFieldsDisabled}
                          onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                          variant="desktop-taxable"
                          flatInputClass={FLAT_INPUT}
                          taxableLabel={lineColLabels.taxable}
                          tdsLabel={lineColLabels.tds}
                          tdsAmountLabel={lineColLabels.tdsAmount}
                          tdsPlaceholder={lineColLabels.tds}
                        />
                        <SalePurchaseTdsLineUi
                          control={form.control}
                          index={index}
                          side="sale"
                          showDefaultControl={!isEditing}
                          companyId={companyId || ""}
                          processedTaxes={processedTaxes}
                          taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                          disabled={itemFieldsDisabled}
                          onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                          variant="desktop-tds"
                          flatInputClass={FLAT_INPUT}
                          taxableLabel={lineColLabels.taxable}
                          tdsLabel={lineColLabels.tds}
                          tdsAmountLabel={lineColLabels.tdsAmount}
                          tdsPlaceholder={lineColLabels.tds}
                        />
                        <SalePurchaseTdsLineUi
                          control={form.control}
                          index={index}
                          side="sale"
                          showDefaultControl={!isEditing}
                          companyId={companyId || ""}
                          processedTaxes={processedTaxes}
                          taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                          disabled={itemFieldsDisabled}
                          onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                          variant="desktop-tds-amt"
                          flatInputClass={FLAT_INPUT}
                          taxableLabel={lineColLabels.taxable}
                          tdsLabel={lineColLabels.tds}
                          tdsAmountLabel={lineColLabels.tdsAmount}
                          tdsPlaceholder={lineColLabels.tds}
                        />
                        <div className={cn(TD_BASE, "min-w-0")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.taxAccountId`}
                            render={({ field }: any) => (
                              <FormItem data-ocr-field="tax" className="w-full min-w-0">
                                <Combobox
                                  options={withSelectedHiddenTax(lineTaxComboboxOptions, processedTaxes, field.value)}
                                  value={field.value}
                                  disabled={itemFieldsDisabled}
                                  onChange={(val, newName) => {
                                    if (val === "add-new") {
                                      setTaxRowIndex(index);
                                      setIsCreateTaxOpen(true);
                                      setTimeout(() => {
                                          document.dispatchEvent(new CustomEvent('prefill-create-tax-name', { detail: newName }));
                                      }, 100);
                                    } else {
                                      field.onChange(val === "none" ? "" : val);
                                    }
                                  }}
                                  placeholder={lineColLabels.tax}
                                  addNewLabel="+ Add New Tax"
                                  {...SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS}
                                />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Tax Amount */}
                        <div className={cn(TD_BASE, "flex items-center justify-end")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.taxAmount`}
                            render={({ field }: any) => (
                              <FormControl>
                                <Input
                                  type="number"
                                  {...field}
                                  readOnly
                                  className={cn(FLAT_INPUT, "bg-muted text-right tabular-nums")}
                                />
                              </FormControl>
                            )}
                          />
                        </div>

                        {/* Amount */}
                        <div className={cn(TD_BASE, "flex items-center justify-end")}>
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.amount`}
                            render={({ field }: any) => {
                              const lineAmountEditable =
                                Boolean(watchedLineItems?.[index]?.itemId) && !itemFieldsDisabled;
                              return (
                              <FormControl>
                                <Input
                                  type="number"
                                  {...field}
                                  value={field.value ?? ""}
                                  readOnly={!lineAmountEditable}
                                  disabled={!lineAmountEditable}
                                  title={lineAmountEditable ? "Amount type karo — unit (base) aur qty auto fill" : "Pehle item select karo"}
                                  className={cn(
                                    FLAT_INPUT,
                                    "text-right tabular-nums",
                                    !lineAmountEditable && "bg-muted"
                                  )}
                                  onChange={(e) =>
                                    handleLineAmountChange(index, line.id, e.target.value, field.onChange)
                                  }
                                />
                              </FormControl>
                              );
                            }}
                          />
                        </div>

                        {fields.length > 1 ? (
                          <div className={cn(TD_BASE, "flex items-center")}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={itemFieldsDisabled}
                              onClick={() => remove(index)}
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )
                  );
                })}
                    {/* Add Line Button */}
                    <div className="border-t px-[2px] py-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={hasItemEditLock || deleteDisabledWhenLinked}
                        onClick={() => append(createEmptySaleLineItem(itemType))}
                      >
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Line
                      </Button>
                    </div>
                  </div>
                ) : (
                  // PC: wide layout ka horizontal scroll form ke scroll wale parent div me (footer fixed).
                  <div className={SALE_PURCHASE_DESKTOP_LINE_TABLE_INNER}>
                    <div
                      className={cn(
                        SALE_PURCHASE_DESKTOP_LINE_GRID_CLASS,
                        SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_DIVIDERS,
                        SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_FRAME
                      )}
                      style={desktopLineGridStyle}
                    >
                    <div className="contents">
                        <div className={cn(TH_BASE, SALE_PURCHASE_DESKTOP_LINE_ITEM_CELL, "flex items-center justify-between gap-1")}>
                          {/* Desktop: Item Copy visible ho to Item header red highlight. */}
                          <span className={cn("whitespace-nowrap", desktopHeaderCopyItem && "text-red-600 font-semibold")}>Item</span>
                          {desktopHeaderCopyItem && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-[10px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                              onClick={() => onCopyMissingCategory?.("item")}
                              disabled={isCopyingMissingMasters}
                            >
                              {isCopyingMissingMasters ? "…" : "Copy"}
                            </Button>
                          )}
                        </div>
                        <div className={cn(TH_BASE, "text-center")}>Qty</div>
                        <div className={cn(TH_BASE, "text-center")}>Unit</div>
                        <div className={cn(TH_BASE, "text-center")}>Rate</div>
                        <div className={cn(TH_BASE, "text-right")}>{lineColLabels.taxable}</div>
                        <div className={cn(TH_BASE, "flex items-center gap-1.5 text-left")}>
                          <span>{lineColLabels.tds}</span>
                          {(tds || 0) > 0 ? (
                            <SalePurchaseTdsVerifyTick
                              control={form.control}
                              // Linked bill-wise: amounts locked, TDS Verify still editable (no unlink needed)
                              disabled={editingDisabled}
                              compact
                            />
                          ) : null}
                        </div>
                        <div className={cn(TH_BASE, "text-right")}>{lineColLabels.tdsAmount}</div>
                        <div className={cn(TH_BASE, "flex items-center gap-1 min-w-0 flex-nowrap justify-end")}>
                          {/* Desktop: Tax Copy visible ho to Tax header red highlight. */}
                          <span className={cn("truncate font-semibold text-foreground min-w-0 flex-1 text-left", desktopHeaderCopyTax && "text-red-600")}>{lineColLabels.tax}</span>
                          {desktopHeaderCopyTax && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-[10px] border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                              onClick={() => onCopyMissingCategory?.("tax")}
                              disabled={isCopyingMissingMasters}
                            >
                              {isCopyingMissingMasters ? "…" : "Copy"}
                            </Button>
                          )}
                        </div>
                        <div className={cn(TH_BASE, "flex items-center justify-center gap-1 px-1 text-center")}>
                          {/* Header: Tax copy mismatch ho to Tax Inc label red; resolved case me normal. */}
                          <label htmlFor="all-inclusive" className={cn("cursor-pointer select-none text-sm font-semibold text-foreground", desktopHeaderCopyTax && "text-red-600")}>
                            Tax Inc.
                          </label>
                          <Checkbox
                            checked={(form.watch("lineItems") || []).every((li) => li.isTaxInclusive)}
                            onCheckedChange={handleToggleAllInclusive}
                            id="all-inclusive"
                          />
                        </div>
                        <div className={cn(TH_BASE, "text-right")}>{lineColLabels.taxAmount}</div>
                        <div className={cn(TH_BASE, "text-right")}>{lineColLabels.amount}</div>
                        {fields.length > 1 ? <div className={SALE_PURCHASE_DESKTOP_LINE_DELETE_HEADER} /> : null}
                    </div>
                      {/* Desktop Rows */}
                      {fields.map((line, index) => {
                        const selectedItem = allProcessedItems.find(
                          (i) => i.id === form.getValues(`lineItems.${index}.itemId`)
                        );
                        // When item selected: use item's units; else item-derived + persisted customUnits (creatable)
                        const unitOptions = saleLineUnitOptionsForItem(selectedItem, companyUnitsMerged);
                        // When payment linked, lock all item row fields (Item, Qty, Unit, Rate, Tax) in this desktop table view too.
                        const itemFieldsDisabled = hasItemEditLock || deleteDisabledWhenLinked;

                        return (
                          <div className="contents" key={line.id}>
                            <div className={cn(TD_BASE, "flex", SALE_PURCHASE_DESKTOP_LINE_BODY_CELL, SALE_PURCHASE_DESKTOP_LINE_ITEM_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.itemId`}
                                render={({ field }: any) => (
                                  <FormItem data-ocr-field="lines" className="w-full min-w-[2.5in] max-w-none space-y-0">
                                    <Combobox
                                      options={itemOptions}
                                      value={comboboxValueFromLineItemId(field.value)}
                                      disabled={itemFieldsDisabled}
                                      {...SALE_PURCHASE_LINE_ITEM_COMBOBOX_PROPS}
                                      onChange={(val, newName) => {
                                        if (val === "add-new") {
                                          setIsCreateItemOpen(true);
                                          setTimeout(() => {
                                            document.dispatchEvent(
                                              new CustomEvent("prefill-create-item-name", {
                                                detail: { name: newName, type: itemType },
                                              })
                                            );
                                          }, 100);
                                        } else {
                                          const itemId = lineItemIdFromComboboxValue(val);
                                          field.onChange(itemId);
                                          markLineQtyDriven(line.id);
                                          const sel = itemId
                                            ? allProcessedItems.find((i) => i.id === itemId)
                                            : undefined;
                                          if (sel) {
                                            const defaultUnit = getItemDefaultSaleUnit(sel);
                                            const rate = getUnitBasedPrice(sel, defaultUnit, 'sale');
                                            form.setValue(`lineItems.${index}.rate`, rate, { shouldDirty: true });
                                            form.setValue(`lineItems.${index}.unit`, defaultUnit, { shouldDirty: true });
                                            form.setValue(`lineItems.${index}.taxAccountId`, sel.saleTaxId || "", { shouldDirty: true });
                                            form.setValue(`lineItems.${index}.type`, itemType, { shouldDirty: true });
                                          }
                                        }
                                      }}
                                      placeholder={`Select ${itemType}`}
                                      addNewLabel={`+ Add New ${itemType === "item" ? "Item" : "Service"}`}
                                    />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.quantity`}
                                render={({ field }: any) => (
                                  <FormControl className="shrink-0">
                                    <Input type="number" {...field} step="0.000001" min={0} style={salePurchaseLineNumberInputStyle(field.value)} className={SALE_PURCHASE_LINE_NUMBER_INPUT_CLASS} disabled={itemFieldsDisabled} onChange={(e) => { markLineQtyDriven(line.id); field.onChange(e); }} />
                                  </FormControl>
                                )}
                              />
                            </div>

                            <div className={cn(TD_BASE, "flex", SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.unit`}
                                render={({ field }: any) => (
                                  <FormItem className="w-max min-w-max max-w-none space-y-0">
                                    <FormControl>
                                      <div className="[&_button]:h-[35px] [&_button]:text-xs">
                                        <Combobox
                                          options={[
                                            ...unitOptions.map((u) => ({ value: u, label: u })),
                                            ...(field.value && !unitListHas(unitOptions, field.value) ? [{ value: field.value, label: field.value }] : []),
                                          ]}
                                          value={field.value}
                                          disabled={itemFieldsDisabled}
                                          {...SALE_PURCHASE_LINE_DESKTOP_COMBOBOX_PROPS}
                                          onChange={(val, newName) => {
                                            const unitVal = val === "add-new" ? (newName || "").trim() : val;
                                            markLineQtyDriven(line.id);
                                            field.onChange(unitVal);
                                            onPersistNewUnit(val, unitVal);
                                            const sel = allProcessedItems.find((i) => i.id === form.getValues(`lineItems.${index}.itemId`));
                                            if (sel && unitVal) {
                                              const newRate = getUnitBasedPrice(sel, unitVal, 'sale');
                                              form.setValue(`lineItems.${index}.rate`, newRate, { shouldDirty: true });
                                            }
                                          }}
                                          placeholder="Unit"
                                          addNewLabel="+ Add unit"
                                        />
                                      </div>
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL, "gap-[2px]")}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.rate`}
                                render={({ field }: any) => (
                                  <div className="flex w-full min-w-0 items-stretch justify-end gap-[5px] pr-[5px]">
                                    {/* Flat table rate row — same FormControl/Tooltip order as upar */}
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <FormControl className="shrink-0">
                                            <Input
                                              type="number"
                                              {...field}
                                              onChange={(e) => {
                                                markLineQtyDriven(line.id);
                                                field.onChange(e);
                                              }}
                                              disabled={saleRateDisabled(index, itemFieldsDisabled)}
                                              style={salePurchaseLineNumberInputStyle(field.value)}
                                              className={cn(SALE_PURCHASE_LINE_NUMBER_INPUT_CLASS, saleRateDisabled(index, itemFieldsDisabled) && 'bg-muted cursor-not-allowed')}
                                              title={
                                                !canEditRates
                                                  ? "No role permission to edit rates"
                                                  : !companyAllowsLineRateEdit
                                                    ? "Sale rate editing is off in Voucher Settings"
                                                    : watchedLineItems?.[index]?.allowManualRate === false
                                                      ? "Tick the checkbox to edit rate on this line"
                                                      : undefined
                                              }
                                            />
                                          </FormControl>
                                        </TooltipTrigger>
                                        {!isRateEditingAllowed && !canEditRates ? (
                                          <TooltipContent>
                                            <p>No permission to edit item rates</p>
                                          </TooltipContent>
                                        ) : !isRateEditingAllowed && canEditRates && !companyAllowsLineRateEdit ? (
                                          <TooltipContent>
                                            <p>Turn on &quot;Allow Rate Editing&quot; for Sale in Voucher Settings</p>
                                          </TooltipContent>
                                        ) : isRateEditingAllowed && watchedLineItems?.[index]?.allowManualRate === false ? (
                                          <TooltipContent>
                                            <p>Tick the checkbox next to rate to enable editing</p>
                                          </TooltipContent>
                                        ) : null}
                                      </Tooltip>
                                    </TooltipProvider>
                                    {isRateEditingAllowed && !itemFieldsDisabled && (
                                      <FormField
                                        control={form.control}
                                        name={`lineItems.${index}.allowManualRate`}
                                        render={({ field: manualRateField }: any) => (
                                          <FormItem className="m-0 shrink-0 space-y-0">
                                            <FormControl>
                                              <Checkbox
                                                checked={manualRateField.value !== false}
                                                onCheckedChange={(c) => manualRateField.onChange(c === true)}
                                                aria-label="Allow editing item rate on this line"
                                                title={manualRateField.value !== false ? "Rate edit enabled" : "Rate edit disabled"}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />
                                    )}
                                  </div>
                                )}
                              />
                            </div>

                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <SalePurchaseTdsLineUi
                                control={form.control}
                                index={index}
                                side="sale"
                                showDefaultControl={!isEditing}
                                companyId={companyId || ""}
                                processedTaxes={processedTaxes}
                                taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                                disabled={itemFieldsDisabled}
                                onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                                variant="desktop-taxable"
                                flatInputClass={FLAT_INPUT}
                                taxableLabel={lineColLabels.taxable}
                                tdsLabel={lineColLabels.tds}
                                tdsAmountLabel={lineColLabels.tdsAmount}
                                tdsPlaceholder={lineColLabels.tds}
                              />
                            </div>
                            <div className={cn(TD_BASE, "flex", SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <SalePurchaseTdsLineUi
                                control={form.control}
                                index={index}
                                side="sale"
                                showDefaultControl={!isEditing}
                                companyId={companyId || ""}
                                processedTaxes={processedTaxes}
                                taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                                disabled={itemFieldsDisabled}
                                onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                                variant="desktop-tds"
                                flatInputClass={FLAT_INPUT}
                                taxableLabel={lineColLabels.taxable}
                                tdsLabel={lineColLabels.tds}
                                tdsAmountLabel={lineColLabels.tdsAmount}
                                tdsPlaceholder={lineColLabels.tds}
                              />
                            </div>
                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <SalePurchaseTdsLineUi
                                control={form.control}
                                index={index}
                                side="sale"
                                showDefaultControl={!isEditing}
                                companyId={companyId || ""}
                                processedTaxes={processedTaxes}
                                taxableAmount={lineTaxableBaseForTds({ amount: Number(watchedLineItems?.[index]?.amount ?? 0) })}
                                disabled={itemFieldsDisabled}
                                onRequestCreateTdsAccount={(prefillName) => openCreateTdsTaxDialog(index, prefillName)}
                                variant="desktop-tds-amt"
                                flatInputClass={FLAT_INPUT}
                                taxableLabel={lineColLabels.taxable}
                                tdsLabel={lineColLabels.tds}
                                tdsAmountLabel={lineColLabels.tdsAmount}
                                tdsPlaceholder={lineColLabels.tds}
                              />
                            </div>

                            <div className={cn(TD_BASE, "flex", SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.taxAccountId`}
                                render={({ field }: any) => (
                                  <FormItem data-ocr-field="tax" className="w-max min-w-max max-w-none space-y-0">
                                    <Combobox
                                      options={withSelectedHiddenTax(lineTaxComboboxOptions, processedTaxes, field.value)}
                                      value={field.value}
                                      disabled={itemFieldsDisabled}
                                      onChange={(val, newName) => {
                                        if (val === "add-new") {
                                          setTaxRowIndex(index);
                                          setIsCreateTaxOpen(true);
                                          setTimeout(() => {
                                            document.dispatchEvent(new CustomEvent('prefill-create-tax-name', { detail: newName }));
                                          }, 100);
                                        } else {
                                          field.onChange(val === "none" ? "" : val);
                                        }
                                      }}
                                      placeholder={lineColLabels.tax}
                                      addNewLabel="+ Add New Tax"
                                      {...SALE_PURCHASE_LINE_DESKTOP_COMBOBOX_PROPS}
                                    />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className={cn(TD_BASE, "flex", SALE_PURCHASE_DESKTOP_LINE_BODY_CELL, "flex items-center justify-center")}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.isTaxInclusive`}
                                render={({ field }: any) => (
                                  <FormItem className="flex items-center shrink-0 m-0 space-y-0">
                                    <FormControl>
                                      <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={itemFieldsDisabled} />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>

                            {/* Tax Amount */}
                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.taxAmount`}
                                render={({ field }: any) => (
                                  <FormControl className="inline-flex w-max shrink-0 justify-end">
                                    <Input
                                      {...SALE_PURCHASE_LINE_MONEY_INPUT_FIELD_PROPS}
                                      name={field.name}
                                      onBlur={field.onBlur}
                                      ref={field.ref}
                                      value={formatSalePurchaseLineMoneyDisplay(field.value)}
                                      style={salePurchaseLineMoneyInputStyle(field.value)}
                                      className={cn(SALE_PURCHASE_LINE_NUMBER_INPUT_CLASS, "bg-muted")}
                                    />
                                  </FormControl>
                                )}
                              />
                            </div>

                            {/* Amount */}
                            <div className={cn(SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                              <FormField
                                control={form.control}
                                name={`lineItems.${index}.amount`}
                                render={({ field }: any) => {
                                  const lineAmountEditable =
                                    Boolean(watchedLineItems?.[index]?.itemId) && !itemFieldsDisabled;
                                  return (
                                  <FormControl className="shrink-0">
                                    <SalePurchaseLineAmountInput
                                      name={field.name}
                                      value={field.value}
                                      readOnly={!lineAmountEditable}
                                      disabled={!lineAmountEditable}
                                      title={lineAmountEditable ? "Amount type karo — unit (base) aur qty auto fill" : "Pehle item select karo"}
                                      onBlur={field.onBlur}
                                      onRawChange={(raw) =>
                                        handleLineAmountChange(index, line.id, raw, field.onChange)
                                      }
                                    />
                                  </FormControl>
                                  );
                                }}
                              />
                            </div>

                            {fields.length > 1 ? (
                              <div className={cn(SALE_PURCHASE_DESKTOP_LINE_DELETE_CELL, SALE_PURCHASE_DESKTOP_LINE_BODY_CELL)}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={SALE_PURCHASE_DESKTOP_LINE_DELETE_BUTTON_CLASS}
                                  onClick={() => remove(index)}
                                  aria-label="Remove line"
                                  disabled={itemFieldsDisabled}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                      {/* Add Line Button - Desktop */}
                      <div className="border-t border-black px-2 py-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={hasItemEditLock || deleteDisabledWhenLinked}
                          onClick={() => append(createEmptySaleLineItem(itemType))}
                        >
                          <PlusCircle className="mr-2 h-4 w-4" /> Add Line
                        </Button>
                      </div>
                    </div>
                )}
              </div>

              {/* Bottom: Narration + Attach / Totals */}
              {isMobile ? (
                <div className="grid grid-cols-2 gap-3 w-[calc(100%-4px)] mx-auto px-[2px]">
                  {/* Mobile UX: line items ke turant baad Sub Total / Discount / Tax / Total — pehle scroll me totals dikhe, phir narration / files */}
                  <div className={SALE_PURCHASE_TOTALS_SUMMARY_BOX_MOBILE}>
                    <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "py-[3px] border-b")}>
                      <span className="text-xs shrink-0">Sub Total:</span>
                      <SalePurchaseTotalsSummaryAmount value={subTotal || 0} className="text-xs font-medium" />
                    </div>
                    <SalePurchaseDiscountAdjustmentRow
                      control={form.control}
                      showDefaultControl={!isEditing}
                      side="sale"
                      disabled={deleteDisabledWhenLinked}
                      expenseAccountOptions={discountExpenseAccountOptions}
                      variant="mobile"
                    />
                    <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "py-[3px] border-t")}>
                      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                        <FormLabel className="text-xs shrink-0">Tax:</FormLabel>
                        {selectedTax && (
                          <FormLabel className={cn("text-[10px] font-semibold truncate min-w-0", selectedTax.balance < 0 ? "text-red-600" : "text-green-600")}>
                            {selectedTax.balance < 0 ? `Pay: ${formatCurrencyForPrint(Math.abs(selectedTax.balance), { noSuffix: true, noAnimation: true })}` : `Rec: ${formatCurrencyForPrint(selectedTax.balance, { noSuffix: true, noAnimation: true })}`}
                          </FormLabel>
                        )}
                      </div>
                      <SalePurchaseTotalsSummaryAmount value={tax || 0} className="text-xs font-medium" />
                    </div>
                    {(tds || 0) > 0 && (
                      <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "py-[3px] border-t")}>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="text-xs shrink-0">TDS:</span>
                          <SalePurchaseTdsVerifyTick control={form.control} disabled={editingDisabled} compact showLabel />
                        </div>
                        <SalePurchaseTotalsSummaryAmount value={tds || 0} className="text-xs font-medium" />
                      </div>
                    )}
                    <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "py-[3px] border-t text-base font-bold")} data-ocr-field="total">
                      <span className="text-sm shrink-0">{(tds || 0) > 0 ? "Invoice Total:" : "Total:"}</span>
                      <SalePurchaseTotalsSummaryAmount value={total || 0} className="text-green-600 text-sm font-bold" />
                    </div>
                  </div>

                  {/* Narration + Due Date share one section color for clear grouping; fields stay white. */}
                  <div className="col-span-2 rounded-lg border border-amber-300/80 bg-amber-50 p-2">
                    <div className="px-[2px]">
                      <FormField
                        control={form.control}
                        name="narration"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="bill-no">
                            <FormLabel>Narration</FormLabel>
                            <FormControl>
                              {/* Mobile narration: chhoti default rows + shared resize/scroll (static PC) */}
                              <Textarea
                                placeholder="Add any notes for this bill..."
                                {...field}
                                rows={2}
                                className={cn("text-sm", VOUCHER_NARRATION_TEXTAREA_CLASS)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {showApprovalCheckbox && (
                      <div className="px-[2px] pt-2">
                        <FormField
                          control={form.control}
                          name="isApproved"
                          render={({ field }: any) => (
                            <FormItem className="flex flex-row items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={!!field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">Approved</FormLabel>
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                    {/* Mobile: Due Date + Important ek column — date jaisi pill row */}
                    <div className="flex flex-col gap-2 px-[2px] pt-2">
                    <div className={cn((dateSystem === 'BS' || dateSystem === 'Both') && "flex gap-1")}>
                      <FormField
                        control={form.control}
                        name="dueDate"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="due-date" className={cn("w-full", dateSystem === 'Both' && "flex-1 min-w-0")}>
                            <FormLabel className="text-sm">Due Date</FormLabel>
                            <div className={cn("flex w-full", dateSystem === 'Both' ? "flex-col gap-2" : "gap-1")}>
                              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                                <div className={cn("min-w-0", dateSystem === 'Both' ? "w-full" : "flex-1")}>
                                  <BsDatePicker
                                    valueAD={field.value}
                                    onChangeAD={(d) => { field.onChange(d as Date); }}
                                    isRange={false}
                                    numberOfMonths={1}
                                    className="h-9 text-sm w-full"
                                  />
                                </div>
                              )}
                              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                                <div className={cn("min-w-0", dateSystem === 'Both' ? "w-full" : "flex-1")}>
                                  <Popover open={isDueDateCalendarOpen} onOpenChange={setIsDueDateCalendarOpen}>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className={cn("w-full justify-start text-left font-normal text-sm", !field.value && "text-muted-foreground")}
                                        >
                                          <CalendarIcon className="mr-2 h-4 w-4" />
                                          {field.value ? formatDate(field.value) : "Pick date"}
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 z-[102]" align="start">
                                      <Calendar
                                        mode="single"
                                        selected={field.value ?? undefined}
                                        onSelect={(date) => { field.onChange(date); setIsDueDateCalendarOpen(false); }}
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                      <FormField
                        control={form.control}
                        name="overdueImportant"
                        render={({ field }: any) => (
                          <FormItem className="w-full">
                            {/* Due Date jaisi pill — Important text pill ke andar */}
                            <div className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted/85 px-3">
                              <FormControl>
                                <Checkbox
                                  id="create-sale-overdue-important-mobile"
                                  checked={!!field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <FormLabel
                                htmlFor="create-sale-overdue-important-mobile"
                                className="cursor-pointer text-sm font-normal leading-none"
                              >
                                Important
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  
                  {/* Mobile: Attach files in its own colored container for section-level visual grouping. */}
                  <div className="col-span-2 rounded-lg border border-indigo-300/80 bg-indigo-50 p-2">
                    <FormItem>
                      <FormLabel className="text-sm">Attach Files</FormLabel>
                      {showPdfAsImageToggle && (
                        <VoucherPdfAsImageToggle
                          existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                          id="voucher-save-pdf-as-image-sale-mobile"
                          checked={savePdfAsImage}
                          onCheckedChange={setSavePdfAsImage}
                          disabled={!allowAttachments || fileAttachLockedByDialog || fileAttachmentLimits.maxFileCount === 0}
                          className="mb-2"
                        />
                      )}
                      <VoucherOcrRefreshBar ocr={ocr} />
                      <RestrictedFileUploader>
                        {/* When linked: add/remove disabled; existing files stay clickable to open */}
                        <VoucherAttachmentPcDropRow
                          enabled={
                            allowAttachments &&
                            !fileAttachLockedByDialog &&
                            !editingDisabled &&
                            fileAttachmentLimits.maxFileCount > 0
                          }
                          companyId={companyId}
                          files={files}
                          setFiles={setFiles}
                          limits={fileAttachmentLimits}
                          toast={toast}
                          className="flex flex-wrap items-start gap-2 px-[2px]"
                        >
                          {files.map((file, index) => (
                            <FilePreview 
                              key={index} 
                              file={file} 
                              attachmentCompanyId={companyId || undefined}
                              attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                              onRemove={allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete ? () => setFiles(prev => prev.filter((_, i) => i !== index)) : undefined}
                              className={cn(
                                !allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : "",
                                VOUCHER_MOBILE_ATTACH_PREVIEW_CLASS
                              )}
                            />
                          ))}
                          {allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && files.length < fileAttachmentLimits.maxFileCount && (
                            <>
                              <AttachmentHoldPasteSurface
                                enabled={
                                  !editingDisabled &&
                                  !fileAttachLockedByDialog &&
                                  allowAttachments &&
                                  fileAttachmentLimits.maxFileCount > 0
                                }
                                onShortActivate={() => {
                                  if (editingDisabled) return;
                                  if (allowAttachments && fileAttachmentLimits.maxFileCount > 0) {
                                    fileInputRef.current?.click();
                                  }
                                }}
                                onPastedFiles={(incoming) =>
                                  void appendCompressedVoucherAttachmentsToState({
                                    companyId,
                                    incomingFiles: incoming,
                                    currentFiles: files,
                                    maxFiles: fileAttachmentLimits.maxFileCount || 0,
                                    allowImage: fileAttachmentLimits.allowImage,
                                    allowPDF: fileAttachmentLimits.allowPDF,
                                    setFiles,
                                    toast,
                                  })
                                }
                                voucherAttachmentReuse={{ currentFiles: files, setFiles, maxFiles: fileAttachmentLimits.maxFileCount }}
                                className={cn(
                                  VOUCHER_MOBILE_ATTACH_ADD_SURFACE_CLASS,
                                  allowAttachments && fileAttachmentLimits.maxFileCount > 0
                                    ? "text-muted-foreground hover:border-primary cursor-pointer"
                                    : "text-muted-foreground/50 border-muted-foreground/25 cursor-not-allowed opacity-50"
                                )}
                              >
                                <Upload className="h-4 w-4" />
                                <span className="text-[9px] mt-0.5">Add</span>
                              </AttachmentHoldPasteSurface>
                              <FormControl>
                                <Input
                                  type="file"
                                  className="hidden"
                                  ref={fileInputRef}
                                  onChange={handleFileChange}
                                  accept={
                                    [
                                      fileAttachmentLimits.allowImage ? "image/*" : "",
                                      fileAttachmentLimits.allowPDF ? "application/pdf" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(",") || "image/*,application/pdf"
                                  }
                                  multiple={fileAttachmentLimits.maxFileCount > 1}
                                  disabled={fileAttachLockedByDialog || !allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                                />
                              </FormControl>
                            </>
                          )}
                        </VoucherAttachmentPcDropRow>
                      </RestrictedFileUploader>
                    </FormItem>
                  </div>

                  {/* Bill wise link — totals ke baad narration/files; yahan sirf link UI */}
                  <div className="col-span-2 flex flex-col gap-[15px] w-full">
                    {/* Link for bill wise — same table/style as Payment (header bold black, table alignment, Amount green). Shown for both new and edit so user can link before/after save. */}
                    {shouldShowLinkButton && (
                      <div className="pb-1.5">
                        {/* Add mode: keep link sections collapsed until user explicitly opens via Show Link. */}
                        <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSections(true)}>Show Link</Button>
                      </div>
                    )}
                    {shouldShowBillWiseSection && (
                      <div className="bg-rose-50 rounded-lg border-2 border-rose-300/80 px-[2px] py-2 pb-[45px] space-y-1.5 w-full">
                        <div className="border-b border-border/60 pb-2">
                          <span className="text-xs font-semibold">{activeLinkSectionTitle}</span>
                          {billWiseLegs.length > 1 && (
                            <div className="flex gap-2 flex-wrap mt-1.5">
                              {billWiseLegs.map((leg) => {
                                const key = `${leg.kind}:${leg.accountId}`;
                                return (
                                  <label key={key} className="flex items-center gap-1.5 cursor-pointer text-xs">
                                    <input
                                      type="radio"
                                      name="saleBillWiseLinkLegMobile"
                                      checked={billWiseLinkLegKey === key}
                                      onChange={() => setBillWiseLinkLegKey(key)}
                                      className="rounded-full"
                                    />
                                    <span>{leg.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {company?.enableLinkPaymentToTxns && activeBillWiseLeg?.kind === "party" && (
                            <p className="text-xs text-blue-600 mt-1">
                              {activeLegLinkableCount > 0
                                ? `${activeLegLinkableCount} voucher${activeLegLinkableCount === 1 ? "" : "s"} available to link, so link 1st to save.`
                                : "You can save this voucher without linking, bcz no voucher to link."}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {`${activeLegLinkableCount} voucher(s) available to link.`}
                            {linkedAmountRows.length > 0 && ` ${linkedAmountRows.length} linked.`}
                          </p>
                        </div>
                        {linkedAmountRows.length > 0 && (
                          <div className="overflow-x-auto min-w-0 rounded-md border">
                            <table className="w-full text-[10px] border-collapse min-w-0">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left p-1.5 font-semibold text-black whitespace-nowrap">Date</th>
                                  <th className="text-left p-1.5 font-semibold text-black whitespace-nowrap">Voucher No.</th>
                                  <th className="text-right p-1.5 font-semibold text-black whitespace-nowrap">Amount</th>
                                  <th className="text-right p-1.5 font-semibold text-black whitespace-nowrap">Linked on others</th>
                                  <th className="text-right p-1.5 font-semibold text-black whitespace-nowrap">Linked on current</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linkedAmountRows.map((row, i) => {
                                  const isOB = row.paymentVoucherId === OPENING_BALANCE_VOUCHER_ID;
                                  const details = isOB ? null : paymentVoucherDetails.get(row.paymentVoucherId ?? "");
                                  const rowAmount = details?.total ?? row.amount;
                                  const linkedOnOthers = isOB ? 0 : Math.max(0, (details?.totalAllocated ?? 0) - row.amount);
                                  return (
                                    <tr
                                      key={i}
                                      {...(can("edit_link")
                                        ? { role: "button" as const, tabIndex: 0, className: "border-b border-border/30 last:border-b-0 cursor-pointer hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1", onClick: () => setIsLinkAdvancesOpen(true), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsLinkAdvancesOpen(true); } } }
                                        : { className: "border-b border-border/30 last:border-b-0" })}
                                    >
                                      <td className="p-1.5 text-muted-foreground whitespace-nowrap">{row.date ? (dateSystem === "BS" ? formatDateBS(row.date) : formatDate(row.date)) : "—"}</td>
                                      <td className="p-1.5 font-medium whitespace-nowrap">{row.voucherNumber || "—"}</td>
                                      <td className="p-1.5 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrencyForPrint(rowAmount, { noSuffix: true, noAnimation: true })}</td>
                                      <td className="p-1.5 text-right text-muted-foreground whitespace-nowrap">{formatCurrencyForPrint(linkedOnOthers, { noSuffix: true, noAnimation: true })}</td>
                                      <td className="p-1.5 text-right text-muted-foreground whitespace-nowrap">{formatCurrencyForPrint(row.amount, { noSuffix: true, noAnimation: true })}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="pt-2 border-t flex justify-end min-w-0">
                          <div className="grid grid-cols-2 gap-1.5 text-[10px] w-fit">
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center min-h-0 min-w-0 overflow-hidden">
                              <span className="text-muted-foreground truncate leading-tight">Total linked</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate text-right whitespace-nowrap leading-tight">{formatCurrencyForPrint(totalLinked, { noSuffix: true, noAnimation: true })}</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate leading-tight">Balance</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className={cn("truncate text-right whitespace-nowrap leading-tight", activeLegOutstanding <= 0 ? "text-green-600 font-semibold" : "")}>
                                {activeLegOutstanding <= 0 ? "Settled" : formatCurrencyForPrint(activeLegOutstanding, { noSuffix: true, noAnimation: true })}
                              </span>
                            </div>
                          </div>
                        </div>
                        {partyId && can("add_link") && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Button type="button" className="w-auto bg-green-600 hover:bg-green-700 text-white" onClick={() => setIsLinkAdvancesOpen(true)}>
                              <Link2 className="mr-2 h-4 w-4" /> {activeLinkButtonLabel}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setLinkSectionInfoOpen(true)} aria-label="Link section information">
                              <Info className="h-4 w-4 shrink-0" />
                              Read me
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                  {/* Desktop: Left: Narration + Due Date + Files */}
                  <div className="space-y-4 w-full">
                    {/* Desktop grouping: narration + due date in one colored container for same section identity. */}
                    <div className="rounded-lg border border-amber-300/80 bg-amber-50 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
                      <FormField
                        control={form.control}
                        name="narration"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="bill-no">
                            <FormLabel>Narration</FormLabel>
                            <FormControl>
                              {/* Desktop narration: lambi text ke liye resize-y + max-h scroll */}
                              <Textarea
                                placeholder="Add any notes for this bill..."
                                {...field}
                                className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {/* PC: Due Date column — date ke niche Important tick (overdue filter) */}
                      <div className="flex min-w-0 flex-col gap-2 md:w-[180px] md:max-w-[240px]">
                      {showApprovalCheckbox && (
                        <FormField
                          control={form.control}
                          name="isApproved"
                          render={({ field }: any) => (
                            <FormItem className="flex flex-row items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox checked={!!field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">Approved</FormLabel>
                            </FormItem>
                          )}
                        />
                      )}
                      <FormField
                        control={form.control}
                        name="dueDate"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="due-date" className={cn("w-full", dateSystem === 'Both' && "min-w-[160px]")}>
                            <FormLabel>Due Date</FormLabel>
                            <div className={cn("flex w-full", dateSystem === 'Both' ? "flex-col gap-2" : "gap-1")}>
                              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                                <div className={cn("min-w-0", dateSystem === 'Both' ? "w-full" : "flex-1")}>
                                  <BsDatePicker
                                    valueAD={field.value}
                                    onChangeAD={(d) => { field.onChange(d as Date); }}
                                    isRange={false}
                                    numberOfMonths={1}
                                    className="h-9 w-full"
                                  />
                                </div>
                              )}
                              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                                <div className={cn("min-w-0", dateSystem === 'Both' ? "w-full" : "flex-1")}>
                                  <Popover open={isDueDateCalendarOpen} onOpenChange={setIsDueDateCalendarOpen}>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button
                                          variant="outline"
                                          className={cn("w-full justify-start text-left font-normal h-9", !field.value && "text-muted-foreground")}
                                        >
                                          <CalendarIcon className="mr-2 h-4 w-4" />
                                          {field.value ? formatDate(field.value) : "Pick date"}
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 z-[102]" align="end">
                                      <Calendar
                                        mode="single"
                                        selected={field.value ?? undefined}
                                        onSelect={(date) => { field.onChange(date); setIsDueDateCalendarOpen(false); }}
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="overdueImportant"
                        render={({ field }: any) => (
                          <FormItem className="w-full">
                            {/* Due Date jaisi pill — Important text pill ke andar */}
                            <div className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted/85 px-3">
                              <FormControl>
                                <Checkbox
                                  id="create-sale-overdue-important-desktop"
                                  checked={!!field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <FormLabel
                                htmlFor="create-sale-overdue-important-desktop"
                                className="cursor-pointer font-normal leading-none"
                              >
                                Important
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                    </div>
                    </div>
                    {/* Desktop: Attach files gets a dedicated new color container (same grouping intent as mobile). */}
                    <div className="rounded-lg border border-indigo-300/80 bg-indigo-50 p-3">
                      <FormItem>
                        <FormLabel>Attach Files (Optional)</FormLabel>
                        {showPdfAsImageToggle && (
                          <VoucherPdfAsImageToggle
                            existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                            id="voucher-save-pdf-as-image-sale-desktop"
                            checked={savePdfAsImage}
                            onCheckedChange={setSavePdfAsImage}
                            disabled={!allowAttachments || fileAttachLockedByDialog || fileAttachmentLimits.maxFileCount === 0}
                            className="mb-2"
                          />
                        )}
                        <VoucherOcrRefreshBar ocr={ocr} />
                        <RestrictedFileUploader>
                          {/* When linked: add/remove disabled; existing files stay clickable to open */}
                          <VoucherAttachmentPcDropRow
                            enabled={
                              allowAttachments &&
                              !fileAttachLockedByDialog &&
                              !editingDisabled &&
                              fileAttachmentLimits.maxFileCount > 0
                            }
                            companyId={companyId}
                            files={files}
                            setFiles={setFiles}
                            limits={fileAttachmentLimits}
                            toast={toast}
                            className="flex flex-wrap items-start gap-4"
                          >
                            {files.map((file, index) => (
                              <FilePreview 
                                key={index} 
                                file={file} 
                                attachmentCompanyId={companyId || undefined}
                                attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                                onRemove={allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete ? () => setFiles(prev => prev.filter((_, i) => i !== index)) : undefined}
                                className={cn(
                                  !allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : "",
                                  VOUCHER_DESKTOP_ATTACH_PREVIEW_CLASS
                                )}
                              />
                            ))}
                            {allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && files.length < fileAttachmentLimits.maxFileCount && (
                              <>
                                <AttachmentHoldPasteSurface
                                  enabled={
                                    !editingDisabled &&
                                    !fileAttachLockedByDialog &&
                                    allowAttachments &&
                                    fileAttachmentLimits.maxFileCount > 0
                                  }
                                  onShortActivate={() => {
                                    if (editingDisabled) return;
                                    if (allowAttachments && fileAttachmentLimits.maxFileCount > 0) {
                                      fileInputRef.current?.click();
                                    }
                                  }}
                                  onPastedFiles={(incoming) =>
                                    void appendCompressedVoucherAttachmentsToState({
                                      companyId,
                                      incomingFiles: incoming,
                                      currentFiles: files,
                                      maxFiles: fileAttachmentLimits.maxFileCount || 0,
                                      allowImage: fileAttachmentLimits.allowImage,
                                      allowPDF: fileAttachmentLimits.allowPDF,
                                      setFiles,
                                      toast,
                                    })
                                  }
                                  voucherAttachmentReuse={{ currentFiles: files, setFiles, maxFiles: fileAttachmentLimits.maxFileCount }}
                                  className={cn(
                                    VOUCHER_DESKTOP_ATTACH_ADD_SURFACE_CLASS,
                                    allowAttachments && fileAttachmentLimits.maxFileCount > 0
                                      ? "text-muted-foreground hover:border-primary cursor-pointer"
                                      : "text-muted-foreground/50 border-muted-foreground/25 cursor-not-allowed opacity-50"
                                  )}
                                >
                                  <Upload className="h-6 w-6" />
                                  <span className="text-xs mt-1">Add File</span>
                                </AttachmentHoldPasteSurface>
                                <FormControl>
                                  <Input
                                    type="file"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    accept={
                                      [
                                        fileAttachmentLimits.allowImage ? "image/*" : "",
                                        fileAttachmentLimits.allowPDF ? "application/pdf" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(",") || "image/*,application/pdf"
                                    }
                                    multiple={fileAttachmentLimits.maxFileCount > 1}
                                    disabled={fileAttachLockedByDialog || !allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                                  />
                                </FormControl>
                              </>
                            )}
                          </VoucherAttachmentPcDropRow>
                        </RestrictedFileUploader>
                      </FormItem>
                    </div>
                  </div>

                  {/* Desktop: two containers — (1) Sub total to Total, (2) Link for bill wise — 15px gap, same as mobile */}
                  <div className="flex flex-col gap-[15px] w-full">
                    {/* Container 1: Sub total se total tak */}
                    <div className={SALE_PURCHASE_TOTALS_SUMMARY_BOX_DESKTOP}>
                      <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "font-medium py-[3px] border-b")}>
                        <span className="shrink-0">Sub Total:</span>
                        <SalePurchaseTotalsSummaryAmount value={subTotal || 0} />
                      </div>
                      <SalePurchaseDiscountAdjustmentRow
                        control={form.control}
                        showDefaultControl={!isEditing}
                        side="sale"
                        disabled={deleteDisabledWhenLinked}
                        expenseAccountOptions={discountExpenseAccountOptions}
                        variant="desktop"
                      />
                      <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "border-t py-[3px]")}>
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                          <FormLabel className="shrink-0">Tax:</FormLabel>
                          {selectedTax && (
                            <FormLabel className={cn("text-xs font-semibold truncate min-w-0", selectedTax.balance < 0 ? 'text-red-600' : 'text-green-600')}>
                              {selectedTax.balance < 0 ? `Payable: ${formatCurrencyForPrint(Math.abs(selectedTax.balance), { noSuffix: true, noAnimation: true })}` : `Receivable: ${formatCurrencyForPrint(selectedTax.balance, { noSuffix: true, noAnimation: true })}`}
                            </FormLabel>
                          )}
                        </div>
                        <SalePurchaseTotalsSummaryAmount value={tax || 0} />
                      </div>
                      {(tds || 0) > 0 && (
                        <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "border-t py-[3px]")}>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <FormLabel className="shrink-0">TDS:</FormLabel>
                            <SalePurchaseTdsVerifyTick control={form.control} disabled={editingDisabled} showLabel />
                          </div>
                          <SalePurchaseTotalsSummaryAmount value={tds || 0} />
                        </div>
                      )}
                      <div className={cn(SALE_PURCHASE_TOTALS_SUMMARY_ROW, "text-lg font-bold border-t py-[3px]")}>
                        <span className="shrink-0">{(tds || 0) > 0 ? "Invoice Total:" : "Total:"}</span>
                        <SalePurchaseTotalsSummaryAmount value={total || 0} className="text-green-600 font-bold" />
                      </div>
                    </div>
                    {/* Container 2: Link for bill wise — same table/style as Payment (header bold black, table alignment, Amount green). Shown for both new and edit so user can link before/after save. */}
                    {shouldShowLinkButton && (
                      <div className="pb-1">
                        {/* Edit (without links) and add mode: expose links on demand only. */}
                        <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSections(true)}>Show Link</Button>
                      </div>
                    )}
                    {shouldShowBillWiseSection && (
                      <div className="space-y-4 border-2 border-rose-300/80 rounded-lg px-[2px] py-4 pb-[45px] bg-rose-50 w-full">
                        <div className="border-b border-border/60 pb-2">
                          <span className="text-sm font-semibold">{activeLinkSectionTitle}</span>
                          {billWiseLegs.length > 1 && (
                            <div className="flex gap-2 flex-wrap mt-1.5">
                              {billWiseLegs.map((leg) => {
                                const key = `${leg.kind}:${leg.accountId}`;
                                return (
                                  <label key={key} className="flex items-center gap-1.5 cursor-pointer text-sm">
                                    <input
                                      type="radio"
                                      name="saleBillWiseLinkLegDesktop"
                                      checked={billWiseLinkLegKey === key}
                                      onChange={() => setBillWiseLinkLegKey(key)}
                                      className="rounded-full"
                                    />
                                    <span>{leg.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {company?.enableLinkPaymentToTxns && activeBillWiseLeg?.kind === "party" && (
                            <p className="text-sm text-blue-600 mt-1">
                              {activeLegLinkableCount > 0
                                ? `${activeLegLinkableCount} voucher${activeLegLinkableCount === 1 ? "" : "s"} available to link, so link 1st to save.`
                                : "You can save this voucher without linking, bcz no voucher to link."}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground mt-1">
                            {`${activeLegLinkableCount} voucher(s) available to link.`}
                            {linkedAmountRows.length > 0 && ` ${linkedAmountRows.length} linked.`}
                          </p>
                        </div>
                        {linkedAmountRows.length > 0 && (
                          <div className="overflow-x-auto min-w-0 rounded-md border">
                            <table className="w-full text-sm border-collapse min-w-0">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Date</th>
                                  <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Voucher No.</th>
                                  <th className="text-right p-2 font-semibold text-black whitespace-nowrap">Amount</th>
                                  <th className="text-right p-2 font-semibold text-black whitespace-nowrap">Linked on others</th>
                                  <th className="text-right p-2 font-semibold text-black whitespace-nowrap">Linked on current</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linkedAmountRows.map((row, i) => {
                                  const isOB = row.paymentVoucherId === OPENING_BALANCE_VOUCHER_ID;
                                  const details = isOB ? null : paymentVoucherDetails.get(row.paymentVoucherId ?? "");
                                  const rowAmount = details?.total ?? row.amount;
                                  const linkedOnOthers = isOB ? 0 : Math.max(0, (details?.totalAllocated ?? 0) - row.amount);
                                  return (
                                    <tr
                                      key={i}
                                      {...(can('edit_link')
                                        ? { role: "button" as const, tabIndex: 0, className: "border-b border-border/30 last:border-b-0 cursor-pointer hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1", onClick: () => setIsLinkAdvancesOpen(true), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsLinkAdvancesOpen(true); } } }
                                        : { className: "border-b border-border/30 last:border-b-0" })}
                                    >
                                      <td className="p-2 text-muted-foreground whitespace-nowrap">{row.date ? (dateSystem === "BS" ? formatDateBS(row.date) : formatDate(row.date)) : "—"}</td>
                                      <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber || "—"}</td>
                                      <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrencyForPrint(rowAmount, { noSuffix: true, noAnimation: true })}</td>
                                      <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrencyForPrint(linkedOnOthers, { noSuffix: true, noAnimation: true })}</td>
                                      <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrencyForPrint(row.amount, { noSuffix: true, noAnimation: true })}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="pt-2 border-t flex justify-end min-w-0">
                          <div className="grid grid-cols-2 gap-1.5 text-sm w-fit">
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center min-h-0 min-w-0 overflow-hidden">
                              <span className="text-muted-foreground truncate leading-tight">Total linked</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate text-right whitespace-nowrap leading-tight">{formatCurrencyForPrint(totalLinked, { noSuffix: true, noAnimation: true })}</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate leading-tight">Balance</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className={cn("truncate text-right whitespace-nowrap leading-tight", activeLegOutstanding <= 0 ? "text-green-600 font-semibold" : "")}>
                                {activeLegOutstanding <= 0 ? "Settled" : formatCurrencyForPrint(activeLegOutstanding, { noSuffix: true, noAnimation: true })}
                              </span>
                            </div>
                          </div>
                        </div>
                        {partyId && can('add_link') && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Button type="button" className="w-auto bg-green-600 hover:bg-green-700 text-white" onClick={() => setIsLinkAdvancesOpen(true)}>
                              <Link2 className="mr-2 h-4 w-4" /> {activeLinkButtonLabel}
                            </Button>
                            {/* Read me to the right of Link to Cr, inside the link section box */}
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setLinkSectionInfoOpen(true)} aria-label="Link section information">
                              <Info className="h-4 w-4 shrink-0" />
                              Read me
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className={cn(
            "border-t min-w-0 max-w-full overflow-x-hidden",
            isMobile ? "mt-[3px] pt-[3px] pb-[3px] w-[calc(100%-4px)] mx-auto px-[2px]" : "pt-4 flex flex-row justify-between items-center px-[2px] gap-4"
          )}>
            {isMobile ? (
              <div className={cn("grid grid-cols-3 gap-2 w-full min-w-0", VOUCHER_BUTTONS_CLASS)}>
                {/* Row 0: Delete (left) | History (middle) | Save & Print (right) */}
                <Button type="button" variant="destructive" className="w-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                      Delete
                    </Button>
                <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || !showHistoryButton || !onOpenHistory} className={cn("w-full", BTN_HISTORY_CLASS)}>
                  History
                </Button>
                <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_PRINT_CLASS)}>
                  Save & Print
                </Button>
                {/* Row 1: Cancel (left) | Save (middle) | Approve (right) — primary save center, approve dhilo ma */}
                <Button type="button" onClick={() => { setPendingLinkAllocations(null); onVoucherAction?.('cancelled'); }} className={cn("w-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_SAVE_CLASS)}>
                  {isLoading ? "..." : isEditingAndConverting ? "Convert" : "Save"}
                </Button>
                <Button type="button" onClick={showSaveAndApproveOnCreate && !voucher?.id ? (e: React.MouseEvent) => handleFormSubmit(e as unknown as React.FormEvent, { approveAfterSave: true }) : ((isFormDirty || isEditingAndConverting) ? (e: React.MouseEvent) => handleFormSubmit(e as unknown as React.FormEvent, { approveAfterSave: true }) : (onApprove ?? (() => {})))} disabled={showSaveAndApproveOnCreate && !voucher?.id ? (isLoading || isAttachmentProcessing || isApproving || editingDisabled) : (isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting))} className={cn("w-full", BTN_APPROVE_CLASS)}>
                  {isApproving ? "..." : (showSaveAndApproveOnCreate && !voucher?.id ? "Save & Approve" : (isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve"))}
                </Button>
              </div>
            ) : (
              <>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || !showHistoryButton || !onOpenHistory} className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}>
                    <History className="mr-2 h-4 w-4" /> History
                  </Button>
                  <Button type="button" variant="destructive" className="shrink-0 rounded-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                </div>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={() => { setPendingLinkAllocations(null); onVoucherAction?.('cancelled'); }} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={!!isEditing || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save &amp; New
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}>
                    <Printer className="mr-2 h-4 w-4" />
                    Save & Print
                  </Button>
                  <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty && !isEditingAndConverting)} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditingAndConverting ? "Convert" : "Save"}
                  </Button>
                  <Button type="button" onClick={showSaveAndApproveOnCreate && !voucher?.id ? (e: React.MouseEvent) => handleFormSubmit(e as unknown as React.FormEvent, { approveAfterSave: true }) : ((isFormDirty || isEditingAndConverting) ? (e: React.MouseEvent) => handleFormSubmit(e as unknown as React.FormEvent, { approveAfterSave: true }) : (onApprove ?? (() => {})))} disabled={showSaveAndApproveOnCreate && !voucher?.id ? (isLoading || isAttachmentProcessing || isApproving || editingDisabled) : (isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting))} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                    {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    {showSaveAndApproveOnCreate && !voucher?.id ? "Save & Approve" : (isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </form>
      </Form>

      {convertPresentation ? (
        <VoucherEditConvertConfirmDialog
          open={convertConfirmOpen}
          onOpenChange={setConvertConfirmOpen}
          bannerText={convertPresentation.bannerText}
          onConfirm={confirmConvertSubmit}
        />
      ) : null}
      
      <CreatePartyDialog
        onPartyCreated={(id) => {
          pendingPartyIdUntilInPartiesListRef.current = id;
          setIsCreatePartyOpen(false);
          form.setValue("partyId", id);
        }}
        isOpen={isCreatePartyOpen}
        onOpenChange={setIsCreatePartyOpen}
      />

      <CreateItemDialog
        onOpenChange={setIsCreateItemOpen}
        onItemCreated={(id) => {
            setIsCreateItemOpen(false);
            if(fields.length > 0) {
                form.setValue(`lineItems.${fields.length-1}.itemId`, id);
            }
        }}
        isOpen={isCreateItemOpen}
        defaultType={itemType}
      />

      <CreateTaxDialog
        onTaxCreated={handleTaxCreated}
        isOpen={isCreateTaxOpen}
        onOpenChange={setIsCreateTaxOpen}
      />
      <CreateExpenseAccountDialog
        // On create, immediately select newly created account in Sales Account field.
        onExpenseAccountCreated={(id) => form.setValue("salesAccountId", id)}
        isOpen={isCreateExpenseAccountOpen}
        onOpenChange={setIsCreateExpenseAccountOpen}
        defaultGroupType="income"
      />
      {partyId && activeBillWiseLeg && (
        <LinkAdvancesToVoucherDialog
          isOpen={isLinkAdvancesOpen}
          onOpenChange={setIsLinkAdvancesOpen}
          mode="sale"
          vouchersOverride={vouchers}
          targetVoucherId={voucher?.id ?? savedVoucherId ?? ""}
          targetPartyId={partyId}
          targetPartyName={processedParties.find((p) => p.id === partyId)?.name ?? "Party"}
          targetLabel={`Sale #${form.watch("voucherNumber") || ""}`}
          balanceKind={activeLinkBalanceKind}
          linkLegKind={activeBillWiseLeg.kind}
          linkAccountId={activeBillWiseLeg.accountId}
          linkAccountLabel={activeBillWiseLeg.label}
          targetOutstandingOverride={activeLegOutstanding}
          targetTotalAmount={Number(activeBillWiseLeg.totalAmount) || 0}
          partyOpeningBalance={
            activeBillWiseLeg.kind === "party"
              ? processedParties.find((p) => p.id === partyId)?.openingBalance ?? 0
              : 0
          }
          onConfirm={(payload) => {
            // Keep links local until voucher Save — otherwise edit dirty/Save stay disabled.
            const linkedAmounts =
              payload.linkedAmounts && Object.keys(payload.linkedAmounts).length > 0
                ? { ...payload.linkedAmounts }
                : {};
            billWiseLinksPersistedOnDialogRef.current = false;
            setPendingLinkAllocations(linkedAmounts);
            setPendingLinkLeg({
              kind: activeBillWiseLeg.kind,
              accountId: activeBillWiseLeg.accountId,
            });
            setIsLinkAdvancesOpen(false);
          }}
          initialLinkedAmounts={
            pendingMatchesActiveLeg
              ? pendingLinkAllocations ?? undefined
              : effectiveLinkedAmountsForDialog
          }
        />
      )}
      <LinkSectionInfoDialog open={linkSectionInfoOpen} onOpenChange={setLinkSectionInfoOpen} />
      <VoucherDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="sale"
        entityName={voucher?.voucherNumber || form.watch("voucherNumber") || "this sale"}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
        busy={isLoading}
      />
    </>
  );
}
