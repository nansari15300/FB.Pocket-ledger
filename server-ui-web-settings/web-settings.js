/* Pocket Ledger Server UI - "Web Settings" (website admin panel, moved off the public website).
 * Plain ES2017 browser JS, no build step, no Firebase. Load after app.js.
 *
 *   window.WebSettings.mount(containerEl, ctx)  ->  { show(tabKey), reload(), destroy() }
 *   ctx = { api, me, t, token }
 *     api(method, path, body) -> Promise<JSON>   (Server UI helper; adds Authorization itself, throws err.status)
 *     me  = { role: "main_admin" | "web_admin", web_perms: { releases, videos, notice, downloads, users: "none"|"view"|"edit" } }
 *     t(key) -> string  (Server UI i18n; English fallback is used when the key is missing)
 *     token() -> raw auth token (only used for the binary EXE/APK chunk upload)
 *
 * Everything is scoped under the .plws root class and "plws-" element ids so it cannot clash with Server UI.
 * Website routes used: /api/pl/site/admin/*  (unchanged)  +  /api/pl/web-users*  (Users tab, main admin only).
 */
(function () {
  "use strict";
  if (window.WebSettings && window.WebSettings.__plws) return;

  var SITE = "/api/pl/site";
  var SECTIONS = ["releases", "videos", "downloads", "notice"];
  var SECTION_LABEL = { releases: "Release upload", videos: "Website Videos", downloads: "Download analytics", notice: "Notice", users: "Users" };

  /* ---------------- release settings helpers (copy of website/js/release-settings-shared.js, kept private) ---------------- */
  var RS = {};
  (function (global) {
    var DEFAULTS = {
      downloadsMaxOldExe: 5,
      downloadsMaxOldApk: 5,
      outdatedPolicy: "keep",
      outdatedMaxKeep: 20,
    };

    function clamp(n, min, max) {
      var v = Number(n);
      if (!Number.isFinite(v)) return min;
      return Math.max(min, Math.min(max, Math.trunc(v)));
    }

    function isMissingSettingValue(value) {
      return value === undefined || value === null || value === "";
    }

    function normalizeReleaseSettings(raw) {
      var src = raw && typeof raw === "object" ? raw : {};
      var legacy = isMissingSettingValue(src.downloadsMaxOld)
        ? null
        : clamp(src.downloadsMaxOld, 0, 20);
      return {
        downloadsMaxOldExe: isMissingSettingValue(src.downloadsMaxOldExe)
          ? legacy !== null
            ? legacy
            : DEFAULTS.downloadsMaxOldExe
          : clamp(src.downloadsMaxOldExe, 0, 20),
        downloadsMaxOldApk: isMissingSettingValue(src.downloadsMaxOldApk)
          ? legacy !== null
            ? legacy
            : DEFAULTS.downloadsMaxOldApk
          : clamp(src.downloadsMaxOldApk, 0, 20),
        outdatedPolicy: src.outdatedPolicy === "auto_delete" ? "auto_delete" : "keep",
        outdatedMaxKeep: isMissingSettingValue(src.outdatedMaxKeep)
          ? DEFAULTS.outdatedMaxKeep
          : clamp(src.outdatedMaxKeep, 0, 100),
      };
    }

    function parseReleaseSettingsJson(text) {
      var trimmed = String(text == null ? "" : text).trim();
      if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
      try {
        var parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function isApkAndroid(item) {
      if (!item || !item.url) return false;
      if (item.format === "aab") return false;
      return /\.apk(\?|$)/i.test(String(item.file || item.url || ""));
    }

    function cloneReleaseEntry(entry) {
      if (!entry) return null;
      return {
        date: entry.date || "",
        windows: entry.windows || null,
        android: entry.android || null,
      };
    }

    function sameRelease(a, b) {
      if (!a || !b) return false;
      return (
        String(a.date || "") === String(b.date || "") &&
        String(a.windows && a.windows.url || "") === String(b.windows && b.windows.url || "") &&
        String(a.android && a.android.url || "") === String(b.android && b.android.url || "")
      );
    }

    function mergeOlderPool(manifest) {
      var ref = manifest || {};
      var latestSnapshot = cloneReleaseEntry({
        date: ref.date,
        windows: ref.windows,
        android: ref.android,
      });
      var pool = [];
      var sources = []
        .concat(Array.isArray(ref.history) ? ref.history : [])
        .concat(Array.isArray(ref.outdated) ? ref.outdated : []);
      for (var i = 0; i < sources.length; i++) {
        var entry = sources[i];
        if (!entry || sameRelease(entry, latestSnapshot)) continue;
        var dup = false;
        for (var j = 0; j < pool.length; j++) {
          if (sameRelease(pool[j], entry)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        pool.push(cloneReleaseEntry(entry));
      }
      pool.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
      return pool;
    }

    function entryHasPlatform(entry, platform) {
      if (platform === "apk") {
        return Boolean(entry && entry.android && isApkAndroid(entry.android));
      }
      return Boolean(entry && entry.windows && entry.windows.url);
    }

    function downloadsMaxOldForPlatform(settings, platform) {
      return platform === "apk" ? settings.downloadsMaxOldApk : settings.downloadsMaxOldExe;
    }

    function selectHistoryForPlatform(pool, platform, maxOld) {
      var selected = [];
      for (var i = 0; i < pool.length; i++) {
        var entry = pool[i];
        if (!entryHasPlatform(entry, platform)) continue;
        selected.push(cloneReleaseEntry(entry));
        if (selected.length >= maxOld) break;
      }
      return selected;
    }

    function unionHistoryEntries(lists) {
      var out = [];
      for (var l = 0; l < lists.length; l++) {
        var list = lists[l] || [];
        for (var i = 0; i < list.length; i++) {
          var entry = list[i];
          if (!entry) continue;
          var dup = false;
          for (var j = 0; j < out.length; j++) {
            if (sameRelease(out[j], entry)) {
              dup = true;
              break;
            }
          }
          if (dup) continue;
          out.push(cloneReleaseEntry(entry));
        }
      }
      out.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
      return out;
    }

    function splitPoolForDownloads(pool, settings, prevHistoryLen) {
      var exeHist = selectHistoryForPlatform(pool, "exe", settings.downloadsMaxOldExe);
      var apkHist = selectHistoryForPlatform(pool, "apk", settings.downloadsMaxOldApk);
      var history = unionHistoryEntries([exeHist, apkHist]);
      var afterDownloads = [];
      for (var i = 0; i < pool.length; i++) {
        var entry = pool[i];
        var inHist = false;
        for (var h = 0; h < history.length; h++) {
          if (sameRelease(history[h], entry)) {
            inHist = true;
            break;
          }
        }
        if (!inHist) afterDownloads.push(entry);
      }
      var deleteEntries = [];
      var promotedCount = Math.max(0, history.length - prevHistoryLen);
      var spilledCount = Math.max(0, prevHistoryLen - history.length);

      if (settings.outdatedPolicy === "auto_delete") {
        for (var d = 0; d < afterDownloads.length; d++) {
          deleteEntries.push(cloneReleaseEntry(afterDownloads[d]));
        }
      }

      return {
        history: history,
        afterDownloads: afterDownloads,
        deleteEntries: deleteEntries,
        spilledCount: spilledCount,
        promotedCount: promotedCount,
      };
    }

    function mergeIntoOutdated(history, afterDownloads, existingOutdated, latestSnapshot) {
      var outdated = [];

      function pushOutdated(entry) {
        if (!entry || sameRelease(entry, latestSnapshot)) return;
        for (var h = 0; h < history.length; h++) {
          if (sameRelease(history[h], entry)) return;
        }
        for (var o = 0; o < outdated.length; o++) {
          if (sameRelease(outdated[o], entry)) return;
        }
        outdated.push(cloneReleaseEntry(entry));
      }

      for (var i = 0; i < afterDownloads.length; i++) {
        pushOutdated(afterDownloads[i]);
      }
      var prevOut = Array.isArray(existingOutdated) ? existingOutdated : [];
      for (var k = 0; k < prevOut.length; k++) {
        pushOutdated(prevOut[k]);
      }
      outdated.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
      return outdated;
    }

    /** Downloads dropdown only — does not trim hidden list by outdatedMaxKeep. */
    function reconcileDownloadsSettings(manifest, settingsRaw) {
      var settings = normalizeReleaseSettings(settingsRaw);
      var ref = manifest || {};
      var prevHistoryLen = Array.isArray(ref.history) ? ref.history.length : 0;
      var pool = mergeOlderPool(ref);
      var split = splitPoolForDownloads(pool, settings, prevHistoryLen);
      var latestSnapshot = cloneReleaseEntry({
        date: ref.date,
        windows: ref.windows,
        android: ref.android,
      });
      var outdated = [];

      if (settings.outdatedPolicy === "auto_delete") {
        outdated = mergeIntoOutdated(split.history, [], ref.outdated, latestSnapshot);
      } else {
        outdated = mergeIntoOutdated(
          split.history,
          split.afterDownloads,
          ref.outdated,
          latestSnapshot
        );
      }

      return {
        history: split.history,
        outdated: outdated,
        deleteEntries: split.deleteEntries,
        spilledCount: split.spilledCount,
        promotedCount: split.promotedCount,
      };
    }

    /** Hidden / outdated only — never moves builds in or out of Downloads history. */
    function reconcileHiddenSettings(manifest, settingsRaw) {
      var settings = normalizeReleaseSettings(settingsRaw);
      var ref = manifest || {};
      var latestSnapshot = cloneReleaseEntry({
        date: ref.date,
        windows: ref.windows,
        android: ref.android,
      });
      var history = Array.isArray(ref.history)
        ? ref.history.map(function (e) {
            return cloneReleaseEntry(e);
          })
        : [];
      var outdated = [];
      var deleteEntries = [];
      var sources = Array.isArray(ref.outdated) ? ref.outdated : [];

      for (var i = 0; i < sources.length; i++) {
        var entry = sources[i];
        if (!entry || sameRelease(entry, latestSnapshot)) continue;
        var inHist = false;
        for (var h = 0; h < history.length; h++) {
          if (sameRelease(history[h], entry)) {
            inHist = true;
            break;
          }
        }
        if (inHist) continue;
        var dup = false;
        for (var j = 0; j < outdated.length; j++) {
          if (sameRelease(outdated[j], entry)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        outdated.push(cloneReleaseEntry(entry));
      }
      outdated.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });

      if (
        settings.outdatedPolicy === "keep" &&
        settings.outdatedMaxKeep > 0 &&
        outdated.length > settings.outdatedMaxKeep
      ) {
        var excess = outdated.slice(settings.outdatedMaxKeep);
        outdated = outdated.slice(0, settings.outdatedMaxKeep);
        for (var e = 0; e < excess.length; e++) {
          deleteEntries.push(cloneReleaseEntry(excess[e]));
        }
      }

      return {
        history: history,
        outdated: outdated,
        deleteEntries: deleteEntries,
        spilledCount: 0,
        promotedCount: 0,
      };
    }

    function reconcileManifestWithSettings(manifest, settingsRaw) {
      return reconcileDownloadsSettings(manifest, settingsRaw);
    }

    function buildReleaseRotation(prev, next, settingsRaw) {
      var settings = normalizeReleaseSettings(settingsRaw);
      var candidates = [];
      if (prev && (prev.windows || prev.android) && !sameRelease(prev, next)) {
        candidates.push(cloneReleaseEntry(prev));
      }
      var prior = Array.isArray(prev && prev.history) ? prev.history : [];
      for (var i = 0; i < prior.length; i++) {
        var entry = prior[i];
        if (!entry || sameRelease(entry, next)) continue;
        var dup = false;
        for (var j = 0; j < candidates.length; j++) {
          if (sameRelease(candidates[j], entry)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        candidates.push(cloneReleaseEntry(entry));
      }
      candidates.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
      var history = unionHistoryEntries([
        selectHistoryForPlatform(candidates, "exe", settings.downloadsMaxOldExe),
        selectHistoryForPlatform(candidates, "apk", settings.downloadsMaxOldApk),
      ]);
      var spilled = [];
      for (var s = 0; s < candidates.length; s++) {
        var candidate = candidates[s];
        var kept = false;
        for (var h = 0; h < history.length; h++) {
          if (sameRelease(history[h], candidate)) {
            kept = true;
            break;
          }
        }
        if (!kept) spilled.push(candidate);
      }
      var deleteEntries = [];
      var outdated = [];
      if (settings.outdatedPolicy === "auto_delete") {
        for (var s = 0; s < spilled.length; s++) deleteEntries.push(cloneReleaseEntry(spilled[s]));
      } else {
        for (var o = 0; o < spilled.length; o++) outdated.push(cloneReleaseEntry(spilled[o]));
      }
      var prevOut = Array.isArray(prev && prev.outdated) ? prev.outdated : [];
      for (var k = 0; k < prevOut.length; k++) {
        var old = prevOut[k];
        if (!old || sameRelease(old, next)) continue;
        var inHist = false;
        for (var h = 0; h < history.length; h++) {
          if (sameRelease(history[h], old)) {
            inHist = true;
            break;
          }
        }
        if (inHist) continue;
        var seen = false;
        for (var x = 0; x < outdated.length; x++) {
          if (sameRelease(outdated[x], old)) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        outdated.push(cloneReleaseEntry(old));
      }
      if (settings.outdatedPolicy === "keep" && settings.outdatedMaxKeep > 0) {
        while (outdated.length > settings.outdatedMaxKeep) {
          var removed = outdated.pop();
          if (removed) deleteEntries.push(cloneReleaseEntry(removed));
        }
      }
      return { history: history, outdated: outdated, deleteEntries: deleteEntries };
    }

    function reconcileManifestWithSettings(manifest, settingsRaw) {
      return reconcileDownloadsSettings(manifest, settingsRaw);
    }

    /** Latest + older builds for one platform in the public Downloads dropdown. */
    function buildPublicDownloadEntries(manifest, settingsRaw, platformKind) {
      var settings = normalizeReleaseSettings(settingsRaw);
      var platform = platformKind === "android" ? "apk" : "exe";
      var maxOld = downloadsMaxOldForPlatform(settings, platform);
      var ref = manifest || {};
      var pool = mergeOlderPool(ref);
      var older = selectHistoryForPlatform(pool, platform, maxOld);
      var out = [];
      if (platform === "exe" && ref.windows && ref.windows.url) {
        out.push({
          date: ref.date || "",
          windows: ref.windows,
          android: null,
          latest: true,
        });
      } else if (platform === "apk") {
        var latestApk = ref.android && isApkAndroid(ref.android) ? ref.android : null;
        if (latestApk) {
          out.push({
            date: ref.date || "",
            windows: null,
            android: latestApk,
            latest: true,
          });
        }
      }
      for (var i = 0; i < older.length; i++) {
        var entry = older[i];
        if (platform === "exe" && entry.windows && entry.windows.url) {
          out.push({
            date: entry.date || "",
            windows: entry.windows,
            android: null,
            latest: false,
          });
        } else if (platform === "apk") {
          var entryApk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
          if (entryApk) {
            out.push({
              date: entry.date || "",
              windows: null,
              android: entryApk,
              latest: false,
            });
          }
        }
      }
      return out.slice(0, maxOld + 1);
    }

    global.reconcileDownloadsSettings = reconcileDownloadsSettings;
    global.reconcileHiddenSettings = reconcileHiddenSettings;
    global.buildPublicDownloadEntries = buildPublicDownloadEntries;

    global.POCKET_LEDGER_RELEASE_SETTINGS_DEFAULTS = DEFAULTS;
    global.parseReleaseSettingsJson = parseReleaseSettingsJson;
    global.normalizeReleaseSettings = normalizeReleaseSettings;
    global.isApkAndroidRelease = isApkAndroid;
    global.buildReleaseRotation = buildReleaseRotation;
    global.reconcileManifestWithSettings = reconcileManifestWithSettings;
    global.cloneReleaseEntry = cloneReleaseEntry;
    global.sameReleaseEntry = sameRelease;
    global.entryHasPlatformRelease = entryHasPlatform;
    global.downloadsMaxOldForPlatform = downloadsMaxOldForPlatform;
    global.POCKET_LEDGER_RELEASE_MAX_OLD = DEFAULTS.downloadsMaxOldExe;
  })(RS);

  /* ---------------- small helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function makeTr(ctx) {
    return function tr(key, def) {
      try {
        if (ctx && typeof ctx.t === "function") {
          var s = ctx.t(key);
          if (s && s !== key) return s;
        }
      } catch (_) { /* missing key */ }
      return def;
    };
  }

  function permOf(me, section) {
    if (!me) return "none";
    if (me.role === "main_admin") return "edit";
    if (section === "users") return "none"; // Users tab: main admin only
    var p = me.web_perms && me.web_perms[section];
    return p === "edit" || p === "view" ? p : "none";
  }

  /* Own confirm modal, used only when Server UI's plDialog is not there. */
  function fallbackConfirm(host, options) {
    return new Promise(function (resolve) {
      var wrap = document.createElement("div");
      wrap.className = "plws-modal";
      wrap.innerHTML =
        '<div class="plws-modal-backdrop"></div>' +
        '<div class="plws-modal-card" role="alertdialog" aria-modal="true">' +
        "<h3></h3><p></p><ul hidden></ul>" +
        '<div class="plws-modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-x="cancel"></button>' +
        '<button type="button" class="btn btn-sm" data-x="ok"></button></div></div>';
      wrap.querySelector("h3").textContent = options.title || "Confirm";
      wrap.querySelector("p").textContent = options.message || "";
      var ul = wrap.querySelector("ul");
      (options.items || []).forEach(function (text) {
        var li = document.createElement("li");
        li.textContent = text;
        ul.appendChild(li);
        ul.hidden = false;
      });
      var ok = wrap.querySelector('[data-x="ok"]');
      var cancel = wrap.querySelector('[data-x="cancel"]');
      ok.textContent = options.confirmLabel || "Confirm";
      ok.className = "btn btn-sm " + (options.danger ? "btn-danger-solid" : "btn-primary");
      cancel.textContent = options.cancelLabel || "Cancel";
      function done(v) {
        document.removeEventListener("keydown", onKey, true);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(v);
      }
      function onKey(ev) { if (ev.key === "Escape") { ev.preventDefault(); done(false); } }
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      wrap.querySelector(".plws-modal-backdrop").onclick = function () { done(false); };
      document.addEventListener("keydown", onKey, true);
      host.appendChild(wrap);
      cancel.focus();
    });
  }

  /* W = what the ported website-admin code calls instead of window.SiteData. */
  function makeW(ctx, host) {
    function tokenValue() {
      var t = ctx.token;
      try { t = typeof t === "function" ? t() : t; } catch (_) { t = ""; }
      if (!t) { try { t = window.sessionStorage.getItem("pl_server_admin_token") || ""; } catch (_) { t = ""; } }
      return String(t || "");
    }
    function get(path) { return ctx.api("GET", SITE + path); }
    function post(path, body) { return ctx.api("POST", SITE + path, body || {}); }

    function httpError(status, data, fallback) {
      var err = new Error((data && (data.message || data.error)) || fallback || "Error " + status);
      err.status = status;
      err.data = data;
      return err;
    }

    /* Raw-body POST of one part with upload progress (same format as website/js/site-data.js). */
    function postChunk(uploadId, index, blob, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", SITE + "/admin/releases/upload-chunk?id=" + encodeURIComponent(uploadId) + "&index=" + index);
        var tok = tokenValue();
        if (tok) xhr.setRequestHeader("Authorization", tok);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = function (ev) { if (ev.lengthComputable && onProgress) onProgress(ev.loaded); };
        xhr.onload = function () {
          var data = null;
          try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (_) { data = null; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(httpError(xhr.status, data));
        };
        xhr.onerror = function () { reject(httpError(0, null, "Upload interrupted. Check the internet connection.")); };
        xhr.send(blob);
      });
    }

    /* Chunked upload of an EXE/APK (server decides chunk size, each part retried 3 times). */
    function uploadFile(file, date, onProgress) {
      var total = file.size || 1;
      return post("/admin/releases/upload-init", { date: date, name: file.name, size: file.size }).then(function (init) {
        var chunkSize = init.chunkSize;
        var done = 0;
        function sendPart(i) {
          if (i >= init.chunks) return Promise.resolve();
          var start = i * chunkSize;
          var blob = file.slice(start, Math.min(file.size, start + chunkSize));
          function attempt(n) {
            return postChunk(init.uploadId, i, blob, function (loaded) {
              if (onProgress) onProgress(Math.min(99, Math.round(((done + loaded) / total) * 100)));
            }).catch(function (err) {
              if (n < 3 && (!err.status || err.status >= 500)) {
                return new Promise(function (r) { setTimeout(r, 1500 * n); }).then(function () { return attempt(n + 1); });
              }
              throw err;
            });
          }
          return attempt(1).then(function () {
            done += blob.size;
            return sendPart(i + 1);
          });
        }
        return sendPart(0).then(function () {
          return post("/admin/releases/upload-finish", { uploadId: init.uploadId });
        }).then(function (res) {
          if (onProgress) onProgress(100);
          return res;
        });
      });
    }

    function confirm(options) {
      options = options || {};
      var dlg = window.plDialog;
      if (dlg && typeof dlg.confirm === "function") {
        var msg = String(options.message || "");
        var items = Array.isArray(options.items) ? options.items : [];
        if (items.length) msg += "\n\n" + items.map(function (x) { return "\u2022 " + x; }).join("\n");
        return dlg.confirm(msg, {
          title: options.title || "Confirm",
          okText: options.confirmLabel || "Confirm",
          cancelText: options.cancelLabel || undefined,
          danger: !!options.danger,
        });
      }
      return fallbackConfirm(host, options);
    }

    return { get: get, post: post, uploadFile: uploadFile, confirm: confirm, token: tokenValue };
  }

  /* ================= Views (ported from the website admin pages) ================= */

  var VIEWS = {};

  VIEWS.releases = {
    pfx: "rel",
    html: "<div class=\"plws-card\" data-plws-edit>\n            <h3 style=\"margin:0 0 0.35rem;font-size:1rem\">Upload new build</h3>\n            <div class=\"release-upload-date settings-grid\">\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-rel-dateField\">Date folder (shared)</label>\n                <input id=\"plws-rel-dateField\" type=\"date\" />\n              </div>\n            </div>\n            <div class=\"release-tables-grid\">\n              <div class=\"release-table-panel\">\n                <h4 class=\"release-table-title\">EXE (Windows)</h4>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table release-form-table\">\n                    <tbody>\n                      <tr>\n                        <th><label for=\"plws-rel-exeFile\">File</label></th>\n                        <td><input id=\"plws-rel-exeFile\" type=\"file\" accept=\".exe\" /></td>\n                      </tr>\n                      <tr>\n                        <th><label for=\"plws-rel-windowsVersion\">Version</label></th>\n                        <td>\n                          <input id=\"plws-rel-windowsVersion\" type=\"text\" inputmode=\"decimal\" placeholder=\"e.g. 1.1.15\" />\n                        </td>\n                      </tr>\n                    </tbody>\n                  </table>\n                </div>\n              </div>\n              <div class=\"release-table-panel\">\n                <h4 class=\"release-table-title\">APK (Android)</h4>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table release-form-table\">\n                    <tbody>\n                      <tr>\n                        <th><label for=\"plws-rel-apkFile\">File</label></th>\n                        <td>\n                          <input id=\"plws-rel-apkFile\" type=\"file\" accept=\".apk,application/vnd.android.package-archive\" />\n                        </td>\n                      </tr>\n                      <tr>\n                        <th><label for=\"plws-rel-androidVersion\">Version</label></th>\n                        <td>\n                          <input id=\"plws-rel-androidVersion\" type=\"text\" inputmode=\"decimal\" placeholder=\"e.g. 1.1.15\" />\n                        </td>\n                      </tr>\n                      <tr>\n                        <th><label for=\"plws-rel-playStoreUrl\">Play Store</label></th>\n                        <td>\n                          <input\n                            id=\"plws-rel-playStoreUrl\"\n                            type=\"url\"\n                            placeholder=\"https://play.google.com/store/apps/details?id=…\"\n                          />\n                        </td>\n                      </tr>\n                    </tbody>\n                  </table>\n                </div>\n              </div>\n            </div>\n            <div class=\"release-actions-row\">\n              <button type=\"button\" class=\"btn btn-primary\" id=\"plws-rel-publishBtn\">Upload and publish</button>\n            </div>\n            <progress id=\"plws-rel-progress\" max=\"100\" value=\"0\" hidden></progress>\n\n            </div>\n\n            <div class=\"plws-card\">\n\n            <h3 style=\"margin:0 0 0.35rem;font-size:1rem\">Downloads list (user-visible)</h3>\n            <div class=\"settings-grid\" style=\"margin-top:0.75rem\">\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-rel-downloadsMaxOldExe\">Older EXE builds in Downloads dropdown</label>\n                <input id=\"plws-rel-downloadsMaxOldExe\" data-plws-edit type=\"number\" min=\"0\" max=\"20\" step=\"1\" />\n              </div>\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-rel-downloadsMaxOldApk\">Older APK builds in Downloads dropdown</label>\n                <input id=\"plws-rel-downloadsMaxOldApk\" data-plws-edit type=\"number\" min=\"0\" max=\"20\" step=\"1\" />\n              </div>\n            </div>\n            <div class=\"release-tables-grid\">\n              <div class=\"release-table-panel\">\n                <div class=\"release-table-head\">\n                  <h4 class=\"release-table-title\">EXE (Windows)</h4>\n                  <button type=\"button\" class=\"release-info-btn\" aria-label=\"EXE downloads info\">\n                    <span aria-hidden=\"true\">i</span>\n                    <span id=\"plws-rel-visibleListHintExe\" class=\"release-info-tip\" role=\"tooltip\"></span>\n                  </button>\n                </div>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table\">\n                    <thead>\n                      <tr>\n                        <th>Role</th>\n                        <th>Version</th>\n                        <th>Date</th>\n                        <th>File</th>\n                        <th class=\"col-action\"></th>\n                      </tr>\n                    </thead>\n                    <tbody id=\"plws-rel-visibleReleaseTableExe\"></tbody>\n                  </table>\n                </div>\n                <p id=\"plws-rel-visibleReleaseEmptyExe\" class=\"release-table-empty\" hidden>No EXE published yet.</p>\n              </div>\n              <div class=\"release-table-panel\">\n                <div class=\"release-table-head\">\n                  <h4 class=\"release-table-title\">APK (Android)</h4>\n                  <button type=\"button\" class=\"release-info-btn\" aria-label=\"APK downloads info\">\n                    <span aria-hidden=\"true\">i</span>\n                    <span id=\"plws-rel-visibleListHintApk\" class=\"release-info-tip\" role=\"tooltip\"></span>\n                  </button>\n                </div>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table\">\n                    <thead>\n                      <tr>\n                        <th>Role</th>\n                        <th>Version</th>\n                        <th>Date</th>\n                        <th>File</th>\n                        <th class=\"col-action\"></th>\n                      </tr>\n                    </thead>\n                    <tbody id=\"plws-rel-visibleReleaseTableApk\"></tbody>\n                  </table>\n                </div>\n                <p id=\"plws-rel-visibleReleaseEmptyApk\" class=\"release-table-empty\" hidden>No APK published yet.</p>\n              </div>\n            </div>\n            <div class=\"release-actions-row\">\n              <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"plws-rel-saveDownloadsSettingsBtn\" data-plws-edit>Save downloads setting</button>\n            </div>\n\n            </div>\n\n            <div class=\"plws-card\">\n\n            <h3 style=\"margin:0 0 0.35rem;font-size:1rem\">Hidden / outdated releases</h3>\n            <div class=\"settings-grid\" style=\"margin-top:0.75rem\">\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-rel-outdatedMaxKeep\">Max hidden builds to keep (0 = no limit)</label>\n                <input id=\"plws-rel-outdatedMaxKeep\" data-plws-edit type=\"number\" min=\"0\" max=\"100\" step=\"1\" />\n              </div>\n            </div>\n            <select id=\"plws-rel-outdatedPolicy\" hidden aria-hidden=\"true\">\n              <option value=\"keep\" selected>Keep in admin list</option>\n              <option value=\"auto_delete\">Auto-delete from the server</option>\n            </select>\n            <div class=\"release-tables-grid\">\n              <div class=\"release-table-panel\">\n                <div class=\"release-table-head\">\n                  <h4 class=\"release-table-title\">EXE (Windows)</h4>\n                  <button type=\"button\" class=\"release-info-btn\" aria-label=\"Hidden EXE info\">\n                    <span aria-hidden=\"true\">i</span>\n                    <span id=\"plws-rel-outdatedListHintExe\" class=\"release-info-tip\" role=\"tooltip\"></span>\n                  </button>\n                </div>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table\">\n                    <thead>\n                      <tr>\n                        <th>Version</th>\n                        <th>Date</th>\n                        <th>File</th>\n                        <th class=\"col-action\"></th>\n                      </tr>\n                    </thead>\n                    <tbody id=\"plws-rel-outdatedTableExe\"></tbody>\n                  </table>\n                </div>\n                <p id=\"plws-rel-outdatedEmptyExe\" class=\"release-table-empty\" hidden>No outdated EXE builds.</p>\n              </div>\n              <div class=\"release-table-panel\">\n                <div class=\"release-table-head\">\n                  <h4 class=\"release-table-title\">APK (Android)</h4>\n                  <button type=\"button\" class=\"release-info-btn\" aria-label=\"Hidden APK info\">\n                    <span aria-hidden=\"true\">i</span>\n                    <span id=\"plws-rel-outdatedListHintApk\" class=\"release-info-tip\" role=\"tooltip\"></span>\n                  </button>\n                </div>\n                <div class=\"release-table-wrap\">\n                  <table class=\"release-table\">\n                    <thead>\n                      <tr>\n                        <th>Version</th>\n                        <th>Date</th>\n                        <th>File</th>\n                        <th class=\"col-action\"></th>\n                      </tr>\n                    </thead>\n                    <tbody id=\"plws-rel-outdatedTableApk\"></tbody>\n                  </table>\n                </div>\n                <p id=\"plws-rel-outdatedEmptyApk\" class=\"release-table-empty\" hidden>No outdated APK builds.</p>\n              </div>\n            </div>\n            <div class=\"release-actions-row\">\n              <button type=\"button\" class=\"btn btn-secondary btn-sm btn-danger\" id=\"plws-rel-deleteAllOutdatedBtn\" data-plws-edit>\n                Delete all outdated\n              </button>\n              <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"plws-rel-saveSettingsBtn\" data-plws-edit>Save hidden settings</button>\n            </div>\n\n            </div>",
    init: function (root, $, W) {
      (function () {

        var statusEl = $("status");
        var authBox = $("authBox");
        var uploadBox = $("uploadBox");
        var whoEl = $("who");
        var progressEl = $("progress");
        var outBtn = $("outBtn");
        var deleteAllOutdatedBtn = $("deleteAllOutdatedBtn");
        var visibleReleaseTableExe = $("visibleReleaseTableExe");
        var visibleReleaseTableApk = $("visibleReleaseTableApk");
        var visibleReleaseEmptyExe = $("visibleReleaseEmptyExe");
        var visibleReleaseEmptyApk = $("visibleReleaseEmptyApk");
        var outdatedTableExe = $("outdatedTableExe");
        var outdatedTableApk = $("outdatedTableApk");
        var outdatedEmptyExe = $("outdatedEmptyExe");
        var outdatedEmptyApk = $("outdatedEmptyApk");
        var downloadsMaxOldExeInput = $("downloadsMaxOldExe");
        var downloadsMaxOldApkInput = $("downloadsMaxOldApk");
        var outdatedPolicySelect = $("outdatedPolicy");
        var outdatedMaxKeepInput = $("outdatedMaxKeep");
        var saveSettingsBtn = $("saveSettingsBtn");
        var saveDownloadsSettingsBtn = $("saveDownloadsSettingsBtn");
        var visibleListHintExe = $("visibleListHintExe");
        var visibleListHintApk = $("visibleListHintApk");
        var outdatedListHintExe = $("outdatedListHintExe");
        var outdatedListHintApk = $("outdatedListHintApk");
        var cachedManifest = null;
        var cachedSettings = normalizeReleaseSettings(null);
        var settingsFileCorrupt = false;

        function normalizeReleaseSettings(raw) {
          return typeof RS.normalizeReleaseSettings === "function"
            ? RS.normalizeReleaseSettings(raw)
            : { downloadsMaxOldExe: 5, downloadsMaxOldApk: 5, outdatedPolicy: "keep", outdatedMaxKeep: 20 };
        }

        function cloneReleaseEntry(entry) {
          return typeof RS.cloneReleaseEntry === "function"
            ? RS.cloneReleaseEntry(entry)
            : entry;
        }

        function buildRotation(prev, next) {
          return typeof RS.buildReleaseRotation === "function"
            ? RS.buildReleaseRotation(prev, next, cachedSettings)
            : { history: [], outdated: [], deleteEntries: [] };
        }

        function reconcileManifest(manifest, settings, mode) {
          if (mode === "hidden") {
            return typeof RS.reconcileHiddenSettings === "function"
              ? RS.reconcileHiddenSettings(manifest, settings)
              : { history: [], outdated: [], deleteEntries: [], spilledCount: 0, promotedCount: 0 };
          }
          return typeof RS.reconcileDownloadsSettings === "function"
            ? RS.reconcileDownloadsSettings(manifest, settings)
            : typeof RS.reconcileManifestWithSettings === "function"
              ? RS.reconcileManifestWithSettings(manifest, settings)
              : { history: [], outdated: [], deleteEntries: [], spilledCount: 0, promotedCount: 0 };
        }

        function readSettingsFromForm() {
          return normalizeReleaseSettings({
            downloadsMaxOldExe: downloadsMaxOldExeInput && downloadsMaxOldExeInput.value,
            downloadsMaxOldApk: downloadsMaxOldApkInput && downloadsMaxOldApkInput.value,
            outdatedPolicy: outdatedPolicySelect && outdatedPolicySelect.value,
            outdatedMaxKeep: outdatedMaxKeepInput && outdatedMaxKeepInput.value,
          });
        }

        async function applySettingsSave(mode) {
          var nextSettings = readSettingsFromForm();
          try {
            setStatus("Saving release settings.", true);
            var dry = await W.post("/admin/releases/settings", {
              mode: mode,
              settings: nextSettings,
              dryRun: true,
            });
            var deleteList = Array.isArray(dry.deleteEntries) ? dry.deleteEntries : [];
            if (deleteList.length > 0) {
              var okDelete = await confirmDialog({
                title: "Delete builds?",
                message: "Delete " + deleteList.length + " build(s) from the server permanently?",
                items: deleteList.map(entrySummaryLabel),
                confirmLabel: "Delete permanently",
                danger: true,
              });
              if (!okDelete) {
                applySettingsToForm();
                setStatus("Settings not saved - delete cancelled.", false);
                return;
              }
            }
            var res = await W.post("/admin/releases/settings", {
              mode: mode,
              settings: nextSettings,
            });
            cachedManifest = res.manifest || cachedManifest;
            cachedSettings = normalizeReleaseSettings(res.settings || nextSettings);
            applySettingsToForm();
            renderVisibleReleaseList();
            renderOutdatedList();
            if (mode === "downloads" && res.spilledCount > 0 && nextSettings.outdatedPolicy === "keep") {
              setStatus("Settings saved. Moved " + res.spilledCount + " build(s) to Hidden / outdated.", true);
            } else if (mode === "downloads" && res.promotedCount > 0) {
              setStatus("Settings saved. Moved " + res.promotedCount + " build(s) to Downloads dropdown.", true);
            } else if (deleteList.length > 0) {
              setStatus("Settings saved. Deleted " + deleteList.length + " build(s) from the server.", true);
            } else {
              setStatus("Release settings saved.", true);
            }
          } catch (err) {
            applySettingsToForm();
            setStatus(err.message || String(err), false);
          }
        }

        async function saveDownloadsSettings() {
          await applySettingsSave("downloads");
        }

        async function saveHiddenSettings() {
          await applySettingsSave("hidden");
        }

        async function saveSettings() {
          await saveHiddenSettings();
        }

        function entrySummaryLabel(entry) {
          var bits = [entry.date || "unknown"];
          if (entry.windows && entry.windows.version) bits.push("EXE v" + entry.windows.version);
          if (entry.windows && entry.windows.file) bits.push(entry.windows.file);
          var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
          if (apk && apk.version) bits.push("APK v" + apk.version);
          if (apk && apk.file) bits.push(apk.file);
          return bits.join(" · ");
        }

        function confirmDialog(options) {
          return W.confirm(options);
        }

        function isApkAndroid(item) {
          return typeof RS.isApkAndroidRelease === "function"
            ? RS.isApkAndroidRelease(item)
            : Boolean(item && item.url);
        }

        function entryLabelExe(entry) {
          var bits = [entry.date || "unknown"];
          if (entry.windows && entry.windows.version) bits.push("EXE v" + entry.windows.version);
          else bits.push("No EXE");
          return bits.join(" · ");
        }

        function entryLabelApk(entry) {
          var bits = [entry.date || "unknown"];
          var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
          if (apk && apk.version) bits.push("APK v" + apk.version);
          else bits.push("No APK");
          return bits.join(" · ");
        }

        function entryFilesLineExe(entry) {
          return (entry.windows && entry.windows.file) || "No EXE file";
        }

        function entryFilesLineApk(entry) {
          var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
          return (apk && apk.file) || "No APK file";
        }

        function entryVersion(entry, platform) {
          if (platform === "apk") {
            var apk = entry && entry.android && isApkAndroid(entry.android) ? entry.android : null;
            return (apk && apk.version) || "—";
          }
          return (entry && entry.windows && entry.windows.version) || "—";
        }

        function entryLabel(entry, platform) {
          return platform === "apk" ? entryLabelApk(entry) : entryLabelExe(entry);
        }

        function entryFilesLine(entry, platform) {
          return platform === "apk" ? entryFilesLineApk(entry) : entryFilesLineExe(entry);
        }

        function entryHasPlatform(entry, platform) {
          if (platform === "apk") {
            return Boolean(entry.android && isApkAndroid(entry.android));
          }
          return Boolean(entry.windows && entry.windows.url);
        }

        function updateSettingsHint() {
          var maxExe = cachedSettings.downloadsMaxOldExe;
          var maxApk = cachedSettings.downloadsMaxOldApk;
          var exeHint =
            "Users see latest + " +
            maxExe +
            " older EXE (" +
            (maxExe + 1) +
            " max) in the Downloads dropdown.";
          var apkHint =
            "Users see latest + " +
            maxApk +
            " older APK (" +
            (maxApk + 1) +
            " max) in the Downloads dropdown.";
          if (visibleListHintExe) visibleListHintExe.textContent = exeHint;
          if (visibleListHintApk) visibleListHintApk.textContent = apkHint;

          var hiddenHint =
            cachedSettings.outdatedPolicy === "auto_delete"
              ? "Hidden builds are auto-deleted from the server when they leave the downloads list."
              : cachedSettings.outdatedMaxKeep <= 0
                ? "Hidden builds are kept here (no limit). Delete removes files permanently."
                : "Hidden builds are kept here (max " +
                  cachedSettings.outdatedMaxKeep +
                  "). Delete removes files permanently.";
          if (outdatedListHintExe) outdatedListHintExe.textContent = hiddenHint;
          if (outdatedListHintApk) outdatedListHintApk.textContent = hiddenHint;
        }

        function applySettingsToForm() {
          if (downloadsMaxOldExeInput) {
            downloadsMaxOldExeInput.value = String(cachedSettings.downloadsMaxOldExe);
          }
          if (downloadsMaxOldApkInput) {
            downloadsMaxOldApkInput.value = String(cachedSettings.downloadsMaxOldApk);
          }
          if (outdatedPolicySelect) outdatedPolicySelect.value = cachedSettings.outdatedPolicy;
          if (outdatedMaxKeepInput) outdatedMaxKeepInput.value = String(cachedSettings.outdatedMaxKeep);
          updateSettingsHint();
        }

        function findHistoryIndex(entry, platform) {
          if (!cachedManifest || !Array.isArray(cachedManifest.history)) return null;
          for (var i = 0; i < cachedManifest.history.length; i++) {
            var hist = cachedManifest.history[i];
            if (platform === "apk") {
              var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
              var histApk = hist.android && isApkAndroid(hist.android) ? hist.android : null;
              if (apk && histApk && String(apk.url || "") === String(histApk.url || "")) return i;
              if (
                apk &&
                histApk &&
                String(entry.date || "") === String(hist.date || "") &&
                String(apk.version || "") === String(histApk.version || "")
              ) {
                return i;
              }
            } else if (entry.windows && hist.windows) {
              if (String(entry.windows.url || "") === String(hist.windows.url || "")) return i;
              if (
                String(entry.date || "") === String(hist.date || "") &&
                String(entry.windows.version || "") === String(hist.windows.version || "")
              ) {
                return i;
              }
            }
          }
          return null;
        }

        function visibleEntriesForPlatform(platform) {
          if (typeof RS.buildPublicDownloadEntries !== "function" || !cachedManifest) return [];
          var kind = platform === "apk" ? "android" : "windows";
          return RS.buildPublicDownloadEntries(cachedManifest, cachedSettings, kind);
        }

        function setStatus(msg, ok) {
          statusEl.textContent = msg || "";
          statusEl.className = "status plws-status " + (ok ? "ok" : "err");
        }

        function todayStamp() {
          var d = new Date();
          return (
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0")
          );
        }

        function bytesLabel(n) {
          if (!n) return "";
          if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
          return (n / (1024 * 1024)).toFixed(1) + " MB";
        }

        function optionalText(id) {
          return String($(id).value || "").trim();
        }

        function renderVisibleReleaseList() {
          renderVisiblePlatformTable("exe", visibleReleaseTableExe, visibleReleaseEmptyExe);
          renderVisiblePlatformTable("apk", visibleReleaseTableApk, visibleReleaseEmptyApk);
        }

        function renderVisiblePlatformTable(platform, tbodyEl, emptyEl) {
          if (!tbodyEl) return;
          tbodyEl.innerHTML = "";
          if (!cachedManifest || (!cachedManifest.windows && !cachedManifest.android)) {
            if (emptyEl) emptyEl.hidden = false;
            return;
          }

          var entries = visibleEntriesForPlatform(platform);
          if (!entries.length) {
            if (emptyEl) emptyEl.hidden = false;
            return;
          }
          if (emptyEl) emptyEl.hidden = true;

          var olderNum = 0;
          entries.forEach(function (entry) {
            var roleLabel;
            var historyIndex;
            if (entry.latest) {
              roleLabel = "Latest";
              historyIndex = null;
            } else {
              olderNum += 1;
              roleLabel = "Older #" + olderNum;
              historyIndex = findHistoryIndex(entry, platform);
            }
            appendVisibleReleaseTableRow(tbodyEl, entry, roleLabel, historyIndex, platform);
          });
        }

        function appendVisibleReleaseTableRow(tbodyEl, entry, roleLabel, historyIndex, platform) {
          var tr = document.createElement("tr");
          var roleTd = document.createElement("td");
          roleTd.textContent = roleLabel;
          var versionTd = document.createElement("td");
          versionTd.textContent = "v" + entryVersion(entry, platform);
          var dateTd = document.createElement("td");
          dateTd.textContent = entry.date || "—";
          var fileTd = document.createElement("td");
          fileTd.textContent = entryFilesLine(entry, platform);
          var actionTd = document.createElement("td");
          actionTd.className = "col-action";
          var del = document.createElement("button");
          del.type = "button";
          del.className = "btn btn-secondary btn-sm btn-danger";
          del.textContent = historyIndex === null ? "Latest" : "Delete";
          del.disabled = historyIndex === null;
          if (historyIndex !== null) {
            del.onclick = function () {
              void deleteHistoryRelease(historyIndex);
            };
          }
          actionTd.appendChild(del);
          tr.appendChild(roleTd);
          tr.appendChild(versionTd);
          tr.appendChild(dateTd);
          tr.appendChild(fileTd);
          tr.appendChild(actionTd);
          tbodyEl.appendChild(tr);
        }

        function renderOutdatedList() {
          renderOutdatedPlatformTable("exe", outdatedTableExe, outdatedEmptyExe);
          renderOutdatedPlatformTable("apk", outdatedTableApk, outdatedEmptyApk);
        }

        function renderOutdatedPlatformTable(platform, tbodyEl, emptyEl) {
          if (!tbodyEl) return;
          var list = (cachedManifest && Array.isArray(cachedManifest.outdated) ? cachedManifest.outdated : [])
            .filter(function (entry) {
              return entryHasPlatform(entry, platform);
            })
            .map(function (entry, filteredIdx) {
              var realIdx = cachedManifest.outdated.indexOf(entry);
              return { entry: entry, index: realIdx >= 0 ? realIdx : filteredIdx };
            });
          tbodyEl.innerHTML = "";
          if (emptyEl) emptyEl.hidden = list.length > 0;
          list.forEach(function (row) {
            appendOutdatedTableRow(tbodyEl, row.entry, row.index, platform);
          });
        }

        function appendOutdatedTableRow(tbodyEl, entry, index, platform) {
          var tr = document.createElement("tr");
          var versionTd = document.createElement("td");
          versionTd.textContent = "v" + entryVersion(entry, platform);
          var dateTd = document.createElement("td");
          dateTd.textContent = entry.date || "—";
          var fileTd = document.createElement("td");
          fileTd.textContent = entryFilesLine(entry, platform);
          var actionTd = document.createElement("td");
          actionTd.className = "col-action";
          var del = document.createElement("button");
          del.type = "button";
          del.className = "btn btn-secondary btn-sm btn-danger";
          del.textContent = "Delete";
          del.onclick = function () {
            void hardDeleteOutdated(index);
          };
          actionTd.appendChild(del);
          tr.appendChild(versionTd);
          tr.appendChild(dateTd);
          tr.appendChild(fileTd);
          tr.appendChild(actionTd);
          tbodyEl.appendChild(tr);
        }

        async function loadManifest() {
          try {
            var res = await W.get("/admin/releases");
            cachedManifest = res.manifest || { history: [], outdated: [] };
            cachedSettings = normalizeReleaseSettings(res.settings);
            settingsFileCorrupt = false;
          } catch (err) {
            cachedManifest = { history: [], outdated: [] };
            setStatus("Could not load releases. " + (err.message || ""), false);
          }
          applySettingsToForm();
          renderVisibleReleaseList();
          renderOutdatedList();
        }

        async function deleteBuild(body, title, message, items, okStatus) {
          if (
            !(await confirmDialog({
              title: title,
              message: message,
              items: items,
              confirmLabel: "Delete",
              danger: true,
            }))
          ) {
            return;
          }
          try {
            setStatus("Deleting release files.", true);
            var res = await W.post("/admin/releases/delete", body);
            cachedManifest = res.manifest || cachedManifest;
            renderVisibleReleaseList();
            renderOutdatedList();
            setStatus(okStatus, true);
          } catch (err) {
            setStatus(err.message || String(err), false);
          }
        }

        async function deleteHistoryRelease(index) {
          if (!cachedManifest || !Array.isArray(cachedManifest.history)) return;
          var entry = cachedManifest.history[index];
          if (!entry) return;
          await deleteBuild(
            { list: "history", index: index, date: entry.date },
            "Remove from Downloads?",
            "Remove this build from the public Downloads list and delete its files from the server?",
            [entrySummaryLabel(entry)],
            "Deleted older release " + entrySummaryLabel(entry)
          );
        }

        async function deleteAllOutdated() {
          var list = (cachedManifest && Array.isArray(cachedManifest.outdated) ? cachedManifest.outdated : []).slice();
          if (!list.length) {
            setStatus("No outdated builds to delete.", true);
            return;
          }
          await deleteBuild(
            { list: "outdatedAll" },
            "Delete all outdated?",
            "Delete ALL " + list.length + " outdated build(s) from the server permanently?",
            null,
            "Deleted all outdated builds (" + list.length + ")."
          );
        }

        async function hardDeleteOutdated(index) {
          if (!cachedManifest || !Array.isArray(cachedManifest.outdated)) return;
          var entry = cachedManifest.outdated[index];
          if (!entry) return;
          await deleteBuild(
            { list: "outdated", index: index, date: entry.date },
            "Hard delete?",
            "Hard delete this outdated release from the server?",
            [entrySummaryLabel(entry)],
            "Hard-deleted outdated release " + entrySummaryLabel(entry)
          );
        }

        function showAuthedUi() {
          void loadManifest();
        }

        if (deleteAllOutdatedBtn) {
          deleteAllOutdatedBtn.onclick = function () {
            void deleteAllOutdated();
          };
        }
        if (saveSettingsBtn) {
          saveSettingsBtn.onclick = function () {
            void saveSettings();
          };
        }
        if (saveDownloadsSettingsBtn) {
          saveDownloadsSettingsBtn.onclick = function () {
            void saveDownloadsSettings();
          };
        }


            showAuthedUi();

        $("publishBtn").onclick = async function () {
          var exe = $("exeFile").files[0];
          var apk = $("apkFile").files[0];
          var windowsVersion = optionalText("windowsVersion");
          var androidVersion = optionalText("androidVersion");
          var playStoreUrl = optionalText("playStoreUrl");
          if (!exe && !apk && !playStoreUrl) {
            setStatus("Pick at least one file (EXE or APK).", false);
            return;
          }
          if (exe && !windowsVersion) {
            setStatus("Enter the Windows version for the EXE.", false);
            return;
          }
          if (apk && !androidVersion) {
            setStatus("Enter the Android version for the APK.", false);
            return;
          }
          if (playStoreUrl) {
            try {
              new URL(playStoreUrl);
            } catch (_) {
              setStatus("Play Store link must be a full https URL.", false);
              return;
            }
          }
          var date = $("dateField").value || todayStamp();
          var btn = $("publishBtn");
          btn.disabled = true;
          progressEl.hidden = false;
          progressEl.value = 0;
          try {
            var body = { date: date };
            var share = exe && apk ? 50 : 100;
            var base = 0;
            if (exe) {
              setStatus("Uploading EXE to the server.", true);
              var exeBase = base;
              var up1 = await W.uploadFile(exe, date, function (p) {
                progressEl.value = exeBase + Math.round((p * share) / 100);
              });
              body.windows = { file: up1.file, version: windowsVersion };
              base += share;
            }
            if (apk) {
              setStatus("Uploading APK to the server.", true);
              var apkBase = base;
              var up2 = await W.uploadFile(apk, date, function (p) {
                progressEl.value = apkBase + Math.round((p * share) / 100);
              });
              body.android = { file: up2.file, version: androidVersion };
            }
            if (playStoreUrl) body.playStoreUrl = playStoreUrl;
            setStatus("Publishing.", true);
            var res = await W.post("/admin/releases/publish", body);
            cachedManifest = res.manifest || cachedManifest;
            renderVisibleReleaseList();
            renderOutdatedList();
            progressEl.value = 100;
            var man = cachedManifest || {};
            setStatus(
              "Published " + date + " - kept " + (1 + (man.history || []).length) + ", outdated " + (man.outdated || []).length,
              true
            );
          } catch (err) {
            setStatus(err.message || String(err), false);
          } finally {
            btn.disabled = false;
          }
        };

        $("dateField").value = todayStamp();
        $("windowsVersion").value = "1.0.0";
        $("androidVersion").value = "1.0.0";
      })();
    },
  };

  VIEWS.videos = {
    pfx: "vid",
    html: "<div class=\"plws-card\" data-plws-edit><h3 class=\"plws-h3\">Add video</h3>\n            <div class=\"form-grid\">\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-vid-videoTitle\">Title</label>\n                <input id=\"plws-vid-videoTitle\" type=\"text\" placeholder=\"How to create a company\" />\n              </div>\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-vid-videoUrl\">Video URL</label>\n                <input id=\"plws-vid-videoUrl\" type=\"url\" placeholder=\"https://www.youtube.com/watch?v=...\" />\n              </div>\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-vid-videoLabel\">Label</label>\n                <select id=\"plws-vid-videoLabel\">\n                  <option value=\"howto\">How to use</option>\n                  <option value=\"tutorial\">Tutorial</option>\n                  <option value=\"learning\">Learning</option>\n                  <option value=\"event\">Event</option>\n                  <option value=\"update\">Update</option>\n                </select>\n              </div>\n              <div class=\"row\" style=\"margin:0\">\n                <label for=\"plws-vid-videoCategory\">Category</label>\n                <select id=\"plws-vid-videoCategory\"></select>\n              </div>\n              <div class=\"check-row\">\n                <input id=\"plws-vid-videoPublished\" type=\"checkbox\" checked />\n                <label for=\"plws-vid-videoPublished\" style=\"margin:0;font-weight:600\">Show on website</label>\n                <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"plws-vid-addVideoBtn\" style=\"margin-left:auto\">Add video</button>\n              </div>\n            </div>\n            </div><div class=\"plws-card\">\n            <div class=\"video-admin-tools\">\n              <label class=\"video-admin-search\">\n                <span class=\"sr-only\">Search videos</span>\n                <input id=\"plws-vid-videoSearch\" type=\"search\" placeholder=\"Search title, category, URL…\" autocomplete=\"off\" />\n              </label>\n              <div class=\"video-admin-tabs\" id=\"plws-vid-videoPlatformTabs\" role=\"tablist\" aria-label=\"Video platform\">\n                <button type=\"button\" class=\"video-admin-tab is-active\" data-platform=\"all\" aria-pressed=\"true\">All <span id=\"plws-vid-tabCountAll\">0</span></button>\n                <button type=\"button\" class=\"video-admin-tab\" data-platform=\"youtube\" aria-pressed=\"false\">YouTube <span id=\"plws-vid-tabCountYoutube\">0</span></button>\n                <button type=\"button\" class=\"video-admin-tab\" data-platform=\"facebook\" aria-pressed=\"false\">Facebook <span id=\"plws-vid-tabCountFacebook\">0</span></button>\n                <button type=\"button\" class=\"video-admin-tab\" data-platform=\"tiktok\" aria-pressed=\"false\">TikTok <span id=\"plws-vid-tabCountTiktok\">0</span></button>\n              </div>\n            </div>\n            <div id=\"plws-vid-videoGroups\"></div>\n          </div>",
    init: function (root, $, W) {
      (function () {
        "use strict";

        var LABEL_COPY = {
          howto: "How to use",
          tutorial: "Tutorial",
          learning: "Learning",
          event: "Event",
          update: "Update",
        };
        var CATEGORY_COPY = {
          "getting-started": "Getting started",
          dashboard: "Dashboard",
          party: "Parties",
          "bank-cash": "Bank/Cash",
          staff: "Staff",
          tax: "Tax",
          incomes: "Income & Expense",
          items: "Items & Service",
          reports: "Reports",
          gallery: "Gallery",
          gate: "Gate",
          production: "Production",
          "sale-note": "Sale Note",
          "purchase-note": "Purchase Note",
          quotations: "Quotations",
          messages: "Messages",
          "drive-sync": "Google Drive sync",
          billing: "Billing & Plans",
          "distributor-signup": "Be a Distributor",
          backup: "Backup & Restore",
          "import-export": "Import/Export",
          "recycle-bin": "Recycle Bin",
          settings: "Settings",
        };
        var LEGACY_CATEGORY = {
          "sales-purchase": "sale-note",
          "accounts-reports": "reports",
          "settings-sync": "settings",
          "updates-events": "getting-started",
        };

        var statusEl = $("status");
        var authBox = $("authBox");
        var adminBox = $("adminBox");
        var whoEl = $("who");
        var outBtn = $("outBtn");
        var groupsEl = $("videoGroups");
        var videos = [];
        var engagement = {};
        var featureConfig = {};
        var activePlatform = "all";
        var searchQuery = "";
        var CATEGORY_ORDER = [
          "getting-started",
          "dashboard",
          "party",
          "bank-cash",
          "staff",
          "tax",
          "incomes",
          "items",
          "reports",
          "gallery",
          "gate",
          "production",
          "sale-note",
          "purchase-note",
          "quotations",
          "messages",
          "drive-sync",
          "billing",
          "distributor-signup",
          "backup",
          "import-export",
          "recycle-bin",
          "settings",
        ];

        function setStatus(msg, ok) {
          if (!statusEl) return;
          statusEl.textContent = msg || "";
          statusEl.className = "status plws-status " + (ok ? "ok" : "err");
        }

        function detectPlatform(url) {
          var raw = String(url || "").trim().toLowerCase();
          if (!raw) return null;
          if (raw.indexOf("youtu.be") !== -1 || raw.indexOf("youtube.com") !== -1) return "youtube";
          if (raw.indexOf("facebook.com") !== -1 || raw.indexOf("fb.watch") !== -1 || raw.indexOf("fb.com") !== -1) {
            return "facebook";
          }
          if (raw.indexOf("tiktok.com") !== -1) return "tiktok";
          return null;
        }

        function sanitize(raw) {
          var source =
            raw && typeof raw === "object" && Array.isArray(raw.videos)
              ? raw.videos
              : Array.isArray(raw)
                ? raw
                : [];
          var out = [];
          source.forEach(function (row, index) {
            if (!row || typeof row !== "object") return;
            var url = String(row.url || "").trim();
            var platform = detectPlatform(url);
            if (!url || !platform) return;
            out.push({
              id: String(row.id || "").trim() || "video-" + (index + 1),
              title: String(row.title || "").trim() || "Pocket Ledger video",
              url: url,
              platform: platform,
              label: LABEL_COPY[row.label] ? String(row.label) : "howto",
              category: (function () {
                var key = String(row.category || "").trim();
                if (CATEGORY_COPY[key]) return key;
                if (LEGACY_CATEGORY[key]) return LEGACY_CATEGORY[key];
                return "getting-started";
              })(),
              published: row.published !== false,
              sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : index,
            });
          });
          return out.sort(function (a, b) {
            return a.sort - b.sort || a.title.localeCompare(b.title);
          });
        }

        function youtubeId(url) {
          var match = String(url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
          return match ? match[1] : "";
        }

        function thumbUrl(video) {
          if (video.platform === "youtube") {
            var id = youtubeId(video.url);
            return id ? "https://img.youtube.com/vi/" + id + "/hqdefault.jpg" : "";
          }
          return "";
        }

        function formatEngage(videoId) {
          var e = engagement[videoId] || { views: 0, likes: 0, ratingAvg: 0, ratingCount: 0 };
          var avg = e.ratingCount ? Number(e.ratingAvg || 0).toFixed(1) : "-";
          return "Views " + (e.views || 0) + " \u00b7 Likes " + (e.likes || 0) + " \u00b7 Rating " + avg +
            (e.ratingCount ? " (" + e.ratingCount + ")" : "");
        }

        function platformCounts() {
          return {
            youtube: videos.filter(function (v) { return v.platform === "youtube"; }).length,
            facebook: videos.filter(function (v) { return v.platform === "facebook"; }).length,
            tiktok: videos.filter(function (v) { return v.platform === "tiktok"; }).length,
          };
        }

        function filteredList() {
          var q = searchQuery.trim().toLowerCase();
          return videos.filter(function (video) {
            if (activePlatform !== "all" && video.platform !== activePlatform) return false;
            if (!q) return true;
            return [
              video.title,
              video.url,
              CATEGORY_COPY[video.category] || video.category,
              LABEL_COPY[video.label] || video.label,
              video.platform,
            ].join(" ").toLowerCase().indexOf(q) !== -1;
          });
        }

        function updateTabs() {
          var counts = platformCounts();
          var map = {
            all: "tabCountAll",
            youtube: "tabCountYoutube",
            facebook: "tabCountFacebook",
            tiktok: "tabCountTiktok",
          };
          var allEl = $("tabCountAll");
          if (allEl) allEl.textContent = String(videos.length);
          Object.keys(map).forEach(function (key) {
            if (key === "all") return;
            var el = $(map[key]);
            if (el) el.textContent = String(counts[key] || 0);
          });
          root.querySelectorAll(".video-admin-tab").forEach(function (button) {
            var platform = button.getAttribute("data-platform") || "";
            var on = platform === activePlatform;
            button.classList.toggle("is-active", on);
            button.setAttribute("aria-pressed", on ? "true" : "false");
          });
        }

        function render() {
          if (!groupsEl) return;
          updateTabs();
          var list = filteredList();
          var title =
            activePlatform === "all"
              ? "All"
              : activePlatform === "youtube"
                ? "YouTube"
                : activePlatform === "facebook"
                  ? "Facebook"
                  : "TikTok";
          groupsEl.innerHTML = "";
          var head = document.createElement("h3");
          head.style.cssText = "margin:0 0 0.35rem;font-size:1rem";
          head.textContent = title + " (" + list.length + ")";
          groupsEl.appendChild(head);
          if (!list.length) {
            var empty = document.createElement("p");
            empty.style.cssText = "margin:0;color:var(--muted);font-size:0.88rem";
            empty.textContent = searchQuery.trim()
              ? "No videos match this search."
              : activePlatform === "all"
                ? "No videos yet."
                : "No " + activePlatform + " videos yet.";
            groupsEl.appendChild(empty);
            return;
          }
          var ul = document.createElement("ul");
          ul.className = "video-list";
          list.forEach(function (video) {
            var li = document.createElement("li");
            var thumb = document.createElement("div");
            thumb.className = "video-admin-thumb video-admin-thumb-" + video.platform;
            var image = thumbUrl(video);
            if (image) {
              var img = document.createElement("img");
              img.src = image;
              img.alt = "";
              img.loading = "lazy";
              thumb.appendChild(img);
            } else {
              thumb.textContent = video.platform === "facebook" ? "FB" : video.platform === "tiktok" ? "TT" : "▶";
            }
            var meta = document.createElement("div");
            meta.className = "video-meta";
            meta.innerHTML = "<strong></strong><span></span><em></em>";
            meta.querySelector("strong").textContent = video.title;
            meta.querySelector("span").textContent =
              (CATEGORY_COPY[video.category] || video.category) + " · " +
              (LABEL_COPY[video.label] || video.label) + " · " + video.url;
            meta.querySelector("em").textContent = formatEngage(video.id);
            var actions = document.createElement("div");
            actions.className = "plws-video-actions";
            actions.style.cssText = "display:flex;gap:0.5rem;align-items:center";
            var live = document.createElement("label");
            live.style.cssText = "display:flex;gap:0.35rem;align-items:center;font-size:0.88rem";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = video.published;
            cb.onchange = function () {
              void persist(
                videos.map(function (v) {
                  return v.id === video.id ? Object.assign({}, v, { published: cb.checked }) : v;
                })
              );
            };
            live.appendChild(cb);
            live.appendChild(document.createTextNode("Live"));
            var rm = document.createElement("button");
            rm.type = "button";
            rm.className = "btn btn-secondary btn-sm";
            rm.textContent = "Remove";
            rm.onclick = function () {
              W.confirm({
                title: "Remove video?",
                message: 'Remove "' + (video.title || "this video") + '"? This will delete it from the website videos list.',
                confirmLabel: "Remove",
                danger: true,
              }).then(function (ok) {
                if (ok) void persist(videos.filter(function (v) { return v.id !== video.id; }));
              });
            };
            actions.appendChild(live);
            actions.appendChild(rm);
            li.appendChild(thumb);
            li.appendChild(meta);
            li.appendChild(actions);
            ul.appendChild(li);
          });
          groupsEl.appendChild(ul);
        }

        function bindListTools() {
          var search = $("videoSearch");
          if (search) {
            search.addEventListener("input", function () {
              searchQuery = search.value || "";
              render();
            });
          }
          root.querySelectorAll(".video-admin-tab").forEach(function (button) {
            button.addEventListener("click", function () {
              activePlatform = button.getAttribute("data-platform") || "all";
              render();
            });
          });
        }

        function visibleCategories() {
          return CATEGORY_ORDER.filter(function (id) {
            if (id === "getting-started") return true;
            return featureConfig[id] !== false;
          });
        }

        function fillCategorySelect(preferred) {
          var select = $("videoCategory");
          if (!select) return;
          var visible = visibleCategories();
          var current = preferred || select.value || "getting-started";
          if (visible.indexOf(current) === -1) current = "getting-started";
          select.innerHTML = "";
          visible.forEach(function (id) {
            var opt = document.createElement("option");
            opt.value = id;
            opt.textContent = CATEGORY_COPY[id] || id;
            select.appendChild(opt);
          });
          select.value = current;
        }

        async function loadFeatures() {
          // Every category is offered (the old per-feature hiding came from the retired Firebase settings).
          featureConfig = {};
          fillCategorySelect();
        }

        function applyEngagement(byVideo) {
          engagement = {};
          var src = byVideo && typeof byVideo === "object" ? byVideo : {};
          Object.keys(src).forEach(function (id) {
            var row = src[id] || {};
            var ratingSum = Math.max(0, Math.floor(Number(row.ratingSum) || 0));
            var ratingCount = Math.max(0, Math.floor(Number(row.ratingCount) || 0));
            engagement[id] = {
              views: Math.max(0, Math.floor(Number(row.views) || 0)),
              likes: Math.max(0, Math.floor(Number(row.likes) || 0)),
              ratingSum: ratingSum,
              ratingCount: ratingCount,
              ratingAvg: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
            };
          });
        }

        async function load() {
          setStatus("Loading.", true);
          try {
            var data = await W.get("/admin/videos");
            videos = sanitize(data);
            applyEngagement(data && data.stats && data.stats.byVideo);
            await loadFeatures();
            render();
            setStatus("Ready.", true);
          } catch (e) {
            videos = [];
            render();
            setStatus("Could not load videos. " + ((e && e.message) || ""), false);
          }
        }

        async function persist(next) {
          try {
            var res = await W.post("/admin/videos", { videos: next });
            videos = sanitize(res);
            render();
            setStatus("Saved.", true);
          } catch (err) {
            setStatus("Save failed. " + ((err && err.message) || ""), false);
          }
        }

        async function addVideo() {
          var title = String($("videoTitle").value || "").trim();
          var url = String($("videoUrl").value || "").trim();
          var label = String($("videoLabel").value || "howto");
          var category = String($("videoCategory").value || "getting-started");
          if (visibleCategories().indexOf(category) === -1) {
            setStatus("That category is hidden in Add/Remove Features.", false);
            return;
          }
          var published = Boolean($("videoPublished").checked);
          var platform = detectPlatform(url);
          if (!platform) {
            setStatus("Paste a YouTube, Facebook, or TikTok link.", false);
            return;
          }
          var next = videos.concat([
            {
              id: "vid-" + Date.now(),
              title: title || "Pocket Ledger video",
              url: url,
              platform: platform,
              label: label,
              category: CATEGORY_COPY[category] ? category : "getting-started",
              published: published,
              sort: videos.length,
            },
          ]);
          await persist(next);
          activePlatform = platform;
          $("videoTitle").value = "";
          $("videoUrl").value = "";
          $("videoPublished").checked = true;
          $("videoLabel").value = "howto";
          fillCategorySelect("getting-started");
        }

        function init() {
          $("addVideoBtn").onclick = function () {
            void addVideo();
          };
          bindListTools();

              void load();
        }

        init();
      }());
    },
  };

  VIEWS.downloads = {
    pfx: "dl",
    html: "<div class=\"plws-card\">\n            <div class=\"dl-analytics-tabs\" role=\"tablist\" aria-label=\"Download analytics views\">\n              <button type=\"button\" class=\"dl-analytics-tab is-active\" data-dl-analytics-tab=\"new\" role=\"tab\" aria-selected=\"true\">New downloads</button>\n              <button type=\"button\" class=\"dl-analytics-tab\" data-dl-analytics-tab=\"update\" role=\"tab\" aria-selected=\"false\">Updates</button>\n            </div>\n            <div class=\"dl-update-version-wrap\" id=\"plws-dl-updateVersionFilterWrap\" hidden>\n              <label for=\"plws-dl-updateVersionFilter\">Version</label>\n              <select id=\"plws-dl-updateVersionFilter\" class=\"chart-range-select\" aria-label=\"Filter by release version\">\n                <option value=\"all\">All versions</option>\n              </select>\n            </div>\n            <div class=\"chart-card\">\n              <h3>Downloads chart</h3>\n              <div class=\"chart-grid\">\n                <div class=\"chart-platform-panel\">\n                  <p class=\"chart-block-title\">By platform</p>\n                  <div id=\"plws-dl-platformChart\"></div>\n                </div>\n                <div class=\"chart-timeline-panel\">\n                  <div class=\"chart-range-head\">\n                    <p class=\"chart-block-title\">Timeline</p>\n                    <select id=\"plws-dl-timelineRange\" class=\"chart-range-select\" aria-label=\"Chart range\">\n                      <optgroup label=\"Days\">\n                        <option value=\"days-14\">Last 14 days</option>\n                        <option value=\"days-30\" selected>Last 30 days</option>\n                      </optgroup>\n                      <optgroup label=\"Month\">\n                        <option value=\"months-12\">Last 12 months</option>\n                      </optgroup>\n                      <optgroup label=\"Year\">\n                        <option value=\"years-5\">Last 5 years</option>\n                      </optgroup>\n                    </select>\n                  </div>\n                  <div id=\"plws-dl-timelineChart\"></div>\n                  <div class=\"dl-chart-legend\" id=\"plws-dl-timelineLegend\" hidden>\n                    <span><i class=\"exe\" aria-hidden=\"true\"></i> EXE</span>\n                    <span><i class=\"apk\" aria-hidden=\"true\"></i> APK</span>\n                    <span><i class=\"play\" aria-hidden=\"true\"></i> Play Store</span>\n                  </div>\n                </div>\n              </div>\n            </div>\n            </div><div class=\"plws-card plws-card-free\"><div class=\"content-block\" style=\"padding:0;margin:0;border:0;background:transparent\">\n            <div style=\"display:flex;justify-content:flex-end;margin-bottom:0.75rem\">\n              <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"plws-dl-refreshBtn\">Refresh</button>\n            </div>\n            <div class=\"stat-grid\">\n              <div class=\"stat-box\"><div class=\"label\">Total</div><div class=\"value\" id=\"plws-dl-statTotal\">…</div></div>\n              <div class=\"stat-box\"><div class=\"label\">Windows EXE</div><div class=\"value\" id=\"plws-dl-statWindows\">…</div></div>\n              <div class=\"stat-box\"><div class=\"label\">Android APK</div><div class=\"value\" id=\"plws-dl-statAndroid\">…</div></div>\n              <div class=\"stat-box\"><div class=\"label\">Play Store</div><div class=\"value\" id=\"plws-dl-statPlay\">…</div></div>\n            </div>\n            <div class=\"dl-data-tables\">\n              <div class=\"dl-data-panel dl-data-panel-country\">\n                <h3>By country</h3>\n                <table class=\"ws-table dl-country-table\">\n                  <thead><tr><th>Country</th><th>Downloads</th></tr></thead>\n                  <tbody id=\"plws-dl-countryBody\"></tbody>\n                </table>\n              </div>\n              <div class=\"dl-data-panel dl-data-panel-recent\">\n                <div class=\"dl-recent-head\">\n                  <h3>Recent clicks</h3>\n                </div>\n                <div class=\"dl-recent-scroll\">\n                  <table class=\"ws-table dl-recent-table\">\n                    <thead><tr><th>When</th><th>Platform</th><th>Country</th><th>Email</th><th>Version</th><th>Owned company</th><th>Shared company</th><th>Date</th></tr></thead>\n                    <tbody id=\"plws-dl-recentBody\"></tbody>\n                  </table>\n                </div>\n                <div class=\"dl-recent-foot\">\n                  <div class=\"dl-recent-controls\">\n                    <label>\n                      Show\n                      <select id=\"plws-dl-recentPageSize\" class=\"dl-recent-page-size\" aria-label=\"Rows per page\">\n                        <option value=\"15\" selected>15</option>\n                        <option value=\"25\">25</option>\n                        <option value=\"50\">50</option>\n                        <option value=\"75\">75</option>\n                        <option value=\"100\">100</option>\n                      </select>\n                      per page\n                    </label>\n                    <span class=\"dl-recent-page-info\" id=\"plws-dl-recentPageInfo\">…</span>\n                    <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"plws-dl-recentPrevBtn\">Prev</button>\n                    <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"plws-dl-recentNextBtn\">Next</button>\n                  </div>\n                </div>\n              </div>\n            </div>\n            </div>\n          </div>",
    init: function (root, $, W) {
      (function () {
        "use strict";

        var statusEl = $("status");
        var authBox = $("authBox");
        var adminBox = $("adminBox");
        var whoEl = $("who");
        var outBtn = $("outBtn");
        var cachedRecent = [];
        var cachedRecentAll = [];
        var cachedStatsNew = { total: 0, byPlatform: {} };
        var cachedStatsUpdate = { total: 0, byPlatform: {} };
        var currentReleaseVersion = "";
        var activeAnalyticsTab = "new";
        var updateVersionFilter = "all";
        var cachedEmailProfiles = {};
        var emailAnchorByEmail = {};
        var recentPage = 1;
        var expandedCompanyRowId = null;
        var expandedCompanyKind = null;
        var RECENT_SCROLL_ROW_THRESHOLD = 20;
        var PLATFORM_ROWS = [
          { key: "windows", className: "exe" },
          { key: "android", className: "apk" },
          { key: "play", className: "play" },
        ];

        function setStatus(msg, ok) {
          if (!statusEl) return;
          statusEl.textContent = msg || "";
          statusEl.className = "status plws-status " + (ok ? "ok" : "err");
        }

        function countryLabel(code) {
          var c = String(code || "ZZ").toUpperCase();
          if (c === "ZZ") return "Unknown";
          try {
            return new Intl.DisplayNames(["en"], { type: "region" }).of(c) || c;
          } catch (_) {
            return c;
          }
        }

        function formatWhen(ms) {
          if (!ms) return "—";
          try {
            return new Date(ms).toLocaleString();
          } catch (_) {
            return "—";
          }
        }

        function setText(id, value) {
          var el = $(id);
          if (el) el.textContent = value;
        }

        function compareVersions(a, b) {
          var left = String(a || "0")
            .split(/[.-]/)
            .map(function (part) {
              return Number(part) || 0;
            });
          var right = String(b || "0")
            .split(/[.-]/)
            .map(function (part) {
              return Number(part) || 0;
            });
          var size = Math.max(left.length, right.length);
          for (var i = 0; i < size; i += 1) {
            var delta = (left[i] || 0) - (right[i] || 0);
            if (delta !== 0) return delta;
          }
          return 0;
        }

        function eventKindOf(row) {
          return row && row.eventKind === "update" ? "update" : "new";
        }

        function eventsForActiveTab() {
          return cachedRecentAll.filter(function (row) {
            if (eventKindOf(row) !== activeAnalyticsTab) return false;
            if (activeAnalyticsTab === "update" && updateVersionFilter !== "all") {
              return String(row.version || "") === updateVersionFilter;
            }
            return true;
          });
        }

        function byCountryFromEvents(rows) {
          var map = {};
          (rows || []).forEach(function (row) {
            var c = String(row.country || "ZZ");
            map[c] = (map[c] || 0) + 1;
          });
          return Object.keys(map)
            .map(function (country) {
              return { country: country, count: map[country] };
            })
            .sort(function (a, b) {
              return b.count - a.count || a.country.localeCompare(b.country);
            });
        }

        function populateUpdateVersionSelect() {
          var sel = $("updateVersionFilter");
          if (!sel) return;
          var versions = {};
          cachedRecentAll.forEach(function (row) {
            if (eventKindOf(row) !== "update") return;
            var v = String(row.version || "").trim();
            if (v) versions[v] = true;
          });
          if (currentReleaseVersion) versions[currentReleaseVersion] = true;
          var list = Object.keys(versions).sort(function (a, b) {
            return compareVersions(b, a);
          });
          var prev = updateVersionFilter;
          sel.innerHTML = "";
          var allOpt = document.createElement("option");
          allOpt.value = "all";
          allOpt.textContent = "All versions";
          sel.appendChild(allOpt);
          list.forEach(function (v) {
            var opt = document.createElement("option");
            opt.value = v;
            opt.textContent = "v" + v;
            sel.appendChild(opt);
          });
          if (prev && (prev === "all" || versions[prev])) {
            updateVersionFilter = prev;
          } else if (currentReleaseVersion && versions[currentReleaseVersion]) {
            updateVersionFilter = currentReleaseVersion;
          } else {
            updateVersionFilter = "all";
          }
          sel.value = updateVersionFilter;
        }

        function statsFromEvents(rows) {
          var byPlatform = { windows: 0, android: 0, play: 0 };
          (rows || []).forEach(function (row) {
            var p = String(row.platform || "");
            if (p === "windows" || p === "android" || p === "play") {
              byPlatform[p] += 1;
            }
          });
          var total = byPlatform.windows + byPlatform.android + byPlatform.play;
          return { total: total, byPlatform: byPlatform };
        }

        function applyAnalyticsView() {
          cachedRecent = eventsForActiveTab();
          var stats;
          if (activeAnalyticsTab === "update" && updateVersionFilter !== "all") {
            stats = statsFromEvents(cachedRecent);
          } else {
            stats = activeAnalyticsTab === "update" ? cachedStatsUpdate : cachedStatsNew;
          }
          var byPlatform = stats.byPlatform || {};
          setText("statTotal", String(stats.total || 0));
          setText("statWindows", String(byPlatform.windows || 0));
          setText("statAndroid", String(byPlatform.android || 0));
          setText("statPlay", String(byPlatform.play || 0));
          renderPlatformChart(byPlatform);
          rebuildEmailAnchors();
          recentPage = 1;
          renderTimelineChart(cachedRecent);

          var countryBody = $("countryBody");
          var byCountry = byCountryFromEvents(cachedRecent);
          if (countryBody) {
            countryBody.innerHTML = "";
            if (!byCountry.length) {
              countryBody.innerHTML = '<tr><td colspan="2">No downloads recorded yet.</td></tr>';
            } else {
              byCountry.forEach(function (row) {
                var tr = document.createElement("tr");
                tr.innerHTML = "<td></td><td></td>";
                tr.children[0].textContent = countryLabel(row.country) + " (" + row.country + ")";
                tr.children[1].textContent = String(row.count || 0);
                countryBody.appendChild(tr);
              });
            }
          }
          renderRecentTable();
        }

        function setAnalyticsTab(tab) {
          activeAnalyticsTab = tab === "update" ? "update" : "new";
          var wrap = $("updateVersionFilterWrap");
          if (wrap) wrap.hidden = activeAnalyticsTab !== "update";
          root.querySelectorAll("[data-dl-analytics-tab]").forEach(function (btn) {
            var isActive = btn.getAttribute("data-dl-analytics-tab") === activeAnalyticsTab;
            btn.classList.toggle("is-active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
          });
          if (activeAnalyticsTab === "update") populateUpdateVersionSelect();
          applyAnalyticsView();
        }

        function dayKey(ms) {
          var d = new Date(ms);
          if (!Number.isFinite(d.getTime())) return "";
          return (
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0")
          );
        }

        function shortDayLabel(key) {
          if (!key) return "—";
          var parts = key.split("-");
          if (parts.length !== 3) return key;
          var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          try {
            var month = d.toLocaleDateString(undefined, { month: "short" });
            return month + " " + d.getDate();
          } catch (_) {
            return parts[2] + "/" + parts[1];
          }
        }

        function renderPlatformChart(byPlatform) {
          var root = $("platformChart");
          if (!root) return;
          var rows = [
            { label: "EXE", key: "windows", className: "exe" },
            { label: "APK", key: "android", className: "apk" },
            { label: "Play", key: "play", className: "play" },
          ];
          var max = 1;
          rows.forEach(function (row) {
            var n = Number(byPlatform && byPlatform[row.key]) || 0;
            if (n > max) max = n;
          });
          var total = rows.reduce(function (sum, row) {
            return sum + (Number(byPlatform && byPlatform[row.key]) || 0);
          }, 0);
          root.innerHTML = "";
          if (!total) {
            root.innerHTML = '<p class="chart-empty">No downloads recorded yet.</p>';
            return;
          }
          var wrap = document.createElement("div");
          wrap.className = "dl-platform-chart";
          rows.forEach(function (row) {
            var count = Number(byPlatform && byPlatform[row.key]) || 0;
            var pct = Math.round((count / max) * 100);
            var col = document.createElement("div");
            col.className = "dl-platform-col";
            var countEl = document.createElement("div");
            countEl.className = "dl-platform-count";
            countEl.textContent = String(count);
            var barWrap = document.createElement("div");
            barWrap.className = "dl-platform-bar-wrap";
            var bar = document.createElement("div");
            bar.className = "dl-platform-bar " + row.className;
            bar.style.height = count ? Math.max(12, pct) + "%" : "2px";
            bar.style.opacity = count ? "1" : "0.3";
            barWrap.appendChild(bar);
            var labelEl = document.createElement("div");
            labelEl.className = "dl-platform-label";
            labelEl.textContent = row.label;
            col.appendChild(countEl);
            col.appendChild(barWrap);
            col.appendChild(labelEl);
            wrap.appendChild(col);
          });
          root.appendChild(wrap);
        }

        function monthKey(ms) {
          var d = new Date(ms);
          if (!Number.isFinite(d.getTime())) return "";
          return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        }

        function yearKey(ms) {
          var d = new Date(ms);
          if (!Number.isFinite(d.getTime())) return "";
          return String(d.getFullYear());
        }

        function monthLabelFromKey(key) {
          if (!key) return "—";
          var parts = key.split("-");
          if (parts.length !== 2) return key;
          var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
          try {
            return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
          } catch (_) {
            return key;
          }
        }

        function emptyBucket() {
          return { windows: 0, android: 0, play: 0, total: 0 };
        }

        function parseTimelineRange() {
          var sel = $("timelineRange");
          var raw = sel && sel.value ? sel.value : "days-30";
          var parts = raw.split("-");
          var mode = parts[0] || "days";
          var count = Math.max(1, Number(parts[1]) || 30);
          return { mode: mode, count: count };
        }

        function rangeEmptyMessage(range) {
          if (range.mode === "months") return "No downloads in the last " + range.count + " months.";
          if (range.mode === "years") return "No downloads in the last " + range.count + " years.";
          return "No downloads in the last " + range.count + " days.";
        }

        function buildTimelineBuckets(range) {
          var today = new Date();
          today.setHours(0, 0, 0, 0);
          var buckets = [];
          var counts = {};
          var slant = true;

          if (range.mode === "months") {
            var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            for (var mi = range.count - 1; mi >= 0; mi--) {
              var m = new Date(monthStart.getFullYear(), monthStart.getMonth() - mi, 1);
              var mKey = monthKey(m.getTime());
              buckets.push({ key: mKey, label: monthLabelFromKey(mKey) });
              counts[mKey] = emptyBucket();
            }
          } else if (range.mode === "years") {
            var yearNow = today.getFullYear();
            for (var yi = range.count - 1; yi >= 0; yi--) {
              var yKey = String(yearNow - yi);
              buckets.push({ key: yKey, label: yKey });
              counts[yKey] = emptyBucket();
            }
          } else {
            for (var di = range.count - 1; di >= 0; di--) {
              var d = new Date(today);
              d.setDate(today.getDate() - di);
              var dKey = dayKey(d.getTime());
              buckets.push({ key: dKey, label: shortDayLabel(dKey) });
              counts[dKey] = emptyBucket();
            }
          }

          return { buckets: buckets, counts: counts, slant: slant };
        }

        function bucketKeyForEvent(row, range) {
          if (range.mode === "months") return monthKey(row.createdAtMs);
          if (range.mode === "years") return yearKey(row.createdAtMs);
          return dayKey(row.createdAtMs);
        }

        function renderTimelineChart(recent) {
          var root = $("timelineChart");
          var legend = $("timelineLegend");
          if (!root) return;
          root.innerHTML = "";
          if (legend) legend.hidden = true;

          var range = parseTimelineRange();
          var built = buildTimelineBuckets(range);
          var buckets = built.buckets;
          var counts = built.counts;
          var slant = built.slant;

          (Array.isArray(recent) ? recent : []).forEach(function (row) {
            var platform = String(row.platform || "windows");
            if (platform !== "windows" && platform !== "android" && platform !== "play") {
              platform = "windows";
            }
            var key = bucketKeyForEvent(row, range);
            if (!Object.prototype.hasOwnProperty.call(counts, key)) return;
            counts[key][platform] += 1;
            counts[key].total += 1;
          });

          var max = 1;
          buckets.forEach(function (bucket) {
            var total = counts[bucket.key].total;
            if (total > max) max = total;
          });

          var hasAny = buckets.some(function (bucket) {
            return counts[bucket.key].total > 0;
          });
          if (!hasAny) {
            root.innerHTML = '<p class="chart-empty">' + rangeEmptyMessage(range) + "</p>";
            return;
          }

          if (legend) legend.hidden = false;

          var scroll = document.createElement("div");
          scroll.className = "dl-timeline-scroll" + (slant ? " has-slant" : "");
          var wrap = document.createElement("div");
          wrap.className = "dl-timeline" + (slant ? " has-slant" : "") + (buckets.length > 20 ? " dense" : "");
          wrap.style.setProperty("--dl-cols", String(buckets.length));

          buckets.forEach(function (bucket) {
            var bucketCounts = counts[bucket.key];
            var total = bucketCounts.total || 0;
            var col = document.createElement("div");
            col.className = "dl-timeline-col";
            var barWrap = document.createElement("div");
            barWrap.className = "dl-timeline-bar-wrap";
            var bar = document.createElement("div");
            bar.className = "dl-timeline-bar";
            bar.style.height = total ? Math.max(12, Math.round((total / max) * 100)) + "%" : "2px";
            bar.style.opacity = total ? "1" : "0.35";
            PLATFORM_ROWS.forEach(function (row) {
              var n = bucketCounts[row.key] || 0;
              if (!n) return;
              var seg = document.createElement("div");
              seg.className = "dl-timeline-seg " + row.className;
              seg.style.flex = n + " 1 0";
              seg.title = row.label + ": " + n;
              var segNo = document.createElement("span");
              segNo.className = "dl-timeline-seg-no";
              segNo.textContent = String(n);
              seg.appendChild(segNo);
              bar.appendChild(seg);
            });
            barWrap.appendChild(bar);
            var countEl = document.createElement("div");
            countEl.className = "dl-timeline-count";
            countEl.textContent = String(total);
            var labelSlot = document.createElement("div");
            labelSlot.className = "dl-timeline-label-slot" + (slant ? " is-slant" : "");
            var labelEl = document.createElement("div");
            labelEl.className = "dl-timeline-label" + (slant ? " slant" : "");
            labelEl.textContent = bucket.label;
            labelSlot.appendChild(labelEl);
            var foot = document.createElement("div");
            foot.className = "dl-timeline-foot";
            foot.appendChild(countEl);
            foot.appendChild(labelSlot);
            col.appendChild(barWrap);
            col.appendChild(foot);
            wrap.appendChild(col);
          });

          scroll.appendChild(wrap);
          root.appendChild(scroll);
        }

        function normalizedEmail(value) {
          return String(value || "").trim().toLowerCase();
        }

        function rebuildEmailAnchors() {
          emailAnchorByEmail = {};
          cachedRecent.forEach(function (row) {
            var key = normalizedEmail(row.userEmail);
            if (!key || emailAnchorByEmail[key]) return;
            emailAnchorByEmail[key] = row.id;
          });
        }

        function emailProfileFor(row) {
          var key = normalizedEmail(row && row.userEmail);
          if (!key) return null;
          return cachedEmailProfiles[key] || null;
        }

        function ownedCompanies(profile) {
          if (!profile) return [];
          if (Array.isArray(profile.ownedCompanies)) return profile.ownedCompanies;
          return ownedNames(profile).map(function (name) {
            return { name: name, createdAtMs: null };
          });
        }

        function sharedCompanies(profile) {
          if (!profile) return [];
          if (Array.isArray(profile.sharedCompanies)) return profile.sharedCompanies;
          return sharedNames(profile).map(function (name) {
            return { name: name, createdAtMs: null };
          });
        }

        function ownedNames(profile) {
          if (!profile) return [];
          if (Array.isArray(profile.ownedCompanyNames)) return profile.ownedCompanyNames;
          return Array.isArray(profile.companyNames) ? profile.companyNames : [];
        }

        function sharedNames(profile) {
          if (!profile) return [];
          return Array.isArray(profile.sharedCompanyNames) ? profile.sharedCompanyNames : [];
        }

        function collapsedProfileDate(profile, owned, shared) {
          if (!profile) return "—";
          if (owned.length === 1 && !shared.length) {
            return formatProfileDate(owned[0].createdAtMs);
          }
          if (shared.length === 1 && !owned.length) {
            return formatProfileDate(shared[0].createdAtMs);
          }
          if (owned.length === 1 && shared.length === 1) {
            var times = [owned[0].createdAtMs, shared[0].createdAtMs].filter(function (ms) {
              return typeof ms === "number" && Number.isFinite(ms);
            });
            if (times.length) return formatProfileDate(Math.min.apply(null, times));
          }
          return formatProfileDate(profile.firstCreatedAtMs);
        }

        function setCompanyExpand(rowId, kind) {
          if (expandedCompanyRowId === rowId && expandedCompanyKind === kind) {
            expandedCompanyRowId = null;
            expandedCompanyKind = null;
          } else {
            expandedCompanyRowId = rowId;
            expandedCompanyKind = kind;
          }
          renderRecentTable();
        }

        function renderCollapsedCompanyCell(td, companies, kind, rowId) {
          td.innerHTML = "";
          td.className = "dl-company-cell-wrap";
          var list = Array.isArray(companies)
            ? companies.filter(function (c) {
                return c && c.name;
              })
            : [];
          if (!list.length) {
            td.textContent = "—";
            return;
          }
          if (list.length === 1) {
            td.textContent = list[0].name;
            return;
          }

          var line = document.createElement("div");
          line.className = "dl-company-main";
          var preview = document.createElement("span");
          preview.className = "dl-company-names";
          preview.textContent = list[0].name + " (+" + (list.length - 1) + ")";
          line.appendChild(preview);
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "dl-company-expand";
          btn.textContent = "▸";
          btn.setAttribute("aria-label", "Show all companies");
          btn.setAttribute("aria-expanded", "false");
          btn.onclick = function () {
            setCompanyExpand(rowId, kind);
          };
          line.appendChild(btn);
          td.appendChild(line);
        }

        function appendCompanyNameLine(container, name, showCollapse, rowId, kind) {
          container.innerHTML = "";
          var line = document.createElement("div");
          line.className = "dl-company-main";
          if (showCollapse) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "dl-company-expand";
            btn.textContent = "▾";
            btn.setAttribute("aria-label", "Hide companies");
            btn.setAttribute("aria-expanded", "true");
            btn.onclick = function () {
              setCompanyExpand(rowId, kind);
            };
            line.appendChild(btn);
          }
          var label = document.createElement("span");
          label.className = "dl-company-names";
          label.textContent = name;
          line.appendChild(label);
          container.appendChild(line);
        }

        function renderExpandedCompanyBlock(tr, kind, companies, rowId) {
          tr.dataset.expandKind = kind;
          var ownedTd = tr.children[5];
          var sharedTd = tr.children[6];
          var dateTd = tr.children[7];
          if (sharedTd) sharedTd.parentNode.removeChild(sharedTd);
          if (dateTd) dateTd.parentNode.removeChild(dateTd);

          ownedTd.colSpan = 3;
          ownedTd.className = "dl-company-expand-wrap";
          ownedTd.innerHTML = "";

          var innerTable = document.createElement("table");
          innerTable.className = "dl-company-inner-table";
          innerTable.setAttribute("role", "presentation");

          var colgroup = document.createElement("colgroup");
          ["col-owned", "col-shared", "col-date"].forEach(function (className) {
            var col = document.createElement("col");
            col.className = className;
            colgroup.appendChild(col);
          });
          innerTable.appendChild(colgroup);

          var tbody = document.createElement("tbody");
          companies.forEach(function (company, index) {
            var innerTr = document.createElement("tr");
            var ownedCell = document.createElement("td");
            var sharedCell = document.createElement("td");
            var dateCell = document.createElement("td");
            dateCell.className = "col-date";

            if (kind === "owned") {
              sharedCell.textContent = "—";
              appendCompanyNameLine(ownedCell, company.name, index === 0, rowId, kind);
            } else {
              ownedCell.textContent = "—";
              appendCompanyNameLine(sharedCell, company.name, index === 0, rowId, kind);
            }
            dateCell.textContent = formatProfileDate(company.createdAtMs);

            innerTr.appendChild(ownedCell);
            innerTr.appendChild(sharedCell);
            innerTr.appendChild(dateCell);
            tbody.appendChild(innerTr);
          });
          innerTable.appendChild(tbody);
          ownedTd.appendChild(innerTable);
        }

        function renderCompanyDetailCells(tr, profile, rowId) {
          var owned = ownedCompanies(profile);
          var shared = sharedCompanies(profile);
          var isExpanded = expandedCompanyRowId === rowId && expandedCompanyKind;
          var kind = expandedCompanyKind;

          if (isExpanded && kind === "owned" && owned.length > 1) {
            renderExpandedCompanyBlock(tr, "owned", owned, rowId);
            return;
          }
          if (isExpanded && kind === "shared" && shared.length > 1) {
            renderExpandedCompanyBlock(tr, "shared", shared, rowId);
            return;
          }

          renderCollapsedCompanyCell(tr.children[5], owned, "owned", rowId);
          renderCollapsedCompanyCell(tr.children[6], shared, "shared", rowId);
          tr.children[7].className = "dl-company-date-wrap";
          tr.children[7].textContent = collapsedProfileDate(profile, owned, shared);
        }

        function formatProfileDate(ms) {
          if (!ms) return "—";
          try {
            return new Date(ms).toLocaleDateString();
          } catch (_) {
            return "—";
          }
        }

        function recentRowIndexById(eventId) {
          for (var i = 0; i < cachedRecent.length; i++) {
            if (cachedRecent[i].id === eventId) return i;
          }
          return -1;
        }

        function scrollToRecentAnchor(anchorId) {
          if (!anchorId) return;
          var rowIndex = recentRowIndexById(anchorId);
          if (rowIndex < 0) return;
          var pageSize = parseRecentPageSize();
          var targetPage = Math.floor(rowIndex / pageSize) + 1;

          function highlightAnchor() {
            var el = $("recent-row-" + anchorId);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            el.classList.add("recent-row-anchor-highlight");
            window.setTimeout(function () {
              el.classList.remove("recent-row-anchor-highlight");
            }, 1400);
          }

          if (targetPage !== recentPage) {
            recentPage = targetPage;
            renderRecentTable();
            requestAnimationFrame(function () {
              requestAnimationFrame(highlightAnchor);
            });
            return;
          }
          requestAnimationFrame(highlightAnchor);
        }

        function isDuplicateEmailRow(row) {
          var key = normalizedEmail(row && row.userEmail);
          if (!key) return false;
          return emailAnchorByEmail[key] && emailAnchorByEmail[key] !== row.id;
        }

        function fillRecentDetailCells(tr, row) {
          if (!row.userEmail || isDuplicateEmailRow(row)) {
            tr.children[3].textContent = "—";
            tr.children[5].textContent = "—";
            tr.children[6].textContent = "—";
            tr.children[7].textContent = "—";
            return;
          }
          var profile = emailProfileFor(row);
          tr.children[3].textContent = row.userEmail;
          renderCompanyDetailCells(tr, profile, row.id);
        }

        function parseRecentPageSize() {
          var el = $("recentPageSize");
          var n = Number(el && el.value);
          if (n === 15 || n === 25 || n === 50 || n === 75 || n === 100) return n;
          return 15;
        }

        function updateRecentScrollArea(rowCount) {
          var scroll = root.querySelector(".dl-recent-scroll");
          if (!scroll) return;
          if (rowCount >= RECENT_SCROLL_ROW_THRESHOLD) {
            var table = scroll.querySelector(".dl-recent-table");
            var head = table && table.querySelector("thead");
            var firstRow = table && table.querySelector("tbody tr");
            var headH = head ? head.offsetHeight : 36;
            var rowH = firstRow ? firstRow.offsetHeight : 34;
            scroll.classList.add("is-scrollable");
            scroll.style.maxHeight = Math.ceil(headH + rowH * RECENT_SCROLL_ROW_THRESHOLD) + "px";
            return;
          }
          scroll.classList.remove("is-scrollable");
          scroll.style.maxHeight = "";
        }

        function renderRecentTable() {
          var recentBody = $("recentBody");
          var pageInfo = $("recentPageInfo");
          var prevBtn = $("recentPrevBtn");
          var nextBtn = $("recentNextBtn");
          if (!recentBody) return;

          var pageSize = parseRecentPageSize();
          var total = cachedRecent.length;
          var totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
          if (recentPage > totalPages) recentPage = totalPages;
          if (recentPage < 1) recentPage = 1;

          var start = total ? (recentPage - 1) * pageSize : 0;
          var pageRows = cachedRecent.slice(start, start + pageSize);

          recentBody.innerHTML = "";
          if (!total) {
            recentBody.innerHTML = '<tr><td colspan="8">No recent events.</td></tr>';
          } else {
            pageRows.forEach(function (row) {
              var tr = document.createElement("tr");
              tr.id = "plws-dl-recent-row-" + row.id;
              tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
              tr.children[0].textContent = formatWhen(row.createdAtMs);
              tr.children[1].textContent = String(row.platform || "");
              tr.children[2].textContent = countryLabel(row.country);
              tr.children[4].textContent = row.version || "—";

              if (isDuplicateEmailRow(row)) {
                tr.className = "recent-row-duplicate";
                var dupBtn = document.createElement("button");
                dupBtn.type = "button";
                dupBtn.className = "dl-duplicate-email-btn";
                dupBtn.textContent = "Duplicate email";
                dupBtn.onclick = function () {
                  scrollToRecentAnchor(emailAnchorByEmail[normalizedEmail(row.userEmail)]);
                };
                tr.children[3].appendChild(dupBtn);
                tr.children[5].textContent = "—";
                tr.children[6].textContent = "—";
                tr.children[7].textContent = "—";
              } else {
                fillRecentDetailCells(tr, row);
              }

              recentBody.appendChild(tr);
            });
          }

          if (pageInfo) {
            if (!total) pageInfo.textContent = "0 events";
            else {
              pageInfo.textContent =
                String(start + 1) +
                "–" +
                String(Math.min(start + pageSize, total)) +
                " of " +
                String(total);
            }
          }
          if (prevBtn) prevBtn.disabled = recentPage <= 1;
          if (nextBtn) nextBtn.disabled = recentPage >= totalPages || !total;

          var visibleRows = total ? pageRows.length : 0;
          requestAnimationFrame(function () {
            updateRecentScrollArea(visibleRows);
          });
        }

        async function load() {
          setStatus("Loading.", true);
          try {
            var json = await W.get("/admin/download-stats");
            cachedStatsNew = json.stats || { total: 0, byPlatform: {} };
            cachedStatsUpdate = json.statsUpdate || { total: 0, byPlatform: {} };
            currentReleaseVersion = String(json.currentReleaseVersion || "").trim();
            cachedRecentAll = Array.isArray(json.recent) ? json.recent : [];
            cachedEmailProfiles =
              json.emailProfiles && typeof json.emailProfiles === "object" ? json.emailProfiles : {};
            if (activeAnalyticsTab === "update") populateUpdateVersionSelect();
            applyAnalyticsView();
            setStatus("Ready.", true);
          } catch (e) {
            setStatus(e && e.message ? e.message : "Could not load download stats.", false);
          }
        }

        function init() {
          $("refreshBtn").onclick = function () { void load(); };
          root.querySelectorAll("[data-dl-analytics-tab]").forEach(function (btn) {
            btn.onclick = function () {
              setAnalyticsTab(btn.getAttribute("data-dl-analytics-tab"));
            };
          });
          var updateVersionFilterEl = $("updateVersionFilter");
          if (updateVersionFilterEl) {
            updateVersionFilterEl.onchange = function () {
              updateVersionFilter = updateVersionFilterEl.value || "all";
              applyAnalyticsView();
            };
          }
          var timelineRangeEl = $("timelineRange");
          if (timelineRangeEl) {
            timelineRangeEl.onchange = function () {
              renderTimelineChart(cachedRecent);
            };
          }
          var recentPageSizeEl = $("recentPageSize");
          if (recentPageSizeEl) {
            recentPageSizeEl.onchange = function () {
              recentPage = 1;
              renderRecentTable();
            };
          }
          var recentPrevBtn = $("recentPrevBtn");
          if (recentPrevBtn) {
            recentPrevBtn.onclick = function () {
              if (recentPage > 1) {
                recentPage -= 1;
                renderRecentTable();
              }
            };
          }
          var recentNextBtn = $("recentNextBtn");
          if (recentNextBtn) {
            recentNextBtn.onclick = function () {
              recentPage += 1;
              renderRecentTable();
            };
          }


              setAnalyticsTab("new");
              void load();
        }

        init();
      }());
    },
  };

  VIEWS.notice = {
    pfx: "not",
    html: "<div class=\"plws-card\"><h3 class=\"plws-h3\">Website notice</h3>\n            <div class=\"row\">\n              <label for=\"plws-not-noticeMessage\">Message</label>\n              <textarea id=\"plws-not-noticeMessage\" data-plws-edit class=\"notice-textarea\" placeholder=\"Example: New Windows build available — see Downloads.\"></textarea>\n              <p class=\"hint\">Shown in a banner at the top of pocket-ledger.com. Line breaks are kept.</p>\n            </div>\n            <div class=\"check-row\">\n              <input id=\"plws-not-noticeEnabled\" data-plws-edit type=\"checkbox\" />\n              <label for=\"plws-not-noticeEnabled\" style=\"margin:0;font-weight:600\">Show on website</label>\n              <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"plws-not-saveNoticeBtn\" data-plws-edit style=\"margin-left:auto\">Save notice</button>\n            </div>\n          </div>",
    init: function (root, $, W) {
      (function () {
        "use strict";

        var statusEl = $("status");
        var authBox = $("authBox");
        var adminBox = $("adminBox");
        var whoEl = $("who");
        var outBtn = $("outBtn");
        var messageEl = $("noticeMessage");
        var enabledEl = $("noticeEnabled");
        var saveBtn = $("saveNoticeBtn");

        function setStatus(msg, ok) {
          if (!statusEl) return;
          statusEl.textContent = msg || "";
          statusEl.className = "status plws-status " + (ok ? "ok" : "err");
        }

        async function load() {
          setStatus("Loading.", true);
          try {
            var notice = await W.get("/admin/notice");
            if (messageEl) messageEl.value = String(notice.message || "");
            if (enabledEl) enabledEl.checked = Boolean(notice.enabled);
            setStatus("Ready.", true);
          } catch (err) {
            setStatus("Load failed. " + (err.message || ""), false);
          }
        }

        async function save() {
          if (!messageEl || !enabledEl) return;
          var message = String(messageEl.value || "").trim();
          var enabled = Boolean(enabledEl.checked);
          if (enabled && !message) {
            setStatus("Type a message or turn off \u201cShow on website\u201d.", false);
            return;
          }
          setStatus("Saving.", true);
          try {
            await W.post("/admin/notice", { message: message, enabled: enabled });
            setStatus("Saved. Visitors will see this on the marketing homepage.", true);
          } catch (err) {
            setStatus("Save failed. " + (err.message || ""), false);
          }
        }

        if (saveBtn) {
          saveBtn.onclick = function () {
            void save();
          };
        }


            void load();
      }());
    },
  };

  /* ---------------- Users (new: /api/pl/web-users, main admin only) ---------------- */
  VIEWS.users = {
    pfx: "usr",
    html:
      '<div class="plws-card">' +
        '<h3 class="plws-h3">Invite a website user</h3>' +
        '<p class="plws-hint">The invited person opens the link, sets a password and can then sign in to this Server UI. ' +
        "They only see the Web Settings sections you allow below. The link works once and expires after 24 hours.</p>" +
        '<div class="plws-usr-invite">' +
          '<label class="plws-usr-email"><span>Email</span><input id="plws-usr-inviteEmail" type="email" placeholder="user@example.com" autocomplete="off" /></label>' +
          '<div class="plws-usr-perms" id="plws-usr-invitePerms"></div>' +
          '<div class="plws-actions"><button type="button" class="btn btn-primary btn-sm" id="plws-usr-inviteBtn">Create invite link</button></div>' +
        "</div>" +
        '<div class="plws-usr-link" id="plws-usr-linkBox" hidden>' +
          '<label for="plws-usr-link">Invite link (one-time, valid 24 hours)</label>' +
          '<div class="plws-usr-link-row"><input id="plws-usr-link" type="text" readonly /><button type="button" class="btn btn-secondary btn-sm" id="plws-usr-copyBtn">Copy</button></div>' +
        "</div>" +
      "</div>" +
      '<div class="plws-card">' +
        '<div class="plws-card-head"><h3 class="plws-h3">Website users</h3><button type="button" class="btn btn-secondary btn-sm" id="plws-usr-refreshBtn">Refresh</button></div>' +
        '<p class="plws-hint">Per section: View off = hidden, View on = read only, View + Edit on = full access. The main admin always has full access.</p>' +
        '<div class="release-table-wrap"><table class="release-table plws-usr-table"><thead id="plws-usr-head"></thead><tbody id="plws-usr-list"></tbody></table></div>' +
        '<p class="release-table-empty" id="plws-usr-empty" hidden>No website users yet.</p>' +
      "</div>" +
      '<div class="plws-card" id="plws-usr-auditCard" hidden>' +
        '<details class="plws-audit"><summary class="plws-h3">Recent activity</summary>' +
        '<div class="release-table-wrap"><table class="release-table plws-audit-table"><thead><tr><th>Time</th><th>By</th><th>Action</th><th>Target</th></tr></thead><tbody id="plws-usr-audit"></tbody></table></div>' +
        '<p class="release-table-empty" id="plws-usr-auditEmpty" hidden>No activity yet.</p>' +
        "</details>" +
      "</div>" +
      '<div class="plws-card">' +
        '<h3 class="plws-h3">Old website admins list (read only)</h3>' +
        '<p class="plws-hint">These emails were added on the old public-website admin page (admins.json). ' +
        "They no longer give access to anything. Invite the person above if they still need access.</p>" +
        '<div class="release-table-wrap"><table class="release-table"><thead><tr><th>Email</th><th>Role</th></tr></thead><tbody id="plws-usr-legacy"></tbody></table></div>' +
        '<p class="release-table-empty" id="plws-usr-legacyEmpty" hidden>No entries.</p>' +
      "</div>",
    init: function (root, $, W, ctx, setStatus) {
      var NOT_YET = "Website user management is not available on this server yet (the web-users routes are missing). Please try again after the server update.";
      var users = [];

      function permValue(v) { return v === "view" || v === "edit" ? v : "none"; }

      /* One switch: <button role="switch" aria-checked>. Space / Enter work because it is a button. */
      function makeSwitch(label) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "plws-sw";
        b.setAttribute("role", "switch");
        b.setAttribute("aria-checked", "false");
        b.setAttribute("aria-label", label);
        b.innerHTML = '<span class="plws-sw-knob" aria-hidden="true"></span>';
        return b;
      }

      /* Row: section name + View switch + Edit switch. Value lives in data-perm (none | view | edit). */
      function permRow(section, value, locked) {
        var row = document.createElement("div");
        row.className = "plws-perm-row";
        row.setAttribute("data-section", section);
        var name = document.createElement("span");
        name.className = "plws-perm-name";
        name.textContent = SECTION_LABEL[section];
        var viewLab = document.createElement("span");
        viewLab.className = "plws-sw-field";
        var viewSw = makeSwitch(SECTION_LABEL[section] + " - View");
        viewLab.appendChild(viewSw);
        viewLab.appendChild(document.createTextNode("View"));
        var editLab = document.createElement("span");
        editLab.className = "plws-sw-field";
        var editSw = makeSwitch(SECTION_LABEL[section] + " - Edit");
        editLab.appendChild(editSw);
        editLab.appendChild(document.createTextNode("Edit"));
        row.appendChild(name);
        row.appendChild(viewLab);
        row.appendChild(editLab);

        function paint(v) {
          v = permValue(v);
          row.setAttribute("data-perm", v);
          var viewOn = v !== "none";
          var editOn = v === "edit";
          viewSw.setAttribute("aria-checked", viewOn ? "true" : "false");
          editSw.setAttribute("aria-checked", editOn ? "true" : "false");
          viewSw.classList.toggle("on", viewOn);
          editSw.classList.toggle("on", editOn);
          viewSw.disabled = !!locked;
          editSw.disabled = !!locked || !viewOn; // Edit needs View
          editLab.classList.toggle("is-off", !viewOn);
        }
        viewSw.onclick = function () {
          if (viewSw.disabled) return;
          paint(row.getAttribute("data-perm") === "none" ? "view" : "none"); // View off forces Edit off
        };
        editSw.onclick = function () {
          if (editSw.disabled) return;
          paint(row.getAttribute("data-perm") === "edit" ? "view" : "edit");
        };
        paint(value);
        return row;
      }

      function permBlock(perms, locked) {
        var box = document.createElement("div");
        box.className = "plws-perm-block";
        SECTIONS.forEach(function (s) { box.appendChild(permRow(s, locked ? "edit" : perms && perms[s], locked)); });
        return box;
      }

      function readPerms(container, base) {
        var out = {};
        if (base && typeof base === "object") Object.keys(base).forEach(function (k) { out[k] = base[k]; });
        Array.prototype.forEach.call(container.querySelectorAll(".plws-perm-row[data-section]"), function (row) {
          out[row.getAttribute("data-section")] = permValue(row.getAttribute("data-perm"));
        });
        if (!out.users) out.users = "none"; // Users tab is main-admin only
        return out;
      }

      function fmtTime(v) {
        if (v == null || v === "") return "";
        var d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v).replace(" ", "T"));
        if (isNaN(d.getTime())) return String(v);
        try { return d.toLocaleString(); } catch (_) { return d.toISOString(); }
      }

      function friendly(err) {
        if (err && err.status === 404) return NOT_YET;
        if (err && err.status === 403) return "Only the main admin can manage website users.";
        return (err && err.message) || String(err);
      }

      // invite form
      var invitePerms = $("invitePerms");
      function resetInvitePerms() {
        invitePerms.innerHTML = "";
        invitePerms.appendChild(permBlock({ downloads: "view" }, false));
      }
      resetInvitePerms();

      $("inviteBtn").onclick = function () {
        var email = String($("inviteEmail").value || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus("Enter a valid email.", false); return; }
        var perms = readPerms(invitePerms);
        var btn = $("inviteBtn");
        btn.disabled = true;
        setStatus("Creating invite link.", true);
        ctx.api("POST", "/api/pl/web-users/invite", { email: email, web_perms: perms }).then(function (res) {
          var link = String((res && (res.link || res.url)) || "");
          if (!link) throw new Error("The server did not return a link.");
          $("link").value = link;
          $("linkBox").hidden = false;
          $("inviteEmail").value = "";
          resetInvitePerms();
          setStatus("Invite link created for " + email + ". Copy it and send it to them. It works once, within 24 hours.", true);
          loadUsers(true);
        }).catch(function (err) {
          setStatus(friendly(err), false);
        }).then(function () { btn.disabled = false; });
      };

      $("copyBtn").onclick = function () {
        var input = $("link");
        var text = input.value;
        function okCopy() { setStatus("Link copied.", true); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(okCopy, function () {
            input.select();
            try { document.execCommand("copy"); okCopy(); } catch (_) { setStatus("Copy failed. Select the link and copy it by hand.", false); }
          });
        } else {
          input.select();
          try { document.execCommand("copy"); okCopy(); } catch (_) { setStatus("Copy failed. Select the link and copy it by hand.", false); }
        }
      };

      // list
      function renderHead() {
        var tr = document.createElement("tr");
        ["Email", "Permissions", "Status", ""].forEach(function (h, i, arr) {
          var th = document.createElement("th");
          th.textContent = h;
          if (i === arr.length - 1) th.className = "col-action";
          tr.appendChild(th);
        });
        var head = $("head");
        head.innerHTML = "";
        head.appendChild(tr);
      }

      function userEmail(u) { return String(u.email || u.username || u.name || u.id || ""); }

      function renderUsers() {
        var body = $("list");
        body.innerHTML = "";
        $("empty").hidden = users.length > 0;
        users.forEach(function (u) {
          var tr = document.createElement("tr");
          var isMain = u.role === "main_admin";
          var tdE = document.createElement("td");
          var em = document.createElement("div");
          em.className = "plws-usr-email-cell";
          em.textContent = userEmail(u) + (isMain ? " (main admin)" : "");
          if (u.pending || u.status === "invited") em.textContent += " \u00b7 invited";
          tdE.appendChild(em);
          var lastLogin = u.lastLogin || u.last_login || u.lastLoginAt;
          var meta = [];
          if (lastLogin) meta.push("Last login: " + fmtTime(lastLogin));
          else if (u.created || "lastLogin" in u) meta.push("Last login: never");
          if (u.created) meta.push("Created: " + fmtTime(u.created));
          if (meta.length) {
            var mt = document.createElement("div");
            mt.className = "plws-usr-meta";
            mt.textContent = meta.join(" \u00b7 ");
            tdE.appendChild(mt);
          }
          tr.appendChild(tdE);
          var perms = u.web_perms && typeof u.web_perms === "object" ? u.web_perms : {};
          var tdP = document.createElement("td");
          tdP.appendChild(permBlock(perms, isMain));
          tr.appendChild(tdP);
          var tdS = document.createElement("td");
          var lab = document.createElement("label");
          lab.className = "plws-inline-check";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!u.disabled;
          cb.disabled = isMain;
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode("Disabled"));
          tdS.appendChild(lab);
          tr.appendChild(tdS);
          var tdA = document.createElement("td");
          tdA.className = "col-action";
          if (!isMain) {
            var save = document.createElement("button");
            save.type = "button";
            save.className = "btn btn-primary btn-sm";
            save.textContent = "Save";
            save.onclick = function () {
              save.disabled = true;
              setStatus("Saving " + userEmail(u) + ".", true);
              ctx.api("POST", "/api/pl/web-users/update", { id: u.id, web_perms: readPerms(tr, perms), disabled: cb.checked })
                .then(function () {
                  setStatus("Saved " + userEmail(u) + ".", true);
                  loadUsers(true);
                  loadAudit();
                })
                .catch(function (err) { setStatus(friendly(err), false); })
                .then(function () { save.disabled = false; });
            };
            tdA.appendChild(save);
          }
          tr.appendChild(tdA);
          body.appendChild(tr);
        });
      }

      function loadUsers(quiet) {
        if (!quiet) setStatus("Loading.", true);
        return ctx.api("GET", "/api/pl/web-users").then(function (res) {
          var list = Array.isArray(res) ? res : (res && (res.items || res.users || res.list)) || [];
          users = Array.isArray(list) ? list : [];
          renderUsers();
          if (!quiet) setStatus("Ready.", true);
        }).catch(function (err) {
          users = [];
          renderUsers();
          $("empty").hidden = true;
          setStatus(friendly(err), false);
        });
      }

      function loadLegacy() {
        return ctx.api("GET", SITE + "/admin/admins").then(function (data) {
          var body = $("legacy");
          body.innerHTML = "";
          var owners = Array.isArray(data && data.owners) ? data.owners : [];
          var emails = Array.isArray(data && data.emails) ? data.emails : [];
          function row(email, role) {
            var tr = document.createElement("tr");
            var a = document.createElement("td");
            a.textContent = email;
            var b = document.createElement("td");
            b.textContent = role;
            tr.appendChild(a);
            tr.appendChild(b);
            body.appendChild(tr);
          }
          owners.forEach(function (e) { row(e, "Owner"); });
          emails.forEach(function (e) { row(e, "Old admin (no access)"); });
          $("legacyEmpty").hidden = owners.length + emails.length > 0;
        }).catch(function () {
          $("legacyEmpty").hidden = false;
          $("legacyEmpty").textContent = "Could not load the old list.";
        });
      }

      function pick(o, keys) {
        for (var i = 0; i < keys.length; i++) {
          var v = o[keys[i]];
          if (v != null && v !== "") return typeof v === "object" ? JSON.stringify(v) : String(v);
        }
        return "";
      }

      function loadAudit() {
        return ctx.api("GET", "/api/pl/web-users/audit").then(function (res) {
          var items = Array.isArray(res) ? res : (res && (res.items || res.list)) || [];
          var body = $("audit");
          body.innerHTML = "";
          items.forEach(function (it) {
            if (!it || typeof it !== "object") return;
            var tr = document.createElement("tr");
            var t = it.time || it.at || it.ts || it.created || it.date;
            [fmtTime(t) || "\u2014",
              pick(it, ["actor", "actorEmail", "by", "email", "user"]) || "\u2014",
              pick(it, ["action", "event", "type"]) || "\u2014",
              pick(it, ["target", "targetEmail", "subject", "detail", "details"]) || ""].forEach(function (txt) {
              var td = document.createElement("td");
              td.textContent = txt;
              tr.appendChild(td);
            });
            body.appendChild(tr);
          });
          $("auditEmpty").hidden = body.children.length > 0;
          $("auditCard").hidden = false;
        }).catch(function (err) {
          if (err && (err.status === 404 || err.status === 403)) { $("auditCard").hidden = true; return; }
          $("auditCard").hidden = false;
          $("audit").innerHTML = "";
          $("auditEmpty").hidden = false;
          $("auditEmpty").textContent = "Could not load activity. " + ((err && err.message) || "");
        });
      }

      $("refreshBtn").onclick = function () { loadUsers(false); loadAudit(); loadLegacy(); };
      renderHead();
      loadUsers(false);
      loadAudit();
      loadLegacy();
    },
  };

  /* ================= mount ================= */

  var TAB_ORDER = [
    { key: "releases", label: "ws_tab_releases", def: "Release upload" },
    { key: "videos", label: "ws_tab_videos", def: "Website Videos" },
    { key: "downloads", label: "ws_tab_downloads", def: "Download analytics" },
    { key: "notice", label: "ws_tab_notice", def: "Notice" },
    { key: "users", label: "ws_tab_users", def: "Users" },
  ];
  var TAB_KEY = "plws_active_tab";

  function mount(container, ctx) {
    if (!container) throw new Error("WebSettings.mount: container element is required");
    ctx = ctx || {};
    if (typeof ctx.api !== "function") throw new Error("WebSettings.mount: ctx.api(method, path, body) is required");
    var tr = makeTr(ctx);
    var me = ctx.me || {};

    if (container.__plws && typeof container.__plws.destroy === "function") container.__plws.destroy();
    container.innerHTML = "";

    var root = document.createElement("div");
    root.className = "plws";
    container.appendChild(root);
    var W = makeW(ctx, root);

    var tabs = TAB_ORDER.filter(function (tab) { return permOf(me, tab.key) !== "none"; });
    if (!tabs.length) {
      root.innerHTML = '<p class="plws-status err">' + esc(tr("ws_no_access", "You do not have access to any website settings.")) + "</p>";
      container.__plws = { show: function () {}, reload: function () {}, destroy: function () { container.innerHTML = ""; } };
      return container.__plws;
    }

    var nav = document.createElement("div");
    nav.className = "plws-tabs";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", tr("ws_tabs_label", "Web settings sections"));
    root.appendChild(nav);

    var panes = {};
    var started = {};
    tabs.forEach(function (tab) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "plws-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("data-plws-tab", tab.key);
      b.textContent = tr(tab.label, tab.def);
      if (permOf(me, tab.key) === "view") {
        var badge = document.createElement("span");
        badge.className = "plws-ro-badge";
        badge.textContent = tr("ws_view_only", "view only");
        b.appendChild(badge);
      }
      b.onclick = function () { show(tab.key); };
      nav.appendChild(b);

      var pane = document.createElement("section");
      pane.className = "plws-pane";
      pane.setAttribute("role", "tabpanel");
      pane.hidden = true;
      root.appendChild(pane);
      panes[tab.key] = pane;
    });

    function startView(key) {
      var view = VIEWS[key];
      var pane = panes[key];
      var canEdit = permOf(me, key) === "edit";
      pane.innerHTML =
        '<p class="status plws-status" id="plws-' + view.pfx + '-status" role="status" aria-live="polite"></p>' +
        '<div class="plws-cards">' + view.html + "</div>";
      if (!canEdit) {
        pane.classList.add("plws-readonly");
        Array.prototype.forEach.call(pane.querySelectorAll("[data-plws-edit]"), function (el) {
          var tag = el.tagName;
          if (tag === "TEXTAREA" || (tag === "INPUT" && el.type !== "checkbox" && el.type !== "file")) el.readOnly = true;
          if (tag === "SELECT" || tag === "INPUT") el.disabled = true;
        });
      }
      var statusEl = pane.querySelector("#plws-" + view.pfx + "-status");
      function setStatus(msg, ok) {
        statusEl.textContent = msg || "";
        statusEl.className = "status plws-status " + (ok ? "ok" : "err");
      }
      function $(id) { return pane.querySelector("#plws-" + view.pfx + "-" + id); }
      try {
        view.init(pane, $, W, ctx, setStatus);
      } catch (err) {
        setStatus("Could not open this section. " + ((err && err.message) || String(err)), false);
      }
    }

    function show(key) {
      if (!panes[key]) key = tabs[0].key;
      Array.prototype.forEach.call(nav.querySelectorAll(".plws-tab"), function (b) {
        var on = b.getAttribute("data-plws-tab") === key;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== key; });
      if (!started[key]) {
        started[key] = true;
        startView(key);
      }
      try { window.sessionStorage.setItem(TAB_KEY, key); } catch (_) { /* private mode */ }
    }

    function reload(key) {
      key = key || Object.keys(panes).filter(function (k) { return !panes[k].hidden; })[0];
      if (!key || !panes[key]) return;
      started[key] = true;
      startView(key);
    }

    var first = null;
    try { first = window.sessionStorage.getItem(TAB_KEY); } catch (_) { first = null; }
    show(first && panes[first] ? first : tabs[0].key);

    container.__plws = {
      show: show,
      reload: reload,
      destroy: function () {
        container.innerHTML = "";
        container.__plws = null;
      },
    };
    return container.__plws;
  }

  window.WebSettings = { mount: mount, __plws: true, version: "20261110-2" };
  window.PLWebSettings = window.WebSettings;
})();
