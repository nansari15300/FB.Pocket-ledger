"use client";

import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { CreateCompanyForm } from "@/components/company/CreateCompanyForm";
import { EditCompanyForm } from "@/components/company/EditCompanyForm";
import {
  ForceUploadLocalDataButton,
  type ForceUploadInlineProgress,
} from "@/components/company/ForceUploadLocalDataButton";
import { UploadCompanyToCloudCard } from "@/components/company/UploadCompanyToCloudCard";
import { LocalCompanyPocketBaseNotice } from "@/components/company/LocalCompanyPocketBaseNotice";
import { useCompany } from "@/hooks/useCompany";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "../ui/card";
import {
  companyProfileChromeRoot,
  companyProfileGreenZone,
  companyProfilePageBg,
  companyProfileTabsList,
  companyProfileTabsTrigger,
} from "@/lib/companyProfileChrome";

function ForceUploadProgressStrip({ progress }: { progress: ForceUploadInlineProgress }) {
  const failed = progress.status === "failed";
  const complete = progress.status === "complete";
  const running = progress.status === "running";
  const pct = Math.min(100, Math.max(0, progress.percent));
  const countLabel =
    progress.total > 1 ? ` (${progress.done}/${progress.total})` : "";

  return (
    <div
      className={`mx-6 mb-2 rounded-md border px-3 py-2 ${
        failed
          ? "border-destructive/40 bg-destructive/5"
          : complete
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border bg-background/80"
      }`}
      role="status"
      aria-live="polite"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`relative h-[14px] w-full overflow-hidden rounded-sm border ${
          failed ? "border-destructive/50" : "border-border"
        }`}
      >
        <div className="absolute inset-0 bg-muted/90" />
        {pct > 0 ? (
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-300 ease-out ${
              complete ? "bg-emerald-600" : failed ? "bg-destructive" : "bg-emerald-500"
            } ${running ? "animate-pulse" : ""}`}
            style={{ width: `${pct}%` }}
          />
        ) : null}
        <div className="relative z-10 flex h-full items-center justify-center px-2">
          <span
            className={`truncate text-[10px] font-semibold leading-none ${
              failed ? "text-destructive" : "text-black"
            }`}
          >
            {failed
              ? progress.message || "Force upload failed"
              : complete
                ? `Force upload — 100% ✓`
                : `${progress.phase} — ${pct}%${countLabel}`}
          </span>
        </div>
      </div>
      {progress.message ? (
        <p
          className={`mt-1 truncate text-center text-[10px] leading-tight ${
            failed
              ? "text-destructive"
              : complete
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground"
          }`}
        >
          {progress.message}
        </p>
      ) : null}
    </div>
  );
}

export function CompanySettings({ readOnly = false }: { readOnly?: boolean }) {
  const { company, setCompanyId } = useCompany();
  const router = useRouter();
  const selectedCompanyName = String(company?.name || "").trim();
  const [forceUploadProgress, setForceUploadProgress] = useState<ForceUploadInlineProgress | null>(
    null
  );

  const handleCompanyCreated = (companyId: string) => {
    setCompanyId(companyId);
    router.replace("/dashboard");
  };

  return (
    <Card
      className={`border border-black ${companyProfilePageBg}`}
      {...{ [companyProfileChromeRoot]: "" }}
    >
      <CardHeader className={companyProfilePageBg}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Company Profile</span>
              {selectedCompanyName ? (
                <>
                  <span className="text-muted-foreground font-normal tracking-tight" aria-hidden>
                    ----&gt;
                  </span>
                  <span className="text-base sm:text-lg font-semibold" title={selectedCompanyName}>
                    {selectedCompanyName}
                  </span>
                </>
              ) : null}
            </CardTitle>
            <CardDescription>
              {readOnly
                ? "View company profile (read-only). Force upload can still push local data to the server."
                : "Manage your company profile or create a new one."}
            </CardDescription>
          </div>
          <ForceUploadLocalDataButton onInlineProgress={setForceUploadProgress} />
        </div>
        <LocalCompanyPocketBaseNotice />
        {readOnly ? (
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-200 rounded-md border border-amber-200 bg-amber-50/90 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2">
            You can view this page but cannot edit company settings.
          </p>
        ) : null}
      </CardHeader>
      {forceUploadProgress ? <ForceUploadProgressStrip progress={forceUploadProgress} /> : null}
      {readOnly ? (
        <div className={`w-full px-6 pb-6 pt-0`}>
          <div className={`mt-3 p-4 ${companyProfileGreenZone}`}>
            <EditCompanyForm readOnly />
          </div>
        </div>
      ) : (
      <Tabs defaultValue="edit_company" className="w-full px-6 pb-6 pt-0">
        <TabsList className={companyProfileTabsList}>
          <TabsTrigger value="edit_company" className={companyProfileTabsTrigger}>
            Edit Current Company
          </TabsTrigger>
          <TabsTrigger value="add_company" className={companyProfileTabsTrigger}>
            Add New Company
          </TabsTrigger>
        </TabsList>
        <TabsContent value="edit_company" className={`mt-3 p-4 ${companyProfileGreenZone}`}>
          <div className="space-y-4">
            <UploadCompanyToCloudCard />
            <EditCompanyForm />
          </div>
        </TabsContent>
        <TabsContent value="add_company" className={`mt-3 p-4 ${companyProfileGreenZone}`}>
          <CreateCompanyForm onCompanyCreated={handleCompanyCreated} />
        </TabsContent>
      </Tabs>
      )}
    </Card>
  );
}
