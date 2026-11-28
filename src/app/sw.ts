/// <reference lib="webworker" />
/**
 * Serwist service worker: precache + `defaultCache` (Next RSC/static runtime).
 * Live site / PWA + Capacitor remote-URL WebView: pehli online visit ke baad shell offline available.
 * `STATIC_BUILD=1` export bhi SW bundle karta — `out/` HTTPS host ya Capacitor `webDir` PWA shells precache ho.
 *
 * **`defaultCache`** HTML/document ke liye `NetworkFirst` use karta — airplane mode Android WebView me navigate
 * pehle network try karke `fallbacks → /~offline` jaldi pakad leta hai.
 * **`StaleWhileRevalidate` + navigate** prepend: offline pe **cached shell** turant mile (fresh tab online flush).
 */
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, ExpirationPlugin, StaleWhileRevalidate, NetworkOnly, NetworkFirst } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Firebase / Google SDK hosts — SW se bypass (mat intercept karo).
 * NetworkOnly bhi respondWith(fetch) use karta hai — Firestore Listen/Write streaming (ca9) toot jati hai.
 */
function isFirebaseOrGoogleCloudSdkHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "firebasestorage.googleapis.com" ||
    h === "storage.googleapis.com" ||
    h.endsWith(".firebasestorage.app") ||
    h === "firestore.googleapis.com" ||
    h === "identitytoolkit.googleapis.com" ||
    h === "securetoken.googleapis.com" ||
    h === "firebaseinstallations.googleapis.com" ||
    h === "oauth2.googleapis.com" ||
    h === "play.googleapis.com" ||
    h === "www.googleapis.com" ||
    h.endsWith(".googleapis.com")
  );
}

// Static/APK: hosted billing/Drive/plan-sync API — cross-origin NetworkFirst se mat chipkao.
function isHostedPocketLedgerApiRequest(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  return (
    (h === "pocket-ledger.com" ||
      h.endsWith(".pocket-ledger.com") ||
      h === "pocketledger.com" ||
      h.endsWith(".pocketledger.com")) &&
    url.pathname.startsWith("/api/")
  );
}

/** In URLs par koi Serwist route match na ho — browser native fetch/stream chalao. */
function shouldBypassServiceWorkerRouting(url: URL): boolean {
  return isFirebaseOrGoogleCloudSdkHost(url.hostname) || isHostedPocketLedgerApiRequest(url);
}

// defaultCache ke har matcher par bypass guard — antima GET catch-all Firestore ko phir pakad leta tha.
function wrapRuntimeCachingRouteExcludingBypass<T extends (typeof defaultCache)[number]>(route: T): T {
  const originalMatcher = route.matcher;
  if (typeof originalMatcher === "function") {
    return {
      ...route,
      matcher: (options) => {
        if (shouldBypassServiceWorkerRouting(options.url)) return false;
        return originalMatcher(options);
      },
    };
  }
  return {
    ...route,
    matcher: (options) => {
      if (shouldBypassServiceWorkerRouting(options.url)) return false;
      return (originalMatcher as RegExp).test(options.url.href);
    },
  };
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // skipWaiting: true naya SW activate hote hi purane tab control le leta — APK/Capacitor me online aane par navigate/shell mismatch se restart feel aata tha.
  skipWaiting: false,
  // Reconnect/update par open clients turant claim karne se app refresh/restart feel de sakta hai; manual next navigation par takeover hone do.
  clientsClaim: false,
  // navigationPreload true kabhi-kabhi preload fail par offline navigate ~offline fallback de deta (Capacitor WebView).
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) =>
        Boolean(sameOrigin && url.pathname.endsWith("/pdf.worker.min.mjs")),
      handler: new NetworkOnly(),
    },
    {
      // Next.js App Router Flight / _rsc — defaultCache intercept se RSC txt 404; hamesha network
      matcher: ({ url, request, sameOrigin }) =>
        Boolean(
          sameOrigin &&
            (url.searchParams.has("_rsc") ||
              url.pathname.includes("__next.") ||
              String(request.headers.get("RSC") || "").trim() === "1")
        ),
      handler: new NetworkOnly(),
    },
    {
      // Deploy ke baad purana chunk SW cache se mat chalao — stale webpack runtime 404 ChunkLoadError.
      matcher: ({ url, sameOrigin }) =>
        Boolean(sameOrigin && url.pathname.includes("/_next/static/chunks/")),
      handler: new NetworkFirst({
        cacheName: "pl-next-chunks",
        networkTimeoutSeconds: 3, // hashed chunks: do not wait 10s on a slow network when a cached copy exists
        plugins: [
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    {
      matcher: ({ request, sameOrigin }) =>
        Boolean(sameOrigin && request.mode === "navigate"),
      handler: new StaleWhileRevalidate({
        cacheName: "pl-navigate-shell",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 7 * 24 * 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    ...defaultCache.map(wrapRuntimeCachingRouteExcludingBypass),
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
