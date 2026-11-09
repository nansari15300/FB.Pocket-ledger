import "server-only";

import { NextRequest } from "next/server";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";
import { PB_BEARER_PREFIX, verifyPocketBaseBearer } from "@/lib/localCloudSync/server/pbBearerAuth";

/**
 * Drive API caller.
 *
 * Only Pocket Ledger Server sessions are accepted (`Authorization: Bearer plpb.<token>`); the token
 * is checked against the user's own `pl_users` record. Firebase ID tokens are no longer verified —
 * Firebase is authentication-free in this build (Google Drive uses its own OAuth grant).
 */
export async function verifyBearerUid(
  req: NextRequest
): Promise<{ uid: string; email: string | null } | { error: string; status: number }> {
  if (isLocalGoogleDriveSyncDisabled()) {
    return { error: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE, status: 503 };
  }
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "Missing Authorization Bearer token", status: 401 };
  if (!token.startsWith(PB_BEARER_PREFIX)) {
    return { error: "Sign in with your Pocket Ledger Server account", status: 401 };
  }
  return verifyPocketBaseBearer(token);
}
