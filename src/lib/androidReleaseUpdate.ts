"use client";

import { Capacitor } from "@capacitor/core";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import type { ReleaseUpdateInfo } from "@/lib/releaseUpdateCheck";

export type AndroidUpdateProgress = { received: number; total: number; reused?: boolean };

export function canAndroidInAppUpdate(): boolean {
  if (!isCapacitorNativeApp()) return false;
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

function isPlayStoreUrl(url: string): boolean {
  const u = String(url || "").trim();
  return /play\.google\.com/i.test(u) || /^market:\/\//i.test(u);
}

function apkCachePath(version: string): string {
  const safe = String(version || "latest").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `pl-update-${safe}.apk`;
}

function isAabArtifact(update: ReleaseUpdateInfo): boolean {
  if (update.format === "aab") return true;
  return /\.aab(\?|$)/i.test(String(update.url || ""));
}

export async function androidDownloadAndInstallUpdate(
  update: ReleaseUpdateInfo,
  onProgress?: (payload: AndroidUpdateProgress) => void
): Promise<{ ok: boolean; error?: string; playStore?: boolean }> {
  if (!canAndroidInAppUpdate()) {
    return { ok: false, error: "In-app update is only available on Android." };
  }

  const playStoreUrl = String(update.playStoreUrl || "").trim();
  const url = String(update.url || "").trim();
  const storeTarget = isPlayStoreUrl(url) ? url : playStoreUrl;

  if (isAabArtifact(update) || isPlayStoreUrl(url)) {
    if (!storeTarget) {
      return {
        ok: false,
        error: "This Android update is published as AAB for Play Store. Add a Play Store link in releases.",
      };
    }
    try {
      // Play Store link: hand it to the real browser / Play Store app, not an in-app Custom Tab.
      const { openInDeviceBrowser } = await import("@/lib/openInDeviceBrowser");
      const opened = await openInDeviceBrowser(storeTarget);
      if (!opened) throw new Error("Could not open the store link.");
      return { ok: true, playStore: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not open Play Store." };
    }
  }

  if (!url) return { ok: false, error: "Missing update URL." };

  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const cachePath = apkCachePath(update.version);
  let progressHandle: { remove: () => Promise<void> } | null = null;

  try {
    progressHandle = await Filesystem.addListener("progress", (ev) => {
      onProgress?.({
        received: Number(ev.bytes ?? 0),
        total: Number(ev.contentLength ?? 0),
      });
    });

    let fileUri = "";
    try {
      const stat = await Filesystem.stat({ path: cachePath, directory: Directory.Cache });
      if (Number(stat.size || 0) > 1024 * 1024) {
        const { uri } = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
        fileUri = uri;
        onProgress?.({ received: Number(stat.size), total: Number(stat.size), reused: true });
      }
    } catch {
      /* download fresh */
    }

    if (!fileUri) {
      try {
        await Filesystem.deleteFile({ path: cachePath, directory: Directory.Cache });
      } catch {
        /* ignore */
      }
      await Filesystem.downloadFile({
        url,
        path: cachePath,
        directory: Directory.Cache,
        progress: true,
      });
      const { uri } = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
      fileUri = uri;
    }

    const { FileOpener } = await import("@capacitor-community/file-opener");
    await FileOpener.open({
      filePath: fileUri,
      contentType: "application/vnd.android.package-archive",
      openWithDefault: true,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not download or open the update.",
    };
  } finally {
    try {
      await progressHandle?.remove();
    } catch {
      /* ignore */
    }
  }
}
