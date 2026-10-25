"use client";

import { getLocalCompanyById, removeLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { readCloudSyncConfigFromCompany } from "@/lib/localCloudSync/companyConfig";
import { postDriveJsonViaClient } from "@/lib/localCloudSync/driveApiClient";
import { logLocalCloudSync, warnLocalCloudSync } from "@/lib/localCloudSync/logger";
import { getDriveApiUser, hasDriveApiAuthSession } from "@/lib/firebaseAuthForApi";
import {
  clearCloudSyncHistoricalBackfillDone,
  unsyncCloudSyncOutboxForCompany,
} from "@/lib/localCloudSync/driveFullReupload";
import { setCloudSyncCursor } from "@/lib/localCloudSync/queue";
import { notifyDriveFolderRepairNeeded } from "@/lib/localCloudSync/driveCloudSyncUiEvents";

/** Folder manually delete — turant naya mat banao; owner confirm ya 2 min baad auto repair. */
export const DRIVE_FOLDER_REPAIR_AUTO_DELAY_MS = 2 * 60 * 1000;

const DRIVE_FOLDER_REPAIR_BLOCKED_MARKERS = [
  "drive folder not found",
  "folder repair failed",
  "owner device must reconnect",
] as const;

export function isDriveFolderRepairBlockedMessage(message: string | null | undefined): boolean {
  const m = String(message || "").trim().toLowerCase();
  if (!m) return false;
  return DRIVE_FOLDER_REPAIR_BLOCKED_MARKERS.some((marker) => m.includes(marker));
}

export type DriveFolderRepairGateResult =
  | { action: "ok" }
  | { action: "blocked"; message: string; autoRepairAt: number }
  | { action: "applied"; message: string };

async function isOwnerDeviceForDriveRepair(row: LocalCompanyDoc | null | undefined): Promise<boolean> {
  if (!row) return false;
  if ((row as { driveSharedJoin?: unknown }).driveSharedJoin === true) return false;
  const ownerEmail = String(row.ownerEmail || "").trim().toLowerCase();
  if (!ownerEmail) return true;
  try {
    const user = await getDriveApiUser();
    const email = String(user.email || "").trim().toLowerCase();
    return !email || email === ownerEmail;
  } catch {
    return false;
  }
}

export function readDriveFolderRepairState(reg: LocalCompanyDoc | Record<string, unknown> | null | undefined): {
  detectedAt: number;
  autoRepairAt: number;
} | null {
  if (!reg) return null;
  const detectedAt = Number((reg as { cloudSyncDriveFolderRepairDetectedAt?: unknown }).cloudSyncDriveFolderRepairDetectedAt);
  const autoRepairAt = Number((reg as { cloudSyncDriveFolderRepairAutoAt?: unknown }).cloudSyncDriveFolderRepairAutoAt);
  if (!Number.isFinite(detectedAt) || detectedAt <= 0) return null;
  if (!Number.isFinite(autoRepairAt) || autoRepairAt <= 0) return null;
  return { detectedAt, autoRepairAt };
}

export function clearDriveFolderRepairStatePatch(): Record<string, null> {
  return {
    cloudSyncDriveFolderRepairDetectedAt: null,
    cloudSyncDriveFolderRepairAutoAt: null,
  };
}

/** Manual/auto repair ke baad — gate block mat karo jab tak naya folder upload se na bane. */
export function readDriveFolderRecreatePending(
  reg: LocalCompanyDoc | Record<string, unknown> | null | undefined
): boolean {
  if (!reg) return false;
  const at = Number((reg as { cloudSyncDriveFolderRecreatePendingAt?: unknown }).cloudSyncDriveFolderRecreatePendingAt);
  return Number.isFinite(at) && at > 0;
}

export function clearDriveFolderRecreatePendingPatch(): Record<string, null> {
  return { cloudSyncDriveFolderRecreatePendingAt: null };
}

async function isDriveCompanyFolderAccessible(reg: LocalCompanyDoc): Promise<boolean> {
  const cid = String(reg.id || "").trim();
  if (!cid) return false;
  const folderId = String(reg.cloudSyncDriveFolderId ?? "").trim();
  try {
    const res = await postDriveJsonViaClient<{ accessible?: boolean }>(
      "/api/local-cloud-sync/drive/folder-accessible",
      {
        companyId: cid,
        companyName: typeof reg.name === "string" ? reg.name : undefined,
        driveFolderId: folderId || undefined,
      }
    );
    return res.accessible === true;
  } catch {
    return false;
  }
}

async function scheduleDriveFolderRepair(companyId: string, reg: LocalCompanyDoc): Promise<void> {
  const now = Date.now();
  const autoRepairAt = now + DRIVE_FOLDER_REPAIR_AUTO_DELAY_MS;
  await upsertLocalCompany({
    ...reg,
    cloudSyncDriveFolderRepairDetectedAt: now,
    cloudSyncDriveFolderRepairAutoAt: autoRepairAt,
    updatedAt: now,
  });
  logLocalCloudSync("drive folder repair scheduled", { companyId, autoRepairAt });
  notifyDriveFolderRepairNeeded(companyId, {
    detectedAt: now,
    autoRepairAt,
    message:
      "Drive folder not found. Confirm to create a new folder now, or wait 2 minutes for automatic repair.",
  });
}

/** Owner confirm ya auto timer — stale folder id hatao, cursor reset, agla upload naya tree banayega. */
export async function applyDriveFolderRepair(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  if (!hasDriveApiAuthSession()) return false;

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return false;

  const cfg = readCloudSyncConfigFromCompany(reg);
  if (!cfg.cloudSyncEnabled || cfg.cloudSyncProvider !== "google_drive") return false;

  const folderId = String(reg.cloudSyncDriveFolderId ?? "").trim();

  if ((reg as { driveSharedJoin?: unknown }).driveSharedJoin === true) {
    await removeLocalCompanyById(cid);
    logLocalCloudSync("shared Drive company purged — folder missing", {
      companyId: cid,
      folderId: folderId || null,
    });
    return true;
  }

  if (!(await isOwnerDeviceForDriveRepair(reg))) {
    warnLocalCloudSync("drive folder repair skipped: owner device required", {
      companyId: cid,
      folderId: folderId || null,
      ownerEmail: reg.ownerEmail || null,
    });
    return false;
  }

  await unsyncCloudSyncOutboxForCompany(cid);
  await clearCloudSyncHistoricalBackfillDone(cid);
  await setCloudSyncCursor(cid, { lastSyncedOp: 0, lastSyncAt: null, lastError: null, syncStatus: "idle" });

  const next: LocalCompanyDoc = {
    ...reg,
    cloudSyncDriveFolderId: null,
    cloudSyncDriveFolderRecreatePendingAt: Date.now(),
    ...clearDriveFolderRepairStatePatch(),
    updatedAt: Date.now(),
  };
  await upsertLocalCompany(next);

  // Attachment re-upload sync cycle karega — yahan force mat karo (gate dubara block ho sakta tha).
  logLocalCloudSync("drive folder repair applied — new folder on next upload", {
    companyId: cid,
  });
  return true;
}

/** Settings UI — owner turant repair confirm. */
export async function confirmDriveFolderRepairNow(companyId: string): Promise<boolean> {
  return applyDriveFolderRepair(companyId);
}

/**
 * Sync cycle start: folder missing ho to upload/create roko jab tak user OK na de ya 2 min na ho.
 * Accessible ho to pending repair state clear.
 */
export async function processDriveFolderRepairGate(companyId: string): Promise<DriveFolderRepairGateResult> {
  const cid = String(companyId || "").trim();
  if (!cid) return { action: "ok" };
  if (!hasDriveApiAuthSession()) return { action: "ok" };

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return { action: "ok" };

  const cfg = readCloudSyncConfigFromCompany(reg);
  if (!cfg.cloudSyncEnabled || cfg.cloudSyncProvider !== "google_drive") return { action: "ok" };

  const accessible = await isDriveCompanyFolderAccessible(reg);
  if (accessible) {
    const pending = readDriveFolderRepairState(reg);
    const recreatePending = readDriveFolderRecreatePending(reg);
    if (pending || recreatePending) {
      await upsertLocalCompany({
        ...reg,
        ...clearDriveFolderRepairStatePatch(),
        ...(recreatePending ? clearDriveFolderRecreatePendingPatch() : {}),
        updatedAt: Date.now(),
      });
    }
    return { action: "ok" };
  }

  if (readDriveFolderRecreatePending(reg)) {
    return { action: "ok" };
  }

  const pending = readDriveFolderRepairState(reg);
  const now = Date.now();

  if (!pending) {
    if (!(await isOwnerDeviceForDriveRepair(reg))) {
      return {
        action: "blocked",
        message: "Drive folder not found. Owner device must reconnect or repair.",
        autoRepairAt: now + DRIVE_FOLDER_REPAIR_AUTO_DELAY_MS,
      };
    }
    await scheduleDriveFolderRepair(cid, reg);
    const autoRepairAt = now + DRIVE_FOLDER_REPAIR_AUTO_DELAY_MS;
    return {
      action: "blocked",
      message:
        "Drive folder not found. Confirm to create a new folder now, or wait 2 minutes for automatic repair.",
      autoRepairAt,
    };
  }

  if (now >= pending.autoRepairAt) {
    const applied = await applyDriveFolderRepair(cid);
    if (applied) {
      return {
        action: "applied",
        message: "Drive folder was missing. Local data queued for upload to a new folder.",
      };
    }
    return {
      action: "blocked",
      message: "Drive folder repair failed. Open sync settings on the owner account.",
      autoRepairAt: pending.autoRepairAt,
    };
  }

  const message =
    "Drive folder not found. Confirm to create a new folder now, or wait for automatic repair.";
  return {
    action: "blocked",
    message,
    autoRepairAt: pending.autoRepairAt,
  };
}
