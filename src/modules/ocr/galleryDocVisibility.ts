/** Shared Gallery document visibility / count rules for Unassigned, Duplicate, and Auto post failed. */

export type GalleryDocumentListMode = "unassigned" | "duplicate" | "auto-failed";

export type GalleryDocLike = {
  id?: unknown;
  isDeleted?: unknown;
  deleted?: unknown;
  _pbHardDeleted?: unknown;
  status?: unknown;
  autoOcrStatus?: unknown;
  uploadedAt?: unknown;
};

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** Rows without uploadedAt are dropped by the Gallery list's orderBy and must not be counted. */
export function hasGalleryUploadedAt(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    return lower !== "null" && lower !== "undefined";
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof (o as { toMillis?: unknown }).toMillis === "function") return true;
    if (typeof (o as { toDate?: unknown }).toDate === "function") return true;
    if (typeof o.seconds === "number" && Number.isFinite(o.seconds)) return true;
    if (typeof o._seconds === "number" && Number.isFinite(o._seconds as number)) return true;
    if (typeof o.iso === "string" && o.iso.trim()) return true;
    return false;
  }
  return false;
}

export function isGalleryDocumentVisibleInMode(
  file: GalleryDocLike,
  mode: GalleryDocumentListMode,
  options?: { requireUploadedAt?: boolean }
): boolean {
  if (isTruthyFlag(file.isDeleted) || isTruthyFlag(file.deleted) || isTruthyFlag(file._pbHardDeleted)) return false;
  if (String(file.status || "").trim() === "ASSIGNED") return false;
  if (options?.requireUploadedAt !== false && !hasGalleryUploadedAt(file.uploadedAt)) return false;
  const autoOcrStatus = String(file.autoOcrStatus || "");
  if (mode === "auto-failed") return autoOcrStatus === "failed";
  if (mode === "unassigned") return autoOcrStatus !== "failed";
  return true;
}

export function countVisibleGalleryDocs(
  docs: readonly GalleryDocLike[],
  mode: GalleryDocumentListMode,
  options?: { requireUploadedAt?: boolean }
): number {
  let n = 0;
  for (const doc of docs) {
    if (isGalleryDocumentVisibleInMode(doc, mode, options)) n += 1;
  }
  return n;
}

export type GalleryBadgeCounts = {
  unassigned: number;
  duplicate: number;
  autoPostFailed: number;
  companyFiles: number;
};

export function countGalleryBadgeDocs(input: {
  unassignedDocs: readonly GalleryDocLike[];
  duplicateDocs: readonly GalleryDocLike[];
  companyFiles: number;
}): GalleryBadgeCounts {
  return {
    unassigned: countVisibleGalleryDocs(input.unassignedDocs, "unassigned"),
    autoPostFailed: countVisibleGalleryDocs(input.unassignedDocs, "auto-failed"),
    duplicate: countVisibleGalleryDocs(input.duplicateDocs, "duplicate"),
    companyFiles: Math.max(0, Math.floor(Number(input.companyFiles) || 0)),
  };
}