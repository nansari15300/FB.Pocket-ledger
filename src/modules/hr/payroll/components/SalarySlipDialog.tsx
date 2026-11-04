"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HR_FIELD_SCOPE } from "../../components/HrChrome";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PayrollFiguresEdit } from "../utils/payrollCalc";
import { SalarySlipActions, SalarySlipStatusPill, SalarySlipView, useSalarySlip } from "./SalarySlipView";

export type SalarySlipDialogProps = {
  /** Payroll record app_id (`pay_<employee>_<YYYY-MM>`). */
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unsaved Deductions / Addition of the Payroll row, so the slip matches the row exactly. */
  edit?: PayrollFiguresEdit;
};

/**
 * Salary slip popup for the Payroll table "Slip" button (shared ui/dialog).
 * Header: title + Posted / Draft badge, then Refresh / Print / Download PDF / Close.
 * The body scrolls when the slip is taller than the screen. Print and PDF contain only the slip (SalarySlipView).
 */
export function SalarySlipDialog({ id, open, onOpenChange, edit }: SalarySlipDialogProps) {
  const slip = useSalarySlip(id, edit);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        data-pl-hr-slip-dialog=""
        className={cn(
          "flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0",
          HR_FIELD_SCOPE
        )}
      >
        <DialogHeader className="hr-slip-noprint flex-row flex-wrap items-center gap-2 space-y-0 border-b border-border px-3 py-3 text-left sm:px-4 sm:text-left">
          <DialogTitle>Salary slip</DialogTitle>
          <SalarySlipStatusPill slip={slip} />
          <DialogDescription className="sr-only">Salary slip for the selected employee and month.</DialogDescription>
          <SalarySlipActions slip={slip} className="ml-auto">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                <X className="mr-1 h-4 w-4" />
                Close
              </Button>
            </DialogClose>
          </SalarySlipActions>
        </DialogHeader>
        <div className="scrollbar-slim-dim min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/40 p-3 sm:p-4">
          {slip.company ? (
            <SalarySlipView slip={slip} />
          ) : (
            <p className="text-sm text-muted-foreground">Select a company to use HR.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
