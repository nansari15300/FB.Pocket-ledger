/** Check mode — marked row message in empty Dr/Cr column. */
export const STATEMENT_CHECKED_ROW_MESSAGE = "up to here Reconciled";

/** Info popover — formal help text for the (i) icon beside the matched label. */
export const STATEMENT_CHECKED_ROW_INFO_TITLE = "Reconciled";

export const STATEMENT_CHECKED_ROW_INFO_TEXT =
  "After reconciling a ledger against the counterparty statement, mark the row up to which accounts have been verified as Statement Checked. This records that entries on or before that transaction are already matched, so you do not need to review earlier transactions or statement dates again. Continue reconciliation from the transactions after the marked row.";

/** 3 blinks within 1s (globals.css `pl-statement-checked-blink-continuous`). */
export const STATEMENT_CHECKED_ROW_MESSAGE_CLASS =
  "pl-statement-checked-msg text-sm font-semibold italic leading-snug text-emerald-900 dark:text-emerald-200 whitespace-nowrap shrink-0";

export function statementCheckedMessageColumn(
  debit: number,
  credit: number
): "debit" | "credit" | null {
  const d = Math.abs(Number(debit) || 0);
  const c = Math.abs(Number(credit) || 0);
  if (d < 1e-6 && c < 1e-6) return "debit";
  if (d < 1e-6) return "debit";
  if (c < 1e-6) return "credit";
  return null;
}
