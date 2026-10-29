"use client";

/**
 * Current company ka Inter Co. A/c No — display + missing par auto backfill (sab owned companies).
 */
import { useEffect, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { ensureCompanyInterCompanyAcNo } from "@/lib/interCompany/ensureCompanyInterCompanyAcNo";
import { readCompanyInterCompanyAcNo } from "@/lib/interCompany/interCompanyAccountNo";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Options = {
  /** true: jab A/c No missing ho to generate + save (sirf owned company par) */
  autoEnsure?: boolean;
};

export function useCompanyInterCompanyAcNo(options: Options = {}) {
  const { autoEnsure = false } = options;
  const { company, companyId, reloadLocalCompanyRegistry } = useCompany();
  const [acNo, setAcNo] = useState("");
  const [loading, setLoading] = useState(false);

  // Company switch / snapshot update par display sync
  useEffect(() => {
    setAcNo(readCompanyInterCompanyAcNo(company));
  }, [company]);

  useEffect(() => {
    if (!isInterCompanySystemEnabled() || !autoEnsure || !companyId) return;
    // Shared company par owner ke bina Firestore update mat chalao
    if (company && company.isOwned === false) return;
    if (readCompanyInterCompanyAcNo(company)) return;

    let cancelled = false;
    setLoading(true);
    void ensureCompanyInterCompanyAcNo(companyId)
      .then((next) => {
        if (cancelled || !next) return;
        setAcNo(next);
        // SQLite + in-memory company list refresh taaki party/bank edit turant number dikhaye
        reloadLocalCompanyRegistry();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [autoEnsure, companyId, company, reloadLocalCompanyRegistry]);

  return { acNo, loading, companyId };
}
