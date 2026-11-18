"use client";
/**
 * Live Manual Runner profile per company (cached). Hand-opened vouchers use it instead of device-local prefs
 * for engine, Auto Post, countdown, Overwrite edited and the item rule (Decision 2, 2026-11-18).
 */
import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { DEFAULT_MANUAL_OCR_PROFILE, parseManualOcrProfile, type ManualOcrProfile } from "./manualProfileCore";

export * from "./manualProfileCore";

const cache = new Map<string, ManualOcrProfile>();
let lastCompanyId = "";

const settingsRef = (companyId: string) => doc(firestore, `companies/${companyId}/auto_ocr_settings`, "server_auto_ocr");

/** Last known Manual Runner profile (defaults until loaded). Without an id, the last company used. */
export function getManualOcrProfile(companyId?: string | null): ManualOcrProfile {
  const id = String(companyId || lastCompanyId || "").trim();
  return (id && cache.get(id)) || DEFAULT_MANUAL_OCR_PROFILE;
}

/** Reads the settings doc once if this company is not cached yet. Never throws. */
export async function ensureManualOcrProfile(companyId: string | null | undefined): Promise<ManualOcrProfile> {
  const id = String(companyId || "").trim();
  if (!id) return DEFAULT_MANUAL_OCR_PROFILE;
  lastCompanyId = id;
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const snap = await getDoc(settingsRef(id));
    const profile = parseManualOcrProfile(snap.exists() ? snap.data() : {});
    cache.set(id, profile);
    return profile;
  } catch {
    return DEFAULT_MANUAL_OCR_PROFILE;
  }
}

/** Subscribes to the settings doc and keeps the cache fresh. */
export function useManualOcrProfile(companyId: string | null | undefined): ManualOcrProfile {
  const id = String(companyId || "").trim();
  const [profile, setProfile] = useState<ManualOcrProfile>(() => getManualOcrProfile(id));
  useEffect(() => {
    if (!id) return;
    lastCompanyId = id;
    setProfile(getManualOcrProfile(id));
    const unsub = onSnapshot(settingsRef(id), (snap) => {
      const next = parseManualOcrProfile(snap.exists() ? snap.data() : {});
      cache.set(id, next);
      setProfile(next);
    }, () => undefined);
    return () => unsub();
  }, [id]);
  return profile;
}
