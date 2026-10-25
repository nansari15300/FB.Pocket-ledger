import { hostedApiFetch } from "@/lib/hostedApiFetch";
import { isPocketBaseAppSessionMarked } from "@/lib/pocketbaseData/pbAppSession";
import type { AdPendingEvent, AdWalletState } from "@/lib/ads/adWalletTypes";

export type AdRewardSyncResponse = {
  ok?: boolean;
  points?: number;
  earnedToday?: number;
  dayKey?: string;
  unlocks?: AdWalletState["unlocks"];
  processedEventIds?: string[];
  error?: string;
};

export async function postAdRewardSync(args: {
  idToken: string;
  pending: AdPendingEvent[];
  local: Pick<AdWalletState, "points" | "earnedToday" | "dayKey" | "unlocks">;
}): Promise<AdRewardSyncResponse> {
  // Pocket Ledger Server login: the reward route reads Firestore through firebase-admin - skip it.
  if (isPocketBaseAppSessionMarked()) return { ok: false, error: "server_login_session" };
  const res = await hostedApiFetch("/api/ads/reward-sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pending: args.pending,
      local: args.local,
    }),
  });
  const text = await res.text();
  let json: AdRewardSyncResponse = {};
  try {
    json = text ? (JSON.parse(text) as AdRewardSyncResponse) : {};
  } catch {
    throw new Error(res.statusText || "Ad reward sync failed");
  }
  if (!res.ok) {
    throw new Error(json.error || res.statusText || "Ad reward sync failed");
  }
  return json;
}
