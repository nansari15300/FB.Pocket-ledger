"use client";

/**
 * Pocket Ledger Server: progress + storage controls for the data / file pull.
 * - `PocketBaseSyncProgressBadge`: centered popup modal while main data is syncing (1st time full download).
 *   Does NOT popup for minor background file syncing.
 * - `PocketBaseFilesPanel`: details (X / N), storage warning, "Download all files", "Clear files cache".
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, X, HardDrive, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePbDataPullProgress, usePbFilesPullProgress } from "@/lib/pocketbaseData/pbSyncProgress";

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n < 1024 * 1024 * 1024) return `${Math.max(1, Math.round(n / 1048576))} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

type Usage = { count: number; bytes: number; free: number | null; quota: number | null };

export function PocketBaseFilesPanel({
  onHide,
  isPopup,
}: {
  onHide?: () => void;
  isPopup?: boolean;
} = {}) {
  const files = usePbFilesPullProgress();
  const data = usePbDataPullProgress();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showTools, setShowTools] = useState(false);

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
  const filePct = files.total > 0 ? Math.min(100, Math.round((files.done / files.total) * 100)) : 0;
  const dataPct = data.total && data.total > 0 ? Math.min(100, Math.round((data.docs / data.total) * 100)) : 0;
  const filesComplete = files.phase === "done" && files.total > 0 && files.done >= files.total;

  const lowStorage =
    usage?.quota != null && usage.free != null && usage.quota > 0 && usage.free / usage.quota < 0.1;

  const onClear = async () => {
    if (
      !window.confirm(
        'Remove the downloaded server files from this device?\n\nVouchers and data stay. Files are fetched again when you open them, or press "Download all files".'
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
    <div
      className={`space-y-3 rounded-2xl bg-background/98 text-xs backdrop-blur-md
        border border-emerald-500/20
        shadow-[0_2px_8px_0_rgba(0,0,0,0.06),0_8px_32px_0_rgba(16,185,129,0.08)]
        dark:shadow-[0_2px_8px_0_rgba(0,0,0,0.3),0_8px_32px_0_rgba(16,185,129,0.12)]
        ${isPopup ? "p-4 sm:p-5" : "p-3"}`}
    >
      {/* Header if popup */}
      {isPopup ? (
        <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
          <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />
            <span>Server Data Syncing</span>
          </div>
          {onHide ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onHide}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg"
              aria-label="Hide sync progress popup"
            >
              <span>Hide</span>
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Data Progress */}
      {data.active ? (
        <div className="space-y-1.5 rounded-xl p-3
          bg-white dark:bg-zinc-900
          border border-emerald-400/25
          shadow-[0_4px_16px_0_rgba(16,185,129,0.15),0_1px_4px_0_rgba(0,0,0,0.08)]
          dark:shadow-[0_4px_16px_0_rgba(16,185,129,0.20),0_1px_4px_0_rgba(0,0,0,0.30)]
          hover:shadow-[0_12px_32px_0_rgba(16,185,129,0.28),0_4px_12px_0_rgba(0,0,0,0.12)]
          dark:hover:shadow-[0_12px_32px_0_rgba(16,185,129,0.35),0_4px_12px_0_rgba(0,0,0,0.40)]
          hover:-translate-y-1
          transition-all duration-200 ease-out">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <span>Data (Vouchers & Masters)</span>
            </span>
            <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400" translate="no">
              <span>{data.docs}{data.total != null ? ` / ${data.total}` : ""}</span>
              {data.total ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  {dataPct}%
                </span>
              ) : null}
            </div>
          </div>
          {/* Thick progress bar */}
          <div className="h-3.5 w-full overflow-hidden rounded-full bg-muted/80 p-0.5 shadow-inner">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${data.total ? Math.max(3, dataPct) : 15}%` }}
            />
          </div>
          {data.collection ? (
            <p className="text-[11px] text-muted-foreground truncate" translate="no">
              Syncing: {data.collection}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Files Progress (only if files are active during sync) */}
      {files.total > 0 || running ? (
        <div className="space-y-1.5 rounded-xl p-3
          bg-white dark:bg-zinc-900
          border border-emerald-400/25
          shadow-[0_4px_16px_0_rgba(16,185,129,0.15),0_1px_4px_0_rgba(0,0,0,0.08)]
          dark:shadow-[0_4px_16px_0_rgba(16,185,129,0.20),0_1px_4px_0_rgba(0,0,0,0.30)]
          hover:shadow-[0_12px_32px_0_rgba(16,185,129,0.28),0_4px_12px_0_rgba(0,0,0,0.12)]
          dark:hover:shadow-[0_12px_32px_0_rgba(16,185,129,0.35),0_4px_12px_0_rgba(0,0,0,0.40)]
          hover:-translate-y-1
          transition-all duration-200 ease-out">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">
              Files{" "}
              <span className="font-normal text-muted-foreground text-[11px]">
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
            </span>
            {/* Show count only when: actively running OR done with meaningful file count (>5) */}
            {files.total > 0 && (running || files.total > 5) ? (
              <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400" translate="no">
                <span>{files.done} / {files.total}</span>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  {filePct}%
                </span>
              </div>
            ) : files.phase === "done" && !running ? (
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">✓ 100%</span>
            ) : null}
          </div>
          {/* Thick progress bar — show when running OR when done with meaningful file count */}
          {files.total > 0 && (running || files.total > 5) ? (
            <div className="h-3.5 w-full overflow-hidden rounded-full bg-muted/80 p-0.5 shadow-inner">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.max(3, filePct)}%` }}
              />
            </div>
          ) : files.phase === "done" ? (
            <div className="h-3.5 w-full overflow-hidden rounded-full bg-muted/80 p-0.5 shadow-inner">
              <div className="h-full rounded-full bg-emerald-500 w-full" />
            </div>
          ) : null}
          {files.failed > 0 || files.missing > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {files.failed > 0 ? `${files.failed} failed. ` : ""}
              {files.missing > 0 ? `${files.missing} no longer on the server.` : ""}
            </p>
          ) : null}
          {files.message ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{files.message}</p> : null}
        </div>
      ) : null}

      {/* Storage info */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
        <span className="flex items-center gap-1">
          <HardDrive className="h-3.5 w-3.5" />
          {usage
            ? `Device: ${usage.count} files (all companies, ${fmtBytes(usage.bytes)})`
            : "Checking storage..."}
        </span>
        <button
          type="button"
          onClick={() => setShowTools((v) => !v)}
          className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground text-[11px] font-medium"
        >
          <span>Tools</span>
          {showTools ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {lowStorage ? (
        <p className="text-amber-600 dark:text-amber-400 text-[11px]">
          Storage is almost full. Free some space or press "Clear files cache".
        </p>
      ) : null}

      {/* Advanced / Tools Drawer */}
      {showTools ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={`h-7 text-xs rounded-lg ${filesComplete ? "border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 cursor-default" : ""}`}
            disabled={running || busy}
            onClick={() => {
              if (filesComplete) return;
              setNote("");
              void import("@/lib/pocketbaseData/pbFilesPull").then((m) => m.startPbFilesSyncManual());
            }}
          >
            {filesComplete ? "✓ Download Complete" : "Download all files"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs rounded-lg"
            disabled={running || busy || !usage || usage.count === 0}
            onClick={() => void onClear()}
          >
            Clear files cache
          </Button>
          {note ? <span className="text-muted-foreground text-[11px]">{note}</span> : null}
        </div>
      ) : null}

      {/* Footer Hide button if popup */}
      {isPopup && onHide ? (
        <div className="pt-1 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onHide}
            className="h-8 w-full text-xs text-muted-foreground hover:text-foreground rounded-xl border-border/70"
          >
            Hide in background
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PocketBaseSyncProgressBadge() {
  const data = usePbDataPullProgress();
  const [hidden, setHidden] = useState(false);

  // User requirement: Only show popup during main data download (1st time full download).
  // Minor background file downloading will NOT trigger this popup.
  const syncActive = data.active;

  useEffect(() => {
    // When a new main data pull starts, reset hidden so user sees progress
    if (data.active) setHidden(false);
  }, [data.active]);

  if (!syncActive || hidden) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] print:hidden animate-in fade-in duration-200">
      <div className="w-[min(92vw,26rem)] animate-in zoom-in-95 duration-200">
        <PocketBaseFilesPanel isPopup onHide={() => setHidden(true)} />
      </div>
    </div>
  );
}
