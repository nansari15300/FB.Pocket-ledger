import { NextResponse } from "next/server";
import { PLAN_TIER_ORDER, type PlanId } from "@/config/plans";
import { getEffectivePlanPrices } from "@/lib/server/getEffectivePlanPrices";

export const dynamic = "force-dynamic";

/**
 * Billing page display: same monthly/yearly as `/api/payments/initiate` charge math (Admin + app_settings/plans).
 */
export async function GET() {
  try {
    const out: Record<string, { monthly: number; yearly: number }> = {};
    for (const id of PLAN_TIER_ORDER) {
      out[id] = await getEffectivePlanPrices(id as PlanId);
    }
    return NextResponse.json(out);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
