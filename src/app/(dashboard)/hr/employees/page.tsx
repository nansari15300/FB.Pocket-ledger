"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";

// EmployeesPage khud HrGate me wrapped hai.
const EmployeesPage = dynamic(
  () => import("@/modules/hr/pages/EmployeesPage").then((m) => m.EmployeesPage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export default function HrEmployeesRoutePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <EmployeesPage />
    </Suspense>
  );
}
