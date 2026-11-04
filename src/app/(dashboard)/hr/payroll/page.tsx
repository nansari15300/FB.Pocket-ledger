"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { HrGate } from "@/modules/hr/components/HrGate";

const PayrollPage = dynamic(
  () => import("@/modules/hr/payroll/pages/PayrollPage").then((m) => m.PayrollPage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export default function HrPayrollRoutePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HrGate>
        <PayrollPage />
      </HrGate>
    </Suspense>
  );
}
