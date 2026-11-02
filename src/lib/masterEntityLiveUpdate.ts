/** Master entity list/detail — live UI patch helpers (party, staff, bank, tax, item). */

export type MasterEntityPatchCollection =
  | "parties"
  | "staff"
  | "bank_accounts"
  | "taxes"
  | "items"
  | "expense_accounts"
  | "expense_groups";

/** Fingerprint me profile/attachment fields — `entityListUiFingerprint` stale UI skip fix. */
export function masterEntityProfileUiFields(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const docs = Array.isArray(row.documentFileUrls) ? row.documentFileUrls : [];
  const fileUrls = Array.isArray(row.fileUrls) ? row.fileUrls : [];
  /** Live list fingerprint me edit-critical flags include — tab move/filter turant re-render ho. */
  const useFor = row.useFor && typeof row.useFor === "object" ? JSON.stringify(row.useFor) : "";
  return [
    String(row.name ?? ""),
    String(row.accountName ?? ""),
    String(row.aliasName ?? ""),
    String(row.email ?? ""),
    String(row.phone ?? ""),
    String(row.accountType ?? ""),
    String(row.groupId ?? ""),
    String(row.parentId ?? ""),
    String(row.openingBalance ?? ""),
    String(row.openingBalanceDate ?? ""),
    String(row.openingBalanceNarration ?? ""),
    String(row.isSpecial ?? ""),
    String(row.isClearing ?? ""),
    String(row.allowVoucherMinusBalance ?? ""),
    String(row.isFrozen ?? ""),
    String(row.freezeMessage ?? ""),
    useFor,
    String(row.fileUrl ?? ""),
    String(row.avatarUrl ?? ""),
    `${docs.length}:${docs.filter((u): u is string => typeof u === "string").join("\x1e")}`,
    `${fileUrls.length}:${fileUrls.filter((u): u is string => typeof u === "string").join("\x1e")}`,
  ].join("\x1d");
}

/** Master-detail `selected` ko vouchers context ki latest processed row se merge karo. */
export function resolveMasterListSelection<T extends { id: string }>(
  selected: T | null,
  processed: readonly T[] | undefined
): T | null {
  if (!selected) return null;
  return processed?.find((x) => x.id === selected.id) ?? selected;
}

const LIVE_SELECTION_ATTACHMENT_KEYS = ["fileUrl", "avatarUrl", "documentFileUrls", "fileUrls"] as const;

/**
 * Merge live list row into `selected` and ALWAYS converge: attachment keys are taken from the live row
 * (even when absent there = removed), and if the merge would not change the profile fingerprint of
 * `selected` this returns null (caller must skip setState). Prevents the
 * "selected !== live fingerprint forever -> setSelected -> effect -> setSelected" infinite loop
 * (Maximum update depth exceeded) when the live row omits keys that `selected` still carries.
 */
export function mergeLiveMasterSelection<T extends Record<string, unknown>>(
  selected: T,
  live: T
): T | null {
  const merged: Record<string, unknown> = { ...selected, ...live };
  for (const k of LIVE_SELECTION_ATTACHMENT_KEYS) merged[k] = (live as Record<string, unknown>)[k];
  if (
    masterEntityProfileUiFields(merged) === masterEntityProfileUiFields(selected as Record<string, unknown>)
  ) {
    return null;
  }
  return merged as T;
}