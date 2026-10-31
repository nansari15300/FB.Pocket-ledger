"use client";

import { getBillingApiIdToken } from "@/lib/firebaseAuthForApi";
import type { WebsiteDownloadEventKind, WebsiteDownloadPlatform } from "@/lib/websiteDownloadStats";

/** Log in-app release update download (EXE/APK) for admin Download analytics → Updates tab. */
export async function recordReleaseUpdateDownload(params: {
  platform: WebsiteDownloadPlatform;
  version: string;
  fileName?: string;
  source?: string;
}): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const token = await getBillingApiIdToken(null).catch(() => "");
    if (!token) return;
    await fetch("/api/public/download-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        platform: params.platform,
        version: params.version,
        fileName: params.fileName || "",
        source: params.source || "in_app_update",
        eventKind: "update" satisfies WebsiteDownloadEventKind,
      }),
      keepalive: true,
      cache: "no-store",
    });
  } catch {
    /* analytics only */
  }
}
