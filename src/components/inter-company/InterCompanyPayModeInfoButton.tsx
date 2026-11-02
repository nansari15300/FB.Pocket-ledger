"use client";

import { useState, type MouseEvent } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";

const INTRO = {
  en: {
    title: "Inter Company pay modes",
    subtitle:
      "These modes decide how the same Inter Company voucher is posted on the target company. The source side posting rules stay the same; only the target-side treatment of the destination account changes.",
    accountTitle: "Account to Account",
    accountBody: [
      "Under Account to Account payment, the amount is treated as a deposit into the target company’s selected account.",
      "Because the money is posted as a deposit in that account’s ledger, the target account balance increases.",
      "On the target company, the voucher is posted in the normal Receipt manner, using standard Debit / Credit on the destination account.",
    ],
    companyTitle: "Company to Company",
    companyBody: [
      "Under Company to Company pay, the target company’s selected account is treated as a payment from that account.",
      "Because the amount is regarded as a payment out of the target account, the target account balance decreases.",
      "On the target company, the voucher is posted as a Journal, with reversed Debit / Credit on the destination account.",
    ],
  },
  hi: {
    title: "इंटर कंपनी भुगतान मोड",
    subtitle:
      "ये मोड तय करते हैं कि वही इंटर कंपनी वाउचर लक्ष्य कंपनी पर कैसे प्रविष्ट होगा। स्रोत पक्ष के नियम वही रहते हैं; केवल गंतव्य खाते का लक्ष्य-पक्ष उपचार बदलता है।",
    accountTitle: "खाता से खाता (Account to Account)",
    accountBody: [
      "Account to Account भुगतान में राशि लक्ष्य कंपनी के चुने हुए खाते में जमा मानी जाती है।",
      "क्योंकि पैसा लक्ष्य खाते के खाते में जमा (deposit) होता है, लक्ष्य खाते का शेष बढ़ता है।",
      "लक्ष्य कंपनी पर वाउचर सामान्य Receipt की रीति से प्रविष्ट होता है, और गंतव्य खाते पर सामान्य डेबिट / क्रेडिट लागू होता है।",
    ],
    companyTitle: "कंपनी से कंपनी (Company to Company)",
    companyBody: [
      "Company to Company भुगतान में लक्ष्य कंपनी के चुने हुए खाते को उस खाते से किया गया भुगतान माना जाता है।",
      "क्योंकि राशि लक्ष्य खाते से भुगतान मानी जाती है, लक्ष्य खाते का शेष घटता है।",
      "लक्ष्य कंपनी पर वाउचर Journal के रूप में प्रविष्ट होता है, और गंतव्य खाते पर उल्टे डेबिट / क्रेडिट लागू होते हैं।",
    ],
  },
  ne: {
    title: "इन्टर कम्पनी भुक्तानी मोड",
    subtitle:
      "यी मोडले उही इन्टर कम्पनी भाउचर लक्षित कम्पनीमा कसरी प्रविष्टि हुन्छ भन्ने निर्धारण गर्छन्। स्रोत पक्षका नियम उस्तै रहन्छन्; केवल गन्तव्य खाताको लक्षित-पक्ष व्यवहार परिवर्तन हुन्छ।",
    accountTitle: "खाताबाट खाता (Account to Account)",
    accountBody: [
      "Account to Account भुक्तानीमा रकम लक्षित कम्पनीको चयनित खातामा जम्मा (deposit) मानिन्छ।",
      "किनकि पैसा लक्षित खाताको खातामा जम्मा हुन्छ, लक्षित खाताको मौज्दात बढ्छ।",
      "लक्षित कम्पनीमा भाउचर सामान्य Receipt तरिकाले प्रविष्टि हुन्छ, र गन्तव्य खातामा सामान्य डेबिट / क्रेडिट लागू हुन्छ।",
    ],
    companyTitle: "कम्पनीबाट कम्पनी (Company to Company)",
    companyBody: [
      "Company to Company भुक्तानीमा लक्षित कम्पनीको चयनित खातालाई सो खाताबाट भएको भुक्तानी मानिन्छ।",
      "किनकि रकम लक्षित खाताबाट भुक्तानी मानिन्छ, लक्षित खाताको मौज्दात घट्छ।",
      "लक्षित कम्पनीमा भाउचर Journal रूपमा प्रविष्टि हुन्छ, र गन्तव्य खातामा उल्टो डेबिट / क्रेडिट लागू हुन्छ।",
    ],
  },
} as const;

type Lang = keyof typeof INTRO;

type Props = {
  className?: string;
  /** Ribbon badge — thoda chhota icon */
  compact?: boolean;
};

/** Hover: short tip. Click: bada Dialog — English / हिन्दी / नेपाली full intro. */
export function InterCompanyPayModeInfoButton({ className, compact = false }: Props) {
  const i18n = usePlI18nOptional();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>(() => introTabLang(i18n?.intro));

  const stopLabelSelect = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                // Lucide Info already has one circle — no extra border (double ring looked rough).
                "inline-flex shrink-0 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-sky-400 dark:hover:bg-sky-950/40 dark:hover:text-sky-300",
                compact ? "h-3.5 w-3.5" : "h-4 w-4",
                className
              )}
              aria-label="Pay mode information"
              data-pl-intro=""
              onClick={(e) => {
                stopLabelSelect(e);
                e.preventDefault();
                setLang(introTabLang(i18n?.intro));
                setOpen(true);
              }}
              onMouseDown={stopLabelSelect}
              onPointerDown={stopLabelSelect}
            >
              <Info
                className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "stroke-[2]")}
                aria-hidden
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-xs" data-pl-intro="">
            Click for full pay-mode intro (English / Hindi / Nepali).
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[140] flex max-h-[min(90vh,40rem)] w-[min(96vw,36rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
          overlayClassName="z-[140]"
          onClick={stopLabelSelect}
          onMouseDown={stopLabelSelect}
          onPointerDown={stopLabelSelect}
        >
          <DialogHeader className="space-y-1 border-b px-5 pb-3 pt-5 text-left">
            <DialogTitle className="text-base sm:text-lg">Inter Company pay modes</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Account to Account increases the target account balance (deposit). Company to Company
              decreases it (payment). Choose a language tab for the full formal introduction.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4 pt-3">
              <TabsList className="grid h-10 w-full grid-cols-3">
                <TabsTrigger value="en" className="text-xs sm:text-sm">
                  English
                </TabsTrigger>
                <TabsTrigger value="hi" className="text-xs sm:text-sm">
                  हिन्दी
                </TabsTrigger>
                <TabsTrigger value="ne" className="text-xs sm:text-sm">
                  नेपाली
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {(Object.keys(INTRO) as Lang[]).map((tabLang) => {
                const copy = INTRO[tabLang];
                return (
                  <TabsContent key={tabLang} value={tabLang} className="m-0 mt-0 space-y-4 focus-visible:outline-none">
                    <div>
                      <p className="text-sm font-semibold leading-snug sm:text-base">{copy.title}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
                    </div>

                    <section className="rounded-md border border-emerald-700/25 bg-emerald-50/50 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-950/25">
                      <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                        {copy.accountTitle}
                      </h3>
                      <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed text-foreground/90">
                        {copy.accountBody.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </section>

                    <section className="rounded-md border border-sky-700/25 bg-sky-50/50 p-3.5 dark:border-sky-500/30 dark:bg-sky-950/25">
                      <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                        {copy.companyTitle}
                      </h3>
                      <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed text-foreground/90">
                        {copy.companyBody.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </section>
                  </TabsContent>
                );
              })}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
