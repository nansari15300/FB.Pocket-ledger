
"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, CalendarIcon } from "lucide-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLiveEntityDocAttachments } from "@/hooks/useLiveEntityDocAttachments";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, serverTimestamp, Timestamp, query, collection } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
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
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { attachmentLockFieldsForFinalUrls, readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  EntityProfilePhotoBlock,
  EntityDocumentsBlock,
  EntityOpeningBalanceNarrationField,
} from "@/components/common/EntityProfileDocumentsNarrationFields";

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
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { beginApkLedgerAsyncWriteShield } from "@/lib/apkLedgerRouteShield";
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
import type { Tax, TaxGroup } from "@/components/tax/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { TAX_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
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
import { CreateTaxGroupDialog } from "./CreateTaxGroupDialog";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MAX_IMAGE_BYTES_BEFORE_COMPRESS, MAX_IMAGE_MB_BEFORE_COMPRESS } from "@/lib/fileUploadLimits";
import { toast as sonnerToast } from "sonner";
import { apkCloudCompanyOfflineViewOnly, apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  finalizeMasterOpeningBalanceSideEffects,
  masterOpeningPatchFromPersisted,
} from "@/lib/fyPagination/masterOpeningSaveHooks";
import { useVouchers } from "@/hooks/useVouchers";

const formSchema = z.object({
  name: z.string().min(2, { message: "Account name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  rate: z.number().min(0, "Tax rate cannot be negative.").max(100, "Tax rate cannot be over 100."),
  openingBalance: z.coerce.number(),
  openingBalanceDate: z.date().optional(),
  groupId: z.string().optional(),
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

type FormValues = z.infer<typeof formSchema>;

const MAX_FILE_SIZE_MB = 0.5;

export function EditTaxDialog({ tax, allTaxes, onTaxUpdated, onTaxDeleted, children, hasTransactions, isOpen: controlledIsOpen, onOpenChange, presentationMode = "default" }: {
  tax: Tax;
  allTaxes: Tax[];
  onTaxUpdated: (updated?: Partial<Tax>) => void;
  onTaxDeleted: (id: string) => void;
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
  const navigatorOnline = useNavigatorOnline();
  const localSqlMirror = useMemo(() => apkEntityWriteUsesLocalSqliteMirror(company), [company]);
  const sqliteListsOnlyNoSnapshot = useMemo(
    () => localSqlMirror || apkCloudEntityMasterReadFromSqliteMirror(company),
    [localSqlMirror, company]
  );
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );
  const { user } = useAuth();
  const { canAddAvatar, canAddFileImagePdf, can, role } = usePermissions();
  const isMobile = useIsMobile();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const { processedTaxGroups } = useVouchers();
  const processedTaxGroupsRef = useRef(processedTaxGroups);
  processedTaxGroupsRef.current = processedTaxGroups;
  const { dateSystem } = useDate();
  const [groups, setGroups] = useState<TaxGroup[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | string | null>(tax.fileUrl || null);
  const [docSlots, setDocSlots] = useState<Array<File | string>>(() => tax.documentFileUrls || []);
  const initialFileRef = useRef<string | null>(tax.fileUrl || null);
  const initialDocUrlsRef = useRef<string[]>(tax.documentFileUrls || []);
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
    collection: "taxes",
    entityId: tax.id,
    attachmentsDirty,
    preferSqliteMirror: sqliteListsOnlyNoSnapshot,
    onFields: onLiveAttachmentFields,
  });


  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      name: tax.name,
      aliasName: (((tax as unknown) as { aliasName?: string }).aliasName) || "",
      phone: tax.phone ?? "",
      whatsapp: tax.whatsapp === true,
      rate: tax.rate,
      openingBalance: tax.openingBalance || 0,
      openingBalanceDate: (tax as any).openingBalanceDate?.toDate ? (tax as any).openingBalanceDate.toDate() : undefined,
      groupId: tax.groupId || "",
      openingBalanceNarration: tax.openingBalanceNarration ?? "",
    },
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  useEffect(() => {
    if (isOpen) {
      const dateValue = (tax as any).openingBalanceDate;
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
        name: tax.name,
        aliasName: (((tax as unknown) as { aliasName?: string }).aliasName) || "",
        rate: tax.rate,
        openingBalance: tax.openingBalance || 0,
        openingBalanceDate: finalDate,
        groupId: tax.groupId || "",
        openingBalanceNarration: tax.openingBalanceNarration ?? "",
      });
      setFile(tax.fileUrl || null);
      setDocSlots(tax.documentFileUrls || []);
      initialFileRef.current = tax.fileUrl || null;
      initialDocUrlsRef.current = tax.documentFileUrls || [];
    }
  }, [isOpen, tax, form]);
  
  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    const seedFb = () => {
      const fb = (processedTaxGroupsRef.current || []) as TaxGroup[];
      if (fb.length > 0) setGroups(fb);
    };

    if (sqliteListsOnlyNoSnapshot) {
      seedFb();
      void (async () => {
        try {
          const rows = await listCompanyDocsFromBrowserDb(companyId, "tax_groups");
          if (cancelled) return;
          if (rows.length) {
            setGroups(rows.map((r: any) => ({ ...r, id: r.id } as TaxGroup)));
          }
        } catch (e) {
          console.warn("[EditTaxDialog] tax_groups mirror load failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/tax_groups`));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const fetchedGroups = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TaxGroup));
        setGroups(fetchedGroups);
    }, (error) => {
        console.error("Error fetching groups:", error);
        const fb = (processedTaxGroupsRef.current || []) as TaxGroup[];
        if (fb.length > 0) setGroups(fb);
    });
    
    return () => unsubscribe();
  }, [isOpen, companyId, toast, processedTaxGroups, sqliteListsOnlyNoSnapshot]);

  function onSubmit(values: FormValues): void {
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
    const taxRefSnap = tax;
    const attachmentBaselineSnap = captureEntityFormAttachmentBaseline({
      fileUrl: initialFileRef.current,
      documentFileUrls: initialDocUrlsRef.current,
    });

    setIsOpen(false); // Dialog instant close; uploads + Firestore in background chunk below

    void (async () => {
      beginApkLedgerAsyncWriteShield({ pinCompanyId: companyId });
      const toastId = sonnerToast.loading("Updating tax...");
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
            collectionSeg: "taxes",
            entityId: taxRefSnap.id,
            avatarFile: needAvatarUpload ? (prepared.avatar as File) : null,
            documentFiles: needNewDocsUpload ? newDocFiles : [],
          });
          if (st.fileUrl) fileUrl = st.fileUrl;
          documentFileUrls = [...keptDocUrls, ...st.documentFileUrls];
        }

        const oldOpeningBalance = taxRefSnap.openingBalance || 0;
        const newOpeningBalance = values.openingBalance || 0;
        const narrationClean = values.openingBalanceNarration?.trim() || null;
        const updatePayload = {
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          phone: values.phone?.trim() || null,
          whatsapp: values.whatsapp === true,
          rate: values.rate,
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate || null,
          groupId: values.groupId || null,
          fileUrl,
          documentFileUrls: documentFileUrls.length ? documentFileUrls : [],
          ...attachmentLockFieldsForFinalUrls(documentFileUrls, {
            existingLockedPdfFileUrls: readLockedPdfFileUrlsFromRow(
              tax as unknown as Record<string, unknown>
            ),
            canUnlockLockedPdf: can("unlock_locked_pdf"),
          }),
          openingBalanceNarration: narrationClean,
          updatedAt: serverTimestamp(),
        };

        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "taxes", taxRefSnap.id);
          const base: Record<string, unknown> = fromDb ?? {
            id: taxRefSnap.id,
            companyId,
            ownerId: user?.uid ?? "local_guest_user",
            balance: taxRefSnap.balance,
            debit: taxRefSnap.debit,
            credit: taxRefSnap.credit,
            isDeleted: false,
          };
          const payload: Record<string, unknown> = {
            ...base,
            ...updatePayload,
            id: taxRefSnap.id,
            companyId,
            updatedAt: Timestamp.now(),
          };
          await upsertCompanyDocInBrowserDb(companyId, "taxes", taxRefSnap.id, payload);
          const persisted =
            (await getCompanyDocFromBrowserDb(companyId, "taxes", taxRefSnap.id)) ?? payload;
          await enqueueCompanyDocOutbox(companyId, "taxes", "update", taxRefSnap.id, persisted);
          await syncEntityAttachmentsAfterSave(companyId);

          await finalizeMasterOpeningBalanceSideEffects({
            company,
            companyId,
            collection: "taxes",
            entityId: taxRefSnap.id,
            oldOpeningBalance,
            newOpeningBalance,
            oldOpeningBalanceDate: (taxRefSnap as any).openingBalanceDate,
            newOpeningBalanceDate: values.openingBalanceDate,
          });

          const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
          onTaxUpdated({
            id: taxRefSnap.id,
            ...values,
            ...masterOpeningPatchFromPersisted(persisted),
            fileUrl: fileUrl || "",
            documentFileUrls,
          });
          initialFileRef.current = fileUrl || null;
          initialDocUrlsRef.current = documentFileUrls.filter((u): u is string => typeof u === "string");
          finalizeFormAttachmentEditAfterSave({
            companyId,
            baselineUrls: attachmentBaselineSnap,
            finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
            oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
          });
          sonnerToast.success(showSyncHint ? "Updated. Will sync when online." : "Tax Updated!", {
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
          collection: "taxes",
          docId: taxRefSnap.id,
          patch: updatePayload,
        });
        await syncEntityAttachmentsAfterSave(companyId);

        await finalizeMasterOpeningBalanceSideEffects({
          company,
          companyId,
          collection: "taxes",
          entityId: taxRefSnap.id,
          oldOpeningBalance,
          newOpeningBalance,
          oldOpeningBalanceDate: (taxRefSnap as any).openingBalanceDate,
          newOpeningBalanceDate: values.openingBalanceDate,
        });

        onTaxUpdated({
          id: taxRefSnap.id,
          ...values,
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate,
          openingBalanceNarration: narrationClean ?? "",
          fileUrl: fileUrl || "",
          documentFileUrls,
        });
        initialFileRef.current = fileUrl || null;
        initialDocUrlsRef.current = documentFileUrls.filter((u): u is string => typeof u === "string");
        finalizeFormAttachmentEditAfterSave({
          companyId,
          baselineUrls: attachmentBaselineSnap,
          finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
          oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
        });
        sonnerToast.success("Tax Updated!", { id: toastId, description: `"${values.name}" has been successfully updated.` });
      } catch (error) {
        console.error("Error updating tax:", error);
        sonnerToast.error("Error Updating Tax", {
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
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This tax ledger has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
        {
          // Never-synced local doc => permanent local delete (no Firestore / recycle bin).
          const { tryHardDeleteNeverSyncedDoc } = await import("@/lib/localOnlyHardDelete");
          const hd = await tryHardDeleteNeverSyncedDoc(companyId, "taxes", tax.id);
          if (hd === "cancelled") {
            setIsDeleteDialogOpen(false);
            return;
          }
          if (hd === "hard") {
            toast({ title: "Deleted", description: "Not synced yet - permanently removed from this device." });
            onTaxDeleted(tax.id);
            setIsOpen(false);
            setIsDeleteDialogOpen(false);
            return;
          }
        }
        if (localSqlMirror) {
          // Local mode me delete ko recycle-bin flag ke saath local DB + outbox me queue karo.
          const localDoc = {
            ...(tax as any),
            isDeleted: true,
            deletedAt: Date.now(),
            id: tax.id,
            companyId,
          };
          await upsertCompanyDocInBrowserDb(companyId, "taxes", tax.id, localDoc);
          await enqueueCompanyDocOutbox(companyId, "taxes", "update", tax.id, localDoc);
        } else {
          await updateDoc(doc(firestore, `companies/${companyId}/taxes`, tax.id), {
              isDeleted: true,
              deletedAt: serverTimestamp()
          });
        }
        toast({ title: "Tax Moved to Recycle Bin", description: `"${tax.name}" has been moved to the recycle bin.`});
        onTaxDeleted(tax.id);
        setIsOpen(false);
        setIsDeleteDialogOpen(false);
    } catch (error) {
        console.error("Error deleting tax: ", error);
        toast({
            variant: "destructive",
            title: "Delete Failed",
            description: "An error occurred while deleting the tax.",
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
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This tax ledger has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(companyId, "taxes", tax.id);
      toast({
        title: "Tax deleted permanently",
        description: `"${tax.name}" was permanently deleted.`,
      });
      onTaxDeleted(tax.id);
      setIsOpen(false);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error permanently deleting tax: ", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "Could not permanently delete the tax ledger.",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleGroupCreated = (newGroupId: string) => {
    form.setValue('groupId', newGroupId);
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
      console.error("File compression error:", err);
      toast({ variant: "destructive", title: "File Error", description: "Could not process the file." });
    }
    e.target.value = "";
  }


  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen} modal={false}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
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
            <DialogTitle>Edit Tax</DialogTitle>
            <DialogDescription>Update the details for {tax.name}.</DialogDescription>
          </DialogHeader>
          <div className={masterEntityDialogFormWrapperClassName}>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 sm:pr-2">
                <MasterFormNameAcNoRow
                  entityKind="tax"
                  entityId={tax.id}
                  mode="edit"
                  nameField={
                    <div className="space-y-2"><FormField
                      control={form.control}
                      name="name"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Tax Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., VAT" {...field} />
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
                      <FormLabel>Group</FormLabel>
                      <MasterGroupTreeCombobox
                        preset={TAX_ENTITY_GROUP_PRESET}
                        groups={groups}
                        processedGroups={processedTaxGroups as TaxGroup[]}
                        popoverModal={false}
                        confirmWithOk
                        value={field.value}
                        onChange={(value, newName) => {
                          if (value === "add-new") {
                            setIsCreateGroupOpen(true);
                             setTimeout(() => {
                              document.dispatchEvent(new CustomEvent('prefill-create-tax-group-name', { detail: newName }));
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
                <FormField
                control={form.control}
                name="rate"
                render={({ field }: any) => (
                    <FormItem>
                    <FormLabel>Tax Rate (%)</FormLabel>
                    <FormControl>
                        <Input 
                          type="number" 
                          value={field.value || ''} 
                          onChange={(e) => {
                            const value = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                            field.onChange(value);
                          }}
                          onBlur={field.onBlur}
                        />
                    </FormControl>
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
                           <div className={cn("grid", dateSystem === 'Both' && "grid-cols-1 sm:grid-cols-2 gap-2")}>
                                {(dateSystem === 'BS' || dateSystem === 'Both') && (
                                    <BsDatePicker
                                      valueAD={field.value}
                                      onChangeAD={(d) => { field.onChange(d as Date); setIsCalendarOpen(false); }}
                                      isRange={false}
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
                  inputId="edit-tax-avatar"
                  attachmentCompanyId={companyId ?? undefined}
                  attachmentReusePlaceKey={tax.id ? `taxes/${tax.id}` : null}
                />
                <EntityDocumentsBlock
                  docSlots={docSlots}
                  setDocSlots={setDocSlots}
                  onRemoveDoc={removeDocAt}
                  onAddClick={() => docsInputRef.current?.click()}
                  docsInputRef={docsInputRef}
                  onDocsChange={handleDocsChange}
                  canAttachDocuments={canAttachDocuments}
                  attachmentCompanyId={companyId ?? undefined}
                  attachmentReusePlaceKey={tax.id ? `taxes/${tax.id}` : null}
                  entityStatementLabel="tax"
                  inputId="edit-tax-docs"
                  existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(
                    tax as unknown as Record<string, unknown>
                  )}
                />
                <EntityOpeningBalanceNarrationField
                  control={form.control}
                  name="openingBalanceNarration"
                  detailLabel="tax"
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
                      {hasTransactions && (
                        <TooltipContent>
                          <p>Cannot delete a tax ledger with existing transactions.</p>
                        </TooltipContent>
                      )}
                      {!hasTransactions && apkOfflineViewOnly && (
                        <TooltipContent>
                          <p>Offline — view only.</p>
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
        entityKind="tax ledger"
        entityName={tax.name}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "taxes", docId: tax.id }}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
      <CreateTaxGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups} />
    </>
  );
}
