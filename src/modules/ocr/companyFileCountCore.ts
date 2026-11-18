/**
 * Company Doc file-count rules, shared by the client fallback and tests.
 * Keep in sync with PocketLedger-Server sub-server/pb_hooks/lib/company_file_count.js
 *
 * Count = number of attachment URLs on ALIVE vouchers (manual + OCR), all FYs.
 * Same rule as getVoucherAttachmentUrlsForUi:
 *   - use fileUrls (array or non-empty string)
 *   - if that yields no urls, AND fileUrls is not an explicit empty array,
 *     fall back to legacy unassignedFile.url
 * Unassigned / duplicate gallery files that are not attached to a voucher
 * are not counted (those have their own Gallery badges).
 */

import { getVoucherAttachmentUrlsForUi } from "@/lib/voucherAttachmentNormalize";

export function isAliveVoucherForFileCount(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.isDeleted === true || row.deleted === true || row._pbHardDeleted === true) return false;
  return true;
}

/** Same attachment count the Company Doc badge used locally. */
export function countVoucherAttachmentFiles(
  row: { fileUrls?: unknown; unassignedFile?: unknown } | null | undefined
): number {
  return getVoucherAttachmentUrlsForUi(row).length;
}

export function countCompanyVoucherFiles(rows: Array<Record<string, unknown> | null | undefined>): number {
  let total = 0;
  for (const row of rows) {
    if (!isAliveVoucherForFileCount(row as Record<string, unknown> | null)) continue;
    total += countVoucherAttachmentFiles(row);
  }
  return total;
}

/**
 * Count from the fields the server SQL extracts (not the full voucher JSON).
 * fileUrlsType is SQLite json_type(data, '$.fileUrls'): array | text | object | null | integer | real | true | false,
 * or null/undefined when the key is missing.
 */
export function countFilesFromExtractedFields(
  fileUrls: unknown,
  fileUrlsType: string | null | undefined,
  unassignedFileUrl: unknown
): number {
  const type = fileUrlsType == null ? "" : String(fileUrlsType);
  const explicitEmptyArray = type === "array" && Array.isArray(fileUrls) && fileUrls.length === 0;
  const urls = normalizeExtractedFileUrls(fileUrls);
  if (urls.length > 0) return urls.length;
  if (explicitEmptyArray) return 0;
  const uf = String(unassignedFileUrl || "").trim();
  return uf ? 1 : 0;
}

function normalizeExtractedFileUrls(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  }
  if (typeof val === "string") {
    const s = val.trim();
    // SQL json_extract may return a JSON-encoded array/string.
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        return normalizeExtractedFileUrls(JSON.parse(s));
      } catch {
        /* fall through and treat as a single url */
      }
    }
    return s ? [s] : [];
  }
  return [];
}
