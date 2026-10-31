import { NextRequest, NextResponse } from "next/server";
import { countryFromRequestHeaders } from "@/lib/websiteDownloadStats";
import { bearerFromRequest } from "@/lib/server/billingCaller";
import { pbSiteForward } from "@/lib/server/pbSiteProxy";

export const dynamic = "force-dynamic";

/** Download / update event: recorded on the Pocket Ledger Server (`/api/pl/site/public/download-event`). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const country = String(body.country || countryFromRequestHeaders(req.headers) || "");
  const r = await pbSiteForward("/api/pl/site/public/download-event", {
    method: "POST",
    body,
    bearer: bearerFromRequest(req),
    country,
    ip,
  });
  return NextResponse.json(r.json, { status: r.status });
}