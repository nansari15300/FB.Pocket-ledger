import { NextRequest, NextResponse } from "next/server";
import { pbSiteForward } from "@/lib/server/pbSiteProxy";

export const dynamic = "force-dynamic";

/** Video view / like / rating: counted on the Pocket Ledger Server (`/api/pl/site/public/video-engagement`). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const r = await pbSiteForward("/api/pl/site/public/video-engagement", { method: "POST", body, ip });
  return NextResponse.json(r.json, { status: r.status });
}