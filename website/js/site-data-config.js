/* Where the website keeps its data (notice, videos, release files, download stats).
   Today: the Pocket Ledger Server (PocketBase). The site itself can stay on Firebase Hosting.
   When the site moves to the main server, change only the https:// address below. */
(function () {
  var host = String(window.location.hostname || "").toLowerCase();
  var local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
  // dev.pocket-ledger.com (non-country subdomain served by npm run dev): PB through the gateway /pb proxy, same origin.
  var sub = host.split(".")[0];
  var dev = !local && /\.pocket-ledger\.com$/.test(host) && host !== "www.pocket-ledger.com" &&
    !(/^[a-z]{2}$/.test(sub) || sub === "nepal");
  window.PL_DEV_HOST = dev;
  window.SITE_DATA_BASE = local ? "http://127.0.0.1:8090" : (dev ? window.location.origin + "/pb" : "https://np.pocket-ledger.com");
})();