"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useDate } from "@/hooks/useDate";
import { useToast } from "@/hooks/use-toast";
import type { CompanyStorageRow } from "@/lib/companyStorageKind";
import {
  formatFiscalYearMergeRangeLabel,
  type FiscalYearMergeRow,
} from "@/lib/fiscalMergeFySelection";
import { loadFiscalSplitFyRows } from "@/lib/fiscalSplit/loadFiscalSplitFyRows";
import { rebuildFyVoucherIndex } from "@/lib/fiscalSplit/fyVoucherIndex";
import {
  fyKeyStartYear,
  readBackupFyScopeMarker,
  type BackupFyScope,
} from "@/lib/backupFyScopeRewrite";
import { cn } from "@/lib/utils";

type FyScopeCompany = CompanyStorageRow & {
  country?: string;
  authoritativeCompanyId?: string;
  fiscalYearStart?: unknown;
  fiscalYearEnd?: unknown;
};

const TABLE_CN =
  "overflow-hidden rounded-md border border-emerald-400/60 bg-background";

/**
 * Contiguous FY ticks: tick any two ends → middles fill; untick an end → range shrinks.
 * Always one contiguous block (no gaps).
 */
function applyContiguousFyToggle(
  sortedKeys: string[],
  selected: Set<string>,
  toggledKey: string
): Set<string> {
  const idx = sortedKeys.indexOf(toggledKey);
  if (idx < 0) return selected;
  if (!selected.size) return new Set([toggledKey]);

  let from = sortedKeys.length;
  let to = -1;
  for (let i = 0; i < sortedKeys.length; i++) {
    if (selected.has(sortedKeys[i])) {
      if (i < from) from = i;
      if (i > to) to = i;
    }
  }
  if (from > to) return new Set([toggledKey]);

  const next = new Set<string>();
  const fill = (a: number, b: number) => {
    for (let i = a; i <= b; i++) next.add(sortedKeys[i]);
  };

  if (idx < from) {
    fill(idx, to);
    return next;
  }
  if (idx > to) {
    fill(from, idx);
    return next;
  }
  // Inside current range
  if (idx === from && idx === to) {
    return next; // clear
  }
  if (idx === from) {
    fill(from + 1, to);
    return next;
  }
  if (idx === to) {
    fill(from, to - 1);
    return next;
  }
  // Middle untick: shrink the nearer end so the block stays contiguous
  const distFrom = idx - from;
  const distTo = to - idx;
  if (distFrom <= distTo) fill(idx + 1, to);
  else fill(from, idx - 1);
  return next;
}

function scopeFromSelectedKeys(
  sortedKeys: string[],
  selected: Set<string>,
  openEndedTo: boolean,
  latestRolling: boolean
): BackupFyScope {
  if (!selected.size) return "all";
  let fromIdx = sortedKeys.length;
  let toIdx = -1;
  for (let i = 0; i < sortedKeys.length; i++) {
    if (selected.has(sortedKeys[i])) {
      if (i < fromIdx) fromIdx = i;
      if (i > toIdx) toIdx = i;
    }
  }
  if (fromIdx > toIdx) return "all";
  const fromFyKey = sortedKeys[fromIdx];
  const isLatestSelected = toIdx === sortedKeys.length - 1;
  if (openEndedTo && latestRolling && isLatestSelected) return { fromFyKey };
  const toFyKey = sortedKeys[toIdx];
  if (toFyKey === fromFyKey) return { fromFyKey, toFyKey };
  return { fromFyKey, toFyKey };
}

function selectedKeysFromScope(sortedKeys: string[], value: BackupFyScope): Set<string> {
  if (value === "all" || !sortedKeys.length) return new Set();
  if (!value.fromFyKey) return new Set();
  const fromY = fyKeyStartYear(value.fromFyKey);
  const toY = value.toFyKey ? fyKeyStartYear(value.toFyKey) : null;
  const next = new Set<string>();
  for (const k of sortedKeys) {
    const y = fyKeyStartYear(k);
    if (y < fromY) continue;
    // No toFyKey = open-ended Latest → tick From through last listed FY
    if (toY != null && y > toY) continue;
    next.add(k);
  }
  return next;
}

/** FY range for manual + auto backup: checkbox list like Fiscal year & split (contiguous ticks). */
export function BackupFyScopePicker({
  companyId,
  company,
  value,
  onChange,
  openEndedTo = false,
  idPrefix,
}: {
  companyId?: string | null;
  company?: FyScopeCompany | null;
  value: BackupFyScope;
  onChange: (next: BackupFyScope) => void;
  /** Auto backup: show Latest rolling option (new FYs after the list included). */
  openEndedTo?: boolean;
  idPrefix: string;
}) {
  const { dateSystem } = useDate();
  const country = company?.country || (dateSystem === "BS" ? "Nepal" : undefined);
  const [fyRows, setFyRows] = useState<FiscalYearMergeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  /** Auto: Latest = To open-ended forward of earliest ticked FY. */
  const [latestRolling, setLatestRolling] = useState(true);
  const loadGenRef = useRef(0);
  const companyRef = useRef(company);
  companyRef.current = company;

  useEffect(() => {
    const cid = String(companyId || "").trim();
    const row = companyRef.current;
    if (!cid || !row) {
      setFyRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    const effectiveCompany: FyScopeCompany = {
      ...row,
      country: row.country || (dateSystem === "BS" ? "Nepal" : undefined),
    };
    const gen = ++loadGenRef.current;
    setLoading(true);
    setError(null);
    void loadFiscalSplitFyRows({
      companyId: cid,
      company: effectiveCompany,
      onLateUpdate: (late) => {
        if (gen !== loadGenRef.current) return;
        setFyRows(late.rows.filter((r) => r.hasTransactions));
      },
    })
      .then((result) => {
        if (gen !== loadGenRef.current) return;
        setFyRows(result.rows.filter((r) => r.hasTransactions));
      })
      .catch((err) => {
        if (gen !== loadGenRef.current) return;
        setError(err instanceof Error ? err.message : "Could not load fiscal years.");
        setFyRows([]);
      })
      .finally(() => {
        if (gen === loadGenRef.current) setLoading(false);
      });
    return () => {
      loadGenRef.current += 1;
    };
  }, [companyId, dateSystem]);

  const handleRefreshFyList = async () => {
    const cid = String(companyId || "").trim();
    const row = companyRef.current;
    if (!cid || !row) return;
    const effectiveCompany: FyScopeCompany = {
      ...row,
      country: row.country || (dateSystem === "BS" ? "Nepal" : undefined),
    };
    const gen = ++loadGenRef.current;
    setRebuilding(true);
    setError(null);
    try {
      await rebuildFyVoucherIndex({
        companyId: cid,
        company: effectiveCompany,
      });
      if (gen !== loadGenRef.current) return;
      const result = await loadFiscalSplitFyRows({
        companyId: cid,
        company: effectiveCompany,
        onLateUpdate: (late) => {
          if (gen !== loadGenRef.current) return;
          setFyRows(late.rows.filter((r) => r.hasTransactions));
        },
      });
      if (gen !== loadGenRef.current) return;
      const activeRows = result.rows.filter((r) => r.hasTransactions);
      setFyRows(activeRows);
      toast({
        title: "FY list refreshed",
        description:
          activeRows.length > 0
            ? `${activeRows.length} fiscal year(s) from vouchers.`
            : "No voucher dates found yet.",
      });
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      console.warn("[BackupFyScopePicker] refresh failed", err);
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: err instanceof Error ? err.message : "Could not refresh fiscal years.",
      });
    } finally {
      if (gen === loadGenRef.current) setRebuilding(false);
    }
  };

  // Oldest → newest (same order as Fiscal year & split).
  const sortedKeys = useMemo(
    () =>
      [...fyRows]
        .map((r) => r.fyKey)
        .sort((a, b) => fyKeyStartYear(a) - fyKeyStartYear(b)),
    [fyRows]
  );
  const rowByKey = useMemo(() => {
    const map = new Map<string, FiscalYearMergeRow>();
    for (const row of fyRows) map.set(row.fyKey, row);
    return map;
  }, [fyRows]);

  const [rangeMode, setRangeMode] = useState<boolean>(value !== "all");

  useEffect(() => {
    if (value !== "all") {
      setRangeMode(true);
    }
  }, [value]);

  const ranged = rangeMode;
  const selected = useMemo(
    () => (ranged ? selectedKeysFromScope(sortedKeys, value) : new Set<string>()),
    [ranged, sortedKeys, value]
  );

  // Sync Latest toggle from stored scope (auto only).
  useEffect(() => {
    if (!openEndedTo) return;
    if (value === "all") {
      setLatestRolling(true);
      return;
    }
    setLatestRolling(!value.toFyKey);
  }, [openEndedTo, value]);

  const emitSelected = (nextSelected: Set<string>, rolling = latestRolling) => {
    let fromIdx = sortedKeys.length;
    let toIdx = -1;
    for (let i = 0; i < sortedKeys.length; i++) {
      if (nextSelected.has(sortedKeys[i])) {
        if (i < fromIdx) fromIdx = i;
        if (i > toIdx) toIdx = i;
      }
    }
    const isLatestSelected = toIdx >= 0 && toIdx === sortedKeys.length - 1;
    const nextRolling = Boolean(openEndedTo && rolling && isLatestSelected);
    setLatestRolling(nextRolling);
    if (!nextSelected.size) {
      onChange({ fromFyKey: "" } as unknown as BackupFyScope);
      return;
    }
    onChange(scopeFromSelectedKeys(sortedKeys, nextSelected, openEndedTo, nextRolling));
  };

  const toggleKey = (fyKey: string) => {
    const next = applyContiguousFyToggle(sortedKeys, selected, fyKey);
    emitSelected(next, latestRolling);
  };

  const enterRangeMode = () => {
    setRangeMode(true);
    if (!sortedKeys.length) return;
    // Default: all company FYs ticked (contiguous full span).
    emitSelected(new Set(sortedKeys), openEndedTo ? true : false);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3" data-pl-backup-fy-scope="">
      <Label className="text-sm font-medium text-foreground">Financial years (FY)</Label>
      <RadioGroup
        value={ranged ? "range" : "all"}
        onValueChange={(v) => {
          if (v === "all") {
            setRangeMode(false);
            onChange("all");
          } else {
            enterRangeMode();
          }
        }}
        className="grid gap-2"
      >
        <label className="flex cursor-pointer items-start gap-2 text-left text-sm">
          <RadioGroupItem value="all" id={`${idPrefix}-fy-all`} className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">All FY</span> - complete history (default).
          </span>
        </label>
        <label
          className={`flex items-start gap-2 text-left text-sm ${
            !companyId ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <RadioGroupItem
            value="range"
            id={`${idPrefix}-fy-range`}
            className="mt-0.5"
            disabled={!companyId}
          />
          <span className="flex items-center gap-1">
            <span className="font-medium text-foreground">Selected</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label="FY range info"
                  data-pl-intro=""
                >
                  <Info className="h-3.5 w-3.5" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="max-w-[20rem] text-xs leading-snug p-3" data-pl-intro="">
                Tick fiscal years from this company&apos;s vouchers. Middles between the first and last tick auto-select (one contiguous block). Closing balances of earlier FYs become openings in this backup only.
              </PopoverContent>
            </Popover>
          </span>
        </label>
      </RadioGroup>

      {ranged ? (
        <div className="space-y-2 pt-1">
          {loading || rebuilding ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {rebuilding
                ? "Refreshing FY list from vouchers..."
                : "Loading fiscal years from vouchers..."}
            </p>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={loading || rebuilding || !companyId}
                onClick={handleRefreshFyList}
              >
                {rebuilding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh FY list
              </Button>
            </div>
          ) : !sortedKeys.length ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                No voucher dates found for this company yet — From / To cannot be set.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={loading || rebuilding || !companyId}
                onClick={handleRefreshFyList}
              >
                {rebuilding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh FY list
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Fiscal years from your vouchers</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={loading || rebuilding || !companyId}
                  onClick={handleRefreshFyList}
                >
                  {rebuilding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh FY list
                </Button>
              </div>
              <div className={TABLE_CN}>
                <div className="border-b border-emerald-400/60 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Fiscal Year
                </div>
                <div className="max-h-48 divide-y divide-emerald-400/45 overflow-y-auto">
                  {sortedKeys.map((fyKey) => {
                    const row = rowByKey.get(fyKey);
                    const label = row
                      ? formatFiscalYearMergeRangeLabel(country, row.start, row.end, dateSystem)
                      : fyKey;
                    const checked = selected.has(fyKey);
                    const inputId = `${idPrefix}-fy-row-${fyKey}`;
                    return (
                      <label
                        key={fyKey}
                        htmlFor={inputId}
                        className="flex cursor-pointer items-start gap-2 px-2 py-2 text-sm"
                      >
                        <Checkbox
                          id={inputId}
                          className="mt-0.5 shrink-0"
                          checked={checked}
                          onCheckedChange={() => toggleKey(fyKey)}
                        />
                        <span
                          className={cn(
                            "min-w-0 leading-snug",
                            checked ? "font-medium text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {openEndedTo ? (
                <label className="flex cursor-pointer items-start gap-2 text-left text-xs text-muted-foreground">
                  <Checkbox
                    id={`${idPrefix}-fy-latest`}
                    className="mt-0.5 shrink-0"
                    checked={latestRolling}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setLatestRolling(on);
                      if (selected.size) {
                        if (on) {
                          const next = new Set(selected);
                          let fromIdx = sortedKeys.length;
                          for (let i = 0; i < sortedKeys.length; i++) {
                            if (selected.has(sortedKeys[i])) {
                              if (i < fromIdx) fromIdx = i;
                            }
                          }
                          for (let i = fromIdx; i < sortedKeys.length; i++) {
                            next.add(sortedKeys[i]);
                          }
                          emitSelected(next, true);
                        } else {
                          emitSelected(selected, false);
                        }
                      }
                    }}
                  />
                  <span>
                    <span className="font-medium text-foreground">Latest</span> — new FYs after the
                    last listed year are included automatically (open-ended To). From = earliest
                    ticked FY.
                  </span>
                </label>
              ) : null}
              {selected.size ? (
                <p className="text-[11px] text-muted-foreground">
                  Selected: {sortedKeys.filter((k) => selected.has(k)).map((k) => {
                    const row = rowByKey.get(k);
                    return row
                      ? formatFiscalYearMergeRangeLabel(country, row.start, row.end, dateSystem)
                      : k;
                  }).join(" · ")}
                  {openEndedTo && latestRolling ? " → Latest" : ""}
                </p>
              ) : (
                <p className="text-[11px] text-amber-800 dark:text-amber-200">
                  Tick at least one FY (or choose All FY).
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Restore dialog: "backup starts at FY X" banner + replace-current warning with confirmation tick. */
export function BackupFyScopeRestoreNotice({
  backupData,
  replaceCurrent,
  companyName,
  acknowledged,
  onAcknowledgedChange,
}: {
  backupData: unknown;
  replaceCurrent: boolean;
  companyName?: string | null;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
}) {
  const marker = readBackupFyScopeMarker(backupData);
  if (!marker) return null;
  const cutLabel = Number.isFinite(marker.cutMs) ? new Date(marker.cutMs).toLocaleDateString() : "";
  return (
    <div className="space-y-2" data-pl-restore-fy-scope="">
      <p className="rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        This backup starts at <strong>FY {marker.fromFyKey}</strong>
        {marker.toFyKey ? (
          <>
            {" "}
            (to FY <strong>{marker.toFyKey}</strong>)
          </>
        ) : null}
        ; opening balances were carried forward from earlier FYs{cutLabel ? ` (as on ${cutLabel})` : ""}.
        Vouchers before that date are not in this file.
      </p>
      {replaceCurrent ? (
        <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          <p>
            Replacing <strong>{companyName || "the current company"}</strong> with this FY-scoped backup removes all of
            its vouchers before FY {marker.fromFyKey}
            {marker.toFyKey ? ` and after FY ${marker.toFyKey}` : ""}, and replaces account / item opening balances
            with the carried-forward values. If the current company has a longer history, that history is lost on this
            device (and in the cloud for an Online restore).
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-left text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={acknowledged}
              onChange={(e) => onAcknowledgedChange(e.target.checked)}
            />
            <span>I understand - replace with FY-scoped data.</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}