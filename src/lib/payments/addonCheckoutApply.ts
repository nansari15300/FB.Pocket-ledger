/**
 * Stripe / gateway fulfillment — grant extra device or user slots on the owner user doc.
 * Expiry = active company planExpiryMs (same subscription period).
 * One payment can include multiple kinds (e.g. devices + users together).
 */
import "server-only";
import type admin from "@/lib/server/pbAdminTypes";
import { resolveOwnerActivePaidSubscription } from "@/lib/server/resolveOwnerSubscriptionBilling";
import { normalizeAddonKind, type AddonKind } from "@/lib/planAddOns";
import { packAddonItemsForStorage } from "@/lib/payments/addonItemsPacked";
import { mirrorAddonPurchaseToAdminCompany } from "@/lib/payments/mirrorAddonPurchaseToAdminCompany";

import { serverTimestamp } from "@/lib/server/pbBilling/fieldValue";

export const PENDING_ADDON_PURCHASES_COLLECTION = "pending_addon_purchases";
export const PENDING_ADDON_PURCHASE_TTL_MS = 60 * 60 * 1000;

export type AddonPurchaseLine = {
  kind: AddonKind | string;
  quantity: number;
};

export type ApplyAddonPurchaseInput = {
  db: admin.firestore.Firestore;
  companyId: string;
  userId: string;
  paymentId: string;
  gateway: "stripe" | "khalti" | "esewa";
  amount: number;
  currency: string;
  /** Legacy single-line */
  kind?: AddonKind | string;
  quantity?: number;
  /** Multi-line (preferred) */
  items?: AddonPurchaseLine[];
};

export type ApplyAddonPurchaseResult =
  | { ok: true }
  | { ok: false; reason: string };

function fieldForKind(kind: AddonKind): string {
  switch (kind) {
    case "device-online":
      return "addonExtraDevicesOnline";
    case "device-local":
      return "addonExtraDevicesLocal";
    case "user-online":
      return "addonExtraUsersOnline";
    case "user-local":
      return "addonExtraUsersLocal";
    case "company-online":
      return "addonExtraCompaniesOnline";
    case "company-local":
      return "addonExtraCompaniesLocal";
  }
}

function normalizeItems(input: ApplyAddonPurchaseInput): { kind: AddonKind; quantity: number }[] {
  const raw =
    Array.isArray(input.items) && input.items.length > 0
      ? input.items
      : input.kind != null
        ? [{ kind: input.kind, quantity: input.quantity ?? 1 }]
        : [];
  const merged = new Map<AddonKind, number>();
  for (const row of raw) {
    const kind = normalizeAddonKind(row.kind);
    const qty = Math.max(0, Math.min(50, Math.floor(Number(row.quantity) || 0)));
    if (qty <= 0) continue;
    merged.set(kind, (merged.get(kind) || 0) + qty);
  }
  return [...merged.entries()].map(([kind, quantity]) => ({ kind, quantity }));
}

/** Parse checkout metadata `addonItems` = "device-online:2,user-online:1" (or legacy addonKind + addonQuantity). */
export function parseAddonItemsFromCheckoutMetadata(metadata: {
  addonItems?: string | null;
  addonKind?: string | null;
  addonQuantity?: string | null;
}): { kind: AddonKind; quantity: number }[] {
  const packed = String(metadata.addonItems || "").trim();
  if (packed) {
    const items: { kind: AddonKind; quantity: number }[] = [];
    for (const part of packed.split(",")) {
      const [k, q] = part.split(":");
      const kind = normalizeAddonKind(k);
      const quantity = Math.max(0, Math.min(50, Math.floor(Number(q) || 0)));
      if (quantity > 0) items.push({ kind, quantity });
    }
    if (items.length > 0) return items;
  }
  const kind = normalizeAddonKind(metadata.addonKind);
  const quantity = Math.max(1, Math.floor(Number(metadata.addonQuantity) || 1));
  return [{ kind, quantity }];
}

export async function applyAddonPurchaseToFirestore(
  input: ApplyAddonPurchaseInput
): Promise<ApplyAddonPurchaseResult> {
  const { db, companyId, userId, paymentId, gateway, amount, currency } = input;
  const items = normalizeItems(input);
  if (!userId.trim()) return { ok: false, reason: "missing_userId" };
  if (items.length === 0) return { ok: false, reason: "empty_addon_items" };

  const sub = await resolveOwnerActivePaidSubscription(db, userId, companyId || null);
  if (sub.ok === false) {
    return {
      ok: false,
      reason: sub.status === 403 ? "owner_only" : "no_active_paid_period",
    };
  }
  const { expiryMs, paymentCompanyId } = sub.subscription;
  const effectiveCompanyId = paymentCompanyId || companyId?.trim() || "";
  const ownerId = userId.trim();

  const payRef = effectiveCompanyId
    ? db.collection("companies").doc(effectiveCompanyId).collection("payments").doc(paymentId)
    : db.collection("users").doc(ownerId).collection("billing_payments").doc(paymentId);
  const paySnap = await payRef.get();
  if (paySnap.exists && (paySnap.data() as { addonFulfillComplete?: boolean }).addonFulfillComplete === true) {
    try {
      await mirrorAddonPurchaseToAdminCompany(db, {
        paymentId,
        userId,
        companyId: effectiveCompanyId || userId,
        amount,
        gateway,
        items,
      });
    } catch (err) {
      console.error("[addonCheckoutApply] admin panel mirror retry failed", err);
    }
    return { ok: true };
  }

  const addonItemsPacked = packAddonItemsForStorage(items);

  const userRef = db.collection("users").doc(ownerId);
  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const udata = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      addonExpiryMs: expiryMs,
      updatedAt: serverTimestamp(),
    };
    for (const { kind, quantity } of items) {
      const field = fieldForKind(kind);
      const prev = Math.max(0, Math.floor(Number(udata[field]) || 0));
      patch[field] = prev + quantity;
    }
    tx.set(userRef, patch, { merge: true });
    tx.set(
      payRef,
      {
        paymentId,
        userId,
        amount,
        currency: currency.toLowerCase(),
        gateway,
        status: "completed",
        billingIntent: `addon_bundle`,
        addonItems: addonItemsPacked,
        addonItemsPacked,
        addonKind: items[0]?.kind,
        addonQuantity: items.reduce((s, i) => s + i.quantity, 0),
        addonFulfillComplete: true,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  try {
    await mirrorAddonPurchaseToAdminCompany(db, {
      paymentId,
      userId,
      companyId: effectiveCompanyId || userId,
      amount,
      gateway,
      items,
    });
  } catch (err) {
    console.error("[addonCheckoutApply] admin panel mirror failed", err);
  }

  return { ok: true };
}
