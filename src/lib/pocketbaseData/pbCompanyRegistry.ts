/**
 * Which companies keep their online data on Pocket Ledger Server (PocketBase).
 * A company is a PocketBase company when its `onlineServerId` is "pocketbase".
 * Ids are remembered locally so hot paths (write gate, mutation wrappers) can
 * check synchronously.
 */

import { ONLINE_DATA_SERVER_POCKETBASE_ID } from "@/lib/onlineDataServer";
import { readSelectedCompanyId } from "@/lib/selectedCompanyStorage";

const IDS_KEY = "pl_pb_company_ids_v1";

let cache: Set<string> | null = null;

function load(): Set<string> {
  if (cache) return cache;
  const s = new Set<string>();
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(IDS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string" && v) s.add(v);
    } catch {
      /* ignore */
    }
  }
  cache = s;
  return s;
}

function save(s: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDS_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* ignore */
  }
}

/** True when the company row says its online data server is PocketBase. */
export function companyUsesPocketBase(company: unknown): boolean {
  if (!company || typeof company !== "object") return false;
  const c = company as { onlineServerId?: unknown; onlineDataBackend?: unknown };
  return String(c.onlineServerId || "").trim() === ONLINE_DATA_SERVER_POCKETBASE_ID;
}

/** Remember / forget a company id based on its row. Safe to call often. */
export function notePocketBaseCompanyRow(companyId: string, company: unknown): void {
  const id = String(companyId || "").trim();
  if (!id) return;
  const s = load();
  const uses = companyUsesPocketBase(company);
  if (uses && !s.has(id)) {
    s.add(id);
    save(s);
  } else if (!uses && s.has(id) && company && typeof company === "object" && "onlineServerId" in (company as object)) {
    s.delete(id);
    save(s);
  }
}

export function registerPocketBaseCompanyId(companyId: string): void {
  const id = String(companyId || "").trim();
  if (!id) return;
  const s = load();
  if (!s.has(id)) {
    s.add(id);
    save(s);
  }
}

/** Synchronous check (ids registered on this device). */
export function isPocketBaseCompanyId(companyId: string | null | undefined): boolean {
  const id = String(companyId || "").trim();
  return !!id && load().has(id);
}

/** Id check first, then the row (registers it when the row says PocketBase). */
export function isPocketBaseCompany(companyId: string | null | undefined, company?: unknown): boolean {
  if (isPocketBaseCompanyId(companyId)) return true;
  if (company && companyUsesPocketBase(company)) {
    if (companyId) registerPocketBaseCompanyId(companyId);
    return true;
  }
  return false;
}

export function listPocketBaseCompanyIds(): string[] {
  return Array.from(load());
}

/**
 * The company this tab is showing. Idle PocketBase pull / live apply use only this id
 * so unselected companies stay on their last SQLite snapshot.
 */
export function activePocketBaseCompanyId(): string {
  const selected = String(readSelectedCompanyId() || "").trim();
  if (!selected) return "";
  return isPocketBaseCompanyId(selected) ? selected : "";
}

export function listActivePocketBaseCompanyIds(): string[] {
  const id = activePocketBaseCompanyId();
  return id ? [id] : [];
}

export function isActivePocketBaseCompanyId(companyId: string | null | undefined): boolean {
  const id = String(companyId || "").trim();
  return !!id && id === activePocketBaseCompanyId();
}

/**
 * Company root writes in flight to the server (Firestore write done, server copy not yet):
 * root reads go to Firestore meanwhile so a read right after a save never sees the old copy.
 */
const rootWritesPending = new Map<string, number>();

export function notePocketBaseRootWrite(companyId: string, delta: 1 | -1): void {
  if (!companyId) return;
  const n = (rootWritesPending.get(companyId) || 0) + delta;
  if (n > 0) rootWritesPending.set(companyId, n);
  else rootWritesPending.delete(companyId);
}

export function isPocketBaseRootWritePending(companyId: string): boolean {
  return (rootWritesPending.get(companyId) || 0) > 0;
}
