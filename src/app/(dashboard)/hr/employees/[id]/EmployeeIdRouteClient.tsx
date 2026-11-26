"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";

/**
 * Old employee detail URL. Employees are edited in the shared Edit Staff form
 * (double-click a row on /hr/employees), so this route only sends the user back to the list.
 */
export function EmployeeIdRouteClient() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/hr/employees");
  }, [router]);
  return <LoadingSpinner />;
}
