/* Where the website keeps its data (notice, videos, release files, download stats).
   Today: the Pocket Ledger Server (PocketBase). The site itself can stay on Firebase Hosting.
   When the site moves to the main server, change only the https:// address below. */
(function () {
  var host = String(window.location.hostname || "").toLowerCase();
  var local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
  window.SITE_DATA_BASE = local ? "http://127.0.0.1:8090" : "https://np.pocket-ledger.com";
})();