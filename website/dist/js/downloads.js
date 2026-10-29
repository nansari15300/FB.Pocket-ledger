(function () {
  var LOCAL_MANIFEST = "/releases/latest.json";
  var cachedSettings = { downloadsMaxOldExe: 5, downloadsMaxOldApk: 5 };
  var PENDING_DOWNLOAD_KEY = "pl_pending_download";
  var auth = null;
  var currentUser = null;
  var authReady = false;
  var resumeChecked = false;

  function isLocalHost() {
    var h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  }

  function firebaseLatestUrl() {
    var cfg = window.POCKET_LEDGER_FIREBASE || {};
    var bucket = cfg.storageBucket || "";
    var prefix = window.POCKET_LEDGER_RELEASE_PREFIX || "public-releases";
    if (!bucket) return "";
    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      bucket +
      "/o/" +
      encodeURIComponent(prefix + "/latest.json") +
      "?alt=media"
    );
  }

  function firebaseSettingsUrl() {
    var cfg = window.POCKET_LEDGER_FIREBASE || {};
    var bucket = cfg.storageBucket || "";
    var prefix = window.POCKET_LEDGER_RELEASE_PREFIX || "public-releases";
    if (!bucket) return "";
    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      bucket +
      "/o/" +
      encodeURIComponent(prefix + "/release-settings.json") +
      "?alt=media"
    );
  }

  function normalizeSettings(raw) {
    return typeof window.normalizeReleaseSettings === "function"
      ? window.normalizeReleaseSettings(raw)
      : { downloadsMaxOldExe: 5, downloadsMaxOldApk: 5, outdatedPolicy: "keep", outdatedMaxKeep: 20 };
  }

  function maxKeep(kind) {
    if (kind === "android") return cachedSettings.downloadsMaxOldApk + 1;
    return cachedSettings.downloadsMaxOldExe + 1;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function sameRelease(a, b) {
    if (typeof window.sameReleaseEntry === "function") return window.sameReleaseEntry(a, b);
    if (!a || !b) return false;
    return (
      String(a.date || "") === String(b.date || "") &&
      String(a.windows && a.windows.url || "") === String(b.windows && b.windows.url || "") &&
      String(a.android && a.android.url || "") === String(b.android && b.android.url || "")
    );
  }

  function isApkAndroid(item) {
    return typeof window.isApkAndroidRelease === "function"
      ? window.isApkAndroidRelease(item)
      : Boolean(item && item.url && item.format !== "aab");
  }

  function pickApkEntry(data) {
    if (!data || !data.android) return null;
    return isApkAndroid(data.android) ? data.android : null;
  }

  function keptEntries(data, kind) {
    if (typeof window.buildPublicDownloadEntries === "function") {
      return window.buildPublicDownloadEntries(data, cachedSettings, kind);
    }
    var platformKey = kind === "android" ? "android" : "windows";
    var out = [];
    if (data && (data.windows || pickApkEntry(data))) {
      out.push({
        date: data.date || "",
        windows: data.windows || null,
        android: pickApkEntry(data),
        latest: true,
      });
    }
    var history = Array.isArray(data && data.history) ? data.history : [];
    history.forEach(function (entry) {
      if (!entry || sameRelease(entry, data)) return;
      if (out.some(function (e) {
        return sameRelease(e, entry);
      }))
        return;
      out.push({
        date: entry.date || "",
        windows: entry.windows || null,
        android: pickApkEntry(entry),
        latest: false,
      });
    });
    return out.slice(0, maxKeep(platformKey === "android" ? "android" : "windows"));
  }

  function optionLabel(entry, kind) {
    var item = entry && entry[kind];
    var ver = item && item.version ? "v" + item.version : "—";
    var date = entry.date || "unknown";
    return ver + " · " + date + (entry.latest ? " (latest)" : "");
  }

  function applyItem(kind, item, source) {
    var btn = $(kind + "Btn");
    var meta = $(kind + "Meta");
    if (!btn || !meta) return;
    if (!item || !item.url) {
      btn.removeAttribute("href");
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("is-disabled");
      btn.removeAttribute("data-track-platform");
      meta.textContent = isLocalHost()
        ? "Not staged yet — run npm run website:stage-releases"
        : "Not published yet on this country's Pocket Ledger Server";
      return;
    }
    btn.classList.remove("is-disabled");
    btn.removeAttribute("aria-disabled");
    btn.setAttribute("href", item.url);
    btn.setAttribute("data-track-platform", kind === "windows" ? "windows" : "android");
    if (kind === "android") {
      btn.textContent = "Download APK";
    }
    if (item.version) btn.setAttribute("data-track-version", String(item.version));
    else btn.removeAttribute("data-track-version");
    if (item.file) btn.setAttribute("data-track-file", String(item.file));
    else btn.removeAttribute("data-track-file");
    btn.setAttribute("data-track-source", String(source || ""));
    var bits = [];
    if (item.file) bits.push(item.file);
    if (item.version) bits.push("v" + item.version);
    if (item.sizeLabel) bits.push(item.sizeLabel);
    if (source === "local") bits.push("local path");
    if (source === "country") bits.push("country server");
    meta.textContent = bits.join(" · ");
  }

  function loginPageUrl() {
    return "/login/?return=" + encodeURIComponent(location.pathname + location.search);
  }

  function readPendingDownload() {
    try {
      var raw = sessionStorage.getItem(PENDING_DOWNLOAD_KEY);
      if (!raw) return null;
      var row = JSON.parse(raw);
      if (!row || !row.url || !row.platform) return null;
      return row;
    } catch (_) {
      return null;
    }
  }

  function writePendingDownload(row) {
    try {
      sessionStorage.setItem(PENDING_DOWNLOAD_KEY, JSON.stringify(row));
    } catch (_) {
      /* ignore */
    }
  }

  function clearPendingDownload() {
    try {
      sessionStorage.removeItem(PENDING_DOWNLOAD_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function updateAuthBanner() {
    var banner = $("downloadAuthBanner");
    var text = $("downloadAuthText");
    var signInBtn = $("downloadSignInBtn");
    var signOutBtn = $("downloadSignOutBtn");
    if (!banner) return;
    banner.hidden = false;
    banner.classList.remove("is-signed-in", "is-signed-out");
    if (currentUser && currentUser.email) {
      banner.classList.add("is-signed-in");
      if (text) {
        text.textContent = "Signed in as " + currentUser.email + ". You can download now.";
      }
      if (signInBtn) signInBtn.hidden = true;
      if (signOutBtn) signOutBtn.hidden = false;
      return;
    }
    banner.classList.add("is-signed-out");
    if (text) {
      text.textContent = "Sign in is required before EXE, APK, or Play Store download.";
    }
    if (signInBtn) {
      signInBtn.hidden = false;
      signInBtn.href = loginPageUrl();
    }
    if (signOutBtn) signOutBtn.hidden = true;
  }

  function startFileDownload(url) {
    if (!url) return;
    var frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(function () {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    }, 120000);
    window.location.href = url;
  }

  function trackDownload(platform, extras, token) {
    var headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch("/app/api/public/download-events", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        platform: platform,
        version: (extras && extras.version) || "",
        fileName: (extras && extras.fileName) || "",
        source: (extras && extras.source) || "",
        eventKind: "new",
      }),
      keepalive: true,
      cache: "no-store",
    }).catch(function () {
      return null;
    });
  }

  function downloadExtrasFromLink(link) {
    return {
      version: link.getAttribute("data-track-version") || "",
      fileName: link.getAttribute("data-track-file") || "",
      source: link.getAttribute("data-track-source") || "",
    };
  }

  function beginTrackedDownload(link) {
    if (!link || link.getAttribute("aria-disabled") === "true") return;
    var platform = link.getAttribute("data-track-platform");
    var url = link.getAttribute("href") || "";
    if (!platform || !url || url === "#") return;

    if (!currentUser) {
      writePendingDownload({
        platform: platform,
        url: url,
        version: link.getAttribute("data-track-version") || "",
        fileName: link.getAttribute("data-track-file") || "",
        source: link.getAttribute("data-track-source") || "",
      });
      location.href = loginPageUrl();
      return;
    }

    currentUser
      .getIdToken()
      .then(function (token) {
        return trackDownload(platform, downloadExtrasFromLink(link), token);
      })
      .finally(function () {
        if (platform === "play") {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          startFileDownload(url);
        }
      });
  }

  function maybeResumePendingDownload() {
    if (!authReady || resumeChecked || !currentUser) return;
    resumeChecked = true;
    var pending = readPendingDownload();
    if (!pending) return;
    clearPendingDownload();
    currentUser
      .getIdToken()
      .then(function (token) {
        return trackDownload(pending.platform, pending, token);
      })
      .finally(function () {
        if (pending.platform === "play") {
          window.open(pending.url, "_blank", "noopener,noreferrer");
        } else {
          startFileDownload(pending.url);
        }
      });
  }

  function initDownloadAuth() {
    var signOutBtn = $("downloadSignOutBtn");
    if (signOutBtn) {
      signOutBtn.onclick = function () {
        if (auth) auth.signOut();
      };
    }
    if (!window.firebase || !window.POCKET_LEDGER_FIREBASE) {
      updateAuthBanner();
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.POCKET_LEDGER_FIREBASE);
    auth = firebase.auth();
    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      authReady = true;
      updateAuthBanner();
      maybeResumePendingDownload();
    });
  }

  function bindDownloadTracking() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var link = target.closest("a[data-track-platform]");
      if (!link || link.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      beginTrackedDownload(link);
    });
  }

  function setupVersionSelect(kind, entries, source) {
    var select = $(kind + "VersionSelect");
    if (!select) return;

    var options = entries.filter(function (e) {
      return e[kind] && e[kind].url;
    });
    var seen = {};
    options = options.filter(function (e) {
      var item = e[kind];
      var key =
        String(item.version || "") +
        "|" +
        String(e.date || "") +
        "|" +
        String(item.file || item.url || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    select.innerHTML = "";
    if (!options.length) {
      select.disabled = true;
      select.hidden = true;
      applyItem(kind, null, source);
      return;
    }

    select.disabled = false;
    select.hidden = false;
    options.forEach(function (entry, idx) {
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = optionLabel(entry, kind);
      select.appendChild(opt);
    });
    select.selectedIndex = 0;
    applyItem(kind, options[0][kind], source);

    select.onchange = function () {
      var picked = options[Number(select.value)] || options[0];
      applyItem(kind, picked && picked[kind], source);
    };
  }

  async function fetchJson(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadSettings() {
    async function applySettingsText(text) {
      var raw =
        typeof window.parseReleaseSettingsJson === "function"
          ? window.parseReleaseSettingsJson(text)
          : null;
      if (!raw) return false;
      cachedSettings = normalizeSettings(raw);
      return true;
    }

    if (isLocalHost()) {
      var remoteUrl = firebaseSettingsUrl();
      if (remoteUrl) {
        try {
          var remoteRes = await fetch(remoteUrl, { cache: "no-store" });
          if (remoteRes.ok && (await applySettingsText(await remoteRes.text()))) {
            return cachedSettings;
          }
        } catch (_) {
          /* try local file */
        }
      }
      try {
        var localRes = await fetch("/releases/release-settings.json", { cache: "no-store" });
        if (localRes.ok && (await applySettingsText(await localRes.text()))) {
          return cachedSettings;
        }
      } catch (_) {
        /* use defaults */
      }
      cachedSettings = normalizeSettings(null);
      return cachedSettings;
    }

    var url = firebaseSettingsUrl();
    if (!url) return cachedSettings;
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      if (!(await applySettingsText(await res.text()))) throw new Error("invalid settings");
    } catch (_) {
      cachedSettings = normalizeSettings(null);
    }
    return cachedSettings;
  }

  function countryLatestUrl() {
    if (window.PLCountry && typeof window.PLCountry.countryReleasesUrl === "function") {
      return String(window.PLCountry.countryReleasesUrl() || "").trim();
    }
    return "https://np.pocket-ledger.com/releases/latest.json";
  }

  async function loadManifest() {
    if (isLocalHost()) {
      try {
        var local = await fetchJson(LOCAL_MANIFEST);
        return { source: "local", data: local };
      } catch (_) {
        /* fall through to the live country server on this PC */
      }
    }
    var remote = countryLatestUrl();
    if (!remote) return { source: "none", data: null };
    try {
      var data = await fetchJson(remote);
      return { source: "country", data: data };
    } catch (_) {
      return { source: "none", data: null };
    }
  }

  Promise.all([loadSettings(), loadManifest()]).then(function (results) {
    var pack = results[1];
    var data = pack.data || {};
    var source = pack.source;
    var note = $("releaseNote");
    if (note) {
      if (source === "local" && data.date) {
        note.textContent = "Local staged build · " + data.date;
      } else if (source === "country" && data.date) {
        var origin = "";
        try {
          origin = new URL(countryLatestUrl()).hostname;
        } catch (_) {
          origin = "";
        }
        note.textContent = origin
          ? ("Published on " + origin + " · " + data.date)
          : ("Published on this country's server · " + data.date);
      } else {
        note.textContent = isLocalHost()
          ? "No local EXE/APK staged yet."
          : "No published installer yet on this country's server.";
      }
    }
    var entriesWindows = keptEntries(data, "windows");
    var entriesAndroid = keptEntries(data, "android");
    setupVersionSelect("windows", entriesWindows, source);
    setupVersionSelect("android", entriesAndroid, source);
    var playBtn = $("playStoreBtn");
    if (playBtn) {
      var playUrl = (data.android && data.android.playStoreUrl) || data.playStoreUrl;
      if (playUrl) {
        playBtn.href = playUrl;
        playBtn.hidden = false;
        playBtn.setAttribute("data-track-platform", "play");
        playBtn.setAttribute("data-track-source", source);
      }
    }
  });

  bindDownloadTracking();
  initDownloadAuth();
})();
