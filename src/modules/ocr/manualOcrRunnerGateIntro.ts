/**
 * Intro-language copy (en / hi / ne) for the Manual Runner gate dialog
 * shown when Refresh OCR is clicked while Semi Automatic or Full Auto Post is selected.
 */
import { introTabLang, type IntroTabLang } from "@/lib/i18n/introLangTab";
import type { AutoPostMode, ManualOcrGateMode } from "./manualOcrRunnerGate";

export const RUNNER_MODE_FULL_LABEL: Record<IntroTabLang, Record<AutoPostMode, string>> = {
  en: {
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
  hi: {
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
  ne: {
    manual: "Manual Runner",
    semi: "Semi Automatic",
    full: "Full Auto Post",
  },
};

export const MANUAL_OCR_RUNNER_GATE_TITLE: Record<IntroTabLang, string> = {
  en: "Runner mode",
  hi: "रनर मोड",
  ne: "रनर मोड",
};

export const MANUAL_OCR_RUNNER_GATE_MESSAGE: Record<IntroTabLang, string> = {
  en: "Runner mode is on {mode} mode. Do you want to change to Manual?",
  hi: "रनर मोड अभी {mode} मोड पर है। क्या आप Manual पर बदलना चाहते हैं?",
  ne: "रनर मोड अहिले {mode} मोडमा छ। के तपाईं Manual मा परिवर्तन गर्न चाहनुहुन्छ?",
};

export const MANUAL_OCR_RUNNER_GATE_SWITCH: Record<IntroTabLang, string> = {
  en: "Switch to Manual Runner",
  hi: "Manual Runner पर बदलें",
  ne: "Manual Runner मा सार्नुहोस्",
};

export const MANUAL_OCR_RUNNER_GATE_OK: Record<IntroTabLang, string> = {
  en: "OK",
  hi: "ठीक है",
  ne: "ठिक छ",
};

export const MANUAL_OCR_RUNNER_GATE_ADMIN: Record<IntroTabLang, string> = {
  en: "Only a company admin can change the runner mode.",
  hi: "रनर मोड केवल कंपनी एडमिन बदल सकते हैं।",
  ne: "रनर मोड केवल कम्पनी एडминले परिवर्तन गर्न सक्नुहुन्छ।",
};

export function runnerModeFullLabel(introLang: string | null | undefined, mode: AutoPostMode): string {
  return RUNNER_MODE_FULL_LABEL[introTabLang(introLang)][mode];
}

export function manualOcrRunnerGateTitle(introLang?: string | null): string {
  return MANUAL_OCR_RUNNER_GATE_TITLE[introTabLang(introLang)];
}

export function manualOcrRunnerGateMessage(introLang: string | null | undefined, mode: ManualOcrGateMode): string {
  const lang = introTabLang(introLang);
  return MANUAL_OCR_RUNNER_GATE_MESSAGE[lang].split("{mode}").join(RUNNER_MODE_FULL_LABEL[lang][mode]);
}

export function manualOcrRunnerGateSwitch(introLang?: string | null): string {
  return MANUAL_OCR_RUNNER_GATE_SWITCH[introTabLang(introLang)];
}

export function manualOcrRunnerGateOk(introLang?: string | null): string {
  return MANUAL_OCR_RUNNER_GATE_OK[introTabLang(introLang)];
}

export function manualOcrRunnerGateAdmin(introLang?: string | null): string {
  return MANUAL_OCR_RUNNER_GATE_ADMIN[introTabLang(introLang)];
}
