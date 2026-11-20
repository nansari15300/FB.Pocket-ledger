
"use client";

import React, { Suspense, useState, useMemo, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ReportList } from "@/components/reports/ReportList";
import { reports, type Report } from "@/components/reports/report-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { PanelLeft, PanelRight } from "lucide-react";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { useReportsMenuPendingApproval } from "@/components/reports/ReportListParityChrome";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { usePageMemory } from "@/hooks/usePageMemory";
import { useReportList } from "@/contexts/ReportListContext";
import { ReportPageProvider } from "@/contexts/ReportPageContext";
import { PermissionRouteGuard } from "@/components/permission/PermissionRouteGuard";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useCompany } from "@/hooks/useCompany";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEdgeSwipeTrigger } from "@/hooks/useMobileEdgeSwipe";
import { pathnameForModalRouterReplace } from "@/lib/modalUrlSync";
import { appNavHref } from "@/lib/appNavHref";
import { LEDGER_HEADER_RIBBON_WRAP_CN } from "@/lib/ledgerHeaderChrome";
import { useReportPage } from "@/contexts/ReportPageContext";
import { ResizeWidthHandle, useResizablePixelWidth } from "@/components/layout/ResizablePaneWidth";

const ReportDetails = dynamic(
  () => import("@/components/reports/ReportDetails").then((m) => m.ReportDetails),
  {
    ssr: false,
    loading: () => <LoadingSpinner />,
  }
);

/** Path + query same ho to `router.replace` mat chalao — static/Electron par dobara RSC fetch + "200ms refresh" feel. */
function reportListUrlMatchesWindow(targetPathAndQuery: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const next = new URL(targetPathAndQuery, window.location.origin);
    const cur = new URL(window.location.href);
    const norm = (p: string) => (p.replace(/\/+$/, "") || "/").toLowerCase();
    if (norm(next.pathname) !== norm(cur.pathname)) return false;
    const nq = new URLSearchParams(next.search);
    const cq = new URLSearchParams(cur.search);
    if ([...nq.keys()].length !== [...cq.keys()].length) return false;
    for (const k of nq.keys()) {
      if (nq.get(k) !== cq.get(k)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default function ReportsPage() {
  return (
    <PermissionRouteGuard permission="export_data">
      {/* Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility. */}
      <Suspense fallback={<LoadingSpinner />}>
        <ReportsPageContent />
      </Suspense>
    </PermissionRouteGuard>
  );
}

function ReportsPageDetailRibbon() {
  const { detailRibbonContent } = useReportPage();
  if (!detailRibbonContent) return null;
  return <div className="min-w-0 flex-1">{detailRibbonContent}</div>;
}

/** Desktop detail chrome: PC par sirf custom detail ribbon (Anusuchi13, etc.) — collapsed list toggle bar hide. */
function ReportsDesktopDetailTopBar({
  isDesktopReportListOpen,
}: {
  isDesktopReportListOpen: boolean;
  onToggleDesktopReportList: () => void;
}) {
  const { detailRibbonContent } = useReportPage();

  if (!isDesktopReportListOpen || !detailRibbonContent) return null;

  return (
    <div className={cn("flex shrink-0 gap-2", LEDGER_HEADER_RIBBON_WRAP_CN, "items-center py-1")}>
      <ReportsPageDetailRibbon />
    </div>
  );
}

function ReportsPageContent() {
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDesktopReportListOpen, setIsDesktopReportListOpen] = useState(true);
  const isMobile = useIsMobile();
  const [loading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { company } = useCompany();

  const reportsForCompany = useMemo(() => {
    if (company?.country !== undefined) {
      return reports.filter(
        (r) => !r.countryOnly || r.countryOnly === company.country
      );
    }
    return reports.filter((r) => !r.countryOnly);
  }, [company?.country]);

  /** Purana bookmark `?report=accounts-statement` → Bank Statement (list me Account Summary hata diya). */
  const normalizeReportSearchParam = useCallback((id: string | null) => {
    if (!id) return null;
    if (id === "accounts-statement") return "bank-statement";
    return id;
  }, []);

  // Restore selection from URL on load/refresh (so refresh keeps you on the details page)
  const hasRestoredFromUrl = React.useRef(false);
  useEffect(() => {
    if (loading || reportsForCompany.length === 0 || hasRestoredFromUrl.current) return;
    const reportIdFromUrl = normalizeReportSearchParam(searchParams.get("report"));
    if (reportIdFromUrl) {
      const found = reportsForCompany.find((r) => r.id === reportIdFromUrl);
      if (found) {
        hasRestoredFromUrl.current = true;
        // URL pehle se dashboard deep-link se sahi hai — `setSelectedReportWithUrl` = extra `router.replace` + SW churn (EXE refresh).
        setSelectedReport(found);
      }
    }
  }, [loading, reportsForCompany, searchParams, normalizeReportSearchParam]);

  // Sync selection to URL when it changes (enables refresh to persist)
  const setSelectedReportWithUrl = useCallback(
    (report: Report | null) => {
      setSelectedReport(report);
      const params = new URLSearchParams(searchParams.toString());
      if (report) {
        params.set("report", report.id);
      } else {
        params.delete("report");
      }
      const q = params.toString();
      const basePath = pathnameForModalRouterReplace(pathname || "");
      const nextRaw = q ? `${basePath}?${q}` : basePath;
      const nextHref = appNavHref(nextRaw);
      if (typeof window !== "undefined" && reportListUrlMatchesWindow(nextHref)) {
        return;
      }
      router.replace(nextHref, { scroll: false });
    },
    [pathname, searchParams, router]
  );

  // This hook now manages selection memory and auto-selection (disable auto-select on mobile - show list full page first)
  // urlSelectedId: refresh par URL precedence; legacy `accounts-statement` ko bank-statement map (`normalizeReportSearchParam`)
  usePageMemory<Report>(
    "reportsPageState",
    "list",
    () => {},
    selectedReport,
    setSelectedReportWithUrl,
    reportsForCompany,
    loading,
    isMobile,
    normalizeReportSearchParam(searchParams.get("report"))
  );

  const { reportListOpen, setReportListOpen } = useReportList();
  const { widthPx: reportListWidthPx, beginResize: beginReportListResize } = useResizablePixelWidth({
    storageKey: "pl-reports-list-width-px",
    defaultPx: 320,
    minPx: Math.round(256 * 0.7),
    maxPx: Math.round(256 * 1.3),
  });

  const openReportListSheet = useCallback(() => setReportListOpen(true), [setReportListOpen]);
  /** Mobile report detail: daen kinara se swipe left → list Sheet (header icon jaisa) */
  const reportListEdgeSwipe = useEdgeSwipeTrigger(
    Boolean(isMobile && selectedReport),
    "right",
    openReportListSheet
  );

  /** Parties / Bank & Cash list jaisa pink badge: statement reports jinke entities par unapproved vouchers hain. */
  const reportsMenuPending = useReportsMenuPendingApproval();
  const { showOnlyEntities: showOnlyPendingReports, setShowOnlyEntities: setShowOnlyPendingReports } =
    usePendingApprovalListFilter(reportsMenuPending.total);

  const filteredReports = useMemo(() => {
    const base = showOnlyPendingReports
      ? reportsForCompany.filter((r) => (reportsMenuPending.byReportId[r.id] ?? 0) > 0)
      : reportsForCompany;
    if (!searchTerm) return base;
    return base.filter(
      (report) =>
        report.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, reportsForCompany, showOnlyPendingReports, reportsMenuPending]);

  const listView = (
    <div
      className="flex flex-col h-full min-h-0"
      data-pl-master-list-chrome=""
      /* Search box: Parties / Bank & Cash list jaisi height (PC 1.8rem master-detail, mobile dock 35px) */
      style={{ ["--pl-mlc-pill-h" as string]: isMobile ? "35px" : "1.8rem" } as React.CSSProperties}
    >
      <ReportRegisterListSearchRow
        placeholder="Search reports..."
        value={searchTerm}
        onChange={setSearchTerm}
        trailing={
          <PendingApprovalListFilterBadge
            compact
            count={reportsMenuPending.total}
            pressed={showOnlyPendingReports}
            onToggle={() => setShowOnlyPendingReports((v) => !v)}
            tooltipFilterHint={`Only reports with pending approval - ${reportsMenuPending.total} voucher(s) (click)`}
            tooltipShowAllHint="Show all reports (click)"
            ariaLabelFilter={`Filter ${reportsMenuPending.total} pending approval vouchers`}
            ariaLabelShowAll="Show all reports"
            /* Bank & Cash / Parties list badge jaisa roomy box: number squeeze na ho */
            className="min-w-[2.25rem] px-2 text-xs"
          />
        }
      />
      <ReportList 
        pendingByReportId={reportsMenuPending.byReportId}
        searchTerm={searchTerm}
        reports={filteredReports}
        onSelectReport={(r) => {
          setSelectedReportWithUrl(r);
          setReportListOpen(false);
        }}
        selectedReport={selectedReport}
      />
    </div>
  );

  const detailView = (
    selectedReport ? (
      /* key={id}: dubara render par purana search/filter state recycle na ho — SPA me report swap same component-type */
      /* 8px top gap (same as Financial Summary) + 10px gap from the report-list divider line.
       * `flex`-based sizing keeps the inner report at the remaining height instead of overflowing. */
      <div className="flex h-full min-h-0 flex-col pl-[10px] pt-2" data-pl-report-detail-root="">
        <div className="min-h-0 flex-1">
          <ReportDetails key={selectedReport.id} report={selectedReport} />
        </div>
      </div>
    ) : (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a report to view details
      </div>
    )
  );

  // Mobile: list full page when no selection; details full page with report list as right-side Sheet when selected
  if (isMobile) {
    return (
      <>
        {!selectedReport ? (
          // List full page
          <div className="h-full w-full overflow-hidden bg-background flex flex-col">
            <div className="flex-shrink-0 border-b px-2 py-1">
              <h1 className="text-sm font-bold font-headline">Reports</h1>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {listView}
            </div>
          </div>
        ) : (
          // Details full page (no duplicate header - report component has its own header)
          <ReportPageProvider
            onBackToReportList={() => setSelectedReportWithUrl(null)}
            isDesktopReportListOpen
          >
            <div
              className="h-full w-full overflow-hidden bg-background flex flex-col"
              onTouchStart={reportListEdgeSwipe.onTouchStart}
              onTouchEnd={reportListEdgeSwipe.onTouchEnd}
            >
              <div className="flex-1 min-h-0 overflow-hidden">{detailView}</div>
            </div>
          </ReportPageProvider>
        )}
        {/* Report list Sheet - slides from right (like app sidebar) */}
        <Sheet open={reportListOpen} onOpenChange={setReportListOpen}>
          <SheetContent side="right" className="w-72 p-0 sm:max-w-[280px]">
            <SheetHeader className="p-4 pb-2">
              <SheetTitle>Reports</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden">
              <div className="flex-1 min-h-0 overflow-auto">
                <ReportList
                  reports={filteredReports}
                  onSelectReport={(r) => {
                    setSelectedReportWithUrl(r);
                    setReportListOpen(false);
                  }}
                  selectedReport={selectedReport}
                />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <ReportPageProvider
      onBackToReportList={() => setSelectedReportWithUrl(null)}
      isDesktopReportListOpen={isDesktopReportListOpen}
      onShowDesktopReportList={() => setIsDesktopReportListOpen(true)}
    >
      <div
        className="grid h-full overflow-hidden transition-[grid-template-columns] duration-300"
        style={{
          gridTemplateColumns: isDesktopReportListOpen
            ? `${reportListWidthPx}px minmax(0, 1fr)`
            : "64px minmax(0, 1fr)",
        }}
      >
        {/* Desktop report list: expanded = full list, collapsed = main sidebar jaisa 64px icon rail. */}
        {isDesktopReportListOpen ? (
          <div
            className="border-r border-r-[1px] overflow-hidden"
            style={{ width: reportListWidthPx }}
            data-pl-reports-panel-border=""
          >
            <div className="relative flex h-full min-w-0 flex-col">
              <ResizeWidthHandle onPointerDown={beginReportListResize} title="Resize reports list" />
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-b-[1px] px-2 py-1">
                <h1 className="min-w-0 flex-1 text-base font-bold font-headline leading-tight">Reports</h1>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-full border-blue-300/90 bg-blue-100 text-blue-900 shadow-sm hover:bg-blue-200 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50"
                  onClick={() => setIsDesktopReportListOpen(false)}
                  title="Collapse report list"
                  aria-label="Collapse report list"
                  aria-expanded
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{listView}</div>
            </div>
          </div>
        ) : (
          <div
            className="flex h-full min-w-0 flex-col border-r border-r-[1px] bg-sidebar"
            data-pl-reports-rail=""
            data-pl-reports-panel-border=""
          >
            <div className="flex shrink-0 items-center justify-center border-b border-b-[1px] px-1 py-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full border-blue-300/90 bg-blue-100 text-blue-900 shadow-sm hover:bg-blue-200 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50"
                onClick={() => setIsDesktopReportListOpen(true)}
                title="Show report list"
                aria-label="Show report list"
                aria-expanded={false}
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ReportList
                collapsed
                pendingByReportId={reportsMenuPending.byReportId}
                reports={filteredReports}
                onSelectReport={(r) => {
                  setSelectedReportWithUrl(r);
                  setReportListOpen(false);
                }}
                selectedReport={selectedReport}
              />
            </div>
          </div>
        )}
        <div className="min-w-0 flex flex-col overflow-hidden">
          <ReportsDesktopDetailTopBar
            isDesktopReportListOpen={isDesktopReportListOpen}
            onToggleDesktopReportList={() => setIsDesktopReportListOpen((prev) => !prev)}
          />
          <div className="flex-1 min-h-0 overflow-hidden">{detailView}</div>
        </div>
      </div>
    </ReportPageProvider>
  );
}
