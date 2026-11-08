"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { UnassignedCameraCapture } from "@/components/gallery/UnassignedCameraCapture";
import { savePhotoToUnassigned } from "@/lib/savePhotoToUnassigned";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import { useReportList } from "@/contexts/ReportListContext";
import { useDashboard } from "@/hooks/useDashboard";

function isCompanySelectOrCreatePath(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/company" || p === "/company/create";
}

export function MobileFloatingButton() {
  const pathname = usePathname();
  const searchParams = useLocationSearchParams();
  const isMobile = useIsMobile();
  const { visibleCard } = useDashboard();
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  /** Dashboard scan: photo goes straight to Unassigned Documents, without leaving the page. */
  const handleScanPhoto = useCallback(
    async (file: File) => {
      if (!companyId || !user?.uid) {
        toast.error("Cannot save photo", { description: "Select a company and sign in first." });
        throw new Error("missing_company_or_user");
      }
      const res = await savePhotoToUnassigned({
        companyId,
        companyName: company?.name,
        uploadedBy: user.uid,
        file,
        company,
      });
      if (res.ok === false) {
        toast.error("Photo could not be saved", { description: res.error });
        throw new Error(res.error);
      }
    },
    [companyId, user?.uid, company]
  );
  /** Recent tab: fixed violet strip (Change date / Unapproved) + footer — `bottom-20` par FAB Unapproved par chadh jata tha. */
  const isDashboardPath = (pathname?.replace(/\/+$/, "") || "") === "/dashboard";
  const liftFabAboveRecentStrip =
    isMobile && isDashboardPath && visibleCard === "recent-transactions";
  const normalizedPathname = pathname?.replace(/\/+$/, "") || "/";
  const isSelectedReportPage =
    normalizedPathname.startsWith("/reports/") ||
    (normalizedPathname === "/reports" && Boolean(searchParams.get("report")));
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollY = useRef(0);
  const mainElementRef = useRef<HTMLElement | null>(null);
  const attachedRef = useRef<Set<HTMLElement | Window>>(new Set());

  useEffect(() => {
    if (!isMobile) return;

    // Find the scroll container: report page transaction list, or main with overflow-y-auto, or window
    const findScrollContainers = (): HTMLElement[] => {
      const list: HTMLElement[] = [];
      const reportScroll = document.querySelector('[data-floating-button-scroll]') as HTMLElement;
      if (reportScroll) list.push(reportScroll);
      const main = document.querySelector('main[class*="overflow-y-auto"]') as HTMLElement;
      if (main && !list.includes(main)) list.push(main);
      return list;
    };

    const reportScrollEl = () => document.querySelector('[data-floating-button-scroll]') as HTMLElement | null;
    const isScrollable = (el: HTMLElement | null) => el && el.scrollHeight > el.clientHeight;

    // On report page when transaction list has no scroll (few items), always show FAB
    const updateReportNoScrollVisibility = () => {
      const report = reportScrollEl();
      if (report && !isScrollable(report)) {
        setShowButton(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    };

    const handleScroll = (scrollTop: number, targetEl?: HTMLElement | null) => {
      const report = reportScrollEl();
      // Party/Group Report: if this container has no scroll, keep button visible
      if (report && targetEl === report && !isScrollable(report)) {
        setShowButton(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        lastScrollY.current = scrollTop;
        return;
      }

      const isScrollingDown = scrollTop > lastScrollY.current;
      const isScrollingUp = scrollTop < lastScrollY.current;
      const moved = scrollTop !== lastScrollY.current;

      // Scroll DOWN shows button; scroll UP hides it
      if (isScrollingDown && moved) {
        setShowButton(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setShowButton(false), 3000);
      } else if (isScrollingUp && moved) {
        setShowButton(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }

      lastScrollY.current = scrollTop;
    };

    const onScroll = (e?: Event) => {
      const target = e?.target as HTMLElement | undefined;
      const scrollTop = target ? target.scrollTop : window.scrollY;
      handleScroll(scrollTop, target);
    };

    const attach = (el: HTMLElement | Window) => {
      if (attachedRef.current.has(el)) return;
      attachedRef.current.add(el);
      if (el === window) window.addEventListener("scroll", onScroll, { passive: true });
      else (el as HTMLElement).addEventListener("scroll", onScroll, { passive: true });
    };
    const detach = (el: HTMLElement | Window) => {
      if (!attachedRef.current.has(el)) return;
      attachedRef.current.delete(el);
      if (el === window) window.removeEventListener("scroll", onScroll);
      else (el as HTMLElement).removeEventListener("scroll", onScroll);
    };

    const containers = findScrollContainers();
    if (containers.length > 0) {
      mainElementRef.current = containers[0];
      containers.forEach((el) => attach(el));
      updateReportNoScrollVisibility();
    } else {
      attach(window);
    }

    const checkInterval = setInterval(() => {
      if (document.hidden) return;
      const next = findScrollContainers();
      next.forEach((el) => attach(el));
      updateReportNoScrollVisibility();
    }, 2000);

    return () => {
      clearInterval(checkInterval);
      Array.from(attachedRef.current).forEach((el) => detach(el));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isMobile]);

  if (!isMobile || isCompanySelectOrCreatePath(pathname)) {
    return null;
  }

  /** Gallery pages have their own camera (Unassigned tab) — the page-level one would duplicate it. */
  const isGalleryPath = normalizedPathname === "/gallery";

  return (
    <>
      {/* Camera scan FAB — dashboard entry point; saves into Unassigned Documents. */}
      {!isGalleryPath && (
      <UnassignedCameraCapture
        onCapture={handleScanPhoto}
        bottomClass={cn(
          liftFabAboveRecentStrip
            ? "bottom-[calc(11.5rem+env(safe-area-inset-bottom,0px))]"
            : isSelectedReportPage
              ? "bottom-[calc(var(--pl-mobile-ledger-action-footer-h,2.875rem)+var(--pl-mobile-txn-footer-row-h,2.625rem)+var(--pl-mobile-txn-toolbar-h,2.625rem)+3.25rem)]"
              : "bottom-[calc(8rem+env(safe-area-inset-bottom,0px))]"
        )}
      />
      )}
      <div
        className={cn(
          "fixed left-1/2 -translate-x-1/2 z-50",
          "transition-[opacity,bottom] duration-300",
          !liftFabAboveRecentStrip && !isSelectedReportPage && "bottom-[calc(5rem+10px)]",
          showButton ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={
          liftFabAboveRecentStrip
            ? {
                // ~footer (38px) + 2-row strip (~74px reserve) + chhota gap — Unapproved / row clear
                bottom: "calc(8.5rem + 10px + env(safe-area-inset-bottom, 0px))",
              }
            : isSelectedReportPage
              ? {
                  // Action footer + pager + txn toolbar + 2px gap — FAB clears the full report footer stack.
                  bottom:
                    "calc(var(--pl-mobile-ledger-action-footer-h, 2.875rem) + var(--pl-mobile-txn-footer-row-h, 2.625rem) + var(--pl-mobile-txn-toolbar-h, 2.625rem) + 2px)",
                }
            : undefined
        }
      >
        <Button
          size="lg"
          className={cn(
            /* h-7 (28px) + 50% height → 42px; width unchanged (px-4) */
            "h-[42px] min-h-[42px] max-h-[42px] px-4 rounded-full shadow-lg",
            "border border-green-400/90 bg-green-100 text-green-900 hover:bg-green-200 hover:text-green-950",
            "flex items-center justify-center gap-1.5",
            "animate-in fade-in zoom-in duration-200"
          )}
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="font-semibold text-xs">Add New</span>
        </Button>
      </div>
      <AddVoucherDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onVoucherCreated={() => {}}
      />
    </>
  );
}

/** Mobile `/reports?report=…`: report list sheet — bank ke alag (header); baaki reports FAB thoda uper (footer/pager clearance) */
export function ReportsMobileReportListFab() {
  const pathname = usePathname();
  const searchParams = useLocationSearchParams();
  const { setReportListOpen } = useReportList();
  const isMobile = useIsMobile();

  const normalized = pathname?.replace(/\/+$/, "") ?? "";
  const isReportListPage = normalized === "/reports";
  const reportId = searchParams.get("report");
  const reportSelected = Boolean(reportId);
  // Bank statement: list toggle ab `DesktopBankStatementPage` header me — yahan duplicate FAB mat dikhao
  if (reportId === "bank-statement") {
    return null;
  }

  if (!isReportListPage || !isMobile || !reportSelected || isCompanySelectOrCreatePath(pathname)) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Open report list"
      aria-label="Open report list"
      onClick={() => setReportListOpen(true)}
      className={cn(
        // User request: gol disk nahi — sirf PanelRight icon; dahin + niche screen edge ke qareeb
        "fixed z-[58] shrink-0 h-auto min-h-10 min-w-10 rounded-none border-0 bg-transparent p-1 shadow-none",
        "hover:bg-muted/35 active:bg-muted/50",
        // Party / staff / … reports: fixed footer + pager se uper — overlap avoid (bank uses header icon)
        "right-1 bottom-[calc(6.75rem+env(safe-area-inset-bottom,0px))]"
      )}
    >
      <PanelRight className="h-5 w-5 text-foreground" />
    </Button>
  );
}
