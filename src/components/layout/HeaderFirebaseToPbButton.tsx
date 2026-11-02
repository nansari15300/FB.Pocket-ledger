"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HardDriveUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCompany } from "@/hooks/useCompany";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { BROWSER_DB_COLLECTION_BUMP, type BrowserDbCollectionBumpDetail } from "@/lib/localCompanyDocMirror";
import {
  FIREBASE_STORAGE_QUOTA_MESSAGE,
  migrateFirebaseVoucherAttachmentsToPb,
  scanFirebaseVoucherAttachmentUrls,
  type FirebaseVoucherMigrateProgress,
} from "@/lib/migrateFirebaseVoucherAttachmentsToPb";

type DialogState =
  | { kind: "idle" }
  | { kind: "scan"; voucherCount: number; urlCount: number }
  | { kind: "running"; p: FirebaseVoucherMigrateProgress }
  | { kind: "done"; message: string; quota?: boolean }
  | { kind: "error"; message: string; quota?: boolean };

/**
 * Header control: leftover Firebase Storage URLs on transactions → Pocket Ledger Server.
 * Hidden when this company has none. Copy starts only on Start; first hit tests Firebase quota.
 */
export function HeaderFirebaseToPbButton({ className }: { className?: string }) {
  const { companyId, company } = useCompany();
  const { isOnline } = useOnlineStatus();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>({ kind: "idle" });
  const [hasFirebaseUrls, setHasFirebaseUrls] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const companyIdRef = useRef<string | null>(null);
  companyIdRef.current = companyId || null;
  const sessionOk =
    !!companyId &&
    isPocketBaseOnlyAppSession() &&
    !!getValidPocketBaseAuth() &&
    isPocketBaseCompany(companyId, company);

  const refreshHasUrls = useCallback(async () => {
    const cid = companyIdRef.current;
    if (!cid) {
      setHasFirebaseUrls(false);
      return;
    }
    try {
      const scan = await scanFirebaseVoucherAttachmentUrls(cid);
      if (companyIdRef.current === cid) setHasFirebaseUrls(scan.urlCount > 0);
    } catch {
      if (companyIdRef.current === cid) setHasFirebaseUrls(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionOk) {
      setHasFirebaseUrls(false);
      return;
    }
    void refreshHasUrls();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onBump = (e: Event) => {
      const d = (e as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!d || d.companyId !== companyId) return;
      if (d.collection && d.collection !== "vouchers") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshHasUrls();
      }, 1500);
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      if (timer) clearTimeout(timer);
    };
  }, [sessionOk, companyId, refreshHasUrls]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setState({ kind: "idle" });
    void refreshHasUrls();
  }, [refreshHasUrls]);

  const openDialog = useCallback(async () => {
    if (!companyId) return;
    setOpen(true);
    setState({ kind: "idle" });
    try {
      const scan = await scanFirebaseVoucherAttachmentUrls(companyId);
      setHasFirebaseUrls(scan.urlCount > 0);
      setState({ kind: "scan", voucherCount: scan.voucherCount, urlCount: scan.urlCount });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [companyId]);

  const run = useCallback(async () => {
    if (!companyId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState({
      kind: "running",
      p: { phase: "probe", done: 0, total: 1, label: "Testing Firebase Storage connection…" },
    });
    try {
      const result = await migrateFirebaseVoucherAttachmentsToPb(companyId, {
        signal: ac.signal,
        onProgress: (p) => setState({ kind: "running", p }),
      });
      if (ac.signal.aborted) return;
      setState({
        kind: result.quotaExceeded ? "error" : "done",
        message: result.message,
        quota: result.quotaExceeded,
      });
      toast({
        variant: result.quotaExceeded ? "destructive" : undefined,
        title: result.quotaExceeded ? "Firebase Storage" : "Firebase files",
        description: result.message,
      });
      void refreshHasUrls();
    } catch (e) {
      if (ac.signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      const quota = /quota/i.test(message);
      setState({
        kind: "error",
        message: quota ? FIREBASE_STORAGE_QUOTA_MESSAGE : message,
        quota,
      });
      toast({
        variant: "destructive",
        title: quota ? "Firebase Storage" : "Could not move files",
        description: quota ? FIREBASE_STORAGE_QUOTA_MESSAGE : message,
      });
    }
  }, [companyId, toast, refreshHasUrls]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!sessionOk || !hasFirebaseUrls) return null;

  const running = state.kind === "running";
  const pct =
    state.kind === "running" && state.p.total
      ? Math.max(0, Math.min(100, Math.round((state.p.done / state.p.total) * 100)))
      : state.kind === "running" && state.p.phase === "probe"
        ? 8
        : 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("relative h-8 w-8 shrink-0", className)}
        disabled={!isOnline || running}
        onClick={() => void openDialog()}
        title="Move leftover Firebase files on transactions to Pocket Ledger Server"
        aria-label="Move leftover Firebase files to Pocket Ledger Server"
        data-theme-header="firebase-to-pb"
      >
        <HardDriveUpload className={cn("h-4 w-4", running && "animate-pulse")} aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Firebase files</DialogTitle>
            <DialogDescription>
              Copies leftover Firebase Storage links on this company&apos;s transactions to Pocket Ledger
              Server, then replaces those URLs. It only runs when you click Start — not in the background.
            </DialogDescription>
          </DialogHeader>

          {state.kind === "idle" ? (
            <p className="text-sm text-muted-foreground">Looking for leftover Firebase files…</p>
          ) : null}
          {state.kind === "scan" ? (
            <p className="text-sm text-muted-foreground">
              {state.urlCount === 0
                ? "No leftover Firebase files on this company's transactions."
                : `${state.urlCount} Firebase file(s) on ${state.voucherCount} transaction(s). Click Start to copy them.`}
            </p>
          ) : null}
          {state.kind === "running" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{state.p.label}</p>
              <Progress value={pct} />
            </div>
          ) : null}
          {state.kind === "done" ? <p className="text-sm">{state.message}</p> : null}
          {state.kind === "error" ? (
            <p className="text-sm text-destructive">{state.message}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={running}>
              Close
            </Button>
            {state.kind === "scan" && state.urlCount > 0 ? (
              <Button type="button" onClick={() => void run()} disabled={!isOnline || running}>
                Start
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
