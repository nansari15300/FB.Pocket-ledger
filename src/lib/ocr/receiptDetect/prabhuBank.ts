import { extractLabeled, parseAmount, parseGenericFields, parsePhone, squash } from "./genericFields";
import type { ParsedReceipt, ReceiptFormatDetector } from "./types";

export const prabhuBankDetector: ReceiptFormatDetector = {
  format: "prabhu",
  detect(text) {
    const head = squash(text.slice(0, 800));
    const all = squash(text);
    let s = 0;
    if (head.includes("prabhu")) s += 0.45;
    if (head.includes("paymentreceipt") || all.includes("paymentreceipt")) s += 0.3;
    if (all.includes("referencecode")) s += 0.15;
    if (all.includes("internalfundtransfer") || all.includes("initiator")) s += 0.15;
    if (all.includes("sendersname") || all.includes("receiversname")) s += 0.1;
    return Math.min(1, s);
  },
  parse(text): ParsedReceipt {
    const t = text.replace(/\r/g, "");
    const g = parseGenericFields(t);
    // Prefer explicit sender/receiver labels over generic "Account No" / "Account Name"
    const all = ["Reference Code", "Sender's Name", "Sender Name", "Sender's Account", "Sender Account", "Receiver's Name", "Receiver Name", "Receiver's Account", "Receiver Account", "Date/Time", "Date Time", "Service", "Amount", "Initiator", "Remarks", "Remark", "Channel", "Status"];
    const f = (label: string, alts: string[] = []) => extractLabeled(t, [label, ...alts], all);
    const senderName = f("Sender's Name", ["Sender Name"]) ?? g.sender.accountName;
    const receiverName = f("Receiver's Name", ["Receiver Name"]) ?? g.beneficiary.accountName;
    const senderAcc = f("Sender's Account", ["Sender Account"]) ?? g.sender.accountMasked;
    const receiverAcc = f("Receiver's Account", ["Receiver Account"]) ?? g.beneficiary.accountMasked;
    return {
      ...g,
      txnId: f("Reference Code")?.match(/[A-Za-z0-9-]{4,}/)?.[0] ?? g.txnId,
      amount: parseAmount(f("Amount")) ?? g.amount,
      date: f("Date/Time", ["Date Time", "Date"]) ?? g.date,
      remarks: f("Remarks", ["Remark"]) ?? g.remarks,
      particulars: f("Service") ?? g.particulars,
      initiatorPhone: parsePhone(f("Initiator")) ?? g.initiatorPhone,
      status: f("Status") ?? g.status,
      paymentMode: f("Channel") ?? g.paymentMode,
      sender: { ...g.sender, accountName: senderName, accountMasked: senderAcc, bankName: g.sender.bankName || (squash(t).includes("prabhu") ? "Prabhu Bank" : undefined) },
      beneficiary: { ...g.beneficiary, accountName: receiverName, accountMasked: receiverAcc },
    };
  },
};
