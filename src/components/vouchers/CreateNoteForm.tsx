"use client";

import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_SEARCH_PLACEHOLDER } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { addDoc, collection, serverTimestamp, doc, updateDoc, deleteDoc, query, where } from "firebase/firestore";
import { getDoc, onSnapshot, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, storage } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { assertCan, assertCanPerformBackdated, assertCanEdit, PermissionDeniedError, determineVoucherOwnership } from "@/lib/permissions/enforcePermission";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoucherNumberInputWithRefresh } from "@/components/vouchers/VoucherNumberInputWithRefresh";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Loader2, Trash2, CalendarIcon, PlusCircle, CheckCircle, History, Printer } from "lucide-react";
import { VOUCHER_BUTTONS_CLASS, BTN_HISTORY_CLASS, BTN_PRINT_CLASS, BTN_CANCEL_CLASS, BTN_SAVE_NEW_CLASS, BTN_SAVE_CLASS, BTN_APPROVE_CLASS, VOUCHER_NARRATION_TEXTAREA_CLASS, VOUCHER_PC_DATE_ROW, VOUCHER_PC_DATE_BOTH_SLOT, VOUCHER_PC_DATE_BS_PILL, VOUCHER_PC_DATE_AD_PILL } from "@/components/vouchers/voucherButtonStyles";
import { FilePreview } from "./FilePreview";
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
  voucherAttachmentFieldsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import { cn } from "@/lib/utils";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Combobox } from "../ui/combobox";
import type { Party } from "@/components/party/types";
import type { Account } from "@/components/bank-cash/types";
import type { Staff } from "@/components/staff/types";
import type { Tax } from "@/components/tax/types";
import type { Item } from "@/components/items/types";
import type { ExpenseAccount } from "@/components/expenses/types";
import { useDate } from "@/hooks/useDate";
import { openPrintDirect } from "@/lib/printDirect";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { format, startOfDay } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { saveVoucher, isVoucherLimitError, patchVoucherFields, softDeleteVoucherMoveToRecycleBin } from "@/lib/voucherActionsClient";
import { normalizePrefix } from "@/lib/voucherNumberFormat";
import { getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { isLocalOnlyMode } from "@/lib/localMode";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import {
  applyVoucherAttachmentsAfterFormSave,
  finalizeVoucherAttachmentsAfterFormSave,
  uploadVoucherAttachmentFileToFirebase,
} from "@/lib/voucherFormAttachmentSave";
import { useVoucherAttachmentPostSaveSync } from "@/hooks/useVoucherAttachmentPostSaveSync";
import { toast as sonnerToast } from "sonner";
import { replaceVoucherSaveLoadingWithShortSuccess, beginVoucherSaveLoadingOrBlock, voucherSaveErrorToast } from "@/lib/voucherSaveUi";
import { useVouchers } from "@/hooks/useVouchers";
import { shouldBindFirebaseLedgerCollectionLiveListeners } from "@/lib/firebaseLedgerSyncPolicy";
import { listCompanyDocsFromBrowserDb, BROWSER_DB_COLLECTION_BUMP } from "@/lib/localCompanyDocMirror";
import { useIsMobile } from "@/hooks/use-mobile";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { CreateExpenseAccountDialog } from "@/components/expenses/CreateExpenseAccountDialog";

const formSchema = z.object({
  voucherNumber: z.string().min(1, "Voucher number is required."),
  date: z.date(),
  title: z.string().min(2, { message: "Note title is required." }),
  content: z.string().optional(),
  context: z.string().min(1, "Please select a context."),
  entityId: z.string().min(1, "Please select a specific entity."),
});

type NoteFormValues = z.infer<typeof formSchema>;

/** RHF+zod errors → toast */
function formatNoteFormValidationErrors(errors: FieldErrors<NoteFormValues>): string {
  const errorMessages: string[] = [];
  if (errors.voucherNumber?.message) errorMessages.push(`Note No.: ${errors.voucherNumber.message}`);
  if (errors.date?.message) errorMessages.push(`Date: ${errors.date.message}`);
  if (errors.title?.message) errorMessages.push(`Title: ${errors.title.message}`);
  if (errors.context?.message) errorMessages.push(`Link to: ${errors.context.message}`);
  if (errors.entityId?.message) errorMessages.push(`Entity: ${errors.entityId.message}`);
  return errorMessages.length > 0 ? errorMessages.join(", ") : "Please check all fields and try again.";
}

const getVoucherPrefix = (prefixes?: Record<string, string[]>) => (prefixes?.note && prefixes.note[0]) || "NOTE-";

function getInitialFormValues(initialContext?: string, initialEntityId?: string): NoteFormValues {
    return {
        voucherNumber: "",
        date: startOfDay(new Date()),
        title: "",
        content: "",
        context: initialContext || "",
        entityId: initialEntityId || "",
    };
}

/** Voucher / sync draft se poora Note form — recon sync ke liye title, context, entityId. */
function getInitialFormValuesFromVoucher(voucher: Record<string, unknown>): NoteFormValues {
  const rawDate = (voucher.date as { toDate?: () => Date })?.toDate
    ? (voucher.date as { toDate: () => Date }).toDate()
    : new Date(voucher.date as string | number | Date);
  const safeDate = Number.isFinite(rawDate.getTime()) ? rawDate : startOfDay(new Date());
  return {
    voucherNumber: String(voucher.voucherNumber ?? "").trim(),
    date: safeDate,
    title: String(voucher.title ?? "").trim(),
    content:
      typeof voucher.content === "string"
        ? voucher.content
        : String(voucher.narration || ""),
    context: String(voucher.context ?? ""),
    entityId: String(voucher.entityId ?? ""),
  };
}


export function CreateNoteForm({
    voucher,
    onVoucherAction,
    onOpenHistory,
    showHistoryButton,
    initialContext,
    initialEntityId,
    editingDisabled = false,
    showApproveButton = false,
    showSaveAndApproveOnCreate = false,
    onApprove,
    isApproving = false,
    compactFooter = false,
    recurringVoucherSaveBlocked = false,
    recurringVoucherAuxiliaryDirty = false,
}: {
    voucher?: any,
    onVoucherAction?: (status: 'saved' | 'cancelled', isSaveAndNew?: boolean, newId?: string) => void,
    onOpenHistory?: () => void,
    showHistoryButton?: boolean,
    initialContext?: string,
    initialEntityId?: string,
    editingDisabled?: boolean,
    showApproveButton?: boolean,
    showSaveAndApproveOnCreate?: boolean,
    onApprove?: () => void,
    isApproving?: boolean,
    /** When true, hide History / Save & New / Save & Print / Delete (used in entity "Add a New Note for..." dialogs; keep full buttons in New Transaction → Note for edit) */
    compactFooter?: boolean,
    recurringVoucherSaveBlocked?: boolean,
    recurringVoucherAuxiliaryDirty?: boolean,
}) {
  const { user, customUser } = useAuth();
  const { company, companyId } = useCompany();
  const { toast } = useToast();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { vouchers } = useVouchers();
  const { can, role, canPerformBackdatedAction, canEditRecord, canDeleteVoucher, fileAttachmentLimits, allowAttachments } = usePermissions();
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([]);
  const [files, setFiles] = useState<(File|string)[]>([]);
  /** Voucher preview: stable string[] ref taaki background re-render par blob pipeline dubara na chale. */
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
  const savedFileUrlsSnapshotRef = useRef<string[] | null>(null);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  /** Edit: Sale/Payment jaisa — same `voucher.id` par live snapshot se bar-bar reset mat (attachments delete wipe) */
  const lastResetVoucherIdRef = useRef<string | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  /** Delete confirmation open state (only used when !compactFooter i.e. New Transaction → Note) */
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  /** Specific entity combobox se "Add new" — search mein match na ho to bhi yahi dialogs (Payment In / Direct Income jaisa flow) */
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [isCreateBankOpen, setIsCreateBankOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  /** CreateTaxDialog prefillTaxName → CreateTaxForm name field (document event yahan use nahi) */
  const [taxCreatePrefillName, setTaxCreatePrefillName] = useState("");
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreateIncomeAccountOpen, setIsCreateIncomeAccountOpen] = useState(false);
  const [isCreateExpenseAccountOpen, setIsCreateExpenseAccountOpen] = useState(false);

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: getInitialFormValues(voucher?.context || initialContext, voucher?.entityId || initialEntityId),
    mode: "onChange", // Run validation on change so Save enables when form is valid
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.note(),
    form: form as never,
    files,
    setFiles: setFiles as never,
    ownName: ((company as { name?: string } | null)?.name) || null,
    companyId: companyId,
    ownPan: ((company as { pan?: string; panNumber?: string } | null)?.pan ?? (company as { panNumber?: string } | null)?.panNumber) || null,
    parties: ([]) as never,
    items: [],
    taxes: ([]) as never,
    autoPost: () => void handleFormSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as React.FormEvent, { ocrAutoPost: true }),
    isEditing: !!(voucher as { id?: string } | null | undefined)?.id,
    disabled: !!editingDisabled,
  });

  const { isDirty: _isFormFieldsDirty, isValid: isFormValid } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f: unknown) => typeof f === "string") as string[];
    const newFiles = files.filter((f: unknown): f is File => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u, i) => u !== init[i]);
  })();
  const isFormDirty = _isFormFieldsDirty || _isFileDirty || recurringVoucherAuxiliaryDirty;
  const selectedContext = form.watch("context");
  // Page-level Add Note dialogs always use compact footer for consistent button set.
  const isEntityAddNoteDialog = !voucher?.id && Boolean(initialContext) && Boolean(initialEntityId);
  // Compact footer removes Delete/History/Save&New/Save&Print and keeps only Cancel/Save/Save&Approve.
  const useCompactFooter = compactFooter || isEntityAddNoteDialog;
  // Role-based permission for Save & Approve button state.
  const canApproveTransactions = can("approve_transactions");
  // Entity Add Note create-flow should show Save & Approve consistently across all pages.
  const canShowCreateApproveButton = showSaveAndApproveOnCreate || isEntityAddNoteDialog;
  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.note ?? true;
  /** Edit-convert: source voucher note na ho to naya NOTE prefix/number generate karna hai. */
  const isEditingAndConverting = Boolean(voucher?.id) && String(voucher?.type || "") !== "note";
  const isVoucherEditingAllowed = company?.allowVoucherNumberEditing?.note ?? false;
  const isPrefixSelectionEnabled = company?.enableVoucherPrefixSelection?.note ?? false;
  const voucherPrefixes = useMemo(() => company?.voucherPrefixes?.note || [getVoucherPrefix(company?.voucherPrefixes as Record<string, string[]> | undefined)], [company]);

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
      const nextNo = await getNextVoucherNumberForCompany({
        companyId,
        companyDoc: company as Record<string, unknown>,
        voucherLike: { type: "note" },
        selectedPrefix,
        voucherDate: form.getValues("date"),
      });
      form.setValue("voucherNumber", nextNo);
      form.trigger();
    } catch (error) {
      console.error(error);
    }
  }, [companyId, company, form, isAutoVoucherEnabled]);

  useEffect(() => {
    // Convert mode me `voucher.id` present hota hai, phir bhi target note ka fresh prefix-number chahiye.
    if (!voucher?.id || isEditingAndConverting) fetchVoucherNumber();
  }, [voucher?.id, isEditingAndConverting, fetchVoucherNumber]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(voucher?.id && savedVoucherId && !isEditingAndConverting),
    shouldFetchNextOnDateChange: Boolean((!voucher?.id || isEditingAndConverting) && isAutoVoucherEnabled),
    fetchVoucherNumber,
    resolvePrefix: () =>
      resolvePrefixFromVoucherNumber(
        String(form.getValues("voucherNumber") || ""),
        voucherPrefixes,
        voucherPrefixes[0]
      ),
  });

  useEffect(() => {
    if (!voucher) {
      lastResetVoucherIdRef.current = undefined;
      return;
    }
    const vid = voucher.id as string | undefined;
    if (vid) {
      if (lastResetVoucherIdRef.current === vid) return;
      lastResetVoucherIdRef.current = vid;
      const d =
        voucher.date instanceof Date
          ? voucher.date
          : voucher.date?.toDate
            ? voucher.date.toDate()
            : new Date();
      form.reset(getInitialFormValuesFromVoucher(voucher));
      queueMicrotask(() => {
        form.clearErrors();
        void form.trigger();
      });
    } else {
      // Recon sync draft — poora note form load (title/context/entityId khali na rahe)
      const cref = voucher.crossCopySourceRef as { companyId?: string; voucherId?: string } | undefined;
      const syncDraftKey =
        cref?.companyId && cref?.voucherId
          ? `sync:${cref.companyId}|${cref.voucherId}`
          : `new:note|${String(voucher.entityId || "")}|${String(voucher.title || "").slice(0, 40)}`;
      if (lastResetVoucherIdRef.current === syncDraftKey) return;
      lastResetVoucherIdRef.current = syncDraftKey;
      form.reset(getInitialFormValuesFromVoucher(voucher));
      queueMicrotask(() => {
        form.clearErrors();
        void form.trigger();
      });
    }
    const urls = voucherAttachmentUrlsForFormState(voucher);
    if (urls.length > 0) {
      setFiles(urls);
      initialFilesRef.current = urls.filter((f): f is string => typeof f === "string");
      setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
    } else {
      setFiles([]);
      initialFilesRef.current = [];
      setSavePdfAsImage(false);
    }
  }, [voucher, form]);

  useVoucherAttachmentPostSaveSync({
    traceSource: "CreateNoteForm",
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
    if (!companyId) return;
    if (!shouldBindFirebaseLedgerCollectionLiveListeners()) {
      let cancelled = false;
      const load = async () => {
        try {
          const [p, a, s, t, i, e] = await Promise.all([
            listCompanyDocsFromBrowserDb(companyId, "parties", { forBackupMerge: true }),
            listCompanyDocsFromBrowserDb(companyId, "bank_accounts", { forBackupMerge: true }),
            listCompanyDocsFromBrowserDb(companyId, "staff", { forBackupMerge: true }),
            listCompanyDocsFromBrowserDb(companyId, "taxes", { forBackupMerge: true }),
            listCompanyDocsFromBrowserDb(companyId, "items", { forBackupMerge: true }),
            listCompanyDocsFromBrowserDb(companyId, "expense_accounts", { forBackupMerge: true }),
          ]);
          if (cancelled) return;
          setParties(p as Party[]);
          setAccounts(a as Account[]);
          setStaff(s as Staff[]);
          setTaxes(t as Tax[]);
          setItems(i as Item[]);
          setExpenseAccounts(
            (e as ExpenseAccount[]).filter((row) => !(row as { isDeleted?: boolean }).isDeleted)
          );
        } catch {
          /* SQLite optional */
        }
      };
      void load();
      const onBump = (ev: Event) => {
        const d = (ev as CustomEvent<{ companyId?: string; collection?: string }>).detail;
        if (!d || d.companyId !== companyId) return;
        void load();
      };
      window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      return () => {
        cancelled = true;
        window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      };
    }
    const unsubFns = [
      onSnapshot(query(collection(firestore, `companies/${companyId}/parties`)), (snap) => setParties(snap.docs.map(d=>({id: d.id, ...d.data()} as Party)))),
      onSnapshot(query(collection(firestore, `companies/${companyId}/bank_accounts`)), (snap) => setAccounts(snap.docs.map(d=>({id: d.id, ...d.data()} as Account)))),
      onSnapshot(query(collection(firestore, `companies/${companyId}/staff`)), (snap) => setStaff(snap.docs.map(d=>({id: d.id, ...d.data()} as Staff)))),
      onSnapshot(query(collection(firestore, `companies/${companyId}/taxes`)), (snap) => setTaxes(snap.docs.map(d=>({id: d.id, ...d.data()} as Tax)))),
      onSnapshot(query(collection(firestore, `companies/${companyId}/items`)), (snap) => setItems(snap.docs.map(d=>({id: d.id, ...d.data()} as Item)))),
      onSnapshot(query(collection(firestore, `companies/${companyId}/expense_accounts`)), (snap) => setExpenseAccounts(snap.docs.map(d=>({id: d.id, ...d.data()} as ExpenseAccount)).filter((a: ExpenseAccount) => !(a as any).isDeleted))),
    ];
    return () => unsubFns.forEach(fn => fn());
  }, [companyId]);

  const getEntityOptions = useCallback(() => {
    switch (selectedContext) {
      case "Party": return parties.map(p => ({ value: p.id, label: p.name }));
      case "Bank/Cash": return accounts.map(a => ({ value: a.id, label: a.accountName }));
      case "Staff": return staff.map(s => ({ value: s.id, label: s.name }));
      case "Tax": return taxes.map(t => ({ value: t.id, label: t.name }));
      case "Items": return items.map(i => ({ value: i.id, label: i.name }));
      case "Income": return expenseAccounts.filter((a: ExpenseAccount) => a.type === "Income").map(a => ({ value: a.id, label: a.name }));
      case "Expense": return expenseAccounts.filter((a: ExpenseAccount) => (a.type === "Expense" || a.type === "Salary" || !a.type)).map(a => ({ value: a.id, label: a.name }));
      default: return [];
    }
  }, [selectedContext, parties, accounts, staff, taxes, items, expenseAccounts]);

  // Note → Specific entity Combobox: user ko typed filter dikhane ke liye context-specific placeholder
  const entityComboboxSearchPlaceholder = useMemo(() => {
    switch (selectedContext) {
      case "Party": return "Search party by name…";
      case "Bank/Cash": return "Search bank / cash account…";
      case "Staff": return STAFF_ENTITY_SEARCH_PLACEHOLDER.replace('...', '…');
      case "Tax": return "Search tax…";
      case "Items": return "Search item…";
      case "Income": return "Search income account…";
      case "Expense": return "Search expense account…";
      default: return "Search…";
    }
  }, [selectedContext]);

  // Combobox empty-state: "+ Add new …" label (context ke hisaab)
  const entityAddNewLabel = useMemo(() => {
    switch (selectedContext) {
      case "Party": return "+ Add New Party";
      case "Bank/Cash": return "+ Add New Account";
      case "Staff": return `+ Add New ${STAFF_ENTITY_LABEL}`;
      case "Tax": return "+ Add New Tax Ledger";
      case "Items": return "+ Add New Item";
      case "Income": return "+ Add New Income Account";
      case "Expense": return "+ Add New Expense Account";
      default: return undefined;
    }
  }, [selectedContext]);

  /** Search se kuch na mile / add-new row: naya entity banakar entityId set karo + prefill event (Create* forms sunte hain) */
  const openCreateEntityFromCombobox = useCallback(
    (newName?: string) => {
      const name = typeof newName === "string" ? newName : "";
      const fire = (event: string, detail: unknown) => {
        setTimeout(() => document.dispatchEvent(new CustomEvent(event, { detail })), 100);
      };
      switch (selectedContext) {
        case "Party":
          setIsCreatePartyOpen(true);
          fire("prefill-create-party-name", name);
          break;
        case "Bank/Cash":
          setIsCreateBankOpen(true);
          fire("prefill-create-bank-account-name", name);
          break;
        case "Staff":
          setIsCreateStaffOpen(true);
          fire("prefill-create-staff-name", name);
          break;
        case "Tax":
          setTaxCreatePrefillName(name);
          setIsCreateTaxOpen(true);
          break;
        case "Items":
          setIsCreateItemOpen(true);
          fire("prefill-create-item-name", { name, type: "item" });
          break;
        case "Income":
          setIsCreateIncomeAccountOpen(true);
          fire("prefill-create-expense-account-name", name);
          break;
        case "Expense":
          setIsCreateExpenseAccountOpen(true);
          fire("prefill-create-expense-account-name", name);
          break;
        default:
          break;
      }
    },
    [selectedContext]
  );

  // When Link to (context) changes, clear entityId if current value is not in the new options
  useEffect(() => {
    const opts = getEntityOptions();
    const currentId = form.getValues("entityId");
    if (currentId && opts.length > 0 && !opts.some((o: { value: string }) => o.value === currentId)) {
      form.setValue("entityId", "");
    }
  }, [selectedContext, getEntityOptions, form]);

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

  // Validated `data` — nested mobile date + `getValues()` से miss न हो
  function handleFormSubmit(e: React.FormEvent, options: { ocrAutoPost?: boolean; saveAndNew?: boolean; saveAndPrint?: boolean; approveAfterSave?: boolean } = {}) {
    e?.preventDefault?.();
    void form.handleSubmit(
      async (data) => {
        await processAndSave(data, options.saveAndNew, options.approveAfterSave ? onApprove : undefined, options.approveAfterSave, options.saveAndPrint);
      },
      (errors) => {
        sonnerToast.error("Validation Failed", { description: formatNoteFormValidationErrors(errors) });
      }
    )(e);
  }

  async function processAndSave(values: NoteFormValues, saveAndNew: boolean = false, onSuccess?: () => void, approveAfterSave?: boolean, saveAndPrint?: boolean) {
    if (!user || !companyId) return;
    if (isAttachmentProcessing) {
      sonnerToast.message("Please wait", { description: "File compression is still running." });
      return;
    }
    
    try {
      // Permission check: create or edit
      const isEdit = !!voucher?.id;
      const voucherDate = values.date instanceof Date ? values.date : new Date(values.date);
      
      if (isEdit) {
        // Check edit permission - determine ownership
        const fetchVoucher = async (cid: string, vid: string) => {
          const voucherDoc = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
          return voucherDoc.exists() ? voucherDoc.data() : null;
        };
        const isOwnRecord = await determineVoucherOwnership(voucher, voucher?.id || null, [], user.uid, companyId, fetchVoucher);
        assertCanEdit(canEditRecord, isOwnRecord);
        
        // Check backdate limit for edit - use ORIGINAL voucher date, not form date
        let originalVoucherDate = voucherDate;
        if (voucher?.date) {
          originalVoucherDate = voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date);
        } else if (voucher?.id && companyId) {
          const voucherDoc = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, voucher.id));
          if (voucherDoc.exists()) {
            const voucherData = voucherDoc.data();
            originalVoucherDate = voucherData.date?.toDate ? voucherData.date.toDate() : new Date(voucherData.date);
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
    
    const toastId = await beginVoucherSaveLoadingOrBlock(companyId, "Saving note...");
    if (toastId == null) return;
    setIsLoading(true);

    try {
        const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });

        let fileUrls = [...filesForSave.filter(f => typeof f === 'string')];
        let preGeneratedVoucherId: string | undefined;
        const toUpload = filesForSave.filter(f => typeof f !== 'string') as File[];

        if (toUpload.length > 0) {
          const totalNewBytes = toUpload.reduce((s, f) => s + (f.size || 0), 0);
          const limitCheck = await checkStorageLimitSafe(companyId, company?.planId, { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes }, company?.storageOption);
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
            setIsLoading(false);
            return;
          }
          if (await shouldStageNewVoucherFilesAsLocalPending(companyId)) {
            const { fileUrls: merged, preGeneratedVoucherId: preGen } =
              await appendLocalOnlyVoucherFilesToUrls({
                companyId,
                storageFolder: "note",
                existingFileUrls: fileUrls,
                newFiles: toUpload,
                maxFileCount: fileAttachmentLimits.maxFileCount,
                existingVoucherId: voucher?.id ?? null,
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
                storageFolder: "note",
                existingFileUrls: fileUrls,
                files: toUpload,
                existingVoucherId: voucher?.id ?? null,
              });
              fileUrls = up.fileUrls;
              if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
            }
          }
        }

        const options = getEntityOptions();
        const entityName = options.find(opt => opt.value === values.entityId)?.label || values.entityId;
        
        const submissionData = { 
          voucherNumber: values.voucherNumber,
          date: values.date,
          title: values.title,
          content: values.content || "",
          context: values.context,
          entityId: values.entityId,
          entityName: entityName,
          ...voucherAttachmentFieldsForSave(fileUrls, voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))),
          type: 'note',
          amount: 0
        };

        const isEdit = !!voucher?.id;
        const approverName = customUser?.displayName || user?.displayName || user?.email || user?.uid;
        savedFileUrlsSnapshotRef.current = fileUrls.filter((u) => Boolean(String(u).trim()));
        const result = await saveVoucher(
          companyId,
          user.uid,
          submissionData,
          voucher?.id,
          approveAfterSave ? { approvedByUserId: user.uid, approvedByName: approverName } : undefined,
          preGeneratedVoucherId ? { preGeneratedVoucherId } : undefined
        );

        const docId = result?.id;
        if (docId) setSavedVoucherId(docId);
        const approveBanner = !!(approveAfterSave && docId);
        // Save & Close: dialog turant band — approve/print background (`postSaveTail`).
        if (approveBanner) {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEdit ? "Note updated and approved." : "Note saved and approved."
          );
        } else {
          replaceVoucherSaveLoadingWithShortSuccess(
            toastId,
            isEdit ? "Note updated!" : "Note Saved!"
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
              storageFolder: "note",
              previousUrls: initialFilesRef.current,
            });
            initialFilesRef.current = [...persistedUrls];
            savedFileUrlsSnapshotRef.current = [...persistedUrls];
            setFiles(persistedUrls);
          } catch (attachErr) {
            console.warn("[CreateNoteForm] post-save attachment finalize", attachErr);
          }
        }

        const postSaveTail = async () => {
          // New create: saveVoucher(approveAfterSave) already wrote isApproved — do not
          // call approveVoucherWithHistory (Firestore lookup races "Voucher not found").
          if (saveAndNew) {
            form.reset(getInitialFormValues(initialContext, initialEntityId));
            setFiles([]);
            setSavePdfAsImage(false);
            initialFilesRef.current = [];
            lastResetVoucherIdRef.current = undefined;
            fetchVoucherNumber();
          } else {
            /* file state already synced via applyVoucherAttachmentsAfterFormSave above */
          }

          onSuccess?.();

          if (saveAndPrint && docId && company) {
            const noteDate = values.date instanceof Date ? values.date : new Date(values.date);
            const dateStr = dateSystem === "Both" ? `${formatDateBS(noteDate)} / ${formatDate(noteDate)}` : (dateSystem === "BS" ? formatDateBS(noteDate) : formatDate(noteDate));
            openPrintDirect({
              company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, logoUrl: company.logoUrl },
              title: `Note: ${values.voucherNumber}`,
              context: "daybook",
              dateSystem: dateSystem as "AD" | "BS" | "Both",
              dateRangeText: dateStr,
              vouchersCount: 1,
              openingBalance: 0,
              transactions: [],
              customContent: [
                { text: "Note", fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
                {
                  table: {
                    body: [
                      ["Note No.", values.voucherNumber],
                      ["Date", dateStr],
                      ["Title", values.title || "—"],
                      ["Link to", values.context || "—"],
                      ["Entity", entityName || "—"],
                      ["Details", (values.content || "—") as string],
                    ],
                    widths: [100, "*"],
                  },
                },
              ],
            }, true);
          }

          if (saveAndNew) {
            onVoucherAction?.("saved", true, docId ?? undefined);
          }
        };

        if (!saveAndNew) {
          void postSaveTail().catch((err) => {
            console.error("[CreateNoteForm] post-save tail", err);
            sonnerToast.error("Note saved — finishing steps pending", {
              description: err instanceof Error ? err.message : "Print may still run.",
              duration: 4500,
            });
          });
          return;
        }

        await postSaveTail();
    } catch (err) {
        if (err instanceof PermissionDeniedError) {
          sonnerToast.error("Permission Denied", { id: toastId, description: err.message });
        } else if (isVoucherLimitError(err)) {
          sonnerToast.error("Voucher limit reached", { id: toastId, description: err.message, action: { label: "Upgrade", onClick: () => window.location.assign("/billing") } });
        } else {
          voucherSaveErrorToast(toastId, err, "Save failed.");
        }
    } finally {
        setIsLoading(false);
    }
  }

  /** Soft-delete note (move to bin). Used only when !compactFooter; enabled in edit when canDeleteVoucher. */
  const handleDelete = async () => {
    if (!voucher?.id || !companyId || !user) return;
    try {
      assertCan(can, "delete_records");
      if (!canDeleteVoucher(voucher)) {
        sonnerToast.error("Permission Denied", { description: "You cannot delete this voucher." });
        return;
      }
      const voucherDate = voucher?.date?.toDate ? voucher.date.toDate() : (voucher?.date ? new Date(voucher.date) : new Date());
      assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        sonnerToast.error("Permission Denied", { description: err.message });
      } else {
        sonnerToast.error("Error", { description: "Failed to check permissions." });
      }
      return;
    }
    setIsLoading(true);
    try {
      // Local/offline compatible delete: hard delete ke badle recycle-bin mark.
      await softDeleteVoucherMoveToRecycleBin(companyId, voucher.id, user.uid);
      sonnerToast.success("Note moved to bin.");
      onVoucherAction?.("cancelled");
    } catch (err) {
      console.error("Error deleting note:", err);
      sonnerToast.error("Error", { description: "Failed to delete note." });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!voucher?.id || !companyId || !user) return;
    try {
      assertCanPermanentDeleteFromForm(can, role);
      if (!canDeleteVoucher(voucher)) {
        sonnerToast.error("Permission Denied", { description: "You cannot delete this voucher." });
        return;
      }
      const voucherDate = voucher?.date?.toDate ? voucher.date.toDate() : (voucher?.date ? new Date(voucher.date) : new Date());
      assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        sonnerToast.error("Permission Denied", { description: err.message });
      } else {
        sonnerToast.error("Error", { description: "Failed to check permissions." });
      }
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteVoucherFromForm(companyId, voucher.id);
      sonnerToast.success("Note deleted permanently.");
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled");
    } catch (err) {
      console.error("Error permanently deleting note:", err);
      sonnerToast.error("Error", { description: "Failed to permanently delete note." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
    <Form {...form}>
      <form onSubmit={(e) => handleFormSubmit(e)} className="h-full flex flex-col min-w-0 w-full max-w-full">
        <ScrollArea className={cn("flex-1 min-h-0 overflow-x-hidden min-w-0 w-full", !isMobile && "pr-6 -mr-6")}>
            <div className={cn(
              "space-y-4 min-w-0 max-w-full w-full overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full",
              isMobile ? "" : "px-[2px]"
            )}>
              {/* Section 1: Note No + Date in one ribbon container. */}
              <div className="rounded-lg border border-sky-300/80 bg-sky-50 p-3">
              {/* Voucher No. and Date */}
              {isMobile ? (
                <>
                  {/* Mobile: Prefix + Note No. + Date — `date` को `voucherNumber` के अंदर nest नहीं */}
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
                                  <FormLabel className="text-xs truncate">Note No.</FormLabel>
                                  <FormControl>
                                    <VoucherNumberInputWithRefresh {...voucherField} chromeSize="sm" className="h-9 text-xs px-2 min-w-0 max-w-full truncate w-full" disabled={isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers'))} onRefresh={() => void fetchVoucherNumber()} showRefresh={isAutoVoucherEnabled && !savedVoucherId} />
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
                                          <Button variant="outline" className={cn("h-9 pl-2 pr-2 text-left font-normal text-xs w-full min-w-0 max-w-full truncate", !dateField.value && "text-muted-foreground")}>
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
                          <FormLabel>Note No.</FormLabel>
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
                              <VoucherNumberInputWithRefresh
                                {...field}
                                className="h-10"
                                disabled={isAutoVoucherEnabled && (!isVoucherEditingAllowed || !can('edit_voucher_numbers'))}
                                onRefresh={() => void fetchVoucherNumber()}
                                showRefresh={isAutoVoucherEnabled && !savedVoucherId}
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
                                className={VOUCHER_PC_DATE_BS_PILL}
                              />
                              </div>
                            )}
                            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <div className={cn(dateSystem === 'Both' ? VOUCHER_PC_DATE_BOTH_SLOT : "w-full min-w-0")}>
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
                                <PopoverTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    className={cn(VOUCHER_PC_DATE_AD_PILL, !field.value && "text-muted-foreground")}
                                  >
                                    {field.value instanceof Date && !isNaN(field.value.getTime()) ? formatDate(field.value) : "Select Date"}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
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
              {/* Section 2: Title + Link To + Specific Party/Entity in one ribbon container. */}
              <div className="rounded-lg border border-violet-300/80 bg-violet-50 p-3 space-y-4">
                <FormField control={form.control} name="title" render={({ field }: any) => (<FormItem><FormLabel>Title</FormLabel><FormControl><Input placeholder="Note title" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                     <FormField control={form.control} name="context" render={({ field }: any) => (
                        <FormItem><FormLabel>Link to</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select context" /></SelectTrigger></FormControl><SelectContent><SelectItem value="Party">Party</SelectItem><SelectItem value="Bank/Cash">Bank/Cash Account</SelectItem><SelectItem value="Staff">{STAFF_ENTITY_LABEL}</SelectItem><SelectItem value="Tax">Tax</SelectItem><SelectItem value="Items">Items</SelectItem><SelectItem value="Income">Income</SelectItem><SelectItem value="Expense">Expense</SelectItem></SelectContent></Select></FormItem>
                     )} />
                    <FormField control={form.control} name="entityId" render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>{selectedContext ? `Specific ${selectedContext}` : "Specific Party / Entity"}</FormLabel>
                        {/* Keep combobox in same section; disable until Link to context is selected. */}
                        <FormControl>
                          <Combobox
                            options={getEntityOptions()}
                            value={field.value}
                            onChange={(id, newName) => {
                              if (id === "add-new") {
                                openCreateEntityFromCombobox(newName);
                                return;
                              }
                              field.onChange(id);
                            }}
                            placeholder={selectedContext ? "Select entity" : "Select link to first"}
                            searchPlaceholder={entityComboboxSearchPlaceholder}
                            addNewLabel={entityAddNewLabel}
                            disabled={editingDisabled || !selectedContext}
                            contentWidthMode="auto"
                            popoverModal={false}
                            autoFocusSearchOnOpen
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                </div>
              </div>
              {/* Section 3: Attachment + Narration together; mobile stacks, desktop puts narration on right. */}
              <div className="rounded-lg border border-amber-300/80 bg-amber-50 p-3">
                <div className={cn("grid gap-4 items-start", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                <div className="space-y-2">
                  <FormLabel>Attach Files (Optional)</FormLabel>
                  {showPdfAsImageToggle && (
                    <VoucherPdfAsImageToggle
                      existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                      id="voucher-save-pdf-as-image-note"
                      checked={savePdfAsImage}
                      onCheckedChange={setSavePdfAsImage}
                      disabled={!allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                      className="mb-2"
                    />
                  )}
                  <VoucherOcrRefreshBar ocr={ocr} />
                  <RestrictedFileUploader>
                    <div className="flex flex-wrap gap-4">
                      {files.map((file, idx) => (
                        <FilePreview 
                          key={idx} 
                          file={file} 
                          attachmentCompanyId={companyId || undefined}
                          attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={voucher?.id ? `vouchers/${voucher.id}` : null}
                          onRemove={
                            allowAttachments && fileAttachmentLimits.maxFileCount > 0 && fileAttachmentLimits.allowDelete
                              ? () => setFiles((prev) => prev.filter((_, i) => i !== idx))
                              : undefined
                          }
                          className={!allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : ""}
                        />
                      ))}
                      {allowAttachments && fileAttachmentLimits.maxFileCount > 0 && files.length < fileAttachmentLimits.maxFileCount && (
                        <>
                          <AttachmentHoldPasteSurface
                            enabled={!editingDisabled && allowAttachments && fileAttachmentLimits.maxFileCount > 0}
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
                              "w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center transition-colors",
                              allowAttachments && fileAttachmentLimits.maxFileCount > 0
                                ? "cursor-pointer hover:border-primary"
                                : "cursor-not-allowed opacity-50"
                            )}
                          >
                            <PlusCircle className="h-6 w-6 text-muted-foreground" />
                            <span className="text-[10px] mt-1">Add File</span>
                          </AttachmentHoldPasteSurface>
                          <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
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
                        </>
                      )}
                    </div>
                  </RestrictedFileUploader>
                </div>
                <FormField control={form.control} name="content" render={({ field }: any) => (
                  <FormItem data-ocr-field="bill-no" className="min-w-0">
                    <FormLabel>Narration</FormLabel>
                    <FormControl>
                      {/* resize-y + max-h: static PC dialog me lambi narration scroll / drag se poori dikhe */}
                      <Textarea placeholder="Narration..." {...field} rows={6} className={cn(VOUCHER_NARRATION_TEXTAREA_CLASS)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                </div>
              </div>
            </div>
        </ScrollArea>
        <div className={cn("border-t min-w-0 max-w-full overflow-x-hidden shrink-0 bg-background", isMobile ? "mt-[3px] pt-[3px] pb-[max(6px,env(safe-area-inset-bottom,0px))]" : "pt-4 flex flex-col md:flex-row items-stretch md:items-center gap-4", !isMobile && useCompactFooter && "justify-end", !isMobile && !useCompactFooter && "justify-between")}>
            {isMobile ? (
              <div className={cn("grid grid-cols-3 gap-2 w-full min-w-0", VOUCHER_BUTTONS_CLASS)}>
                {!useCompactFooter && (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full"
                      disabled={!voucher?.id || editingDisabled || (!!voucher && !canDeleteVoucher(voucher))}
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      Delete
                    </Button>
                    <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher || !showHistoryButton || !onOpenHistory} className={cn("w-full", BTN_HISTORY_CLASS, (!voucher || !showHistoryButton || !onOpenHistory) && "opacity-60")}>History</Button>
                    <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("w-full", BTN_SAVE_NEW_CLASS)}>Save & New</Button>
                    <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndPrint: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("w-full", BTN_PRINT_CLASS)}>Save & Print</Button>
                  </>
                )}
                {/* Mobile row: Cancel | Save | Approve — approve daayen (baaki forms jaisa) */}
                <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("w-full", BTN_CANCEL_CLASS)}>Cancel</Button>
                <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || !isFormValid || (!!voucher?.id && !isFormDirty)} className={cn("w-full", BTN_SAVE_CLASS)}>{isLoading ? "..." : "Save"}</Button>
                {voucher?.id ? (
                  <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={editingDisabled || isAttachmentProcessing || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty)} className={cn("w-full", BTN_APPROVE_CLASS)}>{isApproving ? "..." : isFormDirty ? "Save & Approve" : "Approve"}</Button>
                ) : canShowCreateApproveButton ? (
                  <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={!canApproveTransactions || isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("w-full", BTN_APPROVE_CLASS)}>{isLoading ? "..." : "Save & Approve"}</Button>
                ) : (
                  <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">—</Button>
                )}
              </div>
            ) : (
              <>
                {!useCompactFooter && (
                  <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                    <Button
                      type="button"
                      variant="destructive"
                      className="shrink-0 rounded-full"
                      disabled={!voucher?.id || editingDisabled || (!!voucher && !canDeleteVoucher(voucher))}
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                    <Button type="button" onClick={onOpenHistory ?? (() => {})} disabled={!voucher || !showHistoryButton || !onOpenHistory} className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS, (!voucher || !showHistoryButton || !onOpenHistory) && "opacity-60")}>
                      <History className="mr-2 h-4 w-4" /> History
                    </Button>
                  </div>
                )}
                <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                  <Button type="button" onClick={() => onVoucherAction?.('cancelled')} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>Cancel</Button>
                  {!useCompactFooter && <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndNew: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}>Save & New</Button>}
                  {!useCompactFooter && <Button type="button" onClick={(e) => handleFormSubmit(e, { saveAndPrint: true })} disabled={isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}><Printer className="mr-2 h-4 w-4" /> Save & Print</Button>}
                  <Button type="submit" disabled={isLoading || isAttachmentProcessing || editingDisabled || recurringVoucherSaveBlocked || !isFormValid || (!!voucher?.id && !isFormDirty)} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
                  {voucher?.id ? (
                    <Button type="button" onClick={async (e) => { e.preventDefault(); if (isFormDirty) await handleFormSubmit(e, { approveAfterSave: true }); else onApprove?.(); }} disabled={editingDisabled || isAttachmentProcessing || !showApproveButton || !onApprove || isApproving || (!!voucher?.isApproved && !isFormDirty)} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
                      {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                      {isFormDirty ? "Save & Approve" : "Approve"}
                    </Button>
                  ) : (
                    <Button type="button" onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })} disabled={!canShowCreateApproveButton || !canApproveTransactions || isLoading || isAttachmentProcessing || editingDisabled || !isFormValid} className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}>
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

    <CreatePartyDialog
      isOpen={isCreatePartyOpen}
      onOpenChange={setIsCreatePartyOpen}
      onPartyCreated={(id) => {
        setIsCreatePartyOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    />
    <CreateBankAccountDialog
      isOpen={isCreateBankOpen}
      onOpenChange={setIsCreateBankOpen}
      onAccountCreated={(id) => {
        setIsCreateBankOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    />
    <CreateStaffDialog
      isOpen={isCreateStaffOpen}
      onOpenChange={setIsCreateStaffOpen}
      onStaffCreated={(id) => {
        setIsCreateStaffOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
      groups={[]}
    >
      <span className="hidden" />
    </CreateStaffDialog>
    <CreateTaxDialog
      isOpen={isCreateTaxOpen}
      onOpenChange={(open) => {
        setIsCreateTaxOpen(open);
        if (!open) setTaxCreatePrefillName("");
      }}
      prefillTaxName={taxCreatePrefillName}
      onTaxCreated={(id) => {
        setIsCreateTaxOpen(false);
        setTaxCreatePrefillName("");
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    />
    <CreateItemDialog
      isOpen={isCreateItemOpen}
      onOpenChange={setIsCreateItemOpen}
      defaultType="item"
      onItemCreated={(id) => {
        setIsCreateItemOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    >
      <span className="hidden" />
    </CreateItemDialog>
    <CreateExpenseAccountDialog
      isOpen={isCreateIncomeAccountOpen}
      onOpenChange={setIsCreateIncomeAccountOpen}
      defaultGroupType="income"
      onExpenseAccountCreated={(id) => {
        setIsCreateIncomeAccountOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    >
      <span className="hidden" />
    </CreateExpenseAccountDialog>
    <CreateExpenseAccountDialog
      isOpen={isCreateExpenseAccountOpen}
      onOpenChange={setIsCreateExpenseAccountOpen}
      defaultGroupType="expense"
      onExpenseAccountCreated={(id) => {
        setIsCreateExpenseAccountOpen(false);
        form.setValue("entityId", id);
        void form.trigger("entityId");
      }}
    >
      <span className="hidden" />
    </CreateExpenseAccountDialog>
    <VoucherDeleteConfirmAlertDialog
      open={isDeleteDialogOpen}
      onOpenChange={setIsDeleteDialogOpen}
      entityKind="note"
      entityName={voucher?.voucherNumber || "this note"}
      onMoveToBin={handleDelete}
      onDeletePermanently={handlePermanentDelete}
      localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
      busy={isLoading}
    />
    </>
  );
}
