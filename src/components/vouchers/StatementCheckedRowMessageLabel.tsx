"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStatementCheckedBlinkPrefs } from "@/hooks/useStatementCheckedBlinkPrefs";
import {
  STATEMENT_CHECKED_BLINK_CYCLE_MAX_SEC,
  STATEMENT_CHECKED_BLINK_CYCLE_MIN_SEC,
} from "@/lib/statementCheckedBlinkPrefs";
import {
  STATEMENT_CHECKED_ROW_INFO_TEXT,
  STATEMENT_CHECKED_ROW_INFO_TITLE,
  STATEMENT_CHECKED_ROW_MESSAGE,
  STATEMENT_CHECKED_ROW_MESSAGE_CLASS,
} from "@/lib/statementCheckRowMessage";

type Props = {
  className?: string;
  align?: "start" | "center" | "end";
};

export function StatementCheckedRowMessageLabel({ className, align = "end" }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { prefs, updatePrefs } = useStatementCheckedBlinkPrefs();

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1",
        align === "end" && "justify-end",
        align === "start" && "justify-start",
        align === "center" && "justify-center",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={STATEMENT_CHECKED_ROW_MESSAGE_CLASS}>{STATEMENT_CHECKED_ROW_MESSAGE}</span>
      <Popover>
        <PopoverTrigger asChild>
          <AppFreshInfoButton
            size="xs"
            aria-label="Statement checked — more information"
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-80 text-sm leading-relaxed"
          data-pl-intro=""
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="font-semibold text-foreground">{STATEMENT_CHECKED_ROW_INFO_TITLE}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 shrink-0 rounded-full",
                settingsOpen && "bg-muted text-foreground"
              )}
              aria-label="Blinking settings"
              aria-pressed={settingsOpen}
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((v) => !v);
              }}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-muted-foreground">{STATEMENT_CHECKED_ROW_INFO_TEXT}</p>
          {settingsOpen ? (
            <div className="mt-3 space-y-3 rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="pl-statement-checked-blink" className="text-sm font-medium leading-none">
                  Blinking
                </Label>
                <Switch
                  id="pl-statement-checked-blink"
                  checked={prefs.enabled}
                  onCheckedChange={(checked) => updatePrefs({ enabled: Boolean(checked) })}
                />
              </div>
              {prefs.enabled ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="pl-statement-checked-blink-cycle" className="text-xs text-muted-foreground">
                      Repeat every
                    </Label>
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {prefs.cycleSeconds} sec
                    </span>
                  </div>
                  <Slider
                    id="pl-statement-checked-blink-cycle"
                    min={STATEMENT_CHECKED_BLINK_CYCLE_MIN_SEC}
                    max={STATEMENT_CHECKED_BLINK_CYCLE_MAX_SEC}
                    step={1}
                    value={[prefs.cycleSeconds]}
                    onValueChange={(values) => {
                      const next = values[0];
                      if (typeof next === "number") updatePrefs({ cycleSeconds: next });
                    }}
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {prefs.cycleSeconds <= 1
                      ? "Three fast blinks every second."
                      : `Three fast blinks in the first second only, then pause until the next cycle (max ${STATEMENT_CHECKED_BLINK_CYCLE_MAX_SEC} sec).`}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
