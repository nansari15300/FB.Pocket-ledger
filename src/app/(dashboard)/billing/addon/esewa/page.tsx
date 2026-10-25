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

function AddonEsewaInner() {
  const searchParams = useSearchParams();
  const dataParam = searchParams.get("data");
  const [state, setState] = useState<DoneState>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const onceRef = useRef(false);

  useEffect(() => {
    if (!dataParam) {
      setState("error");
      setDetail("Missing payment data. Start again from Billing → Add-on service.");
      return;
    }

    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(atob(dataParam));
    } catch {
      setState("error");
      setDetail("Could not read eSewa response.");
      return;
    }

    onceRef.current = false;
    setDetail(null);
    const unsub = onBillingApiUser(async (user) => {
      if (!user || onceRef.current) return;
      onceRef.current = true;
      setState("working");
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(getBillingApiUrl("/api/payments/complete-addon-esewa"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ decoded }),
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
  }, [dataParam]);

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Add-on purchase</CardTitle>
          <CardDescription>
            Confirming your eSewa payment and applying device/user slots.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state === "working" ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying add-ons…
            </p>
          ) : null}
          {state === "ok" ? (
            <p className="text-sm text-green-600 dark:text-green-500" aria-live="polite">
              Add-ons applied — you can continue.
            </p>
          ) : null}
          {state === "error" && detail ? (
            <p className="text-sm text-destructive whitespace-pre-wrap break-words" aria-live="polite">
              {detail}
            </p>
          ) : null}
          <Button asChild>
            <Link href="/billing">Back to billing</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AddonEsewaPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground" aria-busy="true">
          Loading…
        </div>
      }
    >
      <AddonEsewaInner />
    </Suspense>
  );
}
