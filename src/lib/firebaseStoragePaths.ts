"use client";

/**
 * Firebase Storage object paths — Pocket Ledger layout.
 *
 * Company root (create + online restore-as-new):
 *   pocket-ledger/{companyId}/…
 *   companyId = `generateCompanyId` → `CompanyName_ba9adb17`
 *
 * Top-level folders (new uploads + restore):
 *   vouchers/{voucherType}/…
 *   avatar/{parties|bank-accounts|staff|items|taxes|expense-accounts}/…
 *   opening/{same master folders}/…     — master opening-row / documentFileUrls (+ item fileUrls)
 *   unassigned/…                       — voucher unassignedFile + restore orphan
 *   company-logo/…
 *
 * Legacy companies (storageLayout !== pocket-ledger-v1) unchanged:
 *   voucher-files/{companyId}/{type}/...
 *   companies/{companyId}/parties-files/avatar/...
 */

export const POCKET_LEDGER_STORAGE_LAYOUT = "pocket-ledger-v1";
export const POCKET_LEDGER_APP_ROOT = "pocket-ledger";

export type CompanyStorageLayoutRow = {
  id?: string;
  storageLayout?: string | null;
  storageRootPrefix?: string | null;
};

export function companyUsesPocketLedgerStorage(
  company: CompanyStorageLayoutRow | null | undefined
): boolean {
  return String(company?.storageLayout || "").trim() === POCKET_LEDGER_STORAGE_LAYOUT;
}

export function pocketLedgerCompanyRoot(companyId: string): string {
  const id = String(companyId || "").trim();
  return `${POCKET_LEDGER_APP_ROOT}/${id}`;
}

/** Firestore + local company row — online create / restore-as-new. */
export function pocketLedgerStorageDocFields(companyId: string): {
  storageLayout: string;
  storageRootPrefix: string;
} {
  const id = String(companyId || "").trim();
  return {
    storageLayout: POCKET_LEDGER_STORAGE_LAYOUT,
    storageRootPrefix: pocketLedgerCompanyRoot(id),
  };
}

export function safeStorageFileName(name: string): string {
  return String(name || "file")
    .trim()
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

const MASTER_COLLECTIONS = new Set([
  "parties",
  "bank_accounts",
  "staff",
  "items",
  "taxes",
  "expense_accounts",
]);

/** avatar/ + opening/ ke under master folder names (entity_type). */
export function masterCollectionFolder(collectionName: string): string {
  const map: Record<string, string> = {
    parties: "parties",
    bank_accounts: "bank-accounts",
    staff: "staff",
    items: "items",
    taxes: "taxes",
    expense_accounts: "expense-accounts",
  };
  const key = String(collectionName || "").trim();
  return map[key] || key.replace(/_/g, "-");
}

function isMasterAvatarField(fieldKey: string): boolean {
  return fieldKey === "fileUrl" || fieldKey === "avatarUrl";
}

function isMasterOpeningOrDocField(fieldKey: string): boolean {
  return (
    fieldKey === "documentFileUrls" ||
    fieldKey === "fileUrls" ||
    fieldKey === "documentFileUrl"
  );
}

export type BuildStoragePathPrefixInput = {
  companyId: string;
  usePocketLedger: boolean;
  collectionName: string;
  fieldKey: string;
  voucherType?: string;
};

/** Pre-restructure pocket-ledger layout: `{master}/avatar`, `{master}/documents`, `logo`. */
export function buildLegacyPocketLedgerStoragePathPrefix(input: BuildStoragePathPrefixInput): string {
  const cid = String(input.companyId || "").trim();
  if (!cid) return "attachments";
  const root = pocketLedgerCompanyRoot(cid);
  const field = String(input.fieldKey || "").trim();

  if (input.collectionName === "vouchers") {
    if (field === "unassignedFile") {
      return `${root}/unassigned`;
    }
    const vt = String(input.voucherType || "journal").trim() || "journal";
    return `${root}/vouchers/${vt}`;
  }
  if (field === "logoUrl" || input.collectionName === "company") {
    return `${root}/logo`;
  }
  if (field === "unassignedFile") {
    return `${root}/unassigned`;
  }
  if (MASTER_COLLECTIONS.has(input.collectionName)) {
    const masterFolder = masterCollectionFolder(input.collectionName);
    if (isMasterAvatarField(field) || field === "logoUrl") {
      return `${root}/${masterFolder}/avatar`;
    }
    return `${root}/${masterFolder}/documents`;
  }
  return `${root}/unassigned`;
}

function buildNonPocketStoragePathPrefix(input: BuildStoragePathPrefixInput): string {
  const cid = String(input.companyId || "").trim();
  if (!cid) return "attachments";
  if (input.collectionName === "vouchers") {
    const voucherType = String(input.voucherType || "journal").trim() || "journal";
    return `voucher-files/${cid}/${voucherType}`;
  }
  if (MASTER_COLLECTIONS.has(input.collectionName)) {
    const seg = input.collectionName.replace(/_/g, "-");
    const sub = isMasterAvatarField(input.fieldKey) ? "avatar" : "documents";
    return `companies/${cid}/${seg}-files/${sub}`;
  }
  if (input.fieldKey === "logoUrl") {
    return `companies/${cid}/logo`;
  }
  return `companies/${cid}/attachments`;
}

/** Prefix without filename — pending upload + scrape requeue + restore. */
export function buildStoragePathPrefix(input: BuildStoragePathPrefixInput): string {
  const cid = String(input.companyId || "").trim();
  if (!cid) return "attachments";

  if (input.usePocketLedger) {
    const root = pocketLedgerCompanyRoot(cid);
    const field = String(input.fieldKey || "").trim();

    if (input.collectionName === "vouchers") {
      if (field === "unassignedFile") {
        return `${root}/unassigned`;
      }
      const vt = String(input.voucherType || "journal").trim() || "journal";
      return `${root}/vouchers/${vt}`;
    }

    if (field === "logoUrl" || input.collectionName === "company") {
      return `${root}/company-logo`;
    }

    if (field === "unassignedFile") {
      return `${root}/unassigned`;
    }

    if (MASTER_COLLECTIONS.has(input.collectionName)) {
      const masterFolder = masterCollectionFolder(input.collectionName);
      if (isMasterAvatarField(field)) {
        return `${root}/avatar/${masterFolder}`;
      }
      if (isMasterOpeningOrDocField(field)) {
        return `${root}/opening/${masterFolder}`;
      }
      // Unknown master field — opening bucket (non-avatar).
      return `${root}/opening/${masterFolder}`;
    }

    return `${root}/unassigned`;
  }

  return buildNonPocketStoragePathPrefix(input);
}

/**
 * Lookup / upload-fallback prefixes — current + pre-restructure pocket paths.
 * Non-pocket `companies/` / `voucher-files/` only when `usePocketLedger` is false.
 */
export function buildStoragePathPrefixCandidates(input: BuildStoragePathPrefixInput): string[] {
  const preferred = buildStoragePathPrefix(input);
  const out: string[] = [];
  const push = (p: string) => {
    const s = String(p || "").trim().replace(/\/+$/, "");
    if (s && !out.includes(s)) out.push(s);
  };
  push(preferred);
  if (input.usePocketLedger) {
    push(buildLegacyPocketLedgerStoragePathPrefix(input));
    // Do NOT fall back to companies/voucher-files for pocket-ledger-v1 —
    // that hid missing Storage rules and put files in the wrong root folder.
  } else {
    push(buildNonPocketStoragePathPrefix({ ...input, usePocketLedger: false }));
  }
  return out;
}

export function buildStorageObjectPath(input: {
  prefix: string;
  fileName: string;
  voucherId?: string;
}): string {
  const prefix = String(input.prefix || "").replace(/\/+$/, "");
  const safe = safeStorageFileName(input.fileName);
  const ts = Date.now();
  const vid = String(input.voucherId || "").trim();
  const leaf = vid ? `${vid}_${ts}_${safe}` : `${ts}_${safe}`;
  return `${prefix}/${leaf}`;
}

/** Pending upload — same id = same object path (retry overwrite, duplicate storage objects avoid). */
export function buildPendingAttachmentStorageObjectPath(input: {
  storagePathPrefix: string;
  pendingFileId: string;
  fileName?: string;
}): string {
  const prefix = String(input.storagePathPrefix || "attachments").replace(/\/+$/, "");
  const id = String(input.pendingFileId || "").trim() || "file";
  const safe = safeStorageFileName(input.fileName || "file");
  return `${prefix}/${id}_${safe}`;
}

export function buildVoucherAttachmentStoragePath(input: {
  companyId: string;
  usePocketLedger: boolean;
  voucherType: string;
  fileName: string;
  voucherId?: string;
}): string {
  const prefix = buildStoragePathPrefix({
    companyId: input.companyId,
    usePocketLedger: input.usePocketLedger,
    collectionName: "vouchers",
    fieldKey: "fileUrls",
    voucherType: input.voucherType,
  });
  return buildStorageObjectPath({
    prefix,
    fileName: input.fileName,
    voucherId: input.voucherId,
  });
}

export function buildCompanyLogoStorageObjectPath(
  companyId: string,
  usePocketLedger: boolean,
  fileName: string
): string {
  const prefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "company",
    fieldKey: "logoUrl",
  });
  return buildStorageObjectPath({ prefix, fileName });
}

/** Restore orphan attachment fallback — pocket-ledger me `unassigned`. */
export function buildRestoreOrphanStoragePathPrefix(
  companyId: string,
  usePocketLedger: boolean
): string {
  if (usePocketLedger) {
    return `${pocketLedgerCompanyRoot(companyId)}/unassigned`;
  }
  return `companies/${companyId}/restored-files`;
}

/** Pending upload routing — pocket-ledger, voucher-files, companies prefixes. */
export function companyIdFromStoragePathPrefix(prefix: string | undefined): string | null {
  const p = String(prefix || "").trim().replace(/^\/+/, "");
  const pl = /^pocket-ledger\/([^/]+)\//i.exec(p);
  if (pl?.[1]) return pl[1];
  const vf = /^voucher-files\/([^/]+)\//i.exec(p);
  if (vf?.[1]) return vf[1];
  const co = /^companies\/([^/]+)\//i.exec(p);
  if (co?.[1]) return co[1];
  return null;
}

/** Path recognition — legacy + pocket-ledger. */
export function isKnownFirebaseStorageRootPath(path: string): boolean {
  const p = String(path || "").trim().replace(/^\/+/, "");
  return (
    /^voucher-files\//i.test(p) ||
    /^companies\//i.test(p) ||
    /^entity-files\//i.test(p) ||
    /^pocket-ledger\//i.test(p)
  );
}

/** Local SQLite row (or explicit override) — pocket-ledger vs legacy upload prefix. */
export async function resolveCompanyUsesPocketLedgerStorage(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  try {
    const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
    const row = await getLocalCompanyById(cid, { includeDeleted: true });
    if (companyUsesPocketLedgerStorage(row)) return true;
    const { doc, getDoc } = await import("@/lib/pbCompat/firestore");
    const { firestore } = await import("@/lib/plClientSession");
    const snap = await getDoc(doc(firestore, "companies", cid));
    return snap.exists() && companyUsesPocketLedgerStorage(snap.data() as CompanyStorageLayoutRow);
  } catch {
    return false;
  }
}
