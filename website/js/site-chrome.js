/* Language globe + 4 server themes on every marketing header. */
(function () {
  "use strict";
  var GLOBE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  var THEMES = ["light", "gray", "medium", "dark"];

  function t(key, fallback) {
    return window.PLt ? window.PLt(key) : fallback;
  }
  function langOptions(selected, ui) {
    var L = window.PL_LANGUAGES;
    var rows = (L && L.list) || [["en", "English", "English"], ["hi", "हिन्दी", "Hindi"], ["ne", "नेपाली", "Nepali"]];
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var code = rows[i][0];
      html += '<option value="' + code + '"' + (code === selected ? " selected" : "") + ">" +
        (L && L.label ? L.label(code, ui) : rows[i][1]) + "</option>";
    }
    return html;
  }
  function chromeHtml() {
    var ui = window.PLi18n ? window.PLi18n.ui() : "en";
    var intro = window.PLi18n ? window.PLi18n.intro() : "en";
    var chips = THEMES.map(function (id) {
      return '<button type="button" data-theme-set="' + id + '" data-i18n="theme_' + id + '">' + t("theme_" + id, id) + "</button>";
    }).join("");
    return (
      '<div class="pl-site-chrome">' +
        '<div class="pl-chrome-wrap">' +
          '<button type="button" class="btn btn-outline btn-sm" data-pl-lang-btn title="' + t("s_language", "Language") + '" aria-label="' + t("s_language", "Language") + '" aria-expanded="false">' + GLOBE + "</button>" +
          '<div class="pl-lang-pop" hidden>' +
            '<label data-i18n="lang_ui">' + t("lang_ui", "UI language") + "</label>" +
            '<input type="search" data-pl-lang-filter data-i18n="search_lang" data-i18n-attr="placeholder" placeholder="' + t("search_lang", "Search language…") + '" />' +
            '<select data-pl-ui-lang size="8">' + langOptions(ui, ui) + "</select>" +
            '<label data-i18n="lang_intro">' + t("lang_intro", "Intro language") + "</label>" +
            '<select data-pl-intro-lang>' + langOptions(intro, ui) + "</select>" +
          "</div>" +
        "</div>" +
        '<div class="pl-theme-seg" role="group" aria-label="' + t("theme", "Appearance") + '">' + chips + "</div>" +
      "</div>"
    );
  }
  function fillSlot(slot) {
    if (!slot || slot.getAttribute("data-pl-chrome-ready") === "1") return;
    slot.setAttribute("data-pl-chrome-ready", "1");
    slot.innerHTML = chromeHtml();
  }
  function paintVersion() {
    var v = window.PL_WEB_VERSION || "1.0.1";
    var nodes = document.querySelectorAll("[data-pl-web-version]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t("version", "Version") + " " + v;
    }
  }
  function filterSelect(sel, q) {
    var needle = String(q || "").trim().toLowerCase();
    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      var show = !needle || String(opts[i].text || "").toLowerCase().indexOf(needle) !== -1;
      opts[i].hidden = !show;
      opts[i].disabled = !show;
    }
  }
  function bindPop(wrap) {
    var btn = wrap.querySelector("[data-pl-lang-btn]");
    var pop = wrap.querySelector(".pl-lang-pop");
    if (!btn || !pop || btn._plBound) return;
    btn._plBound = true;
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var open = pop.hidden;
      document.querySelectorAll(".pl-lang-pop").forEach(function (p) { p.hidden = true; });
      document.querySelectorAll("[data-pl-lang-btn]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
      pop.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    var filter = pop.querySelector("[data-pl-lang-filter]");
    var uiSel = pop.querySelector("[data-pl-ui-lang]");
    var introSel = pop.querySelector("[data-pl-intro-lang]");
    if (filter && uiSel) {
      filter.addEventListener("input", function () { filterSelect(uiSel, filter.value); });
    }
    function save() {
      if (!window.PLi18n) return;
      window.PLi18n.set(uiSel.value, introSel.value);
    }
    if (uiSel) uiSel.addEventListener("change", save);
    if (introSel) introSel.addEventListener("change", save);
  }
  function mount() {
    var slots = document.querySelectorAll("[data-pl-site-chrome]");
    for (var i = 0; i < slots.length; i++) fillSlot(slots[i]);
    document.querySelectorAll(".pl-chrome-wrap").forEach(bindPop);
    paintVersion();
    if (window.PLi18n) window.PLi18n.apply();
    if (window.PLColorMode && window.PLColorMode.sync) window.PLColorMode.sync();
  }
  document.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest(".pl-chrome-wrap")) return;
    document.querySelectorAll(".pl-lang-pop").forEach(function (p) { p.hidden = true; });
    document.querySelectorAll("[data-pl-lang-btn]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  });
  document.addEventListener("pl-lang-applied", paintVersion);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  window.PLSiteChrome = { mount: mount };
})();
