import { translateEnglishMap } from "./gtxTranslate";

export type ChromeKey =
  | "s_language"
  | "ui_lang"
  | "intro_lang"
  | "lang_help"
  | "search_lang"
  | "combo_no_match"
  | "dlg_cancel"
  | "btn_save"
  | "close"
  | "translating";

const EN: Record<ChromeKey, string> = {
  s_language: "Language",
  ui_lang: "UI language",
  intro_lang: "Intro language",
  lang_help:
    "UI language = buttons and labels; Intro language = informational sentences. Both can be changed later.",
  search_lang: "Search language…",
  combo_no_match: "No matches",
  dlg_cancel: "Cancel",
  btn_save: "Save",
  close: "Close",
  translating: "Translating…",
};

const TABLES: Record<string, Partial<Record<ChromeKey, string>>> = {
  en: EN,
  hi: {
    s_language: "भाषा",
    ui_lang: "इंटरफ़ेस की भाषा",
    intro_lang: "परिचय की भाषा",
    lang_help:
      "इंटरफ़ेस की भाषा = बटन और लेबल; परिचय की भाषा = जानकारी वाले वाक्य। दोनों बाद में बदले जा सकते हैं।",
    search_lang: "भाषा खोजें…",
    combo_no_match: "कोई मेल नहीं मिला",
    dlg_cancel: "रद्द करें",
    btn_save: "सहेजें",
    close: "बंद करें",
    translating: "अनुवाद हो रहा है…",
  },
  ne: {
    s_language: "भाषा",
    ui_lang: "इन्टरफेसको भाषा",
    intro_lang: "परिचयको भाषा",
    lang_help: "इन्टरफेसको भाषा = बटन र लेबल; परिचयको भाषा = जानकारीका वाक्यहरू। दुवै पछि बदल्न सकिन्छ।",
    search_lang: "भाषा खोज्नुहोस्…",
    combo_no_match: "कुनै मेल भेटिएन",
    dlg_cancel: "रद्द गर्नुहोस्",
    btn_save: "सुरक्षित गर्नुहोस्",
    close: "बन्द गर्नुहोस्",
    translating: "अनुवाद हुँदैछ…",
  },
};

const extra: Record<string, Record<ChromeKey, string>> = {};
const pending = new Map<string, Promise<Record<ChromeKey, string>>>();

export function chromeTable(code: string): Record<ChromeKey, string> {
  if (code === "en") return EN;
  if (extra[code]) return extra[code];
  const hand = TABLES[code];
  if (hand) return { ...EN, ...hand };
  return EN;
}

export function chromeText(code: string, key: ChromeKey): string {
  return chromeTable(code)[key] || EN[key];
}

export function ensureChromeTable(code: string): Promise<Record<ChromeKey, string>> {
  if (!code || code === "en") return Promise.resolve(EN);
  if (extra[code]) return Promise.resolve(extra[code]);
  const hand = TABLES[code];
  if (hand && Object.keys(hand).length >= Object.keys(EN).length) {
    extra[code] = { ...EN, ...hand };
    return Promise.resolve(extra[code]);
  }
  const hit = pending.get(code);
  if (hit) return hit;
  const job = translateEnglishMap(EN, code).then((map) => {
    extra[code] = { ...EN, ...(hand || {}), ...(map as Record<ChromeKey, string>) };
    pending.delete(code);
    return extra[code];
  });
  pending.set(code, job);
  return job;
}
