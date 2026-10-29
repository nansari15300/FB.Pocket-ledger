/**
 * Country → app / server panel URL.
 *
 * Live today: Nepal (`np.pocket-ledger.com` / `nepal.pocket-ledger.com`, panel `servernp`).
 * Add a country: Cloudflare CNAME `{cc}` + `server{cc}` → same tunnel, then put `cc` in LIVE_COUNTRY_CODES.
 * Catalog already has every ISO alpha-2; URLs are `https://{cc}.pocket-ledger.com/app`.
 */

export const COUNTRY_APP_STORE_KEY = "pl-app-country";
export const COUNTRY_APP_APEX = "pocket-ledger.com";

/** Hosts that are never a country app (www, api, …). `server{cc}` is handled separately. */
export const COUNTRY_APP_RESERVED: Record<string, true> = {
  www: true,
  app: true,
  admin: true,
  api: true,
  mail: true,
  ftp: true,
  cdn: true,
  static: true,
  staging: true,
  login: true,
  main: true,
  m: true,
  dev: true,
  test: true,
  beta: true,
  docs: true,
  blog: true,
  shop: true,
  store: true,
  support: true,
  help: true,
  status: true,
  ns1: true,
  ns2: true,
  smtp: true,
  origin: true,
  firebase: true,
  hosting: true,
  console: true,
  www2: true,
  server: true,
};

/** ISO alpha-2 codes whose `{cc}.pocket-ledger.com` is on Cloudflare today. */
export const LIVE_COUNTRY_CODES = ["np"] as const;

/** Extra host labels that map to a live ISO code (nepal.pocket-ledger.com → np). */
export const COUNTRY_HOST_ALIASES: Record<string, string> = {
  nepal: "np",
};

export const FEATURED_COUNTRY_CODES = [
  "np",
  "in",
  "us",
  "nz",
  "gb",
  "au",
  "ae",
  "bd",
  "pk",
  "lk",
  "my",
  "sg",
];

export type CountryAppRecord = {
  cc: string;
  iso3: string;
  name: string;
  aliases: string[];
  host: string;
  serverHost: string;
  live: boolean;
};

/** [alpha-2, alpha-3, English name, extra search aliases…] */
const RAW: Array<[string, string, string, ...string[]]> = [
  ["ad", "and", "Andorra"],
  ["ae", "are", "United Arab Emirates", "uae"],
  ["af", "afg", "Afghanistan"],
  ["ag", "atg", "Antigua and Barbuda"],
  ["ai", "aia", "Anguilla"],
  ["al", "alb", "Albania"],
  ["am", "arm", "Armenia"],
  ["ao", "ago", "Angola"],
  ["aq", "ata", "Antarctica"],
  ["ar", "arg", "Argentina"],
  ["as", "asm", "American Samoa"],
  ["at", "aut", "Austria"],
  ["au", "aus", "Australia"],
  ["aw", "abw", "Aruba"],
  ["ax", "ala", "Åland Islands", "aland"],
  ["az", "aze", "Azerbaijan"],
  ["ba", "bih", "Bosnia and Herzegovina"],
  ["bb", "brb", "Barbados"],
  ["bd", "bgd", "Bangladesh"],
  ["be", "bel", "Belgium"],
  ["bf", "bfa", "Burkina Faso"],
  ["bg", "bgr", "Bulgaria"],
  ["bh", "bhr", "Bahrain"],
  ["bi", "bdi", "Burundi"],
  ["bj", "ben", "Benin"],
  ["bl", "blm", "Saint Barthélemy"],
  ["bm", "bmu", "Bermuda"],
  ["bn", "brn", "Brunei"],
  ["bo", "bol", "Bolivia"],
  ["bq", "bes", "Caribbean Netherlands"],
  ["br", "bra", "Brazil"],
  ["bs", "bhs", "Bahamas"],
  ["bt", "btn", "Bhutan"],
  ["bv", "bvt", "Bouvet Island"],
  ["bw", "bwa", "Botswana"],
  ["by", "blr", "Belarus"],
  ["bz", "blz", "Belize"],
  ["ca", "can", "Canada"],
  ["cc", "cck", "Cocos Islands"],
  ["cd", "cod", "DR Congo", "congo"],
  ["cf", "caf", "Central African Republic"],
  ["cg", "cog", "Republic of the Congo"],
  ["ch", "che", "Switzerland"],
  ["ci", "civ", "Côte d'Ivoire", "ivory coast"],
  ["ck", "cok", "Cook Islands"],
  ["cl", "chl", "Chile"],
  ["cm", "cmr", "Cameroon"],
  ["cn", "chn", "China"],
  ["co", "col", "Colombia"],
  ["cr", "cri", "Costa Rica"],
  ["cu", "cub", "Cuba"],
  ["cv", "cpv", "Cabo Verde", "cape verde"],
  ["cw", "cuw", "Curaçao", "curacao"],
  ["cx", "cxr", "Christmas Island"],
  ["cy", "cyp", "Cyprus"],
  ["cz", "cze", "Czechia", "czech republic"],
  ["de", "deu", "Germany"],
  ["dj", "dji", "Djibouti"],
  ["dk", "dnk", "Denmark"],
  ["dm", "dma", "Dominica"],
  ["do", "dom", "Dominican Republic"],
  ["dz", "dza", "Algeria"],
  ["ec", "ecu", "Ecuador"],
  ["ee", "est", "Estonia"],
  ["eg", "egy", "Egypt"],
  ["eh", "esh", "Western Sahara"],
  ["er", "eri", "Eritrea"],
  ["es", "esp", "Spain"],
  ["et", "eth", "Ethiopia"],
  ["fi", "fin", "Finland"],
  ["fj", "fji", "Fiji"],
  ["fk", "flk", "Falkland Islands"],
  ["fm", "fsm", "Micronesia"],
  ["fo", "fro", "Faroe Islands"],
  ["fr", "fra", "France"],
  ["ga", "gab", "Gabon"],
  ["gb", "gbr", "United Kingdom", "uk", "great britain", "britain"],
  ["gd", "grd", "Grenada"],
  ["ge", "geo", "Georgia"],
  ["gf", "guf", "French Guiana"],
  ["gg", "ggy", "Guernsey"],
  ["gh", "gha", "Ghana"],
  ["gi", "gib", "Gibraltar"],
  ["gl", "grl", "Greenland"],
  ["gm", "gmb", "Gambia"],
  ["gn", "gin", "Guinea"],
  ["gp", "glp", "Guadeloupe"],
  ["gq", "gnq", "Equatorial Guinea"],
  ["gr", "grc", "Greece"],
  ["gs", "sgs", "South Georgia"],
  ["gt", "gtm", "Guatemala"],
  ["gu", "gum", "Guam"],
  ["gw", "gnb", "Guinea-Bissau"],
  ["gy", "guy", "Guyana"],
  ["hk", "hkg", "Hong Kong"],
  ["hm", "hmd", "Heard Island"],
  ["hn", "hnd", "Honduras"],
  ["hr", "hrv", "Croatia"],
  ["ht", "hti", "Haiti"],
  ["hu", "hun", "Hungary"],
  ["id", "idn", "Indonesia"],
  ["ie", "irl", "Ireland"],
  ["il", "isr", "Israel"],
  ["im", "imn", "Isle of Man"],
  ["in", "ind", "India"],
  ["io", "iot", "British Indian Ocean Territory"],
  ["iq", "irq", "Iraq"],
  ["ir", "irn", "Iran"],
  ["is", "isl", "Iceland"],
  ["it", "ita", "Italy"],
  ["je", "jey", "Jersey"],
  ["jm", "jam", "Jamaica"],
  ["jo", "jor", "Jordan"],
  ["jp", "jpn", "Japan"],
  ["ke", "ken", "Kenya"],
  ["kg", "kgz", "Kyrgyzstan"],
  ["kh", "khm", "Cambodia"],
  ["ki", "kir", "Kiribati"],
  ["km", "com", "Comoros"],
  ["kn", "kna", "Saint Kitts and Nevis"],
  ["kp", "prk", "North Korea"],
  ["kr", "kor", "South Korea", "korea"],
  ["kw", "kwt", "Kuwait"],
  ["ky", "cym", "Cayman Islands"],
  ["kz", "kaz", "Kazakhstan"],
  ["la", "lao", "Laos"],
  ["lb", "lbn", "Lebanon"],
  ["lc", "lca", "Saint Lucia"],
  ["li", "lie", "Liechtenstein"],
  ["lk", "lka", "Sri Lanka"],
  ["lr", "lbr", "Liberia"],
  ["ls", "lso", "Lesotho"],
  ["lt", "ltu", "Lithuania"],
  ["lu", "lux", "Luxembourg"],
  ["lv", "lva", "Latvia"],
  ["ly", "lby", "Libya"],
  ["ma", "mar", "Morocco"],
  ["mc", "mco", "Monaco"],
  ["md", "mda", "Moldova"],
  ["me", "mne", "Montenegro"],
  ["mf", "maf", "Saint Martin"],
  ["mg", "mdg", "Madagascar"],
  ["mh", "mhl", "Marshall Islands"],
  ["mk", "mkd", "North Macedonia"],
  ["ml", "mli", "Mali"],
  ["mm", "mmr", "Myanmar", "burma"],
  ["mn", "mng", "Mongolia"],
  ["mo", "mac", "Macao"],
  ["mp", "mnp", "Northern Mariana Islands"],
  ["mq", "mtq", "Martinique"],
  ["mr", "mrt", "Mauritania"],
  ["ms", "msr", "Montserrat"],
  ["mt", "mlt", "Malta"],
  ["mu", "mus", "Mauritius"],
  ["mv", "mdv", "Maldives"],
  ["mw", "mwi", "Malawi"],
  ["mx", "mex", "Mexico"],
  ["my", "mys", "Malaysia"],
  ["mz", "moz", "Mozambique"],
  ["na", "nam", "Namibia"],
  ["nc", "ncl", "New Caledonia"],
  ["ne", "ner", "Niger"],
  ["nf", "nfk", "Norfolk Island"],
  ["ng", "nga", "Nigeria"],
  ["ni", "nic", "Nicaragua"],
  ["nl", "nld", "Netherlands", "holland"],
  ["no", "nor", "Norway"],
  ["np", "npl", "Nepal"],
  ["nr", "nru", "Nauru"],
  ["nu", "niu", "Niue"],
  ["nz", "nzl", "New Zealand", "newzealand"],
  ["om", "omn", "Oman"],
  ["pa", "pan", "Panama"],
  ["pe", "per", "Peru"],
  ["pf", "pyf", "French Polynesia"],
  ["pg", "png", "Papua New Guinea"],
  ["ph", "phl", "Philippines"],
  ["pk", "pak", "Pakistan"],
  ["pl", "pol", "Poland"],
  ["pm", "spm", "Saint Pierre and Miquelon"],
  ["pn", "pcn", "Pitcairn"],
  ["pr", "pri", "Puerto Rico"],
  ["ps", "pse", "Palestine"],
  ["pt", "prt", "Portugal"],
  ["pw", "plw", "Palau"],
  ["py", "pry", "Paraguay"],
  ["qa", "qat", "Qatar"],
  ["re", "reu", "Réunion", "reunion"],
  ["ro", "rou", "Romania"],
  ["rs", "srb", "Serbia"],
  ["ru", "rus", "Russia"],
  ["rw", "rwa", "Rwanda"],
  ["sa", "sau", "Saudi Arabia"],
  ["sb", "slb", "Solomon Islands"],
  ["sc", "syc", "Seychelles"],
  ["sd", "sdn", "Sudan"],
  ["se", "swe", "Sweden"],
  ["sg", "sgp", "Singapore"],
  ["sh", "shn", "Saint Helena"],
  ["si", "svn", "Slovenia"],
  ["sj", "sjm", "Svalbard and Jan Mayen"],
  ["sk", "svk", "Slovakia"],
  ["sl", "sle", "Sierra Leone"],
  ["sm", "smr", "San Marino"],
  ["sn", "sen", "Senegal"],
  ["so", "som", "Somalia"],
  ["sr", "sur", "Suriname"],
  ["ss", "ssd", "South Sudan"],
  ["st", "stp", "São Tomé and Príncipe", "sao tome"],
  ["sv", "slv", "El Salvador"],
  ["sx", "sxm", "Sint Maarten"],
  ["sy", "syr", "Syria"],
  ["sz", "swz", "Eswatini", "swaziland"],
  ["tc", "tca", "Turks and Caicos Islands"],
  ["td", "tcd", "Chad"],
  ["tf", "atf", "French Southern Territories"],
  ["tg", "tgo", "Togo"],
  ["th", "tha", "Thailand"],
  ["tj", "tjk", "Tajikistan"],
  ["tk", "tkl", "Tokelau"],
  ["tl", "tls", "Timor-Leste", "east timor"],
  ["tm", "tkm", "Turkmenistan"],
  ["tn", "tun", "Tunisia"],
  ["to", "ton", "Tonga"],
  ["tr", "tur", "Türkiye", "turkey"],
  ["tt", "tto", "Trinidad and Tobago"],
  ["tv", "tuv", "Tuvalu"],
  ["tw", "twn", "Taiwan"],
  ["tz", "tza", "Tanzania"],
  ["ua", "ukr", "Ukraine"],
  ["ug", "uga", "Uganda"],
  ["um", "umi", "US Outlying Islands"],
  ["us", "usa", "United States", "usa", "america"],
  ["uy", "ury", "Uruguay"],
  ["uz", "uzb", "Uzbekistan"],
  ["va", "vat", "Vatican City"],
  ["vc", "vct", "Saint Vincent and the Grenadines"],
  ["ve", "ven", "Venezuela"],
  ["vg", "vgb", "British Virgin Islands"],
  ["vi", "vir", "US Virgin Islands"],
  ["vn", "vnm", "Vietnam"],
  ["vu", "vut", "Vanuatu"],
  ["wf", "wlf", "Wallis and Futuna"],
  ["ws", "wsm", "Samoa"],
  ["xk", "xkx", "Kosovo"],
  ["ye", "yem", "Yemen"],
  ["yt", "myt", "Mayotte"],
  ["za", "zaf", "South Africa"],
  ["zm", "zmb", "Zambia"],
  ["zw", "zwe", "Zimbabwe"],
];

const LIVE = new Set<string>(LIVE_COUNTRY_CODES);
const byCode = new Map<string, CountryAppRecord>();
const list: CountryAppRecord[] = [];

function makeRecord(cc: string, iso3: string, name: string, aliases: string[]): CountryAppRecord {
  return {
    cc,
    iso3,
    name,
    aliases,
    host: `${cc}.${COUNTRY_APP_APEX}`,
    serverHost: `server${cc}.${COUNTRY_APP_APEX}`,
    live: LIVE.has(cc),
  };
}

for (const row of RAW) {
  const rec = makeRecord(row[0], row[1], row[2], row.slice(3));
  byCode.set(rec.cc, rec);
  list.push(rec);
}

list.sort((a, b) => {
  if (a.live !== b.live) return a.live ? -1 : 1;
  return a.name.localeCompare(b.name);
});

function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getCountryAppRecord(cc: string | null | undefined): CountryAppRecord | null {
  const key = String(cc || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  const aliased = COUNTRY_HOST_ALIASES[key] || key;
  return byCode.get(aliased) || null;
}

export function listCountryAppRecords(): CountryAppRecord[] {
  return list.slice();
}

export function findCountryAppRecords(query: string): CountryAppRecord[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list.slice();
  const compact = norm(q);
  const score = (c: CountryAppRecord) => {
    const name = c.name.toLowerCase();
    if (c.cc === q) return 0;
    if (c.iso3 === q) return 1;
    if (c.aliases.includes(q)) return 2;
    if (name === q || norm(c.name) === compact) return 3;
    if (name.startsWith(q)) return 4;
    if (c.host.startsWith(q)) return 5;
    if (name.includes(q) || norm(c.name).includes(compact)) return 6;
    for (const alias of c.aliases) {
      const n = norm(alias);
      if (n.startsWith(compact)) return 7;
      if (n.includes(compact)) return 8;
    }
    return 9;
  };
  return list
    .filter((c) => score(c) < 9)
    .sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      const d = score(a) - score(b);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
}

export function isLocalDevAppHost(hostname = currentAppHostname()): boolean {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
}

export function countryAppUrl(rec: CountryAppRecord): string {
  if (typeof window !== "undefined" && isLocalDevAppHost()) {
    try {
      const origin = String(window.location.origin || "").replace(/\/+$/, "");
      if (origin && origin !== "null") return `${origin}/app`;
    } catch {
      /* ignore */
    }
    return "/app";
  }
  return `https://${rec.host}/app`;
}

export function countryServerUrl(rec: CountryAppRecord): string {
  return `https://${rec.serverHost}`;
}

/** Public download origin for the live country (today: np.pocket-ledger.com). */
export function liveCountryPublicOrigin(): string {
  const cc = LIVE_COUNTRY_CODES[0] || "np";
  const rec = getCountryAppRecord(cc);
  return rec ? `https://${rec.host}` : `https://${cc}.${COUNTRY_APP_APEX}`;
}

export function countryFlagUrl(cc: string, width = 40): string {
  return `https://flagcdn.com/w${width}/${String(cc || "").toLowerCase()}.png`;
}

export function currentAppHostname(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.location.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

function hostLabel(hostname: string): string | null {
  const h = String(hostname || "").toLowerCase();
  const parts = h.split(".");
  if (parts.length < 3) return null;
  const base = parts.slice(-2).join(".");
  if (base !== COUNTRY_APP_APEX) return null;
  const sub = parts[0];
  if (!sub || COUNTRY_APP_RESERVED[sub]) return null;
  return sub;
}

export function isCountryServerPanelHost(hostname = currentAppHostname()): boolean {
  const sub = hostLabel(hostname);
  if (!sub || !sub.startsWith("server")) return false;
  return Boolean(getCountryAppRecord(sub.slice("server".length)));
}

export function isCountryPublicAppHost(hostname = currentAppHostname()): boolean {
  const sub = hostLabel(hostname);
  if (!sub) return false;
  if (sub.startsWith("server") && getCountryAppRecord(sub.slice("server".length))) return false;
  return Boolean(getCountryAppRecord(COUNTRY_HOST_ALIASES[sub] || sub));
}

export function detectCountryFromHost(hostname = currentAppHostname()): CountryAppRecord | null {
  const sub = hostLabel(hostname);
  if (!sub) return null;
  if (sub.startsWith("server")) return getCountryAppRecord(sub.slice("server".length));
  return getCountryAppRecord(COUNTRY_HOST_ALIASES[sub] || sub);
}

export function readStoredAppCountry(): CountryAppRecord | null {
  if (typeof window === "undefined") return null;
  try {
    return getCountryAppRecord(localStorage.getItem(COUNTRY_APP_STORE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredAppCountry(cc: string): CountryAppRecord | null {
  const rec = getCountryAppRecord(cc);
  if (!rec) return null;
  try {
    localStorage.setItem(COUNTRY_APP_STORE_KEY, rec.cc);
  } catch {
    /* ignore */
  }
  return rec;
}

export function resolveAppCountry(): CountryAppRecord | null {
  return detectCountryFromHost() || readStoredAppCountry();
}

export type ApplyAppCountryResult =
  | { ok: true; rec: CountryAppRecord; redirected: boolean }
  | { ok: false; reason: string };

function canNavigateToCountryHost(): boolean {
  if (typeof window === "undefined") return false;
  if (isLocalDevAppHost()) return false;
  try {
    const C = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (C && typeof C.isNativePlatform === "function" && C.isNativePlatform()) return false;
  } catch {
    /* ignore */
  }
  try {
    if (String(navigator.userAgent || "").toLowerCase().includes("electron")) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** Save country. On packed/public web, jump to that country's app host when it is live. */
export function applyAppCountry(cc: string): ApplyAppCountryResult {
  const rec = getCountryAppRecord(cc);
  if (!rec) return { ok: false, reason: "Unknown country." };
  if (!rec.live) {
    return {
      ok: false,
      reason: `${rec.name} is not open yet. Nepal is live at ${countryAppUrl(getCountryAppRecord("np")!)}.`,
    };
  }
  writeStoredAppCountry(rec.cc);
  if (!canNavigateToCountryHost()) {
    return { ok: true, rec, redirected: false };
  }
  const here = currentAppHostname();
  const alreadyOnCountryApp = here === rec.host || COUNTRY_HOST_ALIASES[hostLabel(here) || ""] === rec.cc;
  const onServerPanel = isCountryServerPanelHost(here);
  if (alreadyOnCountryApp && !onServerPanel) {
    return { ok: true, rec, redirected: false };
  }
  try {
    window.location.assign(countryAppUrl(rec));
    return { ok: true, rec, redirected: true };
  } catch {
    return { ok: true, rec, redirected: false };
  }
}
