import { ANDROID_APP_VERSION, DESKTOP_APP_VERSION } from "@/config/releaseVersion";
import { liveCountryPublicOrigin, resolveAppCountry } from "@/lib/countryAppHosts";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

export type ReleaseItem = {
  version?: string;
  url?: string;
  playStoreUrl?: string;
  format?: "apk" | "aab";
};

export type ReleaseManifest = {
  date?: string;
  windows?: ReleaseItem | null;
  android?: ReleaseItem | null;
  androidAab?: ReleaseItem | null;
};

export type ReleaseUpdateInfo = {
  version: string;
  url: string;
  kind: "desktop" | "android";
  playStoreUrl?: string;
  format?: "apk" | "aab";
};

export type ReleaseCheckResult =
  | { status: "update"; update: ReleaseUpdateInfo; installed: string }
  | { status: "current"; installed: string; available: string }
  | { status: "offline" }
  | { status: "unsupported" }
  | { status: "error"; message?: string };

export const RELEASE_UPDATE_MANUAL_CHECK_EVENT = "pl-release-update-manual-check";
export const RELEASE_UPDATE_FOUND_EVENT = "pl-release-update-found";

const DAILY_CHECK_KEY = "pl-release-update-check-v1";

export function compareReleaseVersions(a: string, b: string): number {
  const left = String(a || "0")
    .split(/[.-]/)
    .map((part) => Number(part) || 0);
  const right = String(b || "0")
    .split(/[.-]/)
    .map((part) => Number(part) || 0);
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Default (Nepal) manifest URL; also the fallback when the user's country is unknown/not live/unreachable. */
export function defaultReleaseManifestUrl(): string {
  return `${liveCountryPublicOrigin()}/releases/latest.json`;
}

/** Manifest URL for the user's selected/detected app country (live countries only), else the default. */
export function latestReleaseManifestUrl(): string {
  try {
    const rec = resolveAppCountry();
    if (rec && rec.live && rec.host) return `https://${rec.host}/releases/latest.json`;
  } catch {
    /* fall through to default */
  }
  return defaultReleaseManifestUrl();
}

export function installedReleaseVersion(): { kind: "desktop" | "android" | null; version: string } {
  if (isElectronDesktopApp()) return { kind: "desktop", version: DESKTOP_APP_VERSION };
  if (isCapacitorNativeApp()) return { kind: "android", version: ANDROID_APP_VERSION };
  return { kind: null, version: "" };
}

export function shouldSkipDailyAutoReleaseCheck(): boolean {
  try {
    return window.localStorage.getItem(DAILY_CHECK_KEY) === todayKey();
  } catch {
    return false;
  }
}

export function markDailyAutoReleaseCheckDone(): void {
  try {
    window.localStorage.setItem(DAILY_CHECK_KEY, todayKey());
  } catch {
    /* ignore */
  }
}

async function fetchManifestFrom(url: string): Promise<ReleaseManifest> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Release check failed: ${response.status}`);
  return (await response.json()) as ReleaseManifest;
}

export async function fetchReleaseManifest(): Promise<ReleaseManifest> {
  const countryUrl = latestReleaseManifestUrl();
  const defaultUrl = defaultReleaseManifestUrl();
  try {
    return await fetchManifestFrom(countryUrl);
  } catch (e) {
    if (countryUrl === defaultUrl) throw e;
    return await fetchManifestFrom(defaultUrl);
  }
}

export function evaluateReleaseManifest(manifest: ReleaseManifest): ReleaseCheckResult {
  const installedInfo = installedReleaseVersion();
  if (!installedInfo.kind) return { status: "unsupported" };
  const item = installedInfo.kind === "desktop" ? manifest.windows : manifest.android;
  const androidApk =
    installedInfo.kind === "android" && item?.format !== "aab"
      ? item
      : installedInfo.kind === "android" && manifest.android?.format !== "aab"
        ? manifest.android
        : null;
  const androidItem = installedInfo.kind === "android" ? androidApk || item : item;
  const playStoreUrl =
    installedInfo.kind === "android" ? String(item?.playStoreUrl || "").trim() : "";
  const artifactUrl = String(androidItem?.url || item?.url || "").trim();
  const targetUrl =
    installedInfo.kind === "desktop"
      ? artifactUrl
      : String(androidApk?.url || "").trim() || playStoreUrl || artifactUrl;
  const available = String(item?.version || "").trim();
  if (!available || !targetUrl) {
    return { status: "error", message: "No published release found." };
  }
  if (compareReleaseVersions(available, installedInfo.version) <= 0) {
    return { status: "current", installed: installedInfo.version, available };
  }
  const artifactFormat =
    androidItem?.format ||
    item?.format ||
    (artifactUrl.toLowerCase().endsWith(".aab") ? "aab" : artifactUrl ? "apk" : undefined);
  return {
    status: "update",
    installed: installedInfo.version,
    update: {
      version: available,
      url: targetUrl,
      kind: installedInfo.kind,
      playStoreUrl: playStoreUrl || undefined,
      format: artifactFormat,
    },
  };
}

export async function checkForReleaseUpdate(options?: { force?: boolean }): Promise<ReleaseCheckResult> {
  const installedInfo = installedReleaseVersion();
  if (!installedInfo.kind) return { status: "unsupported" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { status: "offline" };
  if (!options?.force && shouldSkipDailyAutoReleaseCheck()) {
    return { status: "current", installed: installedInfo.version, available: installedInfo.version };
  }
  try {
    const manifest = await fetchReleaseManifest();
    const result = evaluateReleaseManifest(manifest);
    if (!options?.force) markDailyAutoReleaseCheckDone();
    return result;
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Update check failed.",
    };
  }
}

export function dispatchReleaseUpdateFound(update: ReleaseUpdateInfo): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RELEASE_UPDATE_FOUND_EVENT, { detail: update }));
}

export function requestManualReleaseUpdateCheck(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RELEASE_UPDATE_MANUAL_CHECK_EVENT));
}
