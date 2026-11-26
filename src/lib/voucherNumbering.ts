/**
 * Pure voucher-number helpers used by local next-number, online reserve,
 * and sync-time collision reconcile. No network, no server writes.
 *
 * Historical duplicates already on the server are never auto-renumbered
 * here: only a *new claim* of a number already owned by a *different*
 * voucher is reassigned.
 */

import {
  formatVoucherNumberWithFy,
  padVoucherNumberPart,
  resolvePrefixFromVoucherNumber,
} from "@/lib/voucherNumberFormat";

export const NUMBERING_AUDIT_FIELD = "numberingAudit";
export const AUTO_RENUMBERED_FROM_FIELD = "autoRenumberedFrom";
export const AUTO_RENUMBERED_AT_FIELD = "autoRenumberedAt";
export const AUTO_RENUMBER_NOTE_FIELD = "autoRenumberNote";
export const PROVISIONAL_NUMBER_FIELD = "voucherNumberProvisional";

export type NumberingAuditEntry = {
  from: string;
  to: string;
  at: number;
  reason: string;
};

export type VoucherNumberParts = {
  head: string;
  serial: number;
};

export type DuplicateVoucherNumberGroup = {
  voucherNumber: string;
  ids: string[];
  types: string[];
};

/** Split `PYMT-83-84-0183`, `PYMT - 0183`, `CNTR Out - 028` into head + serial. */
export function parseVoucherNumberParts(voucherNo: string): VoucherNumberParts | null {
  const trimmed = String(voucherNo || "").trim();
  if (!trimmed) return null;
  const m = /^(.*?)(\d+)$/.exec(trimmed);
  if (!m) return null;
  const serial = parseInt(m[2]!, 10);
  if (!Number.isFinite(serial) || serial < 1) return null;
  return { head: m[1]!, serial };
}

export function formatVoucherNumberParts(parts: VoucherNumberParts): string {
  return `${parts.head}${padVoucherNumberPart(parts.serial)}`;
}

/** FY span like `83-84` from `PYMT-83-84-001` / `Sale Inv-83-84-001`. */
export function extractFySegmentLoose(voucherNo: string): string | null {
  const trimmed = String(voucherNo || "").trim();
  if (!trimmed) return null;
  const m = /(\d{2,4}-\d{2,4})-(?=\d+$)/.exec(trimmed);
  return m ? m[1]! : null;
}

export function voucherNumberUsesPrefixList(voucherNo: string, prefixes: string[]): boolean {
  const vn = String(voucherNo || "").trim();
  const allowed = prefixes.map((p) => String(p || "").trim()).filter(Boolean);
  if (!vn || allowed.length === 0) return false;
  return Boolean(resolvePrefixFromVoucherNumber(vn, allowed, ""));
}

/**
 * Keep `desired` when it already uses this type's prefix. Otherwise retarget
 * onto the type's first prefix, preserving any FY span, then pick the next
 * free serial. Never switches a voucher onto another type's series.
 */
export function coerceVoucherNumberToAllowedPrefix(
  desired: string,
  allowedPrefixes: string[],
  taken: Iterable<string>
): string {
  const want = String(desired || "").trim();
  if (!want) return want;
  const allowed = allowedPrefixes.map((p) => String(p || "").trim()).filter(Boolean);
  if (allowed.length === 0) return nextFreeVoucherNumber(want, taken);
  if (voucherNumberUsesPrefixList(want, allowed)) return nextFreeVoucherNumber(want, taken);
  const first = formatVoucherNumberWithFy(allowed[0]!, extractFySegmentLoose(want), 1);
  return nextFreeVoucherNumber(first, taken);
}

/**
 * If `desired` is free, keep it. If it is taken (or we must bump), return the
 * next unused number with the same prefix/FY head, starting after the higher
 * of `desired` and every taken serial with that head.
 */
export function nextFreeVoucherNumber(desired: string, taken: Iterable<string>): string {
  const want = String(desired || "").trim();
  const takenSet = new Set(Array.from(taken, (n) => String(n || "").trim()).filter(Boolean));
  if (want && !takenSet.has(want)) return want;
  const parsed = parseVoucherNumberParts(want);
  if (!parsed) {
    let i = 2;
    while (takenSet.has(`${want}-${i}`)) i += 1;
    return want ? `${want}-${i}` : "";
  }
  let maxSerial = parsed.serial;
  for (const n of takenSet) {
    const p = parseVoucherNumberParts(n);
    if (p && p.head === parsed.head && p.serial > maxSerial) maxSerial = p.serial;
  }
  let serial = maxSerial + 1;
  let candidate = formatVoucherNumberParts({ head: parsed.head, serial });
  while (takenSet.has(candidate)) {
    serial += 1;
    candidate = formatVoucherNumberParts({ head: parsed.head, serial });
  }
  return candidate;
}

/**
 * Renumber only when this write is *claiming* a number already used by a
 * different voucher. If this voucher already had that number (historical
 * duplicate being edited for other fields), leave it alone.
 */
export function shouldRenumberIncomingOnCollision(opts: {
  incomingId: string;
  incomingNumber: string;
  previousNumberOnThisRecord?: string | null;
  otherId: string;
}): boolean {
  const incomingId = String(opts.incomingId || "").trim();
  const otherId = String(opts.otherId || "").trim();
  const number = String(opts.incomingNumber || "").trim();
  if (!incomingId || !otherId || !number) return false;
  if (incomingId === otherId) return false;
  const previous = String(opts.previousNumberOnThisRecord || "").trim();
  if (previous && previous === number) return false;
  return true;
}

export function retargetVoucherNumber(oldNumber: string, newSerial: number): string {
  const parsed = parseVoucherNumberParts(oldNumber);
  if (!parsed || !Number.isFinite(newSerial) || newSerial < 1) return String(oldNumber || "");
  return formatVoucherNumberParts({ head: parsed.head, serial: newSerial });
}

export function applyRenumberedVoucherFields(
  voucher: Record<string, unknown>,
  newNumber: string,
  opts?: { reason?: string; at?: number }
): Record<string, unknown> {
  const next = { ...voucher };
  const oldMain = String(next.voucherNumber || next.voucherNo || "").trim();
  const newNo = String(newNumber || "").trim();
  if (!newNo || newNo === oldMain) return next;
  const newParts = parseVoucherNumberParts(newNo);
  const serial = newParts?.serial;

  next.voucherNumber = newNo;
  if (next.voucherNo != null) next.voucherNo = newNo;

  if (serial && next.voucherNumberOut) {
    next.voucherNumberOut = retargetVoucherNumber(String(next.voucherNumberOut), serial) || next.voucherNumberOut;
  }
  if (serial && next.voucherNumberIn) {
    next.voucherNumberIn = retargetVoucherNumber(String(next.voucherNumberIn), serial) || next.voucherNumberIn;
  }
  if (serial && next.productionNumber) {
    const prod = String(next.productionNumber);
    const retargeted = retargetVoucherNumber(prod, serial);
    if (retargeted) next.productionNumber = retargeted;
  }

  const at = typeof opts?.at === "number" && Number.isFinite(opts.at) ? opts.at : Date.now();
  const reason =
    opts?.reason ||
    `Voucher number ${oldMain || "(blank)"} was already used by another voucher; this one was changed to ${newNo}.`;
  const prevAudit = Array.isArray(next[NUMBERING_AUDIT_FIELD])
    ? ([...(next[NUMBERING_AUDIT_FIELD] as NumberingAuditEntry[])] as NumberingAuditEntry[])
    : [];
  prevAudit.push({ from: oldMain, to: newNo, at, reason });
  next[NUMBERING_AUDIT_FIELD] = prevAudit;
  next[AUTO_RENUMBERED_FROM_FIELD] = oldMain;
  next[AUTO_RENUMBERED_AT_FIELD] = at;
  next[AUTO_RENUMBER_NOTE_FIELD] = reason;
  next[PROVISIONAL_NUMBER_FIELD] = false;
  return next;
}

function isLiveVoucherRow(row: Record<string, unknown>): boolean {
  return !(
    row.isDeleted === true ||
    row.deleted === true ||
    row.movedToAdminRecycleAt != null ||
    row.plPermanentlyPurged === true
  );
}

function rowVoucherNumbers(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["voucherNumber", "voucherNo", "voucherNumberOut", "voucherNumberIn", "productionNumber"] as const) {
    const n = String(row[key] || "").trim();
    if (n) out.push(n);
  }
  return out;
}

/** Read-only: groups of live vouchers that share the same displayed number. */
export function findDuplicateVoucherNumberGroups(
  rows: Array<Record<string, unknown>>
): DuplicateVoucherNumberGroup[] {
  const byNumber = new Map<string, { ids: Set<string>; types: Set<string> }>();
  for (const row of rows) {
    if (!isLiveVoucherRow(row)) continue;
    const id = String(row.id || "").trim();
    if (!id) continue;
    const type = String(row.type || "").trim();
    const seen = new Set<string>();
    for (const n of rowVoucherNumbers(row)) {
      if (seen.has(n)) continue;
      seen.add(n);
      let g = byNumber.get(n);
      if (!g) {
        g = { ids: new Set(), types: new Set() };
        byNumber.set(n, g);
      }
      g.ids.add(id);
      if (type) g.types.add(type);
    }
  }
  const groups: DuplicateVoucherNumberGroup[] = [];
  for (const [voucherNumber, g] of byNumber) {
    if (g.ids.size < 2) continue;
    groups.push({
      voucherNumber,
      ids: [...g.ids],
      types: [...g.types],
    });
  }
  groups.sort((a, b) => a.voucherNumber.localeCompare(b.voucherNumber));
  return groups;
}

/** Taken numbers from a row list, optionally excluding one voucher id. */
export function collectTakenVoucherNumbers(
  rows: Array<Record<string, unknown>>,
  excludeId?: string
): Set<string> {
  const taken = new Set<string>();
  const skip = String(excludeId || "").trim();
  for (const row of rows) {
    if (!isLiveVoucherRow(row)) continue;
    const id = String(row.id || "").trim();
    if (skip && id === skip) continue;
    for (const n of rowVoucherNumbers(row)) taken.add(n);
  }
  return taken;
}
