"use client";

import { useEffect } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { AUTO_POST_FORM_VALUES_CHANGED } from "@/components/gallery/autoPostPauseResume";

const DEFAULT_DEBOUNCE_MS = 400;

/** Tell the gallery auto-post runner that the user edited the open voucher, so a paused job can re-check. */
export function useNotifyRunnerFormChanged<T extends FieldValues>(opts: {
  form: UseFormReturn<T>;
  companyId?: string | null;
  debounceMs?: number;
}) {
  const { form, companyId, debounceMs = DEFAULT_DEBOUNCE_MS } = opts;
  useEffect(() => {
    const company = String(companyId || "").trim();
    if (!company) return;
    let timer: number | null = null;
    const sub = form.watch((_values, info) => {
      // OCR setValue and other non-input updates must not look like a user edit.
      if (info?.type !== "change") return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        window.dispatchEvent(new CustomEvent(AUTO_POST_FORM_VALUES_CHANGED, {
          detail: { companyId: company },
        }));
      }, debounceMs);
    });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [form, companyId, debounceMs]);
}
