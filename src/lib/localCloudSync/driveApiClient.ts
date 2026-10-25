"use client";

import { resolveDriveHostedApiUrl } from "@/lib/driveHostedApiOrigin";
import { getDriveApiIdToken } from "@/lib/firebaseAuthForApi";
import { hostedApiFetch } from "@/lib/hostedApiFetch";
import { assertDriveMutationAllowedForCompany } from "@/lib/localCloudSync/driveUploadGate";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

/** Shared Drive API POST — client modules se duplicate fetch na ho. */
export async function postDriveJsonViaClient<T>(path: string, body: unknown): Promise<T> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  await assertDriveMutationAllowedForCompany(path, body);
  const { token } = await getDriveApiIdToken();
  const apiUrl = resolveDriveHostedApiUrl(path);
  const res = await hostedApiFetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const raw = String((json as { error?: string }).error || res.statusText || `Request failed (${apiUrl})`);
    if (/body\.pipe is not a function/i.test(raw)) {
      throw new Error(
        "Drive upload server outdated (body.pipe). Deploy latest code to pocket-ledger.com (Firebase App Hosting), then Force sync again."
      );
    }
    throw new Error(raw);
  }
  return json;
}
