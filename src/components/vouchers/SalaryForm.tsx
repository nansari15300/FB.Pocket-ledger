"use client";

import { useReconciledPointGuard } from "@/components/vouchers/ReconciledPointGuardContext";
import { addDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import { isPlaceholderNoneTax } from "@/lib/salePurchaseLineColumnLabels";
import { shouldMoveVoucherConvertSourceToBin } from "@/lib/voucherEditConvert";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";
import type { DateRange } from "@/components/ui/ad-calendar";
import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Resolver, useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useId,
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
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Checkbox } from "../ui/checkbox";
import { SalePurchaseTdsVerifyTick, TdsVerifyTickBox } from "@/components/vouchers/SalePurchaseTdsVerifyTick";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { CalendarIcon, Loader2, PlusCircle, Trash2, Printer, Upload, FileText, ArrowDownUp, UserPlus, Link2, Zap, X, RotateCcw, HelpCircle, History, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { format, startOfDay } from "date-fns";
import { toast as sonnerToast } from "sonner";
import {
  beginVoucherSaveLoadingOrBlock,
  dismissAllVoucherProgressLoadingToasts,
  voucherSaveErrorToast,
  VOUCHER_SAVE_LOADING_TOAST_ID,
} from "@/lib/voucherSaveUi";
import { dispatchVoucherLivePatch } from "@/lib/voucherFormAttachmentSave";
import { notifyBrowserDbCollectionUpdated } from "@/lib/localCompanyDocMirror";

import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/hooks/useCompany";
import { getAddSalaryLinkAllocation } from "@/lib/linkAllocationSettings";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { useVouchers } from "@/hooks/useVouchers";
import { saveVoucher, isVoucherLimitError, patchVoucherFields, softDeleteVoucherMoveToRecycleBin, voucherRecycleBinDeletedAt } from "@/lib/voucherActionsClient";
import { loadVoucherDataForDeletePreCheck, resolveVoucherDeleteBackdateDate } from "@/lib/voucherDeletePreCheck";
import { isLocalOnlyMode } from "@/lib/localMode";
import { shouldReadLedgerFromSqliteOnly } from "@/lib/companyStorageKind";
import { normalizePrefix } from "@/lib/voucherNumberFormat";
import { getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import {
  applyVoucherAttachmentsAfterFormSave,
  finalizeVoucherAttachmentsAfterFormSave,
  uploadVoucherAttachmentFileToFirebase,
  voucherAttachmentFieldsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import { sendTransactionAlert, isAmountOverOneLakh, getChangedFieldLabels } from "@/lib/transactionAlerts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResetLinkStateOnCopyTargetCompany } from "@/hooks/useResetLinkStateOnCopyTargetCompany";
import { useCopyDraftFirstSave } from "@/hooks/useCopyDraftFirstSave";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_PC_DATE_ROW, VOUCHER_PC_DATE_BOTH_SLOT, VOUCHER_PC_DATE_BS_PILL, VOUCHER_PC_DATE_AD_PILL } from "@/components/vouchers/voucherButtonStyles";
import { getPaymentOutRemaining, getTaxFromAllocation, getNetFromAllocation, getTaxableFromAllocation, getJournalStaffDrAmount, getJournalRemainingForStaff, getJournalTaxDrAmount, getJournalRemainingForTax, isSalaryBillWiseSourceVoucher, hasPaymentLinks, getAllocationTotal, buildBillWiseEntityTxnId, allocationEntityTxnId, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import type { Allocation } from "@/lib/payment-allocation-utils";

import { firestore, storage } from "@/lib/plClientSession";
import { collection, query, where, serverTimestamp, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { getDocs, getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";

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
import { attachmentMaxBytes, attachmentStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
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
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import { CreateBankAccountDialog } from "../bank-cash/CreateBankAccountDialog";
// Types only — runtime circular import SalaryForm ↔ AddVoucherDialog avoid.
import type { CopyMasterDraftRequestPayload, CopyMissingMasterOpts } from "./AddVoucherDialog";
import usePermissions from "@/hooks/usePermissions";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";
import type { Staff } from "@/components/staff/types";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { isLoanLiabilityStaff } from "@/modules/loans/utils/loanLiabilityStaff";
import type { ExpenseAccount } from "../expenses/types";
import { CreateExpenseAccountDialog } from "../expenses/CreateExpenseAccountDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


const lineItemSchema = z.object({
  staffId: z.string().min(1, "Staff member is required."),
  salary: z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    },
    z
      .number({ message: "Salary amount is required." })
      .positive("Salary amount must be greater than 0.")
  ),
  narration: z.string().optional(),
  type: z.enum(["debit", "credit"]),
  taxAccountId: z.string().optional(),
  taxAmount: z.coerce.number(),
  /** Tax/TDS selected — party/tax/staff ledger pe Verified / Unverified */
  isTdsVerified: z.boolean().optional().default(false),
  afterTaxSalary: z.coerce.number(),
  rate: z.coerce.number(),
});

const fileSchema = z.object({
  file: z.custom<File | null>().optional(),
});


const formSchema = z.object({
  voucherNumber: z.string().min(1, "Voucher number is required."),
  date: z.date(),
  debitAccountId: z.string().min(1, "Debit account is required."),
  narration: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one salary entry is required."),
  total: z.coerce.number(),
  accountId: z.string().optional(), // For Pay Salary mode
  files: z.array(fileSchema).optional(),
  unassignedFile: z.any().optional(),
});

type SalaryFormValues = z.infer<typeof formSchema>;

/** RHF+zod errors → toast */
function formatSalaryFormValidationErrors(errors: FieldErrors<SalaryFormValues>): string {
  const errorMessages: string[] = [];
  if (errors.voucherNumber?.message) errorMessages.push(`Voucher No.: ${errors.voucherNumber.message}`);
  if (errors.date?.message) errorMessages.push(`Date: ${errors.date.message}`);
  if (errors.debitAccountId?.message) errorMessages.push(`Debit account: ${errors.debitAccountId.message}`);
  if (errors.lineItems?.message) errorMessages.push(`Lines: ${errors.lineItems.message}`);
  if (errors.total?.message) errorMessages.push(`Total: ${errors.total.message}`);
  return errorMessages.length > 0 ? errorMessages.join(", ") : "Please check all fields and try again.";
}

type SalaryLinkBalanceKind = "tax" | "net";

type SalaryLinkMap = Record<string, { taxAmount: number; netAmount: number }>;

const getSalaryLinkAmountByKind = (
  amounts: { taxAmount: number; netAmount: number },
  kind: SalaryLinkBalanceKind
): number => {
  if (kind === "tax") return Number(amounts.taxAmount) || 0;
  return Number(amounts.netAmount) || 0;
};

const getSalaryLinkAmountFromAllocation = (a: Allocation, kind: SalaryLinkBalanceKind): number => {
  if (kind === "tax") return getTaxFromAllocation(a);
  // Legacy taxableAmount links (mistaken earlier tab) count as after-tax/net.
  return getNetFromAllocation(a) + getTaxableFromAllocation(a);
};

const normaliseSalaryLinkMap = (map: SalaryLinkMap): SalaryLinkMap => {
  const entries = (Object.entries(map) as Array<[string, { taxAmount: number; netAmount: number }]>)
    .map(([id, amounts]) => [id, { taxAmount: Number(amounts.taxAmount) || 0, netAmount: Number(amounts.netAmount) || 0 }] as [string, { taxAmount: number; netAmount: number }])
    .filter(([, amounts]) => amounts.taxAmount > 0 || amounts.netAmount > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
};

const areSalaryLinkMapsEqual = (a: SalaryLinkMap, b: SalaryLinkMap): boolean => {
  const normA = normaliseSalaryLinkMap(a);
  const normB = normaliseSalaryLinkMap(b);
  const aKeys = Object.keys(normA);
  const bKeys = Object.keys(normB);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const left = normA[key];
    const right = normB[key];
    return !!right && left.taxAmount === right.taxAmount && left.netAmount === right.netAmount;
  });
};

const getVoucherPrefix = (
  prefixes?: Record<string, string[]>,
  isPayment?: boolean
) => {
  const key = isPayment ? "pay_salary" : "add_salary";
  return (
    (prefixes?.[key] && prefixes[key][0]) || (isPayment ? "PYSAL-" : "ADSAL-")
  );
};


const getInitialFormValues = (
  voucher?: any,
  processedStaff?: Staff[],
  processedTaxes?: any[]
): SalaryFormValues => {
  if (!voucher) {
    return {
      voucherNumber: "",
      date: startOfDay(new Date()),
      debitAccountId: "",
      narration: "",
      lineItems: [],
      total: 0,
      accountId: "",
      files: [],
      unassignedFile: null,
    };
  }

  const isSalaryJournal =
    voucher.type === "journal" && voucher.subType === "add_salary";

  let lineItems: any[] = [];
  if (isSalaryJournal) {
    const rawEntries = voucher.entries || [];
    // Copy-To remap kabhi `accountId` "" kar deta hai — purana filter `!e.accountId` se row gir jaati thi; isliye yahan sirf "salary credit" shape dekho.
    const taxSatelliteLines = rawEntries.filter((e: any) => {
      const nar = String(e.narration || "");
      if (!nar.includes("(Staff ID:")) return false;
      return Number(e.credit) > 0 || Number(e.debit) > 0;
    });
    const staffEntries = rawEntries.filter((e: any) => {
      const credit = Number(e.credit) || 0;
      if (credit <= 0) return false;
      const nar = String(e.narration || "");
      if (nar.includes("(Staff ID:")) return false;
      if (e.accountId && processedTaxes?.some((pt: any) => pt.id === e.accountId)) return false;
      return true;
    });

    lineItems = staffEntries.map((staffEntry: any, rowIndex: number) => {
      const staffCredit = staffEntry.credit || 0;
      const staffMemberId = staffEntry.accountId;
      const allEnt = voucher.entries || [];
      const sidMarker = `(Staff ID: ${staffMemberId})`;
      let taxEntry =
        allEnt.find((taxE: any) =>
          processedTaxes?.some((pt) => pt.id === taxE.accountId) && String(taxE.narration || "").includes(sidMarker)
        ) ||
        allEnt.find(
          (taxE: any) =>
            String(taxE.narration || "").includes(sidMarker) && Number(taxE.credit || taxE.debit) > 0
        );
      // Staff id remap-clear: sidMarker "(Staff ID: )" tax dhundh nahi paata — satellite tax line same index se jodo (typical 1-row).
      if (!taxEntry && !String(staffMemberId || "").trim() && taxSatelliteLines[rowIndex]) {
        taxEntry = taxSatelliteLines[rowIndex];
      }

      const taxAmount = Number(taxEntry?.credit) || Number(taxEntry?.debit) || 0;
      const grossSalary = staffCredit + taxAmount;

      return {
        staffId: staffEntry.accountId,
        salary: grossSalary,
        narration: staffEntry.narration,
        type: "credit" as const,
        taxAccountId: taxEntry?.accountId || "",
        taxAmount: taxAmount,
        isTdsVerified: taxEntry?.isTdsVerified === true,
        afterTaxSalary: staffCredit,
        rate: 0,
      };
    });
  }

  const debitEntry = voucher.entries?.find((e: any) => e.debit > 0);

  // Copy-to-company seed me date kabhi Timestamp / ISO / missing — InvalidDate se BS picker khali rehta tha.
  const rawDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date as string | number | Date);
  const safeDate = Number.isFinite(rawDate.getTime()) ? rawDate : startOfDay(new Date());

  return {
    ...voucher,
    date: safeDate,
    total: voucher.total || voucher.amount,
    debitAccountId: debitEntry?.accountId || "",
    lineItems,
    accountId: voucher.accountId || "",
    files: [],
    unassignedFile: voucher.unassignedFile || null,
  };
};


export function SalaryForm({
  voucher,
  onVoucherAction,
  onOpenHistory,
  showHistoryButton,
  initialMode = "add_salary",
  defaultVoucherData,
  editingDisabled = false,
  deleteDisabledWhenLinked = false,
  showApproveButton = false,
  showSaveAndApproveOnCreate = false,
  onApprove,
  isApproving = false,
  onEffectiveLinksChange,
  copySaveTargetCompanyId,
  /** Save & Copy To: naam-match na hone par red field + Copy chip (Debit / Staff / Tax). */
  copyMismatchCategories,
  onCopyMissingCategory,
  copyMasterDraftRequest,
  onRefreshCopyMismatch,
  isCopyingMissingMasters = false,
  recurringVoucherSaveBlocked = false,
  recurringVoucherAuxiliaryDirty = false,
}: {
  voucher?: any;
  onVoucherAction?: (status: 'saved' | 'cancelled', isSaveAndNew?: boolean, newId?: string) => void;
  onOpenHistory?: () => void;
  showHistoryButton?: boolean;
  initialMode?: "add_salary" | "payment_out";
  defaultVoucherData?: any;
  editingDisabled?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onApprove?: () => void;
  isApproving?: boolean;
  /** Report effective has-links (bill-wise) so dialog locks fields as soon as user links in this session. */
  onEffectiveLinksChange?: (hasLinks: boolean | undefined) => void;
  copySaveTargetCompanyId?: string;
  copyMismatchCategories?: string[];
  onCopyMissingCategory?: (category: string, opts?: CopyMissingMasterOpts) => void;
  copyMasterDraftRequest?: CopyMasterDraftRequestPayload | null;
  onRefreshCopyMismatch?: () => void | Promise<void>;
  isCopyingMissingMasters?: boolean;
  /** Auto Monthly ON bina Settings save: main Save / Save&Approve block (AddVoucherDialog se). */
  recurringVoucherSaveBlocked?: boolean;
  /** Header switch committed template se alag ho to form pristine ho tab bhi Save enable (e.g. ON→OFF). */
  recurringVoucherAuxiliaryDirty?: boolean;
}) {
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  const { toast } = useToast();
  const { user, customUser } = useAuth();
  const { formatCurrency, formatCurrencyForPrint, formatDate, formatDateBS, dateSystem } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedStaff, processedTaxes, expenseAccounts, processedAccounts, processedExpenseAccounts } = useVouchers();
  const salaryStaffOptions = useMemo(
    () => processedStaff.filter((s) => !isLoanLiabilityStaff(s)).map((s) => ({ value: s.id, label: s.name })),
    [processedStaff]
  );
  const { company, companyId } = useCompany();
  const { can, role, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const reconGuard = useReconciledPointGuard();
  const fileAttachLockedByDialog = !!voucher?.id && deleteDisabledWhenLinked;
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("party");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachFileInputId = useId();
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [createStaffDefaultName, setCreateStaffDefaultName] = useState("");
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = useState(false);
  const [files, setFiles] = useState<(File|string)[]>([]);
  /** Salary attach previews: stable `string[]` prop — warna interval re-render = blob revoke flicker. */
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
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLinkPaymentDialogOpen, setIsLinkPaymentDialogOpen] = useState(false);
  // Show-link toggle keeps link card collapsed in add/new and non-linked edits.
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [linkPaymentAmounts, setLinkPaymentAmounts] = useState<Record<string, number>>({});
  const [linkPaymentSaving, setLinkPaymentSaving] = useState(false);
  const [autoLinkSaving, setAutoLinkSaving] = useState(false);
  // Default salary link mode: After Tax Salary (net) selected first.
  const [linkBalanceKind, setLinkBalanceKind] = useState<SalaryLinkBalanceKind>("net");
  /** Latest openingBalanceAllocated for this salary voucher, kept in state so edit-mode form save cannot overwrite DONE changes with stale props. */
  const [latestOBAllocated, setLatestOBAllocated] = useState<number>(Number((voucher as any)?.openingBalanceAllocated) || 0);
  /** Local-first bill-wise link draft; sync to server only on main Save like party bill-wise flow. */
  const [localSalaryLinkMap, setLocalSalaryLinkMap] = useState<SalaryLinkMap>({});
  /** Prevent stale Firestore snapshots from wiping unsaved local bill-wise DONE changes. */
  const [hasLocalBillWiseDraftEdits, setHasLocalBillWiseDraftEdits] = useState(false);
  const initialSalaryLinkMapRef = useRef<SalaryLinkMap>({});
  const initialOBAllocatedRef = useRef<number>(Number((voucher as any)?.openingBalanceAllocated) || 0);
  const resetLinksOnCopyTargetChange = useCallback(() => {
    setLocalSalaryLinkMap({});
    initialSalaryLinkMapRef.current = {};
    setLatestOBAllocated(0);
    initialOBAllocatedRef.current = 0;
    setHasLocalBillWiseDraftEdits(false);
    setLinkPaymentAmounts({});
    setShowLinkSection(false);
    setIsLinkPaymentDialogOpen(false);
    onEffectiveLinksChange?.(false);
  }, [onEffectiveLinksChange]);
  useResetLinkStateOnCopyTargetCompany(copySaveTargetCompanyId, resetLinksOnCopyTargetChange);
  const {
    resolveVoucherIdForSave,
    isPermissionEdit,
    markCopiedDraftPersisted,
    isCopiedDraftFirstInsert,
  } = useCopyDraftFirstSave(copySaveTargetCompanyId);
  /** Skip reset when same voucher updates (liveVoucher) and user has edits — fixes unlink → change fields → save. */
  const lastResetVoucherIdRef = useRef<string | null>(null);

  const [activeLineIndex, setActiveLineIndex] = React.useState<number | null>(null);
  /** Tab-switch / remount par stale `copyMasterDraftRequest` se create dialog auto-open na ho — sirf nayi request par. */
  const hasInitializedCopyRequestRef = useRef(false);
  /** Copy/create ke baad `processedExpenseAccounts` listener sync se pehle — Copy chip + combobox placeholder na dikhe. */
  const pendingDebitAccountIdUntilInListRef = useRef<string | null>(null);
  const pendingDebitAccountLabelRef = useRef<string>("");
  const pendingStaffIdUntilInStaffListRef = useRef<string | null>(null);
  const pendingTaxIdUntilInTaxesListRef = useRef<string | null>(null);

  const openCreateStaffDialog = React.useCallback((lineIndex: number, newName?: string) => {
    setActiveLineIndex(lineIndex);
    setCreateStaffDefaultName(newName ?? "");
    // Open on next tick so the combobox popover click does not immediately close the dialog.
    setTimeout(() => setIsCreateStaffOpen(true), 0);
  }, []);

  const isPaymentMode = initialMode === "payment_out";
  const isEditing = !!voucher;
  const isEditingAndConverting = voucher && (voucher.type !== 'journal' || voucher.subType !== 'add_salary');
  const isFormEditing = !voucher || isEditing;

  const form = useForm<SalaryFormValues>({
    resolver: zodResolver(formSchema) as Resolver<SalaryFormValues>,
    defaultValues: getInitialFormValues(voucher || defaultVoucherData, processedStaff, processedTaxes),
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.salary(),
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((company as { name?: string } | null)?.name) || null,
    companyId: companyId,
    ownPan: ((company as { pan?: string; panNumber?: string } | null)?.pan ?? (company as { panNumber?: string } | null)?.panNumber) || null,
    parties: ([]) as never,
    items: [],
    taxes: (processedTaxes || []) as never,
    autoPost: () => void handleFormSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing: !!(voucher as { id?: string } | null | undefined)?.id,
    disabled: !!editingDisabled,
  });
  
  const [savedVoucherIdRef, setSavedVoucherIdRef] = useState<string | null>(voucher?.id || null);

  useEffect(() => {
        setLoading(vouchersLoading);

    }, [vouchersLoading, companyId]);

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });
  
  const typeKey = isPaymentMode ? "pay_salary" : "add_salary";
  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.[typeKey] ?? true;
  const isVoucherEditingAllowed = company?.allowVoucherNumberEditing?.[typeKey] ?? false;
  const isPrefixSelectionEnabled = company?.enableVoucherPrefixSelection?.[typeKey] ?? false;
  const voucherPrefixes = useMemo(() => company?.voucherPrefixes?.[typeKey] || [getVoucherPrefix(company?.voucherPrefixes, isPaymentMode)], [company, typeKey, isPaymentMode]);

  const fetchVoucherNumber = useCallback(async (selectedPrefix?: string) => {
    if (!companyId || !company) return;

    const autoEnabled = company?.autoVoucherNumbering?.[typeKey] ?? true;
    if (!autoEnabled) return;

    const voucherType = isPaymentMode ? "payment_out" : "journal";
    const subType = isPaymentMode ? "pay_salary" : "add_salary";

    try {
      const nextNo = await getNextVoucherNumberForCompany({
        companyId,
        companyDoc: company as Record<string, unknown>,
        voucherLike: { type: voucherType, subType },
        selectedPrefix:
          selectedPrefix ||
          company?.voucherPrefixes?.[typeKey]?.[0] ||
          getVoucherPrefix(company?.voucherPrefixes, isPaymentMode),
        voucherDate: form.getValues("date"),
      });
      form.setValue("voucherNumber", nextNo);
    } catch (error) {
      console.error("Error generating voucher number:", error);
    }
  }, [company, companyId, form, isPaymentMode, typeKey]);


    useEffect(() => {
        const isEditingExisting = !!voucher?.id;
        if (isEditingExisting) {
            const vid = voucher.id;
            const isSameVoucher = lastResetVoucherIdRef.current === vid;
            const initialValues = getInitialFormValues(voucher, processedStaff, processedTaxes);
            const hydratedLen = initialValues.lineItems?.length ?? 0;
            const currentLen = (form.getValues("lineItems") ?? []).length;
            // Pehli reset par staff/tax lists khali → lineItems []; lists load hone ke baad dubara hydrate karna zaroori — purana `isSameVoucher` early-return isko rokta tha.
            const needsLateHydration = isSameVoucher && hydratedLen > 0 && currentLen === 0;
            if (isSameVoucher && !needsLateHydration) return;
            lastResetVoucherIdRef.current = vid;
            // Existing salary voucher edit: hydrate full form + linked files from saved voucher.
            form.reset(initialValues);
            setSavedVoucherIdRef(voucher.id);
            const initialUrls = voucherAttachmentUrlsForFormState(voucher);
            setFiles(initialUrls);
            initialFilesRef.current = initialUrls.filter((f): f is string => typeof f === "string");
            setSavePdfAsImage(shouldSuggestPdfAsImage(initialUrls));
            // Sync local OB allocation from the loaded voucher for edit mode.
            setLatestOBAllocated(Number((voucher as any)?.openingBalanceAllocated) || 0);
            // Fresh voucher load should start without pending local draft overrides.
            setHasLocalBillWiseDraftEdits(false);
            return;
        }
        // Naya salary + defaultVoucherData: sirf ek baar hydrate — pehle `files` dep + har rerun par `setFiles` se attach mitt ti thi (Payment In jaisa fix).
        if (defaultVoucherData) {
            const seedValues = getInitialFormValues(defaultVoucherData, processedStaff, processedTaxes);
            const seedLines = seedValues.lineItems?.length ?? 0;
            const curNewLen = (form.getValues("lineItems") ?? []).length;
            const needsLateSeedHydration =
              lastResetVoucherIdRef.current === "new" && seedLines > 0 && curNewLen === 0;
            if (lastResetVoucherIdRef.current === "new" && !needsLateSeedHydration) {
                return;
            }
            lastResetVoucherIdRef.current = "new";
            const initialValues = seedValues;
            form.reset(initialValues);
            const urls = voucherAttachmentUrlsForFormState(defaultVoucherData);
            setFiles(urls);
            initialFilesRef.current = urls.filter((f: any) => typeof f === "string");
            setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
            setLatestOBAllocated(Number((defaultVoucherData as any)?.openingBalanceAllocated) || 0);
            setHasLocalBillWiseDraftEdits(false);
        } else {
            lastResetVoucherIdRef.current = null;
        }
    }, [voucher?.id, defaultVoucherData, processedStaff, processedTaxes, form, localSalaryLinkMap, latestOBAllocated]);

  const prevLinkDialogOpenRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    if ((!voucher || isEditingAndConverting) && companyId && isMounted) {
        fetchVoucherNumber().catch(console.error);
    }
    return () => { isMounted = false };
  }, [voucher, companyId, fetchVoucherNumber, isEditingAndConverting]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(voucher?.id && savedVoucherIdRef && !isEditingAndConverting),
    shouldFetchNextOnDateChange: Boolean((!voucher?.id || isEditingAndConverting) && isAutoVoucherEnabled),
    fetchVoucherNumber,
    resolvePrefix: () =>
      resolvePrefixFromVoucherNumber(
        String(form.getValues("voucherNumber") || ""),
        voucherPrefixes,
        voucherPrefixes[0]
      ),
  });

  const handleSelectAllStaff = () => {
    const currentStaffIds = new Set(form.getValues("lineItems").map((l) => l.staffId));
    processedStaff.forEach((staff) => {
      if (!currentStaffIds.has(staff.id)) {
        const salary = Number(staff.salary) || 0;
        append({
          staffId: staff.id,
          salary,
          // Auto-fill row narration from selected staff for faster salary entry.
          narration: `Add salary for ${staff.name}`,
          type: "credit",
          taxAccountId: "",
          taxAmount: 0,
          isTdsVerified: false,
          afterTaxSalary: salary,
          rate: 0
        });
      }
    });
  };
  
   const handleTaxCreated = (newTaxId: string) => {
    if(activeLineIndex !== null) {
      pendingTaxIdUntilInTaxesListRef.current = newTaxId;
      form.setValue(`lineItems.${activeLineIndex}.taxAccountId`, newTaxId);
    }
    setIsCreateTaxOpen(false);
    void onRefreshCopyMismatch?.();
  }

  const handleStaffCreated = (newStaffId: string) => {
    if (activeLineIndex !== null) {
      pendingStaffIdUntilInStaffListRef.current = newStaffId;
      const createdStaff = processedStaff.find((s) => s.id === newStaffId);
      // Keep narration aligned with the selected/created staff account name.
      update(activeLineIndex, {
        ...fields[activeLineIndex],
        staffId: newStaffId,
        narration: createdStaff ? `Add salary for ${createdStaff.name}` : fields[activeLineIndex]?.narration || "",
      });
    }
    setIsCreateStaffOpen(false);
    void onRefreshCopyMismatch?.();
  };
  
   const handleExpenseAccountCreated = (newAccountId: string) => {
    pendingDebitAccountIdUntilInListRef.current = newAccountId;
    form.setValue("debitAccountId", newAccountId);
    setIsCreateExpenseOpen(false);
    void onRefreshCopyMismatch?.();
  };

  /** Apply bill-wise link changes locally; actual server sync happens only when the main voucher is saved. */
  const applyLocalBillWiseLinks = useCallback((nextAmounts: Record<string, number>) => {
    setLocalSalaryLinkMap((prevMap) => {
      const effectiveMap: SalaryLinkMap = { ...prevMap };
      const allKnownIds = new Set<string>([
        ...Object.keys(prevMap),
        ...Object.keys(nextAmounts).filter((id) => id !== OPENING_BALANCE_VOUCHER_ID),
      ]);
      allKnownIds.forEach((paymentOutId) => {
        const prev = effectiveMap[paymentOutId] ?? { taxAmount: 0, netAmount: 0 };
        const newAmount = Number(nextAmounts[paymentOutId] ?? 0);
        const nextTax = linkBalanceKind === "tax" ? newAmount : Number(prev.taxAmount) || 0;
        const nextNet = linkBalanceKind === "net" ? newAmount : Number(prev.netAmount) || 0;
        if (nextTax <= 0 && nextNet <= 0) {
          delete effectiveMap[paymentOutId];
        } else {
          effectiveMap[paymentOutId] = { taxAmount: nextTax, netAmount: nextNet };
        }
      });
      return normaliseSalaryLinkMap(effectiveMap);
    });
    // Tax-mode dialog does not edit staff opening-balance links — keep existing OB allocation.
    if (linkBalanceKind !== "tax") {
      setLatestOBAllocated(Number(nextAmounts[OPENING_BALANCE_VOUCHER_ID] ?? 0) || 0);
    }
  }, [linkBalanceKind]);

  const handleLinkPayment = () => {
    const paymentOutIdsToUpdate = new Set<string>([
      ...Object.keys(linkPaymentAmounts).filter((id) => id !== OPENING_BALANCE_VOUCHER_ID),
      ...linkedPayments.map((p) => p.id),
    ]);
    const hasOBToSave = linkBalanceKind !== "tax" && obLinkState.showOBRow;
    if (paymentOutIdsToUpdate.size === 0 && !hasOBToSave) {
      sonnerToast.info("Enter amount(s) to link or edit.");
      return;
    }
    // Validate: no link amount > that source's remaining (payment out remaining or OB linkable)
    for (const row of paymentOutsForLinkDialog) {
      const amt = Number(linkPaymentAmounts[row.id] ?? 0);
      const remaining = row.remaining ?? 0;
      if (amt > remaining) {
        const label = row.id === OPENING_BALANCE_VOUCHER_ID ? "Opening Balance" : (row.voucherNumber ?? "Payment");
        sonnerToast.error("Cannot save minus balance", {
          description: `${label} has linkable ${formatCurrency(remaining, { noSuffix: true, noAnimation: true })}. Link amount cannot exceed linkable.`,
        });
        return;
      }
    }
    const totalLinkAmount = Object.values(linkPaymentAmounts).reduce((s, a) => s + Number(a || 0), 0);
    if (totalLinkAmount > totalForView) {
      sonnerToast.error("Cannot save minus balance", {
        description: `Total link amount (${formatCurrency(totalLinkAmount, { noSuffix: true, noAnimation: true })}) cannot exceed voucher ${linkBalanceKind === "tax" ? "tax" : "after tax salary"} total (${formatCurrency(totalForView, { noSuffix: true, noAnimation: true })}).`,
      });
      return;
    }
    applyLocalBillWiseLinks(linkPaymentAmounts);
    // Mark unsaved local bill-wise draft so server re-hydration cannot clear it before main Save.
    setHasLocalBillWiseDraftEdits(true);
    sonnerToast.success("Bill-wise link updated locally. Save voucher to sync.");
    setIsLinkPaymentDialogOpen(false);
  };

  const handleAutoLink = async () => {
    const outstanding = totalForView - totalLinked;
    if (outstanding <= 0) {
      sonnerToast.info(linkBalanceKind === "tax" ? "Tax balance is already fully linked." : "After tax salary is already fully linked.");
      return;
    }
    if (linkSourcesOldestFirst.length === 0) {
      sonnerToast.info("No payments or journal vouchers with remaining amount to link.");
      return;
    }
    setAutoLinkSaving(true);
    try {
      const suggested: Record<string, number> = {};
      linkedPayments.forEach((p) => { suggested[p.id] = getSalaryLinkAmountByKind(p, linkBalanceKind); });
      let remainingToAllocate = outstanding;
      if (
        linkBalanceKind !== "tax" &&
        obLinkState.showOBRow &&
        remainingToAllocate > 0 &&
        obLinkState.obLinkable > 0
      ) {
        const fromOB = Math.min(obLinkState.obLinkable, remainingToAllocate);
        suggested[OPENING_BALANCE_VOUCHER_ID] = fromOB;
        remainingToAllocate -= fromOB;
      }
      for (const po of linkSourcesOldestFirst) {
        if (remainingToAllocate <= 0) break;
        const allocate = Math.min(po.remaining, remainingToAllocate);
        if (allocate <= 0) continue;
        suggested[po.id] = (suggested[po.id] ?? 0) + allocate;
        remainingToAllocate -= allocate;
      }
      applyLocalBillWiseLinks(suggested);
      // Mark unsaved local bill-wise draft so server re-hydration cannot clear it before main Save.
      setHasLocalBillWiseDraftEdits(true);
      sonnerToast.success("Auto link applied locally. Save voucher to sync.");
    } catch (e) {
      console.error(e);
      sonnerToast.error("Failed to auto link.");
    } finally {
      setAutoLinkSaving(false);
    }
  };

  const watchedLineItems = useWatch({ control: form.control, name: "lineItems" });
  const staffIdsFromSalary = useMemo(
    () => [...new Set(((watchedLineItems ?? []) as any[]).map((l: any) => l.staffId).filter(Boolean))],
    [watchedLineItems]
  );
  const taxAccountIdsFromSalary = useMemo(
    () =>
      [
        ...new Set(
          ((watchedLineItems ?? []) as any[])
            .map((l: any) => String(l?.taxAccountId || "").trim())
            .filter(Boolean)
        ),
      ],
    [watchedLineItems]
  );
  const salaryLinkTaxLabel = useMemo(() => {
    if (!taxAccountIdsFromSalary.length) return "Tax";
    const names = taxAccountIdsFromSalary
      .map((id) => {
        const t = processedTaxes.find((x: any) => String(x.id) === id);
        return String((t as any)?.name || (t as any)?.label || "").trim();
      })
      .filter(Boolean);
    return names.length ? names.join(", ") : "Tax";
  }, [taxAccountIdsFromSalary, processedTaxes]);
  const isTaxBillWiseLinkMode = linkBalanceKind === "tax";

  /** Push the current local bill-wise draft to source vouchers only after the salary voucher itself is saved. */
  const syncSalaryBillWiseLinks = useCallback(async (salaryVoucherId: string) => {
    if (!companyId || !salaryVoucherId) return;
    const voucherPath = `companies/${companyId}/vouchers`;
    const desiredMap = normaliseSalaryLinkMap(localSalaryLinkMap);
    const isLocalMode = isLocalOnlyMode() || shouldReadLedgerFromSqliteOnly(company);
    const sourceVoucherIds = new Set<string>([
      ...Object.keys(initialSalaryLinkMapRef.current),
      ...Object.keys(desiredMap),
    ]);
    const primaryStaffId = String(staffIdsFromSalary[0] || "");
    const taxAccountIds = [
      ...new Set(
        ((watchedLineItems ?? []) as any[])
          .map((l: any) => String(l?.taxAccountId || "").trim())
          .filter(Boolean)
      ),
    ];
    const primaryTaxAccountId = taxAccountIds[0] || "";

    const upsertLeg = (
      allocations: Allocation[],
      leg: Allocation
    ): Allocation[] => {
      const et = allocationEntityTxnId(leg);
      const idx = allocations.findIndex((a) => {
        if (String(a.voucherId) !== String(salaryVoucherId)) return false;
        if (et && allocationEntityTxnId(a) === et) return true;
        if (et && !allocationEntityTxnId(a)) {
          // Replace legacy single row when writing first scoped leg
          return true;
        }
        return false;
      });
      if (idx >= 0) {
        const next = [...allocations];
        next[idx] = leg;
        return next;
      }
      return [...allocations, leg];
    };

    const removeSalaryLegs = (allocations: Allocation[]): Allocation[] =>
      allocations.filter((a) => String(a.voucherId) !== String(salaryVoucherId));

    for (const paymentOutId of sourceVoucherIds) {
      let data: any = null;
      let poRef: any = null;
      if (isLocalMode) {
        // Local mode me bill-wise source vouchers local list se resolve karo.
        data = allVouchers.find((v: any) => v.id === paymentOutId) || null;
        if (!data) continue;
      } else {
        poRef = doc(firestore, voucherPath, paymentOutId);
        const snap = await getDoc(poRef);
        if (!snap.exists()) continue;
        data = snap.data();
      }
      let allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
      const desired = desiredMap[paymentOutId] ?? { taxAmount: 0, netAmount: 0 };
      if (desired.taxAmount <= 0 && desired.netAmount <= 0) {
        const filtered = removeSalaryLegs(allocations);
        if (filtered.length !== allocations.length) {
          if (isLocalMode) {
            await patchVoucherFields(companyId, paymentOutId, { allocations: filtered });
          } else {
            await updateDoc(poRef, { allocations: filtered });
          }
        }
        continue;
      }
      const isJournalSource = data?.type === "journal" && data?.subType !== "add_salary";
      const staffIdForLink =
        (isJournalSource
          ? staffIdsFromSalary.find((sid) => getJournalStaffDrAmount(data, sid) != null)
          : undefined) ||
        primaryStaffId ||
        String(data?.staffId || "");

      // Drop prior legs for this salary voucher, then write entity-scoped staff + tax rows.
      allocations = removeSalaryLegs(allocations);
      if (desired.netAmount > 0 && staffIdForLink) {
        allocations = upsertLeg(allocations, {
          voucherId: salaryVoucherId,
          amount: desired.netAmount,
          netAmount: desired.netAmount,
          linkedAccountId: staffIdForLink,
          entityTxnId: buildBillWiseEntityTxnId({
            voucherId: salaryVoucherId,
            entityKind: "staff",
            accountId: staffIdForLink,
          }),
        });
      }
      if (desired.taxAmount > 0 && primaryTaxAccountId) {
        allocations = upsertLeg(allocations, {
          voucherId: salaryVoucherId,
          amount: desired.taxAmount,
          taxAmount: desired.taxAmount,
          linkedAccountId: primaryTaxAccountId,
          entityTxnId: buildBillWiseEntityTxnId({
            voucherId: salaryVoucherId,
            entityKind: "tax",
            accountId: primaryTaxAccountId,
          }),
        });
      } else if (desired.taxAmount > 0) {
        // Tax amount without known tax account — keep taxAmount field for soft-read
        allocations = upsertLeg(allocations, {
          voucherId: salaryVoucherId,
          amount: desired.taxAmount,
          taxAmount: desired.taxAmount,
        });
      }
      if (isLocalMode) {
        await patchVoucherFields(companyId, paymentOutId, { allocations });
      } else {
        await updateDoc(poRef, { allocations });
      }
    }
    if (isLocalMode) {
      // Salary voucher ka OB allocation bhi local-first path se update karo.
      await patchVoucherFields(companyId, salaryVoucherId, { openingBalanceAllocated: Number(latestOBAllocated) || 0 });
    } else {
      await updateDoc(doc(firestore, voucherPath, salaryVoucherId), { openingBalanceAllocated: Number(latestOBAllocated) || 0 });
    }
    initialSalaryLinkMapRef.current = desiredMap;
    initialOBAllocatedRef.current = Number(latestOBAllocated) || 0;
    // Local draft is now synced to server after main Save.
    setHasLocalBillWiseDraftEdits(false);
  }, [companyId, localSalaryLinkMap, latestOBAllocated, allVouchers, staffIdsFromSalary, watchedLineItems, company]);

  useEffect(() => {
    const currentLineItems = form.getValues("lineItems") || [];
    currentLineItems.forEach((item, index) => {
        const taxAccount = processedTaxes.find(t => t.id === item.taxAccountId);
        const taxRate = (taxAccount?.rate || 0) / 100;
        const salary = Number(item.salary) || 0;
        const taxAmount = salary * taxRate;
        const afterTaxSalary = salary - taxAmount;

        const currentTaxAmount = Number(form.getValues(`lineItems.${index}.taxAmount`) || 0).toFixed(2);
        const currentAfterTaxSalary = Number(form.getValues(`lineItems.${index}.afterTaxSalary`) || 0).toFixed(2);

        if (currentTaxAmount !== taxAmount.toFixed(2)) {
            form.setValue(`lineItems.${index}.taxAmount`, taxAmount, { shouldValidate: true });
        }
        if (currentAfterTaxSalary !== afterTaxSalary.toFixed(2)) {
            form.setValue(`lineItems.${index}.afterTaxSalary`, afterTaxSalary, { shouldValidate: true });
        }
    });

    const totalAmount = (form.getValues("lineItems") || []).reduce(
      (sum, item) => sum + (Number(item.salary) || 0), 0
    );
    if(form.getValues('total') !== totalAmount) {
        form.setValue('total', totalAmount);
    }
  }, [watchedLineItems, processedTaxes, form]);

  const { totalSalary, totalTaxAmount, totalAfterTaxSalary } = useMemo(() => {
    const totals = (watchedLineItems || []).reduce(
      (acc, item) => {
        acc.totalSalary += Number(item.salary) || 0;
        acc.totalTaxAmount += Number(item.taxAmount) || 0;
        acc.totalAfterTaxSalary += Number(item.afterTaxSalary) || 0;
        return acc;
      },
      { totalSalary: 0, totalTaxAmount: 0, totalAfterTaxSalary: 0 }
    );
    return totals;
  }, [watchedLineItems]);

  type LinkedPaymentRow = { id: string; voucherNumber?: string; date: unknown; taxAmount: number; netAmount: number };
  const { linkedPayments: serverLinkedPayments } = useMemo(() => {
    if (isPaymentMode) return { linkedPayments: [] as LinkedPaymentRow[], totalLinkedTax: 0, totalLinkedNet: 0 };
    const salaryVoucherId = voucher?.id ?? savedVoucherIdRef;
    if (!salaryVoucherId || !allVouchers?.length) return { linkedPayments: [] as LinkedPaymentRow[], totalLinkedTax: 0, totalLinkedNet: 0 };
    const staffSet = new Set(staffIdsFromSalary);
    const sourceVouchers = allVouchers.filter((v: any) => {
      if (!isSalaryBillWiseSourceVoucher(v)) return false;
      if (v.type === "payment_out" || v.type === "direct_expense") {
        return v.staffId && staffSet.has(v.staffId);
      }
      if (v.type === "journal") {
        return staffIdsFromSalary.some((sid) => getJournalStaffDrAmount(v, sid) != null);
      }
      return false;
    });
    const list: LinkedPaymentRow[] = [];
    for (const po of sourceVouchers) {
      const allocations = (po.allocations as Allocation[] | undefined) || [];
      for (const a of allocations) {
        if (a.voucherId !== salaryVoucherId) continue;
        if (po.type === "journal") {
          const lid = String((a as any).linkedAccountId ?? "");
          if (lid && !staffSet.has(lid)) continue;
        }
        const taxAmt = getTaxFromAllocation(a);
        const netAmt = getNetFromAllocation(a) + getTaxableFromAllocation(a);
        if (taxAmt <= 0 && netAmt <= 0) continue;
        list.push({
          id: po.id,
          voucherNumber: po.voucherNumber,
          date: po.date,
          taxAmount: taxAmt,
          netAmount: netAmt,
        });
      }
    }
    return { linkedPayments: list, totalLinkedTax: 0, totalLinkedNet: 0 };
  }, [voucher?.id, savedVoucherIdRef, allVouchers, isPaymentMode, staffIdsFromSalary]);
  const billWiseLinkDirty = !areSalaryLinkMapsEqual(localSalaryLinkMap, initialSalaryLinkMapRef.current) || latestOBAllocated !== initialOBAllocatedRef.current;
  useEffect(() => {
    // While local draft has unsaved DONE changes, ignore stale server snapshots.
    if (isPaymentMode || billWiseLinkDirty || hasLocalBillWiseDraftEdits) return;
    const nextMap = Object.fromEntries(
      serverLinkedPayments.map((p) => [p.id, { taxAmount: Number(p.taxAmount) || 0, netAmount: Number(p.netAmount) || 0 }])
    ) as SalaryLinkMap;
    // After local Save we already know the intended bill-wise state. Do not let a stale server snapshot clear the card before Firestore catches up.
    if (!areSalaryLinkMapsEqual(nextMap, initialSalaryLinkMapRef.current) && Object.keys(initialSalaryLinkMapRef.current).length > 0) {
      return;
    }
    // Refresh local draft from server only when there are no unsaved bill-wise changes.
    setLocalSalaryLinkMap(nextMap);
    initialSalaryLinkMapRef.current = nextMap;
    const serverOB = Number((voucher as any)?.openingBalanceAllocated) || 0;
    setLatestOBAllocated(serverOB);
    initialOBAllocatedRef.current = serverOB;
  }, [isPaymentMode, billWiseLinkDirty, hasLocalBillWiseDraftEdits, serverLinkedPayments, voucher]);

  const linkedPayments = useMemo(() => {
    return Object.entries(localSalaryLinkMap)
      .map(([id, amounts]) => {
        const target = allVouchers?.find((v: any) => v.id === id);
        return {
          id,
          voucherNumber: target?.voucherNumber ?? target?.voucher_number ?? "—",
          date: target?.date ?? null,
          taxAmount: Number(amounts.taxAmount) || 0,
          netAmount: Number(amounts.netAmount) || 0,
        } as LinkedPaymentRow;
      })
      .filter((p) => p.taxAmount > 0 || p.netAmount > 0)
      .sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dB - dA;
      });
  }, [localSalaryLinkMap, allVouchers]);
  const totalLinkedTax = linkedPayments.reduce((s, p) => s + p.taxAmount, 0);
  const totalLinkedNet = linkedPayments.reduce((s, p) => s + p.netAmount, 0);
  const totalLinked = linkBalanceKind === "tax" ? totalLinkedTax : totalLinkedNet;
  const totalForView = linkBalanceKind === "tax" ? totalTaxAmount : totalAfterTaxSalary;
  const billWiseLinkedTotal =
    (linkBalanceKind === "tax" ? totalLinkedTax : totalLinkedNet) +
    (Number(latestOBAllocated) || 0);
  const billWiseRemainingTotal = Math.max(0, totalForView - billWiseLinkedTotal);
  const selectedLinkTotal = Object.values(linkPaymentAmounts).reduce((s, a) => s + Number(a || 0), 0);
  const salaryRemainingToLink = Math.max(0, totalForView - selectedLinkTotal);
  const linkedPaymentsForView = useMemo(
    () => linkedPayments.map((p) => ({ ...p, amount: getSalaryLinkAmountByKind(p, linkBalanceKind) })).filter((p) => p.amount > 0),
    [linkedPayments, linkBalanceKind]
  );
  type SalaryLinkSourceRow = {
    id: string;
    voucherNumber?: string;
    date?: unknown;
    amount: number;
    remaining: number;
    sourceType: "payment_out" | "journal" | "opening_balance";
    staffId?: string;
  };
  const linkSourcesWithRemaining = useMemo(() => {
    if (!allVouchers?.length) return [] as SalaryLinkSourceRow[];

    const buildTaxEntityRows = (): SalaryLinkSourceRow[] => {
      if (taxAccountIdsFromSalary.length === 0) return [];
      const taxSet = new Set(taxAccountIdsFromSalary);
      const paymentOutRows: SalaryLinkSourceRow[] = allVouchers
        .filter(
          (v: any) =>
            (v.type === "payment_out" || v.type === "direct_expense") &&
            getPaymentOutRemaining(v) > 0 &&
            v.taxAccountId &&
            taxSet.has(String(v.taxAccountId))
        )
        .map((v: any) => ({
          id: v.id,
          voucherNumber: v.voucherNumber,
          date: v.date,
          amount: Number(v.amount ?? v.total ?? 0),
          remaining: getPaymentOutRemaining(v),
          sourceType: "payment_out" as const,
          staffId: String(v.taxAccountId),
        }));
      const journalRows: SalaryLinkSourceRow[] = [];
      for (const v of allVouchers as any[]) {
        if (v.type !== "journal" || v.subType === "add_salary") continue;
        for (const taxId of taxAccountIdsFromSalary) {
          const drAmount = getJournalTaxDrAmount(v, taxId);
          if (drAmount == null) continue;
          const remaining = getJournalRemainingForTax(v, taxId);
          if (remaining <= 0) continue;
          journalRows.push({
            id: v.id,
            voucherNumber: v.voucherNumber,
            date: v.date,
            amount: drAmount,
            remaining,
            sourceType: "journal",
            staffId: taxId,
          });
          break;
        }
      }
      return [...paymentOutRows, ...journalRows];
    };

    const buildStaffEntityRows = (): SalaryLinkSourceRow[] => {
      if (staffIdsFromSalary.length === 0) return [];
      const staffSet = new Set(staffIdsFromSalary);
      const paymentOutRows: SalaryLinkSourceRow[] = allVouchers
        .filter(
          (v: any) =>
            (v.type === "payment_out" || v.type === "direct_expense") &&
            getPaymentOutRemaining(v) > 0 &&
            v.staffId &&
            staffSet.has(v.staffId)
        )
        .map((v: any) => ({
          id: v.id,
          voucherNumber: v.voucherNumber,
          date: v.date,
          amount: Number(v.amount ?? v.total ?? 0),
          remaining: getPaymentOutRemaining(v),
          sourceType: "payment_out" as const,
          staffId: v.staffId,
        }));
      const journalRows: SalaryLinkSourceRow[] = [];
      for (const v of allVouchers as any[]) {
        if (v.type !== "journal" || v.subType === "add_salary") continue;
        for (const staffId of staffIdsFromSalary) {
          const drAmount = getJournalStaffDrAmount(v, staffId);
          if (drAmount == null) continue;
          const remaining = getJournalRemainingForStaff(v, staffId);
          if (remaining <= 0) continue;
          journalRows.push({
            id: v.id,
            voucherNumber: v.voucherNumber,
            date: v.date,
            amount: drAmount,
            remaining,
            sourceType: "journal",
            staffId,
          });
          break;
        }
      }
      return [...paymentOutRows, ...journalRows];
    };

    const sortNewestFirst = (rows: SalaryLinkSourceRow[]) =>
      [...rows].sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dB - dA;
      });

    const dedupeById = (rows: SalaryLinkSourceRow[]) => {
      const seen = new Set<string>();
      const out: SalaryLinkSourceRow[] = [];
      for (const r of rows) {
        const id = String(r.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(r);
      }
      return out;
    };

    if (linkBalanceKind === "tax") {
      return sortNewestFirst(buildTaxEntityRows());
    }

    // After-tax / staff amount: staff sources always; tax sources when Settings → Link allocation allows.
    const allowTaxOnStaff =
      getAddSalaryLinkAllocation(company).allowTaxEntityOnStaffAmount === true;
    const staffRows = buildStaffEntityRows();
    if (!allowTaxOnStaff) return sortNewestFirst(staffRows);
    return sortNewestFirst(dedupeById([...staffRows, ...buildTaxEntityRows()]));
  }, [allVouchers, staffIdsFromSalary, taxAccountIdsFromSalary, linkBalanceKind, company]);

  const linkSourcesOldestFirst = useMemo(() => {
    return [...linkSourcesWithRemaining].sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });
  }, [linkSourcesWithRemaining]);

  /** Opening balance (OB) for Add Salary: only debit-side staff OB can be linked here, and it is consumed by other credit-side vouchers. */
  const obLinkState = useMemo(() => {
    const salaryVoucherId = voucher?.id ?? savedVoucherIdRef ?? null;
    const staffSet = new Set(staffIdsFromSalary);
    const staffOBTotal = staffIdsFromSalary.reduce((sum, sid) => sum + Math.max(0, Number(processedStaff?.find((s: any) => s.id === sid)?.openingBalance) || 0), 0);
    let totalAllocatedToOB = 0;
    (allVouchers as any[] || []).forEach((v: any) => {
      if ((v.type !== "payment_in" && v.type !== "direct_income") || !v.staffId || !staffSet.has(v.staffId)) return;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      allocs.forEach((a) => { if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) totalAllocatedToOB += getAllocationTotal(a); });
    });
    let totalSalaryOBAllocated = 0;
    (allVouchers as any[] || []).forEach((v: any) => {
      if (v.type !== "journal" || v.subType !== "add_salary" || v.id === salaryVoucherId) return;
      if (!Array.isArray(v.entries)) return;
      const hasStaff = v.entries.some((e: any) => e.accountId && staffSet.has(e.accountId));
      if (hasStaff) totalSalaryOBAllocated += Number((v as any).openingBalanceAllocated) || 0;
    });
    const openingBalanceAllocated = Number(latestOBAllocated) || 0;
    const obOutstanding = Math.max(0, staffOBTotal - totalAllocatedToOB - totalSalaryOBAllocated);
    const obLinkable = obOutstanding + openingBalanceAllocated;
    const showOBRow = staffOBTotal > 0 && (obOutstanding > 0 || openingBalanceAllocated > 0);
    const obAllocatedToOthers = totalAllocatedToOB + totalSalaryOBAllocated - openingBalanceAllocated;
    return { staffOBTotal, totalAllocatedToOB, totalSalaryOBAllocated, openingBalanceAllocated, obOutstanding, obLinkable, showOBRow, obAllocatedToOthers };
  }, [staffIdsFromSalary, processedStaff, allVouchers, voucher?.id, savedVoucherIdRef, latestOBAllocated]);

  /** Card rows should come from the local draft itself so newly added links show instantly in add/edit modes, including Opening Balance. */
  const billWiseCardRows = useMemo(() => {
    const salaryVoucherId = voucher?.id ?? savedVoucherIdRef ?? null;
    const paymentRows = Object.entries(localSalaryLinkMap)
      .map(([id, amounts]) => {
        const target = allVouchers?.find((v: any) => v.id === id);
        const allocations = (target?.allocations as Allocation[] | undefined) || [];
        const currentLinked = getSalaryLinkAmountByKind(
          {
            taxAmount: Number(amounts.taxAmount) || 0,
            netAmount: Number(amounts.netAmount) || 0,
          },
          linkBalanceKind
        );
        const linkedOnOthers = salaryVoucherId
          ? allocations.filter((a) => a.voucherId !== salaryVoucherId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        return {
          id,
          voucherNumber: target?.voucherNumber ?? target?.voucher_number ?? "—",
          date: target?.date ?? null,
          totalAmount: Number(target?.amount ?? target?.total ?? 0) || 0,
          linkedOnOthers,
          currentLinked,
        };
      })
      .filter((row) => row.currentLinked > 0);
    const obRows = latestOBAllocated > 0
      ? [{
          id: OPENING_BALANCE_VOUCHER_ID,
          voucherNumber: "Opening Balance",
          date: null,
          totalAmount: Number(obLinkState.staffOBTotal) || 0,
          linkedOnOthers: Math.max(0, Number(obLinkState.obAllocatedToOthers) || 0),
          currentLinked: Number(latestOBAllocated) || 0,
        }]
      : [];
    return [...obRows, ...paymentRows]
      .sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dB - dA;
      });
  }, [localSalaryLinkMap, allVouchers, linkBalanceKind, voucher?.id, savedVoucherIdRef, latestOBAllocated, obLinkState]);
  // Edit voucher with existing links should auto-show link section; add/non-linked edit keeps it hidden until user clicks.
  const hasBillWiseLinks = billWiseCardRows.length > 0 || billWiseLinkedTotal > 0;
  const shouldShowBillWiseSection = showLinkSection || (!!voucher?.id && hasBillWiseLinks);
  useEffect(() => {
    if (voucher?.id && hasBillWiseLinks) {
      setShowLinkSection(true);
      return;
    }
    if (!voucher?.id) {
      setShowLinkSection(false);
    }
  }, [voucher?.id, hasBillWiseLinks]);

  /** Report effective has-links to dialog so fields lock as soon as user links (bill-wise) in this session. */
  useEffect(() => {
    if (!onEffectiveLinksChange) return;
    onEffectiveLinksChange(billWiseCardRows.length > 0);
  }, [onEffectiveLinksChange, billWiseCardRows.length]);

  /** Payment outs + journal Dr rows in Link Payment dialog: staff (net) or tax entity opposite (tax). */
  const paymentOutsForLinkDialog = useMemo(() => {
    const staffSet = new Set(staffIdsFromSalary);
    const taxSet = new Set(taxAccountIdsFromSalary);
    const salaryVoucherId = voucher?.id ?? savedVoucherIdRef ?? null;
    const currentKindLinkedById = new Map(linkedPayments.map((p) => [p.id, getSalaryLinkAmountByKind(p, linkBalanceKind)]));
    const withRemainingIds = new Set(linkSourcesWithRemaining.map((p) => p.id));
    const getAllocatedToOthers = (v: any, accountId?: string) => {
      const allocations = (v?.allocations as Allocation[] | undefined) || [];
      return salaryVoucherId
        ? allocations
            .filter((a) => {
              if (a.voucherId === salaryVoucherId) return false;
              if (accountId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== String(accountId)) return false;
              return true;
            })
            .reduce((s, a) => s + getSalaryLinkAmountFromAllocation(a, linkBalanceKind), 0)
        : allocations.reduce((s, a) => s + getSalaryLinkAmountFromAllocation(a, linkBalanceKind), 0);
    };
    const linkedOnly = linkedPayments
      .filter((p) => {
        const v = allVouchers?.find((v: any) => v.id === p.id);
        if (!v) return false;
        if (linkBalanceKind === "tax") {
          if (v.type === "payment_out" || v.type === "direct_expense") {
            return v.taxAccountId && taxSet.has(String(v.taxAccountId));
          }
          if (v.type === "journal" && v.subType !== "add_salary") {
            return taxAccountIdsFromSalary.some((tid) => getJournalTaxDrAmount(v, tid) != null);
          }
          return false;
        }
        if (v.type === "payment_out" || v.type === "direct_expense") {
          return v.staffId && staffSet.has(v.staffId);
        }
        if (v.type === "journal" && v.subType !== "add_salary") {
          return staffIdsFromSalary.some((sid) => getJournalStaffDrAmount(v, sid) != null);
        }
        return false;
      })
      .filter((p) => !withRemainingIds.has(p.id))
      .map((p) => {
        const v = allVouchers?.find((v: any) => v.id === p.id);
        const journalAccountId =
          v?.type === "journal"
            ? linkBalanceKind === "tax"
              ? taxAccountIdsFromSalary.find((tid) => getJournalTaxDrAmount(v, tid) != null)
              : staffIdsFromSalary.find((sid) => getJournalStaffDrAmount(v, sid) != null)
            : undefined;
        const rowAmount =
          v?.type === "journal" && journalAccountId
            ? linkBalanceKind === "tax"
              ? (getJournalTaxDrAmount(v, journalAccountId) ?? 0)
              : (getJournalStaffDrAmount(v, journalAccountId) ?? 0)
            : Number(v?.amount ?? v?.total ?? 0) || 0;
        return {
          id: p.id,
          voucherNumber: p.voucherNumber,
          date: p.date,
          amount: rowAmount,
          remaining: currentKindLinkedById.get(p.id) ?? 0,
          allocatedToOthers: getAllocatedToOthers(v, journalAccountId),
          sourceType: v?.type === "journal" ? ("journal" as const) : ("payment_out" as const),
        };
      });
    const withRemainingWithOthers = linkSourcesWithRemaining.map((p) => {
      const v = allVouchers?.find((v: any) => v.id === p.id);
      return {
        ...p,
        remaining: p.remaining + (currentKindLinkedById.get(p.id) ?? 0),
        allocatedToOthers: getAllocatedToOthers(v, p.staffId),
      };
    });
    const combined = [...withRemainingWithOthers, ...linkedOnly];
    combined.sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dB - dA;
    });
    // Staff OB only for after-tax salary mode — tax mode uses tax-entity opposite vouchers only.
    const obRow =
      linkBalanceKind !== "tax" && obLinkState.showOBRow
        ? [{
            id: OPENING_BALANCE_VOUCHER_ID,
            voucherNumber: "—",
            date: null,
            amount: obLinkState.staffOBTotal,
            remaining: obLinkState.obLinkable,
            allocatedToOthers: Math.max(0, obLinkState.obAllocatedToOthers),
            sourceType: "opening_balance" as const,
          }]
        : [];
    return [...obRow, ...combined];
  }, [linkSourcesWithRemaining, linkedPayments, linkBalanceKind, staffIdsFromSalary, taxAccountIdsFromSalary, allVouchers, voucher?.id, savedVoucherIdRef, obLinkState]);
  // Show the same "x voucher(s) available to link" helper count in Add Salary bill-wise card.
  const billWiseLinkableVoucherCount = useMemo(
    () => paymentOutsForLinkDialog.filter((row: any) => (Number(row?.remaining ?? 0) || 0) > 0).length,
    [paymentOutsForLinkDialog]
  );

  /** Open bill-wise link dialog from Add Salary. Dialog edits only local draft; server sync happens on main Save. */
  const handleOpenBillWiseDialog = useCallback(() => {
    const initial: Record<string, number> = {};
    linkedPayments.forEach((p) => { initial[p.id] = getSalaryLinkAmountByKind(p, linkBalanceKind); });
    if (
      linkBalanceKind !== "tax" &&
      (obLinkState.showOBRow || latestOBAllocated > 0)
    ) {
      initial[OPENING_BALANCE_VOUCHER_ID] = latestOBAllocated;
    }
    setLinkPaymentAmounts(initial);
    setIsLinkPaymentDialogOpen(true);
  }, [linkedPayments, linkBalanceKind, obLinkState.showOBRow, latestOBAllocated]);

  /** Auto-link button works locally in add/edit; actual sync happens only on main Save. */
  const handleAutoLinkFromCard = useCallback(() => {
    void handleAutoLink();
  }, [handleAutoLink]);

  useEffect(() => {
    if (isLinkPaymentDialogOpen) {
      if (!prevLinkDialogOpenRef.current) {
        prevLinkDialogOpenRef.current = true;
        const initial: Record<string, number> = {};
        // Seed existing payment/OB links once when the dialog opens so edit state stays stable while open.
        linkedPayments.forEach((p) => { initial[p.id] = getSalaryLinkAmountByKind(p, linkBalanceKind); });
        if (linkBalanceKind !== "tax" && obLinkState.showOBRow) {
          initial[OPENING_BALANCE_VOUCHER_ID] = obLinkState.openingBalanceAllocated;
        }
        setLinkPaymentAmounts(initial);
      }
    } else {
      prevLinkDialogOpenRef.current = false;
      setLinkPaymentAmounts({});
    }
  }, [isLinkPaymentDialogOpen, linkedPayments, linkBalanceKind, obLinkState.showOBRow, obLinkState.openingBalanceAllocated]);

  const { isDirty: isFormDirty } = form.formState;
  const isFileDirty = (() => {
    const currentUrls = files.filter(f => typeof f === 'string') as string[];
    const newFiles    = files.filter(f => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u, i) => u !== init[i]);
  })();
  // recurringVoucherAuxiliaryDirty: Auto Monthly header ON↔OFF (committed se mismatch) par Save enable.
  const isAnyDirty = isFormDirty || isFileDirty || billWiseLinkDirty || recurringVoucherAuxiliaryDirty;
  const debitAccountId = form.watch("debitAccountId");
  const debitAccountBalance = useMemo(() => {
    if (!debitAccountId) return null;
    return processedExpenseAccounts.find(a => a.id === debitAccountId)?.balance;
  }, [debitAccountId, processedExpenseAccounts]);

  /** Copy create / target naam-match: list sync se pehle combobox me selected id dikhane ke liye synthetic option. */
  const debitAccountComboboxOptions = useMemo(() => {
    const base = processedExpenseAccounts
      .filter((a) => a.id !== "sales_account" && a.id !== "purchase_account")
      .map((a) => ({ value: a.id, label: a.name }));
    const id = String(debitAccountId || "").trim();
    if (!id || base.some((o) => o.value === id)) return base;
    const label =
      processedExpenseAccounts.find((a) => a.id === id)?.name ||
      pendingDebitAccountLabelRef.current ||
      copyMasterDraftRequest?.sourceName ||
      id;
    return [{ value: id, label }, ...base];
  }, [processedExpenseAccounts, debitAccountId, copyMasterDraftRequest?.sourceName]);

  /** Copy-To: chip tab dikhao jab save-target company par id resolve na ho — sirf `copyMismatchCategories` pe mat rely karo ( naam match par wo [] reh sakta hai ). */
  const copyDraftMasterHelpersEnabled = Boolean(copySaveTargetCompanyId && onCopyMissingCategory);
  const debitNeedsCopyChip = useCallback(() => {
    if (!copyDraftMasterHelpersEnabled) return false;
    const id = String(form.getValues("debitAccountId") || "");
    if (!id) return true;
    // Naya create / target match: listener aane tak Copy chip mat dikhao.
    if (pendingDebitAccountIdUntilInListRef.current === id) return false;
    return !processedExpenseAccounts.some((a) => a.id === id);
  }, [copyDraftMasterHelpersEnabled, form, processedExpenseAccounts]);

  /** Pending debit ab expense list me aa gaya — ref clear. */
  useEffect(() => {
    const pend = pendingDebitAccountIdUntilInListRef.current;
    if (!pend) return;
    if (processedExpenseAccounts.some((a) => a.id === pend)) {
      pendingDebitAccountIdUntilInListRef.current = null;
      pendingDebitAccountLabelRef.current = "";
    }
  }, [processedExpenseAccounts]);

  useEffect(() => {
    const pend = pendingDebitAccountIdUntilInListRef.current;
    const id = String(debitAccountId || "").trim();
    if (pend && id && id !== pend) {
      pendingDebitAccountIdUntilInListRef.current = null;
      pendingDebitAccountLabelRef.current = "";
    }
  }, [debitAccountId]);

  useEffect(() => {
    const pend = pendingStaffIdUntilInStaffListRef.current;
    if (!pend) return;
    if (processedStaff.some((s) => s.id === pend)) {
      pendingStaffIdUntilInStaffListRef.current = null;
    }
  }, [processedStaff]);

  useEffect(() => {
    const pend = pendingTaxIdUntilInTaxesListRef.current;
    if (!pend) return;
    if (processedTaxes.some((t) => t.id === pend)) {
      pendingTaxIdUntilInTaxesListRef.current = null;
    }
  }, [processedTaxes]);

  const staffLineNeedsCopyChip = useCallback(
    (index: number) => {
      if (!copyDraftMasterHelpersEnabled) return false;
      const id = String(form.getValues(`lineItems.${index}.staffId`) || "");
      // Khali staff: sirf tab Copy chip jab remap ne mismatch bataya ho — warna nayi blank row par galat chip na dikhe.
      if (!id) return Boolean(copyMismatchCategories?.includes("staff"));
      if (pendingStaffIdUntilInStaffListRef.current === id) return false;
      return !processedStaff.some((s) => s.id === id);
    },
    [copyDraftMasterHelpersEnabled, copyMismatchCategories, form, processedStaff]
  );

  const taxLineNeedsCopyChip = useCallback(
    (index: number) => {
      if (!copyDraftMasterHelpersEnabled) return false;
      const id = String(form.getValues(`lineItems.${index}.taxAccountId`) || "");
      const taxAmt = Number(form.getValues(`lineItems.${index}.taxAmount`) || 0);
      const salaryVal = Number(form.getValues(`lineItems.${index}.salary`) || 0);
      const staffId = String(form.getValues(`lineItems.${index}.staffId`) || "");
      const staffUnresolved =
        (staffId && !processedStaff.some((s) => s.id === staffId) && pendingStaffIdUntilInStaffListRef.current !== staffId) ||
        (!staffId && Boolean(copyMismatchCategories?.includes("staff")));
      if (!id) {
        if (taxAmt > 0) return true;
        if (copyMismatchCategories?.includes("tax")) return true;
        // Staff abhi mismatch — tax combo aksar saath me resolve hota; Copy chip dikhao taaki tax master copy ho sake.
        if (salaryVal > 0 && staffUnresolved) return true;
        return false;
      }
      if (pendingTaxIdUntilInTaxesListRef.current === id) return false;
      return !processedTaxes.some((t) => t.id === id);
    },
    [copyDraftMasterHelpersEnabled, copyMismatchCategories, form, processedTaxes, processedStaff]
  );

  /** Copy entry-point: pehli mismatched staff row index (header chip se same existing label par action). */
  const firstStaffCopyRowIndex = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return null;
    const rows = (watchedLineItems ?? []) as any[];
    for (let i = 0; i < rows.length; i++) {
      if (staffLineNeedsCopyChip(i)) return i;
    }
    return null;
  }, [copyDraftMasterHelpersEnabled, watchedLineItems, staffLineNeedsCopyChip]);

  /** Copy entry-point: pehli mismatched tax row index (Tax header label ke right copy chip). */
  const firstTaxCopyRowIndex = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return null;
    const rows = (watchedLineItems ?? []) as any[];
    for (let i = 0; i < rows.length; i++) {
      if (taxLineNeedsCopyChip(i)) return i;
    }
    return null;
  }, [copyDraftMasterHelpersEnabled, watchedLineItems, taxLineNeedsCopyChip]);

  /** Parent `copyMasterDraftRequest` → full master create dialog (files ke saath jahan lagta hai). */
  const applyCopyMasterTargetId = useCallback(
    (req: CopyMasterDraftRequestPayload) => {
      const targetId = String(req.existingTargetMasterId || "").trim();
      if (!targetId || !req.applyTarget) return;
      const at = req.applyTarget;
      if (at.addSalaryField === "debitAccountId") {
        pendingDebitAccountIdUntilInListRef.current = targetId;
        pendingDebitAccountLabelRef.current = String(req.sourceName || "").trim();
        form.setValue("debitAccountId", targetId);
        sonnerToast.message(`Debit account linked to existing "${req.sourceName}" in target company.`);
        void onRefreshCopyMismatch?.();
        return;
      }
      if (typeof at.addSalaryLineIndex === "number") {
        setActiveLineIndex(at.addSalaryLineIndex);
        if (at.addSalaryField === "staffId") {
          pendingStaffIdUntilInStaffListRef.current = targetId;
          form.setValue(`lineItems.${at.addSalaryLineIndex}.staffId`, targetId);
        } else if (at.addSalaryField === "taxAccountId") {
          pendingTaxIdUntilInTaxesListRef.current = targetId;
          form.setValue(`lineItems.${at.addSalaryLineIndex}.taxAccountId`, targetId);
        }
        sonnerToast.message(`Linked existing "${req.sourceName}" in target company.`);
        void onRefreshCopyMismatch?.();
      }
    },
    [form, onRefreshCopyMismatch]
  );

  useEffect(() => {
    if (!hasInitializedCopyRequestRef.current) {
      hasInitializedCopyRequestRef.current = true;
      return;
    }
    if (!copyMasterDraftRequest) return;
    const req = copyMasterDraftRequest;
    // Target par naam pehle se — create dialog ke bajay matched id apply.
    if (req.existingTargetMasterId) {
      applyCopyMasterTargetId(req);
      return;
    }
    const at = req.applyTarget;
    if (typeof at?.addSalaryLineIndex === "number") setActiveLineIndex(at.addSalaryLineIndex);
    const targetLabel = req.targetCompanyName || "company";
    const payload = req.sourceRowPayload;
    const sc = String(req.sourceCollection || "");
    const nm = String(req.sourceName || "").trim();

    if (payload && sc === "expense_accounts") {
      pendingDebitAccountLabelRef.current = nm;
      setIsCreateExpenseOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-expense-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Expense account prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    if (payload && sc === "staff") {
      setIsCreateStaffOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-staff-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Staff prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    if (payload && sc === "taxes") {
      setIsCreateTaxOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-tax-from-row", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Tax prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    if (!nm) return;
    switch (req.category) {
      case "staff":
        setIsCreateStaffOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-staff-name", { detail: nm })), 80);
        sonnerToast.message(`Staff prefilled -> save adds to "${targetLabel}".`);
        return;
      case "tax":
        setIsCreateTaxOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: nm })), 80);
        sonnerToast.message(`Tax prefilled -> save adds to "${targetLabel}".`);
        return;
      case "account_expense":
        pendingDebitAccountLabelRef.current = nm;
        setIsCreateExpenseOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
        sonnerToast.message(`Expense account prefilled -> save adds to "${targetLabel}".`);
        return;
      default:
        break;
    }
  }, [copyMasterDraftRequest, applyCopyMasterTargetId]);

  const transactionDates = useMemo(() => {
    if (!allVouchers?.length) return [];
    return allVouchers.map((v) => {
      const d = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      return d && !isNaN(d.getTime()) ? startOfDay(d) : null;
    }).filter(Boolean) as Date[];
  }, [allVouchers]);
  

  // Validated `data` — nested mobile date + `getValues()` से date miss न हो
  function handleFormSubmit(e: React.FormEvent, options: { ocrAutoPost?: boolean; saveAndNew?: boolean; approveAfterSave?: boolean; print?: boolean } = {}) {
    e?.preventDefault?.();
    void form.handleSubmit(
      async (data) => {
        await processAndSave(data, options.saveAndNew, options.approveAfterSave ? onApprove : undefined);
      },
      (errors) => {
        sonnerToast.error("Validation Failed", { description: formatSalaryFormValidationErrors(errors) });
      }
    )(e);
  }


async function processAndSave(data: SalaryFormValues, saveAndNew: boolean = false, onSuccess?: () => void) {
    if (!user || !companyId) {
      sonnerToast.error("Error", { description: "Login and company selection required." });
      return;
    }
    const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving salary voucher...");
    if (toastId == null) return;
    setIsLoading(true);

    const totalDebit = data.lineItems.filter(l => l.type === 'debit').reduce((sum, l) => sum + l.salary, 0);
    const totalCredit = data.lineItems.filter(l => l.type === 'credit').reduce((sum, l) => sum + l.afterTaxSalary, 0);
    const totalTaxCredit = data.lineItems.reduce((sum, l) => sum + (l.taxAmount || 0), 0);

    const debitAccountAmount = totalCredit + totalTaxCredit;

    if (!isPaymentMode && Math.abs(debitAccountAmount - totalSalary) > 0.001) {
        sonnerToast.error("Unbalanced Entry", { id: toastId, description: "Debit (Salary Expense) must equal Credit (Staff + Tax)." });
        setIsLoading(false);
        return;
    }

    const isLocalMode = isLocalOnlyMode() || shouldReadLedgerFromSqliteOnly(company);

        if (reconGuard) {
      for (const item of (data.lineItems || [])) {
        if (item.staffId) {
          const allowed = await reconGuard.checkAndConfirmReconciledDate({
            companyId,
            voucherDate: data.date,
            staffId: item.staffId,
            allVouchers,
          });
          if (!allowed) {
            setIsLoading(false);
            return;
          }
        }
      }
      const targetAccId = (data as any).paidFromAccountId || data.debitAccountId;
      if (targetAccId) {
        const allowed = await reconGuard.checkAndConfirmReconciledDate({
          companyId,
          voucherDate: data.date,
          accountId: targetAccId,
          allVouchers,
        });
        if (!allowed) {
          setIsLoading(false);
          return;
        }
      }
    }

try {
      // Permission check: create or edit
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherIdRef);
      const voucherDate = data.date instanceof Date ? data.date : new Date(data.date);
      
      if (isEdit) {
        // Check edit permission - determine ownership
        const fetchVoucher = async (cid: string, vid: string) => {
          if (isLocalMode) {
            // Local mode me ownership lookup local cache se lo to avoid Firestore dependency.
            const localVoucher = allVouchers.find((v: any) => v.id === vid);
            return localVoucher || null;
          }
          const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
          return voucherDoc.exists() ? voucherDoc.data() : null;
        };
        const isOwnRecord = await determineVoucherOwnership(voucher, savedVoucherIdRef, allVouchers, user.uid, companyId, fetchVoucher);
        assertCanEdit(canEditRecord, isOwnRecord);
        
        // Check backdate limit for edit - use ORIGINAL voucher date, not form date
        let originalVoucherDate = voucherDate;
        if (voucher?.date) {
          originalVoucherDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date);
        } else if (savedVoucherIdRef) {
          const existingVoucher = allVouchers.find(v => v.id === savedVoucherIdRef);
          if (existingVoucher?.date) {
            originalVoucherDate = existingVoucher.date?.toDate ? existingVoucher.date.toDate() : new Date(existingVoucher.date);
          } else if (companyId && !isLocalMode) {
            // Local mode me edit-date fallback Firestore se fetch na karo; local mirror ko source rakho.
            const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, savedVoucherIdRef));
            if (voucherDoc.exists()) {
              const voucherData = voucherDoc.data();
              originalVoucherDate = voucherData.date?.toDate ? voucherData.date.toDate() : new Date(voucherData.date);
            }
          }
        }
        assertCanPerformBackdated(canPerformBackdatedAction, "edit", originalVoucherDate);
      } else {
        // Check create permission
        assertCan(can, "create_records");
        
        // Check backdate limit for create
        assertCanPerformBackdated(canPerformBackdatedAction, "create", voucherDate);
      }
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        sonnerToast.error("Permission Denied", { id: toastId, description: error.message });
      } else {
        sonnerToast.error("Error", { id: toastId, description: "Failed to check permissions." });
      }
      setIsLoading(false);
      return;
    }

    try {
      const originalVoucherIdToDelete: string | null =
        isEditingAndConverting && voucher?.id ? String(voucher.id) : null;
      const idArgForFirestore = resolveVoucherIdForSave({
        savedVoucherId: savedVoucherIdRef,
        originalVoucherIdToDelete,
      });

      const voucherType = isPaymentMode ? "payment_out" : "journal";
      const subType = isPaymentMode ? "pay_salary" : "add_salary";

      if (voucher?.voucherNumber !== data.voucherNumber) {
        if (isLocalMode) {
          // Local-first mode me duplicate check local vouchers list se karo; network read avoid karo.
          const duplicateLocal = allVouchers.some((v: any) =>
            !v?.isDeleted &&
            v?.id !== idArgForFirestore &&
            v?.voucherNumber === data.voucherNumber &&
            v?.type === voucherType &&
            v?.subType === subType
          );
          if (duplicateLocal) {
            sonnerToast.error("Duplicate Voucher Number", { id: toastId, description: "This voucher number is already used." });
            setIsLoading(false);
            return;
          }
        } else {
          const q = query(
            collection(firestore, `companies/${companyId}/vouchers`),
            where("voucherNumber", "==", data.voucherNumber),
            where("type", "==", voucherType),
            where("subType", "==", subType)
          );
          const existingVoucherSnap = await getDocs(q);
          if (!existingVoucherSnap.empty && existingVoucherSnap.docs[0].id !== idArgForFirestore) {
            sonnerToast.error("Duplicate Voucher Number", { id: toastId, description: "This voucher number is already used." });
            setIsLoading(false);
            return;
          }
        }
      }

      const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });
      
      const existingUrls = filesForSave.filter(f => typeof f === 'string') as string[];
      const newFiles = filesForSave.filter(f => f instanceof File) as File[];

      if (!isLocalMode && newFiles.length > 0) {
        // Storage quota check sirf online upload flow me chale; local-first me skip.
        const totalNewBytes = newFiles.reduce((s, f) => s + (f.size || 0), 0);
        const limitCheck = await checkStorageLimitSafe(companyId, company?.planId, { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes }, company?.storageOption);
        if (!limitCheck.allowed) {
          sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
          setIsLoading(false);
          return;
        }
      }

      let preGeneratedVoucherId: string | undefined;
      let allFileUrls: string[];

      // Nayi files: `saveVoucher` SQLite-first gate se match — APK + Server writes OFF + Firebase data source par `isLocalOnlyMode` false ho sakta tha.
      if (await shouldStageNewVoucherFilesAsLocalPending(companyId)) {
        if (newFiles.length > 0) {
          const totalNewBytes = newFiles.reduce((s, f) => s + (f.size || 0), 0);
          const limitCheck = await checkStorageLimitSafe(companyId, company?.planId, { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes }, company?.storageOption);
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
            setIsLoading(false);
            return;
          }
          const voucherIdForLocalAttachments =
            isEditingAndConverting && voucher?.id
              ? null
              : idArgForFirestore ?? null;
          const { fileUrls: merged, preGeneratedVoucherId: preGen } =
            await appendLocalOnlyVoucherFilesToUrls({
              companyId,
              storageFolder: "salary",
              existingFileUrls: existingUrls,
              newFiles,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: voucherIdForLocalAttachments,
            });
          allFileUrls = merged;
          if (preGen) preGeneratedVoucherId = preGen;
          if (!shouldDeferStorageIncrementUntilPendingUpload()) {
            try {
              await incrementCompanyStorage(companyId, {
                attachmentsBytes: totalNewBytes,
                storageBytes: totalNewBytes,
              });
            } catch {
              /* offline */
            }
          }
        } else {
          allFileUrls = [...existingUrls];
        }
      } else {
        const up = await uploadVoucherFilesOrStageLocalPending({
          companyId,
          storageFolder: "salary",
          existingFileUrls: [...existingUrls],
          files: newFiles,
          existingVoucherId: isEditingAndConverting && voucher?.id ? null : idArgForFirestore ?? null,
        });
        allFileUrls = up.fileUrls;
        if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
      }

      let submissionData: any = {
        voucherNumber: data.voucherNumber,
        date: data.date,
        narration: data.narration,
        total: data.total,
        type: voucherType,
        subType: subType,
        ...voucherAttachmentFieldsForSave(
          allFileUrls,
          voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))
        ),
        unassignedFile: data.unassignedFile || null,
      };

      if (isPaymentMode) {
        submissionData.staffId = data.lineItems[0]?.staffId;
        submissionData.amount = data.lineItems[0]?.salary;
        submissionData.accountId = data.accountId;
      } else {
        let entries: any[] = [];
        data.lineItems.forEach(line => {
            entries.push({
                accountId: line.staffId,
                debit: 0,
                credit: line.afterTaxSalary,
                narration: line.narration || `Salary for ${processedStaff.find(s => s.id === line.staffId)?.name || ''}`
            });
            if (line.taxAccountId && line.taxAmount && line.taxAmount > 0) {
                entries.push({
                    accountId: line.taxAccountId,
                    debit: 0,
                    credit: line.taxAmount,
                    narration: `TDS for ${processedStaff.find(s => s.id === line.staffId)?.name || ''} (Staff ID: ${line.staffId})`,
                    isTdsVerified: line.isTdsVerified === true,
                });
            }
        });
        
        const totalDebitAmount = totalSalary;
        entries.push({
            accountId: data.debitAccountId, 
            debit: totalDebitAmount,
            credit: 0,
            narration: 'Salary expense for the period'
        });

        submissionData.entries = entries;
        // Preserve opening balance linked to this salary (from voucher or from Link payment dialog DONE so we don't overwrite before refetch)
        if (!isCopiedDraftFirstInsert && (voucher?.id || savedVoucherIdRef)) {
          // Always persist the latest local OB link so edit-mode Save cannot restore stale voucher props.
          submissionData.openingBalanceAllocated = Number(latestOBAllocated) || 0;
        }
      }

      if (!idArgForFirestore) delete (submissionData as { id?: string }).id;

      const savedDoc = await saveVoucher(
        companyId,
        user.uid,
        submissionData,
        idArgForFirestore,
        undefined,
        preGeneratedVoucherId ? { preGeneratedVoucherId } : undefined
      );

      if (savedDoc && savedDoc.id) {
          markCopiedDraftPersisted();
          if (isMounted.current) setSavedVoucherIdRef(savedDoc.id);
      } else {
          throw new Error("Failed to save voucher and get ID.");
      }

        const isEditSave = Boolean(voucher?.id && !isEditingAndConverting);
        if (isEditSave) {
          // Edit: no "saved success" toast — dismiss loading only.
          sonnerToast.dismiss(toastId);
          sonnerToast.dismiss(VOUCHER_SAVE_LOADING_TOAST_ID);
          dismissAllVoucherProgressLoadingToasts();
        } else {
          sonnerToast.success("Voucher saved successfully!", { id: toastId });
        }
        if (isMounted.current) setIsLoading(false);

        // TDS Verified / Unverified + entries must hit ledger cache immediately (Waiting → Verified).
        if (companyId && savedDoc.id) {
          dispatchVoucherLivePatch(companyId, savedDoc.id, {
            ...submissionData,
            id: savedDoc.id,
            type: voucherType,
            subType: subType,
            entries: submissionData.entries,
          });
          if (isEditSave) {
            // Silent ledger refresh so tax/staff/party running + footer pick up verify without F5.
            notifyBrowserDbCollectionUpdated(companyId, "vouchers", {
              immediate: true,
              source: "local_write",
            });
          }
        }

        if (!saveAndNew) {
          onVoucherAction?.("saved", false, savedDoc.id);
        }

        const postSaveTail = async () => {
          if (companyId && savedDoc.id) {
            try {
              const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
                companyId,
                voucherId: savedDoc.id,
                rawFileUrls: allFileUrls,
                storageFolder: "salary",
                previousUrls: initialFilesRef.current,
              });
              if (!isMounted.current) return;
              initialFilesRef.current = [...persistedUrls];
              setFiles(persistedUrls);
            } catch (attachErr) {
              console.warn("[SalaryForm] post-save attachment finalize", attachErr);
            }
          }
          if (!isPaymentMode) {
            await syncSalaryBillWiseLinks(savedDoc.id);
          }
          if (originalVoucherIdToDelete && shouldMoveVoucherConvertSourceToBin(originalVoucherIdToDelete)) {
            await patchVoucherFields(companyId, originalVoucherIdToDelete, {
              isDeleted: true,
              deletedAt: voucherRecycleBinDeletedAt(),
              convertedToType: "journal",
              convertedToVoucherNumber: submissionData.voucherNumber,
            });
          }
          if (companyId && company) {
            const isEdit = !!voucher?.id;
            const amount = Number(submissionData.total ?? data.total) || 0;
            const vid = savedVoucherIdRef || voucher?.id;
            if (isEdit) {
              const oldV = voucher as any;
              const changes = getChangedFieldLabels(
                { total: oldV?.total ?? oldV?.amount, narration: oldV?.narration, date: oldV?.date?.toDate?.() ?? oldV?.date, voucherNumber: oldV?.voucherNumber, accountId: oldV?.accountId },
                { total: submissionData.total, narration: submissionData.narration, date: submissionData.date, voucherNumber: submissionData.voucherNumber, accountId: submissionData.accountId },
                [
                  { key: "total", label: "Amount" },
                  { key: "narration", label: "Narration" },
                  { key: "date", label: "Date" },
                  { key: "voucherNumber", label: "Voucher number" },
                  { key: "accountId", label: "Account" },
                ]
              );
              await sendTransactionAlert(companyId, company, {
                kind: "edited",
                voucherId: vid,
                voucherNumber: submissionData.voucherNumber,
                voucherType: voucherType,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
                changes: changes.length > 0 ? changes : undefined,
              });
            } else if (isAmountOverOneLakh(amount)) {
              await sendTransactionAlert(companyId, company, {
                kind: "large_amount",
                voucherId: vid,
                voucherNumber: submissionData.voucherNumber,
                voucherType: voucherType,
                amount,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
              });
            }
          }
          if (saveAndNew && isMounted.current) {
            form.reset(getInitialFormValues());
            setFiles([]);
            setSavePdfAsImage(false);
            setSavedVoucherIdRef(null);
            setLocalSalaryLinkMap({});
            initialSalaryLinkMapRef.current = {};
            setLatestOBAllocated(0);
            initialOBAllocatedRef.current = 0;
            setHasLocalBillWiseDraftEdits(false);
            fetchVoucherNumber();
          }
          onSuccess?.();
          if (saveAndNew) {
            onVoucherAction?.("saved", true, savedDoc.id);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.warn("[SalaryForm] post-save tail failed", err);
          });
        } else {
          await postSaveTail();
        }
    
    } catch (error) {
        if (error instanceof PermissionDeniedError) {
          sonnerToast.error("Permission Denied", { id: toastId, description: error.message });
        } else if (isVoucherLimitError(error)) {
          sonnerToast.error("Voucher limit reached", { id: toastId, description: error.message, action: { label: "Upgrade", onClick: () => window.location.assign("/billing") } });
        } else {
          console.error("Error saving salary voucher:", error);
          voucherSaveErrorToast(toastId, error, "Failed to save salary voucher.");
        }
    } finally {
        if (isMounted.current) setIsLoading(false);
    }
}

  const handleDelete = async () => {
    const voucherIdToDelete = savedVoucherIdRef || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;
    
    try {
      assertCan(can, "delete_records");
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: voucherIdToDelete,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: allVouchers as Array<{ id?: string } & Record<string, unknown>> | null,
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
          form: "salary",
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
        // Delete action local-first helper ke through run karo.
        await softDeleteVoucherMoveToRecycleBin(companyId, voucherIdToDelete, user?.uid || "");
        toast({ title: "Voucher Moved to Bin" });
        onVoucherAction?.('cancelled');
    } catch (error) {
        console.error("Error deleting voucher:", error);
        toast({ variant: "destructive", title: "Error", description: "Failed to delete voucher." });
    } finally {
        setIsLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    const voucherIdToDelete = savedVoucherIdRef || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;

    try {
      assertCanPermanentDeleteFromForm(can, role);
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: voucherIdToDelete,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: allVouchers as Array<{ id?: string } & Record<string, unknown>> | null,
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
          form: "salary",
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
      toast({ title: "Salary voucher deleted permanently." });
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled");
    } catch (error) {
      console.error("Error permanently deleting voucher:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete voucher." });
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

  const handleCreateNew = (type: 'party' | 'account' | 'staff' | 'expense' | 'tax', newName?: string) => {
    if (type === 'party') setIsCreatePartyOpen(true);
    if (type === 'account') setIsCreateAccountOpen(true);
    if (type === 'staff') setTimeout(() => setIsCreateStaffOpen(true), 0);
    if (type === 'expense') setIsCreateExpenseOpen(true);
    if (type === 'tax') setIsCreateTaxOpen(true);

    if (newName) {
       setTimeout(() => {
        // Keep prefill event names aligned with each create dialog listener.
        const eventName =
          type === "expense"
            ? "prefill-create-expense-account-name"
            : `prefill-create-${type}-name`;
        document.dispatchEvent(new CustomEvent(eventName, { detail: newName }));
      }, 100);
    }
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => handleFormSubmit(e)} className="h-full flex flex-col min-w-0 w-full max-w-full">
          <ScrollArea className={cn("flex-1 min-h-0 overflow-x-hidden min-w-0 w-full", !isMobile && "pr-6 -mr-6")}>
            <div className={cn(
              "space-y-6 min-w-0 max-w-full w-full overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full",
              isMobile ? "" : "px-[2px]"
            )}>
              {/* Section 1: Voucher No + Date in single ribbon block. */}
              <div className="rounded-lg border border-sky-300/80 bg-sky-50 p-3">
              {/* Voucher No. and Date */}
              {isMobile ? (
                <>
                  {/* Mobile: Prefix + Voucher No. + Date — `date` को `voucherNumber` के अंदर nest नहीं */}
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
                                  <FormLabel className="text-xs truncate">Voucher No.</FormLabel>
                                  <FormControl>
                                    <VoucherNumberInputWithRefresh
                                      placeholder="e.g. ADSAL-001"
                                      {...voucherField}
                                      chromeSize="sm"
                                      className="h-9 text-xs px-2 min-w-0 max-w-full w-full"
                                      disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))}
                                      onRefresh={() => void fetchVoucherNumber()}
                                      showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked}
                                    />
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
                                      <BsDatePicker
                                        valueAD={dateField.value}
                                        onChangeAD={(d) => { if (d) d.setHours(12, 0, 0, 0); dateField.onChange(d as Date); setIsCalendarOpen(false); }}
                                        isRange={false}
                                        transactionDates={transactionDates}
                                        className="h-9 text-xs w-full"
                                        disabled={deleteDisabledWhenLinked}
                                      />
                                    </div>
                                  </FormItem>
                                )}
                                {hasDateAD && (
                                  <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Date</FormLabel>
                                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button variant="outline" disabled={!isFormEditing || deleteDisabledWhenLinked} className={cn("h-9 pl-2 pr-2 text-left font-normal text-xs w-full min-w-0 max-w-full truncate", !dateField.value && "text-muted-foreground")}>
                                            {dateField.value instanceof Date && !isNaN(dateField.value.getTime()) ? formatDate(dateField.value) : "Pick date"}
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
                </>
              ) : (
                <>
                  {/* PC View: Voucher No. and Date */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:justify-end md:items-end">
                    {/* Voucher No. */}
                    <FormField 
                      control={form.control} 
                      name="voucherNumber" 
                      render={({ field }: any) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Voucher No.</FormLabel>
                          <div className="flex gap-2 h-10">
                            {isPrefixSelectionEnabled && voucherPrefixes.length > 0 && (
                              <Select onValueChange={(prefix) => fetchVoucherNumber(prefix)} value={voucherPrefixes.find(p => field.value?.startsWith(normalizePrefix(p)) || field.value?.startsWith(p)) || voucherPrefixes[0]} disabled={deleteDisabledWhenLinked}>
                                <SelectTrigger className="w-32 h-10">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {voucherPrefixes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            <FormControl>
                              <VoucherNumberInputWithRefresh
                                placeholder="e.g. ADSAL-001"
                                {...field}
                                className="h-10"
                                disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))}
                                onRefresh={() => void fetchVoucherNumber()}
                                showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {/* Date */}
                    <FormField
                      control={form.control}
                      name="date"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="date" className="flex flex-col">
                          <FormLabel>Date</FormLabel>
                          <div className={VOUCHER_PC_DATE_ROW}>
                            {(dateSystem === 'BS' || dateSystem === 'Both') && (
                              <div className={cn(dateSystem === 'Both' ? VOUCHER_PC_DATE_BOTH_SLOT : "w-full min-w-0")}>
                              <BsDatePicker 
                                valueAD={field.value} 
                                onChangeAD={(d) => { 
                                  if (d) d.setHours(12, 0, 0, 0);
                                  field.onChange(d as Date); 
                                  setIsCalendarOpen(false); 
                                }} 
                                isRange={false} 
                                transactionDates={transactionDates} 
                                disabled={deleteDisabledWhenLinked}
                                className={VOUCHER_PC_DATE_BS_PILL}
                              />
                              </div>
                            )}
                            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <div className={cn(dateSystem === 'Both' ? VOUCHER_PC_DATE_BOTH_SLOT : "w-full min-w-0")}>
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button 
                                      disabled={!isFormEditing || deleteDisabledWhenLinked} 
                                      variant={"outline"} 
                                      className={cn(VOUCHER_PC_DATE_AD_PILL, !field.value && "text-muted-foreground")}
                                    >
                                      {field.value ? formatDate(field.value) : <span>Pick a date</span>}
                                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 z-[102]" align="start">
                                  <Calendar 
                                    mode="single" 
                                    selected={field.value} 
                                    onSelect={(date) => {
                                      if (date) {
                                        date.setHours(12, 0, 0, 0);
                                      }
                                      field.onChange(date);
                                      setIsCalendarOpen(false);
                                    }} 
                                    initialFocus 
                                    modifiers={{ hasTransactions: transactionDates }} 
                                    modifiersClassNames={{ hasTransactions: "has-transactions" }} 
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
                </>
              )}
              </div>

              {/* Section 2: Debit account in its own ribbon block. */}
              <div className="rounded-lg border border-emerald-300/80 bg-emerald-50 p-3">
              {/* Debit Account — Copy-To: label ke daayein Copy chip; mismatch par laal combobox. */}
              <FormField
                control={form.control}
                name="debitAccountId"
                render={({ field }: any) => (
                  <FormItem className={cn(isMobile && "flex-shrink-0")} style={isMobile ? { width: '80mm', maxWidth: '80mm' } : undefined}>
                    <div className={cn("flex justify-between items-center gap-2 flex-wrap", isMobile && "flex-col gap-1 items-stretch")}>
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <FormLabel className={cn(isMobile && "text-xs", debitNeedsCopyChip() && "text-red-600 font-semibold")}>Debit Account</FormLabel>
                        {debitNeedsCopyChip() && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                            onClick={() =>
                              onCopyMissingCategory?.("account_expense", { addSalaryField: "debitAccountId" })
                            }
                            disabled={isCopyingMissingMasters}
                          >
                            {isCopyingMissingMasters ? "…" : "Copy"}
                          </Button>
                        )}
                      </div>
                      {debitAccountBalance !== null && debitAccountBalance !== undefined && (
                        <FormLabel className={cn(
                          isMobile ? "text-[10px] font-semibold" : "text-xs font-semibold",
                          debitAccountBalance <= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {isMobile 
                            ? `Bal: ${formatCurrency(debitAccountBalance, { noSuffix: true, noAnimation: true })} ${debitAccountBalance <= 0 ? 'Dr' : 'Cr'}`
                            : `Bal: ${formatCurrency(debitAccountBalance, { showDrCr: true, noAnimation: true })}`
                          }
                        </FormLabel>
                      )}
                    </div>
                    <div className={cn(isMobile && "[&_button]:h-9 [&_button]:text-xs")}>
                      <Combobox
                        triggerClassName={cn(debitNeedsCopyChip() && "!border-red-400 !bg-red-100/80 !text-red-700")}
                        options={debitAccountComboboxOptions}
                        value={field.value}
                        onChange={(val, newName) => {
                            if (val === "add-new") {
                                handleCreateNew("expense", newName);
                            } else {
                                field.onChange(val);
                            }
                        }}
                        placeholder="Select debit account"
                        addNewLabel="+ Add New Expense Account"
                        disabled={deleteDisabledWhenLinked}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
                
                {/* Section 3: Salary details table/list in one ribbon block. */}
                <div className="space-y-2 px-[2px] rounded-lg border border-violet-300/80 bg-violet-50 p-3">
                  <div className="flex justify-between items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <FormLabel className={cn("font-semibold shrink-0", isMobile ? "text-sm" : "text-base")}>Salary Details</FormLabel>
                      {isMobile && firstStaffCopyRowIndex !== null && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                          onClick={() =>
                            onCopyMissingCategory?.("staff", {
                              addSalaryField: "staffId",
                              addSalaryLineIndex: firstStaffCopyRowIndex,
                            })
                          }
                          disabled={isCopyingMissingMasters}
                        >
                          {isCopyingMissingMasters ? "…" : "Copy"}
                        </Button>
                      )}
                    </div>
                    {!isPaymentMode && <Button type="button" variant="outline" size="sm" onClick={handleSelectAllStaff} disabled={deleteDisabledWhenLinked} className={cn(isMobile && "text-xs h-8")}><UserPlus className={cn("h-4 w-4", isMobile && "mr-1")}/> {isMobile ? "Add All" : "Add All Staff"}</Button>}
                  </div>
                  {isMobile ? (
                    <>
                      {/* Mobile: Broken into rows with 2 columns */}
                      <div className="border rounded-lg overflow-hidden px-[2px]">
                        {fields.map((field, index) => {
                          const staffId = form.watch(`lineItems.${index}.staffId`);
                          const balance = processedStaff.find(s => s.id === staffId)?.balance;
                          const taxAccountId = form.watch(`lineItems.${index}.taxAccountId`);
                          const taxBalance = processedTaxes.find(t => t.id === taxAccountId)?.balance;
                          
                          return (
                            <div key={field.id} className="border-t p-[2px] space-y-2">
                              {/* Row 1: Staff — mobile par Copy chip section title ke paas; yahan sirf label + combo. */}
                              <div className="w-full">
                                <FormField 
                                  control={form.control} 
                                  name={`lineItems.${index}.staffId`} 
                                  render={({ field }: any) => (
                                    <FormItem>
                                      <FormLabel className={cn("text-xs", staffLineNeedsCopyChip(index) && "text-red-600 font-semibold")}>Staff Member</FormLabel>
                                      <div className="[&_button]:h-9 [&_button]:text-xs">
                                        <Combobox
                                          triggerClassName={cn(staffLineNeedsCopyChip(index) && "!border-red-400 !bg-red-100/80 !text-red-700")}
                                          options={salaryStaffOptions}
                                          value={field.value}
                                          onChange={(value, newName) => {
                                            if (value === "add-new") {
                                              openCreateStaffDialog(index, newName);
                                            } else {
                                              field.onChange(value);
                                              const selectedStaff = processedStaff.find(s => s.id === value);
                                              if (selectedStaff) {
                                                form.setValue(`lineItems.${index}.salary`, Number(selectedStaff.salary) || 0);
                                                // Auto-fill narration using selected staff/account name.
                                                form.setValue(`lineItems.${index}.narration`, `Add salary for ${selectedStaff.name}`);
                                              }
                                            }
                                          }}
                                          placeholder="Select Staff"
                                          addNewLabel="+ Add New Staff"
                                          // Desktop: single row full text + wider popup; Mobile: normal wrapping.
                                          noWrapOptions={!isMobile}
                                          showFullOptionText={!isMobile}
                                          contentWidthMode={isMobile ? "trigger" : "auto"}
                                          disabled={deleteDisabledWhenLinked}
                                        />
                                      </div>
                                      {balance !== undefined && (
                                        <div className={cn("text-[10px] font-semibold mt-1", balance < 0 ? "text-red-600" : "text-green-600")}>
                                          Bal: {formatCurrency(balance, { noSuffix: true, noAnimation: true })} {balance < 0 ? 'Dr' : 'Cr'}
                                        </div>
                                      )}
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              
                              {/* Row 2: Salary + Tax — tax ki min width half (pehle 12rem); upper max screen/fr se barhegi. */}
                              <div className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,1fr)] gap-[2px]">
                                <FormField 
                                  control={form.control} 
                                  name={`lineItems.${index}.salary`} 
                                  render={({ field }: any) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Salary Amount</FormLabel>
                                      <FormControl>
                                        <Input 
                                          type="number" 
                                          value={field.value || ''} 
                                          onChange={(e) => {
                                            const value = e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                                            field.onChange(value);
                                          }}
                                          onBlur={field.onBlur}
                                          className="h-9 text-xs" 
                                          disabled={deleteDisabledWhenLinked}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField 
                                  control={form.control} 
                                  name={`lineItems.${index}.taxAccountId`} 
                                  render={({ field }: any) => (
                                    <FormItem data-ocr-field="tax">
                                      <div className="flex items-center justify-between gap-1 flex-wrap">
                                        <FormLabel className={cn("text-xs", taxLineNeedsCopyChip(index) && "text-red-600 font-semibold")}>Tax</FormLabel>
                                        {taxLineNeedsCopyChip(index) && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                            onClick={() =>
                                              onCopyMissingCategory?.("tax", {
                                                addSalaryField: "taxAccountId",
                                                addSalaryLineIndex: index,
                                              })
                                            }
                                            disabled={isCopyingMissingMasters}
                                          >
                                            {isCopyingMissingMasters ? "…" : "Copy"}
                                          </Button>
                                        )}
                                      </div>
                                      <div className="flex min-w-0 w-full items-start gap-2">
                                      <div className="[&_button]:h-9 [&_button]:text-xs min-w-0 flex-1">
                                        <Combobox
                                          triggerClassName={cn(taxLineNeedsCopyChip(index) && "!border-red-400 !bg-red-100/80 !text-red-700")}
                                          // Searchable tax picker so user can type and quickly find tax.
                                          options={[
                                            { value: "none", label: "None" },
                                            ...processedTaxes.filter((tax) => !isPlaceholderNoneTax(tax) || tax.id === field.value).map((tax) => ({ value: tax.id, label: `${tax.name} @ ${tax.rate}%` })),
                                          ]}
                                          value={field.value || "none"}
                                          onChange={(value, newName) => {
                                            if (value === "add-new") {
                                              setActiveLineIndex(index);
                                              setIsCreateTaxOpen(true);
                                              setTimeout(() => {
                                                document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: newName }));
                                              }, 100);
                                            } else {
                                              field.onChange(value === "none" ? "" : value);
                                            }
                                          }}
                                          placeholder="Search tax"
                                          addNewLabel="+ Add New Tax"
                                          // Desktop: single row full text + wider popup; Mobile: normal wrapping.
                                          noWrapOptions={!isMobile}
                                          showFullOptionText={!isMobile}
                                          contentWidthMode={isMobile ? "trigger" : "auto"}
                                          disabled={deleteDisabledWhenLinked}
                                        />
                                      </div>
                                      {String(field.value || "").trim() ? (
                                        <SalePurchaseTdsVerifyTick
                                          control={form.control}
                                          name={`lineItems.${index}.isTdsVerified`}
                                          // Linked bill-wise: amounts locked, TDS Verify still editable (no unlink needed)
                                          disabled={editingDisabled}
                                          compact
                                        />
                                      ) : null}
                                      </div>
                                      {taxBalance !== undefined && (
                                        <div className={cn("text-[10px] font-semibold mt-1", taxBalance < 0 ? "text-red-600" : "text-green-600")}>
                                          Bal: {formatCurrency(taxBalance, { noSuffix: true, noAnimation: true })} {taxBalance < 0 ? 'Dr' : 'Cr'}
                                        </div>
                                      )}
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              
                              {/* Row 3: Taxable Amount, Tax Amount, After Tax Salary (3 columns) */}
                              <div className="grid grid-cols-3 gap-[2px]">
                                <div>
                                  <FormLabel className="text-xs">Taxable Amount</FormLabel>
                                  <Input 
                                    value={Number(form.watch(`lineItems.${index}.salary`) || 0).toFixed(2)} 
                                    readOnly 
                                    className="h-9 text-xs bg-muted text-right"
                                  />
                                </div>
                                <div>
                                  <FormLabel className="text-xs">Tax Amount</FormLabel>
                                  <Input 
                                    value={Number(form.watch(`lineItems.${index}.taxAmount`) || 0).toFixed(2)} 
                                    readOnly 
                                    className="h-9 text-xs bg-muted text-right"
                                  />
                                </div>
                                <div>
                                  <FormLabel className="text-xs">After Tax Salary</FormLabel>
                                  <Input 
                                    value={Number(form.getValues(`lineItems.${index}.afterTaxSalary`) || 0).toFixed(2)} 
                                    readOnly 
                                    className="h-9 text-xs bg-muted text-right"
                                  />
                                </div>
                              </div>
                              
                              {/* Row 4: Narration (full width) */}
                              <div className="w-full">
                                <FormField 
                                  control={form.control} 
                                  name={`lineItems.${index}.narration`} 
                                  render={({ field }: any) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Narration</FormLabel>
                                      <FormControl>
                                        <Input 
                                          placeholder="e.g. Salary for Baisakh" 
                                          {...field}
                                          className="h-9 text-xs"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              
                              {/* Remove Button */}
                              {!isPaymentMode && fields.length > 1 && (
                                <div className="flex justify-end">
                                  <Button 
                                    type="button" 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => remove(index)}
                                    className="h-8 w-8 p-0"
                                    disabled={deleteDisabledWhenLinked}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive"/>
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {/* Add Row Button */}
                        {!isPaymentMode && (
                          <div className="border-t px-[2px] py-2">
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="sm" 
                              onClick={() => append({staffId: "", salary: 0, narration: "", type: "credit", taxAccountId: "", taxAmount: 0, isTdsVerified: false, afterTaxSalary: 0, rate: 0 })}
                              className="text-xs h-8"
                              disabled={deleteDisabledWhenLinked}
                            >
                              <PlusCircle className="mr-2 h-4 w-4"/> Add Row
                            </Button>
                          </div>
                        )}
                        {/* Totals Row */}
                        <div className="border-t px-[2px] py-2 space-y-1">
                          <div className="flex justify-between text-xs font-bold">
                            <span>Total Salary:</span>
                            <span>{totalSalary.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs font-bold">
                            <span>Total Tax:</span>
                            <span>{totalTaxAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs font-bold">
                            <span>Total After Tax:</span>
                            <span>{totalAfterTaxSalary.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Desktop: Original Table */}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {/* PC: existing "Staff Member" label ke right Copy chip — row ke andar extra "Staff Member" label na dikhe. */}
                            <TableHead className="w-1/4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>Staff Member</span>
                                {firstStaffCopyRowIndex !== null && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                    onClick={() =>
                                      onCopyMissingCategory?.("staff", {
                                        addSalaryField: "staffId",
                                        addSalaryLineIndex: firstStaffCopyRowIndex,
                                      })
                                    }
                                    disabled={isCopyingMissingMasters}
                                  >
                                    {isCopyingMissingMasters ? "…" : "Copy"}
                                  </Button>
                                )}
                              </div>
                            </TableHead>
                            <TableHead>Salary Amount</TableHead>
                            {/* PC Tax label ke right Copy chip — body row me extra chip/label avoid. */}
                            <TableHead className="min-w-[10.5rem] w-auto max-w-none">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>TDS</span>
                                {(() => {
                                  const taxIdx = (watchedLineItems || [])
                                    .map((li: any, i: number) => (String(li?.taxAccountId || "").trim() ? i : -1))
                                    .filter((i: number) => i >= 0);
                                  if (taxIdx.length === 0) return null;
                                  const allVerified = taxIdx.every((i: number) => (watchedLineItems as any[])[i]?.isTdsVerified === true);
                                  return (
                                    <TdsVerifyTickBox
                                      checked={allVerified}
                                      gapLeft={10}
                                      showLabel
                                      verifiedText="Verified"
                                      unverifiedText="Unverified"
                                      labelGap={5}
                                      disabled={editingDisabled}
                                      onToggle={() => {
                                        // Header tick toggles every row that has a tax selected (state stays per-row).
                                        taxIdx.forEach((i: number) =>
                                          form.setValue(`lineItems.${i}.isTdsVerified` as any, !allVerified, { shouldDirty: true })
                                        );
                                      }}
                                    />
                                  );
                                })()}                                {firstTaxCopyRowIndex !== null && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                    onClick={() =>
                                      onCopyMissingCategory?.("tax", {
                                        addSalaryField: "taxAccountId",
                                        addSalaryLineIndex: firstTaxCopyRowIndex,
                                      })
                                    }
                                    disabled={isCopyingMissingMasters}
                                  >
                                    {isCopyingMissingMasters ? "…" : "Copy"}
                                  </Button>
                                )}
                              </div>
                            </TableHead>
                            <TableHead>Taxable Amount</TableHead>
                            <TableHead>Tax Amount</TableHead>
                            <TableHead>After Tax Salary</TableHead>
                            <TableHead>Narration</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fields.map((field, index) => {
                            const staffId = form.watch(`lineItems.${index}.staffId`);
                            const balance = processedStaff.find(s => s.id === staffId)?.balance;
                            const taxAccountId = form.watch(`lineItems.${index}.taxAccountId`);
                            const taxBalance = processedTaxes.find(t => t.id === taxAccountId)?.balance;
                            
                            return (
                              <TableRow key={field.id} className="[&>td]:align-top">
                                {/* Keep desktop salary cells top-aligned so balance helper text does not visually lift only the staff/tax fields. */}
                                <TableCell>
                                  <FormField control={form.control} name={`lineItems.${index}.staffId`} render={({ field }: any) => (<FormItem>
                                        {/* Desktop row: existing header label handles Copy chip; yahan sirf staff combobox. */}
                                        <div className="min-w-0 w-full overflow-hidden [&_button]:h-9">
                                        <Combobox
                                          triggerClassName={cn(staffLineNeedsCopyChip(index) && "!border-red-400 !bg-red-100/80 !text-red-700")}
                                          options={salaryStaffOptions}
                                          value={field.value}
                                          onChange={(value, newName) => {
                                            if (value === "add-new") {
                                              openCreateStaffDialog(index, newName);
                                            } else {
                                              field.onChange(value);
                                              const selectedStaff = processedStaff.find(s => s.id === value);
                                              if (selectedStaff) {
                                                  form.setValue(`lineItems.${index}.salary`, Number(selectedStaff.salary) || 0);
                                                  // Auto-fill narration using selected staff/account name.
                                                  form.setValue(`lineItems.${index}.narration`, `Add salary for ${selectedStaff.name}`);
                                              }
                                            }
                                          }}
                                          placeholder="Select Staff"
                                          addNewLabel="+ Add New Staff"
                                          // Desktop: single row full text + wider popup; Mobile: normal wrapping.
                                          noWrapOptions={!isMobile}
                                          showFullOptionText={!isMobile}
                                          contentWidthMode={isMobile ? "trigger" : "auto"}
                                          disabled={deleteDisabledWhenLinked}
                                        />
                                        </div>
                                         {balance !== undefined && (
                                            <div className={cn("text-xs font-semibold mt-1", balance < 0 ? "text-red-600" : "text-green-600")}>
                                                Bal: {formatCurrency(balance, { showDrCr: true, noAnimation: true })}
                                            </div>
                                        )}
                                        <FormMessage /></FormItem>)}/>
                                </TableCell>
                                <TableCell><FormField control={form.control} name={`lineItems.${index}.salary`} render={({ field }: any) => (<FormItem><FormControl><Input type="number" value={field.value || ''} onChange={(e) => { const value = e.target.value === '' ? '' : parseFloat(e.target.value) || 0; field.onChange(value); }} onBlur={field.onBlur} disabled={deleteDisabledWhenLinked} /></FormControl><FormMessage /></FormItem>)}/></TableCell>
                                 <TableCell className="min-w-[10.5rem] w-auto max-w-none align-top">
                                    <FormField control={form.control} name={`lineItems.${index}.taxAccountId`} render={({ field }: any) => (
                                        <FormItem data-ocr-field="tax">
                                            {/* Tax combo: chhota minimum, zyada jagah table/layout flexibly de sakta hai. */}
                                            <div className="flex items-start gap-2 min-w-0 w-full">
                                              <div className="min-w-0 flex-1 [&_button]:h-9">
                                            <Combobox
                                              triggerClassName={cn(taxLineNeedsCopyChip(index) && "!border-red-400 !bg-red-100/80 !text-red-700")}
                                              // Searchable tax picker on desktop salary rows.
                                              options={[
                                                { value: "none", label: "None" },
                                                ...processedTaxes.filter((tax) => !isPlaceholderNoneTax(tax) || tax.id === field.value).map((tax) => ({ value: tax.id, label: `${tax.name} @ ${tax.rate}%` })),
                                              ]}
                                              value={field.value || "none"}
                                              onChange={(value, newName) => {
                                                if (value === "add-new") {
                                                  setActiveLineIndex(index);
                                                  setIsCreateTaxOpen(true);
                                                  setTimeout(() => {
                                                    document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: newName }));
                                                  }, 100);
                                                } else {
                                                  field.onChange(value === "none" ? "" : value);
                                                }
                                              }}
                                              placeholder="Search tax"
                                              addNewLabel="+ Add New Tax"
                                              // Desktop: single row full text + wider popup; Mobile: normal wrapping.
                                              noWrapOptions={!isMobile}
                                              showFullOptionText={!isMobile}
                                              contentWidthMode={isMobile ? "trigger" : "auto"}
                                              disabled={deleteDisabledWhenLinked}
                                            />
                                              </div>
                                              {/* Desktop row: Tax copy chip header label me hai; row me combobox + Verify. */}
                                            </div>
                                            {taxBalance !== undefined && (
                                                <div className={cn("text-xs font-semibold mt-1", taxBalance < 0 ? "text-red-600" : "text-green-600")}>
                                                    Bal: {formatCurrency(taxBalance, { showDrCr: true, noAnimation: true })}
                                                </div>
                                            )}
                                        </FormItem>
                                    )}/>
                                </TableCell>
                                <TableCell><Input value={Number(form.watch(`lineItems.${index}.salary`) || 0).toFixed(2)} readOnly className="bg-muted text-right"/></TableCell>
                                <TableCell><Input value={Number(form.watch(`lineItems.${index}.taxAmount`) || 0).toFixed(2)} readOnly className="bg-muted text-right"/></TableCell>
                                <TableCell><Input value={Number(form.getValues(`lineItems.${index}.afterTaxSalary`) || 0).toFixed(2)} readOnly className="bg-muted text-right"/></TableCell>
                                <TableCell><FormField control={form.control} name={`lineItems.${index}.narration`} render={({ field }: any) => (<FormItem><FormControl><Input placeholder="e.g. Salary for Baisakh" {...field}/></FormControl><FormMessage /></FormItem>)}/></TableCell>
                                <TableCell>{!isPaymentMode && (<Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={deleteDisabledWhenLinked}><Trash2 className="h-4 w-4 text-destructive"/></Button>)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell className="font-bold">Total</TableCell>
                            <TableCell className="font-bold text-right">{totalSalary.toFixed(2)}</TableCell>
                            <TableCell></TableCell>
                            <TableCell className="font-bold text-right">{totalSalary.toFixed(2)}</TableCell>
                            <TableCell className="font-bold text-right">{totalTaxAmount.toFixed(2)}</TableCell>
                            <TableCell className="font-bold text-right">{totalAfterTaxSalary.toFixed(2)}</TableCell>
                            <TableCell colSpan={2}></TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                      {!isPaymentMode && (
                        <Button type="button" variant="outline" size="sm" onClick={() => append({staffId: "", salary: 0, narration: "", type: "credit", taxAccountId: "", taxAmount: 0, isTdsVerified: false, afterTaxSalary: 0, rate: 0 })} disabled={deleteDisabledWhenLinked}>
                          <PlusCircle className="mr-2 h-4 w-4"/> Add Row
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {/* Keep attachment block above link block on desktop too (no same-row split). */}
                <div className={cn("grid grid-cols-1 gap-4", !isPaymentMode && "md:grid-cols-1")}>
                  {!isPaymentMode && (
                    <div className="order-2 md:order-2 space-y-2 rounded-lg border-2 border-rose-300/80 bg-rose-50 p-3">
                      {!shouldShowBillWiseSection ? (
                        <div className="pb-1">
                          {/* Add/new and non-linked edit starts collapsed; click reveals link card. */}
                          <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSection(true)}>Show Link</Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 font-medium">
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                            <span>{isTaxBillWiseLinkMode ? "Link for tax" : "Link for bill wise"}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{billWiseLinkableVoucherCount} voucher(s) available to link.</p>
                          <div className="flex gap-2 flex-wrap">
                            <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                              <input type="radio" name="linkBalanceKind" checked={linkBalanceKind === "net"} onChange={() => setLinkBalanceKind("net")} className="rounded-full" />
                              <span>After Tax Salary</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                              <input type="radio" name="linkBalanceKind" checked={linkBalanceKind === "tax"} onChange={() => setLinkBalanceKind("tax")} className="rounded-full" />
                              <span>Tax balance</span>
                            </label>
                          </div>
                          {billWiseCardRows.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {linkBalanceKind === "tax"
                                ? "No tax-linked payment details."
                                : "No after tax salary linked payment details."}
                            </p>
                          ) : (
                            <div className="overflow-x-auto -mx-1 min-w-0 scrollbar-slim-dim-extra">
                              <table className="w-full text-sm border-collapse min-w-[400px]">
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
                                  {billWiseCardRows.map((p, idx) => {
                                    const rowDate = p.date ? (typeof (p.date as any)?.toDate === "function" ? (p.date as any).toDate() : new Date(p.date as string | number)) : null;
                                    return (
                                      <tr
                                        key={`${p.id}-${idx}`}
                                        role="button"
                                        tabIndex={0}
                                        className="cursor-pointer hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 border-b border-border/30 last:border-b-0"
                                        onClick={handleOpenBillWiseDialog}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            handleOpenBillWiseDialog();
                                          }
                                        }}
                                      >
                                        <td className="p-2 text-muted-foreground whitespace-nowrap">{p.id === OPENING_BALANCE_VOUCHER_ID ? "—" : (rowDate ? (dateSystem === "BS" ? formatDateBS(rowDate) : formatDate(rowDate)) : "—")}</td>
                                        <td className="p-2 font-medium whitespace-nowrap">{p.voucherNumber ?? "—"}</td>
                                        <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(p.totalAmount, { noSuffix: true, noAnimation: true })}</td>
                                        <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(p.linkedOnOthers, { noSuffix: true, noAnimation: true })}</td>
                                        <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(p.currentLinked, { noSuffix: true, noAnimation: true })}</td>
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
                                <span className="text-muted-foreground truncate leading-tight">Linked</span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end min-h-0 min-w-0 overflow-hidden">
                                <span className="truncate text-right whitespace-nowrap leading-tight">{formatCurrency(billWiseLinkedTotal, { noSuffix: true, noAnimation: true })}</span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                                <span className="truncate leading-tight">Balance</span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                                <span className={cn("truncate text-right whitespace-nowrap leading-tight", billWiseRemainingTotal === 0 ? "text-green-600 font-semibold" : "")}>
                                  {billWiseRemainingTotal === 0 ? "Settled" : formatCurrency(billWiseRemainingTotal, { noSuffix: true, noAnimation: true })}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Button type="button" variant="outline" size="sm" className="w-fit" disabled={!deleteDisabledWhenLinked && (voucher?.id ?? savedVoucherIdRef) && billWiseRemainingTotal <= 0} onClick={handleOpenBillWiseDialog}>
                                <Link2 className="h-4 w-4 mr-2" />
                                {isTaxBillWiseLinkMode ? "Link payment to tax" : "Add Link"}
                              </Button>
                              <Button type="button" variant="outline" size="sm" className="w-fit" disabled={autoLinkSaving || ((voucher?.id ?? savedVoucherIdRef) ? (billWiseRemainingTotal <= 0 || linkSourcesOldestFirst.length === 0) : false)} onClick={handleAutoLinkFromCard}>
                                {autoLinkSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                                Auto Link
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Attachment + narration block: mobile narration below, desktop narration at right. */}
                  <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-amber-300/80 bg-amber-50 p-3", !isPaymentMode && "order-1 md:order-1")}>
                    <FormItem>
                      <FormLabel>Attach Files (Optional)</FormLabel>
                      {showPdfAsImageToggle && (
                        <VoucherPdfAsImageToggle
                          existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                          id="voucher-save-pdf-as-image-salary-shared"
                          checked={savePdfAsImage}
                          onCheckedChange={setSavePdfAsImage}
                          disabled={!allowAttachments || fileAttachLockedByDialog || fileAttachmentLimits.maxFileCount === 0}
                          className="mb-2"
                        />
                      )}
                      <VoucherOcrRefreshBar ocr={ocr} />
                      <RestrictedFileUploader>
                        <div className="flex flex-wrap gap-4">
                          {files.map((file, index) => (
                            <FilePreview
                              key={index}
                              file={file}
                              attachmentCompanyId={companyId || undefined}
                              attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                              onRemove={allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete ? () => setFiles(prev => prev.filter((_, i) => i !== index)) : undefined}
                              className={!allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : ""}
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
                                  if (fileAttachLockedByDialog || !allowAttachments || fileAttachmentLimits.maxFileCount === 0) return;
                                  fileInputRef.current?.click();
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
                                  "relative w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center transition-colors",
                                  allowAttachments && fileAttachmentLimits.maxFileCount > 0
                                    ? "text-muted-foreground hover:border-primary cursor-pointer"
                                    : "pointer-events-none text-muted-foreground/50 border-muted-foreground/25 cursor-not-allowed opacity-50"
                                )}
                              >
                                <PlusCircle className="h-6 w-6" />
                                <span className="text-xs mt-1">Add File</span>
                              </AttachmentHoldPasteSurface>
                              <input
                                id={attachFileInputId}
                                type="file"
                                className="sr-only"
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
                            </>
                          )}
                        </div>
                      </RestrictedFileUploader>
                    </FormItem>
                    <FormField
                      control={form.control}
                      name="narration"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="bill-no" className="min-w-0">
                          <FormLabel>Overall Narration</FormLabel>
                          <FormControl>
                            {/* Overall narration: PC static me lambi text ke liye resize + scroll */}
                            <Textarea placeholder="e.g. Salary for the month of Baisakh" className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
            </div>
          </ScrollArea>

          {isFormEditing && (
            <div className={cn(
              "border-t px-[2px] min-w-0 max-w-full overflow-x-hidden",
              isMobile ? "mt-[3px] pt-[3px] pb-[3px] w-full" : "pt-4 flex flex-col gap-4 md:flex-row md:justify-between md:items-center"
            )}>
            {isMobile ? (
              <div className={cn("grid grid-cols-3 gap-2 w-full", VOUCHER_BUTTONS_CLASS)}>
                {/* Row 0: Delete (left) | History (middle) | Save & Print (right) */}
                <Button type="button" variant="destructive" className="w-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                      Delete
                    </Button>
                <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || !showHistoryButton || !onOpenHistory} className={cn("w-full", BTN_HISTORY_CLASS)}>
                  History
                </Button>
                <Button type="button" className={cn("w-full", BTN_PRINT_CLASS)} disabled>
                  Save & Print
                </Button>
                {/* Row 1: Cancel | Save | Approve (right) — mobile par approve hamesha daayen */}
                <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("w-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || ((!!voucher?.id || !!savedVoucherIdRef) && !isAnyDirty)} className={cn("w-full", BTN_SAVE_CLASS)}>
                  {isLoading ? "..." : "Save"}
                </Button>
                <Button type="button" onClick={async (e) => { e.preventDefault(); if (showSaveAndApproveOnCreate && !voucher?.id) { await handleFormSubmit(e, { approveAfterSave: true }); } else if (isAnyDirty) { await handleFormSubmit(e, { approveAfterSave: true }); } else { onApprove?.(); } }} disabled={showSaveAndApproveOnCreate && !voucher?.id ? (isLoading || isAttachmentProcessing || isApproving || editingDisabled || recurringVoucherSaveBlocked) : (isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || recurringVoucherSaveBlocked || (!!voucher?.isApproved && !isAnyDirty))} className={cn("w-full", BTN_APPROVE_CLASS)}>
                  {isApproving ? "..." : "Save & Approve"}
                </Button>
              </div>
            ) : (
              <>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || !onOpenHistory} className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}>
                    <History className="mr-2 h-4 w-4" /> History
                  </Button>
                  <Button type="button" variant="destructive" className="w-full md:w-auto shrink-0 rounded-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                </div>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap md:gap-4", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={!!voucher || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save & New
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}>
                    <Printer className="mr-2 h-4 w-4" />
                    Save & Print
                  </Button>
                  <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || ((!!voucher?.id || !!savedVoucherIdRef) && !isAnyDirty)} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                  <Button type="button" onClick={async (e) => { e.preventDefault(); if (showSaveAndApproveOnCreate && !voucher?.id) { await handleFormSubmit(e, { approveAfterSave: true }); } else if (isAnyDirty) { await handleFormSubmit(e, { approveAfterSave: true }); } else { onApprove?.(); } }} disabled={showSaveAndApproveOnCreate && !voucher?.id ? (isLoading || isAttachmentProcessing || isApproving || editingDisabled || recurringVoucherSaveBlocked) : (isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || recurringVoucherSaveBlocked || (!!voucher?.isApproved && !isAnyDirty))} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                    {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Save & Approve
                  </Button>
                </div>
              </>
            )}
          </div>
          )}
        </form>
      </Form>
      <Dialog open={isLinkPaymentDialogOpen} onOpenChange={setIsLinkPaymentDialogOpen}>
        <DialogContent
          overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
          className={cn(
            NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
            "max-w-4xl max-h-[85vh] flex flex-col rounded-lg pt-3 px-[3px]",
            isMobile && "left-[2px] right-[2px] translate-x-0 w-auto max-w-none h-[85vh] max-h-[85vh] pt-2"
          )}
          hideCloseButton
        >
          <DialogHeader className="flex-shrink-0 space-y-0.5 text-center sm:text-center">
            <p className="text-xs text-muted-foreground leading-tight">
              {isTaxBillWiseLinkMode ? "Link for tax" : "Link for salary"}
            </p>
            <DialogTitle className="text-xl leading-tight">
              {isTaxBillWiseLinkMode ? "Link payment to tax" : "Link payment to salary"}
            </DialogTitle>
            {totalForView > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-sm pt-1 px-1">
                <span className="text-muted-foreground">Required: <strong className="text-foreground">{formatCurrency(totalForView)}</strong></span>
                <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(selectedLinkTotal)}</strong></span>
                <span className="text-muted-foreground">
                  Balance: {salaryRemainingToLink === 0 ? <strong className="text-green-600">Settled</strong> : <strong className="text-foreground">{formatCurrency(salaryRemainingToLink)}</strong>}
                </span>
                {selectedLinkTotal < totalForView && selectedLinkTotal > 0 && (
                  <span className="text-amber-600 font-medium">Choose more</span>
                )}
              </div>
            )}
          </DialogHeader>
          <div className="space-y-4 flex-1 min-h-0 flex flex-col">
            {/* To Voucher: same layout as Link payment to this sale (pic 1) */}
            <p className="text-sm font-medium text-muted-foreground shrink-0 text-center">To Voucher</p>
            <div className="rounded-md border flex-shrink-0 overflow-x-auto">
              <table className="table-row-stripe-7 w-full text-sm border-collapse min-w-[400px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">To</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Linked</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b last:border-b-0">
                    <td className="p-2 text-muted-foreground whitespace-nowrap">{voucher?.date ? (() => { const d = typeof (voucher.date as any)?.toDate === "function" ? (voucher.date as any).toDate() : voucher.date instanceof Date ? voucher.date : new Date(voucher.date as string | number); return d && !isNaN(d.getTime()) ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : `${formatDateBS(d)} (${formatDate(d)})`) : "—"; })() : "—"}</td>
                    <td className="p-2 font-medium whitespace-nowrap">{voucher?.voucherNumber ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">
                      {isTaxBillWiseLinkMode ? salaryLinkTaxLabel : STAFF_ENTITY_LABEL}
                    </td>
                    <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(totalForView, { noSuffix: true })}</td>
                    <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(selectedLinkTotal, { noSuffix: true })}</td>
                    <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(salaryRemainingToLink, { noSuffix: true })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1 text-center">From Voucher</p>
            <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block text-center">
              {isTaxBillWiseLinkMode
                ? `Payments & journal vouchers (same tax · ${salaryLinkTaxLabel}) (only linkable or already selected)`
                : "Payments & journal vouchers (same staff Dr) (only linkable or already selected)"}
            </p>
            <div className="flex-1 min-h-0 border rounded-md overflow-auto scrollbar-slim-dim">
              {paymentOutsForLinkDialog.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {isTaxBillWiseLinkMode
                    ? taxAccountIdsFromSalary.length === 0
                      ? "Select a tax account on salary lines first."
                      : `No payments or journal vouchers for ${salaryLinkTaxLabel} to link or edit.`
                    : staffIdsFromSalary.length === 0
                      ? "Add staff in Salary Details first."
                      : "No payments or journal vouchers for this staff to link or edit."}
                </p>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  <table className="table-row-stripe-7 w-full text-sm border-collapse min-w-[600px]">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 w-10 whitespace-nowrap"></th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">From</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Other Linked</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Current Link</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Linkable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentOutsForLinkDialog.map((row: { id: string; voucherNumber?: string; date?: unknown; amount?: number; remaining?: number; allocatedToOthers?: number; sourceType?: "payment_out" | "journal" | "opening_balance" }) => {
                        const d = row.date ? (typeof (row.date as any)?.toDate === "function" ? (row.date as any).toDate() : new Date(row.date as string | number)) : null;
                        const dateStr = d && !isNaN(d.getTime()) ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : `${formatDateBS(d)} (${formatDate(d)})`) : "—";
                        // Normalize all row amounts before rendering so Opening Balance never shows object text in amount cells.
                        const rowAmount = Number(row.amount ?? 0) || 0;
                        const linked = Number(linkPaymentAmounts[row.id] ?? 0) || 0;
                        const remaining = Number(row.remaining ?? 0) || 0;
                        const otherLinked = Number(row.allocatedToOthers ?? 0) || 0;
                        const remainingToLink = salaryRemainingToLink;
                        const rowMax = remaining;
                        const maxAllowed = Math.min(rowMax, remainingToLink + linked);
                        const cannotAddMore = remainingToLink <= 0 && linked === 0;
                        return (
                          <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                            <td className="p-2 w-10 whitespace-nowrap align-middle">
                              <Checkbox
                                checked={linked > 0}
                                disabled={cannotAddMore}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    const cap = maxAllowed > 0 ? maxAllowed : rowMax;
                                    const initial = cap > 0 ? (maxAllowed > 0 ? maxAllowed : Math.min(0.01, rowMax)) : 0;
                                    if (initial > 0) setLinkPaymentAmounts((prev) => ({ ...prev, [row.id]: initial }));
                                  } else {
                                    setLinkPaymentAmounts((prev) => ({ ...prev, [row.id]: 0 }));
                                  }
                                }}
                                title={cannotAddMore ? "Required amount already linked" : linked > 0 ? "Clear this row" : "Include this row"}
                              />
                            </td>
                            <td className="p-2 text-muted-foreground whitespace-nowrap align-middle">{dateStr}</td>
                            <td className="p-2 font-medium whitespace-nowrap align-middle">{row.voucherNumber ?? "—"}</td>
                            <td className="p-2 whitespace-nowrap align-middle">
                              {row.id === OPENING_BALANCE_VOUCHER_ID
                                ? "Opening Balance"
                                : row.sourceType === "journal"
                                  ? "journal voucher"
                                  : "payment"}
                            </td>
                            <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(rowAmount, { noSuffix: true })} Dr</td>
                            <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(otherLinked, { noSuffix: true })} Dr</td>
                            <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(linked, { noSuffix: true })} Dr</td>
                            <td className="p-2 text-right font-medium whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(Math.max(0, remaining - linked), { noSuffix: true })} Dr</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {selectedLinkTotal < totalForView && selectedLinkTotal > 0 && (
              <p className="text-sm text-amber-600 font-medium px-1">Selected total is less than required. Choose more vouchers to cover the amount.</p>
            )}
            <div className="flex flex-shrink-0 items-center gap-2 pt-2 border-t flex-wrap justify-between">
              <Button size="sm" onClick={() => setIsLinkPaymentDialogOpen(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
                Cancel
              </Button>
              <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0"
                  disabled={totalForView <= 0 || paymentOutsForLinkDialog.length === 0}
                  onClick={() => {
                    const suggested: Record<string, number> = {};
                    linkedPayments.forEach((p) => { suggested[p.id] = getSalaryLinkAmountByKind(p, linkBalanceKind); });
                    let remainingToAllocate = totalForView - Object.values(suggested).reduce((s, a) => s + Number(a || 0), 0);
                    if (
                      !isTaxBillWiseLinkMode &&
                      obLinkState.showOBRow &&
                      remainingToAllocate > 0 &&
                      obLinkState.obLinkable > 0
                    ) {
                      const fromOB = Math.min(obLinkState.obLinkable, remainingToAllocate);
                      suggested[OPENING_BALANCE_VOUCHER_ID] = fromOB;
                      remainingToAllocate -= fromOB;
                    }
                    for (const po of linkSourcesOldestFirst) {
                      if (remainingToAllocate <= 0) break;
                      const allocate = Math.min(po.remaining, remainingToAllocate);
                      if (allocate > 0) { suggested[po.id] = (suggested[po.id] ?? 0) + allocate; remainingToAllocate -= allocate; }
                    }
                    setLinkPaymentAmounts(suggested);
                    sonnerToast.success("Auto link amounts filled. Review and DONE.");
                  }}
                >
                  <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                  Auto Link
                </Button>
                {/* Reset should apply immediately without confirmation popup. */}
                <Button type="button" size="sm" onClick={() => setLinkPaymentAmounts({})} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
                  <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                  Reset
                </Button>
                {/* Keep DONE available after Reset so user can confirm unlink-all in one click. */}
                <Button
                  onClick={handleLinkPayment}
                  disabled={linkPaymentSaving || paymentOutsForLinkDialog.length === 0}
                  className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0"
                >
                  {linkPaymentSaving ? "Saving..." : "DONE"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <CreateStaffDialog
        onStaffCreated={handleStaffCreated}
        isOpen={isCreateStaffOpen}
        onOpenChange={(open) => {
          setIsCreateStaffOpen(open);
          if (!open) setCreateStaffDefaultName("");
        }}
        groups={[]}
        defaultName={createStaffDefaultName}
      />
      <CreateTaxDialog onTaxCreated={handleTaxCreated} isOpen={isCreateTaxOpen} onOpenChange={setIsCreateTaxOpen} />
      <CreateExpenseAccountDialog onExpenseAccountCreated={handleExpenseAccountCreated} isOpen={isCreateExpenseOpen} onOpenChange={setIsCreateExpenseOpen} />
      <VoucherDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="salary"
        entityName={voucher?.voucherNumber || "this salary voucher"}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
        busy={isLoading}
      />
    </>
  );
}
