"use client";

import { useCallback } from "react";
import type { Control } from "react-hook-form";
import { toast as sonnerToast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useCompany } from "@/hooks/useCompany";
import {
  clearCompanyDiscountExpenseDefault,
  persistCompanyDiscountExpenseDefault,
  readCompanyDiscountExpenseDefault,
  type SalePurchaseDiscountSide,
} from "@/lib/salePurchaseDiscountDefault";

type Props = {
  control: Control<any>;
  side: SalePurchaseDiscountSide;
  disabled?: boolean;
  expenseAccountOptions: { value: string; label: string }[];
  /** Mobile totals strip vs desktop cyan box */
  variant?: "mobile" | "desktop";
  /** Default/Clear button only when creating a new voucher. */
  showDefaultControl?: boolean;
};

/** Discount row — expense (Adjustment default) + ± + amount; posts to adjustment on save. */
export function SalePurchaseDiscountAdjustmentRow({
  control,
  side,
  disabled,
  expenseAccountOptions,
  variant = "desktop",
  showDefaultControl = true,
}: Props) {
  const { company, companyId, reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const companyDefaultId = readCompanyDiscountExpenseDefault(side, company);

  const clearCompanyDefault = useCallback(async () => {
    if (!companyId) return;
    try {
      await clearCompanyDiscountExpenseDefault({
        side,
        companyId,
        company,
        reloadLocalCompanyRegistry,
        triggerSync,
      });
      sonnerToast.success("Default discount account cleared.");
    } catch {
      sonnerToast.error("Could not clear default discount account.");
    }
  }, [company, companyId, reloadLocalCompanyRegistry, side, triggerSync]);

  const setCompanyDefault = useCallback(
    async (accountId: string) => {
      const id = String(accountId || "").trim();
      if (!id || !companyId) return;
      try {
        await persistCompanyDiscountExpenseDefault({
          side,
          companyId,
          company,
          accountId: id,
          reloadLocalCompanyRegistry,
          triggerSync,
        });
        sonnerToast.success("Default discount account saved for all users.");
      } catch {
        sonnerToast.error("Could not save default discount account.");
      }
    },
    [company, companyId, reloadLocalCompanyRegistry, side, triggerSync]
  );

  const isMobile = variant === "mobile";
  const amountInputClass = isMobile
    ? "w-20 border rounded p-1 text-right text-xs h-[27px] shrink-0"
    : "w-28 text-right h-[27px]";
  const signTriggerClass = isMobile ? "h-[27px] w-12 text-xs px-1" : "h-[27px] w-14 px-2";

  return (
    <div className={cn("[&>*]:py-[3px]", !isMobile && "[&>*]:px-[10px]")} data-ocr-field="discount">
      <FormField
        control={control}
        name="discountExpenseAccountId"
        render={({ field }: any) => (
          <FormItem
            className={cn(
              "flex gap-2 space-y-0",
              isMobile ? "flex-col items-stretch" : "flex-row items-center justify-between"
            )}
          >
            <FormLabel className={cn("shrink-0", isMobile ? "text-xs" : undefined)}>
              Discount account:
            </FormLabel>
            <div
              className={cn(
                "flex items-center gap-1 min-w-0",
                isMobile ? "w-full justify-end" : "justify-end flex-1 max-w-[min(100%,20rem)]"
              )}
            >
              {showDefaultControl && (field.value || companyDefaultId) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "shrink-0 px-1.5 text-[10px] h-7",
                    companyDefaultId && "border-primary text-primary"
                  )}
                  disabled={disabled}
                  title="Set as default discount account for all users in this company"
                  onClick={() => void (companyDefaultId ? clearCompanyDefault() : setCompanyDefault(field.value))}
                >
                  {companyDefaultId ? "Clear" : "Default"}
                </Button>
              ) : null}
              <FormControl className="min-w-0 flex-1 w-max max-w-full">
                <Combobox
                  options={expenseAccountOptions}
                  value={field.value || ""}
                  disabled={disabled}
                  onChange={(val) => field.onChange(val === "none" ? "" : val)}
                  placeholder="Adjustment"
                  triggerClassName={isMobile ? "h-[27px] min-w-[132px]" : "h-[27px] min-w-[172px]"}
                  contentWidthMode="auto"
                  fitTrigger
                />
              </FormControl>
            </div>
          </FormItem>
        )}
      />
      <div
        className={cn(
          "flex space-y-0 border-t",
          isMobile ? "flex-row justify-between items-center gap-2" : "justify-between items-center"
        )}
      >
        <FormLabel className={cn("shrink-0", isMobile ? "text-xs" : undefined)}>Discount:</FormLabel>
        <div className="flex items-center gap-1 shrink-0">
          <FormField
            control={control}
            name="discountSign"
            render={({ field: signField }: any) => (
              <FormItem className="space-y-0">
                <Select
                  value={signField.value === "+" ? "+" : "-"}
                  onValueChange={signField.onChange}
                  disabled={disabled}
                >
                  <FormControl>
                    <SelectTrigger className={signTriggerClass} aria-label="Discount sign">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="-">−</SelectItem>
                    <SelectItem value="+">+</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="discount"
            render={({ field: amountField }: any) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className={amountInputClass}
                    {...amountField}
                    value={amountField.value ?? 0}
                    disabled={disabled}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  );
}
