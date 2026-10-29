"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CountryAppPicker } from "@/components/country/CountryAppPicker";
import {
  detectCountryFromHost,
  isCountryServerPanelHost,
  readStoredAppCountry,
  writeStoredAppCountry,
} from "@/lib/countryAppHosts";
import { isPackedMyCompanyOnly } from "@/lib/plServerPackedApp";
import { useToast } from "@/hooks/use-toast";

function shouldPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (isPackedMyCompanyOnly() || isCountryServerPanelHost()) {
    const fromHost = detectCountryFromHost();
    if (fromHost) writeStoredAppCountry(fromHost.cc);
    return false;
  }
  const fromHost = detectCountryFromHost();
  if (fromHost) {
    writeStoredAppCountry(fromHost.cc);
    return false;
  }
  return !readStoredAppCountry();
}

/** First open: pick a country before login. Hostname np / servernp already counts as chosen. */
export function CountryAppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [needPick, setNeedPick] = useState(false);

  useEffect(() => {
    const path = String(pathname || "");
    if (path.includes("/recovery") || path.includes("/oauth-return")) {
      setNeedPick(false);
      setReady(true);
      return;
    }
    setNeedPick(shouldPrompt());
    setReady(true);
  }, [pathname]);

  if (!ready) return <>{children}</>;
  if (!needPick) return <>{children}</>;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-border bg-muted/40 shadow-sm">
            <img
              src="/app-icon.png"
              alt="Pocket Ledger"
              className="h-full w-full object-contain p-1"
              width={80}
              height={80}
            />
          </div>
          <h1 className="sr-only">Pocket Ledger</h1>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <CountryAppPicker
            title="Choose your country"
            description="The app for that country has its own address. Nepal is live now; more countries open when their server is connected."
            confirmLabel="Open this country"
            onApplied={() => setNeedPick(false)}
            onError={(message) => toast({ title: "Country not open", description: message, variant: "destructive" })}
          />
        </div>
      </div>
    </main>
  );
}
