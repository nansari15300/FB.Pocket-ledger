"use client";

import { useMemo } from "react";
import { useVouchers } from "@/hooks/useVouchers";
import { buildLastVoucherMsByEntityId } from "@/lib/masterListLastVoucherMs";

const lastVoucherMsCache = new WeakMap<object, Map<string, number>>();

/** Account list Latest: entity id → last voucher activity ms. */
export function useLastVoucherMsByEntityId(): Map<string, number> {
  const { vouchers } = useVouchers();
  return useMemo(() => {
    if (Array.isArray(vouchers)) {
      const hit = lastVoucherMsCache.get(vouchers);
      if (hit) return hit;
      const built = buildLastVoucherMsByEntityId(vouchers as unknown[]);
      lastVoucherMsCache.set(vouchers, built);
      return built;
    }
    return buildLastVoucherMsByEntityId(vouchers as unknown[]);
  }, [vouchers]);
}
