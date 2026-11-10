import { parseAmount, parsePhone, squash } from "./genericFields";
import type { ParsedReceipt, ReceiptFormatDetector } from "./types";

/**
 * Handwritten kharcha / cash-payment voucher (e.g. "New Parsa kharcha voucher no 95,
 * miti 19-07-2083, cash paid to Surya Narayan Dhami Rs 2000").
 */
export const handwrittenVoucherDetector: ReceiptFormatDetector = {
  format: "handwritten_voucher",
  detect(text) {
    const all = squash(text);
    let s = 0;
    if (/\bkharcha\b|खर्च/.test(text) || all.includes("kharcha") || all.includes("kharch")) s += 0.4;
    if (/\bvoucher\b|भाउचर|वाउचर/.test(text)) s += 0.25;
    if (/\b(paid\s*to|cash\s*paid|nagd|नगद)\b/i.test(text)) s += 0.25;
    if (/\bmiti\b|मिति/.test(text)) s += 0.15;
    if (/\b(tax\s*invoice|connectips|payment\s*transaction\s*details)\b/i.test(text)) return 0;
    return Math.min(1, s);
  },
  parse(text): ParsedReceipt {
    const t = text.replace(/\r/g, "");
    const voucherNo = t.match(/\bvou(?:cher)?\.?\s*(?:no\.?|#)\s*[:.]?\s*([A-Za-z0-9\-/]+)/i)?.[1]
      ?? t.match(/\bvou(?:cher)?\s*[:.]\s*([A-Za-z0-9\-/]+)/i)?.[1];
    const miti = t.match(/\b(?:miti|मिति)\s*[:.]?\s*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4})/i)?.[1]
      ?? t.match(/\b([0-9]{1,2}[-/.][0-9]{1,2}[-/.]20[0-9]{2})\b/)?.[1];
    const paidTo = t.match(/\b(?:paid\s*to|pay\s*to|to)\s*[:.]?\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .']{2,60})/i)?.[1]?.replace(/\s+(rs|npr|रू|रु)\b.*/i, "").trim();
    const amtLine = t.match(/\b(?:rs\.?|npr|रू\.?|रु\.?)\s*[:.]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i)
      ?? t.match(/\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:rs\.?|npr|रू|रु)\b/i);
    const cash = /\b(cash|nagd|नगद)\b/i.test(t);
    return {
      voucherNo,
      date: miti,
      amount: parseAmount(amtLine?.[1]),
      remarks: undefined,
      particulars: /\bkharcha\b|खर्च/i.test(t) ? "Kharcha" : undefined,
      initiatorPhone: parsePhone(t),
      paymentMode: cash ? "Cash" : undefined,
      sender: { accountName: cash ? "Cash" : undefined, bankName: cash ? "Cash" : undefined },
      beneficiary: { accountName: paidTo },
    };
  },
};
