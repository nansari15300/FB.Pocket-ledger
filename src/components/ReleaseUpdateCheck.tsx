"use client";

import { useCallback, useEffect, useState } from "react";
import {
  androidDownloadAndInstallUpdate,
  androidUpdateUsesPlayStore,
  canAndroidInAppUpdate,
} from "@/lib/androidReleaseUpdate";
import {
  canElectronAutoInstallUpdate,
  electronDownloadAndInstallUpdate,
  formatUpdateDownloadProgress,
  subscribeElectronUpdateDownloadProgress,
} from "@/lib/electronReleaseUpdate";
import {
  checkForReleaseUpdate,
  RELEASE_UPDATE_FOUND_EVENT,
  RELEASE_UPDATE_MANUAL_CHECK_EVENT,
  type ReleaseUpdateInfo,
} from "@/lib/releaseUpdateCheck";
import { recordReleaseUpdateDownload } from "@/lib/websiteDownloadEventClient";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";

function ReleaseUpdateBanner({
  update,
  onDismiss,
}: {
  update: ReleaseUpdateInfo;
  onDismiss: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "downloading" | "launching" | "error">("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [playStoreFlow, setPlayStoreFlow] = useState(false);
  const electronAutoInstall = canElectronAutoInstallUpdate();
  const androidInAppUpdate = canAndroidInAppUpdate();

  useEffect(() => {
    if (!electronAutoInstall) return;
    return subscribeElectronUpdateDownloadProgress(({ received, total, reused }) => {
      if (reused) {
        setProgressLabel("Installer ready…");
        return;
      }
      setProgressLabel(formatUpdateDownloadProgress(received, total));
    });
  }, [electronAutoInstall]);

  const onInstall = useCallback(async () => {
    // Matches the admin Download analytics platforms: windows (EXE), android (APK), play (Play Store).
    const trackPlatform =
      update.kind === "desktop" ? "windows" : androidUpdateUsesPlayStore(update) ? "play" : "android";
    void recordReleaseUpdateDownload({
      platform: trackPlatform,
      // The NEW version being installed.
      version: update.version,
      fileName: (update.url.split("?")[0].split("#")[0].split("/").pop() || "").slice(0, 160),
      source: "in_app_update",
    });

    if (update.kind === "android" && androidInAppUpdate) {
      setPhase("downloading");
      setErrorMessage("");
      setProgressLabel("Downloading…");
      const result = await androidDownloadAndInstallUpdate(update, ({ received, total, reused }) => {
        if (reused) {
          setProgressLabel("Opening installer…");
          return;
        }
        setProgressLabel(formatUpdateDownloadProgress(received, total));
      });
      if (!result.ok) {
        setPhase("error");
        setErrorMessage(result.error || "Could not start the update.");
        return;
      }
      setPlayStoreFlow(Boolean(result.playStore));
      setPhase("launching");
      setProgressLabel(result.playStore ? "Opening Play Store…" : "Opening installer…");
      return;
    }

    if (update.kind === "desktop" && electronAutoInstall) {
      setPhase("downloading");
      setErrorMessage("");
      setProgressLabel("Downloading…");
      const result = await electronDownloadAndInstallUpdate(update);
      if (!result.ok) {
        setPhase("error");
        setErrorMessage(result.error || "Could not start the update.");
        return;
      }
      setPhase("launching");
      setProgressLabel("Starting installer…");
      return;
    }

    window.location.assign(update.url);
  }, [androidInAppUpdate, electronAutoInstall, update]);

  const busy = phase === "downloading" || phase === "launching";
  const inAppInstall = (update.kind === "android" && androidInAppUpdate) || electronAutoInstall;
  const actionLabel =
    phase === "launching"
      ? playStoreFlow
        ? "Play Store…"
        : "Installing…"
      : phase === "downloading"
        ? progressLabel || "Downloading…"
        : inAppInstall
          ? "Install update"
          : "Download update";

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[200] mx-auto flex max-w-xl flex-col gap-2 rounded-xl border border-sky-300 bg-white px-4 py-3 text-sm shadow-xl dark:border-sky-600 dark:bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-slate-900 dark:text-slate-100">
          Pocket Ledger {update.version} is available.
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-slate-500 underline underline-offset-2 disabled:opacity-50"
            onClick={onDismiss}
            disabled={busy}
          >
            Later
          </button>
          <button
            type="button"
            className="rounded-full bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-70"
            onClick={() => void onInstall()}
            disabled={busy}
          >
            {actionLabel}
          </button>
        </div>
      </div>
      {phase === "error" && errorMessage ? (
        <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      ) : null}
      {phase === "launching" && update.kind === "desktop" && electronAutoInstall ? (
        <p className="text-xs text-muted-foreground">
          The installer will open and Pocket Ledger will close. Follow the setup steps to finish.
        </p>
      ) : null}
      {phase === "launching" && update.kind === "android" && androidInAppUpdate && !playStoreFlow ? (
        <p className="text-xs text-muted-foreground">
          Tap <strong>Install</strong> on the Android screen to finish the update.
        </p>
      ) : null}
      {phase === "launching" && playStoreFlow ? (
        <p className="text-xs text-muted-foreground">Complete the update in the Play Store.</p>
      ) : null}
    </div>
  );
}

/**
 * EXE/APK only: daily auto check + manual check from Settings shows this banner.
 */
export function ReleaseUpdateCheck() {
  const [update, setUpdate] = useState<ReleaseUpdateInfo | null>(null);

  const runCheck = useCallback(async (force: boolean) => {
    if (!isElectronDesktopApp() && !isCapacitorNativeApp()) return;
    const result = await checkForReleaseUpdate({ force });
    if (result.status === "update") setUpdate(result.update);
  }, []);

  useEffect(() => {
    if (!isElectronDesktopApp() && !isCapacitorNativeApp()) return;
    void runCheck(false);
  }, [runCheck]);

  useEffect(() => {
    const onManual = () => {
      void runCheck(true);
    };
    const onFound = (event: Event) => {
      const detail = (event as CustomEvent<ReleaseUpdateInfo>).detail;
      if (detail?.version && detail?.url) setUpdate(detail);
    };
    window.addEventListener(RELEASE_UPDATE_MANUAL_CHECK_EVENT, onManual);
    window.addEventListener(RELEASE_UPDATE_FOUND_EVENT, onFound);
    return () => {
      window.removeEventListener(RELEASE_UPDATE_MANUAL_CHECK_EVENT, onManual);
      window.removeEventListener(RELEASE_UPDATE_FOUND_EVENT, onFound);
    };
  }, [runCheck]);

  if (!update) return null;
  return <ReleaseUpdateBanner update={update} onDismiss={() => setUpdate(null)} />;
}
