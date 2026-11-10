"use client";

import { POCKET_LEDGER_HOSTED_API_ORIGIN } from "@/lib/billingApiOrigin";
import { getDriveApiUser } from "@/lib/firebaseAuthForApi";
import { readPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import type { WebsiteDownloadEventKind, WebsiteDownloadPlatform } from "@/lib/websiteDownloadStats";

/**
 * Download analytics live on the Pocket Ledger Server (np) in `pb_hooks/lib/site_data.js`
 * (`POST /api/pl/site/public/download-event`). The website Downloads page posts there directly
 * (`website/js/downloads.js`), so the app does the same: EXE / APK have no Next server of their own
 * and a relative `/api/...` 404s there. PocketBase answers CORS for any origin (EXE localhost,
 * Capacitor `https://localhost`, hosted `/app`).
 */
const SITE_DATA_ORIGIN = POCKET_LEDGER_HOSTED_API_ORIGIN.replace(/\/+$/, "");
const DOWNLOAD_EVENT_URL = `${SITE_DATA_ORIGIN}/api/pl/site/public/download-event`;
const IDENTITY_TIMEOUT_MS = 2500;

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Server login token, only when it belongs to the np site-data server and is not expired. */
function siteDataServerAuth(): { token: string; email: string } | null {
  const a = readPocketBaseAuth();
  if (!a || !a.token) return null;
  if (a.expMs && a.expMs <= Date.now() + 60_000) return null;
  if (!sameHost(a.url, SITE_DATA_ORIGIN)) return { token: "", email: a.email || "" };
  return { token: a.token, email: a.email || "" };
}

/** Signed-in email (server login or older account) - blank when nobody is signed in. */
async function signedInEmail(): Promise<string> {
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), IDENTITY_TIMEOUT_MS));
  const lookup = getDriveApiUser()
    .then((u) => String(u?.email || ""))
    .catch(() => "");
  return Promise.race([lookup, timeout]);
}

/** Log in-app release update download (EXE/APK) for admin Download analytics -> Updates tab. */
export async function recordReleaseUpdateDownload(params: {
  platform: WebsiteDownloadPlatform;
  version: string;
  fileName?: string;
  source?: string;
}): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const pb = siteDataServerAuth();
    const email = (pb?.email || (await signedInEmail())).trim();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // PocketBase expects the raw token (no `Bearer`), same as the website sender.
    if (pb?.token) headers.Authorization = pb.token;
    const res = await fetch(DOWNLOAD_EVENT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platform: params.platform,
        version: String(params.version || "").trim(),
        fileName: params.fileName || "",
        source: params.source || "in_app_update",
        userEmail: email,
        eventKind: "update" satisfies WebsiteDownloadEventKind,
      }),
      keepalive: true,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[download-analytics] update event not recorded:", res.status);
    }
  } catch (e) {
    // Analytics only - never block the update.
    console.warn("[download-analytics] update event failed:", e instanceof Error ? e.message : e);
  }
}