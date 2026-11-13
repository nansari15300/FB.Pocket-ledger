"use client";
/**
 * Field-anchored OCR speech bubbles (replaces the centered suggestions modal).
 * - No backdrop / no dimming: the voucher form stays fully interactive (portal, pointer-events only on bubbles).
 * - Each bubble points (tail) at its target field: elements marked `data-ocr-field="<key>"` inside the voucher form.
 *   Missing anchor -> bubble attaches to the OCR bar (`data-pl-ocr-refresh-bar`).
 * - Target field gets a pink attention ring while its bubble is shown.
 * - Repositions on scroll (capture) / resize / ResizeObserver / layout changes.
 * - A single coordinator measures every [data-ocr-bubble] and resolves overlaps in both directions.
 * - Mobile (< 640px): one bubble at a time with Prev / Next.
 * - Stacking: above AddVoucherDialog content (z-81), below nested master-create dialogs (z-92+) that bubbles open.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OcrSuggestion } from "./OcrSuggestionsDialog";
import { OCR_LAYER_Z, useOcrPrefs } from "./prefs";

/** Bubbles are hidden while any dialog / popover looks like it is layered above them. */
function ocrCoveredByModal(): Element | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]');
  for (const el of Array.from(nodes)) {
    if (el.hasAttribute("data-ocr-bubble")) continue;
    if (el.closest("[data-ocr-bubbles]")) continue;
    const z = Number(getComputedStyle(el).zIndex);
    if (Number.isFinite(z) && z > OCR_LAYER_Z) return el;
    // Same layer as the bubbles (OCR debug dialog): a position fix wins, so treat it as above.
    if (Number.isFinite(z) && z === OCR_LAYER_Z) return el;
  }
  return null;
}
import { shouldDrawOcrBubbleTail, stretchOcrTailTip } from "./bubbleTail";

export const OCR_BUBBLE_Z_CN = "z-[85]";
const RING = ["ring-2", "ring-pink-500", "ring-offset-1", "rounded-md", "transition-shadow"];

/** Suggestion id -> form field anchor key. */
export function ocrFieldForSuggestion(id: string): string {
  if (id === "switch" || id.startsWith("switch-")) return "voucher-type";
  if (id === "create-party" || id === "find-party" || id === "use-party") return "party";
  if (id === "date") return "date";
  if (id === "due") return "due-date";
  if (id === "create-vat" || id === "vat") return "tax";
  if (id === "create-ledger" || id === "ledger") return "ledger";
  if (id === "disc") return "discount";
  if (id.startsWith("amount")) return "amount";
  if (id === "billno") return "bill-no";
  if (id === "account" || id.startsWith("account-")) return "account";
  if (id === "cannot-detect" || id === "status-failed" || id === "duplicate-ref") return "voucher-type";
  /** Reading-language / translate options attach to the OCR bar, not a form field. */
  if (id === "ocr-language" || id.startsWith("ocr-lang-") || id.startsWith("ocr-translate")) return "ocr-language";
  return "lines"; // lines, create-item-*, tds, drcr
}

/** Missing-field label (from the hook) -> anchor key. */
export { ocrMissingFieldKey as ocrFieldForMissing } from "./reactiveBubbles";

export type OcrBubble = {
  key: string; // field anchor
  /** Optional precise anchor (`data-ocr-anchor` value), tried before `data-ocr-field=key`; e.g. "voucher-type-purchase". */
  anchor?: string;
  kind: "suggest" | "missing";
  title: string;
  englishTitle?: string;
  items: OcrSuggestion[];
  /** "OCR could not find: …" note merged from the missing-field bubble (one popup per field). */
  note?: string;
  /** Auto-switch countdown (seconds left) shown on the primary "Switch" button. */
  countdown?: number;
};

/** Prefer a compact line-item cell over a whole-table wrapper marked with the same field key. */
function preferLineCell(all: HTMLElement[]): HTMLElement {
  const compact = all.filter((el) => el.getBoundingClientRect().height <= 80);
  if (compact.length) return compact[0];
  return all.reduce((best, el) => {
    const a = el.getBoundingClientRect();
    const b = best.getBoundingClientRect();
    return a.width * a.height < b.width * b.height ? el : best;
  });
}

function findAnchor(key: string, anchor?: string): HTMLElement | null {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // "lines#N" -> item combobox of line N (N-th visible compact `data-ocr-field="lines"` cell)
  const m = anchor?.match(/^lines#(\d+)$/);
  if (m) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-field="lines"]`)).filter(vis);
    const compact = all.filter((el) => el.getBoundingClientRect().height <= 80);
    const rows = compact.length ? compact : all;
    const n = Number(m[1]);
    if (rows[n]) return rows[n];
    if (rows.length) return rows[0];
  }
  if (anchor && !m) {
    const exact = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-anchor="${anchor}"]`)).filter(vis);
    if (exact.length) return exact[exact.length - 1];
  }
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-field="${key}"]`)).filter(vis);
  if (all.length) {
    if (key === "lines") return preferLineCell(all);
    return all[all.length - 1];
  }
  if (key === "total") return findVisibleTotalSummaryRow();
  return null;
}

/** Last-resort Total locator: a visible "Total:" / "Invoice Total:" label in the summary panel. */
function findVisibleTotalSummaryRow(): HTMLElement | null {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labels = Array.from(document.querySelectorAll<HTMLElement>("span, label")).filter((el) => {
    if (!vis(el) || el.childElementCount > 0) return false;
    return /^(Invoice\s+)?Total:$/i.test((el.textContent ?? "").trim());
  });
  if (!labels.length) return null;
  const el = labels[labels.length - 1];
  const row = el.closest("div");
  return row && vis(row) ? row : el;
}
function fallbackAnchor(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-pl-ocr-refresh-bar]")).filter((e) => e.getBoundingClientRect().width > 0);
  return all[all.length - 1] ?? null;
}

/** Bubbles are portalled INTO the open voucher dialog (so Radix's modal focus-trap / outside-click doesn't
 *  close it or steal focus). A transformed dialog becomes the containing block of `fixed` -> subtract its origin. */
function hostOffset(host: HTMLElement | null): { x: number; y: number } {
  if (!host || host === document.body) return { x: 0, y: 0 };
  const cs = getComputedStyle(host);
  if (cs.transform === "none" && cs.filter === "none" && cs.contain === "none") return { x: 0, y: 0 };
  const r = host.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

type Side = "top" | "bottom" | "left" | "right";
type Pos = { top: number; left: number; side: Side; tail: number; fallback: boolean };
type Box = { left: number; top: number; right: number; bottom: number };
const W = 300;
const GAP = 12;
const MARGIN = 8;
const MAX_PASSES = 16;
/** Suggestions list (and other bubble bodies) cap; shrink further when the dialog is tight. */
const SUGGEST_LIST_MAX = 280;

/** Prefer ABOVE the field aligned to its top-right; else flip to whichever side has room. Tail aims at field centre. */
function place(a: HTMLElement | null, fallback: boolean, h: number, host: HTMLElement | null, aimStart = false, avoid: DOMRect[] = []): Pos | null {
  if (!a) return null;
  const r = a.getBoundingClientRect();
  const hits = (t: number, l: number, w: number) => avoid.some((o) => l < o.right && l + w > o.left && t < o.bottom && t + h > o.top);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(W, vw - 16);
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - w - 8));
  const clampY = (y: number) => Math.max(8, Math.min(y, vh - h - 8));
  // aimStart: wide cells (item combobox) -> aim near the field's left edge, not its far right
  const cx = aimStart ? r.left + Math.min(r.width / 2, 48) : r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hx = (x: number) => (aimStart ? clampX(cx - 28) : clampX(x));
  let side: Side;
  let top: number;
  let left: number;
  if (r.top - GAP - h >= 8 && !hits(r.top - GAP - h, hx(r.right - w), w)) { side = "top"; top = r.top - GAP - h; left = hx(r.right - w); }
  else if (r.bottom + GAP + h <= vh - 8) { side = "bottom"; top = r.bottom + GAP; left = hx(r.right - w); }
  else if (r.top - GAP - h >= 8) { side = "top"; top = r.top - GAP - h; left = hx(r.right - w); }
  else if (r.right + GAP + w <= vw - 8) { side = "right"; left = r.right + GAP; top = clampY(cy - h / 2); }
  else if (r.left - GAP - w >= 8) { side = "left"; left = r.left - GAP - w; top = clampY(cy - h / 2); }
  else { side = "top"; top = clampY(r.top - GAP - h); left = clampX(r.right - w); }
  const tail =
    side === "top" || side === "bottom"
      ? Math.max(16, Math.min((aimStart ? cx : Math.max(cx, r.right - Math.min(r.width / 2, 40))) - left, w - 16))
      : Math.max(16, Math.min(cy - top, h - 16));
  const o = hostOffset(host);
  return { top: top - o.y, left: left - o.x, side, tail, fallback };
}

function asBox(r: { left: number; top: number; right: number; bottom: number }): Box {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function layoutBox(host: HTMLElement | null): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = 8, top = 8, right = vw - 8, bottom = vh - 8;
  const dialog = (host && host !== document.body ? (host.closest('[role="dialog"]') as HTMLElement | null) ?? host : null);
  if (dialog) {
    const r = dialog.getBoundingClientRect();
    if (r.width > 40 && r.height > 40) {
      left = Math.max(left, r.left + 8);
      top = Math.max(top, r.top + 8);
      right = Math.min(right, r.right - 8);
      bottom = Math.min(bottom, r.bottom - 8);
    }
  }
  if (right - left < 80 || bottom - top < 80) return { left: 8, top: 8, right: vw - 8, bottom: vh - 8 };
  return { left, top, right, bottom };
}

function bubbleSizeCap(box: Box): { maxW: number; maxH: number; listMaxH: number } {
  const maxW = Math.min(W, Math.max(160, box.right - box.left), window.innerWidth - 16);
  const tight = Math.max(96, box.bottom - box.top);
  const listMaxH = Math.min(window.innerHeight * 0.4, SUGGEST_LIST_MAX, Math.max(72, tight - 72));
  const maxH = Math.min(window.innerHeight * 0.4 + 72, SUGGEST_LIST_MAX + 72, tight, listMaxH + 72);
  return { maxW, maxH, listMaxH };
}

function intersectArea(l: number, t: number, w: number, h: number, r: Box, m = MARGIN): number {
  const x1 = Math.max(l, r.left - m);
  const y1 = Math.max(t, r.top - m);
  const x2 = Math.min(l + w, r.right + m);
  const y2 = Math.min(t + h, r.bottom + m);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function clampToBox(l: number, t: number, w: number, h: number, box: Box): { l: number; t: number } {
  const maxL = Math.max(box.left, box.right - w);
  const maxT = Math.max(box.top, box.bottom - h);
  return { l: Math.min(Math.max(l, box.left), maxL), t: Math.min(Math.max(t, box.top), maxT) };
}

function tabRects(key: string): DOMRect[] {
  if (key === "voucher-type") return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[data-ocr-field="voucher-type"]'))
    .map((x) => x.getBoundingClientRect())
    .filter((x) => x.width > 0);
}

function inferSide(l: number, t: number, w: number, h: number, field: HTMLElement | null): Side {
  if (!field) return "top";
  const r = field.getBoundingClientRect();
  const dx = l + w / 2 - (r.left + r.width / 2);
  const dy = t + h / 2 - (r.top + r.height / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "top" : "bottom";
  return dx < 0 ? "left" : "right";
}

function sidePos(field: HTMLElement, side: Side, w: number, h: number, box: Box, aimStart: boolean): { l: number; t: number; side: Side } {
  const r = field.getBoundingClientRect();
  const cx = aimStart ? r.left + Math.min(r.width / 2, 48) : r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let l: number, t: number;
  if (side === "top") { t = r.top - GAP - h; l = aimStart ? cx - 28 : r.right - w; }
  else if (side === "bottom") { t = r.bottom + GAP; l = aimStart ? cx - 28 : r.right - w; }
  else if (side === "right") { l = r.right + GAP; t = cy - h / 2; }
  else { l = r.left - GAP - w; t = cy - h / 2; }
  const c = clampToBox(l, t, w, h, box);
  return { l: c.l, t: c.t, side };
}

function clearOfField(l: number, t: number, w: number, h: number, field: HTMLElement | null, box: Box, aimStart: boolean): { l: number; t: number; side: Side } {
  if (!field || intersectArea(l, t, w, h, asBox(field.getBoundingClientRect()), MARGIN) <= 0) {
    return { l, t, side: inferSide(l, t, w, h, field) };
  }
  let best: { l: number; t: number; side: Side; score: number } | null = null;
  for (const side of ["top", "bottom", "right", "left"] as Side[]) {
    const c = sidePos(field, side, w, h, box, aimStart);
    const area = intersectArea(c.l, c.t, w, h, asBox(field.getBoundingClientRect()), MARGIN);
    const score = area * 1000 + Math.hypot(c.l - l, c.t - t);
    if (!best || score < best.score) best = { ...c, score };
  }
  return best ?? { l, t, side: inferSide(l, t, w, h, field) };
}

function penalty(l: number, t: number, w: number, h: number, obstacles: Box[], box: Box, field: HTMLElement | null, originL: number, originT: number): number {
  let s = 0;
  for (const o of obstacles) s += intersectArea(l, t, w, h, o);
  if (field) s += intersectArea(l, t, w, h, asBox(field.getBoundingClientRect()), MARGIN) * 2;
  if (l < box.left) s += (box.left - l) * h;
  if (t < box.top) s += (box.top - t) * w;
  if (l + w > box.right) s += (l + w - box.right) * h;
  if (t + h > box.bottom) s += (t + h - box.bottom) * w;
  s += Math.hypot(l - originL, t - originT) * 0.05;
  return s;
}

function stillHits(l: number, t: number, w: number, h: number, obstacles: Box[]): boolean {
  return obstacles.some((o) => intersectArea(l, t, w, h, o) > 0);
}

type Leader = { x1: number; y1: number; x2: number; y2: number };
type LayoutSink = (pos: Pos | null, leader: Leader | null, tail: TailGeom | null) => void;
type Reg = { key: string; anchor?: string; sink: LayoutSink };
type Item = {
  el: HTMLElement;
  key: string;
  sink: LayoutSink;
  field: HTMLElement | null;
  usedFallback: boolean;
  aimStart: boolean;
  w: number;
  h: number;
  l: number;
  t: number;
  side: Side;
  originL: number;
  originT: number;
};

const bubbleRegistry = new Map<HTMLElement, Reg>();
let layoutRaf = 0;

function registerOcrBubble(el: HTMLElement, key: string, anchor: string | undefined, sink: LayoutSink) {
  bubbleRegistry.set(el, { key, anchor, sink });
  scheduleOcrBubbleLayout();
}
function unregisterOcrBubble(el: HTMLElement) {
  bubbleRegistry.delete(el);
  scheduleOcrBubbleLayout();
}
function scheduleOcrBubbleLayout() {
  if (typeof window === "undefined") return;
  if (layoutRaf) return;
  layoutRaf = window.requestAnimationFrame(() => {
    layoutRaf = 0;
    layoutAllOcrBubbles();
  });
}

function stackAlongSide(stuck: Item[], all: Item[], box: Box) {
  const good = all.filter((it) => !stuck.includes(it));
  const mid = (box.left + box.right) / 2;
  let leftOcc = 0, rightOcc = 0;
  for (const g of good) {
    if (g.l + g.w / 2 >= mid) rightOcc += g.w * g.h;
    else leftOcc += g.w * g.h;
  }
  const useRight = rightOcc <= leftOcc;
  const gap = MARGIN;
  const colW = Math.max(...stuck.map((it) => it.w));
  let x = useRight ? box.right - colW : box.left;
  let y = box.top;
  const ordered = [...stuck].sort((a, b) => a.t - b.t || a.l - b.l);
  for (const it of ordered) {
    if (y + it.h > box.bottom && y > box.top) {
      x = useRight ? x - colW - gap : x + colW + gap;
      if (x < box.left) x = box.left;
      if (x + it.w > box.right) x = Math.max(box.left, box.right - it.w);
      y = box.top;
    }
    let guard = 0;
    while (guard++ < 24) {
      const hit = good.find((g) => intersectArea(x, y, it.w, it.h, { left: g.l, top: g.t, right: g.l + g.w, bottom: g.t + g.h }) > 0);
      if (!hit) break;
      y = hit.t + hit.h + gap;
      if (y + it.h > box.bottom) {
        x = useRight ? x - colW - gap : x + colW + gap;
        if (x < box.left) x = box.left;
        if (x + it.w > box.right) x = Math.max(box.left, box.right - it.w);
        y = box.top;
      }
    }
    const c = clampToBox(x, y, it.w, it.h, box);
    it.l = c.l;
    it.t = c.t;
    it.side = inferSide(it.l, it.t, it.w, it.h, it.field);
    y = it.t + it.h + gap;
  }
}

/** Measure every bubble, pick the least-overlap slot among right/left/down/up, iterate, then clamp. */
function layoutAllOcrBubbles() {
  if (typeof document === "undefined") return;
  const entries = [...bubbleRegistry.entries()].filter(([el]) => el.isConnected);
  if (!entries.length) return;
  const host = entries[0][0].parentElement?.parentElement ?? null;
  const box = layoutBox(host);
  const cap = bubbleSizeCap(box);
  const items: Item[] = [];

  for (const [el, reg] of entries) {
    el.style.maxWidth = cap.maxW + "px";
    el.style.width = cap.maxW + "px";
    el.style.maxHeight = cap.maxH + "px";
    const body = el.querySelector<HTMLElement>("[data-ocr-bubble-body]");
    if (body) body.style.maxHeight = cap.listMaxH + "px";
    const w = Math.min(cap.maxW, el.offsetWidth || cap.maxW);
    const h = Math.min(cap.maxH, el.offsetHeight || Math.min(120, cap.maxH));
    const found = findAnchor(reg.key, reg.anchor);
    const field = found ?? fallbackAnchor();
    const usedFallback = !found;
    const aimStart = !!found && (reg.key === "lines" || !!reg.anchor?.startsWith("lines#"));
    const p = place(field, usedFallback, h, host, aimStart, tabRects(reg.key));
    const o = hostOffset(host);
    let l: number, t: number, side: Side;
    if (p) {
      l = p.left + o.x;
      t = p.top + o.y;
      side = p.side;
    } else {
      const c = clampToBox(box.left, box.top, w, h, box);
      l = c.l; t = c.t; side = "top";
    }
    const cleared = clearOfField(l, t, w, h, field, box, aimStart);
    items.push({
      el, key: reg.key, sink: reg.sink, field, usedFallback, aimStart, w, h,
      l: cleared.l, t: cleared.t, side: cleared.side,
      originL: cleared.l, originT: cleared.t,
    });
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const it of items) {
      const obstacles: Box[] = [
        ...tabRects(it.key).map(asBox),
        ...items.filter((o) => o !== it).map((o) => ({ left: o.l, top: o.t, right: o.l + o.w, bottom: o.t + o.h })),
      ];
      const fieldBox = it.field ? asBox(it.field.getBoundingClientRect()) : null;
      const hitsOthers = stillHits(it.l, it.t, it.w, it.h, obstacles);
      const hitsField = fieldBox ? intersectArea(it.l, it.t, it.w, it.h, fieldBox, MARGIN) > 0 : false;
      if (!hitsOthers && !hitsField) continue;

      const cands: { l: number; t: number; side: Side }[] = [];
      const cur = clampToBox(it.l, it.t, it.w, it.h, box);
      cands.push({ l: cur.l, t: cur.t, side: it.side });
      if (it.field) {
        for (const s of ["top", "bottom", "right", "left"] as Side[]) {
          cands.push(sidePos(it.field, s, it.w, it.h, box, it.aimStart));
        }
      }
      const obsList = fieldBox ? [...obstacles, fieldBox] : obstacles;
      for (const obs of obsList) {
        const slides = [
          { l: obs.right + MARGIN, t: it.t },
          { l: obs.left - MARGIN - it.w, t: it.t },
          { l: it.l, t: obs.bottom + MARGIN },
          { l: it.l, t: obs.top - MARGIN - it.h },
          { l: obs.right + MARGIN, t: obs.top - MARGIN - it.h },
          { l: obs.right + MARGIN, t: obs.bottom + MARGIN },
          { l: obs.left - MARGIN - it.w, t: obs.top - MARGIN - it.h },
          { l: obs.left - MARGIN - it.w, t: obs.bottom + MARGIN },
        ];
        for (const s of slides) {
          const c = clampToBox(s.l, s.t, it.w, it.h, box);
          cands.push({ l: c.l, t: c.t, side: inferSide(c.l, c.t, it.w, it.h, it.field) });
        }
      }

      let best = cands[0];
      let bestScore = Infinity;
      for (const c of cands) {
        const score = penalty(c.l, c.t, it.w, it.h, obstacles, box, it.field, it.originL, it.originT);
        if (score < bestScore - 0.5) {
          bestScore = score;
          best = c;
        }
      }
      if (best.l !== it.l || best.t !== it.t) {
        it.l = best.l;
        it.t = best.t;
        it.side = best.side;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const colliding = items.filter((it) => {
    const others = items.filter((o) => o !== it).map((o) => ({ left: o.l, top: o.t, right: o.l + o.w, bottom: o.t + o.h }));
    const fieldBox = it.field ? asBox(it.field.getBoundingClientRect()) : null;
    return stillHits(it.l, it.t, it.w, it.h, others) || (fieldBox ? intersectArea(it.l, it.t, it.w, it.h, fieldBox, MARGIN) > 0 : false);
  });
  if (colliding.length) stackAlongSide(colliding, items, box);

  const o = hostOffset(host);
  for (const it of items) {
    const cleared = clearOfField(it.l, it.t, it.w, it.h, it.field, box, it.aimStart);
    const c = clampToBox(cleared.l, cleared.t, it.w, it.h, box);
    const again = clearOfField(c.l, c.t, it.w, it.h, it.field, box, it.aimStart);
    it.l = again.l;
    it.t = again.t;
    it.side = again.side;
    const p: Pos = { top: it.t - o.y, left: it.l - o.x, side: it.side, tail: 16, fallback: it.usedFallback };
    if (it.field) {
      const ar = it.field.getBoundingClientRect();
      const cx = it.aimStart ? ar.left + Math.min(ar.width / 2, 48) : ar.left + ar.width / 2;
      const cy = ar.top + ar.height / 2;
      p.tail = p.side === "top" || p.side === "bottom"
        ? Math.max(16, Math.min(cx - it.l, it.w - 16))
        : Math.max(16, Math.min(cy - it.t, it.h - 16));
    }
    // Tails only after final positions, and only when the real field is on screen (not the OCR-bar fallback).
    const tailAnchor = shouldDrawOcrBubbleTail(!it.usedFallback) ? it.field : null;
    it.sink(p, leaderPoints(p, it.el, tailAnchor, host), computeTailGeom(p, it.el, tailAnchor, host));
  }
}

/** Point on the bubble edge facing the field, then a line to the field centre. Length grows as the bubble is pushed away. */
function leaderPoints(p: Pos, el: HTMLElement, anchor: HTMLElement | null, host: HTMLElement | null): Leader | null {
  if (!anchor) return null;
  const o = hostOffset(host);
  const w = el.offsetWidth || W;
  const h = el.offsetHeight || 120;
  const br = { left: p.left + o.x, top: p.top + o.y, w, h };
  const ar = anchor.getBoundingClientRect();
  const cx = ar.left + ar.width / 2;
  const cy = ar.top + ar.height / 2;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(v, b));
  let x1: number, y1: number;
  if (p.side === "top") { x1 = clamp(cx, br.left + 16, br.left + br.w - 16); y1 = br.top + br.h; }
  else if (p.side === "bottom") { x1 = clamp(cx, br.left + 16, br.left + br.w - 16); y1 = br.top; }
  else if (p.side === "right") { x1 = br.left; y1 = clamp(cy, br.top + 16, br.top + br.h - 16); }
  else { x1 = br.left + br.w; y1 = clamp(cy, br.top + 16, br.top + br.h - 16); }
  return { x1: x1 - o.x, y1: y1 - o.y, x2: cx - o.x, y2: cy - o.y };
}

function LeaderLine({ line, color }: { line: Leader; color: string }) {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // short arrowhead at the field
  const ah = Math.max(6, Math.min(10, len / 6));
  const bx = line.x2 - ux * ah, by = line.y2 - uy * ah;
  const px = -uy * (ah * 0.45), py = ux * (ah * 0.45);
  const minX = Math.min(line.x1, line.x2) - 12, minY = Math.min(line.y1, line.y2) - 12;
  const width = Math.abs(dx) + 24, height = Math.abs(dy) + 24;
  return (
    <svg aria-hidden width={width} height={height} viewBox={`${minX} ${minY} ${width} ${height}`}
      style={{ position: "absolute", left: minX, top: minY, overflow: "visible", pointerEvents: "none", zIndex: 0 }}>
      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <polygon points={`${line.x2},${line.y2} ${bx + px},${by + py} ${bx - px},${by - py}`} fill={color} />
    </svg>
  );
}

type Pt = { x: number; y: number };
type TailGeom = {
  kind: "corner" | "side";
  corner?: "tl" | "tr" | "bl" | "br";
  side?: Side;
  /** Attachment (corner or side point) and field tip, in bubble-local pixels. Length = distance between them. */
  attach: Pt;
  tip: Pt;
  length: number;
  bEnter: Pt;
  bLeave: Pt;
  cEnter1: Pt;
  cEnter2: Pt;
  cLeave1: Pt;
  cLeave2: Pt;
  w: number;
  h: number;
  r: number;
};

function clampNum(v: number, a: number, b: number) {
  return Math.max(a, Math.min(v, b));
}

/** Closest point on a rect; if the query is inside, the nearest point on the border. */
function closestOnRect(x: number, y: number, r: DOMRect): Pt {
  if (x > r.left && x < r.right && y > r.top && y < r.bottom) {
    const dl = x - r.left, dr = r.right - x, dt = y - r.top, db = r.bottom - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: r.left, y };
    if (m === dr) return { x: r.right, y };
    if (m === dt) return { x, y: r.top };
    return { x, y: r.bottom };
  }
  return { x: clampNum(x, r.left, r.right), y: clampNum(y, r.top, r.bottom) };
}

/** Closest point on the bubble rectangle boundary to F. */
function closestOnBoundary(F: Pt, left: number, top: number, w: number, h: number): Pt {
  const right = left + w, bottom = top + h;
  const inside = F.x > left && F.x < right && F.y > top && F.y < bottom;
  if (inside) {
    const dl = F.x - left, dr = right - F.x, dt = F.y - top, db = bottom - F.y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: left, y: F.y };
    if (m === dr) return { x: right, y: F.y };
    if (m === dt) return { x: F.x, y: top };
    return { x: F.x, y: bottom };
  }
  return { x: clampNum(F.x, left, right), y: clampNum(F.y, top, bottom) };
}

function cubics(from: Pt, to: Pt, nx: number, ny: number, bow: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  return {
    c1: { x: from.x + ux * L * 0.3 + nx * bow, y: from.y + uy * L * 0.3 + ny * bow },
    c2: { x: from.x + ux * L * 0.7 + nx * bow * 0.4, y: from.y + uy * L * 0.7 + ny * bow * 0.4 },
  };
}

/**
 * Tail geometry after the coordinator has settled final positions.
 * Length = distance from the nearest corner/side of the rectangle to the closest point on the field.
 * Uses the same anchor as placement (found ?? fallback). Bubbles overlapping their field are moved off first.
 */
function computeTailGeom(p: Pos, el: HTMLElement, anchor: HTMLElement | null, host: HTMLElement | null): TailGeom | null {
  if (!anchor) return null;
  const o = hostOffset(host);
  const w = el.offsetWidth || W;
  const h = el.offsetHeight || 120;
  const r = 16;
  const left = p.left + o.x, top = p.top + o.y;
  const right = left + w, bottom = top + h;
  const ar = anchor.getBoundingClientRect();
  const fieldMid = { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2 };
  // Boundary point of the popup nearest the field (in that direction).
  const Q = closestOnBoundary(fieldMid, left, top, w, h);
  const corners: { name: NonNullable<TailGeom["corner"]>; x: number; y: number }[] = [
    { name: "tl", x: left, y: top },
    { name: "tr", x: right, y: top },
    { name: "bl", x: left, y: bottom },
    { name: "br", x: right, y: bottom },
  ];
  let near = corners[0], nearD = Infinity;
  for (const c of corners) {
    const d = Math.hypot(c.x - Q.x, c.y - Q.y);
    if (d < nearD) { near = c; nearD = d; }
  }
  const onTop = Math.abs(Q.y - top) < 0.6;
  const onBottom = Math.abs(Q.y - bottom) < 0.6;
  const onLeft = Math.abs(Q.x - left) < 0.6;
  const onRight = Math.abs(Q.x - right) < 0.6;
  const snap = 28;
  const useCorner = nearD <= snap;
  const kind: TailGeom["kind"] = useCorner ? "corner" : "side";
  const side: Side = onTop ? "top" : onBottom ? "bottom" : onLeft ? "left" : onRight ? "right" : (p.side ?? "bottom");
  const attach = useCorner ? { x: near.x, y: near.y } : { x: Q.x, y: Q.y };
  const tipClosest = closestOnRect(attach.x, attach.y, ar);
  const stretched = stretchOcrTailTip(attach, tipClosest, { x: fieldMid.x - attach.x, y: fieldMid.y - attach.y });
  const tipV = stretched.tip;
  const length = stretched.length;
  const base = Math.min(22, 16 + Math.min(6, length / 50)); // 16, slightly wider when the field is far
  const loc = (pt: Pt): Pt => ({ x: pt.x - o.x - p.left, y: pt.y - o.y - p.top });
  const A = loc(attach);
  const tip = loc(tipV);
  let bEnter: Pt, bLeave: Pt;
  if (kind === "corner") {
    const c = near.name;
    if (c === "tr") { bEnter = { x: w - base, y: 0 }; bLeave = { x: w, y: base }; }
    else if (c === "br") { bEnter = { x: w, y: h - base }; bLeave = { x: w - base, y: h }; }
    else if (c === "bl") { bEnter = { x: base, y: h }; bLeave = { x: 0, y: h - base }; }
    else { bEnter = { x: 0, y: base }; bLeave = { x: base, y: 0 }; }
  } else {
    const half = base / 2;
    const lo = r, hiX = w - r, hiY = h - r;
    if (side === "top") {
      const x = clampNum(A.x, lo + half, hiX - half);
      bEnter = { x: x - half, y: 0 }; bLeave = { x: x + half, y: 0 };
    } else if (side === "right") {
      const y = clampNum(A.y, lo + half, hiY - half);
      bEnter = { x: w, y: y - half }; bLeave = { x: w, y: y + half };
    } else if (side === "bottom") {
      const x = clampNum(A.x, lo + half, hiX - half);
      bEnter = { x: x + half, y: h }; bLeave = { x: x - half, y: h }; // clockwise: right to left
    } else {
      const y = clampNum(A.y, lo + half, hiY - half);
      bEnter = { x: 0, y: y + half }; bLeave = { x: 0, y: y - half }; // clockwise: bottom to top
    }
  }
  // Slight bend, perpendicular to attach->tip, signed outward so the tail does not cut through the popup.
  const tdx = tip.x - A.x, tdy = tip.y - A.y;
  const L = Math.hypot(tdx, tdy) || 1;
  let px = -tdy / L, py = tdx / L;
  if (px * (A.x - w / 2) + py * (A.y - h / 2) < 0) { px = -px; py = -py; }
  const bow = Math.min(24, Math.max(8, L * 0.15));
  const en = cubics(bEnter, tip, px, py, bow);
  const lv = cubics(tip, bLeave, px, py, bow);
  return {
    kind, corner: kind === "corner" ? near.name : undefined, side: kind === "side" ? side : undefined,
    attach: A, tip, length,
    bEnter, bLeave, cEnter1: en.c1, cEnter2: en.c2, cLeave1: lv.c1, cLeave2: lv.c2,
    w, h, r,
  };
}

function tailDetour(t: TailGeom): string {
  return "L " + t.bEnter.x + " " + t.bEnter.y + " C " + t.cEnter1.x + " " + t.cEnter1.y + " " + t.cEnter2.x + " " + t.cEnter2.y + " " + t.tip.x + " " + t.tip.y + " C " + t.cLeave1.x + " " + t.cLeave1.y + " " + t.cLeave2.x + " " + t.cLeave2.y + " " + t.bLeave.x + " " + t.bLeave.y;
}

/** Single outline of the existing rounded rectangle plus the tail (seamless fill and border). */
function buildBubblePath(w: number, h: number, r: number, t: TailGeom | null): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const arc = (x: number, y: number) => "A " + r + " " + r + " 0 0 1 " + x + " " + y;
  const isC = (c: string) => t?.kind === "corner" && t.corner === c;
  const isS = (s: string) => t?.kind === "side" && t.side === s;
  let d = "M " + r + " 0";
  d += isS("top") ? tailDetour(t!) + " L " + (w - r) + " 0" : "L " + (w - r) + " 0";
  d += isC("tr") ? tailDetour(t!) : " " + arc(w, r);
  d += isS("right") ? tailDetour(t!) + " L " + w + " " + (h - r) : "L " + w + " " + (h - r);
  d += isC("br") ? tailDetour(t!) : " " + arc(w - r, h);
  d += isS("bottom") ? tailDetour(t!) + " L " + r + " " + h : "L " + r + " " + h;
  d += isC("bl") ? tailDetour(t!) : " " + arc(0, h - r);
  d += isS("left") ? tailDetour(t!) + " L 0 " + r : "L 0 " + r;
  d += isC("tl") ? tailDetour(t!) : " " + arc(r, 0);
  return d + "Z";
}

/** Filled+stroked popup chrome: same rectangle as the CSS box, with an optional tapered bent tail to the field. */
function BubbleChrome({ w, h, tail, color, fill }: { w: number; h: number; tail: TailGeom | null; color: string; fill: string }) {
  const r = 16;
  const d = buildBubblePath(w, h, r, tail);
  const xs = [0, w], ys = [0, h];
  if (tail) for (const pt of [tail.tip, tail.bEnter, tail.bLeave, tail.cEnter1, tail.cEnter2, tail.cLeave1, tail.cLeave2]) { xs.push(pt.x); ys.push(pt.y); }
  const pad = 10;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad, height = Math.max(...ys) - minY + pad;
  return (
    <svg aria-hidden width={width} height={height} viewBox={minX + " " + minY + " " + width + " " + height}
      style={{ position: "absolute", left: minX, top: minY, overflow: "visible", pointerEvents: "none", zIndex: 0 }}>
      <path d={d} fill={fill} stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function isCreateItemSuggestion(s: OcrSuggestion): boolean {
  return s.id.startsWith("create-item-");
}

function CreateItemChoiceButton({
  s,
  onApply,
  className,
}: {
  s: OcrSuggestion;
  onApply: (s: OcrSuggestion, mode?: "auto" | "manual", language?: "original" | "english") => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" className={className}>Create</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[2147483646] w-44 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        <button type="button" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setOpen(false); onApply(s, "auto"); }}>Auto Create</button>
        <button type="button" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setOpen(false); onApply(s, "manual"); }}>Manual Create</button>
      </PopoverContent>
    </Popover>
  );
}

function suggestionActionLabel(s: OcrSuggestion, countdown?: number): string {
  if (s.id === "switch" || s.id.startsWith("switch-")) return s.id === "switch" && countdown != null ? `Switch (${countdown})` : "Switch";
  // Deferred = opens a master form (create account / party) or a picker: name the action, not "Open".
  if (s.id.startsWith("create-account")) return "Create new";
  if (s.deferred) return "Open";
  return "Apply";
}

function BubbleView({
  b,
  onApply,
  onDismiss,
  onCreateAllItems,
  nav,
  scrollOnMount,
}: {
  b: OcrBubble;
  onApply: (s: OcrSuggestion, mode?: "auto" | "manual", language?: "original" | "english") => void;
  onDismiss: () => void;
  onCreateAllItems?: (items: OcrSuggestion[], language?: "original" | "english") => void;
  nav?: { i: number; n: number; prev: () => void; next: () => void };
  scrollOnMount: boolean;
  /** Kept for callers; overlap is now resolved by the global coordinator. */
  stack?: number;
}) {
  const connectorStyle = useOcrPrefs().connectorStyle === "line" ? "line" : "tail";
  const [pos, setPos] = useState<Pos | null>(null);
  const [leader, setLeader] = useState<Leader | null>(null);
  const [tail, setTail] = useState<TailGeom | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [showEnglish, setShowEnglish] = useState(false);
  const apply = (s: OcrSuggestion, mode?: "auto" | "manual") => onApply(s, mode, showEnglish ? "english" : "original");
  const hasEnglishTranslation = Boolean(b.englishTitle || b.items.some((s) => s.englishValue || s.englishMasterName));
  const displaySuggestionValue = (s: OcrSuggestion) => {
    if (!showEnglish) return s.value;
    if (s.englishValue) return s.englishValue;
    if (!s.englishMasterName) return s.value;
    const separator = s.id === "create-party" ? " · " : s.id.startsWith("create-item-") ? " | " : "";
    const sourceName = separator ? s.value.split(separator)[0] : s.value;
    return sourceName ? s.value.replace(sourceName, s.englishMasterName) : s.value;
  };

  const update = useCallback(() => {
    scheduleOcrBubbleLayout();
  }, []);

  useLayoutEffect(() => {
    if (!el) return;
    const sink: LayoutSink = (p, nextLeader, nextTail) => {
      setPos(p);
      setLeader(nextLeader);
      setTail(nextTail);
    };
    registerOcrBubble(el, b.key, b.anchor, sink);
    return () => unregisterOcrBubble(el);
  }, [el, b.key, b.anchor]);

  useLayoutEffect(() => {
    update();
  }, [update, b.title, b.items.length, b.countdown]);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const applyRing = () => {
      const next = findAnchor(b.key, b.anchor);
      if (current && current !== next) current.classList.remove(...RING);
      if (next && next !== current) {
        next.classList.add(...RING);
        if (scrollOnMount && !current) next.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      current = next;
    };
    applyRing();
    const on = () => { applyRing(); update(); };
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    const t = window.setInterval(on, 400); // layout shifts (rows added, dialogs resized, field appears later)
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(on);
      ro.observe(el);
    }
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(on);
      const host = document.querySelector('[role="dialog"]') ?? document.body;
      mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ocr-field", "data-ocr-anchor", "class", "style"] });
    }
    return () => {
      current?.classList.remove(...RING);
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
      window.clearInterval(t);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [b.key, b.anchor, update, scrollOnMount, el]);

  const missing = b.kind === "missing";
  const party = b.items.find((s) => s.id === "create-party");
  const pick = b.items.find((s) => s.id === "find-party");
  /** Reading-language options (English / Local / Set as default) — apna block, baaki suggestions se alag. */
  const langHead = b.items.find((s) => s.id === "ocr-language");
  const langOpts = b.items.filter((s) => s.id.startsWith("ocr-lang-"));
  const restItems = b.items.filter((s) => s.id !== "ocr-language" && !s.id.startsWith("ocr-lang-"));
  const border = missing ? "#fcd34d" : "#f9a8d4";
  const pill = "h-7 rounded-full px-3 text-xs";
  const vw = typeof window !== "undefined" ? window.innerWidth : W;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const bubbleMaxW = Math.min(W, vw - 16);
  const listMaxH = Math.min(vh * 0.4, SUGGEST_LIST_MAX);

  return (
    <div
      ref={setEl}
      role="dialog"
      aria-label={b.title}
      data-ocr-bubble={b.key}
      className="pointer-events-auto fixed text-sm text-slate-800"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: bubbleMaxW,
        maxWidth: bubbleMaxW,
        maxHeight: listMaxH + 72,
        overflow: "visible",
        display: "flex",
        flexDirection: "column",
        visibility: pos ? "visible" : "hidden",
        background: connectorStyle === "line" ? "#ffffff" : "transparent",
        opacity: 1,
        border: `1px solid ${connectorStyle === "line" ? border : "transparent"}`,
        borderRadius: 16,
        boxShadow: "0 10px 30px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,0.08)",
        padding: 12,
        isolation: "isolate",
        zIndex: OCR_LAYER_Z,
      }}
    >
      {connectorStyle === "line"
        ? (leader && pos ? <LeaderLine line={{ x1: leader.x1 - pos.left, y1: leader.y1 - pos.top, x2: leader.x2 - pos.left, y2: leader.y2 - pos.top }} color={border} /> : null)
        : (pos && el ? <BubbleChrome w={el.offsetWidth || W} h={el.offsetHeight || 120} tail={tail} color={border} fill="#ffffff" /> : null)}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" style={{ zIndex: 2, background: connectorStyle === "line" ? "#ffffff" : "transparent" }}>
        <div className="flex shrink-0 items-start gap-2">
          <p className="min-w-0 flex-1 font-medium leading-snug">
            {showEnglish && b.englishTitle ? b.englishTitle : b.title}
            {pos?.fallback ? <span className="block text-[11px] font-normal text-slate-500">(field not on screen)</span> : null}
          </p>
          {hasEnglishTranslation ? <button type="button" className="shrink-0 text-[10px] font-medium text-sky-700 underline" onClick={() => setShowEnglish((v) => !v)}>{showEnglish ? "Show original" : "Translate to English"}</button> : null}
          <button type="button" aria-label="Dismiss" className="-mr-1 -mt-1 rounded-full p-1 text-slate-500 hover:bg-slate-100" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div data-ocr-bubble-body="" className="min-h-0" style={{ maxHeight: listMaxH, overflowY: "auto", overscrollBehavior: "contain" }}>
        {b.note ? <p className="mt-1 break-words text-[11px] leading-snug text-amber-700">{b.note}</p> : null}
        {langHead ? (
          /* Reading language mismatch: English vs Local option + "Set as default". */
          <div className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50/70 p-2 dark:border-sky-800 dark:bg-sky-950/40">
            <p className="text-xs font-semibold text-sky-900 dark:text-sky-100">{langHead.label}</p>
            <p className="mt-0.5 break-words text-[11px] leading-snug text-slate-600 dark:text-slate-300">{langHead.value}</p>
            {langHead.reason ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{langHead.reason}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {langOpts.map((s) => (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={s.id === "ocr-lang-default" ? "default" : s.blocked ? "secondary" : "outline"}
                  disabled={!!s.blocked}
                  className="h-7 rounded-full px-3 text-[11px]"
                  title={s.value}
                  onClick={() => onApply(s)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {missing ? (
          <div className="mt-1.5">
            {b.items[0] ? (
              <>
                <p className="break-words text-xs text-slate-500">{displaySuggestionValue(b.items[0])}</p>
                {b.items[0].englishValue ? <button type="button" className="mt-1 text-[10px] font-medium text-sky-700 underline" onClick={() => setShowEnglish((v) => !v)}>{showEnglish ? "Show original" : "Translate to English"}</button> : null}
                {b.items[0].reason ? <p className="text-[11px] text-slate-500">{b.items[0].reason}</p> : null}
              </>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button type="button" size="sm" className={pill} onClick={onDismiss}>OK</Button>
            </div>
          </div>
        ) : party ? (
          <div className="mt-1.5">
            <p className="break-words text-xs text-slate-500">{displaySuggestionValue(party)}</p>
            {party.englishValue ? <button type="button" className="mt-1 text-[10px] font-medium text-sky-700 underline" onClick={() => setShowEnglish((v) => !v)}>{showEnglish ? "Show original" : "Translate to English"}</button> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className={pill} onClick={() => apply(party)}>Create</Button>
              {pick ? <Button type="button" size="sm" variant="outline" className={pill} onClick={() => apply(pick)}>Pick existing</Button> : null}
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        ) : restItems.length === 1 ? (
          <div className="mt-1.5">
            <p className="break-words text-xs text-slate-500">{displaySuggestionValue(restItems[0])}</p>
            {restItems[0].englishValue ? <button type="button" className="mt-1 text-[10px] font-medium text-sky-700 underline" onClick={() => setShowEnglish((v) => !v)}>{showEnglish ? "Show original" : "Translate to English"}</button> : null}
            {restItems[0].reason ? <p className="text-[11px] text-slate-500">{restItems[0].reason}</p> : null}
            {restItems[0].blocked ? <p className="text-[11px] text-amber-700">{restItems[0].blocked}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!restItems[0].blocked ? (isCreateItemSuggestion(restItems[0]) ? <CreateItemChoiceButton s={restItems[0]} onApply={apply} className={pill} /> : <Button type="button" size="sm" className={pill} onClick={() => apply(restItems[0])}>{suggestionActionLabel(restItems[0], b.countdown)}</Button>) : null}
              {restItems.filter((x) => isCreateItemSuggestion(x) && !x.blocked).length >= 2 ? <Button type="button" size="sm" variant="outline" className={pill} onClick={() => onCreateAllItems?.(restItems.filter((x) => isCreateItemSuggestion(x) && !x.blocked), showEnglish ? "english" : "original")}>Create All</Button> : null}
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        ) : restItems.length === 0 ? (
          /* Sirf language options hain — unka apna block upar hai, Dismiss hi chahiye. */
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            {restItems.map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="break-words text-[11px] text-slate-500">{displaySuggestionValue(s)}</p>
                  {s.englishValue ? <button type="button" className="mt-0.5 text-[10px] font-medium text-sky-700 underline" onClick={() => setShowEnglish((v) => !v)}>{showEnglish ? "Show original" : "Translate to English"}</button> : null}
                  {s.blocked ? <p className="text-[11px] text-amber-700">{s.blocked}</p> : null}
                </div>
                {!s.blocked ? (isCreateItemSuggestion(s) ? <CreateItemChoiceButton s={s} onApply={apply} className="h-6 rounded-full px-2.5 text-[11px]" /> : <Button type="button" size="sm" variant="outline" className="h-6 rounded-full px-2.5 text-[11px]" onClick={() => apply(s)}>{suggestionActionLabel(s, b.countdown)}</Button>) : null}
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-1.5">
              {restItems.filter((x) => isCreateItemSuggestion(x) && !x.blocked).length >= 2 ? <Button type="button" size="sm" variant="outline" className={pill} onClick={() => onCreateAllItems?.(restItems.filter((x) => isCreateItemSuggestion(x) && !x.blocked), showEnglish ? "english" : "original")}>Create All</Button> : null}
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        )}
        </div>

        {nav && nav.n > 1 ? (
          <div className="mt-2 flex shrink-0 items-center justify-between border-t pt-1.5 text-[11px] text-slate-500">
            <button type="button" className="flex items-center gap-0.5 disabled:opacity-40" disabled={nav.i === 0} onClick={nav.prev}><ChevronLeft className="h-3.5 w-3.5" />Prev</button>
            <span>{nav.i + 1} / {nav.n}</span>
            <button type="button" className="flex items-center gap-0.5 disabled:opacity-40" disabled={nav.i >= nav.n - 1} onClick={nav.next}>Next<ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OcrFieldBubbles({
  bubbles,
  onApply,
  onDismiss,
  onCreateAllItems,
}: {
  bubbles: OcrBubble[];
  onApply: (s: OcrSuggestion, mode?: "auto" | "manual", language?: "original" | "english") => void;
  onDismiss: (b: OcrBubble) => void;
  onCreateAllItems?: (items: OcrSuggestion[], language?: "original" | "english") => void;
}) {
  const [mobile, setMobile] = useState(false);
  const [idx, setIdx] = useState(0);
  /** OCR settings gear modal is open → hide bubbles (they live above the voucher shell, not above modals). */
  const [modalCovered, setModalCovered] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => {
      // Explicit gear-modal marker first; anything else stacked above the bubble layer also hides them.
      const open = document.querySelector('[data-ocr-settings-open="1"]') ?? ocrCoveredByModal();
      setModalCovered(!!open);
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ocr-settings-open"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const m = () => setMobile(window.innerWidth < 640);
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);
  useEffect(() => {
    if (idx >= bubbles.length) setIdx(Math.max(0, bubbles.length - 1));
  }, [bubbles.length, idx]);

  // Desktop: several bubbles on the same anchor (e.g. missing + suggestion) are merged by key upstream; show all.
  const shown = useMemo(() => (mobile ? bubbles.slice(idx, idx + 1) : bubbles), [mobile, bubbles, idx]);
  if (typeof document === "undefined" || !bubbles.length || modalCovered) return null;
  const host = document.body;
  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: OCR_LAYER_Z }} data-ocr-bubbles="">
      {shown.map((b, i) => (
        <BubbleView
          key={`${b.kind}:${b.key}:${b.anchor ?? ""}`}
          b={b}
          onApply={onApply}
          onCreateAllItems={onCreateAllItems}
            onDismiss={() => onDismiss(b)}
          scrollOnMount={mobile || i === 0}
          nav={mobile ? { i: idx, n: bubbles.length, prev: () => setIdx((x) => Math.max(0, x - 1)), next: () => setIdx((x) => Math.min(bubbles.length - 1, x + 1)) } : undefined}
        />
      ))}
    </div>,
    host
  );
}

/** Subtle pulsing dot on the target voucher-type tab while a "Switch to X voucher" suggestion is pending.
 *  Independent of the Suggestions toggle (stays when bubbles are hidden); removed when `target` becomes null
 *  (dismissed with X / applied) or when that tab becomes the active tab. */
export function useOcrTabBadge(target: string | null) {
  useEffect(() => {
    if (!target || typeof document === "undefined") return;
    const STYLE_ID = "pl-ocr-tab-badge-style";
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = "@keyframes plOcrTabPulse{0%{box-shadow:0 0 0 0 rgba(236,72,153,.6)}70%{box-shadow:0 0 0 7px rgba(236,72,153,0)}100%{box-shadow:0 0 0 0 rgba(236,72,153,0)}}";
      document.head.appendChild(st);
    }
    const sel = `[data-ocr-anchor="voucher-type-${target}"]`;
    let dot: HTMLSpanElement | null = null;
    let host: HTMLElement | null = null;
    let prevPos = "";
    const clear = () => {
      dot?.remove();
      if (host) host.style.position = prevPos;
      dot = null;
      host = null;
    };
    const sync = () => {
      const tabs = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => e.getBoundingClientRect().width > 0);
      const t = tabs[tabs.length - 1] ?? null;
      const active = !!t && (t.getAttribute("data-state") === "active" || t.getAttribute("aria-selected") === "true");
      if (!t || active) return clear();
      if (t === host && dot?.isConnected) return;
      clear();
      host = t;
      prevPos = t.style.position;
      if (getComputedStyle(t).position === "static") t.style.position = "relative";
      dot = document.createElement("span");
      dot.setAttribute("aria-hidden", "true");
      dot.setAttribute("data-ocr-tab-badge", target);
      Object.assign(dot.style, { position: "absolute", top: "-3px", right: "-3px", width: "10px", height: "10px", borderRadius: "9999px", background: "#ec4899", border: "2px solid #fff", pointerEvents: "none", animation: "plOcrTabPulse 1.6s ease-out infinite" });
      t.appendChild(dot);
    };
    sync();
    const iv = window.setInterval(sync, 500);
    return () => { window.clearInterval(iv); clear(); };
  }, [target]);
}
