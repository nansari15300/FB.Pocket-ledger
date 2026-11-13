"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  findDuplicateVoucher,
  type CandidateVoucher,
  type DuplicateMatch,
  type FindDuplicateInput,
} from "@/lib/voucherDuplicateGuard";

/** Debounced, non-blocking duplicate warning shared by voucher entry forms. */
export function useLiveVoucherDuplicate(
  candidates: readonly CandidateVoucher[] | null | undefined,
  input: FindDuplicateInput,
  enabled: boolean
) {
  const [match, setMatch] = useState<DuplicateMatch | null>(null);
  const dismissedKeyRef = useRef("");
  const inputKey = JSON.stringify(input, (_key, value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value
  );

  useEffect(() => {
    const hasFingerprint = Number(input.amount) > 0 || !!input.ref || String(input.narration || "").trim().length >= 12;
    if (!enabled || !input.type || !input.date || !hasFingerprint) {
      setMatch(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const found = findDuplicateVoucher(candidates, input);
      if (!found) {
        setMatch(null);
        return;
      }
      const key = `${found.id}|${found.reasons.join(",")}`;
      if (dismissedKeyRef.current !== key) setMatch(found);
    }, 350);
    return () => window.clearTimeout(timer);
    // inputKey ensures every relevant field change refreshes the warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, candidates, inputKey]);

  const dismiss = useCallback(() => {
    if (match) dismissedKeyRef.current = `${match.id}|${match.reasons.join(",")}`;
    setMatch(null);
  }, [match]);

  return { match, dismiss };
}
