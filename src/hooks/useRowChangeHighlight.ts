"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";

/** CSS class (src/styles/animation-gate.css) — ~1s primary-tint fade on the row. */
export const ROW_CHANGE_HIGHLIGHT_CLASS = "pl-row-change-highlight";

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Shallow signature: top-level primitive / Date / Timestamp fields only (cheap, ignores nested arrays). */
export function defaultRowChangeSignature(row: unknown): string {
  if (row == null || typeof row !== "object") return String(row);
  const rec = row as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(rec).sort()) {
    const v = rec[key];
    if (v == null) {
      parts.push(`${key}=`);
      continue;
    }
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
      parts.push(`${key}=${String(v)}`);
    } else if (v instanceof Date) {
      parts.push(`${key}=${v.getTime()}`);
    } else if (t === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
      try {
        parts.push(`${key}=${(v as { toMillis: () => number }).toMillis()}`);
      } catch {
        /* ignore */
      }
    }
  }
  return parts.join("|");
}

export type RowChangeHighlightOptions<T> = {
  getId: (row: T) => string | number | null | undefined;
  /** Defaults to `defaultRowChangeSignature`. */
  getSignature?: (row: T) => string;
  /** Extra switch (Row Animation setting is always respected). */
  enabled?: boolean;
  /** Change → re-baseline without highlighting (e.g. page / filter / company change). */
  resetKey?: unknown;
  durationMs?: number;
};

/**
 * Highlights rows that were newly added or whose data changed (~1s background fade).
 * Not on initial mount / first data load, not on sort-only reorders (same ids + data),
 * not when `resetKey` changes, not on bulk changes (> max(3, 25% of rows) — e.g. reload/import),
 * and never when Settings → Animation → Row Animation is off.
 */
export function useRowChangeHighlight<T>(
  rows: readonly T[] | null | undefined,
  options: RowChangeHighlightOptions<T>
) {
  const { settings, loading } = useAnimationSettings();
  const animationsOn = !loading && settings?.rows?.enabled === true;
  const active = animationsOn && options.enabled !== false;
  const durationMs = Math.max(200, Number(options.durationMs ?? 1000) || 1000);
  const resetKey = options.resetKey;

  const getIdRef = useRef(options.getId);
  const getSignatureRef = useRef(options.getSignature);
  // Latest callbacks (callers pass inline arrows) — layout effect runs before the diff effect below.
  useLayoutEffect(() => {
    getIdRef.current = options.getId;
    getSignatureRef.current = options.getSignature;
  });

  const seenRef = useRef<Map<string, string> | null>(null);
  const resetKeyRef = useRef<unknown>(resetKey);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(EMPTY_SET);

  useEffect(() => {
    const list = rows ?? [];
    const getId = getIdRef.current;
    const getSignature = getSignatureRef.current ?? defaultRowChangeSignature;
    const next = new Map<string, string>();
    for (const row of list) {
      const rawId = getId(row);
      if (rawId === null || rawId === undefined || rawId === "") continue;
      next.set(String(rawId), getSignature(row));
    }

    const prev = seenRef.current;
    const didReset = !Object.is(resetKeyRef.current, resetKey);
    resetKeyRef.current = resetKey;

    // Accumulate (filters/search hide rows temporarily; when they return they're not "new").
    const merged = didReset || !prev ? new Map<string, string>() : new Map(prev);
    for (const [id, sig] of next) merged.set(id, sig);
    seenRef.current = merged;

    if (!prev || prev.size === 0 || didReset || !active) return;

    const changed: string[] = [];
    for (const [id, sig] of next) {
      const before = prev.get(id);
      if (before === undefined || before !== sig) changed.push(id);
    }
    if (changed.length === 0) return;
    const bulkLimit = Math.max(3, Math.ceil(next.size * 0.25));
    if (changed.length > bulkLimit) return;

    // Diff against the previous rows is only known after commit → state update here is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIds((cur) => {
      const n = new Set(cur);
      for (const id of changed) n.add(id);
      return n;
    });
    for (const id of changed) {
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setHighlightedIds((cur) => {
          if (!cur.has(id)) return cur;
          const n = new Set(cur);
          n.delete(id);
          return n.size ? n : EMPTY_SET;
        });
      }, durationMs + 50);
      timersRef.current.set(id, timer);
    }
  }, [rows, active, resetKey, durationMs]);

  // Setting turned off → drop any running highlight immediately.
  useEffect(() => {
    if (active) return;
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIds((cur) => (cur.size ? EMPTY_SET : cur));
  }, [active]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const highlightClassName = useCallback(
    (id: string | number | null | undefined): string | undefined =>
      id !== null && id !== undefined && highlightedIds.has(String(id)) ? ROW_CHANGE_HIGHLIGHT_CLASS : undefined,
    [highlightedIds]
  );

  return { highlightedIds, highlightClassName };
}