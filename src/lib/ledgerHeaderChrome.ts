/**
 * Ledger / detail / report header action pills — ~27px (h-7 was 28px).
 * Party, Staff, Bank, Tax, Items, Groups, embedded report views sab me same height.
 */
import { chromeProPillCn } from "@/lib/chromePillButton";
import { cn } from "@/lib/utils";

export const LEDGER_HEADER_PILL_CN = "h-[27px] min-h-[27px] flex-shrink-0 px-2.5 text-xs";
/** Adjust Balance only — +4px horizontal vs header pill (px-2.5 → px-3). */
export const ADJUST_BALANCE_PILL_CN = cn(LEDGER_HEADER_PILL_CN, "!px-3");
/** Closing card footer — shared pill shape (Send Statement etc.; no fixed width). */
export const LEDGER_CLOSING_BALANCE_ACTION_PILL_CN =
  "inline-flex items-center justify-center rounded-full shrink-0";
/**
 * Adjust Balance closing pill only — width matches `MasterAccountFreezeOwnerToggle`
 * (checkbox + "Freez This Account" + px-2.5). Do not put on Freeze / Send Statement.
 */
export const LEDGER_CLOSING_BALANCE_ADJUST_PILL_CN = cn(
  LEDGER_CLOSING_BALANCE_ACTION_PILL_CN,
  "box-border justify-center min-w-[calc(14px+0.375rem+18ch+1.25rem+4px)]"
);
/** Date-range trigger — bold blue + glow via globals `.pl-ledger-header-pill-row button[data-theme-detail="date-range"]`. */
export const LEDGER_DATE_RANGE_PILL_CN = cn(
  LEDGER_HEADER_PILL_CN,
  "font-semibold text-blue-900"
);
export const LEDGER_HEADER_PILL_ICON_CN = "h-[27px] w-[27px] min-h-[27px] flex-shrink-0";
/** Pill ke andar icon — height ke saath proportion */
export const LEDGER_HEADER_PILL_ICON_SIZE_CN = "h-3.5 w-3.5";
/**
 * Right 50% of ribbon — pills wrap; 3 rows ke baad V-scroll (global CSS).
 */
export const LEDGER_HEADER_PILL_ROW_CN =
  "pl-ledger-header-card pl-ledger-header-pill-row justify-start gap-[3px]";
/** Outer ribbon wrap — sides/bottom gap; pill-blue strip (top flush on txn pages via CSS) */
export const LEDGER_HEADER_RIBBON_WRAP_CN =
  "pl-ledger-header-ribbon-wrap shrink-0 border-b px-[2px] py-[2px] overflow-x-auto min-h-0 scrollbar-slim-dim";
/** Right inset on entity txn pages — matches Dashboard Recent edge gap. */
export const LEDGER_TXN_PAGE_EDGE_GAP_PX = 2;
/** Ledger detail pane: fixed ribbon + scrollable table (desktop). */
export const LEDGER_TXN_PAGE_ROOT_CN =
  "flex h-full min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden box-border";
/** Single H-scroll owner (table + footer move together). */
export const LEDGER_TXN_SCROLL_HOST_CN =
  "pl-ledger-txn-scroll-host flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden pl-ledger-txn-scroll-native w-full max-w-full";
export const LEDGER_TXN_SCROLL_INNER_CN =
  "pl-ledger-txn-scroll-host-inner flex h-0 min-h-0 w-full flex-1 flex-col overflow-hidden";
export const LEDGER_TXN_TABLE_HOST_CN =
  "pl-ledger-txn-table-host flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden";
/** Ribbon slot inside unified H-scroll — width follows table min width. */
export const LEDGER_TXN_SCROLL_HEADER_CN =
  "pl-ledger-txn-scroll-header shrink-0 min-w-full w-full box-border";
/** Entity ledger split table: Type pill (incl. FY opening label) fit + colgroup sync. */
export const LEDGER_ENTITY_TYPE_COL_PX = 120;
/** Daybook Accounts col — header/row max(min); matches txn row min-w. */
export const DAYBOOK_ACCOUNTS_COL_PX = 210;
/** Voucher No header: label + filter icon + 5px side pads (10px gap to next col). */
export const LEDGER_VOUCHER_NO_HEADER_COL_PX = 132;
/** Entity ledger Balance — large formatted amounts + Dr/Cr suffix. */
export const LEDGER_ENTITY_BALANCE_COL_PX = 132;
/** Party/group TDS ledger: Taxable + TDS Amount colgroup min (each +60px vs base 110). */
export const LEDGER_TDS_TAXABLE_COL_PX = 170;
export const LEDGER_TDS_AMOUNT_COL_PX = 170;
/** TDS rows: FY voucher nos (e.g. Sale Inv-83-84-059) — no overlap into User. */
export const LEDGER_TDS_VOUCHER_NO_COL_PX = 182;
export const LEDGER_ENTITY_USER_COL_PX = 148;
export const LEDGER_ENTITY_FILE_COL_PX = 44;
/**
 * Party TDS details = same pad/align as party Account Details txn table.
 * Extra cols (Taxable + TDS Amount + wider Dr/Cr for verify badge) raise table min width.
 */
export const LEDGER_TDS_FILE_COL_PX = 72;
export const LEDGER_TDS_FILE_CELL_PAD_CN = "px-[5px]";
/** Max horizontal gap between adjacent header/txn cell texts (5px + 5px); col min-width wins if tighter. */
export const LEDGER_TXN_COL_MAX_GAP_PX = 10;
export const LEDGER_TXN_COL_MAX_GAP_PAD_CN = "px-[5px]";
/** @deprecated use LEDGER_TXN_COL_MAX_GAP_PAD_CN */
export const LEDGER_TXN_COL_MIN_GAP_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
/** Entity ledger header + txn body cell horizontal pad (matches max gap). */
export const LEDGER_TXN_BODY_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
/** TDS details: same 5px side pad as Account Details (10px between columns). */
export const LEDGER_TDS_ROW_TEXT_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
export const LEDGER_TDS_TAXABLE_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
export const LEDGER_TDS_AMOUNT_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
export const LEDGER_TDS_USER_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
/** Dr/Cr amount cols — body, footer, FY partition (right edge / `.00` align). */
export const LEDGER_TXN_DR_CR_COL_PX = 100;
export const LEDGER_TXN_DR_CR_AMOUNT_CELL_CN =
  "min-w-[100px] px-[5px] text-right tabular-nums";
/**
 * TDS details Dr/Cr: Account Details align (right) + wider min for "TDS Unverified" badge.
 */
export const LEDGER_TDS_DR_CR_COL_PX = 168;
export const LEDGER_TDS_VERIFY_BADGE_TO_AMOUNT_GAP_PX = 10;
export const LEDGER_TDS_DR_CR_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
export const LEDGER_TDS_DR_CR_AMOUNT_CELL_CN =
  "min-w-[168px] px-[5px] text-right tabular-nums";
/** TDS ledger: +10px min width on last Date col, visual gap before Type. */
export const LEDGER_TDS_DATE_TO_TYPE_GAP_PX = 10;
/** Entity / daybook: min visual gap between entry time (e.g. PM) and Type pill. */
export const LEDGER_ENTRY_TIME_TO_TYPE_MIN_GAP_PX = 2;
/** Dashboard Recent / daybook: max gap PM (date col) → Type pill. */
export const LEDGER_DATE_TIME_TO_TYPE_GAP_PX = 3;
export const LEDGER_DATE_TIME_TO_TYPE_DATE_PR_PX = 2;
export const LEDGER_DATE_TIME_TO_TYPE_TYPE_PL_PX = 1;
/** TDS: single Date col or Date (AD) — BS date + entry time, no overlap into Type. */
export const LEDGER_TDS_DATE_COL_PX = 178;
export const LEDGER_TDS_LAST_DATE_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
/** Entity ledger Date (BS) + Date (AD): +10px on BS col min-width (padding stays max-gap). */
export const LEDGER_BOTH_DATE_BS_AD_GAP_PX = 10;
export const LEDGER_ENTITY_DATE_BS_COL_PX = 95;
export const LEDGER_BOTH_DATE_BS_CELL_PAD_CN = LEDGER_TXN_COL_MAX_GAP_PAD_CN;
/** Compact visual strip after Balance; the visible ⋮ sits 4px from the right edge. */
export const LEDGER_TXN_ROW_MENU_COL_PX = 12;
export const LEDGER_TXN_ROW_MENU_CELL_CN =
  "relative box-border w-3 min-w-[12px] max-w-[12px] p-0 align-middle";
/** Header stays aligned at the Balance column's right boundary. */
export const LEDGER_TXN_BALANCE_HEADER_PAD_CN = "pl-[5px] pr-0";
/** Body Balance: max text gap from Cr; keep small strip before ⋮. */
export const LEDGER_TXN_BALANCE_TO_MENU_PAD_CN = "pl-[5px] pr-[6px]";

export const LEDGER_TXN_VERTICAL_SCROLLBAR_FALLBACK_PX = 14;

export function readLedgerTxnVerticalScrollbarSizePx(doc: Document = document): number {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue("--pl-ledger-txn-scroll-size").trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : LEDGER_TXN_VERTICAL_SCROLLBAR_FALLBACK_PX;
}

/** Recent / Daybook: header pad aligns cols; body pad only when overlay scrollbar (classic already reserves gutter). */
export function measureLedgerTxnVerticalScrollPads(body: HTMLElement): {
  headerPadPx: number;
  bodyPadPx: number;
} {
  if (body.scrollHeight <= body.clientHeight + 1) {
    return { headerPadPx: 0, bodyPadPx: 0 };
  }
  const classicGutter = Math.max(0, body.offsetWidth - body.clientWidth);
  const scrollSize = readLedgerTxnVerticalScrollbarSizePx(body.ownerDocument);
  const headerPadPx = classicGutter > 0 ? classicGutter : scrollSize;
  const bodyPadPx = classicGutter > 0 ? 0 : scrollSize;
  return { headerPadPx, bodyPadPx };
}

/** Outer ribbon — 50/50; overflow parent pe H-scroll jab left floor tight ho */
export const LEDGER_HEADER_OUTER_ROW_CN =
  "pl-ledger-header-outer-row flex w-full flex-nowrap items-start gap-1";
/**
 * Left 50%: profile + name (flex) + balance — responsive within half.
 */
export const LEDGER_HEADER_IDENTITY_CN =
  "pl-ledger-header-identity flex items-start gap-1";
/** Profile avatar wrap — pen badge overlay */
export const LEDGER_HEADER_AVATAR_CN = "pl-ledger-header-avatar";
/** Ledger + mobile merged header profile tile — square, same height as name card (3.75rem) */
export const LEDGER_HEADER_AVATAR_BOX_CN = "aspect-square h-[3.75rem] w-[3.75rem] shrink-0";
export const LEDGER_HEADER_AVATAR_TRIGGER_CN = cn("inline-flex", LEDGER_HEADER_AVATAR_BOX_CN);
export const LEDGER_HEADER_AVATAR_IMAGE_CN = cn(
  LEDGER_HEADER_AVATAR_BOX_CN,
  "rounded-lg overflow-hidden text-lg flex-shrink-0 [&_img]:object-cover [&_img]:rounded-none"
);
export const LEDGER_HEADER_AVATAR_ICON_TILE_CN = cn(
  LEDGER_HEADER_AVATAR_BOX_CN,
  "inline-flex items-center justify-center rounded-lg border border-blue-300 bg-blue-100/80"
);
/** Pen on profile — same blue as Adjust Balance outline pill */
export const LEDGER_HEADER_AVATAR_PEN_CN = cn(
  "pl-ledger-header-avatar-pen",
  chromeProPillCn
);
/** Same pen chrome inline (combobox / form pills) — no avatar absolute overlay */
export const LEDGER_INLINE_EDIT_PEN_CN = cn(
  "pl-ledger-inline-edit-pen",
  chromeProPillCn
);
/** Name card — left half me remaining width; 2-line wrap + … */
export const LEDGER_HEADER_NAME_CARD_CN =
  "pl-ledger-header-card pl-ledger-header-name-card justify-start";
/** Balance card — Balance label + amount only (edit pen on profile) */
export const LEDGER_HEADER_BALANCE_CARD_CN = "pl-ledger-header-balance-card";
export const LEDGER_HEADER_BALANCE_STACK_CN = "pl-ledger-header-balance-stack";
export const LEDGER_HEADER_BALANCE_LABEL_CN = "pl-ledger-header-balance-label";
/** Party TDS Balance card (Sale / Pur sections) — right of Balance */
export const LEDGER_HEADER_TDS_BALANCE_CARD_CN = "pl-ledger-header-tds-balance-card";
export const LEDGER_HEADER_TDS_BALANCE_ROW_CN = "pl-ledger-header-tds-balance-row";
export const LEDGER_HEADER_TDS_BALANCE_SIDE_CN = "pl-ledger-header-tds-balance-side";
/** Title in name card */
export const LEDGER_HEADER_TITLE_CN =
  "pl-ledger-header-title text-xl font-semibold leading-6";
/** Amount under Balance label */
export const LEDGER_HEADER_BALANCE_CN =
  "pl-ledger-header-balance text-base font-bold";

/** Closing Balance footer card: one row (H-scroll instead of wrap/unwrap height jiggle). */
export const LEDGER_CLOSING_BALANCE_CARD_ROW_CN =
  "flex w-full min-w-0 flex-nowrap items-center gap-x-2";
export const LEDGER_CLOSING_BALANCE_ACTIONS_CN =
  "flex shrink-0 flex-nowrap items-center gap-2";
export const LEDGER_CLOSING_BALANCE_TOTAL_CN =
  "ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5";
