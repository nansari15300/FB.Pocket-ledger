"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { ALLOW_VOUCHER_MINUS_BALANCE_INFO } from "@/lib/bankAccountMinusBalancePolicy";

/** Bank/Cash master — minus balance allow; bordered box + info i icon */
export function AllowVoucherMinusBalanceField<T extends FieldValues>({
  control,
  name = "allowVoucherMinusBalance" as FieldPath<T>,
  className,
}: {
  control: Control<T>;
  name?: FieldPath<T>;
  className?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={cn(
            // Bank form inputs tone match: soft blue bg + blue border.
            "flex flex-row items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50/60 p-3 space-y-0",
            className
          )}
        >
          <FormControl>
            <Checkbox
              checked={field.value === true}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <FormLabel className="cursor-pointer font-normal text-sm leading-snug">
              Allow minus balance
            </FormLabel>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AppFreshInfoButton
                    size="xs"
                    aria-label="About allowing minus balance on vouchers"
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed" data-pl-intro="">
                  {ALLOW_VOUCHER_MINUS_BALANCE_INFO}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </FormItem>
      )}
    />
  );
}
