/**
 * Temporary local server for `out/` (static export) — EXE ke bina browser me test.
 * Usage: npm run serve:out   (pehle npm run build:static)
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const handler = require("serve-handler");
/** serve-handler headers for static `out/` - *.mjs MIME for pdf.js worker (pehle electron/packagedStaticHeaders.cjs me tha). */
function packagedStaticServeHeaders(_isPackaged) {
  return [
    {
      source: "**/*.mjs",
      headers: [{ key: "Content-Type", value: "text/javascript; charset=utf-8" }],
    },
  ];
}

const root = path.join(__dirname, "..");
const outDir = path.join(root, "out");
const DEFAULT_PORT = 3000;
const FALLBACK_PORTS = [37123, 38123, 39123];

function readDevWebPort() {
  const fromEnv = Number(process.env.PL_DEV_WEB_PORT || process.env.PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const f = path.join(root, ".pl-dev-web-port.json");
    const n = Number(JSON.parse(fs.readFileSync(f, "utf8")).port);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_) {}
  return DEFAULT_PORT;
}

function rewriteReconciliationDocumentUrl(requestUrl) {
  const pathname = (requestUrl.pathname || "/").replace(/\/+$/, "") || "/";
  if (pathname.includes("/_next/") || /\.[a-z0-9]+$/i.test(pathname)) return null;
  if (pathname === "/reconciliation") {
    return `/reconciliation/index.html${requestUrl.search || ""}`;
  }
  const legacy = pathname.match(/^\/reconciliation\/([^/]+)$/);
  if (legacy && legacy[1] !== "__placeholder__") {
    return `/reconciliation/index.html${requestUrl.search || ""}`;
  }
  return null;
}

function isAllowedFirebaseProxyTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes("firebasestorage.googleapis.com") ||
      host.includes("firebasestorage.app") ||
      host.includes("storage.googleapis.com")
    );
  } catch {
    return false;
  }
}

function createRequestHandler() {
  return async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://localhost");
      if (requestUrl.pathname === "/__firebase_blob_proxy") {
        const target = requestUrl.searchParams.get("url") || "";
        if (!isAllowedFirebaseProxyTarget(target)) {
          response.statusCode = 400;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end("Invalid target URL");
          return;
        }
        const upstream = await fetch(target, { method: "GET" });
        if (!upstream.ok) {
          response.statusCode = upstream.status;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end(`Upstream error: ${upstream.status}`);
          return;
        }
        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        response.statusCode = 200;
        response.setHeader("content-type", contentType);
        response.setHeader("cache-control", "private, max-age=60");
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      const rewritten = rewriteReconciliationDocumentUrl(requestUrl);
      if (rewritten) {
        request = Object.assign({}, request, { url: rewritten });
      }
    } catch {
      /* fall through */
    }

    return handler(request, response, {
      public: outDir,
      cleanUrls: true,
      headers: packagedStaticServeHeaders(false),
    });
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(port));
  });
}

async function main() {
  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    console.error("[serve:out] out/index.html missing — pehle chalao: npm run build:static");
    process.exit(1);
  }

  const host = "127.0.0.1";
  const candidates = [readDevWebPort(), ...FALLBACK_PORTS.filter((p) => p !== readDevWebPort())];
  const server = http.createServer(createRequestHandler());

  for (const port of candidates) {
    try {
      await listen(server, port, host);
      console.log(`[serve:out] Static app: http://${host}:${port}/`);
      console.log("[serve:out] Ctrl+C se band karo. (EXE jaisa localhost — browser me poori web app)");
      return;
    } catch (err) {
      if (err && err.code === "EADDRINUSE") continue;
      throw err;
    }
  }
  console.error("[serve:out] Sab ports busy — npm run dev band karke dubara try karo.");
  process.exit(1);
}

main().catch((err) => {
  console.error("[serve:out]", err?.message || err);
  process.exit(1);
});
