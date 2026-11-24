/* Where the website keeps its data (notice, videos, release files, download stats).
   Local web-engine sets X-PL-Site-Mode: server (Main) | app (Sub). */
(function () {
  var host = String(window.location.hostname || "").toLowerCase();
  var local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
  var sub = host.split(".")[0];
  var dev = !local && /\.pocket-ledger\.com$/.test(host) && host !== "www.pocket-ledger.com" &&
    !(/^[a-z]{2}$/.test(sub) || sub === "nepal");

  function detectMode() {
    try {
      var q = new URLSearchParams(location.search || "").get("mode");
      if (q === "server" || q === "app") return q;
    } catch (_) {}
    try {
      var m = document.querySelector('meta[name="pl-site-mode"]');
      if (m && (m.content === "server" || m.content === "app")) return m.content;
    } catch (_) {}
    try {
      var saved = localStorage.getItem("pl_site_mode");
      if (saved === "server" || saved === "app") return saved;
    } catch (_) {}
    // Main panel website root often :8088 with no PB; Sub engine same port but SITE prefers app.
    if (local && String(location.port || "") === "8088") {
      // Default local :8088 to server unless meta says app (Sub copies set meta).
      return "server";
    }
    return "app";
  }

  var mode = detectMode();
  window.PL_SITE_MODE = mode; // server = sell Pocket Ledger Server; app = sell Pocket Ledger app
  window.PL_DEV_HOST = dev;

  if (local) {
    // Main marketing → Main API :8099; Sub marketing → Sub PB :8090
    window.SITE_DATA_BASE = mode === "server" ? "http://127.0.0.1:8099" : "http://127.0.0.1:8090";
  } else if (dev) {
    window.SITE_DATA_BASE = window.location.origin + "/pb";
  } else {
    window.SITE_DATA_BASE = "https://np.pocket-ledger.com";
  }

  // Expose Main public updates for downloads when in server mode locally
  window.PL_UPDATES_URL = mode === "server" && local
    ? "http://127.0.0.1:8099/api/public/updates"
    : (local ? (window.SITE_DATA_BASE + "/releases/latest.json") : (window.SITE_DATA_BASE + "/releases/latest.json"));

  try {
    if (document.documentElement) document.documentElement.setAttribute("data-pl-mode", mode);
  } catch (_) {}
})();
