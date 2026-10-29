const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/** Firebase web OAuth client — `src/lib/firebase.ts` FIREBASE_WEB_OAUTH_CLIENT_ID se match. */
const FIREBASE_WEB_CLIENT_ID =
  "469450068553-h848203thcqi3u8mvl8bvnm7gh8v5icl.apps.googleusercontent.com";
/** Fixed loopback port — Google Cloud Console me ek baar redirect URI register karna. */
const CALLBACK_PORT = 28741;
const CALLBACK_PATH = "/__pl_google_auth_callback/";
const FINISH_PATH = "/__pl_google_auth_finish";

let callbackServer = null;
/** @type {Map<string, { resolve: (v: { idToken: string }) => void, reject: (e: Error) => void, timeout: NodeJS.Timeout }>} */
const pendingSessions = new Map();

function callbackPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Pocket Ledger — Google sign-in</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:28rem;margin:auto">
  <p id="msg">Completing sign-in…</p>
  <script>
    (function () {
      var msg = document.getElementById("msg");
      var hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      var idToken = hash.get("id_token");
      var state = hash.get("state");
      var err = hash.get("error") || hash.get("error_description");
      fetch("${FINISH_PATH}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken, state: state, error: err }),
      })
        .then(function () {
          msg.textContent = "Sign-in complete. This tab can be closed.";
          try { window.close(); } catch (e) {}
        })
        .catch(function () {
          msg.textContent = "Could not finish sign-in. Close this tab and try again in the app.";
        });
    })();
  </script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function ensureCallbackServer() {
  if (callbackServer) return Promise.resolve(CALLBACK_PORT);
  return new Promise((resolve, reject) => {
    callbackServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", `http://127.0.0.1:${CALLBACK_PORT}`);
        const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;

        if (pathname === CALLBACK_PATH || pathname === "/__pl_google_auth_callback/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(callbackPageHtml());
          return;
        }

        if (pathname === `${FINISH_PATH}/` || url.pathname === FINISH_PATH) {
          if (req.method !== "POST") {
            res.writeHead(405);
            res.end("Method not allowed");
            return;
          }
          const body = await readJsonBody(req);
          const state = String(body.state || "").trim();
          const idToken = body.id_token ? String(body.id_token) : "";
          const error = body.error ? String(body.error) : "";
          const session = state ? pendingSessions.get(state) : null;
          if (session) {
            clearTimeout(session.timeout);
            pendingSessions.delete(state);
            if (error) session.reject(new Error(error));
            else if (idToken) session.resolve({ idToken });
            else session.reject(new Error("GOOGLE_AUTH_NO_TOKEN"));
          }
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      } catch {
        res.writeHead(500);
        res.end("Error");
      }
    });

    callbackServer.on("error", (err) => {
      callbackServer = null;
      reject(err);
    });
    callbackServer.listen(CALLBACK_PORT, "127.0.0.1", () => resolve(CALLBACK_PORT));
  });
}

function buildGoogleAuthUrl(redirectUri, sessionId, options = {}) {
  const params = new URLSearchParams({
    client_id: FIREBASE_WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: sessionId,
    state: sessionId,
    // Account list of already-signed-in Chrome users. Do not set authuser=-1:
    // Google treats that as "Use another account" and shows email/password.
    prompt: "select_account",
  });
  const loginHint = String(options.loginHint || "").trim();
  if (loginHint) {
    params.set("login_hint", loginHint);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function windowsChromePath() {
  const names = [
    ["LOCALAPPDATA", "Google\\Chrome\\Application\\chrome.exe"],
    ["PROGRAMFILES", "Google\\Chrome\\Application\\chrome.exe"],
    ["PROGRAMFILES(X86)", "Google\\Chrome\\Application\\chrome.exe"],
  ];
  for (const [env, rel] of names) {
    const root = process.env[env];
    if (!root) continue;
    const exe = path.join(root, rel);
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/**
 * Open Google OAuth in the real Chrome profile (logged-in Google IDs).
 * `shell.openExternal` can land in Edge / a blank profile without those sessions.
 * @param {{ openExternal: (url: string) => Promise<void> }} shell
 */
function openInSystemBrowser(shell, url) {
  try {
    if (process.platform === "win32") {
      const chrome = windowsChromePath();
      if (chrome) {
        const child = spawn(chrome, [url], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.on("error", () => {
          void shell.openExternal(url);
        });
        child.unref();
        return Promise.resolve();
      }
    }
  } catch {
    /* fallback */
  }
  return shell.openExternal(url);
}

/**
 * System browser (Chrome) me Google login — logged-in account select.
 * @param {{ openExternal: (url: string) => Promise<void> }} shell
 * @param {{ loginHint?: string }} [options]
 */
async function signInWithGoogleExternal(shell, options = {}) {
  const port = await ensureCallbackServer();
  const sessionId = crypto.randomUUID();
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSessions.delete(sessionId);
      reject(new Error("GOOGLE_AUTH_TIMEOUT"));
    }, 10 * 60 * 1000);
    pendingSessions.set(sessionId, { resolve, reject, timeout });
  });

  const authUrl = buildGoogleAuthUrl(redirectUri, sessionId, options);
  await openInSystemBrowser(shell, authUrl);
  return promise;
}

module.exports = {
  signInWithGoogleExternal,
  CALLBACK_PORT,
  CALLBACK_PATH,
};
