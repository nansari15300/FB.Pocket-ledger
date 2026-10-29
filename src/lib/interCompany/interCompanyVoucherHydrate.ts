/**
 * Saved inter_company voucher se form entity kind/id nikaalo (edit reopen).
 */
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { interCompanyUsesConduitParty } from "@/lib/interCompany/interCompanyPostingLegs";
import { isInterCompanyPeerPendingChange } from "@/lib/interCompany/interCompanyPeerPending";
import { normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";

const VALID_ENTITY_KINDS = new Set<InterCompanyEntityKind>([
  "party",
  "bank",
  "staff",
  "tax",
  "expense",
]);

function normalizeEntityKind(raw: unknown): InterCompanyEntityKind | null {
  const k = String(raw || "")
    .toLowerCase()
    .trim() as InterCompanyEntityKind;
  return VALID_ENTITY_KINDS.has(k) ? k : null;
}

export function readInterCompanyLink(voucher: Record<string, unknown> | null | undefined) {
  const link = voucher?.interCompanyLink as
    | { linkId?: string; peerCompanyId?: string; peerVoucherId?: string; role?: string }
    | undefined;
  if (!link?.peerCompanyId || !link?.peerVoucherId) return null;
  return {
    linkId: String(link.linkId || ""),
    peerCompanyId: String(link.peerCompanyId),
    peerVoucherId: String(link.peerVoucherId),
    role: link.role,
  };
}

function dedupeAttachmentUrls(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((u) => {
    const s = String(u || "").trim();
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

/**
 * IC edit box — pehle `interCompanyOwnFileUrls`; empty/missing ho to `fileUrls`
 * (txn row dikhe, form khaali na ho).
 */
export function readInterCompanyOwnFileUrls(
  voucher: Record<string, unknown> | null | undefined
): string[] {
  if (!voucher) return [];
  const own = normalizeFileUrlsField(voucher.interCompanyOwnFileUrls);
  if (own.length > 0) return dedupeAttachmentUrls(own);
  return dedupeAttachmentUrls(normalizeFileUrlsField(voucher.fileUrls));
}

/** Is voucher copy par logged-in company source (sent) ya target (received) — Payment / In label ke liye */
export function interCompanyVoucherViewerSide(
  voucher: Record<string, unknown> | null | undefined
): "source" | "target" | null {
  const role = readInterCompanyLink(voucher)?.role;
  return role === "source" || role === "target" ? role : null;
}

/**
 * IC global view-only lock — ab independent edit: hamesha false.
 * (Apni side form se editable; delete role-based local copy. Pehle: target / source-approved par lock.)
 */
export function isInterCompanyVoucherEditDeleteBlocked(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  void voucher;
  return false;
}

/** Payee fields se entity — is doc ka primary account (role ke hisaab se source ya target) */
function inferFromPayeeFields(voucher: Record<string, unknown>): { kind: InterCompanyEntityKind; id: string } | null {
  if (voucher.partyId) return { kind: "party", id: String(voucher.partyId) };
  if (voucher.accountId) return { kind: "bank", id: String(voucher.accountId) };
  if (voucher.staffId) return { kind: "staff", id: String(voucher.staffId) };
  if (voucher.taxAccountId) return { kind: "tax", id: String(voucher.taxAccountId) };
  if (voucher.expenseAccountId) return { kind: "expense", id: String(voucher.expenseAccountId) };
  return null;
}

export function inferInterCompanyEntity(
  voucher: Record<string, unknown>,
  side: "source" | "target"
): { kind: InterCompanyEntityKind; id: string } | null {
  const kindKey = side === "source" ? "sourceEntityKind" : "targetEntityKind";
  const idKey = side === "source" ? "sourceEntityId" : "targetEntityId";
  const kind = normalizeEntityKind(voucher[kindKey]);
  const id = String(voucher[idKey] || "").trim();
  if (kind && id) return { kind, id };

  const link = readInterCompanyLink(voucher);
  const payee = inferFromPayeeFields(voucher);
  if (!link?.role) return payee;

  // Linked doc: payee fields = is company ka apna account (source copy → source, target copy → target)
  if (link.role === "source" && side === "source") return payee;
  if (link.role === "target" && side === "target") return payee;

  return null;
}

/**
 * Edit par entity lists — source/target masters kis company se load hon.
 * Target company voucher kholne par source accounts peer company se aate hain.
 * Purane docs: `targetCompanyId` missing ho to source copy pe `link.peerCompanyId` use.
 */
export function resolveInterCompanyEditCompanyIds(
  voucher: Record<string, unknown> | null | undefined,
  currentCompanyId: string
): {
  sourceEntitiesCompanyId: string;
  targetEntitiesCompanyId: string;
  targetCompanyFieldId: string;
} {
  const row = voucher || {};
  const link = readInterCompanyLink(row);
  const currentId = String(currentCompanyId || "").trim();
  const storedTarget = String(row.targetCompanyId || "").trim();
  const peerId = String(link?.peerCompanyId || "").trim();

  if (link?.role === "target") {
    return {
      sourceEntitiesCompanyId: peerId || currentId,
      targetEntitiesCompanyId: currentId,
      targetCompanyFieldId: currentId,
    };
  }

  // Source copy (ya link missing) — target = denormalized id, warna peer
  const targetFieldId = storedTarget || (link?.role === "source" ? peerId : "") || "";
  return {
    sourceEntitiesCompanyId: currentId,
    targetEntitiesCompanyId: targetFieldId || currentId,
    targetCompanyFieldId: targetFieldId,
  };
}

/** Save par detail card ke liye label snapshot (edit par list miss ho to bhi naam dikhe) */
export function readInterCompanyEntityLabelSnapshot(
  voucher: Record<string, unknown> | null | undefined,
  side: "source" | "target"
): string {
  const key = side === "source" ? "sourceEntityLabel" : "targetEntityLabel";
  return String(voucher?.[key] || "").trim();
}

/** Saved voucher par company clearing bank — payee/destination bank se confuse mat karo. */
export function readInterCompanyCompanyBankId(voucher: Record<string, unknown> | null | undefined): string {
  if (!voucher) return "";
  const side = interCompanyVoucherViewerSide(voucher);
  if (side === "source") {
    const src = String(voucher.sourceCompanyBankAccountId || voucher.companyBankAccountId || "").trim();
    if (src) return src;
  }
  if (side === "target") {
    const tgt = String(voucher.targetCompanyBankAccountId || voucher.companyBankAccountId || "").trim();
    if (tgt) return tgt;
  }
  const direct = String(voucher.companyBankAccountId || "").trim();
  if (direct) return direct;

  // Legs: prefer clearing intermediary (Dr+Cr); destination bank one-side mat lo as clearing.
  const legs = voucher.interCompanyLegs;
  if (Array.isArray(legs)) {
    let firstBank = "";
    for (const raw of legs) {
      if (!raw || typeof raw !== "object") continue;
      const leg = raw as { kind?: string; accountId?: string; debit?: number; credit?: number };
      if (String(leg.kind || "").toLowerCase() !== "bank") continue;
      const id = String(leg.accountId || "").trim();
      if (!id) continue;
      if (!firstBank) firstBank = id;
      const d = Number(leg.debit) || 0;
      const c = Number(leg.credit) || 0;
      if (d > 0 && c > 0) return id;
    }
    // Destination bank payee — clearing ke liye use mat karo agar source/target entity bank hai
    const destId =
      side === "source"
        ? String(voucher.sourceEntityId || "").trim()
        : side === "target"
          ? String(voucher.targetEntityId || "").trim()
          : "";
    const destKind =
      side === "source"
        ? String(voucher.sourceEntityKind || "").toLowerCase()
        : side === "target"
          ? String(voucher.targetEntityKind || "").toLowerCase()
          : "";
    if (firstBank && !(destKind === "bank" && firstBank === destId)) return firstBank;
  }
  return "";
}

/** Edit form: dono companies ke bank ids — denormalized fields ya legacy `companyBankAccountId` */
export function resolveInterCompanyBankIdsForEdit(
  voucher: Record<string, unknown> | null | undefined
): { sourceCompanyBankAccountId: string; targetCompanyBankAccountId: string } {
  if (!voucher) return { sourceCompanyBankAccountId: "", targetCompanyBankAccountId: "" };
  const src = String(voucher.sourceCompanyBankAccountId || "").trim();
  const tgt = String(voucher.targetCompanyBankAccountId || "").trim();
  if (src || tgt) {
    return { sourceCompanyBankAccountId: src, targetCompanyBankAccountId: tgt };
  }
  const own = readInterCompanyCompanyBankId(voucher);
  const side = interCompanyVoucherViewerSide(voucher);
  if (side === "target") {
    return { sourceCompanyBankAccountId: "", targetCompanyBankAccountId: own };
  }
  return { sourceCompanyBankAccountId: own, targetCompanyBankAccountId: "" };
}

export function readInterCompanyBankLabelSnapshot(
  voucher: Record<string, unknown> | null | undefined,
  side: "source" | "target"
): string {
  const key = side === "source" ? "sourceCompanyBankLabel" : "targetCompanyBankLabel";
  return String(voucher?.[key] || "").trim();
}

/** Target copy par source company ne IC approve kar diya — target approve is se pehle block. */
export function isInterCompanySourceApprovedForTarget(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  if (!voucher || String(voucher.type || "") !== "inter_company") return true;
  if (interCompanyVoucherViewerSide(voucher) !== "target") return true;
  return voucher.interCompanySourceApproved === true;
}

/**
 * Target side — IC copy tab dikhe jab source ne approve kar diya ho.
 * Save-only (source unapproved): target par voucher / ledger / recent me mat dikhao.
 */
export function isInterCompanyVisibleOnTargetBank(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  if (!voucher || String(voucher.type || "") !== "inter_company") return true;
  if (interCompanyVoucherViewerSide(voucher) !== "target") return true;
  if (!readInterCompanyLink(voucher)?.peerVoucherId) return false;
  return isInterCompanySourceApprovedForTarget(voucher);
}

/** @deprecated — use isInterCompanyVisibleOnTargetBank */
export const isInterCompanyVisibleOnTargetCompany = isInterCompanyVisibleOnTargetBank;

/**
 * Target entity ledger — source approve ke baad row dikhe; Dr/Cr sirf jab target copy approve ho.
 */
export function isInterCompanyVisibleOnTargetEntity(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  if (!voucher || String(voucher.type || "") !== "inter_company") return true;
  if (interCompanyVoucherViewerSide(voucher) !== "target") return true;
  if (!isInterCompanySourceApprovedForTarget(voucher)) return false;
  return true;
}

/** Recent / Daybook — target IC sirf source approve ke baad */
export function shouldShowInterCompanyInDaybookOrRecent(
  voucher: Record<string, unknown> | null | undefined
): boolean {
  return isInterCompanyVisibleOnTargetBank(voucher);
}

/**
 * Unapproved pending badge — sirf jahan IC row ledger me dikhti hai (bank vs entity alag).
 */
export function collectInterCompanyIdsForPendingApproval(
  v: Record<string, unknown> | null | undefined,
  idSet: Set<string>,
  kind: InterCompanyEntityKind
): Set<string> {
  const out = new Set<string>();
  if (!v || String(v.type || "") !== "inter_company" || v.isApproved === true) return out;

  const add = (id: unknown) => {
    const s = String(id ?? "").trim();
    if (s && idSet.has(s)) out.add(s);
  };

  if (kind === "bank") {
    if (!isInterCompanyVisibleOnTargetBank(v)) return out;
    add(v.companyBankAccountId);
    return out;
  }

  if (!isInterCompanyVisibleOnTargetEntity(v)) return out;

  const sk = String(v.sourceEntityKind || "").toLowerCase();
  const tk = String(v.targetEntityKind || "").toLowerCase();
  if (sk === kind) add(v.sourceEntityId);
  if (tk === kind) add(v.targetEntityId);

  if (kind === "party") {
    add(v.partyId);
    if (interCompanyUsesConduitParty(v)) {
      add(v.interCompanyCounterpartyPartyId);
    }
  } else if (kind === "staff") {
    add(v.staffId);
  } else if (kind === "tax") {
    add(v.taxAccountId);
  } else if (kind === "expense") {
    add(v.expenseAccountId);
    const ocId = String(v.otherChargeAccountId || "").trim();
    const ocAmt = Number(v.otherChargeAmount || 0);
    const ocKind = String(v.otherChargeKind || "").trim();
    if (ocAmt > 0 && ocId && ocKind === "expense") add(ocId);
  } else if (kind === "bank") {
    add(v.accountId);
    add(v.companyBankAccountId);
  }

  return out;
}
