import type { OcrField, OcrParsedBill } from "./types";

export type PaymentAmountMode = "fill" | "suggest";

export type PaymentAmountFromBill = {
  value: number;
  source: "amount" | "total";
  confidence: number;
  mode: PaymentAmountMode;
  note?: string;
};

export function isAmountConfident(amount?: OcrField<number>): boolean {
  return !!amount && amount.status === "fill" && amount.value > 0;
}

/** When Payment amount is not confident, use bill Grand Total. Auto-fill only if total itself is fill. */
export function paymentAmountFromBill(
  bill: Pick<OcrParsedBill, "amount" | "total">,
): PaymentAmountFromBill | null {
  if (isAmountConfident(bill.amount)) {
    return {
      value: bill.amount!.value,
      source: "amount",
      confidence: bill.amount!.confidence,
      mode: "fill",
    };
  }
  const t = bill.total;
  if (t && t.value > 0) {
    const fill = t.status === "fill";
    return {
      value: t.value,
      source: "total",
      confidence: t.confidence,
      mode: fill ? "fill" : "suggest",
      note: t.note ?? "Amount taken from Grand Total",
    };
  }
  return null;
}
