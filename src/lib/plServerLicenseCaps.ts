"use client";

import { isPlServerPackedApp, plServerPackedSameOrigin } from "@/lib/plServerPackedApp";
import { getPocketBaseServerUrl } from "@/lib/pocketbaseData/pbClient";

export type PlServerLicenseCaps = {
  planId: string;
  planName: string;
  maxUsers: number;
  maxCompanies: number;
  usedUsers: number;
  usedCompanies: number;
  remainingUsers: number;
  remainingCompanies: number;
  canSell: boolean;
};

function finiteCap(n: unknown): number | null {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return null;
  return x;
}

export function licenseCapForUsers(caps: PlServerLicenseCaps | null): number | null {
  return caps ? finiteCap(caps.maxUsers) : null;
}

export function licenseCapForCompanies(caps: PlServerLicenseCaps | null): number | null {
  return caps ? finiteCap(caps.maxCompanies) : null;
}

/** Snap a typed plan cap to the server license. −1 (unlimited) is not allowed when the license is finite. */
export function clampToServerLicense(value: number, cap: number | null): number {
  if (cap == null) return value;
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return cap;
  if (value > cap) return cap;
  return value;
}

export function planValueExceedsLicense(value: unknown, cap: number | null): boolean {
  if (cap == null) return false;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return false;
  return n < 0 || n > cap;
}

function serverPlanUrl(): string {
  if (typeof window === "undefined") return "";
  if (isPlServerPackedApp()) {
    const origin = plServerPackedSameOrigin() || window.location.origin;
    return `${origin.replace(/\/+$/, "")}/api/pl/server-plan`;
  }
  try {
    const origin = getPocketBaseServerUrl().replace(/\/+$/, "");
    return origin ? `${origin}/api/pl/server-plan` : "";
  } catch {
    return "";
  }
}

export async function fetchPlServerLicenseCaps(): Promise<PlServerLicenseCaps | null> {
  const url = serverPlanUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      entitlements?: {
        planId?: string;
        planName?: string;
        maxUsers?: number;
        maxCompanies?: number;
        canSell?: boolean;
      };
      used?: { users?: number; companies?: number };
      remaining?: { users?: number; companies?: number };
    };
    const ent = j.entitlements || {};
    if (!ent.planId && ent.maxUsers == null && ent.maxCompanies == null) return null;
    return {
      planId: String(ent.planId || ""),
      planName: String(ent.planName || ent.planId || "Server plan"),
      maxUsers: Number(ent.maxUsers),
      maxCompanies: Number(ent.maxCompanies),
      usedUsers: Number(j.used?.users) || 0,
      usedCompanies: Number(j.used?.companies) || 0,
      remainingUsers: Number(j.remaining?.users),
      remainingCompanies: Number(j.remaining?.companies),
      canSell: !!ent.canSell,
    };
  } catch {
    return null;
  }
}
