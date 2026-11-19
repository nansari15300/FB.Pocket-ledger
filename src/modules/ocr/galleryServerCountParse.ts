/** Pure parsers for Gallery / company-file-count hook responses. No network. */

/** Accept a finite non-negative integer only. Reject null, "", undefined, booleans. */
export function asTrustedCount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }
  return null;
}

export type GalleryServerCounts = {
  unassigned: number;
  duplicate: number;
  autoPostFailed: number;
  companyFiles: number;
};

/** Trust badge numbers only when the hook says ok:true and every field is a valid count. */
export function parseGalleryServerCounts(raw: unknown): GalleryServerCounts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid gallery counts");
  }
  const row = raw as Record<string, unknown>;
  if (row.ok !== true) throw new Error("invalid gallery counts");
  const unassigned = asTrustedCount(row.unassigned);
  const duplicate = asTrustedCount(row.duplicate);
  const autoPostFailed = asTrustedCount(row.autoPostFailed);
  const companyFiles = asTrustedCount(row.companyFiles);
  if (unassigned == null || duplicate == null || autoPostFailed == null || companyFiles == null) {
    throw new Error("invalid gallery counts");
  }
  return { unassigned, duplicate, autoPostFailed, companyFiles };
}

/** Trust fileCount only when the hook says ok:true and the number is valid. */
export function parseCompanyFileCount(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid file count");
  }
  const row = raw as { ok?: unknown; fileCount?: unknown };
  if (row.ok !== true) throw new Error("invalid file count");
  const count = asTrustedCount(row.fileCount);
  if (count == null) throw new Error("invalid file count");
  return count;
}
