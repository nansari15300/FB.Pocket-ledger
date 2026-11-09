import { NextRequest, NextResponse } from "next/server";
import type admin from "@/lib/server/pbAdminTypes";

import { corsHeadersForPocketLedgerBillingApi } from "@/lib/server/billingApiCors";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import { applyExpiredPaidPlanAutoDowngradeIfEligible } from "@/lib/server/applyExpiredPaidPlanAutoDowngrade";
import { reconcileOwnerCompaniesPlanWithDriftHeal } from "@/lib/server/accountCanonicalPlan";
import { normalizePlanIdForClient } from "@/config/plans";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

/** `companyId` = Firestore doc id; `localCompanyId` = SQLite row id jab alag ho (offline-first) */
type Body = { companyId?: string; localCompanyId?: string };

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;

/**
 * Next dev (hot reload) / thin Wi‑Fi par Admin SDK kabhi ECONNRESET abort — ek-do retry se POST stable.
 * Non-transient errors ko retry nahi karte (permission, invalid arg, etc.).
 */
function isTransientFirestoreOrNetworkError(e: unknown): boolean {
  const msg = String(
    typeof e === "object" && e !== null && "message" in e ? (e as { message?: unknown }).message : e
  ).toLowerCase();
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code || "")
      : "";
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("aborted") ||
    msg.includes("socket hang up") ||
    msg.includes("deadline exceeded") ||
    code === "UNAVAILABLE" ||
    code === "DEADLINE_EXCEEDED" ||
    code === "ABORTED"
  );
}

type PlanDocSnap = { exists: boolean; data: () => Record<string, unknown> };

async function withFirestoreTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientFirestoreOrNetworkError(e) || attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 120 * attempt));
    }
  }
  throw last;
}

/** Owner ya shared email — plan entitlements sabko same company doc se */
function canReadCompanyPlan(decoded: admin.auth.DecodedIdToken, data: Record<string, unknown>): boolean {
  if (isCompanyOwner(decoded, data as { ownerId?: string; ownerEmail?: string })) return true;
  const emails = Array.isArray(data.sharedWithEmails) ? data.sharedWithEmails : [];
  const e = String(decoded.email || "")
    .toLowerCase()
    .trim();
  if (!e) return false;
  return emails.some((x: unknown) => String(x || "").toLowerCase().trim() === e);
}

/** CORS preflight — static EXE/APK `localhost` → production `sync-plan`. */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersForPocketLedgerBillingApi(req) });
}

/**
 * POST: Bearer token + companyId — Firestore companies/{id} se authoritative plan (Admin SDK).
 * Client SQLite / localStorage cache isi se align hota hai (offline + SaaS sync).
 */
export async function POST(req: NextRequest) {
  const cors = corsHeadersForPocketLedgerBillingApi(req);
  try {
    // Firebase Admin is checked inside resolveBillingCaller (server-login callers don't need it).
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status, headers: cors });
    }
    const decoded = billingCaller.decoded;

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400, headers: cors });
    }
    const localCompanyId =
      typeof body.localCompanyId === "string" && body.localCompanyId.trim()
        ? body.localCompanyId.trim()
        : companyId /* backward compat: same id */;

    const ref = billingCaller.db.collection("companies").doc(companyId);
    const snap = await withFirestoreTransientRetry(() => ref.get() as Promise<PlanDocSnap>);
    if (!snap.exists) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404, headers: cors });
    }

    const data = snap.data() || {};
    if (data.isDeleted === true) {
      return NextResponse.json({ error: "company_deleted" }, { status: 404, headers: cors });
    }

    if (!canReadCompanyPlan(decoded, data)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: cors });
    }

    const db = billingCaller.db;
    /** Paid expiry beet chuki + preference ON → owner sync par Basic (same request me nayi values). */
    const expiredDowngraded = await applyExpiredPaidPlanAutoDowngradeIfEligible({
      db,
      companyRef: ref,
      snapData: data as Record<string, unknown>,
      decoded,
    });
    const liveData = expiredDowngraded
      ? ((await withFirestoreTransientRetry(() => ref.get() as Promise<PlanDocSnap>)).data() || {})
      : data;

    const planId = normalizePlanIdForClient(liveData.planId != null ? String(liveData.planId) : undefined);
    let planExpiryMs: number | null = null;
    if (typeof liveData.planExpiryMs === "number" && Number.isFinite(liveData.planExpiryMs)) {
      planExpiryMs = liveData.planExpiryMs;
    } else {
      const pe = liveData.planExpiry as { toMillis?: () => number } | undefined;
      if (pe && typeof pe.toMillis === "function") planExpiryMs = pe.toMillis();
    }

    const stripeCustomerId =
      typeof liveData.stripeCustomerId === "string" && liveData.stripeCustomerId.trim()
        ? liveData.stripeCustomerId.trim()
        : null;
    const stripeSubscriptionId =
      typeof liveData.stripeSubscriptionId === "string" && liveData.stripeSubscriptionId.trim()
        ? liveData.stripeSubscriptionId.trim()
        : null;
    const lastStripeCheckoutSessionId =
      typeof liveData.lastStripeCheckoutSessionId === "string" && liveData.lastStripeCheckoutSessionId.trim()
        ? liveData.lastStripeCheckoutSessionId.trim()
        : null;
    const autoDowngradeToBasicWhenExpired =
      (liveData as { autoDowngradeToBasicWhenExpired?: unknown }).autoDowngradeToBasicWhenExpired !== false;

    // Offline window: har online sync par max 20 din extend; paid par subscription end se zyada nahi
    const now = Date.now();
    const prevRaw = liveData.offlineLicenseValidUntilMs;
    const prevUntil =
      typeof prevRaw === "number" && Number.isFinite(prevRaw) ? prevRaw : now;
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

    await withFirestoreTransientRetry(() =>
      ref.set(
        {
          linkedLocalCompanyId: localCompanyId,
          offlineLicenseValidUntilMs,
          offlineLicenseUpdatedAtMs: now,
          offlineLicenseLastChunkMs: chunkMs,
        },
        { merge: true }
      )
    );

    // Owner apni company sync kare: Firestore drift heal — max tier + dates sab `companies` + `users` canonical par align.
    const ownerUid = String(liveData.ownerId ?? "").trim();
    let responseData = liveData as Record<string, unknown>;
    if (ownerUid && decoded.uid === ownerUid && isCompanyOwner(decoded, liveData as { ownerId?: string; ownerEmail?: string })) {
      await reconcileOwnerCompaniesPlanWithDriftHeal(db, ownerUid);
      const refetch = await withFirestoreTransientRetry(() => ref.get() as Promise<PlanDocSnap>);
      responseData = (refetch.data() as Record<string, unknown>) || responseData;
    }

    const planIdOut = normalizePlanIdForClient(responseData.planId != null ? String(responseData.planId) : undefined);
    let planExpiryMsOut: number | null = null;
    if (typeof responseData.planExpiryMs === "number" && Number.isFinite(responseData.planExpiryMs)) {
      planExpiryMsOut = responseData.planExpiryMs;
    } else {
      const pe = responseData.planExpiry as { toMillis?: () => number } | undefined;
      if (pe && typeof pe.toMillis === "function") planExpiryMsOut = pe.toMillis();
    }
    const stripeCustomerIdOut =
      typeof responseData.stripeCustomerId === "string" && responseData.stripeCustomerId.trim()
        ? responseData.stripeCustomerId.trim()
        : null;
    const stripeSubscriptionIdOut =
      typeof responseData.stripeSubscriptionId === "string" && responseData.stripeSubscriptionId.trim()
        ? responseData.stripeSubscriptionId.trim()
        : null;
    const lastStripeCheckoutSessionIdOut =
      typeof responseData.lastStripeCheckoutSessionId === "string" && responseData.lastStripeCheckoutSessionId.trim()
        ? responseData.lastStripeCheckoutSessionId.trim()
        : null;

    return NextResponse.json(
      {
        companyId,
        authoritativeCompanyId: companyId,
        localCompanyId,
        planId: planIdOut,
        planExpiryMs: planExpiryMsOut,
        stripeCustomerId: stripeCustomerIdOut,
        stripeSubscriptionId: stripeSubscriptionIdOut,
        lastStripeCheckoutSessionId: lastStripeCheckoutSessionIdOut,
        offlineLicenseValidUntilMs,
        autoDowngradeToBasicWhenExpired,
        ...(expiredDowngraded ? { autoDowngradedToBasicOnSync: true as const } : {}),
      },
      { status: 200, headers: cors }
    );
  } catch (e) {
    console.error("[sync-plan]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: cors });
  }
}
