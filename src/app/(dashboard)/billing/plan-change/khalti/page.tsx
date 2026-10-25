"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { onBillingApiUser } from "@/lib/firebaseAuthForApi";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DoneState = "idle" | "working" | "ok" | "error";

/**
 * Khalti widget redirects here after pay; we confirm server-side and apply proration (same pattern as `/billing/success` for Stripe).
 */
function PlanChangeKhaltiInner() {
  const searchParams = useSearchParams();
  const pendingId = searchParams.get("pendingId");
  const token = searchParams.get("token");
  const amountStr = searchParams.get("amount");
  const [state, setState] = useState<DoneState>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const onceRef = useRef(false);

  useEffect(() => {
    if (!pendingId || !token || !amountStr) {
      setState("error");
      setDetail("Missing payment reference. Start again from Billing → Renew.");
      return;
    }
    const amount = Number(amountStr);
    if (!Number.isFinite(amount)) {
      setState("error");
      setDetail("Invalid amount in return URL.");
      return;
    }

    onceRef.current = false;
    setDetail(null);
    const unsub = onBillingApiUser(async (user) => {
      if (!user || onceRef.current) return;
      onceRef.current = true;
      setState("working");
      setDetail(null);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(getBillingApiUrl("/api/payments/complete-plan-change-khalti"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ pendingId, token, amount }),
        });
        let msg: string | null = null;
        try {
          const data = (await res.json()) as { error?: string };
          if (typeof data?.error === "string") msg = data.error;
        } catch {
          /* ignore */
        }
        setDetail(msg);
        setState(res.ok ? "ok" : "error");
      } catch {
        setDetail("Network error.");
        setState("error");
      }
    });
    return () => unsub();
  }, [pendingId, token, amountStr]);

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Prorated renewal</CardTitle>
          <CardDescription>
            Confirming your Khalti payment and updating your plan. This usually takes a few seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state === "working" ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              Activating your plan…
            </p>
          ) : null}
          {state === "ok" ? (
            <p className="text-sm text-green-600 dark:text-green-500" aria-live="polite">
              Plan updated — you can continue.
            </p>
          ) : null}
          {state === "error" && detail ? (
            <p className="text-sm text-destructive whitespace-pre-wrap break-words" aria-live="polite">
              {detail}
            </p>
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

export default function PlanChangeKhaltiPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground" aria-busy="true">
          Loading…
        </div>
      }
    >
      <PlanChangeKhaltiInner />
    </Suspense>
  );
}
