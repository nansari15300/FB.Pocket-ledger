"use client";

import { useEffect } from "react";
import {
  ITEM_UNIT_FIELD_KEYS,
  chainUnitConversions,
  normalizeItemUnits,
  type ItemUnitConversion,
  type ItemUnitFieldValues,
} from "@/components/items/itemUnitPrices";

type UnitFormLike = {
  getValues: (name: any) => any;
  setValue: (name: any, value: any, options?: any) => void;
};

/** Unit Conversions ke kisi input me abhi typing chal rahi hai? (RHF `name` attribute) */
function isEditingUnitConversion(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  const name = el && typeof el.getAttribute === "function" ? el.getAttribute("name") || "" : "";
  return name.startsWith("unitConversions.");
}

/**
 * Unit Conversions badalte hi Purchase/Sale price unit, Low Stock unit aur Opening Stock unit ko
 * current unit set pe le aata hai (hatai gayi unit → base unit). Unit input me typing ke beech nahi chalta:
 * thoda ruk kar (debounce) ya focus bahar jaane par chalta hai. Sirf badli hui value par setValue (loop nahi).
 * chain: true → row i>0 ka fromUnit = row i-1 ka toUnit bhi sync (Edit Item).
 */
export function useItemUnitAutoNormalize(
  form: UnitFormLike,
  watchedUnitConversions: unknown,
  opts: { enabled: boolean; chain: boolean; delayMs?: number },
): void {
  const { enabled, chain, delayMs = 300 } = opts;
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let cancelled = false;
    const run = () => {
      if (cancelled || isEditingUnitConversion()) return;
      const rows = ((form.getValues("unitConversions") as ItemUnitConversion[] | undefined) || []);
      if (chain) {
        rows.forEach((row, i) => {
          if (i === 0) return;
          const prevTo = String(rows[i - 1]?.toUnit ?? "");
          if (String(row?.fromUnit ?? "") !== prevTo) {
            form.setValue(`unitConversions.${i}.fromUnit`, prevTo, { shouldDirty: true });
          }
        });
      }
      const state: ItemUnitFieldValues = {};
      for (const key of ITEM_UNIT_FIELD_KEYS) {
        state[key] = (form.getValues(key) as string | null | undefined) ?? "";
      }
      const { patch } = normalizeItemUnits(chain ? chainUnitConversions(rows) : rows, state);
      for (const [key, value] of Object.entries(patch)) {
        form.setValue(key, value, { shouldDirty: true });
      }
    };
    const timer = window.setTimeout(run, delayMs);
    const onFocusOut = () => {
      window.setTimeout(run, 0);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [form, watchedUnitConversions, enabled, chain, delayMs]);
}
