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

/** True when text overflows (ellipsis / …) — ResizeObserver + window resize; web/exe/apk. */
export function useIsTextTruncated(
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList = []
) {
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) {
      setIsTruncated(false);
      return;
    }

    const update = () => {
      const next = measureTruncation(root);
      // Same value par setState call mat karo — observer/render loop se "Maximum update depth" bachta hai.
      setIsTruncated((prev) => (prev === next ? prev : next));
    };

    update();

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(update);
    });
    ro.observe(root);
    let node: HTMLElement | null = root.parentElement;
    for (let depth = 0; depth < 4 && node; depth += 1) {
      ro.observe(node);
      node = node.parentElement;
    }

    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return isTruncated;
}
