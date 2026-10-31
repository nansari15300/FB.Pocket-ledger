import { pbRequest } from "@/lib/pocketbaseData/pbClient";

export type ServerSubscriptionPaymentRow = {
  id: string;
  companyId: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  paymentId: string;
  createdAtMs: number | null;
  planExpiryMs: number | null;
  planChangeFrom: string | null;
  planChangeTo: string | null;
  planChangeHistory: Record<string, unknown> | null;
};

/** Wire time `{__fsTs,seconds,nanoseconds}` / number / ISO string -> ms. */
function msOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object") {
    const o = v as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown };
    const s = Number(o.seconds ?? o._seconds);
    if (Number.isFinite(s)) return s * 1000 + Math.floor(Number(o.nanoseconds || 0) / 1e6);
  }
  return null;
}

const str = (v: unknown) => (v == null ? "" : String(v));

/**
 * Admin > Payments on a Pocket Ledger Server login: every subscription payment (company payments,
 * account billing_payments and root payments) from the server, newest first.
 */
export async function listServerSubscriptionPayments(cap = 500): Promise<ServerSubscriptionPaymentRow[]> {
  const res = (await pbRequest("/api/pl/admin/list", { method: "POST", body: { parent: "billing_payments" } })) as {
    docs?: Array<{ path?: string; id?: string; data?: Record<string, unknown> }>;
  };
  const rows: ServerSubscriptionPaymentRow[] = (res?.docs ?? []).map((d) => {
    const data = (d.data ?? {}) as Record<string, unknown>;
    const exp = data.planExpiryMs ?? data.planExpiry;
    const hist = data.planChangeHistory;
    return {
      id: str(d.id),
      companyId: str(data.companyId),
      userId: str(data.userId),
      planId: str(data.planId),
      amount: Number(data.amount) || 0,
      currency: str(data.currency) || "NPR",
      gateway: str(data.gateway),
      status: str(data.status),
      paymentId: str(data.paymentId) || str(d.id),
      createdAtMs: msOf(data.createdAt ?? data.createdAtMs),
      planExpiryMs: msOf(exp),
      planChangeFrom: data.planChangeFrom == null ? null : str(data.planChangeFrom),
      planChangeTo: data.planChangeTo == null ? null : str(data.planChangeTo),
      planChangeHistory: hist && typeof hist === "object" ? (hist as Record<string, unknown>) : null,
    };
  });
  rows.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return rows.slice(0, cap);
}