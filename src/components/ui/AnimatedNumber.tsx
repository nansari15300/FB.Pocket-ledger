
"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, type ReactNode, useState } from "react";

/**
 * `formatter` prop aksar inline arrow hota hai (`(n) => format(n, options)`) — matlab har render
 * par naya function. Usko seedha effect dependency banane se render -> setState -> render ka
 * "Maximum update depth exceeded" loop banta hai. Isliye hum formatter ko sirf ref me rakhte hain
 * aur uske badalne par text **layout ke bahar** (microtask) update karte hain — ek hi baar.
 */
export default function AnimatedNumber({ value, formatter, duration = 1 }: { value: number, formatter: (n: number) => ReactNode, duration?: number }) {
  const formatterRef = useRef(formatter);
  formatterRef.current = formatter;
  const currentValueRef = useRef(0);
  const hasMountedRef = useRef(false);
  const [displayValue, setDisplayValue] = useState<ReactNode>(() => formatter(0));
  /**
   * Aakhri baar render hua text. Agar naya formatted output bilkul same string hai, to state set
   * hi nahi karte — warna formatter har render par naya banne se loop chalta rehta hai.
   */
  const lastTextRef = useRef<string | null>(null);

  const applyFormatted = (nextValue: number) => {
    const node = formatterRef.current(nextValue);
    const text = typeof node === "string" || typeof node === "number" ? String(node) : null;
    if (text !== null && text === lastTextRef.current) return;
    lastTextRef.current = text;
    setDisplayValue(node);
  };

  /** Formatter badalne par current value ka naya text — ek hi deferred update, loop nahi. */
  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      applyFormatted(currentValueRef.current);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatter]);
  
  useEffect(() => {
    let raf = 0;
    const isFirst = !hasMountedRef.current;
    hasMountedRef.current = true;
    const start = isFirst ? 0 : currentValueRef.current;
    const end = Number(value) || 0;
    const durationMs = Math.max(0, Number(duration) || 0) * 1000;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (durationMs <= 0 || start === end) {
      currentValueRef.current = end;
      applyFormatted(end);
      return;
    }
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = start + (end - start) * eased;
      currentValueRef.current = next;
      applyFormatted(next);
      if (progress < 1) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <motion.span>
      {displayValue}
    </motion.span>
  );
}
