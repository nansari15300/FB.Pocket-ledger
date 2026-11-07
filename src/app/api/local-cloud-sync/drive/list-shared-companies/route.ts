export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { verifyBearerUid } from "@/lib/localCloudSync/server/apiAuth";
import { driveListPocketLedgerCompaniesForJoin } from "@/lib/localCloudSync/server/driveTransportServer";
import { driveHostedApiJson, driveHostedApiOptions } from "@/lib/server/driveHostedApiCors";

export async function OPTIONS(req: NextRequest) {
  return driveHostedApiOptions(req);
}

/** Join UI — My Drive owned + shared-with-me Pocket Ledger company folders. */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerUid(req);
  if ("error" in auth) {
    return driveHostedApiJson(req, { error: auth.error }, auth.status);
  }
  try {
    const companies = await driveListPocketLedgerCompaniesForJoin(auth.uid, auth.email);
    return driveHostedApiJson(req, { companies });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return driveHostedApiJson(req, { error: msg }, 500);
  }
}
