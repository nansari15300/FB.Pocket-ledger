"use client";

import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  DEFAULT_BILLING_POLICY_FLAGS,
  parseBillingPolicyDoc,
  type BillingPolicyFlags,
} from "@/lib/billingPolicyFlags";

/** Realtime `app_settings/billing` — bank-settings toggle ke baad nav/billing bina refresh. */
export function useBillingPolicyFlags(): BillingPolicyFlags & { loading: boolean } {
  const [flags, setFlags] = useState<BillingPolicyFlags>(DEFAULT_BILLING_POLICY_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(firestore, "app_settings", "billing"),
      (snap) => {
        setFlags(parseBillingPolicyDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
        setLoading(false);
      },
      () => {
        setFlags(DEFAULT_BILLING_POLICY_FLAGS);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { ...flags, loading };
}
