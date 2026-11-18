"use client";

import { useEffect } from "react";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { peekCachedTranslation, translateEnglishStrings } from "@/lib/i18n/gtxTranslate";
import { OCR_UNAVAILABLE_MESSAGE } from "@/components/gallery/autoPostRunPolicy";

/**
 * English source strings for new Auto post UI.
 * PlGlobalTranslate localizes DOM text to the selected UI language.
 * Toasts and other non-DOM (or briefly shown) text use uiText() so they
 * also follow the UI language when a translation is already cached, and
 * useAutoPostUiCopy() warms the cache on mount.
 */
export const AUTO_POST_UI = {
  reset: "Reset",
  resetTitle: "Reset the scan-run counter to the current limit and continue this run",
  howManyFiles: "How many files to scan",
  scanAllFiles: "Scan all files",
  all: "All",
  comingSoon: "Coming soon",
  serverComingSoon: "Server (Coming soon)",
  scheduleOnPrompt: "Schedule is on. To run manually/auto you must turn off the schedule. Turn it off?",
  yes: "Yes",
  no: "No",
  continue: "Continue",
  stop: "Stop",
  previousRunPrompt: "Previous run/schedule is active - Continue or Stop?",
  settingsSavedStart: "Settings saved. Start runner now?",
  limitReachedPrefix: "Limit reached, continuing in ",
  limitReachedSuffix: " s",
  ocrUnavailable: OCR_UNAVAILABLE_MESSAGE,
  badKey: "The OCR API key was rejected. Check the key in OCR settings, then Start later.",
  forbidden: "OCR access is forbidden for this company. The runner has been stopped.",
  quotaExhausted: "OCR quota is exhausted. The runner has been stopped. Check billing or try later.",
  movedUnreadable: "Could not read document",
  defaultDueDaysTitle: "If bill has no due date, use default days",
  sale: "Sale",
  purchase: "Purchase",
  defaultDueDaysSale: "Default due days for Sale",
  defaultDueDaysPurchase: "Default due days for Purchase",
  onlyWhenStart: "Only when I press Start",
  onlyWhenStartHint: "Scans run only when you press Start",
  modeManual: "Manual",
  modeSemi: "Semi",
  modeFull: "Full",
  modeManualRunner: "Manual Runner",
  modeSemiAutomatic: "Semi Automatic",
  modeFullAutoPost: "Full Auto Post",
  modeSliderAria: "Auto post mode: Manual Runner, Semi Automatic, Full Auto Post",
  resumeRunner: "Resume runner",
  startRunner: "Start runner",
  stopRunner: "Stop runner",
  skipMoveToAutoFailed: "Skip & move to Auto failed",
  skipMoveToAutoFailedTitle: "Skip this document and move it to Auto post failed",
  enableAutoPostToStart: "Enable Auto post vouchers in Auto post settings to start the runner",
  scanCounterReset: "Scan counter reset: {count} files left in this run",
  scanCounterResetAll: "Scan counter reset: all files left in this run",
  scannedPressStart: "Scanned {scanned} of {total}. Press Start to continue.",
  startBlockedSettingsLoading: "Auto post settings are still loading. Try Start again in a moment.",
  startBlockedNotEnabled: "Enable Auto post vouchers in Auto post settings to start the runner",
  startBlockedNotAdmin: "Only a company admin can start the Auto post runner.",
  startBlockedDeviceMismatch: "Start the runner on the selected Local PC admin device.",
  startBlockedSettingsOpen: "Close Auto post settings, then press Start.",
  startBlockedOffline: "You are offline. Reconnect, then press Start.",
  startBlockedBusy: "The runner is busy with another file. Wait, then press Start again.",
  startBlockedRateLimit: "The runner is waiting for the rate limit. Try Start again in a moment.",
  startBlockedMastersLoading: "Voucher masters are still loading. Try Start again in a moment.",
  startBlockedBudgetZero: "The scan limit for this run is used up. Press Start to continue.",
  startBlockedFirstCard: "The first file is still marked as processing, so the runner could not start.",
  startBlockedRequeueFailed: "Could not return the first file to the queue. Press Start to try again.",
  startBlockedNoFiles: "There are no files waiting to scan.",
} as const;

export type AutoPostUiKey = keyof typeof AUTO_POST_UI;

export function allAutoPostUiEnglish(): string[] {
  return Object.values(AUTO_POST_UI);
}

export function uiText(uiLang: string | undefined, english: string): string {
  const lang = String(uiLang || "en").trim() || "en";
  if (lang === "en") return english;
  return peekCachedTranslation(english, lang) ?? english;
}

export function useAutoPostUiCopy(): { uiLang: string; t: (english: string) => string } {
  const i18n = usePlI18nOptional();
  const uiLang = i18n?.ui || "en";
  useEffect(() => {
    if (!uiLang || uiLang === "en") return;
    void translateEnglishStrings(allAutoPostUiEnglish(), uiLang);
  }, [uiLang]);
  return { uiLang, t: (english: string) => uiText(uiLang, english) };
}
