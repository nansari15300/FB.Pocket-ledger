"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import { pbListAppDocs } from "@/lib/pocketbaseData/pbSync";
import {
  runnerWrongPcDeviceLabel,
  runnerWrongPcIntro,
  runnerWrongPcOk,
  runnerWrongPcTitle,
} from "@/modules/ocr/runnerWrongPcIntro";

/**
 * Blocking "wrong PC" notice when Start is pressed on a device that is not the
 * selected Local PC admin runner. Stays until the user presses OK.
 */
export function RunnerWrongPcDialog({
  open,
  onClose,
  companyId,
  deviceId,
}: {
  open: boolean;
  onClose: () => void;
  companyId?: string;
  deviceId?: string;
}) {
  const i18n = usePlI18nOptional();
  const lang = introTabLang(i18n?.intro);
  const fallbackName = runnerWrongPcDeviceLabel("", deviceId);
  const [deviceName, setDeviceName] = useState(fallbackName);

  useEffect(() => {
    setDeviceName(runnerWrongPcDeviceLabel("", deviceId));
    const cid = String(companyId || "").trim();
    const id = String(deviceId || "").trim();
    if (!open || !cid || !id) return;
    let cancelled = false;
    void pbListAppDocs(cid, "devices")
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((item) => String(item.id || "") === id);
        const label = runnerWrongPcDeviceLabel(
          row ? String((row as { deviceLabel?: unknown }).deviceLabel || "") : "",
          id
        );
        setDeviceName(label);
      })
      .catch(() => {
        /* keep the device id fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [open, companyId, deviceId]);

  const title = runnerWrongPcTitle(lang);
  const message = runnerWrongPcIntro(lang, deviceName);

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) return; }}>
      <AlertDialogContent
        className="z-[2147483005] max-w-lg text-center"
        overlayClassName="z-[2147483004] bg-black/45 backdrop-blur-sm"
      >
        <AlertDialogHeader className="sm:text-center">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-center text-sm text-foreground">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction type="button" onClick={onClose}>
            {runnerWrongPcOk(lang)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
