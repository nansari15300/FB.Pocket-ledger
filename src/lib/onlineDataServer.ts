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

export const DEFAULT_ONLINE_DATA_SERVER_ID: OnlineDataServerId = "firebase";

/** Shown only for a server whose data sync is not built (falls back to Firebase). */
export const POCKETBASE_BACKEND_NOT_IMPLEMENTED_MESSAGE =
  "This server's data sync is not available; data saves to Firebase.";

export const ONLINE_DATA_SERVER_POCKETBASE_ID: OnlineDataServerId = "pocketbase";

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

export function readCachedOnlineDataServerSettings(): OnlineDataServerSettings {
  if (typeof window === "undefined") return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
    return normalizeOnlineDataServerSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  }
}

export function writeCachedOnlineDataServerSettings(settings: OnlineDataServerSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

let onlineDataServerHydratePromise: Promise<OnlineDataServerSettings> | null = null;

/** One-shot Firestore read into local cache (falls back to cache / default on error). */
export async function ensureOnlineDataServerSettingsHydrated(opts?: {
  /** Re-read Firestore even if already hydrated this session (e.g. right before company create). */
  force?: boolean;
}): Promise<OnlineDataServerSettings> {
  if (typeof window === "undefined") return { ...DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
  if (opts?.force) onlineDataServerHydratePromise = null;
  if (!onlineDataServerHydratePromise) {
    onlineDataServerHydratePromise = (async () => {
      try {
        // Login type (email / Google / Pocket Ledger Server account) does not pick the backend.
        // SuperAdmin Settings (Firebase vs Pocket Ledger Server) is the only source.
        const { doc, getDoc } = await import("firebase/firestore");
        const { firestore } = await import("@/lib/firebase");
        const snap = await Promise.race([
          getDoc(doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID)),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
        const next = normalizeOnlineDataServerSettings(snap.exists() ? snap.data() : undefined);
        writeCachedOnlineDataServerSettings(next);
        return next;
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
