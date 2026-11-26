"use client";

/**
 * Employee HR fields live on the staff record (`staff.hr`). This file writes ONLY that sub-object,
 * through the same two paths as EditStaffDialog:
 * - local SQLite mirror companies (`apkEntityWriteUsesLocalSqliteMirror`): browser DB upsert → outbox "update"
 * - otherwise: `persistMasterEntityUpdate` (online update, falls back to SQLite + outbox)
 *
 * The voucher context fingerprint does not include `hr`, so a small HR-local overlay store keeps the
 * latest written values visible right away (picked by `hr.updatedAtMs`).
 */

import {
  getCompanyDocFromBrowserDb,
  upsertCompanyDocInBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import type { StaffHrFields } from "../types";
import { scheduleLeftDateCleanup } from "./hrLeftDateCleanup";

export const HR_STAFF_OVERLAY_EVENT = "pl-hr-staff-hr-updated";

/** companyId → staffId → latest hr written in this session */
const overlay = new Map<string, Map<string, StaffHrFields>>();

export function getHrOverlay(companyId: string): Map<string, StaffHrFields> | undefined {
  return overlay.get(String(companyId || "").trim());
}

function setHrOverlay(companyId: string, staffId: string, hr: StaffHrFields) {
  const cid = String(companyId || "").trim();
  let m = overlay.get(cid);
  if (!m) {
    m = new Map();
    overlay.set(cid, m);
  }
  m.set(staffId, hr);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HR_STAFF_OVERLAY_EVENT, { detail: { companyId: cid, staffId } }));
  }
}

/** Staff form saved `staff.hr` through its own save path: show it in HR lists right away. */
export function rememberStaffHr(companyId: string, staffId: string, hr: StaffHrFields) {
  setHrOverlay(companyId, staffId, hr);
}

/** Returns the candidate with the highest `updatedAtMs` (undefined values are skipped). */
export function pickLatestHr(...candidates: Array<StaffHrFields | null | undefined>): StaffHrFields | undefined {
  let best: StaffHrFields | undefined;
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    if (!best || Number(c.updatedAtMs || 0) > Number(best.updatedAtMs || 0)) best = c;
  }
  return best;
}

function cleanHr(hr: StaffHrFields): StaffHrFields {
  const out: StaffHrFields = {};
  if (hr.designation !== undefined) out.designation = String(hr.designation || "").trim();
  if (hr.department !== undefined) out.department = String(hr.department || "").trim();
  if (hr.joining_date !== undefined) out.joining_date = String(hr.joining_date || "").trim();
  if (hr.status !== undefined) out.status = hr.status === "left" ? "left" : "active";
  // Left date only belongs to a "left" employee; switching back to active drops it.
  if (hr.left_date !== undefined && out.status !== "active") out.left_date = String(hr.left_date || "").trim();
  if (hr.salary_type !== undefined) out.salary_type = hr.salary_type === "daily" ? "daily" : "monthly";
  if (hr.base_salary !== undefined) {
    const n = Number(hr.base_salary);
    out.base_salary = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }
  if (hr.updatedAtMs !== undefined) out.updatedAtMs = Number(hr.updatedAtMs) || 0;
  return out;
}

export type WriteStaffHrParams = {
  company: { storageOption?: string; syncedFromCloud?: boolean } | null | undefined;
  companyId: string;
  staffId: string;
  /** Fields to change. Merged over the current `staff.hr`. */
  patch: StaffHrFields;
  /** Current hr known by the UI (used when the local doc has no hr yet). */
  currentHr?: StaffHrFields;
};

/** Writes `staff.hr` only (never other staff fields). Returns the saved hr object. */
export async function writeStaffHrFields(params: WriteStaffHrParams): Promise<StaffHrFields> {
  const cid = String(params.companyId || "").trim();
  const staffId = String(params.staffId || "").trim();
  if (!cid || !staffId) throw new Error("HR: company or staff id is missing.");

  const fromDb = await getCompanyDocFromBrowserDb(cid, "staff", staffId);
  const dbHr = (fromDb?.hr && typeof fromDb.hr === "object" ? (fromDb.hr as StaffHrFields) : undefined) ?? undefined;
  const base = pickLatestHr(dbHr, params.currentHr, getHrOverlay(cid)?.get(staffId)) || {};
  const hr = cleanHr({ ...base, ...params.patch, updatedAtMs: Date.now() });

  const { apkEntityWriteUsesLocalSqliteMirror } = await import("@/lib/apkOnlineFirestoreWritePolicy");
  if (apkEntityWriteUsesLocalSqliteMirror(params.company)) {
    if (!fromDb) throw new Error("Staff record was not found in the local database.");
    const payload: Record<string, unknown> = { ...fromDb, id: staffId, companyId: cid, hr };
    await upsertCompanyDocInBrowserDb(cid, "staff", staffId, payload);
    const persisted = (await getCompanyDocFromBrowserDb(cid, "staff", staffId)) ?? payload;
    await enqueueCompanyDocOutbox(cid, "staff", "update", staffId, persisted);
  } else {
    const { persistMasterEntityUpdate } = await import("@/lib/masterEntityUpdatePersist");
    const { serverTimestamp } = await import("@/lib/pbCompat/firestore");
    await persistMasterEntityUpdate({
      companyId: cid,
      collection: "staff",
      docId: staffId,
      patch: { hr, updatedAt: serverTimestamp() },
    });
  }

  setHrOverlay(cid, staffId, hr);
  scheduleLeftDateCleanup(cid, staffId, hr);
  return hr;
}
