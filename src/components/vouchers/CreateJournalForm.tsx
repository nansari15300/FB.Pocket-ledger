"use client";
import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useHealStaleTdsReverseLinks } from "@/hooks/useHealStaleTdsReverseLinks";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Resolver, useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
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
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Checkbox } from "../ui/checkbox";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";

import { CalendarIcon, Loader2, PlusCircle, Trash2, Printer, Upload, FileText, ArrowDownUp, Wand2, History, CheckCircle, Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfDay } from "date-fns";
import { toast as sonnerToast } from "sonner";
import { replaceVoucherSaveLoadingWithShortSuccess, beginVoucherSaveLoadingOrBlock, voucherSaveErrorToast, runWithVoucherLinkSaveProgress } from "@/lib/voucherSaveUi";

import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { useVouchers } from "@/hooks/useVouchers";
import {
  saveVoucher,
  isVoucherLimitError,
  patchVoucherFields,
  softDeleteVoucherMoveToRecycleBin,
  applyJournalBillWiseLinkAllocations,
  removeTdsLegLinks,
} from "@/lib/voucherActionsClient";
import {
  getVoucherConvertOriginalId,
  getVoucherEditConvertPresentation,
  isVoucherEditConverting,
  markVoucherConvertedInRecycleBin,
  resolveVoucherConvertSourceType,
} from "@/lib/voucherEditConvert";
import { VoucherEditConvertConfirmDialog } from "@/components/vouchers/VoucherEditConvertConfirmDialog";
import { useVoucherEditConvertSubmitGate } from "@/hooks/useVoucherEditConvertSubmitGate";
import { normalizePrefix } from "@/lib/voucherNumberFormat";
import { getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { loadVoucherDataForDeletePreCheck, resolveVoucherDeleteBackdateDate } from "@/lib/voucherDeletePreCheck";
import { preferLocalLedgerReads } from "@/lib/apkOnlineFirestoreWritePolicy";
import { findVoucherInLocalMirrorByNumberAndType } from "@/lib/localCompanyDocMirror";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import { sendTransactionAlert, isAmountOverOneLakh, getChangedFieldLabels } from "@/lib/transactionAlerts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResetLinkStateOnCopyTargetCompany } from "@/hooks/useResetLinkStateOnCopyTargetCompany";
import { useCopyDraftFirstSave } from "@/hooks/useCopyDraftFirstSave";

import { firestore, storage } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { getDocs, getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import type { Party } from "@/components/party/types";
import type { Account } from "@/components/bank-cash/types";
import type { Tax } from "@/components/tax/types";
import type { ExpenseAccount } from "@/components/expenses/types";
import type { Staff } from "@/components/staff/types";

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
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { VoucherPdfAsImageToggle } from "@/components/vouchers/VoucherPdfAsImageToggle";
import { shouldSuggestPdfAsImage } from "@/lib/voucherAttachmentPdfAsImage";
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  applyVoucherAttachmentsAfterFormSave,
  finalizeVoucherAttachmentsAfterFormSave,
  uploadVoucherAttachmentFileToFirebase,
  voucherAttachmentFieldsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import { useVoucherAttachmentPostSaveSync } from "@/hooks/useVoucherAttachmentPostSaveSync";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateExpenseAccountDialog } from "../expenses/CreateExpenseAccountDialog";
import {
  OTHER_CHARGE_ADD_NEW_LABELS,
  OTHER_CHARGE_ADD_NEW_VALUE_TO_TYPE,
} from "@/lib/otherChargeComboboxAddNew";
import { CreateTaxDialog } from "../tax/CreateTaxDialog";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { LinkPaymentInToSalaryDialog } from "@/components/vouchers/LinkPaymentInToSalaryDialog";
import { LinkPaymentOutToSalaryDialog } from "@/components/vouchers/LinkPaymentOutToSalaryDialog";
import usePermissions from "@/hooks/usePermissions";
import { useDeviceLimitContext } from "@/contexts/DeviceLimitContext";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";
import { loadJournalLedgerScopeSnapshot, type JournalScopedLedgerSnapshot } from "@/lib/journalLedgerScopeLoad";
import { getAllocationTotal, hasPaymentLinks, hasBillWiseAllocationSyncWork, OPENING_BALANCE_VOUCHER_ID, getAllocatedByVoucherId, getAllocatedByVoucherIdFromPaymentOuts, getJournalPartyBillWiseLinkAmount, getJournalPartyBillWiseAmountFromEntries, getPaymentOutPartyLinkAmount, inferJournalOtherChargePartyAccountId } from "@/lib/payment-allocation-utils";
import type { Allocation } from "@/lib/payment-allocation-utils";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_PC_DATE_ROW, VOUCHER_PC_DATE_BOTH_SLOT, VOUCHER_PC_DATE_BS_PILL, VOUCHER_PC_DATE_AD_PILL } from "@/components/vouchers/voucherButtonStyles";
/** Copy chip → parent ko journal row index bhejna hai — runtime import na ho isliye sirf types AddVoucherDialog se. */
import type { CopyMissingMasterOpts, CopyMasterDraftRequestPayload } from "@/components/vouchers/AddVoucherDialog";

// Entity filter: left of Account; All = show all, else filter account list by entity type
const ENTITY_OPTIONS = [
  { value: "", label: "All" },
  { value: "party", label: "Party" },
  { value: "staff", label: STAFF_ENTITY_LABEL },
  { value: "account", label: "Bank/Cash" },
  { value: "expense", label: "Expense" },
  { value: "tax", label: "Tax" },
] as const;

/** Account search empty: Entity=All → saare add-new; specific Entity → sirf us type ka ek option */
const JOURNAL_ADD_NEW_BY_ENTITY: Record<
  string,
  { value: string; label: string; createType: "party" | "staff" | "account" | "expense" | "tax" }
> = {
  party: { value: "add-new-party", label: "+ Add Party", createType: "party" },
  staff: { value: "add-new-staff", label: `+ Add ${STAFF_ENTITY_LABEL}`, createType: "staff" },
  account: { value: "add-new-account", label: "+ Add Bank/Cash", createType: "account" },
  expense: { value: "add-new-expense", label: "+ Add Expense Account", createType: "expense" },
  tax: { value: "add-new-tax", label: "+ Add Tax", createType: "tax" },
};
const ALL_JOURNAL_ADD_NEW_KEYS = ["party", "staff", "account", "expense", "tax"] as const;

function getJournalLineAddNewLabels(lineEntityType: string | undefined): { value: string; label: string }[] {
  const et = String(lineEntityType || "").trim();
  if (!et) {
    return ALL_JOURNAL_ADD_NEW_KEYS.map((k) => {
      const x = JOURNAL_ADD_NEW_BY_ENTITY[k];
      return { value: x.value, label: x.label };
    });
  }
  const one = JOURNAL_ADD_NEW_BY_ENTITY[et];
  return one ? [{ value: one.value, label: one.label }] : [];
}

const JOURNAL_ADD_NEW_VALUE_TO_TYPE: Record<string, "party" | "staff" | "account" | "expense" | "tax"> = {
  "add-new-party": "party",
  "add-new-staff": "staff",
  "add-new-account": "account",
  "add-new-expense": "expense",
  "add-new-tax": "tax",
};

const lineSchema = z.object({
  accountId: z.string().min(1, "Select an account"),
  entityType: z.string().optional(), // UI filter: party|staff|account|expense|tax; empty = show all
  type: z.enum(["debit", "credit"]),
  amount: z.coerce.number().min(0, "Amount must be positive."),
  isAutoLine: z.boolean().optional(),
});

const fileSchema = z.object({
  file: z.custom<File | null>().optional(),
});

const formSchema = z.object({
  voucherNumber: z.string().min(1, "Voucher number is required."),
  date: z.date({ message: "A date is required." }),
  narration: z.string().optional(),
  lines: z.array(lineSchema).min(2, "At least two lines are required for journal."),
  total: z.number().optional(),
  files: z.array(fileSchema).optional(),
  unassignedFile: z.any().optional(),
  otherChargeAccountId: z.string().optional(),
  otherChargeAmount: z.coerce.number().optional(),
  otherChargePartyAccountId: z.string().optional(),
}).superRefine((data, ctx) => {
  const chargeAmount = Number(data.otherChargeAmount || 0);
  if (chargeAmount > 0 && !String(data.otherChargeAccountId || "").trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select other charge account.", path: ["otherChargeAccountId"] });
  }
});

type JournalFormValues = z.infer<typeof formSchema>;

/** RHF+zod errors → toast (lines array errors generic message) */
function formatJournalFormValidationErrors(errors: FieldErrors<JournalFormValues>): string {
  const errorMessages: string[] = [];
  if (errors.voucherNumber?.message) errorMessages.push(`Voucher No.: ${errors.voucherNumber.message}`);
  if (errors.date?.message) errorMessages.push(`Date: ${errors.date.message}`);
  if (errors.lines?.message) errorMessages.push(`Lines: ${errors.lines.message}`);
  if (errors.narration?.message) errorMessages.push(`Narration: ${errors.narration.message}`);
  if (errors.total?.message) errorMessages.push(`Total: ${errors.total.message}`);
  return errorMessages.length > 0 ? errorMessages.join(", ") : "Please check all fields and try again.";
}

const getVoucherPrefix = (prefixes?: Record<string, string[]>) => (prefixes?.journal && prefixes.journal[0]) || "JRNL-";

function getInitialFormValues(voucher?: any): JournalFormValues {
    if (!voucher) {
        return {
            voucherNumber: "",
            date: startOfDay(new Date()),
            narration: "",
            lines: [
                { accountId: "", entityType: "", type: "debit" as const, amount: 0, isAutoLine: false },
                { accountId: "", entityType: "", type: "credit" as const, amount: 0, isAutoLine: true },
            ],
            total: 0,
            files: [],
            otherChargeAccountId: "",
            otherChargeAmount: 0,
            otherChargePartyAccountId: "",
        };
    }

    // Reconciliation sync draft `lines` bhejta hai; purane flows `entries` use karte hain
    const lines = (Array.isArray(voucher.lines) && voucher.lines.length > 0
        ? voucher.lines
        : (voucher.entries || []).map((entry: any, index: number) => ({
            accountId: entry.accountId,
            entityType: "",
            type: entry.debit > 0 ? "debit" : "credit",
            amount: entry.debit > 0 ? entry.debit : entry.credit,
            isAutoLine: index === (voucher.entries || []).length - 1,
          }))
    ).map((line: any, index: number, arr: any[]) => ({
        accountId: String(line?.accountId ?? ""),
        entityType: String(line?.entityType ?? ""),
        type: line?.type === "credit" ? "credit" as const : "debit" as const,
        amount: Number(line?.amount) || 0,
        isAutoLine: line?.isAutoLine ?? index === arr.length - 1,
    }));
    
    if (lines.length < 2) {
        lines.push({ accountId: "", entityType: "", type: "debit" as const, amount: 0, isAutoLine: false });
        lines.push({ accountId: "", entityType: "", type: "credit" as const, amount: 0, isAutoLine: true });
    }

    return {
        ...voucher,
        date: voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date),
        total: voucher.total || 0,
        files: [],
        lines: lines,
        otherChargeAccountId: voucher.otherChargeAccountId || "",
        otherChargeAmount: Number(voucher.otherChargeAmount || 0),
        otherChargePartyAccountId: voucher.otherChargePartyAccountId || "",
    };
}


function journalBankCashMasterSuffix(account: { accountType?: string | null }): "Bank" | "Cash" {
    return account.accountType === "Cash" ? "Cash" : "Bank";
}

function journalBankCashMasterLabel(account: { accountName?: string; name?: string; accountType?: string | null }): string {
    const name = account.accountName || account.name || "Account";
    return `${name} (${journalBankCashMasterSuffix(account)})`;
}


export function CreateJournalForm({
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
  /** When opening journal in edit mode, auto-select this side’s bill-wise card and blink the matching row (e.g. Dr row). Pass from ledger when user clicks Dr/Cr. */
  initialFocusSide,
  /** Party/staff/bank ledger entity id — bill-wise sirf is account ki Dr/Cr line (Firestore live doc me `_openedFromAccountId` nahi). */
  ledgerEntityId,
  /** Bill-wise ledger: opening row par remaining linkable — Journal link dialog/card me OB include karne ke liye. */
  ledgerOpeningBalanceOutstanding,
  /** Ledger books opening signed (Dr + / Cr −) — Journal link dialog me party master miss par fallback. */
  ledgerBooksOpeningBalanceSigned,
  /** Compare Side A/B: voucher jis company ka hai — header company se alag ho to account dropdown `useVouchers` se nahi banta. */
  ledgerScopeCompanyId,
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
  editingDisabled?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onApprove?: () => void;
  isApproving?: boolean;
  initialFocusSide?: "debit" | "credit" | null;
  ledgerEntityId?: string;
  ledgerOpeningBalanceOutstanding?: number;
  ledgerBooksOpeningBalanceSigned?: number;
  ledgerScopeCompanyId?: string;
  copySaveTargetCompanyId?: string;
  copyMismatchCategories?: string[];
  /** Copy chip: category ke saath journal line index — source voucher ki usi row ka master pick ho. */
  onCopyMissingCategory?: (category: string, opts?: CopyMissingMasterOpts) => void;
  isCopyingMissingMasters?: boolean;
  copyMasterDraftRequest?: CopyMasterDraftRequestPayload | null;
  onRefreshCopyMismatch?: () => void | Promise<void>;
  recurringVoucherSaveBlocked?: boolean;
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
  const { company: ctxCompany, companyId: ctxCompanyId, allCompanies } = useCompany();
  /** Cross-company compare / copy-draft: tab hi scoped snapshot — header company = selected company par useVouchers() kaafi hai. */
  const crossCompanyLedgerScope = useMemo(() => {
    const scopeId = String(copySaveTargetCompanyId?.trim() || ledgerScopeCompanyId?.trim() || "");
    const ctx = String(ctxCompanyId || "").trim();
    if (!scopeId) return false;
    if (copySaveTargetCompanyId?.trim()) return true;
    return scopeId !== ctx;
  }, [copySaveTargetCompanyId, ledgerScopeCompanyId, ctxCompanyId]);
  const forcedLedgerScopeCompanyId = useMemo(
    () => (crossCompanyLedgerScope ? String(copySaveTargetCompanyId?.trim() || ledgerScopeCompanyId?.trim() || "") : ""),
    [crossCompanyLedgerScope, copySaveTargetCompanyId, ledgerScopeCompanyId]
  );
  /** Save + numbering: Compare me jis company ka voucher edit ho raha hai (header company se alag ho sakta hai). */
  const effectiveCompanyId = useMemo(
    // Copy-draft target selected ho to voucher number/account scope usi company par fix karo.
    () => String(forcedLedgerScopeCompanyId || ctxCompanyId || ""),
    [forcedLedgerScopeCompanyId, ctxCompanyId]
  );
  const effectiveCompany = useMemo(() => {
    const sid = forcedLedgerScopeCompanyId;
    if (sid) return allCompanies.find((c) => c.id === sid) ?? ctxCompany ?? null;
    return ctxCompany ?? null;
  }, [forcedLedgerScopeCompanyId, allCompanies, ctxCompany]);
  const company = effectiveCompany;
  const companyId = effectiveCompanyId;

  const { dateSystem, formatDate, formatCurrencyForPrint } = useDate();
  const { can, role, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const { deviceLimitReached } = useDeviceLimitContext();
  const { vouchers, processedPartiesForSelection, processedStaff, processedAccounts, expenseAccounts, processedTaxes } = useVouchers();
  /** Header company ≠ compare company: Firestore/SQLite se usi company ki ledger lists. */
  const [scopedLedger, setScopedLedger] = useState<JournalScopedLedgerSnapshot | null>(null);
  useEffect(() => {
    const sid = forcedLedgerScopeCompanyId;
    if (!sid) {
      setScopedLedger(null);
      return;
    }
    // Copy-draft me sid===ctxCompanyId bhi ho sakta hai; tab bhi explicit snapshot load karke stale old-company lists avoid karo.
    let cancelled = false;
    void loadJournalLedgerScopeSnapshot(sid)
      .then((snap) => {
        if (!cancelled) setScopedLedger(snap);
      })
      .catch(() => {
        if (!cancelled) setScopedLedger(null);
      });
    return () => {
      cancelled = true;
    };
  }, [forcedLedgerScopeCompanyId]);
  /**
   * Copy-draft master save ke turant baad scoped ledger snapshot dubara fetch — naya party/account/tax dropdown me appear ho.
   * Bina iske form.setValue accountId set karta hai par allAccountsWithEntity me entry nahi hone se Combobox label nahi dikhata.
   */
  const refreshScopedLedger = useCallback(async () => {
    const sid = forcedLedgerScopeCompanyId;
    if (!sid) return;
    try {
      const snap = await loadJournalLedgerScopeSnapshot(sid);
      setScopedLedger(snap);
    } catch {
      /* ignore: race par form se manual select kar sakte hain */
    }
  }, [forcedLedgerScopeCompanyId]);

  // Compare / recon sync: scoped company lists load hone tak header company fallback mat dikhao (galat id → blank combobox)
  const useScopedLedgerLists = crossCompanyLedgerScope && Boolean(forcedLedgerScopeCompanyId);
  const pParties = useScopedLedgerLists
    ? (scopedLedger?.processedPartiesForSelection ?? [])
    : processedPartiesForSelection;
  const pStaff = useScopedLedgerLists
    ? (scopedLedger?.processedStaff ?? [])
    : processedStaff;
  const pAccounts = useScopedLedgerLists
    ? (scopedLedger?.processedAccounts ?? [])
    : processedAccounts;
  const pExpense = useScopedLedgerLists
    ? (scopedLedger?.expenseAccounts ?? [])
    : expenseAccounts;
  const pTaxes = useScopedLedgerLists
    ? (scopedLedger?.processedTaxes ?? [])
    : processedTaxes;

  const isMobile = useIsMobile();

  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const [isCreatePartyOpen, setIsCreatePartyOpen] = React.useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = React.useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = React.useState(false);
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = React.useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = React.useState(false);
  /** CreateTaxDialog prefillTaxName — document event tax form mein nahi sunta */
  const [journalTaxPrefillName, setJournalTaxPrefillName] = React.useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  useHealStaleTdsReverseLinks(companyId, voucher?.id, vouchers as any[]);
  const [files, setFiles] = useState<(File|string)[]>([]);
  /** Journal tiles: memo string URLs — FilePreview main effect unnecessary re-run kam. */
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
  /** Save ke baad stale parent `voucher.fileUrls` form overwrite na kare (delete+add fix). */
  const savedFileUrlsSnapshotRef = useRef<string[] | null>(null);
  // Track initial allocations when voucher loads so link/unlink changes are detected for isFormDirty.
  const initialJournalAllocationsRef = useRef<{ debit: Allocation[]; credit: Allocation[] }>({ debit: [], credit: [] });
  /** Incoming-only links user removed in bill-wise dialog (source voucher still points at this journal until save). */
  const journalIncomingLinksToClearRef = useRef<Set<string>>(new Set());
  /** Skip reset when same voucher updates (liveVoucher) and user has edits — fixes unlink → change fields → save. */
  const lastResetVoucherIdRef = useRef<string | null>(null);
  /** Edit hydrate complete — isDirty/file/allocation refs settle hone se pehle Save mat enable (exp jaisa). */
  const [editBaselineHydrated, setEditBaselineHydrated] = useState(() => !voucher?.id);
  const processAndSaveRef = useRef<((data: JournalFormValues, saveAndNew: boolean, approveAfterSave?: boolean) => Promise<void>) | null>(null);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  const [activeInput, setActiveInput] = React.useState<{ index: number, field: string } | null>(null);
  // Track which journal line requested "add new" so we can fill that exact row instead of appending extra rows.
  const [pendingCreateLineIndex, setPendingCreateLineIndex] = useState<number | null>(null);
  const pendingOtherChargeCreateRef = useRef(false);
  // Keep allocations per account/side so debit card (Pashupati) and credit card (Kanhaiya) stay independent.
  const [journalAllocationsBySide, setJournalAllocationsBySide] = useState<{ debit: Allocation[]; credit: Allocation[] }>({
    debit: [],
    credit: [],
  });
  // Track which side card is opening link dialog so debit/credit can use opposite-link behavior.
  const [activeJournalLinkSide, setActiveJournalLinkSide] = useState<"debit" | "credit" | null>(null);
  /** Selected bill-wise card for select feel; jis card pe click kiya usi ka related amount row blink kare. */
  const [selectedBillWiseCard, setSelectedBillWiseCard] = useState<"debit" | "credit" | null>(null);
  // Journal link cards hidden by default in add/new and non-linked edit; "Show Link" reveals them.
  const [showLinkSections, setShowLinkSections] = useState(false);
  const [otherChargeEnabled, setOtherChargeEnabled] = useState(
    Boolean(voucher?.otherChargeAccountId || Number(voucher?.otherChargeAmount || 0) > 0)
  );
  /** Tracks whether we already applied initial focus for current voucher so we don’t override user selection. */
  const initialFocusAppliedRef = useRef<string | null>(null);

  const resetLinksOnCopyTargetChange = useCallback(() => {
    setJournalAllocationsBySide({ debit: [], credit: [] });
    initialJournalAllocationsRef.current = { debit: [], credit: [] };
    journalIncomingLinksToClearRef.current.clear();
    setShowLinkSections(false);
    setSelectedBillWiseCard(null);
    setActiveJournalLinkSide(null);
  }, []);
  useResetLinkStateOnCopyTargetCompany(copySaveTargetCompanyId, resetLinksOnCopyTargetChange);
  const {
    resolveVoucherIdForSave,
    isPermissionEdit,
    markCopiedDraftPersisted,
    isCopiedDraftFirstInsert,
  } = useCopyDraftFirstSave(copySaveTargetCompanyId);

  // Sirf saved doc edit — sync/copy draft me `voucher` bina `id` ke aata hai; tab next voucher no auto fetch chahiye
  const isEditing = !!voucher?.id;
  /** Journal tab me `Add Salary` source aane par bhi convert treat karo taaki fresh journal number bane. */
  const isEditingAndConverting =
    isVoucherEditConverting(voucher, "journal") ||
    (Boolean(voucher?.id) &&
      String(voucher?.subType || "") === "add_salary" &&
      resolveVoucherConvertSourceType(voucher) !== "journal");
  const convertPresentation = useMemo(
    () => getVoucherEditConvertPresentation(voucher as Record<string, unknown> | undefined, "journal"),
    [voucher]
  );
  const {
    convertConfirmOpen,
    setConvertConfirmOpen,
    gateConvertSubmit,
    confirmConvertSubmit,
  } = useVoucherEditConvertSubmitGate(isEditingAndConverting);
  // Sync draft: voucher hai par id nahi — fields editable rehne chahiye (account + narration manually bhar sake)
  const isFormEditing = !voucher?.id || isEditing;

  const form = useForm<JournalFormValues>({
    resolver: zodResolver(formSchema) as Resolver<JournalFormValues>,
    defaultValues: getInitialFormValues(voucher),
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.journal(),
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((ctxCompany as { name?: string } | null)?.name) || null,
    companyId: ctxCompanyId,
    ownPan: ((ctxCompany as { pan?: string; panNumber?: string } | null)?.pan ?? (ctxCompany as { panNumber?: string } | null)?.panNumber) || null,
    parties: (processedPartiesForSelection || []) as never,
    items: [],
    taxes: (processedTaxes || []) as never,
    autoPost: () => void handleFormSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing: !!(voucher as { id?: string } | null | undefined)?.id,
    disabled: !!editingDisabled,
  });

  const { fields, remove, update } = useFieldArray({
    control: form.control,
    name: "lines",
  });

const { isDirty: _isFormFieldsDirty } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f: any) => typeof f === 'string') as string[];
    const newFiles    = files.filter((f: any) => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u: any, i: number) => u !== init[i]);
  })();
  const _isAllocationsDirty = (() => {
    const init = initialJournalAllocationsRef.current;
    const norm = (a: Allocation[]) => JSON.stringify((a || []).map((x) => ({ v: x.voucherId, a: x.amount, l: x.linkedAccountId, e: (x as any).entityTxnId ?? "" })).sort((p, q) => String(p.v).localeCompare(String(q.v))));
    return norm(journalAllocationsBySide.debit || []) !== norm(init.debit || []) || norm(journalAllocationsBySide.credit || []) !== norm(init.credit || []);
  })();
  const isFormDirtyRaw =
    _isFormFieldsDirty || _isFileDirty || _isAllocationsDirty || recurringVoucherAuxiliaryDirty;
  const isFormDirty = editBaselineHydrated && isFormDirtyRaw;
  
  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.journal ?? true;
  const isVoucherEditingAllowed = company?.allowVoucherNumberEditing?.journal ?? false;
  const isPrefixSelectionEnabled = company?.enableVoucherPrefixSelection?.journal ?? false;
  const voucherPrefixes = useMemo(() => company?.voucherPrefixes?.journal || [getVoucherPrefix(company?.voucherPrefixes as Record<string, string[]> | undefined)], [company]);

  const transactionDates = useMemo(() => {
    if (!vouchers?.length) return [];
    return vouchers.map((v) => {
      const d = v.date?.toDate ? v.date.toDate() : (v.date ? new Date(v.date) : null);
      return d && !isNaN(d.getTime()) ? startOfDay(d) : null;
    }).filter(Boolean) as Date[];
  }, [vouchers]);

  const fetchVoucherNumber = useCallback(async (selectedPrefix?: string) => {
    if (!companyId || !company || !isAutoVoucherEnabled) return;
    try {
      // Local company: SQLite vouchers se serial — Firestore-only par hamesha `JRNL - 001` reh jata tha.
      const nextNo = await getNextVoucherNumberForCompany({
        companyId,
        companyDoc: company as Record<string, unknown>,
        voucherLike: { type: "journal", subType: voucher?.subType },
        selectedPrefix,
        voucherDate: form.getValues("date"),
      });
      form.setValue("voucherNumber", nextNo);
    } catch (error) {
      console.error(error);
    }
  }, [companyId, company, form, isAutoVoucherEnabled, voucher?.subType]);

  // Journal line options: Party, Staff, Bank/Cash, Expense, Tax – label=full, nameOnly=for dropdown when entity selected & trigger display
  const allAccountsWithEntity = useMemo(() => {
    const parts: { value: string; label: string; nameOnly: string; balance?: number; entityType: string }[] = [];
    (pParties || []).forEach((p: any) => parts.push({ value: p.id, label: `${p.name} (Party)`, nameOnly: p.name, balance: p.balance, entityType: "party" }));
    (pStaff || []).forEach((s: any) => parts.push({ value: s.id, label: `${s.name} (Staff)`, nameOnly: s.name, balance: s.balance, entityType: "staff" }));
    (pAccounts || []).forEach((a: any) => parts.push({ value: a.id, label: journalBankCashMasterLabel(a), nameOnly: a.accountName || a.name || "Account", balance: a.balance, entityType: "account" }));
    (pExpense || []).forEach((a: any) => parts.push({ value: a.id, label: `${a.name || "Expense"} (Expense)`, nameOnly: a.name || "Expense", balance: (a as any).balance, entityType: "expense" }));
    (pTaxes || []).forEach((t: any) => parts.push({ value: t.id, label: `${t.name || "Tax"} (Tax)`, nameOnly: t.name || "Tax", balance: (t as any).balance, entityType: "tax" }));
    return parts.sort((a, b) => a.label.localeCompare(b.label));
  }, [pParties, pStaff, pAccounts, pExpense, pTaxes]);
  const allAccounts = useMemo(() => allAccountsWithEntity.map(({ value, label, balance }) => ({ value, label, balance })), [allAccountsWithEntity]);

  useEffect(() => {
    const NEW_JOURNAL = "__new_journal__";
    // Sirf saved journal (`voucher.id`) par poora form.reset; naya Add par lines mat chhedo — warna user ka account select mitt jata hai.
    if (voucher?.id) {
        const vid = voucher.id;
        const isSameVoucher = lastResetVoucherIdRef.current === vid;
        // Edit: har snapshot par reset se date/entries wipe — sirf `id` change par hydrate
        if (vid && isSameVoucher) return;
        setEditBaselineHydrated(false);
        if (vid) lastResetVoucherIdRef.current = vid;
        const initialValues = getInitialFormValues(voucher);
        if (isEditingAndConverting) {
            initialValues.voucherNumber = "";
        }
        form.reset(initialValues, { keepDirty: false, keepDirtyValues: false });
        // Derive entityType from accountId for each line (so Entity box shows correct value when account is pre-selected)
        const lines = initialValues.lines || [];
        lines.forEach((line: any, idx: number) => {
          const accId = String(line?.accountId ?? "");
          if (accId) {
            const acc = allAccountsWithEntity.find((a) => a.value === accId);
            if (acc?.entityType) {
              form.setValue(`lines.${idx}.entityType`, acc.entityType, { shouldDirty: false });
            }
          }
        });
        setSavedVoucherId(voucher.id);
        // Gallery / storage: `unassignedFile.url` bhi list me (sirf fileUrls tha to kabhi list khaali)
        const urlsEdit = voucherAttachmentUrlsForFormState(voucher);
        setFiles(urlsEdit);
        initialFilesRef.current = urlsEdit.filter((f: any) => typeof f === "string");
        setSavePdfAsImage(shouldSuggestPdfAsImage(urlsEdit));
        if (voucher.unassignedFile) {
          form.setValue("unassignedFile", voucher.unassignedFile);
        }
        // Reset local journal allocations when a different voucher opens in edit mode; split by linkedAccountId.
        const raw = Array.isArray((voucher as any)?.allocations) ? ((voucher as any).allocations as Allocation[]) : [];
        const entries = (voucher as any)?.entries ?? [];
        const debitAccIds = new Set((entries as any[]).filter((e: any) => (Number(e?.debit) || 0) > 0).map((e: any) => String(e?.accountId ?? "")));
        const creditAccIds = new Set((entries as any[]).filter((e: any) => (Number(e?.credit) || 0) > 0).map((e: any) => String(e?.accountId ?? "")));
        const debit: Allocation[] = [];
        const credit: Allocation[] = [];
        raw.forEach((a: any) => {
          const lid = String(a?.linkedAccountId ?? "");
          // TDS-leg link: linkedAccountId may be the TDS account (older saves); it belongs to the party side = opposite of the TDS entry.
          if (String(a?.entityTxnId ?? "").includes("::tds::") && lid && (debitAccIds.has(lid) || creditAccIds.has(lid))) {
            if (debitAccIds.has(lid) && !creditAccIds.has(lid)) credit.push(a);
            else debit.push(a);
          } else if (lid && debitAccIds.has(lid)) debit.push(a);
          else if (lid && creditAccIds.has(lid)) credit.push(a);
          else if (!lid) debit.push(a);
        });
        setJournalAllocationsBySide({ debit, credit });
        initialJournalAllocationsRef.current = { debit: [...debit], credit: [...credit] };
        journalIncomingLinksToClearRef.current.clear();
        if (Number((voucher as any)?.otherChargeAmount || 0) > 0 && !String((voucher as any)?.otherChargePartyAccountId ?? "").trim()) {
          const inferredParty = inferJournalOtherChargePartyAccountId(voucher);
          if (inferredParty) {
            form.setValue("otherChargePartyAccountId", inferredParty, { shouldDirty: false });
          }
        }
        setEditBaselineHydrated(true);
    } else if (voucher) {
        // Naya journal + Gallery `initialVoucherData`: pehle yahan files kabhi set nahi hoti thi; aur `isFormDirty` har baar allocations clear kar deta tha
        if (lastResetVoucherIdRef.current === NEW_JOURNAL && isFormDirty) return;
        const isFirstNewJournalHydrate = lastResetVoucherIdRef.current !== NEW_JOURNAL;
        lastResetVoucherIdRef.current = NEW_JOURNAL;
        if (isFirstNewJournalHydrate) {
          // Sync txn / gallery seed — lines + narration form me load (sirf defaultValues par depend mat karo)
          const initialValues = getInitialFormValues(voucher);
          form.reset(initialValues);
          // entityType set ho to combobox label turant dikhe; warna account list load ke baad niche wala effect
          (initialValues.lines || []).forEach((line: { accountId?: string; entityType?: string }, idx: number) => {
            const accId = String(line?.accountId ?? "");
            if (accId && line?.entityType) {
              form.setValue(`lines.${idx}.entityType`, line.entityType, { shouldDirty: false });
            }
          });
          setJournalAllocationsBySide({ debit: [], credit: [] });
          initialJournalAllocationsRef.current = { debit: [], credit: [] };
          journalIncomingLinksToClearRef.current.clear();
          const urlsNew = voucherAttachmentUrlsForFormState(voucher);
          setFiles(urlsNew);
          initialFilesRef.current = urlsNew.filter((f: any) => typeof f === "string");
          setSavePdfAsImage(shouldSuggestPdfAsImage(urlsNew));
          if (voucher.unassignedFile) {
            form.setValue("unassignedFile", voucher.unassignedFile, { shouldDirty: false });
          }
        }
    } else {
        lastResetVoucherIdRef.current = null;
        setJournalAllocationsBySide({ debit: [], credit: [] });
        initialJournalAllocationsRef.current = { debit: [], credit: [] };
        journalIncomingLinksToClearRef.current.clear();
    }
}, [voucher, form, isEditingAndConverting, isFormDirty, allAccountsWithEntity]);

  // Outbox flush / Firestore snapshot: `local:` → HTTPS parent `voucher.fileUrls` update; stale snapshot ignore.
  useVoucherAttachmentPostSaveSync({
    traceSource: "CreateJournalForm",
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

  /** Edit / seeded draft: masters load hone ke baad accountId se entityType sync (Entity dropdown "All" na rahe). */
  useEffect(() => {
    if (!voucher) return;
    const lines = form.getValues("lines") || [];
    lines.forEach((line: { accountId?: string; entityType?: string }, idx: number) => {
      const accId = String(line?.accountId ?? "").trim();
      if (!accId) return;
      const acc = allAccountsWithEntity.find((a) => String(a.value) === accId);
      if (!acc?.entityType) return;
      const curEntity = String(form.getValues(`lines.${idx}.entityType`) || "");
      if (curEntity !== acc.entityType) {
        form.setValue(`lines.${idx}.entityType`, acc.entityType, { shouldDirty: false });
      }
    });
  }, [allAccountsWithEntity, voucher, form]);

  useEffect(() => {
    if (!isEditing || isEditingAndConverting) {
      fetchVoucherNumber();
    }
  }, [isEditing, isEditingAndConverting, fetchVoucherNumber, company]);
  useEffect(() => {
    // Copy-draft naya journal (id-less) me target company switch par voucher number ko us company ke latest sequence se resync karo.
    if (!copySaveTargetCompanyId) return;
    if (voucher?.id) return;
    fetchVoucherNumber();
  }, [copySaveTargetCompanyId, voucher?.id, fetchVoucherNumber, isAutoVoucherEnabled]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(isEditing && savedVoucherId && !isEditingAndConverting),
    shouldFetchNextOnDateChange: Boolean((!isEditing || isEditingAndConverting) && isAutoVoucherEnabled),
    fetchVoucherNumber,
    resolvePrefix: () =>
      resolvePrefixFromVoucherNumber(
        String(form.getValues("voucherNumber") || ""),
        voucherPrefixes,
        voucherPrefixes[0]
      ),
  });

  // Keep a single label lookup so bill-wise card can show the exact account row user opened from.
  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (pParties || []).forEach((p: any) => map.set(String(p.id), `${p.name} (Party)`));
    (pStaff || []).forEach((s: any) => map.set(String(s.id), `${s.name} (Staff)`));
    (pAccounts || []).forEach((a: any) => map.set(String(a.id), journalBankCashMasterLabel(a)));
    (pExpense || []).forEach((a: any) => map.set(String(a.id), `${a.name || "Expense"} (Expense)`));
    (pTaxes || []).forEach((t: any) => map.set(String(t.id), `${t.name || "Tax"} (Tax)`));
    return map;
  }, [pParties, pStaff, pAccounts, pExpense, pTaxes]);
  // Ledger entity id: prop + row metadata — live Firestore sync `_openedFromAccountId` hata deta tha.
  const openedFromAccountId = String(
    ledgerEntityId || (voucher as any)?._openedFromAccountId || ""
  ).trim();
  // Ledger se OB remaining na aaye to master books opening se fallback — Book Opening link row ke liye.
  const effectiveLedgerObOutstanding = useMemo(() => {
    if (typeof ledgerOpeningBalanceOutstanding === "number") {
      return Math.max(0, ledgerOpeningBalanceOutstanding);
    }
    if (!openedFromAccountId) return undefined;
    const party = (pParties || []).find((p: any) => String(p.id) === openedFromAccountId);
    const staff = (pStaff || []).find((s: any) => String(s.id) === openedFromAccountId);
    const signed =
      typeof ledgerBooksOpeningBalanceSigned === "number"
        ? ledgerBooksOpeningBalanceSigned
        : Number((party as any)?.openingBalance ?? (staff as any)?.openingBalance ?? 0);
    if (Math.abs(signed) < 1e-6) return undefined;
    return Math.abs(signed);
  }, [ledgerOpeningBalanceOutstanding, openedFromAccountId, pParties, pStaff, ledgerBooksOpeningBalanceSigned]);

  // Watch current lines once so bill-wise summary card can react instantly to journal edits.
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const otherChargeAccountId = form.watch("otherChargeAccountId");
  const otherChargeAmountValue = Number(form.watch("otherChargeAmount")) || 0;
  const showJournalOtherCharge =
    otherChargeEnabled || Boolean(otherChargeAccountId) || otherChargeAmountValue > 0;
  const otherChargeAccountOptions = useMemo(() => {
    const rows = allAccountsWithEntity
      .filter((a) => a.entityType === "party" || a.entityType === "staff" || a.entityType === "expense")
      .map((a) => ({ value: a.value, label: a.label }));
    const selected = allAccountsWithEntity.find((a) => a.value === otherChargeAccountId);
    if (otherChargeAccountId && selected && !rows.some((r) => r.value === otherChargeAccountId)) {
      return [{ value: otherChargeAccountId, label: selected.label }, ...rows];
    }
    return rows;
  }, [allAccountsWithEntity, otherChargeAccountId]);
  /** Copy-draft: source account mismatch ho tab blank/invalid journal account lines par Copy chip dikhao. */
  const copyDraftAccountHelpersEnabled = Boolean(copySaveTargetCompanyId && onCopyMissingCategory);
  const hasSourceAccountMismatch = Boolean(
    // Journal account picker mixed entity masters consume karta hai; in categories me mismatch bhi account-copy signal hai.
    copyMismatchCategories?.includes("account") ||
      copyMismatchCategories?.includes("party") ||
      copyMismatchCategories?.includes("staff") ||
      copyMismatchCategories?.includes("tax") ||
      copyMismatchCategories?.includes("account_bank") ||
      copyMismatchCategories?.includes("account_expense")
  );
  const journalLineNeedsCopyAccount = useCallback(
    (index: number) => {
      if (!copyDraftAccountHelpersEnabled || !hasSourceAccountMismatch) return false;
      const selectedId = String(form.getValues(`lines.${index}.accountId`) || "");
      if (!selectedId) return true;
      return !allAccountsWithEntity.some((a) => String(a.value) === selectedId);
    },
    [copyDraftAccountHelpersEnabled, hasSourceAccountMismatch, form, allAccountsWithEntity]
  );
  // Build fast lookups so journal bill-wise can support both Party and Staff account rows.
  const partyIdSet = useMemo(
    () => new Set((pParties || []).map((p: any) => String(p.id))),
    [pParties]
  );
  // Staff should also be linkable from Journal bill-wise cards (same as user-requested payment flow behavior).
  const staffIdSet = useMemo(
    () => new Set((pStaff || []).map((s: any) => String(s.id))),
    [pStaff]
  );
  // Journal link source account can be either party or staff; keep one combined set for row detection.
  const journalLinkableAccountIdSet = useMemo(() => {
    const combined = new Set<string>();
    partyIdSet.forEach((id) => combined.add(id));
    staffIdSet.forEach((id) => combined.add(id));
    return combined;
  }, [partyIdSet, staffIdSet]);
  // Build dedicated bill-wise source lines for both sides so Debit and Credit can each have their own card.
  const journalBillLinesBySide = useMemo(() => {
    const lines = Array.isArray(watchedLines) ? watchedLines : [];
    const chargeCtx = {
      otherChargeAmount: otherChargeAmountValue,
      otherChargePartyAccountId: String(form.getValues("otherChargePartyAccountId") || ""),
      entries: lines.map((l: any) => ({
        accountId: l?.accountId,
        debit: l?.type === "debit" ? Number(l?.amount) || 0 : 0,
        credit: l?.type === "credit" ? Number(l?.amount) || 0 : 0,
      })),
    };
    const findForSide = (side: "debit" | "credit") => {
      // Ledger context: sirf opened party/staff ki usi side (Dr/Cr) — doosre account par fallback mat karo.
      if (openedFromAccountId) {
        const openedLine = lines.find(
          (l: any) =>
            String(l?.accountId ?? "") === openedFromAccountId &&
            String(l?.type ?? "") === side &&
            journalLinkableAccountIdSet.has(String(l?.accountId ?? "")) &&
            (Number(l?.amount) || 0) > 0
        );
        if (!openedLine) return null;
        const rawAmount = Number(openedLine.amount) || 0;
        return {
          partyId: String(openedLine.accountId),
          amount: getJournalPartyBillWiseLinkAmount(chargeCtx, String(openedLine.accountId), rawAmount),
        };
      }
      const line = lines.find(
        (l: any) =>
          String(l?.type ?? "") === side &&
          journalLinkableAccountIdSet.has(String(l?.accountId ?? "")) &&
          (Number(l?.amount) || 0) > 0
      );
      if (!line) return null;
      const rawAmount = Number(line.amount) || 0;
      return {
        partyId: String(line.accountId),
        amount: getJournalPartyBillWiseLinkAmount(chargeCtx, String(line.accountId), rawAmount),
      };
    };
    return {
      debit: findForSide("debit"),
      credit: findForSide("credit"),
    };
  }, [watchedLines, journalLinkableAccountIdSet, openedFromAccountId, otherChargeAmountValue, form]);

  useEffect(() => {
    if (!showJournalOtherCharge) {
      form.setValue("otherChargePartyAccountId", "", { shouldDirty: true });
      return;
    }
    const partyForCharge =
      journalBillLinesBySide.debit?.partyId ||
      journalBillLinesBySide.credit?.partyId ||
      "";
    if (partyForCharge) {
      form.setValue("otherChargePartyAccountId", partyForCharge, { shouldDirty: true });
    }
  }, [
    showJournalOtherCharge,
    journalBillLinesBySide.debit?.partyId,
    journalBillLinesBySide.credit?.partyId,
    form,
  ]);

  // In edit mode: auto-select Dr card (and blink Dr row) or Cr card when opening journal; once per voucher.
  useEffect(() => {
    const vid = voucher?.id;
    if (!vid || voucher?.type !== "journal") {
      initialFocusAppliedRef.current = null;
      return;
    }
    if (initialFocusAppliedRef.current === vid) return;
    const lines = Array.isArray(watchedLines) ? watchedLines : [];
    const hasDebitLine = lines.some((l: any) => String(l?.type) === "debit" && journalLinkableAccountIdSet.has(String(l?.accountId ?? "")) && (Number(l?.amount) || 0) > 0);
    const hasCreditLine = lines.some((l: any) => String(l?.type) === "credit" && journalLinkableAccountIdSet.has(String(l?.accountId ?? "")) && (Number(l?.amount) || 0) > 0);
    const openedEntityLine = openedFromAccountId
      ? lines.find(
          (l: any) =>
            String(l?.accountId ?? "") === openedFromAccountId &&
            journalLinkableAccountIdSet.has(String(l?.accountId ?? "")) &&
            (Number(l?.amount) || 0) > 0
        )
      : null;
    const side: "debit" | "credit" =
      initialFocusSide ??
      (openedEntityLine
        ? String(openedEntityLine.type) === "credit"
          ? "credit"
          : "debit"
        : "debit");
    if (side === "debit" && hasDebitLine) {
      setSelectedBillWiseCard("debit");
      initialFocusAppliedRef.current = vid;
    } else if (side === "credit" && hasCreditLine) {
      setSelectedBillWiseCard("credit");
      initialFocusAppliedRef.current = vid;
    } else if (hasDebitLine) {
      setSelectedBillWiseCard("debit");
      initialFocusAppliedRef.current = vid;
    } else if (hasCreditLine) {
      setSelectedBillWiseCard("credit");
      initialFocusAppliedRef.current = vid;
    }
  }, [voucher?.id, voucher?.type, watchedLines, initialFocusSide, openedFromAccountId, journalLinkableAccountIdSet]);

  /** Row index that should blink when a bill-wise card is selected (matching type + accountId). */
  const selectedCardRelatedRowIndex = useMemo(() => {
    if (!selectedBillWiseCard) return null;
    const lines = Array.isArray(watchedLines) ? watchedLines : [];
    const partyId = journalBillLinesBySide[selectedBillWiseCard]?.partyId ?? "";
    if (!partyId) return null;
    const idx = lines.findIndex((l: any) => String(l?.type ?? "") === selectedBillWiseCard && String(l?.accountId ?? "") === partyId);
    return idx >= 0 ? idx : null;
  }, [selectedBillWiseCard, watchedLines, journalBillLinesBySide]);
  // Highlight both related party rows so each bill-wise card has a clear matching source row in journal lines.
  const linkedPartyLineIndices = useMemo(() => {
    const lines = Array.isArray(watchedLines) ? watchedLines : [];
    const ids = [
      String(journalBillLinesBySide.debit?.partyId ?? ""),
      String(journalBillLinesBySide.credit?.partyId ?? ""),
    ].filter(Boolean);
    return new Set(
      lines
        .map((l: any, idx: number) => (ids.includes(String(l?.accountId ?? "")) ? idx : -1))
        .filter((idx: number) => idx >= 0)
    );
  }, [watchedLines, journalBillLinesBySide.debit?.partyId, journalBillLinesBySide.credit?.partyId]);
  // Use persisted voucher id when available so the card can show server-linked allocations.
  const journalVoucherId = (savedVoucherId || voucher?.id || "") as string;
  // Resolve current voucher snapshot from live list (fallback to prop voucher while editing).
  const currentJournalVoucher = useMemo(() => {
    if (!journalVoucherId) return voucher || null;
    return (vouchers || []).find((v: any) => String(v?.id ?? "") === String(journalVoucherId)) || voucher || null;
  }, [journalVoucherId, vouchers, voucher]);
  // Incoming links = other vouchers allocating to this journal (status "from").
  const journalLinkedFromRows = useMemo(() => {
    if (!journalVoucherId || !vouchers?.length) return [] as Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number; sourceType: string }>;
    const rows: Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number; sourceType: string }> = [];
    (vouchers as any[]).forEach((v) => {
      if (!v || String(v.id ?? "") === String(journalVoucherId)) return;
      const allocs = (v.allocations as any[] | undefined) || [];
      const linkedAmount = allocs
        .filter((a: any) => String(a?.voucherId ?? "") === String(journalVoucherId))
        .reduce((sum: number, a: any) => sum + getAllocationTotal(a), 0);
      if (linkedAmount <= 0) return;
      const rawDate = (v as any)?.date;
      const parsedDate =
        rawDate && typeof rawDate?.toDate === "function"
          ? rawDate.toDate()
          : rawDate
            ? new Date(rawDate)
            : null;
      rows.push({
        voucherId: String(v.id ?? ""),
        voucherNumber: String(v.voucherNumber ?? v.voucher_number ?? "—"),
        amount: linkedAmount,
        date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
        total: Number((v as any)?.total ?? (v as any)?.amount ?? 0) || 0,
        sourceType: String((v as any)?.type ?? ""),
      });
    });
    return rows;
  }, [journalVoucherId, vouchers]);
  // Merged allocations for save payload; each allocation carries linkedAccountId for per-side restore on load.
  const effectiveJournalAllocations = useMemo(
    () => [...(journalAllocationsBySide.debit || []), ...(journalAllocationsBySide.credit || [])],
    [journalAllocationsBySide]
  );
  // Per-side outgoing rows so debit card shows only Pashupati links, credit card only Kanhaiya links.
  const journalLinkedToRowsBySide = useMemo(() => {
    const buildRows = (allocs: Allocation[]) => {
      const list = Array.isArray(allocs) ? allocs : [];
      if (!list.length) return [] as Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number }>;
      return list
        .filter((a: any) => Number(a?.amount) > 0)
        .map((a: any) => {
          if (String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID) {
            return {
              voucherId: OPENING_BALANCE_VOUCHER_ID,
              voucherNumber: "Opening Balance",
              amount: getAllocationTotal(a),
              date: null,
              total: 0,
            };
          }
          const target = (vouchers || []).find((v: any) => String(v?.id ?? "") === String(a?.voucherId ?? ""));
          const rawDate = (target as any)?.date;
          const parsedDate =
            rawDate && typeof rawDate?.toDate === "function"
              ? rawDate.toDate()
              : rawDate
                ? new Date(rawDate)
                : null;
          return {
            voucherId: String(a?.voucherId ?? ""),
            voucherNumber: String(target?.voucherNumber ?? target?.voucher_number ?? "—"),
            amount: getAllocationTotal(a),
            date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
            total: Number((target as any)?.total ?? (target as any)?.amount ?? 0) || 0,
          };
        });
    };
    return {
      debit: buildRows(journalAllocationsBySide.debit || []),
      credit: buildRows(journalAllocationsBySide.credit || []),
    };
  }, [journalAllocationsBySide, vouchers]);
  // Legacy: flat journalLinkedToRows for any code that still expects it (e.g. journalLinkedOnOthersByVoucherId uses allocs, not rows).
  const journalLinkedToRows = useMemo(() => {
    const allocs = effectiveJournalAllocations as any[];
    if (!allocs.length) return [] as Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number }>;
    return allocs
      .filter((a: any) => Number(a?.amount) > 0)
      .map((a: any) => {
        if (String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID) {
          return {
            voucherId: OPENING_BALANCE_VOUCHER_ID,
            voucherNumber: "Opening Balance",
            amount: getAllocationTotal(a),
            date: null,
            total: 0,
          };
        }
        const target = (vouchers || []).find((v: any) => String(v?.id ?? "") === String(a?.voucherId ?? ""));
        const rawDate = (target as any)?.date;
        const parsedDate =
          rawDate && typeof rawDate?.toDate === "function"
            ? rawDate.toDate()
            : rawDate
              ? new Date(rawDate)
              : null;
        return {
          voucherId: String(a?.voucherId ?? ""),
          voucherNumber: String(target?.voucherNumber ?? target?.voucher_number ?? "—"),
          amount: getAllocationTotal(a),
          date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
          total: Number((target as any)?.total ?? (target as any)?.amount ?? 0) || 0,
        };
      });
  }, [effectiveJournalAllocations, vouchers]);
  // For each row target, show how much already linked by other vouchers (excluding current journal) like payment forms.
  const journalLinkedOnOthersByVoucherId = useMemo(() => {
    const m = new Map<string, number>();
    if (!vouchers?.length) return m;
    (vouchers as any[]).forEach((v) => {
      if (!v || String(v?.id ?? "") === String(journalVoucherId)) return;
      const allocs = (v.allocations as any[] | undefined) || [];
      allocs.forEach((a: any) => {
        const key = String(a?.voucherId ?? "");
        if (!key || key === OPENING_BALANCE_VOUCHER_ID) return;
        m.set(key, (m.get(key) ?? 0) + getAllocationTotal(a));
      });
    });
    return m;
  }, [vouchers, journalVoucherId]);
  // Build side-wise card data so Debit/Credit each get independent bill-wise rows and balances.
  const journalBillWiseBySide = useMemo(() => {
    const getJournalPartyAmount = (voucher: any, accountId: string) =>
      getJournalPartyBillWiseAmountFromEntries(voucher, accountId);
    const debitSourceTypes = new Set(["payment_in", "direct_income"]);
    const creditSourceTypes = new Set(["payment_out", "direct_expense"]);
    const voucherTouchesAccount = (voucherId: string, accountId: string) => {
      const target = (vouchers || []).find((v: any) => String(v?.id ?? "") === String(voucherId));
      if (!target || !accountId) return false;
      return (
        String((target as any)?.partyId ?? "") === String(accountId) ||
        String((target as any)?.staffId ?? "") === String(accountId) ||
        (Array.isArray((target as any)?.entries) &&
          (target as any).entries.some((e: any) => String(e?.accountId ?? "") === String(accountId)))
      );
    };
    const buildSide = (side: "debit" | "credit") => {
      const sideLine = journalBillLinesBySide[side];
      const accountId = String(sideLine?.partyId ?? "");
      const existingAllocations = (journalAllocationsBySide[side] || []) as Allocation[];
      const currentVoucherIdStr = String(journalVoucherId ?? "");
      const isCurrentVoucher = (v: any) => currentVoucherIdStr && String((v as any)?.id ?? "") === currentVoucherIdStr;
      const voucherTouchesAccountFn = (v: any) =>
        String((v as any)?.partyId ?? "") === accountId ||
        String((v as any)?.staffId ?? "") === accountId ||
        (Array.isArray((v as any)?.entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? "") === accountId));
      const hasExistingAlloc = (id: string) => existingAllocations.some((a) => a.voucherId === id && getAllocationTotal(a) > 0);

      // Opening balance: isi link account (partyId) ka master books opening — dialog jaisa seedha lookup.
      const getOpeningBalance = () => {
        if (!accountId) return 0;
        if (
          openedFromAccountId &&
          String(accountId) === String(openedFromAccountId) &&
          typeof ledgerBooksOpeningBalanceSigned === "number" &&
          Math.abs(ledgerBooksOpeningBalanceSigned) > 1e-6
        ) {
          return ledgerBooksOpeningBalanceSigned;
        }
        if (partyIdSet.has(accountId)) {
          const p = (pParties || []).find((p: any) => String(p.id) === accountId);
          return Number((p as any)?.openingBalance ?? 0);
        }
        if (staffIdSet.has(accountId)) {
          const s = (pStaff || []).find((s: any) => String(s.id) === accountId);
          return Number((s as any)?.openingBalance ?? 0);
        }
        return 0;
      };
      const partyOB = getOpeningBalance();
      const showOBInPaymentIn = partyOB > 0;
      const showOBInPaymentOut = partyOB < 0;
      const obAmount = partyOB > 0 ? partyOB : Math.abs(partyOB);
      // Bill-wise / books OB remaining — card preview me Book Opening row (Dr→Cr / Cr→Dr) ke liye.
      const billWiseObRemaining =
        typeof effectiveLedgerObOutstanding === "number" ? effectiveLedgerObOutstanding : null;
      // totalConsumedFromOB: allocations to OB from payments + sale/purchase openingBalanceAllocated.
      const totalConsumedFromOB = (() => {
        if (!accountId || !vouchers?.length) return 0;
        const payType = side === "credit" ? ["payment_in", "direct_income"] : ["payment_out", "direct_expense"];
        let fromPayments = 0;
        (vouchers as any[]).forEach((v) => {
          if (!payType.includes(v.type)) return;
          if (!voucherTouchesAccountFn(v)) return;
          const allocs = (v.allocations as any[] | undefined) || [];
          allocs.forEach((a: any) => {
            if (String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID) fromPayments += getAllocationTotal(a);
          });
        });
        const fromBillwise = (vouchers as any[]).reduce((sum, v) => {
          if (v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service") return sum;
          if (!voucherTouchesAccountFn(v)) return sum;
          return sum + (Number((v as any).openingBalanceAllocated) || 0);
        }, 0);
        return fromPayments + fromBillwise;
      })();
      const obOutstandingIn = Math.max(0, obAmount - totalConsumedFromOB);
      const shouldIncludeObRow = (paymentSide: "payment_in" | "payment_out") => {
        if (hasExistingAlloc(OPENING_BALANCE_VOUCHER_ID)) return true;
        const remaining =
          billWiseObRemaining != null && billWiseObRemaining > 0
            ? billWiseObRemaining
            : obOutstandingIn;
        if (remaining <= 0) return false;
        if (paymentSide === "payment_out") {
          return partyOB < 0 || partyOB === 0;
        }
        return partyOB > 0 || partyOB === 0;
      };
      // Card preview Amount: gross books OB — sirf remaining (obAmount) 0 ho to bhi bill-wise gross dikhao.
      const obGrossTotalForDisplay =
        obAmount > 0
          ? obAmount
          : Math.max(
              billWiseObRemaining != null ? billWiseObRemaining + totalConsumedFromOB : 0,
              obOutstandingIn + totalConsumedFromOB,
              billWiseObRemaining ?? 0
            );
      const showOB = side === "credit" ? showOBInPaymentIn : showOBInPaymentOut;
      const obOutstanding = showOB ? obOutstandingIn : 0;

      const sourceTypes = side === "debit" ? debitSourceTypes : creditSourceTypes;
      const voucherMatchesJournalSide = (voucherId: string) => {
        const target = (vouchers || []).find((v: any) => String(v?.id ?? "") === String(voucherId));
        if (!target || target.type !== "journal" || !sideLine?.partyId) return false;
        const accountEntry = Array.isArray((target as any)?.entries)
          ? (target as any).entries.find((e: any) => String(e?.accountId ?? "") === String(sideLine.partyId))
          : null;
        if (!accountEntry) return false;
        return side === "debit" ? (Number(accountEntry.debit) || 0) > 0 : (Number(accountEntry.credit) || 0) > 0;
      };
      const filteredIncoming = journalLinkedFromRows.filter((row) =>
        (
          sourceTypes.has(String(row.sourceType || "").toLowerCase()) ||
          String(row.sourceType || "").toLowerCase() === "journal"
        ) &&
        voucherTouchesAccount(row.voucherId, accountId) &&
        (String(row.sourceType || "").toLowerCase() !== "journal" || voucherMatchesJournalSide(row.voucherId))
      );
      const map = new Map<string, { voucherId: string; voucherNumber: string; date: Date | null; total: number; linkedOnCurrent: number }>();
      [...filteredIncoming, ...journalLinkedToRowsBySide[side]].forEach((row) => {
        const key = String(row.voucherId);
        const prev = map.get(key);
        if (prev) {
          prev.linkedOnCurrent += Number(row.amount) || 0;
          if (!prev.date && row.date) prev.date = row.date;
          if (!prev.total && row.total) prev.total = row.total;
        } else {
          map.set(key, {
            voucherId: key,
            voucherNumber: row.voucherNumber,
            date: row.date ?? null,
            total: Number(row.total) || 0,
            linkedOnCurrent: Number(row.amount) || 0,
          });
        }
      });

      // Add linkable vouchers (same logic as LinkPaymentToTxnsDialog) so card shows voucher numbers.
      // Debit card links to Cr -> combinedOutList (purchase, payment_in, journal Cr, OB).
      // Credit card links to Dr -> combinedInList (sale, payment_out, journal Dr, OB).
      if (accountId && vouchers?.length) {
        const payInVouchers = (vouchers as any[]).filter(
          (v) => (v.type === "payment_in" || v.type === "direct_income") && !isCurrentVoucher(v)
        );
        const payOutVouchers = (vouchers as any[]).filter(
          (v) => (v.type === "payment_out" || v.type === "direct_expense") && !isCurrentVoucher(v)
        );
        const allocatedByPaymentIns = getAllocatedByVoucherId(payInVouchers);
        const allocatedByPaymentOuts = getAllocatedByVoucherIdFromPaymentOuts(payOutVouchers);
        const allocatedByBillWiseVouchers = (() => {
          const m = new Map<string, number>();
          for (const v of vouchers as any[]) {
            if (isCurrentVoucher(v)) continue;
            if (
              v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service" && v.type !== "journal" && v.type !== "inter_company"
            ) continue;
            const allocations = (v.allocations as Allocation[] | undefined) || [];
            for (const a of allocations) {
              if (!a.voucherId) continue;
              m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
            }
          }
          return m;
        })();
        const totalAllocatedTo = (vid: string) => (allocatedByPaymentIns.get(vid) ?? 0) + (allocatedByBillWiseVouchers.get(vid) ?? 0);
        const totalAllocatedToOut = (vid: string) => (allocatedByPaymentOuts.get(vid) ?? 0) + (allocatedByBillWiseVouchers.get(vid) ?? 0);
        // Other Linked: max(target allocations, sourceSum) + openingBalanceAllocated (Purchase/Sale link to OB via this).
        const getAllocatedToOthersFromTarget = (targetVoucher: any, vid: string): number => {
          const allocs = (targetVoucher?.allocations as Allocation[] | undefined) || [];
          const fromAllocs = allocs.reduce((sum, a) => {
            if (!a.voucherId || String(a.voucherId) === currentVoucherIdStr) return sum;
            if (accountId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== accountId) return sum;
            return sum + getAllocationTotal(a);
          }, 0);
          const sourceSum = side === "credit" ? totalAllocatedTo(vid) : totalAllocatedToOut(vid);
          const obInAllocs = allocs
            .filter((a) => String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID)
            .reduce((s, a) => s + getAllocationTotal(a), 0);
          const targetObAlloc = Math.max(0, (Number(targetVoucher?.openingBalanceAllocated) || 0) - obInAllocs);
          return Math.max(fromAllocs, sourceSum) + targetObAlloc;
        };
        const safeToDate = (d: unknown): Date | null => {
          if (!d) return null;
          if (d instanceof Date) return d;
          if (typeof (d as { toDate?: () => Date })?.toDate === "function") return (d as { toDate: () => Date }).toDate();
          const p = new Date(d as string | number);
          return isNaN(p.getTime()) ? null : p;
        };

        if (side === "credit") {
          // combinedInList: sale, payment_out, journal Dr, OB (Dr)
          const salesForParty = (vouchers as any[]).filter(
            (v) => !isCurrentVoucher(v) && (v.type === "sale" || v.type === "sale_service") && voucherTouchesAccountFn(v)
          );
          const linkedOnCurrentFor = (vid: string) =>
            existingAllocations.filter((a) => a.voucherId === vid).reduce((s, a) => s + getAllocationTotal(a), 0);
          salesForParty.forEach((v) => {
            const total = Number(v.total ?? v.amount ?? 0);
            const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
            const outstanding = Math.max(0, total - allocatedToOthers);
            if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
            const key = String(v.id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).invoiceNumber ?? (v as any).voucherNumber ?? "—"),
                date: safeToDate(v.date),
                total,
                linkedOnCurrent: linkedOnCurrentFor(v.id),
              });
            }
          });
          const paymentOutsForParty = (vouchers as any[]).filter(
            (v) => !isCurrentVoucher(v) && (v.type === "payment_out" || v.type === "direct_expense") && voucherTouchesAccountFn(v)
          );
          paymentOutsForParty.forEach((v) => {
            const total = getPaymentOutPartyLinkAmount(v);
            const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
            const outstanding = Math.max(0, total - allocatedToOthers);
            if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
            const key = String(v.id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).voucherNumber ?? "—"),
                date: safeToDate(v.date),
                total,
                linkedOnCurrent: linkedOnCurrentFor(v.id),
              });
            }
          });
          const journalDrRows = (vouchers as any[])
            .filter((v) => !isCurrentVoucher(v) && v.type === "journal" && voucherTouchesAccountFn(v))
            .map((v) => {
              const partyAmount = getJournalPartyAmount(v, accountId);
              if (!partyAmount || partyAmount.debit <= 0) return null;
              const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
              const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
              if (outstanding <= 0 && !hasExistingAlloc(v.id)) return null;
              return { v, id: v.id, total: partyAmount.total, date: v.date };
            })
            .filter((r): r is NonNullable<typeof r> => !!r);
          journalDrRows.forEach(({ v, id, total, date }) => {
            const key = String(id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).voucherNumber ?? "—"),
                date: safeToDate(date),
                total,
                linkedOnCurrent: linkedOnCurrentFor(id),
              });
            }
          });
          const icEntityCtx =
            staffIdSet.has(accountId) ? ("staff" as const) : ("party" as const);
          (vouchers as any[])
            .filter((v) => !isCurrentVoucher(v) && v.type === "inter_company")
            .forEach((v) => {
              const partyAmount = getInterCompanyEntityBillWiseAmount(v, accountId, icEntityCtx);
              if (!partyAmount || partyAmount.debit <= 0) return;
              const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
              const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
              if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
              const key = String(v.id);
              if (!map.has(key)) {
                map.set(key, {
                  voucherId: key,
                  voucherNumber: String((v as any).voucherNumber ?? "—"),
                  date: safeToDate(v.date),
                  total: partyAmount.total,
                  linkedOnCurrent: linkedOnCurrentFor(v.id),
                });
              }
            });
          if (shouldIncludeObRow("payment_in")) {
            const key = OPENING_BALANCE_VOUCHER_ID;
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: "Book Opening",
                date: null,
                total: obGrossTotalForDisplay,
                linkedOnCurrent: linkedOnCurrentFor(key),
              });
            }
          }
        } else {
          // combinedOutList: purchase, payment_in, journal Cr, OB (Cr)
          const linkedOnCurrentForOut = (vid: string) =>
            existingAllocations.filter((a) => a.voucherId === vid).reduce((s, a) => s + getAllocationTotal(a), 0);
          const purchasesForParty = (vouchers as any[]).filter(
            (v) => !isCurrentVoucher(v) && (v.type === "purchase" || v.type === "purchase_service") && voucherTouchesAccountFn(v)
          );
          purchasesForParty.forEach((v) => {
            const total = Number(v.total ?? v.amount ?? 0);
            const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
            const outstanding = Math.max(0, total - allocatedToOthers);
            if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
            const key = String(v.id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).invoiceNumber ?? (v as any).voucherNumber ?? "—"),
                date: safeToDate(v.date),
                total,
                linkedOnCurrent: linkedOnCurrentForOut(v.id),
              });
            }
          });
          const paymentInsForParty = (vouchers as any[]).filter(
            (v) => !isCurrentVoucher(v) && (v.type === "payment_in" || v.type === "direct_income") && voucherTouchesAccountFn(v)
          );
          paymentInsForParty.forEach((v) => {
            const total = Number((v as any).amount ?? (v as any).total ?? 0) || 0;
            const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
            const outstanding = Math.max(0, total - allocatedToOthers);
            if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
            const key = String(v.id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).voucherNumber ?? "—"),
                date: safeToDate(v.date),
                total,
                linkedOnCurrent: linkedOnCurrentForOut(v.id),
              });
            }
          });
          const journalCrRows = (vouchers as any[])
            .filter((v) => !isCurrentVoucher(v) && v.type === "journal" && voucherTouchesAccountFn(v))
            .map((v) => {
              const partyAmount = getJournalPartyAmount(v, accountId);
              if (!partyAmount || partyAmount.credit <= 0) return null;
              const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
              const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
              if (outstanding <= 0 && !hasExistingAlloc(v.id)) return null;
              return { v, id: v.id, total: partyAmount.total, date: v.date };
            })
            .filter((r): r is NonNullable<typeof r> => !!r);
          journalCrRows.forEach(({ v, id, total, date }) => {
            const key = String(id);
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: String((v as any).voucherNumber ?? "—"),
                date: safeToDate(date),
                total,
                linkedOnCurrent: linkedOnCurrentForOut(id),
              });
            }
          });
          const icEntityCtxOut =
            staffIdSet.has(accountId) ? ("staff" as const) : ("party" as const);
          (vouchers as any[])
            .filter((v) => !isCurrentVoucher(v) && v.type === "inter_company")
            .forEach((v) => {
              const partyAmount = getInterCompanyEntityBillWiseAmount(v, accountId, icEntityCtxOut);
              if (!partyAmount || partyAmount.credit <= 0) return;
              const allocatedToOthers = getAllocatedToOthersFromTarget(v, v.id);
              const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
              if (outstanding <= 0 && !hasExistingAlloc(v.id)) return;
              const key = String(v.id);
              if (!map.has(key)) {
                map.set(key, {
                  voucherId: key,
                  voucherNumber: String((v as any).voucherNumber ?? "—"),
                  date: safeToDate(v.date),
                  total: partyAmount.total,
                  linkedOnCurrent: linkedOnCurrentForOut(v.id),
                });
              }
            });
          if (shouldIncludeObRow("payment_out")) {
            const key = OPENING_BALANCE_VOUCHER_ID;
            if (!map.has(key)) {
              map.set(key, {
                voucherId: key,
                voucherNumber: "Book Opening",
                date: null,
                total: obGrossTotalForDisplay,
                linkedOnCurrent: linkedOnCurrentForOut(key),
              });
            }
          }
        }
      }

      const rows = Array.from(map.values()).sort((a, b) => {
        const dA = a.date ? new Date(a.date).getTime() : 0;
        const dB = b.date ? new Date(b.date).getTime() : 0;
        return dA - dB;
      });
      const linkedFromTotal = filteredIncoming.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      const linkedToTotal = (journalLinkedToRowsBySide[side] || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const linkableRemaining = Math.max(0, (sideLine?.amount || 0) - linkedToTotal);
      return {
        sideLine,
        rows,
        linkedFromTotal,
        linkedToTotal,
        linkableRemaining,
      };
    };
    return {
      debit: buildSide("debit"),
      credit: buildSide("credit"),
    };
  }, [journalBillLinesBySide, journalLinkedFromRows, journalLinkedToRowsBySide, journalAllocationsBySide, journalVoucherId, vouchers, partyIdSet, staffIdSet, pParties, pStaff, effectiveLedgerObOutstanding, openedFromAccountId, ledgerBooksOpeningBalanceSigned]);
  // Resolve side-wise source account metadata so each Journal card opens the correct link dialog (Party/Staff).
  const journalLinkContextBySide = useMemo(() => {
    const resolve = (side: "debit" | "credit") => {
      const accountId = String(journalBillWiseBySide[side].sideLine?.partyId ?? "");
      if (!accountId) return { accountId: "", kind: null as "party" | "staff" | null, label: "", openingBalance: 0 };
      if (partyIdSet.has(accountId)) {
        const party = (pParties || []).find((p: any) => String(p.id) === accountId);
        return {
          accountId,
          kind: "party" as const,
          label: party?.name || accountLabelById.get(accountId) || "Party",
          openingBalance: Number((party as any)?.openingBalance ?? 0),
        };
      }
      if (staffIdSet.has(accountId)) {
        const staff = (pStaff || []).find((s: any) => String(s.id) === accountId);
        return {
          accountId,
          kind: "staff" as const,
          label: staff?.name || accountLabelById.get(accountId) || STAFF_ENTITY_LABEL,
          openingBalance: Number((staff as any)?.openingBalance ?? 0),
        };
      }
      return { accountId, kind: null as "party" | "staff" | null, label: accountLabelById.get(accountId) || "Account", openingBalance: 0 };
    };
    return {
      debit: resolve("debit"),
      credit: resolve("credit"),
    };
  }, [journalBillWiseBySide, partyIdSet, pParties, staffIdSet, pStaff, accountLabelById]);
  // Detect existing journal links so edit mode vouchers with links always show link cards.
  const hasJournalBillWiseLinks = useMemo(
    () => (["debit", "credit"] as const).some((side) =>
      (journalBillWiseBySide[side]?.rows || []).some((r: any) => Number(r?.linkedOnCurrent ?? 0) > 0)
    ),
    [journalBillWiseBySide]
  );
  // Match payment forms behavior: add/new -> hidden until click, edit+links -> always visible.
  const shouldShowJournalLinkSections = showLinkSections || (!!voucher?.id && hasJournalBillWiseLinks);
  const shouldShowJournalLinkButton = !shouldShowJournalLinkSections;
  useEffect(() => {
    // Auto-open only when editing a voucher that already has bill-wise links.
    if (voucher?.id && hasJournalBillWiseLinks) {
      setShowLinkSections(true);
      return;
    }
    // New/add form should start collapsed every time.
    if (!voucher?.id) {
      setShowLinkSections(false);
    }
  }, [voucher?.id, hasJournalBillWiseLinks]);
  // Open side-specific linking dialog so Debit card links to Credit vouchers and Credit card links to Debit vouchers.
  const handleJournalAddLinkClick = useCallback((side: "debit" | "credit") => {
    setSelectedBillWiseCard(side);
    const sideLine = journalBillWiseBySide[side].sideLine;
    if (!sideLine) {
      sonnerToast.info(`Select a ${side} row with amount before linking.`);
      return;
    }
    const ctx = journalLinkContextBySide[side];
    if (!ctx.kind) {
      sonnerToast.info("Only Party/Staff journal rows support bill-wise link from Journal.");
      return;
    }
    setActiveJournalLinkSide(side);
  }, [journalBillWiseBySide, journalLinkContextBySide]);
  // Keep currently opened link-card context in one object so party/staff dialogs can reuse the same source details.
  const activeJournalLinkContext = useMemo(() => {
    if (!activeJournalLinkSide) return null;
    const ctx = journalLinkContextBySide[activeJournalLinkSide];
    const sideAmount = Number(journalBillWiseBySide[activeJournalLinkSide].sideLine?.amount ?? 0) || 0;
    return {
      side: activeJournalLinkSide,
      ...ctx,
      amount: sideAmount,
    };
  }, [activeJournalLinkSide, journalLinkContextBySide, journalBillWiseBySide]);

  /**
   * Dialog ticks: outbound (isi journal pe saved) + incoming (PYMT/JRNL Dr ne is Cr pe link kiya).
   * Pehle sirf outbound jaata tha — isliye pehle se linked rows edit pe unticked + linkable > 0 dikhte the.
   */
  const journalDialogExistingAllocations = useMemo((): Allocation[] => {
    const side = activeJournalLinkContext?.side;
    const accountId = String(activeJournalLinkContext?.accountId ?? "").trim();
    if (!side || !accountId) return [];
    const outbound = (journalAllocationsBySide[side] || []) as Allocation[];
    const byId = new Map<string, Allocation>();
    for (const a of outbound) {
      const id = String(a?.voucherId ?? "").trim();
      if (!id || getAllocationTotal(a) <= 0) continue;
      const etKey = String((a as any)?.entityTxnId ?? "");
      byId.set(etKey.includes("::tds::") ? etKey : id, {
        ...a,
        voucherId: id,
        amount: getAllocationTotal(a),
        linkedAccountId: (a as any).linkedAccountId ?? accountId,
      });
    }

    const debitSources = new Set(["payment_in", "direct_income", "purchase", "purchase_service"]);
    const creditSources = new Set(["payment_out", "direct_expense", "sale", "sale_service"]);
    // credit card (Journal Cr) ← Dr sources; debit card (Journal Dr) ← Cr sources
    const allowTypes = side === "credit" ? creditSources : debitSources;

    const voucherTouchesAccount = (v: any) =>
      String((v as any)?.partyId ?? "") === accountId ||
      String((v as any)?.staffId ?? "") === accountId ||
      (Array.isArray((v as any)?.entries) &&
        (v as any).entries.some((e: any) => String(e?.accountId ?? "") === accountId));

    const journalMatchesSide = (v: any) => {
      if (!Array.isArray(v?.entries)) return false;
      const entry = v.entries.find((e: any) => String(e?.accountId ?? "") === accountId);
      if (!entry) return false;
      // Incoming to Journal Cr → source must be Dr on this party; Journal Dr ← Cr source
      return side === "credit"
        ? (Number(entry.debit) || 0) > 0
        : (Number(entry.credit) || 0) > 0;
    };

    const icMatchesSide = (v: any) => {
      const amt = getInterCompanyEntityBillWiseAmount(
        v,
        accountId,
        staffIdSet.has(accountId) ? "staff" : "party"
      );
      if (!amt) return false;
      return side === "credit" ? amt.debit > 0 : amt.credit > 0;
    };

    for (const row of journalLinkedFromRows) {
      const id = String(row.voucherId || "").trim();
      if (!id) continue;
      const src = (vouchers as any[])?.find((v: any) => String(v?.id ?? "") === id);
      if (!src || !voucherTouchesAccount(src)) continue;
      const st = String(row.sourceType || src.type || "").toLowerCase();
      if (st === "journal") {
        if (!journalMatchesSide(src)) continue;
      } else if (st === "inter_company") {
        if (!icMatchesSide(src)) continue;
      } else if (!allowTypes.has(st)) {
        continue;
      }
      // Reverse TDS-leg links (voucherId::tds::acct) on a Sale/Purchase mirror this journal's own TDS allocation; they are not extra main-row links.
      const amt = ((src.allocations as any[] | undefined) || [])
        .filter(
          (a: any) =>
            String(a?.voucherId ?? "") === String(journalVoucherId) &&
            !String(a?.entityTxnId ?? "").includes("::tds::")
        )
        .reduce((s: number, a: any) => s + getAllocationTotal(a), 0);
      if (amt <= 0) continue;
      const prev = byId.get(id);
      const mergedAmt = Math.max(prev ? getAllocationTotal(prev) : 0, amt);
      byId.set(id, {
        voucherId: id,
        amount: mergedAmt,
        linkedAccountId: accountId,
      });
    }

    return Array.from(byId.values());
  }, [
    activeJournalLinkContext?.side,
    activeJournalLinkContext?.accountId,
    journalAllocationsBySide,
    journalLinkedFromRows,
    vouchers,
    staffIdSet,
  ]);

  const computeJournalBillWiseDialogDone = useCallback(
    (
      side: "debit" | "credit",
      accountId: string,
      allocations: Allocation[],
      dialogExisting: Allocation[],
      currentBySide: { debit: Allocation[]; credit: Allocation[] }
    ) => {
      const tagged = (Array.isArray(allocations) ? allocations : []).map((a: any) => ({
        ...a,
        linkedAccountId: accountId,
      }));
      const newIds = new Set(
        tagged
          .filter((a) => getAllocationTotal(a) > 0)
          .map((a) => String(a.voucherId ?? ""))
          .filter(Boolean)
      );
      const removedIds: string[] = [];
      for (const a of dialogExisting) {
        const id = String(a?.voucherId ?? "");
        if (!id || id === OPENING_BALANCE_VOUCHER_ID) continue;
        if (!newIds.has(id)) removedIds.push(id);
      }
      for (const id of removedIds) {
        if (journalLinkedFromRows.some((row) => String(row.voucherId) === id)) {
          journalIncomingLinksToClearRef.current.add(id);
        } else {
          journalIncomingLinksToClearRef.current.delete(id);
        }
      }
      for (const a of tagged) {
        const id = String(a?.voucherId ?? "");
        if (id) journalIncomingLinksToClearRef.current.delete(id);
      }
      const nextBySide = {
        debit: side === "debit" ? tagged : [...(currentBySide.debit || [])],
        credit: side === "credit" ? tagged : [...(currentBySide.credit || [])],
      };
      return {
        nextBySide,
        merged: [...nextBySide.debit, ...nextBySide.credit],
        removedIds,
      };
    },
    [journalLinkedFromRows]
  );

  const persistJournalBillWiseLinks = useCallback(
    async (
      merged: Allocation[],
      removedIds: string[],
      nextBySide: { debit: Allocation[]; credit: Allocation[] }
    ) => {
      const vid = journalVoucherId;
      if (!companyId || !vid) return;
      const previous = [
        ...(initialJournalAllocationsRef.current.debit || []),
        ...(initialJournalAllocationsRef.current.credit || []),
      ];
      await runWithVoucherLinkSaveProgress(
        async () => {
          await applyJournalBillWiseLinkAllocations(companyId, vid, merged, previous, removedIds);
          initialJournalAllocationsRef.current = {
            debit: [...nextBySide.debit],
            credit: [...nextBySide.credit],
          };
          journalIncomingLinksToClearRef.current.clear();
        },
        { successTitle: "Links saved" }
      );
    },
    [companyId, journalVoucherId]
  );

  // Dialog ko signed books OB — ledger prop pehle (Dr→Cr / Cr→Dr mirror ke liye same source).
  const activePartySignedOpeningBalance = useMemo(() => {
    if (!activeJournalLinkContext || activeJournalLinkContext.kind !== "party") return 0;
    if (typeof ledgerBooksOpeningBalanceSigned === "number" && Math.abs(ledgerBooksOpeningBalanceSigned) > 1e-6) {
      return ledgerBooksOpeningBalanceSigned;
    }
    const accountId = activeJournalLinkContext.accountId;
    const party =
      (pParties || []).find((p: any) => String(p.id) === String(accountId)) ||
      (openedFromAccountId
        ? (pParties || []).find((p: any) => String(p.id) === openedFromAccountId)
        : undefined);
    let signed = Number((party as any)?.openingBalance ?? activeJournalLinkContext.openingBalance ?? 0);
    const side = activeJournalLinkContext.side;
    const obRemaining =
      typeof effectiveLedgerObOutstanding === "number" && effectiveLedgerObOutstanding > 0
        ? effectiveLedgerObOutstanding
        : null;
    if (Math.abs(signed) > 1e-6) return signed;
    if (obRemaining != null) {
      return side === "debit" ? -obRemaining : obRemaining;
    }
    return signed;
  }, [activeJournalLinkContext, pParties, effectiveLedgerObOutstanding, openedFromAccountId, ledgerBooksOpeningBalanceSigned]);


  // Validated `data` से save — nested mobile `date` + `getValues()` से date miss न हो
  const handleFormSubmit = useCallback(
    (e: React.FormEvent, options: { ocrAutoPost?: boolean; saveAndNew?: boolean; print?: boolean; approveAfterSave?: boolean } = {}) => {
      e.preventDefault();
      gateConvertSubmit(() => {
        void form.handleSubmit(
          async (data) => {
            await processAndSaveRef.current?.(data, options.saveAndNew ?? false, options.approveAfterSave);
          },
          (errors) => {
            sonnerToast.error("Validation Failed", { description: formatJournalFormValidationErrors(errors) });
          }
        )(e);
      });
    },
    [form, gateConvertSubmit]
  );
  
  async function processAndSave(data: JournalFormValues, saveAndNew: boolean = false, approveAfterSave?: boolean) {
    if (!user || !companyId) {
      sonnerToast.error("Error", { description: "Login and company selection required." });
      return;
    }

    try {
      // Permission check: create or edit
      const isEdit = isPermissionEdit(!!voucher?.id, savedVoucherId);
      const voucherDate = data.date instanceof Date ? data.date : new Date(data.date);
      
      if (isEdit) {
        // Check edit permission - determine ownership
        const fetchVoucher = async (cid: string, vid: string) => {
          const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
          return voucherDoc.exists() ? voucherDoc.data() : null;
        };
        const isOwnRecord = await determineVoucherOwnership(voucher, savedVoucherId, vouchers, user.uid, companyId, fetchVoucher);
        assertCanEdit(canEditRecord, isOwnRecord);
        
        // Check backdate limit for edit - use ORIGINAL voucher date, not form date
        let originalVoucherDate = voucherDate;
        if (voucher?.date) {
          originalVoucherDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date);
        } else if (savedVoucherId) {
          const existingVoucher = vouchers.find(v => v.id === savedVoucherId);
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

    const charge = Number((data as any).otherChargeAmount) || 0;
    const totalDebit = data.lines.filter(l => l.type === 'debit').reduce((sum, l) => sum + l.amount, 0) + charge;
    const totalCredit = data.lines.filter(l => l.type === 'credit').reduce((sum, l) => sum + l.amount, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
        sonnerToast.error("Unbalanced Entry", { description: "Total debits must equal total credits." });
        setIsLoading(false);
        return;
    }

    if (deviceLimitReached) {
      sonnerToast.error("Device limit reached", {
        description: "Upgrade your plan to sync from more devices.",
        action: { label: "Upgrade", onClick: () => window.location.assign("/billing") },
      });
      return;
    }
    
    const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving journal...");
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
          const hit = await findVoucherInLocalMirrorByNumberAndType(companyId, data.voucherNumber, "journal");
          if (hit && hit.id !== idArgForFirestore) duplicateOtherId = hit.id;
        } else {
          const q = query(
            collection(firestore, `companies/${companyId}/vouchers`),
            where("voucherNumber", "==", data.voucherNumber),
            where("type", "==", "journal")
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

      const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });
      
      let fileUrls: string[] = filesForSave.filter(f => typeof f === 'string') as string[];
      let preGeneratedVoucherId: string | undefined;
      const newFilesToUpload = filesForSave.filter(f => typeof f !== 'string') as File[];

      if (newFilesToUpload.length > 0) {
        const totalNewBytes = newFilesToUpload.reduce((sum, f) => sum + (f.size || 0), 0);
        const limitCheck = await checkStorageLimitSafe(companyId, company?.planId, {
          attachmentsBytes: totalNewBytes,
          storageBytes: totalNewBytes,
        }, company?.storageOption);
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
              storageFolder: "journal",
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
              storageFolder: "journal",
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
      
      const date = data.date instanceof Date ? data.date : new Date((data as any).date);
      // Build payload with only serializable fields (avoid form state carrying Timestamps/id that can break Firestore update)
      const submissionData = {
        type: "journal" as const,
        voucherNumber: (data as any).voucherNumber,
        narration: (data as any).narration ?? "",
        date: date.toISOString(),
        total: totalDebit,
        entries: [
          ...data.lines.map((line: any) => ({
            accountId: line.accountId,
            debit: line.type === "debit" ? line.amount : 0,
            credit: line.type === "credit" ? line.amount : 0,
          })),
          ...(Number((data as any).otherChargeAmount || 0) > 0 && String((data as any).otherChargeAccountId || "").trim()
            ? [{
                accountId: String((data as any).otherChargeAccountId),
                debit: Number((data as any).otherChargeAmount) || 0,
                credit: 0,
              }]
            : []),
        ],
        otherChargeAccountId: String((data as any).otherChargeAccountId || ""),
        otherChargeAmount: Number((data as any).otherChargeAmount || 0) || 0,
        otherChargePartyAccountId: String((data as any).otherChargePartyAccountId || ""),
        // Persist links made from Journal debit/credit bill-wise cards.
        allocations: effectiveJournalAllocations,
        ...voucherAttachmentFieldsForSave(fileUrls, voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))),
        ...(String(voucher?.loanId || "").trim()
          ? {
              loanId: String(voucher.loanId).trim(),
              ...(String(voucher?.loanTransactionKind || "").trim()
                ? { loanTransactionKind: String(voucher.loanTransactionKind).trim() }
                : {}),
              ...(voucher?.isLoanModuleVoucher === true ? { isLoanModuleVoucher: true } : {}),
            }
          : {}),
      };

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
          if (isMounted.current) setSavedVoucherId(savedDoc.id);
          if (originalVoucherIdToDelete) {
              await markVoucherConvertedInRecycleBin(companyId, originalVoucherIdToDelete, {
                convertedToType: "journal",
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
        const savedJournalAllocations = [
          ...(journalAllocationsBySide.debit || []),
          ...(journalAllocationsBySide.credit || []),
        ];
        const previousJournalAllocations = [
          ...(initialJournalAllocationsRef.current.debit || []),
          ...(initialJournalAllocationsRef.current.credit || []),
        ];
        const needsBillWiseLinkSync =
          !!(companyId && docId) &&
          hasBillWiseAllocationSyncWork(savedJournalAllocations, previousJournalAllocations);
        const incomingLinksToClear = [...journalIncomingLinksToClearRef.current];
        const needsIncomingLinkClear = incomingLinksToClear.length > 0;
        const capturedSideAllocations = {
          debit: [...(journalAllocationsBySide.debit || [])],
          credit: [...(journalAllocationsBySide.credit || [])],
        };
        // Save & Close: dialog turant band — approve/alerts background (`postSaveTail`).
        if (approveBanner) {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEditForApprove ? "Journal updated and approved." : "Journal saved and approved."
          );
        } else {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEditForApprove ? "Journal updated!" : "Journal voucher created!"
          );
        }
        if (isMounted.current) setIsLoading(false);

        if (!saveAndNew) {
          onVoucherAction?.("saved", false, docId);
        }

        if (companyId && docId) {
          try {
            const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
              companyId,
              voucherId: docId,
              rawFileUrls: fileUrls,
              storageFolder: "journal",
              previousUrls: initialFilesRef.current,
            });
            savedFileUrlsSnapshotRef.current = [...persistedUrls];
            setFiles(persistedUrls);
            initialFilesRef.current = [...persistedUrls];
          } catch (attachErr) {
            console.warn("[CreateJournalForm] post-save attachment finalize", attachErr);
          }
        }

        const postSaveTail = async () => {
          if (companyId && docId && (needsBillWiseLinkSync || needsIncomingLinkClear)) {
            const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
            const linkResult = await runWithVoucherLinkSaveProgress(async () => {
              await applyJournalBillWiseLinkAllocations(
                companyId,
                docId,
                savedJournalAllocations,
                previousJournalAllocations,
                incomingLinksToClear
              );
              initialJournalAllocationsRef.current = capturedSideAllocations;
              journalIncomingLinksToClearRef.current.clear();
            });
            if (!linkResult.ok) {
              sonnerToast.error("Journal saved but bill-wise link sync failed.", {
                description:
                  linkResult.error instanceof Error
                    ? linkResult.error.message
                    : "Try opening Link for bill wise again.",
              });
            }
          } else if (companyId && docId) {
            initialJournalAllocationsRef.current = capturedSideAllocations;
          }

          // New create: saveVoucher(approveAfterSave) already set isApproved — skip second approve lookup.
          if (companyId && company) {
            const isEdit = !!voucher?.id;
            const amount = Number(submissionData.total) || 0;
            const vid = docId || voucher?.id;
            if (isEdit) {
              const oldV = voucher as any;
              const changes = getChangedFieldLabels(
                { total: oldV?.total, narration: oldV?.narration, date: oldV?.date, voucherNumber: oldV?.voucherNumber },
                { total: submissionData.total, narration: submissionData.narration, date: submissionData.date, voucherNumber: submissionData.voucherNumber },
                [
                  { key: "total", label: "Amount" },
                  { key: "narration", label: "Narration" },
                  { key: "date", label: "Date" },
                  { key: "voucherNumber", label: "Voucher number" },
                ]
              );
              await sendTransactionAlert(companyId, company, {
                kind: "edited",
                voucherId: vid,
                voucherNumber: submissionData.voucherNumber,
                voucherType: "journal",
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
                voucherType: "journal",
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
            setSavedVoucherId(null);
            await fetchVoucherNumber();
          }

          if (approveAfterSave && voucher?.id) onApprove?.();

          if (saveAndNew) {
            onVoucherAction?.("saved", true, docId);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.error("[CreateJournalForm] post-save tail", err);
            sonnerToast.error("Journal saved — finishing steps pending", {
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
        sonnerToast.error("Voucher limit reached", {
          id: toastId,
          description: error.message,
          action: { label: "Upgrade", onClick: () => window.location.assign("/billing") },
        });
      } else {
        const message = error?.message || (typeof error === "string" ? error : "Unknown error");
        console.error("Error saving journal voucher:", error);
        voucherSaveErrorToast(toastId, error, message);
      }
    } finally {
        if (isMounted.current) setIsLoading(false);
    }
  };

  processAndSaveRef.current = processAndSave;

  const handleDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId) return;
    
    try {
      assertCan(can, "delete_records");
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
          form: "journal",
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
          form: "journal",
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
      toast({ title: "Journal deleted permanently." });
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled");
    } catch (error) {
      console.error("Error permanently deleting voucher:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete journal." });
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
    if (type === 'staff') setIsCreateStaffOpen(true);
    if (type === 'expense') setIsCreateExpenseOpen(true);
    if (type === 'tax') {
      setJournalTaxPrefillName(typeof newName === 'string' ? newName : '');
      setIsCreateTaxOpen(true);
    }

    if (newName && type !== 'tax') {
      setTimeout(() => {
        // Bank dialog sunta hai prefill-create-bank-account-name, generic account-name nahi
        if (type === 'account') {
          document.dispatchEvent(new CustomEvent('prefill-create-bank-account-name', { detail: newName }));
        } else {
          document.dispatchEvent(new CustomEvent(`prefill-create-${type}-name`, { detail: newName }));
        }
      }, 100);
    }
  };
  /** Journal line Copy category: row entity ke hisaab se parent copy helper ko correct master type bhejo. */
  const getJournalCopyCategoryForLine = useCallback(
    (index: number, lineEntityType?: string) => {
      const et = String(lineEntityType || "").trim();
      if (et === "party") return "party";
      if (et === "staff") return "staff";
      if (et === "tax") return "tax";
      if (et === "expense") return "account_expense";
      if (et === "account") return "account_bank";
      const selectedId = String(form.getValues(`lines.${index}.accountId`) || "");
      if (selectedId) {
        const matched = allAccountsWithEntity.find((a) => String(a.value) === selectedId);
        const mt = String(matched?.entityType || "").trim();
        if (mt === "party") return "party";
        if (mt === "staff") return "staff";
        if (mt === "tax") return "tax";
        if (mt === "expense") return "account_expense";
        if (mt === "account") return "account_bank";
      }
      // Entity unknown: mismatch hints se best category choose karo.
      if (copyMismatchCategories?.includes("account_bank")) return "account_bank";
      if (copyMismatchCategories?.includes("account_expense")) return "account_expense";
      if (copyMismatchCategories?.includes("party")) return "party";
      if (copyMismatchCategories?.includes("staff")) return "staff";
      if (copyMismatchCategories?.includes("tax")) return "tax";
      return "account";
    },
    [form, allAccountsWithEntity, copyMismatchCategories]
  );

  /** Journal line Account combobox: add-new-* → create dialog; warna account select + entity sync */
  const handleJournalLineAccountChange = (
    index: number,
    field: { onChange: (v: string) => void },
    value: string,
    newName?: string
  ) => {
    const createType = JOURNAL_ADD_NEW_VALUE_TO_TYPE[value];
    if (createType) {
      setPendingCreateLineIndex(index);
      handleCreateNew(createType, newName);
      return;
    }
    field.onChange(value);
    const acc = allAccountsWithEntity.find((a) => a.value === value);
    if (acc?.entityType) form.setValue(`lines.${index}.entityType`, acc.entityType, { shouldDirty: true });
  };
  /**
   * Tab-switch (e.g. Contra→Journal→Contra) par form fresh mount hota hai.
   * Parent ki state me bachi `copyMasterDraftRequest` se prefill dialog auto-open na ho —
   * sirf user ke Copy chip click ke baad arrived REQUEST par hi dialog khule.
   */
  const hasInitializedCopyRequestRef = useRef(false);
  /** Copy-draft request consumer (Journal): parent se source row payload aane par proper create dialog prefill kholo. */
  useEffect(() => {
    // First mount-time run skip karo — request agar pehle se set thi to bhi dialog na khole; future updates par hi react karo.
    if (!hasInitializedCopyRequestRef.current) {
      hasInitializedCopyRequestRef.current = true;
      return;
    }
    if (!copyMasterDraftRequest) return;
    const req = copyMasterDraftRequest;
    /** Parent ne jo journal row Copy dabayi — async gap me galat row par save na lage. */
    if (typeof req.applyTarget?.journalLineIndex === "number") {
      setPendingCreateLineIndex(req.applyTarget.journalLineIndex);
    }
    const targetLabel = req.targetCompanyName || "company";
    const payload = req.sourceRowPayload;
    const sc = String(req.sourceCollection || "");
    const nm = String(req.sourceName || "").trim();
    // Copy-draft parity with Payment forms: source row payload mile to full prefill use karo (attachments सहित).
    if (payload && sc === "parties") {
      setIsCreatePartyOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-party-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Party prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    // Journal line expense entity ke liye source ledger row ka full payload open karo.
    if (payload && sc === "expense_accounts") {
      setIsCreateExpenseOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-expense-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Expense account prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    if (payload && sc === "bank_accounts") {
      setIsCreateAccountOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-bank-account-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Bank account prefilled from source -> save adds to "${targetLabel}".`);
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
    if (payload && sc === "staff") {
      setIsCreateStaffOpen(true);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("prefill-create-staff-full", { detail: { rowPayload: payload } }));
      }, 90);
      sonnerToast.message(`Staff prefilled from source -> save adds to "${targetLabel}".`);
      return;
    }
    if (!nm) return;
    switch (req.category) {
      case "party":
        setIsCreatePartyOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-party-name", { detail: nm })), 80);
        sonnerToast.message(`Party prefilled -> save adds to "${targetLabel}".`);
        return;
      case "staff":
        setIsCreateStaffOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-staff-name", { detail: nm })), 80);
        sonnerToast.message(`Staff prefilled -> save adds to "${targetLabel}".`);
        return;
      case "tax":
        setJournalTaxPrefillName(nm);
        setIsCreateTaxOpen(true);
        sonnerToast.message(`Tax prefilled -> save adds to "${targetLabel}".`);
        return;
      case "account_expense":
        setIsCreateExpenseOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
        sonnerToast.message(`Expense account prefilled -> save adds to "${targetLabel}".`);
        return;
      case "account":
        // Generic account copy chip ko source collection ke hisaab se bank vs expense create dialog me route karo.
        if (sc === "expense_accounts") {
          setIsCreateExpenseOpen(true);
          setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-expense-account-name", { detail: nm })), 80);
          sonnerToast.message(`Expense account prefilled -> save adds to "${targetLabel}".`);
          return;
        }
        setIsCreateAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-bank-account-name", { detail: nm })), 80);
        sonnerToast.message(`Bank account prefilled -> save adds to "${targetLabel}".`);
        return;
      case "account_bank":
        setIsCreateAccountOpen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent("prefill-create-bank-account-name", { detail: nm })), 80);
        sonnerToast.message(`Bank account prefilled -> save adds to "${targetLabel}".`);
        return;
      default:
        break;
    }
  }, [copyMasterDraftRequest]);

  // Apply newly created account to the requested row to avoid extra debit rows being appended.
  const applyCreatedAccountToPendingRow = useCallback((id: string) => {
    if (pendingOtherChargeCreateRef.current) {
      pendingOtherChargeCreateRef.current = false;
      form.setValue("otherChargeAccountId", id, { shouldDirty: true, shouldValidate: true });
      return;
    }
    if (pendingCreateLineIndex !== null) {
      form.setValue(`lines.${pendingCreateLineIndex}.accountId`, id, { shouldDirty: true, shouldValidate: true });
      setPendingCreateLineIndex(null);
      return;
    }
    // Add-row flow removed: fallback assigns created account to an existing empty row (or last row) instead of appending.
    const currentLines = form.getValues("lines");
    const emptyRowIndex = currentLines.findIndex((line) => !String(line?.accountId ?? "").trim());
    const targetRowIndex = emptyRowIndex >= 0 ? emptyRowIndex : Math.max(0, currentLines.length - 1);
    form.setValue(`lines.${targetRowIndex}.accountId`, id, { shouldDirty: true, shouldValidate: true });
  }, [form, pendingCreateLineIndex]);
  
  const handleAmountChange = (index: number, value: number) => {
    // Add-row flow removed: rebalance only within the existing journal rows.
    const updatedLines = form.getValues("lines");
    const charge = Number(form.getValues("otherChargeAmount")) || 0;
    if (updatedLines.length === 2) {
      const pairedIndex = index === 0 ? 1 : 0;
      form.setValue(`lines.${pairedIndex}.amount`, value + charge, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }
    let totalDebit = charge;
    let totalCredit = 0;

    updatedLines.forEach((line, i) => {
        if (i !== updatedLines.length - 1) { // Exclude the new last line for calculation
            if (line.type === 'debit') totalDebit += Number(line.amount) || 0;
            else totalCredit += Number(line.amount) || 0;
        }
    });
    
    const diff = totalDebit - totalCredit;
    const absDiff = Math.abs(diff);

    const newLastIndex = updatedLines.length - 1;
    form.setValue(`lines.${newLastIndex}.amount`, absDiff, { shouldValidate: true });
    form.setValue(`lines.${newLastIndex}.type`, diff > 0 ? 'credit' : 'debit', { shouldValidate: true });
  }

  const closeJournalOtherCharge = () => {
    setOtherChargeEnabled(false);
    form.setValue("otherChargeAccountId", "");
    form.setValue("otherChargeAmount", 0);
    const firstIdx = (form.getValues("lines") || []).findIndex((l: any) => !l?.isAutoLine);
    if (firstIdx >= 0) {
      handleAmountChange(firstIdx, Number(form.getValues(`lines.${firstIdx}.amount`)) || 0);
    }
  };

  const handleOtherChargeAccountChange = (
    fieldOnChange: (val: string) => void,
    val: string,
    newName?: string
  ) => {
    const createType = OTHER_CHARGE_ADD_NEW_VALUE_TO_TYPE[val];
    if (createType) {
      pendingOtherChargeCreateRef.current = true;
      handleCreateNew(createType, newName);
      return;
    }
    fieldOnChange(val);
  };

  const journalOtherChargeCard = showJournalOtherCharge ? (
    <div className="relative h-full min-h-0 rounded-lg border bg-muted/20 p-3 flex flex-col min-w-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-3 top-3 h-8 w-8 rounded-full p-0"
        disabled={deleteDisabledWhenLinked}
        onClick={closeJournalOtherCharge}
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="mt-auto space-y-3">
        <FormField
          control={form.control}
          name="otherChargeAccountId"
          render={({ field }: any) => (
            <FormItem className="min-w-0">
              <FormLabel className="text-xs">Other Charge</FormLabel>
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
                  className="min-w-[12ch] w-full"
                  value={field.value ?? ""}
                  disabled={deleteDisabledWhenLinked}
                  onChange={(e) => {
                    const next = e.target.value === "" ? 0 : Number(e.target.value);
                    field.onChange(next);
                    const firstIdx = (form.getValues("lines") || []).findIndex((l: any) => !l?.isAutoLine);
                    if (firstIdx >= 0) {
                      handleAmountChange(firstIdx, Number(form.getValues(`lines.${firstIdx}.amount`)) || 0);
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => handleFormSubmit(e)} className="h-full flex flex-col min-w-0 w-full max-w-full">
          <ScrollArea className={cn("flex-1 overflow-x-hidden min-w-0 w-full", !isMobile && "pr-6 -mr-6")}>
            <div
              className={cn(
                "space-y-6 min-w-0 max-w-full w-full overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full",
                isMobile ? "" : "px-[2px]"
              )}
              onClick={() => setSelectedBillWiseCard(null)}
            >
              {(voucher as { _loanDisbursementContext?: { sanctioned: number; disbursed: number; remaining: number } })
                ?._loanDisbursementContext ? (
                <div className="rounded-lg border border-sky-300/80 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100">
                  <p className="font-medium">Loan disbursement</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sanctioned {formatCurrencyForPrint((voucher as any)._loanDisbursementContext.sanctioned, { noAnimation: true, noSuffix: true, showDrCr: false })} · already disbursed{" "}
                    {formatCurrencyForPrint((voucher as any)._loanDisbursementContext.disbursed, { noAnimation: true, noSuffix: true, showDrCr: false })} · remaining{" "}
                    {formatCurrencyForPrint((voucher as any)._loanDisbursementContext.remaining, { noAnimation: true, noSuffix: true, showDrCr: false })}.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rule: Debit Bank/Cash, Credit Loan Liability. Amount cannot exceed remaining sanctioned.
                  </p>
                </div>
              ) : null}
              {/* PC View: All 4 Fields in Same Row with Responsive Wrapping */}
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
                        {/* Journal header section (mobile): Voucher + Date gets dedicated sky ribbon tone. */}
                        <div className="grid gap-[2px] w-full min-w-0 max-w-full rounded-lg border border-sky-300/80 bg-sky-50 p-2" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                          <FormField
                            control={form.control}
                            name="voucherNumber"
                            render={({ field: voucherField }: any) => (
                              <>
                                {hasPrefix && (
                                  <FormItem className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Prefix</FormLabel>
                                    <Select onValueChange={(prefix) => fetchVoucherNumber(prefix)} value={voucherPrefixes.find((p) => voucherField.value?.startsWith(normalizePrefix(p)) || voucherField.value?.startsWith(p)) || voucherPrefixes[0]}>
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
                                    <VoucherNumberInputWithRefresh placeholder="e.g. JV-001" {...voucherField} chromeSize="sm" className="h-9 text-xs px-2 min-w-0 max-w-full truncate w-full" disabled={isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers'))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId} />
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
                                      <BsDatePicker valueAD={dateField.value} onChangeAD={(d) => { if (d) d.setHours(12, 0, 0, 0); dateField.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} transactionDates={transactionDates} className="h-9 text-xs w-full" />
                                    </div>
                                  </FormItem>
                                )}
                                {hasDateAD && (
                                  <FormItem data-ocr-field="date" className="min-w-0 w-full overflow-hidden">
                                    <FormLabel className="text-xs truncate">Date</FormLabel>
                                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button disabled={!isFormEditing} variant="outline" className={cn("h-9 pl-2 pr-2 text-left font-normal text-xs w-full min-w-0 max-w-full truncate", !dateField.value && "text-muted-foreground")}>
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
                  {/* Journal header section (desktop): Voucher + Date gets dedicated sky ribbon tone. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:justify-end md:items-end rounded-lg border border-sky-300/80 bg-sky-50 p-3">
                    {/* Voucher No. */}
                    <FormField
                      control={form.control}
                      name="voucherNumber"
                      render={({ field }: any) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Voucher No.</FormLabel>
                          <div className="flex gap-2 h-10">
                            {isPrefixSelectionEnabled && voucherPrefixes.length > 0 && (
                              <Select onValueChange={(prefix) => fetchVoucherNumber(prefix)} value={voucherPrefixes.find(p => field.value?.startsWith(normalizePrefix(p)) || field.value?.startsWith(p)) || voucherPrefixes[0]}>
                                <SelectTrigger className="w-32 h-10">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {voucherPrefixes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            <FormControl>
                              <VoucherNumberInputWithRefresh placeholder="e.g. JV-001" {...field} className="h-10" disabled={isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers'))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId} />
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
                                }} isRange={false} transactionDates={transactionDates} className={VOUCHER_PC_DATE_BS_PILL} />
                              </div>
                            )}
                            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <div className={cn(dateSystem === 'Both' ? VOUCHER_PC_DATE_BOTH_SLOT : "w-full min-w-0")}>
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button disabled={!isFormEditing} variant={"outline"} className={cn(VOUCHER_PC_DATE_AD_PILL, !field.value && "text-muted-foreground")}>
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
                
              {isMobile ? (
                <>
                  {/* Mobile: Journal Lines */}
                  {/* Journal entries section (mobile): rows grouped inside soft emerald ribbon container. */}
                  <div className="space-y-4 px-[2px] rounded-lg border border-emerald-300/80 bg-emerald-50 p-2">
                    {!showJournalOtherCharge && (
                      <div className="flex justify-end px-[2px]">
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
                      </div>
                    )}
                    {fields.map((line, index) => {
                      const accountId = form.watch(`lines.${index}.accountId`);
                      const entityType = form.watch(`lines.${index}.entityType`) || "";
                      // Entity=All: dropdown shows "Name (Entity)"; Entity selected: dropdown shows name only. Trigger always shows name only.
                      const filteredAccounts = entityType
                        ? allAccountsWithEntity.filter((a) => a.entityType === entityType).map((a) => ({ value: a.value, label: a.nameOnly, triggerLabel: a.nameOnly }))
                        : allAccountsWithEntity.map((a) => ({ value: a.value, label: a.label, triggerLabel: a.nameOnly }));
                      const balance = allAccounts.find(a => a.value === accountId)?.balance;
                      const isLastRow = index === fields.length - 1;
                      const lineType = form.watch(`lines.${index}.type`);
                      
                      return (
                        <div
                          key={line.id}
                          className={cn(
                            // Remove inner card chrome on each row; keep only outer section container styling.
                            "flex flex-wrap gap-[2px] items-start px-[2px] py-2",
                            linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50/60" : "bg-pink-50/60"),
                            selectedCardRelatedRowIndex === index && "animate-spend-wise-balance-blink"
                          )}
                        >
                          {/* Entity – filter for Account; when account selected, entity auto-updates */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.entityType`}
                            render={({ field: entityField }: any) => (
                              <FormItem className="w-[100px] min-w-0 shrink-0">
                                <Select
                                  value={entityField.value || "__all__"}
                                  onValueChange={(v) => {
                                    const val = v === "__all__" ? "" : v;
                                    entityField.onChange(val);
                                    const accId = form.getValues(`lines.${index}.accountId`);
                                    if (accId && val) {
                                      const acc = allAccountsWithEntity.find((a) => a.value === accId);
                                      if (acc && acc.entityType !== val) form.setValue(`lines.${index}.accountId`, "", { shouldDirty: true });
                                    }
                                  }}
                                  disabled={!isFormEditing || deleteDisabledWhenLinked}
                                >
                                  <FormControl>
                                    <SelectTrigger className="h-9 text-xs">
                                      <SelectValue placeholder="Entity" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {ENTITY_OPTIONS.map((o) => (
                                      <SelectItem key={o.value || "all"} value={o.value || "__all__"}>{o.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          {/* Account – filtered by Entity; on select, entity auto-updates */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.accountId`}
                            render={({ field }: any) => (
                              <FormItem className="flex-1 min-w-0 overflow-hidden">
                                <div className="min-w-0 w-full flex items-center gap-1">
                                  <div className="min-w-0 flex-1 overflow-hidden [&_button]:h-9 [&_button]:text-xs">
                                    <Combobox
                                      triggerClassName={cn(
                                        "w-full min-w-0 h-9",
                                        linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200"),
                                        // Copy pending state: field ko force red rakho; account select hote hi condition false ho kar normal.
                                        journalLineNeedsCopyAccount(index) && "!border-red-400 !bg-red-100/80 !text-red-700"
                                      )}
                                      options={filteredAccounts}
                                      value={field.value}
                                      onChange={(value, newName) => handleJournalLineAccountChange(index, field, value, newName)}
                                      placeholder="Select account"
                                      addNewLabels={getJournalLineAddNewLabels(entityType)}
                                      disabled={!isFormEditing || deleteDisabledWhenLinked}
                                    />
                                  </div>
                                  {journalLineNeedsCopyAccount(index) && (
                                    // Mobile: duplicate red Account label hata kar Copy chip ko select-box line me fit rakho.
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                      onClick={() => {
                                        setPendingCreateLineIndex(index);
                                        // Same row index parent ko bhejo ta snapshot.lines[index].accountId hi prefer ho (Dr ≠ Cr mix na ho).
                                        onCopyMissingCategory?.(getJournalCopyCategoryForLine(index, entityType), {
                                          journalLineIndex: index,
                                        });
                                      }}
                                      disabled={isCopyingMissingMasters}
                                    >
                                      {isCopyingMissingMasters ? "…" : "Copy"}
                                    </Button>
                                  )}
                                </div>
                                {balance !== undefined && (
                                  <div className={cn("text-[10px] font-semibold mt-1", balance >= 0 ? "text-green-600" : "text-red-600")}>
                                    Bal: {formatCurrencyForPrint(balance, { noSuffix: true, noAnimation: true })}
                                  </div>
                                )}
                              </FormItem>
                            )}
                          />
                          {/* Dr/Cr - Only show text, clickable to toggle */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.type`}
                            render={({ field }: any) => (
                              <FormItem>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className={cn(
                                    "h-9 px-3 min-w-[40px]",
                                    field.value === "debit" ? "text-blue-600 border-blue-300" : "text-purple-600 border-purple-300",
                                    // Match row color: debit=dim green, credit=dim pink.
                                    linkedPartyLineIndices.has(index) && (field.value === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200")
                                  )}
                                  onClick={() => {
                                    if (!isFormEditing || deleteDisabledWhenLinked || (isLastRow && fields.length > 1)) return;
                                    field.onChange(field.value === "debit" ? "credit" : "debit");
                                  }}
                                  disabled={!isFormEditing || deleteDisabledWhenLinked || (isLastRow && fields.length > 1)}
                                >
                                  <span className="text-xs font-semibold">
                                    {field.value === "debit" ? "Dr" : "Cr"}
                                  </span>
                                </Button>
                              </FormItem>
                            )}
                          />
                          {/* Amount */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.amount`}
                            render={({ field }: any) => (
                              <FormItem className="min-w-0 max-w-[120px] justify-self-end w-full">
                                <FormControl>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    className={cn(
                                      "h-9 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                                      linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200"),
                                      selectedCardRelatedRowIndex === index && "animate-spend-wise-balance-blink"
                                    )}
                                    {...field}
                                    disabled={!isFormEditing}
                                    onFocus={(e) => {
                                      if (!voucher && e.target.value === "0") e.target.select();
                                    }}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      field.onChange(value);
                                      handleAmountChange(index, value);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          {/* Delete Button */}
                          {isFormEditing && fields.length > 2 && (
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={!isFormEditing} className="h-9 w-9">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {isMobile && journalOtherChargeCard}
                    {/* Mobile: totals ko isi outer journal section container ke andar hi rakho. */}
                    <div className="flex flex-col gap-2 px-[2px] pt-1">
                      <div className="flex gap-2 justify-end">
                        <div className="bg-green-100 px-3 py-2 rounded text-xs font-medium">
                          Total Debit: {(form.watch("lines").filter(l => l.type === "debit").reduce((sum, l) => sum + (Number(l.amount) || 0), 0) + otherChargeAmountValue).toFixed(2)}
                        </div>
                        <div className="bg-red-100 px-3 py-2 rounded text-xs font-medium">
                          Total Credit: {form.watch("lines").filter(l => l.type === "credit").reduce((sum, l) => sum + (Number(l.amount) || 0), 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Desktop: Journal Lines */}
                  {/* Journal entries section (desktop): rows grouped inside soft emerald ribbon container. */}
                  <div className="rounded-lg border border-emerald-300/80 bg-emerald-50 p-3">
                    <div className={cn("grid gap-4 min-w-0 items-stretch", showJournalOtherCharge ? "grid-cols-[minmax(0,3fr)_minmax(0,1fr)]" : "grid-cols-1")}>
                    <div className="min-w-0 space-y-4">
                    <div className="grid grid-cols-[minmax(100px,1fr)_2fr_auto_auto_minmax(72px,120px)_48px] gap-2 items-end">
                      <FormLabel>Entity</FormLabel>
                      <FormLabel>Account</FormLabel>
                      <div></div>
                      <div></div>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <FormLabel>Amount</FormLabel>
                        {!showJournalOtherCharge && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full border-blue-300 bg-blue-100 px-2 text-[10px] font-semibold text-blue-900 hover:bg-blue-200 shrink-0"
                            disabled={deleteDisabledWhenLinked}
                            onClick={() => {
                              setOtherChargeEnabled(true);
                              form.setValue("otherChargeAmount", 0);
                            }}
                          >
                            <PlusCircle className="mr-0.5 h-3 w-3" /> Other charge
                          </Button>
                        )}
                      </div>
                      <div></div>
                    </div>

                    {fields.map((line, index) => {
                      const accountId = form.watch(`lines.${index}.accountId`);
                      const entityType = form.watch(`lines.${index}.entityType`) || "";
                      // Entity=All: dropdown shows "Name (Entity)"; Entity selected: dropdown shows name only. Trigger always shows name only.
                      const filteredAccounts = entityType
                        ? allAccountsWithEntity.filter((a) => a.entityType === entityType).map((a) => ({ value: a.value, label: a.nameOnly, triggerLabel: a.nameOnly }))
                        : allAccountsWithEntity.map((a) => ({ value: a.value, label: a.label, triggerLabel: a.nameOnly }));
                      const balance = allAccounts.find(a => a.value === accountId)?.balance;
                      const isLastRow = index === fields.length - 1;
                      const lineType = form.watch(`lines.${index}.type`);
                      
                      return (
                        <div
                          key={line.id}
                          className={cn(
                            // Remove inner card chrome on each row; keep only outer section container styling.
                            "grid grid-cols-[minmax(100px,1fr)_2fr_auto_auto_minmax(72px,120px)_48px] gap-2 items-start p-2",
                            linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50/60" : "bg-pink-50/60"),
                            selectedCardRelatedRowIndex === index && "animate-spend-wise-balance-blink"
                          )}
                        >
                          {/* Entity – filter for Account; when account selected, entity auto-updates */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.entityType`}
                            render={({ field: entityField }: any) => (
                              <FormItem>
                                <Select
                                  value={entityField.value || "__all__"}
                                  onValueChange={(v) => {
                                    const val = v === "__all__" ? "" : v;
                                    entityField.onChange(val);
                                    const accId = form.getValues(`lines.${index}.accountId`);
                                    if (accId && val) {
                                      const acc = allAccountsWithEntity.find((a) => a.value === accId);
                                      if (acc && acc.entityType !== val) form.setValue(`lines.${index}.accountId`, "", { shouldDirty: true });
                                    }
                                  }}
                                  disabled={!isFormEditing || deleteDisabledWhenLinked}
                                >
                                  <FormControl>
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder="Entity" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {ENTITY_OPTIONS.map((o) => (
                                      <SelectItem key={o.value || "all"} value={o.value || "__all__"}>{o.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          {/* Account – filtered by Entity; on select, entity auto-updates */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.accountId`}
                            render={({ field }: any) => (
                              <FormItem>
                                <div className="min-w-0 w-full flex items-center gap-1">
                                  <div className="min-w-0 flex-1 overflow-hidden">
                                    <Combobox
                                      triggerClassName={cn(
                                        "h-9 w-full min-w-0",
                                        linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200"),
                                        // Copy pending state: desktop field bhi force red; select ke baad auto-normal.
                                        journalLineNeedsCopyAccount(index) && "!border-red-400 !bg-red-100/80 !text-red-700"
                                      )}
                                      options={filteredAccounts}
                                      value={field.value}
                                      onChange={(value, newName) => handleJournalLineAccountChange(index, field, value, newName)}
                                      placeholder="Select account"
                                      addNewLabels={getJournalLineAddNewLabels(entityType)}
                                      disabled={!isFormEditing || deleteDisabledWhenLinked}
                                    />
                                  </div>
                                  {journalLineNeedsCopyAccount(index) && (
                                    // Desktop: red row label ki jagah Copy chip ko account field ki same line me rakho.
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 shrink-0 rounded-full px-2 text-[10px] leading-none !border-red-500 !bg-red-100 !text-red-700 hover:!bg-red-200 hover:!text-red-800"
                                        onClick={() => {
                                          setPendingCreateLineIndex(index);
                                          onCopyMissingCategory?.(getJournalCopyCategoryForLine(index, entityType), {
                                            journalLineIndex: index,
                                          });
                                        }}
                                      disabled={isCopyingMissingMasters}
                                    >
                                      {isCopyingMissingMasters ? "…" : "Copy"}
                                    </Button>
                                  )}
                                </div>
                                {balance !== undefined && (
                                  <div className={cn("text-xs font-semibold mt-1", balance >= 0 ? "text-green-600" : "text-red-600")}>
                                    Bal: {formatCurrencyForPrint(balance, { showDrCr: true, noAnimation: true })}
                                  </div>
                                )}
                              </FormItem>
                            )}
                          />

                          {/* Debit / Credit Type (Select) */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.type`}
                            render={({ field }: any) => (
                              <FormItem>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!isFormEditing || deleteDisabledWhenLinked || (isLastRow && fields.length > 1)}>
                                  <FormControl>
                                    <SelectTrigger
                                      className={cn(
                                        "w-24 h-9 justify-center",
                                        linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200")
                                      )}
                                    >
                                      <SelectValue placeholder="Type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent align="center">
                                    <SelectItem value="debit">Debit</SelectItem>
                                    <SelectItem value="credit">Credit</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (fields.length === 2) {
                                const type1 = form.getValues('lines.0.type');
                                const type2 = form.getValues('lines.1.type');
                                form.setValue('lines.0.type', type2);
                                form.setValue('lines.1.type', type1);
                              }
                            }}
                            className="h-9 w-9"
                            disabled={fields.length !== 2 || !isFormEditing}
                          >
                            <ArrowDownUp className="h-5 w-5 stroke-2"/>
                          </Button>

                          {/* Amount */}
                          <FormField
                            control={form.control}
                            name={`lines.${index}.amount`}
                            render={({ field }: any) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    className={cn(
                                      "h-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                                      linkedPartyLineIndices.has(index) && (lineType === "debit" ? "bg-green-50 border-green-200" : "bg-pink-50 border-pink-200"),
                                      selectedCardRelatedRowIndex === index && "animate-spend-wise-balance-blink"
                                    )}
                                    {...field}
                                    disabled={!isFormEditing}
                                    onFocus={(e) => {
                                      if (!voucher && e.target.value === "0") e.target.select();
                                    }}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      field.onChange(value);
                                      handleAmountChange(index, value);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {/* Delete Button */}
                          <div className="flex items-center">
                            {isFormEditing && fields.length > 2 && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={!isFormEditing}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {/* Desktop: totals ko isi outer journal section container ke andar hi rakho. */}
                    <div className="flex justify-end items-center mt-3 pt-1 gap-4">
                      <div className="bg-green-100 px-4 py-2 rounded text-sm font-medium">
                        Total Debit: {(form.watch("lines").filter(l => l.type === "debit").reduce((sum, l) => sum + (Number(l.amount) || 0), 0) + otherChargeAmountValue).toFixed(2)}
                      </div>
                      <div className="bg-red-100 px-4 py-2 rounded text-sm font-medium">
                        Total Credit: {form.watch("lines").filter(l => l.type === "credit").reduce((sum, l) => sum + (Number(l.amount) || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    </div>
                    {journalOtherChargeCard}
                    </div>
                  </div>
                </>
              )}
              {/* File lines ke baad, link cards se pehle — pehle attach phir link; same UX as payment/contra */}
              {/* Attachment + narration ko same ribbon tone do for section-wise visual consistency. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start min-w-0 rounded-lg border border-indigo-300/80 bg-indigo-50 p-3">
              <FormItem>
                <FormLabel>Attach Files (Optional)</FormLabel>
                {showPdfAsImageToggle && (
                  <VoucherPdfAsImageToggle
                    existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                    id="voucher-save-pdf-as-image-journal"
                    checked={savePdfAsImage}
                    onCheckedChange={setSavePdfAsImage}
                    disabled={!allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                    className="mb-2"
                  />
                )}
                <VoucherOcrRefreshBar ocr={ocr} />
                <RestrictedFileUploader>
                  <div className="flex flex-wrap gap-4">
                      {files.map((file, index) => (
                        <FilePreview 
                          key={typeof file === "string" ? file : `${file.name}-${file.size}-${index}`} 
                          file={file} 
                          attachmentCompanyId={companyId || undefined}
                          attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                          allowPreviewWhenDisabled
                          onRemove={allowAttachments && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete ? () => setFiles(prev => prev.filter((_, i) => i !== index)) : undefined}
                          className={!allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : ""}
                        />
                      ))}
                      {allowAttachments && fileAttachmentLimits.maxFileCount > 0 && files.length < fileAttachmentLimits.maxFileCount && (
                        <AttachmentHoldPasteSurface
                          enabled={isFormEditing && allowAttachments && fileAttachmentLimits.maxFileCount > 0}
                          onShortActivate={() => {
                            if (!isFormEditing) return;
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
                            "relative w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center transition-colors",
                            allowAttachments && fileAttachmentLimits.maxFileCount > 0
                              ? "text-muted-foreground hover:border-primary cursor-pointer"
                              : "text-muted-foreground/50 border-muted-foreground/25 cursor-not-allowed opacity-50"
                          )}
                        >
                          <PlusCircle className="h-6 w-6" />
                          <span className="text-xs mt-1">Add File</span>
                          <input
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
                            disabled={!allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                          />
                        </AttachmentHoldPasteSurface>
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
                      {/* Overall narration: static dialog me bhi poora text — resize + scroll */}
                      <Textarea
                        placeholder="e.g. Salary expense for the month of Baisakh"
                        {...field}
                        disabled={!isFormEditing}
                        className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
              {/* Link for bill wise: dono side se 5px inset taaki select ring dikhe. */}
              <div className="space-y-3 w-full max-w-full min-w-0 mb-[10px] px-[5px]">
                  {shouldShowJournalLinkButton && (
                    <div className="pb-1">
                      {/* One-click reveal keeps Journal form cleaner until user needs linking. */}
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSections(true)}>Show Link</Button>
                    </div>
                  )}
                  {shouldShowJournalLinkSections && (["debit", "credit"] as const).map((sideKey) => {
                    // Ledger se edit: counterparty side card mat dikhao — sirf opened account ki Dr/Cr card.
                    if (openedFromAccountId && !journalBillLinesBySide[sideKey]) return null;
                    const sideData = journalBillWiseBySide[sideKey];
                    const sideLabel = sideKey === "debit" ? "debit" : "credit";
                    const sideAccountLabel = sideData.sideLine?.partyId ? (accountLabelById.get(sideData.sideLine.partyId) || "—") : "";
                    const isDebitCard = sideKey === "debit";
                    // Keep same block-wise color style: debit green tone, credit pink tone.
                    const cardBg = isDebitCard ? "bg-green-50 border-green-300/80" : "bg-rose-50 border-rose-300/80";
                    // Fail-safe colors: even if utility cache misses, debit/credit card tones remain visible.
                    const cardStyle = isDebitCard
                      ? { backgroundColor: "#f0fdf4", borderColor: "#86efac" }
                      : { backgroundColor: "#fff1f2", borderColor: "#fda4af" };
                    const linkAccountBox = isDebitCard ? "border-green-200 bg-green-50/40 text-green-800" : "border-pink-200 bg-pink-50/40 text-pink-800";
                    return (
                      <div
                        key={sideKey}
                        role="button"
                        tabIndex={0}
                        data-billwise-side={sideKey}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Read side from DOM to avoid closure issues; Cr click was incorrectly selecting Dr.
                          const side = (e.currentTarget as HTMLElement).getAttribute("data-billwise-side") as "debit" | "credit" | null;
                          if (side) setSelectedBillWiseCard((prev) => (prev === side ? null : side));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const side = (e.currentTarget as HTMLElement).getAttribute("data-billwise-side") as "debit" | "credit" | null;
                            if (side) setSelectedBillWiseCard((prev) => (prev === side ? null : side));
                          }
                        }}
                        className={cn(
                          "space-y-2 rounded-lg border-2 p-3 w-full max-w-full min-w-0 overflow-hidden cursor-pointer transition-all",
                          cardBg,
                          selectedBillWiseCard === sideKey && "ring-2 ring-primary/60 ring-offset-2 shadow-md"
                        )}
                        style={cardStyle}
                      >
                        {/* Side label required by UX: show (debit)/(credit) directly in bill-wise title. */}
                        <div className="flex items-center gap-2 font-semibold border-b border-border/60 pb-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>Link for bill wise ({sideLabel})</span>
                        </div>
                        <div className={cn("w-fit rounded-md border px-2 py-1 text-xs", linkAccountBox)}>
                          {/* Show selected source account for this side; width fits text length. */}
                          Link account: <span className="font-semibold">{sideAccountLabel || "Select account row"}</span>
                        </div>
                        {!journalVoucherId ? (
                          <p className="text-sm text-blue-600">Save journal 1st to enable bill-wise linking details.</p>
                        ) : !sideData.sideLine ? (
                          <p className="text-sm text-muted-foreground">Select a {sideLabel} party/staff line with amount to show bill-wise link balance.</p>
                        ) : (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {sideData.rows.length} voucher(s) available to link.{sideData.rows.some((r) => r.linkedOnCurrent > 0) && ` ${sideData.rows.filter((r) => r.linkedOnCurrent > 0).length} linked.`}
                            </p>
                            {/* Table sirf linked vouchers ke liye dikhao; link kiye bina linkable list mat dikhao. */}
                            {!sideData.rows.some((r) => r.linkedOnCurrent > 0) ? null : (
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
                                    {sideData.rows.filter((r) => r.linkedOnCurrent > 0).map((row) => (
                                      <tr key={`${sideKey}-${row.voucherId}`} className="border-b border-border/30 last:border-b-0">
                                        <td className="p-2 text-muted-foreground whitespace-nowrap">{row.voucherNumber === "Opening Balance" || row.voucherNumber === "Book Opening" ? "—" : (row.date ? formatDate(row.date) : "—")}</td>
                                        <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                                        <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">
                                          {formatCurrencyForPrint(row.total || row.linkedOnCurrent, { noSuffix: true, noAnimation: true })}
                                        </td>
                                        <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
                                          {formatCurrencyForPrint(journalLinkedOnOthersByVoucherId.get(row.voucherId) ?? 0, { noSuffix: true, noAnimation: true })}
                                        </td>
                                        <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
                                          {formatCurrencyForPrint(row.linkedOnCurrent, { noSuffix: true, noAnimation: true })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            <div className="pt-2 border-t flex justify-end">
                              <div className="grid grid-cols-2 gap-1.5 text-sm w-fit min-w-0">
                                <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center">
                                  <span className="text-muted-foreground leading-tight">Total linked</span>
                                </div>
                                <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end">
                                  <span className="text-right whitespace-nowrap leading-tight">
                                    {formatCurrencyForPrint(sideData.linkedToTotal ?? 0, { noSuffix: true, noAnimation: true })}
                                  </span>
                                </div>
                                <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium">
                                  <span className="leading-tight">Balance</span>
                                </div>
                                <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium">
                                  <span className={cn("text-right whitespace-nowrap leading-tight", sideData.linkableRemaining === 0 ? "text-green-600 font-semibold" : "")}>
                                    {sideData.linkableRemaining === 0
                                      ? "Settled"
                                      : formatCurrencyForPrint(sideData.linkableRemaining, { noSuffix: true, noAnimation: true })}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {can('add_link') && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {/* Card-specific CTA: Debit links to Cr and Credit links to Dr, matching journal opposite-side flow. */}
                                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={(e) => { e.stopPropagation(); handleJournalAddLinkClick(sideKey); }}>
                                  <Link2 className="h-4 w-4 mr-2" />
                                  {sideKey === "debit" ? "Link to Cr" : "Link to Dr"}
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
            </div>
          </ScrollArea>

          {isFormEditing && <div className={cn("border-t min-w-0 max-w-full overflow-x-hidden", isMobile ? "mt-[3px] pt-[3px] pb-[3px]" : "pt-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4")}>
            {isMobile ? (
              <div className={cn("grid grid-cols-3 gap-2 w-full", VOUCHER_BUTTONS_CLASS)}>
                {/* Row 0: Delete (left) | History (middle) | Save & Print (right) */}
                <Button type="button" variant="destructive" className="w-full" disabled={!voucher || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                      Delete
                    </Button>
                <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher || !showHistoryButton || !onOpenHistory} className={cn("w-full", BTN_HISTORY_CLASS)}>
                  History
                </Button>
                <Button type="button" onClick={(e) => handleFormSubmit(e, { print: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_PRINT_CLASS)}>
                  Save & Print
                </Button>
                {/* Row 1: Cancel | Save | Approve (right) */}
                <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("w-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                {/* Pehle save ke baad `savedVoucherId` — tab bhi bina change Save band */}
                <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || ((!!voucher?.id || !!savedVoucherId) && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_SAVE_CLASS)}>
                  {isLoading ? "..." : isEditingAndConverting ? "Convert" : "Save"}
                </Button>
                {voucher?.id ? (
                  <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty || isEditingAndConverting) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting)} className={cn("w-full", BTN_APPROVE_CLASS)}>
                    {isApproving ? "..." : isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve"}
                  </Button>
                ) : showSaveAndApproveOnCreate ? (
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled} className={cn("w-full", BTN_APPROVE_CLASS)}>
                    {isLoading ? "..." : "Save & Approve"}
                  </Button>
                ) : (
                  <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">—</Button>
                )}
              </div>
            ) : (
              <>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher || !onOpenHistory} className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}>
                    <History className="mr-2 h-4 w-4" /> History
                  </Button>
                  <Button type="button" variant="destructive" className="w-full md:w-auto shrink-0 rounded-full" disabled={!voucher || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))} onClick={() => setIsDeleteDialogOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                </div>
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
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
                  <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || ((!!voucher?.id || !!savedVoucherId) && !isFormDirty && !isEditingAndConverting)} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditingAndConverting ? "Convert" : "Save"}
                  </Button>
                  {voucher?.id ? (
                    <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty || isEditingAndConverting) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={isAttachmentProcessing || editingDisabled || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty && !isEditingAndConverting)} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                      {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                      {isEditingAndConverting ? "Convert & Approve" : isFormDirty ? "Save & Approve" : "Approve"}
                    </Button>
                  ) : (
                    <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={!showSaveAndApproveOnCreate || isLoading || isAttachmentProcessing || editingDisabled} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save & Approve
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>}
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
      {/* Party-side Journal linking: "Link Journal Dr to Linkable Cr Txns" → show Cr list. "Link Journal Cr to Linkable Dr Txns" → show Dr list. */}
      <LinkPaymentToTxnsDialog
        isOpen={!!activeJournalLinkContext && activeJournalLinkContext.kind === "party"}
        onOpenChange={(open) => {
          if (!open) setActiveJournalLinkSide(null);
        }}
        variant={activeJournalLinkContext?.side === "debit" ? "payment_out" : "payment_in"}
        isJournalLinkDialog={activeJournalLinkContext?.kind === "party"}
        partyId={activeJournalLinkContext?.kind === "party" ? activeJournalLinkContext.accountId : null}
        partyName={activeJournalLinkContext?.kind === "party" ? activeJournalLinkContext.label : "Party"}
        receivedAmount={Number(activeJournalLinkContext?.amount ?? 0) || 0}
        existingAllocations={journalDialogExistingAllocations}
        paymentInId={journalVoucherId || null}
        paymentOutId={journalVoucherId || null}
        partyOpeningBalance={activePartySignedOpeningBalance}
        partyOpeningBalanceOutstanding={effectiveLedgerObOutstanding}
        ledgerBooksOpeningBalanceSigned={ledgerBooksOpeningBalanceSigned}
        dialogTitle={activeJournalLinkContext?.side === "debit" ? "Link Journal Dr to Linkable Cr Txns" : "Link Journal Cr to Linkable Dr Txns"}
        paymentInVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentOutVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentInDate={form.getValues("date")}
        paymentOutDate={form.getValues("date")}
        onDone={(allocations, _amount, info) => {
          const side = activeJournalLinkContext?.side;
          const accountId = activeJournalLinkContext?.accountId ?? "";
          if (!side) {
            setActiveJournalLinkSide(null);
            return;
          }
          const linkSide = side === "debit" ? "debit" : "credit";
          const computed = computeJournalBillWiseDialogDone(
            linkSide,
            accountId,
            allocations as Allocation[],
            journalDialogExistingAllocations,
            journalAllocationsBySide
          );
          // Unticked TDS legs must disappear from BOTH sides of the journal state, not just the dialog side.
          const removedTds = new Set(info?.removedTdsEntityIds ?? []);
          const dropTds = (arr: Allocation[]) =>
            removedTds.size ? arr.filter((x) => !removedTds.has(String((x as any)?.entityTxnId ?? ""))) : arr;
          const nextBySide = { debit: dropTds(computed.nextBySide.debit), credit: dropTds(computed.nextBySide.credit) };
          const merged = dropTds(computed.merged);
          const removedIds = computed.removedIds;
          setJournalAllocationsBySide(nextBySide);
          setActiveJournalLinkSide(null);
          if (journalVoucherId && companyId) {
            void persistJournalBillWiseLinks(merged, removedIds, nextBySide)
              .then(() =>
                removedTds.size
                  ? removeTdsLegLinks(companyId, journalVoucherId, [...removedTds], vouchers as any[])
                  : undefined
              )
              .catch((err) => {
              console.error("[CreateJournalForm] bill-wise link persist", err);
              sonnerToast.error("Could not save bill-wise links.", {
                description: err instanceof Error ? err.message : "Try saving the journal again.",
              });
            });
          }
        }}
      />
      {/* Staff-side Journal linking for credit card (to Dr sources): uses Payment In → Salary linking behavior. */}
      <LinkPaymentInToSalaryDialog
        isOpen={!!activeJournalLinkContext && activeJournalLinkContext.kind === "staff" && activeJournalLinkContext.side === "credit"}
        onOpenChange={(open) => {
          if (!open) setActiveJournalLinkSide(null);
        }}
        staffId={activeJournalLinkContext?.kind === "staff" ? activeJournalLinkContext.accountId : null}
        staffName={activeJournalLinkContext?.kind === "staff" ? activeJournalLinkContext.label : STAFF_ENTITY_LABEL}
        paymentInId={journalVoucherId || null}
        amountReceived={Number(activeJournalLinkContext?.amount ?? 0) || 0}
        existingAllocations={journalDialogExistingAllocations}
        staffOpeningBalance={Number(activeJournalLinkContext?.openingBalance ?? 0) || 0}
        paymentInVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentInDate={form.getValues("date")}
        onDone={(allocations) => {
          const accountId = activeJournalLinkContext?.accountId ?? "";
          const { nextBySide, merged, removedIds } = computeJournalBillWiseDialogDone(
            "credit",
            accountId,
            allocations as Allocation[],
            journalDialogExistingAllocations,
            journalAllocationsBySide
          );
          setJournalAllocationsBySide(nextBySide);
          setActiveJournalLinkSide(null);
          if (journalVoucherId && companyId) {
            void persistJournalBillWiseLinks(merged, removedIds, nextBySide).catch((err) => {
              console.error("[CreateJournalForm] bill-wise link persist", err);
              sonnerToast.error("Could not save bill-wise links.", {
                description: err instanceof Error ? err.message : "Try saving the journal again.",
              });
            });
          }
        }}
      />
      {/* Staff-side Journal linking for debit card (to Cr sources): uses Payment → Salary linking behavior. */}
      <LinkPaymentOutToSalaryDialog
        isOpen={!!activeJournalLinkContext && activeJournalLinkContext.kind === "staff" && activeJournalLinkContext.side === "debit"}
        onOpenChange={(open) => {
          if (!open) setActiveJournalLinkSide(null);
        }}
        staffId={activeJournalLinkContext?.kind === "staff" ? activeJournalLinkContext.accountId : null}
        staffName={activeJournalLinkContext?.kind === "staff" ? activeJournalLinkContext.label : STAFF_ENTITY_LABEL}
        paymentOutId={journalVoucherId || null}
        amountPaid={Number(activeJournalLinkContext?.amount ?? 0) || 0}
        existingAllocations={journalDialogExistingAllocations}
        staffOpeningBalance={Number(activeJournalLinkContext?.openingBalance ?? 0) || 0}
        paymentOutVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentOutDate={form.getValues("date")}
        onDone={(allocations) => {
          const accountId = activeJournalLinkContext?.accountId ?? "";
          const { nextBySide, merged, removedIds } = computeJournalBillWiseDialogDone(
            "debit",
            accountId,
            allocations as Allocation[],
            journalDialogExistingAllocations,
            journalAllocationsBySide
          );
          setJournalAllocationsBySide(nextBySide);
          setActiveJournalLinkSide(null);
          if (journalVoucherId && companyId) {
            void persistJournalBillWiseLinks(merged, removedIds, nextBySide).catch((err) => {
              console.error("[CreateJournalForm] bill-wise link persist", err);
              sonnerToast.error("Could not save bill-wise links.", {
                description: err instanceof Error ? err.message : "Try saving the journal again.",
              });
            });
          }
        }}
      />
      {/*
        Copy-draft master save ke baad: pehle row me id set, fir scoped ledger refresh (target company me naya master),
        fir mismatch recount (red Copy chip auto-hide). Bina ledger refresh ke Combobox naye id ka label nahi dikhata.
      */}
      <CreatePartyDialog onPartyCreated={(id) => { setIsCreatePartyOpen(false); applyCreatedAccountToPendingRow(id); void refreshScopedLedger(); void onRefreshCopyMismatch?.(); }} isOpen={isCreatePartyOpen} onOpenChange={setIsCreatePartyOpen} />
      <CreateBankAccountDialog onAccountCreated={(id) => { setIsCreateAccountOpen(false); applyCreatedAccountToPendingRow(id); void refreshScopedLedger(); void onRefreshCopyMismatch?.(); }} isOpen={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen} />
      <CreateStaffDialog onStaffCreated={(id) => { setIsCreateStaffOpen(false); applyCreatedAccountToPendingRow(id); void refreshScopedLedger(); void onRefreshCopyMismatch?.(); }} isOpen={isCreateStaffOpen} onOpenChange={setIsCreateStaffOpen} groups={[]} />
      <CreateExpenseAccountDialog
        defaultGroupType="expense"
        onExpenseAccountCreated={(id) => { setIsCreateExpenseOpen(false); applyCreatedAccountToPendingRow(id); void refreshScopedLedger(); void onRefreshCopyMismatch?.(); }}
        isOpen={isCreateExpenseOpen}
        onOpenChange={setIsCreateExpenseOpen}
      />
      <CreateTaxDialog
        prefillTaxName={journalTaxPrefillName}
        onTaxCreated={(id) => { setIsCreateTaxOpen(false); setJournalTaxPrefillName(""); applyCreatedAccountToPendingRow(id); void refreshScopedLedger(); void onRefreshCopyMismatch?.(); }}
        isOpen={isCreateTaxOpen}
        onOpenChange={(open) => {
          setIsCreateTaxOpen(open);
          if (!open) setJournalTaxPrefillName("");
        }}
      />
      <VoucherDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="journal"
        entityName={voucher?.voucherNumber || "this journal"}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
        busy={isLoading}
      />
    </>
  );
}
