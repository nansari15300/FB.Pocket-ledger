import type admin from "@/lib/server/pbAdminTypes";
import { resolveAddonItemsPackedFromPaymentData } from "@/lib/payments/addonItemsPacked";

export type AdminSubscriptionPaymentRow = {
  paymentId: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  companyId: string;
  userEmail?: string | null;
  createdAtMs: number | null;
  planExpiryMs: number | null;
  planChangeFrom: string | null;
  planChangeTo: string | null;
  planChangeHistory: Record<string, unknown> | null;
  billingIntent: string | null;
  addonItems: string | null;
  subscriptionTermKey: string | null;
};

export function isSubscriptionPaymentPaid(status: string): boolean {
  const s = status.toLowerCase().trim();
  return (
    s === "paid" ||
    s === "succeeded" ||
    s === "success" ||
    s === "complete" ||
    s === "completed" ||
    s === "no_payment_required"
  );
}

/**
 * Same merge strategy as `/api/admin/subscription-payments` (no collectionGroup index).
 */
export async function listAdminSubscriptionPayments(
  db: admin.firestore.Firestore,
  cap = 500
): Promise<AdminSubscriptionPaymentRow[]> {
  const companiesSnap = await db.collection("companies").get();
  const allDocs: admin.firestore.QueryDocumentSnapshot[] = [];

  for (const companyDoc of companiesSnap.docs) {
    try {
      const paySnap = await companyDoc.ref.collection("payments").limit(300).get();
      allDocs.push(...paySnap.docs);
    } catch {
      /* skip company */
    }
  }

  try {
    const rootSnap = await db.collection("payments").limit(150).get();
    allDocs.push(...rootSnap.docs);
  } catch {
    /* optional root collection */
  }

  allDocs.sort((a, b) => {
    const ta = (a.data().createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const tb = (b.data().createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    return tb - ta;
  });

  const sliced = allDocs.slice(0, cap);
  return sliced.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    const grand = docSnap.ref.parent.parent;
    const companyId =
      grand != null ? grand.id : String((data.companyId as string | undefined) ?? "");
    const createdAt = data.createdAt as admin.firestore.Timestamp | undefined;
    const rawExpiry = data.planExpiryMs ?? data.planExpiry;
    let planExpiryMs: number | null = null;
    if (typeof rawExpiry === "number" && !Number.isNaN(rawExpiry)) {
      planExpiryMs = rawExpiry;
    } else if (rawExpiry && typeof (rawExpiry as admin.firestore.Timestamp).toMillis === "function") {
      planExpiryMs = (rawExpiry as admin.firestore.Timestamp).toMillis();
    }
    const hist = data.planChangeHistory;
    const planChangeHistory =
      hist != null && typeof hist === "object" ? (hist as Record<string, unknown>) : null;

    return {
      paymentId: String(data.paymentId ?? docSnap.id),
      userId: String(data.userId ?? ""),
      planId: String(data.planId ?? ""),
      amount: typeof data.amount === "number" ? data.amount : Number(data.amount ?? 0),
      currency: String(data.currency ?? ""),
      gateway: String(data.gateway ?? ""),
      status: String(data.status ?? ""),
      companyId,
      userEmail:
        String(data.customerEmail ?? data.userEmail ?? data.email ?? "").trim() || null,
      createdAtMs: createdAt?.toMillis() ?? null,
      planExpiryMs,
      planChangeFrom: data.planChangeFrom != null ? String(data.planChangeFrom) : null,
      planChangeTo: data.planChangeTo != null ? String(data.planChangeTo) : null,
      planChangeHistory,
      billingIntent: data.billingIntent != null ? String(data.billingIntent) : null,
      addonItems: resolveAddonItemsPackedFromPaymentData(data),
      subscriptionTermKey:
        String(data.subscriptionTermKey ?? data.termKey ?? "").trim() || null,
    };
  });
}
