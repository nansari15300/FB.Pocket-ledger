"use client";
/**
 * Field-anchored OCR speech bubbles (replaces the centered suggestions modal).
 * - No backdrop / no dimming: the voucher form stays fully interactive (portal, pointer-events only on bubbles).
 * - Each bubble points (tail) at its target field: elements marked `data-ocr-field="<key>"` inside the voucher form.
 *   Missing anchor -> bubble attaches to the OCR bar (`data-pl-ocr-refresh-bar`).
 * - Target field gets a pink attention ring while its bubble is shown.
 * - Repositions on scroll (capture) / resize / layout changes.
 * - Mobile (< 640px): one bubble at a time with Prev / Next.
 * - Stacking: above AddVoucherDialog content (z-81), below nested master-create dialogs (z-92+) that bubbles open.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OcrSuggestion } from "./OcrSuggestionsDialog";
import { useOcrPrefs } from "./prefs";

export const OCR_BUBBLE_Z_CN = "z-[85]";
const RING = ["ring-2", "ring-pink-500", "ring-offset-1", "rounded-md", "transition-shadow"];

/** Suggestion id -> form field anchor key. */
export function ocrFieldForSuggestion(id: string): string {
  if (id === "switch" || id.startsWith("switch-")) return "voucher-type";
  if (id === "create-party" || id === "find-party") return "party";
  if (id === "date") return "date";
  if (id === "due") return "due-date";
  if (id === "create-vat" || id === "vat") return "tax";
  if (id === "create-ledger" || id === "ledger") return "ledger";
  if (id === "disc") return "discount";
  if (id.startsWith("amount")) return "amount";
  if (id === "billno") return "bill-no";
  if (id === "account" || id.startsWith("account-")) return "account";
  if (id === "cannot-detect" || id === "status-failed" || id === "duplicate-ref") return "voucher-type";
  return "lines"; // lines, create-item-*, tds, drcr
}

/** Missing-field label (from the hook) -> anchor key. */
export function ocrFieldForMissing(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith("party")) return "party";
  if (l.startsWith("bank") || l.startsWith("account")) return "account";
  if (l.startsWith("other charge")) return "amount";
  if (l.startsWith("date")) return "date";
  if (l.includes("vat") || l.includes("tax")) return "tax";
  if (l.startsWith("line")) return "lines";
  if (l.startsWith("total")) return "total";
  if (l.startsWith("amount")) return "amount";
  if (l.startsWith("bill")) return "bill-no";
  return "lines";
}

export type OcrBubble = {
  key: string; // field anchor
  /** Optional precise anchor (`data-ocr-anchor` value), tried before `data-ocr-field=key`; e.g. "voucher-type-purchase". */
  anchor?: string;
  kind: "suggest" | "missing";
  title: string;
  items: OcrSuggestion[];
  /** Auto-switch countdown (seconds left) shown on the primary "Switch" button. */
  countdown?: number;
};

function findAnchor(key: string, anchor?: string): HTMLElement | null {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // "lines#N" -> item combobox of line N (N-th visible `data-ocr-field="lines"` cell)
  const m = anchor?.match(/^lines#(\d+)$/);
  if (m) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-field="lines"]`)).filter(vis);
    const n = Number(m[1]);
    if (rows[n]) return rows[n];
    if (rows.length) return rows[0];
  }
  if (anchor && !m) {
    const exact = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-anchor="${anchor}"]`)).filter(vis);
    if (exact.length) return exact[exact.length - 1];
  }
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-ocr-field="${key}"]`)).filter(vis);
  if (all.length) return all[all.length - 1];
  return null;
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
const W = 300;
const GAP = 12;

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

/** Collision avoidance: nudge this bubble away from bubbles rendered BEFORE it (DOM order) so no two overlap.
 *  top/bottom bubbles slide horizontally (then vertically if no room), left/right slide vertically;
 *  the tail is recomputed so it still aims at this bubble's own anchor. Mutates p (host-relative coords). */
function avoidOverlap(p: Pos, el: HTMLElement, anchor: HTMLElement | null, aimStart = false) {
  const host = el.parentElement?.parentElement ?? null;
  const o = hostOffset(host);
  const w = el.offsetWidth || W;
  const h = el.offsetHeight || 120;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // all OTHER bubbles (both directions; earlier bubbles have priority, later ones are re-checked every tick)
  const others: DOMRect[] = [];
  for (let n = el.previousElementSibling; n; n = n.previousElementSibling) {
    if ((n as HTMLElement).dataset?.ocrBubble !== undefined) others.unshift(n.getBoundingClientRect());
  }
  if (el.dataset.ocrBubble !== "voucher-type") {
    for (const tr of Array.from(document.querySelectorAll<HTMLElement>('[data-ocr-field="voucher-type"]'))) {
      const r = tr.getBoundingClientRect();
      if (r.width > 0) others.push(r);
    }
  }
  if (!others.length) return;
  const M = 8;
  const hit = (l: number, t: number) => others.find((r) => l < r.right + M && l + w > r.left - M && t < r.bottom + M && t + h > r.top - M);
  let l = p.left + o.x;
  let t = p.top + o.y;
  const origL = l, origT = t;
  for (let guard = 0; guard < 16; guard++) {
    const r = hit(l, t);
    if (!r) break;
    const step = 12 + guard * 8; // push farther as needed so leaders can grow
    if (p.side === "top" || p.side === "bottom") {
      const toLeft = r.left - M - w;
      const toRight = r.right + M;
      const preferLeft = Math.abs((toLeft + w / 2) - (origL + w / 2)) <= Math.abs((toRight + w / 2) - (origL + w / 2));
      if (preferLeft && toLeft >= 8) l = toLeft;
      else if (toRight + w <= vw - 8) l = toRight;
      else if (toLeft >= 8) l = toLeft;
      else {
        t = p.side === "top" ? Math.max(8, r.top - M - h - step) : Math.min(vh - h - 8, r.bottom + M + step);
      }
    } else {
      const up = r.top - M - h - step;
      t = up >= 8 ? up : r.bottom + M + step;
    }
    l = Math.max(8, Math.min(l, vw - w - 8));
    t = Math.max(8, Math.min(t, vh - h - 8));
  }
  p.left = l - o.x;
  p.top = t - o.y;
  if (anchor) {
    const ar = anchor.getBoundingClientRect();
    p.tail = p.side === "top" || p.side === "bottom"
      ? Math.max(16, Math.min((aimStart ? ar.left + Math.min(ar.width / 2, 48) : ar.left + ar.width / 2) - l, w - 16))
      : Math.max(16, Math.min(ar.top + ar.height / 2 - t, h - 16));
  }
}

type Leader = { x1: number; y1: number; x2: number; y2: number };

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
 * Tail geometry after the bubble has been placed and pushed by collision avoidance.
 * Length = distance from the nearest corner/side of the rectangle to the closest point on the field.
 * Recomputed in update() (layout, scroll, resize, 400ms tick, after avoidOverlap).
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
  const tipV = closestOnRect(attach.x, attach.y, ar);
  const length = Math.hypot(tipV.x - attach.x, tipV.y - attach.y);
  if (length < 8) return null;
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
function BubbleView({
  b,
  onApply,
  onDismiss,
  nav,
  scrollOnMount,
  stack = 0,
}: {
  b: OcrBubble;
  onApply: (s: OcrSuggestion) => void;
  onDismiss: () => void;
  nav?: { i: number; n: number; prev: () => void; next: () => void };
  scrollOnMount: boolean;
  /** n-th bubble resolving to the same anchor element -> stacked, not drawn on top of each other. */
  stack?: number;
}) {
  const connectorStyle = useOcrPrefs().connectorStyle === "line" ? "line" : "tail";
  const [pos, setPos] = useState<Pos | null>(null);
  const [leader, setLeader] = useState<Leader | null>(null);
  const [tail, setTail] = useState<TailGeom | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  const update = useCallback(() => {
    const a = findAnchor(b.key, b.anchor);
    // non-switch bubbles must not cover the voucher-type tab row
    const avoid = b.key === "voucher-type" ? [] : Array.from(document.querySelectorAll<HTMLElement>('[data-ocr-field="voucher-type"]')).map((x) => x.getBoundingClientRect()).filter((x) => x.width > 0);
    const p = place(a ?? fallbackAnchor(), !a, el?.offsetHeight || 120, el?.parentElement?.parentElement ?? null, !!a && b.key === "lines", avoid);
    if (p && stack) {
      const dy = stack * ((el?.offsetHeight || 120) + 10);
      p.top += p.side === "top" ? -dy : dy;
    }
    const anchor = a ?? fallbackAnchor();
    if (p && el) avoidOverlap(p, el, anchor, b.key === "lines");
    setPos(p);
    const host = el?.parentElement?.parentElement ?? null;
    if (p && el) {
      setLeader(leaderPoints(p, el, a, host));
      setTail(computeTailGeom(p, el, a, host));
    } else { setLeader(null); setTail(null); }
  }, [b.key, b.anchor, el]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const a = findAnchor(b.key, b.anchor);
    if (a) {
      a.classList.add(...RING);
      if (scrollOnMount) a.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    const on = () => update();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    const t = window.setInterval(on, 400); // layout shifts (rows added, dialogs resized)
    return () => {
      a?.classList.remove(...RING);
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
      window.clearInterval(t);
    };
  }, [b.key, b.anchor, update, scrollOnMount]);

  const missing = b.kind === "missing";
  const party = b.items.find((s) => s.id === "create-party");
  const pick = b.items.find((s) => s.id === "find-party");
  const border = missing ? "#fcd34d" : "#f9a8d4";
  const pill = "h-7 rounded-full px-3 text-xs";

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
        width: Math.min(W, typeof window !== "undefined" ? window.innerWidth - 16 : W),
        visibility: pos ? "visible" : "hidden",
        background: connectorStyle === "line" ? "#ffffff" : "transparent",
        opacity: 1,
        border: `1px solid ${connectorStyle === "line" ? border : "transparent"}`,
        borderRadius: 16,
        boxShadow: "0 10px 30px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,0.08)",
        padding: 12,
        isolation: "isolate",
        zIndex: 2147483000,
      }}
    >
      {connectorStyle === "line"
        ? (leader && pos ? <LeaderLine line={{ x1: leader.x1 - pos.left, y1: leader.y1 - pos.top, x2: leader.x2 - pos.left, y2: leader.y2 - pos.top }} color={border} /> : null)
        : (pos && el ? <BubbleChrome w={el.offsetWidth || W} h={el.offsetHeight || 120} tail={tail} color={border} fill="#ffffff" /> : null)}
      <div className="relative" style={{ zIndex: 2, background: connectorStyle === "line" ? "#ffffff" : "transparent" }}>
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-medium leading-snug">
            {b.title}
            {pos?.fallback ? <span className="block text-[11px] font-normal text-slate-500">(field not on screen)</span> : null}
          </p>
          <button type="button" aria-label="Dismiss" className="-mr-1 -mt-1 rounded-full p-1 text-slate-500 hover:bg-slate-100" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {missing ? (
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" className={pill} onClick={onDismiss}>OK</Button>
          </div>
        ) : party ? (
          <div className="mt-1.5">
            <p className="break-words text-xs text-slate-500">{party.value}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className={pill} onClick={() => onApply(party)}>Create</Button>
              {pick ? <Button type="button" size="sm" variant="outline" className={pill} onClick={() => onApply(pick)}>Pick existing</Button> : null}
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        ) : b.items.length === 1 ? (
          <div className="mt-1.5">
            <p className="break-words text-xs text-slate-500">{b.items[0].value}</p>
            {b.items[0].reason ? <p className="text-[11px] text-slate-500">{b.items[0].reason}</p> : null}
            {b.items[0].blocked ? <p className="text-[11px] text-amber-700">{b.items[0].blocked}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!b.items[0].blocked ? <Button type="button" size="sm" className={pill} onClick={() => onApply(b.items[0])}>{b.items[0].id === "switch" || b.items[0].id.startsWith("switch-") ? (b.items[0].id === "switch" && b.countdown != null ? `Switch (${b.countdown})` : "Switch") : b.items[0].deferred ? "Open" : "Apply"}</Button> : null}
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            {b.items.map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="break-words text-[11px] text-slate-500">{s.value}</p>
                  {s.blocked ? <p className="text-[11px] text-amber-700">{s.blocked}</p> : null}
                </div>
                {!s.blocked ? <Button type="button" size="sm" variant="outline" className="h-6 rounded-full px-2.5 text-[11px]" onClick={() => onApply(s)}>{s.id === "switch" || s.id.startsWith("switch-") ? (s.id === "switch" && b.countdown != null ? `Switch (${b.countdown})` : "Switch") : s.deferred ? "Open" : "Apply"}</Button> : null}
              </div>
            ))}
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" className={pill} onClick={onDismiss}>Dismiss</Button>
            </div>
          </div>
        )}

        {nav && nav.n > 1 ? (
          <div className="mt-2 flex items-center justify-between border-t pt-1.5 text-[11px] text-slate-500">
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
}: {
  bubbles: OcrBubble[];
  onApply: (s: OcrSuggestion) => void;
  onDismiss: (b: OcrBubble) => void;
}) {
  const [mobile, setMobile] = useState(false);
  const [idx, setIdx] = useState(0);
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
  // bubbles sharing one anchor (missing field -> all fall back to the OCR bar) get a stack index
  const seen = new Map<string, number>();
  const stackOf = shown.map((b) => {
    const k = typeof document !== "undefined" && findAnchor(b.key, b.anchor) ? b.key : "__fallback__";
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  });
  if (typeof document === "undefined" || !bubbles.length) return null;
  const host = (fallbackAnchor()?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 2147483000 }} data-ocr-bubbles="">
      {shown.map((b, i) => (
        <BubbleView
          key={`${b.kind}:${b.key}:${b.anchor ?? ""}`}
          b={b}
          onApply={onApply}
          onDismiss={() => onDismiss(b)}
          scrollOnMount={mobile || i === 0}
          stack={mobile ? 0 : stackOf[i]}
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
