/* Pocket Ledger — remaining-language translator (sub + main + website).
 * Hand files in i18n/<code>.js stay first. Any other ISO code (or missing keys)
 * is filled from English via Google gtx, then cached in localStorage. */
(function (global) {
  "use strict";
  var CACHE = "pl_i18n_mt_v1_";
  var KEEP = ["Pocket Ledger", "PocketBase", "Cloudflare"];
  var GTX = { zh: "zh-CN", he: "iw", jv: "jw", nb: "no", nn: "no", tw: "ak" };
  var BATCH = 6;

  function gtxLang(code) { return GTX[code] || code; }

  function protect(text) {
    var ph = [];
    var s = String(text == null ? "" : text).replace(/\{[a-z_]+\}/g, function (m) {
      ph.push(m);
      return "⟦" + (ph.length - 1) + "⟧";
    });
    KEEP.forEach(function (w, i) { s = s.split(w).join("«" + i + "»"); });
    return { s: s, ph: ph };
  }
  function restore(text, ph) {
    var s = String(text == null ? "" : text);
    KEEP.forEach(function (w, i) { s = s.split("«" + i + "»").join(w); });
    s = s.replace(/⟦\s*(\d+)\s*⟧/g, function (_, n) { return ph[Number(n)] || ""; });
    return s;
  }
  function readCache(code) {
    try {
      var raw = localStorage.getItem(CACHE + code);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeCache(code, tables) {
    try { localStorage.setItem(CACHE + code, JSON.stringify(tables)); } catch (e) { /* quota */ }
  }
  function translateOne(text, lang) {
    if (!text) return Promise.resolve(text);
    var p = protect(text);
    if (!p.s.trim()) return Promise.resolve(text);
    var url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" +
      encodeURIComponent(gtxLang(lang)) + "&dt=t&q=" + encodeURIComponent(p.s);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("mt " + r.status);
      return r.json();
    }).then(function (j) {
      var out = "";
      if (j && j[0]) {
        for (var i = 0; i < j[0].length; i++) if (j[0][i] && j[0][i][0]) out += j[0][i][0];
      }
      return restore(out || p.s, p.ph);
    }).catch(function () { return text; });
  }
  function translateMap(map, lang) {
    var keys = Object.keys(map || {});
    var out = {};
    var i = 0;
    function step() {
      if (i >= keys.length) return Promise.resolve(out);
      var slice = keys.slice(i, i + BATCH);
      i += BATCH;
      return Promise.all(slice.map(function (k) {
        return translateOne(map[k], lang).then(function (v) { out[k] = v; });
      })).then(step);
    }
    return step();
  }
  function missingOf(enMap, have) {
    var miss = {};
    var n = 0;
    Object.keys(enMap || {}).forEach(function (k) {
      if (!have || have[k] == null || have[k] === "") { miss[k] = enMap[k]; n += 1; }
    });
    return { map: miss, n: n };
  }

  function loadScript(code) {
    var I = global.PL_I18N;
    if (!code || typeof document === "undefined") return Promise.resolve(false);
    if (I.ui[code] && I.intro[code]) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var m = document.querySelector('meta[name="pl-version"]');
      var s = document.createElement("script");
      s.src = "/i18n/" + encodeURIComponent(code) + ".js" + (m ? "?v=" + encodeURIComponent(m.getAttribute("content")) : "");
      s.async = true;
      s.onload = function () { resolve(!!(I.ui[code] && I.intro[code])); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }
  var pendingServer = {};
  function ensureServer(code) {
    var I = global.PL_I18N;
    if (!I || !code || code === I.defaultLang) return Promise.resolve(false);
    if (pendingServer[code]) return pendingServer[code];
    function fill() {
      if (!(I.ui[code] && I.intro[code])) return Promise.resolve(false);
      var uiMiss = missingOf(I.ui.en, I.ui[code]);
      var inMiss = missingOf(I.intro.en, I.intro[code]);
      if (!uiMiss.n && !inMiss.n) return Promise.resolve(false);
      return Promise.all([
        uiMiss.n ? translateMap(uiMiss.map, code) : Promise.resolve({}),
        inMiss.n ? translateMap(inMiss.map, code) : Promise.resolve({})
      ]).then(function (parts) {
        Object.keys(parts[0]).forEach(function (k) { I.ui[code][k] = parts[0][k]; });
        Object.keys(parts[1]).forEach(function (k) { I.intro[code][k] = parts[1][k]; });
        return true;
      });
    }
    pendingServer[code] = Promise.resolve().then(function () {
      if (I.ui[code] && I.intro[code]) return fill();
      var cached = readCache(code);
      if (cached && cached.ui && cached.intro) {
        I.register(code, cached);
        return fill();
      }
      var fileLoad = I._plFileLoad ? I._plFileLoad(code) : Promise.resolve(false);
      return fileLoad.then(function (ok) {
        if (ok || (I.ui[code] && I.intro[code])) return fill();
        return loadScript(code).then(function (fromFile) {
          if (fromFile) return fill();
          return Promise.all([
            translateMap(I.ui.en, code),
            translateMap(I.intro.en, code)
          ]).then(function (parts) {
            var tables = { ui: parts[0], intro: parts[1] };
            I.register(code, tables);
            writeCache(code, tables);
            return true;
          });
        });
      });
    }).then(function (v) { delete pendingServer[code]; return v; }, function (err) { delete pendingServer[code]; throw err; });
    return pendingServer[code];
  }

  function ensureWeb(code) {
    var W = global.PLi18n;
    if (!W || !code || code === "en") return Promise.resolve(false);
    if (W.hasTable && W.hasTable(code)) return Promise.resolve(false);
    var cached = readCache("web_" + code);
    if (cached && cached.ui) {
      W.install(code, cached);
      return Promise.resolve(true);
    }
    var en = W.english ? W.english() : null;
    if (!en) return Promise.resolve(false);
    return Promise.all([
      translateMap(en.ui, code),
      translateMap(en.intro, code)
    ]).then(function (parts) {
      var tables = { ui: parts[0], intro: parts[1] };
      W.install(code, tables);
      writeCache("web_" + code, tables);
      return true;
    });
  }

  if (global.PL_I18N && typeof global.PL_I18N.load === "function") {
    global.PL_I18N._plFileLoad = global.PL_I18N.load;
    global.PL_I18N.load = function (code) {
      return ensureServer(code);
    };
  }
  global.PLI18nTranslate = { ensureServer: ensureServer, ensureWeb: ensureWeb };

  if (global.PLi18n && typeof global.PLi18n.set === "function") {
    var origSet = global.PLi18n.set;
    global.PLi18n.set = function (ui, intro) {
      origSet(ui, intro);
      var u = global.PLi18n.ui();
      var n = global.PLi18n.intro();
      Promise.all([ensureWeb(u), ensureWeb(n)]).then(function (changed) {
        if (changed[0] || changed[1]) global.PLi18n.apply();
      });
    };
    var u0 = global.PLi18n.ui && global.PLi18n.ui();
    var n0 = global.PLi18n.intro && global.PLi18n.intro();
    if (u0 && u0 !== "en") ensureWeb(u0).then(function (ok) { if (ok) global.PLi18n.apply(); });
    if (n0 && n0 !== "en" && n0 !== u0) ensureWeb(n0).then(function (ok) { if (ok) global.PLi18n.apply(); });
  }
})(window);
