import { isPackedMyCompanyOnly } from "@/lib/plServerPackedApp";

/**
 * Inter-company system (voucher, join, clearing tab, A/c No, listeners).
 * Packed My Company has no peer companies — skip the whole stack to cut load.
 */
export function isInterCompanySystemEnabled(): boolean {
  return !isPackedMyCompanyOnly();
}
