/** Sale / Purchase line grid — company-wide column labels (Voucher Settings). */

export type SalePurchaseLineColumnLabels = {
  tax?: string;
  tds?: string;
  taxAmount?: string;
  taxable?: string;
  tdsAmount?: string;
  amount?: string;
};

export const DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS: Required<SalePurchaseLineColumnLabels> = {
  tax: "Tax Account",
  tds: "TDS Account",
  taxAmount: "Tax Amt.",
  taxable: "Taxable",
  tdsAmount: "TDS Amt.",
  amount: "Amount",
};

export function resolveSalePurchaseLineColumnLabels(
  company: { salePurchaseLineColumnLabels?: SalePurchaseLineColumnLabels | null } | null | undefined
): Required<SalePurchaseLineColumnLabels> {
  const raw = company?.salePurchaseLineColumnLabels ?? {};
  const pick = (key: keyof SalePurchaseLineColumnLabels, fallback: string) => {
    const v = String(raw[key] ?? "").trim();
    return v || fallback;
  };
  return {
    tax: pick("tax", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.tax),
    tds: pick("tds", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.tds),
    taxAmount: pick("taxAmount", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.taxAmount),
    taxable: pick("taxable", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.taxable),
    tdsAmount: pick("tdsAmount", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.tdsAmount),
    amount: pick("amount", DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS.amount),
  };
}

/** Qty / Rate / TDS Amt boxes - at least 7 characters; grow with typed value. */
export const SALE_PURCHASE_LINE_NUMBER_MIN_CH = 7;
/** Taxable / Tax Amt / Amount boxes - at least 11 characters (10 digits + padding); grow beyond. */
export const SALE_PURCHASE_LINE_WIDE_MIN_CH = 11;

export const SALE_PURCHASE_LINE_NUMBER_INPUT_CLASS =
  "h-[35px] inline-block !w-auto !max-w-none shrink-0 border shadow-none focus-visible:ring-0 rounded-md text-right tabular-nums px-0.5 box-border [field-sizing:content]";

/** Amount column — right inset + 2px text gap; decimal type karte waqt clip na ho. */
export const SALE_PURCHASE_LINE_AMOUNT_INPUT_CLASS =
  "h-[35px] inline-block !w-auto !max-w-none shrink-0 border shadow-none focus-visible:ring-0 rounded-md text-right tabular-nums pl-0.5 pr-[2px] mr-[4px] box-border overflow-x-auto [field-sizing:content]";

const SALE_PURCHASE_LINE_AMOUNT_INPUT_RIGHT_PAD_PX = 2;

/** Read-only line money (Taxable / TDS Amt / Tax Amt) — amount formatter `.00` na kaate. */
export const SALE_PURCHASE_LINE_MONEY_INPUT_FIELD_PROPS = {
  type: "text" as const,
  inputMode: "decimal" as const,
  readOnly: true,
  "data-pl-raw-number": "",
};

/** 2 decimal display — width aur visible text dono yahi. */
export function formatSalePurchaseLineMoneyDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "0.00";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isFinite(n)) return n.toFixed(2);
  const s = String(value).trim();
  return s || "0.00";
}

function salePurchaseLineNumberInputStyleFromText(
  text: string,
  extraRightPadPx = 0,
  minCh = SALE_PURCHASE_LINE_NUMBER_MIN_CH
): {
  width: string;
  minWidth: string;
  maxWidth: string;
} {
  const len = Math.max(minCh, text.length);
  const minW =
    extraRightPadPx > 0 ? `calc(${len}ch + ${extraRightPadPx}px)` : `${len}ch`;
  return { width: "auto", minWidth: minW, maxWidth: "none" };
}

/** HTML `size` — box digit-count jitna (Qty / money parity). */
export function salePurchaseLineNumberInputSize(text: string): number {
  return Math.max(SALE_PURCHASE_LINE_NUMBER_MIN_CH, text.length);
}

export function salePurchaseLineNumberInputSizeFromValue(value: unknown): number {
  return salePurchaseLineNumberInputSize(lineQtyRateAmountTextForWidth(value));
}

function lineQtyRateAmountTextForWidth(value: unknown): string {
  if (value === null || value === undefined || value === "") return "0";
  const raw = String(value).trim();
  if (/^-?\d*\.\d*$/.test(raw) || /^-?\d+\.$/.test(raw)) return raw || "0";
  return raw;
}

/** Qty / Rate — jitna digit (decimal sahit) utna box. */
export function salePurchaseLineNumberInputStyle(value: unknown): {
  width: string;
  minWidth: string;
  maxWidth: string;
} {
  return salePurchaseLineNumberInputStyleFromText(lineQtyRateAmountTextForWidth(value));
}

/** Amount column — min width text + padding; max unlimited. */
export function salePurchaseLineAmountInputStyleFromText(text: string): {
  width: string;
  minWidth: string;
  maxWidth: string;
} {
  const normalized = String(text ?? "").trim() || "0";
  return salePurchaseLineNumberInputStyleFromText(
    normalized,
    SALE_PURCHASE_LINE_AMOUNT_INPUT_RIGHT_PAD_PX,
    SALE_PURCHASE_LINE_WIDE_MIN_CH
  );
}

/** Amount column — digit width + 2px right padding. */
export function salePurchaseLineAmountInputStyle(value: unknown): {
  width: string;
  minWidth: string;
  maxWidth: string;
} {
  return salePurchaseLineAmountInputStyleFromText(lineQtyRateAmountTextForWidth(value));
}

export function salePurchaseLineAmountInputSizeFromText(text: string): number {
  const normalized = String(text ?? "").trim() || "0";
  return salePurchaseLineNumberInputSize(normalized);
}

export function salePurchaseLineAmountInputSizeFromValue(value: unknown): number {
  return salePurchaseLineAmountInputSizeFromText(lineQtyRateAmountTextForWidth(value));
}

/** Taxable, TDS Amt, Tax Amt — hamesha 2 decimal visible, clip na ho. */
export function salePurchaseLineMoneyInputStyle(value: unknown, minCh: number = SALE_PURCHASE_LINE_WIDE_MIN_CH): {
  width: string;
  minWidth: string;
  maxWidth: string;
} {
  return salePurchaseLineNumberInputStyleFromText(formatSalePurchaseLineMoneyDisplay(value), 0, minCh);
}

/** Desktop line grid — number input cell: grid border se 2px gap. */
export const SALE_PURCHASE_DESKTOP_LINE_NUMBER_CELL =
  "p-[2px] box-border flex items-center justify-end overflow-visible";

function salePurchaseHeaderMinCh(label: string, floorCh: number): number {
  const len = String(label ?? "").trim().length;
  return Math.max(floorCh, len || floorCh);
}

/** Item column — kam se kam 2.5in; lamba item naam par text jitna wide. */
export const SALE_PURCHASE_DESKTOP_LINE_ITEM_COL_MIN = "2.5in";

function salePurchaseDesktopLineItemColTrack(): string {
  return `minmax(${SALE_PURCHASE_DESKTOP_LINE_ITEM_COL_MIN},max-content)`;
}

/** Sirf is column ka content/header jitna — lamba Tax/TDS select par wahi track badhe. */
function salePurchaseIntrinsicNumberColTrack(minCh: number = SALE_PURCHASE_LINE_NUMBER_MIN_CH): string {
  return `minmax(${minCh}ch,max-content)`;
}

function salePurchaseIntrinsicLabelColTrack(label: string, floorCh: number): string {
  return `minmax(${salePurchaseHeaderMinCh(label, floorCh)}ch,max-content)`;
}

/** Amount - min 11ch; lamba number par column bhi grow (1fr cap nahi). */
function salePurchaseAmountColTrack(labels: Required<SalePurchaseLineColumnLabels>): string {
  return salePurchaseIntrinsicNumberColTrack(SALE_PURCHASE_LINE_WIDE_MIN_CH);
}

/** Tailwind class only — column tracks runtime inline style se (JIT dynamic arbitrary class break karta tha). */
export const SALE_PURCHASE_DESKTOP_LINE_GRID_CLASS = "grid w-full max-w-full min-w-0 gap-0";

export function buildSalePurchaseDesktopLineGridTemplateColumns(
  labels: Required<SalePurchaseLineColumnLabels>,
  withDeleteColumn: boolean
): string {
  const tracks = [
    "minmax(2.5rem,3rem)",
    salePurchaseDesktopLineItemColTrack(),
    salePurchaseIntrinsicNumberColTrack(),
    salePurchaseIntrinsicLabelColTrack("Unit", 4),
    `minmax(calc(${Math.max(SALE_PURCHASE_LINE_NUMBER_MIN_CH + 2, 7)}ch + 10px),max-content)`,
    salePurchaseIntrinsicNumberColTrack(SALE_PURCHASE_LINE_WIDE_MIN_CH),
    salePurchaseIntrinsicLabelColTrack(labels.tds, 3),
    salePurchaseIntrinsicNumberColTrack(),
    salePurchaseIntrinsicLabelColTrack(labels.tax, 3),
    "minmax(3.25rem,max-content)",
    salePurchaseIntrinsicNumberColTrack(SALE_PURCHASE_LINE_WIDE_MIN_CH),
    salePurchaseAmountColTrack(labels),
  ];
  if (withDeleteColumn) tracks.push(SALE_PURCHASE_DESKTOP_LINE_DELETE_COL_TRACK);
  return tracks.join(" ");
}

/** Trash column — fixed (~pehle max-content + px-2 ka aadha). */
export const SALE_PURCHASE_DESKTOP_LINE_DELETE_COL_TRACK = "1.75rem";

export const SALE_PURCHASE_DESKTOP_LINE_DELETE_HEADER =
  "p-[2px] py-2 bg-muted/50 box-border whitespace-nowrap min-h-[2.25rem]";

export const SALE_PURCHASE_DESKTOP_LINE_DELETE_CELL =
  "p-[2px] box-border flex items-center justify-center min-h-[2.25rem]";

export const SALE_PURCHASE_DESKTOP_LINE_DELETE_BUTTON_CLASS = "h-7 w-7 shrink-0 p-0";

/** PC line grid — label/number min tracks; `max-content` se lamba text column badhe; ek hi row. */
export function getSalePurchaseDesktopLineGridStyle(
  labels: Required<SalePurchaseLineColumnLabels>,
  withDeleteColumn: boolean
): { gridTemplateColumns: string; width: string; maxWidth: string; minWidth: number } {
  return {
    gridTemplateColumns: buildSalePurchaseDesktopLineGridTemplateColumns(labels, withDeleteColumn),
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
  };
}

/** Form ke andar rahe; lamba content par yahi wrapper horizontal scroll. */
export const SALE_PURCHASE_DESKTOP_LINE_TABLE_INNER = "w-full max-w-full min-w-0 overflow-x-auto";

/** Header + line grid + narration/totals — same combined width; form body scrolls once. */
export const SALE_PURCHASE_VOUCHER_DESKTOP_BODY = "w-max min-w-full max-w-none";

/** Rough intrinsic min for dialog min-width hints (ch-based grid). */
export const SALE_PURCHASE_DESKTOP_LINE_GRID_MIN_PX = 720;

/** Unified grid body cells — borders come from {@link SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_DIVIDERS}. */
export const SALE_PURCHASE_DESKTOP_LINE_BODY_CELL = "whitespace-nowrap min-h-[39px] py-[2px] items-center";

/** Outer frame — top + bottom 1px black (with header/row rules below). */
export const SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_FRAME = "border border-black";

/** V + H rules for header + item rows (`display: contents` rows; `divide-x` does not apply). */
export const SALE_PURCHASE_DESKTOP_LINE_UNIFIED_GRID_DIVIDERS =
  "[&>.contents>*]:box-border [&>.contents>*]:border-black [&>.contents>*:not(:first-child)]:border-l [&>.contents:first-child>*]:border-b [&>.contents:nth-child(n+3)>*]:border-t";

/** Desktop voucher dialog — sale/purchase line grid ke liye minimum width (user resize se niche na jaye). */
export const SALE_PURCHASE_VOUCHER_DIALOG_MIN_W = 940;

export type SalePurchaseLineTaxRow = { id: string; name?: string; rate?: number };

/** Line Tax + TDS combobox — same account list as Tax column. */
/** Placeholder tax account literally named "Non" with 0% rate; duplicates the "None" reset option, so hidden from dropdown lists. */
export function isPlaceholderNoneTax(t: { name?: string | null; rate?: number | string | null } | null | undefined): boolean {
  if (!t) return false;
  return String(t.name ?? "").trim().toLowerCase() === "non" && Number(t.rate ?? 0) === 0;
}

/** Tax/TDS dropdown options: "None" reset always first; placeholder "Non @ 0%" account removed. */
export function mapSalePurchaseLineTaxComboboxOptions(taxes: SalePurchaseLineTaxRow[]) {
  return [
    { value: "none", label: "None" },
    ...taxes
      .filter((t) => !isPlaceholderNoneTax(t))
      .map((t) => ({
        value: t.id,
        label: `${t.name ?? ""} @ ${t.rate}%`,
      })),
  ];
}

/** If the current value is the hidden "Non @ 0%" account, add it back so the closed select still shows its label. */
export function withSelectedHiddenTax(
  options: { value: string; label: string }[],
  taxes: SalePurchaseLineTaxRow[],
  selectedId: unknown
) {
  const id = String(selectedId ?? "").trim();
  if (!id || options.some((o) => o.value === id)) return options;
  const t = taxes.find((x) => x.id === id);
  if (!t) return options;
  return [...options, { value: t.id, label: `${t.name ?? ""} @ ${t.rate}%` }];
}

/** Dropdown: single-line labels; panel wider than trigger (avoid w-max layout thrash in voucher dialog). */
export const SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS = {
  contentWidthMode: "auto" as const,
  noWrapOptions: true,
  showFullOptionText: true,
} as const;

/** Desktop line grid — trigger width follows label (column expands, no ellipsis). */
export const SALE_PURCHASE_LINE_DESKTOP_COMBOBOX_PROPS = {
  ...SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS,
  fitTrigger: true,
  triggerClassName: "h-[35px]",
} as const;

/** Item column — kam se kam 2.5in fill; lamba label par pill + column dono grow. */
export const SALE_PURCHASE_DESKTOP_LINE_ITEM_CELL =
  "min-w-[2.5in] w-full max-w-none box-border";

/** Item column — pill column bhar de; column lambe naam se grow kare. */
export const SALE_PURCHASE_LINE_ITEM_COMBOBOX_PROPS = {
  ...SALE_PURCHASE_LINE_TAX_COMBOBOX_PROPS,
  fillColumn: true,
  triggerClassName: "min-w-[2.5in] h-[35px]",
} as const;
