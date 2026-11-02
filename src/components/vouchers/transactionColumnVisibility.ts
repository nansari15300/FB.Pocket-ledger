"use client";

import { useState, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import usePermissions from "@/hooks/usePermissions";
import type { VisibleColumns, TransactionColumnKey } from "./TransactionsTable";

export const COLUMN_VISIBILITY_KEY = "transactionVisibleColumns";
const COLUMN_VISIBILITY_PREFS_VERSION_KEY = "transactionVisibleColumnsVersion";
/** Bump when global column defaults change (e.g. Sync off by default). */
const COLUMN_VISIBILITY_PREFS_VERSION = 2;

export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  syncStatus: false,
  date: true,
  type: true,
  voucherNo: true,
  user: true,
  file: true,
  dr: true,
  cr: true,
  status: true,
  runningBalance: true,
};

/** Session prefs + one-time migration so Sync stays off unless user ticks it. */
export function loadStoredVisibleColumns(): VisibleColumns {
  if (typeof window === "undefined") return DEFAULT_VISIBLE_COLUMNS;
  let parsed: VisibleColumns = {};
  try {
    const saved = sessionStorage.getItem(COLUMN_VISIBILITY_KEY);
    if (saved) parsed = JSON.parse(saved) as VisibleColumns;
  } catch {
    parsed = {};
  }

  const storedVersion = Number(sessionStorage.getItem(COLUMN_VISIBILITY_PREFS_VERSION_KEY) || "1");
  if (storedVersion < COLUMN_VISIBILITY_PREFS_VERSION) {
    const migrated = { ...DEFAULT_VISIBLE_COLUMNS, ...parsed, syncStatus: false };
    sessionStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(migrated));
    sessionStorage.setItem(COLUMN_VISIBILITY_PREFS_VERSION_KEY, String(COLUMN_VISIBILITY_PREFS_VERSION));
    return migrated;
  }

  return { ...DEFAULT_VISIBLE_COLUMNS, ...parsed };
}

export const COLUMN_LABELS: Record<TransactionColumnKey, string> = {
  syncStatus: "Sync",
  date: "Date",
  type: "Type",
  voucherNo: "Voucher No.",
  tdsTaxable: "Taxable",
  tdsAmount: "TDS Amount",
  user: "User",
  file: "File",
  dr: "Dr",
  cr: "Cr",
  status: "Status",
  runningBalance: "Running Balance",
};

export function useTransactionVisibleColumns() {
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(() => loadStoredVisibleColumns());

  const handleColumnVisibilityChange = useCallback((key: TransactionColumnKey, checked: boolean) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: checked };
      sessionStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Columns menu must list only columns the table really renders: File needs the plan/role file permission
  // (TransactionsTable showFileColumn); Taxable / TDS Amount only exist on Tax / TDS-mode ledgers.
  const { canAddFileImagePdf } = usePermissions();
  const ledgerColumnMenuFilter = useCallback(
    (key: TransactionColumnKey) => key !== "file" || canAddFileImagePdf === true,
    [canAddFileImagePdf]
  );
  const ledgerColumnMenuNoTdsFilter = useCallback(
    (key: TransactionColumnKey) => key !== "tdsTaxable" && key !== "tdsAmount" && ledgerColumnMenuFilter(key),
    [ledgerColumnMenuFilter]
  );

  return { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuFilter, ledgerColumnMenuNoTdsFilter };
}

/** Show notes in transaction tables: localStorage; PC par default tick (sirf explicit "false" par hide). Mobile par hamesha notes dikhao — checkbox lock. */
export const SHOW_NOTES_KEY = "transactionShowNotes";

export function useShowNotes() {
  const isMobile = useIsMobile();
  const [showNotes, setShowNotesState] = useState<boolean>(() => {
    // SSR / pehla paint: default on (PC jaisa); client par localStorage se override
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem(SHOW_NOTES_KEY);
      if (saved === "false") return false;
      return true;
    } catch {
      return true;
    }
  });

  const setShowNotes = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowNotesState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      try {
        localStorage.setItem(SHOW_NOTES_KEY, next ? "true" : "false");
      } catch {}
      return next;
    });
  }, []);

  // Mobile: filter/print hamesha notes ke saath; PC: showNotes preference
  const includeNotesInTable = isMobile || showNotes;
  const notesPreferenceLockedOnMobile = isMobile;

  return { showNotes, setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile };
}

/** Spend-wise balance blink modes. Multi-select persisted in localStorage as JSON array. */
export const SPEND_WISE_BLINK_MODE_KEY = "spendWiseBlinkMode";
export type SpendWiseBlinkMode = "all" | "group" | "row";

export function useSpendWiseBlinkMode() {
  const [blinkMode, setBlinkModeState] = useState<SpendWiseBlinkMode[]>(() => {
    if (typeof window === "undefined") return ["all"];
    const saved = localStorage.getItem(SPEND_WISE_BLINK_MODE_KEY);
    if (!saved) return ["all"];
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((m): m is SpendWiseBlinkMode => m === "all" || m === "group" || m === "row");
        return Array.from(new Set(filtered));
      }
    } catch {}
    // Backward-compat with old single-mode storage values.
    if (saved === "all" || saved === "group" || saved === "row") return [saved];
    return [];
  });

  const setBlinkMode = useCallback((mode: SpendWiseBlinkMode[]) => {
    const next = Array.from(new Set(mode.filter((m): m is SpendWiseBlinkMode => m === "all" || m === "group" || m === "row")));
    setBlinkModeState(next);
    if (typeof window !== "undefined") localStorage.setItem(SPEND_WISE_BLINK_MODE_KEY, JSON.stringify(next));
  }, []);

  const toggleBlinkMode = useCallback((mode: SpendWiseBlinkMode, checked: boolean) => {
    if (typeof window === "undefined") return;
    setBlinkModeState((prev) => {
      const next = checked ? Array.from(new Set([...prev, mode])) : prev.filter((m) => m !== mode);
      localStorage.setItem(SPEND_WISE_BLINK_MODE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { spendWiseBlinkMode: blinkMode, setSpendWiseBlinkMode: setBlinkMode, toggleSpendWiseBlinkMode: toggleBlinkMode };
}
