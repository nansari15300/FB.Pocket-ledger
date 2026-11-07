import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import { buildProcessedPartiesStaffTaxesForRp } from "@/lib/rpProcessedEntitiesBuilder";
import {
  computeReceivablesPayablesFinancialSummary,
  type ReceivablesPayablesDateRange,
} from "@/lib/receivablesPayablesFinancialSummary";

/** Firestore company subdocs jahan optional encryption marker — Admin read par bhi client decrypt ke bina compute nahi. */
const PL_ENCRYPTED_V1 = "plEncryptedV1";

type Body = {
  companyId?: string;
  receivablesDateRange?: { from?: string; to?: string };
};

function canReadCompanyDashboard(decoded: admin.auth.DecodedIdToken, data: Record<string, unknown>): boolean {
  if (isCompanyOwner(decoded, data as { ownerId?: string; ownerEmail?: string })) return true;
  const emails = Array.isArray(data.sharedWithEmails) ? data.sharedWithEmails : [];
  const e = String(decoded.email || "")
    .toLowerCase()
    .trim();
  if (!e) return false;
  return emails.some((x: unknown) => String(x || "").toLowerCase().trim() === e);
}

function isEncryptedDoc(data: Record<string, unknown> | undefined): boolean {
  return data?.[PL_ENCRYPTED_V1] === true;
}

function parseRpRange(body: Body): ReceivablesPayablesDateRange | undefined {
  const r = body.receivablesDateRange;
  if (!r?.from) return undefined;
  const from = new Date(r.from);
  if (isNaN(from.getTime())) return undefined;
  const to = r.to ? new Date(r.to) : undefined;
  if (to !== undefined && isNaN(to.getTime())) return { from };
  return to ? { from, to } : { from };
}

/**
 * POST: Bearer + companyId — server par vouchers + masters read karke R/P summary (browser par poori list reduce na ho).
 * Encrypted subdocs / Admin missing → client fallback.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      return NextResponse.json(
        { ok: false, useClientFallback: true, reason: "admin_not_configured" },
        { status: 503 }
      );
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
    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("companies").doc(companyId);
    const companySnap = await ref.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    const companyData = companySnap.data() || {};
    if (companyData.isDeleted === true) {
      return NextResponse.json({ error: "company_deleted" }, { status: 404 });
    }
    if (!canReadCompanyDashboard(decoded, companyData as Record<string, unknown>)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const sub = async (name: string) => {
      const snap = await ref.collection(name).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    };

    const [voucherRows, parties, staff, taxes, items, expenseAccounts, bankAccounts] = await Promise.all([
      sub("vouchers"),
      sub("parties"),
      sub("staff"),
      sub("taxes"),
      sub("items"),
      sub("expense_accounts"),
      sub("bank_accounts"),
    ]);

    const vouchers = voucherRows.filter((r: Record<string, unknown>) => r.isDeleted !== true);
    const anyEnc =
      vouchers.some((r) => isEncryptedDoc(r)) ||
      parties.some((r) => isEncryptedDoc(r)) ||
      staff.some((r) => isEncryptedDoc(r)) ||
      taxes.some((r) => isEncryptedDoc(r)) ||
      items.some((r) => isEncryptedDoc(r)) ||
      expenseAccounts.some((r) => isEncryptedDoc(r)) ||
      bankAccounts.some((r) => isEncryptedDoc(r));

    if (anyEnc) {
      return NextResponse.json({
        ok: false,
        useClientFallback: true,
        reason: "encrypted_company_data",
      });
    }

    const { processedParties, processedStaff, processedTaxes } = buildProcessedPartiesStaffTaxesForRp({
      parties,
      staff,
      taxes,
      expenseAccounts,
      vouchers,
      items,
    });

    const receivablesDateRange = parseRpRange(body);
    const summary = computeReceivablesPayablesFinancialSummary({
      vouchers,
      processedParties,
      processedStaff,
      processedTaxes,
      processedAccounts: bankAccounts.filter((r: Record<string, unknown>) => r.isDeleted !== true),
      processedExpenseAccounts: expenseAccounts,
      receivablesDateRange,
      loading: false,
    });

    return NextResponse.json({
      ok: true,
      useClientFallback: false,
      summary,
      voucherCount: vouchers.length,
    });
  } catch (e) {
    console.error("[dashboard-financial-summary]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
