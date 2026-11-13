"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { ocrAdapters, useVoucherOcr, VoucherOcrRefreshBar } from "@/modules/ocr";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { collection, doc, query, serverTimestamp, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CheckCircle, FileText, History, Link2, Loader2, PlusCircle, Printer, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLiveVoucherDuplicate } from "@/hooks/useLiveVoucherDuplicate";
import { DuplicateVoucherBubble, DUP_ANCHOR_ATTR, DUP_SAVE_ANCHOR } from "@/components/vouchers/DuplicateVoucherBubble";
import type { CandidateVoucher } from "@/lib/voucherDuplicateGuard";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  assertCanPermanentDeleteFromForm,
  permanentDeleteVoucherFromForm,
} from "@/lib/permanentDeleteFromForm";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { VoucherNumberInputWithRefresh } from "@/components/vouchers/VoucherNumberInputWithRefresh";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { MASTER_ACCOUNT_FREEZE_LIST_LABEL } from "@/lib/masterAccountFreeze/labels";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { type Resolver, useForm } from "react-hook-form";
import { startOfDay } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { firestore } from "@/lib/plClientSession";
import { storage } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { useToast } from "@/hooks/use-toast";
import { useVouchers } from "@/hooks/useVouchers";
import usePermissions from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { assertCan, assertCanPerformBackdated, PermissionDeniedError } from "@/lib/permissions/enforcePermission";
import { DEFAULT_VOUCHER_PREFIX_LABELS, getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { useAutoVoucherNumberFyDateSync } from "@/hooks/useAutoVoucherNumberFyDateSync";
import { resolvePrefixFromVoucherNumber } from "@/lib/voucherNumberFormat";
import { saveVoucher, softDeleteVoucherMoveToRecycleBin } from "@/lib/voucherActionsClient";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { cn } from "@/lib/utils";
import {
  BTN_APPROVE_CLASS,
  BTN_CANCEL_CLASS,
  BTN_HISTORY_CLASS,
  BTN_PRINT_CLASS,
  BTN_SAVE_CLASS,
  BTN_SAVE_NEW_CLASS,
  VOUCHER_BUTTONS_CLASS,
} from "@/components/vouchers/voucherButtonStyles";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { RestrictedFileUploader } from "@/components/ui/RestrictedFileUploader";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { VoucherPdfAsImageToggle } from "@/components/vouchers/VoucherPdfAsImageToggle";
import {
  appendCompressedVoucherAttachmentsToState as __frozenAppendAttachments,
  handleVoucherAttachmentInputChange as __frozenAttachmentInputChange,
  useVoucherAttachmentProcessing,
} from "@/lib/appendCompressedVoucherAttachments";
import { ocrWrapAppend, ocrWrapInputChange } from "@/modules/ocr";
const appendCompressedVoucherAttachmentsToState = ocrWrapAppend(__frozenAppendAttachments);
const handleVoucherAttachmentInputChange = ocrWrapInputChange(__frozenAttachmentInputChange);
import { shouldSuggestPdfAsImage } from "@/lib/voucherAttachmentPdfAsImage";
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  finalizeVoucherAttachmentsAfterFormSave,
  uploadVoucherAttachmentFileToFirebase,
  voucherAttachmentFieldsForSave,
  normalizeFormFileUrlsForSave,
  voucherAttachmentLockSaveOpts,
} from "@/lib/voucherFormAttachmentSave";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { voucherAttachmentUrlsForFormState } from "@/lib/voucherAttachmentNormalize";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { LinkPaymentInToSalaryDialog } from "@/components/vouchers/LinkPaymentInToSalaryDialog";
import { LinkPaymentOutToSalaryDialog } from "@/components/vouchers/LinkPaymentOutToSalaryDialog";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import {
  getAllocationTotal,
  getPaymentInRemaining,
  getPaymentOutPartyLinkAmount,
  getTaxNetAllocatedByVoucherIdFromPaymentOuts,
  OPENING_BALANCE_VOUCHER_ID,
  type Allocation,
} from "@/lib/payment-allocation-utils";
import { useLinkPaymentToTxnsLinkableCount } from "@/hooks/useLinkPaymentToTxnsLinkableCount";

type AdjustmentTarget = {
  id: string;
  entityType: "party" | "staff" | "account" | "expense" | "tax";
  name: string;
};

const schema = z.object({
  voucherNumber: z.string().min(1, "Voucher number is required."),
  date: z.date({ message: "Date is required." }),
  direction: z.enum(["increase", "decrease"]),
  amount: z.coerce.number().positive("Amount must be greater than 0."),
  narration: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function adjustmentBankCashMasterSuffix(account: { accountType?: string | null }): string {
  return account.accountType === "Cash" ? "Cash" : "Bank";
}

function adjustmentBankCashMasterLabel(account: { accountName?: string; name?: string; accountType?: string | null }): string {
  const name = account.accountName || account.name || "Account";
  return `${name} (${adjustmentBankCashMasterSuffix(account)})`;
}

function isAdjustmentSystemExpenseAccount(account: { name?: string; isSystemAccount?: boolean }): boolean {
  return account.isSystemAccount === true || String(account.name || "").trim().toLowerCase() === "adjustment";
}

async function ensureAdjustmentExpenseAccount(companyId: string, existing: Array<{ id: string; name?: string; type?: string }>) {
  const found = existing.find((a) => String(a.name || "").trim().toLowerCase() === "adjustment");
  if (found?.id) return found.id;

  try {
    const q = query(collection(firestore, `companies/${companyId}/expense_accounts`), where("name", "==", "Adjustment"));
    const snap = await getDocs(q);
    const doc0 = snap.docs[0];
    if (doc0?.id) return doc0.id;
  } catch {
    /* local/offline fallback below */
  }

  const ref = doc(collection(firestore, `companies/${companyId}/expense_accounts`));
  const payload = {
    id: ref.id,
    companyId,
    name: "Adjustment",
    type: "Expense",
    groupId: "ungrouped_expense",
    openingBalance: 0,
    debit: 0,
    credit: 0,
    balance: 0,
    isSystemAccount: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch {
    /* offline queue still keeps it available */
  }
  await upsertCompanyDocInBrowserDb(companyId, "expense_accounts", ref.id, { ...payload, createdAt: new Date(), updatedAt: new Date() });
  await enqueueCompanyDocOutbox(companyId, "expense_accounts", "create", ref.id, { ...payload, createdAt: new Date(), updatedAt: new Date() });
  return ref.id;
}

export function CreateAdjustmentForm({
  voucher,
  defaultVoucherData,
  onVoucherAction,
  onOpenHistory,
  showHistoryButton,
  editingDisabled = false,
  deleteDisabledWhenLinked = false,
  showApproveButton = false,
  showSaveAndApproveOnCreate = false,
  onApprove,
  isApproving = false,
  recurringVoucherSaveBlocked = false,
  recurringVoucherAuxiliaryDirty = false,
  ledgerEntityId,
  ledgerOpeningBalanceOutstanding,
  ledgerBooksOpeningBalanceSigned,
}: {
  voucher?: any;
  defaultVoucherData?: any;
  onVoucherAction?: (status: "saved" | "cancelled", isSaveAndNew?: boolean, newId?: string) => void;
  onOpenHistory?: () => void;
  showHistoryButton?: boolean;
  editingDisabled?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onApprove?: () => void;
  isApproving?: boolean;
  recurringVoucherSaveBlocked?: boolean;
  recurringVoucherAuxiliaryDirty?: boolean;
  ledgerEntityId?: string;
  ledgerOpeningBalanceOutstanding?: number;
  ledgerBooksOpeningBalanceSigned?: number;
}) {
  const { user, customUser } = useAuth();
  const { toast: uiToast } = useToast();
  const { companyId, company } = useCompany();
  const { dateSystem, formatDate, formatCurrencyForPrint } = useDate();
  const { can, role, canPerformBackdatedAction, canDeleteVoucher, allowAttachments, fileAttachmentLimits } = usePermissions();
  const {
    processedPartiesForSelection,
    processedStaff,
    processedAccounts,
    processedExpenseAccounts,
    processedTaxes,
    vouchers,
  } = useVouchers();
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(false);
  const isAttachmentProcessing = useVoucherAttachmentProcessing();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [savedVoucherId, setSavedVoucherId] = useState<string | null>(voucher?.id || null);
  const [files, setFiles] = useState<(File | string)[]>(() =>
    voucherAttachmentUrlsForFormState(voucher)
  );
  const [savePdfAsImage, setSavePdfAsImage] = useState(() =>
    shouldSuggestPdfAsImage(voucherAttachmentUrlsForFormState(voucher))
  );
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const lastResetVoucherIdRef = useRef<string | null>(null);
  const initialFilesRef = React.useRef<string[]>(
    voucherAttachmentUrlsForFormState(voucher).filter((f): f is string => typeof f === "string")
  );
  const seedTarget = (defaultVoucherData?.adjustmentTarget || voucher?.adjustmentTarget) as AdjustmentTarget | undefined;
  const [selectedTarget, setSelectedTarget] = useState<AdjustmentTarget | null>(seedTarget?.id ? seedTarget : null);
  const initialTargetRef = React.useRef<AdjustmentTarget | null>(seedTarget?.id ? seedTarget : null);
  const initialAdjustmentAllocationsRef = useRef<Allocation[]>([]);
  const [adjustmentAllocations, setAdjustmentAllocations] = useState<Allocation[]>([]);
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      voucherNumber: voucher?.voucherNumber || "",
      date: voucher?.date?.toDate ? voucher.date.toDate() : (voucher?.date ? new Date(voucher.date) : startOfDay(new Date())),
      direction: voucher?.adjustmentDirection === "decrease" ? "decrease" : "increase",
      amount: Number(voucher?.total || voucher?.amount || 0) || 0,
      narration: voucher?.narration || "",
    },
  });

  /* OCR (local, generic adapter): first attachment -> validated autofill; Auto Post saves UNAPPROVED. */
  const ocr = useVoucherOcr({
    adapter: ocrAdapters.adjustment(),
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

  const isAutoVoucherEnabled = company?.autoVoucherNumbering?.adjustment ?? true;
  const fetchAdjustmentVoucherNumber = React.useCallback(async () => {
    if (!companyId || !company || !isAutoVoucherEnabled) return;
    const n = await getNextVoucherNumberForCompany({
      companyId,
      companyDoc: company as Record<string, unknown>,
      voucherLike: { type: "adjustment" },
      voucherDate: form.getValues("date"),
    });
    form.setValue("voucherNumber", n);
  }, [companyId, company, form, isAutoVoucherEnabled]);

  useEffect(() => {
    if (!companyId || form.getValues("voucherNumber")) return;
    void fetchAdjustmentVoucherNumber();
  }, [companyId, company, form, fetchAdjustmentVoucherNumber]);

  useAutoVoucherNumberFyDateSync({
    form,
    company: company as Record<string, unknown>,
    isAutoVoucherEnabled,
    editingSavedVoucher: Boolean(voucher?.id && savedVoucherId),
    shouldFetchNextOnDateChange: Boolean(!voucher?.id && isAutoVoucherEnabled),
    fetchVoucherNumber: fetchAdjustmentVoucherNumber,
    resolvePrefix: () => {
      const list =
        (company?.voucherPrefixes as Record<string, string[] | undefined> | undefined)?.adjustment ||
        [DEFAULT_VOUCHER_PREFIX_LABELS.adjustment];
      return resolvePrefixFromVoucherNumber(String(form.getValues("voucherNumber") || ""), list, list[0]);
    },
  });

  useEffect(() => {
    const next = (defaultVoucherData?.adjustmentTarget || voucher?.adjustmentTarget) as AdjustmentTarget | undefined;
    if (!next?.id) return;
    setSelectedTarget(next);
    initialTargetRef.current = next;
  }, [voucher?.id, voucher?.adjustmentTarget, defaultVoucherData?.adjustmentTarget]);

  const masterAccountsWithEntity = useMemo(() => {
    const parts: {
      value: string;
      label: string;
      nameOnly: string;
      balance?: number;
      entityType: AdjustmentTarget["entityType"];
      disabled?: boolean;
    }[] = [];
    const freezeSuffix = ` (${MASTER_ACCOUNT_FREEZE_LIST_LABEL})`;
    (processedPartiesForSelection || []).forEach((p: any) => {
      const frozen = readMasterAccountFrozen(p);
      parts.push({
        value: p.id,
        label: `${p.name} (Party)${frozen ? freezeSuffix : ""}`,
        nameOnly: p.name,
        balance: p.balance,
        entityType: "party",
        disabled: frozen,
      });
    });
    (processedStaff || []).forEach((s: any) => {
      const frozen = readMasterAccountFrozen(s);
      parts.push({
        value: s.id,
        label: `${s.name} (Staff)${frozen ? freezeSuffix : ""}`,
        nameOnly: s.name,
        balance: s.balance,
        entityType: "staff",
        disabled: frozen,
      });
    });
    (processedAccounts || []).forEach((a: any) => {
      const frozen = readMasterAccountFrozen(a);
      const baseLabel = adjustmentBankCashMasterLabel(a);
      parts.push({
        value: a.id,
        label: `${baseLabel}${frozen ? freezeSuffix : ""}`,
        nameOnly: a.accountName || a.name || "Account",
        balance: a.balance,
        entityType: "account",
        disabled: frozen,
      });
    });
    (processedExpenseAccounts || []).forEach((a: any) => {
      if (isAdjustmentSystemExpenseAccount(a)) return;
      const frozen = readMasterAccountFrozen(a);
      parts.push({
        value: a.id,
        label: `${a.name || "Expense"} (Expense)${frozen ? freezeSuffix : ""}`,
        nameOnly: a.name || "Expense",
        balance: (a as any).balance,
        entityType: "expense",
        disabled: frozen,
      });
    });
    (processedTaxes || []).forEach((t: any) => {
      const frozen = readMasterAccountFrozen(t);
      parts.push({
        value: t.id,
        label: `${t.name || "Tax"} (Tax)${frozen ? freezeSuffix : ""}`,
        nameOnly: t.name || "Tax",
        balance: (t as any).balance,
        entityType: "tax",
        disabled: frozen,
      });
    });
    return parts.sort((a, b) => a.label.localeCompare(b.label));
  }, [processedPartiesForSelection, processedStaff, processedAccounts, processedExpenseAccounts, processedTaxes]);

  const masterAccountOptions = useMemo(
    () => masterAccountsWithEntity.map(({ value, label, balance, disabled }) => ({ value, label, balance, disabled })),
    [masterAccountsWithEntity]
  );

  const { isDirty: _isFormFieldsDirty } = form.formState;
  const _isFileDirty = (() => {
    const currentUrls = files.filter((f): f is string => typeof f === "string");
    const newFiles = files.filter((f): f is File => f instanceof File);
    if (newFiles.length > 0) return true;
    const init = initialFilesRef.current;
    return currentUrls.length !== init.length || currentUrls.some((u, i) => u !== init[i]);
  })();
  const _isTargetDirty =
    String(selectedTarget?.id || "") !== String(initialTargetRef.current?.id || "") ||
    String(selectedTarget?.entityType || "") !== String(initialTargetRef.current?.entityType || "");
  const _isAllocationsDirty = (() => {
    const norm = (a: Allocation[]) =>
      JSON.stringify(
        (a || [])
          .map((x) => ({ v: x.voucherId, a: x.amount, l: (x as any).linkedAccountId }))
          .sort((p, q) => String(p.v).localeCompare(String(q.v)))
      );
    return norm(adjustmentAllocations) !== norm(initialAdjustmentAllocationsRef.current);
  })();
  const isFormDirty = _isFormFieldsDirty || _isFileDirty || _isTargetDirty || _isAllocationsDirty || recurringVoucherAuxiliaryDirty;

  useEffect(() => {
    const NEW_ADJUSTMENT = "__new_adjustment__";
    if (!voucher) {
      lastResetVoucherIdRef.current = null;
      return;
    }
    const vid = voucher.id as string | undefined;
    if (vid) {
      if (lastResetVoucherIdRef.current === vid) return;
      lastResetVoucherIdRef.current = vid;
      setSavedVoucherId(vid);
      const urls = voucherAttachmentUrlsForFormState(voucher);
      setFiles(urls);
      initialFilesRef.current = urls.filter((f): f is string => typeof f === "string");
      setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
      form.reset({
        voucherNumber: voucher.voucherNumber || "",
        date: voucher.date?.toDate ? voucher.date.toDate() : new Date(voucher.date),
        direction: voucher.adjustmentDirection === "decrease" ? "decrease" : "increase",
        amount: Number(voucher.total || voucher.amount || 0) || 0,
        narration: voucher.narration || "",
      });
      const rawAllocs = Array.isArray((voucher as any)?.allocations) ? ((voucher as any).allocations as Allocation[]) : [];
      const targetId = String((voucher as any)?.adjustmentTarget?.id ?? seedTarget?.id ?? "");
      const loaded = rawAllocs.filter((a) => {
        const lid = String((a as any)?.linkedAccountId ?? "");
        return !lid || !targetId || lid === targetId;
      });
      setAdjustmentAllocations(loaded);
      initialAdjustmentAllocationsRef.current = [...loaded];
      if (loaded.some((a) => getAllocationTotal(a) > 0)) setShowLinkSection(true);
    } else {
      if (lastResetVoucherIdRef.current === NEW_ADJUSTMENT && isFormDirty) return;
      const isFirstNewHydrate = lastResetVoucherIdRef.current !== NEW_ADJUSTMENT;
      lastResetVoucherIdRef.current = NEW_ADJUSTMENT;
      setSavedVoucherId(null);
      if (isFirstNewHydrate) {
        const urls = voucherAttachmentUrlsForFormState(voucher);
        setFiles(urls);
        initialFilesRef.current = urls.filter((f): f is string => typeof f === "string");
        setSavePdfAsImage(shouldSuggestPdfAsImage(urls));
      }
    }
  }, [voucher, form, isFormDirty]);

  const attachmentClientFileUrlsForPreview = useMemo(
    () => files.filter((f): f is string => typeof f === "string"),
    [files]
  );

  const direction = form.watch("direction");
  const watchedAmount = form.watch("amount");
  const duplicateDate = form.watch("date");
  const duplicateNarration = String(form.watch("narration") || "");
  const { match: liveDuplicate, dismiss: dismissLiveDuplicate } = useLiveVoucherDuplicate(
    vouchers as CandidateVoucher[],
    {
      excludeVoucherId: voucher?.id,
      type: "adjustment",
      date: duplicateDate,
      amount: Number(watchedAmount) || 0,
      fromAccountId: selectedTarget?.id,
      narration: duplicateNarration,
    },
    !voucher?.id && !!duplicateDate && Number(watchedAmount) > 0
  );
  const targetSide = direction === "increase" ? "Dr" : "Cr";
  const adjustmentSide = direction === "increase" ? "Cr" : "Dr";
  const adjustmentBillWiseSide: "debit" | "credit" = direction === "increase" ? "debit" : "credit";
  const isBillWiseTarget = selectedTarget?.entityType === "party" || selectedTarget?.entityType === "staff";
  const adjustmentVoucherId = (savedVoucherId || voucher?.id || "") as string;
  const openedFromAccountId = String(ledgerEntityId || (voucher as any)?._openedFromAccountId || "");
  const effectiveLedgerObOutstanding = useMemo(() => {
    if (typeof ledgerOpeningBalanceOutstanding === "number") return ledgerOpeningBalanceOutstanding;
    if (!openedFromAccountId || !selectedTarget?.id || openedFromAccountId !== selectedTarget.id) return undefined;
    if (typeof ledgerBooksOpeningBalanceSigned === "number") return Math.abs(ledgerBooksOpeningBalanceSigned);
    if (selectedTarget.entityType === "party") {
      const p = (processedPartiesForSelection || []).find((x: any) => String(x.id) === selectedTarget.id);
      return Math.abs(Number((p as any)?.openingBalance ?? 0));
    }
    if (selectedTarget.entityType === "staff") {
      const s = (processedStaff || []).find((x: any) => String(x.id) === selectedTarget.id);
      return Math.abs(Number((s as any)?.openingBalance ?? 0));
    }
    return undefined;
  }, [
    ledgerOpeningBalanceOutstanding,
    openedFromAccountId,
    selectedTarget,
    processedPartiesForSelection,
    processedStaff,
    ledgerBooksOpeningBalanceSigned,
  ]);
  const adjustmentLinkedFromRows = useMemo(() => {
    if (!adjustmentVoucherId || !vouchers?.length) {
      return [] as Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number; sourceType: string }>;
    }
    const rows: Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number; sourceType: string }> = [];
    (vouchers as any[]).forEach((v) => {
      if (!v || String(v.id ?? "") === String(adjustmentVoucherId)) return;
      const allocs = (v.allocations as any[] | undefined) || [];
      const linkedAmount = allocs
        .filter((a: any) => String(a?.voucherId ?? "") === String(adjustmentVoucherId))
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
  }, [adjustmentVoucherId, vouchers]);
  const adjustmentLinkedToRows = useMemo(() => {
    const list = Array.isArray(adjustmentAllocations) ? adjustmentAllocations : [];
    if (!list.length) return [] as Array<{ voucherId: string; voucherNumber: string; amount: number; date: Date | null; total: number }>;
    return list
      .filter((a: any) => Number(a?.amount) > 0)
      .map((a: any) => {
        if (String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID) {
          return {
            voucherId: OPENING_BALANCE_VOUCHER_ID,
            voucherNumber: "Book Opening",
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
  }, [adjustmentAllocations, vouchers]);
  const adjustmentBillWiseSummary = useMemo(() => {
    const sideAmount = Number(watchedAmount) || 0;
    const outgoing = adjustmentAllocations.reduce((s, a) => s + getAllocationTotal(a), 0);
    const incoming = adjustmentLinkedFromRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const linkedRowsMap = new Map<string, { voucherId: string; voucherNumber: string; date: Date | null; total: number; linkedOnCurrent: number }>();
    [...adjustmentLinkedFromRows, ...adjustmentLinkedToRows].forEach((row) => {
      const key = String(row.voucherId);
      const prev = linkedRowsMap.get(key);
      if (prev) {
        prev.linkedOnCurrent += Number(row.amount) || 0;
        if (!prev.date && row.date) prev.date = row.date;
        if (!prev.total && row.total) prev.total = row.total;
      } else {
        linkedRowsMap.set(key, {
          voucherId: key,
          voucherNumber: row.voucherNumber,
          date: row.date ?? null,
          total: Number(row.total) || 0,
          linkedOnCurrent: Number(row.amount) || 0,
        });
      }
    });
    const rows = Array.from(linkedRowsMap.values()).filter((r) => r.linkedOnCurrent > 0);
    const linkedTotal = outgoing + incoming;
    return {
      sideAmount,
      linkedTotal,
      linkableRemaining: Math.max(0, sideAmount - linkedTotal),
      rows,
    };
  }, [watchedAmount, adjustmentAllocations, adjustmentLinkedFromRows, adjustmentLinkedToRows]);
  const hasAdjustmentBillWiseLinks = adjustmentBillWiseSummary.rows.length > 0;
  const shouldShowAdjustmentLinkSections = showLinkSection || (!!voucher?.id && hasAdjustmentBillWiseLinks);
  const shouldShowAdjustmentLinkButton = isBillWiseTarget && !shouldShowAdjustmentLinkSections;
  useEffect(() => {
    if (voucher?.id && hasAdjustmentBillWiseLinks) {
      setShowLinkSection(true);
      return;
    }
    if (!voucher?.id) setShowLinkSection(false);
  }, [voucher?.id, hasAdjustmentBillWiseLinks]);
  const adjustmentLinkContext = useMemo(() => {
    if (!selectedTarget?.id || !isBillWiseTarget) return null;
    const accountId = String(selectedTarget.id);
    if (selectedTarget.entityType === "party") {
      const party = (processedPartiesForSelection || []).find((p: any) => String(p.id) === accountId);
      return {
        kind: "party" as const,
        accountId,
        label: party?.name || selectedTarget.name || "Party",
        side: adjustmentBillWiseSide,
        amount: Number(watchedAmount) || 0,
        openingBalance: Number((party as any)?.openingBalance ?? 0),
      };
    }
    const staff = (processedStaff || []).find((s: any) => String(s.id) === accountId);
    return {
      kind: "staff" as const,
      accountId,
      label: staff?.name || selectedTarget.name || STAFF_ENTITY_LABEL,
      side: adjustmentBillWiseSide,
      amount: Number(watchedAmount) || 0,
      openingBalance: Number((staff as any)?.openingBalance ?? 0),
    };
  }, [selectedTarget, isBillWiseTarget, processedPartiesForSelection, processedStaff, adjustmentBillWiseSide, watchedAmount]);
  const adjustmentDialogExistingAllocations = useMemo((): Allocation[] => {
    if (!adjustmentLinkContext?.accountId) return [];
    const accountId = adjustmentLinkContext.accountId;
    const side = adjustmentLinkContext.side;
    const byId = new Map<string, Allocation>();
    for (const a of adjustmentAllocations) {
      const id = String(a?.voucherId ?? "").trim();
      if (!id || getAllocationTotal(a) <= 0) continue;
      byId.set(id, { ...a, voucherId: id, amount: getAllocationTotal(a), linkedAccountId: accountId });
    }
    const debitSources = new Set(["payment_in", "direct_income", "purchase", "purchase_service"]);
    const creditSources = new Set(["payment_out", "direct_expense", "sale", "sale_service"]);
    const allowTypes = side === "credit" ? creditSources : debitSources;
    const voucherTouchesAccount = (v: any) =>
      String((v as any)?.partyId ?? "") === accountId ||
      String((v as any)?.staffId ?? "") === accountId ||
      String((v as any)?.adjustmentTarget?.id ?? "") === accountId ||
      (Array.isArray((v as any)?.entries) &&
        (v as any).entries.some((e: any) => String(e?.accountId ?? "") === accountId));
    const entryMatchesSide = (v: any) => {
      if (v?.type === "adjustment") {
        const dir = String(v?.adjustmentDirection ?? "");
        if (String(v?.adjustmentTarget?.id ?? "") !== accountId) return false;
        return side === "debit" ? dir === "decrease" : dir === "increase";
      }
      if (!Array.isArray(v?.entries)) return false;
      const entry = v.entries.find((e: any) => String(e?.accountId ?? "") === accountId);
      if (!entry) return false;
      return side === "credit"
        ? (Number(entry.debit) || 0) > 0
        : (Number(entry.credit) || 0) > 0;
    };
    const icMatchesSide = (v: any) => {
      const amt = getInterCompanyEntityBillWiseAmount(
        v,
        accountId,
        adjustmentLinkContext.kind === "staff" ? "staff" : "party"
      );
      if (!amt) return false;
      return side === "credit" ? amt.debit > 0 : amt.credit > 0;
    };
    for (const row of adjustmentLinkedFromRows) {
      const id = String(row.voucherId || "").trim();
      if (!id) continue;
      const src = (vouchers as any[])?.find((v: any) => String(v?.id ?? "") === id);
      if (!src || !voucherTouchesAccount(src)) continue;
      const st = String(row.sourceType || src.type || "").toLowerCase();
      if (st === "journal" || st === "adjustment") {
        if (!entryMatchesSide(src)) continue;
      } else if (st === "inter_company") {
        if (!icMatchesSide(src)) continue;
      } else if (!allowTypes.has(st)) {
        continue;
      }
      const amt = Number(row.amount) || 0;
      if (amt <= 0) continue;
      const prev = byId.get(id);
      byId.set(id, {
        voucherId: id,
        amount: Math.max(prev ? getAllocationTotal(prev) : 0, amt),
        linkedAccountId: accountId,
      });
    }
    return Array.from(byId.values());
  }, [adjustmentLinkContext, adjustmentAllocations, adjustmentLinkedFromRows, vouchers]);
  const activePartySignedOpeningBalance = useMemo(() => {
    if (!adjustmentLinkContext || adjustmentLinkContext.kind !== "party") return 0;
    if (typeof ledgerBooksOpeningBalanceSigned === "number" && Math.abs(ledgerBooksOpeningBalanceSigned) > 1e-6) {
      return ledgerBooksOpeningBalanceSigned;
    }
    const obRemaining =
      typeof effectiveLedgerObOutstanding === "number" && effectiveLedgerObOutstanding > 0
        ? effectiveLedgerObOutstanding
        : null;
    const signed = Number(adjustmentLinkContext.openingBalance ?? 0);
    if (Math.abs(signed) > 1e-6) return signed;
    if (obRemaining != null) {
      return adjustmentLinkContext.side === "debit" ? -obRemaining : obRemaining;
    }
    return signed;
  }, [adjustmentLinkContext, ledgerBooksOpeningBalanceSigned, effectiveLedgerObOutstanding]);
  const adjustmentBillWiseLinkVariant = adjustmentBillWiseSide === "debit" ? "payment_out" : "payment_in";
  const partyBillWiseLinkableCount = useLinkPaymentToTxnsLinkableCount(
    adjustmentBillWiseLinkVariant,
    selectedTarget?.entityType === "party" ? selectedTarget.id : null,
    vouchers ?? [],
    {
      paymentInId: adjustmentBillWiseSide === "credit" ? adjustmentVoucherId || undefined : undefined,
      paymentOutId: adjustmentBillWiseSide === "debit" ? adjustmentVoucherId || undefined : undefined,
      existingAllocations: adjustmentAllocations,
      partyOpeningBalance: activePartySignedOpeningBalance,
    }
  );
  const staffBillWiseLinkableCount = useMemo(() => {
    if (selectedTarget?.entityType !== "staff" || !selectedTarget.id || !vouchers?.length) return 0;
    const staffId = selectedTarget.id;
    const currentId = adjustmentVoucherId || null;
    const hasExistingAlloc = (id: string) =>
      adjustmentAllocations.some((a) => a.voucherId === id && getAllocationTotal(a) > 0);
    if (adjustmentBillWiseSide === "debit") {
      const otherPaymentOuts = (vouchers as any[]).filter(
        (v: any) => (v.type === "payment_out" || v.type === "direct_expense") && v.id !== currentId
      );
      const allocatedMap = getTaxNetAllocatedByVoucherIdFromPaymentOuts(otherPaymentOuts);
      const addSalaryCount = (vouchers as any[])
        .filter((v: any) => v.type === "journal" && v.subType === "add_salary" && Array.isArray(v.entries))
        .filter((v: any) => v.entries.some((e: any) => e.accountId === staffId && (Number(e.credit) || 0) > 0))
        .filter((v: any) => {
          const netTotal = v.entries
            .filter((e: any) => (Number(e.credit) || 0) > 0 && !String(e.narration || "").includes("(Staff ID:"))
            .reduce((s: number, e: any) => s + (Number(e.credit) || 0), 0);
          const allocated = allocatedMap.get(v.id)?.net ?? 0;
          const outstanding = Math.max(0, netTotal - allocated);
          return outstanding > 0 || hasExistingAlloc(v.id);
        }).length;
      const paymentInCount = (vouchers as any[])
        .filter((v: any) => (v.type === "payment_in" || v.type === "direct_income") && v.staffId === staffId)
        .filter((v: any) => {
          const allAllocs = (v.allocations as Allocation[] | undefined) || [];
          const allocatedToOthers = currentId
            ? allAllocs.filter((a) => a.voucherId !== currentId).reduce((s, a) => s + getAllocationTotal(a), 0)
            : allAllocs.reduce((s, a) => s + getAllocationTotal(a), 0);
          const currentAllocated = currentId
            ? allAllocs.filter((a) => a.voucherId === currentId).reduce((s, a) => s + getAllocationTotal(a), 0)
            : 0;
          const outstanding = getPaymentInRemaining(v) + currentAllocated;
          return outstanding > 0 || hasExistingAlloc(v.id);
        }).length;
      const staffOB = Number((processedStaff || []).find((s: any) => s.id === staffId)?.openingBalance ?? 0) || 0;
      let obCount = 0;
      if (staffOB < 0) {
        const obAmount = Math.abs(staffOB);
        const consumedByOthers = (vouchers as any[])
          .filter((v: any) => (v.type === "payment_out" || v.type === "direct_expense") && v.staffId === staffId)
          .reduce((sum: number, v: any) => {
            const allocs = (v.allocations as Allocation[] | undefined) || [];
            return sum + allocs.reduce((s: number, a: Allocation) => s + (a.voucherId === OPENING_BALANCE_VOUCHER_ID ? getAllocationTotal(a) : 0), 0);
          }, 0);
        const outstandingOB = Math.max(0, obAmount - consumedByOthers);
        if (outstandingOB > 0 || hasExistingAlloc(OPENING_BALANCE_VOUCHER_ID)) obCount = 1;
      }
      return addSalaryCount + paymentInCount + obCount;
    }
    const otherPaymentOuts = (vouchers as any[]).filter(
      (v: any) => (v.type === "payment_out" || v.type === "direct_expense") && v.id !== currentId
    );
    const allocatedMap = getTaxNetAllocatedByVoucherIdFromPaymentOuts(otherPaymentOuts);
    const addSalaryDrCount = (vouchers as any[])
      .filter((v: any) => v.type === "journal" && v.subType === "add_salary" && Array.isArray(v.entries))
      .filter((v: any) => v.entries.some((e: any) => e.accountId === staffId && (Number(e.debit) || 0) > 0))
      .filter((v: any) => {
        const netTotal = v.entries
          .filter((e: any) => (Number(e.debit) || 0) > 0 && !String(e.narration || "").includes("(Staff ID:"))
          .reduce((s: number, e: any) => s + (Number(e.debit) || 0), 0);
        const allocated = allocatedMap.get(v.id)?.net ?? 0;
        return Math.max(0, netTotal - allocated) > 0 || hasExistingAlloc(v.id);
      }).length;
    const paymentOutCount = (vouchers as any[])
      .filter((v: any) => (v.type === "payment_out" || v.type === "direct_expense") && v.staffId === staffId)
      .filter((v: any) => {
        const total = getPaymentOutPartyLinkAmount(v);
        const allAllocs = (v.allocations as Allocation[] | undefined) || [];
        const allocated = allAllocs.reduce((s, a) => s + getAllocationTotal(a), 0);
        return Math.max(0, total - allocated) > 0 || hasExistingAlloc(v.id);
      }).length;
    const staffOB = Number((processedStaff || []).find((s: any) => s.id === staffId)?.openingBalance ?? 0) || 0;
    let obCount = 0;
    if (staffOB > 0) {
      const consumed = (vouchers as any[])
        .filter((v: any) => (v.type === "payment_in" || v.type === "direct_income") && v.staffId === staffId)
        .reduce((sum: number, v: any) => {
          const allocs = (v.allocations as Allocation[] | undefined) || [];
          return sum + allocs.reduce((s: number, a: Allocation) => s + (a.voucherId === OPENING_BALANCE_VOUCHER_ID ? getAllocationTotal(a) : 0), 0);
        }, 0);
      if (Math.max(0, staffOB - consumed) > 0 || hasExistingAlloc(OPENING_BALANCE_VOUCHER_ID)) obCount = 1;
    }
    return addSalaryDrCount + paymentOutCount + obCount;
  }, [
    selectedTarget,
    vouchers,
    adjustmentBillWiseSide,
    adjustmentVoucherId,
    adjustmentAllocations,
    processedStaff,
  ]);
  const adjustmentBillWiseLinkableCount =
    selectedTarget?.entityType === "party"
      ? partyBillWiseLinkableCount
      : selectedTarget?.entityType === "staff"
        ? staffBillWiseLinkableCount
        : 0;

  const saveAdjustment = async (
    data: FormValues,
    saveAndNew = false,
    approveAfterSave = false,
    printAfter = false,
    onSuccess?: () => void
  ) => {
    if (!companyId || !user?.uid) {
      toast.error("Company or user missing.");
      return;
    }
    if (!selectedTarget?.id) {
      toast.error("Please select an account.");
      return;
    }
    if (!can(voucher?.id ? "edit_adjustment_voucher" : "add_adjustment_voucher")) {
      toast.error("You do not have permission for adjustment vouchers.");
      return;
    }
    setIsLoading(true);
    const toastId = toast.loading("Saving adjustment...");
    try {
      const adjustmentExpenseId = await ensureAdjustmentExpenseAccount(companyId, processedExpenseAccounts as any[]);
      const amount = Number(data.amount) || 0;
      const increase = data.direction === "increase";
      const entries = increase
        ? [
            { accountId: selectedTarget.id, debit: amount, credit: 0 },
            { accountId: adjustmentExpenseId, debit: 0, credit: amount },
          ]
        : [
            { accountId: adjustmentExpenseId, debit: amount, credit: 0 },
            { accountId: selectedTarget.id, debit: 0, credit: amount },
          ];
      const approverName = customUser?.displayName || user.displayName || user.email || user.uid;
      const filesForSave = await prepareVoucherAttachmentsForSave(files, {
          companyId,
          savePdfAsImage,
          lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(voucher),
        });
      let fileUrls = normalizeFormFileUrlsForSave(
        filesForSave.filter((f): f is string => typeof f === "string")
      );
      const newFiles = filesForSave.filter((f): f is File => f instanceof File);
      if (newFiles.length > 0) {
        const totalNewBytes = newFiles.reduce((s, f) => s + (f.size || 0), 0);
        const limitCheck = await checkStorageLimitSafe(
          companyId,
          company?.planId,
          { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes },
          company?.storageOption
        );
        if (!limitCheck.allowed) {
          toast.error("Storage limit reached.", { id: toastId, description: limitCheck.message });
          setIsLoading(false);
          return;
        }
        if (await shouldStageNewVoucherFilesAsLocalPending(companyId)) {
          const { fileUrls: merged } = await appendLocalOnlyVoucherFilesToUrls({
            companyId,
            storageFolder: "adjustment",
            existingFileUrls: fileUrls,
            newFiles,
            maxFileCount: fileAttachmentLimits.maxFileCount,
            existingVoucherId: voucher?.id ?? null,
          });
          fileUrls = merged;
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
              storageFolder: "adjustment",
              existingFileUrls: fileUrls,
              files: newFiles,
              maxFileCount: fileAttachmentLimits.maxFileCount,
              existingVoucherId: voucher?.id ?? null,
            });
            fileUrls = up.fileUrls; // same as staging branch above: create path has no pre-generated id
          }
        }
      }
      const saved = await saveVoucher(
        companyId,
        user.uid,
        {
          type: "adjustment",
          voucherNumber: data.voucherNumber,
          date: data.date.toISOString(),
          total: amount,
          amount,
          narration: data.narration || "",
          adjustmentDirection: data.direction,
          adjustmentTarget: selectedTarget,
          adjustmentExpenseAccountId: adjustmentExpenseId,
          entries,
          allocations: adjustmentAllocations.map((a) => ({
            ...a,
            linkedAccountId: (a as any).linkedAccountId ?? selectedTarget.id,
          })),
          ...voucherAttachmentFieldsForSave(fileUrls, voucherAttachmentLockSaveOpts(voucher, can("unlock_locked_pdf"))),
        },
        voucher?.id,
        approveAfterSave ? { approvedByUserId: user.uid, approvedByName: approverName } : undefined
      );
      setSavedVoucherId(saved.id);
      initialTargetRef.current = selectedTarget;
      initialAdjustmentAllocationsRef.current = adjustmentAllocations.map((a) => ({
        ...a,
        linkedAccountId: (a as any).linkedAccountId ?? selectedTarget.id,
      }));
      toast.success("Adjustment saved.", { id: toastId, duration: 1200 });
      setIsLoading(false);
      if (!saveAndNew) {
        onVoucherAction?.("saved", false, saved.id);
      }
      const postSaveTail = async () => {
        if (companyId && saved.id) {
          try {
            const persistedUrls = await finalizeVoucherAttachmentsAfterFormSave({
              companyId,
              voucherId: saved.id,
              rawFileUrls: fileUrls,
              storageFolder: "adjustment",
              previousUrls: initialFilesRef.current,
            });
            initialFilesRef.current = persistedUrls;
            setFiles(persistedUrls);
            setSavePdfAsImage(shouldSuggestPdfAsImage(persistedUrls));
          } catch (attachErr) {
            console.warn("[CreateAdjustmentForm] post-save attachment finalize", attachErr);
            initialFilesRef.current = fileUrls;
            setFiles(fileUrls);
          }
        } else {
          initialFilesRef.current = fileUrls;
          setFiles(fileUrls);
          setSavePdfAsImage(shouldSuggestPdfAsImage(fileUrls));
        }
        if (printAfter && typeof window !== "undefined") {
          window.setTimeout(() => window.print(), 250);
        }
        if (saveAndNew) {
          form.reset({ ...form.getValues(), amount: 0, narration: "" });
          setFiles([]);
          initialFilesRef.current = [];
        } else {
          form.reset(data);
        }
        if (approveAfterSave && voucher?.id) onSuccess?.();
        else if (!approveAfterSave) onSuccess?.();
        if (saveAndNew) {
          onVoucherAction?.("saved", true, saved.id);
        }
      };
      if (!saveAndNew) {
        void postSaveTail().catch((err) => {
          console.warn("[CreateAdjustmentForm] post-save tail failed", err);
        });
      } else {
        await postSaveTail();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Adjustment save failed.", { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (
    e?: React.FormEvent,
    options: { ocrAutoPost?: boolean; saveAndNew?: boolean; approveAfterSave?: boolean; print?: boolean } = {}
  ) => {
    e?.preventDefault();
    void form.handleSubmit((data) =>
      saveAdjustment(
        data,
        options.saveAndNew ?? false,
        options.approveAfterSave ?? false,
        options.print ?? false,
        options.approveAfterSave ? onApprove : undefined
      )
    )();
  };

  const handleDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId || !user?.uid) return;
    try {
      assertCan(can, "delete_records");
      if (!canDeleteVoucher(voucher)) {
        toast.error("You do not have permission to delete this voucher.");
        return;
      }
      const voucherDate = voucher?.date?.toDate
        ? voucher.date.toDate()
        : voucher?.date
          ? new Date(voucher.date)
          : new Date();
      assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast.error(error.message);
      } else {
        toast.error("Failed to check permissions.");
      }
      return;
    }
    setIsLoading(true);
    try {
      await softDeleteVoucherMoveToRecycleBin(companyId, voucherIdToDelete, user.uid);
      toast.success("Adjustment moved to bin.");
      onVoucherAction?.("cancelled", false, savedVoucherId || undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete adjustment.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    const voucherIdToDelete = savedVoucherId || voucher?.id || null;
    if (!voucherIdToDelete || !companyId || !user?.uid) return;
    try {
      assertCanPermanentDeleteFromForm(can, role);
      if (!canDeleteVoucher(voucher)) {
        toast.error("You do not have permission to delete this voucher.");
        return;
      }
      const voucherDate = voucher?.date?.toDate
        ? voucher.date.toDate()
        : voucher?.date
          ? new Date(voucher.date)
          : new Date();
      assertCanPerformBackdated(canPerformBackdatedAction, "delete", voucherDate);
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast.error(error.message);
      } else {
        toast.error("Failed to check permissions.");
      }
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteVoucherFromForm(companyId, voucherIdToDelete);
      toast.success("Adjustment deleted permanently.");
      setIsDeleteDialogOpen(false);
      onVoucherAction?.("cancelled", false, savedVoucherId || undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to permanently delete adjustment.");
    } finally {
      setIsLoading(false);
    }
  };

  const canSaveAdjustment = can(voucher?.id ? "edit_adjustment_voucher" : "add_adjustment_voucher");
  const canAddMoreFiles = allowAttachments && fileAttachmentLimits.maxFileCount > 0 && files.length < fileAttachmentLimits.maxFileCount;
  const showPdfAsImageToggle =
    allowAttachments &&
    fileAttachmentLimits.maxFileCount > 0 &&
    (fileAttachmentLimits.allowPDF || shouldSuggestPdfAsImage(files));
  const attachFileInputId = React.useId();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleVoucherAttachmentInputChange(e, {
      companyId,
      currentFiles: files,
      maxFiles: fileAttachmentLimits.maxFileCount || 0,
      allowImage: fileAttachmentLimits.allowImage,
      allowPDF: fileAttachmentLimits.allowPDF,
      setFiles,
      toast: uiToast,
    });
  };

  return (
    <>
    <Form {...form}>
      <form onSubmit={(e) => handleFormSubmit(e)} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border bg-white p-3 text-sm">
            <FormItem>
              <FormLabel className="text-xs font-medium text-muted-foreground">Account</FormLabel>
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Combobox
                    options={masterAccountOptions}
                    value={selectedTarget?.id || ""}
                    onChange={(value) => {
                      const acc = masterAccountsWithEntity.find((a) => a.value === value);
                      if (!acc) return;
                      setSelectedTarget({
                        id: acc.value,
                        entityType: acc.entityType,
                        name: acc.nameOnly,
                      });
                      setAdjustmentAllocations([]);
                      initialAdjustmentAllocationsRef.current = [];
                      setShowLinkSection(false);
                    }}
                    placeholder="Select account"
                    searchPlaceholder="Search party, staff, bank, expense, tax..."
                    disabled={editingDisabled}
                    highlightBalanceInOptions
                    popoverModal={false}
                    autoFocusSearchOnOpen
                  />
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", targetSide === "Dr" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                  {targetSide}
                </span>
              </div>
            </FormItem>
          </div>
          <div className="rounded-md border bg-white p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Adjustment</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-semibold">Adjustment</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", adjustmentSide === "Dr" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                {adjustmentSide}
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField control={form.control} name="voucherNumber" render={({ field }) => (
            <FormItem>
              <FormLabel>Voucher No.</FormLabel>
              <FormControl>
                <VoucherNumberInputWithRefresh
                  {...field}
                  onRefresh={() => void fetchAdjustmentVoucherNumber()}
                  showRefresh={isAutoVoucherEnabled && !savedVoucherId}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem data-ocr-field="date">
              <FormLabel>Date</FormLabel>
              <div className="grid gap-2 md:grid-cols-2">
                {(dateSystem === "BS" || dateSystem === "Both") && (
                  <BsDatePicker valueAD={field.value} onChangeAD={(d) => d && field.onChange(d)} isRange={false} className="h-10 w-full" />
                )}
                {(dateSystem === "AD" || dateSystem === "Both") && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? formatDate(field.value) : "Pick AD date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[102]">
                      <Calendar mode="single" selected={field.value} onSelect={(d) => d && field.onChange(d)} initialFocus />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem data-ocr-field="amount">
              <FormLabel>Amount</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="direction" render={({ field }) => (
          <FormItem>
            <FormLabel>Adjustment Type</FormLabel>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
                <Checkbox checked={field.value === "increase"} onCheckedChange={() => field.onChange("increase")} />
                <ArrowUp className="h-4 w-4 text-green-600" /> Increase
              </label>
              <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
                <Checkbox checked={field.value === "decrease"} onCheckedChange={() => field.onChange("decrease")} />
                <ArrowDown className="h-4 w-4 text-red-600" /> Decrease
              </label>
            </div>
            <FormMessage />
          </FormItem>
        )} />
        <div className="rounded-lg border border-indigo-300/80 bg-indigo-50 p-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormItem>
              <FormLabel>Attach Files (Optional)</FormLabel>
              {showPdfAsImageToggle ? (
                <VoucherPdfAsImageToggle
                  existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(voucher)}
                  id="voucher-save-pdf-as-image-adjustment"
                  checked={savePdfAsImage}
                  onCheckedChange={setSavePdfAsImage}
                  disabled={!allowAttachments || fileAttachmentLimits.maxFileCount === 0}
                  className="mb-2"
                />
              ) : null}
              <RestrictedFileUploader>
                <div className="flex flex-wrap gap-4">
                  {files.map((file, index) => (
                    <FilePreview
                      key={`${typeof file === "string" ? file : file.name}-${index}`}
                      file={file}
                      attachmentCompanyId={companyId || undefined}
                      attachmentClientFileUrls={attachmentClientFileUrlsForPreview}
                        attachmentReusePlaceKey={(voucher?.id || savedVoucherId) ? `vouchers/${voucher?.id || savedVoucherId}` : null}
                      onRemove={
                        allowAttachments && fileAttachmentLimits.allowDelete
                          ? () => setFiles((prev) => prev.filter((_, i) => i !== index))
                          : undefined
                      }
                      className={!allowAttachments || fileAttachmentLimits.maxFileCount === 0 ? "pointer-events-none opacity-60" : ""}
                    />
                  ))}
                  {canAddMoreFiles ? (
                    <>
                      <AttachmentHoldPasteSurface
                        enabled={canAddMoreFiles}
                        onShortActivate={() => fileInputRef.current?.click()}
                        onPastedFiles={(incoming) =>
                          void appendCompressedVoucherAttachmentsToState({
                            companyId,
                            incomingFiles: incoming,
                            currentFiles: files,
                            maxFiles: fileAttachmentLimits.maxFileCount || 0,
                            allowImage: fileAttachmentLimits.allowImage,
                            allowPDF: fileAttachmentLimits.allowPDF,
                            setFiles,
                            toast: uiToast,
                          })
                        }
                        voucherAttachmentReuse={{ currentFiles: files, setFiles, maxFiles: fileAttachmentLimits.maxFileCount }}
                        className="relative flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary"
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
                        accept={
                          [fileAttachmentLimits.allowImage ? "image/*" : "", fileAttachmentLimits.allowPDF ? "application/pdf" : ""]
                            .filter(Boolean)
                            .join(",") || "image/*,application/pdf"
                        }
                        multiple={fileAttachmentLimits.maxFileCount > 1}
                      />
                    </>
                  ) : null}
                </div>
              </RestrictedFileUploader>
              <VoucherOcrRefreshBar ocr={ocr} />
            </FormItem>
            <FormField control={form.control} name="narration" render={({ field }) => (
              <FormItem data-ocr-field="bill-no" className="flex-1">
                <FormLabel>Narration</FormLabel>
                <FormControl><Textarea className="min-h-[120px]" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>
        {isBillWiseTarget && (
          <div className="space-y-3 w-full max-w-full min-w-0 px-[5px]">
            {shouldShowAdjustmentLinkButton && (
              <div className="pb-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkSection(true)}>
                  Show Link
                </Button>
              </div>
            )}
            {shouldShowAdjustmentLinkSections && (
              <div
                className={cn(
                  "space-y-2 rounded-lg border-2 p-3 w-full max-w-full min-w-0 overflow-hidden",
                  adjustmentBillWiseSide === "debit" ? "bg-green-50 border-green-300/80" : "bg-rose-50 border-rose-300/80"
                )}
              >
                <div className="flex items-center gap-2 font-semibold border-b border-border/60 pb-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>Link for bill wise ({adjustmentBillWiseSide})</span>
                </div>
                <div
                  className={cn(
                    "w-fit rounded-md border px-2 py-1 text-xs",
                    adjustmentBillWiseSide === "debit"
                      ? "border-green-200 bg-green-50/40 text-green-800"
                      : "border-pink-200 bg-pink-50/40 text-pink-800"
                  )}
                >
                  Link account: <span className="font-semibold">{selectedTarget?.name || "—"}</span>
                </div>
                {!adjustmentVoucherId ? (
                  <p className="text-sm text-blue-600">Save adjustment first to enable bill-wise linking.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {adjustmentBillWiseLinkableCount} voucher(s) available to link.
                      {adjustmentBillWiseSummary.rows.length > 0 &&
                        ` ${adjustmentBillWiseSummary.rows.length} linked.`}
                    </p>
                    {adjustmentBillWiseSummary.rows.length > 0 ? (
                      <div className="overflow-x-auto -mx-1 min-w-0 scrollbar-slim-dim-extra">
                        <table className="w-full text-sm border-collapse min-w-[320px]">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Date</th>
                              <th className="text-left p-2 font-semibold text-black whitespace-nowrap">Voucher No.</th>
                              <th className="text-right p-2 font-semibold text-black whitespace-nowrap">Linked</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adjustmentBillWiseSummary.rows.map((row) => (
                              <tr key={row.voucherId} className="border-b border-border/30 last:border-b-0">
                                <td className="p-2 text-muted-foreground whitespace-nowrap">
                                  {row.voucherNumber === "Book Opening" ? "—" : row.date ? formatDate(row.date) : "—"}
                                </td>
                                <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                                <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">
                                  {formatCurrencyForPrint(row.linkedOnCurrent, { noSuffix: true, noAnimation: true })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <div className="pt-2 border-t flex justify-end">
                      <div className="grid grid-cols-2 gap-1.5 text-sm w-fit min-w-0">
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center">
                          <span className="text-muted-foreground leading-tight">Total linked</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end">
                          <span className="text-right whitespace-nowrap leading-tight">
                            {formatCurrencyForPrint(adjustmentBillWiseSummary.linkedTotal, { noSuffix: true, noAnimation: true })}
                          </span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-center font-medium">
                          <span className="leading-tight">Balance</span>
                        </div>
                        <div className="rounded border border-border/60 bg-muted/40 px-1.5 py-px flex items-center justify-end font-medium">
                          <span
                            className={cn(
                              "text-right whitespace-nowrap leading-tight",
                              adjustmentBillWiseSummary.linkableRemaining === 0 ? "text-green-600 font-semibold" : ""
                            )}
                          >
                            {adjustmentBillWiseSummary.linkableRemaining === 0
                              ? "Settled"
                              : formatCurrencyForPrint(adjustmentBillWiseSummary.linkableRemaining, {
                                  noSuffix: true,
                                  noAnimation: true,
                                })}
                          </span>
                        </div>
                      </div>
                    </div>
                    {can("add_link") && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          onClick={() => setIsLinkDialogOpen(true)}
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          {adjustmentBillWiseSide === "debit" ? "Link to Cr" : "Link to Dr"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className={cn(
          "mt-auto border-t min-w-0 max-w-full overflow-x-hidden shrink-0 bg-background",
          isMobile ? "pt-[3px] pb-[max(6px,env(safe-area-inset-bottom,0px))]" : "pt-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4"
        )}>
          {isMobile ? (
            <div className={cn("grid grid-cols-3 gap-2 w-full", VOUCHER_BUTTONS_CLASS)}>
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))}
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Delete
              </Button>
              <Button
                type="button"
                onClick={onOpenHistory ?? (() => {})}
                disabled={!voucher?.id || !showHistoryButton || !onOpenHistory}
                className={cn("w-full", BTN_HISTORY_CLASS)}
              >
                History
              </Button>
              <Button
                type="button"
                disabled={isLoading || isAttachmentProcessing || !canSaveAdjustment || editingDisabled}
                className={cn("w-full", BTN_PRINT_CLASS)}
                onClick={(e) => handleFormSubmit(e, { print: true })}
              >
                Save & Print
              </Button>
              <Button type="button" onClick={() => onVoucherAction?.("cancelled")} className={cn("w-full", BTN_CANCEL_CLASS)}>
                Cancel
              </Button>
              <Button
                type="submit"
                {...{ [DUP_ANCHOR_ATTR]: DUP_SAVE_ANCHOR }}
                disabled={isLoading || isAttachmentProcessing || !canSaveAdjustment || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty)}
                className={cn("w-full", BTN_SAVE_CLASS)}
              >
                {isLoading ? "..." : "Save"}
              </Button>
              {voucher?.id ? (
                <Button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (isFormDirty) await handleFormSubmit(e, { approveAfterSave: true });
                    else onApprove?.();
                  }}
                  disabled={
                    editingDisabled ||
                    !showApproveButton ||
                    !onApprove ||
                    isApproving ||
                    (!!voucher?.isApproved && !isFormDirty)
                  }
                  className={cn("w-full", BTN_APPROVE_CLASS)}
                >
                  {isApproving ? "..." : isFormDirty ? "Save & Approve" : "Approve"}
                </Button>
              ) : showSaveAndApproveOnCreate ? (
                <Button
                  type="button"
                  disabled={isLoading || isAttachmentProcessing || !canSaveAdjustment || editingDisabled}
                  className={cn("w-full", BTN_APPROVE_CLASS)}
                  onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })}
                >
                  {isLoading ? "..." : "Save & Approve"}
                </Button>
              ) : (
                <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">
                  —
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap justify-center md:justify-start gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                <Button
                  type="button"
                  onClick={onOpenHistory ?? (() => {})}
                  disabled={!voucher?.id || !showHistoryButton || !onOpenHistory}
                  className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}
                >
                  <History className="mr-2 h-4 w-4" />
                  History
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full md:w-auto shrink-0 rounded-full"
                  disabled={!voucher?.id || editingDisabled || deleteDisabledWhenLinked || (!!voucher && !canDeleteVoucher(voucher))}
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
              <div className={cn("flex flex-nowrap shrink-0 whitespace-nowrap gap-2 justify-end [&_button]:shrink-0 [&_button]:whitespace-nowrap", VOUCHER_BUTTONS_CLASS)}>
                <Button type="button" onClick={() => onVoucherAction?.("cancelled")} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!!voucher || isLoading || !canSaveAdjustment || editingDisabled}
                  className={cn("shrink-0 rounded-full", BTN_SAVE_NEW_CLASS)}
                  onClick={(e) => handleFormSubmit(e, { saveAndNew: true })}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save & New
                </Button>
                <Button
                  type="button"
                  disabled={isLoading || isAttachmentProcessing || !canSaveAdjustment || editingDisabled}
                  className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}
                  onClick={(e) => handleFormSubmit(e, { print: true })}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Save & Print
                </Button>
                <Button
                  type="submit"
                  {...{ [DUP_ANCHOR_ATTR]: DUP_SAVE_ANCHOR }}
                  disabled={isLoading || isAttachmentProcessing || !canSaveAdjustment || editingDisabled || recurringVoucherSaveBlocked || (!!voucher?.id && !isFormDirty)}
                  className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
                {voucher?.id ? (
                  <Button
                    type="button"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (isFormDirty) await handleFormSubmit(e, { approveAfterSave: true });
                      else onApprove?.();
                    }}
                    disabled={
                      editingDisabled ||
                      !showApproveButton ||
                      !onApprove ||
                      isApproving ||
                      (!!voucher?.isApproved && !isFormDirty)
                    }
                    className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}
                  >
                    {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    {isFormDirty ? "Save & Approve" : "Approve"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={(e) => handleFormSubmit(e, { approveAfterSave: true })}
                    disabled={!showSaveAndApproveOnCreate || isLoading || !canSaveAdjustment || editingDisabled}
                    className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save & Approve
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </form>
      {liveDuplicate ? <DuplicateVoucherBubble match={liveDuplicate} mode="live" onDismiss={dismissLiveDuplicate} /> : null}
      <LinkPaymentToTxnsDialog
        isOpen={!!isLinkDialogOpen && adjustmentLinkContext?.kind === "party"}
        onOpenChange={(open) => {
          if (!open) setIsLinkDialogOpen(false);
        }}
        variant={adjustmentLinkContext?.side === "debit" ? "payment_out" : "payment_in"}
        isJournalLinkDialog={adjustmentLinkContext?.kind === "party"}
        partyId={adjustmentLinkContext?.kind === "party" ? adjustmentLinkContext.accountId : null}
        partyName={adjustmentLinkContext?.kind === "party" ? adjustmentLinkContext.label : "Party"}
        receivedAmount={Number(adjustmentLinkContext?.amount ?? 0) || 0}
        existingAllocations={adjustmentDialogExistingAllocations}
        paymentInId={adjustmentVoucherId || null}
        paymentOutId={adjustmentVoucherId || null}
        partyOpeningBalance={activePartySignedOpeningBalance}
        partyOpeningBalanceOutstanding={effectiveLedgerObOutstanding}
        ledgerBooksOpeningBalanceSigned={ledgerBooksOpeningBalanceSigned}
        dialogTitle={
          adjustmentLinkContext?.side === "debit"
            ? "Link Adjustment Dr to Linkable Cr Txns"
            : "Link Adjustment Cr to Linkable Dr Txns"
        }
        paymentInVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentOutVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentInDate={form.getValues("date")}
        paymentOutDate={form.getValues("date")}
        onDone={(allocations) => {
          const accountId = adjustmentLinkContext?.accountId ?? "";
          const tagged = (Array.isArray(allocations) ? allocations : []).map((a: any) => ({
            ...a,
            linkedAccountId: accountId,
          }));
          setAdjustmentAllocations(tagged);
          setIsLinkDialogOpen(false);
        }}
      />
      <LinkPaymentInToSalaryDialog
        isOpen={!!isLinkDialogOpen && adjustmentLinkContext?.kind === "staff" && adjustmentLinkContext.side === "credit"}
        onOpenChange={(open) => {
          if (!open) setIsLinkDialogOpen(false);
        }}
        staffId={adjustmentLinkContext?.kind === "staff" ? adjustmentLinkContext.accountId : null}
        staffName={adjustmentLinkContext?.kind === "staff" ? adjustmentLinkContext.label : STAFF_ENTITY_LABEL}
        paymentInId={adjustmentVoucherId || null}
        amountReceived={Number(adjustmentLinkContext?.amount ?? 0) || 0}
        existingAllocations={adjustmentDialogExistingAllocations}
        staffOpeningBalance={Number(adjustmentLinkContext?.openingBalance ?? 0) || 0}
        paymentInVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentInDate={form.getValues("date")}
        onDone={(allocations) => {
          const accountId = adjustmentLinkContext?.accountId ?? "";
          const tagged = (Array.isArray(allocations) ? allocations : []).map((a: any) => ({
            ...a,
            linkedAccountId: accountId,
          }));
          setAdjustmentAllocations(tagged);
          setIsLinkDialogOpen(false);
        }}
      />
      <LinkPaymentOutToSalaryDialog
        isOpen={!!isLinkDialogOpen && adjustmentLinkContext?.kind === "staff" && adjustmentLinkContext.side === "debit"}
        onOpenChange={(open) => {
          if (!open) setIsLinkDialogOpen(false);
        }}
        staffId={adjustmentLinkContext?.kind === "staff" ? adjustmentLinkContext.accountId : null}
        staffName={adjustmentLinkContext?.kind === "staff" ? adjustmentLinkContext.label : STAFF_ENTITY_LABEL}
        paymentOutId={adjustmentVoucherId || null}
        amountPaid={Number(adjustmentLinkContext?.amount ?? 0) || 0}
        existingAllocations={adjustmentDialogExistingAllocations}
        staffOpeningBalance={Number(adjustmentLinkContext?.openingBalance ?? 0) || 0}
        paymentOutVoucherNumber={String(form.getValues("voucherNumber") || voucher?.voucherNumber || "")}
        paymentOutDate={form.getValues("date")}
        onDone={(allocations) => {
          const accountId = adjustmentLinkContext?.accountId ?? "";
          const tagged = (Array.isArray(allocations) ? allocations : []).map((a: any) => ({
            ...a,
            linkedAccountId: accountId,
          }));
          setAdjustmentAllocations(tagged);
          setIsLinkDialogOpen(false);
        }}
      />
    </Form>
    <VoucherDeleteConfirmAlertDialog
      open={isDeleteDialogOpen}
      onOpenChange={setIsDeleteDialogOpen}
      entityKind="adjustment"
      entityName={voucher?.voucherNumber || form.watch("voucherNumber") || "this adjustment"}
      onMoveToBin={handleDelete}
      onDeletePermanently={handlePermanentDelete}
      localOnlyCheck={{ companyId, collectionName: "vouchers", docId: savedVoucherId }}
      busy={isLoading}
    />
    </>
  );
}
