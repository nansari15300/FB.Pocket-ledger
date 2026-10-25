
"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PlusCircle, Upload, Trash2, FileText, CalendarIcon, Eye, EyeOff } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { collection, doc, serverTimestamp, query, setDoc, Timestamp } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import {
  stageEntityAvatarAndDocuments,
  syncEntityAttachmentsAfterSave,
  uploadEntityAvatarAndDocumentsRemote,
  isProfileAvatarImageFile,
  isProfileDocumentFile,
} from "@/lib/entityProfileLocalFiles";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import { Input } from "@/components/ui/input";
import { Textarea } from "../ui/textarea";
import { Separator } from "../ui/separator";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Calendar } from "@/components/ui/calendar";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MasterFormNameAcNoRow, MasterMobileNoField, MasterFormTwoColGrid } from "@/components/inter-company/MasterFormLayout";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";
import {
  MAX_IMAGE_BYTES_BEFORE_COMPRESS,
  MAX_IMAGE_MB_BEFORE_COMPRESS,
  MAX_IMAGE_BYTES_AFTER_COMPRESS,
  MAX_IMAGE_MB_AFTER_COMPRESS,
} from "@/lib/fileUploadLimits";
import { FilePreview } from "../vouchers/FilePreview";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";
import { toast as sonnerToast } from "sonner";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { PartyGroupTreeCombobox } from "@/components/party/PartyGroupTreeCombobox";
import { saveVoucher, balanceOpeningBalanceWithCapital } from "@/lib/voucherActionsClient";
import { useVouchers } from "@/hooks/useVouchers";
import usePermissions from "@/hooks/usePermissions";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Party, Group } from "./types";
import { format } from "date-fns";
import {
  PARTY_DEFAULT_SYSTEM_GROUP_ID,
  PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
  PARTY_SYSTEM_CREDITORS_ID,
  PARTY_SYSTEM_DEBTORS_ID,
  PARTY_SYSTEM_GROUP_OPTIONS,
  normalizePartyGroupIdForStorage,
} from "@/lib/partySystemGroups";
import { resolvePartyGroupBranchIdForGroup } from "@/lib/partyGroupCombobox";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  apkCloudEntityMasterReadFromSqliteMirror,
  apkCloudCompanyOfflineViewOnly,
  apkEntityWriteUsesLocalSqliteMirror,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { BTN_SAVE_NEW_CLASS } from "@/components/vouchers/voucherButtonStyles";
import {
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { refineMasterOpeningBalanceDateRequired } from "@/lib/masterOpeningBalanceDateRequired";
import { useMasterOpeningBalanceDateRequired } from "@/hooks/useMasterOpeningBalanceDateRequired";
import {
  fetchRemoteUrlAsFile,
  partyPrefillPartsFromPartyRow,
} from "@/lib/crossCompanyMasterPrefill";
import { MasterPdfAsImageToggle } from "@/components/common/EntityProfileDocumentsNarrationFields";


const formSchema = z
  .object({
    accountType: z.enum([PARTY_SYSTEM_DEBTORS_ID, PARTY_SYSTEM_CREDITORS_ID], {
      message: "Select account type.",
    }),
    name: z.string().min(2, "Party name is required."),
    aliasName: z.string().optional(),
    groupId: z.string().optional(),
    openingBalance: z.coerce.number(),
    openingBalanceDate: z.date().optional(),
    address: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
    email: z
      .union([z.string().email({ message: "Please enter a valid email." }), z.literal("")])
      .optional(),
    pan: z.string().optional(),
    /** Statement opening row — table me alag narration line */
    openingBalanceNarration: z.string().optional(),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.password || data.confirmPassword) {
        return data.password === data.confirmPassword;
      }
      return true;
    },
    { message: "Passwords do not match.", path: ["confirmPassword"] }
  )
  .superRefine(refineMasterOpeningBalanceDateRequired);

type FormValues = z.infer<typeof formSchema>;

const PARTY_TOAST_OK_MS = 1000;

type PartySaveFilesSnapshot = {
  avatar: { file: File; preview: string } | null;
  documents: File[];
};

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}


export function CreatePartyForm({
  onPartyCreated,
  onNestedDialogOpenChange,
  onCloseDialogRequest,
  initialValues,
}: {
  /** Optional prefill (e.g. OCR bill: name / PAN / phone / email / address). */
  initialValues?: { name?: string; pan?: string; phone?: string; email?: string; address?: string; /** OCR: e.g. Sundry Creditors for a purchase bill */ accountTypeId?: string; /** OCR: raw bill name when it differs from the cleaned name */ aliasName?: string };
  onPartyCreated?: (isSaveAndNew: boolean, newId: string) => void;
  onNestedDialogOpenChange?: (open: boolean) => void;
  /** "Create Party" (not Save & New): dialog band turant; save background; files snapshot se */
  onCloseDialogRequest?: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const [avatarToUpload, setAvatarToUpload] = useState<{ file: File; preview: string } | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [isCompressingLocal, setIsCompressing] = useState(false);
  const isImageCompressing = useImageCompressionProcessing();
  const isCompressing = isCompressingLocal || isImageCompressing;
  const [compressionResult, setCompressionResult] = useState<{originalSize: number, compressedSize: number} | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  React.useEffect(() => { onNestedDialogOpenChange?.(isCreateGroupOpen); }, [isCreateGroupOpen, onNestedDialogOpenChange]);


  const { toast } = useToast();
  const { user } = useAuth();
  // triggerSync hataya: company registry reload se poori UI hilti thi — party save par BUMP/listeners kaafi.
  const { setCompanyId, companyId, company } = useCompany();
  const { canAddAvatar, canAddFileImagePdf } = usePermissions();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { processedGroups } = useVouchers();
  const processedGroupsRef = useRef(processedGroups);
  processedGroupsRef.current = processedGroups;
  /** Party create lists: pure-local=outbox lane; APK cloud=warm-SQLite mirror reads (`apkCloudEntityMasterReadFromSqliteMirror`). */
  const sqliteListsSkipFirestore = useMemo(
    () =>
      apkEntityWriteUsesLocalSqliteMirror(company) || apkCloudEntityMasterReadFromSqliteMirror(company),
    [company]
  );
  const isLocalGuestUser = user?.uid === "local_guest_user";
  const backupSyncEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1";
  const navigatorOnline = useNavigatorOnline();
  /** APK Firestore company offline: party create Save band — local-storage company exempt (`apkCloudCompanyOfflineViewOnly`). */
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      accountType: (initialValues?.accountTypeId || PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID) as "sundry_debtors" | "sundry_creditors",
      name: initialValues?.name ?? "",
      aliasName: initialValues?.aliasName ?? "",
      address: initialValues?.address ?? "",
      phone: initialValues?.phone ?? "",
      email: initialValues?.email ?? "",
      pan: initialValues?.pan ?? "",
      openingBalanceNarration: "",
      password: "",
      confirmPassword: "",
      openingBalance: 0,
      groupId: initialValues?.accountTypeId || PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
    },
    mode: "onChange",
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  const accountType = form.watch("accountType");

  const displayDate = (date?: Date) => {
    if (!date || isNaN(date.getTime())) return "Pick a date";
    switch (dateSystem) {
      case "AD":
        return formatDate(date);
      case "BS":
        return formatDateBS(date);
      case "Both":
        return `${formatDate(date)} / ${formatDateBS(date)}`;
      default:
        return formatDate(date);
    }
  };
  
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    if (!canAddAvatar) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow adding a profile photo." });
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

    setIsCompressing(true);
    try {
      // Pehle normal ~150KB target; fail / zyada bada ho to doosri pass (party/item jaisa cap MAX_IMAGE_MB_AFTER_COMPRESS)
      const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(inputFile, companyId);
      setCompressionResult({ originalSize: inputFile.size, compressedSize: compressedFile.size });
      
      const preview = URL.createObjectURL(compressedFile);
      setAvatarToUpload({ file: compressedFile, preview });
    } catch (err) {
      console.error("File compression error:", err);
      toast({ variant: "destructive", title: "File Error", description: "Could not process the file." });
    } finally {
      setIsCompressing(false);
    }
    e.target.value = "";
  };

  const handleDocumentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    if (!canAttachDocuments) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow attaching documents." });
      return;
    }
    const incoming = Array.from(e.target.files).filter((f) => isProfileDocumentFile(f));
    setDocumentFiles((prev) => [...prev, ...incoming].slice(0, 5));
    e.target.value = "";
  };

  const removeAvatar = () => {
    if (avatarToUpload?.preview) URL.revokeObjectURL(avatarToUpload.preview);
    setAvatarToUpload(null);
    setCompressionResult(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const removeDocAt = (idx: number) => {
    setDocumentFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleGroupCreated = (newGroupId: string) => {
    form.setValue('groupId', newGroupId);
    setIsCreateGroupOpen(false);
  };
  
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    const seedFromVouchers = () => {
      const fb = (processedGroupsRef.current || []).filter((g: any) => !g.isDeleted) as Group[];
      if (fb.length) setGroups(fb);
    };

    /** SQLite warm mirror — APK cloud / pure-local listeners avoid karte hain. */
    const loadMirror = async (): Promise<void> => {
      try {
        const rows = await listCompanyDocsFromBrowserDb(companyId, "groups");
        if (cancelled) return;
        const mapped = rows
          .map((r: any) => ({ ...r, id: r.id } as Group))
          .filter((g) => !(g as any).isDeleted);
        if (mapped.length) setGroups(mapped);
      } catch {
        /* ignore — combobox Fallback processed groups pe */
      }
    };

    if (sqliteListsSkipFirestore) {
      seedFromVouchers();
      void loadMirror();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/groups`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Group)).filter((g) => !g.isDeleted));
    });
    return () => unsubscribe();
  }, [companyId, sqliteListsSkipFirestore]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!companyId || !user?.uid) return;
      /** Pure-local APK: Firestore-backed ungrouped seed mat chalao; cloud APK me server canonical ID chahiye. */
      if (apkEntityWriteUsesLocalSqliteMirror(company)) {
        const current = form.getValues("groupId");
        if (!current) form.setValue("groupId", PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, { shouldDirty: false });
        if (!form.getValues("accountType")) {
          form.setValue("accountType", PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, { shouldDirty: false });
        }
        return;
      }
      const defaultGroupId = PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID;
      if (!alive) return;
      const current = form.getValues("groupId");
      if (!current) form.setValue("groupId", defaultGroupId, { shouldDirty: false });
    })();
    return () => {
      alive = false;
    };
  }, [companyId, user?.uid, form, company]);

  useEffect(() => {
    const handlePrefill = (event: CustomEvent) => {
      form.setValue('name', event.detail || '');
    };
    document.addEventListener('prefill-create-party-name', handlePrefill as any);
    return () => document.removeEventListener('prefill-create-party-name', handlePrefill as any);
  }, [form]);

  /** Copy-to-company: poora source party row + remote Storage URLs se form + attachments भरो (IDs target par naye banenge). */
  useEffect(() => {
    const handleFull = async (event: CustomEvent<{ rowPayload?: Record<string, unknown> }>) => {
      const row = event.detail?.rowPayload;
      if (!row || typeof row !== "object") return;
      const { defaults, remoteAvatarUrl, remoteDocumentUrls } = partyPrefillPartsFromPartyRow(row);
      removeAvatar();
      setDocumentFiles([]);
      form.reset({
        name: defaults.name,
        address: defaults.address,
        phone: defaults.phone,
        email: defaults.email,
        pan: defaults.pan,
        openingBalance: defaults.openingBalance,
        openingBalanceDate: defaults.openingBalanceDate,
        openingBalanceNarration: defaults.openingBalanceNarration,
        groupId: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
        accountType: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID,
        password: "",
        confirmPassword: "",
      });
      if (remoteAvatarUrl?.trim() && canAddAvatar) {
        setIsCompressing(true);
        try {
          const raw = await fetchRemoteUrlAsFile(remoteAvatarUrl, "party-avatar.jpg");
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
              toast({ variant: "destructive", title: "Avatar too large", description: "Fetched image could not be compressed enough." });
            } else {
              const preview = URL.createObjectURL(f);
              setAvatarToUpload({ file: f, preview });
            }
          }
        } finally {
          setIsCompressing(false);
        }
      }
      if (remoteDocumentUrls?.length && canAttachDocuments) {
        const files: File[] = [];
        for (let i = 0; i < Math.min(remoteDocumentUrls.length, 5); i++) {
          const url = remoteDocumentUrls[i];
          const guessed = url.toLowerCase().includes(".pdf") ? `party-doc-${i + 1}.pdf` : `party-doc-${i + 1}.jpg`;
          const f = await fetchRemoteUrlAsFile(url, guessed);
          if (f) files.push(f);
        }
        if (files.length) setDocumentFiles(files);
      }
    };
    document.addEventListener("prefill-create-party-full", handleFull as unknown as EventListener);
    return () => document.removeEventListener("prefill-create-party-full", handleFull as unknown as EventListener);
  }, [form, canAddAvatar, canAttachDocuments, toast]);


  async function handleFormSubmit(e: React.FormEvent, options: { saveAndNew?: boolean } = {}) {
    e.preventDefault();
    const isValid = await form.trigger();
    if (!isValid) {
      sonnerToast.error("Validation Failed", { description: "Please check all fields and try again." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }
    if ((!user || !user.email) && !isStaticAppBuild()) {
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "You must be logged in to create a party.",
      });
      return;
    }

    const values = form.getValues();
    const files: PartySaveFilesSnapshot = {
      avatar: avatarToUpload,
      documents: [...documentFiles],
    };
    if (!options.saveAndNew) {
      onCloseDialogRequest?.();
    } else {
      setIsLoading(true);
    }
    void processAndSave(values, options.saveAndNew || false, files);
  }

  async function processAndSave(
    values: FormValues,
    saveAndNew: boolean,
    files: PartySaveFilesSnapshot
  ) {
    const avatarToUploadSnap = files.avatar;
    const documentFilesSnap = files.documents;

    try {
      if (apkEntityWriteUsesLocalSqliteMirror(company)) {
        // Local-only mode: IndexedDB pending files + SQLite row (online upload nahin)
        if (!companyId) {
          sonnerToast.error("No company selected", {
            description: "Select a company before saving a party.",
            duration: 4000,
          });
          return;
        }
        const totalAttachBytesLocal =
          (avatarToUploadSnap?.file.size ?? 0) + documentFilesSnap.reduce((s, f) => s + f.size, 0);
        if (totalAttachBytesLocal > 0) {
          const limitCheck = await checkStorageLimit(
            companyId!,
            company?.planId,
            { attachmentsBytes: totalAttachBytesLocal, storageBytes: totalAttachBytesLocal },
            company?.storageOption
          );
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { description: limitCheck.message, duration: 4000 });
            setIsLoading(false);
            return;
          }
        }
        const resolvedGroupId = normalizePartyGroupIdForStorage(values.groupId?.trim());
        const localId = createLocalEntityId("party");
        const stagedLocal = await stageEntityAvatarAndDocuments({
          companyId: companyId!,
          collectionSeg: "parties",
          entityId: localId,
          avatarFile: avatarToUploadSnap?.file ?? null,
          documentFiles: documentFilesSnap,
        });
        const nowTs = Timestamp.now();
        const payload: Record<string, unknown> = {
          id: localId,
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          address: values.address,
          phone: values.phone,
          whatsapp: values.whatsapp === true,
          email: values.email,
          pan: values.pan,
          openingBalance: values.openingBalance,
          openingBalanceDate: values.openingBalanceDate || null,
          openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
          ownerId: user?.uid || "local_guest_user",
          companyId,
          groupId: resolvedGroupId,
          balance: values.openingBalance,
          isDeleted: false,
          createdAt: nowTs,
          fileUrl: stagedLocal.fileUrl ?? null,
          ...(stagedLocal.documentFileUrls.length
            ? { documentFileUrls: stagedLocal.documentFileUrls }
            : {}),
        };
        await upsertCompanyDocInBrowserDb(companyId!, "parties", localId, payload);
        await enqueueCompanyDocOutbox(companyId!, "parties", "create", localId, payload);
        syncEntityAttachmentsAfterSave(companyId!);
        const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
        sonnerToast.success(showSyncHint ? "Saved — will sync" : "Saved", {
          duration: PARTY_TOAST_OK_MS,
          description: showSyncHint ? "Background" : values.name,
        });
        if (saveAndNew) {
          form.reset({ accountType: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, name: "", aliasName: "", address: "", phone: "", email: "", pan: "", openingBalanceNarration: "", password: "", confirmPassword: "", openingBalance: 0, openingBalanceDate: undefined, groupId: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID });
          removeAvatar();
          setDocumentFiles([]);
        }
        onPartyCreated?.(saveAndNew, localId);
        return;
      }

      // Online mode only: Recycle-bin duplicate flow Firestore query ke through.
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId: companyId!,
        collectionName: "parties",
        name: values.name.trim(),
        entityLabel: sidebarEntityMenuLabel("party"),
      });
      if (duplicateDecision.decision === "active_exists") {
        sonnerToast.error("Duplicate party name", {
          description: "A party with this name already exists.",
          duration: 4000,
        });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        sonnerToast.success("Restored", {
          duration: PARTY_TOAST_OK_MS,
          description: values.name.trim(),
        });
        onPartyCreated?.(saveAndNew, duplicateDecision.restoredId);
        setIsLoading(false);
        return;
      }

      const totalAttachBytes =
        (avatarToUploadSnap?.file.size ?? 0) + documentFilesSnap.reduce((s, f) => s + f.size, 0);
      if (totalAttachBytes > 0) {
        const limitCheck = await checkStorageLimit(
          companyId!,
          company?.planId,
          { attachmentsBytes: totalAttachBytes, storageBytes: totalAttachBytes },
          company?.storageOption
        );
        if (!limitCheck.allowed) {
          sonnerToast.error("Storage limit reached", { description: limitCheck.message, duration: 4000 });
          setIsLoading(false);
          return;
        }
      }

      const resolvedGroupId =
        normalizePartyGroupIdForStorage(values.groupId?.trim());
      const partyRef = doc(collection(firestore, `companies/${companyId}/parties`));
      const newPartyId = partyRef.id;
      // Online: direct Storage → HTTPS URLs in Firestore (dusre device; `local:` + syncPendingFiles par depend nahi)
      const staged = await uploadEntityAvatarAndDocumentsRemote({
        companyId: companyId!,
        collectionSeg: "parties",
        entityId: newPartyId,
        avatarFile: avatarToUploadSnap?.file ?? null,
        documentFiles: documentFilesSnap,
      });

      const interCompanyAccountNo = await interCompanyAcNoForNewEntity("party");
      await setDoc(partyRef, {
        name: values.name,
        aliasName: (values.aliasName ?? "").trim(),
        address: values.address,
        phone: values.phone,
        whatsapp: values.whatsapp === true,
        email: values.email,
        pan: values.pan,
        openingBalance: values.openingBalance,
        openingBalanceDate: values.openingBalanceDate || null,
        openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
        ownerId: user.uid,
        companyId,
        groupId: resolvedGroupId || PARTY_DEFAULT_SYSTEM_GROUP_ID,
        balance: values.openingBalance,
        isDeleted: false,
        createdAt: serverTimestamp(),
        interCompanyAccountNo,
        fileUrl: staged.fileUrl,
        ...(staged.documentFileUrls.length ? { documentFileUrls: staged.documentFileUrls } : {}),
      });

      if (totalAttachBytes > 0) {
        await incrementCompanyStorage(companyId!, {
          attachmentsBytes: totalAttachBytes,
          storageBytes: totalAttachBytes,
        });
      }

      if (values.openingBalance && Math.abs(values.openingBalance) > 0.01) {
        await balanceOpeningBalanceWithCapital(companyId!, "parties", newPartyId, 0, values.openingBalance);
      }

      sonnerToast.success("Saved", { duration: PARTY_TOAST_OK_MS, description: values.name });

      if (saveAndNew) {
        form.reset({ accountType: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, name: "", aliasName: "", address: "", phone: "", email: "", pan: "", openingBalanceNarration: "", password: "", confirmPassword: "", openingBalance: 0, openingBalanceDate: undefined, groupId: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID });
        removeAvatar();
        setDocumentFiles([]);
      }

      onPartyCreated?.(saveAndNew, newPartyId);

    } catch (error) {
      console.error("Error creating party:", error);
      const staticMode = apkEntityWriteUsesLocalSqliteMirror(company);
      if (staticMode) {
        try {
          if (!companyId) throw new Error("Select a company before saving a party.");
          const totalCatch =
            (avatarToUploadSnap?.file.size ?? 0) + documentFilesSnap.reduce((s, f) => s + f.size, 0);
          if (totalCatch > 0) {
            const lim = await checkStorageLimit(
              companyId!,
              company?.planId,
              { attachmentsBytes: totalCatch, storageBytes: totalCatch },
              company?.storageOption
            );
            if (!lim.allowed) throw new Error(lim.message || "Storage limit reached.");
          }
          const resolvedGroupId = normalizePartyGroupIdForStorage(values.groupId?.trim());
          const localId = createLocalEntityId("party");
          const stagedCatch = await stageEntityAvatarAndDocuments({
            companyId: companyId!,
            collectionSeg: "parties",
            entityId: localId,
            avatarFile: avatarToUploadSnap?.file ?? null,
            documentFiles: documentFilesSnap,
          });
          const nowTs = Timestamp.now();
          const interCompanyAccountNo = await interCompanyAcNoForNewEntity("party");
          const payload: Record<string, unknown> = {
            id: localId,
            name: values.name,
            aliasName: (values.aliasName ?? "").trim(),
            address: values.address,
            phone: values.phone,
            whatsapp: values.whatsapp === true,
            email: values.email,
            pan: values.pan,
            openingBalance: values.openingBalance,
            openingBalanceDate: values.openingBalanceDate || null,
            openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
            ownerId: user?.uid || "local_guest_user",
            companyId,
            groupId: resolvedGroupId || PARTY_DEFAULT_SYSTEM_GROUP_ID,
            balance: values.openingBalance,
            isDeleted: false,
            createdAt: nowTs,
            interCompanyAccountNo,
            fileUrl: stagedCatch.fileUrl ?? null,
            ...(stagedCatch.documentFileUrls.length
              ? { documentFileUrls: stagedCatch.documentFileUrls }
              : {}),
          };
          // Local list ko turant update karo so party left panel me instantly dikhe.
          await upsertCompanyDocInBrowserDb(companyId!, "parties", localId, payload);
          // Reconnect par server sync ke liye outbox row.
          await enqueueCompanyDocOutbox(companyId!, "parties", "create", localId, payload);
          syncEntityAttachmentsAfterSave(companyId!);
          const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
          sonnerToast.success(showSyncHint ? "Saved — will sync" : "Saved", {
            duration: PARTY_TOAST_OK_MS,
            description: showSyncHint ? "Background" : values.name,
          });
          if (saveAndNew) {
            form.reset({ accountType: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID, name: "", aliasName: "", address: "", phone: "", email: "", pan: "", openingBalanceNarration: "", password: "", confirmPassword: "", openingBalance: 0, openingBalanceDate: undefined, groupId: PARTY_FORM_DEFAULT_ACCOUNT_TYPE_ID });
            removeAvatar();
            setDocumentFiles([]);
          }
          onPartyCreated?.(saveAndNew, localId);
        } catch (offlineErr) {
          sonnerToast.error("Couldn’t save", {
            description: offlineErr instanceof Error ? offlineErr.message : "Failed to save party offline.",
            duration: 5000,
          });
        }
      } else {
        sonnerToast.error("Couldn’t create party", { description: "Please try again.", duration: 5000 });
      }
    } finally {
      setIsLoading(false);
    }
  }

  // Dropdown: `companies/${companyId}/groups` listener (`groups`) must win over `processedGroups` alone —
  // useVouchers uses `authoritativeCompanyId` for reads; CreateGroupDialog writes under registry `companyId`, so mismatch par sirf Ungrouped na dikhe.

  return (
    <>
    <Form {...form}>
      <form
        onSubmit={(e) => handleFormSubmit(e)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="pl-master-form-scroll min-h-0 flex-1 space-y-6 overflow-y-auto py-1 pr-1">
        <FormField
          control={form.control}
          name="accountType"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Account Type</FormLabel>
              <FormControl>
                <RadioGroup
                  className="flex flex-col gap-2 sm:flex-row sm:gap-6"
                  value={field.value}
                  onValueChange={(next) => {
                    field.onChange(next);
                    const currentBranch = resolvePartyGroupBranchIdForGroup(
                      form.getValues("groupId"),
                      processedGroups
                    );
                    if (currentBranch !== next) {
                      form.setValue("groupId", next, { shouldDirty: true });
                    }
                  }}
                >
                  {PARTY_SYSTEM_GROUP_OPTIONS.map((branch) => (
                    <FormItem key={branch.id} className="flex items-center space-x-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value={branch.id} />
                      </FormControl>
                      <FormLabel className="cursor-pointer font-normal">{branch.name}</FormLabel>
                    </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <MasterFormNameAcNoRow
          entityKind="party"
          mode="create"
          nameField={
            <div className="space-y-2"><FormField
              control={form.control}
              name="name"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Party Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., John Doe" {...field} />
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
        
        {/* Group | PAN — ek row, barabar width */}
        <MasterFormTwoColGrid>
          <FormField
            control={form.control}
            name="groupId"
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>Group</FormLabel>
                <PartyGroupTreeCombobox
                  groups={groups}
                  processedGroups={processedGroups}
                  popoverModal={false}
                  value={field.value}
                  confirmWithOk
                  onAccountTypeChange={(branchId) => {
                    form.setValue("accountType", branchId as typeof PARTY_SYSTEM_DEBTORS_ID | typeof PARTY_SYSTEM_CREDITORS_ID, {
                      shouldDirty: true,
                    });
                  }}
                  onChange={(val, newName) => {
                    if (val === "add-new") {
                      setIsCreateGroupOpen(true);
                      setTimeout(() => {
                        document.dispatchEvent(new CustomEvent("prefill-create-group-name", { detail: newName }));
                      }, 100);
                    } else {
                      field.onChange(val === "none" ? "" : val);
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
            name="pan"
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>PAN/VAT No.</FormLabel>
                <FormControl>
                  <Input placeholder="Party's PAN/VAT" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </MasterFormTwoColGrid>

        <MasterFormTwoColGrid>
          <MasterMobileNoField control={form.control} />
          <FormField
            control={form.control}
            name="email"
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="Party email address" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </MasterFormTwoColGrid>

        <FormField
          control={form.control}
          name="address"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Textarea placeholder="Party's full address" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
         {/* Opening balance | As on date — ek row, barabar size */}
         <MasterFormTwoColGrid>
            <MasterOpeningBalanceAmountField control={form.control} />
            <FormField
                control={form.control}
                name="openingBalanceDate"
                render={({ field }: any) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>As on Date</FormLabel>
                      <div className={cn("grid", dateSystem === 'Both' && "grid-cols-1 sm:grid-cols-2 gap-2")}>
                          {(dateSystem === 'BS' || dateSystem === 'Both') && (
                              <BsDatePicker valueAD={field.value} onChangeAD={(d) => { field.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} />
                          )}
                          {(dateSystem === 'AD' || dateSystem === 'Both') && (
                              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen} modal={true}>
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

        <Separator />
        
        <FormItem>
          <FormLabel>Profile photo (Optional)</FormLabel>
          {!canAddAvatar ? (
            <p className="text-xs text-muted-foreground">
              Upgrade plan to add profile photo.{" "}
              <Link href="/billing" className="text-primary underline font-medium hover:no-underline">Click here to upgrade</Link>
            </p>
          ) : (
            <RestrictedFileUploader>
              <div className="flex items-center gap-4 flex-wrap">
                {avatarToUpload && (
                  <FilePreview
                    file={avatarToUpload.file}
                    attachmentCompanyId={companyId ?? undefined}
                    onRemove={removeAvatar}
                    isCompressing={isCompressing}
                    compressionResult={compressionResult}
                  
                          attachmentReusePlaceKey={null}
                        />
                )}
                {!avatarToUpload && (
                  <FormControl>
                    <AttachmentHoldPasteSurface
                      enabled={canAddAvatar}
                      onShortActivate={() => avatarInputRef.current?.click()}
                      onPastedFiles={(incoming) => {
                        const img = incoming[0];
                        if (!img?.type.startsWith("image/")) {
                          sonnerToast.error("Profile photo: images only");
                          return;
                        }
                        void handleAvatarChange(syntheticFileInputChangeEvent([img]));
                      }}
                      className="relative w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                    >
                      <Upload className="h-6 w-6" />
                      <span className="text-xs mt-1 text-center px-1">Add photo</span>
                      <Input
                        type="file"
                        className="hidden"
                        ref={avatarInputRef}
                        onChange={handleAvatarChange}
                        accept="image/*"
                      />
                    </AttachmentHoldPasteSurface>
                  </FormControl>
                )}
              </div>
            </RestrictedFileUploader>
          )}
          {/* List / detail par profile thumbnail */}
          <p className="text-[10px] text-muted-foreground mt-1">Images only — shown on profile / avatar.</p>
        </FormItem>

        <FormItem>
          <FormLabel>Documents (Optional)</FormLabel>
          <p className="text-xs text-muted-foreground mb-1 leading-snug">
            Optional supporting files for this party (PDF or images — e.g. registration, agreement scans). Up to 5 files; stored with the party and available from the statement.
          </p>
          <p className="text-[10px] text-muted-foreground mb-1">
            On the party statement they show on the opening balance row under the <span className="font-medium">File</span> column (green tick), like voucher attachments.
          </p>
          {!canAttachDocuments ? (
            <p className="text-xs text-muted-foreground">
              Upgrade plan to attach PDF/images.{" "}
              <Link href="/billing" className="text-primary underline font-medium hover:no-underline">Click here to upgrade</Link>
            </p>
          ) : (
            <RestrictedFileUploader>
              {/* Add box aur previews ek hi flex row — pehle alag `space-y` se box hamesha neeche chala jata tha */}
              <div className="space-y-2">
                <MasterPdfAsImageToggle id="create-party-pdf-as-image" />
                <div className="flex flex-wrap items-start gap-2">
                  {/* 96px = Tailwind w-24 h-24 — dashed “PDF / image” box ke barabar */}
                  {documentFiles.map((f, idx) => (
                    <FilePreview
                      key={`${f.name}-${idx}-${f.size}`}
                      file={f}
                      attachmentCompanyId={companyId ?? undefined}
                      onRemove={() => removeDocAt(idx)}
                      size={96}
                    />
                  ))}
                  {documentFiles.length < 5 && (
                    <FormControl>
                      <AttachmentHoldPasteSurface
                        enabled={canAttachDocuments}
                        onShortActivate={() => docsInputRef.current?.click()}
                        onPastedFiles={(incoming) => void handleDocumentsChange(syntheticFileInputChangeEvent(incoming))}
                        className="relative h-24 w-24 shrink-0 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                      >
                        <Upload className="h-6 w-6" />
                        <span className="text-xs mt-1 text-center px-1">PDF / image</span>
                        <Input
                          type="file"
                          className="hidden"
                          ref={docsInputRef}
                          onChange={handleDocumentsChange}
                          accept="image/*,application/pdf"
                          multiple
                        />
                      </AttachmentHoldPasteSurface>
                    </FormControl>
                  )}
                </div>
              </div>
            </RestrictedFileUploader>
          )}
        </FormItem>

        <FormField
          control={form.control}
          name="openingBalanceNarration"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Opening balance narration (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="e.g. OB brought forward from previous system…"
                  className="min-h-[72px] resize-y"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <p className="text-[10px] text-muted-foreground">
                Shown on the party statement as a line under the Opening Balance row (voucher-style narration).
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        </div>
        {/* EditPartyDialog jaisa ek hi row: Cancel (gray pill) • Save & New beechn • CreateParty daaen — pehle wrap + pink Cancel tha */}
        <div className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
          <Button
            type="button"
            variant="ghost"
            className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}
            onClick={() => onCloseDialogRequest?.()}
            disabled={isLoading || isCompressing}
          >
            Cancel
          </Button>
          <div className="flex min-w-0 flex-1 justify-center px-1">
            {onPartyCreated ? (
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
            ) : null}
          </div>
          <Button type="submit" className="shrink-0" disabled={isLoading || isCompressing || apkOfflineViewOnly || openingBalanceDateMissing}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Party
          </Button>
        </div>
      </form>
    </Form>
     <CreateGroupDialog
       onGroupCreated={handleGroupCreated}
       isOpen={isCreateGroupOpen}
       onOpenChange={setIsCreateGroupOpen}
       groups={groups}
       confirmLabel="Done"
       initialSystemBranch={accountType}
     />
    </>
  );
}
