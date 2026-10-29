"use client";

/**
 * Company master — Inter Co. A/c No (15 digit) display / backfill.
 */
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useCompanyInterCompanyAcNo } from "@/lib/interCompany/useCompanyInterCompanyAcNo";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Props = {
  /** Create form: abhi company save nahi — placeholder hint */
  mode?: "edit" | "create";
};

export function CompanyInterCompanyAcNoField({ mode = "edit" }: Props) {
  const { acNo, loading } = useCompanyInterCompanyAcNo({
    autoEnsure: mode === "edit",
  });

  if (!isInterCompanySystemEnabled()) return null;

  if (mode === "create") {
    return (
      <div className="space-y-1.5">
        <FormLabel className="text-xs sm:text-sm">A/c No (Inter Co.)</FormLabel>
        <Input
          disabled
          value=""
          placeholder="Auto C + 14 digits on save"
          className="text-xs sm:text-sm font-mono tabular-nums"
        />
        <p className="text-[11px] text-muted-foreground">
          Company save par unique C-prefixed Inter Company A/c No assign hoga.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <FormLabel>A/c No (Inter Co.)</FormLabel>
      <div className="flex gap-2">
        <Input
          readOnly
          value={loading ? "" : acNo || "—"}
          placeholder={loading ? "Generating…" : "C + 14 digits"}
          className="font-mono tabular-nums"
        />
        {loading ? (
          <Button type="button" variant="outline" size="icon" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Copy A/c No"
            disabled={!acNo}
            onClick={() => {
              if (!acNo) return;
              void navigator.clipboard.writeText(acNo);
              toast.success("Inter Co. A/c No copied");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        In inter-company vouchers, the target company can also be selected using this number.
      </p>
    </div>
  );
}
