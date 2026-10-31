import "server-only";

import { PB_BEARER_PREFIX, pocketBaseServerUrlForApi } from "@/lib/localCloudSync/server/pbBearerAuth";

/**
 * Forwards a hosted-API call to the Pocket Ledger Server's marketing-site routes
 * (`/api/pl/site/...`, pb_hooks/lib/site_data.js). Notice, videos, engagement and download events
 * live on the server, not in Firestore.
 */
export async function pbSiteForward(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; bearer?: string; country?: string; ip?: string }
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const b = String(init.bearer || "");
  if (b.startsWith(PB_BEARER_PREFIX)) headers.Authorization = b.slice(PB_BEARER_PREFIX.length);
  if (init.country) headers["CF-IPCountry"] = init.country;
  if (init.ip) headers["X-Forwarded-For"] = init.ip;
  try {
    const res = await fetch(`${pocketBaseServerUrlForApi()}${path}`, {
      method: init.method,
      headers,
      body: init.method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  } catch {
    return { status: 503, json: { error: "Pocket Ledger Server not reachable" } };
  }
}