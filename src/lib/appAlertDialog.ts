/** In-app OK dialog (replaces window.alert for attachment / sync messages). */

export const APP_ALERT_EVENT = "pl-app-alert";

export type AppAlertDetail = {
  title?: string;
  message: string;
  /** Confirm mode: two buttons; `resolve(true)` on confirm, `false` on cancel / close. */
  confirmLabel?: string;
  cancelLabel?: string;
  resolve?: (ok: boolean) => void;
  /** set by the mounted host so callers know the dialog is shown */
  handled?: boolean;
};

export function showAppAlert(message: string, title = "Notice"): void {
  if (typeof window === "undefined") return;
  const detail: AppAlertDetail = {
    title: String(title || "Notice").trim() || "Notice",
    message: String(message || "").trim(),
  };
  if (!detail.message) return;
  window.dispatchEvent(new CustomEvent(APP_ALERT_EVENT, { detail }));
}

/**
 * In-app Yes/No dialog (replaces window.confirm). Resolves false when the host is not mounted.
 */
export function showAppConfirm(
  message: string,
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const msg = String(message || "").trim();
  if (!msg) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const detail: AppAlertDetail = {
      title: String(opts?.title || "Confirm").trim() || "Confirm",
      message: msg,
      confirmLabel: String(opts?.confirmLabel || "OK").trim() || "OK",
      cancelLabel: String(opts?.cancelLabel || "Cancel").trim() || "Cancel",
      resolve: (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      },
    };
    window.dispatchEvent(new CustomEvent(APP_ALERT_EVENT, { detail }));
    if (!detail.handled) detail.resolve?.(false);
  });
}
