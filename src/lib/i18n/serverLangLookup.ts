/** Pocket Ledger Server i18n files (en/hi/ne + lazy i18n/<code>.js) — English source → translation. */

function tableFromJson(m: { default?: Record<string, string> } | Record<string, string>) {
  const asMod = m as { default?: Record<string, string> };
  return asMod.default ?? (m as Record<string, string>);
}

const LOADERS: Record<string, () => Promise<Record<string, string>>> = {
  hi: () => import("./serverLangLookup/hi.json").then(tableFromJson),
  ne: () => import("./serverLangLookup/ne.json").then(tableFromJson),
  ar: () => import("./serverLangLookup/ar.json").then(tableFromJson),
  bn: () => import("./serverLangLookup/bn.json").then(tableFromJson),
  de: () => import("./serverLangLookup/de.json").then(tableFromJson),
  es: () => import("./serverLangLookup/es.json").then(tableFromJson),
  fa: () => import("./serverLangLookup/fa.json").then(tableFromJson),
  fr: () => import("./serverLangLookup/fr.json").then(tableFromJson),
  gu: () => import("./serverLangLookup/gu.json").then(tableFromJson),
  id: () => import("./serverLangLookup/id.json").then(tableFromJson),
  it: () => import("./serverLangLookup/it.json").then(tableFromJson),
  ja: () => import("./serverLangLookup/ja.json").then(tableFromJson),
  ko: () => import("./serverLangLookup/ko.json").then(tableFromJson),
  mr: () => import("./serverLangLookup/mr.json").then(tableFromJson),
  pt: () => import("./serverLangLookup/pt.json").then(tableFromJson),
  ru: () => import("./serverLangLookup/ru.json").then(tableFromJson),
  ta: () => import("./serverLangLookup/ta.json").then(tableFromJson),
  te: () => import("./serverLangLookup/te.json").then(tableFromJson),
  tr: () => import("./serverLangLookup/tr.json").then(tableFromJson),
  ur: () => import("./serverLangLookup/ur.json").then(tableFromJson),
  vi: () => import("./serverLangLookup/vi.json").then(tableFromJson),
  zh: () => import("./serverLangLookup/zh.json").then(tableFromJson),
};

const mem: Record<string, Record<string, string>> = {};
const pending: Record<string, Promise<Record<string, string>>> = {};

export function hasServerLangFile(code: string): boolean {
  return Boolean(code && code !== "en" && LOADERS[code]);
}

export function lookupServerLang(code: string, english: string): string | null {
  if (!code || code === "en" || !english) return null;
  const table = mem[code];
  if (!table) return null;
  const hit = table[english] ?? table[english.trim()];
  return hit != null ? hit : null;
}

export async function ensureServerLangLookup(code: string): Promise<Record<string, string>> {
  if (!code || code === "en") return {};
  if (mem[code]) return mem[code];
  const load = LOADERS[code];
  if (!load) return {};
  if (!pending[code]) {
    pending[code] = load()
      .then((table) => {
        mem[code] = table || {};
        return mem[code];
      })
      .catch(() => {
        mem[code] = {};
        return mem[code];
      });
  }
  return pending[code];
}
