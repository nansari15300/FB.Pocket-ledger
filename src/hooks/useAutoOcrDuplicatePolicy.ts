"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { useCompany } from "@/hooks/useCompany";
import { galleryCompanyFsId } from "@/lib/galleryDuplicateMove";

export const AUTO_OCR_SETTINGS_DOC_ID = "server_auto_ocr";

export type DuplicateVoucherAction = "move-to-duplicates" | "save-anyway" | "pause-for-review";

export function normalizeDuplicateVoucherAction(value: unknown): DuplicateVoucherAction {
  if (value === "pause-for-review") return "pause-for-review";
  if (value === "fail-and-continue" || value === "move-to-duplicates") return "move-to-duplicates";
  return "save-anyway";
}

export type AutoOcrDuplicatePolicy = {
  ready: boolean;
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: DuplicateVoucherAction;
};

const DEFAULT_POLICY: AutoOcrDuplicatePolicy = {
  ready: false,
  checkDuplicateVouchers: true,
  duplicateVoucherAction: "save-anyway",
};

/** Live Common Setting values from companies/{fsId}/auto_ocr_settings/server_auto_ocr. */
export function useAutoOcrDuplicatePolicy(): AutoOcrDuplicatePolicy {
  const { company, companyId } = useCompany();
  const fsId = useMemo(
    () => (companyId ? galleryCompanyFsId(companyId, company) : ""),
    [companyId, company],
  );
  const [policy, setPolicy] = useState<AutoOcrDuplicatePolicy>(DEFAULT_POLICY);

  useEffect(() => {
    if (!fsId) return;
    return onSnapshot(
      doc(firestore, `companies/${fsId}/auto_ocr_settings`, AUTO_OCR_SETTINGS_DOC_ID),
      (snapshot) => {
        const value = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
        setPolicy({
          ready: true,
          checkDuplicateVouchers: value.checkDuplicateVouchers !== false,
          duplicateVoucherAction: normalizeDuplicateVoucherAction(value.duplicateVoucherAction),
        });
      },
      () => {
        setPolicy({
          ready: true,
          checkDuplicateVouchers: true,
          duplicateVoucherAction: "save-anyway",
        });
      },
    );
  }, [fsId]);

  return fsId ? policy : DEFAULT_POLICY;
}
