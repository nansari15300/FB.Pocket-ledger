"use client";

/**
 * Master forms — 2 fields per row; naam + A/c No ek row; shared Mobile No.
 */
import type { ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { masterFormRowClassName } from "@/lib/masterFormPillChrome";
import { MasterFormInterCompanyAcNoSlot } from "@/components/inter-company/MasterFormInterCompanyAcNoSlot";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

/** Har master form — mobile+ par 2 column; `pl-master-form-row` = pill height + align (`globals.css`) */
export const masterFormTwoColClass =
  "pl-master-form-row grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-stretch";

/** Full-width row (address, photo, documents, …) — Pro theme row pill cycle */
export function MasterFormRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(masterFormRowClassName, className)}>{children}</div>;
}

export function MasterFormTwoColGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(masterFormTwoColClass, className)}>{children}</div>;
}

/** Account / party naam (left) + Inter Co. A/c No (right); optional row naam ↔ A/c No ke beech (mobile stack). */
export function MasterFormNameAcNoRow({
  entityKind,
  entityId,
  mode = "edit",
  nameField,
  betweenNameAndAcNoRow,
}: {
  entityKind: InterCompanyEntityKind;
  entityId?: string | null;
  mode?: "create" | "edit";
  nameField: ReactNode;
  /** e.g. bank minus-balance checkbox — mobile par naam ke neeche, A/c No ke upar */
  betweenNameAndAcNoRow?: ReactNode;
}) {
  if (!isInterCompanySystemEnabled()) {
    return (
      <div className={cn(masterFormTwoColClass, "col-span-full sm:col-span-full")}>
        <div className="min-w-0 col-span-full">{nameField}</div>
        {betweenNameAndAcNoRow ? (
          <div className="col-span-full min-w-0">{betweenNameAndAcNoRow}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={cn(
        masterFormTwoColClass,
        "col-span-full sm:col-span-full",
        betweenNameAndAcNoRow && "grid-flow-dense"
      )}
    >
      <div className="min-w-0 order-1">{nameField}</div>
      {betweenNameAndAcNoRow ? (
        <div className="col-span-full order-2 min-w-0">{betweenNameAndAcNoRow}</div>
      ) : null}
      <div className={cn("min-w-0", betweenNameAndAcNoRow ? "order-3 sm:order-2" : undefined)}>
        <MasterFormInterCompanyAcNoSlot entityKind={entityKind} entityId={entityId} mode={mode} />
      </div>
    </div>
  );
}

export function MasterMobileNoField<T extends FieldValues>({
  control,
  name = "phone" as FieldPath<T>,
  placeholder = "Mobile number",
}: {
  control: Control<T>;
  name?: FieldPath<T>;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex h-full flex-col">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <FormLabel className="text-xs sm:text-sm">Mobile No.</FormLabel>
            <FormField
              control={control}
              name={"whatsapp" as FieldPath<T>}
              render={({ field: whatsappField }) => (
                <FormItem className="flex shrink-0 items-center gap-1.5 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={whatsappField.value === true}
                      onCheckedChange={whatsappField.onChange}
                      aria-label="WhatsApp number"
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer text-xs font-normal">WhatsApp</FormLabel>
                </FormItem>
              )}
            />
          </div>
          <FormControl>
            <Input
              inputMode="tel"
              placeholder={placeholder}
              {...field}
              value={field.value == null ? "" : String(field.value)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
