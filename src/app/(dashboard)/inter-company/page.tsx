"use client";

/**
 * Inter Company — New Trxn dialog me same UI (default tab inter_company).
 * Alerts "Go to" se `?icTab=join&companyId=` par Join ribbon khulta hai.
 */
import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import type { InterCompanyRibbonTab } from "@/components/inter-company/InterCompanyRibbonNav";
import { useCompany } from "@/hooks/useCompany";
import { Loader2 } from "lucide-react";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

export default function InterCompanyPage() {
  return (
    // `useSearchParams` — Next.js static prerender ke liye Suspense boundary
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InterCompanyPageContent />
    </Suspense>
  );
}

function InterCompanyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { companyId, loading, setCompanyId, allCompanies } = useCompany();
  const [open, setOpen] = useState(true);
  const icEnabled = isInterCompanySystemEnabled();
  const urlCompanyId = String(searchParams.get("companyId") || "").trim();
  const urlIcTab = String(searchParams.get("icTab") || "").trim();

  const initialInterCompanyRibbonTab = useMemo((): InterCompanyRibbonTab | undefined => {
    if (urlIcTab === "join" || urlIcTab === "voucher" || urlIcTab === "connect") {
      return urlIcTab;
    }
    // Legacy deep links (removed ribbons) → voucher
    if (urlIcTab === "revert_requests" || urlIcTab === "delete_requests") {
      return "voucher";
    }
    return undefined;
  }, [urlIcTab]);

  useEffect(() => {
    if (!icEnabled) router.replace("/dashboard");
  }, [icEnabled, router]);

  // Alert deep link — target company select karo taaki Join requests sahi company ke liye dikhein
  useEffect(() => {
    if (!icEnabled || !urlCompanyId) return;
    if (allCompanies.some((c) => c.id === urlCompanyId) && companyId !== urlCompanyId) {
      setCompanyId(urlCompanyId);
    }
  }, [icEnabled, urlCompanyId, allCompanies, companyId, setCompanyId]);

  if (!icEnabled) return null;

  if (loading && !companyId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6 text-center text-muted-foreground">
        Select a company to create inter-company transactions.
      </div>
    );
  }

  return (
    <AddVoucherDialog
      isOpen={open}
      onOpenChange={setOpen}
      defaultTab="inter_company"
      initialInterCompanyRibbonTab={initialInterCompanyRibbonTab}
      onVoucherAction={() => setOpen(false)}
    />
  );
}
