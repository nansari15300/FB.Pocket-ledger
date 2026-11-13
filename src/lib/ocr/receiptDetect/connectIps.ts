import type { ParsedReceipt, ReceiptAccountSide, ReceiptFormatDetector } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const amt = (s?: string) => { if (!s) return undefined; const n = Number(s.replace(/[^0-9.]/g, "")); return Number.isFinite(n) && s.match(/\d/) ? n : undefined; };
/** Detector floor (see MIN_CONF in index.ts) — an AI summary of the slip must clear it too. */
const MIN_CONNECTIPS_CONF = 0.45;
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
    // AI summary of a connectIPS slip (no full paper text): "MODE OF PAYMENT : connectIPS" / PARTY NAME + GRAND TOTAL.
    // Without this the scan fell through to the bill parser and the money voucher was never filled.
    if (s > 0 && s < MIN_CONNECTIPS_CONF && /(party\s*name|grand\s*total|mode\s*of\s*payment)/i.test(text)) s = Math.max(s, MIN_CONNECTIPS_CONF);
    return Math.min(1, s);
  },
  parse(text): ParsedReceipt {
    const t = text.replace(/\r/g, "");
    const { txn, customer, beneficiary } = sectionSplit(t);
    const parsed: ParsedReceipt = {
      txnId: field(txn, "Transaction Id")?.match(/[A-Za-z0-9-]+/)?.[0],
      amount: amt(field(txn, "Transaction Amount")),
      charge: amt(field(txn, "Charge Amount")),
      date: field(txn, "Transaction Date"),
      referenceId: field(txn, "Reference Id"),
      remarks: field(txn, "Remarks"),
      particulars: field(txn, "Particulars"),
      status: field(txn, "Debit Status") || field(txn, "Credit Status"),
      sender: side(customer),
      beneficiary: side(beneficiary),
    };
    // AI summary of the slip (fields come from Gemini's JSON, not the paper): PARTY NAME / INVOICE DATE /
    // MODE OF PAYMENT / GRAND TOTAL. Fill only what the full-paper parse left empty.
    const summary = (label: string) => {
      const L = label.replace(/\s+/g, "\\s+");
      const line = new RegExp(`^([^\\n]*?\\b${L}\\b[^\\n]*)$`, "im").exec(t)?.[1];
      if (!line) return undefined;
      const after = new RegExp(`\\b${L}\\b\\s*[:]\\s*(.+)$`, "i").exec(line)?.[1]
        ?? new RegExp(`\\b${L}\\b\\s+(.+)$`, "i").exec(line)?.[1];
      return after?.trim() || undefined;
    };
    const party = summary("party name");
    const mode = summary("mode of payment");
    const total = summary("grand total");
    if (!parsed.amount && total) parsed.amount = amt(total);
    if (!parsed.date) parsed.date = summary("invoice date") || summary("date");
    if (!parsed.particulars && party) parsed.particulars = party;
    if (!parsed.paymentMode && mode) parsed.paymentMode = mode;
    /* NOTE: `party` is the person we PAID / billed, never the receiving account holder. It must not be
     * copied into `beneficiary.accountName`: identifyBeneficiaryMaster() reads that field as "whose
     * account is this", so a supplier name there made every supplier payment look like a contra.
     * The party travels in `particulars` (and the AI's counterParty) instead. */
    /* connectIPS slips print the payer as "connectIPS Account: <holder>". Without this the sender side had no
     * name at all, so a slip whose ledger is named after the company (not the holder) could never be matched
     * on the From side of a contra. */
    const holder = summary("connectips account") ?? (/connectips\s*account\s*:\s*([^\n|]+)/i.exec(t)?.[1]?.trim());
    if (holder && !parsed.sender.accountName) parsed.sender = { ...parsed.sender, accountName: holder };
    return parsed;
  },
};
