"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BILLING_FEATURE_HELP,
  type BillingHelpKey,
  type BillingHelpLang,
} from "@/lib/billingFeatureHelp";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";

type Props = {
  helpKey: BillingHelpKey;
  className?: string;
};

const LANGS: BillingHelpLang[] = ["en", "hi", "ne"];

/** Blue (i) — click opens English / Hindi / Nepali help for a billing feature row. */
export function BillingFeatureInfoButton({ helpKey, className }: Props) {
  const i18n = usePlI18nOptional();
  const [open, setOpen] = useState(false);
  const copy = BILLING_FEATURE_HELP[helpKey];
  if (!copy) return null;

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <AppFreshInfoButton
        size="xs"
        className={className}
        aria-label={`About ${copy.title.en}`}
        onClick={(e) => {
          stop(e);
          e.preventDefault();
          setOpen(true);
        }}
        onMouseDown={stop}
        onPointerDown={stop}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[140] flex max-h-[min(90vh,28rem)] w-[min(96vw,28rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
          overlayClassName="z-[140]"
          onClick={stop}
          onMouseDown={stop}
          onPointerDown={stop}
        >
          <DialogHeader className="space-y-1 border-b px-4 pb-3 pt-4 text-left">
            <DialogTitle className="text-base">{copy.title.en}</DialogTitle>
            <DialogDescription className="text-xs">
              English / हिन्दी / नेपाली — choose a tab for the full note.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue={introTabLang(i18n?.intro)} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-3 pt-2">
              <TabsList className="grid h-9 w-full grid-cols-3">
                <TabsTrigger value="en" className="text-xs">
                  English
                </TabsTrigger>
                <TabsTrigger value="hi" className="text-xs">
                  हिन्दी
                </TabsTrigger>
                <TabsTrigger value="ne" className="text-xs">
                  नेपाली
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {LANGS.map((lang) => (
                <TabsContent key={lang} value={lang} className="m-0 space-y-2 focus-visible:outline-none">
                  <p className="text-sm font-semibold leading-snug">{copy.title[lang]}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {copy.body[lang]}
                  </p>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Label + blue (i) in one row for billing feature / pricing cells. */
export function BillingFeatureLabelWithInfo({
  helpKey,
  label,
  className,
}: {
  helpKey: BillingHelpKey;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <span className="min-w-0 flex-1">{label}</span>
      <BillingFeatureInfoButton helpKey={helpKey} className="shrink-0" />
    </span>
  );
}
