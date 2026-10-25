"use client";

import { collection } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";

export type CompanyAttachmentCatalogEntry = {
  url: string;
  label: string;
  voucherNumbers: string[];
  voucherCount: number;
};

/** Voucher/file search: ignore spaces, dashes, case — "rcpt 005" matches "RCPT - 005". */
function compactAttachmentSearchText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Common typed prefixes → canonical compact prefix (pymn → pymt, etc.). */
const ATTACHMENT_SEARCH_PREFIX_ALIASES: Record<string, string> = {
  pymn: "pymt",
  pymnt: "pymt",
  pymt: "pymt",
  rcpt: "rcpt",
  pymtout: "pymt",
};

function attachmentSearchTokenVariants(token: string): string[] {
  const t = compactAttachmentSearchText(token);
  if (!t) return [];
  const whole = ATTACHMENT_SEARCH_PREFIX_ALIASES[t];
  if (whole) return whole === t ? [t] : [t, whole];

  const alpha = t.match(/^[a-z]+/)?.[0] ?? "";
  if (alpha.length >= 3) {
    const canon =
      ATTACHMENT_SEARCH_PREFIX_ALIASES[alpha.slice(0, 4)] ?? ATTACHMENT_SEARCH_PREFIX_ALIASES[alpha.slice(0, 3)];
    if (canon && canon !== alpha) {
      return [t, canon + t.slice(alpha.length)];
    }
  }
  return [t];
}

function attachmentSearchTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => compactAttachmentSearchText(part))
    .filter(Boolean);
}

function compactQuerySearchVariants(compact: string): string[] {
  if (!compact) return [];
  const variants = new Set<string>([compact]);
  const m = compact.match(/^([a-z]{3,8})(\d.*)$/);
  if (m) {
    const [, prefix, rest] = m;
    const canon =
      ATTACHMENT_SEARCH_PREFIX_ALIASES[prefix] ??
      ATTACHMENT_SEARCH_PREFIX_ALIASES[prefix.slice(0, 4)] ??
      ATTACHMENT_SEARCH_PREFIX_ALIASES[prefix.slice(0, 3)];
    if (canon) variants.add(canon + rest);
  }
  return [...variants];
}

function haystackMatchesTokens(haystack: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  return tokens.every((token) => {
    const variants = attachmentSearchTokenVariants(token);
    return variants.some((v) => haystack.includes(v));
  });
}

/** Flexible match on file label and voucher numbers (type + no, spaces/dashes optional). */
export function matchesCompanyAttachmentCatalogSearch(
  entry: Pick<CompanyAttachmentCatalogEntry, "label" | "voucherNumbers">,
  query: string
): boolean {
  const q = query.trim();
  if (!q) return true;

  const tokens = attachmentSearchTokens(q);
  const compactQuery = compactAttachmentSearchText(q);
  const haystacks = [
    compactAttachmentSearchText(entry.label),
    ...entry.voucherNumbers.map(compactAttachmentSearchText),
  ];

  const queryVariants = compactQuerySearchVariants(compactQuery);

  return haystacks.some((h) => {
    if (queryVariants.some((qv) => qv && h.includes(qv))) return true;
    return haystackMatchesTokens(h, tokens);
  });
}

function attachmentLabelFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "Attachment";
  if (isLocalFileRef(trimmed)) return trimmed.slice("local:".length).slice(0, 12) || "Local file";
  if (isDriveFileRef(trimmed)) {
    const path = trimmed.replace(/^drive:/i, "");
    const base = path.split("/").pop() || path;
    return decodeURIComponent(base) || "Drive file";
  }
  const storagePath = tryGetStoragePathFromFirebaseDownloadUrl(trimmed);
  if (storagePath) {
    const base = storagePath.split("/").pop() || storagePath;
    return decodeURIComponent(base) || "Cloud file";
  }
  try {
    const u = new URL(trimmed);
    const base = decodeURIComponent((u.pathname.split("/").pop() || "").split("?")[0] || "");
    if (base && !/^o$/i.test(base)) return base;
  } catch {
    /* fall through */
  }
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed;
}

/** Max distinct attachment URLs in reuse picker (full company scan in memory). */
export const COMPANY_ATTACHMENT_CATALOG_MAX = 5000;

type CatalogSourceRow = {
  fileUrls?: unknown;
  documentFileUrls?: unknown;
  fileUrl?: unknown;
  logoUrl?: unknown;
  avatarUrl?: unknown;
  unassignedFile?: unknown;
  voucherNumber?: unknown;
  type?: unknown;
  name?: unknown;
  label?: unknown;
};

function pushUrlUsage(
  byUrl: Map<string, { numbers: Set<string> }>,
  urlRaw: unknown,
  placeLabel: string,
  exclude: ReadonlySet<string>
): void {
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const url = value.trim();
      if (!url || exclude.has(url)) return;
      if (
        !(
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          isLocalFileRef(url) ||
          isDriveFileRef(url)
        )
      ) {
        return;
      }
      const row = byUrl.get(url) ?? { numbers: new Set<string>() };
      row.numbers.add(placeLabel);
      byUrl.set(url, row);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object" && "url" in (value as object)) {
      visit((value as { url?: unknown }).url);
    }
  };
  visit(urlRaw);
}

/** Distinct attachment refs already on company (vouchers + masters) — in-memory scan. */
export function buildCompanyAttachmentCatalogFromVouchers(
  vouchers: ReadonlyArray<CatalogSourceRow>,
  options?: { excludeUrls?: ReadonlySet<string>; limit?: number }
): CompanyAttachmentCatalogEntry[] {
  const exclude = options?.excludeUrls ?? new Set<string>();
  const limit = Math.max(1, options?.limit ?? COMPANY_ATTACHMENT_CATALOG_MAX);
  const byUrl = new Map<string, { numbers: Set<string> }>();

  for (const v of vouchers) {
    const vn =
      String(v.voucherNumber || v.name || v.label || v.type || "Item").trim() || "Item";
    pushUrlUsage(byUrl, v.fileUrls, vn, exclude);
    pushUrlUsage(byUrl, v.documentFileUrls, vn, exclude);
    pushUrlUsage(byUrl, v.fileUrl, vn, exclude);
    pushUrlUsage(byUrl, v.logoUrl, vn, exclude);
    pushUrlUsage(byUrl, v.avatarUrl, vn, exclude);
    pushUrlUsage(byUrl, v.unassignedFile, vn, exclude);
  }

  const entries: CompanyAttachmentCatalogEntry[] = [];
  for (const [url, { numbers }] of byUrl) {
    const voucherNumbers = [...numbers].sort((a, b) => a.localeCompare(b));
    entries.push({
      url,
      label: attachmentLabelFromUrl(url),
      voucherNumbers,
      voucherCount: voucherNumbers.length,
    });
  }

  entries.sort((a, b) => {
    if (b.voucherCount !== a.voucherCount) return b.voucherCount - a.voucherCount;
    return a.label.localeCompare(b.label);
  });

  return entries.slice(0, limit);
}

export type CompanyVoucherAttachmentSourceRow = CatalogSourceRow;

/** Reuse picker: company-wide (vouchers + masters) — SQLite pehle, phir Firestore vouchers fallback. */
export async function loadCompanyVoucherAttachmentSources(
  companyId: string
): Promise<CompanyVoucherAttachmentSourceRow[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];

  try {
    const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
    const rows: CompanyVoucherAttachmentSourceRow[] = [];
    for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
      const docs = await listCompanyDocsFromBrowserDb(cid, coll);
      for (const row of docs) {
        rows.push({
          fileUrls: row.fileUrls,
          documentFileUrls: row.documentFileUrls,
          fileUrl: row.fileUrl,
          logoUrl: row.logoUrl,
          avatarUrl: row.avatarUrl,
          unassignedFile: row.unassignedFile,
          voucherNumber: row.voucherNumber,
          type: row.type || coll,
          name: row.name || row.accountName,
          label: coll,
        });
      }
    }
    if (rows.length > 0) return rows;
  } catch {
    /* Firestore try below */
  }

  try {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    if (reg && isOfflineCompanyStorage(reg as { storageOption?: string })) {
      return [];
    }
  } catch {
    /* Firestore try below */
  }

  try {
    const snap = await getDocs(collection(firestore, `companies/${cid}/vouchers`));
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.isDeleted === true) return null;
        return {
          fileUrls: data.fileUrls,
          voucherNumber: data.voucherNumber,
          type: data.type,
        };
      })
      .filter(Boolean) as CompanyVoucherAttachmentSourceRow[];
  } catch {
    return [];
  }
}
