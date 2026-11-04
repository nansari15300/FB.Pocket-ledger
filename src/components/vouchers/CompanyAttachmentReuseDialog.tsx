"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileImage, Info, Loader2, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildCompanyAttachmentCatalogFromVouchers,
  COMPANY_ATTACHMENT_CATALOG_MAX,
  loadCompanyVoucherAttachmentSources,
  matchesCompanyAttachmentCatalogSearch,
} from "@/lib/companyAttachmentCatalog";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { FilePreview } from "@/components/vouchers/FilePreview";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { copyCloudAttachmentRefToCompany } from "@/lib/companyAttachmentRegistry";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import {
  attachmentReuseCopyAsNewEnabled,
} from "@/lib/firebaseBillingOptimization";
import {
  blobToFile,
  fetchBlobForAttachmentHoldPaste,
  type AttachmentHoldPayloadV1,
} from "@/lib/attachmentHoldClipboard";
import { useCompany } from "@/hooks/useCompany";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_ATTACHMENT_REUSE_CONTENT_CN,
  NESTED_VOUCHER_ATTACHMENT_REUSE_OVERLAY_CN,
} from "@/lib/dialogShellChrome";

/** Thumbnail sirf row screen par aane par load — 400+ files par dialog open pe Storage burst nahi. */
function ReuseAttachmentLazyThumb({
  url,
  storagePath,
  attachmentCompanyId,
}: {
  url: string;
  storagePath?: string;
  attachmentCompanyId?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || showPreview) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShowPreview(true);
          io.disconnect();
        }
      },
      { rootMargin: "80px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showPreview]);

  return (
    <div
      ref={rootRef}
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-emerald-600/35 bg-white/80"
    >
      {showPreview ? (
        <FilePreview
          file={url}
          storagePath={storagePath}
          attachmentCompanyId={attachmentCompanyId}
          size={44}
          previewBox={{ width: 44, height: 44 }}
          className="h-11 w-11"
          disabled
          allowPreviewWhenDisabled
          enableHoverFullPreview={false}
          showFormatBadge={false}
          holdAttachmentClipboard={false}
          objectFit="cover"
        />
      ) : (
        <FileImage className="h-4 w-4 text-emerald-700/50" aria-hidden />
      )}
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrls: string[];
  maxFiles: number;
  onAddUrls: (urls: string[]) => void;
  /** Preferred: add as File so save uploads a NEW object (copy-as-new reuse). */
  onAddFiles?: (files: File[]) => void;
};

export function CompanyAttachmentReuseDialog({
  open,
  onOpenChange,
  currentUrls,
  maxFiles,
  onAddUrls,
  onAddFiles,
}: Props) {
  const { companyId, allCompaniesRegistry } = useCompany();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [sourceVouchers, setSourceVouchers] = useState<
    Awaited<ReturnType<typeof loadCompanyVoucherAttachmentSources>>
  >([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const companyOptions = useMemo(() => {
    return [...allCompaniesRegistry]
      .filter((c) => c.isDeleted !== true && (c as { movedToAdminRecycleAt?: unknown }).movedToAdminRecycleAt == null)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
      .map((c) => ({ id: c.id, name: String(c.name || c.id).trim() || c.id }));
  }, [allCompaniesRegistry]);

  const selectedCompanyName =
    companyOptions.find((c) => c.id === selectedCompanyId)?.name ?? selectedCompanyId;
  const currentCompanyName =
    companyOptions.find((c) => c.id === companyId)?.name ?? companyId ?? "this company";

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    if (companyId) setSelectedCompanyId(companyId);
  }, [open, companyId]);

  useEffect(() => {
    if (!open || !selectedCompanyId) {
      setSourceVouchers([]);
      return;
    }
    let cancelled = false;
    setLoadingSources(true);
    void loadCompanyVoucherAttachmentSources(selectedCompanyId)
      .then((rows) => {
        if (!cancelled) setSourceVouchers(rows);
      })
      .catch(() => {
        if (!cancelled) setSourceVouchers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedCompanyId]);

  const exclude = useMemo(() => new Set(currentUrls.filter((u) => typeof u === "string")), [currentUrls]);
  const remaining = Math.max(0, maxFiles - currentUrls.length);

  const catalog = useMemo(
    () => buildCompanyAttachmentCatalogFromVouchers(sourceVouchers, { excludeUrls: exclude }),
    [sourceVouchers, exclude]
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return catalog;
    return catalog.filter((e) => matchesCompanyAttachmentCatalogSearch(e, q));
  }, [catalog, search]);

  const catalogCapped = catalog.length >= COMPANY_ATTACHMENT_CATALOG_MAX;

  const dismissDialog = () => {
    // Click cycle khatam hone do — warna overlay hat te hi neeche Add File tile file picker khol deta hai.
    window.setTimeout(() => {
      onOpenChange(false);
    }, 0);
  };

  const pick = async (url: string) => {
    if (remaining <= 0) {
      toast({ variant: "destructive", title: "Attachment limit reached" });
      return;
    }
    setLinking(url);
    try {
      const crossCompany = Boolean(selectedCompanyId && companyId && selectedCompanyId !== companyId);
      const copyAsNew = attachmentReuseCopyAsNewEnabled();

      // Copy-as-new (default): bytes → File on form, save pe naya upload (sab gates).
      if (copyAsNew && onAddFiles && companyId) {
        const payload: AttachmentHoldPayloadV1 = {
          v: 1,
          src: url,
          n: url.split("/").pop()?.split("?")[0] || "attachment",
          t: "",
          o: "",
        };
        const got = await fetchBlobForAttachmentHoldPaste(payload, undefined, {
          companyId: selectedCompanyId || companyId,
        });
        if (got && got.blob.size > 0) {
          const name = String(got.fileName || "attachment").replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
          const file = blobToFile(got.blob, name || "attachment", got.contentType);
          onAddFiles([file]);
          toast({
            title: "Attachment copied",
            description: crossCompany
              ? `Copied from ${selectedCompanyName}. Save will upload a new file here.`
              : "Copied as a new file for this voucher. Save uploads separately.",
          });
          dismissDialog();
          return;
        }
        // Blob fail → fallback immediate Storage copy (https / local / drive).
        const copiedUrl = await copyCloudAttachmentRefToCompany({
          sourceUrl: url,
          targetCompanyId: companyId,
          targetCompanyName: currentCompanyName,
        });
        onAddUrls([copiedUrl]);
        toast({
          title: "Attachment copied",
          description: "New Storage object created for this company.",
        });
        dismissDialog();
        return;
      }

      if (crossCompany) {
        if (!companyId) throw new Error("Current company is missing.");
        const copiedUrl = await copyCloudAttachmentRefToCompany({
          sourceUrl: url,
          targetCompanyId: companyId,
          targetCompanyName: currentCompanyName,
        });
        onAddUrls([copiedUrl]);
        toast({
          title: "Attachment copied",
          description: `Copied from ${selectedCompanyName} into ${currentCompanyName}.`,
        });
        dismissDialog();
        return;
      }

      // Legacy share-URL mode (env SHARE_URL=1 only).
      const { linkCloudAttachmentRefs } = await import("@/lib/companyAttachmentRegistry");
      let linkUrl = url;
      if (companyId && /^https?:\/\//i.test(url)) {
        try {
          const { ensureSharedHttpsAttachmentCompressed } = await import(
            "@/lib/attachmentRecompressOnSave"
          );
          linkUrl = await ensureSharedHttpsAttachmentCompressed({
            companyId,
            fromUrl: url,
          });
        } catch {
          /* keep original url */
        }
      }
      if (companyId) await linkCloudAttachmentRefs(companyId, [linkUrl]);
      onAddUrls([linkUrl]);
      toast({
        title: "Attachment linked",
        description: `Reused existing ${isDriveFileRef(url) ? "cloud file" : "file"} (shared URL).`,
      });
      dismissDialog();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not copy attachment",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLinking(null);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        data-pl-reuse-dialog
        overlayClassName={NESTED_VOUCHER_ATTACHMENT_REUSE_OVERLAY_CN}
        className={cn(
          NESTED_VOUCHER_ATTACHMENT_REUSE_CONTENT_CN,
          "flex h-[90vh] max-h-[90vh] min-h-0 w-[min(100vw-0.75rem,42rem)] max-w-2xl flex-col gap-2 overflow-hidden sm:gap-3",
          "rounded-xl border-2 border-emerald-500/75 pl-dashboard-ribbon-emerald bg-emerald-50/90 sm:rounded-lg sm:gap-4"
        )}
        // Portal DOM body pe hai, lekin React bubble Add File tile tak jata hai → file picker.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="shrink-0 space-y-1">
          <div className="flex items-center gap-1.5 pr-8">
            <DialogTitle className="text-left">Reuse company attachment</DialogTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="About reuse"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-w-[18rem] text-xs leading-snug">
                Picks a file already on another voucher and copies it as a new attachment here. Save
                uploads a separate file — deleting this voucher only removes its own copy.
              </PopoverContent>
            </Popover>
          </div>
          {/* Screen readers — visual intro is in the Info popover (esp. mobile APK). */}
          <DialogDescription className="sr-only">
            Copy a company attachment as a new file on this voucher. Each voucher keeps its own
            Storage copy.
          </DialogDescription>
        </DialogHeader>
        <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {loadingSources ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading attachments from {selectedCompanyName || "company"}…
            </span>
          ) : search.trim() ? (
            <>
              <span className="font-medium text-foreground">{filtered.length}</span>{" "}
              {filtered.length === 1 ? "match" : "matches"} of{" "}
              <span className="font-medium text-foreground">{catalog.length}</span> file
              {catalog.length !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{catalog.length}</span> reusable file
              {catalog.length !== 1 ? "s" : ""}
            </>
          )}
          {!loadingSources && catalogCapped ? ` (first ${COMPANY_ATTACHMENT_CATALOG_MAX} shown)` : null}
          {!loadingSources ? (
            <span className="block text-[10px] opacity-80">
              From vouchers in {selectedCompanyName || "selected company"}.
            </span>
          ) : null}
        </p>
        <ScrollArea
          listChrome
          className="min-h-0 flex-1 rounded-xl border-2 border-emerald-600/50 bg-emerald-50/50"
        >
          {loadingSources ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : catalog.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No reusable attachments found in {selectedCompanyName || "this company"}.
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No files match your search.</p>
          ) : (
            <ul className="space-y-1.5 px-[2px] py-1.5 sm:px-2 sm:py-2">
              {filtered.map((entry) => {
                const usedOnFull = entry.voucherNumbers.join(", ");
                const usedOn =
                  entry.voucherNumbers.slice(0, 3).join(", ") +
                  (entry.voucherNumbers.length > 3 ? ` +${entry.voucherNumbers.length - 3}` : "");
                const storagePath = tryGetStoragePathFromFirebaseDownloadUrl(entry.url) ?? undefined;
                return (
                  <li
                    key={entry.url}
                    data-pl-reuse-row=""
                    className={cn(
                      "grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-2 px-2 py-1.5 sm:gap-2.5 sm:rounded-lg",
                      "!border-emerald-500/75 pl-dashboard-ribbon-emerald shadow-sm",
                      remaining <= 0 && "opacity-60",
                      linking === entry.url && "opacity-80"
                    )}
                  >
                    <ReuseAttachmentLazyThumb
                      url={entry.url}
                      storagePath={storagePath}
                      attachmentCompanyId={selectedCompanyId || undefined}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-snug" title={entry.label}>
                        {search.trim() ? highlightQueryInText(entry.label, search) : entry.label}
                      </p>
                      <p
                        className="truncate text-[11px] leading-snug text-muted-foreground sm:text-xs"
                        title={`Used on: ${usedOnFull}`}
                      >
                        Used on: {search.trim() ? highlightQueryInText(usedOn, search) : usedOn}
                        {entry.voucherCount > 1 ? (
                          <span className="text-foreground/70"> · {entry.voucherCount}</span>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-pl-reuse-use-action
                      className="h-7 shrink-0 rounded-lg px-2.5 text-[11px] sm:text-xs"
                      disabled={remaining <= 0 || linking === entry.url}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void pick(entry.url);
                      }}
                    >
                      {linking === entry.url ? "…" : "Use"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        {/* Mobile APK: search + company same row at bottom; desktop keeps wider select. */}
        <div className="shrink-0 space-y-1.5 border-t border-emerald-500/30 pt-2">
          <Label htmlFor="pl-reuse-attachment-search" className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">
            Search files in company
          </Label>
          <div className="flex flex-row items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pl-reuse-attachment-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by file or voucher no."
                className={cn(
                  "h-10 rounded-xl border-emerald-500/60 bg-white/85 pl-9 focus-visible:ring-emerald-500/40 sm:rounded-md",
                  search.trim() ? "pr-9" : "pr-3"
                )}
              />
              {search.trim() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <Select
              value={selectedCompanyId || undefined}
              onValueChange={setSelectedCompanyId}
              disabled={companyOptions.length === 0 || loadingSources}
            >
              <SelectTrigger
                id="pl-reuse-company-select"
                className="h-10 w-[min(42%,11.5rem)] shrink-0 rounded-xl border-emerald-500/60 bg-white/85 sm:w-[min(42%,14rem)] sm:rounded-md"
              >
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                {companyOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.id === companyId ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedCompanyId && companyId && selectedCompanyId !== companyId ? (
            <p className="text-[11px] text-muted-foreground">
              Use adds the link to your voucher in <span className="font-medium">{currentCompanyName}</span>.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ButtonProps = {
  currentFiles: Array<File | string>;
  maxFiles: number;
  onAddUrls: (urls: string[]) => void;
  onAddFiles?: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  onDialogOpenChange?: (open: boolean) => void;
};

export function CompanyAttachmentReuseButton({
  currentFiles,
  maxFiles,
  onAddUrls,
  onAddFiles,
  disabled,
  className,
  onDialogOpenChange,
}: ButtonProps) {
  const [open, setOpen] = useState(false);
  const currentUrls = currentFiles.filter((f): f is string => typeof f === "string");
  const canAdd = !disabled && currentFiles.length < maxFiles;

  const setOpenTracked = (next: boolean) => {
    onDialogOpenChange?.(next);
    setOpen(next);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-attachment-reuse-action
        className={cn("whitespace-nowrap text-center", className)}
        disabled={!canAdd}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpenTracked(true);
        }}
      >
        <span>Reuse file</span>
      </Button>
      <CompanyAttachmentReuseDialog
        open={open}
        onOpenChange={setOpenTracked}
        currentUrls={currentUrls}
        maxFiles={maxFiles}
        onAddUrls={onAddUrls}
        onAddFiles={onAddFiles}
      />
    </>
  );
}
