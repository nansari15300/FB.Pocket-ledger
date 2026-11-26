"use client";

/**
 * Confirm a voucher number at save time (online reserve) or keep a provisional
 * number offline and reconcile on flush. Never overwrites a different voucher
 * that already owns the number.
 */

import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { readPendingOutboxPayloadsForCompany } from "@/lib/localVoucherOutbox";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import {
  applyRenumberedVoucherFields,
  collectTakenVoucherNumbers,
  nextFreeVoucherNumber,
  PROVISIONAL_NUMBER_FIELD,
  shouldRenumberIncomingOnCollision,
} from "@/lib/voucherNumbering";

export type ConfirmVoucherNumberResult = {
  data: Record<string, unknown>;
  reserved: boolean;
  provisional: boolean;
  changed: boolean;
};

function currentVoucherNumber(data: Record<string, unknown>): string {
  return String(data.voucherNumber || data.voucherNo || "").trim();
}

async function loadTakenNumbers(companyId: string, excludeId: string): Promise<Set<string>> {
  const rows: Array<Record<string, unknown>> = [];
  try {
    const local = (await listCompanyDocsFromBrowserDb(companyId, "vouchers", {
      forBackupMerge: true,
    })) as Array<Record<string, unknown>>;
    rows.push(...local);
  } catch {
    /* optional */
  }
  try {
    const pending = await readPendingOutboxPayloadsForCompany(companyId, "vouchers");
    for (const [id, payload] of pending) {
      rows.push({ ...payload, id });
    }
  } catch {
    /* optional */
  }
  return collectTakenVoucherNumbers(rows, excludeId);
}

function applyLocalFreeNumber(
  data: Record<string, unknown>,
  voucherId: string,
  taken: Set<string>,
  provisional: boolean
): ConfirmVoucherNumberResult {
  const desired = currentVoucherNumber(data);
  if (!desired) {
    return { data, reserved: false, provisional: false, changed: false };
  }
  const free = nextFreeVoucherNumber(desired, taken);
  if (free === desired) {
    const next = { ...data };
    if (provisional) next[PROVISIONAL_NUMBER_FIELD] = true;
    else delete next[PROVISIONAL_NUMBER_FIELD];
    return { data: next, reserved: !provisional, provisional, changed: false };
  }
  const reason = provisional
    ? `Provisional number ${desired} was already used locally; this voucher was given ${free} until sync confirms it.`
    : `Number ${desired} was already used; this voucher was given ${free}.`;
  const next = applyRenumberedVoucherFields(data, free, { reason });
  if (provisional) next[PROVISIONAL_NUMBER_FIELD] = true;
  else delete next[PROVISIONAL_NUMBER_FIELD];
  if (!next.id) next.id = voucherId;
  return { data: next, reserved: !provisional, provisional, changed: true };
}

/**
 * Online: ask the server to reserve/confirm the number atomically.
 * Offline or if the reserve route is not loaded yet: use local+outbox uniqueness
 * and mark the number provisional so flush can reconcile.
 */
export async function confirmVoucherNumberOnSave(input: {
  companyId: string;
  voucherId: string;
  data: Record<string, unknown>;
  isNew: boolean;
}): Promise<ConfirmVoucherNumberResult> {
  const companyId = String(input.companyId || "").trim();
  const voucherId = String(input.voucherId || "").trim();
  const data = { ...input.data, id: voucherId || input.data.id };
  const desired = currentVoucherNumber(data);
  if (!companyId || !voucherId || !desired) {
    return { data, reserved: false, provisional: false, changed: false };
  }
  const taken = await loadTakenNumbers(companyId, voucherId);
  const desiredTaken = taken.has(desired);
  // Routine edit of an already-confirmed number that is still free for this id: leave it.
  if (!input.isNew && data[PROVISIONAL_NUMBER_FIELD] !== true && !desiredTaken) {
    return { data, reserved: false, provisional: false, changed: false };
  }

  const online =
    typeof navigator === "undefined" || navigator.onLine !== false;

  if (online && isPocketBaseCompanyId(companyId)) {
    try {
      const { getValidPocketBaseAuth, pbRequest } = await import(
        "@/lib/pocketbaseData/pbClient"
      );
      const { pbDeviceId } = await import("@/lib/pocketbaseData/pbSync");
      if (getValidPocketBaseAuth()) {
        const res = (await pbRequest("/api/pl/data/reserve-voucher-number", {
          method: "POST",
          body: {
            company: companyId,
            deviceId: pbDeviceId(),
            voucherId,
            voucherNumber: desired,
            type: String((input.data as Record<string, unknown>).type || ""),
          },
        })) as {
          ok?: boolean;
          voucherNumber?: string;
          reserved?: boolean;
          collision?: boolean;
        };
        const confirmed = String(res?.voucherNumber || "").trim();
        if (res?.ok && confirmed) {
          if (confirmed === desired) {
            const next = { ...data };
            delete next[PROVISIONAL_NUMBER_FIELD];
            return { data: next, reserved: true, provisional: false, changed: false };
          }
          const next = applyRenumberedVoucherFields(data, confirmed, {
            reason: `Server already had ${desired} on another voucher; this one was reserved as ${confirmed}.`,
          });
          delete next[PROVISIONAL_NUMBER_FIELD];
          return { data: next, reserved: true, provisional: false, changed: true };
        }
      }
    } catch {
      /* 404 (hook not loaded yet), auth, or network: fall through to local uniqueness */
    }
  }

  const offlineOrNoReserve = !online || true;
  return applyLocalFreeNumber(data, voucherId, taken, offlineOrNoReserve);
}

/**
 * Before or after a server push: if another live voucher already owns this
 * number, renumber *this* (later) voucher. Does not modify the other row.
 */
export function reconcileVoucherNumberAgainstTaken(
  voucher: Record<string, unknown>,
  takenByOther: Set<string>,
  opts?: { otherId?: string; previousNumberOnThisRecord?: string }
): { doc: Record<string, unknown>; changed: boolean } {
  const id = String(voucher.id || "").trim();
  const number = currentVoucherNumber(voucher);
  if (!id || !number) return { doc: voucher, changed: false };
  if (!takenByOther.has(number)) {
    const next = { ...voucher };
    delete next[PROVISIONAL_NUMBER_FIELD];
    return { doc: next, changed: false };
  }
  if (
    !shouldRenumberIncomingOnCollision({
      incomingId: id,
      incomingNumber: number,
      previousNumberOnThisRecord: opts?.previousNumberOnThisRecord,
      otherId: opts?.otherId || "__other__",
    })
  ) {
    return { doc: voucher, changed: false };
  }
  const free = nextFreeVoucherNumber(number, takenByOther);
  if (!free || free === number) return { doc: voucher, changed: false };
  const doc = applyRenumberedVoucherFields(voucher, free, {
    reason: `On sync, ${number} was already used by another voucher; this later one was changed to ${free}.`,
  });
  delete doc[PROVISIONAL_NUMBER_FIELD];
  return { doc, changed: true };
}

export async function applyRenumberedVoucherLocally(
  companyId: string,
  voucherId: string,
  serverDoc: Record<string, unknown>
): Promise<void> {
  const { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } = await import(
    "@/lib/localCompanyDocMirror"
  );
  const local = (await getCompanyDocFromBrowserDb(companyId, "vouchers", voucherId, {
    includeDeleted: true,
  })) as Record<string, unknown> | null;
  const incoming = serverDoc && typeof serverDoc === "object" ? serverDoc : {};
  const merged = { ...(local || {}), ...incoming, id: voucherId };
  await upsertCompanyDocInBrowserDb(companyId, "vouchers", voucherId, merged, {
    force: true,
    notify: true,
    skipPlanMutationGate: true,
    skipCloudSyncEnqueue: true,
  });
}
