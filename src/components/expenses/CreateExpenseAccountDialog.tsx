
"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, collection, serverTimestamp, query, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import {
  MasterFormNameAcNoRow,
  MasterFormTwoColGrid,
  MasterMobileNoField,
} from "@/components/inter-company/MasterFormLayout";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/plClientSession";
import type { ExpenseGroup } from "./types";
import { CreateExpenseGroupDialog } from "./CreateExpenseGroupDialog";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { EXPENSE_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { useDate } from "@/hooks/useDate";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { refineMasterOpeningBalanceDateRequired } from "@/lib/masterOpeningBalanceDateRequired";
import { useMasterOpeningBalanceDateRequired } from "@/hooks/useMasterOpeningBalanceDateRequired";
import { BTN_SAVE_NEW_CLASS } from "@/components/vouchers/voucherButtonStyles";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cnMasterEntityDialogContent,
  masterEntityDialogHeaderClassName,
  masterEntityDialogFormWrapperClassName,
} from "@/lib/masterEntityDialogClasses";
import { NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { format } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { toast as sonnerToast } from "sonner";
import {
  getDefaultSystemGroupId,
  normalizeExpenseGroupIdForStorage,
} from "@/lib/masterEntitySystemGroups";
import type { ExpenseGroupCreatedPayload } from "./CreateExpenseGroupDialog";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";
import {
  apkCloudEntityMasterReadFromSqliteMirror,
  apkCloudCompanyOfflineViewOnly,
  apkEntityWriteUsesLocalSqliteMirror,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox, isLikelyOfflineFirestoreError } from "@/lib/localVoucherOutbox";
import {
  stageEntityAvatarAndDocuments,
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
import usePermissions from "@/hooks/usePermissions";
import { useVouchers } from "@/hooks/useVouchers";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MAX_IMAGE_BYTES_BEFORE_COMPRESS, MAX_IMAGE_MB_BEFORE_COMPRESS } from "@/lib/fileUploadLimits";
import { expenseAccountPrefillPartsFromRow, fetchRemoteUrlAsFile } from "@/lib/crossCompanyMasterPrefill";
function defaultExpenseGroupId(defaultGroupType?: "income" | "expense"): string {
  return getDefaultSystemGroupId("expense", {
    accountType: defaultGroupType === "income" ? "Income" : "Expense",
  });
}

function resolveExpenseAccountType(
  groupId: string,
  allGroups: ExpenseGroup[],
  defaultGroupType: "income" | "expense" | undefined,
  incomeGroupIds: Set<string>
): "Income" | "Expense" {
  const selectedGroup = allGroups.find((g) => g.id === groupId);
  const fromGroup = (selectedGroup as { type?: string })?.type;
  if (fromGroup === "Income" || fromGroup === "Expense") return fromGroup;
  return defaultGroupType === "income" || incomeGroupIds.has(groupId) ? "Income" : "Expense";
}

function createLocalEntityId(prefix: string): string {
  // Local-first mode me account create ke liye stable client-side id use karo.
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}


const formSchema = z.object({
  name: z.string().min(2, { message: "Account name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  groupId: z.string().min(1, "A group is required."),
  openingBalance: z.coerce.number(),
  openingBalanceDate: z.date().optional(),
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

const MAX_FILE_SIZE_MB = 0.5;

export function CreateExpenseAccountDialog({
  onExpenseAccountCreated,
  children,
  isOpen,
  onOpenChange,
  defaultGroupType,
  contextNote,
}: {
  onExpenseAccountCreated: (id: string) => void;
  children?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When "income", default to first Income group (for Sale form Sales Account). */
  defaultGroupType?: "income" | "expense";
  contextNote?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const { canAddAvatar, canAddFileImagePdf } = usePermissions();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const [avatarToUpload, setAvatarToUpload] = useState<{ file: File; preview: string } | null>(null);
  const [documentFiles, setDocumentFiles] = useState<Array<File | string>>([]);
  const [groups, setGroups] = useState<ExpenseGroup[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const { dateSystem } = useDate();
  /** Merge with local `groups` — local-only me listener off; online me bhi registry id vs authoritative id par list poori rahe (CreatePartyForm jaisa). */
  const { processedExpenseGroups } = useVouchers();
  const isMobile = useIsMobile();

  const open = isOpen !== undefined ? isOpen : internalIsOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalIsOpen;

  /** Expense group combobox listener: pure-local **ya** APK cloud warm mirror. */
  const sqliteSkipFirestoreListener = useMemo(
    () =>
      apkEntityWriteUsesLocalSqliteMirror(company) || apkCloudEntityMasterReadFromSqliteMirror(company),
    [company]
  );

  const navigatorOnline = useNavigatorOnline();
  /** APK Firestore company offline: create expense voucher jaisa Save band (`apkCloudCompanyOfflineViewOnly`). */
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as Resolver<z.infer<typeof formSchema>>,
    defaultValues: { name: "", aliasName: "", openingBalance: 0, groupId: "", openingBalanceNarration: "" },
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);
  
  /** Local / APK cloud: vouchers context + SQLite `expense_groups` — redundant `onSnapshot` avoid. */
  useEffect(() => {
    if (!companyId || !open) return;
    let cancelled = false;

    if (sqliteSkipFirestoreListener) {
      setGroups((processedExpenseGroups as ExpenseGroup[]) || []);
      void (async () => {
        try {
          const rows = await listCompanyDocsFromBrowserDb(companyId, "expense_groups");
          if (cancelled) return;
          const mapped = rows
            .map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as ExpenseGroup))
            .filter((g) => !(g as any).isDeleted);
          if (mapped.length > 0) setGroups(mapped);
        } catch (e) {
          console.warn("[CreateExpenseAccountDialog] expense_groups mirror failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/expense_groups`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setGroups(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as ExpenseGroup))
          .filter((g) => !(g as any).isDeleted)
      );
    });
    return () => unsubscribe();
  }, [companyId, open, processedExpenseGroups, sqliteSkipFirestoreListener]);

  // Default group: when defaultGroupType=income (Sale form), use first Income group; else Ungrouped
  const incomeGroupIds = useMemo(() => {
    const isIncome = (g: any) => {
      const id = String(g?.id || "").toLowerCase();
      const parentId = String(g?.parentId || "").toLowerCase();
      const type = String(g?.type || "").toLowerCase();
      return parentId === "income" || type === "income" || id === "income" || id === "direct_income" || id === "indirect_income";
    };
    const groupMap = new Map(groups.map((g: any) => [g.id, g]));
    const hasIncomeAncestor = (g: any, visited = new Set<string>()): boolean => {
      if (!g || visited.has(g.id)) return false;
      visited.add(g.id);
      if (isIncome(g)) return true;
      if (g.parentId && groupMap.has(g.parentId)) return hasIncomeAncestor(groupMap.get(g.parentId), visited);
      return false;
    };
    return new Set(groups.filter((g: any) => hasIncomeAncestor(g)).map((g: any) => g.id));
  }, [groups]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!companyId || !user?.uid || !open) return;
      const current = form.getValues("groupId");
      if (current) return;
      if (defaultGroupType === "income" && incomeGroupIds.size > 0) {
        const firstIncomeId = Array.from(incomeGroupIds)[0];
        if (alive && firstIncomeId) form.setValue("groupId", firstIncomeId, { shouldDirty: false });
        return;
      }
      const defaultGroupId = getDefaultSystemGroupId("expense", {
        accountType: defaultGroupType === "income" ? "Income" : "Expense",
      });
      if (!alive) return;
      form.setValue("groupId", defaultGroupId, { shouldDirty: false });
    })();
    return () => {
      alive = false;
    };
  }, [companyId, user?.uid, open, form, defaultGroupType, incomeGroupIds]);

  useEffect(() => {
    const handlePrefill = (event: CustomEvent) => {
      form.setValue('name', event.detail || '');
    };
    // @ts-ignore
    document.addEventListener('prefill-create-expense-account-name', handlePrefill);
    return () => {
      // @ts-ignore
      document.removeEventListener('prefill-create-expense-account-name', handlePrefill);
    };
  }, [form]);

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

  /** Copy draft: source expense row + remote files — target company me recreate. */
  useEffect(() => {
    const h = async (e: CustomEvent<{ rowPayload?: Record<string, unknown> }>) => {
      const row = e.detail?.rowPayload;
      if (!row || typeof row !== "object") return;
      clearUploads();
      const { defaults, remoteAvatarUrl, remoteDocumentUrls } = expenseAccountPrefillPartsFromRow(row);
      form.reset({
        name: defaults.name,
        openingBalance: defaults.openingBalance,
        openingBalanceDate: defaults.openingBalanceDate,
        openingBalanceNarration: defaults.openingBalanceNarration,
        groupId: defaultExpenseGroupId(defaultGroupType),
      });
      if (remoteAvatarUrl?.trim() && canAddAvatar) {
        try {
          const raw = await fetchRemoteUrlAsFile(remoteAvatarUrl, "expense-avatar.jpg");
          if (raw) {
            const { file: compressed, maxBytes, maxKb } = await compressImageForCompany(raw, companyId);
            if (compressed.size <= maxBytes) {
              setAvatarToUpload({
                file: compressed,
                preview: URL.createObjectURL(compressed),
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (remoteDocumentUrls?.length && canAttachDocuments) {
        const next: File[] = [];
        for (let i = 0; i < Math.min(remoteDocumentUrls.length, 5); i++) {
          const u = remoteDocumentUrls[i];
          const nameGuess = u.toLowerCase().includes(".pdf") ? `exp-doc-${i + 1}.pdf` : `exp-doc-${i + 1}.jpg`;
          const f = await fetchRemoteUrlAsFile(u, nameGuess);
          if (f && isProfileDocumentFile(f)) next.push(f);
        }
        if (next.length) setDocumentFiles(next);
      }
    };
    document.addEventListener("prefill-create-expense-account-full", h as EventListener);
    return () => document.removeEventListener("prefill-create-expense-account-full", h as EventListener);
  }, [form, canAddAvatar, canAttachDocuments]);

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
        setOpen(false);
      } else {
        setIsLoading(true);
      }
      void processAndSave(form.getValues(), options.saveAndNew || false);
    })();
  }

  async function processAndSave(values: z.infer<typeof formSchema>, saveAndNew: boolean = false) {
    if (!user || !companyId) {
      toast({ variant: "destructive", title: "Error", description: "You must be logged in and have a company selected." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsLoading(false);
      return;
    }

    const toastId = sonnerToast.loading("Creating expense account...");
    setIsLoading(true);
    try {
      // Local-first: CreatePartyForm jaisa — pehle browser DB + outbox; Firestore getDocs (duplicate) / Capital OB mat chalao.
      if (apkEntityWriteUsesLocalSqliteMirror(company)) {
        const accountType = resolveExpenseAccountType(
          values.groupId?.trim() || defaultExpenseGroupId(defaultGroupType),
          groups,
          defaultGroupType,
          incomeGroupIds
        );
        const resolvedGroupId = normalizeExpenseGroupIdForStorage(values.groupId, accountType);
        const createdId = createLocalEntityId("expense_account");
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
        const stagedLocal = await stageEntityAvatarAndDocuments({
          companyId,
          collectionSeg: "expense_accounts",
          entityId: createdId,
          avatarFile: avatarToUpload?.file ?? null,
          documentFiles: documentFiles.filter((f): f is File => f instanceof File),
        });
        const interCompanyAccountNo = await interCompanyAcNoForNewEntity("expense");
        const payload = {
          id: createdId,
          name: values.name.trim(),
          aliasName: (values.aliasName ?? "").trim(),
          phone: values.phone?.trim() || null,
          whatsapp: values.whatsapp === true,
          groupId: resolvedGroupId,
          openingBalance: values.openingBalance || 0,
          openingBalanceDate: values.openingBalanceDate || null,
          openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
          type: accountType,
          companyId,
          createdAt: new Date().toISOString(),
          isDeleted: false,
          interCompanyAccountNo,
          fileUrl: stagedLocal.fileUrl ?? null,
          ...(stagedLocal.documentFileUrls.length ? { documentFileUrls: stagedLocal.documentFileUrls } : {}),
        };
        await upsertCompanyDocInBrowserDb(companyId, "expense_accounts", createdId, payload);
        await enqueueCompanyDocOutbox(companyId, "expense_accounts", "create", createdId, payload);
        sonnerToast.success("Expense Account Created!", {
          id: toastId,
          description: `"${values.name}" has been added (saved locally).`,
        });
        onExpenseAccountCreated(createdId);
        if (saveAndNew) {
          form.reset({
            name: "", aliasName: "",
            openingBalance: 0,
            groupId: defaultExpenseGroupId(defaultGroupType),
            openingBalanceDate: undefined,
            openingBalanceNarration: "",
          });
          clearUploads();
        }
        return;
      }

      // Online: recycle-bin duplicate check (Firestore) — offline/local pe upar wala branch
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId,
        collectionName: "expense_accounts",
        name: values.name.trim(),
        entityLabel: sidebarEntityMenuLabel("incomes"),
      });
      if (duplicateDecision.decision === "active_exists") {
        sonnerToast.error("Duplicate Account Name", {
          id: toastId,
          description: "An account with this name already exists.",
        });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        sonnerToast.success("Expense Account Restored!", {
          id: toastId,
          description: `"${values.name.trim()}" was restored from Recycle Bin.`,
        });
        onExpenseAccountCreated(duplicateDecision.restoredId);
        setIsLoading(false);
        return;
      }

      const accountType = resolveExpenseAccountType(
        values.groupId?.trim() || defaultExpenseGroupId(defaultGroupType),
        groups,
        defaultGroupType,
        incomeGroupIds
      );
      const resolvedGroupId = normalizeExpenseGroupIdForStorage(values.groupId, accountType);

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

      const accRef = doc(collection(firestore, `companies/${companyId}/expense_accounts`));
      const createdId = accRef.id;
      const staged = await uploadEntityAvatarAndDocumentsRemote({
        companyId: companyId!,
        collectionSeg: "expense_accounts",
        entityId: createdId,
        avatarFile: avatarToUpload?.file ?? null,
        documentFiles: documentFiles.filter((f): f is File => f instanceof File),
      });

      const interCompanyAccountNo = await interCompanyAcNoForNewEntity("expense");
      await setDoc(accRef, {
        name: values.name.trim(),
        aliasName: (values.aliasName ?? "").trim(),
        phone: values.phone?.trim() || null,
        whatsapp: values.whatsapp === true,
        groupId: resolvedGroupId,
        openingBalance: values.openingBalance || 0,
        openingBalanceDate: values.openingBalanceDate || null,
        openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
        type: accountType,
        companyId,
        createdAt: serverTimestamp(),
        isDeleted: false,
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

      if (values.openingBalance && Math.abs(values.openingBalance) > 0.01) {
        const { balanceOpeningBalanceWithCapital } = await import("@/lib/voucherActionsClient");
        await balanceOpeningBalanceWithCapital(
          companyId,
          "expense_accounts",
          createdId,
          0,
          values.openingBalance
        );
      }

      sonnerToast.success("Expense Account Created!", {
        id: toastId,
        description: `"${values.name}" has been added.`,
      });
      onExpenseAccountCreated(createdId);
      if (saveAndNew) {
        form.reset({
          name: "", aliasName: "",
          openingBalance: 0,
          groupId: defaultExpenseGroupId(defaultGroupType),
          openingBalanceDate: undefined,
          openingBalanceNarration: "",
        });
        clearUploads();
      }
    } catch (error) {
      console.error("Error creating expense account:", error);
      if (isLikelyOfflineFirestoreError(error) && companyId && user && apkEntityWriteUsesLocalSqliteMirror(company)) {
        try {
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
          const v = form.getValues();
          const accountType = resolveExpenseAccountType(
            v.groupId?.trim() || defaultExpenseGroupId(defaultGroupType),
            groups,
            defaultGroupType,
            incomeGroupIds
          );
          const resolvedGroupId = normalizeExpenseGroupIdForStorage(v.groupId, accountType);
          const localId = createLocalEntityId("expense_account");
          const interCompanyAccountNo = await interCompanyAcNoForNewEntity("expense");
          const stagedCatch = await stageEntityAvatarAndDocuments({
            companyId,
            collectionSeg: "expense_accounts",
            entityId: localId,
            avatarFile: avatarToUpload?.file ?? null,
            documentFiles: documentFiles.filter((f): f is File => f instanceof File),
          });
          const payload: Record<string, unknown> = {
            id: localId,
            name: v.name.trim(),
            phone: v.phone?.trim() || null,
            whatsapp: v.whatsapp === true,
            groupId: resolvedGroupId,
            openingBalance: v.openingBalance || 0,
            openingBalanceDate: v.openingBalanceDate || null,
            openingBalanceNarration: v.openingBalanceNarration?.trim() || null,
            type: accountType,
            companyId,
            createdAt: Timestamp.now(),
            isDeleted: false,
            interCompanyAccountNo,
            fileUrl: stagedCatch.fileUrl ?? null,
            ...(stagedCatch.documentFileUrls.length ? { documentFileUrls: stagedCatch.documentFileUrls } : {}),
          };
          await upsertCompanyDocInBrowserDb(companyId, "expense_accounts", localId, payload as any);
          await enqueueCompanyDocOutbox(companyId, "expense_accounts", "create", localId, payload as any);
          sonnerToast.success("Saved. Will sync when online.", {
            id: toastId,
            description: `"${v.name}" was saved locally (offline).`,
          });
          onExpenseAccountCreated(localId);
        } catch {
          sonnerToast.error("Error", {
            id: toastId,
            description: "Failed to create expense account.",
          });
        }
      } else {
        const hint =
          error instanceof Error && error.message
            ? error.message
            : "Failed to create expense account.";
        sonnerToast.error("Error", {
          id: toastId,
          description: hint,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }
  
  useEffect(() => {
    const current = form.getValues("groupId");
    if (!current) {
      form.setValue("groupId", defaultExpenseGroupId(defaultGroupType), { shouldDirty: false });
    }
  }, [groups, processedExpenseGroups, form, defaultGroupType]);

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen} modal={true}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent 
        overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
        className={cn(cnMasterEntityDialogContent(isMobile), "sm:max-w-2xl")}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (isCreateGroupOpen) { e.preventDefault(); return; }
          const target = e.target as HTMLElement;
          if (
            target.closest('[data-radix-popper-content-wrapper]') ||
            target.closest('[cmdk-root]')
          ) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
           if (isCreateGroupOpen) { e.preventDefault(); return; }
           const target = e.target as HTMLElement;
           if (target.closest('[data-radix-dialog-content]')) {
              e.preventDefault();
           }
        }}
      >
        <DialogHeader className={masterEntityDialogHeaderClassName}>
          <DialogTitle>{defaultGroupType === "income" ? "Create Income Account" : "Create Expense Account"}</DialogTitle>
          <DialogDescription>
            {defaultGroupType === "income"
              ? "Add a new income/sales account, like \"Sales\" or \"Service Income\"."
              : "Add a new category for your expenses, like \"Office Rent\" or \"Utilities\"."}
          </DialogDescription>
          {contextNote ? (
            // Copy-to flow: selected target company context user ko dialog me hi visible rakho.
            <p className="text-xs font-semibold text-emerald-700">{contextNote}</p>
          ) : null}
        </DialogHeader>
        <div className={masterEntityDialogFormWrapperClassName}>
        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 sm:pr-2">
            <MasterFormNameAcNoRow
              entityKind="expense"
              mode="create"
              nameField={
                <div className="space-y-2"><FormField
                  control={form.control}
                  name="name"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Salary Expense" {...field} />
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
                          document.dispatchEvent(new CustomEvent('prefill-create-expense-group-name', { detail: newName }));
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
                    <FormItem>
                    <FormLabel>As on Date</FormLabel>
                      <div className={cn("grid", dateSystem === 'Both' && "grid-cols-2 gap-2")}>
                          {(dateSystem === 'BS' || dateSystem === 'Both') && (
                              <BsDatePicker valueAD={field.value} onChangeAD={(d) => { field.onChange(d as Date); setIsCalendarOpen(false); }} isRange={false} />
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
            <EntityProfilePhotoBlock
              file={avatarToUpload?.file ?? null}
              onPickClick={() => avatarInputRef.current?.click()}
              fileInputRef={avatarInputRef}
              onAvatarChange={handleAvatarChange}
              onRemoveAvatar={removeAvatar}
              canAddAvatar={canAddAvatar}
              inputId="create-expense-avatar"
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
              entityStatementLabel="income/expense account"
              inputId="create-expense-docs"
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
              <Button type="submit" disabled={isLoading || isCompressing || apkOfflineViewOnly || openingBalanceDateMissing} className="shrink-0">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>
    <CreateExpenseGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups}/>
    </>
  );
}
