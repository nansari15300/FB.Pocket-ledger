import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import {
  buildDaybookDailySummary,
  type DaybookSummaryAccountInput,
} from "@/lib/accountLedgerDaySummary";

/** Firestore company subdocs jahan optional encryption marker — Admin read par bhi client decrypt ke bina compute nahi. */
const PL_ENCRYPTED_V1 = "plEncryptedV1";
const VOUCHER_PAGE_SIZE = 400;

type Body = {
  companyId?: string;
  /** ISO date for the daybook selected day */
  selectedDay?: string;
  userIdFilter?: string | null;
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

/**
 * POST: Bearer + companyId + selectedDay —
 * bank/cash Daily Summary server pe; vouchers documentId pages me read (browser par poori list reduce na ho).
 * Encrypted / Admin missing → client fallback.
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
    const selectedRaw = typeof body.selectedDay === "string" ? body.selectedDay.trim() : "";
    const selectedDay = selectedRaw ? new Date(selectedRaw) : null;
    if (!selectedDay || isNaN(selectedDay.getTime())) {
      return NextResponse.json({ error: "selectedDay required (ISO)" }, { status: 400 });
    }
    const userIdFilter =
      body.userIdFilter == null || body.userIdFilter === ""
        ? null
        : String(body.userIdFilter);

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

    const accountsSnap = await ref.collection("bank_accounts").get();
    const accounts: DaybookSummaryAccountInput[] = [];
    for (const d of accountsSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (isEncryptedDoc(data)) {
        return NextResponse.json({
          ok: false,
          useClientFallback: true,
          reason: "encrypted_company_data",
        });
      }
      accounts.push({
        id: d.id,
        accountName: String(data.accountName || ""),
        accountType: String(data.accountType || ""),
        openingBalance: Number(data.openingBalance) || 0,
        openingBalanceDate: data.openingBalanceDate,
        isDeleted: data.isDeleted === true,
      });
    }

    const vouchers: Array<Record<string, unknown> & { id: string }> = [];
    let last: admin.firestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q: admin.firestore.Query = ref
        .collection("vouchers")
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(VOUCHER_PAGE_SIZE);
      if (last) {
        q = q.startAfter(last);
      }
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (isEncryptedDoc(data)) {
          return NextResponse.json({
            ok: false,
            useClientFallback: true,
            reason: "encrypted_company_data",
          });
        }
        if (data.isDeleted === true) continue;
        vouchers.push({ id: d.id, ...data });
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < VOUCHER_PAGE_SIZE) break;
    }

    const summary = buildDaybookDailySummary({
      accounts,
      vouchers,
      selectedDay,
      userIdFilter,
    });

    return NextResponse.json({
      ok: true,
      useClientFallback: false,
      summary,
      voucherCount: vouchers.length,
      accountCount: accounts.length,
    });
  } catch (e) {
    console.error("[daybook-daily-summary]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
