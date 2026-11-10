(function () {
  "use strict";
  if (typeof Promise !== "undefined" && !Promise.allSettled) {
    Promise.allSettled = function (arr) {
      return Promise.all(arr.map(function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      }));
    };
  }

  var loginBtn = document.getElementById("marketingLoginBtn");
  var logoutBtn = document.getElementById("marketingLogoutBtn");
  var appBtn = document.getElementById("goToAppBtn");
  var auth;

  // Same keys the app uses for a Pocket Ledger Server login (pbClient.ts / pbAppSession.ts).
  var PB_AUTH_KEY = "pl_pb_data_auth_v1";
  var PB_SESSION_KIND_KEY = "pl_app_session_kind_v1";
  var PB_PROFILE_KEY = "pl_pb_app_profile_v1";

  /** Server-login user (token not expired) from the app's storage, or null. */
  function readServerUser() {
    try {
      var a = JSON.parse(window.localStorage.getItem(PB_AUTH_KEY) || "null");
      if (!a || !a.token) return null;
      if (a.expMs && Number(a.expMs) <= Date.now()) return null;
      return { email: a.email || "", uid: a.userId || "", serverOnly: true };
    } catch (_) {
      return null;
    }
  }

  /** Same as the app's logout for the server part: clearPocketBaseAppSession({ signOutServer: true }). */
  function clearServerSession() {
    try {
      window.localStorage.removeItem(PB_SESSION_KIND_KEY);
      window.localStorage.removeItem(PB_PROFILE_KEY);
      window.localStorage.removeItem(PB_AUTH_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function normalizedEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function setVisible(el, visible) {
    if (!el) return;
    if (visible) {
      el.hidden = false;
      el.classList.remove("is-auth-hidden");
      el.removeAttribute("aria-hidden");
    } else {
      el.hidden = true;
      el.classList.add("is-auth-hidden");
      el.setAttribute("aria-hidden", "true");
    }
  }

  /** Website admin moved to the Server UI (Web Hosting > Settings). Drop any old
   *  settings panel / "Admin Panel" button that a cached page may still carry. */
  function removeLegacySettingsPanel() {
    ["marketingSettingsPanel", "marketingSettingsBtn"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function t(key, fallback) {
    return window.PLt ? window.PLt(key) : fallback;
  }

  function dataServerId() {
    try {
      var s = JSON.parse(window.localStorage.getItem(PB_SETTINGS_KEY) || "null");
      return s && s.serverId === "pocketbase" ? "pocketbase" : "firebase";
    } catch (_) {
      return "firebase";
    }
  }

  function dataHintText() {
    return dataServerId() === "pocketbase"
      ? t("data_settings_pocketbase", "Books show and save from Settings: Pocket Ledger Server. Email or Google is only your login.")
      : t("data_settings_firebase", "Books show and save from Settings: Firebase. Email or Google is only your login.");
  }

  function currentUser() {
    return (auth && auth.currentUser) || readServerUser();
  }

  function setUi(user) {
    loginBtn = document.getElementById("marketingLoginBtn");
    logoutBtn = document.getElementById("marketingLogoutBtn");
    appBtn = document.getElementById("goToAppBtn");
    setVisible(loginBtn, !user);
    setVisible(logoutBtn, Boolean(user));
    if (loginBtn) loginBtn.textContent = t("signin", "Sign in");
    if (logoutBtn) logoutBtn.textContent = t("signout", "Sign out");
    if (appBtn) appBtn.textContent = user ? t("open_app", "Open App") : t("goto_app", "Go to App");
    removeLegacySettingsPanel();
  }

  function refreshUi() {
    setUi(currentUser());
  }

  // ---- Email + password sign-in: same flow as the app's LoginForm (default mode) ----
  // Both at once: Pocket Ledger Server (pl_users) and the Firebase email account.
  var PB_SETTINGS_KEY = "pl_online_data_server_settings_v1";
  var PB_DEFAULT_URL = "http://127.0.0.1:8090";
  var loginModal = null;

  function countryPbOrigin() {
    try {
      var rec = window.PLCountry && typeof window.PLCountry.get === "function" ? window.PLCountry.get() : null;
      if (window.PL_DEV_HOST === true) return window.location.origin + "/pb";
      if (rec && rec.live && rec.host) return "https://" + rec.host;
    } catch (_) { /* ignore */ }
    return "https://np.pocket-ledger.com";
  }

  function pbServerUrl() {
    try {
      var s = JSON.parse(window.localStorage.getItem(PB_SETTINGS_KEY) || "null");
      var u = String((s && s.pocketbaseUrl) || "").trim().replace(/\/+$/, "");
      return viaGatewayProxy(u || PB_DEFAULT_URL);
    } catch (_) {
      return viaGatewayProxy(PB_DEFAULT_URL);
    }
  }

  /** Same as the app's dev rule (pbClient.ts): page opened from another device (LAN / public IP)
   *  + server URL on "this PC" (127.0.0.1) -> use the gateway's same-origin /pb proxy. */
  function viaGatewayProxy(url) {
    var LOOP = { "127.0.0.1": 1, "localhost": 1, "0.0.0.0": 1, "[::1]": 1, "::1": 1 };
    try {
      var loc = window.location;
      if (loc.protocol !== "http:" && loc.protocol !== "https:") return url;
      var pageHost = String(loc.hostname || "").toLowerCase();
      var targetHost = String(new URL(url).hostname || "").toLowerCase();
      if (LOOP[targetHost] && pageHost && !LOOP[pageHost]) {
        // Public website cannot reach this PC's 127.0.0.1 — use the country Pocket Ledger Server.
        return countryPbOrigin();
      }
      if (!pageHost || LOOP[pageHost]) return url;
      if (!LOOP[targetHost]) return url;
      return loc.origin + "/pb";
    } catch (_) {
      return url;
    }
  }

  function jwtExpMs(token) {
    try {
      var part = String(token || "").split(".")[1] || "";
      var exp = Number(JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).exp);
      return isFinite(exp) ? exp * 1000 : 0;
    } catch (_) {
      return 0;
    }
  }

  function pbRequest(base, path, method, body, token) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    var headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = token;
    return fetch(base + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      cache: "no-store",
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
        if (!res.ok) {
          var err = new Error((data && data.message) || "HTTP " + res.status);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function (e) {
      var err = new Error(e && e.message ? e.message : "network");
      err.status = 0;
      throw err;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /** pbClient.pocketBaseSignIn: stores only the token under pl_pb_data_auth_v1. */
  function pbSignIn(email, password) {
    var base = pbServerUrl();
    return pbRequest(base, "/api/collections/pl_users/auth-with-password", "POST", {
      identity: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    }).then(function (res) {
      if (!res || !res.token || !res.record || !res.record.id) {
        var e = new Error("sign-in failed"); e.status = 400; throw e;
      }
      var state = {
        url: base,
        token: res.token,
        userId: res.record.id,
        email: String(res.record.email || email || "").toLowerCase(),
        expMs: jwtExpMs(res.token),
      };
      window.localStorage.setItem(PB_AUTH_KEY, JSON.stringify(state));
      return state;
    });
  }

  /** pbAppSession.startPocketBaseAppSession: profile + "pocketbase" marker (server-only session). */
  function pbStartAppSession(state) {
    return pbRequest(state.url, "/api/collections/pl_users/records/" + encodeURIComponent(state.userId), "GET", undefined, state.token)
      .then(function (rec) {
        if (rec && rec.disabled === true) throw new Error("This account is disabled. Contact your administrator.");
        var p = {
          id: String((rec && rec.id) || state.userId),
          email: String((rec && rec.email) || state.email || "").toLowerCase(),
          name: String((rec && rec.name) || ""),
          appUid: String((rec && rec.app_uid) || ""),
          appRole: String((rec && rec.app_role) || ""),
        };
        window.localStorage.setItem(PB_PROFILE_KEY, JSON.stringify(p));
        window.localStorage.setItem(PB_SESSION_KIND_KEY, "pocketbase");
        return p;
      });
  }

  function pbApproval(err) {
    if (!err || err.status !== 403) return "";
    var d = err.data && err.data.data;
    var raw = d && typeof d === "object" ? d.approval : undefined;
    var code = raw && typeof raw === "object" ? String(raw.code || "") : String(raw || "");
    code = code.replace(/^pl_account_/, "");
    if (code === "pending" || code === "rejected" || code === "otp") return code;
    if (/pending approval/i.test(err.message || "")) return "pending";
    if (/not approved/i.test(err.message || "")) return "rejected";
    return "";
  }

  /** Same texts as the app's login toast. */
  function emailLoginErrorText(serverErr) {
    var approval = pbApproval(serverErr);
    if (approval === "pending") return "Your account is waiting for approval by the server admin. You can sign in after it is approved.";
    if (approval === "rejected") return "This account was not approved by the server admin. Please contact the server admin.";
    if (approval === "otp") return "This account still needs the 6-digit code from the sign-up email. Finish it in the app (Go to App).";
    var status = serverErr ? serverErr.status : 0;
    if (status === 403) return "This server account is turned off. Please ask the server admin.";
    if (status === 400) {
      return "Invalid email or password.";
    }
    if (status === 429) return "Too many attempts. Please wait a moment and try again.";
    if (status === 0) return "Could not reach the sign-in servers. Check the internet connection and the server address.";
    return "An error occurred. Please try again.";
  }

  function buildLoginModal() {
    if (loginModal) return loginModal;
    var wrap = document.createElement("div");
    wrap.className = "video-modal site-login-modal";
    wrap.hidden = true;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "siteLoginTitle");
    wrap.innerHTML =
      '<div class="video-modal-backdrop" data-site-login-close></div>' +
      '<div class="video-modal-card site-login-card">' +
      '<div class="video-modal-head"><strong id="siteLoginTitle">' + t("signin", "Sign in") + "</strong>" +
      '<button type="button" class="video-modal-close" data-site-login-close aria-label="' + t("close", "Close") + '">&times;</button></div>' +
      '<div class="site-login-body">' +
      '<p class="site-login-data" id="siteLoginDataHint"></p>' +
      '<button type="button" class="btn btn-outline site-login-google" id="siteLoginGoogle">' + t("continue_google", "Continue with Google") + "</button>" +
      '<div class="site-login-or"><span>' + t("or", "or") + "</span></div>" +
      '<form id="siteLoginForm" novalidate>' +
      '<label class="site-login-field">' + t("email", "Email") + '<input type="email" id="siteLoginEmail" autocomplete="email" required /></label>' +
      '<label class="site-login-field">' + t("password", "Password") + '<input type="password" id="siteLoginPassword" autocomplete="current-password" required /></label>' +
      '<p class="site-login-error" id="siteLoginError" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary site-login-submit" id="siteLoginSubmit">' + t("signin", "Sign in") + "</button>" +
      "</form></div></div>";
    document.body.appendChild(wrap);

    var form = wrap.querySelector("#siteLoginForm");
    var emailEl = wrap.querySelector("#siteLoginEmail");
    var passEl = wrap.querySelector("#siteLoginPassword");
    var errEl = wrap.querySelector("#siteLoginError");
    var submitEl = wrap.querySelector("#siteLoginSubmit");
    var googleEl = wrap.querySelector("#siteLoginGoogle");
    var hintEl = wrap.querySelector("#siteLoginDataHint");
    if (hintEl) hintEl.textContent = dataHintText();

    function showError(msg) {
      errEl.textContent = msg || "";
      errEl.hidden = !msg;
    }
    function setBusy(busy) {
      submitEl.disabled = busy;
      googleEl.disabled = busy;
      submitEl.textContent = busy ? "Signing in..." : t("signin", "Sign in");
    }
    function close() {
      wrap.hidden = true;
      passEl.value = "";
      showError("");
    }

    wrap.addEventListener("click", function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-site-login-close")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !wrap.hidden) close();
    });

    googleEl.addEventListener("click", function () {
      showError("");
      if (!auth) { showError("Google sign-in is not available on this page."); return; }
      // Identity only. Do not wipe Pocket Ledger Server — books follow Settings.
      auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () {
        close();
        refreshUi();
      }).catch(function (e) {
        var code = String((e && e.code) || "");
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
        showError(code === "auth/popup-blocked" ? "Popup blocked. Allow popups for this site and try again." : "Google sign-in failed. Please try again.");
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = String(emailEl.value || "").trim();
      var password = String(passEl.value || "");
      if (!email || !password) { showError("Enter your email and password."); return; }
      showError("");
      setBusy(true);
      var wantPb = dataServerId() === "pocketbase";
      var fbJob = auth
        ? auth.signInWithEmailAndPassword(email, password).then(function () { return "fb"; })
        : Promise.reject(new Error("no-firebase"));
      var pbJob = pbSignIn(email, password).then(function (state) {
        return pbStartAppSession(state);
      }).then(function () { return "pb"; });
      Promise.allSettled([fbJob, pbJob]).then(function (results) {
        var fbOk = results[0].status === "fulfilled";
        var pbOk = results[1].status === "fulfilled";
        if (wantPb) {
          if (!pbOk) throw new Error(emailLoginErrorText(results[1].reason));
        } else if (!fbOk) {
          if (pbOk) {
            // Firebase identity failed; Pocket Ledger Server identity still counts.
          } else {
            var fbErr = results[0].reason;
            var code = String((fbErr && fbErr.code) || "");
            if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
              throw new Error("Invalid email or password.");
            }
            throw new Error(emailLoginErrorText(results[1].reason || fbErr));
          }
        }
        close();
        refreshUi();
      }).catch(function (err) {
        showError((err && err.message) || "An error occurred. Please try again.");
      }).finally(function () {
        setBusy(false);
      });
    });

    loginModal = { el: wrap, emailEl: emailEl };
    return loginModal;
  }

  function openLoginModal() {
    var m = buildLoginModal();
    var hint = m.el.querySelector("#siteLoginDataHint");
    if (hint) hint.textContent = dataHintText();
    m.el.hidden = false;
    try { m.emailEl.focus(); } catch (_) { /* ignore */ }
  }

  function bindOnce(el, type, fn) {
    if (!el || el._plBound) return;
    el._plBound = true;
    el.addEventListener(type, fn);
  }

  function bindButtons() {
    loginBtn = document.getElementById("marketingLoginBtn");
    logoutBtn = document.getElementById("marketingLogoutBtn");
    appBtn = document.getElementById("goToAppBtn");
    bindOnce(loginBtn, "click", function () { openLoginModal(); });
    bindOnce(logoutBtn, "click", function () {
      removeLegacySettingsPanel();
      clearServerSession();
      if (auth) {
        auth.signOut().catch(function () { /* ignore */ }).then(function () { setUi(null); });
      } else {
        setUi(null);
      }
    });
    setUi(currentUser());
  }

  function initFirebase() {
    if (!window.firebase || !window.POCKET_LEDGER_FIREBASE) return;
    if (!firebase.apps.length) firebase.initializeApp(window.POCKET_LEDGER_FIREBASE);
    auth = firebase.auth();
    auth.onAuthStateChanged(function () {
      refreshUi();
    });
  }

  function init() {
    removeLegacySettingsPanel();
    initFirebase();
    bindButtons();
    refreshUi();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  document.addEventListener("pl-country-ready", bindButtons);
  document.addEventListener("pl-lang-applied", function () {
    setUi(currentUser());
  });
}());
