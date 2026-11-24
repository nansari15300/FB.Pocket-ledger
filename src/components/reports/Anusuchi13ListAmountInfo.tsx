"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import {
  pickAnusuchi13ListIntro,
  type Anusuchi13ListIntroSeg,
} from "@/lib/reports/anusuchi13ListIntro";
import { cn } from "@/lib/utils";

function IntroLine({ segs }: { segs: Anusuchi13ListIntroSeg[] }) {
  return (
    <p data-pl-intro="">
      {segs.map((seg, i) =>
        seg.en ? (
          <span key={i} data-pl-no-translate="">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </p>
  );
}

export function Anusuchi13ListAmountInfo({ className }: { className?: string }) {
  const i18n = usePlI18nOptional();
  const intro = pickAnusuchi13ListIntro(i18n?.intro);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="sm"
          className={cn(open && "border-blue-400 bg-blue-200/80 text-blue-400", className)}
          aria-label={intro.title}
          aria-expanded={open}
          title={intro.title}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="z-[10050] w-[min(22rem,calc(100vw-1.5rem))] p-0 text-left"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold leading-tight" data-pl-intro="">
            {intro.title}
          </p>
        </div>
        <div className="space-y-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <IntroLine segs={intro.notBalance} />
          <IntroLine segs={intro.fyTxns} />
          <IntroLine segs={intro.largerSide} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
