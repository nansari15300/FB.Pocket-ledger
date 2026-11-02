"use client";

import { useState, type MouseEvent } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getBsCheckHelp,
  type BsCheckHelpLang,
} from "@/lib/reports/balanceSheetCheckEngineHelp";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";

type Props = {
  checkId: string;
  compact?: boolean;
  className?: string;
};

const LANGS: { id: BsCheckHelpLang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ne", label: "नेपाली" },
];

export function BalanceSheetCheckHelpInfo({ checkId, compact = true, className }: Props) {
  const copy = getBsCheckHelp(checkId);
  const i18n = usePlI18nOptional();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<BsCheckHelpLang>(() => introTabLang(i18n?.intro));

  if (!copy) return null;

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <AppFreshInfoButton
              size={compact ? "xs" : "sm"}
              className={className}
              aria-label={`${copy.en.title} — help`}
              onClick={(e) => {
                stop(e);
                e.preventDefault();
                setLang(introTabLang(i18n?.intro));
                setOpen(true);
              }}
              onMouseDown={stop}
              onPointerDown={stop}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-xs" data-pl-intro="">
            What is this? What went wrong? What to do — English / हिन्दी / नेपाली
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[150] flex max-h-[min(85vh,36rem)] w-[min(96vw,32rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
          overlayClassName="z-[150]"
          onClick={stop}
          onMouseDown={stop}
          onPointerDown={stop}
        >
          <DialogHeader className="space-y-1 border-b px-4 pb-3 pt-4 text-left">
            <DialogTitle className="text-base">{copy[lang].title}</DialogTitle>
            <DialogDescription className="text-xs">
              English · हिन्दी · नेपाली — what this check means and how to fix
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={lang}
            onValueChange={(v) => setLang(v as BsCheckHelpLang)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b px-3 pt-2">
              <TabsList className="grid h-9 w-full grid-cols-3">
                {LANGS.map((l) => (
                  <TabsTrigger key={l.id} value={l.id} className="text-xs">
                    {l.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {LANGS.map((l) => {
                const block = copy[l.id];
                return (
                  <TabsContent key={l.id} value={l.id} className="m-0 space-y-3 focus-visible:outline-none">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        Introduction
                      </p>
                      <p className="text-sm leading-relaxed">{block.intro}</p>
                    </div>
                    <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-900 mb-1">What is wrong?</p>
                      <p className="text-sm leading-relaxed text-amber-950">{block.whatWrong}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        What to do
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-sm leading-relaxed">
                        {block.whatToDo.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>
                    {block.mappingHint ? (
                      <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Group mapping</p>
                        <p className="text-sm leading-relaxed text-blue-950">{block.mappingHint}</p>
                      </div>
                    ) : null}
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

export function BalanceSheetCheckSectionHelp({
  sectionId,
  title,
  className,
}: {
  sectionId: string;
  title: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span>{title}</span>
      <BalanceSheetCheckHelpInfo checkId={sectionId} compact />
    </span>
  );
}
