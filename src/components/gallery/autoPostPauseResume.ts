"use client";

import { ocrRunStrings } from "@/modules/ocr/ocrRunStrings";
import type { AutoPostMode } from "@/components/gallery/autoPostMode";

export const AUTO_POST_FORM_VALUES_CHANGED = "pl:gallery:auto-post-form-values-changed";
export const AUTO_POST_PAUSE_CAUSE_RESOLVED = "pl:gallery:auto-post-pause-cause-resolved";
export const AUTO_POST_VOUCHER_TYPE_CHANGED = "pl:gallery:auto-post-voucher-type-changed";

export type PauseCauseKind = "required-fields" | "voucher-type" | "duplicate";

export type PauseCause = {
  kind: PauseCauseKind;
  jobId: string;
  missing: string[];
  fieldKeys?: string[];
};

const TYPE_SWITCH_FIELD_KEYS = new Set([
  "vouchertypeswitchpending",
  "voucher_type_switch_pending",
  "vouchertype",
  "voucher_type",
  "switch",
  "typeswitch",
]);

/** Known UI-language labels for an unresolved voucher-type switch suggestion. */
const TYPE_SWITCH_LABELS = new Set([
  "voucher type (switch suggested)",
  "वाउचर प्रकार (बदलने का सुझाव)",
  "भौचर प्रकार (परिवर्तनको सुझाव)",
]);

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function typeSwitchPendingLabels(): string[] {
  const labels = new Set(TYPE_SWITCH_LABELS);
  try {
    labels.add(norm(ocrRunStrings().voucherTypeSwitchPending));
  } catch {
    /* current UI language table is optional for matching */
  }
  return [...labels];
}

/**
 * True when the runner should treat this missing-fields event as a pending
 * voucher-type switch. `fieldKeys` is optional (OCR Master may send it);
 * labels from every UI language are the fallback.
 */
export function isTypeSwitchPendingMissing(
  missing: readonly string[] | undefined,
  fieldKeys?: readonly string[] | undefined,
): boolean {
  if ((fieldKeys ?? []).some((key) => TYPE_SWITCH_FIELD_KEYS.has(norm(key).replace(/[\s-]/g, "")))) {
    return true;
  }
  const labels = typeSwitchPendingLabels();
  return (missing ?? []).some((item) => labels.includes(norm(item)));
}

export function isSameMissingSet(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const left = [...(a ?? [])].map(norm).sort();
  const right = [...(b ?? [])].map(norm).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Auto-resume after a setting pause is only for Semi and Full Auto. Manual is click-only. */
export function shouldAutoResume(mode: AutoPostMode | string | null | undefined): boolean {
  return mode === "semi" || mode === "full";
}
