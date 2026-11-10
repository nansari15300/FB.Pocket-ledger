
"use client";

import { setDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
  MutableRefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Checkbox } from "../ui/checkbox";
import { CalendarIcon, Loader2, PlusCircle, Trash2, Printer, Upload, FileText, ArrowDownUp } from "lucide-react";
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
import { usePersistedResizableDialogSize } from "@/lib/usePersistedResizableDialogSize";
import { ResizableDialogEdgeHandles } from "@/components/ui/ResizableDialogEdgeHandles";
import { MasterEntityDialogDragRibbon } from "@/components/ui/MasterEntityDialogDragRibbon";
import { format } from "date-fns";
import { toast as sonnerToast } from "sonner";

import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { useVouchers } from "@/hooks/useVouchers";
import { saveVoucher } from "@/lib/voucherActionsClient";

import { firestore } from "@/lib/plClientSession";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { collection, query, doc, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";

import type { Item, ItemGroup } from "@/components/items/types";
import type { Tax, TaxGroup } from "@/components/tax/types";

import BsDatePicker from "@/components/ui/BsDatePicker";
import { Combobox } from "../ui/combobox";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import {
  MAX_IMAGE_BYTES_BEFORE_COMPRESS,
  MAX_IMAGE_BYTES_AFTER_COMPRESS,
  MAX_IMAGE_MB_BEFORE_COMPRESS,
  MAX_IMAGE_MB_AFTER_COMPRESS,
  MAX_PDF_BYTES_BEFORE_UPLOAD,
  MAX_PDF_UPLOAD_MB,
} from "@/lib/fileUploadLimits";
import { CreateFinishedGoodForm } from "@/components/items/CreateFinishedGoodDialog";
import { CreateItemGroupDialog } from "./CreateItemGroupDialog";
import { CreateTaxDialog } from "../tax/CreateTaxDialog";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";
import { apkCloudCompanyOfflineViewOnly, apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { itemStrippedRowToCreateItemFormPatch } from "@/lib/crossCompanyMasterPrefill";
import { baseUnitConversions, collectItemUnits, computeItemUnitPrices } from "@/components/items/itemUnitPrices";
import { writeNewItemRecord } from "@/components/items/createItemSilent";
import { upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import {
  EntityOpeningBalanceNarrationField,
  EntityProfilePhotoBlock,
  EntityDocumentsBlock,
} from "@/components/common/EntityProfileDocumentsNarrationFields";
import {
  isProfileAvatarImageFile,
  isProfileDocumentFile,
  stageItemAvatarAndAttachments,
  uploadItemAvatarAndAttachmentsRemote,
} from "@/lib/entityProfileLocalFiles";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}


const unitConversionSchema = z.object({
  fromUnit: z.string().min(1, "Unit name is required"),
  toUnit: z.string().min(1, "Unit name is required"),
  conversionFactor: z.coerce.number().min(0.001, "Factor must be positive"),
});

const formSchema = z.object({
  name: z.string().min(2, { message: "Item name must be at least 2 characters." }),
  aliasName: z.string().optional(),
  type: z.enum(['item', 'service', 'finished_good']),
  hsCode: z.string().optional(),
  salePrice: z.coerce.number().min(0, "Price must be a positive number."),
  isSalePriceTaxInclusive: z.boolean(),
  purchasePrice: z.coerce.number().min(0, "Price must be a positive number."),
  isPurchasePriceTaxInclusive: z.boolean(),
  openingBalance: z.coerce.number().min(0, "Opening stock must be a positive number."),
  openingBalanceUnit: z.string().optional(),
  openingBalanceTaxId: z.string().optional(),
  openingBalanceDate: z.date().optional(),
  openingBalanceRate: z.coerce.number().min(0),
  isOpeningBalanceTaxInclusive: z.boolean().optional(),
  groupId: z.string().optional(),
  unitConversions: z.array(unitConversionSchema).optional(),
  salePriceUnit: z.string().optional(),
  purchasePriceUnit: z.string().optional(),
  saleTaxId: z.string().optional(),
  purchaseTaxId: z.string().optional(),
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

function getInitialFormValues(itemType: 'item' | 'service' | 'finished_good' = 'item'): z.infer<typeof formSchema> {
    return {
        name: "", aliasName: "",
        type: itemType,
        hsCode: "",
        salePrice: 0,
        isSalePriceTaxInclusive: false,
        purchasePrice: 0,
        isPurchasePriceTaxInclusive: false,
        openingBalance: 0,
        openingBalanceRate: 0,
        isOpeningBalanceTaxInclusive: false,
        groupId: "",
        unitConversions: [{ fromUnit: "", toUnit: "", conversionFactor: 1 }],
        openingBalanceUnit: "",
        openingBalanceTaxId: "",
        openingBalanceDate: undefined,
        salePriceUnit: "",
        purchasePriceUnit: "",
        saleTaxId: "",
        purchaseTaxId: "",
        openingBalanceNarration: "",
    };
}


export function CreateItemDialog({ 
  onItemCreated, 
  children,
  isOpen: parentIsOpen,
  onOpenChange: parentOnOpenChange,
  defaultType,
}: { 
  onItemCreated?: (newId: string) => void, 
  children?: React.ReactNode,
  isOpen?: boolean,
  onOpenChange?: (open: boolean) => void,
  defaultType?: 'item' | 'service' | 'finished_good',
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const navigatorOnline = useNavigatorOnline();
  const localSqlMirror = useMemo(() => apkEntityWriteUsesLocalSqliteMirror(company), [company]);
  /** APK cloud Firebase: lists mirror SQLite — vouchers hook pe depend kam (`apkCloudEntityMasterReadFromSqliteMirror`). */
  const sqliteListsOnlyNoSnapshot = useMemo(
    () => localSqlMirror || apkCloudEntityMasterReadFromSqliteMirror(company),
    [localSqlMirror, company]
  );
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );
  const { canAddAvatar, canAddFileImagePdf } = usePermissions();
  /** Documents: plan PDF/images — avatar se alag */
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const { dateSystem, formatDate } = useDate();
  const { processedItemGroups, processedTaxes } = useVouchers();
  const processedItemGroupsRef = useRef(processedItemGroups);
  processedItemGroupsRef.current = processedItemGroups;
  const processedTaxesRef = useRef(processedTaxes);
  processedTaxesRef.current = processedTaxes;
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  const [prefillTaxName, setPrefillTaxName] = useState("");
  const [taxRowIndex, setTaxRowIndex] = useState<number | null>(null);
  /** List thumbnail = `fileUrls[0]`; baaki opening/statement attachments */
  const [profileFile, setProfileFile] = useState<File | string | null>(null);
  const [docSlots, setDocSlots] = useState<(File | string)[]>([]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const isMobile = useIsMobile();
  const isOpen = parentIsOpen !== undefined ? parentIsOpen : false;
  const {
    size: dialogSize,
    position: dialogPosition,
    handleResizeStart,
    handleDragStart,
    resizable: dialogResizable,
  } = usePersistedResizableDialogSize(isOpen, !isMobile);
  const setIsOpen = parentOnOpenChange !== undefined ? parentOnOpenChange : () => {};
  
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const formValuesBackupRef = useRef<z.infer<typeof formSchema> | null>(null);
  const taxFieldToApplyRef = useRef<"purchaseTaxId" | "saleTaxId" | "openingBalanceTaxId" | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as Resolver<z.infer<typeof formSchema>>,
    defaultValues: getInitialFormValues(defaultType),
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);

  const itemType = form.watch('type');
  const tabsInRibbon = dialogResizable;
  const itemTypeTabs = (
    <Tabs
      value={itemType}
      onValueChange={(value) => form.setValue('type', value as 'item' | 'service' | 'finished_good')}
      className={tabsInRibbon ? 'shrink-0' : 'w-full mb-4'}
    >
      <TabsList className={tabsInRibbon ? 'h-8 gap-1 rounded-full bg-white/50 p-0.5' : undefined}>
        {(['item', 'service', 'finished_good'] as const).map((t) => (
          <TabsTrigger
            key={t}
            value={t}
            className={
              tabsInRibbon
                ? 'rounded-full px-3 py-1 text-xs !shadow-none data-[state=active]:!border-transparent data-[state=active]:!bg-[#3f5fc4] data-[state=active]:!text-white'
                : undefined
            }
          >
            {t === 'item' ? 'Item' : t === 'service' ? 'Service' : 'Finished Good'}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  
  useEffect(() => {
    const handlePrefill = (event: CustomEvent) => {
        const detail = event.detail;
        // Handle both string (legacy) and object formats
        if (typeof detail === 'string') {
          form.setValue('name', detail);
          form.setValue('type', defaultType || 'item');
        } else if (detail && typeof detail === 'object') {
          form.setValue('name', detail.name || '');
          form.setValue('type', detail.type || defaultType || 'item');
        }
    };
    // @ts-ignore
    document.addEventListener('prefill-create-item-name', handlePrefill);
    return () => {
        // @ts-ignore
      document.removeEventListener('prefill-create-item-name', handlePrefill);
    };
  }, [form, defaultType]);
  
  /** Save & Copy To: source company ki poori item row se form bharo (Payment In party-full jaisa). */
  useEffect(() => {
    const handlePrefillRow = (event: Event) => {
      const ce = event as CustomEvent<{ rowPayload?: Record<string, unknown>; type?: "item" | "service" | "finished_good" }>;
      const row = ce.detail?.rowPayload;
      if (!row || typeof row !== "object") return;
      const t = (ce.detail?.type || defaultType || "item") as "item" | "service" | "finished_good";
      const patch = itemStrippedRowToCreateItemFormPatch(row, t);
      const resolvedType = (patch.type as typeof t) || t;
      const base = getInitialFormValues(resolvedType);
      const detail = event as CustomEvent<{ preserveGroupId?: boolean; ocrGroups?: Array<{ id: string; name?: string; parentId?: string | null }> }>;
      const preserveGroupId = detail.detail?.preserveGroupId === true;
      const groupId = preserveGroupId && typeof row.groupId === "string" ? row.groupId.trim() : "";
      const unitConversions = baseUnitConversions(
        String(row.purchasePriceUnit || row.salePriceUnit || ""),
        Array.isArray((patch as { unitConversions?: unknown }).unitConversions) ? (patch as { unitConversions: { fromUnit?: string; toUnit?: string; conversionFactor?: number }[] }).unitConversions : undefined,
      );
      const purchaseTaxId = preserveGroupId ? String(row.purchaseTaxId ?? "") : "";
      const saleTaxId = preserveGroupId ? String(row.saleTaxId ?? "") : "";
      form.reset({
        ...base,
        ...patch,
        unitConversions: unitConversions.length ? unitConversions : base.unitConversions,
        ...(groupId ? { groupId } : {}),
        ...(purchaseTaxId ? { purchaseTaxId } : {}),
        ...(saleTaxId ? { saleTaxId } : {}),
      } as z.infer<typeof formSchema>);
      const extraGroups = detail.detail?.ocrGroups ?? [];
      if (extraGroups.length) {
        setGroups((prev) => {
          const byId = new Map(prev.map((g) => [g.id, g]));
          for (const g of extraGroups) {
            if (g?.id && !byId.has(g.id)) byId.set(g.id, { ...g, id: g.id, name: String(g.name ?? "") } as ItemGroup);
          }
          return [...byId.values()];
        });
      }
    };
    document.addEventListener("prefill-create-item-from-row", handlePrefillRow as EventListener);
    return () => document.removeEventListener("prefill-create-item-from-row", handlePrefillRow as EventListener);
  }, [form, defaultType]);

  // Only reset form when main dialog opens (not when nested dialogs open/close)
  const prevIsOpenRef = useRef(false);
  const defaultTypeRef = useRef(defaultType);
  
  // Update defaultTypeRef when it changes
  useEffect(() => {
    defaultTypeRef.current = defaultType;
  }, [defaultType]);
  
  useEffect(() => {
    // Only reset if dialog is opening (was closed, now open)
    // This ensures form only resets when the main dialog first opens, not when nested dialogs open/close
    if (isOpen && !prevIsOpenRef.current) {
      form.reset(getInitialFormValues(defaultTypeRef.current));
      setProfileFile(null);
      setDocSlots([]);
    }
    prevIsOpenRef.current = isOpen;
    // Remove defaultType from dependencies to prevent reset when it changes
  }, [isOpen, form]);

  const { fields: unitFields, append: appendUnit, remove: removeUnit } = useFieldArray({
    control: form.control,
    name: "unitConversions"
  });
  
  const watchedUnitConversions = useWatch({ control: form.control, name: 'unitConversions' });
  const watchedPurchasePrice = useWatch({ control: form.control, name: 'purchasePrice' });
  const watchedSalePrice = useWatch({ control: form.control, name: 'salePrice' });
  const watchedPurchasePriceUnit = useWatch({ control: form.control, name: 'purchasePriceUnit' });
  const watchedSalePriceUnit = useWatch({ control: form.control, name: 'salePriceUnit' });
  const watchedOpeningBalanceUnit = useWatch({ control: form.control, name: 'openingBalanceUnit' });
  const watchedIsPurchaseTaxInclusive = useWatch({ control: form.control, name: 'isPurchasePriceTaxInclusive' });
  const watchedIsSalePriceTaxInclusive = useWatch({ control: form.control, name: 'isSalePriceTaxInclusive' });
  const watchedIsOpeningBalanceTaxInclusive = useWatch({ control: form.control, name: 'isOpeningBalanceTaxInclusive' });
  const watchedOpeningBalanceTaxId = useWatch({ control: form.control, name: 'openingBalanceTaxId' });
  const watchedPurchaseTaxId = useWatch({ control: form.control, name: 'purchaseTaxId' });
  const watchedSaleTaxId = useWatch({ control: form.control, name: 'saleTaxId' });


  const handleGroupCreated = (newGroupId: string) => {
    // Restore form values if they were backed up
    if (formValuesBackupRef.current) {
      const backup = formValuesBackupRef.current;
      form.reset(backup);
      form.setValue('groupId', newGroupId);
      formValuesBackupRef.current = null;
    } else {
      form.setValue('groupId', newGroupId);
    }
    setIsCreateGroupOpen(false);
  };
  
  // Backup form values when group or tax dialog opens (same logic for both - like group field)
  useEffect(() => {
    if ((isCreateGroupOpen || isCreateTaxOpen) && !formValuesBackupRef.current) {
      formValuesBackupRef.current = form.getValues();
    }
    // Don't clear backup here - let handlers clear it after restore
  }, [isCreateGroupOpen, isCreateTaxOpen, form]);

  // Hide system item groups (Stock Items, Services) from dropdown — only user-created groups

  const taxOptions = React.useMemo(
    () => [
      { value: "", label: "None" },
      ...taxes.map((t) => ({ value: t.id, label: `${t.name} @ ${t.rate}%` })),
    ],
    [taxes]
  );

  const handleTaxCreated = (newTaxId: string, newTax?: { id: string; name: string; rate: number; balance?: number; companyId: string; groupId?: string }) => {
    if (newTaxId) {
      const fieldToApply = taxFieldToApplyRef.current; // Get from ref
      
      // Restore form values if they were backed up (same logic as handleGroupCreated)
      if (formValuesBackupRef.current) {
        const backup = formValuesBackupRef.current;
        form.reset(backup);
        // Set the tax field immediately after restore
        if (fieldToApply) {
          form.setValue(fieldToApply, newTaxId);
        }
        formValuesBackupRef.current = null;
      } else {
        // If no backup, just set the tax field directly
        if (fieldToApply) {
          form.setValue(fieldToApply, newTaxId);
        } else if (taxRowIndex !== null) {
          form.setValue('saleTaxId', newTaxId);
        }
      }
      
      if (newTax) {
        setTaxes((prev) => (prev.some((t) => t.id === newTaxId) ? prev : [...prev, { ...newTax, balance: newTax.balance ?? 0 } as Tax]));
      }
    }
    setIsCreateTaxOpen(false);
    setTaxRowIndex(null);
    taxFieldToApplyRef.current = null; // Clear ref
  }
  
  
  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    const mergeIn = (incoming: ItemGroup[]) => {
      if (!incoming.length) return;
      setGroups((prev) => {
        const byId = new Map(prev.map((g) => [g.id, g]));
        for (const g of incoming) if (g?.id) byId.set(g.id, g);
        return [...byId.values()];
      });
    };
    const fallbackGroups = () => {
      const g = (processedItemGroupsRef.current || []) as unknown as ItemGroup[];
      if (g.length) mergeIn(g);
    };
    const fallbackTaxes = () => {
      const t = (processedTaxesRef.current || []) as unknown as Tax[];
      if (t.length) setTaxes(t);
    };

    if (sqliteListsOnlyNoSnapshot) {
      fallbackGroups();
      fallbackTaxes();
      void (async () => {
        try {
          const [gRows, tRows] = await Promise.all([
            listCompanyDocsFromBrowserDb(companyId, "item_groups"),
            listCompanyDocsFromBrowserDb(companyId, "taxes"),
          ]);
          if (cancelled) return;
          if (gRows.length) {
            mergeIn(gRows.map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as ItemGroup)));
          }
          if (tRows.length) {
            setTaxes(tRows.map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as Tax)));
          }
        } catch (e) {
          console.warn("[CreateItemDialog] mirror lists failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const qGroups = query(collection(firestore, `companies/${companyId}/item_groups`));
    const unsubGroups = onSnapshot(qGroups, (snapshot) => {
        setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ItemGroup)));
    }, (error) => {
        console.error("Error fetching groups:", error);
        const fb = (processedItemGroupsRef.current || []) as unknown as ItemGroup[];
        if (fb.length > 0) setGroups(fb);
    });

    const qTaxes = query(collection(firestore, `companies/${companyId}/taxes`));
    const unsubTaxes = onSnapshot(qTaxes, (snapshot) => {
        setTaxes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tax)));
    });
    
    return () => {
        unsubGroups();
        unsubTaxes();
    };
  }, [isOpen, companyId, toast, processedItemGroups, processedTaxes, sqliteListsOnlyNoSnapshot]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputFile = e.target.files?.[0];
    e.target.value = "";
    if (!inputFile) return;
    if (!canAddAvatar) {
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow adding a profile photo." });
      return;
    }
    if (!isProfileAvatarImageFile(inputFile)) {
      toast({ variant: "destructive", title: "Invalid file", description: "Profile photo must be an image." });
      return;
    }
    if (inputFile.size > MAX_IMAGE_BYTES_BEFORE_COMPRESS) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Please select an image smaller than ${MAX_IMAGE_MB_BEFORE_COMPRESS}MB to compress.`,
      });
      return;
    }
    try {
      const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(inputFile, companyId);
      // compressFile fail par original; PDF yahan nahi — sirf image
      
      setProfileFile(compressedFile);
    } catch (err) {
      console.error("Avatar compression error:", err);
      toast({ variant: "destructive", title: "File Error", description: "Could not process the image." });
    }
  };

  const removeAvatar = () => setProfileFile(null);

  const handleDocsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    if (!canAttachDocuments) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow adding attachments." });
      return;
    }
    const picked = Array.from(e.target.files);
    e.target.value = "";
    let accumulated = [...docSlots];
    for (const file of picked) {
      if (accumulated.length >= 5) {
        toast({ variant: "destructive", title: "Limit reached", description: "You can upload up to 5 documents." });
        break;
      }
      if (!isProfileDocumentFile(file)) {
        toast({ variant: "destructive", title: "Invalid file", description: "Use images or PDF only." });
        continue;
      }
      // PDF: compressFile no-op — 0.5MB post-check pe pehle reject ho jata tha
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES_BEFORE_UPLOAD) {
          toast({
            variant: "destructive",
            title: "PDF too large",
            description: `Maximum ${MAX_PDF_UPLOAD_MB} MB per PDF.`,
          });
          continue;
        }
        accumulated = [...accumulated, file];
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES_BEFORE_COMPRESS) {
        toast({
          variant: "destructive",
          title: "File too large",
          description: `Please select images smaller than ${MAX_IMAGE_MB_BEFORE_COMPRESS} MB to compress.`,
        });
        continue;
      }
      try {
        const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(file, companyId);
        
        accumulated = [...accumulated, compressedFile];
      } catch (err) {
        console.error("Document compression error:", err);
        toast({ variant: "destructive", title: "File Error", description: "Could not process a file." });
      }
    }
    setDocSlots(accumulated);
  };

  const removeDocSlot = (idx: number) => {
    setDocSlots((prev) => prev.filter((_, i) => i !== idx));
  };


  function handleFormSubmit(e: React.FormEvent, options: { saveAndNew?: boolean } = {}) {
    e.preventDefault();
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }
    void (async () => {
      const isValid = await form.trigger();
      if (!isValid) {
        sonnerToast.error("Validation Failed", { description: "Please check all fields and try again." });
        return;
      }
      if (!options.saveAndNew) {
        setIsOpen(false);
      } else {
        setIsLoading(true);
      }
      void processAndSave(form.getValues(), options.saveAndNew || false);
    })();
  }

  async function processAndSave(values: z.infer<typeof formSchema>, saveAndNew: boolean = false) {
    if (!user || !companyId) {
      toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in and have a company selected." });
      return;
    }

    const toastId = sonnerToast.loading("Saving item...");
    setIsLoading(true);

    try {
      if (localSqlMirror) {
        // Local-only mode: save item in browser DB and queue backup sync.
        const localId = createLocalEntityId("item");
        let localFileUrls: string[] = [];
        const avatarF = profileFile instanceof File ? profileFile : null;
        const docFiles = docSlots.filter((x): x is File => x instanceof File);
        if ((avatarF && canAddAvatar) || (docFiles.length > 0 && canAttachDocuments)) {
          const staged = await stageItemAvatarAndAttachments({
            companyId,
            itemId: localId,
            avatarFile: avatarF && canAddAvatar ? avatarF : null,
            attachmentFiles: canAttachDocuments ? docFiles : [],
            maxAttachments: 5,
          });
          localFileUrls = [...(staged.avatarUrl ? [staged.avatarUrl] : []), ...staged.newAttachmentUrls];
        }
        const payload = {
          id: localId,
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          type: values.type,
          hsCode: values.hsCode || null,
          ownerId: user.uid,
          companyId,
          groupId: values.groupId || null,
          salePrice: values.salePrice,
          purchasePrice: values.purchasePrice,
          openingBalance: values.openingBalance,
          openingBalanceUnit: values.openingBalanceUnit || null,
          openingBalanceTaxId: values.openingBalanceTaxId || null,
          isOpeningBalanceTaxInclusive: values.isOpeningBalanceTaxInclusive || false,
          openingBalanceDate: values.openingBalanceDate || null,
          openingBalanceRate: values.openingBalanceRate || 0,
          unitConversions: values.unitConversions || [],
          fileUrls: localFileUrls,
          openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
          debit: 0,
          credit: 0,
          balance: (values.openingBalance || 0) * (values.openingBalanceRate || 0),
          stockQty: values.openingBalance || 0,
          createdAt: new Date().toISOString(),
          salePriceUnit: values.salePriceUnit || null,
          purchasePriceUnit: values.purchasePriceUnit || null,
          saleTaxId: values.saleTaxId || null,
          purchaseTaxId: values.purchaseTaxId || null,
          isPurchasePriceTaxInclusive: values.isPurchasePriceTaxInclusive || false,
          isSalePriceTaxInclusive: values.isSalePriceTaxInclusive || false,
          isDeleted: false,
        };
        await writeNewItemRecord({ company, companyId, payload, id: localId });
        const showSyncHint = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1" && user.uid !== "local_guest_user";
        sonnerToast.success(showSyncHint ? "Saved. Will sync when online." : "Saved.", {
          id: toastId,
          description: showSyncHint
            ? `"${values.name}" was saved locally and will sync when online.`
            : `"${values.name}" was saved locally.`,
        });
        onItemCreated?.(localId);
        if (saveAndNew) {
          form.reset(getInitialFormValues(itemType));
          setProfileFile(null);
          setDocSlots([]);
        }
        return;
      }

      // Recycle-bin duplicate flow: restore or create-new on user choice.
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId,
        collectionName: "items",
        name: values.name.trim(),
        entityLabel: sidebarEntityMenuLabel("items"),
      });
      if (duplicateDecision.decision === "active_exists") {
        sonnerToast.error("Duplicate Item Name", {
          id: toastId,
          description: "An item with this name already exists.",
        });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        sonnerToast.success("Item Restored!", {
          id: toastId,
          description: `"${values.name.trim()}" was restored from Recycle Bin.`,
        });
        onItemCreated(duplicateDecision.restoredId);
        setIsLoading(false);
        return;
      }
      
      const itemRef = doc(collection(firestore, `companies/${companyId}/items`));
      const newItemId = itemRef.id;

      const fileUrls: string[] = [];
      const avatarUpload = profileFile instanceof File ? profileFile : null;
      const newDocFiles = docSlots.filter((f): f is File => f instanceof File);
      if (
        companyId &&
        ((canAddAvatar && avatarUpload) || (canAttachDocuments && newDocFiles.length > 0))
      ) {
        const totalNewBytes =
          (canAddAvatar && avatarUpload ? avatarUpload.size : 0) +
          (canAttachDocuments ? newDocFiles.reduce((s, f) => s + f.size, 0) : 0);
        if (totalNewBytes > 0) {
          const limitCheck = await checkStorageLimit(
            companyId,
            company?.planId,
            { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes },
            company?.storageOption
          );
          if (!limitCheck.allowed) {
            sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
            setIsLoading(false);
            return;
          }
        }
        const staged = await uploadItemAvatarAndAttachmentsRemote({
          companyId,
          itemId: newItemId,
          avatarFile: canAddAvatar && avatarUpload ? avatarUpload : null,
          attachmentFiles: canAttachDocuments ? newDocFiles : [],
          maxAttachments: 5,
        });
        if (staged.avatarUrl) fileUrls.push(staged.avatarUrl);
        fileUrls.push(...staged.newAttachmentUrls);
        if (totalNewBytes > 0) {
          await incrementCompanyStorage(companyId, {
            attachmentsBytes: totalNewBytes,
            storageBytes: totalNewBytes,
          });
        }
      }
      
      const balance = (values.openingBalance || 0) * (values.openingBalanceRate || 0);

      // Get Stock Qty in smallest unit
      const conversions = (values.unitConversions || []) as any[];
      const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : (values.openingBalanceUnit || '');
      let stockQty = 0;
      if (values.type === 'item') {
          let factor = 1;
          let currentUnit = values.openingBalanceUnit;
          if (currentUnit && currentUnit !== smallestUnit) {
              for (let i=0; i < 10; i++) { // safety break
                  const conv = conversions.find((c:any) => c.fromUnit === currentUnit);
                  if (!conv) { factor = 0; break; }
                  factor *= Number(conv.conversionFactor) || 1;
                  currentUnit = conv.toUnit;
                  if (currentUnit === smallestUnit) break;
              }
          }
          stockQty = (values.openingBalance || 0) * (factor || 1);
      }

      const submissionData = {
          name: values.name,
          aliasName: (values.aliasName ?? "").trim(),
          type: values.type,
          hsCode: values.hsCode || null,
          ownerId: user.uid,
          companyId: companyId,
          groupId: values.groupId || null,
          salePrice: values.salePrice,
          purchasePrice: values.purchasePrice,
          openingBalance: values.openingBalance,
          openingBalanceUnit: values.openingBalanceUnit || null,
          openingBalanceTaxId: values.openingBalanceTaxId || null,
          isOpeningBalanceTaxInclusive: values.isOpeningBalanceTaxInclusive || false,
          openingBalanceDate: values.openingBalanceDate || null,
          openingBalanceRate: values.openingBalanceRate || 0,
          unitConversions: values.unitConversions || [],
          fileUrls: fileUrls,
          debit: 0,
          credit: 0,
          balance: balance,
          stockQty: stockQty,
          createdAt: serverTimestamp(),
          salePriceUnit: values.salePriceUnit || null,
          purchasePriceUnit: values.purchasePriceUnit || null,
          saleTaxId: values.saleTaxId || null,
          purchaseTaxId: values.purchaseTaxId || null,
          isPurchasePriceTaxInclusive: values.isPurchasePriceTaxInclusive || false,
          isSalePriceTaxInclusive: values.isSalePriceTaxInclusive || false,
          isDeleted: false,
          openingBalanceNarration: values.openingBalanceNarration?.trim() || null,
      };

      await writeNewItemRecord({ company, companyId, payload: submissionData, id: newItemId });

      sonnerToast.success("Item Created!", { id: toastId, description: `"${values.name}" has been successfully created.` });
      
      if (onItemCreated) {
        onItemCreated(newItemId);
      }
      if (saveAndNew) {
        form.reset(getInitialFormValues(itemType));
        setProfileFile(null);
        setDocSlots([]);
      }

    } catch (error) {
      console.error("Error creating item:", error);
      sonnerToast.error("Error Creating Item", { id: toastId, description: "Item details could not be saved. Please try again." });
    } finally {
        setIsLoading(false);
    }
  }

  
  const allUnits = collectItemUnits(watchedUnitConversions, [watchedPurchasePriceUnit, watchedSalePriceUnit, watchedOpeningBalanceUnit]);
  const openingStockQty = form.watch('openingBalance') || 0;
  const openingStockRate = form.watch('openingBalanceRate') || 0;
  
  const unitPrices = useMemo(() => computeItemUnitPrices({
    conversions: watchedUnitConversions,
    units: allUnits,
    purchasePrice: watchedPurchasePrice,
    salePrice: watchedSalePrice,
    purchasePriceUnit: watchedPurchasePriceUnit,
    salePriceUnit: watchedSalePriceUnit,
    purchaseTaxRate: taxes.find((t) => t.id === watchedPurchaseTaxId)?.rate || 0,
    saleTaxRate: taxes.find((t) => t.id === watchedSaleTaxId)?.rate || 0,
    purchaseInclusive: !!watchedIsPurchaseTaxInclusive,
    saleInclusive: !!watchedIsSalePriceTaxInclusive,
  }), [allUnits, watchedUnitConversions, watchedPurchasePrice, watchedSalePrice, watchedPurchasePriceUnit, watchedSalePriceUnit, watchedPurchaseTaxId, watchedSaleTaxId, taxes, watchedIsPurchaseTaxInclusive, watchedIsSalePriceTaxInclusive]);
  
  useEffect(() => {
    const openingStockUnit = form.getValues('openingBalanceUnit');
    const currentRate = form.getValues('openingBalanceRate');

    if (openingStockUnit && unitPrices[openingStockUnit]) {
        const isInclusive = form.getValues('isOpeningBalanceTaxInclusive');
        const taxId = form.getValues('openingBalanceTaxId');
        const taxRate = taxes.find(t => t.id === taxId)?.rate || 0;
        
        let baseRate = Number(unitPrices[openingStockUnit]?.purchase) || 0;
        
        let finalRate = isInclusive 
          ? parseFloat((baseRate * (1 + taxRate / 100)).toFixed(2)) 
          : parseFloat(baseRate.toFixed(2));
        
        if (currentRate !== finalRate) {
           form.setValue('openingBalanceRate', finalRate, { shouldValidate: true });
        }
    }
}, [watchedOpeningBalanceUnit, watchedIsOpeningBalanceTaxInclusive, watchedOpeningBalanceTaxId, unitPrices, taxes, form]);

const openingStockAmount = (openingStockQty || 0) * (openingStockRate || 0);

const openingStockByUnit = useMemo(() => {
    const stock: Record<string, number> = {};
    const conversions = watchedUnitConversions || [];
    if (conversions.length === 0 || !watchedOpeningBalanceUnit || !openingStockQty) return stock;

    const getFactorToSmallest = (unit: string): number => {
        let factor = 1;
        let current = unit;
        const smallestUnit = conversions[conversions.length - 1].toUnit;

        while (current !== smallestUnit) {
            const conv = conversions.find(c => c.fromUnit === current);
            if (!conv) return 0; // Should not happen in a valid chain
            factor *= Number(conv.conversionFactor);
            current = conv.toUnit;
        }
        return factor;
    };
    
    const factorToSmallest = getFactorToSmallest(watchedOpeningBalanceUnit);
    const qtyInSmallest = openingStockQty * factorToSmallest;

    allUnits.forEach(unit => {
        const factorFromSmallest = getFactorToSmallest(unit);
        stock[unit] = factorFromSmallest > 0 ? qtyInSmallest / factorFromSmallest : 0;
    });

    return stock;
}, [watchedUnitConversions, openingStockQty, watchedOpeningBalanceUnit, allUnits]);


const capitalizeFirstLetter = (str: string) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
};


  return (
    <React.Fragment>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        {/* Mobile: 85vh height, 98vw width. PC: 90% screen height & width (90vh / 90vw) so dialog uses most of viewport. */}
        <DialogContent
            overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
            hideCloseButton={dialogResizable}
            className={cn(
              cnMasterEntityDialogContent(isMobile),
              "sm:max-w-5xl",
              dialogResizable &&
                "!fixed !flex !max-h-none flex-col overflow-hidden !p-0 !gap-0 sm:!max-w-none sm:!px-0"
            )}
            style={
              dialogResizable
                ? {
                    left: dialogPosition.x,
                    top: dialogPosition.y,
                    width: dialogSize.w,
                    height: dialogSize.h,
                    maxWidth: "98vw",
                    maxHeight: "92vh",
                    transform: "none",
                  }
                : undefined
            }
            onPointerDownOutside={(e) => { if (isCreateGroupOpen) e.preventDefault(); }}
            onInteractOutside={(e) => { if (isCreateGroupOpen) e.preventDefault(); }}
        >
          {dialogResizable ? (
            <MasterEntityDialogDragRibbon onDragStart={handleDragStart} blue>
              <div className="relative flex min-w-0 items-center">
                <DialogHeader className={cn(masterEntityDialogHeaderClassName, "space-y-0.5 p-0 text-left")}>
                  <DialogTitle>Create a New Item</DialogTitle>
                  <DialogDescription>Add a new product or service to your records.</DialogDescription>
                </DialogHeader>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{itemTypeTabs}</div>
              </div>
            </MasterEntityDialogDragRibbon>
          ) : (
            <DialogHeader className={masterEntityDialogHeaderClassName}>
              <DialogTitle>Create a New Item</DialogTitle>
              <DialogDescription>Add a new product or service to your records.</DialogDescription>
            </DialogHeader>
          )}
          {itemType === 'finished_good' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-4">
              {tabsInRibbon ? null : itemTypeTabs}
              <CreateFinishedGoodForm
                isOpen={isOpen}
                onOpenChange={setIsOpen}
                onItemCreated={onItemCreated}
                prefillName={String(form.getValues('name') || '')}
              />
            </div>
          ) : (
          <div className={cn(masterEntityDialogFormWrapperClassName, dialogResizable && "px-6 pb-4")}>
          <Form {...form}>
            <form onSubmit={(e) => handleFormSubmit(e)} className="flex min-h-0 flex-1 flex-col">
            <div className="pl-master-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">

              {tabsInRibbon ? null : itemTypeTabs}
              <div className="space-y-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><FormField
                  control={form.control}
                  name="name"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Item Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., T-Shirt (Red)" className="h-9" {...field} />
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
                        <Input placeholder="Other name on bills / short name" className="h-9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                /></div>
                <FormField
                  control={form.control}
                  name="hsCode"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>HS Code</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter HS Code" className="h-9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="groupId"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Group</FormLabel>
                      <MasterGroupTreeCombobox
                        preset={ITEM_ENTITY_GROUP_PRESET}
                        groups={groups}
                        processedGroups={processedItemGroups as unknown as ItemGroup[]}
                        popoverModal={false}
                        confirmWithOk
                        value={field.value}
                        onChange={(value, newName) => {
                          if (value === "add-new") {
                            setIsCreateGroupOpen(true);
                            setTimeout(() => {
                              document.dispatchEvent(new CustomEvent('prefill-create-item-group-name', { detail: newName }));
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
              </div>
              
              {/* Unit Conversions: horizontal scroll so Base Unit + delete icon visible on small screens (do not remove overflow-x-auto). */}
              <div className="space-y-4 border p-4 rounded-md">
                  <FormLabel className="text-base font-semibold">Unit Conversions</FormLabel>
                  <div className="w-full overflow-x-auto overflow-y-visible -mx-1 px-1">
                  <div className="space-y-2 min-w-[560px] pr-2">

                  {unitFields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-11 items-end gap-2">
                          <div className="col-span-1 flex items-center justify-center font-bold">1</div>
                          <FormField
                              control={form.control}
                              name={`unitConversions.${index}.fromUnit`}
                              render={({ field: fromUnitField }: any) => (
                                  <FormItem className="col-span-3">
                                      <FormControl>
                                        <Input 
                                          className="h-9"
                                          placeholder="e.g. Box" 
                                          {...fromUnitField} 
                                          onBlur={(e) => {
                                            const capitalized = capitalizeFirstLetter(e.target.value);
                                            fromUnitField.onChange(capitalized);
                                            if (index === 0 && !form.getValues('openingBalanceUnit')) form.setValue('openingBalanceUnit', capitalized);
                                            if (index === 0 && !form.getValues('purchasePriceUnit')) form.setValue('purchasePriceUnit', capitalized);
                                            if (index === 0 && !form.getValues('salePriceUnit')) form.setValue('salePriceUnit', capitalized);
                                          }}
                                        />
                                      </FormControl>
                                  </FormItem>
                              )}
                          />
                          <div className="col-span-1 flex items-center justify-center font-bold">=</div>
                          <FormField
                              control={form.control}
                              name={`unitConversions.${index}.conversionFactor`}
                              render={({ field }: any) => (
                                  <FormItem className="col-span-2">
                                      <FormControl><Input type="number" placeholder="e.g. 12" className="h-9" {...field} /></FormControl>
                                  </FormItem>
                              )}
                          />
                          <FormField
                              control={form.control}
                              name={`unitConversions.${index}.toUnit`}
                              render={({ field }: any) => (
                                  <FormItem className="col-span-3">
                                      <div className="relative">
                                          <FormControl><Input placeholder="e.g. Pcs" className="h-9" {...field} onBlur={(e) => {
                                              const capitalized = capitalizeFirstLetter(e.target.value);
                                              field.onChange(capitalized);
                                              if (index < unitFields.length - 1) {
                                                  form.setValue(`unitConversions.${index + 1}.fromUnit`, capitalized);
                                              }
                                          }} /></FormControl>
                                          {index === unitFields.length - 1 && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-muted px-2 py-0.5 rounded-sm text-muted-foreground">Base Unit</span>}
                                      </div>
                                  </FormItem>
                              )}
                          />
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeUnit(index)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                      </div>
                  ))}
                  <Button type="button" variant="outline"
                      className="mt-2"
                      onClick={() => {
                          const lastUnit = unitFields.length > 0 ? form.getValues(`unitConversions.${unitFields.length - 1}.toUnit`) : "";
                          appendUnit({ fromUnit: lastUnit || '', toUnit: '', conversionFactor: 1 })
                      }}
                  >
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Unit Conversion
                  </Button>
              </div>
              </div>
              </div>

              {/* Purchase Price, Purchase Unit Prices, Sale Price, Sale Unit Prices: mobile = Purchase Price then Purchase Unit Prices then Sale then Sale Unit Prices; PC = side-by-side (do not remove order classes). */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="order-1 sm:order-1 space-y-4 border p-4 rounded-md">

                    <div className="space-y-2">
                          <FormLabel>Purchase Price</FormLabel>
                          <div className="grid grid-cols-2 gap-2">
                              <FormField control={form.control} name="isPurchasePriceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="isPurchasePriceTaxInclusive"/></FormControl><label htmlFor="isPurchasePriceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                              <FormField control={form.control} name="purchaseTaxId" render={({ field }: any) => (
                              <FormItem>
                                <Combobox
                                  options={taxOptions}
                                  value={field.value}
                                  onChange={(val) => {
                                    field.onChange(val || "");
                                  }}
                                  placeholder="Select Tax"
                                  triggerClassName="h-9"
                                />
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                          <FormField control={form.control} name="purchasePrice" render={({ field }: any) => (<FormItem><FormControl><Input type="number" placeholder="0.00" className="h-9" {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={form.control} name="purchasePriceUnit" render={({ field }: any) => (<FormItem><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Unit"/></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      </div>
                </div>
                  <div className="order-3 sm:order-2 space-y-4 border p-4 rounded-md">

                      <div className="space-y-2">
                          <FormLabel>Sale Price</FormLabel>
                          <div className="grid grid-cols-2 gap-2">
                              <FormField control={form.control} name="isSalePriceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="isSalePriceTaxInclusive"/></FormControl><label htmlFor="isSalePriceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                              <FormField control={form.control} name="saleTaxId" render={({ field }: any) => (
                              <FormItem>
                                <Combobox
                                  options={taxOptions}
                                  value={field.value}
                                  onChange={(val) => {
                                    field.onChange(val || "");
                                  }}
                                  placeholder="Select Tax"
                                  triggerClassName="h-9"
                                />
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                        <FormField control={form.control} name="salePrice" render={({ field }: any) => (<FormItem className="flex-1"><FormControl><Input type="number" placeholder="0.00" className="h-9" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="salePriceUnit" render={({ field }: any) => (<FormItem><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Unit"/></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    </div>
                </div>
                  <ScrollArea className="order-2 sm:order-3 w-full">

                      <div className="space-y-2 border p-4 rounded-md min-w-[500px]">
                          <FormLabel className="text-base font-semibold">Purchase Unit Prices</FormLabel>
                          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-x-2 gap-y-2 items-center pr-4">
                              <FormLabel>Unit</FormLabel>
                              <FormLabel className="text-right">Rate</FormLabel>
                              <FormLabel className="text-right">Tax</FormLabel>
                              <FormLabel className="text-right">Total</FormLabel>
                              {allUnits.map((unit) => (
                                  <React.Fragment key={`purchase-${unit}`}>
                                      <p className="font-medium text-sm">{unit}</p>
                                      <Input type="number" value={Number(unitPrices[unit]?.purchase).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                      <Input type="number" value={Number(unitPrices[unit]?.purchaseTax).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                      <Input type="number" value={Number(unitPrices[unit]?.purchase + unitPrices[unit]?.purchaseTax).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                  </React.Fragment>
                              ))}
                          </div>
                      </div>
                      <ScrollBar orientation="horizontal"/>
                  </ScrollArea>
                  <ScrollArea className="order-4 sm:order-4 w-full">

                      <div className="space-y-2 border p-4 rounded-md min-w-[500px]">
                          <FormLabel className="text-base font-semibold">Sale Unit Prices</FormLabel>
                          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-x-2 gap-y-2 items-center pr-4">
                              <FormLabel>Unit</FormLabel>
                              <FormLabel className="text-right">Rate</FormLabel>
                              <FormLabel className="text-right">Tax</FormLabel>
                              <FormLabel className="text-right">Total</FormLabel>
                              {allUnits.map((unit) => (
                                  <React.Fragment key={`sale-${unit}`}>
                                      <p className="font-medium text-sm">{unit}</p>
                                      <Input type="number" value={Number(unitPrices[unit]?.sale).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                      <Input type="number" value={Number(unitPrices[unit]?.saleTax).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                      <Input type="number" value={Number(unitPrices[unit]?.sale + unitPrices[unit]?.saleTax).toFixed(2) || '0.00'} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                                  </React.Fragment>
                              ))}
                          </div>
                      </div>
                      <ScrollBar orientation="horizontal"/>
                  </ScrollArea>
              </div>
              
              {/* Opening Stock first, then Opening Stock Summary below (do not revert to side-by-side). */}
              <div className="space-y-4">
                <div className="space-y-4 border p-4 rounded-md">
                  {/* Opening Stock container: horizontal scroll when fields overflow on small screens (do not remove overflow-x-auto). */}
                  <div className="w-full overflow-x-auto overflow-y-visible -mx-1 px-1">
                  <div className="min-w-[520px] space-y-4">

                  <div className="flex items-center gap-4">
                      <FormLabel className="text-base font-semibold">Opening Stock</FormLabel>
                      <FormField
                          control={form.control}
                          name="openingBalanceDate"
                          render={({ field }: any) => (
                              <FormItem className="flex items-center gap-2">
                                  <FormLabel>On Date</FormLabel>
                                  <div className="flex items-center gap-2">
                                  {(dateSystem === 'BS' || dateSystem === 'Both') && (
                                    <BsDatePicker valueAD={field.value} onChangeAD={(d) => { field.onChange(d as Date); setIsCalendarOpen(false); }} numberOfMonths={1} isRange={false} />
                                  )}
                                  {(dateSystem === 'AD' || dateSystem === 'Both') && (
                                    <Popover modal={true} open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button
                                            variant={"outline"}
                                            className={cn("w-[180px] pl-3 text-left font-normal h-9", !field.value && "text-muted-foreground")}
                                          >
                                            {field.value ? formatDate(field.value) : <span>Pick a date</span>}
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
                  </div>
                 <div className="grid grid-cols-5 gap-4 items-end">
                     <FormField
                        control={form.control}
                        name="openingBalance"
                        render={({ field }: any) => (
                        <FormItem>
                            <FormLabel>Quantity</FormLabel>
                            <FormControl><Input type="number" placeholder="0" className="h-9" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="openingBalanceUnit"
                        render={({ field }: any) => (
                        <FormItem>
                            <FormLabel>Unit</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Select Unit"/></SelectTrigger></FormControl>
                                <SelectContent>
                                    {allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="openingBalanceRate"
                        render={({ field }: any) => (
                        <FormItem>
                            <FormLabel>Rate</FormLabel>
                            <FormControl><Input type="number" placeholder="0.00" className="h-9" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <div className="space-y-2">
                        <FormField control={form.control} name="isOpeningBalanceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox id="isOpeningBalanceTaxInclusive" checked={field.value} onCheckedChange={field.onChange} /></FormControl><label htmlFor="isOpeningBalanceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                        <FormField control={form.control} name="openingBalanceTaxId" render={({ field }: any) => (
                        <FormItem>
                           <FormLabel className="sr-only">Tax</FormLabel>
                           <Combobox
                             options={taxOptions}
                             value={field.value}
                             onChange={(val) => {
                               field.onChange(val || "");
                             }}
                             placeholder="Select Tax"
                             triggerClassName="h-9"
                           />
                           <FormMessage />
                        </FormItem>
                        )}/>
                    </div>
                    <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl><Input type="number" value={openingStockAmount.toFixed(2)} readOnly className="h-9 bg-muted"/></FormControl>
                    </FormItem>
                 </div>
                <div className="space-y-2 border p-4 rounded-md">

                      <FormLabel className="text-base font-semibold">Opening Stock Summary</FormLabel>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 items-center pr-4">
                        <FormLabel>Unit</FormLabel>
                        <FormLabel className="text-right">Quantity</FormLabel>
                          {Object.entries(openingStockByUnit).map(([unit, qty]) => (
                              <React.Fragment key={`stock-${unit}`}>
                                  <p className="font-medium text-sm">{unit}</p>
                                  <Input type="number" value={qty.toFixed(2)} readOnly className="h-9 bg-muted cursor-not-allowed text-right"/>
                              </React.Fragment>
                          ))}
                      </div>
                  </div>
              </div>
              </div>
              </div>
              </div>
              </div>

              {/* Party/bank jaisa: narration se pehle profile + documents */}
              <div className="flex flex-wrap items-stretch gap-4">
              <RestrictedFileUploader>
                <div className="shrink-0 rounded-md border p-4">
                  <EntityProfilePhotoBlock
                    compactInfo
                    file={profileFile}
                    onPickClick={() => avatarInputRef.current?.click()}
                    fileInputRef={avatarInputRef}
                    onAvatarChange={handleAvatarChange}
                    onRemoveAvatar={removeAvatar}
                    canAddAvatar={canAddAvatar}
                    inputId="create-item-avatar-input"
                  />
                </div>
                <div className="min-w-[18rem] flex-1 rounded-md border p-4">
                  <EntityDocumentsBlock
                    compactInfo
                    docSlots={docSlots}
                    setDocSlots={setDocSlots}
                    onRemoveDoc={removeDocSlot}
                    onAddClick={() => docsInputRef.current?.click()}
                    docsInputRef={docsInputRef}
                    onDocsChange={handleDocsChange}
                    canAttachDocuments={canAttachDocuments}
                    attachmentCompanyId={companyId ?? undefined}
                    entityStatementLabel="item"
                    inputId="create-item-docs-input"
                  />
                </div>
              </RestrictedFileUploader>
              <div className="min-w-[16rem] flex-1 rounded-md border p-4">
                <EntityOpeningBalanceNarrationField
                  compactInfo
                  control={form.control}
                  name="openingBalanceNarration"
                  detailLabel="item"
                />
              </div>
              </div>

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
                    Save &amp; New
                  </Button>
                </div>
                <Button type="submit" disabled={isLoading || isCompressing || !companyId || apkOfflineViewOnly || openingBalanceDateMissing} className="shrink-0">
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Item
                </Button>
              </DialogFooter>
            </form>
          </Form>
          </div>
          )}
          {dialogResizable ? <ResizableDialogEdgeHandles onResizeStart={handleResizeStart} allSides /> : null}
        </DialogContent>
      </Dialog>
      <CreateItemGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups} />
      <CreateTaxDialog onTaxCreated={handleTaxCreated} isOpen={isCreateTaxOpen} onOpenChange={(open) => { if (!open) { setPrefillTaxName(""); taxFieldToApplyRef.current = null; } setIsCreateTaxOpen(open); }} prefillTaxName={prefillTaxName} />
    </React.Fragment>
  );
}

