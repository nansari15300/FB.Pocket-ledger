/** Opening Balance row edit inside Balance Sheet / Trial Balance ledger popup — z-index + dismiss guard. */

import { cn } from "@/lib/utils";

export type MasterEditPresentationMode = "default" | "nested-ledger";

export const NESTED_LEDGER_MASTER_EDIT_BACKDROP_CN =
  "fixed inset-0 bg-black/45 backdrop-blur-sm z-[100] pointer-events-auto";

export const NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN = "!z-[100]";

export const NESTED_LEDGER_MASTER_EDIT_CONTENT_CN = "!z-[101]";

/** Dialog `!z-[101]` se upar — date/group popovers (calendar Pick a date). */
export const NESTED_LEDGER_MASTER_EDIT_POPOVER_CN = "!z-[110]";

/** Balance Sheet / R&P ledger mirror shell — above normal dialogs (z-50). */
export const NESTED_LEDGER_POPUP_OVERLAY_CN = "z-[70] bg-black/45 backdrop-blur-none";
export const NESTED_LEDGER_POPUP_CONTENT_CN = "z-[71]";
/** `DialogContent` marker — globals.css footer dropdown/select/popover z-index lift. */
export const NESTED_LEDGER_POPUP_ATTR = "data-pl-nested-ledger-popup";
/** Footer Columns / By Date / rows-per-page — above z-[71] shell. */
export const NESTED_LEDGER_FOOTER_DROPDOWN_CONTENT_CN = "!z-[110]";

/** Note / voucher / history opened inside ledger mirror popup — above z-[71] shell. */
export const NESTED_LEDGER_CHILD_DIALOG_OVERLAY_CN =
  "!z-[100] bg-black/45 backdrop-blur-sm";
export const NESTED_LEDGER_CHILD_DIALOG_CONTENT_CN = "!z-[101]";

export function nestedLedgerChildDialogShell(
  ...extraContentClass: (string | undefined | false | null)[]
) {
  return {
    overlayClassName: NESTED_LEDGER_CHILD_DIALOG_OVERLAY_CN,
    className: cn(NESTED_LEDGER_CHILD_DIALOG_CONTENT_CN, ...extraContentClass),
  };
}

export function masterEditBackdropClassName(
  mode?: MasterEditPresentationMode
): string {
  return mode === "nested-ledger"
    ? NESTED_LEDGER_MASTER_EDIT_BACKDROP_CN
    : "fixed inset-0 bg-black/45 backdrop-blur-sm z-40";
}

export function masterEditPopoverContentClassName(
  mode?: MasterEditPresentationMode,
  ...extra: (string | undefined | false | null)[]
): string {
  return cn(
    // "default" = master add/edit opened from a voucher: its shell is now z-[121], so the old z-[102]
    // rendered the calendar UNDER the form (the "Pick a date" button looked dead). Keep it above z-[125].
    mode === "nested-ledger" ? NESTED_LEDGER_MASTER_EDIT_POPOVER_CN : "!z-[126]",
    ...extra
  );
}

/** Radix outside dismiss — nested ledger popup ke neeche table click-through band. */
export function guardMasterEditOutsideDismiss(
  mode: MasterEditPresentationMode | undefined,
  e: { preventDefault: () => void },
  nestedSubDialogOpen?: boolean
) {
  if (nestedSubDialogOpen) {
    e.preventDefault();
    return;
  }
  if (mode === "nested-ledger") {
    e.preventDefault();
  }
}
