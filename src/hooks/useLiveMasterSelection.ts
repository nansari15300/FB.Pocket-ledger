"use client";

import { useEffect } from "react";
import {
  mergeLiveMasterSelection,
  resolveMasterListSelection,
} from "@/lib/masterEntityLiveUpdate";

/**
 * List already live-patches `processed*`. Details / mobile header often keep the click
 * snapshot in `selected`. Re-resolve from the live list and write it back when profile
 * fields (name, phone, group, …) change — same row, no extra navigation.
 */
export function useLiveMasterSelection<T extends { id: string }>(
  selected: T | null,
  setSelected: (item: T | null) => void,
  processed: readonly T[] | undefined
): T | null {
  const live = resolveMasterListSelection(selected, processed);

  useEffect(() => {
    if (!selected?.id || !live) return;
    if (selected === live) return;
    const merged = mergeLiveMasterSelection(
      selected as unknown as Record<string, unknown>,
      live as unknown as Record<string, unknown>
    );
    if (!merged) return;
    setSelected(merged as unknown as T);
  }, [selected, live, setSelected]);

  return live;
}
