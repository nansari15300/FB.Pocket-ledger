/* Website data client: talks to the Pocket Ledger Server routes /api/pl/site/*.
   Needs js/site-data-config.js first (SITE_DATA_BASE). Admin pages sign in with the same
   email + password as the app (pl_users) and keep the token in localStorage "pl_pb_data_auth_v1". */
(function () {
  "use strict";

  var BASE = String(window.SITE_DATA_BASE || "https://np.pocket-ledger.com").replace(/\/+$/, "");
  var AUTH_KEY = "pl_pb_data_auth_v1";
  var SESSION_KIND_KEY = "pl_app_session_kind_v1";
  var PROFILE_KEY = "pl_pb_app_profile_v1";
  var SITE = "/api/pl/site";

  function jwtExpMs(token) {
    try {
      var part = String(token || "").split(".")[1] || "";
      var exp = Number(JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).exp);
      return isFinite(exp) ? exp * 1000 : 0;
    } catch (_) {
      return 0;
    }
  }

  function getAuth() {
    try {
      var a = JSON.parse(window.localStorage.getItem(AUTH_KEY) || "null");
      if (!a || !a.token) return null;
      if (a.expMs && Number(a.expMs) <= Date.now()) return null;
      if (a.url && String(a.url).replace(/\/+$/, "") !== BASE) return null; // token from another server
      return a;
    } catch (_) {
      return null;
    }
  }

  function signOut() {
    try {
      window.localStorage.removeItem(SESSION_KIND_KEY);
      window.localStorage.removeItem(PROFILE_KEY);
      window.localStorage.removeItem(AUTH_KEY);
    } catch (_) { /* ignore */ }
  }

  function httpError(status, data, fallback) {
    var err = new Error((data && (data.error || data.message)) || fallback || "HTTP " + status);
    err.status = status;
    err.data = data;
    return err;
  }

  function parseBody(text) {
    try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
  }

  /** JSON request. opts.auth = true adds the token. Returns parsed JSON. */
  function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth) {
      var a = getAuth();
      if (!a) return Promise.reject(httpError(401, null, "Please sign in first."));
      headers.Authorization = a.token;
    }
    return fetch(BASE + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      keepalive: !!opts.keepalive,
    }).then(
      function (res) {
        return res.text().then(function (text) {
          var data = parseBody(text);
          if (!res.ok) throw httpError(res.status, data);
          return data;
        });
      },
      function () {
        throw httpError(0, null, "Could not reach the server. Check the internet connection.");
      }
    );
  }

  function adminGet(path) { return request("GET", SITE + path, undefined, { auth: true }); }
  function adminPost(path, body) { return request("POST", SITE + path, body || {}, { auth: true }); }

  function signIn(email, password) {
    return request("POST", "/api/collections/pl_users/auth-with-password", {
      identity: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    }).then(function (res) {
      if (!res || !res.token || !res.record || !res.record.id) throw httpError(400, null, "Sign-in failed.");
      var state = {
        url: BASE,
        token: res.token,
        userId: res.record.id,
        email: String(res.record.email || email || "").toLowerCase(),
        expMs: jwtExpMs(res.token),
      };
      window.localStorage.setItem(AUTH_KEY, JSON.stringify(state));
      return state;
    });
  }

  function signInErrorText(err) {
    var s = err ? err.status : 0;
    if (s === 400) return "Invalid email or password.";
    if (s === 403) return "This account is not approved or is turned off.";
    if (s === 429) return "Too many attempts. Please wait a moment and try again.";
    if (s === 0) return "Could not reach the server. Check the internet connection.";
    return (err && err.message) || "An error occurred. Please try again.";
  }

  function checkAdmin() {
    var a = getAuth();
    if (!a) return Promise.resolve({ isAdmin: false, email: "", owner: false });
    return request("GET", SITE + "/admin-check", undefined, { auth: true }).then(
      function (d) { return { isAdmin: !!(d && d.isAdmin), email: String((d && d.email) || ""), owner: !!(d && d.owner) }; },
      function (err) {
        if (err && err.status === 401) signOut();
        return { isAdmin: false, email: "", owner: false, error: err };
      }
    );
  }

  /** Raw-body POST of one part with upload progress. */
  function postChunk(uploadId, index, blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var a = getAuth();
      if (!a) { reject(httpError(401, null, "Please sign in first.")); return; }
      var xhr = new XMLHttpRequest();
      xhr.open("POST", BASE + SITE + "/admin/releases/upload-chunk?id=" + encodeURIComponent(uploadId) + "&index=" + index);
      xhr.setRequestHeader("Authorization", a.token);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = function (ev) { if (ev.lengthComputable && onProgress) onProgress(ev.loaded); };
      xhr.onload = function () {
        var data = parseBody(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(httpError(xhr.status, data));
      };
      xhr.onerror = function () { reject(httpError(0, null, "Upload interrupted. Check the internet connection.")); };
      xhr.send(blob);
    });
  }

  /** Chunked upload of an EXE/APK to the server (about 20 MB per part, each part retried 3 times). */
  function uploadFile(file, date, onProgress) {
    var total = file.size || 1;
    return adminPost("/admin/releases/upload-init", { date: date, name: file.name, size: file.size }).then(function (init) {
      var chunkSize = init.chunkSize;
      var done = 0;
      function sendPart(i) {
        if (i >= init.chunks) return Promise.resolve();
        var start = i * chunkSize;
        var blob = file.slice(start, Math.min(file.size, start + chunkSize));
        function attempt(n) {
          return postChunk(init.uploadId, i, blob, function (loaded) {
            if (onProgress) onProgress(Math.min(99, Math.round(((done + loaded) / total) * 100)));
          }).catch(function (err) {
            if (n < 3 && (!err.status || err.status >= 500)) {
              return new Promise(function (r) { setTimeout(r, 1500 * n); }).then(function () { return attempt(n + 1); });
            }
            throw err;
          });
        }
        return attempt(1).then(function () {
          done += blob.size;
          return sendPart(i + 1);
        });
      }
      return sendPart(0).then(function () {
        return adminPost("/admin/releases/upload-finish", { uploadId: init.uploadId });
      }).then(function (res) {
        if (onProgress) onProgress(100);
        return res;
      });
    });
  }

  /** Email + password form inside `box`. Calls onDone() after a successful sign-in. */
  function mountLogin(box, onDone, setStatus) {
    box.innerHTML = "";
    var p = document.createElement("p");
    p.style.marginTop = "0";
    p.textContent = "Sign in with your Pocket Ledger email and password (website admin).";
    var form = document.createElement("form");
    form.noValidate = true;
    form.style.cssText = "display:grid;gap:0.6rem;max-width:22rem";
    var email = document.createElement("input");
    email.type = "email"; email.autocomplete = "email"; email.placeholder = "Email"; email.required = true;
    var pass = document.createElement("input");
    pass.type = "password"; pass.autocomplete = "current-password"; pass.placeholder = "Password"; pass.required = true;
    var btn = document.createElement("button");
    btn.type = "submit"; btn.className = "btn btn-primary"; btn.textContent = "Sign in";
    form.appendChild(email); form.appendChild(pass); form.appendChild(btn);
    box.appendChild(p); box.appendChild(form);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!email.value.trim() || !pass.value) { if (setStatus) setStatus("Enter your email and password.", false); return; }
      btn.disabled = true;
      if (setStatus) setStatus("Signing in.", true);
      signIn(email.value, pass.value).then(function () {
        pass.value = "";
        onDone();
      }).catch(function (err) {
        if (setStatus) setStatus(signInErrorText(err), false);
      }).then(function () { btn.disabled = false; });
    });
  }

  /** Whole page gate: login form -> admin check -> show the admin box.
   *  cfg: { authBox, adminBox, whoEl, outBtn, setStatus, onReady(info) } */
  function gate(cfg) {
    var setStatus = cfg.setStatus || function () {};
    function showSignedOut(msg, ok) {
      cfg.authBox.hidden = false;
      cfg.adminBox.hidden = true;
      if (cfg.outBtn) cfg.outBtn.hidden = true;
      if (cfg.whoEl) cfg.whoEl.textContent = "";
      mountLogin(cfg.authBox, start, setStatus);
      setStatus(msg || "", ok !== false);
    }
    function start() {
      if (!getAuth()) { showSignedOut("", true); return; }
      setStatus("Checking access.", true);
      checkAdmin().then(function (info) {
        if (info.isAdmin) {
          cfg.authBox.hidden = true;
          cfg.adminBox.hidden = false;
          if (cfg.outBtn) cfg.outBtn.hidden = false;
          if (cfg.whoEl) cfg.whoEl.textContent = info.email;
          setStatus("Ready.", true);
          cfg.onReady(info);
        } else if (info.error && info.error.status === 0) {
          showSignedOut(info.error.message, false);
        } else if (getAuth()) {
          var who = getAuth().email;
          showSignedOut(who + " is not a website admin. Sign in with another account.", false);
          signOut();
        } else {
          showSignedOut("Please sign in again.", false);
        }
      });
    }
    if (cfg.outBtn) {
      cfg.outBtn.onclick = function () { signOut(); showSignedOut("Signed out.", true); };
    }
    start();
  }

  window.SiteData = {
    base: BASE,
    site: SITE,
    getAuth: getAuth,
    signIn: signIn,
    signOut: signOut,
    request: request,
    adminGet: adminGet,
    adminPost: adminPost,
    checkAdmin: checkAdmin,
    uploadFile: uploadFile,
    mountLogin: mountLogin,
    gate: gate,
    signInErrorText: signInErrorText,
  };
}());