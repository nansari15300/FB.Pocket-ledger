import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import withSerwistInit from "@serwist/next";

const isStaticBuild = process.env.STATIC_BUILD === "1";
const isPlServerPack = process.env.PL_SERVER_PACK === "1";
const isDevBuild = process.env.NODE_ENV !== "production";
/**
 * Hosted web + local gateway: `WEB_APP_BASE_PATH=/app` → …/app/dashboard …
 * - `npm run dev` (gateway) sets this automatically.
 * - App Hosting: production non-static always `/app` (website at `/` via Firebase Hosting).
 *   Console env overrides that clear the yaml value must not drop the app back to `/`.
 * EXE/APK static export must stay at `/` (never set with STATIC_BUILD=1).
 * Pocket Ledger Server pack (`PL_SERVER_PACK=1`): static export under `/app` so PocketBase
 * can serve panel `/` + company UI `/app` from one process.
 * Opt out only with `WEB_APP_BASE_PATH=0`.
 */
const rawWebAppBasePath = String(process.env.WEB_APP_BASE_PATH || "").trim();
const webAppBasePath = (() => {
  if (isPlServerPack) return "/app";
  if (isStaticBuild || rawWebAppBasePath === "0") return undefined;
  if (rawWebAppBasePath === "/app") return "/app";
  if (!isDevBuild) return "/app";
  return undefined;
})();

/** `/~offline` precache busting — git nahi ho to UUID (Firebase CI safe). */
function serwistOfflineRevision(): string {
  try {
    const out = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" });
    if (out.status === 0 && out.stdout?.trim()) return out.stdout.trim();
  } catch {
    /* noop */
  }
  return randomUUID();
}

/** Turbopack: `path.join(__dirname, …)` → `D:\...` absolute — Windows pe "imports are not implemented"; sirf `./` relative */
const CANVAS_BROWSER_STUB = "./src/stubs/empty-canvas.ts";
const DELETE_COMPANY_STATIC_STUB = "./src/lib/actions/deleteCompanyActionStub.ts";

const baseConfig: NextConfig = {
  // Next.js 16: dev + prod default Turbopack; purana `webpack()` hata kar `turbopack.resolveAlias` — mix par "misconfiguration" fail
  // Dev me React 18 Strict Mode effect 2× run karta hai — kuch navigation side-effects zyada dikhte hain.
  reactStrictMode: false,
  // Dev only: phone / port-forwarded access to the :3000 gateway (LAN + public IP).
  ...(isDevBuild ? { allowedDevOrigins: ["192.168.1.64", "110.34.23.84"] } : {}),
  ...(webAppBasePath ? { basePath: webAppBasePath } : {}),
  env: {
    NEXT_PUBLIC_WEB_APP_BASE_PATH: webAppBasePath || "",
    NEXT_PUBLIC_PL_SERVER_PACK: isPlServerPack ? "1" : "",
  },
  serverExternalPackages: ["googleapis", "google-auth-library"],
  // Pdf.js Turbopack me seedha bundle; SWC transpile se nested bundle clash kam
  transpilePackages: ["pdfjs-dist"],
  // EXE/APK static export: build-time tsc/eslint skip — alag `npm run typecheck` chalao
  ...(isStaticBuild && {
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
  }),
  // Static export only when building for APK (npm run build:static)
  ...(isStaticBuild && { output: "export" }),
  // Electron now serves static export over localhost HTTP, so keep default root asset paths (/_next/*).
  // Relative assetPrefix ("./") breaks nested routes like /dashboard by turning assets into /dashboard/_next/*.
  // APK / http-server: /party/index.html so refresh & deep links 404 kam (trailing slash URLs)
  ...(isStaticBuild && { trailingSlash: true }),
  /** Webpack-only escape: `npm run build:turbo` — Firebase/App Hosting par `--webpack` zaroori (native SWC + Turbopack WASM fail). */
  turbopack: {
    resolveAlias: {
      // Browser: pdf.js optional Node canvas — `alias.canvas = false` ka Turbopack equivalent
      canvas: {
        browser: CANVAS_BROWSER_STUB,
      },
      ...(isStaticBuild && {
        "@/lib/actions/deleteCompanyAction": DELETE_COMPANY_STATIC_STUB,
      }),
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve ??= {};
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: CANVAS_BROWSER_STUB,
        ...(isStaticBuild && {
          "@/lib/actions/deleteCompanyAction": DELETE_COMPANY_STATIC_STUB,
        }),
      };
    }
    // Dev PL userdata writes under `.data/` must not invalidate the bundle watcher.
    // Firebase App Hosting merge kabhi `ignored: [""]` / non-string inject karta hai — webpack schema fail.
    const toIgnoredStrings = (raw: unknown): string[] => {
      if (typeof raw === "string" && raw.trim()) return [raw.trim()];
      if (!Array.isArray(raw)) return [];
      return raw
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v): v is string => v.length > 0);
    };
    const extraIgnored = ["**/.data/**", "**/.codex-dev-server*.log"];
    const mergedIgnored = [
      ...toIgnoredStrings(config.watchOptions?.ignored),
      ...extraIgnored,
    ];
    const uniqueIgnored = Array.from(new Set(mergedIgnored));
    config.watchOptions = {
      ...config.watchOptions,
      ignored:
        uniqueIgnored.length > 0
          ? uniqueIgnored
          : ["**/node_modules/**", "**/.git/**", "**/.next/**", ...extraIgnored],
    };
    return config;
  },
};

// Hosted/static PWA: Serwist web deploy ke liye. EXE/APK static export par band — har route precache = 10+ min build.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: isDevBuild || isStaticBuild,
  additionalPrecacheEntries: [
    { url: `${webAppBasePath || ""}/~offline`, revision: serwistOfflineRevision() },
    ...(isStaticBuild ? [{ url: "/~offline/", revision: serwistOfflineRevision() }] : []),
  ],
});

export default withSerwist(baseConfig);
