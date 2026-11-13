/** Firestore id — string ya ref-like `{ id }`. */
function ledgerAccountIdEq(a: unknown, accountId: string): boolean {
  const id = String(accountId ?? "").trim();
  if (!id) return false;
  if (a == null || a === "") return false;
  if (typeof a === "string") return a.trim() === id;
  if (typeof a === "object" && a !== null && "id" in (a as Record<string, unknown>)) {
    const inner = (a as { id?: unknown }).id;
    return typeof inner === "string" ? inner.trim() === id : String(inner ?? "").trim() === id;
  }
  return String(a).trim() === id;
}

function toLedgerAmount(n: unknown): number {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(String(n).replace(/,/g, "").trim()) : Number(n);
  return Number.isFinite(x) ? x : 0;
}

export type JournalVoucherLeg = {
  accountId?: unknown;
  accountName?: unknown;
  debit?: unknown;
  credit?: unknown;
};

/** Journal/adjustment — Firestore `entries[]` ya draft `lines[]` ko ek shape me lao (Recent / particulars). */
export function getJournalVoucherLegs(v: Record<string, unknown> | null | undefined): JournalVoucherLeg[] {
  if (!v) return [];
  if (Array.isArray(v.entries) && (v.entries as unknown[]).length > 0) {
    return v.entries as JournalVoucherLeg[];
  }
  if (Array.isArray(v.lines) && (v.lines as unknown[]).length > 0) {
    return (v.lines as Array<Record<string, unknown>>).map((line) => {
      const isCredit = String(line.type || "").toLowerCase() === "credit";
      const amt = toLedgerAmount(line.amount);
      return {
        accountId: line.accountId,
        accountName: line.accountName,
        debit: isCredit ? 0 : amt,
        credit: isCredit ? amt : 0,
      };
    });
  }
  return [];
}

/**
 * Journal ledger — ek hi accountId Dr + Cr alag lines par ho sakta hai; saari matching entries jod kar Dr/Cr nikalo.
 */
export function sumJournalAmountsForAccount(
  entries: unknown,
  accountId: string | null | undefined
): { debit: number; credit: number } {
  if (!Array.isArray(entries) || accountId == null || accountId === "") {
    return { debit: 0, credit: 0 };
  }
  const id = String(accountId);
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    if (!ledgerAccountIdEq((e as { accountId?: unknown })?.accountId, id)) continue;
    debit += Number((e as { debit?: unknown }).debit || 0);
    credit += Number((e as { credit?: unknown }).credit || 0);
  }
  return { debit, credit };
}

/**
 * Reconciliation / copy-ledger — is account ke ledger row par kaun sa Dr/Cr dikhe.
 * Journal me voucher-level total nahi — `entries`/`lines` se is account ki leg.
 */
export function getVoucherLedgerDebitCreditForAccount(
  v: Record<string, unknown>,
  accountId: string
): { debit: number; credit: number } {
  const id = String(accountId ?? "").trim();
  if (!id || !v) return { debit: 0, credit: 0 };

  const t = String(v.type || "");
  const amount = toLedgerAmount(v.total ?? v.amount ?? 0);

  // Journal — sync flip ke baad owned recon account Cr me ho to yahi dikhe
  if (t === "journal" && Array.isArray(v.entries)) {
    const fromEntries = sumJournalAmountsForAccount(v.entries, id);
    if (fromEntries.debit > 0 || fromEntries.credit > 0) return fromEntries;
  }
  if (t === "journal" && Array.isArray(v.lines)) {
    let debit = 0;
    let credit = 0;
    for (const line of v.lines as Array<Record<string, unknown>>) {
      if (!ledgerAccountIdEq(line.accountId, id)) continue;
      const amt = toLedgerAmount(line.amount);
      if (String(line.type || "").toLowerCase() === "credit") credit += amt;
      else debit += amt;
    }
    if (debit > 0 || credit > 0) return { debit, credit };
  }

  // Contra — to = Dr (transfer only), from = Cr (transfer + charge); charge ledger = Dr
  if (t === "contra" && (ledgerAccountIdEq(v.fromAccountId, id) || ledgerAccountIdEq(v.toAccountId, id))) {
    const transfer = Math.max(0, amount - toLedgerAmount(v.otherChargeAmount));
    if (ledgerAccountIdEq(v.toAccountId, id)) return { debit: transfer, credit: 0 };
    if (ledgerAccountIdEq(v.fromAccountId, id)) return { debit: 0, credit: transfer + toLedgerAmount(v.otherChargeAmount) };
  }
  if (t === "contra" && ledgerAccountIdEq(v.otherChargeAccountId, id)) {
    return { debit: toLedgerAmount(v.otherChargeAmount), credit: 0 };
  }

  if (ledgerAccountIdEq(v.partyId, id)) {
    if (["sale", "payment_out", "direct_income"].includes(t)) return { debit: amount, credit: 0 };
    if (["purchase", "payment_in", "direct_expense"].includes(t)) return { debit: 0, credit: amount };
  }

  if (ledgerAccountIdEq(v.accountId, id)) {
    if (["payment_in", "direct_income", "sale"].includes(t)) return { debit: amount, credit: 0 };
    if (["payment_out", "direct_expense", "purchase"].includes(t)) return { debit: 0, credit: amount };
  }

  if (ledgerAccountIdEq(v.expenseAccountId, id) || ledgerAccountIdEq(v.toAccountId, id)) {
    if (t === "direct_expense" || t === "payment_out") return { debit: amount, credit: 0 };
  }
  if (ledgerAccountIdEq(v.incomeAccountId, id)) {
    if (t === "direct_income" || t === "payment_in") return { debit: 0, credit: amount };
  }

  // Fallback — purane shapes jahan sirf top-level Dr/Cr hai
  let debit = toLedgerAmount(v.debit);
  let credit = toLedgerAmount(v.credit);
  const fallbackAmt = amount || Math.max(debit, credit);
  if (debit === 0 && credit === 0 && fallbackAmt > 0) {
    if (t === "purchase" || t === "payment_out" || t === "direct_expense") credit = fallbackAmt;
    else debit = fallbackAmt;
  }
  return { debit, credit };
}
