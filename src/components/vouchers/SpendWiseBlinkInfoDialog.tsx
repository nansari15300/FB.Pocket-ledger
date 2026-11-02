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
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";

const BLINK_INFO = {
  en: {
    title: "About Blink",
    body: "This Blink option helps you quickly spot inflow transactions (money received) and track which ones still have an unsettled balance. When a group's running balance is not zero, that balance blinks so you can easily see which inflow has not been fully used or linked.",
    rowBody:
      "Blink row works differently: when you select a row that is part of a partial-linked voucher (same voucher split across multiple rows), the balance blinks on all rows with that voucher number—including rows marked Settled. Only the clicked row gets the selection border.",
  },
  hi: {
    title: "ब्लिंक के बारे में",
    body: "यह Blink विकल्प आपको Inflow Transaction (जो रकम मिली है) जल्दी ढूंढने और किस Transaction का पूरा खर्च नहीं हुआ है उसे Track करने में मदद करता है। जब किसी Group का Running Balance शून्य नहीं होता, तो वह Balance Blink करता है ताकि आप आसानी से देख सकें कि कौन सा Inflow पूरी तरह इस्तेमाल या लिंक नहीं हुआ है।",
    rowBody:
      "Blink row अलग तरीके से काम करता है: जब आप partial-linked voucher की कोई row चुनते हैं (एक ही voucher की कई rows), तो उसी voucher number की सभी rows पर balance blink होता है—Settled वाली row पर भी। सिर्फ click की गई row पर selection border दिखता है।",
  },
  ne: {
    title: "ब्लिंकको बारेमा",
    body: "यो Blink विकल्पले तपाईंलाई Inflow Transaction (पैसा प्राप्त भएको) छिटो फेला पार्न र कुन Transaction को पूरा खर्च भएको छैन त्यो Track गर्न मद्दत गर्छ। जब कुनै Group को Running Balance शून्य हुँदैन, त्यो Balance Blink हुन्छ ताकि तपाईंले सजिलै देख्न सक्नुहुन्छ कुन Inflow पूर्ण रूपमा प्रयोग वा लिंक भएको छैन।",
    rowBody:
      "Blink row ले फरक तरिकाले काम गर्छ: partial-linked voucher को row छान्दा (एउटै voucher को धेरै rows) भने, त्यही voucher number भएका सबै rows मा balance blink हुन्छ—Settled भएको row मा पनि। click गरिएको row मा मात्र selection border देखिन्छ।",
  },
} as const;

/** PC: larger popup; mobile: full-width, scrollable, touch-friendly */
const dialogContentClass =
  "max-w-md sm:max-w-lg md:max-w-xl w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto p-4 sm:p-6";

export function SpendWiseBlinkInfoDialog({
  open,
  onOpenChange,
  className,
}: {
  /** Controlled: when provided, dialog is opened from outside (e.g. dropdown item). No trigger rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const i18n = usePlI18nOptional();
  const isControlled = open !== undefined && onOpenChange !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"en" | "hi" | "ne">(() => introTabLang(i18n?.intro));

  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  React.useEffect(() => {
    if (isOpen) setTab(introTabLang(i18n?.intro));
  }, [isOpen, i18n?.intro]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Blink feature information"
            data-pl-intro=""
          >
            <Info className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
        className={cn(NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN, dialogContentClass, className)}
      >
        <DialogHeader>
          <DialogTitle>{BLINK_INFO[tab].title}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "en" | "hi" | "ne")} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="hi">हिंदी</TabsTrigger>
            <TabsTrigger value="ne">नेपाली</TabsTrigger>
          </TabsList>
          <TabsContent value="en" className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {/* Keep row-mode introduction as a separate paragraph for clarity. */}
            <div className="space-y-3">
              <p>{BLINK_INFO.en.body}</p>
              <p>{BLINK_INFO.en.rowBody}</p>
            </div>
          </TabsContent>
          <TabsContent value="hi" className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {/* Keep row-mode introduction as a separate paragraph for clarity. */}
            <div className="space-y-3">
              <p>{BLINK_INFO.hi.body}</p>
              <p>{BLINK_INFO.hi.rowBody}</p>
            </div>
          </TabsContent>
          <TabsContent value="ne" className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {/* Keep row-mode introduction as a separate paragraph for clarity. */}
            <div className="space-y-3">
              <p>{BLINK_INFO.ne.body}</p>
              <p>{BLINK_INFO.ne.rowBody}</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
