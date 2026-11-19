/**
 * Intro-language copy (en / hi / ne) for the New Trxn voucher-dialog OCR mode pill.
 */
import { introTabLang, type IntroTabLang } from "@/lib/i18n/introLangTab";
import type { AutoPostMode } from "@/components/gallery/autoPostMode";
import type { VoucherOcrDialogMode } from "./voucherOcrDialogMode";
import { RUNNER_MODE_FULL_LABEL } from "./manualOcrRunnerGateIntro";

export const VOUCHER_OCR_MODE_SHORT: Record<IntroTabLang, Record<VoucherOcrDialogMode, string>> = {
  en: { off: "Off", manual: "Manual", semi: "Semi", full: "Full Auto" },
  hi: { off: "बंद", manual: "Manual", semi: "Semi", full: "Full Auto" },
  ne: { off: "बन्द", manual: "Manual", semi: "Semi", full: "Full Auto" },
};

export const VOUCHER_OCR_MODE_FULL: Record<IntroTabLang, Record<VoucherOcrDialogMode, string>> = {
  en: {
    off: "OCR Off",
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
  hi: {
    off: "OCR बंद",
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
  ne: {
    off: "OCR बन्द",
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
};

export const VOUCHER_OCR_MODE_SLIDER_ARIA: Record<IntroTabLang, string> = {
  en: "OCR mode: Off, Manual, Semi, Full Auto",
  hi: "OCR मोड: बंद, Manual, Semi, Full Auto",
  ne: "OCR मोड: बन्द, Manual, Semi, Full Auto",
};

export const VOUCHER_OCR_MODE_OFF_PILL: Record<IntroTabLang, string> = {
  en: "OCR Off",
  hi: "OCR बंद",
  ne: "OCR बन्द",
};

export const VOUCHER_OCR_MODE_ON_TITLE: Record<IntroTabLang, string> = {
  en: "OCR is on — the bill is read when the first file is attached",
  hi: "OCR चालू है — पहली फाइल जुड़ते ही बिल पढ़ा जाता है",
  ne: "OCR चालू छ — पहिलो फाइल जोडिनेबित्तिकै बिल पढिन्छ",
};

export const VOUCHER_OCR_MODE_OFF_TITLE: Record<IntroTabLang, string> = {
  en: "OCR is off. Turn it on to use Manual, Semi or Full Auto.",
  hi: "OCR बंद है। चालू करें तो Manual, Semi या Full Auto इस्तेमाल होगा।",
  ne: "OCR बन्द छ। चालू गर्नुहोस् भने Manual, Semi वा Full Auto प्रयोग हुन्छ।",
};

export const VOUCHER_OCR_MODE_DEVICE_TOAST: Record<IntroTabLang, string> = {
  en: "Select an admin device in Auto post settings before enabling the runner.",
  hi: "रनर चालू करने से पहले Auto post settings में एक admin डिवाइस चुनें।",
  ne: "रनर चालू गर्नु अघि Auto post settings मा एउटा admin यन्त्र छान्नुहोस्।",
};

export const VOUCHER_OCR_MODE_SAVE_ERROR: Record<IntroTabLang, string> = {
  en: "Could not change Auto post mode",
  hi: "Auto post मोड नहीं बदल सका",
  ne: "Auto post मोड परिवर्तन गर्न सकिएन",
};

export const VOUCHER_OCR_MODE_SAVE_RETRY: Record<IntroTabLang, string> = {
  en: "Please try again.",
  hi: "कृपया फिर कोशिश करें।",
  ne: "कृपया फेरि प्रयास गर्नुहोस्।",
};

export const VOUCHER_POST_SETTING_LABEL: Record<IntroTabLang, string> = {
  en: "Voucher Post Setting",
  hi: "वाउचर पोस्ट सेटिंग",
  ne: "वाउचर पोस्ट सेटिङ",
};

export const VOUCHER_OCR_MODE_START_BLOCKED_OFF: Record<IntroTabLang, string> = {
  en: "Turn OCR on to start the runner.",
  hi: "रनर चालू करने के लिए पहले OCR चालू करें।",
  ne: "रनर चालू गर्न पहिले OCR चालू गर्नुहोस्।",
};
export function voucherOcrModeShort(introLang: string | null | undefined, mode: VoucherOcrDialogMode): string {
  return VOUCHER_OCR_MODE_SHORT[introTabLang(introLang)][mode];
}

export function voucherOcrModeFull(introLang: string | null | undefined, mode: VoucherOcrDialogMode): string {
  return VOUCHER_OCR_MODE_FULL[introTabLang(introLang)][mode];
}

export function voucherOcrModeSliderAria(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_SLIDER_ARIA[introTabLang(introLang)];
}

export function voucherOcrModeOffPill(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_OFF_PILL[introTabLang(introLang)];
}

export function voucherOcrModeOnTitle(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_ON_TITLE[introTabLang(introLang)];
}

export function voucherOcrModeOffTitle(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_OFF_TITLE[introTabLang(introLang)];
}

export function voucherOcrModeDeviceToast(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_DEVICE_TOAST[introTabLang(introLang)];
}

export function voucherOcrModeSaveError(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_SAVE_ERROR[introTabLang(introLang)];
}

export function voucherOcrModeSaveRetry(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_SAVE_RETRY[introTabLang(introLang)];
}

export function voucherPostSettingLabel(introLang?: string | null): string {
  return VOUCHER_POST_SETTING_LABEL[introTabLang(introLang)];
}

export function voucherOcrModeStartBlockedOff(introLang?: string | null): string {
  return VOUCHER_OCR_MODE_START_BLOCKED_OFF[introTabLang(introLang)];
}
/** Full runner label (Manual Runner / Semi Automatic / Full Auto Post) in intro language. */
export function voucherOcrRunnerFullLabel(introLang: string | null | undefined, mode: AutoPostMode): string {
  return RUNNER_MODE_FULL_LABEL[introTabLang(introLang)][mode];
}
