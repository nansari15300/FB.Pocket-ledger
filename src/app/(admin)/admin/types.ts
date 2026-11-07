import type { Timestamp } from "@/lib/pbCompat/firestore";
import type { PlanId } from "@/config/plans";

/**
 * Shared admin types (used by Users, Payments, Logs, etc.).
 * Company type was moved here so the Companies page can be removed without breaking other admin pages.
 */
export type Company = {
  id: string;
  name: string;
  planId?: PlanId;
  planExpiry: Timestamp;
  settings?: Record<string, boolean>;
  ownerId: string;
  ownerEmail?: string;
  /** Tracked usage for plan limits (bytes). */
  attachmentsUsedBytes?: number;
  storageUsedBytes?: number;
  [key: string]: any;
};
