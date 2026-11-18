"use client";
/**
 * Voucher OCR fill messages added for the AI voucher types / amount checks / due date / journal lines.
 * Same language system as aiChatStrings (src/lib/i18n/plLangStorage UI language); English is the fallback.
 * Plain function (not a hook): read at fill time inside the OCR run, so the current UI language is used.
 */
import { readPlLangs, type PlLangs } from "@/lib/i18n/plLangStorage";

export type OcrRunStrings = {
  /** Missing-field label when Dr/Cr, Grand Total / item sum / amount in words disagree. */
  amountMismatch: string;
  /** Filled-field label: due date + where it came from. */
  dueDate: string;
  dueSource: { printed: string; bill_credit_days: string; party_credit_days: string; default_days: string };
  /** Filled-field label: journal Dr/Cr lines. */
  journalLines: string;
  /** Missing-field label for a journal line whose ledger is not in the masters: {n} = line no, {name} = printed name. */
  journalLineAccount: string;
  /** Missing-field label when the AI gave no Dr/Cr lines for a journal. */
  journalNoLines: string;
  /** Runner missing-field label: a voucher-type switch is suggested but will not happen by itself. */
  voucherTypeSwitchPending: string;
  /** "{engine} could not read this bill" dialog (useVoucherOcr). {engine} = Gemini / Google / Azure. */
  fail: OcrFailStrings;
  /** "Reading bill by Gemini (model)…" progress toast (useVoucherOcr). {engine} = "Gemini (gemini-3.5-flash-lite)". */
  progress: { reading: string; readingBy: string; rereading: string; rereadingBy: string; filling: string; stop: string };
};

/** Friendly reason kinds for an OCR failure (aiClient ocrAiFailKind). */
export type OcrFailKind = "quota" | "overloaded" | "fallback_failed" | "timeout" | "network" | "model" | "no_key" | "forbidden" | "disabled" | "not_signed_in" | "unreadable" | "unavailable" | "other";

export type OcrFailStrings = {
  title: string;
  onlyEngine: string;
  reason: Record<OcrFailKind, string>;
  /** {wait} = waitSec / waitMin text. */
  retryIn: string;
  waitSec: string;
  waitMin: string;
  hintQuota: string;
  hintBusy: string;
  hintOther: string;
  serverDetail: string;
  close: string;
  refresh: string;
  /** Toast after a successful read by the fallback model: {primary} / {model}. */
  fallbackNote: string;
  /** Model line under the title: {model} / {fallback}. */
  modelTried: string;
  modelsTried: string;
  /** Used for {fallback} when the server did not name the second model. */
  otherModel: string;
  /** Model chooser in the popup (this scan only; the saved model is not changed). */
  pickModel: string;
  readWithModel: string;
  /** Suffix on the chooser option of a model that just failed. */
  failedTag: string;
  /** Chooser option labels: {model} = Gemini model label / id. */
  engineGemini: string;
  engineAzure: string;
  engineGoogle: string;
};

const EN: OcrRunStrings = {
  amountMismatch: "Amount mismatch (Dr / Cr, total or amount in words)",
  dueDate: "Due date",
  dueSource: { printed: "printed on the bill", bill_credit_days: "{days} credit days on the bill", party_credit_days: "{days} credit days of the party", default_days: "{days} days (Common Setting)" },
  journalLines: "Journal Dr / Cr lines",
  journalLineAccount: "Journal line {n} account: {name}",
  journalNoLines: "Journal Dr / Cr lines",
  voucherTypeSwitchPending: "Voucher type (switch suggested)",
  fail: {
    title: "{engine} could not read this bill",
    onlyEngine: "Only {engine} was used because it is the engine you selected. Nothing was filled, so nothing will be saved.",
    reason: {
      quota: "Gemini quota / rate limit reached.",
      overloaded: "Google's Gemini model is busy right now. This is not a key or quota problem.",
      fallback_failed: "Both Gemini models were busy: {model}, then {fallback}. This is not a key or quota problem.",
      timeout: "Gemini took too long to answer.",
      network: "Could not reach Gemini (internet or server problem).",
      model: "This Gemini model is not available for this key.",
      no_key: "The saved Gemini key was rejected or has expired. Save a valid key in OCR settings.",
      forbidden: "You do not have permission for this.",
      disabled: "Online / AI OCR is turned off on the server or for this company.",
      not_signed_in: "Sign in to Pocket Ledger Server first.",
      unreadable: "No readable text was found in this file.",
      unavailable: "This OCR engine is not set up or not allowed for this company.",
      other: "The OCR server returned an error. Open Server detail below to see it.",
    },
    retryIn: "Try again in about {wait}.",
    waitSec: "{n}s",
    waitMin: "{n} min",
    hintQuota: "Gemini free tier allows a limited number of scans per minute; the limit resets shortly. Try again after a minute, or use Auto or Google/Azure OCR until it resets.",
    hintBusy: "Press Refresh OCR again in a few seconds.",
    hintOther: "Fix the reason above and press Refresh OCR. If you want an automatic second engine, pick Auto in OCR settings → Switch Engine.",
    serverDetail: "Server detail",
    close: "Close",
    refresh: "Refresh OCR",
    fallbackNote: "{primary} was busy, so {model} read this bill.",
    modelTried: "Model: {model}",
    modelsTried: "Models tried: {model} → {fallback}",
    otherModel: "a second model",
    pickModel: "Try another engine (this scan only):",
    readWithModel: "Read with this engine",
    failedTag: "(just failed)",
    engineGemini: "Gemini — {model}",
    engineAzure: "Azure OCR",
    engineGoogle: "Google Cloud Vision",
  },
  progress: { reading: "Reading bill…", readingBy: "Reading bill by {engine}…", rereading: "Re-reading bill…", rereadingBy: "Re-reading bill by {engine}…", filling: "Filling from the bill already read…", stop: "Stop" },
};

const HI: OcrRunStrings = {
  amountMismatch: "रकम मेल नहीं खाती (Dr / Cr, कुल या शब्दों में रकम)",
  dueDate: "देय तिथि",
  dueSource: { printed: "बिल पर छपी", bill_credit_days: "बिल पर {days} दिन उधार", party_credit_days: "पार्टी के {days} दिन उधार", default_days: "{days} दिन (कॉमन सेटिंग)" },
  journalLines: "जर्नल Dr / Cr लाइनें",
  journalLineAccount: "जर्नल लाइन {n} का खाता: {name}",
  journalNoLines: "जर्नल Dr / Cr लाइनें",
  voucherTypeSwitchPending: "वाउचर प्रकार (बदलने का सुझाव)",
  fail: {
    title: "{engine} यह बिल नहीं पढ़ सका",
    onlyEngine: "सिर्फ़ {engine} इस्तेमाल हुआ, क्योंकि आपने यही engine चुना है। कुछ भी भरा नहीं गया, इसलिए कुछ भी save नहीं होगा।",
    reason: {
      quota: "Gemini की quota / rate limit पूरी हो गई।",
      overloaded: "Google का Gemini model अभी व्यस्त है। यह key या quota की समस्या नहीं है।",
      fallback_failed: "दोनों Gemini model व्यस्त थे: पहले {model}, फिर {fallback}। यह key या quota की समस्या नहीं है।",
      timeout: "Gemini ने जवाब देने में बहुत देर लगाई।",
      network: "Gemini तक नहीं पहुँच पाए (इंटरनेट या server की समस्या)।",
      model: "यह Gemini model इस key के लिए उपलब्ध नहीं है।",
      no_key: "सेव की गई Gemini key अस्वीकार हुई या उसकी अवधि खत्म हो गई। OCR settings में सही key सेव करें।",
      forbidden: "आपको इसकी अनुमति नहीं है।",
      disabled: "Online / AI OCR server पर या इस company के लिए बंद है।",
      not_signed_in: "पहले Pocket Ledger Server में sign in करें।",
      unreadable: "इस file में पढ़ने लायक text नहीं मिला।",
      unavailable: "यह OCR engine इस company के लिए सेट नहीं है या इसकी अनुमति नहीं है।",
      other: "OCR server ने एक error भेजा। देखने के लिए नीचे Server विवरण खोलें।",
    },
    retryIn: "लगभग {wait} बाद फिर कोशिश करें।",
    waitSec: "{n} सेकंड",
    waitMin: "{n} मिनट",
    hintQuota: "Gemini free tier में हर मिनट सीमित scan ही होते हैं; limit जल्दी reset हो जाती है। एक मिनट बाद फिर कोशिश करें, या तब तक Auto या Google/Azure OCR इस्तेमाल करें।",
    hintBusy: "कुछ सेकंड बाद फिर से OCR रीफ़्रेश करें दबाएँ।",
    hintOther: "ऊपर बताई वजह ठीक करें और OCR रीफ़्रेश करें दबाएँ। अपने-आप दूसरा engine चाहिए तो OCR settings → Switch Engine में Auto चुनें।",
    serverDetail: "Server विवरण",
    close: "बंद करें",
    refresh: "OCR रीफ़्रेश करें",
    fallbackNote: "{primary} व्यस्त था, इसलिए यह बिल {model} ने पढ़ा।",
    modelTried: "Model: {model}",
    modelsTried: "आज़माए गए model: {model} → {fallback}",
    otherModel: "दूसरा model",
    pickModel: "दूसरा engine आज़माएँ (सिर्फ़ इस scan के लिए):",
    readWithModel: "इस engine से पढ़ें",
    failedTag: "(अभी fail हुआ)",
    engineGemini: "Gemini — {model}",
    engineAzure: "Azure OCR",
    engineGoogle: "Google Cloud Vision",
  },
  progress: { reading: "बिल पढ़ा जा रहा है…", readingBy: "{engine} से बिल पढ़ा जा रहा है…", rereading: "बिल फिर से पढ़ा जा रहा है…", rereadingBy: "{engine} से बिल फिर से पढ़ा जा रहा है…", filling: "पहले पढ़े गए बिल से भरा जा रहा है…", stop: "रोकें" },
};

const NE: OcrRunStrings = {
  amountMismatch: "रकम मिलेन (Dr / Cr, जम्मा वा अक्षरमा रकम)",
  dueDate: "भुक्तानी मिति",
  dueSource: { printed: "बिलमा छापिएको", bill_credit_days: "बिलमा {days} दिन उधारो", party_credit_days: "पार्टीको {days} दिन उधारो", default_days: "{days} दिन (कमन सेटिङ)" },
  journalLines: "जर्नल Dr / Cr लाइनहरू",
  journalLineAccount: "जर्नल लाइन {n} को खाता: {name}",
  journalNoLines: "जर्नल Dr / Cr लाइनहरू",
  voucherTypeSwitchPending: "भौचर प्रकार (परिवर्तनको सुझाव)",
  fail: {
    title: "{engine} ले यो बिल पढ्न सकेन",
    onlyEngine: "तपाईंले छान्नुभएको engine {engine} मात्र प्रयोग भयो। केही पनि भरिएन, त्यसैले केही पनि save हुँदैन।",
    reason: {
      quota: "Gemini को quota / rate limit सकियो।",
      overloaded: "Google को Gemini model अहिले व्यस्त छ। यो key वा quota को समस्या होइन।",
      fallback_failed: "दुवै Gemini model व्यस्त थिए: पहिले {model}, त्यसपछि {fallback}। यो key वा quota को समस्या होइन।",
      timeout: "Gemini ले जवाफ दिन धेरै समय लगायो।",
      network: "Gemini सम्म पुग्न सकिएन (इन्टरनेट वा server को समस्या)।",
      model: "यो Gemini model यो key को लागि उपलब्ध छैन।",
      no_key: "सेभ गरिएको Gemini key अस्वीकार भयो वा म्याद सकियो। OCR settings मा सही key सेभ गर्नुहोस्।",
      forbidden: "तपाईंलाई यसको अनुमति छैन।",
      disabled: "Online / AI OCR server मा वा यो company को लागि बन्द छ।",
      not_signed_in: "पहिले Pocket Ledger Server मा sign in गर्नुहोस्।",
      unreadable: "यो file मा पढ्न मिल्ने text भेटिएन।",
      unavailable: "यो OCR engine यो company को लागि सेट छैन वा अनुमति छैन।",
      other: "OCR server ले error पठायो। हेर्न तल Server विवरण खोल्नुहोस्।",
    },
    retryIn: "करिब {wait} पछि फेरि प्रयास गर्नुहोस्।",
    waitSec: "{n} सेकेन्ड",
    waitMin: "{n} मिनेट",
    hintQuota: "Gemini free tier मा हरेक मिनेट सीमित scan मात्र हुन्छ; limit छिट्टै reset हुन्छ। एक मिनेटपछि फेरि प्रयास गर्नुहोस्, वा त्यतिन्जेल Auto वा Google/Azure OCR प्रयोग गर्नुहोस्।",
    hintBusy: "केही सेकेन्डपछि फेरि OCR रिफ्रेस गर्नुहोस् थिच्नुहोस्।",
    hintOther: "माथिको कारण मिलाएर OCR रिफ्रेस गर्नुहोस् थिच्नुहोस्। आफैं दोस्रो engine चाहिए भने OCR settings → Switch Engine मा Auto छान्नुहोस्।",
    serverDetail: "Server विवरण",
    close: "बन्द गर्नुहोस्",
    refresh: "OCR रिफ्रेस गर्नुहोस्",
    fallbackNote: "{primary} व्यस्त थियो, त्यसैले यो बिल {model} ले पढ्यो।",
    modelTried: "Model: {model}",
    modelsTried: "प्रयास गरिएका model: {model} → {fallback}",
    otherModel: "दोस्रो model",
    pickModel: "अर्को engine प्रयास गर्नुहोस् (यो scan को लागि मात्र):",
    readWithModel: "यो engine ले पढ्नुहोस्",
    failedTag: "(भर्खर fail भयो)",
    engineGemini: "Gemini — {model}",
    engineAzure: "Azure OCR",
    engineGoogle: "Google Cloud Vision",
  },
  progress: { reading: "बिल पढ्दै…", readingBy: "{engine} ले बिल पढ्दै…", rereading: "बिल फेरि पढ्दै…", rereadingBy: "{engine} ले बिल फेरि पढ्दै…", filling: "पहिले पढिएको बिलबाट भर्दै…", stop: "रोक्नुहोस्" },
};

const TABLES: Record<string, OcrRunStrings> = { en: EN, hi: HI, ne: NE };

export function ocrRunStrings(langs?: PlLangs): OcrRunStrings {
  let l: PlLangs | undefined = langs;
  if (!l) { try { l = readPlLangs(); } catch { l = undefined; } }
  return (l && TABLES[l.ui]) || EN;
}

/** "{n}" / "{name}" / "{days}" placeholders. */
export function fmtOcr(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
