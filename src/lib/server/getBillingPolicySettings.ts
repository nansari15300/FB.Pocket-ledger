import type admin from "@/lib/server/pbAdminTypes";
import {
  DEFAULT_BILLING_POLICY_FLAGS,
  parseBillingPolicyDoc,
  type BillingPolicyFlags,
} from "@/lib/billingPolicyFlags";

/** Firestore `app_settings/billing` — product flags (defaults jab doc/field missing ho). */
export type BillingPolicySettings = BillingPolicyFlags;

/** Admin billing policy — missing doc ya non-boolean field par safe default. */
export async function getBillingPolicySettings(
  db: admin.firestore.Firestore
): Promise<BillingPolicySettings> {
  const snap = await db.doc("app_settings/billing").get();
  if (!snap.exists) return { ...DEFAULT_BILLING_POLICY_FLAGS };
  return parseBillingPolicyDoc(snap.data() as Record<string, unknown>);
}

/** Payment routes — Super Admin ne billing band ki ho to 403. */
export function billingDisabledResponse(): { error: string; code: "billing_disabled" } {
  return {
    error: "Billing and plan purchases are disabled by the administrator.",
    code: "billing_disabled",
  };
}
