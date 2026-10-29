"use client";

import { useEffect, useState } from "react";
import {
  countryAppUrl,
  countryFlagUrl,
  resolveAppCountry,
  type CountryAppRecord,
} from "@/lib/countryAppHosts";

export function CountryAppLoginHint() {
  const [rec, setRec] = useState<CountryAppRecord | null>(null);

  useEffect(() => {
    setRec(resolveAppCountry());
  }, []);

  if (!rec) return null;

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <img
        src={countryFlagUrl(rec.cc, 40)}
        alt=""
        width={20}
        height={14}
        className="h-3.5 w-5 rounded-[2px] border object-cover"
      />
      <span>
        {rec.name}
        {rec.live ? ` · ${countryAppUrl(rec).replace(/^https:\/\//, "")}` : ""}
      </span>
    </p>
  );
}
