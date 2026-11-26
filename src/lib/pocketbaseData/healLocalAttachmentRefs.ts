"use client";

/**
 * Receiver-side repair: a voucher (or other doc) pulled from the server may still
 * contain leftover `local:<id>` refs from older clients that pushed JSON before
 * the file upload finished. Resolve each ref against `pl_attachments` (`app_id =
 * att_<id>`), persist `pbatt:` in the local SQLite mirror, and return the refs
 * that should be downloaded on this device.
 */

import { collectLocalFileRefs, isLocalFileRef, isServerFileRef } from "@/lib/sync/voucherFieldMerge";

function replaceDeep(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((x) => replaceDeep(x, map));
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = replaceDeep(v, map);
  return out;
}

export type HealLocalAttachmentResult = {
  doc: Record<string, unknown>;
  changed: boolean;
  /** `pbatt:` refs to download on this device. */
  downloadRefs: string[];
};

/**
 * Resolve leftover `local:` refs on one already-decoded app doc. Network lookup;
 * safe to call during pull / realtime apply. On failure the doc is returned unchanged.
 */
export async function healLocalAttachmentRefsOnDoc(
  companyId: string,
  doc: Record<string, unknown>
): Promise<HealLocalAttachmentResult> {
  const downloadRefs: string[] = [];
  for (const u of collectFileUrlStrings(doc)) {
    if (isServerFileRef(u)) downloadRefs.push(u);
  }

  const locals = collectLocalFileRefs(doc);
  if (!locals.size) {
    return { doc, changed: false, downloadRefs: unique(downloadRefs) };
  }

  const map = new Map<string, string>();
  try {
    const { getValidPocketBaseAuth, pbFirst, pbQuote } = await import("@/lib/pocketbaseData/pbClient");
    const { ensurePocketBaseCompany } = await import("@/lib/pocketbaseData/pbSync");
    const { PB_ATTACHMENT_PREFIX } = await import("@/lib/pocketbaseData/pbAttachments");
    if (!getValidPocketBaseAuth()) {
      return { doc, changed: false, downloadRefs: unique(downloadRefs) };
    }
    const companyRec = await ensurePocketBaseCompany(companyId, { createIfMissing: false });
    for (const localRef of locals) {
      if (!isLocalFileRef(localRef)) continue;
      const localId = localRef.slice("local:".length).trim();
      if (!localId) continue;
      const appId = `att_${localId}`.slice(0, 200);
      try {
        const rec = await pbFirst<Record<string, unknown>>(
          "pl_attachments",
          `company = ${pbQuote(companyRec)} && app_id = ${pbQuote(appId)}`
        );
        const rid = String(rec?.id || "").trim();
        const file = String(rec?.file || "").trim();
        if (rid && file) {
          const pbatt = `${PB_ATTACHMENT_PREFIX}${rid}/${file}`;
          map.set(localRef, pbatt);
          downloadRefs.push(pbatt);
        }
      } catch {
        /* leave this local: for a later pull */
      }
    }
  } catch {
    return { doc, changed: false, downloadRefs: unique(downloadRefs) };
  }

  if (!map.size) return { doc, changed: false, downloadRefs: unique(downloadRefs) };
  const next = replaceDeep(doc, map) as Record<string, unknown>;
  if (next && typeof next === "object" && doc.id) next.id = doc.id;
  return { doc: next, changed: true, downloadRefs: unique(downloadRefs) };
}

function collectFileUrlStrings(doc: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (v.startsWith("pbatt:") || /^https?:\/\//i.test(v)) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(doc);
  return out;
}

function unique(refs: string[]): string[] {
  return Array.from(new Set(refs.filter(Boolean)));
}
