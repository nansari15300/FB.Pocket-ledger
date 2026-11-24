/**
 * Anusuchi 13 party-list amount — (i) popover copy.
 * Language = app Intro language (PlI18n). en / hi / ne are hand translations;
 * other codes fall back to English, which PlGlobalTranslate machine-translates
 * (nodes carry data-pl-intro).
 *
 * `en: true` segments stay English (closing balance, opening, Debit and Credit totals, Dr, Cr).
 */
export type Anusuchi13ListIntroSeg = { text: string; en?: boolean };

export type Anusuchi13ListIntroCopy = {
  title: string;
  notBalance: Anusuchi13ListIntroSeg[];
  fyTxns: Anusuchi13ListIntroSeg[];
  largerSide: Anusuchi13ListIntroSeg[];
};

const en: Anusuchi13ListIntroCopy = {
  title: "Amount shown in this list",
  notBalance: [
    { text: "The figure beside each party is not the account’s current " },
    { text: "closing balance", en: true },
    { text: "." },
  ],
  fyTxns: [
    { text: "It presents the transactions of the selected fiscal year, including the fiscal-year " },
    { text: "opening", en: true },
    { text: "." },
  ],
  largerSide: [
    { text: "Debit and Credit totals", en: true },
    { text: " for that year are compared, and the larger of the two amounts is displayed, marked " },
    { text: "Dr", en: true },
    { text: " or " },
    { text: "Cr", en: true },
    { text: " as applicable." },
  ],
};

const hi: Anusuchi13ListIntroCopy = {
  title: "इस सूची में दिखाई गई राशि",
  notBalance: [
    { text: "प्रत्येक खाते के साथ दिखाई गई राशि उस खाते का वर्तमान शेष (" },
    { text: "closing balance", en: true },
    { text: ") नहीं है।" },
  ],
  fyTxns: [
    { text: "यह राशि चयनित वित्तीय वर्ष के लेन-देन पर आधारित है, जिसमें उस वर्ष का " },
    { text: "opening", en: true },
    { text: " भी शामिल है।" },
  ],
  largerSide: [
    { text: "Debit and Credit totals", en: true },
    { text: " की तुलना की जाती है, और दोनों में से जो राशि बड़ी होती है, वही " },
    { text: "Dr", en: true },
    { text: " या " },
    { text: "Cr", en: true },
    { text: " के साथ दिखाई जाती है।" },
  ],
};

const ne: Anusuchi13ListIntroCopy = {
  title: "यो सूचीमा देखाइएको रकम",
  notBalance: [
    { text: "प्रत्येक खातासँग देखाइएको रकम सो खाताको हालको मौज्दात (" },
    { text: "closing balance", en: true },
    { text: ") होइन।" },
  ],
  fyTxns: [
    { text: "यो रकम चयन गरिएको आर्थिक वर्षका कारोबारमा आधारित छ, जसमा सो वर्षको " },
    { text: "opening", en: true },
    { text: " पनि समावेश छ।" },
  ],
  largerSide: [
    { text: "Debit and Credit totals", en: true },
    { text: " तुलना गरिन्छ, र दुईमध्ये जुन रकम ठूलो हुन्छ, त्यही " },
    { text: "Dr", en: true },
    { text: " वा " },
    { text: "Cr", en: true },
    { text: " सहित देखाइन्छ।" },
  ],
};

const COPY: Record<string, Anusuchi13ListIntroCopy> = { en, hi, ne };

export function pickAnusuchi13ListIntro(introLang: string | null | undefined): Anusuchi13ListIntroCopy {
  return COPY[String(introLang || "").trim()] ?? en;
}
