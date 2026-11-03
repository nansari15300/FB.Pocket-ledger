/*
 * Pocket Ledger — Tauri compatibility shim (content tabs).
 *
 * Electron `electron/app-content-preload.js` jaisi `window.plElectron*` API yahi deta hai, taaki
 * React code (src/) me koi change na karna pade. Har call Tauri app command (least-privilege ACL)
 * par jaata hai: `window.__TAURI_INTERNALS__.invoke(...)`.
 *
 * Rust side is file ke aage `window.__PL_TAURI_BOOT__ = {...}` jodta hai (boot/tab ids).
 * `plElectronAuth.openExternalAuthUrl` = Google login page system browser me (pl_open_external_auth).
 * Sirf `plElectronAuth.signInWithGoogleExternal` (src/ me use nahi hota) abhi
 * `{ ok:false, error:"PL_TAURI_NOT_IMPLEMENTED:<name>" }` deta hai.
 */
(function () {
  "use strict";
  if (window.__plTauriShimInstalled) return;
  try {
    Object.defineProperty(window, "__plTauriShimInstalled", { value: true });
  } catch (_) {}

  var BOOT = window.__PL_TAURI_BOOT__ || {};

  function ipc() {
    var i = window.__TAURI_INTERNALS__;
    return i && typeof i.invoke === "function" ? i : null;
  }
  function inv(cmd, args) {
    var i = ipc();
    if (!i) return Promise.reject(new Error("PL_TAURI_IPC_UNAVAILABLE"));
    return i.invoke(cmd, args || {});
  }
  function fire(cmd, args) {
    try {
      inv(cmd, args).catch(function () {});
    } catch (_) {}
  }
  function notImpl(name, extra) {
    return function () {
      var r = { ok: false, error: "PL_TAURI_NOT_IMPLEMENTED:" + name };
      if (extra) for (var k in extra) r[k] = extra[k];
      return Promise.resolve(r);
    };
  }
  function expose(name, obj) {
    try {
      Object.defineProperty(window, name, {
        value: Object.freeze(obj),
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch (_) {}
  }
  function errText(e) {
    return String((e && e.message) || e || "error");
  }
  /** Electron `ipcRenderer.invoke` jaisa: command error -> rejected Error. */
  function invE(cmd, args) {
    return inv(cmd, args).catch(function (e) {
      throw e instanceof Error ? e : new Error(errText(e));
    });
  }
  /** `{ok:false,error}` result wale handlers: IPC fail ho to bhi result object. */
  function invR(cmd, args) {
    return inv(cmd, args).catch(function (e) {
      return { ok: false, error: errText(e) };
    });
  }
  function toBytes(raw) {
    if (raw == null) return null;
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (typeof raw === "object" && raw.type === "Buffer" && Array.isArray(raw.data)) return Uint8Array.from(raw.data);
    if (Array.isArray(raw)) return Uint8Array.from(raw);
    if (typeof raw === "string") return new TextEncoder().encode(raw);
    return null;
  }
  /** Electron `normalizeRemoteBaseUrl` + `new URL().origin` (sync result ke liye). */
  function remoteOrigin(serverUrl) {
    var s = String(serverUrl || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
    try {
      var u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.origin;
    } catch (_) {
      return "";
    }
  }
  function safeJson(value) {
    try {
      if (value == null) return "";
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  /* ---- Rust -> page events (Rust `webview.eval` se `__plTauriEmit(kind, payload)`) ---- */
  var listeners = { "live-sync-resume": [], "update-progress": [] };
  function emit(kind, payload) {
    var p = payload || {};
    if (kind === "live-sync-resume") {
      try {
        window.dispatchEvent(new CustomEvent("pocket-ledger-electron-resume", { detail: p }));
      } catch (_) {}
    }
    var arr = (listeners[kind] || []).slice();
    for (var i = 0; i < arr.length; i++) {
      try {
        arr[i](p);
      } catch (e) {
        try {
          console.error(e);
        } catch (_) {}
      }
    }
  }
  try {
    Object.defineProperty(window, "__plTauriEmit", { value: emit });
  } catch (_) {}
  function subscribe(kind, cb) {
    if (typeof cb !== "function") return function () {};
    listeners[kind].push(cb);
    return function () {
      var a = listeners[kind];
      var ix = a.indexOf(cb);
      if (ix >= 0) a.splice(ix, 1);
    };
  }

  /* ---- Trace filter: electron/plTraceLog.js `shouldKeepTrace` ka port ---- */
  function shouldKeepTrace(tag, event) {
    if (BOOT.traceVerbose === true) return true;
    var t = String(tag || "");
    var e = String(event || "");
    if (t === "PL-VOUCHER-FORENSIC" || t === "PL-FIRESTORE" || t === "PL-SELFTEST") return true;
    if (/error|failed|failure|timeout|denied|reject|incomplete|abort|suspicious/i.test(e)) return true;
    if (t === "PL-MAIN" && /app_ready|full_quit_requested|window_hidden_server_running|tray_created|tray_destroyed/i.test(e)) return true;
    if (
      t === "PL-SERVER" &&
      /app_ui_listening|sharing_listening|bridge_warm_failed|shareable_companies_provider_done|shareable_companies_provider_failed/i.test(e)
    )
      return true;
    if (t === "PL-SERVER-HTTP" && /access_context_filter_audit|access_context_denied|attachment_access_/i.test(e)) return true;
    return false;
  }

  expose("plElectronTabBridge", {
    notifyTabStripBackgroundSyncDone: function () {
      fire("pl_tab_sync_done");
    },
    openUrlInNewTab: function (url) {
      return inv("pl_open_url_in_new_tab", { url: String(url || "") });
    },
    onLiveSyncResume: function (cb) {
      return subscribe("live-sync-resume", cb);
    },
  });

  expose("plElectronApp", {
    bootSessionId: String(BOOT.bootSessionId || ""),
    tabInstanceId: String(BOOT.tabInstanceId || ""),
  });

  expose("plElectronDevice", {
    getDisplayLabel: function () {
      return inv("pl_device_display_info").catch(function () {
        return "";
      });
    },
  });

  expose("plElectronBackup", {
    pickDirectory: function () {
      return invR("pl_pick_directory");
    },
    writeBackupFile: function (args) {
      var a = args || {};
      return invR("pl_backup_write", {
        dirPath: a.dirPath == null ? null : String(a.dirPath),
        fileName: a.fileName == null ? null : String(a.fileName),
        base64: a.base64 == null ? null : String(a.base64),
        relativeSubdir: a.relativeSubdir == null ? null : String(a.relativeSubdir),
      });
    },
    listBackupFiles: function (dirPath) {
      return invR("pl_backup_list", { dirPath: dirPath == null ? null : String(dirPath) });
    },
    readBackupFile: function (args) {
      var a = args || {};
      return invR("pl_backup_read", {
        dirPath: a.dirPath == null ? null : String(a.dirPath),
        fileName: a.fileName == null ? null : String(a.fileName),
        asBinary: a.asBinary === true,
      });
    },
  });

  function relArg(v) {
    return v == null ? null : String(v);
  }
  expose("plElectronAttachments", {
    writeFile: function (args) {
      var a = args || {};
      return invR("pl_att_write", { relativePath: relArg(a.relativePath), base64: a.base64 == null ? null : String(a.base64) });
    },
    writeFileBinary: function (args) {
      var a = args || {};
      var bytes = toBytes(a.buffer);
      var rel = String(a.relativePath || "");
      if (!rel || !bytes) return Promise.resolve({ ok: false, error: "missing-args" });
      var i = ipc();
      if (!i) return Promise.resolve({ ok: false, error: "PL_TAURI_IPC_UNAVAILABLE" });
      // raw body (base64/JSON overhead ke bina); path header me
      return i.invoke("pl_att_write_binary", bytes, { headers: { "x-pl-path": encodeURIComponent(rel) } }).catch(function (e) {
        return { ok: false, error: errText(e) };
      });
    },
    readFile: function (args) {
      var a = args || {};
      return invR("pl_att_read", { relativePath: relArg(a.relativePath) });
    },
    deleteFile: function (relativePath) {
      return invR("pl_att_delete", { relativePath: relArg(relativePath) });
    },
    exists: function (relativePath) {
      return inv("pl_att_exists", { relativePath: relArg(relativePath) }).catch(function () {
        return { ok: false, exists: false };
      });
    },
    statSizes: function (relativePaths) {
      return invR("pl_att_stat_sizes", { relativePaths: Array.isArray(relativePaths) ? relativePaths : [] });
    },
  });

  expose("plElectronAuth", {
    signInWithGoogleExternal: notImpl("auth.signInWithGoogleExternal"),
    /** "Login with Google" (pbClient `pocketBaseGoogleSignIn`): Google page system browser me. Sirf https://accounts.google.com/. */
    openExternalAuthUrl: function (url) {
      return invR("pl_open_external_auth", { url: String(url || "") });
    },
  });

  expose("plElectronGate", {
    setRemoteAuth: function (serverUrl, accessToken) {
      // Electron sendSync tha; yahan origin turant sync me, header update async (agli request se pehle ho jata hai).
      var origin = remoteOrigin(serverUrl);
      if (!origin) return { ok: false, error: "invalid-url" };
      fire("pl_set_remote_auth", { url: String(serverUrl || ""), token: String(accessToken || "") });
      return { ok: true, origin: origin };
    },
    publishGateStoreSnapshot: function (snapshot) {
      if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.gates)) return;
      fire("pl_broadcast_gate_snapshot", { snapshot: snapshot });
    },
    publishBrowserDbCollectionBump: function (payload) {
      var p = payload || {};
      var companyId = String(p.companyId || "").trim();
      var collection = String(p.collection || "").trim();
      if (!companyId || !collection) return;
      fire("pl_broadcast_db_bump", {
        companyId: companyId,
        collection: collection,
        source: String(p.source || "local_write"),
        immediate: p.immediate !== false,
      });
    },
  });

  expose("plElectronBridge", {
    authoritativeCompanyDocUpsert: function (payload) {
      return invE("pl_bridge_upsert", { payload: payload == null ? null : payload });
    },
  });

  function ls(op, args) {
    return invE("pl_local_server", { op: op, args: args || {} });
  }
  expose("plElectronLocalServer", {
    getStatus: function () {
      return ls("getStatus");
    },
    getConfig: function () {
      return ls("getConfig");
    },
    setConfig: function (partial) {
      return ls("setConfig", { partial: partial || {} });
    },
    start: function () {
      return ls("start");
    },
    stop: function () {
      return ls("stop");
    },
    restart: function (partial) {
      return ls("restart", { partial: partial == null ? null : partial });
    },
    listAccessTokens: function () {
      return ls("listAccessTokens");
    },
    createAccessToken: function (input) {
      return ls("createAccessToken", { input: input || {} });
    },
    updateAccessToken: function (id, input) {
      return ls("updateAccessToken", { id: id, input: input || {} });
    },
    getAccessTokenSecret: function (id) {
      return ls("getAccessTokenSecret", { id: id });
    },
    rotateAccessToken: function (id, input) {
      return ls("rotateAccessToken", { id: id, input: input || {} });
    },
    revokeAccessToken: function (id) {
      return ls("revokeAccessToken", { id: id });
    },
    saveShareableCompaniesSnapshot: function (companies) {
      return ls("saveShareableCompaniesSnapshot", { companies: Array.isArray(companies) ? companies : [] });
    },
  });

  expose("plElectronTrace", {
    log: function (tag, event, detail) {
      if (!shouldKeepTrace(tag, event)) return;
      fire("pl_trace_log", {
        tag: String(tag || "PL-TRACE"),
        event: String(event || ""),
        detail: safeJson(detail),
      });
    },
    getRecentLogs: function (limit) {
      return inv("pl_trace_get_logs", { limit: Number(limit) || 200 });
    },
    getLogFilePath: function () {
      return inv("pl_trace_get_log_file_path");
    },
  });

  expose("plElectronUpdate", {
    downloadAndInstall: function (payload) {
      var p = payload || {};
      return invR("pl_update_download", { url: String(p.url || ""), version: String(p.version || "") });
    },
    onProgress: function (cb) {
      return subscribe("update-progress", cb);
    },
  });

  /* ---- Keyboard shortcuts (Electron app menu accelerators jaisa) ---- */
  window.addEventListener(
    "keydown",
    function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      var key = String(e.key || "");
      var lower = key.toLowerCase();
      var action = null;
      if (key === "F5") action = "reload";
      else if (ctrl && !e.altKey) {
        if (key === "Tab") action = e.shiftKey ? "prev_tab" : "next_tab";
        else if (lower === "t" && !e.shiftKey) action = "new_tab";
        else if (lower === "w" && !e.shiftKey) action = "close_tab";
        else if (lower === "n" && !e.shiftKey) action = "new_window";
        else if (lower === "p" && !e.shiftKey) action = "print";
        else if ((key === "=" || key === "+") && !e.shiftKey) action = "zoom_in";
        else if (key === "+" || (key === "=" && e.shiftKey)) action = "zoom_in";
        else if (key === "-" || key === "_") action = "zoom_out";
        else if (key === "0") action = "zoom_reset";
        else if (lower === "r") action = e.shiftKey ? "force_reload" : "reload";
        else if (lower === "h" && e.shiftKey) action = "toggle_quick_actions";
        else if (lower === "i" && e.shiftKey) action = "toggle_devtools";
      }
      if (!action && key === "F12") action = "toggle_devtools";
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "toggle_quick_actions") {
        try {
          var k = "pl-desktop-header-quick-actions-collapsed";
          if (localStorage.getItem(k) === "1") localStorage.removeItem(k);
          else localStorage.setItem(k, "1");
          window.dispatchEvent(new Event("pl-desktop-quick-actions-toggle"));
        } catch (_) {}
        return;
      }
      fire("pl_shortcut", { action: action });
    },
    true
  );

  /* ---- Print khatam -> zoom wapas (Electron `print()` callback jaisa) ---- */
  window.addEventListener("afterprint", function () {
    fire("pl_print_done");
  });

  /* ---- Debug self-test (sirf PL_TAURI_SELFTEST=1 debug builds) ---- */
  if (BOOT.selftest === true) {
    var report = function (phase) {
      var out = {
        phase: phase,
        tab: BOOT.tabInstanceId,
        href: String(location.href),
        title: document.title,
        visibility: document.visibilityState,
        localStorageKeys: (function () {
          try {
            return localStorage.length;
          } catch (_) {
            return -1;
          }
        })(),
        apis: ["plElectronTabBridge", "plElectronApp", "plElectronDevice", "plElectronTrace", "plElectronLocalServer"].filter(function (n) {
          return !!window[n];
        }),
        ua: navigator.userAgent,
      };
      var finish = function (dbs) {
        out.indexedDb = dbs;
        fire("pl_trace_log", { tag: "PL-SELFTEST", event: "content_report", detail: safeJson(out) });
      };
      try {
        if (indexedDB && indexedDB.databases) {
          indexedDB.databases().then(
            function (list) {
              finish((list || []).map(function (d) {
                return d.name;
              }));
            },
            function () {
              finish("err");
            }
          );
        } else finish("n/a");
      } catch (_) {
        finish("err");
      }
    };
    window.addEventListener("load", function () {
      setTimeout(function () {
        report("load+2s");
      }, 2000);
    });
    try {
      Object.defineProperty(window, "__plSelftestReport", { value: report });
    } catch (_) {}
  }
})();
