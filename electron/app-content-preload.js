const { contextBridge, ipcRenderer } = require("electron");

/** Wake/focus: main process bhejta hai — renderer sync (StaticFastResumeSyncManager) background me. */
ipcRenderer.on("pl-live-sync-resume", (_event, payload) => {
  try {
    window.dispatchEvent(
      new CustomEvent("pocket-ledger-electron-resume", { detail: payload || {} })
    );
  } catch (_) {}
});

function readAppBootSessionId() {
  try {
    return String(ipcRenderer.sendSync("pl-get-app-boot-session-id") || "");
  } catch (_) {
    return "";
  }
}

function readTabInstanceIdFromArgv() {
  try {
    for (const arg of process.argv) {
      if (typeof arg === "string" && arg.startsWith("--pl-tab-instance-id=")) {
        return arg.slice("--pl-tab-instance-id=".length);
      }
    }
  } catch (_) {
    /* ignore */
  }
  return "";
}

/**
 * Next tab BrowserView — tab strip se “background sync” ke baad strip ko green ✓ dikhane ke liye IPC.
 * `main.js` `pl-tab-strip-sync-done-ack` strip ko forward karta hai.
 */
contextBridge.exposeInMainWorld("plElectronTabBridge", {
  notifyTabStripBackgroundSyncDone: () => {
    try {
      ipcRenderer.send("pl-tab-strip-sync-done-from-app");
    } catch (_) {}
  },
  /** Gate → Open gate: sharing URL nayi EXE BrowserView tab me kholo. */
  openUrlInNewTab: (url) => ipcRenderer.invoke("pl-open-url-in-new-tab", { url }),
  onLiveSyncResume: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("pl-live-sync-resume", listener);
    return () => ipcRenderer.removeListener("pl-live-sync-resume", listener);
  },
});

/** Multi-device / Firestore label: renderer `os.hostname` nahi padh sakta — main IPC se string. */
contextBridge.exposeInMainWorld("plElectronApp", {
  bootSessionId: readAppBootSessionId(),
  /** Stable per BrowserView tab — EXE multi-tab company map key (sessionStorage is shared). */
  tabInstanceId: readTabInstanceIdFromArgv(),
});

/** Multi-device / Firestore label: renderer `os.hostname` nahi padh sakta — main IPC se string. */
contextBridge.exposeInMainWorld("plElectronDevice", {
  getDisplayLabel: () => ipcRenderer.invoke("pl-device-display-info"),
});

/** Backup location: poora local path (D:\…) + direct file write — web DirectoryHandle path expose nahi karta. */
contextBridge.exposeInMainWorld("plElectronBackup", {
  pickDirectory: () => ipcRenderer.invoke("pl-pick-backup-directory"),
  writeBackupFile: (args) => ipcRenderer.invoke("pl-write-backup-file", args),
  listBackupFiles: (dirPath) => ipcRenderer.invoke("pl-list-backup-files", dirPath),
  readBackupFile: (args) => ipcRenderer.invoke("pl-read-backup-file", args),
});

/** EXE: voucher/transaction attachment bytes — userData/pl-attachments (APK DataDirectory jaisa). */
contextBridge.exposeInMainWorld("plElectronAttachments", {
  writeFile: (args) => ipcRenderer.invoke("pl-attachment-write", args),
  writeFileBinary: (args) => ipcRenderer.invoke("pl-attachment-write-binary", args),
  readFile: (args) => ipcRenderer.invoke("pl-attachment-read", args),
  deleteFile: (relativePath) => ipcRenderer.invoke("pl-attachment-delete", relativePath),
  exists: (relativePath) => ipcRenderer.invoke("pl-attachment-exists", relativePath),
  statSizes: (relativePaths) => ipcRenderer.invoke("pl-attachment-stat-sizes", relativePaths),
});

/** EXE: Google sign-in system browser (Chrome/Edge) — saved account one-tap. */
contextBridge.exposeInMainWorld("plElectronAuth", {
  signInWithGoogleExternal: (options) => ipcRenderer.invoke("pl-google-auth-external", options),
});

/** Gate → Connect & open: inject access token on remote server static requests (WAN IP). */
contextBridge.exposeInMainWorld("plElectronGate", {
  setRemoteAuth: (serverUrl, accessToken) => {
    try {
      return ipcRenderer.sendSync("pl-set-remote-gate-auth", { serverUrl, accessToken });
    } catch (_) {
      return { ok: false };
    }
  },
  /** Ek tab gate delete/add — baaki saari tabs (3000 + 3001) ko snapshot sync. */
  publishGateStoreSnapshot: (snapshot) => {
    try {
      ipcRenderer.send("pl-gate-store-snapshot", snapshot);
    } catch (_) {}
  },
  /** SQLite bump — saari EXE tabs live UI refresh (user save / remote push). */
  publishBrowserDbCollectionBump: (payload) => {
    try {
      ipcRenderer.send("pl-browser-db-collection-bump", payload);
    } catch (_) {}
  },
});

/** Host UI → hidden bridge: authoritative Local Company SQLite writes when sharing is on. */
contextBridge.exposeInMainWorld("plElectronBridge", {
  authoritativeCompanyDocUpsert: (payload) =>
    ipcRenderer.invoke("pl-bridge-authoritative-company-doc-upsert", payload),
});

/** EXE / Linux desktop: local static server — settings → Server */
contextBridge.exposeInMainWorld("plElectronLocalServer", {
  getStatus: () => ipcRenderer.invoke("pl-local-server-get-status"),
  getConfig: () => ipcRenderer.invoke("pl-local-server-get-config"),
  setConfig: (partial) => ipcRenderer.invoke("pl-local-server-set-config", partial),
  start: () => ipcRenderer.invoke("pl-local-server-start"),
  stop: () => ipcRenderer.invoke("pl-local-server-stop"),
  restart: (partial) => ipcRenderer.invoke("pl-local-server-restart", partial),
  listAccessTokens: () => ipcRenderer.invoke("pl-local-server-list-access-tokens"),
  createAccessToken: (input) => ipcRenderer.invoke("pl-local-server-create-access-token", input),
  updateAccessToken: (id, input) => ipcRenderer.invoke("pl-local-server-update-access-token", { id, input }),
  getAccessTokenSecret: (id) => ipcRenderer.invoke("pl-local-server-get-access-token-secret", id),
  rotateAccessToken: (id, input) => ipcRenderer.invoke("pl-local-server-rotate-access-token", { id, input }),
  revokeAccessToken: (id) => ipcRenderer.invoke("pl-local-server-revoke-access-token", id),
  saveShareableCompaniesSnapshot: (companies) =>
    ipcRenderer.invoke("pl-local-server-save-shareable-snapshot", companies),
});

/** EXE trace log — gate Test / Open gate debug (memory + pl-trace.log file). */
contextBridge.exposeInMainWorld("plElectronTrace", {
  log: (tag, event, detail) => {
    try {
      ipcRenderer.send("pl-trace-log-client", { tag, event, detail });
    } catch (_) {}
  },
  getRecentLogs: (limit) => ipcRenderer.invoke("pl-trace-get-logs", limit),
  getLogFilePath: () => ipcRenderer.invoke("pl-trace-get-log-file-path"),
});

/** EXE in-app update: download installer + launch NSIS wizard, then quit so files can replace. */
contextBridge.exposeInMainWorld("plElectronUpdate", {
  downloadAndInstall: (payload) => ipcRenderer.invoke("pl-release-update-download-install", payload),
  onProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on("pl-release-update-progress", handler);
    return () => ipcRenderer.removeListener("pl-release-update-progress", handler);
  },
});
