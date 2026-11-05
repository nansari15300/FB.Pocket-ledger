"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ADJUST_BALANCE_PILL_CN,
  LEDGER_CLOSING_BALANCE_ADJUST_PILL_CN,
} from "@/lib/ledgerHeaderChrome";
import { publicAssetUrl } from "@/lib/webAppBasePath";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { useAdaptiveClosingCtx } from "@/components/vouchers/AdaptiveClosingScope";

/** Widest -> narrowest. The longest variant that fits is used (word by word fallback). */
const ADAPTIVE_VARIANTS = [
  "Adjust Closing Balance",
  "Adjust Closing Blc",
  "Adjust Cls Blc",
  "Ajt Cls Blc",
] as const;
const LAST_LEVEL = ADAPTIVE_VARIANTS.length - 1;

const ACTIONS_SEL = "[data-pl-closing-balance-row-actions],[data-pl-closing-balance-actions]";

const num = (v: string) => Number.parseFloat(v) || 0;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Text width with the same font as `el` (canvas measureText; no layout dependence). */
function textWidth(el: HTMLElement, text: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = cs.letterSpacing === "normal" ? 0 : num(cs.letterSpacing);
  return measureCtx.measureText(text).width + ls * text.length;
}

/** Inner width of `el` (without its padding). */
function innerWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().width - num(cs.paddingLeft) - num(cs.paddingRight) - num(cs.borderLeftWidth) - num(cs.borderRightWidth);
}

/**
 * Width available to the actions box when it is NOT sharing a line with the amount
 * (desktop footer / loan / amount already on its own line): card width minus the other items on its row.
 */
function availableForBox(box: HTMLElement): number {
  const card = box.closest("[data-pl-closing-balance-card]") as HTMLElement | null;
  if (!card) return Number.POSITIVE_INFINITY;
  let avail = innerWidth(card);
  let cur: HTMLElement = box;
  while (cur !== card && cur.parentElement) {
    const cs = getComputedStyle(cur);
    avail -= num(cs.marginLeft) + num(cs.marginRight);
    const parent = cur.parentElement;
    if (parent !== card) avail -= num(getComputedStyle(parent).paddingLeft) + num(getComputedStyle(parent).paddingRight);
    const pcs = getComputedStyle(parent);
    if (pcs.display.includes("flex") && !pcs.flexDirection.startsWith("column")) {
      const gap = num(pcs.columnGap);
      for (const sib of Array.from(parent.children)) {
        if (sib === cur) continue;
        const w = (sib as HTMLElement).getBoundingClientRect().width;
        if (w > 0) avail -= w + gap;
      }
    }
    cur = parent;
  }
  return avail;
}

/** Pick the longest variant that fits. Independent of whether the amount is currently wrapped. */
function pickLevel(el: HTMLElement, pre: string): { level: number; sameLine: boolean } {
  const box = el.closest(ACTIONS_SEL) as HTMLElement | null;
  if (!box) return { level: 0, sameLine: true };
  let child = Array.from(box.children).find((c) => c.contains(el)) as HTMLElement | undefined;
  if (child && child.getBoundingClientRect().width === 0) child = (el.closest("button") as HTMLElement | null) ?? child;
  if (!child) return { level: 0, sameLine: true };
  const boxCs = getComputedStyle(box);
  const boxGap = num(boxCs.columnGap);
  const kids = (Array.from(box.children) as HTMLElement[]).filter((c) => c.getBoundingClientRect().width > 0);
  const curText = el.getBoundingClientRect().width;
  const childW = child.getBoundingClientRect().width;
  const childMin = num(getComputedStyle(child).minWidth);
  const others = kids.filter((k) => k !== child).reduce((n, k) => n + k.getBoundingClientRect().width, 0);
  const SAFETY = 2;
  const boxWidthFor = (i: number) => {
    const w = i === 0 ? curText : textWidth(el, pre + ADAPTIVE_VARIANTS[i]);
    const cw = Math.max(childMin, childW - curText + w);
    return others + cw + Math.max(0, kids.length + (kids.includes(child) ? 0 : 1) - 1) * boxGap + SAFETY;
  };

  const row = box.parentElement as HTMLElement | null;
  const amount = row?.querySelector("[data-pl-closing-amount]") as HTMLElement | null;
  if (row && amount) {
    const rowW = innerWidth(row);
    const need = num(getComputedStyle(row).columnGap) + amount.getBoundingClientRect().width;
    for (let i = 0; i <= LAST_LEVEL; i++) if (boxWidthFor(i) + need <= rowW) return { level: i, sameLine: true };
    // Even the shortest + amount does not fit: amount drops; pill grows within the full row width.
    for (let i = 0; i <= LAST_LEVEL; i++) if (boxWidthFor(i) <= rowW) return { level: i, sameLine: false };
    return { level: LAST_LEVEL, sameLine: false };
  }
  const avail = availableForBox(box);
  for (let i = 0; i <= LAST_LEVEL; i++) if (boxWidthFor(i) <= avail) return { level: i, sameLine: true };
  return { level: LAST_LEVEL, sameLine: true };
}

/** Real-DOM guard: actions wrapped inside the box, or the amount dropped although we expected one line. */
function layoutWrapped(el: HTMLElement, expectSameLine: boolean): boolean {
  const box = el.closest(ACTIONS_SEL) as HTMLElement | null;
  if (!box) return false;
  let prev: DOMRect | null = null;
  for (const child of Array.from(box.children)) {
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (prev && r.top >= prev.bottom - 1) return true;
    prev = r;
  }
  if (expectSameLine) {
    const amount = box.parentElement?.querySelector("[data-pl-closing-amount]") as HTMLElement | null;
    if (amount) {
      const a = amount.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (a.height > 0 && a.top >= b.bottom - 1) return true;
    }
  }
  return false;
}

/** True when the amount sits on its own line below the actions box (real layout). */
function amountDropped(el: HTMLElement): boolean {
  const box = el.closest(ACTIONS_SEL) as HTMLElement | null;
  const amount = box?.parentElement?.querySelector("[data-pl-closing-amount]") as HTMLElement | null;
  if (!box || !amount) return false;
  const a = amount.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return a.height > 0 && a.top >= b.bottom - 1;
}

/**
 * Adaptive pill text (only inside AdaptiveClosingScope): the longest of "Adjust Closing Balance" /
 * "Adjust Closing Blc" / "Adjust Cls Blc" / "Ajt Cls Blc" that fits. Available width is computed
 * (row width - Share pill - gaps [- amount]) from measured text widths, not from the current wrap state:
 * 1) longest variant that fits on one line with the amount; 2) else the amount drops to its own line
 * (nowrap, never split) and the pill grows progressively within the full row width.
 */
function AdaptiveAdjustText({ prefix, onDropped }: { prefix: string; onDropped: (dropped: boolean) => void }) {
  const i18n = usePlI18nOptional();
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [level, setLevel] = React.useState(0);
  const [probe, setProbe] = React.useState(0);
  const sigRef = React.useRef("");
  const expectSame = React.useRef(true);
  const pre = prefix ? `${prefix} ` : "";
  const resetKey = `${pre}|${i18n?.ui ?? ""}`;

  React.useEffect(() => {
    setLevel(0);
    setProbe((p) => p + 1);
    const t = window.setTimeout(() => {
      setLevel(0);
      setProbe((p) => p + 1);
    }, 400);
    return () => window.clearTimeout(t);
  }, [resetKey]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (level === 0) {
      const r = pickLevel(el, pre);
      expectSame.current = r.sameLine;
      if (r.level !== 0) setLevel(r.level);
      else if (layoutWrapped(el, r.sameLine)) setLevel(1);
      else onDropped(amountDropped(el));
      return;
    }
    if (level < LAST_LEVEL && layoutWrapped(el, expectSame.current)) setLevel(level + 1);
    else onDropped(amountDropped(el));
  }, [level, probe, pre, onDropped]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const box = el.closest(ACTIONS_SEL) as HTMLElement | null;
    if (!box) return;
    const watched: HTMLElement[] = [];
    const card = box.closest("[data-pl-closing-balance-card]") as HTMLElement | null;
    if (card) watched.push(card);
    if (box.parentElement) watched.push(box.parentElement);
    const amount = box.parentElement?.querySelector("[data-pl-closing-amount]") as HTMLElement | null;
    if (amount) watched.push(amount);
    Array.from(box.children).forEach((c) => watched.push(c as HTMLElement));
    const signature = () => watched.map((n) => Math.round(n.getBoundingClientRect().width)).join(",");
    sigRef.current = "";
    const ro = new ResizeObserver(() => {
      const next = signature();
      if (next === sigRef.current) return;
      const first = sigRef.current === "";
      sigRef.current = next;
      if (first) return;
      setLevel(0);
      setProbe((p) => p + 1);
    });
    watched.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, []);

  return (
    <span
      key={level}
      ref={ref}
      className="whitespace-nowrap"
      {...(level > 0 ? { "data-pl-no-translate": "" } : {})}
    >
      {pre}
      {ADAPTIVE_VARIANTS[level]}
    </span>
  );
}
/** Adjust Balance pill - pointing-hand pic (Closing Balance ki taraf). Default (outside adaptive scope) mobile label: "Ajt Blc". */
export function AdjustBalancePillLabel() {
  const isMobile = useIsMobile();
  const adaptive = useAdaptiveClosingCtx();
  /** Amount wrapped to the next line: the hand icon is rotated to point down at it (still inside the pill). */
  const [amountDown, setAmountDown] = React.useState(false);
  return (
    <>
      {adaptive ? (
        <AdaptiveAdjustText prefix={adaptive.prefix} onDropped={setAmountDown} />
      ) : isMobile ? (
        <span className="whitespace-nowrap" data-pl-no-translate="">
          Ajt Blc
        </span>
      ) : (
        "Adjust Balance"
      )}
      <img
        src={publicAssetUrl("/adjust-balance-point.png")}
        alt=""
        width={18}
        height={18}
        className={cn(
          "ml-1 inline-block h-[18px] w-[18px] shrink-0 object-contain align-middle",
          adaptive && amountDown && "rotate-90"
        )}
        aria-hidden
        draggable={false}
      />
    </>
  );
}

/** Ledger closing footer - min width of the `MasterAccountFreezeOwnerToggle` pill; grows for longer adaptive text. */
export function AdjustBalanceLedgerPillButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      data-pl-adjust-balance-closing-pill=""
      className={cn(
        ADJUST_BALANCE_PILL_CN,
        LEDGER_CLOSING_BALANCE_ADJUST_PILL_CN,
        "!h-[27px] min-h-[27px] text-xs",
        className
      )}
      {...props}
    >
      <AdjustBalancePillLabel />
    </Button>
  );
}