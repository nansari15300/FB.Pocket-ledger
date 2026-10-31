"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getBillingApiIdToken } from "@/lib/firebaseAuthForApi";
import { useAuth } from "@/hooks/useAuth";
import { useAdSettings } from "@/hooks/useAdSettings";
import { capDailyEarn, newAdEventId, pointsForCompletedAdSeconds } from "@/lib/ads/adRewardMath";
import { postAdRewardSync } from "@/lib/ads/adRewardSyncClient";
import { canPlayRewardedAd, showRewardedAd } from "@/lib/ads/adRewardedNative";
import { loadAdWallet, saveAdWallet } from "@/lib/ads/adWalletStore";
import {
  emptyAdWallet,
  pruneExpiredUnlocks,
  rolloverDailyCap,
  type AdActiveUnlock,
  type AdWalletState,
} from "@/lib/ads/adWalletTypes";
import type { AdUnlockOffer } from "@/lib/adSettings";

type AdWalletContextValue = {
  wallet: AdWalletState;
  adsEnabled: boolean;
  canWatchAd: boolean;
  loading: boolean;
  busy: boolean;
  watchRewardedAd: () => Promise<{ ok: boolean; points: number; message: string }>;
  spendUnlock: (offer: AdUnlockOffer) => Promise<{ ok: boolean; message: string }>;
  isFeatureTemporarilyUnlocked: (featureId: string) => boolean;
  unlockExpiresAt: (featureId: string) => number | null;
};

const inactiveWallet = emptyAdWallet("");

const AdWalletContext = createContext<AdWalletContextValue>({
  wallet: inactiveWallet,
  adsEnabled: false,
  canWatchAd: false,
  loading: false,
  busy: false,
  watchRewardedAd: async () => ({ ok: false, points: 0, message: "Ads are off." }),
  spendUnlock: async () => ({ ok: false, message: "Ads are off." }),
  isFeatureTemporarilyUnlocked: () => false,
  unlockExpiresAt: () => null,
});

function applyLocalWallet(next: AdWalletState): AdWalletState {
  return pruneExpiredUnlocks(rolloverDailyCap(next));
}

export function AdWalletProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { settings, adsEnabled } = useAdSettings();
  const uid = user?.uid || "";
  const [wallet, setWallet] = useState<AdWalletState>(inactiveWallet);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const syncingRef = useRef(false);

  const persist = useCallback(async (next: AdWalletState) => {
    const cleaned = applyLocalWallet(next);
    setWallet(cleaned);
    walletRef.current = cleaned;
    await saveAdWallet(cleaned);
    return cleaned;
  }, []);

  useEffect(() => {
    if (!adsEnabled || !uid) {
      setWallet(inactiveWallet);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadAdWallet(uid).then((loaded) => {
      if (cancelled) return;
      const cleaned = applyLocalWallet({ ...loaded, uid });
      setWallet(cleaned);
      walletRef.current = cleaned;
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [adsEnabled, uid]);

  const flushPending = useCallback(async () => {
    if (!adsEnabled || !uid || syncingRef.current) return;
    const current = applyLocalWallet(walletRef.current);
    if (current.pending.length === 0) return;
    const hours = settings.serverSyncHours;
    const due =
      hours <= 0 ||
      current.lastSyncAtMs <= 0 ||
      Date.now() - current.lastSyncAtMs >= hours * 60 * 60 * 1000;
    if (!due && hours > 0) return;

    const token = await getBillingApiIdToken(null).catch(() => null);
    if (!token) return;
    syncingRef.current = true;
    try {
      const result = await postAdRewardSync({
        idToken: token,
        pending: current.pending,
        local: {
          points: current.points,
          earnedToday: current.earnedToday,
          dayKey: current.dayKey,
          unlocks: current.unlocks,
        },
      });
      const processed = new Set(result.processedEventIds || current.pending.map((row) => row.eventId));
      await persist({
        ...current,
        points: typeof result.points === "number" ? result.points : current.points,
        earnedToday: typeof result.earnedToday === "number" ? result.earnedToday : current.earnedToday,
        dayKey: result.dayKey || current.dayKey,
        unlocks: Array.isArray(result.unlocks) ? result.unlocks : current.unlocks,
        pending: current.pending.filter((row) => !processed.has(row.eventId)),
        lastSyncAtMs: Date.now(),
      });
    } catch {
      /* stay local; retry later */
    } finally {
      syncingRef.current = false;
    }
  }, [adsEnabled, persist, settings.serverSyncHours, uid]);

  useEffect(() => {
    if (!adsEnabled || !uid) return;
    const hours = settings.serverSyncHours;
    const intervalMs = hours <= 0 ? 15_000 : Math.min(60 * 60 * 1000, Math.max(60_000, hours * 60 * 60 * 1000));
    const tick = () => {
      void flushPending();
    };
    tick();
    const id = window.setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [adsEnabled, flushPending, settings.serverSyncHours, uid]);

  const watchRewardedAd = useCallback(async () => {
    if (!adsEnabled) return { ok: false, points: 0, message: "Ads are off." };
    if (!uid) return { ok: false, points: 0, message: "Sign in to earn reward points." };
    if (!canPlayRewardedAd()) {
      return { ok: false, points: 0, message: "Rewarded ads are available in the Android app." };
    }
    if (busy) return { ok: false, points: 0, message: "Please wait." };
    setBusy(true);
    try {
      const result = await showRewardedAd(settings);
      if (!result.rewarded) {
        return { ok: false, points: 0, message: "Ad was not completed. No points awarded." };
      }
      const rawPoints = pointsForCompletedAdSeconds(settings, result.elapsedSeconds);
      const current = applyLocalWallet(walletRef.current);
      const awarded = capDailyEarn(current.earnedToday, rawPoints, settings.dailyMaxPoints);
      if (awarded <= 0) {
        return { ok: false, points: 0, message: "Daily point limit reached." };
      }
      const eventId = newAdEventId();
      await persist({
        ...current,
        points: current.points + awarded,
        earnedToday: current.earnedToday + awarded,
        pending: [
          ...current.pending,
          {
            eventId,
            type: "reward",
            pointsDelta: awarded,
            createdAtMs: Date.now(),
          },
        ],
      });
      if (settings.serverSyncHours <= 0) void flushPending();
      return { ok: true, points: awarded, message: `+${awarded} pts` };
    } finally {
      setBusy(false);
    }
  }, [adsEnabled, busy, flushPending, persist, settings, uid]);

  const spendUnlock = useCallback(
    async (offer: AdUnlockOffer) => {
      if (!adsEnabled) return { ok: false, message: "Ads are off." };
      if (!uid) return { ok: false, message: "Sign in to unlock with points." };
      if (!offer.enabled) return { ok: false, message: "This offer is not active." };
      const current = applyLocalWallet(walletRef.current);
      const cost = Math.max(0, Math.floor(offer.pointsCost));
      if (current.points < cost) {
        return { ok: false, message: `Need ${cost} pts (you have ${current.points}).` };
      }
      const hours = Math.max(1, Math.floor(offer.durationHours));
      const expiresAtMs = Date.now() + hours * 60 * 60 * 1000;
      const eventId = newAdEventId();
      const nextUnlock: AdActiveUnlock = {
        id: offer.id,
        featureId: offer.featureId,
        expiresAtMs,
      };
      const unlocks = [...current.unlocks.filter((row) => row.featureId !== offer.featureId), nextUnlock];
      await persist({
        ...current,
        points: current.points - cost,
        unlocks,
        pending: [
          ...current.pending,
          {
            eventId,
            type: "spend",
            pointsDelta: -cost,
            unlockId: offer.id,
            featureId: offer.featureId,
            durationHours: hours,
            expiresAtMs,
            createdAtMs: Date.now(),
          },
        ],
      });
      if (settings.serverSyncHours <= 0) void flushPending();
      return { ok: true, message: `Unlocked for upto ${hours} hrs.` };
    },
    [adsEnabled, flushPending, persist, settings.serverSyncHours, uid]
  );

  const isFeatureTemporarilyUnlocked = useCallback(
    (featureId: string) => {
      if (!adsEnabled) return false;
      const now = Date.now();
      return wallet.unlocks.some((row) => row.featureId === featureId && row.expiresAtMs > now);
    },
    [adsEnabled, wallet.unlocks]
  );

  const unlockExpiresAt = useCallback(
    (featureId: string) => {
      if (!adsEnabled) return null;
      const now = Date.now();
      const row = wallet.unlocks.find((item) => item.featureId === featureId && item.expiresAtMs > now);
      return row ? row.expiresAtMs : null;
    },
    [adsEnabled, wallet.unlocks]
  );

  const value = useMemo<AdWalletContextValue>(
    () => ({
      wallet,
      adsEnabled,
      canWatchAd: adsEnabled && canPlayRewardedAd(),
      loading,
      busy,
      watchRewardedAd,
      spendUnlock,
      isFeatureTemporarilyUnlocked,
      unlockExpiresAt,
    }),
    [
      adsEnabled,
      busy,
      isFeatureTemporarilyUnlocked,
      loading,
      spendUnlock,
      unlockExpiresAt,
      wallet,
      watchRewardedAd,
    ]
  );

  return <AdWalletContext.Provider value={value}>{children}</AdWalletContext.Provider>;
}

export function useAdWallet(): AdWalletContextValue {
  return useContext(AdWalletContext);
}
