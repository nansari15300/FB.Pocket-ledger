import { cn } from "@/lib/utils";

/** Sab popup dialogs — dim green outer shell (R/P dialog jaisa). */
export const DIALOG_SHELL_ATTR = { "data-pl-dialog-shell": "" } as const;

export const DIALOG_SHELL_BORDER_CN =
  "border border-emerald-300/65 dark:border-emerald-700/45";

export const dialogShellClassName = (...extra: (string | undefined)[]) =>
  cn(DIALOG_SHELL_BORDER_CN, ...extra);

/** AddVoucherDialog (Edit Trxn): overlay z-[80], content z-[81]. */
export const VOUCHER_EDIT_DIALOG_OVERLAY_CN = "z-[80] bg-black/45 backdrop-blur-sm";
export const VOUCHER_EDIT_DIALOG_CONTENT_CN = "z-[81]";

/** Bill/spend wise link popups opened inside Edit Trxn — stack above voucher edit shell. */
export const NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN = "z-[90] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN = "z-[91]";

/** Date/calendar popovers inside voucher add/edit dialog — above content z-[81] and nested link z-[91]. */
export const VOUCHER_DIALOG_CALENDAR_POPOVER_CN = "z-[102]";

/** Reuse company attachment — voucher edit z-[81] ke upar. */
export const NESTED_VOUCHER_ATTACHMENT_REUSE_OVERLAY_CN = "z-[100] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_ATTACHMENT_REUSE_CONTENT_CN = "!z-[101]";

/** Add New master (party/staff/expense/item/account/tax) opened from voucher add/edit — above z-[81] shell AND above
 * the OCR field bubbles (`OCR_LAYER_Z = 100`), so an OCR "Create new" form can never be covered by a bubble. */
export const NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN = "z-[120] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_MASTER_CREATE_CONTENT_CN = "!z-[121]";

/** Add New Group nested inside master add/edit dialog (parent content z-[121]). */
export const NESTED_MASTER_GROUP_DIALOG_OVERLAY_CN = "z-[122] bg-black/45 backdrop-blur-sm";
export const NESTED_MASTER_GROUP_DIALOG_CONTENT_CN = "!z-[123]";

/** AlertDialogs inside voucher add/edit (IC pay mode, change detected, delete confirm) — above master create z-[121]. */
export const NESTED_VOUCHER_ALERT_OVERLAY_CN = "z-[124] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_ALERT_CONTENT_CN = "!z-[125]";

/** Spread onto AlertDialogContent (or small DialogContent) nested inside voucher add/edit. */
export const NESTED_VOUCHER_ALERT_SHELL = {
  overlayClassName: NESTED_VOUCHER_ALERT_OVERLAY_CN,
  className: NESTED_VOUCHER_ALERT_CONTENT_CN,
} as const;

export const nestedVoucherAlertShell = (...extraContentClass: (string | undefined)[]) => ({
  overlayClassName: NESTED_VOUCHER_ALERT_OVERLAY_CN,
  className: cn(NESTED_VOUCHER_ALERT_CONTENT_CN, ...extraContentClass),
});

/** Voucher History opened from Edit Trxn — above nested alerts z-[95]. */
export const NESTED_VOUCHER_HISTORY_OVERLAY_CN = "z-[96] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_HISTORY_CONTENT_CN = "z-[97]";

/** AlertDialogs inside voucher history (delete all history) — above history shell z-[97]. */
export const NESTED_VOUCHER_HISTORY_ALERT_OVERLAY_CN = "z-[98] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_HISTORY_ALERT_CONTENT_CN = "!z-[99]";

/** OCR debug ("Show OCR text") opened inside New Trxn — must sit above the field bubbles (OCR_LAYER_Z = 100). */
export const NESTED_VOUCHER_OCR_DEBUG_OVERLAY_CN = "z-[101] bg-black/45 backdrop-blur-sm";
export const NESTED_VOUCHER_OCR_DEBUG_CONTENT_CN = "!z-[102]";

/**
 * OCR settings gear (New Trxn header) — a top-level modal above everything else in the voucher,
 * INCLUDING the OCR field bubbles / countdown pill (`OCR_LAYER_Z = 100`), so a bubble can never
 * poke into the settings popup. The marker attribute lets the bubble layer hide itself.
 */
export const OCR_SETTINGS_DIALOG_OVERLAY_CN = "z-[2147482998] bg-black/45 backdrop-blur-sm";
export const OCR_SETTINGS_DIALOG_CONTENT_CN = "!z-[2147483000]";

/** Inner boxes / category panels — same dim green tone. */
export const DIALOG_DIM_GREEN_BORDER = DIALOG_SHELL_BORDER_CN;
