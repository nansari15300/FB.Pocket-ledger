import type admin from "@/lib/server/pbAdminTypes";

import { FieldPath } from "@/lib/server/pbBilling/fieldValue";
const VOUCHER_PAGE_SIZE = 400;

export function isEncryptedCompanyDoc(data: Record<string, unknown> | undefined): boolean {
  return data?.plEncryptedV1 === true;
}

export function adminDocToPlain(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(adminDocToPlain);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = adminDocToPlain(v);
    }
    return out;
  }
  return value;
}

/** Process voucher pages without holding the full company list in memory. */
export async function forEachCompanyVoucherPageAdmin(
  companyRef: admin.firestore.DocumentReference,
  onPage: (vouchers: any[]) => void | Promise<void>
): Promise<{ encrypted: boolean; totalVouchers: number }> {
  let totalVouchers = 0;
  let last: admin.firestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let q: admin.firestore.Query = companyRef
      .collection("vouchers")
      .orderBy(FieldPath.documentId() as unknown as admin.firestore.FieldPath)
      .limit(VOUCHER_PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    const page: any[] = [];
    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      if (isEncryptedCompanyDoc(raw)) {
        return { encrypted: true, totalVouchers: 0 };
      }
      if (raw.isDeleted === true) continue;
      const data = adminDocToPlain(raw) as Record<string, unknown>;
      page.push({ id: d.id, ...data });
    }

    totalVouchers += page.length;
    await onPage(page);

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < VOUCHER_PAGE_SIZE) break;
  }

  return { encrypted: false, totalVouchers };
}

/** Paginated full voucher mirror — server closing snapshot (browser load not required). */
export async function paginateCompanyVouchersAdmin(
  companyRef: admin.firestore.DocumentReference
): Promise<{ vouchers: any[]; encrypted: boolean }> {
  const vouchers: any[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let q: admin.firestore.Query = companyRef
      .collection("vouchers")
      .orderBy(FieldPath.documentId() as unknown as admin.firestore.FieldPath)
      .limit(VOUCHER_PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      if (isEncryptedCompanyDoc(raw)) {
        return { vouchers: [], encrypted: true };
      }
      if (raw.isDeleted === true) continue;
      const data = adminDocToPlain(raw) as Record<string, unknown>;
      vouchers.push({ id: d.id, ...data });
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < VOUCHER_PAGE_SIZE) break;
  }

  return { vouchers, encrypted: false };
}
