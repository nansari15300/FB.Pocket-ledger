import { ensureServerLangLookup, lookupServerLang } from "./serverLangLookup";

const CACHE_PREFIX = "pl_app_mt_v4_";
const KEEP = ["Pocket Ledger", "PocketBase", "Cloudflare", "Google", "SQLite", "IndexedDB", "Tauri", "WebView2"];
const GTX: Record<string, string> = { zh: "zh-CN", he: "iw", jv: "jw", nb: "no", nn: "no", tw: "ak" };
const BATCH = 6;
const MAX_CACHE_KEYS = 2500;
const DEVA = /[\u0900-\u097F]/;
const NEPALI_MARK = /छैन|गर्नु|होस्|हुन्छ|छन्|\bछ\b|लाई|बाट/;
const HINDI_MARK = /हैं|होगा|लिए|खुलेगा|नहीं|\bहै\b/;
const HINGLISH = /\b(sirf|nahi|nahin|khulega|khulegi|band|mat|wala|wali)\b/i;

function gtxLang(code: string) {
  return GTX[code] || code;
}

function hold(ph: string[], m: string) {
  ph.push(m);
  return `⟦${ph.length - 1}⟧`;
}

function protect(text: string) {
  const ph: string[] = [];
  let s = String(text ?? "").replace(/\{[a-z_]+\}/g, (m) => hold(ph, m));
  KEEP.forEach((w) => {
    if (!w || !s.includes(w)) return;
    s = s.split(w).join(hold(ph, w));
  });
  s = s.replace(/\b(Cr|Dr)\b/gi, (m) => hold(ph, m));
  return { s, ph };
}

function restore(text: string, ph: string[]) {
  return String(text ?? "").replace(/⟦\s*(\d+)\s*⟧/g, (_, n) => ph[Number(n)] || "");
}

function count(re: RegExp, text: string) {
  return (text.match(re) || []).length;
}

export function looksEnglishSource(text: string): boolean {
  const t = String(text || "");
  const deva = count(/[\u0900-\u097F]/g, t);
  const latin = count(/[A-Za-z]/g, t);
  if (deva > 2 && deva >= latin) return false;
  return latin > 0;
}

function alreadyTarget(text: string, lang: string): boolean {
  if (!DEVA.test(text)) return false;
  if (lang === "ne") return NEPALI_MARK.test(text) && !HINDI_MARK.test(text);
  if (lang === "hi") return HINDI_MARK.test(text) && !NEPALI_MARK.test(text);
  return false;
}

function sourceLangFor(text: string, target: string): string | null {
  if (alreadyTarget(text, target)) return null;
  if (DEVA.test(text)) {
    if (target === "ne") return "hi";
    if (target === "hi") return "ne";
    return "auto";
  }
  if (HINGLISH.test(text) && (target === "ne" || target === "hi")) return "hi";
  return "en";
}

function polishNepali(s: string) {
  return s
    .replace(/खुलेगा/g, "खुल्नेछ")
    .replace(/खोलेगा/g, "खोल्नेछ")
    .replace(/नहीं/g, "छैन")
    .replace(/\bहैं\b/g, "छन्")
    .replace(/\bहै\b/g, "छ")
    .replace(/के लिए/g, "का लागि")
    .replace(/होमर/g, "होभर")
    .replace(/धबनेल/g, "थम्बनेल")
    .replace(/ब्यान्ड(?=\s|।|$)/g, "बन्द")
    .replace(/से खुल्/g, "बाट खुल्")
    .replace(/से खोल/g, "बाट खोल");
}

const memCache: Record<string, Record<string, string>> = {};

function readCache(code: string): Record<string, string> {
  if (memCache[code]) return memCache[code];
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + code);
    if (!raw) {
      memCache[code] = {};
      return memCache[code];
    }
    const parsed = JSON.parse(raw);
    memCache[code] = parsed && typeof parsed === "object" ? parsed : {};
    return memCache[code];
  } catch {
    memCache[code] = {};
    return memCache[code];
  }
}

function writeCache(code: string, map: Record<string, string>) {
  memCache[code] = map;
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_CACHE_KEYS) {
      const trimmed: Record<string, string> = {};
      for (const k of keys.slice(keys.length - MAX_CACHE_KEYS)) trimmed[k] = map[k];
      map = trimmed;
      memCache[code] = trimmed;
    }
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

/** Sync cache hit — React overwrite ke baad paint se pehle translation wapas. */
export function peekCachedTranslation(text: string, lang: string): string | null {
  if (!text) return null;
  if (!lang || lang === "en") return text;
  const fromServer = lookupServerLang(lang, text);
  if (fromServer != null) return fromServer;
  const hit = readCache(lang)[text];
  return hit != null ? hit : null;
}

async function translateOne(text: string, lang: string): Promise<string> {
  if (!text) return text;
  const fromServer = lookupServerLang(lang, text);
  if (fromServer != null) return fromServer;
  const sl = sourceLangFor(text, lang);
  if (sl == null) return text;
  const p = protect(text);
  if (!p.s.trim()) return text;
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
    encodeURIComponent(sl) +
    "&tl=" +
    encodeURIComponent(gtxLang(lang)) +
    "&dt=t&q=" +
    encodeURIComponent(p.s);
  try {
    const r = await fetch(url);
    if (!r.ok) return text;
    const j = await r.json();
    let out = "";
    if (j && j[0]) {
      for (let i = 0; i < j[0].length; i++) if (j[0][i] && j[0][i][0]) out += j[0][i][0];
    }
    let done = restore(out || p.s, p.ph);
    if (lang === "ne") done = polishNepali(done);
    return done;
  } catch {
    return text;
  }
}

export async function translateEnglishMap(
  map: Record<string, string>,
  lang: string
): Promise<Record<string, string>> {
  await ensureServerLangLookup(lang);
  const keys = Object.keys(map || {});
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (k) => {
        out[k] = await translateOne(map[k], lang);
      })
    );
  }
  return out;
}

export async function translateEnglishStrings(texts: string[], lang: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!lang || lang === "en") {
    texts.forEach((t) => result.set(t, t));
    return result;
  }
  await ensureServerLangLookup(lang);
  const cache = readCache(lang);
  const missing: Record<string, string> = {};
  for (const t of texts) {
    if (!t) continue;
    if (!looksEnglishSource(t) && alreadyTarget(t, lang)) {
      result.set(t, t);
      continue;
    }
    const fromServer = lookupServerLang(lang, t);
    if (fromServer != null) {
      result.set(t, fromServer);
      continue;
    }
    if (cache[t] != null) result.set(t, cache[t]);
    else missing[t] = t;
  }
  const missKeys = Object.keys(missing);
  if (missKeys.length) {
    const filled = await translateEnglishMap(missing, lang);
    for (const k of Object.keys(filled)) {
      cache[k] = filled[k];
      result.set(k, filled[k]);
    }
    writeCache(lang, cache);
  }
  return result;
}
