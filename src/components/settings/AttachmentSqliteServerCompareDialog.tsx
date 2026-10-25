"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Company } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  mergeAttachmentSqliteAndServer,
  scanAttachmentSqliteVsServer,
  type AttachmentCompareProgress,
  type AttachmentSqliteServerCompare,
} from "@/lib/attachmentSqliteServerCompare";
import { useToast } from "@/hooks/use-toast";

const EMPTY_COMPARE: AttachmentSqliteServerCompare = {
  sqliteFileCount: 0,
  serverFileCount: 0,
  bothCount: 0,
  notInSqlite: [],
  notOnServer: [],
};

export function AttachmentSqliteServerCompareDialog({
  open,
  onOpenChange,
  company,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
  companyId: string | null;
}) {
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<"scan" | "merge" | null>(null);
  const [progress, setProgress] = useState<AttachmentCompareProgress | null>(null);
  const [compare, setCompare] = useState<AttachmentSqliteServerCompare | null>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onOpenChange(false);
  }, [onOpenChange]);

  const runScan = useCallback(async () => {
    if (!company || !companyId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy("scan");
    setCompare(null);
    setProgress({ phase: "Scanning", detail: "Scanning SQLite and server…", percent: 1 });
    try {
      const result = await scanAttachmentSqliteVsServer({
        company,
        companyId,
        signal: ac.signal,
        onProgress: setProgress,
      });
      if (ac.signal.aborted) return;
      setCompare(result);
      setProgress({ phase: "Ready", detail: "Scan complete.", percent: 100 });
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.message === "Cancelled")) return;
      toast({
        variant: "destructive",
        title: "Scan failed",
        description: e instanceof Error ? e.message : String(e),
      });
      setCompare(EMPTY_COMPARE);
    } finally {
      setBusy((b) => (b === "scan" ? null : b));
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [company, companyId, toast]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(null);
      setProgress(null);
      setCompare(null);
      return;
    }
    void runScan();
  }, [open, runScan]);

  const missingTotal = (compare?.notInSqlite.length || 0) + (compare?.notOnServer.length || 0);

  const runMerge = async () => {
    if (!companyId || !compare || missingTotal === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy("merge");
    setProgress({ phase: "Merging", detail: "Updating missing files only…", percent: 1 });
    try {
      const result = await mergeAttachmentSqliteAndServer({
        companyId,
        notInSqlite: compare.notInSqlite,
        notOnServer: compare.notOnServer,
        signal: ac.signal,
        onProgress: setProgress,
      });
      if (ac.signal.aborted) return;
      toast({
        title: result.failed > 0 ? "Merge finished with errors" : "Merge complete",
        description:
          result.failed > 0
            ? `Downloaded ${result.downloaded}, uploaded ${result.uploaded}, failed ${result.failed}.${result.error ? ` ${result.error}` : ""}`
            : `Downloaded ${result.downloaded} to SQLite, uploaded ${result.uploaded} to server.`,
        variant: result.failed > 0 ? "destructive" : "default",
      });
      await runScan();
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.message === "Cancelled")) return;
      toast({
        variant: "destructive",
        title: "Merge failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy((b) => (b === "merge" ? null : b));
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const scanning = busy === "scan" || (open && !compare);
  const rows = compare
    ? [
        { label: "SQLite file", value: compare.sqliteFileCount },
        { label: "Server file", value: compare.serverFileCount },
        { label: "Not in SQLite", value: compare.notInSqlite.length },
        { label: "Not on server", value: compare.notOnServer.length },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md" data-pl-backup-dialog="sky">
        <DialogHeader>
          <DialogTitle>Attachment compare</DialogTitle>
          <DialogDescription>
            Scan SQLite on this device and server links, then merge only missing files both ways.
          </DialogDescription>
        </DialogHeader>
        {scanning || busy === "merge" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-medium text-foreground">{progress?.phase || (scanning ? "Scanning" : "Merging")}</p>
            <p className="text-center text-xs leading-snug">{progress?.detail || "Scanning…"}</p>
            {typeof progress?.percent === "number" ? (
              <p className="tabular-nums text-xs">{progress.percent}%</p>
            ) : null}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Place</th>
                <th className="py-2 text-right font-medium">Files</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right tabular-nums font-medium text-foreground">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" variant="outline" className="w-full" onClick={close} disabled={busy === "merge"}>
            {busy ? "Cancel" : "Close"}
          </Button>
          <Button
            type="button"
            className="w-full"
            disabled={Boolean(busy) || missingTotal === 0}
            onClick={() => void runMerge()}
          >
            Merge both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
