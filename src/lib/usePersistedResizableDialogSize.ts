"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_W = 480;
const MIN_H = 400;

export const ITEM_MASTER_DIALOG_SIZE_STORAGE_KEY = "pl-item-master-dialog-size-v2";

export const ITEM_MASTER_DIALOG_DEFAULT_SIZE = {
  w: Math.round(14 * 96),
  h: Math.round(12 * 96),
};

type DialogSize = { w: number; h: number };
export type ResizeHandle = "e" | "s" | "se" | "w" | "n" | "nw" | "ne" | "sw";
type DialogPosition = { x: number; y: number };

export type ResizableDialogOptions = {
  minW?: number;
  minH?: number;
  defaultW?: (vw: number) => number;
  defaultH?: (vh: number) => number;
  maxWPercent?: number;
  maxHPercent?: number;
  /** Where the window first opens (before any saved bounds). Defaults to centre. */
  defaultPosition?: (vw: number, vh: number, w: number, h: number) => DialogPosition;
};

function clampSize(
  w: number,
  h: number,
  vw: number,
  vh: number,
  minW = MIN_W,
  minH = MIN_H,
  maxWP = 0.98,
  maxHP = 0.95
): DialogSize {
  return {
    w: Math.max(minW, Math.min(w, Math.floor(vw * maxWP))),
    h: Math.max(minH, Math.min(h, Math.floor(vh * maxHP))),
  };
}

function defaultSizeForViewport(
  vw: number,
  vh: number,
  defaultW?: (vw: number) => number,
  defaultH?: (vh: number) => number,
  minW = MIN_W,
  minH = MIN_H,
  maxWP = 0.98,
  maxHP = 0.95
): DialogSize {
  const w = defaultW ? defaultW(vw) : Math.floor(vw * 0.9);
  const h = defaultH ? defaultH(vh) : Math.floor(vh * 0.90);
  return clampSize(w, h, vw, vh, minW, minH, maxWP, maxHP);
}

type SavedDialogLayout = { w?: number; h?: number; x?: number; y?: number };

function readSavedLayout(
  storageKey: string,
  vw: number,
  vh: number,
  minW = MIN_W,
  minH = MIN_H,
  maxWP = 0.98,
  maxHP = 0.95
): { size: DialogSize; position: DialogPosition | null } | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDialogLayout;
    if (typeof saved.w !== "number" || typeof saved.h !== "number") return null;
    const size = clampSize(saved.w, saved.h, vw, vh, minW, minH, maxWP, maxHP);
    const hasPos = typeof saved.x === "number" && typeof saved.y === "number";
    const position = hasPos
      ? clampPosition(saved.x!, saved.y!, size.w, size.h, vw, vh)
      : null;
    return { size, position };
  } catch {
    return null;
  }
}

function centerPosition(w: number, h: number, vw: number, vh: number): DialogPosition {
  return {
    x: Math.max(0, Math.round((vw - w) / 2)),
    y: Math.max(0, Math.round((vh - h) / 2)),
  };
}

function clampPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): DialogPosition {
  const maxX = Math.max(0, vw - Math.min(w, vw));
  const maxY = Math.max(0, vh - Math.min(h, vh));
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

/** Desktop master dialogs: width/height resize + localStorage restore on open. */
export function usePersistedResizableDialogSize(
  isOpen: boolean,
  enabled: boolean,
  storageKey: string = ITEM_MASTER_DIALOG_SIZE_STORAGE_KEY,
  options?: ResizableDialogOptions
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [size, setSize] = useState<DialogSize>(() => ({
    w: options?.defaultW ? options.defaultW(1200) : ITEM_MASTER_DIALOG_DEFAULT_SIZE.w,
    h: options?.defaultH ? options.defaultH(800) : ITEM_MASTER_DIALOG_DEFAULT_SIZE.h,
  }));
  const [position, setPosition] = useState<DialogPosition>({ x: 0, y: 0 });

  const latestBoundsRef = useRef({ size, position });
  latestBoundsRef.current = { size, position };

  const dragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const resizeRef = useRef<{
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    // Only initialize layout once when the dialog transitions to open
    if (isOpen && !prevIsOpenRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const opts = optionsRef.current;
      const oMinW = opts?.minW ?? MIN_W;
      const oMinH = opts?.minH ?? MIN_H;
      const oMaxWP = opts?.maxWPercent ?? 0.98;
      const oMaxHP = opts?.maxHPercent ?? 0.95;

      const saved = readSavedLayout(storageKey, vw, vh, oMinW, oMinH, oMaxWP, oMaxHP);
      const nextSize =
        saved?.size ??
        defaultSizeForViewport(vw, vh, opts?.defaultW, opts?.defaultH, oMinW, oMinH, oMaxWP, oMaxHP);
      setSize(nextSize);
      const nextPos = saved?.position ?? (opts?.defaultPosition ? opts.defaultPosition(vw, vh, nextSize.w, nextSize.h) : centerPosition(nextSize.w, nextSize.h, vw, vh));
      setPosition(nextPos);
      latestBoundsRef.current = { size: nextSize, position: nextPos };
    } else if (prevIsOpenRef.current && !isOpen) {
      // Save on close
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            w: latestBoundsRef.current.size.w,
            h: latestBoundsRef.current.size.h,
            x: latestBoundsRef.current.position.x,
            y: latestBoundsRef.current.position.y,
          })
        );
      } catch {
        /* ignore */
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, enabled, storageKey]);

  const saveLiveBounds = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          w: latestBoundsRef.current.size.w,
          h: latestBoundsRef.current.size.h,
          x: latestBoundsRef.current.position.x,
          y: latestBoundsRef.current.position.y,
        })
      );
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      const target = e.target as HTMLElement;
      /* Only real controls opt out. Plain spans/divs inside the header (token stats, "reset" label,
       * title) stay draggable, otherwise a narrow ribbon has zero grab area. */
      if (target.closest("button, a, input, textarea, select, [role='switch'], [role='combobox'], [role='tab'], [data-radix-select-trigger], [data-pl-no-drag]")) {
        return;
      }
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = latestBoundsRef.current.position.x;
      const startTop = latestBoundsRef.current.position.y;
      /*
       * The shell to move is the one that owns the element we grabbed, not a global lookup — a global
       * querySelector could return another form's (hidden) copilot window.
       */
      const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-pl-drag-surface]");
      if (!el) return;
      /* Smooth drag: transform per animation frame, commit to state ONCE on mouseup (no re-render per
       * move — that was the jump). */
      const smooth = true;
      /* Dragging must not select the chat text underneath. */
      document.body.style.userSelect = "none";
      el.style.willChange = "left, top";
      let lastX = startLeft;
      let lastY = startTop;
      let raf = 0;

      const apply = () => {
        raf = 0;
        /* Absolute position of the window while dragging (left/top, not transform: Radix DialogContent
         * keeps its own centring transform in inline style and would overwrite ours). */
        el.style.left = `${lastX}px`;
        el.style.top = `${lastY}px`;
      };

      const onMove = (ev: MouseEvent) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let dx = ev.clientX - startX;
        let dy = ev.clientY - startY;
        /* Soft clamp while dragging: a little overhang is allowed so the window never fights the
         * cursor; it snaps fully inside on release. */
        const slack = 48;
        const maxX = vw - latestBoundsRef.current.size.w + slack;
        const maxY = vh - latestBoundsRef.current.size.h + slack;
        if (startLeft + dx < -slack) dx = -slack - startLeft;
        if (startLeft + dx > maxX) dx = maxX - startLeft;
        if (startTop + dy < -slack) dy = -slack - startTop;
        if (startTop + dy > maxY) dy = maxY - startTop;
        lastX = startLeft + dx;
        lastY = startTop + dy;
        if (!raf) raf = requestAnimationFrame(apply);
      };

      const onUp = () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        document.body.style.userSelect = "";
        el.style.willChange = "";
        const nextPos = clampPosition(lastX, lastY, latestBoundsRef.current.size.w, latestBoundsRef.current.size.h, vw, vh);
        setPosition(nextPos);
        latestBoundsRef.current.position = nextPos;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        saveLiveBounds();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [enabled, saveLiveBounds]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      const opts = optionsRef.current;
      const oMinW = opts?.minW ?? MIN_W;
      const oMinH = opts?.minH ?? MIN_H;
      const oMaxWP = opts?.maxWPercent ?? 0.98;
      const oMaxHP = opts?.maxHPercent ?? 0.95;

      resizeRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startW: latestBoundsRef.current.size.w,
        startH: latestBoundsRef.current.size.h,
        startLeft: latestBoundsRef.current.position.x,
        startTop: latestBoundsRef.current.position.y,
      };
      const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-pl-drag-surface]");
      if (el) { el.style.willChange = "width, height, left, top"; }
      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const { handle: h, startX, startY, startW, startH, startLeft, startTop } = resizeRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let w = startW;
        let hh = startH;
        if (h === "e" || h === "se" || h === "ne") w = startW + dx;
        if (h === "w" || h === "sw" || h === "nw") w = startW - dx;
        if (h === "s" || h === "se" || h === "sw") hh = startH + dy;
        if (h === "n" || h === "nw" || h === "ne") hh = startH - dy;
        const next = clampSize(w, hh, vw, vh, oMinW, oMinH, oMaxWP, oMaxHP);
        let nx = startLeft;
        let ny = startTop;
        if (h === "w" || h === "sw" || h === "nw") nx = startLeft + (startW - next.w);
        if (h === "n" || h === "nw" || h === "ne") ny = startTop + (startH - next.h);
        if (el) {
          /* Same no-render trick as drag: size the element directly, commit on mouseup. */
          el.style.width = `${next.w}px`;
          el.style.height = `${next.h}px`;
          el.style.left = `${nx}px`;
          el.style.top = `${ny}px`;
          latestBoundsRef.current = { size: next, position: { x: nx, y: ny } };
          return;
        }
        setSize(next);
        if (nx !== startLeft || ny !== startTop) {
          const nextPos = clampPosition(nx, ny, next.w, next.h, vw, vh);
          setPosition(nextPos);
          latestBoundsRef.current = { size: next, position: nextPos };
        } else {
          latestBoundsRef.current = { size: next, position: { ...latestBoundsRef.current.position } };
        }
      };
      const onUp = () => {
        resizeRef.current = null;
        const b = latestBoundsRef.current;
        if (el) {
          el.style.width = "";
          el.style.height = "";
          el.style.left = "";
          el.style.top = "";
          el.style.willChange = "";
          setSize(b.size);
          setPosition(b.position);
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        saveLiveBounds();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [enabled, saveLiveBounds]
  );

  return { size, position, handleResizeStart, handleDragStart, resizable: enabled };
}
