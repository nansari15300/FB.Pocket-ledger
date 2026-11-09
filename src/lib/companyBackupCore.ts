"use client";

import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { Capacitor } from "@capacitor/core";
import { collection, doc, query, orderBy, limit, startAfter, documentId } from "@/lib/pbCompat/firestore";
import type { QueryDocumentSnapshot } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { encryptData, encryptBytes } from "@/lib/encryption";
import { normalizeRestoreAllowedGmailList } from "@/lib/backupRestoreAccess";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { packPlbpZipBackup } from "@/lib/plbpBackupZip";
import { resolveWebBackupDirectoryForRelativePath, buildAutoBackupRelativeDir, buildCompanyBackupFileName } from "@/lib/autoBackupPath";
import {
  readBackupSaveLocationPrefs,
  readWebBackupDirectoryHandle,
  isNativeRuntime,
  ensureNativeBackupStoragePermission,
} from "@/lib/backupSaveLocation";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import { backupPrefersLocalSnapshot } from "@/lib/backupLocalFirst";
import {
  buildAttachmentZipFromRefs,
  collectAttachmentRefsFromBackupData,
  prepareBackupDataForOfflineFileBackup,
  prepareBackupDataForOfflineIntent,
  stripListedAttachmentRefsFromBackupData,
} from "@/lib/attachmentBackupBundle";
import {
  formatBackupAttachmentPreflightError,
  preflightBackupAttachmentsBeforeEmbed,
  scanLocalAttachmentAvailabilityForBackup,
} from "@/lib/backupAttachmentPreflight";
import {
  bytesPerSecToMbps,
  estimateRemainingFromFilePace,
  formatBackupThroughputLabel,
} from "@/lib/backupProgressMetrics";
import {
  checkAttachmentBackupAllowed,
  incrementAttachmentBackupUsage,
} from "@/lib/attachmentBackupUsage";
import {
  loadIncrementalAttachmentCacheFromBackupLocation,
  refsMissingFromIncrementalCache,
  summarizeIncrementalAttachmentMerge,
  formatIncrementalMergeProgressDetail,
} from "@/lib/incrementalBackupFromLocation";
import type { Company } from "@/hooks/useCompany";
import { COLLECTIONS_TO_BACKUP } from "@/lib/companyBackupCollections";

export { COLLECTIONS_TO_BACKUP } from "@/lib/companyBackupCollections";
export type { CompanyBackupCollection } from "@/lib/companyBackupCollections";

const BACKUP_PAGE_SIZE = 500;

export { backupPrefersLocalSnapshot } from "@/lib/backupLocalFirst";

export type CompanyBackupProgress = {
  phase: string;
  detail: string;
  done?: number;
  total?: number;
  /** Attachment collect throughput — megabits per second (raw). */
  speedMbps?: number;
  /** UI label — Mbps/Kbps ya files/sec jab bytes kam hon. */
  speedLabel?: string;
  /** ETA label e.g. "~2 min left". */
  remainingLabel?: string;
};

async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error ?? new Error("Failed to read blob"));
    r.readAsDataURL(blob);
  });
}

export async function saveBackupBlobWithBestEffort(
  blob: Blob,
  fileName: string,
  opts?: { relativeDir?: string | null }
): Promise<{ where: string }> {
  const savePrefs = readBackupSaveLocationPrefs();
  const relativeDir = String(opts?.relativeDir || "")
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, "");
  const joinRel = (base: string, sep: string) =>
    relativeDir ? `${base.replace(/[/\\]+$/, "")}${sep}${relativeDir.replace(/\\/g, "/")}${sep}${fileName}` : `${base.replace(/[/\\]+$/, "")}${sep}${fileName}`;
  const safFileName = relativeDir ? `${relativeDir.replace(/\\/g, "/")}/${fileName}` : fileName;

  if (Capacitor.isNativePlatform()) {
    try {
      const dataUrl = await blobToBase64DataUrl(blob);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      const treeUri = String(savePrefs.nativeFolderPath || "").trim();
      if (treeUri.startsWith("content://")) {
        try {
          const { BackupSaf } = await import("@/lib/capacitorBackupSaf");
          await BackupSaf.writeToTreeUri({ treeUri, fileName: safFileName, data: base64 });
          return { where: relativeDir ? `Selected folder/${relativeDir}` : "Selected folder (device)" };
        } catch {
          /* fall through */
        }
      }
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
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
      const safeSubfolder = [rawSubfolder, relativeDir].filter(Boolean).join("/").replace(/^[\\/]+|[\\/]+$/g, "");
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
        await Share.share({ title: fileName, url: savedUri, dialogTitle: "Save backup file" });
      } catch {
        /* share cancel ok */
      }
      const dirLabel = savePrefs.nativeDirectory === "EXTERNAL" ? "ExternalStorage" : "Documents";
      return { where: `${dirLabel}/${finalPath}` };
    } catch {
      /* native fail → web fallback */
    }
  }
  let webPreferredFolderFailed = false;
  if (typeof window !== "undefined") {
    try {
      if (!isNativeRuntime() && savePrefs.webUseSelectedFolder) {
        if (isElectronDesktopApp() && savePrefs.webFolderDisplayPath) {
          try {
            const { writeElectronBackupFile } = await import("@/lib/electronBackupFolder");
            await writeElectronBackupFile(savePrefs.webFolderDisplayPath, fileName, blob, relativeDir || undefined);
            const sep = savePrefs.webFolderDisplayPath.includes("\\") ? "\\" : "/";
            return { where: joinRel(savePrefs.webFolderDisplayPath, sep) };
          } catch {
            /* fall through to DirectoryHandle / Save As */
          }
        }
        const dirHandle = await readWebBackupDirectoryHandle();
        if (!dirHandle) {
          webPreferredFolderFailed = true;
        } else {
          if (typeof dirHandle.queryPermission === "function") {
            const p = await dirHandle.queryPermission({ mode: "readwrite" });
            if (p !== "granted" && typeof dirHandle.requestPermission === "function") {
              try {
                const req = await dirHandle.requestPermission({ mode: "readwrite" });
                if (req !== "granted") webPreferredFolderFailed = true;
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
              const targetDir = await resolveWebBackupDirectoryForRelativePath(dirHandle, relativeDir);
              const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              const label =
                savePrefs.webFolderDisplayPath || savePrefs.webFolderLabel || "Selected folder";
              const sep = label.includes("\\") ? "\\" : "/";
              return { where: joinRel(label, sep) };
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
          where: webPreferredFolderFailed ? "Selected folder (Save As fallback)" : "Selected folder (Save As)",
        };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
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

const MASTER_COLLECTIONS_WITH_OPENING = new Set([
  "parties",
  "bank_accounts",
  "staff",
  "items",
  "expense_accounts",
  "taxes",
]);

const OPENING_BALANCE_BACKUP_KEYS = [
  "openingBalance",
  "openingBalanceDate",
  "openingBalanceNarration",
  "openingBalanceUnit",
  "openingBalanceRate",
  "openingBalanceTaxId",
  "openingBalanceAllocated",
  "balance",
] as const;

/** SQLite mirror me nahi — local-only backup me Firestore se supplement. */
const FIRESTORE_SUPPLEMENT_COLLECTIONS = new Set<string>(["recurring_voucher_templates"]);

function localRowDefinesOpeningBalance(row: Record<string, unknown>): boolean {
  return OPENING_BALANCE_BACKUP_KEYS.some((k) => row[k] !== undefined);
}

function applyOpeningBalanceFieldsFromLocal(
  target: Record<string, unknown>,
  local: Record<string, unknown>
): void {
  for (const k of OPENING_BALANCE_BACKUP_KEYS) {
    if (local[k] !== undefined) target[k] = local[k];
  }
}

function applyRecurringTemplateFieldsFromLocal(
  target: Record<string, unknown>,
  local: Record<string, unknown>
): void {
  if (typeof local.enabled === "boolean") target.enabled = local.enabled;
}

function mergeTwoBackupRows(
  fsRow: Record<string, unknown> & { id: string },
  localRow: Record<string, unknown> & { id: string },
  colName: string,
  localPrimary: boolean
): Record<string, unknown> & { id: string } {
  if (localPrimary) {
    const merged: Record<string, unknown> & { id: string } = { ...fsRow, ...localRow, id: localRow.id };
    if (MASTER_COLLECTIONS_WITH_OPENING.has(colName) && !localRowDefinesOpeningBalance(localRow)) {
      for (const k of OPENING_BALANCE_BACKUP_KEYS) {
        if (fsRow[k] !== undefined) merged[k] = fsRow[k];
      }
    }
    if (colName === "recurring_voucher_templates" && typeof localRow.enabled !== "boolean" && typeof fsRow.enabled === "boolean") {
      merged.enabled = fsRow.enabled;
    }
    return merged;
  }

  const localNewer = docRowUpdatedMs(localRow) > docRowUpdatedMs(fsRow);
  const merged: Record<string, unknown> & { id: string } = localNewer
    ? { ...fsRow, ...localRow, id: localRow.id }
    : { ...fsRow, id: fsRow.id };

  if (MASTER_COLLECTIONS_WITH_OPENING.has(colName)) {
    applyOpeningBalanceFieldsFromLocal(merged, localRow);
  }
  if (colName === "recurring_voucher_templates") {
    applyRecurringTemplateFieldsFromLocal(merged, localRow);
  }
  return merged;
}

function mergeFirestoreRowsWithLocalMirrorForBackup(
  fsRows: Array<Record<string, unknown> & { id: string }>,
  localRows: Array<Record<string, unknown> & { id: string }>,
  colName: string,
  options?: { localPrimary?: boolean }
): Array<Record<string, unknown> & { id: string }> {
  const localPrimary = options?.localPrimary === true;
  const byId = new Map<string, Record<string, unknown> & { id: string }>();
  for (const r of fsRows) byId.set(String(r.id), { ...r });
  for (const r of localRows) {
    const id = String(r.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...r });
      continue;
    }
    byId.set(id, mergeTwoBackupRows(prev, r, colName, localPrimary));
  }
  return Array.from(byId.values());
}

function mergeRecurringVoucherSettingsForBackup(
  ...sources: Array<{ enabled?: boolean; runScope?: string; allowedUserIds?: string[] } | null | undefined>
): { enabled?: boolean; runScope?: string; allowedUserIds?: string[] } | undefined {
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    if (typeof s.enabled === "boolean") return { ...s };
  }
  for (const s of sources) {
    if (s && typeof s === "object" && Object.keys(s).length > 0) return { ...s };
  }
  return undefined;
}

async function buildCompanyDetailsForBackup(input: {
  company: Company;
  companyId: string;
  fsCompanyId: string;
  preferLocalSnapshot: boolean;
  onlineForBackup: boolean;
}): Promise<Array<Record<string, unknown>>> {
  const { company, companyId, fsCompanyId, preferLocalSnapshot, onlineForBackup } = input;
  const localRow = (await getLocalCompanyById(companyId, { includeDeleted: true })) as Record<string, unknown> | null;

  let fsCompany: Record<string, unknown> | null = null;
  if (onlineForBackup && fsCompanyId) {
    try {
      const snap = await getDoc(doc(firestore, "companies", fsCompanyId));
      if (snap.exists()) fsCompany = snap.data() as Record<string, unknown>;
    } catch {
      fsCompany = null;
    }
  }

  const recurringVoucherSettings = mergeRecurringVoucherSettingsForBackup(
    (localRow?.recurringVoucherSettings as { enabled?: boolean }) ?? null,
    (company as { recurringVoucherSettings?: { enabled?: boolean } }).recurringVoucherSettings ?? null,
    (fsCompany?.recurringVoucherSettings as { enabled?: boolean }) ?? null
  );

  const base = preferLocalSnapshot
    ? { ...(fsCompany || {}), ...company, ...(localRow || {}), id: companyId }
    : { ...(fsCompany || {}), ...company, ...(localRow || {}), id: companyId };

  if (recurringVoucherSettings) {
    (base as Record<string, unknown>).recurringVoucherSettings = recurringVoucherSettings;
  }

  return [base as Record<string, unknown>];
}

function applyBackupRestoreGmailsToCompanyDetails(
  companyDetails: Array<Record<string, unknown>>,
  backupRestoreGmails?: string[] | null
): Array<Record<string, unknown>> {
  const emails = normalizeRestoreAllowedGmailList(backupRestoreGmails);
  if (!emails.length || !companyDetails.length) return companyDetails;
  const row: Record<string, unknown> = { ...companyDetails[0], backupRestoreEmails: emails };
  if (emails.length === 1) row.backupRestoreGmail = emails[0];
  return [row, ...companyDetails.slice(1)];
}

/** `local_only` = sirf is device ka SQLite; Firestore / online sync skip (offline recovery). */
export type CompanyBackupSourceMode = "local_only" | "online_merge";

/** Backup purpose: offline portable (no HTTPS) vs online/cloud-restorable (keep remote URLs). */
export type CompanyBackupIntent = "for_online" | "for_offline";

/**
 * Missing attachment files on device:
 * - `download_missing` — cloud se download karke embed
 * - `local_only` — sirf device bytes embed; `for_offline` missing URLs strip; `for_online` missing URLs rehne do
 */
export type CompanyBackupAttachmentMissingPolicy = "download_missing" | "local_only";

export type ExecuteCompanyBackupInput = {
  company: Company;
  companyId: string;
  ownerUid: string;
  accountPlanId: string;
  includeAttachments: boolean;
  /** Default: static/APK/EXE → local_only behaviour jab set na ho; explicit choice UI se aata hai. */
  backupSourceMode?: CompanyBackupSourceMode;
  /** Default: local_only → for_offline; online_merge → for_online. */
  backupIntent?: CompanyBackupIntent;
  /** With attachments: missing files download vs strip + continue. Default download when online merge. */
  attachmentMissingPolicy?: CompanyBackupAttachmentMissingPolicy;
  /** Auto backup: `{company}/{year}/{Month}/{day}` under saved backup location. */
  backupRelativeDir?: string | null;
  /** Folder + file stamp calendar (AD July / BS Shrawan). */
  folderDateSystem?: import("@/lib/autoBackupPath").BackupFolderDateSystem;
  /** File name prefix: Manual_… vs Auto_… */
  backupFileRunKind?: import("@/lib/autoBackupPath").BackupFileRunKind;
  /** Gmail list allowed to restore this backup file (stored in companyDetails). */
  backupRestoreGmails?: string[] | null;
  /** FY range: "all" (default) or From FY ... To - earlier FY closings become master openings in the file. */
  fyScope?: import("@/lib/backupFyScopeRewrite").BackupFyScope | null;
  onProgress: (p: CompanyBackupProgress) => void;
  signal?: AbortSignal;
};

export type ExecuteCompanyBackupResult =
  | {
      ok: true;
      where: string;
      includeAttachments: boolean;
      /** User ne files chuni thi — kitni unique refs mili. */
      attachmentRefCount?: number;
      /** Bundle me kitni files embed hui (0 = data-only backup despite checkbox). */
      attachmentEmbeddedCount?: number;
    }
  | { ok: false; error: string; cancelled?: boolean };

/** FY-scoped backup: `Manual_backup_x_stamp.plbp` -> `Manual_backup_x_stamp_FY2081-2082_to_latest.plbp`. */
function appendFyScopeToBackupFileName(fileName: string, suffix: string | null): string {
  if (!suffix) return fileName;
  return /\.plbp$/i.test(fileName) ? fileName.replace(/\.plbp$/i, `_${suffix}.plbp`) : `${fileName}_${suffix}`;
}

/** Core backup pipeline — module singleton se chale taaki page change par na ruke. */
export async function executeCompanyBackup(input: ExecuteCompanyBackupInput): Promise<ExecuteCompanyBackupResult> {
  const {
    company,
    companyId,
    ownerUid,
    accountPlanId,
    includeAttachments,
    backupSourceMode = backupPrefersLocalSnapshot() ? "local_only" : "online_merge",
    backupIntent: backupIntentInput,
    attachmentMissingPolicy: attachmentMissingPolicyInput,
    backupRelativeDir,
    folderDateSystem: folderDateSystemInput,
    backupFileRunKind: backupFileRunKindInput,
    backupRestoreGmails,
    fyScope,
    onProgress,
    signal,
  } = input;
  const localOnlySource = backupSourceMode === "local_only";
  const backupIntent: CompanyBackupIntent =
    backupIntentInput ?? (localOnlySource ? "for_offline" : "for_online");
  const offlineIntent = backupIntent === "for_offline";
  const attachmentMissingPolicy: CompanyBackupAttachmentMissingPolicy =
    attachmentMissingPolicyInput ??
    (localOnlySource ? "local_only" : "download_missing");
  const encryptionPassword = String(company.password || "").trim();
  const folderDateSystem = folderDateSystemInput === "BS" ? "BS" : "AD";
  const backupFileRunKind = backupFileRunKindInput === "Auto" ? "Auto" : "Manual";
  /** `{Company}/{year}/{MonthFull}/{DD}` — callers pass relativeDir with AD/BS month names. */
  const resolvedRelativeDir =
    String(backupRelativeDir || "").trim() ||
    buildAutoBackupRelativeDir(String(company.name || companyId), companyId, new Date(), folderDateSystem);

  if (includeAttachments && !localOnlySource && !offlineIntent) {
    const gate = await checkAttachmentBackupAllowed(ownerUid, accountPlanId);
    if (!gate.allowed) return { ok: false, error: gate.message || "Attachment backup not allowed." };
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Backup cancelled", "AbortError");
  };

  try {
    onProgress({ phase: "Reading data", detail: "Loading company records…" });
    const fsCompanyId =
      String((company as { authoritativeCompanyId?: string }).authoritativeCompanyId || companyId || "").trim() ||
      companyId;
    const localOnlyBackup = String(company.storageOption || "").toLowerCase() === "local";
    const onlineForBackup = typeof navigator !== "undefined" && navigator.onLine;
    const preferLocalSnapshot = backupPrefersLocalSnapshot() || localOnlySource;

    const companyDetails = applyBackupRestoreGmailsToCompanyDetails(
      await buildCompanyDetailsForBackup({
        company,
        companyId,
        fsCompanyId,
        preferLocalSnapshot,
        onlineForBackup,
      }),
      backupRestoreGmails
    );

    // Nayi `.plbp` = abhi ka snapshot; static/EXE/APK par SQLite primary, web par Firestore merge.
    const backupData: Record<string, unknown> = {
      companyDetails,
    };

    for (const colName of COLLECTIONS_TO_BACKUP) {
      throwIfAborted();
      onProgress({
        phase: "Reading data",
        detail: preferLocalSnapshot
          ? `Local SQLite: ${colName.replace(/_/g, " ")}…`
          : `Collection: ${colName.replace(/_/g, " ")}…`,
      });
      const localRows = (await listCompanyDocsFromBrowserDb(companyId, colName, {
        forBackupMerge: true,
      })) as Array<Record<string, unknown> & { id: string }>;

      // Local-only / static: device SQLite primary. Firestore supplement sirf online_merge pe.
      if (preferLocalSnapshot) {
        const needsFirestoreSupplement =
          !localOnlySource &&
          onlineForBackup &&
          Boolean(fsCompanyId) &&
          (FIRESTORE_SUPPLEMENT_COLLECTIONS.has(colName) || MASTER_COLLECTIONS_WITH_OPENING.has(colName));
        if (needsFirestoreSupplement) {
          let fsRows: Array<Record<string, unknown> & { id: string }> = [];
          try {
            fsRows = await fetchSubcollectionAllDocsPaginated(fsCompanyId, colName);
          } catch {
            fsRows = [];
          }
          backupData[colName] = mergeFirestoreRowsWithLocalMirrorForBackup(fsRows, localRows, colName, {
            localPrimary: true,
          });
        } else {
          backupData[colName] = localRows;
        }
        continue;
      }

      let fsRows: Array<Record<string, unknown> & { id: string }> = [];
      if (onlineForBackup && fsCompanyId) {
        try {
          fsRows = await fetchSubcollectionAllDocsPaginated(fsCompanyId, colName);
        } catch {
          fsRows = [];
        }
      } else if (!localOnlyBackup && !localOnlySource) {
        try {
          fsRows = await fetchSubcollectionAllDocsPaginated(fsCompanyId, colName);
        } catch {
          fsRows = [];
        }
      }

      if (localRows.length > 0) {
        backupData[colName] = mergeFirestoreRowsWithLocalMirrorForBackup(fsRows, localRows, colName);
      } else {
        backupData[colName] = fsRows;
      }
    }

    // FY-scoped backup: omit vouchers outside the FY range; earlier closings -> master openings (file only).
    let fyScopeFileSuffix: string | null = null;
    if (fyScope && fyScope !== "all") {
      throwIfAborted();
      onProgress({ phase: "Reading data", detail: "Applying FY range (carrying forward opening balances)..." });
      const { applyBackupFyScopeToBackupData } = await import("@/lib/backupFyScopeRewrite");
      const fyResult = applyBackupFyScopeToBackupData(backupData, {
        scope: fyScope,
        country: (company as { country?: string | null }).country ?? null,
      });
      if (fyResult.ok === false) return { ok: false, error: fyResult.error };
      if (fyResult.applied) fyScopeFileSuffix = fyResult.fileNameSuffix;
    }

    let savedWithAttachments = false;
    let attachmentRefCount = 0;
    let attachmentEmbeddedCount = 0;
    if (includeAttachments) {
      let workingData: Record<string, unknown> = backupData;
      let refs = collectAttachmentRefsFromBackupData(workingData);
      attachmentRefCount = refs.length;

      throwIfAborted();
      onProgress({
        phase: "Reading previous backup",
        detail: "Checking backup folder for reusable attachment files…",
      });
      const incremental = await loadIncrementalAttachmentCacheFromBackupLocation({
        companyId,
        companyPassword: encryptionPassword,
        companyName: company.name,
      });
      const mergeSummary = summarizeIncrementalAttachmentMerge(refs, incremental.cache);
      const refsNeedingDownload = refsMissingFromIncrementalCache(refs, incremental.cache);
      if (incremental.sourceFileName || mergeSummary.reusedCount > 0 || mergeSummary.excludedRemovedCount > 0) {
        onProgress({
          phase: "Reading previous backup",
          detail: formatIncrementalMergeProgressDetail({
            sourceFileName: incremental.sourceFileName,
            reusedCount: mergeSummary.reusedCount,
            newDownloadCount: mergeSummary.newDownloadCount,
            excludedRemovedCount: mergeSummary.excludedRemovedCount,
          }),
        });
      }

      const wantDownload = attachmentMissingPolicy === "download_missing";
      if (refsNeedingDownload.length > 0) {
        if (wantDownload) {
          const preferLocal = backupPrefersLocalSnapshot();
          onProgress({
            phase: onlineForBackup ? "Syncing with server" : "Checking attachments",
            detail: onlineForBackup
              ? "Downloading missing attachment files…"
              : "Checking attachment files…",
            done: 0,
            total: refs.length,
          });
          const preflight = await preflightBackupAttachmentsBeforeEmbed({
            backupData: workingData,
            incrementalCache: incremental.cache,
            signal,
            skipOnlineAttachmentFetch: !onlineForBackup,
            companyId,
            onProgress: ({ done, total, detail }) => {
              onProgress({
                phase: onlineForBackup ? "Syncing with server" : "Checking attachments",
                detail,
                done,
                total,
              });
            },
          });
          if (preflight.missingRefs.length > 0) {
            return {
              ok: false,
              error: formatBackupAttachmentPreflightError(
                preflight.missingRefs.length,
                preflight.totalRefs,
                preferLocal || !onlineForBackup
              ),
            };
          }
        } else {
          // local_only policy: device pe jo hai embed.
          // for_offline → missing URLs strip (portable). for_online → missing URLs rehne do.
          onProgress({
            phase: "Checking attachments",
            detail: "Checking local / pending attachment files…",
            done: 0,
            total: refs.length,
          });
          const localScan = await scanLocalAttachmentAvailabilityForBackup(
            workingData,
            signal,
            (done, total) => {
              onProgress({
                phase: "Checking attachments",
                detail: "Checking local / pending attachment files…",
                done,
                total,
              });
            },
            { companyId }
          );
          if (localScan.missing.length > 0) {
            if (offlineIntent) {
              workingData = stripListedAttachmentRefsFromBackupData(workingData, localScan.missing);
              refs = collectAttachmentRefsFromBackupData(workingData);
              attachmentRefCount = localScan.total;
              onProgress({
                phase: "Checking attachments",
                detail: `Continuing with ${localScan.available.length} local file(s); removed ${localScan.missing.length} missing link(s).`,
              });
            } else {
              onProgress({
                phase: "Checking attachments",
                detail: `Embedding ${localScan.available.length} local file(s); keeping ${localScan.missing.length} link(s) as URLs.`,
              });
            }
          }
        }
      }

      const attachmentStartedMs = Date.now();
      let attachmentBytesTotal = 0;
      let lastSpeedSampleMs = attachmentStartedMs;
      let lastSpeedSampleBytes = 0;
      onProgress({
        phase: "Collecting attachments",
        detail:
          !wantDownload || localOnlySource
            ? mergeSummary.reusedCount > 0
              ? `Local device: reusing ${mergeSummary.reusedCount} file(s) from previous backup folder…`
              : refs.length
                ? "Reading local / pending attachment files…"
                : "No local attachment files to embed"
            : mergeSummary.reusedCount > 0 || mergeSummary.excludedRemovedCount > 0
              ? formatIncrementalMergeProgressDetail({
                  sourceFileName: incremental.sourceFileName,
                  reusedCount: mergeSummary.reusedCount,
                  newDownloadCount: mergeSummary.newDownloadCount,
                  excludedRemovedCount: mergeSummary.excludedRemovedCount,
                })
              : refs.length
                ? "Starting…"
                : "No attachment refs found",
        done: 0,
        total: refs.length,
        speedMbps: 0,
        speedLabel: undefined,
      });
      const bundle = await buildAttachmentZipFromRefs(
        refs,
        (done, total, bytesAdded) => {
          attachmentBytesTotal += bytesAdded;
          const now = Date.now();
          const elapsedMs = now - attachmentStartedMs;
          const windowMs = now - lastSpeedSampleMs;
          const windowBytes = attachmentBytesTotal - lastSpeedSampleBytes;
          const instantMbps =
            windowMs >= 80 && windowBytes > 0 ? bytesPerSecToMbps(windowBytes, windowMs) : undefined;
          const speedMbps = bytesPerSecToMbps(attachmentBytesTotal, elapsedMs);
          const speedLabel = formatBackupThroughputLabel({
            bytesTotal: attachmentBytesTotal,
            elapsedMs,
            filesDone: done,
            instantMbps,
          });
          lastSpeedSampleMs = now;
          lastSpeedSampleBytes = attachmentBytesTotal;
          const remainingLabel = estimateRemainingFromFilePace(done, total, elapsedMs);
          onProgress({
            phase: "Collecting attachments",
            detail: "",
            done,
            total,
            speedMbps,
            speedLabel,
            remainingLabel,
          });
        },
        signal,
        {
          previousCache: incremental.cache,
          skipDiskWrite: !usesEmbeddedNativeAttachmentStorage(),
          companyId,
          galleryUrls: refs,
        }
      );
      workingData.backupVersion = 3;
      attachmentEmbeddedCount = bundle.manifest.entries.length;
      Object.assign(backupData, workingData);

      if (bundle.manifest.entries.length) {
        let payloadData: Record<string, unknown>;
        if (offlineIntent) {
          const offlinePrepared = prepareBackupDataForOfflineFileBackup(workingData, bundle.manifest);
          payloadData = {
            ...offlinePrepared.backupData,
            attachmentZipManifest: offlinePrepared.manifest,
            includesAttachments: true,
          };
        } else {
          payloadData = {
            ...workingData,
            attachmentZipManifest: bundle.manifest,
            includesAttachments: true,
            backupIntent: "for_online",
            backupOfflineFiles: false,
          };
        }
        savedWithAttachments = true;

        throwIfAborted();
        onProgress({ phase: "Compressing", detail: "Building compressed zip…" });
        const zipBytes = packPlbpZipBackup(
          { ...payloadData, backupEncrypted: Boolean(encryptionPassword) },
          bundle.files
        );

        let blob: Blob;
        if (encryptionPassword) {
          onProgress({ phase: "Encrypting", detail: "Securing backup with company password…" });
          const finalDataString = await encryptBytes(zipBytes, encryptionPassword);
          blob = new Blob([finalDataString], { type: "application/octet-stream" });
        } else {
          onProgress({ phase: "Saving", detail: "Writing unencrypted backup…" });
          const zipBlobBytes = new ArrayBuffer(zipBytes.byteLength);
          new Uint8Array(zipBlobBytes).set(zipBytes);
          blob = new Blob([zipBlobBytes], { type: "application/zip" });
        }

        const fileName = appendFyScopeToBackupFileName(buildCompanyBackupFileName(
          String(company.name || companyId),
          new Date(),
          folderDateSystem,
          backupFileRunKind
        ), fyScopeFileSuffix);
        onProgress({ phase: "Saving", detail: "Writing backup file…" });
        const saved = await saveBackupBlobWithBestEffort(blob, fileName, {
          relativeDir: resolvedRelativeDir,
        });

        if (!localOnlySource && !offlineIntent) {
          await incrementAttachmentBackupUsage(ownerUid);
        }

        onProgress({ phase: "Complete", detail: `Saved: ${saved.where}` });
        return {
          ok: true,
          where: saved.where,
          includeAttachments: savedWithAttachments,
          attachmentRefCount,
          attachmentEmbeddedCount,
        };
      }

      // local_only continue: sab missing strip ho gaye / koi bytes nahi — data-only with stripped URLs OK.
      if (!wantDownload) {
        workingData.includesAttachments = false;
        Object.assign(backupData, workingData);
      } else if (refs.length > 0) {
        return {
          ok: false,
          error: formatBackupAttachmentPreflightError(
            refs.length,
            refs.length,
            backupPrefersLocalSnapshot() || localOnlySource
          ),
        };
      } else {
        // download path, no refs — allow data-only
        backupData.includesAttachments = false;
      }
    } else {
      backupData.backupVersion = 3;
      backupData.includesAttachments = false;
    }

    const backupPayload = offlineIntent
      ? prepareBackupDataForOfflineIntent(backupData)
      : { ...backupData, backupIntent: "for_online" as const, backupOfflineFiles: false };
    backupPayload.backupEncrypted = Boolean(encryptionPassword);

    throwIfAborted();
    onProgress({ phase: "Preparing file", detail: "Serializing backup data…" });
    let jsonData: string;
    try {
      jsonData = JSON.stringify(backupPayload);
    } catch {
      return { ok: false, error: "Data too large or invalid to prepare for backup." };
    }

    let blob: Blob;
    if (encryptionPassword) {
      onProgress({ phase: "Encrypting", detail: "Securing backup with company password…" });
      const finalDataString = await encryptData(jsonData, encryptionPassword);
      blob = new Blob([finalDataString], { type: "application/octet-stream" });
    } else {
      onProgress({ phase: "Saving", detail: "Writing unencrypted backup…" });
      blob = new Blob([jsonData], { type: "application/json" });
    }

    const fileName = appendFyScopeToBackupFileName(buildCompanyBackupFileName(
      String(company.name || companyId),
      new Date(),
      folderDateSystem,
      backupFileRunKind
    ), fyScopeFileSuffix);
    onProgress({ phase: "Saving", detail: "Writing backup file…" });
    const saved = await saveBackupBlobWithBestEffort(blob, fileName, {
      relativeDir: resolvedRelativeDir,
    });

    if (savedWithAttachments && !localOnlySource && !offlineIntent) {
      await incrementAttachmentBackupUsage(ownerUid);
    }

    onProgress({ phase: "Complete", detail: `Saved: ${saved.where}` });
    return {
      ok: true,
      where: saved.where,
      includeAttachments: savedWithAttachments,
      attachmentRefCount: includeAttachments ? attachmentRefCount : undefined,
      attachmentEmbeddedCount: includeAttachments ? attachmentEmbeddedCount : undefined,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Backup cancelled.", cancelled: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Unexpected backup error." };
  }
}

/** Backup UI: SQLite snapshot pe local/pending vs missing attachment scan (network bina). */
export async function scanSqliteBackupAttachmentGaps(options: {
  companyId: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ total: number; availableCount: number; missingCount: number; missing: string[] }> {
  const backupData: Record<string, unknown> = {};
  for (const colName of COLLECTIONS_TO_BACKUP) {
    if (options.signal?.aborted) throw new DOMException("Backup cancelled", "AbortError");
    backupData[colName] = (await listCompanyDocsFromBrowserDb(options.companyId, colName, {
      forBackupMerge: true,
    })) as Array<Record<string, unknown> & { id: string }>;
  }
  const scan = await scanLocalAttachmentAvailabilityForBackup(
    backupData,
    options.signal,
    options.onProgress,
    { companyId: options.companyId }
  );
  return {
    total: scan.total,
    availableCount: scan.available.length,
    missingCount: scan.missing.length,
    missing: scan.missing,
  };
}
