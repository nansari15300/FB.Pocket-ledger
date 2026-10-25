"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { APP_ALERT_EVENT, type AppAlertDetail } from "@/lib/appAlertDialog";

/** Global host: `showAppAlert()` / `showAppConfirm()` from lib code → app popup (not browser alert/confirm). */
export function AppAlertDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Notice");
  const [message, setMessage] = useState("");
  const [confirmLabels, setConfirmLabels] = useState<{ ok: string; cancel: string } | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = (ok: boolean) => {
    const r = resolveRef.current;
    resolveRef.current = null;
    if (r) r(ok);
  };

  useEffect(() => {
    const onAlert = (ev: Event) => {
      const detail = (ev as CustomEvent<AppAlertDetail>).detail;
      const msg = String(detail?.message || "").trim();
      if (!msg) return;
      detail.handled = true;
      // a newer dialog replaces an open confirm: the older one counts as cancelled
      const prev = resolveRef.current;
      resolveRef.current = typeof detail.resolve === "function" ? detail.resolve : null;
      if (prev) prev(false);
      setConfirmLabels(
        resolveRef.current
          ? { ok: String(detail.confirmLabel || "OK"), cancel: String(detail.cancelLabel || "Cancel") }
          : null
      );
      setTitle(String(detail?.title || "Notice").trim() || "Notice");
      setMessage(msg);
      setOpen(true);
    };
    window.addEventListener(APP_ALERT_EVENT, onAlert as EventListener);
    return () => window.removeEventListener(APP_ALERT_EVENT, onAlert as EventListener);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) settle(false);
      }}
    >
      {/* Above Edit Trxn / other z-50 dialogs */}
      <DialogContent
        className="z-[300] max-w-md"
        overlayClassName="z-[300] bg-black/45 backdrop-blur-sm"
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-left text-sm text-muted-foreground">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {confirmLabels ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  settle(false);
                }}
              >
                {confirmLabels.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  settle(true);
                }}
              >
                {confirmLabels.ok}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setOpen(false)}>
              OK
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
