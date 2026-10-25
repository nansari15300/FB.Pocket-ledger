"use client";

/**
 * Column header text filter (same look/behaviour as the transactions table header filter):
 * funnel icon -> popover with a search input + clear; icon turns red while active.
 * Matching uses the shared helpers in @/lib/transactionColumnHeaderFilter.
 */
import { useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ColumnHeaderTextFilter({
  label,
  value,
  onChange,
  numeric = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  numeric?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isFiltered = value.trim().length > 0;
  const focusSoon = () => window.setTimeout(() => inputRef.current?.focus(), 0);
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-pl-txn-icon-btn=""
          className={cn("h-6 w-6 shrink-0", className)}
          aria-label={`Filter ${label}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className={cn("h-4 w-4", isFiltered && "text-red-600")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        className="z-[120] w-48 overflow-hidden p-0"
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault();
          focusSoon();
        }}
        onCloseAutoFocus={(e: Event) => e.preventDefault()}
      >
        <div className="relative p-1">
          <Input
            ref={inputRef}
            value={value}
            inputMode={numeric ? "decimal" : undefined}
            placeholder={`Filter ${label}...`}
            className="h-9 pr-9"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter") setOpen(false);
            }}
          />
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
                focusSoon();
              }}
              aria-label={`Clear ${label} filter`}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}