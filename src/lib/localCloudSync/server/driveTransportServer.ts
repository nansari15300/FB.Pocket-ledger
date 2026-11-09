import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";
import { createGoogleOAuth2Client } from "@/lib/server/googleOAuthCredentials";
import { ensureHostingConfig } from "@/lib/server/hostingConfig";
import { serverDb } from "@/lib/server/appDb";
import type { CloudSyncManifest, LocalCloudSyncOperation } from "@/lib/localCloudSync/types";
import type { DriveSharedCompanyListItem } from "@/lib/localCloudSync/types";
import {
  LEGACY_DRIVE_SYNC_ROOT,
  POCKET_LEDGER_DRIVE_BRANCH,
  POCKET_LEDGER_DRIVE_ROOT,
  branchRelativePathFromPocketLedgerRemotePath,
  buildPocketLedgerDriveRelativePath,
  legacyDriveCompanyFolderSegment,
  pocketLedgerCompanyFolderSegment,
  pocketLedgerCompanyFolderSegmentCandidates,
  pocketLedgerDriveBackupFileName,
  parsePocketLedgerCompanyFolderSegment,
  DRIVE_ENCRYPTED_FILE_SUFFIX,
  logicalPathFromDriveStoragePath,
  type PocketLedgerDriveCompanyRef,
} from "@/lib/localCloudSync/pocketLedgerDrivePaths";

/** googleapis `media.body` — plain string/Buffer fail; Readable stream with `.pipe()` required. */
function driveMediaBody(data: Buffer | string): Readable {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const stream = new Readable();
  stream._read = () => {};
  stream.push(buf);
  stream.push(null);
  return stream;
}

type DriveTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
};

const ensureFolderLocks = new Map<string, Promise<string>>();

function isDriveDuplicateShareError(e: unknown): boolean {
  const err = e as { code?: number; message?: string; errors?: Array<{ reason?: string }> };
  if (err?.errors?.some((x) => x.reason === "duplicate")) return true;
  const msg = String(err?.message || e || "").toLowerCase();
  return msg.includes("already has access") || msg.includes("duplicate") || err?.code === 409;
}

/** Shared company folder pehchan — data / opening / attachments me se koi branch ho. */
async function looksLikePocketLedgerCompanyFolder(
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<boolean> {
  for (const branch of ["data", "opening", "attachments"] as const) {
    const childId = await findChildFolder(drive, folderId, POCKET_LEDGER_DRIVE_BRANCH[branch]);
    if (childId) return true;
  }
  return false;
}

async function loadDriveTokens(uid: string): Promise<DriveTokens> {
  await ensureHostingConfig(); // oauthClient() below needs the client id / secret
  const { serverDb } = await import("@/lib/server/appDb");
  const db = serverDb();
  const snap = await db.collection("user_tokens").doc(uid).collection("google").doc("drive").get();
  if (!snap.exists) throw new Error("Google Drive not connected");
  const d = snap.data() as Record<string, unknown>;
  const accessToken = String(d.accessToken || "");
  if (!accessToken) throw new Error("Google Drive access token missing");
  return {
    accessToken,
    refreshToken: d.refreshToken ? String(d.refreshToken) : null,
    expiryDate: typeof d.expiryDate === "number" ? d.expiryDate : null,
  };
}

function oauthClient(tokens: DriveTokens) {
  const client = createGoogleOAuth2Client(google);
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
    expiry_date: tokens.expiryDate ?? undefined,
  });
  return client;
}

function opFileName(opSeq: number): string {
  return `op_${String(opSeq).padStart(6, "0")}.json`;
}

function toCompanyRef(
  companyId: string,
  companyName?: string,
  driveSharedFolderId?: string
): PocketLedgerDriveCompanyRef {
  return {
    companyId,
    companyName: companyName?.trim() || undefined,
    driveSharedFolderId: driveSharedFolderId?.trim() || undefined,
  };
}

async function findChildFolder(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string
): Promise<string | null> {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: "files(id,name,createdTime)",
    pageSize: 100,
    orderBy: "createdTime",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files ?? [];
  if (files.length === 0) return null;
  if (files.length === 1) return files[0]?.id ?? null;

  // Duplicate folders (race / parallel ensure) — canonical: pehla jisme manifest ho (data), warna sabse purana.
  if (name === POCKET_LEDGER_DRIVE_BRANCH.data) {
    for (const f of files) {
      if (!f.id) continue;
      const manifest = await readJsonFileByName(drive, f.id, "manifest.json");
      if (manifest) return f.id;
    }
  }
  return files[0]?.id ?? null;
}

async function ensureFolder(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string
): Promise<string> {
  const lockKey = `${parentId}\n${name}`;
  const existingLock = ensureFolderLocks.get(lockKey);
  if (existingLock) return existingLock;
  const run = (async () => {
    let existing = await findChildFolder(drive, parentId, name);
    if (existing) return existing;

    try {
      await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
        supportsAllDrives: true,
      });
    } catch {
      /* concurrent create — canonical folder neeche resolve */
    }

    // Drive list eventual consistency + parallel create: dubara dhoondho, naya mat banao.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
      }
      existing = await findChildFolder(drive, parentId, name);
      if (existing) return existing;
    }

    throw new Error(`Failed to ensure Drive folder "${name}" under ${parentId}`);
  })();
  ensureFolderLocks.set(lockKey, run);
  try {
    return await run;
  } finally {
    ensureFolderLocks.delete(lockKey);
  }
}

/** `Pocket Ledger/` root — naya unified layout. */
async function ensurePocketLedgerRoot(drive: ReturnType<typeof google.drive>): Promise<string> {
  return ensureFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
}

/** `Pocket Ledger/{CompanyName__suffix}/` — joined user par sirf shared company folder id. */
async function resolveCompanyRootFolderId(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef,
  mode: "ensure" | "find"
): Promise<string | null> {
  if (ref.driveSharedFolderId) return ref.driveSharedFolderId;
  const rootId =
    mode === "ensure"
      ? await ensurePocketLedgerRoot(drive)
      : await findChildFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  if (!rootId) return null;
  const candidates = pocketLedgerCompanyFolderSegmentCandidates(ref);
  for (const seg of candidates) {
    const existing = await findChildFolder(drive, rootId, seg);
    if (existing) return existing;
  }
  if (mode === "find") return null;
  return ensureFolder(drive, rootId, candidates[0]!);
}

async function ensureCompanyRootFolder(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef
): Promise<string> {
  const id = await resolveCompanyRootFolderId(drive, ref, "ensure");
  if (!id) throw new Error("Failed to resolve Pocket Ledger company folder");
  return id;
}

/** Company ke andar branch: backup | data | attachments */
async function ensureCompanyBranchFolder(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef,
  branch: keyof typeof POCKET_LEDGER_DRIVE_BRANCH
): Promise<string> {
  const companyFolderId = await ensureCompanyRootFolder(drive, ref);
  return ensureFolder(drive, companyFolderId, POCKET_LEDGER_DRIVE_BRANCH[branch]);
}

/** Live sync: `.../data/ops/` */
async function ensureCompanyDataOpsFolder(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef
): Promise<string> {
  const dataFolderId = await ensureCompanyBranchFolder(drive, ref, "data");
  return ensureFolder(drive, dataFolderId, "ops");
}

/** Purana layout folder — sirf read fallback. */
async function findLegacyCompanyFolder(
  drive: ReturnType<typeof google.drive>,
  companyId: string
): Promise<string | null> {
  const legacyRootId = await findChildFolder(drive, "root", LEGACY_DRIVE_SYNC_ROOT);
  if (!legacyRootId) return null;
  return findChildFolder(drive, legacyRootId, legacyDriveCompanyFolderSegment(companyId));
}

async function readJsonFileByName(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  fileName: string
): Promise<Record<string, unknown> | null> {
  const q = `'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  const fileId = list.data.files?.[0]?.id;
  if (!fileId) return null;
  const media = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  const text = typeof media.data === "string" ? media.data : JSON.stringify(media.data);
  return JSON.parse(text) as Record<string, unknown>;
}

async function findCompanyRootFolder(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef
): Promise<string | null> {
  return resolveCompanyRootFolderId(drive, ref, "find");
}

/** Branch folder sirf dhoondho — GET manifest/ops par empty tree mat banao. */
async function findCompanyBranchFolder(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef,
  branch: keyof typeof POCKET_LEDGER_DRIVE_BRANCH
): Promise<string | null> {
  const companyFolderId = await findCompanyRootFolder(drive, ref);
  if (!companyFolderId) return null;
  return findChildFolder(drive, companyFolderId, POCKET_LEDGER_DRIVE_BRANCH[branch]);
}

/** Manifest: pehle naya `data/`, warna legacy company root. */
async function readManifestRaw(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef
): Promise<Record<string, unknown> | null> {
  const dataFolderId = await findCompanyBranchFolder(drive, ref, "data");
  if (dataFolderId) {
    const fromNew = await readJsonFileByName(drive, dataFolderId, "manifest.json");
    if (fromNew) return fromNew;
  }

  const legacyCompanyFolder = await findLegacyCompanyFolder(drive, ref.companyId);
  if (!legacyCompanyFolder) return null;
  return readJsonFileByName(drive, legacyCompanyFolder, "manifest.json");
}

/** Ops folder: naya data/ops ya purana legacy company_{id}/ops. */
async function resolveOpsFolderForRead(
  drive: ReturnType<typeof google.drive>,
  ref: PocketLedgerDriveCompanyRef
): Promise<string | null> {
  const dataFolderId = await findCompanyBranchFolder(drive, ref, "data");
  if (dataFolderId) {
    const newOpsId = await findChildFolder(drive, dataFolderId, "ops");
    if (newOpsId) {
      const q = `'${newOpsId}' in parents and mimeType = 'application/json' and trashed = false`;
      const res = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
      if ((res.data.files ?? []).length > 0) return newOpsId;
    }
  }

  const legacyCompanyFolder = await findLegacyCompanyFolder(drive, ref.companyId);
  if (legacyCompanyFolder) {
    const legacyOps = await findChildFolder(drive, legacyCompanyFolder, "ops");
    if (legacyOps) return legacyOps;
  }

  return null;
}

export async function driveGetManifest(
  uid: string,
  companyId: string,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<CloudSyncManifest> {
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const raw = await readManifestRaw(drive, ref);
  if (!raw) return { latestOp: 0 };
  const dateMode = String(raw.cloudSyncDriveDateFolderMode ?? "").trim().toLowerCase();
  return {
    latestOp: Number(raw.latestOp) || 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
    companyId: typeof raw.companyId === "string" && raw.companyId.trim() ? raw.companyId.trim() : undefined,
    driveShareUsers: Array.isArray(raw.driveShareUsers)
      ? (raw.driveShareUsers as CloudSyncManifest["driveShareUsers"])
      : undefined,
    driveEncryptionSalt:
      typeof raw.driveEncryptionSalt === "string" && raw.driveEncryptionSalt.trim()
        ? raw.driveEncryptionSalt.trim()
        : undefined,
    cloudSyncEncryptDriveData:
      typeof raw.cloudSyncEncryptDriveData === "boolean" ? raw.cloudSyncEncryptDriveData : undefined,
    cloudSyncEncryptDriveFiles:
      typeof raw.cloudSyncEncryptDriveFiles === "boolean" ? raw.cloudSyncEncryptDriveFiles : undefined,
    cloudSyncDriveDateFolderMode:
      dateMode === "bs" || dateMode === "ad" || dateMode === "both"
        ? (dateMode as CloudSyncManifest["cloudSyncDriveDateFolderMode"])
        : undefined,
  };
}

export async function driveUpdateManifest(
  uid: string,
  companyId: string,
  manifest: CloudSyncManifest,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<void> {
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const dataFolderId = await ensureCompanyBranchFolder(drive, ref, "data");
  const body = JSON.stringify({ ...manifest, updatedAt: Date.now() });
  const media = { mimeType: "application/json", body: driveMediaBody(body) };
  const q = `'${dataFolderId}' in parents and name = 'manifest.json' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existingId = list.data.files?.[0]?.id;
  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      media,
    });
    return;
  }
  await drive.files.create({
    requestBody: { name: "manifest.json", parents: [dataFolderId] },
    media,
  });
}

export async function driveUploadOperation(
  uid: string,
  op: LocalCloudSyncOperation | Record<string, unknown>,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<void> {
  const opSeq = Number((op as LocalCloudSyncOperation).opSeq);
  if (!Number.isFinite(opSeq) || opSeq <= 0) {
    throw new Error("Drive upload: opSeq required (encrypted ops me wrapper par bhejo).");
  }
  const ref = toCompanyRef(String((op as LocalCloudSyncOperation).companyId || ""), companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const opsFolder = await ensureCompanyDataOpsFolder(drive, ref);
  const name = opFileName(opSeq);
  const body = JSON.stringify(op);
  const media = { mimeType: "application/json", body: driveMediaBody(body) };
  const q = `'${opsFolder}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existingId = list.data.files?.[0]?.id;
  if (existingId) {
    await drive.files.update({ fileId: existingId, media });
  } else {
    await drive.files.create({
      requestBody: { name, parents: [opsFolder] },
      media,
    });
  }
}

export async function driveDownloadOperations(
  uid: string,
  companyId: string,
  afterOpSeq: number,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<LocalCloudSyncOperation[]> {
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const opsFolder = await resolveOpsFolderForRead(drive, ref);
  if (!opsFolder) return [];
  const q = `'${opsFolder}' in parents and mimeType = 'application/json' and trashed = false`;
  const out: LocalCloudSyncOperation[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id,name)",
      pageSize: 200,
      pageToken,
    });
    const files = res.data.files ?? [];
    for (const f of files) {
      const name = String(f.name || "");
      const m = /^op_(\d+)\.json$/i.exec(name);
      if (!m) continue;
      const seq = Number(m[1]);
      if (!Number.isFinite(seq) || seq <= afterOpSeq) continue;
      if (!f.id) continue;
      const media = await drive.files.get({ fileId: f.id, alt: "media" }, { responseType: "text" });
      const text = typeof media.data === "string" ? media.data : JSON.stringify(media.data);
      out.push(JSON.parse(text) as LocalCloudSyncOperation);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  out.sort((a, b) => a.opSeq - b.opSeq);
  return out;
}

async function upsertBinaryFileInFolder(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  fileName: string,
  body: Buffer,
  mimeType: string
): Promise<void> {
  const q = `'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existingId = list.data.files?.[0]?.id;
  const media = { mimeType, body: driveMediaBody(body) };
  if (existingId) {
    await drive.files.update({ fileId: existingId, media });
    return;
  }
  await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media,
  });
}

/** Remote path ke folder chain walk karke file id — download ke liye. */
async function resolveFileIdByRemotePath(
  drive: ReturnType<typeof google.drive>,
  remotePath: string
): Promise<string | null> {
  const parts = String(remotePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 4 || parts[0] !== POCKET_LEDGER_DRIVE_ROOT) return null;
  const fileName = parts[parts.length - 1]!;
  const folderParts = parts.slice(2, -1);
  let parentId = await findChildFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  if (!parentId) return null;
  parentId = await findChildFolder(drive, parentId, parts[1]!);
  if (!parentId) return null;
  for (const seg of folderParts) {
    const next = await findChildFolder(drive, parentId, seg);
    if (!next) return null;
    parentId = next;
  }
  const q = `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  return list.data.files?.[0]?.id ?? null;
}

/** Attachment / backup bytes upload — parent folders ensure. */
async function ensureNestedFolderChain(
  drive: ReturnType<typeof google.drive>,
  startFolderId: string,
  segments: string[]
): Promise<string> {
  let parentId = startFolderId;
  for (const seg of segments) {
    parentId = await ensureFolder(drive, parentId, seg);
  }
  return parentId;
}

export async function driveUploadBackupFile(
  uid: string,
  companyId: string,
  companyName: string | undefined,
  fileName: string,
  base64: string
): Promise<{ remotePath: string }> {
  const ref = toCompanyRef(companyId, companyName);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const backupFolderId = await ensureCompanyBranchFolder(drive, ref, "backup");
  const buf = Buffer.from(base64, "base64");
  const safeName = fileName.trim() || pocketLedgerDriveBackupFileName(new Date().toISOString().replace(/[:.]/g, "-"));
  await upsertBinaryFileInFolder(drive, backupFolderId, safeName, buf, "application/octet-stream");
  // Latest pointer — restore UI baad me isi se pick kar sake.
  await upsertBinaryFileInFolder(drive, backupFolderId, "latest.plbp", buf, "application/octet-stream");
  return { remotePath: buildPocketLedgerDriveRelativePath(ref, "backup", safeName) };
}

function sanitizeAutoBackupDriveFolderSegment(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "company";
}

type DrivePlbpEntry = { id: string; modifiedTime: string; name: string };

async function collectPlbpFilesInFolder(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  out: DrivePlbpEntry[]
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
      pageSize: 200,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      const name = String(f.name || "");
      const mime = String(f.mimeType || "");
      if (mime === "application/vnd.google-apps.folder") {
        if (f.id) await collectPlbpFilesInFolder(drive, f.id, out);
        continue;
      }
      if (!name.toLowerCase().endsWith(".plbp") || !f.id) continue;
      out.push({
        id: f.id,
        name,
        modifiedTime: String(f.modifiedTime || ""),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}

async function pruneAutoBackupPlbpFiles(
  drive: ReturnType<typeof google.drive>,
  companyFolderId: string,
  keep: number
): Promise<number> {
  const keepN = Math.max(1, Math.min(500, Math.floor(keep) || 1));
  const files: DrivePlbpEntry[] = [];
  await collectPlbpFilesInFolder(drive, companyFolderId, files);
  files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  let pruned = 0;
  for (const f of files.slice(keepN)) {
    try {
      await drive.files.delete({ fileId: f.id });
      pruned++;
    } catch {
      /* skip */
    }
  }
  return pruned;
}

/** Auto backup `.plbp` → custom Drive root folder (company sync alag). */
export async function driveUploadAutoBackupFile(
  uid: string,
  input: {
    mainFolderName: string;
    companyFolderName: string;
    relativeDir: string;
    fileName: string;
    base64: string;
    keepPerCompany: number;
  }
): Promise<{ remotePath: string; pruned: number }> {
  const mainFolder = sanitizeAutoBackupDriveFolderSegment(input.mainFolderName);
  const companyFolder = sanitizeAutoBackupDriveFolderSegment(input.companyFolderName);
  const fileName = String(input.fileName || "").trim() || "backup.plbp";
  const relDir = String(input.relativeDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => sanitizeAutoBackupDriveFolderSegment(s))
    .filter(Boolean);

  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });

  let parentId = await ensureFolder(drive, "root", mainFolder);
  parentId = await ensureFolder(drive, parentId, companyFolder);
  for (const seg of relDir) {
    parentId = await ensureFolder(drive, parentId, seg);
  }

  const buf = Buffer.from(input.base64, "base64");
  await upsertBinaryFileInFolder(drive, parentId, fileName, buf, "application/octet-stream");

  const companyRootId = await findChildFolder(drive, await ensureFolder(drive, "root", mainFolder), companyFolder);
  const pruned = companyRootId ? await pruneAutoBackupPlbpFiles(drive, companyRootId, input.keepPerCompany) : 0;

  const remotePath = [mainFolder, companyFolder, ...relDir, fileName].filter(Boolean).join("/");
  return { remotePath, pruned };
}

export async function driveUploadBinaryAtRemotePath(
  uid: string,
  remotePath: string,
  base64: string,
  contentType = "application/octet-stream"
): Promise<{ remotePath: string }> {
  const parts = String(remotePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 4 || parts[0] !== POCKET_LEDGER_DRIVE_ROOT) {
    throw new Error("Invalid Pocket Ledger path");
  }
  const fileName = parts[parts.length - 1]!;
  const folderParts = parts.slice(1, -1);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  let parentId = await findChildFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  if (!parentId) {
    parentId = await ensureFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  }
  for (const seg of folderParts) {
    parentId = await ensureFolder(drive, parentId, seg);
  }
  const buf = Buffer.from(base64, "base64");
  await upsertBinaryFileInFolder(drive, parentId, fileName, buf, contentType);
  return { remotePath };
}

export type DriveUploadCompanyContext = {
  companyId: string;
  companyName?: string;
  driveSharedFolderId?: string;
};

/** Shared join / owner — bytes company folder ke andar (branch-relative), galat Pocket Ledger sibling mat banao. */
export async function driveUploadBinaryAtCompanyBranchPath(
  uid: string,
  ctx: DriveUploadCompanyContext,
  branchRelativePath: string,
  base64: string,
  contentType = "application/octet-stream"
): Promise<{ remotePath: string }> {
  const rel = String(branchRelativePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (rel.length < 1) throw new Error("Invalid branch relative path");
  const ref = toCompanyRef(ctx.companyId, ctx.companyName, ctx.driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const companyFolderId = await ensureCompanyRootFolder(drive, ref);
  const fileName = rel[rel.length - 1]!;
  let parentId = companyFolderId;
  for (const seg of rel.slice(0, -1)) {
    parentId = await ensureFolder(drive, parentId, seg);
  }
  const buf = Buffer.from(base64, "base64");
  await upsertBinaryFileInFolder(drive, parentId, fileName, buf, contentType);
  const remotePath = [POCKET_LEDGER_DRIVE_ROOT, pocketLedgerCompanyFolderSegment(ref), ...rel].join("/");
  return { remotePath };
}

export async function driveUploadAttachmentFile(
  uid: string,
  remotePath: string,
  base64: string,
  contentType?: string,
  sha256Hex?: string,
  companyContext?: DriveUploadCompanyContext
): Promise<{ remotePath: string; deduped?: boolean }> {
  void sha256Hex;
  const branchRel = companyContext?.companyId
    ? branchRelativePathFromPocketLedgerRemotePath(remotePath)
    : null;
  if (branchRel && companyContext) {
    const res = await driveUploadBinaryAtCompanyBranchPath(
      uid,
      companyContext,
      branchRel,
      base64,
      contentType || "application/octet-stream"
    );
    return { remotePath: res.remotePath };
  }
  const res = await driveUploadBinaryAtRemotePath(uid, remotePath, base64, contentType || "application/octet-stream");
  return { remotePath: res.remotePath };
}

export async function driveDownloadFileByRemotePath(
  uid: string,
  remotePath: string
): Promise<{ base64: string; contentType: string } | null> {
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const fileId = await resolveFileIdByRemotePath(drive, remotePath);
  if (!fileId) return null;
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const media = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(media.data as ArrayBuffer);
  return { base64: buf.toString("base64"), contentType: String(meta.data.mimeType || "application/octet-stream") };
}

/** Shared join — company folder id se branch-relative path (`opening/users/users.json`). */
export async function driveDownloadFileAtCompanyPath(
  uid: string,
  companyId: string,
  companyName: string | undefined,
  driveSharedFolderId: string | undefined,
  branchRelativePath: string
): Promise<{ base64: string; contentType: string } | null> {
  const rel = String(branchRelativePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (rel.length < 2) return null;
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const companyFolderId = await resolveCompanyRootFolderId(drive, ref, "find");
  if (!companyFolderId) return null;
  const fileName = rel[rel.length - 1]!;
  let parentId = companyFolderId;
  for (const seg of rel.slice(0, -1)) {
    const next = await findChildFolder(drive, parentId, seg);
    if (!next) return null;
    parentId = next;
  }
  const q = `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const fileId = list.data.files?.[0]?.id;
  if (!fileId) return null;
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const media = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(media.data as ArrayBuffer);
  return { base64: buf.toString("base64"), contentType: String(meta.data.mimeType || "application/octet-stream") };
}

/** Company root folder staff emails — Drive par hamesha writer (app role alag se manifest/registry me). */
export async function driveShareCompanyFolder(
  uid: string,
  companyId: string,
  companyName: string | undefined,
  users: Array<{ email: string; appRole?: string; role?: string }> | string[]
): Promise<{ shared: string[]; skipped: string[] }> {
  const ref = toCompanyRef(companyId, companyName);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const folderId = await ensureCompanyRootFolder(drive, ref);
  const shared: string[] = [];
  const skipped: string[] = [];
  const rows = Array.isArray(users)
    ? users.map((u) =>
        typeof u === "string"
          ? { email: u }
          : { email: String(u.email || "") }
      )
    : [];
  for (const row of rows) {
    const email = String(row.email || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) {
      skipped.push(String(row.email || ""));
      continue;
    }
    try {
      await drive.permissions.create({
        fileId: folderId,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: email,
        },
        sendNotificationEmail: true,
        supportsAllDrives: true,
      });
      shared.push(email);
    } catch (e) {
      if (isDriveDuplicateShareError(e)) {
        shared.push(email);
        continue;
      }
      skipped.push(email);
    }
  }
  return { shared, skipped };
}

/** Drive folder se user share hatao — delete permission. */
export async function driveRevokeCompanyFolderShare(
  uid: string,
  companyId: string,
  companyName: string | undefined,
  email: string
): Promise<boolean> {
  const ref = toCompanyRef(companyId, companyName);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const folderId = await ensureCompanyRootFolder(drive, ref);
  const target = String(email || "").trim().toLowerCase();
  if (!target) return false;
  const list = await drive.permissions.list({
    fileId: folderId,
    fields: "permissions(id,emailAddress,role)",
  });
  let removed = false;
  for (const p of list.data.permissions ?? []) {
    const em = String(p.emailAddress || "").trim().toLowerCase();
    if (em === target && p.id) {
      await drive.permissions.delete({ fileId: folderId, permissionId: p.id });
      removed = true;
    }
  }
  return removed;
}

/** Backup branch ensure — `.plbp` upload helper (folder id return). */
export async function driveEnsureCompanyBackupFolder(
  uid: string,
  companyId: string,
  companyName?: string
): Promise<string> {
  const ref = toCompanyRef(companyId, companyName);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  return ensureCompanyBranchFolder(drive, ref, "backup");
}

/** User B — Drive par shared-with-me Pocket Ledger company folders (sirf company folder, root nahi). */
export type { DriveSharedCompanyListItem } from "@/lib/localCloudSync/types";

/** Drive company folder → join list row (manifest se canonical companyId). */
async function pocketLedgerCompanyFolderToListItem(
  drive: ReturnType<typeof google.drive>,
  f: { id?: string | null; name?: string | null },
  opts: { sharedByEmail: string; sharedByName?: string; isOwnedOnDrive: boolean }
): Promise<DriveSharedCompanyListItem | null> {
  const name = String(f.name || "");
  const parsed = parsePocketLedgerCompanyFolderSegment(name);
  if (!parsed || !f.id) return null;
  if (!(await looksLikePocketLedgerCompanyFolder(drive, f.id))) return null;
  const dataId = await findChildFolder(drive, f.id, POCKET_LEDGER_DRIVE_BRANCH.data);
  let manifestCompanyId = "";
  if (dataId) {
    const manifestRaw = await readJsonFileByName(drive, dataId, "manifest.json");
    manifestCompanyId =
      typeof manifestRaw?.companyId === "string" && String(manifestRaw.companyId).trim()
        ? String(manifestRaw.companyId).trim()
        : "";
  }
  return {
    driveFolderId: f.id,
    folderName: name,
    companyId: manifestCompanyId || parsed.companyId,
    companyName: parsed.companyName,
    sharedByEmail: opts.sharedByEmail,
    sharedByName: opts.sharedByName,
    isOwnedOnDrive: opts.isOwnedOnDrive,
  };
}

/** Owner — My Drive → Pocket Ledger ke andar synced local company folders. */
export async function driveListOwnedPocketLedgerCompanies(
  uid: string,
  userEmail: string | null
): Promise<DriveSharedCompanyListItem[]> {
  const ownerEmail = String(userEmail || "")
    .trim()
    .toLowerCase();
  if (!ownerEmail) return [];
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const rootId = await findChildFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  if (!rootId) return [];
  const q = `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const out: DriveSharedCompanyListItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id,name)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      const row = await pocketLedgerCompanyFolderToListItem(drive, f, {
        sharedByEmail: ownerEmail,
        isOwnedOnDrive: true,
      });
      if (row) out.push(row);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export async function driveListSharedPocketLedgerCompanies(uid: string): Promise<DriveSharedCompanyListItem[]> {
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const q = `sharedWithMe and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const out: DriveSharedCompanyListItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id,name,sharingUser,owners)",
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      const sharingUser = f.sharingUser as { emailAddress?: string; displayName?: string } | undefined;
      const owner = f.owners?.[0] as { emailAddress?: string; displayName?: string } | undefined;
      const sharedByEmail = String(sharingUser?.emailAddress || owner?.emailAddress || "")
        .trim()
        .toLowerCase();
      if (!sharedByEmail) continue;
      const row = await pocketLedgerCompanyFolderToListItem(drive, f, {
        sharedByEmail,
        sharedByName: sharingUser?.displayName || owner?.displayName,
        isOwnedOnDrive: false,
      });
      if (row) out.push(row);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** Join UI — owned (My Drive) + shared-with-me; folder id duplicate par owned prefer. */
export async function driveListPocketLedgerCompaniesForJoin(
  uid: string,
  userEmail: string | null
): Promise<DriveSharedCompanyListItem[]> {
  const [owned, shared] = await Promise.all([
    driveListOwnedPocketLedgerCompanies(uid, userEmail),
    driveListSharedPocketLedgerCompanies(uid),
  ]);
  const byFolder = new Map<string, DriveSharedCompanyListItem>();
  for (const row of shared) {
    byFolder.set(row.driveFolderId, row);
  }
  for (const row of owned) {
    byFolder.set(row.driveFolderId, row);
  }
  const merged = [...byFolder.values()];
  merged.sort((a, b) => {
    if (a.isOwnedOnDrive !== b.isOwnedOnDrive) return a.isOwnedOnDrive ? -1 : 1;
    return a.companyName.localeCompare(b.companyName);
  });
  return merged;
}

/** JSON / text upsert — company folder ke andar (opening snapshot, encrypted wrappers). */
export async function driveUploadJsonAtCompanyBranchPath(
  uid: string,
  ctx: DriveUploadCompanyContext,
  branchRelativePath: string,
  body: string,
  contentType = "application/json"
): Promise<{ remotePath: string }> {
  const rel = String(branchRelativePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (rel.length < 1) throw new Error("Invalid branch relative path");
  const ref = toCompanyRef(ctx.companyId, ctx.companyName, ctx.driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const companyFolderId = await ensureCompanyRootFolder(drive, ref);
  const fileName = rel[rel.length - 1]!;
  let parentId = companyFolderId;
  for (const seg of rel.slice(0, -1)) {
    parentId = await ensureFolder(drive, parentId, seg);
  }
  const media = { mimeType: contentType, body: driveMediaBody(body) };
  const q = `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existingId = list.data.files?.[0]?.id;
  if (existingId) {
    await drive.files.update({ fileId: existingId, media });
  } else {
    await drive.files.create({
      requestBody: { name: fileName, parents: [parentId] },
      media,
    });
  }
  const remotePath = [POCKET_LEDGER_DRIVE_ROOT, pocketLedgerCompanyFolderSegment(ref), ...rel].join("/");
  return { remotePath };
}

/** JSON / text file upsert — opening snapshot + encrypted wrappers. */
export async function driveUploadJsonAtRemotePath(
  uid: string,
  remotePath: string,
  body: string,
  contentType = "application/json",
  companyContext?: DriveUploadCompanyContext
): Promise<{ remotePath: string }> {
  const branchRel = companyContext?.companyId
    ? branchRelativePathFromPocketLedgerRemotePath(remotePath)
    : null;
  if (branchRel && companyContext) {
    return driveUploadJsonAtCompanyBranchPath(uid, companyContext, branchRel, body, contentType);
  }
  const parts = String(remotePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 4 || parts[0] !== POCKET_LEDGER_DRIVE_ROOT) {
    throw new Error("Invalid Pocket Ledger path");
  }
  const fileName = parts[parts.length - 1]!;
  const folderParts = parts.slice(1, -1);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  let parentId = await findChildFolder(drive, "root", POCKET_LEDGER_DRIVE_ROOT);
  if (!parentId) throw new Error("Pocket Ledger root missing");
  for (const seg of folderParts) {
    parentId = await ensureFolder(drive, parentId, seg);
  }
  const media = { mimeType: contentType, body: driveMediaBody(body) };
  const q = `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existingId = list.data.files?.[0]?.id;
  if (existingId) {
    await drive.files.update({ fileId: existingId, media });
  } else {
    await drive.files.create({
      requestBody: { name: fileName, parents: [parentId] },
      media,
    });
  }
  return { remotePath };
}

export async function driveDeleteFileAtCompanyBranchPath(
  uid: string,
  ctx: DriveUploadCompanyContext,
  branchRelativePath: string
): Promise<boolean> {
  const rel = String(branchRelativePath || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (rel.length < 1) return false;
  const ref = toCompanyRef(ctx.companyId, ctx.companyName, ctx.driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const companyFolderId = await resolveCompanyRootFolderId(drive, ref, "find");
  if (!companyFolderId) return false;
  const fileName = rel[rel.length - 1]!;
  let parentId = companyFolderId;
  for (const seg of rel.slice(0, -1)) {
    const next = await findChildFolder(drive, parentId, seg);
    if (!next) return false;
    parentId = next;
  }
  const q = `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  const fileId = list.data.files?.[0]?.id;
  if (!fileId) return false;
  await drive.files.delete({ fileId, supportsAllDrives: true });
  return true;
}

export async function driveDeleteFileByRemotePath(uid: string, remotePath: string): Promise<void> {
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const fileId = await resolveFileIdByRemotePath(drive, remotePath);
  if (fileId) {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  }
}

/** Company folder ke andar saari files/subfolders — permanent delete se pehle. */
async function deleteDriveFolderRecursive(
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,mimeType)",
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id) continue;
      const mime = String(f.mimeType || "");
      if (mime === "application/vnd.google-apps.folder") {
        await deleteDriveFolderRecursive(drive, f.id);
      } else {
        await drive.files.delete({ fileId: f.id, supportsAllDrives: true });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
}

function isDriveNotFoundError(e: unknown): boolean {
  const err = e as { code?: number; message?: string };
  if (err?.code === 404) return true;
  const msg = String(err?.message || e || "").toLowerCase();
  return msg.includes("not found") || msg.includes("file not found");
}

/** Owner recycle-bin permanent delete — `Pocket Ledger/{Company}/` poora folder Drive se hatao. */
export async function driveDeleteCompanyFolder(
  uid: string,
  companyId: string,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<boolean> {
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const folderId = await resolveCompanyRootFolderId(drive, ref, "find");
  if (!folderId) return false;
  await deleteDriveFolderRecursive(drive, folderId);
  return true;
}

/** Shared user / sync — folder ab accessible hai ya owner ne hata diya. */
export async function driveIsCompanyFolderAccessible(
  uid: string,
  input: {
    driveFolderId?: string;
    companyId?: string;
    companyName?: string;
  }
): Promise<boolean> {
  const folderId = String(input.driveFolderId || "").trim();
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });

  if (folderId) {
    try {
      const res = await drive.files.get({
        fileId: folderId,
        fields: "id,trashed",
        supportsAllDrives: true,
      });
      return res.data.trashed !== true;
    } catch (e) {
      if (isDriveNotFoundError(e)) return false;
      throw e;
    }
  }

  const cid = String(input.companyId || "").trim();
  if (!cid) return false;
  const ref = toCompanyRef(cid, input.companyName, undefined);
  const resolved = await resolveCompanyRootFolderId(drive, ref, "find");
  return !!resolved;
}

async function listFilesRecursive(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  prefixParts: string[],
  out: Array<{ storagePath: string; logicalPath: string; encrypted: boolean }>
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: 200,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      const name = String(f.name || "");
      const mime = String(f.mimeType || "");
      if (mime === "application/vnd.google-apps.folder") {
        if (f.id) {
          await listFilesRecursive(drive, f.id, [...prefixParts, name], out);
        }
        continue;
      }
      if (/^op_\d+\.json$/i.test(name)) continue;
      if (name === "manifest.json") continue;
      const storagePath = [...prefixParts, name].join("/");
      const encrypted = name.endsWith(DRIVE_ENCRYPTED_FILE_SUFFIX);
      const logicalPath = logicalPathFromDriveStoragePath(storagePath);
      out.push({ storagePath, logicalPath, encrypted });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}

/** Force encrypt — plain attachments / opening files list. */
export async function driveListEncryptableFiles(
  uid: string,
  companyId: string,
  companyName?: string,
  driveSharedFolderId?: string
): Promise<Array<{ storagePath: string; logicalPath: string; encrypted: boolean }>> {
  const ref = toCompanyRef(companyId, companyName, driveSharedFolderId);
  const tokens = await loadDriveTokens(uid);
  const auth = oauthClient(tokens);
  const drive = google.drive({ version: "v3", auth });
  const companyFolderId = await resolveCompanyRootFolderId(drive, ref, "find");
  if (!companyFolderId) return [];
  const out: Array<{ storagePath: string; logicalPath: string; encrypted: boolean }> = [];
  const companySeg = pocketLedgerCompanyFolderSegmentCandidates(ref)[0]!;
  for (const branch of ["attachments", "opening"] as const) {
    const branchId = await findChildFolder(drive, companyFolderId, POCKET_LEDGER_DRIVE_BRANCH[branch]);
    if (!branchId) continue;
    await listFilesRecursive(drive, branchId, [POCKET_LEDGER_DRIVE_ROOT, companySeg, branch], out);
  }
  return out;
}
