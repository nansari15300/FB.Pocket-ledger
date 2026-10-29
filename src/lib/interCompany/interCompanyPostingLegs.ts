/**
 * Inter Company — compound ledger legs (clearing bank ↔ destination account ↔ IC conduit).
 * Unapproved: clearing + destination row dikhe (Dr/Cr 0); balance approve ke baad.
 * Approved: clearing Dr+Cr (path-through) + destination one-side
 *   (party/staff/tax/expense/bank same — target bank select pe clearing bypass nahi).
 * Journal mode: target destination Dr/Cr ulta = Payment jaisa.
 */
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import {
  inferInterCompanyEntity,
  interCompanyVoucherViewerSide,
  isInterCompanyVisibleOnTargetBank,
  isInterCompanyVisibleOnTargetEntity,
  readInterCompanyCompanyBankId,
  readInterCompanyLink,
} from "@/lib/interCompany/interCompanyVoucherHydrate";
import { resolveInterCompanyOtherChargeKindFromVoucher } from "@/lib/interCompany/resolveInterCompanyOtherChargeKind";

function voucherHasInterCompanyPeerPending(voucher: Record<string, unknown>): boolean {
  const raw = voucher.interCompanyPeerPending;
  if (!raw || typeof raw !== "object") return false;
  const proposed = (raw as { proposed?: unknown }).proposed;
  return !!proposed && typeof proposed === "object" && Object.keys(proposed as object).length > 0;
}

export type InterCompanyLedgerLeg = {
  /** party | bank | staff | tax | expense */
  kind: InterCompanyEntityKind;
  accountId: string;
  debit: number;
  credit: number;
};

/** Target destination posting: Payment In (default) vs Journal (Dr/Cr ulta on target account). */
export type InterCompanyTargetPostMode = "payment_in" | "journal";

export function normalizeInterCompanyTargetPostMode(raw: unknown): InterCompanyTargetPostMode {
  return String(raw || "").trim().toLowerCase() === "journal" ? "journal" : "payment_in";
}

export function isInterCompanyTargetJournalPostMode(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  return normalizeInterCompanyTargetPostMode(voucher?.interCompanyTargetPostMode) === "journal";
}

/**
 * Auto narration (web / EXE / APK — same static line):
 * From company "…" from account "…" paid to company "…" to account "…" Ref IC voucher No - IC - 001
 */
export function buildInterCompanyAutoNarration(args: {
  sourceCompanyName?: string | null;
  sourceEntityLabel?: string | null;
  targetCompanyName?: string | null;
  targetEntityLabel?: string | null;
  voucherNumber?: string | null;
}): string {
  const srcCo = String(args.sourceCompanyName || "").trim() || "Source company";
  const srcAc = String(args.sourceEntityLabel || "").trim() || "account";
  const tgtCo = String(args.targetCompanyName || "").trim() || "Target company";
  const tgtAc = String(args.targetEntityLabel || "").trim() || "account";
  const vn = String(args.voucherNumber || "").trim();
  const ref = vn ? ` Ref IC voucher No - ${vn}` : "";
  return `From company "${srcCo}" from account "${srcAc}" paid to company "${tgtCo}" to account "${tgtAc}"${ref}`;
}

/** @deprecated use buildInterCompanyAutoNarration */
export function buildInterCompanyJournalNarration(args: {
  sourceCompanyName?: string | null;
  sourceEntityLabel?: string | null;
  targetCompanyName?: string | null;
  targetEntityLabel?: string | null;
  voucherNumber?: string | null;
}): string {
  return buildInterCompanyAutoNarration(args);
}

/** Strip IC ref brackets + optional current auto line — user typed part bachaao. */
export function extractInterCompanyUserNarration(
  raw: string | null | undefined,
  autoLine?: string | null
): string {
  let t = String(raw || "").trim();
  if (!t) return "";
  t = t.replace(/\[Inter-company[^\]]*\]/gi, "").trim();
  if (!t) return "";
  const auto = String(autoLine || "").trim();
  const lines = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (auto && line === auto) continue;
    // Pehli auto-shaped line hatao (purani auto jab accounts badle)
    if (
      i === 0 &&
      (/^(.+), (.+) paid to (.+), (.+)$/.test(line) ||
        /^From company "/.test(line) ||
        /^From company .+ paid to company .+ Ref IC voucher No/i.test(line))
    )
      continue;
    rest.push(line);
  }
  return rest.join("\n").trim();
}

/** Auto line must + optional user typed (duplicate auto mat jodo). */
export function composeInterCompanyNarrationBase(
  autoLine: string,
  userTyped: string | null | undefined
): string {
  const auto = String(autoLine || "").trim();
  const user = String(userTyped || "").trim();
  if (!auto) return user;
  if (!user) return auto;
  if (user === auto || user.startsWith(`${auto}\n`) || user.startsWith(auto)) {
    // Ensure auto is first line current
    const extra = extractInterCompanyUserNarration(user, auto);
    return extra ? `${auto}\n${extra}` : auto;
  }
  return `${auto}\n${user}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type IcLegAmountResult = { touched: boolean; debit: number; credit: number };

/**
 * Revert accept ke baad — entity/bank row par Dr/Cr dono equal dikhao;
 * running balance `debit - credit` net zero rahe (sirf ek side se balance na bigde).
 */
export function applyInterCompanyReversedLedgerNetZero(
  voucher: Record<string, unknown>,
  result: IcLegAmountResult
): IcLegAmountResult {
  if (!result.touched || voucher?.interCompanyReversed !== true) return result;
  const bump = Math.max(round2(result.debit), round2(result.credit));
  if (bump <= 0) return result;
  return { touched: true, debit: bump, credit: bump };
}

function finalizeIcLegAmounts(voucher: Record<string, unknown>, result: IcLegAmountResult): IcLegAmountResult {
  return applyInterCompanyReversedLedgerNetZero(voucher, result);
}

/** IC Com ledger — source: sent = Dr; target: received = Cr (ek side only). */
function appendIcComSourceLeg(
  legs: InterCompanyLedgerLeg[],
  icId: string,
  amt: number,
  useConduit: boolean
): void {
  if (useConduit && icId) {
    legs.push({ kind: "party", accountId: icId, debit: amt, credit: 0 });
  }
}

function appendIcComTargetLeg(
  legs: InterCompanyLedgerLeg[],
  icId: string,
  amt: number,
  useConduit: boolean
): void {
  if (useConduit && icId) {
    legs.push({ kind: "party", accountId: icId, debit: 0, credit: amt });
  }
}

/** Party/staff/tax/expense — bank kind nahi (IC conduit pair check). */
export function isInterCompanyNonBankEntity(
  kind: InterCompanyEntityKind | null | undefined,
  entityId: unknown
): boolean {
  const id = String(entityId || "").trim();
  if (!id) return false;
  const k = String(kind || "")
    .toLowerCase()
    .trim();
  return k !== "" && k !== "bank";
}

/**
 * Destination Source/Target account (must) — Party/Staff/Tax/Expense/Bank;
 * clearing bank khud destination nahi.
 */
export function isInterCompanyDestinationAccount(
  kind: InterCompanyEntityKind | null | undefined,
  entityId: unknown,
  companyBankAccountId?: unknown
): boolean {
  const id = String(entityId || "").trim();
  if (!id) return false;
  const clearing = String(companyBankAccountId || "").trim();
  if (clearing && id === clearing) return false;
  const k = String(kind || "")
    .toLowerCase()
    .trim();
  return k === "party" || k === "bank" || k === "staff" || k === "tax" || k === "expense";
}

/** Dono sides par non-bank entity — tab hi IC · Due from/to conduit party. */
export function interCompanyPairUsesConduitParty(args: {
  sourceEntityKind: InterCompanyEntityKind;
  sourceEntityId: string;
  targetEntityKind: InterCompanyEntityKind;
  targetEntityId: string;
}): boolean {
  return (
    isInterCompanyNonBankEntity(args.sourceEntityKind, args.sourceEntityId) &&
    isInterCompanyNonBankEntity(args.targetEntityKind, args.targetEntityId)
  );
}

/** Saved voucher par IC conduit party use hoti hai ya nahi. */
export function interCompanyUsesConduitParty(voucher: Record<string, unknown>): boolean {
  const icId = String(voucher.interCompanyCounterpartyPartyId || "").trim();
  if (icId) return true;
  const src = inferInterCompanyEntity(voucher, "source");
  const tgt = inferInterCompanyEntity(voucher, "target");
  return (
    isInterCompanyNonBankEntity(src?.kind, src?.id) &&
    isInterCompanyNonBankEntity(tgt?.kind, tgt?.id)
  );
}

/** Source company — Payment style bank outflow (transfer + optional other charge). */
export function readInterCompanyOtherCharge(voucher: Record<string, unknown>): {
  accountId: string;
  amount: number;
} {
  const side = resolveInterCompanyViewerSide(voucher);
  if (side !== "source") return { accountId: "", amount: 0 };
  const amount = round2(Number(voucher.otherChargeAmount) || 0);
  const accountId = String(voucher.otherChargeAccountId || "").trim();
  if (amount <= 0 || !accountId) return { accountId: "", amount: 0 };
  return { accountId, amount };
}

export function interCompanySourceBankOutflowAmount(voucher: Record<string, unknown>): number {
  const transfer = round2(Number(voucher.amount ?? voucher.total) || 0);
  const { amount: other } = readInterCompanyOtherCharge(voucher);
  return round2(transfer + other);
}

function appendInterCompanyOtherChargeSourceLeg(
  legs: InterCompanyLedgerLeg[],
  otherChargeAccountId: string | undefined,
  otherChargeAmount: number | undefined,
  otherChargeKind: InterCompanyEntityKind | null | undefined
): void {
  const otherAmt = round2(Number(otherChargeAmount) || 0);
  const accountId = String(otherChargeAccountId || "").trim();
  if (otherAmt <= 0 || !accountId || !otherChargeKind) return;
  legs.push({ kind: otherChargeKind, accountId, debit: otherAmt, credit: 0 });
}

/** Source company — save/unapproved: amount clearing pe Cr (Payment); destination baad me. */
export function buildSourceInterCompanyLegs(args: {
  amount: number;
  entityKind: InterCompanyEntityKind;
  entityId: string;
  companyBankAccountId: string;
  interCompanyCounterpartyPartyId: string;
  useIcConduit?: boolean;
  otherChargeAccountId?: string;
  otherChargeAmount?: number;
  otherChargeKind?: InterCompanyEntityKind | null;
}): InterCompanyLedgerLeg[] {
  const amt = round2(Number(args.amount) || 0);
  const otherAmt = round2(Number(args.otherChargeAmount) || 0);
  const bankOut = round2(amt + otherAmt);
  if (amt <= 0 && otherAmt <= 0) return [];
  const { companyBankAccountId: bankId, interCompanyCounterpartyPartyId: icId } = args;
  const useConduit = args.useIcConduit === true;
  const legs: InterCompanyLedgerLeg[] = [];
  if (amt > 0) appendIcComSourceLeg(legs, icId, amt, useConduit);
  if (bankId && bankOut > 0) {
    legs.push({ kind: "bank", accountId: bankId, debit: 0, credit: bankOut });
  }
  appendInterCompanyOtherChargeSourceLeg(
    legs,
    args.otherChargeAccountId,
    otherAmt,
    args.otherChargeKind
  );
  return legs;
}

/** Target company — pending: amount clearing pe Dr (Payment In); destination approve par. */
export function buildTargetInterCompanyLegsPending(args: {
  amount: number;
  entityKind?: InterCompanyEntityKind;
  entityId?: string;
  companyBankAccountId?: string;
  interCompanyCounterpartyPartyId: string;
  useIcConduit?: boolean;
}): InterCompanyLedgerLeg[] {
  const amt = round2(Number(args.amount) || 0);
  if (amt <= 0) return [];
  const bankId = String(args.companyBankAccountId || "").trim();
  const icId = String(args.interCompanyCounterpartyPartyId || "").trim();
  const useConduit = args.useIcConduit === true;
  const legs: InterCompanyLedgerLeg[] = [];
  appendIcComTargetLeg(legs, icId, amt, useConduit);
  if (bankId) {
    legs.push({ kind: "bank", accountId: bankId, debit: amt, credit: 0 });
  }
  return legs;
}

/**
 * Destination Dr/Cr — Payment In/Out jaisa:
 * Bank/Cash: Out=Cr, In=Dr; Party/Staff/Tax/Expense: Out=Dr, In=Cr.
 * Journal mode on target: Payment style (Payment In se ulta).
 */
function destinationLegAmount(
  side: "source" | "target",
  entityKind: InterCompanyEntityKind,
  amt: number,
  targetPostMode: InterCompanyTargetPostMode = "payment_in"
): { debit: number; credit: number } {
  const isBank = String(entityKind || "").toLowerCase() === "bank";
  if (side === "source") {
    // Payment
    return isBank ? { debit: 0, credit: amt } : { debit: amt, credit: 0 };
  }
  if (targetPostMode === "journal") {
    // Target Journal — Payment jaisa (Payment In se ulta); company-to-company conduit alag leg.
    return isBank ? { debit: 0, credit: amt } : { debit: amt, credit: 0 };
  }
  // Payment In (default)
  return isBank ? { debit: amt, credit: 0 } : { debit: 0, credit: amt };
}

/**
 * Source approve: destination Payment jaisa (one side); clearing bank madhyasth (Dr+Cr).
 * Destination bank/party/staff/tax/expense — same; clearing kabhi bypass mat karo.
 */
export function buildSourceInterCompanyLegsApproved(args: {
  amount: number;
  entityKind: InterCompanyEntityKind;
  entityId: string;
  companyBankAccountId: string;
  interCompanyCounterpartyPartyId: string;
  useIcConduit?: boolean;
  otherChargeAccountId?: string;
  otherChargeAmount?: number;
  otherChargeKind?: InterCompanyEntityKind | null;
}): InterCompanyLedgerLeg[] {
  const amt = round2(Number(args.amount) || 0);
  const otherAmt = round2(Number(args.otherChargeAmount) || 0);
  const bankOut = round2(amt + otherAmt);
  if (amt <= 0 && otherAmt <= 0) return [];
  const { entityKind, entityId, companyBankAccountId: bankId, interCompanyCounterpartyPartyId: icId } = args;
  const useConduit = args.useIcConduit === true;
  const destination = isInterCompanyDestinationAccount(entityKind, entityId, bankId);
  const legs: InterCompanyLedgerLeg[] = [];
  if (amt > 0) appendIcComSourceLeg(legs, icId, amt, useConduit);
  if (destination && entityId) {
    const sideAmt = destinationLegAmount("source", entityKind, amt);
    legs.push({ kind: entityKind, accountId: entityId, debit: sideAmt.debit, credit: sideAmt.credit });
    if (bankId && bankOut > 0) {
      // Approved: clearing pe dono side (path-through) — destination alag one-side
      legs.push({ kind: "bank", accountId: bankId, debit: bankOut, credit: bankOut });
    }
    appendInterCompanyOtherChargeSourceLeg(
      legs,
      args.otherChargeAccountId,
      otherAmt,
      args.otherChargeKind
    );
    return legs;
  }
  if (bankId && bankOut > 0) {
    // Destination missing — amount clearing pe one-side (Payment = Cr)
    legs.push({ kind: "bank", accountId: bankId, debit: 0, credit: bankOut });
  }
  appendInterCompanyOtherChargeSourceLeg(
    legs,
    args.otherChargeAccountId,
    otherAmt,
    args.otherChargeKind
  );
  return legs;
}

/**
 * Target approve: destination Payment In / Journal one-side (party/staff/tax/expense/bank same).
 * Clearing approved pe Dr+Cr — target bank select hone par bhi bypass nahi.
 */
export function buildTargetInterCompanyLegsApproved(args: {
  amount: number;
  entityKind: InterCompanyEntityKind;
  entityId: string;
  companyBankAccountId: string;
  interCompanyCounterpartyPartyId: string;
  useIcConduit?: boolean;
  targetPostMode?: InterCompanyTargetPostMode;
}): InterCompanyLedgerLeg[] {
  const amt = round2(Number(args.amount) || 0);
  if (amt <= 0) return [];
  const { entityKind, entityId, companyBankAccountId: bankId, interCompanyCounterpartyPartyId: icId } = args;
  const useConduit = args.useIcConduit === true;
  const postMode = normalizeInterCompanyTargetPostMode(args.targetPostMode);
  const destination = isInterCompanyDestinationAccount(entityKind, entityId, bankId);
  const legs: InterCompanyLedgerLeg[] = [];
  appendIcComTargetLeg(legs, icId, amt, useConduit);
  if (destination && entityId) {
    if (bankId) {
      legs.push({ kind: "bank", accountId: bankId, debit: amt, credit: amt });
    }
    const sideAmt = destinationLegAmount("target", entityKind, amt, postMode);
    legs.push({ kind: entityKind, accountId: entityId, debit: sideAmt.debit, credit: sideAmt.credit });
    return legs;
  }
  if (bankId) {
    if (postMode === "journal") {
      legs.push({ kind: "bank", accountId: bankId, debit: 0, credit: amt });
    } else {
      legs.push({ kind: "bank", accountId: bankId, debit: amt, credit: 0 });
    }
  }
  return legs;
}

/** Voucher doc se active legs — target unapproved vs approved. */
export function resolveInterCompanyLegsForVoucher(
  voucher: Record<string, unknown>
): InterCompanyLedgerLeg[] {
  const stored = voucher.interCompanyLegs;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored
      .map((row) => {
        const r = row as InterCompanyLedgerLeg;
        return {
          kind: r.kind,
          accountId: String(r.accountId || ""),
          debit: round2(Number(r.debit) || 0),
          credit: round2(Number(r.credit) || 0),
        };
      })
      .filter((r) => r.accountId && (r.debit > 0 || r.credit > 0));
  }
  return [];
}

/** Is side par destination account involve — clearing sirf rasta (approve par Dr+Cr). */
export function isInterCompanyOperationalEntityInvolved(
  voucher: Record<string, unknown>,
  side: "source" | "target"
): boolean {
  const clearing = readInterCompanyCompanyBankId(voucher);
  const inferred = inferInterCompanyEntity(voucher, side);
  if (inferred?.id) {
    return isInterCompanyDestinationAccount(inferred.kind, inferred.id, clearing);
  }
  const kindKey = side === "source" ? "sourceEntityKind" : "targetEntityKind";
  const idKey = side === "source" ? "sourceEntityId" : "targetEntityId";
  return isInterCompanyDestinationAccount(
    String(voucher[kindKey] || "").toLowerCase() as InterCompanyEntityKind,
    voucher[idKey],
    clearing
  );
}

/** Source/target role — link.role ya entity snapshot se infer. */
export function resolveInterCompanyViewerSide(
  voucher: Record<string, unknown> | null | undefined
): "source" | "target" | null {
  if (!voucher) return null;
  const side = interCompanyVoucherViewerSide(voucher);
  if (side === "source" || side === "target") return side;
  const role = readInterCompanyLink(voucher)?.role;
  if (role === "source" || role === "target") return role;
  if (isInterCompanyOperationalEntityInvolved(voucher, "source")) return "source";
  if (isInterCompanyOperationalEntityInvolved(voucher, "target")) return "target";
  return null;
}

function isInterCompanyVoucherApproved(voucher: Record<string, unknown>): boolean {
  return voucher?.isApproved === true;
}

/** Is side par party/staff/tax/expense (ya bank entity) involve — bank sirf rasta. */
export function resolveInterCompanyOperationalEntity(args: {
  side: "source" | "target";
  voucher: Record<string, unknown>;
}): { kind: InterCompanyEntityKind; id: string } | null {
  return inferInterCompanyEntity(args.voucher, args.side);
}

/** Bank-to-bank IC — koi operational entity nahi; bank par net Dr/Cr. */
export function isInterCompanyBankToBankOnly(voucher: Record<string, unknown>): boolean {
  const side = resolveInterCompanyViewerSide(voucher);
  if (side !== "source" && side !== "target") return true;
  return !isInterCompanyOperationalEntityInvolved(voucher, side);
}

/** Bank sirf ek side tab jab koi aur account (IC Company / entity) involve na ho. */
function isInterCompanyBankSingleSideOnly(
  voucher: Record<string, unknown>,
  side: "source" | "target"
): boolean {
  const bankId = readInterCompanyCompanyBankId(voucher);
  if (!bankId) return false;
  const icId = String(voucher.interCompanyCounterpartyPartyId || "").trim();
  if (icId && interCompanyUsesConduitParty(voucher)) return false;
  return !isInterCompanyOperationalEntityInvolved(voucher, side);
}

function resolveInterCompanyBankIdForLegs(voucher: Record<string, unknown>): string {
  return readInterCompanyCompanyBankId(voucher);
}

/** Ledger context + account id — is voucher leg se Dr/Cr. */
export function getInterCompanyLegAmounts(
  voucher: Record<string, unknown>,
  context: "party" | "account" | "staff" | "tax" | "expense",
  entityId: string
): IcLegAmountResult {
  const empty = finalizeIcLegAmounts(voucher, { touched: false, debit: 0, credit: 0 });
  if (String(voucher?.type || "") !== "inter_company") return empty;
  const id = String(entityId || "").trim();
  if (!id) return empty;

  const side = resolveInterCompanyViewerSide(voucher);
  const amt = round2(Number(voucher.amount ?? voucher.total) || 0);
  const bankOut = interCompanySourceBankOutflowAmount(voucher);
  const otherCharge = readInterCompanyOtherCharge(voucher);
  const icCounterpartyId = String(voucher.interCompanyCounterpartyPartyId || "").trim();
  const isIcComLedger = context === "party" && icCounterpartyId && id === icCounterpartyId;

  // Target: source approve se pehle ledger me amount mat dikhao
  if (side === "target" && !isInterCompanyVisibleOnTargetBank(voucher)) {
    return empty;
  }

  // Target entity legs — target approve ke baad; IC Com = source approve par
  // Peer Change Detected: applied posting mat hatao (sirf notification)
  if (
    side === "target" &&
    context !== "account" &&
    !isIcComLedger &&
    !isInterCompanyVisibleOnTargetEntity(voucher) &&
    !voucherHasInterCompanyPeerPending(voucher)
  ) {
    return empty;
  }

  const keepAppliedPostingDuringPeerPending = voucherHasInterCompanyPeerPending(voucher);

  const unapprovedPlaceholder = (): IcLegAmountResult =>
    finalizeIcLegAmounts(voucher, { touched: true, debit: 0, credit: 0 });

  if (!isInterCompanyVoucherApproved(voucher) && !keepAppliedPostingDuringPeerPending) {
    const bankId = resolveInterCompanyBankIdForLegs(voucher);
    if (context === "account" && bankId && id === bankId) {
      return unapprovedPlaceholder();
    }

    if (isIcComLedger && interCompanyUsesConduitParty(voucher)) {
      return unapprovedPlaceholder();
    }

    if (side) {
      const dest = inferInterCompanyEntity(voucher, side);
      if (dest) {
        const destCtx =
          dest.kind === "bank"
            ? "account"
            : dest.kind === "staff"
              ? "staff"
              : dest.kind === "tax"
                ? "tax"
                : dest.kind === "expense"
                  ? "expense"
                  : "party";
        if (destCtx === context && dest.id === id) {
          return unapprovedPlaceholder();
        }
      }
    }

    if (
      side === "source" &&
      otherCharge.amount > 0 &&
      otherCharge.accountId === id
    ) {
      const resolvedKind = resolveInterCompanyOtherChargeKindFromVoucher(voucher);
      let ocCtx: typeof context | null = null;
      if (resolvedKind === "party") ocCtx = "party";
      else if (resolvedKind === "staff") ocCtx = "staff";
      else if (resolvedKind === "expense") ocCtx = "expense";
      if (ocCtx === context) {
        return unapprovedPlaceholder();
      }
    }

    return empty;
  }

  // Approved (ya peer-pending notification) + destination exist: clearing pe hamesha Dr+Cr
  if (
    (isInterCompanyVoucherApproved(voucher) || keepAppliedPostingDuringPeerPending) &&
    context === "account" &&
    amt > 0 &&
    (side === "source" || side === "target")
  ) {
    const clearingId = resolveInterCompanyBankIdForLegs(voucher);
    if (clearingId && id === clearingId && isInterCompanyOperationalEntityInvolved(voucher, side)) {
      const legsClearing = resolveInterCompanyLegsForVoucher(voucher);
      let clearingDebit = 0;
      let clearingCredit = 0;
      for (const leg of legsClearing) {
        if (leg.kind !== "bank" || String(leg.accountId) !== clearingId) continue;
        clearingDebit += leg.debit;
        clearingCredit += leg.credit;
      }
      // Bypass / incomplete legs — display pe Dr+Cr dikhao
      if (!(clearingDebit > 0 && clearingCredit > 0)) {
        const clearingCreditAmt = side === "source" ? bankOut : amt;
        return finalizeIcLegAmounts(voucher, {
          touched: true,
          debit: amt,
          credit: clearingCreditAmt,
        });
      }
    }
  }

  // Approved bank — sirf jab koi aur account na ho; clearing (IC/entity) stored legs se Dr+Cr
  if (
    isInterCompanyVoucherApproved(voucher) &&
    context === "account" &&
    amt > 0 &&
    side &&
    isInterCompanyBankSingleSideOnly(voucher, side)
  ) {
    const bankId = resolveInterCompanyBankIdForLegs(voucher);
    if (bankId && id === bankId) {
      if (side === "target") {
        return finalizeIcLegAmounts(voucher, { touched: true, debit: amt, credit: 0 });
      }
      if (side === "source") {
        return finalizeIcLegAmounts(voucher, { touched: true, debit: 0, credit: bankOut });
      }
    }
  }

  // Destination Bank/Cash — one side only (clearing se alag id)
  if (context === "account" && amt > 0 && (side === "source" || side === "target")) {
    const clearingId = resolveInterCompanyBankIdForLegs(voucher);
    if (id && clearingId && id !== clearingId) {
      const dest = inferInterCompanyEntity(voucher, side);
      if (
        dest &&
        String(dest.id) === id &&
        String(dest.kind || "").toLowerCase() === "bank"
      ) {
        const postMode =
          side === "target"
            ? normalizeInterCompanyTargetPostMode(voucher.interCompanyTargetPostMode)
            : "payment_in";
        const sideAmt = destinationLegAmount(side, "bank", amt, postMode);
        return finalizeIcLegAmounts(voucher, {
          touched: true,
          debit: sideAmt.debit,
          credit: sideAmt.credit,
        });
      }
    }
  }

  const legs = resolveInterCompanyLegsForVoucher(voucher);
  let debit = 0;
  let credit = 0;
  for (const leg of legs) {
    const legCtx =
      leg.kind === "bank"
        ? "account"
        : leg.kind === "staff"
          ? "staff"
          : leg.kind === "tax"
            ? "tax"
            : leg.kind === "expense"
              ? "expense"
              : "party";
    if (legCtx !== context) continue;
    if (String(leg.accountId) !== id) continue;
    debit += leg.debit;
    credit += leg.credit;
  }
  if (debit <= 0 && credit <= 0) {
    if (
      isInterCompanyVoucherApproved(voucher) &&
      side === "source" &&
      otherCharge.amount > 0 &&
      otherCharge.accountId === id
    ) {
      const resolvedKind = resolveInterCompanyOtherChargeKindFromVoucher(voucher);
      const ocCtx =
        resolvedKind === "party"
          ? "party"
          : resolvedKind === "staff"
            ? "staff"
            : resolvedKind === "expense"
              ? "expense"
              : null;
      if (ocCtx === context) {
        return finalizeIcLegAmounts(voucher, {
          touched: true,
          debit: otherCharge.amount,
          credit: 0,
        });
      }
    }
    return empty;
  }
  return finalizeIcLegAmounts(voucher, {
    touched: true,
    debit: round2(debit),
    credit: round2(credit),
  });
}
