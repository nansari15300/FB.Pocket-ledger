"use client";

/**
 * Pocket Ledger Server (PocketBase) - tiny fetch client for company data sync.
 * No SDK: only the few REST calls the sync needs (auth, list, create, update).
 *
 * Auth: app users sign in to the server's `pl_users` collection. Only the auth
 * token is kept (localStorage), never the password.
 */

import { resolvePocketBaseServerUrl } from "@/lib/onlineDataServer";
import { isPlServerPackedApp, plServerPackedSameOrigin } from "@/lib/plServerPackedApp";

const AUTH_KEY = "pl_pb_data_auth_v1";
const REQUEST_TIMEOUT_MS = 15_000;

export type PocketBaseAuthState = {
  url: string;
  token: string;
  userId: string;
  email: string;
  /** Token expiry (ms since epoch), from the JWT `exp`. */
  expMs: number;
};

export class PocketBaseRequestError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "PocketBaseRequestError";
    this.status = status;
    this.data = data;
  }
}

export function normalizePocketBaseUrl(raw: unknown): string {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  return viaDevGatewayProxy(s || resolvePocketBaseServerUrl());
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]", "::1"]);

/**
 * Dev gateway only (`npm run dev`, port 3000): when the app is opened from another device
 * (LAN IP / port-forwarded public IP), a "this PC" server URL (127.0.0.1:8090) would point at
 * the phone itself. Use the gateway's same-origin `/pb` proxy instead. Localhost pages,
 * Electron/Capacitor (localhost / file:) and hosted builds are unchanged.
 */
function viaDevGatewayProxy(url: string): string {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_PL_DEV_LOCAL_SERVER !== "1") return url;
  try {
    const loc = window.location;
    if (loc.protocol !== "http:" && loc.protocol !== "https:") return url;
    if (!loc.hostname || LOOPBACK_HOSTS.has(loc.hostname.toLowerCase())) return url;
    const u = new URL(url);
    if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return url;
    return `${loc.origin}/pb`;
  } catch {
    return url;
  }
}

/**
 * Server the app talks to (also pre-login). Resolved by `resolvePocketBaseServer`: dev = saved/default
 * 127.0.0.1:8090; production = explicitly saved URL, else the chosen country's live host. Packed My Company = this PocketBase.
 */
export function getPocketBaseServerUrl(): string {
  if (isPlServerPackedApp()) {
    const origin = plServerPackedSameOrigin();
    if (origin) return origin;
  }
  return normalizePocketBaseUrl(resolvePocketBaseServerUrl());
}

function jwtExpMs(token: string): number {
  try {
    const part = token.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : "";
    const exp = Number((JSON.parse(json) as { exp?: number }).exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function readPocketBaseAuth(): PocketBaseAuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PocketBaseAuthState>;
    if (!o.token || !o.userId || !o.url) return null;
    return {
      url: normalizePocketBaseUrl(o.url),
      token: String(o.token),
      userId: String(o.userId),
      email: String(o.email || ""),
      expMs: Number(o.expMs) || 0,
    };
  } catch {
    return null;
  }
}

/** Fired when the app user signs in to / out of the server (not on token renewal). */
export const PL_PB_AUTH_CHANGED_EVENT = "pl-pb-auth-changed";

export function applyPocketBaseAuthState(state: PocketBaseAuthState, notify = true): void {
  writePocketBaseAuth(state, notify);
}

function writePocketBaseAuth(state: PocketBaseAuthState | null, notify = false): void {
  if (typeof window === "undefined") return;
  const had = notify || !state ? !!window.localStorage.getItem(AUTH_KEY) : true;
  try {
    if (state) window.localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
  if (notify || (!state && had)) {
    try {
      window.dispatchEvent(new CustomEvent(PL_PB_AUTH_CHANGED_EVENT, { detail: { signedIn: !!state } }));
    } catch {
      /* ignore */
    }
  }
}

/** Signed in to the configured server with a token that is still valid. */
export function getValidPocketBaseAuth(): PocketBaseAuthState | null {
  const a = readPocketBaseAuth();
  if (!a) return null;
  if (a.url !== getPocketBaseServerUrl()) return null;
  if (a.expMs && a.expMs <= Date.now() + 60_000) return null;
  return a;
}

async function rawRequest(
  url: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string;
    timeoutMs?: number;
    asBlob?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<unknown> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const abortFromOuter = () => {
    try {
      ctrl?.abort();
    } catch {
      /* ignore */
    }
  };
  if (ctrl && init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener("abort", abortFromOuter, { once: true });
  }
  const timer = ctrl ? setTimeout(() => ctrl.abort(), init.timeoutMs || REQUEST_TIMEOUT_MS) : null;
  try {
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    const headers: Record<string, string> = { Accept: init.asBlob ? "*/*" : "application/json" };
    // Multipart: the browser sets Content-Type with the boundary.
    if (init.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (init.token) headers.Authorization = init.token;
    const res = await fetch(url + path, {
      method: init.method || "GET",
      headers,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
      signal: ctrl?.signal,
      cache: "no-store",
    });
    if (init.asBlob && res.ok) return await res.blob();
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data as { message?: string } | null)?.message || `HTTP ${res.status}`;
      throw new PocketBaseRequestError(`Pocket Ledger Server: ${msg}`, res.status, data);
    }
    return data;
  } catch (e) {
    if (e instanceof PocketBaseRequestError) throw e;
    const aborted = (e as { name?: string })?.name === "AbortError";
    throw new PocketBaseRequestError(
      aborted ? "Pocket Ledger Server: request timed out" : "Pocket Ledger Server: not reachable",
      0
    );
  } finally {
    if (timer) clearTimeout(timer);
    try {
      init.signal?.removeEventListener("abort", abortFromOuter);
    } catch {
      /* ignore */
    }
  }
}

/** Sign in an app user (pl_users). Stores only the token. */
export async function pocketBaseSignIn(email: string, password: string, url?: string): Promise<PocketBaseAuthState> {
  const base = normalizePocketBaseUrl(url || getPocketBaseServerUrl());
  const res = (await rawRequest(base, "/api/collections/pl_users/auth-with-password", {
    method: "POST",
    body: { identity: String(email || "").trim().toLowerCase(), password: String(password || "") },
  })) as { token?: string; record?: { id?: string; email?: string } };
  if (!res?.token || !res.record?.id) throw new PocketBaseRequestError("Pocket Ledger Server: sign-in failed", 400);
  const state: PocketBaseAuthState = {
    url: base,
    token: res.token,
    userId: res.record.id,
    email: String(res.record.email || email || "").toLowerCase(),
    expMs: jwtExpMs(res.token),
  };
  writePocketBaseAuth(state, true);
  return state;
}

/** Why "Login with Google" on the server did not finish. */
export class PocketBaseGoogleLoginError extends Error {
  code: "popup_blocked" | "not_configured" | "timeout" | "denied" | "unsupported" | "failed";
  constructor(code: PocketBaseGoogleLoginError["code"], message: string) {
    super(message);
    this.name = "PocketBaseGoogleLoginError";
    this.code = code;
  }
}

/**
 * "Login with Google" on the Pocket Ledger Server (PocketBase OAuth2 on `pl_users`), no Firebase.
 * Same flow as the PocketBase JS SDK `authWithOAuth2`: popup -> Google -> `<server>/api/oauth2-redirect`
 * -> realtime event (`@oauth2`) -> `auth-with-oauth2` exchange. Stores only the server token, so every
 * read / write afterwards uses the server. Call it directly from the click handler (popup blockers).
 * Server errors (pending / rejected account) are thrown as PocketBaseRequestError (see pocketBaseApprovalState).
 */
export async function pocketBaseGoogleSignIn(url?: string): Promise<PocketBaseAuthState> {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    throw new PocketBaseGoogleLoginError("unsupported", "Google sign-in is not available here");
  }
  const base = normalizePocketBaseUrl(url || getPocketBaseServerUrl());
  // open the popup first, inside the click gesture
  const popup = window.open("about:blank", "pl_pb_google_login", "width=520,height=720");
  if (!popup) throw new PocketBaseGoogleLoginError("popup_blocked", "Allow pop-ups for this app, then try again");
  let es: EventSource | null = null;
  const cleanup = () => {
    try {
      es?.close();
    } catch {
      /* ignore */
    }
    try {
      popup.close();
    } catch {
      /* ignore */
    }
  };
  try {
    const methods = (await rawRequest(base, "/api/collections/pl_users/auth-methods")) as {
      oauth2?: { enabled?: boolean; providers?: { name?: string; authURL?: string; codeVerifier?: string }[] };
    };
    const provider = (methods?.oauth2?.providers || []).find((p) => p?.name === "google");
    if (!methods?.oauth2?.enabled || !provider?.authURL) {
      throw new PocketBaseGoogleLoginError(
        "not_configured",
        "Google sign-in is not set up on this server yet (PocketBase admin > pl_users > OAuth2 > Google)"
      );
    }
    const stream = new EventSource(base + "/api/realtime");
    es = stream;
    const clientId = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new PocketBaseGoogleLoginError("failed", "Server realtime did not answer")), 15_000);
      stream.addEventListener("PB_CONNECT", (ev) => {
        clearTimeout(t);
        resolve((ev as MessageEvent).lastEventId);
      });
      stream.onerror = () => {
        clearTimeout(t);
        reject(new PocketBaseGoogleLoginError("failed", "Pocket Ledger Server: not reachable"));
      };
    });
    const waiting = new Promise<{ state?: string; code?: string; error?: string }>((resolve, reject) => {
      const t = setTimeout(() => reject(new PocketBaseGoogleLoginError("timeout", "Google sign-in timed out")), 240_000);
      stream.addEventListener("@oauth2", (ev) => {
        clearTimeout(t);
        try {
          resolve(JSON.parse((ev as MessageEvent).data || "{}"));
        } catch {
          resolve({});
        }
      });
    });
    waiting.catch(() => undefined);
    await rawRequest(base, "/api/realtime", { method: "POST", body: { clientId, subscriptions: ["@oauth2"] } });
    const redirectURL = base + "/api/oauth2-redirect";
    const authUrl = new URL(provider.authURL + encodeURIComponent(redirectURL));
    authUrl.searchParams.set("state", clientId);
    popup.location.href = authUrl.toString();
    const got = await waiting;
    if (got.error || !got.code) throw new PocketBaseGoogleLoginError("denied", "Google sign-in was cancelled");
    if (got.state !== clientId) throw new PocketBaseGoogleLoginError("failed", "Google sign-in state mismatch");
    const res = (await rawRequest(base, "/api/collections/pl_users/auth-with-oauth2", {
      method: "POST",
      body: { provider: "google", code: got.code, codeVerifier: provider.codeVerifier || "", redirectURL },
    })) as { token?: string; record?: { id?: string; email?: string } };
    if (!res?.token || !res.record?.id) throw new PocketBaseRequestError("Pocket Ledger Server: sign-in failed", 400);
    const state: PocketBaseAuthState = {
      url: base,
      token: res.token,
      userId: res.record.id,
      email: String(res.record.email || "").toLowerCase(),
      expMs: jwtExpMs(res.token),
    };
    writePocketBaseAuth(state, true);
    return state;
  } finally {
    cleanup();
  }
}
/** Self-registration (Pocket Ledger Server login). The server's "New account approval"
 *  setting decides the result: "approved" (Auto, can sign in right away) or "pending"
 *  (Manual, cannot sign in until a main admin approves it in the server panel).
 *  "otp": the server has email (SMTP) set up and sent a 6-digit code to the email; the
 *  account works only after `pocketBaseVerifySignUpOtp`. */
export async function pocketBaseSignUp(
  email: string,
  password: string,
  url?: string,
): Promise<{ status: "pending" | "approved" | "otp"; expiresInSec?: number }> {
  const base = normalizePocketBaseUrl(url || getPocketBaseServerUrl());
  const res = (await rawRequest(base, "/api/pl/signup", {
    method: "POST",
    body: { email: String(email || "").trim().toLowerCase(), password: String(password || "") },
  })) as { ok?: boolean; status?: string; expiresInSec?: number };
  if (!res?.ok) throw new PocketBaseRequestError("Pocket Ledger Server: sign-up failed", 400);
  if (res.status === "otp") return { status: "otp", expiresInSec: Number(res.expiresInSec) || 600 };
  return { status: res.status === "approved" ? "approved" : "pending" };
}

/** Checks the 6-digit sign-up email code. Result: "approved" (can sign in now) or "pending"
 *  (server admin approval still needed). Errors carry data.code: otp_invalid / otp_expired /
 *  otp_too_many / otp_none (+ data.left = tries left). */
export async function pocketBaseVerifySignUpOtp(
  email: string,
  code: string,
  password: string,
  url?: string,
): Promise<{ status: "pending" | "approved" }> {
  const base = normalizePocketBaseUrl(url || getPocketBaseServerUrl());
  const res = (await rawRequest(base, "/api/pl/signup/verify", {
    method: "POST",
    body: {
      email: String(email || "").trim().toLowerCase(),
      code: String(code || "").replace(/\D/g, ""),
      password: String(password || ""),
    },
  })) as { ok?: boolean; status?: string };
  if (!res?.ok) throw new PocketBaseRequestError("Pocket Ledger Server: code check failed", 400);
  return { status: res.status === "approved" ? "approved" : "pending" };
}

/** Sends a new sign-up email code. Errors (err.data.code): otp_cooldown / otp_hourly (+ err.data.retryAfter seconds), smtp_off. */
export async function pocketBaseResendSignUpOtp(email: string, url?: string): Promise<{ expiresInSec: number }> {
  const base = normalizePocketBaseUrl(url || getPocketBaseServerUrl());
  const res = (await rawRequest(base, "/api/pl/signup/resend", {
    method: "POST",
    body: { email: String(email || "").trim().toLowerCase() },
  })) as { ok?: boolean; expiresInSec?: number };
  if (!res?.ok) throw new PocketBaseRequestError("Pocket Ledger Server: could not send a new code", 400);
  return { expiresInSec: Number(res.expiresInSec) || 600 };
}

/** "pending" / "rejected" when a server sign-in failed because the account is not approved yet;
 *  "otp" when the email code from sign-up was not checked yet. */
export function pocketBaseApprovalState(err: unknown): "pending" | "rejected" | "otp" | "" {
  if (!(err instanceof PocketBaseRequestError) || err.status !== 403) return "";
  const d = (err.data as { data?: { approval?: unknown } } | null)?.data;
  // Server sends data.approval = { code: "pl_account_pending" | "pl_account_rejected", message }.
  const raw = d && typeof d === "object" ? (d as { approval?: unknown }).approval : undefined;
  const code = raw && typeof raw === "object" ? String((raw as { code?: unknown }).code || "") : String(raw || "");
  const fromData = code.replace(/^pl_account_/, "");
  if (fromData === "pending" || fromData === "rejected" || fromData === "otp") return fromData;
  if (/pending approval/i.test(err.message)) return "pending";
  if (/not approved/i.test(err.message)) return "rejected";
  return "";
}

/** Short error code from the server's sign-up answer (`email_in_use`, `password_short`, ...). */
export function pocketBaseErrorCode(err: unknown): string {
  if (!(err instanceof PocketBaseRequestError)) return "";
  const c = (err.data as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "";
}

export function pocketBaseSignOut(): void {
  writePocketBaseAuth(null);
}

let refreshPromise: Promise<PocketBaseAuthState | null> | null = null;

/** Token renewal when less than a day is left (7-day tokens on the server). */
async function refreshIfNeeded(a: PocketBaseAuthState): Promise<PocketBaseAuthState> {
  if (!a.expMs || a.expMs - Date.now() > 24 * 3600_000) return a;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = (await rawRequest(a.url, "/api/collections/pl_users/auth-refresh", {
          method: "POST",
          token: a.token,
        })) as { token?: string };
        if (!res?.token) return null;
        const next = { ...a, token: res.token, expMs: jwtExpMs(res.token) };
        writePocketBaseAuth(next);
        return next;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return (await refreshPromise) || a;
}

export class PocketBaseNotSignedInError extends PocketBaseRequestError {
  constructor() {
    super("Pocket Ledger Server: not signed in", 401);
    this.name = "PocketBaseNotSignedInError";
  }
}

/** Authenticated request to the configured server. */
export async function pbRequest(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<unknown> {
  const a0 = getValidPocketBaseAuth();
  if (!a0) throw new PocketBaseNotSignedInError();
  const a = await refreshIfNeeded(a0);
  try {
    return await rawRequest(a.url, path, { ...init, token: a.token });
  } catch (e) {
    if (e instanceof PocketBaseRequestError && e.status === 401) writePocketBaseAuth(null);
    throw e;
  }
}

/** Multipart create (file upload). Longer timeout for big files. */
export async function pbFormRequest(
  path: string,
  form: FormData,
  method = "POST",
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown> {
  const a0 = getValidPocketBaseAuth();
  if (!a0) throw new PocketBaseNotSignedInError();
  const a = await refreshIfNeeded(a0);
  try {
    return await rawRequest(a.url, path, {
      method,
      body: form,
      token: a.token,
      timeoutMs: opts?.timeoutMs ?? 120_000,
      signal: opts?.signal,
    });
  } catch (e) {
    if (e instanceof PocketBaseRequestError && e.status === 401) writePocketBaseAuth(null);
    throw e;
  }
}

/** File bytes (path already carries the file token for protected files). */
export async function pbFileBlob(path: string): Promise<Blob | null> {
  const a = getValidPocketBaseAuth();
  if (!a) return null;
  const out = await rawRequest(a.url, path, { asBlob: true, timeoutMs: 60_000 });
  return typeof Blob !== "undefined" && out instanceof Blob ? out : null;
}

/** PocketBase filter string literal (same escaping as the official SDK). */
export function pbQuote(value: unknown): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type PbListResult<T> = { page: number; perPage: number; totalItems: number; totalPages: number; items: T[] };

/** All records matching `filter` (paged, 500 per request). */
export async function pbListAll<T = Record<string, unknown>>(
  collection: string,
  filter: string,
  opts?: {
    sort?: string;
    fields?: string;
    maxPages?: number;
    /** Called after each page (500 rows) so the caller can write it out right away. */
    onPage?: (items: T[], page: number) => void | Promise<void>;
    /** With `onPage`: do not keep rows in the returned array (bounded memory on big pulls). */
    discard?: boolean;
  }
): Promise<T[]> {
  const out: T[] = [];
  const maxPages = opts?.maxPages ?? 200;
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({
      page: String(page),
      perPage: "500",
      skipTotal: "1",
      filter,
    });
    if (opts?.sort) q.set("sort", opts.sort);
    if (opts?.fields) q.set("fields", opts.fields);
    const res = (await pbRequest(`/api/collections/${collection}/records?${q.toString()}`)) as PbListResult<T>;
    const items = Array.isArray(res?.items) ? res.items : [];
    if (!(opts?.onPage && opts.discard)) out.push(...items);
    if (opts?.onPage) await opts.onPage(items, page);
    if (items.length < 500) break;
  }
  return out;
}

export async function pbFirst<T = Record<string, unknown>>(
  collection: string,
  filter: string,
  sort?: string
): Promise<T | null> {
  const q = new URLSearchParams({ page: "1", perPage: "1", skipTotal: "1", filter });
  if (sort) q.set("sort", sort);
  const res = (await pbRequest(`/api/collections/${collection}/records?${q.toString()}`)) as PbListResult<T>;
  return Array.isArray(res?.items) && res.items.length ? res.items[0] : null;
}

export async function pbCreate<T = Record<string, unknown>>(collection: string, body: Record<string, unknown>): Promise<T> {
  return (await pbRequest(`/api/collections/${collection}/records`, { method: "POST", body })) as T;
}

export async function pbUpdate<T = Record<string, unknown>>(
  collection: string,
  id: string,
  body: Record<string, unknown>
): Promise<T> {
  return (await pbRequest(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  })) as T;
}
