import { NextRequest, NextResponse } from "next/server";
import { fetchLiveFxRatesServer } from "@/lib/liveFxRates";
import { BILLING_REGIONS, BILLING_REGION_IDS } from "@/lib/billingRegions";

export const dynamic = "force-dynamic";

/**
 * Live FX for today — billing UI + admin "apply FX" (open.er-api.com).
 * ?base=NPR
 */
export async function GET(req: NextRequest) {
  try {
    const base = req.nextUrl.searchParams.get("base")?.trim() || "NPR";
    const snap = await fetchLiveFxRatesServer(base);
    const regionCurrencies = BILLING_REGION_IDS.map((id) => ({
      region: id,
      label: BILLING_REGIONS[id].label,
      currency: BILLING_REGIONS[id].defaultCurrency,
      rate: snap.rates[BILLING_REGIONS[id].defaultCurrency] ?? null,
    }));
    return NextResponse.json(
      { ...snap, regionCurrencies },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
