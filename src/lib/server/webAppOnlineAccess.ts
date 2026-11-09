import "server-only";

import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import { getMergedPlan } from "@/lib/server/getEffectivePlanRegionalPrice";
import { pickAccountPlanCanonFromCompanySnapshots } from "@/lib/server/accountCanonicalPlan";
import { planAllowsFirebaseOnline } from "@/lib/planSyncEntitlements";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";

type CompanySnap = { id: string; data: Record<string, unknown> };

export type WebAppOnlineAccessReason =
  | "super_admin"
  | "account_online_plan"
  | "owned_online_plan"
  | "shared_online_company";

export type WebAppOnlineAccessResult = {
  allowed: boolean;
  reason?: WebAppOnlineAccessReason;
  /** How many shared company docs matched (debug / UI). */
  sharedCompanyCount?: number;
};

type SharedQuerySpec = {
  field: "sharedWithEmails" | "sharedWithEmailsLower";
  value: string;
};

function planExpiryMsFromData(d: Record<string, unknown>): number | null {
  if (typeof d.planExpiryMs === "number" && Number.isFinite(d.planExpiryMs)) return d.planExpiryMs;
  const pe = d.planExpiry as { toMillis?: () => number } | undefined;
  if (pe && typeof pe.toMillis === "function") return pe.toMillis();
  return null;
}

function isActiveCompany(data: Record<string, unknown>): boolean {
  return data.isDeleted !== true && data.movedToAdminRecycleAt == null;
}

function emailInSharedLists(data: Record<string, unknown>, emailLower: string): boolean {
  if (!emailLower) return false;
  const candidates = emailLookupSet(emailLower);
  for (const list of [data.sharedWithEmails, data.sharedWithEmailsLower]) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      const t = String(x || "")
        .toLowerCase()
        .trim();
      if (t && candidates.has(t)) return true;
    }
  }
  return false;
}

function uidOrEmailInSharedWith(
  data: Record<string, unknown>,
  uid: string,
  emailLower: string
): boolean {
  const list = Array.isArray(data.sharedWith) ? data.sharedWith : [];
  const candidates = emailLookupSet(emailLower);
  return list.some((row) => {
    if (!row || typeof row !== "object") return false;
    const entry = row as { uid?: unknown; email?: unknown };
    const id = String(entry.uid || "").trim();
    if (uid && id && id === uid) return true;
    const em = String(entry.email || "")
      .toLowerCase()
      .trim();
    return Boolean(em && candidates.has(em));
  });
}

async function paidOnlinePlanAllowed(planId: PlanId, expiryMs: number | null): Promise<boolean> {
  if (planId === "basic") return false;
  const plan = await getMergedPlan(planId);
  if (!planAllowsFirebaseOnline(planId, plan)) return false;
  if (expiryMs == null || !Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  return true;
}

function mapCompanyDocs(snap: admin.firestore.QuerySnapshot): CompanySnap[] {
  return snap.docs.map((row) => ({ id: row.id, data: (row.data() ?? {}) as Record<string, unknown> }));
}

/** Exact + lowercase (+ Gmail dot/+ alias forms for invite mismatches). */
function emailLookupSet(email: string | null | undefined): Set<string> {
  const raw = String(email || "")
    .trim()
    .toLowerCase();
  const out = new Set<string>();
  if (!raw || !raw.includes("@")) return out;
  out.add(raw);
  const at = raw.indexOf("@");
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const noPlus = local.split("+")[0] || local;
    const noDots = noPlus.replace(/\./g, "");
    out.add(`${noPlus}@gmail.com`);
    out.add(`${noDots}@gmail.com`);
    out.add(`${noPlus}@googlemail.com`);
    out.add(`${noDots}@googlemail.com`);
  }
  return out;
}

function emailQueryVariants(email: string | null | undefined): string[] {
  const raw = String(email || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const variants = new Set<string>([lower]);
  if (raw !== lower) variants.add(raw);
  for (const v of emailLookupSet(raw)) variants.add(v);
  return [...variants];
}

function sharedCompanyQuerySpecsForEmail(email: string | null | undefined): SharedQuerySpec[] {
  const specs: SharedQuerySpec[] = [];
  for (const variant of emailQueryVariants(email)) {
    if (!specs.some((s) => s.field === "sharedWithEmails" && s.value === variant)) {
      specs.push({ field: "sharedWithEmails", value: variant });
    }
    const lower = variant.toLowerCase();
    if (!specs.some((s) => s.field === "sharedWithEmailsLower" && s.value === lower)) {
      specs.push({ field: "sharedWithEmailsLower", value: lower });
    }
  }
  return specs;
}

/**
 * Hosted browser `/app` access: online-plan entitlement or shared online company only.
 * APK/EXE/static shells skip this check in the client gate.
 */
export async function evaluateWebAppOnlineAccess(
  db: admin.firestore.Firestore,
  uid: string,
  email: string | null | undefined
): Promise<WebAppOnlineAccessResult> {
  const ownerUid = String(uid || "").trim();
  let userData: Record<string, unknown> = {};
  if (ownerUid) {
    const userSnap = await db.collection("users").doc(ownerUid).get();
    if (userSnap.exists) {
      userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    } else {
      const tokenEmail = String(email || "").trim();
      const lookups: Promise<admin.firestore.QuerySnapshot>[] = [];
      for (const em of emailQueryVariants(tokenEmail)) {
        lookups.push(db.collection("users").where("email", "==", em).limit(3).get());
      }
      lookups.push(db.collection("users").where("uid", "==", ownerUid).limit(3).get());
      for (const snap of await Promise.all(lookups)) {
        const hit =
          snap.docs.find((d) => {
            const dUid = String((d.data() as { uid?: unknown }).uid || d.id || "");
            return dUid === ownerUid || d.id.endsWith(`_${ownerUid}`) || d.id === ownerUid;
          }) ?? snap.docs[0];
        if (hit) {
          userData = (hit.data() ?? {}) as Record<string, unknown>;
          break;
        }
      }
    }
  }

  const authEmail = String(email || userData.email || "").trim();
  const authEmailLower = authEmail.toLowerCase();

  if (authEmailLower && getSuperAdminEmails().some((e) => e.toLowerCase() === authEmailLower)) {
    return { allowed: true, reason: "super_admin" };
  }

  if (String(userData.role || "") === "SuperAdmin") {
    return { allowed: true, reason: "super_admin" };
  }

  const accountPlanId = normalizePlanIdForClient(String(userData.accountCanonicalPlanId || ""));
  const accountExpiry =
    typeof userData.accountCanonicalPlanExpiryMs === "number"
      ? userData.accountCanonicalPlanExpiryMs
      : null;
  if (await paidOnlinePlanAllowed(accountPlanId, accountExpiry)) {
    return { allowed: true, reason: "account_online_plan" };
  }

  const ownedSnaps = await Promise.all([
    ownerUid
      ? db.collection("companies").where("ownerId", "==", ownerUid).get()
      : Promise.resolve(null),
    ...emailQueryVariants(authEmail).map((ownerEmail) =>
      db.collection("companies").where("ownerEmail", "==", ownerEmail).get()
    ),
  ]);

  const ownedById = new Map<string, CompanySnap>();
  const ownedByOwnerId = new Set<string>();
  for (const snap of ownedSnaps) {
    if (!snap) continue;
    for (const row of mapCompanyDocs(snap)) {
      if (!isActiveCompany(row.data)) continue;
      ownedById.set(row.id, row);
      if (ownerUid && String(row.data.ownerId || "").trim() === ownerUid) {
        ownedByOwnerId.add(row.id);
      }
    }
  }

  const ownedCanon = pickAccountPlanCanonFromCompanySnapshots(
    [...ownedById.values()].map(({ id, data }) => ({ id, data }))
  );
  if (ownedCanon && (await paidOnlinePlanAllowed(ownedCanon.planId, ownedCanon.planExpiryMs))) {
    return { allowed: true, reason: "owned_online_plan" };
  }

  for (const row of ownedById.values()) {
    // Only treat true ownerId matches as "owned plan" entitlement.
    if (ownerUid && String(row.data.ownerId || "").trim() !== ownerUid) continue;
    const planId = normalizePlanIdForClient(String(row.data.planId || ""));
    const expiryMs = planExpiryMsFromData(row.data);
    if (await paidOnlinePlanAllowed(planId, expiryMs)) {
      return { allowed: true, reason: "owned_online_plan" };
    }
  }

  const shareSpecs = sharedCompanyQuerySpecsForEmail(authEmail);
  const sharedSnaps =
    shareSpecs.length > 0
      ? await Promise.all(
          shareSpecs.map((spec) =>
            db.collection("companies").where(spec.field, "array-contains", spec.value).get()
          )
        )
      : [];

  let sharedCompanyCount = 0;
  for (const snap of sharedSnaps) {
    for (const row of mapCompanyDocs(snap)) {
      if (!isActiveCompany(row.data)) continue;
      // Skip only true owners — ownerEmail false-positives must still count as share.
      if (ownedByOwnerId.has(row.id)) continue;
      sharedCompanyCount += 1;
      const sharedByEmail = emailInSharedLists(row.data, authEmailLower);
      const sharedByMember = ownerUid
        ? uidOrEmailInSharedWith(row.data, ownerUid, authEmailLower)
        : false;
      if (sharedByEmail || sharedByMember || authEmailLower) {
        return { allowed: true, reason: "shared_online_company", sharedCompanyCount };
      }
    }
  }

  // Profile email retry when token email empty / different.
  const profileEmail = String(userData.email || "")
    .toLowerCase()
    .trim();
  if (profileEmail && profileEmail !== authEmailLower) {
    const retrySnaps = await Promise.all(
      sharedCompanyQuerySpecsForEmail(profileEmail).map((spec) =>
        db.collection("companies").where(spec.field, "array-contains", spec.value).get()
      )
    );
    for (const snap of retrySnaps) {
      for (const row of mapCompanyDocs(snap)) {
        if (!isActiveCompany(row.data)) continue;
        if (ownedByOwnerId.has(row.id)) continue;
        sharedCompanyCount += 1;
        if (
          emailInSharedLists(row.data, profileEmail) ||
          (ownerUid && uidOrEmailInSharedWith(row.data, ownerUid, profileEmail)) ||
          profileEmail
        ) {
          return { allowed: true, reason: "shared_online_company", sharedCompanyCount };
        }
      }
    }
  }

  return { allowed: false, sharedCompanyCount };
}
