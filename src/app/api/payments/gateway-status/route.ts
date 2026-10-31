import { NextResponse } from "next/server";
import {
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  resolveBillingGatewayAvailability,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { serverDb } from "@/lib/server/appDb";

/** Admin read — keys merge + payment toggles (`app_settings/payment_gateways`). */
async function getGatewayStateFromAdmin(): Promise<{
  keys: GatewayKeys;
  flags: ReturnType<typeof parseGatewayPaymentFlags>;
}> {
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    const raw = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const stored = raw as GatewayKeys;
    return {
      keys: mergeGatewayKeysWithEnv(stored),
      flags: parseGatewayPaymentFlags(raw),
    };
  } catch {
    return { keys: mergeGatewayKeysWithEnv({}), flags: parseGatewayPaymentFlags(null) };
  }
}

/**
 * Billing UI: keys configured + admin “Show on plan page” — dono true par radio enable.
 */
export async function GET() {
  const { keys, flags } = await getGatewayStateFromAdmin();
  return NextResponse.json(resolveBillingGatewayAvailability(keys, flags), {
    headers: { "Cache-Control": "no-store" },
  });
}
