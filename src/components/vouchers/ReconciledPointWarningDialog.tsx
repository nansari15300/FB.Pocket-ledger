"use client";

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
import { NESTED_VOUCHER_ALERT_SHELL } from "@/lib/dialogShellChrome";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { getReconciledWarningDialogCopy } from "@/lib/reconciliation/reconciledPointGuard";
import { AlertTriangle, ShieldAlert } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  reconciledDate: string;
  voucherDate: string;
  canSave: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function ReconciledPointWarningDialog({
  open,
  onOpenChange,
  accountName,
  reconciledDate,
  voucherDate,
  canSave,
  onConfirm,
  onCancel,
}: Props) {
  const i18n = usePlI18nOptional();
  const copy = getReconciledWarningDialogCopy(
    i18n?.intro || "en",
    accountName,
    reconciledDate,
    voucherDate,
    i18n?.ui || "en"
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        overlayClassName="!z-[120] bg-black/60 backdrop-blur-sm"
        className="!z-[121] max-w-md border-2 border-amber-500/80 shadow-2xl bg-card text-card-foreground"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{copy.title}</span>
          </AlertDialogTitle>
          <AlertDialogDescription className="text-foreground font-medium pt-1">
            {copy.lead}
          </AlertDialogDescription>
          <AlertDialogDescription className="pt-1.5 leading-relaxed text-muted-foreground">
            {copy.body}
          </AlertDialogDescription>
          {!canSave ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive dark:text-red-300">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{copy.permissionDenied}</span>
            </div>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2 sm:gap-0">
          <AlertDialogCancel onClick={onCancel}>{copy.dontSave}</AlertDialogCancel>
          {canSave ? (
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold dark:bg-amber-700 dark:hover:bg-amber-800"
              onClick={onConfirm}
            >
              {copy.saveAnyway}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
