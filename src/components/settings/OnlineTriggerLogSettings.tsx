"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, Search, Settings, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsInfoTip } from "@/components/settings/SettingsInfoTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ONLINE_TRIGGER_LOG_EVENT,
  ONLINE_TRIGGER_LOG_PAGE_SIZE,
  ONLINE_TRIGGER_LOG_PAGE_SIZES,
  copyTextToClipboard,
  formatOnlineTriggerLogTsv,
  formatOnlineTriggerRowTsv,
  formatOnlineTriggerSentFromType,
  formatOnlineTriggerDateLabel,
  clearOnlineTriggerLog,
  groupOnlineTriggerLog,
  buildOnlineTriggerLogMonthTree,
  flattenOnlineTriggerMonthTree,
  listOnlineTriggerLog,
  onlineTriggerLogHeadersForView,
  onlineTriggerLogRowMatchesSearch,
  type OnlineTriggerFlatRow,
  type OnlineTriggerLogRow,
  type OnlineTriggerLogView,
} from "@/lib/onlineTriggerLog";
import { ColumnHeaderTextFilter } from "@/components/ui/column-header-filter";
import { columnHaystackMatchesFilter } from "@/lib/transactionColumnHeaderFilter";
import { getOnlineTriggerOps, OPS_GLOBAL, OPS_PER_ROW, type OnlineTriggerOpOutcome } from "@/lib/onlineTriggerOps";
import { FirestoreListenerTogglePanel } from "@/components/settings/FirestoreListenerTogglePanel";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import {
  formatSqliteStatBytes,
  loadOnlineTriggerSqliteStats,
  type OnlineTriggerSqliteStats,
} from "@/lib/onlineTriggerSqliteStats";

function dash(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return String(n);
}

/** SQLite size/counts vs online, plus push local changes — sits left of the log table. */
function SqliteOnlineStatsCard() {
  const { toast } = useToast();
  const { companyId } = useCompany();
  const [stats, setStats] = useState<OnlineTriggerSqliteStats | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setStats(null);
      return;
    }
    try {
      setStats(await loadOnlineTriggerSqliteStats(cid));
    } catch (e) {
      console.warn("[SqliteOnlineStatsCard] load failed", e);
    }
  }, [companyId]);

  useEffect(() => {
    setStats(null);
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Distinct queue rows (pending+failed+paused, all collections) + pending files not already queued; no notOnOnline add.
  const unsyncedCount = stats?.pushLocalCount ?? 0;

  const pushUnsynced = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outbox = await import("@/lib/localVoucherOutbox");
      const files = await import("@/lib/localPendingFiles");
      const { clearServerQuotaHold } = await import("@/lib/serverQuotaHold");
      clearServerQuotaHold();
      const requeued = await outbox.requeueFailedOutboxRows();
      const cid = String(companyId || "").trim();
      const found = cid ? await outbox.findUnsyncedLocalDocs(cid) : [];
      const enqueued = cid && found.length ? await outbox.requeueLocalDocsToOutbox(cid, found) : 0;
      const flush = await outbox.flushVoucherOutbox();
      const fileRes = cid ? await files.syncPendingFilesForCompany(cid) : await files.syncPendingFiles();
      toast({
        title: "Push local changes",
        description: `Re-queued ${requeued} failed + ${enqueued} local-only. Sent ${flush.ok}, failed ${flush.failed}. Files uploaded ${fileRes.synced}, failed ${fileRes.failed}.`,
        variant: flush.failed > 0 || fileRes.failed > 0 ? "destructive" : undefined,
      });
    } catch (e) {
      toast({ title: "Push failed", description: String((e as Error)?.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
      void load();
    }
  }, [busy, companyId, load, toast]);

  const onlineHint =
    stats?.onlineError === "quota"
      ? "quota"
      : stats?.onlineError === "offline"
        ? "offline"
        : stats?.onlineError
          ? "n/a"
          : null;

  return (
    <div
      data-pl-sqlite-online-stats=""
      className="flex w-full shrink-0 flex-col gap-1 overflow-x-auto"
    >
      <table
        data-pl-online-trigger-log-inner=""
        className="w-full min-w-[920px] table-fixed border-collapse text-left text-xs"
      >
        <colgroup>
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead>
          <tr className="bg-muted/80">
            <th
              colSpan={5}
              className="px-2 py-1.5 text-center text-sm font-semibold shadow-[inset_-1px_0_0_rgb(80,80,80)]"
            >
              Local
            </th>
            <th colSpan={3} className="px-2 py-1.5 text-center text-sm font-semibold">
              Online
            </th>
            <th rowSpan={2} className="px-2 py-1.5 text-center font-semibold align-middle">
              Push
            </th>
          </tr>
          <tr className="bg-muted/50">
            <th className="whitespace-nowrap px-2 py-1 font-medium">Data size</th>
            <th className="whitespace-nowrap px-2 py-1 font-medium">Files size</th>
            <th className="whitespace-nowrap px-2 py-1 font-medium">Voucher count</th>
            <th className="whitespace-nowrap px-2 py-1 font-medium">File count</th>
            <th className="whitespace-nowrap px-2 py-1 font-medium shadow-[inset_-1px_0_0_rgb(80,80,80)]">
              Not on local
            </th>
            <th className="whitespace-nowrap px-2 py-1 font-medium">Voucher count</th>
            <th className="whitespace-nowrap px-2 py-1 font-medium">File count</th>
            <th className="whitespace-nowrap border-r px-2 py-1 font-medium">Not on online</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t tabular-nums">
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">
              {stats ? formatSqliteStatBytes(stats.sqliteBytes) : "—"}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">
              {stats ? formatSqliteStatBytes(stats.filesBytes) : "—"}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">{dash(stats?.localVouchers)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">
              {dash(stats?.localFileCount)}
            </td>
            <td
              className={`whitespace-nowrap px-2 py-1.5 font-medium shadow-[inset_-1px_0_0_rgb(80,80,80)] ${(stats?.notOnLocal ?? 0) > 0 ? "text-amber-700" : ""}`}
            >
              {dash(stats?.notOnLocal)}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">
              {onlineHint ? `— (${onlineHint})` : dash(stats?.onlineVouchers)}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-medium">{dash(stats?.onlineFileCount)}</td>
            <td
              className={`whitespace-nowrap border-r px-2 py-1.5 font-medium ${(stats?.notOnOnline ?? 0) > 0 ? "text-amber-700" : ""}`}
            >
              {dash(stats?.notOnOnline)}
            </td>
            <td className="px-2 py-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 whitespace-nowrap"
                onClick={() => void pushUnsynced()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Push local ({unsyncedCount})
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const LOG_VIEW_OPTIONS: { value: OnlineTriggerLogView; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
];

/** Header filter icons only on columns left of "Code path". */
const ONLINE_TRIGGER_FILTERABLE_HEADERS = new Set(["Date", "Time", "API", "Sent From / Type", "Header", "Feature"]);

const ONLINE_TRIGGER_TABLE_MIN = "min-w-[1334px]";

function OnlineTriggerColgroup() {
  return (
    // Fixed px widths (sum 1332 + 2px border = ONLINE_TRIGGER_TABLE_MIN) so every header label + filter icon fits on one line.
    <colgroup>
      <col className="w-[160px]" />{/* Date */}
      <col className="w-[28px]" />{/* expand */}
      <col className="w-[140px]" />{/* Time */}
      <col className="w-[80px]" />{/* API */}
      <col className="w-[170px]" />{/* Sent From / Type */}
      <col className="w-[140px]" />{/* Header */}
      <col className="w-[110px]" />{/* Feature */}
      <col className="w-[120px]" />{/* Code path */}
      <col className="w-[70px]" />{/* Sent */}
      <col className="w-[90px]" />{/* Received */}
      <col className="w-[70px]" />{/* Failed */}
      <col className="w-[110px]" />{/* Qta exceeded */}
      <col className="w-[44px]" />{/* Copy */}
    </colgroup>
  );
}

/**
 * Date / Time body cell. A range ("start \u2192 end") ALWAYS renders as two lines ("start \u2192" / "end")
 * at the normal body font (text-xs 12px) with leading 14px: 2 x 14px + py-0.5 (2px x 2) = 32px,
 * the same height as single-line cells (py-1.5 12px + leading-5 20px). No shrink, no ellipsis.
 */
function RangeCellText({ text, mono }: { text: string; mono?: boolean }) {
  const parts = text.split(/\s*\u2192\s*/);
  const cls = `block leading-[14px] ${mono ? "font-mono" : ""}`;
  if (parts.length === 2) {
    return (
      <span className={cls}>
        <span className="block whitespace-nowrap">{parts[0]} {"\u2192"}</span>
        <span className="block whitespace-nowrap">{parts[1]}</span>
      </span>
    );
  }
  return <span className={`${cls} whitespace-normal [overflow-wrap:anywhere]`}>{text}</span>;
}

type OpsDialogCol = "Sent" | "Received" | "Failed" | "Qta exceeded";
const OPS_COL_OUTCOME: Record<OpsDialogCol, OnlineTriggerOpOutcome | "all"> = {
  Sent: "all",
  Received: "received",
  Failed: "failed",
  "Qta exceeded": "quota",
};
const OPS_PAGE_SIZES = [10, 15, 20, 30, 50] as const;

function OpCountCell({ value, onOpen }: { value: number; onOpen: () => void }) {
  if (!value) return <>{value}</>;
  return (
    <button
      type="button"
      className="cursor-pointer tabular-nums font-medium text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {value}
    </button>
  );
}

/** Rendered only while open; reads the bounded op store once per open, 10 per page, newest first. */
function OnlineTriggerOpsDialog({
  target,
  onClose,
}: {
  target: { row: OnlineTriggerLogRow; col: OpsDialogCol } | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const data = useMemo(() => {
    if (!target) return null;
    const ids = target.row.memberIds ?? [target.row.id];
    return getOnlineTriggerOps(ids, OPS_COL_OUTCOME[target.col]);
  }, [target]);
  useEffect(() => setPage(1), [target]);
  if (!target || !data) return null;
  const pages = Math.max(1, Math.ceil(data.events.length / pageSize));
  const cur = Math.min(page, pages);
  const shown = data.events.slice((cur - 1) * pageSize, cur * pageSize);
  const fmt = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] w-[80vw] max-w-[80vw] flex-col overflow-hidden sm:max-w-[80vw]"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {target.col} ops - {target.row.api} / {target.row.sentFrom}
          </DialogTitle>
          <DialogDescription>
            {data.events.length} op{data.events.length === 1 ? "" : "s"} recorded, newest first.
            {data.trimmed > 0
              ? ` ${data.trimmed} older op${data.trimmed === 1 ? " was" : "s were"} trimmed (keeps last ${OPS_PER_ROW} per log row, ${OPS_GLOBAL} total).`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[140px]" />
              <col className="w-[20%]" />
              <col className="w-[30%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="bg-muted">
              <tr>
                <th className="whitespace-nowrap px-2 py-2 font-medium">Time</th>
                <th className="whitespace-nowrap px-2 py-2 font-medium">From</th>
                <th className="whitespace-nowrap px-2 py-2 font-medium">Action</th>
                <th className="whitespace-nowrap px-2 py-2 font-medium">Received</th>
                <th className="whitespace-nowrap px-2 py-2 font-medium">Failed</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                    No op details recorded for this row (details start from this version; older rows have counts only).
                  </td>
                </tr>
              ) : (
                shown.map((ev) => (
                  <tr key={ev.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">{fmt(ev.t)}</td>
                    <td className="break-words px-2 py-1.5">{ev.from}</td>
                    <td className="break-words px-2 py-1.5">{ev.action}</td>
                    <td className="break-words px-2 py-1.5">
                      {ev.outcome === "received" ? ev.reply : ev.outcome === "pending" ? "Waiting for reply..." : ""}
                    </td>
                    <td className="break-words px-2 py-1.5 text-red-600">{ev.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Rows per page
            <select
              data-pl-ops-page-size=""
              className="h-8 rounded-md border !border-emerald-500 bg-background px-2 text-sm text-foreground !outline-none !ring-0 focus:!border-emerald-500 focus:!outline-none focus:!ring-1 focus:!ring-emerald-500 focus-visible:!outline-none focus-visible:!ring-1 focus-visible:!ring-emerald-500"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              {OPS_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
            <Button type="button" variant="outline" size="sm" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              Page {cur} / {pages}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OnlineTriggerLogSettings() {
  const { toast } = useToast();
  const { formatDate, formatDateBS, dateSystem } = useDate();
  const showLogDate = useCallback(
    (label: string) => formatOnlineTriggerDateLabel(label, formatDate, formatDateBS, dateSystem),
    [formatDate, formatDateBS, dateSystem]
  );
  const [rows, setRows] = useState<OnlineTriggerLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [copying, setCopying] = useState<"all" | "shown" | "row" | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const copiedRowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyAskOpen, setCopyAskOpen] = useState(false);
  const [clearAskOpen, setClearAskOpen] = useState(false);
  const [listenerOpen, setListenerOpen] = useState(false);
  const [view, setView] = useState<OnlineTriggerLogView>("monthly");
  const [pageSize, setPageSize] = useState<number>(ONLINE_TRIGGER_LOG_PAGE_SIZE);
  const [searchTerm, setSearchTerm] = useState("");
  const [opsTarget, setOpsTarget] = useState<{ row: OnlineTriggerLogRow; col: OpsDialogCol } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [viewOpen, setViewOpen] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => new Set());
  const [copyBorderGreen, setCopyBorderGreen] = useState(false);
  const viewWrapRef = useRef<HTMLDivElement | null>(null);
  const copyGreenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopyGreen = useCallback(() => {
    setCopyBorderGreen(true);
    if (copyGreenTimerRef.current) clearTimeout(copyGreenTimerRef.current);
    copyGreenTimerRef.current = setTimeout(() => setCopyBorderGreen(false), 1600);
  }, []);

  const refresh = useCallback(() => {
    setRows(listOnlineTriggerLog().slice().reverse());
  }, []);

  useEffect(() => {
    refresh();
    const onLog = () => refresh();
    window.addEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
    const onStore = (e: StorageEvent) => {
      if (!e.key || e.key === "pl_online_trigger_log_v1") onLog();
    };
    window.addEventListener("storage", onStore);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("pl-online-trigger-log");
      ch.onmessage = () => onLog();
    } catch {
      ch = null;
    }
    return () => {
      window.removeEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
      window.removeEventListener("storage", onStore);
      try {
        ch?.close();
      } catch {
        /* ignore */
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!viewOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = viewWrapRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setViewOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [viewOpen]);

  const onlineTriggerColumnValue = useCallback(
    (row: OnlineTriggerLogRow, col: string): string => {
      switch (col) {
        case "Date": return `${showLogDate(row.date)} ${row.date ?? ""}`;
        case "Time": return String(row.time ?? "");
        case "API": return String(row.api ?? "");
        case "Sent From / Type": return formatOnlineTriggerSentFromType(row);
        case "Header": return String(row.header ?? "");
        case "Feature": return String(row.feature ?? "");
        default: return "";
      }
    },
    [showLogDate]
  );
  const searchedRows = useMemo(
    () => rows.filter((row) => {
        if (!onlineTriggerLogRowMatchesSearch(row, searchTerm)) return false;
        // Header column filters (raw rows; month/week groups are rebuilt from the survivors,
        // so nested child rows always follow their parent).
        for (const [col, term] of Object.entries(columnFilters)) {
          if (!term || !term.trim()) continue;
          const hay = onlineTriggerColumnValue(row, col);
          if (!columnHaystackMatchesFilter(hay, term)) return false;
        }
        return true;
      }),
    [rows, searchTerm, columnFilters, onlineTriggerColumnValue]
  );
  const groupedRows = useMemo(
    () => groupOnlineTriggerLog(searchedRows, view, dateSystem),
    [searchedRows, view, dateSystem]
  );
  const monthTree = useMemo(
    () => buildOnlineTriggerLogMonthTree(searchedRows, dateSystem),
    [searchedRows, dateSystem]
  );
  const headers = onlineTriggerLogHeadersForView(view);
  const topLevelCount = view === "monthly" ? monthTree.length : groupedRows.length;
  const pageCount = Math.max(1, Math.ceil(topLevelCount / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows: OnlineTriggerFlatRow[] = useMemo(() => {
    if (view === "monthly") {
      const pageMonths = monthTree.slice(start, start + pageSize);
      return flattenOnlineTriggerMonthTree(pageMonths, expandedMonths, expandedWeeks);
    }
    return groupedRows.slice(start, start + pageSize).map((row) => ({
      key: row.id,
      row,
      depth: 0 as const,
    }));
  }, [view, monthTree, groupedRows, start, pageSize, expandedMonths, expandedWeeks]);

  useEffect(() => {
    setPage(1);
    setExpandedMonths(new Set());
    setExpandedWeeks(new Set());
  }, [view, pageSize, searchTerm, columnFilters]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const askClearLog = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "No logs", description: "Log is already empty." });
      return;
    }
    setClearAskOpen(true);
  }, [rows.length, toast]);

  const confirmClearLog = useCallback(() => {
    clearOnlineTriggerLog();
    setClearAskOpen(false);
    setPage(1);
    toast({ title: "Log cleared", description: "New requests will show from now." });
  }, [toast]);

  const copyList = useCallback(
    async (list: OnlineTriggerLogRow[], kind: "shown" | "all") => {
      if (list.length === 0) {
        toast({ title: "No logs", description: "Nothing to copy yet." });
        return;
      }
      setCopying(kind);
      try {
        const ok = await copyTextToClipboard(formatOnlineTriggerLogTsv(list, view));
        toast({
          title: ok ? (kind === "shown" ? "Copied shown rows" : "Copied all logs") : "Copy failed",
          description: ok ? `${list.length} row(s) copied.` : "Clipboard is not available.",
          variant: ok ? "default" : "destructive",
        });
        if (ok) {
          setCopyAskOpen(false);
          flashCopyGreen();
        }
      } finally {
        setCopying(null);
      }
    },
    [view, toast, flashCopyGreen]
  );

  const askCopy = useCallback(() => {
    if (groupedRows.length === 0) {
      toast({ title: "No logs", description: "Nothing to copy yet." });
      return;
    }
    flashCopyGreen();
    setCopyAskOpen(true);
  }, [groupedRows.length, toast, flashCopyGreen]);

  const copyRow = useCallback(
    async (row: OnlineTriggerLogRow) => {
      setCopying("row");
      try {
        const text = `${headers.join("\t")}\n${formatOnlineTriggerRowTsv(row, view)}`;
        const ok = await copyTextToClipboard(text);
        if (ok) {
          setCopiedRowId(row.id);
          if (copiedRowTimer.current) clearTimeout(copiedRowTimer.current);
          copiedRowTimer.current = setTimeout(() => setCopiedRowId(null), 1500);
        }
        toast({
          title: ok ? "Copied row" : "Copy failed",
          description: ok ? `${row.date} ${row.time}` : "Clipboard is not available.",
          variant: ok ? "default" : "destructive",
        });
      } finally {
        setCopying(null);
      }
    },
    [toast, headers, view]
  );

  const rangeLabel = useMemo(() => {
    if (topLevelCount === 0) return "0 of 0";
    const from = start + 1;
    const to = Math.min(start + pageSize, topLevelCount);
    return `${from}–${to} of ${topLevelCount}`;
  }, [topLevelCount, start, pageSize]);

  const shownCopyRows = useMemo(() => pageRows.map((p) => p.row), [pageRows]);

  const viewTotals = useMemo(() => {
    const src = view === "monthly" ? monthTree.map((m) => m.row) : groupedRows;
    return src.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        success: acc.success + r.success,
        failed: acc.failed + r.failed,
        quota: acc.quota + (r.quota || 0),
      }),
      { count: 0, success: 0, failed: 0, quota: 0 }
    );
  }, [view, monthTree, groupedRows]);

  const toggleExpand = useCallback((key: string, depth: 0 | 1) => {
    const setter = depth === 0 ? setExpandedMonths : setExpandedWeeks;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <Card
      data-pl-online-trigger-log=""
      className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-hidden"
    >
      <CardHeader className="flex shrink-0 flex-col gap-3 overflow-x-auto sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <CardTitle>Log of online trigger</CardTitle>
          <SettingsInfoTip
            label="Log of online trigger"
            description="Recording stays on while you use Party, Dashboard, and other pages in this browser. Other tabs of this app share the same log. Newest first."
          />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-hidden">
        <SqliteOnlineStatsCard />
        <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-pl-online-trigger-copy-all=""
            data-pl-copied={copyBorderGreen ? "" : undefined}
            onClick={askCopy}
            disabled={Boolean(copying) || rows.length === 0}
          >
            {copying === "all" || copying === "shown" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copy all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={askClearLog}
            disabled={rows.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Clear log
          </Button>
          <div className="relative" data-pl-online-trigger-view="" ref={viewWrapRef}>
            <button
              type="button"
              data-pl-online-trigger-view-btn=""
              className="flex h-10 min-h-10 min-w-[6.5rem] items-center justify-between gap-1 rounded-md border border-blue-300 bg-white px-2 text-sm"
              aria-label="Log group view"
              aria-expanded={viewOpen}
              onClick={() => setViewOpen((o) => !o)}
            >
              <span>{LOG_VIEW_OPTIONS.find((o) => o.value === view)?.label ?? "Daily"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
            {viewOpen ? (
              <ul
                data-pl-online-trigger-view-menu=""
                className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-full overflow-hidden rounded-md border border-blue-300 bg-white py-0.5 shadow-sm"
                role="listbox"
              >
                {LOG_VIEW_OPTIONS.map((opt) => {
                  const selected = opt.value === view;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-pl-online-trigger-view-option=""
                        data-selected={selected ? "" : undefined}
                        className="block w-full px-2 py-1.5 text-left text-sm text-foreground"
                        onClick={() => {
                          setView(opt.value);
                          setViewOpen(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className="relative w-full max-w-[70mm]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              className="pl-9"
              listChromeSearch
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoComplete="off"
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setListenerOpen(true)}
            title="Firestore listeners"
            aria-label="Firestore listeners"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        <Dialog open={clearAskOpen} onOpenChange={setClearAskOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Clear log</DialogTitle>
              <DialogDescription>
                Clear all online trigger rows on this device? New requests will show from now.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setClearAskOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={confirmClearLog}>
                Clear log
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={copyAskOpen} onOpenChange={setCopyAskOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Copy logs</DialogTitle>
              <DialogDescription>
                Copy only the rows on this page, or the full log in this view.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={pageRows.length === 0 || Boolean(copying)}
                onClick={() => void copyList(shownCopyRows, "shown")}
              >
                Shown rows ({shownCopyRows.length})
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={groupedRows.length === 0 || Boolean(copying)}
                onClick={() => void copyList(groupedRows, "all")}
              >
                All log ({groupedRows.length})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {opsTarget ? <OnlineTriggerOpsDialog target={opsTarget} onClose={() => setOpsTarget(null)} /> : null}
        <Dialog open={listenerOpen} onOpenChange={setListenerOpen}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Firestore listeners</DialogTitle>
              <DialogDescription>
                Live or Delta lists. Admin mode is in use; the other tab is view-only until Admin switches.
              </DialogDescription>
            </DialogHeader>
            <FirestoreListenerTogglePanel embedded />
          </DialogContent>
        </Dialog>
        <div
          data-pl-online-trigger-table=""
          className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden"
        >
          <div
            data-pl-online-trigger-log-inner=""
            className={`flex min-h-0 ${ONLINE_TRIGGER_TABLE_MIN} flex-1 flex-col`}
          >
          <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
          <table
            data-pl-online-trigger-log-inner=""
            className="w-full table-fixed border-collapse text-left text-xs"
          >
            <OnlineTriggerColgroup />
            <thead className="bg-muted shadow-[0_1px_0_hsl(var(--border))]">
              <tr>
                {headers.map((h) => {
                  const numeric = h === "Sent" || h === "Received" || h === "Failed" || h === "Qta exceeded";
                  const cell = (
                    <th
                      key={h}
                      className={`box-border whitespace-nowrap px-2 py-2 font-medium leading-5 ${
                        numeric ? "text-right" : "text-left"
                      }`}
                    >
                      <div className={`flex items-center gap-0.5 whitespace-nowrap ${numeric ? "justify-end" : ""}`}>
                        <span className="block shrink-0 whitespace-nowrap">{h}</span>
                        {ONLINE_TRIGGER_FILTERABLE_HEADERS.has(h) ? (
                          <ColumnHeaderTextFilter
                            label={h}
                            value={columnFilters[h] ?? ""}
                            onChange={(v) => setColumnFilters((prev) => ({ ...prev, [h]: v }))}
                          />
                        ) : null}
                      </div>
                    </th>
                  );
                  if (h !== "Date") return cell;
                  return [
                    cell,
                    <th
                      key="expand"
                      className="box-border w-7 px-0 py-2"
                      aria-label="Expand"
                    />,
                  ];
                })}
                <th className="box-border whitespace-nowrap py-2 pl-1 pr-[5px] text-right font-medium leading-5">
                  <span className="block whitespace-nowrap">Copy</span>
                </th>
              </tr>
            </thead>
          </table>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
          <table
            data-pl-online-trigger-log-inner=""
            className="w-full table-fixed border-collapse text-left text-xs"
          >
            <OnlineTriggerColgroup />
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 2} className="box-border px-2 py-8 text-center text-muted-foreground">
                    No online requests logged yet. Use the app, then open this page again.
                  </td>
                </tr>
              ) : (
                pageRows.map((item) => {
                  const row = item.row;
                  const expanded =
                    item.expandKey &&
                    (item.depth === 0
                      ? expandedMonths.has(item.expandKey)
                      : expandedWeeks.has(item.expandKey));
                  return (
                  <tr
                    key={item.key}
                    className="border-t"
                    onClick={() => {
                      if (item.expandKey && (item.depth === 0 || item.depth === 1)) {
                        toggleExpand(item.expandKey, item.depth);
                      }
                    }}
                  >
                    <td
                      className="box-border px-2 py-0.5 align-middle"
                      style={{ paddingLeft: 8 + item.depth * 14 }}
                      title={showLogDate(row.date)}
                    >
                      <RangeCellText text={showLogDate(row.date)} />
                    </td>
                    <td className="box-border px-0 py-1.5 text-center leading-5">
                      {item.expandKey ? (
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                          aria-label={expanded ? "Collapse" : "Expand"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(item.expandKey!, item.depth === 0 ? 0 : 1);
                          }}
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
                        </button>
                      ) : null}
                    </td>
                    <td className="box-border px-2 py-0.5 align-middle" title={row.time}>
                      <RangeCellText text={row.time || "—"} mono />
                    </td>
                    <td
                      className="box-border truncate px-2 py-1.5 leading-5"
                      title={row.apis && row.apis.length > 1 ? row.apis.join(", ") : undefined}
                    >
                      {row.apis && row.apis.length > 1 ? `${row.apis.length} APIs` : row.apis?.[0] ?? row.api}
                    </td>
                    <td
                      className="box-border truncate px-2 py-1.5 leading-5"
                      title={formatOnlineTriggerSentFromType(row)}
                    >
                      {formatOnlineTriggerSentFromType(row)}
                    </td>
                    <td className="box-border truncate px-2 py-1.5 leading-5" title={row.header}>
                      {row.header}
                    </td>
                    <td className="box-border truncate px-2 py-1.5 leading-5">{row.feature}</td>
                    <td className="box-border truncate px-2 py-1.5 font-mono leading-5" title={row.codePath}>
                      {row.codePath}
                    </td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">
                      <OpCountCell value={row.count} onOpen={() => setOpsTarget({ row, col: "Sent" })} />
                    </td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">
                      <OpCountCell value={row.success} onOpen={() => setOpsTarget({ row, col: "Received" })} />
                    </td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">
                      <OpCountCell value={row.failed} onOpen={() => setOpsTarget({ row, col: "Failed" })} />
                    </td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">
                      <OpCountCell value={row.quota || 0} onOpen={() => setOpsTarget({ row, col: "Qta exceeded" })} />
                    </td>
                    <td className="box-border py-1.5 pl-1 pr-[5px] text-right leading-5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-6 w-6"
                        aria-label="Copy"
                        title="Copy"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyRow(row);
                        }}
                        disabled={copying === "row"}
                      >
                        {copiedRowId === row.id ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
          <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
          <table
            data-pl-online-trigger-log-inner=""
            className="w-full table-fixed border-collapse text-left text-xs"
          >
            <OnlineTriggerColgroup />
            <tfoot>
              <tr data-pl-online-trigger-total-row="">
                <td className="box-border px-2 py-1.5" />
                <td className="box-border px-0 py-1.5" />
                <td className="box-border px-2 py-1.5" />
                <td className="box-border px-2 py-1.5" />
                <td className="box-border px-2 py-1.5" />
                <td className="box-border px-2 py-1.5" />
                <td className="box-border px-2 py-1.5" />
                <td className="box-border py-1.5 pr-[40px] text-right text-sm font-bold leading-5">
                  Total
                </td>
                <td className="box-border px-2 py-1.5 text-right text-sm font-bold tabular-nums leading-5">
                  {viewTotals.count}
                </td>
                <td className="box-border px-2 py-1.5 text-right text-sm font-bold tabular-nums leading-5">
                  {viewTotals.success}
                </td>
                <td className="box-border px-2 py-1.5 text-right text-sm font-bold tabular-nums leading-5">
                  {viewTotals.failed}
                </td>
                <td className="box-border px-2 py-1.5 text-right text-sm font-bold tabular-nums leading-5">
                  {viewTotals.quota}
                </td>
                <td className="box-border py-1.5 pl-1 pr-[5px]" />
              </tr>
            </tfoot>
          </table>
          </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto">
          <span className="shrink-0 text-xs text-muted-foreground">{rangeLabel}</span>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Show page
              <select
                data-pl-online-trigger-page-size=""
                className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Show page size"
              >
                {ONLINE_TRIGGER_LOG_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[4.5rem] text-center text-xs">
              {safePage} / {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
