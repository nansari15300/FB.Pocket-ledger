import { parseGenericFields, squash } from "./genericFields";
import type { ParsedReceipt, ReceiptFormatDetector } from "./types";

/** Catch-all for bank slips that are not connectIPS or a known bank template. */
export const genericBankDetector: ReceiptFormatDetector = {
  format: "generic_bank",
  detect(text) {
    const all = squash(text);
    // Let specific detectors win; this is a fallback.
    if (/c[o0]nnect[il1|]ps/.test(all) || all.includes("prabhu") && all.includes("paymentreceipt")) return 0;
    let s = 0;
    if (all.includes("transaction") && (all.includes("amount") || all.includes("npr"))) s += 0.25;
    if (all.includes("account") && (all.includes("beneficiary") || all.includes("sender") || all.includes("receiver"))) s += 0.3;
    if (all.includes("status") && (all.includes("success") || all.includes("failed") || all.includes("fail"))) s += 0.1;
    if (/\b(fund\s*transfer|ips|nchl|fonepay|esewa|khalti)\b/i.test(text)) s += 0.15;
    return Math.min(0.85, s);
  },
  parse(text): ParsedReceipt {
    return parseGenericFields(text.replace(/\r/g, ""));
  },
};
