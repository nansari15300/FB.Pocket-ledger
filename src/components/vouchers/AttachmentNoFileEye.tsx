"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentHoverPortal } from "@/components/vouchers/AttachmentHoverPortal";
import { useAttachmentNoFile } from "@/lib/attachmentNoFileSession";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";

const NO_FILE_COPY: Record<
  "en" | "hi" | "ne",
  { title: string; text: string }
> = {
  en: {
    title: "File not showing",
    text: "This file is not showing because only its link is saved. The file itself is not available on this device or server yet — it may not have finished uploading, or it may have been removed. The preview will appear once the file is available. To see it here, open the device this file was uploaded from and try refreshing there, or send/receive it again.",
  },
  hi: {
    title: "फ़ाइल नहीं दिख रही",
    text: "यह file इसलिए नहीं दिख रही है क्योंकि सिर्फ़ इसका link सेव है। file खुद अभी इस device या server पर उपलब्ध नहीं है — हो सकता है upload पूरा न हुआ हो, या file हटा दी गई हो। file उपलब्ध होते ही preview दिखने लगेगा। इसे यहाँ देखने के लिए, जिस device से यह file upload हुई थी वहाँ refresh करें या फिर से भेजने/पाने की कोशिश करें।",
  },
  ne: {
    title: "फाइल देखिएको छैन",
    text: "यो file यसकारण देखिएको छैन किनभने केवल यसको link सेभ गरिएको छ। file आफैं अहिलेसम्म यो device वा server मा उपलब्ध छैन — upload पूरा नभएको हुन सक्छ, वा file हटाइएको हुन सक्छ। file उपलब्ध भएपछि preview देखिनेछ। यहाँ देख्न, जुन device बाट यो file upload गरिएको थियो त्यहाँ refresh गर्नुहोस् वा फेरि पठाउने/प्राप्त गर्ने प्रयास गर्नुहोस्।",
  },
};

/** Small eye icon (no preview box). Click opens a centered dialog with the full explanation. */
export function AttachmentNoFileEye({
  size = "md",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const i18n = usePlI18nOptional();
  const introCode = i18n?.intro || "en";
  const tab = introTabLang(introCode);
  const hand = introCode === "hi" || introCode === "ne";
  const copy = hand ? NO_FILE_COPY[tab] : NO_FILE_COPY.en;
  const [open, setOpen] = React.useState(false);
  const descId = React.useId();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    // Portal content bubbles through the React tree: keep every click away from the ledger row.
    <span
      data-pl-txn-file-nofile=""
      className={cn("inline-flex items-center justify-center", className)}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      {/* Global (i) info button (same component as every page/field intro). */}
      <AppFreshInfoButton
        size={size === "sm" ? "sm" : "md"}
        aria-label="File not showing - click for details"
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onDoubleClick={stop}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-pl-txn-file-nofile=""
          data-pl-intro=""
          aria-describedby={descId}
          className="w-[min(92vw,28rem)] max-w-[min(92vw,28rem)] max-h-[calc(100dvh-1rem)] gap-4 overflow-y-auto p-5 text-sm sm:p-6"
          onClick={stop}
          onDoubleClick={stop}
        >
          <DialogHeader>
            <DialogTitle
              className="pr-6 text-base leading-snug"
              data-pl-no-translate={hand ? "" : undefined}
            >
              {copy.title}
            </DialogTitle>
          </DialogHeader>
          <div
            id={descId}
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            data-pl-no-translate={hand ? "" : undefined}
          >
            <p lang={hand ? tab : "en"} className="text-sm leading-relaxed text-foreground">
              {copy.text}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}

type PortalProps = React.ComponentProps<typeof AttachmentHoverPortal>;

/**
 * `AttachmentHoverPortal` that stays inert (no hover panel / no viewer on click) while every url of
 * the row has a cached "no file" verdict.
 */
export function NoFileAwareHoverPortal({
  urls,
  disabled,
  ...rest
}: PortalProps & { urls: readonly string[] | null | undefined }) {
  const noFile = useAttachmentNoFile(urls);
  return <AttachmentHoverPortal {...rest} disabled={Boolean(disabled) || noFile} />;
}