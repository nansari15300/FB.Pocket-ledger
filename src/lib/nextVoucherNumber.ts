/**
 * Agla voucher number: local company par SQLite (`company_docs`) se serial —
 * Firestore-only query par hamesha 001 reh jata tha.
 */
import { collection, query, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import {
  formatVoucherNumber,
  formatVoucherNumberWithFy,
  normalizePrefix,
  parseFySegmentFromVoucherNumber,
  parseVoucherNumberPart,
  parseVoucherSerial,
} from "@/lib/voucherNumberFormat";
import { voucherFySegmentForDate } from "@/lib/fiscalYearLabel";
import { parseFyOpeningPillFormat, type FyOpeningPillFormat } from "@/lib/fyOpeningPillFormat";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";

export const DEFAULT_VOUCHER_PREFIX_LABELS: Record<string, string> = {
  sale: "Sale Inv",
  sale_service: "SER-",
  purchase: "PUR-",
  purchase_service: "SER-",
  payment_in: "RCPT-",
  payment_out: "PYMT-",
  direct_income: "DINC-",
  direct_expense: "DEXP-",
  contra: "CNTR-",
  journal: "JRNL-",
  adjustment: "ADJ-",
  note: "NOTE-",
  add_salary: "ADD-SAL-",
  pay_salary: "PAY-SAL-",
  pay_emi: "EMI-",
  production: "PROD-",
  inter_company: "IC-",
};

export function getVoucherPrefixKeyFromLike(v: {
  type?: string;
  subType?: string;
  lineItems?: Array<{ type?: string }>;
}): string {
  if (v.type === "journal" && v.subType === "add_salary") return "add_salary";
  if (v.type === "journal" && v.subType === "pay_emi") return "pay_emi";
  if (v.type === "payment_out" && v.subType === "pay_salary") return "pay_salary";
  if (v.type === "sale") return v.lineItems?.[0]?.type === "service" ? "sale_service" : "sale";
  if (v.type === "purchase") return v.lineItems?.[0]?.type === "service" ? "purchase_service" : "purchase";
  return String(v.type || "sale");
}

const SERVICE_PREFIX_KEY = new Set(["sale_service", "purchase_service"]);

function isLegacyServiceVoucherPrefix(prefixKey: string, prefix: string): boolean {
  const norm = normalizePrefix(prefix).toUpperCase();
  if (prefixKey === "purchase_service") return norm === "PS";
  if (prefixKey === "sale_service") return norm === "SS";
  return false;
}

/** Stored `PS-` / `SS-` → `SER-` (service rename); empty → company default. */
export function resolveVoucherPrefixForKey(prefixKey: string, prefix: string | undefined | null): string {
  const raw = String(prefix ?? "").trim();
  if (prefixKey === "inter_company") {
    const norm = normalizePrefix(raw).toUpperCase();
    if (raw === "IC-" || norm === "IC" || raw === "FT-" || norm === "FT") {
      return DEFAULT_VOUCHER_PREFIX_LABELS.inter_company;
    }
  }
  if (SERVICE_PREFIX_KEY.has(prefixKey) && (!raw || isLegacyServiceVoucherPrefix(prefixKey, raw))) {
    return DEFAULT_VOUCHER_PREFIX_LABELS[prefixKey] || "SER-";
  }
  if (raw) return raw;
  return DEFAULT_VOUCHER_PREFIX_LABELS[prefixKey] || "V-";
}

/** Prefix dropdown list — legacy PS- / SS- labels ko SER- me normalize. */
export function resolveCompanyVoucherPrefixList(
  prefixKey: string,
  list: string[] | undefined | null
): string[] {
  const src =
    Array.isArray(list) && list.length > 0
      ? list
      : [DEFAULT_VOUCHER_PREFIX_LABELS[prefixKey] || "V-"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of src) {
    const resolved = resolveVoucherPrefixForKey(prefixKey, p);
    const k = resolved.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(resolved);
  }
  return out.length > 0 ? out : [resolveVoucherPrefixForKey(prefixKey, null)];
}

/** Serial lookup: purane PS- / SS- vouchers bhi SER- numbering me count hon. */
export function voucherSerialPrefixAliases(prefixKey: string, prefix: string): string[] {
  const resolved = resolveVoucherPrefixForKey(prefixKey, prefix);
  if (prefixKey === "purchase_service") {
    return [...new Set([resolved, normalizePrefix(resolved), "PS-", "PS"].filter(Boolean))];
  }
  if (prefixKey === "sale_service") {
    return [...new Set([resolved, normalizePrefix(resolved), "SS-", "SS"].filter(Boolean))];
  }
  if (prefixKey === "inter_company") {
    return [...new Set([resolved, normalizePrefix(resolved), "FT-", "FT", "IC-", "IC"].filter(Boolean))];
  }
  return [resolved];
}

function parseStandardVoucherSerial(
  voucherNo: string,
  prefixAliases: string[],
  fySegment: string | null
): number {
  let best = NaN;
  for (const p of prefixAliases) {
    if (!voucherNo.startsWith(p) && !voucherNo.startsWith(normalizePrefix(p))) continue;
    let parsed = fySegment ? parseVoucherSerial(voucherNo, p, fySegment) : parseVoucherNumberPart(voucherNo, p);
    if (fySegment && !Number.isFinite(parsed) && !parseFySegmentFromVoucherNumber(voucherNo, p)) {
      parsed = parseVoucherNumberPart(voucherNo, p);
    }
    if (Number.isFinite(parsed) && (!Number.isFinite(best) || parsed > best)) best = parsed;
  }
  return best;
}

function filterVoucherRowsForSerial(
  rows: Array<Record<string, unknown>>,
  voucherLike: { type?: string; subType?: string; lineItems?: Array<{ type?: string }> }
): Array<Record<string, unknown>> {
  return rows.filter((r) => {
    if (voucherLike.type === "sale" || voucherLike.type === "purchase") {
      const srcLineType = voucherLike?.lineItems?.[0]?.type || "item";
      const rowLineType = (r as { lineItems?: Array<{ type?: string }> })?.lineItems?.[0]?.type || "item";
      return srcLineType === rowLineType;
    }
    if (voucherLike.type === "journal" && voucherLike.subType === "add_salary") return r.subType === "add_salary";
    if (voucherLike.type === "journal" && voucherLike.subType === "pay_emi") return r.subType === "pay_emi";
    if (voucherLike.type === "payment_out" && voucherLike.subType === "pay_salary") return r.subType === "pay_salary";
    if (voucherLike.type === "journal") return r.subType !== "add_salary" && r.subType !== "pay_emi";
    if (voucherLike.type === "payment_out") return r.subType !== "pay_salary";
    return String(r.type || "") === String(voucherLike.type || "");
  });
}

function parseContraVoucherSerial(voucherNo: string, prefix: string): number {
  const trimmed = (voucherNo || "").trim();
  if (!trimmed) return NaN;
  const base = normalizePrefix(prefix);
  const tryPrefixes = [`${base} Out`, `${base} In`, prefix, base];
  for (const p of tryPrefixes) {
    const parsed = parseVoucherNumberPart(trimmed, p);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NaN;
}

function maxSerialForPrefix(
  rows: Array<Record<string, unknown>>,
  prefix: string,
  voucherType: string | undefined,
  prefixKey?: string,
  fySegment: string | null = null,
  companyDoc?: Record<string, unknown> | null,
  fyFormat?: FyOpeningPillFormat
): number {
  const prefixAliases = prefixKey ? voucherSerialPrefixAliases(prefixKey, prefix) : [prefix];
  let maxNo = 0;
  for (const row of rows) {
    if (fySegment && companyDoc) {
      const rowFy = voucherFySegmentForDate(
        companyDoc as { country?: string; fiscalYearStart?: unknown },
        resolveVoucherDateForFy(row.date),
        fyFormat || "short"
      );
      if (rowFy !== fySegment) continue;
    }
    const voucherCandidates =
      voucherType === "contra"
        ? [
            String((row as { voucherNumberOut?: string }).voucherNumberOut || ""),
            String((row as { voucherNumberIn?: string }).voucherNumberIn || ""),
            String(row.voucherNumber || ""),
          ]
        : voucherType === "production"
          ? [String((row as { productionNumber?: string }).productionNumber || ""), String(row.voucherNumber || "")]
          : [String(row.voucherNumber || "")];
    for (const voucherNo of voucherCandidates) {
      if (!voucherNo) continue;
      const parsed =
        voucherType === "contra"
          ? parseContraVoucherSerial(voucherNo, prefix)
          : parseStandardVoucherSerial(voucherNo, prefixAliases, fySegment);
      if (Number.isFinite(parsed) && parsed > maxNo) maxNo = parsed;
    }
  }
  return maxNo;
}

/** Default ON: auto voucher nos include FY span even when fiscal split is off. */
export function autoVoucherIncludesFySegment(companyDoc: Record<string, unknown> | null | undefined): boolean {
  return companyDoc?.autoVoucherIncludeFy !== false;
}

export function resolveVoucherNumberFyFormat(
  companyDoc: Record<string, unknown> | null | undefined
): FyOpeningPillFormat {
  const raw = companyDoc?.voucherNumberFyFormat;
  return parseFyOpeningPillFormat(raw);
}

function resolveVoucherDateForFy(raw: unknown): Date {
  const d = parseFirestoreDateFieldToJsDate(raw);
  return d && !isNaN(d.getTime()) ? d : new Date();
}

function dedupeVoucherRowsById(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = String((row as { id?: string }).id || "").trim();
    if (id) map.set(id, row);
  }
  return map.size > 0 ? [...map.values()] : rows;
}

export type GetNextVoucherNumberParams = {
  companyId: string;
  companyDoc: Record<string, unknown> | null | undefined;
  voucherLike: {
    type: string;
    subType?: string;
    lineItems?: Array<{ type?: string }>;
  };
  /** Form prefix dropdown se override */
  selectedPrefix?: string;
  /** Voucher date — FY segment is derived from this (defaults to today). */
  voucherDate?: unknown;
};

/** Local SQLite + cloud merge se agla formatted voucher number (e.g. `JRNL - 002`). */
export async function getNextVoucherNumberForCompany(params: GetNextVoucherNumberParams): Promise<string> {
  const { companyId, companyDoc, voucherLike, selectedPrefix, voucherDate } = params;
  const prefixKey = getVoucherPrefixKeyFromLike(voucherLike);
  const configured = (companyDoc?.voucherPrefixes as Record<string, string[] | undefined> | undefined)?.[prefixKey];
  const rawPrefix =
    selectedPrefix?.trim() ||
    (Array.isArray(configured) && configured[0] ? configured[0] : "");
  const prefix = resolveVoucherPrefixForKey(prefixKey, rawPrefix || null);

  const readSqlite =
    apkEntityWriteUsesLocalSqliteMirror(companyDoc as { storageOption?: string }) ||
    (companyDoc != null && isOfflineCompanyStorage(companyDoc as { storageOption?: string }));
  const pureLocal =
    companyDoc != null && isOfflineCompanyStorage(companyDoc as { storageOption?: string });

  const fsCompanyId = String(
    (companyDoc as { authoritativeCompanyId?: string } | null | undefined)?.authoritativeCompanyId || companyId
  ).trim();

  let fsRows: Array<Record<string, unknown>> = [];
  if (!pureLocal) {
    try {
      const vouchersPath = collection(firestore, `companies/${fsCompanyId}/vouchers`);
      const typeQuery = query(vouchersPath, where("type", "==", String(voucherLike.type || "sale")));
      fsRows = (await getDocs(typeQuery)).docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, unknown>);
    } catch {
      fsRows = [];
    }
  }

  const localRows = readSqlite
    ? await listCompanyDocsFromBrowserDb(companyId, "vouchers", { forBackupMerge: true })
    : [];

  const mergedRows = filterVoucherRowsForSerial(
    dedupeVoucherRowsById([...fsRows, ...localRows]),
    voucherLike
  );
  const includeFy = autoVoucherIncludesFySegment(companyDoc);
  const fyFormat = resolveVoucherNumberFyFormat(companyDoc);
  const fySegment = includeFy
    ? voucherFySegmentForDate(
        companyDoc as { country?: string; fiscalYearStart?: unknown },
        resolveVoucherDateForFy(voucherDate),
        fyFormat
      )
    : null;
  const maxNo = maxSerialForPrefix(
    mergedRows,
    prefix,
    voucherLike.type,
    prefixKey,
    fySegment || null,
    companyDoc,
    fyFormat
  );
  return formatVoucherNumberWithFy(prefix, fySegment, maxNo + 1);
}

export function formatContraVoucherNumbersFromSerial(
  companyPrefixes: Record<string, string[] | undefined> | undefined,
  selectedPrefix: string,
  serial: number,
  fySegment: string | null
): { voucherNumber: string; voucherNumberOut: string; voucherNumberIn: string } {
  const VOUCHER_PREFIX = selectedPrefix;
  const rawBase = Array.isArray(companyPrefixes?.contra) && companyPrefixes.contra[0]
    ? companyPrefixes.contra[0]
    : DEFAULT_VOUCHER_PREFIX_LABELS.contra;
  const base = normalizePrefix(rawBase) || "CNTR";
  const mainVal = formatVoucherNumberWithFy(VOUCHER_PREFIX, fySegment, serial);
  const outVal = formatVoucherNumber(`${base} Out`, serial);
  const inVal = formatVoucherNumber(`${base} In`, serial);
  return { voucherNumber: mainVal, voucherNumberOut: outVal, voucherNumberIn: inVal };
}
