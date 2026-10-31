"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
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
import { CalendarIcon, Loader2, Upload } from "lucide-react";
import { format } from "date-fns";
import { toast as sonnerToast } from "sonner";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { useDate } from "@/hooks/useDate";
import { firestore } from "@/lib/firebase";
import { collection, doc, Timestamp } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { Combobox } from "@/components/ui/combobox";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { compressFile } from "@/lib/compression";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields, useImageCompressionProcessing } from "@/lib/attachmentCompressionUi";
import {
  MAX_IMAGE_BYTES_AFTER_COMPRESS,
  MAX_IMAGE_MB_AFTER_COMPRESS,
  MAX_PDF_BYTES_BEFORE_UPLOAD,
  MAX_PDF_UPLOAD_MB,
} from "@/lib/fileUploadLimits";
import { RestrictedFileUploader } from "@/components/ui/RestrictedFileUploader";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { apkCloudCompanyOfflineViewOnly } from "@/lib/apkOnlineFirestoreWritePolicy";
import { uploadItemAvatarAndAttachmentsRemote } from "@/lib/entityProfileLocalFiles";
import { writeEntity } from "@/lib/writeGateway";
import { MasterPdfAsImageToggle } from "@/components/common/EntityProfileDocumentsNarrationFields";

const schema = z.object({
  name: z.string().min(2, "Item name must be at least 2 characters."),
  aliasName: z.string().optional(),
  unit: z.string().optional(),
  hsCode: z.string().optional(),
  date: z.date().optional(),
});

type FormValues = z.infer<typeof schema>;

/** Finished-good form only (no Dialog shell) so it can sit inside the Create Item dialog or its own dialog. */
export function CreateFinishedGoodForm({
  isOpen,
  onOpenChange,
  onItemCreated,
  prefillName = "",
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onItemCreated?: (newId: string) => void;
  prefillName?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const isCompressing = useImageCompressionProcessing();
  const [files, setFiles] = useState<(File | string)[]>([]);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const { canAddAvatar } = usePermissions();
  const { dateSystem } = useDate();

  /** APK cloud company offline: finished good create Firebase-only — voucher jaisa Save band. */
  const navigatorOnline = useNavigatorOnline();
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      name: prefillName,
      aliasName: "",
      unit: "",
      hsCode: "",
      date: undefined,
    },
  });

  const [unitData, setUnitData] = useState<{ top20: string[]; allLower: Set<string> }>({ top20: [], allLower: new Set() });
  const newUnitsThisSessionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;
    getDocs(collection(firestore, `companies/${companyId}/items`)).then((snap) => {
      if (cancelled) return;
      const count: Record<string, number> = {};
      const allLower = new Set<string>();
      const add = (u: string) => {
        const t = u?.trim();
        if (!t) return;
        const key = t.toLowerCase();
        allLower.add(key);
        count[t] = (count[t] || 0) + 1;
      };
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.openingBalanceUnit) add(data.openingBalanceUnit);
        if (data.salePriceUnit) add(data.salePriceUnit);
        if (data.purchasePriceUnit) add(data.purchasePriceUnit);
        (data.unitConversions || []).forEach((c: any) => {
          if (c.fromUnit) add(c.fromUnit);
          if (c.toUnit) add(c.toUnit);
        });
      });
      const top20 = Object.entries(count)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([u]) => u);
      setUnitData({ top20, allLower });
    });
    return () => { cancelled = true; };
  }, [isOpen, companyId]);

  useEffect(() => {
    if (isOpen && prefillName) {
      form.setValue("name", prefillName);
    }
  }, [isOpen, prefillName, form]);

  useEffect(() => {
    if (!isOpen) {
      setDatePopoverOpen(false);
      return;
    }
    form.reset({ name: prefillName || "", aliasName: "", unit: "", hsCode: "", date: undefined });
    setFiles([]);
    newUnitsThisSessionRef.current = new Set();
  }, [isOpen]);

  const handleSubmit = async (values: FormValues) => {
    if (!user || !companyId) {
      toast({ variant: "destructive", title: "Error", description: "Login and company required." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }

    const toastId = sonnerToast.loading("Creating finished good...");
    setIsLoading(true);

    try {
      // Recycle-bin duplicate flow: restore or create-new on user choice.
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId,
        collectionName: "items",
        name: values.name.trim(),
        entityLabel: sidebarEntityMenuLabel("items"),
      });
      if (duplicateDecision.decision === "active_exists") {
        sonnerToast.error("Duplicate name", { id: toastId, description: "An item with this name already exists." });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        sonnerToast.success("Item Restored!", {
          id: toastId,
          description: `"${values.name.trim()}" was restored from Recycle Bin.`,
        });
        // Keep callback consistent with component API after restore path.
        onItemCreated?.(duplicateDecision.restoredId);
        onOpenChange(false);
        setIsLoading(false);
        return;
      }

      const itemRef = doc(collection(firestore, `companies/${companyId}/items`));
      const newItemId = itemRef.id;
      let fileUrls: string[] = [];
      const toUpload = files.filter((f): f is File => f instanceof File);
      if (toUpload.length > 0 && canAddAvatar) {
        const totalBytes = toUpload.slice(0, 3).reduce((s, f) => s + (f.size || 0), 0);
        const limitCheck = await checkStorageLimit(companyId, company?.planId, { attachmentsBytes: totalBytes, storageBytes: totalBytes }, company?.storageOption);
        if (!limitCheck.allowed) {
          sonnerToast.error("Storage limit reached", { id: toastId, description: limitCheck.message });
          setIsLoading(false);
          return;
        }
        const preparedFiles: File[] = [];
        for (const file of toUpload) {
          if (preparedFiles.length >= 3) break;
          const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
          let toSend: File;
          if (isPdf) {
            if (file.size > MAX_PDF_BYTES_BEFORE_UPLOAD) {
              sonnerToast.error("PDF too large", { id: toastId, description: `Max ${MAX_PDF_UPLOAD_MB} MB per PDF.` });
              continue;
            }
            toSend = file;
          } else {
            const { file: compressed, maxBytes, maxKb } = await compressImageForCompany(file, companyId);
            
            toSend = compressed;
          }
          preparedFiles.push(toSend);
        }
        if (preparedFiles.length > 0) {
          const staged = await uploadItemAvatarAndAttachmentsRemote({
            companyId,
            itemId: newItemId,
            avatarFile: null,
            attachmentFiles: preparedFiles,
            maxAttachments: 3,
          });
          fileUrls = staged.newAttachmentUrls;
          const uploadedBytes = preparedFiles.reduce((s, f) => s + (f.size || 0), 0);
          if (uploadedBytes > 0) {
            await incrementCompanyStorage(companyId, { attachmentsBytes: uploadedBytes, storageBytes: uploadedBytes });
          }
        }
      }

      const openingBalanceDate = values.date ? (values.date instanceof Date ? values.date : new Date(values.date)) : null;
      const unitTrimmed = values.unit?.trim() || null;
      const submissionData = {
        name: values.name.trim(),
        aliasName: (values.aliasName ?? "").trim(),
        type: "finished_good",
        hsCode: values.hsCode?.trim() || null,
        ownerId: user.uid,
        companyId,
        groupId: null,
        salePrice: 0,
        purchasePrice: 0,
        openingBalance: 0,
        openingBalanceUnit: unitTrimmed,
        openingBalanceTaxId: null,
        isOpeningBalanceTaxInclusive: false,
        openingBalanceDate: openingBalanceDate ? Timestamp.fromDate(openingBalanceDate) : null,
        openingBalanceRate: 0,
        unitConversions: unitTrimmed ? [{ fromUnit: unitTrimmed, toUnit: unitTrimmed, conversionFactor: 1 }] : [],
        fileUrls,
        debit: 0,
        credit: 0,
        balance: 0,
        stockQty: 0,
        createdAt: Timestamp.now(),
        salePriceUnit: unitTrimmed,
        purchasePriceUnit: unitTrimmed,
        saleTaxId: null,
        purchaseTaxId: null,
        isPurchasePriceTaxInclusive: false,
        isSalePriceTaxInclusive: false,
        isDeleted: false,
      };

      const writeRes = await writeEntity({
        companyId,
        collectionName: "items",
        docId: newItemId,
        operation: "create",
        data: submissionData,
      });
      if (writeRes.ok === false) throw new Error(writeRes.error);

      sonnerToast.success("Finished good created", { id: toastId, description: `"${values.name}" added.` });
      onItemCreated?.(newItemId);
      onOpenChange(false);
    } catch (err: any) {
      console.error("Create finished good error:", err);
      sonnerToast.error("Could not create item", { id: toastId, description: err?.message || "Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !canAddAvatar) return;
    const list = Array.from(e.target.files);
    const max = 3 - files.filter((f): f is string => typeof f === "string").length - files.filter((f): f is File => f instanceof File).length;
    for (const file of list.slice(0, max)) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") continue;
      try {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (isPdf) {
          if (file.size > MAX_PDF_BYTES_BEFORE_UPLOAD) {
            sonnerToast.error("PDF too large", { description: `Max ${MAX_PDF_UPLOAD_MB} MB.` });
            continue;
          }
          setFiles((prev) => [...prev, file]);
        } else {
          const { file: compressed, maxBytes, maxKb } = await compressImageForCompany(file, companyId);
          if (compressed.size > maxBytes) {
            sonnerToast.error("Image too large after compress", { description: `Max ${MAX_IMAGE_MB_AFTER_COMPRESS} MB.` });
            continue;
          }
          setFiles((prev) => [...prev, compressed]);
        }
      } catch {
        setFiles((prev) => [...prev, file]);
      }
    }
    e.target.value = "";
  };

  return (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
              <div className="space-y-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., T-Shirt (Red)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="aliasName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alias Name <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Other name on bills / short name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => {
                  const currentUnit = field.value || "";
                  const baseOptions = unitData.top20.map((u) => ({ value: u, label: u }));
                  const options = currentUnit && !unitData.top20.includes(currentUnit)
                    ? [...baseOptions, { value: currentUnit, label: currentUnit }]
                    : baseOptions;
                  return (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Combobox
                        options={options}
                        value={field.value}
                        onChange={(value, newName) => {
                          if (value === "add-new") {
                            const name = (newName || "").trim();
                            if (!name) return;
                            const key = name.toLowerCase();
                            if (unitData.allLower.has(key) || newUnitsThisSessionRef.current.has(key)) {
                              sonnerToast.error("Duplicate unit", { description: `"${name}" already exists.` });
                              return;
                            }
                            newUnitsThisSessionRef.current.add(key);
                            field.onChange(name);
                          } else {
                            field.onChange(value);
                          }
                        }}
                        placeholder="Select unit"
                        addNewLabel="+ Add unit"
                      />
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? format(field.value, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      {dateSystem === "BS" ? (
                        <NepaliCalendar
                          isRange={false}
                          valueAD={field.value}
                          numberOfMonths={1}
                          onSelect={(_bs, adDate) => {
                            const d = adDate instanceof Date ? adDate : new Date(adDate);
                            const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
                            field.onChange(normalized);
                            setDatePopoverOpen(false);
                          }}
                        />
                      ) : (
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={(date) => {
                            field.onChange(date);
                            setDatePopoverOpen(false);
                          }}
                          initialFocus
                        />
                      )}
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hsCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item code (HS Code)</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter HS Code" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <FormLabel>Avatar / Image (optional)</FormLabel>
              {canAddAvatar ? <MasterPdfAsImageToggle id="create-finished-good-pdf-as-image" /> : null}
              <div className="flex flex-wrap gap-2">
                {files.map((file, idx) => (
                  <div key={idx} className="relative">
                    <FilePreview isCompressing={isCompressing}
                      file={file}
                      attachmentCompanyId={companyId ?? undefined}
                      onRemove={canAddAvatar ? () => setFiles((p) => p.filter((_, i) => i !== idx)) : undefined}
                    />
                  </div>
                ))}
                {canAddAvatar && files.length < 3 && (
                  <RestrictedFileUploader>
                    <>
                      <input
                        type="file"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*,application/pdf"
                        multiple
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-1" /> Add file
                      </Button>
                    </>
                  </RestrictedFileUploader>
                )}
              </div>
            </div>
            <DialogFooter className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
              <DialogClose asChild>
                <Button type="button" variant="ghost" className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}>
                  Cancel
                </Button>
              </DialogClose>
              <span className="min-w-0 flex-1" aria-hidden />
              <Button type="submit" disabled={isLoading || isCompressing || apkOfflineViewOnly} className="shrink-0">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create finished good
              </Button>
            </DialogFooter>
          </form>
        </Form>
  );
}

export function CreateFinishedGoodDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onItemCreated?: (newId: string) => void;
  prefillName?: string;
}) {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Finished Good</DialogTitle>
          <DialogDescription>
            Add a new finished good from production. Fill name, date, item code and optional image.
          </DialogDescription>
        </DialogHeader>
        <CreateFinishedGoodForm {...props} />
      </DialogContent>
    </Dialog>
  );
}
