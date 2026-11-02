"use client";

import { useCallback, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DESKTOP_APP_VERSION } from "@/config/releaseVersion";
import {
  checkForReleaseUpdate,
  dispatchReleaseUpdateFound,
  installedReleaseVersion,
} from "@/lib/releaseUpdateCheck";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

type Props = {
  rowClassName?: string;
};

export function CheckForUpdateSettingsRow({ rowClassName }: Props) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const installed = installedReleaseVersion();

  const onCheck = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkForReleaseUpdate({ force: true });
      if (result.status === "update") {
        dispatchReleaseUpdateFound(result.update);
        toast({
          title: "Update available",
          description: `Pocket Ledger ${result.update.version} is ready to install.`,
        });
        return;
      }
      if (result.status === "current") {
        toast({
          title: "Up to date",
          description: `You are on version ${result.installed}.`,
        });
        return;
      }
      if (result.status === "offline") {
        toast({
          title: "Offline",
          description: "Connect to the internet and try again.",
          variant: "destructive",
        });
        return;
      }
      if (result.status === "unsupported") {
        toast({
          title: "Not available",
          description: "Updates are checked from the Windows or Android app only.",
        });
        return;
      }
      toast({
        title: "Could not check",
        description: result.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }, [checking, toast]);

  if (!isElectronDesktopApp() && !isCapacitorNativeApp()) {
    const webVersion = String(DESKTOP_APP_VERSION || "").trim();
    if (!webVersion) return null;
    return (
      <div
        className={cn(
          "min-w-0 max-w-full w-full overflow-hidden py-2 px-3 border border-black rounded-md",
          "flex items-center gap-3 text-left text-sm",
          rowClassName
        )}
      >
        <span className="min-w-0 flex-1 truncate">Version</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">v{webVersion}</span>
      </div>
    );
  }

  const versionLabel = installed.version ? `v${installed.version}` : "";

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        className={cn(
          "min-w-0 max-w-full w-full overflow-hidden py-2 px-3 cursor-pointer border border-black rounded-md transition-all duration-200",
          "flex items-center gap-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "hover:bg-muted/30",
          checking && "opacity-70 pointer-events-none",
          rowClassName
        )}
        onClick={() => void onCheck()}
        disabled={checking}
      >
        {checking ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Download className="h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">Check for update</span>
        {versionLabel ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{versionLabel}</span>
        ) : null}
      </button>
    </div>
  );
}
