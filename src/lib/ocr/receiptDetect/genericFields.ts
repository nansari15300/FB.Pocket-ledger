/** Label-based key:value field mapper shared by every money-document detector. */
import type { ParsedReceipt, ReceiptAccountSide } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const lab = (l: string) => l.split(/\s+/).map((w) => w.split("").join("\\s*")).join("\\s*");

export const GENERIC_LABELS: Record<string, string[]> = {
  txnId: ["Transaction Id", "Transaction ID", "Txn Id", "Txn ID", "Reference Code", "Ref Code", "Reference No", "Ref No", "UTR", "Trace Id"],
  amount: ["Transaction Amount", "Amount", "Amount NPR", "Total Amount", "Grand Total", "Net Amount", "Paid", "Rs", "NPR"],
  charge: ["Charge Amount", "Charge", "Service Charge", "Bank Charge", "Fee"],
  date: ["Transaction Date", "Date/Time", "Date Time", "Nepali Date", "Miti", "Invoice Date", "Bill Date", "Dated", "Date"],
  referenceId: ["Reference Id", "Reference ID", "Reference"],
  remarks: ["Remarks", "Remark", "Narration", "Note"],
  particulars: ["Particulars", "Particular", "Purpose", "Description"],
  initiatorPhone: ["Initiator", "Initiator Mobile", "Mobile No", "Mobile Number", "Phone", "Contact"],
  status: ["Status", "Debit Status", "Credit Status", "Txn Status", "Transaction Status"],
  voucherNo: ["Voucher No", "Voucher Number", "Voucher #", "Vr No"],
  paymentMode: ["Mode of Payment", "Payment Mode", "Paid By", "Channel", "Service"],
  senderName: ["Sender's Name", "Sender Name", "From Name", "Remitter Name", "Customer Name"],
  senderAccount: ["Sender's Account", "Sender Account", "Sender A/c", "From Account", "Customer Account No", "Account No"],
  senderBank: ["Sender Bank", "Customer Bank", "From Bank", "Bank Name"],
  senderBranch: ["Sender Branch", "Customer Branch", "From Branch", "Bank Branch"],
  receiverName: ["Receiver's Name", "Receiver Name", "Beneficiary Name", "Beneficiary Account Name", "Account Name", "To Name", "Payee"],
  receiverAccount: ["Receiver's Account", "Receiver Account", "Beneficiary Account", "Beneficiary A/c", "To Account"],
  receiverBank: ["Receiver Bank", "Beneficiary Bank", "To Bank"],
  receiverBranch: ["Receiver Branch", "Beneficiary Branch", "To Branch"],
};

export function extractLabeled(block: string, labels: string[], allLabels?: string[]): string | undefined {
  const anySrc = allLabels && allLabels.length ? allLabels : Object.values(GENERIC_LABELS).flat();
  const unique = [...new Set(anySrc)];
  const ANY = unique.map(lab).join("|");
  for (const label of labels) {
    const re = new RegExp(`${lab(label)}\\s*\\.?\\s*[:;]?\\s*([^\\n]*?)\\s*(?=(?:[;|]\\s*)?(?:${ANY})\\b|\\n|$)`, "i");
    const v = block.match(re)?.[1]?.replace(/^[:;.\s]+|[;|\s]+$/g, "").trim();
    if (v) return v;
  }
  return undefined;
}

export function parseAmount(s?: string): number | undefined {
  if (!s) return undefined;
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /[0-9]/.test(s) ? n : undefined;
}

export function parsePhone(s?: string): string | undefined {
  if (!s) return undefined;
  const m = String(s).match(/(?:\+?977[\s-]?)?(9[78]\d{8})/);
  return m ? m[1] : undefined;
}

export function isMaskedName(name?: string): boolean {
  const s = String(name ?? "").trim();
  if (!s) return false;
  return /[*#xX]{2,}/.test(s) || /^\*+/.test(s) || /•{2,}/.test(s);
}

/** Visible trailing letters of a masked name ("****** DHAMI" -> "DHAMI"). */
export function maskedNameSuffix(name?: string): string | undefined {
  const s = String(name ?? "").replace(/[•]/g, "*").trim();
  if (!s) return undefined;
  const m = s.match(/[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .']{1,40}$/);
  const v = m?.[0]?.trim();
  return v && v.length >= 3 ? v : undefined;
}

export function parseGenericFields(text: string, extra?: Partial<Record<keyof typeof GENERIC_LABELS, string[]>>): ParsedReceipt {
  const t = text.replace(/\r/g, "");
  const labels = (k: keyof typeof GENERIC_LABELS) => [...(GENERIC_LABELS[k] ?? []), ...(extra?.[k] ?? [])];
  const all = Object.keys(GENERIC_LABELS).flatMap((k) => labels(k as keyof typeof GENERIC_LABELS));
  const f = (k: keyof typeof GENERIC_LABELS) => extractLabeled(t, labels(k), all);
  const sender: ReceiptAccountSide = {
    accountName: f("senderName"),
    accountMasked: f("senderAccount"),
    bankName: f("senderBank"),
    branch: f("senderBranch"),
  };
  const beneficiary: ReceiptAccountSide = {
    accountName: f("receiverName"),
    accountMasked: f("receiverAccount"),
    bankName: f("receiverBank"),
    branch: f("receiverBranch"),
  };
  const status = f("status");
  return {
    txnId: f("txnId")?.match(/[A-Za-z0-9-]{4,}/)?.[0],
    amount: parseAmount(f("amount")),
    charge: parseAmount(f("charge")),
    date: f("date"),
    referenceId: f("referenceId"),
    remarks: f("remarks"),
    particulars: f("particulars"),
    initiatorPhone: parsePhone(f("initiatorPhone")) ?? parsePhone(t),
    status: status || undefined,
    voucherNo: f("voucherNo")?.match(/[A-Za-z0-9][A-Za-z0-9\-/]{0,24}/)?.[0],
    paymentMode: f("paymentMode"),
    sender,
    beneficiary,
  };
}

export { squash };
