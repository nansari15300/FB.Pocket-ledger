import { isPocketLedgerAppHostname } from "@/lib/pocketLedgerAppHosts";

/**
 * Hosted/gateway web app may run under `basePath` `/app`.
 * EXE/APK static builds stay at `/` (no WEB_APP_BASE_PATH).
 */
export function webAppBasePath(): string {
  const fromEnv =
    typeof process !== "undefined"
      ? String(process.env.NEXT_PUBLIC_WEB_APP_BASE_PATH || "").trim()
      : "";
  if (fromEnv === "/app") return "/app";
  if (typeof window !== "undefined") {
    const p = window.location.pathname || "";
    if (p === "/app" || p.startsWith("/app/")) return "/app";
  }
  return "";
}

/** Prefix an app-relative path with `/app` when the web app uses that basePath. */
export function withWebAppBasePath(pathWithOptionalQueryAndHash: string): string {
  return browserHistoryHref(pathWithOptionalQueryAndHash);
}

function splitPathQueryHash(pathWithOptionalQueryAndHash: string): {
  pathname: string;
  queryPart: string;
  hashPart: string;
} {
  const raw = String(pathWithOptionalQueryAndHash || "");
  const hashIndex = raw.indexOf("#");
  const hashPart = hashIndex >= 0 ? raw.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf("?");
  const queryPart = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  return { pathname: pathname || "/", queryPart, hashPart };
}

/**
 * Hosted pocket-ledger.com Next routes live under `/app` (marketing owns `/`).
 * Join origin + path so `/api/...` and page paths include `/app` when needed.
 */
export function joinPocketLedgerOriginAndPath(
  origin: string,
  pathWithOptionalQueryAndHash: string
): string {
  let originPart = String(origin || "").trim().replace(/\/+$/, "");
  let pathRaw = String(pathWithOptionalQueryAndHash || "");

  if (/^https?:\/\//i.test(pathRaw)) {
    try {
      const u = new URL(pathRaw);
      originPart = u.origin;
      pathRaw = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return pathRaw;
    }
  }

  if (!originPart) {
    return pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  }

  // NEXT_PUBLIC_APP_URL may already be `https://pocket-ledger.com/app`
  const originHasAppSuffix = /\/app$/i.test(originPart);
  const originForHost = originHasAppSuffix ? originPart.slice(0, -4) : originPart;

  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(originForHost) ? originForHost : `https://${originForHost}`)
      .hostname;
  } catch {
    host = "";
  }

  const { pathname, queryPart, hashPart } = splitPathQueryHash(
    pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`
  );

  let nextPath = pathname;
  if (isPocketLedgerAppHostname(host) || originHasAppSuffix) {
    nextPath = ensureWebAppBasePathOnPathname(pathname, "/app");
  }

  const base = originHasAppSuffix ? originForHost : originPart;
  return `${base}${nextPath}${queryPart}${hashPart}`;
}

/** Root-relative public file → correct URL under optional `/app` basePath. */
export function publicAssetUrl(assetPath: string): string {
  const clean = String(assetPath || "").startsWith("/")
    ? String(assetPath)
    : `/${String(assetPath || "")}`;
  return `${webAppBasePath()}${clean}`;
}

/** Same-origin Next.js API route (`npm run dev` gateway: `/app/api/...`, not `/api/...`). */
export function appApiUrl(apiPath: string): string {
  const path = String(apiPath || "").startsWith("/") ? String(apiPath) : `/${String(apiPath || "")}`;
  return `${webAppBasePath()}${path}`;
}

/**
 * `window.history.replaceState` / `pushState` do NOT apply Next `basePath`.
 * Passing `/party?...` drops `/app` from the address bar — hard refresh then hits the
 * marketing gateway 404. Use this for any history API URL that is app-relative.
 * Do NOT use for `router.push` / `router.replace` (Next already prefixes basePath).
 */
export function browserHistoryHref(pathWithOptionalQueryAndHash: string): string {
  const raw = String(pathWithOptionalQueryAndHash || "");
  if (!raw) return raw;
  const base = webAppBasePath();
  if (!base) return raw;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      u.pathname = ensureWebAppBasePathOnPathname(u.pathname, base);
      return `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return raw;
    }
  }

  const { pathname, queryPart, hashPart } = splitPathQueryHash(raw);
  return `${ensureWebAppBasePathOnPathname(pathname, base)}${queryPart}${hashPart}`;
}

function ensureWebAppBasePathOnPathname(pathname: string, base: string): string {
  const p = pathname || "/";
  if (p === base || p.startsWith(`${base}/`)) return p;
  if (!p.startsWith("/")) return `${base}/${p}`;
  return `${base}${p}`;
}

/** Browser pathname → app route (strip optional `/app` + trailing slash). */
export function withoutWebAppBasePath(pathname: string): string {
  const base = webAppBasePath();
  let p = (pathname || "/").replace(/\/+$/, "") || "/";
  if (base && (p === base || p.startsWith(`${base}/`))) {
    p = p.slice(base.length) || "/";
  }
  return p.replace(/\/+$/, "") || "/";
}

/** App-only first segment (hosted web: marketing owns bare `/company`). */
const APP_ONLY_FIRST_SEGMENTS = new Set([
  "dashboard",
  "party",
  "staff",
  "bank-cash",
  "items",
  "tax",
  "incomes",
  "gate",
  "settings",
  "reports",
  "billing",
  "payment-in",
  "payment-out",
  "sale",
  "purchase",
  "journal",
  "contra",
  "notes",
  "gallery",
  "messages",
  "admin",
  "backup",
  "recycle-bin",
  "reconciliation",
  "import-export",
  "production",
  "quotations",
  "add-salary",
  "inter-company",
  "sale-note",
  "purchase-note",
  "distributor-signup",
  "embed",
  "company",
  "loans",
  "not-authorized",
]);

/** True when pathname is an in-app route missing the `/app` prefix (History API / stale href). */
export function isAppUiPathMissingBasePrefix(pathname?: string): boolean {
  const base = webAppBasePath();
  if (!base || typeof window === "undefined") return false;
  const raw = pathname ?? window.location.pathname ?? "/";
  if (raw === base || raw.startsWith(`${base}/`)) return false;
  const inner = withoutWebAppBasePath(raw);
  if (inner === "/") return false;
  const first = inner.split("/").filter(Boolean)[0];
  return !!first && APP_ONLY_FIRST_SEGMENTS.has(first);
}

function coerceHistoryUrl(url: string | URL | null | undefined): string | URL | null | undefined {
  if (url == null || url === "") return url;
  const base = webAppBasePath();
  if (!base || typeof window === "undefined") return url;

  if (typeof url !== "string") {
    if (url instanceof URL && url.origin === window.location.origin) {
      const first = url.pathname.split("/").filter(Boolean)[0];
      if (first && APP_ONLY_FIRST_SEGMENTS.has(first)) {
        url.pathname = ensureWebAppBasePathOnPathname(url.pathname, base);
      }
    }
    return url;
  }
  if (url.startsWith("#") || url.startsWith("?")) return url;

  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.origin !== window.location.origin) return url;
      const first = u.pathname.split("/").filter(Boolean)[0];
      if (first && APP_ONLY_FIRST_SEGMENTS.has(first)) {
        u.pathname = ensureWebAppBasePathOnPathname(u.pathname, base);
      }
      return `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return url;
    }
  }

  const abs = url.startsWith("/") ? url : `/${url}`;
  const { pathname, queryPart, hashPart } = splitPathQueryHash(abs);
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first || !APP_ONLY_FIRST_SEGMENTS.has(first)) return url.startsWith("/") ? url : abs;
  return `${ensureWebAppBasePathOnPathname(pathname, base)}${queryPart}${hashPart}`;
}

let historyGuardInstalled = false;

/**
 * Next App Router sometimes `replaceState("/company")` without `basePath`, so the
 * address bar drops `/app` (then a refresh hits marketing `/company`). Patch History
 * so in-app routes always keep `/app`.
 */
export function installWebAppBasePathHistoryGuard(): void {
  if (historyGuardInstalled || typeof window === "undefined") return;
  if (!webAppBasePath()) return;
  historyGuardInstalled = true;
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (data, unused, url) {
    return push(data, unused, coerceHistoryUrl(url) as string);
  };
  window.history.replaceState = function (data, unused, url) {
    return replace(data, unused, coerceHistoryUrl(url) as string);
  };
  window.addEventListener("popstate", () => {
    repairAppUiPathInBrowser();
  });
}

/**
 * Restore `/app` on the address bar when basePath is active but History API dropped it.
 * Next `router.push` already prefixes basePath; raw `replaceState` does not.
 */
export function repairAppUiPathInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (!isAppUiPathMissingBasePrefix()) return false;
  const fixed = browserHistoryHref(
    `${window.location.pathname || "/"}${window.location.search || ""}${window.location.hash || ""}`
  );
  if (fixed === window.location.pathname + window.location.search + window.location.hash) return false;
  window.history.replaceState(window.history.state, "", fixed);
  return true;
}
