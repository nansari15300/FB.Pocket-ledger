/**
 * Firestore me `planExpiry` miss ho (webhook/checkout race) lekin `stripeSubscriptionId` ho —
 * Stripe `current_period_end` se company doc backfill karo taaki proration `quotePaidPlanPurchase`
 * pehla paid period na khoye (warna currentExpiryMs null = credit 0 = sirf naya term).
 */
import "server-only";
import type Stripe from "stripe";
import type admin from "@/lib/server/pbAdminTypes";
import { getSubscriptionCurrentPeriodEndMs } from "@/lib/payments/stripeCheckoutFulfill";

import { Timestamp } from "@/lib/server/pbBilling/fieldValue";
export async function syncCompanyPlanExpiryFromStripe(args: {
  companyRef: admin.firestore.DocumentReference;
  stripeSubscriptionId: string;
  stripe: Stripe;
}): Promise<number | null> {
  const subId = args.stripeSubscriptionId.trim();
  if (!subId) return null;
  const endMs = await getSubscriptionCurrentPeriodEndMs(args.stripe, subId);
  if (endMs == null) return null;
  await args.companyRef.update({
    planExpiry: Timestamp.fromMillis(endMs),
    planExpiryMs: endMs,
  });
  return endMs;
}
