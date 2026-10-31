"use client";

import type { Company } from "@/hooks/useCompany";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import { isOfflineCompanyStorage, isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { isDeviceLocalCompany, isServerGateCompany } from "@/lib/companyStorageKind";
import {
  ONLINE_DATA_SERVER_POCKETBASE_ID,
  readCachedOnlineDataServerSettings,
  resolveOnlineDataBackend,
  resolvePocketBaseServerUrl,
  type OnlineDataServerSettings,
} from "@/lib/onlineDataServer";
import {
  DATA_SOURCE_MODE_STORAGE_KEY,
  type DataSourceMode,
} from "@/lib/dataSourceModeDefaults";
import {
  isPlHubServerClientMode,
  clearPlHubServerClientMode,
  clearPlRemoteServerClientMode,
  isPlRemoteServerClientMode,
  isPlServerGateClientActive,
  markPlHubServerClientMode,
  markPlRemoteServerClientMode,
} from "@/lib/plRemoteServerClient";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isEmbeddedMobileShell } from "@/lib/isCapacitorNative";
import {
  clearPlServerAccessContext,
  applyPlServerAccessContextPayload,
  filterCompaniesForPlServerAccess,
  buildPlServerGatePreviewCompanyList,
  persistDevClientAccessToken,
  isPlServerSharedCompanyRow,
} from "@/lib/plServerAccessContext";
import { PL_DEV_CLIENT_ACCESS_TOKEN_KEY } from "@/lib/plServerAccessContext";
import {
  BUILTIN_DEVICE_GATE_ID,
  BUILTIN_ONLINE_GATE_ID,
  PL_GATE_CHANGED_EVENT,
  type GateRecord,
} from "@/lib/gates/gateTypes";
import { getActiveGate, normalizeServerUrl, updateGate, writeActiveGateId, writeGateTransportUrl, resolveGateServerTransportUrl } from "@/lib/gates/gateStore";
import {
  buildLocalServerConnectUrl,
  fetchGateServerAccessContext,
  resolvePlSharingTransportUrl,
  type GateServerAccessContext,
} from "@/lib/gates/gateServerFetch";
import { isAppUiOrigin } from "@/lib/plGatePageOrigin";

const LOCAL_API_BASE_KEY = "localApiBaseUrl";

export function dispatchGateChanged(options?: { skipCrossTab?: boolean }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PL_GATE_CHANGED_EVENT));
  if (options?.skipCrossTab) return;
  void import("@/lib/gates/gateCrossTabSync")
    .then(({ publishGateStoreSnapshotToElectron }) => publishGateStoreSnapshotToElectron())
    .catch(() => undefined);
}

function setDataSourceMode(mode: DataSourceMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DATA_SOURCE_MODE_STORAGE_KEY, mode);
}

function setLocalApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_API_BASE_KEY, url);
}

function persistGateAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    const t = token.trim();
    if (t) sessionStorage.setItem(PL_DEV_CLIENT_ACCESS_TOKEN_KEY, t);
    else sessionStorage.removeItem(PL_DEV_CLIENT_ACCESS_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

type PlElectronGateBridge = {
  setRemoteAuth?: (serverUrl: string, accessToken: string) => { ok?: boolean };
};

/** EXE staff client: remote gate origin register — webRequest PL headers + LAN fetch routing. */
export function registerElectronRemoteGateOrigin(serverUrlRaw: string): void {
  if (typeof window === "undefined" || !isElectronDesktopApp()) return;
  const url = normalizeServerUrl(serverUrlRaw);
  if (!url) return;
  try {
    const bridge = (window as Window & { plElectronGate?: PlElectronGateBridge }).plElectronGate;
    bridge?.setRemoteAuth?.(url, "");
  } catch {
    /* ignore */
  }
}

/** Apply active gate to runtime (data source, tokens, remote client flags). */
export function applyActiveGateRuntime(gate: GateRecord): void {
  if (typeof window === "undefined") return;

  switch (gate.type) {
    case "device":
      clearPlRemoteServerClientMode();
      clearPlHubServerClientMode();
      clearPlServerAccessContext();
      persistGateAccessToken("");
      setDataSourceMode("local");
      setLocalApiBaseUrl("http://127.0.0.1:3001");
      break;
    case "online":
      clearPlRemoteServerClientMode();
      clearPlHubServerClientMode();
      clearPlServerAccessContext();
      persistGateAccessToken("");
      setDataSourceMode("firebase");
      break;
    case "local_server": {
      persistGateAccessToken("");
      if (gate.serverUrl) {
        const transportUrl = resolveGateServerTransportUrl(gate);
        setLocalApiBaseUrl(transportUrl || gate.serverUrl);
        registerElectronRemoteGateOrigin(transportUrl || gate.serverUrl);
      }
      setDataSourceMode("local");
      break;
    }
    default:
      break;
  }
  dispatchGateChanged();
}

export function activateGate(gateId: string): GateRecord {
  writeActiveGateId(gateId);
  const gate = getActiveGate();
  applyActiveGateRuntime(gate);
  return gate;
}

/** Refresh server access context for active local_server gate (bundled app). */
export async function refreshActiveLocalServerGateContext(
  gate: GateRecord
): Promise<GateServerAccessContext | null> {
  if (gate.type !== "local_server" || !gate.serverUrl) return null;
  const fetchUrl = resolveGateServerTransportUrl(gate) || gate.serverUrl;
  const ctx = await fetchGateServerAccessContext(fetchUrl, "", { timeoutMs: 15_000 });
  if (!ctx.error) {
    const payload = {
      unrestricted: ctx.unrestricted,
      allowedCompanyIds: ctx.allowedCompanyIds,
      label: ctx.label ?? undefined,
      companies: ctx.companies ?? undefined,
    };
    applyPlServerAccessContextPayload(payload, gate.id);
    await import("@/lib/plServerGateCleanup")
      .then((m) => m.pruneLocalServerGateCompaniesFromAccessPayload(gate, payload))
      .catch(() => ({ removedIds: [], skipped: true }));
    dispatchGateChanged();
  } else if (/invalid|missing token|403/i.test(ctx.error)) {
    clearPlServerAccessContext();
  }
  return ctx;
}

/** EXE/APK bundled shell: server gate activate + SQLite mirror — remote URL par navigate mat. */
export async function activateLocalServerGateOnBundledClient(
  gate: GateRecord
): Promise<{ ok: boolean; message?: string }> {
  if (gate.type !== "local_server" || !gate.serverUrl) {
    return { ok: false, message: "Invalid server gate" };
  }
  const { resolvePlSharingServerUrlForGate } = await import("@/lib/gates/gateServerFetch");
  const resolved = await resolvePlSharingServerUrlForGate(gate.serverUrl, "", { timeoutMs: 15_000 });
  const transportUrl = resolvePlSharingTransportUrl(resolved, gate.serverUrl);
  writeGateTransportUrl(gate.id, transportUrl);
  persistDevClientAccessToken("");
  const tokenlessGate: GateRecord = { ...gate, accessToken: "" };
  registerElectronRemoteGateOrigin(transportUrl);
  writeActiveGateId(gate.id);
  applyActiveGateRuntime(tokenlessGate);
  const ctx =
    resolved.accessContext && !resolved.accessContext.error
      ? resolved.accessContext
      : await refreshActiveLocalServerGateContext(tokenlessGate);
  if (ctx?.error) return { ok: false, message: ctx.error };
  if (ctx && !ctx.error) {
    applyPlServerAccessContextPayload(
      {
        unrestricted: ctx.unrestricted,
        allowedCompanyIds: ctx.allowedCompanyIds,
        label: ctx.label ?? null,
        companies: ctx.companies ?? null,
      },
      gate.id
    );
  }
  const { syncPlServerGateToLocalSqlite } = await import("@/lib/plServerClientCompanyDelta");
  await syncPlServerGateToLocalSqlite(tokenlessGate, { pullFullLedger: true }).catch(() => undefined);
  dispatchGateChanged();
  if (!resolved.capable) {
    return {
      ok: true,
      message:
        "Gate connected. If vouchers stay empty, use host sharing port 3001 (not app UI 3000) and keep Server sharing ON.",
    };
  }
  return { ok: true };
}

/** Web browser hub: server gate activate in-place — relay se, sharing URL par navigate mat. */
export async function activateLocalServerGateOnWebClient(
  gate: GateRecord
): Promise<{ ok: boolean; message?: string }> {
  if (gate.type !== "local_server" || !gate.serverUrl) {
    return { ok: false, message: "Invalid server gate" };
  }
  if (isPlHubServerClientMode() && getActiveGate().id === gate.id) {
    const ctx = await refreshActiveLocalServerGateContext(gate);
    if (ctx?.error) return { ok: false, message: ctx.error };
    dispatchGateChanged();
    return { ok: true };
  }
  const { resolvePlSharingServerUrlForGate } = await import("@/lib/gates/gateServerFetch");
  const resolved = await resolvePlSharingServerUrlForGate(gate.serverUrl, "", { timeoutMs: 15_000 });
  const transportUrl = resolvePlSharingTransportUrl(resolved, gate.serverUrl);
  writeGateTransportUrl(gate.id, transportUrl);
  persistDevClientAccessToken("");
  const tokenlessGate: GateRecord = { ...gate, accessToken: "" };
  registerElectronRemoteGateOrigin(transportUrl);
  writeActiveGateId(gate.id);
  markPlHubServerClientMode();
  applyActiveGateRuntime(tokenlessGate);
  const ctx =
    resolved.accessContext && !resolved.accessContext.error
      ? resolved.accessContext
      : await refreshActiveLocalServerGateContext(tokenlessGate);
  if (ctx?.error) return { ok: false, message: ctx.error };
  if (ctx && !ctx.error) {
    applyPlServerAccessContextPayload(
      {
        unrestricted: ctx.unrestricted,
        allowedCompanyIds: ctx.allowedCompanyIds,
        label: ctx.label ?? null,
        companies: ctx.companies ?? null,
      },
      gate.id
    );
  }
  dispatchGateChanged();
  return { ok: true };
}

/** PLServer gates are token-free; stale saved tokens must not be sent. */
export function resolveLocalServerGateAccessToken(_gate: GateRecord): string {
  return "";
}

/** Hub / EXE app UI: server company in-place unlock — sharing URL par navigate mat. */
export function navigateToLocalServerGate(gate: GateRecord, companyId?: string): void {
  if (gate.type !== "local_server" || !gate.serverUrl) return;
  if (!isEmbeddedMobileShell()) {
    void import("@/lib/plGatePageOrigin").then(({ isAppUiOrigin }) => {
      if (isAppUiOrigin() && !isPlRemoteServerClientMode()) {
        void activateLocalServerGateOnWebClient(gate).catch(() => undefined);
        return;
      }
      void import("@/lib/plServerCompanySelectNavigate").then(({ openPlServerGateConnectUrl }) => {
        void openPlServerGateConnectUrl(gate, companyId);
      });
    });
    return;
  }
  const token = resolveLocalServerGateAccessToken(gate);
  persistDevClientAccessToken(token);
  const tokenlessGate = { ...gate, accessToken: "" };
  applyActiveGateRuntime(tokenlessGate);
  writeActiveGateId(gate.id);
  const url = buildLocalServerConnectUrl(gate.serverUrl, token, companyId);
  markPlRemoteServerClientMode();
  registerElectronRemoteGateOrigin(gate.serverUrl);
  try {
    const bridge = (window as Window & { plElectronGate?: PlElectronGateBridge }).plElectronGate;
    bridge?.setRemoteAuth?.(gate.serverUrl, token);
  } catch {
    /* non-Electron */
  }
  window.location.href = url;
}

/** Back to bundled Capacitor shell from remote server origin. */
export function navigateToBundledDeviceGate(): void {
  activateGate(BUILTIN_DEVICE_GATE_ID);
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}

export function isDeviceGate(gate: GateRecord): boolean {
  return gate.type === "device" || gate.id === BUILTIN_DEVICE_GATE_ID;
}

export function isOnlineGate(gate: GateRecord): boolean {
  return gate.type === "online" || gate.id === BUILTIN_ONLINE_GATE_ID;
}

export function isLocalServerGate(gate: GateRecord): boolean {
  return gate.type === "local_server";
}

/** Filter company list for active gate. */
export function filterCompaniesForActiveGate(companies: Company[], gate: GateRecord): Company[] {
  const visible = companies.filter(
    (c) => c && c.isDeleted !== true && c.movedToAdminRecycleAt == null
  );

  if (isDeviceGate(gate)) {
    return visible.filter((c) => isOfflineCompanyStorage(c) && !isCloudBackedCompanyShape(c));
  }

  if (isOnlineGate(gate)) {
    // Online gate: only cloud-linked companies (SQLite `online` folder). No local / PL-server leakage.
    return visible.filter((c) => {
      if (isServerGateCompany(c)) return false;
      if (isDeviceLocalCompany(c) && !isCloudLinkedCompanyStorage(c)) return false;
      return (
        isCloudLinkedCompanyStorage(c) ||
        String(c.storageOption || "").toLowerCase() === "firebase" ||
        String(c.storageOption || "").toLowerCase() === "drive"
      );
    });
  }

  if (isLocalServerGate(gate)) {
    if (isPlServerGateClientActive()) {
      return filterCompaniesForPlServerAccess(visible);
    }
    return buildPlServerGatePreviewCompanyList(visible, gate.id);
  }

  return visible;
}

/** Auto-select: local server gate par device-local (e.g. Drive) ki jagah shared server company prefer karo. */
export function pickGateAwareAutoSelectCompanyId(
  companies: Company[],
  gate?: GateRecord
): string | null {
  if (!companies.length) return null;
  const sorted = [...companies].sort((a, b) => {
    const nameCmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, {
      sensitivity: "base",
    });
    if (nameCmp !== 0) return nameCmp;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  const g = gate ?? getActiveGate();
  if (isLocalServerGate(g) || isPlServerGateClientActive()) {
    const shared = sorted.filter((c) => isPlServerSharedCompanyRow(c, g.id));
    if (shared.length > 0) return shared[0]!.id;
  }
  return sorted[0]!.id;
}

export function activeGateAllowsCompanyCreate(gate: GateRecord): boolean {
  return isDeviceGate(gate) || isOnlineGate(gate);
}

/**
 * Where new Online companies go: the SuperAdmin-selected online data server (same seam as
 * CreateCompanyForm). Settings omitted = local cache.
 */
export function onlineGateServerLabel(settings?: OnlineDataServerSettings | null): string {
  const { effective } = resolveOnlineDataBackend(settings, "gate hint");
  if (effective.id === ONLINE_DATA_SERVER_POCKETBASE_ID) {
    const url = resolvePocketBaseServerUrl(settings ?? readCachedOnlineDataServerSettings());
    return url ? `${effective.name} (${url})` : effective.name;
  }
  return `your online account (${effective.name})`;
}

export function activeGateCreateHint(gate: GateRecord, onlineSettings?: OnlineDataServerSettings | null): string {
  if (isDeviceGate(gate)) {
    return "New companies save on this device (local SQLite). Drive sync uses the same company ID.";
  }
  if (isOnlineGate(gate)) {
    return `New companies save to ${onlineGateServerLabel(onlineSettings)}.`;
  }
  if (isLocalServerGate(gate)) {
    return "Connect to the server to work — create companies on the server PC, or switch to Device / Online gate.";
  }
  return "";
}
