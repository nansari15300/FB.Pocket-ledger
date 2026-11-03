import type { HrLeave, HrLeaveStatus, HrLeaveType } from "../types";
import { isIsoDate } from "./attendance";

export const HR_LEAVE_TYPES: HrLeaveType[] = ["casual", "sick", "paid", "unpaid"];

export const HR_LEAVE_TYPE_LABEL: Record<HrLeaveType, string> = {
  casual: "Casual",
  sick: "Sick",
  paid: "Paid",
  unpaid: "Unpaid",
};

export const HR_LEAVE_STATUS_LABEL: Record<HrLeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** from..to (dono shamil) calendar days. Invalid / to < from → 0. */
export function leaveDayCount(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return 0;
  return Math.round(utcDay(to) - utcDay(from)) + 1;
}

/** Leave is date ko cover karti hai? (YYYY-MM-DD string compare) */
export function leaveCovers(leave: Pick<HrLeave, "from_date" | "to_date">, date: string): boolean {
  return !!leave.from_date && !!leave.to_date && leave.from_date <= date && date <= leave.to_date;
}

/** Do ranges overlap? */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Ek employee ki given date par APPROVED leave (latest updated). */
export function approvedLeaveOn(leaves: HrLeave[], employee: string, date: string): HrLeave | undefined {
  let best: HrLeave | undefined;
  for (const l of leaves) {
    if (!l || l.deleted === true || l.status !== "approved" || l.employee !== employee) continue;
    if (!leaveCovers(l, date)) continue;
    if (!best || Number(l.updatedAtMs || 0) >= Number(best.updatedAtMs || 0)) best = l;
  }
  return best;
}

/** decided_at (ms number / ISO string) → local readable text. */
export function formatDecidedAt(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}
