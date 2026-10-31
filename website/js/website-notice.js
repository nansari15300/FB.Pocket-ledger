(function () {
  "use strict";

  var NOTICE_URL = (String(window.SITE_DATA_BASE || "https://np.pocket-ledger.com").replace(/\/+$/, "") + "/api/pl/site/public/notice");
  var bannerEl = document.getElementById("marketingNoticeBanner");
  var textEl = document.getElementById("marketingNoticeText");

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showNotice(message) {
    if (!bannerEl || !textEl) return;
    var trimmed = String(message || "").trim();
    if (!trimmed) {
      bannerEl.hidden = true;
      bannerEl.setAttribute("aria-hidden", "true");
      return;
    }
    textEl.innerHTML = escapeHtml(trimmed).replace(/\n/g, "<br />");
    bannerEl.hidden = false;
    bannerEl.removeAttribute("aria-hidden");
  }

  function hideNotice() {
    if (!bannerEl) return;
    bannerEl.hidden = true;
    bannerEl.setAttribute("aria-hidden", "true");
  }

  async function load() {
    if (!bannerEl || !textEl) return;
    try {
      var res = await fetch(NOTICE_URL, { cache: "no-store" });
      if (!res.ok) {
        hideNotice();
        return;
      }
      var data = await res.json();
      if (data && data.enabled && data.message) {
        showNotice(data.message);
      } else {
        hideNotice();
      }
    } catch (_) {
      hideNotice();
    }
  }

  load();
}());
