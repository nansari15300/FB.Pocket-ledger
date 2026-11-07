import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { corsHeadersForPocketLedgerBillingApi } from "@/lib/server/billingApiCors";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { isSuperAdminServer } from "@/lib/server/isSuperAdminServer";
import { adminServerHardDeleteDeletedCompany } from "@/lib/server/adminRecycleBinDeleteCompany";

type Body = { companyId?: string };

/** CORS preflight — static EXE/APK admin hard delete. */
export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeadersForPocketLedgerBillingApi(req) });
}

export async function POST(req: NextRequest) {
    const cors = corsHeadersForPocketLedgerBillingApi(req);
    try {
        if (!isFirebaseAdminConfigured()) {
            return NextResponse.json({ error: "admin_not_configured" }, { status: 503, headers: cors });
        }

        const authHeader = req.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!token) {
            return NextResponse.json({ error: "missing_token" }, { status: 401, headers: cors });
        }

        getAdminDb();
        let decoded: admin.auth.DecodedIdToken;
        try {
            decoded = await admin.auth().verifyIdToken(token);
        } catch {
            return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: cors });
        }

        const superOk = await isSuperAdminServer(decoded.uid, decoded.email ?? undefined);
        if (!superOk) {
            return NextResponse.json({ error: "forbidden" }, { status: 403, headers: cors });
        }

        const body = (await req.json().catch(() => ({}))) as Body;
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!companyId) {
            return NextResponse.json({ error: "companyId_required" }, { status: 400, headers: cors });
        }

        await adminServerHardDeleteDeletedCompany(companyId);
        return NextResponse.json({ success: true }, { headers: cors });
    } catch (e) {
        const message = e instanceof Error ? e.message : "delete_failed";
        return NextResponse.json({ error: message }, { status: 500, headers: cors });
    }
}
