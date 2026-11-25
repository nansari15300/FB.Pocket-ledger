import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { isPlServerPackedApp } from "@/lib/plServerPackedApp";

export function plWalletPayUrl(which: "checkout" | "webhook" | "confirm"): string {
  if (typeof window !== "undefined" && isPlServerPackedApp()) {
    return `${window.location.origin.replace(/\/+$/, "")}/api/pl/pay/wallet-${which}`;
  }
  return getBillingApiUrl(`/api/payments/wallet-${which}`);
}
