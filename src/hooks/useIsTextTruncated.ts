"use client";

import { useLayoutEffect, useState, type DependencyList, type RefObject } from "react";

const MASTER_LIST_NAME_MEASURE_SELECTOR = "[data-pl-master-list-name-measure]";

function elementIsTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

function measureTruncation(root: HTMLElement): boolean {
  const marked = root.querySelectorAll<HTMLElement>(MASTER_LIST_NAME_MEASURE_SELECTOR);
  if (marked.length > 0) {
    return Array.from(marked).some(elementIsTruncated);
  }
  return elementIsTruncated(root);
}

/**
 * True when text overflows (ellipsis / …) — ResizeObserver + window resize; web/exe/apk.
 *
 * Loop-safety notes (Party Statement "Maximum update depth"):
 *  - `setIsTruncated` sirf tab chalta hai jab value actually badle (functional updater).
 *  - Ref mount hone se pehle early-return; pehla measurement next frame par retry hota hai, isliye
 *    mount commit ke andar synchronous setState nahi hota.
 */
export function useIsTextTruncated(
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList = []
) {
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    let frame = 0;
    let ro: ResizeObserver | null = null;
    let disposed = false;
    let resizeHandler: (() => void) | null = null;

    const apply = (next: boolean) => {
      if (disposed) return;
      // Same value par state write nahi — observer ↔ render loop band.
      setIsTruncated((prev) => (prev === next ? prev : next));
    };

    const attach = () => {
      if (disposed) return;
      const root = ref.current;
      // Ref abhi attached nahi: render ke dauran setState na karo, agle frame par dubara try karo.
      if (!root) {
        frame = requestAnimationFrame(attach);
        return;
      }

      const update = () => {
        if (disposed) return;
        apply(measureTruncation(root));
      };

      update();

      ro = new ResizeObserver(() => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
        else update();
      });
      ro.observe(root);
      let node: HTMLElement | null = root.parentElement;
      for (let depth = 0; depth < 4 && node; depth += 1) {
        ro.observe(node);
        node = node.parentElement;
      }

      resizeHandler = update;
      window.addEventListener("resize", update);
    };

    attach();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return isTruncated;
}
