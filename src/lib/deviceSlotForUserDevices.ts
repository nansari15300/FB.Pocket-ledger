"use client";

/**
 * Multi-company device sync: physical device (Firestore doc id = client device UUID) ke liye
 * ek hi deviceSlot (01..plan max) saari companies me — naya slot = sabhi companies me is user ke
 * devices par ab tak use hue slots ke baad sabse chhota khali number; kick ke baad woh number dubara mil sakta hai.
 */

import { collectionGroup, query, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

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
 * CollectionGroup query on path segment "devices" plus field userId — index in firestore.indexes.json.
 * Same client deviceId: reuse deviceSlot from any company doc; else smallest free integer in 1..maxDevices.
 */
export async function resolveDeviceSlotForCompanyWrite(
  firebaseUid: string,
  clientDeviceId: string,
  maxDevices: number,
): Promise<number> {
  const cap = Math.max(1, Math.min(999, Math.floor(maxDevices)));
  const q = query(collectionGroup(firestore, "devices"), where("userId", "==", firebaseUid));
  const snap = await getDocs(q);
  let existingForThisDevice: number | undefined;
  const used = new Set<number>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const s = readSlotFromDeviceData(data);
    if (d.id === clientDeviceId && s != null) {
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
