import { DEFAULT_PLANS, type Plan, type PlanId, PLAN_TIER_ORDER } from "@/config/plans";

/** Ek hi key — useLivePlans / billing / admin sab yahin se sync rahein. */
export const PLANS_CATALOG_LOCAL_STORAGE_KEY = "app_settings:plans";

/** Browser: last online merge `Record<PlanId, Plan>`; server/SSR par hamesha null. */
export function readCachedPlansRecord(): Record<PlanId, Plan> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLANS_CATALOG_LOCAL_STORAGE_KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const id of PLAN_TIER_ORDER) {
      const row = parsed[id];
      if (!row || typeof row !== "object") return null;
    }
    return parsed as Record<PlanId, Plan>;
  } catch {
    return null;
  }
}

export function writeCachedPlansRecord(plans: Record<PlanId, Plan>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLANS_CATALOG_LOCAL_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // quota / private mode
  }
}

/** Tier order me `Plan[]` — UI list ke liye. */
export function readCachedPlansList(): Plan[] | null {
  const rec = readCachedPlansRecord();
  if (!rec) return null;
  return PLAN_TIER_ORDER.map((id) => rec[id]);
}

export function writeCachedPlansList(list: Plan[]): void {
  const out = {} as Record<PlanId, Plan>;
  for (const p of list) {
    out[p.id as PlanId] = p;
  }
  writeCachedPlansRecord(out);
}

/** Cache empty + Firestore fail: bundled defaults — sirf is case me. */
export function defaultPlansListFallback(): Plan[] {
  return PLAN_TIER_ORDER.map((id) => DEFAULT_PLANS[id]);
}

export function defaultPlansRecordFallback(): Record<PlanId, Plan> {
  return { ...DEFAULT_PLANS } as Record<PlanId, Plan>;
}

let plansCatalogHydratePromise: Promise<Record<PlanId, Plan>> | null = null;

/** Admin Firestore plans — cache miss par fetch (dev: save se pehle useLivePlans mount na ho). */
export async function resolvePlansCatalogForEntitlements(): Promise<Record<PlanId, Plan>> {
  const cached = readCachedPlansRecord();
  if (cached) return cached;
  if (typeof window === "undefined") return defaultPlansRecordFallback();

  if (!plansCatalogHydratePromise) {
    plansCatalogHydratePromise = (async () => {
      try {
        const { doc, getDoc: fsGetDoc } = await import("@/lib/pbCompat/firestore");
        const { isPocketBaseAppSessionActive } = await import("@/lib/pocketbaseData/pbAppSession");
        let getDoc = fsGetDoc;
        if (isPocketBaseAppSessionActive()) {
          // Server login: Firestore is offline. Admin Panel (super admin) reads via the server; else defaults.
          const seam = await import("@/lib/pocketbaseData/pbReadSeam");
          if (!seam.isAdminServerDataActive()) {
            plansCatalogHydratePromise = null;
            return defaultPlansRecordFallback();
          }
          getDoc = seam.getDoc;
        }
        const { firestore } = await import("@/lib/plClientSession");
        const { mergeAppSettingsPlansDoc } = await import("@/lib/mergeAppSettingsPlans");
        const snap = await getDoc(doc(firestore, "app_settings", "plans"));
        if (snap.exists()) {
          const list = mergeAppSettingsPlansDoc(snap.data() as Record<string, unknown>);
          const merged = {} as Record<PlanId, Plan>;
          for (const p of list) merged[p.id as PlanId] = p;
          writeCachedPlansRecord(merged);
          return merged;
        }
      } catch {
        /* offline */
      }
      return defaultPlansRecordFallback();
    })();
  }
  return plansCatalogHydratePromise;
}

const ADMIN_PLANS_SELECTED_PLAN_ID_KEY = "admin:plans:selectedPlanId";

/** Admin Plans UI: refresh ke baad wahi tier card khula rahe. */
export function readAdminPlansSelectedPlanId(): PlanId | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(ADMIN_PLANS_SELECTED_PLAN_ID_KEY)?.trim();
    if (!v) return null;
    return (PLAN_TIER_ORDER as readonly string[]).includes(v) ? (v as PlanId) : null;
  } catch {
    return null;
  }
}

export function writeAdminPlansSelectedPlanId(id: PlanId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_PLANS_SELECTED_PLAN_ID_KEY, id);
  } catch {
    /* ignore */
  }
}
