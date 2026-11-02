"use client";

import { useState, type ReactNode } from "react";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type SettingsInfoTipProps = {
  label: string;
  description: ReactNode;
  className?: string;
};

export function SettingsInfoTip({ label, description, className }: SettingsInfoTipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="md"
          className={cn(open && "border-blue-400 bg-blue-200/80 text-blue-400", className)}
          aria-label={`About ${label}`}
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        className="z-[10050] max-w-[min(22rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="mb-1.5 text-sm font-semibold">{label}</p>
        <div className="text-muted-foreground">{description}</div>
      </PopoverContent>
    </Popover>
  );
}

type SettingsLabelWithInfoProps = {
  htmlFor?: string;
  label: ReactNode;
  infoLabel: string;
  infoDescription: ReactNode;
  labelClassName?: string;
  className?: string;
};

export function SettingsLabelWithInfo({
  htmlFor,
  label,
  infoLabel,
  infoDescription,
  labelClassName,
  className,
}: SettingsLabelWithInfoProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Label htmlFor={htmlFor} className={labelClassName}>
        {label}
      </Label>
      <SettingsInfoTip label={infoLabel} description={infoDescription} />
    </div>
  );
}
