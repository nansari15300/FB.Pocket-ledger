"use client";

import { auth } from "@/lib/plClientSession";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isLocalOnlyMode } from "@/lib/localMode";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { webAppBasePath } from "@/lib/webAppBasePath";

export async function invalidateServerOpeningSnapshots(params: {
  companyId: string;
  afterMs?: number;
  invalidateAll?: boolean;
}): Promise<void> {
  const { companyId, afterMs, invalidateAll } = params;
  const cid = String(companyId || "").trim();
  if (!cid) return;
  if (typeof window === "undefined") return;
  if (isStaticAppBuild() || isLocalOnlyMode()) return;

  const user = auth.currentUser;
  if (!user || String(user.uid || "").startsWith("local:")) return;

  try {
    const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(cid);
    if (!fsCompanyId) return;
    const token = await user.getIdToken();
    await fetch(`${webAppBasePath()}/api/company/opening-snapshots-invalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        companyId: fsCompanyId,
        afterMs,
        invalidateAll: invalidateAll === true,
      }),
    });
  } catch (err) {
    console.warn("[invalidateServerOpeningSnapshots]", err);
  }
}
