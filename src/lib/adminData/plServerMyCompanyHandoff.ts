/**
 * Server panel My Company → web app company UI.
 * Stores only the return URL so the app can show Back to server.
 */

import { isPlServerPackedApp } from "@/lib/plServerPackedApp";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import {
  isPocketBaseAppSessionMarked,
  readPocketBaseAppProfile,
  startPocketBaseAppSession,
} from "@/lib/pocketbaseData/pbAppSession";

const RETURN_KEY = "pl_server_my_company_return_v1";

function ss(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function storedReturnUrl(): string {
  try {
    const fromSs = String(ss()?.getItem(RETURN_KEY) || "").trim();
    if (fromSs) return fromSs;
    return String(ls()?.getItem(RETURN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function fallbackServerPanelHref(): string {
  try {
    const loc = window.location;
    if (isPlServerPackedApp()) {
      return `${String(loc.origin || "").replace(/\/+$/, "")}/#/dashboard`;
    }
    const host = loc.hostname || "127.0.0.1";
    const proto = loc.protocol || "http:";
    if (loc.port === "3000" || (loc.pathname || "").startsWith("/app")) {
      return `${proto}//${host}:8090/#/dashboard`;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function isPlServerMyCompanyHandoff(): boolean {
  return !!storedReturnUrl();
}

export function plServerMyCompanyReturnUrl(): string {
  return storedReturnUrl();
}

export function plServerBackToServerHref(): string {
  return storedReturnUrl() || fallbackServerPanelHref();
}

export function goBackToPlServer(): void {
  const href = plServerBackToServerHref();
  clearPlServerMyCompanyHandoff();
  if (typeof window !== "undefined" && href) window.location.href = href;
}

export function clearPlServerMyCompanyHandoff(): void {
  try {
    ss()?.removeItem(RETURN_KEY);
    ls()?.removeItem(RETURN_KEY);
    ss()?.removeItem("pl_server_my_company_auth_v1");
  } catch {
    /* ignore */
  }
}

/** Pull `?from=pl-server&return=` off the URL once. */
export function capturePlServerMyCompanyHandoff(): void {
  if (typeof window === "undefined") return;
  let search: URLSearchParams;
  try {
    search = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const fromServer = search.get("from") === "pl-server" || search.get("from") === "server";
  const ret = String(search.get("return") || "").trim();
  if (fromServer && ret) {
    try {
      ss()?.setItem(RETURN_KEY, ret);
      ls()?.setItem(RETURN_KEY, ret);
    } catch {
      /* ignore */
    }
  }
  if (!fromServer) return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("from");
    u.searchParams.delete("return");
    u.searchParams.delete("pb");
    u.hash = "";
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}`);
  } catch {
    /* ignore */
  }
}

function ensurePackedMyCompanySession(): void {
  if (!isPlServerPackedApp()) return;
  if (!getValidPocketBaseAuth()) return;
  if (isPocketBaseAppSessionMarked() && readPocketBaseAppProfile()) return;
  void startPocketBaseAppSession().catch(() => {
    /* panel token missing / user not yet approved */
  });
}

if (typeof window !== "undefined") {
  capturePlServerMyCompanyHandoff();
  ensurePackedMyCompanySession();
}
