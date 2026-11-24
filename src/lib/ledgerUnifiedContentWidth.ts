/**
 * Entity ledger unified H-scroll: header ribbon, column sum, footer pagination, closing row —
 * jo band asli content me sabse lamba ho wahi `--pl-ledger-txn-table-min-px` / col scale.
 * Stretched tables / footer shell (min-width var) ko measure mat karo — loop + stall hota hai.
 */

export const LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX = 2;

export function getAppUiZoomFactor(): number {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  const raw =
    root.style.getPropertyValue("--pl-app-ui-zoom") ||
    root.dataset?.plAppUiZoom ||
    "1";
  const z = parseFloat(raw);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export function stabilizeLedgerUnifiedPx(px: number, prev: number, eps = LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX): number {
  const rounded = Math.max(0, Math.round(px));
  if (prev > 0 && Math.abs(rounded - prev) <= eps) return prev;
  return rounded;
}

export function measureLedgerUnifiedBandPx(el: Element | null | undefined): number {
  if (!(el instanceof HTMLElement)) return 0;
  const zoom = getAppUiZoomFactor();
  const scroll = Math.ceil(el.scrollWidth || 0);
  const offset = Math.ceil(el.offsetWidth || 0);
  const rect = Math.ceil((el.getBoundingClientRect().width || 0) / zoom);
  return Math.max(scroll, offset, rect, 0);
}

/** Flex row jahan min-w-full / host stretch ho — bachon ka sum + gap (natural footer width). */
export function measureFlexRowChildrenNaturalPx(row: Element | null | undefined): number {
  if (!(row instanceof HTMLElement)) return 0;
  const style = getComputedStyle(row);
  const gap =
    parseFloat(style.columnGap || "0") ||
    parseFloat(style.gap || "0") ||
    0;
  const pad =
    parseFloat(style.paddingLeft || "0") +
    parseFloat(style.paddingRight || "0") +
    parseFloat(style.marginLeft || "0") +
    parseFloat(style.marginRight || "0");
  const children = row.children;
  if (children.length === 0) return measureLedgerUnifiedBandPx(row);

  let sum = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!(child instanceof HTMLElement)) continue;
    const zoom = getAppUiZoomFactor();
    const childRect = Math.ceil((child.getBoundingClientRect().width || 0) / zoom);
    const childOffset = Math.ceil(child.offsetWidth || 0);
    sum += Math.max(childRect, childOffset);
  }
  const gaps = Math.max(0, children.length - 1) * gap;
  return Math.ceil(sum + gaps + pad);
}

export function computeLedgerUnifiedTableMinPx(args: {
  host: HTMLElement;
  bodyTable: HTMLElement | null;
  baseColSum: number;
  hostViewportPx: number;
}): { tableMinPx: number; scaleTargetPx: number; winnerPx: number } {
  const { host, baseColSum, hostViewportPx } = args;

  const hugPx = Math.max(0, baseColSum);
  if (hugPx > 0) {
    // Overflow: compact 10px gaps + H-scroll. Fits: fill the pane so the table is never narrower than the screen.
    if (hostViewportPx > 0 && hugPx > hostViewportPx) {
      return { tableMinPx: hugPx, scaleTargetPx: hugPx, winnerPx: hugPx };
    }
    return {
      tableMinPx: 0,
      scaleTargetPx: Math.max(hugPx, hostViewportPx),
      winnerPx: hugPx,
    };
  }

  const bandEls: (Element | null)[] = [
    host.querySelector("[data-pl-closing-balance-card]"),
    host.querySelector("[data-pl-footer-parent-pill]"),
  ];

  host.querySelectorAll("[data-pl-ledger-unified-width-band]").forEach((el) => {
    bandEls.push(el);
  });

  let winnerPx = 0;
  for (const el of bandEls) {
    winnerPx = Math.max(winnerPx, measureLedgerUnifiedBandPx(el));
  }

  const footerNatural = measureFlexRowChildrenNaturalPx(
    host.querySelector("[data-pl-ledger-footer-measure-row]")
  );
  const footerShellPad = host.querySelector(".pl-ledger-desktop-footer-shell");
  if (footerShellPad instanceof HTMLElement) {
    const shellStyle = getComputedStyle(footerShellPad);
    winnerPx = Math.max(
      winnerPx,
      footerNatural +
        parseFloat(shellStyle.paddingLeft || "0") +
        parseFloat(shellStyle.paddingRight || "0")
    );
  } else {
    winnerPx = Math.max(winnerPx, footerNatural);
  }

  let tableMinPx = winnerPx;
  if (hostViewportPx > 0 && winnerPx <= hostViewportPx) {
    tableMinPx = 0;
  }
  return { tableMinPx, scaleTargetPx: tableMinPx, winnerPx };
}
/**
 * Plan A: natural (content) width per column for the entity-ledger split tables (header / body / footer).
 * Temporarily switches each table to auto layout (max-content), clears colgroup widths, hides rows that do
 * not map 1:1 onto columns (narration / colSpan > 2 rows wrap and must not drive widths) and rows past
 * `maxBodyRows`, reads one fully 1:1 row per table, then restores everything synchronously (no paint between).
 * Returned widths include cell padding (px-[5px] each side). Returns null when nothing could be measured.
 */
export function measureLedgerNaturalColWidths(
  tables: HTMLTableElement[],
  colCount: number,
  maxBodyRows = 200
): number[] | null {
  if (colCount <= 0 || tables.length === 0) return null;
  const out = new Array<number>(colCount).fill(0);
  let found = false;
  for (const table of tables) {
    const hidden: HTMLTableRowElement[] = [];
    let probe: HTMLTableRowElement | null = null;
    let bodyRows = 0;
    for (const tr of Array.from(table.rows)) {
      const cells = Array.from(tr.cells);
      const span = cells.reduce((s, c) => s + (c.colSpan || 1), 0);
      const isBody = tr.parentElement?.tagName === "TBODY";
      const wide = cells.some((c) => (c.colSpan || 1) > 2);
      if (wide || span !== colCount || (isBody && bodyRows >= maxBodyRows)) {
        hidden.push(tr);
        continue;
      }
      if (isBody) bodyRows += 1;
      if (!probe && cells.every((c) => (c.colSpan || 1) === 1)) probe = tr;
    }
    if (!probe) continue;
    const cols = Array.from(table.querySelectorAll<HTMLElement>(":scope > colgroup > col"));
    const tableProps = ["table-layout", "width", "min-width", "max-width"] as const;
    const prevTable = tableProps.map((k) => [table.style.getPropertyValue(k), table.style.getPropertyPriority(k)]);
    const prevCols = cols.map((c) => [c.style.width, c.style.minWidth]);
    const prevRows = hidden.map((r) => [r.style.getPropertyValue("display"), r.style.getPropertyPriority("display")]);
    try {
      hidden.forEach((r) => r.style.setProperty("display", "none", "important"));
      cols.forEach((c) => {
        c.style.width = "";
        c.style.minWidth = "";
      });
      table.style.setProperty("table-layout", "auto", "important");
      table.style.setProperty("width", "max-content", "important");
      table.style.setProperty("min-width", "0px", "important");
      table.style.setProperty("max-width", "none", "important");
      Array.from(probe.cells).forEach((cell, i) => {
        if (i >= colCount) return;
        out[i] = Math.max(out[i], Math.ceil(cell.getBoundingClientRect().width || 0));
      });
      found = true;
    } finally {
      tableProps.forEach((k, i) => {
        const [v, pr] = prevTable[i];
        if (v) table.style.setProperty(k, v, pr);
        else table.style.removeProperty(k);
      });
      cols.forEach((c, i) => {
        c.style.width = prevCols[i][0];
        c.style.minWidth = prevCols[i][1];
      });
      hidden.forEach((r, i) => {
        const [v, pr] = prevRows[i];
        if (v) r.style.setProperty("display", v, pr);
        else r.style.removeProperty("display");
      });
    }
  }
  return found ? out : null;
}

/** Plan A: per-column max(constant floor, measured natural px). Measured list must match length, else floors. */
export function mergeLedgerMeasuredColWidths(base: number[], measured: number[]): number[] {
  if (measured.length !== base.length) return base;
  return base.map((w, i) => Math.max(w, Math.ceil(measured[i] || 0)));
}

const LEDGER_TYPE_TO_VOUCHER_GAP_PX = 10;

/**
 * Same Type↔Voucher No 10px rule on every page: hug the longest body type pill
 * (FY pair uses the first pill only) + 10px pad. Body may raise the col; journal stays 70.
 */
export function measureLedgerTypeColHugPx(root: ParentNode | null | undefined, minPx: number): number {
  if (!root) return minPx;
  const zoom = getAppUiZoomFactor();
  const pillW = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return 0;
    return (el.getBoundingClientRect().width || 0) / zoom;
  };
  let maxPill = 0;
  root.querySelectorAll("[data-pl-ledger-txn-type-cell]").forEach((cell) => {
    // FY pair + Book/Dated Opening overflow Type on purpose — txn pills drive the col.
    if (
      cell.querySelector("[data-pl-fy-opening-pills]") ||
      cell.closest("[data-pl-fy-opening-row]") ||
      cell.closest("[data-row^='opening-balance']")
    ) {
      return;
    }
    const badges = cell.querySelectorAll('[class*="rounded-xl"]');
    if (badges.length > 0) {
      badges.forEach((el) => {
        maxPill = Math.max(maxPill, pillW(el));
      });
      return;
    }
    maxPill = Math.max(maxPill, pillW(cell.firstElementChild));
  });
  maxPill = Math.max(maxPill, pillW(root.querySelector('th[data-pl-col="type"] > div')));
  if (maxPill <= 0) return minPx;
  return Math.max(minPx, Math.ceil(maxPill + LEDGER_TYPE_TO_VOUCHER_GAP_PX));
}

/**
 * Last date col (BS-only / AD-only / Both AD): hug the longest date+time (or posted subline)
 * + 10px pad so AM/PM stays 10px from the Type pill for any date format length.
 */
export function measureLedgerLastDateColHugPx(root: ParentNode | null | undefined, minPx: number): number {
  if (!root) return minPx;
  const zoom = getAppUiZoomFactor();
  let maxContent = 0;
  const measureTextPx = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return;
    let w = 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      w = (range.getBoundingClientRect().width || 0) / zoom;
    } catch {
      w = Math.max(el.scrollWidth || 0, (el.getBoundingClientRect().width || 0) / zoom);
    }
    maxContent = Math.max(maxContent, w);
  };
  root.querySelectorAll("[data-pl-ledger-txn-last-date-cell] [data-pl-txn-date-time]").forEach(measureTextPx);
  root.querySelectorAll("[data-pl-ledger-txn-last-date-cell] [data-pl-txn-date-subline]").forEach(measureTextPx);
  if (maxContent <= 0) return minPx;
  return Math.max(minPx, Math.ceil(maxContent + LEDGER_TYPE_TO_VOUCHER_GAP_PX));
}