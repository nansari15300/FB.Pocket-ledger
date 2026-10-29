"use client";

import { useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  applyAppCountry,
  countryAppUrl,
  countryFlagUrl,
  listCountryAppRecords,
  type CountryAppRecord,
} from "@/lib/countryAppHosts";

type Props = {
  title: string;
  description: string;
  confirmLabel?: string;
  initialCc?: string | null;
  allowComingSoon?: boolean;
  onApplied?: (rec: CountryAppRecord) => void;
  onError?: (message: string) => void;
};

export function CountryAppPicker({
  title,
  description,
  confirmLabel = "Continue",
  initialCc,
  allowComingSoon = false,
  onApplied,
  onError,
}: Props) {
  const records = useMemo(() => listCountryAppRecords(), []);
  const [cc, setCc] = useState(initialCc || "np");
  const selected = records.find((row) => row.cc === cc) || records.find((row) => row.cc === "np") || null;

  const options = useMemo(
    () =>
      records.map((row) => ({
        value: row.cc,
        label: row.live ? row.name : `${row.name} (coming soon)`,
        triggerLabel: row.name,
        disabled: allowComingSoon ? false : !row.live,
        searchText: [row.cc, row.iso3, row.name, row.host, ...row.aliases].join(" "),
      })),
    [allowComingSoon, records]
  );

  const onContinue = () => {
    const result = applyAppCountry(cc);
    if (!result.ok) {
      onError?.(result.reason);
      return;
    }
    if (result.redirected) return;
    onApplied?.(result.rec);
  };

  return (
    <div className="w-full space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {selected ? (
          <img
            src={countryFlagUrl(selected.cc, 80)}
            alt=""
            width={40}
            height={28}
            className="h-7 w-10 shrink-0 rounded-sm border object-cover"
          />
        ) : (
          <Globe className="h-7 w-7 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <Combobox
            options={options}
            value={cc}
            onChange={setCc}
            placeholder="Find your country"
            searchPlaceholder="Type country name…"
            autoFocusSearchOnOpen
            triggerClassName="h-10 w-full !rounded-md"
          />
        </div>
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground">
          {selected.live
            ? `App: ${countryAppUrl(selected)}`
            : `${selected.name} is not open yet. Pick a live country to continue.`}
        </p>
      ) : null}
      <Button type="button" className="w-full" onClick={onContinue} disabled={!selected}>
        {confirmLabel}
      </Button>
    </div>
  );
}
