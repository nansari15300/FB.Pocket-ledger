/**
 * Header "Test" button -> global ReminderPreviewDialog (dashboard layout).
 * Sirf window event: is file me koi data / firebase import nahi.
 */
export const REMINDER_PREVIEW_OPEN_EVENT = "pl:open-reminder-preview";

export function openReminderPreview(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REMINDER_PREVIEW_OPEN_EVENT));
}