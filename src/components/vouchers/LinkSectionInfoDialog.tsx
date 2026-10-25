"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";

// Keep link-help content grouped by language and section so every voucher can reuse one consistent "Read me" guide.
const LINK_SECTION_INFO = {
  en: {
    title: "Read me – Link section",
    general: [
      "Linking connects related vouchers, so you can clearly track where money came from and where it was used.",
      "Use the Link buttons in this section to attach payment vouchers with bills or with other spend-wise entries.",
      "When you link bill wise, the party page will show bill wise status — Unpaid, Paid, Partial, Over due, etc.",
      "When you link spend wise, on the bank/cash page in spend wise view you can track transactions.",
      "E.g. where the amount from one Receipt (Voucher No. 001) was spent.",
      "When links are correct, your pending balance, settled status and follow-up report stay accurate.",
    ],
    billWise: [
      "Bill wise is used to settle sales and purchase bills against Receipt or Payment Out vouchers.",
      "Tap \"Link to Txns\" to select exact bills manually, or use \"Auto Link\" for quick suggestions (oldest 1st).",
      "Always check Total linked and Balance. If balance is zero, that bill-side payment is fully settled.",
    ],
    spendWise: [
      // Keep spend-wise guidance aligned with current two-card UI labels: Current Voucher and To Voucher.
      "Spend wise is used to map one inflow to one or more outflows, so fund usage is visible voucher by voucher.",
      "\"Current Voucher\" shows the source inflow or outflow, and \"To Voucher\" shows the current account inflow or outflow where the amount is used.",
    ],
    contra: [
      // Keep Contra examples focused on tracing where transferred money was finally used.
      "1. What is a Contra voucher? Contra is the voucher where you transfer money between your own Bank/Cash accounts. No customer or supplier is involved. Example: Bank → Cash or Cash → Bank. So money moves only between your own accounts.",
      "But to track from which voucher number of that same outgoing account the money was given, use \"Contra in to Other out\" and link the voucher where money was used.",
      // Example line clarifies voucher-number tracing in spend-wise view across Payment Out/Contra Out/Direct Expense.
      "2. Example: From Contra in Voucher No. 001, Rs 50 was spent. You can track in which Payment Out / Contra Out / Direct Expense voucher number that amount was used. If that used voucher number is linked with Contra in voucher 001, the bank page spend-wise view clearly shows where that individual inflow amount went.",
    ],
  },
  hi: {
    title: "Read me – Link section",
    general: [
      "Linking से संबंधित vouchers आपस में जुड़ते हैं, ताकि पैसा कहां से आया और कहां इस्तेमाल हुआ साफ दिखे।",
      "इस section के Link buttons से आप payment vouchers को bills या spend wise entries से जोड़ सकते हैं।",
      "जब bill wise में link होगा तो party page पर bill wise में status दिखेगा — Unpaid, Paid, Partial, Over due, आदि।",
      "जब spend wise में link होगा तो bank/cash page पर spend wise view में transaction track किया जा सकेगा।",
      "जैसे एक Receipt (Voucher No. 001) का amount कहाँ-कहाँ खर्च हुआ।",
      "सही linking रहने पर pending balance, settled status और follow-up report सभी सही आते हैं।",
    ],
    billWise: [
      "Bill wise का उपयोग Sales/Purchase bills को Receipt या Payment Out से settle करने के लिए होता है।",
      "\"Link to Txns\" से आप manually सही bills चुन सकते हैं, और \"Auto Link\" से system suggest करता है (oldest 1st)।",
      "Total linked और Balance जरूर देखें। Balance zero मतलब bill-side payment पूरी तरह settled है।",
    ],
    spendWise: [
      // Keep spend-wise guidance aligned with current two-card UI labels: Current Voucher and To Voucher.
      "Spend wise में एक inflow को एक या कई outflow से जोड़ा जाता है, ताकि fund flow पूरी तरह trace हो सके।",
      "\"Current Voucher\" में source inflow / outflow दिखता है और \"To Voucher\" में रकम जहां उपयोग होती है उस current account का inflow / outflow दिखता है।",
    ],
    contra: [
      // Contra text is kept aligned with the same tracing flow used in English/Nepali.
      "1. Contra voucher क्या होता है? Contra वह voucher है जिसमें आप अपने ही Bank/Cash accounts के बीच पैसा transfer करते हैं। इसमें बाहर का कोई customer या supplier शामिल नहीं होता। जैसे: Bank → Cash या Cash → Bank। यानी पैसा सिर्फ अपने accounts के बीच जाता है।",
      "लेकिन जिस account से पैसा गया, उसी account के किस voucher number से पैसा दिया गया, यह track करने के लिए \"Contra in to Other out\" में उस voucher को link करें जहां पैसा use हुआ है।",
      // यह उदाहरण spend-wise view में exact voucher number tracking को स्पष्ट करता है।
      "2. उदाहरण: Voucher No. Contra in 001 से Rs 50 खर्च हुआ। यह amount Payment Out / Contra Out / Direct Expense के किस voucher number में use/खर्च हुआ, इसे track किया जा सकता है। यदि उस used/खर्च voucher number को Contra in voucher 001 से link किया जाए, तो bank page के spend-wise view में individual inflow का पैसा कहां गया, यह साफ दिखता है।",
    ],
  },
  ne: {
    title: "Read me – Link section",
    general: [
      "Linking गर्दा सम्बन्धित vouchers आपसमा जोडिन्छन्, जसले पैसा कहाँबाट आयो र कहाँ प्रयोग भयो भन्ने स्पष्ट बनाउँछ।",
      "यो section का Link buttons प्रयोग गरेर payment vouchers लाई bills वा spend wise entries सँग जोड्न सकिन्छ।",
      "Bill wise link भएमा party page मा bill wise को status देखिन्छ — Unpaid, Paid, Partial, Over due, आदि।",
      "Spend wise link भएमा bank/cash page को spend wise view मा transaction track गर्न सकिन्छ।",
      "जस्तै एक Receipt (Voucher No. 001) को amount कहाँ-कहाँ खर्च भयो।",
      "सही linking भएपछि pending balance, settled status र follow-up report सबै भरपर्दो हुन्छन्।",
    ],
    billWise: [
      "Bill wise ले Sales/Purchase bills लाई Receipt वा Payment Out सँग settle गर्न सहयोग गर्छ।",
      "\"Link to Txns\" बाट तपाईंले bills manually छान्न सक्नुहुन्छ, र \"Auto Link\" ले छिटो सुझाव दिन्छ (oldest 1st)।",
      "Total linked र Balance अनिवार्य जाँच गर्नुहोस्। Balance zero भए bill-side payment पूर्ण settle भएको हो।",
    ],
    spendWise: [
      // Keep spend-wise guidance aligned with current two-card UI labels: Current Voucher and To Voucher.
      "Spend wise मा एउटा inflow लाई एक वा धेरै outflow सँग जोडेर fund flow लाई स्पष्ट रूपमा track गरिन्छ।",
      "\"Current Voucher\" मा हाल काम भइरहेको voucher देखिन्छ, र \"To Voucher\" मा रकम प्रयोग हुने current account को inflow / outflow देखिन्छ।",
      "यदि Current Voucher मा inflow छ भने \"From Voucher\" मा सोही account का outflow vouchers देखिन्छन्। त्यसैगरी, Current Voucher मा outflow छ भने \"From Voucher\" मा सोही account का inflow vouchers देखिन्छन्।",
    ],
    contra: [
      // Nepali guidance mirrors the same Contra-in to Other-out tracking behavior.
      "1. Contra voucher के हो? Contra त्यो voucher हो जसमा तपाईंले आफ्नै Bank/Cash accounts बीच पैसा स्थानान्तरण गर्नुहुन्छ। बाहिर कोही ग्राहक वा सप्लायर समावेश हुँदैन। जस्तै: Bank → Cash वा Cash → Bank। यानी पैसा आफ्नै accounts बीच मात्र जान्छ।",
      "तर जुन account बाट पैसा जान्छ, त्यो same account को कुन voucher number बाट दियो भन्ने track गर्न \"Contra in to Other out\" मा पैसा प्रयोग भएको voucher लाई link गर्नुपर्छ।",
      // यो उदाहरणले spend-wise view मा प्रयोग भएको exact voucher number track गर्ने तरिका देखाउँछ।
      "2. उदाहरण: Voucher No. Contra in 001 बाट Rs 50 खर्च भयो। त्यो amount Payment Out / Contra Out / Direct Expense को कुन voucher number मा प्रयोग/खर्च भयो, track गर्न सकिन्छ। यदि त्यो used/खर्च voucher number लाई Contra in voucher 001 सँग link गरियो भने, bank page को spend-wise view मा individual inflow को रकम कहाँ गयो भन्ने स्पष्ट देखिन्छ।",
    ],
  },
} as const;

// PC: max 12 inch width; mobile: near full width with safe padding, scrollable, touch-friendly.
const dialogContentClass =
  "w-[calc(100vw-1.5rem)] max-w-[12in] max-h-[85dvh] sm:max-h-[90vh] overflow-y-auto p-3 sm:p-6 rounded-lg";

/** Single box for one section (General / Bill wise / Spend wise / Contra); title + paragraphs inside, 30px gap between boxes. */
function SectionBox({
  title,
  paragraphs,
  className,
}: {
  title: string;
  paragraphs: readonly string[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/30 px-3 py-2.5 min-w-0 break-words",
        className
      )}
    >
      <h4 className="text-base font-bold text-foreground mb-2">{title}</h4>
      <div className="space-y-2">
        {paragraphs.map((p) => {
          // Keep all help text in one normal style (no flow-highlight bar), so numbered lines render uniformly.
          return (
            <p
              key={p}
              className="text-base font-medium text-foreground leading-relaxed break-words"
            >
              {p}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function LinkSectionInfoDialog({
  open,
  onOpenChange,
  className,
  showTrigger = false,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** When true, render the Read me + Info trigger button (e.g. when not controlled). */
  showTrigger?: boolean;
}) {
  const isControlled = open !== undefined && onOpenChange !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"en" | "hi" | "ne">("en");

  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  React.useEffect(() => {
    if (isOpen) setTab("en");
  }, [isOpen]);

  // Exactly 4 boxes: General, Bill wise, Payment In/Direct Income → Payment Out/Direct Exp, Contra (special) contra to Contra & contra to other; 30px gap.
  const renderLanguageContent = (lang: "en" | "hi" | "ne") => (
    <div className="flex flex-col gap-[30px]">
      <SectionBox title="General" paragraphs={LINK_SECTION_INFO[lang].general} />
      <SectionBox title="Bill wise" paragraphs={LINK_SECTION_INFO[lang].billWise} />
      <SectionBox title="Spend wise: Receipt / Direct Income / contra in → Payment Out / Direct Expense / contra out" paragraphs={LINK_SECTION_INFO[lang].spendWise} />
      {/* Keep Contra heading concise and aligned with current linking flow wording. */}
      <SectionBox title="Contra In to other out" paragraphs={LINK_SECTION_INFO[lang].contra} />
    </div>
  );

  const content = (
    <DialogContent
      overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
      className={cn(NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN, dialogContentClass, className)}
    >
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{LINK_SECTION_INFO[tab].title}</DialogTitle>
      </DialogHeader>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "en" | "hi" | "ne")} className="w-full min-w-0">
        <TabsList className="grid w-full grid-cols-3 h-10 sm:h-9 min-w-0">
          <TabsTrigger value="en" className="text-xs sm:text-sm py-2 min-h-[44px] sm:min-h-0">English</TabsTrigger>
          <TabsTrigger value="hi" className="text-xs sm:text-sm py-2 min-h-[44px] sm:min-h-0">हिंदी</TabsTrigger>
          <TabsTrigger value="ne" className="text-xs sm:text-sm py-2 min-h-[44px] sm:min-h-0">नेपाली</TabsTrigger>
        </TabsList>
        <TabsContent value="en" className="mt-3 space-y-0">{renderLanguageContent("en")}</TabsContent>
        <TabsContent value="hi" className="mt-3 space-y-0">{renderLanguageContent("hi")}</TabsContent>
        <TabsContent value="ne" className="mt-3 space-y-0">{renderLanguageContent("ne")}</TabsContent>
      </Tabs>
    </DialogContent>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {showTrigger && !isControlled && (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Link section information"
          >
            <Info className="h-4 w-4 shrink-0" />
            Read me
          </Button>
        </DialogTrigger>
      )}
      {content}
    </Dialog>
  );
}
