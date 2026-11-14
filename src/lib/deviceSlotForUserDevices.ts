"use client";

/**
 * Multi-company device sync: physical device (Firestore doc id = client device UUID) ke liye
 * ek hi deviceSlot (01..plan max) saari companies me — naya slot = sabhi companies me is user ke
 * devices par ab tak use hue slots ke baad sabse chhota khali number; kick ke baad woh number dubara mil sakta hai.
 */

import { listPocketBaseCompanyIds } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { pbListAppDocs } from "@/lib/pocketbaseData/pbSync";

/** UI: 5 → "05"; missing → em dash */
export function formatDeviceSlotLabel(slot: number | undefined): string {
  if (typeof slot !== "number" || !Number.isFinite(slot) || slot < 1) return "—";
  return String(Math.min(999, Math.floor(slot))).padStart(2, "0");
}

function readSlotFromDeviceData(data: Record<string, unknown> | undefined): number | undefined {
  const raw = data?.deviceSlot;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  return n >= 1 ? n : undefined;
}

/**
 * Read device slots directly from PocketBase company collections.
 * Same client deviceId: reuse deviceSlot from any company doc; else smallest free integer in 1..maxDevices.
 */
export async function resolveDeviceSlotForCompanyWrite(
  firebaseUid: string,
  clientDeviceId: string,
  maxDevices: number,
): Promise<number> {
  const cap = Math.max(1, Math.min(999, Math.floor(maxDevices)));
  const companyIds = listPocketBaseCompanyIds();
  const companyRows = await Promise.all(companyIds.map((companyId) => pbListAppDocs(companyId, "devices").catch(() => [])));
  const rows = companyRows.flat().filter((row) => String(row.userId || "") === firebaseUid);
  let existingForThisDevice: number | undefined;
  const used = new Set<number>();
  for (const data of rows) {
    const s = readSlotFromDeviceData(data);
    if (String(data.id || "") === clientDeviceId && s != null) {
      existingForThisDevice = s;
    }
    if (s != null && s <= cap) {
      used.add(s);
    }
  }
  if (existingForThisDevice != null) {
    return Math.min(cap, existingForThisDevice);
  }
  for (let n = 1; n <= cap; n++) {
    if (!used.has(n)) return n;
  }
  return cap;
}
