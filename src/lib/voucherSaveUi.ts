"use client";

import { toast as sonnerToast } from "sonner";
import {
  cancelAttachmentCompressionWork,
  dismissAttachmentCompressionProgressToast,
  isAttachmentCompressionProgressActive,
  showAttachmentCompressionCancelledToast,
} from "@/lib/attachmentCompressionUi";
import { resetVoucherAttachmentProcessing } from "@/lib/appendCompressedVoucherAttachments";

/**
 * Global snappy voucher feedback (Sonner `Toaster` bhi ~1s rakhta hai) —
 * Save & Close branch me dialog band hone se pehle loading toast hatana + chhota success.
 */
export const VOUCHER_SONNER_SUCCESS_MS = 1000;

const VOUCHER_BACKGROUND_TOAST_POSITION = "bottom-center" as const;

/** Save + compress loading toasts — bottom-right, stacked vertically (2 rows). */
export const VOUCHER_SONNER_TOAST_POSITION = "bottom-right" as const;

/** Voucher save / compress loading popups — fixed height taaki Sonner stack rows overlap na kare. */
export const VOUCHER_SONNER_TOAST_CN =
  "text-sm py-2 px-3 min-h-[2.375rem] w-auto max-w-[min(92vw,20rem)] whitespace-nowrap";

export const VOUCHER_SAVE_LOADING_TOAST_ID = "pl-voucher-save-loading";

/** Stable id — overlapping link saves dismiss the same loading row (toast stuck avoid). */
export const VOUCHER_LINK_SAVE_TOAST_ID = "pl-voucher-link-save";

/** Max wait before link-save toast must close (cloud / Firestore hang). */
export const VOUCHER_LINK_SAVE_TIMEOUT_MS = 45_000;

/**
 * Save / links / compress loading — sab stable ids pe; dismiss multi-stuck rows.
 * Success alag toast mat banao without replacing loading id (warna spinner + success dono dikhte hain).
 */
export function dismissAllVoucherProgressLoadingToasts(): void {
  sonnerToast.dismiss(VOUCHER_SAVE_LOADING_TOAST_ID);
  sonnerToast.dismiss(VOUCHER_LINK_SAVE_TOAST_ID);
  dismissAttachmentCompressionProgressToast();
}

/** Save & Close ke baad spend-wise / bill-wise sync — chhota bottom loading popup. */
export function showVoucherBackgroundProgress(message = "Saving links…"): string | number {
  // Purana save spinner mat chhodo — warna "Saving payment…" + "Saving links…" dono.
  sonnerToast.dismiss(VOUCHER_SAVE_LOADING_TOAST_ID);
  return sonnerToast.loading(message, {
    id: VOUCHER_LINK_SAVE_TOAST_ID,
    position: VOUCHER_BACKGROUND_TOAST_POSITION,
    duration: Infinity,
    classNames: {
      toast: "text-sm py-2 px-3 min-h-0 w-auto max-w-[min(92vw,20rem)]",
    },
  });
}

export function completeVoucherBackgroundProgress(
  _toastId: string | number | null | undefined,
  outcome: { ok: boolean; title: string; description?: string }
): void {
  // Same stable id pe replace — dismiss+new success se loading kabhi kabhi chipak jati thi.
  if (outcome.ok) {
    sonnerToast.success(outcome.title, {
      id: VOUCHER_LINK_SAVE_TOAST_ID,
      description: outcome.description,
      duration: VOUCHER_SONNER_SUCCESS_MS,
      position: VOUCHER_BACKGROUND_TOAST_POSITION,
      classNames: {
        toast: "text-sm py-2 px-3 min-h-0 w-auto max-w-[min(92vw,20rem)]",
      },
    });
  } else {
    sonnerToast.error(outcome.title, {
      id: VOUCHER_LINK_SAVE_TOAST_ID,
      description: outcome.description,
      duration: 5000,
      position: VOUCHER_BACKGROUND_TOAST_POSITION,
      classNames: {
        toast: "text-sm py-2 px-3 min-h-0 w-auto max-w-[min(92vw,20rem)]",
      },
    });
  }
}

/**
 * Bill-wise / spend-wise link persist — loading toast + hard timeout so "Saving links…" never sticks.
 * Use from every voucher form + Adjust Balance / ledger link Done.
 */
export async function runWithVoucherLinkSaveProgress<T>(
  work: () => Promise<T>,
  options?: {
    message?: string;
    timeoutMs?: number;
    successTitle?: string;
    failureTitle?: string;
  }
): Promise<{ ok: boolean; result?: T; error?: unknown }> {
  const toastId = showVoucherBackgroundProgress(options?.message ?? "Saving links…");
  const timeoutMs = options?.timeoutMs ?? VOUCHER_LINK_SAVE_TIMEOUT_MS;
  let ok = false;
  let result: T | undefined;
  let error: unknown;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Link save timed out. Local changes may still be saved — refresh if needed."));
        }, timeoutMs);
      }),
    ]);
    ok = true;
  } catch (e) {
    error = e;
    ok = false;
    console.error("[runWithVoucherLinkSaveProgress]", e);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
    completeVoucherBackgroundProgress(toastId, {
      ok,
      title: ok
        ? options?.successTitle ?? "Links saved"
        : options?.failureTitle ?? "Some links could not be saved",
      description: !ok && error instanceof Error ? error.message : undefined,
    });
  }
  return { ok, result, error };
}

/** Save loading toast — staff offline / Host unreachable par turant error, loading mat dikhao. */
export async function beginVoucherSaveLoadingOrBlock(
  companyId: string,
  loadingMessage: string
): Promise<string | number | null> {
  try {
    const { noteUserInitiatedServerAction } = await import("@/lib/quotaAdminNotice");
    noteUserInitiatedServerAction();
  } catch {
    /* ignore */
  }
  const cid = String(companyId || "").trim();
  if (cid) {
    let blocked: string | null | undefined = null;
    try {
      const { getPlServerStaffSaveBlockedMessage } = await import("@/lib/plServerStaffOfflinePolicy");
      // Never let the staff-reachability probe hang the Save button before the toast even shows.
      blocked = await Promise.race([
        getPlServerStaffSaveBlockedMessage(cid),
        new Promise<null>((res) => setTimeout(() => res(null), 4_000)),
      ]);
    } catch {
      blocked = null;
    }
    if (blocked) {
      sonnerToast.error("Cannot save", { description: blocked });
      return null;
    }
  }
  // Compress "100%" + links spinner + save — ek hi loading row; multi-stack mat chhodo.
  dismissAttachmentCompressionProgressToast();
  sonnerToast.dismiss(VOUCHER_LINK_SAVE_TOAST_ID);
  armVoucherSaveToastWatchdog();
  return sonnerToast.loading(loadingMessage, {
    id: VOUCHER_SAVE_LOADING_TOAST_ID,
    position: VOUCHER_SONNER_TOAST_POSITION,
    duration: Infinity,
    classNames: { toast: VOUCHER_SONNER_TOAST_CN },
  });
}

/**
 * Last-resort watchdog: every form replaces the loading toast (same id) with success/error in try/catch,
 * but an early return or a hung await would leave "Saving..." spinning forever. After 150 s we replace it.
 * Generation counter: a newer save re-arms; harmless if the id already became a short success/error toast.
 */
export const VOUCHER_SAVE_TOAST_WATCHDOG_MS = 150_000;
let voucherSaveWatchdogGen = 0;
let voucherSaveWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
function armVoucherSaveToastWatchdog(): void {
  const gen = ++voucherSaveWatchdogGen;
  if (voucherSaveWatchdogTimer) clearTimeout(voucherSaveWatchdogTimer);
  voucherSaveWatchdogTimer = setTimeout(() => {
    voucherSaveWatchdogTimer = null;
    if (gen !== voucherSaveWatchdogGen) return;
    console.warn("[PL-DEBUG-SAVE] save toast watchdog fired (150 s) - dismissing stuck loading toasts");
    dismissAllVoucherProgressLoadingToasts();
  }, VOUCHER_SAVE_TOAST_WATCHDOG_MS);
}

/** Authoritative / staff write errors — generic "Failed to save" ki jagah seedha message. */
export function cancelVoucherInFlightWork(): void {
  const wasCompressing = isAttachmentCompressionProgressActive();
  cancelAttachmentCompressionWork();
  resetVoucherAttachmentProcessing();
  dismissAllVoucherProgressLoadingToasts();
  if (wasCompressing) showAttachmentCompressionCancelledToast();
}

export function voucherSaveErrorToast(
  toastId: string | number,
  error: unknown,
  fallback = "Failed to save voucher."
): void {
  dismissAttachmentCompressionProgressToast();
  if (error instanceof Error && error.name === "AttachmentCompressionCancelledError") {
    sonnerToast.dismiss(toastId);
    sonnerToast.dismiss(VOUCHER_SAVE_LOADING_TOAST_ID);
    showAttachmentCompressionCancelledToast();
    return;
  }
  if ((error as { plAuthoritativeWriteFailed?: boolean })?.plAuthoritativeWriteFailed) {
    sonnerToast.error("Cannot save", {
      id: VOUCHER_SAVE_LOADING_TOAST_ID,
      description: error instanceof Error ? error.message : "Cannot save to Host.",
    });
    return;
  }
  sonnerToast.error("Error", {
    id: VOUCHER_SAVE_LOADING_TOAST_ID,
    description: error instanceof Error && error.message ? error.message : fallback,
  });
}

/** `sonnerToast.loading` ko same id pe short success se replace (spinner chipak na rahe). */
export function replaceVoucherSaveLoadingWithShortSuccess(
  toastId: string | number,
  title: string,
  description?: string
): void {
  // Compress "100%" spinner alag id pe reh sakta hai — save done pe hatao.
  dismissAttachmentCompressionProgressToast();
  sonnerToast.success(title, {
    id: typeof toastId === "string" || typeof toastId === "number" ? toastId : VOUCHER_SAVE_LOADING_TOAST_ID,
    description,
    duration: VOUCHER_SONNER_SUCCESS_MS,
    position: VOUCHER_SONNER_TOAST_POSITION,
    classNames: { toast: VOUCHER_SONNER_TOAST_CN },
  });
  // Extra: agar caller alag random id laaya ho to stable save id bhi clear.
  if (toastId !== VOUCHER_SAVE_LOADING_TOAST_ID) {
    sonnerToast.dismiss(VOUCHER_SAVE_LOADING_TOAST_ID);
  }
}
