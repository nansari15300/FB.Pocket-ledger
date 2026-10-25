"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import usePermissions from "@/hooks/usePermissions";
import { MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS } from "@/lib/masterDialogFooterStyles";
import { cn } from "@/lib/utils";

export type MasterDeleteConfirmAlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityName: ReactNode;
  /** e.g. account, party, voucher, note */
  entityKind?: string;
  description?: ReactNode;
  onMoveToBin: () => void | Promise<void>;
  onDeletePermanently?: () => void | Promise<void>;
  busy?: boolean;
  moveToBinDisabled?: boolean;
  permanentDeleteDisabled?: boolean;
  contentClassName?: string;
  overlayClassName?: string;
  title?: string;
  /** When set, dialog checks on open whether the doc was never synced (local-only => permanent local delete only). */
  localOnlyCheck?: { companyId?: string | null; collectionName: string; docId?: string | null } | null;
};

export function useCanPermanentDeleteFromForm(): boolean {
  const { can, role } = usePermissions();
  return role === "owner" || can("permanently_delete_records");
}

export function MasterDeleteConfirmAlertDialogContent({
  entityName,
  entityKind = "record",
  description,
  onMoveToBin,
  onDeletePermanently,
  busy = false,
  moveToBinDisabled = false,
  permanentDeleteDisabled = false,
  title = "Are you absolutely sure?",
  localOnlyCheck = null,
}: Omit<
  MasterDeleteConfirmAlertDialogProps,
  "open" | "onOpenChange" | "contentClassName" | "overlayClassName"
>) {
  const canPermanent = useCanPermanentDeleteFromForm() && !!onDeletePermanently;
  const lcCompanyId = String(localOnlyCheck?.companyId || "").trim();
  const lcCollection = String(localOnlyCheck?.collectionName || "").trim();
  const lcDocId = String(localOnlyCheck?.docId || "").trim();
  const wantsCheck = Boolean(lcCompanyId && lcCollection && lcDocId);
  const [syncState, setSyncState] = useState<"idle" | "checking" | "local" | "synced">(
    wantsCheck ? "checking" : "idle"
  );
  const [stage, setStage] = useState<null | "permanent" | "bin">(null);
  /** Check runs once per open (content mounts per open) + doc key; parent re-renders do not re-run it. */
  const checkedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!wantsCheck) {
      setSyncState("idle");
      return;
    }
    const key = `||`;
    if (checkedKeyRef.current === key) return;
    checkedKeyRef.current = key;
    let alive = true;
    setSyncState("checking");
    void import("@/lib/localOnlyHardDelete")
      .then(({ explainNeverSyncedLocalDoc }) => explainNeverSyncedLocalDoc(lcCompanyId, lcCollection, lcDocId))
      .then((r) => {
        if (alive) setSyncState(r.ok ? "local" : "synced");
      })
      .catch(() => {
        if (alive) setSyncState("synced");
      });
    return () => {
      alive = false;
      // StrictMode/dev double-mount: allow the re-mounted effect to run again.
      checkedKeyRef.current = null;
    };
  }, [wantsCheck, lcCompanyId, lcCollection, lcDocId]);

  const isLocal = syncState === "local";
  const checking = syncState === "checking";
  const isVoucher = lcCollection === "vouchers";
  const localText = isVoucher
    ? "This voucher is only on this device (not synced online). Deleting will remove it permanently."
    : "This record is only on this device (not synced online). Deleting will remove it permanently.";
  // Local-only: permanent (local) delete is the only option, also for non-admins.
  const showPermanentDelete = canPermanent || isLocal;
  const binDisabled = busy || checking || moveToBinDisabled || isLocal;

  const run = (fn: () => void | Promise<void>) => {
    void fn();
  };

  const confirmPermanent = () => {
    if (isLocal) {
      void import("@/lib/localOnlyHardDelete").then(({ armLocalOnlyHardDeleteIntent }) => {
        armLocalOnlyHardDeleteIntent(lcCompanyId, lcCollection, lcDocId);
        // Admin => existing permanent handler (its toast/close); others => move-to-bin handler (same local hook).
        run(canPermanent ? onDeletePermanently! : onMoveToBin);
      });
      return;
    }
    run(onDeletePermanently!);
  };

  const name = <span className="font-semibold text-foreground">{entityName}</span>;
  const stageText =
    stage === "bin" ? (
      description ?? (
        <>
          This action will move the {entityKind} {name} to the recycle bin.
        </>
      )
    ) : stage === "permanent" ? (
      isLocal ? (
        <>{localText}</>
      ) : (
        <>
          This will permanently delete the {entityKind} {name}. This cannot be undone.
        </>
      )
    ) : null;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-1">
            {checking ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking…
              </span>
            ) : null}
            {stageText ? <p>{stageText}</p> : null}
            {isLocal && stage !== "permanent" ? (
              <p className="text-amber-700 dark:text-amber-400">{localText}</p>
            ) : null}
            {!checking && !stageText && !isLocal ? <span className="sr-only">Choose an action.</span> : null}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter
        className={cn(
          "gap-2",
          showPermanentDelete && !stage ? "flex-col sm:flex-row sm:flex-wrap sm:justify-end" : undefined
        )}
      >
        {stage ? (
          <>
            <Button
              type="button"
              variant="outline"
              className={cn(MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS, "sm:mr-auto")}
              disabled={busy}
              onClick={() => setStage(null)}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || checking}
              onClick={() => (stage === "permanent" ? confirmPermanent() : run(onMoveToBin))}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {stage === "permanent" ? "Confirm delete" : "Confirm move"}
            </Button>
          </>
        ) : (
          <>
            <AlertDialogCancel
              className={cn(MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS, showPermanentDelete && "sm:mr-auto")}
              disabled={busy}
            >
              Cancel
            </AlertDialogCancel>
            {showPermanentDelete ? (
              <Button
                type="button"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                disabled={busy || checking || permanentDeleteDisabled}
                onClick={() => setStage("permanent")}
              >
                Delete permanently
              </Button>
            ) : null}
            <span
              className="inline-flex"
              title={
                isLocal
                  ? "Not available: this was never synced online, so it cannot go to the recycle bin. Use Delete permanently."
                  : undefined
              }
            >
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                disabled={binDisabled}
                onClick={() => setStage("bin")}
              >
                Move to Bin
              </Button>
            </span>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}
export function MasterDeleteConfirmAlertDialog({
  open,
  onOpenChange,
  contentClassName,
  overlayClassName,
  ...contentProps
}: MasterDeleteConfirmAlertDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent overlayClassName={overlayClassName} className={contentClassName}>
        <MasterDeleteConfirmAlertDialogContent {...contentProps} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
