"use client";

import { useMemo } from "react";
import { useVouchers } from "@/hooks/useVouchers";
import { buildLastVoucherMsByEntityId } from "@/lib/masterListLastVoucherMs";

const lastVoucherMsCache = new WeakMap<object, Map<string, number>>();
const emptyLastVoucherMs: Map<string, number> = new Map();

/** Account list Latest: entity id → last voucher activity ms. */
export function useLastVoucherMsByEntityId(): Map<string, number> {
  const { vouchers } = useVouchers();
  return useMemo(() => {
    if (!Array.isArray(vouchers)) return emptyLastVoucherMs;
    const hit = lastVoucherMsCache.get(vouchers);
    if (hit) return hit;
    const built = buildLastVoucherMsByEntityId(vouchers as unknown[]);
    lastVoucherMsCache.set(vouchers, built);
    return built;
  }, [vouchers]);
}
