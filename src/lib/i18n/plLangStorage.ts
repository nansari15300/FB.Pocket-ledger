import PL_LANGUAGES from "./plLanguages.js";

/** Same keys as Pocket Ledger Server / website so the choice follows the user. */
export const UI_LANG_KEY = "pl_server_ui_lang";
export const INTRO_LANG_KEY = "pl_server_intro_lang";
export const DEFAULT_LANG = "en";
export const PL_LANG_APPLIED_EVENT = "pl-lang-applied";

export type PlLangs = { ui: string; intro: string };

export function isPlLangCode(code: string | null | undefined): boolean {
  return !!code && PL_LANGUAGES.has(code);
}

export function validPlLang(code: string | null | undefined): string {
  return isPlLangCode(code) ? String(code) : DEFAULT_LANG;
}

export function readPlLangs(): PlLangs {
  if (typeof window === "undefined") return { ui: DEFAULT_LANG, intro: DEFAULT_LANG };
  try {
    return {
      ui: validPlLang(localStorage.getItem(UI_LANG_KEY)),
      intro: validPlLang(localStorage.getItem(INTRO_LANG_KEY)),
    };
  } catch {
    return { ui: DEFAULT_LANG, intro: DEFAULT_LANG };
  }
}

export function writePlLangs(ui: string, intro: string): PlLangs {
  const next: PlLangs = { ui: validPlLang(ui), intro: validPlLang(intro) };
  try {
    localStorage.setItem(UI_LANG_KEY, next.ui);
    localStorage.setItem(INTRO_LANG_KEY, next.intro);
  } catch {
    /* quota / private mode */
  }
  applyPlLangToDocument(next.ui);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PL_LANG_APPLIED_EVENT, { detail: next }));
  }
  return next;
}

export function applyPlLangToDocument(ui = readPlLangs().ui) {
  if (typeof document === "undefined") return;
  const code = validPlLang(ui);
  document.documentElement.lang = code;
  document.documentElement.dir = PL_LANGUAGES.isRtl(code) ? "rtl" : "ltr";
}

export { PL_LANGUAGES };
