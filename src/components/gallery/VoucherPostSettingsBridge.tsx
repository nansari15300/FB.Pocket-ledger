"use client";

import { useEffect, useState } from "react";
import { GalleryAutoOcrSettingsDialog } from "@/components/gallery/GalleryAutoOcrSettingsDialog";

/** Lets voucher forms open the shared Voucher Post Setting dialog on its Manual Runner tab. */
export function VoucherPostSettingsBridge() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("pl:voucher-post-setting-open", show);
    return () => window.removeEventListener("pl:voucher-post-setting-open", show);
  }, []);

  return open ? <GalleryAutoOcrSettingsDialog open={open} onOpenChange={setOpen} showRunner={false} initialSection="manual" /> : null;
}
