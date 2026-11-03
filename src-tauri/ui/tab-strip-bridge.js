/*
 * Tauri bridge for the tab strip — Electron `electron/tab-strip-preload.js` ka replacement.
 * `tab-strip.js` (unchanged copy) `window.electronTabStrip` + `window.plElectronChrome` use karta hai.
 * Rust -> strip updates: `webview.eval("__plTabStripPush('tabs'|'max', payload)")` (event permission ki zaroorat nahi).
 */
(function () {
  "use strict";
  function inv(cmd, args) {
    var i = window.__TAURI_INTERNALS__;
    if (!i || typeof i.invoke !== "function") return Promise.reject(new Error("PL_TAURI_IPC_UNAVAILABLE"));
    return i.invoke(cmd, args || {});
  }
  var subs = { tabs: [], max: [] };
  var last = { tabs: null, max: null };
  window.__plTabStripPush = function (kind, payload) {
    if (!subs[kind]) return;
    last[kind] = payload;
    subs[kind].slice().forEach(function (cb) {
      try {
        cb(payload);
      } catch (e) {
        console.error(e);
      }
    });
  };
  function subscribe(kind, cb) {
    if (typeof cb !== "function") return function () {};
    subs[kind].push(cb);
    if (last[kind] != null) {
      try {
        cb(last[kind]);
      } catch (_) {}
    }
    return function () {
      var ix = subs[kind].indexOf(cb);
      if (ix >= 0) subs[kind].splice(ix, 1);
    };
  }

  window.electronTabStrip = Object.freeze({
    switchTab: function (index) {
      return inv("tab_strip_action", { action: "switch", index: index });
    },
    newTab: function () {
      return inv("tab_strip_action", { action: "new" });
    },
    closeTab: function (index) {
      return inv("tab_strip_action", { action: "close", index: index });
    },
    reloadActiveTab: function () {
      return inv("tab_reload_active");
    },
    onTabsUpdate: function (cb) {
      var unsub = subscribe("tabs", cb);
      inv("tab_strip_action", { action: "refresh" }).catch(function () {});
      return unsub;
    },
  });

  window.plElectronChrome = Object.freeze({
    mergedTitleBar: true,
    minimize: function () {
      return inv("win_chrome_action", { action: "minimize" });
    },
    maximizeToggle: function () {
      return inv("win_chrome_action", { action: "maximize-toggle" });
    },
    close: function () {
      return inv("win_chrome_action", { action: "close" });
    },
    showAppMenu: function () {
      return inv("win_show_app_menu");
    },
    onMaximizedChange: function (cb) {
      return subscribe("max", cb);
    },
  });

  /* Electron `-webkit-app-region: drag` (#dragFill) -> Tauri: window drag via app command. */
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || e.detail > 1) return;
    var t = e.target;
    if (t && t.id === "dragFill") {
      e.preventDefault();
      inv("win_start_drag").catch(function () {});
    }
  });
  /* Strip me browser context menu / reload keys band. */
  document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });
})();
