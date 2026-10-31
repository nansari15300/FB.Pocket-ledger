"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { canSyncCompanyToServer } from "@/lib/localVoucherOutbox";
import {
  forceUploadLocalCompanyToServer,
  type ForceUploadProgress,
} from "@/lib/forceUploadLocalCompanyToServer";
import { useToast } from "@/hooks/use-toast";
import { yieldToMain } from "@/lib/yieldToMain";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

export type ForceUploadInlineProgress = {
  phase: string;
  done: number;
  total: number;
  percent: number;
  detail?: string;
  status: "running" | "complete" | "failed";
  message?: string;
};

type Props = {
  /** Company Profile main area top pe progress strip. */
  onInlineProgress?: (state: ForceUploadInlineProgress | null) => void;
};

export function ForceUploadLocalDataButton({ onInlineProgress }: Props = {}) {
  const { companyId, triggerSync } = useCompany();
  const { toast } = useToast();
  const [canSync, setCanSync] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!companyId) {
        if (!cancelled) setCanSync(false);
        return;
      }
      const allowed = await canSyncCompanyToServer(companyId);
      if (!cancelled) setCanSync(allowed);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const publishProgress = useCallback(
    (state: ForceUploadInlineProgress | null) => {
      onInlineProgress?.(state);
    },
    [onInlineProgress]
  );

  const runForceUpload = useCallback(async () => {
    if (!companyId || isRunning) return;
    setIsRunning(true);
    setOpen(false);
    publishProgress({
      phase: "Scanning local data",
      done: 0,
      total: 1,
      percent: 0,
      status: "running",
      message: "Scanning SQLite + pending attachments…",
    });
    await yieldToMain();
    try {
      const result = await forceUploadLocalCompanyToServer(companyId, {
        forceRestorePendingUpload: true,
        onProgress: (p: ForceUploadProgress) => {
          const total = Math.max(1, p.total);
          const done = Math.max(0, p.done);
          const percent = Math.min(99, Math.floor((done / total) * 100));
          publishProgress({
            phase: p.phase || "Uploading",
            done,
            total,
            percent,
            detail: p.detail,
            status: "running",
            message: p.detail || p.phase,
          });
        },
      });

      // Pocket Ledger Server (PocketBase) company: files already went to the server; nothing to patch in Firestore.
      if (!isPocketBaseCompanyId(companyId)) {
        try {
          const { patchSqliteHttpsAttachmentsToFirestore } = await import(
            "@/lib/restoreCloudBackgroundSync"
          );
          await patchSqliteHttpsAttachmentsToFirestore(companyId);
        } catch {
          /* best-effort */
        }
      }

      if (!result.ok && result.message && result.docsPushed === 0 && result.filesSynced === 0 && result.localRefsRelinked === 0) {
        publishProgress({
          phase: "Failed",
          done: 0,
          total: 1,
          percent: 0,
          status: "failed",
          message: result.message,
        });
        toast({
          variant: "destructive",
          title: "Force upload failed",
          description: result.message,
        });
        return;
      }

      const parts: string[] = [];
      if (result.docsPushed > 0) parts.push(`${result.docsPushed} record(s) pushed`);
      if (result.filesSynced > 0) parts.push(`${result.filesSynced} file(s) uploaded`);
      if (result.localRefsRelinked > 0) {
        parts.push(`${result.localRefsRelinked} file URL(s) recovered from Storage`);
      }
      if (result.outboxFlushed > 0) parts.push(`${result.outboxFlushed} queue item(s) synced`);
      if (result.localRefsRequeued > 0) {
        parts.push(`${result.localRefsRequeued} local file ref(s) re-queued`);
      }
      if (result.pendingVouchersSynced > 0) {
        parts.push(`${result.pendingVouchersSynced} pending voucher(s) synced`);
      }
      if (result.pendingMastersSynced > 0) {
        parts.push(`${result.pendingMastersSynced} pending master(s) synced`);
      }

      const warnParts: string[] = [];
      if (result.filesFailed > 0) warnParts.push(`${result.filesFailed} file(s) failed`);
      const stuck = result.localRefsStillStuck;
      if (stuck > 0) {
        warnParts.push(
          `${stuck} local file(s) have no bytes on this device (console: [FORCE_UPLOAD_TRACE])`
        );
        if (result.missingSample?.length) {
          console.warn("[FORCE_UPLOAD_TRACE] STUCK_SAMPLE", result.missingSample);
        }
      }
      if (result.errors.length) warnParts.push(result.errors.slice(0, 2).join(" · "));

      const description =
        parts.length > 0
          ? `${parts.join(" · ")}.${warnParts.length ? ` ${warnParts.join(" · ")}.` : ""}`
          : warnParts.join(" · ") || "Scan finished — everything already looked synced.";

      publishProgress({
        phase: stuck > 0 ? "Completed with issues" : "Complete",
        done: 1,
        total: 1,
        percent: 100,
        status: stuck > 0 ? "failed" : "complete",
        message: description,
      });

      toast({
        variant: stuck > 0 ? "destructive" : "default",
        title: stuck > 0 ? "Force upload completed with issues" : "Force upload complete",
        description,
      });

      // triggerSync rebinds every listener (extra reads); a PocketBase push already refreshes local lists itself.
      if (!isPocketBaseCompanyId(companyId)) triggerSync();
      window.setTimeout(() => publishProgress(null), 8_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      publishProgress({
        phase: "Failed",
        done: 0,
        total: 1,
        percent: 0,
        status: "failed",
        message: msg,
      });
      toast({
        variant: "destructive",
        title: "Force upload failed",
        description: msg,
      });
    } finally {
      setIsRunning(false);
    }
  }, [companyId, isRunning, publishProgress, toast, triggerSync]);

  if (!companyId || !canSync) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 rounded-md border border-black whitespace-normal h-auto min-h-9 py-1.5 text-left leading-tight sm:max-w-xs"
          disabled={isRunning || (typeof navigator !== "undefined" && !navigator.onLine)}
          title="Push pending changes and files only to the server"
        >
          {isRunning ? (
            <Loader2 className="mr-1.5 h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <CloudUpload className="mr-1.5 h-4 w-4 shrink-0" />
          )}
          Force upload local data / files to server
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Force upload to server?</AlertDialogTitle>
          <AlertDialogDescription>
            This will push pending changes and files only: records still queued on this device and
            attachments that are not on the server yet. Anything already on the server is left alone.
            Pocket Ledger Server companies are sent to their own server (never Firebase). Progress will
            show at the top of Company Profile until finished. You can also run this from the Sync
            button in the app header.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRunning}
            onClick={(e) => {
              e.preventDefault();
              void runForceUpload();
            }}
          >
            {isRunning ? "Uploading…" : "Start force upload"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
