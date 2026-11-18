"use client";

/**
 * Save-button bubble for the duplicate-voucher guard.
 *
 * Do jagah se use hota hai:
 *  1. Live (pre-save): form complete hote hi guard chalta hai aur bubble Save button ko point karta hai —
 *     user ko click karne se pehle hi pata chal jata hai ki ye entry already maujood hai.
 *  2. Confirm (save pe): Save dabane par wahi warning block karti hai (Save anyway / Cancel).
 *
 * Bubble portal me render hota hai taaki voucher dialog ke stacking context se bahar rahe, aur
 * position `data-dup-anchor="save"` element se live measure hoti hai (scroll/resize par bhi follow).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DuplicateMatch } from "@/lib/voucherDuplicateGuard";
import { useAutoOcrDuplicatePolicy } from "@/hooks/useAutoOcrDuplicatePolicy";
import { claimDuplicateAutoMove, isDuplicateAutoMoveClaimed } from "@/lib/galleryDuplicateMove";
import { AUTO_POST_PAUSE_CAUSE_RESOLVED } from "@/components/gallery/autoPostPauseResume";

export const DUP_ANCHOR_ATTR = "data-dup-anchor";
export const DUP_SAVE_ANCHOR = "save";

/** Voucher dialog se upar, OCR bubbles (100) aur master dialogs (121) se neeche. */
const DUP_LAYER_Z = 95;

type Pos = { top: number; left: number; placement: "top" | "bottom" };

function findAnchor(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[${DUP_ANCHOR_ATTR}="${DUP_SAVE_ANCHOR}"]`));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function measure(el: HTMLElement | null, width: number, height: number): Pos {
  if (typeof window === "undefined") return { top: 0, left: 0, placement: "top" };
  if (!el) {
    // Anchor nahi mila (mobile footer collapse): screen ke bottom-center ke thoda upar.
    return { top: Math.max(12, window.innerHeight - height - 96), left: Math.max(12, window.innerWidth / 2 - width / 2), placement: "top" };
  }
  const r = el.getBoundingClientRect();
  const gap = 10;
  const above = r.top - height - gap;
  const placement: "top" | "bottom" = above >= 12 ? "top" : "bottom";
  const preferredTop = placement === "top" ? above : r.bottom + gap;
  const maxTop = Math.max(12, window.innerHeight - Math.min(height, window.innerHeight - 24) - 12);
  const top = Math.min(Math.max(12, preferredTop), maxTop);
  const centerX = r.left + r.width / 2;
  const left = Math.min(Math.max(12, centerX - width / 2), Math.max(12, window.innerWidth - width - 12));
  return { top, left, placement };
}

function emitDuplicateCauseResolved() {
  window.dispatchEvent(new CustomEvent(AUTO_POST_PAUSE_CAUSE_RESOLVED, {
    detail: { kind: "duplicate" },
  }));
}

export function DuplicateVoucherBubble({
  match,
  mode,
  onSaveAnyway,
  onDismiss,
  onOpen,
  onMoveToDuplicate,
  moveBusy,
  canAutoMove = false,
}: {
  match: DuplicateMatch;
  /** `live` = save se pehle ki warning (sirf dismiss), `confirm` = Save roka gaya (Save anyway). */
  mode: "live" | "confirm";
  onSaveAnyway?: () => void;
  onDismiss: () => void;
  /** "Open" — existing voucher kholna (agar caller support kare). */
  onOpen?: (id: string) => void;
  /** Slip unassigned/attached pool se Duplicate tab me bhejna. */
  onMoveToDuplicate?: () => void;
  moveBusy?: boolean;
  /** True when an Unassigned/gallery attachment can be moved automatically. */
  canAutoMove?: boolean;
}) {
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0, placement: "top" });
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 340, h: 200 });
  const skipResolveOnUnmountRef = useRef(false);

  useLayoutEffect(() => {
    const measureNow = () => {
      const el = findAnchor();
      const width = Math.min(380, Math.max(260, window.innerWidth - 24));
      setBox((prev) => (prev.w === width ? prev : { ...prev, w: width }));
      setPos(measure(el, width, box.h));
    };
    measureNow();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureNow) : null;
    const anchorEl = findAnchor();
    if (ro && anchorEl) ro.observe(anchorEl);
    window.addEventListener("resize", measureNow);
    window.addEventListener("scroll", measureNow, true);
    const id = window.setInterval(measureNow, 600); // collapse/expand, dynamic layout
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measureNow);
      window.removeEventListener("scroll", measureNow, true);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.h]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { skipResolveOnUnmountRef.current = true; onDismiss(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);


  useEffect(() => {
    return () => {
      if (skipResolveOnUnmountRef.current) return;
      if (!findAnchor()) return;
      emitDuplicateCauseResolved();
    };
  }, []);
  const policy = useAutoOcrDuplicatePolicy();
  const hideForAutoPolicy = mode === "live" && policy.ready && (
    policy.duplicateVoucherAction === "save-anyway" ||
    (policy.duplicateVoucherAction === "move-to-duplicates" && !!canAutoMove && !!onMoveToDuplicate)
  );

  useEffect(() => {
    if (mode !== "live") return;
    const onHandled = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId?: string }>).detail;
      if (String(detail?.matchId || "") === String(match.id)) { skipResolveOnUnmountRef.current = true; onDismiss(); }
    };
    window.addEventListener("pl:gallery:auto-post-duplicate-action-completed", onHandled);
    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-detected", {
      detail: {
        matchId: match.id,
        voucherNumber: match.voucherNumber,
        summary: match.summary,
        dateText: match.dateText,
        amount: String(match.amount ?? ""),
        reasons: match.reasons,
      },
    }));
    return () => window.removeEventListener("pl:gallery:auto-post-duplicate-action-completed", onHandled);
  }, [match, mode, onDismiss]);

  useEffect(() => {
    if (mode !== "live" || !policy.ready) return;
    if (policy.duplicateVoucherAction === "save-anyway") {
      skipResolveOnUnmountRef.current = true;
      onDismiss();
      return;
    }
    if (policy.duplicateVoucherAction !== "move-to-duplicates" || !canAutoMove || !onMoveToDuplicate) return;
    const timer = window.setTimeout(() => {
      if (isDuplicateAutoMoveClaimed(match.id)) {
        skipResolveOnUnmountRef.current = true;
        onDismiss();
        return;
      }
      if (!claimDuplicateAutoMove(match.id)) return;
      skipResolveOnUnmountRef.current = true;
      onMoveToDuplicate();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canAutoMove, match.id, mode, onDismiss, onMoveToDuplicate, policy.duplicateVoucherAction, policy.ready]);

  if (typeof document === "undefined") return null;
  if (hideForAutoPolicy) return null;

  const reasonText = match.reasons
    .map((r) => (r === "file" ? "same file" : r === "ref" ? "same reference" : r === "fields" ? "same date + amount" : "same narration"))
    .join(", ");

  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: DUP_LAYER_Z }} data-dup-bubble="">
      <div
        ref={(el) => {
          if (el && Math.abs(el.offsetHeight - box.h) > 1) setBox((p) => ({ ...p, h: el.offsetHeight }));
        }}
        role="alertdialog"
        aria-live="polite"
        className="pointer-events-auto fixed max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border-2 border-amber-400 bg-background p-3 shadow-2xl"
        style={{ top: pos.top, left: pos.left, width: box.w }}
      >
        {/* Tail — Save button ki taraf */}
        <span
          aria-hidden
          className="absolute h-3 w-3 rotate-45 border-amber-400 bg-background"
          style={{
            [pos.placement === "top" ? "bottom" : "top"]: -7,
            left: "50%",
            marginLeft: -6,
            borderLeftWidth: pos.placement === "top" ? 2 : 0,
            borderTopWidth: pos.placement === "top" ? 2 : 0,
            borderRightWidth: pos.placement === "bottom" ? 2 : 0,
            borderBottomWidth: pos.placement === "bottom" ? 2 : 0,
          }}
        />
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-amber-700">Possible duplicate voucher</div>
          <button type="button" onClick={() => { skipResolveOnUnmountRef.current = true; onDismiss(); }} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            ×
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{match.summary}</p>
        <div className="mt-2 space-y-0.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <div><span className="opacity-70">Voucher: </span><b>{match.voucherNumber}</b></div>
          <div><span className="opacity-70">Date: </span>{match.dateText}<span className="opacity-70"> · Amount: </span>{match.amount}</div>
          <div><span className="opacity-70">Matched on: </span>{reasonText}</div>
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          {onOpen ? (
            <button type="button" className="rounded-md border px-2 py-1 text-[11px]" onClick={() => onOpen(match.id)}>
              Open
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-amber-400 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950/40"
            disabled={!!moveBusy}
            onClick={() => {
              skipResolveOnUnmountRef.current = true;
              if (onMoveToDuplicate) {
                onMoveToDuplicate();
                return;
              }
              // Auto-post review dialogs handle this request in the gallery runner.
              window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-duplicate-move-requested", {
                detail: {
                  matchId: match.id,
                  voucherNumber: match.voucherNumber,
                  summary: match.summary,
                  dateText: match.dateText,
                  amount: String(match.amount ?? ""),
                  reasons: match.reasons,
                },
              }));
            }}
          >
            {moveBusy ? "Moving…" : "Cancel & Move to Duplicate"}
          </button>
          <button type="button" className="rounded-md border px-2 py-1 text-[11px]" onClick={() => { skipResolveOnUnmountRef.current = true; onDismiss(); }}>
            {mode === "live" ? "Dismiss" : "Cancel"}
          </button>
          {mode === "confirm" && onSaveAnyway ? (
            <button
              type="button"
              className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
              onClick={() => {
                skipResolveOnUnmountRef.current = true;
                emitDuplicateCauseResolved();
                onSaveAnyway();
              }}
            >
              Save anyway
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
