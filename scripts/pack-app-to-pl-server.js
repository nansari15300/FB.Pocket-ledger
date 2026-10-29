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

rmDir(destDir);
copyDir(outDir, destDir);
const marker = {
  v: 1,
  packedAt: new Date().toISOString(),
  base: "/app",
};
fs.writeFileSync(path.join(destDir, "pl-server-pack.json"), JSON.stringify(marker));
console.log("[pack:pl-server] Copied company UI →", destDir);
console.log("[pack:pl-server] My Company: http://<server>/app/company/");
