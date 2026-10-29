"use client";

/**
 * Inter Company amount — identity strip jaisa 2 column (source | target);
 * har side: label box + amount box ek row; comma + Cr; min width 25mm.
 * Source side: optional Other charge (Payment jaisa).
 */
import { type ComponentProps, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";
import { PlusCircle, X } from "lucide-react";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  interCompanyAmountInputSizingClass,
  interCompanyInputClass,
  interCompanyReadOnlyCopyInputClass,
} from "@/lib/interCompany/interCompanyVoucherChrome";
import { cn } from "@/lib/utils";
import { OTHER_CHARGE_ADD_NEW_LABELS, resolveOtherChargeAddNewType } from "@/lib/otherChargeComboboxAddNew";
import { parseAmountInputString } from "@/lib/amountInputNormalize";
import type { ChangeEvent } from "react";

type FormatPrint = (amount: number, options?: { noSuffix?: boolean }) => string;

type AccountOption = { value: string; label: string };

type Props = {
  // Voucher form typed control — `FieldValues` assign karne ke liye parent par cast.
  control: Control<FieldValues>;
  amount: number;
  formatCurrencyForPrint: FormatPrint;
  fieldsDisabled?: boolean;
  editLocked?: boolean;
  /** Source Payment — other charge toggle + fields */
  showOtherCharge?: boolean;
  otherChargeEnabled?: boolean;
  onOtherChargeEnabledChange?: (enabled: boolean) => void;
  otherChargeAccountOptions?: AccountOption[];
  otherChargeBalance?: number | null;
  onOtherChargeDefault?: () => void;
  /** A stored default exists: button shows Clear. */
  otherChargeDefaultSaved?: boolean;
  /** Hide Default/Clear when editing an existing voucher. */
  showOtherChargeDefault?: boolean;
  otherChargeAccountId?: string;
  otherChargeAddNewLabels?: { value: string; label: string }[];
  onOtherChargeAccountChange?: (val: string, newName?: string) => void;
};

const AMOUNT_MEASURE_FALLBACK = "0.00 Cr";

/** Upar Source/Target strip jaisa — ek column ka panel */
const amountSidePanelClass =
  "min-w-0 flex-1 rounded-md border bg-background/80 px-2.5 py-2";

function formatInterCompanyAmountNumeric(
  formatCurrencyForPrint: FormatPrint,
  amount: number
): string {
  const n = Number(amount);
  if (!n || n <= 0) return "";
  return formatCurrencyForPrint(n, { noSuffix: true });
}

function formatInterCompanyAmountDisplay(formatCurrencyForPrint: FormatPrint, amount: number): string {
  const num = formatInterCompanyAmountNumeric(formatCurrencyForPrint, amount);
  return num ? `${num} Cr` : "";
}

function InterCompanyAmountLabelBox({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        interCompanyInputClass,
        "inline-flex h-9 shrink-0 items-center whitespace-nowrap px-3 text-sm font-medium"
      )}
    >
      {children}
    </div>
  );
}

function InterCompanyResponsiveAmountInput({
  displayText,
  placeholder = AMOUNT_MEASURE_FALLBACK,
  className,
  showCrSuffix = false,
  ...inputProps
}: {
  displayText: string;
  placeholder?: string;
  /** Editable amount — " Cr" suffix input ke bahar (cursor jump fix). */
  showCrSuffix?: boolean;
} & ComponentProps<typeof Input>) {
  const measure = (displayText && displayText.trim()) || placeholder || AMOUNT_MEASURE_FALLBACK;

  if (showCrSuffix) {
    const numericMeasure = measure.replace(/\s*Cr\s*$/i, "").trim() || "0.00";
    return (
      <div className="inline-grid max-w-full [&>*]:col-start-1 [&>*]:row-start-1">
        <span
          className={cn(
            interCompanyInputClass,
            "invisible whitespace-pre border border-transparent px-3 text-sm pointer-events-none min-w-[25mm]"
          )}
          aria-hidden
        >
          {numericMeasure}
        </span>
        <div
          className={cn(
            interCompanyInputClass,
            interCompanyAmountInputSizingClass,
            "inline-flex h-9 min-w-[25mm] max-w-full items-center gap-1 px-3 py-0 pr-8",
            className
          )}
        >
          <Input
            {...inputProps}
            type="number"
            placeholder={numericMeasure || "0.00"}
            className="h-8 min-w-[3ch] flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
          <span className="shrink-0 text-sm font-medium tabular-nums" aria-hidden>
            Cr
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-grid max-w-full [&>*]:col-start-1 [&>*]:row-start-1">
      <span
        className={cn(
          interCompanyInputClass,
          "invisible whitespace-pre border border-transparent px-3 text-sm pointer-events-none min-w-[25mm]"
        )}
        aria-hidden
      >
        {measure}
      </span>
      <Input
        {...inputProps}
        placeholder={placeholder}
        className={cn(interCompanyInputClass, interCompanyAmountInputSizingClass, className)}
      />
    </div>
  );
}

/** Label box + amount box — ek row (panel ke andar) */
function InterCompanyAmountSideRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InterCompanyAmountLabelBox>{label}</InterCompanyAmountLabelBox>
      {children}
    </div>
  );
}

export function InterCompanyAmountDualFields({
  control,
  amount,
  formatCurrencyForPrint,
  fieldsDisabled,
  editLocked,
  showOtherCharge = false,
  otherChargeEnabled = false,
  onOtherChargeEnabledChange,
  otherChargeAccountOptions = [],
  otherChargeBalance = null,
  onOtherChargeDefault,
  otherChargeDefaultSaved = false,
  showOtherChargeDefault = true,
  otherChargeAccountId = "",
  otherChargeAddNewLabels = OTHER_CHARGE_ADD_NEW_LABELS,
  onOtherChargeAccountChange,
}: Props) {
  const targetDisplay = formatInterCompanyAmountDisplay(formatCurrencyForPrint, amount);
  const sourceReadOnly = Boolean(fieldsDisabled || editLocked);
  const showOtherChargeCard =
    showOtherCharge && (otherChargeEnabled || Boolean(otherChargeAccountId));

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className={amountSidePanelClass}>
        <FormField
          control={control}
          name="amount"
          render={({ field }) => {
            const formatted = formatInterCompanyAmountDisplay(
              formatCurrencyForPrint,
              Number(field.value) || 0
            );
            const sourceMeasure = formatInterCompanyAmountNumeric(
              formatCurrencyForPrint,
              Number(field.value) || 0
            );

            return (
              <FormItem className="min-w-0 space-y-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <InterCompanyAmountSideRow label="Payment (source)">
                    <FormControl>
                      <InterCompanyResponsiveAmountInput
                        displayText={sourceReadOnly ? formatted : sourceMeasure}
                        placeholder={AMOUNT_MEASURE_FALLBACK}
                        showCrSuffix={!sourceReadOnly}
                        readOnly={sourceReadOnly}
                        disabled={sourceReadOnly ? false : fieldsDisabled}
                        className={cn(sourceReadOnly && interCompanyReadOnlyCopyInputClass)}
                        {...(sourceReadOnly
                          ? {
                              type: "text" as const,
                              value: formatted,
                            }
                          : {
                              value: Number(field.value) || 0,
                              onChange: (e: ChangeEvent<HTMLInputElement>) => {
                                field.onChange(parseAmountInputString(e.target.value));
                              },
                              onBlur: () => {
                                const n = parseAmountInputString(String(field.value ?? ""));
                                field.onChange(n > 0 ? n : 0);
                              },
                            })}
                      />
                    </FormControl>
                  </InterCompanyAmountSideRow>
                  {showOtherCharge && !sourceReadOnly && !showOtherChargeCard ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-full border-blue-300 bg-blue-100 px-3 text-xs font-semibold text-blue-900 hover:bg-blue-200"
                      disabled={fieldsDisabled}
                      onClick={() => {
                        onOtherChargeEnabledChange?.(true);
                      }}
                    >
                      <PlusCircle className="mr-1 h-3.5 w-3.5" />
                      Other charge
                    </Button>
                  ) : null}
                </div>
                <FormMessage className="mt-1" />
              </FormItem>
            );
          }}
        />

        {showOtherChargeCard ? (
          <div className="mt-2 space-y-2 rounded-md border border-blue-200/80 bg-blue-50/40 p-2">
            <FormField
              control={control}
              name="otherChargeAccountId"
              render={({ field }) => (
                <FormItem className="min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel className="text-xs">Other Charge</FormLabel>
                    {!sourceReadOnly ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full px-2 text-xs"
                        disabled={fieldsDisabled}
                        onClick={() => onOtherChargeEnabledChange?.(false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  {otherChargeBalance !== null ? (
                    <p
                      className={cn(
                        "text-[10px] font-semibold text-right",
                        otherChargeBalance >= 0 ? "text-green-600" : "text-red-600"
                      )}
                    >
                      {formatCurrencyForPrint(Math.abs(otherChargeBalance), { noSuffix: true })}{" "}
                      {otherChargeBalance >= 0 ? "Dr" : "Cr"}
                    </p>
                  ) : null}
                  <div className="flex flex-nowrap items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className="block text-xs leading-tight text-muted-foreground invisible select-none"
                        aria-hidden
                      >
                        Amount
                      </span>
                      <Combobox
                        triggerClassName="h-9 w-full min-w-0"
                        options={otherChargeAccountOptions}
                        value={field.value}
                        onChange={(val, newName) => {
                          if (resolveOtherChargeAddNewType(val)) {
                            onOtherChargeAccountChange?.(val, newName);
                            return;
                          }
                          field.onChange(val);
                        }}
                        placeholder="Select account"
                        addNewLabels={otherChargeAddNewLabels}
                        disabled={fieldsDisabled || sourceReadOnly}
                      />
                    </div>
                    <FormField
                      control={control}
                      name="otherChargeAmount"
                      render={({ field: amountField }) => {
                        const ocFormatted = formatInterCompanyAmountDisplay(
                          formatCurrencyForPrint,
                          Number(amountField.value) || 0
                        );
                        const ocMeasure = formatInterCompanyAmountNumeric(
                          formatCurrencyForPrint,
                          Number(amountField.value) || 0
                        );
                        return (
                          <FormItem className="min-w-[5.5rem] shrink-0 space-y-1">
                            <FormLabel className="block text-xs leading-tight text-muted-foreground whitespace-nowrap">
                              Amount
                            </FormLabel>
                            <FormControl>
                              <InterCompanyResponsiveAmountInput
                                displayText={sourceReadOnly ? ocFormatted : ocMeasure}
                                placeholder={AMOUNT_MEASURE_FALLBACK}
                                showCrSuffix={!sourceReadOnly}
                                readOnly={sourceReadOnly}
                                disabled={sourceReadOnly ? false : fieldsDisabled}
                                className={cn(sourceReadOnly && interCompanyReadOnlyCopyInputClass)}
                                {...(sourceReadOnly
                                  ? {
                                      type: "text" as const,
                                      value: ocFormatted,
                                    }
                                  : {
                                      value: Number(amountField.value) || 0,
                                      onChange: (e: ChangeEvent<HTMLInputElement>) => {
                                        amountField.onChange(parseAmountInputString(e.target.value));
                                      },
                                      onBlur: () => {
                                        const n = parseAmountInputString(String(amountField.value ?? ""));
                                        amountField.onChange(n > 0 ? n : 0);
                                      },
                                    })}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                    {showOtherChargeDefault && (otherChargeAccountId || otherChargeDefaultSaved) && onOtherChargeDefault && !sourceReadOnly ? (
                      <div className="flex shrink-0 flex-col gap-1">
                        <span
                          className="block text-xs leading-tight text-muted-foreground invisible select-none"
                          aria-hidden
                        >
                          Amount
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-full px-3 text-sm font-medium"
                          onClick={onOtherChargeDefault}
                        >
                          {otherChargeDefaultSaved ? "Clear" : "Default"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : null}
      </div>

      <div className={amountSidePanelClass}>
        <InterCompanyAmountSideRow label="Receipt (target)">
          <InterCompanyResponsiveAmountInput
            type="text"
            readOnly
            aria-readonly
            displayText={targetDisplay}
            placeholder="Same as source"
            value={targetDisplay}
            className={cn("bg-muted/40", interCompanyReadOnlyCopyInputClass)}
          />
        </InterCompanyAmountSideRow>
      </div>
    </div>
  );
}
