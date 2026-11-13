"use client";

import { useReconciledPointGuard } from "@/components/vouchers/ReconciledPointGuardContext";
import { addDoc, updateDoc, deleteDoc } from "@/lib/writeGateway/pbWrites";
import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Resolver, useForm } from "react-hook-form";
import { z } from "zod";
import { isNonClearingVoucherBankAccount } from "@/lib/voucherBankCashAccounts";
import {
  specialAccountAllowsPaymentIn,
  specialAccountAllowsPaymentOut,
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
import { CalendarIcon, Loader2, Trash2, PlusCircle, Upload, FileText, Crown, History, CheckCircle, Printer, Link2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nestedVoucherAlertShell } from "@/lib/dialogShellChrome";
import { withMasterAccountFreezeComboboxOption } from "@/lib/masterAccountFreeze/comboboxOptions";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Account } from "@/components/bank-cash/types";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateExpenseAccountDialog } from "@/components/expenses/CreateExpenseAccountDialog";
import { useDate } from "@/hooks/useDate";
import usePermissions from "@/hooks/usePermissions";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { loadVoucherDataForDeletePreCheck, resolveVoucherDeleteBackdateDate } from "@/lib/voucherDeletePreCheck";
import { preferLocalLedgerReads } from "@/lib/apkOnlineFirestoreWritePolicy";
import { findVoucherInLocalMirrorByNumberAndType } from "@/lib/localCompanyDocMirror";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import { applyVoucherAttachmentsAfterFormSave, finalizeVoucherAttachmentsAfterFormSave, uploadVoucherAttachmentFileToFirebase, voucherAttachmentFieldsForSave, voucherAttachmentLockSaveOpts} from "@/lib/voucherFormAttachmentSave";
import { toast as sonnerToast } from "sonner";
import {
  replaceVoucherSaveLoadingWithShortSuccess,
  beginVoucherSaveLoadingOrBlock,
  voucherSaveErrorToast,
  runWithVoucherLinkSaveProgress,
} from "@/lib/voucherSaveUi";
import BsDatePicker from "../ui/BsDatePicker";
import { Combobox } from "@/components/ui/combobox";
import {
  dispatchOtherChargeAddNewPrefill,
  OTHER_CHARGE_ADD_NEW_LABELS,
  resolveOtherChargeAddNewType,
} from "@/lib/otherChargeComboboxAddNew";
import { FilePreview } from "../vouchers/FilePreview";
import { appendCompressedVoucherAttachmentsToState as __frozenAppendAttachments, handleVoucherAttachmentInputChange as __frozenAttachmentInputChange, useVoucherAttachmentProcessing } from "@/lib/appendCompressedVoucherAttachments";
import { ocrWrapAppend, ocrWrapInputChange } from "@/modules/ocr";
/** OCR reads the ORIGINAL upload: frozen helpers wrapped at the call site only (helper code unchanged). */
const appendCompressedVoucherAttachmentsToState = ocrWrapAppend(__frozenAppendAttachments);
const handleVoucherAttachmentInputChange = ocrWrapInputChange(__frozenAttachmentInputChange);
import { voucherAttachmentUrlsForFormState } from "@/lib/voucherAttachmentNormalize";
import { findDuplicateVoucher, hashAttachmentFiles, type CandidateVoucher, type DuplicateMatch } from "@/lib/voucherDuplicateGuard";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { attachmentMaxBytes, attachmentStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
import { useVouchers } from "@/hooks/useVouchers";
import {
  saveVoucher,
  isVoucherLimitError,
  patchVoucherFields,
  softDeleteVoucherMoveToRecycleBin,
  updateVoucherSpendWiseLinks,
} from "@/lib/voucherActionsClient";
import {
  getVoucherConvertOriginalId,
  getVoucherEditConvertPresentation,
  isVoucherEditConverting,
  markVoucherConvertedInRecycleBin,
} from "@/lib/voucherEditConvert";
import { VoucherEditConvertConfirmDialog } from "@/components/vouchers/VoucherEditConvertConfirmDialog";
import { useVoucherEditConvertSubmitGate } from "@/hooks/useVoucherEditConvertSubmitGate";
import {
  formatVoucherNumber,
  normalizePrefix,
  parseFySegmentFromVoucherNumber,
  parseVoucherNumberPart,
  parseVoucherSerial,
} from "@/lib/voucherNumberFormat";
import {
  formatContraVoucherNumbersFromSerial,
  getNextVoucherNumberForCompany,
} from "@/lib/nextVoucherNumber";
import { syncAutoVoucherNumberToDate } from "@/lib/syncAutoVoucherNumberToDate";
import { sendTransactionAlert, isAmountOverOneLakh, getChangedFieldLabels } from "@/lib/transactionAlerts";
/** Copy chip → From vs To source account alag — sirf types (runtime circular avoid). */
import type { CopyMissingMasterOpts, CopyMasterDraftRequestPayload } from "@/components/vouchers/AddVoucherDialog";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { VoucherPdfAsImageToggle } from "@/components/vouchers/VoucherPdfAsImageToggle";
import { shouldSuggestPdfAsImage } from "@/lib/voucherAttachmentPdfAsImage";
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { bankAccountAllowsVoucherMinusBalance } from "@/lib/bankAccountMinusBalancePolicy";
import { checkLedgerAmountGate } from "@/lib/ledgerAmountGuard";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResetLinkStateOnCopyTargetCompany } from "@/hooks/useResetLinkStateOnCopyTargetCompany";
import { useCopyDraftFirstSave } from "@/hooks/useCopyDraftFirstSave";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_PC_DATE_ROW, VOUCHER_PC_DATE_BOTH_SLOT, VOUCHER_PC_DATE_BS_PILL, VOUCHER_PC_DATE_AD_PILL } from "@/components/vouchers/voucherButtonStyles";
import { hasPaymentLinks } from "@/lib/payment-allocation-utils";
import { LinkPaymentInToPaymentOutDialog } from "@/components/vouchers/LinkPaymentInToPaymentOutDialog";
import { LinkPaymentOutToPaymentInDialog } from "@/components/vouchers/LinkPaymentOutToPaymentInDialog";
import { LinkSectionInfoDialog } from "@/components/vouchers/LinkSectionInfoDialog";
import { allocatePaymentInAmounts, getSpendWiseInflowPartyLabel, getSpendWiseOutflowPartyLabel } from "@/lib/paymentInAllocation";
import { getOpeningBalanceBaseAmount, SPEND_WISE_OPENING_BALANCE_ID } from "@/lib/spendWiseOpeningBalance";

const fileSchema = z.object({
  file: z.custom<File | null>().optional(),
});

const formSchema = z.object({
  fromAccountId: z.string().min(1, "Please select the source account."),
  toAccountId: z.string().min(1, "Please select the destination account."),
  date: z.date({ message: "A date is required." }),
  voucherNumber: z.string().optional(),
  /** From-account leg: e.g. CNTR Out - 001. Treated as voucher number; required. */
  voucherNumberOut: z.string().min(1, "Voucher No. (Out) is required."),
  /** To-account leg: e.g. CNTR In - 001. Treated as voucher number; required. */
  voucherNumberIn: z.string().min(1, "Voucher No. (In) is required."),
  amount: z.coerce.number().min(0.01, "Amount must be positive."),
  payeeAmount: z.coerce.number().optional(),
  otherChargeAccountId: z.string().optional(),
  otherChargeAmount: z.coerce.number().optional(),
  narration: z.string().optional(),
  files: z.array(fileSchema).optional(),
}).superRefine((data, ctx) => {
  const chargeAmount = Number(data.otherChargeAmount || 0);
  if (chargeAmount > 0 && !data.otherChargeAccountId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select other charge account.", path: ["otherChargeAccountId"] });
  }
});

type ContraFormValues = z.infer<typeof formSchema>;

const getContraTotalAmount = (voucher: any) => Number(voucher?.total ?? voucher?.amount ?? 0) || 0;

const getContraPayeeAmount = (voucher: any) => {
  const explicit = Number(voucher?.payeeAmount);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.max(0, getContraTotalAmount(voucher) - (Number(voucher?.otherChargeAmount) || 0));
};

/** Combobox me selected id list me na ho to bhi label dikhao (edit / sparse snapshot). */
function withSelectedComboboxOption(
  options: { value: string; label: string }[],
  selectedId: string | undefined,
  fallbackLabel?: string
): { value: string; label: string }[] {
  const id = String(selectedId || "").trim();
  if (!id || options.some((o) => o.value === id)) return options;
  const label = (fallbackLabel || "").trim() || "—";
  return [{ value: id, label }, ...options];
}

const getInitialContraFormValues = (voucher?: any): ContraFormValues => {
  if (voucher) {
    const rawDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date as string | number | Date);
    const safeDate = Number.isFinite(rawDate.getTime()) ? rawDate : startOfDay(new Date());
    const totalAmount =
      typeof (voucher.total || voucher.amount) === "string"
        ? parseFloat(String(voucher.total || voucher.amount).replace(/,/g, "")) || 0
        : getContraTotalAmount(voucher);
    return {
      fromAccountId: voucher.fromAccountId || "",
      toAccountId: voucher.toAccountId || "",
      date: safeDate,
      voucherNumber: voucher.voucherNumber || "",
      voucherNumberOut: voucher.voucherNumberOut ?? "",
      voucherNumberIn: voucher.voucherNumberIn ?? "",
      amount: totalAmount,
      payeeAmount: getContraPayeeAmount(voucher),
      otherChargeAccountId: voucher.otherChargeAccountId || "",
      otherChargeAmount: Number(voucher.otherChargeAmount || 0),
      narration: voucher.narration || "",
      files: [],
    };
  }
  return {
    fromAccountId: "",
    toAccountId: "",
    date: startOfDay(new Date()),
    voucherNumber: "",
    voucherNumberOut: "",
    voucherNumberIn: "",
    amount: 0,
    payeeAmount: 0,
    otherChargeAccountId: "",
    otherChargeAmount: 0,
    narration: "",
    files: [],
  };
};

const getVoucherPrefix = (prefixes?: Record<string, string[]>) => (prefixes?.contra && prefixes.contra[0]) || "CNTR-";
/** Base prefix for Contra Out/In (e.g. "CNTR-" → "CNTR"). Used to build "CNTR Out - 001" and "CNTR In - 001". */
const getContraBasePrefix = (prefixes?: Record<string, string[]>) => normalizePrefix(getVoucherPrefix(prefixes)) || "CNTR";


export function CreateContraForm({
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
  copySaveTargetCompanyId?: string;
  copyMismatchCategories?: string[];
  /** Copy chip: `contraAccountField` se source voucher ka From ya To wala bank id prefer ho. */
  onCopyMissingCategory?: (category: string, opts?: CopyMissingMasterOpts) => void;
  isCopyingMissingMasters?: boolean;
  copyMasterDraftRequest?: CopyMasterDraftRequestPayload | null;
  recurringVoucherSaveBlocked?: boolean;
  recurringVoucherAuxiliaryDirty?: boolean;
}) {
  const { toast } = useToast();
  const { user, customUser } = useAuth();
  const { formatCurrency, formatCurrencyForPrint, formatDate, formatDateBySystem, dateSystem } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedAccounts: allProcessedAccounts, processedParties, processedStaff, processedTaxes, processedExpenseAccounts } = useVouchers();
  const { company, companyId } = useCompany();
  const { can, role, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const reconGuard = useReconciledPointGuard();
  /** Sirf saved + dialog-linked par file band; nayi txn par parent flag ignore. */
  const fileAttachLockedByDialog = !!voucher?.id && deleteDisabledWhenLinked;
  const isMobile = useIsMobile();

  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [isCreateExpenseAccountOpen, setIsCreateExpenseAccountOpen] = useState(false);
  const creatingOtherChargeAccountRef = useRef(false);
  const [targetFieldForNewAccount, setTargetFieldForNewAccount] = useState<'fromAccountId' | 'toAccountId' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachFileInputId = useId();
  const [files, setFiles] = useState<(File|string)[]>([]);
  /** Contra attach: stable URL array for FilePreview deps (no per-render `.filter` identity churn). */
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
  const processAndSaveRef = useRef<((data: ContraFormValues, saveAndNew: boolean, onSuccess?: () => void, approveAfterSave?: boolean) => Promise<void>) | null>(null);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  /** Naya contra: voucher no sirf ek baar auto-fetch — `company` ref / parent re-render par dubara mat chalao. */
  const autoVoucherNumberFetchKeyRef = useRef<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [linkedPaymentInIds, setLinkedPaymentInIds] = useState<string[]>([]);
  const [isLinkPaymentInDialogOpen, setIsLinkPaymentInDialogOpen] = useState(false);
  /** Keep only one Pay In dialog state so Contra Out linking is always handled from the top-left card. */
  const [isLinkPaymentOutDialogOpen, setIsLinkPaymentOutDialogOpen] = useState(false);
  // Add/non-linked edit should show only "Show Link" button until user opens the section.
  const [showLinkSections, setShowLinkSections] = useState(false);
  /** Pending Link Pay Out selection (applied to server only on Save, not on Done). */
  const [pendingLinkedPaymentOut, setPendingLinkedPaymentOut] = useState<{ ids: string[]; amountsByVoucherId: Record<string, number> } | null>(null);
  const [linkSectionInfoOpen, setLinkSectionInfoOpen] = useState(false);
  // Block overspending from selected from-account for all roles (including owner).
  const [isAmountMoreThanAccountOpen, setIsAmountMoreThanAccountOpen] = useState(false);
  /** Duplicate guard: same slip dobara save hone se pehle bubble. */
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ match: DuplicateMatch; proceed: () => Promise<void> } | null>(null);
  const skipDuplicatePromptRef = useRef(false);
  const [otherChargeEnabled, setOtherChargeEnabled] = useState(
    Boolean(voucher?.otherChargeAccountId || Number(voucher?.otherChargeAmount || 0) > 0)
  );
  // Track last valid amount so invalid keystroke can be reverted immediately.
  const lastValidAmountRef = useRef<number>(getContraTotalAmount(voucher));
  const initialLinkedPaymentInIdsRef = useRef<string[]>([]);
  const resetLinksOnCopyTargetChange = useCallback(() => {
    setLinkedPaymentInIds([]);
    initialLinkedPaymentInIdsRef.current = [];
    setPendingLinkedPaymentOut(null);
    setShowLinkSections(false);
    setIsLinkPaymentInDialogOpen(false);
    setIsLinkPaymentOutDialogOpen(false);
  }, []);
  useResetLinkStateOnCopyTargetCompany(copySaveTargetCompanyId, resetLinksOnCopyTargetChange);
  const {
    resolveVoucherIdForSave,
    isPermissionEdit,
    markCopiedDraftPersisted,
    isCopiedDraftFirstInsert,
  } = useCopyDraftFirstSave(copySaveTargetCompanyId);
  /** Skip reset when same voucher updates (liveVoucher) and user has edits — fixes unlink → change fields → save. */
  const lastResetVoucherIdRef = useRef<string | null>(null);

  const transactionDates = useMemo(() => {
    if (!allVouchers?.length) return [];
    return allVouchers.map((v) => {
      const d = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      return d && !isNaN(d.getTime()) ? startOfDay(d) : null;
    }).filter(Boolean) as Date[];
  }, [allVouchers]);

  const isEditing = !!voucher;
  // Preserve original saved type from dialog shaping so Journal -> Contra edit switch refreshes voucher no.
  const isEditingAndConverting = isVoucherEditConverting(voucher, "contra");
  const convertPresentation = useMemo(
    () => getVoucherEditConvertPresentation(voucher as Record<string, unknown> | undefined, "contra"),
    [voucher]
  );
  const {
    convertConfirmOpen,
    setConvertConfirmOpen,
    gateConvertSubmit,
    confirmConvertSubmit,
  } = useVoucherEditConvertSubmitGate(Boolean(isEditingAndConverting));
  
  const form = useForm<ContraFormValues>({
    resolver: zodResolver(formSchema) as Resolver<ContraFormValues>,
    defaultValues: voucher
      ? getInitialContraFormValues(voucher)
      : getInitialContraFormValues(),
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.contra(),
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((company as { name?: string } | null)?.name) || null,
    companyId: companyId,
    ownPan: ((company as { pan?: string; panNumber?: string } | null)?.pan ?? (company as { panNumber?: string } | null)?.panNumber) || null,
    parties: (processedParties || []) as never,
    items: [],
    taxes: (processedTaxes || []) as never,
    autoPost: () => void handleFormSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing: !!(voucher as { id?: string } | null | undefined)?.id,
    disabled: !!editingDisabled,
  });
  
const { isDirty: _isFormFieldsDirty } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f: any) => typeof f === 'string') as string[];
    const newFiles    = files.filter((f: any) => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u: any, i: number) => u !== init[i]);
  })();
  const _isLinkDirty =
    linkedPaymentInIds.length !== initialLinkedPaymentInIdsRef.current.length ||
    linkedPaymentInIds.some((id, i) => id !== initialLinkedPaymentInIdsRef.current[i]);
  /** Link Pay Out (spend wise To side) changed in dialog but not saved — show Save & Approve. */
  const _isSpendWiseLinkOutDirty = !!pendingLinkedPaymentOut;
  const isFormDirty =
    _isFormFieldsDirty || _isFileDirty || _isLinkDirty || _isSpendWiseLinkOutDirty || recurringVoucherAuxiliaryDirty;
  const fromAccountId = form.watch("fromAccountId");
  const toAccountId = form.watch("toAccountId");
  const payeeAmountValue = Number(form.watch("payeeAmount")) || 0;
  const otherChargeAccountId = form.watch("otherChargeAccountId");
  const otherChargeAmountValue = Number(form.watch("otherChargeAmount")) || 0;
  const contraTotalAmount = payeeAmountValue + otherChargeAmountValue;
  const amount = contraTotalAmount;
  const showOtherChargeCard = otherChargeEnabled || Boolean(otherChargeAccountId) || otherChargeAmountValue > 0;
  // Keep edit context aligned with the clicked contra row; add-new defaults to Out leg.
  const selectedContraLeg: 'in' | 'out' = (voucher?._contraLeg === 'in' ? 'in' : 'out');

  useEffect(() => {
    const ids = Array.isArray(voucher?.linkedPaymentInIds) ? [...voucher.linkedPaymentInIds] : [];
    setLinkedPaymentInIds(ids);
    initialLinkedPaymentInIdsRef.current = ids;
  }, [voucher?.id, voucher?.linkedPaymentInIds]);

  const spendWiseOppositeEditable =
    (company as { spendWiseOppositeVoucherEditable?: boolean } | null)?.spendWiseOppositeVoucherEditable === true;
  const spendWiseEnabled = (company as { spendWiseEnabled?: boolean } | null)?.spendWiseEnabled === true;
  const requirePaymentLink =
    spendWiseOppositeEditable &&
    (() => {
      const byRole = (company as { requirePaymentLinkByRole?: Record<string, boolean | { payment_out?: boolean; contra?: boolean; direct_expense?: boolean }> } | null)?.requirePaymentLinkByRole?.[role];
      if (byRole === undefined) return false;
      if (typeof byRole === "boolean") return byRole;
      return byRole.contra === true;
    })();
  // Opposite master OFF ⇒ spend-wise zaroorat band (`spendWiseEnabled` samaet); master ON ho tab PO jaisi gate.
  const spendWiseLinkRequired = spendWiseOppositeEditable && (spendWiseEnabled || requirePaymentLink);
  // Rule: Out leg links same-account inflows; In leg links same-account outflows.
  const spendWiseInAccountId = selectedContraLeg === 'in' ? toAccountId : fromAccountId;
  const spendWiseOutAccountId = selectedContraLeg === 'in' ? toAccountId : fromAccountId;
  const spendWiseInAccountOpeningBalance = Number(allProcessedAccounts?.find((a: any) => a.id === spendWiseInAccountId)?.openingBalance ?? 0) || 0;
  const spendWiseOutAccountOpeningBalance = Number(allProcessedAccounts?.find((a: any) => a.id === spendWiseOutAccountId)?.openingBalance ?? 0) || 0;
  const linkedAmountByPaymentInId = useMemo(() => {
    const map = new Map<string, number>();
    // Compute already-linked amounts using the same opposite account used by Link Pay In.
    if (!allVouchers?.length || !spendWiseInAccountId) return map;
    const currentId = isCopiedDraftFirstInsert ? null : (voucher?.id ?? savedVoucherId);
    allVouchers
      .filter(
        (v: any) => {
          const isOut =
            (v.type === "payment_out" && v.accountId === spendWiseInAccountId) ||
            (v.type === "direct_expense" && v.accountId === spendWiseInAccountId) ||
            (v.type === "contra" && v.fromAccountId === spendWiseInAccountId);
          return (
            isOut &&
            Array.isArray(v.linkedPaymentInIds) &&
            v.linkedPaymentInIds.length > 0 &&
            v.id !== currentId &&
            !v.isDeleted
          );
        }
      )
      .forEach((po: any) => {
        const poAmt = Number(po.total ?? po.amount ?? 0) || 0;
        const ids = po.linkedPaymentInIds as string[];
        const amounts = po.linkedPaymentInAmounts && typeof po.linkedPaymentInAmounts === "object" ? po.linkedPaymentInAmounts : null;
        ids.forEach((piId: string) => {
          const add = amounts?.[piId] != null ? Number(amounts[piId]) : poAmt / ids.length;
          map.set(piId, (map.get(piId) ?? 0) + add);
        });
      });
    return map;
  }, [allVouchers, spendWiseInAccountId, voucher?.id, savedVoucherId, isCopiedDraftFirstInsert]);
  const linkedPaymentInTotal = useMemo(() => {
    if (!allVouchers?.length || !linkedPaymentInIds?.length || !spendWiseInAccountId) return 0;
    return linkedPaymentInIds.reduce((sum, id) => {
      if (id === SPEND_WISE_OPENING_BALANCE_ID) {
        // Opening balance behaves like spend-wise source row on Dr side for Contra Out linking.
        const base = getOpeningBalanceBaseAmount(spendWiseInAccountOpeningBalance, "dr");
        const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
        return sum + Math.max(0, base - alreadyLinked);
      }
      // Keep amount-matching check aligned with dialog filter (including legacy account fields).
      const v = allVouchers.find((x: any) =>
        x.id === id &&
        (
          ((x.type === "payment_in" || x.type === "direct_income") && ((x.accountId ?? x.toAccountId ?? x.bankAccountId) === spendWiseInAccountId)) ||
          (x.type === "contra" && (x.toAccountId ?? x.accountId) === spendWiseInAccountId)
        )
      );
      const amt = Number(v?.total ?? v?.amount ?? 0) || 0;
      const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
      return sum + Math.max(0, amt - alreadyLinked);
    }, 0);
  }, [allVouchers, linkedPaymentInIds, spendWiseInAccountId, linkedAmountByPaymentInId, spendWiseInAccountOpeningBalance]);
  const amountMatched = amount > 0 && linkedPaymentInTotal >= amount;
  const showLinkPayMode = !!fromAccountId && amount > 0;

  const paymentInDialogNames = useMemo(() => {
    const m: Record<string, string> = {};
    processedParties?.forEach((p: any) => { m[p.id] = p.name ?? ""; });
    processedStaff?.forEach((s: any) => { m[s.id] = s.name ?? ""; });
    processedTaxes?.forEach((t: any) => { m[t.id] = t.name ?? (t as any).label ?? ""; });
    allProcessedAccounts?.forEach((a: any) => { m[a.id] = a.accountName ?? ""; });
    processedExpenseAccounts?.forEach((e: any) => { m[e.id] = e.name ?? ""; });
    return m;
  }, [processedParties, processedStaff, processedTaxes, allProcessedAccounts, processedExpenseAccounts]);

  const otherChargeAccountOptions = useMemo(() => {
    const rows = [
      ...processedParties.map((p) => ({ value: p.id, label: `Party: ${p.name}` })),
      ...processedExpenseAccounts.map((e) => ({ value: e.id, label: `Expense: ${e.name}` })),
      ...processedStaff.map((s) => ({ value: s.id, label: `Staff: ${s.name}` })),
    ];
    const selectedLabel =
      processedParties.find((p) => p.id === otherChargeAccountId)?.name ??
      processedExpenseAccounts.find((e) => e.id === otherChargeAccountId)?.name ??
      processedStaff.find((s) => s.id === otherChargeAccountId)?.name;
    return withSelectedComboboxOption(rows, otherChargeAccountId, selectedLabel);
  }, [processedParties, processedExpenseAccounts, processedStaff, otherChargeAccountId]);
  const otherChargeBalance = useMemo(() => {
    if (!otherChargeAccountId) return null;
    const party = processedParties.find((p) => p.id === otherChargeAccountId);
    if (party) return Number((party as any).balance ?? 0);
    const expense = processedExpenseAccounts.find((e) => e.id === otherChargeAccountId);
    if (expense) return Number((expense as any).balance ?? 0);
    const staffMember = processedStaff.find((s) => s.id === otherChargeAccountId);
    if (staffMember) return Number((staffMember as any).balance ?? 0);
    return null;
  }, [otherChargeAccountId, processedParties, processedExpenseAccounts, processedStaff]);
  const otherChargeDefaultStorageKey = useMemo(
    () => `pocket-ledger:contra:other-charge-default:${companyId || "global"}`,
    [companyId]
  );
  /** Default/Clear control + stored default auto-fill are for NEW vouchers only. */
  const isEditingVoucherForDefaults = Boolean(voucher?.id) && !isCopiedDraftFirstInsert;
  const [storedOtherChargeDefaultId, setStoredOtherChargeDefaultId] = useState(() => {
    try {
      return String(localStorage.getItem(otherChargeDefaultStorageKey) || "").trim();
    } catch {
      return "";
    }
  });
  const setOtherChargeDefault = useCallback(() => {
    if (storedOtherChargeDefaultId) {
      try {
        localStorage.removeItem(otherChargeDefaultStorageKey);
      } catch {}
      setStoredOtherChargeDefaultId("");
      sonnerToast.success("Default other charge account cleared.");
      return;
    }
    const id = String(form.getValues("otherChargeAccountId") || "").trim();
    if (!id) return;
    try {
      localStorage.setItem(otherChargeDefaultStorageKey, id);
      setStoredOtherChargeDefaultId(id);
      sonnerToast.success("Default other charge account saved.");
    } catch {
      sonnerToast.error("Default save failed.");
    }
  }, [form, otherChargeDefaultStorageKey, storedOtherChargeDefaultId]);

  useEffect(() => {
    const nextAmount = Math.max(0, Math.round(contraTotalAmount * 100) / 100);
    const currentAmount = Number(form.getValues("amount")) || 0;
    if (currentAmount !== nextAmount) {
      form.setValue("amount", nextAmount, { shouldDirty: false, shouldValidate: false });
    }
  }, [contraTotalAmount, form]);
  useEffect(() => {
    if (isEditingVoucherForDefaults || !showOtherChargeCard || otherChargeAccountId) return;
    try {
      const saved = String(localStorage.getItem(otherChargeDefaultStorageKey) || "").trim();
      if (saved && otherChargeAccountOptions.some((option) => option.value === saved)) {
        form.setValue("otherChargeAccountId", saved);
      }
    } catch {}
  }, [isEditingVoucherForDefaults, showOtherChargeCard, otherChargeAccountId, otherChargeDefaultStorageKey, otherChargeAccountOptions, form]);

  const handleOtherChargeAccountChange = useCallback(
    (fieldOnChange: (val: string) => void, val: string, newName?: string) => {
      const createType = resolveOtherChargeAddNewType(val);
      if (createType) {
        creatingOtherChargeAccountRef.current = true;
        if (createType === "party") setIsCreatePartyOpen(true);
        if (createType === "staff") setIsCreateStaffOpen(true);
        if (createType === "expense") setIsCreateExpenseAccountOpen(true);
        dispatchOtherChargeAddNewPrefill(createType, newName);
        return;
      }
      fieldOnChange(val);
    },
    []
  );

  const showSpendWiseSection = showLinkPayMode;
  const isInVoucherForAccountContra = (x: any, accId: string) =>
    // Legacy safety: some old in-vouchers keep bank account in toAccountId/bankAccountId.
    ((x.type === "payment_in" || x.type === "direct_income") && ((x.accountId ?? x.toAccountId ?? x.bankAccountId) === accId)) ||
    // Contra in side uses destination account.
    (x.type === "contra" && (x.toAccountId ?? x.accountId) === accId);
  const spendWiseDisplayRows = useMemo(() => {
    if (!showSpendWiseSection || !allVouchers?.length || !linkedPaymentInIds?.length || !spendWiseInAccountId) return [];
    const uniqueIds = [...new Set(linkedPaymentInIds)];
    // Allocate using opposite-account inflows to keep Link Pay In behavior consistent.
    const allocated = allocatePaymentInAmounts(amount, linkedPaymentInIds, allVouchers, spendWiseInAccountId, linkedAmountByPaymentInId, spendWiseInAccountOpeningBalance);
    return uniqueIds.map((id) => {
      if (id === SPEND_WISE_OPENING_BALANCE_ID) {
        const amt = getOpeningBalanceBaseAmount(spendWiseInAccountOpeningBalance, "dr");
        const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
        return {
          id,
          voucherNumber: "Opening Balance (Dr)",
          date: null as Date | null,
          amount: amt,
          linked: allocated[id] ?? 0,
          linkedOnOthers: alreadyLinked,
          linkable: Math.max(0, amt - alreadyLinked),
          from: "Opening Balance",
          to: "Opening Balance",
        };
      }
      const v = allVouchers.find((x: any) => x.id === id && isInVoucherForAccountContra(x, spendWiseInAccountId));
      if (!v) return null;
      const date = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      const amt = Number(v.total ?? v.amount ?? 0) || 0;
      const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
      const linkable = Math.max(0, amt - alreadyLinked);
      const linkedFromThis = allocated[id] ?? 0;
      const from = getSpendWiseInflowPartyLabel(v, paymentInDialogNames);
      return {
        id,
        voucherNumber: v.voucherNumber ?? "—",
        date,
        amount: amt,
        linked: linkedFromThis,
        linkedOnOthers: alreadyLinked,
        linkable,
        from,
      };
    }).filter(Boolean) as { id: string; voucherNumber: string; date: Date | null; amount: number; linked: number; linkedOnOthers: number; linkable: number; from: string }[];
  }, [showSpendWiseSection, allVouchers, linkedPaymentInIds, spendWiseInAccountId, amount, linkedAmountByPaymentInId, paymentInDialogNames, spendWiseInAccountOpeningBalance]);
  const hasSpendWiseLinks = spendWiseDisplayRows.length > 0 || linkedPaymentInIds.length > 0;
  const shouldShowSpendWiseSection = showSpendWiseSection && (showLinkSections || (isEditing && hasSpendWiseLinks));

  useEffect(() => {
    if (isEditing && hasSpendWiseLinks) setShowLinkSections(true);
  }, [isEditing, hasSpendWiseLinks]);

  /** Spend wise: count of Payment In / Direct Income / Contra for fromAccountId with linkable amount. Message uses "bcz" spelling. */
  const spendWiseLinkableCount = useMemo(() => {
    if (!spendWiseInAccountId || !allVouchers?.length) return 0;
    const voucherCount = allVouchers.filter((v: any) => {
      if (!isInVoucherForAccountContra(v, spendWiseInAccountId)) return false;
      const amt = Number(v.total ?? v.amount ?? 0) || 0;
      const alreadyLinked = linkedAmountByPaymentInId.get(v.id) ?? 0;
      return amt - alreadyLinked > 0;
    }).length;
    const obBase = getOpeningBalanceBaseAmount(spendWiseInAccountOpeningBalance, "dr");
    const obAlreadyLinked = linkedAmountByPaymentInId.get(SPEND_WISE_OPENING_BALANCE_ID) ?? 0;
    const obCount = obBase - obAlreadyLinked > 0 ? 1 : 0;
    return voucherCount + obCount;
  }, [spendWiseInAccountId, allVouchers, linkedAmountByPaymentInId, spendWiseInAccountOpeningBalance]);

  /** Top-left card (From Voucher): live Total linked and Balance so they update as soon as user links in dialog (add new or edit). */
  const spendWiseFromCardTotalLinked = useMemo(() => spendWiseDisplayRows.reduce((s, r) => s + r.linked, 0), [spendWiseDisplayRows]);
  const spendWiseFromCardBalance = useMemo(() => Math.max(0, amount - spendWiseFromCardTotalLinked), [amount, spendWiseFromCardTotalLinked]);
  const spendWiseFromCardSettled = amount > 0 && spendWiseFromCardTotalLinked >= amount;

  const currentContraVoucherId = voucher?.id ?? savedVoucherId;
  /** Show lower row (Contra voucher in To Other out) in both add new and edit — so user sees spend wise link cards. */
  const showSpendWiseOppositeSection = !!spendWiseOutAccountId;
  const openingBalanceLinkedByOthers = useMemo(() => {
    if (!spendWiseOutAccountId) return 0;
    return (allVouchers ?? [])
      .filter((v: any) => {
        const isInVoucherForAccount =
          ((v.type === "payment_in" || v.type === "direct_income") && (v.accountId ?? v.toAccountId ?? v.bankAccountId) === spendWiseOutAccountId) ||
          (v.type === "contra" && (v.toAccountId ?? v.accountId) === spendWiseOutAccountId);
        return isInVoucherForAccount && v.id !== currentContraVoucherId && !v.isDeleted;
      })
      .reduce((sum: number, v: any) => {
        if ((v.linkedOpeningBalanceAccountId ?? "") !== spendWiseOutAccountId) return sum;
        return sum + (Number(v.linkedOpeningBalanceAmount) || 0);
      }, 0);
  }, [allVouchers, spendWiseOutAccountId, currentContraVoucherId]);
  const spendWiseLinkedToMeRows = useMemo(() => {
    if (!showSpendWiseOppositeSection || !allVouchers?.length || !currentContraVoucherId || !spendWiseOutAccountId) return [];
    const accId = spendWiseOutAccountId;
    const outflows = allVouchers.filter(
      (v: any) =>
        !v.isDeleted &&
        Array.isArray(v.linkedPaymentInIds) &&
        v.linkedPaymentInIds.includes(currentContraVoucherId) &&
        ((v.type === "payment_out" && v.accountId === accId) ||
          (v.type === "direct_expense" && v.accountId === accId) ||
          (v.type === "contra" && v.fromAccountId === accId))
    );
    const rows = outflows.map((v: any) => {
      const date = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      const amt = Number(v.total ?? v.amount ?? 0) || 0;
      const amounts = v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object" ? v.linkedPaymentInAmounts : {};
      const linked = amounts[currentContraVoucherId] != null ? Number(amounts[currentContraVoucherId]) : amt / (v.linkedPaymentInIds?.length || 1);
      const typeLabel = v.type === "payment_out" ? "Payment" : v.type === "direct_expense" ? "Direct Expense" : "Contra";
      const to = getSpendWiseOutflowPartyLabel(v, paymentInDialogNames);
      return {
        id: v.id,
        voucherNumber: v.voucherNumber ?? "—",
        date,
        amount: amt,
        linked,
        typeLabel,
        from: to,
        to,
      };
    });
    const openingBase = getOpeningBalanceBaseAmount(spendWiseOutAccountOpeningBalance, "cr");
    const currentLinkedOB = Number((voucher as any)?.linkedOpeningBalanceAccountId === spendWiseOutAccountId ? (voucher as any)?.linkedOpeningBalanceAmount : 0) || 0;
    if (openingBase > 0 && currentLinkedOB > 0) {
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
  }, [showSpendWiseOppositeSection, allVouchers, currentContraVoucherId, spendWiseOutAccountId, paymentInDialogNames, spendWiseOutAccountOpeningBalance, voucher]);

  /** Card display: when Done is clicked (pending set), show pending links live; otherwise server data. */
  const displayLinkedToMeRows = useMemo(() => {
    if (!pendingLinkedPaymentOut || !spendWiseOutAccountId || !allVouchers?.length) return spendWiseLinkedToMeRows;
    const accId = spendWiseOutAccountId;
    const rows = pendingLinkedPaymentOut.ids
      .map((id) => {
        if (id === SPEND_WISE_OPENING_BALANCE_ID) {
          const openingBase = getOpeningBalanceBaseAmount(spendWiseOutAccountOpeningBalance, "cr");
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
        const to = getSpendWiseOutflowPartyLabel(v, paymentInDialogNames);
        return { id: v.id, voucherNumber: v.voucherNumber ?? "—", date, amount: amt, linked, typeLabel: v.type === "payment_out" ? "Payment" : v.type === "direct_expense" ? "Direct Expense" : "Contra", from: to, to };
      })
      .filter(Boolean);
    const typed = rows as { id: string; voucherNumber: string; date: Date | null; amount: number; linked: number; typeLabel: string; from: string }[];
    return typed.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }, [pendingLinkedPaymentOut, spendWiseLinkedToMeRows, allVouchers, spendWiseOutAccountId, paymentInDialogNames, spendWiseOutAccountOpeningBalance]);

  /** Count must match Link Pay Out dialog's To Voucher rows (linkable + already selected rows). */
  const spendWiseOutDialogRowCount = useMemo(() => {
    if (!spendWiseOutAccountId || !allVouchers?.length) return 0;
    const selectedIds = pendingLinkedPaymentOut ? pendingLinkedPaymentOut.ids : spendWiseLinkedToMeRows.map((r) => r.id);
    const selectedSet = new Set(selectedIds);
    const currentLinkedAmounts = pendingLinkedPaymentOut
      ? pendingLinkedPaymentOut.amountsByVoucherId
      : Object.fromEntries(spendWiseLinkedToMeRows.map((r) => [r.id, r.linked]));
    return allVouchers
      .filter(
        (v: any) =>
          !v.isDeleted &&
          ((v.type === "payment_out" && v.accountId === spendWiseOutAccountId) ||
            (v.type === "direct_expense" && v.accountId === spendWiseOutAccountId) ||
            (v.type === "contra" && v.fromAccountId === spendWiseOutAccountId))
      )
      .map((v: any) => {
        const amount = Number(v.total ?? v.amount ?? 0) || 0;
        const amounts = v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object" ? v.linkedPaymentInAmounts : {};
        const alreadyLinked = Object.values(amounts).reduce<number>((s, val) => s + (Number(val) || 0), 0);
        const currentLinked = Number((currentLinkedAmounts as Record<string, number>)[v.id] ?? 0) || 0;
        const linkable = Math.max(0, amount - alreadyLinked + currentLinked);
        return { id: v.id, linkable };
      })
      .concat((() => {
        const openingBase = getOpeningBalanceBaseAmount(spendWiseOutAccountOpeningBalance, "cr");
        if (openingBase <= 0) return [] as { id: string; linkable: number }[];
        const currentLinkedOB = Number((currentLinkedAmounts as Record<string, number>)[SPEND_WISE_OPENING_BALANCE_ID] ?? 0) || 0;
        const obLinkable = Math.max(0, openingBase - openingBalanceLinkedByOthers + currentLinkedOB);
        return [{ id: SPEND_WISE_OPENING_BALANCE_ID, linkable: obLinkable }];
      })())
      .filter((r) => r.linkable > 0 || selectedSet.has(r.id)).length;
  }, [spendWiseOutAccountId, allVouchers, pendingLinkedPaymentOut, spendWiseLinkedToMeRows, spendWiseOutAccountOpeningBalance, openingBalanceLinkedByOthers]);

  // Card count: Contra In follows Pay Out popup count; Contra Out keeps inflow-link count.
  const spendWiseCardAvailableCount = selectedContraLeg === 'in' ? spendWiseOutDialogRowCount : spendWiseLinkableCount;

  /** Total linked from this contra to Payment (used by Link Pay Out dialog summary). */
  const lowerCardTotalLinked = useMemo(() => displayLinkedToMeRows.reduce((s, r) => s + r.linked, 0), [displayLinkedToMeRows]);
  // Keep left "From Voucher" card synced with active contra leg.
  const fromCardLinkedTotal = selectedContraLeg === 'in' ? lowerCardTotalLinked : spendWiseFromCardTotalLinked;
  const fromCardBalance = Math.max(0, amount - fromCardLinkedTotal);
  const fromCardSettled = amount > 0 && fromCardLinkedTotal >= amount;
  const fromCardLinkedCount = selectedContraLeg === 'in' ? displayLinkedToMeRows.length : spendWiseDisplayRows.length;

  /** Block Save when spend wise (company ya role) ON aur upper card (Payment In link) not settled. */
  const saveDisabledByLink =
    spendWiseLinkRequired &&
    ((!linkedPaymentInIds?.length) || (!!linkedPaymentInIds?.length && !amountMatched));
  const linkPayOthersDisabled = saveDisabledByLink;

  const formDate = form.watch("date");
  const currentContraAccountId = selectedContraLeg === 'in' ? toAccountId : fromAccountId;
  const formVoucherNumber = selectedContraLeg === 'in'
    ? (form.watch("voucherNumberIn") || form.watch("voucherNumber") || voucher?.voucherNumberIn || voucher?.voucherNumber || "—")
    : (form.watch("voucherNumberOut") || form.watch("voucherNumber") || voucher?.voucherNumberOut || voucher?.voucherNumber || "—");
  const currentVoucherAsOnOppositeRows = useMemo(() => {
    if (!showSpendWiseSection || !currentContraAccountId) return [];
    const date = formDate;
    const amt = amount;
    const linked = spendWiseDisplayRows.reduce((s, r) => s + r.linked, 0);
    const from = allProcessedAccounts?.find((a: any) => a.id === currentContraAccountId)?.accountName ?? "—";
    return [
      {
        id: "current",
        voucherNumber: formVoucherNumber,
        date: date ? (date instanceof Date ? date : new Date(date)) : null,
        amount: amt,
        linked,
        linkedOnOthers: 0,
        from,
      },
    ];
  }, [showSpendWiseSection, currentContraAccountId, formDate, formVoucherNumber, voucher?.voucherNumber, amount, spendWiseDisplayRows, allProcessedAccounts]);
  // Compute after opposite-row memo so we never read it before initialization.
  const rightCardLinkedTotal = selectedContraLeg === 'in' ? lowerCardTotalLinked : (currentVoucherAsOnOppositeRows[0]?.linked ?? 0);

  // `account` row = copy-mismatch red label / Copy chip ke liye same source-of-truth jo balance hook use karta hai (id trim + type-safe).
  const { account: fromAccountRow, displayBalance: fromAccountBalance } = useAccountBalance(fromAccountId);
  const { account: toAccountRow, displayBalance: toAccountBalance } = useAccountBalance(toAccountId);
  const allowFromAccountMinusBalance = bankAccountAllowsVoucherMinusBalance(fromAccountRow);
  const isAmountExceedingSelectedFromAccount = useCallback((enteredAmount: number) => {
    if (!fromAccountId || allowFromAccountMinusBalance) return false;
    const selectedBalance = Number(fromAccountBalance) || 0;
    return enteredAmount > selectedBalance;
  }, [fromAccountId, fromAccountBalance, allowFromAccountMinusBalance]);

  /** Live negative-balance guard: shown as red text under From and disables Save (the submit dialog stays as a backstop). */
  const payeeAmountWatched = form.watch("payeeAmount");
  const otherChargeWatched = form.watch("otherChargeAmount");
  const fromAmountGate = checkLedgerAmountGate({
    accountId: fromAccountId,
    balance: fromAccountBalance,
    minusAllowed: allowFromAccountMinusBalance,
    outflow: (Number(payeeAmountWatched) || 0) + (Number(otherChargeWatched) || 0),
  });
  const contraSaveAmountBlocked = fromAmountGate.blocked;
  const fromAccountAmountWarning = fromAmountGate.message;

  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.contra ?? true;
  const isVoucherEditingAllowed = company?.allowVoucherNumberEditing?.contra ?? false;
  const isPrefixSelectionEnabled = company?.enableVoucherPrefixSelection?.contra ?? false;

  const contraVoucherNumberingKey = useMemo(() => {
    if (!companyId) return "";
    return `${companyId}|${isAutoVoucherEnabled ? 1 : 0}|${JSON.stringify(company?.voucherPrefixes?.contra ?? null)}`;
  }, [companyId, isAutoVoucherEnabled, company?.voucherPrefixes?.contra]);

  const fetchVoucherNumber = useCallback(async (selectedPrefix?: string, opts?: { force?: boolean }) => {
    if (!companyId || !company || !isAutoVoucherEnabled) return;
    const prefixes = company?.voucherPrefixes?.contra || [getVoucherPrefix(company.voucherPrefixes as Record<string, string[]> | undefined)];
    const VOUCHER_PREFIX = selectedPrefix || prefixes[0];

    try {
      const nextNo = await getNextVoucherNumberForCompany({
        companyId,
        companyDoc: company as Record<string, unknown>,
        voucherLike: { type: "contra" },
        selectedPrefix,
        voucherDate: form.getValues("date"),
      });
      const fySeg = parseFySegmentFromVoucherNumber(nextNo, VOUCHER_PREFIX);
      const parsed =
        parseVoucherSerial(nextNo, VOUCHER_PREFIX, fySeg) ||
        parseVoucherNumberPart(nextNo, VOUCHER_PREFIX) ||
        parseVoucherNumberPart(nextNo, normalizePrefix(VOUCHER_PREFIX));
      const nextNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      const { voucherNumber: mainVal, voucherNumberOut: outVal, voucherNumberIn: inVal } =
        formatContraVoucherNumbersFromSerial(
          company.voucherPrefixes as Record<string, string[] | undefined>,
          VOUCHER_PREFIX,
          nextNum,
          fySeg
        );
      if (!opts?.force) {
        const cur = form.getValues();
        if (cur.voucherNumberOut === outVal && cur.voucherNumberIn === inVal) return;
      }
      form.setValue("voucherNumber", mainVal, { shouldDirty: false });
      form.setValue("voucherNumberOut", outVal, { shouldDirty: false });
      form.setValue("voucherNumberIn", inVal, { shouldDirty: false });
    } catch (error) {
      console.error("Error fetching voucher count: ", error);
    }
  }, [companyId, company, form, isAutoVoucherEnabled]);

  useEffect(() => {
    const NEW_CONTRA = "__new_contra__";
    if (voucher?.id) {
      const vid = voucher.id;
      const isSameVoucher = lastResetVoucherIdRef.current === vid;
      if (isSameVoucher) return;
      lastResetVoucherIdRef.current = vid;
      const initialValues = getInitialContraFormValues(voucher);
      if (isEditingAndConverting) {
        initialValues.voucherNumber = "";
      }
      const base = getContraBasePrefix(company?.voucherPrefixes as Record<string, string[]> | undefined);
      const prefix = getVoucherPrefix(company?.voucherPrefixes as Record<string, string[]> | undefined);
      if (!initialValues.voucherNumberOut) {
        const num = parseVoucherNumberPart(initialValues.voucherNumber || "", prefix);
        initialValues.voucherNumberOut = !isNaN(num) ? formatVoucherNumber(`${base} Out`, num) : (initialValues.voucherNumber || "");
      }
      if (!initialValues.voucherNumberIn) {
        const num = parseVoucherNumberPart(initialValues.voucherNumber || "", prefix);
        initialValues.voucherNumberIn = !isNaN(num) ? formatVoucherNumber(`${base} In`, num) : (initialValues.voucherNumber || "");
      }
      form.reset(initialValues);
      setOtherChargeEnabled(Boolean(voucher.otherChargeAccountId || Number(voucher.otherChargeAmount || 0) > 0));
      lastValidAmountRef.current = getContraTotalAmount(voucher);
      setSavedVoucherId(voucher.id);
      const urlsEdit = voucherAttachmentUrlsForFormState(voucher);
      setFiles(urlsEdit);
      initialFilesRef.current = urlsEdit.filter((f): f is string => typeof f === "string");
      setSavePdfAsImage(shouldSuggestPdfAsImage(urlsEdit));
    } else if (voucher) {
      // Naya Contra: template object id ke bina — dirty par seed se files overwrite mat karo.
      if (lastResetVoucherIdRef.current === NEW_CONTRA && isFormDirty) return;
      const isFirstNewContraHydrate = lastResetVoucherIdRef.current !== NEW_CONTRA;
      lastResetVoucherIdRef.current = NEW_CONTRA;
      if (isFirstNewContraHydrate) {
        const initialValues = getInitialContraFormValues(voucher);
        if (isEditingAndConverting) {
          initialValues.voucherNumber = "";
        }
        const base = getContraBasePrefix(company?.voucherPrefixes as Record<string, string[]> | undefined);
        const prefix = getVoucherPrefix(company?.voucherPrefixes as Record<string, string[]> | undefined);
        if (!initialValues.voucherNumberOut) {
          const num = parseVoucherNumberPart(initialValues.voucherNumber || "", prefix);
          initialValues.voucherNumberOut = !isNaN(num) ? formatVoucherNumber(`${base} Out`, num) : (initialValues.voucherNumber || "");
        }
        if (!initialValues.voucherNumberIn) {
          const num = parseVoucherNumberPart(initialValues.voucherNumber || "", prefix);
          initialValues.voucherNumberIn = !isNaN(num) ? formatVoucherNumber(`${base} In`, num) : (initialValues.voucherNumber || "");
        }
        form.reset(initialValues);
        setOtherChargeEnabled(Boolean(voucher.otherChargeAccountId || Number(voucher.otherChargeAmount || 0) > 0));
        lastValidAmountRef.current = getContraTotalAmount(voucher);
        setSavedVoucherId(voucher?.id ?? null);
        const urlsNew = voucherAttachmentUrlsForFormState(voucher);
        setFiles(urlsNew);
        initialFilesRef.current = urlsNew.filter((f: unknown): f is string => typeof f === "string");
        setSavePdfAsImage(shouldSuggestPdfAsImage(urlsNew));
      }
    } else {
      lastResetVoucherIdRef.current = null;
    }
  }, [voucher, form, isEditingAndConverting, company?.voucherPrefixes, isFormDirty]);

  /** Master list me row mil chuki ho to purana RHF error hatao — FormLabel ka `text-destructive` label par chipak jata tha. */
  useEffect(() => {
    if (fromAccountRow) form.clearErrors("fromAccountId");
  }, [fromAccountRow, form]);

  /** To side: duplicate From=To error tab tak rakho jab tak same-id; alag select par clear. */
  useEffect(() => {
    if (!toAccountRow) return;
    if (String(fromAccountId ?? "").trim() === String(toAccountId ?? "").trim()) return;
    form.clearErrors("toAccountId");
  }, [toAccountRow, fromAccountId, toAccountId, form]);


  useEffect(() => {
    if (!isAutoVoucherEnabled) return;
    if (savedVoucherId && !isEditingAndConverting) return;
    const sessionKey = `${contraVoucherNumberingKey}|${savedVoucherId ?? "new"}|${isEditingAndConverting ? "conv" : "create"}`;
    if (autoVoucherNumberFetchKeyRef.current === sessionKey) return;
    autoVoucherNumberFetchKeyRef.current = sessionKey;
    void fetchVoucherNumber(undefined, { force: true });
  }, [savedVoucherId, fetchVoucherNumber, isEditingAndConverting, isAutoVoucherEnabled, contraVoucherNumberingKey]);

  useEffect(() => {
    if (!copySaveTargetCompanyId || voucher?.id || !isAutoVoucherEnabled) return;
    autoVoucherNumberFetchKeyRef.current = null;
    void fetchVoucherNumber(undefined, { force: true });
  }, [copySaveTargetCompanyId, voucher?.id, fetchVoucherNumber, isAutoVoucherEnabled]);

  const watchedContraDate = form.watch("date");
  useEffect(() => {
    if (!companyId || !company || !isAutoVoucherEnabled) return;
    if (savedVoucherId && !isEditingAndConverting) {
      const prefixes =
        company?.voucherPrefixes?.contra ||
        [getVoucherPrefix(company.voucherPrefixes as Record<string, string[]> | undefined)];
      const VOUCHER_PREFIX = prefixes[0];
      const main = syncAutoVoucherNumberToDate({
        companyDoc: company as Record<string, unknown>,
        prefix: VOUCHER_PREFIX,
        currentVoucherNumber: String(form.getValues("voucherNumber") || ""),
        voucherDate: watchedContraDate,
      });
      const fySeg = parseFySegmentFromVoucherNumber(main, VOUCHER_PREFIX);
      const parsed =
        parseVoucherSerial(main, VOUCHER_PREFIX, fySeg) ||
        parseVoucherNumberPart(main, VOUCHER_PREFIX) ||
        parseVoucherNumberPart(main, normalizePrefix(VOUCHER_PREFIX));
      const nextNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      const nums = formatContraVoucherNumbersFromSerial(
        company.voucherPrefixes as Record<string, string[] | undefined>,
        VOUCHER_PREFIX,
        nextNum,
        fySeg
      );
      const cur = form.getValues();
      if (
        cur.voucherNumber === nums.voucherNumber &&
        cur.voucherNumberOut === nums.voucherNumberOut &&
        cur.voucherNumberIn === nums.voucherNumberIn
      ) {
        return;
      }
      form.setValue("voucherNumber", nums.voucherNumber, { shouldDirty: true });
      form.setValue("voucherNumberOut", nums.voucherNumberOut, { shouldDirty: true });
      form.setValue("voucherNumberIn", nums.voucherNumberIn, { shouldDirty: true });
      return;
    }
    void fetchVoucherNumber();
  }, [
    watchedContraDate,
    companyId,
    company,
    isAutoVoucherEnabled,
    savedVoucherId,
    isEditingAndConverting,
    fetchVoucherNumber,
    form,
  ]);

  const handleAccountCreated = (newAccountId: string) => {
    if (targetFieldForNewAccount) {
      form.setValue(targetFieldForNewAccount, newAccountId);
      // Naya account lagte hi validation red label hatao (setValue alone kabhi errors clear nahi karta).
      form.clearErrors(targetFieldForNewAccount);
    }
    setTimeout(() => setIsCreateAccountOpen(false), 50);
  };
  
  const openCreateAccountDialog = (field: 'fromAccountId' | 'toAccountId', newName?: string) => {
    setTargetFieldForNewAccount(field);
    setIsCreateAccountOpen(true);
    if (newName) {
       setTimeout(() => {
        document.dispatchEvent(new CustomEvent('prefill-create-bank-account-name', { detail: newName }));
      }, 100);
    }
  };
  /**
   * Tab-switch (Contra→Journal→Contra) par form fresh mount hota hai.
   * Parent ki state me bachi `copyMasterDraftRequest` se prefill dialog auto-open na ho —
   * sirf user ke Copy chip click ke baad arrive hone wali request par hi dialog khule.
   */
  const hasInitializedCopyRequestRef = useRef(false);
  useEffect(() => {
    // First mount-time run skip — pehle se set request bhi voucher-convert tab-switch ke baad auto-open na kare.
    if (!hasInitializedCopyRequestRef.current) {
      hasInitializedCopyRequestRef.current = true;
      return;
    }
    if (!copyMasterDraftRequest) return;
    const req = copyMasterDraftRequest;
    const targetLabel = req.targetCompanyName || "company";
    const payload = req.sourceRowPayload;
    const sc = String(req.sourceCollection || "");
    const nm = String(req.sourceName || "").trim();
    /** Save ke baad naya bank account isi From/To field par lagao — pehle null tha isliye chip useless lagta tha. */
    const contraSide = req.applyTarget?.contraAccountField ?? null;
    // Contra copy parity: source bank account row mile to full prefill open karo (attachment/profile सहित).
    if (payload && sc === "bank_accounts") {
      setTargetFieldForNewAccount(contraSide);
      setIsCreateAccountOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-bank-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Bank account prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    // Source row unavailable ho to name fallback se account create dialog prefill karo.
    if (!nm) return;
    if (req.category === "account" || req.category === "account_bank") {
      setTargetFieldForNewAccount(contraSide);
      setIsCreateAccountOpen(true);
      setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-bank-account-name", { detail: nm })), 80);
      sonnerToast.message(`Bank account prefilled -> save adds to "${targetLabel}".`);
    }
  }, [copyMasterDraftRequest]);

  // Amount guard पहले; फिर validated `data` — `getValues()` से date miss न हो
  const handleFormSubmit = useCallback(
    (e: React.FormEvent, options: { ocrAutoPost?: boolean; saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean } = {}) => {
      e?.preventDefault?.();
      const enteredAmount =
        (Number(form.getValues("payeeAmount")) || 0) + (Number(form.getValues("otherChargeAmount")) || 0);
      if (isAmountExceedingSelectedFromAccount(enteredAmount)) {
        setIsAmountMoreThanAccountOpen(true);
        return;
      }
      gateConvertSubmit(() => {
        void form.handleSubmit(
          async (data) => {
            await processAndSaveRef.current?.(data, options.saveAndNew ?? false, options.approveAfterSave ? onApprove : undefined, options.approveAfterSave ?? false);
          },
          () => {
            sonnerToast.error("Validation Failed", { description: "Please check all fields and try again." });
          }
        )(e);
      });
    },
    [form, isAmountExceedingSelectedFromAccount, gateConvertSubmit]
  );
  
  async function processAndSave(data: ContraFormValues, saveAndNew: boolean = false, onSuccess?: () => void, approveAfterSave?: boolean) {
    if (!user || !companyId) {
      sonnerToast.error("Error", { description: "Login and company selection required." });
      return;
    }
    
    if (reconGuard) {
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
      const allowed = await reconGuard.checkAndConfirmReconciledDate({
        companyId,
        voucherDate: data.date,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        allVouchers,
        isEdit,
        existingVoucher: voucher,
        newVoucherData: { ...data, type: "contra" },
      });
      if (!allowed) {
        setIsLoading(false);
        return;
      }
    }

    try {
      // Permission check: create or edit (copy-draft pehli save = create)
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
      const voucherDate = data.date instanceof Date ? data.date : new Date(data.date);
      
      if (isEdit) {
        // Check edit permission - determine ownership
        const fetchVoucher = async (cid: string, vid: string) => {
          const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
          return voucherDoc.exists() ? voucherDoc.data() : null;
        };
        const isOwnRecord = await determineVoucherOwnership(voucher, savedVoucherId, allVouchers, user.uid, companyId, fetchVoucher);
        assertCanEdit(canEditRecord, isOwnRecord);
        
        // Check backdate limit for edit - use ORIGINAL voucher date, not form date
        let originalVoucherDate = voucherDate;
        if (voucher?.date) {
          originalVoucherDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date);
        } else if (savedVoucherId) {
          const existingVoucher = allVouchers.find(v => v.id === savedVoucherId);
          if (existingVoucher?.date) {
            originalVoucherDate = existingVoucher.date?.toDate ? existingVoucher.date.toDate() : new Date(existingVoucher.date);
          } else if (companyId) {
            const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, savedVoucherId));
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
        sonnerToast.error("Permission Denied", { description: error.message });
      } else {
        sonnerToast.error("Error", { description: "Failed to check permissions." });
      }
      return;
    }
    
    if (data.fromAccountId === data.toAccountId) {
      sonnerToast.error("Invalid Entry", { description: "Source and destination accounts cannot be the same."});
      form.setError("toAccountId", { message: "Cannot be same as source." });
      return;
    }
    if (amount > 0 && spendWiseLinkRequired) {
      if (!linkedPaymentInIds?.length) {
        sonnerToast.error("Select Receipt", { description: "Linking is required for this role. Please choose at least one Receipt to link this contra to." });
        return;
      }
      if (linkedPaymentInIds?.length) {
        // Save-time validation must match the same pay-from account used in Link Pay In dialog.
        const spendWiseAccountForSave = (data as any).fromAccountId;
        const linkedTotal = linkedPaymentInIds.reduce((sum, id) => {
          if (id === SPEND_WISE_OPENING_BALANCE_ID) {
            // Include Opening Balance row in save-time spend-wise validation.
            const base = getOpeningBalanceBaseAmount(spendWiseInAccountOpeningBalance, "dr");
            const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
            return sum + Math.max(0, base - alreadyLinked);
          }
          // Use same compatibility matcher as dialog so save-validation doesn't hide valid legacy vouchers.
          const v = allVouchers?.find((x: any) =>
            x.id === id &&
            (
              ((x.type === "payment_in" || x.type === "direct_income") && ((x.accountId ?? x.toAccountId ?? x.bankAccountId) === spendWiseAccountForSave)) ||
              (x.type === "contra" && (x.toAccountId ?? x.accountId) === spendWiseAccountForSave)
            )
          );
          const amt = Number(v?.total ?? v?.amount ?? 0) || 0;
          const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
          return sum + Math.max(0, amt - alreadyLinked);
        }, 0);
        if (linkedTotal < amount) {
          sonnerToast.error("Link amount too low", { description: "Selected Receipt linkable total must match or exceed the amount." });
          return;
        }
      }
    }

    const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving contra entry...");
    if (toastId == null) return;
    setIsLoading(true);

    // Contra: primary number for duplicate check and save (Out/In treated as voucher numbers).
    const effectiveVoucherNumber = (data as any).voucherNumberOut ?? (data as any).voucherNumber;

    try {
      if (!savedVoucherId || effectiveVoucherNumber !== (voucher?.voucherNumberOut ?? voucher?.voucherNumber)) {
        const preferLocalReads = preferLocalLedgerReads(company);
        let duplicateOtherId: string | null = null;
        if (preferLocalReads) {
          const hit = await findVoucherInLocalMirrorByNumberAndType(companyId, effectiveVoucherNumber, "contra");
          if (hit && hit.id !== savedVoucherId) duplicateOtherId = hit.id;
        } else {
          const q = query(
            collection(firestore, `companies/${companyId}/vouchers`),
            where("voucherNumber", "==", effectiveVoucherNumber),
            where("type", "==", "contra")
          );
          const existingVoucherSnap = await getDocs(q);
          if (!existingVoucherSnap.empty && existingVoucherSnap.docs[0].id !== savedVoucherId) {
            duplicateOtherId = existingVoucherSnap.docs[0].id;
          }
        }
        if (duplicateOtherId) {
          sonnerToast.error("Duplicate Voucher Number", { id: toastId, description: "This voucher number is already in use." });
          setIsLoading(false);
          return;
        }
      }
      
      const date = data.date instanceof Date ? data.date : new Date((data as any).date);
      const cleanAmount = Math.max(0, (Number(data.payeeAmount || 0) || 0) + (Number(data.otherChargeAmount || 0) || 0));
      const amount = cleanAmount;

      const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });

      /* Duplicate guard: same slip dobara attach + save ho rahi ho to pehle bubble se poochho.
       * File bytes ka SHA-256 sabse strong proof hai; ref/date+amount/charge/narration fallback. */
      const attachmentHashes = await hashAttachmentFiles(filesForSave);
      const duplicate = findDuplicateVoucher(allVouchers as CandidateVoucher[], {
        excludeVoucherId: savedVoucherId ?? voucher?.id,
        type: "contra",
        date,
        amount: (Number(data.payeeAmount || 0) || 0) + (Number(data.otherChargeAmount || 0) || 0),
        fromAccountId: (data as any).fromAccountId,
        toAccountId: (data as any).toAccountId,
        otherChargeAmount: Number(data.otherChargeAmount || 0) || 0,
        otherChargeAccountId: data.otherChargeAccountId || "",
        narration: (data as any).narration ?? "",
        ref: (data as any).txnId || (data as any).referenceId || "",
        attachmentHashes,
      });
      if (duplicate && !skipDuplicatePromptRef.current) {
        sonnerToast.dismiss(toastId);
        setDuplicatePrompt({
          match: duplicate,
          /* User ne "Save anyway" choose kiya — wahi validated `data` se seedha save karo (re-validate
           * mat karo warna gate/convert dobara chal jayega). */
          proceed: async () => {
            skipDuplicatePromptRef.current = true;
            const freshToast = await beginVoucherSaveLoadingOrBlock(companyId, "Saving contra entry...");
            if (freshToast == null) return;
            setIsLoading(true);
            await processAndSaveRef.current?.(data as never, false, undefined, false);
            skipDuplicatePromptRef.current = false;
          },
        });
        setIsLoading(false);
        return;
      }

      // Build payload with only serializable fields (avoid form state carrying Timestamps/id that can break Firestore update)
      const submissionData: any = {
        fromAccountId: (data as any).fromAccountId,
        toAccountId: (data as any).toAccountId,
        voucherNumber: effectiveVoucherNumber,
        voucherNumberOut: (data as any).voucherNumberOut ?? (data as any).voucherNumber,
        voucherNumberIn: (data as any).voucherNumberIn ?? (data as any).voucherNumber,
        narration: (data as any).narration ?? '',
        date: date.toISOString(),
        amount,
        total: amount,
        payeeAmount: Number(data.payeeAmount || cleanAmount) || cleanAmount,
        otherChargeAccountId: data.otherChargeAccountId || "",
        otherChargeAmount: Number(data.otherChargeAmount || 0) || 0,
        fileUrls: filesForSave.filter((f): f is string => typeof f === 'string'),
        attachmentHashes,
        type: 'contra',
      };
      if (!submissionData.otherChargeAmount) {
        submissionData.otherChargeAccountId = "";
      }
      const linkIds = linkedPaymentInIds ?? [];
      submissionData.linkedPaymentInIds = linkIds;
      submissionData.linkedPaymentInAmounts =
        linkIds.length > 0
          // Persist spend-wise allocations against the same pay-from account used in Link Pay In dialog.
          ? allocatePaymentInAmounts(amount, linkIds, allVouchers ?? [], (data as any).fromAccountId, linkedAmountByPaymentInId, spendWiseInAccountOpeningBalance)
          : {};
      
      const originalVoucherIdToDelete: string | null = isEditingAndConverting
        ? getVoucherConvertOriginalId(voucher)
        : null;
      const idArgForFirestore = resolveVoucherIdForSave({
        savedVoucherId,
        originalVoucherIdToDelete,
      });

      const newFilesToUpload = filesForSave.filter(f => typeof f !== 'string') as File[];
      let preGeneratedVoucherId: string | undefined;
      if (newFilesToUpload.length > 0) {
        const totalNewBytes = newFilesToUpload.reduce((sum, f) => sum + (f.size || 0), 0);
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
              storageFolder: "contra",
              existingFileUrls: submissionData.fileUrls as string[],
              newFiles: newFilesToUpload,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: voucherIdForLocalAttachments,
            });
          submissionData.fileUrls = merged;
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
              storageFolder: "contra",
              existingFileUrls: submissionData.fileUrls as string[],
              files: newFilesToUpload,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: isEditingAndConverting && voucher?.id ? null : idArgForFirestore ?? null,
            });
            submissionData.fileUrls = up.fileUrls;
            if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
          }
        }
      }

      Object.assign(
        submissionData,
        voucherAttachmentFieldsForSave(
          (Array.isArray(submissionData.fileUrls) ? submissionData.fileUrls : []).filter(
            (u: unknown): u is string => typeof u === "string"
          ),
          voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))
        )
      );

      if (!idArgForFirestore) delete (submissionData as { id?: string }).id;

      const isEditForApprove = !!voucher?.id && !originalVoucherIdToDelete;
      const approverName = customUser?.displayName || user?.displayName || user?.email || user?.uid;
      const savedDoc = await saveVoucher(
        companyId,
        user.uid,
        submissionData,
        idArgForFirestore,
        approveAfterSave ? { approvedByUserId: user.uid, approvedByName: approverName } : undefined,
        preGeneratedVoucherId ? { preGeneratedVoucherId } : undefined
      );

      if (savedDoc && savedDoc.id) {
          markCopiedDraftPersisted();
          setSavedVoucherId(savedDoc.id);
          const savedLinkIds = Array.isArray(submissionData.linkedPaymentInIds) ? [...submissionData.linkedPaymentInIds] : [];
          initialLinkedPaymentInIdsRef.current = savedLinkIds;
          if (originalVoucherIdToDelete) {
              await markVoucherConvertedInRecycleBin(companyId, originalVoucherIdToDelete, {
                convertedToType: "contra",
                convertedToVoucherNumber: submissionData.voucherNumber,
                convertedToVoucherId: savedDoc.id,
                deletedBy: user.uid,
              });
          }
      } else {
          throw new Error("Failed to save voucher and get ID.");
      }

        const docId = savedDoc.id;
        const approveBanner = !!(approveAfterSave && docId);
        const spendWisePending = pendingLinkedPaymentOut;
        const spendWiseLinkedRowIds = spendWiseLinkedToMeRows.map((r) => r.id);
        const contraFileUrls = (Array.isArray(submissionData.fileUrls) ? submissionData.fileUrls : []).filter(
          (u: unknown): u is string => typeof u === "string" && Boolean(String(u).trim())
        );
        const needsBackgroundSync = !!(spendWisePending && user?.uid);

        if (approveBanner) {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEditForApprove ? "Contra updated and approved." : "Contra saved and approved."
          );
        } else {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEditForApprove ? "Contra updated!" : "Contra entry created!"
          );
        }
        setIsLoading(false);

        if (!saveAndNew) {
          onVoucherAction?.("saved", false, docId);
        }

        if (companyId && docId) {
          try {
            const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
              companyId,
              voucherId: docId,
              rawFileUrls: contraFileUrls,
              storageFolder: "contra",
              previousUrls: initialFilesRef.current,
            });
            setFiles(persistedUrls);
            initialFilesRef.current = persistedUrls;
          } catch (attachErr) {
            console.warn("[CreateContraForm] post-save attachment finalize", attachErr);
          }
        }

        const postSaveTail = async () => {
          if (needsBackgroundSync) {
            const linkResult = await runWithVoucherLinkSaveProgress(async () => {
              if (spendWisePending && user?.uid) {
                const contraId = docId;
                const previouslyLinkedIds = new Set(spendWiseLinkedRowIds);
                const allToUpdate = new Set([...previouslyLinkedIds, ...spendWisePending.ids]);
                for (const poId of allToUpdate) {
                  if (poId === SPEND_WISE_OPENING_BALANCE_ID) continue;
                  const v = allVouchers?.find((x: any) => x.id === poId);
                  if (!v) continue;
                  const existingIds = Array.isArray(v.linkedPaymentInIds) ? [...v.linkedPaymentInIds] : [];
                  const existingAmounts =
                    v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object"
                      ? { ...v.linkedPaymentInAmounts }
                      : {};
                  const newIds = existingIds.filter((id) => id !== contraId);
                  delete existingAmounts[contraId];
                  if (spendWisePending.ids.includes(poId)) {
                    const amt = spendWisePending.amountsByVoucherId[poId] ?? 0;
                    if (amt > 0) {
                      newIds.push(contraId);
                      existingAmounts[contraId] = amt;
                    }
                  }
                  await updateVoucherSpendWiseLinks(companyId, poId, newIds, existingAmounts, user.uid);
                }
                const openingLinked =
                  Number(spendWisePending.amountsByVoucherId[SPEND_WISE_OPENING_BALANCE_ID] ?? 0) || 0;
                await patchVoucherFields(companyId, contraId, {
                  linkedOpeningBalanceAmount: openingLinked,
                  linkedOpeningBalanceAccountId: openingLinked > 0 ? spendWiseOutAccountId : null,
                });
                setPendingLinkedPaymentOut(null);
              }
            });
            if (!linkResult.ok) {
              sonnerToast.error("Link sync failed", {
                description: linkResult.error instanceof Error ? linkResult.error.message : undefined,
                duration: 5000,
              });
            }
          }

          // New create: saveVoucher(approveAfterSave) already set isApproved — skip second approve lookup.
          if (companyId && company) {
            const isEdit = !!voucher?.id;
            const amount = Number(submissionData.amount) || 0;
            const vid = docId || voucher?.id;
            if (isEdit) {
              const oldV = voucher as any;
              const changes = getChangedFieldLabels(
                { amount: oldV?.amount, narration: oldV?.narration, date: oldV?.date, voucherNumber: oldV?.voucherNumber, voucherNumberOut: oldV?.voucherNumberOut, voucherNumberIn: oldV?.voucherNumberIn, fromAccountId: oldV?.fromAccountId, toAccountId: oldV?.toAccountId },
                { amount: submissionData.amount, narration: submissionData.narration, date: submissionData.date, voucherNumber: submissionData.voucherNumber, voucherNumberOut: submissionData.voucherNumberOut, voucherNumberIn: submissionData.voucherNumberIn, fromAccountId: submissionData.fromAccountId, toAccountId: submissionData.toAccountId },
                [
                  { key: "amount", label: "Amount" },
                  { key: "narration", label: "Narration" },
                  { key: "date", label: "Date" },
                  { key: "voucherNumber", label: "Voucher number" },
                  { key: "voucherNumberOut", label: "Voucher No. (Out)" },
                  { key: "voucherNumberIn", label: "Voucher No. (In)" },
                  { key: "fromAccountId", label: "From account" },
                  { key: "toAccountId", label: "To account" },
                ]
              );
              await sendTransactionAlert(companyId, company, {
                kind: "edited",
                voucherId: vid,
                voucherNumber: submissionData.voucherNumber,
                voucherType: "contra",
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
                voucherType: "contra",
                amount,
                performedByUserId: user?.uid,
                performedByName: (customUser?.displayName || user?.displayName) ?? undefined,
                performedByEmail: user?.email ?? undefined,
              });
            }
          }

          if (saveAndNew) {
            form.reset(getInitialContraFormValues());
            setOtherChargeEnabled(false);
            setFiles([]);
            setSavePdfAsImage(false);
            setSavedVoucherId(null);
            autoVoucherNumberFetchKeyRef.current = null;
            await fetchVoucherNumber(undefined, { force: true });
          }

          if (approveAfterSave && voucher?.id) onSuccess?.();
          else if (!approveAfterSave) onSuccess?.();

          if (saveAndNew) {
            onVoucherAction?.("saved", true, docId);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.error("[CreateContraForm] post-save tail", err);
            sonnerToast.error("Contra saved — finishing steps pending", {
              description: err instanceof Error ? err.message : "Alerts may still run.",
              duration: 4500,
            });
          });
          return;
        }

        await postSaveTail();
  
    } catch (error: any) {
      if (error instanceof PermissionDeniedError) {
        sonnerToast.error("Permission Denied", { id: toastId, description: error.message });
      } else if (isVoucherLimitError(error)) {
        sonnerToast.error("Voucher limit reached", { id: toastId, description: error.message, action: { label: "Upgrade", onClick: () => window.location.assign("/billing") } });
      } else {
        const message = error?.message || (typeof error === 'string' ? error : 'Unknown error');
        console.error("Error saving contra voucher:", error);
        voucherSaveErrorToast(toastId, error, message);
      }
    } finally {
        setIsLoading(false);
    }
  };

  processAndSaveRef.current = processAndSave;

  const handleDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;
    if (reconGuard && voucher) {
      const allowed = await reconGuard.checkAndConfirmReconciledDate({
        companyId,
        voucherDate: voucher.date,
        fromAccountId: voucher.fromAccountId,
        toAccountId: voucher.toAccountId,
        allVouchers,
        isDelete: true,
        existingVoucher: voucher,
      });
      if (!allowed) return;
    }
    
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
          form: "contra",
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
        onVoucherAction?.('cancelled', false, savedVoucherId);
    } catch (error) {
        console.error("Error deleting voucher:", error);
        toast({ variant: "destructive", title: "Error", description: "Failed to delete voucher." });
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
          form: "contra",
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
      toast({ title: "Contra deleted permanently." });
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled", false, savedVoucherId);
    } catch (error) {
      console.error("Error permanently deleting voucher:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete contra." });
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
  
  const isOwner = userIsSpecialAccountOwner(String(user?.email || user?.uid || ""), company);

  const availableFromAccounts = allProcessedAccounts.filter((acc) => {
    if (!isNonClearingVoucherBankAccount(acc)) return false;
    if (!acc.isSpecial) return true;
    return specialAccountAllowsPaymentOut(acc, user?.email, isOwner);
  });

  const availableToAccounts = allProcessedAccounts.filter((acc) => {
    if (!isNonClearingVoucherBankAccount(acc)) return false;
    if (!acc.isSpecial) return true;
    return specialAccountAllowsPaymentIn(acc, user?.email, isOwner);
  });
  // Contra out (from account): show balance in option label and block non-positive balances.
  const fromBankCashAccountOptions = useMemo(
    () =>
      availableFromAccounts.map((a: any) =>
        withMasterAccountFreezeComboboxOption(a, {
          value: a.id,
          triggerLabel: `${a.accountName} (${a.accountType})`,
          label: `${a.accountName} (${a.accountType}) — ${formatCurrencyForPrint(Number(a.balance) || 0, { showDrCr: true, noSuffix: true, noAnimation: true })}`,
          isSpecial: a.isSpecial,
          disabled:
            !bankAccountAllowsVoucherMinusBalance(a) && (Number(a.balance) || 0) <= 0,
        })
      ),
    [availableFromAccounts, formatCurrencyForPrint]
  );
  // Contra safety: same account ko From/To dono side par select karne ki गलती रोकने के लिए opposite side me disable karo.
  const contraFromAccountOptions = useMemo(
    () =>
      fromBankCashAccountOptions.map((opt: any) => ({
        ...opt,
        disabled: Boolean(opt.disabled) || (!!toAccountId && String(opt.value) === String(toAccountId)),
      })),
    [fromBankCashAccountOptions, toAccountId]
  );
  // Opposite side guard: From me selected account To list me disabled dikhe.
  const contraToAccountOptions = useMemo(
    () =>
      availableToAccounts.map((a: any) =>
        withMasterAccountFreezeComboboxOption(a, {
          value: a.id,
          label: `${a.accountName} (${a.accountType})`,
          isSpecial: a.isSpecial,
          disabled: !!fromAccountId && String(a.id) === String(fromAccountId),
        })
      ),
    [availableToAccounts, fromAccountId]
  );
  /** Copy-draft helpers: source mismatch ho tabhi account Copy chip dikhe (Sale/Purchase jaisa). */
  const copyDraftAccountHelpersEnabled = Boolean(copySaveTargetCompanyId && onCopyMissingCategory);
  const hasSourceAccountMismatch = Boolean(
    copyMismatchCategories?.includes("account") ||
      // Journal parity: source voucher me party/staff/tax mismatch ho to contra account copy helper bhi dikhao.
      copyMismatchCategories?.includes("party") ||
      copyMismatchCategories?.includes("staff") ||
      copyMismatchCategories?.includes("tax") ||
      copyMismatchCategories?.includes("account_bank") ||
      copyMismatchCategories?.includes("account_expense")
  );
  // Copy chip / red cue: `useAccountBalance` jaisa hi master lookup (trim + string) — alag `some()` se drift na ho.
  const showCopyFromAccountFromSource =
    copyDraftAccountHelpersEnabled && hasSourceAccountMismatch && (!String(fromAccountId ?? "").trim() || !fromAccountRow);
  const showCopyToAccountFromSource =
    copyDraftAccountHelpersEnabled && hasSourceAccountMismatch && (!String(toAccountId ?? "").trim() || !toAccountRow);

  const voucherPrefixes = useMemo(
    () =>
      company?.voucherPrefixes?.contra ||
      [getVoucherPrefix(company?.voucherPrefixes as Record<string, string[]> | undefined)],
    [company?.voucherPrefixes?.contra]
  );
  

  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => handleFormSubmit(e)} className="h-full flex flex-col min-w-0 w-full max-w-full">
          <ScrollArea className={cn("flex-1 overflow-x-hidden min-w-0 w-full", !isMobile && "pr-6 -mr-6")}>
            <div className={cn(
              "space-y-6 min-w-0 max-w-full w-full overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full",
              isMobile ? "" : "px-[2px]"
            )}>
              {/* PC View: All 4 Fields in Same Row with Responsive Wrapping */}
              {isMobile ? (
                <>
                  {/* Mobile Section 1: Date + Voucher No. grouped in a single ribbon container. */}
                  {/* Match Sale form's top section tone for visual consistency. */}
                  <div className="rounded-lg border border-sky-400 bg-sky-100 p-2 space-y-2">
                  {/* Mobile: Date top-left only (old Voucher No. removed; Out/In are voucher numbers). */}
                  <div>
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field: dateField }: any) => (
                      <>
                        <div className="grid gap-2 w-full min-w-0 grid-cols-1 sm:grid-cols-2">
                          {(dateSystem === 'BS' || dateSystem === 'Both') && (
                            <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                              <FormLabel className="text-xs truncate">Date (BS)</FormLabel>
                              <BsDatePicker valueAD={dateField.value} onChangeAD={(d) => { if (d) d.setHours(12, 0, 0, 0); dateField.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} transactionDates={transactionDates} className="h-9 text-xs w-full" disabled={deleteDisabledWhenLinked} />
                            </FormItem>
                          )}
                          {(dateSystem === 'AD' || dateSystem === 'Both') && (
                            <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                              <FormLabel className="text-xs truncate">Date</FormLabel>
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
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
                        </div>
                        <FormMessage />
                      </>
                    )}
                  />
                  </div>
                  {/* Mobile: Contra Out and Contra In above From/To account — width responsive */}
                  {/* Voucher row stays inside the same Section 1 container. */}
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <FormField control={form.control} name="voucherNumberOut" render={({ field }: any) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="text-xs truncate">Voucher No. (Out)</FormLabel>
                        <FormControl>
                          <VoucherNumberInputWithRefresh placeholder="CNTR Out - 001" {...field} value={field.value ?? ""} chromeSize="sm" className="h-9 text-xs w-full min-w-0" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber(undefined, { force: true })} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="voucherNumberIn" render={({ field }: any) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="text-xs truncate">Voucher No. (In)</FormLabel>
                        <FormControl>
                          <VoucherNumberInputWithRefresh placeholder="CNTR In - 001" {...field} value={field.value ?? ""} chromeSize="sm" className="h-9 text-xs w-full min-w-0" disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber(undefined, { force: true })} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  </div>
                  {/* Mobile: From Account and To Account - grid-cols-2 so fields fit inside dialog */}
                  {/* Mobile Section 2: Account + Amount grouped in a single ribbon container. */}
                  <div className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 p-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <FormField 
                      control={form.control} 
                      name="fromAccountId" 
                      render={({ field }: any) => (
                        <FormItem className="min-w-0">
                          <div className="flex justify-between items-baseline mb-1 min-w-0">
                            <FormLabel className={cn("text-xs truncate", showCopyFromAccountFromSource && "text-red-600 font-semibold")}>Pay from (From account)</FormLabel>
                            {fromAccountBalance !== null && <FormLabel className="text-[10px] text-muted-foreground shrink-0">Bal: {formatCurrencyForPrint(fromAccountBalance, { noSuffix: true, noAnimation: true })}</FormLabel>}
                          </div>
                          <div className="min-w-0 w-full flex items-center gap-1">
                            <div className="min-w-0 flex-1 overflow-hidden">
                            <Combobox 
                              triggerClassName={cn(
                                "w-full min-w-0",
                                showCopyFromAccountFromSource && "!border-red-400 !bg-red-100/80 !text-red-700"
                              )}
                              options={contraFromAccountOptions}
                              value={field.value} 
                              onChange={(value, newName) => {
                                if (value === "add-new") openCreateAccountDialog("fromAccountId", newName);
                                else {
                                  field.onChange(value);
                                  form.clearErrors("fromAccountId");
                                }
                              }}
                              placeholder="Select account" 
                              addNewLabel="+ Add New Account" 
                              highlightBalanceInOptions
                              disabled={deleteDisabledWhenLinked}
                            />
                            </div>
                            {showCopyFromAccountFromSource && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                onClick={() =>
                                  onCopyMissingCategory?.("account_bank", { contraAccountField: "fromAccountId" })
                                }
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                          </div>
                          {fromAccountAmountWarning && (
                            <p className="mt-1 text-[10px] font-semibold leading-snug text-red-600" role="alert">
                              {fromAccountAmountWarning}
                            </p>
                          )}
                          <div className="mt-2">
                            <FormLabel className="text-[10px] text-muted-foreground">Total Out</FormLabel>
                            <Input type="number" value={contraTotalAmount || ""} readOnly className="mt-1 bg-muted font-semibold h-9 text-xs" />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField 
                      control={form.control} 
                      name="toAccountId" 
                      render={({ field }: any) => (
                        <FormItem className="min-w-0">
                          <div className="flex justify-between items-baseline mb-1 min-w-0">
                            <FormLabel className={cn("text-xs truncate", showCopyToAccountFromSource && "text-red-600 font-semibold")}>To Account</FormLabel>
                            <div className="flex items-center gap-1 shrink-0">
                              {!showOtherChargeCard && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 rounded-full border-blue-300 bg-blue-100 px-2 text-[10px] font-semibold text-blue-900 hover:bg-blue-200"
                                disabled={deleteDisabledWhenLinked}
                                onClick={() => {
                                  setOtherChargeEnabled(true);
                                  form.setValue("otherChargeAmount", 0);
                                }}
                              >
                                <PlusCircle className="mr-0.5 h-3 w-3" /> Other charge
                              </Button>
                              )}
                              {toAccountBalance !== null && <FormLabel className="text-[10px] text-muted-foreground shrink-0">Bal: {formatCurrencyForPrint(toAccountBalance, { noSuffix: true, noAnimation: true })}</FormLabel>}
                            </div>
                          </div>
                          <div className="min-w-0 w-full grid grid-cols-[minmax(0,1fr)_minmax(10ch,max-content)] gap-1 items-end">
                            <div className="min-w-0 flex items-center gap-1">
                            <div className="min-w-0 flex-1 overflow-hidden">
                            <Combobox 
                              triggerClassName={cn(
                                "w-full min-w-0",
                                showCopyToAccountFromSource && "!border-red-400 !bg-red-100/80 !text-red-700"
                              )}
                              options={contraToAccountOptions} 
                              value={field.value} 
                              onChange={(value, newName) => {
                                if (value === "add-new") openCreateAccountDialog("toAccountId", newName);
                                else {
                                  field.onChange(value);
                                  form.clearErrors("toAccountId");
                                }
                              }}
                              placeholder="Select account" 
                              addNewLabel="+ Add New Account" 
                              disabled={deleteDisabledWhenLinked}
                            />
                            </div>
                            {showCopyToAccountFromSource && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                onClick={() =>
                                  onCopyMissingCategory?.("account_bank", { contraAccountField: "toAccountId" })
                                }
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                            </div>
                            <FormField control={form.control} name="payeeAmount" render={({ field: payeeField }: any) => (<FormItem data-ocr-field="amount" className="min-w-0"><FormLabel className="text-[10px] text-muted-foreground">Amount</FormLabel><FormControl><Input type="number" placeholder="0" className="h-9 text-xs min-w-[10ch]" style={{ width: `${Math.max(8, String(payeeField.value ?? "").length)}ch` }} {...payeeField} value={payeeField.value ?? ""} onChange={(e) => {
                      const nextAmount = e.target.value === "" ? 0 : Number(e.target.value);
                      if (isAmountExceedingSelectedFromAccount(nextAmount + otherChargeAmountValue)) {
                        payeeField.onChange(Math.max(0, lastValidAmountRef.current - otherChargeAmountValue));
                        setIsAmountMoreThanAccountOpen(true);
                        return;
                      }
                      payeeField.onChange(nextAmount);
                      lastValidAmountRef.current = nextAmount + otherChargeAmountValue;
                      if (isAmountExceedingSelectedFromAccount(nextAmount + otherChargeAmountValue)) {
                        setIsAmountMoreThanAccountOpen(true);
                      }
                    }} disabled={deleteDisabledWhenLinked} /></FormControl><FormMessage /></FormItem>)}/>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {showOtherChargeCard && (
                    <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                      <FormField
                        control={form.control}
                        name="otherChargeAccountId"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="other-charge" className="min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <FormLabel className="text-xs">Other Charge</FormLabel>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 rounded-full px-2 text-xs"
                                disabled={deleteDisabledWhenLinked}
                                onClick={() => {
                                  setOtherChargeEnabled(false);
                                  form.setValue("otherChargeAccountId", "");
                                  form.setValue("otherChargeAmount", 0);
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="flex justify-end">
                              {otherChargeBalance !== null && (
                                <FormLabel className={cn("text-[10px] font-semibold shrink-0", otherChargeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {formatCurrencyForPrint(Math.abs(otherChargeBalance), { noSuffix: true, noAnimation: true })} {otherChargeBalance >= 0 ? 'Dr' : 'Cr'}
                                </FormLabel>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <Combobox
                                  triggerClassName="w-full min-w-0"
                                  options={otherChargeAccountOptions}
                                  value={field.value}
                                  onChange={(val, newName) =>
                                    handleOtherChargeAccountChange(field.onChange, val, newName)
                                  }
                                  placeholder="Select account"
                                  addNewLabels={OTHER_CHARGE_ADD_NEW_LABELS}
                                  disabled={deleteDisabledWhenLinked}
                                />
                              </div>
                              {!isEditingVoucherForDefaults && (otherChargeAccountId || storedOtherChargeDefaultId) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 rounded-full px-3 text-sm font-medium"
                                  onClick={setOtherChargeDefault}
                                >
                                  {storedOtherChargeDefaultId ? "Clear" : "Default"}
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="otherChargeAmount"
                        render={({ field }: any) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="text-xs">Amount</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                value={field.value ?? ""}
                                onChange={(e) => {
                                  const nextAmount = e.target.value === "" ? 0 : Number(e.target.value);
                                  if (isAmountExceedingSelectedFromAccount(payeeAmountValue + nextAmount)) {
                                    field.onChange(0);
                                    setIsAmountMoreThanAccountOpen(true);
                                    return;
                                  }
                                  field.onChange(nextAmount);
                                  lastValidAmountRef.current = payeeAmountValue + nextAmount;
                                }}
                                disabled={deleteDisabledWhenLinked}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                  </div>
                </>
              ) : (
                <>
                  {/* Desktop Section 1: Date + Voucher No. in one ribbon section. */}
                  {/* Match Sale form's top section tone for visual consistency. */}
                  <div className="rounded-lg border border-sky-400 bg-sky-100 p-3 space-y-3">
                  {/* PC View: Date top-left (old Voucher No. field removed; Out/In treated as voucher numbers). */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:justify-start md:items-end">
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
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
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
                  {/* PC View: Contra Out (above From account) and Contra In (above To account) — width like date, responsive */}
                  {/* Voucher row stays inside same Desktop Section 1 container. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="voucherNumberOut"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Voucher No. (Out)</FormLabel>
                          <FormControl>
                            <VoucherNumberInputWithRefresh placeholder="e.g. CNTR Out - 001" {...field} value={field.value ?? ""} className={cn("w-full max-w-[14rem] md:max-w-[12rem]")} disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber(undefined, { force: true })} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="voucherNumberIn"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Voucher No. (In)</FormLabel>
                          <FormControl>
                            <VoucherNumberInputWithRefresh placeholder="e.g. CNTR In - 001" {...field} value={field.value ?? ""} className={cn("w-full max-w-[14rem] md:max-w-[12rem]")} disabled={deleteDisabledWhenLinked || (isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers')))} onRefresh={() => void fetchVoucherNumber(undefined, { force: true })} showRefresh={isAutoVoucherEnabled && !savedVoucherId && !deleteDisabledWhenLinked} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  </div>
                  {/* PC View: From Account and To Account */}
                  {/* Desktop Section 2: Account + Amount in one ribbon section. */}
                  <div className="rounded-lg border border-emerald-300/80 bg-emerald-50/70 p-3 space-y-3">
                  <div className={cn("grid gap-6 min-w-0 items-stretch", showOtherChargeCard ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2")}>
                    <div className="h-full min-h-0 rounded-lg border bg-muted/20 p-3 flex flex-col">
                    <FormField control={form.control} name="fromAccountId" render={({ field }: any) => (<FormItem className="flex flex-col flex-1 min-h-0">
                        <div className="flex justify-between items-baseline">
                            <FormLabel className={cn(showCopyFromAccountFromSource && "text-red-600 font-semibold")}>Pay from (From account)</FormLabel>
                            {fromAccountBalance !== null && <FormLabel className={cn("text-xs font-semibold", fromAccountBalance >= 0 ? 'text-green-600' : 'text-red-600')}>{`Balance: ${formatCurrencyForPrint(fromAccountBalance, { showDrCr: true, noAnimation: true })}`}</FormLabel>}
                        </div>
                        <div className="mt-auto grid grid-cols-[minmax(0,1fr)_minmax(12ch,max-content)] gap-3 items-end pt-4">
                          <div className="min-w-0 w-full flex items-center gap-1">
                            <div className="min-w-0 flex-1 overflow-hidden">
                            <Combobox
                              triggerClassName={cn(
                                "w-full min-w-0",
                                showCopyFromAccountFromSource && "!border-red-400 !bg-red-100/80 !text-red-700"
                              )}
                              options={contraFromAccountOptions}
                              value={field.value}
                              onChange={(value, newName) => {
                                if (value === "add-new") openCreateAccountDialog("fromAccountId", newName);
                                else {
                                  field.onChange(value);
                                  form.clearErrors("fromAccountId");
                                }
                              }}
                              placeholder="Select account"
                              addNewLabel="+ Add New Account"
                              highlightBalanceInOptions
                              disabled={deleteDisabledWhenLinked}
                            />
                            </div>
                            {showCopyFromAccountFromSource && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                onClick={() =>
                                  onCopyMissingCategory?.("account_bank", { contraAccountField: "fromAccountId" })
                                }
                                disabled={isCopyingMissingMasters}
                              >
                                {isCopyingMissingMasters ? "…" : "Copy"}
                              </Button>
                            )}
                          </div>
                          {fromAccountAmountWarning && (
                            <p className="mt-1 text-[10px] font-semibold leading-snug text-red-600" role="alert">
                              {fromAccountAmountWarning}
                            </p>
                          )}
                          <div className="min-w-0">
                            <FormLabel className="text-xs text-muted-foreground">Total Out</FormLabel>
                            <Input
                              type="number"
                              value={contraTotalAmount || ""}
                              readOnly
                              className="mt-1 min-w-[12ch] bg-muted font-semibold"
                              style={{ width: `${Math.max(10, String(contraTotalAmount || "").length)}ch` }}
                            />
                          </div>
                        </div>
                        <FormMessage /></FormItem>)}/>
                    </div>
                    <div className="h-full min-h-0 rounded-lg border bg-muted/20 p-3 flex flex-col min-w-0">
                        <div className="flex justify-between items-baseline">
                            <FormLabel className={cn(showCopyToAccountFromSource && "text-red-600 font-semibold")}>To Account (Debit)</FormLabel>
                            <div className="flex items-center gap-2">
                              {!showOtherChargeCard && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-blue-300 bg-blue-100 px-3 text-xs font-semibold text-blue-900 hover:bg-blue-200"
                                disabled={deleteDisabledWhenLinked}
                                onClick={() => {
                                  setOtherChargeEnabled(true);
                                  form.setValue("otherChargeAmount", 0);
                                }}
                              >
                                <PlusCircle className="mr-1 h-3.5 w-3.5" /> Other charge
                              </Button>
                              )}
                              {toAccountBalance !== null && <FormLabel className={cn("text-xs font-semibold", toAccountBalance >= 0 ? 'text-green-600' : 'text-red-600')}>{`Balance: ${formatCurrencyForPrint(toAccountBalance, { showDrCr: true, noAnimation: true })}`}</FormLabel>}
                            </div>
                        </div>
                        <div className="mt-auto grid grid-cols-[minmax(0,1fr)_minmax(12ch,max-content)] gap-3 items-end pt-4">
                          <FormField control={form.control} name="toAccountId" render={({ field }: any) => (<FormItem className="min-w-0">
                        <div className="min-w-0 w-full flex items-center gap-1">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <Combobox
                              triggerClassName={cn(
                                "w-full min-w-0",
                                showCopyToAccountFromSource && "!border-red-400 !bg-red-100/80 !text-red-700"
                              )}
                              options={contraToAccountOptions}
                              value={field.value}
                              onChange={(value, newName) => {
                                if (value === "add-new") openCreateAccountDialog("toAccountId", newName);
                                else {
                                  field.onChange(value);
                                  form.clearErrors("toAccountId");
                                }
                              }}
                              placeholder="Select destination account"
                              addNewLabel="+ Add New Account"
                              disabled={deleteDisabledWhenLinked}
                            />
                          </div>
                          {showCopyToAccountFromSource && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                              onClick={() =>
                                onCopyMissingCategory?.("account_bank", { contraAccountField: "toAccountId" })
                              }
                              disabled={isCopyingMissingMasters}
                            >
                              {isCopyingMissingMasters ? "…" : "Copy"}
                            </Button>
                          )}
                        </div>
                        <FormMessage /></FormItem>)}/>
                          <FormField control={form.control} name="payeeAmount" render={({ field: payeeField }: any) => (<FormItem data-ocr-field="amount">
                            <FormLabel className="text-xs text-muted-foreground">Amount (To account)</FormLabel>
                            <FormControl>
                              <Input type="number" placeholder="Enter amount" value={payeeField.value ?? ""} onChange={(e) => {
                                const nextAmount = e.target.value === "" ? 0 : Number(e.target.value);
                                if (isAmountExceedingSelectedFromAccount(nextAmount + otherChargeAmountValue)) {
                                  payeeField.onChange(Math.max(0, lastValidAmountRef.current - otherChargeAmountValue));
                                  setIsAmountMoreThanAccountOpen(true);
                                  return;
                                }
                                payeeField.onChange(nextAmount);
                                lastValidAmountRef.current = nextAmount + otherChargeAmountValue;
                              }} disabled={deleteDisabledWhenLinked} className="min-w-[12ch] bg-background" style={{ width: `${Math.max(10, String(payeeField.value ?? "").length)}ch` }} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>)}/>
                        </div>
                    </div>
                    {showOtherChargeCard && (
                    <div className="relative h-full min-h-0 rounded-lg border bg-muted/20 p-3 flex flex-col min-w-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="absolute right-3 top-3 h-8 w-8 rounded-full p-0"
                        disabled={deleteDisabledWhenLinked}
                        onClick={() => {
                          setOtherChargeEnabled(false);
                          form.setValue("otherChargeAccountId", "");
                          form.setValue("otherChargeAmount", 0);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="mt-auto grid grid-cols-[minmax(0,1fr)_minmax(12ch,max-content)] gap-3 items-end">
                      <FormField
                        control={form.control}
                        name="otherChargeAccountId"
                        render={({ field }: any) => (
                          <FormItem data-ocr-field="other-charge">
                            <div className="flex justify-between items-center gap-2">
                              <FormLabel>Other Charge</FormLabel>
                            </div>
                            <div className="flex justify-end">
                              {otherChargeBalance !== null && (
                                <FormLabel className={cn("text-xs font-semibold", otherChargeBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {otherChargeBalance >= 0
                                    ? `Receivable: ${formatCurrencyForPrint(otherChargeBalance, { noSuffix: true, noAnimation: true })} Dr`
                                    : `Payable: ${formatCurrencyForPrint(Math.abs(otherChargeBalance), { noSuffix: true, noAnimation: true })} Cr`
                                  }
                                </FormLabel>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <Combobox
                                  options={otherChargeAccountOptions}
                                  value={field.value}
                                  onChange={(val, newName) =>
                                    handleOtherChargeAccountChange(field.onChange, val, newName)
                                  }
                                  placeholder="Select account"
                                  addNewLabels={OTHER_CHARGE_ADD_NEW_LABELS}
                                  disabled={deleteDisabledWhenLinked}
                                />
                              </div>
                              {!isEditingVoucherForDefaults && (otherChargeAccountId || storedOtherChargeDefaultId) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 rounded-full px-3 text-sm font-medium"
                                  onClick={setOtherChargeDefault}
                                >
                                  {storedOtherChargeDefaultId ? "Clear" : "Default"}
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="otherChargeAmount"
                        render={({ field }: any) => (
                          <FormItem>
                            <FormLabel>Amount</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                value={field.value ?? ""}
                                onChange={(e) => {
                                  const nextAmount = e.target.value === "" ? 0 : Number(e.target.value);
                                  if (isAmountExceedingSelectedFromAccount(payeeAmountValue + nextAmount)) {
                                    field.onChange(0);
                                    setIsAmountMoreThanAccountOpen(true);
                                    return;
                                  }
                                  field.onChange(nextAmount);
                                  lastValidAmountRef.current = payeeAmountValue + nextAmount;
                                }}
                                disabled={deleteDisabledWhenLinked}
                                className={cn("min-w-[12ch]", deleteDisabledWhenLinked ? "bg-muted" : "")}
                                style={{ width: `${Math.max(10, String(field.value ?? "").length)}ch` }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      </div>
                    </div>
                    )}
                  </div>
                  </div>
                </>
              )}
              {/* Amount moved into Account+Amount grouped section above (mobile + desktop). */}
              {/* Attach + Narration in one ribbon container: mobile stacks (narration below), desktop shows narration at right. */}
              <div className="rounded-lg border border-indigo-300/80 bg-indigo-50/70 p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormItem>
                    <FormLabel>Attach Files (Optional)</FormLabel>
                    {showPdfAsImageToggle && (
                      <VoucherPdfAsImageToggle
                        existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                        id="voucher-save-pdf-as-image-contra"
                        checked={savePdfAsImage}
                        onCheckedChange={setSavePdfAsImage}
                        disabled={!allowAttachments || fileAttachLockedByDialog || fileAttachmentLimits.maxFileCount === 0}
                        className="mb-2"
                      />
                    )}
                    <VoucherOcrRefreshBar ocr={ocr} />
                    <RestrictedFileUploader>
                      {/* File actions stay unchanged; only grouped in shared container with narration. */}
                      <div className="flex flex-wrap gap-4">
                        {files.map((file, index) => (
                          <FilePreview
                            key={typeof file === "string" ? file : `${file.name}-${file.size}-${index}`}
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
                            <Input
                              id={attachFileInputId}
                              type="file"
                              className="sr-only"
                              ref={fileInputRef}
                              onChange={handleFileChange}
                              accept={[
                                fileAttachmentLimits.allowImage ? "image/*" : "",
                                fileAttachmentLimits.allowPDF ? "application/pdf" : ""
                              ].filter(Boolean).join(",") || "image/*,application/pdf"}
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
                      <FormItem data-ocr-field="bill-no">
                        <FormLabel>Narration</FormLabel>
                        <FormControl>
                          {/* Shared narration sizing: fixed chhoti height ki jagah resize + scroll */}
                          <Textarea placeholder="e.g., Cash deposited to bank" {...field} className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              {(showSpendWiseSection && !shouldShowSpendWiseSection) && (
                <div className="pb-1">
                  {/* Keep Contra link UI hidden until user opts in, unless existing links already present. */}
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSections(true)}>Show Link</Button>
                </div>
              )}
              {shouldShowSpendWiseSection && (
                <div className="space-y-4 min-w-0 w-full">
                  {/* Upper row: single main container for To Voucher + To Voucher (current) */}
                  {/* Match sale-style pink ribbon tone on spend-wise main container (without inner box). */}
                  <div className="min-w-0 w-full rounded-xl border-2 border-rose-300/80 bg-rose-50 p-4">
                    <div className="flex justify-center mb-3">
                    <span className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 text-center">
                      {/* Show opposite account name so user knows which inflow side is being linked. */}
                      Other voucher in To Contra out{spendWiseInAccountId ? ` ( account ${allProcessedAccounts?.find((a: any) => a.id === spendWiseInAccountId)?.accountName ?? "—"} )` : ""}
                    </span>
                    </div>
                    {/* PC + mobile: keep only one full-width spend-wise card after current-voucher card removal. */}
                    {/* Inner wrapper kept minimal: no boxed styling, only layout container. */}
                    <div className="min-w-0 w-full">
                  {/* Top left: From Voucher — message inside card when Link for Bill Wise is ON */}
                  {/* Spend-wise card uses a distinct warm tone so this form doesn't repeat green section color. */}
                  {/* Inner spend-wise box removed as requested; content sits directly on main container. */}
                  <div className="flex flex-col h-full min-h-0 space-y-2 min-w-0 w-full max-w-full overflow-hidden">
                    <div className="flex items-center justify-between gap-2 min-w-0 shrink-0">
                      <div className="flex items-center gap-2 font-medium min-w-0">
                        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">Link for spend wise</span>
                      </div>
                      <span className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-base font-medium text-blue-700">From Voucher</span>
                    </div>
                    {spendWiseLinkRequired && (
                      <p className="text-sm text-blue-600">
                        {spendWiseCardAvailableCount > 0
                            ? `${spendWiseCardAvailableCount} voucher${spendWiseCardAvailableCount === 1 ? "" : "s"} available to link, so link 1st to save.`
                            : "You can save this voucher without linking, bcz no voucher to link."}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {spendWiseCardAvailableCount} voucher(s) available to link.{fromCardLinkedCount > 0 && ` ${fromCardLinkedCount} linked.`}
                    </p>
                    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
                    {!showSpendWiseSection ? (
                      <p className="text-sm text-muted-foreground">Select From account to link Receipt / Direct Income / Contra.</p>
                    ) : (selectedContraLeg === 'in' ? displayLinkedToMeRows.length === 0 : spendWiseDisplayRows.length === 0) ? null : (
                      <div className="overflow-x-auto -mx-1 min-w-0">
                        <table className="w-full text-sm border-collapse min-w-[400px]">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                              <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                              <th className="text-left p-2 font-medium whitespace-nowrap">{selectedContraLeg === 'in' ? 'To' : 'From'}</th>
                              <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                              {selectedContraLeg !== 'in' && <th className="text-right p-2 font-medium whitespace-nowrap">Linked on others</th>}
                              <th className="text-right p-2 font-medium whitespace-nowrap">Linked on current</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedContraLeg === 'in' ? displayLinkedToMeRows : spendWiseDisplayRows).map((row: any) => (
                              <tr key={row.id} className="border-b last:border-b-0">
                                <td className="p-2 text-muted-foreground whitespace-nowrap">{row.date ? formatDateBySystem(row.date) : "—"}</td>
                                <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                                <td className="p-2 whitespace-nowrap">{selectedContraLeg === 'in' ? (row.to ?? row.from) : row.from}</td>
                                <td className={cn("p-2 text-right font-medium whitespace-nowrap", selectedContraLeg === 'in' ? "text-red-600" : "text-green-600")}>
                                  {formatCurrency(row.amount, { noSuffix: true, noAnimation: true })} {selectedContraLeg === 'in' ? 'Cr' : 'Dr'}
                                </td>
                                {selectedContraLeg !== 'in' && (
                                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(row.linkedOnOthers ?? 0, { noSuffix: true, noAnimation: true })} Dr</td>
                                )}
                                <td className={cn("p-2 text-right whitespace-nowrap", selectedContraLeg === 'in' ? "text-red-600" : "text-muted-foreground")}>
                                  {formatCurrency(row.linked, { noSuffix: true, noAnimation: true })} {selectedContraLeg === 'in' ? 'Cr' : 'Dr'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    </div>
                    {showSpendWiseSection && (
                        <div className="pt-2 border-t space-y-2 shrink-0">
                          <div className="flex justify-end min-w-0">
                            <div className="grid grid-cols-2 gap-1.5 text-sm w-fit">
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center min-h-0 min-w-0 overflow-hidden">
                                <span className="text-muted-foreground truncate leading-tight">Total linked</span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end min-h-0 min-w-0 overflow-hidden">
                                <span className="truncate text-right whitespace-nowrap leading-tight">
                                  {formatCurrency(fromCardLinkedTotal, { noSuffix: true, noAnimation: true })} {selectedContraLeg === 'in' ? 'Cr' : 'Dr'}
                                </span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium min-h-0 min-w-0 overflow-hidden">
                                <span className="truncate leading-tight">Balance</span>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium min-h-0 min-w-0 overflow-hidden">
                                <span className={cn("truncate text-right whitespace-nowrap leading-tight", fromCardSettled ? "text-green-600 font-semibold" : "")}>
                                  {fromCardSettled ? "Settled" : `${formatCurrency(fromCardBalance, { noSuffix: true, noAnimation: true })} ${selectedContraLeg === 'in' ? 'Cr' : 'Dr'}`}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center">
                            {/* From + To dono cards par same dialog — user ko green card se bhi link kholne ka option */}
                            {showSpendWiseSection && (
                              <Button
                                type="button"
                                onClick={() => selectedContraLeg === "in" ? setIsLinkPaymentOutDialogOpen(true) : setIsLinkPaymentInDialogOpen(true)}
                                className={cn("w-fit", BTN_SAVE_CLASS)}
                              >
                                <Link2 className="h-4 w-4 mr-2" />
                                {selectedContraLeg === "in" ? "Link Pay Out" : "Link Receipt"}
                              </Button>
                            )}
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setLinkSectionInfoOpen(true)} aria-label="Link section information">
                              <Info className="h-4 w-4 shrink-0" />
                              Read me
                            </Button>
                          </div>
                        </div>
                    )}
                  </div>
                  {/* Requested UX: remove "current voucher" preview card; keep only From Voucher spend-wise section. */}
                    </div>
                  </div>
                </div>
              )}
              {/* Narration moved into shared Attach+Narration container above (mobile below, desktop right). */}
            </div>
          </ScrollArea>

          <div className={cn(
            "border-t min-w-0 max-w-full overflow-x-hidden",
            isMobile ? "mt-[3px] pt-[3px] pb-[3px]" : "pt-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4"
          )}>
            {isMobile ? (
              <div className={cn("grid grid-cols-3 gap-2 w-full", VOUCHER_BUTTONS_CLASS)}>
                {/* Row 0: Delete (left) | History (middle) | Save & Print (right) */}
                <Button type="button" variant="destructive" className="w-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                      Delete
                    </Button>
                <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || linkPayOthersDisabled || !showHistoryButton || !onOpenHistory} className={cn("w-full", BTN_HISTORY_CLASS)}>
                  History
                </Button>
                <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_PRINT_CLASS)}>
                  Save & Print
                </Button>
                {/* Row 1: Cancel (left) | Save (middle) | Approve (right) — Link spend-wise ab To Voucher card mein */}
                <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("w-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                  <Button type="submit" disabled={linkPayOthersDisabled || isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || contraSaveAmountBlocked || (!!voucher?.id && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_SAVE_CLASS)}>
                  {isLoading ? "..." : isEditingAndConverting ? "Convert" : "Save"}
                </Button>
                {voucher?.id ? (
                  <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty || isEditingAndConverting) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={linkPayOthersDisabled || isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_APPROVE_CLASS)}>
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
                  <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher?.id || !onOpenHistory} className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}>
                    <History className="mr-2 h-4 w-4" /> History
                  </Button>
                  <Button type="button" variant="destructive" className="w-full md:w-auto shrink-0 rounded-full" disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                </div>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={linkPayOthersDisabled || !!voucher || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}>
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
      </Form>
      {convertPresentation ? (
        <VoucherEditConvertConfirmDialog
          open={convertConfirmOpen}
          onOpenChange={setConvertConfirmOpen}
          bannerText={convertPresentation.bannerText}
          onConfirm={confirmConvertSubmit}
        />
      ) : null}
      <CreateBankAccountDialog onAccountCreated={handleAccountCreated} isOpen={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen} />
      <CreatePartyDialog
        isOpen={isCreatePartyOpen}
        onOpenChange={setIsCreatePartyOpen}
        onPartyCreated={(id) => {
          setIsCreatePartyOpen(false);
          if (creatingOtherChargeAccountRef.current) {
            creatingOtherChargeAccountRef.current = false;
            form.setValue("otherChargeAccountId", id);
          }
        }}
      />
      <CreateStaffDialog
        isOpen={isCreateStaffOpen}
        onOpenChange={setIsCreateStaffOpen}
        onStaffCreated={(id) => {
          setIsCreateStaffOpen(false);
          if (creatingOtherChargeAccountRef.current) {
            creatingOtherChargeAccountRef.current = false;
            form.setValue("otherChargeAccountId", id);
          }
        }}
        groups={[]}
      >
        <div />
      </CreateStaffDialog>
      <CreateExpenseAccountDialog
        isOpen={isCreateExpenseAccountOpen}
        onOpenChange={setIsCreateExpenseAccountOpen}
        onExpenseAccountCreated={(id) => {
          setIsCreateExpenseAccountOpen(false);
          if (creatingOtherChargeAccountRef.current) {
            creatingOtherChargeAccountRef.current = false;
            form.setValue("otherChargeAccountId", id);
          }
        }}
      >
        <div />
      </CreateExpenseAccountDialog>
      {/* Link Pay In dialog uses same pay-from account so only relevant in-vouchers are listed. */}
      {/* Open in-voucher picker only for Contra Out leg; Contra In uses outflow picker (payment_in-like behavior). */}
      {isLinkPaymentInDialogOpen && selectedContraLeg === 'out' && spendWiseInAccountId && (
        <LinkPaymentInToPaymentOutDialog
          isOpen={isLinkPaymentInDialogOpen}
          onOpenChange={setIsLinkPaymentInDialogOpen}
          // Same-account mapping: CNTR Out -> same account's Payment In/Direct Income/Contra In.
          accountId={spendWiseInAccountId}
          vouchers={allVouchers ?? []}
          selectedIds={linkedPaymentInIds}
          onConfirm={(ids) => setLinkedPaymentInIds([...new Set(ids)])}
          names={paymentInDialogNames}
          requiredAmount={amount}
          currentVoucherId={voucher?.id ?? savedVoucherId ?? undefined}
          currentVoucherLinkedAmounts={
            voucher?.linkedPaymentInAmounts && typeof voucher.linkedPaymentInAmounts === "object"
              ? voucher.linkedPaymentInAmounts
              : {}
          }
          // Show current contra row in Link Pay In dialog so layout mirrors Link Pay Out dialog.
          currentVoucherSummary={{
            voucherNumber: formVoucherNumber,
            date: formDate ? (formDate instanceof Date ? formDate : new Date(formDate)) : null,
            from: allProcessedAccounts?.find((a: any) => a.id === spendWiseInAccountId)?.accountName ?? "—",
            amount,
            linkedTotal: spendWiseFromCardTotalLinked,
          }}
          accountName={allProcessedAccounts?.find((a: any) => a.id === spendWiseInAccountId)?.accountName ?? undefined}
          accountOpeningBalance={spendWiseInAccountOpeningBalance}
        />
      )}
      {/* Bottom-right: Link Pay Out — always show same-account out vouchers of current contra leg. */}
      {/* Outflow picker is used by both right card and Contra In left-card behavior. */}
      {spendWiseOutAccountId && currentContraVoucherId && (
        <LinkPaymentOutToPaymentInDialog
          isOpen={isLinkPaymentOutDialogOpen}
          onOpenChange={setIsLinkPaymentOutDialogOpen}
          accountId={spendWiseOutAccountId}
          currentPaymentInId={currentContraVoucherId}
          vouchers={allVouchers ?? []}
          selectedIds={pendingLinkedPaymentOut ? pendingLinkedPaymentOut.ids : spendWiseLinkedToMeRows.map((r) => r.id)}
          names={paymentInDialogNames}
          requiredAmount={amount}
          accountName={allProcessedAccounts?.find((a: any) => a.id === spendWiseOutAccountId)?.accountName ?? undefined}
          accountOpeningBalance={spendWiseOutAccountOpeningBalance}
          currentVoucherLinkedAmounts={pendingLinkedPaymentOut ? pendingLinkedPaymentOut.amountsByVoucherId : Object.fromEntries(spendWiseLinkedToMeRows.map((r) => [r.id, r.linked]))}
          currentVoucherSummary={{ voucherNumber: formVoucherNumber, date: formDate ? (formDate instanceof Date ? formDate : new Date(formDate)) : null, from: allProcessedAccounts?.find((a: any) => a.id === currentContraAccountId)?.accountName ?? "—", amount, linkedTotal: lowerCardTotalLinked }}
          onConfirm={(selectedIds, amountsByVoucherId) => {
            setPendingLinkedPaymentOut({ ids: selectedIds, amountsByVoucherId });
            setIsLinkPaymentOutDialogOpen(false);
          }}
        />
      )}
      <LinkSectionInfoDialog open={linkSectionInfoOpen} onOpenChange={setLinkSectionInfoOpen} />
      <Dialog open={isAmountMoreThanAccountOpen} onOpenChange={setIsAmountMoreThanAccountOpen}>
        <DialogContent {...nestedVoucherAlertShell("max-w-md")}>
          <DialogHeader>
            <DialogTitle>Cannot save voucher</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Amount is more than selected account balance.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={duplicatePrompt != null} onOpenChange={(v) => { if (!v) setDuplicatePrompt(null); }}>
        <DialogContent {...nestedVoucherAlertShell("max-w-md")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <span aria-hidden>⚠</span> Possible duplicate voucher
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{duplicatePrompt?.match.summary}</p>
            <ul className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <li><span className="text-muted-foreground">Voucher: </span><b>{duplicatePrompt?.match.voucherNumber}</b></li>
              <li><span className="text-muted-foreground">Date: </span>{duplicatePrompt?.match.dateText}</li>
              <li><span className="text-muted-foreground">Amount: </span>{duplicatePrompt?.match.amount}</li>
              <li>
                <span className="text-muted-foreground">Matched on: </span>
                {(duplicatePrompt?.match.reasons ?? [])
                  .map((r) => (r === "file" ? "same file" : r === "ref" ? "same reference" : r === "fields" ? "same date + amount" : "same narration"))
                  .join(", ")}
              </li>
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => setDuplicatePrompt(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white"
                onClick={() => {
                  const go = duplicatePrompt?.proceed;
                  setDuplicatePrompt(null);
                  void go?.();
                }}
              >
                Save anyway
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <VoucherDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="contra"
        entityName={voucher?.voucherNumber || "this contra"}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
        busy={isLoading}
      />
    </>
  );
}
