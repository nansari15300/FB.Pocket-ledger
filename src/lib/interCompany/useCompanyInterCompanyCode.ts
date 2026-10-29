"use client";

/**
 * Company Code — missing ho to owner/admin ke liye auto generate; shared users read-only.
 * Sticky display: registry reload ke beech empty company snapshot code na mita de.
 */
import { useEffect, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import {
  readCompanyInterCompanyCode,
  resolveOrEnsureCompanyInterCompanyCode,
} from "@/lib/interCompany/interCompanyCompanyCode";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Options = {
  /** true: valid code missing ho to owner/admin par naya generate */
  autoEnsure?: boolean;
};

export function useCompanyInterCompanyCode(options: Options = {}) {
  const { autoEnsure = false } = options;
  const { company, companyId, reloadLocalCompanyRegistry } = useCompany();
  const { user, customUser } = useAuth();
  const [companyCode, setCompanyCode] = useState("");
  const [loading, setLoading] = useState(false);
  /** Ensure ke baad company context refresh par blink/reset avoid */
  const stickyCodeRef = useRef("");
  const ensureStartedRef = useRef<string | null>(null);

  const snapshotCode = readCompanyInterCompanyCode(company);
  const companyName = company?.name;

  // Valid code company snapshot me aaye to display sync
  useEffect(() => {
    if (!snapshotCode) return;
    stickyCodeRef.current = snapshotCode;
    setCompanyCode(snapshotCode);
  }, [snapshotCode]);

  // companyId badle to sticky reset
  useEffect(() => {
    stickyCodeRef.current = "";
    setCompanyCode("");
    ensureStartedRef.current = null;
  }, [companyId]);

  // Missing code — fetch / owner-admin ensure (sirf ek baar per company open)
  useEffect(() => {
    if (!isInterCompanySystemEnabled() || !companyId || snapshotCode) return;
    if (ensureStartedRef.current === companyId) return;
    ensureStartedRef.current = companyId;

    let cancelled = false;
    setLoading(true);

    void resolveOrEnsureCompanyInterCompanyCode({
      companyId,
      companyName,
      userUid: user?.uid,
      userEmail: user?.email,
      role: customUser?.role,
      allowEnsure: autoEnsure,
    })
      .then((code) => {
        if (cancelled) return;
        if (code) {
          stickyCodeRef.current = code;
          setCompanyCode(code);
          reloadLocalCompanyRegistry();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    autoEnsure,
    companyId,
    snapshotCode,
    companyName,
    user?.uid,
    user?.email,
    customUser?.role,
    reloadLocalCompanyRegistry,
  ]);

  const displayCode = companyCode || stickyCodeRef.current || snapshotCode;

  return { companyCode: displayCode, loading, companyId };
}
