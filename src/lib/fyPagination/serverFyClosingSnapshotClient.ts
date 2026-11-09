"use client";

import { auth } from "@/lib/plClientSession";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isLocalOnlyMode } from "@/lib/localMode";
import type { FyPeriodKind } from "@/lib/fyPagination/types";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { webAppBasePath } from "@/lib/webAppBasePath";

export type ServerFyClosingSnapshotResult = {
  balances: Record<string, number>;
  cached: boolean;
  closingAtMs: number;
  voucherCountScanned: number;
  preFyVoucherCountScanned: number;
  source: "calculated_pre_fy";
};

/**
 * Online company: Admin API paginates Firestore vouchers → FY closing balances.
 * No prior-period voucher load on device.
 */
export async function fetchServerFyClosingSnapshot(params: {
  companyId: string;
  periodKind: FyPeriodKind;
  periodKey: string;
  beforeMs: number;
  forceRebuild?: boolean;
}): Promise<ServerFyClosingSnapshotResult | null> {
  const { companyId, periodKind, periodKey, beforeMs, forceRebuild } = params;
  if (!companyId || !periodKey || !Number.isFinite(beforeMs) || beforeMs <= 0) return null;
  if (typeof window === "undefined") return null;
  if (isStaticAppBuild() || isLocalOnlyMode()) return null;

  const user = auth.currentUser;
  if (!user || String(user.uid || "").startsWith("local:")) return null;

  try {
    const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(companyId);
    if (!fsCompanyId) return null;
    const token = await user.getIdToken();
    const res = await fetch(`${webAppBasePath()}/api/company/fy-closing-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        companyId: fsCompanyId,
        periodKind,
        periodKey,
        beforeMs,
        forceRebuild: forceRebuild === true,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      useClientFallback?: boolean;
      balances?: Record<string, number>;
      cached?: boolean;
      closingAtMs?: number;
      voucherCountScanned?: number;
      preFyVoucherCountScanned?: number;
      source?: string;
    };

    if (!res.ok || !data.ok || data.useClientFallback) return null;
    const balances = data.balances ?? {};
    if (!Object.keys(balances).length) return null;

    return {
      balances,
      cached: data.cached === true,
      closingAtMs: Number(data.closingAtMs) || beforeMs - 1,
      voucherCountScanned: Number(data.voucherCountScanned) || 0,
      preFyVoucherCountScanned: Number(data.preFyVoucherCountScanned) || 0,
      source: "calculated_pre_fy",
    };
  } catch (err) {
    console.warn("[fetchServerFyClosingSnapshot]", err);
    return null;
  }
}
