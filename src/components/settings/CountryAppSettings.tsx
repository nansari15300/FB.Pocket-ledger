"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CountryAppPicker } from "@/components/country/CountryAppPicker";
import {
  countryAppUrl,
  countryServerUrl,
  resolveAppCountry,
} from "@/lib/countryAppHosts";
import { useToast } from "@/hooks/use-toast";

export function CountryAppSettings() {
  const { toast } = useToast();
  const current = resolveAppCountry();

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Country</CardTitle>
          <CardDescription>
            Each country app has its own URL. Changing country opens that country’s app. Company books on this
            server stay here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {current ? (
            <p className="text-sm text-muted-foreground">
              Current: <span className="font-medium text-foreground">{current.name}</span>
              {" · "}
              {countryAppUrl(current)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No country saved on this device yet.</p>
          )}
          <CountryAppPicker
            title="Change country"
            description="Pick a live country to switch. Others show as coming soon until their server is added."
            confirmLabel="Change country"
            initialCc={current?.cc || "np"}
            onApplied={(rec) =>
              toast({
                title: rec.name,
                description: `This device will use ${countryAppUrl(rec)}`,
              })
            }
            onError={(message) => toast({ title: "Could not change country", description: message, variant: "destructive" })}
          />
          {current?.live ? (
            <p className="text-xs text-muted-foreground">
              Server panel for {current.name}: {countryServerUrl(current)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
