"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { HrGate } from "@/modules/hr/components/HrGate";

const SalarySlipPage = dynamic(
  () => import("@/modules/hr/payroll/pages/SalarySlipPage").then((m) => m.SalarySlipPage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export function SlipIdRouteClient() {
  const params = useParams();
  const id = decodeURIComponent(String(params?.id || ""));
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HrGate>
        <SalarySlipPage id={id} />
      </HrGate>
    </Suspense>
  );
}
