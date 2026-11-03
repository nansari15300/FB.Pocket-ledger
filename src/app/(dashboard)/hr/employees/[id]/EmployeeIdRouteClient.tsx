"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";

// EmployeeDetailsPage khud HrGate me wrapped hai.
const EmployeeDetailsPage = dynamic(
  () => import("@/modules/hr/pages/EmployeeDetailsPage").then((m) => m.EmployeeDetailsPage),
  { ssr: false, loading: () => <LoadingSpinner /> }
);

export function EmployeeIdRouteClient() {
  const params = useParams();
  const id = decodeURIComponent(String(params?.id || ""));
  return <EmployeeDetailsPage employeeId={id} />;
}
