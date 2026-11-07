import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";

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

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ref = getAdminDb()
    .collection(ADMIN_PANEL_COMPANIES_COLLECTION)
    .doc(CLOUD_ADMIN_PANEL_TENANT_ID)
    .collection("settings")
    .doc("accounting");
  const snap = await ref.get();
  return NextResponse.json({ settings: snap.exists ? snap.data() : null });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const companyRef = getAdminDb().collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  if (!(await companyRef.get()).exists) {
    return NextResponse.json({ error: "Create Admin Panel Company first" }, { status: 409 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (typeof body.subscriptionTaxRatePercent === "number") {
    patch.subscriptionTaxRatePercent = Math.min(100, Math.max(0, body.subscriptionTaxRatePercent));
  }
  if (typeof body.subscriptionTaxLedgerAccountId === "string") {
    patch.subscriptionTaxLedgerAccountId = body.subscriptionTaxLedgerAccountId.trim().slice(0, 120) || "tax-payable";
  }
  if (typeof body.autoPostSubscriptions === "boolean") {
    patch.autoPostSubscriptions = body.autoPostSubscriptions;
  }
  if (typeof body.autoPostAgentCommission === "boolean") {
    patch.autoPostAgentCommission = body.autoPostAgentCommission;
  }
  if (typeof body.agentCommissionRatePercent === "number") {
    patch.agentCommissionRatePercent = Math.min(100, Math.max(0, body.agentCommissionRatePercent));
  }

  const ref = companyRef.collection("settings").doc("accounting");
  await ref.set(patch, { merge: true });
  const snap = await ref.get();
  return NextResponse.json({ settings: snap.data() });
}
