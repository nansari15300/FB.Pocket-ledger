"use client";

import { useEffect, useState } from "react";

type GateState = {
  pageKey: string;
  /** Row identities seen in the last render (previous-render pattern, no refs). */
  signals: readonly unknown[];
  suppress: boolean;
  /** pageKey changed but rows had not changed yet (async page load) — wait before releasing. */
  awaitingRows: boolean;
};

function sameSignals(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Ledger pagination motion gate — modelled on AccountGroupDetails Spend-wise toggle
 * (`disableTableLayoutAnimation` for one frame).
 *
 * - `pageKey` change (page next/prev, rows-per-page, view toggle) → `suppress = true` in the SAME
 *   render (render-phase state update), so TransactionsTable gets `disableLayoutAnimation` before
 *   framer measures; rows appear in place, no slide.
 * - Released 2 frames after the new page's rows are rendered (`rowSignals` identity changed),
 *   or after `timeoutMs` (safety, e.g. a page whose rows never change identity).
 * - Sort and data updates (add/edit) do not change `pageKey` → animation stays on (FLIP to new spot).
 *
 * Usage: `disableLayoutAnimation={gate.suppress}` on TransactionsTable (prop already exists).
 */
export function useLedgerRowMotionGate(options: {
  pageKey: string | number;
  /** Row arrays (or other identities) the table renders — e.g. `[desktopRows, mobileRows]`. Fixed length. */
  rowSignals: readonly unknown[];
  timeoutMs?: number;
}): { suppress: boolean } {
  const pageKey = String(options.pageKey);
  const rowSignals = options.rowSignals;
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? 1500) || 1500);

  const [gate, setGate] = useState<GateState>(() => ({
    pageKey,
    signals: rowSignals,
    suppress: false,
    awaitingRows: false,
  }));

  let current = gate;
  const keyChanged = gate.pageKey !== pageKey;
  const signalsChanged = !sameSignals(gate.signals, rowSignals);
  if (keyChanged || signalsChanged) {
    // Render-phase update (React "storing information from previous renders" pattern).
    current = {
      pageKey,
      signals: rowSignals,
      suppress: keyChanged ? true : gate.suppress,
      awaitingRows: keyChanged ? !signalsChanged : gate.awaitingRows && !signalsChanged,
    };
    setGate(current);
  }

  const { suppress, awaitingRows } = current;

  // Release once the new page rows are on screen (+2 rAF so framer snapshots the new layout first).
  useEffect(() => {
    if (!suppress || awaitingRows) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setGate((g) => (g.suppress ? { ...g, suppress: false, awaitingRows: false } : g));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [suppress, awaitingRows, current.signals]);

  // Safety timeout — never leave animations disabled.
  useEffect(() => {
    if (!suppress) return;
    const t = setTimeout(() => {
      setGate((g) => (g.suppress ? { ...g, suppress: false, awaitingRows: false } : g));
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [suppress, current.pageKey, timeoutMs]);

  return { suppress };
}