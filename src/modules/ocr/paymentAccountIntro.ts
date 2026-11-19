/**
 * Intro-language copy for the non-action OCR note when a document names no payment account.
 */
import { introTabLang, type IntroTabLang } from "@/lib/i18n/introLangTab";

export const NO_PAYMENT_ACCOUNT_ON_DOC: Record<IntroTabLang, string> = {
  en: "No payment account on doc",
  hi: "दस्तावेज़ पर कोई भुगतान खाता नहीं है",
  ne: "कागजातमा कुनै भुक्तानी खाता छैन",
};

export function noPaymentAccountOnDocIntro(introLang?: string | null): string {
  return NO_PAYMENT_ACCOUNT_ON_DOC[introTabLang(introLang)];
}
