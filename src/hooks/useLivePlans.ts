"use client";

import { useState, useEffect, useRef } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { DEFAULT_PLANS, type Plan, type PlanId } from "@/config/plans";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import {
  defaultPlansRecordFallback,
  readCachedPlansRecord,
  writeCachedPlansRecord,
} from "@/lib/plansCatalogCache";

let staticPlansSeedFetchPromise: Promise<Record<string, unknown> | null> | null = null;

async function loadStaticPlansSeedOnce(): Promise<Record<string, unknown> | null> {
  // Multiple mounts par duplicate /plans-seed-raw.json network calls avoid karke single shared fetch rakho.
  if (!staticPlansSeedFetchPromise) {
    staticPlansSeedFetchPromise = (async () => {
      const res = await fetch("/plans-seed-raw.json", { cache: "no-cache" });
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, unknown>;
      return raw && typeof raw === "object" ? raw : null;
    })().catch(() => null);
  }
  return staticPlansSeedFetchPromise;
}

/**
 * `app_settings/plans` realtime — offline / doc missing par bundled default nahi, pehle localStorage me last online snapshot.
 * Static build (`NEXT_PUBLIC_STATIC_BUILD`): bundled `plans-seed-raw.json` jo build pe canonical site se fetch hua — koi tier key ho to state + cache update; khali `{}` aur purana cache ho to cache rakho.
 */
export function useLivePlans(): Record<PlanId, Plan> {
  const [plans, setPlans] = useState<Record<PlanId, Plan>>(() => readCachedPlansRecord() ?? defaultPlansRecordFallback());
  /** Static build seed stale ho sakta hai — Firestore / cached online snapshot ko overwrite mat karo. */
  const firestorePlansAppliedRef = useRef(false);

  // STATIC_BUILD bundle: offline bootstrap only — online par `app_settings/plans` source of truth.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1") return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await loadStaticPlansSeedOnce();
        if (!raw || cancelled || typeof raw !== "object") return;
        if (firestorePlansAppliedRef.current) return;
        const existing = readCachedPlansRecord();
        if (existing) {
          setPlans(existing);
          return;
        }
        const hasAnyTier = ["basic", "advance", "pro", "pro-plus"].some(
          (k) => raw[k] != null && typeof raw[k] === "object"
        );
        if (!hasAnyTier) {
          if (!cancelled) {
            const list = mergeAppSettingsPlansDoc(raw);
            const merged = {} as Record<PlanId, Plan>;
            for (const p of list) merged[p.id as PlanId] = p;
            setPlans(merged);
            writeCachedPlansRecord(merged);
          }
          return;
        }
        const list = mergeAppSettingsPlansDoc(raw);
        const merged = {} as Record<PlanId, Plan>;
        for (const p of list) merged[p.id as PlanId] = p;
        if (cancelled || firestorePlansAppliedRef.current) return;
        setPlans(merged);
        writeCachedPlansRecord(merged);
      } catch {
        /* missing file / parse — Firestore + defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(firestore, "app_settings", "plans"),
      (docSnap) => {
        if (!docSnap.exists()) {
          const cached = readCachedPlansRecord();
          setPlans(cached ?? defaultPlansRecordFallback());
          // Purana online data overwrite mat karo — DEFAULT ko cache me mat likho.
          return;
        }
        firestorePlansAppliedRef.current = true;
        const data = docSnap.data() as Record<string, unknown>;
        const list = mergeAppSettingsPlansDoc(data);
        const merged = {} as Record<PlanId, Plan>;
        for (const p of list) merged[p.id as PlanId] = p;
        setPlans(merged);
        writeCachedPlansRecord(merged);
      },
      () => {
        const cached = readCachedPlansRecord();
        if (cached) setPlans(cached);
      }
    );
    return () => unsub();
  }, []);

  return plans;
}

/** Get plan by id from live plans (use inside component that calls useLivePlans). */
export function getPlanFromPlans(plans: Record<PlanId, Plan>, planId?: PlanId | null): Plan {
  const id = planId || "basic";
  return plans[id] ?? DEFAULT_PLANS[id] ?? DEFAULT_PLANS.basic;
}
