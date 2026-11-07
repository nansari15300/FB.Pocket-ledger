import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_COMPANY_NAME,
  ADMIN_PANEL_DEFAULT_LEDGER_ACCOUNTS,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import { seedAdminPanelCompanyDefaultMasters } from "@/lib/adminPanelCompany/seedDefaultMasters";

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

  const db = getAdminDb();
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const snap = await companyRef.get();
  if (snap.exists) {
    await seedAdminPanelCompanyDefaultMasters(db).catch((e) =>
      console.warn("[admin/company] seed masters", e)
    );
  }

  return NextResponse.json({
    exists: snap.exists,
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    company: snap.exists ? snap.data() : null,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminDb();
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  if (!(await companyRef.get()).exists) {
    return NextResponse.json({ error: "Create Admin Panel Company first" }, { status: 409 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  for (const key of ["name", "address", "phone", "email", "pan"] as const) {
    if (typeof body[key] === "string") {
      patch[key] = body[key].trim().slice(0, 500);
    }
  }
  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await companyRef.set(patch, { merge: true });
  const snap = await companyRef.get();
  return NextResponse.json({ company: snap.data() });
}

/**
 * Creates one cloud Admin Panel Company. The document ID is stable and
 * merge-only, so retries cannot make a second company or replace settings.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminDb();
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const existing = await companyRef.get();
  if (existing.exists) {
    return NextResponse.json({
      created: false,
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      company: existing.data(),
    });
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.create(companyRef, {
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    licenseId: null,
    name: ADMIN_PANEL_COMPANY_NAME,
    kind: "admin-panel-company",
    status: "active",
    createdByUid: auth.decoded.uid,
    createdByEmail: auth.decoded.email ?? null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  });

  batch.set(companyRef.collection("settings").doc("accounting"), {
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    autoPostSubscriptions: true,
    autoPostAgentCommission: true,
    autoVoucherPolicy: "system-locked",
    createdAt: now,
    updatedAt: now,
  });

  for (const account of ADMIN_PANEL_DEFAULT_LEDGER_ACCOUNTS) {
    batch.set(companyRef.collection("ledger_accounts").doc(account.id), {
      ...account,
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
  await seedAdminPanelCompanyDefaultMasters(db).catch((e) =>
    console.warn("[admin/company] seed masters after create", e)
  );

  return NextResponse.json({
    created: true,
    tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    company: {
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
      name: ADMIN_PANEL_COMPANY_NAME,
      kind: "admin-panel-company",
      status: "active",
    },
  });
}
