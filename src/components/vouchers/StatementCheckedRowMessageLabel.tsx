"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DIALOG_SHELL_ATTR } from "@/lib/dialogShellChrome";
import { useStatementCheckedBlinkPrefs } from "@/hooks/useStatementCheckedBlinkPrefs";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { toast as sonnerToast } from "sonner";
import {
  STATEMENT_CHECKED_BLINK_CYCLE_MAX_SEC,
  STATEMENT_CHECKED_BLINK_CYCLE_MIN_SEC,
} from "@/lib/statementCheckedBlinkPrefs";
import {
  getReconciledPointCopy,
  STATEMENT_CHECKED_ROW_MESSAGE_CLASS,
  STATEMENT_CHECKED_ROW_MESSAGE_DIM_CLASS,
} from "@/lib/statementCheckRowMessage";

type Props = {
  className?: string;
  align?: "start" | "center" | "end";
  isDim?: boolean;
  markedBy?: string | null;
  markedAt?: string | null;
  message?: string | null;
  onSaveMessage?: (message: string) => void | Promise<void>;
  canEditNote?: boolean;
};

export function StatementCheckedRowMessageLabel({
  className,
  align = "end",
  isDim = false,
  markedBy,
  markedAt,
  message,
  onSaveMessage,
  canEditNote = true,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localNote, setLocalNote] = useState(message || "");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const { prefs, updatePrefs } = useStatementCheckedBlinkPrefs();
  const i18n = usePlI18nOptional();
  const copy = getReconciledPointCopy(i18n?.intro || "en");

  useEffect(() => {
    setLocalNote(message || "");
  }, [message]);

  const noteChanged = localNote.trim() !== (message || "").trim();

  const handleSaveNote = async () => {
    if (!onSaveMessage) return;
    setIsSavingNote(true);
    try {
      await onSaveMessage(localNote.trim());
      sonnerToast.success(copy.savedToast);
    } catch {
      sonnerToast.error("Failed to save note");
    } finally {
      setIsSavingNote(false);
    }
  };

  const formattedDate = (() => {
    if (!markedAt) return "—";
    try {
      if (typeof window !== "undefined" && (window as any).plDate?.format) {
        return (window as any).plDate.format(markedAt, { time: true });
      }
      return new Date(markedAt).toLocaleString();
    } catch {
      return String(markedAt);
    }
  })();

  const labelText = isDim ? "Reconciled Point (Past)" : "Reconciled Point";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5",
        align === "end" && "justify-end",
        align === "start" && "justify-start",
        align === "center" && "justify-center",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        translate="no"
        className={cn(
          isDim ? STATEMENT_CHECKED_ROW_MESSAGE_DIM_CLASS : STATEMENT_CHECKED_ROW_MESSAGE_CLASS,
          "notranslate transition-opacity"
        )}
      >
        {labelText}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <AppFreshInfoButton
            size="xs"
            aria-label={`${copy.title} — more information`}
            className={cn("shrink-0", isDim && "opacity-60 hover:opacity-100")}
            onClick={(e) => e.stopPropagation()}
          />
        </PopoverTrigger>
        <PopoverContent
          align={align}
          {...DIALOG_SHELL_ATTR}
          translate="no"
          className="notranslate w-[390px] max-w-[92vw] text-sm leading-relaxed p-4 shadow-xl bg-card border-emerald-300/85 dark:border-emerald-700/60 rounded-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* TOP SECTION: User, Date, Note / Message Input (ALWAYS ENGLISH) */}
          <div
            translate="no"
            className="notranslate mb-3.5 rounded-lg border border-emerald-200/90 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800/60 p-3 text-xs space-y-2.5 shadow-sm"
          >
            <div className="flex items-center justify-between font-semibold text-foreground border-b border-emerald-200/70 dark:border-emerald-800/50 pb-2">
              <span className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold notranslate">Reconciled Point Details</span>
              </span>
              <span
                className={cn(
                  "notranslate text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border",
                  isDim
                    ? "bg-amber-100 text-amber-800 border-amber-300/70 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700/50"
                    : "bg-emerald-100 text-emerald-800 border-emerald-300/70 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700/50"
                )}
              >
                {isDim ? "Past Point" : "Active Point"}
              </span>
            </div>

            {isDim ? (
              <p className="notranslate text-[11px] text-amber-800 dark:text-amber-200/90 leading-tight">
                This is a historic Reconciled Point. A newer active point exists further down this ledger.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 text-muted-foreground pt-0.5">
              <div className="min-w-0">
                <span className="notranslate block font-medium text-foreground text-[11px] mb-1">Marked by</span>
                <span className="truncate block font-mono text-[11px] bg-background/90 px-2 py-1 rounded border border-emerald-200/70 dark:border-emerald-800/60" title={markedBy || "—"}>
                  {markedBy || "—"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="notranslate block font-medium text-foreground text-[11px] mb-1">Date</span>
                <span className="truncate block text-[11px] bg-background/90 px-2 py-1 rounded border border-emerald-200/70 dark:border-emerald-800/60" title={formattedDate}>
                  {formattedDate}
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-emerald-200/70 dark:border-emerald-800/50">
              <div className="flex items-center justify-between mb-1.5">
                <span className="notranslate flex items-center gap-1 font-medium text-foreground text-[11px]">
                  <FileText className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                  Note / Message
                </span>
                {noteChanged && canEditNote ? (
                  <Button
                    type="button"
                    size="sm"
                    className="notranslate h-5 px-2 text-[10px] bg-emerald-700 hover:bg-emerald-800 text-white font-medium shadow-sm dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    disabled={isSavingNote}
                    onClick={handleSaveNote}
                  >
                    {isSavingNote ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" /> : null}
                    Save Note
                  </Button>
                ) : null}
              </div>
              {canEditNote ? (
                <Textarea
                  rows={2}
                  placeholder="Add a reconciliation note..."
                  value={localNote}
                  onChange={(e) => setLocalNote(e.target.value)}
                  disabled={isSavingNote}
                  className="text-xs resize-none bg-background border-emerald-200 dark:border-emerald-800/70 focus-visible:ring-1 focus-visible:ring-emerald-500 min-h-[52px] py-1.5 px-2.5 shadow-inner"
                />
              ) : (
                <p className="notranslate text-xs italic text-muted-foreground bg-background p-2 rounded border border-emerald-100 dark:border-emerald-900">
                  {message || "—"}
                </p>
              )}
            </div>
          </div>

          {/* LOWER SECTION: Intro Explanation + Blink Settings */}
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="font-semibold text-foreground text-xs">{copy.title}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 shrink-0 rounded-full",
                settingsOpen && "bg-muted text-foreground"
              )}
              aria-label="Blinking settings"
              aria-pressed={settingsOpen}
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((v) => !v);
              }}
            >
              <Settings className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-normal">{copy.infoText}</p>
          {settingsOpen ? (
            <div className="mt-2.5 space-y-2 rounded-md border border-border/70 bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="pl-statement-checked-blink" className="text-xs font-medium leading-none">
                  Blinking
                </Label>
                <Switch
                  id="pl-statement-checked-blink"
                  checked={prefs.enabled}
                  onCheckedChange={(checked) => updatePrefs({ enabled: Boolean(checked) })}
                />
              </div>
              {prefs.enabled ? (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="pl-statement-checked-blink-cycle" className="text-[11px] text-muted-foreground">
                      Repeat every
                    </Label>
                    <span className="text-[11px] font-semibold tabular-nums text-foreground">
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
                </div>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
