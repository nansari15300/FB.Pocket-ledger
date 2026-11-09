"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { auth } from "@/lib/plClientSession";
import { getBillingApiIdToken } from "@/lib/firebaseAuthForApi";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { openBillingStatementPdfPreview } from "@/lib/billingStatementPdf";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBillingStatementWhenFormatters } from "@/hooks/useBillingStatementWhenFormatters";
import { format as formatDateFns } from "date-fns";
import { useDate } from "@/hooks/useDate";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { cn } from "@/lib/utils";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";

/** API `payments` subcollection row — mirrors `/api/company/billing-payments-statement` mapping. */
type StatementPaymentRow = {
  id: string;
  paymentId: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  billingIntent: string | null;
  planChangeFrom: string | null;
  planChangeTo: string | null;
  planChangeOneTime: boolean;
  planExpiryMs: number | null;
  createdAtMs: number | null;
  planChangeHistory: Record<string, unknown> | null;
};

type StatementResponse = {
  companyId: string;
  planId: string | null;
  planExpiryMs: number | null;
  payments: StatementPaymentRow[];
  error?: string;
};

/** Global `Table` row = 3px black — statement page par 50% = 1.5px, rang #000 (user request). */
const STMT_TABLE_ROW_LINE = "border-b-[1.5px] border-[#000000]";

/**
 * Label | : | value — colon ek hi vertical line par (fixed label column width = sabse lamba label).
 * `valueClassName`: jaise company name mobile par `truncate`.
 */
function StatementSummaryRow({
  label,
  children,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    // Labels `text-left` — poora block daen ki jagah left se chipka; colon ab bhi col 2 par line par.
    <div className="grid w-full min-w-0 grid-cols-[11rem_auto_minmax(0,1fr)] items-baseline gap-x-2 sm:grid-cols-[13.5rem_auto_minmax(0,1fr)]">
      <span className="text-left text-xs text-muted-foreground print:text-foreground sm:text-sm">{label}</span>
      <span className="text-muted-foreground print:text-foreground">:</span>
      <span className={cn("min-w-0 font-medium text-foreground", valueClassName)}>{children}</span>
    </div>
  );
}

/** Mobile card status badge — TransactionsTable mobile jaisa green/red split. */
function paymentStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("paid") || s === "success" || s === "succeeded")
    return "text-green-600 border-green-600/50";
  if (s.includes("fail") || s.includes("error") || s.includes("cancel")) return "text-red-600 border-red-600/50";
  return "text-muted-foreground border-muted-foreground/40";
}

/** Ek payment row — `TransactionsTable` mobile card border/spacing match; dates `useDate` se. */
function BillingPaymentMobileCard({ p }: { p: StatementPaymentRow }) {
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const planLine =
    p.planChangeFrom && p.planChangeTo
      ? `${p.planChangeFrom} → ${p.planChangeTo}${p.planChangeOneTime ? " (one-time)" : ""}`
      : p.planId || "—";
  const d =
    p.createdAtMs != null && Number.isFinite(p.createdAtMs) && p.createdAtMs > 0
      ? new Date(p.createdAtMs)
      : null;
  const valid = d && !Number.isNaN(d.getTime()) ? d : null;
  const clock = valid ? formatDateFns(valid, "HH:mm") : "";

  const whenBlock = !valid ? (
    <p className="font-bold text-sm text-foreground">—</p>
  ) : dateSystem === "Both" ? (
    <div className="space-y-0.5">
      <p className="font-bold text-sm text-foreground leading-tight">{formatDateBS(valid)}</p>
      <p className="text-xs font-semibold text-foreground tabular-nums">
        {formatDate(valid)} <span className="text-muted-foreground font-normal">{clock}</span>
      </p>
    </div>
  ) : (
    <p className="font-bold text-sm text-foreground">
      {dateSystem === "AD" ? `${formatDate(valid)} ${clock}` : `${formatDateBS(valid)} ${clock}`}
    </p>
  );

  return (
    <Card
      className={cn(
        "p-2.5 min-w-0 w-full overflow-hidden border-[1.5px] border-black bg-card shadow-sm",
        "transition-colors"
      )}
    >
      <div className="flex justify-between items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1 overflow-hidden">
          {whenBlock}
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            <span className="font-semibold">Plan: </span>
            {p.planId}
          </p>
        </div>
        <p className="font-bold text-sm shrink-0 tabular-nums text-foreground">
          {p.amount.toLocaleString("en-IN")} {p.currency}
        </p>
      </div>
      <div className="flex justify-between items-start gap-2 min-w-0 mt-0.5">
        <p className="text-xs text-muted-foreground break-words min-w-0 flex-1">
          <span className="font-semibold">Change: </span>
          {planLine}
        </p>
        <Badge variant="outline" className={cn("text-xs font-semibold h-[22px] shrink-0", paymentStatusBadgeClass(p.status))}>
          {p.status || "—"}
        </Badge>
      </div>
      <div className="flex justify-between items-end gap-2 min-w-0 mt-0.5">
        <p className="text-xs text-muted-foreground truncate min-w-0 flex-1">
          {(p.gateway || "—") + (p.billingIntent ? ` • ${p.billingIntent}` : "")}
        </p>
      </div>
    </Card>
  );
}

/**
 * Owner-only payment history from Firestore `companies/{id}/payments` via billing API.
 */
export default function BillingStatementPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { company, loading: companyLoading } = useCompany();
  const { dateSystem, formatDate, formatDateBS, formatWhenSingleLine, formatPlanExpirySummary } =
    useBillingStatementWhenFormatters();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [data, setData] = useState<StatementResponse | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  /** PDF overlay generate — Party Statement jaisa in-app Print toolbar. */
  const [printPdfBusy, setPrintPdfBusy] = useState(false);
  /** PC: chevron pagination; mobile: `MobileTransactionsPager`. */
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const isOwner = Boolean(user?.uid && company?.ownerId && user.uid === company.ownerId);

  useEffect(() => {
    setRowsPerPage(isMobile ? 10 : 20);
    setCurrentPage(1);
  }, [isMobile]);

  useEffect(() => {
    setCurrentPage(1);
  }, [data?.companyId]);

  const load = useCallback(async () => {
    if (!company?.id || !user) return;
    setState("loading");
    setErrMsg(null);
    try {
      const idToken = await getBillingApiIdToken(auth.currentUser).catch(() => null);
      if (!idToken) {
        setState("error");
        setErrMsg("Not signed in.");
        return;
      }
      const url = getBillingApiUrl(`/api/company/billing-payments-statement?companyId=${encodeURIComponent(company.id)}`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const json = (await res.json()) as StatementResponse & { error?: string };
      if (!res.ok) {
        setState("error");
        setErrMsg(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
      setState("ok");
    } catch (e: unknown) {
      setState("error");
      setErrMsg(e instanceof Error ? e.message : String(e));
      setData(null);
    }
  }, [company?.id, user]);

  useEffect(() => {
    if (companyLoading || !company?.id) return;
    if (!isOwner) {
      setState("error");
      setErrMsg("Only the company owner can view this statement.");
      return;
    }
    void load();
  }, [companyLoading, company?.id, isOwner, load]);

  /** PDF → `showInAppPdfPreview` (desktop) / system viewer (native) — browser `window.print` HTML nahi. */
  const handleOpenStatementPdf = useCallback(async () => {
    if (!data) return;
    setPrintPdfBusy(true);
    try {
      await openBillingStatementPdfPreview({
        companyName: company?.name ?? null,
        companyId: data.companyId,
        planId: data.planId,
        planExpiryText: formatPlanExpirySummary(data.planExpiryMs),
        payments: data.payments.map((p) => ({
          createdAtMs: p.createdAtMs,
          whenDisplay: formatWhenSingleLine(p.createdAtMs),
          amount: p.amount,
          currency: p.currency,
          gateway: p.gateway,
          status: p.status,
          planId: p.planId,
          planChangeFrom: p.planChangeFrom,
          planChangeTo: p.planChangeTo,
          planChangeOneTime: p.planChangeOneTime,
          billingIntent: p.billingIntent,
        })),
      });
    } catch (e: unknown) {
      toast({
        title: "Could not open print preview",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPrintPdfBusy(false);
    }
  }, [company?.name, data, formatPlanExpirySummary, formatWhenSingleLine]);

  const showPrintForOwner = isOwner && state === "ok" && data;

  const paymentPagination = useMemo(() => {
    const rows = data?.payments ?? [];
    const totalItems = rows.length;
    const totalPages = Math.max(1, rowsPerPage > 0 ? Math.ceil(totalItems / rowsPerPage) : 1);
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const slice =
      rowsPerPage <= 0 ? rows : rows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
    return { totalItems, totalPages, safePage, slice };
  }, [data?.payments, currentPage, rowsPerPage]);

  // Total pages shrink (data / page size) par `currentPage` ko clamp — slice aur controls align rahein.
  useEffect(() => {
    if (currentPage !== paymentPagination.safePage) setCurrentPage(paymentPagination.safePage);
  }, [currentPage, paymentPagination.safePage]);

  return (
    // `layout` main = `flex flex-col overflow-hidden` — yahan `flex-1 min-h-0` se poori usable height; scroll sirf CardContent andar.
    <div
      className={cn(
        "box-border m-[2px] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        "print:m-0 print:h-auto print:max-h-none print:min-h-0 print:w-full print:flex-none print:overflow-visible print:px-4 print:py-4"
      )}
    >
      {/* Andar ka card outer shell bhar le — scroll andar CardContent se. */}
      <Card
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col overflow-hidden border border-[#000000] print:border-[#000000] print:shadow-none",
          isMobile && "rounded-lg shadow-sm",
          "print:h-auto print:flex-none print:overflow-visible"
        )}
      >
        {/* Title + Print strip: outer Card se 2px (mobile) / 6px (PC) inset, halka blue bg. */}
        <CardHeader className="shrink-0 space-y-0 p-0">
          <div
            className={cn(
              "m-[2px] rounded-md bg-blue-50 px-4 py-3 dark:bg-blue-950/35 print:m-0 print:bg-transparent",
              "sm:m-[6px]"
            )}
          >
            <div
              className={cn(
                "flex flex-col gap-3 sm:gap-4",
                !isMobile && "sm:flex-row sm:items-start sm:justify-between sm:space-y-0"
              )}
            >
          {isMobile ? (
            <>
              {/* Mobile: Print title ke bilkul saath (fixed footer nahi). */}
              <div className="flex items-start justify-between gap-2 print:hidden">
                <CardTitle className="min-w-0 flex-1 text-lg leading-tight">Billing statement</CardTitle>
                <div className="flex shrink-0 items-center gap-1.5">
                  {showPrintForOwner ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 px-2.5"
                      disabled={printPdfBusy}
                      onClick={() => void handleOpenStatementPdf()}
                    >
                      {printPdfBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Printer className="h-4 w-4" aria-hidden />
                      )}
                      Print
                    </Button>
                  ) : null}
                </div>
              </div>
              {/* Mobile: subtitle hata — zyada vertical space; desktop par CardDescription rahega. */}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <CardTitle>Billing statement</CardTitle>
                <CardDescription className="print:text-foreground">
                  Payment records stored for this company (supplement your gateway receipts). Owner-only.
                </CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2 print:hidden">
                {showPrintForOwner ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-2"
                    disabled={printPdfBusy}
                    onClick={() => void handleOpenStatementPdf()}
                  >
                    {printPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
                    Print
                  </Button>
                ) : null}
              </div>
            </>
          )}
            </div>
          </div>
        </CardHeader>
        <CardContent
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden space-y-6",
            // Mobile: black outer border se cards/summary tak sirf 2px — pehle `p-6` bahut gap deta tha.
            isMobile && "gap-3 space-y-0 px-[2px] pb-2 pt-0"
          )}
        >
          {!isOwner && !companyLoading ? (
            <Alert variant="destructive">
              <AlertTitle>Access restricted</AlertTitle>
              <AlertDescription>{errMsg ?? "Only the company owner can view this page."}</AlertDescription>
            </Alert>
          ) : null}

          {isOwner && state === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading statement…
            </div>
          ) : null}

          {isOwner && state === "error" && errMsg ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load statement</AlertTitle>
              <AlertDescription>{errMsg}</AlertDescription>
            </Alert>
          ) : null}

          {isOwner && state === "ok" && data ? (
            <>
              {/* Company summary — shrink-0; neeche list/table flex-1 scroll. */}
              <div
                className={cn(
                  "shrink-0 rounded-md border border-[#000000] bg-muted/40 text-sm print:bg-transparent",
                  isMobile ? "p-3" : "p-4"
                )}
              >
                <div className="flex w-full min-w-0 flex-col items-stretch gap-1.5 text-left">
                  {company?.name ? (
                    <StatementSummaryRow
                      label="Company name"
                      valueClassName={isMobile ? "truncate sm:whitespace-normal sm:overflow-visible" : undefined}
                    >
                      {company.name}
                    </StatementSummaryRow>
                  ) : null}
                  {/* Company ID row hata — sirf naam + plan + expiry (user request). */}
                  <StatementSummaryRow label="Current plan">{data.planId ?? "—"}</StatementSummaryRow>
                  <StatementSummaryRow label="Plan expiry">
                    <span className="whitespace-pre-line">{formatPlanExpirySummary(data.planExpiryMs)}</span>
                  </StatementSummaryRow>
                </div>
              </div>

              {/* Mobile: cards + `MobileTransactionsPager`; desktop: table + chevron pagination. */}
              {isMobile ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    className="min-h-0 flex-1 overflow-auto scroll-touch px-0"
                    style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}
                  >
                    <div className="space-y-1 pb-2">
                      {paymentPagination.totalItems === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No payment records found for this company.</p>
                      ) : (
                        paymentPagination.slice.map((p) => <BillingPaymentMobileCard key={p.id} p={p} />)
                      )}
                    </div>
                  </div>
                  {paymentPagination.totalItems > 0 ? (
                    <MobileTransactionsPager
                      currentPage={currentPage}
                      totalItems={paymentPagination.totalItems}
                      rowsPerPage={rowsPerPage}
                      onPageChange={setCurrentPage}
                      onRowsPerPageChange={(n) => {
                        setRowsPerPage(n);
                        setCurrentPage(1);
                      }}
                      className="shrink-0 border-t border-black/25 bg-muted/20"
                    />
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[#000000]">
                    <Table>
                      <TableHeader className="[&_tr]:border-b-[1.5px] [&_tr]:border-[#000000]">
                        <TableRow className={STMT_TABLE_ROW_LINE}>
                          {dateSystem === "Both" ? (
                            <>
                              <TableHead className="min-w-[88px]">BS</TableHead>
                              <TableHead className="min-w-[100px]">AD</TableHead>
                            </>
                          ) : (
                            <TableHead>When</TableHead>
                          )}
                          <TableHead>Amount</TableHead>
                          <TableHead>Gateway</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Plan / change</TableHead>
                          <TableHead>Intent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentPagination.totalItems === 0 ? (
                          <TableRow className={STMT_TABLE_ROW_LINE}>
                            <TableCell
                              colSpan={dateSystem === "Both" ? 7 : 6}
                              className="text-center text-muted-foreground"
                            >
                              No payment records found for this company.
                            </TableCell>
                          </TableRow>
                        ) : (
                          paymentPagination.slice.map((p) => {
                            const ms = p.createdAtMs;
                            const d =
                              ms != null && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
                            const ok = d && !Number.isNaN(d.getTime()) ? d : null;
                            const clock = ok ? formatDateFns(ok, "HH:mm") : "";
                            return (
                              <TableRow key={p.id} className={STMT_TABLE_ROW_LINE}>
                                {dateSystem === "Both" ? (
                                  <>
                                    <TableCell className="whitespace-nowrap text-sm">{ok ? formatDateBS(ok) : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap tabular-nums text-sm">
                                      {ok ? (
                                        <>
                                          {formatDate(ok)} <span className="text-muted-foreground text-xs">{clock}</span>
                                        </>
                                      ) : (
                                        "—"
                                      )}
                                    </TableCell>
                                  </>
                                ) : (
                                  <TableCell className="whitespace-pre-line text-sm tabular-nums">
                                    {formatWhenSingleLine(p.createdAtMs)}
                                  </TableCell>
                                )}
                                <TableCell className="tabular-nums">
                                  {p.amount.toLocaleString("en-IN")} {p.currency}
                                </TableCell>
                                <TableCell>{p.gateway || "—"}</TableCell>
                                <TableCell>{p.status || "—"}</TableCell>
                                <TableCell className="max-w-[220px] break-words text-xs">
                                  {p.planId}
                                  {p.planChangeFrom && p.planChangeTo ? (
                                    <span className="block text-muted-foreground">
                                      {p.planChangeFrom} → {p.planChangeTo}
                                      {p.planChangeOneTime ? " (one-time)" : ""}
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-xs">{p.billingIntent ?? "—"}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {paymentPagination.totalItems > 0 ? (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-black/20 bg-muted/10 px-3 py-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        Page {paymentPagination.safePage} of {paymentPagination.totalPages}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(1)}
                        disabled={paymentPagination.safePage <= 1}
                        aria-label="First page"
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage((x) => Math.max(1, x - 1))}
                        disabled={paymentPagination.safePage <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Select
                        value={`${rowsPerPage}`}
                        onValueChange={(value) => {
                          setRowsPerPage(Number(value) || 0);
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[72px]" aria-label="Rows per page">
                          <SelectValue placeholder={`${rowsPerPage}`} />
                        </SelectTrigger>
                        <SelectContent side="top">
                          {ROWS_PER_PAGE_OPTIONS_DEFAULT.map((n) => (
                            <SelectItem key={n} value={`${n}`}>
                              {n}
                            </SelectItem>
                          ))}
                          <SelectItem value="0">All</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage((x) => Math.min(paymentPagination.totalPages, x + 1))}
                        disabled={paymentPagination.safePage >= paymentPagination.totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(paymentPagination.totalPages)}
                        disabled={paymentPagination.safePage >= paymentPagination.totalPages}
                        aria-label="Last page"
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
