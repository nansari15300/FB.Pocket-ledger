"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
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
import { canSyncCompanyToServer } from "@/lib/localVoucherOutbox";
import { BROWSER_DB_COLLECTION_BUMP, type BrowserDbCollectionBumpDetail } from "@/lib/localCompanyDocMirror";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import {
  countPendingSyncItems,
  syncCompanyNow,
  type SyncCompanyNowResult,
  type SyncNowProgress,
} from "@/lib/syncCompanyNow";
import { pushPbDeepCheckDiffs, runPbDeepCheckScan, type PbDeepCheckResult } from "@/lib/pbDeepCheck";

type DeepState =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "scanning"; p: SyncNowProgress | null }
  | { kind: "result"; result: PbDeepCheckResult }
  | { kind: "pushing"; p: SyncNowProgress | null }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

function pct(p: SyncNowProgress | null): number {
  if (!p || !p.total) return 0;
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
}

/** Header Sync: pushes only what is pending (outbox / local files / dirty root). See the (i) dialog. */
export function HeaderSyncButton({ className }: { className?: string }) {
  const { companyId, company } = useCompany();
  const { isOnline } = useOnlineStatus();
  const { toast } = useToast();
  const [canSync, setCanSync] = useState(false);
  const [isPb, setIsPb] = useState(false);
  const [pending, setPending] = useState(0);
  const [running, setRunning] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [deep, setDeep] = useState<DeepState>({ kind: "idle" });
  const companyIdRef = useRef<string | null>(null);
  companyIdRef.current = companyId || null;

  const deepBusy = deep.kind === "scanning" || deep.kind === "pushing";

  // Company switch: syncable? PocketBase? reset deep check.
  useEffect(() => {
    let cancelled = false;
    setDeep({ kind: "idle" });
    setPending(0);
    if (!companyId) {
      setCanSync(false);
      setIsPb(false);
      return;
    }
    void (async () => {
      const allowed = await canSyncCompanyToServer(companyId);
      if (cancelled) return;
      setCanSync(allowed);
      setIsPb(isPocketBaseCompany(companyId, company));
    })();
    return () => {
      cancelled = true;
    };
    // `company` is intentionally not a dependency: switching company is what re-evaluates this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const refreshPending = useCallback(async () => {
    const cid = companyIdRef.current;
    if (!cid) return;
    const n = await countPendingSyncItems(cid);
    if (companyIdRef.current === cid) setPending(n);
  }, []);

  // Badge: on company switch, on local-mirror writes of THIS company (debounced), and when connectivity changes.
  useEffect(() => {
    if (!companyId || !canSync) return;
    void refreshPending();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onBump = (e: Event) => {
      const d = (e as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!d || d.companyId !== companyId) return;
      // Server pulls never change the outbox count.
      if (d.source === "pl_server_pull") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshPending();
      }, 1500);
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      if (timer) clearTimeout(timer);
    };
  }, [companyId, canSync, isOnline, refreshPending]);

  const runSync = useCallback(async () => {
    if (!companyId || running || deepBusy) return;
    setRunning(true);
    try {
      const r: SyncCompanyNowResult = await syncCompanyNow(companyId);
      switch (r.status) {
        case "in_sync":
          toast({ title: "Already in sync", description: r.message });
          break;
        case "synced":
          toast({ title: "Synced", description: r.message });
          break;
        case "partial":
          toast({ title: "Partly synced", description: r.message });
          break;
        case "offline":
          toast({ title: "Offline", description: r.message });
          break;
        case "signed_out":
          toast({ variant: "destructive", title: "Sign in to the server", description: r.message });
          break;
        case "not_syncable":
          toast({ title: "Nothing to sync", description: r.message });
          break;
        default:
          toast({ variant: "destructive", title: "Sync failed", description: r.message });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
      void refreshPending();
    }
  }, [companyId, running, deepBusy, toast, refreshPending]);

  const startDeepScan = useCallback(async () => {
    if (!companyId) return;
    setDeep({ kind: "scanning", p: null });
    try {
      const result = await runPbDeepCheckScan(companyId, (p) =>
        setDeep((d) => (d.kind === "scanning" ? { kind: "scanning", p } : d))
      );
      setDeep({ kind: "result", result });
    } catch (e) {
      setDeep({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [companyId]);

  const startDeepPush = useCallback(
    async (result: PbDeepCheckResult) => {
      if (!companyId) return;
      setDeep({ kind: "pushing", p: null });
      try {
        const r = await pushPbDeepCheckDiffs(companyId, result, (p) =>
          setDeep((d) => (d.kind === "pushing" ? { kind: "pushing", p } : d))
        );
        const message =
          r.remaining === 0
            ? `${r.sent} record(s) sent to the server. Everything checked is now on the server.`
            : `${r.sent} record(s) sent, ${r.remaining} still waiting${r.failed ? ` (${r.failed} failed)` : ""}. Press Sync again in a moment.`;
        setDeep({ kind: "done", message });
        toast({ title: r.remaining === 0 ? "Deep check pushed" : "Deep check partly pushed", description: message });
      } catch (e) {
        setDeep({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        void refreshPending();
      }
    },
    [companyId, toast, refreshPending]
  );

  if (!companyId || !canSync) return null;

  const badge = pending > 99 ? "99+" : String(pending);
  const title = running
    ? "Syncing..."
    : !isOnline
      ? "Offline - changes stay queued"
      : pending > 0
        ? `Sync now - ${pending} change(s) waiting`
        : "Sync now - pushes only what is pending";

  return (
    <>
      <div className={cn("flex shrink-0 items-center gap-0.5", className)} data-theme-header="sync-button">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 shrink-0"
          disabled={!isOnline || running || deepBusy}
          onClick={() => void runSync()}
          title={title}
          aria-label="Sync now"
        >
          <RefreshCw className={cn("h-4 w-4", (running || deepBusy) && "animate-spin")} aria-hidden />
          {pending > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white"
              aria-hidden
            >
              {badge}
            </span>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          onClick={() => setInfoOpen(true)}
          title="About Sync"
          aria-label="About Sync"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync: what it does</DialogTitle>
            <DialogDescription>
              One click, no need to open Settings. It sends only what is still waiting on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm leading-relaxed">
            <section>
              <h4 className="font-semibold">What it does</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Sends the changes that are queued on this device (vouchers, parties, items, staff, bank accounts and
                  so on) to the server.
                </li>
                <li>Uploads attachments that are still marked as local files, and the company profile if it changed while offline.</li>
                <li>
                  Does not re-read or re-write everything. Records already confirmed on the server are left alone. If
                  nothing is waiting it makes no network request at all.
                </li>
                <li>Pocket Ledger Server companies are sent to their own server, never to Firebase.</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold">When to use it</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>After working offline, once you are back online.</li>
                <li>When the badge number does not go down, or another device does not show your latest entry or file.</li>
                <li>After the server was down or you signed in again.</li>
              </ul>
              <p className="mt-1 text-muted-foreground">
                Normal saving already syncs in the background. This button is a manual push for stuck items. Fast
                double clicks are ignored, and a second press right after a successful sync does nothing.
              </p>
            </section>

            <section>
              <h4 className="font-semibold">Badge and messages</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Amber number on the icon = changes queued on this device that the server has not confirmed yet. No number = everything was sent.</li>
                <li>Spinning icon = sync is running.</li>
                <li>&quot;Already in sync&quot; = nothing was pending, nothing was sent.</li>
                <li>&quot;Synced&quot; = pending items were sent.</li>
                <li>&quot;Partly synced&quot; = some items are still waiting (server busy, retry shortly) or failed.</li>
                <li>&quot;Sync failed&quot; = nothing could be sent. The queue is kept, nothing is lost.</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold">Offline and sign-in</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Offline: the button is disabled. Your changes stay queued and go out when you are online.</li>
                <li>Pocket Ledger Server companies need you to be signed in to the server. If the session expired you will see &quot;Sign in to the server&quot;: sign in again, then press Sync.</li>
                <li>The button only appears for companies that sync to a server. Device-only (local) companies have nothing to sync.</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold">Files that are not on this device</h4>
              <p className="mt-1 text-muted-foreground">
                If a message says some records have files not on this device, the attachment was added on another
                device (or browser data was cleared) before it was uploaded. This device cannot send those bytes.
                Re-attach the file on that voucher or master, or press Sync on the device that still has the file.
              </p>
            </section>

            {isPb ? (
              <section className="rounded-md border p-3">
                <h4 className="font-semibold">Deep check (Pocket Ledger Server only)</h4>
                <p className="mt-1 text-muted-foreground">
                  Use this only if you think something never reached the server and normal Sync says &quot;Already in
                  sync&quot;. It reads a light index of the server (record id and last-edit time only, no contents),
                  compares it with this device and shows what differs. Only records missing on the server, or newer on
                  this device, are sent, and only after you confirm.
                </p>

                {deep.kind === "idle" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={!isOnline || running}
                    onClick={() => setDeep({ kind: "confirm" })}
                  >
                    Deep check
                  </Button>
                ) : null}

                {deep.kind === "confirm" ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-amber-700">
                      This makes more server reads than a normal Sync (one light request per 500 records). Continue?
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void startDeepScan()} disabled={!isOnline}>
                        Start deep check
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDeep({ kind: "idle" })}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {deep.kind === "scanning" || deep.kind === "pushing" ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-muted-foreground">
                      {deep.p?.phase || (deep.kind === "scanning" ? "Starting..." : "Starting upload...")}
                      {deep.p?.detail ? ` (${deep.p.detail})` : ""}
                    </p>
                    <Progress value={pct(deep.p)} />
                  </div>
                ) : null}

                {deep.kind === "result" ? (
                  <div className="mt-2 space-y-2">
                    {deep.result.missing.length + deep.result.newer.length === 0 ? (
                      <>
                        <p>
                          Everything matches. Checked {deep.result.localChecked} record(s) on this device against{" "}
                          {deep.result.serverListed} on the server.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => setDeep({ kind: "idle" })}>
                          Done
                        </Button>
                      </>
                    ) : (
                      <>
                        <p>
                          {deep.result.missing.length + deep.result.newer.length} record(s) differ:{" "}
                          {deep.result.missing.length} missing on the server, {deep.result.newer.length} newer on this
                          device. Send only these to the server?
                        </p>
                        <ul className="max-h-32 overflow-y-auto rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                          {deep.result.sample.map((s) => (
                            <li key={`${s.coll}/${s.id}`}>
                              {s.coll} / {s.id.slice(0, 18)} ({s.reason})
                            </li>
                          ))}
                          {deep.result.missing.length + deep.result.newer.length > deep.result.sample.length ? (
                            <li>
                              ...and {deep.result.missing.length + deep.result.newer.length - deep.result.sample.length} more
                            </li>
                          ) : null}
                        </ul>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!isOnline}
                            onClick={() => void startDeepPush(deep.result)}
                          >
                            Send {deep.result.missing.length + deep.result.newer.length} record(s)
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => setDeep({ kind: "idle" })}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {deep.kind === "done" ? (
                  <div className="mt-2 space-y-2">
                    <p>{deep.message}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeep({ kind: "idle" })}>
                      Done
                    </Button>
                  </div>
                ) : null}

                {deep.kind === "error" ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-destructive">{deep.message}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeep({ kind: "idle" })}>
                      Close
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInfoOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}