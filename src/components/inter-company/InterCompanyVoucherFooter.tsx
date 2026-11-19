"use client";

/**
 * Inter Company voucher footer — create par save/approve; edit par Cancel | Delete | History.
 * Delete = is company ki copy only (role/permission); revert/delete-request hata diya.
 */
import { useState } from "react";
import { History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import usePermissions from "@/hooks/usePermissions";
import { VoucherDeleteConfirmAlertDialog } from "@/components/vouchers/VoucherDeleteConfirmAlertDialog";
import {
  VOUCHER_BUTTONS_CLASS,
  BTN_HISTORY_CLASS,
  BTN_PRINT_CLASS,
  BTN_CANCEL_CLASS,
  BTN_SAVE_CLASS,
  BTN_APPROVE_CLASS,
} from "@/components/vouchers/voucherButtonStyles";

export type InterCompanyVoucherFooterProps = {
  inDialog?: boolean;
  voucher?: { id?: string; isApproved?: boolean } | null;
  editingDisabled?: boolean;
  /** Saved voucher — fields view-only after lock; delete still role-gated */
  isEditViewOnly?: boolean;
  isCompanyAdmin?: boolean;
  deleteDisabledWhenLinked?: boolean;
  showHistoryButton?: boolean;
  showApproveButton?: boolean;
  showSaveAndApproveOnCreate?: boolean;
  onOpenHistory?: () => void;
  onApprove?: () => void;
  approveExtraDisabled?: boolean;
  approveBlockedHint?: string | null;
  isApproving?: boolean;
  isLoading?: boolean;
  isFormDirty?: boolean;
  onCancel: () => void;
  /** Is company ki IC copy recycle bin — peer untouched */
  onDelete?: () => void;
  onPermanentDelete?: () => void;
  deleteEntityName?: string;
  onPrint: () => void;
};

export function InterCompanyVoucherFooter({
  inDialog = false,
  voucher,
  editingDisabled = false,
  isEditViewOnly = false,
  isCompanyAdmin = false,
  deleteDisabledWhenLinked = false,
  showHistoryButton = false,
  showApproveButton = false,
  showSaveAndApproveOnCreate = false,
  onOpenHistory,
  onApprove,
  approveExtraDisabled = false,
  approveBlockedHint = null,
  isApproving = false,
  isLoading = false,
  isFormDirty = true,
  onCancel,
  onDelete,
  onPermanentDelete,
  deleteEntityName = "this Inter Company voucher",
  onPrint,
}: InterCompanyVoucherFooterProps) {
  const isMobile = useIsMobile();
  const { canDeleteVoucher } = usePermissions();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const deleteDisabled =
    !voucher?.id ||
    deleteDisabledWhenLinked ||
    !onDelete ||
    (!!voucher && !canDeleteVoucher(voucher));

  const historyDisabled = !voucher?.id || !showHistoryButton || !onOpenHistory;
  const isCreateApproveFlow = showSaveAndApproveOnCreate && !voucher?.id;
  const approveDisabled = isCreateApproveFlow
    ? isEditViewOnly || isLoading || isApproving || editingDisabled || !onApprove
    : isEditViewOnly ||
      editingDisabled ||
      !showApproveButton ||
      !onApprove ||
      isApproving ||
      approveExtraDisabled ||
      (!!voucher?.isApproved && !isFormDirty);
  const approveLabel = isCreateApproveFlow
    ? "Save & Approve"
    : isApproving
      ? "..."
      : isFormDirty
        ? "Save & Approve"
        : "Approve";

  const saveDisabled = isEditViewOnly || isLoading || editingDisabled || (!!voucher?.id && !isFormDirty);
  const printDisabled = isEditViewOnly || isLoading || editingDisabled;

  const deleteButton = onDelete ? (
    <Button
      type="button"
      variant="destructive"
      className={cn("shrink-0 rounded-full", isMobile && !isEditViewOnly && "w-full")}
      disabled={deleteDisabled || isLoading}
      onClick={() => setIsDeleteDialogOpen(true)}
    >
      {!isMobile || isEditViewOnly ? <Trash2 className="mr-2 h-4 w-4" /> : null}
      Delete
    </Button>
  ) : null;

  const deleteConfirmDialog = onDelete ? (
    <VoucherDeleteConfirmAlertDialog
      open={isDeleteDialogOpen}
      onOpenChange={setIsDeleteDialogOpen}
      title="Delete this company's copy?"
      description={
        <>
          Only this company&apos;s Inter Company voucher goes to the recycle bin. The other company keeps
          their copy.
        </>
      }
      entityKind="Inter Company voucher"
      entityName={deleteEntityName}
      onMoveToBin={() => onDelete()}
      onDeletePermanently={onPermanentDelete}
      busy={isLoading}
    />
  ) : null;

  void isCompanyAdmin;
  void inDialog;

  if (isEditViewOnly) {
    return (
      <>
        <div
          className={cn(
            "border-t min-w-0 max-w-full overflow-x-hidden pt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start",
            inDialog ? "mt-[3px] pb-4" : "pb-4",
            VOUCHER_BUTTONS_CLASS
          )}
        >
          <Button type="button" onClick={onCancel} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
            Cancel
          </Button>
          {deleteButton}
          <Button
            type="button"
            onClick={onOpenHistory ?? (() => {})}
            disabled={historyDisabled}
            className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}
          >
            <History className="mr-2 h-4 w-4" /> History
          </Button>
        </div>
        {deleteConfirmDialog}
      </>
    );
  }

  if (isMobile) {
    return (
      <>
        <div
          className={cn(
            "border-t min-w-0 max-w-full overflow-x-hidden",
            inDialog ? "mt-[3px] pt-[3px] pb-[3px]" : "pt-4"
          )}
        >
          <div className={cn("grid grid-cols-3 gap-2 w-full min-w-0", VOUCHER_BUTTONS_CLASS)}>
            {/* Row 0: Delete | History | Save & Print — Sale / Journal mobile jaisa */}
            {onDelete ? (
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                disabled={deleteDisabled || isLoading}
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Delete
              </Button>
            ) : (
              <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">
                —
              </Button>
            )}
            <Button
              type="button"
              onClick={onOpenHistory ?? (() => {})}
              disabled={historyDisabled}
              className={cn("w-full", BTN_HISTORY_CLASS)}
            >
              History
            </Button>
            <Button
              type="button"
              disabled={printDisabled}
              onClick={onPrint}
              className={cn("w-full", BTN_PRINT_CLASS)}
            >
              Save & Print
            </Button>
            {/* Row 1: Cancel | Save | Approve */}
            <Button type="button" onClick={onCancel} className={cn("w-full", BTN_CANCEL_CLASS)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveDisabled} className={cn("w-full", BTN_SAVE_CLASS)}>
              {isLoading ? "..." : "Save"}
            </Button>
            {onApprove ? (
              <Button
                type="button"
                disabled={approveDisabled}
                title={approveBlockedHint || undefined}
                onClick={() => onApprove()}
                className={cn("w-full", BTN_APPROVE_CLASS)}
              >
                {approveLabel}
              </Button>
            ) : (
              <Button type="button" disabled className="w-full bg-muted text-muted-foreground border-0 opacity-50">
                —
              </Button>
            )}
          </div>
        </div>
        {deleteConfirmDialog}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "border-t min-w-0 max-w-full overflow-x-hidden pt-4 flex flex-wrap items-center justify-between gap-2",
          inDialog ? "mt-[3px] pb-4" : "pb-4",
          VOUCHER_BUTTONS_CLASS
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {showHistoryButton ? (
            <Button
              type="button"
              onClick={onOpenHistory ?? (() => {})}
              disabled={historyDisabled}
              className={cn("shrink-0 rounded-full", BTN_HISTORY_CLASS)}
            >
              <History className="mr-2 h-4 w-4" /> History
            </Button>
          ) : null}
          {deleteButton}
          <Button type="button" onClick={onCancel} className={cn("shrink-0 rounded-full", BTN_CANCEL_CLASS)}>
            Cancel
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={printDisabled}
            onClick={onPrint}
            className={cn("shrink-0 rounded-full", BTN_PRINT_CLASS)}
          >
            Save & Print
          </Button>
          <Button type="submit" disabled={saveDisabled} className={cn("shrink-0 rounded-full", BTN_SAVE_CLASS)}>
            {isLoading ? "..." : "Save"}
          </Button>
          {onApprove ? (
            <Button
              type="button"
              disabled={approveDisabled}
              title={approveBlockedHint || undefined}
              onClick={() => onApprove()}
              className={cn("shrink-0 rounded-full", BTN_APPROVE_CLASS)}
            >
              {approveLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {deleteConfirmDialog}
    </>
  );
}
