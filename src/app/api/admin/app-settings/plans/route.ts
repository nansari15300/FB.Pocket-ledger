import { NextRequest, NextResponse } from "next/server";
import type admin from "@/lib/server/pbAdminTypes";

import { resolveSuperAdminCaller } from "@/lib/server/adminCaller";
import {
  sanitizeOnlineDemoOffer,
  type OnlineDemoOffer,
  type Plan,
  type PlanId,
  PLAN_TIER_ORDER,
} from "@/config/plans";
import {
  buildDefaultPlansFirestoreDoc,
  buildOnlineDemoOfferWritePatch,
  readOnlineDemoOfferFromPlansDoc,
  sanitizePlanForFirestoreWrite,
} from "@/lib/mergeAppSettingsPlans";
import {
  deviceUserAddOnOfferForFirestoreWrite,
  sanitizeDeviceUserAddOnOffer,
  type DeviceUserAddOnOffer,
} from "@/lib/planAddOns";

import { deleteField, Timestamp } from "@/lib/server/pbBilling/fieldValue";

function coerceLimitedTimeOfferDate(plan: Record<string, unknown>): Record<string, unknown> {
  const ltd = plan.limitedTimeOfferDate;
  if (typeof ltd === "string" && ltd.trim()) {
    const d = new Date(ltd);
    if (!Number.isNaN(d.getTime())) {
      return { ...plan, limitedTimeOfferDate: Timestamp.fromDate(d) };
    }
    return plan;
  }
  if (!ltd || typeof ltd !== "object") return plan;
  const s = (ltd as { seconds?: unknown; _seconds?: unknown }).seconds ?? (ltd as { _seconds?: unknown })._seconds;
  const n = (ltd as { nanoseconds?: unknown; _nanoseconds?: unknown }).nanoseconds ?? (ltd as { _nanoseconds?: unknown })._nanoseconds;
  if (typeof s === "number" && typeof n === "number") {
    return { ...plan, limitedTimeOfferDate: new Timestamp(s, n) };
  }
  return plan;
}

function isPlanId(s: string): s is PlanId {
  return (PLAN_TIER_ORDER as readonly string[]).includes(s);
}

async function applyExistingDemoAction(opts: {
  db: admin.firestore.Firestore;
  previousPlanId: string;
  nextOffer: OnlineDemoOffer;
  action: "retain" | "reset" | "replace";
}) {
  const { db, previousPlanId, nextOffer, action } = opts;
  if (action === "retain") return;
  if (nextOffer.enabled === true && action !== "replace") return;

  const activeDemoCompanies = await db
    .collection("companies")
    .where("demoPlanId", "==", previousPlanId)
    .where("demoPlanActive", "==", true)
    .get();
  const now = Date.now();
  const replacementDays = nextOffer.days;
  const writes = activeDemoCompanies.docs.map((company) => {
    if (action === "replace") {
      const expiryMs = now + replacementDays * 86_400_000;
      return {
        ref: company.ref,
        patch: {
          planId: nextOffer.planId,
          planExpiry: Timestamp.fromMillis(expiryMs),
          planExpiryMs: expiryMs,
          demoPlanId: nextOffer.planId,
          demoPlanDays: replacementDays,
          demoPlanActive: true,
        },
      };
    }
    return {
      ref: company.ref,
      patch: {
        planId: "basic",
        planExpiry: Timestamp.fromMillis(now),
        planExpiryMs: now,
        demoPlanActive: false,
        demoPlanDisabledAtMs: now,
      },
    };
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 450)) batch.set(write.ref, write.patch, { merge: true });
    await batch.commit();
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveSuperAdminCaller(req);
    if (caller.ok === false) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = (await req.json()) as {
      seedDefaults?: boolean;
      planId?: string;
      plan?: Record<string, unknown>;
      planBillingVisibility?: { planId?: string; hiddenFromBilling?: boolean };
      onlineDemo?: OnlineDemoOffer;
      deviceUserAddOns?: DeviceUserAddOnOffer;
      /** Only used when a SuperAdmin turns a demo off (or replaces days). */
      existingDemoAction?: "retain" | "reset" | "replace";
    };

    const db = caller.db;
    const ref = db.doc("app_settings/plans");

    if (body?.seedDefaults === true) {
      await ref.set(buildDefaultPlansFirestoreDoc(), { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (body?.onlineDemo != null) {
      const snap = await ref.get();
      const previous = readOnlineDemoOfferFromPlansDoc(
        snap.exists ? (snap.data() as Record<string, unknown>) : undefined
      );
      const nextOffer = sanitizeOnlineDemoOffer(body.onlineDemo);
      await ref.set(
        {
          ...buildOnlineDemoOfferWritePatch(nextOffer),
          entitlementCapConvention: "zero_means_none",
        },
        { merge: true }
      );
      const action = body.existingDemoAction;
      if (
        previous.enabled === true &&
        nextOffer.enabled !== true &&
        (action === "reset" || action === "replace")
      ) {
        await applyExistingDemoAction({
          db,
          previousPlanId: previous.planId,
          nextOffer,
          action,
        });
      }
      return NextResponse.json({ ok: true, onlineDemo: nextOffer });
    }

    if (body?.deviceUserAddOns != null) {
      const nextOffer = sanitizeDeviceUserAddOnOffer(body.deviceUserAddOns);
      const deviceUserAddOns = deviceUserAddOnOfferForFirestoreWrite(nextOffer);
      await ref.set(
        {
          deviceUserAddOns: {
            ...deviceUserAddOns,
            hiddenFromBilling: deleteField(),
          },
          entitlementCapConvention: "zero_means_none",
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true, deviceUserAddOns: nextOffer });
    }

    const visibility = body?.planBillingVisibility;
    if (visibility != null && typeof visibility === "object") {
      const planId = String(visibility.planId || "").trim();
      if (!isPlanId(planId)) {
        return NextResponse.json({ error: "planBillingVisibility.planId invalid" }, { status: 400 });
      }
      const hiddenFromBilling = visibility.hiddenFromBilling === true;
      await ref.set(
        {
          [planId]: { hiddenFromBilling },
          entitlementCapConvention: "zero_means_none",
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true, planId, hiddenFromBilling });
    }

    const planId = body?.planId;
    const rawPlan = body?.plan;
    if (!planId || !isPlanId(planId) || !rawPlan || typeof rawPlan !== "object") {
      return NextResponse.json({ error: "planId and plan required" }, { status: 400 });
    }

    // Plan detail saves must not fight the catalog-level onlineDemo card.
    const { demo: _ignoredDemo, ...planWithoutDemo } = rawPlan as Record<string, unknown>;
    const withId = { ...planWithoutDemo, id: planId };
    const coerced = coerceLimitedTimeOfferDate(withId);
    const payload = sanitizePlanForFirestoreWrite(coerced as unknown as Plan);
    await ref.set(
      { [planId]: payload, entitlementCapConvention: "zero_means_none" },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/app-settings/plans]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
