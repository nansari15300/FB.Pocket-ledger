"use client";

import { useReconciledPointGuard } from "@/components/vouchers/ReconciledPointGuardContext";
import { addDoc, updateDoc, deleteDoc } from "@/lib/writeGateway/pbWrites";
import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar, VoucherOcrAiCopilot, useAiCopilotLayout, useCopilotThumb } from "@/modules/ocr";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useHealStaleTdsReverseLinks } from "@/hooks/useHealStaleTdsReverseLinks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { isNonClearingVoucherBankAccount } from "@/lib/voucherBankCashAccounts";
import {
  specialAccountAllowsPaymentIn,
  userIsSpecialAccountOwner,
} from "@/lib/specialAccountUsage";
import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { VoucherNumberInputWithRefresh } from "@/components/vouchers/VoucherNumberInputWithRefresh";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, Trash2, Upload, FileText, PlusCircle, Crown, Printer, Link2, History, CheckCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { nestedVoucherAlertShell } from "@/lib/dialogShellChrome";
import {
  mapPartiesForVoucherCombobox,
  mapStaffForVoucherCombobox,
  mapTaxesForVoucherCombobox,
  mapExpenseAccountsForVoucherCombobox,
  mapBankAccountsForVoucherCombobox,
} from "@/lib/masterAccountFreeze/comboboxOptions";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore, storage } from "@/lib/plClientSession";
import { collection, serverTimestamp, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { format, startOfDay } from "date-fns";
import { ScrollArea } from "../ui/scroll-area";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";
import type { Party } from "@/components/party/types";
import type { Account } from "@/components/bank-cash/types";
import type { Tax } from "@/components/tax/types";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { useDate } from "@/hooks/useDate";
import usePermissions from "@/hooks/usePermissions";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";
import { toast as sonnerToast } from "sonner";
import {
  replaceVoucherSaveLoadingWithShortSuccess,
  beginVoucherSaveLoadingOrBlock,
  voucherSaveErrorToast,
  runWithVoucherLinkSaveProgress,
} from "@/lib/voucherSaveUi";
import BsDatePicker from "../ui/BsDatePicker";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Staff } from "@/components/staff/types";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { appendCompressedVoucherAttachmentsToState as __frozenAppendAttachments, handleVoucherAttachmentInputChange as __frozenAttachmentInputChange, useVoucherAttachmentProcessing } from "@/lib/appendCompressedVoucherAttachments";
import { ocrWrapAppend, ocrWrapInputChange } from "@/modules/ocr";
/** OCR reads the ORIGINAL upload: frozen helpers wrapped at the call site only (helper code unchanged). */
const appendCompressedVoucherAttachmentsToState = ocrWrapAppend(__frozenAppendAttachments);
const handleVoucherAttachmentInputChange = ocrWrapInputChange(__frozenAttachmentInputChange);
import { voucherAttachmentUrlsForFormState } from "@/lib/voucherAttachmentNormalize";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { Combobox } from "@/components/ui/combobox";
import { FilePreview } from "../vouchers/FilePreview";
import { useVouchers } from "@/hooks/useVouchers";
import { CreateExpenseAccountDialog } from "../expenses/CreateExpenseAccountDialog";
import type { ExpenseAccount } from "../expenses/types";
import { Checkbox } from "../ui/checkbox";
import type { DateRange } from "@/components/ui/ad-calendar";
import { removeTdsLegLinks, saveVoucher, isVoucherLimitError, updateVoucherSpendWiseLinks, syncBillWiseAllocationsToTargetVouchers, patchVoucherFields, softDeleteVoucherMoveToRecycleBin } from "@/lib/voucherActionsClient";
import {
  getVoucherConvertOriginalId,
  getVoucherEditConvertPresentation,
  isVoucherEditConverting,
  markVoucherConvertedInRecycleBin,
} from "@/lib/voucherEditConvert";
import { VoucherEditConvertConfirmDialog } from "@/components/vouchers/VoucherEditConvertConfirmDialog";
import { useVoucherEditConvertSubmitGate } from "@/hooks/useVoucherEditConvertSubmitGate";
import { normalizePrefix } from "@/lib/voucherNumberFormat";
import { getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { loadVoucherDataForDeletePreCheck, resolveVoucherDeleteBackdateDate, voucherDeleteDebugLog } from "@/lib/voucherDeletePreCheck";
import {
  apkEmbeddedSqliteFirstWritesPreferred,
  preferLocalLedgerReads,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import {
  incomingVoucherFileUrlsLookStaleVersusSaved,
  isLocalToRemoteAttachmentUpgrade,
  normalizeFormFileUrlsForSave,
  applyVoucherAttachmentsAfterFormSave,
  finalizeVoucherAttachmentsAfterFormSave,
  uploadVoucherAttachmentFileToFirebase,
  voucherAttachmentFieldsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import { sendTransactionAlert, isAmountOverOneLakh, getChangedFieldLabels } from "@/lib/transactionAlerts";
import { useSearchParams } from "next/navigation";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { VoucherPdfAsImageToggle } from "@/components/vouchers/VoucherPdfAsImageToggle";
import { shouldSuggestPdfAsImage } from "@/lib/voucherAttachmentPdfAsImage";
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResetLinkStateOnCopyTargetCompany } from "@/hooks/useResetLinkStateOnCopyTargetCompany";
import { useCopyDraftFirstSave } from "@/hooks/useCopyDraftFirstSave";
import type { CopyMasterDraftRequestPayload } from "./AddVoucherDialog";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_PC_DATE_ROW, VOUCHER_PC_DATE_BOTH_SLOT, VOUCHER_PC_DATE_BS_PILL, VOUCHER_PC_DATE_AD_PILL } from "@/components/vouchers/voucherButtonStyles";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { getSpendWiseOutflowPartyLabel } from "@/lib/paymentInAllocation";
import { LinkPaymentOutToPaymentInDialog } from "@/components/vouchers/LinkPaymentOutToPaymentInDialog";
import { getOpeningBalanceBaseAmount, SPEND_WISE_OPENING_BALANCE_ID } from "@/lib/spendWiseOpeningBalance";
import { LinkPaymentInToSalaryDialog } from "@/components/vouchers/LinkPaymentInToSalaryDialog";
import { LinkSectionInfoDialog } from "@/components/vouchers/LinkSectionInfoDialog";
import type { Allocation } from "@/lib/payment-allocation-utils";
import { getAllocatedByVoucherId, getAllocationTotal, hasBillWiseAllocationSyncWork, hasPaymentLinks, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import { usePaymentAllocations } from "@/hooks/usePaymentAllocations";
import { useLinkPaymentToTxnsLinkableCount } from "@/hooks/useLinkPaymentToTxnsLinkableCount";
import { printPaymentVoucherReceipt } from "@/lib/printPaymentVoucherReceipt";
import {
  findVoucherInLocalMirrorByNumberAndType,
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
} from "@/lib/localCompanyDocMirror";

const fileSchema = z.object({
  file: z.custom<File | null>().optional(),
});

const formSchema = z.object({
  payeeType: z.enum(["party", "staff", "tax", "income", "other"]),
  partyId: z.string().optional(),
  staffId: z.string().optional(),
  taxAccountId: z.string().optional(),
  incomeAccountId: z.string().optional(),
  payeeName: z.string().optional(),
  accountId: z.string().min(1, "Please select a bank/cash account."),
  date: z.date({ message: "A date is required." }),
  voucherNumber: z.string().min(1, "Voucher number is required."),
  amount: z.coerce.number().min(0.01, "Amount must be positive."),
  narration: z.string().optional(),
  files: z.array(fileSchema).optional(),
}).superRefine((data, ctx) => {
    if (data.payeeType === 'party' && !data.partyId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select a party.", path: ["partyId"] });
    }
    if (data.payeeType === 'staff' && !data.staffId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select a staff member.", path: ["staffId"] });
    }
     if (data.payeeType === 'tax' && !data.taxAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select a tax account.", path: ["taxAccountId"] });
    }
    if (data.payeeType === 'income' && !data.incomeAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select an income account.", path: ["incomeAccountId"] });
    }
    if (data.payeeType === 'other' && !data.payeeName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please enter a payee name.", path: ["payeeName"] });
    }
});

type PaymentInFormValues = z.infer<typeof formSchema>;

/** RHF+zod errors को save validation toast के लिए string में बाँधता है */
function formatPaymentInFormValidationErrors(errors: FieldErrors<PaymentInFormValues>): string {
  const errorMessages: string[] = [];
  if (errors.payeeType?.message) errorMessages.push(`Payee Type: ${errors.payeeType.message}`);
  if (errors.partyId?.message) errorMessages.push(`Party: ${errors.partyId.message}`);
  if (errors.staffId?.message) errorMessages.push(`Staff: ${errors.staffId.message}`);
  if (errors.taxAccountId?.message) errorMessages.push(`Tax Account: ${errors.taxAccountId.message}`);
  if (errors.incomeAccountId?.message) errorMessages.push(`Income Account: ${errors.incomeAccountId.message}`);
  if (errors.payeeName?.message) errorMessages.push(`Payee Name: ${errors.payeeName.message}`);
  if (errors.accountId?.message) errorMessages.push(`Bank/Cash Account: ${errors.accountId.message}`);
  if (errors.date?.message) errorMessages.push(`Date: ${errors.date.message}`);
  if (errors.voucherNumber?.message) errorMessages.push(`Voucher No.: ${errors.voucherNumber.message}`);
  if (errors.amount?.message) errorMessages.push(`Amount: ${errors.amount.message}`);
  return errorMessages.length > 0 ? errorMessages.join(", ") : "Please check the form and try again.";
}

const getVoucherPrefix = (prefixes?: Record<string, string[]>, type?: 'payment_in' | 'direct_income') => {
    if (type === 'direct_income') {
        return (prefixes?.direct_income && prefixes.direct_income[0]) || "DINC-";
    }
    return (prefixes?.payment_in && prefixes.payment_in[0]) || "RCPT-";
}

/** Sirf `next dev` — console filter: `[PaymentIn:attach]`; attachment kyon nahi chal raha trace karne ke liye. */
const TRACE_PAYMENT_IN_ATTACH =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";
function tracePaymentInAttach(msg: string, detail?: Record<string, unknown>) {
  if (!TRACE_PAYMENT_IN_ATTACH) return;
  if (detail && Object.keys(detail).length) console.log("[PaymentIn:attach]", msg, detail);
  else console.log("[PaymentIn:attach]", msg);
}

const getPayeeTypeFromVoucher = (v: any) => {
  if (v?.staffId) return 'staff';
  if (v?.taxAccountId) return 'tax';
  if (v?.type === 'direct_income' || v.incomeAccountId) return 'income';
  if (v?.payeeName) return 'other';
  return 'party';
};

function withSelectedComboboxOption(
  options: { value: string; label: string }[],
  selectedId: string | undefined,
  fallbackLabel?: string
): { value: string; label: string }[] {
  const id = String(selectedId || "").trim();
  if (!id || options.some((o) => o.value === id)) return options;
  return [{ value: id, label: (fallbackLabel || "").trim() || "—" }, ...options];
}

const getInitialFormValues = (voucher?: any): PaymentInFormValues => {
    if (voucher) {
        const rawDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date as string | number | Date);
        const safeDate = Number.isFinite(rawDate.getTime()) ? rawDate : startOfDay(new Date());
        const { id: _dropVoucherId, ...voucherRest } = voucher as Record<string, unknown>;
        const payeeType = getPayeeTypeFromVoucher(voucher);
        const incomeId = voucher.incomeAccountId || voucher.toAccountId || "";
        return {
            ...voucherRest,
            payeeType,
            date: safeDate,
            amount: typeof (voucher.total || voucher.amount) === 'string' 
              ? parseFloat(String(voucher.total || voucher.amount).replace(/,/g, '')) || 0
              : Number(voucher.total || voucher.amount || 0),
            partyId: voucher.partyId || "",
            staffId: voucher.staffId || "",
            payeeName: voucher.payeeName || "",
            incomeAccountId: payeeType === "income" ? incomeId : (voucher.incomeAccountId || ""),
            taxAccountId: voucher.taxAccountId || "",
            voucherNumber: voucher.voucherNumber || "",
            accountId: voucher.accountId || "",
            narration: voucher.narration || "",
            files: voucher.files || [] 
        };
    }
    return {
        payeeType: "party",
        partyId: "",
        staffId: "",
        accountId: "",
        date: startOfDay(new Date()),
        voucherNumber: "",
        amount: 0,
        taxAccountId: "",
        narration: "",
        payeeName: "",
        incomeAccountId: ""
    };
};


export function CreatePaymentInForm({
  voucher,
  onVoucherAction,
  onOpenHistory,
  showHistoryButton,
  defaultTab,
  defaultVoucherData,
  editingDisabled = false,
  deleteDisabledWhenLinked = false,
  showApproveButton = false,
  showSaveAndApproveOnCreate = false,
  onApprove,
  isApproving = false,
  onEffectiveLinksChange,
  /** Copy-to-company draft: target company dropdown change pe bill/spend sections reset. */
  copySaveTargetCompanyId,
  copyMismatchCategories,
  onCopyMissingCategory,
  isCopyingMissingMasters = false,
  copyMasterDraftRequest,
  onRefreshCopyMismatch,
  recurringVoucherSaveBlocked = false,
  recurringVoucherAuxiliaryDirty = false,
}: {
  voucher?: any;
  onVoucherAction?: (status: 'saved' | 'cancelled', isSaveAndNew?: boolean, newId?: string) => void;
  onOpenHistory?: () => void;
  showHistoryButton?: boolean;
  defaultTab?: 'payment_in' | 'direct_income';
  defaultVoucherData?: any;
  editingDisabled?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onApprove?: () => void;
  isApproving?: boolean;
  copySaveTargetCompanyId?: string;
  copyMismatchCategories?: string[];
  onCopyMissingCategory?: (category: string) => void;
  isCopyingMissingMasters?: boolean;
  copyMasterDraftRequest?: CopyMasterDraftRequestPayload | null;
  onRefreshCopyMismatch?: () => void | Promise<void>;
  /** Report effective has-links (bill-wise or spend-wise) so dialog locks fields as soon as user links in this session. */
  onEffectiveLinksChange?: (hasLinks: boolean | undefined) => void;
  recurringVoucherSaveBlocked?: boolean;
  recurringVoucherAuxiliaryDirty?: boolean;
}) {
  const { toast } = useToast();
  const { user, customUser } = useAuth();
  const { formatCurrency, formatCurrencyForPrint, formatDate, formatDateBS, dateSystem } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedParties, processedPartiesForSelection, processedStaff, processedTaxes, processedStaffGroups, processedAccounts, expenseAccounts } = useVouchers();
  const { company, companyId } = useCompany();
  const { can, role, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const reconGuard = useReconciledPointGuard();
  /** Sirf saved + dialog-linked par file band; nayi txn par parent flag ignore (Add File dead-zone fix). */
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
  useHealStaleTdsReverseLinks(companyId, voucher?.id, allVouchers as any[]);
  /** Stable id for <label htmlFor> — modal me `hidden` input par sirf .click() se kuch browsers file picker nahi kholte. */
  const attachFileInputId = useId();

  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  /** Naye party save ke turant baad parties sync se pehle stale-master effect `partyId` na wipe kare (Copy-to-voucher / Create Party). */
  const pendingPartyIdUntilInPartiesListRef = useRef<string | null>(null);
  /** Bank/cash create ke baad `processedAccounts` listener se pehle — false "Master no longer exists" avoid. */
  const pendingAccountIdUntilInAccountsListRef = useRef<string | null>(null);
  const pendingStaffIdUntilInStaffListRef = useRef<string | null>(null);
  const pendingTaxIdUntilInTaxesListRef = useRef<string | null>(null);
  const pendingIncomeAccountIdUntilInListRef = useRef<string | null>(null);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreateExpenseAccountOpen, setIsCreateExpenseAccountOpen] = useState(false);
  /** Copy-draft: create dialog ke turant pehle hint text (Payment jaisa UX). */
  const [copyAccountCreateHint, setCopyAccountCreateHint] = useState<string>("");
  const [files, setFiles] = useState<(File|string)[]>([]);
  /** `FilePreview` ko stable prop — har render `.filter` naya array = blob effect dubara + thumb flash (static APK tick). */
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
  /** Dev: permissions + DOM — `files` ke baad hi hook (warna TDZ). */
  useEffect(() => {
    if (!TRACE_PAYMENT_IN_ATTACH) return;
    const input = fileInputRef.current;
    tracePaymentInAttach("snapshot", {
      allowAttachments,
      maxFileCount: fileAttachmentLimits.maxFileCount,
      allowImage: fileAttachmentLimits.allowImage,
      allowPDF: fileAttachmentLimits.allowPDF,
      fileAttachLockedByDialog,
      deleteDisabledWhenLinked,
      voucherId: voucher?.id ?? null,
      attachHtmlId: attachFileInputId,
      inputFound: !!input,
      inputDisabled: input?.disabled ?? null,
      accept: input?.getAttribute?.("accept") ?? null,
      filesStateCount: files.length,
    });
  }, [
    allowAttachments,
    fileAttachmentLimits.maxFileCount,
    fileAttachmentLimits.allowImage,
    fileAttachmentLimits.allowPDF,
    fileAttachLockedByDialog,
    deleteDisabledWhenLinked,
    voucher?.id,
    attachFileInputId,
    files.length,
  ]);

  const initialFilesRef = useRef<string[]>([]);
  /** Save ke turant baad stale parent `voucher.fileUrls` form state overwrite na kare (EXE outbox lag). */
  const savedFileUrlsSnapshotRef = useRef<string[] | null>(null);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  /** Snapshot of allocations when voucher was loaded — used to detect bill wise link edits for Save & Approve. */
  const initialAllocationsRef = useRef<{ voucherId: string; amount: number }[]>([]);
  /** Last voucher id we synced allocations from — avoid overwriting user's Link dialog changes when voucher ref changes (e.g. useVouchers refresh). */
  const lastSyncedVoucherIdRef = useRef<string | null>(null);
  /** Last voucher id we reset form for — skip reset when same doc updates (liveVoucher) and user has edits. */
  const lastResetVoucherIdRef = useRef<string | null>(null);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  /** Open Link Pay dialog (spend wise: select which Payment / Contra / DE link to this Payment In). */
  const [isLinkPaymentOutDialogOpen, setIsLinkPaymentOutDialogOpen] = useState(false);
  // Keep link sections collapsed by default on add/non-linked edit; auto-open if this voucher already has links.
  const [showLinkSections, setShowLinkSections] = useState(false);
  const [isLinkToSalaryOpen, setIsLinkToSalaryOpen] = useState(false);
  const [linkSectionInfoOpen, setLinkSectionInfoOpen] = useState(false);
  /** Pending link selection from dialog (applied to server only on Save, not on Done). */
  const [pendingLinkedPaymentOut, setPendingLinkedPaymentOut] = useState<{ ids: string[]; amountsByVoucherId: Record<string, number> } | null>(null);

  const resetLinksOnCopyTargetChange = useCallback(() => {
    setAllocations([]);
    initialAllocationsRef.current = [];
    setPendingLinkedPaymentOut(null);
    setShowLinkSections(false);
    setIsLinkDialogOpen(false);
    setIsLinkPaymentOutDialogOpen(false);
    setIsLinkToSalaryOpen(false);
    onEffectiveLinksChange?.(false);
  }, [onEffectiveLinksChange]);
  useResetLinkStateOnCopyTargetCompany(copySaveTargetCompanyId, resetLinksOnCopyTargetChange);

  /** Copy draft: pehli save insert — stale savedVoucherId se source doc overwrite na ho. */
  const {
    resolveVoucherIdForSave,
    isPermissionEdit,
    markCopiedDraftPersisted,
    isCopiedDraftFirstInsert,
  } = useCopyDraftFirstSave(copySaveTargetCompanyId);

    useEffect(() => {
        setLoading(vouchersLoading);

    }, [vouchersLoading, companyId]);

  const form = useForm<PaymentInFormValues>({
    resolver: zodResolver(formSchema) as Resolver<PaymentInFormValues>,
    defaultValues: getInitialFormValues(voucher || defaultVoucherData),
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.paymentIn(),
    currentVoucherType: defaultTab === "direct_income" ? "direct_income" : "payment_in",
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((company as { name?: string } | null)?.name) || null,
    accounts: (processedAccounts || []) as never,
    companyId: companyId,
    ownPan: ((company as { pan?: string; panNumber?: string } | null)?.pan ?? (company as { panNumber?: string } | null)?.panNumber) || null,
    parties: (processedParties || []) as never,
    items: [],
    taxes: (processedTaxes || []) as never,
    autoPost: () => void handleFormSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing: !!(voucher as { id?: string } | null | undefined)?.id,
    disabled: !!editingDisabled,
  });
  /* AI Copilot (split view). OFF = nothing renders, the classic OCR flow is untouched. */
  const copilot = useAiCopilotLayout(ocr);
  const thumbUrl = useCopilotThumb(files);
  
const { isDirty: _isFormFieldsDirty } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f: any) => typeof f === 'string') as string[];
    const newFiles    = files.filter((f: any) => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u: any, i: number) => u !== init[i]);
  })();
  const payeeType = form.watch('payeeType');
  const partyId = form.watch("partyId");
  const staffId = form.watch("staffId");
  const taxAccountId = form.watch("taxAccountId");
  const accountId = form.watch("accountId");
  const accountOpeningBalance = Number(processedAccounts.find((a: any) => a.id === accountId)?.openingBalance ?? 0) || 0;
  const { displayBalance: accountBalance } = useAccountBalance(accountId);
  const incomeAccountId = form.watch("incomeAccountId");

  const partyComboboxOptions = useMemo(
    () =>
      withSelectedComboboxOption(
        mapPartiesForVoucherCombobox(processedPartiesForSelection),
        partyId,
        processedParties.find((p) => p.id === partyId)?.name
      ),
    [processedPartiesForSelection, processedParties, partyId]
  );
  const staffComboboxOptions = useMemo(
    () =>
      withSelectedComboboxOption(
        mapStaffForVoucherCombobox(processedStaff),
        staffId,
        processedStaff.find((s) => s.id === staffId)?.name
      ),
    [processedStaff, staffId]
  );
  const taxComboboxOptions = useMemo(
    () =>
      withSelectedComboboxOption(
        mapTaxesForVoucherCombobox(processedTaxes),
        taxAccountId,
        (processedTaxes.find((t) => t.id === taxAccountId) as any)?.name ?? (processedTaxes.find((t) => t.id === taxAccountId) as any)?.label
      ),
    [processedTaxes, taxAccountId]
  );
  const incomeComboboxOptions = useMemo(
    () =>
      withSelectedComboboxOption(
        mapExpenseAccountsForVoucherCombobox(expenseAccounts),
        incomeAccountId,
        expenseAccounts.find((e) => e.id === incomeAccountId)?.name
      ),
    [expenseAccounts, incomeAccountId]
  );
  /** Save & Copy To: red helpers + Prefilled dialogs — Payment (`CreatePaymentOutForm`) ke samaan. */
  const copyDraftMasterHelpersEnabled = Boolean(copySaveTargetCompanyId && onCopyMissingCategory);
  const copyPayeeMasterCategoryArg = (): "party" | "staff" | "tax" | "account_expense" => {
    if (payeeType === "party") return "party";
    if (payeeType === "staff") return "staff";
    if (payeeType === "tax") return "tax";
    return "account_expense";
  };
  const copyPayeeMasterButtonLabel = () => {
    if (payeeType === "party") return "Copy party";
    if (payeeType === "staff") return "Copy staff";
    if (payeeType === "tax") return "Copy tax";
    return "Copy income ledger";
  };

  useEffect(() => {
    if (!copyMasterDraftRequest) return;
    const req = copyMasterDraftRequest as CopyMasterDraftRequestPayload;
    const targetLabel = req.targetCompanyName || "company";
    const payload = req.sourceRowPayload;
    const sc = String(req.sourceCollection || "");
    const nm = String(req.sourceName || "").trim();
    const hint = (kind: string) =>
      setCopyAccountCreateHint(`Prefilled ${kind} — review & save into "${targetLabel}".`);

    if (payload && sc === "parties") {
      hint("party");
      setIsCreatePartyOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-party-full", { detail: { rowPayload: payload } }));
      }, 90);
      return;
    }
    if (payload && sc === "bank_accounts") {
      hint("bank/cash account");
      setIsCreateAccountOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-bank-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      return;
    }
    if (payload && sc === "expense_accounts") {
      hint("income ledger");
      setIsCreateExpenseAccountOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-expense-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      return;
    }
    // Staff: naam-only fallback ke bajay poori row + avatar / documentFileUrls (party-full jaisa).
    if (payload && sc === "staff") {
      hint("staff");
      setIsCreateStaffOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-staff-full", { detail: { rowPayload: payload } }));
      }, 90);
      return;
    }
    // Tax: scalars + fileUrl / documentFileUrls — CreateTaxForm `prefill-create-tax-from-row` me fetch ho kar staging.
    if (payload && sc === "taxes") {
      hint("tax");
      setIsCreateTaxOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-tax-from-row", { detail: { rowPayload: payload } }));
      }, 90);
      return;
    }

    if (!nm) return;
    switch (req.category) {
      case "account":
        if (sc === "expense_accounts") {
          hint("income ledger");
          setIsCreateExpenseAccountOpen(true);
          setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
          return;
        }
        hint("bank/cash account");
        setIsCreateAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-bank-account-name", { detail: nm })), 80);
        return;
      case "account_bank":
        hint("bank/cash account");
        setIsCreateAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-bank-account-name", { detail: nm })), 80);
        return;
      case "account_expense":
        hint("income ledger");
        setIsCreateExpenseAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
        return;
      case "party":
        hint("party");
        setIsCreatePartyOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-party-name", { detail: nm })), 80);
        return;
      case "staff":
        hint("staff");
        setIsCreateStaffOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-staff-name", { detail: nm })), 80);
        return;
      case "tax":
        hint("tax");
        setIsCreateTaxOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-tax-name", { detail: nm })), 80);
        return;
      default:
        break;
    }
  }, [copyMasterDraftRequest]);

  /** Dusri tab/me master delete hone par stale ID toast + clear (ghost label avoid); naya party listeners ke aaane tak ref se clear mat karo. */
  useEffect(() => {
    if (loading || !companyId) return;
    // APK/EXE static: company switch ke baad masters SQLite/Firestore se thodi der baad; `loading` false + lists [] short window me
    // edit voucher ke party/bank IDs false "missing" na maano (toast + blank dropdowns).
    if (
      voucher?.id &&
      processedParties.length === 0 &&
      processedAccounts.length === 0 &&
      processedStaff.length === 0 &&
      processedTaxes.length === 0 &&
      expenseAccounts.length === 0
    ) {
      return;
    }
    const missing: string[] = [];
    const pid = String(partyId || "").trim();
    // Party clear tabhi jab party list hydrate ho chuki ho; partial load window me false missing avoid.
    if (pid && processedParties.length > 0 && !processedParties.some((p: any) => p.id === pid)) {
      if (pendingPartyIdUntilInPartiesListRef.current !== pid) {
        missing.push("party");
        form.setValue("partyId", "");
      }
    }
    const sid = String(staffId || "").trim();
    // Staff clear tabhi jab staff list hydrate ho.
    if (sid && processedStaff.length > 0 && !processedStaff.some((s: any) => s.id === sid)) {
      if (pendingStaffIdUntilInStaffListRef.current !== sid) {
        missing.push("staff");
        form.setValue("staffId", "");
      }
    }
    const tid = String(taxAccountId || "").trim();
    // Tax clear tabhi jab tax list hydrate ho.
    if (tid && processedTaxes.length > 0 && !processedTaxes.some((t: any) => t.id === tid)) {
      if (pendingTaxIdUntilInTaxesListRef.current !== tid) {
        missing.push("tax");
        form.setValue("taxAccountId", "");
      }
    }
    const aid = String(accountId || "").trim();
    // Bank/cash clear tabhi jab account list hydrate ho.
    if (aid && processedAccounts.length > 0 && !processedAccounts.some((a: any) => a.id === aid)) {
      if (pendingAccountIdUntilInAccountsListRef.current !== aid) {
        missing.push("bank/cash account");
        form.setValue("accountId", "");
      }
    }
    const iid = String(incomeAccountId || "").trim();
    // Income ledger clear tabhi jab expense/income account list hydrate ho.
    if (payeeType === "income" && iid && expenseAccounts.length > 0 && !expenseAccounts.some((e: any) => e.id === iid)) {
      if (pendingIncomeAccountIdUntilInListRef.current !== iid) {
        missing.push("income ledger");
        form.setValue("incomeAccountId", "");
      }
    }
    if (missing.length > 0) {
      toast({
        variant: "destructive",
        title: "Master no longer exists",
        description: `Removed: ${[...new Set(missing)].join(", ")}. Select again.`,
      });
    }
  }, [
    loading,
    companyId,
    partyId,
    staffId,
    taxAccountId,
    accountId,
    incomeAccountId,
    payeeType,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    form,
    toast,
  ]);

  /** Pending party ab list me aa gaya — ref clear. */
  useEffect(() => {
    const pend = pendingPartyIdUntilInPartiesListRef.current;
    if (!pend) return;
    if (processedParties.some((p: any) => p.id === pend)) {
      pendingPartyIdUntilInPartiesListRef.current = null;
    }
  }, [processedParties]);

  useEffect(() => {
    const pend = pendingPartyIdUntilInPartiesListRef.current;
    const pid = String(partyId || "").trim();
    if (pend && pid && pid !== pend) {
      pendingPartyIdUntilInPartiesListRef.current = null;
    }
  }, [partyId]);

  useEffect(() => {
    const pend = pendingAccountIdUntilInAccountsListRef.current;
    if (!pend) return;
    if (processedAccounts.some((a: any) => a.id === pend)) {
      pendingAccountIdUntilInAccountsListRef.current = null;
    }
  }, [processedAccounts]);

  useEffect(() => {
    const pend = pendingAccountIdUntilInAccountsListRef.current;
    const aid = String(accountId || "").trim();
    if (pend && aid && aid !== pend) {
      pendingAccountIdUntilInAccountsListRef.current = null;
    }
  }, [accountId]);

  useEffect(() => {
    const pend = pendingStaffIdUntilInStaffListRef.current;
    if (!pend) return;
    if (processedStaff.some((s: any) => s.id === pend)) {
      pendingStaffIdUntilInStaffListRef.current = null;
    }
  }, [processedStaff]);

  useEffect(() => {
    const pend = pendingStaffIdUntilInStaffListRef.current;
    const sid = String(staffId || "").trim();
    if (pend && sid && sid !== pend) {
      pendingStaffIdUntilInStaffListRef.current = null;
    }
  }, [staffId]);

  useEffect(() => {
    const pend = pendingTaxIdUntilInTaxesListRef.current;
    if (!pend) return;
    if (processedTaxes.some((t: any) => t.id === pend)) {
      pendingTaxIdUntilInTaxesListRef.current = null;
    }
  }, [processedTaxes]);

  useEffect(() => {
    const pend = pendingTaxIdUntilInTaxesListRef.current;
    const tid = String(taxAccountId || "").trim();
    if (pend && tid && tid !== pend) {
      pendingTaxIdUntilInTaxesListRef.current = null;
    }
  }, [taxAccountId]);

  useEffect(() => {
    const pend = pendingIncomeAccountIdUntilInListRef.current;
    if (!pend) return;
    if (expenseAccounts.some((e: any) => e.id === pend)) {
      pendingIncomeAccountIdUntilInListRef.current = null;
    }
  }, [expenseAccounts]);

  useEffect(() => {
    const pend = pendingIncomeAccountIdUntilInListRef.current;
    const iid = String(incomeAccountId || "").trim();
    if (pend && iid && iid !== pend) {
      pendingIncomeAccountIdUntilInListRef.current = null;
    }
  }, [incomeAccountId]);

  const showCopyBankFromSource = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return false;
    // mismatch list me `account_bank` rehne se pehle chip hamesha `true` ho jata tha; account select ke baad bhi. Sirf khali/missing par dikhao.
    return !String(accountId || "").trim();
  }, [copyDraftMasterHelpersEnabled, accountId]);

  const showCopyPayeeMasterFromSource = useMemo(() => {
    if (!copyDraftMasterHelpersEnabled) return false;
    // Copy chip = received-from row khali; label red bhi `showCopyPayeeMasterFromSource` se hi (mismatch list alag header me).
    if (payeeType === "party") return !String(partyId || "").trim();
    if (payeeType === "staff") return !String(staffId || "").trim();
    if (payeeType === "tax") return !String(taxAccountId || "").trim();
    if (payeeType === "income") return !String(incomeAccountId || "").trim();
    return false;
  }, [
    copyDraftMasterHelpersEnabled,
    payeeType,
    partyId,
    staffId,
    taxAccountId,
    incomeAccountId,
  ]);

  /** Received From / To Bank label red — Copy chip jis row par ho wahi rang (party/bank/account). */
  const highlightBankLabelCopyMismatch = showCopyBankFromSource;
  const highlightReceivedFromLabelCopyMismatch = showCopyPayeeMasterFromSource;

  const voucherType = defaultTab === 'direct_income' ? 'direct_income' : 'payment_in';
  /** Edit dialog me tab click (Payment In <-> Direct Income) par bhi voucher number regenerate karo. */
  const isEditingAndConverting = isVoucherEditConverting(voucher, voucherType);
  const convertPresentation = useMemo(
    () => getVoucherEditConvertPresentation(voucher as Record<string, unknown> | undefined, voucherType),
    [voucher, voucherType]
  );
  const {
    convertConfirmOpen,
    setConvertConfirmOpen,
    gateConvertSubmit,
    confirmConvertSubmit,
  } = useVoucherEditConvertSubmitGate(isEditingAndConverting);

  /** Allocation-based link changed (party bill-wise or staff salary link) — so Save & Approve should show. */
  const _isAllocationLinkDirty = (() => {
    const showPartyBillWise = voucherType === "payment_in" && payeeType === "party" && !!partyId;
    const showStaffSalaryLink = voucherType === "payment_in" && payeeType === "staff" && !!staffId;
    if (!showPartyBillWise && !showStaffSalaryLink) return false;
    const initial = initialAllocationsRef.current;
    if (allocations.length !== initial.length) return true;
    const currentNorm = allocations.slice().sort((a, b) => a.voucherId.localeCompare(b.voucherId)).map((a) => ({ voucherId: a.voucherId, amount: getAllocationTotal(a) }));
    const initialNorm = initial.slice().sort((a, b) => a.voucherId.localeCompare(b.voucherId));
    return currentNorm.some((c, i) => c.voucherId !== initialNorm[i].voucherId || c.amount !== initialNorm[i].amount);
  })();
  /** Spend wise link changed (user confirmed link dialog but not saved) — so Save & Approve should show. */
  const _isSpendWiseLinkDirty = !!pendingLinkedPaymentOut;
  const isFormDirty =
    _isFormFieldsDirty || _isFileDirty || _isAllocationLinkDirty || _isSpendWiseLinkDirty || recurringVoucherAuxiliaryDirty;

  const payeeBalance = useMemo(() => {
    if (payeeType === 'party' && partyId) return processedParties.find(p => p.id === partyId)?.balance;
    if (payeeType === 'staff' && staffId) return processedStaff.find(s => s.id === staffId)?.balance;
    if (payeeType === 'tax' && taxAccountId) return processedTaxes.find(t => t.id === taxAccountId)?.balance;
    if (payeeType === 'income' && incomeAccountId) return expenseAccounts.find(e => e.id === incomeAccountId)?.balance;
    return null;
  }, [payeeType, partyId, staffId, taxAccountId, incomeAccountId, processedParties, processedStaff, processedTaxes, expenseAccounts]);

  const transactionDates = useMemo(() => {
    if (!allVouchers?.length) return [];
    return allVouchers.map((v) => {
      const d = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      return d && !isNaN(d.getTime()) ? startOfDay(d) : null;
    }).filter(Boolean) as Date[];
  }, [allVouchers]);

  // Outgoing: RCPT allocated to Sale/Payment/Journal. Incoming: Journal allocated to RCPT (from Journal form Link to Dr).
  const linkedToRows = useMemo(() => {
    const all = allVouchers ?? [];
    const currentId = isCopiedDraftFirstInsert ? null : (voucher?.id ?? savedVoucherId);
    const outgoing = (allocations || []).map((a) => {
      if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) {
        return { voucherId: a.voucherId, voucherNumber: "Opening Balance", amount: getAllocationTotal(a), date: null as Date | null, typeLabel: "Opening Balance" };
      }
      const target = all.find((v: any) => v.id === a.voucherId);
      const rawDate = target?.date;
      const date = rawDate ? (typeof (rawDate as any)?.toDate === "function" ? (rawDate as any).toDate() : new Date(rawDate as string | number)) : null;
      return {
        voucherId: a.voucherId,
        voucherNumber: target?.voucherNumber ?? target?.voucher_number ?? "—",
        amount: getAllocationTotal(a),
        date: date && !isNaN(date.getTime()) ? date : null,
        typeLabel: target?.type === "payment_out" ? "Payment" : target?.type === "direct_expense" ? "Direct Expense" : target?.type === "journal" ? "Journal" : target?.type === "contra" ? "Contra" : "Voucher",
      };
    });
    // Incoming: journals that allocated TO this RCPT (Journal form Link to Dr → RCPT). Same party filter.
    const touchesParty = (v: any) => !partyId || String((v as any)?.partyId ?? "") === String(partyId) ||
      (Array.isArray((v as any)?.entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? "") === String(partyId)));
    const incoming: typeof outgoing = [];
    for (const v of all) {
      if (v.type !== "journal" || v.id === currentId || !touchesParty(v)) continue;
      const allocs = (v.allocations as { voucherId: string; amount: number; linkedAccountId?: string }[] | undefined) || [];
      for (const a of allocs) {
        if (a.voucherId !== currentId) continue;
        if (partyId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== String(partyId)) continue;
        const amt = getAllocationTotal(a);
        if (amt <= 0) continue;
        const rawDate = v?.date;
        const date = rawDate ? (typeof (rawDate as any)?.toDate === "function" ? (rawDate as any).toDate() : new Date(rawDate as string | number)) : null;
        incoming.push({
          voucherId: v.id,
          voucherNumber: v.voucherNumber ?? v.voucher_number ?? "—",
          amount: amt,
          date: date && !isNaN(date.getTime()) ? date : null,
          typeLabel: "Journal",
        });
      }
    }
    const combined = [...outgoing, ...incoming];
    combined.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    // Dedupe by voucherId: same link can appear in both RCPT.allocations (outgoing) and Journal.allocations (incoming) after bilateral sync — use max, not sum, to avoid double count.
    const byId = new Map<string, { voucherId: string; voucherNumber: string; amount: number; date: Date | null; typeLabel: string }>();
    for (const row of combined) {
      const existing = byId.get(row.voucherId);
      if (existing) existing.amount = Math.max(existing.amount, row.amount);
      else byId.set(row.voucherId, { ...row });
    }
    return Array.from(byId.values()).sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  }, [allocations, allVouchers, voucher?.id, savedVoucherId, partyId, isCopiedDraftFirstInsert]);

  /** For Link to Dr dialog: show existing links from both RCPT.allocations and incoming (journals that allocated to this RCPT). Use max, not sum, when same voucher appears in both (bilateral sync) to avoid double count. */
  const existingAllocationsForLinkDialog = useMemo(() => {
    const byId = new Map<string, number>();
    for (const a of allocations || []) {
      if (!a.voucherId) continue;
      const total = getAllocationTotal(a);
      if (total > 0) {
        // TDS-leg allocations (voucherId::tds::acct) stay separate so the link dialog can show the TDS row as linked.
        const et = String((a as any).entityTxnId ?? "");
        const key = et.includes("::tds::") ? et : a.voucherId;
        byId.set(key, Math.max(byId.get(key) ?? 0, total));
      }
    }
    const currentId = isCopiedDraftFirstInsert ? null : (voucher?.id ?? savedVoucherId);
    if (currentId && allVouchers?.length) {
      const touchesParty = (v: any) => !partyId || String((v as any)?.partyId ?? "") === String(partyId) ||
        (Array.isArray((v as any)?.entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? "") === String(partyId)));
      for (const v of allVouchers) {
        if (v.type !== "journal" || v.id === currentId || !touchesParty(v)) continue;
        const allocs = (v.allocations as { voucherId: string; amount?: number; linkedAccountId?: string }[] | undefined) || [];
        for (const a of allocs) {
          if (a.voucherId !== currentId) continue;
          if (partyId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== String(partyId)) continue;
          const amt = getAllocationTotal(a);
          if (amt <= 0) continue;
          byId.set(v.id, Math.max(byId.get(v.id) ?? 0, amt));
        }
      }
    }
    return Array.from(byId.entries(), ([key, amount]) =>
      key.includes("::tds::") ? { voucherId: key.split("::")[0], amount, entityTxnId: key } : { voucherId: key, amount }
    );
  }, [allocations, allVouchers, voucher?.id, savedVoucherId, partyId, isCopiedDraftFirstInsert]);

  const paymentInAlloc = usePaymentAllocations(
    partyId,
    allVouchers ?? [],
    isCopiedDraftFirstInsert ? undefined : (voucher?.id ?? savedVoucherId ?? undefined)
  );
  /** Bill wise: same count as Link to Dr popup (sales + payment outs + OB with linkable amount). */
  const billWiseLinkableCount = useLinkPaymentToTxnsLinkableCount(
    "payment_in",
    partyId,
    allVouchers ?? [],
    {
      paymentInId: isCopiedDraftFirstInsert ? undefined : (voucher?.id ?? savedVoucherId ?? undefined),
      existingAllocations: allocations,
      partyOpeningBalance: processedParties.find((p) => p.id === partyId)?.openingBalance ?? 0,
    }
  );

  const totalLinked = useMemo(() => linkedToRows.reduce((s, r) => s + r.amount, 0), [linkedToRows]);
  /** Per sale voucher: amount already linked from other payment_ins (for "Linked on others" column). */
  const linkedOnOthersByVoucherId = useMemo(() => {
    const currentId = isCopiedDraftFirstInsert ? null : (voucher?.id ?? savedVoucherId);
    const others = (allVouchers ?? []).filter((v: any) => (v.type === "payment_in" || v.type === "direct_income") && v.id !== currentId);
    return getAllocatedByVoucherId(others);
  }, [allVouchers, voucher?.id, savedVoucherId, isCopiedDraftFirstInsert]);
  const amountReceived = Number(form.watch("amount")) || 0;
  const remainingToLink = Math.max(0, amountReceived - totalLinked);

  // Spend-wise receipt status should be visible on the RCPT current row as links change.
  const getSpendWiseReceiptStatus = useCallback((amount: number, linked: number) => {
    if (linked <= 0) return { label: "Unpaid", className: "text-red-600 border-red-300 bg-red-50" };
    if (linked >= amount && amount > 0) return { label: "Paid", className: "text-green-600 border-green-300 bg-green-50" };
    return { label: "Partial", className: "text-amber-600 border-amber-300 bg-amber-50" };
  }, []);

  /** Show Link for bill wise card when party selected; when Link for Bill Wise is OFF, linking is optional (message hidden). */
  const showLinkedSection = voucherType === "payment_in" && payeeType === "party" && !!partyId;
  const showSalaryLinkSection = voucherType === "payment_in" && payeeType === "staff" && !!staffId;
  const spendWiseCompanyOn = (company as { spendWiseEnabled?: boolean } | null)?.spendWiseEnabled === true;
  const spendWiseOppositeEditable =
    (company as { spendWiseOppositeVoucherEditable?: boolean } | null)?.spendWiseOppositeVoucherEditable === true;
  /** Role matrix tabhi enforce jab opposite-voucher master ON — matrix save rehti, master OFF pe link force band */
  const requirePaymentLinkForSpendWise =
    spendWiseOppositeEditable &&
    (() => {
      const byRole = (company as { requirePaymentLinkByRole?: Record<string, boolean | { payment_out?: boolean }> } | null)?.requirePaymentLinkByRole?.[role];
      if (byRole === undefined) return false;
      if (typeof byRole === "boolean") return byRole;
      return (byRole as { payment_out?: boolean }).payment_out === true;
    })();
  /** Same as PO: opposite master OFF ⇒ company spendWise + role dono voucher par force nahi kar sakte save pe. */
  const spendWiseLinkRequired = spendWiseOppositeEditable && (spendWiseCompanyOn || requirePaymentLinkForSpendWise);

  const currentVoucherId = voucher?.id ?? savedVoucherId;
  /** Show Link for spend wise (From/To cards) in both add new and edit — so user sees and can link even before saving. */
  const showSpendWiseOppositeSection = !!accountId && (voucherType === "payment_in" || voucherType === "direct_income");
  /** Names for spend-wise To column (party, staff, account, expense). */
  const paymentOutDialogNames = useMemo(() => {
    const out: Record<string, string> = {};
    processedParties?.forEach((p: any) => { out[p.id] = p.name ?? "—"; });
    processedStaff?.forEach((s: any) => { out[s.id] = s.name ?? "—"; });
    processedAccounts?.forEach((a: any) => { out[a.id] = a.accountName ?? "—"; });
    expenseAccounts?.forEach((e: any) => { out[e.id] = e.name ?? "—"; });
    return out;
  }, [processedParties, processedStaff, processedAccounts, expenseAccounts]);
  const openingBalanceLinkedByOthers = useMemo(() => {
    if (!accountId) return 0;
    return (allVouchers ?? [])
      .filter((v: any) => {
        const isInVoucherForAccount =
          ((v.type === "payment_in" || v.type === "direct_income") && (v.accountId ?? v.toAccountId ?? v.bankAccountId) === accountId) ||
          (v.type === "contra" && (v.toAccountId ?? v.accountId) === accountId);
        return isInVoucherForAccount && v.id !== currentVoucherId && !v.isDeleted;
      })
      .reduce((sum: number, v: any) => {
        if ((v.linkedOpeningBalanceAccountId ?? "") !== accountId) return sum;
        return sum + (Number(v.linkedOpeningBalanceAmount) || 0);
      }, 0);
  }, [allVouchers, accountId, currentVoucherId]);

  /** Outflow vouchers that currently link to this Payment In (server data). Used for count and display. */
  const spendWiseLinkedToMeRows = useMemo(() => {
    if (!showSpendWiseOppositeSection || !allVouchers?.length || !currentVoucherId || !accountId) return [];
    const accId = accountId;
    const outflows = allVouchers.filter(
      (v: any) =>
        !v.isDeleted &&
        Array.isArray(v.linkedPaymentInIds) &&
        v.linkedPaymentInIds.includes(currentVoucherId) &&
        ((v.type === "payment_out" && v.accountId === accId) ||
          (v.type === "direct_expense" && v.accountId === accId) ||
          (v.type === "contra" && v.fromAccountId === accId))
    );
    const rows = outflows.map((v: any) => {
      const date = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      const amount = Number(v.total ?? v.amount ?? 0) || 0;
      const amounts = v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object" ? v.linkedPaymentInAmounts : {};
      const linked = amounts[currentVoucherId] != null ? Number(amounts[currentVoucherId]) : amount / (v.linkedPaymentInIds?.length || 1);
      const typeLabel = v.type === "payment_out" ? "Payment" : v.type === "direct_expense" ? "Direct Expense" : "Contra";
      const to = getSpendWiseOutflowPartyLabel(v, paymentOutDialogNames);
      return {
        id: v.id,
        voucherNumber: v.voucherNumber ?? "—",
        date,
        amount,
        linked,
        typeLabel,
        from: to,
        to,
      };
    });
    const openingBase = getOpeningBalanceBaseAmount(accountOpeningBalance, "cr");
    const currentLinkedOB = Number((voucher as any)?.linkedOpeningBalanceAccountId === accountId ? (voucher as any)?.linkedOpeningBalanceAmount : 0) || 0;
    if (openingBase > 0 && currentLinkedOB > 0) {
      // Show saved Opening Balance link as a normal row in spend-wise "To Voucher" card.
      rows.push({
        id: SPEND_WISE_OPENING_BALANCE_ID,
        voucherNumber: "Opening Balance (Cr)",
        date: null,
        amount: openingBase,
        linked: currentLinkedOB,
        typeLabel: "Opening Balance",
        from: "Opening Balance",
        to: "Opening Balance",
      });
    }
    return rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }, [showSpendWiseOppositeSection, allVouchers, currentVoucherId, accountId, paymentOutDialogNames, accountOpeningBalance, voucher]);

  /** For Link Pay In dialog: outflow voucher ids that currently link to this Payment In (for count "already selected"). */
  const linkedPaymentOutSelectedIdsForCount = useMemo(
    () => (pendingLinkedPaymentOut ? pendingLinkedPaymentOut.ids : spendWiseLinkedToMeRows.map((r) => r.id)),
    [pendingLinkedPaymentOut, spendWiseLinkedToMeRows]
  );
  /** Current voucher's linked amounts by outflow id (same as passed to LinkPaymentOutToPaymentInDialog). */
  const currentVoucherLinkedAmountsForCount = useMemo(
    () =>
      pendingLinkedPaymentOut
        ? pendingLinkedPaymentOut.amountsByVoucherId
        : Object.fromEntries(spendWiseLinkedToMeRows.map((r) => [r.id, r.linked])),
    [pendingLinkedPaymentOut, spendWiseLinkedToMeRows]
  );

  /** Spend wise: same count as "Link Pay In" popup — outflow vouchers with linkable > 0 or already selected. */
  const spendWiseLinkableCount = useMemo(() => {
    if (!showSpendWiseOppositeSection || !accountId || !allVouchers?.length) return 0;
    const accId = accountId;
    const selectedSet = new Set(linkedPaymentOutSelectedIdsForCount ?? []);
    const list = allVouchers
      .filter(
        (v: any) =>
          !v.isDeleted &&
          ((v.type === "payment_out" && v.accountId === accId) ||
            (v.type === "direct_expense" && v.accountId === accId) ||
            (v.type === "contra" && v.fromAccountId === accId))
      )
      .map((v: any) => {
        const amount = Number(v.total ?? v.amount ?? 0) || 0;
        // Keep amounts numeric for TS arithmetic safety in spend-wise count calculations.
        const amounts: Record<string, number> =
          v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object"
            ? (v.linkedPaymentInAmounts as Record<string, number>)
            : {};
        const alreadyLinked = Object.values(amounts).reduce((s: number, val) => s + (Number(val) || 0), 0);
        const currentLinked = Number(currentVoucherLinkedAmountsForCount?.[v.id] ?? 0) || 0;
        const linkable = Math.max(0, amount - alreadyLinked + currentLinked);
        return { id: v.id, linkable };
      });
    const openingBase = getOpeningBalanceBaseAmount(accountOpeningBalance, "cr");
    const currentLinkedOB = Number(currentVoucherLinkedAmountsForCount?.[SPEND_WISE_OPENING_BALANCE_ID] ?? 0) || 0;
    const obLinkable = Math.max(0, openingBase - openingBalanceLinkedByOthers + currentLinkedOB);
    if (openingBase > 0) {
      list.push({ id: SPEND_WISE_OPENING_BALANCE_ID, linkable: obLinkable });
    }
    return list.filter((r) => r.linkable > 0 || selectedSet.has(r.id)).length;
  }, [
    showSpendWiseOppositeSection,
    accountId,
    allVouchers,
    linkedPaymentOutSelectedIdsForCount,
    currentVoucherLinkedAmountsForCount,
    accountOpeningBalance,
    openingBalanceLinkedByOthers,
  ]);

  /** When Link for Bill Wise is ON: cannot save without bill-wise link if vouchers available (party only). */
  const saveDisabledByBillWise = !!company?.enableLinkPaymentToTxns && showLinkedSection && billWiseLinkableCount > 0 && linkedToRows.length === 0;

  /** Card display: when Done is clicked (pending set), show pending links live; otherwise server data. */
  const displayLinkedToMeRows = useMemo(() => {
    if (!pendingLinkedPaymentOut || !accountId || !allVouchers?.length) return spendWiseLinkedToMeRows;
    const accId = accountId;
    const rows = pendingLinkedPaymentOut.ids
      .map((id) => {
        if (id === SPEND_WISE_OPENING_BALANCE_ID) {
          const openingBase = getOpeningBalanceBaseAmount(accountOpeningBalance, "cr");
          const linked = pendingLinkedPaymentOut.amountsByVoucherId[id] ?? 0;
          return {
            id,
            voucherNumber: "Opening Balance (Cr)",
            date: null as Date | null,
            amount: openingBase,
            linked,
            typeLabel: "Opening Balance",
            from: "Opening Balance",
            to: "Opening Balance",
          };
        }
        const v = allVouchers.find((x: any) => x.id === id);
        if (!v || v.isDeleted) return null;
        const ok = (v.type === "payment_out" && v.accountId === accId) || (v.type === "direct_expense" && v.accountId === accId) || (v.type === "contra" && v.fromAccountId === accId);
        if (!ok) return null;
        const date = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
        const amt = Number(v.total ?? v.amount ?? 0) || 0;
        const linked = pendingLinkedPaymentOut.amountsByVoucherId[id] ?? 0;
        const to = getSpendWiseOutflowPartyLabel(v, paymentOutDialogNames);
        return { id: v.id, voucherNumber: v.voucherNumber ?? "—", date, amount: amt, linked, typeLabel: v.type === "payment_out" ? "Payment" : v.type === "direct_expense" ? "Direct Expense" : "Contra", from: to, to };
      })
      .filter(Boolean);
    const typed = rows as { id: string; voucherNumber: string; date: Date | null; amount: number; linked: number; typeLabel: string; from: string }[];
    return typed.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }, [pendingLinkedPaymentOut, spendWiseLinkedToMeRows, allVouchers, accountId, paymentOutDialogNames, accountOpeningBalance]);

  /** RCPT spend-wise gate: jitna PI amount hai utna opposite (PO/contra) se link ho — sirf tab Save roko jab linkable vouchers hon aur ye match pending ho; sirf count>0 se busy bank par Save permanently band na ho (copy/other company baad jaise Payment bug). */
  const linkedSpendWiseTotalForRcptGate = displayLinkedToMeRows.reduce((s, r) => s + r.linked, 0);
  const spendWiseAmountMatchedForRcpt = amountReceived > 0 && linkedSpendWiseTotalForRcptGate >= amountReceived;
  const showSpendWiseRcptGateMode = showSpendWiseOppositeSection && amountReceived > 0;
  const saveDisabledBySpendWise =
    spendWiseLinkRequired && spendWiseLinkableCount > 0 && showSpendWiseRcptGateMode && !spendWiseAmountMatchedForRcpt;
  const linkPayOthersDisabled = saveDisabledByBillWise || saveDisabledBySpendWise;

  /** Current Payment In as it appears on the opposite voucher (Payment / Contra / Direct Expense) — one row for the two-card "From Voucher" layout. */
  const formDate = form.watch("date");
  const formVoucherNumber = form.watch("voucherNumber") || voucher?.voucherNumber || "—";
  const currentVoucherAsOnOppositeRows = useMemo(() => {
    if (!showSpendWiseOppositeSection || !accountId) return [];
    const date = formDate;
    const amount = amountReceived;
    const linked = displayLinkedToMeRows.reduce((s, r) => s + r.linked, 0);
    const from = processedAccounts?.find((a: any) => a.id === accountId)?.accountName ?? "—";
    return [
      {
        id: "current",
        voucherNumber: formVoucherNumber,
        date: date ? (date instanceof Date ? date : new Date(date)) : null,
        amount,
        linked,
        from,
      },
    ];
  }, [showSpendWiseOppositeSection, accountId, formDate, formVoucherNumber, voucher?.voucherNumber, amountReceived, displayLinkedToMeRows, processedAccounts]);

  const isEditMode = !!voucher?.id;
  const hasBillWiseLinks = linkedToRows.length > 0;
  const hasSpendWiseLinks = currentVoucherAsOnOppositeRows.length > 0 || displayLinkedToMeRows.length > 0;
  const shouldShowBillWiseSection = showLinkedSection && (showLinkSections || (isEditMode && hasBillWiseLinks));
  const shouldShowSalarySection = showSalaryLinkSection && (showLinkSections || (isEditMode && linkedToRows.length > 0));
  const shouldShowSpendWiseSection = showSpendWiseOppositeSection && (showLinkSections || (isEditMode && hasSpendWiseLinks));
  const shouldShowAnyLinkSection = shouldShowBillWiseSection || shouldShowSalarySection || shouldShowSpendWiseSection;
  const shouldShowLinkButton = (showLinkedSection || showSalaryLinkSection || showSpendWiseOppositeSection) && !shouldShowAnyLinkSection;

  useEffect(() => {
    if (isEditMode && (hasBillWiseLinks || hasSpendWiseLinks)) setShowLinkSections(true);
  }, [isEditMode, hasBillWiseLinks, hasSpendWiseLinks]);

  /** For Link Pay dialog: outflow voucher ids that currently link to this Payment In. */
  const linkedPaymentOutSelectedIds = useMemo(() => spendWiseLinkedToMeRows.map((r) => r.id), [spendWiseLinkedToMeRows]);

  /** Report effective has-links to dialog: 1 link → fields disabled; all unlink → edit enable. Applies to Party, Staff, Tax, Income equally. */
  useEffect(() => {
    if (!onEffectiveLinksChange) return;
    const spendWiseLinked = spendWiseLinkedToMeRows.length > 0 || (pendingLinkedPaymentOut?.ids?.length ?? 0) > 0;
    const hasLinks = allocations.length > 0 || spendWiseLinked;
    onEffectiveLinksChange(hasLinks);
  }, [onEffectiveLinksChange, allocations.length, spendWiseLinkedToMeRows.length, pendingLinkedPaymentOut?.ids?.length]);

  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.[voucherType] ?? true;
  const isVoucherEditingAllowed = company?.allowVoucherNumberEditing?.[voucherType] ?? false;
  const isPrefixSelectionEnabled = company?.enableVoucherPrefixSelection?.[voucherType] ?? false;

  const fetchVoucherNumber = useCallback(async (selectedPrefix?: string) => {
    if (!companyId || !company || !isAutoVoucherEnabled) return;
    try {
      const nextNo = await getNextVoucherNumberForCompany({
        companyId,
        companyDoc: company as Record<string, unknown>,
        voucherLike: { type: voucherType },
        selectedPrefix,
        voucherDate: form.getValues("date"),
      });
      form.setValue("voucherNumber", nextNo);
    } catch (error) {
      console.error("Error fetching voucher count: ", error);
    }
  }, [companyId, company, form, isAutoVoucherEnabled, voucherType]);

  // Same as Pay (CreatePaymentOutForm): only reset when editing (voucher.id). New voucher uses defaultValues + fetchVoucherNumber.
  // Only sync allocations when voucher ID actually changes — avoid overwriting user's Link dialog changes when voucher ref changes (useVouchers refresh).
  // Skip reset when same voucher updates (liveVoucher) and user has edits — fixes unlink → change fields → save.
  useEffect(() => {
    if (voucher?.id) {
        const isSameVoucher = lastResetVoucherIdRef.current === voucher.id;
        // Same `id` par snapshot/context se bar‑bar reset — date/amount wipe (Sale/Purchase jaisa)
        if (isSameVoucher) return;
        lastResetVoucherIdRef.current = voucher.id;
        const initialValues = getInitialFormValues(voucher);
        if (isEditingAndConverting) {
            initialValues.voucherNumber = "";
        }
        form.reset(initialValues);
        setSavedVoucherId(voucher.id);
        const urls = voucherAttachmentUrlsForFormState(voucher);
        setFiles(urls);
        initialFilesRef.current = urls.filter((f): f is string => typeof f === "string");
        setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
        if (lastSyncedVoucherIdRef.current !== voucher.id) {
          lastSyncedVoucherIdRef.current = voucher.id;
          const allocs = Array.isArray(voucher.allocations) ? voucher.allocations : [];
          setAllocations(allocs);
          initialAllocationsRef.current = allocs.map((a) => ({ voucherId: a.voucherId, amount: getAllocationTotal(a) }));
        }
    } else if (defaultVoucherData && !voucher?.id) {
        // Sirf pehli baar defaults hydrate karo — har `isFormDirty` / effect rerun par `setFiles([])` se user ki File gayab ho jati thi (console me append dikhta, UI khaali).
        if (lastSyncedVoucherIdRef.current !== "new") {
          lastSyncedVoucherIdRef.current = "new";
          const urls = voucherAttachmentUrlsForFormState(defaultVoucherData);
          setFiles(urls);
          initialFilesRef.current = urls.filter((f: unknown): f is string => typeof f === "string");
          setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
          const allocs = Array.isArray(defaultVoucherData.allocations) ? defaultVoucherData.allocations : [];
          setAllocations(allocs);
          initialAllocationsRef.current = allocs.map((a) => ({ voucherId: a.voucherId, amount: getAllocationTotal(a) }));
          form.setValue("partyId", defaultVoucherData.partyId ?? "");
        }
        lastResetVoucherIdRef.current = null;
    }
  }, [voucher, defaultVoucherData, form, isEditingAndConverting]);

  useEffect(() => {
    if (!voucher?.id) return;
    const pt = getPayeeTypeFromVoucher(voucher);
    const incomeId = voucher.incomeAccountId || voucher.toAccountId || "";
    const setIfEmpty = (name: keyof PaymentInFormValues, next: string | undefined) => {
      const val = String(next || "").trim();
      if (!val) return;
      const cur = String(form.getValues(name) || "").trim();
      if (!cur) form.setValue(name, val, { shouldDirty: false });
    };
    if (pt !== form.getValues("payeeType")) form.setValue("payeeType", pt, { shouldDirty: false });
    setIfEmpty("partyId", voucher.partyId);
    setIfEmpty("staffId", voucher.staffId);
    setIfEmpty("taxAccountId", voucher.taxAccountId);
    if (pt === "income") setIfEmpty("incomeAccountId", incomeId);
    setIfEmpty("payeeName", voucher.payeeName);
  }, [
    voucher?.id,
    voucher?.partyId,
    voucher?.staffId,
    voucher?.taxAccountId,
    voucher?.incomeAccountId,
    voucher?.toAccountId,
    voucher?.payeeName,
    voucher?.type,
    form,
  ]);

  // Outbox flush ke baad `local:` → HTTPS: parent `voucher.fileUrls` update; stale snapshot ignore (EXE remove+add fix).
  useEffect(() => {
    if (!voucher?.id || savedVoucherId !== voucher.id) return;
    const hasUnsavedFilePick = files.some((f) => f instanceof File);
    if (hasUnsavedFilePick) return;
    if (_isFileDirty) return;
    const incoming = voucherAttachmentUrlsForFormState(voucher).filter((f): f is string => typeof f === "string");
    const cur = files.filter((f): f is string => typeof f === "string");
    const snap = savedFileUrlsSnapshotRef.current;
    if (snap) {
      if (incomingVoucherFileUrlsLookStaleVersusSaved(snap, incoming)) return;
      // Empty snap mat clear karo — flush/409 mirror purani HTTPS wapas laaye to phir bhi reject ho.
      if (isLocalToRemoteAttachmentUpgrade(snap, incoming)) {
        savedFileUrlsSnapshotRef.current = null;
      } else if (snap.length > 0 && JSON.stringify(incoming) === JSON.stringify(snap)) {
        savedFileUrlsSnapshotRef.current = null;
      }
    }
    if (JSON.stringify(incoming) === JSON.stringify(cur)) return;
    // Missing `fileUrls` key (lag) — tiles khaki na hon. Explicit `[]` = other device / this save deleted.
    const explicitEmptyFileUrls =
      Object.prototype.hasOwnProperty.call(voucher, "fileUrls") &&
      Array.isArray(voucher.fileUrls) &&
      voucher.fileUrls.length === 0;
    if (!snap && cur.length > 0 && incoming.length === 0 && !explicitEmptyFileUrls) {
      return;
    }
    if (cur.length > incoming.length || (cur.length > 0 && incoming.length === 0)) {
      void import("@/lib/attachmentDeleteTrace").then((m) =>
        m.logAttachWipe({
          source: "CreatePaymentInForm.voucherFileUrlsEffect",
          reason: "form_sync_shrunk_from_voucher_prop",
          companyId: companyId ?? undefined,
          voucherId: voucher?.id,
          beforeUrls: cur,
          afterUrls: incoming,
          extra: { _isFileDirty, snap: snap ?? null },
        })
      );
    }
    setFiles(incoming);
    initialFilesRef.current = [...incoming];
    setSavePdfAsImage(shouldSuggestPdfAsImage(incoming));
  }, [voucher?.id, voucher?.fileUrls, voucher?.unassignedFile?.url, savedVoucherId, files, _isFileDirty, companyId]);

  useEffect(() => {
    if ((!savedVoucherId || isEditingAndConverting) && isAutoVoucherEnabled) {
      fetchVoucherNumber();
    }
  }, [isAutoVoucherEnabled, savedVoucherId, fetchVoucherNumber, isEditingAndConverting, payeeType]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(voucher?.id && savedVoucherId && !isEditingAndConverting),
    shouldFetchNextOnDateChange: Boolean((!savedVoucherId || isEditingAndConverting) && isAutoVoucherEnabled),
    fetchVoucherNumber,
    resolvePrefix: () => {
      const list = company?.voucherPrefixes?.[voucherType] || [getVoucherPrefix()];
      return resolvePrefixFromVoucherNumber(String(form.getValues("voucherNumber") || ""), list, list[0]);
    },
  });

  useEffect(() => {
    if (voucherType === 'payment_in' && !['party', 'staff', 'tax'].includes(payeeType)) {
        form.setValue('payeeType', 'party');
    } else if (voucherType === 'direct_income' && payeeType !== 'income') {
        form.setValue('payeeType', 'income');
    }
  }, [payeeType, voucherType, form]);
  
  // Validated `data` से save — nested mobile `date` + `getValues()` से date miss होकर server पर "आज" न जाए
  function handleFormSubmit(e: React.FormEvent, options: { ocrAutoPost?: boolean; saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean } = {}) {
    e?.preventDefault?.();
    const run = () => {
      void form.handleSubmit(
        async (data) => {
          await processAndSave(data, options.saveAndNew, options.print, options.approveAfterSave ? onApprove : undefined, options.approveAfterSave);
        },
        (errors) => {
          sonnerToast.error("Validation Failed", { description: formatPaymentInFormValidationErrors(errors) });
        }
      )(e);
    };
    gateConvertSubmit(run);
  }

  async function processAndSave(data: PaymentInFormValues, saveAndNew: boolean = false, print: boolean = false, onSuccess?: () => void, approveAfterSave?: boolean) {
    if (!user || !companyId) {
      sonnerToast.error("Error", { description: "Login and company selection required." });
      return;
    }
    if (saveDisabledByBillWise) {
      sonnerToast.error("Link bill wise", { description: "Link for Bill Wise is ON. Please link to sale(s) first to save." });
      return;
    }
    if (saveDisabledBySpendWise) {
      sonnerToast.error("Link for spend wise", { description: `${spendWiseLinkableCount} voucher(s) available to link — link 1st to save.` });
      return;
    }

    if (reconGuard) {
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
      const allowed = await reconGuard.checkAndConfirmReconciledDate({
        companyId,
        voucherDate: data.date,
        partyId: data.partyId,
        accountId: data.accountId,
        allVouchers,
        isEdit,
        existingVoucher: voucher,
        newVoucherData: { ...data, type: "payment_in" },
      });
      if (!allowed) {
        setIsLoading(false);
        return;
      }
    }

    try {
      // Permission check: create or edit (copy draft pehli save = create)
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
      const voucherDate = data.date instanceof Date ? data.date : new Date(data.date);
      
      if (isEdit) {
        // Check edit permission - determine ownership
        const preferLocalReads = preferLocalLedgerReads(company);
        const fetchVoucher = async (cid: string, vid: string) => {
          if (preferLocalReads) {
            const row = await getCompanyDocFromBrowserDb(cid, "vouchers", vid);
            return row;
          }
          const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
          return voucherDoc.exists() ? voucherDoc.data() : null;
        };
        const isOwnRecord = await determineVoucherOwnership(voucher, savedVoucherId, allVouchers, user.uid, companyId, fetchVoucher);
        const currentVoucher = voucher ?? (savedVoucherId && allVouchers ? allVouchers.find((v: any) => v.id === savedVoucherId) : null);
        assertCanEdit(canEditRecord, isOwnRecord, currentVoucher);
        
        // Check backdate limit for edit - use ORIGINAL voucher date, not form date
        let originalVoucherDate = voucherDate;
        if (voucher?.date) {
          originalVoucherDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date);
        } else if (savedVoucherId) {
          const existingVoucher = allVouchers.find((v) => v.id === savedVoucherId);
          if (existingVoucher?.date) {
            originalVoucherDate = existingVoucher.date?.toDate
              ? existingVoucher.date.toDate()
              : new Date(existingVoucher.date);
          } else if (companyId) {
            const preferLocalReadsDate = preferLocalLedgerReads(company);
            if (preferLocalReadsDate) {
              const row = await getCompanyDocFromBrowserDb(companyId, "vouchers", savedVoucherId);
              if (row?.date != null) {
                originalVoucherDate = (row as { date?: { toDate?: () => Date } }).date?.toDate?.()
                  ? (row as { date: { toDate: () => Date } }).date.toDate()
                  : new Date(row.date as string | number | Date);
              }
            } else {
              const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, savedVoucherId));
              if (voucherDoc.exists()) {
                const voucherData = voucherDoc.data();
                originalVoucherDate = voucherData.date?.toDate
                  ? voucherData.date.toDate()
                  : new Date(voucherData.date);
              }
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
        sonnerToast.error("Permission Denied", { description: error.message });
      } else {
        sonnerToast.error("Error", { description: "Failed to check permissions." });
      }
      return;
    }

    const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving income...");
    if (toastId == null) return;
    setIsLoading(true);

    try {
      const originalVoucherIdToDelete: string | null = isEditingAndConverting
        ? getVoucherConvertOriginalId(voucher)
        : null;
      const idArgForFirestore = resolveVoucherIdForSave({
        savedVoucherId,
        originalVoucherIdToDelete,
      });

      if (!idArgForFirestore || data.voucherNumber !== voucher?.voucherNumber) {
        const preferLocalReads = preferLocalLedgerReads(company);
        let duplicateOtherId: string | null = null;
        if (preferLocalReads) {
          const hit = await findVoucherInLocalMirrorByNumberAndType(companyId, data.voucherNumber, voucherType);
          if (hit && hit.id !== idArgForFirestore) duplicateOtherId = hit.id;
        } else {
          const q = query(
            collection(firestore, `companies/${companyId}/vouchers`),
            where("voucherNumber", "==", data.voucherNumber),
            where("type", "==", voucherType)
          );
          const existingVoucherSnap = await getDocs(q);
          if (!existingVoucherSnap.empty && existingVoucherSnap.docs[0].id !== idArgForFirestore) {
            duplicateOtherId = existingVoucherSnap.docs[0].id;
          }
        }
        if (duplicateOtherId) {
          sonnerToast.error("Duplicate Voucher Number", { id: toastId, description: "This voucher number is already in use." });
          setIsLoading(false);
          return;
        }
      }
  
      let docId: string | null = idArgForFirestore;
      const { 
        date, 
        files: formFiles, 
        fileUrls: _ignoredFormFileUrls,
        updatedAt, 
        createdAt, 
        history, 
        lastEditedBy,
        unassignedFile,
        balance,
        credit,
        debit,
        ...restOfData 
      } = data as any;

      // Ensure amount is read directly from form and cleaned (remove any formatting)
      const formAmount = form.getValues('amount');
      const cleanAmount = typeof formAmount === 'string' 
        ? parseFloat(String(formAmount).replace(/,/g, '')) || 0
        : Number(formAmount || 0);

      const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });

      // Journal/Note path: existing string URLs + new File upload/stage, then attach to payload.
      let fileUrls: string[] = normalizeFormFileUrlsForSave(
        filesForSave.filter((f): f is string => typeof f === "string")
      );
      let preGeneratedVoucherId: string | undefined;
      const newFilesToUpload = filesForSave.filter((f) => typeof f !== "string") as File[];

      if (newFilesToUpload.length > 0) {
        const totalNewBytes = newFilesToUpload.reduce((s, f) => s + (f.size || 0), 0);
        const limitCheck = await checkStorageLimitSafe(companyId, company?.planId, { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes }, company?.storageOption);
        if (!limitCheck.allowed) {
          sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
          setIsLoading(false);
          return;
        }
        if (await shouldStageNewVoucherFilesAsLocalPending(companyId)) {
          const voucherIdForLocalAttachments =
            isEditingAndConverting && voucher?.id
              ? null
              : idArgForFirestore ?? null;
          const { fileUrls: merged, preGeneratedVoucherId: preGen } =
            await appendLocalOnlyVoucherFilesToUrls({
              companyId,
              storageFolder: String(voucherType),
              existingFileUrls: fileUrls,
              newFiles: newFilesToUpload,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: voucherIdForLocalAttachments,
            });
          fileUrls = merged;
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
          {
            const up = await uploadVoucherFilesOrStageLocalPending({
              companyId,
              storageFolder: String(voucherType),
              existingFileUrls: fileUrls,
              files: newFilesToUpload,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: isEditingAndConverting && voucher?.id ? null : idArgForFirestore ?? null,
            });
            fileUrls = up.fileUrls;
            if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
          }
        }
      }

      const submissionData: any = {
        ...restOfData,
        date: date.toISOString(),
        amount: cleanAmount,
        total: cleanAmount,
        type: voucherType
      };
      if (voucherType === 'payment_in') {
        submissionData.allocations = allocations ?? [];
      }
  
      const sanitizedData = JSON.parse(JSON.stringify(submissionData));
      if (!idArgForFirestore) delete (sanitizedData as { id?: string }).id;
      delete sanitizedData.fileUrls;
      delete sanitizedData.files;
      delete sanitizedData.unassignedFile;
      Object.assign(sanitizedData, voucherAttachmentFieldsForSave(fileUrls, voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))));
  
      const isEdit = !!voucher?.id && !originalVoucherIdToDelete;
      const approverName = customUser?.displayName || user?.displayName || user?.email || user?.uid;
      // Save se pehle snapshot — outbox flush / 409 mirror purani fileUrls form me wapas na laaye.
      savedFileUrlsSnapshotRef.current = fileUrls.filter((u) => Boolean(String(u).trim()));
      const savedDoc = await saveVoucher(
        companyId,
        user.uid,
        sanitizedData,
        idArgForFirestore,
        approveAfterSave ? { approvedByUserId: user.uid, approvedByName: approverName } : undefined,
        preGeneratedVoucherId ? { preGeneratedVoucherId } : undefined
      );

      if (savedDoc && savedDoc.id) {
          markCopiedDraftPersisted();
          docId = savedDoc.id;
          setSavedVoucherId(docId);
          if (originalVoucherIdToDelete) {
              await markVoucherConvertedInRecycleBin(companyId, originalVoucherIdToDelete, {
                convertedToType: voucherType,
                convertedToVoucherNumber: sanitizedData.voucherNumber,
                convertedToVoucherId: docId,
                deletedBy: user.uid,
              });
          }
      } else {
          throw new Error("Failed to save voucher and get ID.");
      }

        const approveBanner = !!(approveAfterSave && savedDoc?.id);
        const spendWisePending = pendingLinkedPaymentOut;
        const spendWiseLinkedRowIds = spendWiseLinkedToMeRows.map((r) => r.id);
        const billWiseAllocations =
          voucherType === "payment_in" && Array.isArray(sanitizedData.allocations)
            ? sanitizedData.allocations
            : null;
        const previousBillWiseAllocations = Array.isArray(voucher?.allocations) ? voucher.allocations : [];
        const needsBillWiseLinkSync =
          !!(billWiseAllocations && companyId && docId) &&
          hasBillWiseAllocationSyncWork(billWiseAllocations, previousBillWiseAllocations);
        const needsBackgroundSync =
          !!(spendWisePending && docId && user?.uid) || needsBillWiseLinkSync;

        if (approveBanner) {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEdit ? "Receipt updated and approved." : "Receipt saved and approved."
          );
        } else {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            "Receipt Recorded!",
            `Voucher #${data.voucherNumber} has been ${isEdit ? "updated" : "created"}.`
          );
        }
        setIsLoading(false);

        if (!saveAndNew) {
          onVoucherAction?.("saved", false, docId ?? undefined);
        }

        if (companyId && docId) {
          try {
            const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
              companyId,
              voucherId: docId,
              rawFileUrls: fileUrls,
              storageFolder: String(voucherType),
              previousUrls: initialFilesRef.current,
            });
            savedFileUrlsSnapshotRef.current = [...persistedUrls];
            setFiles(persistedUrls);
            initialFilesRef.current = [...persistedUrls];
          } catch (attachErr) {
            console.warn("[CreatePaymentInForm] post-save attachment finalize", attachErr);
          }
        }

        const postSaveTail = async () => {
          const linkWork = async () => {
            if (spendWisePending && docId && user?.uid) {
              const currentlyLinkedIds = new Set(spendWiseLinkedRowIds);
              const allAffectedIds = new Set([...currentlyLinkedIds, ...spendWisePending.ids]);
              for (const poId of allAffectedIds) {
                if (poId === SPEND_WISE_OPENING_BALANCE_ID) continue;
                const v = allVouchers?.find((x: any) => x.id === poId);
                if (!v) continue;
                const existingIds = Array.isArray(v.linkedPaymentInIds) ? [...v.linkedPaymentInIds] : [];
                const existingAmounts =
                  v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object"
                    ? { ...v.linkedPaymentInAmounts }
                    : {};
                const newIds = existingIds.filter((id) => id !== docId);
                delete existingAmounts[docId];
                if (spendWisePending.ids.includes(poId)) {
                  const amt = spendWisePending.amountsByVoucherId[poId] ?? 0;
                  if (amt > 0) {
                    newIds.push(docId);
                    existingAmounts[docId] = amt;
                  }
                }
                await updateVoucherSpendWiseLinks(companyId, poId, newIds, existingAmounts, user.uid);
              }
              const openingLinked =
                Number(spendWisePending.amountsByVoucherId[SPEND_WISE_OPENING_BALANCE_ID] ?? 0) || 0;
              await patchVoucherFields(companyId, docId, {
                linkedOpeningBalanceAmount: openingLinked,
                linkedOpeningBalanceAccountId: openingLinked > 0 ? accountId : null,
              });
              setPendingLinkedPaymentOut(null);
            }

            if (needsBillWiseLinkSync && billWiseAllocations && companyId && docId) {
              await syncBillWiseAllocationsToTargetVouchers(
                companyId,
                docId,
                billWiseAllocations,
                previousBillWiseAllocations
              );
            }
            if (voucherType === "payment_in" && billWiseAllocations) {
              initialAllocationsRef.current = billWiseAllocations.map((a: any) => ({
                voucherId: a.voucherId,
                amount: getAllocationTotal(a),
              }));
            }
          };

          if (needsBackgroundSync) {
            const linkResult = await runWithVoucherLinkSaveProgress(linkWork);
            if (!linkResult.ok) {
              sonnerToast.error("Link sync failed", {
                description: linkResult.error instanceof Error ? linkResult.error.message : undefined,
                duration: 5000,
              });
            }
          }

          // New create: saveVoucher(approveAfterSave) already set isApproved — skip second approve lookup.
          if (companyId && company) {
            const vid = docId ?? voucher?.id;
            if (isEdit) {
              const oldV = voucher as any;
              const changes = getChangedFieldLabels(
                { amount: oldV?.total ?? oldV?.amount, narration: oldV?.narration, date: oldV?.date?.toDate?.() ?? oldV?.date, voucherNumber: oldV?.voucherNumber, accountId: oldV?.accountId, partyId: oldV?.partyId, staffId: oldV?.staffId },
                { amount: data.amount, narration: data.narration, date: data.date, voucherNumber: data.voucherNumber, accountId: data.accountId, partyId: data.partyId, staffId: data.staffId },
                [
                  { key: "amount", label: "Amount" },
                  { key: "narration", label: "Narration" },
                  { key: "date", label: "Date" },
                  { key: "voucherNumber", label: "Voucher number" },
                  { key: "accountId", label: "Account" },
                  { key: "partyId", label: "Party" },
                  { key: "staffId", label: STAFF_ENTITY_LABEL },
                ]
              );
              await sendTransactionAlert(companyId, company, {
                kind: "edited",
                voucherId: vid,
                voucherNumber: data.voucherNumber,
                voucherType: voucherType,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
                changes: changes.length > 0 ? changes : undefined,
              });
            } else if (isAmountOverOneLakh(cleanAmount)) {
              await sendTransactionAlert(companyId, company, {
                kind: "large_amount",
                voucherId: vid,
                voucherNumber: data.voucherNumber,
                voucherType: voucherType,
                amount: cleanAmount,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
              });
            }
          }

          if (print && docId && company) {
            const payeeLabel =
              data.payeeType === "party"
                ? processedParties.find((p) => p.id === data.partyId)?.name ?? "—"
                : data.payeeType === "staff"
                  ? processedStaff.find((s) => s.id === data.staffId)?.name ?? "—"
                  : data.payeeType === "tax"
                    ? processedTaxes.find((t) => t.id === data.taxAccountId)?.name ?? "—"
                    : data.payeeType === "income"
                      ? expenseAccounts.find((e) => e.id === data.incomeAccountId)?.name ?? "—"
                      : data.payeeName?.trim() || "—";
            const accountLabel = processedAccounts.find((a) => a.id === data.accountId)?.accountName ?? "—";
            try {
              await printPaymentVoucherReceipt({
                company: {
                  name: company.name,
                  pan: company.pan,
                  phone: company.phone,
                  address: company.address,
                  decimalPlaces: company.decimalPlaces,
                  showDrCr: company.showDrCr,
                  showCurrencySymbol: company.showCurrencySymbol,
                  logoUrl: company.logoUrl,
                },
                dateSystem,
                formatDate,
                formatDateBS,
                formatCurrencyForPrint,
                voucherId: docId,
                voucherType,
                date: data.date instanceof Date ? data.date : new Date(data.date),
                voucherNumber: data.voucherNumber,
                amount: cleanAmount,
                narration: data.narration,
                payeeLabel,
                accountLabel,
              });
            } catch (printErr) {
              console.error(printErr);
              sonnerToast.error("Print preview failed", {
                description: printErr instanceof Error ? printErr.message : "Please try again.",
                duration: 4500,
              });
            }
          }

          if (saveAndNew) {
            form.reset(getInitialFormValues());
            setFiles([]);
            setSavePdfAsImage(false);
            setSavedVoucherId(null);
            setAllocations([]);
            await fetchVoucherNumber();
          }

          if (approveAfterSave && voucher?.id) onSuccess?.();
          else if (!approveAfterSave) onSuccess?.();

          if (saveAndNew) {
            onVoucherAction?.("saved", true, docId ?? undefined);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.error("[CreatePaymentInForm] post-save tail", err);
            sonnerToast.error("Receipt saved — finishing steps pending", {
              description: err instanceof Error ? err.message : "Alerts or print may still run.",
              duration: 4500,
            });
          });
          return;
        }

        await postSaveTail();

    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        sonnerToast.error("Permission Denied", { id: toastId, description: error.message });
      } else if (isVoucherLimitError(error)) {
        sonnerToast.error("Voucher limit reached", { id: toastId, description: error.message, action: { label: "Upgrade", onClick: () => window.location.assign("/billing") } });
      } else {
        console.error("Error saving voucher: ", error);
        voucherSaveErrorToast(toastId, error, "Failed to save voucher.");
      }
    } finally {
        setIsLoading(false);
    }
  }

  const handleDelete = async () => {
    if (!savedVoucherId || !companyId) return;
    
    try {
      // Permission check: delete (and delete_approved_voucher if voucher is approved)
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: savedVoucherId,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: allVouchers as Array<{ id?: string } & Record<string, unknown>> | null,
      });
      voucherDeleteDebugLog("form_precheck_permissions", {
        form: "payment_in",
        companyId,
        voucherId: savedVoucherId,
        isApproved: (voucherData as { isApproved?: unknown } | null)?.isApproved === true,
        canDeleteRecords: can("delete_records"),
        canDeleteApprovedVoucher: can("delete_approved_voucher"),
        canDeleteVoucher: canDeleteVoucher(voucherData),
      });
      if (!canDeleteVoucher(voucherData)) {
        throw new PermissionDeniedError(
          (voucherData as any)?.isApproved ? "You do not have permission to delete approved vouchers." : "You do not have permission to delete records."
        );
      }
      if (voucherData && hasPaymentLinks(voucherData)) {
        toast({ variant: "destructive", title: "Cannot Delete", description: "First unlink linked transactions." });
        return;
      }
      if (voucherDocExists && voucherData) {
        const voucherDate = resolveVoucherDeleteBackdateDate(voucherData, {
          form: "payment_in",
          companyId,
          voucherId: savedVoucherId,
        });
        assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
      }
    } catch (error) {
      voucherDeleteDebugLog("form_precheck_error", {
        form: "payment_in",
        companyId,
        voucherId: savedVoucherId,
        error:
          error && typeof error === "object"
            ? {
                name: (error as { name?: unknown }).name,
                code: (error as { code?: unknown }).code,
                message: (error as { message?: unknown }).message,
              }
            : { message: String(error ?? "") },
      });
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
        // Delete action local-first path me bhi voucher ko bin me move kare.
        await softDeleteVoucherMoveToRecycleBin(companyId, savedVoucherId, user?.uid || "");
        toast({ title: "Voucher Moved to Bin" });
        onVoucherAction?.('cancelled', false, savedVoucherId);
    } catch (error) {
        voucherDeleteDebugLog("form_delete_error", {
          form: "payment_in",
          companyId,
          voucherId: savedVoucherId,
          error:
            error && typeof error === "object"
              ? {
                  name: (error as { name?: unknown }).name,
                  code: (error as { code?: unknown }).code,
                  message: (error as { message?: unknown }).message,
                }
              : { message: String(error ?? "") },
        });
        console.error("Error deleting voucher:", error);
        toast({ variant: "destructive", title: "Error", description: "Failed to delete voucher." });
    } finally {
        setIsLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!savedVoucherId || !companyId) return;

    try {
      assertCanPermanentDeleteFromForm(can, role);
      const { voucherData, exists: voucherDocExists } = await loadVoucherDataForDeletePreCheck({
        companyId,
        voucherId: savedVoucherId,
        company,
        fallbackVoucher: (voucher as Record<string, unknown> | null) ?? null,
        vouchers: allVouchers as Array<{ id?: string } & Record<string, unknown>> | null,
      });
      if (!canDeleteVoucher(voucherData)) {
        throw new PermissionDeniedError(
          (voucherData as any)?.isApproved ? "You do not have permission to delete approved vouchers." : "You do not have permission to delete records."
        );
      }
      if (voucherData && hasPaymentLinks(voucherData)) {
        toast({ variant: "destructive", title: "Cannot Delete", description: "First unlink linked transactions." });
        return;
      }
      if (voucherDocExists && voucherData) {
        const voucherDate = resolveVoucherDeleteBackdateDate(voucherData, {
          form: "payment_in",
          companyId,
          voucherId: savedVoucherId,
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
      await permanentDeleteVoucherFromForm(companyId, savedVoucherId);
      toast({ title: "Receipt deleted permanently." });
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled", false, savedVoucherId);
    } catch (error) {
      console.error("Error permanently deleting voucher:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete voucher." });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    tracePaymentInAttach("handleFileChange", { picked: e.target.files?.length ?? 0, allowAttachments });
    if (!allowAttachments) {
      tracePaymentInAttach("exit: allowAttachments false");
      return;
    }
    await handleVoucherAttachmentInputChange(e, {
      companyId,
      currentFiles: files,
      maxFiles: fileAttachmentLimits.maxFileCount || 0,
      allowImage: fileAttachmentLimits.allowImage,
      allowPDF: fileAttachmentLimits.allowPDF,
      setFiles,
      toast,
    });
    tracePaymentInAttach("handleFileChange finished");
  };
  
  const isOwner = userIsSpecialAccountOwner(String(user?.email || user?.uid || ""), company);
  const availableAccounts = processedAccounts.filter((acc) => {
    if (!isNonClearingVoucherBankAccount(acc)) return false;
    if (!acc.isSpecial) return true;
    return specialAccountAllowsPaymentIn(acc, user?.email, isOwner);
  });
  const bankComboboxOptions = useMemo(
    () =>
      mapBankAccountsForVoucherCombobox(availableAccounts).map((opt) => ({
        ...opt,
        isSpecial: availableAccounts.find((a) => a.id === opt.value)?.isSpecial,
      })),
    [availableAccounts]
  );
  const voucherPrefixes = useMemo(() => company?.voucherPrefixes?.[voucherType] || [getVoucherPrefix()], [company, voucherType]);
  
  const paymentPayeeTypes = [
    { value: 'party', label: 'Party' },
    { value: 'staff', label: STAFF_ENTITY_LABEL },
    { value: 'tax', label: 'Tax' },
  ];
  const incomePayeeTypes = [
    { value: 'income', label: 'Income' },
  ];
  const currentPayeeTypes = voucherType === 'payment_in' ? paymentPayeeTypes : incomePayeeTypes;
  

  return (
    <>
      <Form {...form}>
        <form
          data-suppress-global-copy-red
          onSubmit={(e) => handleFormSubmit(e)}
          className="h-full flex flex-col min-w-0 w-full max-w-full"
        >
<ScrollArea className={cn("flex-1 overflow-x-hidden min-w-0 w-full", !isMobile && "pr-6 -mr-6")}>
            <div className={cn(
              "space-y-6 min-w-0 max-w-full w-full overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full",
              isMobile ? "" : "px-[2px]"
            )}>
              {/* Section 1 (Date + Voucher No.): unified ribbon tone for payment-in forms. */}
              <div className="rounded-lg border border-sky-400 bg-sky-100 p-2 md:p-3">
              {isMobile ? (
                <>
                  {/* Mobile: Prefix + Voucher No. + Date — `date` को `voucherNumber` के अंदर nest नहीं (RHF date submit तक bind रहे) */}
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
                                    <VoucherNumberInputWithRefresh placeholder="e.g. RCPT-001" {...voucherField} chromeSize="sm" className="h-9 text-xs px-2 min-w-0 max-w-full truncate w-full" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
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
                            {isPrefixSelectionEnabled && voucherPrefixes.length > 0 ? (
                              <Select
                                onValueChange={(prefix) => {
                                  fetchVoucherNumber(prefix);
                                }}
                                value={voucherPrefixes.find(p => field.value?.startsWith(normalizePrefix(p)) || field.value?.startsWith(p)) || voucherPrefixes[0]}
                                disabled={deleteDisabledWhenLinked}
                              >
                                <SelectTrigger className="w-32 h-10">
                                  <SelectValue/>
                                </SelectTrigger>
                                <SelectContent>
                                  {voucherPrefixes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : null}
                            <FormControl>
                              <VoucherNumberInputWithRefresh placeholder="e.g. RCPT-001" {...field} className="h-10" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
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
                                <BsDatePicker valueAD={field.value} onChangeAD={(d) => { 
                                  if (d) d.setHours(12, 0, 0, 0);
                                  field.onChange(d as Date); 
                                  setIsCalendarOpen(false); 
                                }} isRange={false} transactionDates={transactionDates} className={VOUCHER_PC_DATE_BS_PILL} disabled={deleteDisabledWhenLinked} />
                              </div>
                            )}
                            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <div className={cn(dateSystem === 'Both' ? VOUCHER_PC_DATE_BOTH_SLOT : "w-full min-w-0")}>
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      variant={"outline"}
                                      className={cn(VOUCHER_PC_DATE_AD_PILL, !field.value && "text-muted-foreground")}
                                      disabled={deleteDisabledWhenLinked}
                                    >
                                      {field.value ? formatDate(field.value) : <span>Pick a date</span>}
                                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 z-[102]" align="start">
                                  <Calendar mode="single" selected={field.value} onSelect={(date) => {
                                    if (date) {
                                      date.setHours(12, 0, 0, 0);
                                    }
                                    field.onChange(date);
                                    setIsCalendarOpen(false);
                                  }} initialFocus modifiers={{ hasTransactions: transactionDates }} modifiersClassNames={{ hasTransactions: "has-transactions" }} />
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

              {/* Section 2 (Account + Amount): keep payee/account controls and amount in one section. */}
              <div className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 p-2 md:p-3">
              {copyAccountCreateHint && (
                <p className="mb-2 text-[10px] md:text-xs font-semibold text-emerald-700">{copyAccountCreateHint}</p>
              )}
              {/* Pay Out jaise split: LEFT = Received From + Copy master (party/staff/tax/ledger) — RIGHT = bank + Copy account (khali/mismatch). Pehle full-width tha isliye Copy tax bank column ke upar dikhta tha. */}
              {isMobile ? (
                <>
                  <div className="grid grid-cols-2 gap-2 w-full items-stretch">
                    <div className="flex h-full min-h-0 min-w-0 flex-col space-y-2 rounded-lg border bg-muted/20 p-2">
                      <FormField
                        control={form.control}
                        name="payeeType"
                        render={({ field }: any) => (
                          <FormItem className="space-y-2">
                            <div className="flex items-center justify-between gap-1 min-w-0">
                              <FormLabel
                                className={cn(
                                  "text-xs shrink-0",
                                  highlightReceivedFromLabelCopyMismatch && "font-semibold text-red-600"
                                )}
                              >
                                Received From
                              </FormLabel>
                              {showCopyPayeeMasterFromSource && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-5 shrink-0 border-rose-300 px-1.5 text-[9px] text-rose-700"
                                  onClick={() => onCopyMissingCategory?.(copyPayeeMasterCategoryArg())}
                                  disabled={isCopyingMissingMasters}
                                >
                                  {isCopyingMissingMasters ? "…" : copyPayeeMasterButtonLabel()}
                                </Button>
                              )}
                            </div>
                            <FormControl>
                              <RadioGroup
                                onValueChange={(value) => {
                                  if (deleteDisabledWhenLinked) return;
                                  field.onChange(value);
                                  form.setValue("partyId", "");
                                  form.setValue("staffId", "");
                                  form.setValue("taxAccountId", "");
                                  form.setValue("incomeAccountId", "");
                                  form.setValue("payeeName", "");
                                }}
                                value={field.value}
                                className="flex flex-wrap gap-x-2 gap-y-1"
                              >
                                {currentPayeeTypes.map((type) => (
                                  <FormItem key={type.value} className="flex items-center space-x-2 space-y-0">
                                    <FormControl>
                                      <RadioGroupItem value={type.value} disabled={deleteDisabledWhenLinked} />
                                    </FormControl>
                                    <FormLabel className="font-normal text-xs">{type.label}</FormLabel>
                                  </FormItem>
                                ))}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    {payeeType === 'party' && (
                      <FormField
                        control={form.control}
                        name="partyId"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="party" className="min-w-0">
                            <div className="flex justify-between items-baseline mb-1 min-w-0">
                              <FormLabel className="text-xs truncate">{deleteDisabledWhenLinked ? "Received From (Party)" : "From (Party)"}</FormLabel>
                              {payeeBalance !== null && payeeBalance !== undefined && (
                                <FormLabel className={cn("text-[10px] font-semibold mr-[2px] shrink-0", payeeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {formatCurrencyForPrint(payeeBalance, { noSuffix: true, noAnimation: true })} {payeeBalance >= 0 ? 'Dr' : 'Cr'}
                                </FormLabel>
                              )}
                            </div>
                            <div className="min-w-0 w-full overflow-hidden">
                              <Combobox
                                triggerClassName="w-full min-w-0"
                                options={partyComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                  if (val === 'add-new') {
                                    setIsCreatePartyOpen(true);
                                    setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-party-name', { detail: newName })), 100);
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
                    )}
                    {payeeType === 'staff' && (
                      <FormField
                        control={form.control}
                        name="staffId"
                        render={({ field }: any) => (
                          <FormItem className="min-w-0">
                            <div className="flex justify-between items-baseline mb-1 min-w-0">
                              <FormLabel className="text-xs truncate">{deleteDisabledWhenLinked ? "Received From (Staff)" : "From (Staff)"}</FormLabel>
                              {payeeBalance !== null && payeeBalance !== undefined && (
                                <FormLabel className={cn("text-[10px] font-semibold mr-[2px] shrink-0", payeeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {formatCurrencyForPrint(payeeBalance, { noSuffix: true, noAnimation: true })} {payeeBalance >= 0 ? 'Dr' : 'Cr'}
                                </FormLabel>
                              )}
                            </div>
                            <div className="min-w-0 w-full overflow-hidden">
                              <Combobox
                                triggerClassName="w-full min-w-0"
                                options={staffComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                  if (val === 'add-new') {
                                    setIsCreateStaffOpen(true);
                                    setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-staff-name', { detail: newName })), 100);
                                  } else {
                                    field.onChange(val);
                                  }
                                }}
                                placeholder="Select staff"
                                addNewLabel="+ Add New Staff"
                                disabled={deleteDisabledWhenLinked}
                              />
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {payeeType === 'tax' && (
                      <FormField
                        control={form.control}
                        name="taxAccountId"
                        render={({ field }: any) => (
                          <FormItem className="min-w-0">
                            <div className="flex justify-between items-baseline mb-1 min-w-0">
                              <FormLabel className="text-xs truncate">{deleteDisabledWhenLinked ? "Received From (Tax)" : "From (Tax)"}</FormLabel>
                            </div>
                            <div className="min-w-0 w-full overflow-hidden">
                              <Combobox
                                triggerClassName="w-full min-w-0"
                                options={taxComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                  if (val === 'add-new') {
                                    setIsCreateTaxOpen(true);
                                    setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-tax-name', { detail: newName })), 100);
                                  } else {
                                    field.onChange(val);
                                  }
                                }}
                                placeholder="Select tax"
                                addNewLabel="+ Add New Tax Ledger"
                                disabled={deleteDisabledWhenLinked}
                              />
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {payeeType === 'income' && (
                      <FormField
                        control={form.control}
                        name="incomeAccountId"
                        render={({ field }: any) => (
                          <FormItem className="min-w-0">
                            <div className="flex justify-between items-baseline mb-1 min-w-0">
                              <FormLabel className="text-xs truncate">{deleteDisabledWhenLinked ? "Received From (Income)" : "From (Income)"}</FormLabel>
                            </div>
                            <div className="min-w-0 w-full overflow-hidden">
                              <Combobox
                                triggerClassName="w-full min-w-0"
                                options={incomeComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                  if (val === 'add-new') {
                                    setIsCreateExpenseAccountOpen(true);
                                    setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-expense-account-name', { detail: newName })), 100);
                                  } else {
                                    field.onChange(val);
                                  }
                                }}
                                placeholder="Select account"
                                addNewLabel="+ Add New Income Account"
                                disabled={deleteDisabledWhenLinked}
                              />
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    </div>
                    <div className="min-w-0 space-y-2">
                    <FormField
                      control={form.control}
                      name="accountId"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="account" className="min-w-0">
                          <div className="flex justify-between items-baseline mb-1 min-w-0 gap-1">
                            <FormLabel
                              className={cn(
                                "text-xs truncate",
                                highlightBankLabelCopyMismatch ? "font-semibold text-red-600" : "text-muted-foreground"
                              )}
                            >
                              To Bank/Cash
                            </FormLabel>
                            <div className="flex items-center gap-1 shrink-0">
                              {showCopyBankFromSource && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-5 px-1.5 text-[9px] border-rose-300 text-rose-700"
                                  onClick={() => onCopyMissingCategory?.("account_bank")}
                                  disabled={isCopyingMissingMasters}
                                >
                                  {isCopyingMissingMasters ? "…" : "Copy account"}
                                </Button>
                              )}
                              {accountBalance !== null && (
                                <FormLabel className={cn("text-[10px] font-semibold shrink-0", accountBalance >= 0 ? "text-green-600" : "text-red-600")}>
                                  Bal: {formatCurrency(Math.abs(accountBalance), {noAnimation: true, noSuffix: true})} {accountBalance >= 0 ? "Dr" : "Cr"}
                                </FormLabel>
                              )}
                            </div>
                          </div>
                          <div className="min-w-0 w-full overflow-hidden">
                            <Combobox
                              triggerClassName="w-full min-w-0"
                              options={bankComboboxOptions}
                              value={field.value}
                              onChange={(value, newName) => {
                                if (value === "add-new") {
                                  setIsCreateAccountOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(new CustomEvent('prefill-create-bank-account-name', { detail: newName }));
                                  }, 100);
                                } else {
                                  field.onChange(value);
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
                  </div>
                </>
              ) : (
                <div className="grid min-w-0 grid-cols-2 gap-6 items-stretch">
                  <div className="flex h-full min-h-0 min-w-0 flex-col space-y-3 rounded-lg border bg-muted/20 p-3">
                    <FormField
                      control={form.control}
                      name="payeeType"
                      render={({ field }: any) => (
                        <FormItem className="space-y-3">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <FormLabel
                              className={cn(
                                "shrink-0",
                                highlightReceivedFromLabelCopyMismatch && "font-semibold text-red-600"
                              )}
                            >
                              Received From
                            </FormLabel>
                            {showCopyPayeeMasterFromSource && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 shrink-0 border-rose-300 px-2 text-[10px] text-rose-700"
                                onClick={() => onCopyMissingCategory?.(copyPayeeMasterCategoryArg())}
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : copyPayeeMasterButtonLabel()}
                              </Button>
                            )}
                          </div>
                          <FormControl>
                            <RadioGroup
                              onValueChange={(value) => {
                                if (deleteDisabledWhenLinked) return;
                                field.onChange(value);
                                form.setValue("partyId", "");
                                form.setValue("staffId", "");
                                form.setValue("taxAccountId", "");
                                form.setValue("incomeAccountId", "");
                                form.setValue("payeeName", "");
                              }}
                              value={field.value}
                              className="flex flex-wrap gap-x-4 gap-y-1"
                              disabled={deleteDisabledWhenLinked}
                            >
                              {currentPayeeTypes.map((type) => (
                                <FormItem key={type.value} className="flex items-center space-x-2 space-y-0">
                                  <FormControl>
                                    <RadioGroupItem value={type.value} disabled={deleteDisabledWhenLinked} />
                                  </FormControl>
                                  <FormLabel className="font-normal">{type.label}</FormLabel>
                                </FormItem>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  {payeeType === 'party' && (
                    <FormField
                      control={form.control}
                      name="partyId"
                      render={({ field }: any) => (
                        <FormItem data-ocr-field="party">
                          <div className="flex justify-between items-baseline">
                            <FormLabel>{deleteDisabledWhenLinked ? "Received From (Party)" : "From (Party)"}</FormLabel>
                            {payeeBalance !== null && payeeBalance !== undefined && (
                              <FormLabel className={cn("text-xs font-semibold", payeeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                {payeeBalance >= 0 
                                  ? `Receivable: ${formatCurrencyForPrint(payeeBalance, { noSuffix: true, noAnimation: true })} Dr`
                                  : `Payable: ${formatCurrencyForPrint(Math.abs(payeeBalance), { noSuffix: true, noAnimation: true })} Cr`
                                }
                              </FormLabel>
                            )}
                          </div>
                          <Combobox
                            options={partyComboboxOptions}
                            value={field.value}
                            onChange={(val, newName) => {
                              if (val === 'add-new') {
                                setIsCreatePartyOpen(true);
                                setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-party-name', { detail: newName })), 100);
                              } else {
                                field.onChange(val);
                              }
                            }}
                            placeholder="Select a customer"
                            addNewLabel="+ Add New Party"
                            disabled={deleteDisabledWhenLinked}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                 {payeeType === 'staff' && (
                    <FormField
                      control={form.control}
                      name="staffId"
                      render={({ field }: any) => (
                        <FormItem>
                           <div className="flex justify-between items-baseline">
                                <FormLabel>{deleteDisabledWhenLinked ? "Received From (Staff)" : "From (Staff)"}</FormLabel>
                                {payeeBalance !== null && payeeBalance !== undefined && (
                                    <FormLabel className={cn("text-xs font-semibold", payeeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                       {payeeBalance >= 0 
                                         ? `Receivable: ${formatCurrencyForPrint(payeeBalance, { noSuffix: true, noAnimation: true })} Dr`
                                         : `Payable: ${formatCurrencyForPrint(Math.abs(payeeBalance), { noSuffix: true, noAnimation: true })} Cr`
                                       }
                                    </FormLabel>
                                )}
                            </div>
                           <Combobox
                                options={staffComboboxOptions}
                                value={field.value}
                                 onChange={(val, newName) => {
                                    if (val === 'add-new') {
                                        setIsCreateStaffOpen(true);
                                        setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-staff-name', { detail: newName })), 100);
                                    } else {
                                        field.onChange(val);
                                    }
                                }}
                                placeholder="Select a staff member"
                                addNewLabel="+ Add New Staff"
                                disabled={deleteDisabledWhenLinked}
                            />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                 )}
                {payeeType === 'tax' && (
                    <FormField
                      control={form.control}
                      name="taxAccountId"
                      render={({ field }: any) => (
                        <FormItem>
                          <div className="flex justify-between items-baseline">
                            <FormLabel>{deleteDisabledWhenLinked ? "Received From (Tax)" : "From (Tax)"}</FormLabel>
                            {payeeBalance !== null && payeeBalance !== undefined && (
                                <FormLabel className={cn("text-xs font-semibold", payeeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                   {payeeBalance >= 0 
                                     ? `Receivable: ${formatCurrencyForPrint(payeeBalance, { noSuffix: true, noAnimation: true })} Dr`
                                     : `Payable: ${formatCurrencyForPrint(Math.abs(payeeBalance), { noSuffix: true, noAnimation: true })} Cr`
                                   }
                                </FormLabel>
                            )}
                          </div>
                            <Combobox
                                options={taxComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                    if (val === 'add-new') {
                                        setIsCreateTaxOpen(true);
                                        setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-tax-name', { detail: newName })), 100);
                                    } else {
                                        field.onChange(val);
                                    }
                                }}
                                placeholder="Select a tax ledger"
                                addNewLabel="+ Add New Tax Ledger"
                                disabled={deleteDisabledWhenLinked}
                            />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                )}
                 {payeeType === 'income' && (
                    <FormField
                      control={form.control}
                      name="incomeAccountId"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>{deleteDisabledWhenLinked ? "Received From (Income)" : "From (Income)"}</FormLabel>
                            <Combobox
                                options={incomeComboboxOptions}
                                value={field.value}
                                onChange={(val, newName) => {
                                    if (val === 'add-new') {
                                        setIsCreateExpenseAccountOpen(true);
                                        setTimeout(() => document.dispatchEvent(new CustomEvent('prefill-create-expense-account-name', { detail: newName })), 100);
                                    } else {
                                        field.onChange(val);
                                    }
                                }}
                                placeholder="Select an income account"
                                addNewLabel="+ Add New Income Account"
                                disabled={deleteDisabledWhenLinked}
                            />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                 )}
                  </div>
                  <div className="min-w-0 space-y-3">
                <FormField
                  control={form.control}
                  name="accountId"
                  render={({ field }: any) => (
                    <FormItem data-ocr-field="account">
                       <div className="flex justify-between items-baseline gap-2 min-w-0">
                        <FormLabel className={cn(highlightBankLabelCopyMismatch && "font-semibold text-red-600")}>
                          To Bank/Cash Account
                        </FormLabel>
                        <div className="flex items-center gap-2 shrink-0">
                          {showCopyBankFromSource && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[10px] border-rose-300 text-rose-700"
                              onClick={() => onCopyMissingCategory?.("account_bank")}
                              disabled={isCopyingMissingMasters}
                            >
                              {isCopyingMissingMasters ? "…" : "Copy account"}
                            </Button>
                          )}
                          {accountBalance !== null && (
                            <FormLabel className={cn("text-xs font-semibold", accountBalance >= 0 ? "text-green-600" : "text-red-600")}>
                              Balance: {formatCurrency(Math.abs(accountBalance), { noSuffix: true, noAnimation: true })} {accountBalance >= 0 ? "Dr" : "Cr"}
                            </FormLabel>
                          )}
                        </div>
                      </div>
                       <Combobox
                            options={bankComboboxOptions}
                            value={field.value}
                            onChange={(value, newName) => {
                              if (value === "add-new") {
                                  setIsCreateAccountOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(new CustomEvent('prefill-create-bank-account-name', { detail: newName }));
                                  }, 100);
                              } else {
                                  field.onChange(value);
                              }
                            }}
                            placeholder="Select an account"
                            addNewLabel="+ Add New Account"
                            disabled={deleteDisabledWhenLinked}
                        />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="amount"
                render={({ field }: any) => {
                  const hasLinks = allocations.length > 0;
                  const amountDisabled = hasLinks || deleteDisabledWhenLinked;
                  return (
                  <FormItem data-ocr-field="amount">
                    <FormLabel>Amount Received</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        value={typeof field.value === 'number' ? field.value : (field.value ?? '')} 
                        onChange={(e) => {
                          if (amountDisabled) return;
                          const rawValue = e.target.value;
                          if (rawValue === '' || rawValue === null || rawValue === undefined) {
                            field.onChange(0);
                          } else {
                            const cleanValue = String(rawValue).replace(/,/g, '');
                            const numValue = parseFloat(cleanValue);
                            field.onChange(isNaN(numValue) ? 0 : numValue);
                          }
                        }}
                        disabled={amountDisabled}
                        className={amountDisabled ? "bg-muted" : ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                  );
                }}
              />
              </div>
              {/* Section 3 (Attachment + Narration): single grouped container for file + narration. */}
              <div className="rounded-lg border border-indigo-300/80 bg-indigo-50 p-3">
              {/* Desktop par narration ko attachment ke right me lane ke liye dono fields ek responsive 2-col grid me. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start min-w-0">
              {/* File pehle — link cards ke upar; warna link ke baad attach band ho jata hai */}
              <FormItem>
                <FormLabel>Attach Files (Optional)</FormLabel>
                {showPdfAsImageToggle && (
                  <VoucherPdfAsImageToggle
                    existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                    id="voucher-save-pdf-as-image-payment-in"
                    checked={savePdfAsImage}
                    onCheckedChange={setSavePdfAsImage}
                    disabled={!allowAttachments || fileAttachLockedByDialog || fileAttachmentLimits.maxFileCount === 0}
                    className="mb-2"
                  />
                )}
                <VoucherOcrRefreshBar ocr={ocr} copilot={copilot} />
                <RestrictedFileUploader>
                  <div className="flex flex-wrap gap-4">
                    {files.map((file, index) => (
                      <FilePreview
                        key={typeof file === "string" ? file : `${file.name}-${file.size}-${index}`}
                        file={file}
                        attachmentCompanyId={companyId || undefined}
                        attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                        onRemove={
                          allowAttachments && !fileAttachLockedByDialog && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete
                            ? () => {
                                setFiles((prev) => {
                                  const next = prev.filter((_, i) => i !== index);
                                  // Parent/live merge se pehle hi authoritative empty/partial list lock.
                                  savedFileUrlsSnapshotRef.current = next.filter(
                                    (f): f is string => typeof f === "string" && Boolean(String(f).trim())
                                  );
                                  return next;
                                });
                              }
                            : undefined
                        }
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
                            tracePaymentInAttach("label pointerdown (user tapped Add File area)");
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
                            "relative flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors",
                            allowAttachments && fileAttachmentLimits.maxFileCount > 0
                              ? "cursor-pointer text-muted-foreground hover:border-primary"
                              : "pointer-events-none cursor-not-allowed border-muted-foreground/25 text-muted-foreground/50 opacity-50"
                          )}
                        >
                          <PlusCircle className="h-6 w-6" />
                          <span className="mt-1 text-xs">Add File</span>
                        </AttachmentHoldPasteSurface>
                        <Input
                          id={attachFileInputId}
                          type="file"
                          className="sr-only"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          onClick={() =>
                            tracePaymentInAttach("native <input type=file> click", {
                              disabled: fileAttachLockedByDialog || !allowAttachments || fileAttachmentLimits.maxFileCount === 0,
                            })
                          }
                          accept={
                            [fileAttachmentLimits.allowImage ? "image/*" : "", fileAttachmentLimits.allowPDF ? "application/pdf" : ""]
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
              {/* Mobile me narration neeche, desktop me right column me show hota hai. */}
              <div className="grid grid-cols-1 gap-4 min-w-0">
                <FormField
                  control={form.control}
                  name="narration"
                  render={({ field }: any) => (
                    <FormItem data-ocr-field="bill-no" className="min-w-0">
                      <FormLabel>Narration</FormLabel>
                      <FormControl>
                        {/* Lambi narration PC static me resize + scroll */}
                        <Textarea placeholder="Additional details..." {...field} className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              </div>
              </div>
              {/* Section 4 (Links): bill-wise and spend-wise remain separate cards in independent link section. */}
              <div className={cn("grid gap-4 grid-cols-1 min-w-0 max-w-full")}>
                {shouldShowLinkButton && (
                  <div className="pb-1">
                    {/* One-click reveal for link panels in add/new and non-linked edit. */}
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSections(true)}>Show Link</Button>
                  </div>
                )}
                {/* 1. Link for bill wise — full width, above spend wise (same order as Payment) */}
                {/* Bill-wise link card gets its own pink tone to visually separate from spend-wise card. */}
                {shouldShowBillWiseSection && (
                  <div
                    className="space-y-2 rounded-lg border-2 border-rose-300/80 bg-rose-50 p-3 min-w-0 w-full max-w-full overflow-hidden"
                    // Fail-safe: keep bill-wise panel pink even if utility class cache/build misses.
                    style={{ backgroundColor: "#fff1f2", borderColor: "#fda4af" }}
                  >
                    <div className="flex items-center gap-2 font-semibold min-w-0 border-b border-border/60 pb-2">
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">Link for bill wise</span>
                    </div>
                    {company?.enableLinkPaymentToTxns && (
                      <p className="text-sm text-blue-600">
                        {billWiseLinkableCount > 0
                          ? `${billWiseLinkableCount} voucher${billWiseLinkableCount === 1 ? "" : "s"} available to link, so link 1st to save.`
                          : "You can save this voucher without linking, bcz no voucher to link."}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {billWiseLinkableCount} voucher(s) available to link.{linkedToRows.length > 0 && ` ${linkedToRows.length} linked.`}
                    </p>
                    {linkedToRows.length === 0 ? null : (
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
                            {linkedToRows.map((r) => {
                              const targetVoucher = allVouchers?.find((v: any) => v.id === r.voucherId) as any;
                              const billTotal = targetVoucher != null ? Number(targetVoucher?.total ?? targetVoucher?.amount ?? 0) || 0 : 0;
                              const linkedOnOthers = linkedOnOthersByVoucherId.get(r.voucherId) ?? 0;
                              const rowProps = can('edit_link') ? { role: "button" as const, tabIndex: 0, className: "cursor-pointer hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 border-b border-border/30 last:border-b-0", onClick: () => setIsLinkDialogOpen(true), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsLinkDialogOpen(true); } } } : { className: "border-b border-border/30 last:border-b-0" };
                              return (
                                <tr key={r.voucherId} {...rowProps}>
                                  <td className="p-2 text-muted-foreground whitespace-nowrap">{r.voucherNumber === "Opening Balance" ? "—" : (r.date ? (dateSystem === "BS" ? formatDateBS(r.date) : formatDate(r.date)) : "—")}</td>
                                  <td className="p-2 font-medium whitespace-nowrap">{r.voucherNumber}</td>
                                  <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(billTotal || r.amount, { noSuffix: true, noAnimation: true })}</td>
                                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(linkedOnOthers, { noSuffix: true, noAnimation: true })}</td>
                                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(r.amount, { noSuffix: true, noAnimation: true })}</td>
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
                          <span className="truncate text-right whitespace-nowrap leading-tight">{formatCurrency(totalLinked, { noSuffix: true, noAnimation: true })}</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                          <span className="truncate leading-tight">Balance</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                          <span className={cn("truncate text-right whitespace-nowrap leading-tight", remainingToLink === 0 ? "text-green-600 font-semibold" : "")}>
                            {remainingToLink === 0 ? "Settled" : formatCurrency(remainingToLink, { noSuffix: true, noAnimation: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Entity account closing balance not shown here — user sees it in voucher form (From Party/Staff/Tax label). */}
                    {can('add_link') && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap min-w-0">
                        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setIsLinkDialogOpen(true)}>
                          <Link2 className="h-4 w-4 mr-2" />
                          Link to Dr
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {/* Salary link card uses violet tone so it does not clash with bill/spend link colors. */}
                {shouldShowSalarySection && (
                  <div className="space-y-2 rounded-lg border-2 border-violet-300/80 bg-violet-50 p-3 min-w-0 w-full max-w-full overflow-hidden">
                    <div className="flex items-center gap-2 font-semibold min-w-0 border-b border-border/60 pb-2">
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">Link for salary</span>
                    </div>
                    {linkedToRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No salary vouchers linked to this payment.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-1 min-w-0 scrollbar-slim-dim-extra">
                        <table className="w-full text-sm border-collapse min-w-[400px]">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Date</th>
                              <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Voucher No.</th>
                              <th className="text-left p-2 font-semibold text-black whitespace-nowrap">From</th>
                              <th className="text-right p-2 font-semibold text-black whitespace-nowrap">Linked on current</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linkedToRows.map((r: any) => (
                              <tr key={r.voucherId} className="border-b border-border/30 last:border-b-0">
                                <td className="p-2 text-muted-foreground whitespace-nowrap">{r.voucherNumber === "Opening Balance" ? "—" : (r.date ? (dateSystem === "BS" ? formatDateBS(r.date) : formatDate(r.date)) : "—")}</td>
                                <td className="p-2 font-medium whitespace-nowrap">{r.voucherNumber}</td>
                                <td className="p-2 whitespace-nowrap">{r.typeLabel ?? "Voucher"}</td>
                                <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(r.amount, { noSuffix: true, noAnimation: true })}</td>
                              </tr>
                            ))}
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
                          <span className="truncate text-right whitespace-nowrap leading-tight">{formatCurrency(totalLinked, { noSuffix: true, noAnimation: true })}</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                          <span className="truncate leading-tight">Balance</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                          <span className={cn("truncate text-right whitespace-nowrap leading-tight", remainingToLink === 0 ? "text-green-600 font-semibold" : "")}>
                            {remainingToLink === 0 ? "Settled" : formatCurrency(remainingToLink, { noSuffix: true, noAnimation: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap min-w-0">
                      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setIsLinkToSalaryOpen(true)}>
                        <Link2 className="h-4 w-4 mr-2" />
                        Link to Salary
                      </Button>
                    </div>
                  </div>
                )}
                {/* 2. Link for spend wise — two columns: left = From Voucher, right = To Voucher (swapped back) */}
                {shouldShowSpendWiseSection && (
                  <div className="grid grid-cols-1 gap-4 min-w-0 w-full">
                    {/* Left: From Voucher (this voucher as on opposite) — message inside card when Link for Bill Wise is ON */}
                    {/* Spend-wise link card uses amber tone so each link section color stays distinct. */}
                    <div
                      className="space-y-2 rounded-lg border-2 border-amber-300/80 bg-amber-50 p-3 min-w-0 w-full max-w-full overflow-hidden"
                      // Fail-safe: keep spend-wise panel amber even if utility class cache/build misses.
                      style={{ backgroundColor: "#fffbeb", borderColor: "#fcd34d" }}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 font-medium min-w-0">
                          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">Link for spend wise</span>
                        </div>
                        {/* Keep only From Voucher wording per requested spend-wise layout. */}
                        <span className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-base font-medium text-blue-700">From Voucher</span>
                      </div>
                      {spendWiseLinkRequired && (
                        <p className="text-sm text-blue-600">
                          {spendWiseLinkableCount > 0
                            ? `${spendWiseLinkableCount} voucher${spendWiseLinkableCount === 1 ? "" : "s"} available to link, so link 1st to save.`
                            : "You can save this voucher without linking, bcz no voucher to link."}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {spendWiseLinkableCount} voucher(s) available to link.
                      </p>
                      {currentVoucherAsOnOppositeRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Save the voucher to see how it appears on the opposite voucher.</p>
                      ) : (
                        <div className="overflow-x-auto -mx-1 min-w-0">
                          <table className="w-full text-sm border-collapse min-w-[400px]">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                                {/* From Voucher card: show correct column label (bank/cash account comes from) */}
                                <th className="text-left p-2 font-medium whitespace-nowrap">From</th>
                                <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                                {/* Match Payment spend-wise columns for consistency */}
                                <th className="text-right p-2 font-medium whitespace-nowrap">Linked on others</th>
                                <th className="text-right p-2 font-medium whitespace-nowrap">Linked on current</th>
                                <th className="text-center p-2 font-medium whitespace-nowrap">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentVoucherAsOnOppositeRows.map((row) => {
                                const status = getSpendWiseReceiptStatus(row.amount, row.linked);
                                return (
                                  <tr key={row.id} className="border-b last:border-b-0">
                                    <td className="p-2 text-muted-foreground whitespace-nowrap">{row.date ? (dateSystem === "BS" ? formatDateBS(row.date) : formatDate(row.date)) : "—"}</td>
                                    <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                                    <td className="p-2 whitespace-nowrap">{row.from}</td>
                                    <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(row.amount, { noSuffix: true, noAnimation: true })} Dr</td>
                                    {/* Payment In's opposite preview has no per-voucher "others"; keep 0 so layout matches Payment */}
                                    <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(0, { noSuffix: true, noAnimation: true })} Dr</td>
                                    <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(row.linked, { noSuffix: true, noAnimation: true })} Dr</td>
                                    <td className="p-2 text-center whitespace-nowrap">
                                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", status.className)}>
                                        {status.label}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {currentVoucherAsOnOppositeRows.length > 0 && (
                        <div className="pt-2 border-t flex justify-end min-w-0">
                          <div className="grid grid-cols-2 gap-1.5 text-sm w-fit">
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center min-h-0 min-w-0 overflow-hidden">
                              <span className="text-muted-foreground truncate leading-tight">Total linked</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate text-right whitespace-nowrap leading-tight">
                                {formatCurrency(currentVoucherAsOnOppositeRows[0].linked, { noSuffix: true, noAnimation: true })} Dr
                              </span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className="truncate leading-tight">Balance</span>
                            </div>
                            <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                              <span className={cn("truncate text-right whitespace-nowrap leading-tight", currentVoucherAsOnOppositeRows[0].linked >= currentVoucherAsOnOppositeRows[0].amount && currentVoucherAsOnOppositeRows[0].amount > 0 ? "text-green-600 font-semibold" : "")}>
                                {currentVoucherAsOnOppositeRows[0].linked >= currentVoucherAsOnOppositeRows[0].amount && currentVoucherAsOnOppositeRows[0].amount > 0
                                  ? "Settled"
                                  : `${formatCurrency(Math.max(0, currentVoucherAsOnOppositeRows[0].amount - currentVoucherAsOnOppositeRows[0].linked), { noSuffix: true, noAnimation: true })} Dr`}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Left card: Link Pay Out — on Payment In we link Payment (and Contra/DE) to this receipt */}
                      {shouldShowSpendWiseSection && (
                        <div className="pt-2 border-t flex flex-wrap gap-2 items-center">
                          <Button type="button" className={cn("w-fit", BTN_SAVE_CLASS)} onClick={() => setIsLinkPaymentOutDialogOpen(true)}>
                            <Link2 className="h-4 w-4 mr-2" />
                            Link Pay Out
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setLinkSectionInfoOpen(true)} aria-label="Link section information">
                            <Info className="h-4 w-4 shrink-0" />
                            Read me
                          </Button>
                        </div>
                      )}
                    </div>
                    {/* Requested consistency: keep only From Voucher card in spend-wise; hide second card. */}
                  </div>
                )}
              </div>

            </div>
          </ScrollArea>

          <div className={cn(
            "border-t min-w-0 max-w-full overflow-x-hidden",
            isMobile ? "mt-[3px] pt-[3px] pb-[3px] space-y-0" : "pt-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4"
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
                <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_PRINT_CLASS)}>
                  Save & Print
                </Button>
                {/* Row 1: Cancel | Save | Approve (right) — CreateSaleForm jaisa */}
                <Button type="button" onClick={() => { setAllocations(initialAllocationsRef.current.map((a) => ({ voucherId: a.voucherId, amount: a.amount }))); setPendingLinkedPaymentOut(null); onVoucherAction?.('cancelled'); }} className={cn("w-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                {/* Edit + unchanged → Save off; chhota sa dirty → on (Approve jaisa) */}
                <Button type="submit" disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_SAVE_CLASS)}>
                  {isLoading ? "..." : isEditingAndConverting ? "Convert" : "Save"}
                </Button>
                {voucher?.id ? (
                  <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty || isEditingAndConverting) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_APPROVE_CLASS)}>
                    {isApproving ? "..." : isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve"}
                  </Button>
                ) : showSaveAndApproveOnCreate ? (
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_APPROVE_CLASS)}>
                    {isLoading ? "..." : "Save & Approve"}
                  </Button>
                ) : (
                  <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">—</Button>
                )}
              </div>
            ) : (
              <>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher || !onOpenHistory} className={cn("shrink-0", BTN_HISTORY_CLASS)}>
                    <History className="mr-2 h-4 w-4" /> History
                  </Button>
                  <Button type="button" variant="destructive" className="w-full md:w-auto shrink-0 rounded-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                </div>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={() => { setAllocations(initialAllocationsRef.current.map((a) => ({ voucherId: a.voucherId, amount: a.amount }))); setPendingLinkedPaymentOut(null); onVoucherAction?.('cancelled'); }} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={!!voucher || linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save & New
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}>
                    <Printer className="mr-2 h-4 w-4" />
                    Save & Print
                  </Button>
                  <Button type="submit" disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty && !isEditingAndConverting)} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditingAndConverting ? "Convert" : "Save"}
                  </Button>
                  {voucher?.id ? (
                    <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty || isEditingAndConverting) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={linkPayOthersDisabled || isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting)} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                      {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                      {isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve"}
                    </Button>
                  ) : (
                    <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={linkPayOthersDisabled || !showSaveAndApproveOnCreate || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save & Approve
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </form>
      <VoucherOcrAiCopilot ocr={ocr} layout={copilot} thumbUrl={thumbUrl} />
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
          void onRefreshCopyMismatch?.();
        }}
        isOpen={isCreatePartyOpen}
        onOpenChange={setIsCreatePartyOpen}
      />
      <CreateStaffDialog
        onStaffCreated={(id) => {
          pendingStaffIdUntilInStaffListRef.current = id;
          setIsCreateStaffOpen(false);
          form.setValue("staffId", id);
          void onRefreshCopyMismatch?.();
        }}
        isOpen={isCreateStaffOpen}
        onOpenChange={setIsCreateStaffOpen}
        groups={[]}
      >
        <div/>
      </CreateStaffDialog>
       <CreateBankAccountDialog 
        onAccountCreated={(id) => {
            pendingAccountIdUntilInAccountsListRef.current = id;
            setIsCreateAccountOpen(false);
            form.setValue("accountId", id);
            setCopyAccountCreateHint("");
            void onRefreshCopyMismatch?.();
        }} 
        isOpen={isCreateAccountOpen} 
        onOpenChange={(open) => {
          setIsCreateAccountOpen(open);
          if (!open) setCopyAccountCreateHint("");
        }}
      />
       <CreateExpenseAccountDialog 
          isOpen={isCreateExpenseAccountOpen} 
          onOpenChange={(open) => {
            setIsCreateExpenseAccountOpen(open);
            if (!open) setCopyAccountCreateHint("");
          }}
          onExpenseAccountCreated={(id) => {
            pendingIncomeAccountIdUntilInListRef.current = id;
            setIsCreateExpenseAccountOpen(false);
            form.setValue("incomeAccountId", id);
            setCopyAccountCreateHint("");
            void onRefreshCopyMismatch?.();
        }} >
          <div/>
        </CreateExpenseAccountDialog>
       <CreateTaxDialog 
        onTaxCreated={(id) => {
            pendingTaxIdUntilInTaxesListRef.current = id;
            setIsCreateTaxOpen(false);
            form.setValue("taxAccountId", id);
            void onRefreshCopyMismatch?.();
        }} 
        isOpen={isCreateTaxOpen} 
        onOpenChange={setIsCreateTaxOpen}
      />
      {voucherType === "payment_in" && partyId && (
        <LinkPaymentToTxnsDialog
          isOpen={isLinkDialogOpen}
          onOpenChange={setIsLinkDialogOpen}
          variant="payment_in"
          partyId={partyId}
          partyName={processedParties.find((p) => p.id === partyId)?.name ?? "Party"}
          receivedAmount={Number(form.watch("amount")) || 0}
          existingAllocations={existingAllocationsForLinkDialog}
          paymentInId={voucher?.id ?? savedVoucherId ?? undefined}
          accountId={form.watch("accountId") || undefined}
          paymentInVoucherNumber={form.watch("voucherNumber") || undefined}
          paymentInDate={form.watch("date")}
          partyOpeningBalance={processedParties.find((p) => p.id === partyId)?.openingBalance ?? 0}
          dialogTitle="Link Receipt to Linkable Dr Txns"
          onDone={(allocs, _amount, info) => {
            // Link save only on local; server save when user clicks Save on voucher
            setAllocations(allocs);
            // Orphan reverse TDS mirror (no forward link left on this voucher): delete it right away on both vouchers.
            const ownId = voucher?.id ?? savedVoucherId;
            if (info?.orphanTdsEntityIds?.length && companyId && ownId) {
              void removeTdsLegLinks(companyId, ownId, info.orphanTdsEntityIds, allVouchers as any[]).catch((e) =>
                console.warn("[removeTdsLegLinks]", e)
              );
            }
          }}
        />
      )}
      {voucherType === "payment_in" && staffId && (
        <LinkPaymentInToSalaryDialog
          isOpen={isLinkToSalaryOpen}
          onOpenChange={setIsLinkToSalaryOpen}
          staffId={staffId}
          staffName={processedStaff.find((s) => s.id === staffId)?.name ?? STAFF_ENTITY_LABEL}
          paymentInId={voucher?.id ?? savedVoucherId ?? null}
          amountReceived={amountReceived}
          existingAllocations={allocations}
          staffOpeningBalance={processedStaff.find((s) => s.id === staffId)?.openingBalance ?? 0}
          paymentInVoucherNumber={form.watch("voucherNumber") || undefined}
          paymentInDate={form.watch("date")}
          onDone={setAllocations}
        />
      )}
      {accountId && (voucherType === "payment_in" || voucherType === "direct_income") && (
        <LinkPaymentOutToPaymentInDialog
          isOpen={isLinkPaymentOutDialogOpen}
          onOpenChange={setIsLinkPaymentOutDialogOpen}
          accountId={accountId}
          currentPaymentInId={currentVoucherId ?? ""}
          vouchers={allVouchers ?? []}
          selectedIds={pendingLinkedPaymentOut ? pendingLinkedPaymentOut.ids : linkedPaymentOutSelectedIds}
          names={paymentOutDialogNames}
          requiredAmount={amountReceived}
          accountName={processedAccounts?.find((a: any) => a.id === accountId)?.accountName ?? undefined}
          accountOpeningBalance={accountOpeningBalance}
          currentVoucherLinkedAmounts={pendingLinkedPaymentOut ? pendingLinkedPaymentOut.amountsByVoucherId : Object.fromEntries(spendWiseLinkedToMeRows.map((r) => [r.id, r.linked]))}
          currentVoucherSummary={currentVoucherAsOnOppositeRows.length > 0 ? { voucherNumber: currentVoucherAsOnOppositeRows[0].voucherNumber, date: currentVoucherAsOnOppositeRows[0].date, from: currentVoucherAsOnOppositeRows[0].from, amount: currentVoucherAsOnOppositeRows[0].amount, linkedTotal: currentVoucherAsOnOppositeRows[0].linked } : undefined}
          onConfirm={(selectedIds: string[], amountsByVoucherId: Record<string, number>) => {
            setPendingLinkedPaymentOut({ ids: selectedIds, amountsByVoucherId });
            setIsLinkPaymentOutDialogOpen(false);
          }}
        />
      )}
      <LinkSectionInfoDialog open={linkSectionInfoOpen} onOpenChange={setLinkSectionInfoOpen} />
      <VoucherDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="receipt"
        entityName={voucher?.voucherNumber || "this receipt"}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
        busy={isLoading}
      />
    </>
  );
}
