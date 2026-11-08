"use client";

import React, { createContext, useCallback, useContext, useState, useRef } from "react";
import {
  checkReconciledPointConflict,
  type ReconciledPointCheckParams,
  type ReconciledPointConflict,
} from "@/lib/reconciliation/reconciledPointGuard";
import { ReconciledPointWarningDialog } from "@/components/vouchers/ReconciledPointWarningDialog";
import usePermissions from "@/hooks/usePermissions";
import { useDate } from "@/hooks/useDate";
import { useAuth } from "@/hooks/useAuth";
import { persistConflictHistoryEntry } from "@/lib/ledgerStatementCheckPersist";

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
    conflict: ReconciledPointConflict | null;
    params: ReconciledPointCheckParams | null;
  }>({
    open: false,
    accountName: "",
    reconciledDate: "",
    voucherDate: "",
    canSave: true,
    conflict: null,
    params: null,
  });

  const resolverRef = useRef<((allow: boolean) => void) | null>(null);
  const permissions = usePermissions();
  const { formatDateBySystem } = useDate();
  const { user } = useAuth();

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
          conflict,
          params,
        });
      });
    },
    [canSavePastReconciled, formatDateBySystem]
  );

  const handleConfirm = () => {
    // Save conflict history entry
    const { conflict, params } = dialogState;
    if (conflict && params?.companyId) {
      // Gather all contextIds involved
      const contextIds: string[] = [];
      const addId = (id?: string | null) => { if (id && !contextIds.includes(id)) contextIds.push(id); };
      addId(params.partyId);
      addId(params.accountId);
      addId(params.fromAccountId);
      addId(params.toAccountId);
      addId(params.creditAccountId);
      addId(params.debitAccountId);
      addId(params.staffId);
      if (Array.isArray(params.entityIds)) params.entityIds.forEach(addId);

      const byUser = user?.displayName || user?.email || "User";
      const action = params.isDelete ? "delete" : params.isEdit ? "edit" : "new";

      // Extract voucher no from params
      const voucherNo: string | null =
        conflict.voucherNo ||
        (params.newVoucherData as any)?.voucherNo ||
        (params.newVoucherData as any)?.voucherNumber ||
        (params.newVoucherData as any)?.number ||
        (params.existingVoucher as any)?.voucherNo ||
        (params.existingVoucher as any)?.voucherNumber ||
        (params.existingVoucher as any)?.number ||
        null;

      const balanceDelta = typeof conflict.balanceDelta === "number" ? conflict.balanceDelta : null;
      const balanceBefore = typeof conflict.balanceBefore === "number" ? conflict.balanceBefore : null;
      const balanceAfter = typeof conflict.balanceAfter === "number" ? conflict.balanceAfter : null;

      for (const ctxId of contextIds) {
        void persistConflictHistoryEntry(params.companyId, ctxId, {
          at: new Date().toISOString(),
          byUser,
          reconciledDate: dialogState.reconciledDate,
          voucherDate: dialogState.voucherDate,
          accountName: conflict.accountName || dialogState.accountName,
          action,
          balanceBefore,
          balanceDelta,
          balanceAfter,
          voucherNo,
        });
      }
    }

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
