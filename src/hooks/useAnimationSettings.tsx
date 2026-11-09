"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "./useAuth";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";

export type AnimationSettings = {
  numbers: {
    enabled: boolean;
    duration: number;
  };
  rows: {
    enabled: boolean;
    duration: number;
  };
};

const defaultSettings: AnimationSettings = {
  numbers: { enabled: true, duration: 2.5 },
  rows: { enabled: true, duration: 2.5 },
};

const ANIMATION_SETTINGS_CHANNEL = "pocket-ledger-animation-settings";

/** Shared user jinke paas company settings block — animation sirf is device / localStorage (Firestore write zaroori nahi). */
function animationLocalStorageKey(userDocId: string): string {
  return `pocket-ledger-animation-local:${userDocId}`;
}

function readAnimationFromLocalStorage(userDocId: string): AnimationSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(animationLocalStorageKey(userDocId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnimationSettings>;
    if (!parsed?.numbers || !parsed?.rows) return null;
    return {
      numbers: { ...defaultSettings.numbers, ...parsed.numbers },
      rows: { ...defaultSettings.rows, ...parsed.rows },
    };
  } catch {
    return null;
  }
}

export type AnimationSettingsState = {
  settings: AnimationSettings;
  loading: boolean;
  useLocalAnimationOnly: boolean;
};

/**
 * Single shared source (AnimationSettingsProvider, dashboard layout). Jab provider mounted ho,
 * `useAnimationSettings()` isi context se padhta hai — har consumer apna snapshot/BroadcastChannel nahi kholta.
 */
export const AnimationSettingsContext = createContext<AnimationSettingsState | null>(null);

/**
 * Actual loader (users doc `animationSettings` + localStorage + BroadcastChannel).
 * `disabled: true` → koi subscription nahi (provider context available hai).
 */
export function useAnimationSettingsSource(options?: { disabled?: boolean }): AnimationSettingsState {
  const disabled = options?.disabled === true;
  const { user, customUser } = useAuth();
  const { can } = usePermissions();
  const { company } = useCompany();
  const userDocId = customUser?.userDocId || user?.uid;
  const [settings, setSettings] = useState<AnimationSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  /** Owner ne company settings band ki — animation bhi server pe sync mat karo, sirf local. */
  const useLocalAnimationOnly = Boolean(
    company && company.isOwned === false && !can("configure_company_settings")
  );

  useEffect(() => {
    if (disabled) return;
    if (!userDocId) {
      window.queueMicrotask(() => {
        setSettings(defaultSettings);
        setLoading(false);
      });
      return;
    }

    if (useLocalAnimationOnly) {
      window.queueMicrotask(() => {
        const fromLs = readAnimationFromLocalStorage(userDocId);
        setSettings(fromLs ?? defaultSettings);
        setLoading(false);
      });
      return;
    }

    // Offline / slow / APK: turant device copy dikhao — snapshot error/par late Firestore se animation first paint miss na ho.
    window.queueMicrotask(() => {
      const seeded = readAnimationFromLocalStorage(userDocId);
      setSettings(seeded ?? defaultSettings);
      setLoading(false);
    });

    const userDocRef = doc(firestore, "users", userDocId);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data();
          const userSettings = userData.animationSettings;
          if (userSettings) {
            setSettings({
              numbers: { ...defaultSettings.numbers, ...userSettings.numbers },
              rows: { ...defaultSettings.rows, ...userSettings.rows },
            });
          } else {
            const fromLs = readAnimationFromLocalStorage(userDocId);
            setSettings(fromLs ?? defaultSettings);
          }
        } else {
          const fromLs = readAnimationFromLocalStorage(userDocId);
          setSettings(fromLs ?? defaultSettings);
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error loading user animation settings:", error);
        const fromLs = readAnimationFromLocalStorage(userDocId);
        setSettings(fromLs ?? defaultSettings);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userDocId, useLocalAnimationOnly, disabled]);

  // Live update across tabs: when another tab saves animation settings, apply here immediately
  useEffect(() => {
    if (disabled) return;
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(ANIMATION_SETTINGS_CHANNEL);
    const handler = (e: MessageEvent) => {
      const payload = e?.data;
      if (payload && typeof payload.numbers === "object" && typeof payload.rows === "object") {
        setSettings({
          numbers: { ...defaultSettings.numbers, ...payload.numbers },
          rows: { ...defaultSettings.rows, ...payload.rows },
        });
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }, [disabled]);

  return { settings, loading, useLocalAnimationOnly };
}

/** Existing callers unchanged: provider ho to context, warna purana per-hook load (fallback). */
export function useAnimationSettings(): AnimationSettingsState {
  const shared = useContext(AnimationSettingsContext);
  const own = useAnimationSettingsSource({ disabled: shared !== null });
  return shared ?? own;
}

export { animationLocalStorageKey };
