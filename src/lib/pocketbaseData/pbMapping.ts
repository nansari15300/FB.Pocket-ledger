/**
 * App collection name (Firestore `companies/{id}/<coll>`) -> Pocket Ledger Server collection.
 * The full document is kept in `data` (JSON, timestamps encoded like the outbox);
 * a few columns are copied out for server-side search/reports (best effort).
 */

export const PB_GROUP_KINDS = [
  "groups",
  "account_groups",
  "staff_groups",
  "item_groups",
  "tax_groups",
  "expense_groups",
] as const;

const DIRECT: Record<string, string> = {
  vouchers: "pl_vouchers",
  parties: "pl_parties",
  bank_accounts: "pl_bank_accounts",
  staff: "pl_staff",
  items: "pl_items",
  taxes: "pl_taxes",
  expense_accounts: "pl_expense_accounts",
  unassigned_documents: "pl_unassigned_documents",
};

/** All server collections that hold company data rows (sync pulls these). */
export const PB_DATA_COLLECTIONS = [
  "pl_vouchers",
  "pl_parties",
  "pl_bank_accounts",
  "pl_staff",
  "pl_items",
  "pl_taxes",
  "pl_expense_accounts",
  "pl_groups",
  "pl_unassigned_documents",
  "pl_docs",
] as const;

export type PbTarget = {
  collection: string;
  /** Extra key fields (with company + app_id) that identify one row. */
  key: Record<string, string>;
};

const COLL_RE = /^[A-Za-z0-9_]+$/;

export function pbTargetForAppCollection(appColl: string): PbTarget | null {
  const c = String(appColl || "").trim();
  if (!c || !COLL_RE.test(c) || c.length > 100) return null;
  if (DIRECT[c]) return { collection: DIRECT[c], key: {} };
  if ((PB_GROUP_KINDS as readonly string[]).includes(c)) return { collection: "pl_groups", key: { kind: c } };
  return { collection: "pl_docs", key: { coll: c } };
}

/** Server row -> app collection name. */
export function appCollectionForPbRecord(collection: string, rec: Record<string, unknown>): string | null {
  if (collection === "pl_groups") return String(rec.kind || "") || null;
  if (collection === "pl_docs") return String(rec.coll || "") || null;
  for (const [app, pb] of Object.entries(DIRECT)) if (pb === collection) return app;
  return null;
}

function str(v: unknown, max: number): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Firestore Timestamp / outbox `{__fsTs}` / Date / ms / ISO date -> ms. */
export function anyDateToMs(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : undefined;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : undefined;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof v === "object") {
    const o = v as { seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; toMillis?: () => number };
    if (typeof o.toMillis === "function") {
      try {
        return o.toMillis();
      } catch {
        return undefined;
      }
    }
    const s = num(o.seconds ?? o._seconds);
    if (s != null) return Math.trunc(s * 1000 + (num(o.nanoseconds) || 0) / 1e6);
  }
  return undefined;
}

function pick(d: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (d[k] != null && d[k] !== "") return d[k];
  return undefined;
}

/** Best-effort extracted columns (never required; bad values are skipped). */
export function pbExtractColumns(collection: string, d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined) out[k] = v;
  };
  switch (collection) {
    case "pl_vouchers":
      put("type", str(pick(d, "type", "voucherType"), 50));
      put("sub_type", str(pick(d, "subType", "sub_type"), 50));
      put("voucher_no", str(pick(d, "voucherNo", "voucherNumber", "number"), 100));
      put("date_ms", anyDateToMs(pick(d, "date", "voucherDate")));
      put("amount", num(pick(d, "amount", "totalAmount", "total")));
      put("party_app_id", str(pick(d, "partyId"), 200));
      put("account_app_id", str(pick(d, "accountId", "bankAccountId"), 200));
      put("staff_app_id", str(pick(d, "staffId"), 200));
      put("user_app_id", str(pick(d, "userId", "createdBy"), 200));
      if (typeof d.isApproved === "boolean") out.is_approved = d.isApproved;
      break;
    case "pl_groups":
      put("name", str(d.name, 300));
      put("parent_app_id", str(pick(d, "parentId", "parentGroupId"), 200));
      break;
    case "pl_unassigned_documents":
      put("title", str(pick(d, "title", "name", "fileName"), 300));
      put("doc_date_ms", anyDateToMs(pick(d, "date", "createdAt")));
      break;
    case "pl_docs":
      break;
    default:
      // masters
      put("name", str(d.name, 300));
      put("group_app_id", str(pick(d, "groupId", "accountGroupId", "staffGroupId", "itemGroupId"), 200));
      break;
  }
  return out;
}
