"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { onBillingApiUser } from "@/lib/firebaseAuthForApi";
import { getLocalDevAwareBillingApiUrl } from "@/lib/billingApiOrigin";
import { applyVerifiedStripePayloadToLocalCompany } from "@/lib/applyStripePlanToLocalCompany";
import type { VerifiedLocalPlanApplyPayload } from "@/lib/payments/localStripePlanApplyTypes";
import { writePlanAuthoritativeSyncTimestamp } from "@/lib/companyPlanServerSync";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type SyncState = "idle" | "syncing" | "ok" | "error";

/**
 * Stripe redirects here with session_id; webhooks may miss localhost — sync route applies plan via Admin + Stripe API.
 * Localhost must call same-origin `/app/api/...` (not pocket-ledger.com) or Admin Panel books never post.
 */
function BillingSuccessInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  // Server error body helps debug (Firebase Admin env, Stripe key mismatch, 403 user mismatch, etc.).
  const [syncDetail, setSyncDetail] = useState<string | null>(null);
  // Fire sync once — onAuthStateChanged can run multiple times across token / focus churn.
  const syncOnceRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    syncOnceRef.current = false;
    setSyncDetail(null);

    const unsub = onBillingApiUser(async (user) => {
      if (!user || syncOnceRef.current) return;
      syncOnceRef.current = true;
      setSyncState("syncing");
      setSyncDetail(null);

      const runSync = async (): Promise<{ ok: boolean; detail: string | null }> => {
        const idToken = await user.getIdToken();
        const res = await fetch(getLocalDevAwareBillingApiUrl("/api/payments/sync-stripe-session"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ sessionId }),
        });
        let detail: string | null = null;
        let data: {
          error?: string;
          localApply?: boolean;
          payload?: VerifiedLocalPlanApplyPayload;
          /** Firestore pe plan patch ho chuka — yahi local SQLite + header profile align karta hai */
          mirrorLocal?: VerifiedLocalPlanApplyPayload;
        } = {};
        try {
          data = (await res.json()) as typeof data;
          if (typeof data?.error === "string") detail = data.error;
        } catch {
          /* ignore */
        }
        // Firestore company missing: local SQLite only
        if (res.ok && data.localApply === true && data.payload) {
          const applied = await applyVerifiedStripePayloadToLocalCompany(data.payload, user.uid);
          if (applied.ok === true) {
            writePlanAuthoritativeSyncTimestamp(data.payload.companyId);
            return { ok: true, detail: null };
          }
          detail = applied.reason;
          return { ok: false, detail };
        }
        // Firestore patch ke baad local mirror — pehle is branch ke bina profile Basic reh jata tha
        if (res.ok && data.mirrorLocal) {
          const applied = await applyVerifiedStripePayloadToLocalCompany(data.mirrorLocal, user.uid);
          if (applied.ok === true) {
            writePlanAuthoritativeSyncTimestamp(data.mirrorLocal.companyId);
            return { ok: true, detail: null };
          }
          detail = applied.reason;
          return { ok: false, detail };
        }
        return { ok: res.ok, detail };
      };

      try {
        let { ok, detail } = await runSync();
        // One short retry: session can briefly stay "open" right after redirect.
        if (!ok && detail?.includes("not finished yet")) {
          await new Promise((r) => setTimeout(r, 2500));
          ({ ok, detail } = await runSync());
        }
        setSyncDetail(detail);
        setSyncState(ok ? "ok" : "error");
      } catch {
        setSyncDetail("Network or server error — check devtools / server terminal.");
        setSyncState("error");
      }
    });

    return () => unsub();
  }, [sessionId]);

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Payment received</CardTitle>
          <CardDescription>
            Thank you. Your subscription is processing—this page also tries to activate your plan immediately. If it does
            not show yet, refresh billing or the dashboard in a moment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sessionId ? (
            <p className="text-xs text-muted-foreground break-all">
              Reference: <span className="font-mono">{sessionId}</span>
            </p>
          ) : null}
          {sessionId && syncState === "syncing" ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Activating your plan…
            </p>
          ) : null}
          {sessionId && syncState === "ok" ? (
            <p className="text-sm text-green-600 dark:text-green-500" aria-live="polite">
              Plan updated — you can continue.
            </p>
          ) : null}
          {sessionId && syncState === "error" ? (
            <div className="text-sm text-destructive space-y-2" aria-live="polite">
              <p>Could not confirm plan sync automatically.</p>
              {syncDetail ? (
                <p className="text-xs font-mono whitespace-pre-wrap break-words opacity-90">{syncDetail}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Tip: local dev needs FIREBASE_* Admin vars in .env.local and the same Stripe account (test keys) that
                created the session. Production needs a live webhook or this sync call.
              </p>
            </div>
          ) : null}
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/billing">Billing</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground" aria-busy="true">
          Loading…
        </div>
      }
    >
      <BillingSuccessInner />
    </Suspense>
  );
}
