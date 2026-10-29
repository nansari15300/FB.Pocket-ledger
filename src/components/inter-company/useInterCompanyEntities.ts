"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InterCompanyEntityDetail } from "@/lib/interCompany/interCompanyEntityTypes";
import { fetchInterCompanyEntitiesForCompany } from "@/lib/interCompany/fetchInterCompanyEntities";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

export type { InterCompanyEntityDetail };

function entityListKey(rows: InterCompanyEntityDetail[] | undefined): string {
  if (!rows?.length) return "";
  return rows.map((r) => `${r.kind}:${r.id}`).join("|");
}

/** SQLite / Firestore — optional in-memory seed (active company vouchers) for instant paint on EXE. */
export function useInterCompanyEntities(
  companyId: string | null | undefined,
  seedEntities?: InterCompanyEntityDetail[]
) {
  const seedKey = useMemo(() => entityListKey(seedEntities), [seedEntities]);
  const [entities, setEntities] = useState<InterCompanyEntityDetail[]>(() => seedEntities ?? []);
  const [loading, setLoading] = useState(() => !seedEntities?.length);
  const [reloadEpoch, setReloadEpoch] = useState(0);

  const reload = useCallback(() => {
    setReloadEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    if (seedEntities?.length) {
      setEntities(seedEntities);
      setLoading(false);
    }
  }, [seedKey, seedEntities]);

  useEffect(() => {
    if (!isInterCompanySystemEnabled() || !companyId) {
      setEntities([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const hadSeed = Boolean(seedEntities?.length);
    if (!hadSeed) setLoading(true);
    (async () => {
      try {
        const rows = await fetchInterCompanyEntitiesForCompany(companyId);
        if (!cancelled) {
          setEntities(rows.length > 0 ? rows : seedEntities ?? []);
        }
      } catch {
        if (!cancelled) setEntities(seedEntities ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- seedKey tracks seedEntities identity
  }, [companyId, reloadEpoch, seedKey]);

  return { entities, loading, reload };
}

/** Current company — `useVouchers` lists ko detail rows me. */
export function buildSourceEntitiesFromVouchers(lists: {
  processedAccounts?: {
    id: string;
    accountName?: string;
    bankName?: string;
    accountNumber?: string;
    interCompanyAccountNo?: string;
    balance?: number;
    isClearing?: boolean;
  }[];
  processedParties?: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    pan?: string;
    fileUrl?: string | null;
    openingBalance?: number;
    interCompanyAccountNo?: string;
    balance?: number;
  }[];
  processedStaff?: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
    interCompanyAccountNo?: string;
    balance?: number;
  }[];
  processedTaxes?: { id: string; name?: string; interCompanyAccountNo?: string; balance?: number }[];
  expenseAccounts?: { id: string; name?: string; interCompanyAccountNo?: string; balance?: number }[];
}): InterCompanyEntityDetail[] {
  const rows: InterCompanyEntityDetail[] = [];
  (lists.processedAccounts || []).forEach((a) =>
    rows.push({
      id: a.id,
      kind: "bank",
      label: a.accountName || a.id,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      interCompanyAccountNo: a.interCompanyAccountNo,
      closingBalance: a.balance,
      isClearing: a.isClearing === true,
    })
  );
  (lists.processedParties || []).forEach((p) =>
    rows.push({
      id: p.id,
      kind: "party",
      label: p.name || p.id,
      phone: p.phone,
      email: p.email,
      address: p.address,
      pan: p.pan,
      fileUrl: p.fileUrl,
      openingBalance: p.openingBalance,
      interCompanyAccountNo: p.interCompanyAccountNo,
      closingBalance: p.balance,
    })
  );
  (lists.processedStaff || []).forEach((s) =>
    rows.push({
      id: s.id,
      kind: "staff",
      label: s.name || s.id,
      phone: s.phone,
      email: s.email,
      interCompanyAccountNo: s.interCompanyAccountNo,
      closingBalance: s.balance,
    })
  );
  (lists.processedTaxes || []).forEach((t) =>
    rows.push({
      id: t.id,
      kind: "tax",
      label: t.name || t.id,
      interCompanyAccountNo: t.interCompanyAccountNo,
      closingBalance: t.balance,
    })
  );
  (lists.expenseAccounts || []).forEach((e) =>
    rows.push({
      id: e.id,
      kind: "expense",
      label: e.name || e.id,
      interCompanyAccountNo: e.interCompanyAccountNo,
      closingBalance: e.balance,
    })
  );
  return rows;
}

export { filterInterCompanyEntitiesByPhone } from "@/lib/interCompany/interCompanyEntityLookup";
