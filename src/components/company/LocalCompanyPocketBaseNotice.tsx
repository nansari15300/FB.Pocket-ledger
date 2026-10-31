"use client";

import { useState } from "react";
import Link from "next/link";
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
} from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { canUploadOneMoreOnline } from "@/lib/companyOnlineSlots";
import {
  isLocalOnlyCompanyForPbUpgrade,
  isPocketBaseLoginActive,
  makeLocalCompanyOnlinePocketBase,
} from "@/lib/makeLocalCompanyOnlinePocketBase";

/**
 * Company Profile header notice: current company is device-local and the user is logged in to
 * Pocket Ledger Server -> offer "Make online on PocketBase" (upload, then flip the company).
 */
export function LocalCompanyPocketBaseNotice() {
  const { company, companyId, allCompanies, triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const { user, customUser } = useAuth();
  const { toast } = useToast();
  const livePlans = useLivePlans();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ label: string; detail: string } | null>(null);

  const isOwner =
    !!company &&
    !!user &&
    (company.ownerId === user.uid ||
      (!!company.ownerEmail &&
        !!user.email &&
        company.ownerEmail.toLowerCase() === user.email.toLowerCase()));

  const accountPlanId = resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId);
  const accountPlanLive = getPlanFromPlans(livePlans, accountPlanId);
  const { ok: slotOk, max, current } = canUploadOneMoreOnline(
    allCompanies,
    accountPlanId,
    companyId || "",
    user?.uid ?? null,
    accountPlanLive
  );

  if (!company || !companyId || !user || !isOwner) return null;
  if (!isPocketBaseLoginActive(user)) return null;
  if (!isLocalOnlyCompanyForPbUpgrade(company as unknown as Record<string, unknown>)) return null;

  const run = async () => {
    if (running) return;
    if (!slotOk) {
      toast({
        variant: "destructive",
        title: "Online slots full",
        description: `Your plan allows ${max} online compan${max === 1 ? "y" : "ies"}. Upgrade or keep this company local.`,
      });
      return;
    }
    setOpen(false);
    setRunning(true);
    setProgress({ label: "Starting", detail: "" });
    try {
      const res = await makeLocalCompanyOnlinePocketBase({
        companyId,
        user: { uid: user.uid, email: user.email ?? null },
        isSuperAdmin: customUser?.role === "SuperAdmin",
        superAdminEmail: customUser?.email ?? null,
        onProgress: (label, detail) => setProgress({ label, detail }),
      });
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Could not make company online",
          description: `${res.message || "Upload failed."} The company is still local.`,
        });
        return;
      }
      reloadLocalCompanyRegistry();
      triggerSync();
      const parts = [`${res.uploaded} record(s) uploaded`];
      if (res.attachments > 0) parts.push(`${res.attachments} file(s) uploaded`);
      if (res.missingLocalFiles > 0) {
        parts.push(
          `${res.missingLocalFiles} local file(s) were not found on this device and were not uploaded`
        );
      }
      toast({
        variant: res.missingLocalFiles > 0 ? "destructive" : "default",
        title: "Company is now online on PocketBase",
        description: `${parts.join(" · ")}.`,
      });
      if (res.missingLocalFiles > 0) {
        console.warn("[makeLocalCompanyOnlinePocketBase] missing local files", res.missingSample);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not make company online",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div
      className="mt-3 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/90 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="min-w-0">
        <p className="font-medium">This company is on local only.</p>
        <p className="text-xs opacity-90">
          {running && progress
            ? `${progress.label}${progress.detail ? ` — ${progress.detail}` : ""}`
            : `Upload it to Pocket Ledger Server (PocketBase) to use it online. Plan: ${
                Number.isFinite(max) ? max : "unlimited"
              } online slot${max === 1 ? "" : "s"}, using ${current}.`}
        </p>
        {!slotOk && !running ? (
          <p className="mt-1 text-xs">
            {max === 0 ? "Your plan has no online companies. " : "Online slots are full. "}
            <Link href="/billing" className="font-medium underline">
              Upgrade
            </Link>
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        disabled={running || !slotOk || (typeof navigator !== "undefined" && !navigator.onLine)}
        onClick={() => setOpen(true)}
      >
        {running ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <CloudUpload className="mr-1.5 h-4 w-4" />
        )}
        Make online on PocketBase
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this company online on PocketBase?</AlertDialogTitle>
            <AlertDialogDescription>
              All masters, vouchers and files of &quot;{company.name}&quot; are uploaded to Pocket Ledger
              Server first. Only after the upload succeeds, the company is switched from local to
              PocketBase online. If anything fails, the company stays local. Keep this page open until it
              finishes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={running} onClick={() => void run()}>
              Upload and make online
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}