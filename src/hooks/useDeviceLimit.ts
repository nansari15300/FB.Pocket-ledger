"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { collection, doc } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "./useCompany";
import { useAuth } from "./useAuth";
import { useLivePlans, getPlanFromPlans } from "./useLivePlans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { normalizePlanIdForClient, isUnlimitedEntitlementCap, type PlanId } from "@/config/plans";
import { registerDeviceAndCheckLimit, replaceMyOtherDevicesAndRegister, getOrCreateDeviceId, setKickedForCompany, clearKickedForCompany, getWasKicked, enforceDeviceLimitByPlan } from "@/lib/deviceLimitClient";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import {
  EMPTY_PURCHASED_PLAN_ADDONS,
  parsePurchasedPlanAddOns,
  planDeviceCapWithAddOns,
  type PurchasedPlanAddOns,
} from "@/lib/planAddOns";
const runCheckRef = { current: (() => Promise.resolve()) as () => void | Promise<void> };

export function useDeviceLimit() {
  const { companyId, company, allCompanies } = useCompany();
  const { user, customUser } = useAuth();
  const livePlans = useLivePlans();
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [ownerAddons, setOwnerAddons] = useState<PurchasedPlanAddOns>(EMPTY_PURCHASED_PLAN_ADDONS);

  useEffect(() => {
    // Static bundle me offline mode par device-limit blocking overlay disable rakho.
    const update = () => setIsOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /** Owner account add-ons (extra devices) — shared users read company owner's user doc. */
  useEffect(() => {
    const isOwner =
      !!company &&
      !!user?.uid &&
      (company.ownerId === user.uid || (!!user.email && company.ownerEmail === user.email));
    const ownerUid = (isOwner ? user?.uid : company?.ownerId)?.trim() || "";
    if (!ownerUid) {
      setOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS);
      return;
    }
    const unsub = onSnapshot(
      doc(firestore, "users", ownerUid),
      (snap) => {
        setOwnerAddons(parsePurchasedPlanAddOns(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
      },
      () => setOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS)
    );
    return () => unsub();
  }, [company?.ownerId, company?.ownerEmail, user?.uid, user?.email, Boolean(company)]);

  const [result, setResult] = useState<{
    allowed: boolean;
    count: number;
    limit: number;
    singleDeviceOnly?: boolean;
    replaceOffer?: boolean;
    noPermissionNewDevice?: boolean;
    kickedAndBlocked?: boolean;
  } | null>(null);
  const myDeviceWasInListRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (isStaticAppBuild() && isOffline) {
      // Offline UX: company ke local data access ko device-limit gate se block mat karo.
      setResult((prev) =>
        prev?.allowed === true && prev.count === 0 && prev.limit === 1
          ? prev
          : { allowed: true, count: 0, limit: 1 }
      );
      myDeviceWasInListRef.current = null;
      return;
    }
    if (!companyId || !user?.uid || !company) {
      setResult((prev) => (prev === null ? prev : null));
      myDeviceWasInListRef.current = null;
      return;
    }

    // Pure local company (SQLite on this device) — no Firestore device-sync list.
    if (isOfflineCompanyStorage(company) && !isCloudBackedCompanyShape(company)) {
      setResult((prev) =>
        prev?.allowed === true && prev.count === 0 && prev.limit === 1
          ? prev
          : { allowed: true, count: 0, limit: 1 }
      );
      myDeviceWasInListRef.current = null;
      return;
    }

    myDeviceWasInListRef.current = null;

    const isOwner =
      !!company && (company.ownerId === user?.uid || (user?.email && company.ownerEmail === user.email));

    // Device allowance belongs to the signed-in account and is shared across every company
    // they use; the company owner still owns voucher quotas and company-level permissions.
    const planIdForDeviceSlots = normalizePlanIdForClient(
      customUser?.accountCanonicalPlanId ||
        resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId)
    );
    const plan = getPlanFromPlans(livePlans, planIdForDeviceSlots);
    const hasMultiDeviceSync = plan.entitlements.hasMultiDeviceSync === true;
    const localCompany = isOfflineCompanyStorage(company);
    const planMaxDevices = planDeviceCapWithAddOns(plan, localCompany, ownerAddons);
    const maxDevices = hasMultiDeviceSync ? planMaxDevices : 1;
    const userCanUseMultiDevice = company?.userCanUseMultiDevice !== false;

    let cancelled = false;
    myDeviceWasInListRef.current = null;
    const runCheck = (): Promise<void> => {
      if (cancelled) return Promise.resolve();
      const wasKicked = getWasKicked(companyId);
      return registerDeviceAndCheckLimit(companyId, user!.uid, maxDevices, hasMultiDeviceSync, {
        userCanUseMultiDevice,
        isOwner,
        wasKicked,
        accountScoped: true,
      })
        .then(async (r) => {
          if (cancelled) return;
          if (r.count > r.limit && r.limit >= 1 && !isUnlimitedEntitlementCap(r.limit)) {
            try {
              await enforceDeviceLimitByPlan(companyId, r.limit);
              if (!cancelled) runCheck();
            } catch {
              // non-blocking
            }
          }
          if (!cancelled) {
            setResult((prev) => {
              const next = {
                allowed: r.allowed,
                count: r.count,
                limit: r.limit,
                singleDeviceOnly: r.singleDeviceOnly,
                replaceOffer: r.replaceOffer,
                noPermissionNewDevice: r.noPermissionNewDevice,
                kickedAndBlocked: r.kickedAndBlocked,
              };
              if (
                prev &&
                prev.allowed === next.allowed &&
                prev.count === next.count &&
                prev.limit === next.limit &&
                prev.singleDeviceOnly === next.singleDeviceOnly &&
                prev.replaceOffer === next.replaceOffer &&
                prev.noPermissionNewDevice === next.noPermissionNewDevice &&
                prev.kickedAndBlocked === next.kickedAndBlocked
              ) {
                return prev;
              }
              return next;
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResult((prev) =>
              prev?.allowed === true && prev.count === 0 && prev.limit === maxDevices
                ? prev
                : { allowed: true, count: 0, limit: maxDevices }
            );
          }
        });
    };

    runCheckRef.current = runCheck;
    runCheck();

    const deviceId = getOrCreateDeviceId();
    const devicesRef = collection(firestore, "companies", companyId, "devices");
    const unsubDevices = onSnapshot(devicesRef, (snap) => {
      if (cancelled) return;
      const myDoc = snap.docs.find((d) => d.id === deviceId);
      const inList = !!myDoc;
      if (myDeviceWasInListRef.current === true && !inList) {
        setKickedForCompany(companyId);
      }
      myDeviceWasInListRef.current = inList;
      if (!inList) runCheck();
    });

    const interval = setInterval(() => { if (!document.hidden) runCheck(); }, 10 * 1000);
    return () => {
      cancelled = true;
      unsubDevices();
      clearInterval(interval);
    };
  }, [
    companyId,
    user?.uid,
    user?.email,
    company?.planId,
    company?.ownerId,
    company?.ownerEmail,
    company?.userCanUseMultiDevice,
    company?.storageOption,
    company?.syncPolicy,
    // Intentionally omit full `company` / `allCompanies` object refs — registry reloads were
    // recreating them every pass and re-entering this effect → Maximum update depth.
    livePlans,
    isOffline,
    allCompanies.length,
    customUser?.accountCanonicalPlanId,
    Boolean(company),
    ownerAddons.extraDevicesOnline,
    ownerAddons.extraDevicesLocal,
    ownerAddons.extraUsersOnline,
    ownerAddons.extraUsersLocal,
    ownerAddons.expiryMs,
  ]);

  const refreshDeviceCheck = useCallback(() => {
    runCheckRef.current?.();
  }, []);

  const performReplaceAndRefresh = useCallback(async () => {
    if (!companyId || !user?.uid || !company) return;
    const isOwner =
      !!company && (company.ownerId === user.uid || (user.email && company.ownerEmail === user.email));
    const planIdForDeviceSlots = normalizePlanIdForClient(
      customUser?.accountCanonicalPlanId ||
        resolveEffectiveAccountPlanId(allCompanies, user.uid, company?.planId)
    );
    const plan = getPlanFromPlans(livePlans, planIdForDeviceSlots);
    const hasMultiDeviceSync = plan.entitlements.hasMultiDeviceSync === true;
    const localCompany = isOfflineCompanyStorage(company);
    const planMaxDevices = planDeviceCapWithAddOns(plan, localCompany, ownerAddons);
    const maxDevices = hasMultiDeviceSync ? planMaxDevices : 1;
    await replaceMyOtherDevicesAndRegister(companyId, user.uid, maxDevices);
    runCheckRef.current?.();
  }, [companyId, user?.uid, company, livePlans, allCompanies, ownerAddons, customUser?.accountCanonicalPlanId]);

  const clearKickedAndRefresh = useCallback((): Promise<void> => {
    if (!companyId) return Promise.resolve();
    clearKickedForCompany(companyId);
    const p = runCheckRef.current?.();
    return p instanceof Promise ? p : Promise.resolve();
  }, [companyId]);

  return useMemo(
    () => ({
      deviceLimitReached: result !== null && !result.allowed,
      singleDeviceOnly: result?.singleDeviceOnly === true,
      replaceOffer: result?.replaceOffer === true,
      noPermissionNewDevice: result?.noPermissionNewDevice === true,
      kickedAndBlocked: result?.kickedAndBlocked === true,
      deviceCount: result?.count ?? 0,
      maxDevices: result?.limit ?? 1,
      loading: companyId && user && company && result === null,
      refreshDeviceCheck,
      performReplaceAndRefresh,
      clearKickedAndRefresh,
    }),
    [result, companyId, user, company, refreshDeviceCheck, performReplaceAndRefresh, clearKickedAndRefresh]
  );
}
