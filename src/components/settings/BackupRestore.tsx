
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2, FileWarning, ShieldCheck, ShieldOff, Eye, EyeOff, Folder, Info, Settings, Plus, X, Cloud } from "lucide-react";
import { useCompany } from "@/hooks/useCompany";
import type { Company } from "@/hooks/useCompany";
import {
  collection,
  query,
  writeBatch,
  doc,
  Timestamp,
  setDoc,
  serverTimestamp,
  addDoc,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
} from "firebase/firestore";
import { getDocs, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { firestore, isFirestoreBlockedForServerSession } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { EditCompanyForm } from "@/components/company/EditCompanyForm";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Label } from "../ui/label";
import { PermissionButton } from "@/components/permission";
import { assertCan, PermissionDeniedError } from "@/lib/permissions/enforcePermission";
import { decryptBytes, encryptData } from "@/lib/encryption";
import { isPlbpZipPayload, unpackPlbpZipBackup } from "@/lib/plbpBackupZip";
import { getLocalCompanyById, promoteLocalCompanyRowToOnline, upsertLocalCompany } from "@/lib/localCompanyStore";
import { flushBrowserDbToIndexedDB, flushPendingBrowserDbSave, getBrowserDb } from "@/lib/localSqlite";
import {
  upsertCompanyDocInBrowserDb,
  notifyBrowserDbCollectionUpdated,
  listCompanyDocsFromBrowserDb,
  deleteAllCompanyDocsForCompany,
} from "@/lib/localCompanyDocMirror";
import {
  hydratePendingLocalFileRefsDeep,
  hydrateVoucherLocalAttachmentsForServer,
} from "@/lib/hydrateVoucherLocalAttachmentsForServer";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { canUploadOneMoreOnline } from "@/lib/companyOnlineSlots";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { SettingsInfoTip } from "@/components/settings/SettingsInfoTip";
import {
  checkAttachmentBackupAllowed,
  checkAttachmentRestoreAllowed,
  formatAttachmentUsageRemaining,
  incrementAttachmentRestoreUsage,
  planAttachmentBackupRestoreEnabled,
} from "@/lib/attachmentBackupUsage";
import {
  applyAttachmentRefMapToBackupData,
  backupDataHasAttachmentBundle,
  backupDataHasOrphanAttachmentRefs,
  countRemoteAttachmentRefsInBackupData,
  getAttachmentRestoreEntryCount,
  prepareBackupDataForLocalCompanyRestore,
  isOfflineIntentBackupData,
  restoreAttachmentsFromBackupData,
} from "@/lib/attachmentBackupBundle";
import { finalizeLocalCompanyRowAfterBackupRestore, markLocalBackupRestoreSelectionGrace, beginLocalAttachmentRestoreHold, endLocalAttachmentRestoreHold, stripOnlineFieldsFromBackupLedgerDoc } from "@/lib/localBackupRestoreCompany";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";
import {
  ONLINE_DATA_SERVER_POCKETBASE_ID,
  ensureOnlineDataServerSettingsHydrated,
  resolveOnlineDataBackend,
} from "@/lib/onlineDataServer";
import { isPocketBaseSessionUser } from "@/lib/pocketbaseData/pbAppSession";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { ensureSuperAdminInSharedEmails } from "@/lib/superAdminEmails";
import { sharedWithEmailsLowerFromList } from "@/lib/sharedWithEmailsQuery";
import { wipeCompanyFirebaseStorageForRestore } from "@/lib/deleteCompanyStorageFolder";
import { grantOpenLocalCompanySession } from "@/lib/companyUnlockGate";
import {
  dismissCompanyBackupRunLater,
  isCompanyBackupRunning,
  cancelCompanyBackupRun,
  startCompanyBackupRun,
} from "@/lib/companyBackupRunner";
import {
  COLLECTIONS_TO_BACKUP,
  scanSqliteBackupAttachmentGaps,
  type CompanyBackupAttachmentMissingPolicy,
  type CompanyBackupIntent,
  type CompanyBackupProgress,
  type CompanyBackupSourceMode,
} from "@/lib/companyBackupCore";
import { startRestoreCloudBackgroundSync } from "@/lib/restoreCloudBackgroundSync";
import { useCompanyBackupRun } from "@/hooks/useCompanyBackupRun";
import { readBackupLocationDisplayLabel, formatNativeFolderDisplayPath, readBackupLocationDisplayHint, formatAutoBackupPathPreview, isBackupLocationFullPathDisplay } from "@/lib/backupLocationDisplay";
import {
  readAutoBackupPrefs,
  saveAutoBackupPrefs,
  canEnableAutoBackup,
  autoBackupWeekdayLabel,
  shouldShowAutoBackupWeekdayPicker,
  isAutoBackupWeekdayChecked,
  toggleAutoBackupWeekday,
  getAutoBackupCompanySettings,
  patchAutoBackupCompanySettings,
  defaultAutoBackupCompanySettings,
  type AutoBackupCompanySettings,
  type AutoBackupFrequency,
  type AutoBackupPrefs,
  type AutoBackupScheduleMode,
} from "@/lib/autoBackupPrefs";
import { runAutoBackupQueue, loadAutoBackupCompanyPickerRows, companyHasAutoBackupPassword, syncAutoBackupCompanyIdsWithEligible } from "@/lib/autoBackupRunner";
import { AutoBackupDriveUploadDialog } from "@/components/settings/AutoBackupDriveUploadDialog";
import { AttachmentSqliteServerCompareDialog } from "@/components/settings/AttachmentSqliteServerCompareDialog";
import { buildAutoBackupRelativeDir } from "@/lib/autoBackupPath";
import { isDeviceLocalCompany, partitionCompaniesForSelector, filterCompaniesForSelectorPartition, filterOnlineTabCompaniesForSelector, type CompanyListTab } from "@/lib/companyStorageKind";
import { filterSharedOnlyCompaniesForSuperAdminInMainApp } from "@/lib/companySuperAdminFilter";
import { isAdminPanelCompanyRow } from "@/lib/adminPanelCompany/companyListFilter";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import {
  getOnlineCompanyBackupTickGate,
  companyUsesOnlineSelectorSyncTicks,
} from "@/lib/onlineCompanySelectorSyncPolicy";
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { canUserRestoreBackup, isValidRestoreAllowedGmail, normalizeBackupRestoreEmail, normalizeRestoreAllowedGmailList } from "@/lib/backupRestoreAccess";
import { Checkbox } from "@/components/ui/checkbox";
import { BackupFyScopePicker, BackupFyScopeRestoreNotice } from "@/components/settings/BackupFyScopePicker";
import { isFyScopedBackupData, readBackupFyScopeMarker, type BackupFyScope } from "@/lib/backupFyScopeRewrite";
import { Switch } from "@/components/ui/switch";
import { BackupProgressStrip } from "@/components/settings/BackupProgressStrip";
import {
  countRestoreWorkUnits,
  createRestoreProgressReporter,
} from "@/lib/companyRestoreProgress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Capacitor } from "@capacitor/core";
import {
  readBackupSaveLocationPrefs,
  readWebBackupDirectoryHandle,
  isNativeRuntime,
  ensureNativeBackupStoragePermission,
  canPickWebBackupFolder,
  clearWebBackupDirectoryHandle,
  saveBackupSaveLocationPrefs,
  storeWebBackupDirectoryHandle,
  storeWebLiveDataDirectoryHandle,
  clearWebLiveDataDirectoryHandle,
  readWebLiveDataDirectoryHandle,
  ensureLiveMirrorAutoPassphrase,
} from "@/lib/backupSaveLocation";
import {
  readLiveDataFolderPrefs,
  saveLiveDataFolderPrefs,
  syncAllLocalCompanyDeltasToFolder,
  clearLiveDataFolderPrefsAndSession,
  ensureLiveDataMirrorSalt,
  POCKET_LEDGER_MIRROR_DIR,
  COMPANIES_DIR_SEGMENT,
  getOrCreatePocketLedgerDir,
} from "@/lib/liveDataFolderMirror";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { pathnameForModalRouterReplace } from "@/lib/modalUrlSync";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { generateCompanyId } from "@/lib/generateCompanyId";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { canPickElectronBackupDirectory } from "@/lib/electronBackupFolder";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import {
  runStaticCompanyBackupPredownload,
  type StaticBackupPredownloadProgress,
} from "@/lib/staticBackupPredownload";

/** Backup cards — header jaisa blue pill tone; chhoti screen par wrap. */
const backupCardPillCn = cn(
  chromeProPillCn,
  "inline-flex h-auto min-h-9 max-w-full flex-wrap items-center rounded-full px-3 py-1.5 text-sm font-medium"
);

/** Auto backup boxes — card hue se match (globals.css pl-backup-soft-box-*). */
const backupCardSoftSkyBorderCn = "pl-backup-soft-box pl-backup-soft-box-sky rounded-lg";
const backupCardSoftGreenBorderCn = "pl-backup-soft-box pl-backup-soft-box-emerald rounded-lg";

/** Main backup page cards — dashboard tone border (green / sky). */
const backupCardToneGreenCn = "pl-dashboard-tone-card pl-dashboard-ribbon-emerald shadow-none";
const backupCardToneSkyCn = "pl-dashboard-tone-card pl-dashboard-ribbon-sky shadow-none";

/** Card header: title upar, actions neeche wrap (mobile); desktop par ek row. */
const backupCardHeaderLayoutCn = "flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between";
const backupCardHeaderActionsCn = "grid grid-cols-2 w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end";
const backupCardActionBtnCn = "w-full sm:w-auto";

type BackupLocationFieldProps = {
  locationLabel: string;
  onChooseLocation: () => void;
  /** Backup Data card me button footer me hai — yahan sirf path dikhao. */
  showButton?: boolean;
  /** Web par visible lekin disabled — sirf static/APK me chalega (getDirectoryHandle). */
  disabled?: boolean;
  disabledHint?: string;
  /** Auto backup card — path + button right side. */
  align?: "start" | "end";
  hint?: string | null;
  /** Full C:\\ / UNC path — static EXE me Auto card jaisa. */
  pathPreview?: string | null;
  pathPreviewLabel?: string;
};

/** Backup Data + auto backup — ek hi prefs label; kisi card se choose → dono refresh. */
function BackupLocationField({
  locationLabel,
  onChooseLocation,
  showButton = true,
  disabled = false,
  disabledHint,
  align = "start",
  hint,
  pathPreview,
  pathPreviewLabel = "Backup path",
}: BackupLocationFieldProps) {
  const alignEnd = align === "end";
  const preview = String(pathPreview || "").trim();
  const shownLocation =
    preview && isBackupLocationFullPathDisplay(preview) ? preview : locationLabel;
  return (
    <div
      className={cn(
        "space-y-2 text-sm text-muted-foreground",
        disabled && "opacity-60",
        alignEnd && "md:flex md:flex-col md:items-end md:text-right"
      )}
    >
      <p>
        Backup location:{" "}
        <span className="font-medium text-foreground break-all">{shownLocation}</span>
      </p>
      {hint ? <p className="text-xs leading-snug text-muted-foreground">{hint}</p> : null}
      {disabled && disabledHint ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
      {showButton ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onChooseLocation}
          className={cn(backupCardActionBtnCn, alignEnd && "md:w-auto")}
        >
          Backup location
        </Button>
      ) : null}
    </div>
  );
}

/** Local/static restore: SQLite `companies` + `company_docs` — create-company-local jaisa; Firebase password zaroori nahi */
function fiscalFieldToLocalIso(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string" && val.trim()) return val;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val && typeof val === "object" && "seconds" in val) {
    const s = Number((val as { seconds: number }).seconds);
    const ns = Number((val as { nanoseconds?: number }).nanoseconds ?? 0);
    if (!Number.isFinite(s)) return null;
    return new Date(s * 1000 + ns / 1e6).toISOString();
  }
  try {
    const d = (val as { toDate?: () => Date }).toDate?.();
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  } catch {
    /* ignore */
  }
  return null;
}

const collectionsToBackup = [...COLLECTIONS_TO_BACKUP];

/** Firestore ek query me ~1000 doc cap — pages se poora subcollection (warna backup adhura) */
const BACKUP_PAGE_SIZE = 500;

/** Backup blob ko native files API ke liye base64 me badlo. */
async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error ?? new Error("Failed to read blob"));
    r.readAsDataURL(blob);
  });
}

/**
 * Backup file download/save:
 * - Web: File System Access "Save As" (location picker) if supported.
 * - Native APK: optional SAF tree (`content://...`) via BackupSaf plugin; else Documents + share sheet.
 * - Fallback: anchor download.
 */
async function saveBackupBlobWithBestEffort(blob: Blob, fileName: string): Promise<{ where: string }> {
  const savePrefs = readBackupSaveLocationPrefs();
  // Native APK must use native branch first; web picker on Android WebView can throw AbortError and fake "location not selected".
  if (Capacitor.isNativePlatform()) {
    try {
      const dataUrl = await blobToBase64DataUrl(blob);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      const treeUri = String(savePrefs.nativeFolderPath || "").trim();

      // Folder picker on Android returns a SAF tree URI — Capacitor Filesystem cannot write there; use native plugin.
      if (treeUri.startsWith("content://")) {
        try {
          const { BackupSaf } = await import("@/lib/capacitorBackupSaf");
          await BackupSaf.writeToTreeUri({ treeUri, fileName, data: base64 });
          return { where: "Selected folder (device)" };
        } catch {
          /* fall through to Documents + Share */
        }
      }

      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      // Static build/native: request storage permission before writing backup file (app Documents / external).
      const granted = await ensureNativeBackupStoragePermission();
      if (!granted) {
        throw new Error(
          "Storage permission denied. Choose a folder under Backup & Restore → Backup location, or save via Share."
        );
      }
      const nativeDirectory =
        savePrefs.nativeDirectory === "EXTERNAL"
          ? ((Directory as unknown as Record<string, unknown>).ExternalStorage ?? Directory.Documents)
          : Directory.Documents;
      const rawSubfolder = String(savePrefs.nativeSubfolder || "").trim();
      const safeSubfolder = rawSubfolder.replace(/^[\\/]+|[\\/]+$/g, "");
      const finalPath = safeSubfolder ? `${safeSubfolder}/${fileName}` : fileName;
      if (safeSubfolder) {
        await Filesystem.mkdir({
          path: safeSubfolder,
          directory: nativeDirectory as any,
          recursive: true,
        }).catch(() => undefined);
      }
      await Filesystem.writeFile({
        path: finalPath,
        data: base64,
        directory: nativeDirectory as any,
      });
      const savedUriResp = await Filesystem.getUri({ path: finalPath, directory: nativeDirectory as any });
      const savedUri = String((savedUriResp as any)?.uri || "");
      try {
        await Share.share({
          title: fileName,
          url: savedUri,
          dialogTitle: "Save backup file",
        });
      } catch {
        /* share cancel shouldn't fail backup write */
      }
      const dirLabel = savePrefs.nativeDirectory === "EXTERNAL" ? "ExternalStorage" : "Documents";
      const where = `${dirLabel}/${finalPath}`;
      return { where };
    } catch {
      // Native write fail -> continue to browser/web fallback
    }
  }
  let webPreferredFolderFailed = false;
  if (typeof window !== "undefined") {
    try {
      // Device settings: fixed web folder — direct save jab user ne folder choose kiya ho.
      if (!isNativeRuntime() && savePrefs.webUseSelectedFolder) {
        const dirHandle = await readWebBackupDirectoryHandle();
        if (!dirHandle) {
          // Missing saved handle: fall back to Save As instead of hard failing.
          webPreferredFolderFailed = true;
        } else {
          if (typeof dirHandle.queryPermission === "function") {
            const p = await dirHandle.queryPermission({ mode: "readwrite" });
            if (p !== "granted" && typeof dirHandle.requestPermission === "function") {
              try {
                const req = await dirHandle.requestPermission({ mode: "readwrite" });
                if (req !== "granted") {
                  webPreferredFolderFailed = true;
                }
              } catch (e) {
                if (e instanceof DOMException && e.name === "NotAllowedError") {
                  webPreferredFolderFailed = true;
                } else {
                  throw e;
                }
              }
            }
          }
          if (!webPreferredFolderFailed) {
            try {
              const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              const label = savePrefs.webFolderLabel || "Selected folder";
              return { where: `${label}/${fileName}` };
            } catch (e) {
              if (e instanceof DOMException && e.name === "NotAllowedError") {
                webPreferredFolderFailed = true;
              } else {
                throw e;
              }
            }
          }
        }
      }

      const picker = (window as any).showSaveFilePicker;
      if (typeof picker === "function") {
        const handle = await picker({
          suggestedName: fileName,
          types: [{ description: "Pocket Ledger Backup", accept: { "application/octet-stream": [".plbp"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return {
          where: webPreferredFolderFailed
            ? "Selected folder (Save As fallback)"
            : "Selected folder (Save As)",
        };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // picker unsupported/blocked -> नीचे fallback
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { where: "Browser Downloads folder" };
}

/** Native picker se aayi base64 payload ko browser-compatible File me convert karo. */
function fileFromBase64Payload(base64Data: string, fileName: string, mimeType?: string): File {
  const normalized = String(base64Data || "").includes(",")
    ? String(base64Data).split(",")[1] || ""
    : String(base64Data || "");
  const binary = typeof atob === "function" ? atob(normalized) : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName || "backup.plbp", {
    type: mimeType || "application/octet-stream",
  });
}

/** Firestore subcollections `companies/{id}/…` — cloud doc id kabhi `authoritativeCompanyId` hota hai, registry `companyId` se alag */
async function fetchSubcollectionAllDocsPaginated(
  firestoreCompanyId: string,
  colName: string
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const colRef = collection(firestore, `companies/${firestoreCompanyId}/${colName}`);
  const out: Array<Record<string, unknown> & { id: string }> = [];
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const q = last
      ? query(colRef, orderBy(documentId()), startAfter(last), limit(BACKUP_PAGE_SIZE))
      : query(colRef, orderBy(documentId()), limit(BACKUP_PAGE_SIZE));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      out.push({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string });
    }
    if (snap.docs.length < BACKUP_PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function docRowUpdatedMs(row: Record<string, unknown>): number {
  const u = row.updatedAt ?? row.lastEditedAt ?? row.createdAt;
  if (u && typeof u === "object" && "toMillis" in u && typeof (u as { toMillis?: () => number }).toMillis === "function") {
    try {
      const ms = (u as { toMillis: () => number }).toMillis();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }
  if (u && typeof u === "object" && "seconds" in u) {
    const s = Number((u as { seconds: number }).seconds);
    return Number.isFinite(s) ? s * 1000 : 0;
  }
  if (typeof u === "number" && Number.isFinite(u)) return u;
  return 0;
}

/** SQLite mirror me jo abhi Firestore pe flush nahi (journal 2 missing) — merge se backup pura */
function mergeFirestoreRowsWithLocalMirrorForBackup(
  fsRows: Array<Record<string, unknown> & { id: string }>,
  localRows: Array<Record<string, unknown> & { id: string }>
): Array<Record<string, unknown> & { id: string }> {
  const byId = new Map<string, Record<string, unknown> & { id: string }>();
  for (const r of fsRows) {
    byId.set(String(r.id), { ...r });
  }
  for (const r of localRows) {
    const id = String(r.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...r });
      continue;
    }
    const tFs = docRowUpdatedMs(prev);
    const tLoc = docRowUpdatedMs(r);
    if (tLoc > tFs) byId.set(id, { ...prev, ...r });
  }
  return Array.from(byId.values());
}

/**
 * Online backup → local slot restore: backup file me purana `companyId` nested objects me rehta hai;
 * SQLite `company_id` = naya slot — mismatch se listeners / filters galat. Sirf exact string match replace (Timestamps chhod do).
 */
function rewriteBackupCompanyIdsDeep(backupCompanyId: string, targetCompanyId: string, val: unknown): unknown {
  if (!backupCompanyId || backupCompanyId === targetCompanyId) return val;
  if (val === backupCompanyId) return targetCompanyId;
  if (Array.isArray(val)) return val.map((v) => rewriteBackupCompanyIdsDeep(backupCompanyId, targetCompanyId, v));
  if (val !== null && typeof val === "object") {
    const o = val as Record<string, unknown>;
    if (typeof o.seconds === "number" && "nanoseconds" in o) return val;
    if (o.__fsTs === true) return val;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      out[k] = rewriteBackupCompanyIdsDeep(backupCompanyId, targetCompanyId, o[k]);
    }
    return out;
  }
  return val;
}

/** Replace open company vs nayi company id (purana flow). */
export type RestoreTargetMode = "replace_current" | "new_company";

async function clearFirestoreCompanySubcollectionsForRestore(fsCompanyId: string): Promise<void> {
  const cid = String(fsCompanyId || "").trim();
  if (!cid) return;
  for (const colName of collectionsToBackup) {
    const colRef = collection(firestore, `companies/${cid}/${colName}`);
    for (;;) {
      const snap = await getDocs(query(colRef, limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(firestore);
      for (const d of snap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  }
}

/** Restore confirm: user picks final `name` — default slot (target); ya backup file wala naam (agar khali ho to doosra fallback). */
function resolveRestoreFinalCompanyName(
  choice: "target" | "backup",
  targetName: string,
  backupName: string
): string {
  const t = String(targetName ?? "").trim();
  const b = String(backupName ?? "").trim();
  if (choice === "backup") return b || t;
  return t || b;
}

function resolveRestoreIncludeAttachments(
  restoreIncludeAttachments: boolean,
  backupData: Record<string, unknown> | null
): boolean {
  return restoreIncludeAttachments && backupDataHasAttachmentBundle(backupData);
}

function resolveRestoreZipFiles(
  stateZip: Map<string, Uint8Array> | null,
  refZip: Map<string, Uint8Array> | null
): Map<string, Uint8Array> | null {
  if (stateZip?.size) return stateZip;
  if (refZip?.size) return refZip;
  return stateZip ?? refZip;
}

/** Cloud restore: `local:` pending blobs → Firebase Storage HTTPS (app / doosre device resolve kar sakein). */
async function hydrateRestoredFieldsForCloudUpload(
  fsCompanyId: string,
  collectionName: string,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (collectionName === "vouchers") {
    const voucherHydrated = await hydrateVoucherLocalAttachmentsForServer(fsCompanyId, fields);
    return hydratePendingLocalFileRefsDeep(fsCompanyId, voucherHydrated);
  }
  return hydratePendingLocalFileRefsDeep(fsCompanyId, fields);
}

export function BackupRestore() {
  const resolveUidFromUserRef = async (userRefId?: string, email?: string) => {
    if (userRefId) {
      const ownerSnap = await getDoc(doc(firestore, "users", userRefId));
      if (ownerSnap.exists()) {
        const data: any = ownerSnap.data();
        return data?.uid || ownerSnap.id || userRefId;
      }
    }
    if (email) {
      const ownerQ = query(collection(firestore, "users"), where("email", "==", email));
      const ownerSnap = await getDocs(ownerQ);
      if (!ownerSnap.empty) {
        const data: any = ownerSnap.docs[0].data();
        return data?.uid || ownerSnap.docs[0].id;
      }
    }
    return userRefId || null;
  };

  const sendSecurityAlertClient = async (params: {
    backupOwnerId?: string;
    backupOwnerEmail?: string;
    backupSharedWith?: any[];
    attemptedByUid: string;
    attemptedByEmail: string;
    attemptedByName?: string;
    companyName: string;
    companyId: string;
  }) => {
    const {
      backupOwnerId,
      backupOwnerEmail,
      backupSharedWith,
      attemptedByUid,
      attemptedByEmail,
      attemptedByName,
      companyName,
      companyId,
    } = params;

    // Only company admin (owner) receives security alerts; not shared users.
    const recipientUserIds = new Set<string>();
    const ownerUid = await resolveUidFromUserRef(backupOwnerId, backupOwnerEmail);
    if (ownerUid) recipientUserIds.add(ownerUid);

    if (recipientUserIds.size === 0 && companyId) {
      const liveCompanySnap = await getDoc(doc(firestore, "companies", companyId));
      if (liveCompanySnap.exists()) {
        const liveCompany = liveCompanySnap.data() as any;
        const fallbackOwnerUid = await resolveUidFromUserRef(liveCompany?.ownerId, liveCompany?.ownerEmail);
        if (fallbackOwnerUid) recipientUserIds.add(fallbackOwnerUid);
      }
    }
    if (recipientUserIds.size === 0) return false;

    const liveAlertMessage = `Security Alert: User "${attemptedByEmail}" tried to restore your company "${companyName}". Attempt was blocked automatically.`;
    await Promise.all(Array.from(recipientUserIds).map((recipientUserId) =>
      addDoc(collection(firestore, "admin_notifications"), {
        recipientUserId,
        message: liveAlertMessage,
        timestamp: serverTimestamp(),
        isRead: false,
        type: "security_alert",
        companyId,
        attemptedBy: {
          uid: attemptedByUid,
          email: attemptedByEmail,
          ...(attemptedByName ? { name: attemptedByName } : {}),
        },
      })
    ));
    return true;
  };

  const { company, companyId, allCompanies, setCompanyId, reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user, customUser } = useAuth();
  const { toast } = useToast();
  const { can } = usePermissions();
  const isSuperAdminByEmail = useMemo(() => {
    const e = (user?.email || "").toLowerCase().trim();
    if (!e) return false;
    return getSuperAdminEmails().some((x) => (x || "").toLowerCase().trim() === e);
  }, [user?.email]);
  const isSuperAdminUser = customUser?.role === "SuperAdmin" || isSuperAdminByEmail;
  const livePlans = useLivePlans();
  const accountPlanId = useMemo(
    () => resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId),
    [allCompanies, user?.uid, company?.planId]
  );
  const accountPlanLive = useMemo(
    () => getPlanFromPlans(livePlans, accountPlanId),
    [livePlans, accountPlanId]
  );
  const attachmentFeatureOn = planAttachmentBackupRestoreEnabled(accountPlanId, accountPlanLive);
  const isLocalCompanyBackup = useMemo(() => isDeviceLocalCompany(company), [company]);
  const backupRun = useCompanyBackupRun();
  const isBackingUp = backupRun.status === "running";
  const backupProgress = backupRun.progress;
  const [autoBackupCompanyRows, setAutoBackupCompanyRows] = useState<Company[]>([]);
  const [autoBackupListTab, setAutoBackupListTab] = useState<CompanyListTab>("local");
  const [onlineSyncPrefsEpoch, setOnlineSyncPrefsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setOnlineSyncPrefsEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
  }, []);
  const autoBackupSelectorCompanies = useMemo(() => {
    const shareUser = { uid: user?.uid || "", email: user?.email ?? null };
    const merged = autoBackupCompanyRows
      .filter((c) => !isAdminPanelCompanyRow(c))
      .map((c) => ({
        ...c,
        isOwned: user?.uid ? resolveCompanyIsOwnedForUser(c, shareUser) : Boolean(c.isOwned),
      }));
    return filterCompaniesForSelectorPartition(
      filterSharedOnlyCompaniesForSuperAdminInMainApp(
        merged,
        user ? { uid: user.uid, email: user.email } : null,
        isSuperAdminUser,
        pathname
      )
    );
  }, [autoBackupCompanyRows, user, isSuperAdminUser, pathname]);
  const autoBackupCompanyBuckets = useMemo(
    () => partitionCompaniesForSelector(autoBackupSelectorCompanies),
    [autoBackupSelectorCompanies, onlineSyncPrefsEpoch]
  );
  const autoBackupTabCompanies = useMemo(() => {
    if (autoBackupListTab === "server") return autoBackupCompanyBuckets.serverTabCompanies;
    if (autoBackupListTab === "online") {
      return filterOnlineTabCompaniesForSelector(autoBackupCompanyBuckets.onlineTabCompanies);
    }
    return autoBackupCompanyBuckets.localTabCompanies;
  }, [autoBackupListTab, autoBackupCompanyBuckets]);
  const autoBackupEligibleCompanies = useMemo(
    () => autoBackupSelectorCompanies.filter((c) => c.isOwned !== false),
    [autoBackupSelectorCompanies]
  );
  const [autoBackupPrefs, setAutoBackupPrefs] = useState<AutoBackupPrefs>(() => readAutoBackupPrefs());
  const [autoBackupDraft, setAutoBackupDraft] = useState<AutoBackupPrefs>(() => readAutoBackupPrefs());

  /** Nepal company → default BS, baaki AD — sirf tab jab user ne pehle se save nahi kiya ho. */
  useEffect(() => {
    const isNepal = (company?.country || "").toLowerCase().includes("nepal");
    const storedSystem = readAutoBackupPrefs().folderDateSystem;
    // Agar stored prefs me "AD" hai (factory default) aur company Nepal ki hai → BS set karo
    if (storedSystem === "AD" && isNepal) {
      setAutoBackupDraft((prev) => ({ ...prev, folderDateSystem: "BS" }));
    }
  }, [company?.country]);
  const driveUploadCompanies = useMemo(() => {
    const pool =
      autoBackupCompanyRows.length > 0
        ? autoBackupCompanyRows.filter((c) => c.isOwned !== false)
        : allCompanies.filter((c) => c.isOwned !== false);
    return pool.map((c) => ({ id: String(c.id), name: String(c.name || c.id) }));
  }, [autoBackupCompanyRows, allCompanies]);
  const [backupLocationLabel, setBackupLocationLabel] = useState("Not set");
  const backupLocationHint = useMemo(() => readBackupLocationDisplayHint(), [backupLocationLabel]);
  const autoBackupPathPreview = useMemo(
    () => formatAutoBackupPathPreview(backupLocationLabel, autoBackupDraft.folderDateSystem),
    [backupLocationLabel, autoBackupDraft.folderDateSystem]
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<CompanyBackupProgress | null>(null);
  /** Restore progress popup — Close se sirf dialog band, restore main page par chalta rahe. */
  const [restoreProgressDialogOpen, setRestoreProgressDialogOpen] = useState(false);
  const restoreAbortRef = useRef<AbortController | null>(null);
  /** v3 zip backup: decrypt ke baad attachment bytes yahan — restore tak memory me. */
  const restoreZipFilesRef = useRef<Map<string, Uint8Array> | null>(null);
  const [restoreZipFilesByPath, setRestoreZipFilesByPath] = useState<Map<string, Uint8Array> | null>(null);
  const [fileToRestore, setFileToRestore] = useState<File | null>(null);
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isEncryptedBackupConfirmOpen, setIsEncryptedBackupConfirmOpen] = useState(false);
  const [decryptionPassword, setDecryptionPassword] = useState('');
  const [showDecryptionPassword, setShowDecryptionPassword] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [backupDataToRestore, setBackupDataToRestore] = useState<any>(null);
  const [backupLocationDialogOpen, setBackupLocationDialogOpen] = useState(false);
  const [webUseSelectedFolder, setWebUseSelectedFolder] = useState(false);
  const [webFolderLabel, setWebFolderLabel] = useState<string | null>(null);
  const [webFolderDisplayPath, setWebFolderDisplayPath] = useState<string | null>(null);
  const [nativeFolderPath, setNativeFolderPath] = useState<string | null>(null);
  const [savingBackupLocation, setSavingBackupLocation] = useState(false);
  const [liveDataLocationDialogOpen, setLiveDataLocationDialogOpen] = useState(false);
  const [liveWebEnabled, setLiveWebEnabled] = useState(false);
  const [liveWebLabel, setLiveWebLabel] = useState<string | null>(null);
  const [liveNativeFolderPath, setLiveNativeFolderPath] = useState<string | null>(null);
  const [savingLiveDataLocation, setSavingLiveDataLocation] = useState(false);
  const supportsWebFolderPicker = canPickWebBackupFolder();
  const nativeRuntime = isNativeRuntime();
  /** APK / static export / Electron — attachment backup + SQLite-first backup. */
  const staticBackupClient = isEmbeddedOfflinePreloadClient();
  /** Cloud-linked company: user choose SQLite vs Firestore — pehle default Firestore tha, local UI blank ho jati thi */
  const [restoreToLocalSqlite, setRestoreToLocalSqlite] = useState(true);
  /** Restore ke baad `companies.name`: default = jis slot mein restore ho raha hai (target); alternate = backup file ka naam */
  const [restoreCompanyNameChoice, setRestoreCompanyNameChoice] = useState<"target" | "backup">("target");
  const [restoreTargetMode, setRestoreTargetMode] = useState<RestoreTargetMode>("replace_current");
  const restoreAsNewCompany = !company || restoreTargetMode === "new_company";
  /** Manual backup FY range ("all" default). Auto backup uses per-company `fyScope` in prefs. */
  const [backupFyScopeDraft, setBackupFyScopeDraft] = useState<BackupFyScope>("all");
  useEffect(() => {
    setBackupFyScopeDraft("all");
  }, [companyId]);
  /** Replace current company with an FY-scoped backup needs an explicit tick. */
  const [fyScopeRestoreAck, setFyScopeRestoreAck] = useState(false);
  useEffect(() => {
    setFyScopeRestoreAck(false);
  }, [backupDataToRestore, restoreTargetMode]);
  const fyScopeRestoreBlocked =
    Boolean(company) &&
    restoreTargetMode === "replace_current" &&
    isFyScopedBackupData(backupDataToRestore) &&
    !fyScopeRestoreAck;
  const currentCompanyFyScopeMarker = readBackupFyScopeMarker({
    backupFyScope: (company as { backupFyScope?: unknown } | null | undefined)?.backupFyScope,
  });
  const restoreOnlineSlotGate = useMemo(() => {
    if (!user?.uid) return { ok: false, max: 0, current: 0 };
    const candidateId =
      !restoreAsNewCompany && company?.id ? company.id : "__restore_as_new__";
    return canUploadOneMoreOnline(
      allCompanies,
      accountPlanId,
      candidateId,
      user.uid,
      accountPlanLive
    );
  }, [
    user?.uid,
    restoreAsNewCompany,
    company?.id,
    allCompanies,
    accountPlanId,
    accountPlanLive,
  ]);
  const isOfflineIntentRestore = isOfflineIntentBackupData(
    backupDataToRestore as Record<string, unknown> | null
  );
  /** Offline backup → Online sirf naya company (replace block). No company open = hamesha naya company. */
  /**
   * Pocket Ledger Server login: Online = the server. Company limits come from the server admin,
   * not from the Firebase plan (that plan is unknown here and resolves to Free = 0 online slots).
   */
  const restoreServerLoginSession = isPocketBaseSessionUser(user) || isFirestoreBlockedForServerSession();
  const restoreOnlineDestinationEnabled = restoreServerLoginSession
    ? !isOfflineIntentRestore || restoreAsNewCompany
    : !staticBackupClient &&
      restoreOnlineSlotGate.ok &&
      restoreOnlineSlotGate.max > 0 &&
      (!isOfflineIntentRestore || restoreAsNewCompany);
  const [autoBackupEditCompanyOpen, setAutoBackupEditCompanyOpen] = useState(false);
  const [autoBackupEditCompanyTarget, setAutoBackupEditCompanyTarget] = useState<Company | null>(null);
  const autoBackupPreviousCompanyIdRef = useRef<string | null>(null);
  const [autoBackupSettingsCompany, setAutoBackupSettingsCompany] = useState<Company | null>(null);
  const isAutoBackupSettingsLocalCompany = useMemo(
    () => isDeviceLocalCompany(autoBackupSettingsCompany),
    [autoBackupSettingsCompany]
  );
  const [autoBackupSettingsDraft, setAutoBackupSettingsDraft] = useState<AutoBackupCompanySettings>(() =>
    defaultAutoBackupCompanySettings(staticBackupClient)
  );
  const [driveUploadDialogOpen, setDriveUploadDialogOpen] = useState(false);
  const [restoreGmailInput, setRestoreGmailInput] = useState("");
  /** Backup confirm: data-only vs attachment embed (Option A). */
  const [backupIncludeAttachments, setBackupIncludeAttachments] = useState(false);
  const [backupSourceMode, setBackupSourceMode] = useState<CompanyBackupSourceMode>("local_only");
  const [backupIntent, setBackupIntent] = useState<CompanyBackupIntent>("for_offline");
  const [backupAttachmentGateHint, setBackupAttachmentGateHint] = useState<string | null>(null);
  /** Static/EXE: missing local files → ask download vs continue local-only. */
  const [missingAttachmentPrompt, setMissingAttachmentPrompt] = useState<{
    missingCount: number;
    availableCount: number;
    total: number;
  } | null>(null);
  const [missingAttachmentScanBusy, setMissingAttachmentScanBusy] = useState(false);
  /** Restore: bundle ho to attachments restore karna hai ya sirf URLs. */
  const [restoreIncludeAttachments, setRestoreIncludeAttachments] = useState(false);
  const [restoreAttachmentGateHint, setRestoreAttachmentGateHint] = useState<string | null>(null);
  const [attachmentCompareOpen, setAttachmentCompareOpen] = useState(false);
  const [predownloadRunning, setPredownloadRunning] = useState(false);
  const [predownloadProgress, setPredownloadProgress] = useState<StaticBackupPredownloadProgress | null>(null);
  const predownloadAbortRef = useRef<AbortController | null>(null);

  /** Device backup folder prefs → UI state; dono cards same label share karte hain. */
  const refreshBackupLocationUi = useCallback(() => {
    const prefs = readBackupSaveLocationPrefs();
    setWebUseSelectedFolder(prefs.webUseSelectedFolder);
    setWebFolderLabel(prefs.webFolderLabel);
    setWebFolderDisplayPath(prefs.webFolderDisplayPath);
    setNativeFolderPath(prefs.nativeFolderPath ?? null);
    setBackupLocationLabel(readBackupLocationDisplayLabel());
  }, []);

  const openBackupLocationDialog = () => setBackupLocationDialogOpen(true);

  const persistAutoBackupPrefs = (next: AutoBackupPrefs) => {
    setAutoBackupPrefs(next);
    setAutoBackupDraft(next);
    saveAutoBackupPrefs(next);
  };

  const updateAutoBackupDraft = (next: AutoBackupPrefs) => {
    setAutoBackupDraft(next);
  };

  const scheduleModeToFrequency = (mode: AutoBackupScheduleMode): AutoBackupFrequency =>
    mode === "weekly" ? "weekly" : "daily";

  const tryEnableAutoBackup = (checked: boolean): boolean => {
    if (!checked) return true;
    if (canEnableAutoBackup()) return true;
    toast({
      variant: "destructive",
      title: "Backup location required",
      description: "Choose a backup folder before turning on auto backup.",
    });
    openBackupLocationDialog();
    return false;
  };

  const refreshAutoBackupCompanyRows = useCallback(async () => {
    const rows = await loadAutoBackupCompanyPickerRows(allCompanies, user?.uid, user?.email ?? null);
    setAutoBackupCompanyRows(rows);
    return rows;
  }, [allCompanies, user?.uid, user?.email]);

  const closeAutoBackupEditCompanyDialog = useCallback(
    (options?: { refreshRows?: boolean }) => {
      setAutoBackupEditCompanyOpen(false);
      setAutoBackupEditCompanyTarget(null);
      const previousId = autoBackupPreviousCompanyIdRef.current;
      autoBackupPreviousCompanyIdRef.current = null;
      if (previousId) {
        setCompanyId(previousId);
      }
      if (options?.refreshRows !== false) {
        void refreshAutoBackupCompanyRows();
      }
    },
    [refreshAutoBackupCompanyRows, setCompanyId]
  );

  const openAutoBackupEditCompanyDialog = (target: Company) => {
    autoBackupPreviousCompanyIdRef.current = companyId ?? null;
    setAutoBackupEditCompanyTarget(target);
    if (target.id !== companyId) {
      setCompanyId(target.id);
    }
    setAutoBackupEditCompanyOpen(true);
  };

  const handleAutoBackupCompanySaved = useCallback(async () => {
    const editedId = autoBackupEditCompanyTarget?.id;
    reloadLocalCompanyRegistry();
    closeAutoBackupEditCompanyDialog({ refreshRows: false });
    const rows = await refreshAutoBackupCompanyRows();
    if (!editedId) return;
    const edited = rows.find((row) => row.id === editedId);
    if (edited && companyHasAutoBackupPassword(edited)) {
      const prefs = readAutoBackupPrefs();
      persistAutoBackupPrefs({
        ...prefs,
        companyIds: [...new Set([...prefs.companyIds, editedId])],
      });
    }
  }, [
    autoBackupEditCompanyTarget?.id,
    closeAutoBackupEditCompanyDialog,
    refreshAutoBackupCompanyRows,
    reloadLocalCompanyRegistry,
  ]);

  const toggleAutoBackupCompany = (id: string, checked: boolean) => {
    if (checked && !autoBackupEligibleCompanies.some((c) => c.id === id)) return;
    const set = new Set(autoBackupDraft.companyIds);
    if (checked) set.add(id);
    else set.delete(id);
    updateAutoBackupDraft({ ...autoBackupDraft, companyIds: [...set] });
  };

  const openAutoBackupCompanySettings = (target: Company) => {
    const saved = getAutoBackupCompanySettings(autoBackupDraft, target.id, staticBackupClient);
    setAutoBackupSettingsDraft(
      isDeviceLocalCompany(target) ? { ...saved, backupSourceMode: "local_only" } : saved
    );
    setRestoreGmailInput("");
    const enrichedTarget: Company = {
      ...target,
      country: target.country || (target.id === company?.id ? company?.country : undefined),
    };
    setAutoBackupSettingsCompany(enrichedTarget);
  };

  const closeAutoBackupCompanySettings = () => {
    setAutoBackupSettingsCompany(null);
    setRestoreGmailInput("");
  };

  const addRestoreAllowedGmailDraft = () => {
    const email = normalizeBackupRestoreEmail(restoreGmailInput);
    if (!isValidRestoreAllowedGmail(email)) {
      toast({
        variant: "destructive",
        title: "Invalid Gmail",
        description: "Enter a valid Gmail address before adding.",
      });
      return;
    }
    const current = normalizeRestoreAllowedGmailList(
      autoBackupSettingsDraft.restoreAllowedGmails,
      autoBackupSettingsDraft.restoreAllowedGmail
    );
    if (current.includes(email)) {
      toast({
        variant: "destructive",
        title: "Already added",
        description: `${email} is already in the restore access list.`,
      });
      return;
    }
    setAutoBackupSettingsDraft((prev) => ({
      ...prev,
      restoreAllowedGmails: [...current, email],
      restoreAllowedGmail: undefined,
    }));
    setRestoreGmailInput("");
  };

  const removeRestoreAllowedGmailDraft = (email: string) => {
    const next = normalizeRestoreAllowedGmailList(
      autoBackupSettingsDraft.restoreAllowedGmails,
      autoBackupSettingsDraft.restoreAllowedGmail
    ).filter((row) => row !== email);
    setAutoBackupSettingsDraft((prev) => ({
      ...prev,
      restoreAllowedGmails: next.length ? next : undefined,
      restoreAllowedGmail: undefined,
    }));
  };

  const saveAutoBackupCompanySettings = () => {
    const target = autoBackupSettingsCompany;
    if (!target?.id) return;

    const pending = normalizeBackupRestoreEmail(restoreGmailInput);
    let restoreAllowedGmails = normalizeRestoreAllowedGmailList(
      autoBackupSettingsDraft.restoreAllowedGmails,
      autoBackupSettingsDraft.restoreAllowedGmail
    );
    if (pending) {
      if (!isValidRestoreAllowedGmail(pending)) {
        toast({
          variant: "destructive",
          title: "Invalid Gmail",
          description: "Fix the Gmail in the input or clear it before saving.",
        });
        return;
      }
      if (!restoreAllowedGmails.includes(pending)) {
        restoreAllowedGmails = [...restoreAllowedGmails, pending];
      }
      setRestoreGmailInput("");
    }

    const normalizedDraft: AutoBackupCompanySettings = {
      ...autoBackupSettingsDraft,
      ...(isDeviceLocalCompany(target) ? { backupSourceMode: "local_only" as const } : {}),
      ...(restoreAllowedGmails.length ? { restoreAllowedGmails } : {}),
    };
    delete normalizedDraft.restoreAllowedGmail;

    if (
      normalizedDraft.fyScope &&
      normalizedDraft.fyScope !== "all" &&
      !normalizedDraft.fyScope.fromFyKey
    ) {
      toast({
        variant: "destructive",
        title: "No FY selected",
        description: "Tick at least one financial year or choose All FY.",
      });
      return;
    }

    const next = patchAutoBackupCompanySettings(autoBackupDraft, target.id, normalizedDraft);
    persistAutoBackupPrefs(next);
    setAutoBackupSettingsDraft(normalizedDraft);
    toast({
      title: "Backup settings saved",
      description: `Auto backup for ${target.name} will use these options.`,
    });
    closeAutoBackupCompanySettings();
  };

  const handleSaveAutoBackupSettings = () => {
    persistAutoBackupPrefs(autoBackupDraft);
    toast({
      title: "Saved",
      description: "Auto backup settings saved.",
    });
  };

  const handleAutoBackupNow = async (prefsOverride?: AutoBackupPrefs) => {
    if (!user?.uid) return;
    const prefs = prefsOverride ?? autoBackupDraft;
    if (!canEnableAutoBackup()) {
      toast({
        variant: "destructive",
        title: "Backup location required",
        description: "Choose a backup folder first.",
      });
      openBackupLocationDialog();
      return;
    }
    const ids = prefs.companyIds.filter((id) =>
      autoBackupEligibleCompanies.some((c) => c.id === id)
    );
    if (ids.length === 0) {
      toast({
        variant: "destructive",
        title: "No companies selected",
        description: "Tick at least one company for auto backup.",
      });
      return;
    }
    if (isCompanyBackupRunning()) {
      toast({
        variant: "destructive",
        title: "Backup already running",
        description: "Wait for the current backup to finish.",
      });
      return;
    }
    const results = await runAutoBackupQueue({
      companyIds: ids,
      allCompanies: autoBackupCompanyRows.length > 0 ? autoBackupCompanyRows : allCompanies,
      ownerUid: user.uid,
      ownerEmail: user.email ?? null,
      resolveAccountPlanId: (c) => resolveEffectiveAccountPlanId(allCompanies, user.uid, c.planId),
      // Manual Backup now bhi aaj ka run mark kare — warna AutoBackupScheduler same din dobara file bana deta hai.
      markRunsInPrefs: true,
      backupFileRunKind: "Manual",
    });
    const okCount = results.filter((r) => r.result.ok).length;
    const failCount = results.length - okCount;
    if (okCount > 0 && failCount === 0) {
      toast({
        title: "Backup complete",
        description: `${okCount} ${okCount === 1 ? "company" : "companies"} saved under your backup location.`,
      });
    } else if (okCount > 0) {
      toast({
        variant: "destructive",
        title: "Partial backup",
        description: `${okCount} succeeded, ${failCount} failed.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Backup failed",
        description: results[0]?.result.ok === false ? results[0].result.error : "Could not run backup.",
      });
    }
  };

  const handleSaveAndAutoBackupNow = async () => {
    persistAutoBackupPrefs(autoBackupDraft);
    await handleAutoBackupNow(autoBackupDraft);
  };

  /** Restore cancel — backup runner jaisa AbortController. */
  const cancelRestoreRun = () => {
    if (!isRestoring || !restoreAbortRef.current) return false;
    restoreAbortRef.current.abort();
    return true;
  };

  const beginRestoreProgress = (backupData: Record<string, unknown>, restoreAttachments: boolean) => {
    restoreAbortRef.current?.abort();
    restoreAbortRef.current = new AbortController();
    const signal = restoreAbortRef.current.signal;
    const total = countRestoreWorkUnits(backupData, restoreAttachments, collectionsToBackup);
    const report = createRestoreProgressReporter(total, setRestoreProgress, signal);
    report.tick("Starting restore", "Preparing…", 0, 0);
    return { signal, report };
  };

  // When Online destination becomes unavailable, fall back to Offline.
  useEffect(() => {
    if (!isOverwriteConfirmOpen) return;
    if (!restoreOnlineDestinationEnabled && !restoreToLocalSqlite) {
      setRestoreToLocalSqlite(true);
    }
  }, [isOverwriteConfirmOpen, restoreOnlineDestinationEnabled, restoreToLocalSqlite]);

  // Restore chalu hote hi progress popup khud khule; restore khatam par band (render-phase sync, effect nahi).
  const [prevIsRestoring, setPrevIsRestoring] = useState(isRestoring);
  if (isRestoring !== prevIsRestoring) {
    setPrevIsRestoring(isRestoring);
    setRestoreProgressDialogOpen(isRestoring);
  }

  // Reset restore choices only when the confirm dialog opens — not when attachment hints update while open.
  useEffect(() => {
    if (!isOverwriteConfirmOpen) return;
    const offlineBackup = isOfflineIntentBackupData(backupDataToRestore as Record<string, unknown> | null);
    setRestoreToLocalSqlite(true);
    setRestoreCompanyNameChoice(company ? "target" : "backup");
    setRestoreTargetMode(company ? "replace_current" : "new_company");
    if (!company) setRestoreToLocalSqlite(true);
    const hasBundle = backupDataHasAttachmentBundle(backupDataToRestore);
    // Local device restore: attachments default ON jab backup me embedded files hon.
    setRestoreIncludeAttachments(Boolean(hasBundle));
    // Offline backup + open company → default Offline; no company → user Online choose kar sakta hai (naya company).
    if (offlineBackup && company) setRestoreToLocalSqlite(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open-only reset
  }, [isOverwriteConfirmOpen, company?.id, backupDataToRestore]);

  useEffect(() => {
    // Attachment backup dialog: plan limit hint (online merge + attachments only).
    if (!isEncryptedBackupConfirmOpen || !user?.uid || backupSourceMode === "local_only") {
      setBackupAttachmentGateHint(null);
      return;
    }
    void (async () => {
      const gate = await checkAttachmentBackupAllowed(user.uid, accountPlanId);
      if (!attachmentFeatureOn) {
        setBackupAttachmentGateHint("Not included on your plan — use Data only or upgrade.");
        return;
      }
      setBackupAttachmentGateHint(formatAttachmentUsageRemaining(gate.cap, gate.used));
    })();
  }, [isEncryptedBackupConfirmOpen, user?.uid, accountPlanId, attachmentFeatureOn, backupSourceMode]);

  useEffect(() => {
    if (!isOverwriteConfirmOpen || !user?.uid || !backupDataHasAttachmentBundle(backupDataToRestore)) {
      setRestoreAttachmentGateHint(null);
      return;
    }
    if (staticBackupClient || restoreToLocalSqlite) {
      setRestoreAttachmentGateHint(
        "Device restore: files stay on this app/browser storage — not auto-downloaded from server later."
      );
      return;
    }
    setRestoreAttachmentGateHint(
      "Cloud restore: files are written to this device first; after reload they upload to Firestore in the background."
    );
  }, [isOverwriteConfirmOpen, backupDataToRestore, user?.uid, restoreToLocalSqlite, staticBackupClient]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await loadAutoBackupCompanyPickerRows(allCompanies, user?.uid, user?.email ?? null);
      if (cancelled) return;
      setAutoBackupCompanyRows(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [allCompanies, user?.uid, user?.email]);

  useEffect(() => {
    setAutoBackupPrefs((prefs) => {
      const synced = syncAutoBackupCompanyIdsWithEligible(prefs, autoBackupEligibleCompanies);
      if (synced.companyIds.length === prefs.companyIds.length) return prefs;
      saveAutoBackupPrefs(synced);
      return synced;
    });
    setAutoBackupDraft((draft) => {
      const synced = syncAutoBackupCompanyIdsWithEligible(draft, autoBackupEligibleCompanies);
      return synced.companyIds.length === draft.companyIds.length ? draft : synced;
    });
  }, [autoBackupEligibleCompanies]);

  useEffect(() => {
    refreshBackupLocationUi();
    const live = readLiveDataFolderPrefs();
    setLiveWebEnabled(live.webEnabled);
    setLiveWebLabel(live.webFolderLabel);
    setLiveNativeFolderPath(live.nativeFolderPath);
    setAutoBackupPrefs(readAutoBackupPrefs());
    setAutoBackupDraft(readAutoBackupPrefs());
  }, [refreshBackupLocationUi]);

  useEffect(() => {
    // Deep link — backup location dialog.
    if (searchParams.get("dialog") === "backup-location") {
      setBackupLocationDialogOpen(true);
    }
  }, [searchParams]);


  const closeBackupLocationDialog = () => {
    setBackupLocationDialogOpen(false);
    refreshBackupLocationUi();
    if (searchParams.get("dialog") !== "backup-location") return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("dialog");
    const q = next.toString();
    const basePath = pathnameForModalRouterReplace(pathname || "");
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
  };

  const handlePickWebFolder = async () => {
    try {
      // Desktop EXE: native dialog se poora path (D:\Backup PL\…) store karo.
      if (canPickElectronBackupDirectory()) {
        const { pickElectronBackupDirectory } = await import("@/lib/electronBackupFolder");
        const { path: pickedPath, cancelled } = await pickElectronBackupDirectory();
        if (cancelled || !pickedPath) return;
        await clearWebBackupDirectoryHandle();
        const leafName =
          pickedPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Selected folder";
        const prev = readBackupSaveLocationPrefs();
        saveBackupSaveLocationPrefs({
          ...prev,
          webUseSelectedFolder: true,
          webFolderLabel: leafName,
          webFolderDisplayPath: pickedPath,
        });
        setWebUseSelectedFolder(true);
        setWebFolderLabel(leafName);
        setWebFolderDisplayPath(pickedPath);
        toast({ title: "Backup location saved", description: `Folder set to ${pickedPath}.` });
        refreshBackupLocationUi();
        return;
      }

      if (!supportsWebFolderPicker) return;
      const picker = (window as any).showDirectoryPicker;
      const handle = await picker({ mode: "readwrite" });
      const ok = await storeWebBackupDirectoryHandle(handle);
      if (!ok) {
        toast({ variant: "destructive", title: "Failed", description: "Could not store selected folder on this device." });
        return;
      }
      const nextLabel = String(handle?.name || "Selected folder");
      const prev = readBackupSaveLocationPrefs();
      saveBackupSaveLocationPrefs({
        ...prev,
        webUseSelectedFolder: true,
        webFolderLabel: nextLabel,
        webFolderDisplayPath: null,
      });
      setWebUseSelectedFolder(true);
      setWebFolderLabel(nextLabel);
      setWebFolderDisplayPath(null);
      toast({ title: "Backup location saved", description: `Folder set to ${nextLabel}.` });
      refreshBackupLocationUi();
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast({ variant: "destructive", title: "Failed", description: "Could not select backup folder." });
    }
  };

  const handleClearWebFolder = async () => {
    await clearWebBackupDirectoryHandle();
    const prev = readBackupSaveLocationPrefs();
    saveBackupSaveLocationPrefs({
      ...prev,
      webUseSelectedFolder: false,
      webFolderLabel: null,
      webFolderDisplayPath: null,
    });
    setWebUseSelectedFolder(false);
    setWebFolderLabel(null);
    setWebFolderDisplayPath(null);
    toast({ title: "Backup location cleared", description: "Backup will ask location again." });
    refreshBackupLocationUi();
  };

  const handleSaveWebLocation = async () => {
    const displayPath = String(webFolderDisplayPath || "").trim();
    const label =
      String(webFolderLabel || "").trim() ||
      (displayPath ? displayPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Selected folder" : "");
    if (!label && !displayPath) {
      toast({
        variant: "destructive",
        title: "Location not set",
        description: "Browse a folder or paste the full path, then save location.",
      });
      return;
    }
    setSavingBackupLocation(true);
    try {
      const prev = readBackupSaveLocationPrefs();
      saveBackupSaveLocationPrefs({
        ...prev,
        webUseSelectedFolder: true,
        webFolderLabel: label || prev.webFolderLabel,
        webFolderDisplayPath: displayPath || prev.webFolderDisplayPath,
      });
      setWebUseSelectedFolder(true);
      if (label) setWebFolderLabel(label);
      toast({
        title: "Location saved",
        description: displayPath ? `Backups will save to ${displayPath}.` : `Backups will save to ${label}.`,
      });
      refreshBackupLocationUi();
      closeBackupLocationDialog();
    } finally {
      setSavingBackupLocation(false);
    }
  };

  const handlePickNativeFolder = async () => {
    try {
      const { FilePicker } = await import("@capawesome/capacitor-file-picker");
      const result = await FilePicker.pickDirectory();
      const pickedPath = String((result as { path?: string })?.path || "").trim();
      if (!pickedPath) {
        toast({ variant: "destructive", title: "No folder selected", description: "Please select a folder." });
        return;
      }
      setNativeFolderPath(pickedPath);
      const prev = readBackupSaveLocationPrefs();
      saveBackupSaveLocationPrefs({
        ...prev,
        nativeFolderPath: pickedPath,
        nativeSubfolder: "",
      });
      toast({ title: "Folder selected", description: "Browse-selected folder mode active." });
    } catch (e: any) {
      if (String(e?.message || "").toLowerCase().includes("canceled")) return;
      toast({ variant: "destructive", title: "Browse failed", description: "Could not open native folder browser." });
    }
  };

  const handleSaveNativeLocation = async () => {
    if (!nativeFolderPath?.trim()) {
      toast({ variant: "destructive", title: "Location not set", description: "Use Browse folder first, then save location." });
      return;
    }
    setSavingBackupLocation(true);
    try {
      const prev = readBackupSaveLocationPrefs();
      saveBackupSaveLocationPrefs({
        ...prev,
        nativeFolderPath: nativeFolderPath.trim(),
        nativeSubfolder: "",
      });
      toast({
        title: "Location saved",
        description: `Folder set to ${formatNativeFolderDisplayPath(nativeFolderPath)}.`,
      });
      refreshBackupLocationUi();
      closeBackupLocationDialog();
    } finally {
      setSavingBackupLocation(false);
    }
  };

  const handleClearNativeFolder = async () => {
    const prev = readBackupSaveLocationPrefs();
    saveBackupSaveLocationPrefs({
      ...prev,
      nativeFolderPath: null,
    });
    setNativeFolderPath(null);
    toast({ title: "Selected folder cleared", description: "Backup will use default directory mode." });
  };

  const handlePickLiveDataWebFolder = async () => {
    if (!supportsWebFolderPicker) return;
    try {
      const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode: string }) => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker;
      if (!picker) return;
      const handle = await picker.call(window, { mode: "readwrite" });
      const ok = await storeWebLiveDataDirectoryHandle(handle);
      if (!ok) {
        toast({ variant: "destructive", title: "Failed", description: "Could not store folder handle on this device." });
        return;
      }
      const nextLabel = String((handle as { name?: string })?.name || "Selected folder");
      setLiveWebLabel(nextLabel);
      toast({
        title: "Folder selected",
        description: "Tap “Save data location” to start writing local company copies here.",
      });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
      toast({ variant: "destructive", title: "Failed", description: "Could not select folder." });
    }
  };

  const handleSaveLiveDataLocation = async () => {
    if (!nativeRuntime) {
      if (!liveWebLabel?.trim()) {
        toast({ variant: "destructive", title: "Pick a folder first", description: "Use Select folder, then save." });
        return;
      }
    } else if (!liveNativeFolderPath?.trim()) {
      toast({ variant: "destructive", title: "Pick a folder first", description: "Browse to a folder on this device." });
      return;
    }
    setSavingLiveDataLocation(true);
    try {
      const salt = ensureLiveDataMirrorSalt();
      await ensureLiveMirrorAutoPassphrase();
      saveLiveDataFolderPrefs({
        webEnabled: !nativeRuntime,
        webFolderLabel: nativeRuntime ? null : liveWebLabel,
        nativeFolderPath: nativeRuntime ? (liveNativeFolderPath?.trim() ?? null) : null,
        mirrorSaltBase64: salt,
      });
      setLiveWebEnabled(!nativeRuntime);
      if (!nativeRuntime) {
        const root = (await readWebLiveDataDirectoryHandle()) as FileSystemDirectoryHandle | null;
        if (root) await getOrCreatePocketLedgerDir(root);
      }
      await syncAllLocalCompanyDeltasToFolder({ userInitiated: true });
      toast({
        title: "Data location saved",
        description: `Encrypted copies are written under ${POCKET_LEDGER_MIRROR_DIR}/${COMPANIES_DIR_SEGMENT}/… (auto key on this device).`,
      });
      setLiveDataLocationDialogOpen(false);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Save failed", description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setSavingLiveDataLocation(false);
    }
  };

  const handleClearLiveDataLocation = async () => {
    await clearWebLiveDataDirectoryHandle();
    await clearLiveDataFolderPrefsAndSession();
    saveLiveDataFolderPrefs({
      webEnabled: false,
      webFolderLabel: null,
      nativeFolderPath: null,
      mirrorSaltBase64: null,
    });
    setLiveWebEnabled(false);
    setLiveWebLabel(null);
    setLiveNativeFolderPath(null);
    toast({ title: "Data save location cleared", description: "Mirrors will no longer be written to a custom folder." });
  };

  const handlePickLiveDataNativeFolder = async () => {
    try {
      const { FilePicker } = await import("@capawesome/capacitor-file-picker");
      const result = await FilePicker.pickDirectory();
      const pickedPath = String((result as { path?: string })?.path || "").trim();
      if (!pickedPath) {
        toast({ variant: "destructive", title: "No folder selected" });
        return;
      }
      setLiveNativeFolderPath(pickedPath);
      toast({ title: "Folder selected", description: "Save data location to enable mirror writes." });
    } catch (e: unknown) {
      if (String((e as Error)?.message || "").toLowerCase().includes("canceled")) return;
      toast({ variant: "destructive", title: "Browse failed" });
    }
  };

  const handleSyncLiveDataNow = async () => {
    try {
      await syncAllLocalCompanyDeltasToFolder({ userInitiated: true });
      toast({ title: "Synced", description: "Encrypted mirrors under pocket-ledger/ refreshed (if configured)." });
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Sync failed", description: e instanceof Error ? e.message : "" });
    }
  };

  const handleBackupClick = () => {
    const preferOffline =
      staticBackupClient || (typeof navigator !== "undefined" && !navigator.onLine);
    const localOnlySource = staticBackupClient || preferOffline || isLocalCompanyBackup;
    setBackupIntent(preferOffline ? "for_offline" : "for_online");
    setBackupSourceMode(localOnlySource ? "local_only" : "online_merge");
    setBackupIncludeAttachments(Boolean(localOnlySource));
    setIsEncryptedBackupConfirmOpen(true);
  };

  const runBackupWithPolicy = async (
    withAttachments: boolean,
    attachmentMissingPolicy: CompanyBackupAttachmentMissingPolicy
  ) => {
    if (!companyId || !company || !user?.uid) return;

    if (isCompanyBackupRunning()) {
      toast({
        variant: "destructive",
        title: "Backup already running",
        description: "Wait for the current backup to finish. Do not refresh the page.",
      });
      return;
    }

    if (backupFyScopeDraft !== "all" && !backupFyScopeDraft.fromFyKey) {
      toast({
        variant: "destructive",
        title: "No FY selected",
        description: "Tick at least one financial year or choose All FY.",
      });
      return;
    }

    let backupCompany = company;
    if (staticBackupClient || backupIntent === "for_offline" || backupSourceMode === "local_only") {
      const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
      if (localRow) {
        backupCompany = {
          ...company,
          ...(localRow as Record<string, unknown>),
          id: companyId,
          storageOption: company.storageOption ?? (localRow as { storageOption?: string }).storageOption,
          syncPolicy: company.syncPolicy ?? (localRow as { syncPolicy?: string }).syncPolicy,
        } as typeof company;
      }
    }

    const staticOfflineOnlineCompany =
      staticBackupClient &&
      backupIntent === "for_offline" &&
      !isLocalCompanyBackup;
    if (staticOfflineOnlineCompany) {
      const predownload = await runStaticCompanyBackupPredownload({
        company: backupCompany,
        companyId,
        includeAttachments: false,
        signal: undefined,
        onProgress: (p) => {
          setPredownloadProgress(p);
        },
      });
      if (predownload.ok !== true) {
        setPredownloadProgress(null);
        toast({
          variant: "destructive",
          title: "Backup blocked",
          description: predownload.error,
        });
        return;
      }
      window.setTimeout(() => setPredownloadProgress(null), 4000);
    }

    // Static EXE: always SQLite-only. Missing files = user policy (download optional).
    const resolvedSourceMode: CompanyBackupSourceMode = staticBackupClient
      ? "local_only"
      : backupIntent === "for_offline"
        ? "local_only"
        : backupSourceMode;

    const result = await startCompanyBackupRun({
      company: backupCompany,
      companyId,
      ownerUid: user.uid,
      accountPlanId,
      includeAttachments: withAttachments,
      backupSourceMode: resolvedSourceMode,
      backupIntent: staticBackupClient ? backupIntent : backupIntent,
      attachmentMissingPolicy: withAttachments ? attachmentMissingPolicy : undefined,
      backupRelativeDir: buildAutoBackupRelativeDir(
        String(backupCompany.name || company.name || companyId),
        companyId,
        new Date(),
        autoBackupDraft.folderDateSystem ?? readAutoBackupPrefs().folderDateSystem
      ),
      folderDateSystem: autoBackupDraft.folderDateSystem ?? readAutoBackupPrefs().folderDateSystem,
      backupFileRunKind: "Manual",
      backupRestoreGmails: getAutoBackupCompanySettings(autoBackupPrefs, companyId, staticBackupClient)
        .restoreAllowedGmails,
      fyScope: backupFyScopeDraft,
    });

    if (result.ok === true) {
      const embedded = result.attachmentEmbeddedCount ?? 0;
      const refs = result.attachmentRefCount ?? 0;
      if (result.includeAttachments) {
        const missing = Math.max(0, refs - embedded);
        toast({
          title: missing > 0 ? "Backup saved — some files missing" : "Success",
          variant: missing > 0 ? "destructive" : "default",
          description:
            missing > 0
              ? `${embedded} of ${refs} files embedded. ${missing} missing link(s) were removed from this backup.`
              : `Backup saved: ${result.where} (${embedded} file${embedded === 1 ? "" : "s"} embedded)`,
        });
      } else if (withAttachments && refs > 0) {
        toast({
          title: "Backup saved (local data only)",
          description: `${refs} attachment link(s) had no local files — links removed. Pending/local files that were available were included when present.`,
          duration: 10_000,
        });
      } else {
        toast({
          title: "Success",
          description: `Backup saved: ${result.where}`,
        });
      }
      dismissCompanyBackupRunLater(8000);
    } else if (!result.cancelled) {
      toast({
        variant: "destructive",
        title: "Backup Failed",
        description: result.error,
      });
    }
  };

  const handleBackup = async (includeAttachments: boolean) => {
    if (!companyId || !company || !user?.uid) return;

    const localDeviceEmbed =
      staticBackupClient ||
      backupIntent === "for_offline" ||
      backupSourceMode === "local_only" ||
      isLocalCompanyBackup;
    const tickGate = getOnlineCompanyBackupTickGate(company, {
      attachmentEmbedMode: localDeviceEmbed ? "local_device_bytes" : "may_download",
    });
    if (includeAttachments && !tickGate.filesAllowed) {
      toast({
        variant: "destructive",
        title: "Files tick required",
        description:
          tickGate.filesMessage ||
          "Turn on Files for this company in Company Selector (Online tab), then Save — to download missing attachments. Or choose Local device only to embed files already on this device.",
      });
      return;
    }

    if (isCompanyBackupRunning()) {
      toast({
        variant: "destructive",
        title: "Backup already running",
        description: "Wait for the current backup to finish. Do not refresh the page.",
      });
      return;
    }

    if (backupFyScopeDraft !== "all" && !backupFyScopeDraft.fromFyKey) {
      toast({
        variant: "destructive",
        title: "No FY selected",
        description: "Tick at least one financial year or choose All FY.",
      });
      return;
    }

    try {
      assertCan(can, "export_data");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast({ variant: "destructive", title: "Permission Denied", description: error.message });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to check permissions." });
      }
      setIsEncryptedBackupConfirmOpen(false);
      return;
    }

    setIsEncryptedBackupConfirmOpen(false);

    const allowsAttachmentEmbed =
      staticBackupClient ||
      backupIntent === "for_offline" ||
      backupSourceMode === "local_only" ||
      isLocalCompanyBackup ||
      attachmentFeatureOn;
    const withAttachments = includeAttachments && allowsAttachmentEmbed;

    // Static: SQLite-only + ask when some attachment bytes missing on device.
    if (staticBackupClient && withAttachments) {
      setMissingAttachmentScanBusy(true);
      try {
        const scan = await scanSqliteBackupAttachmentGaps({ companyId });
        if (scan.missingCount > 0) {
          setMissingAttachmentPrompt({
            missingCount: scan.missingCount,
            availableCount: scan.availableCount,
            total: scan.total,
          });
          return;
        }
        await runBackupWithPolicy(true, "local_only");
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Backup scan failed",
          description: e instanceof Error ? e.message : "Could not check local attachments.",
        });
      } finally {
        setMissingAttachmentScanBusy(false);
      }
      return;
    }

    await runBackupWithPolicy(
      withAttachments,
      backupSourceMode === "local_only" || backupIntent === "for_offline"
        ? "local_only"
        : "download_missing"
    );
  };

  const handlePredownloadForBackup = async (includeAttachments = true) => {
    if (!companyId || !company) return;
    if (predownloadRunning) return;
    try {
      assertCan(can, "export_data");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast({ variant: "destructive", title: "Permission Denied", description: (error as PermissionDeniedError).message });
      }
      return;
    }
    if (includeAttachments) {
      setAttachmentCompareOpen(true);
      return;
    }
    predownloadAbortRef.current?.abort();
    const ac = new AbortController();
    predownloadAbortRef.current = ac;
    setPredownloadRunning(true);
    setPredownloadProgress({ phase: "Starting", detail: "Preparing…" });
    try {
      const result = await runStaticCompanyBackupPredownload({
        company,
        companyId,
        signal: ac.signal,
        includeAttachments,
        onProgress: setPredownloadProgress,
      });
      if (result.ok) {
        toast({
          title: "Pre-download complete",
          description: includeAttachments
            ? "Local SQLite and attachments are ready. You can create a backup with attachments."
            : "Company data is downloaded to local SQLite on this device.",
        });
        window.setTimeout(() => setPredownloadProgress(null), 4000);
      } else if (result.ok === false && !result.cancelled) {
        toast({ variant: "destructive", title: "Pre-download failed", description: result.error });
        window.setTimeout(() => setPredownloadProgress(null), 8000);
      } else {
        setPredownloadProgress(null);
      }
    } finally {
      setPredownloadRunning(false);
      predownloadAbortRef.current = null;
    }
  };

  const cancelPredownload = () => {
    if (!predownloadAbortRef.current) return;
    predownloadAbortRef.current.abort();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        setFileToRestore(file);
        setDecryptionPassword('');
      setShowDecryptionPassword(false);
        setDecryptionError(null);
        setBackupDataToRestore(null); // Clear previous data
        setIsOverwriteConfirmOpen(false);
        setConfirmationText('');
        setIsDecrypting(false);
    }
    else toast({ variant: "destructive", title: "Please select a valid file." });
  };

  const handlePickRestoreFileNative = async () => {
    try {
      const { FilePicker } = await import("@capawesome/capacitor-file-picker");
      // Android WebView me HTML file input unreliable ho sakta hai; native picker se file read-data lo.
      const picked = await FilePicker.pickFiles({
        limit: 1,
        readData: true,
        types: [
          "application/json",
          "application/octet-stream",
          ".json",
          ".plbp",
          ".webtally",
        ],
      } as Record<string, unknown>);
      // Plugin result already typed (`PickFilesResult`) — unsafe record cast avoid to keep TS strict mode happy.
      const first = picked.files?.[0];
      if (!first) return;

      const fileName = String(first.name || "backup.plbp");
      const mimeType = String(first.mimeType || "application/octet-stream");
      const data = first.data;
      if (typeof data !== "string" || !data.trim()) {
        toast({
          variant: "destructive",
          title: "Read failed",
          description: "Could not read selected backup file. Please pick again.",
        });
        return;
      }

      const restoredFile = fileFromBase64Payload(data, fileName, mimeType);
      setFileToRestore(restoredFile);
      setDecryptionPassword("");
      setShowDecryptionPassword(false);
      setDecryptionError(null);
      setBackupDataToRestore(null);
      setIsOverwriteConfirmOpen(false);
      setConfirmationText("");
      setIsDecrypting(false);
      toast({ title: "File selected", description: fileName });
    } catch (e: any) {
      if (String(e?.message || "").toLowerCase().includes("canceled")) return;
      toast({
        variant: "destructive",
        title: "File select failed",
        description: "Could not open backup file picker on this device.",
      });
    }
  };

  const processRestoreData = async () => {
    if (!fileToRestore) throw new Error("No file selected for restore.");

    const bytes = new Uint8Array(await fileToRestore.arrayBuffer());
    const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4096))).trimStart();

    if (head.startsWith("{")) {
      try {
        const backupData = JSON.parse(new TextDecoder().decode(bytes));
        if (backupData?.companyDetails?.[0]?.handoverStatus === "accepted") {
          const receiver = backupData.companyDetails[0].handoverTo;
          throw new Error(`This company was surrendered to ${receiver}. You can no longer restore it.`);
        }
        restoreZipFilesRef.current = null;
        setRestoreZipFilesByPath(null);
        return backupData;
      } catch (e) {
        if (e instanceof Error && e.message.includes("surrendered")) throw e;
      }
    }

    if (isPlbpZipPayload(bytes)) {
      try {
        const { manifest, filesByPath } = unpackPlbpZipBackup(bytes);
        if (manifest?.companyDetails?.[0]?.handoverStatus === "accepted") {
          const receiver = (manifest.companyDetails as Array<{ handoverTo?: string }>)[0]?.handoverTo;
          throw new Error(`This company was surrendered to ${receiver}. You can no longer restore it.`);
        }
        restoreZipFilesRef.current = filesByPath;
        setRestoreZipFilesByPath(filesByPath);
        return manifest;
      } catch (e) {
        if (e instanceof Error && e.message.includes("surrendered")) throw e;
      }
    }

    setIsDecrypting(true);
    return null;
  };

  const startRestore = async () => {
      if (company) try {
        // Permission check: import
        assertCan(can, "import_data");
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          toast({
            variant: "destructive",
            title: "Permission Denied",
            description: error.message,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to check permissions.",
          });
        }
        return;
      }
      
      try {
        const data = await processRestoreData();
        if (data) { 
           if (company && !company.isOwned) {
                toast({variant: 'destructive', title: "Permission Denied", description: "Only the company owner can overwrite data."});
                return;
            }
            setBackupDataToRestore(data);
            setIsOverwriteConfirmOpen(true);
        }
      } catch (error: any) {
        if (error instanceof PermissionDeniedError) {
          toast({ variant: "destructive", title: "Permission Denied", description: error.message });
        } else {
          toast({ variant: "destructive", title: "Restore Failed", description: error.message });
        }
      }
  }
  
  const handleDecryptionAndRestore = async () => {
      if (!fileToRestore) return;
      setIsRestoring(true);
      setDecryptionError(null);
      
      try {
          const encryptedContent = await fileToRestore.text();
          const plainBytes = await decryptBytes(encryptedContent, decryptionPassword);
          let backupData: Record<string, unknown>;
          if (isPlbpZipPayload(plainBytes)) {
            const { manifest, filesByPath } = unpackPlbpZipBackup(plainBytes);
            restoreZipFilesRef.current = filesByPath;
            setRestoreZipFilesByPath(filesByPath);
            backupData = manifest;
          } else {
            restoreZipFilesRef.current = null;
            setRestoreZipFilesByPath(null);
            backupData = JSON.parse(new TextDecoder().decode(plainBytes)) as Record<string, unknown>;
          }
          
          if (backupData?.companyDetails?.[0]?.handoverStatus === 'accepted') {
              const receiver = backupData.companyDetails[0].handoverTo;
              toast({ 
                  variant: "destructive", 
                  title: "Restore Blocked", 
                  description: `This company was surrendered to ${receiver}. You can no longer restore it.` 
              });
              setFileToRestore(null);
              setIsDecrypting(false);
              return;
          }
          
          toast({ title: "Decryption Successful" });
          setIsDecrypting(false); 

          if (company && !company.isOwned) {
            toast({variant: 'destructive', title: "Permission Denied", description: "Only the company owner can overwrite data."});
            return;
          }
          setBackupDataToRestore(backupData);
          setIsOverwriteConfirmOpen(true);
          
          setFileToRestore(null);
          setDecryptionPassword('');

      } catch (error: any) {
           if (error instanceof Error && error.message === "INVALID_PASSWORD") {
            setDecryptionError("Incorrect password. Please try again.");
          } else {
            setDecryptionError("Decryption failed. The file may be corrupted or not a valid backup.");
          }
      } finally {
        setIsRestoring(false);
      }
  }

  /** Static/local-first: backup → SQLite `company_docs` + `companies` row (Firebase account password nahi) */
  const handleLocalOverwriteRestore = async (
    backupData: any,
    resolvedCompanyName: string,
    restoreAttachments: boolean,
    restoreTargetMode: RestoreTargetMode,
    options?: { cloudRestore?: boolean; zipFilesByPath?: Map<string, Uint8Array> | null }
  ) => {
    if (!user?.uid || !backupData) return;
    if (restoreTargetMode === "replace_current" && !companyId) return;

    const backupCompanyDetails = backupData?.companyDetails?.[0];
    if (!backupCompanyDetails) {
      toast({ variant: "destructive", title: "Invalid Backup", description: "Backup file is missing company details." });
      return;
    }

    const backupCompanyId = backupCompanyDetails.id;
    const backupOwnerId = backupCompanyDetails.ownerId;
    const backupOwnerEmail = backupCompanyDetails.ownerEmail;

    const canRestore = canUserRestoreBackup({
      userUid: user.uid,
      userEmail: user.email,
      backupCompanyDetails,
    });

    if (!canRestore) {
      toast({
        variant: "destructive",
        title: "Restore Blocked",
        description: backupOwnerEmail
          ? `This backup belongs to ${backupOwnerEmail}. Illegal restore attempt recorded.`
          : "This backup belongs to another owner. Illegal restore attempt recorded.",
        duration: 8000,
      });
      try {
        const notified = await sendSecurityAlertClient({
          backupOwnerId,
          backupOwnerEmail,
          backupSharedWith: backupCompanyDetails?.sharedWith || [],
          attemptedByUid: user.uid,
          attemptedByEmail: user.email ?? "",
          attemptedByName: (customUser?.displayName || user?.displayName) ?? undefined,
          companyName: backupCompanyDetails.name,
          companyId: backupCompanyId,
        });
        if (!notified) {
          toast({
            variant: "destructive",
            title: "Owner Notification Failed",
            description: "Attempt was blocked, but we could not resolve the original company admin to notify.",
            duration: 7000,
          });
        }
      } catch (e) {
        console.error("Failed to send restore security alert:", e);
      }
      setIsOverwriteConfirmOpen(false);
      setFileToRestore(null);
      return;
    }

    // Pocket Ledger Server login: Firestore is off for this session (no reads, no writes).
    const pbServerSession = isPocketBaseSessionUser(user) || isFirestoreBlockedForServerSession();
    try {
      if (user?.uid && !pbServerSession) {
        const userDocRef = doc(firestore, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          const surrenderedCompanies = userData.surrenderedCompanies || {};
          const surrenderedInfo = surrenderedCompanies[backupCompanyId];
          if (surrenderedInfo) {
            const formattedDate = new Date(surrenderedInfo.date.seconds * 1000).toLocaleDateString();
            toast({
              variant: "destructive",
              title: "Restore Blocked",
              description: `You surrendered this company to "${surrenderedInfo.surrenderedTo}" on ${formattedDate}. You cannot restore it.`,
              duration: 10000,
            });
            setIsOverwriteConfirmOpen(false);
            setFileToRestore(null);
            return;
          }
        }
      }
    } catch {
      /* offline / no Firestore — local restore allow */
    }

    const replaceCurrent = restoreTargetMode === "replace_current";
    const cloudRestore = options?.cloudRestore === true;
    // Online target: a Pocket Ledger Server login always restores to the server (no Firestore write).
    // Otherwise a new company goes to the admin-selected online server (same as Create company);
    // replacing an existing company keeps that company's own server.
    let pbRestore = false;
    if (cloudRestore) {
      if (pbServerSession) {
        pbRestore = true;
      } else if (replaceCurrent) {
        pbRestore = isPocketBaseCompany(companyId, company);
      } else {
        try {
          const onlineBackend = resolveOnlineDataBackend(
            await ensureOnlineDataServerSettingsHydrated({ force: true }),
            "backup restore"
          );
          pbRestore = onlineBackend.effective.id === ONLINE_DATA_SERVER_POCKETBASE_ID;
        } catch (e) {
          console.warn("[BackupRestore] online server settings unavailable; restoring to Firebase:", e);
        }
      }
    }
    if (pbRestore && !getValidPocketBaseAuth()) {
      toast({
        variant: "destructive",
        title: "Pocket Ledger Server sign-in needed",
        description: "Sign in to the Pocket Ledger Server first, then restore again.",
        duration: 10_000,
      });
      setIsOverwriteConfirmOpen(false);
      return;
    }

    setIsRestoring(true);
    setIsOverwriteConfirmOpen(false);

    let restoreHoldCompanyId = "";
    try {
      const { signal, report } = beginRestoreProgress(backupData, restoreAttachments);

      const targetCompanyId = replaceCurrent
        ? String(companyId || "").trim()
        : generateCompanyId(
            resolvedCompanyName.trim() || String(backupCompanyDetails.name ?? "company")
          );
      restoreHoldCompanyId = targetCompanyId;
      if (!targetCompanyId) {
        toast({ variant: "destructive", title: "Restore Failed", description: "No company selected to restore into." });
        return;
      }

      const existingBeforeReplace = replaceCurrent
        ? await getLocalCompanyById(targetCompanyId, { includeDeleted: true })
        : null;

      await getBrowserDb();

      let dataToWrite = backupData;
      let attachmentRefMap: Map<string, string> | undefined;
      const zipFilesForRestore = resolveRestoreZipFiles(
        options?.zipFilesByPath ?? restoreZipFilesByPath,
        restoreZipFilesRef.current
      );
      // Attachments pehle — company clear se pehle fail ho to purana ledger safe rahe.
      // Hold: pending orphan sync is window me restored bytes delete na kare.
      if (restoreAttachments && backupDataHasAttachmentBundle(backupData)) {
        beginLocalAttachmentRestoreHold(targetCompanyId);
        // Server login: the Firebase plan is unknown (Free), so its attachment gate would always block.
        if (!staticBackupClient && !pbServerSession) {
          const gate = await checkAttachmentRestoreAllowed(user.uid, accountPlanId);
          if (!gate.allowed) {
            endLocalAttachmentRestoreHold(targetCompanyId);
            toast({ variant: "destructive", title: "Attachment restore blocked", description: gate.message });
            setIsRestoring(false);
            setRestoreProgress(null);
            return;
          }
        }
        const zipMan = backupData.attachmentZipManifest as { entries?: unknown[] } | undefined;
        if (Array.isArray(zipMan?.entries) && zipMan.entries.length > 0 && !zipFilesForRestore?.size) {
          endLocalAttachmentRestoreHold(targetCompanyId);
          toast({
            variant: "destructive",
            title: "Attachment zip missing",
            description:
              "Backup manifest has files but zip bytes were lost. Decrypt the backup again, then restore immediately.",
            duration: 12_000,
          });
          setIsRestoring(false);
          setRestoreProgress(null);
          return;
        }
        attachmentRefMap = await restoreAttachmentsFromBackupData(
          backupData,
          zipFilesForRestore,
          targetCompanyId,
          (done, total, bytes) =>
            report.tick("Restoring attachments", `${done}/${total} file(s) to device storage…`, 1, bytes),
          signal,
          { usePocketLedgerStorage: cloudRestore }
        );
        await flushPendingBrowserDbSave();
        const expectedFiles = getAttachmentRestoreEntryCount(backupData);
        const restoredFiles = attachmentRefMap?.size
          ? new Set(attachmentRefMap.values()).size
          : 0;
        if (expectedFiles > 0 && restoredFiles === 0) {
          endLocalAttachmentRestoreHold(targetCompanyId);
          toast({
            variant: "destructive",
            title: "No attachment files restored",
            description:
              "Could not write attachment files to this device. Restore stopped so ledger data is not wiped without files. Check storage space, then decrypt and restore again with “With attachments”.",
            duration: 12_000,
          });
          setIsRestoring(false);
          setRestoreProgress(null);
          return;
        } else if (expectedFiles > 0 && restoredFiles < expectedFiles) {
          toast({
            title: "Some attachments skipped",
            description: `${restoredFiles} of ${expectedFiles} file(s) restored to this device.`,
            duration: 10_000,
          });
        }
      }

      let cloudStorageFolderCleared = false;
      if (
        replaceCurrent &&
        cloudRestore &&
        !pbRestore &&
        restoreAttachments &&
        backupDataHasAttachmentBundle(backupData)
      ) {
        report.tick("Preparing", "Clearing old cloud attachment files…");
        try {
          await wipeCompanyFirebaseStorageForRestore({
            companyId: targetCompanyId,
            companyName:
              resolvedCompanyName.trim() ||
              String(backupCompanyDetails.name ?? company?.name ?? ""),
          });
          cloudStorageFolderCleared = true;
        } catch (e) {
          console.warn("[BackupRestore] cloud storage wipe before replace skipped:", e);
        }
      }

      if (replaceCurrent) {
        report.tick("Preparing", "Clearing current company data on this device…");
        await deleteAllCompanyDocsForCompany(targetCompanyId);
      }

      if (!cloudRestore) {
        const remoteBefore = countRemoteAttachmentRefsInBackupData(backupData);
        dataToWrite = prepareBackupDataForLocalCompanyRestore(backupData, attachmentRefMap);
        const remoteAfter = countRemoteAttachmentRefsInBackupData(dataToWrite);
        if (restoreAttachments && remoteAfter > 0) {
          toast({
            variant: "destructive",
            title: "Some attachment links removed",
            description: `${remoteAfter} file link(s) could not be restored as local files — removed so this company stays offline-only.`,
            duration: 10_000,
          });
        } else if (!restoreAttachments && remoteBefore > 0) {
          toast({
            title: "Data-only local restore",
            description: `${remoteBefore} online file link(s) were removed — local company does not use Firebase URLs. Re-backup with “With attachments” to keep files on device.`,
            duration: 12_000,
          });
        }
      } else if (attachmentRefMap) {
        dataToWrite = applyAttachmentRefMapToBackupData(backupData, attachmentRefMap);
      }

      const safeTimestamp = (val: any): Timestamp | null => {
        // Restore dates can come from Firestore JSON, local SQLite JSON, or old ISO backups; normalize all before writing.
        const date = parseFirestoreDateFieldToJsDate(val);
        return date ? Timestamp.fromDate(date) : null;
      };

      const backupCompanyIdFromFile = String(backupData.companyDetails?.[0]?.id ?? "").trim();
      const pbRestoreDocs: Array<{ coll: string; id: string; data: Record<string, unknown> }> = [];

      for (const colName of collectionsToBackup) {
        report.throwIfAborted();
        const docsToRestore = dataToWrite[colName] || [];
        for (const docData of docsToRestore) {
          report.throwIfAborted();
          const { id: originalId, ...data } = docData;
          const rewritten = rewriteBackupCompanyIdsDeep(backupCompanyIdFromFile, targetCompanyId, data) as Record<string, unknown>;
          const rw = rewritten as { isDeleted?: boolean; date?: unknown; dueDate?: unknown; due_date?: unknown; openingBalanceDate?: unknown; createdAt?: unknown; amount?: unknown; total?: number };
          const ledgerRow = !cloudRestore ? stripOnlineFieldsFromBackupLedgerDoc(rw) : rw;
          const finalData: Record<string, unknown> = {
            ...ledgerRow,
            companyId: targetCompanyId,
            isDeleted: rw.isDeleted ?? false,
            date: safeTimestamp(rw.date),
            openingBalanceDate: safeTimestamp(rw.openingBalanceDate),
            createdAt: safeTimestamp(rw.createdAt) || Timestamp.now(),
            amount: rw.amount === "" || rw.amount === null || rw.amount === undefined ? rw.total || 0 : Number(rw.amount),
          };
          // Sale/Purchase overdue depends on dueDate; keep restored voucher backups selectable and visible in overdue list.
          if (colName === "vouchers") finalData.dueDate = safeTimestamp(rw.dueDate ?? rw.due_date);
          await upsertCompanyDocInBrowserDb(targetCompanyId, colName, originalId, finalData as Record<string, unknown>, {
            notify: false,
            force: true,
          });
          if (pbRestore) pbRestoreDocs.push({ coll: colName, id: String(originalId), data: finalData });
          report.tick("Writing records", colName.replace(/_/g, " "));
        }
        notifyBrowserDbCollectionUpdated(targetCompanyId, colName);
      }

      const { scheduleSystemOpeningBalanceReconcile } = await import(
        "@/lib/reports/systemOpeningBalanceEquityClient"
      );
      scheduleSystemOpeningBalanceReconcile(targetCompanyId);

      const existing = await getLocalCompanyById(targetCompanyId, { includeDeleted: true });
      const restoredCompanyDetails = (dataToWrite.companyDetails || backupData.companyDetails) as Array<Record<string, unknown>>;
      const { id: _bid, ownerId: _boid, ownerEmail: _boe, ...restDetails } = restoredCompanyDetails[0];
      const rest = restDetails as Record<string, unknown>;
      const fyStart = fiscalFieldToLocalIso(rest.fiscalYearStart);
      const fyEnd = fiscalFieldToLocalIso(rest.fiscalYearEnd);
      const { fiscalYearStart: _rfs, fiscalYearEnd: _rfe, ...restNoFiscal } = rest;
      const {
        authoritativeCompanyId: _dropAuthFromBackup,
        storageOption: _dropSoFromBackup,
        syncedFromCloud: _dropSfcFromBackup,
        syncPolicy: _dropSpFromBackup,
        ...restNoFiscalLocalSafe
      } = restNoFiscal as Record<string, unknown>;

      const companyRowBase = {
        ...(existing || existingBeforeReplace || {}),
        ...restNoFiscalLocalSafe,
        fiscalYearStart: fyStart ?? fiscalFieldToLocalIso((existing as { fiscalYearStart?: unknown })?.fiscalYearStart),
        fiscalYearEnd: fyEnd ?? fiscalFieldToLocalIso((existing as { fiscalYearEnd?: unknown })?.fiscalYearEnd),
        localCompanyUsers:
          (rest as { localCompanyUsers?: unknown }).localCompanyUsers ??
          (existing as { localCompanyUsers?: unknown })?.localCompanyUsers,
        updatedAt: Date.now(),
        name:
          resolvedCompanyName.trim() ||
          String((restNoFiscalLocalSafe as { name?: string }).name ?? (existing as { name?: string })?.name ?? ""),
      };
      const resolvedCompanyLabel =
        resolvedCompanyName.trim() ||
        String((restNoFiscalLocalSafe as { name?: string }).name ?? "");

      if (cloudRestore) {
        report.tick("Finalizing", "Promoting to online company…");
        await promoteLocalCompanyRowToOnline(targetCompanyId, {
          ...companyRowBase,
          ownerId: user.uid,
          ownerEmail: user.email ?? null,
          syncedFromCloud: true,
          ...pocketLedgerStorageDocFields(targetCompanyId),
          ...(pbRestore
            ? {
                onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
                onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
              }
            : {}),
        } as Parameters<typeof promoteLocalCompanyRowToOnline>[1]);
      } else {
        const localCompanyRow = finalizeLocalCompanyRowAfterBackupRestore(companyRowBase, {
          companyId: targetCompanyId,
          ownerUid: user.uid,
          ownerEmail: user.email ?? null,
          companyName: resolvedCompanyLabel,
        });
        report.tick("Finalizing", "Saving company row…");
        await upsertLocalCompany(localCompanyRow as Parameters<typeof upsertLocalCompany>[0]);
      }
      report.tick("Finalizing", "Flushing local database…");
      await flushBrowserDbToIndexedDB();
      let pbUploadResult: { uploaded: number; removed: number; attachments: number } | null = null;
      if (pbRestore) {
        // Pocket Ledger Server: create the company there and upload every restored record (awaited).
        const ownerEmail = String(user.email ?? "").trim();
        const sharedWithEmails = ensureSuperAdminInSharedEmails(
          ownerEmail ? [ownerEmail] : [],
          customUser?.email,
          customUser?.role === "SuperAdmin"
        );
        const toTs = (iso: unknown) => {
          const d = typeof iso === "string" && iso ? new Date(iso) : null;
          return d && !Number.isNaN(d.getTime()) ? Timestamp.fromDate(d) : null;
        };
        const rootFromBackup: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(restNoFiscalLocalSafe)) {
          if (v !== undefined && k !== "localCompanyUsers") rootFromBackup[k] = v;
        }
        const pbRootDoc: Record<string, unknown> = {
          ...rootFromBackup,
          name: resolvedCompanyLabel || String(rootFromBackup.name ?? targetCompanyId),
          fiscalYearStart: toTs(companyRowBase.fiscalYearStart),
          fiscalYearEnd: toTs(companyRowBase.fiscalYearEnd),
          storageOption: "firebase",
          syncPolicy: "online",
          onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
          onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
          ownerId: user.uid,
          ownerEmail: ownerEmail || null,
          ...pocketLedgerStorageDocFields(targetCompanyId),
          sharedWith: [],
          sharedWithEmails,
          sharedWithEmailsLower: sharedWithEmailsLowerFromList(sharedWithEmails),
          planId: accountPlanId ?? rootFromBackup.planId ?? null,
          planOwnerUid: user.uid,
          isDeleted: false,
          createdAt: Timestamp.now(),
        };
        if (!pbServerSession && !replaceCurrent) {
          // Firebase login: the company root is also listed in Firestore (same as Create company).
          void setDoc(doc(firestore, "companies", targetCompanyId), pbRootDoc).catch((e) =>
            console.warn("[BackupRestore] Firestore company root for server restore skipped:", e)
          );
        }
        report.tick("Uploading to Pocket Ledger Server", "Creating company.");
        const { uploadRestoredCompanyToPocketBase } = await import("@/lib/pocketbaseData/pbRestoreUpload");
        pbUploadResult = await uploadRestoredCompanyToPocketBase({
          companyId: targetCompanyId,
          rootDoc: pbRootDoc,
          docs: pbRestoreDocs,
          replaceCurrent,
          onProgress: (label, detail) => report.tick(label, detail, 0),
        });
      }
      if (isFyScopedBackupData(backupData)) {
        // FY-scoped backup: openings changed vs any cached FY snapshot -> invalidate + notify ledgers.
        const { finalizeFyScopedBackupRestore } = await import("@/lib/backupFyScopeRestoreFinalize");
        await finalizeFyScopedBackupRestore({ companyId: targetCompanyId, cloudLinked: cloudRestore });
      }
      reloadLocalCompanyRegistry();
      triggerSync();

      endLocalAttachmentRestoreHold(targetCompanyId);

      if (restoreAttachments && backupDataHasAttachmentBundle(backupData) && !staticBackupClient) {
        void incrementAttachmentRestoreUsage(user.uid);
      }

      setCompanyId(targetCompanyId);
      if (!cloudRestore) {
        grantOpenLocalCompanySession(targetCompanyId, { role: "owner" });
        markLocalBackupRestoreSelectionGrace(targetCompanyId);
      }

      // Device restore done — dialog band, UI responsive (cloud upload background me).
      setIsRestoring(false);
      setRestoreProgress(null);
      setRestoreProgressDialogOpen(false);
      restoreAbortRef.current = null;

      if (pbRestore) {
        const files = pbUploadResult?.attachments ?? 0;
        toast({
          title: "Restored on Pocket Ledger Server",
          description: `Company "${resolvedCompanyLabel || company?.name || targetCompanyId}" is on the Pocket Ledger Server: ${
            pbUploadResult?.uploaded ?? 0
          } record(s)${files ? `, ${files} file(s)` : ""}. Opening dashboard.`,
        });
        setFileToRestore(null);
        window.setTimeout(() => window.location.assign("/dashboard"), 0);
        return;
      }

      if (cloudRestore) {
        toast({
          title: "Restore Successful",
          description: replaceCurrent
            ? `Company "${resolvedCompanyLabel || company?.name}" restored on this device. Cloud sync continues in the header bar.`
            : `New online company "${resolvedCompanyLabel || targetCompanyId}" restored on this device. Cloud sync continues in the header bar.`,
        });
        startRestoreCloudBackgroundSync({
          companyId: targetCompanyId,
          ownerUid: user.uid,
          ownerEmail: user.email ?? "",
          companyName: resolvedCompanyLabel || company?.name || targetCompanyId,
          replaceCurrent,
          restoreWithAttachments: restoreAttachments && backupDataHasAttachmentBundle(backupData),
          storageFolderCleared: cloudStorageFolderCleared,
        });
        setFileToRestore(null);
        window.setTimeout(() => window.location.assign("/dashboard"), 0);
        return;
      }

      toast({
        title: "Restore Successful",
        description: replaceCurrent
          ? `Company "${resolvedCompanyLabel || company?.name}" data replaced on this device only. Opening dashboard…`
          : `New local company created (${targetCompanyId}). Your other companies are unchanged. Opening dashboard…`,
      });
      setFileToRestore(null);
      window.location.assign("/dashboard");
    } catch (error: any) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast({ title: "Restore cancelled", description: "File box me hai — Restore dobara chala sakte ho." });
      } else {
        console.error("Local restore failed:", error);
        toast({
          variant: "destructive",
          title: "Restore Failed",
          description: error.message || "An error occurred during local restore.",
        });
      }
    } finally {
      if (restoreHoldCompanyId) endLocalAttachmentRestoreHold(restoreHoldCompanyId);
      setIsRestoring(false);
      restoreAbortRef.current = null;
      restoreZipFilesRef.current = null;
      setRestoreZipFilesByPath(null);
      setRestoreProgress(null);
      // Cancel/error par file box me rakho taaki Restore button enabled rahe (success path upar file clear karta hai).
    }
  };

  const handleOverwriteRestore = async (
    backupData: any,
    resolvedCompanyName: string,
    restoreAttachments: boolean,
    restoreTargetMode: RestoreTargetMode
  ) => {
    if (!companyId || !user?.uid || !backupData) return;

    const backupCompanyDetails = backupData?.companyDetails?.[0];
    if (!backupCompanyDetails) {
        toast({ variant: "destructive", title: "Invalid Backup", description: "Backup file is missing company details." });
        return;
    }

    const backupCompanyId = backupCompanyDetails.id;
    const backupOwnerId = backupCompanyDetails.ownerId;
    const backupOwnerEmail = backupCompanyDetails.ownerEmail;

    const canRestore = canUserRestoreBackup({
      userUid: user.uid,
      userEmail: user.email,
      backupCompanyDetails,
    });

    if (!canRestore) {
        toast({
            variant: "destructive",
            title: "Restore Blocked",
            description: backupOwnerEmail
              ? `This backup belongs to ${backupOwnerEmail}. Illegal restore attempt recorded.`
              : "This backup belongs to another owner. Illegal restore attempt recorded.",
            duration: 8000,
        });

        try {
          const notified = await sendSecurityAlertClient({
            backupOwnerId,
            backupOwnerEmail,
            backupSharedWith: backupCompanyDetails?.sharedWith || [],
            attemptedByUid: user.uid,
            attemptedByEmail: user.email ?? "",
            attemptedByName: (customUser?.displayName || user?.displayName) ?? undefined,
            companyName: backupCompanyDetails.name,
            companyId: backupCompanyId,
          });
          if (!notified) {
            toast({
              variant: "destructive",
              title: "Owner Notification Failed",
              description: "Attempt was blocked, but we could not resolve the original company admin to notify.",
              duration: 7000,
            });
          }
        } catch (e) {
          console.error("Failed to send restore security alert:", e);
          toast({
            variant: "destructive",
            title: "Owner Notification Failed",
            description: "Attempt was blocked, but sending warning notification failed.",
            duration: 7000,
          });
        }

        setIsOverwriteConfirmOpen(false);
        setFileToRestore(null);
        return;
    }
    
    const userDocRef = doc(firestore, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        const surrenderedCompanies = userData.surrenderedCompanies || {};
        const surrenderedInfo = surrenderedCompanies[backupCompanyId];

        if (surrenderedInfo) {
            const formattedDate = new Date(surrenderedInfo.date.seconds * 1000).toLocaleDateString();
            toast({
                variant: "destructive",
                title: "Restore Blocked",
                description: `You surrendered this company to "${surrenderedInfo.surrenderedTo}" on ${formattedDate}. You cannot restore it.`,
                duration: 10000,
            });
            setIsOverwriteConfirmOpen(false);
            setFileToRestore(null);
            return;
        }
    }

    const replaceCurrent = restoreTargetMode === "replace_current";

    setIsRestoring(true);
    setIsOverwriteConfirmOpen(false);

    try {
        const { signal, report } = beginRestoreProgress(backupData, restoreAttachments);
        const targetCompanyId = replaceCurrent
          ? String(companyId || "").trim()
          : generateCompanyId(
              resolvedCompanyName.trim() || String(backupCompanyDetails.name ?? "company")
            );
        if (!targetCompanyId) {
          toast({ variant: "destructive", title: "Restore Failed", description: "No company selected to restore into." });
          return;
        }

        if (replaceCurrent) {
          report.tick("Preparing", "Clearing current company data in cloud…");
          await clearFirestoreCompanySubcollectionsForRestore(targetCompanyId);
          try {
            report.tick("Preparing", "Clearing local mirror on this device…");
            await deleteAllCompanyDocsForCompany(targetCompanyId);
          } catch (e) {
            console.warn("[BackupRestore] local clear before cloud replace skipped:", e);
          }
        }

        const backupCompanyIdFromFile = String(backupData.companyDetails?.[0]?.id ?? "").trim();

        let dataToWrite = backupData;
        const zipFilesForRestore = resolveRestoreZipFiles(restoreZipFilesByPath, restoreZipFilesRef.current);
        if (restoreAttachments && backupDataHasAttachmentBundle(backupData)) {
          if (!staticBackupClient) {
            const gate = await checkAttachmentRestoreAllowed(user.uid, accountPlanId);
            if (!gate.allowed) {
              toast({ variant: "destructive", title: "Attachment restore blocked", description: gate.message });
              setIsRestoring(false);
              setRestoreProgress(null);
              return;
            }
          }
          const map = await restoreAttachmentsFromBackupData(
            backupData,
            zipFilesForRestore,
            targetCompanyId,
            (_done, _total, bytes) => report.tick("Restoring attachments", "", 1, bytes),
            signal
          );
          await flushPendingBrowserDbSave();
          dataToWrite = applyAttachmentRefMapToBackupData(backupData, map);
          if (replaceCurrent) {
            report.tick("Preparing", "Clearing old cloud attachment files…");
            try {
              await wipeCompanyFirebaseStorageForRestore({
                companyId: targetCompanyId,
                companyName: resolvedCompanyName.trim() || company?.name || "",
              });
            } catch (e) {
              console.warn("[BackupRestore] cloud storage wipe before replace skipped:", e);
            }
          }
        }

        let batch = writeBatch(firestore);
        const safeTimestamp = (val: any): Timestamp | null => {
            const date = parseFirestoreDateFieldToJsDate(val);
            return date ? Timestamp.fromDate(date) : null;
        };
        
        let count = 0;
        const shouldUploadAttachmentsToCloud =
          restoreAttachments && backupDataHasAttachmentBundle(backupData);
        for (const colName of collectionsToBackup) {
            report.throwIfAborted();
            const docsToRestore = dataToWrite[colName] || [];
            for (const docData of docsToRestore) {
                report.throwIfAborted();
                const { id: originalId, ...data } = docData;
                let rewritten = rewriteBackupCompanyIdsDeep(
                  backupCompanyIdFromFile,
                  targetCompanyId,
                  data
                ) as Record<string, unknown>;
                if (shouldUploadAttachmentsToCloud) {
                  report.tick("Uploading attachments", `${colName.replace(/_/g, " ")}…`);
                  try {
                    rewritten = await hydrateRestoredFieldsForCloudUpload(
                      targetCompanyId,
                      colName,
                      rewritten
                    );
                  } catch (e) {
                    console.warn("[BackupRestore] cloud attachment upload skipped for doc", originalId, e);
                  }
                }
                const rw = rewritten as {
                  isDeleted?: boolean;
                  date?: unknown;
                  dueDate?: unknown;
                  due_date?: unknown;
                  openingBalanceDate?: unknown;
                  createdAt?: unknown;
                  amount?: unknown;
                  total?: number;
                };
                const finalData: Record<string, unknown> = {
                    ...rewritten,
                    companyId: targetCompanyId,
                    isDeleted: rw.isDeleted ?? false,
                    date: safeTimestamp(rw.date),
                    openingBalanceDate: safeTimestamp(rw.openingBalanceDate),
                    createdAt: safeTimestamp(rw.createdAt) || serverTimestamp(),
                    amount:
                      rw.amount === "" || rw.amount === null || rw.amount === undefined
                        ? rw.total || 0
                        : Number(rw.amount),
                };
                if (colName === "vouchers") finalData.dueDate = safeTimestamp(rw.dueDate ?? rw.due_date);

                const docRef = doc(firestore, `companies/${targetCompanyId}/${colName}`, originalId);
                batch.set(docRef, finalData);
                
                count++;
                report.tick("Writing records", colName.replace(/_/g, " "));
                if (count >= 450) { 
                    report.tick("Writing records", "Uploading batch to cloud…", 0, 0);
                    await batch.commit();
                    batch = writeBatch(firestore);
                    count = 0;
                }
            }
        }

        if (dataToWrite.companyDetails?.[0]) {
            const {
              id: _bid,
              ownerId: _oid,
              ownerEmail: _oem,
              authoritativeCompanyId: _oldAuth,
              ...details
            } = dataToWrite.companyDetails[0];
            const finalName =
              resolvedCompanyName.trim() || String((details as { name?: string }).name ?? "");
            const detailsRewritten = rewriteBackupCompanyIdsDeep(
              backupCompanyIdFromFile,
              targetCompanyId,
              details
            ) as Record<string, unknown>;
            let companyRootFields = detailsRewritten;
            if (shouldUploadAttachmentsToCloud) {
              report.tick("Uploading attachments", "Company profile files…");
              try {
                companyRootFields = await hydratePendingLocalFileRefsDeep(targetCompanyId, detailsRewritten);
              } catch (e) {
                console.warn("[BackupRestore] company root attachment upload skipped", e);
              }
            }
            batch.set(doc(firestore, "companies", targetCompanyId), {
              ...companyRootFields,
              name: finalName,
              ownerId: user.uid,
              ownerEmail: user.email ?? "",
              authoritativeCompanyId: targetCompanyId,
            }, { merge: replaceCurrent });
        }

        report.tick("Finalizing", "Saving to Firestore…");
        await batch.commit();

        if (restoreAttachments && backupDataHasAttachmentBundle(backupData) && !staticBackupClient) {
          await incrementAttachmentRestoreUsage(user.uid);
        }

        report.tick("Finalizing", "Refreshing local registry…");
        reloadLocalCompanyRegistry();
        triggerSync();

        report.tick("Complete", "Opening dashboard…");
        setCompanyId(targetCompanyId);
        toast({
          title: "Restore Successful",
          description: replaceCurrent
            ? `Company "${resolvedCompanyName.trim() || company?.name}" data replaced in cloud. Opening dashboard.`
            : `New cloud company ${targetCompanyId}. Opening dashboard.`,
        });
        // Success: box se file hatao + dashboard par redirect.
        setFileToRestore(null);
        window.location.assign("/dashboard");
    } catch (error: any) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast({ title: "Restore cancelled", description: "File box me hai — Restore dobara chala sakte ho." });
      } else {
        console.error("Restore failed:", error);
        toast({
          variant: "destructive",
          title: "Restore Failed",
          description: error.message || "An error occurred during the overwrite process.",
        });
      }
    } finally {
      setIsRestoring(false);
      restoreAbortRef.current = null;
      restoreZipFilesRef.current = null;
      setRestoreZipFilesByPath(null);
      setRestoreProgress(null);
      // Cancel/error par file box me rakho — Restore button enabled rahe (success path file clear karta hai).
    }
  };

  const restoreConfirmationName = String(
    company?.name || backupDataToRestore?.companyDetails?.[0]?.name || "restore"
  ).trim();

  return (
    <>
      <div className="flex min-w-0 flex-col gap-8" data-pl-backup-restore>
        {/* PC: left = Backup→Restore (gap na rahe), right = Auto→Data save.
            Mobile: Backup → Auto → Restore → Data (order 1–4). */}
        <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2 md:items-start md:gap-6">
        <div className="contents md:flex md:min-w-0 md:flex-col md:gap-8">
        <Card className={cn("order-1 flex min-w-0 flex-col overflow-hidden", backupCardToneGreenCn)}>
          <CardHeader className="pb-3">
            {/* Title + Create Backup — chhoti screen par actions neeche wrap. */}
            <div className={backupCardHeaderLayoutCn}>
              <div className="flex min-w-0 items-center gap-1.5">
                <CardTitle className="text-base">Backup Data</CardTitle>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        aria-label="Backup data information"
                      >
                        <Info className="h-4 w-4" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[20rem] text-xs leading-snug">
                      Download a complete backup of your company&apos;s data. You can choose to encrypt it for security.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className={backupCardHeaderActionsCn}>
                <PermissionButton
                  permission="export_data"
                  variant="outline"
                  size="sm"
                  onClick={handleBackupClick}
                  disabled={isBackingUp}
                  className={backupCardActionBtnCn}
                >
                  {isBackingUp ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Create Backup
                </PermissionButton>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openBackupLocationDialog}
                  className={backupCardActionBtnCn}
                >
                  Backup location
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3 text-sm text-muted-foreground">
            {(() => {
              const localDeviceEmbed =
                staticBackupClient ||
                backupIntent === "for_offline" ||
                backupSourceMode === "local_only" ||
                isLocalCompanyBackup;
              if (localDeviceEmbed) return null;
              const gate = getOnlineCompanyBackupTickGate(company, {
                attachmentEmbedMode: "may_download",
              });
              if (!(backupIncludeAttachments && gate.needFilesTick)) return null;
              return (
                <p className="rounded-md border border-amber-300/80 bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-900">
                  {gate.filesMessage}
                </p>
              );
            })()}
            <div className={cn(backupCardSoftGreenBorderCn, "p-2.5")}>
              <BackupLocationField
                locationLabel={backupLocationLabel}
                pathPreview={webFolderDisplayPath}
                hint={backupLocationHint}
                onChooseLocation={openBackupLocationDialog}
                showButton={false}
              />
            </div>
            <div className={cn(backupCardSoftGreenBorderCn, "space-y-2 p-3")}>
                <p className="text-sm text-foreground font-medium">Pre-download</p>
                <p className="text-xs leading-relaxed">
                  {staticBackupClient
                    ? "Download full company data into local SQLite and cache attachment files on this device before backup with attachments."
                    : "Download company data into local SQLite on this device. Attachments pre-download is only available on EXE / APK app."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={predownloadRunning || isBackingUp || !companyId}
                  onClick={() => void handlePredownloadForBackup(staticBackupClient)}
                  className="w-auto"
                >
                  {predownloadRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Pre-download data{" "}
                  <span className={staticBackupClient ? "" : "text-muted-foreground/50"}>
                    &amp; attachments
                  </span>
                </Button>
              </div>
            {isBackingUp ? null : backupRun.status === "interrupted" ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Previous backup was interrupted by refresh or close. Start again and keep this page open until complete.
              </p>
            ) : null}
          </CardContent>
          {(isBackingUp || predownloadRunning) && (backupProgress || predownloadProgress) ? (
          <CardFooter className="flex flex-col items-stretch gap-3 pt-0">
            <BackupProgressStrip
              progress={
                isBackingUp && backupProgress
                  ? backupProgress
                  : predownloadProgress
                    ? {
                        phase: predownloadProgress.phase,
                        detail: predownloadProgress.detail,
                        done: predownloadProgress.percent,
                        total: 100,
                      }
                    : backupProgress!
              }
              spinning={isBackingUp || predownloadRunning}
              inCard
              showRefreshWarning={isBackingUp || predownloadRunning}
              showCancel={isBackingUp || predownloadRunning}
              onCancel={() => {
                if (isBackingUp && cancelCompanyBackupRun()) {
                  toast({ title: "Backup cancelled", description: "You can start a new backup when ready." });
                } else if (predownloadRunning) {
                  cancelPredownload();
                  setPredownloadRunning(false);
                  setPredownloadProgress(null);
                  toast({ title: "Pre-download cancelled" });
                }
              }}
            />
          </CardFooter>
          ) : null}
        </Card>

        <Card className={cn("order-3 flex min-w-0 flex-col overflow-hidden", backupCardToneGreenCn)}>
          <CardHeader>
            <CardTitle>Restore Data</CardTitle>
            <CardDescription>
              Restore from a JSON or encrypted .plbp file (legacy .webtally supported). Each restore creates a new company id so
              nothing merges into an existing slot by mistake.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-2">
            {nativeRuntime ? (
              <>
                {/* Native APK: dedicated picker se restore file selection stable rahe. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePickRestoreFileNative}
                  className={backupCardActionBtnCn}
                >
                  Choose backup file
                </Button>
                <p className="text-xs text-muted-foreground break-all">
                  Selected file: <span className="font-medium text-foreground">{fileToRestore?.name || "Not selected"}</span>
                </p>
              </>
            ) : (
              <Input
                type="file"
                accept=".json,.plbp,.webtally"
                onChange={handleFileSelect}
                className="pl-backup-control-emerald max-w-full !border-emerald-500 !border-2"
                style={{ borderColor: "rgb(16 185 129 / 0.85)", borderWidth: "2px", borderStyle: "solid" }}
              />
            )}
          </CardContent>
          <CardFooter className="flex min-w-0 flex-col items-end gap-3 pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={startRestore}
              disabled={!fileToRestore || isRestoring}
              className="w-auto"
            >
              {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Restore as new company
            </Button>
            {/* Restore live progress — backup card jaisa pill bar + cancel. */}
            {isRestoring && restoreProgress ? (
              <BackupProgressStrip
                progress={restoreProgress}
                spinning
                inCard
                showRefreshWarning
                refreshWarningText="Device restore in progress — you can close this dialog; online sync continues in the header bar after device restore completes."
                showCancel
                onCancel={() => {
                  cancelRestoreRun();
                }}
              />
            ) : null}
          </CardFooter>
        </Card>
        </div>

        <div className="contents md:flex md:min-w-0 md:flex-col md:gap-8">
        <Card className={cn("order-2 flex min-w-0 flex-col overflow-hidden md:h-auto", backupCardToneSkyCn)}>
          <CardContent className="min-w-0 flex-1 space-y-4 py-4 text-sm">
            <div className={cn(backupCardSoftSkyBorderCn, "space-y-1.5 p-2.5")}>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-base font-semibold leading-none">Auto Backup</span>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        aria-label="Auto backup information"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
                      Tick companies below. At the chosen time, each selected company is backed up to your saved
                      location as Company / Year / MonthName / Day. Month names follow Date system (AD: July, BS:
                      Shrawan). File name uses the same calendar with full month name.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className={cn(backupCardPillCn, "ml-1 h-auto min-h-8 w-auto shrink-0 gap-1.5 px-2.5 py-1")}>
                  <span className="shrink-0 text-xs font-medium leading-none">Date system</span>
                  <div className="flex gap-1" role="group" aria-label="Backup folder date system">
                    {(["AD", "BS"] as const).map((ds) => (
                      <button
                        key={ds}
                        type="button"
                        onClick={() => updateAutoBackupDraft({ ...autoBackupDraft, folderDateSystem: ds })}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold leading-none transition-colors",
                          autoBackupDraft.folderDateSystem === ds
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-background/60 text-muted-foreground hover:bg-background hover:text-foreground"
                        )}
                      >
                        {ds}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="min-w-0 flex-1 text-sm leading-snug text-muted-foreground">
                  Backup location:{" "}
                  <span className="font-medium break-all text-foreground">{backupLocationLabel}</span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openBackupLocationDialog}
                  className="h-8 shrink-0 px-3 sm:w-auto"
                >
                  Backup location
                </Button>
              </div>
              {backupLocationHint ? (
                <p className="text-xs leading-snug text-muted-foreground">{backupLocationHint}</p>
              ) : null}
              {autoBackupPathPreview ? (
                <p className="text-xs leading-snug text-muted-foreground">
                  Auto backup path:{" "}
                  <span className="font-medium break-all text-foreground">{autoBackupPathPreview}</span>
                </p>
              ) : null}
            </div>
            <div className="min-w-0 space-y-4">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <select
                    id="auto-backup-schedule-mode"
                    className={cn(
                      backupCardPillCn,
                      "pl-backup-control-sky h-9 min-h-9 min-w-0 flex-1 cursor-pointer appearance-none py-0 outline-none focus:ring-0 sm:max-w-[10rem]"
                    )}
                    value={autoBackupDraft.scheduleMode}
                    disabled={!autoBackupDraft.enabled}
                    onChange={(e) => {
                      const scheduleMode = e.target.value as AutoBackupScheduleMode;
                      updateAutoBackupDraft({
                        ...autoBackupDraft,
                        scheduleMode,
                        frequency: autoBackupDraft.enabled ? scheduleModeToFrequency(scheduleMode) : autoBackupDraft.frequency,
                        weekdays:
                          scheduleMode === "weekly"
                            ? [autoBackupDraft.weekdays[0] ?? autoBackupDraft.weekdays.find(Boolean) ?? 1]
                            : scheduleMode === "daily"
                              ? []
                              : autoBackupDraft.weekdays.length
                                ? autoBackupDraft.weekdays
                                : [1],
                      });
                    }}
                    aria-label="Auto backup schedule"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Choose days</option>
                  </select>
                  <div className={cn(backupCardPillCn, "h-9 min-h-9 w-auto shrink-0 gap-2 px-3 py-0")}>
                    <Label htmlFor="auto-backup-time" className="shrink-0 text-sm font-medium leading-none">
                      Time
                    </Label>
                    <Input
                      id="auto-backup-time"
                      type="time"
                      value={autoBackupDraft.runTimeLocal}
                      disabled={!autoBackupDraft.enabled}
                      onChange={(e) =>
                        updateAutoBackupDraft({ ...autoBackupDraft, runTimeLocal: e.target.value || "02:00" })
                      }
                      className="h-7 w-[8rem] min-w-[8rem] shrink-0 border-0 bg-transparent p-0 text-sm leading-none shadow-none focus-visible:ring-0 [&::-webkit-calendar-picker-indicator]:ml-1 [&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:w-4 [&::-webkit-datetime-edit-ampm-field]:border-0 [&::-webkit-datetime-edit-hour-field]:border-0 [&::-webkit-datetime-edit-minute-field]:border-0 [&::-webkit-datetime-edit-text]:border-0 [&::-webkit-datetime-edit-fields-wrapper]:border-0 [&::-webkit-datetime-edit]:border-0"
                    />
                  </div>
                  <div className={cn(backupCardPillCn, "h-9 min-h-9 min-w-0 shrink-0 gap-2 py-0 sm:flex-none sm:ml-auto")}>
                    <Label
                      htmlFor="auto-backup-enabled"
                      className="cursor-pointer text-sm font-medium leading-snug"
                    >
                      Enable auto backup
                    </Label>
                    <Switch
                      id="auto-backup-enabled"
                      checked={autoBackupDraft.enabled}
                      onCheckedChange={(checked) => {
                        if (!tryEnableAutoBackup(checked)) return;
                        const frequency: AutoBackupFrequency = checked
                          ? scheduleModeToFrequency(autoBackupDraft.scheduleMode)
                          : "off";
                        updateAutoBackupDraft({
                          ...autoBackupDraft,
                          enabled: checked,
                          frequency,
                        });
                      }}
                    />
                  </div>
                </div>
                {shouldShowAutoBackupWeekdayPicker(autoBackupDraft) ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                      const checked = isAutoBackupWeekdayChecked(autoBackupDraft, day);
                      const inputId = `auto-backup-day-${day}`;
                      return (
                        <div key={day} className="flex items-center gap-1.5">
                          <Checkbox
                            id={inputId}
                            checked={checked}
                            disabled={!autoBackupDraft.enabled}
                            className="pl-backup-checkbox-sky"
                            onCheckedChange={(v) => {
                              updateAutoBackupDraft(
                                toggleAutoBackupWeekday(autoBackupDraft, day, v === true)
                              );
                            }}
                          />
                          <Label htmlFor={inputId} className="cursor-pointer text-sm font-normal leading-none">
                            {autoBackupWeekdayLabel(day)}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
            </div>
            {staticBackupClient ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={cn(backupCardPillCn, "w-full min-w-0 justify-between gap-2 sm:w-auto sm:justify-center")}>
                      <Label
                        htmlFor="auto-backup-include-attachments"
                        className="cursor-pointer text-sm font-medium leading-snug"
                      >
                        Include attachments
                      </Label>
                      <Switch
                        id="auto-backup-include-attachments"
                        checked={autoBackupDraft.includeAttachments}
                        disabled={!autoBackupDraft.enabled || !attachmentFeatureOn}
                        onCheckedChange={(checked) => {
                          updateAutoBackupDraft({ ...autoBackupDraft, includeAttachments: checked });
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[16rem] text-xs leading-snug">
                    Uses plan quota; larger backup files. {!attachmentFeatureOn ? "Not included on your plan." : null}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            <div className={cn(backupCardSoftSkyBorderCn, "space-y-2 p-3")}>
              <p className="text-xs font-medium text-muted-foreground">Companies for auto backup</p>
              {autoBackupCompanyRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No companies found on this device.
                </p>
              ) : (
                <>
                  <div className="flex w-full gap-1.5" role="tablist" aria-label="Companies for auto backup">
                    {(
                      [
                        ["local", "Local", autoBackupCompanyBuckets.localTabCompanies.length],
                        ["server", "Server", autoBackupCompanyBuckets.serverTabCompanies.length],
                        ["online", "Online", autoBackupCompanyBuckets.onlineTabCompanies.length],
                      ] as const
                    ).map(([tab, label, count]) => (
                      <Button
                        key={tab}
                        type="button"
                        role="tab"
                        variant="outline"
                        size="sm"
                        aria-selected={autoBackupListTab === tab}
                        data-pl-auto-backup-tab="1"
                        data-pl-auto-backup-tab-active={autoBackupListTab === tab ? "true" : "false"}
                        className="h-8 flex-1 px-2.5 text-xs pl-backup-control-sky"
                        onClick={() => setAutoBackupListTab(tab)}
                      >
                        {label}
                        {count > 0 ? ` (${count})` : ""}
                      </Button>
                    ))}
                  </div>
                  {autoBackupTabCompanies.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No companies in this tab.
                    </p>
                  ) : (
                <Table scrollContainer className="max-h-44">
                  <TableHeader className="[&_tr]:border-b [&_tr]:border-sky-200/70">
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className="text-xs">Company</TableHead>
                      <TableHead className="hidden min-[400px]:table-cell w-[7.5rem] text-right text-xs">Action</TableHead>
                      <TableHead className="hidden min-[400px]:table-cell w-[5rem] text-center text-xs">Setting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {autoBackupTabCompanies.map((c) => {
                      const hasPassword = companyHasAutoBackupPassword(c);
                      const checked = autoBackupDraft.companyIds.includes(c.id);
                      return (
                        <TableRow key={c.id} className="border-b border-sky-200/60 hover:bg-sky-50/40">
                          <TableCell className="max-w-0 py-2">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <div className="flex min-w-0 items-center gap-2">
                                <Checkbox
                                  id={`auto-backup-co-${c.id}`}
                                  checked={checked}
                                  className="pl-backup-checkbox-sky shrink-0"
                                  onCheckedChange={(v) => toggleAutoBackupCompany(c.id, v === true)}
                                />
                                <Label
                                  htmlFor={`auto-backup-co-${c.id}`}
                                  className="min-w-0 truncate text-sm font-normal cursor-pointer"
                                >
                                  {c.name}
                                </Label>
                              </div>
                              {/* Mobile: password status below name */}
                              {hasPassword ? (
                                <span className="min-[400px]:hidden pl-6 text-xs font-medium text-sky-800">Password Protected</span>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-[400px]:hidden ml-6 h-7 w-fit px-2 text-xs pl-backup-control-sky"
                                  onClick={() => openAutoBackupEditCompanyDialog(c)}
                                >
                                  Add password
                                </Button>
                              )}
                              {/* Mobile: setting icon + info below */}
                              <div className="min-[400px]:hidden pl-6 flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 pl-backup-control-sky"
                                  aria-label={`Backup settings for ${c.name}`}
                                  onClick={() => openAutoBackupCompanySettings(c)}
                                >
                                  <Settings className="h-4 w-4" />
                                </Button>
                                {companyUsesOnlineSelectorSyncTicks(c) &&
                                !getOnlineCompanyBackupTickGate(c, {
                                  attachmentEmbedMode: "may_download",
                                }).filesAllowed ? (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                        aria-label="Files info"
                                      >
                                        <Info className="h-3.5 w-3.5" aria-hidden />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent side="top" align="start" className="max-w-[18rem] text-xs leading-snug p-3">
                                      Local-only can embed device files without Files tick. Tick Files only if Online merge must download missing attachments.
                                    </PopoverContent>
                                  </Popover>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden min-[400px]:table-cell py-2 text-right">
                            {hasPassword ? (
                              <span className="text-xs font-medium text-sky-800">Password Protected</span>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs pl-backup-control-sky"
                                onClick={() => openAutoBackupEditCompanyDialog(c)}
                              >
                                Add password
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="hidden min-[400px]:table-cell py-2 text-center">
                            <div className="flex items-center justify-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 pl-backup-control-sky"
                                aria-label={`Backup settings for ${c.name}`}
                                onClick={() => openAutoBackupCompanySettings(c)}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                              {companyUsesOnlineSelectorSyncTicks(c) &&
                              !getOnlineCompanyBackupTickGate(c, {
                                attachmentEmbedMode: "may_download",
                              }).filesAllowed ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                      aria-label="Files info"
                                    >
                                      <Info className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="top" align="end" className="max-w-[18rem] text-xs leading-snug p-3">
                                    Local-only can embed device files without Files tick. Tick Files only if Online merge must download missing attachments.
                                  </PopoverContent>
                                </Popover>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                  )}
                </>
              )}
            </div>
            {autoBackupPrefs.lastRunAt ? (
              <p className="text-xs text-muted-foreground">
                Last auto backup: {new Date(autoBackupPrefs.lastRunAt).toLocaleString()}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSaveAutoBackupSettings}
                  className={backupCardActionBtnCn}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDriveUploadDialogOpen(true)}
                  className={backupCardActionBtnCn}
                >
                  <Cloud className="mr-2 h-4 w-4" />
                  Drive upload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBackingUp}
                  onClick={() => void handleSaveAndAutoBackupNow()}
                  className={backupCardActionBtnCn}
                >
                  {isBackingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save and backup now
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBackingUp}
                  onClick={() => void handleAutoBackupNow()}
                  className={backupCardActionBtnCn}
                >
                  {isBackingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Backup now
                </Button>
            </div>
          </CardContent>
        </Card>

        <AutoBackupDriveUploadDialog
          open={driveUploadDialogOpen}
          onOpenChange={setDriveUploadDialogOpen}
          companies={driveUploadCompanies}
        />
        <AttachmentSqliteServerCompareDialog
          open={attachmentCompareOpen}
          onOpenChange={setAttachmentCompareOpen}
          company={company ?? null}
          companyId={companyId ?? null}
        />

        <Card className={cn("order-4 flex min-w-0 flex-col overflow-hidden", backupCardToneSkyCn)}>
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Folder className="h-5 w-5 shrink-0" />
              <span className="min-w-0">Data save location</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 flex-1 space-y-1 text-sm text-muted-foreground">
            <p className="break-words">
              Current:{" "}
              <span className="font-medium break-all text-foreground">
                {nativeRuntime
                  ? liveNativeFolderPath
                    ? formatNativeFolderDisplayPath(liveNativeFolderPath)
                    : "Not set"
                  : liveWebEnabled && liveWebLabel
                    ? liveWebLabel
                    : "Not set"}
              </span>
            </p>
            <p className="text-xs">Debounced sync also runs a few seconds after local saves when a location is active.</p>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLiveDataLocationDialogOpen(true)}
              className={backupCardActionBtnCn}
            >
              Select folder
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSyncLiveDataNow()}
              className={backupCardActionBtnCn}
            >
              Sync now
            </Button>
          </CardFooter>
        </Card>
        </div>
        </div>
      </div>

      <Dialog
        open={liveDataLocationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setLiveDataLocationDialogOpen(false);
            return;
          }
          setLiveDataLocationDialogOpen(true);
        }}
      >
        <DialogContent className="w-[calc(100%-4px)] max-w-md rounded-xl mx-[2px]" data-pl-backup-dialog="sky">
          <DialogHeader>
            <DialogTitle>Data save location</DialogTitle>
            <DialogDescription>
              Encrypted copies are saved under{" "}
              <code className="text-[10px]">
                {POCKET_LEDGER_MIRROR_DIR}/{COMPANIES_DIR_SEGMENT}/…
              </code>{" "}
              in the folder you choose. No password needed — this browser stores the encryption key on this device only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!nativeRuntime && supportsWebFolderPicker ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Selected folder: <span className="font-medium text-foreground">{liveWebLabel || "Not set"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void handlePickLiveDataWebFolder()}>
                    Browse folder
                  </Button>
                  <Button
                    type="button"
                    disabled={savingLiveDataLocation || !liveWebLabel}
                    onClick={() => void handleSaveLiveDataLocation()}
                  >
                    {savingLiveDataLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span className={savingLiveDataLocation ? "ml-2" : ""}>Save data location</span>
                  </Button>
                </div>
              </>
            ) : nativeRuntime ? (
              <>
                <Button type="button" variant="outline" onClick={() => void handlePickLiveDataNativeFolder()}>
                  Browse folder
                </Button>
                <div className="text-xs text-muted-foreground break-words">
                  Selected:{" "}
                  <span className="font-medium text-foreground">
                    {liveNativeFolderPath ? formatNativeFolderDisplayPath(liveNativeFolderPath) : "Not set"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  For SAF <code className="text-[10px]">content://</code> trees, mirror files are written via the same
                  native backup writer. Removing a file when a company goes online may require manual delete on some
                  devices.
                </p>
                <Button type="button" onClick={() => void handleSaveLiveDataLocation()} disabled={savingLiveDataLocation || !liveNativeFolderPath}>
                  {savingLiveDataLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span className={savingLiveDataLocation ? "ml-2" : ""}>Save data location</span>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This browser does not support folder selection. Use a Chromium-based desktop browser or the app APK.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLiveDataLocationDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={backupLocationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeBackupLocationDialog();
            return;
          }
          setBackupLocationDialogOpen(true);
        }}
      >
        <DialogContent className="w-[calc(100%-4px)] max-w-md rounded-xl mx-[2px]" data-pl-backup-dialog="sky">
          <DialogHeader>
            <DialogTitle>Device backup location</DialogTitle>
            <DialogDescription>
              Choose where backup files should be saved on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!nativeRuntime && (supportsWebFolderPicker || canPickElectronBackupDirectory()) ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Current folder:{" "}
                  <span className="font-medium text-foreground break-all">
                    {webFolderDisplayPath || webFolderLabel || "Not set"}
                  </span>
                </div>
                {!canPickElectronBackupDirectory() ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="backup-location-full-path" className="text-sm">
                      Full folder path
                    </Label>
                    <Input
                      id="backup-location-full-path"
                      value={webFolderDisplayPath || ""}
                      onChange={(e) => setWebFolderDisplayPath(e.target.value || null)}
                      placeholder="C:\Users\...\Company data backups"
                      className="pl-backup-control-sky font-mono text-xs sm:text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Paste the full Windows path after Browse — web browser only stores the folder name.
                    </p>
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  Auto save to selected folder: <span className="font-medium text-foreground">{webUseSelectedFolder ? "On" : "Off"}</span>
                </div>
                <div className="flex w-full flex-row items-stretch gap-2">
                  <Button type="button" variant="outline" className="min-w-0 flex-1 px-2 text-xs sm:text-sm" onClick={handlePickWebFolder}>
                    Browse folder
                  </Button>
                  <Button
                    type="button"
                    className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
                    onClick={() => void handleSaveWebLocation()}
                    disabled={(!webFolderLabel && !webFolderDisplayPath) || savingBackupLocation}
                  >
                    {savingBackupLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span className={savingBackupLocation ? "ml-2" : ""}>Save location</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
                    onClick={closeBackupLocationDialog}
                  >
                    Close
                  </Button>
                </div>
              </>
            ) : nativeRuntime ? (
              <>
                <div className="text-xs text-muted-foreground break-words">
                  Selected folder:{" "}
                  <span className="font-medium text-foreground">
                    {nativeFolderPath ? formatNativeFolderDisplayPath(nativeFolderPath) : "Not set"}
                  </span>
                </div>
                <div className="flex w-full flex-row items-stretch gap-2">
                  <Button type="button" variant="outline" className="min-w-0 flex-1 px-2 text-xs sm:text-sm" onClick={handlePickNativeFolder}>
                    Browse folder
                  </Button>
                  <Button
                    type="button"
                    className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
                    onClick={() => void handleSaveNativeLocation()}
                    disabled={savingBackupLocation || !nativeFolderPath}
                  >
                    {savingBackupLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span className={savingBackupLocation ? "ml-2" : ""}>Save location</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
                    onClick={closeBackupLocationDialog}
                  >
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This browser does not support fixed folder permission. Backup will ask location each time.
                </p>
                <Button type="button" variant="outline" className="w-full" onClick={closeBackupLocationDialog}>
                  Close
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={autoBackupEditCompanyOpen}
        onOpenChange={(open) => {
          if (!open) closeAutoBackupEditCompanyDialog();
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          data-pl-backup-dialog="sky"
        >
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
            <DialogDescription>
              {autoBackupEditCompanyTarget?.name
                ? `Optional: set a password for ${autoBackupEditCompanyTarget.name} to encrypt backups.`
                : "Update company profile and password."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <EditCompanyForm initialPasswordEnabled onSaved={() => void handleAutoBackupCompanySaved()} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(autoBackupSettingsCompany)}
        onOpenChange={(open) => {
          if (!open) closeAutoBackupCompanySettings();
        }}
      >
        <DialogContent className="max-w-md w-[95vw] max-h-[90vh] flex flex-col overflow-hidden rounded-2xl p-0" data-pl-backup-dialog="sky">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <DialogTitle>Auto backup settings</DialogTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    aria-label="Auto backup settings information"
                  >
                    <Info className="h-4 w-4" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="max-w-[20rem] text-xs leading-snug p-3">
                  {autoBackupSettingsCompany?.name
                    ? `Choose backup source and contents for ${autoBackupSettingsCompany.name}. Saved settings apply to scheduled and Backup now runs.`
                    : "Per-company auto backup options."}
                </PopoverContent>
              </Popover>
            </div>
            {autoBackupSettingsCompany?.name ? (
              <p className="text-sm font-semibold text-foreground/80 truncate mt-0.5" title={autoBackupSettingsCompany.name}>
                {autoBackupSettingsCompany.name}
              </p>
            ) : null}
            <DialogDescription className="sr-only">
              {autoBackupSettingsCompany?.name
                ? `Backup options for ${autoBackupSettingsCompany.name}`
                : "Per-company auto backup options"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-2">
          <div className="space-y-3 text-sm text-muted-foreground">
            {!isAutoBackupSettingsLocalCompany ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <Label className="text-sm font-medium text-foreground">
                {staticBackupClient ? "Backup for" : "Backup source"}
              </Label>
              <RadioGroup
                value={staticBackupClient ? autoBackupSettingsDraft.backupIntent : autoBackupSettingsDraft.backupSourceMode}
                onValueChange={(v) => {
                  if (staticBackupClient) {
                    setAutoBackupSettingsDraft((prev) => ({
                      ...prev,
                      backupIntent: v as CompanyBackupIntent,
                      backupSourceMode: "local_only",
                    }));
                  } else {
                    setAutoBackupSettingsDraft((prev) => ({
                      ...prev,
                      backupSourceMode: v as CompanyBackupSourceMode,
                    }));
                  }
                }}
                className="grid gap-2"
              >
                {staticBackupClient ? (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-left">
                      <RadioGroupItem value="for_offline" className="mt-0.5" />
                      <span>
                        <span className="font-medium text-foreground">For offline</span> — SQLite on this device only.
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-left">
                      <RadioGroupItem value="for_online" className="mt-0.5" />
                      <span>
                        <span className="font-medium text-foreground">For online</span> — keeps cloud file URLs when available.
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-left">
                      <RadioGroupItem value="local_only" className="mt-0.5" />
                      <span>
                        <span className="font-medium text-foreground">Local device only</span> — SQLite on this device.
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-left">
                      <RadioGroupItem value="online_merge" className="mt-0.5" />
                      <span>
                        <span className="font-medium text-foreground">Online + local merge</span> — Firestore + SQLite merge.
                      </span>
                    </label>
                  </>
                )}
              </RadioGroup>
            </div>
            ) : null}
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <Label className="text-sm font-medium text-foreground">Backup contents</Label>
              {staticBackupClient ||
              isAutoBackupSettingsLocalCompany ||
              autoBackupSettingsDraft.backupSourceMode === "local_only" ||
              autoBackupSettingsDraft.backupIntent === "for_offline" ? (
                <RadioGroup
                  value={autoBackupSettingsDraft.includeAttachments ? "attachments" : "data"}
                  onValueChange={(v) => {
                    setAutoBackupSettingsDraft((prev) => ({
                      ...prev,
                      includeAttachments: v === "attachments",
                    }));
                  }}
                  className="grid gap-2"
                >
                  <label className="flex cursor-pointer items-start gap-2 text-left">
                    <RadioGroupItem value="data" className="mt-0.5" />
                    <span>
                      <span className="font-medium text-foreground">Data only</span> — records and attachment links (URLs).
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex items-start gap-2 text-left",
                      staticBackupClient ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                    )}
                  >
                    <RadioGroupItem value="attachments" className="mt-0.5" disabled={!staticBackupClient} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1">
                        <span className="font-medium text-foreground">With attachments</span>
                        {!staticBackupClient ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                                aria-label="Attachment backup info"
                              >
                                <Info className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="start" className="max-w-[18rem] text-xs leading-snug p-3">
                              Attachment backup is only available in the <strong>EXE or APK (static app)</strong>. Web app can only backup data and attachment links.
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </span>
                      {staticBackupClient ? (
                        <span className="text-xs leading-relaxed">
                          Embed files already on this device. Missing files stay as URLs (online company).
                        </span>
                      ) : null}
                    </span>
                  </label>
                </RadioGroup>
              ) : (
                <RadioGroup
                  value={autoBackupSettingsDraft.includeAttachments ? "attachments" : "data"}
                  onValueChange={(v) => {
                    if (v === "attachments") {
                      const gate = getOnlineCompanyBackupTickGate(autoBackupSettingsCompany, {
                        attachmentEmbedMode: "may_download",
                      });
                      if (!gate.filesAllowed) {
                        toast({
                          variant: "destructive",
                          title: "Files tick required",
                          description:
                            gate.filesMessage ||
                            "Turn on Files for this company in Company Selector (Online tab), then Save.",
                        });
                        return;
                      }
                    }
                    setAutoBackupSettingsDraft((prev) => ({
                      ...prev,
                      includeAttachments: v === "attachments" && attachmentFeatureOn,
                    }));
                  }}
                  className="grid gap-2"
                >
                  <label className="flex cursor-pointer items-start gap-2 text-left">
                    <RadioGroupItem value="data" className="mt-0.5" />
                    <span>
                      <span className="font-medium text-foreground">Data only</span> — company records and attachment links.
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex items-start gap-2 text-left",
                      attachmentFeatureOn && staticBackupClient ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                    )}
                  >
                    <RadioGroupItem
                      value="attachments"
                      className="mt-0.5"
                      disabled={!attachmentFeatureOn || !staticBackupClient}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1">
                        <span className="font-medium text-foreground">With attachments</span>
                        {!staticBackupClient ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                                aria-label="Attachment backup info"
                              >
                                <Info className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="start" className="max-w-[18rem] text-xs leading-snug p-3">
                              Attachment backup is only available in the <strong>EXE or APK (static app)</strong>. Web app can only backup data and attachment links.
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </span>
                      {!attachmentFeatureOn ? (
                        <span className="text-xs">Not included on your plan.</span>
                      ) : null}
                    </span>
                  </label>
                </RadioGroup>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1">
                <Label className="text-sm font-medium text-foreground">Restore access (Gmail)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      aria-label="Restore access info"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="max-w-[20rem] text-xs leading-snug p-3">
                    Optional. These Gmail accounts can restore backups for this company (in addition to owner). Use the same Gmail as Firebase login on the restore device.
                  </PopoverContent>
                </Popover>
              </div>
              {normalizeRestoreAllowedGmailList(
                autoBackupSettingsDraft.restoreAllowedGmails,
                autoBackupSettingsDraft.restoreAllowedGmail
              ).length > 0 ? (
                <ul className="space-y-1.5">
                  {normalizeRestoreAllowedGmailList(
                    autoBackupSettingsDraft.restoreAllowedGmails,
                    autoBackupSettingsDraft.restoreAllowedGmail
                  ).map((email) => (
                    <li
                      key={email}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-2.5 py-1.5"
                    >
                      <span className="min-w-0 truncate text-sm text-foreground">{email}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${email}`}
                        onClick={() => removeRestoreAllowedGmailDraft(email)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No extra Gmail added yet.</p>
              )}
              <div className="flex gap-2">
                <Input
                  id="auto-backup-restore-gmail"
                  type="email"
                  autoComplete="email"
                  placeholder="staff@gmail.com"
                  value={restoreGmailInput}
                  onChange={(e) => setRestoreGmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRestoreAllowedGmailDraft();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={addRestoreAllowedGmailDraft}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
            <BackupFyScopePicker
              idPrefix="auto-backup"
              companyId={autoBackupSettingsCompany?.id}
              company={autoBackupSettingsCompany}
              value={autoBackupSettingsDraft.fyScope ?? "all"}
              openEndedTo
              onChange={(next) =>
                setAutoBackupSettingsDraft((prev) => ({
                  ...prev,
                  fyScope:
                    next === "all"
                      ? "all"
                      : next.toFyKey
                        ? { fromFyKey: next.fromFyKey, toFyKey: next.toFyKey }
                        : { fromFyKey: next.fromFyKey },
                }))
              }
            />
          </div>
          </div>
          <DialogFooter className="px-4 pb-4 pt-2 shrink-0 grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={closeAutoBackupCompanySettings}>
              Cancel
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={saveAutoBackupCompanySettings}>
              Save settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       <AlertDialog open={isEncryptedBackupConfirmOpen} onOpenChange={setIsEncryptedBackupConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {company?.password && String(company.password).trim()
                ? "Confirm Encrypted Backup"
                : "Confirm Backup"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  {company?.password && String(company.password).trim()
                    ? "This backup will be encrypted with your company password. That password is required to restore the data."
                    : "This company has no password — the backup will be saved without encryption. Anyone with the file can read it. Set a company password in settings if you want encrypted backups."}
                </p>
                {!isLocalCompanyBackup ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <Label className="text-sm font-medium text-foreground">
                    {staticBackupClient ? "Backup for" : "Backup source"}
                  </Label>
                  <RadioGroup
                    value={staticBackupClient ? backupIntent : backupSourceMode}
                    onValueChange={(v) => {
                      if (staticBackupClient) {
                        const intent = v as CompanyBackupIntent;
                        setBackupIntent(intent);
                        // EXE/APK: always SQLite-only — never force online_merge.
                        setBackupSourceMode("local_only");
                      } else {
                        setBackupSourceMode(v as CompanyBackupSourceMode);
                      }
                    }}
                    className="grid gap-2"
                  >
                    {staticBackupClient ? (
                      <>
                        <label className="flex cursor-pointer items-start gap-2 text-left">
                          <RadioGroupItem value="for_offline" id="backup-intent-offline" className="mt-0.5" />
                          <span>
                            <span className="font-medium text-foreground">For offline</span> — SQLite data from this
                            device only. Missing cloud file links can be downloaded optionally, or stripped. Restore
                            marks the company offline on this device.
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 text-left">
                          <RadioGroupItem value="for_online" id="backup-intent-online" className="mt-0.5" />
                          <span>
                            <span className="font-medium text-foreground">For online</span> — same SQLite snapshot;
                            keeps cloud file URLs when you choose to download missing files.
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="flex cursor-pointer items-start gap-2 text-left">
                          <RadioGroupItem value="local_only" id="backup-source-local" className="mt-0.5" />
                          <span>
                            <span className="font-medium text-foreground">Local device only</span> — SQLite on this
                            device. No Firestore / internet check. Use when offline or Firebase company was deleted.
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 text-left">
                          <RadioGroupItem value="online_merge" id="backup-source-online" className="mt-0.5" />
                          <span>
                            <span className="font-medium text-foreground">Online + local merge</span> — when online,
                            also read Firestore and merge with local SQLite (normal backup).
                          </span>
                        </label>
                      </>
                    )}
                  </RadioGroup>
                </div>
                ) : null}
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <Label className="text-sm font-medium text-foreground">Backup contents</Label>
                  <RadioGroup
                    value={backupIncludeAttachments ? "attachments" : "data"}
                    onValueChange={(v) => {
                      if (v === "attachments") {
                        const localDeviceEmbed =
                          staticBackupClient ||
                          backupIntent === "for_offline" ||
                          backupSourceMode === "local_only" ||
                          isLocalCompanyBackup;
                        if (!localDeviceEmbed) {
                          const gate = getOnlineCompanyBackupTickGate(company, {
                            attachmentEmbedMode: "may_download",
                          });
                          if (!gate.filesAllowed) {
                            toast({
                              variant: "destructive",
                              title: "Files tick required",
                              description:
                                gate.filesMessage ||
                                "Turn on Files for this company in Company Selector (Online tab), then Save.",
                            });
                            return;
                          }
                        }
                      }
                      setBackupIncludeAttachments(v === "attachments");
                    }}
                    className="grid gap-2"
                  >
                    <label className="flex cursor-pointer items-start gap-2 text-left">
                      <RadioGroupItem value="data" id="backup-mode-data" className="mt-0.5" />
                      <span>
                        <span className="font-medium text-foreground">Data only</span>
                        {backupIntent === "for_offline" && staticBackupClient ? (
                          <span className="block text-xs mt-1 leading-relaxed">
                            Documents only — remote HTTPS attachment links are stripped from the file.
                          </span>
                        ) : (
                          <span> — documents and attachment links (URLs). Smaller file.</span>
                        )}
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-2 text-left ${
                        backupIntent !== "for_offline" &&
                        backupSourceMode !== "local_only" &&
                        !isLocalCompanyBackup &&
                        !attachmentFeatureOn
                          ? "opacity-60 cursor-not-allowed"
                          : "cursor-pointer"
                      }`}
                    >
                      <RadioGroupItem
                        value="attachments"
                        id="backup-mode-attachments"
                        className="mt-0.5"
                        disabled={
                          backupIntent !== "for_offline" &&
                          backupSourceMode !== "local_only" &&
                          !isLocalCompanyBackup &&
                          !attachmentFeatureOn
                        }
                      />
                      <span>
                        <span className="font-medium text-foreground">
                          {backupIntent === "for_offline" ||
                          backupSourceMode === "local_only" ||
                          isLocalCompanyBackup
                            ? "With attachments (local device)"
                            : "With attachments"}
                        </span>
                        {backupIntent === "for_offline" ||
                        backupSourceMode === "local_only" ||
                        isLocalCompanyBackup ||
                        staticBackupClient ? (
                          <span className="block text-xs mt-1 leading-relaxed">
                            Embed files already on this device. For online companies, missing files stay as URLs.
                          </span>
                        ) : (
                          <span className="block text-xs mt-1 leading-relaxed">
                            Compressed zip inside encrypted .plbp (uses monthly plan quota).
                            {backupAttachmentGateHint ? (
                              <span className="block mt-1">{backupAttachmentGateHint}</span>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </label>
                  </RadioGroup>
                </div>
                {currentCompanyFyScopeMarker ? (
                  <p className="rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    This company was restored from an FY-scoped backup: history starts at FY{" "}
                    {currentCompanyFyScopeMarker.fromFyKey}; openings were carried forward.
                  </p>
                ) : null}
                <BackupFyScopePicker
                  idPrefix="manual-backup"
                  companyId={companyId}
                  company={company}
                  value={backupFyScopeDraft}
                  onChange={setBackupFyScopeDraft}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const allowsAttachmentEmbed =
                      staticBackupClient ||
                      backupIntent === "for_offline" ||
                      backupSourceMode === "local_only" ||
                      isLocalCompanyBackup ||
                      attachmentFeatureOn;
                    void handleBackup(backupIncludeAttachments && allowsAttachmentEmbed);
                  }}
                  disabled={missingAttachmentScanBusy}
                >
                  {missingAttachmentScanBusy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking files…
                    </>
                  ) : (
                    "Proceed"
                  )}
                </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(missingAttachmentPrompt)}
        onOpenChange={(open) => {
          if (!open) setMissingAttachmentPrompt(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Some attachment files are missing</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This backup uses <span className="font-medium text-foreground">SQLite on this device only</span>.
                  {missingAttachmentPrompt ? (
                    <>
                      {" "}
                      <span className="font-medium text-foreground">
                        {missingAttachmentPrompt.availableCount}
                      </span>{" "}
                      file(s) are available locally (including pending).{" "}
                      <span className="font-medium text-foreground">
                        {missingAttachmentPrompt.missingCount}
                      </span>{" "}
                      of {missingAttachmentPrompt.total} link(s) have no bytes on this PC.
                    </>
                  ) : null}
                </p>
                <p>
                  <span className="font-medium text-foreground">Download missing files</span> — fetch from cloud,
                  then embed everything.
                </p>
                <p>
                  <span className="font-medium text-foreground">Continue with local only</span> — remove missing
                  URLs from the backup; keep local/pending files as pending inside the .plbp.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel className="w-full sm:w-full">Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={typeof navigator !== "undefined" && !navigator.onLine}
              onClick={() => {
                setMissingAttachmentPrompt(null);
                void runBackupWithPolicy(true, "download_missing");
              }}
            >
              Download missing files
            </Button>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                setMissingAttachmentPrompt(null);
                void runBackupWithPolicy(true, "local_only");
              }}
            >
              Continue with local only
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
       <Dialog open={isDecrypting} onOpenChange={(open) => {
           if (!open) {
               setIsDecrypting(false);
               setFileToRestore(null);
               setDecryptionPassword('');
               setDecryptionError(null);
           }
       }}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Decryption Required</DialogTitle>
                 <Label>
                  {company?.password && String(company.password).trim()
                    ? "This backup file is encrypted. Enter your company password to restore."
                    : "This backup file is encrypted. Enter the password that was used when the backup was created."}
                 </Label>
            </DialogHeader>
            <div className="space-y-2">
              <div className="relative">
                <Input
                  type={showDecryptionPassword ? "text" : "password"}
                  value={decryptionPassword}
                  onChange={(e) => {
                    setDecryptionPassword(e.target.value);
                    setDecryptionError(null);
                  }}
                  placeholder="Enter password..."
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 border-0 shadow-none"
                  tabIndex={-1}
                  aria-label={showDecryptionPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowDecryptionPassword((prev) => !prev)}
                >
                  {showDecryptionPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              </div>
              {decryptionError && <p className="text-sm text-destructive">{decryptionError}</p>}
               {decryptionError && fileToRestore?.name.endsWith('.json') && (
                <p className="text-sm text-amber-600">This file seems to be encrypted or is corrupted. Please provide a password if it's encrypted.</p>
              )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => {setIsDecrypting(false); setFileToRestore(null); }}>Cancel</Button>
                <Button onClick={handleDecryptionAndRestore} disabled={!decryptionPassword || isRestoring}>
                    {isRestoring && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                    Decrypt & Restore
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>


      <AlertDialog open={isOverwriteConfirmOpen} onOpenChange={setIsOverwriteConfirmOpen}>
        <AlertDialogContent className="flex max-h-[90vh] w-full max-w-lg flex-col gap-0 overflow-hidden p-0">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
                <FileWarning className="h-6 w-6 text-destructive" /> Are you absolutely sure?
                <SettingsInfoTip
                  label="Restore confirmation"
                  description={
                    !company
                      ? "No company is selected. Restore creates a new company with a new id. Choose Online (cloud sync) or Offline (this device only). Only the company owner can restore."
                      : restoreTargetMode === "replace_current"
                        ? `Restore will replace all data in the open company "${company?.name}" (same id). Other companies stay unchanged. Only the company owner can restore.`
                        : `Restore creates a new company with a new id. Data in "${company?.name}" and your other companies stays as-is. Only the company owner can restore.`
                  }
                />
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <p className="text-sm text-muted-foreground">
                Type{" "}
                <code className="bg-muted px-2 py-1 rounded-md font-mono text-foreground">
                  {restoreConfirmationName.toLowerCase()}
                </code>{" "}
                below to confirm.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!company ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              No company is open — restore will create a <strong className="text-foreground">new company</strong> with
              a new id. Choose Online or Offline below.
            </p>
          ) : null}
          {company && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1">
                <Label className="text-sm font-medium text-foreground">How to restore</Label>
                <SettingsInfoTip
                  label="How to restore"
                  description={
                    <>
                      <p className="mb-1.5">
                        <strong>Replace current company</strong> — overwrite {company.name} data (same company id).
                        Current vouchers, parties, etc. will be replaced by the backup.
                      </p>
                      <p>
                        <strong>Restore as new company</strong> — keep the current company as-is; the backup becomes a
                        separate company with a new id.
                      </p>
                    </>
                  }
                />
              </div>
              <RadioGroup
                value={restoreTargetMode}
                onValueChange={(v) => setRestoreTargetMode(v as RestoreTargetMode)}
                className="grid gap-2"
              >
                <label className="flex cursor-pointer items-center gap-2 text-left text-sm">
                  <RadioGroupItem value="replace_current" id="restore-target-replace" />
                  <span className="font-medium text-foreground">1 — Replace current company</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-left text-sm">
                  <RadioGroupItem value="new_company" id="restore-target-new" />
                  <span className="font-medium text-foreground">2 — Restore as new company</span>
                </label>
              </RadioGroup>
            </div>
          )}
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1">
              <Label className="text-sm font-medium text-foreground">Restore destination</Label>
              <SettingsInfoTip
                label="Restore destination"
                description={
                  <>
                    <p className="mb-1.5">
                      <strong>Online</strong> — restore on this device, then upload to Firestore in the background so
                      other devices can sync. Needs a free online company slot (unless this company is already
                      cloud-linked). For Offline backups: Online is blocked when replacing the same company (cloud
                      HTTPS links were removed); use &quot;Restore as new company&quot; to build fresh cloud links.
                    </p>
                    <p>
                      <strong>Offline</strong> — keep everything in local SQLite on this device only. No automatic cloud
                      upload.
                    </p>
                  </>
                }
              />
            </div>
            <RadioGroup
              value={restoreToLocalSqlite ? "offline" : "online"}
              onValueChange={(v) => {
                if (v === "online" && !restoreOnlineDestinationEnabled) return;
                setRestoreToLocalSqlite(v === "offline");
              }}
              className="grid gap-2"
            >
              <div className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="online"
                  id="restore-dest-online"
                  disabled={!restoreOnlineDestinationEnabled}
                />
                <Label
                  htmlFor="restore-dest-online"
                  className={`font-medium ${
                    restoreOnlineDestinationEnabled
                      ? "cursor-pointer text-foreground"
                      : "cursor-not-allowed text-muted-foreground"
                  }`}
                >
                  Online
                </Label>
                <SettingsInfoTip
                  label="Online"
                  description={
                    restoreServerLoginSession
                      ? isOfflineIntentRestore && !restoreAsNewCompany
                        ? "This is an Offline backup. Replacing the same company Online is not available. Choose Offline, or switch to 'Restore as new company' to restore it on the Pocket Ledger Server."
                        : "Restore to the Pocket Ledger Server. Records and files are uploaded to the server; the server admin controls company limits."
                      : isOfflineIntentRestore && !restoreAsNewCompany
                      ? "This is an Offline backup (cloud HTTPS links were removed). Replacing the same company Online is not available. Choose Offline, or switch to “Restore as new company” — then Online can create fresh cloud links (needs a free plan slot)."
                      : restoreOnlineSlotGate.max <= 0
                        ? "Your plan has no online company slots. Upgrade to restore into Firestore (cloud)."
                        : !restoreOnlineSlotGate.ok
                          ? `Online company slots are full (${restoreOnlineSlotGate.current}/${restoreOnlineSlotGate.max}). Free a slot or upgrade, then restore Online.`
                          : isOfflineIntentRestore || !company
                            ? "Offline backup restored as a new Online company: fresh cloud file links are created on upload. Uses one online company slot."
                            : "Restore data to this device and register the company on Firebase (Online tab). Masters, vouchers, and files sync when you tick Data / Files in Company → Online and Save. Uses one online slot when the company is not already cloud-linked."
                  }
                />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="offline" id="restore-dest-offline" />
                <Label htmlFor="restore-dest-offline" className="cursor-pointer font-medium text-foreground">
                  Offline
                </Label>
                <SettingsInfoTip
                  label="Offline"
                  description="Saves all data to local SQLite on this device (browser / EXE). Best for offline and local companies. Read/write stay on this device — no automatic cloud upload."
                />
              </div>
            </RadioGroup>
            {!restoreServerLoginSession && !restoreOnlineDestinationEnabled && isOfflineIntentRestore && restoreAsNewCompany ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                {restoreOnlineSlotGate.max <= 0
                  ? "Online restore needs an online company slot on your plan."
                  : !restoreOnlineSlotGate.ok
                    ? `Online slots full (${restoreOnlineSlotGate.current}/${restoreOnlineSlotGate.max}). Free a slot or choose Offline.`
                    : staticBackupClient
                      ? "Online restore from backup is not available in the desktop app — use the web app."
                      : null}
              </p>
            ) : isOfflineIntentRestore && restoreAsNewCompany && restoreOnlineDestinationEnabled ? (
              <p className="text-xs text-muted-foreground">
                Offline backup → pick <strong className="text-foreground">Online</strong> to create a new cloud
                company with fresh attachment links.
              </p>
            ) : null}
          </div>
          {backupDataToRestore?.companyDetails?.[0] && company && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1">
                <Label className="text-sm font-medium text-foreground" htmlFor="restore-company-name-select">
                  Company name after restore
                </Label>
                <SettingsInfoTip
                  label="Company name after restore"
                  description={
                    restoreTargetMode === "replace_current"
                      ? "Choose the display name for the restored company (same id as the open company)."
                      : "This name is stored on the new restored company only (id is always new). Pick the backup name if you want the label to match the file."
                  }
                />
              </div>
              <select
                id="restore-company-name-select"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={restoreCompanyNameChoice}
                onChange={(e) => setRestoreCompanyNameChoice(e.target.value as "target" | "backup")}
              >
                <option value="target">
                  {String(company.name ?? "").trim() || "(current slot)"}
                  {restoreTargetMode === "replace_current"
                    ? " — keep this name (default)"
                    : " — use this name for the new copy (default)"}
                </option>
                <option value="backup">
                  {String(backupDataToRestore.companyDetails[0].name ?? "").trim() || "(backup)"} — from backup file
                </option>
              </select>
            </div>
          )}
          {backupDataHasOrphanAttachmentRefs(backupDataToRestore) && (
            <p className="text-xs text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-3">
              This backup has attachment links (tick marks) but no embedded files. Restore will not bring files back —
              take a new backup with “With attachments” after the app update, then restore again.
            </p>
          )}
          {backupDataHasAttachmentBundle(backupDataToRestore) && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1">
                <Label className="text-sm font-medium text-foreground">Attachment restore</Label>
                <SettingsInfoTip
                  label="Attachment restore"
                  description={
                    <>
                      <p className="mb-1.5">
                        This backup includes a compressed attachments zip (locked with your company password).
                      </p>
                      <p className="mb-1.5">
                        <strong>Data only</strong> — keep URLs from the backup (files may be missing offline).
                      </p>
                      <p className="mb-1.5">
                        <strong>With attachments</strong> — write files to this device and update links. Restore on the
                        same app/EXE where you will use the company; web browser and desktop storage are separate.
                      </p>
                      {restoreAttachmentGateHint ? <p>{restoreAttachmentGateHint}</p> : null}
                    </>
                  }
                />
              </div>
              <RadioGroup
                value={restoreIncludeAttachments ? "attachments" : "data"}
                onValueChange={(v) => setRestoreIncludeAttachments(v === "attachments")}
                className="grid gap-2"
              >
                <label className="flex cursor-pointer items-center gap-2 text-left text-sm">
                  <RadioGroupItem value="data" id="restore-mode-data" />
                  <span className="font-medium text-foreground">Data only</span>
                </label>
                <label
                  className={`flex items-center gap-2 text-left text-sm ${
                    !attachmentFeatureOn && !staticBackupClient && !restoreToLocalSqlite && !restoreServerLoginSession
                      ? "opacity-60 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <RadioGroupItem
                    value="attachments"
                    id="restore-mode-attachments"
                    disabled={
                      !attachmentFeatureOn && !staticBackupClient && !restoreToLocalSqlite && !restoreServerLoginSession
                    }
                  />
                  <span className="font-medium text-foreground">With attachments</span>
                </label>
              </RadioGroup>
            </div>
          )}
          <Input 
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder="Type company name to confirm"
          />
          <BackupFyScopeRestoreNotice
            backupData={backupDataToRestore}
            replaceCurrent={Boolean(company) && restoreTargetMode === "replace_current"}
            companyName={company?.name ?? null}
            acknowledged={fyScopeRestoreAck}
            onAcknowledgedChange={setFyScopeRestoreAck}
          />
          </div>
          <AlertDialogFooter className="shrink-0 border-t bg-background p-6 pt-4">
            <div className="flex justify-between items-center w-full">
                <AlertDialogCancel
                  onClick={() => {
                    setBackupDataToRestore(null);
                    restoreZipFilesRef.current = null;
                    setRestoreZipFilesByPath(null);
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void (async () => {
                    if (confirmationText.trim().toLowerCase() !== restoreConfirmationName.toLowerCase()) return;
                    if (fyScopeRestoreBlocked) return;
                    if (!user?.uid) {
                      toast({ variant: "destructive", title: "Not signed in", description: "Sign in again, then retry." });
                      return;
                    }
                    if (company && !company.isOwned) {
                      toast({ variant: "destructive", title: "Permission denied", description: "Only the company owner can restore data." });
                      return;
                    }
                    const data = backupDataToRestore;
                    if (!data) return;
                    const resolvedName = resolveRestoreFinalCompanyName(
                      company ? restoreCompanyNameChoice : "backup",
                      company?.name ?? "",
                      String(data?.companyDetails?.[0]?.name ?? "")
                    );
                    // Capture zip bytes before dialog close — avoid losing attachment payload mid-restore.
                    const zipFilesCaptured = resolveRestoreZipFiles(
                      restoreZipFilesByPath,
                      restoreZipFilesRef.current
                    );
                    if (restoreIncludeAttachments && !backupDataHasAttachmentBundle(data)) {
                      toast({
                        variant: "destructive",
                        title: "No attachment files in this backup",
                        description:
                          "This file is data-only. Create a new backup with “With attachments”, then restore again.",
                        duration: 12_000,
                      });
                      return;
                    }
                    const withAttachments = resolveRestoreIncludeAttachments(
                      restoreIncludeAttachments,
                      data
                    );
                    setIsOverwriteConfirmOpen(false);
                    // Sirf radio — pehle `shouldRestoreToLocalOnly` se local company par cloud option hide + kabhi-kabhi galat branch (SQLite restore skip)
                    await handleLocalOverwriteRestore(
                      data,
                      resolvedName,
                      withAttachments,
                      company ? restoreTargetMode : "new_company",
                      {
                        cloudRestore: restoreOnlineDestinationEnabled && !restoreToLocalSqlite,
                        zipFilesByPath: zipFilesCaptured,
                      }
                    );
                  })();
                }}
                disabled={isRestoring || fyScopeRestoreBlocked || confirmationText.trim().toLowerCase() !== restoreConfirmationName.toLowerCase()}
                className="bg-destructive hover:bg-destructive/90"
                >
                {isRestoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue — restore
                </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore progress popup — Close se sirf dialog band; restore main page (card strip) par chalta rahe. */}
      <Dialog
        open={isRestoring && restoreProgressDialogOpen}
        onOpenChange={(open) => {
          // Sirf dialog band karo — restore run cancel na ho.
          if (!open) setRestoreProgressDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-md" data-pl-backup-dialog="emerald">
          <DialogHeader>
            <DialogTitle>Restoring…</DialogTitle>
            <DialogDescription>
              Device data restores first. You can close this dialog anytime — restore keeps running.
              Online sync continues in the header bar afterward. Avoid refreshing only while attachments
              are uploading.
            </DialogDescription>
          </DialogHeader>
          {restoreProgress ? (
            <BackupProgressStrip
              progress={restoreProgress}
              spinning
              inCard
              showRefreshWarning
              refreshWarningText="Device restore in progress — you can close this dialog; online sync continues in the header bar after device restore completes."
              showCancel
              onCancel={() => {
                cancelRestoreRun();
              }}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting restore…
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRestoreProgressDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
