"use client";

import { useEffect, useState } from "react";
import {
  fetchPlServerLicenseCaps,
  type PlServerLicenseCaps,
} from "@/lib/plServerLicenseCaps";

export function usePlServerLicenseCaps() {
  const [caps, setCaps] = useState<PlServerLicenseCaps | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPlServerLicenseCaps()
      .then((next) => {
        if (!cancelled) setCaps(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { caps, loading };
}
