/**
 * Company display setting `calendarDateSystem` ke hisaab se copy — recurring / auto voucher UI.
 * Engine ab bhi BS schedule use karta hai; AD mode me labels Gregorian reference dikhate hain.
 * Deletion: due se pehle delete par dubara generate ho sakta hai; due ke baad delete par `suppressedPeriodKeys` = us BS month (period).
 */
export type CalendarDisplayMode = "AD" | "BS" | "Both";
import { pickIntroCopy } from "@/lib/i18n/introCopy";

export function recurringAutoVoucherLabels(mode: CalendarDisplayMode, introLang = "en") {
  const settingsIntro = pickIntroCopy(introLang, {
    en:
      "Schedule day, optional increase by percent or fixed amount. Your company may show AD, BS, or both; recurring schedule boundaries use BS months. For % or fixed, N is the interval under Every (BS months) or Every (BS years): 1 = each eligible period, 2 = every second period, up to 24. Yearly mode uses the month and day from Apply increase from. Save here stores schedule and rate and closes this window; Auto on/off uses the main voucher Save. Generate now (when allowed) lists missing BS months so you can choose which vouchers to create. Deleting before the scheduled day allows generation again that day; deleting on or after it prevents recreation for that BS month. Journal account lines share one template, so Auto on/off applies to the whole series.",
    hi:
      "शेड्यूल का दिन चुनें और चाहें तो प्रतिशत या निश्चित राशि से बढ़ोतरी तय करें। आपकी कंपनी AD, BS या दोनों तारीख़ें दिखा सकती है; recurring शेड्यूल BS महीनों के आधार पर चलता है। प्रतिशत या निश्चित बढ़ोतरी में Every (BS months) या Every (BS years) का N अंतराल बताता है: 1 = हर योग्य अवधि, 2 = हर दूसरी अवधि, अधिकतम 24। वार्षिक मोड में महीना और दिन Apply increase from से लिया जाता है। यहाँ Save करने से शेड्यूल और दर सेव होकर यह विंडो बंद होती है; Auto on/off मुख्य वाउचर के Save से लागू होता है। Generate now (यदि अनुमति हो) छूटे हुए BS महीने दिखाता है, जिनमें से आप वाउचर चुन सकते हैं। तय दिन से पहले हटाया वाउचर उसी दिन फिर बनाया जा सकता है; तय दिन या उसके बाद हटाने पर उस BS महीने में वह फिर अपने आप नहीं बनेगा। जर्नल की अकाउंट लाइनें एक ही टेम्पलेट साझा करती हैं, इसलिए Auto on/off पूरी सीरीज़ पर लागू होता है।",
    ne:
      "तालिकाको दिन छान्नुहोस् र चाहेमा प्रतिशत वा निश्चित रकमको वृद्धि राख्नुहोस्। कम्पनीमा AD, BS वा दुवै मिति देखिन सक्छन्; recurring तालिका BS महिनाका आधारमा चल्छ। प्रतिशत वा निश्चित वृद्धिमा Every (BS months) वा Every (BS years) को N ले अन्तराल जनाउँछ: 1 = प्रत्येक योग्य अवधि, 2 = प्रत्येक दोस्रो अवधि, अधिकतम 24। वार्षिक मोडमा महिना र दिन Apply increase from बाट लिइन्छ। यहाँ Save गर्दा तालिका र दर सेभ भएर यो विन्डो बन्द हुन्छ; Auto on/off मुख्य भौचरको Save बाट लागू हुन्छ। Generate now (अनुमति भएमा) ले छुटेका BS महिनाहरू देखाउँछ, जहाँबाट बनाउनुपर्ने भौचर छान्न सकिन्छ। तोकिएको दिनभन्दा अघि मेटाएको भौचर सोही दिन फेरि बनाउन सकिन्छ; तोकिएको दिन वा त्यसपछि मेटाएमा त्यो BS महिनामा फेरि स्वतः बन्दैन। जर्नलका खाता लाइनहरूले एउटै टेम्प्लेट साझा गर्छन्, त्यसैले Auto on/off पूरै सिरिजमा लागू हुन्छ।",
  });
  if (mode === "AD") {
    return {
      settingsIntro,
      scheduleMonthDayLabel: "BS month day (generate on)",
      lastDayOfScheduledMonth: "Last day of BS month",
      everyMonthOption: "Every AD month",
      oncePerYearOption: "Once per AD year",
      everyNMonthsLabel: "Every (AD months)",
      bumpWhenMonthLabel: "Month when bump applies (BS month names)",
      bumpDayLabel: "Day of month",
      everyNYearsLabel: "Every (AD years)",
      applyIncreaseFromLabel: "Apply increase from (AD)",
    };
  }
  if (mode === "Both") {
    return {
      settingsIntro,
      scheduleMonthDayLabel: "BS month day (generate on)",
      lastDayOfScheduledMonth: "Last day of BS month",
      everyMonthOption: "Every AD / BS month",
      oncePerYearOption: "Once per AD / BS year",
      everyNMonthsLabel: "Every (AD / BS months)",
      bumpWhenMonthLabel: "BS month (when bump applies)",
      bumpDayLabel: "BS day",
      everyNYearsLabel: "Every (AD / BS years)",
      applyIncreaseFromLabel: "Apply increase from (BS / AD)",
    };
  }
  return {
    settingsIntro,
    scheduleMonthDayLabel: "BS month day (generate on)",
    lastDayOfScheduledMonth: "Last day of BS month",
    everyMonthOption: "Every BS month (each scheduled voucher)",
    oncePerYearOption: "Once per BS year",
    everyNMonthsLabel: "Every (BS months)",
    bumpWhenMonthLabel: "BS month (when bump applies)",
    bumpDayLabel: "BS day",
    everyNYearsLabel: "Every (BS years)",
    applyIncreaseFromLabel: "Apply increase from (BS)",
  };
}
