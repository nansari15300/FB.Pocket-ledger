/**
 * Bump version, build EXE + AAB from existing/out fresh static, stage + upload to Firebase.
 *
 *   node scripts/release-publish.cjs
 *   node scripts/release-publish.cjs --skip-static   # reuse current out/
 *   node scripts/release-publish.cjs --skip-upload   # local builds only
 */
const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  fetchReleaseSettings,
  fetchReleaseSettingsRaw,
  writeLocalReleaseSettings,
  buildReleaseRotation,
} = require("./release-settings.cjs");
const { pickStagedReleaseApk } = require("./pickStagedReleaseApk.cjs");

const root = path.join(__dirname, "..");

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status ?? "unknown"})`);
  }
}

function gsutilBin() {
  if (process.platform === "win32") {
    const win = "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gsutil.cmd";
    if (fs.existsSync(win)) return win;
    return "gsutil.cmd";
  }
  return "gsutil";
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function gsutil(args) {
  const cmd = gsutilBin();
  const line = [shellQuote(cmd), ...args.map(shellQuote)].join(" ");
  execSync(line, { stdio: "inherit", windowsHide: true });
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function publicUrl(bucket, objectPath) {
  return (
    "https://firebasestorage.googleapis.com/v0/b/" +
    bucket +
    "/o/" +
    encodeURIComponent(objectPath) +
    "?alt=media"
  );
}

function bytesLabel(n) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadAndroidArtifact(localDir, date, prefix, gsUri, bucket, fileName, androidVersion) {
  const local = path.join(localDir, fileName);
  const objectPath = `${prefix}/android/${date}/${fileName}`;
  const isAab = fileName.toLowerCase().endsWith(".aab");
  gsutil([
    "-h",
    isAab ? "Content-Type:application/octet-stream" : "Content-Type:application/vnd.android.package-archive",
    "cp",
    local,
    `${gsUri}/${objectPath}`,
  ]);
  const st = fs.statSync(local);
  return {
    file: fileName,
    url: publicUrl(bucket, objectPath),
    path: objectPath,
    version: androidVersion,
    format: isAab ? "aab" : "apk",
    bytes: st.size,
    sizeLabel: bytesLabel(st.size),
  };
}

function deleteStorageEntry(gsUri, entry) {
  if (!entry) return;
  for (const item of [entry.windows, entry.android]) {
    if (!item?.path) continue;
    try {
      gsutil(["rm", "-f", `${gsUri}/${item.path}`]);
    } catch (_) {
      /* already gone */
    }
  }
}

async function uploadStagedRelease(date) {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || "studio-5452513410-a3f5b.firebasestorage.app";
  const prefix = "public-releases";
  const gsUri = `gs://${bucket}`;
  const localDir = path.join(root, "releases", date);
  if (!fs.existsSync(localDir)) throw new Error(`Missing staged folder: ${localDir}`);

  const files = fs.readdirSync(localDir);
  const windowsVersion =
    process.env.WINDOWS_RELEASE_VERSION ||
    (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
      } catch {
        return "1.0.0";
      }
    })();
  const androidVersion =
    process.env.ANDROID_RELEASE_VERSION ||
    (() => {
      try {
        const ts = fs.readFileSync(path.join(root, "src/config/releaseVersion.ts"), "utf8");
        const m = ts.match(/ANDROID_APP_VERSION = "([^"]+)"/);
        if (m) return m[1];
      } catch {
        /* ignore */
      }
      return windowsVersion;
    })();
  const exeName =
    files.find((n) => n.toLowerCase().endsWith(".exe") && n.includes(` ${windowsVersion}.exe`)) ||
    files.find((n) => n.toLowerCase().endsWith(".exe"));
  const apkName = pickStagedReleaseApk(localDir, androidVersion);
  if (!exeName && !apkName) throw new Error(`No EXE/APK in ${localDir}`);
  if (apkName) {
    console.log("[release-publish] APK pick →", apkName, `(manifest android ${androidVersion})`);
  }

  let prev = null;
  try {
    const https = require("https");
    prev = await new Promise((resolve) => {
      https
        .get(publicUrl(bucket, `${prefix}/latest.json`), (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            if (res.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        })
        .on("error", () => resolve(null));
    });
  } catch {
    prev = null;
  }

  const settings = await fetchReleaseSettings(bucket);
  const settingsRemote = await fetchReleaseSettingsRaw(bucket, prefix);
  if (!settingsRemote.raw) {
    const settingsLocal = writeLocalReleaseSettings(root, settings);
    console.log("[release-publish] Repairing invalid release-settings.json on Firebase Storage");
    gsutil([
      "-h",
      "Content-Type:application/json",
      "-h",
      "Cache-Control:public,max-age=60",
      "cp",
      settingsLocal,
      `${gsUri}/${prefix}/release-settings.json`,
    ]);
  }

  const latest = { date, stagedAt: new Date().toISOString(), windows: null, android: null };

  if (exeName) {
    const local = path.join(localDir, exeName);
    const objectPath = `${prefix}/windows/${date}/${exeName}`;
    gsutil(["-h", "Content-Type:application/x-msdownload", "cp", local, `${gsUri}/${objectPath}`]);
    const st = fs.statSync(local);
    latest.windows = {
      file: exeName,
      url: publicUrl(bucket, objectPath),
      path: objectPath,
      version: windowsVersion,
      bytes: st.size,
      sizeLabel: bytesLabel(st.size),
    };
  }

  if (apkName) {
    latest.android = uploadAndroidArtifact(localDir, date, prefix, gsUri, bucket, apkName, androidVersion);
  }

  if (prev?.android?.playStoreUrl) {
    latest.android = latest.android || {};
    latest.android.playStoreUrl = prev.android.playStoreUrl;
  }
  if (prev?.playStoreUrl) {
    latest.playStoreUrl = prev.playStoreUrl;
  }

  const rotation = buildReleaseRotation(prev, latest, settings);
  latest.history = rotation.history;
  latest.outdated = rotation.outdated;

  for (const entry of rotation.deleteEntries || []) {
    console.log("[release-publish] Auto-delete outdated →", entry.date || "unknown");
    deleteStorageEntry(gsUri, entry);
  }

  const manifestLocal = path.join(root, "releases", "latest-firebase.json");
  fs.writeFileSync(manifestLocal, `${JSON.stringify(latest, null, 2)}\n`);
  gsutil([
    "-h",
    "Content-Type:application/json",
    "-h",
    "Cache-Control:public,max-age=60",
    "cp",
    manifestLocal,
    `${gsUri}/${prefix}/latest.json`,
  ]);
  console.log("[release-publish] Firebase latest.json uploaded.");
}

async function main() {
  if (process.argv.includes("--upload-only")) {
    await uploadStagedRelease(process.env.RELEASE_DATE || todayStamp());
    console.log("\n[release-publish] Upload only done.");
    return;
  }

  const skipStatic = process.argv.includes("--skip-static");
  const skipUpload = process.argv.includes("--skip-upload");
  const noBump = process.argv.includes("--no-bump");
  const useTauri =
    process.argv.includes("--tauri") ||
    process.env.RELEASE_TAURI === "1" ||
    !fs.existsSync(path.join(root, "electron", "package.json"));

  if (!noBump) {
    run("node", ["scripts/bump-release-version.cjs"]);
  } else {
    console.log("[release-publish] Skipping version bump (--no-bump).");
  }

  if (useTauri) {
    console.log("[release-publish] Windows EXE = Tauri NSIS (Electron EXE skip).");
    process.env.RELEASE_TAURI = "1";
    if (skipStatic) {
      if (!fs.existsSync(path.join(root, "out", "index.html"))) {
        throw new Error("out/ missing — run without --skip-static or build static first.");
      }
      run("npm", ["run", "sidecar:build"]);
      run("cargo", ["tauri", "build", "--config", "tauri.release.conf.json"], {
        cwd: path.join(root, "src-tauri"),
      });
    } else {
      run("npm", ["run", "tauri:build"]);
    }
  } else if (skipStatic) {
    if (!fs.existsSync(path.join(root, "out", "index.html"))) {
      throw new Error("out/ missing — run without --skip-static or build static first.");
    }
    run("npm", ["run", "electron:build:win:fast"]);
  } else {
    run("npm", ["run", "build:exe:fast"]);
  }
  run("npm", ["run", "cap:copy:android"]);
  // RELEASE_SKIP_AAB=1: fast mode - APK only (AAB is local Play Console artifact, never uploaded).
  const gradleTasks = process.env.RELEASE_SKIP_AAB === "1" ? ["assembleRelease"] : ["assembleRelease", "bundleRelease"];
  run("gradlew.bat", gradleTasks, { cwd: path.join(root, "android") });
  run("npm", ["run", "website:stage-releases"]);

  if (!skipUpload) {
    await uploadStagedRelease(process.env.RELEASE_DATE || todayStamp());
    run("npm", ["run", "website:build"]);
    run("npx", [
      "--yes",
      "firebase-tools",
      "deploy",
      "--only",
      "hosting",
      "--project",
      "studio-5452513410-a3f5b",
    ]);
  }

  console.log("\n[release-publish] Done.");
}

main().catch((err) => {
  console.error("[release-publish]", err.message || err);
  process.exit(1);
});
