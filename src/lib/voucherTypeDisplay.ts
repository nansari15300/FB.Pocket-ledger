/**
 * Display-only labels for raw voucher type ids.
 * The ids themselves (e.g. "payment_in") are stored data and must never change;
 * only the text the user sees is mapped here.
 */
const VOUCHER_TYPE_DISPLAY_OVERRIDES: Record<string, string> = {
  payment_in: "receipt",
};

/** Lower-case display text for a voucher type id ("payment_in" -> "receipt", "payment_out" -> "payment out"). */
export function voucherTypeDisplayText(type: unknown): string {
  if (typeof type !== "string") return type == null ? "" : String(type);
  return VOUCHER_TYPE_DISPLAY_OVERRIDES[type] ?? type.replace(/_/g, " ");
}

/** Lower-case search text: the display label plus the old spaced id, so searching "payment in" still finds receipts. */
export function voucherTypeSearchText(type: unknown): string {
  if (typeof type !== "string") return "";
  const display = voucherTypeDisplayText(type).toLowerCase();
  const legacy = type.replace(/_/g, " ").toLowerCase();
  return display === legacy ? display : `${display} ${legacy}`;
}
