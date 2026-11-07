import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { invalidateOpeningSnapshotsAdmin } from "@/lib/fyPagination/server/invalidateOpeningSnapshotsAdmin";
import { isCompanyOwner } from "@/lib/server/companyOwner";

type Body = {
  companyId?: string;
  /** Vouchers on/after this ms invalidate snapshots with beforeMs > afterMs. */
  afterMs?: number;
  /** Master book OB / full rebuild — mark every fySnapshots doc stale. */
  invalidateAll?: boolean;
};

function canWriteCompany(decoded: admin.auth.DecodedIdToken, data: Record<string, unknown>): boolean {
  if (isCompanyOwner(decoded, data as { ownerId?: string; ownerEmail?: string })) return true;
  const emails = Array.isArray(data.sharedWithEmails) ? data.sharedWithEmails : [];
  const e = String(decoded.email || "").toLowerCase().trim();
  if (!e) return false;
  return emails.some((x: unknown) => String(x || "").toLowerCase().trim() === e);
}

export async function POST(req: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      return NextResponse.json({ ok: false, reason: "admin_not_configured" }, { status: 503 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    getAdminDb();
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const afterMs = Number(body.afterMs);
    const invalidateAll = body.invalidateAll === true;

    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }
    if (!invalidateAll && (!Number.isFinite(afterMs) || afterMs <= 0)) {
      return NextResponse.json({ error: "afterMs or invalidateAll required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("companies").doc(companyId);
    const companySnap = await ref.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    const companyData = companySnap.data() || {};
    if (!canWriteCompany(decoded, companyData as Record<string, unknown>)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const marked = await invalidateOpeningSnapshotsAdmin(ref, {
      afterMs: invalidateAll ? undefined : afterMs,
      invalidateAll,
    });

    return NextResponse.json({ ok: true, marked });
  } catch (e) {
    console.error("[opening-snapshots-invalidate]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
