"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isRunnerDuplicateCheckOff, subscribeRunnerDuplicateCheckOff } from "@/modules/ocr/handoff";
import { useAutoOcrDuplicatePolicy } from "@/hooks/useAutoOcrDuplicatePolicy";
import { AUTO_POST_PAUSE_CAUSE_RESOLVED } from "@/components/gallery/autoPostPauseResume";
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
  /* Gallery runner opened this voucher with "Check for duplicate vouchers" OFF: no detection, no bubble. */
  const runnerDupOff = useSyncExternalStore(subscribeRunnerDuplicateCheckOff, isRunnerDuplicateCheckOff, () => false);
  const policy = useAutoOcrDuplicatePolicy();
  const checkEnabled = enabled && !runnerDupOff && (!policy.ready || policy.checkDuplicateVouchers);
  const [match, setMatch] = useState<DuplicateMatch | null>(null);
  const dismissedKeyRef = useRef("");
  const prevMatchRef = useRef<DuplicateMatch | null>(null);
  const skipResolveRef = useRef(false);
  const inputKey = JSON.stringify(input, (_key, value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value
  );

  useEffect(() => {
    const hasFingerprint = Number(input.amount) > 0 || !!input.ref || String(input.narration || "").trim().length >= 12;
    if (!checkEnabled || !input.type || !input.date || !hasFingerprint) {
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
  }, [checkEnabled, candidates, inputKey]);

  const dismiss = useCallback(() => {
    skipResolveRef.current = true;
    if (match) dismissedKeyRef.current = `${match.id}|${match.reasons.join(",")}`;
    setMatch(null);
  }, [match]);

  useEffect(() => {
    const prev = prevMatchRef.current;
    prevMatchRef.current = match;
    if (prev && !match) {
      if (skipResolveRef.current) {
        skipResolveRef.current = false;
        return;
      }
      window.dispatchEvent(new CustomEvent(AUTO_POST_PAUSE_CAUSE_RESOLVED, {
        detail: { kind: "duplicate" },
      }));
    }
  }, [match]);

  return { match, dismiss };
}
