"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, isFirestoreBlockedForServerSession } from "@/lib/plClientSession";
import type { Entitlements, PlanId } from "@/config/plans";
import { isUnlimitedEntitlementCap } from "@/config/plans";
import { getPlanFromPlans } from "@/hooks/useLivePlans";
import { readCachedPlansRecord, defaultPlansRecordFallback } from "@/lib/plansCatalogCache";
import type { Plan } from "@/config/plans";

/** Owner account monthly counters — attachment wala backup/restore traffic limit (-1 = unlimited, 0 = none). */
export type AttachmentUsageMonth = {
  backups: number;
  restores: number;
};

const LOCAL_USAGE_PREFIX = "pl_attachment_usage_v1_";

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function localUsageKey(ownerUid: string): string {
  return `${LOCAL_USAGE_PREFIX}${ownerUid}`;
}

function readLocalUsage(ownerUid: string): { month: string; usage: AttachmentUsageMonth } {
  if (typeof window === "undefined") {
    return { month: currentMonthKey(), usage: { backups: 0, restores: 0 } };
  }
  try {
    const raw = localStorage.getItem(localUsageKey(ownerUid));
    if (!raw) return { month: currentMonthKey(), usage: { backups: 0, restores: 0 } };
    const parsed = JSON.parse(raw) as { month?: string; backups?: number; restores?: number };
    const month = String(parsed.month || currentMonthKey());
    return {
      month,
      usage: {
        backups: Math.max(0, Number(parsed.backups || 0)),
        restores: Math.max(0, Number(parsed.restores || 0)),
      },
    };
  } catch {
    return { month: currentMonthKey(), usage: { backups: 0, restores: 0 } };
  }
}

function writeLocalUsage(ownerUid: string, month: string, usage: AttachmentUsageMonth): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      localUsageKey(ownerUid),
      JSON.stringify({ month, backups: usage.backups, restores: usage.restores })
    );
  } catch {
    /* quota / private mode */
  }
}

/** Firestore `users/{uid}.attachmentUsageMonthly` — online sync; offline par localStorage. */
async function readFirestoreUsage(ownerUid: string, month: string): Promise<AttachmentUsageMonth | null> {
  if (!ownerUid || typeof navigator !== "undefined" && !navigator.onLine) return null;
  // Pocket Ledger Server login: Firestore unused - local counters only.
  if (isFirestoreBlockedForServerSession()) return null;
  try {
    const snap = await getDoc(doc(firestore, "users", ownerUid));
    if (!snap.exists()) return null;
    const row = (snap.data()?.attachmentUsageMonthly || {}) as Record<
      string,
      { backups?: number; restores?: number }
    >;
    const m = row[month];
    if (!m) return { backups: 0, restores: 0 };
    return {
      backups: Math.max(0, Number(m.backups || 0)),
      restores: Math.max(0, Number(m.restores || 0)),
    };
  } catch {
    return null;
  }
}

async function writeFirestoreUsage(ownerUid: string, month: string, usage: AttachmentUsageMonth): Promise<void> {
  if (!ownerUid || typeof navigator !== "undefined" && !navigator.onLine) return;
  // Pocket Ledger Server login: a Firestore write would never resolve (network off).
  if (isFirestoreBlockedForServerSession()) return;
  try {
    await setDoc(
      doc(firestore, "users", ownerUid),
      {
        attachmentUsageMonthly: {
          [month]: { backups: usage.backups, restores: usage.restores },
        },
      },
      { merge: true }
    );
  } catch {
    /* offline — local count still applies */
  }
}

/** Merged monthly usage (Firestore + local max). */
export async function getAttachmentUsageForOwner(ownerUid: string): Promise<{
  month: string;
  usage: AttachmentUsageMonth;
}> {
  const month = currentMonthKey();
  const local = readLocalUsage(ownerUid);
  const localUsage =
    local.month === month ? local.usage : { backups: 0, restores: 0 };
  const remote = await readFirestoreUsage(ownerUid, month);
  const usage: AttachmentUsageMonth = {
    backups: Math.max(localUsage.backups, remote?.backups ?? 0),
    restores: Math.max(localUsage.restores, remote?.restores ?? 0),
  };
  writeLocalUsage(ownerUid, month, usage);
  return { month, usage };
}

function resolvePlanEntitlements(planId?: PlanId | string | null): Entitlements {
  const merged = getPlanFromPlans(
    readCachedPlansRecord() ?? defaultPlansRecordFallback(),
    (planId as PlanId) || undefined
  );
  return merged.entitlements;
}

function capRemaining(cap: number, used: number): number | null {
  if (!Number.isFinite(cap) || isUnlimitedEntitlementCap(cap)) return null; // -1 = unlimited
  return Math.max(0, cap - used);
}

export function formatAttachmentUsageRemaining(cap: number, used: number): string {
  const rem = capRemaining(cap, used);
  if (rem === null) return "Unlimited this month";
  return `${rem} left this month (${used}/${cap} used)`;
}

export async function checkAttachmentBackupAllowed(
  ownerUid: string,
  planId?: PlanId | string | null
): Promise<{ allowed: boolean; message?: string; remaining: number | null; used: number; cap: number }> {
  const ent = resolvePlanEntitlements(planId);
  if (!ent.attachmentBackupRestoreEnabled) {
    return {
      allowed: false,
      message: "Your plan does not include attachment backup. Use Data only or upgrade.",
      remaining: 0,
      used: 0,
      cap: 0,
    };
  }
  const cap = Number(ent.maxAttachmentBackupPerMonth ?? 0);
  const { usage } = await getAttachmentUsageForOwner(ownerUid);
  const used = usage.backups;
  const remaining = capRemaining(cap, used);
  if (remaining !== null && remaining <= 0) {
    return {
      allowed: false,
      message: `Attachment backup limit reached for this month (${cap}/${cap}). Use Data only or upgrade.`,
      remaining: 0,
      used,
      cap,
    };
  }
  return { allowed: true, remaining, used, cap };
}

export async function checkAttachmentRestoreAllowed(
  ownerUid: string,
  planId?: PlanId | string | null
): Promise<{ allowed: boolean; message?: string; remaining: number | null; used: number; cap: number }> {
  const ent = resolvePlanEntitlements(planId);
  if (!ent.attachmentBackupRestoreEnabled) {
    return {
      allowed: false,
      message: "Your plan does not include attachment restore. Use Data only or upgrade.",
      remaining: 0,
      used: 0,
      cap: 0,
    };
  }
  const cap = Number(ent.maxAttachmentRestorePerMonth ?? 0);
  const { usage } = await getAttachmentUsageForOwner(ownerUid);
  const used = usage.restores;
  const remaining = capRemaining(cap, used);
  if (remaining !== null && remaining <= 0) {
    return {
      allowed: false,
      message: `Attachment restore limit reached for this month (${cap}/${cap}). Use Data only or upgrade.`,
      remaining: 0,
      used,
      cap,
    };
  }
  return { allowed: true, remaining, used, cap };
}

export async function incrementAttachmentBackupUsage(ownerUid: string): Promise<void> {
  if (!ownerUid) return;
  const month = currentMonthKey();
  const { usage } = await getAttachmentUsageForOwner(ownerUid);
  const next = { ...usage, backups: usage.backups + 1 };
  writeLocalUsage(ownerUid, month, next);
  await writeFirestoreUsage(ownerUid, month, next);
}

export async function incrementAttachmentRestoreUsage(ownerUid: string): Promise<void> {
  if (!ownerUid) return;
  const month = currentMonthKey();
  const { usage } = await getAttachmentUsageForOwner(ownerUid);
  const next = { ...usage, restores: usage.restores + 1 };
  writeLocalUsage(ownerUid, month, next);
  await writeFirestoreUsage(ownerUid, month, next);
}

/** Local → online upload gate — plan MB cap (-1 = unlimited, 0 = none). */
export function checkLocalToOnlineAttachmentMbAllowed(
  totalBytes: number,
  planId?: PlanId | string | null,
  livePlan?: Plan | null
): { allowed: boolean; message?: string; capMb: number; totalMb: number } {
  const ent = livePlan?.entitlements ?? resolvePlanEntitlements(planId);
  const capMb = Number(ent.maxLocalToOnlineAttachmentMB ?? 0);
  const totalMb = totalBytes / (1024 * 1024);
  if (isUnlimitedEntitlementCap(capMb)) return { allowed: true, capMb, totalMb };
  if (capMb <= 0) {
    return {
      allowed: false,
      capMb: 0,
      totalMb,
      message: "Your plan does not allow attaching files on local→cloud upload. Upgrade or remove files.",
    };
  }
  if (totalMb <= capMb) return { allowed: true, capMb, totalMb };
  return {
    allowed: false,
    capMb,
    totalMb,
    message: `Attachments total ${totalMb.toFixed(1)} MB exceeds your plan limit of ${capMb} MB for local→cloud upload. Remove files or upgrade.`,
  };
}

export function planAttachmentBackupRestoreEnabled(planId?: PlanId | string | null, livePlan?: Plan | null): boolean {
  const ent = livePlan?.entitlements ?? resolvePlanEntitlements(planId);
  return !!ent.attachmentBackupRestoreEnabled;
}
