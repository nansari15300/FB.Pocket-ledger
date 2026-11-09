/**
 * SuperAdmin global: online data server (`app_settings/online_data_server`).
 *
 * Central registry of every online data backend the app knows about. The Gate page
 * "Online data server" table and the Admin Panel setting both render from
 * `ONLINE_DATA_SERVERS`, so a new server added here shows up everywhere automatically.
 *
 * SEAM: `resolveOnlineDataBackend()` decides which backend new online companies use
 * (recorded on the company as `onlineServerId`), and `resolveCompanyOnlineDataBackend()`
 * decides where an existing company's online data goes. Firebase is the default.
 * Companies with `onlineServerId: "pocketbase"` read/write their company data on the
 * Pocket Ledger Server (`src/lib/pocketbaseData/*`, URL = `pocketbaseUrl` below).
 * A server that is not implemented falls back to Firebase with a logged warning.
 */
import { getCountryAppRecord, LIVE_COUNTRY_CODES, resolveAppCountry, type CountryAppRecord } from "@/lib/countryAppHosts";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

export const ONLINE_DATA_SERVER_SETTINGS_COLLECTION = "app_settings";
export const ONLINE_DATA_SERVER_SETTINGS_ID = "online_data_server";
export const ONLINE_DATA_SERVER_SETTINGS_DOC = `${ONLINE_DATA_SERVER_SETTINGS_COLLECTION}/${ONLINE_DATA_SERVER_SETTINGS_ID}`;

export type OnlineDataServerId = "firebase" | "pocketbase";

export type OnlineDataServerDef = {
  id: OnlineDataServerId;
  /** Display name shown in tables / pickers. */
  name: string;
  /** Short type label, e.g. "Cloud" or "Self-hosted". */
  type: string;
  /** One-line description (where data lives). */
  description: string;
  /** Default server URL for self-hosted servers. */
  defaultUrl?: string;
  /** True when the data sync backend for this server is actually built. */
  implemented: boolean;
};

/** Build-time default (hosted web / APK / EXE can set NEXT_PUBLIC_POCKETBASE_URL); else this PC. */
export const DEFAULT_POCKETBASE_SERVER_URL =
  (process.env.NEXT_PUBLIC_POCKETBASE_URL || "").trim() || "http://127.0.0.1:8090";

/** Central registry - add future servers here (and to `OnlineDataServerId`). */
export const ONLINE_DATA_SERVERS: readonly OnlineDataServerDef[] = [
  {
    id: "firebase",
    name: "Firebase",
    type: "Cloud (Google)",
    description: "Firestore database + Firebase Storage files.",
    implemented: true,
  },
  {
    id: "pocketbase",
    name: "Pocket Ledger Server",
    type: "Self-hosted (PocketBase)",
    description: "Pocket Ledger's own PocketBase server.",
    defaultUrl: DEFAULT_POCKETBASE_SERVER_URL,
    implemented: true,
  },
];

export const DEFAULT_ONLINE_DATA_SERVER_ID: OnlineDataServerId = "pocketbase";

/** Shown only for a server whose data sync is not built (falls back to Firebase). */
export const POCKETBASE_BACKEND_NOT_IMPLEMENTED_MESSAGE =
  "This server's data sync is not available; data saves to Firebase.";

export const ONLINE_DATA_SERVER_POCKETBASE_ID: OnlineDataServerId = "pocketbase";
export const ONLINE_DATA_SERVER_CHANGED_EVENT = "pl-online-data-server-changed";

export type OnlineDataServerSettings = {
  serverId: OnlineDataServerId;
  /** URL of the Pocket Ledger Server (PocketBase) used by PocketBase companies. */
  pocketbaseUrl: string;
  updatedAtMs: number;
};

export const DEFAULT_ONLINE_DATA_SERVER_SETTINGS: OnlineDataServerSettings = {
  serverId: DEFAULT_ONLINE_DATA_SERVER_ID,
  pocketbaseUrl: DEFAULT_POCKETBASE_SERVER_URL,
  updatedAtMs: 0,
};

const CACHE_KEY = "pl_online_data_server_settings_v1";

export function getOnlineDataServerDef(id: unknown): OnlineDataServerDef | null {
  return ONLINE_DATA_SERVERS.find((s) => s.id === id) ?? null;
}

export function onlineDataServerName(id: unknown): string {
  return getOnlineDataServerDef(id)?.name ?? (typeof id === "string" && id ? id : "Unknown");
}

export function normalizeOnlineDataServerId(raw: unknown): OnlineDataServerId {
  return getOnlineDataServerDef(raw)?.id ?? DEFAULT_ONLINE_DATA_SERVER_ID;
}

export function normalizeOnlineDataServerSettings(raw: unknown): OnlineDataServerSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  const o = raw as Partial<OnlineDataServerSettings>;
  const url = typeof o.pocketbaseUrl === "string" ? o.pocketbaseUrl.trim() : "";
  return {
    serverId: normalizeOnlineDataServerId(o.serverId),
    pocketbaseUrl: url || DEFAULT_POCKETBASE_SERVER_URL,
    updatedAtMs: Number(o.updatedAtMs) || 0,
  };
}

/** This-PC PocketBase address used in local dev (the dev gateway maps it to `/pb` for LAN devices). */
const LOCAL_DEV_POCKETBASE_URL = "http://127.0.0.1:8090";

/** Loopback, LAN-private, `.local` or single-label host = a server on this machine / network. */
function isLocalNetworkHostname(hostRaw: string): boolean {
  const h = hostRaw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // bare PC name
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
}

/** True when `url` is an http(s) address that is NOT on this machine / LAN (e.g. https://np.pocket-ledger.com). */
function isNonLocalServerUrl(url: string): boolean {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
    return !isLocalNetworkHostname(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Local dev guard: localhost / 127.0.0.1 / LAN-private page host, or `npm run dev` (NODE_ENV=development).
 * Never for the packed server app, the Electron EXE, the Capacitor APK or static builds (those are production
 * and keep using the Cloudflare URL).
 */
export function isLocalDevRuntime(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_PL_SERVER_PACK === "1") return false;
  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1") return false;
  if (isCapacitorNativeApp() || isElectronDesktopApp()) return false;
  if (process.env.NODE_ENV === "development") return true;
  try {
    return isLocalNetworkHostname(window.location.hostname || "");
  } catch {
    return false;
  }
}

/**
 * In local dev, ignore a non-local `pocketbaseUrl` (e.g. one the SuperAdmin saved in Firestore
 * `app_settings/online_data_server` for production) and keep the local default. Production unchanged.
 * Never write the result back to Firestore.
 */
export function applyLocalDevPocketBaseGuard(settings: OnlineDataServerSettings): OnlineDataServerSettings {
  if (!isNonLocalServerUrl(settings.pocketbaseUrl) || !isLocalDevRuntime()) return settings;
  const fallback = isNonLocalServerUrl(DEFAULT_POCKETBASE_SERVER_URL) ? LOCAL_DEV_POCKETBASE_URL : DEFAULT_POCKETBASE_SERVER_URL;
  return { ...settings, pocketbaseUrl: fallback };
}

/** True for localhost / 127.x / 0.0.0.0 / ::1 addresses (a server "on this very device"). */
function isLoopbackServerUrl(url: string): boolean {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
    const h = u.hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
  } catch {
    return false;
  }
}

/**
 * Production only: is `url` an address somebody really chose? Empty, the build default / this-PC
 * placeholder (127.0.0.1:8090) and any other loopback address count as "not set". A non-loopback
 * address (https://np.pocket-ledger.com, a LAN host the page itself runs on, ...) is explicit.
 */
export function isExplicitPocketBaseUrl(url: unknown): boolean {
  const s = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  if (!s) return false;
  if (s === DEFAULT_POCKETBASE_SERVER_URL.replace(/\/+$/, "")) return false;
  return !isLoopbackServerUrl(s);
}

/** `https://{cc}.pocket-ledger.com` for a country record. */
export function countryPocketBaseUrl(rec: CountryAppRecord): string {
  return `https://${rec.host}`;
}

export type PocketBaseServerResolution = {
  /** The PocketBase address the app (and the login) really uses. */
  url: string;
  /** dev = local dev runtime (unchanged), admin = explicitly saved URL, country = country-derived live host. */
  source: "dev" | "admin" | "country";
  /** Country the user picked / the host belongs to (null when none known yet). */
  chosenCountry: CountryAppRecord | null;
  /** Country whose server is in use (chosen one if live, else the live fallback = Nepal). */
  serverCountry: CountryAppRecord | null;
  /** False when the chosen country has no live server yet (fell back to the live one). */
  chosenCountryLive: boolean;
};

/**
 * Which PocketBase server to talk to.
 *  1. Local dev (`isLocalDevRuntime()`, SSR): the saved/default URL exactly as before (127.0.0.1:8090).
 *  2. Production (EXE, APK, static/packed builds, hosted web on a non-local host):
 *     a) an explicitly saved `pocketbaseUrl` (admin settings / typed server address, not loopback/placeholder)
 *     b) the chosen country's live host `https://{cc}.pocket-ledger.com`
 *     c) chosen country not live / unknown -> the live country (np).
 * Never writes anything back (the cache keeps only what was explicitly saved).
 */
export function resolvePocketBaseServer(settings?: OnlineDataServerSettings | null): PocketBaseServerResolution {
  const s = settings ?? readCachedOnlineDataServerSettings();
  let chosen: CountryAppRecord | null = null;
  try {
    chosen = resolveAppCountry();
  } catch {
    chosen = null;
  }
  const liveFallback = getCountryAppRecord(LIVE_COUNTRY_CODES[0] || "np");
  const serverCountry = chosen && chosen.live ? chosen : liveFallback;
  const chosenCountryLive = !chosen || chosen.live;
  if (typeof window === "undefined" || isLocalDevRuntime()) {
    return { url: s.pocketbaseUrl, source: "dev", chosenCountry: chosen, serverCountry, chosenCountryLive };
  }
  if (isExplicitPocketBaseUrl(s.pocketbaseUrl)) {
    return { url: s.pocketbaseUrl.trim(), source: "admin", chosenCountry: chosen, serverCountry, chosenCountryLive };
  }
  if (serverCountry) {
    return { url: countryPocketBaseUrl(serverCountry), source: "country", chosenCountry: chosen, serverCountry, chosenCountryLive };
  }
  return { url: s.pocketbaseUrl, source: "dev", chosenCountry: chosen, serverCountry, chosenCountryLive };
}

/** Admin settings input value: production shows the saved URL only when it is explicit (else empty + country placeholder). */
export function pocketBaseUrlDraftValue(url: string): string {
  return isLocalDevRuntime() || isExplicitPocketBaseUrl(url) ? url : "";
}

/** Resolved PocketBase server address (see `resolvePocketBaseServer`). */
export function resolvePocketBaseServerUrl(settings?: OnlineDataServerSettings | null): string {
  return resolvePocketBaseServer(settings).url;
}

export function readCachedOnlineDataServerSettings(): OnlineDataServerSettings {
  if (typeof window === "undefined") return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
    return applyLocalDevPocketBaseGuard(normalizeOnlineDataServerSettings(JSON.parse(raw)));
  } catch {
    return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  }
}

export function writeCachedOnlineDataServerSettings(settings: OnlineDataServerSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
    window.dispatchEvent(
      new CustomEvent(ONLINE_DATA_SERVER_CHANGED_EVENT, { detail: settings })
    );
  } catch {
    /* ignore */
  }
}

/**
 * Fetch `app_settings/online_data_server` from the Pocket Ledger Server (PocketBase).
 * Public route that requires no authentication; returns null if unreachable or not set.
 */
export async function fetchOnlineDataServerFromPocketBase(): Promise<OnlineDataServerSettings | null> {
  try {
    const { pbPublicRequest } = await import("@/lib/pocketbaseData/pbClient");
    const res = (await pbPublicRequest("/api/pl/app-settings/online_data_server", { timeoutMs: 5000 })) as {
      exists?: boolean;
      data?: unknown;
    } | null;
    if (!res || res.exists !== true) return null;
    return applyLocalDevPocketBaseGuard(normalizeOnlineDataServerSettings(res.data));
  } catch {
    return null;
  }
}

let onlineDataServerHydratePromise: Promise<OnlineDataServerSettings> | null = null;

/** One-shot read into local cache: PocketBase first, Firestore fallback on error. */
export async function ensureOnlineDataServerSettingsHydrated(opts?: {
  /** Re-read server even if already hydrated this session (e.g. right before company create). */
  force?: boolean;
}): Promise<OnlineDataServerSettings> {
  if (typeof window === "undefined") return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  if (opts?.force) onlineDataServerHydratePromise = null;
  if (!onlineDataServerHydratePromise) {
    onlineDataServerHydratePromise = (async () => {
      try {
        // 1. Try Pocket Ledger Server first (PocketBase is the primary data server)
        const fromPb = await fetchOnlineDataServerFromPocketBase();
        if (fromPb) {
          writeCachedOnlineDataServerSettings(fromPb);
          return fromPb;
        }

        // 2. Fallback to Firestore if not blocked
        const { isFirestoreBlockedForServerSession } = await import("@/lib/plClientSession");
        if (!isFirestoreBlockedForServerSession()) {
          const { doc, getDoc } = await import("@/lib/pbCompat/firestore");
          const { firestore } = await import("@/lib/plClientSession");
          const snap = await Promise.race([
            getDoc(doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID)),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
          ]);
          if (snap.exists()) {
            const next = applyLocalDevPocketBaseGuard(normalizeOnlineDataServerSettings(snap.data()));
            writeCachedOnlineDataServerSettings(next);
            return next;
          }
        }
        return readCachedOnlineDataServerSettings();
      } catch {
        onlineDataServerHydratePromise = null;
        return readCachedOnlineDataServerSettings();
      }
    })();
  }
  return onlineDataServerHydratePromise;
}

/** Server selected by the SuperAdmin (from given settings or local cache). */
export function getActiveOnlineDataServer(settings?: OnlineDataServerSettings | null): OnlineDataServerDef {
  const id = normalizeOnlineDataServerId(settings?.serverId ?? readCachedOnlineDataServerSettings().serverId);
  return getOnlineDataServerDef(id) ?? ONLINE_DATA_SERVERS[0];
}

export type OnlineDataBackendResolution = {
  /** Server the SuperAdmin selected. */
  selected: OnlineDataServerDef;
  /** Backend that will actually store the data right now. */
  effective: OnlineDataServerDef;
  /** True when `selected` has no data sync backend yet and we fell back to Firebase. */
  fallbackToFirebase: boolean;
};

let warnedNotImplementedFor: string | null = null;

/**
 * SEAM - choose the backend for new online companies (the SuperAdmin selection).
 * If the selected server is not implemented, logs a one-time warning and returns
 * `fallbackToFirebase: true`.
 */
export function resolveOnlineDataBackend(
  settings?: OnlineDataServerSettings | null,
  context = "online data"
): OnlineDataBackendResolution {
  const selected = getActiveOnlineDataServer(settings);
  if (selected.implemented) {
    return { selected, effective: selected, fallbackToFirebase: false };
  }
  const firebase = getOnlineDataServerDef("firebase") ?? ONLINE_DATA_SERVERS[0];
  if (warnedNotImplementedFor !== selected.id) {
    warnedNotImplementedFor = selected.id;
    console.warn(
      `[onlineDataServer] ${selected.name} backend not implemented yet (${context}) - using Firebase. ${POCKETBASE_BACKEND_NOT_IMPLEMENTED_MESSAGE}`
    );
  }
  return { selected, effective: firebase, fallbackToFirebase: true };
}

/**
 * Backend that stores an existing company's online data: its recorded `onlineServerId`
 * (PocketBase or Firebase). Companies without the field are Firebase companies.
 */
export function resolveCompanyOnlineDataBackend(company: unknown): OnlineDataServerDef {
  const firebase = getOnlineDataServerDef("firebase") ?? ONLINE_DATA_SERVERS[0];
  if (!company || typeof company !== "object") return firebase;
  const raw = (company as { onlineServerId?: unknown }).onlineServerId;
  const def = typeof raw === "string" ? getOnlineDataServerDef(raw.trim()) : null;
  return def && def.implemented ? def : firebase;
}
