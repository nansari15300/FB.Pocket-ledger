#!/usr/bin/env node
/**
 * Dev gateway on :3000
 *   /           → marketing website/ (source files, live edit)
 *   /app/**     → Next.js (WEB_APP_BASE_PATH=/app) on internal port
 *
 * Deploy: pocket-ledger.com/ + /app via Hosting + App Hosting (same URL shape).
 */
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = process.cwd();
const websiteRoot = path.join(projectRoot, "website");
const releasesRoot = path.join(projectRoot, "releases");
const publicPort = String(process.env.PORT || "3000");
const nextPort = String(process.env.NEXT_INTERNAL_PORT || "3001");

function listLanIPv4Addresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name] || []) {
      const fam = netInfo.family;
      const isV4 = fam === "IPv4" || fam === 4;
      if (isV4 && !netInfo.internal) out.push(netInfo.address);
    }
  }
  return out;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".exe": "application/octet-stream",
  ".apk": "application/vnd.android.package-archive",
  ".aab": "application/octet-stream",
  ".wasm": "application/wasm",
};

/** Old absolute `/file` requests when the app lives under `/app` basePath. */
const ROOT_APP_PUBLIC_ASSETS = new Set([
  "/sql-wasm.wasm",
  "/pdf.worker.min.mjs",
  "/app-icon.png",
  "/adjust-balance-point.png",
  "/sw.js",
  "/manifest.webmanifest",
]);

function isAppPath(urlPath) {
  return urlPath === "/app" || urlPath.startsWith("/app/");
}

/**
 * App routes that sometimes lose `/app` via history.replaceState (Next basePath
 * is not applied by the History API). Redirect so refresh does not hit marketing 404.
 * Skip marketing paths that also exist at site root (`/`, `/downloads`, `/company`, …).
 */
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
]);

function missingAppPrefixRedirect(reqUrl) {
  const raw = reqUrl || "/";
  const pathOnly = raw.split("?")[0] || "/";
  if (isAppPath(pathOnly)) return null;
  if (pathOnly === "/" || pathOnly === "") return null;

  // App company picker is `/app/company`. Bare `/company` is also rewritten in
  // this gateway so a Next `router.push("/company")` that dropped `/app` still
  // loads the live app (not website/company marketing HTML / a stale SPA).
  if (
    pathOnly === "/company" ||
    pathOnly === "/company/" ||
    pathOnly === "/company/create" ||
    pathOnly.startsWith("/company/create/")
  ) {
    const qs = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
    return "/app" + pathOnly.replace(/\/$/, pathOnly === "/company/" ? "/" : "") + qs;
  }

  const first = pathOnly.split("/").filter(Boolean)[0];
  if (!first || !APP_ONLY_FIRST_SEGMENTS.has(first)) return null;
  const qs = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
  return "/app" + pathOnly + qs;
}

function rewriteRootAppAsset(reqUrl) {
  const pathOnly = (reqUrl || "/").split("?")[0] || "/";
  if (!ROOT_APP_PUBLIC_ASSETS.has(pathOnly)) return null;
  const qs = (reqUrl || "").includes("?") ? "?" + (reqUrl || "").split("?").slice(1).join("?") : "";
  return "/app" + pathOnly + qs;
}

function isReleasePath(urlPath) {
  return urlPath === "/releases" || urlPath.startsWith("/releases/");
}

function resolveReleaseFile(urlPath) {
  let rel = decodeURIComponent((urlPath.split("?")[0] || "/").replace(/^\/releases\/?/, ""));
  if (!rel || rel.endsWith("/")) return null;
  const rootAbs = path.resolve(releasesRoot);
  const full = path.resolve(releasesRoot, rel);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function serveRelease(req, res) {
  const urlPath = (req.url || "/").split("?")[0];
  const filePath = resolveReleaseFile(urlPath);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Release file not found. Run: npm run website:stage-releases");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  const st = fs.statSync(filePath);
  const headers = {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Content-Length": String(st.size),
  };
  if (ext === ".exe" || ext === ".apk" || ext === ".aab") {
    headers["Content-Disposition"] =
      "attachment; filename=\"" + name.replace(/"/g, "") + "\"; filename*=UTF-8''" + encodeURIComponent(name);
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function resolveWebsiteFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (rel === "/") rel = "/index.html";
  if (rel.endsWith("/")) rel = `${rel}index.html`;

  // Pretty folders: /downloads → downloads/index.html
  const candidate = path.join(websiteRoot, rel.replace(/^\//, ""));
  if (!candidate.startsWith(websiteRoot)) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  const asDirIndex = path.join(websiteRoot, rel.replace(/^\//, ""), "index.html");
  if (asDirIndex.startsWith(websiteRoot) && fs.existsSync(asDirIndex)) return asDirIndex;

  // /downloads → downloads/index.html when no trailing slash
  const noExt = path.join(websiteRoot, rel.replace(/^\//, ""), "index.html");
  if (!path.extname(rel) && fs.existsSync(noExt)) return noExt;

  return null;
}

function serveWebsite(req, res) {
  const urlPath = (req.url || "/").split("?")[0];
  const filePath = resolveWebsiteFile(urlPath);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
      <h1>404</h1>
      <p>Marketing page not found.</p>
      <p><a href="/">Home</a> · <a href="/app">Go to App</a></p>
      </body></html>`
    );
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function proxyHttp(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${nextPort}` };
  const opts = {
    hostname: "127.0.0.1",
    port: Number(nextPort),
    path: req.url,
    method: req.method,
    headers,
  };
  const upstream = http.request(opts, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`[dev-gateway] Next not ready on :${nextPort}\n${err.message}`);
  });
  req.pipe(upstream);
}

/**
 * /pb/** -> Pocket Ledger Server (PocketBase) on this PC, prefix stripped.
 * Lets phones / port-forwarded 3000 reach PocketBase without opening 8090.
 * Streams both ways (SSE /pb/api/realtime included): no buffering, no timeouts.
 */
const pbTarget = new URL(process.env.PL_PB_PROXY_TARGET || "http://127.0.0.1:8090");

function isPbPath(urlPath) {
  return urlPath === "/pb" || urlPath.startsWith("/pb/");
}

function proxyPocketBase(req, res) {
  const upstreamPath = (req.url || "/").replace(/^\/pb(?=\/|\?|$)/, "") || "/";
  const headers = { ...req.headers, host: pbTarget.host };
  const upstream = http.request(
    {
      hostname: pbTarget.hostname,
      port: Number(pbTarget.port || 80),
      path: upstreamPath.startsWith("/") ? upstreamPath : "/" + upstreamPath,
      method: req.method,
      headers,
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      pres.pipe(res);
    }
  );
  // long-lived SSE: never time out either side
  upstream.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`[dev-gateway] Pocket Ledger Server not reachable on ${pbTarget.host}\n${err.message}`);
  });
  res.on("close", () => {
    try {
      upstream.destroy();
    } catch {
      /* noop */
    }
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const headers = [
    `${req.method} ${req.url} HTTP/${req.httpVersion}`,
    ...Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`),
    "",
    "",
  ].join("\r\n");

  const upstream = net.connect(Number(nextPort), "127.0.0.1", () => {
    upstream.write(headers);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => {
    try {
      socket.destroy();
    } catch {
      /* noop */
    }
  });
  socket.on("error", () => {
    try {
      upstream.destroy();
    } catch {
      /* noop */
    }
  });
}

// --- Next on internal port ---
const devCacheDir = path.join(projectRoot, ".next", "dev");
try {
  if (process.env.DEV_CLEAR_NEXT_CACHE === "1") {
    fs.rmSync(devCacheDir, { recursive: true, force: true });
    console.log("[dev-gateway] Cleared .next/dev cache (DEV_CLEAR_NEXT_CACHE=1)");
  }
} catch (error) {
  console.warn("[dev-gateway] Cache cleanup skipped:", error?.message || error);
}

const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const nextArgs = [
  nextBin,
  "dev",
  "--turbopack",
  "--disable-source-maps",
  "--hostname",
  "127.0.0.1",
  "--port",
  nextPort,
];

const nextChild = spawn(process.execPath, nextArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: nextPort,
    WEB_APP_BASE_PATH: "/app",
    NEXT_PUBLIC_WEB_APP_BASE_PATH: "/app",
    PL_PROJECT_ROOT: projectRoot,
    NEXT_PUBLIC_PL_DEV_LOCAL_SERVER: "1",
    /** App absolute URL in browser (OAuth / absolute links that read this) */
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${publicPort}/app`,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${publicPort}/app`,
  },
});

nextChild.on("exit", (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
    return;
  }
  process.exit(code ?? 0);
});

const gateway = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0] || "/";
  if (isPbPath(urlPath)) {
    proxyPocketBase(req, res);
    return;
  }
  const appRedirect = missingAppPrefixRedirect(req.url || "/");
  if (appRedirect) {
    res.writeHead(302, { Location: appRedirect, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const rewritten = rewriteRootAppAsset(req.url || "/");
  if (rewritten) {
    req.url = rewritten;
    proxyHttp(req, res);
    return;
  }
  if (isAppPath(urlPath)) {
    proxyHttp(req, res);
    return;
  }
  if (isReleasePath(urlPath)) {
    serveRelease(req, res);
    return;
  }
  serveWebsite(req, res);
});

gateway.on("upgrade", (req, socket, head) => {
  const urlPath = (req.url || "/").split("?")[0] || "/";
  if (isAppPath(urlPath)) {
    proxyUpgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

gateway.listen(Number(publicPort), "0.0.0.0", () => {
  const lanIps = listLanIPv4Addresses();
  console.log(`[dev-gateway] Website  → http://localhost:${publicPort}/`);
  console.log(`[dev-gateway] App      → http://localhost:${publicPort}/app`);
  console.log(`[dev-gateway] Releases → http://localhost:${publicPort}/releases/`);
  console.log(`[dev-gateway] PB proxy → http://localhost:${publicPort}/pb → ${pbTarget.origin}`);
  console.log(`[dev-gateway] Next int → http://127.0.0.1:${nextPort}/app`);
  if (lanIps.length) {
    console.log("[dev-gateway] LAN:");
    for (const ip of lanIps) {
      console.log(`           http://${ip}:${publicPort}/  |  http://${ip}:${publicPort}/app`);
    }
  }
});

function shutdown() {
  try {
    nextChild.kill("SIGTERM");
  } catch {
    /* noop */
  }
  try {
    gateway.close();
  } catch {
    /* noop */
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
