"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, Settings, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  copyTextToClipboard,
  formatOnlineTriggerLogTsv,
  formatOnlineTriggerRowTsv,
  clearOnlineTriggerLog,
  groupOnlineTriggerLog,
  listOnlineTriggerLog,
  onlineTriggerLogHeadersForView,
  type OnlineTriggerLogRow,
  type OnlineTriggerLogView,
} from "@/lib/onlineTriggerLog";
import { FirestoreListenerTogglePanel } from "@/components/settings/FirestoreListenerTogglePanel";

export function OnlineTriggerLogSettings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<OnlineTriggerLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [copying, setCopying] = useState<"all" | "row" | null>(null);
  const [listenerOpen, setListenerOpen] = useState(false);
  const [view, setView] = useState<OnlineTriggerLogView>("daily");

  const refresh = useCallback(() => {
    setRows(listOnlineTriggerLog().slice().reverse());
  }, []);

  useEffect(() => {
    refresh();
    const onLog = () => refresh();
    window.addEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
    return () => window.removeEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
  }, [refresh]);

  const groupedRows = useMemo(() => groupOnlineTriggerLog(rows, view), [rows, view]);
  const headers = onlineTriggerLogHeadersForView(view);
  const pageCount = Math.max(1, Math.ceil(groupedRows.length / ONLINE_TRIGGER_LOG_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * ONLINE_TRIGGER_LOG_PAGE_SIZE;
  const pageRows = groupedRows.slice(start, start + ONLINE_TRIGGER_LOG_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [view]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const clearLog = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "No logs", description: "Log is already empty." });
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Clear all online trigger rows on this device?")) {
      return;
    }
    clearOnlineTriggerLog();
    setPage(1);
    toast({ title: "Log cleared", description: "New requests will show from now." });
  }, [rows.length, toast]);

  const copyAll = useCallback(async () => {
    if (groupedRows.length === 0) {
      toast({ title: "No logs", description: "Nothing to copy yet." });
      return;
    }
    setCopying("all");
    try {
      const ok = await copyTextToClipboard(formatOnlineTriggerLogTsv(groupedRows, view));
      toast({
        title: ok ? "Copied all logs" : "Copy failed",
        description: ok ? `${groupedRows.length} row(s) copied.` : "Clipboard is not available.",
        variant: ok ? "default" : "destructive",
      });
    } finally {
      setCopying(null);
    }
  }, [groupedRows, view, toast]);

  const copyRow = useCallback(
    async (row: OnlineTriggerLogRow) => {
      setCopying("row");
      try {
        const text = `${headers.join("\t")}\n${formatOnlineTriggerRowTsv(row, view)}`;
        const ok = await copyTextToClipboard(text);
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
    if (groupedRows.length === 0) return "0 of 0";
    const from = start + 1;
    const to = Math.min(start + ONLINE_TRIGGER_LOG_PAGE_SIZE, groupedRows.length);
    return `${from}–${to} of ${groupedRows.length}`;
  }, [groupedRows.length, start]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle>Log of online trigger</CardTitle>
          <CardDescription>
            Recording stays on while you use Party, Dashboard, and other pages in this
            browser. Other tabs of this app share the same log. Newest first.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => void copyAll()} disabled={copying === "all" || rows.length === 0}>
            {copying === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copy all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clearLog}
            disabled={rows.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Clear log
          </Button>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={view}
            onChange={(e) => setView(e.target.value as OnlineTriggerLogView)}
            aria-label="Log group view"
          >
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
            <option value="details">Details</option>
          </select>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="ml-auto h-8 w-8"
            onClick={() => setListenerOpen(true)}
            title="Firestore listeners"
            aria-label="Firestore listeners"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
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
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1180px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[7%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col className="w-[5%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead className="bg-muted/50">
              <tr>
                {headers.map((h) => {
                  const numeric = h === "Count" || h === "Success" || h === "Failed";
                  return (
                    <th
                      key={h}
                      className={`box-border px-2 py-2 font-medium leading-5 ${
                        numeric ? "text-right" : "text-left"
                      }`}
                    >
                      <span className="block truncate">{h}</span>
                    </th>
                  );
                })}
                <th className="box-border px-2 py-2 text-left font-medium leading-5">
                  <span className="block truncate">Copy</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 1} className="box-border px-2 py-8 text-center text-muted-foreground">
                    No online requests logged yet. Use the app, then open this page again.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="box-border truncate px-2 py-1.5 leading-5" title={row.date}>
                      {row.date}
                    </td>
                    <td className="box-border truncate px-2 py-1.5 font-mono leading-5" title={row.time}>
                      {row.time || "—"}
                    </td>
                    <td className="box-border truncate px-2 py-1.5 leading-5">{row.api}</td>
                    <td className="box-border truncate px-2 py-1.5 leading-5">{row.sentFrom}</td>
                    <td className="box-border truncate px-2 py-1.5 leading-5">{row.voucherType}</td>
                    <td className="box-border truncate px-2 py-1.5 leading-5" title={row.header}>
                      {row.header}
                    </td>
                    <td className="box-border truncate px-2 py-1.5 leading-5">{row.feature}</td>
                    <td className="box-border truncate px-2 py-1.5 font-mono leading-5" title={row.codePath}>
                      {row.codePath}
                    </td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">{row.count}</td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">{row.success}</td>
                    <td className="box-border px-2 py-1.5 text-right tabular-nums leading-5">{row.failed}</td>
                    <td className="box-border px-2 py-1.5 leading-5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => void copyRow(row)}
                        disabled={copying === "row"}
                      >
                        Copy
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{rangeLabel}</span>
          <div className="flex items-center gap-1">
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
