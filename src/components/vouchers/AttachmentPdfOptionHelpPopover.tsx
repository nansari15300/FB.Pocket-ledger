"use client";

import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";

/** (i) icon — attachment PDF save options help. */
export function AttachmentPdfOptionHelpPopover({
  label,
  description,
  side = "top",
  className,
}: {
  label: string;
  description: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="sm"
          className={cn(open && "border-blue-400 bg-blue-200/80 text-blue-400", className)}
          aria-label={label}
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        collisionPadding={12}
        className="z-[10050] max-w-[min(22rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed text-foreground"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="mb-1.5 text-sm font-semibold">{label}</p>
        <div className="space-y-2 text-muted-foreground">{description}</div>
      </PopoverContent>
    </Popover>
  );
}
