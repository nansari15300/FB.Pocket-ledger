"use client";
/**
 * Gallery auto-post "duplicate voucher" rule for the OCR invoice path (Purchase / Sale handoff).
 * Reads `duplicateVoucherAction` from companies/{fsId}/auto_ocr_settings/server_auto_ocr — the same field and
 * normalisation as GalleryAutoOcrSettingsDialog (legacy "fail-and-continue" = move; default "save-anyway").
 * Kept OCR-local and tiny so it can be swapped for useAutoOcrDuplicatePolicy after the laptop merge.
 */
import { doc, getDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";

export type AutoPostDuplicateAction = "move-to-duplicates" | "save-anyway" | "pause-for-review";

/** Gallery settings dialog default (GalleryAutoOcrSettingsDialog DEFAULT settings). */
export const DEFAULT_AUTO_POST_DUPLICATE_ACTION: AutoPostDuplicateAction = "save-anyway";

export function normalizeAutoPostDuplicateAction(value: unknown): AutoPostDuplicateAction {
  if (value === "pause-for-review") return "pause-for-review";
  if (value === "move-to-duplicates" || value === "fail-and-continue") return "move-to-duplicates";
  if (value === "save-anyway") return "save-anyway";
  return DEFAULT_AUTO_POST_DUPLICATE_ACTION;
}

/** Current rule for this company; the default when the doc / field is missing or cannot be read. */
export async function readAutoPostDuplicateAction(companyId: string | null | undefined): Promise<AutoPostDuplicateAction> {
  const id = String(companyId || "").trim();
  if (!id) return DEFAULT_AUTO_POST_DUPLICATE_ACTION;
  try {
    const snap = await getDoc(doc(firestore, `companies/${id}/auto_ocr_settings`, "server_auto_ocr"));
    const data = (snap.exists() ? snap.data() : null) as Record<string, unknown> | null;
    return normalizeAutoPostDuplicateAction(data?.duplicateVoucherAction);
  } catch {
    return DEFAULT_AUTO_POST_DUPLICATE_ACTION;
  }
}
