/**
 * Company display setting `calendarDateSystem` ke hisaab se copy — recurring / auto voucher UI.
 * Engine ab bhi BS schedule use karta hai; AD mode me labels Gregorian reference dikhate hain.
 * Deletion: due se pehle delete par dubara generate ho sakta hai; due ke baad delete par `suppressedPeriodKeys` = us BS month (period).
 */
export type CalendarDisplayMode = "AD" | "BS" | "Both";

export function recurringAutoVoucherLabels(mode: CalendarDisplayMode) {
  if (mode === "AD") {
    return {
      settingsIntro:
        "Schedule uses the Bikram Sambat (BS) calendar: “last day” means the last day of that BS month, which maps to a normal Gregorian (AD) date on the voucher — often mid-month in AD, not the 30th/31st of an AD month. " +
        "Optional increase by percent or fixed amount; N under every N months/years is the interval (1–24). " +
        "Yearly mode uses the month and day from “Apply increase from”. Save in this window only stores schedule and rate here (then closes); turn Auto Monthly on or off with the main voucher Save. " +
        "Generate now (when allowed) opens a list when several BS months are missing: each row shows the voucher date for that period; tick rows to create only those, Select all for every gap, or leave all unticked to create just the most recent missing month. " +
        "(Delete before the scheduled day → can run again on that day; delete on or after that day → no auto recreate for that BS month.) " +
        "Journal: same debit/credit account lines share one template — Auto on/off on any month’s voucher applies to the whole series.",
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
      settingsIntro:
        "Schedule day, optional increase by percent or fixed amount. Your company shows both AD and BS — schedule " +
        "rules use BS month boundaries. For % or fixed, N means the interval you enter under Every (BS months) or " +
        "Every (BS years): 1 = every eligible period, 2 = every second period, and so on (up to 24). " +
        "Yearly mode uses the month and day from “Apply increase from”. Save here only stores schedule and rate (closes this window); Auto on/off uses main voucher Save. " +
        "Generate now (when allowed) opens a list when several BS months are missing: each row shows the voucher date for that period; tick rows to create only those, Select all for every gap, or leave all unticked to create just the most recent missing month. " +
        "(Delete before the scheduled day → can run again on that day; delete on or after that day → no auto recreate for that BS month.) " +
        "Journal: same debit/credit account lines share one template — Auto on/off on any month’s voucher applies to the whole series.",
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
    settingsIntro:
      "Schedule day, optional increase by percent or fixed amount. For % or fixed, N is the interval you set under " +
      "Every (BS months) or Every (BS years): 1 = every eligible period, 2 = every second period, etc. (max 24). " +
      "Yearly mode takes BS month and day from “Apply increase from” on the calendar. Save here only stores schedule and rate (closes this window); Auto on/off uses main voucher Save. " +
      "Generate now (when allowed) opens a list when several BS months are missing: each row shows the voucher date for that period; tick rows to create only those, Select all for every gap, or leave all unticked to create just the most recent missing month. " +
      "(Delete before the scheduled day → can run again on that day; delete on or after that day → no auto recreate for that BS month.) " +
      "Journal: same debit/credit account lines share one template — Auto on/off on any month’s voucher applies to the whole series.",
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
