import { NextResponse } from "next/server";
import { pbSiteForward } from "@/lib/server/pbSiteProxy";

export const dynamic = "force-dynamic";

/** Website notice: served from the Pocket Ledger Server (`/api/pl/site/public/notice`). */
export async function GET() {
  const r = await pbSiteForward("/api/pl/site/public/notice", { method: "GET" });
  if (r.status !== 200) return NextResponse.json({ error: String(r.json.error || "Server error") }, { status: r.status });
  return NextResponse.json(
    { ...r.json, source: "server" as const },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}