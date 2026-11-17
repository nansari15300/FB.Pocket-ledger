"use client";
/**
 * "Our own names on bank slips" for the text OCR engines (Google Vision / Azure).
 * Gemini receives the company bank aliases inside its prompt (server aliasPromptBlock); the text detectors get the
 * same list here (GET /api/ocr-cloud/ai-aliases, per company, cached briefly) and match it in classifyReceipt.
 */
import { listOcrAiAliases } from "./ai/aiClient";
import type { OwnAliases } from "@/lib/ocr/receiptDetect";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; v: OwnAliases }>();

/** Alias rows -> names (account holder / beneficiary) + account last digits. */
export function ownAliasesFromRows(rows: readonly { kind: string; text: string }[], extraNames: readonly (string | null | undefined)[] = []): OwnAliases {
  const names: string[] = [];
  const last4: string[] = [];
  for (const r of rows) {
    const t = String(r.text ?? "").trim();
    if (!t) continue;
    if (r.kind === "account_last4") { const d = t.replace(/\D/g, ""); if (d.length >= 2 && !last4.includes(d)) last4.push(d); }
    else if (!names.includes(t)) names.push(t);
  }
  for (const n of extraNames) { const t = String(n ?? "").trim(); if (t && !names.includes(t)) names.push(t); }
  return { names, last4 };
}

/** Cached alias list for one company; never throws (no aliases = empty lists). */
export async function getOcrOwnAliases(companyId: string | null | undefined): Promise<OwnAliases> {
  const id = String(companyId ?? "").trim();
  if (!id) return { names: [], last4: [] };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  try {
    const list = await listOcrAiAliases(id);
    const v = ownAliasesFromRows(list.aliases);
    cache.set(id, { at: Date.now(), v });
    return v;
  } catch {
    return hit?.v ?? { names: [], last4: [] };
  }
}

/** The alias editor saved / removed a row: read it fresh next time. */
export function invalidateOcrOwnAliases(companyId?: string | null) {
  if (companyId) cache.delete(String(companyId)); else cache.clear();
}
