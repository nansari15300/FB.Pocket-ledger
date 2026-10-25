"use client";

import { readAutoBackupDrivePrefs } from "@/lib/autoBackupDrivePrefs";
import { runAutoBackupDriveUpload } from "@/lib/autoBackupDriveUpload";
import { runAutoBackupDriveUploadWithRunner, isAutoBackupDriveUploadRunning } from "@/lib/autoBackupDriveUploadRunner";
import { fetchGoogleDriveConnectionStatus } from "@/lib/driveAuthClient";
import { isBackupSaveLocationConfigured } from "@/lib/backupSaveLocation";
import { hasDriveApiAuthSession } from "@/lib/firebaseAuthForApi";
import { isDesktopPcBackupStripView } from "@/lib/isDesktopPcBackupStripView";
import {
  isLocalGoogleDriveSyncDisabled,
} from "@/lib/localCloudSync/driveSyncDisabled";

export async function maybeTriggerAutoBackupDriveUploadAfterBackup(input: {
  companyId: string;
  companyName: string;
  startedAtMs: number;
}): Promise<void> {
  const prefs = readAutoBackupDrivePrefs();
  if (!prefs.autoUploadEnabled) return;
  const selected = prefs.uploadCompanyIds || [];
  if (selected.length > 0 && !selected.includes(input.companyId)) return;
  if (isLocalGoogleDriveSyncDisabled()) return;
  if (!hasDriveApiAuthSession()) return;
  if (!isBackupSaveLocationConfigured()) return;
  if (isAutoBackupDriveUploadRunning()) return;

  let connected = false;
  try {
    const status = await fetchGoogleDriveConnectionStatus();
    connected = status.connected === true;
  } catch {
    connected = false;
  }
  if (!connected) return;

  const companyName = String(input.companyName || input.companyId).trim() || input.companyId;
  const companies = [{ id: input.companyId, name: companyName }];
  const uploadPrefs =
    selected.length > 0
      ? prefs
      : { ...prefs, uploadCompanyIds: [input.companyId] };

  await runAutoBackupDriveUploadWithRunner({
    companyName,
    run: (onProgress) =>
      runAutoBackupDriveUpload({
        prefs: uploadPrefs,
        companies,
        onlySinceMs: Math.max(0, input.startedAtMs - 15_000),
        onProgress,
      }),
  });
}

export function shouldShowDesktopBackupActivityStrip(): boolean {
  return isDesktopPcBackupStripView();
}
