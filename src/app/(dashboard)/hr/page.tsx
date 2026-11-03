"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { HrGate } from "@/modules/hr/components/HrGate";

const HrHomePage = dynamic(
  () => import("@/modules/hr/pages/HrHomePage").then((m) => m.HrHomePage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export default function HrRoutePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HrGate>
        <HrHomePage />
      </HrGate>
    </Suspense>
  );
}
