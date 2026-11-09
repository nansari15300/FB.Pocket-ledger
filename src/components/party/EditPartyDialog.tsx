
"use client";

import { DialogPlainOpener } from "@/components/ui/dialog-plain-opener";
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, CalendarIcon, Upload } from "lucide-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { doc, serverTimestamp, collection, query, Timestamp } from "@/lib/pbCompat/firestore";
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
import type { Party, Group } from "@/components/party/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/plClientSession";
import { useCompany } from "@/hooks/useCompany";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Textarea } from "../ui/textarea";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { toast as sonnerToast } from "sonner";
import {
  MasterFormNameAcNoRow,
  MasterMobileNoField,
  MasterFormTwoColGrid,
} from "@/components/inter-company/MasterFormLayout";
import { useAutoAliasFromName } from "@/hooks/useAutoAliasFromName";
import { PartyGroupTreeCombobox } from "@/components/party/PartyGroupTreeCombobox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useDate } from "@/hooks/useDate";
import { fireRecycleBinMovedAlertForCompanyDoc } from "@/lib/transactionAlerts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import Link from "next/link";
import { FilePreview } from "../vouchers/FilePreview";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { MAX_IMAGE_BYTES_BEFORE_COMPRESS, MAX_IMAGE_MB_BEFORE_COMPRESS } from "@/lib/fileUploadLimits";
import { useVouchers } from "@/hooks/useVouchers";
import { apkCloudCompanyOfflineViewOnly, apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { getCompanyDocFromBrowserDb, listCompanyDocsFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  finalizeMasterOpeningBalanceSideEffects,
  masterOpeningPatchFromPersisted,
} from "@/lib/fyPagination/masterOpeningSaveHooks";
import { useLiveEntityDocAttachments } from "@/hooks/useLiveEntityDocAttachments";
import {
  permanentDeleteCompanySubdocFromRecycleBin,
  softDeleteCompanySubdocToRecycleBin,
} from "@/lib/recycleBinEntityLifecycle";
import { MasterDeleteConfirmAlertDialog } from "@/components/common/MasterDeleteConfirmAlertDialog";
import { assertCanPermanentDeleteFromForm } from "@/lib/permanentDeleteFromForm";
import { countActiveInterCompanyVouchersForCounterpartyParty, purgeInterCompanyCounterpartyPartyIfUnused } from "@/lib/interCompany/cleanupInterCompanyCounterpartyParty";
import { isInterCompanyCounterpartyPartyName } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
function isInterCompanyAutoParty(party: Party): boolean {
  if (party.isInterCompanyCounterparty === true) return true;
  if (String(party.id || "").startsWith("ic_peer_")) return true;
  return isInterCompanyCounterpartyPartyName(party.name);
}
import {
  normalizePartyGroupIdForForm,
  normalizePartyGroupIdForStorage,
  PARTY_SYSTEM_CREDITORS_ID,
  PARTY_SYSTEM_DEBTORS_ID,
  PARTY_SYSTEM_GROUP_OPTIONS,
} from "@/lib/partySystemGroups";
import { resolvePartyGroupBranchIdForGroup } from "@/lib/partyGroupCombobox";
import { parseOpeningBalanceDateToLocalNoon } from "@/lib/voucherDateNormalize";
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cnMasterEntityDialogContent,
  masterEntityDialogFormWrapperClassName,
  masterEntityDialogHeaderClassName,
} from "@/lib/masterEntityDialogClasses";
import { MasterPdfAsImageToggle } from "@/components/common/EntityProfileDocumentsNarrationFields";
import { attachmentLockFieldsForFinalUrls, readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";

/** Legacy ungrouped / empty → Sundry Creditors for combobox + save. */
function normalizePartyEditGroupId(groupId: string | null | undefined): string {
  return normalizePartyGroupIdForForm(groupId);
}

const formSchema = z.object({
    accountType: z.enum([PARTY_SYSTEM_DEBTORS_ID, PARTY_SYSTEM_CREDITORS_ID], {
      message: "Select account type.",
    }),
  name: z.string().min(2, { message: "Party name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  email: z.string().email({ message: "Please enter a valid email." }).optional().or(z.literal("")),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  pan: z.string().optional(),
  address: z.string().optional(),
  groupId: z.string().optional(),
  openingBalance: z.coerce.number(),
  openingBalanceDate: z.date().optional(),
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

const MAX_FILE_SIZE_MB = 0.5;

/** Save toast — lamba "Saving…" hata, chhota feedback (PC/mobile). */
const PARTY_TOAST_OK_MS = 1000;

export function EditPartyDialog({ party, onPartyUpdated, onPartyDeleted, children, hasTransactions, isOpen: controlledIsOpen, onOpenChange, presentationMode = "default" }: {
  party: Party;
  onPartyUpdated: (updatedParty: Partial<Party>) => void;
  onPartyDeleted: (deletedId: string) => void;
  children: React.ReactNode;
  hasTransactions: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  presentationMode?: MasterEditPresentationMode;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const navigatorOnline = useNavigatorOnline();
  /** Pure-local APK SQLite writes; APK cloud Firebase = Firestore saves par bhi dropdown lists SQLite mirror se (`apkCloudEntityMasterReadFromSqliteMirror`). */
  const localSqlMirror = useMemo(() => apkEntityWriteUsesLocalSqliteMirror(company), [company]);
  const sqliteListsOnlyNoSnapshot = useMemo(
    () => localSqlMirror || apkCloudEntityMasterReadFromSqliteMirror(company),
    [localSqlMirror, company]
  );
  /** Non-embedded APK cloud + offline: view-only. */
  const apkOfflineViewOnly = useMemo(() => apkCloudCompanyOfflineViewOnly(company, navigatorOnline), [company, navigatorOnline]);
  const { processedGroups } = useVouchers();
  /** Dialog effect me Firestore fail hone par bhi latest list — deps me poora array na dalein (balance churn). */
  const processedGroupsRef = React.useRef(processedGroups);
  processedGroupsRef.current = processedGroups;
  const { canAddAvatar, canAddFileImagePdf, can, role } = usePermissions();
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const { dateSystem } = useDate();
  const isMobile = useIsMobile();
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  /** Profile photo only — image; string = saved URL or local: ref */
  const [file, setFile] = useState<File | string | null>(party.fileUrl || null);
  /** PDF / images — File new pick ya existing URL string */
  const [docSlots, setDocSlots] = useState<Array<File | string>>(() => party.documentFileUrls || []);
  const initialFileRef = useRef<string | null>(party.fileUrl || null);
  const initialDocUrlsRef = useRef<string[]>(party.documentFileUrls || []);
  const attachmentsDirty =
    file instanceof File ||
    docSlots.some((x) => x instanceof File) ||
    (typeof file === "string" ? file : null) !== initialFileRef.current ||
    JSON.stringify(docSlots.filter((x): x is string => typeof x === "string")) !==
      JSON.stringify(initialDocUrlsRef.current);

  const onLiveAttachmentFields = React.useCallback(
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
    collection: "parties",
    entityId: party.id,
    attachmentsDirty,
    preferSqliteMirror: sqliteListsOnlyNoSnapshot,
    onFields: onLiveAttachmentFields,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);


  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as Resolver<z.infer<typeof formSchema>>,
    defaultValues: {
        accountType: (resolvePartyGroupBranchIdForGroup(
          normalizePartyEditGroupId(party.groupId),
          processedGroups
        ) ?? PARTY_SYSTEM_CREDITORS_ID) as typeof PARTY_SYSTEM_DEBTORS_ID | typeof PARTY_SYSTEM_CREDITORS_ID,
        name: party.name,
        aliasName: (((party as unknown) as { aliasName?: string }).aliasName) || "",
        email: party.email || "",
        phone: party.phone || "",
        whatsapp: party.whatsapp === true,
        pan: party.pan || "",
        address: party.address || "",
        groupId: normalizePartyEditGroupId(party.groupId),
        openingBalance: party.openingBalance || 0,
        // SQLite/Firestore plain timestamp — sirf `toDate` na; noon = BS picker + ledger row same din
        openingBalanceDate: parseOpeningBalanceDateToLocalNoon((party as any).openingBalanceDate) ?? undefined,
        openingBalanceNarration: party.openingBalanceNarration ?? "",
    },
  });
  const { markAliasUserEdited } = useAutoAliasFromName(form);

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  const accountType = form.watch("accountType");

  const handleGroupCreated = (newGroupId: string) => {
    form.setValue('groupId', newGroupId);
    setTimeout(() => setIsCreateGroupOpen(false), 50);
  };

  useEffect(() => {
    if (isOpen) setIsLoading(false);
  }, [isOpen, party.id]);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    const applyPartyGroups = (list: Group[]) => {
      setGroups(
        list.filter((g: any) => g?.id && !g.isDeleted && !(g as any).isSystemReserved)
      );
    };

    const seedFromVoucherContext = () => {
      const fromCtx = (processedGroupsRef.current || []).filter(
        (g: any) => !g.isDeleted && !g.isSystemReserved
      ) as Group[];
      if (fromCtx.length) applyPartyGroups(fromCtx);
    };

    const loadGroupsFromBrowserDb = async (): Promise<Group[]> => {
      try {
        const rows = await listCompanyDocsFromBrowserDb(companyId, "groups");
        return rows.map((r: any) => ({ ...r, id: r.id } as Group));
      } catch {
        return [];
      }
    };

    seedFromVoucherContext();

    // APK cloud bhi redundant `onSnapshot` band — SQLite mirror (`warm sync`) authoritative lists ke liye.
    if (sqliteListsOnlyNoSnapshot) {
      void (async () => {
        const fromDb = await loadGroupsFromBrowserDb();
        if (cancelled) return;
        if (fromDb.length) applyPartyGroups(fromDb);
      })();
      return () => {
        cancelled = true;
      };
    }

    const q = query(collection(firestore, `companies/${companyId}/groups`));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        if (cancelled) return;
        applyPartyGroups(querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Group)));
      },
      async (error) => {
        console.error("Error fetching groups:", error);
        if (cancelled) return;
        const fromDb = await loadGroupsFromBrowserDb();
        if (cancelled) return;
        if (fromDb.length) {
          applyPartyGroups(fromDb);
          return;
        }
        seedFromVoucherContext();
        if (cancelled) return;
        // Synthetic "Ungrouped" combobox option hamesha hai — listener glitch par user ko disturb mat karo
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isOpen, companyId, toast, sqliteListsOnlyNoSnapshot]);


  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
    }
  }, [isOpen, party.id]);

  /** Stable primitive for effect deps (array identity changes on every parent render / live patch). */
  const partyDocUrlsKey = (party.documentFileUrls || []).join("\u0001");

  // FY voucher scope re-render par poora `party` object badalta hai — sirf open / id par reset (mid-edit wipe na ho).
  useEffect(() => {
    if (!isOpen) return;
    const dateValue = (party as any).openingBalanceDate;
    const finalDate = parseOpeningBalanceDateToLocalNoon(dateValue) ?? undefined;

    form.reset({
      accountType: (resolvePartyGroupBranchIdForGroup(
        normalizePartyEditGroupId(party.groupId),
        processedGroupsRef.current
      ) ?? PARTY_SYSTEM_CREDITORS_ID) as typeof PARTY_SYSTEM_DEBTORS_ID | typeof PARTY_SYSTEM_CREDITORS_ID,
      name: party.name,
      aliasName: (((party as unknown) as { aliasName?: string }).aliasName) || "",
      email: party.email || "",
      phone: party.phone || "",
      whatsapp: party.whatsapp === true,
      pan: party.pan || "",
      address: party.address || "",
      groupId: normalizePartyEditGroupId(party.groupId),
      openingBalance: party.openingBalance || 0,
      openingBalanceDate: finalDate,
      openingBalanceNarration: party.openingBalanceNarration ?? "",
    });
    setFile(party.fileUrl || null);
    setDocSlots(party.documentFileUrls || []);
    initialFileRef.current = party.fileUrl || null;
    initialDocUrlsRef.current = party.documentFileUrls || [];
  }, [
    isOpen,
    party.id,
    party.name,
    party.email,
    party.phone,
    party.whatsapp,
    party.pan,
    party.address,
    party.groupId,
    party.openingBalance,
    (party as any).openingBalanceDate,
    party.openingBalanceNarration,
    party.fileUrl,
    partyDocUrlsKey,
    form,
  ]);

  async function onSubmit(values: z.infer<typeof formSchema>): Promise<void> {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }

    const isLocalGuestUser = user?.uid === "local_guest_user";
    const backupSyncEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1";
    const fileSnap = file;
    const docSlotsSnap = docSlots;
    const partyRefSnap = party;
    const attachmentBaselineSnap = captureEntityFormAttachmentBaseline({
      fileUrl: initialFileRef.current,
      documentFileUrls: initialDocUrlsRef.current,
    });

    // PC/mobile/APK: form turant band; storage/Firestore ka kaam niche async (`void` block) — user block nahi
    setIsOpen(false);

    void (async () => {
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
            sonnerToast.error("Storage limit reached", { description: limitCheck.message, duration: 4000 });
            return;
          }
        }

        const needAvatarUpload = prepared.avatar instanceof File && canAddAvatar;
        const needNewDocsUpload = newDocFiles.length > 0 && canAttachDocuments;
        let documentFileUrls = [...keptDocUrls];
        if (companyId && (needAvatarUpload || needNewDocsUpload)) {
          const st = await uploadEntityAvatarAndDocumentsRemote({
            companyId,
            collectionSeg: "parties",
            entityId: partyRefSnap.id,
            avatarFile: needAvatarUpload ? (prepared.avatar as File) : null,
            documentFiles: needNewDocsUpload ? newDocFiles : [],
            company,
          });
          if (st.fileUrl) fileUrl = st.fileUrl;
          documentFileUrls = [...keptDocUrls, ...st.documentFileUrls];
        }

        const oldOpeningBalance = partyRefSnap.openingBalance || 0;
        const newOpeningBalance = values.openingBalance || 0;
        const resolvedGroupId = normalizePartyGroupIdForStorage(values.groupId?.trim());
        const narrationClean = values.openingBalanceNarration?.trim() || null;

        /** Firestore `undefined` field skip / local mirror — explicit payload (EditAccountDialog jaisa) */
        const updatePayload: Record<string, unknown> = {
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          address: values.address ?? "",
          phone: values.phone ?? "",
          whatsapp: values.whatsapp === true,
          email: values.email ?? "",
          pan: values.pan ?? "",
          openingBalance: newOpeningBalance,
          openingBalanceDate: values.openingBalanceDate ?? null,
          openingBalanceNarration: narrationClean,
          groupId: resolvedGroupId,
          fileUrl,
          documentFileUrls: documentFileUrls.length ? documentFileUrls : [],
          ...attachmentLockFieldsForFinalUrls(documentFileUrls, {
            existingLockedPdfFileUrls: readLockedPdfFileUrlsFromRow(
              party as unknown as Record<string, unknown>
            ),
            canUnlockLockedPdf: can("unlock_locked_pdf"),
          }),
          updatedAt: serverTimestamp(),
        };

        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "parties", partyRefSnap.id);
          const { serverTimestampTraceLog } = await import("@/lib/plServerLivePullDevLog");
          const { mirrorDocTimestampFields } = await import("@/lib/localCompanyDocMirror");
          serverTimestampTraceLog("before_save_dialog", {
            companyId,
            collection: "parties",
            id: partyRefSnap.id,
            ...(fromDb ? mirrorDocTimestampFields(fromDb) : { editTimeMs: 0 }),
          });
          const base: Record<string, unknown> = fromDb ?? {
            id: partyRefSnap.id,
            companyId,
            ownerId: user?.uid ?? "local_guest_user",
            balance: partyRefSnap.balance ?? 0,
            debit: partyRefSnap.debit ?? 0,
            credit: partyRefSnap.credit ?? 0,
            isDeleted: false,
          };
          const payload: Record<string, unknown> = {
            ...base,
            ...updatePayload,
            id: partyRefSnap.id,
            companyId,
            updatedAt: Timestamp.now(),
          };
          await upsertCompanyDocInBrowserDb(companyId, "parties", partyRefSnap.id, payload);
          const persisted =
            (await getCompanyDocFromBrowserDb(companyId, "parties", partyRefSnap.id)) ?? payload;
          await enqueueCompanyDocOutbox(companyId, "parties", "update", partyRefSnap.id, persisted);
          syncEntityAttachmentsAfterSave(companyId);

          await finalizeMasterOpeningBalanceSideEffects({
            company,
            companyId,
            collection: "parties",
            entityId: partyRefSnap.id,
            oldOpeningBalance,
            newOpeningBalance,
            oldOpeningBalanceDate: (partyRefSnap as any).openingBalanceDate,
            newOpeningBalanceDate: values.openingBalanceDate,
          });

          const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
          onPartyUpdated({
            id: partyRefSnap.id,
            ...values,
            ...masterOpeningPatchFromPersisted(persisted),
            fileUrl: fileUrl || "",
            documentFileUrls,
          });
          initialFileRef.current = fileUrl || null;
          initialDocUrlsRef.current = documentFileUrls.filter((u): u is string => typeof u === "string");
          sonnerToast.success(showSyncHint ? "Saved — will sync" : "Updated", {
            duration: PARTY_TOAST_OK_MS,
            description: showSyncHint ? "Background sync" : values.name,
          });
          finalizeFormAttachmentEditAfterSave({
            companyId,
            baselineUrls: attachmentBaselineSnap,
            finalUrls: captureEntityFormAttachmentBaseline({
              fileUrl,
              documentFileUrls,
            }),
            oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
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
          collection: "parties",
          docId: partyRefSnap.id,
          patch: updatePayload,
        });
        await syncEntityAttachmentsAfterSave(companyId);

        await finalizeMasterOpeningBalanceSideEffects({
          company,
          companyId,
          collection: "parties",
          entityId: partyRefSnap.id,
          oldOpeningBalance,
          newOpeningBalance,
          oldOpeningBalanceDate: (partyRefSnap as any).openingBalanceDate,
          newOpeningBalanceDate: values.openingBalanceDate,
        });

        onPartyUpdated({
          id: partyRefSnap.id,
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
          finalUrls: captureEntityFormAttachmentBaseline({
            fileUrl,
            documentFileUrls,
          }),
          oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
        });
        sonnerToast.success("Updated", { duration: PARTY_TOAST_OK_MS, description: values.name });
      } catch (error) {
        console.error("Error updating party:", error);
        sonnerToast.error("Couldn’t save", {
          duration: 5000,
          description: error instanceof Error ? error.message : "Please try again.",
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
      const isIcAutoParty = isInterCompanyAutoParty(party);
      if (!isIcAutoParty) {
        sonnerToast.error("Cannot Delete", { description: "This party has transactions and cannot be deleted." });
        setIsDeleteDialogOpen(false);
        return;
      }
      const activeIc = await countActiveInterCompanyVouchersForCounterpartyParty(companyId, party.id);
      if (activeIc > 0) {
        sonnerToast.error("Cannot Delete", {
          description: "This Inter Company account is still linked to active vouchers.",
        });
        setIsDeleteDialogOpen(false);
        return;
      }
    }
    
    setIsLoading(true);
    try {
      if (isInterCompanyAutoParty(party)) {
        const purged = await purgeInterCompanyCounterpartyPartyIfUnused({
          companyId,
          partyId: party.id,
        });
        if (!purged) {
          throw new Error("This Inter Company account is still linked to vouchers.");
        }
        toast({ title: "Party Removed", description: `"${party.name}" has been removed.` });
        void fireRecycleBinMovedAlertForCompanyDoc(companyId, "parties", party.id, party.name, {
          uid: user?.uid,
          email: user?.email,
          name: user?.displayName,
        });
        onPartyDeleted(party.id);
        setIsOpen(false);
        setIsDeleteDialogOpen(false);
        return;
      }
      const res = await softDeleteCompanySubdocToRecycleBin(companyId, "parties", party.id, user?.uid || "");
      if (!res.ok) throw new Error("error" in res ? res.error : "delete failed");
        toast({ title: "Party Moved to Bin", description: `"${party.name}" has been moved to the recycle bin.`});
        void fireRecycleBinMovedAlertForCompanyDoc(companyId, "parties", party.id, party.name, {
          uid: user?.uid,
          email: user?.email,
          name: user?.displayName,
        });
        onPartyDeleted(party.id);
        setIsOpen(false);
        setIsDeleteDialogOpen(false);
    } catch (error) {
        console.error("Error deleting party: ", error);
        toast({
            variant: "destructive",
            title: "Delete Failed",
            description: "An error occurred while deleting the party.",
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
    if (hasTransactions && !isInterCompanyAutoParty(party)) {
      sonnerToast.error("Cannot Delete", { description: "This party has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    if (hasTransactions && isInterCompanyAutoParty(party)) {
      const activeIc = await countActiveInterCompanyVouchersForCounterpartyParty(companyId, party.id);
      if (activeIc > 0) {
        sonnerToast.error("Cannot Delete", {
          description: "This Inter Company account is still linked to active vouchers.",
        });
        setIsDeleteDialogOpen(false);
        return;
      }
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(companyId, "parties", party.id);
      toast({
        title: "Party deleted permanently",
        description: `"${party.name}" was permanently deleted.`,
      });
      onPartyDeleted(party.id);
      setIsOpen(false);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error permanently deleting party: ", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "Could not permanently delete the party.",
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
        title: "File Too Large",
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

  const removeDocAt = (idx: number) => setDocSlots((p) => p.filter((_, i) => i !== idx));

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
            <DialogTitle>Edit Party</DialogTitle>
            <DialogDescription>Update the details for {party.name}.</DialogDescription>
          </DialogHeader>
          <div className={masterEntityDialogFormWrapperClassName}>
          <Form {...form}>
            {/* Scroll body + ek hi row footer: Cancel • Bin • Save — pehle grid me Save neeche doosri line tha */}
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
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
                  entityId={party.id}
                  mode="edit"
                  nameField={
                    <div className="space-y-2"><FormField
                      control={form.control}
                      name="name"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Party Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Creative Solutions Ltd." {...field} />
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
                            <Input
                              placeholder="Other name on bills / short name"
                              {...field}
                              onChange={(e) => {
                                markAliasUserEdited();
                                field.onChange(e);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    /></div>
                  }
                />
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
                              document.dispatchEvent(
                                new CustomEvent("prefill-create-group-name", { detail: newName })
                              );
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
                        <Input placeholder="ABCDE1234F" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </MasterFormTwoColGrid>
              <MasterFormTwoColGrid>
                <MasterMobileNoField control={form.control} placeholder="+91 12345 67890" />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="name@example.com" {...field} />
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
                        <Textarea placeholder="123 Main Street, Anytown..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Opening balance | As on date — ek row, barabar width */}
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
                <FormItem>
                  <FormLabel>Profile photo</FormLabel>
                  {!canAddAvatar ? (
                    <p className="text-xs text-muted-foreground">
                      Upgrade plan to change profile photo.{" "}
                      <Link href="/billing" className="text-primary underline font-medium hover:no-underline">Upgrade</Link>
                    </p>
                  ) : (
                    <div className="flex items-center gap-4 flex-wrap">
                      {file ? (
                        <FilePreview isCompressing={isCompressing} file={file} attachmentCompanyId={companyId ?? undefined} onRemove={removeAvatar} 
                          attachmentReusePlaceKey={(party.id ? `parties/${party.id}` : null)}
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
                  <p className="text-xs text-muted-foreground mb-1 leading-snug">
                    Optional supporting files for this party (PDF or images — e.g. registration, agreement scans). Up to 5 files; stored with the party and available from the statement.
                  </p>
                  <p className="text-[10px] text-muted-foreground mb-1">
                    On the party statement they show on the opening balance row under the <span className="font-medium">File</span> column (green tick), like voucher attachments.
                  </p>
                  {!canAttachDocuments ? (
                    <p className="text-xs text-muted-foreground">
                      Upgrade for PDF/image attachments.{" "}
                      <Link href="/billing" className="text-primary underline font-medium hover:no-underline">Upgrade</Link>
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <MasterPdfAsImageToggle
                        id="edit-party-pdf-as-image"
                        existingLockedPdfFileUrls={readLockedPdfFileUrlsFromRow(
                          party as unknown as Record<string, unknown>
                        )}
                      />
                      <div className="flex flex-wrap items-start gap-2">
                        {docSlots.map((slot, idx) => (
                          <FilePreview
                            key={typeof slot === "string" ? `${slot}-${idx}` : `${slot.name}-${idx}-${slot.size}`}
                            file={slot}
                            attachmentCompanyId={companyId ?? undefined}
                            attachmentReusePlaceKey={party.id ? `parties/${party.id}` : null}
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

                <FormField
                  control={form.control}
                  name="openingBalanceNarration"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Opening balance narration (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g. OB brought forward…"
                          className="min-h-[72px] resize-y"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <p className="text-[10px] text-muted-foreground">
                        Shown on the party statement under the Opening Balance row (voucher-style narration).
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

            </div>
              <DialogFooter className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
                {/* Taarteeb: Cancel (baaen) | Move to Bin (beech) | Save (daaen); shadcn DialogFooter ka flex-col-reverse yahan row se replace */}
                <DialogClose asChild>
                  {/* Gray pill: user ask — ghost ke upar slate fill (global pill = rounded-full pehle se) */}
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
                          <p>Cannot delete a party with existing transactions.</p>
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
                {/* APK cloud offline par submit band — sirf Cancel/close chalu */}
                <Button
                  type={openingBalanceDateMissing ? "button" : "submit"}
                  className="shrink-0"
                  disabled={isLoading || isCompressing || apkOfflineViewOnly}
                  onClick={() => {
                    if (!openingBalanceDateMissing) return;
                    document.querySelector("[data-opening-balance-date]")?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                  }}
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
        entityKind="party"
        entityName={party.name}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "parties", docId: party.id }}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
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
