"use client";

import { PocketBaseNotSignedInError, PocketBaseRequestError, pbRequest } from "@/lib/pocketbaseData/pbClient";
import type { RecentOcrLink } from "@/modules/ocr/recentOcrLinks";
import { normalizeRecentOcrLink } from "@/modules/ocr/recentOcrLinks";

export type CompanyFileCountResponse = {
  ok: true;
  company: string;
  fileCount: number;
};

export async function fetchCompanyFileCount(companyId: string): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("company required");
  const raw = await pbRequest(
    `/api/pl/company-file-count?company=${encodeURIComponent(cid)}`,
    { method: "GET", timeoutMs: 15_000 }
  );
  const count = Number((raw as { fileCount?: unknown } | null)?.fileCount);
  if (!Number.isFinite(count) || count < 0) throw new Error("invalid file count");
  return Math.floor(count);
}

export async function fetchRecentOcrLinks(companyId: string): Promise<RecentOcrLink[]> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("company required");
  const raw = await pbRequest(
    `/api/pl/recent-ocr-links?company=${encodeURIComponent(cid)}`,
    { method: "GET", timeoutMs: 20_000 }
  );
  const list = (raw as { links?: unknown } | null)?.links;
  if (!Array.isArray(list)) throw new Error("invalid recent OCR links");
  const out: RecentOcrLink[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const link = normalizeRecentOcrLink(item as RecentOcrLink);
    if (link) out.push(link);
  }
  return out;
}

export async function fetchVouchersByAnyIds(
  companyId: string,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown> & { id: string }>> {
  const cid = String(companyId || "").trim();
  const wanted = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  const out = new Map<string, Record<string, unknown> & { id: string }>();
  if (!cid || wanted.length === 0) return out;
  const raw = await pbRequest("/api/pl/vouchers-by-ids", {
    method: "POST",
    body: { company: cid, ids: wanted },
    timeoutMs: 25_000,
  });
  const list = (raw as { vouchers?: unknown } | null)?.vouchers;
  if (!Array.isArray(list)) throw new Error("invalid vouchers");
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const appId = String(row.id || row.app_id || "").trim();
    if (!appId) continue;
    const doc = { ...row, id: appId } as Record<string, unknown> & { id: string };
    out.set(appId, doc);
    for (const alias of wanted) {
      if (alias === appId) continue;
      if (String(row.id || "") === alias || String(row.app_id || "") === alias || String((row as { _pbId?: unknown })._pbId || "") === alias) {
        out.set(alias, doc);
      }
    }
  }
  return out;
}

export function isGalleryServerApiUnavailable(error: unknown): boolean {
  if (error instanceof PocketBaseNotSignedInError) return true;
  if (error instanceof PocketBaseRequestError) {
    return error.status === 404 || error.status === 501 || error.status === 502 || error.status === 503;
  }
  return false;
}
