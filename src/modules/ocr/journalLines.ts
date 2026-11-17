/**
 * AI Dr/Cr lines -> Journal form rows ({ accountId, entityType, type, amount }). Pure (selftests run it).
 * Each line is looked up only in the master list its `kind` names (bank/cash -> own Bank/Cash ledgers by account
 * number or name, party -> parties, staff -> staff, tax -> taxes, expense/income/... -> ledger accounts).
 * An unmatched ledger keeps its row with an empty account so the user picks it; nothing is invented.
 */
import type { OcrAiLine } from "./ai/aiVoucher";
import { masterNameScore, pickUniqueOwnAccount, type OwnAccountLike } from "@/lib/ocr/receiptDetect";

export type JournalMaster = { id: string; name: string; aliasName?: string };
export type JournalMasters = {
  accounts: readonly OwnAccountLike[];
  parties: readonly JournalMaster[];
  staff: readonly JournalMaster[];
  ledgers: readonly JournalMaster[];
  taxes: readonly JournalMaster[];
};
export type JournalRow = { accountId: string; entityType: string; type: "debit" | "credit"; amount: number; isAutoLine: boolean };
export type JournalMapResult = { rows: JournalRow[]; unmatched: { index: number; name: string }[] };

const MIN = 0.9;
const GAP = 0.03;

function best(name: string, pool: readonly JournalMaster[]): JournalMaster | null {
  let top: { m: JournalMaster; s: number } | null = null;
  let second = 0;
  for (const m of pool) {
    const s = Math.max(masterNameScore(name, m.name), m.aliasName ? masterNameScore(name, m.aliasName) : 0);
    if (!top || s > top.s) { if (top) second = Math.max(second, top.s); top = { m, s }; } else second = Math.max(second, s);
  }
  return top && top.s >= MIN && top.s - second >= GAP ? top.m : null;
}

export function mapAiJournalLines(lines: readonly OcrAiLine[], M: JournalMasters): JournalMapResult {
  const rows: JournalRow[] = [];
  const unmatched: { index: number; name: string }[] = [];
  const accountPool = M.accounts.map((a) => ({ id: a.id, name: String(a.accountName ?? ""), aliasName: a.aliasName }));
  lines.forEach((l, i) => {
    const name = String(l.name ?? "").trim();
    let hit: { id: string; entityType: string } | null = null;
    if (l.kind === "bank" || l.kind === "cash") {
      const pick = pickUniqueOwnAccount({ accountName: name || undefined, accountMasked: l.account_no ?? undefined, bankName: l.bank_name ?? undefined }, M.accounts);
      if (pick.ok) hit = { id: pick.acc.id, entityType: "account" };
      else if (name) { const m = best(name, accountPool); if (m) hit = { id: m.id, entityType: "account" }; }
    } else if (name) {
      const order: [readonly JournalMaster[], string][] =
        l.kind === "party" ? [[M.parties, "party"]]
        : l.kind === "staff" ? [[M.staff, "staff"]]
        : l.kind === "tax" ? [[M.taxes, "tax"], [M.ledgers, "expense"]]
        : [[M.ledgers, "expense"], [M.taxes, "tax"]];
      for (const [pool, et] of order) { const m = best(name, pool); if (m) { hit = { id: m.id, entityType: et }; break; } }
    }
    if (!hit) unmatched.push({ index: i, name: name || [l.bank_name, l.account_no].filter(Boolean).join(" ") || l.kind });
    rows.push({ accountId: hit?.id ?? "", entityType: hit?.entityType ?? "", type: l.side === "dr" ? "debit" : "credit", amount: Math.max(0, Number(l.amount) || 0), isAutoLine: false });
  });
  return { rows, unmatched };
}
