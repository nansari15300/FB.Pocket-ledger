/** Master list "Latest" — account ke last voucher (ledger date), master createdAt nahi. */

function toDateMs(raw: unknown): number {
  if (!raw) return 0;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 0 : raw.getTime();
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    const d = (raw as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function startOfLocalDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Ledger voucher time: voucher date; same calendar day pe createdAt clock. lastEditedAt/updatedAt skip — approve must not reshuffle Latest. */
export function voucherLastActivityMs(v: Record<string, unknown> | null | undefined): number {
  if (!v) return 0;
  const dateMs = toDateMs(v.date);
  const clockMs = toDateMs(v.createdAt);
  if (!dateMs) return clockMs;
  if (!clockMs) return dateMs;
  if (startOfLocalDayMs(dateMs) === startOfLocalDayMs(clockMs)) return Math.max(dateMs, clockMs);
  return dateMs;
}

function pushId(out: string[], raw: unknown): void {
  const s = String(raw ?? "").trim();
  if (s) out.push(s);
}

/** Party / staff / bank / tax / expense / item ids a voucher touches. */
export function collectVoucherLinkedEntityIds(v: Record<string, unknown>): string[] {
  const ids: string[] = [];
  pushId(ids, v.partyId);
  pushId(ids, v.accountId);
  pushId(ids, v.fromAccountId);
  pushId(ids, v.toAccountId);
  pushId(ids, v.bankAccountId);
  pushId(ids, v.staffId);
  pushId(ids, v.taxAccountId);
  pushId(ids, v.expenseAccountId);
  pushId(ids, v.incomeAccountId);
  pushId(ids, v.salesAccountId);
  pushId(ids, v.purchaseAccountId);
  pushId(ids, v.otherChargeAccountId);
  pushId(ids, v.entityId);
  pushId(ids, v.sourceEntityId);
  pushId(ids, v.targetEntityId);
  pushId(ids, v.interCompanyCounterpartyPartyId);
  pushId(ids, v.payeeId);
  pushId(ids, v.loanId);
  pushId(ids, v.loanAccountId);
  pushId(ids, v.taxId);
  pushId(ids, v.tdsAccountId);
  const adj = v.adjustmentTarget as { id?: unknown } | undefined;
  if (adj && typeof adj === "object") pushId(ids, adj.id);
  else pushId(ids, v.adjustmentTarget);
  if (Array.isArray(v.entries)) {
    for (const e of v.entries as Array<{
      accountId?: unknown;
      partyId?: unknown;
      staffId?: unknown;
      taxAccountId?: unknown;
      expenseAccountId?: unknown;
    }>) {
      pushId(ids, e?.accountId);
      pushId(ids, e?.partyId);
      pushId(ids, e?.staffId);
      pushId(ids, e?.taxAccountId);
      pushId(ids, e?.expenseAccountId);
    }
  }
  if (Array.isArray(v.lineItems)) {
    for (const li of v.lineItems as Array<{
      itemId?: unknown;
      taxAccountId?: unknown;
      tdsAccountId?: unknown;
      accountId?: unknown;
    }>) {
      pushId(ids, li?.itemId);
      pushId(ids, li?.taxAccountId);
      pushId(ids, li?.tdsAccountId);
      pushId(ids, li?.accountId);
    }
  }
  if (Array.isArray(v.items)) {
    for (const li of v.items as Array<{ itemId?: unknown }>) pushId(ids, li?.itemId);
  }
  return ids;
}

export function buildLastVoucherMsByEntityId(vouchers: unknown[] | undefined | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(vouchers)) return map;
  for (const raw of vouchers) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    if (v.isDeleted === true) continue;
    const ms = voucherLastActivityMs(v);
    if (!ms) continue;
    for (const id of collectVoucherLinkedEntityIds(v)) {
      const prev = map.get(id) || 0;
      if (ms > prev) map.set(id, ms);
    }
  }
  return map;
}

export function lastVoucherMsForRow(
  row: object | null | undefined,
  lastVoucherMsById?: Map<string, number> | null
): number {
  if (!row || typeof row !== "object") return 0;
  const r = row as {
    id?: unknown;
    lastVoucherAt?: unknown;
    icMemberParties?: Array<{ id?: unknown }>;
    members?: Array<{ id?: unknown }>;
  };
  const stamped = Number(r.lastVoucherAt);
  if (Number.isFinite(stamped) && stamped > 0) return stamped;
  if (!lastVoucherMsById) return 0;
  let ms = lastVoucherMsById.get(String(r.id ?? "").trim()) || 0;
  const nested = [
    ...(Array.isArray(r.icMemberParties) ? r.icMemberParties : []),
    ...(Array.isArray(r.members) ? r.members : []),
  ];
  for (const m of nested) {
    ms = Math.max(ms, lastVoucherMsById.get(String(m?.id ?? "").trim()) || 0);
  }
  return ms;
}

/** Group id → max(last voucher of direct members). Clones the map. */
export function stampLastVoucherMsFromMemberGroups(
  lastVoucherMsById: Map<string, number>,
  groupMembersByGroupId?: Record<string, Array<{ id?: string }>> | null
): Map<string, number> {
  const out = new Map(lastVoucherMsById);
  if (!groupMembersByGroupId) return out;
  for (const [groupId, members] of Object.entries(groupMembersByGroupId)) {
    const gid = String(groupId || "").trim();
    if (!gid) continue;
    let ms = out.get(gid) || 0;
    for (const m of members || []) {
      ms = Math.max(ms, out.get(String(m?.id ?? "").trim()) || 0);
    }
    if (ms > 0) out.set(gid, ms);
  }
  return out;
}

/** Nested groups: parent last voucher = max of members + descendant groups. */
export function stampLastVoucherMsOnGroupForest<
  N extends { group: { id?: string }; children?: N[] },
>(
  nodes: N[] | undefined | null,
  lastVoucherMsById: Map<string, number>,
  groupMembersByGroupId?: Record<string, Array<{ id?: string }>> | null
): Map<string, number> {
  const out = stampLastVoucherMsFromMemberGroups(lastVoucherMsById, groupMembersByGroupId);
  if (!Array.isArray(nodes)) return out;
  const visit = (list: N[]) => {
    for (const n of list) {
      if (n.children?.length) visit(n.children);
      const gid = String(n.group?.id ?? "").trim();
      if (!gid) continue;
      let ms = out.get(gid) || 0;
      for (const child of n.children || []) {
        const cid = String(child.group?.id ?? "").trim();
        if (cid) ms = Math.max(ms, out.get(cid) || 0);
      }
      if (ms > 0) out.set(gid, ms);
    }
  };
  visit(nodes);
  return out;
}
