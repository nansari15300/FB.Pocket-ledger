"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useAttachmentHoldPointer,
  ATTACHMENT_HOLD_MS_MOBILE,
} from "@/hooks/useAttachmentHoldPointer";
import { useTapInteractionMode } from "@/components/vouchers/AttachmentHoverPortal";
import {
  resolveAttachmentHoldPayloadForPaste,
  parseAttachmentHoldPayloadFromAnyText,
  fetchBlobForAttachmentHoldPaste,
  blobToFile,
  refreshAttachmentHoldSessionBackup,
  persistableAttachmentRefFromHoldPayload,
  voucherFormFilesIncludePersistableRef,
  companyIdFromAttachmentHoldPayload,
  attachmentHoldCompaniesMatch,
  ATTACHMENT_HOLD_CROSS_TAB_BACKUP_KEY,
} from "@/lib/attachmentHoldClipboard";
import { toast as sonnerToast } from "sonner";
import { Loader2 } from "lucide-react";
import { CompanyAttachmentReuseButton } from "@/components/vouchers/CompanyAttachmentReuseDialog";
import {
  attachmentReuseCopyAsNewEnabled,
  voucherAttachmentReuseEnabled,
} from "@/lib/firebaseBillingOptimization";
import { copyCloudAttachmentRefToCompany } from "@/lib/companyAttachmentRegistry";
import { useCompany } from "@/hooks/useCompany";
import { useCrossCompanyAttachmentAccess } from "@/hooks/useCrossCompanyAttachmentAccess";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { useVoucherAttachmentProcessing } from "@/lib/appendCompressedVoucherAttachments";
import { usePcFileDropZone } from "@/lib/attachmentPcFileDrop";

function sanitizeDownloadFileName(raw: string): string {
  const base = String(raw || "attachment").trim() || "attachment";
  const noPath = base.includes("/") ? base.split("/").pop() || base : base;
  return noPath.replace(/[^\w.\- ()\u0900-\u097F]+/g, "_").slice(0, 180) || "attachment";
}

export type VoucherAttachmentReuseConfig = {
  currentFiles: Array<File | string>;
  setFiles: React.Dispatch<React.SetStateAction<Array<File | string>>>;
  maxFiles: number;
};

/** Reuse action inside the Add File tile. */
export const VOUCHER_ATTACHMENT_REUSE_TILE_CLASS =
  "absolute inset-x-2 bottom-1 z-10 h-6 gap-1 rounded-md border-sky-300 bg-sky-100/95 px-1.5 text-[10px] font-semibold leading-tight text-sky-900 shadow-sm hover:border-sky-500 hover:bg-sky-200/95 dark:border-sky-400/55 dark:bg-sky-950/85 dark:text-sky-100";

type Props = {
  /** Khali slot + role allow ho tab hi */
  enabled: boolean;
  /** Normal tap — file picker */
  onShortActivate: () => void;
  /** Hold paste fallback: unsaved File only (upload on save). */
  onPastedFiles: (files: File[]) => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
  /** Existing company file URL reuse (voucher forms) */
  voucherAttachmentReuse?: VoucherAttachmentReuseConfig;
};

/**
 * Dashed "Add File" tile: PC hover / mobile ~1s hold par `Paste` chip; click se paste — last copy session me rehta hai.
 */
export function AttachmentHoldPasteSurface({
  enabled,
  onShortActivate,
  onPastedFiles,
  className,
  children,
  voucherAttachmentReuse,
}: Props) {
  const { companyId } = useCompany();
  const { isHoldPayloadVisible } = useCrossCompanyAttachmentAccess();
  const tapMode = useTapInteractionMode();
  const isCompressing = useVoucherAttachmentProcessing();
  const [mobilePasteRevealed, setMobilePasteRevealed] = useState(false);
  /** Reuse dialog open / Use / close ke baad click-through se file picker mat kholo. */
  const suppressFilePickerUntilRef = useRef(0);
  const reuseDialogOpenRef = useRef(false);
  const markReuseDialogOpenChange = useCallback((next: boolean) => {
    reuseDialogOpenRef.current = next;
    if (!next) {
      suppressFilePickerUntilRef.current = Date.now() + 500;
    }
  }, []);

  /** EXE multi-tab: Tab A copy → Tab B me Paste chip dikhao (storage event). */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ATTACHMENT_HOLD_CROSS_TAB_BACKUP_KEY || !e.newValue) return;
      setMobilePasteRevealed(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Hold + Paste button + Ctrl+V — plain https / local: / drive: link bhi chale. */
  const runPasteFromHoldClipboard = useCallback(async (clipboardTextOverride?: string) => {
    const payload =
      (clipboardTextOverride
        ? parseAttachmentHoldPayloadFromAnyText(clipboardTextOverride)
        : null) ?? (await resolveAttachmentHoldPayloadForPaste());
    if (!payload) {
      sonnerToast.message("No attachment link in clipboard", {
        description:
          "Paste a copied file link (https, local:, or drive:) — from another voucher, tab, or app.",
      });
      return;
    }

    if (!isHoldPayloadVisible(payload)) {
      sonnerToast.error("Other company file (not available here)", {
        description:
          "This attachment is from another company. Switch to that company, or use a login where both companies are available.",
      });
      return;
    }

    const reuseRef = persistableAttachmentRefFromHoldPayload(payload);
    const sourceCompanyId = companyIdFromAttachmentHoldPayload(payload);
    const targetCompanyId = String(companyId || "").trim();
    const sameCompany = await attachmentHoldCompaniesMatch(sourceCompanyId, targetCompanyId);
    const isHttpsReuse =
      Boolean(reuseRef) &&
      (/^https?:\/\//i.test(reuseRef!) ||
        isDriveFileRef(reuseRef!) ||
        isLocalFileRef(reuseRef!));

    const pasteReusedUrl = async (ref: string) => {
      let finalRef = String(ref || "").trim();
      if (!finalRef) return;
      // Legacy share-URL only (SHARE_URL=1).
      if (companyId && /^https?:\/\//i.test(finalRef)) {
        try {
          const { ensureSharedHttpsAttachmentCompressed } = await import(
            "@/lib/attachmentRecompressOnSave"
          );
          finalRef = await ensureSharedHttpsAttachmentCompressed({
            companyId,
            fromUrl: finalRef,
          });
        } catch {
          /* keep original */
        }
      }
      if (companyId) {
        const { linkCloudAttachmentRefs } = await import("@/lib/companyAttachmentRegistry");
        await linkCloudAttachmentRefs(companyId, [finalRef]);
      }
      voucherAttachmentReuse!.setFiles((prev) => [...prev, finalRef]);
      refreshAttachmentHoldSessionBackup(payload);
      sonnerToast.success("Pasted — same file linked");
      setMobilePasteRevealed(false);
    };

    const pasteAsNewFileCopy = async () => {
      const got = await fetchBlobForAttachmentHoldPaste(payload, undefined, {
        companyId: companyId ?? undefined,
      });
      if (!got || got.blob.size === 0) {
        if (reuseRef && /^https?:\/\//i.test(reuseRef) && companyId) {
          const copiedUrl = await copyCloudAttachmentRefToCompany({
            sourceUrl: reuseRef,
            targetCompanyId: companyId,
          });
          voucherAttachmentReuse!.setFiles((prev) => [...prev, copiedUrl]);
          refreshAttachmentHoldSessionBackup(payload);
          sonnerToast.success("Pasted — new file copy", {
            description: "Separate Storage object for this voucher.",
          });
          setMobilePasteRevealed(false);
          return;
        }
        throw new Error("Could not read attachment (offline or link expired)");
      }
      const file = blobToFile(got.blob, sanitizeDownloadFileName(got.fileName), got.contentType);
      await onPastedFiles([file]);
      refreshAttachmentHoldSessionBackup(payload);
      sonnerToast.success("Pasted as new file", {
        description: "Save uploads a separate copy for this voucher.",
      });
      setMobilePasteRevealed(false);
    };

    const pasteCrossCompanyCopy = async (sourceUrl: string) => {
      if (!targetCompanyId) throw new Error("Current company is missing.");
      const copiedUrl = await copyCloudAttachmentRefToCompany({
        sourceUrl,
        targetCompanyId,
      });
      voucherAttachmentReuse!.setFiles((prev) => [...prev, copiedUrl]);
      refreshAttachmentHoldSessionBackup(payload);
      sonnerToast.success("Pasted — copied into this company", {
        description: "New upload for this company. Original company file unchanged.",
      });
      setMobilePasteRevealed(false);
    };

    // Persistable link — default: copy as new File (no shared URL / badges).
    if (
      voucherAttachmentReuseEnabled() &&
      voucherAttachmentReuse &&
      reuseRef &&
      isHttpsReuse
    ) {
      if (voucherFormFilesIncludePersistableRef(voucherAttachmentReuse.currentFiles, reuseRef)) {
        sonnerToast.message("Already attached on this voucher");
        setMobilePasteRevealed(false);
        return;
      }
      if (attachmentReuseCopyAsNewEnabled()) {
        try {
          await pasteAsNewFileCopy();
          return;
        } catch (e) {
          sonnerToast.error("Could not copy attachment", {
            description: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      if (sameCompany) {
        try {
          await pasteReusedUrl(reuseRef);
          return;
        } catch (e) {
          sonnerToast.error("Could not link attachment", {
            description: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      if (/^https?:\/\//i.test(reuseRef)) {
        try {
          await pasteCrossCompanyCopy(reuseRef);
          return;
        } catch (e) {
          sonnerToast.error("Could not copy attachment", {
            description: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      sonnerToast.error("Cannot paste this file type across companies", {
        description: "Open the other company, or copy an online (https) file.",
      });
      return;
    }

    const got = await fetchBlobForAttachmentHoldPaste(payload, undefined, {
      companyId: companyId ?? undefined,
    });
    if (!got || got.blob.size === 0) {
      sonnerToast.error("Could not read attachment (offline or link expired)");
      return;
    }
    const file = blobToFile(got.blob, sanitizeDownloadFileName(got.fileName), got.contentType);
    await onPastedFiles([file]);
    refreshAttachmentHoldSessionBackup(payload);
    sonnerToast.success("Pasted as new file", {
      description: "Save uploads a separate copy for this voucher.",
    });
    setMobilePasteRevealed(false);
  }, [companyId, isHoldPayloadVisible, onPastedFiles, voucherAttachmentReuse]);

  const hold = useAttachmentHoldPointer({
    disabled: !enabled || isCompressing,
    holdMs: tapMode ? ATTACHMENT_HOLD_MS_MOBILE : undefined,
    onHoldComplete: tapMode
      ? () => {
          setMobilePasteRevealed(true);
        }
      : undefined,
  });

  const canShowReuseTile =
    Boolean(voucherAttachmentReuse) &&
    voucherAttachmentReuseEnabled() &&
    (voucherAttachmentReuse?.currentFiles.length ?? 0) < (voucherAttachmentReuse?.maxFiles ?? 0);

  const reuseAction = canShowReuseTile && voucherAttachmentReuse ? (
    <CompanyAttachmentReuseButton
      currentFiles={voucherAttachmentReuse.currentFiles}
      maxFiles={voucherAttachmentReuse.maxFiles}
      onAddUrls={(urls) => voucherAttachmentReuse.setFiles((prev) => [...prev, ...urls])}
      onAddFiles={(files) => voucherAttachmentReuse.setFiles((prev) => [...prev, ...files])}
      disabled={!enabled || isCompressing}
      className={VOUCHER_ATTACHMENT_REUSE_TILE_CLASS}
      onDialogOpenChange={markReuseDialogOpenChange}
    />
  ) : null;

  const slotEnabled = enabled && !isCompressing;

  const handlePcDropFiles = useCallback(
    (incoming: File[]) => {
      if (!slotEnabled || incoming.length === 0) return;
      void onPastedFiles(incoming);
    },
    [onPastedFiles, slotEnabled]
  );

  const { isDragOver: isPcFileDragOver, dropZoneProps: pcDropZoneProps } = usePcFileDropZone({
    enabled: slotEnabled,
    onFiles: handlePcDropFiles,
  });

  const addTile = (
    <div
      role="button"
      tabIndex={slotEnabled ? 0 : -1}
      aria-disabled={!slotEnabled}
      aria-busy={isCompressing || undefined}
      {...pcDropZoneProps}
      className={cn(
        "group relative flex h-full w-full min-h-0 flex-col items-center justify-center touch-manipulation outline-none",
        className,
        isCompressing && "pointer-events-none cursor-wait opacity-90",
        isPcFileDragOver &&
          slotEnabled &&
          "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
      onClickCapture={hold.onClickCapture}
      onPointerDown={hold.onPointerDown}
      onPointerMove={hold.onPointerMove}
      onPointerUp={hold.onPointerUp}
      onPointerCancel={hold.onPointerCancel}
      onPointerLeave={hold.onPointerLeave}
      onClick={(e) => {
        if (!slotEnabled) return;
        // Reuse dialog open — portal clicks React tree se yahan aa sakte hain; browse mat kholo.
        if (reuseDialogOpenRef.current) return;
        if ((e.target as HTMLElement).closest("[data-attachment-paste-chip]")) return;
        if ((e.target as HTMLElement).closest("[data-attachment-reuse-action]")) return;
        // Sirf Reuse dialog — Edit Trxn `role=dialog` mat pakdo (warna Add File hamesha band).
        if ((e.target as HTMLElement).closest("[data-pl-reuse-dialog]")) return;
        if (Date.now() < suppressFilePickerUntilRef.current) return;
        onShortActivate();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onPaste={(e) => {
        if (!slotEnabled) return;
        // Reuse dialog search box: portal paste bubbles here in React. Do not steal it
        // (preventDefault would block typing the voucher no., and session backup would
        // attach the wrong last-copied file then close the dialog).
        if (reuseDialogOpenRef.current) return;
        if ((e.target as HTMLElement | null)?.closest?.("[data-pl-reuse-dialog]")) return;
        const text = e.clipboardData.getData("text/plain");
        if (!text?.trim()) return;
        e.preventDefault();
        e.stopPropagation();
        void runPasteFromHoldClipboard(text);
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!slotEnabled) return;
          if (reuseDialogOpenRef.current) return;
          if (Date.now() < suppressFilePickerUntilRef.current) return;
          onShortActivate();
        }
      }}
    >
      {isCompressing ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-lg bg-background/85 px-1 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <span className="text-[10px] font-semibold leading-tight text-foreground">Compressing…</span>
        </div>
      ) : (
        children
      )}
      {!isCompressing ? reuseAction : null}
      {slotEnabled ? (
        <>
          {/* PC: hover par Paste — chip alag click; baaki poori tile file picker */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden justify-center pt-0.5 opacity-0 transition-opacity [@media(pointer:fine)]:flex [@media(pointer:fine)]:group-hover:opacity-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-attachment-paste-chip
              className="pointer-events-auto h-7 gap-0.5 px-2 text-[10px] font-semibold shadow-md"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void runPasteFromHoldClipboard();
              }}
            >
              Paste
            </Button>
          </div>
          {/* Mobile: ~1s hold ke baad Paste chip; click se paste */}
          {mobilePasteRevealed ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-0.5 [@media(pointer:fine)]:hidden">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-attachment-paste-chip
                className="pointer-events-auto h-6 gap-0.5 px-1.5 text-[9px] font-semibold shadow-md"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void runPasteFromHoldClipboard();
                }}
              >
                Paste
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const addTileSlot = <div className="relative h-24 w-24 shrink-0">{addTile}</div>;
  return addTileSlot;
}

/** Wrap attachment preview row — drop on existing tiles or gap still attaches (voucher / master docs). */
export function AttachmentPcDropWrap({
  enabled,
  onDropFiles,
  className,
  children,
}: {
  enabled: boolean;
  onDropFiles: (files: File[]) => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const { isDragOver, dropZoneProps } = usePcFileDropZone({
    enabled,
    onFiles: onDropFiles,
  });

  return (
    <div
      {...dropZoneProps}
      className={cn(
        className,
        isDragOver &&
          enabled &&
          "rounded-lg bg-primary/5 ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
      )}
    >
      {children}
    </div>
  );
}
