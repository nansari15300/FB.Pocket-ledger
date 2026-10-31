/**
 * Online company FY/month pagination — Firestore query builders.
 * Full listener replacement is phased; these queries hydrate SQLite month pages.
 */
import { collection, orderBy, query, where, type Query } from "@/lib/pbCompat/firestore";
import { endOfMonth, startOfMonth } from "date-fns";
import { firestore } from "@/lib/firebase";
import type { FyDateRangeMs } from "@/lib/fyPagination/types";

export function firestoreVouchersQueryForRange(
  fsCompanyId: string,
  range: FyDateRangeMs
): Query {
  const fromDate = new Date(range.fromMs);
  const toDate = new Date(range.toMs);
  return query(
    collection(firestore, `companies/${fsCompanyId}/vouchers`),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
    orderBy("date", "asc")
  );
}

export function currentCalendarMonthRange(today = new Date()): FyDateRangeMs {
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

export function fySnapshotDocPath(fsCompanyId: string, periodKind: "month" | "fy", periodKey: string): string {
  return `companies/${fsCompanyId}/fySnapshots/${periodKind}_${periodKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
