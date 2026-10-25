import type { ParsedReceipt, ReceiptAccountSide, ReceiptFormatDetector } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const amt = (s?: string) => { if (!s) return undefined; const n = Number(s.replace(/[^0-9.]/g, "")); return Number.isFinite(n) && s.match(/\d/) ? n : undefined; };

/** Label regex tolerant to spacing/case/OCR punctuation; value runs to end of line or next known label. */
const LABELS = ["Transaction Id", "Debit Status", "Credit Status", "Transaction Amount", "Charge Amount", "Transaction Date", "Reference Id", "Remarks", "Particulars", "Bank Name", "Bank Branch", "Account No", "Account Name", "Customer Account Details", "Beneficiary Details", "Transaction Details", "For any further"];
const lab = (l: string) => l.split(" ").map((w) => w.split("").join("\\s*")).join("\\s*");
const ANY_LABEL = LABELS.map(lab).join("|");

function field(block: string, label: string): string | undefined {
  const re = new RegExp(`${lab(label)}\\s*\\.?\\s*[:;]?\\s*([^\\n]*?)\\s*(?=(?:[;|]\\s*)?(?:${ANY_LABEL})\\b|\\n|$)`, "i");
  const v = block.match(re)?.[1]?.replace(/^[:;.\s]+|[;|\s]+$/g, "").trim();
  return v || undefined;
}

function sectionSplit(text: string) {
  const c = text.search(/customer\s*account\s*details/i);
  const b = text.search(/beneficiary\s*details/i);
  const f = text.search(/for\s*any\s*further/i);
  const end = f > 0 ? f : text.length;
  return {
    txn: text.slice(0, c > 0 ? c : b > 0 ? b : end),
    customer: c >= 0 ? text.slice(c, b > c ? b : end) : "",
    beneficiary: b >= 0 ? text.slice(b, end) : "",
  };
}

function side(block: string): ReceiptAccountSide {
  return { bankName: field(block, "Bank Name"), branch: field(block, "Bank Branch"), accountMasked: field(block, "Account No"), accountName: field(block, "Account Name") };
}

export const connectIpsDetector: ReceiptFormatDetector = {
  format: "connectips",
  detect(text) {
    const head = squash(text.slice(0, 600));
    const all = squash(text);
    let s = 0;
    if (/c[o0]nnect[il1|]ps/.test(head)) s += 0.5;
    if (head.includes("paymenttransactiondetails")) s += 0.3;
    if (all.includes("customeraccountdetails")) s += 0.1;
    if (all.includes("beneficiarydetails")) s += 0.1;
    return Math.min(1, s);
  },
  parse(text): ParsedReceipt {
    const t = text.replace(/\r/g, "");
    const { txn, customer, beneficiary } = sectionSplit(t);
    return {
      txnId: field(txn, "Transaction Id")?.match(/[A-Za-z0-9-]+/)?.[0],
      amount: amt(field(txn, "Transaction Amount")),
      charge: amt(field(txn, "Charge Amount")),
      date: field(txn, "Transaction Date"),
      referenceId: field(txn, "Reference Id"),
      remarks: field(txn, "Remarks"),
      particulars: field(txn, "Particulars"),
      sender: side(customer),
      beneficiary: side(beneficiary),
    };
  },
};
