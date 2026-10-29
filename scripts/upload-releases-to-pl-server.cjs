/**
 * Copy staged EXE + APK + latest.json onto this PC's Pocket Ledger Server
 * so they are served from the live country origin (np.pocket-ledger.com).
 *
 *   npm run release:upload:np
 *   PL_RELEASES_ORIGIN=https://np.pocket-ledger.com npm run release:upload:np
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const localReleases = path.join(root, "releases");
const pbPublic = process.env.PL_SERVER_PB_PUBLIC
  ? String(process.env.PL_SERVER_PB_PUBLIC)
  : path.join("C:", "Balgram", "PocketLedger-Server", "sub-server", "pb_public");
const destRoot = path.join(pbPublic, "releases");
const origin = String(process.env.PL_RELEASES_ORIGIN || "https://np.pocket-ledger.com")
  .trim()
  .replace(/\/+$/, "");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function publicFileUrl(date, fileName) {
  return `${origin}/releases/${date}/${encodeURIComponent(fileName)}`;
}

function absolutizeEntry(entry, date) {
  if (!entry || typeof entry !== "object") return entry;
  const file = String(entry.file || "").trim();
  if (!file) return entry;
  return { ...entry, url: publicFileUrl(date, file), origin };
}

function absolutizeManifest(manifest) {
  const date = String(manifest.date || "").trim();
  const next = { ...manifest, origin };
  if (date) {
    next.windows = absolutizeEntry(manifest.windows, date);
    next.android = absolutizeEntry(manifest.android, date);
  }
  if (Array.isArray(manifest.history)) {
    next.history = manifest.history.map((row) => {
      const rowDate = String(row?.date || date).trim();
      return {
        ...row,
        windows: absolutizeEntry(row.windows, rowDate),
        android: absolutizeEntry(row.android, rowDate),
      };
    });
  }
  if (Array.isArray(manifest.outdated)) {
    next.outdated = manifest.outdated.map((row) => {
      const rowDate = String(row?.date || date).trim();
      return {
        ...row,
        windows: absolutizeEntry(row.windows, rowDate),
        android: absolutizeEntry(row.android, rowDate),
      };
    });
  }
  return next;
}

if (!fs.existsSync(pbPublic)) {
  console.error("[upload:np] pb_public not found:", pbPublic);
  process.exit(1);
}

const latestPath = path.join(localReleases, "latest.json");
if (!fs.existsSync(latestPath)) {
  console.error("[upload:np] Missing", latestPath, "— run website:stage-releases first.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
} catch (err) {
  console.error("[upload:np] latest.json parse failed:", err.message || err);
  process.exit(1);
}

const date = String(manifest.date || "").trim();
if (!date) {
  console.error("[upload:np] latest.json has no date");
  process.exit(1);
}

const localDateDir = path.join(localReleases, date);
if (!fs.existsSync(localDateDir)) {
  console.error("[upload:np] Missing staged folder:", localDateDir);
  process.exit(1);
}

fs.mkdirSync(destRoot, { recursive: true });
copyDir(localDateDir, path.join(destRoot, date));

const publicManifest = absolutizeManifest(manifest);
const publicLatest = `${JSON.stringify(publicManifest, null, 2)}\n`;
fs.writeFileSync(latestPath, publicLatest);
fs.writeFileSync(path.join(destRoot, "latest.json"), publicLatest);

console.log("[upload:np] origin  →", origin);
console.log("[upload:np] files   →", path.join(destRoot, date));
console.log("[upload:np] latest  →", `${origin}/releases/latest.json`);
if (publicManifest.windows?.url) console.log("[upload:np] EXE     →", publicManifest.windows.url);
if (publicManifest.android?.url) console.log("[upload:np] APK     →", publicManifest.android.url);
