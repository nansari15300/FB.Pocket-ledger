/* Same ⓘ / Hide intro pattern as Pocket Ledger Server (`pl_server_intros`). */
(function () {
  "use strict";
  var KEY = "pl_server_intros";
  var root = document.documentElement;
  var SEL = ".intro, [data-intro]";
  var INFO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="8.2" r="1.15" fill="currentColor"/><path d="M12 11.2v5.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  var CHEV_SVG = '<svg class="ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function t(key, fallback) {
    return window.PLt ? window.PLt(key) : fallback;
  }
  try {
    root.classList.toggle("pl-intros-on", localStorage.getItem(KEY) === "1");
  } catch (e) {
    root.classList.remove("pl-intros-on");
  }
  function isOn() { return root.classList.contains("pl-intros-on"); }
  function label(b) {
    if (b.classList.contains("intro-i")) {
      b.setAttribute("aria-label", t("intro_show_aria", "Show info texts (all pages)"));
      b.title = t("intro_show_aria", "Show info texts (all pages)");
      b.setAttribute("aria-expanded", isOn() ? "true" : "false");
    } else {
      var span = b.querySelector(".intro-hide-t");
      if (span) span.textContent = t("intro_hide", "Hide");
      b.setAttribute("aria-label", t("intro_hide_aria", "Hide info texts (all pages)"));
      b.title = t("intro_hide_aria", "Hide info texts (all pages)");
    }
  }
  function relabel() {
    Array.prototype.forEach.call(document.querySelectorAll(".intro-i, .intro-hide"), label);
    Array.prototype.forEach.call(document.querySelectorAll(".intro-box"), function (box) {
      var n = box.querySelector(".intro-body") && box.querySelector(".intro-body").children[0];
      box.classList.toggle("intro-empty", !n || !String(n.textContent || "").trim());
    });
  }
  function set(on, focusBox) {
    root.classList.toggle("pl-intros-on", !!on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* not saved */ }
    Array.prototype.forEach.call(document.querySelectorAll(".intro-i"), function (b) {
      b.setAttribute("aria-expanded", on ? "true" : "false");
    });
    if (focusBox) {
      var f = focusBox.querySelector(on ? ".intro-hide" : ".intro-i");
      if (f) f.focus({ preventScroll: true });
    }
  }
  function wrap(node) {
    if (!node || node.nodeType !== 1 || !node.parentNode || node.closest(".intro-box")) return null;
    var box = document.createElement("div");
    box.className = "intro-box";
    var i = document.createElement("button");
    i.type = "button";
    i.className = "intro-i";
    i.innerHTML = INFO_SVG;
    label(i);
    var body = document.createElement("div");
    body.className = "intro-body";
    var hide = document.createElement("button");
    hide.type = "button";
    hide.className = "intro-hide intro-hide-end";
    hide.innerHTML = CHEV_SVG + '<span class="intro-hide-t"></span>';
    label(hide);
    node.parentNode.insertBefore(box, node);
    body.appendChild(node);
    body.appendChild(hide);
    box.appendChild(i);
    box.appendChild(body);
    box.classList.toggle("intro-empty", !String(node.textContent || "").trim());
    return box;
  }
  function scan(rootNode) {
    var r = rootNode || document.body;
    if (!r || r.nodeType !== 1) return;
    if (r.matches && r.matches(SEL)) wrap(r);
    Array.prototype.forEach.call(r.querySelectorAll(SEL), wrap);
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest(".intro-i, .intro-hide") : null;
    if (!b) return;
    set(b.classList.contains("intro-i"), ev.detail === 0 ? b.closest(".intro-box") : null);
  });
  function start() {
    if (!document.body) return;
    scan(document.body);
    new MutationObserver(function (recs) {
      recs.forEach(function (rec) {
        Array.prototype.forEach.call(rec.addedNodes, function (n) {
          if (n.nodeType === 1 && !n.classList.contains("intro-box")) scan(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
  window.plIntro = { scan: scan, wrap: wrap, relabel: relabel, isOn: isOn, set: function (v) { set(v); } };
})();
