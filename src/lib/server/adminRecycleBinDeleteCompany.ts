import "server-only";

import { pocketBaseServerUrlForApi } from "@/lib/localCloudSync/server/pbBearerAuth";

/**
 * Super-admin recycle bin: permanently wipe a soft-deleted company.
 *
 * The wipe itself runs on the Pocket Ledger Server (`POST /api/pl/admin/recycle-delete` →
 * `pb_hooks/lib/company_delete.js`), which removes the company row, every `pl_data` mirror row,
 * change-log rows and its stored files in one transaction. Doing it from here used to mean walking
 * Firestore subcollections with the Admin SDK.
 *
 * The caller must be the server's main admin; the endpoint enforces that itself (and refuses a
 * company that is not in the recycle bin).
 */
export async function adminServerHardDeleteDeletedCompany(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) throw new Error("Invalid company id");

  const token = String(process.env.PL_SERVER_ADMIN_TOKEN || "").trim();
  const res = await fetch(`${pocketBaseServerUrlForApi()}/api/pl/admin/recycle-delete`, {
    method: "POST",
    // The server checks the real admin session; a service token may be supplied for cron use.
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify({ companyId: cid }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  if (res.status === 404) return; // already gone
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Recycle delete failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}
