import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import {
  ADMIN_PANEL_COMPANIES_COLLECTION,
  ADMIN_PANEL_COMPANY_NAME,
  CLOUD_ADMIN_PANEL_TENANT_ID,
} from "@/lib/adminPanelCompany/constants";
import { ADMIN_PANEL_SEED_GATEWAY_BANK_ID } from "@/lib/adminPanelCompany/constants";
import { seedAdminPanelCompanyDefaultMasters } from "@/lib/adminPanelCompany/seedDefaultMasters";
import { seedPaymentGatewayBanksForAdminCompany } from "@/lib/adminPanelCompany/seedPaymentGatewayBanks";
import {
  mapAdminPanelBankToLedgerDoc,
  mapAdminPanelExpenseToLedgerDoc,
  mapAdminPanelItemToLedgerDoc,
  mapAdminPanelPartyToLedgerDoc,
  mapAdminPanelStaffToLedgerDoc,
  mapAdminPanelTaxToLedgerDoc,
  mapAdminPanelVoucherToLedgerDoc,
} from "@/lib/adminPanelCompany/mapLedgerSnapshot";
import { ensureSubscriptionCatalogItems } from "@/lib/adminPanelAccounting/subscriptionCatalogItems";

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

const KIND_TO_LEDGER_COLLECTION: Record<string, string> = {
  parties: "parties",
  bank_accounts: "bank_accounts",
  items: "items",
  staff: "staff",
  taxes: "taxes",
  expense_accounts: "expense_accounts",
  vouchers: "vouchers",
};

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminDb();
  const companyRef = db.collection(ADMIN_PANEL_COMPANIES_COLLECTION).doc(CLOUD_ADMIN_PANEL_TENANT_ID);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    return NextResponse.json({ error: "Create Admin Panel Company first" }, { status: 409 });
  }

  await seedAdminPanelCompanyDefaultMasters(db).catch(() => {});
  await seedPaymentGatewayBanksForAdminCompany(db).catch(() => {});
  await ensureSubscriptionCatalogItems(db).catch(() => {});

  const collections: Record<string, Array<Record<string, unknown>>> = {
    parties: [],
    bank_accounts: [],
    items: [],
    staff: [],
    taxes: [],
    expense_accounts: [],
    vouchers: [],
  };

  for (const kind of Object.keys(KIND_TO_LEDGER_COLLECTION)) {
    const snap = await companyRef.collection(kind).limit(500).get();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (kind === "parties") collections.parties.push(mapAdminPanelPartyToLedgerDoc(doc.id, data));
      else if (kind === "bank_accounts") {
        if (doc.id === ADMIN_PANEL_SEED_GATEWAY_BANK_ID) continue;
        if (data.active === false) continue;
        collections.bank_accounts.push(mapAdminPanelBankToLedgerDoc(doc.id, data));
      } else if (kind === "items") {
        if (data.active === false) continue;
        collections.items.push(mapAdminPanelItemToLedgerDoc(doc.id, data));
      } else if (kind === "staff") collections.staff.push(mapAdminPanelStaffToLedgerDoc(doc.id, data));
      else if (kind === "taxes") collections.taxes.push(mapAdminPanelTaxToLedgerDoc(doc.id, data));
      else if (kind === "expense_accounts") {
        collections.expense_accounts.push(mapAdminPanelExpenseToLedgerDoc(doc.id, data));
      } else if (kind === "vouchers") {
        collections.vouchers.push(mapAdminPanelVoucherToLedgerDoc(doc.id, data));
      }
    }
  }

  return NextResponse.json({
    company: {
      id: companySnap.id,
      name: String(companySnap.data()?.name ?? ADMIN_PANEL_COMPANY_NAME),
      tenantId: CLOUD_ADMIN_PANEL_TENANT_ID,
    },
    collections,
  });
}
