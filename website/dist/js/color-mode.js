/* Pocket Ledger website appearance = server 4 themes: Light | Gray | Medium | Dark.
 * Same storage key as the server panel (`pl_server_theme`) so the choice follows you. */
(function () {
  var KEY = "pl_server_theme";
  var LEGACY = "pl-color-mode";
  var THEMES = ["light", "gray", "medium", "dark"];
  var ICONS = { light: "sun", gray: "quarter", medium: "half", dark: "moon" };
  var root = document.documentElement;

  function valid(v) {
    return THEMES.indexOf(v) !== -1 ? v : "";
  }
  function read() {
    try {
      var saved = valid(localStorage.getItem(KEY));
      if (saved) return saved;
      var old = localStorage.getItem(LEGACY);
      if (old === "light") return "light";
      if (old === "dark") return "medium";
    } catch (e) { /* first visit */ }
    return "medium";
  }
  function isDarkish(mode) {
    return mode === "medium" || mode === "dark";
  }
  function apply(mode) {
    mode = valid(mode) || "medium";
    root.setAttribute("data-theme", mode);
    root.classList.toggle("dark", isDarkish(mode));
    root.style.colorScheme = isDarkish(mode) ? "dark" : "light";
    var color = mode === "dark" ? "#0f141c" : mode === "medium" ? "#3a3a3a" : mode === "gray" ? "#d9d9d9" : "#ffffff";
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
    syncButtons(mode);
  }
  function set(mode) {
    mode = valid(mode) || "medium";
    try { localStorage.setItem(KEY, mode); } catch (e) { /* still switch */ }
    apply(mode);
  }
  function next() {
    var cur = read();
    set(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  }
  function label(mode) {
    var t = window.PLt;
    var name = t ? t("theme_" + mode) : mode;
    var theme = t ? t("theme") : "Appearance";
    return theme + ": " + name;
  }
  function syncButtons(mode) {
    mode = valid(mode) || read();
    var btns = document.querySelectorAll("[data-pl-color-mode-toggle], .theme-toggle");
    var text = label(mode);
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("title", text);
      btns[i].setAttribute("aria-label", text);
      btns[i].setAttribute("data-theme-now", mode);
      btns[i].setAttribute("data-theme-icon", ICONS[mode] || "sun");
    }
    var chips = document.querySelectorAll("[data-theme-set]");
    for (var j = 0; j < chips.length; j++) {
      var on = chips[j].getAttribute("data-theme-set") === mode;
      chips[j].classList.toggle("is-active", on);
      chips[j].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  apply(read());
  document.addEventListener("click", function (ev) {
    var chip = ev.target && ev.target.closest ? ev.target.closest("[data-theme-set]") : null;
    if (chip) {
      ev.preventDefault();
      set(chip.getAttribute("data-theme-set"));
      return;
    }
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-pl-color-mode-toggle], .theme-toggle") : null;
    if (!t) return;
    ev.preventDefault();
    next();
  });
  document.addEventListener("DOMContentLoaded", function () { syncButtons(read()); });
  window.addEventListener("storage", function (ev) {
    if (ev.key === KEY || ev.key === LEGACY) apply(read());
  });
  window.PLColorMode = {
    themes: THEMES,
    read: read,
    apply: apply,
    set: set,
    next: next,
    sync: function () { apply(read()); }
  };
})();
