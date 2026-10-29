"use client";

import { getEmbeddedLockShellKind } from "@/lib/embeddedDeviceLock";
import { isPlNavRedirectDebugEnabled, plNavDbg, plNavDbgIdHint } from "@/lib/plNavRedirectDebug";

/** Fired when this tab's selected company id actually changes (`detail: { previous, next }`). */
export const SELECTED_COMPANY_CHANGED_EVENT = "pl-selected-company-changed";

/** Legacy global — sirf nayi tab / pehli visit fallback; running tab is key se kabhi switch na ho. */
const GLOBAL_COMPANY_ID_KEY = "companyId";
/** Fast path — is tab ki current company (session). */
const TAB_COMPANY_ID_KEY = "pl_tab_companyId_v1";
/** Stable tab id — `window.name` refresh ke baad bhi same tab ko pehchanne ke liye. */
const TAB_INSTANCE_SESSION_KEY = "pl_tab_instance_id_v1";
/** Per-tab company map in localStorage — session clear (EXE refresh) par bhi tab A ≠ tab B. */
const TAB_COMPANIES_MAP_KEY = "pl_tab_companies_v1";

function cleanCompanyId(value: string | null | undefined): string {
  return String(value || "").trim();
}

function isExeMultiTabShell(): boolean {
  return getEmbeddedLockShellKind() === "exe";
}

/** EXE BrowserView: main process assigns id — sessionStorage is shared across tabs. */
function readElectronMainTabInstanceId(): string {
  if (!isExeMultiTabShell()) return "";
  try {
    const w = window as Window & { plElectronApp?: { tabInstanceId?: string } };
    return cleanCompanyId(w.plElectronApp?.tabInstanceId);
  } catch {
    return "";
  }
}

function getTabInstanceId(): string {
  if (typeof window === "undefined") return "ssr";

  const exeTabId = readElectronMainTabInstanceId();
  if (exeTabId) {
    try {
      window.name = exeTabId;
    } catch {
      /* ignore */
    }
    return exeTabId;
  }

  // EXE BrowserViews share sessionStorage — never use TAB_INSTANCE_SESSION_KEY here (refresh/map key drift).
  if (isExeMultiTabShell()) {
    try {
      const fromName = String(window.name || "").trim();
      if (fromName.startsWith("pl_tab_")) return fromName;
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `pl_tab_${crypto.randomUUID()}`
          : `pl_tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      window.name = id;
      return id;
    } catch {
      return `pl_tab_fallback_${Date.now()}`;
    }
  }

  try {
    let id = cleanCompanyId(window.sessionStorage.getItem(TAB_INSTANCE_SESSION_KEY));
    if (id) return id;

    const fromName = String(window.name || "").trim();
    if (fromName.startsWith("pl_tab_")) {
      id = fromName;
    } else {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `pl_tab_${crypto.randomUUID()}`
          : `pl_tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      window.name = id;
    }
    window.sessionStorage.setItem(TAB_INSTANCE_SESSION_KEY, id);
    return id;
  } catch {
    return `pl_tab_fallback_${Date.now()}`;
  }
}

function readTabCompanyMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TAB_COMPANIES_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const cid = cleanCompanyId(typeof v === "string" ? v : "");
      if (cid) out[k] = cid;
    }
    return out;
  } catch {
    return {};
  }
}

function writeTabCompanyToMap(companyId: string): void {
  if (typeof window === "undefined") return;
  const tabId = getTabInstanceId();
  const map = readTabCompanyMap();
  const clean = cleanCompanyId(companyId);
  if (clean) map[tabId] = clean;
  else delete map[tabId];
  try {
    window.localStorage.setItem(TAB_COMPANIES_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function readTabCompanyFromMap(): string {
  const tabId = getTabInstanceId();
  return cleanCompanyId(readTabCompanyMap()[tabId]);
}

function writeTabSessionCompanyId(companyId: string): void {
  if (typeof window === "undefined") return;
  // EXE: sessionStorage shared — per-tab company sirf localStorage map me.
  if (isExeMultiTabShell()) return;
  const clean = cleanCompanyId(companyId);
  try {
    if (clean) window.sessionStorage.setItem(TAB_COMPANY_ID_KEY, clean);
    else window.sessionStorage.removeItem(TAB_COMPANY_ID_KEY);
  } catch {
    /* ignore */
  }
}

export type WriteSelectedCompanyOptions = {
  /** false = boot/rehydrate — global `companyId` mat badlo (doosri tab refresh par overwrite na ho). */
  userInitiated?: boolean;
};

/**
 * Multi-tab: har tab/window apni company rakhe.
 * Read order: session → per-tab map (refresh-safe) → global last-used (nayi tab only).
 */
export function readSelectedCompanyId(): string {
  if (typeof window === "undefined") return "";
  if (!isExeMultiTabShell()) {
    try {
      const tabCompanyId = cleanCompanyId(window.sessionStorage.getItem(TAB_COMPANY_ID_KEY));
      if (tabCompanyId) return tabCompanyId;
    } catch {
      /* sessionStorage blocked */
    }
  }
  const fromMap = readTabCompanyFromMap();
  if (fromMap) return fromMap;
  try {
    const global = cleanCompanyId(window.localStorage.getItem(GLOBAL_COMPANY_ID_KEY));
    // EXE refresh: naya tab map key / preload race — global last-used se is tab dubara pin karo.
    if (global && isExeMultiTabShell()) {
      writeTabCompanyToMap(global);
    }
    return global;
  } catch {
    return "";
  }
}

/** User company pick — tab map + session; global sirf nayi tab hint ke liye. */
export function writeSelectedCompanyId(companyId: string, options?: WriteSelectedCompanyOptions): void {
  if (typeof window === "undefined") return;
  const prev = readSelectedCompanyId();
  const clean = cleanCompanyId(companyId);
  const userInitiated = options?.userInitiated !== false;

  writeTabSessionCompanyId(clean);
  writeTabCompanyToMap(clean);

  if (userInitiated) {
    try {
      if (clean) window.localStorage.setItem(GLOBAL_COMPANY_ID_KEY, clean);
      else window.localStorage.removeItem(GLOBAL_COMPANY_ID_KEY);
    } catch {
      /* ignore */
    }
  }

  if (isPlNavRedirectDebugEnabled()) {
    plNavDbg("selectedCompanyStorage.writeSelectedCompanyId", {
      hint: clean ? plNavDbgIdHint(clean) : "CLEARED",
      userInitiated,
      tabInstance: getTabInstanceId().slice(0, 24),
      sessionKey: TAB_COMPANY_ID_KEY,
      globalKey: userInitiated ? GLOBAL_COMPANY_ID_KEY : "(skipped boot)",
    });
  }

  if (prev !== clean) {
    try {
      window.dispatchEvent(
        new CustomEvent(SELECTED_COMPANY_CHANGED_EVENT, { detail: { previous: prev, next: clean } })
      );
    } catch {
      /* ignore */
    }
  }
}

/** Refresh / boot: is tab ki company dubara pin — global last-used mat chhedo. */
export function pinBootSelectedCompanyId(companyId: string): void {
  writeSelectedCompanyId(companyId, { userInitiated: false });
}

/** Logout/delete current company: clear tab override and global fallback together. */
export function clearSelectedCompanyId(): void {
  writeSelectedCompanyId("", { userInitiated: true });
}

/** Auto-select first company only when neither this tab nor global last-login has a saved company. */
export function hasAnySelectedCompanyId(): boolean {
  return Boolean(readSelectedCompanyId());
}
