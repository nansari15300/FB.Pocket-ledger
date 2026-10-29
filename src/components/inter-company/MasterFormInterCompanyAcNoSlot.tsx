"use client";

/**
 * Master create/edit — entity Inter Co. A/c No (P/B/S/T/E prefix, read-only + backfill).
 */
import { FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { INTER_COMPANY_ENTITY_LABELS } from "@/components/inter-company/InterCompanyEntitySide";
import { INTER_COMPANY_AC_PREFIX } from "@/lib/interCompany/interCompanyAccountNo";
import { useEntityInterCompanyAcNo } from "@/lib/interCompany/useEntityInterCompanyAcNo";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Props = {
  entityKind: InterCompanyEntityKind;
  entityId?: string | null;
  mode?: "create" | "edit";
};

export function MasterFormInterCompanyAcNoSlot({
  entityKind,
  entityId,
  mode = "edit",
}: Props) {
  const prefix = INTER_COMPANY_AC_PREFIX[entityKind];
  const label = INTER_COMPANY_ENTITY_LABELS[entityKind];
  const { acNo, loading } = useEntityInterCompanyAcNo({
    entityKind,
    entityId: mode === "edit" ? entityId : null,
    autoEnsure: mode === "edit" && Boolean(entityId),
  });

  if (!isInterCompanySystemEnabled()) return null;

  if (mode === "create") {
    return (
      <FormItem className="flex h-full flex-col">
        <div className="flex min-h-7 items-center">
          <FormLabel className="text-xs sm:text-sm">A/c No (Inter Co.)</FormLabel>
        </div>
        <FormControl>
          <Input
            readOnly
            disabled
            value=""
            placeholder={`Auto ${prefix} + 14 digits on save`}
            className="text-xs sm:text-sm font-mono tabular-nums bg-muted/40"
            title={`${label} save par unique Inter Company A/c No assign hoga`}
          />
        </FormControl>
      </FormItem>
    );
  }

  return (
    <FormItem className="flex h-full flex-col">
      <div className="flex min-h-7 items-center">
        <FormLabel className="text-xs sm:text-sm">A/c No (Inter Co.)</FormLabel>
      </div>
      <FormControl>
        <div className="relative">
          <Input
            readOnly
            value={loading ? "" : acNo || "—"}
            placeholder={loading ? "Generating…" : `${prefix} + 14 digits`}
            className="text-xs sm:text-sm font-mono tabular-nums bg-muted/40 pr-8"
            title={`${label} — Inter Company account number`}
          />
          {loading ? (
            <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </FormControl>
    </FormItem>
  );
}
