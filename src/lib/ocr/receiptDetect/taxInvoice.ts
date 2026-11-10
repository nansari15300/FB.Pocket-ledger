import { squash } from "./genericFields";
import type { ParsedReceipt, ReceiptFormatDetector } from "./types";

/** Identifies a tax invoice / bill so the hook can run the bill parser (line items, VAT). */
export const taxInvoiceDetector: ReceiptFormatDetector = {
  format: "tax_invoice",
  billLike: true,
  detect(text) {
    const all = squash(text);
    if (/c[o0]nnect[il1|]ps/.test(all) || (all.includes("prabhu") && all.includes("paymentreceipt"))) return 0;
    let s = 0;
    if (/\btax\s*invoice\b|कर\s*बीजक|बीजक/i.test(text)) s += 0.5;
    if (/\binvoice\b|\bbill\b/i.test(text)) s += 0.2;
    if (/\bvat\b|मू\.?\s*अ\.?\s*क|13\s*%/i.test(text)) s += 0.2;
    if (/\b(pan|vat\s*no|स्थायी\s*लेखा)\b/i.test(text)) s += 0.15;
    if (/\b(grand\s*total|taxable)\b/i.test(text)) s += 0.1;
    return Math.min(1, s);
  },
  parse(): ParsedReceipt {
    return { sender: {}, beneficiary: {} };
  },
};
