"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";

export type EntityListQuickFilter =
  | "latest"
  | "amount"
  | "amount_asc"
  | "default"
  | "dr"
  | "cr"
  | "name"
  | "date"
  | "settled"
  | "non_settled";

/** Master account lists open on newest-first. */
export const DEFAULT_ENTITY_LIST_QUICK_FILTER: EntityListQuickFilter = "latest";

type Props = {
  active: EntityListQuickFilter;
  onChange: (next: EntityListQuickFilter) => void;
  className?: string;
  /** Subset of footer toggles (e.g. notes list: default / By Name / By Date only). */
  only?: EntityListQuickFilter[];
  hideSettled?: boolean;
  onHideSettledChange?: (next: boolean) => void;
};

const FILTERS: Array<{ key: EntityListQuickFilter; label: string }> = [
  { key: "latest", label: "Latest" },
  { key: "amount", label: "By Amount" },
  { key: "dr", label: "Dr" },
  { key: "cr", label: "Cr" },
  { key: "name", label: "By Name" },
  { key: "date", label: "By Date" },
  { key: "settled", label: "Settled" },
  { key: "non_settled", label: "Non Settled" },
];

/** Notes report etc. — Default sirf tab jab `only` me explicitly maanga ho. Account lists par nahi. */
const OPTIONAL_FILTERS: Array<{ key: EntityListQuickFilter; label: string }> = [
  { key: "default", label: "Default" },
];

function isAmountFilter(key: EntityListQuickFilter): boolean {
  return key === "amount" || key === "amount_asc";
}

/** Account/entity list footer filters — horizontal scroll for mobile + desktop compact bar. */
export function EntityListQuickFilterBar({
  active,
  onChange,
  className,
  only,
  hideSettled: hideSettledProp,
  onHideSettledChange,
}: Props) {
  const catalog = [...FILTERS, ...OPTIONAL_FILTERS];
  const filters = only?.length ? catalog.filter((f) => only.includes(f.key)) : FILTERS;
  const hideSettledCtx = useEntityListHideSettled();
  const hideSettled = hideSettledProp ?? hideSettledCtx.hideSettled;
  const setHideSettled = onHideSettledChange ?? hideSettledCtx.setHideSettled;
  const showSettledSort = filters.some((f) => f.key === "settled");
  const showHideSettledToggle = showSettledSort && active !== "settled";
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef({
    tracking: false,
    moved: false,
    pointerId: -1,
    x: 0,
    scroll: 0,
  });
  const [dragging, setDragging] = React.useState(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = {
      tracking: true,
      moved: false,
      pointerId: event.pointerId,
      x: event.clientX,
      scroll: el.scrollLeft,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag.tracking || !el) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      if (el.hasPointerCapture?.(drag.pointerId) !== true) {
        try {
          el.setPointerCapture(drag.pointerId);
        } catch {
          /* pointer already released */
        }
      }
    }
    el.scrollLeft = drag.scroll - dx;
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (el && drag.moved) {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    drag.tracking = false;
    setDragging(false);
  };
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current.moved = false;
  };

  return (
    <div
      className={cn(
        "pl-mlc-quick-filter-row w-full min-w-0 border-t border-blue-300/60 bg-blue-100/80 px-2 py-[2px]",
        className,
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          "w-full min-w-0 overflow-x-auto pl-ledger-footer-scroll",
          dragging ? "cursor-grabbing select-none [&_button]:cursor-grabbing" : "[&_button]:cursor-grab"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        <div className="pl-mlc-quick-filter-inner flex min-w-full w-full items-center gap-[2px]">
          {filters.map((f) => {
            if (f.key === "settled" && hideSettled) return null;
            const amountActive = f.key === "amount" && isAmountFilter(active);
            const selected = f.key === "amount" ? amountActive : active === f.key;
            const label =
              f.key === "amount" && active === "amount_asc"
                ? "By Amount ↑"
                : f.key === "amount" && active === "amount"
                  ? "By Amount ↓"
                  : f.label;
            return (
              <React.Fragment key={f.key}>
                <Button
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  className="pl-mlc-quick-filter-pill h-7 min-w-0 px-2 text-[11px] whitespace-nowrap"
                  onClick={() => {
                    if (f.key === "amount") {
                      onChange(active === "amount" ? "amount_asc" : "amount");
                      return;
                    }
                    onChange(f.key);
                  }}
                >
                  {label}
                </Button>
                {selected && showHideSettledToggle ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={hideSettled ? "default" : "outline"}
                    className="pl-mlc-quick-filter-pill h-7 min-w-0 px-2 text-[11px] whitespace-nowrap"
                    onClick={() => setHideSettled(!hideSettled)}
                  >
                    {hideSettled ? "Show Settled" : "Hide Settled"}
                  </Button>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
