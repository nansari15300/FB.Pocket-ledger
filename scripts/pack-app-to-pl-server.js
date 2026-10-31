/**
 * Web-build the company app and copy it into Pocket Ledger Server
 * `sub-server/pb_public/app` so one PocketBase process serves panel + My Company.
 *
 * Usage (from Online Project): `npm run pack:pl-server`
 * Uses `build-static.js --fast` + `PL_SERVER_PACK=1` (basePath `/app`).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "out");
const pbPublic = process.env.PL_SERVER_PB_PUBLIC
  ? String(process.env.PL_SERVER_PB_PUBLIC)
  : path.join("C:", "Balgram", "PocketLedger-Server", "sub-server", "pb_public");
const destDir = path.join(pbPublic, "app");

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(pbPublic)) {
  console.error("[pack:pl-server] pb_public not found:", pbPublic);
  process.exit(1);
}

const build = spawnSync(process.execPath, [path.join(root, "scripts", "build-static.js"), "--fast"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PL_SERVER_PACK: "1",
    STATIC_BUILD: "1",
    NEXT_PUBLIC_STATIC_BUILD: "1",
    NEXT_PUBLIC_PL_SERVER_PACK: "1",
    WEB_APP_BASE_PATH: "/app",
  },
});
if (build.status !== 0) {
  process.exit(build.status || 1);
}

if (!fs.existsSync(path.join(outDir, "index.html"))) {
  console.error("[pack:pl-server] out/index.html missing after static build");
  process.exit(1);
}

// Hosting page (pb_hooks/web_deploys): every deploy is also saved in <sub-server>/hosting_deploys/<id>/{app,meta.json}
// so it can be rolled back from the admin panel. Failures here never fail the pack.
const hostingDir = process.env.PL_SERVER_HOSTING_DEPLOYS
  ? String(process.env.PL_SERVER_HOSTING_DEPLOYS)
  : path.join(pbPublic, "..", "hosting_deploys");

function deployId(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = d.toISOString().replace(/[-:]/g, ""); // 20261030T080112.009Z
  return s.slice(0, 8) + "-" + s.slice(9, 15);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return null;
  }
}

// release version = DESKTOP_APP_VERSION (src/config/releaseVersion.ts, bumped by release:bump); package.json is the fallback
function packVersions() {
  const pkg = readJsonSafe(path.join(root, "package.json")) || {};
  let release = "";
  try {
    const m = fs.readFileSync(path.join(root, "src", "config", "releaseVersion.ts"), "utf8").match(/DESKTOP_APP_VERSION\s*=\s*"([^"]+)"/);
    if (m) release = m[1];
  } catch (_) { /* fall back to package.json */ }
  const packageVersion = typeof pkg.version === "string" ? pkg.version : "";
  return { version: release || packageVersion, packageVersion };
}

function copyDirStats(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  let size = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) {
      const r = copyDirStats(s, d);
      files += r.files;
      size += r.size;
    } else {
      fs.copyFileSync(s, d);
      files += 1;
      size += fs.statSync(s).size;
    }
  }
  return { files, size };
}

function saveDeploy(appDir, meta) {
  const id = deployId(meta.packedAt);
  if (!id) return "";
  const finalDir = path.join(hostingDir, id);
  if (fs.existsSync(finalDir)) return id; // already saved
  const tmpDir = finalDir + ".tmp";
  rmDir(tmpDir);
  try {
    const r = copyDirStats(appDir, path.join(tmpDir, "app"));
    const full = { id, ...meta, savedAt: new Date().toISOString(), size: r.size, files: r.files };
    fs.writeFileSync(path.join(tmpDir, "meta.json"), JSON.stringify(full, null, 2));
    fs.renameSync(tmpDir, finalDir);
  } catch (err) {
    rmDir(tmpDir);
    throw err;
  }
  return id;
}

// the app that is live right now is saved first (if the history does not have it yet)
try {
  const prev = readJsonSafe(path.join(destDir, "pl-server-pack.json"));
  if (prev && typeof prev.packedAt === "string" && fs.existsSync(path.join(destDir, "index.html"))) {
    saveDeploy(destDir, {
      version: typeof prev.version === "string" ? prev.version : "",
      packageVersion: "",
      packedAt: prev.packedAt,
      source: "pre-pack",
    });
  }
} catch (err) {
  console.warn("[pack:pl-server] could not save the previous live app in the history:", err && err.message ? err.message : err);
}

rmDir(destDir);
copyDir(outDir, destDir);
const packedAt = new Date().toISOString();
const versions = packVersions();
const marker = {
  v: 1,
  packedAt,
  base: "/app",
  version: versions.version,
};
fs.writeFileSync(path.join(destDir, "pl-server-pack.json"), JSON.stringify(marker));
try {
  const savedId = saveDeploy(destDir, { version: versions.version, packageVersion: versions.packageVersion, packedAt, source: "pack" });
  console.log("[pack:pl-server] Saved in deploy history:", savedId, "version", versions.version || "-");
} catch (err) {
  console.warn("[pack:pl-server] could not save this deploy in the history:", err && err.message ? err.message : err);
}
console.log("[pack:pl-server] Copied company UI →", destDir);
console.log("[pack:pl-server] My Company: http://<server>/app/company/");
