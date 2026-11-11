"use client";

import * as React from "react";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  deriveMargin,
  formatMargin,
  itemBaseUnit,
  parseMargin,
  rateWithoutTax,
  salePriceFromMargin,
  salePriceForUnitRate,
  type ItemUnitConversion,
  type ItemUnitPriceRow,
  type MarginMode,
  type ParsedMargin,
} from "@/components/items/itemUnitPrices";

/*
 * Margin (Add/Edit Item) — sirf UI, save nahi hota. Ek hi source: form ka salePrice.
 * Kahin bhi margin type karo → salePriceFromMargin → form salePrice → computeItemUnitPrices →
 * Sale Unit Prices table, Margin card aur Sale Price pills sab apne-aap update. Rate = tax ke bina.
 */

/**
 * Ek margin pill. fixedMode diya ho to wahi mode (amount pill / % pill); warna "100" = amount,
 * "10%" = percent aur mode yaad rehta hai (default amount). Typing ke dauran apni value dobara compute nahi hoti.
 */
export function MarginInput({
  isOpen,
  purchaseRate,
  saleRate,
  fixedMode,
  disabled,
  onApply,
  className,
  placeholder,
  title,
  ariaLabel,
}: {
  isOpen: boolean;
  purchaseRate: number;
  saleRate: number;
  fixedMode?: MarginMode;
  disabled?: boolean;
  onApply: (margin: ParsedMargin) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const [mode, setMode] = React.useState<MarginMode>(fixedMode || "amount");
  const [text, setText] = React.useState("");
  const editingRef = React.useRef(false);

  // Dialog khulte hi default mode (margin save nahi hota)
  React.useEffect(() => {
    if (isOpen) {
      setMode(fixedMode || "amount");
      editingRef.current = false;
    }
  }, [isOpen, fixedMode]);

  const derived = formatMargin(deriveMargin(purchaseRate, saleRate, mode), mode);
  React.useEffect(() => {
    if (!editingRef.current) setText(derived);
  }, [derived]);

  const handleChange = (value: string) => {
    editingRef.current = true;
    setText(value);
    let parsed = parseMargin(value);
    if (!parsed) return;
    if (fixedMode) parsed = { mode: fixedMode, value: parsed.value };
    else if (parsed.mode !== mode) setMode(parsed.mode);
    if (parsed.mode === "percent" && !(Number(purchaseRate) || 0)) return; // purchase 0 → % se kuch nahi
    onApply(parsed);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={placeholder ?? "0"}
      title={title}
      aria-label={ariaLabel}
      value={text}
      readOnly={disabled}
      onFocus={() => {
        if (!disabled) editingRef.current = true;
      }}
      onChange={(e) => {
        if (!disabled) handleChange(e.target.value);
      }}
      onBlur={() => {
        editingRef.current = false;
        setText(derived);
      }}
      className={cn("h-9 text-right", disabled && "bg-muted cursor-not-allowed", className)}
    />
  );
}

type SaleMarginCommon = {
  isOpen: boolean;
  units: string[];
  unitPrices: Record<string, ItemUnitPriceRow>;
  conversions?: ItemUnitConversion[] | null;
  salePriceUnit?: string | null;
  saleTaxRate?: number;
  saleInclusive?: boolean;
  disabled?: boolean;
  onSalePriceChange: (salePrice: number) => void;
};

function applyForUnit(props: SaleMarginCommon, unit: string, purchaseRate: number, margin: ParsedMargin) {
  const salePrice = salePriceFromMargin({
    conversions: props.conversions,
    units: props.units,
    unit,
    purchaseRate,
    margin,
    salePriceUnit: props.salePriceUnit,
    saleTaxRate: props.saleTaxRate,
    saleInclusive: props.saleInclusive,
  });
  if (salePrice != null) props.onSalePriceChange(salePrice);
}

/**
 * Sale Unit Prices table ki Rate cell (editable, tax ke bina). Type karo → us unit ka rate se form ka
 * salePrice (current salePriceUnit me; Inclusive ho to tax jod kar) → baaki rows / Margin / pills update.
 * Focus ke dauran apna draft rehta hai (overwrite nahi), blur par 2 decimals.
 */
export function SaleUnitRateInput(props: SaleMarginCommon & { unit: string; rate: number }) {
  const { isOpen, unit, rate, disabled } = props;
  const [text, setText] = React.useState("");
  const editingRef = React.useRef(false);
  const formatted = (Number(rate) || 0).toFixed(2);

  React.useEffect(() => {
    if (isOpen) editingRef.current = false;
  }, [isOpen]);
  React.useEffect(() => {
    if (!editingRef.current) setText(formatted);
  }, [formatted]);

  const handleChange = (value: string) => {
    editingRef.current = true;
    setText(value);
    const s = value.replace(/,/g, "").trim();
    if (!/^\+?(\d+\.?\d*|\.\d+)$/.test(s)) return;
    const salePrice = salePriceForUnitRate({
      conversions: props.conversions,
      units: props.units,
      unit,
      targetRate: Number(s),
      salePriceUnit: props.salePriceUnit,
      saleTaxRate: props.saleTaxRate,
      saleInclusive: props.saleInclusive,
    });
    if (salePrice != null) props.onSalePriceChange(salePrice);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      aria-label={`Sale rate ${unit}`}
      value={text}
      readOnly={disabled}
      onFocus={() => {
        if (!disabled) editingRef.current = true;
      }}
      onChange={(e) => {
        if (!disabled) handleChange(e.target.value);
      }}
      onBlur={() => {
        editingRef.current = false;
        setText(formatted);
      }}
      className={cn("h-9 text-right", disabled && "bg-muted cursor-not-allowed")}
    />
  );
}

/**
 * Purchase Unit Prices aur Sale Unit Prices ke beech "Margin" card (sirf PC / sm+).
 * Har unit row ek pill: "100" = amount, "10%" = percent.
 */
export function ItemMarginCard(props: SaleMarginCommon) {
  const { isOpen, units, unitPrices, disabled } = props;
  return (
    <div className="hidden sm:block shrink-0 sm:order-4 w-36 space-y-2 border p-4 rounded-md">
      <FormLabel className="text-base font-semibold">Margin</FormLabel>
      <div className="grid grid-cols-1 gap-x-2 gap-y-2 items-center">
        <FormLabel className="text-right">Amt / %</FormLabel>
        {units.map((unit) => {
          const row = unitPrices[unit];
          const purchaseRate = Number(row?.purchase) || 0;
          return (
            <MarginInput
              key={`margin-${unit}`}
              isOpen={isOpen}
              purchaseRate={purchaseRate}
              saleRate={Number(row?.sale) || 0}
              disabled={disabled}
              title="100 = amount, 10% = percent"
              ariaLabel={`Margin ${unit}`}
              onApply={(m) => applyForUnit(props, unit, purchaseRate, m)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Sale Price card me price Input aur unit Select ke beech do pills: margin amount, margin %.
 * Purchase Price ko sale price unit me badal kar (tax ke bina) margin. Sab views me dikhta hai.
 */
export function SaleMarginPills(
  props: SaleMarginCommon & {
    purchasePrice?: number | string | null;
    salePrice?: number | string | null;
    purchaseTaxRate?: number;
    purchaseInclusive?: boolean;
  }
) {
  const { isOpen, unitPrices, disabled } = props;
  const unit = String(props.salePriceUnit ?? "").trim() || itemBaseUnit(props.conversions);
  const row = unit ? unitPrices[unit] : undefined;
  const purchaseRate = row
    ? Number(row.purchase) || 0
    : rateWithoutTax(props.purchasePrice, props.purchaseTaxRate, props.purchaseInclusive);
  const saleRate = row
    ? Number(row.sale) || 0
    : rateWithoutTax(props.salePrice, props.saleTaxRate, props.saleInclusive);
  const onApply = (m: ParsedMargin) => applyForUnit(props, unit, purchaseRate, m);
  return (
    <div className="flex shrink-0 items-end gap-2">
      <MarginInput
        isOpen={isOpen}
        purchaseRate={purchaseRate}
        saleRate={saleRate}
        fixedMode="amount"
        disabled={disabled}
        placeholder="Margin"
        title="Margin amount (tax ke bina)"
        ariaLabel="Margin amount"
        className="w-24"
        onApply={onApply}
      />
      <MarginInput
        isOpen={isOpen}
        purchaseRate={purchaseRate}
        saleRate={saleRate}
        fixedMode="percent"
        disabled={disabled}
        placeholder="%"
        title="Margin % (tax ke bina)"
        ariaLabel="Margin percent"
        className="w-20"
        onApply={onApply}
      />
    </div>
  );
}
