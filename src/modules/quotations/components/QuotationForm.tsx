"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { Printer, Copy, ArrowLeft, Loader2, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionButton } from "@/components/permission";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import usePermissions from "@/hooks/usePermissions";
import { assertCanPermanentDeleteFromForm } from "@/lib/permanentDeleteFromForm";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { useCachedFeatureConfig } from "@/hooks/useCachedFeatureConfig";
import { partitionCompaniesForSelector } from "@/lib/companyStorageKind";
import { visibleCompanySelectorTabs } from "@/lib/companySelectorTabFeatures";
import { QUOTATION_FORM_TABS } from "../constants";
import {
  listQuotations,
  moveQuotationToRecycleBin,
  permanentDeleteQuotation,
  saveQuotation,
} from "../db/quotationRepository";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nextQuotationNumber } from "../quotationNumber";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { useVouchers } from "@/hooks/useVouchers";
import {
  buildSaleDefaultVoucherDataFromQuotation,
  markQuotationConvertedAfterSaleSave,
  prepareQuotationForSaleConvert,
  resolveQuotationLinkedSaleVoucher,
  resolveSaleVoucherForQuotationLink,
  resolveSaleVoucherNumber,
  stripStaleQuotationConversion,
} from "../convertToSale";
import { DATE_LABELS, defaultRecipientName, letterLangFromCountry } from "../letterhead";
import { snapshotQuotationDraftFromDom } from "../html";
import { printQuotationLetter } from "../printQuotationLetter";
import type { QuotationDoc, QuotationDraft, QuotationMasterOption } from "../types";
import { QuotationMasterSelect } from "./QuotationMasterSelect";
import { quotationGrandTotal } from "./QuotationItemsTable";
import { QuotationWordEditor } from "./QuotationWordEditor";
import "../quotation-letter.css";

const qPillCn = cn(
  "quotation-form-pill h-8 rounded-full border-blue-300 px-3 text-xs text-blue-900 shadow-none",
  chromeProPillCn
);
const qMasterPillCn = cn(chromeProPillCn, "quotation-form-pill h-8 rounded-full px-3 text-xs font-normal");

function QuotationPillInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn(chromeProPillCn, "quotation-form-pill inline-flex h-8 items-center overflow-hidden rounded-full")}>
      <input
        {...props}
        className={cn(
          "h-8 min-w-0 appearance-none border-0 bg-transparent px-3 text-xs text-blue-900 shadow-none outline-none ring-0 focus:outline-none focus-visible:ring-0",
          className
        )}
        style={{ background: "transparent", color: "rgb(30 58 138)" }}
      />
    </div>
  );
}

function QuotationAmountPill({
  workspaceRef,
  lineItems,
}: {
  workspaceRef: RefObject<HTMLElement | null>;
  lineItems: QuotationDraft["lineItems"];
}) {
  const { formatCurrencyForPrint } = useDate();
  const fromRows = useMemo(() => quotationGrandTotal(lineItems || []), [lineItems]);
  const [domGrand, setDomGrand] = useState<number | null>(null);
  useLayoutEffect(() => {
    const readDom = () => {
      const root = workspaceRef.current;
      if (!root) {
        setDomGrand(null);
        return;
      }
      const el = root.querySelector<HTMLElement>('[data-q-field="grand-total"]');
      if (!el) {
        setDomGrand(null);
        return;
      }
      const raw = el.getAttribute("data-q-value");
      const parsed = raw != null ? Number(raw) : Number.NaN;
      setDomGrand(Number.isFinite(parsed) ? parsed : null);
    };
    readDom();
    const frame = window.requestAnimationFrame(readDom);
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceRef, lineItems, fromRows]);
  const grandTotal = domGrand ?? fromRows;
  const label = formatCurrencyForPrint(grandTotal, { noSuffix: true });
  return (
    <div
      className={cn(
        "quotation-form-amount-pill inline-flex h-9 min-w-[128px] items-center justify-end rounded-full border px-3 text-base font-semibold tabular-nums"
      )}
      title="Grand total from items"
    >
      {label}
    </div>
  );
}

export function QuotationForm({
  draft,
  onChange,
  existing,
  masters,
  onSaved,
  onCancel,
  onAfterDelete,
}: {
  draft: QuotationDraft;
  onChange: (patch: Partial<QuotationDraft>) => void;
  existing: QuotationDoc[];
  masters: QuotationMasterOption[];
  onSaved: (doc: QuotationDoc) => void;
  onCancel: () => void;
  onAfterDelete?: () => void;
}) {
  const { company, companyId, allCompaniesRegistry } = useCompany();
  const { vouchers, processedItems, processedTaxes } = useVouchers();
  const { user } = useAuth();
  const { can, role } = usePermissions();
  const { formatDateBySystem } = useDate();
  const { featureConfig } = useCachedFeatureConfig();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [saleConvertOpen, setSaleConvertOpen] = useState(false);
  const [saleConvertDefaultData, setSaleConvertDefaultData] = useState<Record<string, unknown> | null>(null);
  const [pendingConvertQuotation, setPendingConvertQuotation] = useState<QuotationDoc | null>(null);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyCompanyId, setCopyCompanyId] = useState(companyId || "");
  const [copyMasterKey, setCopyMasterKey] = useState("");
  const [copySaveTarget, setCopySaveTarget] = useState<{
    companyId: string;
    accountId: string;
    accountKind: QuotationDraft["accountKind"];
    accountName: string;
  } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const isEdit = Boolean(draft.id);
  const isUnsavedDraft = !isEdit;

  const handleMoveQuotationToBin = async () => {
    const id = String(draft.id || "").trim();
    if (!companyId || !id) return;
    setDeleteBusy(true);
    try {
      await moveQuotationToRecycleBin(companyId, id, user?.uid || "");
      toast.success("Quotation moved to recycle bin");
      setIsDeleteDialogOpen(false);
      onAfterDelete?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete quotation");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handlePermanentDeleteQuotation = async () => {
    const id = String(draft.id || "").trim();
    if (!companyId || !id) return;
    try {
      assertCanPermanentDeleteFromForm(can, role);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Permission denied");
      return;
    }
    setDeleteBusy(true);
    try {
      await permanentDeleteQuotation(companyId, id);
      toast.success("Quotation deleted permanently");
      setIsDeleteDialogOpen(false);
      onAfterDelete?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to permanently delete quotation");
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyCompanies = useMemo(() => {
    const rows = (allCompaniesRegistry || []).filter((c) => c?.id);
    return rows;
  }, [allCompaniesRegistry]);

  const visibleTabs = useMemo(() => visibleCompanySelectorTabs(featureConfig), [featureConfig]);
  const buckets = useMemo(() => partitionCompaniesForSelector(copyCompanies), [copyCompanies]);
  const companySections = (
    [
      { key: "local" as const, label: "Local", list: buckets.localTabCompanies },
      { key: "server" as const, label: "PL Server", list: buckets.serverTabCompanies },
      { key: "online" as const, label: "Firebase", list: buckets.onlineTabCompanies },
      { key: "pocketbase" as const, label: "PocketBase", list: buckets.pocketbaseTabCompanies },
    ] as const
  ).filter((sec) => visibleTabs.includes(sec.key));

  const persistDraft = async (): Promise<QuotationDoc | null> => {
    if (!companyId) {
      toast.error("No company selected");
      return null;
    }
    if (!draft.accountId || !draft.accountKind) {
      toast.error("Select an account");
      return null;
    }
    setSaving(true);
    try {
      const live = stripStaleQuotationConversion(
        snapshotQuotationDraftFromDom(workspaceRef.current, draft),
        vouchers
      );
      onChange(live);
      const saved = await saveQuotation(companyId, live, existing, user?.uid);
      onChange({ id: saved.id, quotationNumber: saved.quotationNumber });
      return saved;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveCurrent = async (): Promise<QuotationDoc | null> => {
    if (copySaveTarget) {
      setSaving(true);
      try {
        const live = stripStaleQuotationConversion(
          snapshotQuotationDraftFromDom(workspaceRef.current, draft),
          vouchers
        );
        const targetExisting =
          copySaveTarget.companyId === companyId
            ? existing
            : await listQuotations(copySaveTarget.companyId);
        const toSave: QuotationDraft = {
          ...live,
          id: undefined,
          accountId: copySaveTarget.accountId,
          accountKind: copySaveTarget.accountKind,
          accountName: copySaveTarget.accountName,
          quotationNumber: nextQuotationNumber(
            targetExisting,
            null,
            new Date(live.dateIso || Date.now())
          ),
          convertedSaleId: undefined,
          convertedSaleNumber: undefined,
        };
        const saved = await saveQuotation(
          copySaveTarget.companyId,
          toSave,
          targetExisting,
          user?.uid
        );
        toast.success("Quotation saved for selected account");
        setCopySaveTarget(null);
        onSaved(saved);
        return saved;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
        return null;
      } finally {
        setSaving(false);
      }
    }
    const saved = await persistDraft();
    if (!saved) return null;
    toast.success(isEdit ? "Quotation updated" : "Quotation saved");
    onSaved(saved);
    return saved;
  };

  const openCopyDialog = () => {
    setCopyCompanyId(companyId || "");
    setCopyMasterKey("");
    setCopyDialogOpen(true);
  };

  const beginCopyDraft = () => {
    const targetCompanyId = String(copyCompanyId || companyId || "").trim();
    if (!targetCompanyId) {
      toast.error("Select a company");
      return;
    }
    const targetMaster = masters.find((row) => `${row.kind}:${row.id}` === copyMasterKey);
    if (!targetMaster) {
      toast.error("Select a master account");
      return;
    }
    const live = stripStaleQuotationConversion(
      snapshotQuotationDraftFromDom(workspaceRef.current, draft),
      vouchers
    );
    setCopySaveTarget({
      companyId: targetCompanyId,
      accountId: targetMaster.id,
      accountKind: targetMaster.kind,
      accountName: targetMaster.name,
    });
    onChange({
      ...live,
      id: undefined,
      accountId: targetMaster.id,
      accountKind: targetMaster.kind,
      accountName: targetMaster.name,
      quotationNumber: "",
      convertedSaleId: undefined,
      convertedSaleNumber: undefined,
    });
    setCopyDialogOpen(false);
    toast.info("Copy draft — click Save to create quotation for selected account");
  };

  const handlePrint = async () => {
    if (draft.tabId !== "letter") {
      onChange({ tabId: "letter" });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    const pages = Array.from(workspaceRef.current?.querySelectorAll(".quotation-letter-page") || []) as HTMLElement[];
    if (pages.length === 0) {
      toast.error("Letter page not ready");
      return;
    }
    const dateValue = draft.dateIso ? new Date(draft.dateIso) : new Date();
    const dateLang = draft.dateLabelLang || letterLangFromCountry(company?.country);
    const dateLine = `${DATE_LABELS[dateLang]}: ${formatDateBySystem(dateValue)}`;
    setPrinting(true);
    try {
      await printQuotationLetter({
        pageEls: pages,
        dateLine,
        fileName: `${draft.quotationNumber || "quotation"}.pdf`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  };

  const linkedSaleVoucher = useMemo(
    () => resolveQuotationLinkedSaleVoucher(draft, vouchers),
    [draft.id, draft.accountId, draft.accountKind, draft.convertedSaleId, draft.convertedSaleNumber, vouchers]
  );

  useEffect(() => {
    if (!draft.convertedSaleId && !draft.convertedSaleNumber) return;
    if (linkedSaleVoucher) return;
    onChange({ convertedSaleId: undefined, convertedSaleNumber: undefined });
  }, [
    linkedSaleVoucher,
    draft.convertedSaleId,
    draft.convertedSaleNumber,
    onChange,
  ]);

  const convertButtonLabel = useMemo(() => {
    if (linkedSaleVoucher) {
      const qtNo = String(draft.quotationNumber || "").trim();
      const saleNo = String(linkedSaleVoucher.voucherNumber || draft.convertedSaleNumber || "").trim();
      if (qtNo && saleNo) {
        return `QT No. ${qtNo} converted to ${saleNo}`;
      }
    }
    return "Convert to sale";
  }, [linkedSaleVoucher, draft.quotationNumber, draft.convertedSaleNumber]);

  const handleConvertToSale = async () => {
    if (!companyId || !user?.uid) {
      toast.error("Login and company required");
      return;
    }
    if (isUnsavedDraft) {
      toast.error("Save the quotation first, then convert to sale");
      return;
    }
    if (linkedSaleVoucher) {
      toast.info(convertButtonLabel);
      return;
    }
    setConverting(true);
    try {
      const live = snapshotQuotationDraftFromDom(workspaceRef.current, draft);
      onChange(live);
      const quotation = await prepareQuotationForSaleConvert({
        companyId,
        userId: user.uid,
        draft: live,
        existing,
      });
      if (!quotation) return;
      onChange({ id: quotation.id, quotationNumber: quotation.quotationNumber });
      const defaultVoucherData = buildSaleDefaultVoucherDataFromQuotation(
        quotation,
        processedItems,
        processedTaxes
      );
      setPendingConvertQuotation(quotation);
      setSaleConvertDefaultData(defaultVoucherData);
      setSaleConvertOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  const handleSaleConvertVoucherAction = async (
    status: "saved" | "cancelled",
    _saveAndNew?: boolean,
    newId?: string
  ) => {
    if (status !== "saved") {
      setSaleConvertOpen(false);
      setSaleConvertDefaultData(null);
      setPendingConvertQuotation(null);
      return;
    }
    const saleId = String(newId || "").trim();
    const quotation = pendingConvertQuotation;
    setSaleConvertOpen(false);
    setSaleConvertDefaultData(null);
    setPendingConvertQuotation(null);
    if (!companyId || !user?.uid || !quotation || !saleId) return;
    const linkedSale = await resolveSaleVoucherForQuotationLink(companyId, saleId, quotation);
    if (!linkedSale) {
      toast.error("This sale is not for the selected party — quotation not marked converted.");
      return;
    }
    const saleNumber = String(
      linkedSale.voucherNumber || (await resolveSaleVoucherNumber(companyId, saleId)) || saleId
    ).trim();
    try {
      const updated = await markQuotationConvertedAfterSaleSave({
        companyId,
        userId: user.uid,
        quotation,
        existing,
        saleId,
        saleNumber,
      });
      onChange({
        id: updated.id,
        quotationNumber: updated.quotationNumber,
        convertedSaleId: updated.convertedSaleId,
        convertedSaleNumber: updated.convertedSaleNumber,
      });
      toast.success(
        saleNumber
          ? `Quotation ${updated.quotationNumber} marked converted to ${saleNumber}.`
          : `Quotation ${updated.quotationNumber} marked as converted.`
      );
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark quotation converted");
    }
  };

  const currentFormatLabel =
    QUOTATION_FORM_TABS.find((tab) => tab.id === draft.tabId)?.label || "Letter";

  return (
    <div ref={workspaceRef} className="flex h-full min-h-0 flex-col">
      <div className="quotation-form-ribbon flex flex-shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Button type="button" variant="chromePill" size="icon" className="h-8 w-8" onClick={onCancel} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="max-w-full shrink-0">
            <QuotationMasterSelect
              masters={masters}
              accountId={draft.accountId}
              accountKind={draft.accountKind}
              triggerClassName={qMasterPillCn}
              fitTrigger
              onChange={(master) =>
                onChange({
                  accountId: master?.id || "",
                  accountKind: master?.kind || "",
                  accountName: master?.name || "",
                  recipientName: defaultRecipientName(master?.name || "", company),
                })
              }
            />
          </div>
          <QuotationPillInput
            className="w-[120px]"
            value={draft.quotationNumber}
            onChange={(e) => onChange({ quotationNumber: e.target.value })}
            placeholder="QT-83-84-001"
          />
          <QuotationAmountPill workspaceRef={workspaceRef} lineItems={draft.lineItems} />
          {isUnsavedDraft ? (
            <span
              className="quotation-form-draft-pill inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold"
              title="Not saved yet — use Save before Convert or Copy To"
            >
              Draft
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="chromePill"
            size="sm"
            className="h-8 text-xs"
            disabled={converting || saving || isUnsavedDraft}
            onClick={() => void handleConvertToSale()}
            title={
              isUnsavedDraft
                ? "Save the quotation first"
                : linkedSaleVoucher
                  ? convertButtonLabel
                  : "Open sale form prefilled from this quotation"
            }
          >
            {converting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />}
            {convertButtonLabel}
          </Button>
          <Button
            type="button"
            variant="chromePill"
            size="sm"
            className="h-8 text-xs"
            disabled={printing}
            onClick={() => void handlePrint()}
          >
            {printing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-1 h-3.5 w-3.5" />}
            Print
          </Button>
        </div>
        <AddVoucherDialog
          isOpen={saleConvertOpen}
          onOpenChange={(open) => {
            if (!open) {
              setSaleConvertOpen(false);
              setSaleConvertDefaultData(null);
              setPendingConvertQuotation(null);
            }
          }}
          defaultTab="sale"
          allowedTabs={["sale"]}
          defaultVoucherData={saleConvertDefaultData || undefined}
          onVoucherAction={(status, saveAndNew, newId) => {
            void handleSaleConvertVoucherAction(status, saveAndNew, newId);
          }}
        />
        <VoucherDeleteConfirmAlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          entityKind="quotation"
          entityName={draft.quotationNumber || "Quotation"}
          title="Delete quotation?"
          onMoveToBin={handleMoveQuotationToBin}
          onDeletePermanently={handlePermanentDeleteQuotation}
          busy={deleteBusy}
        />
      </div>
      <Tabs
        value={draft.tabId}
        onValueChange={(v) => onChange({ tabId: v as QuotationDraft["tabId"] })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent value="letter" className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
          <QuotationWordEditor
            key={draft.id || "new"}
            draft={draft}
            onChange={onChange}
            companyCountry={company?.country}
            fyCompany={company}
          />
        </TabsContent>
        {QUOTATION_FORM_TABS.filter((tab) => tab.id !== "letter").map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-0 flex-1">
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              {tab.label} will be added later.
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="quotation-form-ribbon flex flex-shrink-0 justify-center border-t px-2 py-1.5">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          <Select
            value={draft.tabId}
            onValueChange={(v) => onChange({ tabId: v as QuotationDraft["tabId"] })}
          >
            <SelectTrigger className={cn("w-[140px]", qPillCn)}>
              <SelectValue placeholder="Format">{currentFormatLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {QUOTATION_FORM_TABS.map((tab) => (
                <SelectItem key={tab.id} value={tab.id} disabled={!tab.ready && tab.id !== draft.tabId}>
                  {tab.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="chromePill"
            size="sm"
            className="h-8 text-xs"
            disabled={isUnsavedDraft}
            title={isUnsavedDraft ? "Save the quotation first" : "Copy quotation to another account"}
            onClick={openCopyDialog}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy To
          </Button>
          {isEdit && onAfterDelete && !copySaveTarget ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="quotation-form-delete-pill h-8 min-w-[72px] border text-xs font-semibold"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              Delete
            </Button>
          ) : null}
          <PermissionButton
            permission="create_records"
            variant="chromePill"
            size="sm"
            className="h-8 min-w-[88px] text-xs font-semibold"
            disabled={saving}
            onClick={() => void saveCurrent()}
          >
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {copySaveTarget || !isEdit ? "Save" : "Update"}
          </PermissionButton>
        </div>
      </div>
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy quotation to</DialogTitle>
            <DialogDescription>
              Choose company and master account. You can edit the draft, then Save creates a new quotation only for
              that account.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Select value={copyCompanyId} onValueChange={setCopyCompanyId}>
              <SelectTrigger className={cn("w-full", qPillCn)}>
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                {companySections.map((sec) =>
                  sec.list.length === 0 ? null : (
                    <SelectGroup key={sec.key}>
                      <SelectLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        {sec.label}
                      </SelectLabel>
                      {sec.list.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                )}
              </SelectContent>
            </Select>
            <QuotationMasterSelect
              masters={masters}
              accountId={copyMasterKey.includes(":") ? copyMasterKey.slice(copyMasterKey.indexOf(":") + 1) : ""}
              accountKind={
                copyMasterKey.includes(":")
                  ? (copyMasterKey.slice(0, copyMasterKey.indexOf(":")) as QuotationDraft["accountKind"])
                  : ""
              }
              onChange={(master) => setCopyMasterKey(master ? `${master.kind}:${master.id}` : "")}
              placeholder="Master account"
              triggerClassName={cn("w-full", qMasterPillCn)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setCopyDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="chromePill" size="sm" onClick={beginCopyDraft}>
              Open as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
