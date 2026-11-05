"use client";

import * as React from "react";

/**
 * Opt-in scope (TransactionsTable `adaptiveClosingLabel`): inside it the yellow Adjust Balance pill
 * (AdjustBalancePillLabel) shows adaptive text - "Adjust Closing Balance" when it fits, "Ajt Cls Blc" when it
 * would wrap. `prefix` carries the TDS variant ("TDS", "Sale TDS", "Pur TDS"). Outside the scope the pill is unchanged.
 */
export type AdaptiveClosingCtxValue = { prefix: string };

const AdaptiveClosingCtx = React.createContext<AdaptiveClosingCtxValue | null>(null);

export function useAdaptiveClosingCtx(): AdaptiveClosingCtxValue | null {
  return React.useContext(AdaptiveClosingCtx);
}

/** "Sale TDS Closing Balance" -> "Sale TDS"; default "Closing Balance" -> "". */
export function closingLabelPrefix(label: string | undefined): string {
  return (label ?? "").replace(/\s*Closing Balance\s*$/i, "").trim();
}

export function AdaptiveClosingScope({
  enabled,
  label,
  children,
}: {
  enabled?: boolean;
  label?: string;
  children?: React.ReactNode;
}) {
  const prefix = closingLabelPrefix(label);
  const value = React.useMemo(() => ({ prefix }), [prefix]);
  if (!enabled) return <>{children}</>;
  return <AdaptiveClosingCtx.Provider value={value}>{children}</AdaptiveClosingCtx.Provider>;
}