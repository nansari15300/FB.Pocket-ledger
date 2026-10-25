import "server-only";

import admin from "firebase-admin";
import { NextRequest } from "next/server";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";
import { PB_BEARER_PREFIX, verifyPocketBaseBearer } from "@/lib/localCloudSync/server/pbBearerAuth";

export async function verifyBearerUid(
  req: NextRequest
): Promise<{ uid: string; email: string | null } | { error: string; status: number }> {
  if (isLocalGoogleDriveSyncDisabled()) {
    return { error: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE, status: 503 };
  }
  if (!isFirebaseAdminConfigured()) {
    return { error: "Firebase Admin not configured", status: 503 };
  }
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "Missing Authorization Bearer token", status: 401 };
  getAdminDb();
  // Pocket Ledger Server login (no Firebase session): Drive works with its own Google authorization.
  if (token.startsWith(PB_BEARER_PREFIX)) return verifyPocketBaseBearer(token);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return { error: "Invalid auth token", status: 401 };
  }
}
