"use client";

/**
 * Pocket Ledger Server: progress + storage controls for the data / file pull.
 * - `PocketBaseSyncProgressBadge`: small floating pill while a pull is running (click for details).
 * - `PocketBaseFilesPanel`: details (X / N), storage warning, "Download all files", "Clear files cache".
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePbDataPullProgress, usePbFilesPullProgress } from "@/lib/pocketbaseData/pbSyncProgress";

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n < 1024 * 1024 * 1024) return `${Math.max(1, Math.round(n / 1048576))} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

type Usage = { count: number; bytes: number; free: number | null; quota: number | null };

export function PocketBaseFilesPanel() {
  const files = usePbFilesPullProgress();
  const data = usePbDataPullProgress();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refreshUsage = useCallback(async () => {
    try {
      const { getPbFilesDeviceUsage } = await import("@/lib/pocketbaseData/pbFilesPull");
      setUsage(await getPbFilesDeviceUsage());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage, files.phase]);

  const running = files.phase === "listing" || files.phase === "downloading";
  const pct = files.total > 0 ? Math.min(100, Math.round((files.done / files.total) * 100)) : 0;
  const lowStorage =
    usage?.quota != null && usage.free != null && usage.quota > 0 && usage.free / usage.quota < 0.1;

  const onClear = async () => {
    if (
      !window.confirm(
        "Remove the downloaded server files from this device?\n\nVouchers and data stay. Files are fetched again when you open them, or press \"Download all files\"."
      )
    )
      return;
    setBusy(true);
    try {
      const { clearPbFilesCache } = await import("@/lib/pocketbaseData/pbFilesPull");
      const out = await clearPbFilesCache();
      setNote(`Removed ${out.count} file(s) (${fmtBytes(out.bytes)}).`);
      await refreshUsage();
    } catch {
      setNote("Could not clear the files cache.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-2 text-xs">
      {data.active ? (
        <div>
          <div className="flex justify-between">
            <span className="font-medium">Data</span>
            <span translate="no">
              {data.docs}
              {data.total != null ? ` / ${data.total}` : ""}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${data.total ? Math.min(100, Math.round((data.docs / data.total) * 100)) : 15}%` }}
            />
          </div>
        </div>
      ) : null}
      <div>
        <div className="flex justify-between">
          <span className="font-medium">
            Files{" "}
            {files.phase === "listing"
              ? "(checking...)"
              : files.phase === "downloading"
                ? "(downloading)"
                : files.phase === "paused"
                  ? "(paused)"
                  : files.phase === "error"
                    ? "(retrying later)"
                    : files.phase === "done"
                      ? "(all on this device)"
                      : files.autoOff
                        ? "(automatic download is off)"
                        : ""}
          </span>
          {files.total > 0 ? (
            <span translate="no">
              {files.done} / {files.total}
            </span>
          ) : null}
        </div>
        {files.total > 0 ? (
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {files.failed > 0 || files.missing > 0 ? (
          <p className="text-muted-foreground">
            {files.failed > 0 ? `${files.failed} failed. ` : ""}
            {files.missing > 0 ? `${files.missing} no longer on the server.` : ""}
          </p>
        ) : null}
        {files.message ? <p className="text-amber-600 dark:text-amber-400">{files.message}</p> : null}
      </div>
      <div className="text-muted-foreground">
        {usage
          ? `Server files on this device: ${usage.count} (${fmtBytes(usage.bytes)})${
              usage.free != null ? ` - free space about ${fmtBytes(usage.free)}` : ""
            }`
          : "Checking storage..."}
      </div>
      {lowStorage ? (
        <p className="text-amber-600 dark:text-amber-400">
          Storage is almost full. Free some space or press "Clear files cache".
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={running || busy}
          onClick={() => {
            setNote("");
            void import("@/lib/pocketbaseData/pbFilesPull").then((m) => m.startPbFilesSyncManual());
          }}
        >
          Download all files
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={running || busy || !usage || usage.count === 0}
          onClick={() => void onClear()}
        >
          Clear files cache
        </Button>
        {note ? <span className="text-muted-foreground">{note}</span> : null}
      </div>
    </div>
  );
}

export function PocketBaseSyncProgressBadge() {
  const files = usePbFilesPullProgress();
  const data = usePbDataPullProgress();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const filesBusy = files.phase === "listing" || files.phase === "downloading" || files.phase === "paused" || files.phase === "error";
  const syncActive = data.active || filesBusy;
  useEffect(() => {
    // Sync khatam hone par hide reset, taaki agli baar phir dikhe
    if (!syncActive) setHidden(false);
  }, [syncActive]);
  if (!syncActive || hidden) return null;
  const label = data.active
    ? `Data ${data.docs}${data.total != null ? `/${data.total}` : ""}`
    : files.phase === "listing"
      ? "Files: checking..."
      : files.phase === "paused"
        ? `Files paused ${files.done}/${files.total}`
        : files.phase === "error"
          ? `Files ${files.done}/${files.total} (retry)`
          : `Files ${files.done}/${files.total}`;
  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] flex max-w-[28rem] flex-col items-center gap-2 print:hidden">
      {open ? (
        <div className="w-96 shadow-lg">
          <PocketBaseFilesPanel />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-md"
        translate="no"
        aria-label="Server sync progress"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setHidden(true);
        }}
        className="rounded-full border border-border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-md"
        translate="no"
        aria-label="Hide server sync progress"
      >
        Hide
      </button>
    </div>
  );
}
