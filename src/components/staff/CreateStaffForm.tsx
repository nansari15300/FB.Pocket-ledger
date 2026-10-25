"use client";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CalendarIcon } from "lucide-react";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, setDoc, collection, serverTimestamp, query, Timestamp } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import {
  stageEntityAvatarAndDocuments,
  syncEntityAttachmentsAfterSave,
  uploadEntityAvatarAndDocumentsRemote,
  isProfileAvatarImageFile,
  isProfileDocumentFile,
} from "@/lib/entityProfileLocalFiles";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import {
  EntityProfilePhotoBlock,
  EntityDocumentsBlock,
  EntityOpeningBalanceNarrationField,
} from "@/components/common/EntityProfileDocumentsNarrationFields";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import { Input } from "@/components/ui/input";
import { Textarea } from "../ui/textarea";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { STAFF_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { useVouchers } from "@/hooks/useVouchers";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { cn } from "@/lib/utils";
import {
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { refineMasterOpeningBalanceDateRequired } from "@/lib/masterOpeningBalanceDateRequired";
import { useMasterOpeningBalanceDateRequired } from "@/hooks/useMasterOpeningBalanceDateRequired";
import { BTN_SAVE_NEW_CLASS } from "@/components/vouchers/voucherButtonStyles";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DateRange } from "@/components/ui/ad-calendar";

import { toast as sonnerToast } from "sonner";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { firestore } from "@/lib/firebase";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import {
  MAX_IMAGE_BYTES_BEFORE_COMPRESS,
  MAX_IMAGE_BYTES_AFTER_COMPRESS,
  MAX_IMAGE_MB_BEFORE_COMPRESS,
} from "@/lib/fileUploadLimits";
import {
  fetchRemoteUrlAsFile,
  staffPrefillPartsFromStaffRow,
} from "@/lib/crossCompanyMasterPrefill";
import { useDate } from "@/hooks/useDate";
import { MasterFormNameAcNoRow, MasterMobileNoField, MasterFormTwoColGrid } from "@/components/inter-company/MasterFormLayout";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";

import type { StaffGroup } from "@/components/staff/types";
import { CreateStaffGroupDialog } from "./CreateStaffGroupDialog";
import {
  getDefaultSystemGroupId,
  isMasterEntitySystemGroupId,
  normalizeStaffGroupIdForStorage,
} from "@/lib/masterEntitySystemGroups";
import { resolveMasterGroupTreeBranchIdForGroup } from "@/lib/masterGroupTreeCombobox";
import {
  LOAN_LIABILITY_GROUP_ID,
} from "@/modules/loans/constants/loanConstants";
import {
  STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID,
  STAFF_SYSTEM_GROUP_ID,
  type StaffAccountTypeId,
} from "@/lib/staffSystemGroups";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";
import {
  apkCloudEntityMasterReadFromSqliteMirror,
  apkCloudCompanyOfflineViewOnly,
  apkEntityWriteUsesLocalSqliteMirror,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox, isLikelyOfflineFirestoreError } from "@/lib/localVoucherOutbox";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

const formSchema = z.object({
  accountType: z.enum([LOAN_LIABILITY_GROUP_ID, STAFF_SYSTEM_GROUP_ID], {
    message: "Account type is required.",
  }),
  name: z.string().min(2, { message: "Staff name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  address: z.string().optional(),
  salary: z.coerce.number().optional(),
  openingBalance: z.coerce.number().optional(),
  openingBalanceDate: z.date().optional(),
  salaryPeriod: z.enum(["Daily", "Weekly", "Monthly", "Yearly"]).optional(),
  groupId: z.string().min(1, "Group is required."),
  /** Party/staff edit jaisa — opening row narration statement par */
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

const MAX_FILE_SIZE_MB = 0.5;

type FormValues = z.infer<typeof formSchema>;

function staffPersistFields(values: Pick<FormValues, "groupId" | "accountType">) {
  const groupId = normalizeStaffGroupIdForStorage(values.groupId, values.accountType);
  return {
    groupId,
    isLoanAccount: values.accountType === LOAN_LIABILITY_GROUP_ID,
  };
}

function staffFormResetDefaults(accountType: StaffAccountTypeId = STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID) {
  return {
    accountType,
    name: "", aliasName: "",
    email: "",
    phone: "",
    address: "",
    salary: 0,
    openingBalance: 0,
    salaryPeriod: "Monthly" as const,
    groupId: getDefaultSystemGroupId("staff", { accountType }),
    openingBalanceNarration: "",
  };
}

export function CreateStaffForm({
  onStaffCreated,
  onCloseDialogRequest,
  groups: initialGroups,
  onClose,
  onNestedDialogOpenChange,
  defaultName,
}: {
  onStaffCreated?: (isSaveAndNew: boolean, newId: string) => void;
  /** Shuts parent dialog immediately (like CreateParty) — then save runs in background. */
  onCloseDialogRequest?: () => void;
  groups: StaffGroup[];
  onClose?: () => void;
  onNestedDialogOpenChange?: (open: boolean) => void;
  defaultName?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  /** Staff-group combobox: APK cloud SQLite mirror path (`warm sync`). */
  const sqliteListsSkipFirestore = useMemo(
    () =>
      apkEntityWriteUsesLocalSqliteMirror(company) || apkCloudEntityMasterReadFromSqliteMirror(company),
    [company]
  );

  /** APK cloud company offline: staff create vouchers jaisa Save band (`apkCloudCompanyOfflineViewOnly`). */
  const navigatorOnline = useNavigatorOnline();
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );

  const { canAddAvatar, canAddFileImagePdf } = usePermissions();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;

  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  React.useEffect(() => { onNestedDialogOpenChange?.(isCreateGroupOpen); }, [isCreateGroupOpen, onNestedDialogOpenChange]);
  const [groups, setGroups] = useState<StaffGroup[]>(initialGroups || []);
  const { processedStaffGroups } = useVouchers();

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  /** Profile — image only; docs alag `documentFiles` (Firebase: local: staging pehle) */
  const [avatarToUpload, setAvatarToUpload] = useState<{ file: File; preview: string } | null>(null);
  const [documentFiles, setDocumentFiles] = useState<Array<File | string>>([]);

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // ---------------------------
  // Form
  // ---------------------------
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      accountType: STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID,
      name: "", aliasName: "",
      email: "",
      phone: "",
      address: "",
      salary: 0,
      openingBalance: 0,
      salaryPeriod: "Monthly",
      groupId: getDefaultSystemGroupId("staff", { accountType: STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID }),
      openingBalanceNarration: "",
    },
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  const accountType = form.watch("accountType");

  // ---------------------------
  // Load groups from Firestore
  // ---------------------------
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    if (sqliteListsSkipFirestore) {
      void (async () => {
        try {
          const rows = await listCompanyDocsFromBrowserDb(companyId, "staff_groups");
          if (cancelled) return;
          const mapped = rows.map(
            (r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as StaffGroup)
          );
          if (mapped.length > 0) setGroups(mapped);
        } catch (e) {
          console.warn("[CreateStaffForm] staff_groups SQLite mirror failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/staff_groups`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedGroups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as StaffGroup));
      setGroups(fetchedGroups);
    });
    return () => unsubscribe();
  }, [companyId, sqliteListsSkipFirestore]);

  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const current = form.getValues("groupId");
    const type = form.getValues("accountType");
    if (!current) {
      form.setValue("groupId", getDefaultSystemGroupId("staff", { accountType: type }), {
        shouldDirty: false,
      });
    }
  }, [companyId, user?.uid, form]);

  // ---------------------------
  // If current groupId doesn't exist, auto-fix to default system branch
  // ---------------------------
  useEffect(() => {
    const current = form.getValues("groupId");
    const type = form.getValues("accountType");
    const defaultGroupId = getDefaultSystemGroupId("staff", { accountType: type });
    const exists =
      current === defaultGroupId ||
      isMasterEntitySystemGroupId(STAFF_ENTITY_GROUP_PRESET, current) ||
      groups.some((g) => g.id === current);
    if (!exists && current) {
      form.setValue("groupId", defaultGroupId, { shouldDirty: false });
    }
  }, [groups, form]);

  // ---------------------------
  // Prefill: defaultName prop (e.g. from Add Salary staff search) or custom event
  // ---------------------------
  useEffect(() => {
    if (defaultName != null && defaultName !== "") {
      form.setValue("name", defaultName);
    }
  }, [defaultName, form]);

  useEffect(() => {
    const handlePrefill = (event: any) => {
      form.setValue("name", event.detail || "");
    };
    document.addEventListener("prefill-create-staff-name", handlePrefill as any);
    return () => document.removeEventListener("prefill-create-staff-name", handlePrefill as any);
  }, [form]);

  const handleGroupCreated = (newGroupId: string) => {
    form.setValue("groupId", newGroupId);
    setIsCreateGroupOpen(false);
  };

  // ---------------------------
  // Profile photo (image) + opening-balance documents — CreateBankAccountDialog jaisa staging
  // ---------------------------
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
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
      
      const preview = URL.createObjectURL(compressedFile);
      setAvatarToUpload({ file: compressedFile, preview });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "File Error", description: "Could not process the file." });
    }
    e.target.value = "";
  };

  const handleDocumentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    if (!canAttachDocuments) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow documents." });
      return;
    }
    const incoming = Array.from(e.target.files).filter(isProfileDocumentFile);
    setDocumentFiles((prev) => [...prev, ...incoming].slice(0, 5));
    e.target.value = "";
  };

  const removeAvatar = () => {
    if (avatarToUpload?.preview) URL.revokeObjectURL(avatarToUpload.preview);
    setAvatarToUpload(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const removeDocAt = (idx: number) => setDocumentFiles((prev) => prev.filter((_, i) => i !== idx));

  const clearUploads = () => {
    removeAvatar();
    setDocumentFiles([]);
    if (docsInputRef.current) docsInputRef.current.value = "";
  };

  /** Save & Copy To / Copy chip: source staff row + HTTPS avatar/docs → local File staging (party-full parity). */
  useEffect(() => {
    const handleFull = async (event: CustomEvent<{ rowPayload?: Record<string, unknown> }>) => {
      const row = event.detail?.rowPayload;
      if (!row || typeof row !== "object") return;
      const { defaults, remoteAvatarUrl, remoteDocumentUrls } = staffPrefillPartsFromStaffRow(row);
      setAvatarToUpload((prev) => {
        if (prev?.preview) URL.revokeObjectURL(prev.preview);
        return null;
      });
      setDocumentFiles([]);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      if (docsInputRef.current) docsInputRef.current.value = "";
      form.reset({
        name: defaults.name,
        email: defaults.email,
        phone: defaults.phone,
        address: defaults.address,
        salary: defaults.salary,
        openingBalance: defaults.openingBalance,
        openingBalanceDate: defaults.openingBalanceDate,
        salaryPeriod: defaults.salaryPeriod,
        groupId: getDefaultSystemGroupId("staff", { accountType: STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID }),
        accountType: STAFF_FORM_DEFAULT_ACCOUNT_TYPE_ID,
        openingBalanceNarration: defaults.openingBalanceNarration,
      });
      if (remoteAvatarUrl?.trim() && canAddAvatar) {
        try {
          const raw = await fetchRemoteUrlAsFile(remoteAvatarUrl, "staff-avatar.jpg");
          if (raw) {
            let f = raw;
            let capBytes = Number.POSITIVE_INFINITY;
            try {
              const _img = await compressImageForCompany(raw, companyId);
              f = _img.file;
              capBytes = _img.maxBytes;
            } catch {
              /* raw hi use karo */
            }
            if (f.size > capBytes) {
              toast({
                variant: "destructive",
                title: "Avatar too large",
                description: "Fetched image could not be compressed enough.",
              });
            } else {
              const preview = URL.createObjectURL(f);
              setAvatarToUpload({ file: f, preview });
            }
          }
        } catch {
          /* network/CORS par fetch fail — text fields phir bhi prefilled */
        }
      }
      if (remoteDocumentUrls?.length && canAttachDocuments) {
        const files: File[] = [];
        for (let i = 0; i < Math.min(remoteDocumentUrls.length, 5); i++) {
          const url = remoteDocumentUrls[i];
          const guessed = url.toLowerCase().includes(".pdf") ? `staff-doc-${i + 1}.pdf` : `staff-doc-${i + 1}.jpg`;
          const f = await fetchRemoteUrlAsFile(url, guessed);
          if (f) files.push(f);
        }
        if (files.length) setDocumentFiles(files);
      }
    };
    document.addEventListener("prefill-create-staff-full", handleFull as unknown as EventListener);
    return () => document.removeEventListener("prefill-create-staff-full", handleFull as unknown as EventListener);
  }, [form, canAddAvatar, canAttachDocuments, toast]);

  // ---------------------------
  // Submit
  // ---------------------------
  function handleFormSubmit(e: React.FormEvent, options: { saveAndNew?: boolean } = {}) {
    e.preventDefault();
    void (async () => {
      const isValid = await form.trigger();
      if (!isValid) {
        sonnerToast.error("Validation Failed", { description: "Please check all fields and try again." });
        return;
      }
      if (apkOfflineViewOnly) {
        sonnerToast.error("Offline — view only.");
        return;
      }
      if (!options.saveAndNew) {
        onCloseDialogRequest?.();
      } else {
        setIsLoading(true);
      }
      void processAndSave(form.getValues(), options.saveAndNew || false);
    })();
  }

  async function processAndSave(values: FormValues, saveAndNew: boolean = false) {
    if (!user || !companyId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in and have a company selected.",
      });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsLoading(false);
      return;
    }

    const toastId = sonnerToast.loading("Saving staff member...");
    setIsLoading(true);

    try {
      if (apkEntityWriteUsesLocalSqliteMirror(company)) {
        // Local-only: IndexedDB pending files + SQLite — turant Storage upload nahi
        const totalAttachBytesLocal =
          (avatarToUpload?.file.size ?? 0) + documentFiles.reduce((s, f) => s + (f instanceof File ? f.size : 0), 0);
        if (totalAttachBytesLocal > 0) {
          const limitCheck = await checkStorageLimit(
            companyId,
            company?.planId,
            { attachmentsBytes: totalAttachBytesLocal, storageBytes: totalAttachBytesLocal },
            company?.storageOption
          );
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
            setIsLoading(false);
            return;
          }
        }
        const localId = createLocalEntityId("staff");
        const interCompanyAccountNo = await interCompanyAcNoForNewEntity("staff");
        const stagedLocal = await stageEntityAvatarAndDocuments({
          companyId,
          collectionSeg: "staff",
          entityId: localId,
          avatarFile: avatarToUpload?.file ?? null,
          documentFiles: documentFiles.filter((f): f is File => f instanceof File),
        });
        const { accountType, ...staffValues } = values;
        const persisted = staffPersistFields(values);
        const payload = {
          id: localId,
          ...staffValues,
          ...persisted,
          openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
          ownerId: user.uid,
          companyId,
          groupId: persisted.groupId,
          balance: values.openingBalance || 0,
          openingBalance: values.openingBalance || 0,
          openingBalanceDate: values.openingBalanceDate || null,
          fileUrl: stagedLocal.fileUrl ?? null,
          ...(stagedLocal.documentFileUrls.length ? { documentFileUrls: stagedLocal.documentFileUrls } : {}),
          createdAt: new Date().toISOString(),
          isDeleted: false,
          interCompanyAccountNo,
        };
        await upsertCompanyDocInBrowserDb(companyId, "staff", localId, payload);
        await enqueueCompanyDocOutbox(companyId, "staff", "create", localId, payload);
        syncEntityAttachmentsAfterSave(companyId);
        const showSyncHint = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1" && user.uid !== "local_guest_user";
        sonnerToast.success(showSyncHint ? "Saved. Will sync when online." : "Saved.", {
          id: toastId,
          description: showSyncHint
            ? `"${values.name}" was saved locally and will sync when online.`
            : `"${values.name}" was saved locally.`,
        });
        if (saveAndNew) {
          form.reset(staffFormResetDefaults());
          clearUploads();
        }
        onStaffCreated?.(saveAndNew, localId);
        return;
      }

      // Recycle-bin duplicate flow: restore or create-new on user choice.
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId,
        collectionName: "staff",
        name: values.name.trim(),
        entityLabel: sidebarEntityMenuLabel("staff"),
      });
      if (duplicateDecision.decision === "active_exists") {
        sonnerToast.error("Duplicate Staff Name", {
          id: toastId,
          description: "A staff member with this name already exists.",
        });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        sonnerToast.success("Staff Restored!", {
          id: toastId,
          description: `"${values.name.trim()}" was restored from Recycle Bin.`,
        });
        onStaffCreated?.(saveAndNew, duplicateDecision.restoredId);
        setIsLoading(false);
        return;
      }

      const totalAttachBytes =
        (avatarToUpload?.file.size ?? 0) + documentFiles.reduce((s, f) => s + (f instanceof File ? f.size : 0), 0);
      if (totalAttachBytes > 0) {
        const limitCheck = await checkStorageLimit(
          companyId,
          company?.planId,
          { attachmentsBytes: totalAttachBytes, storageBytes: totalAttachBytes },
          company?.storageOption
        );
        if (!limitCheck.allowed) {
          sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
          setIsLoading(false);
          return;
        }
      }

      // Pehle Firestore doc id — `stageEntityAvatarAndDocuments` isi se path banata hai
      const persisted = staffPersistFields(values);
      const { accountType, ...staffValues } = values;
      const staffRef = doc(collection(firestore, `companies/${companyId}/staff`));
      const newStaffId = staffRef.id;
      // Online: Storage → HTTPS URLs in Firestore (other devices; not only local: + syncPendingFiles)
      const staged = await uploadEntityAvatarAndDocumentsRemote({
        companyId: companyId!,
        collectionSeg: "staff",
        entityId: newStaffId,
        avatarFile: avatarToUpload?.file ?? null,
        documentFiles: documentFiles.filter((f): f is File => f instanceof File),
      });

      const interCompanyAccountNo = await interCompanyAcNoForNewEntity("staff");
      await setDoc(staffRef, {
        ...staffValues,
        ...persisted,
        openingBalance: values.openingBalance || 0,
        openingBalanceDate: values.openingBalanceDate || null,
        openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
        ownerId: user.uid,
        companyId,
        balance: values.openingBalance || 0,
        isDeleted: false,
        createdAt: serverTimestamp(),
        interCompanyAccountNo,
        fileUrl: staged.fileUrl,
        ...(staged.documentFileUrls.length ? { documentFileUrls: staged.documentFileUrls } : {}),
      });

      if (totalAttachBytes > 0) {
        await incrementCompanyStorage(companyId, {
          attachmentsBytes: totalAttachBytes,
          storageBytes: totalAttachBytes,
        });
      }

      // Automatically balance opening balance with Capital Account
      if (values.openingBalance && Math.abs(values.openingBalance) > 0.01) {
        const { balanceOpeningBalanceWithCapital } = await import("@/lib/voucherActionsClient");
        await balanceOpeningBalanceWithCapital(companyId!, "staff", newStaffId, 0, values.openingBalance);
      }

      sonnerToast.success("Staff Member Created!", {
        id: toastId,
        description: `"${values.name}" has been successfully added.`,
      });

      if (saveAndNew) {
        form.reset(staffFormResetDefaults());
        clearUploads();
      }

      onStaffCreated?.(saveAndNew, newStaffId);
    } catch (error) {
      console.error("Error creating staff member:", error);
      if (isLikelyOfflineFirestoreError(error) && apkEntityWriteUsesLocalSqliteMirror(company)) {
        try {
          if (!companyId || !user) throw new Error("Missing company or user.");
          const totalCatch =
            (avatarToUpload?.file.size ?? 0) + documentFiles.reduce((s, f) => s + (f instanceof File ? f.size : 0), 0);
          if (totalCatch > 0) {
            const lim = await checkStorageLimit(
              companyId,
              company?.planId,
              { attachmentsBytes: totalCatch, storageBytes: totalCatch },
              company?.storageOption
            );
            if (!lim.allowed) throw new Error(lim.message || "Storage limit reached.");
          }
          const localId = createLocalEntityId("staff");
          const stagedCatch = await stageEntityAvatarAndDocuments({
            companyId,
            collectionSeg: "staff",
            entityId: localId,
            avatarFile: avatarToUpload?.file ?? null,
            documentFiles: documentFiles.filter((f): f is File => f instanceof File),
          });
          const catchPersisted = staffPersistFields(values);
          const { accountType: _accountType, ...catchStaffValues } = values;
          const nowTs = Timestamp.now();
          const payload: Record<string, unknown> = {
            id: localId,
            ...catchStaffValues,
            ...catchPersisted,
            openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
            ownerId: user.uid,
            companyId,
            balance: values.openingBalance || 0,
            openingBalance: values.openingBalance || 0,
            openingBalanceDate: values.openingBalanceDate || null,
            fileUrl: stagedCatch.fileUrl ?? null,
            ...(stagedCatch.documentFileUrls.length ? { documentFileUrls: stagedCatch.documentFileUrls } : {}),
            createdAt: nowTs,
            isDeleted: false,
          };
          await upsertCompanyDocInBrowserDb(companyId, "staff", localId, payload as any);
          await enqueueCompanyDocOutbox(companyId, "staff", "create", localId, payload as any);
          syncEntityAttachmentsAfterSave(companyId);
          sonnerToast.success("Saved. Will sync when online.", {
            id: toastId,
            description: `"${values.name}" was saved locally (offline).`,
          });
          onStaffCreated?.(saveAndNew, localId);
          if (saveAndNew) {
            form.reset(staffFormResetDefaults());
            clearUploads();
          }
        } catch {
          sonnerToast.error("Error", { id: toastId, description: "Failed to create staff member. Please try again." });
        }
      } else {
        sonnerToast.error("Error", {
          id: toastId,
          description: "Failed to create staff member. Please try again.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ---------------------------
  // UI
  // ---------------------------
  const { dateSystem } = require("@/hooks/useDate").useDate?.() || { dateSystem: "AD" }; // (keep safe if hook refactor)

  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => handleFormSubmit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="pl-master-form-scroll min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 sm:pr-2">
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="accountType"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Account Type</FormLabel>
                  <RadioGroup
                    className="flex flex-col gap-2 sm:flex-row sm:gap-6"
                    value={field.value}
                    onValueChange={(next: StaffAccountTypeId) => {
                      field.onChange(next);
                      const currentBranch = resolveMasterGroupTreeBranchIdForGroup(
                        form.getValues("groupId"),
                        processedStaffGroups as StaffGroup[],
                        STAFF_ENTITY_GROUP_PRESET
                      );
                      const expectedBranch = next;
                      if (currentBranch !== expectedBranch) {
                        form.setValue(
                          "groupId",
                          getDefaultSystemGroupId("staff", { accountType: next }),
                          { shouldDirty: true }
                        );
                      }
                    }}
                  >
                    <FormItem className="flex items-center space-x-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value={STAFF_SYSTEM_GROUP_ID} />
                      </FormControl>
                      <FormLabel className="cursor-pointer font-normal">Staff</FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value={LOAN_LIABILITY_GROUP_ID} />
                      </FormControl>
                      <FormLabel className="cursor-pointer font-normal">Loan & Liabilities</FormLabel>
                    </FormItem>
                  </RadioGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
            <MasterFormNameAcNoRow
              entityKind="staff"
              mode="create"
              nameField={
                <div className="space-y-2"><FormField
                  control={form.control}
                  name="name"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Jane Doe" {...field} />
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
                <FormItem className="flex flex-col space-y-1 w-full">
                  <FormLabel>Group/Department</FormLabel>
                  <FormControl>
                    <div className="w-full">
                      <MasterGroupTreeCombobox
                        preset={STAFF_ENTITY_GROUP_PRESET}
                        groups={groups}
                        processedGroups={processedStaffGroups as StaffGroup[]}
                        popoverModal={false}
                        confirmWithOk
                        value={field.value}
                        onBranchChange={(branchId) => {
                          if (branchId === LOAN_LIABILITY_GROUP_ID || branchId === STAFF_SYSTEM_GROUP_ID) {
                            form.setValue("accountType", branchId as StaffAccountTypeId, {
                              shouldDirty: true,
                            });
                          }
                        }}
                        onChange={(val, newName) => {
                          if (val === "add-new") {
                            setIsCreateGroupOpen(true);
                            setTimeout(() => {
                              document.dispatchEvent(
                                new CustomEvent("prefill-create-staff-group-name", {
                                  detail: newName,
                                })
                              );
                            }, 100);
                          } else {
                            const gid = val === "none" ? "" : val;
                            field.onChange(gid);
                            if (gid) {
                              const branchId = resolveMasterGroupTreeBranchIdForGroup(
                                gid,
                                processedStaffGroups as StaffGroup[],
                                STAFF_ENTITY_GROUP_PRESET
                              );
                              if (
                                branchId === LOAN_LIABILITY_GROUP_ID ||
                                branchId === STAFF_SYSTEM_GROUP_ID
                              ) {
                                form.setValue("accountType", branchId as StaffAccountTypeId, {
                                  shouldDirty: true,
                                });
                              }
                            }
                          }
                        }}
                        placeholder="Select a group"
                        searchPlaceholder="Search groups..."
                        addNewLabel="Add New Group"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="name@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            </MasterFormTwoColGrid>

            {/* Salary + Period */}
            <FormItem>
              <FormLabel>Salary</FormLabel>
              <div className="flex gap-2">
                <FormField
                  control={form.control}
                  name="salary"
                  render={({ field }: any) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="salaryPeriod"
                  render={({ field }: any) => (
                    <FormItem>
                      <Select onValueChange={field.onChange} value={field.value || "Monthly"}>
                        <FormControl>
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Daily">Daily</SelectItem>
                          <SelectItem value="Weekly">Weekly</SelectItem>
                          <SelectItem value="Monthly">Monthly</SelectItem>
                          <SelectItem value="Yearly">Yearly</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </FormItem>

            {/* Address — single scroll: dialog wrapper scrolls; avoid extra overflow on this field. */}
            <FormField
              control={form.control}
              name="address"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Enter full address" {...field} className="resize-none" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Opening Balance + Date */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MasterOpeningBalanceAmountField control={form.control} />

              <FormField
                control={form.control}
                name="openingBalanceDate"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>As on Date</FormLabel>
                    <div className={cn("grid", dateSystem === "Both" && "grid-cols-1 sm:grid-cols-2 gap-2")}>
                      {(dateSystem === "BS" || dateSystem === "Both") && (
                        <BsDatePicker valueAD={field.value} onChangeAD={(d?: Date | DateRange) => { field.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} />
                      )}

                      {(dateSystem === "AD" || dateSystem === "Both") && (
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
                          <PopoverContent className="w-auto p-0 z-[102]" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={(date) => {
                                field.onChange(date);
                                setIsCalendarOpen(false);
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Profile photo / docs / narration — party+staff edit ke shared blocks (statement opening row) */}
            <EntityProfilePhotoBlock
              file={avatarToUpload?.file ?? null}
              onPickClick={() => avatarInputRef.current?.click()}
              fileInputRef={avatarInputRef}
              onAvatarChange={handleAvatarChange}
              onRemoveAvatar={removeAvatar}
              canAddAvatar={canAddAvatar}
              inputId="create-staff-avatar"
            />
            <EntityDocumentsBlock
              docSlots={documentFiles}
              setDocSlots={setDocumentFiles}
              onRemoveDoc={removeDocAt}
              onAddClick={() => docsInputRef.current?.click()}
              docsInputRef={docsInputRef}
              onDocsChange={handleDocumentsChange}
              canAttachDocuments={canAttachDocuments}
              attachmentCompanyId={companyId ?? undefined}
              entityStatementLabel="staff"
              inputId="create-staff-docs"
            />
            <EntityOpeningBalanceNarrationField
              control={form.control}
              name="openingBalanceNarration"
              detailLabel="staff"
            />
          </div>
          </div>

          {/* Masters create row: Cancel (gray pill) • Save & New • Submit — pink cancel hata */}
          <div className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
            <Button
              type="button"
              variant="ghost"
              className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}
              onClick={() => (onCloseDialogRequest ?? onClose)?.()}
              disabled={isLoading || isCompressing}
            >
              Cancel
            </Button>
            <div className="flex min-w-0 flex-1 justify-center px-1">
              <Button
                type="button"
                variant="ghost"
                className={cn(BTN_SAVE_NEW_CLASS, "shrink-0 px-4")}
                onClick={(e) => handleFormSubmit(e, { saveAndNew: true })}
                disabled={isLoading || isCompressing || apkOfflineViewOnly || openingBalanceDateMissing}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save & New
              </Button>
            </div>
            <Button type="submit" disabled={isLoading || isCompressing || !companyId || apkOfflineViewOnly || openingBalanceDateMissing} className="shrink-0">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add {STAFF_ENTITY_LABEL}
            </Button>
          </div>
        </form>
      </Form>

      <CreateStaffGroupDialog
        onGroupCreated={handleGroupCreated}
        isOpen={isCreateGroupOpen}
        onOpenChange={setIsCreateGroupOpen}
        groups={groups}
        initialSystemBranch={accountType}
      />
    </>
  );
}
