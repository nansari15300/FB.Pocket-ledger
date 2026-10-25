"use client";

/**
 * Server → local only: Firebase Admin plan + offline license window (20d chunk, sub cap).
 * Pure local rows: `planSyncFirestoreCompanyId` for plan API only — NOT `authoritativeCompanyId` / cloud identity.
 *
 * Static/APK: `getBillingApiUrl('/api/company/sync-plan')` → pocket-ledger.com (billingApiOrigin.ts).
 * Local-only SQLite par bhi online live sync — policy `planSyncClientPolicy.ts` me; MAT HATANA refactors me.
 */
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { hostedApiFetch } from "@/lib/hostedApiFetch";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isHostedPlanSyncDisabled } from "@/lib/hostedPlanSyncDisabled";
import { bumpLocalCompanyRegistry } from "@/lib/applyStripePlanToLocalCompany";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { isServerGateCompany } from "@/lib/companyStorageKind";
import { isPlRemoteServerClientMode } from "@/lib/plRemoteServerClient";
import { isDriveCloudSyncLocalRegistryRow } from "@/lib/driveRestoredLocalCompany";
import { clearCompanyPlanLocalCache, readCompanyPlanLocalCache, writeCompanyPlanLocalCache } from "@/lib/companyPlanLocalCache";
import { writeAccountPlanLocalCache } from "@/lib/accountPlanLocalCache";
import { normalizePlanIdForClient, planTierIndex } from "@/config/plans";
import { highestPlanIdAmongOwnedCompanies } from "@/lib/accountPlanForOwner";
import { verifyPlanEntitlementJws } from "@/lib/security/planEntitlementJwtVerify";
import { getOrCreateClientDeviceId } from "@/lib/security/deviceIdentity";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isPocketBaseAppSessionMarked } from "@/lib/pocketbaseData/pbAppSession";

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;

/** Local `next dev` without Admin service account — client Firestore read + SQLite patch. */
function isLocalDevPlanSyncFallbackEligible(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

function planExpiryMsFromCompanyData(data: Record<string, unknown>): number | null {
  if (typeof data.planExpiryMs === "number" && Number.isFinite(data.planExpiryMs)) {
    return data.planExpiryMs;
  }
  const pe = data.planExpiry as { toMillis?: () => number } | undefined;
  if (pe && typeof pe.toMillis === "function") {
    const ms = pe.toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function computeOfflineLicenseValidUntilMs(
  planId: string,
  planExpiryMs: number | null,
  prevUntilMs: number | undefined
): number {
  const now = Date.now();
  const prevUntil = typeof prevUntilMs === "number" && Number.isFinite(prevUntilMs) ? prevUntilMs : now;
  const base = Math.max(now, prevUntil);
  let chunkMs: number;
  if (planId === "basic" || planExpiryMs == null) {
    chunkMs = TWENTY_DAYS_MS;
  } else {
    chunkMs = Math.min(TWENTY_DAYS_MS, Math.max(0, planExpiryMs - base));
  }
  let offlineLicenseValidUntilMs = base + chunkMs;
  if (planExpiryMs != null) {
    offlineLicenseValidUntilMs = Math.min(offlineLicenseValidUntilMs, planExpiryMs);
  }
  return offlineLicenseValidUntilMs;
}

async function applyAuthoritativePlanPayloadToLocal(opts: {
  firebaseCompanyId: string;
  localCompanyId: string;
  data: ServerAuthoritativePlanPayload;
}): Promise<SyncCompanyPlanResult> {
  const { firebaseCompanyId, localCompanyId, data } = opts;

  const planId = String(data.planId || "basic").trim() || "basic";
  const planExpiryMs =
    typeof data.planExpiryMs === "number" && Number.isFinite(data.planExpiryMs) ? data.planExpiryMs : null;

  if (planId === "basic") {
    clearCompanyPlanLocalCache(localCompanyId);
  } else if (planExpiryMs != null) {
    const prevCache = readCompanyPlanLocalCache(localCompanyId);
    const jwsField = data.planEntitlementJws;
    const jwsRaw =
      typeof jwsField === "string"
        ? jwsField.trim()
        : jwsField === null
          ? ""
          : (prevCache?.planEntitlementJws || "").trim();
    let entitlementSignatureOk = false;
    let entitlementPlanIdFromJwt: string | undefined;
    let entitlementPlanExpMsFromJwt: number | undefined;
    let entitlementOfflineUntilMsFromJwt: number | undefined;
    let entitlementDeviceMatch = false;
    if (jwsRaw) {
      const vr = await verifyPlanEntitlementJws(jwsRaw);
      if (vr.ok) {
        entitlementSignatureOk = true;
        const c = vr.claims;
        if (typeof c.plan === "string" && c.plan.trim()) entitlementPlanIdFromJwt = normalizePlanIdForClient(c.plan.trim());
        if (typeof c.plan_exp === "number" && Number.isFinite(c.plan_exp)) entitlementPlanExpMsFromJwt = c.plan_exp;
        if (typeof c.off_until === "number" && Number.isFinite(c.off_until)) entitlementOfflineUntilMsFromJwt = c.off_until;
        const dev = getOrCreateClientDeviceId();
        entitlementDeviceMatch = c.device === dev;
      }
    }
    const nextJwsStored =
      jwsField === null ? undefined : typeof jwsField === "string" ? jwsField.trim() || undefined : prevCache?.planEntitlementJws;
    writeCompanyPlanLocalCache(localCompanyId, {
      planId,
      planExpiryMs,
      lastStripeCheckoutSessionId: data.lastStripeCheckoutSessionId ?? undefined,
      planEntitlementJws: nextJwsStored,
      entitlementVerifiedAtMs: Date.now(),
      entitlementSignatureOk,
      entitlementPlanIdFromJwt,
      entitlementPlanExpMsFromJwt,
      entitlementOfflineUntilMsFromJwt,
      entitlementDeviceMatch,
    });
  }

  const local = await getLocalCompanyById(localCompanyId);
  if (!local) {
    writePlanAuthoritativeSyncTimestamp(localCompanyId);
    return { ok: true, applied: false, reason: "no_local_sqlite_row" };
  }

  const storageLower = String((local as { storageOption?: string }).storageOption || "").toLowerCase();
  const isPureLocalDeviceCompany = storageLower === "local";
  const isDriveLocalRegistry = isDriveCloudSyncLocalRegistryRow(local as Record<string, unknown>);

  const offlineUntil =
    typeof data.offlineLicenseValidUntilMs === "number" && Number.isFinite(data.offlineLicenseValidUntilMs)
      ? data.offlineLicenseValidUntilMs
      : undefined;

  const merged: Record<string, unknown> = {
    ...local,
    planId,
    planUpgradedAtMs: Date.now(),
    ...(offlineUntil != null ? { offlineLicenseValidUntilMs: offlineUntil } : {}),
    ...(data.stripeCustomerId != null && data.stripeCustomerId !== ""
      ? { stripeCustomerId: data.stripeCustomerId }
      : {}),
    ...(data.stripeSubscriptionId != null && data.stripeSubscriptionId !== ""
      ? { stripeSubscriptionId: data.stripeSubscriptionId }
      : {}),
    ...(data.lastStripeCheckoutSessionId
      ? { lastStripeCheckoutSessionId: data.lastStripeCheckoutSessionId }
      : {}),
  };

  if (!isPureLocalDeviceCompany) {
    merged.authoritativeCompanyId = firebaseCompanyId;
    merged.syncedFromCloud = true;
    merged.syncPolicy = "online";
    merged.storageOption = "firebase";
  } else if (isDriveLocalRegistry) {
    merged.storageOption = "local";
    merged.syncPolicy = "offline";
    merged.syncedFromCloud = false;
    merged.planSyncFirestoreCompanyId = firebaseCompanyId;
    delete merged.authoritativeCompanyId;
  } else {
    // Pure local SQLite company — plan metadata only; identity stays local (never cloud-backed).
    merged.storageOption = "local";
    merged.syncPolicy = "offline";
    merged.syncedFromCloud = false;
    merged.planSyncFirestoreCompanyId = firebaseCompanyId;
    delete merged.authoritativeCompanyId;
  }
  if (planId === "basic") delete merged.planExpiryMs;
  else if (planExpiryMs != null) merged.planExpiryMs = planExpiryMs;

  await upsertLocalCompany(merged as LocalCompanyDoc);

  writePlanAuthoritativeSyncTimestamp(localCompanyId);
  bumpLocalCompanyRegistry();
  return { ok: true, applied: true };
}

/** Audit harness only — exercises production plan apply path without duplicating logic. */
export async function applyAuthoritativePlanPayloadToLocalForAudit(opts: {
  firebaseCompanyId: string;
  localCompanyId: string;
  data: ServerAuthoritativePlanPayload;
}): Promise<SyncCompanyPlanResult> {
  return applyAuthoritativePlanPayloadToLocal(opts);
}

/** Pure device-local company: Firestore `users/{uid}` account plan + owned online rows se SQLite plan patch. */
export async function syncLocalOnlyCompanyPlanFromOwnerAccount(opts: {
  localCompanyId: string;
  firebaseUid: string;
  ownedCompaniesHint?: ReadonlyArray<{
    id?: string;
    planId?: string | null;
    planExpiryMs?: number;
    isOwned?: boolean;
    ownerId?: string;
  }>;
}): Promise<SyncCompanyPlanResult> {
  const localCompanyId = String(opts.localCompanyId || "").trim();
  const uid = String(opts.firebaseUid || "").trim();
  if (!localCompanyId || !uid) return { ok: false, applied: false, reason: "missing_ids" };

  if (isHostedPlanSyncDisabled()) {
    return { ok: true, applied: false, reason: "hosted_plan_sync_disabled" };
  }

  let planId = normalizePlanIdForClient("basic");
  let planExpiryMs: number | null = null;
  let stripeCustomerId: string | null = null;
  let stripeSubscriptionId: string | null = null;
  let lastStripeCheckoutSessionId: string | null = null;
  let firebaseCompanyId = localCompanyId;

  try {
    const userSnap = await getDoc(doc(firestore, "users", uid));
    if (userSnap.exists()) {
      const u = userSnap.data() as Record<string, unknown>;
      const canon = u.accountCanonicalPlanId;
      if (typeof canon === "string" && canon.trim()) {
        planId = normalizePlanIdForClient(canon);
        const exp = u.accountCanonicalPlanExpiryMs;
        if (typeof exp === "number" && Number.isFinite(exp)) planExpiryMs = exp;
        stripeCustomerId =
          typeof u.accountCanonicalStripeCustomerId === "string" && u.accountCanonicalStripeCustomerId.trim()
            ? u.accountCanonicalStripeCustomerId.trim()
            : null;
        stripeSubscriptionId =
          typeof u.accountCanonicalStripeSubscriptionId === "string" &&
          u.accountCanonicalStripeSubscriptionId.trim()
            ? u.accountCanonicalStripeSubscriptionId.trim()
            : null;
        writeAccountPlanLocalCache(uid, {
          planId,
          planExpiryMs,
          stripeCustomerId,
          stripeSubscriptionId,
        });
      }
    }
  } catch {
    /* user doc optional */
  }

  const hintBest = highestPlanIdAmongOwnedCompanies(opts.ownedCompaniesHint ?? [], uid);
  if (hintBest && planTierIndex(hintBest) > planTierIndex(planId)) {
    planId = hintBest;
    const bestRow = (opts.ownedCompaniesHint ?? []).find(
      (c) =>
        c.isOwned === true &&
        String(c.ownerId || "").trim() === uid &&
        normalizePlanIdForClient(c.planId) === hintBest
    );
    if (bestRow?.id) firebaseCompanyId = String(bestRow.id).trim();
    if (typeof bestRow?.planExpiryMs === "number" && Number.isFinite(bestRow.planExpiryMs)) {
      planExpiryMs = bestRow.planExpiryMs;
    }
  }

  if (planId === "basic" && !hintBest) {
    writePlanAuthoritativeSyncTimestamp(localCompanyId);
    return { ok: true, applied: false, reason: "no_account_plan" };
  }

  return applyAuthoritativePlanPayloadToLocal({
    firebaseCompanyId,
    localCompanyId,
    data: {
      companyId: firebaseCompanyId,
      planId,
      planExpiryMs,
      stripeCustomerId,
      stripeSubscriptionId,
      lastStripeCheckoutSessionId,
    },
  });
}

async function syncCompanyPlanFromFirestoreClientFallback(opts: {
  firebaseCompanyId: string;
  localCompanyId: string;
}): Promise<SyncCompanyPlanResult> {
  try {
    const snap = await getDoc(doc(firestore, "companies", opts.firebaseCompanyId));
    if (!snap.exists()) {
      return { ok: false, applied: false, reason: "company_not_found" };
    }
    const data = (snap.data() || {}) as Record<string, unknown>;
    if (data.isDeleted === true) {
      return { ok: false, applied: false, reason: "company_deleted" };
    }

    const planId = normalizePlanIdForClient(data.planId != null ? String(data.planId) : undefined);
    const planExpiryMs = planExpiryMsFromCompanyData(data);
    const local = await getLocalCompanyById(opts.localCompanyId);
    const localOffline = (local as { offlineLicenseValidUntilMs?: unknown } | null)?.offlineLicenseValidUntilMs;
    const prevOffline =
      typeof localOffline === "number" && Number.isFinite(localOffline)
        ? localOffline
        : typeof data.offlineLicenseValidUntilMs === "number" && Number.isFinite(data.offlineLicenseValidUntilMs)
          ? data.offlineLicenseValidUntilMs
          : undefined;
    const offlineLicenseValidUntilMs = computeOfflineLicenseValidUntilMs(planId, planExpiryMs, prevOffline);

    return applyAuthoritativePlanPayloadToLocal({
      firebaseCompanyId: opts.firebaseCompanyId,
      localCompanyId: opts.localCompanyId,
      data: {
        companyId: opts.firebaseCompanyId,
        planId,
        planExpiryMs,
        offlineLicenseValidUntilMs,
        stripeCustomerId:
          typeof data.stripeCustomerId === "string" && data.stripeCustomerId.trim()
            ? data.stripeCustomerId.trim()
            : null,
        stripeSubscriptionId:
          typeof data.stripeSubscriptionId === "string" && data.stripeSubscriptionId.trim()
            ? data.stripeSubscriptionId.trim()
            : null,
        lastStripeCheckoutSessionId:
          typeof data.lastStripeCheckoutSessionId === "string" && data.lastStripeCheckoutSessionId.trim()
            ? data.lastStripeCheckoutSessionId.trim()
            : null,
      },
    });
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code || "") : "";
    if (code === "permission-denied" || code === "PERMISSION_DENIED") {
      return { ok: false, applied: false, reason: "forbidden" };
    }
    return { ok: false, applied: false, reason: "network" };
  }
}

/** Online + healthy: har 5 min plan sync. */
export const PLAN_SERVER_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Online + stale banner: tez retry (live sync jab tak server touch na ho). */
export const PLAN_SERVER_SYNC_STALE_INTERVAL_MS = 60 * 1000;

const DAILY_AUTH_PLAN_SYNC_YMD_KEY = (uid: string) =>
  `pocket-ledger:dailyAuthoritativePlanSyncYmd:${uid.trim()}`;

/** Calendar day (UTC `YYYY-MM-DD`) — idle par dubara POST tabhi jab aaj ka sync abhi tak successful na ho. */
export function shouldRunDailyAuthoritativePlanSync(firebaseUid: string | undefined | null): boolean {
  if (!firebaseUid?.trim() || typeof window === "undefined") return false;
  const today = new Date().toISOString().slice(0, 10);
  try {
    return window.localStorage.getItem(DAILY_AUTH_PLAN_SYNC_YMD_KEY(firebaseUid)) !== today;
  } catch {
    return true;
  }
}

/** Successful `syncCompanyPlanFromServer` ke baad — aaj ke liye idle repeat band (manual/online alag se chal sakte hain). */
export function markDailyAuthoritativePlanSyncDone(firebaseUid: string | undefined | null): void {
  if (!firebaseUid?.trim() || typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    window.localStorage.setItem(DAILY_AUTH_PLAN_SYNC_YMD_KEY(firebaseUid), today);
  } catch {
    /* private mode */
  }
}

/** Optional “plans doc verify” stale — banner alag 20-din wala primary */
export const PLAN_SYNC_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** 20 din server touch nahi → user ko online sync dikhane ka banner */
export const OFFLINE_PLAN_SYNC_WARNING_MS = 20 * 24 * 60 * 60 * 1000;

const SYNC_AT_KEY = (localCompanyId: string) =>
  `pocket-ledger:planAuthoritativeSyncAt:${localCompanyId.trim()}`;

export type ServerAuthoritativePlanPayload = {
  companyId: string;
  authoritativeCompanyId?: string;
  localCompanyId?: string;
  planId: string;
  planExpiryMs: number | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  lastStripeCheckoutSessionId?: string | null;
  offlineLicenseValidUntilMs?: number;
  /** Server RS256 — client `NEXT_PUBLIC_PLAN_ENTITLEMENT_JWT_PUBLIC_KEY_PEM` se verify. */
  planEntitlementJws?: string | null;
};

export function writePlanAuthoritativeSyncTimestamp(localCompanyId: string, atMs: number = Date.now()): void {
  if (typeof window === "undefined" || !localCompanyId?.trim()) return;
  try {
    window.localStorage.setItem(SYNC_AT_KEY(localCompanyId), String(atMs));
  } catch {
    /* ignore */
  }
}

export function readPlanAuthoritativeSyncTimestamp(localCompanyId: string): number | null {
  if (typeof window === "undefined" || !localCompanyId?.trim()) return null;
  try {
    const raw = window.localStorage.getItem(SYNC_AT_KEY(localCompanyId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export type PlanSyncBannerState = {
  lastSuccessAtMs: number | null;
  isStale: boolean;
  needsOnlinePlanSync: boolean;
  offlineLicenseValidUntilMs: number | null;
  offlineLicenseExpired: boolean;
  /** Browser offline — stale/20d banner mat dikhao; sync band */
  isBrowserOnline: boolean;
  /** Online live sync chal rahi hai — "stay online" flash kam */
  planSyncInFlight: boolean;
};

/** Profile banner: 3d tech stale + 20d mandatory online + server offline window */
export function recomputePlanSyncBannerState(
  localCompanyId: string | null,
  companyShape: { offlineLicenseValidUntilMs?: number } | null,
  opts?: { online?: boolean; planSyncInFlight?: boolean }
): PlanSyncBannerState {
  const isBrowserOnline =
    opts?.online ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
  const planSyncInFlight = opts?.planSyncInFlight === true;

  if (!localCompanyId?.trim()) {
    return {
      lastSuccessAtMs: null,
      isStale: false,
      needsOnlinePlanSync: false,
      offlineLicenseValidUntilMs: null,
      offlineLicenseExpired: false,
      isBrowserOnline,
      planSyncInFlight,
    };
  }
  const lastSuccessAtMs = readPlanAuthoritativeSyncTimestamp(localCompanyId);
  const isStale =
    isBrowserOnline &&
    !planSyncInFlight &&
    lastSuccessAtMs != null &&
    Date.now() - lastSuccessAtMs > PLAN_SYNC_STALE_AFTER_MS;
  const needsOnlinePlanSync =
    isBrowserOnline &&
    !planSyncInFlight &&
    lastSuccessAtMs != null &&
    Date.now() - lastSuccessAtMs > OFFLINE_PLAN_SYNC_WARNING_MS;
  const rawUntil = companyShape?.offlineLicenseValidUntilMs;
  const offlineLicenseValidUntilMs =
    typeof rawUntil === "number" && Number.isFinite(rawUntil) ? rawUntil : null;
  const offlineLicenseExpired =
    offlineLicenseValidUntilMs != null && Date.now() > offlineLicenseValidUntilMs;
  return {
    lastSuccessAtMs,
    isStale,
    needsOnlinePlanSync,
    offlineLicenseValidUntilMs,
    offlineLicenseExpired,
    isBrowserOnline,
    planSyncInFlight,
  };
}

export type SyncCompanyPlanResult = { ok: boolean; applied: boolean; reason?: string };

/** Profile / toast: machine `reason` → user text. */
export function planSyncFailureUserMessage(reason?: string): string {
  if (!reason) return "Something went wrong. Try again.";
  // APK: fetch fail ke turant baad `offline` event — pehle "network" return hone se bachao.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You are offline";
  }
  if (reason === "offline") return "You are offline";
  if (reason === "network" || reason === "timeout") {
    return "Check your internet connection and try again.";
  }
  if (reason === "static_no_billing_api") {
    return "Plan server is not configured for this build. Check your internet or contact support.";
  }
  if (reason === "token_error") return "Could not verify your login. Sign out and sign in again.";
  if (reason === "missing_ids" || reason === "no_context") return "No company selected to sync.";
  if (reason === "local_only_company") return "Local-only company does not require server plan sync yet.";
  if (reason === "Firebase Admin not configured") {
    return "Firebase Admin is not set up on this dev server. Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env.local, or use localhost (client fallback applies automatically).";
  }
  if (reason.startsWith("http_")) return "Plan server returned an error. Try again later.";
  return reason;
}

/** Fetch timeout helper — static `serve`/APK par broken `/api/*` kabhi‑kabhi lambi pending rakhta hai UI block feel. */
const PLAN_SYNC_FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const tid = typeof setTimeout !== "undefined" ? setTimeout(() => ctrl.abort(), ms) : undefined;
  try {
    return await hostedApiFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    if (tid !== undefined) clearTimeout(tid);
  }
}

/** Plan sync POST: flaky dev server / billing proxy par 5xx ya TCP reset — bounded retry. */
const PLAN_SYNC_FETCH_MAX_ATTEMPTS = 3;

export async function syncCompanyPlanFromServer(opts: {
  /** Firestore `companies/{id}` */
  firebaseCompanyId: string;
  /** SQLite row id (selected company) — missing par firebase id */
  localCompanyId: string;
  getIdToken: () => Promise<string>;
  firebaseUid?: string;
  ownedCompaniesHint?: ReadonlyArray<{
    id?: string;
    planId?: string | null;
    planExpiryMs?: number;
    isOwned?: boolean;
    ownerId?: string;
  }>;
}): Promise<SyncCompanyPlanResult> {
  if (isHostedPlanSyncDisabled()) {
    return { ok: true, applied: false, reason: "hosted_plan_sync_disabled" };
  }
  // Pehle network: token / POST se pehle clear "offline" message (static build bhi).
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, applied: false, reason: "offline" };
  }
  // Gate→Connect staff tab (host origin): hosted sync-plan CORS noise avoid.
  if (typeof window !== "undefined" && isPlRemoteServerClientMode()) {
    return { ok: false, applied: false, reason: "pl_remote_client" };
  }
  const firebaseCompanyId = opts.firebaseCompanyId.trim();
  const localCompanyId = opts.localCompanyId.trim();
  if (!firebaseCompanyId || !localCompanyId) {
    return { ok: false, applied: false, reason: "missing_ids" };
  }

  // Pure local company (no authoritative cloud id yet): hosted `/sync-plan` par 404 noise avoid.
  // PlServer shared (`plServerShared`): registry id = Firestore company id — local_only mat treat karo.
  try {
    const localRow = await getLocalCompanyById(localCompanyId);
    if (localRow && !isServerGateCompany(localRow)) {
      const storage = String((localRow as { storageOption?: string }).storageOption || "local")
        .toLowerCase()
        .trim();
      const authoritative = String((localRow as { authoritativeCompanyId?: string }).authoritativeCompanyId || "")
        .trim();
      if (storage === "local" && !authoritative) {
        const uid = String(opts.firebaseUid || "").trim();
        if (uid) {
          return syncLocalOnlyCompanyPlanFromOwnerAccount({
            localCompanyId,
            firebaseUid: uid,
            ownedCompaniesHint: opts.ownedCompaniesHint,
          });
        }
        return { ok: true, applied: false, reason: "local_only_company" };
      }
    }
  } catch {
    // Local DB read fail par sync ko block mat karo; fallback path continue kare.
  }

  // Pocket Ledger Server login: never call the Firebase-backed plan route (firebase-admin Firestore read).
  if (isPocketBaseAppSessionMarked()) {
    return { ok: true, applied: false, reason: "server_login_session" };
  }

  let token: string;
  try {
    token = await opts.getIdToken();
  } catch {
    return { ok: false, applied: false, reason: "token_error" };
  }

  const syncPlanPath = "/api/company/sync-plan";
  const primaryUrl = getBillingApiUrl(syncPlanPath);
  const fetchOpts: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId: firebaseCompanyId,
      localCompanyId,
      clientDeviceId: getOrCreateClientDeviceId(),
    }),
  };

  /** Transient failures (ECONNRESET, aborted compile) pe dubara POST; deterministic errors (401/403) pe break. */
  let res!: Response;
  for (let attempt = 1; attempt <= PLAN_SYNC_FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetchWithTimeout(primaryUrl, fetchOpts, PLAN_SYNC_FETCH_TIMEOUT_MS);
      if (res.status < 500 || attempt === PLAN_SYNC_FETCH_MAX_ATTEMPTS) break;
    } catch (e: unknown) {
      const aborted =
        typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
      if (attempt === PLAN_SYNC_FETCH_MAX_ATTEMPTS) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          return { ok: false, applied: false, reason: "offline" };
        }
        return { ok: false, applied: false, reason: aborted ? "timeout" : "network" };
      }
    }
    await new Promise((r) => setTimeout(r, 280 * attempt));
  }

  // Dev full Next: remote 404 par same-origin `/api` retry — APK par localhost:3000 mat kholo.
  const triedRemote = typeof primaryUrl === "string" && /^https?:\/\//i.test(primaryUrl);
  if (res.status === 404 && triedRemote && typeof window !== "undefined" && !isCapacitorNativeApp()) {
    try {
      res = await fetchWithTimeout(syncPlanPath, fetchOpts, PLAN_SYNC_FETCH_TIMEOUT_MS);
    } catch (e: unknown) {
      const aborted = typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return { ok: false, applied: false, reason: "offline" };
      }
      return { ok: false, applied: false, reason: aborted ? "timeout" : "network" };
    }
  }

  let errMsg = `http_${res.status}`;
  let data: ServerAuthoritativePlanPayload & { error?: string } | null = null;
  try {
    data = (await res.json()) as ServerAuthoritativePlanPayload & { error?: string };
    if (typeof data?.error === "string") errMsg = data.error;
  } catch {
    /* ignore */
  }

  if (!res.ok || !data?.companyId) {
    if (
      isLocalDevPlanSyncFallbackEligible() &&
      (res.status === 503 || errMsg === "Firebase Admin not configured")
    ) {
      return syncCompanyPlanFromFirestoreClientFallback({
        firebaseCompanyId,
        localCompanyId,
      });
    }
    return { ok: false, applied: false, reason: errMsg };
  }

  return applyAuthoritativePlanPayloadToLocal({
    firebaseCompanyId,
    localCompanyId,
    data: data as ServerAuthoritativePlanPayload,
  });
}
