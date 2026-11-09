/**
 * IC voucher Target company — Code / A/c No / PAN lookup on Firebase (global).
 * Local-only mode falls back to device company registry scan.
 */
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { collection, limit, query, where, doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import { listLocalCompanies } from "@/lib/localCompanyStore";
import {
  isValidInterCompanyCompanyCode,
  normalizeInterCompanyCompanyCode,
  readCompanyInterCompanyCode,
} from "@/lib/interCompany/interCompanyCompanyCode";
import {
  interCompanyAcNoPrefix,
  isValidInterCompanyAcNo,
  normalizeInterCompanyAcNo,
  readCompanyInterCompanyAcNo,
} from "@/lib/interCompany/interCompanyAccountNo";
import { normalizeInterCompanyPhone } from "@/lib/interCompany/interCompanyPhone";
import type { InterCompanyPartnerRow } from "@/lib/interCompany/useInterCompanyPartnerDirectory";

export type InterCompanyFirebaseCompanyHit = InterCompanyPartnerRow;

function normalizePan(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function hitFromCompanyDoc(
  id: string,
  data: Record<string, unknown>
): InterCompanyFirebaseCompanyHit {
  const companyCode = readCompanyInterCompanyCode(
    data as { interCompanyCompanyCode?: string }
  );
  const acNo = readCompanyInterCompanyAcNo(data as { interCompanyAccountNo?: string });
  return {
    id,
    name: String(data.name || id).trim() || id,
    acNo,
    companyCode,
    pan: normalizePan(data.pan),
    mobile: normalizeInterCompanyPhone(String(data.phone || "")),
    isShared: true,
  };
}

function hitFromPublicProfile(
  id: string,
  data: Record<string, unknown>
): InterCompanyFirebaseCompanyHit {
  const companyCode = normalizeInterCompanyCompanyCode(
    String(data.companyCode || data.interCompanyCompanyCode || "")
  );
  const acNo = normalizeInterCompanyAcNo(
    String(data.interCompanyAccountNo || data.acNo || "")
  );
  const panRaw = data.pan;
  const pan =
    panRaw && String(panRaw) !== "—"
      ? normalizePan(panRaw)
      : "";
  const phoneRaw = data.phone;
  const mobile =
    phoneRaw && String(phoneRaw) !== "—"
      ? normalizeInterCompanyPhone(String(phoneRaw))
      : "";
  return {
    id,
    name: String(data.name || id).trim() || id,
    acNo: isValidInterCompanyAcNo(acNo) ? acNo : "",
    companyCode: isValidInterCompanyCompanyCode(companyCode) ? companyCode : "",
    pan,
    mobile,
    isShared: true,
  };
}

async function enrichHitFromPublicProfile(
  hit: InterCompanyFirebaseCompanyHit
): Promise<InterCompanyFirebaseCompanyHit> {
  if (hit.companyCode && hit.pan && hit.mobile) return hit;
  try {
    const snap = await getDoc(doc(firestore, "inter_company_public_profiles", hit.id));
    if (!snap.exists()) return hit;
    const pub = hitFromPublicProfile(hit.id, snap.data() as Record<string, unknown>);
    return {
      ...hit,
      name: hit.name || pub.name,
      companyCode: hit.companyCode || pub.companyCode,
      acNo: hit.acNo || pub.acNo,
      pan: hit.pan || pub.pan,
      mobile: hit.mobile || pub.mobile,
    };
  } catch {
    return hit;
  }
}

async function lookupLocalCompaniesByPredicate(
  match: (row: Record<string, unknown> & { id: string; name?: string }) => boolean
): Promise<InterCompanyFirebaseCompanyHit[]> {
  try {
    const companies = await listLocalCompanies({ includeDeleted: false });
    const out: InterCompanyFirebaseCompanyHit[] = [];
    for (const row of companies) {
      if (!row?.id) continue;
      const data = row as Record<string, unknown> & { id: string; name?: string };
      if (!match(data)) continue;
      out.push(
        hitFromCompanyDoc(row.id, {
          name: row.name,
          pan: (row as { pan?: string }).pan,
          phone: (row as { phone?: string }).phone,
          interCompanyCompanyCode: (row as { interCompanyCompanyCode?: string })
            .interCompanyCompanyCode,
          interCompanyAccountNo: (row as { interCompanyAccountNo?: string })
            .interCompanyAccountNo,
        })
      );
    }
    return out;
  } catch {
    return [];
  }
}

/** Company Code (12-char) → global Firebase company, else local registry. */
export async function lookupInterCompanyByCompanyCodeFirebase(
  typed: string
): Promise<InterCompanyFirebaseCompanyHit | null> {
  const code = normalizeInterCompanyCompanyCode(typed);
  if (!isValidInterCompanyCompanyCode(code)) return null;

  if (isLocalOnlyMode()) {
    const hits = await lookupLocalCompaniesByPredicate(
      (row) => readCompanyInterCompanyCode(row as { interCompanyCompanyCode?: string }) === code
    );
    return hits[0] ?? null;
  }

  try {
    const companySnap = await getDocs(
      query(
        collection(firestore, "companies"),
        where("interCompanyCompanyCode", "==", code),
        limit(3)
      )
    );
    if (!companySnap.empty) {
      const d = companySnap.docs[0]!;
      return enrichHitFromPublicProfile(
        hitFromCompanyDoc(d.id, d.data() as Record<string, unknown>)
      );
    }
  } catch (err) {
    console.warn("[IC] Firebase company-code lookup failed", err);
  }

  try {
    const profileSnap = await getDocs(
      query(
        collection(firestore, "inter_company_public_profiles"),
        where("companyCode", "==", code),
        limit(3)
      )
    );
    if (!profileSnap.empty) {
      const d = profileSnap.docs[0]!;
      const data = d.data() as Record<string, unknown>;
      const companyId = String(data.companyId || d.id).trim() || d.id;
      return hitFromPublicProfile(companyId, data);
    }
  } catch (err) {
    console.warn("[IC] public profile company-code lookup failed", err);
  }

  return null;
}

/** Company Inter Co. A/c (C + 14 digits) → Firebase companies. */
export async function lookupInterCompanyByAcNoFirebase(
  typed: string
): Promise<InterCompanyFirebaseCompanyHit | null> {
  const acNo = normalizeInterCompanyAcNo(typed);
  if (!isValidInterCompanyAcNo(acNo)) return null;
  if (interCompanyAcNoPrefix(acNo) !== "C") return null;

  if (isLocalOnlyMode()) {
    const hits = await lookupLocalCompaniesByPredicate(
      (row) => readCompanyInterCompanyAcNo(row as { interCompanyAccountNo?: string }) === acNo
    );
    return hits[0] ?? null;
  }

  try {
    const companySnap = await getDocs(
      query(
        collection(firestore, "companies"),
        where("interCompanyAccountNo", "==", acNo),
        limit(3)
      )
    );
    if (!companySnap.empty) {
      const d = companySnap.docs[0]!;
      return enrichHitFromPublicProfile(
        hitFromCompanyDoc(d.id, d.data() as Record<string, unknown>)
      );
    }
  } catch (err) {
    console.warn("[IC] Firebase A/c No lookup failed", err);
  }

  return null;
}

/** PAN → Firebase public profiles (+ companies when readable). Exact match preferred. */
export async function lookupInterCompaniesByPanFirebase(
  typed: string
): Promise<InterCompanyFirebaseCompanyHit[]> {
  const pan = normalizePan(typed);
  if (pan.length < 10) return [];

  if (isLocalOnlyMode()) {
    return lookupLocalCompaniesByPredicate((row) => normalizePan(row.pan) === pan);
  }

  const byId = new Map<string, InterCompanyFirebaseCompanyHit>();

  try {
    const profileSnap = await getDocs(
      query(
        collection(firestore, "inter_company_public_profiles"),
        where("pan", "==", pan),
        limit(20)
      )
    );
    for (const d of profileSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      const companyId = String(data.companyId || d.id).trim() || d.id;
      byId.set(companyId, hitFromPublicProfile(companyId, data));
    }
  } catch (err) {
    console.warn("[IC] public profile PAN lookup failed", err);
  }

  try {
    const companySnap = await getDocs(
      query(collection(firestore, "companies"), where("pan", "==", pan), limit(20))
    );
    for (const d of companySnap.docs) {
      const hit = await enrichHitFromPublicProfile(
        hitFromCompanyDoc(d.id, d.data() as Record<string, unknown>)
      );
      byId.set(hit.id, { ...(byId.get(hit.id) || hit), ...hit, name: hit.name || byId.get(hit.id)?.name || hit.id });
    }
  } catch (err) {
    console.warn("[IC] Firebase company PAN lookup failed", err);
  }

  return [...byId.values()];
}
