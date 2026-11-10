"use client";
/** Auto Post countdown bubble: floats ABOVE the visible Save (submit) button with a down-pointing arrow + cancel (x). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { OCR_LAYER_Z } from "./prefs";

function findSaveButton(): HTMLElement | null {
  const vis = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const all = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"]')).filter(vis);
  const save = all.filter((b) => /save/i.test(b.textContent || ""));
  const list = save.length ? save : all;
  return list.length ? list[list.length - 1] : null;
}

export function AutoPostCountdownBubble({ seconds, onCancel }: { seconds: number; onCancel: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const b = findSaveButton();
      if (b) {
        const r = b.getBoundingClientRect();
        setPos((p) => (p && p.x === r.left + r.width / 2 && p.y === r.top ? p : { x: r.left + r.width / 2, y: r.top }));
      } else setPos(null);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  if (typeof document === "undefined") return null;
  const left = pos ? Math.min(Math.max(pos.x, 110), window.innerWidth - 110) : window.innerWidth / 2;
  const style: React.CSSProperties = pos
    ? { position: "fixed", left, top: pos.y - 10, transform: "translate(-50%, -100%)", zIndex: OCR_LAYER_Z + 1 }
    : { position: "fixed", left, bottom: 16, transform: "translateX(-50%)", zIndex: OCR_LAYER_Z + 1 };
  return createPortal(
    <div style={style} className="pointer-events-auto" data-pl-autopost-bubble="" role="status" aria-live="polite">
      <div className="relative flex items-center gap-2 rounded-lg border border-emerald-500/60 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 shadow-lg dark:bg-emerald-950 dark:text-emerald-100">
        <span className="whitespace-nowrap font-medium">Auto save is active</span>
        <span className="whitespace-nowrap tabular-nums">Saving in {seconds}s</span>
        <button type="button" onClick={onCancel} title="Cancel auto save" aria-label="Cancel auto save" className="rounded-full p-0.5 hover:bg-emerald-200/70 dark:hover:bg-emerald-800">
          <X className="h-3.5 w-3.5" />
        </button>
        {pos ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950"
            style={{ marginLeft: pos.x - left }}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
}