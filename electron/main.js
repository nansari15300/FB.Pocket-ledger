const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  Tray,
  ipcMain,
  dialog,
  nativeImage,
  shell,
  session,
  powerMonitor,
  powerSaveBlocker,
} = require("electron");
const googleAuthExternal = require("./googleAuthExternal");
const path = require("path");
const fs = require("fs");
const os = require("os");
const localAppServer = require("./localAppServer");
const plTraceLog = require("./plTraceLog");
const tabSnapshotRecovery = require("./tabSnapshotRecovery");
const appUpgradeCache = require("./appUpgradeCache");
const desktopReleaseUpdate = require("./desktopReleaseUpdate");
const { PL_MIRROR_PROTOCOL_VERSION, evaluateMirrorProtocol } = require("./plMirrorProtocol.cjs");

/** Har app launch par naya id — EXE multi-tab PIN unlock isi session me share (cold start par dubara PIN). */
let appBootSessionId = "";

function getAppBootSessionId() {
  if (!appBootSessionId) {
    try {
      appBootSessionId = require("crypto").randomUUID();
    } catch (_) {
      appBootSessionId = `boot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }
  return appBootSessionId;
}

/** Windows taskbar / Start menu grouping — `electron.app.*` default ID par Electron atom icon dikhta hai; `package.json` build.appId se match hona chahiye. */
const WINDOWS_APP_USER_MODEL_ID = "com.pocketledger.desktop";
if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}

/** Attachment JPEG compress: Canvas toBlob Chrome jaisa GPU path (software raster = 10–15× slow). `app.ready` se pehle. */
if (process.env.PL_GPU_FORCE === "1") {
  // Opt-in only: forcing blocklisted GPUs stalls old Intel HD graphics.
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-zero-copy");
}
app.commandLine.appendSwitch("enable-gpu-rasterization");
if (process.platform === "win32") {
  app.commandLine.appendSwitch("use-angle", "d3d11");
}

// Do EXE instances = do `localhost` ports = Firebase Auth / IndexedDB alag origin ("login delete") — doosra instance band + pehla focus.
const IS_PHASE1B_RUNTIME_VERIFY = process.env.PL_PHASE1B_RUNTIME_VERIFY === "1";
const IS_PLSERVER_COMPANY_AUDIT = process.env.PL_PLSERVER_COMPANY_AUDIT === "1";
// Runtime verify: parallel dev Electron allowed while packaged app open (verify uses isolated userData + port 3901).
const gotSingleInstanceLock = IS_PHASE1B_RUNTIME_VERIFY || IS_PLSERVER_COMPANY_AUDIT ? true : app.requestSingleInstanceLock();
const phase1bVerifyStats = {
  bridgeIpc: 0,
  broadcast: 0,
  mirrorPushBroadcast: 0,
  hostPublish: 0,
  authoritativeHttp: 0,
};

if ((IS_PHASE1B_RUNTIME_VERIFY && process.env.PL_PHASE1B_VERIFY_USER_DATA) || (IS_PLSERVER_COMPANY_AUDIT && process.env.PL_PLSERVER_AUDIT_USER_DATA)) {
  app.setPath("userData", process.env.PL_PLSERVER_AUDIT_USER_DATA || process.env.PL_PHASE1B_VERIFY_USER_DATA);
}
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void focusOrOpenMainWindow();
  });
}

const windowTabs = new Map();
const PRINT_MODE_ACTUAL = "actual";
const PRINT_MODE_FIT_WIDTH = "fit-width";
const PRINT_MODE_FIT_PAGE = "fit-page";
/** Tab strip height (px) — merged title row (Win/Linux) ya classic macOS strip */
const TAB_STRIP_HEIGHT = 36;
/** Win/Linux: frameless window — "Pocket Ledger (N tabs)" + tabs + 10px + minimize/max/close ek hi row */
const USE_MERGED_TITLEBAR = process.platform === "win32" || process.platform === "linux";

// Same asset as Next public/app-icon.png; copied into asar root via electron/package.json files.
function getIconPath() {
  if (app.isPackaged) {
    return path.join(__dirname, "app-icon.png");
  }
  return path.join(__dirname, "..", "public", "app-icon.png");
}

/** BrowserWindow + Windows shell ke liye NativeImage — khali ho to path string fallback. */
function getWindowIcon() {
  try {
    const p = getIconPath();
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  } catch (_) {}
  return getIconPath();
}

// Keep a single source of truth for dev/prod behavior.
function isDevMode() {
  return !app.isPackaged;
}

function isAllowedFirebaseProxyTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    // Restrict proxy scope to Firebase/GCS hosts only (safer than open proxy).
    return (
      host.includes("firebasestorage.googleapis.com") ||
      host.includes("firebasestorage.app") ||
      host.includes("storage.googleapis.com")
    );
  } catch {
    return false;
  }
}

/**
 * Static `out/`: sirf `reconciliation/index.html` + `?shareId=` — `/reconciliation/{id}/` 404 par root → dashboard.
 * Document requests ko query page shell par map karo (assets/_next chhod kar).
 */
function rewriteReconciliationDocumentUrl(requestUrl) {
  const pathname = (requestUrl.pathname || "/").replace(/\/+$/, "") || "/";
  if (pathname.includes("/_next/") || /\.[a-z0-9]+$/i.test(pathname)) {
    return null;
  }
  if (pathname === "/reconciliation") {
    return `/reconciliation/index.html${requestUrl.search || ""}`;
  }
  const legacy = pathname.match(/^\/reconciliation\/([^/]+)$/);
  if (legacy && legacy[1] !== "__placeholder__") {
    return `/reconciliation/index.html${requestUrl.search || ""}`;
  }
  return null;
}

localAppServer.setServerDeps({
  staticPublicDir: path.join(__dirname, "out"),
  isPackaged: app.isPackaged,
  rewriteReconciliationDocumentUrl,
  isAllowedFirebaseProxyTarget,
});

/** Packaged app: UI BrowserView tabs (main window webContents khali rehta hai). */
let serverDataBridgeWindow = null;
let serverPowerSaveBlockerId = null;

/** Keep in sync with src/lib/plMirrorProtocol.ts — import from plMirrorProtocol.cjs */

const mirrorExportMetrics = {
  bundleFallbackCount: 0,
};

/** Per-company last successful push (client→server) / export (server→client pull). */
const mirrorSyncAtByCompany = new Map();

function getServerBuildLabel() {
  try {
    const v = app.getVersion();
    if (v) return String(v);
  } catch (_) {}
  try {
    return String(require("./package.json").version || "unknown");
  } catch (_) {
    return "unknown";
  }
}

function noteMirrorPushSuccess(companyId) {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const row = mirrorSyncAtByCompany.get(cid) || { lastPushAt: 0, lastExportAt: 0 };
  row.lastPushAt = Date.now();
  mirrorSyncAtByCompany.set(cid, row);
}

function noteMirrorExportSuccess(companyId) {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const row = mirrorSyncAtByCompany.get(cid) || { lastPushAt: 0, lastExportAt: 0 };
  row.lastExportAt = Date.now();
  mirrorSyncAtByCompany.set(cid, row);
}

function mirrorSyncMsAgo(companyId, key) {
  const row = mirrorSyncAtByCompany.get(String(companyId || "").trim());
  const ts = row?.[key];
  if (!ts || !Number.isFinite(ts)) return null;
  return Math.max(0, Date.now() - ts);
}

function mirrorHealthEnvelope(companyId, extra) {
  return {
    mirrorProtocol: PL_MIRROR_PROTOCOL_VERSION,
    serverBuild: getServerBuildLabel(),
    lastSuccessfulMirrorPushMsAgo: mirrorSyncMsAgo(companyId, "lastPushAt"),
    lastSuccessfulMirrorPullMsAgo: mirrorSyncMsAgo(companyId, "lastExportAt"),
    ...extra,
  };
}

function logMirrorExportDev(event, detail) {
  if (app.isPackaged) return;
  console.log("[MirrorExport]", event, detail || "");
}

function mirrorRendererLabel(wc) {
  if (!wc || wc.isDestroyed()) return "unknown";
  if (
    serverDataBridgeWindow &&
    !serverDataBridgeWindow.isDestroyed() &&
    wc.id === serverDataBridgeWindow.webContents.id
  ) {
    return "bridge";
  }
  try {
    const url = String(wc.getURL() || "");
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) return "main-window";
    if (url) return `wc-${wc.id}`;
  } catch (_) {}
  return `wc-${wc.id}`;
}

function mirrorRendererPriority(label) {
  return label === "bridge" ? 1 : 2;
}

function mirrorDocsMaxUpdatedAtMs(docs) {
  let max = 0;
  for (const d of docs) {
    const raw = d.updatedAt ?? d.lastEditedAt ?? d.createdAt;
    let ms = 0;
    if (typeof raw === "number" && Number.isFinite(raw)) ms = raw;
    else if (typeof raw === "string") {
      const p = Date.parse(raw);
      if (Number.isFinite(p)) ms = p;
    } else if (raw && typeof raw === "object" && typeof raw.seconds === "number") {
      ms = raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6);
    }
    if (ms > max) max = ms;
  }
  return max;
}

function mirrorDatasetFingerprintHex(docs) {
  const payload = [...docs]
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
    .map((d) => {
      const id = String(d.id || "");
      const upd = String(d.updatedAt ?? d.lastEditedAt ?? "");
      const deleted = d.isDeleted === true || d.deleted === true ? 1 : 0;
      return `${id}|${upd}|${deleted}`;
    })
    .join("\n");
  return require("crypto").createHash("sha1").update(payload).digest("hex").slice(0, 8);
}

function mirrorExportRendererScore(docs, label) {
  return {
    count: docs.length,
    maxUpdatedAt: mirrorDocsMaxUpdatedAtMs(docs),
    rendererPriority: mirrorRendererPriority(label),
  };
}

/** Prefer the complete SQLite dataset; freshness only breaks equal-count ties. */
function mirrorExportScoreIsBetter(candidate, current) {
  if (!current) return true;
  if (candidate.count !== current.count) return candidate.count > current.count;
  if (candidate.maxUpdatedAt !== current.maxUpdatedAt) {
    return candidate.maxUpdatedAt > current.maxUpdatedAt;
  }
  return candidate.rendererPriority > current.rendererPriority;
}

function scoreLocalhostAppUrl(url) {
  const u = String(url || "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u)) return 0;
  return 1;
}

function getAppTabWebContentsList() {
  const out = [];
  const seen = new Set();
  const push = (wc) => {
    if (!wc || wc.isDestroyed()) return;
    const id = wc.id;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(wc);
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const state = windowTabs.get(win.id);
    if (state?.tabs?.length) {
      for (const tab of state.tabs) {
        push(tab.webContents);
      }
    }
    push(win.webContents);
  }
  if (serverDataBridgeWindow && !serverDataBridgeWindow.isDestroyed()) {
    push(serverDataBridgeWindow.webContents);
  }
  return out.sort((a, b) => {
    const sa = scoreLocalhostAppUrl(a.getURL());
    const sb = scoreLocalhostAppUrl(b.getURL());
    if (sa !== sb) return sa - sb;
    const aBridge =
      serverDataBridgeWindow && !serverDataBridgeWindow.isDestroyed() && a.id === serverDataBridgeWindow.webContents.id
        ? 1
        : 0;
    const bBridge =
      serverDataBridgeWindow && !serverDataBridgeWindow.isDestroyed() && b.id === serverDataBridgeWindow.webContents.id
        ? 1
        : 0;
    return aBridge - bBridge;
  });
}

const SERVER_DATA_EXPORT_TIMEOUT_MS = {
  vouchers: 120_000,
  collection: 45_000,
  bundle: 90_000,
  bridgeFn: 12_000,
};

function serverDataCollectionExportTimeoutMs(collection) {
  return String(collection || "").trim() === "vouchers"
    ? SERVER_DATA_EXPORT_TIMEOUT_MS.vouchers
    : SERVER_DATA_EXPORT_TIMEOUT_MS.collection;
}

function webContentsDebugInfo(wc) {
  if (!wc || wc.isDestroyed()) return { ready: false, reason: "destroyed" };
  try {
    const url = String(wc.getURL() || "").trim() || null;
    if (wc.isLoading()) return { ready: false, reason: "loading", url, id: wc.id };
    if (!url || url === "about:blank") return { ready: false, reason: "blank_url", url, id: wc.id };
    if (url.startsWith("devtools://")) return { ready: false, reason: "devtools", url, id: wc.id };
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) {
      return { ready: false, reason: "not_app_origin", url, id: wc.id };
    }
    return { ready: true, url, id: wc.id, label: mirrorRendererLabel(wc) };
  } catch (e) {
    return { ready: false, reason: "error", error: String(e?.message || e) };
  }
}

function isWebContentsReadyForBridge(wc) {
  return webContentsDebugInfo(wc).ready === true;
}

async function executeJavaScriptWithTimeout(wc, script, timeoutMs = SERVER_DATA_EXPORT_TIMEOUT_MS.collection) {
  if (!wc || wc.isDestroyed()) return undefined;
  const info = webContentsDebugInfo(wc);
  if (!info.ready) {
    plTraceLog.traceLog("PL-SERVER", "executeJavaScript_skip_not_ready", info);
    return undefined;
  }
  let timer = null;
  try {
    return await Promise.race([
      wc.executeJavaScript(script, true),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("executeJavaScript_timeout")), timeoutMs);
      }),
    ]);
  } catch (e) {
    if (e?.message === "executeJavaScript_timeout") {
      plTraceLog.traceLog("PL-SERVER", "executeJavaScript_timeout", {
        timeoutMs,
        ...info,
      });
    }
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ek waqt me ek export — parallel bundle + collection requests renderer SQLite par deadlock na karein. */
let serverDataExportChain = Promise.resolve();
function enqueueServerDataExport(task) {
  const run = serverDataExportChain.then(() => task(), () => task());
  serverDataExportChain = run.catch(() => undefined);
  return run;
}

async function waitForWindowBridgeFn(wc, fnName, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!wc || wc.isDestroyed()) return false;
    if (!isWebContentsReadyForBridge(wc)) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    const ok = await executeJavaScriptWithTimeout(
      wc,
      `typeof window[${JSON.stringify(fnName)}] === "function"`,
      SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
    );
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  plTraceLog.traceLog("PL-SERVER", "waitForWindowBridgeFn_timeout", {
    fnName,
    timeoutMs,
    ...webContentsDebugInfo(wc),
  });
  return false;
}

const WARM_SERVER_DATA_BRIDGE_SCRIPT = `(async () => {
  try {
    if (typeof window.__plWarmServerDataBridge !== "function") return { ok: false, error: "no_warm_fn" };
    return await window.__plWarmServerDataBridge();
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : "warm_failed" };
  }
})()`;

/** Hidden localhost tab — same IndexedDB origin as app tabs (web jaisa SQLite read). */
let serverDataBridgeEnsureInflight = null;

async function ensureServerDataBridgeWindowInner() {
  if (!app.isPackaged && !IS_PHASE1B_RUNTIME_VERIFY) return null;
  const cfg = localAppServer.loadConfig(userDataPath());
  if (!localAppServer.shouldHostLocalServer(cfg) || !cfg.userWantsRunning) return null;
  const port = localAppServer.getAppUiServerPort();
  if (!port) return null;
  const bridgeUrl = `http://localhost:${port}/?pl_server_data_bridge=1`;
  if (!serverDataBridgeWindow || serverDataBridgeWindow.isDestroyed()) {
    serverDataBridgeWindow = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 640,
      height: 480,
      webPreferences: {
        preload: path.join(__dirname, "app-content-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    installPlServerRequestHeaders(serverDataBridgeWindow.webContents.session);
    serverDataBridgeWindow.on("closed", () => {
      serverDataBridgeWindow = null;
    });
  }
  const wc = serverDataBridgeWindow.webContents;
  const current = wc.getURL() || "";
  let onCanonicalBridgeOrigin = false;
  let onExpectedLocalOrigin = false;
  try {
    const u = new URL(current);
    onExpectedLocalOrigin =
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      String(u.port || "") === String(port) &&
      u.searchParams.get("pl_remote_client") !== "1";
    onCanonicalBridgeOrigin =
      onExpectedLocalOrigin &&
      u.searchParams.get("pl_server_data_bridge") === "1" &&
      u.searchParams.get("pl_remote_client") !== "1";
  } catch (_) {}
  if (!onCanonicalBridgeOrigin && onExpectedLocalOrigin && !wc.isLoading()) {
    const alreadyReady = await executeJavaScriptWithTimeout(
      wc,
      `typeof window.__plListShareableLocalCompanies === "function" && typeof window.__plExportCompanyDeltaCollection === "function"`,
      SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
    );
    if (alreadyReady === true) {
      plTraceLog.traceLog("PL-SERVER", "bridge_reuse_ready", { current });
      return wc;
    }
  }
  if (!onCanonicalBridgeOrigin) {
    plTraceLog.traceLog("PL-SERVER", "bridge_load_url_start", { bridgeUrl, previousUrl: current || null });
    await wc.loadURL(bridgeUrl);
  }
  await waitForWindowBridgeFn(wc, "__plListShareableLocalCompanies");
  await waitForWindowBridgeFn(wc, "__plExportCompanyDeltaCollection", SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn);
  return wc;
}

async function ensureServerDataBridgeWindow() {
  if (serverDataBridgeEnsureInflight) return serverDataBridgeEnsureInflight;
  serverDataBridgeEnsureInflight = ensureServerDataBridgeWindowInner();
  try {
    return await serverDataBridgeEnsureInflight;
  } finally {
    serverDataBridgeEnsureInflight = null;
  }
}

async function warmServerDataBridgeBestEffort() {
  const startedMs = Date.now();
  try {
    const bridge = await ensureServerDataBridgeWindow();
    if (!bridge || bridge.isDestroyed()) {
      plTraceLog.traceLog("PL-SERVER", "bridge_warm_skip", { reason: "no_bridge" });
      return null;
    }
    const warm = await executeJavaScriptWithTimeout(
      bridge,
      WARM_SERVER_DATA_BRIDGE_SCRIPT,
      SERVER_DATA_EXPORT_TIMEOUT_MS.bundle
    );
    plTraceLog.traceLog("PL-SERVER", "bridge_warm_done", {
      ms: Date.now() - startedMs,
      warm,
    });
    return warm;
  } catch (e) {
    plTraceLog.traceLog("PL-SERVER", "bridge_warm_failed", {
      ms: Date.now() - startedMs,
      error: String(e?.message || e),
    });
    return null;
  }
}

async function orderExportCandidates(candidates, companyId) {
  const cid = JSON.stringify(String(companyId || "").trim());
  const probeScript = `(async () => {
    try {
      if (typeof window.__plProbeDeltaExportCompany !== "function") return { ok: false, reason: "no_probe" };
      return await window.__plProbeDeltaExportCompany(${cid});
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : "probe_error" };
    }
  })()`;
  const scored = [];
  for (const wc of candidates) {
    const info = webContentsDebugInfo(wc);
    if (!info.ready) {
      plTraceLog.traceLog("PL-SERVER", "export_candidate_skip", info);
      scored.push({ wc, score: -1, info, probe: null });
      continue;
    }
    const probe = await executeJavaScriptWithTimeout(
      wc,
      probeScript,
      SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
    );
    const hasCompany = probe && typeof probe === "object" && probe.ok === true;
    plTraceLog.traceLog("PL-SERVER", hasCompany ? "export_candidate_hit" : "export_candidate_miss", {
      ...info,
      probe,
    });
    scored.push({ wc, score: hasCompany ? 2 : 1, info, probe });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((row) => row.wc);
}

/** P2P client push ke baad saari app tabs ko SQLite bump — hidden bridge window alag process me likhta hai. */
async function broadcastBrowserDbCollectionBump(companyId, collection, options = {}) {
  if (IS_PHASE1B_RUNTIME_VERIFY) phase1bVerifyStats.broadcast += 1;
  const source = String(options.source || "pl_host_remote_write");
  const immediate = options.immediate !== false;
  const script = `(function(){
    try {
      if (typeof window.__plInvalidateBrowserDbCache === "function") window.__plInvalidateBrowserDbCache();
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("pocket-ledger-browser-db-bump", {
        detail: {
          companyId: ${JSON.stringify(String(companyId || ""))},
          collection: ${JSON.stringify(String(collection || ""))},
          immediate: ${immediate ? "true" : "false"},
          source: ${JSON.stringify(source)}
        }
      }));
    } catch (e) {}
  })()`;
  const contentsList = getAppTabWebContentsList();
  await Promise.all(
    contentsList.map(async (wc) => {
      if (!wc || wc.isDestroyed()) return;
      try {
        const url = wc.getURL();
        if (!url || url.startsWith("devtools://")) return;
        await wc.executeJavaScript(script, true);
      } catch (_) {}
    })
  );
}

/** Gate add/remove — localhost:3000 vs :3001 alag localStorage; saari EXE tabs ko snapshot sync. */
async function broadcastGateStoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.gates)) return;
  const script = `(function(){
    try {
      const snap = ${JSON.stringify(snapshot)};
      if (typeof window.__plApplyGateStoreSnapshot === "function") {
        window.__plApplyGateStoreSnapshot(snap);
      } else {
        window.dispatchEvent(new Event("pl-gate-changed"));
      }
    } catch (e) {}
  })()`;
  const contentsList = getAppTabWebContentsList();
  await Promise.all(
    contentsList.map(async (wc) => {
      if (!wc || wc.isDestroyed()) return;
      try {
        const url = wc.getURL();
        if (!url || url.startsWith("devtools://")) return;
        await wc.executeJavaScript(script, true);
      } catch (_) {}
    })
  );
}

/** Host-authoritative doc upsert — shared by IPC and HTTP (bridge `__plHostBridgeCompanyDocUpsert` only). */
async function executeHostBridgeAuthoritativeCompanyDocUpsert(payload) {
  const cid = String(payload?.companyId || "").trim();
  const col = String(payload?.collectionName || "").trim();
  const result = await runInServerAppRenderer(
    `(async () => {
      try {
        if (typeof window.__plHostBridgeCompanyDocUpsert !== "function") return { ok: false, error: "bridge_missing" };
        return await window.__plHostBridgeCompanyDocUpsert(${JSON.stringify(payload)});
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "bridge_upsert_failed" };
      }
    })()`,
    { requireFn: "__plHostBridgeCompanyDocUpsert" }
  );
  const out = result && typeof result === "object" ? result : { ok: false, error: "bridge_upsert_failed" };
  if (out.ok && out.written !== false && payload?.notify !== false && cid && col) {
    await broadcastBrowserDbCollectionBump(cid, col);
  }
  return out;
}

/**
 * Local Server SQLite/export/push — dev jaisa: pehle open app tabs (SQLite loaded),
 * phir hidden bridge fallback (tray-only server).
 */
async function runInServerAppRenderer(script, opts = {}) {
  const requireFn = opts.requireFn || "";
  const accept = opts.accept;
  const companyId = String(opts.companyId || "").trim();
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : SERVER_DATA_EXPORT_TIMEOUT_MS.collection;
  void ensureServerDataBridgeWindow().catch(() => {});
  let candidates = getAppTabWebContentsList().filter(isWebContentsReadyForBridge);
  if (companyId) {
    candidates = await orderExportCandidates(candidates, companyId);
  }
  plTraceLog.traceLog("PL-SERVER", "runInServerAppRenderer_start", {
    requireFn: requireFn || null,
    companyId: companyId || null,
    candidateCount: candidates.length,
  });
  for (const wc of candidates) {
    if (!wc || wc.isDestroyed()) continue;
    if (requireFn) {
      const hasFn = await executeJavaScriptWithTimeout(
        wc,
        `typeof window[${JSON.stringify(requireFn)}] === "function"`,
        SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
      );
      if (!hasFn) continue;
    }
    const result = await executeJavaScriptWithTimeout(wc, script, timeoutMs);
    if (typeof accept === "function" ? accept(result) : result != null) {
      plTraceLog.traceLog("PL-SERVER", "runInServerAppRenderer_ok", {
        requireFn: requireFn || null,
        companyId: companyId || null,
        renderer: mirrorRendererLabel(wc),
      });
      return result;
    }
  }
  if (requireFn) {
    const bridge = await ensureServerDataBridgeWindow();
    if (bridge && !bridge.isDestroyed()) {
      await waitForWindowBridgeFn(bridge, requireFn, SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn);
      const result = await executeJavaScriptWithTimeout(bridge, script, timeoutMs);
      if (typeof accept === "function" ? accept(result) : result != null) {
        plTraceLog.traceLog("PL-SERVER", "runInServerAppRenderer_ok", {
          requireFn: requireFn || null,
          companyId: companyId || null,
          renderer: "bridge",
        });
        return result;
      }
    }
  }
  plTraceLog.traceLog("PL-SERVER", "runInServerAppRenderer_miss", {
    requireFn: requireFn || null,
    companyId: companyId || null,
  });
  return null;
}

const SHAREABLE_COMPANIES_SNAPSHOT_FILE = "pl-shareable-companies-snapshot.json";

function shareableCompaniesSnapshotPath() {
  return path.join(userDataPath(), SHAREABLE_COMPANIES_SNAPSHOT_FILE);
}

function loadShareableCompaniesSnapshot() {
  try {
    const raw = JSON.parse(fs.readFileSync(shareableCompaniesSnapshotPath(), "utf8"));
    if (!Array.isArray(raw?.companies)) return [];
    return raw.companies
      .map((row) => {
        const id = String(row?.id || "").trim();
        if (!id) return null;
        const planExpiryMs =
          typeof row?.planExpiryMs === "number" && Number.isFinite(row.planExpiryMs) ? row.planExpiryMs : null;
        const offlineLicenseValidUntilMs =
          typeof row?.offlineLicenseValidUntilMs === "number" && Number.isFinite(row.offlineLicenseValidUntilMs)
            ? row.offlineLicenseValidUntilMs
            : null;
        return {
          id,
          name: String(row?.name || id).trim() || id,
          storageOption: "local",
          ownerEmail: row?.ownerEmail ?? null,
          ...(Array.isArray(row?.accessEmails) ? { accessEmails: row.accessEmails } : {}),
          ...(Array.isArray(row?.localCompanyUsers) ? { localCompanyUsers: row.localCompanyUsers } : {}),
          ...(row?.planId != null && String(row.planId).trim() ? { planId: String(row.planId).trim() } : {}),
          ...(planExpiryMs != null ? { planExpiryMs } : {}),
          ...(offlineLicenseValidUntilMs != null ? { offlineLicenseValidUntilMs } : {}),
          ...(typeof row?.requiresLogin === "boolean" ? { requiresLogin: row.requiresLogin } : {}),
          ...(row?.usernameHint != null ? { usernameHint: String(row.usernameHint).trim() || null } : {}),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveShareableCompaniesSnapshot(companies) {
  const rows = Array.isArray(companies) ? companies : [];
  try {
    fs.writeFileSync(
      shareableCompaniesSnapshotPath(),
      JSON.stringify({ updatedAt: new Date().toISOString(), companies: rows }, null, 2),
      "utf8"
    );
  } catch (_) {}
  return rows;
}

/** Collection mirror export — canonical server-data bridge only. */
async function runMirrorCollectionExportWithMeta(companyId, collection, opts = {}) {
  const exportStartedMs = Date.now();
  const cid = String(companyId || "").trim();
  const col = String(collection || "").trim();
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : serverDataCollectionExportTimeoutMs(col);
  if (!cid || !col) return { docs: null, meta: null };

  const exportScript = `(async () => {
    try {
      if (typeof window.__plExportCompanyDeltaCollection !== "function") return null;
      return await window.__plExportCompanyDeltaCollection(${JSON.stringify(cid)}, ${JSON.stringify(col)});
    } catch (_) {
      return null;
    }
  })()`;

  const partiesScript =
    col === "vouchers"
      ? `(async () => {
    try {
      if (typeof window.__plExportCompanyDeltaCollection !== "function") return null;
      return await window.__plExportCompanyDeltaCollection(${JSON.stringify(cid)}, "parties");
    } catch (_) {
      return null;
    }
  })()`
      : null;

  void ensureServerDataBridgeWindow().catch(() => {});
  const candidates = await orderExportCandidates(
    getAppTabWebContentsList().filter(isWebContentsReadyForBridge),
    cid
  );
  plTraceLog.traceLog("PL-SERVER", "mirror_export_start", {
    companyId: cid,
    collection: col,
    candidateCount: candidates.length,
  });
  let sawSuspiciousEmptyVouchers = false;
  let bestRows = null;
  let bestScore = null;
  let bestWc = null;
  let bestLabel = "";

  for (const wc of candidates) {
    if (!wc || wc.isDestroyed()) continue;
    const url = wc.getURL() || "";
    if (url.startsWith("devtools://")) continue;
    const hasFn = await executeJavaScriptWithTimeout(
      wc,
      `typeof window.__plExportCompanyDeltaCollection === "function"`,
      SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
    );
    if (!hasFn) continue;

    const rendererStartedMs = Date.now();
    const label = mirrorRendererLabel(wc);
    try {
      const result = await executeJavaScriptWithTimeout(wc, exportScript, timeoutMs);
      const rendererDurationMs = Date.now() - rendererStartedMs;
      if (!Array.isArray(result)) continue;
      if (col === "vouchers" && result.length === 0 && partiesScript) {
        try {
          const parties = await executeJavaScriptWithTimeout(wc, partiesScript, timeoutMs);
          if (Array.isArray(parties) && parties.length > 0) {
            sawSuspiciousEmptyVouchers = true;
            logMirrorExportDev("renderer_skipped", {
              renderer: label,
              collection: col,
              reason: "suspicious_empty_vouchers",
              partiesCount: parties.length,
              mirror_export_duration_ms: rendererDurationMs,
            });
            continue;
          }
        } catch (_) {
          /* fall through — treat as authoritative empty */
        }
      }
      const score = mirrorExportRendererScore(result, label);
      if (col === "vouchers") {
        plTraceLog.traceLog("PL-VOUCHER-FORENSIC", "host_renderer_candidate", {
          companyId: cid,
          renderer: label,
          count: result.length,
          fingerprint: mirrorDatasetFingerprintHex(result),
          score,
        });
      }
      logMirrorExportDev("renderer_result", {
        renderer: label,
        collection: col,
        count: result.length,
        cacheReload: true,
        score,
        fingerprint: mirrorDatasetFingerprintHex(result),
        mirror_export_duration_ms: rendererDurationMs,
      });
      if (mirrorExportScoreIsBetter(score, bestScore)) {
        bestScore = score;
        bestRows = result;
        bestWc = wc;
        bestLabel = label;
      }
    } catch (_) {
      /* try next renderer */
    }
  }

  if (!Array.isArray(bestRows)) {
    const bridge = await ensureServerDataBridgeWindow();
    if (bridge && !bridge.isDestroyed()) {
      await waitForWindowBridgeFn(
        bridge,
        "__plExportCompanyDeltaCollection",
        SERVER_DATA_EXPORT_TIMEOUT_MS.bridgeFn
      );
      const rendererStartedMs = Date.now();
      const label = mirrorRendererLabel(bridge);
      try {
        const result = await executeJavaScriptWithTimeout(bridge, exportScript, timeoutMs);
        const rendererDurationMs = Date.now() - rendererStartedMs;
        if (Array.isArray(result)) {
          if (col === "vouchers" && result.length === 0 && partiesScript) {
            try {
              const parties = await executeJavaScriptWithTimeout(bridge, partiesScript, timeoutMs);
              if (Array.isArray(parties) && parties.length > 0) {
                sawSuspiciousEmptyVouchers = true;
              }
            } catch (_) {}
          }
          if (!sawSuspiciousEmptyVouchers) {
            bestScore = mirrorExportRendererScore(result, label);
            bestRows = result;
            bestWc = bridge;
            bestLabel = label;
            logMirrorExportDev("renderer_result", {
              renderer: label,
              collection: col,
              count: result.length,
              cacheReload: true,
              score: bestScore,
              fingerprint: mirrorDatasetFingerprintHex(result),
              mirror_export_duration_ms: rendererDurationMs,
            });
          }
        }
      } catch (_) {}
    }
  }

  if (Array.isArray(bestRows)) {
    const mirrorExportDurationMs = Date.now() - exportStartedMs;
    logMirrorExportDev("export_selected", {
      renderer: bestLabel,
      collection: col,
      count: bestRows.length,
      score: bestScore,
      fingerprint: mirrorDatasetFingerprintHex(bestRows),
      mirror_export_duration_ms: mirrorExportDurationMs,
    });
    if (col === "vouchers") {
      plTraceLog.traceLog("PL-VOUCHER-FORENSIC", "host_export_selected", {
        companyId: cid,
        renderer: bestLabel,
        count: bestRows.length,
        fingerprint: mirrorDatasetFingerprintHex(bestRows),
        score: bestScore,
        exportMs: mirrorExportDurationMs,
      });
    }
    return {
      docs: bestRows,
      meta: {
        renderer: bestLabel,
        fingerprint: mirrorDatasetFingerprintHex(bestRows),
        score: bestScore,
        exportMs: mirrorExportDurationMs,
        voucherCount: bestRows.length,
        bestWc: bestWc,
      },
    };
  }
  if (sawSuspiciousEmptyVouchers) {
    return { docs: null, meta: { sawSuspiciousEmptyVouchers: true } };
  }
  return { docs: null, meta: null };
}

async function runMirrorCollectionExportBestEffort(companyId, collection, opts = {}) {
  const { docs } = await runMirrorCollectionExportWithMeta(companyId, collection, opts);
  return docs;
}

async function probeMirrorDbOpenMs(wc) {
  if (!wc || wc.isDestroyed()) return null;
  try {
    const ready = await wc.executeJavaScript(`typeof window.__plDeltaHealthDbOpenMs === "function"`, true);
    if (!ready) return null;
    const ms = await wc.executeJavaScript(`window.__plDeltaHealthDbOpenMs()`, true);
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  } catch (_) {
    return null;
  }
}

localAppServer.setMirrorHealthProvider(async (companyId) => {
  const cid = String(companyId || "").trim();
  if (!cid) {
    return mirrorHealthEnvelope(cid, { ok: false, error: "missing_company_id" });
  }
  const { docs, meta } = await runMirrorCollectionExportWithMeta(cid, "vouchers");
  if (!meta || !Array.isArray(docs)) {
    return mirrorHealthEnvelope(cid, {
      ok: false,
      error: meta?.sawSuspiciousEmptyVouchers ? "suspicious_empty_vouchers" : "export_unavailable",
      mirror_bundle_fallback_count: mirrorExportMetrics.bundleFallbackCount,
    });
  }
  noteMirrorExportSuccess(cid);
  const dbOpenMs = meta.bestWc ? await probeMirrorDbOpenMs(meta.bestWc) : null;
  return mirrorHealthEnvelope(cid, {
    ok: true,
    companyId: cid,
    renderer: meta.renderer,
    fingerprint: meta.fingerprint,
    voucherCount: meta.voucherCount,
    cacheReload: true,
    dbOpenMs,
    exportMs: meta.exportMs,
    score: meta.score,
    mirror_bundle_fallback_count: mirrorExportMetrics.bundleFallbackCount,
  });
});

localAppServer.setShareableCompaniesProvider(async () => {
  const snap = loadShareableCompaniesSnapshot();
  const rows = await runInServerAppRenderer(
    `(async () => {
      try {
        if (typeof window.__plListShareableLocalCompanies !== "function") return [];
        return await window.__plListShareableLocalCompanies();
      } catch (_) {
        return [];
      }
    })()`,
    {
      requireFn: "__plListShareableLocalCompanies",
      // Empty array is valid — do not fall through to 25s bridge wait (remote gate Test timeout).
      accept: (r) => Array.isArray(r),
    }
  );
  if (Array.isArray(rows) && rows.length > 0) {
    saveShareableCompaniesSnapshot(rows);
    return rows;
  }
  return snap;
});

const LOGIN_BRIDGE_SCRIPT = (companyId, username, password) =>
  `(async () => {
      try {
        if (typeof window.__plValidateLocalCompanyLogin !== "function") {
          return { ok: false, error: "bridge_missing" };
        }
        return await window.__plValidateLocalCompanyLogin(${JSON.stringify(companyId)}, ${JSON.stringify(username)}, ${JSON.stringify(password)});
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "Login failed" };
      }
    })()`;

async function runLocalCompanyLoginBridge(companyId, username, password) {
  const script = LOGIN_BRIDGE_SCRIPT(companyId, username, password);
  const fromApp = await runInServerAppRenderer(script, {
    requireFn: "__plValidateLocalCompanyLogin",
    accept: (r) => r && typeof r === "object" && "ok" in r,
  });
  if (fromApp && typeof fromApp === "object") {
    if (fromApp.ok === true) return fromApp;
    if (fromApp.error && fromApp.error !== "bridge_missing") {
      return { ok: false, error: String(fromApp.error) };
    }
  }
  let lastError = "Invalid username or password";
  const bridge = await ensureServerDataBridgeWindow();
  if (!bridge || bridge.isDestroyed()) {
    return {
      ok: false,
      error:
        "Server data bridge is not ready. On the server PC keep Pocket Ledger open (or wait ~10s after starting sharing), then try again.",
    };
  }
  await waitForWindowBridgeFn(bridge, "__plValidateLocalCompanyLogin", 12000);
  try {
    const result = await bridge.executeJavaScript(script, true);
    if (result && typeof result === "object" && result.ok === true) return result;
    if (result && typeof result === "object" && result.error) {
      lastError = String(result.error);
    }
  } catch (_) {}
  if (lastError === "bridge_missing") {
    return {
      ok: false,
      error:
        "Server data bridge is not ready. On the server PC keep Pocket Ledger open (or wait ~10s after starting sharing), then try again.",
    };
  }
  return { ok: false, error: lastError };
}

localAppServer.setLocalCompanyAuthProvider(async (companyId, username, password) => {
  return runLocalCompanyLoginBridge(companyId, username, password);
});

localAppServer.setCompanyLoginMetaProvider(async (companyId, appEmail) => {
  const script = `(async () => {
      try {
        if (typeof window.__plGetCompanyLoginMeta !== "function") {
          return { requiresLogin: true, usernameHint: null };
        }
        return await window.__plGetCompanyLoginMeta(${JSON.stringify(companyId)}, ${JSON.stringify(appEmail || null)});
      } catch (_) {
        return { requiresLogin: true, usernameHint: null };
      }
    })()`;
  const fromApp = await runInServerAppRenderer(script, {
    requireFn: "__plGetCompanyLoginMeta",
    accept: (r) => r && typeof r === "object" && "requiresLogin" in r,
  });
  if (fromApp && typeof fromApp === "object") return fromApp;
  const bridge = await ensureServerDataBridgeWindow();
  if (!bridge || bridge.isDestroyed()) {
    return { requiresLogin: true, usernameHint: null };
  }
  await waitForWindowBridgeFn(bridge, "__plGetCompanyLoginMeta", 12000);
  try {
    const result = await bridge.executeJavaScript(script, true);
    if (result && typeof result === "object") return result;
  } catch (_) {}
  return { requiresLogin: true, usernameHint: null };
});

localAppServer.setCompanyMirrorExportProvider(async (companyId) =>
  enqueueServerDataExport(async () => {
    const bundle = await runInServerAppRenderer(
      `(async () => {
      try {
        if (typeof window.__plExportCompanyDeltaBundle !== "function") return null;
        return await window.__plExportCompanyDeltaBundle(${JSON.stringify(companyId)});
      } catch (_) {
        return null;
      }
    })()`,
      {
        requireFn: "__plExportCompanyDeltaBundle",
        timeoutMs: SERVER_DATA_EXPORT_TIMEOUT_MS.bundle,
        companyId: String(companyId || ""),
      }
    );
    return bundle && typeof bundle === "object" ? bundle : null;
  })
);

localAppServer.setCompanyMirrorCollectionExportProvider(async (companyId, collection) =>
  enqueueServerDataExport(async () => {
    const col = String(collection || "").trim();
    const timeoutMs = serverDataCollectionExportTimeoutMs(col);
    const rows = await runMirrorCollectionExportBestEffort(companyId, collection, { timeoutMs });
    if (Array.isArray(rows)) {
      noteMirrorExportSuccess(companyId);
      return rows;
    }
    const bundle = await runInServerAppRenderer(
      `(async () => {
      try {
        if (typeof window.__plExportCompanyDeltaBundle !== "function") return null;
        return await window.__plExportCompanyDeltaBundle(${JSON.stringify(companyId)});
      } catch (_) {
        return null;
      }
    })()`,
      {
        requireFn: "__plExportCompanyDeltaBundle",
        timeoutMs: SERVER_DATA_EXPORT_TIMEOUT_MS.bundle,
        companyId: String(companyId || ""),
      }
    );
    const fromBundle = bundle?.collections?.[col];
    if (Array.isArray(fromBundle)) {
      mirrorExportMetrics.bundleFallbackCount += 1;
      console.warn(
        "[MirrorExport] mirror_bundle_fallback_count",
        mirrorExportMetrics.bundleFallbackCount,
        { companyId, collection: col, count: fromBundle.length }
      );
      logMirrorExportDev("bundle_fallback", {
        companyId,
        collection: col,
        count: fromBundle.length,
        mirror_bundle_fallback_count: mirrorExportMetrics.bundleFallbackCount,
      });
      noteMirrorExportSuccess(companyId);
      return fromBundle;
    }
    plTraceLog.traceLog("PL-SERVER", "mirror_collection_export_null", { companyId, collection: col });
    return null;
  })
);

localAppServer.setAttachmentBlobProvider(async (companyId, ref) => {
  const payload = await runInServerAppRenderer(
    `(async () => {
      try {
        if (typeof window.__plReadAttachmentBlob !== "function") return null;
        return await window.__plReadAttachmentBlob(${JSON.stringify(companyId)}, ${JSON.stringify(ref)});
      } catch (_) {
        return null;
      }
    })()`,
    { requireFn: "__plReadAttachmentBlob" }
  );
  if (!payload || typeof payload !== "object") return null;
  const contentType = String(payload.contentType || "application/octet-stream");
  // Prefer disk path from renderer — avoid giant base64 through executeJavaScript (LAN kbps feel).
  const rel = String(payload.relativePath || payload.filePath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (rel && !rel.includes("..")) {
    try {
      const primary = path.join(userDataPath(), "PocketLedgerData", rel);
      const legacy = path.join(userDataPath(), "pl-attachments", rel);
      const full = fs.existsSync(primary) ? primary : legacy;
      if (fs.existsSync(full)) {
        const buffer = fs.readFileSync(full);
        if (buffer.length > 0) return { buffer, contentType };
      }
    } catch (_) {
      /* fall through to base64 */
    }
  }
  if (!payload.base64) return null;
  try {
    const buffer = Buffer.from(String(payload.base64), "base64");
    if (!buffer.length) return null;
    return { buffer, contentType };
  } catch (_) {
    return null;
  }
});

localAppServer.setAttachmentBlobWriteProvider(async (companyId, body) => {
  const result = await runInServerAppRenderer(
    `(async () => {
      try {
        if (typeof window.__plPutPendingAttachmentFromRemote !== "function") {
          return { ok: false, error: "bridge_missing" };
        }
        return await window.__plPutPendingAttachmentFromRemote(${JSON.stringify(companyId)}, ${JSON.stringify(body)});
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "write_failed" };
      }
    })()`,
    { requireFn: "__plPutPendingAttachmentFromRemote" }
  );
  return result && typeof result === "object" ? result : { ok: false, error: "write_failed" };
});

localAppServer.setCompanyMirrorPushProvider(async (companyId, collection, docs, meta) => {
  if (meta?.hostSelfPublish) {
    noteMirrorPushSuccess(companyId);
    if (IS_PHASE1B_RUNTIME_VERIFY) phase1bVerifyStats.hostPublish += 1;
    await broadcastBrowserDbCollectionBump(companyId, collection);
    return {
      ok: true,
      applied: 0,
      skipped: Array.isArray(docs) ? docs.length : 0,
      received: Array.isArray(docs) ? docs.length : 0,
      hostSelfPublish: true,
      mirrorProtocol: PL_MIRROR_PROTOCOL_VERSION,
      serverBuild: getServerBuildLabel(),
    };
  }
  const result = await runInServerAppRenderer(
    `(async () => {
      try {
        if (typeof window.__plUpsertCompanyDeltaDocs !== "function") return { ok: false, error: "bridge_missing" };
        return await window.__plUpsertCompanyDeltaDocs(${JSON.stringify(companyId)}, ${JSON.stringify(collection)}, ${JSON.stringify(docs)});
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : "push_failed" };
      }
    })()`,
    { requireFn: "__plUpsertCompanyDeltaDocs" }
  );
  const out = result && typeof result === "object" ? result : { ok: false, error: "push_failed" };
  if (out.ok) {
    noteMirrorPushSuccess(companyId);
    if (IS_PHASE1B_RUNTIME_VERIFY) phase1bVerifyStats.mirrorPushBroadcast += 1;
    plTraceLog.traceLog("PL-LIVE-CHANGE", "server_delta_push_applied", {
      companyId,
      collection,
      hostSelfPublish: Boolean(meta?.hostSelfPublish),
    });
    await broadcastBrowserDbCollectionBump(companyId, collection);
  }
  return {
    ...out,
    mirrorProtocol: PL_MIRROR_PROTOCOL_VERSION,
    serverBuild: getServerBuildLabel(),
  };
});

localAppServer.setAuthoritativeCompanyDocUpsertProvider(async (payload) => {
  if (IS_PHASE1B_RUNTIME_VERIFY) phase1bVerifyStats.authoritativeHttp += 1;
  const out = await executeHostBridgeAuthoritativeCompanyDocUpsert(payload);
  return out && typeof out === "object" ? out : { ok: false, error: "bridge_upsert_failed" };
});

function userDataPath() {
  return app.getPath("userData");
}

/** Packaged EXE UI — localhost static server; sharing off hone par bhi chalna chahiye. */
async function ensureAppUiStaticServer() {
  const cfg = localAppServer.loadConfig(userDataPath());
  if (!localAppServer.shouldHostLocalServer(cfg)) {
    throw new Error("PL_LOCAL_SERVER_ROLE_CLIENT_ONLY");
  }
  try {
    return await localAppServer.startStaticServer(userDataPath(), { forAppUi: true });
  } catch (e) {
    if (String(e?.message || e) === "PL_LOCAL_SERVER_ROLE_CLIENT_ONLY") {
      throw e;
    }
    if (String(e?.message || e) === "PL_PACKAGED_STATIC_PORT_EXHAUSTED") {
      dialog.showErrorBox(
        "Pocket Ledger",
        "Local server ports are all busy (tried configured port and fallbacks).\n\n" +
          "Close other apps using those ports, then reopen.\n" +
          "Your sign-in stays on the same port — changing ports looks like a logout."
      );
    }
    throw e;
  }
}

async function startStaticServer() {
  const cfg = localAppServer.loadConfig(userDataPath());
  if (!localAppServer.shouldHostLocalServer(cfg)) {
    throw new Error("PL_LOCAL_SERVER_ROLE_CLIENT_ONLY");
  }
  if (!cfg.userWantsRunning) {
    throw new Error("PL_LOCAL_SERVER_STOPPED");
  }
  try {
    await localAppServer.startStaticServer(userDataPath(), { forAppUi: true });
    const port = await localAppServer.startSharingServer(userDataPath());
    const cfgAfter = localAppServer.loadConfig(userDataPath());
    if (cfgAfter.userWantsRunning) {
      void ensureServerDataBridgeWindow().catch(() => {});
    }
    return port;
  } catch (e) {
    if (String(e?.message || e) === "PL_LOCAL_SERVER_ROLE_CLIENT_ONLY") {
      throw e;
    }
    if (String(e?.message || e) === "PL_PACKAGED_STATIC_PORT_EXHAUSTED") {
      dialog.showErrorBox(
        "Pocket Ledger",
        "Local server ports are all busy (tried configured port and fallbacks).\n\n" +
          "Close other apps using those ports, then reopen.\n" +
          "Your sign-in stays on the same port — changing ports looks like a logout."
      );
    }
    throw e;
  }
}

function stopStaticServer() {
  return localAppServer.stopStaticServer();
}

/** Packaged EXE: server background me chal raha ho to system tray se stop / open. */
let serverTray = null;

function getTrayIconImage() {
  try {
    const p = getIconPath();
    let img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      if (process.platform === "win32") {
        const { width, height } = img.getSize();
        if (width !== 16 || height !== 16) {
          img = img.resize({ width: 16, height: 16, quality: "best" });
        }
      }
      return img;
    }
  } catch (_) {}
  try {
    const icon = getWindowIcon();
    if (icon && typeof icon === "object" && typeof icon.isEmpty === "function" && !icon.isEmpty()) {
      if (process.platform === "win32") {
        return icon.resize({ width: 16, height: 16, quality: "best" });
      }
      return icon;
    }
  } catch (_) {}
  return null;
}

function destroyServerTray() {
  if (serverTray) {
    try {
      serverTray.destroy();
    } catch (_) {}
    serverTray = null;
    plTraceLog.traceLog("PL-MAIN", "tray_destroyed", {});
  }
}

/** Shortcut / second instance / tray: window band ho to naya kholna, warna pehle wala dikhao. */
async function focusOrOpenMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && windowTabs.has(w.id));
  if (wins.length > 0) {
    const w = wins[0];
    if (w.isMinimized()) w.restore();
    w.show();
    updateBrowserViewBounds(w);
    sendWindowMaxState(w);
    pushTabStripState(w);
    w.focus();
    notifyLiveSyncResume("app_reopen", w);
    return;
  }
  await createWindow();
}

async function stopLocalServerAndPersist() {
  localAppServer.saveConfig(userDataPath(), { userWantsRunning: false });
  await localAppServer.stopSharingServer();
  const cfg = localAppServer.loadConfig(userDataPath());
  if (app.isPackaged && localAppServer.shouldHostLocalServer(cfg)) {
    await localAppServer.startStaticServer(userDataPath(), { forAppUi: true });
  }
  syncLocalServerTray();
}

async function startSharedLocalServer() {
  localAppServer.saveConfig(userDataPath(), { userWantsRunning: true });
  await localAppServer.startStaticServer(userDataPath(), { forAppUi: true });
  const port = await localAppServer.startSharingServer(userDataPath());
  void warmServerDataBridgeBestEffort().catch(() => {});
  return port;
}

/** Packaged boot / app update: sharing resume when operator left it on OR auto-start is enabled. */
async function ensureHostSharingRunningAfterLaunch(options = {}) {
  const forceRestart = options?.forceRestart === true;
  const ud = userDataPath();
  let cfg = localAppServer.loadConfig(ud);
  if (!localAppServer.shouldHostLocalServer(cfg) || localAppServer.shouldUseRemoteEntry(cfg)) {
    return null;
  }
  if (!app.isPackaged && !IS_PHASE1B_RUNTIME_VERIFY) return null;

  const shouldShare = cfg.userWantsRunning || cfg.autoStartOnBoot;
  if (!shouldShare) return null;

  if (cfg.autoStartOnBoot && !cfg.userWantsRunning) {
    cfg = localAppServer.saveConfig(ud, { userWantsRunning: true });
  }

  try {
    try {
      await localAppServer.startStaticServer(ud, { forAppUi: true });
    } catch (uiErr) {
      console.warn("[main] ensure app UI server failed", uiErr?.message || uiErr);
    }
    if (forceRestart) {
      const port = await localAppServer.restartSharingServer(ud);
      if (port != null) void warmServerDataBridgeBestEffort().catch(() => {});
      return port;
    }
    const st = localAppServer.getStatus(ud);
    if (st.sharingActive && st.sharingPort) {
      void warmServerDataBridgeBestEffort().catch(() => {});
      return st.sharingPort;
    }
    const port = await localAppServer.startSharingServer(ud);
    void warmServerDataBridgeBestEffort().catch(() => {});
    return port;
  } catch (e) {
    console.warn("[main] ensure host sharing running failed", e?.message || e);
    return null;
  }
}

/** @deprecated alias — phase1b verify + legacy callers */
async function resumeHostSharingAfterBootIfConfigured() {
  return ensureHostSharingRunningAfterLaunch();
}

function shouldOfferTrayStartSharing(cfg, st) {
  return (
    localAppServer.shouldHostLocalServer(cfg) &&
    !st.sharingActive &&
    st.appUiServing
  );
}

function shouldHideMainWindowToTrayOnClose() {
  if (!app.isPackaged || app.__plQuitting) return false;
  const cfg = localAppServer.loadConfig(userDataPath());
  if (!localAppServer.shouldHostLocalServer(cfg)) return false;
  // Window close → tray jab user sharing ON rakhna chahta hai (status flicker pe full quit mat karo).
  if (cfg.userWantsRunning === true) return true;
  const st = localAppServer.getStatus(userDataPath());
  return !!st.sharingActive;
}

function stopServerPowerSaveBlocker(reason) {
  if (serverPowerSaveBlockerId == null) return;
  try {
    if (powerSaveBlocker.isStarted(serverPowerSaveBlockerId)) {
      powerSaveBlocker.stop(serverPowerSaveBlockerId);
    }
    plTraceLog.traceLog("PL-MAIN", "server_power_save_blocker_stopped", {
      reason: reason || "unknown",
    });
  } catch (_) {}
  serverPowerSaveBlockerId = null;
}

function syncServerPowerSaveBlocker(st) {
  const cfg = localAppServer.loadConfig(userDataPath());
  const active =
    app.isPackaged &&
    (st?.sharingActive === true || cfg.userWantsRunning === true) &&
    localAppServer.shouldHostLocalServer(cfg);
  if (!active) {
    stopServerPowerSaveBlocker("sharing_inactive");
    return;
  }
  try {
    if (serverPowerSaveBlockerId != null && powerSaveBlocker.isStarted(serverPowerSaveBlockerId)) {
      return;
    }
    // Prevent OS sleep / background throttle while PL sharing should stay reachable for staff.
    serverPowerSaveBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    plTraceLog.traceLog("PL-MAIN", "server_power_save_blocker_started", {
      id: serverPowerSaveBlockerId,
      mode: "prevent-display-sleep",
      sharingPort: st?.sharingPort || st?.port || null,
      userWantsRunning: cfg.userWantsRunning === true,
    });
  } catch (e) {
    try {
      serverPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      plTraceLog.traceLog("PL-MAIN", "server_power_save_blocker_started", {
        id: serverPowerSaveBlockerId,
        mode: "prevent-app-suspension_fallback",
        sharingPort: st?.sharingPort || st?.port || null,
      });
    } catch (e2) {
      plTraceLog.traceLog("PL-MAIN", "server_power_save_blocker_failed", {
        error: e2 && e2.message ? e2.message : String(e2 || e || "unknown"),
      });
    }
  }
}

function hideAllMainWindowsToTray() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.hide();
  }
}

async function quitPocketLedgerFully(reason) {
  if (app.__plQuitting) return;
  app.__plQuitting = true;
  plTraceLog.traceLog("PL-MAIN", "full_quit_requested", { reason: reason || "unknown" });
  stopServerPowerSaveBlocker(reason || "full_quit");
  destroyServerTray();
  try {
    localAppServer.saveConfig(userDataPath(), { userWantsRunning: false });
  } catch (_) {}
  try {
    await localAppServer.stopStaticServer();
  } catch (_) {}
  try {
    await stopStaticServer();
  } catch (_) {}
  try {
    if (serverDataBridgeWindow && !serverDataBridgeWindow.isDestroyed()) {
      serverDataBridgeWindow.destroy();
    }
    serverDataBridgeWindow = null;
  } catch (_) {}
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.destroy();
    }
  } catch (_) {}
  app.quit();
  setTimeout(() => {
    try {
      app.exit(0);
    } catch (_) {}
  }, 2000).unref?.();
}

function attachPackagedCloseToTrayBehavior(win) {
  win.on("close", (event) => {
    if (!app.isPackaged || app.__plQuitting) return;
    if (shouldHideMainWindowToTrayOnClose()) {
      event.preventDefault();
      hideAllMainWindowsToTray();
      const cfg = localAppServer.loadConfig(userDataPath());
      let st = localAppServer.getStatus(userDataPath());
      // Sharing intent ON but process down — tray pe rahe + server dubara start try.
      if (cfg.userWantsRunning && !st.sharingActive) {
        plTraceLog.traceLog("PL-MAIN", "window_close_restart_sharing", {
          userWantsRunning: true,
          sharingActive: false,
        });
        void startStaticServer()
          .then(() => {
            syncLocalServerTray();
            syncServerPowerSaveBlocker(localAppServer.getStatus(userDataPath()));
          })
          .catch((e) => {
            plTraceLog.traceLog("PL-MAIN", "window_close_restart_sharing_failed", {
              error: e && e.message ? e.message : String(e || "unknown"),
            });
            syncLocalServerTray();
          });
      } else {
        syncLocalServerTray();
        syncServerPowerSaveBlocker(st);
      }
      st = localAppServer.getStatus(userDataPath());
      plTraceLog.traceLog("PL-MAIN", "window_hidden_server_running", {
        sharingActive: st.sharingActive === true,
        userWantsRunning: cfg.userWantsRunning === true,
        sharingPort: st.sharingPort || st.port || null,
      });
      notifyServerStillRunningInTray(st);
      return;
    }

    // Hidden bridge/static-server windows can keep Electron alive, so do not rely
    // on `window-all-closed` when the user closes the last visible app window.
    event.preventDefault();
    quitPocketLedgerFully("window_close_server_not_running");
  });
}

/** Tray rule: sharing ON or user wants running → tray. Window open/closed does not matter. */
function syncLocalServerTray() {
  if (!app.isPackaged) {
    stopServerPowerSaveBlocker("not_packaged");
    destroyServerTray();
    return;
  }
  const cfg = localAppServer.loadConfig(userDataPath());
  if (!localAppServer.shouldHostLocalServer(cfg)) {
    stopServerPowerSaveBlocker("host_disabled");
    destroyServerTray();
    return;
  }
  const st = localAppServer.getStatus(userDataPath());
  const keepTray = st.sharingActive === true || cfg.userWantsRunning === true;
  if (!keepTray) {
    syncServerPowerSaveBlocker(st);
    destroyServerTray();
    return;
  }
  syncServerPowerSaveBlocker(st);

  const portLabel = st.port != null ? `port ${st.port}` : "running";
  const statusLine = st.sharingActive
    ? `Sharing on for others (${portLabel})`
    : "Starting sharing… (keep PC awake)";

  const template = [
    { label: statusLine, enabled: false },
    { type: "separator" },
    {
      label: "Open Pocket Ledger",
      click: () => {
        void focusOrOpenMainWindow();
      },
    },
  ];
  if (st.sharingActive) {
    template.push({
      label: "Stop sharing (keep app open)",
      click: () => {
        void stopLocalServerAndPersist();
      },
    });
  } else if (cfg.userWantsRunning) {
    template.push({
      label: "Retry start sharing",
      click: () => {
        void startStaticServer()
          .then(() => syncLocalServerTray())
          .catch(() => syncLocalServerTray());
      },
    });
  }
  template.push(
    { type: "separator" },
    {
      label: "Quit Pocket Ledger",
      click: () => {
        void quitPocketLedgerFully("tray_quit");
      },
    }
  );

  const menu = Menu.buildFromTemplate(template);
  const trayIcon = getTrayIconImage();
  if (!trayIcon) {
    plTraceLog.traceLog("PL-MAIN", "tray_icon_missing", { sharingPort: st.sharingPort || st.port });
    return;
  }

  if (!serverTray) {
    serverTray = new Tray(trayIcon);
    serverTray.setToolTip("Pocket Ledger");
    serverTray.on("double-click", () => {
      void focusOrOpenMainWindow();
    });
    plTraceLog.traceLog("PL-MAIN", "tray_created", { sharingPort: st.sharingPort || st.port });
  } else {
    serverTray.setImage(trayIcon);
  }
  serverTray.setContextMenu(menu);
  if (st.port != null) {
    serverTray.setToolTip(`Pocket Ledger — sharing on port ${st.port}`);
  } else if (cfg.userWantsRunning) {
    serverTray.setToolTip("Pocket Ledger — sharing starting…");
  }
}

function notifyServerStillRunningInTray(st) {
  if (!serverTray) return;
  try {
    if (typeof serverTray.displayBalloon === "function") {
      const port = st?.port || st?.sharingPort;
      serverTray.displayBalloon({
        iconType: "info",
        title: "Pocket Ledger server",
        content: port
          ? `Still running on port ${port}. Right-click tray → Quit to stop.`
          : "Still running in tray. Right-click tray → Quit to stop.",
      });
    }
  } catch (_) {}
}

/** Gate → Connect: remote server origin → access token for webRequest header injection. */
const remoteGateAuthByOrigin = new Map();

function isPlServerRequest(urlStr, appUiPort, sharingPort, remoteBase) {
  try {
    const u = new URL(urlStr);
    const h = (u.hostname || "").toLowerCase();
    const reqPort = String(u.port || (u.protocol === "https:" ? "443" : "80"));
    if (remoteGateAuthByOrigin.has(u.origin)) return true;
    const ports = new Set();
    if (appUiPort) ports.add(String(appUiPort));
    if (sharingPort) ports.add(String(sharingPort));
    if (ports.has(reqPort)) {
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
      if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
      // Public WAN IP on sharing port (router port-forward / remote Gate clients).
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
    }
    if (remoteBase) {
      const remote = new URL(remoteBase);
      if (u.origin === remote.origin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function appendRemoteClientFlag(urlStr) {
  try {
    const u = new URL(urlStr);
    u.searchParams.set("pl_remote_client", "1");
    return u.toString();
  } catch {
    const sep = urlStr.includes("?") ? "&" : "?";
    return `${urlStr}${sep}pl_remote_client=1`;
  }
}

/** Pocket Ledger BrowserView — app marker + access token for local/remote server URLs. */
function installPlServerRequestHeaders(session) {
  if (!session?.webRequest) return;
  const legacyToken = localAppServer.getOrCreateClientToken(userDataPath());
  const cfg = localAppServer.loadConfig(userDataPath());
  const remoteBase = localAppServer.normalizeRemoteServerUrl(cfg.remoteServerUrl);
  const accessTok = String(cfg.clientAccessToken || "").trim();
  session.webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    const appUiPort = localAppServer.getAppUiServerPort();
    const sharingPort = localAppServer.getSharingServerPort();
    const headers = { ...details.requestHeaders };
    if (isPlServerRequest(details.url || "", appUiPort, sharingPort, remoteBase)) {
      headers[localAppServer.PL_ELECTRON_MARKER_HEADER] = localAppServer.PL_ELECTRON_MARKER_VALUE;
      headers[localAppServer.PL_CLIENT_HEADER] = legacyToken;
      let gateTok = "";
      try {
        const origin = new URL(details.url || "").origin;
        gateTok = remoteGateAuthByOrigin.get(origin) || "";
      } catch {
        /* ignore */
      }
      const tok = gateTok || accessTok;
      if (tok) {
        headers[localAppServer.PL_ACCESS_HEADER] = tok;
      }
    }
    callback({ requestHeaders: headers });
  });
}

function adjustZoom(targetContents, delta) {
  const currentZoom = targetContents.getZoomFactor();
  const nextZoom = Math.min(3, Math.max(0.25, currentZoom + delta));
  targetContents.setZoomFactor(nextZoom);
}

function getFocusedTabContents(win) {
  const state = windowTabs.get(win.id);
  if (!state || state.activeIndex < 0) return null;
  return state.tabs[state.activeIndex]?.webContents ?? null;
}

/** View → DevTools: BrowserView tab — `detach` alag window me blank page preview chhodta hai; `right` = app + console ek hi window. */
function toggleDevToolsForActiveTab(win) {
  const wc = getFocusedTabContents(win);
  if (!wc || wc.isDestroyed()) return;
  try {
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "right", activate: true });
  } catch (_) {}
}

/** Chrome-style right-click on app tabs — navigation, edit, Inspect Element + DevTools. */
function attachAppContentContextMenu(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.on("context-menu", (_event, params) => {
    const canNavBack = webContents.canGoBack();
    const canNavForward = webContents.canGoForward();
    const canCut = params.isEditable && params.editFlags?.canCut;
    const canCopy =
      Boolean(params.editFlags?.canCopy) ||
      Boolean(params.selectionText && params.selectionText.length > 0) ||
      Boolean(params.linkURL);
    const canPaste = params.isEditable && params.editFlags?.canPaste;
    const canSelectAll = params.isEditable;

    const template = [
      {
        label: "Back",
        enabled: canNavBack,
        click: () => {
          if (canNavBack) webContents.goBack();
        },
      },
      {
        label: "Forward",
        enabled: canNavForward,
        click: () => {
          if (canNavForward) webContents.goForward();
        },
      },
      {
        label: "Reload",
        click: () => webContents.reload(),
      },
      { type: "separator" },
    ];

    if (params.linkURL) {
      template.push(
        {
          label: "Open Link in Browser",
          click: () => {
            shell.openExternal(params.linkURL).catch(() => {});
          },
        },
        { type: "separator" }
      );
    }

    template.push(
      { label: "Cut", enabled: canCut, role: "cut" },
      { label: "Copy", enabled: canCopy, role: "copy" },
      { label: "Paste", enabled: canPaste, role: "paste" },
      { type: "separator" },
      { label: "Select All", enabled: canSelectAll, role: "selectAll" },
      { type: "separator" },
      {
        label: "Inspect",
        click: () => {
          webContents.inspectElement(params.x, params.y);
          if (!webContents.isDevToolsOpened()) {
            webContents.openDevTools({ mode: "right", activate: true });
          }
        },
      }
    );

    Menu.buildFromTemplate(template).popup();
  });
}

/** BrowserView tab reload — native `{ role: "reload" }` galat webContents (khali window) par lagta tha */
function reloadActiveTab(win, ignoreCache) {
  const wc = getFocusedTabContents(win);
  if (!wc || wc.isDestroyed()) return;
  if (ignoreCache) wc.reloadIgnoringCache();
  else wc.reload();
}

/** View menu / IPC: quick-actions ribbon localStorage toggle — renderer `pl-desktop-quick-actions-toggle` sunta hai */
function toggleQuickActionsRibbonInActiveTab(win) {
  const wc = getFocusedTabContents(win);
  if (!wc || wc.isDestroyed()) return;
  const script = `(function(){try{var k='pl-desktop-header-quick-actions-collapsed';if(localStorage.getItem(k)==='1')localStorage.removeItem(k);else localStorage.setItem(k,'1');window.dispatchEvent(new Event('pl-desktop-quick-actions-toggle'));}catch(e){}})();`;
  wc.executeJavaScript(script, true).catch(() => {});
}

/** Tab strip ↻ → active BrowserView: full reload nahi, sirf CustomEvent (React `triggerSync`) */
function dispatchTabStripBackgroundSyncToActiveTab(win) {
  const wc = getFocusedTabContents(win);
  if (!wc || wc.isDestroyed()) return Promise.reject(new Error("no-active-tab"));
  const script = `(function(){try{window.dispatchEvent(new CustomEvent('pocket-ledger-tab-strip-sync'));}catch(e){}})();true`;
  return wc.executeJavaScript(script, true);
}

function notifyTabStripSyncDone(win) {
  const state = windowTabs.get(win.id);
  if (!state?.stripView?.webContents || state.stripView.webContents.isDestroyed()) return;
  try {
    state.stripView.webContents.send("pl-tab-strip-sync-done-ack");
  } catch (_) {}
}

function updateWindowTitle(win) {
  const state = windowTabs.get(win.id);
  const count = state?.tabs.length ?? 0;
  // Merged title bar: OS caption short — tab-strip me sirf draggable strip tooltip (`titleBarLabel` IPC) rakho.
  if (USE_MERGED_TITLEBAR) {
    win.setTitle("Pocket Ledger");
  } else {
    win.setTitle(count > 1 ? `Pocket Ledger (${count} tabs)` : "Pocket Ledger");
  }
}

/** Strip me maximize icon □ / ❐ sync — frameless Win/Linux */
function sendWindowMaxState(win) {
  const state = windowTabs.get(win.id);
  if (!state?.stripView?.webContents || state.stripView.webContents.isDestroyed()) return;
  try {
    state.stripView.webContents.send("window-max-state", { maximized: win.isMaximized() });
  } catch (_) {}
}

function getWindowPrintMode(win) {
  const state = windowTabs.get(win.id);
  return state?.printMode ?? PRINT_MODE_FIT_PAGE;
}

function setWindowPrintMode(win, mode) {
  const state = windowTabs.get(win.id);
  if (!state) return;
  state.printMode = mode;
}

function getPrintScaleFactor(mode) {
  // Electron `print({ scaleFactor })` can be ignored by some OS dialogs; use temporary zoom for reliable effect.
  if (mode === PRINT_MODE_ACTUAL) return 1;
  if (mode === PRINT_MODE_FIT_WIDTH) return 0.9;
  return 0.8; // fit-page default keeps both width + height safer on most A4/Letter previews.
}

/**
 * Electron multi-tab: jo BrowserView baad me `addBrowserView` hota hai wo upar paint hota hai.
 * Tab content ko switch pe baad me add karte hain — strip neeche chala jata hai / dikhta hi nahi.
 * Bounds ke baad strip ko dubara add karke hamesha top par lao taaki alag tab strip dikhe.
 */
function raiseTabStripToTop(win) {
  const state = windowTabs.get(win.id);
  if (!state?.stripView || state.stripView.webContents.isDestroyed()) return;
  try {
    win.removeBrowserView(state.stripView);
    win.addBrowserView(state.stripView);
  } catch (_) {}
}

/** Strip + active tab content dono ka bounds — tab strip upar, app neeche */
function updateBrowserViewBounds(win) {
  const state = windowTabs.get(win.id);
  if (!state || win.isDestroyed()) return;
  const [contentWidth, contentHeight] = win.getContentSize();
  const sh = TAB_STRIP_HEIGHT;
  if (state.stripView && !state.stripView.webContents.isDestroyed()) {
    state.stripView.setBounds({ x: 0, y: 0, width: contentWidth, height: sh });
  }
  if (state.activeIndex >= 0 && state.tabs[state.activeIndex]) {
    const activeView = state.tabs[state.activeIndex];
    if (!activeView.webContents.isDestroyed()) {
      const innerH = Math.max(0, contentHeight - sh);
      activeView.setBounds({ x: 0, y: sh, width: contentWidth, height: innerH });
    }
  }
  tabSnapshotRecovery.updateSnapshotOverlayBounds(win, { tabStripHeight: sh });
  raiseTabStripToTop(win);
}

/** IPC sender → BrowserWindow (strip = BrowserView webContents; direct `fromWebContents` aksar null). */
function windowFromStripSender(sender) {
  let w = BrowserWindow.fromWebContents(sender);
  if (w) return w;
  try {
    const sid = sender?.id;
    if (sid == null) return null;
    for (const cand of BrowserWindow.getAllWindows()) {
      const state = windowTabs.get(cand.id);
      if (state?.stripView?.webContents?.id === sid) return cand;
    }
  } catch (_) {}
  return null;
}

/** + tab / switch: kabhi strip IPC window resolve na kare (focus page par hai) — focused ya single window fallback */
function resolveWindowForTabStripIpc(sender) {
  const direct = windowFromStripSender(sender);
  if (direct && !direct.isDestroyed()) return direct;
  const fw = BrowserWindow.getFocusedWindow();
  if (fw && !fw.isDestroyed()) return fw;
  const all = BrowserWindow.getAllWindows().filter((b) => !b.isDestroyed());
  if (all.length === 1) return all[0];
  return null;
}

/** Tab titles / active state + tooltip string (merged strip `#dragFill` title + optional future use) → strip UI */
function formatTabUrlLabel(webContents) {
  if (!webContents || webContents.isDestroyed()) return "";
  try {
    const raw = webContents.getURL();
    if (!raw || raw.startsWith("devtools://")) return "";
    const u = new URL(raw);
    const host = u.hostname === "127.0.0.1" ? "localhost" : u.hostname;
    const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
    if (!port || port === "80" || port === "443") return host;
    return `${host}:${port}`;
  } catch (_) {
    return "";
  }
}

function pushTabStripState(win) {
  const state = windowTabs.get(win.id);
  if (!state?.stripView?.webContents || state.stripView.webContents.isDestroyed()) return;
  const tabs = state.tabs.map((view, index) => ({
    title: view.webContents.getTitle() || `Tab ${index + 1}`,
    urlLabel: formatTabUrlLabel(view.webContents),
    index,
    active: index === state.activeIndex,
  }));
  const n = tabs.length;
  const activeUrlLabel = tabs[state.activeIndex]?.urlLabel || "";
  let titleBarLabel = n > 1 ? `Pocket Ledger (${n} tabs)` : "Pocket Ledger";
  if (activeUrlLabel) titleBarLabel = `${titleBarLabel} — ${activeUrlLabel}`;
  try {
    state.stripView.webContents.send("tabs-update", { tabs, titleBarLabel, activeUrlLabel });
  } catch (_) {}
}

async function createTabStrip(win) {
  const state = windowTabs.get(win.id);
  if (!state || state.stripView) return;
  const stripView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "tab-strip-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  state.stripView = stripView;
  await stripView.webContents.loadFile(path.join(__dirname, "tab-strip.html"));
  win.addBrowserView(stripView);
  stripView.webContents.on("did-finish-load", () => pushTabStripState(win));
}

function switchToTab(win, index) {
  const state = windowTabs.get(win.id);
  if (!state || state.tabs.length === 0) return;
  if (index < 0 || index >= state.tabs.length) return;

  const prevIndex = state.activeIndex;
  const prev = prevIndex >= 0 ? state.tabs[prevIndex] : null;
  state.activeIndex = index;
  const next = state.tabs[index];

  if (prev && prev !== next) {
    try {
      win.removeBrowserView(prev);
    } catch (_) {}
  }
  tabSnapshotRecovery.hideOnTabSwitch(win);
  try {
    win.addBrowserView(next);
  } catch (_) {}

  updateBrowserViewBounds(win);
  updateWindowTitle(win);
  pushTabStripState(win);
}

/** Kisi bhi index ki tab band — Chrome jaisa active / neighbour logic */
function closeTabAt(win, closeIndex) {
  const state = windowTabs.get(win.id);
  if (!state || closeIndex < 0 || closeIndex >= state.tabs.length) return;

  const oldActive = state.activeIndex;
  const removed = state.tabs[closeIndex];
  try {
    win.removeBrowserView(removed);
  } catch (_) {}
  if (removed?.webContents && !removed.webContents.isDestroyed()) {
    removed.webContents.destroy();
  }
  state.tabs.splice(closeIndex, 1);

  if (state.tabs.length === 0) {
    win.close();
    return;
  }

  let nextIndex;
  if (oldActive === closeIndex) {
    nextIndex = Math.min(closeIndex, state.tabs.length - 1);
  } else if (closeIndex < oldActive) {
    nextIndex = oldActive - 1;
  } else {
    nextIndex = oldActive;
  }
  switchToTab(win, nextIndex);
}

function closeCurrentTab(win) {
  const state = windowTabs.get(win.id);
  if (!state || state.tabs.length === 0) {
    win.close();
    return;
  }
  closeTabAt(win, state.activeIndex);
}

function nextTab(win) {
  const state = windowTabs.get(win.id);
  if (!state || state.tabs.length <= 1) return;
  const nextIndex = (state.activeIndex + 1) % state.tabs.length;
  switchToTab(win, nextIndex);
}

function previousTab(win) {
  const state = windowTabs.get(win.id);
  if (!state || state.tabs.length <= 1) return;
  const prevIndex = (state.activeIndex - 1 + state.tabs.length) % state.tabs.length;
  switchToTab(win, prevIndex);
}

const { DEV_WEB_PORT_START } = require("./plWebPorts.cjs");

function readDevWebPort() {
  const fromEnv = Number(process.env.PL_DEV_WEB_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const f = path.join(__dirname, "..", ".pl-dev-web-port.json");
    const n = Number(JSON.parse(fs.readFileSync(f, "utf8")).port);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_) {}
  return DEV_WEB_PORT_START;
}

async function getAppEntryUrl() {
  // Dev Next (`npm run dev`) — 4500–4599; packaged EXE static server — 3000–3099.
  if (isDevMode()) return `http://localhost:${readDevWebPort()}`;
  const cfg = localAppServer.loadConfig(userDataPath());
  if (localAppServer.shouldUseRemoteEntry(cfg)) {
    const remote = localAppServer.normalizeRemoteServerUrl(cfg.remoteServerUrl);
    if (!remote) {
      throw new Error("PL_REMOTE_SERVER_URL_MISSING");
    }
    return appendRemoteClientFlag(remote);
  }
  const port = await ensureAppUiStaticServer();
  // Packaged app route loading must be HTTP to avoid file:// local-resource blocking.
  return `http://localhost:${port}/`;
}

async function reloadAllAppBrowserViews() {
  const entryUrl = await getAppEntryUrl();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const state = windowTabs.get(win.id);
    if (!state) continue;
    for (const view of state.tabs) {
      if (!view.webContents || view.webContents.isDestroyed()) continue;
      try {
        await view.webContents.loadURL(entryUrl);
      } catch (_) {
        /* tab may be mid-navigation */
      }
    }
  }
}

/** After port change: keep the same route (e.g. /dashboard) instead of sending users back to login "/". */
async function reloadAllAppBrowserViewsPreservePath(port) {
  const newBase = `http://localhost:${port}`;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const state = windowTabs.get(win.id);
    if (!state) continue;
    for (const view of state.tabs) {
      if (!view.webContents || view.webContents.isDestroyed()) continue;
      let target = `${newBase}/`;
      try {
        const cur = view.webContents.getURL();
        if (cur && !cur.startsWith("devtools://")) {
          const u = new URL(cur);
          if (
            u.protocol === "http:" &&
            (u.hostname === "127.0.0.1" || u.hostname === "localhost")
          ) {
            target = `${newBase}${u.pathname}${u.search}${u.hash}`;
          }
        }
      } catch (_) {
        /* ignore malformed URL */
      }
      try {
        await view.webContents.loadURL(target);
      } catch (_) {
        /* tab may be mid-navigation */
      }
    }
  }
}

function createElectronTabInstanceId() {
  try {
    return `pl_tab_${require("crypto").randomUUID()}`;
  } catch (_) {
    return `pl_tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function openNewTab(win, loadUrl) {
  const entryUrl = loadUrl || (await getAppEntryUrl());
  const tabInstanceId = createElectronTabInstanceId();
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "app-content-preload.js"),
      /** Per-tab id — EXE BrowserViews share sessionStorage; renderer reads via preload. */
      additionalArguments: [`--pl-tab-instance-id=${tabInstanceId}`],
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: true,
    },
  });
  view.plTabInstanceId = tabInstanceId;
  installPlServerRequestHeaders(view.webContents.session);
  attachAppContentContextMenu(view.webContents);

  // Normalize zoom shortcuts for different keyboard layouts in each tab webContents.
  view.webContents.on("before-input-event", (event, input) => {
    if (!input.control) return;
    if (input.key === "-" || input.code === "Minus") {
      event.preventDefault();
      adjustZoom(view.webContents, -0.1);
      updateBrowserViewBounds(win);
      return;
    }
    if (
      input.key === "+" ||
      input.key === "=" ||
      input.code === "Equal" ||
      input.code === "NumpadAdd"
    ) {
      event.preventDefault();
      adjustZoom(view.webContents, 0.1);
      updateBrowserViewBounds(win);
      return;
    }
    if (input.key === "0" || input.code === "Digit0" || input.code === "Numpad0") {
      event.preventDefault();
      view.webContents.setZoomFactor(1);
      updateBrowserViewBounds(win);
    }
  });

  view.webContents.on("page-title-updated", () => pushTabStripState(win));
  view.webContents.on("did-finish-load", () => pushTabStripState(win));
  view.webContents.on("did-navigate", () => pushTabStripState(win));
  view.webContents.on("did-navigate-in-page", () => pushTabStripState(win));
  view.webContents.on("devtools-opened", () => updateBrowserViewBounds(win));
  view.webContents.on("devtools-closed", () => updateBrowserViewBounds(win));

  const state = windowTabs.get(win.id);
  if (!state) return;
  state.tabs.push(view);
  tabSnapshotRecovery.attachTabSnapshotRecovery(win, view, { isPackaged: app.isPackaged });
  switchToTab(win, state.tabs.length - 1);
  try {
    await view.webContents.loadURL(entryUrl);
    plTraceLog.traceLog("PL-TAB", "opened", { url: entryUrl });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("PL_REMOTE_SERVER_URL_MISSING")) {
      dialog.showErrorBox(
        "Pocket Ledger",
        "Client mode: enter Server address in Settings → Server, save, then restart the app."
      );
    } else {
      throw e;
    }
  }
}

function printCurrentTab(win) {
  const target = getFocusedTabContents(win);
  if (!target) return;
  const mode = getWindowPrintMode(win);
  const temporaryZoomFactor = getPrintScaleFactor(mode);
  const originalZoomFactor = target.getZoomFactor();
  // Apply selected print mode before opening native dialog, then restore zoom regardless of outcome.
  target.setZoomFactor(temporaryZoomFactor);
  target.print(
    {
      silent: false,
      printBackground: true,
    },
    () => {
      target.setZoomFactor(originalZoomFactor);
    }
  );
}

function buildAppMenu() {
  const template = [
    // Menubar par "Refresh" hamesha dikhe — active BrowserView par reload (multi-tab); Ctrl+R yahi se
    {
      label: "Refresh",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: (_item, focusedWindow) => {
            const win = focusedWindow ?? BrowserWindow.getFocusedWindow();
            if (win) reloadActiveTab(win, false);
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: (_item, focusedWindow) => {
            const win = focusedWindow ?? BrowserWindow.getFocusedWindow();
            if (win) reloadActiveTab(win, true);
          },
        },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) await openNewTab(win);
          },
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: async () => {
            await createWindow();
          },
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) closeCurrentTab(win);
          },
        },
        { type: "separator" },
        {
          label: "Print",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) printCurrentTab(win);
          },
        },
        {
          label: "Print Scale",
          submenu: [
            {
              label: "Actual Size",
              type: "radio",
              checked: false,
              click: () => {
                const win = BrowserWindow.getFocusedWindow();
                if (win) setWindowPrintMode(win, PRINT_MODE_ACTUAL);
              },
            },
            {
              label: "Fit to Width",
              type: "radio",
              checked: false,
              click: () => {
                const win = BrowserWindow.getFocusedWindow();
                if (win) setWindowPrintMode(win, PRINT_MODE_FIT_WIDTH);
              },
            },
            {
              label: "Fit to Page",
              type: "radio",
              checked: true,
              click: () => {
                const win = BrowserWindow.getFocusedWindow();
                if (win) setWindowPrintMode(win, PRINT_MODE_FIT_PAGE);
              },
            },
          ],
        },
      ],
    },
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle quick actions ribbon",
          accelerator: "CmdOrCtrl+Shift+H",
          click: (_item, focusedWindow) => {
            const win = focusedWindow ?? BrowserWindow.getFocusedWindow();
            if (win) toggleQuickActionsRibbonInActiveTab(win);
          },
        },
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: (_item, focusedWindow) => {
            const win = focusedWindow ?? BrowserWindow.getFocusedWindow();
            if (win) toggleDevToolsForActiveTab(win);
          },
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        {
          label: "Next Tab",
          accelerator: "CmdOrCtrl+Tab",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) nextTab(win);
          },
        },
        {
          label: "Previous Tab",
          accelerator: "CmdOrCtrl+Shift+Tab",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) previousTab(win);
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        {
          label: "Next Tab",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) nextTab(win);
          },
        },
        {
          label: "Previous Tab",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) previousTab(win);
          },
        },
        { type: "separator" },
        { role: "minimize" },
        { role: "close" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Multi-tab shortcuts…",
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            await dialog.showMessageBox(win ?? undefined, {
              type: "info",
              title: "Pocket Ledger — Tabs",
              message: USE_MERGED_TITLEBAR
                ? "Title + tabs ek hi upari row me hain (☰ = menu, Alt bhi). Window buttons dahine."
                : "Dark tab strip menu bar ke turant neeche.",
              detail:
                "Ctrl+T — New tab\nCtrl+W — Close tab\nCtrl+Tab — Next tab\nCtrl+Shift+Tab — Previous tab\n\n" +
                (USE_MERGED_TITLEBAR ? "Alt — menu bar dikhao/j chhupao.\n\n" : "") +
                "File → New Tab / View → Next Tab.",
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: getWindowIcon(),
    frame: !USE_MERGED_TITLEBAR,
    autoHideMenuBar: USE_MERGED_TITLEBAR,
  });
  if (USE_MERGED_TITLEBAR) {
    win.setMenuBarVisibility(false);
  }
  // Initialize per-window tab state; each window manages its own tab stack (+ stripView baad me).
  windowTabs.set(win.id, { tabs: [], activeIndex: -1, printMode: PRINT_MODE_FIT_PAGE, stripView: null });
  tabSnapshotRecovery.initWindowSnapshotRecovery(win, {
    isPackaged: app.isPackaged,
    tabStripHeight: TAB_STRIP_HEIGHT,
    getState: () => windowTabs.get(win.id),
    raiseTabStrip: raiseTabStripToTop,
  });
  // Sync BrowserView bounds across all desktop window state changes.
  win.on("resize", () => updateBrowserViewBounds(win));
  win.on("maximize", () => {
    updateBrowserViewBounds(win);
    sendWindowMaxState(win);
  });
  win.on("unmaximize", () => {
    updateBrowserViewBounds(win);
    sendWindowMaxState(win);
  });
  win.on("enter-full-screen", () => updateBrowserViewBounds(win));
  win.on("leave-full-screen", () => updateBrowserViewBounds(win));
  win.on("show", () => {
    updateBrowserViewBounds(win);
    syncLocalServerTray();
    notifyLiveSyncResume("window_show", win);
    tabSnapshotRecovery.onWindowForeground(win, "window_show");
  });
  win.on("focus", () => {
    notifyLiveSyncResume("window_focus", win);
    tabSnapshotRecovery.onWindowForeground(win, "window_focus");
  });
  win.on("restore", () => {
    notifyLiveSyncResume("window_restore", win);
    tabSnapshotRecovery.onWindowForeground(win, "window_restore");
  });
  win.on("blur", () => {
    const state = windowTabs.get(win.id);
    if (!state || state.activeIndex < 0) return;
    const view = state.tabs[state.activeIndex];
    if (view) void tabSnapshotRecovery.captureTabSnapshot(view);
  });
  attachPackagedCloseToTrayBehavior(win);
  win.on("closed", () => {
    tabSnapshotRecovery.disposeWindowSnapshotRecovery(win);
    const state = windowTabs.get(win.id);
    if (state) {
      if (state.stripView?.webContents && !state.stripView.webContents.isDestroyed()) {
        state.stripView.webContents.destroy();
      }
      for (const tab of state.tabs) {
        if (!tab.webContents.isDestroyed()) tab.webContents.destroy();
      }
    }
    windowTabs.delete(win.id);
  });
  await createTabStrip(win);
  await openNewTab(win);
  sendWindowMaxState(win);
}

function notifyLiveSyncResume(reason, targetWindow) {
  const windows = targetWindow ? [targetWindow] : BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    const state = windowTabs.get(win.id);
    if (!state) continue;
    const activeIndex = state.activeIndex;
    for (let i = 0; i < state.tabs.length; i++) {
      const tab = state.tabs[i];
      if (!tab?.webContents || tab.webContents.isDestroyed()) continue;
      try {
        tab.webContents.send("pl-live-sync-resume", { reason: String(reason || "resume") });
      } catch (_) {}
      if (i === activeIndex) {
        try {
          tab.webContents.focus();
        } catch (_) {}
      }
    }
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    plTraceLog.initPlTraceLog(userDataPath());
    plTraceLog.traceLog("PL-MAIN", "app_ready", {
      packaged: app.isPackaged,
      platform: process.platform,
    });
  getAppBootSessionId();

  if (app.isPackaged) {
    try {
      const upgradeResult = await appUpgradeCache.runPackagedUpgradeCacheRefresh({
        app,
        session: session.defaultSession,
        userDataPath: userDataPath(),
      });
      if (upgradeResult?.upgraded) {
        console.info("[main] packaged app upgraded — caches cleared", {
          from: upgradeResult.previousVersion || "(none)",
          to: upgradeResult.version,
        });
        app.__plDidPackagedUpgrade = true;
      }
    } catch (e) {
      console.warn("[main] packaged upgrade cache refresh failed", e?.message || e);
    }
  }

  ipcMain.on("pl-get-app-boot-session-id", (event) => {
    event.returnValue = getAppBootSessionId();
  });

  ipcMain.on("pl-set-remote-gate-auth", (event, payload) => {
    try {
      const serverUrl = String(payload?.serverUrl || "").trim();
      const accessToken = String(payload?.accessToken || "").trim();
      const normalized = localAppServer.normalizeRemoteServerUrl(serverUrl);
      if (!normalized) {
        event.returnValue = { ok: false };
        return;
      }
      const origin = new URL(normalized).origin;
      if (accessToken) remoteGateAuthByOrigin.set(origin, accessToken);
      else remoteGateAuthByOrigin.delete(origin);
      plTraceLog.traceLog("PL-GATE-TRACE", "set_remote_gate_auth", {
        origin,
        hasToken: Boolean(accessToken),
      });
      event.returnValue = { ok: true, origin };
    } catch {
      event.returnValue = { ok: false };
    }
  });

  const bootCfg = localAppServer.loadConfig(userDataPath());
  localAppServer.applyLoginItemSettings(app, bootCfg.autoStartOnBoot);
  powerMonitor.on("resume", () => {
    plTraceLog.traceLog("PL-MAIN", "system_resume_live_sync");
    void ensureHostSharingRunningAfterLaunch().catch(() => undefined);
    try {
      // Only host/server mode needs the hidden bridge window; skip it for plain desktop users.
      if (localAppServer.loadConfig(userDataPath()).userWantsRunning) {
        void ensureServerDataBridgeWindow().catch(() => undefined);
      }
    } catch (_) {
      /* ignore config read errors */
    }
    notifyLiveSyncResume("system_resume");
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) tabSnapshotRecovery.onWindowForeground(w, "system_resume");
    }
  });

  ipcMain.handle("pl-google-auth-external", async (_event, options) => {
    return googleAuthExternal.signInWithGoogleExternal(shell, options || {});
  });

  ipcMain.handle("pl-bridge-authoritative-company-doc-upsert", async (_event, payload) => {
    if (IS_PHASE1B_RUNTIME_VERIFY) phase1bVerifyStats.bridgeIpc += 1;
    return executeHostBridgeAuthoritativeCompanyDocUpsert(payload);
  });

  ipcMain.handle("pl-local-server-get-status", async () => {
    return localAppServer.getStatus(userDataPath());
  });

  ipcMain.handle("pl-local-server-get-config", async () => {
    return localAppServer.loadConfig(userDataPath());
  });

  ipcMain.handle("pl-local-server-set-config", async (_event, partial) => {
    const next = localAppServer.saveConfig(userDataPath(), partial || {});
    if (typeof partial?.autoStartOnBoot === "boolean") {
      localAppServer.applyLoginItemSettings(app, next.autoStartOnBoot);
    }
    return next;
  });

  ipcMain.handle("pl-local-server-start", async () => {
    const cfg = localAppServer.loadConfig(userDataPath());
    if (!localAppServer.shouldHostLocalServer(cfg)) {
      return { ok: false, error: "client-only", status: localAppServer.getStatus(userDataPath()) };
    }
    const port = await startSharedLocalServer();
    syncLocalServerTray();
    return { ok: true, port, status: localAppServer.getStatus(userDataPath()) };
  });

  ipcMain.handle("pl-local-server-stop", async () => {
    await stopLocalServerAndPersist();
    return { ok: true, status: localAppServer.getStatus(userDataPath()) };
  });

  ipcMain.handle("pl-local-server-restart", async (_event, partial) => {
    const appUiPortBefore = localAppServer.getAppUiServerPort();
    if (partial && typeof partial === "object") {
      localAppServer.saveConfig(userDataPath(), partial);
      if (typeof partial.autoStartOnBoot === "boolean") {
        localAppServer.applyLoginItemSettings(app, partial.autoStartOnBoot);
      }
    }
    const cfg = localAppServer.loadConfig(userDataPath());
    if (!localAppServer.shouldHostLocalServer(cfg)) {
      await localAppServer.stopSharingServer();
      syncLocalServerTray();
      return { ok: true, port: null, status: localAppServer.getStatus(userDataPath()) };
    }

    let appUiPort = appUiPortBefore;
    try {
      appUiPort = await localAppServer.startStaticServer(userDataPath(), { forAppUi: true });
    } catch (_) {
      /* client-only role */
    }

    let sharingPort = null;
    if (cfg.userWantsRunning) {
      try {
        sharingPort = await localAppServer.restartSharingServer(userDataPath());
        void ensureServerDataBridgeWindow().catch(() => {});
      } catch (_) {
        /* sharing bind failed */
      }
    } else {
      await localAppServer.stopSharingServer();
    }

    syncLocalServerTray();
    if (app.isPackaged && appUiPortBefore && appUiPort && appUiPortBefore !== appUiPort) {
      void reloadAllAppBrowserViewsPreservePath(appUiPort);
    }
    return {
      ok: true,
      port: sharingPort || appUiPort,
      appUiPort,
      status: localAppServer.getStatus(userDataPath()),
    };
  });

  ipcMain.handle("pl-local-server-list-access-tokens", async () => {
    return localAppServer.accessTokens.listAccessTokens(userDataPath());
  });

  ipcMain.handle("pl-local-server-create-access-token", async (_event, input) => {
    return localAppServer.accessTokens.createAccessToken(userDataPath(), input || {});
  });

  ipcMain.handle("pl-local-server-update-access-token", async (_event, payload) => {
    const id = String(payload?.id || "");
    const updated = localAppServer.accessTokens.updateAccessToken(userDataPath(), id, payload?.input || {});
    if (!updated) return { ok: false };
    return { ok: true, token: updated };
  });

  ipcMain.handle("pl-local-server-get-access-token-secret", async (_event, id) => {
    const secret = localAppServer.accessTokens.getAccessTokenSecret(userDataPath(), String(id || ""));
    if (!secret) return { ok: false };
    return { ok: true, ...secret };
  });

  ipcMain.handle("pl-local-server-rotate-access-token", async (_event, payload) => {
    const id = String(payload?.id || "");
    const rotated = localAppServer.accessTokens.rotateAccessToken(
      userDataPath(),
      id,
      payload?.input || {}
    );
    if (!rotated) return { ok: false };
    return { ok: true, ...rotated };
  });

  ipcMain.handle("pl-local-server-revoke-access-token", async (_event, id) => {
    const ok = localAppServer.accessTokens.revokeAccessToken(userDataPath(), String(id || ""));
    return { ok };
  });

  ipcMain.handle("pl-local-server-save-shareable-snapshot", async (_event, companies) => {
    const rows = saveShareableCompaniesSnapshot(Array.isArray(companies) ? companies : []);
    return { ok: true, count: rows.length };
  });

  ipcMain.handle("window-chrome-action", async (event, action) => {
    const win =
      resolveWindowForTabStripIpc(event.sender) || BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "no-window" };
    try {
      if (action === "minimize") win.minimize();
      else if (action === "maximize-toggle") {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        sendWindowMaxState(win);
      } else if (action === "close") win.close();
      else return { ok: false, error: "bad-action" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("show-app-menu", async (event) => {
    const win =
      resolveWindowForTabStripIpc(event.sender) || BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.getApplicationMenu();
    if (!menu || !win || win.isDestroyed()) return { ok: false };
    try {
      menu.popup({ window: win });
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  });

  ipcMain.handle("tab-strip-action", async (event, msg) => {
    const win = resolveWindowForTabStripIpc(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "no-window" };
    try {
      if (msg?.action === "switch" && typeof msg.index === "number") {
        switchToTab(win, msg.index);
        return { ok: true };
      }
      if (msg?.action === "new") {
        await openNewTab(win);
        return { ok: true };
      }
      if (msg?.action === "close" && typeof msg.index === "number") {
        closeTabAt(win, msg.index);
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
    return { ok: false, error: "bad-action" };
  });

  /** Tab strip ↻ — same as menu Refresh → Reload (Ctrl+R). */
  ipcMain.handle("pl-reload-active-tab", async (event) => {
    const win = resolveWindowForTabStripIpc(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "no-window" };
    try {
      reloadActiveTab(win, false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("pl-open-url-in-new-tab", async (event, payload) => {
    const url = String(payload?.url || "").trim();
    if (!url) return { ok: false, error: "missing-url" };
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: "no-window" };
    try {
      plTraceLog.traceLog("PL-GATE-TRACE", "open_gate_new_tab", { url });
      await openNewTab(win, url);
      return { ok: true };
    } catch (e) {
      plTraceLog.traceLog("PL-GATE-TRACE", "open_gate_new_tab_failed", { url, error: String(e?.message || e) });
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.on("pl-trace-log-client", (_event, payload) => {
    plTraceLog.traceLog(payload?.tag || "PL-CLIENT", payload?.event || "log", payload?.detail);
  });

  ipcMain.on("pl-gate-store-snapshot", (_event, snapshot) => {
    void broadcastGateStoreSnapshot(snapshot);
  });

  ipcMain.on("pl-browser-db-collection-bump", (_event, payload) => {
    const companyId = String(payload?.companyId || "").trim();
    const collection = String(payload?.collection || "").trim();
    if (!companyId || !collection) return;
    const source = String(payload?.source || "local_write");
    const immediate = payload?.immediate !== false;
    plTraceLog.traceLog("PL-LIVE-CHANGE", "ipc_browser_db_bump", { companyId, collection, source, immediate });
    void broadcastBrowserDbCollectionBump(companyId, collection, { source, immediate });
  });

  ipcMain.handle("pl-trace-get-logs", async (_event, limit) => {
    return plTraceLog.getRecentTraceLogs(limit);
  });

  ipcMain.handle("pl-trace-get-log-file-path", async () => {
    return plTraceLog.getTraceLogFilePath();
  });

  /**
   * Sync device list / Firestore `deviceLabel`: WebView UA sirf "Chrome (Windows)" deta hai —
   * APK jaisa PC naam + OS string (hostname + platform release) main se.
   */
  ipcMain.handle("pl-device-display-info", async () => {
    try {
      const hostname = String(os.hostname() || "").trim() || "PC";
      const platform = os.platform();
      const release = String(os.release() || "").trim();
      let osHuman = platform;
      if (platform === "win32") osHuman = "Windows";
      else if (platform === "darwin") osHuman = "macOS";
      else if (platform === "linux") osHuman = "Linux";
      const part = release ? `${osHuman} ${release}` : osHuman;
      return `${hostname} (${part})`.replace(/\s+/g, " ").trim();
    } catch (_) {
      return "";
    }
  });

  ipcMain.handle("pl-release-update-download-install", async (event, payload) => {
    try {
      if (!app.isPackaged) {
        return { ok: false, error: "Updates install only from the packaged EXE." };
      }
      const url = String(payload?.url || "").trim();
      const version = String(payload?.version || "").trim();
      const sender = event.sender;
      await desktopReleaseUpdate.downloadAndInstallRelease({
        app,
        userDataPath: userDataPath(),
        url,
        version,
        onProgress: (progress) => {
          try {
            sender.send("pl-release-update-progress", progress);
          } catch (_) {}
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Backup folder picker — full OS path for UI (File System Access sirf folder name deta hai). */
  ipcMain.handle("pl-pick-backup-directory", async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: false, cancelled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  function safeAttachmentRelativePath(relRaw) {
    const rel = String(relRaw || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!rel || rel.includes("..")) return null;
    return rel;
  }

  function attachmentsRootDir() {
    return path.join(userDataPath(), "PocketLedgerData");
  }

  function legacyAttachmentsRootDir() {
    return path.join(userDataPath(), "pl-attachments");
  }

  function attachmentFullPathForRead(rel) {
    const primary = path.join(attachmentsRootDir(), rel);
    if (fs.existsSync(primary)) return primary;
    return path.join(legacyAttachmentsRootDir(), rel);
  }

  /** APK jaisa offline cache / pending files — disk par bytes, renderer SQLite me path. */
  ipcMain.handle("pl-attachment-write", async (_event, payload) => {
    try {
      const rel = safeAttachmentRelativePath(payload?.relativePath);
      const base64 = String(payload?.base64 || "");
      if (!rel || !base64) return { ok: false, error: "missing-args" };
      const full = path.join(attachmentsRootDir(), rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from(base64, "base64"));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Large JPG/PDF — base64 IPC overhead avoid; `pl-attachments` folder yahi se banta hai. */
  ipcMain.handle("pl-attachment-write-binary", async (_event, payload) => {
    try {
      const rel = safeAttachmentRelativePath(payload?.relativePath);
      const raw = payload?.buffer;
      if (!rel || raw == null) return { ok: false, error: "missing-args" };
      let buf;
      if (Buffer.isBuffer(raw)) buf = raw;
      else if (raw instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(raw));
      else if (ArrayBuffer.isView(raw)) buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      else if (raw && typeof raw === "object" && raw.type === "Buffer" && Array.isArray(raw.data)) {
        buf = Buffer.from(raw.data);
      } else {
        buf = Buffer.from(raw);
      }
      if (!buf.length) return { ok: false, error: "empty-buffer" };
      const full = path.join(attachmentsRootDir(), rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, buf);
      return { ok: true, bytes: buf.length };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("pl-attachment-read", async (_event, payload) => {
    try {
      const rel = safeAttachmentRelativePath(payload?.relativePath);
      if (!rel) return { ok: false, error: "missing-path" };
      const full = attachmentFullPathForRead(rel);
      if (!fs.existsSync(full)) return { ok: false, error: "not-found" };
      const buf = fs.readFileSync(full);
      return { ok: true, base64: buf.toString("base64") };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Large restored JPG/PDF — base64 IPC overhead avoid on read (write-binary jaisa). */
  ipcMain.handle("pl-attachment-read-binary", async (_event, payload) => {
    try {
      const rel = safeAttachmentRelativePath(payload?.relativePath);
      if (!rel) return { ok: false, error: "missing-path" };
      const full = attachmentFullPathForRead(rel);
      if (!fs.existsSync(full)) return { ok: false, error: "not-found" };
      const buf = fs.readFileSync(full);
      if (!buf.length) return { ok: false, error: "empty-file" };
      return { ok: true, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("pl-attachment-delete", async (_event, relRaw) => {
    try {
      const rel = safeAttachmentRelativePath(relRaw);
      if (!rel) return { ok: false, error: "missing-path" };
      const full = path.join(attachmentsRootDir(), rel);
      const legacyFull = path.join(legacyAttachmentsRootDir(), rel);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      if (legacyFull !== full && fs.existsSync(legacyFull)) fs.unlinkSync(legacyFull);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Batch real on-disk size (fs.stat, no file read) - Settings "Log of online trigger" Files size.
   * Paths restricted to the app attachments folders via safeAttachmentRelativePath; max 1000 per call. */
  ipcMain.handle("pl-attachment-stat-sizes", async (_event, relList) => {
    try {
      const list = Array.isArray(relList) ? relList.slice(0, 1000) : [];
      const sizes = await Promise.all(
        list.map(async (relRaw) => {
          const rel = safeAttachmentRelativePath(relRaw);
          if (!rel) return null;
          for (const full of [path.join(attachmentsRootDir(), rel), path.join(legacyAttachmentsRootDir(), rel)]) {
            try {
              const st = await fs.promises.stat(full);
              if (st.isFile()) return st.size;
            } catch {
              /* try next */
            }
          }
          return null;
        })
      );
      return { ok: true, sizes };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("pl-attachment-exists", async (_event, relRaw) => {
    try {
      const rel = safeAttachmentRelativePath(relRaw);
      if (!rel) return { ok: false, exists: false };
      const full = path.join(attachmentsRootDir(), rel);
      const legacyFull = path.join(legacyAttachmentsRootDir(), rel);
      return { ok: true, exists: fs.existsSync(full) || fs.existsSync(legacyFull) };
    } catch (e) {
      return { ok: false, exists: false, error: String(e?.message || e) };
    }
  });

  /** Backup .plbp write — renderer se base64; path join main process me safe. */
  ipcMain.handle("pl-write-backup-file", async (_event, payload) => {
    try {
      const dirPath = String(payload?.dirPath || "").trim();
      const fileName = path.basename(String(payload?.fileName || "backup.plbp"));
      const base64 = String(payload?.base64 || "");
      const relativeSubdir = String(payload?.relativeSubdir || "")
        .trim()
        .replace(/\\/g, "/");
      if (!dirPath || !fileName || !base64) return { ok: false, error: "missing-args" };
      let targetDir = dirPath;
      if (relativeSubdir) {
        targetDir = path.join(dirPath, ...relativeSubdir.split("/").filter(Boolean));
      }
      fs.mkdirSync(targetDir, { recursive: true });
      const buf = Buffer.from(base64, "base64");
      fs.writeFileSync(path.join(targetDir, fileName), buf);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Incremental backup: folder me `.plbp` names list — nested `{company}/{year}/{MonthName}/{day}/` included. */
  ipcMain.handle("pl-list-backup-files", async (_event, dirPathRaw) => {
    try {
      const dirPath = String(dirPathRaw || "").trim();
      if (!dirPath) return { ok: false, error: "missing-dir" };
      const files = [];
      const walk = (current, prefix = "") => {
        for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          const full = path.join(current, ent.name);
          if (ent.isDirectory()) {
            walk(full, rel);
          } else if (ent.isFile() && String(ent.name).toLowerCase().endsWith(".plbp")) {
            files.push({ name: ent.name, relativePath: rel.replace(/\\/g, "/") });
          }
        }
      };
      walk(dirPath);
      files.sort((a, b) => String(b.relativePath).localeCompare(String(a.relativePath)));
      return { ok: true, files };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /** Incremental backup: encrypted `.plbp` text read — company password renderer me decrypt karega.
   * `fileName` nested relative path allow: `Company/2026-07-27/file.plbp`
   */
  ipcMain.handle("pl-read-backup-file", async (_event, payload) => {
    try {
      const dirPath = String(payload?.dirPath || "").trim();
      const rawName = String(payload?.fileName || "").replace(/\\/g, "/").trim();
      if (!dirPath || !rawName) return { ok: false, error: "missing-args" };
      const segments = rawName.split("/").filter(Boolean);
      if (segments.some((s) => s === ".." || s === ".")) {
        return { ok: false, error: "invalid-path" };
      }
      const full = path.join(dirPath, ...segments);
      const rootResolved = path.resolve(dirPath);
      const fullResolved = path.resolve(full);
      if (
        fullResolved !== rootResolved &&
        !fullResolved.startsWith(rootResolved + path.sep)
      ) {
        return { ok: false, error: "invalid-path" };
      }
      if (payload?.asBinary) {
        const buf = fs.readFileSync(fullResolved);
        return { ok: true, base64: buf.toString("base64") };
      }
      const text = fs.readFileSync(fullResolved, "utf8");
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.on("pl-tab-strip-sync-done-from-app", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    notifyTabStripSyncDone(win);
  });

  buildAppMenu();

  if (IS_PLSERVER_COMPANY_AUDIT) {
    const { runPlServerCompanyDetectionAudit } = require("./plServerCompanyDetectionAudit");
    try {
      await runPlServerCompanyDetectionAudit({
        appRoot: __dirname,
        preloadPath: path.join(__dirname, "app-content-preload.js"),
        userDataPath: userDataPath(),
        localAppServer,
        rewriteReconciliationDocumentUrl,
        isAllowedFirebaseProxyTarget,
      });
      app.exit(0);
    } catch (e) {
      process.stderr.write(String(e?.stack || e?.message || e));
      app.exit(1);
    }
    return;
  }

  if (IS_PHASE1B_RUNTIME_VERIFY) {
    const {
      runPhase1bRuntimeVerify,
      runPhase1bRuntimeVerifyRestartPhase,
    } = require("./phase1bRuntimeVerify");
    const verifyPhase = String(process.env.PL_PHASE1B_VERIFY_PHASE || "all").trim();
    const verifyDeps = {
      app,
      appRoot: __dirname,
      preloadPath: path.join(__dirname, "app-content-preload.js"),
      userDataPath: userDataPath(),
      localAppServer,
      rewriteReconciliationDocumentUrl,
      isAllowedFirebaseProxyTarget,
      startSharedLocalServer,
      resumeHostSharingAfterBootIfConfigured,
      shouldOfferTrayStartSharing: (cfg, st) => shouldOfferTrayStartSharing(cfg, st),
      stopSharingOnly: async () => {
        await localAppServer.stopSharingServer();
      },
      ensureServerDataBridgeWindow,
      runInServerAppRenderer,
      runMirrorCollectionExportWithMeta,
      getVerifyStats: () => ({ ...phase1bVerifyStats }),
      resetVerifyStats: () => {
        phase1bVerifyStats.bridgeIpc = 0;
        phase1bVerifyStats.broadcast = 0;
        phase1bVerifyStats.mirrorPushBroadcast = 0;
        phase1bVerifyStats.hostPublish = 0;
        phase1bVerifyStats.authoritativeHttp = 0;
      },
    };
    try {
      const report =
        verifyPhase === "restart-b"
          ? await runPhase1bRuntimeVerifyRestartPhase(verifyDeps)
          : await runPhase1bRuntimeVerify(verifyDeps);
      process.stdout.write(`\n__PL_PHASE1B_VERIFY_REPORT__\n${JSON.stringify(report, null, 2)}\n`);
      app.exit(report.allPassed ? 0 : 1);
    } catch (e) {
      process.stderr.write(String(e?.stack || e?.message || e));
      app.exit(1);
    }
    return;
  }

  await createWindow();
  await ensureHostSharingRunningAfterLaunch({
    forceRestart: app.__plDidPackagedUpgrade === true,
  });
  syncLocalServerTray();
  app.on("activate", () => {
    void focusOrOpenMainWindow();
  });
  });
}

// Ensure temporary local server is closed on every quit path.
app.on("before-quit", () => {
  app.__plQuitting = true;
  stopServerPowerSaveBlocker("before_quit");
  destroyServerTray();
  stopStaticServer();
});

app.on("window-all-closed", () => {
  const cfg = localAppServer.loadConfig(userDataPath());
  const st = localAppServer.getStatus(userDataPath());
  if (app.isPackaged && localAppServer.shouldHostLocalServer(cfg) && st.sharingActive) {
    syncLocalServerTray();
    notifyServerStillRunningInTray(st);
    return;
  }
  destroyServerTray();
  stopStaticServer();
  if (process.platform !== "darwin") {
    app.__plQuitting = true;
    app.quit();
  }
});
