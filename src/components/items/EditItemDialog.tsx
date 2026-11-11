
"use client";

import { DialogPlainOpener } from "@/components/ui/dialog-plain-opener";
import { addDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { NESTED_LEDGER_MASTER_EDIT_CONTENT_CN, NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN } from "@/lib/nestedLedgerMasterEditPresentation";
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cnMasterEntityDialogContent,
  masterEntityDialogHeaderClassName,
  masterEntityDialogFormWrapperClassName,
} from "@/lib/masterEntityDialogClasses";
import {
  MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS,
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { refineMasterOpeningBalanceDateRequired } from "@/lib/masterOpeningBalanceDateRequired";
import { useMasterOpeningBalanceDateRequired } from "@/hooks/useMasterOpeningBalanceDateRequired";
import { cn } from "@/lib/utils";
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
import { collection, query, where, serverTimestamp, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";

import type { Item, ItemGroup } from "@/components/items/types";
import type { Tax, TaxGroup } from "@/components/tax/types";

import BsDatePicker from "@/components/ui/BsDatePicker";
import { Combobox } from "../ui/combobox";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import { AttachmentHoldPasteSurface } from "@/components/vouchers/AttachmentHoldPasteSurface";
import { syntheticFileInputChangeEvent } from "@/lib/syntheticFileInputChangeEvent";
import {
  MAX_IMAGE_BYTES_BEFORE_COMPRESS,
  MAX_IMAGE_BYTES_AFTER_COMPRESS,
  MAX_IMAGE_MB_BEFORE_COMPRESS,
  MAX_IMAGE_MB_AFTER_COMPRESS,
  MAX_PDF_BYTES_BEFORE_UPLOAD,
  MAX_PDF_UPLOAD_MB,
} from "@/lib/fileUploadLimits";
import { CreateItemGroupDialog } from "./CreateItemGroupDialog";
import { CreateTaxDialog } from "../tax/CreateTaxDialog";
import { normalizeItemGroupIdForStorage } from "@/lib/masterEntitySystemGroups";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { apkCloudCompanyOfflineViewOnly, apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { useLiveEntityDocAttachments } from "@/hooks/useLiveEntityDocAttachments";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  permanentDeleteCompanySubdocFromRecycleBin,
  softDeleteCompanySubdocToRecycleBin,
} from "@/lib/recycleBinEntityLifecycle";
import { MasterDeleteConfirmAlertDialog } from "@/components/common/MasterDeleteConfirmAlertDialog";
import { assertCanPermanentDeleteFromForm } from "@/lib/permanentDeleteFromForm";
import {
  isProfileDocumentFile,
  stageItemAvatarAndAttachments,
  uploadItemAvatarAndAttachmentsRemote,
} from "@/lib/entityProfileLocalFiles";
import {
  captureFormAttachmentBaseline,
  finalizeFormAttachmentEditAfterSave,
} from "@/lib/formAttachmentEditHelper";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RestrictedFileUploader } from "../ui/RestrictedFileUploader";
import Image from 'next/image';
import {
  EntityOpeningBalanceNarrationField,
  MasterPdfAsImageToggle,
} from "@/components/common/EntityProfileDocumentsNarrationFields";
import {
  fetchAdminPanelSubscriptionCatalogFields,
  isAdminPanelSubscriptionCatalogItemForCompany,
} from "@/lib/adminPanelCompany/subscriptionCatalogItemClient";
import {
  ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS,
  ADMIN_PANEL_SUBSCRIPTION_CATALOG_OPENING_STOCK_QTY,
  ADMIN_PANEL_SUBSCRIPTION_YEARLY_UNIT,
  subscriptionCatalogDefaultOpeningBalanceUnit,
  subscriptionCatalogUnitConversions,
} from "@/lib/adminPanelCompany/subscriptionCatalogItemPricing";
import { usePersistedResizableDialogSize } from "@/lib/usePersistedResizableDialogSize";
import { ResizableDialogEdgeHandles } from "@/components/ui/ResizableDialogEdgeHandles";
import { MasterEntityDialogDragRibbon } from "@/components/ui/MasterEntityDialogDragRibbon";


const fileSchema = z.object({
  file: z.instanceof(File),
  preview: z.string(),
});

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
  /** Low stock alert threshold (qty). 0 = koi warning nahi. */
  lowStockWarning: z.coerce.number().min(0).optional(),
  /** Low stock threshold kis unit me hai (item ke all units me se). */
  lowStockWarningUnit: z.string().optional(),
  saleTaxId: z.string().optional(),
  purchaseTaxId: z.string().optional(),
  /** Statement opening row — item ledger */
  openingBalanceNarration: z.string().optional(),
}).superRefine(refineMasterOpeningBalanceDateRequired);

type ItemFormValues = z.infer<typeof formSchema>;

/** CreateItemDialog jaisa — opening stock smallest unit (local `stockQty` mirror) */
function computeItemStockQty(values: ItemFormValues): number {
  const conversions = (values.unitConversions || []) as {
    fromUnit: string;
    toUnit: string;
    conversionFactor: number;
  }[];
  const smallestUnit =
    conversions.length > 0 ? conversions[conversions.length - 1].toUnit : values.openingBalanceUnit || "";
  if (values.type !== "item") return 0;
  let factor = 1;
  let currentUnit = values.openingBalanceUnit;
  if (currentUnit && currentUnit !== smallestUnit) {
    for (let i = 0; i < 10; i++) {
      const conv = conversions.find((c) => c.fromUnit === currentUnit);
      if (!conv) {
        factor = 0;
        break;
      }
      factor *= Number(conv.conversionFactor) || 1;
      currentUnit = conv.toUnit;
      if (currentUnit === smallestUnit) break;
    }
  }
  return (values.openingBalance || 0) * (factor || 1);
}

type SavedItemUnitConversion = {
  fromUnit?: string;
  toUnit?: string;
  conversionFactor?: number;
};

/** Same chain as useVouchers / ItemList: factor from a unit down to the last conversion's toUnit. Missing link => 0. */
function itemSmallestUnit(conversions: SavedItemUnitConversion[], openingBalanceUnit?: string): string {
  return conversions.length > 0
    ? String(conversions[conversions.length - 1]?.toUnit || "")
    : (openingBalanceUnit || "");
}

function getFactorToSmallestUnit(conversions: SavedItemUnitConversion[], unit: string): number {
  if (!unit || conversions.length === 0) return 1;
  const smallestUnit = itemSmallestUnit(conversions);
  if (!smallestUnit || unit === smallestUnit) return 1;
  let factor = 1;
  let currentUnit = unit;
  for (let i = 0; i < 10; i++) {
    const conv = conversions.find((c) => c.fromUnit === currentUnit);
    if (!conv) return 0;
    factor *= Number(conv.conversionFactor) || 1;
    currentUnit = conv.toUnit || "";
    if (currentUnit === smallestUnit) break;
  }
  return factor;
}

function listSavedItemUnits(item: { unitConversions?: unknown; openingBalanceUnit?: string }): string[] {
  const conversions = (item.unitConversions || []) as SavedItemUnitConversion[];
  const units = new Set<string>();
  if (item.openingBalanceUnit) units.add(item.openingBalanceUnit);
  for (const c of conversions) {
    if (c.fromUnit) units.add(c.fromUnit);
    if (c.toUnit) units.add(c.toUnit);
  }
  return Array.from(units);
}

function qtyInSavedItemUnit(stockInSmallest: number, conversions: SavedItemUnitConversion[], unit: string): number {
  const factor = getFactorToSmallestUnit(conversions, unit);
  return factor > 0 ? stockInSmallest / factor : 0;
}

/** Form load: legacy ungrouped ids → system branch (Products / Services). */
function normalizeItemEditGroupId(
  groupId: string | null | undefined,
  itemType?: string | null
): string {
  return normalizeItemGroupIdForStorage(groupId, itemType);
}

function getInitialFormValues(item?: Item): z.infer<typeof formSchema> {
    if (!item) {
        return {
            name: "", aliasName: "",
            type: "item",
            hsCode: "",
            salePrice: 0,
            isSalePriceTaxInclusive: false,
            purchasePrice: 0,
            isPurchasePriceTaxInclusive: false,
            openingBalance: 0,
            openingBalanceRate: 0,
            isOpeningBalanceTaxInclusive: false,
            groupId: normalizeItemEditGroupId("", "item"),
            unitConversions: [{ fromUnit: "", toUnit: "", conversionFactor: 1 }],
            openingBalanceUnit: "",
            openingBalanceTaxId: "",
            openingBalanceDate: undefined,
            salePriceUnit: "",
            purchasePriceUnit: "",
            lowStockWarning: 0,
            lowStockWarningUnit: "",
            saleTaxId: "",
            purchaseTaxId: "",
            openingBalanceNarration: "",
        };
    }

    return {
        name: item.name,
        aliasName: (((item as unknown) as { aliasName?: string }).aliasName) || "",
        type: item.type,
        hsCode: (item as any).hsCode || "",
        salePrice: item.salePrice,
        isSalePriceTaxInclusive: (item as any).isSalePriceTaxInclusive || false,
        purchasePrice: item.purchasePrice,
        isPurchasePriceTaxInclusive: (item as any).isPurchasePriceTaxInclusive || false,
        openingBalance: item.openingBalance,
        openingBalanceUnit: (item as any).openingBalanceUnit || "",
        openingBalanceTaxId: (item as any).openingBalanceTaxId || "",
        openingBalanceDate: (item as any).openingBalanceDate?.toDate ? (item as any).openingBalanceDate.toDate() : (item.openingBalanceDate ? new Date(item.openingBalanceDate) : undefined),
        openingBalanceRate: (item as any).openingBalanceRate || 0,
        isOpeningBalanceTaxInclusive: (item as any).isOpeningBalanceTaxInclusive || false,
        groupId: normalizeItemEditGroupId(item.groupId, item.type),
        unitConversions: item.unitConversions || [],
        salePriceUnit: item.salePriceUnit || "",
        purchasePriceUnit: (item as any).purchasePriceUnit || "",
        lowStockWarning: Number((item as any).lowStockWarning ?? 0) || 0,
        lowStockWarningUnit: (item as any).lowStockWarningUnit || "",
        saleTaxId: item.saleTaxId || "",
        purchaseTaxId: item.purchaseTaxId || "",
        openingBalanceNarration: item.openingBalanceNarration ?? "",
    };
}


export function EditItemDialog({ item, onItemUpdated, onItemDeleted, children, hasTransactions, isOpen: controlledIsOpen, onOpenChange: controlledOnOpenChange }: {
  item: Item;
  onItemUpdated: (updatedItem: Partial<Item>) => void;
  onItemDeleted: () => void;
  children?: React.ReactNode;
  hasTransactions?: boolean;
  /** External open (e.g. combobox pencil): controlled + nested above the voucher dialog. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const { toast } = useToast();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const externallyControlled = controlledIsOpen !== undefined;
  const isOpen = externallyControlled ? !!controlledIsOpen : internalIsOpen;
  const setIsOpen = useCallback((o: boolean) => {
    if (!externallyControlled) setInternalIsOpen(o);
    controlledOnOpenChange?.(o);
  }, [externallyControlled, controlledOnOpenChange]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  const [taxRowIndex, setTaxRowIndex] = useState<number | null>(null);
  const [prefillTaxName, setPrefillTaxName] = useState("");
  const [taxFieldToApply, setTaxFieldToApply] = useState<"purchaseTaxId" | "saleTaxId" | "openingBalanceTaxId" | null>(null);
  const [files, setFiles] = useState<(File | string)[]>([]);
  const initialFileUrlsRef = useRef<string[]>(item.fileUrls || []);
  const { dateSystem, formatDate } = useDate();
  const isMobile = useIsMobile();
  const {
    size: dialogSize,
    position: dialogPosition,
    handleResizeStart,
    handleDragStart,
    resizable: dialogResizable,
  } = usePersistedResizableDialogSize(isOpen, !isMobile);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as Resolver<z.infer<typeof formSchema>>,
    defaultValues: getInitialFormValues(item),
  });

  const openingBalanceDateMissing = useMasterOpeningBalanceDateRequired(form.control);
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "unitConversions"
  });

  const itemType = form.watch('type');
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
  const openingStockQty = form.watch('openingBalance') || 0;
  const openingStockRate = form.watch('openingBalanceRate') || 0;
  const { companyId, company } = useCompany();
  const catalogLocked = isAdminPanelSubscriptionCatalogItemForCompany(companyId, item.id);
  const navigatorOnline = useNavigatorOnline();
  /** IndexedDB/outbox — embedded static/APK par hamesha local mirror path. */
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
  /** Naye file attachments — offline par local staging; online par `uploadItemAvatarAndAttachmentsRemote` */
  const canAttachDocuments = canAddFileImagePdf || canAddAvatar;
  const attachmentsDirty =
    files.some((x) => x instanceof File) ||
    JSON.stringify(files.filter((x): x is string => typeof x === "string")) !==
      JSON.stringify(initialFileUrlsRef.current);
  const onLiveAttachmentFields = useCallback((fields: { fileUrls?: string[] }) => {
    if (fields.fileUrls) {
      setFiles(fields.fileUrls);
      initialFileUrlsRef.current = fields.fileUrls;
    }
  }, []);
  useLiveEntityDocAttachments({
    enabled: isOpen,
    companyId,
    collection: "items",
    entityId: item.id,
    attachmentsDirty,
    preferSqliteMirror: sqliteListsOnlyNoSnapshot,
    onFields: onLiveAttachmentFields,
  });
  const { processedItemGroups, processedTaxes, processedItems } = useVouchers();
  const processedItemGroupsRef = useRef(processedItemGroups);
  const processedTaxesRef = useRef(processedTaxes);
  processedItemGroupsRef.current = processedItemGroups;
  processedTaxesRef.current = processedTaxes;

  const liveStockItem = useMemo(
    () => processedItems.find((row) => row.id === item.id) ?? null,
    [processedItems, item.id]
  );
  const savedUnitConversions = useMemo(
    () => (item.unitConversions || []) as SavedItemUnitConversion[],
    [item.unitConversions]
  );
  const currentStockUnits = useMemo(() => listSavedItemUnits(item), [item]);
  const defaultStockUnit =
    item.openingBalanceUnit ||
    itemSmallestUnit(savedUnitConversions, item.openingBalanceUnit) ||
    currentStockUnits[0] ||
    "";
  const [stockDisplayUnit, setStockDisplayUnit] = useState(defaultStockUnit);
  useEffect(() => {
    if (!isOpen) return;
    const conversions = (item.unitConversions || []) as SavedItemUnitConversion[];
    setStockDisplayUnit(
      item.openingBalanceUnit || itemSmallestUnit(conversions, item.openingBalanceUnit) || ""
    );
  }, [isOpen, item.id]);

  const handleGroupCreated = (newGroupId: string) => {
    form.setValue('groupId', newGroupId);
    setIsCreateGroupOpen(false);
  };

  // CreateItemDialog jaisa: system parents chhupo + Ungrouped synthetic row (duplicate-safe)
  
  const handleTaxCreated = (newTaxId: string, newTax?: { id: string; name: string; rate: number; balance?: number; companyId: string; groupId?: string }) => {
    if (newTaxId) {
      if (taxFieldToApply) {
        form.setValue(taxFieldToApply, newTaxId);
        setTaxFieldToApply(null);
      }
      if (newTax) {
        setTaxes((prev) => (prev.some((t) => t.id === newTaxId) ? prev : [...prev, { ...newTax, balance: newTax.balance ?? 0 } as Tax]));
      }
    }
    setIsCreateTaxOpen(false);
    setTaxRowIndex(null);
  }

  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    const fallbackGroups = () => {
      const g = (processedItemGroupsRef.current || []) as unknown as ItemGroup[];
      if (g.length > 0) setGroups(g);
    };
    const fallbackTaxes = () => {
      const t = (processedTaxesRef.current || []) as unknown as Tax[];
      if (t.length > 0) setTaxes(t);
    };

    /** APK cloud + pure-local: redundant Firestore snapshots band — SQLite mirror authoritative. */
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
            setGroups(gRows.map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as ItemGroup)));
          }
          if (tRows.length) {
            setTaxes(tRows.map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as Tax)));
          }
        } catch (e) {
          console.warn("[EditItemDialog] SQLite mirror lists failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const qGroups = query(collection(firestore, `companies/${companyId}/item_groups`));
    const unsubGroups = onSnapshot(
      qGroups,
      (querySnapshot) => {
        setGroups(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ItemGroup)));
      },
      (error) => {
        console.error("Error fetching groups:", error);
        const fallback = (processedItemGroupsRef.current || []) as unknown as ItemGroup[];
        if (fallback.length > 0) setGroups(fallback);
      }
    );

    const qTaxes = query(collection(firestore, `companies/${companyId}/taxes`));
    const unsubTaxes = onSnapshot(
      qTaxes,
      (snapshot) => {
        setTaxes(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Tax)));
      },
      (error) => {
        console.error("Error fetching taxes:", error);
        const fallback = (processedTaxesRef.current || []) as unknown as Tax[];
        if (fallback.length > 0) setTaxes(fallback);
      }
    );

    return () => {
      unsubGroups();
      unsubTaxes();
    };
  }, [isOpen, companyId, toast, processedItemGroups, processedTaxes, sqliteListsOnlyNoSnapshot]);


  useEffect(() => {
    if (isOpen) {
      const dateValue = (item as any).openingBalanceDate;
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

      const baseValues: ItemFormValues = {
        name: item.name,
        aliasName: (((item as unknown) as { aliasName?: string }).aliasName) || "",
        type: item.type,
        hsCode: (item as any).hsCode || "",
        salePrice: item.salePrice,
        isSalePriceTaxInclusive: (item as any).isSalePriceTaxInclusive || false,
        purchasePrice: item.purchasePrice,
        isPurchasePriceTaxInclusive: (item as any).isPurchasePriceTaxInclusive || false,
        openingBalance: item.openingBalance,
        openingBalanceUnit: (item as any).openingBalanceUnit || "",
        openingBalanceTaxId: (item as any).openingBalanceTaxId || "",
        openingBalanceDate: finalDate,
        openingBalanceRate: (item as any).openingBalanceRate || 0,
        isOpeningBalanceTaxInclusive: (item as any).isOpeningBalanceTaxInclusive || false,
        groupId: normalizeItemEditGroupId(item.groupId, item.type),
        unitConversions: item.unitConversions || [],
        salePriceUnit: item.salePriceUnit || "",
        purchasePriceUnit: (item as any).purchasePriceUnit || "",
        lowStockWarning: Number((item as any).lowStockWarning ?? 0) || 0,
        lowStockWarningUnit: (item as any).lowStockWarningUnit || "",
        saleTaxId: item.saleTaxId || "",
        purchaseTaxId: item.purchaseTaxId || "",
        openingBalanceNarration: item.openingBalanceNarration ?? "",
      };
      if (catalogLocked) {
        const openingUnit = subscriptionCatalogDefaultOpeningBalanceUnit(
          (item as any).openingBalanceUnit
        );
        const openingQty =
          item.openingBalance > 0 ? item.openingBalance : ADMIN_PANEL_SUBSCRIPTION_CATALOG_OPENING_STOCK_QTY;
        form.reset({
          ...baseValues,
          openingBalance: openingQty,
          openingBalanceUnit: openingUnit,
          unitConversions: subscriptionCatalogUnitConversions(),
          openingBalanceDate: finalDate ?? (openingQty > 0 ? new Date() : undefined),
        });
        void fetchAdminPanelSubscriptionCatalogFields(item.id).then((catalog) => {
          if (!catalog) return;
          const openingRate =
            Number((item as any).openingBalanceRate) > 0
              ? Number((item as any).openingBalanceRate)
              : catalog.openingBalanceRate;
          form.reset({
            ...baseValues,
            ...catalog,
            openingBalance: openingQty,
            openingBalanceUnit: subscriptionCatalogDefaultOpeningBalanceUnit(catalog.openingBalanceUnit),
            openingBalanceRate: openingRate,
            openingBalanceDate: finalDate ?? (openingQty > 0 ? new Date() : undefined),
            saleTaxId: item.saleTaxId || "",
            purchaseTaxId: item.purchaseTaxId || "",
            isSalePriceTaxInclusive: (item as any).isSalePriceTaxInclusive || false,
            isPurchasePriceTaxInclusive: (item as any).isPurchasePriceTaxInclusive || false,
            unitConversions: catalog.unitConversions,
          });
        });
      } else {
        form.reset(baseValues);
      }
      setFiles(item.fileUrls || []);
      initialFileUrlsRef.current = item.fileUrls || [];
    }
  }, [isOpen, item, form, catalogLocked]);

  async function onSubmit(values: z.infer<typeof formSchema>): Promise<void> {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    // APK Firestore lane offline — save block (banner + disables match).
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }

    let submitValues = values;
    if (catalogLocked) {
      const catalog = await fetchAdminPanelSubscriptionCatalogFields(item.id);
      if (catalog) {
        submitValues = {
          ...values,
          ...catalog,
          type: catalog.type,
          openingBalance: values.openingBalance > 0 ? values.openingBalance : catalog.openingBalance,
          openingBalanceUnit: catalog.openingBalanceUnit,
          openingBalanceRate:
            Number(values.openingBalanceRate) > 0
              ? values.openingBalanceRate
              : catalog.openingBalanceRate,
          openingBalanceTaxId: values.openingBalanceTaxId || "",
          openingBalanceNarration: values.openingBalanceNarration || "",
          openingBalanceDate: values.openingBalanceDate,
          isOpeningBalanceTaxInclusive: values.isOpeningBalanceTaxInclusive,
          unitConversions: catalog.unitConversions,
          saleTaxId: values.saleTaxId,
          purchaseTaxId: values.purchaseTaxId,
          isSalePriceTaxInclusive: values.isSalePriceTaxInclusive,
          isPurchasePriceTaxInclusive: values.isPurchasePriceTaxInclusive,
        };
      }
    }

    const filesSnap = files;
    const itemRefSnap = item;
    const attachmentBaselineSnap = captureFormAttachmentBaseline(initialFileUrlsRef.current);

    setIsOpen(false); // Item edit sheet/dialog band turant; uploads + updateDoc background

    void (async () => {
      const toastId = sonnerToast.loading("Updating item...");
      setIsLoading(true);
      try {
        const { prepareMasterDocumentSlotsForSave } = await import(
          "@/lib/attachmentRecompressOnSave"
        );
        const preparedFiles = await prepareMasterDocumentSlotsForSave(filesSnap, { companyId });
        const existingFileUrls = preparedFiles.filter((f): f is string => typeof f === "string");
        const newFilesToUpload = preparedFiles.filter((f): f is File => f instanceof File);

        let fileUrls: string[] = [];

        // Static / local lane: attach local stage; APK Firestore company par remote/upload path neeche
        if (localSqlMirror) {
          fileUrls = [...existingFileUrls];
          if (newFilesToUpload.length > 0 && canAttachDocuments) {
            const staged = await stageItemAvatarAndAttachments({
              companyId,
              itemId: itemRefSnap.id,
              avatarFile: null,
              attachmentFiles: newFilesToUpload,
              maxAttachments: 5,
            });
            fileUrls = [...fileUrls, ...staged.newAttachmentUrls];
          }
        } else {
          // Item attachments — `canAddFileImagePdf` bina sirf `canAddAvatar` pe mat roko (CreateItemDialog jaisa)
          if (canAttachDocuments && newFilesToUpload.length > 0) {
            const totalNewBytes = newFilesToUpload.reduce((s, f) => s + (f.size || 0), 0);
            const limitCheck = await checkStorageLimitSafe(
              companyId,
              company?.planId,
              { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes },
              company?.storageOption
            );
            if (!limitCheck.allowed) {
              sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
              return;
            }
          }

          if (canAttachDocuments && newFilesToUpload.length > 0) {
            const staged = await uploadItemAvatarAndAttachmentsRemote({
              companyId,
              itemId: itemRefSnap.id,
              avatarFile: null,
              attachmentFiles: newFilesToUpload,
              maxAttachments: 5,
            });
            const totalNewBytes = newFilesToUpload.reduce((s, f) => s + f.size, 0);
            if (totalNewBytes > 0) {
              await incrementCompanyStorage(companyId, {
                attachmentsBytes: totalNewBytes,
                storageBytes: totalNewBytes,
              });
            }
            fileUrls = [...existingFileUrls, ...staged.newAttachmentUrls];
          } else {
            fileUrls = [...existingFileUrls];
          }
        }

        const narrationClean = submitValues.openingBalanceNarration?.trim() || null;
        const balance = (submitValues.openingBalance || 0) * (submitValues.openingBalanceRate || 0);
        const stockQty = computeItemStockQty(submitValues);

        /** Explicit fields — `undefined` Firestore / SQLite JSON me avoid */
        const updatePayload: Record<string, unknown> = {
          name: submitValues.name,
          aliasName: (submitValues.aliasName ?? "").trim(),
          type: submitValues.type,
          hsCode: submitValues.hsCode?.trim() || null,
          salePrice: submitValues.salePrice,
          isSalePriceTaxInclusive: submitValues.isSalePriceTaxInclusive,
          purchasePrice: submitValues.purchasePrice,
          isPurchasePriceTaxInclusive: submitValues.isPurchasePriceTaxInclusive,
          openingBalance: submitValues.openingBalance,
          openingBalanceUnit: submitValues.openingBalanceUnit || null,
          openingBalanceTaxId: submitValues.openingBalanceTaxId || null,
          isOpeningBalanceTaxInclusive: submitValues.isOpeningBalanceTaxInclusive || false,
          openingBalanceDate: submitValues.openingBalanceDate || null,
          openingBalanceRate: submitValues.openingBalanceRate ?? 0,
          groupId: submitValues.groupId || null,
          unitConversions: submitValues.unitConversions || [],
          salePriceUnit: submitValues.salePriceUnit || null,
          purchasePriceUnit: submitValues.purchasePriceUnit || null,
          lowStockWarning: Number(submitValues.lowStockWarning ?? 0) || 0,
          lowStockWarningUnit: submitValues.lowStockWarningUnit || null,
          saleTaxId: submitValues.saleTaxId || null,
          purchaseTaxId: submitValues.purchaseTaxId || null,
          openingBalanceNarration: narrationClean,
          fileUrls: catalogLocked ? item.fileUrls || [] : fileUrls,
          ...(catalogLocked ? { systemGenerated: true, catalogSource: "admin_plans" } : {}),
        };

        if (localSqlMirror) {
          const fromDb = await getCompanyDocFromBrowserDb(companyId, "items", itemRefSnap.id);
          const base: Record<string, unknown> = fromDb ?? {
            id: itemRefSnap.id,
            companyId,
            ownerId: user?.uid ?? (itemRefSnap as any).ownerId,
            debit: itemRefSnap.debit ?? 0,
            credit: itemRefSnap.credit ?? 0,
            balance: itemRefSnap.balance ?? 0,
            stockQty: itemRefSnap.stockQty ?? 0,
            isDeleted: false,
            createdAt: (itemRefSnap as any).createdAt ?? new Date().toISOString(),
          };
          const payload: Record<string, unknown> = {
            ...base,
            ...updatePayload,
            balance,
            stockQty,
            id: itemRefSnap.id,
            companyId,
          };
          await upsertCompanyDocInBrowserDb(companyId, "items", itemRefSnap.id, payload);
          await enqueueCompanyDocOutbox(companyId, "items", "update", itemRefSnap.id, payload);
          const backupSyncEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1";
          const isLocalGuestUser = user?.uid === "local_guest_user";
          const showSyncHint = backupSyncEnabled && !isLocalGuestUser;
          setFiles(fileUrls);
          initialFileUrlsRef.current = fileUrls;
          setTimeout(() => {
            onItemUpdated({
              id: itemRefSnap.id,
              ...submitValues,
              fileUrls: catalogLocked ? itemRefSnap.fileUrls || [] : fileUrls,
              openingBalanceNarration: submitValues.openingBalanceNarration?.trim() || "",
            });
          }, 100);
          sonnerToast.success(showSyncHint ? "Updated. Will sync when online." : "Item Updated!", {
            id: toastId,
            description: showSyncHint
              ? `"${values.name}" saved locally.`
              : `"${values.name}" has been successfully updated.`,
          });
          finalizeFormAttachmentEditAfterSave({
            companyId,
            baselineUrls: attachmentBaselineSnap,
            finalUrls: fileUrls,
            oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
          });
          return;
        }

        const { persistMasterEntityUpdate } = await import("@/lib/masterEntityUpdatePersist");
        await persistMasterEntityUpdate({
          companyId,
          collection: "items",
          docId: itemRefSnap.id,
          patch: updatePayload,
        });

        finalizeFormAttachmentEditAfterSave({
          companyId,
          baselineUrls: attachmentBaselineSnap,
          finalUrls: fileUrls,
          oldDocRemoteUrls: attachmentBaselineSnap.filter((u) => /^https?:\/\//i.test(u)),
        });

        setFiles(fileUrls);
        initialFileUrlsRef.current = fileUrls;
        setTimeout(() => {
          onItemUpdated({
            id: itemRefSnap.id,
            ...values,
            fileUrls,
            openingBalanceNarration: values.openingBalanceNarration?.trim() || "",
          });
        }, 100);
        sonnerToast.success("Item Updated!", { id: toastId, description: `"${values.name}" has been successfully updated.` });
      } catch (error) {
        console.error("Error updating item:", error);
        sonnerToast.error("Error Updating Item", {
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
      sonnerToast.error("Cannot Delete", { description: "This item has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    
    setIsLoading(true);
    try {
        const res = await softDeleteCompanySubdocToRecycleBin(companyId, "items", item.id, user?.uid || "");
        if (!res.ok) throw new Error("error" in res ? res.error : "delete failed");
        toast({ title: "Item Moved to Bin", description: `"${item.name}" has been moved to the recycle bin.`});
        onItemDeleted();
        setIsOpen(false);
        setIsDeleteDialogOpen(false);
    } catch (error) {
        console.error("Error deleting item: ", error);
        toast({
            variant: "destructive",
            title: "Delete Failed",
            description: "An error occurred while deleting the item.",
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
      sonnerToast.error("Cannot Delete", { description: "This item has transactions and cannot be deleted." });
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(companyId, "items", item.id);
      toast({
        title: "Item deleted permanently",
        description: `"${item.name}" was permanently deleted.`,
      });
      onItemDeleted();
      setIsOpen(false);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error permanently deleting item: ", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "Could not permanently delete the item.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    if (!canAttachDocuments) {
      e.target.value = "";
      toast({ variant: "destructive", title: "Not allowed", description: "Your plan does not allow adding attachments." });
      return;
    }
    const newFiles = Array.from(e.target.files);
    e.target.value = "";

    let accumulated = [...files];
    for (const file of newFiles) {
      if (accumulated.length >= 5) {
        toast({ variant: "destructive", title: "Limit Reached", description: "You can upload up to 5 documents." });
        break;
      }
      // Local staging `stageItemAvatarAndAttachments` invalid types chhod deta hai — yahan pe clear error
      if (!isProfileDocumentFile(file)) {
        toast({ variant: "destructive", title: "Invalid file", description: "Use images or PDF only." });
        continue;
      }
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
          description: `Please select images under ${MAX_IMAGE_MB_BEFORE_COMPRESS} MB (they will be compressed).`,
        });
        continue;
      }
      try {
        const { file: compressedFile, maxBytes, maxKb } = await compressImageForCompany(file, companyId);
        
        accumulated = [...accumulated, compressedFile];
      } catch (err) {
        console.error("File compression error:", err);
        toast({ variant: "destructive", title: "File Error", description: "Could not process the file." });
      }
    }
    setFiles(accumulated);
  };
  
  const removeFile = (indexToRemove: number) => {
    setFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  }


    const allUnits = useMemo(() => {
      const set = new Set(
        watchedUnitConversions?.flatMap((uc) => [uc.fromUnit, uc.toUnit]).filter(Boolean) || []
      );
      if (catalogLocked) {
        ADMIN_PANEL_SUBSCRIPTION_BILLING_UNITS.forEach((u) => set.add(u));
        set.add(ADMIN_PANEL_SUBSCRIPTION_YEARLY_UNIT);
      }
      const ob = watchedOpeningBalanceUnit;
      if (ob) set.add(ob);
      return Array.from(set);
    }, [watchedUnitConversions, catalogLocked, watchedOpeningBalanceUnit]);
  
    const unitPrices = useMemo(() => {
        const prices: Record<string, { purchase: number; sale: number; purchaseTax: number; saleTax: number; }> = {};
        const conversions = watchedUnitConversions || [];
        if (conversions.length === 0 || !conversions[0].toUnit) return prices;

        const smallestUnit = conversions[conversions.length - 1].toUnit;

        const purchaseTaxRate = taxes.find(t => t.id === watchedPurchaseTaxId)?.rate || 0;
        const saleTaxRate = taxes.find(t => t.id === watchedSaleTaxId)?.rate || 0;

        let basePurchasePrice = Number(watchedPurchasePrice) || 0;
        if (watchedIsPurchaseTaxInclusive) {
            basePurchasePrice = parseFloat((basePurchasePrice / (1 + purchaseTaxRate / 100)).toFixed(10));
        }
        if (watchedPurchasePriceUnit && smallestUnit && watchedPurchasePriceUnit !== smallestUnit) {
            let factor = 1;
            let current = watchedPurchasePriceUnit;
            while (current !== smallestUnit) {
                const conv = conversions.find((c) => c.fromUnit === current);
                if (!conv) { factor = 0; break; }
                factor *= Number(conv.conversionFactor) || 1;
                current = conv.toUnit;
            }
            basePurchasePrice /= (factor || 1);
        }

        let baseSalePrice = Number(watchedSalePrice) || 0;
        if (watchedIsSalePriceTaxInclusive) {
            baseSalePrice = parseFloat((baseSalePrice / (1 + saleTaxRate / 100)).toFixed(10));
        }
        if (watchedSalePriceUnit && smallestUnit && watchedSalePriceUnit !== smallestUnit) {
            let factor = 1;
            let current = watchedSalePriceUnit;
            while (current !== smallestUnit) {
                const conv = conversions.find((c) => c.fromUnit === current);
                if (!conv) { factor = 0; break; }
                factor *= Number(conv.conversionFactor) || 1;
                current = conv.toUnit;
            }
            baseSalePrice /= (factor || 1);
        }

        allUnits.forEach((unit) => {
            let purchasePriceForUnit = basePurchasePrice;
            let salePriceForUnit = baseSalePrice;

            if (unit !== smallestUnit) {
                let factor = 1;
                let current = unit;
                 while (current !== smallestUnit) {
                  const conv = conversions.find((c) => c.fromUnit === current);
                  if (!conv) { factor = 0; break; }
                  factor *= Number(conv.conversionFactor) || 1;
                  current = conv.toUnit;
                }
                purchasePriceForUnit *= factor;
                salePriceForUnit *= factor;
            }

            prices[unit] = {
                purchase: purchasePriceForUnit,
                sale: salePriceForUnit,
                purchaseTax: purchasePriceForUnit * (purchaseTaxRate / 100),
                saleTax: salePriceForUnit * (saleTaxRate / 100),
            };
        });

        return prices;
    }, [allUnits, watchedUnitConversions, watchedPurchasePrice, watchedSalePrice, watchedPurchasePriceUnit, watchedSalePriceUnit, watchedPurchaseTaxId, watchedSaleTaxId, taxes, watchedIsPurchaseTaxInclusive, watchedIsSalePriceTaxInclusive]);
    
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
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {children ? <DialogPlainOpener onOpen={() => setIsOpen(true)}>{children}</DialogPlainOpener> : null}
        {/* Mobile: 85vh height, 98vw width. PC: 90% screen height & width (90vh / 90vw) so dialog uses most of viewport. */}
        <DialogContent
            data-pl-item-form-dialog=""
            hideCloseButton={dialogResizable}
            overlayClassName={externallyControlled ? NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN : undefined}
            className={cn(
              externallyControlled && NESTED_LEDGER_MASTER_EDIT_CONTENT_CN,
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
              <DialogHeader className={cn(masterEntityDialogHeaderClassName, "space-y-0.5 p-0 text-left")}>
                <DialogTitle>Edit Item/Service</DialogTitle>
                <DialogDescription>Update the details for {item.name}.</DialogDescription>
              </DialogHeader>
            </MasterEntityDialogDragRibbon>
          ) : (
            <DialogHeader className={masterEntityDialogHeaderClassName}>
              <DialogTitle>Edit Item/Service</DialogTitle>
              <DialogDescription>Update the details for {item.name}.</DialogDescription>
            </DialogHeader>
          )}
          <div className={cn(masterEntityDialogFormWrapperClassName, dialogResizable && "px-6 pb-4")}>
          <div className="pl-master-form-scroll min-h-0 flex-1 overflow-y-auto pr-1">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                {catalogLocked ? (
                  <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                    Subscription catalog item — name and rates sync from Admin → Plans &amp; add-on pricing.
                    Only purchase/sale tax can be edited here.
                  </p>
                ) : null}
                <Tabs
                  value={itemType}
                  onValueChange={(v) => {
                    if (!catalogLocked) form.setValue("type", v as "item" | "service");
                  }}
                >
                <TabsList>
                  <TabsTrigger value="item" disabled={catalogLocked}>Item</TabsTrigger>
                  <TabsTrigger value="service" disabled={catalogLocked}>Service</TabsTrigger>
                </TabsList>
              </Tabs>
                 <div className="space-y-4 py-4">
            <div data-pl-item-top-card="" className="border p-4 rounded-md"><div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2"><FormField
                control={form.control}
                name="name"
                render={({ field }: any) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Item Name</FormLabel>
                      {itemType === "item" && liveStockItem ? (() => {
                        const stockUnit =
                          stockDisplayUnit && currentStockUnits.includes(stockDisplayUnit)
                            ? stockDisplayUnit
                            : defaultStockUnit;
                        const selectedQty = qtyInSavedItemUnit(
                          Number(liveStockItem.stockQty) || 0,
                          savedUnitConversions,
                          stockUnit
                        );
                        return (
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={cn(
                                "shrink-0 tabular-nums text-sm",
                                selectedQty >= 0 ? "text-green-600" : "text-red-600"
                              )}
                            >
                              {selectedQty.toFixed(2)}
                            </span>
                            {currentStockUnits.length > 0 ? (
                              <Select value={stockUnit} onValueChange={setStockDisplayUnit}>
                                <SelectTrigger className="h-6 w-auto min-w-0 shrink-0 rounded-sm px-1.5 py-0 text-xs gap-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {currentStockUnits.map((u) => (
                                    <SelectItem key={u} value={u}>
                                      {qtyInSavedItemUnit(Number(liveStockItem.stockQty) || 0, savedUnitConversions, u).toFixed(2)} {u}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                        );
                      })() : null}
                    </div>
                    <FormControl>
                      <Input
                        placeholder="e.g., T-Shirt (Red)"
                        className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")}
                        readOnly={catalogLocked}
                        {...field}
                      />
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
                        className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")}
                        readOnly={catalogLocked}
                        {...field}
                      />
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
                      <Input
                        placeholder="Enter HS Code"
                        className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")}
                        readOnly={catalogLocked}
                        {...field}
                      />
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
                      disabled={catalogLocked}
                      value={field.value}
                      onChange={(value, newName) => {
                        if (catalogLocked) return;
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
            </div></div>
            
            <div className="space-y-4 border p-4 rounded-md">
                <FormLabel className="text-base font-semibold">Unit Conversions</FormLabel>
                <div className="w-full overflow-x-auto overflow-y-visible -mx-1 px-1">
                <div className="space-y-2 min-w-[560px] pr-2">
                {fields.map((field, index) => {
                    const isLastRow = index === fields.length - 1;
                    return (
                        <div key={field.id} className="grid grid-cols-11 items-end gap-2">
                            <div className="col-span-1 flex items-center justify-center font-bold">1</div>
                             <FormField
                                control={form.control}
                                name={`unitConversions.${index}.fromUnit`}
                                render={({ field: fromUnitField }: any) => (
                                    <FormItem className="col-span-3">
                                        <FormControl>
                                            <Input
                                                className={cn("h-9", index > 0 && "bg-muted cursor-not-allowed")}
                                                placeholder="e.g. Box"
                                                {...fromUnitField}
                                                value={index > 0 ? (form.watch(`unitConversions.${index - 1}.toUnit`) || '') : fromUnitField.value}
                                                readOnly={index > 0}
                                                onBlur={(e) => fromUnitField.onChange(capitalizeFirstLetter(e.target.value))}
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
                                          <FormControl><Input placeholder="e.g. Pcs" className="h-9" {...field} onBlur={(e) => field.onChange(capitalizeFirstLetter(e.target.value))} /></FormControl>
                                          {isLastRow && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-muted px-2 py-0.5 rounded-sm text-muted-foreground">Base Unit</span>}
                                      </div>
                                    </FormItem>
                                )}
                            />
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    )
                })}
                </div>
                </div>
                <Button 
                    type="button" 
                    size="sm" 
                    variant="outline" 
                    className="mt-2"
                     onClick={() => {
                        const lastUnit = fields.length > 0 ? form.getValues(`unitConversions.${fields.length - 1}.toUnit`) : "";
                        append({ fromUnit: lastUnit, toUnit: "", conversionFactor: 1 });
                    }}
                >
                    Add Unit Conversion
                </Button>
              </div>

            {/* Purchase Price, Purchase Unit Prices, Sale Price, Sale Unit Prices: mobile = Purchase Price then Purchase Unit Prices then Sale then Sale Unit Prices; PC = side-by-side (do not remove order classes). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="order-1 sm:order-1 space-y-4 border p-4 rounded-md">
                   <div className="space-y-2">
                        <FormLabel>Purchase Price</FormLabel>
                        <div className="grid grid-cols-2 gap-2">
                            <FormField control={form.control} name="isPurchasePriceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="isPurchasePriceTaxInclusive"/></FormControl><label htmlFor="isPurchasePriceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                            <FormField control={form.control} name="purchaseTaxId" render={({ field }: any) => (<FormItem><Select onValueChange={(value) => { if (value === "add-new") { setTaxFieldToApply("purchaseTaxId"); setIsCreateTaxOpen(true); } else field.onChange(value === "none" ? "" : value);}} value={field.value}><FormControl><SelectTrigger className="w-full h-9"><SelectValue placeholder="Select Tax"/></SelectTrigger></FormControl><SelectContent><SelectItem value="none">None</SelectItem>{taxes.map(t => <SelectItem key={t.id} value={t.id}>{t.name} @ {t.rate}%</SelectItem>)}<SelectItem value="add-new" className="text-primary">+ Add New Tax</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                        <FormField control={form.control} name="purchasePrice" render={({ field }: any) => (<FormItem><FormControl><Input type="number" placeholder="0.00" className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")} readOnly={catalogLocked} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="purchasePriceUnit" render={({ field }: any) => (<FormItem><Select onValueChange={field.onChange} value={field.value} disabled={catalogLocked}><FormControl><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Unit"/></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    </div>
                    <div className="space-y-2">
                        <FormLabel>Low Stock Warning</FormLabel>
                        <div className="flex flex-nowrap items-start gap-2">
                            <FormField control={form.control} name="lowStockWarning" render={({ field }: any) => (<FormItem className="min-w-0 flex-1"><FormControl><Input type="number" min={0} step="any" placeholder="0 (off)" className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")} readOnly={catalogLocked} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} /></FormControl><FormMessage /><p className="text-xs text-muted-foreground">Stock isse kam/barabar ho to dashboard ke Low Stock me dikhega. 0 = off.</p></FormItem>)} />
                            <FormField control={form.control} name="lowStockWarningUnit" render={({ field }: any) => (<FormItem className="shrink-0"><Select onValueChange={field.onChange} value={field.value || ""} disabled={catalogLocked}><FormControl><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Unit"/></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                        </div>
                    </div>
               </div>
                <div className="order-3 sm:order-2 space-y-4 border p-4 rounded-md">
                    <div className="space-y-2">
                        <FormLabel>Sale Price</FormLabel>
                        <div className="grid grid-cols-2 gap-2">
                            <FormField control={form.control} name="isSalePriceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="isSalePriceTaxInclusive"/></FormControl><label htmlFor="isSalePriceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                            <FormField control={form.control} name="saleTaxId" render={({ field }: any) => (<FormItem><Select onValueChange={(value) => { if (value === "add-new") { setTaxFieldToApply("saleTaxId"); setIsCreateTaxOpen(true); } else field.onChange(value === "none" ? "" : value);}} value={field.value}><FormControl><SelectTrigger className="w-full h-9"><SelectValue placeholder="Select Tax"/></SelectTrigger></FormControl><SelectContent><SelectItem value="none">None</SelectItem>{taxes.map(t => <SelectItem key={t.id} value={t.id}>{t.name} @ {t.rate}%</SelectItem>)}<SelectItem value="add-new" className="text-primary">+ Add New Tax</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                       <FormField control={form.control} name="salePrice" render={({ field }: any) => (<FormItem className="flex-1"><FormControl><Input type="number" placeholder="0.00" className={cn("h-9", catalogLocked && "bg-muted cursor-not-allowed")} readOnly={catalogLocked} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
                       <FormField control={form.control} name="salePriceUnit" render={({ field }: any) => (<FormItem><Select onValueChange={field.onChange} value={field.value} disabled={catalogLocked}><FormControl><SelectTrigger className="w-28 h-9"><SelectValue placeholder="Unit"/></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                   </div>
               </div>
                <ScrollArea className="order-2 sm:order-3 w-full">
                    <div className="space-y-2 border p-4 rounded-md min-w-[500px]">
                        <FormLabel className="text-base font-semibold">Purchase Unit Prices</FormLabel>
                        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-x-2 gap-y-2 items-center pr-4">
                            <FormLabel className="pl-[18px]">Unit</FormLabel>
                            <FormLabel className="text-right">Rate</FormLabel>
                            <FormLabel className="text-right">Tax</FormLabel>
                            <FormLabel className="text-right">Total</FormLabel>
                            {allUnits.map((unit) => (
                                <React.Fragment key={`purchase-${unit}`}>
                                    <Input value={unit} readOnly tabIndex={-1} className="h-9 bg-muted cursor-not-allowed font-medium"/>
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
                            <FormLabel className="pl-[18px]">Unit</FormLabel>
                            <FormLabel className="text-right">Rate</FormLabel>
                            <FormLabel className="text-right">Tax</FormLabel>
                            <FormLabel className="text-right">Total</FormLabel>
                            {allUnits.map((unit) => (
                                <React.Fragment key={`sale-${unit}`}>
                                    <Input value={unit} readOnly tabIndex={-1} className="h-9 bg-muted cursor-not-allowed font-medium"/>
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
            
            <div className="space-y-4">
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
                            <FormControl><Input type="number" placeholder="0" className="h-9" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} /></FormControl>
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
                            <Select
                              onValueChange={field.onChange}
                              value={
                                field.value ||
                                (catalogLocked ? ADMIN_PANEL_SUBSCRIPTION_YEARLY_UNIT : "")
                              }
                            >
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
                            <FormControl><Input type="number" placeholder="0.00" className="h-9" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} /></FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <div className="space-y-2">
                        <FormField control={form.control} name="isOpeningBalanceTaxInclusive" render={({ field }: any) => (<FormItem className="flex flex-row items-center space-x-2 space-y-0"><FormControl><Checkbox id="isOpeningBalanceTaxInclusive" checked={field.value} onCheckedChange={field.onChange} /></FormControl><label htmlFor="isOpeningBalanceTaxInclusive" className="text-sm font-normal">Inclusive</label></FormItem>)} />
                        <FormField control={form.control} name="openingBalanceTaxId" render={({ field }: any) => (
                        <FormItem>
                           <FormLabel className="sr-only">Tax</FormLabel>
                           <Select onValueChange={(value) => {
                               if (value === "add-new") { setTaxFieldToApply("openingBalanceTaxId"); setIsCreateTaxOpen(true); }
                               else field.onChange(value === "none" ? "" : value);
                           }} value={field.value}>
                           <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Select Tax" /></SelectTrigger></FormControl>
                           <SelectContent>
                               <SelectItem value="none">None</SelectItem>
                               {taxes.map((t) => (
                                   <SelectItem key={t.id} value={t.id}>{t.name} @ {t.rate}%</SelectItem>
                               ))}
                               <SelectItem value="add-new" className="text-primary">+ Add New Tax</SelectItem>
                           </SelectContent>
                           </Select>
                           <FormMessage />
                        </FormItem>
                        )}/>
                    </div>
                    <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl><Input type="number" value={openingStockAmount.toFixed(2)} readOnly className="h-9 bg-muted"/></FormControl>
                    </FormItem>
                 </div>
                </div>
                </div>
                  <div className="flex flex-wrap items-start gap-4">
                  <FormItem className="shrink-0">
                    <FormLabel>Attach Files (Optional)</FormLabel>
                    {!canAttachDocuments ? (
                      <p className="text-xs text-muted-foreground">
                        Upgrade plan to add or change files.{" "}
                        <Link href="/billing" className="text-primary underline font-medium hover:no-underline">Click here to upgrade</Link>
                      </p>
                    ) : (
                    <RestrictedFileUploader>
                      <div className="space-y-2">
                        <MasterPdfAsImageToggle id="edit-item-pdf-as-image" />
                        <div className="flex flex-wrap gap-4">
                          {files.map((file, index) => (
                            <FilePreview isCompressing={isCompressing}
                              key={index}
                              file={file}
                              attachmentCompanyId={companyId ?? undefined}
                              attachmentReusePlaceKey={item.id ? `items/${item.id}` : null}
                              onRemove={() => removeFile(index)}
                            />
                          ))}
                          {files.length < 5 && (
                            <FormControl>
                              <AttachmentHoldPasteSurface
                                enabled={canAttachDocuments}
                                onShortActivate={() => fileInputRef.current?.click()}
                                onPastedFiles={(incoming) => void handleFileChange(syntheticFileInputChangeEvent(incoming))}
                                className="relative w-24 h-24 border-2 border-dashed rounded-lg flex flex-col justify-center items-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                              >
                                <Upload className="h-6 w-6" />
                                <span className="text-xs mt-1">Add File</span>
                                <Input
                                  type="file"
                                  className="hidden"
                                  ref={fileInputRef}
                                  onChange={handleFileChange}
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
                  <div className="min-w-[16rem] flex-1">
                  <EntityOpeningBalanceNarrationField
                    control={form.control}
                    name="openingBalanceNarration"
                    detailLabel="item"
                  />
                  </div>
                  </div>
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

              <DialogFooter className={cn(MASTER_DIALOG_FOOTER_ROW_CLASS, "sticky bottom-0 z-10 !justify-end")}>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}>
                    Cancel
                  </Button>
                </DialogClose>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        data-pl-master-delete-btn=""
                        className="shrink-0 whitespace-nowrap px-3 sm:px-4"
                        onClick={() => setIsDeleteDialogOpen(true)}
                        disabled={hasTransactions || apkOfflineViewOnly || catalogLocked}
                      >
                        <Trash2 className="mr-2 h-4 w-4 shrink-0" /> Delete
                      </Button>
                    </TooltipTrigger>
                    {hasTransactions && (
                      <TooltipContent>
                        <p>Cannot delete an item with existing transactions.</p>
                      </TooltipContent>
                    )}
                    {!hasTransactions && apkOfflineViewOnly && (
                      <TooltipContent>
                        <p>Offline — view only.</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <Button
                  type="submit"
                  disabled={
                    isLoading ||
                    isCompressing ||
                    apkOfflineViewOnly ||
                    openingBalanceDateMissing
                  }
                  className="shrink-0"
                  data-pl-master-save-btn=""
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
          </div>
          </div>
          {dialogResizable ? <ResizableDialogEdgeHandles onResizeStart={handleResizeStart} allSides /> : null}
        </DialogContent>
      </Dialog>
      
      <MasterDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        overlayClassName="!z-[120]"
        contentClassName="!z-[121]"
        entityKind="item"
        entityName={item.name}
        onMoveToBin={handleDelete}
        onDeletePermanently={handlePermanentDelete}
        localOnlyCheck={{ companyId, collectionName: "items", docId: item.id }}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
      <CreateItemGroupDialog onGroupCreated={handleGroupCreated} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups} />
      <CreateTaxDialog onTaxCreated={handleTaxCreated} isOpen={isCreateTaxOpen} onOpenChange={(open) => { if (!open) { setPrefillTaxName(""); setTaxFieldToApply(null); } setIsCreateTaxOpen(open); }} prefillTaxName={prefillTaxName} />
    </>
  );
}

