import { patchVoucherFields, voucherRecycleBinDeletedAt } from "@/lib/voucherActionsClient";

/** Voucher types that participate in edit-mode tab conversion (AddVoucherDialog tabs). */
export type VoucherEditConvertType =
  | "sale"
  | "purchase"
  | "payment_in"
  | "payment_out"
  | "direct_income"
  | "direct_expense"
  | "contra"
  | "journal"
  | "add_salary";

const CASHFLOW_QUARTET: readonly VoucherEditConvertType[] = [
  "payment_in",
  "payment_out",
  "direct_income",
  "direct_expense",
];

type EditConvertBucket = "sale_purchase" | "cashflow_quartet" | "journal_contra" | "other";

function editConvertBucket(t: string): EditConvertBucket {
  if (t === "sale" || t === "purchase") return "sale_purchase";
  if ((CASHFLOW_QUARTET as readonly string[]).includes(t)) return "cashflow_quartet";
  if (t === "journal" || t === "contra") return "journal_contra";
  return "other";
}

export function canEditConvertBetween(stored: string, active: string): boolean {
  const a = editConvertBucket(stored);
  return a !== "other" && a === editConvertBucket(active);
}

export function resolveVoucherConvertSourceType(
  voucher: { type?: string; _sourceVoucherType?: string } | null | undefined
): string {
  const explicit = voucher?._sourceVoucherType;
  if (explicit != null && String(explicit).trim() !== "") return String(explicit).trim();
  return String(voucher?.type || "").trim();
}

/** Active form type ≠ persisted source type, same convert bucket (Sale↔Purchase, etc.). */
export function isVoucherEditConverting(
  voucher: { id?: string; type?: string; _sourceVoucherType?: string } | null | undefined,
  targetFormType: string
): boolean {
  if (!voucher?.id) return false;
  const target = String(targetFormType || "").trim();
  if (!target) return false;
  const source = resolveVoucherConvertSourceType(voucher);
  if (!source || source === target) return false;
  return canEditConvertBetween(source, target);
}

export function getVoucherConvertOriginalId(
  voucher: { id?: string; _sourceVoucherId?: string } | null | undefined
): string | null {
  if (!voucher?.id) return null;
  const src = String((voucher as { _sourceVoucherId?: string })._sourceVoucherId || voucher.id).trim();
  return src || null;
}

export function voucherEditConvertBannerText(opts: {
  sourceTypeLabel: string;
  targetTypeLabel: string;
  sourceVoucherNumber?: string;
}): string {
  const no = String(opts.sourceVoucherNumber || "").trim();
  const from = no ? `${opts.sourceTypeLabel} ${no}` : opts.sourceTypeLabel;
  return `This voucher is converting from ${from} to ${opts.targetTypeLabel}.`;
}

export type VoucherEditConvertPresentation = {
  isConverting: boolean;
  sourceType: string;
  targetType: string;
  sourceVoucherNumber: string;
  bannerText: string;
};

const VOUCHER_EDIT_CONVERT_TYPE_LABEL: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  payment_in: "Receipt",
  payment_out: "Payment",
  direct_income: "Direct Income",
  direct_expense: "Direct Expense",
  contra: "Contra",
  journal: "Journal",
  add_salary: "Add Salary",
};

export function voucherEditConvertTypeLabel(type: string): string {
  const key = String(type || "").trim();
  return VOUCHER_EDIT_CONVERT_TYPE_LABEL[key] || key.replace(/_/g, " ");
}

export function getVoucherEditConvertPresentation(
  voucher: Record<string, unknown> | undefined | null,
  activeTab: string,
  typeLabel: (t: string) => string = voucherEditConvertTypeLabel
): VoucherEditConvertPresentation | null {
  if (!voucher?.id) return null;
  if (!isVoucherEditConverting(voucher as { id?: string; type?: string; _sourceVoucherType?: string }, activeTab)) {
    return null;
  }
  const sourceType = resolveVoucherConvertSourceType(voucher as { type?: string; _sourceVoucherType?: string });
  const sourceVoucherNumber = String(voucher.voucherNumber ?? voucher.voucherNo ?? "").trim();
  const targetType = activeTab;
  return {
    isConverting: true,
    sourceType,
    targetType,
    sourceVoucherNumber,
    bannerText: voucherEditConvertBannerText({
      sourceTypeLabel: typeLabel(sourceType),
      targetTypeLabel: typeLabel(targetType),
      sourceVoucherNumber,
    }),
  };
}

/** Banner checkbox: original ids the user chose to KEEP (not move to bin) on convert save. Default (absent) = move to bin. */
const keepConvertedSourceVoucherIds = new Set<string>();

export function setVoucherConvertSourceMoveToBin(originalVoucherId: string, moveToBin: boolean): void {
  if (!originalVoucherId) return;
  if (moveToBin) keepConvertedSourceVoucherIds.delete(originalVoucherId);
  else keepConvertedSourceVoucherIds.add(originalVoucherId);
}

export function shouldMoveVoucherConvertSourceToBin(originalVoucherId: string): boolean {
  return !keepConvertedSourceVoucherIds.has(originalVoucherId);
}

/** Source id of the convert banner currently mounted (lets the confirm dialog read the same checkbox choice). */
let activeConvertSourceVoucherId: string | null = null;
export function setActiveVoucherConvertSourceId(id: string | null): void {
  activeConvertSourceVoucherId = id;
}
export function getActiveVoucherConvertSourceId(): string | null {
  return activeConvertSourceVoucherId;
}
/** After new voucher saved: mark original in recycle bin with converted metadata. */
export async function markVoucherConvertedInRecycleBin(
  companyId: string,
  originalVoucherId: string,
  meta: {
    convertedToType: string;
    convertedToVoucherNumber?: string;
    convertedToVoucherId?: string;
    deletedBy?: string;
  }
): Promise<void> {
  if (!shouldMoveVoucherConvertSourceToBin(originalVoucherId)) return;
  await patchVoucherFields(companyId, originalVoucherId, {
    isDeleted: true,
    deletedAt: voucherRecycleBinDeletedAt(),
    ...(meta.deletedBy ? { deletedBy: meta.deletedBy } : {}),
    convertedToType: meta.convertedToType,
    convertedToVoucherNumber: meta.convertedToVoucherNumber ?? "",
    ...(meta.convertedToVoucherId ? { convertedToVoucherId: meta.convertedToVoucherId } : {}),
  });
}
