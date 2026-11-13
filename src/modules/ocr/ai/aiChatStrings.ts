"use client";
/**
 * OCR-local strings for the AI chat dialog + the AI (Gemini) settings card, keyed by the app's language setting
 * (src/lib/i18n/plLangStorage: UI language for labels/buttons, Intro language for explaining sentences).
 * One language per string; English is the fallback for every other language. Gemini's replies are NOT forced:
 * it answers in whatever language the user writes.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, PL_LANG_APPLIED_EVENT, readPlLangs, type PlLangs } from "@/lib/i18n/plLangStorage";
import type { OcrAiDocTypeKey } from "./aiChatModel";

export type AiChatStrings = {
  chatButton: string;
  /** OCR settings provider picker: Gemini tab (view only). */
  geminiTab: string;
  geminiTabSub: string;
  noKey: string;
  savedKeys: string;
  editKeyTip: string;
  deleteKeyTip: string;
  deleteKeyAsk: string;
  deleteKeyYes: string;
  keyActive: string;
  keySavedOff: string;
  openTab: string;
  /** OCR settings: key tabs + engine card. */
  keyTabGemini: string;
  addKey: string;
  switchEngine: string;
  settingsSave: string;
  settingsCancel: string;
  settingsNote: string;
  switchOffReason: string;
  keyTabGoogle: string;
  keyTabAzure: string;
  engAi: string;
  engAiSub: string;
  engGoogleSub: string;
  engAzureSub: string;
  engOffline: string;
  engOfflineSub: string;
  engAuto: string;
  engAutoSub: string;
  addKeyAbove: string;
  askAdmin: string;
  openChatTeaching: string;
  title: string;
  intro: string;
  tabChat: string;
  tabRules: string;
  newChat: string;
  newChatTitle: string;
  showChatList: string;
  hideChatList: string;
  emptyExample: string;
  attachBill: string;
  sendJson: string;
  sendJsonTitle: string;
  typeLabel: string;
  placeholder: string;
  send: string;
  thinking: string;
  billSent: string;
  jsonSent: string;
  viewJson: string;
  fillOnVoucher: string;
  voucherFilled: string;
  voucherNothingToFill: string;
  tokens: string;
  proposedRule: string;
  saveRule: string;
  saved: string;
  ruleNotSaved: string;
  noBill: string;
  noAnswer: string;
  chatNotInstalled: string;
  loadingRules: string;
  loadRules: string;
  serverFolder: string;
  addRule: string;
  addRulePlaceholder: string;
  onlyAdmin: string;
  removed: string;
  remove: string;
  cancel: string;
  removeTitle: string;
  noRules: string;
  ruleSavedMsg: string;
  ruleRemovedMsg: string;
  /** Saved-rules sidebar: voucher-type filter labels. */
  rulesAll: string;
  rulesFilter: string;
  buttonTitle: string;
  aiOff: string;
  cardHint: string;
  docTypes: Record<OcrAiDocTypeKey, string>;
};

const EN: AiChatStrings = {
  chatButton: "Teach me",
  geminiTab: "AI (Gemini)",
  geminiTabSub: "Reads whole document",
  noKey: "No key",
  savedKeys: "Saved keys",
  editKeyTip: "Edit key",
  deleteKeyTip: "Delete key",
  deleteKeyAsk: "Delete the {name} key? It stops working for every company that uses it.",
  deleteKeyYes: "Delete",
  keyActive: "Active",
  keySavedOff: "Saved (company switch off)",
  openTab: "Open",
  keyTabGemini: "Gemini key",
  addKey: "Add key",
  switchEngine: "Switch Engine",
  settingsSave: "Save",
  settingsCancel: "Cancel",
  settingsNote: "How bills are read and filled on this device. Save keeps the device settings, Cancel restores them. Keys, the company switch and shared users are saved at once.",
  switchOffReason: "Turn on \"Enable for this company\" above",
  keyTabGoogle: "Google key",
  keyTabAzure: "Azure key",
  engAi: "AI (Gemini)",
  engAiSub: "Reads the whole document; if it fails: online, then offline",
  engGoogleSub: "Online only (Cloud Vision)",
  engAzureSub: "Online only (Image Analysis)",
  engOffline: "Offline",
  engOfflineSub: "This device only (tesseract)",
  engAuto: "Auto",
  engAutoSub: "Online when available, else offline",
  addKeyAbove: "Add the key above",
  askAdmin: "Not set up: ask the admin",
  openChatTeaching: "Teach me",
  title: "Teach me — Gemini",
  intro: "Explain how a document must be read (which column is the quantity, who the party is, which date to use). Gemini suggests a rule; Save rule stores it on the server and every later AI scan of that type uses it. Each message costs tokens: only the last {n} messages are sent, a photo only when you attach it.",
  tabChat: "Chat",
  tabRules: "Saved rules",
  newChat: "New chat",
  newChatTitle: "Start a new chat (old messages are no longer sent)",
  showChatList: "Show chat list",
  hideChatList: "Hide chat list",
  emptyExample: "Example: \"On Pratik Trade Center bills the real quantity is the QTY column, not ALT QTY\" or \"If the beneficiary on a connectIPS slip is our company, it is a Receipt\". To send the document too, tick Attach this document below.",
  attachBill: "Attach this document",
  sendJson: "Send voucher fields + OCR data (JSON)",
  sendJsonTitle: "Send the OCR result, voucher type, supported form fields and current values to Gemini",
  typeLabel: "Type",
  placeholder: "Tell Gemini… (Enter = send, Shift+Enter = new line)",
  send: "Send",
  thinking: "Gemini is thinking…",
  billSent: "document photo sent",
  jsonSent: "Voucher fields + OCR data sent",
  viewJson: "View sent JSON",
  fillOnVoucher: "Fill on voucher",
  voucherFilled: "Filled on voucher",
  voucherNothingToFill: "No empty supported fields to fill",
  tokens: "tokens",
  proposedRule: "Proposed rule",
  saveRule: "Save rule",
  saved: "Saved ✓ (used from the next AI scan)",
  ruleNotSaved: "Rule not saved",
  noBill: "No document attached to this voucher",
  noAnswer: "(no answer)",
  chatNotInstalled: "AI chat is not installed on the server yet.",
  loadingRules: "Loading rules…",
  loadRules: "Load rules",
  serverFolder: "Server folder",
  addRule: "Add a rule",
  addRulePlaceholder: "e.g. Use the QTY column, not ALT QTY.",
  onlyAdmin: "Only the company admin can add or remove rules.",
  removed: "removed",
  remove: "Remove",
  cancel: "Cancel",
  removeTitle: "Remove (kept in the file under _removed)",
  noRules: "No rules yet. Teach Gemini in the Chat tab and click Save rule.",
  ruleSavedMsg: "Rule saved.",
  ruleRemovedMsg: "Rule removed (kept in the file under _removed).",
  rulesAll: "All",
  rulesFilter: "Voucher type",
  buttonTitle: "Chat with Gemini and teach it how to read your documents",
  aiOff: "AI is off too: turn on \"Enable online OCR for this company\" below.",
  cardHint: "Gemini reads the whole document (items, totals, party, dates) and the app checks every number before filling. Pick \"AI (Gemini)\" as the OCR engine below. Uses the same company switch and shared users as Online OCR. In AI chat you can teach it how your documents must be read.",
  docTypes: {
    general: "General (all voucher types)",
    sale: "Sale",
    purchase: "Purchase",
    quotation: "Quotation",
    payment_in: "Payment In",
    payment_out: "Payment Out",
    receipt: "Receipt",
    contra: "Contra",
    journal: "Journal",
    direct_income: "Direct Income",
    direct_expense: "Direct Expense",
  },
};

const HI: AiChatStrings = {
  chatButton: "Teach me",
  geminiTab: "AI (Gemini)",
  geminiTabSub: "पूरा डॉक्यूमेंट पढ़ता है",
  noKey: "कोई key नहीं",
  savedKeys: "सहेजी गई keys",
  editKeyTip: "Key बदलें",
  deleteKeyTip: "Key हटाएँ",
  deleteKeyAsk: "{name} key हटाएँ? इसे इस्तेमाल करने वाली हर company में यह बंद हो जाएगी।",
  deleteKeyYes: "हटाएँ",
  keyActive: "चालू",
  keySavedOff: "सहेजी है (company switch बंद)",
  openTab: "खोलें",
  keyTabGemini: "Gemini key",
  addKey: "Key जोड़ें",
  switchEngine: "इंजन बदलें",
  settingsSave: "सेव",
  settingsCancel: "रद्द करें",
  settingsNote: "इस डिवाइस पर बिल कैसे पढ़े और भरे जाएँ। «सेव» डिवाइस की सेटिंग रखता है, «रद्द करें» उन्हें पहले जैसा कर देता है। Keys, company switch और shared users तुरंत सेव होते हैं।",
  switchOffReason: "ऊपर «Enable for this company» चालू करें",
  keyTabGoogle: "Google key",
  keyTabAzure: "Azure key",
  engAi: "AI (Gemini)",
  engAiSub: "पूरा डॉक्यूमेंट पढ़ता है; न चले तो online, फिर offline",
  engGoogleSub: "सिर्फ़ online (Cloud Vision)",
  engAzureSub: "सिर्फ़ online (Image Analysis)",
  engOffline: "Offline",
  engOfflineSub: "सिर्फ़ यह डिवाइस (tesseract)",
  engAuto: "Auto",
  engAutoSub: "online मिले तो online, वरना offline",
  addKeyAbove: "ऊपर key जोड़ें",
  askAdmin: "सेट नहीं है: एडमिन से पूछें",
  openChatTeaching: "Teach me",
  title: "Teach me — Gemini",
  intro: "बताइए डॉक्यूमेंट कैसे पढ़ना है (कौन-सा कॉलम मात्रा है, पार्टी कौन है, कौन-सी तारीख लेनी है)। Gemini एक नियम सुझाएगा; «नियम सहेजें» दबाने पर वह सर्वर पर सहेजा जाएगा और उस प्रकार के हर अगले AI स्कैन में लगेगा। हर संदेश पर टोकन लगते हैं: सिर्फ़ आख़िरी {n} संदेश भेजे जाते हैं, फ़ोटो तभी जब आप जोड़ें।",
  tabChat: "चैट",
  tabRules: "सहेजे नियम",
  newChat: "नई चैट",
  newChatTitle: "नई चैट शुरू करें (पुराने संदेश अब नहीं भेजे जाएँगे)",
  showChatList: "चैट सूची दिखाएँ",
  hideChatList: "चैट सूची छिपाएँ",
  emptyExample: "उदाहरण: «Pratik Trade Center के बिल में असली मात्रा QTY कॉलम है, ALT QTY नहीं» या «connectIPS स्लिप में Beneficiary हमारी कंपनी हो तो यह Receipt है»। डॉक्यूमेंट भी भेजना हो तो नीचे «यह डॉक्यूमेंट भेजें» चुनें।",
  attachBill: "यह डॉक्यूमेंट भेजें",
  sendJson: "वाउचर फ़ील्ड + OCR डेटा (JSON) भेजें",
  sendJsonTitle: "OCR नतीजा, वाउचर प्रकार, फ़ॉर्म फ़ील्ड और मौजूदा मान Gemini को भेजें",
  typeLabel: "प्रकार",
  placeholder: "Gemini को बताइए… (Enter = भेजें, Shift+Enter = नई लाइन)",
  send: "भेजें",
  thinking: "Gemini सोच रहा है…",
  billSent: "डॉक्यूमेंट फ़ोटो भेजी",
  jsonSent: "वाउचर फ़ील्ड + OCR डेटा भेजा",
  viewJson: "भेजा गया JSON देखें",
  fillOnVoucher: "वाउचर में भरें",
  voucherFilled: "वाउचर में भरा",
  voucherNothingToFill: "भरने के लिए कोई खाली समर्थित फ़ील्ड नहीं",
  tokens: "टोकन",
  proposedRule: "सुझाया नियम",
  saveRule: "नियम सहेजें",
  saved: "सहेजा गया ✓ (अगले AI स्कैन से लागू)",
  ruleNotSaved: "नियम नहीं सहेजा गया",
  noBill: "इस वाउचर में कोई डॉक्यूमेंट नहीं जुड़ा है",
  noAnswer: "(कोई जवाब नहीं)",
  chatNotInstalled: "AI चैट अभी सर्वर पर नहीं लगा है।",
  loadingRules: "नियम लोड हो रहे हैं…",
  loadRules: "नियम लोड करें",
  serverFolder: "सर्वर फ़ोल्डर",
  addRule: "नया नियम जोड़ें",
  addRulePlaceholder: "जैसे: QTY कॉलम लें, ALT QTY नहीं।",
  onlyAdmin: "सिर्फ़ कंपनी एडमिन नियम जोड़ या हटा सकते हैं।",
  removed: "हटाए गए",
  remove: "हटाएँ",
  cancel: "रद्द करें",
  removeTitle: "हटाएँ (फ़ाइल में _removed के अंदर रखा रहेगा)",
  noRules: "अभी कोई नियम नहीं। चैट टैब में Gemini को सिखाएँ और «नियम सहेजें» दबाएँ।",
  ruleSavedMsg: "नियम सहेजा गया।",
  ruleRemovedMsg: "नियम हटाया गया (फ़ाइल में _removed के अंदर रखा है)।",
  rulesAll: "सभी",
  rulesFilter: "वाउचर प्रकार",
  buttonTitle: "Gemini से चैट करें और उसे अपने डॉक्यूमेंट पढ़ना सिखाएँ",
  aiOff: "AI भी बंद है: नीचे का «Enable online OCR for this company» स्विच चालू करें।",
  cardHint: "Gemini पूरा डॉक्यूमेंट पढ़ता है (आइटम, टोटल, पार्टी, तारीख) और ऐप भरने से पहले हर संख्या जाँचता है। नीचे OCR इंजन में «AI (Gemini)» चुनें। Online OCR वाला ही कंपनी स्विच और शेयर्ड यूज़र लगते हैं। AI चैट में आप इसे सिखा सकते हैं कि आपके डॉक्यूमेंट कैसे पढ़ने हैं।",
  docTypes: {
    general: "सामान्य (सभी वाउचर प्रकार)",
    sale: "बिक्री",
    purchase: "खरीद",
    quotation: "कोटेशन",
    payment_in: "प्राप्ति भुगतान",
    payment_out: "भुगतान",
    receipt: "रसीद",
    contra: "कॉन्ट्रा",
    journal: "जर्नल",
    direct_income: "प्रत्यक्ष आय",
    direct_expense: "प्रत्यक्ष खर्च",
  },
};

const NE: AiChatStrings = {
  chatButton: "Teach me",
  geminiTab: "AI (Gemini)",
  geminiTabSub: "पूरा कागजात पढ्छ",
  noKey: "कुनै key छैन",
  savedKeys: "सुरक्षित keys",
  editKeyTip: "Key बदल्नुहोस्",
  deleteKeyTip: "Key हटाउनुहोस्",
  deleteKeyAsk: "{name} key हटाउने? यो प्रयोग गर्ने सबै company मा बन्द हुन्छ।",
  deleteKeyYes: "हटाउनुहोस्",
  keyActive: "चालू",
  keySavedOff: "सुरक्षित छ (company switch बन्द)",
  openTab: "खोल्नुहोस्",
  keyTabGemini: "Gemini key",
  addKey: "Key थप्नुहोस्",
  switchEngine: "इन्जिन बदल्नुहोस्",
  settingsSave: "सेभ",
  settingsCancel: "रद्द गर्नुहोस्",
  settingsNote: "यो डिभाइसमा बिल कसरी पढ्ने र भर्ने। «सेभ» ले डिभाइस सेटिङ राख्छ, «रद्द गर्नुहोस्» ले पहिलेजस्तै बनाउँछ। Keys, company switch र shared users तुरुन्तै सेभ हुन्छन्।",
  switchOffReason: "माथि «Enable for this company» खोल्नुहोस्",
  keyTabGoogle: "Google key",
  keyTabAzure: "Azure key",
  engAi: "AI (Gemini)",
  engAiSub: "पूरा कागजात पढ्छ; नचले online, त्यसपछि offline",
  engGoogleSub: "online मात्र (Cloud Vision)",
  engAzureSub: "online मात्र (Image Analysis)",
  engOffline: "Offline",
  engOfflineSub: "यो डिभाइस मात्र (tesseract)",
  engAuto: "Auto",
  engAutoSub: "online भए online, नभए offline",
  addKeyAbove: "माथि key थप्नुहोस्",
  askAdmin: "सेट छैन: एडमिनलाई सोध्नुहोस्",
  openChatTeaching: "Teach me",
  title: "Teach me — Gemini",
  intro: "कागजात कसरी पढ्ने भन्नुहोस् (कुन कोलम परिमाण हो, पार्टी को हो, कुन मिति लिने)। Gemini ले एउटा नियम सुझाउँछ; «नियम सुरक्षित गर्नुहोस्» थिच्दा सर्भरमा सुरक्षित हुन्छ र त्यस प्रकारको हरेक अर्को AI स्क्यानमा लाग्छ। हरेक सन्देशमा टोकन लाग्छ: अन्तिम {n} सन्देश मात्र पठाइन्छ, फोटो तपाईंले जोड्दा मात्र।",
  tabChat: "च्याट",
  tabRules: "सुरक्षित नियमहरू",
  newChat: "नयाँ च्याट",
  newChatTitle: "नयाँ च्याट सुरु गर्नुहोस् (पुराना सन्देश अब पठाइँदैन)",
  showChatList: "च्याट सूची देखाउनुहोस्",
  hideChatList: "च्याट सूची लुकाउनुहोस्",
  emptyExample: "उदाहरण: «Pratik Trade Center को बिलमा वास्तविक परिमाण QTY कोलम हो, ALT QTY होइन» वा «connectIPS स्लिपमा Beneficiary हाम्रो कम्पनी भए यो Receipt हो»। कागजात पनि पठाउन तल «यो कागजात पठाउनुहोस्» छान्नुहोस्।",
  attachBill: "यो कागजात पठाउनुहोस्",
  sendJson: "भौचरका field + OCR data (JSON) पठाउनुहोस्",
  sendJsonTitle: "OCR नतिजा, भौचर प्रकार, form field र हालका मानहरू Gemini लाई पठाउनुहोस्",
  typeLabel: "प्रकार",
  placeholder: "Gemini लाई भन्नुहोस्… (Enter = पठाउनुहोस्, Shift+Enter = नयाँ लाइन)",
  send: "पठाउनुहोस्",
  thinking: "Gemini सोच्दैछ…",
  billSent: "कागजात फोटो पठाइयो",
  jsonSent: "भौचर field + OCR data पठाइयो",
  viewJson: "पठाइएको JSON हेर्नुहोस्",
  fillOnVoucher: "भौचरमा भर्नुहोस्",
  voucherFilled: "भौचरमा भरियो",
  voucherNothingToFill: "भर्न मिल्ने खाली field छैन",
  tokens: "टोकन",
  proposedRule: "सुझाइएको नियम",
  saveRule: "नियम सुरक्षित गर्नुहोस्",
  saved: "सुरक्षित भयो ✓ (अर्को AI स्क्यानदेखि लागू)",
  ruleNotSaved: "नियम सुरक्षित भएन",
  noBill: "यो भौचरमा कुनै कागजात जोडिएको छैन",
  noAnswer: "(जवाफ छैन)",
  chatNotInstalled: "AI च्याट अझै सर्भरमा राखिएको छैन।",
  loadingRules: "नियमहरू लोड हुँदैछन्…",
  loadRules: "नियमहरू लोड गर्नुहोस्",
  serverFolder: "सर्भर फोल्डर",
  addRule: "नयाँ नियम थप्नुहोस्",
  addRulePlaceholder: "जस्तै: QTY कोलम लिनुहोस्, ALT QTY होइन।",
  onlyAdmin: "कम्पनी एडमिनले मात्र नियम थप्न वा हटाउन सक्छ।",
  removed: "हटाइएका",
  remove: "हटाउनुहोस्",
  cancel: "रद्द गर्नुहोस्",
  removeTitle: "हटाउनुहोस् (फाइलमा _removed भित्र राखिन्छ)",
  noRules: "अहिले कुनै नियम छैन। च्याट ट्याबमा Gemini लाई सिकाउनुहोस् र «नियम सुरक्षित गर्नुहोस्» थिच्नुहोस्।",
  ruleSavedMsg: "नियम सुरक्षित भयो।",
  ruleRemovedMsg: "नियम हटाइयो (फाइलमा _removed भित्र राखिएको छ)।",
  rulesAll: "सबै",
  rulesFilter: "भाउचर प्रकार",
  buttonTitle: "Gemini सँग च्याट गर्नुहोस् र आफ्नो कागजात पढ्न सिकाउनुहोस्",
  aiOff: "AI पनि बन्द छ: तलको «Enable online OCR for this company» स्विच खोल्नुहोस्।",
  cardHint: "Gemini ले पूरा कागजात पढ्छ (आइटम, टोटल, पार्टी, मिति) र एपले भर्नुअघि हरेक अङ्क जाँच्छ। तल OCR इन्जिनमा «AI (Gemini)» छान्नुहोस्। Online OCR कै कम्पनी स्विच र सेयर्ड प्रयोगकर्ता लाग्छन्। AI च्याटमा तपाईं आफ्नो कागजात कसरी पढ्ने भनेर सिकाउन सक्नुहुन्छ।",
  docTypes: {
    general: "सामान्य (सबै भाउचर प्रकार)",
    sale: "बिक्री",
    purchase: "खरिद",
    quotation: "कोटेसन",
    payment_in: "प्राप्ति भुक्तानी",
    payment_out: "भुक्तानी",
    receipt: "रसिद",
    contra: "कन्ट्रा",
    journal: "जर्नल",
    direct_income: "प्रत्यक्ष आय",
    direct_expense: "प्रत्यक्ष खर्च",
  },
};

const TABLES: Record<string, AiChatStrings> = { en: EN, hi: HI, ne: NE };

/** Labels (UI language) + explaining sentences (Intro language); English for any language without a table. */
export function aiChatStrings(langs: PlLangs = readPlLangs()): AiChatStrings {
  const ui = TABLES[langs.ui] ?? EN;
  const intro = TABLES[langs.intro] ?? EN;
  return { ...ui, intro: intro.intro, emptyExample: intro.emptyExample, cardHint: intro.cardHint, aiOff: ui.aiOff };
}

const SERVER_SNAPSHOT = `${DEFAULT_LANG}|${DEFAULT_LANG}`;
function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PL_LANG_APPLIED_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PL_LANG_APPLIED_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function snapshot() {
  const l = readPlLangs();
  return `${l.ui}|${l.intro}`;
}

/** Live strings: re-renders when the app language changes (pl-lang-applied event). */
export function useAiChatStrings(): AiChatStrings {
  const key = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  const [ui, intro] = key.split("|");
  return aiChatStrings({ ui: ui || DEFAULT_LANG, intro: intro || DEFAULT_LANG });
}
