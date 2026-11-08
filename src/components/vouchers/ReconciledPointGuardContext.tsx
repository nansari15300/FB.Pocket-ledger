"use client";

import React, { createContext, useCallback, useContext, useState, useRef } from "react";
import {
  checkReconciledPointConflict,
  type ReconciledPointCheckParams,
} from "@/lib/reconciliation/reconciledPointGuard";
import { ReconciledPointWarningDialog } from "@/components/vouchers/ReconciledPointWarningDialog";
import usePermissions from "@/hooks/usePermissions";
import { useDate } from "@/hooks/useDate";

type ReconciledPointGuardContextValue = {
  checkAndConfirmReconciledDate: (params: ReconciledPointCheckParams) => Promise<boolean>;
};

const ReconciledPointGuardContext = createContext<ReconciledPointGuardContextValue | null>(null);

export function ReconciledPointGuardProvider({ children }: { children: React.ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    accountName: string;
    reconciledDate: string;
    voucherDate: string;
    canSave: boolean;
  }>({
    open: false,
    accountName: "",
    reconciledDate: "",
    voucherDate: "",
    canSave: true,
  });

  const resolverRef = useRef<((allow: boolean) => void) | null>(null);
  const permissions = usePermissions();
  const { formatDateBySystem } = useDate();

  // User has permission if they are owner, admin, manager, or have backdate privileges
  const canSavePastReconciled = Boolean(
    permissions.role === "owner" ||
    permissions.role === "admin" ||
    permissions.role === "manager" ||
    permissions.canPerformBackdatedAction?.("entry", new Date()) ||
    permissions.canPerformBackdatedAction?.("edit", new Date())
  );

  const checkAndConfirmReconciledDate = useCallback(
    async (params: ReconciledPointCheckParams): Promise<boolean> => {
      const conflict = await checkReconciledPointConflict(params);
      if (!conflict.hasConflict) {
        return true;
      }

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        const recDateStr = conflict.reconciledDate
          ? formatDateBySystem(conflict.reconciledDate)
          : (conflict.reconciledDateFormatted || "");
        const vDateStr = conflict.voucherDate
          ? formatDateBySystem(conflict.voucherDate)
          : (conflict.voucherDateFormatted || "");
        setDialogState({
          open: true,
          accountName: conflict.accountName || "Account",
          reconciledDate: recDateStr,
          voucherDate: vDateStr,
          canSave: canSavePastReconciled,
        });
      });
    },
    [canSavePastReconciled]
  );

  const handleConfirm = () => {
    setDialogState((s) => ({ ...s, open: false }));
    resolverRef.current?.(true);
    resolverRef.current = null;
  };

  const handleCancel = () => {
    setDialogState((s) => ({ ...s, open: false }));
    resolverRef.current?.(false);
    resolverRef.current = null;
  };

  return (
    <ReconciledPointGuardContext.Provider value={{ checkAndConfirmReconciledDate }}>
      {children}
      <ReconciledPointWarningDialog
        open={dialogState.open}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
        accountName={dialogState.accountName}
        reconciledDate={dialogState.reconciledDate}
        voucherDate={dialogState.voucherDate}
        canSave={dialogState.canSave}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ReconciledPointGuardContext.Provider>
  );
}

export function useReconciledPointGuard() {
  return useContext(ReconciledPointGuardContext);
}
