"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, Settings, Clock, AlertTriangle } from "lucide-react";
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
import {
  readConflictHistory,
  type ConflictHistoryEntry,
} from "@/lib/ledgerStatementCheckPersist";

function formatHistoryDrCr(val?: number | null): string {
  if (val == null || Number.isNaN(val)) return "—";
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs < 0.001) return "Rs. 0.00";
  return val > 0 ? `Rs. ${formatted} Dr` : `Rs. ${formatted} Cr`;
}

function formatHistoryDelta(val?: number | null): string {
  if (val == null || Number.isNaN(val)) return "—";
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs < 0.001) return "Rs. 0.00";
  const sign = val > 0 ? "+" : "-";
  return `${sign}Rs. ${formatted} ${val > 0 ? "Dr" : "Cr"}`;
}

type Props = {
  className?: string;
  align?: "start" | "center" | "end";
  isDim?: boolean;
  markedBy?: string | null;
  markedAt?: string | null;
  message?: string | null;
  onSaveMessage?: (message: string) => void | Promise<void>;
  canEditNote?: boolean;
  /** For loading conflict history — pass the entity ID (partyId / accountId) */
  contextId?: string | null;
  companyId?: string | null;
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
  contextId,
  companyId,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localNote, setLocalNote] = useState(message || "");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");
  const [history, setHistory] = useState<ConflictHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const { prefs, updatePrefs } = useStatementCheckedBlinkPrefs();
  const i18n = usePlI18nOptional();
  const copy = getReconciledPointCopy(i18n?.intro || "en");

  useEffect(() => {
    setLocalNote(message || "");
  }, [message]);

  // Load history when switching to History tab
  useEffect(() => {
    if (activeTab !== "history" || !contextId || !companyId) return;
    setHistoryLoading(true);
    void readConflictHistory(companyId, contextId).then((h) => {
      setHistory(h);
      setHistoryLoading(false);
    });
  }, [activeTab, contextId, companyId]);

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
          className={cn(
            "notranslate text-sm leading-relaxed p-4 shadow-xl bg-card border-emerald-300/85 dark:border-emerald-700/60 rounded-xl transition-[width] duration-200",
            activeTab === "history" ? "w-[660px] max-w-[96vw]" : "w-[390px] max-w-[92vw]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Tab Bar ── */}
          <div
            translate="no"
            className="notranslate flex items-center gap-0 mb-3 border-b border-emerald-200/70 dark:border-emerald-800/50"
          >
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors",
                activeTab === "details"
                  ? "border-emerald-600 text-emerald-800 dark:text-emerald-300"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors",
                activeTab === "history"
                  ? "border-amber-500 text-amber-700 dark:text-amber-300"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              History
              {history.length > 0 && activeTab !== "history" ? (
                <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold dark:bg-amber-900/60 dark:text-amber-200">
                  {history.length}
                </span>
              ) : null}
            </button>
          </div>

          {/* ── DETAILS TAB ── */}
          {activeTab === "details" ? (
            <>
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
            </>
          ) : null}

          {/* ── HISTORY TAB ── */}
          {activeTab === "history" ? (
            <div translate="no" className="notranslate text-xs">
              <div className="flex items-center gap-1.5 mb-2 text-amber-700 dark:text-amber-300 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Backdated Entry History
                <span className="ml-auto text-[10px] text-muted-foreground font-normal">Last 5 events</span>
              </div>

              {historyLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-1.5 text-muted-foreground">
                  <Clock className="h-7 w-7 opacity-30" />
                  <p className="text-[11px]">No backdated entries recorded yet.</p>
                  <p className="text-[10px] opacity-70">History is logged when a user clicks &quot;Continue&quot; on the Reconciled Point warning.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/70 max-h-[360px] shadow-sm">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold sticky top-0 backdrop-blur-sm z-10 border-b border-border/70">
                      <tr>
                        <th className="py-2 px-2.5">Voucher / Action</th>
                        <th className="py-2 px-2.5">User</th>
                        <th className="py-2 px-2.5">Dates</th>
                        <th className="py-2 px-2 text-right">Point Bal. (Before)</th>
                        <th className="py-2 px-2 text-right">Diff. (Voucher)</th>
                        <th className="py-2 px-2.5 text-right">Point Bal. (After)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-background/50">
                      {history.map((h, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "transition-colors hover:bg-muted/40",
                            i === 0 && "bg-amber-50/40 dark:bg-amber-950/10"
                          )}
                        >
                          {/* Voucher / Action */}
                          <td className="py-2 px-2.5 align-top whitespace-nowrap">
                            <div className="font-semibold text-foreground font-mono text-[11px]">
                              {h.voucherNo || "—"}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={cn(
                                  "text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded-full border",
                                  h.action === "delete"
                                    ? "bg-red-100 text-red-700 border-red-300/60 dark:bg-red-950/40 dark:text-red-300"
                                    : h.action === "edit"
                                    ? "bg-blue-100 text-blue-700 border-blue-300/60 dark:bg-blue-950/40 dark:text-blue-300"
                                    : "bg-amber-100 text-amber-700 border-amber-300/60 dark:bg-amber-950/40 dark:text-amber-300"
                                )}
                              >
                                {h.action === "delete" ? "Delete" : h.action === "edit" ? "Edit" : "New"}
                              </span>
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {(() => {
                                  try {
                                    return new Date(h.at).toLocaleDateString();
                                  } catch {
                                    return "";
                                  }
                                })()}
                              </span>
                            </div>
                          </td>

                          {/* User */}
                          <td className="py-2 px-2.5 align-top whitespace-nowrap">
                            <div className="font-medium text-foreground">{h.byUser || "—"}</div>
                            {h.accountName && (
                              <div className="text-[10px] text-muted-foreground truncate max-w-[90px]" title={h.accountName}>
                                {h.accountName}
                              </div>
                            )}
                          </td>

                          {/* Dates */}
                          <td className="py-2 px-2.5 align-top whitespace-nowrap">
                            <div className="text-amber-700 dark:text-amber-300 font-semibold">
                              <span className="text-muted-foreground text-[10px] font-normal">Voucher: </span>
                              {h.voucherDate || "—"}
                            </div>
                            <div className="text-muted-foreground text-[10px]">
                              <span>Point: </span>
                              <span className="text-foreground">{h.reconciledDate || "—"}</span>
                            </div>
                          </td>

                          {/* Recon Balance Before */}
                          <td className="py-2 px-2 align-top text-right whitespace-nowrap font-mono tabular-nums text-foreground">
                            {formatHistoryDrCr(h.balanceBefore)}
                          </td>

                          {/* Difference / Balance Delta */}
                          <td className="py-2 px-2 align-top text-right whitespace-nowrap font-mono tabular-nums font-semibold">
                            <span
                              className={
                                h.balanceDelta == null
                                  ? "text-muted-foreground"
                                  : h.balanceDelta > 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-red-700 dark:text-red-400"
                              }
                            >
                              {formatHistoryDelta(h.balanceDelta)}
                            </span>
                          </td>

                          {/* Recon Balance After */}
                          <td className="py-2 px-2.5 align-top text-right whitespace-nowrap font-mono tabular-nums font-semibold text-foreground">
                            {formatHistoryDrCr(h.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
