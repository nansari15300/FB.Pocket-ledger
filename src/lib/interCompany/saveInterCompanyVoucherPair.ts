/**
 * Inter Company — source + target company par linked `inter_company` vouchers save/update.
 */
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { collection, doc, query, where, Timestamp } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/firebase";
import {
  isRecurringAutoUserDisplayLabel,
  resolveHumanActorDisplayLabel,
  type InterCompanyCreateHistoryInput,
} from "@/lib/interCompany/interCompanyVoucherHistory";
import { ensureInterCompanyCounterpartyParty } from "@/lib/interCompany/ensureInterCompanyCounterpartyParty";
import {
  ensureInterCompanyMirroredEntity,
  isInterCompanyMirroredEntityKindSupported,
} from "@/lib/interCompany/ensureInterCompanyMirroredEntity";
import {
  buildInterCompanyJournalNarration,
  buildSourceInterCompanyLegs,
  buildSourceInterCompanyLegsApproved,
  buildTargetInterCompanyLegsApproved,
  buildTargetInterCompanyLegsPending,
  composeInterCompanyNarrationBase,
  extractInterCompanyUserNarration,
  normalizeInterCompanyTargetPostMode,
  resolveInterCompanyLegsForVoucher,
  type InterCompanyTargetPostMode,
} from "@/lib/interCompany/interCompanyPostingLegs";
import { getNextInterCompanyVoucherNumber } from "@/lib/interCompany/nextInterCompanyVoucherNumber";
import { fetchInterCompanyEntitiesForCompany } from "@/lib/interCompany/fetchInterCompanyEntities";
import {
  interCompanyOtherChargeKindToEntityKind,
  resolveInterCompanyOtherChargeKind,
} from "@/lib/interCompany/resolveInterCompanyOtherChargeKind";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const IC_PATCH_SQLITE_FIRST = { forceSqliteFirst: true as const };
import {
  purgeInterCompanyCounterpartyPartyIfUnused,
  reconcileUnusedInterCompanyCounterpartyParties,
} from "@/lib/interCompany/cleanupInterCompanyCounterpartyParty";
import { reconcileAndPatchInterCompanyAttachmentSharing } from "@/lib/interCompany/interCompanySharedAttachments";
import { readCompanyInterCompanyCode, ensureCompanyInterCompanyCode } from "@/lib/interCompany/interCompanyCompanyCode";
import {
  assertInterCompanyDeleteAllowed,
  assertInterCompanyPairEditDeleteAllowed,
} from "@/lib/interCompany/interCompanyEditLock";
import {
  approveVoucherWithHistory,
  patchVoucherFields,
  saveVoucher,
  softDeleteVoucherMoveToRecycleBin,
} from "@/lib/voucherActionsClient";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isFirebaseLedgerDataSyncEnabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyDataSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  canSyncCompanyToServer,
  enqueueVoucherOutbox,
  flushVoucherOutbox,
} from "@/lib/localVoucherOutbox";
import { dispatchVoucherLivePatch } from "@/lib/voucherFormAttachmentSave";
import { notifyBrowserDbCollectionUpdated } from "@/lib/localCompanyDocMirror";
import {
  isLocalToLocalInterCompanyPair,
  isPureLocalInterCompanyCompany,
} from "@/lib/interCompany/localInterCompanyPolicy";
import {
  buildInterCompanyPeerPendingProposed,
  mergeInterCompanyPeerPendingIntoValues,
  readInterCompanyPeerPending,
  type InterCompanyPeerPendingFieldKey,
  type InterCompanyPeerPendingProposed,
} from "@/lib/interCompany/interCompanyPeerPending";
import { coerceVoucherDocumentDate, mergeVoucherCalendarDateWithSaveClock } from "@/lib/voucherDateNormalize";

export type InterCompanyLinkDoc = {
  linkId: string;
  role: "source" | "target";
  peerCompanyId: string;
  peerVoucherId: string;
};

export type SaveInterCompanyPairInput = {
  sourceCompanyId: string;
  targetCompanyId: string;
  userId: string;
  approverName?: string;
  voucherNumber: string;
  date: Date;
  amount: number;
  narration?: string;
  sourceEntityKind: InterCompanyEntityKind;
  sourceEntityId: string;
  targetEntityKind: InterCompanyEntityKind;
  targetEntityId: string;
  /** Source-only — Payment style other charge (not synced to target). */
  otherChargeAccountId?: string;
  otherChargeAmount?: number;
  otherChargeKind?: InterCompanyEntityKind | null;
  /** Source company — payment nikalne wala bank/cash */
  sourceCompanyBankAccountId: string;
  /** Target company — receive hone wala bank/cash (approve par ledger) */
  targetCompanyBankAccountId: string;
  /** Edit hydrate — bank account display naam */
  sourceCompanyBankLabel?: string;
  targetCompanyBankLabel?: string;
  /** Edit/detail card — entity naam snapshot */
  sourceEntityLabel?: string;
  targetEntityLabel?: string;
  /** History + voucher snapshot — From / To company rows */
  sourceCompanyName?: string;
  targetCompanyName?: string;
  existingSourceVoucherId?: string | null;
  existingTargetVoucherId?: string | null;
  existingLinkId?: string | null;
  approveSourceAfterSave?: boolean;
  /** Source voucher — apni taraf ki attachments (own; target box alag) */
  sourceFileUrls?: string[];
  /** Target voucher — apni taraf ki attachments (own; source box alag) */
  targetFileUrls?: string[];
  /** Save/upload ke waqt in-memory blobs — peer copy ke liye dubara read na karna pade */
  sourceAttachmentBlobByRef?: ReadonlyMap<string, Blob>;
  targetAttachmentBlobByRef?: ReadonlyMap<string, Blob>;
  /** ON = source ki attachments bhi target copy par dikhengi */
  shareSourceAttachmentsWithPeer?: boolean;
  /** ON = target ki attachments bhi source copy par dikhengi */
  shareTargetAttachmentsWithSource?: boolean;
  /**
   * Target destination posting:
   * - payment_in (default) — target account Payment In jaisa
   * - journal — target account pe Dr/Cr ulta; company-to-company conduit same
   */
  targetPostMode?: InterCompanyTargetPostMode;
  /**
   * Kaunsi company se user save kar raha hai.
   * Pair pehle se exist kare to peer par fields auto-apply nahi — `interCompanyPeerPending` stamp.
   */
  editingSide?: "source" | "target";
  /** Target/source Change Detected — selected pending fields is save par apply */
  applyPeerPendingFieldKeys?: InterCompanyPeerPendingFieldKey[];
  /** Connect user typed source account (no master list permission) */
  interCompanySuggestedSourceAccountLabel?: string;
  interCompanySourceAccountRestricted?: boolean;
};

export type SaveInterCompanyPairResult = {
  sourceId: string;
  targetId: string;
  linkId: string;
  /** Voucher save OK; sirf target par apni copy attach nahi hui */
  attachmentReplicationWarning?: string;
};

function entityPayeeFields(kind: InterCompanyEntityKind, entityId: string): Record<string, string> {
  const id = String(entityId || "").trim();
  if (!id) return {};
  switch (kind) {
    case "party":
      return { partyId: entityId, payeeType: "party" };
    case "bank":
      return { accountId: entityId };
    case "staff":
      return { staffId: entityId, payeeType: "staff" };
    case "tax":
      return { taxAccountId: entityId };
    case "expense":
      return { expenseAccountId: entityId };
    default:
      return {};
  }
}

function mergeNarration(user: string | undefined, suffix: string): string {
  const base = String(user || "").trim();
  if (!base) return suffix;
  if (base.includes(suffix)) return base;
  return `${base}\n${suffix}`;
}

function newLinkId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `ic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Peer pending stamp ke baad ledger/UI turant — bina page refresh. */
function notifyInterCompanyPeerDocLive(
  companyId: string,
  voucherId: string,
  patch: Record<string, unknown>
): void {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return;
  dispatchVoucherLivePatch(cid, vid, { ...patch, id: vid });
  try {
    notifyBrowserDbCollectionUpdated(cid, "vouchers", {
      immediate: true,
      source: "local_write",
    });
  } catch {
    /* optional */
  }
}

function buildVoucherPayload(args: {
  voucherNumber: string;
  dateIso: string;
  amount: number;
  narration: string;
  targetCompanyId: string;
  sourceEntityKind: InterCompanyEntityKind;
  sourceEntityId: string;
  targetEntityKind: InterCompanyEntityKind;
  targetEntityId: string;
  sourceEntityLabel?: string;
  targetEntityLabel?: string;
  sourceCompanyName?: string;
  targetCompanyName?: string;
  link: InterCompanyLinkDoc;
  entityKind: InterCompanyEntityKind;
  entityId: string;
  /** Is doc ki apni attachments (own side) — peer se share hui copies baad me merge hoti hain */
  ownFileUrls: string[];
  companyBankAccountId: string;
  interCompanyCounterpartyPartyId: string;
  interCompanyLegs: ReturnType<typeof buildSourceInterCompanyLegs>;
  /** Dono copies par — edit par peer fetch ke bina bank hydrate */
  sourceCompanyBankAccountId?: string;
  targetCompanyBankAccountId?: string;
  sourceCompanyBankLabel?: string;
  targetCompanyBankLabel?: string;
  shareSourceAttachmentsWithPeer?: boolean;
  shareTargetAttachmentsWithSource?: boolean;
  targetPostMode?: InterCompanyTargetPostMode;
  otherChargeAccountId?: string;
  otherChargeAmount?: number;
  otherChargeKind?: InterCompanyEntityKind | null;
  interCompanySuggestedSourceAccountLabel?: string;
  interCompanySourceAccountRestricted?: boolean;
  interCompanyResolvedSourceEntityKind?: string;
  interCompanyResolvedSourceEntityId?: string;
  interCompanyResolvedSourceEntityLabel?: string;
}): Record<string, unknown> {
  const otherAmt = round2(Number(args.otherChargeAmount) || 0);
  const otherAccountId = String(args.otherChargeAccountId || "").trim();
  const transferAmt = round2(Number(args.amount) || 0);
  const docTotal = round2(transferAmt + (otherAmt > 0 && otherAccountId ? otherAmt : 0));
  const otherChargeKind =
    args.otherChargeKind === "party" ||
    args.otherChargeKind === "staff" ||
    args.otherChargeKind === "expense"
      ? args.otherChargeKind
      : null;
  return {
    type: "inter_company",
    voucherNumber: args.voucherNumber,
    date: args.dateIso,
    amount: transferAmt,
    total: docTotal,
    narration: args.narration,
    fileUrls: args.ownFileUrls,
    interCompanyOwnFileUrls: args.ownFileUrls,
    interCompanyShareAttachmentsWithPeer: args.shareSourceAttachmentsWithPeer === true,
    interCompanySharePeerAttachmentsToSource: args.shareTargetAttachmentsWithSource === true,
    interCompanyTargetPostMode: normalizeInterCompanyTargetPostMode(args.targetPostMode),
    allocations: [],
    linkedPaymentInIds: [],
    targetCompanyId: args.targetCompanyId,
    sourceEntityKind: args.sourceEntityKind,
    sourceEntityId: args.sourceEntityId,
    targetEntityKind: args.targetEntityKind,
    targetEntityId: args.targetEntityId,
    sourceEntityLabel: args.sourceEntityLabel || "",
    targetEntityLabel: args.targetEntityLabel || "",
    sourceCompanyName: args.sourceCompanyName || "",
    targetCompanyName: args.targetCompanyName || "",
    interCompanyLink: args.link,
    companyBankAccountId: args.companyBankAccountId,
    sourceCompanyBankAccountId: String(args.sourceCompanyBankAccountId || "").trim() || null,
    targetCompanyBankAccountId: String(args.targetCompanyBankAccountId || "").trim() || null,
    sourceCompanyBankLabel: args.sourceCompanyBankLabel || null,
    targetCompanyBankLabel: args.targetCompanyBankLabel || null,
    interCompanyCounterpartyPartyId: args.interCompanyCounterpartyPartyId || null,
    interCompanyLegs: args.interCompanyLegs,
    ...(otherAmt > 0 && otherAccountId
      ? {
          otherChargeAccountId: otherAccountId,
          otherChargeAmount: otherAmt,
          ...(otherChargeKind ? { otherChargeKind } : {}),
        }
      : {}),
    ...(args.interCompanySuggestedSourceAccountLabel
      ? { interCompanySuggestedSourceAccountLabel: args.interCompanySuggestedSourceAccountLabel }
      : {}),
    ...(args.interCompanySourceAccountRestricted
      ? { interCompanySourceAccountRestricted: true }
      : {}),
    ...(args.interCompanyResolvedSourceEntityId
      ? {
          interCompanyResolvedSourceEntityKind: args.interCompanyResolvedSourceEntityKind || null,
          interCompanyResolvedSourceEntityId: args.interCompanyResolvedSourceEntityId,
          interCompanyResolvedSourceEntityLabel: args.interCompanyResolvedSourceEntityLabel || null,
        }
      : {}),
    ...entityPayeeFields(args.entityKind, args.entityId),
  };
}

/** Dono companies par linked pair create / update. */
async function readCompanyDoc(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  try {
    const local = await getLocalCompanyById(cid, { includeDeleted: true });
    if (local) return local as unknown as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  if (await isPureLocalInterCompanyCompany(cid)) return null;
  try {
    const snap = await getDoc(doc(firestore, "companies", cid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readInterCompanyVoucherRow(
  companyId: string,
  voucherId: string
): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return null;
  const local = await getCompanyDocFromBrowserDb(cid, "vouchers", vid);
  if (local) return local as Record<string, unknown>;
  if (await isPureLocalInterCompanyCompany(cid)) return null;
  try {
    const snap = await getDoc(doc(firestore, `companies/${cid}/vouchers`, vid));
    return snap.exists()
      ? ({ id: snap.id, ...(snap.data() as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Inter Company save: asli user naam — "Auto" sirf recurring ke liye; Firestore users doc prefer. */
async function resolveInterCompanyActorForSave(
  userId: string,
  candidateName?: string | null
): Promise<{ displayName: string; email: string | null; phone: string | null }> {
  const authUser = auth.currentUser;
  let email = authUser?.email?.trim() || null;
  let firestoreName: string | null = null;
  let phone: string | null = authUser?.phoneNumber?.trim() || null;

  try {
    const q = query(collection(firestore, "users"), where("uid", "==", userId));
    const snap = await getDocs(q);
    const data = snap.docs[0]?.data() as {
      displayName?: string;
      name?: string;
      email?: string;
      phone?: string;
      mobile?: string;
    } | undefined;
    if (data) {
      const dn = String(data.displayName || data.name || "").trim();
      if (dn && !isRecurringAutoUserDisplayLabel(dn)) firestoreName = dn;
      const em = String(data.email || "").trim();
      if (em) email = em;
      const p = String(data.phone || data.mobile || "").trim();
      if (p) phone = p;
    }
  } catch {
    /* offline */
  }

  const displayName = resolveHumanActorDisplayLabel({
    candidate: firestoreName || candidateName || authUser?.displayName,
    email,
    userId,
  });

  return { displayName, email, phone };
}

/** Create history "Phone" row — Firestore user doc ya Firebase Auth phone. */
async function resolveCreatorPhoneForHistory(userId: string): Promise<string | null> {
  const authPhone = auth.currentUser?.phoneNumber?.trim();
  if (authPhone) return authPhone;
  try {
    const q = query(collection(firestore, "users"), where("uid", "==", userId));
    const snap = await getDocs(q);
    const data = snap.docs[0]?.data() as { phone?: string; mobile?: string } | undefined;
    const p = String(data?.phone || data?.mobile || "").trim();
    return p || null;
  } catch {
    return null;
  }
}

function interCompanyCreateHistoryInput(
  input: SaveInterCompanyPairInput,
  actor: { displayName: string; email: string | null; phone: string | null },
  createdAt: Date
): InterCompanyCreateHistoryInput {
  return {
    addedByUserName: actor.displayName,
    userEmail: actor.email,
    userPhone: actor.phone,
    voucherDate: input.date,
    createdAt,
    fromCompanyName: input.sourceCompanyName || "",
    toCompanyName: input.targetCompanyName || "",
  };
}

export async function saveInterCompanyVoucherPair(
  input: SaveInterCompanyPairInput
): Promise<SaveInterCompanyPairResult> {
  // Source approve ke baad / target copy se update — server par band (UI bypass guard)
  if (input.existingSourceVoucherId) {
    await assertInterCompanyPairEditDeleteAllowed(
      input.sourceCompanyId,
      input.existingSourceVoucherId
    );
  }

  const linkId = input.existingLinkId || newLinkId();
  const isCreate = !input.existingSourceVoucherId;
  const dateForSave = isCreate
    ? mergeVoucherCalendarDateWithSaveClock(input.date)
    : input.date;
  let dateIso = dateForSave.toISOString();
  let amount = Number(input.amount) || 0;
  const sourceOwnFileUrls = input.sourceFileUrls ?? [];
  const targetOwnFileUrls = input.targetFileUrls ?? [];
  const shareSourceAttachmentsWithPeer = input.shareSourceAttachmentsWithPeer === true;
  const shareTargetAttachmentsWithSource = input.shareTargetAttachmentsWithSource === true;
  const editingSide = input.editingSide === "target" ? "target" : "source";
  const applyPeerKeys = (input.applyPeerPendingFieldKeys || []).filter(Boolean);

  // Har company ka apna inter_company serial — create par alag number; update par purana rakho
  const [sourceCompanyDoc, targetCompanyDoc] = await Promise.all([
    readCompanyDoc(input.sourceCompanyId),
    readCompanyDoc(input.targetCompanyId),
  ]);

  let sourceVoucherNumber = String(input.voucherNumber || "").trim();
  let targetVoucherNumber = sourceVoucherNumber;
  let existingSourceApproved = false;
  let existingTargetApproved = false;

  // Stale / missing peer id → create a fresh target copy (Data Entry / failed peer leave orphan source).
  let resolvedExistingTargetVoucherId = String(input.existingTargetVoucherId || "").trim() || null;
  let existingSourceRow: Record<string, unknown> | null = null;
  let existingTargetRow: Record<string, unknown> | null = null;

  if (input.existingSourceVoucherId) {
    const existing = await readInterCompanyVoucherRow(
      input.sourceCompanyId,
      input.existingSourceVoucherId
    );
    if (existing) {
      existingSourceRow = existing;
      sourceVoucherNumber = String(existing.voucherNumber || sourceVoucherNumber);
      existingSourceApproved = existing.isApproved === true;
      if (!resolvedExistingTargetVoucherId) {
        const linkedPeer = String(
          (existing.interCompanyLink as { peerVoucherId?: string } | undefined)?.peerVoucherId || ""
        ).trim();
        if (linkedPeer) resolvedExistingTargetVoucherId = linkedPeer;
      }
    }
    if (resolvedExistingTargetVoucherId) {
      const existingTarget = await readInterCompanyVoucherRow(
        input.targetCompanyId,
        resolvedExistingTargetVoucherId
      );
      if (existingTarget) {
        existingTargetRow = existingTarget;
        targetVoucherNumber = String(existingTarget.voucherNumber || targetVoucherNumber);
        existingTargetApproved = existingTarget.isApproved === true;
      } else {
        // Peer id pointed at a missing voucher — recreate on target.
        resolvedExistingTargetVoucherId = null;
        targetVoucherNumber = await getNextInterCompanyVoucherNumber(
          input.targetCompanyId,
          targetCompanyDoc
        );
      }
    } else {
      // Orphan source (peer never written) — mint target number on heal save.
      targetVoucherNumber = await getNextInterCompanyVoucherNumber(
        input.targetCompanyId,
        targetCompanyDoc
      );
    }
  } else {
    sourceVoucherNumber = await getNextInterCompanyVoucherNumber(input.sourceCompanyId, sourceCompanyDoc);
    targetVoucherNumber = await getNextInterCompanyVoucherNumber(input.targetCompanyId, targetCompanyDoc);
  }

  const sourceSuffix = `[Inter-company to ${input.targetCompanyName || "company"} · Ref ${targetVoucherNumber}]`;
  const targetSuffix = `[Inter-company from ${input.sourceCompanyName || "company"} · Ref ${sourceVoucherNumber}]`;

  const ownerId =
    String(sourceCompanyDoc?.ownerId || targetCompanyDoc?.ownerId || input.userId || "").trim() ||
    input.userId;

  const targetEntityId = String(input.targetEntityId || "").trim();
  // Har IC pair — com-to-com balance ke liye IC · Due from/to party (bank-to-bank par bhi).
  const useIcConduit = true;

  // Source ek baar approve ke baad — source account / clearing kabhi move mat karo (txn hatna band).
  let lockedSourceEntityKind = input.sourceEntityKind;
  let lockedSourceEntityId = String(input.sourceEntityId || "").trim();
  let lockedSourceBankId = String(input.sourceCompanyBankAccountId || "").trim();
  let lockedSourceEntityLabel = String(input.sourceEntityLabel || "").trim();
  let lockedSourceBankLabel = String(input.sourceCompanyBankLabel || "").trim();
  const sourceAccountRestricted = input.interCompanySourceAccountRestricted === true;
  const suggestedSourceAccountLabel = String(input.interCompanySuggestedSourceAccountLabel || "").trim();
  if (sourceAccountRestricted && suggestedSourceAccountLabel && !lockedSourceEntityId) {
    lockedSourceEntityLabel = suggestedSourceAccountLabel;
  }
  if (existingSourceApproved && existingSourceRow) {
    const sk = String(existingSourceRow.sourceEntityKind || "").trim() as InterCompanyEntityKind;
    const sid = String(existingSourceRow.sourceEntityId || "").trim();
    const sBank = String(
      existingSourceRow.sourceCompanyBankAccountId || existingSourceRow.companyBankAccountId || ""
    ).trim();
    if (sk && sid) {
      lockedSourceEntityKind = sk;
      lockedSourceEntityId = sid;
    }
    if (sBank) lockedSourceBankId = sBank;
    const sLabel = String(existingSourceRow.sourceEntityLabel || "").trim();
    if (sLabel) lockedSourceEntityLabel = sLabel;
    const sBankLabel = String(existingSourceRow.sourceCompanyBankLabel || "").trim();
    if (sBankLabel) lockedSourceBankLabel = sBankLabel;
  }
  const sourceEntityId = lockedSourceEntityId;

  // Optional entity mirror — peer masters; save block na kare (background).
  void Promise.all([
    readCompanyInterCompanyCode(sourceCompanyDoc as { interCompanyCompanyCode?: string } | null) ||
      ensureCompanyInterCompanyCode(input.sourceCompanyId, input.sourceCompanyName),
    readCompanyInterCompanyCode(targetCompanyDoc as { interCompanyCompanyCode?: string } | null) ||
      ensureCompanyInterCompanyCode(input.targetCompanyId, input.targetCompanyName),
  ])
    .then(async ([sourceCode, targetCode]) => {
      await Promise.all([
        isInterCompanyMirroredEntityKindSupported(lockedSourceEntityKind) && sourceEntityId
          ? ensureInterCompanyMirroredEntity({
              peerCompanyId: input.targetCompanyId,
              originCompanyId: input.sourceCompanyId,
              originCompanyCode: sourceCode,
              originEntityId: sourceEntityId,
              entityKind: lockedSourceEntityKind,
              entityFullName: lockedSourceEntityLabel || "",
              ownerId,
            })
          : Promise.resolve(null),
        isInterCompanyMirroredEntityKindSupported(input.targetEntityKind) && targetEntityId
          ? ensureInterCompanyMirroredEntity({
              peerCompanyId: input.sourceCompanyId,
              originCompanyId: input.targetCompanyId,
              originCompanyCode: targetCode,
              originEntityId: targetEntityId,
              entityKind: input.targetEntityKind,
              entityFullName: input.targetEntityLabel || "",
              ownerId,
            })
          : Promise.resolve(null),
      ]);
    })
    .catch((err) => {
      console.warn("[IC] optional entity mirror sync:", err);
    });

  const targetPostModeBase = normalizeInterCompanyTargetPostMode(input.targetPostMode);
  let workTargetEntityKind = input.targetEntityKind;
  let workTargetEntityId = String(input.targetEntityId || "").trim();
  let workTargetEntityLabel = String(input.targetEntityLabel || "").trim();
  let workTargetBankId = String(input.targetCompanyBankAccountId || "").trim();
  let workTargetBankLabel = String(input.targetCompanyBankLabel || "").trim();
  let workNarrationInput = input.narration;
  let workTargetPostMode = targetPostModeBase;
  let appliedPeerPendingKeys: InterCompanyPeerPendingFieldKey[] = [];
  let peerPendingRemainOnOwnSide: InterCompanyPeerPendingProposed | null | undefined;

  // Change Detected apply — pending fields is company ki copy pe merge; baaki pending rehne do
  if (applyPeerKeys.length > 0) {
    const ownRow = editingSide === "target" ? existingTargetRow : existingSourceRow;
    const pending = readInterCompanyPeerPending(ownRow);
    if (pending) {
      const merged = mergeInterCompanyPeerPendingIntoValues({
        base: {
          amount,
          dateIso,
          narration: String(workNarrationInput || ""),
          sourceEntityKind: lockedSourceEntityKind,
          sourceEntityId: lockedSourceEntityId,
          sourceEntityLabel: lockedSourceEntityLabel,
          targetEntityKind: workTargetEntityKind,
          targetEntityId: workTargetEntityId,
          targetEntityLabel: workTargetEntityLabel,
          sourceCompanyBankAccountId: lockedSourceBankId,
          sourceCompanyBankLabel: lockedSourceBankLabel,
          targetCompanyBankAccountId: workTargetBankId,
          targetCompanyBankLabel: workTargetBankLabel,
          targetPostMode: workTargetPostMode,
        },
        pending,
        applyKeys: applyPeerKeys,
      });
      amount = merged.amount;
      dateIso = merged.dateIso;
      workNarrationInput = merged.narration;
      if (!existingSourceApproved || editingSide === "source") {
        lockedSourceEntityKind = merged.sourceEntityKind;
        lockedSourceEntityId = merged.sourceEntityId;
        lockedSourceEntityLabel = String(merged.sourceEntityLabel || lockedSourceEntityLabel);
        lockedSourceBankId = merged.sourceCompanyBankAccountId;
        lockedSourceBankLabel = String(merged.sourceCompanyBankLabel || lockedSourceBankLabel);
      }
      workTargetEntityKind = merged.targetEntityKind;
      workTargetEntityId = merged.targetEntityId;
      workTargetEntityLabel = String(merged.targetEntityLabel || workTargetEntityLabel);
      workTargetBankId = merged.targetCompanyBankAccountId;
      workTargetBankLabel = String(merged.targetCompanyBankLabel || workTargetBankLabel);
      workTargetPostMode = merged.targetPostMode;
      appliedPeerPendingKeys = applyPeerKeys;
      // Apply Selected → poora Change Detected clear (partial remain mat rakho)
      peerPendingRemainOnOwnSide = null;
    }
  }

  const targetPostMode = workTargetPostMode;
  /** journal = Company→Company; payment_in = Account→Account. Dono IC Account naam + company niche. */
  const clearingMode = targetPostMode === "journal" ? "company" : "account";

  const [sourceIcPartyId, targetIcPartyId] = await Promise.all([
    ensureInterCompanyCounterpartyParty({
      companyId: input.sourceCompanyId,
      peerCompanyId: input.targetCompanyId,
      peerCompanyName: input.targetCompanyName || "Company",
      side: "source",
      ownerId,
      clearingMode,
      // Source books: peer = target company entity
      peerEntityKind: workTargetEntityKind,
      peerEntityId: workTargetEntityId,
      peerEntityLabel: workTargetEntityLabel,
    }),
    ensureInterCompanyCounterpartyParty({
      companyId: input.targetCompanyId,
      peerCompanyId: input.sourceCompanyId,
      peerCompanyName: input.sourceCompanyName || "Company",
      side: "target",
      ownerId,
      clearingMode,
      // Target books: peer = source company entity
      peerEntityKind: lockedSourceEntityKind,
      peerEntityId: lockedSourceEntityId,
      peerEntityLabel: lockedSourceEntityLabel,
    }),
  ]);

  let resolvedOtherChargeAccountId = String(input.otherChargeAccountId || "").trim();
  let resolvedOtherChargeAmount = round2(Number(input.otherChargeAmount) || 0);
  let resolvedOtherChargeKind: InterCompanyEntityKind | null =
    input.otherChargeKind === "party" ||
    input.otherChargeKind === "staff" ||
    input.otherChargeKind === "expense"
      ? input.otherChargeKind
      : null;

  if (editingSide === "target" && existingSourceRow) {
    resolvedOtherChargeAccountId = String(existingSourceRow.otherChargeAccountId || "").trim();
    resolvedOtherChargeAmount = round2(Number(existingSourceRow.otherChargeAmount) || 0);
    const storedKind = String(existingSourceRow.otherChargeKind || "").trim() as InterCompanyEntityKind;
    if (storedKind === "party" || storedKind === "staff" || storedKind === "expense") {
      resolvedOtherChargeKind = storedKind;
    } else if (resolvedOtherChargeAccountId && resolvedOtherChargeAmount > 0) {
      const leg = resolveInterCompanyLegsForVoucher(existingSourceRow).find(
        (row) =>
          String(row.accountId) === resolvedOtherChargeAccountId &&
          row.debit > 0 &&
          (row.kind === "party" || row.kind === "staff" || row.kind === "expense")
      );
      if (leg) resolvedOtherChargeKind = leg.kind;
    }
  } else if (resolvedOtherChargeAmount <= 0 || !resolvedOtherChargeAccountId) {
    resolvedOtherChargeAccountId = "";
    resolvedOtherChargeAmount = 0;
    resolvedOtherChargeKind = null;
  }

  if (
    resolvedOtherChargeAccountId &&
    resolvedOtherChargeAmount > 0 &&
    !resolvedOtherChargeKind
  ) {
    const masters = await fetchInterCompanyEntitiesForCompany(input.sourceCompanyId);
    resolvedOtherChargeKind = interCompanyOtherChargeKindToEntityKind(
      resolveInterCompanyOtherChargeKind({
        accountId: resolvedOtherChargeAccountId,
        entities: masters,
        storedKind: input.otherChargeKind,
      })
    );
  }

  const sourceLegs = existingSourceApproved
    ? buildSourceInterCompanyLegsApproved({
        amount,
        entityKind: lockedSourceEntityKind,
        entityId: lockedSourceEntityId,
        companyBankAccountId: lockedSourceBankId,
        interCompanyCounterpartyPartyId: sourceIcPartyId,
        useIcConduit,
        otherChargeAccountId: resolvedOtherChargeAccountId,
        otherChargeAmount: resolvedOtherChargeAmount,
        otherChargeKind: resolvedOtherChargeKind,
      })
    : buildSourceInterCompanyLegs({
        amount,
        entityKind: lockedSourceEntityKind,
        entityId: lockedSourceEntityId,
        companyBankAccountId: lockedSourceBankId,
        interCompanyCounterpartyPartyId: sourceIcPartyId,
        useIcConduit,
        otherChargeAccountId: resolvedOtherChargeAccountId,
        otherChargeAmount: resolvedOtherChargeAmount,
        otherChargeKind: resolvedOtherChargeKind,
      });

  const targetLegs = existingTargetApproved
    ? buildTargetInterCompanyLegsApproved({
        amount,
        entityKind: workTargetEntityKind,
        entityId: workTargetEntityId,
        companyBankAccountId: workTargetBankId,
        interCompanyCounterpartyPartyId: targetIcPartyId,
        useIcConduit,
        targetPostMode,
      })
    : buildTargetInterCompanyLegsPending({
        amount,
        entityKind: workTargetEntityKind,
        entityId: workTargetEntityId,
        companyBankAccountId: workTargetBankId,
        interCompanyCounterpartyPartyId: targetIcPartyId,
        useIcConduit,
      });

  const autoNarration = buildInterCompanyJournalNarration({
    sourceCompanyName: input.sourceCompanyName,
    sourceEntityLabel: lockedSourceEntityLabel || input.sourceEntityLabel,
    targetCompanyName: input.targetCompanyName,
    targetEntityLabel: workTargetEntityLabel || input.targetEntityLabel,
    voucherNumber: sourceVoucherNumber,
  });
  // Auto must + user typed text rakho; blank user → sirf auto
  const userExtra = extractInterCompanyUserNarration(workNarrationInput, autoNarration);
  const userNarrationBase = composeInterCompanyNarrationBase(autoNarration, userExtra);
  const sourceNarration = mergeNarration(userNarrationBase, sourceSuffix);
  const targetNarration = mergeNarration(userNarrationBase, targetSuffix);

  const sourceLink: InterCompanyLinkDoc = {
    linkId,
    role: "source",
    peerCompanyId: input.targetCompanyId,
    peerVoucherId: resolvedExistingTargetVoucherId || "",
  };

  const localPair = await isLocalToLocalInterCompanyPair(
    input.sourceCompanyId,
    input.targetCompanyId
  );
  const historyCreatedAt = new Date();
  // Create history + human userDisplayName — dono companies par (target par alag approval).
  const icHistoryOpts = isCreate
    ? await (async () => {
        const actor = localPair
          ? {
              displayName: resolveHumanActorDisplayLabel({
                candidate: input.approverName || auth.currentUser?.displayName,
                email: auth.currentUser?.email,
                userId: input.userId,
              }),
              email: auth.currentUser?.email?.trim() || null,
              phone: auth.currentUser?.phoneNumber?.trim() || null,
            }
          : await resolveInterCompanyActorForSave(input.userId, input.approverName);
        const phone =
          actor.phone ?? (localPair ? null : await resolveCreatorPhoneForHistory(input.userId));
        return {
          interCompanyCreateHistory: interCompanyCreateHistoryInput(
            input,
            { ...actor, phone },
            historyCreatedAt
          ),
          // Voucher doc + ledger User column: "Auto" mat — sirf recurring auto-create me
          userDisplayNameOverride: actor.displayName,
          // IC: owner auto-approve band — source Save = unapproved; Save & Approve = baad mein approve
          forceUnapprovedCreate: true,
        };
      })()
    : undefined;

  const sourcePayload = buildVoucherPayload({
    voucherNumber: sourceVoucherNumber,
    dateIso,
    amount,
    narration: sourceNarration,
    targetCompanyId: input.targetCompanyId,
    sourceEntityKind: lockedSourceEntityKind,
    sourceEntityId: lockedSourceEntityId,
    targetEntityKind: workTargetEntityKind,
    targetEntityId: workTargetEntityId,
    sourceEntityLabel: lockedSourceEntityLabel,
    targetEntityLabel: workTargetEntityLabel,
    sourceCompanyName: input.sourceCompanyName,
    targetCompanyName: input.targetCompanyName,
    link: sourceLink,
    entityKind: lockedSourceEntityKind,
    entityId: lockedSourceEntityId,
    ownFileUrls: sourceOwnFileUrls,
    companyBankAccountId: lockedSourceBankId,
    sourceCompanyBankAccountId: lockedSourceBankId,
    targetCompanyBankAccountId: workTargetBankId,
    sourceCompanyBankLabel: lockedSourceBankLabel,
    targetCompanyBankLabel: workTargetBankLabel,
    interCompanyCounterpartyPartyId: sourceIcPartyId,
    interCompanyLegs: sourceLegs,
    shareSourceAttachmentsWithPeer,
    shareTargetAttachmentsWithSource,
    targetPostMode,
    otherChargeAccountId: resolvedOtherChargeAccountId,
    otherChargeAmount: resolvedOtherChargeAmount,
    otherChargeKind: resolvedOtherChargeKind,
    interCompanySuggestedSourceAccountLabel: suggestedSourceAccountLabel || undefined,
    interCompanySourceAccountRestricted: sourceAccountRestricted || undefined,
  });

  const targetLink: InterCompanyLinkDoc = {
    linkId,
    role: "target",
    peerCompanyId: input.sourceCompanyId,
    peerVoucherId: input.existingSourceVoucherId || "",
  };

  const sourceApprovedForTargetVisibility =
    existingSourceApproved || input.approveSourceAfterSave === true;

  const targetPayloadBase = buildVoucherPayload({
    voucherNumber: targetVoucherNumber,
    dateIso,
    amount,
    narration: targetNarration,
    targetCompanyId: input.targetCompanyId,
    sourceEntityKind: lockedSourceEntityKind,
    sourceEntityId: lockedSourceEntityId,
    targetEntityKind: workTargetEntityKind,
    targetEntityId: workTargetEntityId,
    sourceEntityLabel: lockedSourceEntityLabel,
    targetEntityLabel: workTargetEntityLabel,
    sourceCompanyName: input.sourceCompanyName,
    targetCompanyName: input.targetCompanyName,
    link: targetLink,
    entityKind: workTargetEntityKind,
    entityId: workTargetEntityId,
    ownFileUrls: targetOwnFileUrls,
    companyBankAccountId: workTargetBankId,
    sourceCompanyBankAccountId: lockedSourceBankId,
    targetCompanyBankAccountId: workTargetBankId,
    sourceCompanyBankLabel: lockedSourceBankLabel,
    targetCompanyBankLabel: workTargetBankLabel,
    interCompanyCounterpartyPartyId: targetIcPartyId,
    interCompanyLegs: targetLegs,
    shareSourceAttachmentsWithPeer,
    shareTargetAttachmentsWithSource,
    targetPostMode,
    interCompanySuggestedSourceAccountLabel: suggestedSourceAccountLabel || undefined,
    interCompanySourceAccountRestricted: sourceAccountRestricted || undefined,
  });

  const targetKeepsSourceApprovedFlag =
    sourceApprovedForTargetVisibility ||
    existingTargetRow?.interCompanySourceApproved === true;

  const targetPayload = {
    ...targetPayloadBase,
    ...(existingTargetApproved
      ? {
          ...(targetKeepsSourceApprovedFlag ? { interCompanySourceApproved: true } : {}),
        }
      : {
          isApproved: false,
          interCompanySourceApproved: targetKeepsSourceApprovedFlag,
        }),
  };

  /** Change Detected apply — pehle se approved copy save pe unapprove na ho. */
  const peerApplyKeepApprovedOpt =
    appliedPeerPendingKeys.length > 0
      ? {
          approvedByUserId: input.userId,
          approvedByName: String(input.approverName || input.userId || "").trim() || input.userId,
        }
      : undefined;
  const targetSaveKeepApproved =
    peerApplyKeepApprovedOpt && existingTargetApproved ? peerApplyKeepApprovedOpt : undefined;
  const sourceSaveKeepApproved =
    peerApplyKeepApprovedOpt && existingSourceApproved ? peerApplyKeepApprovedOpt : undefined;

  /** Pair pehle se dono companies par exist — peer auto-overwrite mat karo. */
  // IC redesign (final): freeze the OTHER copy only once that other side is approved. Before that, an edit just
  // updates the other copy (no Change Detected). After approval, Save-only => Change Detected, never unapprove.
  const freezePeerOnEdit =
    !isCreate &&
    !!input.existingSourceVoucherId &&
    !!resolvedExistingTargetVoucherId &&
    (editingSide === "source" ? existingTargetApproved : existingSourceApproved);

  // IC redesign (final): the other company's copy is created only when the source side is APPROVED.
  // Save-only on source => store the target payload on the source row (interCompanyDeferredTarget); the approve
  // path (voucherActionsClient materializeInterCompanyDeferredTarget) creates it local-first (SQLite + outbox).
  const deferTargetCreate =
    !resolvedExistingTargetVoucherId &&
    editingSide === "source" &&
    !existingSourceApproved &&
    !input.approveSourceAfterSave;

  let sourceSavedId = String(input.existingSourceVoucherId || "").trim();
  let targetSavedId = String(resolvedExistingTargetVoucherId || "").trim();

  if (!freezePeerOnEdit && deferTargetCreate) {
    const sourceSaved = await saveVoucher(
      input.sourceCompanyId,
      input.userId,
      sourcePayload,
      input.existingSourceVoucherId || null,
      undefined,
      {
        ...(icHistoryOpts || {}),
        preserveApprovalOnInterCompanyEdit: existingSourceApproved,
      }
    );
    sourceSavedId = sourceSaved.id;
    targetLink.peerVoucherId = sourceSavedId;
    targetSavedId = "";
    await patchVoucherFields(
      input.sourceCompanyId,
      sourceSavedId,
      {
        interCompanyDeferredTarget: {
          companyId: input.targetCompanyId,
          sourceCompanyId: input.sourceCompanyId,
          sourceVoucherId: sourceSavedId,
          userId: input.userId,
          payload: JSON.parse(JSON.stringify({ ...targetPayload, interCompanyLink: targetLink })),
          share: {
            sourceOwnFileUrls,
            shareSourceToTarget: shareSourceAttachmentsWithPeer,
            targetOwnFileUrls,
            shareTargetToSource: shareTargetAttachmentsWithSource,
          },
        },
      },
      IC_PATCH_SQLITE_FIRST
    );
  } else if (!freezePeerOnEdit) {
    const sourceSaved = await saveVoucher(
      input.sourceCompanyId,
      input.userId,
      { ...sourcePayload, interCompanyDeferredTarget: null },
      input.existingSourceVoucherId || null,
      undefined,
      {
        ...(icHistoryOpts || {}),
        preserveApprovalOnInterCompanyEdit: existingSourceApproved,
      }
    );
    sourceSavedId = sourceSaved.id;
    targetLink.peerVoucherId = sourceSavedId;
    const targetSaved = await saveVoucher(
      input.targetCompanyId,
      input.userId,
      { ...targetPayload, interCompanyLink: targetLink },
      resolvedExistingTargetVoucherId,
      undefined,
      {
        ...(isCreate || !resolvedExistingTargetVoucherId ? icHistoryOpts || {} : {}),
        preserveApprovalOnInterCompanyEdit: existingTargetApproved,
      }
    );
    targetSavedId = targetSaved.id;
  } else if (editingSide === "source") {
    const sourceSaved = await saveVoucher(
      input.sourceCompanyId,
      input.userId,
      {
        ...sourcePayload,
        interCompanyPeerPending: null,
      },
      input.existingSourceVoucherId || null,
      sourceSaveKeepApproved,
      { preserveApprovalOnInterCompanyEdit: existingSourceApproved }
    );
    sourceSavedId = sourceSaved.id;
    targetLink.peerVoucherId = sourceSavedId;

    if (appliedPeerPendingKeys.length > 0) {
      // Change Detected apply — apni company lists me badge turant hatao; peer pe reverse pending mat lagao
      notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, {
        interCompanyPeerPending: null,
        interCompanyLegs: sourceLegs,
        amount,
        total: amount,
        date: dateIso,
        narration: sourceNarration,
      });
    } else {
      const proposed = existingTargetRow
        ? buildInterCompanyPeerPendingProposed({
            existingPeer: existingTargetRow,
            amount,
            dateIso,
            narration: targetNarration,
            sourceEntityKind: lockedSourceEntityKind,
            sourceEntityId: lockedSourceEntityId,
            sourceEntityLabel: lockedSourceEntityLabel,
            targetEntityKind: workTargetEntityKind,
            targetEntityId: workTargetEntityId,
            targetEntityLabel: workTargetEntityLabel,
            sourceCompanyBankAccountId: lockedSourceBankId,
            sourceCompanyBankLabel: lockedSourceBankLabel,
            targetCompanyBankAccountId: workTargetBankId,
            targetCompanyBankLabel: workTargetBankLabel,
            targetPostMode,
          })
        : null;

      const targetPendingPatch = {
        interCompanyLink: targetLink,
        ...(sourceApprovedForTargetVisibility ? { interCompanySourceApproved: true } : {}),
        interCompanyPeerPending: proposed
          ? {
              fromPeerCompanyId: input.sourceCompanyId,
              fromPeerVoucherId: sourceSavedId,
              updatedAt: new Date().toISOString(),
              proposed,
            }
          : null,
      };
      await patchVoucherFields(input.targetCompanyId, targetSavedId, targetPendingPatch, IC_PATCH_SQLITE_FIRST);
      notifyInterCompanyPeerDocLive(input.targetCompanyId, targetSavedId, targetPendingPatch);
      // Notification only — amount / legs / isApproved peer pe mat chhedo
    }
  } else {
    // Target company se save — target full update; source pe pending stamp (normal edit)
    targetLink.peerVoucherId = sourceSavedId;
    const targetSaved = await saveVoucher(
      input.targetCompanyId,
      input.userId,
      {
        ...targetPayload,
        interCompanyLink: targetLink,
        interCompanyPeerPending:
          appliedPeerPendingKeys.length > 0
            ? null
            : peerPendingRemainOnOwnSide === undefined
              ? undefined
              : peerPendingRemainOnOwnSide
                ? {
                    fromPeerCompanyId: String(
                      readInterCompanyPeerPending(existingTargetRow)?.fromPeerCompanyId ||
                        input.sourceCompanyId
                    ),
                    fromPeerVoucherId: String(
                      readInterCompanyPeerPending(existingTargetRow)?.fromPeerVoucherId || sourceSavedId
                    ),
                    updatedAt: new Date().toISOString(),
                    proposed: peerPendingRemainOnOwnSide,
                  }
                : null,
      },
      resolvedExistingTargetVoucherId,
      targetSaveKeepApproved,
      { preserveApprovalOnInterCompanyEdit: existingTargetApproved }
    );
    targetSavedId = targetSaved.id;

    if (appliedPeerPendingKeys.length > 0) {
      notifyInterCompanyPeerDocLive(input.targetCompanyId, targetSavedId, {
        interCompanyPeerPending: null,
        interCompanyLegs: targetLegs,
        amount,
        total: amount,
        date: dateIso,
        narration: targetNarration,
      });
    } else {
      const proposedOnSource = existingSourceRow
        ? buildInterCompanyPeerPendingProposed({
            existingPeer: existingSourceRow,
            amount,
            dateIso,
            narration: sourceNarration,
            sourceEntityKind: lockedSourceEntityKind,
            sourceEntityId: lockedSourceEntityId,
            sourceEntityLabel: lockedSourceEntityLabel,
            targetEntityKind: workTargetEntityKind,
            targetEntityId: workTargetEntityId,
            targetEntityLabel: workTargetEntityLabel,
            sourceCompanyBankAccountId: lockedSourceBankId,
            sourceCompanyBankLabel: lockedSourceBankLabel,
            targetCompanyBankAccountId: workTargetBankId,
            targetCompanyBankLabel: workTargetBankLabel,
            targetPostMode,
          })
        : null;

      // Source approved account fields — pending me mat stamp karo (lock preserve)
      let sourceProposed = proposedOnSource;
      if (sourceProposed && existingSourceApproved) {
        const scrubbed = { ...sourceProposed };
        delete scrubbed.sourceEntityKind;
        delete scrubbed.sourceEntityId;
        delete scrubbed.sourceEntityLabel;
        delete scrubbed.sourceCompanyBankAccountId;
        delete scrubbed.sourceCompanyBankLabel;
        sourceProposed = Object.keys(scrubbed).length > 0 ? scrubbed : null;
      }

      const sourcePendingPatch = {
        interCompanyLink: { ...sourceLink, peerVoucherId: targetSavedId },
        interCompanyPeerPending: sourceProposed
          ? {
              fromPeerCompanyId: input.targetCompanyId,
              fromPeerVoucherId: targetSavedId,
              updatedAt: new Date().toISOString(),
              proposed: sourceProposed,
            }
          : null,
      };
      await patchVoucherFields(input.sourceCompanyId, sourceSavedId, sourcePendingPatch, IC_PATCH_SQLITE_FIRST);
      notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, sourcePendingPatch);
    }
  }

  // Change Detected apply — saveVoucher unapprove ko undo + pending clear (ledger lists live)
  if (appliedPeerPendingKeys.length > 0) {
    const approverName = String(input.approverName || input.userId || "").trim() || input.userId;
    if (editingSide === "target" && existingTargetApproved) {
      try {
        await approveVoucherWithHistory(
          input.targetCompanyId,
          targetSavedId,
          input.userId,
          approverName
        );
        const approvedTargetLegs = buildTargetInterCompanyLegsApproved({
          amount,
          entityKind: workTargetEntityKind,
          entityId: workTargetEntityId,
          companyBankAccountId: workTargetBankId,
          interCompanyCounterpartyPartyId: targetIcPartyId,
          useIcConduit,
          targetPostMode,
        });
        const afterApplyPatch = {
          ...(approvedTargetLegs.length > 0 ? { interCompanyLegs: approvedTargetLegs } : {}),
          interCompanyPeerPending: null,
        };
        await patchVoucherFields(input.targetCompanyId, targetSavedId, afterApplyPatch, IC_PATCH_SQLITE_FIRST);
        notifyInterCompanyPeerDocLive(input.targetCompanyId, targetSavedId, afterApplyPatch);
      } catch (err) {
        console.warn("[IC] restore target approval after peer apply:", err);
        notifyInterCompanyPeerDocLive(input.targetCompanyId, targetSavedId, {
          interCompanyPeerPending: null,
        });
      }
    } else if (editingSide === "target") {
      notifyInterCompanyPeerDocLive(input.targetCompanyId, targetSavedId, {
        interCompanyPeerPending: null,
      });
    }
    if (editingSide === "source" && existingSourceApproved) {
      try {
        await approveVoucherWithHistory(
          input.sourceCompanyId,
          sourceSavedId,
          input.userId,
          approverName
        );
        const approvedSourceLegs = buildSourceInterCompanyLegsApproved({
          amount,
          entityKind: lockedSourceEntityKind,
          entityId: lockedSourceEntityId,
          companyBankAccountId: lockedSourceBankId,
          interCompanyCounterpartyPartyId: sourceIcPartyId,
          useIcConduit,
        });
        const afterApplySourcePatch = {
          ...(approvedSourceLegs.length > 0 ? { interCompanyLegs: approvedSourceLegs } : {}),
          interCompanyPeerPending: null,
        };
        await patchVoucherFields(input.sourceCompanyId, sourceSavedId, afterApplySourcePatch, IC_PATCH_SQLITE_FIRST);
        notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, afterApplySourcePatch);
      } catch (err) {
        console.warn("[IC] restore source approval after peer apply:", err);
        notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, {
          interCompanyPeerPending: null,
        });
      }
    } else if (editingSide === "source") {
      notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, {
        interCompanyPeerPending: null,
      });
    }
  }

  if (!freezePeerOnEdit || editingSide === "source") {
    const sourceLinkPatch: Record<string, unknown> = {
      interCompanyLink: { ...sourceLink, peerVoucherId: targetSavedId },
      ...(appliedPeerPendingKeys.length > 0 && editingSide === "source"
        ? { interCompanyPeerPending: null }
        : {}),
    };
    await patchVoucherFields(input.sourceCompanyId, sourceSavedId, sourceLinkPatch, IC_PATCH_SQLITE_FIRST);
    if (appliedPeerPendingKeys.length > 0 && editingSide === "source") {
      notifyInterCompanyPeerDocLive(input.sourceCompanyId, sourceSavedId, sourceLinkPatch);
    }
  }

  if (input.approveSourceAfterSave) {
    const approverName = String(input.approverName || input.userId || "").trim() || input.userId;
    // Target company Save & Approve — apni (target) copy approve; source mat chhedo
    if (editingSide === "target") {
      await approveVoucherWithHistory(
        input.targetCompanyId,
        targetSavedId,
        input.userId,
        approverName
      );
      const approvedTargetLegs = buildTargetInterCompanyLegsApproved({
        amount,
        entityKind: workTargetEntityKind,
        entityId: workTargetEntityId,
        companyBankAccountId: workTargetBankId,
        interCompanyCounterpartyPartyId: targetIcPartyId,
        useIcConduit,
        targetPostMode,
      });
      if (approvedTargetLegs.length > 0) {
        await patchVoucherFields(
          input.targetCompanyId,
          targetSavedId,
          {
            interCompanyLegs: approvedTargetLegs,
            ...(targetKeepsSourceApprovedFlag ? { interCompanySourceApproved: true } : {}),
          },
          IC_PATCH_SQLITE_FIRST
        );
      }
    } else {
      await approveVoucherWithHistory(
        input.sourceCompanyId,
        sourceSavedId,
        input.userId,
        approverName
      );
      const approvedLegs = buildSourceInterCompanyLegsApproved({
        amount,
        entityKind: lockedSourceEntityKind,
        entityId: lockedSourceEntityId,
        companyBankAccountId: lockedSourceBankId,
        interCompanyCounterpartyPartyId: sourceIcPartyId,
        useIcConduit,
      });
      if (approvedLegs.length > 0) {
        await patchVoucherFields(
          input.sourceCompanyId,
          sourceSavedId,
          { interCompanyLegs: approvedLegs },
          IC_PATCH_SQLITE_FIRST
        );
      }
    }
  }

  // Source already approved (or just approved) — target ledger must show the pair copy.
  if (sourceApprovedForTargetVisibility && targetSavedId) {
    try {
      await patchVoucherFields(
        input.targetCompanyId,
        targetSavedId,
        { interCompanySourceApproved: true },
        IC_PATCH_SQLITE_FIRST
      );
    } catch (err) {
      console.warn("[IC] target interCompanySourceApproved sync:", err);
      throw new Error(
        "Inter Company target copy saved, but visibility flag failed on the other company. Open the target company and try Save again."
      );
    }
  }

  // Background: peer attachment copy + counterparty cleanup — UI turant return (SQLite/outbox pehle ho chuka).
  void (async () => {
    try {
      // Deferred target (not yet created): sharing runs when the copy is materialized on approve.
      if (!targetSavedId) throw null;
      const shareResult = await reconcileAndPatchInterCompanyAttachmentSharing({
        sourceCompanyId: input.sourceCompanyId,
        sourceVoucherId: sourceSavedId,
        sourceOwnFileUrls,
        shareSourceToTarget: shareSourceAttachmentsWithPeer,
        targetCompanyId: input.targetCompanyId,
        targetVoucherId: targetSavedId,
        targetOwnFileUrls,
        shareTargetToSource: shareTargetAttachmentsWithSource,
        sourceAttachmentBlobByRef: input.sourceAttachmentBlobByRef,
        targetAttachmentBlobByRef: input.targetAttachmentBlobByRef,
      });
      if (shareResult.attachmentReplicationWarning) {
        const { toast } = await import("sonner");
        toast.warning("Attachment copy incomplete", {
          description: shareResult.attachmentReplicationWarning,
        });
      }
    } catch (err) {
      if (err === null) {
        /* deferred target: nothing to share yet */
      } else {
      const message =
        err instanceof Error ? err.message : "Could not sync Inter Company attachments.";
      console.warn("[IC] attachment share reconcile:", err);
      const { toast } = await import("sonner");
      toast.warning("Attachment sync pending", { description: message });
      }
    }

    try {
      await reconcileUnusedInterCompanyCounterpartyParties({
        companyId: input.sourceCompanyId,
        deletedByUid: input.userId,
      });
      await reconcileUnusedInterCompanyCounterpartyParties({
        companyId: input.targetCompanyId,
        deletedByUid: input.userId,
      });
    } catch (err) {
      console.warn("[IC] post-save counterparty party reconcile:", err);
    }
  })();

  return {
    sourceId: sourceSavedId,
    targetId: targetSavedId,
    linkId,
  };
}

/** Sirf is company ki IC copy recycle bin — peer copy safe (locked / approved IC). */
export async function deleteInterCompanyVoucherLocalCopyOnly(args: {
  companyId: string;
  voucherId: string;
  deletedByUid: string;
}): Promise<void> {
  const cid = String(args.companyId || "").trim();
  const vid = String(args.voucherId || "").trim();
  if (!cid || !vid) {
    throw new Error("Missing company or voucher");
  }

  let row = (await getCompanyDocFromBrowserDb(cid, "vouchers", vid)) as Record<string, unknown> | null;
  if (!row) {
    row = await readInterCompanyVoucherRow(cid, vid);
  }
  if (!row || String(row.type || "") !== "inter_company") {
    throw new Error("Not an Inter Company voucher");
  }

  const deletedAt = Timestamp.now();
  const payload: Record<string, unknown> = {
    ...row,
    id: vid,
    isDeleted: true,
    deletedAt,
    deletedBy: args.deletedByUid || "",
    updatedAt: deletedAt,
    lastEditedAt: deletedAt,
  };
  coerceVoucherDocumentDate(payload);

  // Hamesha pehle SQLite — Firebase ledger sync off ho to bhi local delete.
  const written = await upsertCompanyDocInBrowserDb(cid, "vouchers", vid, payload, { force: true });
  if (!written) {
    throw new Error("Could not delete in local database (SQLite). Retry or reopen the company.");
  }
  dispatchVoucherLivePatch(cid, vid, payload);

  const partyId = String(row.interCompanyCounterpartyPartyId || "").trim();

  // Cloud sync + counterparty cleanup background — SQLite tombstone turant return.
  void (async () => {
    if (
      isFirebaseLedgerDataSyncEnabled() &&
      isFirebaseLedgerCompanyDataSyncEnabled(cid) &&
      (await canSyncCompanyToServer(cid))
    ) {
      await enqueueVoucherOutbox(cid, "update", vid, payload);
      void flushVoucherOutbox().catch((err) => {
        console.warn("[IC] local delete outbox flush:", err);
      });
    }
    if (partyId) {
      try {
        await purgeInterCompanyCounterpartyPartyIfUnused({ companyId: cid, partyId });
      } catch (err) {
        console.warn("[IC] counterparty party cleanup (local delete):", err);
      }
    }
  })();
}

/** Source + linked target dono recycle bin. */
export async function deleteInterCompanyVoucherPair(args: {
  sourceCompanyId: string;
  sourceVoucherId: string;
  peerCompanyId?: string | null;
  peerVoucherId?: string | null;
  deletedByUid: string;
  /** Delete request accept — source approve ke baad bhi dono side recycle bin */
  mutualConfirmDelete?: boolean;
}): Promise<void> {
  if (!args.mutualConfirmDelete) {
    await assertInterCompanyDeleteAllowed(args.sourceCompanyId, args.sourceVoucherId);
  }

  const sourceRow = await readInterCompanyVoucherRow(args.sourceCompanyId, args.sourceVoucherId);
  const peerCompanyId = String(args.peerCompanyId || "").trim();
  const peerVoucherId = String(args.peerVoucherId || "").trim();
  const targetRow =
    peerCompanyId && peerVoucherId ? await readInterCompanyVoucherRow(peerCompanyId, peerVoucherId) : null;

  await softDeleteVoucherMoveToRecycleBin(args.sourceCompanyId, args.sourceVoucherId, args.deletedByUid);
  if (peerCompanyId && peerVoucherId) {
    await softDeleteVoucherMoveToRecycleBin(peerCompanyId, peerVoucherId, args.deletedByUid);
  }

  const cleanupTargets: Array<{ companyId: string; partyId: string }> = [];
  const sourcePartyId = String(sourceRow?.interCompanyCounterpartyPartyId || "").trim();
  if (sourcePartyId) cleanupTargets.push({ companyId: args.sourceCompanyId, partyId: sourcePartyId });
  const targetPartyId = String(targetRow?.interCompanyCounterpartyPartyId || "").trim();
  if (targetPartyId && peerCompanyId) cleanupTargets.push({ companyId: peerCompanyId, partyId: targetPartyId });

  for (const target of cleanupTargets) {
    try {
      await purgeInterCompanyCounterpartyPartyIfUnused({
        companyId: target.companyId,
        partyId: target.partyId,
      });
    } catch (err) {
      console.warn("[IC] counterparty party cleanup:", err);
    }
  }
}
