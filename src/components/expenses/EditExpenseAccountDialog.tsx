
"use client";

import { DialogPlainOpener } from "@/components/ui/dialog-plain-opener";
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, CalendarIcon } from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  uploadEntityAvatarAndDocumentsRemote,
  syncEntityAttachmentsAfterSave,
  isProfileAvatarImageFile,
  isProfileDocumentFile,
} from "@/lib/entityProfileLocalFiles";
import {
  captureEntityFormAttachmentBaseline,
  finalizeFormAttachmentEditAfterSave,
} from "@/lib/formAttachmentEditHelper";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  finalizeMasterOpeningBalanceSideEffects,
  masterOpeningPatchFromPersisted,
} from "@/lib/fyPagination/masterOpeningSaveHooks";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { attachmentLockFieldsForFinalUrls, readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  EntityProfilePhotoBlock,
  EntityDocumentsBlock,
  EntityOpeningBalanceNarrationField,
} from "@/components/common/EntityProfileDocumentsNarrationFields";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MAX_IMAGE_BYTES_BEFORE_COMPRESS, MAX_IMAGE_MB_BEFORE_COMPRESS } from "@/lib/fileUploadLimits";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, serverTimestamp, Timestamp, query, collection } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { MasterDeleteConfirmAlertDialog } from "@/components/common/MasterDeleteConfirmAlertDialog";
import { permanentDeleteCompanySubdocFromRecycleBin } from "@/lib/recycleBinEntityLifecycle";
import { assertCanPermanentDeleteFromForm } from "@/lib/permanentDeleteFromForm";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import {
  MasterFormNameAcNoRow,
  MasterFormTwoColGrid,
  MasterMobileNoField,
} from "@/components/inter-company/MasterFormLayout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/plClientSession";
import {
  MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS,
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import {
  guardMasterEditOutsideDismiss,
  masterEditBackdropClassName,
  masterEditPopoverContentClassName,
  NESTED_LEDGER_MASTER_EDIT_CONTENT_CN,
  NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN,
  type MasterEditPresentationMode,
} from "@/lib/nestedLedgerMasterEditPresentation";
import { refineMasterOpeningBalanceDateRequired } from "@/lib/masterOpeningBalanceDateRequired";
import { useMasterOpeningBalanceDateRequired } from "@/hooks/useMasterOpeningBalanceDateRequired";
import { useCompany } from "@/hooks/useCompany";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import { CreateExpenseGroupDialog } from "./CreateExpenseGroupDialog";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { EXPENSE_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useDate } from "@/hooks/useDate";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cnMasterEntityDialogContent,
  masterEntityDialogHeaderClassName,
  masterEntityDialogFormWrapperClassName,
} from "@/lib/masterEntityDialogClasses";
import { format } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { toast as sonnerToast } from "sonner";
import { normalizeExpenseGroupIdForStorage } from "@/lib/masterEntitySystemGroups";
import type { ExpenseGroupCreatedPayload } from "./CreateExpenseGroupDialog";
import {
  apkCloudEntityMasterReadFromSqliteMirror,
  apkCloudCompanyOfflineViewOnly,
  apkEntityWriteUsesLocalSqliteMirror,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { useVouchers } from "@/hooks/useVouchers";
import { useLiveEntityDocAttachments } from "@/hooks/useLiveEntityDocAttachments";

/** Form load: legacy ungrouped ids → system branch (Income / Expenses). */
function normalizeExpenseAccountEditGroupId(
  groupId: string | null | undefined,
  accountType?: string | null
): string {
  return normalizeExpenseGroupIdForStorage(groupId, accountType);
}

const formSchema = z.object({
  name: z.string().min(2, { message: "Account name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  groupId: z.string().optional(),
  openingBalance: z.coerce.number(),
  openingBalanceDate: z.date().optional(),
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

const MAX_FILE_SIZE_MB = 0.5;

export function EditExpenseAccountDialog({ account, onAccountUpdated, onAccountDeleted, children, hasTransactions, isOpen: controlledIsOpen, onOpenChange, presentationMode = "default" }: {
  account: ExpenseAccount;
  onAccountUpdated: (updated?: Partial<ExpenseAccount>) => void;
  onAccountDeleted: (id: string) => void;
  children: React.ReactNode;
  hasTransactions: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  presentationMode?: MasterEditPresentationMode;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = useCallback((open: boolean) => {
    if (controlledIsOpen === undefined) {
      setInternalIsOpen(open);
    }
    onOpenChange?.(open);
  }, [controlledIsOpen, onOpenChange]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();
  const { companyId, company } = useCompany();
  const { user } = useAuth();
  const { canAddAvatar, canAddFileImagePdf, can, role } = usePermissions();
  const isMobile = useIsMobile();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const { processedExpenseGroups } = useVouchers();
  const processedExpenseGroupsRef = useRef(processedExpenseGroups);
  processedExpenseGroupsRef.current = processedExpenseGroups;
  const [groups, setGroups] = useState<ExpenseGroup[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const { dateSystem } = useDate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | string | null>(account.fileUrl || null);
  const [docSlots, setDocSlots] = useState<Array<File | string>>(() => account.documentFileUrls || []);
  const initialFileRef = useRef<string | null>(account.fileUrl || null);
  const initialDocUrlsRef = useRef<string[]>(account.documentFileUrls || []);


  /** Pure-local=outbox lane; APK cloud lists SQLite mirror (`apkCloudEntityMasterReadFromSqliteMirror`). */
  const localSqlMirror = useMemo(() => apkEntityWriteUsesLocalSqliteMirror(company), [company]);
  const sqliteListsOnlyNoSnapshot = useMemo(
    () => localSqlMirror || apkCloudEntityMasterReadFromSqliteMirror(company),
    [localSqlMirror, company]
  );

  const navigatorOnline = useNavigatorOnline();
  /** APK + Firestore company offline: voucher jaisa Save / Move-to-Bin disable (pure-local exempt). */
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );
  const attachmentsDirty =
    file instanceof File ||
    docSlots.some((x) => x instanceof File) ||
    (typeof file === "string" ? file : null) !== initialFileRef.current ||
    JSON.stringify(docSlots.filter((x): x is string => typeof x === "string")) !==
      JSON.stringify(initialDocUrlsRef.current);
  const onLiveAttachmentFields = useCallback(
    (fields: { fileUrl?: string | null; documentFileUrls?: string[] }) => {
      if (fields.fileUrl !== undefined) {
        const nextFile = fields.fileUrl || null;
        setFile(nextFile);
        initialFileRef.current = nextFile;
      }
      if (fields.documentFileUrls) {
        setDocSlots(fields.documentFileUrls);
        initialDocUrlsRef.current = fields.documentFileUrls;
      }
    },
    []
  );
  useLiveEntityDocAttachments({
    enabled: isOpen,
    companyId,
    collection: "expense_accounts",
    entityId: account.id,
    attachmentsDirty,
    preferSqliteMirror: sqliteListsOnlyNoSnapshot,
    onFields: onLiveAttachmentFields,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as Resolver<z.infer<typeof formSchema>>,
    defaultValues: {
      name: account.name,
      aliasName: (((account as unknown) as { aliasName?: string }).aliasName) || "",
      phone: account.phone ?? "",
      whatsapp: account.whatsapp === true,
      groupId: normalizeExpenseAccountEditGroupId(account.groupId, account.type),
      openingBalance: account.openingBalance || 0,
      openingBalanceDate: (account as any).openingBalanceDate?.toDate ? (account as any).openingBalanceDate.toDate() : undefined,
      openingBalanceNarration: account.openingBalanceNarration ?? "",
    },
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  useEffect(() => {
    if (isOpen) {
      const dateValue = (account as any).openingBalanceDate;
      let finalDate;
      if (dateValue?.toDate) {
          finalDate = dateValue.toDate();
      } else if (dateValue instanceof Date) {
          finalDate = dateValue;
      } else if (dateValue) {
          finalDate = new Date(dateValue);
      } else {
          finalDate = undefined;
      }
      form.reset({
        name: account.name,
        aliasName: (((account as unknown) as { aliasName?: string }).aliasName) || "",
        phone: account.phone ?? "",
        whatsapp: account.whatsapp === true,
        groupId: normalizeExpenseAccountEditGroupId(account.groupId, account.type),
        openingBalance: account.openingBalance || 0,
        openingBalanceDate: finalDate,
        openingBalanceNarration: account.openingBalanceNarration ?? "",
      });
      setFile(account.fileUrl || null);
      setDocSlots(account.documentFileUrls || []);
      initialFileRef.current = account.fileUrl || null;
      initialDocUrlsRef.current = account.documentFileUrls || [];
    }
  }, [isOpen, account, form]);
  
  useEffect(() => {
    if (!companyId || !isOpen) return;
    let cancelled = false;

    const seedFb = () => {
      const fb = (processedExpenseGroupsRef.current || []) as ExpenseGroup[];
      if (fb.length) setGroups(fb);
    };

    if (sqliteListsOnlyNoSnapshot) {
      seedFb();
      void (async () => {
        try {
          const rows = await listCompanyDocsFromBrowserDb(companyId, "expense_groups");
          if (cancelled) return;
          const mapped = rows.map(
            (r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as ExpenseGroup)
          );
          if (mapped.length) setGroups(mapped);
        } catch (e) {
          console.warn("[EditExpenseAccountDialog] expense_groups mirror failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/expense_groups`));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ExpenseGroup)));
      },
      (error) => {
        console.error("Error fetching expense groups:", error);
        const fb = (processedExpenseGroupsRef.current || []) as ExpenseGroup[];
        if (fb.length > 0) setGroups(fb);
      }
    );
    return () => unsubscribe();
  }, [companyId, isOpen, sqliteListsOnlyNoSnapshot]);

  function onSubmit(values: z.infer<typeof formSchema>): void {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }

    const fileSnap = file;
    const docSlotsSnap = docSlots;
    const accountRefSnap = account;
    const attachmentBaselineSnap = captureEntityFormAttachmentBaseline({
      fileUrl: initialFileRef.current,
      documentFileUrls: initialDocUrlsRef.current,
    });

    setIsOpen(false); // Master edit: backdrop hat turant; save async

    void (async () => {
      const toastId = sonnerToast.loading("Updating expense account...");
      const isLocalGuestUser = user?.uid === "local_guest_user";
      const backupSyncEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1";
      setIsLoading(true);
      try {
        const { prepareMasterEditAttachmentsForSave } = await import(
          "@/lib/attachmentRecompressOnSave"
        );
        const prepared = await prepareMasterEditAttachmentsForSave({
          companyId,
          avatar: fileSnap,
          documents: docSlotsSnap,
        });
        let fileUrl: string | null = typeof prepared.avatar === "string" ? prepared.avatar : null;
        const newDocFiles = prepared.newDocFiles;
        const keptDocUrls = prepared.keptDocUrls;
        const totalBytes =
          (prepared.avatar instanceof File ? prepared.avatar.size : 0) +
          newDocFiles.reduce((s, f) => s + f.size, 0);
        if (totalBytes > 0 && companyId) {
          const limitCheck = await checkStorageLimitSafe(
            companyId,
            company?.planId,
            { attachmentsBytes: totalBytes, storageBytes: totalBytes },
            company?.storageOption
          );
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
            return;
          }
        }

        const needAvatarUpload = prepared.avatar instanceof File && canAddAvatar;
        const needNewDocsUpload = newDocFiles.length > 0 && canAttachDocuments;
        let documentFileUrls = [...keptDocUrls];
        if (companyId && (needAvatarUpload || needNewDocsUpload)) {
          const st = await uploadEntityAvatarAndDocumentsRemote({
            companyId,
            collectionSeg: "expense_accounts",
            entityId: accountRefSnap.id,
            avatarFile: needAvatarUpload ? (prepared.avatar as File) : null,
            documentFiles: needNewDocsUpload ? newDocFiles : [],
          });
          if (st.fileUrl) fileUrl = st.fileUrl;
          documentFileUrls = [...keptDocUrls, ...st.documentFileUrls];
        }

        const oldOpeningBalance = accountRefSnap.openingBalance || 0;
        const newOpeningBalance = values.openingBalance || 0;
        const narrationClean = values.openingBalanceNarration?.trim() || null;
        const updatePayload = {
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          phone: values.phone?.trim() || null,
          whatsapp: values.whatsapp === true,
          groupId: values.groupId || null,
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate || null,
          openingBalanceNarration: narrationClean,
          fileUrl,
          documentFileUrls: documentFileUrls.length ? documentFileUrls : [],
          ...attachmentLockFieldsForFinalUrls(documentFileUrls, {
            existingLockedPdfFileUrls: readLockedPdfFileUrlsFromRow(
              account as unknown as Record<string, unknown>
            ),
            canUnlockLockedPdf: can("unlock_locked_pdf"),
          }),
        };

        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "expense_accounts", accountRefSnap.id);
          const base: Record<string, unknown> = fromDb ?? {
            id: accountRefSnap.id,
            companyId,
            balance: accountRefSnap.balance,
            debit: accountRefSnap.debit,
            credit: accountRefSnap.credit,
            isDeleted: false,
            type: accountRefSnap.type,
          };
          const payload: Record<string, unknown> = {
            ...base,
            ...updatePayload,
            id: accountRefSnap.id,
            companyId,
            updatedAt: Timestamp.now(),
          };
          await upsertCompanyDocInBrowserDb(companyId, "expense_accounts", accountRefSnap.id, payload);
          const persisted =
            (await getCompanyDocFromBrowserDb(companyId, "expense_accounts", accountRefSnap.id)) ?? payload;
          await enqueueCompanyDocOutbox(companyId, "expense_accounts", "update", accountRefSnap.id, persisted);
          await syncEntityAttachmentsAfterSave(companyId);

          await finalizeMasterOpeningBalanceSideEffects({
            company,
            companyId,
            collection: "expense_accounts",
            entityId: accountRefSnap.id,
            oldOpeningBalance,
            newOpeningBalance,
            oldOpeningBalanceDate: (accountRefSnap as any).openingBalanceDate,
            newOpeningBalanceDate: values.openingBalanceDate,
          });

          const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
          setFile(fileUrl || null);
          setDocSlots(documentFileUrls);
          initialFileRef.current = fileUrl || null;
          initialDocUrlsRef.current = documentFileUrls;
          finalizeFormAttachmentEditAfterSave({
            companyId,
            baselineUrls: attachmentBaselineSnap,
            finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
            oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
          });
          onAccountUpdated({
            id: accountRefSnap.id,
            ...values,
            ...masterOpeningPatchFromPersisted(persisted),
            fileUrl: fileUrl || "",
          });
          sonnerToast.success(showSyncHint ? "Updated. Will sync when online." : "Account Updated!", {
            id: toastId,
            description: showSyncHint ? `"${values.name}" saved locally.` : `"${values.name}" has been successfully updated.`,
          });
          return;
        }

        if (totalBytes > 0 && companyId) {
          await incrementCompanyStorage(companyId, {
            attachmentsBytes: totalBytes,
            storageBytes: totalBytes,
          });
        }

        const { persistMasterEntityUpdate } = await import("@/lib/masterEntityUpdatePersist");
        await persistMasterEntityUpdate({
          companyId,
          collection: "expense_accounts",
          docId: accountRefSnap.id,
          patch: updatePayload,
        });

        await finalizeMasterOpeningBalanceSideEffects({
          company,
          companyId,
          collection: "expense_accounts",
          entityId: accountRefSnap.id,
          oldOpeningBalance,
          newOpeningBalance,
          oldOpeningBalanceDate: (accountRefSnap as any).openingBalanceDate,
          newOpeningBalanceDate: values.openingBalanceDate,
        });

        await syncEntityAttachmentsAfterSave(companyId);
        setFile(fileUrl || null);
        setDocSlots(documentFileUrls);
        initialFileRef.current = fileUrl || null;
        initialDocUrlsRef.current = documentFileUrls;
        finalizeFormAttachmentEditAfterSave({
          companyId,
          baselineUrls: attachmentBaselineSnap,
          finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
          oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
        });
        onAccountUpdated({
          id: accountRefSnap.id,
          ...values,
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate,
          openingBalanceNarration: narrationClean ?? "",
          fileUrl: fileUrl || "",
        });
        sonnerToast.success("Account Updated!", { id: toastId, description: `"${values.name}" has been successfully updated.` });
      } catch (error) {
        console.error("Error updating account:", error);
        sonnerToast.error("Error Updating Account", {
          id: toastId,
          description: error instanceof Error ? error.message : "An error occurred. Please try again.",
        });
      } finally {
        setIsLoading(false);
      }
    })();
  }

  const handleDelete = async () => {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This account has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
        {
          // Never-synced local doc => permanent local delete (no Firestore / recycle bin).
          const { tryHardDeleteNeverSyncedDoc } = await import("@/lib/localOnlyHardDelete");
          const hd = await tryHardDeleteNeverSyncedDoc(companyId, "expense_accounts", account.id);
          if (hd === "cancelled") {
            setIsDeleteDialogOpen(false);
            return;
          }
          if (hd === "hard") {
            toast({ title: "Deleted", description: "Not synced yet - permanently removed from this device." });
            onAccountDeleted(account.id);
            setIsOpen(false);
            setIsDeleteDialogOpen(false);
            return;
          }
        }
        await updateDoc(doc(firestore, `companies/${companyId}/expense_accounts`, account.id), {
            isDeleted: true,
            deletedAt: serverTimestamp()
        });
        toast({ title: "Account Moved to Bin", description: `"${account.name}" has been moved to the recycle bin.`});
        onAccountDeleted(account.id);
        setIsOpen(false);
        setIsDeleteDialogOpen(false);
    } catch (error) {
        console.error("Error deleting account: ", error);
        toast({
            variant: "destructive",
            title: "Delete Failed",
            description: "An error occurred while deleting the account.",
        });
    } finally {
        setIsLoading(false);
    }
  }

  const handlePermanentDelete = async () => {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    try {
      assertCanPermanentDeleteFromForm(can, role);
    } catch (err) {
      sonnerToast.error("Permission Denied", {
        description: err instanceof Error ? err.message : "No permission",
      });
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This account has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(companyId, "expense_accounts", account.id);
      toast({
        title: "Account deleted permanently",
        description: `"${account.name}" was permanently deleted.`,
      });
      onAccountDeleted(account.id);
      setIsOpen(false);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error permanently deleting account: ", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "Could not permanently delete the account.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const mergeCreatedGroup = (created?: ExpenseGroupCreatedPayload) => {
    if (!created?.id) return;
    setGroups((prev) => {
      const existing = prev.find((g) => g.id === created.id);
      if (existing) {
        return prev.map((g) =>
          g.id === created.id ? { ...g, name: created.name, parentId: created.parentId } : g
        );
      }
      return [
        ...prev,
        {
          id: created.id,
          name: created.name,
          parentId: created.parentId,
          balance: 0,
        } as ExpenseGroup,
      ];
    });
  };

  const handleGroupCreated = (newGroupId: string, created?: ExpenseGroupCreatedPayload) => {
    if (!newGroupId) return;
    mergeCreatedGroup(created ?? { id: newGroupId, name: "", parentId: "" });
    form.setValue("groupId", newGroupId, { shouldDirty: true, shouldValidate: true });
    setIsCreateGroupOpen(false);
  };

  const removeAvatar = () => {
    setFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const handleDocsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    if (!canAttachDocuments) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow documents." });
      return;
    }
    const incoming = Array.from(e.target.files).filter(isProfileDocumentFile);
    setDocSlots((prev) => [...prev, ...incoming].slice(0, 5));
    e.target.value = "";
  };

  const removeDocAt = (idx: number) => setDocSlots((p) => p.filter((_, i) => i !== idx));

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    if (!canAddAvatar) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow a profile photo." });
      return;
    }
    const inputFile = e.target.files[0];
    if (!inputFile || !isProfileAvatarImageFile(inputFile)) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Image only", description: "Profile photo: JPG, PNG, WebP, etc." });
      return;
    }
    if (inputFile.size > MAX_IMAGE_BYTES_BEFORE_COMPRESS) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Please select a file smaller than ${MAX_IMAGE_MB_BEFORE_COMPRESS}MB to compress.`,
      });
      e.target.value = "";
      return;
    }
    try {
      const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(inputFile, companyId);
      
      setFile(compressedFile);
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "File Error", description: "Could not process the file." });
    }
    e.target.value = "";
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen} modal={false}>
        {children ? <DialogPlainOpener onOpen={() => setIsOpen(true)}>{children}</DialogPlainOpener> : null}
        {isOpen && <div className={masterEditBackdropClassName(presentationMode)} />}
        <DialogContent 
            overlayClassName={
              presentationMode === "nested-ledger" ? NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN : undefined
            }
            className={cn(
              cnMasterEntityDialogContent(isMobile),
              "sm:max-w-2xl",
              presentationMode === "nested-ledger" && NESTED_LEDGER_MASTER_EDIT_CONTENT_CN
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => {
              guardMasterEditOutsideDismiss(presentationMode, e, isCreateGroupOpen);
            }}
            onInteractOutside={(e) => {
              guardMasterEditOutsideDismiss(presentationMode, e, isCreateGroupOpen);
            }}
            onFocusOutside={(e) => {
              guardMasterEditOutsideDismiss(presentationMode, e);
            }}
        >
          <DialogHeader className={masterEntityDialogHeaderClassName}>
            <DialogTitle>Edit Expense Account</DialogTitle>
            <DialogDescription>Update the details for {account.name}.</DialogDescription>
          </DialogHeader>
          <div className={masterEntityDialogFormWrapperClassName}>
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.stopPropagation();
                void form.handleSubmit(onSubmit)(e);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 sm:pr-2">
              <MasterFormNameAcNoRow
                entityKind="expense"
                entityId={account.id}
                mode="edit"
                nameField={
                  <div className="space-y-2"><FormField
                    control={form.control}
                    name="name"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Account Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Office Rent" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  /><FormField
                    control={form.control}
                    name="aliasName"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Alias Name <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Other name on bills / short name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  /></div>
                }
              />
              <MasterFormTwoColGrid>
                <MasterMobileNoField control={form.control} />
                <FormField
                  control={form.control}
                  name="groupId"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Group (Optional)</FormLabel>
                      <MasterGroupTreeCombobox
                        preset={EXPENSE_ENTITY_GROUP_PRESET}
                        groups={groups}
                        processedGroups={processedExpenseGroups as ExpenseGroup[]}
                        popoverModal={false}
                        confirmWithOk
                        value={field.value}
                        onChange={(value, newName) => {
                          if (value === "add-new") {
                            setIsCreateGroupOpen(true);
                            setTimeout(() => {
                              document.dispatchEvent(
                                new CustomEvent("prefill-create-expense-group-name", { detail: newName })
                              );
                            }, 100);
                          } else {
                            field.onChange(value === "none" ? "" : value);
                          }
                        }}
                        placeholder="Select a group"
                        searchPlaceholder="Search groups..."
                        addNewLabel="Add New Group"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </MasterFormTwoColGrid>
              <MasterFormTwoColGrid>
                <MasterOpeningBalanceAmountField control={form.control} />
                <FormField
                  control={form.control}
                    name="openingBalanceDate"
                    render={({ field }: any) => (
                      <FormItem data-opening-balance-date>
                    <FormLabel>As on Date</FormLabel>
                      <div className={cn("grid", dateSystem === 'Both' && "grid-cols-2 gap-2")}>
                          {(dateSystem === 'BS' || dateSystem === 'Both') && (
                              <BsDatePicker
                                isRange={false}
                                valueAD={field.value}
                                onChangeAD={(d) => { field.onChange(d as Date); setIsCalendarOpen(false); }}
                                popoverContentClassName={masterEditPopoverContentClassName(presentationMode)}
                              />
                          )}
                          {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <Popover modal={true} open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      variant={"outline"}
                                      className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                                    >
                                      {field.value ? format(field.value, "MMM-dd-yyyy") : <span>Pick a date</span>}
                                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className={masterEditPopoverContentClassName(presentationMode, "w-auto p-0")} align="start">
                                  <Calendar mode="single" selected={field.value} onSelect={(date) => { field.onChange(date); setIsCalendarOpen(false); }} initialFocus />
                                </PopoverContent>
                              </Popover>
                          )}
                      </div>
                    <FormMessage />
                    </FormItem>
                  )}
                />
              </MasterFormTwoColGrid>

              <EntityProfilePhotoBlock
                file={file}
                onPickClick={() => avatarInputRef.current?.click()}
                fileInputRef={avatarInputRef}
                onAvatarChange={handleAvatarChange}
                onRemoveAvatar={removeAvatar}
                canAddAvatar={canAddAvatar}
                inputId="edit-expense-avatar"
                attachmentCompanyId={companyId ?? undefined}
                attachmentReusePlaceKey={account.id ? `expense_accounts/${account.id}` : null}
              />
              <EntityDocumentsBlock
                attachmentReusePlaceKey={account.id ? `expense_accounts/${account.id}` : null}
                docSlots={docSlots}
                setDocSlots={setDocSlots}
                onRemoveDoc={removeDocAt}
                onAddClick={() => docsInputRef.current?.click()}
                docsInputRef={docsInputRef}
                onDocsChange={handleDocsChange}
                canAttachDocuments={canAttachDocuments}
                attachmentCompanyId={companyId ?? undefined}
                entityStatementLabel="income/expense account"
                inputId="edit-expense-docs"
                existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(
                  account as unknown as Record<string, unknown>
                )}
              />
              <EntityOpeningBalanceNarrationField
                control={form.control}
                name="openingBalanceNarration"
                detailLabel="income/expense account"
              />
            </div>
              <DialogFooter className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}>
                    Cancel
                  </Button>
                </DialogClose>
                <div className="flex min-w-0 flex-1 justify-center px-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex max-w-full min-w-0 shrink" tabIndex={0}>
                          <Button
                            type="button"
                            variant="destructive"
                            className="shrink-0 px-3 sm:px-4"
                            onClick={() => setIsDeleteDialogOpen(true)}
                            disabled={hasTransactions || apkOfflineViewOnly}
                          >
                            <Trash2 className="mr-2 h-4 w-4 shrink-0" /> Move to Bin
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!hasTransactions && apkOfflineViewOnly && (
                        <TooltipContent>
                          <p>Offline — view only.</p>
                        </TooltipContent>
                      )}
                      {hasTransactions && (
                        <TooltipContent>
                          <p>Cannot delete an account with existing transactions.</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Button type={openingBalanceDateMissing ? "button" : "submit"} disabled={isLoading || isCompressing || apkOfflineViewOnly} className="shrink-0" onClick={() => {
                  if (openingBalanceDateMissing) document.querySelector("[data-opening-balance-date]")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {openingBalanceDateMissing ? "Pick a date" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
          </div>
        </DialogContent>
      </Dialog>
      
      <MasterDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityKind="account"
        entityName={account.name}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "expense_accounts", docId: account.id }}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
      <CreateExpenseGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups}/>
    </>
  );
}
