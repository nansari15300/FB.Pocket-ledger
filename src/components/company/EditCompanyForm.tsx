
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CalendarIcon, Eye, EyeOff, Pencil, Trash2, Upload, UserPlus } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  doc,
  Timestamp,
  serverTimestamp,
  deleteField,
  arrayUnion,
  query,
  collection,
  where,
} from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { updateCompanyRootFirestore } from "@/lib/writeGateway/companyRootFirestore";
import { uploadCompanyLogo, tryDeleteStorageFileByUrl } from "@/lib/storage";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
import { usePcFileDropZone } from "@/lib/attachmentPcFileDrop";
import { FilePreview } from "../vouchers/FilePreview";
import { CompanyInterCompanyCodeField } from "@/components/inter-company/CompanyInterCompanyCodeField";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";
import { adminPanelCompanyStorageLabel } from "@/lib/adminPanelCompany/patchCompanyProfile";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/hooks/use-toast";
import { countries } from "@/lib/countries";
import { CountryCurrencyCombobox } from "@/components/shared/CountryCurrencyCombobox";
import {
  getDefaultCurrencyForCountry,
  resolveCurrencyCountryKey,
} from "@/lib/worldCurrencies";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { firestore } from "@/lib/firebase";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Separator } from "../ui/separator";
import { PasswordUpdateConfirmationDialog } from "./PasswordUpdateConfirmationDialog";
import { PlServerShareUserDialog } from "./PlServerShareUserDialog";
import { isCompanyNotFoundError, COMPANY_NOT_SYNCED_MESSAGE } from "@/lib/companyUpdateGuard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useVouchers } from "@/hooks/useVouchers";
import Link from "next/link";
import { Tooltip, TooltipProvider, TooltipContent } from "../ui/tooltip";
import { Skeleton } from "../ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isOfflineCompanyStorage, shareEntryHasPassword } from "@/lib/companyUnlockGate";
import { generateEncryptServerBackupSaltBase64, setBackupEncryptionSessionFromLogin } from "@/lib/serverBackupEncryption";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { generateLocalFileId, LOCAL_FILE_PREFIX, putPendingFile } from "@/lib/localPendingFiles";
import { flushBrowserDbToIndexedDB } from "@/lib/localSqlite";
import {
  localCompanyUsersToPublicList,
  mergeSharedWithIntoLocalCompanyUsers,
  parseLocalCompanyUserRows,
  removeLocalCompanyUserByIdClient,
  updateLocalCompanyUserClient,
  upsertUserInList,
} from "@/lib/localCompanyUsers";
import { CompanyFyVoucherSuggestionCard } from "@/components/company/CompanyFyVoucherSuggestionCard";
import {
  buildCompanyFyVoucherSuggestion,
  getFiscalYearConventionLabel,
  isCompanyFiscalYearUnset,
  resolveAllFySplitComplete,
  resolveSavedFiscalMergePeriodCount,
} from "@/lib/companyFyVoucherSuggestion";
import { getFiscalRangeForCountry } from "@/lib/fiscalRange";
import { Checkbox } from "@/components/ui/checkbox";

type LocalCompanyUserDraft = { name: string; username: string; role: string; password: string };
type ExistingLocalCompanyUser = { id?: string; username?: string; displayName?: string; role?: string };

const formSchema = z.object({
  name: z.string().min(2, { message: "Company name must be at least 2 characters." }),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email({ message: "Please enter a valid email." }).optional().or(z.literal("")),
  pan: z.string().optional(),
  country: z.string().min(1, { message: "Please select a country." }),
  /** Searchable currency row (country name key) — save par `currencyCode` + `currencySymbol` derive. */
  billingCurrencyCountry: z.string().min(1, { message: "Please select a currency." }),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  fiscalYearStart: z.date().optional(),
  fiscalYearEnd: z.date().optional(),
  confirmPasswordToSave: z.string().optional(),
  adminUsername: z.string().optional(),
  companyUserName: z.string().optional(),
  companyUserUsername: z.string().optional(),
  /** Online share: invite email (Manage Sharing list). */
  companyUserEmail: z.string().optional().or(z.literal("")),
  companyUserRole: z.string().optional(),
  companyUserPassword: z.string().optional(),
}).refine(data => {
    if (data.password || data.confirmPassword) {
        return data.password === data.confirmPassword;
    }
    return true;
}, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
});


export function EditCompanyForm({
  readOnly = false,
  initialPasswordEnabled = false,
  onSaved,
}: {
  readOnly?: boolean;
  initialPasswordEnabled?: boolean;
  onSaved?: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const {
    company,
    companyId,
    loading: companyLoading,
    clearCompanyId,
    triggerSync,
    reloadLocalCompanyRegistry,
    localCompanyRegistryEpoch,
    allCompanies,
  } = useCompany();
  const { toast } = useToast();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { user } = useAuth();
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showConfirmPasswordToSave, setShowConfirmPasswordToSave] = useState(false);
  /** Online edit: Protect company checkbox jab abhi password set nahi; pehle se ho to UI "Change" mode. */
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [passwordConfirmation, setPasswordConfirmation] = useState<{
    newPasswordValue: string;
    usersToUpdate: any[];
  } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const { vouchers } = useVouchers();
  const hasTransactions = vouchers.length > 0;
  const { canAddAvatar } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileToUpload, setFileToUpload] = useState<{ file: File; preview: string } | null>(null);
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [removeLogo, setRemoveLogo] = useState(false);
  /** Firebase company: Firestore mirror AES — login username+password session. */
  const [encryptCompanyEnabled, setEncryptCompanyEnabled] = useState(false);
  const livePlans = useLivePlans();
  const [addCompanyUserEnabled, setAddCompanyUserEnabled] = useState(false);
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [showCompanyUserPassword, setShowCompanyUserPassword] = useState(false);
  const [queuedCompanyUsers, setQueuedCompanyUsers] = useState<LocalCompanyUserDraft[]>([]);
  const [existingLocalUsers, setExistingLocalUsers] = useState<ExistingLocalCompanyUser[]>([]);
  /** Existing row edit: dialog fields (SQLite `localCompanyUsers` update). */
  const [localUserToEdit, setLocalUserToEdit] = useState<ExistingLocalCompanyUser | null>(null);
  const [editLocalDisplayName, setEditLocalDisplayName] = useState("");
  const [editLocalRole, setEditLocalRole] = useState("manager");
  const [editLocalPassword, setEditLocalPassword] = useState("");
  const [editLocalSaving, setEditLocalSaving] = useState(false);
  const [localUserToRemove, setLocalUserToRemove] = useState<ExistingLocalCompanyUser | null>(null);
  const [removeLocalUserLoading, setRemoveLocalUserLoading] = useState(false);
  /** User ne currency alag se chuna ho to country change par auto-sync mat karo. */
  const currencyPickedManuallyRef = useRef(false);
  const prevCountryForFyRef = useRef<string | undefined>(undefined);

  // When plan does not allow avatar, clear any queued file
  useEffect(() => {
    if (!canAddAvatar && fileToUpload?.preview) {
      URL.revokeObjectURL(fileToUpload.preview);
      setFileToUpload(null);
    }
  }, [canAddAvatar]);

  const processLogoFile = useCallback(
    async (inputFile: File) => {
      if (!canAddAvatar) {
        toast({
          variant: "destructive",
          title: "Not allowed",
          description: "Your plan does not allow adding or changing company logo.",
        });
        return;
      }
      if (!inputFile.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: "Images only",
          description: "Company logo must be an image file.",
        });
        return;
      }

      setIsFileProcessing(true);
      try {
        const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(
          inputFile,
          (company as { id?: string } | null | undefined)?.id ?? null
        );
        if (compressedFile.size > maxBytes) {
          toast({
            variant: "destructive",
            ...attachmentImageStillTooLargeToastFields(maxKb),
          });
          return;
        }
        const preview = URL.createObjectURL(compressedFile);
        setFileToUpload({ file: compressedFile, preview });
        setRemoveLogo(false);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Could not process file",
          description: error instanceof Error ? error.message : "Compression or PDF read failed.",
        });
      } finally {
        setIsFileProcessing(false);
      }
    },
    [canAddAvatar, company, toast]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    await processLogoFile(e.target.files[0]);
    e.target.value = "";
  };

  const showLogoDropTarget = canAddAvatar && !isFileProcessing;
  const { isDragOver: logoDragOver, dropZoneProps: logoDropZoneProps } = usePcFileDropZone({
    enabled: showLogoDropTarget,
    onFiles: (files) => {
      const first = files[0];
      if (first) void processLogoFile(first);
    },
  });

  const removeFile = () => {
    if (fileToUpload?.preview) {
      URL.revokeObjectURL(fileToUpload.preview);
    }
    setFileToUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      address: "",
      phone: "",
      email: "",
      pan: "",
      country: "Nepal",
      billingCurrencyCountry: "Nepal",
      password: "",
      confirmPassword: "",
      confirmPasswordToSave: "",
      adminUsername: "",
      companyUserName: "",
      companyUserUsername: "",
      companyUserEmail: "",
      // Existing permission model me manager = admin-like company user role.
      companyUserRole: "manager",
      companyUserPassword: "",
    },
  });

  const companyUserNameWatch = form.watch("companyUserName");
  useEffect(() => {
    form.setValue("companyUserUsername", (companyUserNameWatch || "").trim());
  }, [companyUserNameWatch, form]);
  
  const companyNameValue = form.watch("name");
  const confirmPasswordToSaveValue = form.watch("confirmPasswordToSave");
  const isDeleteEnabled =
    !company?.password ||
    (company.password && String(confirmPasswordToSaveValue ?? "").trim() === String(company.password).trim());


  useEffect(() => {
    if (company) {
        const safeGetDate = (dateValue: any): Date | undefined => {
            if (!dateValue) return undefined;
            if (dateValue instanceof Timestamp) return dateValue.toDate();
            if (dateValue instanceof Date) return dateValue;
            if (dateValue && typeof dateValue.toDate === 'function') return dateValue.toDate();
            const parsed = new Date(dateValue);
            return isNaN(parsed.getTime()) ? undefined : parsed;
        };

        form.reset({
            name: company.name,
            address: company.address || "",
            phone: company.phone || "",
            email: company.email || "",
            pan: company.pan || "",
            country: company.country || "Nepal",
            billingCurrencyCountry: resolveCurrencyCountryKey(company),
            fiscalYearStart: safeGetDate(company.fiscalYearStart),
            fiscalYearEnd: safeGetDate(company.fiscalYearEnd),
            password: "",
            confirmPassword: "",
            confirmPasswordToSave: "",
            // Company login admin username; default from saved value or owner email prefix.
            adminUsername:
              ((company as any)?.adminUsername as string) ||
              ((company.ownerEmail || "").includes("@") ? (company.ownerEmail || "").split("@")[0] : ""),
            companyUserName: "",
            companyUserUsername: "",
            companyUserEmail: "",
            companyUserRole: "manager",
            companyUserPassword: "",
        });
        setEncryptCompanyEnabled(company.encryptServerBackup === true);
        // Saved password ho to toggle ON; nahi to user edit se naya password add kar sake.
        setPasswordEnabled(
          initialPasswordEnabled || !!(company.password && String(company.password).trim())
        );
        currencyPickedManuallyRef.current = false;
        prevCountryForFyRef.current = company.country || "Nepal";
        if (isCompanyFiscalYearUnset(safeGetDate(company.fiscalYearStart), safeGetDate(company.fiscalYearEnd))) {
          const { start, end } = getFiscalRangeForCountry(company.country || "Nepal");
          form.setValue("fiscalYearStart", start, { shouldDirty: false });
          form.setValue("fiscalYearEnd", end, { shouldDirty: false });
        }
        // Edit open par add-user section default बंद रखो to avoid accidental duplicate user create.
        setAddCompanyUserEnabled(false);
        setQueuedCompanyUsers([]);
    }
  }, [company, form, initialPasswordEnabled]);

  const loadExistingLocalUsers = useCallback(async () => {
    if (!companyId || !isLocalOnlyMode() || (company && !isOfflineCompanyStorage(company))) {
      setExistingLocalUsers([]);
      return;
    }
    try {
      const doc = await getLocalCompanyById(companyId, { includeDeleted: true });
      const rows = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown })?.localCompanyUsers);
      setExistingLocalUsers(localCompanyUsersToPublicList(rows));
    } catch {
      setExistingLocalUsers([]);
    }
  }, [companyId, company]);

  useEffect(() => {
    void loadExistingLocalUsers();
  }, [loadExistingLocalUsers, localCompanyRegistryEpoch]);

  useEffect(() => {
    if (!localUserToEdit) return;
    setEditLocalDisplayName((localUserToEdit.displayName || localUserToEdit.username || "").trim());
    setEditLocalRole((localUserToEdit.role || "manager").toLowerCase());
    setEditLocalPassword("");
  }, [localUserToEdit]);
  
  const displayDate = (date?: Date) => {
    if (!date) return "Pick a date";
    switch(dateSystem) {
        case 'AD': return formatDate(date);
        case 'BS': return formatDateBS(date);
        case 'Both': return `${formatDate(date)} / ${formatDateBS(date)}`;
        default: return formatDate(date);
    }
  };

  const fiscalYearStartWatch = form.watch("fiscalYearStart");
  const fiscalYearEndWatch = form.watch("fiscalYearEnd");
  const selectedCountryWatch = form.watch("country");

  useEffect(() => {
    if (!selectedCountryWatch) return;
    if (prevCountryForFyRef.current === undefined) {
      prevCountryForFyRef.current = selectedCountryWatch;
      return;
    }
    if (prevCountryForFyRef.current === selectedCountryWatch) return;
    prevCountryForFyRef.current = selectedCountryWatch;
    const { start, end } = getFiscalRangeForCountry(selectedCountryWatch);
    form.setValue("fiscalYearStart", start, { shouldDirty: true });
    form.setValue("fiscalYearEnd", end, { shouldDirty: true });
  }, [selectedCountryWatch, form]);

  const watchedCompanyFyDates = useMemo(() => {
    if (
      !(fiscalYearStartWatch instanceof Date) ||
      Number.isNaN(fiscalYearStartWatch.getTime()) ||
      !(fiscalYearEndWatch instanceof Date) ||
      Number.isNaN(fiscalYearEndWatch.getTime())
    ) {
      return undefined;
    }
    return { fiscalYearStart: fiscalYearStartWatch, fiscalYearEnd: fiscalYearEndWatch };
  }, [fiscalYearStartWatch, fiscalYearEndWatch]);
  const savedMergePeriodCount = useMemo(
    () => resolveSavedFiscalMergePeriodCount(companyId, vouchers, selectedCountryWatch, watchedCompanyFyDates),
    [companyId, vouchers, selectedCountryWatch, watchedCompanyFyDates]
  );

  const allFySplitted = useMemo(
    () => resolveAllFySplitComplete(companyId, vouchers, selectedCountryWatch, watchedCompanyFyDates),
    [companyId, vouchers, selectedCountryWatch, watchedCompanyFyDates]
  );

  const fyVoucherSuggestion = useMemo(
    () =>
      buildCompanyFyVoucherSuggestion({
        country: selectedCountryWatch,
        fiscalYearStart: fiscalYearStartWatch,
        fiscalYearEnd: fiscalYearEndWatch,
        vouchers,
        mergedPeriodCount: savedMergePeriodCount,
        allFySplitted,
      }),
    [selectedCountryWatch, fiscalYearStartWatch, fiscalYearEndWatch, vouchers, savedMergePeriodCount, allFySplitted]
  );

  const proceedWithSave = async (values: z.infer<typeof formSchema>, updatedSharedUsers?: any[]) => {
    if (!companyId || !company) return;

    setIsLoading(true);
    try {
      const { isAdminPanelCompanyLocalId } = await import("@/lib/adminPanelCompany/ledgerMode");
      if (isAdminPanelCompanyLocalId(companyId)) {
        const { patchAdminPanelCompanyProfile } = await import("@/lib/adminPanelCompany/patchCompanyProfile");
        await patchAdminPanelCompanyProfile({
          name: values.name,
          address: values.address,
          phone: values.phone,
          email: values.email,
          pan: values.pan,
        });
        const existingLocal = await getLocalCompanyById(companyId);
        if (existingLocal) {
          await upsertLocalCompany({
            ...existingLocal,
            id: companyId,
            name: values.name,
            address: values.address,
            phone: values.phone,
            email: values.email,
            pan: values.pan,
          });
        }
        reloadLocalCompanyRegistry();
        toast({
          title: "Admin Panel Company saved",
          description: "Profile updated in admin_panel_companies cloud tenant.",
        });
        setIsLoading(false);
        return;
      }
      let skipGenericSuccessToast = false;
      const localOnly = isLocalOnlyMode();
      const companyRef = doc(firestore, "companies", companyId);
      const deviceLocalCo = isOfflineCompanyStorage(company);

      if (addCompanyUserEnabled && !deviceLocalCo) {
        const email = (values.companyUserEmail || "").trim();
        const name = (values.companyUserName || "").trim();
        const password = (values.companyUserPassword || "").trim();
        const role = (values.companyUserRole || "manager").trim().toLowerCase();
        if (email && name) {
          const preSnap = await getDoc(companyRef);
          if (!preSnap.exists()) {
            throw new Error("company_not_on_server");
          }
          const preData = preSnap.data();
          const currentSharedWith = (preData.sharedWith || []) as Array<{
            email?: string;
            name?: string;
            role?: string;
            password?: string | null;
            uid?: string | null;
          }>;
          const emailNorm = email.toLowerCase().trim();
          const existingIdx = currentSharedWith.findIndex(
            (u) => String(u.email || "").toLowerCase().trim() === emailNorm
          );

          if (existingIdx >= 0) {
            const existing = currentSharedWith[existingIdx];
            const nextPassword = password.trim()
              ? password
              : (existing.password != null && existing.password !== ""
                  ? existing.password
                  : null);
            let sharedUid: string | null = (existing.uid as string | null) ?? null;
            if (!sharedUid) {
              try {
                const userSnap = await getDocs(query(collection(firestore, "users"), where("email", "==", email)));
                const first = userSnap.docs[0];
                sharedUid = (first?.data()?.uid as string) || first?.id || null;
              } catch {
                /* uid optional */
              }
            }
            const updatedSharedWith = [...currentSharedWith];
            updatedSharedWith[existingIdx] = {
              ...existing,
              name,
              email: existing.email || email,
              uid: sharedUid,
              role,
              password: nextPassword,
            };
            await updateCompanyRootFirestore(companyId, {
              sharedWith: updatedSharedWith,
              updatedAt: serverTimestamp(),
            });
          } else {
            if (!password.trim()) {
              throw new Error("password_required_new_invite");
            }
            let sharedUid: string | null = null;
            try {
              const userSnap = await getDocs(query(collection(firestore, "users"), where("email", "==", email)));
              const first = userSnap.docs[0];
              sharedUid = (first?.data()?.uid as string) || first?.id || null;
            } catch {
              /* uid optional */
            }
            const sharedEmailLower = String(email || "").trim().toLowerCase();
            await updateCompanyRootFirestore(companyId, {
              sharedWith: arrayUnion({
                name,
                email,
                uid: sharedUid,
                role,
                password: password || null,
              }),
              sharedWithEmails: arrayUnion(sharedEmailLower),
              sharedWithEmailsLower: arrayUnion(sharedEmailLower),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }
      
      let logoUrl: string | null = company.logoUrl || null;
      
      // Handle logo removal
      if (removeLogo && company.logoUrl) {
        if (!deviceLocalCo && /^https?:\/\//i.test(String(company.logoUrl))) {
          await tryDeleteStorageFileByUrl(String(company.logoUrl));
        }
        logoUrl = null;
      }

      // Handle logo upload (only when plan allows avatar)
      if (fileToUpload && user && canAddAvatar) {
        if (deviceLocalCo) {
          // Local + Google Drive: `local:` pending — Firebase Storage nahi.
          const id = generateLocalFileId();
          await putPendingFile({
            id,
            blob: fileToUpload.file,
            contentType: fileToUpload.file.type || "image/jpeg",
            docPath: `companies/${companyId}/parties/${companyId}`,
            field: "logoUrl",
            storagePathPrefix: `companies/${companyId}/company-files/logo`,
            fileName: fileToUpload.file.name,
          });
          logoUrl = `${LOCAL_FILE_PREFIX}${id}`;
        } else {
          if (company.logoUrl && !removeLogo && /^https?:\/\//i.test(String(company.logoUrl))) {
            await tryDeleteStorageFileByUrl(String(company.logoUrl));
          }
          logoUrl = await uploadCompanyLogo(companyId, values.name || company.name, fileToUpload.file);
        }
      }
      
      const currencyRow = getDefaultCurrencyForCountry(values.billingCurrencyCountry);
      const updateData: Record<string, any> = {
          name: values.name,
          address: values.address,
          phone: values.phone,
          email: values.email,
          pan: values.pan,
          country: values.country,
          currencyCode: currencyRow.currencyCode,
          currencySymbol: currencyRow.symbol,
          logoUrl: logoUrl,
          fiscalYearStart: values.fiscalYearStart || null,
          fiscalYearEnd: values.fiscalYearEnd || null,
          // Persist admin username for offline access when internet is unavailable.
          adminUsername: (values.adminUsername || "").trim() || null,
      };
      
      // Set default date system based on country
      if (values.country !== "Nepal") {
        localStorage.setItem("dateSystem", "AD");
      }

      // Online protect / change: naya password typed ho to save; khali = purana rehne do (auto-clear nahi).
      if (values.password && String(values.password).trim()) {
        updateData.password = String(values.password).trim();
      }

      // Firebase / online company: optional Firestore mirror encryption.
      if (!deviceLocalCo) {
        if (encryptCompanyEnabled) {
          updateData.encryptServerBackup = true;
          updateData.encryptServerBackupSalt =
            String((company as Record<string, unknown>).encryptServerBackupSalt || "").trim() ||
            generateEncryptServerBackupSaltBase64();
        } else {
          updateData.encryptServerBackup = false;
          if (!localOnly) {
            updateData.encryptServerBackupSalt = deleteField();
          }
        }
      }
      
      if (updatedSharedUsers) {
        updateData.sharedWith = updatedSharedUsers;
      }
      
      // Device-local companies live in SQLite; web is not always `isLocalOnlyMode()` but must not `updateDoc` Firestore.
      if (localOnly || deviceLocalCo) {
        const existingLocal = await getLocalCompanyById(companyId, { includeDeleted: true });
        if (!existingLocal) throw new Error("Local company not found");
        // Company users SQLite row me `localCompanyUsers` — Node local API ki zarurat nahi (baad me sync optional).
        let nextUsers = parseLocalCompanyUserRows((existingLocal as { localCompanyUsers?: unknown }).localCompanyUsers);

        {
          const adminUsername = (values.adminUsername || "").trim();
          const adminPassword = (values.password || "").trim() || (company.password || "");
          if (adminUsername && adminPassword) {
            nextUsers = upsertUserInList(nextUsers, {
              username: adminUsername,
              displayName: "Admin",
              role: "manager",
              password: adminPassword,
            });
          }
        }

        if (addCompanyUserEnabled && deviceLocalCo) {
          const usersToCreate: LocalCompanyUserDraft[] = [...queuedCompanyUsers];
          const currentName = (values.companyUserName || "").trim();
          const currentUsername = (values.companyUserUsername || currentName || "").trim();
          const currentPassword = (values.companyUserPassword || "").trim();
          if (currentName && currentUsername && currentPassword) {
            usersToCreate.push({
              name: currentName,
              username: currentUsername,
              role: (values.companyUserRole || "manager").trim().toLowerCase(),
              password: currentPassword,
            });
          }
          for (const localUser of usersToCreate) {
            nextUsers = upsertUserInList(nextUsers, {
              username: localUser.username,
              displayName: localUser.name,
              role: localUser.role,
              password: localUser.password,
            });
          }
        }

        const companyLinkedToFirestore =
          String(company.storageOption || "local").toLowerCase() === "firebase" ||
          String(company.syncPolicy || "").toLowerCase() === "online";
        if (companyLinkedToFirestore) {
          try {
            const swSnap = await getDoc(companyRef);
            if (swSnap.exists()) {
              const sw = (swSnap.data().sharedWith || []) as any[];
              nextUsers = mergeSharedWithIntoLocalCompanyUsers(nextUsers, sw);
            }
          } catch {
            /* ignore */
          }
        }

        const localUpdatePayload = { ...updateData };
        if (!encryptCompanyEnabled) {
          delete localUpdatePayload.encryptServerBackupSalt;
        }
        await upsertLocalCompany({
          ...(existingLocal as any),
          ...localUpdatePayload,
          id: companyId,
          localCompanyUsers: nextUsers,
          fiscalYearStart: values.fiscalYearStart ? values.fiscalYearStart.toISOString() : null,
          fiscalYearEnd: values.fiscalYearEnd ? values.fiscalYearEnd.toISOString() : null,
          updatedAt: Date.now(),
        });
        // Company cloud pe link hai (`storageOption: firebase`) — Firestore root bhi update karo; warna app naya naam dikhaye, console purana
        if (companyLinkedToFirestore) {
          const firestoreMirrorPayload: Record<string, unknown> = { ...updateData };
          if (!encryptCompanyEnabled) {
            firestoreMirrorPayload.encryptServerBackupSalt = deleteField();
          }
          try {
            await updateCompanyRootFirestore(companyId, {
              ...firestoreMirrorPayload,
              updatedAt: serverTimestamp(),
            });
          } catch (mirrorErr) {
            console.warn("[EditCompany] Firestore mirror update failed (local-first)", mirrorErr);
            skipGenericSuccessToast = true;
            toast({
              variant: "destructive",
              title: "Saved on this device only",
              description:
                "Cloud copy could not be updated. Check internet and try again so Firebase shows the new name.",
            });
          }
        }
        // Local users list SQLite me update — selector/registry dubara (poori page refresh nahi).
        reloadLocalCompanyRegistry();
        triggerSync();
        setExistingLocalUsers(localCompanyUsersToPublicList(nextUsers));
      } else {
        await updateCompanyRootFirestore(companyId, updateData);
        // `companies` SQLite row: sirf Firestore update se purana naam reh jata tha (restore ke baad rename → UI naya, DB inspector purana)
        try {
          const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
          if (localRow) {
            const fiscalStartIso = values.fiscalYearStart ? values.fiscalYearStart.toISOString() : null;
            const fiscalEndIso = values.fiscalYearEnd ? values.fiscalYearEnd.toISOString() : null;
            await upsertLocalCompany({
              ...(localRow as Record<string, unknown>),
              name: values.name,
              address: values.address ?? "",
              phone: values.phone ?? "",
              email: values.email ?? "",
              pan: values.pan ?? "",
              country: values.country ?? "",
              currencyCode: currencyRow.currencyCode,
              currencySymbol: currencyRow.symbol,
              logoUrl,
              fiscalYearStart: fiscalStartIso,
              fiscalYearEnd: fiscalEndIso,
              adminUsername: (values.adminUsername || "").trim() || null,
              id: companyId,
              updatedAt: Date.now(),
              ...(values.password && String(values.password).trim()
                ? { password: String(values.password).trim() }
                : {}),
              ...(encryptCompanyEnabled
                ? {
                    encryptServerBackup: true,
                    encryptServerBackupSalt:
                      String((company as Record<string, unknown>).encryptServerBackupSalt || "").trim() ||
                      generateEncryptServerBackupSaltBase64(),
                  }
                : { encryptServerBackup: false }),
            } as unknown as Parameters<typeof upsertLocalCompany>[0]);
            await flushBrowserDbToIndexedDB();
          }
        } catch (mirrorErr) {
          console.warn("[EditCompany] Local SQLite mirror after Firestore update failed", mirrorErr);
        }
        reloadLocalCompanyRegistry();
        triggerSync();
      }
      
      // Clear file upload state after successful save
      if (fileToUpload?.preview) {
        URL.revokeObjectURL(fileToUpload.preview);
      }
      setFileToUpload(null);
      setRemoveLogo(false);
      
      if (localOnly && !deviceLocalCo && encryptCompanyEnabled) {
        const au = (values.adminUsername || "").trim();
        const pw = (values.password || "").trim() || (company.password || "");
        if (au && pw) {
          void setBackupEncryptionSessionFromLogin(companyId, au, pw);
        }
      }

      if (!skipGenericSuccessToast) {
        toast({
          title: "Company Updated!",
          description: "Your company details have been successfully updated.",
        });
      }
      onSaved?.();
      if (addCompanyUserEnabled) {
        setAddCompanyUserEnabled(false);
        setQueuedCompanyUsers([]);
        form.setValue("companyUserName", "");
        form.setValue("companyUserUsername", "");
        form.setValue("companyUserEmail", "");
        form.setValue("companyUserRole", "manager");
        form.setValue("companyUserPassword", "");
      }
      form.reset({ ...form.getValues(), password: "", confirmPassword: "", confirmPasswordToSave: "" });

    } catch (error) {
      console.error("Error updating company:", error);
      const code = (error as { code?: string })?.code;
      const errMsg = error instanceof Error ? error.message : "";
      const msg =
        error instanceof Error && error.message === "company_not_on_server"
          ? "This company is not on the server yet. Connect and sync, then try again."
          : error instanceof Error && error.message === "password_required_new_invite"
            ? "Set a password for a new invite."
            : errMsg === "local_company_storage"
              ? "This company uses device storage and Google Drive sync — not Firebase Storage. Enable cloud sync in company settings, or save without changing the logo."
              : code === "storage/unauthorized" || code === "storage/unauthenticated"
                ? "Logo upload failed: cloud storage permission denied. Sign in again, or deploy the latest Firebase storage rules."
                : isCompanyNotFoundError(error)
                  ? COMPANY_NOT_SYNCED_MESSAGE
                  : code === "permission-denied"
                    ? "Firestore permission denied — deploy firestore.rules, or ask the company owner to save."
                    : "Failed to update company details. Please try again.";
      toast({
        variant: "destructive",
        title: "Error",
        description: msg,
      });
    } finally {
      setIsLoading(false);
      setPasswordConfirmation(null);
    }
  };


  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (readOnly) return;
    if (!companyId || !company) {
      toast({ variant: "destructive", title: "Error", description: "No company is selected." });
      return;
    }
    
    // Protect company: purana password set ho to save/change/disable ke liye confirm zaroor.
    const hadProtectPassword = !!(company.password && String(company.password).trim());
    if (hadProtectPassword) {
      const entered = String(values.confirmPasswordToSave ?? "").trim();
      const expected = String(company.password).trim();
      if (entered !== expected) {
        form.setError(
          "confirmPasswordToSave",
          {
            message:
              entered.length === 0
                ? "Scroll down and enter your current company password in “Confirm Password to Save”, then save again."
                : "That password does not match your current company password.",
          }
        );
        return;
      }
    }
    // Pehli baar Protect ON — password + confirm zaroori (web / exe / apk Edit tab).
    if (passwordEnabled && !hadProtectPassword) {
      const newPw = (values.password || "").trim();
      if (!newPw) {
        toast({
          variant: "destructive",
          title: "Password required",
          description: "Turn on protection and enter a password (and confirm it) before saving.",
        });
        return;
      }
    }
    if (addCompanyUserEnabled) {
      const deviceLocalCo = isOfflineCompanyStorage(company);
      if (deviceLocalCo) {
        if (!isLocalOnlyMode()) {
          toast({
            variant: "destructive",
            title: "Device-local companies only",
            description: "Adding device login users here works in local-first mode for offline storage companies.",
          });
          return;
        }
        const hasName = (values.companyUserName || "").trim().length > 1;
        const loginId = (values.companyUserUsername || values.companyUserName || "").trim();
        const hasPassword = (values.companyUserPassword || "").trim().length > 0;
        const currentDraftComplete = hasName && loginId.length > 0 && hasPassword;
        if (!currentDraftComplete && queuedCompanyUsers.length === 0) {
          toast({
            variant: "destructive",
            title: "Company user details required",
            description: "Add at least one company user (current draft or queued list).",
          });
          return;
        }
      } else {
        const email = (values.companyUserEmail || "").trim();
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const hasName = (values.companyUserName || "").trim().length >= 2;
        const hasPassword = (values.companyUserPassword || "").trim().length > 0;
        const alreadyShared = (company.sharedWithEmails || []).some(
          (e) => String(e || "").toLowerCase().trim() === email.toLowerCase()
        );
        if (!emailOk || !hasName) {
          toast({
            variant: "destructive",
            title: "Online invite incomplete",
            description: "Enter a valid email and company user name (2+ characters).",
          });
          return;
        }
        if (!alreadyShared && !hasPassword) {
          toast({
            variant: "destructive",
            title: "Password required",
            description: "New invites need a password. If this email is already shared, leave password blank to keep the current one or type a new password.",
          });
          return;
        }
      }
    }
    if (isLocalOnlyMode() && !deviceLocalCoForUi && encryptCompanyEnabled) {
      const adminUsername = (values.adminUsername || "").trim();
      const adminPw = (values.password || "").trim() || (company.password || "");
      if (!adminUsername || !adminPw) {
        toast({
          variant: "destructive",
          title: "Admin credentials required",
          description:
            "When encryption is on, set Admin username and password (or keep your existing company password).",
        });
        return;
      }
    }
    
    // Naya company password: shared users bina password ke ho to confirm dialog.
    if (values.password && String(values.password).trim()) {
        const usersToUpdate = (company.sharedWith || []).filter(u => !shareEntryHasPassword(u));
        if (usersToUpdate.length > 0) {
            setPasswordConfirmation({ newPasswordValue: values.password, usersToUpdate });
            return;
        }
    }
    
    proceedWithSave(values);
  }
  
  const handleDelete = async () => {
    if (!companyId || !company) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    setIsLoading(true);
    try {
      const deviceLocalCo = isOfflineCompanyStorage(company);
      const existingLocal = await getLocalCompanyById(companyId, { includeDeleted: true });
      if (!deviceLocalCo) {
        await updateCompanyRootFirestore(companyId, {
          isDeleted: true,
          deletedAt: serverTimestamp(),
        });
      }
      if (existingLocal) {
        await upsertLocalCompany({
          ...existingLocal,
          id: companyId,
          isDeleted: true,
          deletedAt: Date.now(),
        });
      } else if (deviceLocalCo) {
        throw new Error("Local company not found");
      }
      toast({ title: "Company Moved to Bin", description: `"${company?.name}" has been moved.` });
      reloadLocalCompanyRegistry();
      clearCompanyId();
    } catch (error) {
      console.error("Error moving to bin:", error);
      toast({ variant: "destructive", title: "Error", description: isCompanyNotFoundError(error) ? COMPANY_NOT_SYNCED_MESSAGE : "Failed to move company to bin." });
    } finally {
      setIsLoading(false);
      setIsDeleteDialogOpen(false);
    }
  };

  const deviceLocalCoForUi = company ? isOfflineCompanyStorage(company) : true;
  // Online cloud company: Protect / Change password UI (local company apna login block use karti hai).
  const hasProtectPassword = !!(company?.password && String(company.password).trim());
  const showAddUserCard = !!company;

  if (companyLoading) {
    return (
        <div className="space-y-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
             <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-1/4 ml-auto" />
        </div>
    );
  }

  const isAdminPanelCompanyForm = Boolean(companyId && isAdminPanelCompanyLocalId(companyId));
  const adminPanelStorageHint = isAdminPanelCompanyForm ? adminPanelCompanyStorageLabel() : null;

  return (
    <div className="min-w-0">
        <Form {...form}>
        <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0 space-y-6 disabled:opacity-100">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {adminPanelStorageHint ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Admin Panel Company data</span>
                {" — "}
                Profile saves to{" "}
                <span className="font-mono text-[11px] text-foreground">{adminPanelStorageHint}</span>
                ; this device keeps a SQLite mirror for the normal app UI.
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                control={form.control}
                name="name"
                render={({ field }: any) => (
                    <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                        <Input placeholder="e.g., Innovate Inc." {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                {isInterCompanySystemEnabled() ? <CompanyInterCompanyCodeField mode="edit" /> : null}
                <FormField
                control={form.control}
                name="pan"
                render={({ field }: any) => (
                    <FormItem>
                    <FormLabel>PAN/VAT No.</FormLabel>
                    <FormControl>
                        <Input placeholder="Company PAN/VAT" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            </div>
            <FormField
            control={form.control}
            name="address"
            render={({ field }: any) => (
                <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                    <Textarea placeholder="Company's full address" {...field} />
                </FormControl>
                <FormMessage />
                </FormItem>
            )}
            />

            <div className="grid grid-cols-2 gap-4">
                <FormField
                control={form.control}
                name="phone"
                render={({ field }: any) => (
                    <FormItem>
                    <FormLabel>Mobile No.</FormLabel>
                    <FormControl>
                        <Input placeholder="Company phone number" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="email"
                render={({ field }: any) => (
                    <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                        <Input placeholder="Company email address" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormItem>
                <FormLabel>Company Logo (Optional)</FormLabel>
                <div className="flex items-center gap-2 sm:gap-4">
                  {!canAddAvatar ? (
                    company?.logoUrl && !removeLogo ? (
                      <img
                        src={company.logoUrl}
                        alt="Company logo"
                        className="w-16 h-16 sm:w-24 sm:h-24 object-cover rounded-lg border"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Upgrade plan to add or change company logo.{" "}
                        <Link href="/billing" className="text-primary underline font-medium hover:no-underline">
                          Click here to upgrade
                        </Link>
                      </p>
                    )
                  ) : fileToUpload ? (
                    <FilePreview
                      file={fileToUpload.file}
                      onRemove={removeFile}
                      isCompressing={false}
                      compressionResult={null}
                      size={64}
                    />
                  ) : company?.logoUrl && !removeLogo ? (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <img 
                          src={company.logoUrl} 
                          alt="Company logo" 
                          className="w-16 h-16 sm:w-24 sm:h-24 object-cover rounded-lg border"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => {
                            setRemoveLogo(true);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0"
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        Change
                      </Button>
                      <Input 
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        multiple={false}
                      />
                    </div>
                  ) : (
                    <FormControl>
                      <div
                        {...logoDropZoneProps}
                        className={cn(
                          "relative w-16 h-16 sm:w-24 sm:h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer",
                          logoDragOver && "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 sm:h-6 sm:w-6" />
                        <span className="text-[10px] sm:text-xs mt-0.5 sm:mt-1">Add Logo</span>
                        <Input 
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          multiple={false}
                        />
                      </div>
                    </FormControl>
                  )}
                </div>
              </FormItem>

              <FormField
                  control={form.control}
                  name="country"
                  render={({ field }: any) => (
                      <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                          <Combobox
                              options={countries.map(country => ({ value: country, label: country }))}
                              value={field.value}
                              onChange={(value) => {
                                field.onChange(value);
                                if (!currencyPickedManuallyRef.current) {
                                  form.setValue("billingCurrencyCountry", value, { shouldDirty: true });
                                }
                              }}
                              placeholder="Select country"
                          />
                      </FormControl>
                      <FormMessage />
                      </FormItem>
                  )}
              />
              <FormField
                  control={form.control}
                  name="billingCurrencyCountry"
                  render={({ field }: any) => (
                      <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <FormControl>
                          <CountryCurrencyCombobox
                              value={field.value}
                              onChange={(value) => {
                                currencyPickedManuallyRef.current = true;
                                field.onChange(value);
                              }}
                              placeholder="Search country or currency"
                              popoverModal
                          />
                      </FormControl>
                      <FormDescription>
                        Default from country; search by country name. Used for amounts and billing display.
                      </FormDescription>
                      <FormMessage />
                      </FormItem>
                  )}
              />
            </div>

            {/* Add New Company jaisi jagah (currency ke baad): web / exe / apk — Edit tab par hamesha dikhe. */}
            <div className="space-y-4 rounded-md border border-black bg-muted/25 p-3 dark:border-black dark:bg-muted/15">
              <FormItem>
                <div className="flex items-center justify-between rounded-md border border-black p-3">
                  <div>
                    <FormLabel>
                      {hasProtectPassword ? "Change Company Password" : "Protect Company With Password"}
                    </FormLabel>
                    <FormDescription>
                      {hasProtectPassword
                        ? "Enter a new password below to change protection. Confirm current password before Save."
                        : "Turn on to require password when opening this company."}
                    </FormDescription>
                  </div>
                  {!hasProtectPassword && (
                    <input
                      type="checkbox"
                      checked={passwordEnabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setPasswordEnabled(enabled);
                        if (!enabled) {
                          form.setValue("password", "");
                          form.setValue("confirmPassword", "");
                        }
                      }}
                      className="h-4 w-4 rounded border-input"
                    />
                  )}
                </div>
              </FormItem>
              {(hasProtectPassword || passwordEnabled) && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>{hasProtectPassword ? "New Password" : "Password"}</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                type={showNewPassword ? "text" : "password"}
                                placeholder={hasProtectPassword ? "Enter new password" : "Set password"}
                                autoComplete="new-password"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                            >
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="Confirm password"
                                autoComplete="new-password"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            >
                              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {deviceLocalCoForUi && (
                    <FormField
                      control={form.control}
                      name="adminUsername"
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>Username (Company Login)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., admin_user" {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormDescription>
                            Open this company with this username and the password above.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}
            </div>

            {!deviceLocalCoForUi && isLocalOnlyMode() && (
            <div className="space-y-4 rounded-md border border-black bg-muted/25 p-3 dark:border-black dark:bg-muted/15">
                {/* Firebase / online company: Firestore mirror backup encrypt. */}
                <FormItem>
                  <div className="flex items-center justify-between rounded-md border border-black p-3">
                    <div>
                      <FormLabel>Encrypt company (server backup)</FormLabel>
                      <FormDescription>
                        When enabled, data synced to Firestore is encrypted (same folder paths). Unlock uses the
                        username and password you use to open this company — no separate passphrase. Log in again after
                        enabling if sync does not run.
                      </FormDescription>
                    </div>
                    <input
                      type="checkbox"
                      checked={encryptCompanyEnabled}
                      onChange={(e) => setEncryptCompanyEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                  </div>
                </FormItem>
            </div>
            )}

            {showAddUserCard && (
            <div className="space-y-4 rounded-md border border-black bg-muted/25 p-3 dark:border-black dark:bg-muted/15">
              <FormItem>
                <div className="flex items-center justify-between rounded-md border border-black p-3">
                  <div>
                    <FormLabel>Add Company User</FormLabel>
                    <FormDescription>
                      {deviceLocalCoForUi
                        ? "Device login users for this offline company. Role applies to permissions on this device."
                        : "Invite by email for online access. Same name and role appear under Manage Sharing (role is not changed there)."}
                    </FormDescription>
                  </div>
                  <input
                    type="checkbox"
                    checked={addCompanyUserEnabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setAddCompanyUserEnabled(enabled);
                      if (!enabled) {
                        setQueuedCompanyUsers([]);
                        form.setValue("companyUserName", "");
                        form.setValue("companyUserUsername", "");
                        form.setValue("companyUserEmail", "");
                        form.setValue("companyUserRole", "manager");
                        form.setValue("companyUserPassword", "");
                      }
                    }}
                    className="h-4 w-4 rounded border-input"
                  />
                </div>
              </FormItem>

              {deviceLocalCoForUi && addCompanyUserEnabled && (
                <>
                  <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                    <strong className="text-foreground">Local company users</strong> log in with username + password when
                    opening this company (Select company screen). If you share via{" "}
                    <strong>local server</strong>, give them the same login; the gate connection is token-free.
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={() => setAddPersonOpen(true)}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Person
                    </Button>
                  </div>
                </>
              )}

              {addCompanyUserEnabled && deviceLocalCoForUi && queuedCompanyUsers.length > 0 && (
                <div className="rounded-md border border-black p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Queued Users ({queuedCompanyUsers.length})</p>
                  <div className="space-y-1">
                    {queuedCompanyUsers.map((u, index) => (
                      <div key={`${u.username}-${index}`} className="flex items-center justify-between text-xs">
                        <span>{u.name} ({u.username}) - {u.role}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          onClick={() => setQueuedCompanyUsers((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {addCompanyUserEnabled && !deviceLocalCoForUi && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {!deviceLocalCoForUi && (
                    <FormField
                      control={form.control}
                      name="companyUserEmail"
                      render={({ field }: any) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Email (online share)</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="user@example.com"
                              autoComplete="off"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>Must match the account they use to sign in. Shown in Manage Sharing.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="companyUserName"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Company user name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Sales User" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyUserUsername"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>
                          {deviceLocalCoForUi ? "Login username" : "Share online — login username"}
                        </FormLabel>
                        <FormControl>
                          {deviceLocalCoForUi ? (
                            <Input
                              placeholder="e.g. sales_user"
                              autoComplete="off"
                              {...field}
                              value={field.value ?? ""}
                            />
                          ) : (
                            <Input
                              readOnly
                              disabled
                              className="bg-muted cursor-not-allowed"
                              placeholder="Same as company user name"
                              {...field}
                              value={field.value ?? ""}
                            />
                          )}
                        </FormControl>
                        <FormDescription>
                          {deviceLocalCoForUi
                            ? "Used when this user opens the company on this device or via your local server."
                            : "Automatically the same as company user name."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyUserRole"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <FormControl>
                          <select
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={field.value || "manager"}
                            onChange={(e) => field.onChange(e.target.value)}
                          >
                            <option value="manager">Manager</option>
                            <option value="editor">Editor</option>
                            <option value="accountant">Accountant</option>
                            <option value="data-entry">Data Entry</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyUserPassword"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              type={showCompanyUserPassword ? "text" : "password"}
                              placeholder="Set user password"
                              autoComplete="new-password"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                            onClick={() => setShowCompanyUserPassword((s) => !s)}
                          >
                            {showCompanyUserPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        {!deviceLocalCoForUi ? (
                          <FormDescription>
                            New invite: password required. Email already on Manage Sharing: leave blank to keep their
                            password or enter a new one.
                          </FormDescription>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {deviceLocalCoForUi && (
                    <div className="sm:col-span-2 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const name = (form.getValues("companyUserName") || "").trim();
                          const username = (form.getValues("companyUserUsername") || name || "").trim();
                          const role = (form.getValues("companyUserRole") || "manager").trim().toLowerCase();
                          const password = (form.getValues("companyUserPassword") || "").trim();
                          if (!name || !username || !password) {
                            toast({
                              variant: "destructive",
                              title: "User details required",
                              description: "Fill name and password before adding another user.",
                            });
                            return;
                          }
                          setQueuedCompanyUsers((prev) => [...prev, { name, username, role, password }]);
                          form.setValue("companyUserName", "");
                          form.setValue("companyUserUsername", "");
                          form.setValue("companyUserRole", "manager");
                          form.setValue("companyUserPassword", "");
                        }}
                      >
                        Add Another User
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            {deviceLocalCoForUi && isLocalOnlyMode() && existingLocalUsers.length > 0 && (
              <div className="rounded-md border border-black p-3">
                {/* List ke saath Edit/Remove: turant SQLite update (Save Changes zaroori nahi). */}
                <p className="text-sm font-medium mb-2">Existing Company Users ({existingLocalUsers.length})</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Use Edit or Remove for each user — changes save immediately on this device. If you remove the Admin user,
                  the company login username may stop working.
                </p>
                <div className="space-y-2">
                  {existingLocalUsers.map((u, i) => (
                    <div
                      key={`${u.id || u.username || "user"}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-black bg-muted/30 px-2 py-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {(u.displayName || u.username || "User")} ({u.username || "no-username"})
                        {u.role ? ` · ${u.role}` : ""}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={!u.id}
                          onClick={() => setLocalUserToEdit(u)}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          disabled={!u.id}
                          onClick={() => setLocalUserToRemove(u)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="grid grid-cols-2 gap-4 lg:flex-1 lg:min-w-0">
                <FormField
                  control={form.control}
                  name="fiscalYearStart"
                  render={({ field }: any) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Fiscal Year Start</FormLabel>
                      <BsDatePicker
                        valueAD={field.value}
                        onChangeAD={(d) => field.onChange(d as Date)}
                        numberOfMonths={1}
                        isRange={false}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fiscalYearEnd"
                  render={({ field }: any) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Fiscal Year End</FormLabel>
                      <BsDatePicker
                        valueAD={field.value}
                        onChangeAD={(d) => field.onChange(d as Date)}
                        numberOfMonths={1}
                        isRange={false}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="col-span-2 text-xs text-muted-foreground">
                  Suggested from country ({getFiscalYearConventionLabel(selectedCountryWatch)}). Change dates to set
                  how fiscal years divide in this company.
                </p>
              </div>

              <div className="flex flex-col gap-3 lg:w-[min(100%,18rem)] lg:shrink-0">
                <div className="flex items-start gap-2 rounded-md border border-border/80 bg-muted/30 p-3">
                  <Checkbox id="fy-auto-split-company-profile" checked disabled className="mt-0.5 shrink-0" />
                  <Label
                    htmlFor="fy-auto-split-company-profile"
                    className="cursor-default text-sm font-normal leading-snug text-muted-foreground"
                  >
                    auto split by selected date for upcoming fy
                  </Label>
                </div>
                {fyVoucherSuggestion ? (
                  <CompanyFyVoucherSuggestionCard
                    suggestion={fyVoucherSuggestion}
                    className="w-full"
                  />
                ) : null}
              </div>
            </div>

            {hasProtectPassword && (
                <>
                    <Separator />
                    <div className="space-y-4 pt-4">
                        <FormField
                            control={form.control}
                            name="confirmPasswordToSave"
                            render={({ field }: any) => (
                                <FormItem>
                                <FormLabel>Confirm Password to Save</FormLabel>
                                <div className="relative max-w-sm">
                                    <FormControl>
                                        <Input
                                          type={showConfirmPasswordToSave ? "text" : "password"}
                                          placeholder="Enter current password to authorize"
                                          autoComplete="current-password"
                                          {...field}
                                          value={field.value ?? ""}
                                        />
                                    </FormControl>
                                    <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowConfirmPasswordToSave(!showConfirmPasswordToSave)}>
                                        {showConfirmPasswordToSave ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <FormDescription>
                                  Required whenever a company password is set — without this, Save will not apply (not a server bug).
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </>
            )}


            {!readOnly && (
            <div className="flex justify-end items-center">
                <Button type="submit" disabled={isLoading || isFileProcessing} variant="default">
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>
            )}
        </form>
        </fieldset>
        </Form>

        {/* Existing local user row edit — naam / role / password (optional). */}
        <Dialog open={!!localUserToEdit} onOpenChange={(open) => !open && !editLocalSaving && setLocalUserToEdit(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit company user</DialogTitle>
              <DialogDescription>
                Login username:{" "}
                <span className="font-medium text-foreground">{localUserToEdit?.username ?? "—"}</span> — abhi sirf
                display name / role / password badal sakte ho.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-local-display">Display name</Label>
                <Input
                  id="edit-local-display"
                  value={editLocalDisplayName}
                  onChange={(e) => setEditLocalDisplayName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-local-role">Role</Label>
                <select
                  id="edit-local-role"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editLocalRole}
                  onChange={(e) => setEditLocalRole(e.target.value)}
                >
                  <option value="manager">Manager</option>
                  <option value="editor">Editor</option>
                  <option value="accountant">Accountant</option>
                  <option value="data-entry">Data Entry</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-local-pw">New password (optional)</Label>
                <Input
                  id="edit-local-pw"
                  type="password"
                  value={editLocalPassword}
                  onChange={(e) => setEditLocalPassword(e.target.value)}
                  placeholder="Khali chhodo = purana password hi rahega"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setLocalUserToEdit(null)} disabled={editLocalSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={editLocalSaving || !localUserToEdit?.id}
                onClick={() => {
                  void (async () => {
                    if (!companyId || !localUserToEdit?.id) return;
                    setEditLocalSaving(true);
                    try {
                      await updateLocalCompanyUserClient(companyId, localUserToEdit.id, {
                        displayName: editLocalDisplayName,
                        role: editLocalRole,
                        password: editLocalPassword.trim() || undefined,
                      });
                      toast({ title: "User updated", description: "Changes saved on this device." });
                      setLocalUserToEdit(null);
                      reloadLocalCompanyRegistry();
                      triggerSync();
                      await loadExistingLocalUsers();
                    } catch (e) {
                      toast({
                        variant: "destructive",
                        title: "Update failed",
                        description: e instanceof Error ? e.message : "Could not update user.",
                      });
                    } finally {
                      setEditLocalSaving(false);
                    }
                  })();
                }}
              >
                {editLocalSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!localUserToRemove} onOpenChange={(open) => !open && !removeLocalUserLoading && setLocalUserToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Company user hataayein?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium text-foreground">
                  {localUserToRemove?.displayName || localUserToRemove?.username || "User"}
                </span>{" "}
                is company par se login karna band ho jayega — sirf is device par stored data update hoga.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeLocalUserLoading}>Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={removeLocalUserLoading || !localUserToRemove?.id}
                onClick={() => {
                  void (async () => {
                    if (!companyId || !localUserToRemove?.id) return;
                    setRemoveLocalUserLoading(true);
                    try {
                      await removeLocalCompanyUserByIdClient(companyId, localUserToRemove.id);
                      toast({ title: "User removed" });
                      setLocalUserToRemove(null);
                      reloadLocalCompanyRegistry();
                      triggerSync();
                      await loadExistingLocalUsers();
                    } catch (e) {
                      toast({
                        variant: "destructive",
                        title: "Remove failed",
                        description: e instanceof Error ? e.message : "Could not remove user.",
                      });
                    } finally {
                      setRemoveLocalUserLoading(false);
                    }
                  })();
                }}
              >
                {removeLocalUserLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <PlServerShareUserDialog
          companyId={companyId}
          companyName={company?.name}
          open={addPersonOpen}
          onOpenChange={setAddPersonOpen}
          onUserAdded={() => {
            reloadLocalCompanyRegistry();
            triggerSync();
            void loadExistingLocalUsers();
          }}
        />

        {passwordConfirmation && (
            <PasswordUpdateConfirmationDialog
                isOpen={!!passwordConfirmation}
                onOpenChange={() => setPasswordConfirmation(null)}
                newPassword={passwordConfirmation.newPasswordValue}
                affectedUsers={passwordConfirmation.usersToUpdate}
                onConfirm={async (updatedUsers) => {
                    await proceedWithSave(form.getValues(), updatedUsers);
                    setPasswordConfirmation(null);
                }}
            />
        )}
    </div>
  );
}
