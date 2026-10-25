"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  allowRecoveryRedirect,
  isRecoveryModeActive,
  isRecoveryRoutePath,
  RECOVERY_ROUTE,
} from "@/lib/recovery/recoveryMode";

/**
 * While "Login as recovery mode?" is on (desktop app), every page except /recovery sends the user
 * to /recovery, so the normal company list and app pages stay closed. Renders nothing otherwise.
 */
export function RecoveryModeGate() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    const onRecoveryPage = isRecoveryRoutePath(pathname) || isRecoveryRoutePath(window.location.pathname);
    if (!onRecoveryPage && isRecoveryModeActive()) {
      // Loop guard: never bounce between pages endlessly.
      if (!allowRecoveryRedirect()) {
        setBlocking(false);
        return;
      }
      setBlocking(true);
      router.replace(RECOVERY_ROUTE);
    } else {
      setBlocking(false);
    }
  }, [pathname, router]);

  if (!blocking) return null;
  return <div className="fixed inset-0 z-[9999] bg-background" aria-busy="true" />;
}