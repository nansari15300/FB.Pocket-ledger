
"use client";

import { ADMIN_SERVER_VIEW_UNAVAILABLE_MESSAGE, isAdminServerMode } from "@/lib/adminData/adminServerMode";
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  query,
} from 'firebase/firestore';
import { onSnapshot } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore } from '@/lib/firebase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Search,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Info,
    X,
} from 'lucide-react';
import {
    LedgerFooterParentPill,
    LedgerFooterTextPill,
    ledgerFooterIconBtnCn,
    ledgerFooterRowCn,
} from '@/components/vouchers/ledgerFooterChrome';
import { highlightQueryInText } from '@/lib/highlightQueryInText';
import { isCloudLinkedCompanyStorage } from '@/lib/companyUnlockGate';
import { useDate } from '@/hooks/useDate';
import { formatBsFromAD } from '@/lib/bs-date';
import type { Company } from '@/app/(admin)/admin/types';
import type { AppUser } from '@/app/(admin)/admin/users/page';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { chromeProPillCn } from '@/lib/chromePillButton';
import { AdminPanelDateRangePicker } from '@/components/admin/AdminPanelDateRangePicker';
import type { DateRange } from '@/components/ui/ad-calendar';
import { appApiUrl } from '@/lib/webAppBasePath';

type Payment = {
    id: string;
    companyId: string;
    userId: string;
    planId: string;
    amount: number;
    currency: string;
    gateway: 'stripe' | 'khalti' | 'esewa' | 'internal';
    status: string;
    createdAt: { toDate: () => Date } | null;
    paymentId: string;
    /** Stripe subscription period end at checkout; older rows may rely on company.planExpiry fallback. */
    planExpiryMs: number | null;
    planChangeFrom: string | null;
    planChangeTo: string | null;
    planChangeHistory: Record<string, unknown> | null;
};

type GatewayFilter = 'all' | Payment['gateway'];

type SubscriptionPaymentUserDisplay = {
  primary: string;
  /** Email — naam ke niche chhota text */
  secondary?: string;
};

function findAdminUserByUid(users: AppUser[], uid: string): AppUser | undefined {
  const id = String(uid || "").trim();
  if (!id) return undefined;
  return (
    users.find((u) => u.id === id || u.uid === id) ??
    users.find((u) => String(u.uid || "").trim() === id)
  );
}

function userDisplayFromDoc(user: AppUser | undefined): SubscriptionPaymentUserDisplay | null {
  if (!user) return null;
  const name = String(user.displayName || "").trim();
  const email = String(user.email || "").trim();
  if (name && email) return { primary: name, secondary: email };
  if (name) return { primary: name };
  if (email) return { primary: email };
  return null;
}

function subscriptionPaymentUserSearchText(d: SubscriptionPaymentUserDisplay): string {
  return [d.primary, d.secondary].filter(Boolean).join(" ").toLowerCase();
}

/** Payment `userId` → users doc; else company owner (admin) name + mail. */
function resolveSubscriptionPaymentUserDisplay(
  paymentUserId: string,
  companyIds: string[],
  companies: Company[],
  users: AppUser[]
): SubscriptionPaymentUserDisplay {
  const uid = String(paymentUserId || "").trim();
  const payerDisplay = userDisplayFromDoc(findAdminUserByUid(users, uid));
  if (payerDisplay) return payerDisplay;

  for (const cid of companyIds) {
    const company = companies.find((c) => c.id === cid);
    if (!company) continue;
    const ownerId = String(company.ownerId || "").trim();
    const ownerEmail = String(company.ownerEmail || "").trim();
    const owner = ownerId ? findAdminUserByUid(users, ownerId) : undefined;
    const ownerFromDoc = userDisplayFromDoc(owner);
    if (ownerFromDoc) return ownerFromDoc;
    if (ownerEmail) {
      const byEmail = users.find(
        (u) => String(u.email || "").trim().toLowerCase() === ownerEmail.toLowerCase()
      );
      const fromEmailUser = userDisplayFromDoc(byEmail);
      if (fromEmailUser) return fromEmailUser;
      return { primary: ownerEmail, secondary: "Company admin" };
    }
    if (ownerId) {
      return { primary: ownerId, secondary: "Company admin" };
    }
  }

  if (uid) return { primary: uid };
  return { primary: "—" };
}

function subscriptionPaymentUserLabelFlat(d: SubscriptionPaymentUserDisplay): string {
  if (d.secondary && d.secondary !== "Company admin") {
    return d.primary === d.secondary ? d.primary : `${d.primary} (${d.secondary})`;
  }
  if (d.secondary === "Company admin") return d.primary;
  return d.primary;
}

/** One payment row loaded from Firestore (before gap insertion). */
type HistoryPaymentEvent = {
    eventKey: string;
    atMs: number;
    paymentId: string;
    companyId: string;
    history: Record<string, unknown>;
};

/** One admin row per Firebase user: merged from all their payment docs (after filters). */
type UserPaymentAggregate = {
    /** Grouping key (empty only if legacy rows lack userId). */
    userId: string;
    payments: Payment[];
    latest: Payment;
    joinedAt: Date | null;
    expiryDate: Date | null;
    companyLabel: string;
    /** Every stored plan-change snapshot for this user, newest payment first. */
    historyEvents: HistoryPaymentEvent[];
};

type SubscriptionPaymentCompanySlice = {
    companyId: string;
    name: string;
    isOnline: boolean;
    payment: Payment;
};

function buildSubscriptionPaymentCompanySlices(
    agg: UserPaymentAggregate,
    companies: Company[],
    companyMap: Map<string, string | undefined>
): SubscriptionPaymentCompanySlice[] {
    const ids = [...new Set(agg.payments.map((p) => p.companyId).filter(Boolean))];
    const slices: SubscriptionPaymentCompanySlice[] = [];
    for (const companyId of ids) {
        const company = companies.find((c) => c.id === companyId);
        const isOnline = company
            ? isCloudLinkedCompanyStorage({
                  storageOption: (company as { storageOption?: string | null }).storageOption,
                  syncedFromCloud: (company as { syncedFromCloud?: boolean }).syncedFromCloud,
              })
            : true;
        const forCompany = agg.payments.filter((p) => p.companyId === companyId);
        const payment = [...forCompany].sort(
            (a, b) => (paymentCreatedMs(b) ?? 0) - (paymentCreatedMs(a) ?? 0)
        )[0];
        if (!payment) continue;
        slices.push({
            companyId,
            name: companyMap.get(companyId) || companyId,
            isOnline,
            payment,
        });
    }
    slices.sort((a, b) => a.name.localeCompare(b.name));
    return slices;
}

/** Payment block or synthetic “lapsed days” between prior expiry and next payment. */
type AugmentedHistoryItem =
    | ({ kind: "payment" } & HistoryPaymentEvent)
    | {
          kind: "gap";
          gapKey: string;
          /** End of previous plan entitlement (`newExpiryMs` of prior record). */
          fromMs: number;
          /** Time of the next successful payment (re-subscribe). */
          toMs: number;
          daysLapsed: number;
      };

const MS_DAY_ADMIN_HIST = 86_400_000;
/** Only insert a gap record when payment is at least this long after prior `newExpiryMs` (avoid same-day renew noise). */
const GAP_MIN_AFTER_EXPIRY_MS = MS_DAY_ADMIN_HIST;

function paymentCreatedMs(p: Payment): number | null {
    const t = p.createdAt?.toDate?.()?.getTime();
    return t != null && !Number.isNaN(t) ? t : null;
}

function subscriptionPaymentSearchHl(text: string, query: string): ReactNode {
    const q = query.trim();
    if (!q || !text) return text;
    return highlightQueryInText(text, q);
}

function SubscriptionPaymentTruncatedCompanyLabel({
    name,
    searchHighlight,
}: {
    name: string;
    searchHighlight: string;
}) {
    return (
        <Tooltip delayDuration={250}>
            <TooltipTrigger asChild>
                <span className="block min-w-0 w-full truncate text-sm" tabIndex={0}>
                    {subscriptionPaymentSearchHl(name, searchHighlight)}
                </span>
            </TooltipTrigger>
            <TooltipContent
                side="top"
                align="start"
                className="max-w-[min(90vw,28rem)] break-words text-sm"
            >
                {name}
            </TooltipContent>
        </Tooltip>
    );
}

function joinedAtForCompanyPayments(agg: UserPaymentAggregate, companyId: string): Date | null {
    const times = agg.payments
        .filter((p) => p.companyId === companyId)
        .map(paymentCreatedMs)
        .filter((t): t is number => t != null);
    return times.length ? new Date(Math.min(...times)) : null;
}

const SUBSCRIPTION_PAYMENTS_AMOUNT_RAIL_CN =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center";
const SUBSCRIPTION_PAYMENTS_COMPANY_RAIL_CN =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center";
const SUBSCRIPTION_PAYMENTS_COMPANY_VALUE_CN = "subscription-payments-company-value";
const SUBSCRIPTION_PAYMENTS_ONLINE_COMPANY_COL_CLASS = "subscription-payments-online-company-col";
const SUBSCRIPTION_PAYMENTS_OFFLINE_COMPANY_COL_CLASS = "subscription-payments-offline-company-col";
const SUBSCRIPTION_PAYMENTS_AMOUNT_COL_CLASS = "subscription-payments-amount-col";
/** Below ~1800px viewport, horizontal scroll shows (table does not shrink). */
const SUBSCRIPTION_PAYMENTS_TABLE_SCROLL_MIN_CLASS = "min-w-[1800px] w-[1800px] max-w-none shrink-0";
const SUBSCRIPTION_PAYMENTS_TABLE_FIXED_CLASS = "table-fixed w-full min-w-0 max-w-full";

function SubscriptionPaymentsCompanyColumnDash() {
    return (
        <SubscriptionPaymentsCompanyCellShell>
            <span className="text-sm text-muted-foreground">—</span>
        </SubscriptionPaymentsCompanyCellShell>
    );
}

function SubscriptionPaymentsCompanyCellShell({
    rail,
    children,
}: {
    rail?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="relative min-h-7 min-w-0">
            <div className="absolute left-0 top-1/2 z-[1] -translate-y-1/2">
                {rail ?? <span className={SUBSCRIPTION_PAYMENTS_COMPANY_RAIL_CN} aria-hidden />}
            </div>
            <div
                className={cn(
                    SUBSCRIPTION_PAYMENTS_COMPANY_VALUE_CN,
                    "block min-w-0 w-full overflow-hidden"
                )}
            >
                {children}
            </div>
        </div>
    );
}

function CollapsedCompanyExpandTrigger({
    name,
    onToggleExpand,
    searchHighlight,
}: {
    name: string;
    onToggleExpand: () => void;
    searchHighlight: string;
}) {
    return (
        <SubscriptionPaymentsCompanyCellShell
            rail={
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0"
                    onClick={onToggleExpand}
                    aria-expanded={false}
                    aria-label="Show more companies"
                >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
            }
        >
            <SubscriptionPaymentTruncatedCompanyLabel name={name} searchHighlight={searchHighlight} />
        </SubscriptionPaymentsCompanyCellShell>
    );
}

/** Collapsed multi-company row: one company name + expand arrow (correct online/offline column). */
function collapsedMultiCompanyColumnCells(
    slices: SubscriptionPaymentCompanySlice[],
    onToggleExpand: () => void,
    searchHighlight: string
): { online: ReactNode; offline: ReactNode } {
    const companyDash = <SubscriptionPaymentsCompanyColumnDash />;
    const primary = slices[0];
    if (!primary) {
        return { online: companyDash, offline: companyDash };
    }
    const trigger = (
        <CollapsedCompanyExpandTrigger
            name={primary.name}
            onToggleExpand={onToggleExpand}
            searchHighlight={searchHighlight}
        />
    );
    if (primary.isOnline) {
        return { online: trigger, offline: companyDash };
    }
    return { online: companyDash, offline: trigger };
}

function SubscriptionPaymentCompanyNameCell({
    slice,
    searchHighlight,
    reserveRail = true,
}: {
    slice: SubscriptionPaymentCompanySlice;
    searchHighlight: string;
    reserveRail?: boolean;
}) {
    const name = slice.name;
    if (slice.isOnline) {
        const inner = (
            <SubscriptionPaymentTruncatedCompanyLabel name={name} searchHighlight={searchHighlight} />
        );
        return reserveRail ? (
            <SubscriptionPaymentsCompanyCellShell>{inner}</SubscriptionPaymentsCompanyCellShell>
        ) : (
            inner
        );
    }
    return <SubscriptionPaymentsCompanyColumnDash />;
}

function SubscriptionPaymentOfflineCompanyNameCell({
    slice,
    searchHighlight,
    reserveRail = true,
}: {
    slice: SubscriptionPaymentCompanySlice;
    searchHighlight: string;
    reserveRail?: boolean;
}) {
    const name = slice.name;
    if (!slice.isOnline) {
        const inner = (
            <SubscriptionPaymentTruncatedCompanyLabel name={name} searchHighlight={searchHighlight} />
        );
        return reserveRail ? (
            <SubscriptionPaymentsCompanyCellShell>{inner}</SubscriptionPaymentsCompanyCellShell>
        ) : (
            inner
        );
    }
    return <SubscriptionPaymentsCompanyColumnDash />;
}

const SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN = "min-w-0 overflow-hidden align-top";

type SubscriptionPaymentAggregateRowsProps = {
    agg: UserPaymentAggregate;
    companies: Company[];
    companyMap: Map<string, string | undefined>;
    expanded: boolean;
    onToggleExpand: () => void;
    userDisplay: SubscriptionPaymentUserDisplay;
    formatPaymentDate: (d: Date | null | undefined) => string;
    dateCellClass?: string;
    formatHistoryMillis: (v: unknown) => string;
    copyPaymentId: (id: string) => void | Promise<void>;
    resolveExpiryDate: (p: Payment) => Date | null;
    searchHighlight: string;
    amountExpanded: boolean;
    onToggleAmountExpand: () => void;
};

const SUBSCRIPTION_PAYMENTS_USER_CARD_ROW_CLASS = "subscription-payments-user-card-row";

function SubscriptionPaymentsColGroup() {
    return (
        <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "16%" }} />
        </colgroup>
    );
}

function ExpandedCompanyPrimaryOnlineCell({
    slice,
    onToggleExpand,
    searchHighlight,
}: {
    slice: SubscriptionPaymentCompanySlice;
    onToggleExpand: () => void;
    searchHighlight: string;
}) {
    const name = slice.name;
    return (
        <SubscriptionPaymentsCompanyCellShell
            rail={
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0"
                    aria-label="Collapse companies"
                    onClick={onToggleExpand}
                    aria-expanded
                >
                    <ChevronDown className="h-4 w-4" aria-hidden />
                </Button>
            }
        >
            <SubscriptionPaymentTruncatedCompanyLabel name={name} searchHighlight={searchHighlight} />
        </SubscriptionPaymentsCompanyCellShell>
    );
}

function ExpandedCompanyPrimaryOfflineCell({
    slice,
    onToggleExpand,
    searchHighlight,
}: {
    slice: SubscriptionPaymentCompanySlice;
    onToggleExpand: () => void;
    searchHighlight: string;
}) {
    const name = slice.name;
    return (
        <SubscriptionPaymentsCompanyCellShell
            rail={
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0"
                    aria-label="Collapse companies"
                    onClick={onToggleExpand}
                    aria-expanded
                >
                    <ChevronDown className="h-4 w-4" aria-hidden />
                </Button>
            }
        >
            <SubscriptionPaymentTruncatedCompanyLabel name={name} searchHighlight={searchHighlight} />
        </SubscriptionPaymentsCompanyCellShell>
    );
}

function SubscriptionPaymentAggregateRows({
    agg,
    companies,
    companyMap,
    expanded,
    onToggleExpand,
    userDisplay,
    formatPaymentDate,
    dateCellClass,
    formatHistoryMillis,
    copyPaymentId,
    resolveExpiryDate,
    searchHighlight,
    amountExpanded,
    onToggleAmountExpand,
}: SubscriptionPaymentAggregateRowsProps) {
    const hl = (text: string) => subscriptionPaymentSearchHl(text, searchHighlight);
    const slices = buildSubscriptionPaymentCompanySlices(agg, companies, companyMap);
    const multi = slices.length > 1;
    const userLabel = subscriptionPaymentUserLabelFlat(userDisplay);
    const rowKey = agg.userId || agg.latest.id;

    const showAmountExpandRail = agg.payments.length > 1;

    const renderPaymentCells = (
        p: Payment,
        historyEvents: HistoryPaymentEvent[],
        paymentCountHint?: number,
        opts?: { amountWithExpand?: boolean }
    ) => (
        <>
            <TableCell><Badge variant="secondary">{hl(p.planId)}</Badge></TableCell>
            <TableCell className="text-sm">
                {p.planChangeFrom != null && p.planChangeFrom !== "" ? (
                    <span className="flex flex-col gap-0.5 items-start">
                        <span className="whitespace-nowrap">
                            {hl(`${p.planChangeFrom} → ${p.planChangeTo ?? p.planId}`)}
                        </span>
                        {historyEvents.length > 1 ? (
                            <span className="text-[10px] text-muted-foreground">
                                +{historyEvents.length - 1} older change
                                {historyEvents.length - 1 > 1 ? "s" : ""} in History
                            </span>
                        ) : null}
                    </span>
                ) : historyEvents.length > 0 ? (
                    <span className="text-muted-foreground text-xs">
                        {historyEvents.length} change{historyEvents.length > 1 ? "s" : ""} — see History
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell>
                {historyEvents.length > 0 ? (
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                    chromeProPillCn,
                                    "h-auto min-h-0 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none hover:bg-blue-100/80"
                                )}
                            >
                                View ({countAugmentedHistory(historyEvents)})
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                            <PlanChangeHistoryDialogBody
                                historyEvents={historyEvents}
                                userLabel={userLabel}
                                userId={agg.userId}
                                companyMap={companyMap}
                                formatPaymentDate={(d) => formatPaymentDate(d)}
                                formatHistoryMillis={formatHistoryMillis}
                                copyPaymentId={copyPaymentId}
                            />
                        </DialogContent>
                    </Dialog>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell className={cn(SUBSCRIPTION_PAYMENTS_AMOUNT_COL_CLASS, "relative align-middle")}>
                <div className="relative min-h-7">
                    {showAmountExpandRail ? (
                        <div className="absolute left-0 top-1/2 z-[1] -translate-y-1/2">
                            {opts?.amountWithExpand ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 shrink-0 p-0"
                                    aria-label={
                                        amountExpanded ? "Collapse payment history" : "Expand payment history"
                                    }
                                    aria-expanded={amountExpanded}
                                    onClick={onToggleAmountExpand}
                                >
                                    <ChevronRight
                                        className={cn("h-3.5 w-3.5", amountExpanded && "rotate-90")}
                                        aria-hidden
                                    />
                                </Button>
                            ) : (
                                <span className={SUBSCRIPTION_PAYMENTS_AMOUNT_RAIL_CN} aria-hidden />
                            )}
                        </div>
                    ) : null}
                    <span className="subscription-payments-amount-value block">
                        {hl(`${p.amount.toFixed(2)} ${p.currency}`)}
                    </span>
                </div>
            </TableCell>
            <TableCell>
                <Badge
                    variant="outline"
                    className={cn(chromeProPillCn, "font-semibold hover:bg-blue-100/80")}
                >
                    {hl(p.gateway)}
                </Badge>
            </TableCell>
            <TableCell className="min-w-0 max-w-[10rem] w-40 p-1 align-middle">
                <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="block w-full min-w-0 truncate text-left font-mono text-xs rounded px-0.5 py-0.5 hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-copy"
                            aria-label={`Copy transaction ID: ${p.paymentId}`}
                            onClick={() => void copyPaymentId(p.paymentId)}
                        >
                            {hl(p.paymentId)}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent
                        side="top"
                        align="start"
                        className="max-w-[min(90vw,36rem)] break-all font-mono text-xs"
                    >
                        {p.paymentId}
                        {paymentCountHint != null && paymentCountHint > 1 ? (
                            <span className="block mt-1 text-muted-foreground">
                                Latest of {paymentCountHint} payments — others in History
                            </span>
                        ) : null}
                    </TooltipContent>
                </Tooltip>
            </TableCell>
        </>
    );

    const renderUserCell = (rowSpan?: number) => (
        <TableCell className="max-w-[14rem] align-top" rowSpan={rowSpan}>
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium leading-snug" title={userDisplay.primary}>
                    {hl(userDisplay.primary)}
                </span>
                {userDisplay.secondary ? (
                    <span
                        className="truncate text-[11px] leading-snug text-muted-foreground"
                        title={userDisplay.secondary}
                    >
                        {hl(userDisplay.secondary)}
                    </span>
                ) : null}
            </div>
        </TableCell>
    );

    const p = agg.latest;
    const companyExtraSlices = multi && expanded ? slices.slice(1) : [];
    const paymentHistoryRows =
        amountExpanded && agg.payments.length > 1
            ? [...agg.payments].sort(
                  (a, b) => (paymentCreatedMs(b) ?? 0) - (paymentCreatedMs(a) ?? 0)
              )
            : [];
    const dash = <span className="text-muted-foreground">—</span>;
    const companyDash = <SubscriptionPaymentsCompanyColumnDash />;
    const primary = slices[0];
    const collapsedCols =
        multi && !expanded
            ? collapsedMultiCompanyColumnCells(slices, onToggleExpand, searchHighlight)
            : null;

    let onlineCell: ReactNode;
    let offlineCell: ReactNode;
    if (slices.length === 0) {
        onlineCell = <span className="text-muted-foreground">N/A</span>;
        offlineCell = <span className="text-muted-foreground">N/A</span>;
    } else if (multi && expanded && primary) {
        if (primary.isOnline) {
            onlineCell = (
                <ExpandedCompanyPrimaryOnlineCell
                    slice={primary}
                    onToggleExpand={onToggleExpand}
                    searchHighlight={searchHighlight}
                />
            );
            offlineCell = companyDash;
        } else {
            onlineCell = companyDash;
            offlineCell = (
                <ExpandedCompanyPrimaryOfflineCell
                    slice={primary}
                    onToggleExpand={onToggleExpand}
                    searchHighlight={searchHighlight}
                />
            );
        }
    } else if (collapsedCols) {
        onlineCell = collapsedCols.online;
        offlineCell = collapsedCols.offline;
    } else {
        onlineCell = (
            <SubscriptionPaymentCompanyNameCell slice={primary} searchHighlight={searchHighlight} />
        );
        offlineCell = (
            <SubscriptionPaymentOfflineCompanyNameCell slice={primary} searchHighlight={searchHighlight} />
        );
    }

    return (
        <TableRow key={rowKey} className={cn(SUBSCRIPTION_PAYMENTS_USER_CARD_ROW_CLASS, "!border-0")}>
            <TableCell colSpan={11} className="border-0 bg-transparent px-0 py-1.5 align-top shadow-none">
                <div
                    data-pl-subscription-payments-user-card=""
                    className="overflow-hidden rounded-xl border border-blue-500 bg-blue-50/50 outline outline-1 outline-blue-500/80 dark:border-blue-600 dark:bg-blue-950/20 dark:outline-blue-600/80"
                >
                    <table
                        className={cn(
                            "border-collapse text-sm",
                            SUBSCRIPTION_PAYMENTS_TABLE_FIXED_CLASS
                        )}
                        data-pl-subscription-payments-inner-table=""
                    >
                        <SubscriptionPaymentsColGroup />
                        <tbody>
                            <TableRow className="!border-0 hover:bg-muted/30">
                                <TableCell className={dateCellClass}>
                                    {agg.joinedAt ? hl(formatPaymentDate(agg.joinedAt)) : "N/A"}
                                </TableCell>
                                <TableCell className={dateCellClass}>
                                    {hl(formatPaymentDate(agg.expiryDate) || "—")}
                                </TableCell>
                                <TableCell
                                    className={cn(
                                        SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                        SUBSCRIPTION_PAYMENTS_ONLINE_COMPANY_COL_CLASS
                                    )}
                                >
                                    {onlineCell}
                                </TableCell>
                                <TableCell
                                    className={cn(
                                        SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                        SUBSCRIPTION_PAYMENTS_OFFLINE_COMPANY_COL_CLASS
                                    )}
                                >
                                    {offlineCell}
                                </TableCell>
                                {renderUserCell()}
                                {renderPaymentCells(p, agg.historyEvents, agg.payments.length, {
                                    amountWithExpand: true,
                                })}
                            </TableRow>
                            {companyExtraSlices.map((slice) => (
                                <TableRow key={`${rowKey}:co:${slice.companyId}`} className="!border-0">
                                    <TableCell colSpan={2} className="p-1" />
                                    <TableCell
                                        className={cn(
                                            SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                            SUBSCRIPTION_PAYMENTS_ONLINE_COMPANY_COL_CLASS
                                        )}
                                    >
                                        <SubscriptionPaymentCompanyNameCell
                                            slice={slice}
                                            searchHighlight={searchHighlight}
                                        />
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                            SUBSCRIPTION_PAYMENTS_OFFLINE_COMPANY_COL_CLASS
                                        )}
                                    >
                                        <SubscriptionPaymentOfflineCompanyNameCell
                                            slice={slice}
                                            searchHighlight={searchHighlight}
                                        />
                                    </TableCell>
                                    <TableCell colSpan={7} className="p-1" />
                                </TableRow>
                            ))}
                            {paymentHistoryRows.map((pay) => {
                                const hist = agg.historyEvents.filter((e) => e.companyId === pay.companyId);
                                const payCreatedMsVal = paymentCreatedMs(pay);
                                const payDate = payCreatedMsVal != null ? new Date(payCreatedMsVal) : null;
                                const payExpiry = resolveExpiryDate(pay);
                                const paySlice =
                                    slices.find((s) => s.companyId === pay.companyId) ??
                                    (pay.companyId
                                        ? {
                                              companyId: pay.companyId,
                                              name: companyMap.get(pay.companyId) || pay.companyId,
                                              isOnline: true,
                                              payment: pay,
                                          }
                                        : null);
                                return (
                                    <TableRow
                                        key={`${rowKey}:pay:${pay.id}`}
                                        className="!border-0 hover:bg-muted/25"
                                    >
                                        <TableCell className={dateCellClass}>
                                            {payDate ? hl(formatPaymentDate(payDate)) : "N/A"}
                                        </TableCell>
                                        <TableCell className={dateCellClass}>
                                            {hl(formatPaymentDate(payExpiry) || "—")}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                                SUBSCRIPTION_PAYMENTS_ONLINE_COMPANY_COL_CLASS
                                            )}
                                        >
                                            {paySlice ? (
                                                <SubscriptionPaymentCompanyNameCell
                                                    slice={paySlice}
                                                    searchHighlight={searchHighlight}
                                                />
                                            ) : (
                                                companyDash
                                            )}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                SUBSCRIPTION_PAYMENTS_COMPANY_TD_CN,
                                                SUBSCRIPTION_PAYMENTS_OFFLINE_COMPANY_COL_CLASS
                                            )}
                                        >
                                            {paySlice ? (
                                                <SubscriptionPaymentOfflineCompanyNameCell
                                                    slice={paySlice}
                                                    searchHighlight={searchHighlight}
                                                />
                                            ) : (
                                                companyDash
                                            )}
                                        </TableCell>
                                        <TableCell className="p-1">{dash}</TableCell>
                                        {renderPaymentCells(pay, hist, 1)}
                                    </TableRow>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </TableCell>
        </TableRow>
    );
}

type PlanHistoryTableRow = { subject: string; old: string; new: string };

/** NPR amounts and dates formatted; pairs (plan / days / expiry) use Old vs New columns. */
function formatHistoryNpr(v: unknown): string {
    if (typeof v === "number" && !Number.isNaN(v)) {
        return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return "—";
}

/**
 * Turn stored `planChangeHistory` into Subject | Old | New rows (admin dialog table).
 * Known keys get friendly labels and order; anything else falls through as extra subjects.
 */
function buildPlanChangeHistoryRows(
    h: Record<string, unknown>,
    formatExpiryMs: (v: unknown) => string
): PlanHistoryTableRow[] {
    const g = (k: string) => h[k];
    const rows: PlanHistoryTableRow[] = [];

    const cellStr = (v: unknown) => (v === undefined || v === null ? "—" : String(v));

    if ("oldPlanId" in h || "newPlanId" in h) {
        rows.push({ subject: "Plan ID", old: cellStr(g("oldPlanId")), new: cellStr(g("newPlanId")) });
    }
    if ("oldDaysLeft" in h || "newDaysLeft" in h) {
        rows.push({ subject: "Days left", old: cellStr(g("oldDaysLeft")), new: cellStr(g("newDaysLeft")) });
    }
    if ("oldExpiryMs" in h || "newExpiryMs" in h) {
        rows.push({
            subject: "Expiry date",
            old: formatExpiryMs(g("oldExpiryMs")),
            new: formatExpiryMs(g("newExpiryMs")),
        });
    }

    const changeKind = g("changeKind");
    if (changeKind !== undefined && changeKind !== null && String(changeKind) !== "") {
        rows.push({ subject: "Change kind", old: "—", new: String(changeKind) });
    }
    const termKey = g("termKey");
    if (termKey !== undefined && termKey !== null && String(termKey) !== "") {
        rows.push({ subject: "Term", old: "—", new: String(termKey) });
    }

    if (g("grossNpr") !== undefined && g("grossNpr") !== null) {
        rows.push({ subject: "Gross (NPR)", old: "—", new: formatHistoryNpr(g("grossNpr")) });
    }
    if (g("creditNpr") !== undefined && g("creditNpr") !== null) {
        rows.push({ subject: "Credit (NPR)", old: "—", new: formatHistoryNpr(g("creditNpr")) });
    }
    if (g("netNpr") !== undefined && g("netNpr") !== null) {
        rows.push({ subject: "Net (NPR)", old: "—", new: formatHistoryNpr(g("netNpr")) });
    }

    const consumed = new Set([
        "oldPlanId",
        "newPlanId",
        "oldDaysLeft",
        "newDaysLeft",
        "oldExpiryMs",
        "newExpiryMs",
        "changeKind",
        "termKey",
        "grossNpr",
        "creditNpr",
        "netNpr",
    ]);

    for (const [key, val] of Object.entries(h)) {
        if (consumed.has(key)) continue;
        const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
        rows.push({
            subject: label,
            old: "—",
            new: typeof val === "object" && val !== null ? JSON.stringify(val) : cellStr(val),
        });
    }

    return rows;
}

/**
 * Between two real payments: if user paid again after the previous record’s `newExpiryMs`, insert a “lapse” record
 * so admin sees the uncovered days (renew nahi kiya, phir subscribe kiya).
 */
function augmentHistoryWithGaps(events: HistoryPaymentEvent[]): AugmentedHistoryItem[] {
    if (events.length === 0) return [];
    const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
    const chronological: AugmentedHistoryItem[] = [];

    for (let i = 0; i < sorted.length; i++) {
        if (i > 0) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            const rawPrevEnd = prev.history.newExpiryMs;
            const prevEndNum =
                typeof rawPrevEnd === "number" && !Number.isNaN(rawPrevEnd) ? rawPrevEnd : null;
            if (prevEndNum != null && curr.atMs > prevEndNum + GAP_MIN_AFTER_EXPIRY_MS) {
                const daysLapsed = Math.floor((curr.atMs - prevEndNum) / MS_DAY_ADMIN_HIST);
                chronological.push({
                    kind: "gap",
                    gapKey: `gap:${prev.eventKey}:${curr.eventKey}`,
                    fromMs: prevEndNum,
                    toMs: curr.atMs,
                    daysLapsed: Math.max(1, daysLapsed),
                });
            }
        }
        chronological.push({ kind: "payment", ...sorted[i] });
    }

    // Newest-first for the dialog (latest payment at top; gaps sit under the payment that ended the lapse).
    return chronological.reverse();
}

/** Subject | Old | New rows for a synthetic lapse record (no gateway payment). */
function buildGapHistoryRows(formatExpiryMs: (v: unknown) => string, gap: Extract<AugmentedHistoryItem, { kind: "gap" }>): PlanHistoryTableRow[] {
    return [
        {
            subject: "Record type",
            old: "—",
            new: "Subscription lapse (no active plan between prior expiry and next payment)",
        },
        {
            subject: "Prior plan ended",
            old: formatExpiryMs(gap.fromMs),
            new: "—",
        },
        {
            subject: "Resubscribed / paid again",
            old: "—",
            new: formatExpiryMs(gap.toMs),
        },
        {
            subject: "Approx. days without renewal",
            old: "—",
            new: String(gap.daysLapsed),
        },
    ];
}

/** Total items in admin history dialog (payments + gap records). */
function countAugmentedHistory(events: HistoryPaymentEvent[]): number {
    return augmentHistoryWithGaps(events).length;
}

type PlanChangeHistoryDialogBodyProps = {
    historyEvents: HistoryPaymentEvent[];
    userLabel: string;
    userId: string;
    companyMap: Map<string, string | undefined>;
    formatPaymentDate: (d: Date) => string;
    formatHistoryMillis: (v: unknown) => string;
    copyPaymentId: (id: string) => void | Promise<void>;
};

/**
 * History list: each record is a clickable card; selected card gets a bold primary (blue) outline.
 * Copy buttons stopPropagation so they don’t change selection.
 */
function PlanChangeHistoryDialogBody({
    historyEvents,
    userLabel,
    userId,
    companyMap,
    formatPaymentDate,
    formatHistoryMillis,
    copyPaymentId,
}: PlanChangeHistoryDialogBodyProps) {
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const augmented = useMemo(() => augmentHistoryWithGaps(historyEvents), [historyEvents]);
    const gapCount = useMemo(() => augmented.filter((x) => x.kind === "gap").length, [augmented]);
    const payCount = useMemo(() => augmented.filter((x) => x.kind === "payment").length, [augmented]);

    return (
        <>
            <DialogHeader>
                <DialogTitle>
                    Plan change history
                    {userId ? ` · ${userLabel}` : ""}
                </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">
                <span className="font-medium text-foreground">
                    {augmented.length} record
                    {augmented.length !== 1 ? "s" : ""}
                </span>
                {gapCount > 0 ? (
                    <span className="ml-1">
                        ({payCount} payment{payCount !== 1 ? "s" : ""}, {gapCount} lapse gap{gapCount !== 1 ? "s" : ""})
                    </span>
                ) : null}
            </p>
            <div className="space-y-6 text-sm">
                {augmented.map((item) => {
                    const rowKey = item.kind === "payment" ? item.eventKey : item.gapKey;
                    const isSelected = selectedKey === rowKey;
                    return (
                        <div
                            key={rowKey}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedKey((prev) => (prev === rowKey ? null : rowKey))}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedKey((prev) => (prev === rowKey ? null : rowKey));
                                }
                            }}
                            className={cn(
                                "rounded-lg border-2 bg-muted/30 p-4 space-y-3 shadow-sm cursor-pointer transition-[box-shadow,border-color,background-color] outline-none",
                                isSelected
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                                    : "border-border/70 hover:bg-muted/40"
                            )}
                            aria-pressed={isSelected}
                        >
                            {item.kind === "gap" ? (
                                <>
                                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 border-b border-amber-200/50 dark:border-amber-800/50 pb-2">
                                        Subscription lapse · {item.daysLapsed} day
                                        {item.daysLapsed !== 1 ? "s" : ""} without renewal
                                    </p>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[28%]">Subject</TableHead>
                                                <TableHead className="w-[36%]">Old</TableHead>
                                                <TableHead className="w-[36%]">New</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {buildGapHistoryRows(
                                                (v) => {
                                                    if (v === undefined || v === null || v === "") return "—";
                                                    if (typeof v === "number" && !Number.isNaN(v)) {
                                                        return formatHistoryMillis(v);
                                                    }
                                                    return String(v);
                                                },
                                                item
                                            ).map((row, idx) => (
                                                <TableRow key={`${item.gapKey}-${idx}`}>
                                                    <TableCell className="font-medium text-muted-foreground align-top">
                                                        {row.subject}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs break-words align-top">
                                                        {row.old}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs break-words align-top">
                                                        {row.new}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground border-b pb-2">
                                        <span className="shrink-0 whitespace-nowrap">
                                            {formatPaymentDate(new Date(item.atMs))}
                                        </span>
                                        <Tooltip delayDuration={250}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="min-w-0 max-w-[12rem] sm:max-w-[16rem] truncate font-mono text-left text-xs rounded px-0.5 hover:bg-muted/80 cursor-copy focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    aria-label={`Copy transaction ID: ${item.paymentId}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void copyPaymentId(item.paymentId);
                                                    }}
                                                >
                                                    {item.paymentId}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent
                                                side="top"
                                                className="max-w-[min(90vw,36rem)] break-all font-mono text-xs"
                                            >
                                                {item.paymentId}
                                            </TooltipContent>
                                        </Tooltip>
                                        <span className="shrink-0">
                                            · {companyMap.get(item.companyId) || item.companyId}
                                        </span>
                                    </div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[28%]">Subject</TableHead>
                                                <TableHead className="w-[36%]">Old</TableHead>
                                                <TableHead className="w-[36%]">New</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {buildPlanChangeHistoryRows(item.history, (v) => {
                                                if (v === undefined || v === null || v === "") return "—";
                                                if (typeof v === "number" && !Number.isNaN(v)) {
                                                    return formatHistoryMillis(v);
                                                }
                                                return String(v);
                                            }).map((row, idx) => (
                                                <TableRow key={`${item.eventKey}-${idx}`}>
                                                    <TableCell className="font-medium text-muted-foreground align-top">
                                                        {row.subject}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs break-words align-top">
                                                        {row.old}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs break-words align-top">
                                                        {row.new}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}

export default function PaymentsPage() {
    const { loading: adminGateLoading } = useAdminAccess(['SuperAdmin']);
    const { user: firebaseUser, loading: authLoading } = useAuth();
    const [payments, setPayments] = useState<Payment[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [users, setUsers] = useState<AppUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [gatewayFilter, setGatewayFilter] = useState<GatewayFilter>("all");
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [pageSize, setPageSize] = useState(20);
    const [page, setPage] = useState(1);
    const [expandedPaymentRows, setExpandedPaymentRows] = useState<Set<string>>(() => new Set());
    const [expandedAmountRows, setExpandedAmountRows] = useState<Set<string>>(() => new Set());

    // Respect header date system (AD / BS / Both) same as dashboard vouchers (e.g. LinkPaymentToTxnsDialog).
    const { dateSystem, formatDate, dateFormatBS } = useDate();

    /**
     * Admin table: same BS rules as billing — NepaliDate range + datex-bs extension; “(AD)” only when no BS exists.
     */
    const formatPaymentDate = useCallback(
        (d: Date | null | undefined) => {
            if (!d || !(d instanceof Date) || isNaN(d.getTime())) return 'N/A';
            const ad = formatDate(d) || 'N/A';
            if (dateSystem === 'AD') return ad;
            const bs = formatBsFromAD(d, dateFormatBS);
            if (dateSystem === 'BS') return bs || `${ad} (AD)`;
            return bs ? `${bs}\n(${ad})` : ad;
        },
        [dateSystem, formatDate, dateFormatBS]
    );

    // collectionGroup on client hits strict rules; Admin route reads with service account (see /api/admin/subscription-payments).
    useEffect(() => {
        if (adminGateLoading || authLoading || !firebaseUser) return;

        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                if (isAdminServerMode()) throw new Error(ADMIN_SERVER_VIEW_UNAVAILABLE_MESSAGE);
                const token = await firebaseUser.getIdToken();
                const res = await fetch(appApiUrl("/api/admin/subscription-payments"), {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                const raw = await res.text();
                let data: { error?: string; payments?: unknown[] } = {};
                try {
                    data = raw ? (JSON.parse(raw) as { error?: string; payments?: unknown[] }) : {};
                } catch {
                    throw new Error(
                        res.ok
                            ? "Invalid JSON from subscription-payments API"
                            : `HTTP ${res.status} — expected JSON (check /app basePath in dev gateway)`
                    );
                }
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                const list = (data.payments ?? []).map(
                    (p: {
                        id: string;
                        companyId: string;
                        userId: string;
                        planId: string;
                        amount: number;
                        currency: string;
                        gateway: string;
                        status: string;
                        paymentId: string;
                        createdAtMs: number | null;
                        planExpiryMs?: number | null;
                        planChangeFrom?: string | null;
                        planChangeTo?: string | null;
                        planChangeHistory?: Record<string, unknown> | null;
                    }) =>
                        ({
                            id: p.id,
                            companyId: p.companyId,
                            userId: p.userId,
                            planId: p.planId,
                            amount: p.amount,
                            currency: p.currency,
                            gateway: p.gateway as Payment["gateway"],
                            status: p.status,
                            paymentId: p.paymentId,
                            createdAt:
                                p.createdAtMs != null ? { toDate: () => new Date(p.createdAtMs) } : null,
                            planExpiryMs:
                                typeof p.planExpiryMs === "number" && !Number.isNaN(p.planExpiryMs)
                                    ? p.planExpiryMs
                                    : null,
                            planChangeFrom: p.planChangeFrom ?? null,
                            planChangeTo: p.planChangeTo ?? null,
                            planChangeHistory:
                                p.planChangeHistory != null && typeof p.planChangeHistory === "object"
                                    ? p.planChangeHistory
                                    : null,
                        }) as Payment
                );
                if (!cancelled) setPayments(list);
            } catch (e) {
                console.error("Error fetching payments:", e);
                if (!cancelled) setPayments([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [firebaseUser, adminGateLoading, authLoading]);

    useEffect(() => {
        if (adminGateLoading || authLoading || !firebaseUser) return;

        const companiesQuery = query(collection(firestore, 'companies'));
        const usersQuery = query(collection(firestore, 'users'));

        const unsubCompanies = onSnapshot(companiesQuery, (snapshot) => {
            setCompanies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Company)));
        }, (err) => console.error("Error fetching companies:", err));

        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppUser)));
        }, (err) => console.error("Error fetching users:", err));

        return () => {
            unsubCompanies();
            unsubUsers();
        };
    }, [firebaseUser, adminGateLoading, authLoading]);

    const companyMap = useMemo(() => new Map(companies.map(c => [c.id, c.name])), [companies]);

    const resolveUserDisplay = useCallback(
        (paymentUserId: string, companyIds: string[]) =>
            resolveSubscriptionPaymentUserDisplay(paymentUserId, companyIds, companies, users),
        [companies, users]
    );

    /** Latest company plan expiry (fallback when payment row has no planExpiryMs — e.g. legacy data). */
    const companyExpiryMap = useMemo(() => {
        const m = new Map<string, Date | null>();
        for (const c of companies) {
            const pe = c.planExpiry;
            let dt: Date | null = null;
            if (pe != null && typeof (pe as { toDate?: () => Date }).toDate === "function") {
                try {
                    const d = (pe as { toDate: () => Date }).toDate();
                    dt = isNaN(d.getTime()) ? null : d;
                } catch {
                    dt = null;
                }
            }
            m.set(c.id, dt);
        }
        return m;
    }, [companies]);

    const resolveExpiryDate = useCallback(
        (p: Payment): Date | null => {
            if (p.planExpiryMs != null) {
                const d = new Date(p.planExpiryMs);
                return isNaN(d.getTime()) ? null : d;
            }
            return companyExpiryMap.get(p.companyId) ?? null;
        },
        [companyExpiryMap]
    );

    const filteredPayments = useMemo(() => {
        let list = payments;

        if (gatewayFilter !== "all") {
            list = list.filter((p) => p.gateway === gatewayFilter);
        }

        if (dateRange?.from) {
            const from = startOfDay(dateRange.from).getTime();
            list = list.filter((p) => {
                const t = p.createdAt?.toDate?.()?.getTime();
                return t != null && !Number.isNaN(t) && t >= from;
            });
        }
        if (dateRange?.to) {
            const to = endOfDay(dateRange.to).getTime();
            list = list.filter((p) => {
                const t = p.createdAt?.toDate?.()?.getTime();
                return t != null && !Number.isNaN(t) && t <= to;
            });
        }

        if (!searchTerm) return list;
        const lowerCaseSearch = searchTerm.toLowerCase();
        return list.filter(p =>
            p.paymentId.toLowerCase().includes(lowerCaseSearch) ||
            p.planId.toLowerCase().includes(lowerCaseSearch) ||
            p.gateway.toLowerCase().includes(lowerCaseSearch) ||
            (p.planChangeFrom?.toLowerCase().includes(lowerCaseSearch) ?? false) ||
            (p.planChangeTo?.toLowerCase().includes(lowerCaseSearch) ?? false) ||
            subscriptionPaymentUserSearchText(
                resolveSubscriptionPaymentUserDisplay(
                    p.userId,
                    p.companyId ? [p.companyId] : [],
                    companies,
                    users
                )
            ).includes(lowerCaseSearch) ||
            companyMap.get(p.companyId)?.toLowerCase().includes(lowerCaseSearch)
        );
    }, [payments, gatewayFilter, dateRange, searchTerm, companyMap, companies, users]);

    /** Collapse to one row per user; History merges every `planChangeHistory` on that user’s payment docs. */
    const aggregatedByUser = useMemo((): UserPaymentAggregate[] => {
        const groups = new Map<string, Payment[]>();
        for (const p of filteredPayments) {
            const uid = p.userId?.trim() || `__missing_uid__:${p.id}`;
            const arr = groups.get(uid) ?? [];
            arr.push(p);
            groups.set(uid, arr);
        }

        const out: UserPaymentAggregate[] = [];
        for (const [groupKey, list] of groups) {
            const sorted = [...list].sort((a, b) => {
                const ta = paymentCreatedMs(a) ?? 0;
                const tb = paymentCreatedMs(b) ?? 0;
                return tb - ta;
            });
            const latest = sorted[0];
            const times = sorted.map(paymentCreatedMs).filter((t): t is number => t != null);
            const joinedAt = times.length ? new Date(Math.min(...times)) : null;

            let maxExpiry = -Infinity;
            for (const p of sorted) {
                const d = resolveExpiryDate(p);
                const t = d?.getTime();
                if (t != null && !Number.isNaN(t)) maxExpiry = Math.max(maxExpiry, t);
            }
            const expiryDate = maxExpiry === -Infinity ? null : new Date(maxExpiry);

            const companyIds = [...new Set(sorted.map((x) => x.companyId).filter(Boolean))];
            const companyLabel =
                companyIds.length === 0
                    ? "N/A"
                    : companyIds.length === 1
                      ? companyMap.get(companyIds[0]) || companyIds[0]
                      : companyIds.map((id) => companyMap.get(id) || id).join(", ");

            const historyEvents = sorted
                .filter((p) => p.planChangeHistory != null)
                .map((p) => ({
                    eventKey: `${p.id}:${paymentCreatedMs(p) ?? 0}`,
                    atMs: paymentCreatedMs(p) ?? 0,
                    paymentId: p.paymentId,
                    companyId: p.companyId,
                    history: p.planChangeHistory as Record<string, unknown>,
                }))
                .sort((a, b) => b.atMs - a.atMs);

            const userId = groupKey.startsWith("__missing_uid__:") ? "" : groupKey;

            out.push({
                userId,
                payments: sorted,
                latest,
                joinedAt,
                expiryDate,
                companyLabel,
                historyEvents,
            });
        }

        out.sort((a, b) => (paymentCreatedMs(b.latest) ?? 0) - (paymentCreatedMs(a.latest) ?? 0));
        return out;
    }, [filteredPayments, companyMap, resolveExpiryDate]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm, gatewayFilter, dateRange]);

    const totalFiltered = aggregatedByUser.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1);
    const safePage = Math.min(page, totalPages);
    const pageSlice = useMemo(() => {
        const p = Math.min(page, totalPages);
        const start = (p - 1) * pageSize;
        return aggregatedByUser.slice(start, start + pageSize);
    }, [aggregatedByUser, page, pageSize, totalPages]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const showFrom = totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const showTo = Math.min(safePage * pageSize, totalFiltered);

    const renderLoadingRows = () => (
        Array.from({ length: 10 }).map((_, i) => (
            <TableRow key={`loading-${i}`} className="!border-0">
                <TableCell colSpan={11}><Skeleton className="h-8 w-full" /></TableCell>
            </TableRow>
        ))
    );

    const formatHistoryMillis = useCallback(
        (v: unknown) => {
            if (typeof v !== "number" || Number.isNaN(v)) return "—";
            return formatPaymentDate(new Date(v));
        },
        [formatPaymentDate]
    );

    /** Click: copy full gateway/Stripe id; hover (Tooltip) shows full string in a fixed-width column. */
    const copyPaymentId = useCallback(async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            toast({ title: "Copied", description: "Transaction ID copied to clipboard." });
        } catch {
            toast({
                variant: "destructive",
                title: "Copy failed",
                description: "Could not access the clipboard.",
            });
        }
    }, []);

    const tableLoading = adminGateLoading || authLoading || loading;
    const dateCellClass =
        dateSystem === "Both"
            ? "whitespace-pre-line break-words leading-snug align-top min-w-[6.75rem]"
            : "align-top whitespace-nowrap";
    const dateHeadClass =
        dateSystem === "Both" ? "align-top min-w-[6.75rem]" : undefined;

    const subscriptionPaymentsListIntro =
        "One row per user (payments are grouped). Open History to see every plan change recorded for that user.";

    return (
        <div
            data-pl-subscription-payments-page=""
            className="flex h-full min-h-0 flex-1 flex-col gap-6"
        >
            <Card className="shrink-0">
                <CardHeader>
                    <div
                        className="flex w-full min-w-0 flex-nowrap items-end gap-2 overflow-x-auto pb-0.5 scrollbar-slim-dim"
                    >
                        <div className="flex shrink-0 items-center gap-1.5 self-center">
                            <CardTitle className="mb-0 whitespace-nowrap text-xl leading-none sm:text-2xl">
                                Subscription Payments
                            </CardTitle>
                            <Tooltip delayDuration={200}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0"
                                        aria-label="About subscription payments list"
                                    >
                                        <Info className="h-4 w-4" aria-hidden />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
                                    {subscriptionPaymentsListIntro}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <div className="relative min-w-[8rem] max-w-xs flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="search anything"
                                className={cn(
                                    "h-9 pl-9 focus-visible:ring-0 focus-visible:ring-offset-0",
                                    searchTerm.trim() ? "pr-9" : undefined
                                )}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {searchTerm.trim() ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    aria-label="Clear search"
                                    onClick={() => setSearchTerm("")}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                            <span className="text-xs leading-none text-muted-foreground whitespace-nowrap">Gateway</span>
                            <Select value={gatewayFilter} onValueChange={(v) => setGatewayFilter(v as GatewayFilter)}>
                                <SelectTrigger className="h-9 w-[7.5rem]">
                                    <SelectValue placeholder="Gateway" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="stripe">Stripe</SelectItem>
                                    <SelectItem value="khalti">Khalti</SelectItem>
                                    <SelectItem value="esewa">eSewa</SelectItem>
                                    <SelectItem value="internal">Internal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <AdminPanelDateRangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            matchInputHeight
                            className="shrink-0 flex-nowrap"
                            />
                        </div>
                </CardHeader>
            </Card>

            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                    <div
                        data-pl-subscription-payments-scroll=""
                        className="min-h-0 w-full flex-1 overflow-x-auto overflow-y-auto scrollbar-slim-dim"
                    >
                        <div className={cn("px-[3px]", SUBSCRIPTION_PAYMENTS_TABLE_SCROLL_MIN_CLASS)}>
                        <Table
                            data-pl-subscription-payments-table
                            scrollContainer={false}
                            className={cn(
                                "border-collapse [&_tr]:!border-0",
                                SUBSCRIPTION_PAYMENTS_TABLE_SCROLL_MIN_CLASS,
                                "table-fixed"
                            )}
                        >
                            <SubscriptionPaymentsColGroup />
                            <TableHeader className="[&_tr]:!border-0 subscription-payments-table-header">
                                <TableRow className="!border-0 hover:bg-transparent">
                                    <TableHead className={dateHeadClass}>Joined date</TableHead>
                                    <TableHead className={dateHeadClass}>Expiry date</TableHead>
                                    <TableHead className={SUBSCRIPTION_PAYMENTS_ONLINE_COMPANY_COL_CLASS}>
                                        Online company
                                    </TableHead>
                                    <TableHead className={SUBSCRIPTION_PAYMENTS_OFFLINE_COMPANY_COL_CLASS}>
                                        Offline company
                                    </TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Plan ID</TableHead>
                                    <TableHead>Changed plan</TableHead>
                                    <TableHead>History</TableHead>
                                    <TableHead className={SUBSCRIPTION_PAYMENTS_AMOUNT_COL_CLASS}>
                                        Amount
                                    </TableHead>
                                    <TableHead>Gateway</TableHead>
                                    <TableHead>Transaction ID</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="[&_tr]:!border-0 [&_tr:last-child]:!border-0">
                                {tableLoading ? renderLoadingRows() : (
                                    aggregatedByUser.length === 0 ? (
                                        <TableRow className="!border-0">
                                            <TableCell colSpan={11} className="text-center py-16 text-muted-foreground">No payments found.</TableCell>
                                        </TableRow>
                                    ) : (
                                        pageSlice.map((agg) => {
                                            const companyIds = [
                                                ...new Set(agg.payments.map((x) => x.companyId).filter(Boolean)),
                                            ];
                                            const rowKey = agg.userId || agg.latest.id;
                                            const userDisplay = resolveSubscriptionPaymentUserDisplay(
                                                agg.userId,
                                                companyIds,
                                                companies,
                                                users
                                            );
                                            const expanded = expandedPaymentRows.has(rowKey);
                                            const amountExpanded = expandedAmountRows.has(rowKey);
                                            return (
                                                <SubscriptionPaymentAggregateRows
                                                    key={rowKey}
                                                    agg={agg}
                                                    companies={companies}
                                                                    companyMap={companyMap}
                                                    expanded={expanded}
                                                    onToggleExpand={() => {
                                                        setExpandedPaymentRows((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(rowKey)) next.delete(rowKey);
                                                            else next.add(rowKey);
                                                            return next;
                                                        });
                                                    }}
                                                    amountExpanded={amountExpanded}
                                                    onToggleAmountExpand={() => {
                                                        setExpandedAmountRows((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(rowKey)) next.delete(rowKey);
                                                            else next.add(rowKey);
                                                            return next;
                                                        });
                                                    }}
                                                    userDisplay={userDisplay}
                                                    formatPaymentDate={formatPaymentDate}
                                                    dateCellClass={dateCellClass}
                                                                    formatHistoryMillis={formatHistoryMillis}
                                                                    copyPaymentId={copyPaymentId}
                                                    resolveExpiryDate={resolveExpiryDate}
                                                    searchHighlight={searchTerm}
                                                />
                                            );
                                        })
                                    )
                                )}
                            </TableBody>
                        </Table>
                        </div>
                    </div>
                    <div
                        data-pl-subscription-payments-footer=""
                        className="mt-auto flex w-full shrink-0 overflow-x-auto border-t border-blue-300/60 bg-blue-100/80 px-4 py-2 pl-ledger-footer-scroll dark:border-blue-800/50 dark:bg-blue-950/40"
                    >
                        <div
                            className={cn(
                                "flex min-w-max w-full flex-col gap-y-2 sm:flex-row sm:items-center sm:justify-between",
                                ledgerFooterRowCn
                            )}
                        >
                    {!tableLoading && totalFiltered > 0 ? (
                                <>
                                    <div className={cn(ledgerFooterRowCn, "text-sm text-muted-foreground")}>
                                        <LedgerFooterTextPill>
                                            {showFrom}–{showTo} of {totalFiltered}
                                        </LedgerFooterTextPill>
                                        <LedgerFooterTextPill>Rows / page</LedgerFooterTextPill>
                                    </div>
                                    <LedgerFooterParentPill>
                                        <LedgerFooterTextPill>({showFrom > 0 ? showFrom - 1 : 0})</LedgerFooterTextPill>
                                        <Button
                                            type="button"
                                            variant="chromePill"
                                            size="icon"
                                            className={ledgerFooterIconBtnCn}
                                            disabled={safePage <= 1}
                                            onClick={() => setPage(1)}
                                            aria-label="First page"
                                        >
                                            <ChevronsLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="chromePill"
                                            size="icon"
                                            className={ledgerFooterIconBtnCn}
                                            disabled={safePage <= 1}
                                            onClick={() => setPage((x) => Math.max(1, x - 1))}
                                            aria-label="Previous page"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </Button>
                                <Select
                                    value={String(pageSize)}
                                    onValueChange={(v) => {
                                        setPageSize(Number(v));
                                        setPage(1);
                                    }}
                                >
                                            <SelectTrigger
                                                data-pl-footer-rows-select
                                                className="h-7 w-[52px] shrink-0 rounded-full border-0 bg-transparent px-1 text-sm font-medium tabular-nums shadow-none focus:ring-0 focus-visible:ring-0"
                                            >
                                        <SelectValue />
                                    </SelectTrigger>
                                            <SelectContent side="top">
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                        <SelectItem value="100">100</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                            variant="chromePill"
                                    size="icon"
                                            className={ledgerFooterIconBtnCn}
                                            disabled={safePage >= totalPages}
                                            onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
                                            aria-label="Next page"
                                        >
                                            <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                            variant="chromePill"
                                    size="icon"
                                            className={ledgerFooterIconBtnCn}
                                    disabled={safePage >= totalPages}
                                            onClick={() => setPage(totalPages)}
                                            aria-label="Last page"
                                >
                                            <ChevronsRight className="h-3.5 w-3.5" />
                                </Button>
                                        <LedgerFooterTextPill>
                                            ({Math.max(0, totalFiltered - showTo)})
                                        </LedgerFooterTextPill>
                                        <LedgerFooterTextPill>
                                            Page {safePage} / {totalPages}
                                        </LedgerFooterTextPill>
                                    </LedgerFooterParentPill>
                                </>
                            ) : (
                                <LedgerFooterTextPill>
                                    {tableLoading ? "Loading…" : "No payments to paginate."}
                                </LedgerFooterTextPill>
                            )}
                            </div>
                        </div>
                </CardContent>
            </Card>
        </div>
    );
}
