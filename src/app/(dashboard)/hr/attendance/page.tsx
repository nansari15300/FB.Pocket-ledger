"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { HrGate } from "@/modules/hr/components/HrGate";

// Gate route level par (/hr jaisa); AttendancePage khud HrGate nahi lagata.
const AttendancePage = dynamic(
  () => import("@/modules/hr/pages/AttendancePage").then((m) => m.AttendancePage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export default function HrAttendanceRoutePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HrGate>
        <AttendancePage />
      </HrGate>
    </Suspense>
  );
}
