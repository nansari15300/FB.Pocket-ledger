"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  installWebAppBasePathHistoryGuard,
  repairAppUiPathInBrowser,
  webAppBasePath,
} from "@/lib/webAppBasePath";

/** Keep browser URL aligned with Next `basePath` when History API writes drop `/app`. */
export function WebAppBasePathUrlGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (!webAppBasePath()) return;
    installWebAppBasePathHistoryGuard();
    repairAppUiPathInBrowser();
    const t0 = window.setTimeout(() => repairAppUiPathInBrowser(), 0);
    const t1 = window.setTimeout(() => repairAppUiPathInBrowser(), 50);
    const t2 = window.setTimeout(() => repairAppUiPathInBrowser(), 250);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname]);

  return null;
}
