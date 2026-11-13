/**
 * Duplicate-voucher guard (save-time warning, never a hard block).
 *
 * Why: ek hi slip/bill galti se dobara attach ho kar dobara save ho jata hai. Sirf voucher number
 * check karne se wo pakda nahi jata (number auto-increment ho jata hai). Yahan 4 tarah ke proof
 * dekhte hain, sabse strong pehle:
 *
 *  1. `file`   — same attachment bytes (SHA-256 blob hash). Sabse bharosemand.
 *  2. `ref`    — OCR ka Txn ID / Reference ID (bank slip ka unique ref).
 *  3. `fields` — same type + date + amount + From/To + charge (math-level identical entry).
 *  4. `narration` — OCR narration text bilkul same (slip ka fingerprint).
 *
 * Har match pe user ko bubble dikhta hai jisme voucher number + reasons hote hain, aur
 * "Open / Save anyway" ka choice — kyunki genuine same-amount entries bhi ho sakti hain.
 */

import { computeSha256HexFromBlob } from "@/lib/security/sha256Hex";

export type DuplicateReason = "file" | "ref" | "fields" | "narration";

export type DuplicateMatch = {
  /** Existing voucher id. */
  id: string;
  /** Existing voucher number (dikhane ke liye). */
  voucherNumber: string;
  /** Existing voucher type (contra / payment_out / ...). */
  type: string;
  /** Existing voucher date (display string). */
  dateText: string;
  amount: number;
  /** Kyun duplicate laga — UI bubble me sabse pehle sabse strong reason dikhao. */
  reasons: DuplicateReason[];
  /** Human sentence, seedha bubble me dikhane layak. */
  summary: string;
};

export type CandidateVoucher = Record<string, unknown> & { id?: string };

const REASON_LABEL: Record<DuplicateReason, string> = {
  file: "same attachment file",
  ref: "same transaction reference",
  fields: "same date, amount and accounts",
  narration: "same OCR narration",
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Total ya payee leg — dono shapes cross-check. */
function voucherAmount(v: CandidateVoucher): number {
  return num(v.amount ?? v.total ?? 0);
}

/** Slip reference — OCR / bank txn id. */
function voucherRef(v: CandidateVoucher): string {
  return str(v.txnId || v.referenceId || v.transactionId || v.reference);
}

/** Ek hi din — local calendar pe compare (UTC shift se off-by-one na ho). */
function sameDay(a: unknown, b: unknown): boolean {
  const toKey = (x: unknown): string => {
    if (x == null || x === "") return "";
    let d: Date | null = null;
    if (x instanceof Date) d = x;
    else if (typeof x === "object" && x !== null && "toDate" in (x as Record<string, unknown>)) {
      try {
        d = (x as { toDate: () => Date }).toDate();
      } catch {
        d = null;
      }
    } else if (typeof x === "object" && x !== null && "seconds" in (x as Record<string, unknown>)) {
      const s = Number((x as { seconds?: unknown }).seconds);
      if (Number.isFinite(s)) d = new Date(s * 1000);
    } else {
      /* ISO "2026-06-08T..." ka date part seedha lo — `new Date()` UTC shift se din badal sakta hai. */
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x).trim());
      if (m) return `${Number(m[1])}-${Number(m[2])}-${Number(m[3])}`;
      const parsed = new Date(String(x));
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }
    if (!d || Number.isNaN(d.getTime())) return "";
    /* Local calendar day — user ne jo din dekha wahi compare ho. */
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const ka = toKey(a);
  const kb = toKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/**
 * Attachment blob hash — sirf naye `File` items ka. `string` items (purane URLs / refs) skip,
 * unka hash store hi nahi hota isliye compare possible nahi.
 */
export async function hashAttachmentFiles(files: readonly (File | string)[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || !f.size) continue;
    try {
      const h = await computeSha256HexFromBlob(f);
      if (h) out.push(h.toLowerCase());
    } catch {
      /* hash optional — duplicate guard skip kar de is file ke liye */
    }
  }
  return Array.from(new Set(out));
}

/** Voucher row me saved attachment hashes (kisi bhi purane row me na ho to empty). */
export function savedAttachmentHashes(v: CandidateVoucher): Set<string> {
  const raw = (v.attachmentHashes ?? v.fileHashes) as unknown;
  const out = new Set<string>();
  if (Array.isArray(raw)) {
    raw.forEach((x) => {
      const s = str(x).toLowerCase();
      if (s) out.add(s);
    });
  }
  return out;
}

export type FindDuplicateInput = {
  /** Current voucher (edit mode) — khud ko duplicate mat gino. */
  excludeVoucherId?: string | null;
  type: string;
  date: unknown;
  amount: number;
  fromAccountId?: string;
  toAccountId?: string;
  accountId?: string;
  otherChargeAmount?: number;
  otherChargeAccountId?: string;
  narration?: string;
  ref?: string;
  /** `hashAttachmentFiles()` ka output. */
  attachmentHashes?: readonly string[];
};

/**
 * Candidate vouchers me duplicate dhundo. Multiple match ho to sabse strong reason wala
 * (file > ref > fields > narration) pehle, phir latest date.
 */
export function findDuplicateVoucher(
  candidates: readonly CandidateVoucher[] | undefined | null,
  input: FindDuplicateInput
): DuplicateMatch | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const excludeId = str(input.excludeVoucherId);
  const myType = str(input.type);
  const myAmount = Math.abs(num(input.amount));
  const myHashes = new Set((input.attachmentHashes ?? []).map((h) => str(h).toLowerCase()).filter(Boolean));
  const myRef = str(input.ref).toLowerCase();
  const myNarration = str(input.narration).toLowerCase();
  const myFrom = str(input.fromAccountId);
  const myTo = str(input.toAccountId || input.accountId);
  const myCharge = num(input.otherChargeAmount);

  const found: DuplicateMatch[] = [];

  for (const v of candidates) {
    if (!v || typeof v !== "object") continue;
    if (excludeId && str(v.id) === excludeId) continue;
    if (v.isDeleted === true || v.type === "opening_balance") continue;
    if (str(v.type) !== myType) continue;

    const reasons: DuplicateReason[] = [];

    // 1. Same attachment bytes — sabse strong; type same hona zaroori (already checked).
    if (myHashes.size) {
      const theirs = savedAttachmentHashes(v);
      for (const h of myHashes) {
        if (theirs.has(h)) {
          reasons.push("file");
          break;
        }
      }
    }

    // 2. Same bank/OCR reference.
    if (myRef) {
      const theirs = voucherRef(v).toLowerCase();
      if (theirs && theirs === myRef) reasons.push("ref");
    }

    // 3. Same date + amount + same legs. Accounts/charge ka mismatch genuine ho sakta hai — isliye
    //    date+amount match ho to hi "fields" maano (accounts sirf confirmation).
    const theirAmount = Math.abs(voucherAmount(v));
    if (
      myAmount > 0 &&
      theirAmount > 0 &&
      Math.abs(theirAmount - myAmount) < 0.005 &&
      sameDay(v.date, input.date)
    ) {
      const type = myType;
      const fromOk = !myFrom || !str(v.fromAccountId) || str(v.fromAccountId) === myFrom;
      const toOk = !myTo || !str(v.toAccountId || v.accountId) || str(v.toAccountId || v.accountId) === myTo;
      const chargeOk = Math.abs(num(v.otherChargeAmount) - myCharge) < 0.005;
      const legOk =
        type === "contra"
          ? fromOk && toOk
          : type === "payment_out" || type === "direct_expense"
            ? fromOk || toOk
            : true;
      if (legOk && chargeOk) reasons.push("fields");
    }

    // 4. Same OCR narration text.
    if (myNarration.length >= 12) {
      const theirs = str(v.narration).toLowerCase();
      if (theirs && theirs === myNarration) reasons.push("narration");
    }

    if (!reasons.length) continue;

    reasons.sort((a, b) => rank(a) - rank(b));
    const primary = reasons[0];
    const voucherNumber = str(
      myType === "contra" ? v.voucherNumberOut ?? v.voucherNumber : v.voucherNumber
    ) || str(v.id);

    found.push({
      id: str(v.id),
      voucherNumber,
      type: str(v.type),
      dateText: displayDate(v.date),
      amount: theirAmount,
      reasons,
      summary: buildSummary(primary, voucherNumber, reasons),
    });
  }

  if (!found.length) return null;
  found.sort((a, b) => rank(a.reasons[0]) - rank(b.reasons[0]));
  return found[0];
}

function rank(r: DuplicateReason): number {
  switch (r) {
    case "file":
      return 0;
    case "ref":
      return 1;
    case "fields":
      return 2;
    case "narration":
      return 3;
  }
}

function displayDate(d: unknown): string {
  if (d instanceof Date) return d.toLocaleDateString();
  if (typeof d === "object" && d !== null && "toDate" in (d as Record<string, unknown>)) {
    try {
      return (d as { toDate: () => Date }).toDate().toLocaleDateString();
    } catch {
      return "";
    }
  }
  const s = String(d ?? "").slice(0, 10);
  return s;
}

function buildSummary(primary: DuplicateReason, voucherNumber: string, reasons: readonly DuplicateReason[]): string {
  const extra = reasons.length > 1 ? ` (+${reasons.length - 1} more)` : "";
  return `Duplicate of voucher ${voucherNumber} — ${REASON_LABEL[primary]}${extra}.`;
}

export { REASON_LABEL };
