"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ONLINE_TRIGGER_LOG_EVENT,
  ONLINE_TRIGGER_LOG_HEADERS,
  ONLINE_TRIGGER_LOG_PAGE_SIZE,
  copyTextToClipboard,
  formatOnlineTriggerLogTsv,
  formatOnlineTriggerRowTsv,
  clearOnlineTriggerLog,
  listOnlineTriggerLog,
  type OnlineTriggerLogRow,
} from "@/lib/onlineTriggerLog";
import { FirestoreListenerTogglePanel } from "@/components/settings/FirestoreListenerTogglePanel";

export function OnlineTriggerLogSettings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<OnlineTriggerLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [copying, setCopying] = useState<"all" | "row" | null>(null);

  const refresh = useCallback(() => {
    setRows(listOnlineTriggerLog().slice().reverse());
  }, []);

  useEffect(() => {
    refresh();
    const onLog = () => refresh();
    window.addEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
    return () => window.removeEventListener(ONLINE_TRIGGER_LOG_EVENT, onLog);
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(rows.length / ONLINE_TRIGGER_LOG_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * ONLINE_TRIGGER_LOG_PAGE_SIZE;
  const pageRows = rows.slice(start, start + ONLINE_TRIGGER_LOG_PAGE_SIZE);

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
    if (rows.length === 0) {
      toast({ title: "No logs", description: "Nothing to copy yet." });
      return;
    }
    setCopying("all");
    try {
      const ok = await copyTextToClipboard(formatOnlineTriggerLogTsv(rows));
      toast({
        title: ok ? "Copied all logs" : "Copy failed",
        description: ok ? `${rows.length} row(s) copied.` : "Clipboard is not available.",
        variant: ok ? "default" : "destructive",
      });
    } finally {
      setCopying(null);
    }
  }, [rows, toast]);

  const copyRow = useCallback(
    async (row: OnlineTriggerLogRow) => {
      setCopying("row");
      try {
        const text = `${ONLINE_TRIGGER_LOG_HEADERS.join("\t")}\n${formatOnlineTriggerRowTsv(row)}`;
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
    [toast]
  );

  const rangeLabel = useMemo(() => {
    if (rows.length === 0) return "0 of 0";
    const from = start + 1;
    const to = Math.min(start + ONLINE_TRIGGER_LOG_PAGE_SIZE, rows.length);
    return `${from}–${to} of ${rows.length}`;
  }, [rows.length, start]);

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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <FirestoreListenerTogglePanel />
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-[1100px] w-full text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                {ONLINE_TRIGGER_LOG_HEADERS.map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
                <th className="whitespace-nowrap px-2 py-2 font-medium">Copy</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={ONLINE_TRIGGER_LOG_HEADERS.length + 1} className="px-2 py-8 text-center text-muted-foreground">
                    No online requests logged yet. Use the app, then open this page again.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="whitespace-nowrap px-2 py-1.5">{row.date}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">{row.time}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.api}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.sentFrom}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.voucherType}</td>
                    <td className="max-w-[140px] truncate px-2 py-1.5" title={row.header}>
                      {row.header}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.feature}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 font-mono" title={row.codePath}>
                      {row.codePath}
                    </td>
                    <td className="px-2 py-1.5 text-right">{row.count}</td>
                    <td className="px-2 py-1.5 text-right">{row.success}</td>
                    <td className="px-2 py-1.5 text-right">{row.failed}</td>
                    <td className="px-2 py-1.5">
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
