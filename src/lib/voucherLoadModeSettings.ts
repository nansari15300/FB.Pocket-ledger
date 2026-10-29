/**
 * SuperAdmin global: company voucher load mode (`app_settings/voucher_load`).
 * Default `lazy` = current hydrate-by-range behavior (unchanged for existing users).
 * `all` = full vouchers mirror pull on company open when missing/stale (>7 days). Data only, not files.
 */
export const VOUCHER_LOAD_SETTINGS_DOC = "app_settings/voucher_load";
export const VOUCHER_LOAD_SETTINGS_COLLECTION = "app_settings";
export const VOUCHER_LOAD_SETTINGS_ID = "voucher_load";

export type VoucherLoadMode = "lazy" | "all";

export type VoucherLoadSettings = {
  /** `lazy` (default) | `all` */
  mode: VoucherLoadMode;
  /** Max age of a successful full voucher mirror before All mode pulls again. */
  fullMirrorMaxAgeMs: number;
  updatedAtMs: number;
};

export const VOUCHER_FULL_MIRROR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_VOUCHER_LOAD_SETTINGS: VoucherLoadSettings = {
  mode: "lazy",
  fullMirrorMaxAgeMs: VOUCHER_FULL_MIRROR_MAX_AGE_MS,
  updatedAtMs: 0,
};

const CACHE_KEY = "pl_voucher_load_settings_v1";
const FULL_MIRROR_AT_PREFIX = "pl_voucher_full_mirror_at_v1_";

export function normalizeVoucherLoadMode(raw: unknown): VoucherLoadMode {
  return raw === "all" ? "all" : "lazy";
}

export function normalizeVoucherLoadSettings(raw: unknown): VoucherLoadSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VOUCHER_LOAD_SETTINGS };
  const o = raw as Partial<VoucherLoadSettings>;
  const maxAge = Number(o.fullMirrorMaxAgeMs);
  return {
    mode: normalizeVoucherLoadMode(o.mode),
    fullMirrorMaxAgeMs:
      Number.isFinite(maxAge) && maxAge >= 60_000 ? maxAge : VOUCHER_FULL_MIRROR_MAX_AGE_MS,
    updatedAtMs: Number(o.updatedAtMs) || 0,
  };
}

export function readCachedVoucherLoadSettings(): VoucherLoadSettings {
  if (typeof window === "undefined") return { ...DEFAULT_VOUCHER_LOAD_SETTINGS };
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_VOUCHER_LOAD_SETTINGS };
    return normalizeVoucherLoadSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VOUCHER_LOAD_SETTINGS };
  }
}

export function writeCachedVoucherLoadSettings(settings: VoucherLoadSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function isVoucherLoadModeAll(settings?: VoucherLoadSettings | null): boolean {
  return normalizeVoucherLoadMode(settings?.mode ?? readCachedVoucherLoadSettings().mode) === "all";
}

function fullMirrorAtKey(companyId: string): string {
  return `${FULL_MIRROR_AT_PREFIX}${String(companyId || "").trim()}`;
}

/** Last successful full vouchers mirror on this device (ms), or 0. */
export function readVoucherFullMirrorAtMs(companyId: string): number {
  if (typeof window === "undefined") return 0;
  const id = String(companyId || "").trim();
  if (!id) return 0;
  try {
    const n = Number(window.localStorage.getItem(fullMirrorAtKey(id)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function markVoucherFullMirrorPulled(companyId: string, atMs = Date.now()): void {
  if (typeof window === "undefined") return;
  const id = String(companyId || "").trim();
  if (!id) return;
  try {
    window.localStorage.setItem(fullMirrorAtKey(id), String(atMs));
  } catch {
    /* ignore */
  }
}

/**
 * All mode: pull when never mirrored on this device, or last pull older than maxAge.
 * Lazy mode callers should not use this for gating Data-tick pulls.
 */
export function shouldPullFullVoucherMirrorForAllMode(
  companyId: string,
  settings?: VoucherLoadSettings | null,
  nowMs = Date.now()
): boolean {
  if (!isVoucherLoadModeAll(settings)) return false;
  const maxAge = settings?.fullMirrorMaxAgeMs ?? readCachedVoucherLoadSettings().fullMirrorMaxAgeMs;
  const last = readVoucherFullMirrorAtMs(companyId);
  if (!last) return true;
  return nowMs - last >= maxAge;
}

let voucherLoadHydratePromise: Promise<VoucherLoadSettings> | null = null;

/** One-shot Firestore read into local cache — used before All-mode pull decisions. */
export async function ensureVoucherLoadSettingsHydrated(): Promise<VoucherLoadSettings> {
  if (typeof window === "undefined") return { ...DEFAULT_VOUCHER_LOAD_SETTINGS };
  if (!voucherLoadHydratePromise) {
    voucherLoadHydratePromise = (async () => {
      try {
        const { doc, getDoc: fsGetDoc } = await import("firebase/firestore");
        const { isPocketBaseAppSessionActive } = await import("@/lib/pocketbaseData/pbAppSession");
        let getDoc = fsGetDoc;
        if (isPocketBaseAppSessionActive()) {
          // Server login: Firestore is offline. Admin Panel (super admin) reads via the server; else cache.
          const seam = await import("@/lib/pocketbaseData/pbReadSeam");
          if (!seam.isAdminServerDataActive()) {
            voucherLoadHydratePromise = null;
            return readCachedVoucherLoadSettings();
          }
          getDoc = seam.getDoc;
        }
        const { firestore } = await import("@/lib/firebase");
        const snap = await getDoc(doc(firestore, VOUCHER_LOAD_SETTINGS_COLLECTION, VOUCHER_LOAD_SETTINGS_ID));
        const next = normalizeVoucherLoadSettings(snap.exists() ? snap.data() : undefined);
        writeCachedVoucherLoadSettings(next);
        return next;
      } catch {
        return readCachedVoucherLoadSettings();
      }
    })();
  }
  return voucherLoadHydratePromise;
}