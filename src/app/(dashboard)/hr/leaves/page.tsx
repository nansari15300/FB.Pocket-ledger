"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { HrGate } from "@/modules/hr/components/HrGate";

// Gate route level par (/hr jaisa); LeavesPage khud HrGate nahi lagata.
const LeavesPage = dynamic(
  () => import("@/modules/hr/pages/LeavesPage").then((m) => m.LeavesPage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export default function HrLeavesRoutePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HrGate>
        <LeavesPage />
      </HrGate>
    </Suspense>
  );
}
