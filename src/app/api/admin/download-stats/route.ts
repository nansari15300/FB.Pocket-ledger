import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  DOWNLOAD_EVENTS_COLLECTION,
  DOWNLOAD_STATS_DOC,
  DOWNLOAD_STATS_UPDATE_DOC,
  mergeDownloadStatsDoc,
  type WebsiteDownloadEvent,
  type WebsiteDownloadPlatform,
} from "@/lib/websiteDownloadStats";
import { ANDROID_APP_VERSION, DESKTOP_APP_VERSION } from "@/config/releaseVersion";
import { compareReleaseVersions } from "@/lib/releaseUpdateCheck";
import { loadEmailCompanyProfiles } from "@/lib/downloadStatsEmailCompanies";

export const dynamic = "force-dynamic";

async function requireSuperAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: NextResponse.json({ error: "Missing Authorization" }, { status: 401 }) };
  if (!isFirebaseAdminConfigured()) {
    return { error: NextResponse.json({ error: "Admin not configured" }, { status: 503 }) };
  }
  getAdminDb();
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return { error: NextResponse.json({ error: "Invalid auth token" }, { status: 401 }) };
  }
  if (!(await isSuperAdminServer(decoded.uid, decoded.email ?? undefined))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  try {
    const gate = await requireSuperAdmin(req);
    if ("error" in gate) return gate.error;

    const db = getAdminDb();
    const [statsSnap, statsUpdateSnap, eventsSnap] = await Promise.all([
      db.doc(DOWNLOAD_STATS_DOC).get(),
      db.doc(DOWNLOAD_STATS_UPDATE_DOC).get(),
      db.collection(DOWNLOAD_EVENTS_COLLECTION).orderBy("createdAtMs", "desc").limit(500).get(),
    ]);
    const stats = mergeDownloadStatsDoc(statsSnap.exists ? statsSnap.data() : undefined);
    const statsUpdate = mergeDownloadStatsDoc(statsUpdateSnap.exists ? statsUpdateSnap.data() : undefined);
    const currentReleaseVersion =
      compareReleaseVersions(ANDROID_APP_VERSION, DESKTOP_APP_VERSION) >= 0
        ? ANDROID_APP_VERSION
        : DESKTOP_APP_VERSION;
    const recent: WebsiteDownloadEvent[] = eventsSnap.docs.map((d) => {
      const row = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        platform: String(row.platform || "windows") as WebsiteDownloadPlatform,
        country: String(row.country || "ZZ"),
        version: row.version ? String(row.version) : undefined,
        fileName: row.fileName ? String(row.fileName) : undefined,
        source: row.source ? String(row.source) : undefined,
        eventKind: row.eventKind === "update" ? "update" : "new",
        userId: row.userId ? String(row.userId) : undefined,
        userEmail: row.userEmail ? String(row.userEmail) : undefined,
        createdAtMs: Number(row.createdAtMs) || 0,
      };
    });

    const byCountryRows = Object.entries(stats.byCountry)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

    const uniqueEmails = recent
      .map((row) => row.userEmail)
      .filter((email): email is string => Boolean(email && String(email).trim()));
    const emailProfiles = await loadEmailCompanyProfiles(db, uniqueEmails);

    return NextResponse.json({
      stats,
      statsUpdate,
      currentReleaseVersion,
      releaseVersions: { windows: DESKTOP_APP_VERSION, android: ANDROID_APP_VERSION },
      byCountry: byCountryRows,
      recent,
      emailProfiles,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
