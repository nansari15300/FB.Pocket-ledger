/* Apex pocket-ledger.com = country picker. Country host or ?c=np = that country's site.
 * Each country web bills on its own. Main also bills users who stay on pocket-ledger.com.
 * Country subdomain terms are that site’s — main is not responsible. */
(function (global) {
  "use strict";

  var STORE = "pl-country";
  var FLAG_BANDS = 12;

  function countries() {
    return global.PLCountries;
  }

  function hostName() {
    return String(location.hostname || "").toLowerCase();
  }

  function isLocalHost() {
    var h = hostName();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  }

  function isApexHost() {
    var h = hostName();
    var apex = (countries() && countries().apexHosts) || [];
    if (apex.indexOf(h) !== -1) return true;
    return isLocalHost() || h === "";
  }

  function countryFromHost() {
    var h = hostName();
    var parts = h.split(".");
    if (parts.length < 3) return null;
    var base = parts.slice(-2).join(".");
    if (base !== "pocket-ledger.com") return null;
    var sub = parts[0];
    if (!sub || (countries().RESERVED && countries().RESERVED[sub])) return null;
    return countries().get(sub);
  }

  function countryFromQuery() {
    try {
      var q = new URLSearchParams(location.search).get("c");
      return q ? countries().get(q) : null;
    } catch (e) {
      return null;
    }
  }

  function countryFromStore() {
    try {
      return countries().get(localStorage.getItem(STORE) || "");
    } catch (e) {
      return null;
    }
  }

  function detect() {
    return countryFromHost() || countryFromQuery() || countryFromStore();
  }

  function remember(cc) {
    try { localStorage.setItem(STORE, cc); } catch (e) { /* optional */ }
  }

  function flagUrl(cc, width) {
    return "https://flagcdn.com/w" + (width || 160) + "/" + cc + ".png";
  }

  function flagWaveHtml(cc, name, size) {
    var rec = typeof cc === "string" ? countries().get(cc) : cc;
    if (!rec) return "";
    var url = flagUrl(rec.cc, size === "lg" ? 320 : 160);
    var html = "";
    for (var i = 0; i < FLAG_BANDS; i++) {
      var pos = FLAG_BANDS === 1 ? 0 : (i * 100) / (FLAG_BANDS - 1);
      var delay = (i * 0.07).toFixed(2);
      html += '<i style="background-image:url(\'' + url + '\');background-position:' +
        pos.toFixed(2) + "% 50%;animation-delay:" + delay + 's"></i>';
    }
    return '<span class="pl-flag-wave' + (size === "lg" ? " is-lg" : "") +
      '" role="img" aria-label="' + escapeAttr(rec.name) + ' flag">' + html + "</span>";
  }

  function escapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function countryHomeUrl(rec) {
    if (!rec) return "/home/";
    var cfg = countries();
    if (cfg.useSubdomains && !isLocalHost()) {
      return "https://" + rec.host + "/home/";
    }
    return "/home/?c=" + encodeURIComponent(rec.cc);
  }

  /** Regional ledger app for the current country flag URL (np.pocket-ledger.com/app, …). */
  function countryAppUrl(rec) {
    rec = rec || detect();
    if (!rec) return "/app";
    if (isLocalHost()) return "/app";
    return "https://" + rec.host + "/app";
  }

  /** EXE/APK live on that country's Pocket Ledger Server, not Firebase. */
  function countryReleasesUrl(rec) {
    rec = rec || detect();
    if (rec && rec.live && rec.host) {
      return "https://" + rec.host + "/releases/latest.json";
    }
    var live = countries() && countries().LIVE;
    if (live && live.np) return "https://np.pocket-ledger.com/releases/latest.json";
    return "";
  }

  function bindCountryAppLinks() {
    var url = countryAppUrl();
    var nodes = document.querySelectorAll('a[href="/app"], a[href="/app/"]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("href", url);
    }
  }

  function goCountry(cc) {
    var rec = countries().get(cc);
    if (!rec) return;
    if (!rec.live) return;
    remember(rec.cc);
    var next = "";
    try { next = new URLSearchParams(location.search).get("next") || ""; } catch (e) { next = ""; }
    if (next === "console") {
      var cfg = countries();
      if (cfg.useSubdomains && !isLocalHost()) {
        location.href = "https://" + rec.host + "/console/";
        return;
      }
      location.href = "/console/?c=" + encodeURIComponent(rec.cc);
      return;
    }
    location.href = countryHomeUrl(rec);
  }

  function maybeRedirectApexPicker() {
    var rec = countryFromHost();
    if (rec && isPickerPage()) {
      remember(rec.cc);
      location.replace("/home/");
    }
  }

  function isPickerPage() {
    var path = location.pathname.replace(/\/+$/, "") || "/";
    return path === "/" || path === "/index.html";
  }

  function renderPicker(root) {
    if (!root) return;
    root.innerHTML =
      '<div class="pl-gate">' +
        '<header class="pl-gate-head">' +
          '<div class="pl-gate-brand">' +
            '<span class="brand-mark" aria-hidden="true"></span>' +
            "<div><strong>Pocket Ledger</strong><span data-i18n=\"gate_choose\">Choose your country</span></div>" +
          "</div>" +
          '<div class="pl-gate-tools">' +
            '<span data-pl-site-chrome></span>' +
            '<button type="button" class="btn btn-outline btn-sm" id="marketingLoginBtn" data-i18n="signin">Sign in</button>' +
            '<button type="button" class="btn btn-outline btn-sm is-auth-hidden" id="marketingLogoutBtn" hidden aria-hidden="true" data-i18n="signout">Sign out</button>' +
            '<a class="btn btn-primary btn-sm" href="/app" id="goToAppBtn" data-i18n="goto_app">Go to App</a>' +
          "</div>" +
        "</header>" +
        '<main class="pl-gate-main">' +
          '<h1 data-i18n="gate_h1">Where do you keep the books?</h1>' +
          '<p class="pl-gate-lead intro" data-intro="gate_lead">Open your country’s Pocket Ledger site. That country web runs on its own — including plans and payment. Main also takes subscriptions for people who stay on pocket-ledger.com. Each subdomain has its own terms; main is not responsible for a country site.</p>' +
          '<div class="pl-gate-row">' +
            '<div class="pl-gate-combo" id="plCountryCombo">' +
              '<label class="pl-gate-search">' +
                '<span class="sr-only">Find Your Country</span>' +
                '<input id="plCountrySearch" type="search" placeholder="Find Your Country" data-i18n="find_country" data-i18n-attr="placeholder" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="plCountryGrid" aria-autocomplete="list" />' +
                '<button type="button" class="pl-gate-chevron" id="plCountryToggle" aria-label="Open country list" tabindex="-1">' +
                  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
                "</button>" +
              "</label>" +
              '<div class="pl-gate-drop" id="plCountryDrop" hidden>' +
                '<p class="pl-gate-count" id="plCountryCount"></p>' +
                '<div class="pl-gate-list" id="plCountryGrid" role="listbox"></div>' +
              "</div>" +
            "</div>" +
            '<nav class="pl-gate-links" aria-label="Website">' +
              '<a class="pl-gate-link-card" href="/home/#videos">' +
                '<strong data-i18n="demo">Demo</strong>' +
                '<span data-i18n="demo_desc">See Pocket Ledger on desktop, tablet and phone.</span>' +
              "</a>" +
              '<a class="pl-gate-link-card" href="/company/">' +
                '<strong data-i18n="about">About Us</strong>' +
                '<span data-i18n="about_desc">The software company behind Pocket Ledger.</span>' +
              "</a>" +
              '<a class="pl-gate-link-card" href="/downloads/">' +
                '<strong data-i18n="downloads">Downloads</strong>' +
                '<span data-i18n="downloads_desc">Windows EXE and Android APK.</span>' +
              "</a>" +
              '<a class="pl-gate-link-card" href="#features">' +
                '<strong data-i18n="features">Features</strong>' +
                '<span data-i18n="features_desc">Vouchers, ledgers, backup and more.</span>' +
              "</a>" +
            "</nav>" +
          "</div>" +
        "</main>" +
        '<footer class="pl-gate-foot"><span class="intro" data-intro="gate_foot">Each country site (np, in, us, nz) has its own terms and billing. pocket-ledger.com is not responsible for a country subdomain.</span> <a href="/terms/">Terms</a> · <span data-pl-web-version></span></footer>' +
      "</div>";
    var mainEl = root.querySelector(".pl-gate-main");
    var tpl = document.getElementById("plMainFeaturesTpl");
    if (mainEl && tpl && tpl.content) mainEl.appendChild(tpl.content.cloneNode(true));
    var input = document.getElementById("plCountrySearch");
    var drop = document.getElementById("plCountryDrop");
    var combo = document.getElementById("plCountryCombo");
    var toggle = document.getElementById("plCountryToggle");
    function isOpen() { return drop && !drop.hidden; }
    function setOpen(open) {
      if (!drop || !input) return;
      drop.hidden = !open;
      input.setAttribute("aria-expanded", open ? "true" : "false");
      if (combo) combo.classList.toggle("is-open", !!open);
      if (open) paintList(input.value);
    }
    paintList("");
    if (input) {
      input.addEventListener("input", function () {
        setOpen(true);
        paintList(input.value);
      });
      input.addEventListener("focus", function () { setOpen(true); });
      if (document.activeElement === input) setOpen(true);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") { setOpen(false); input.blur(); return; }
        if (ev.key === "ArrowDown") { ev.preventDefault(); setOpen(true); return; }
        if (ev.key !== "Enter") return;
        var hits = countries().find(input.value).filter(function (c) { return c.live; });
        if (hits.length) goCountry(hits[0].cc);
      });
    }
    if (toggle) {
      toggle.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(!isOpen());
        if (isOpen() && input) input.focus();
      });
    }
    document.addEventListener("mousedown", function (ev) {
      if (!combo || !isOpen()) return;
      if (combo.contains(ev.target)) return;
      setOpen(false);
    });
    root.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-pl-country]") : null;
      if (!t) return;
      if (t.getAttribute("data-pl-live") === "0") {
        ev.preventDefault();
        return;
      }
      remember(t.getAttribute("data-pl-country"));
      if (t.tagName === "A") return;
      ev.preventDefault();
      goCountry(t.getAttribute("data-pl-country"));
    });
    setOpen(false);
    if (window.PLSiteChrome && typeof window.PLSiteChrome.mount === "function") {
      window.PLSiteChrome.mount();
    }
    if (window.PLColorMode && typeof window.PLColorMode.sync === "function") {
      window.PLColorMode.sync();
    }
    document.dispatchEvent(new Event("pl-country-ready"));
  }

  function cardHtml(rec) {
    if (!rec) return "";
    var live = !!rec.live;
    var href = live ? countryHomeUrl(rec) : "#";
    var host = escapeHtml(rec.host);
    var liveAttr = ' data-pl-country="' + rec.cc + '" data-pl-live="' + (live ? "1" : "0") + '"';
    var soonLabel = (window.PLt && window.PLt("coming_soon")) || "Coming soon";
    var soon = live ? "" : '<span class="pl-country-soon">' + soonLabel + "</span>";
    return (
      '<article class="pl-country-card' + (live ? "" : " is-soon") + '"' + liveAttr +
        (live ? "" : ' aria-disabled="true"') + ">" +
        '<a class="pl-country-url" href="' + href + '"' + liveAttr + ">" + host + "</a>" +
        '<a class="pl-country-flag-link" href="' + href + '"' + liveAttr +
          ' aria-label="' + escapeAttr(rec.name) + " — " + host +
          (live ? "" : " (coming soon)") + '">' +
          flagWaveHtml(rec, rec.name) +
        "</a>" +
        '<a class="pl-country-name" href="' + href + '"' + liveAttr + ">" +
          escapeHtml(rec.name) +
        "</a>" +
        soon +
      "</article>"
    );
  }

  function paintList(query) {
    var grid = document.getElementById("plCountryGrid");
    var count = document.getElementById("plCountryCount");
    if (!grid) return;
    var q = String(query || "").trim();
    var rows = countries().find(query);
    grid.innerHTML = rows.length
      ? rows.map(cardHtml).join("")
      : '<p class="pl-gate-empty">No country matches “' + escapeHtml(q) + '”</p>';
    if (count) {
      count.textContent = q ? (rows.length + " matches") : (rows.length + " countries");
    }
  }

  function injectChrome() {
    if (isPickerPage()) return;
    var rec = detect();
    var bar = document.createElement("div");
    bar.className = "pl-country-chrome";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Country site");
    if (rec) {
      remember(rec.cc);
      document.documentElement.setAttribute("data-pl-country", rec.cc);
      bar.innerHTML =
        '<div class="pl-country-chrome-inner">' +
          flagWaveHtml(rec, rec.name) +
          '<div class="pl-country-chrome-text">' +
            "<strong>" + escapeHtml(rec.name) + "</strong>" +
            "<span>" + escapeHtml(rec.host) + " · country site</span>" +
          "</div>" +
          '<a class="pl-country-chrome-link" href="/console/?c=' + encodeURIComponent(rec.cc) + '">Country server</a>' +
          '<a class="pl-country-chrome-link" href="/">Change country</a>' +
        "</div>";
    } else {
      bar.innerHTML =
        '<div class="pl-country-chrome-inner">' +
          '<div class="pl-country-chrome-text"><strong>Pocket Ledger</strong><span>Choose a country to open that country’s site</span></div>' +
          '<a class="pl-country-chrome-link" href="/">Choose country</a>' +
        "</div>";
    }
    document.body.insertBefore(bar, document.body.firstChild);
    rewriteHomeLinks(rec);
  }

  function homeUrl(rec, hash) {
    var q = rec ? "?c=" + encodeURIComponent(rec.cc) : "";
    return "/home/" + q + (hash ? "#" + hash : "");
  }

  function rewriteHomeLinks(rec) {
    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var label = (a.textContent || "").trim().toLowerCase();
      if (a.classList.contains("brand") || label === "home" || label === "pocket ledger") {
        if (href === "../" || href === "./" || href === "/" || href === "/home/" || href === "../index.html") {
          a.setAttribute("href", homeUrl(rec));
        }
      }
      if (href === "../#features" || href === "./#features" || href === "/#features" || href === "/home/#features") {
        a.setAttribute("href", homeUrl(rec, "features"));
      }
      if (href === "../#videos" || href === "./#videos" || href === "/#videos" || href === "/home/#videos") {
        a.setAttribute("href", homeUrl(rec, "videos"));
      }
      if (href === "../#pricing" || href === "./#pricing" || href === "/#pricing" || href === "/home/#pricing") {
        a.setAttribute("href", homeUrl(rec, "pricing"));
      }
    });
  }

  function applyCountryTermsNote() {
    var rec = detect();
    document.querySelectorAll("a.pricing-subscribe").forEach(function (a) {
      a.setAttribute("href", "/app/billing");
      a.setAttribute("title", rec
        ? ("Subscribe on " + rec.host + " — this country site handles its own payment")
        : "Subscribe on pocket-ledger.com");
    });
    var lead = document.getElementById("pricingLead");
    if (lead) {
      lead.textContent = rec
        ? (rec.name + " runs its own plans and payment on this country site. pocket-ledger.com is not responsible for this subdomain.")
        : "Plans and payment on pocket-ledger.com. Country sites bill separately under their own terms — main is not responsible for those subdomains.";
    }
    var note = document.querySelector(".pricing-note");
    if (note && !document.getElementById("plCountryTermsNote")) {
      var p = document.createElement("p");
      p.id = "plCountryTermsNote";
      p.className = "pl-country-terms";
      p.textContent = rec
        ? (rec.name + " (" + rec.host + ") runs its own plans, payment and terms. pocket-ledger.com is not responsible for this country site.")
        : "Plans and payment on pocket-ledger.com. Each country subdomain bills separately under its own terms — main is not responsible for those sites.";
      note.parentNode.insertBefore(p, note);
    }
  }

  global.PLCountry = {
    detect: detect,
    get: function () { return detect(); },
    go: goCountry,
    flagWaveHtml: flagWaveHtml,
    flagUrl: flagUrl,
    countryHomeUrl: countryHomeUrl,
    countryAppUrl: countryAppUrl,
    countryReleasesUrl: countryReleasesUrl,
    remember: remember,
    renderPicker: renderPicker,
    isCountrySite: function () { return !!detect(); }
  };

  maybeRedirectApexPicker();
  document.addEventListener("DOMContentLoaded", function () {
    var mount = document.getElementById("plCountryGate");
    if (mount) renderPicker(mount);
    else injectChrome();
    bindCountryAppLinks();
    applyCountryTermsNote();
    var tries = 0;
    var waitPlans = setInterval(function () {
      applyCountryTermsNote();
      tries += 1;
      if (document.querySelector("a.pricing-subscribe") || tries > 24) clearInterval(waitPlans);
    }, 250);
  });
})(window);
