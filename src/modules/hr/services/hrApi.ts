/**
 * HR module — typed client for PocketBase custom routes `/api/pl/hr/*`.
 *
 * Same pattern as `/api/pl/data/batch`: `pbRequest(path, { method: "POST", body: { company, ... } })`
 * where `company` = app company id (`useCompany().companyId`). Auth token / server URL pbClient khud
 * resolve karta hai (`pl_pb_data_auth_v1` + onlineDataServer). Firebase ka koi use nahi.
 *
 * Plan off hone par server 403 `{ code: "hr_disabled" }` deta hai → `HrDisabledError`.
 */

import { pbRequest, PocketBaseRequestError } from "@/lib/pocketbaseData/pbClient";
import { pbDeviceId, pbServerTime } from "@/lib/pocketbaseData/pbSync";
import type {
  HrCollection,
  HrListParams,
  HrRecordByCollection,
  HrStatus,
  HrUpsertInput,
} from "../types";

const HR_BASE = "/api/pl/hr";
const HR_TIMEOUT_MS = 30_000;

/** Server ne HR plan-gate par 403 `{ code: "hr_disabled" }` diya. */
export class HrDisabledError extends Error {
  readonly code = "hr_disabled" as const;
  readonly status = 403;
  constructor(message = "HR module is not enabled for this company plan.") {
    super(message);
    this.name = "HrDisabledError";
  }
}

export function isHrDisabledError(err: unknown): err is HrDisabledError {
  return err instanceof HrDisabledError;
}

function errorCode(data: unknown): string {
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const direct = rec.code;
    if (typeof direct === "string") return direct;
    // PocketBase kabhi `{ data: { code } }` wrap karta hai.
    const inner = rec.data;
    if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).code === "string") {
      return String((inner as Record<string, unknown>).code);
    }
  }
  return "";
}

function mapHrError(err: unknown): unknown {
  if (err instanceof PocketBaseRequestError && err.status === 403 && errorCode(err.data) === "hr_disabled") {
    return new HrDisabledError();
  }
  return err;
}

function requireCompany(company: string): string {
  const id = String(company || "").trim();
  if (!id) throw new Error("HR: company id missing");
  return id;
}

async function hrPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  try {
    return (await pbRequest(`${HR_BASE}${path}`, {
      method: "POST",
      body,
      timeoutMs: HR_TIMEOUT_MS,
    })) as T;
  } catch (e) {
    throw mapHrError(e);
  }
}

function itemsOf<T>(res: unknown): T[] {
  const items = (res as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

/** Naya app_id (client-generated, PocketBase id jaisa 15-char nahi — server `app_id` field me store karta hai). */
export function newHrAppId(prefix = "hr"): string {
  const rnd =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rnd.slice(0, 20)}`;
}

/** GET /api/pl/hr/status?company= */
export async function getHrStatus(company: string): Promise<HrStatus> {
  const id = requireCompany(company);
  try {
    const res = (await pbRequest(`${HR_BASE}/status?company=${encodeURIComponent(id)}`, {
      method: "GET",
      timeoutMs: HR_TIMEOUT_MS,
    })) as Partial<HrStatus> | null;
    return { enabled: res?.enabled === true, plan_id: res?.plan_id ?? null };
  } catch (e) {
    const mapped = mapHrError(e);
    if (mapped instanceof HrDisabledError) return { enabled: false, plan_id: null };
    throw mapped;
  }
}

/** POST /api/pl/hr/{collection}/list */
export async function listHr<C extends HrCollection>(
  collection: C,
  company: string,
  params: HrListParams = {}
): Promise<HrRecordByCollection[C][]> {
  const body: Record<string, unknown> = { company: requireCompany(company) };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") body[k] = v;
  }
  const res = await hrPost<unknown>(`/${collection}/list`, body);
  return itemsOf<HrRecordByCollection[C]>(res);
}

/** POST /api/pl/hr/{collection}/upsert — updatedAtMs + deviceId yahin bharte hain. */
export async function upsertHr<C extends HrCollection>(
  collection: C,
  company: string,
  records: HrUpsertInput<C>[]
): Promise<HrRecordByCollection[C][]> {
  const deviceId = pbDeviceId();
  const now = pbServerTime(Date.now());
  const payload = records.map((r) => ({
    ...r,
    updatedAtMs: now,
    deviceId,
  }));
  const res = await hrPost<unknown>(`/${collection}/upsert`, {
    company: requireCompany(company),
    records: payload,
  });
  return itemsOf<HrRecordByCollection[C]>(res);
}

/** POST /api/pl/hr/{collection}/delete — soft delete. */
export async function deleteHr(collection: HrCollection, company: string, appIds: string[]): Promise<void> {
  await hrPost<unknown>(`/${collection}/delete`, {
    company: requireCompany(company),
    app_ids: appIds,
  });
}

/** POST /api/pl/hr/leaves/decide */
export async function decideLeave(
  company: string,
  appId: string,
  status: "approved" | "rejected"
): Promise<unknown> {
  return hrPost<unknown>("/leaves/decide", {
    company: requireCompany(company),
    app_id: appId,
    status,
  });
}

/** POST /api/pl/hr/payroll/post */
export async function postPayroll(company: string, appId: string, voucherAppId: string): Promise<unknown> {
  return hrPost<unknown>("/payroll/post", {
    company: requireCompany(company),
    app_id: appId,
    voucher_app_id: voucherAppId,
  });
}

/** Convenience namespace: `hrApi.upsert("employees", companyId, [...])`. */
export const hrApi = {
  status: getHrStatus,
  list: listHr,
  upsert: upsertHr,
  remove: deleteHr,
  decideLeave,
  postPayroll,
  newAppId: newHrAppId,
};
