"use client";

import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";

/** (i) icon — cloud sync settings help (English). */
export function CloudSyncHelpPopover({
  label,
  description,
  hasError,
  side = "top",
}: {
  label: string;
  description: ReactNode;
  hasError?: boolean;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="md"
          className={cn(hasError && "ring-1 ring-destructive/40", open && "border-blue-400 bg-blue-200/80 text-blue-400")}
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
        <p className="font-semibold text-sm mb-1.5">{label}</p>
        <div className="text-muted-foreground space-y-2">{description}</div>
      </PopoverContent>
    </Popover>
  );
}
