"use client";

import { useMemo } from "react";
import { EditStaffDialog } from "@/components/staff/EditStaffDialog";
import type { Staff } from "@/components/staff/types";
import { useVouchers } from "@/hooks/useVouchers";

/**
 * Controlled shared EditStaffDialog for HR pages (name, contact, account type, group …).
 * HR only opens it; the staff dialog saves through its own normal path.
 */
export function HrEditStaffDialog({
  staffId,
  open,
  onOpenChange,
  onDeleted,
}: {
  staffId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { processedStaff, processedStaffGroups, vouchers, patchMasterEntity } = useVouchers();

  const staff = useMemo(
    () => ((processedStaff || []) as Staff[]).find((s) => s.id === staffId) || null,
    [processedStaff, staffId]
  );

  const hasTransactions = useMemo(() => {
    if (!staffId) return false;
    return (vouchers || []).some((v: { isDeleted?: boolean; entries?: Array<{ accountId?: string }> }) => {
      if (!v || v.isDeleted === true) return false;
      return Array.isArray(v.entries) && v.entries.some((e) => e?.accountId === staffId);
    });
  }, [vouchers, staffId]);

  if (!staff) return null;

  return (
    <EditStaffDialog
      staff={staff}
      allGroups={processedStaffGroups}
      allStaff={processedStaff as Staff[]}
      hasTransactions={hasTransactions}
      isOpen={open}
      onOpenChange={onOpenChange}
      onStaffUpdated={(patch) => {
        const id = patch.id ?? staff.id;
        if (id) patchMasterEntity("staff", id, patch as Record<string, unknown>);
      }}
      onStaffDeleted={() => {
        onOpenChange(false);
        onDeleted?.();
      }}
    >
      {null}
    </EditStaffDialog>
  );
}
