/**
 * Shared admin types - used when (admin) app is excluded from static build.
 */
import type { Timestamp } from "@/lib/pbCompat/firestore";
import type { PlanId } from "@/config/plans";
import type { Role } from "@/utils/rbac";

export type Company = {
  id: string;
  name: string;
  planId?: PlanId;
  planExpiry: Timestamp;
  settings?: Record<string, boolean>;
  ownerId: string;
  ownerEmail?: string;
  attachmentsUsedBytes?: number;
  storageUsedBytes?: number;
  [key: string]: any;
};

export type GroupedCompany = {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhotoURL?: string;
  companies: Company[];
};

export type AppUser = {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  companyId: string | null;
  isActive: boolean;
  online?: boolean;
  lastSeen?: any;
  [key: string]: any;
};
