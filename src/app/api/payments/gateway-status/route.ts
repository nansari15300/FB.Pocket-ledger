import { NextResponse } from "next/server";
import {
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  resolveBillingGatewayAvailability,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { parseCountryWallets, publicCountryWallets } from "@/lib/countryWallets";
import { serverDb } from "@/lib/server/appDb";

/** Admin read — keys merge + payment toggles (`app_settings/payment_gateways`). */
async function getGatewayStateFromAdmin(): Promise<{
  keys: GatewayKeys;
  flags: ReturnType<typeof parseGatewayPaymentFlags>;
  wallets: ReturnType<typeof publicCountryWallets>;
}> {
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    const raw = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const stored = raw as GatewayKeys;
    return {
      keys: mergeGatewayKeysWithEnv(stored),
      flags: parseGatewayPaymentFlags(raw),
      wallets: publicCountryWallets(parseCountryWallets(raw.wallets)),
    };
  } catch {
    return { keys: mergeGatewayKeysWithEnv({}), flags: parseGatewayPaymentFlags(null), wallets: [] };
  }
}

/**
 * Billing UI: keys configured + admin “Show on plan page” — dono true par radio enable.
 */
export async function GET() {
  const { keys, flags, wallets } = await getGatewayStateFromAdmin();
  return NextResponse.json(
    { ...resolveBillingGatewayAvailability(keys, flags), wallets },
    { headers: { "Cache-Control": "no-store" } }
  );
}
