/**
 * Add/Edit Item — "Low Stock Warning" label, pill aur Unit select laal (Ansari Ji, 2026-11-11).
 * - `!` (important) classes: Tailwind utilities theme ke non-important rules se jeetein.
 * - Plain (bina `!`) bg/border classes bhi: tailwind-merge component ki `bg-background` / `border-input`
 *   hata deta hai, taaki globals.css ke `.bg-background` / `.border-input` !important rules match hi na hon.
 * - `--pl-dialog-inner-border`: globals.css ke [data-pl-dialog-shell] input / [role="combobox"] border rules
 *   (!important, zyada specificity) isi variable se color lete hain — element par variable laal kar diya.
 */
export const LOW_STOCK_LABEL_CN = "text-red-600 !text-red-600 dark:text-red-400 dark:!text-red-400";

export const LOW_STOCK_PILL_CN =
  "border-red-400 bg-red-50 text-red-700 !border-red-400 !bg-red-50 !text-red-700 placeholder:!text-red-400 " +
  "focus-visible:!border-red-500 focus-visible:!ring-red-400 " +
  "dark:border-red-500 dark:bg-red-950/40 dark:text-red-300 dark:!border-red-500 dark:!bg-red-950/40 dark:!text-red-300 " +
  "[--pl-dialog-inner-border:#f87171] dark:[--pl-dialog-inner-border:#ef4444]";

/** SelectTrigger: pill jaisa + andar ka text (span) aur chevron (svg) bhi laal. */
export const LOW_STOCK_SELECT_CN =
  LOW_STOCK_PILL_CN +
  " [&>span]:!text-red-700 dark:[&>span]:!text-red-300 [&>svg]:!opacity-100 [&>svg]:!text-red-600 dark:[&>svg]:!text-red-400";
