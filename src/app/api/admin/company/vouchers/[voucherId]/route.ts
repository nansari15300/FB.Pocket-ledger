import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";

export const dynamic = "force-dynamic";

const ALLOWED_PATCH_KEYS = new Set(["allocations", "openingBalanceAllocated"]);

async function requireSuperAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "Missing Authorization Bearer token", status: 401 } as const;

  getAdminDb();
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!(await isSuperAdminServer(decoded.uid, decoded.email ?? undefined))) {
      return { error: "SuperAdmin only", status: 403 } as const;
    }
    return { decoded } as const;
  } catch {
    return { error: "Invalid auth token", status: 401 } as const;
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ voucherId: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { voucherId } = await ctx.params;
  const id = String(voucherId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing voucher id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      return NextResponse.json({ error: `Field not allowed: ${key}` }, { status: 400 });
    }
    patch[key] = body[key];
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No allowed fields in body" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID).collection("vouchers").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

  await ref.set(
    {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, id });
}
