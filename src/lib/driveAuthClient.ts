"use client";

import { resolveDriveHostedApiUrl } from "@/lib/driveHostedApiOrigin";
import { readDriveOAuthConnectedMarker, markDriveOAuthConnected } from "@/lib/driveOAuthConnectedMarker";
import { getDriveApiUser, getDriveApiIdToken } from "@/lib/firebaseAuthForApi";
import { hostedApiFetch } from "@/lib/hostedApiFetch";
import { postDriveJsonViaClient } from "@/lib/localCloudSync/driveApiClient";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";
export { openGoogleDriveOAuthUrl, resolveDriveOAuthReturnPath } from "@/lib/driveOAuthNavigation";

export type DriveAuthClientState = {
  returnPath: string;
  uid: string;
  email?: string;
  formData?: unknown;
};

/** Browser — hosted API se OAuth URL (static/APK: pocket-ledger.com; dev localhost UI: pocket-ledger.com). */
export async function getGoogleDriveAuthUrl(state: DriveAuthClientState): Promise<{ url: string }> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  const { token } = await getDriveApiIdToken();
  const apiUrl = resolveDriveHostedApiUrl("/api/auth/google/drive-auth-url");
  const res = await hostedApiFetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(state),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(
      json.error ||
        res.statusText ||
        `Failed to get Drive auth URL (${apiUrl})`
    );
  }
  return { url: json.url };
}

/** Drive unlink — hosted API (static/APK) ya same-origin dev; client Firestore delete mat karo. */
export async function disconnectGoogleDrive(): Promise<void> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  const { token } = await getDriveApiIdToken();
  const res = await hostedApiFetch(resolveDriveHostedApiUrl("/api/auth/google/drive-disconnect"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(json.error || res.statusText || "Failed to disconnect Google Drive");
  }
}

export type GoogleDriveConnectionStatus = {
  connected: boolean;
  email: string | null;
};

async function probeGoogleDriveConnectionViaApi(): Promise<GoogleDriveConnectionStatus> {
  await postDriveJsonViaClient<Record<string, unknown>>(
    "/api/local-cloud-sync/drive/list-shared-companies",
    {}
  );
  const user = await getDriveApiUser();
  const email = String(user.email || "").trim() || null;
  markDriveOAuthConnected(email);
  return { connected: true, email };
}

/** Drive OAuth token saved on server? — backup upload dialog connected badge. */
export async function fetchGoogleDriveConnectionStatus(): Promise<GoogleDriveConnectionStatus> {
  if (isLocalGoogleDriveSyncDisabled()) {
    return { connected: false, email: null };
  }
  const { token, user } = await getDriveApiIdToken();
  const fallbackEmail = String(user.email || "").trim() || null;

  try {
    const res = await hostedApiFetch(resolveDriveHostedApiUrl("/api/auth/google/drive-connection"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = (await res.json().catch(() => ({}))) as GoogleDriveConnectionStatus & { error?: string };
    if (res.ok) {
      const status = {
        connected: json.connected === true,
        email: json.email ? String(json.email) : fallbackEmail,
      };
      if (status.connected) {
        markDriveOAuthConnected(status.email);
        return status;
      }
    }
  } catch {
    /* fall through to probe */
  }

  try {
    return await probeGoogleDriveConnectionViaApi();
  } catch {
    const marker = readDriveOAuthConnectedMarker();
    if (marker) {
      return { connected: true, email: marker.email ?? fallbackEmail };
    }
    return { connected: false, email: null };
  }
}
