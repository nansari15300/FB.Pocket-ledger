"use client";

/**
 * Company master — 12-char alphanumeric Company Code display / auto backfill.
 */
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useCompanyInterCompanyCode } from "@/lib/interCompany/useCompanyInterCompanyCode";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Props = {
  /** Create form: abhi company save nahi — placeholder hint */
  mode?: "edit" | "create";
};

export function CompanyInterCompanyCodeField({ mode = "edit" }: Props) {
  const { companyCode, loading } = useCompanyInterCompanyCode({
    autoEnsure: mode === "edit",
  });

  if (!isInterCompanySystemEnabled()) return null;

  if (mode === "create") {
    return (
      <div className="space-y-1.5">
        <FormLabel className="text-xs sm:text-sm">Company Code (Inter Co.)</FormLabel>
        <Input
          disabled
          value=""
          placeholder="Auto 12-char code on save"
          className="text-xs sm:text-sm font-mono uppercase"
        />
        <p className="text-[11px] text-muted-foreground">
          Company save par unique 12-character code (letters + numbers) assign hoga.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <FormLabel>Company Code (Inter Co.)</FormLabel>
      <div className="flex gap-2">
        <Input
          readOnly
          value={loading ? "" : companyCode || "—"}
          placeholder={loading ? "Generating…" : "12 chars (A–Z, 0–9)"}
          className="font-mono uppercase tabular-nums"
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
            title="Copy Company Code"
            disabled={!companyCode}
            onClick={() => {
              if (!companyCode) return;
              void navigator.clipboard.writeText(companyCode);
              toast.success("Company Code copied");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        12 characters — letters and numbers mix. Inter-company vouchers me is code se target company select ho sakti hai.
      </p>
    </div>
  );
}
