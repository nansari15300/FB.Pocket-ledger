"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info, Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppUiZoom } from "@/hooks/useAppUiZoom";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_UI_ZOOM_MAX, APP_UI_ZOOM_MIN } from "@/lib/appUiZoom";
import { cn } from "@/lib/utils";

type AdjustScreenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Slider works in whole percent (50..160) — same min/max as `APP_UI_ZOOM_MIN/MAX` in `@/lib/appUiZoom`. */
const SLIDER_MIN_PCT = Math.round(APP_UI_ZOOM_MIN * 100);
const SLIDER_MAX_PCT = Math.round(APP_UI_ZOOM_MAX * 100);

/**
 * Strip colours = exact inverse of the theme (bg-foreground / text-background), classes only.
 * globals.css forces border-color (!important) on every <button> inside [data-pl-dialog-shell] unless it has
 * .border-0, so the buttons use border-0 + an inset ring as their outline instead of a border.
 */
const STRIP_BTN_CN =
  "shrink-0 border-0 ring-1 ring-inset ring-background/40 !bg-background/10 !text-background hover:!bg-background/20 hover:!text-background";
/** Slider on the inverted strip: track / range / thumb use the background colour. */
const STRIP_SLIDER_CN =
  "[&>span:first-child]:bg-background/30 [&>span:first-child>span]:bg-background [&_[role=slider]]:border-background [&_[role=slider]]:bg-background";

const HELP_TEXT = "Drag the slider (swipe on touch screens) or use − / + to zoom the app screen.";

/**
 * Adjust Screen: thin strip (mobile 15mm, PC 20mm) — [−] [slider] [i] [% on PC] [+].
 * Shares `useAppUiZoom` (lib/appUiZoom.ts) with the old sidebar row: same step, limits, persistence, live apply.
 * No dim / blur overlay: the dashboard (#app-container) behind zooms live while dragging.
 * The popup is portaled to <body>, outside #app-container, so it is not scaled by the zoom.
 * Close: Escape or outside click (no visible X).
 */
export function AdjustScreenDialog({ open, onOpenChange }: AdjustScreenDialogProps) {
  const { scale, zoomIn, zoomOut, setZoom, canZoomIn, canZoomOut } = useAppUiZoom();
  const isMobile = useIsMobile();
  const pct = Math.round(scale * 100);
  /** globals.css sets [data-pl-dialog-shell] border-color !important; an inline !important wins over it. */
  const stripRef = React.useCallback((node: HTMLDivElement | null) => {
    if (node) node.style.setProperty("border-color", "hsl(var(--foreground))", "important");
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={stripRef}
        hideCloseButton
        /* No dark layer, no backdrop blur: live zoom must stay visible behind the popup. */
        overlayClassName="bg-transparent backdrop-blur-none"
        /* Focus returning from the closing mobile drawer must not dismiss this popup. */
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(
          /* Thin strip: one centered row; overflow-visible so the mobile % badge can sit above it. */
          "flex items-center gap-2 overflow-visible p-0 px-2 max-w-none !bg-foreground !text-background",
          isMobile
            ? /* Mobile: 15mm tall strip pinned 40mm above the screen bottom (overrides Radix top-50% / -translate-y-1/2),
                 full width with exactly 10px gap left + right (centered by left-50% / -translate-x-1/2). */
              "!top-auto !bottom-[40mm] !translate-y-0 h-[15mm] w-[calc(100vw-20px)]"
            : /* PC: 20mm tall, 6in..8in wide, never wider than the viewport. */
              "h-[20mm] w-[min(8in,calc(100vw-20px))] min-w-[min(6in,calc(100vw-20px))] max-w-[8in] px-3"
        )}
      >
        <DialogTitle className="sr-only">Adjust Screen</DialogTitle>
        <DialogDescription className="sr-only">{HELP_TEXT}</DialogDescription>

        {/* Mobile % pill: portaled to <body> because the dialog content has a transform (would break position:fixed).
            Fixed 30mm from the top, centered, 100px x 50px. */}
        {isMobile && typeof document !== "undefined"
          ? createPortal(
              <span
                className="pointer-events-none fixed left-1/2 top-[30mm] z-[60] flex h-[50px] w-[100px] -translate-x-1/2 items-center justify-center rounded-full border border-foreground bg-foreground text-background text-center text-base font-semibold tabular-nums shadow"
                aria-live="polite"
                data-pl-adjust-screen-pct
              >
                {pct}%
              </span>,
              document.body
            )
          : null}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(STRIP_BTN_CN, isMobile ? "h-8 w-8" : "h-10 w-10")}
          onClick={zoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>

        <Slider
          className={cn("h-8 min-w-0 flex-1 py-0 [&_[role=slider]]:h-6 [&_[role=slider]]:w-6", STRIP_SLIDER_CN)}
          min={SLIDER_MIN_PCT}
          max={SLIDER_MAX_PCT}
          step={1}
          value={[pct]}
          onValueChange={(v) => {
            const next = v[0];
            if (typeof next === "number") setZoom(next / 100);
          }}
          aria-label="Screen zoom"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(STRIP_BTN_CN, isMobile ? "h-8 w-8" : "h-10 w-10")}
              aria-label="About Adjust Screen"
              title="Info"
            >
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-56 p-2 text-xs">
            {HELP_TEXT}
          </PopoverContent>
        </Popover>

        {!isMobile ? (
          <span
            className="w-12 shrink-0 text-center text-sm font-semibold tabular-nums"
            aria-live="polite"
            data-pl-adjust-screen-pct
          >
            {pct}%
          </span>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(STRIP_BTN_CN, isMobile ? "h-8 w-8" : "h-10 w-10")}
          onClick={zoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}