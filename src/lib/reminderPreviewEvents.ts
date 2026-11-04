/**
 * Header "Test" button -> global ReminderPreviewDialog (dashboard layout).
 * Sirf window events / module flag: is file me koi data / firebase import nahi.
 */
export const REMINDER_PREVIEW_OPEN_EVENT = "pl:open-reminder-preview";
/** AlarmPopup "Extend date & time" -> ReminderPreviewDialog host LedgerReminderDialog ko EDIT mode me kholta hai. */
export const REMINDER_EDIT_OPEN_EVENT = "pl:open-reminder-edit";
/** AlarmPopup khula/band: ek waqt me ek hi popup (preview band ho jata hai). */
export const ALARM_POPUP_STATE_EVENT = "pl:alarm-popup-state";

export type ReminderEditOpenDetail = { alarmId: string; companyId?: string | null };

let alarmPopupActive = false;

export function openReminderPreview(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REMINDER_PREVIEW_OPEN_EVENT));
}

export function openReminderEditor(detail: ReminderEditOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReminderEditOpenDetail>(REMINDER_EDIT_OPEN_EVENT, { detail }));
}

export function isAlarmPopupActive(): boolean {
  return alarmPopupActive;
}

export function setAlarmPopupActive(active: boolean): void {
  if (alarmPopupActive === active) return;
  alarmPopupActive = active;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(ALARM_POPUP_STATE_EVENT, { detail: active }));
}