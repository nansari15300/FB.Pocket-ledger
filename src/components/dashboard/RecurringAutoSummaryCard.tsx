"use client";

import * as React from "react";
import { updateCompanyRootFirestore } from "@/lib/writeGateway/companyRootFirestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { proDashboardRibbonClass } from "@/lib/proTheme";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useRecurringAccrualTemplates, useRecurringAccrualLiveSnapshot, computeRecurringAccrualSnapshot, recurringAccrualSnapshotDisplayKey, type RecurringAccrualComputeInputs } from "@/hooks/useDashboardRecurringAccrual";
import { buildCompanyFlowDrCrContext } from "@/lib/dashboardRecurringAccrual";
import usePermissions from "@/hooks/usePermissions";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { toast } from "sonner";
import { isRecurringVoucherGenerationEnabled } from "@/lib/recurringVoucherSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import type { RecurringDashboardLine } from "@/lib/dashboardRecurringAccrual";
import { X } from "lucide-react";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { forceRemoveOrphanRecurringSchedule } from "@/lib/writeGateway/recurringVouchers";
import { canEditRecurringAutoMonthly } from "@/lib/recurringAutoPermissions";

type RecurringDetailsFmt = (n: number) => React.ReactNode;

function recurringTemplateSourceBodyId(tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate): string {
  return String(tpl.cloneSourceVoucherId || "").trim() || String(tpl.sourceVoucherId || "").trim();
}

function recurringSyncWaitMessage(scheduleCount: number): string {
  const n = Math.max(1, scheduleCount);
  return `${n} schedule(s) are enabled, but the clone/source vouchers are not in the list yet. Refresh the page or wait for sync; amounts will appear here.`;
}

function recurringOrphanSourceMessage(scheduleCount: number): string {
  const n = Math.max(1, scheduleCount);
  return `${n} enabled schedule(s) reference a source voucher that is not in this company (deleted or never synced). Open the source journal again to re-enable auto recurring, or use Remove permanently to delete the schedule and any ghost voucher rows from this device and the server.`;
}

type RecurringVoucherResolveMeta = {
  vouchersLoading: boolean;
  voucherById: Map<string, Record<string, unknown>>;
};

function partitionRecurringTemplatesBySource(
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>,
  voucherById: Map<string, Record<string, unknown>>,
) {
  const missingSource: typeof templates = [];
  const resolvedSource: typeof templates = [];
  for (const row of templates) {
    const sourceId = recurringTemplateSourceBodyId(row.tpl);
    if (!sourceId || !voucherById.has(sourceId)) missingSource.push(row);
    else resolvedSource.push(row);
  }
  return { missingSource, resolvedSource };
}

function RecurringSyncWaitInfoTip({ scheduleCount }: { scheduleCount: number }) {
  const [open, setOpen] = React.useState(false);
  const message = recurringSyncWaitMessage(scheduleCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="xs"
          className={cn(open && "border-blue-400 bg-blue-200/80 text-blue-400")}
          aria-label="Waiting for voucher sync"
          aria-expanded={open}
          title={message}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="z-[10050] max-w-[min(22rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed text-muted-foreground"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {message}
      </PopoverContent>
    </Popover>
  );
}

type RecurringLiveComputeBase = Omit<RecurringAccrualComputeInputs, "nowMs">;

/** Card totals — sirf text; parent se `snap` aata hai (ek hi live engine). */
const RecurringAutoSummaryAmountRows = React.memo(function RecurringAutoSummaryAmountRows({
  snap,
  formatAmount,
}: {
  snap: ReturnType<typeof useRecurringAccrualLiveSnapshot>;
  formatAmount: (n: number) => string;
}) {
  const dr = snap.detailDebitLines.reduce((s, r) => s + r.debit, 0);
  const cr = snap.detailCreditLines.reduce((s, r) => s + r.credit, 0);
  const balance = snap.detailNetCompanyDrMinusCr;

  return (
    <>
      <div className="flex min-h-[1.5rem] flex-nowrap items-baseline justify-between gap-x-4 gap-y-0">
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">Inflow to company</span>
        <span className="shrink-0 whitespace-nowrap text-base font-bold tabular-nums text-green-600">
          {formatAmount(dr)} <span className="text-xs">Dr</span>
        </span>
      </div>
      <div className="flex min-h-[1.5rem] flex-nowrap items-baseline justify-between gap-x-4 gap-y-0">
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">Outflow from company</span>
        <span className="shrink-0 whitespace-nowrap text-base font-bold tabular-nums text-red-600">
          {formatAmount(cr)} <span className="text-xs">Cr</span>
        </span>
      </div>
      <div className="mt-2 flex min-h-[1.75rem] flex-nowrap items-baseline justify-between gap-x-4 border-t pt-2">
        <span className="shrink-0 whitespace-nowrap text-sm font-bold">Balance</span>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap text-lg font-bold tabular-nums",
            balance > 0 ? "text-green-600" : balance < 0 ? "text-red-600" : "text-muted-foreground",
          )}
        >
          {balance !== 0 ? (
            <>
              {formatAmount(Math.abs(balance))} <span className="text-xs">{balance > 0 ? "Dr" : "Cr"}</span>
            </>
          ) : (
            formatAmount(0)
          )}
        </span>
      </div>
    </>
  );
});

type RecurringLiveDetailsProps = {
  snap: ReturnType<typeof useRecurringAccrualLiveSnapshot>;
  fmt: RecurringDetailsFmt;
  onLineOpenVoucher?: (bodyVoucherId: string) => void;
  isMobile: boolean;
  onClose: () => void;
};

function orphanSchedulePurgeVoucherIds(
  tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate,
  voucherById: Map<string, Record<string, unknown>>,
): string[] {
  const ids = [
    recurringTemplateSourceBodyId(tpl),
    String(tpl.sourceVoucherId || "").trim(),
    String(tpl.cloneSourceVoucherId || "").trim(),
    String(tpl.lastGeneratedVoucherId || "").trim(),
  ].filter(Boolean);
  return [...new Set(ids)].filter((vid) => !voucherById.has(vid));
}

function RecurringAutoSummaryOrphanSourceDetails({
  companyId,
  templates,
  scheduleCount,
  voucherById,
  canRemove,
  onAfterRemove,
}: {
  companyId: string;
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  scheduleCount: number;
  voucherById: Map<string, Record<string, unknown>>;
  canRemove: boolean;
  onAfterRemove?: () => void;
}) {
  const [busyTemplateId, setBusyTemplateId] = React.useState<string | null>(null);

  const runRemove = React.useCallback(
    async (templateDocId: string, tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate) => {
      const cid = String(companyId || "").trim();
      if (!cid) {
        toast.error("No company selected.");
        return;
      }
      setBusyTemplateId(templateDocId);
      try {
        await forceRemoveOrphanRecurringSchedule(cid, templateDocId, {
          purgeVoucherIds: orphanSchedulePurgeVoucherIds(tpl, voucherById),
        });
        toast.success("Recurring schedule removed permanently.");
        onAfterRemove?.();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not remove schedule.";
        toast.error(msg);
      } finally {
        setBusyTemplateId(null);
      }
    },
    [companyId, voucherById, onAfterRemove],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-100">{recurringOrphanSourceMessage(scheduleCount)}</p>
      <ScrollArea className="mt-4 min-h-0 flex-1">
        <ul className="space-y-2 pr-3 text-sm">
          {templates.map(({ id, tpl }) => {
            const sourceId = recurringTemplateSourceBodyId(tpl);
            const label = String(tpl.manualOnSourceVoucherNumber || sourceId || "Schedule").trim();
            const removing = busyTemplateId === id;
            return (
              <li key={id} className="rounded-md border border-amber-500/40 bg-amber-50/80 px-3 py-2 dark:bg-amber-950/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{label || "Auto schedule"}</p>
                    {sourceId ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">Missing source voucher id: {sourceId}</p>
                    ) : (
                      <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">No source voucher id on template.</p>
                    )}
                  </div>
                  {canRemove ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                          disabled={removing || busyTemplateId !== null}
                        >
                          {removing ? "Removing…" : "Remove permanently"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove this recurring schedule?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes the enabled schedule from local storage and the cloud, and permanently removes any
                            linked voucher rows that are not in your ledger (ghost / missing source). This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => {
                              void runRemove(id, tpl);
                            }}
                          >
                            Remove permanently
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

function RecurringAutoSummarySyncWaitDetails({
  templates,
  scheduleCount,
}: {
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  scheduleCount: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{recurringSyncWaitMessage(scheduleCount)}</p>
      <ScrollArea className="mt-4 min-h-0 flex-1">
        <ul className="space-y-2 pr-3 text-sm">
          {templates.map(({ id, tpl }) => {
            const sourceId = recurringTemplateSourceBodyId(tpl);
            const label = String(tpl.manualOnSourceVoucherNumber || sourceId || "Schedule").trim();
            return (
              <li key={id} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                <p className="font-medium text-foreground">{label || "Auto schedule"}</p>
                {sourceId ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Source voucher id: {sourceId}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">No source voucher id on template.</p>
                )}
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

/** Dialog tables — snap parent live engine se; alag tick nahi. */
const RecurringAutoSummaryLiveDetails = React.memo(function RecurringAutoSummaryLiveDetails({
  snap,
  fmt,
  onLineOpenVoucher,
  isMobile,
  onClose,
}: RecurringLiveDetailsProps) {
  const lineOpenHandler = onLineOpenVoucher;

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {isMobile ? (
          <Tabs
            defaultValue="debit"
            className="grid min-h-0 w-full flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
          >
            <TabsContent
              value="debit"
              className="col-start-1 row-start-1 m-0 mt-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <RecurringDetailsDebitPanel rows={snap.detailDebitLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
            </TabsContent>
            <TabsContent
              value="credit"
              className="col-start-1 row-start-1 m-0 mt-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <RecurringDetailsCreditPanel rows={snap.detailCreditLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
            </TabsContent>
            <TabsContent
              value="both"
              className="col-start-1 row-start-1 m-0 mt-0 flex h-full min-h-0 min-w-0 flex-col overflow-x-auto overflow-y-hidden p-0 focus-visible:ring-0 focus-visible:ring-offset-0 md:overflow-x-hidden"
            >
              <div className="flex h-full min-h-0 w-max min-w-full flex-row divide-x divide-black dark:divide-neutral-300 md:w-full md:min-w-0">
                <div className="flex h-full min-h-0 w-[min(88vw,22rem)] shrink-0 flex-col md:min-w-0 md:w-auto md:flex-1 md:shrink">
                  <RecurringDetailsDebitPanel rows={snap.detailDebitLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
                </div>
                <div className="flex h-full min-h-0 w-[min(88vw,22rem)] shrink-0 flex-col md:min-w-0 md:w-auto md:flex-1 md:shrink">
                  <RecurringDetailsCreditPanel rows={snap.detailCreditLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
                </div>
              </div>
            </TabsContent>
            <TabsList className="col-start-1 row-start-2 grid min-h-8 h-auto w-full shrink-0 grid-cols-3 items-stretch gap-1 border-t-2 border-black bg-muted/30 px-1.5 py-1.5 dark:border-neutral-300">
              <TabsTrigger
                value="debit"
                className={cn(
                  "flex items-center justify-center rounded-full border border-transparent px-1 py-0.5 text-[11px] font-semibold leading-tight shadow-none transition-[border-color,box-shadow]",
                  "!bg-green-200 !text-green-950 dark:!bg-green-800/90 dark:!text-green-50",
                  "data-[state=active]:!bg-green-200 data-[state=active]:!text-green-950 data-[state=active]:dark:!bg-green-800/90",
                  "data-[state=active]:!border-blue-500 dark:data-[state=active]:!border-blue-600 data-[state=inactive]:!border-transparent",
                  "data-[state=active]:shadow-none data-[state=inactive]:shadow-none",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:focus-visible:ring-blue-600",
                )}
              >
                Debit ({snap.detailDebitLines.length})
              </TabsTrigger>
              <TabsTrigger
                value="both"
                className={cn(
                  "flex items-center justify-center rounded-full border border-transparent px-1 py-0.5 text-[11px] font-semibold leading-tight shadow-none transition-[border-color,box-shadow]",
                  "!bg-slate-200 !text-slate-950 dark:!bg-slate-700/90 dark:!text-slate-50",
                  "data-[state=active]:!bg-slate-200 data-[state=active]:!text-slate-950 data-[state=active]:dark:!bg-slate-700/90",
                  "data-[state=active]:!border-blue-500 dark:data-[state=active]:!border-blue-600 data-[state=inactive]:!border-transparent",
                  "data-[state=active]:shadow-none data-[state=inactive]:shadow-none",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:focus-visible:ring-blue-600",
                )}
              >
                Both
              </TabsTrigger>
              <TabsTrigger
                value="credit"
                className={cn(
                  "flex items-center justify-center rounded-full border border-transparent px-1 py-0.5 text-[11px] font-semibold leading-tight shadow-none transition-[border-color,box-shadow]",
                  "!bg-pink-200 !text-pink-950 dark:!bg-pink-800/85 dark:!text-pink-50",
                  "data-[state=active]:!bg-pink-200 data-[state=active]:!text-pink-950 data-[state=active]:dark:!bg-pink-800/85",
                  "data-[state=active]:!border-blue-500 dark:data-[state=active]:!border-blue-600 data-[state=inactive]:!border-transparent",
                  "data-[state=active]:shadow-none data-[state=inactive]:shadow-none",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:focus-visible:ring-blue-600",
                )}
              >
                Credit ({snap.detailCreditLines.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-row divide-x divide-black dark:divide-neutral-300">
            <RecurringDetailsDebitPanel rows={snap.detailDebitLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
            <RecurringDetailsCreditPanel rows={snap.detailCreditLines} fmt={fmt} onLineOpenVoucher={lineOpenHandler} />
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-t border-black bg-gradient-to-r from-slate-100/90 via-slate-50/80 to-rose-100/90 px-3 py-2 dark:border-neutral-300 dark:from-slate-900/55 dark:via-slate-950/40 dark:to-rose-950/40",
          "md:flex-row md:items-center md:justify-between md:gap-3",
          "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[60] max-md:border-t-2 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] max-md:pt-2 max-md:shadow-[0_-6px_16px_rgba(0,0,0,0.12)]",
        )}
      >
        <p className="m-0 min-w-0 flex-1 text-center text-sm font-semibold leading-snug md:text-left">
          Balance (Dr lines − Cr lines):{" "}
          <span
            className={cn(
              "tabular-nums",
              snap.detailNetCompanyDrMinusCr > 0
                ? "text-green-700"
                : snap.detailNetCompanyDrMinusCr < 0
                  ? "text-red-700"
                  : "text-muted-foreground",
            )}
          >
            {snap.detailNetCompanyDrMinusCr !== 0 ? (
              <>
                {fmt(Math.abs(snap.detailNetCompanyDrMinusCr))}{" "}
                <span className="text-xs">{snap.detailNetCompanyDrMinusCr > 0 ? "Dr" : "Cr"}</span>
              </>
            ) : (
              fmt(0)
            )}
          </span>
        </p>
        <div className="hidden shrink-0 md:block">
          <Button type="button" variant="secondary" size="sm" className="font-semibold" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </>
  );
});

type RecurringDetailsPanelProps = {
  rows: RecurringDashboardLine[];
  fmt: RecurringDetailsFmt;
  /** Row tap → source body voucher edit (dashboard `AddVoucherDialog`) */
  onLineOpenVoucher?: (bodyVoucherId: string) => void;
};

/** Auto recurring dialog: Dr table + total — mobile tab aur desktop row dono yahi JSX reuse */
function RecurringDetailsDebitPanel({ rows, fmt, onLineOpenVoucher }: RecurringDetailsPanelProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-slate-50/40 dark:bg-slate-950/25">
      {/* max-md: ~40% chhota bar — desktop md: pehle jaisa py-2 + text-sm */}
      <div
        className={cn(
          "shrink-0 border-b border-black bg-slate-200/80 px-3 font-semibold text-slate-800 dark:border-neutral-300 dark:bg-slate-800/75 dark:text-slate-100",
          "max-md:py-1 max-md:text-xs max-md:leading-none",
          "md:py-2 md:text-sm",
        )}
      >
        Debit lines ({rows.length})
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* basis-0: flex item ka default min-height:auto scroll ko rok deta hai — poori bachi height ScrollArea ko */}
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1 basis-0 bg-slate-50/90 dark:bg-slate-900/30">
          <table className="w-full border-collapse text-xs table-fixed">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[32%]" />
              <col className="w-[30%]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] border-b border-black bg-slate-100/95 dark:border-neutral-300 dark:bg-slate-800/65">
              <tr>
                <th className="p-2 text-left font-medium text-slate-800 dark:text-slate-100">Account</th>
                <th className="p-2 text-left font-medium text-slate-800 dark:text-slate-100">Voucher no</th>
                <th className="p-2 text-right font-medium text-slate-800 dark:text-slate-100">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const accountTitle = [row.accountLabel, row.narration].filter(Boolean).join(" — ");
                const bodyId = String(row.bodyVoucherId || "").trim();
                const openEdit = onLineOpenVoucher && bodyId ? () => onLineOpenVoucher(bodyId) : undefined;
                return (
                  <tr
                    key={`d-${row.templateDocId}`}
                    className={cn(
                      "border-b border-black/55 dark:border-neutral-400/90",
                      i % 2 === 0
                        ? "bg-slate-50/90 dark:bg-slate-900/35"
                        : "bg-slate-100/85 dark:bg-slate-800/40",
                      openEdit &&
                        "cursor-pointer select-none hover:bg-slate-200/70 dark:hover:bg-slate-700/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                    )}
                    onClick={openEdit}
                    onKeyDown={
                      openEdit
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openEdit();
                            }
                          }
                        : undefined
                    }
                    tabIndex={openEdit ? 0 : undefined}
                    role={openEdit ? "button" : undefined}
                    aria-label={openEdit ? `Edit voucher ${row.voucherNumber || bodyId}` : undefined}
                  >
                    <td className="max-w-0 min-w-0 p-2 align-middle" title={accountTitle}>
                      <div className="min-w-0 truncate font-medium text-foreground">{row.accountLabel}</div>
                    </td>
                    <td className="max-w-0 min-w-0 p-2 align-middle" title={row.voucherNumber}>
                      <div className="min-w-0 truncate font-mono text-[11px] text-foreground">{row.voucherNumber}</div>
                    </td>
                    <td className="whitespace-nowrap p-2 text-right align-middle font-medium tabular-nums text-green-600">
                      {fmt(row.debit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
        <div className="shrink-0 border-t-2 border-black bg-slate-200/90 dark:border-neutral-300 dark:bg-slate-800/80">
          <table className="w-full border-collapse text-xs table-fixed leading-none">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[32%]" />
              <col className="w-[30%]" />
            </colgroup>
            <tbody>
              <tr className="font-semibold text-slate-900 dark:text-slate-50">
                <td className="px-2 py-1" colSpan={2}>
                  Total debit
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400">
                  {fmt(rows.reduce((s, r) => s + r.debit, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Cr table + total — mobile tab / desktop reuse */
function RecurringDetailsCreditPanel({ rows, fmt, onLineOpenVoucher }: RecurringDetailsPanelProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-rose-50/35 dark:bg-rose-950/20">
      <div
        className={cn(
          "shrink-0 border-b border-black bg-rose-100/85 px-3 font-semibold text-rose-950 dark:border-neutral-300 dark:bg-rose-950/45 dark:text-rose-50",
          "max-md:py-1 max-md:text-xs max-md:leading-none",
          "md:py-2 md:text-sm",
        )}
      >
        Credit lines ({rows.length})
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1 basis-0 bg-rose-50/80 dark:bg-rose-950/25">
          <table className="w-full border-collapse text-xs table-fixed">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[32%]" />
              <col className="w-[30%]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] border-b border-black bg-rose-50/95 dark:border-neutral-300 dark:bg-rose-950/40">
              <tr>
                <th className="p-2 text-left font-medium text-rose-950 dark:text-rose-50">Account</th>
                <th className="p-2 text-left font-medium text-rose-950 dark:text-rose-50">Voucher no</th>
                <th className="p-2 text-right font-medium text-rose-950 dark:text-rose-50">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const accountTitle = [row.accountLabel, row.narration].filter(Boolean).join(" — ");
                const bodyId = String(row.bodyVoucherId || "").trim();
                const openEdit = onLineOpenVoucher && bodyId ? () => onLineOpenVoucher(bodyId) : undefined;
                return (
                  <tr
                    key={`c-${row.templateDocId}`}
                    className={cn(
                      "border-b border-black/55 dark:border-neutral-400/90",
                      i % 2 === 0
                        ? "bg-rose-50/75 dark:bg-rose-950/30"
                        : "bg-rose-100/55 dark:bg-rose-900/35",
                      openEdit &&
                        "cursor-pointer select-none hover:bg-rose-200/60 dark:hover:bg-rose-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                    )}
                    onClick={openEdit}
                    onKeyDown={
                      openEdit
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openEdit();
                            }
                          }
                        : undefined
                    }
                    tabIndex={openEdit ? 0 : undefined}
                    role={openEdit ? "button" : undefined}
                    aria-label={openEdit ? `Edit voucher ${row.voucherNumber || bodyId}` : undefined}
                  >
                    <td className="max-w-0 min-w-0 p-2 align-middle" title={accountTitle}>
                      <div className="min-w-0 truncate font-medium text-foreground">{row.accountLabel}</div>
                    </td>
                    <td className="max-w-0 min-w-0 p-2 align-middle" title={row.voucherNumber}>
                      <div className="min-w-0 truncate font-mono text-[11px] text-foreground">{row.voucherNumber}</div>
                    </td>
                    <td className="whitespace-nowrap p-2 text-right align-middle font-medium tabular-nums text-red-600">
                      {fmt(row.credit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
        <div className="shrink-0 border-t-2 border-black bg-rose-200/75 dark:border-neutral-300 dark:bg-rose-950/50">
          <table className="w-full border-collapse text-xs table-fixed leading-none">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[32%]" />
              <col className="w-[30%]" />
            </colgroup>
            <tbody>
              <tr className="font-semibold text-rose-950 dark:text-rose-50">
                <td className="px-2 py-1" colSpan={2}>
                  Total credit
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-red-700 dark:text-red-400">
                  {fmt(rows.reduce((s, r) => s + r.credit, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type RecurringLiveSnap = ReturnType<typeof useRecurringAccrualLiveSnapshot>;

type RecurringLiveSnapEngineProps = {
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  recurringCompanyEnabled: boolean;
  hadResolvedRowsRef: React.MutableRefObject<boolean>;
  onSnapChange: (snap: RecurringLiveSnap) => void;
  onVoucherResolveMetaChange?: (meta: RecurringVoucherResolveMeta) => void;
};

/** `useVouchers` sirf yahan — sync bumps is component ke andar absorb; view re-render na ho. */
const RecurringLiveSnapEngine = React.memo(function RecurringLiveSnapEngine({
  templates,
  recurringCompanyEnabled,
  hadResolvedRowsRef,
  onSnapChange,
  onVoucherResolveMetaChange,
}: RecurringLiveSnapEngineProps) {
  const {
    vouchers,
    loading: vouchersLoading,
    journalAccountNames,
    processedParties,
    processedStaff,
    processedTaxes,
    expenseAccounts,
    processedAccounts,
    processedItems,
  } = useVouchers();

  const partyNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of processedParties || []) {
      const id = String((p as { id?: string }).id || "").trim();
      if (id) m.set(id, String((p as { name?: string }).name || id));
    }
    return m;
  }, [processedParties]);

  const staffNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of processedStaff || []) {
      const id = String((s as { id?: string }).id || "").trim();
      if (id) m.set(id, String((s as { name?: string }).name || id));
    }
    return m;
  }, [processedStaff]);

  const companyFlowCtx = React.useMemo(
    () =>
      buildCompanyFlowDrCrContext({
        partyIds: partyNameById.keys(),
        staffIds: staffNameById.keys(),
        taxIds: (processedTaxes || []).map((t) => String((t as { id?: string }).id || "").trim()).filter(Boolean),
        expenseAccounts: expenseAccounts || [],
        bankCashAccountIds: (processedAccounts || [])
          .filter((a) => {
            const t = String((a as { accountType?: string }).accountType || "");
            return t === "Bank" || t === "Cash";
          })
          .map((a) => String((a as { id?: string }).id || "").trim())
          .filter(Boolean),
        itemIds: (processedItems || []).map((it) => String((it as { id?: string }).id || "").trim()).filter(Boolean),
      }),
    [partyNameById, staffNameById, processedTaxes, expenseAccounts, processedAccounts, processedItems],
  );

  const voucherById = React.useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const v of vouchers) {
      const id = String((v as { id?: string }).id || "").trim();
      if (id) m.set(id, v as Record<string, unknown>);
    }
    return m;
  }, [vouchers]);

  const liveComputeBase = React.useMemo(
    (): RecurringLiveComputeBase => ({
      templates,
      voucherById,
      journalAccountNames,
      partyNameById,
      staffNameById,
      companyFlowCtx,
    }),
    [templates, voucherById, journalAccountNames, partyNameById, staffNameById, companyFlowCtx],
  );

  const liveActive = recurringCompanyEnabled && templates.length > 0;
  const liveSnap = useRecurringAccrualLiveSnapshot(liveComputeBase, liveActive);
  const lastDisplayKeyRef = React.useRef("");

  React.useEffect(() => {
    onVoucherResolveMetaChange?.({ vouchersLoading, voucherById });
  }, [vouchersLoading, voucherById, onVoucherResolveMetaChange]);

  React.useEffect(() => {
    if (liveSnap.templateRows.length > 0) {
      hadResolvedRowsRef.current = true;
    }
    const key = recurringAccrualSnapshotDisplayKey(liveSnap);
    if (key === lastDisplayKeyRef.current) return;
    lastDisplayKeyRef.current = key;
    onSnapChange(liveSnap);
  }, [liveSnap, onSnapChange, hadResolvedRowsRef]);

  return null;
});

type RecurringAutoSummaryLiveViewProps = {
  companyId: string;
  snap: RecurringLiveSnap;
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  templatesLoading: boolean;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  onOpenBodyVoucher?: (bodyVoucherId: string) => void;
  inGrid: boolean;
  hadResolvedRowsRef: React.MutableRefObject<boolean>;
  onSyncWaitHintChange?: (active: boolean, scheduleCount: number) => void;
  voucherResolveMeta: RecurringVoucherResolveMeta;
  canRemoveOrphanSchedule: boolean;
  onAfterOrphanRemove?: () => void;
};

/** Stable UI — `useVouchers` nahi; sirf snap badle tab re-render. */
const RecurringAutoSummaryLiveView = React.memo(function RecurringAutoSummaryLiveView({
  snap,
  templates,
  templatesLoading,
  detailsOpen,
  setDetailsOpen,
  onOpenBodyVoucher,
  inGrid,
  hadResolvedRowsRef,
  onSyncWaitHintChange,
  voucherResolveMeta,
  companyId,
  canRemoveOrphanSchedule,
  onAfterOrphanRemove,
}: RecurringAutoSummaryLiveViewProps) {
  const { formatCurrencyForPrint } = useDate();
  const isMobile = useIsMobile();

  const { missingSource, resolvedSource } = React.useMemo(
    () => partitionRecurringTemplatesBySource(templates, voucherResolveMeta.voucherById),
    [templates, voucherResolveMeta.voucherById],
  );

  const waitingForVouchers =
    !templatesLoading &&
    voucherResolveMeta.vouchersLoading &&
    templates.length > 0 &&
    snap.templateRows.length === 0 &&
    !hadResolvedRowsRef.current &&
    missingSource.length > 0 &&
    resolvedSource.length === 0;

  const orphanedSchedules =
    !templatesLoading &&
    !voucherResolveMeta.vouchersLoading &&
    templates.length > 0 &&
    snap.templateRows.length === 0 &&
    missingSource.length > 0 &&
    resolvedSource.length === 0;

  React.useEffect(() => {
    onSyncWaitHintChange?.(waitingForVouchers, templates.length);
  }, [waitingForVouchers, templates.length, onSyncWaitHintChange]);

  const showLiveAmounts = !waitingForVouchers && !orphanedSchedules;
  const scheduleCount = templates.length;
  const liveTriggerCount = snap.templateRows.length;
  const triggeringLabel = orphanedSchedules
    ? scheduleCount === 1
      ? "1 schedule — source missing"
      : `${scheduleCount} schedules — source missing`
    : waitingForVouchers
      ? scheduleCount === 1
        ? "1 schedule enabled"
        : `${scheduleCount} schedules enabled`
      : liveTriggerCount === 1
        ? "1 voucher triggering"
        : `${liveTriggerCount} vouchers triggering`;
  const canOpenDetails = scheduleCount > 0 && !templatesLoading;
  const formatAmount = React.useCallback(
    (n: number) => formatCurrencyForPrint(n, { showDrCr: false }),
    [formatCurrencyForPrint],
  );

  const handleLineOpenVoucher = React.useCallback(
    (bodyVoucherId: string) => {
      const id = String(bodyVoucherId || "").trim();
      if (!id || !onOpenBodyVoucher) return;
      setDetailsOpen(false);
      onOpenBodyVoucher(id);
    },
    [onOpenBodyVoucher, setDetailsOpen],
  );
  const lineOpenHandler = onOpenBodyVoucher ? handleLineOpenVoucher : undefined;

  return (
    <div className={cn("flex min-h-0 flex-col", inGrid && "h-full flex-1")}>
      {showLiveAmounts ? (
        <RecurringAutoSummaryAmountRows snap={snap} formatAmount={formatAmount} />
      ) : inGrid ? (
        <div className="min-h-0 flex-1" aria-hidden />
      ) : null}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className={cn("flex min-w-0 items-center justify-between gap-2 pt-2", inGrid && "mt-auto shrink-0")}>
          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground" title="Active Auto Monthly journal schedules">
            {templatesLoading ? "…" : triggeringLabel}
          </span>
          {canOpenDetails ? (
            <DialogTrigger asChild>
              <Button variant="link" size="sm" className="h-auto shrink-0 p-0 text-rose-700">
                View details
              </Button>
            </DialogTrigger>
          ) : null}
        </div>
        <DialogContent
          hideCloseButton
          className={cn(
            "fixed z-50 flex min-h-0 flex-col gap-0 overflow-hidden border border-blue-500 bg-background p-0 shadow-lg dark:border-blue-600",
            "left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none max-md:pb-[calc(3rem+env(safe-area-inset-bottom,0px))]",
            "md:left-1/2 md:top-1/2 md:h-[90vh] md:max-h-[90vh] md:w-[min(100vw-16px,64rem)] md:max-w-5xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:pb-0",
          )}
        >
          <DialogHeader className="flex shrink-0 flex-row items-center gap-1 space-y-0 border-b border-blue-600/20 bg-blue-500 px-2 py-[0.24rem] dark:border-blue-800/35 dark:bg-blue-600 md:gap-1.5 md:px-3 md:py-[0.28rem]">
            <div className="w-6 shrink-0 md:w-7" aria-hidden />
            <DialogTitle className="flex-1 text-center text-xs font-semibold leading-none text-white md:text-[0.8125rem] md:leading-tight">
              Auto recurring vouchers
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-[1.4rem] w-[1.4rem] shrink-0 text-white hover:bg-white/20 hover:text-white focus-visible:ring-white/60 md:h-[1.6rem] md:w-[1.6rem]"
              aria-label="Close dialog"
              onClick={() => setDetailsOpen(false)}
            >
              <X className="h-3 w-3 md:h-3.5 md:w-3.5" strokeWidth={2.25} />
            </Button>
          </DialogHeader>
          {orphanedSchedules ? (
            <RecurringAutoSummaryOrphanSourceDetails
              companyId={companyId}
              templates={missingSource}
              scheduleCount={missingSource.length}
              voucherById={voucherResolveMeta.voucherById}
              canRemove={canRemoveOrphanSchedule}
              onAfterRemove={onAfterOrphanRemove}
            />
          ) : waitingForVouchers ? (
            <RecurringAutoSummarySyncWaitDetails templates={templates} scheduleCount={scheduleCount} />
          ) : (
            <RecurringAutoSummaryLiveDetails
              snap={snap}
              fmt={formatAmount}
              onLineOpenVoucher={lineOpenHandler}
              isMobile={isMobile}
              onClose={() => setDetailsOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});

type RecurringAutoSummaryLiveIslandProps = {
  companyId: string;
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  templatesLoading: boolean;
  recurringCompanyEnabled: boolean;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  onOpenBodyVoucher?: (bodyVoucherId: string) => void;
  inGrid: boolean;
  hadResolvedRowsRef: React.MutableRefObject<boolean>;
  onSyncWaitHintChange?: (active: boolean, scheduleCount: number) => void;
  canRemoveOrphanSchedule: boolean;
  onAfterOrphanRemove?: () => void;
};

const RecurringAutoSummaryLiveIsland = React.memo(function RecurringAutoSummaryLiveIsland(
  props: RecurringAutoSummaryLiveIslandProps,
) {
  const [voucherResolveMeta, setVoucherResolveMeta] = React.useState<RecurringVoucherResolveMeta>(() => ({
    vouchersLoading: true,
    voucherById: new Map(),
  }));
  const onVoucherResolveMetaChange = React.useCallback((meta: RecurringVoucherResolveMeta) => {
    setVoucherResolveMeta((prev) =>
      prev.vouchersLoading === meta.vouchersLoading && prev.voucherById === meta.voucherById ? prev : meta,
    );
  }, []);

  const [snap, setSnap] = React.useState<RecurringLiveSnap>(() =>
    computeRecurringAccrualSnapshot({
      templates: props.templates,
      voucherById: new Map(),
      journalAccountNames: {},
      partyNameById: new Map(),
      staffNameById: new Map(),
      companyFlowCtx: buildCompanyFlowDrCrContext({
        partyIds: [],
        staffIds: [],
        taxIds: [],
        expenseAccounts: [],
        bankCashAccountIds: [],
        itemIds: [],
      }),
      nowMs: Date.now(),
    }),
  );

  const onSnapChange = React.useCallback((next: RecurringLiveSnap) => {
    setSnap((prev) =>
      recurringAccrualSnapshotDisplayKey(prev) === recurringAccrualSnapshotDisplayKey(next) ? prev : next,
    );
  }, []);

  return (
    <>
      <RecurringLiveSnapEngine
        templates={props.templates}
        recurringCompanyEnabled={props.recurringCompanyEnabled}
        hadResolvedRowsRef={props.hadResolvedRowsRef}
        onSnapChange={onSnapChange}
        onVoucherResolveMetaChange={onVoucherResolveMetaChange}
      />
      <div className={cn(props.inGrid && "flex min-h-0 flex-1 flex-col")}>
        <RecurringAutoSummaryLiveView {...props} snap={snap} voucherResolveMeta={voucherResolveMeta} />
      </div>
    </>
  );
});

type RecurringAutoSummaryCardBodyProps = {
  companyId: string;
  recurringCompanyEnabled: boolean;
  templates: Array<{ id: string; tpl: import("@/lib/recurringVouchers").RecurringVoucherTemplate }>;
  templatesLoading: boolean;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  onOpenBodyVoucher?: (bodyVoucherId: string) => void;
  inGrid: boolean;
  onSyncWaitHintChange?: (active: boolean, scheduleCount: number) => void;
  canRemoveOrphanSchedule: boolean;
  onAfterOrphanRemove?: () => void;
};

/** Templates-only shell — `useVouchers` / sync flicker yahan nahi. */
const RecurringAutoSummaryCardBody = React.memo(function RecurringAutoSummaryCardBody({
  companyId,
  recurringCompanyEnabled,
  templates,
  templatesLoading,
  detailsOpen,
  setDetailsOpen,
  onOpenBodyVoucher,
  inGrid,
  onSyncWaitHintChange,
  canRemoveOrphanSchedule,
  onAfterOrphanRemove,
}: RecurringAutoSummaryCardBodyProps) {
  const hadResolvedRowsRef = React.useRef(false);
  const templatesEverLoadedRef = React.useRef(false);

  React.useEffect(() => {
    hadResolvedRowsRef.current = false;
    templatesEverLoadedRef.current = false;
  }, [companyId]);

  if (templates.length > 0) {
    templatesEverLoadedRef.current = true;
  }

  const emptySchedules = !templatesLoading && templates.length === 0 && recurringCompanyEnabled;
  const showInitialTemplateLoading =
    templatesLoading && !templatesEverLoadedRef.current && !hadResolvedRowsRef.current;

  return (
    <CardContent
      className={cn(
        "min-w-0 space-y-2 p-4 pt-0",
        inGrid ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-[8.5rem]",
      )}
    >
      {!recurringCompanyEnabled ? (
        <p
          className={cn(
            "min-w-0 break-words text-pretty text-xs leading-snug text-muted-foreground",
            inGrid && "flex-1",
          )}
        >
          Turn the switch on to generate and track scheduled vouchers. You can also change this under Settings →
          Voucher settings.
        </p>
      ) : showInitialTemplateLoading ? (
        <Skeleton className={cn("h-20 w-full", inGrid && "flex-1")} />
      ) : emptySchedules ? (
        <p
          className={cn(
            "min-w-0 break-words text-pretty text-xs leading-snug text-muted-foreground",
            inGrid && "flex-1",
          )}
        >
          No enabled auto schedule yet. Open a voucher, turn on auto recurring, and save.
        </p>
      ) : (
        <div className={cn(inGrid && "flex min-h-0 flex-1 flex-col")}>
          <RecurringAutoSummaryLiveIsland
            companyId={companyId}
            templates={templates}
            templatesLoading={templatesLoading}
            recurringCompanyEnabled={recurringCompanyEnabled}
            detailsOpen={detailsOpen}
            setDetailsOpen={setDetailsOpen}
            onOpenBodyVoucher={onOpenBodyVoucher}
            inGrid={inGrid}
            hadResolvedRowsRef={hadResolvedRowsRef}
            onSyncWaitHintChange={onSyncWaitHintChange}
            canRemoveOrphanSchedule={canRemoveOrphanSchedule}
            onAfterOrphanRemove={onAfterOrphanRemove}
          />
        </div>
      )}
    </CardContent>
  );
});

type Props = {
  className?: string;
  placement?: "with-all" | "summary";
  /** `gridCell` = Outstanding jaisa `col-span-1` financial summary grid ke andar */
  layout?: "default" | "gridCell";
  /** Dr/Cr line click → parent voucher edit dialog (e.g. dashboard `AddVoucherDialog`) */
  onOpenBodyVoucher?: (bodyVoucherId: string) => void;
};

/**
 * Auto recurring: company toggle + live accrued (AddVoucher jaisa) + Outstanding-style rows jab ON ho.
 */
export const RecurringAutoSummaryCard = React.memo(function RecurringAutoSummaryCard({
  className,
  placement = "with-all",
  layout = "default",
  onOpenBodyVoucher,
}: Props) {
  const { company, companyId, triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const { can } = usePermissions();
  const cid = String(companyId || "").trim();
  const recurringCompanyEnabled = isRecurringVoucherGenerationEnabled(company);
  const { templates, loading: templatesLoading } = useRecurringAccrualTemplates(
    cid || undefined,
    recurringCompanyEnabled,
  );

  const canViewRecurringCard = can("view_recurring_auto_summary");
  const canToggleRecurring = can("configure_recurring_auto_company");
  const canRemoveOrphanSchedule = canEditRecurringAutoMonthly(can);
  const onAfterOrphanRemove = React.useCallback(() => {
    triggerSync();
  }, [triggerSync]);
  const [savingToggle, setSavingToggle] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [syncWaitHint, setSyncWaitHint] = React.useState({ active: false, scheduleCount: 0 });
  const inGrid = layout === "gridCell";

  const onSyncWaitHintChange = React.useCallback((active: boolean, scheduleCount: number) => {
    setSyncWaitHint((prev) =>
      prev.active === active && prev.scheduleCount === scheduleCount ? prev : { active, scheduleCount },
    );
  }, []);

  React.useEffect(() => {
    if (!recurringCompanyEnabled || templates.length === 0) {
      setSyncWaitHint({ active: false, scheduleCount: 0 });
    }
  }, [recurringCompanyEnabled, templates.length]);

  const onRecurringToggle = React.useCallback(
    async (checked: boolean) => {
      if (!cid) {
        toast.error("No company selected.");
        return;
      }
      if (!canToggleRecurring) {
        toast.error("You need “Configure company recurring auto” permission (Manage Sharing → Recurring Auto Voucher).");
        return;
      }
      setSavingToggle(true);
      try {
        const prev = ((company as Record<string, unknown>)?.recurringVoucherSettings as Record<string, unknown>) || {};
        const patch = {
          recurringVoucherSettings: {
            ...prev,
            enabled: checked,
          },
        };
        await updateCompanyRootFirestore(cid, patch);
        try {
          const localRow = await getLocalCompanyById(cid);
          if (localRow) {
            await upsertLocalCompany({
              ...(localRow as Record<string, unknown>),
              ...patch,
              id: cid,
            } as unknown as Parameters<typeof upsertLocalCompany>[0]);
          }
        } catch {
          /* online-only */
        }
        reloadLocalCompanyRegistry();
        triggerSync();
        toast.success(checked ? "Recurring voucher generation is ON." : "Recurring voucher generation is OFF.");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not update company settings.";
        toast.error(msg);
      } finally {
        setSavingToggle(false);
      }
    },
    [cid, company, canToggleRecurring, reloadLocalCompanyRegistry, triggerSync],
  );

  if (!canViewRecurringCard) return null;

  const gridOuterClass = cn(
    "flex h-full min-h-[12rem] min-w-0 w-full max-w-full flex-col overflow-hidden app-chrome-top-ribbon",
    proDashboardRibbonClass(4),
    className,
  );
  const defaultOuterClass = cn(
    "min-h-[12rem] w-full min-w-0 max-w-full app-chrome-top-ribbon",
    proDashboardRibbonClass(4),
    className,
  );

  return (
    <Card className={inGrid ? gridOuterClass : defaultOuterClass}>
      <CardHeader
        className={cn(
          "flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0",
          inGrid ? "min-w-0 overflow-hidden p-4" : "p-4 pb-2",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <CardTitle className="min-w-0 text-base font-semibold leading-snug text-card-foreground">
            Auto recurring
          </CardTitle>
          {syncWaitHint.active ? (
            <RecurringSyncWaitInfoTip scheduleCount={syncWaitHint.scheduleCount} />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={recurringCompanyEnabled}
            disabled={!canToggleRecurring || savingToggle}
            onCheckedChange={(v) => void onRecurringToggle(v)}
            aria-label="Enable recurring voucher generation for this company"
          />
        </div>
      </CardHeader>

      <RecurringAutoSummaryCardBody
        companyId={cid}
        recurringCompanyEnabled={recurringCompanyEnabled}
        templates={templates}
        templatesLoading={templatesLoading}
        detailsOpen={detailsOpen}
        setDetailsOpen={setDetailsOpen}
        onOpenBodyVoucher={onOpenBodyVoucher}
        inGrid={inGrid}
        onSyncWaitHintChange={onSyncWaitHintChange}
        canRemoveOrphanSchedule={canRemoveOrphanSchedule}
        onAfterOrphanRemove={onAfterOrphanRemove}
      />
    </Card>
  );
});
