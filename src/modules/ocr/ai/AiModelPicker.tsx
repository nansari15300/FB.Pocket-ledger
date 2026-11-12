"use client";
/**
 * Model picker for the AI chat input (Cursor-style): a small pill inside the composer that opens a
 * searchable list. Admin: switches the company's Gemini model via /api/ocr-cloud/ai-model (server tests it
 * first). Non-admin: the pill only shows the current model, disabled.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OcrAiModelOption } from "./aiClient";

export function AiModelPicker({
  current,
  models,
  canChange,
  busy,
  error,
  onPick,
}: {
  current: string;
  models: OcrAiModelOption[];
  canChange: boolean;
  busy?: boolean;
  error?: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [box, setBox] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** Place the list above the composer row and as wide as the text field it sits in. */
  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const field = el.closest("[data-pl-ai-composer-field]") as HTMLElement | null;
    const fr = field ? field.getBoundingClientRect() : r;
    // Narrow list (like Cursor): open just above the pill and never wider than ~340px.
    const width = Math.max(200, Math.min(268, fr.width));
    let left = fr.right - width;
    if (left < 8) left = 8;
    setBox({ left, bottom: window.innerHeight - r.top + 8, width });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (boxRef.current && !boxRef.current.contains(t)) { setOpen(false); setQ(""); }
    };
    const onResize = () => measure();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  const labelOf = (id: string) => models.find((m) => m.id === id)?.label || id;
  const list = models.filter((m) => {
    const s = `${m.label} ${m.id} ${m.note || ""}`.toLowerCase();
    return !q.trim() || s.includes(q.trim().toLowerCase());
  });

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        disabled={!canChange || busy}
        title={canChange ? "Change Gemini model (admin)" : "Only an admin can change the model"}
        onClick={() => { setOpen((v) => !v); setQ(""); }}
        className={cn(
          "flex h-7 w-[150px] items-center justify-between gap-1 rounded-full border border-black/10 bg-slate-100/80 px-2.5 text-[11px] text-slate-600 transition",
          canChange && "hover:border-black/20 hover:bg-slate-200/70",
          (!canChange || busy) && "cursor-default opacity-80"
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
          <span className="truncate">{labelOf(current)}</span>
        </span>
        {canChange && !busy ? <ChevronDown className={cn("h-3 w-3 shrink-0 transition", open && "rotate-180")} /> : null}
      </button>

      {open && canChange && box ? createPortal(
        <div
          ref={boxRef}
          style={{ position: "fixed", left: box.left, bottom: box.bottom, width: box.width, zIndex: 2147483600 }}
          className="overflow-hidden rounded-xl border border-black/10 bg-white text-[11px] shadow-xl"
        >
          <div className="flex items-center gap-1.5 border-b border-black/5 px-2.5 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setQ(""); }
                if (e.key === "Enter" && list[0]) { onPick(list[0].id); setOpen(false); setQ(""); }
              }}
              placeholder="Search models"
              className="w-full bg-transparent text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none"
            />
          </div>
          <ul className="max-h-[220px] overflow-y-auto py-1">
            {list.length === 0 ? (
              <li className="px-3 py-3 text-center text-[11px] text-slate-400">No match</li>
            ) : list.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => { onPick(m.id); setOpen(false); setQ(""); }}
                  className={cn(
                    "flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition hover:bg-slate-50",
                    m.id === current && "bg-[#e0f2fe]/60"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-slate-800">{m.label}</span>
                    <span className="block truncate text-[10px] text-slate-400">{m.note || m.id}</span>
                  </span>
                  {m.id === current ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0ea5e9]" /> : null}
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="border-t border-black/5 px-2.5 py-1.5 text-[10px] text-red-600">{error}</p> : null}
          <p className="border-t border-black/5 px-2.5 py-1 text-[9px] leading-snug text-slate-400">
            Admin only · applies to the whole company
          </p>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
