import "server-only";

/**
 * Hosting settings saved in the Pocket Ledger Server panel (Server settings > Hosting settings).
 *
 * Which value wins (same order as shown in the panel):
 *   1. environment variable of this app (Next)        e.g. GOOGLE_CLIENT_SECRET
 *   2. value saved in the server panel                 fetched from PocketBase
 *   3. built-in default of the caller                  e.g. FIREBASE_WEB_OAUTH_CLIENT_ID
 *
 * The app reads the saved values only when PL_HOSTING_KEY is set (the "App link key" from the
 * panel). It calls POST <PocketBase>/api/pl/hosting/runtime with header X-PL-Hosting-Key and
 * sends the NAMES of its set environment variables (X-PL-Env-Set) so the panel can show
 * "overridden by ...". Values are cached in memory for 60 s and never logged.
 * The PocketBase address used for this call is pocketBaseServerUrlForApi() (env or 127.0.0.1).
 */
import { pocketBaseServerUrlForApi } from "@/lib/localCloudSync/server/pbBearerAuth";

export type HostingKey =
  | "server_url"
  | "app_url"
  | "google_client_id"
  | "google_client_secret"
  | "drive_state_secret";

/** Literal process.env reads (keeps Next build-time inlining of NEXT_PUBLIC_*). */
function envValues(): Record<string, string> {
  return {
    PL_POCKETBASE_URL: String(process.env.PL_POCKETBASE_URL ?? ""),
    NEXT_PUBLIC_POCKETBASE_URL: String(process.env.NEXT_PUBLIC_POCKETBASE_URL ?? ""),
    NEXT_PUBLIC_APP_URL: String(process.env.NEXT_PUBLIC_APP_URL ?? ""),
    NEXT_PUBLIC_BASE_URL: String(process.env.NEXT_PUBLIC_BASE_URL ?? ""),
    NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: String(process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ""),
    GOOGLE_CLIENT_SECRET: String(process.env.GOOGLE_CLIENT_SECRET ?? ""),
    DRIVE_OAUTH_STATE_SECRET: String(process.env.DRIVE_OAUTH_STATE_SECRET ?? ""),
    PL_HOSTING_KEY: String(process.env.PL_HOSTING_KEY ?? ""),
  };
}

const ENV_FOR: Record<HostingKey, string[]> = {
  server_url: ["PL_POCKETBASE_URL", "NEXT_PUBLIC_POCKETBASE_URL"],
  app_url: ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL"],
  google_client_id: ["NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID"],
  google_client_secret: ["GOOGLE_CLIENT_SECRET"],
  drive_state_secret: ["DRIVE_OAUTH_STATE_SECRET"],
};

const TTL_MS = 60_000;
const RETRY_MS = 15_000;
const TIMEOUT_MS = 4_000;

let saved: Partial<Record<HostingKey, string>> = {};
let nextFetchAt = 0;
let inflight: Promise<void> | null = null;

/** Value from this app's environment variable (first one set), else "". */
export function hostingEnvValue(key: HostingKey): string {
  const env = envValues();
  for (const name of ENV_FOR[key]) {
    const v = env[name].trim();
    if (v) return v;
  }
  return "";
}

/** Effective value: env var > value saved in the server panel > "" (caller applies its default). */
export function hostingSetting(key: HostingKey): string {
  return hostingEnvValue(key) || String(saved[key] ?? "").trim();
}

/** Where the effective value comes from (no values, safe for diagnostics). */
export function hostingSource(key: HostingKey): "env" | "server" | "none" {
  if (hostingEnvValue(key)) return "env";
  return String(saved[key] ?? "").trim() ? "server" : "none";
}

/** True when the app is linked to the server panel (PL_HOSTING_KEY set). */
export function hostingLinked(): boolean {
  return envValues().PL_HOSTING_KEY.trim().length >= 24;
}

async function fetchRuntime(): Promise<void> {
  const env = envValues();
  const key = env.PL_HOSTING_KEY.trim();
  const setNames = Object.keys(env).filter((n) => n !== "PL_HOSTING_KEY" && env[n].trim());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${pocketBaseServerUrlForApi()}/api/pl/hosting/runtime`, {
      method: "POST",
      headers: { "X-PL-Hosting-Key": key, "X-PL-Env-Set": setNames.join(","), Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`hosting runtime ${res.status}`);
    const data = (await res.json()) as { values?: Record<string, unknown> };
    const v = data && data.values && typeof data.values === "object" ? data.values : {};
    const next: Partial<Record<HostingKey, string>> = {};
    (Object.keys(ENV_FOR) as HostingKey[]).forEach((k) => {
      const s = typeof v[k] === "string" ? (v[k] as string).trim() : "";
      if (s) next[k] = s;
    });
    saved = next;
    nextFetchAt = Date.now() + TTL_MS;
  } catch (err) {
    // keep the last good values; try again soon. Never log values.
    nextFetchAt = Date.now() + RETRY_MS;
    console.warn("[hosting] could not read hosting settings from the server:", err instanceof Error ? err.message : "error");
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh the saved values from the server when due. No-op without PL_HOSTING_KEY. */
export async function ensureHostingConfig(): Promise<void> {
  if (!hostingLinked()) return;
  if (Date.now() < nextFetchAt) return;
  if (!inflight) inflight = fetchRuntime().finally(() => { inflight = null; });
  await inflight;
}
