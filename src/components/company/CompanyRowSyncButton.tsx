"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Per-company "Sync" button for Company Selector tabs that do NOT use Data/Files ticks
 * (PocketBase / PL Server / Local with Drive sync). Firebase (Online) tab keeps its ticks.
 *
 * - pocketbase: push this company's pending outbox rows, then pull server changes (pbSync catch-up).
 * - server: refresh the PL Server display cache for this company.
 * - local: run the Google Drive sync cycle (only shown when Drive sync is enabled for the company).
 */
export type CompanyRowSyncKind = "pocketbase" | "server" | "local";

type SyncState = "idle" | "busy" | "ok" | "error";

async function runCompanyRowSync(kind: CompanyRowSyncKind, companyId: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline.");
  }
  if (kind === "pocketbase") {
    const { getValidPocketBaseAuth } = await import("@/lib/pocketbaseData/pbClient");
    if (!getValidPocketBaseAuth()) throw new Error("Sign in to Pocket Ledger Server first.");
    try {
      const { flushVoucherOutbox } = await import("@/lib/localVoucherOutbox");
      await flushVoucherOutbox({ only: { companyId } });
    } catch {
      /* push is best-effort; pull below still runs */
    }
    const { pullPocketBaseCompanyToLocal } = await import("@/lib/pocketbaseData/pbSync");
    await pullPocketBaseCompanyToLocal(companyId);
    return;
  }
  if (kind === "server") {
    const { refreshPlServerDisplayCacheCompany } = await import("@/lib/plServerDisplayCache");
    const r = await refreshPlServerDisplayCacheCompany(companyId);
    if (!r.ok) throw new Error("Server sync failed.");
    return;
  }
  const { runLocalCloudSyncCycle } = await import("@/lib/localCloudSync/engine");
  const r = await runLocalCloudSyncCycle(companyId);
  if (!r.ok) throw new Error(r.error || "Drive sync failed.");
}

export function CompanyRowSyncButton({
  company,
  kind,
  className,
  onGuard,
}: {
  company: { id: string; cloudSyncEnabled?: boolean };
  kind: CompanyRowSyncKind;
  className?: string;
  /** Called on pointer-down/click so a parent dropdown row does not also select the company. */
  onGuard?: () => void;
}) {
  const companyId = String(company.id || "").trim();
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const finish = useCallback((next: SyncState, msg: string) => {
    if (!aliveRef.current) return;
    setState(next);
    setMessage(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!aliveRef.current) return;
      setState("idle");
      setMessage("");
    }, 3000);
  }, []);

  const onClick = useCallback(async () => {
    if (state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      await runCompanyRowSync(kind, companyId);
      finish("ok", "Synced");
    } catch (e) {
      finish("error", e instanceof Error && e.message ? e.message : "Sync failed");
    }
  }, [companyId, finish, kind, state]);

  // Local companies: only those with Drive sync enabled have a manual sync to run.
  if (!companyId || (kind === "local" && company.cloudSyncEnabled !== true)) return null;

  const title =
    state === "busy" ? "Syncing..." : state === "ok" ? "Synced" : state === "error" ? message || "Sync failed" : "Sync now";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-pl-company-logout=""
      className={cn("h-7 w-7 shrink-0", className)}
      title={title}
      aria-label={title}
      disabled={state === "busy"}
      onPointerDown={(e) => {
        e.stopPropagation();
        onGuard?.();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onGuard?.();
        void onClick();
      }}
    >
      {state === "busy" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "ok" ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : state === "error" ? (
        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}