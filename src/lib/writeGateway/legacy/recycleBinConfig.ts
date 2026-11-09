"use client";

import { setDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";

const CONFIG_PATH = "config/recycleBin";

export type RecycleBinConfig = {
  quickDelete: boolean;
  /** @deprecated Use autoDeleteAfterDaysSuperAdmin / autoDeleteAfterDaysCompanyAdmin */
  autoDeleteAfterDays?: number;
  autoDeleteAfterDaysSuperAdmin: number;
  autoDeleteAfterDaysCompanyAdmin: number;
};

const DEFAULTS: RecycleBinConfig = {
  quickDelete: false,
  autoDeleteAfterDays: 90,
  autoDeleteAfterDaysSuperAdmin: 90,
  autoDeleteAfterDaysCompanyAdmin: 90,
};

function readDays(d: Record<string, unknown>, key: string, fallback: number): number {
  const v = d[key];
  if (typeof v === "number" && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (key !== "autoDeleteAfterDays" && typeof d.autoDeleteAfterDays === "number" && d.autoDeleteAfterDays > 0) return d.autoDeleteAfterDays as number;
  return fallback;
}

export async function getRecycleBinConfig(): Promise<RecycleBinConfig> {
  const snap = await getDoc(doc(firestore, CONFIG_PATH));
  if (!snap.exists()) return DEFAULTS;
  const d = snap.data();
  return {
    quickDelete: d.quickDelete === true,
    autoDeleteAfterDays: readDays(d, "autoDeleteAfterDays", 90),
    autoDeleteAfterDaysSuperAdmin: readDays(d, "autoDeleteAfterDaysSuperAdmin", 90),
    autoDeleteAfterDaysCompanyAdmin: readDays(d, "autoDeleteAfterDaysCompanyAdmin", 90),
  };
}

export async function setRecycleBinConfig(config: Partial<RecycleBinConfig>): Promise<void> {
  const current = await getRecycleBinConfig();
  const next: RecycleBinConfig = {
    ...current,
    ...config,
    autoDeleteAfterDaysSuperAdmin: config.autoDeleteAfterDaysSuperAdmin !== undefined ? config.autoDeleteAfterDaysSuperAdmin : current.autoDeleteAfterDaysSuperAdmin,
    autoDeleteAfterDaysCompanyAdmin: config.autoDeleteAfterDaysCompanyAdmin !== undefined ? config.autoDeleteAfterDaysCompanyAdmin : current.autoDeleteAfterDaysCompanyAdmin,
  };
  await setDoc(doc(firestore, CONFIG_PATH), next, { merge: true });
}

export function subscribeRecycleBinConfig(
  onConfig: (config: RecycleBinConfig) => void
): () => void {
  const unsub = onSnapshot(doc(firestore, CONFIG_PATH), (snap) => {
    if (!snap.exists()) {
      onConfig(DEFAULTS);
      return;
    }
    const d = snap.data();
    onConfig({
      quickDelete: d.quickDelete === true,
      autoDeleteAfterDays: readDays(d, "autoDeleteAfterDays", 90),
      autoDeleteAfterDaysSuperAdmin: readDays(d, "autoDeleteAfterDaysSuperAdmin", 90),
      autoDeleteAfterDaysCompanyAdmin: readDays(d, "autoDeleteAfterDaysCompanyAdmin", 90),
    });
  });
  return unsub;
}
