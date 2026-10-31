import { NextRequest, NextResponse } from "next/server";
import { corsHeadersForPocketLedgerBillingApi } from "@/lib/server/billingApiCors";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeadersForPocketLedgerBillingApi(req),
  });
}

/** Removed: Firebase custom-token handoff. Login is the Pocket Ledger Server session only. */
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: "gone", message: "Firebase login handoff was removed; sign in with the Pocket Ledger Server." },
    { status: 410, headers: corsHeadersForPocketLedgerBillingApi(req) }
  );
}