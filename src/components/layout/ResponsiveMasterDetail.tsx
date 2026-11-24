
"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "../ui/button";
import { Sheet, SheetContent } from "../ui/sheet";
import { cn } from "@/lib/utils";
import { mdc, mdcNoEdgeSwipeCapture } from "@/lib/mobileDetailChrome";
import { mlc } from "@/lib/mobileListChrome";
import type { MasterDetailListRouteKey } from "@/lib/masterDetailListPath";
import { ResizeWidthHandle, useResizablePercentWidth } from "@/components/layout/ResizablePaneWidth";
import {
  useEdgeSwipeDocumentCapture,
  type EdgeSwipeDocumentOptions,
} from "@/hooks/useMobileEdgeSwipe";

/** Mobile detail: daen kinara ~10mm — swipe left → list sheet (Settings jaisa) */
const MOBILE_DETAIL_LIST_SHEET_EDGE: EdgeSwipeDocumentOptions = { edgeWidthMm: 10 };

export function ResponsiveMasterDetail({
  title,
  balance,
  tabs,
  listView,
  detailView,
  onCreate,
  isMobile,
  mobileListOnly,
  hasSelectedItem,
  onBackToList,
  mobileSelectionLabel,
  mobileSelectionLabelClassName,
  mobileDetailHeaderEnd,
  /** Mobile: 2nd line (e.g. Last 10 Txns) — title row ke saath; avatar square stretch (party txn). */
  mobileDetailHeaderSecondary,
  listChromeRouteKey,
  mobileTabsDocked,
  /** Optional override for list tabs wrapper row (report statement stacked bands). */
  tabsRowClassName,
  /** Changes when user picks list row — closes mobile list sheet */
  mobileListSelectionKey,
  /** Desktop list header: leading slot (e.g. reports hub show-list icon). */
  listHeaderLeading,
}: {
  title: string | React.ReactNode;
  balance: string | React.ReactNode;
  tabs?: React.ReactNode;
  listView: React.ReactNode;
  detailView: React.ReactNode;
  onCreate?: () => void;
  isMobile?: boolean;
  mobileListOnly?: boolean;
  hasSelectedItem?: boolean;
  onBackToList?: () => void;
  mobileSelectionLabel?: React.ReactNode;
  mobileSelectionLabelClassName?: string;
  mobileDetailHeaderEnd?: React.ReactNode;
  mobileDetailHeaderSecondary?: React.ReactNode;
  listChromeRouteKey?: MasterDetailListRouteKey;
  mobileTabsDocked?: boolean;
  tabsRowClassName?: string;
  mobileListSelectionKey?: string | null;
  listHeaderLeading?: React.ReactNode;
}) {
  const listChromeRouteData = listChromeRouteKey
    ? ({ "data-pl-master-list-route": listChromeRouteKey } as const)
    : {};
  const dockTabsOnMobile = mobileTabsDocked ?? Boolean(isMobile && mobileListOnly);
  const isNegative = typeof balance === "string" && balance.includes("Cr");
  const desktopGridRef = React.useRef<HTMLDivElement | null>(null);
  const { widthPercent: desktopListWidthPercent, beginResize: beginDesktopListResize } = useResizablePercentWidth({
    storageKey: "pl-master-list-width-percent",
    defaultPercent: 25,
    minPercent: 17.5,
    maxPercent: 32.5,
    containerRef: desktopGridRef,
  });

  const [mobileListSheetOpen, setMobileListSheetOpen] = useState(false);
  const [desktopListCollapsed, setDesktopListCollapsed] = useState(false);
  const [listPreview, setListPreview] = useState<{
    target: HTMLElement;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const listPreviewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageExpanded, setPageExpanded] = useState(false);
  const openMobileListSheet = useCallback(() => setMobileListSheetOpen(true), []);
  const closeMobileListSheet = useCallback(() => setMobileListSheetOpen(false), []);
  const prevSelectionKeyRef = useRef<string | null | undefined>(undefined);

  const showMobileDetailWithSheet =
    Boolean(isMobile && mobileListOnly && hasSelectedItem);

  useEffect(() => {
    const main = desktopGridRef.current?.closest("main");
    if (!main) return;
    const syncExpandedState = () => setPageExpanded(main.hasAttribute("data-page-expanded"));
    syncExpandedState();
    const observer = new MutationObserver(syncExpandedState);
    observer.observe(main, { attributes: true, attributeFilter: ["data-page-expanded"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (listPreviewCloseTimerRef.current) clearTimeout(listPreviewCloseTimerRef.current);
  }, []);

  useEffect(() => {
    setDesktopListCollapsed(pageExpanded);
    setListPreview(null);
  }, [pageExpanded]);

  const openListPreview = useCallback(() => {
    if (!desktopListCollapsed) return;
    const grid = desktopGridRef.current;
    const target = grid?.closest<HTMLElement>("main");
    const rect = grid?.getBoundingClientRect();
    if (!grid || !target || !rect) return;
    if (listPreviewCloseTimerRef.current) clearTimeout(listPreviewCloseTimerRef.current);
    listPreviewCloseTimerRef.current = null;
    setListPreview({
      target,
      left: rect.left,
      top: rect.top,
      width: Math.max(240, rect.width * desktopListWidthPercent / 100),
      height: rect.height,
    });
  }, [desktopListCollapsed, desktopListWidthPercent]);

  const scheduleListPreviewClose = useCallback(() => {
    if (listPreviewCloseTimerRef.current) clearTimeout(listPreviewCloseTimerRef.current);
    listPreviewCloseTimerRef.current = setTimeout(() => setListPreview(null), 180);
  }, []);

  const keepListPreviewOpen = useCallback(() => {
    if (listPreviewCloseTimerRef.current) clearTimeout(listPreviewCloseTimerRef.current);
    listPreviewCloseTimerRef.current = null;
  }, []);

  useEffect(() => {
    const onPreviewOpen = () => openListPreview();
    const onPreviewClose = () => scheduleListPreviewClose();
    const onToggleCollapsed = () => {
      setDesktopListCollapsed((collapsed) => !collapsed);
      setListPreview(null);
    };
    window.addEventListener("pl:master-list:hover-preview-open", onPreviewOpen);
    window.addEventListener("pl:master-list:hover-preview-close", onPreviewClose);
    window.addEventListener("pl:master-list:toggle-collapsed", onToggleCollapsed);
    return () => {
      window.removeEventListener("pl:master-list:hover-preview-open", onPreviewOpen);
      window.removeEventListener("pl:master-list:hover-preview-close", onPreviewClose);
      window.removeEventListener("pl:master-list:toggle-collapsed", onToggleCollapsed);
    };
  }, [openListPreview, scheduleListPreviewClose]);

  useEffect(() => {
    if (!listPreview) return;
    const onPointerDown = (event: PointerEvent) => {
      const raw = event.target;
      const node =
        raw instanceof Element
          ? raw
          : raw instanceof Node
            ? raw.parentElement
            : null;
      if (!node) return;
      if (node.closest("[data-pl-master-list-hover-preview]")) return;
      if (node.closest("[data-pl-ledger-header-list-toggle]")) return;
      if (node.closest("[data-pl-ledger-header-fullscreen]")) return;
      setListPreview(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [listPreview]);

  useEdgeSwipeDocumentCapture(
    showMobileDetailWithSheet && !mobileListSheetOpen,
    "right",
    openMobileListSheet,
    MOBILE_DETAIL_LIST_SHEET_EDGE
  );

  useEffect(() => {
    if (!mobileListSheetOpen) {
      prevSelectionKeyRef.current = mobileListSelectionKey;
      return;
    }
    const prev = prevSelectionKeyRef.current;
    if (
      prev !== undefined &&
      mobileListSelectionKey != null &&
      mobileListSelectionKey !== prev
    ) {
      setMobileListSheetOpen(false);
    }
    prevSelectionKeyRef.current = mobileListSelectionKey;
  }, [mobileListSelectionKey, mobileListSheetOpen]);

  const sheetSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onSheetTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      sheetSwipeStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    sheetSwipeStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);
  const onSheetTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!sheetSwipeStartRef.current || e.changedTouches.length !== 1) {
        sheetSwipeStartRef.current = null;
        return;
      }
      const t = e.changedTouches[0];
      const dx = t.clientX - sheetSwipeStartRef.current.x;
      const dy = Math.abs(t.clientY - sheetSwipeStartRef.current.y);
      sheetSwipeStartRef.current = null;
      if (dy > Math.abs(dx) * 0.65) return;
      if (dx >= 44) closeMobileListSheet();
    },
    [closeMobileListSheet]
  );

  const mobileListSheet = showMobileDetailWithSheet ? (
    <Sheet open={mobileListSheetOpen} onOpenChange={setMobileListSheetOpen}>
      <SheetContent
        side="right"
        className={cn(
          "flex h-full max-h-[100dvh] min-h-0 w-[80vw] max-w-[80vw] min-w-0 flex-col gap-0 overflow-hidden p-0",
          "[&>button]:hidden"
        )}
        onTouchStart={onSheetTouchStart}
        onTouchEnd={onSheetTouchEnd}
        data-pl-master-detail-list-sheet=""
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          data-pl-master-list-chrome=""
          {...listChromeRouteData}
        >
          {tabs ? <div className={cn(mlc.tabsRow, "flex-shrink-0")}>{tabs}</div> : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listView}</div>
        </div>
      </SheetContent>
    </Sheet>
  ) : null;

  if (isMobile) {
    if (mobileListOnly && hasSelectedItem) {
      return (
        <>
          <div className="h-full w-full overflow-hidden bg-background flex flex-col">
            {mobileDetailHeaderSecondary != null ? (
              <div
                className={cn(mdc.masterBackRow, "items-stretch gap-2 py-1")}
                {...mdcNoEdgeSwipeCapture}
                data-pl-mobile-back-row=""
                data-pl-mobile-detail-merged-header=""
              >
                {pageExpanded ? <Button
                  variant="ghost"
                  size="icon"
                  className={cn(mdc.backBtn, "self-center shrink-0")}
                  onClick={onBackToList}
                  aria-label="Back to list"
                >
                  <ArrowLeft className={mdc.backIcon} />
                </Button> : null}
                <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
                  <div className="flex min-w-0 items-center gap-1 pb-[3px]">
                    <h1 className={mdc.masterTitle}>{title}</h1>
                    {mobileSelectionLabel ? (
                      <>
                        <span className="text-muted-foreground/55 shrink-0 select-none" aria-hidden>
                          ·
                        </span>
                        {typeof mobileSelectionLabel === "string" ? (
                          <span
                            className={cn(
                              mdc.masterSelectionName,
                              "whitespace-normal line-clamp-2 leading-tight",
                              mobileSelectionLabelClassName ?? "text-muted-foreground"
                            )}
                            title={mobileSelectionLabel}
                          >
                            {mobileSelectionLabel}
                          </span>
                        ) : (
                          mobileSelectionLabel
                        )}
                      </>
                    ) : null}
                  </div>
                  <div className="min-w-0 border-t border-border pt-[3px]">{mobileDetailHeaderSecondary}</div>
                </div>
                {mobileDetailHeaderEnd ? (
                  <div
                    className="flex shrink-0 items-center pl-0.5"
                    data-pl-mobile-detail-header-avatar-slot=""
                  >
                    <div className={cn(mdc.mobileHeaderAvatarBox, "overflow-visible")}>
                      {typeof mobileDetailHeaderEnd === "string" || typeof mobileDetailHeaderEnd === "number" ? (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          {mobileDetailHeaderEnd}
                        </div>
                      ) : (
                        mobileDetailHeaderEnd
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className={mdc.masterBackRow}
                {...mdcNoEdgeSwipeCapture}
                data-pl-mobile-back-row=""
                data-pl-mobile-entity-detail-header=""
              >
                <Button variant="ghost" size="icon" className={mdc.backBtn} onClick={onBackToList} aria-label="Back to list">
                  <ArrowLeft className={mdc.backIcon} />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <h1 className={mdc.masterTitle}>{title}</h1>
                  {mobileSelectionLabel ? (
                    <>
                      <span className="text-muted-foreground/55 shrink-0 select-none" aria-hidden>
                        ·
                      </span>
                      {typeof mobileSelectionLabel === "string" ? (
                        <span
                          className={cn(
                            mdc.masterSelectionName,
                            mobileSelectionLabelClassName ?? "text-muted-foreground"
                          )}
                          title={mobileSelectionLabel}
                        >
                          {mobileSelectionLabel}
                        </span>
                      ) : (
                        mobileSelectionLabel
                      )}
                    </>
                  ) : null}
                </div>
                {mobileDetailHeaderEnd ? (
                  <div className="flex-shrink-0">
                    {typeof mobileDetailHeaderEnd === "string" || typeof mobileDetailHeaderEnd === "number" ? (
                      <div className="text-xs text-muted-foreground whitespace-nowrap max-w-[45%] truncate text-right">
                        {mobileDetailHeaderEnd}
                      </div>
                    ) : (
                      mobileDetailHeaderEnd
                    )}
                  </div>
                ) : null}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{detailView}</div>
          </div>
          {mobileListSheet}
        </>
      );
    }
    if (mobileListOnly) {
      return (
        <div className="h-full w-full overflow-hidden bg-background flex flex-col">
          <div className="flex flex-col flex-1 min-h-0" data-pl-master-list-chrome="" {...listChromeRouteData}>
            <div className={mlc.pageHeader}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <h1 className={mlc.pageTitle}>{title}</h1>
                <span className={cn(mlc.pageBalance, isNegative ? "text-red-600" : "text-green-600")}>{balance}</span>
              </div>
            </div>
            {tabs && !dockTabsOnMobile && <div className={mlc.tabsRow}>{tabs}</div>}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listView}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full w-full overflow-hidden bg-background flex flex-col">
        <div
          className="flex flex-col min-h-0 border-b flex-shrink-0"
          data-pl-master-list-chrome=""
          {...listChromeRouteData}
          style={{ maxHeight: "45%" }}
        >
          <div className={mlc.pageHeader}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h1 className={mlc.pageTitle}>{title}</h1>
              <span className={cn(mlc.pageBalance, isNegative ? "text-red-600" : "text-green-600")}>{balance}</span>
            </div>
          </div>
          {tabs && <div className={mlc.tabsRow}>{tabs}</div>}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listView}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{detailView}</div>
      </div>
    );
  }

  return (
    <div
      ref={desktopGridRef}
      className="grid h-full min-h-0 grid-cols-1 overflow-hidden md:grid-cols-none"
      style={{
        gridTemplateColumns: desktopListCollapsed
          ? "4rem minmax(0, 1fr)"
          : `minmax(0, ${desktopListWidthPercent}%) minmax(0, 1fr)`,
      }}
      data-master-detail-layout="25-75"
    >
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r",
        )}
        data-pl-master-list-chrome=""
        data-pl-master-list-icon-rail={desktopListCollapsed ? "" : undefined}
        {...listChromeRouteData}
      >
        {desktopListCollapsed ? (
          <div className="flex shrink-0 justify-center px-1 pt-2 pb-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              data-pl-ledger-header-list-toggle=""
              className="h-7 w-7 shrink-0 p-0"
              onMouseEnter={openListPreview}
              onMouseLeave={scheduleListPreviewClose}
              onFocus={openListPreview}
              onBlur={scheduleListPreviewClose}
              onClick={() => {
                setDesktopListCollapsed(false);
                setListPreview(null);
              }}
              aria-label="Show list"
              title="Show account list"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className={cn(mlc.pageHeader, "flex justify-between items-center gap-2 min-w-0")}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {listHeaderLeading}
              <h1 className={cn(mlc.pageTitle, "truncate")}>{title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {balance != null && balance !== "" ? (
                <span className={cn(mlc.pageBalance, "whitespace-nowrap", isNegative ? "text-red-600" : "text-green-600")}>
                  {balance}
                </span>
              ) : null}
              {pageExpanded ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0 p-0"
                  onClick={() => setDesktopListCollapsed(true)}
                  aria-label="Hide list"
                  title="Hide list"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        )}
        {!desktopListCollapsed && tabs ? <div className={cn(mlc.tabsRow, tabsRowClassName)}>{tabs}</div> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {desktopListCollapsed && listPreview ? null : listView}
        </div>
        {!desktopListCollapsed ? <ResizeWidthHandle onPointerDown={beginDesktopListResize} title="Resize list panel" /> : null}
      </div>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-pl-detail-pane=""
      >{detailView}</div>
      {desktopListCollapsed && listPreview
        ? createPortal(
            <div
              data-pl-master-list-hover-preview=""
              data-pl-master-list-chrome=""
              {...listChromeRouteData}
              className="fixed z-[500] flex min-h-0 flex-col overflow-hidden border border-blue-300 bg-background shadow-xl"
              style={{
                position: "fixed",
                left: listPreview.left,
                top: listPreview.top,
                width: listPreview.width,
                height: listPreview.height,
              }}
              onMouseEnter={keepListPreviewOpen}
              onMouseLeave={scheduleListPreviewClose}
            >
              <div className={cn(mlc.pageHeader, "flex justify-between items-center gap-2 min-w-0 shrink-0")}>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {listHeaderLeading}
                  <h1 className={cn(mlc.pageTitle, "truncate")}>{title}</h1>
                </div>
                {balance != null && balance !== "" ? (
                  <span className={cn(mlc.pageBalance, "whitespace-nowrap", isNegative ? "text-red-600" : "text-green-600")}>
                    {balance}
                  </span>
                ) : null}
              </div>
              {tabs ? <div className={cn(mlc.tabsRow, tabsRowClassName, "shrink-0")}>{tabs}</div> : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{listView}</div>
            </div>,
            listPreview.target
          )
        : null}
    </div>
  );
}
