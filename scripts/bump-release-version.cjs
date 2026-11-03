/**
 * Bump patch version across EXE, APK, and in-app release check.
 *
 *   node scripts/bump-release-version.cjs
 *   node scripts/bump-release-version.cjs --set 1.2.0
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content, "utf8");
}

function bumpPatch(version) {
  const parts = String(version || "1.0.0")
    .trim()
    .split(".")
    .map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.slice(0, 3).join(".");
}

function parseSetArg() {
  const idx = process.argv.indexOf("--set");
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return null;
}

function updateReleaseVersionTs(next) {
  const file = "src/config/releaseVersion.ts";
  let src = read(file);
  src = src.replace(/export const DESKTOP_APP_VERSION = "[^"]+";/, `export const DESKTOP_APP_VERSION = "${next}";`);
  src = src.replace(/export const ANDROID_APP_VERSION = "[^"]+";/, `export const ANDROID_APP_VERSION = "${next}";`);
  write(file, src);
}

function updateElectronPackage(next) {
  const file = "electron/package.json";
  if (!fs.existsSync(path.join(root, file))) {
    console.log("[bump-release-version] skip electron/package.json (folder removed)");
    return;
  }
  const pkg = JSON.parse(read(file));
  pkg.version = next;
  write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function updateTauriVersion(next) {
  const cargo = "src-tauri/Cargo.toml";
  if (!fs.existsSync(path.join(root, cargo))) return;
  write(cargo, read(cargo).replace(/^version = "[^"]+"/m, `version = "${next}"`));
  const conf = "src-tauri/tauri.conf.json";
  const json = JSON.parse(read(conf));
  json.version = next;
  write(conf, `${JSON.stringify(json, null, 2)}\n`);
}

function updateAndroidGradle(next) {
  const file = "android/app/build.gradle";
  let src = read(file);
  const codeMatch = src.match(/versionCode\s+(\d+)/);
  const nextCode = codeMatch ? Number(codeMatch[1]) + 1 : 1;
  src = src.replace(/versionCode\s+\d+/, `versionCode ${nextCode}`);
  src = src.replace(/versionName\s+"[^"]+"/, `versionName "${next}"`);
  write(file, src);
}

function currentVersion() {
  const m = read("src/config/releaseVersion.ts").match(/DESKTOP_APP_VERSION = "([^"]+)"/);
  return m ? m[1] : "1.0.0";
}

const forced = parseSetArg();
const prev = currentVersion();
const next = forced || bumpPatch(prev);

updateReleaseVersionTs(next);
updateElectronPackage(next);
updateAndroidGradle(next);
updateTauriVersion(next);

console.log(`[bump-release-version] ${prev} -> ${next}`);
console.log("[bump-release-version] Updated:");
console.log("  - src/config/releaseVersion.ts");
console.log("  - android/app/build.gradle");
console.log("  - src-tauri/Cargo.toml");
console.log("  - src-tauri/tauri.conf.json");
