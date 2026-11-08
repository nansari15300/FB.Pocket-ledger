import { pickIntroCopy } from "@/lib/i18n/introCopy";

/** Check mode — marked row message in empty Dr/Cr column. */
export const STATEMENT_CHECKED_ROW_MESSAGE = "Reconciled Point";

/** Info popover — formal help text for the (i) icon beside the matched label. */
export const STATEMENT_CHECKED_ROW_INFO_TITLE = "Reconciled Point";

export const STATEMENT_CHECKED_ROW_INFO_TEXT =
  "After reconciling a ledger against the counterparty statement, mark the transaction up to which accounts have been verified as a Reconciled Point. This records that entries on or before this transaction are already matched, so you do not need to review earlier transactions or statement dates again. Continue reconciliation from the transactions after the marked row.";

/** 3 blinks within 1s (globals.css `pl-statement-checked-blink-continuous`). */
export const STATEMENT_CHECKED_ROW_MESSAGE_CLASS =
  "pl-statement-checked-msg text-sm font-semibold italic leading-snug text-emerald-900 dark:text-emerald-200 whitespace-nowrap shrink-0";

export const STATEMENT_CHECKED_ROW_MESSAGE_DIM_CLASS =
  "text-sm font-medium italic leading-snug text-muted-foreground/75 dark:text-muted-foreground/60 whitespace-nowrap shrink-0 opacity-75";

export type ReconciledPointCopy = {
  label: string;
  labelPast: string;
  title: string;
  detailsHeader: string;
  markedBy: string;
  date: string;
  messageLabel: string;
  messagePlaceholder: string;
  saveNote: string;
  savedToast: string;
  activeBadge: string;
  pastBadge: string;
  pastNotice: string;
  infoText: string;
};

export function getReconciledPointCopy(introLang: string = "en"): ReconciledPointCopy {
  return {
    label: "Reconciled Point",
    labelPast: "Reconciled Point (Past)",
    title: "Reconciled Point",
    detailsHeader: "Reconciled Point Details",
    markedBy: "Marked by",
    date: "Date",
    messageLabel: "Note / Message",
    messagePlaceholder: "Add a reconciliation note...",
    saveNote: "Save Note",
    savedToast: "Reconciliation note saved",
    activeBadge: "Active Point",
    pastBadge: "Past Point",
    pastNotice: "This is a historic Reconciled Point. A newer active point exists further down this ledger.",
    infoText: pickIntroCopy(introLang, {
      en: STATEMENT_CHECKED_ROW_INFO_TEXT,
      ne: "काउन्टरपार्टी स्टेटमेन्टको विरुद्ध खातामा मेलमिलाप गरेपछि, पङ्क्तिमा चिन्ह लगाउनुहोस् जुन खाताहरू स्टेटमेन्ट जाँचको रूपमा प्रमाणित गरिएको छ। यो लेनदेनमा वा अघिको प्रविष्टिहरू पहिले नै मेल खाएको रेकर्ड गर्दछ, त्यसैले तपाईंले पहिलेको लेनदेन वा स्टेटमेन्ट मितिहरू पुनः समीक्षा गर्न आवश्यक छैन। चिन्ह लगाइएको पङ्क्ति पछि लेनदेनबाट मेलमिलाप जारी राख्नुहोस्।",
      hi: "खाताबही का विवरण मिलाते समय जिस लेनदेन तक हिसाब सत्यापित हो चुका हो, उसे मेलमिलाप बिंदु के रूप में चिन्हित करें। इससे यह दर्ज हो जाता है कि इस लेनदेन तक की प्रविष्टियाँ पहले से जाँची जा चुकी हैं, जिससे पूर्व लेनदेन की दोबारा जाँच करने की आवश्यकता नहीं रहती। इसके आगे के लेनदेन से मिलान जारी रखें।",
    }),
  };
}

export function statementCheckedMessageColumn(
  debit: number,
  credit: number
): "debit" | "credit" | null {
  const d = Math.abs(Number(debit) || 0);
  const c = Math.abs(Number(credit) || 0);
  if (d < 1e-6 && c < 1e-6) return "debit";
  if (d < 1e-6) return "debit";
  if (c < 1e-6) return "credit";
  return null;
}
