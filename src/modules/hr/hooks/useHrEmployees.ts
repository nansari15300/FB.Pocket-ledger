"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { hrApi, isHrDisabledError } from "../services/hrApi";
import type { HrEmployee } from "../types";

/** Active company ke HR employees (server list). Soft-deleted rows hide. */
export function useHrEmployees() {
  const { companyId } = useCompany();
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    const cid = String(companyId || "").trim();
    const req = ++reqRef.current;
    if (!cid) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await hrApi.list("employees", cid);
      if (req !== reqRef.current) return;
      setDisabled(false);
      setEmployees(items.filter((e) => e && e.deleted !== true));
    } catch (e) {
      if (req !== reqRef.current) return;
      if (isHrDisabledError(e)) {
        setDisabled(true);
        setEmployees([]);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { companyId: companyId ? String(companyId) : null, employees, loading, error, disabled, reload };
}
