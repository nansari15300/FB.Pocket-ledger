/**
 * Tauri/Electron desktop `out/` must be the `/` export, not the PocketBase `/app` pack.
 * pack:pl-server sets PL_SERVER_PACK=1 and rewrites asset hrefs to /app/_next — that
 * paints a white window when sidecar serves http://localhost:3000/.
 */
const fs = require("fs");
const path = require("path");

const index = path.join(__dirname, "..", "out", "index.html");
if (!fs.existsSync(index)) {
  console.error("[assert-desktop-out] missing out/index.html — run npm run build:static");
  process.exit(1);
}
const html = fs.readFileSync(index, "utf8");
if (html.includes("/app/_next/") || html.includes('href="/app/')) {
  console.error("[assert-desktop-out] out/ is a PocketBase /app pack. Rebuild with:");
  console.error("  npm run build:static");
  console.error("Do not use pack:pl-server output for Tauri.");
  process.exit(1);
}
if (!html.includes("_next/static")) {
  console.error("[assert-desktop-out] out/index.html has no _next/static assets");
  process.exit(1);
}
console.log("[assert-desktop-out] ok — desktop / export");
