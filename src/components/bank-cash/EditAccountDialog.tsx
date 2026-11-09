
"use client";

import { DialogPlainOpener } from "@/components/ui/dialog-plain-opener";
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, CalendarIcon, Upload } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLiveEntityDocAttachments } from "@/hooks/useLiveEntityDocAttachments";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, serverTimestamp, Timestamp, collection, query } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
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

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { MasterDeleteConfirmAlertDialog } from "@/components/common/MasterDeleteConfirmAlertDialog";
import { permanentDeleteCompanySubdocFromRecycleBin } from "@/lib/recycleBinEntityLifecycle";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/plClientSession";
import Link from "next/link";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { apkCloudCompanyOfflineViewOnly, apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
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
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import { MasterMobileNoField } from "@/components/inter-company/MasterFormLayout";
import {
  BankCashFormThreeColGrid,
  BankCashFormTwoColGrid,
} from "@/components/bank-cash/bankCashFormLayout";
import { MasterFormInterCompanyAcNoSlot } from "@/components/inter-company/MasterFormInterCompanyAcNoSlot";
import { BankCashAccountTypeSpecialRow } from "@/components/bank-cash/BankCashAccountTypeSpecialRow";
import {
  masterSpecialAccountPanelClassName,
  masterSpecialAccountPanelTitleClassName,
} from "@/lib/masterFormPillChrome";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { CreateAccountGroupDialog } from "./CreateAccountGroupDialog";
import usePermissions from "@/hooks/usePermissions";
import { attachmentLockFieldsForFinalUrls, readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { BANK_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useDate } from "@/hooks/useDate";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRouter } from "next/navigation";
import { IS_STATIC_APK } from "@/lib/staticMobileFullscreenDialog";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { format } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { useAuth } from "@/hooks/useAuth";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox, flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { persistSpecialAccountUsagePermissionConfig } from "@/lib/persistSpecialAccountUsagePermissionConfig";
import {
  finalizeMasterOpeningBalanceSideEffects,
  masterOpeningPatchFromPersisted,
} from "@/lib/fyPagination/masterOpeningSaveHooks";
import { FilePreview } from "../vouchers/FilePreview";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MAX_IMAGE_BYTES_BEFORE_COMPRESS, MAX_IMAGE_MB_BEFORE_COMPRESS } from "@/lib/fileUploadLimits";
import { toast as sonnerToast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { SpecialAccountAccessControl } from "./SpecialAccountAccessControl";
import {
  listSpecialAccountAccessUsers,
  normalizeSpecialAccountUseFor,
  readSpecialAccountUsageDefaults,
} from "@/lib/specialAccountUsage";
import { useSpecialAccountUseForSync } from "@/hooks/useSpecialAccountUseForSync";
import {
  BANK_SYSTEM_BANK_BRANCH_ID,
  BANK_SYSTEM_CASH_BRANCH_ID,
  normalizeBankGroupIdForStorage,
} from "@/lib/masterEntitySystemGroups";
import { resolveMasterGroupTreeBranchIdForGroup } from "@/lib/masterGroupTreeCombobox";
import {
  EntityOpeningBalanceNarrationField,
  MasterPdfAsImageToggle,
} from "@/components/common/EntityProfileDocumentsNarrationFields";
import { cnMasterEntityDialogContent, masterEntityDialogHeaderClassName } from "@/lib/masterEntityDialogClasses";
import { beginApkLedgerAsyncWriteShield } from "@/lib/apkLedgerRouteShield";
import { armDashboardRedirectGuard } from "@/lib/protectFromUnwantedDashboardRedirect";
import { persistLedgerModalParentFromBrowser } from "@/lib/modalUrlSync";
import { BankAccountToggleFlagsRow } from "@/components/bank-cash/BankAccountToggleFlagsRow";

/** Legacy empty/ungrouped ids → system branch for combobox display. */
function normalizeBankAccountEditGroupId(
  groupId: string | null | undefined,
  accountType?: string | null
): string {
  return normalizeBankGroupIdForStorage(groupId, accountType);
}

const MAX_FILE_SIZE_MB = 0.5;

const formSchema = z.object({
  accountName: z.string().min(2, { message: "Account name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  accountType: z.enum(["Bank", "Cash"]),
  openingBalance: z.coerce.number(),
  openingBalanceDate: z.any().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  groupId: z.string().optional(),
  openingBalanceNarration: z.string().optional(),
  isSpecial: z.boolean(),
  allowVoucherMinusBalance: z.boolean(),
  isClearing: z.boolean(),
  useFor: z.object({
    in: z.array(z.string()),
    out: z.array(z.string()),
    balance: z.array(z.string()),
  }).optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

type FormValues = z.infer<typeof formSchema>;

export function EditAccountDialog({ account, allAccounts, onAccountUpdated, onAccountDeleted, children, hasTransactions, isOpen: controlledIsOpen, onOpenChange, presentationMode = "default" }: {
  account: Account;
  allAccounts?: Account[];
  onAccountUpdated: (updatedAccount: Partial<Account>) => void;
  onAccountDeleted: (deletedId: string) => void;
  children: React.ReactNode;
  hasTransactions: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  presentationMode?: MasterEditPresentationMode;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { syncUsageToCompanyPermissions } = useSpecialAccountUseForSync(companyId, company);
  const navigatorOnline = useNavigatorOnline();
  const localSqlMirror = useMemo(() => apkEntityWriteUsesLocalSqliteMirror(company), [company]);
  /** APK Firebase company: dropdown lists SQLite warm-mirror (`apkCloudEntityMasterReadFromSqliteMirror`). */
  const sqliteListsOnlyNoSnapshot = useMemo(
    () => localSqlMirror || apkCloudEntityMasterReadFromSqliteMirror(company),
    [localSqlMirror, company]
  );
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );
  const { processedAccountGroups } = useVouchers();
  const processedAccountGroupsRef = useRef(processedAccountGroups);
  processedAccountGroupsRef.current = processedAccountGroups;
  const { dateSystem } = useDate();
  const router = useRouter();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = useCallback((open: boolean) => {
    if (controlledIsOpen === undefined) {
      setInternalIsOpen(open);
    }
    onOpenChange?.(open);
  }, [controlledIsOpen, onOpenChange]);

  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  /** Profile — image / saved URL / local: */
  const [file, setFile] = useState<File | string | null>(account.fileUrl || null);
  const [docSlots, setDocSlots] = useState<Array<File | string>>(() => account.documentFileUrls || []);
  const initialFileRef = useRef<string | null>(account.fileUrl || null);
  const initialDocUrlsRef = useRef<string[]>(account.documentFileUrls || []);
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
    collection: "bank_accounts",
    entityId: account.id,
    attachmentsDirty,
    preferSqliteMirror: sqliteListsOnlyNoSnapshot,
    onFields: onLiveAttachmentFields,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const { can, canAddAvatar, canAddFileImagePdf } = usePermissions();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const isMobile = useIsMobile();
  const staticMobileFullscreen = IS_STATIC_APK && isMobile;
  /** Desktop bank detail (`/bank-cash/[id]`): persist+guard — mobile variant `openModalInUrl` already persiste karta hai */
  useEffect(() => {
    if (!isOpen || !isStaticAppBuild()) return;
    persistLedgerModalParentFromBrowser();
  }, [isOpen]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
        accountName: account.accountName,
        aliasName: ((account as unknown as { aliasName?: string }).aliasName) || "",
        phone: account.phone ?? "",
        whatsapp: account.whatsapp === true,
        accountType: account.accountType,
        openingBalance: account.openingBalance,
        openingBalanceDate: (account as any).openingBalanceDate?.toDate ? (account as any).openingBalanceDate.toDate() : undefined,
        bankName: account.bankName || "",
        accountNumber: account.accountNumber || "",
        ifscCode: account.ifscCode || "",
        groupId: normalizeBankAccountEditGroupId(account.groupId, account.accountType),
        isSpecial: account.isSpecial || false,
        allowVoucherMinusBalance: account.allowVoucherMinusBalance === true,
        isClearing: account.isClearing === true,
        useFor: account.useFor
          ? normalizeSpecialAccountUseFor(account.useFor)
          : readSpecialAccountUsageDefaults(company?.permissionConfig),
        openingBalanceNarration: account.openingBalanceNarration ?? "",
    },
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);
  
  const accountType = form.watch("accountType");
  const isSpecial = form.watch("isSpecial");
  const companyLiveRef = useRef(company);
  companyLiveRef.current = company;

  const usersForAccessControl = useMemo(() => listSpecialAccountAccessUsers(company), [company]);

  const handleGroupCreated = (newGroupId: string) => {
    form.setValue('groupId', newGroupId);
    setTimeout(() => setIsCreateGroupOpen(false), 50);
  };

  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    /** Combobox fallback jab SQLite abhi khali ho (cold open). */
    const seedFallback = () => {
      const fb = (processedAccountGroupsRef.current || []) as AccountGroup[];
      if (fb.length) setGroups(fb);
    };

    const loadGroupsFromMirror = async (): Promise<AccountGroup[]> => {
      try {
        const rows = await listCompanyDocsFromBrowserDb(companyId, "account_groups");
        return rows.map((r: any) => ({ ...r, id: r.id } as AccountGroup));
      } catch {
        return [];
      }
    };

    if (sqliteListsOnlyNoSnapshot) {
      seedFallback();
      void (async () => {
        const fromDb = await loadGroupsFromMirror();
        if (cancelled) return;
        if (fromDb.length) setGroups(fromDb);
      })();
      return () => {
        cancelled = true;
      };
    }

    seedFallback();

    const q = query(collection(firestore, `companies/${companyId}/account_groups`));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const fetchedGroups = querySnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as AccountGroup)
        );
        setGroups(fetchedGroups);
      },
      (error) => {
        console.error("Error fetching groups:", error);
        const fb = (processedAccountGroupsRef.current || []) as AccountGroup[];
        if (fb.length > 0) setGroups(fb);
      }
    );
    return () => unsubscribe();
  }, [isOpen, companyId, processedAccountGroups, sqliteListsOnlyNoSnapshot]);

  const accountResetKey = useMemo(
    () =>
      [
        account.id,
        account.accountName,
        account.isSpecial === true ? "1" : "0",
        JSON.stringify(account.useFor ?? null),
        String(account.openingBalance ?? ""),
      ].join("|"),
    [account]
  );

  useEffect(() => {
    if (!isOpen) return;
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

    const liveCompany = companyLiveRef.current;
    form.reset({
      accountName: account.accountName,
      aliasName: ((account as unknown as { aliasName?: string }).aliasName) || "",
      phone: account.phone ?? "",
      whatsapp: account.whatsapp === true,
      accountType: account.accountType,
      openingBalance: account.openingBalance,
      openingBalanceDate: finalDate,
      bankName: account.bankName || "",
      accountNumber: account.accountNumber || "",
      ifscCode: account.ifscCode || "",
      groupId: normalizeBankAccountEditGroupId(account.groupId, account.accountType),
      isSpecial: account.isSpecial || false,
      allowVoucherMinusBalance: account.allowVoucherMinusBalance === true,
      isClearing: account.isClearing === true,
      useFor: account.useFor
        ? normalizeSpecialAccountUseFor(account.useFor)
        : readSpecialAccountUsageDefaults(liveCompany?.permissionConfig),
      openingBalanceNarration: account.openingBalanceNarration ?? "",
    });
    setFile(account.fileUrl || null);
    setDocSlots(account.documentFileUrls || []);
    initialFileRef.current = account.fileUrl || null;
    initialDocUrlsRef.current = account.documentFileUrls || [];
    // Company permissionConfig sync (usage table) must not re-reset this form — wipes unsaved isSpecial / ticks.
  }, [isOpen, accountResetKey, form]);

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
    const accountRefSnap = account;
    const attachmentBaselineSnap = captureEntityFormAttachmentBaseline({
      fileUrl: initialFileRef.current,
      documentFileUrls: initialDocUrlsRef.current,
    });

    setIsOpen(false); // Bank/cash edit band turant; static/APK shield + writes async

    void (async () => {
      // Static ledger: wide desktop guard (voucher jaisa) + company pin — save async ke baad `/dashboard`/picker jump
      if (isStaticAppBuild()) {
        armDashboardRedirectGuard(router, { isMobile: isMobile || isStaticAppBuild() });
      }
      beginApkLedgerAsyncWriteShield({ pinCompanyId: companyId });
      const toastId = sonnerToast.loading("Updating account...");
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
            collectionSeg: "bank_accounts",
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

        /** Firestore `undefined` field skip / local mirror — explicit payload (EditExpenseAccountDialog jaisa) */
        const updatePayload: Record<string, unknown> = {
          accountName: values.accountName,
          aliasName: (values.aliasName ?? "").trim(),
          phone: values.phone?.trim() || null,
          whatsapp: values.whatsapp === true,
          accountType: values.accountType,
          bankName: values.bankName ?? "",
          accountNumber: values.accountNumber ?? "",
          ifscCode: values.ifscCode ?? "",
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate ?? null,
          openingBalanceNarration: narrationClean,
          groupId: normalizeBankGroupIdForStorage(values.groupId, values.accountType),
          isSpecial: values.isSpecial,
          allowVoucherMinusBalance: values.allowVoucherMinusBalance === true,
          isClearing: values.isClearing === true,
          useFor: normalizeSpecialAccountUseFor(values.useFor),
          fileUrl,
          documentFileUrls: documentFileUrls.length ? documentFileUrls : [],
          ...attachmentLockFieldsForFinalUrls(documentFileUrls, {
            existingLockedPdfFileUrls: readLockedPdfFileUrlsFromRow(
              account as unknown as Record<string, unknown>
            ),
            canUnlockLockedPdf: can("unlock_locked_pdf"),
          }),
          updatedAt: serverTimestamp(),
        };

        // Static / APK local lane: IndexedDB + outbox — hybrid Firestore company par `updateDoc` neeche
        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "bank_accounts", accountRefSnap.id);
          const base: Record<string, unknown> = fromDb ?? {
            id: accountRefSnap.id,
            companyId,
            balance: accountRefSnap.balance,
            debit: accountRefSnap.debit,
            credit: accountRefSnap.credit,
            isDeleted: false,
            ownerId: accountRefSnap.ownerId,
          };
          const payload: Record<string, unknown> = {
            ...base,
            ...updatePayload,
            id: accountRefSnap.id,
            companyId,
            updatedAt: Timestamp.now(),
          };
          await upsertCompanyDocInBrowserDb(companyId, "bank_accounts", accountRefSnap.id, payload);
          const persisted =
            (await getCompanyDocFromBrowserDb(companyId, "bank_accounts", accountRefSnap.id)) ?? payload;
          await enqueueCompanyDocOutbox(companyId, "bank_accounts", "update", accountRefSnap.id, persisted);

          const showSyncHint =
            backupSyncEnabled && !isLocalGuestUser && typeof navigator !== "undefined" && !navigator.onLine;
          onAccountUpdated({
            id: accountRefSnap.id,
            ...values,
            isSpecial: values.isSpecial === true,
            ...masterOpeningPatchFromPersisted(persisted),
            fileUrl: fileUrl || "",
            documentFileUrls,
            useFor: normalizeSpecialAccountUseFor(values.useFor),
          });
          initialFileRef.current = fileUrl || null;
          initialDocUrlsRef.current = documentFileUrls.filter((u): u is string => typeof u === "string");
          finalizeFormAttachmentEditAfterSave({
            companyId,
            baselineUrls: attachmentBaselineSnap,
            finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
            oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
          });
          sonnerToast.success(showSyncHint ? "Updated. Will sync when online." : "Account Updated!", {
            id: toastId,
            description: showSyncHint
              ? `"${values.accountName}" saved locally.`
              : `"${values.accountName}" has been successfully updated.`,
          });

          void (async () => {
            try {
              await persistSpecialAccountUsagePermissionConfig(
                companyId,
                company,
                normalizeSpecialAccountUseFor(values.useFor)
              );
              if (typeof navigator !== "undefined" && navigator.onLine) {
                await flushVoucherOutbox({
                  priority: {
                    companyId,
                    collectionName: "bank_accounts",
                    docId: accountRefSnap.id,
                  },
                });
              }
              await syncEntityAttachmentsAfterSave(companyId);
              await finalizeMasterOpeningBalanceSideEffects({
                company,
                companyId,
                collection: "bank_accounts",
                entityId: accountRefSnap.id,
                oldOpeningBalance,
                newOpeningBalance,
                oldOpeningBalanceDate: (accountRefSnap as any).openingBalanceDate,
                newOpeningBalanceDate: values.openingBalanceDate,
              });
            } catch (tailErr) {
              console.warn("[EditAccountDialog] background save tail failed", tailErr);
            }
          })();
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
          collection: "bank_accounts",
          docId: accountRefSnap.id,
          patch: updatePayload,
        });

        onAccountUpdated({
          id: accountRefSnap.id,
          ...values,
          isSpecial: values.isSpecial === true,
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate,
          openingBalanceNarration: narrationClean ?? "",
          fileUrl: fileUrl || "",
          documentFileUrls,
          useFor: normalizeSpecialAccountUseFor(values.useFor),
        });
        initialFileRef.current = fileUrl || null;
        initialDocUrlsRef.current = documentFileUrls.filter((u): u is string => typeof u === "string");
        finalizeFormAttachmentEditAfterSave({
          companyId,
          baselineUrls: attachmentBaselineSnap,
          finalUrls: captureEntityFormAttachmentBaseline({ fileUrl, documentFileUrls }),
          oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
        });
        sonnerToast.success("Account Updated!", {
          id: toastId,
          description: `"${values.accountName}" has been successfully updated.`,
        });

        void (async () => {
          try {
            await syncEntityAttachmentsAfterSave(companyId);
            await persistSpecialAccountUsagePermissionConfig(
              companyId,
              company,
              normalizeSpecialAccountUseFor(values.useFor)
            );
            await finalizeMasterOpeningBalanceSideEffects({
              company,
              companyId,
              collection: "bank_accounts",
              entityId: accountRefSnap.id,
              oldOpeningBalance,
              newOpeningBalance,
              oldOpeningBalanceDate: (accountRefSnap as any).openingBalanceDate,
              newOpeningBalanceDate: values.openingBalanceDate,
            });
          } catch (tailErr) {
            console.warn("[EditAccountDialog] background save tail failed", tailErr);
          }
        })();
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
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This account has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    
    setIsLoading(true);
    try {
        if (isStaticAppBuild()) {
          armDashboardRedirectGuard(router, { isMobile: isMobile || isStaticAppBuild() });
          beginApkLedgerAsyncWriteShield({ pinCompanyId: companyId });
        }
        {
          // Never-synced local doc => permanent local delete (no Firestore / recycle bin).
          const { tryHardDeleteNeverSyncedDoc } = await import("@/lib/localOnlyHardDelete");
          const hd = await tryHardDeleteNeverSyncedDoc(companyId, "bank_accounts", account.id);
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
        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "bank_accounts", account.id);
          const base: Record<string, unknown> = fromDb ?? {
            id: account.id,
            companyId,
            balance: account.balance,
            debit: account.debit,
            credit: account.credit,
            isDeleted: false,
            ownerId: (account as { ownerId?: string }).ownerId,
            accountName: account.accountName,
            aliasName: ((account as unknown as { aliasName?: string }).aliasName) || "",
          };
          const payload: Record<string, unknown> = {
            ...base,
            id: account.id,
            companyId,
            isDeleted: true,
            deletedAt: new Date(),
          };
          await upsertCompanyDocInBrowserDb(companyId, "bank_accounts", account.id, payload);
          await enqueueCompanyDocOutbox(companyId, "bank_accounts", "update", account.id, payload);
        } else {
          await updateDoc(doc(firestore, `companies/${companyId}/bank_accounts`, account.id), {
            isDeleted: true,
            deletedAt: serverTimestamp()
          });
        }
        toast({ title: "Account Moved to Bin", description: `"${account.accountName}" has been moved to the recycle bin.`});
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
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    if (hasTransactions) {
      sonnerToast.error("Cannot Delete", { description: "This account has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(companyId, "bank_accounts", account.id);
      toast({
        title: "Account deleted permanently",
        description: `"${account.accountName}" was permanently deleted.`,
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
  
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    if (!canAddAvatar) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow changing profile photo." });
      return;
    }
    const inputFile = e.target.files[0];
    if (!isProfileAvatarImageFile(inputFile)) {
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
      toast({
        variant: "destructive",
        title: "File Error",
        description: "Could not process the file.",
      });
    }
    e.target.value = "";
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

  const removeAvatar = () => {
    setFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const removeDocAt = (idx: number) => {
    setDocSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  // Create dialog ke saath: synthetic Ungrouped row; `ungrouped_account` doc list se isAutoUngrouped filter se nahi aata

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
              staticMobileFullscreen && "min-h-0 h-[100dvh] max-h-[100dvh]",
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
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Update the details for {account.accountName}.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.stopPropagation();
                void form.handleSubmit(onSubmit)(e);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-2">
                <BankCashAccountTypeSpecialRow
                  control={form.control}
                  form={form}
                  processedAccountGroups={processedAccountGroups as AccountGroup[]}
                  showSpecialSwitch={can("manage_special_bank_accounts")}
                />
                {isSpecial && can("manage_special_bank_accounts") && (
                  <Card className={cn("p-4 -mt-1", masterSpecialAccountPanelClassName)}>
                    <CardHeader className="p-0 pb-4">
                      <CardTitle className={masterSpecialAccountPanelTitleClassName}>
                        Special Account Usage Control
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <SpecialAccountAccessControl
                        users={usersForAccessControl}
                        useFor={normalizeSpecialAccountUseFor(form.watch("useFor"))}
                        onUseForChange={(newUseFor) => {
                          form.setValue("useFor", newUseFor);
                          syncUsageToCompanyPermissions(newUseFor);
                        }}
                      />
                    </CardContent>
                  </Card>
                )}
                <BankAccountToggleFlagsRow control={form.control} />
                <BankCashFormTwoColGrid>
                  <div className="space-y-2"><FormField
                    control={form.control}
                    name="accountName"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Account Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Primary Savings" {...field} />
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
                  <FormField
                    control={form.control}
                    name="accountNumber"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Account Number</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., 123456789" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </BankCashFormTwoColGrid>
                <BankCashFormTwoColGrid>
                  <MasterFormInterCompanyAcNoSlot entityKind="bank" entityId={account.id} mode="edit" />
                  <MasterMobileNoField control={form.control} />
                </BankCashFormTwoColGrid>
                {accountType === "Bank" ? (
                <BankCashFormThreeColGrid>
                  <FormField
                    control={form.control}
                    name="groupId"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Group (Optional)</FormLabel>
                        <FormControl>
                          <div className="w-full">
                            <MasterGroupTreeCombobox
                              preset={BANK_ENTITY_GROUP_PRESET}
                              groups={groups}
                              processedGroups={processedAccountGroups as AccountGroup[]}
                              popoverModal={false}
                              confirmWithOk
                              value={field.value}
                              onBranchChange={(branchId) => {
                                if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                                  form.setValue("accountType", "Bank", { shouldDirty: true });
                                } else if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                                  form.setValue("accountType", "Cash", { shouldDirty: true });
                                }
                              }}
                              onChange={(val, newName) => {
                                if (val === "add-new") {
                                  setIsCreateGroupOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(
                                      new CustomEvent("prefill-create-account-group-name", { detail: newName })
                                    );
                                  }, 100);
                                } else {
                                  const gid = val === "none" ? "" : val;
                                  field.onChange(gid);
                                  if (gid) {
                                    const branchId = resolveMasterGroupTreeBranchIdForGroup(
                                      gid,
                                      processedAccountGroups as AccountGroup[],
                                      BANK_ENTITY_GROUP_PRESET
                                    );
                                    if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                                      form.setValue("accountType", "Cash", { shouldDirty: true });
                                    } else if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                                      form.setValue("accountType", "Bank", { shouldDirty: true });
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
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Bank Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., State Bank of India" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ifscCode"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>IFSC/SWIFT Code</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., HBLNPKA..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </BankCashFormThreeColGrid>
                ) : (
                <BankCashFormTwoColGrid>
                  <FormField
                    control={form.control}
                    name="groupId"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Group (Optional)</FormLabel>
                        <FormControl>
                          <div className="w-full">
                            <MasterGroupTreeCombobox
                              preset={BANK_ENTITY_GROUP_PRESET}
                              groups={groups}
                              processedGroups={processedAccountGroups as AccountGroup[]}
                              popoverModal={false}
                              confirmWithOk
                              value={field.value}
                              onBranchChange={(branchId) => {
                                if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                                  form.setValue("accountType", "Bank", { shouldDirty: true });
                                } else if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                                  form.setValue("accountType", "Cash", { shouldDirty: true });
                                }
                              }}
                              onChange={(val, newName) => {
                                if (val === "add-new") {
                                  setIsCreateGroupOpen(true);
                                  setTimeout(() => {
                                    document.dispatchEvent(
                                      new CustomEvent("prefill-create-account-group-name", { detail: newName })
                                    );
                                  }, 100);
                                } else {
                                  const gid = val === "none" ? "" : val;
                                  field.onChange(gid);
                                  if (gid) {
                                    const branchId = resolveMasterGroupTreeBranchIdForGroup(
                                      gid,
                                      processedAccountGroups as AccountGroup[],
                                      BANK_ENTITY_GROUP_PRESET
                                    );
                                    if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                                      form.setValue("accountType", "Cash", { shouldDirty: true });
                                    } else if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                                      form.setValue("accountType", "Bank", { shouldDirty: true });
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
                </BankCashFormTwoColGrid>
                )}
                <BankCashFormTwoColGrid>
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
                </BankCashFormTwoColGrid>

                <EntityOpeningBalanceNarrationField
                  control={form.control}
                  name="openingBalanceNarration"
                  detailLabel="bank/cash account"
                />

                <FormItem>
                  <FormLabel>Profile photo</FormLabel>
                  {!canAddAvatar ? (
                    <p className="text-xs text-muted-foreground">
                      Upgrade plan to change profile photo.{" "}
                      <Link href="/billing" className="text-primary underline font-medium hover:no-underline">
                        Upgrade
                      </Link>
                    </p>
                  ) : (
                    <div className="flex items-center gap-4 flex-wrap">
                      {file ? (
                        <FilePreview isCompressing={isCompressing} file={file} attachmentCompanyId={companyId ?? undefined} onRemove={removeAvatar} 
                          attachmentReusePlaceKey={(account.id ? `bank_accounts/${account.id}` : null)}
                        />
                      ) : null}
                      {!file ? (
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
                      ) : null}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">Images only — shown on profile / avatar.</p>
                </FormItem>

                <FormItem>
                  <FormLabel>Documents</FormLabel>
                  <p className="mb-1 text-xs leading-snug text-muted-foreground">
                    Optional supporting files (PDF or images). Up to 5 files; stored with this account and shown on the statement opening row (File column).
                  </p>
                  {!canAttachDocuments ? (
                    <p className="text-xs text-muted-foreground">
                      Upgrade for PDF/image attachments.{" "}
                      <Link href="/billing" className="text-primary underline font-medium hover:no-underline">
                        Upgrade
                      </Link>
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <MasterPdfAsImageToggle
                        id="edit-bank-account-pdf-as-image"
                        existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(
                          account as unknown as Record<string, unknown>
                        )}
                      />
                      <div className="flex flex-wrap items-start gap-2">{/* add slot inline with FilePreviews */}
                        {docSlots.map((slot, idx) => (
                          <FilePreview
                            key={typeof slot === "string" ? `${slot}-${idx}` : `${slot.name}-${idx}-${slot.size}`}
                            file={slot}
                            attachmentCompanyId={companyId ?? undefined}
                            attachmentReusePlaceKey={account.id ? `bank_accounts/${account.id}` : null}
                            onRemove={() => removeDocAt(idx)}
                            size={96}
                          />
                        ))}
                        {docSlots.length < 5 ? (
                          <FormControl>
                            <AttachmentHoldPasteSurface
                              enabled={canAttachDocuments}
                              onShortActivate={() => docsInputRef.current?.click()}
                              onPastedFiles={(incoming) => void handleDocsChange(syntheticFileInputChangeEvent(incoming))}
                              className="relative h-24 w-24 shrink-0 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                            >
                              <Upload className="h-6 w-6" />
                              <span className="text-xs mt-1 text-center px-1">PDF / image</span>
                              <Input
                                type="file"
                                className="hidden"
                                ref={docsInputRef}
                                onChange={handleDocsChange}
                                accept="image/*,application/pdf"
                                multiple
                              />
                            </AttachmentHoldPasteSurface>
                          </FormControl>
                        ) : null}
                      </div>
                    </div>
                  )}
                </FormItem>
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
                          <p>Cannot delete an account with existing transactions.</p>
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
        entityKind="account"
        entityName={account.accountName}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "bank_accounts", docId: account.id }}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
      <CreateAccountGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups} />
    </>
  );
}

    
