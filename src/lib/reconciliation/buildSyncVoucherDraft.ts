import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import { startOfDay } from "date-fns";
import { collection, query, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalOnlyMode } from "@/lib/localMode";
import type { ReconciliationEntityType, ReconciliationLedgerRow, ReconciliationShare } from "@/lib/reconciliation/types";
import { reconciliationEntityCollection } from "@/lib/reconciliation/types";
import { collectOppositeReferenceIdsForCompare } from "@/lib/copyLedgerCrossCompany";
import { fetchInterCompanyEntitiesForCompany } from "@/lib/interCompany/fetchInterCompanyEntities";
import type { InterCompanyEntityDetail } from "@/lib/interCompany/interCompanyEntityTypes";
import { loadJournalLedgerScopeSnapshot, type JournalScopedLedgerSnapshot } from "@/lib/journalLedgerScopeLoad";
import { fetchVoucherForReconciliationEdit } from "@/lib/reconciliation/reconciliationStore";
import { reconciliationViewerSide } from "@/lib/reconciliation/sideMeta";

/** Remote voucher type → apni company me opposite type (payment in ↔ out, etc.) */
const RECON_MIRROR_VOUCHER_TYPE: Record<string, string> = {
  payment_in: "payment_out",
  payment_out: "payment_in",
  direct_income: "direct_expense",
  direct_expense: "direct_income",
  sale: "purchase",
  purchase: "sale",
  journal: "journal",
  contra: "contra",
  note: "note",
};

/** Collection → journal line entityType */
function reconciliationCollectionToEntityType(collection: string): string {
  if (collection === "bank_accounts") return "bank";
  if (collection === "expense_accounts") return "expense";
  if (collection === "taxes") return "tax";
  if (collection === "staff") return "staff";
  return "party";
}

/** Journal form entity type — bank ko `account` label se map */
function journalFormEntityType(entityType: string): string {
  if (entityType === "bank" || entityType === "account") return "account";
  return entityType || "party";
}

type ScopedAccountRef = { id: string; name: string; entityType: string; interCompanyAccountNo?: string };

function icKindToJournalEntity(kind: string): string {
  if (kind === "bank") return "account";
  return kind || "party";
}

function entitiesToScopedRefs(entities: InterCompanyEntityDetail[]): ScopedAccountRef[] {
  return entities.map((e) => ({
    id: e.id,
    name: e.label,
    entityType: icKindToJournalEntity(String(e.kind || "party")),
    interCompanyAccountNo: e.interCompanyAccountNo,
  }));
}

/** Snapshot + Inter Co. A/c No merge — connected ledger id lookup ke liye */
function buildAccountIndexFromIcAndSnap(
  snap: JournalScopedLedgerSnapshot,
  icEntities: InterCompanyEntityDetail[]
): ScopedAccountRef[] {
  const merged = new Map<string, ScopedAccountRef>();
  flattenScopedAccounts(snap).forEach((a) => merged.set(a.id, a));
  entitiesToScopedRefs(icEntities).forEach((a) => {
    const prev = merged.get(a.id);
    merged.set(
      a.id,
      prev
        ? {
            ...prev,
            interCompanyAccountNo: a.interCompanyAccountNo || prev.interCompanyAccountNo,
            name: prev.name || a.name,
            entityType: prev.entityType || a.entityType,
          }
        : a
    );
  });
  return Array.from(merged.values());
}

function findLocalByInterCompanyAccountNo(
  localAccounts: ScopedAccountRef[],
  icNo: string
): ScopedAccountRef | null {
  const key = String(icNo || "").trim().toUpperCase();
  if (!key) return null;
  return (
    localAccounts.find((a) => String(a.interCompanyAccountNo || "").trim().toUpperCase() === key) ?? null
  );
}

function normalizeAccountNameForMatch(name: string): string {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Company snapshot se saari ledger accounts flat list */
function flattenScopedAccounts(snap: JournalScopedLedgerSnapshot): ScopedAccountRef[] {
  const out: ScopedAccountRef[] = [];
  snap.processedPartiesForSelection.forEach((p) =>
    out.push({ id: p.id, name: p.name, entityType: "party" })
  );
  snap.processedStaff.forEach((p) => out.push({ id: p.id, name: p.name, entityType: "staff" }));
  snap.processedAccounts.forEach((p) => {
    const name = String(p.accountName || p.name || p.id).trim() || p.id;
    out.push({ id: p.id, name, entityType: "account" });
  });
  snap.expenseAccounts.forEach((p) => out.push({ id: p.id, name: p.name, entityType: "expense" }));
  snap.processedTaxes.forEach((p) => out.push({ id: p.id, name: p.name, entityType: "tax" }));
  return out;
}

function findScopedAccountById(accounts: ScopedAccountRef[], accountId: string): ScopedAccountRef | null {
  const id = String(accountId || "").trim();
  if (!id) return null;
  return accounts.find((a) => a.id === id) ?? null;
}

function findScopedAccountByName(accounts: ScopedAccountRef[], name: string): ScopedAccountRef | null {
  const key = normalizeAccountNameForMatch(name);
  if (!key) return null;
  return accounts.find((a) => normalizeAccountNameForMatch(a.name) === key) ?? null;
}

function normalizeLooseNameKey(name: string): string {
  return normalizeAccountNameForMatch(name).replace(/[^a-z0-9\s]/g, "");
}

/** Owned company me same entity + same account name (exact, phir loose) */
function findScopedAccountByNameAndEntity(
  accounts: ScopedAccountRef[],
  name: string,
  entityType: string
): ScopedAccountRef | null {
  const et = journalFormEntityType(entityType);
  const pool = accounts.filter((a) => journalFormEntityType(a.entityType) === et);
  const key = normalizeAccountNameForMatch(name);
  if (!key || pool.length === 0) return null;

  let hit = pool.find((a) => normalizeAccountNameForMatch(a.name) === key);
  if (hit) return hit;

  const looseKey = normalizeLooseNameKey(name);
  hit = pool.find((a) => normalizeLooseNameKey(a.name) === looseKey);
  if (hit) return hit;

  if (looseKey.length >= 3) {
    return (
      pool.find((a) => {
        const n = normalizeLooseNameKey(a.name);
        return n.includes(looseKey) || looseKey.includes(n);
      }) ?? null
    );
  }
  return null;
}

/** Exact match fail ho to partial name se local account dhoondo (entity filter optional) */
function findScopedAccountByLooseName(
  accounts: ScopedAccountRef[],
  name: string,
  entityType?: string
): ScopedAccountRef | null {
  if (entityType) {
    const inEntity = findScopedAccountByNameAndEntity(accounts, name, entityType);
    if (inEntity) return inEntity;
  }
  const exact = findScopedAccountByName(accounts, name);
  if (exact) return exact;
  const key = normalizeAccountNameForMatch(name);
  if (!key || key.length < 3) return null;
  const pool = entityType
    ? accounts.filter((a) => journalFormEntityType(a.entityType) === journalFormEntityType(entityType))
    : accounts;
  return (
    pool.find((a) => {
      const n = normalizeAccountNameForMatch(a.name);
      return n.includes(key) || key.includes(n);
    }) ?? null
  );
}

type ParsedJournalLeg = {
  accountId: string;
  side: "debit" | "credit";
  amount: number;
  entityType?: string;
};

function flipJournalSide(side: "debit" | "credit"): "debit" | "credit" {
  return side === "debit" ? "credit" : "debit";
}

/** Remote saved voucher se journal Dr/Cr legs (+ lines se entityType) */
function parseRemoteJournalLegs(voucher: Record<string, unknown>): ParsedJournalLeg[] {
  const lineEntityByAccountId = new Map<string, string>();
  const rawLines = (Array.isArray(voucher.lines) ? voucher.lines : []) as Array<{
    accountId?: string;
    entityType?: string;
    type?: string;
    amount?: number;
  }>;
  for (const l of rawLines) {
    const aid = String(l.accountId || "").trim();
    const et = String(l.entityType || "").trim();
    if (aid && et) lineEntityByAccountId.set(aid, et);
  }

  const legs: ParsedJournalLeg[] = [];
  const entries = (Array.isArray(voucher.entries) ? voucher.entries : []) as Array<{
    accountId?: string;
    debit?: number;
    credit?: number;
  }>;
  for (const e of entries) {
    const accountId = String(e.accountId || "").trim();
    if (!accountId) continue;
    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;
    const entityType = lineEntityByAccountId.get(accountId);
    if (debit > 0) legs.push({ accountId, side: "debit", amount: debit, entityType });
    else if (credit > 0) legs.push({ accountId, side: "credit", amount: credit, entityType });
  }
  if (legs.length > 0) return legs;

  for (const l of rawLines) {
    const accountId = String(l.accountId || "").trim();
    const amount = Number(l.amount) || 0;
    if (!accountId || amount <= 0) continue;
    legs.push({
      accountId,
      side: String(l.type || "").toLowerCase() === "credit" ? "credit" : "debit",
      amount,
      entityType: String(l.entityType || "").trim() || lineEntityByAccountId.get(accountId),
    });
  }
  return legs;
}

/** Remote account → owned: recon connected id → IC A/c No → name+entity */
function mapRemoteAccountToLocal(params: {
  remoteAccountId: string;
  remoteEntityType?: string;
  remoteCtx: ReconciliationSideContext;
  myCtx: ReconciliationSideContext;
  remoteAccounts: ScopedAccountRef[];
  localAccounts: ScopedAccountRef[];
}): ScopedAccountRef | null {
  const remoteId = String(params.remoteAccountId || "").trim();
  if (!remoteId) return null;

  const remoteAcc = findScopedAccountById(params.remoteAccounts, remoteId);
  const remoteName = remoteAcc?.name ?? "";
  const remoteEntity = journalFormEntityType(
    params.remoteEntityType || remoteAcc?.entityType || "party"
  );

  // 1) Reconciliation share — remote linked recon account id → owned linked recon account id
  if (remoteId === params.remoteCtx.accountId && params.myCtx.accountId) {
    const localRecon = findScopedAccountById(params.localAccounts, params.myCtx.accountId);
    if (localRecon) return localRecon;
    return {
      id: params.myCtx.accountId,
      name: params.myCtx.accountName,
      entityType: journalFormEntityType(reconciliationCollectionToEntityType(params.myCtx.collection)),
    };
  }

  // 2) Inter Co. connected ledger id (same interCompanyAccountNo dono companies me)
  const icNo = String(remoteAcc?.interCompanyAccountNo || "").trim();
  if (icNo) {
    const byIcNo = findLocalByInterCompanyAccountNo(params.localAccounts, icNo);
    if (byIcNo) return byIcNo;
  }

  // 3) Same entity + same account name
  if (remoteName) {
    const localSame = findScopedAccountByNameAndEntity(params.localAccounts, remoteName, remoteEntity);
    if (localSame) return localSame;
    const localLoose = findScopedAccountByLooseName(params.localAccounts, remoteName, remoteEntity);
    if (localLoose) return localLoose;
    return findScopedAccountByLooseName(params.localAccounts, remoteName);
  }

  return null;
}

type ItemRef = { id: string; name: string };

/** Company items — sync sale/purchase line item name se map */
async function loadCompanyItems(companyId: string): Promise<ItemRef[]> {
  if (!companyId) return [];
  let rows: Array<Record<string, unknown>> = [];
  if (isLocalOnlyMode()) {
    rows = (await listCompanyDocsFromBrowserDb(companyId, "items")) as Array<Record<string, unknown>>;
  } else {
    const snap = await getDocs(
      query(collection(firestore, `companies/${companyId}/items`), where("isDeleted", "==", false))
    );
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;
  }
  return rows
    .filter((r) => r.isDeleted !== true)
    .map((r) => ({
      id: String(r.id || ""),
      name: String(r.name || r.itemName || "").trim(),
    }))
    .filter((r) => r.id);
}

function findLocalItemForRemote(
  remoteItemId: string,
  remoteItems: ItemRef[],
  localItems: ItemRef[]
): ItemRef | null {
  const rid = String(remoteItemId || "").trim();
  if (!rid) return null;
  const remote = remoteItems.find((i) => i.id === rid);
  if (!remote?.name) return null;
  const key = normalizeAccountNameForMatch(remote.name);
  let hit = localItems.find((i) => normalizeAccountNameForMatch(i.name) === key);
  if (hit) return hit;
  const looseKey = normalizeLooseNameKey(remote.name);
  hit = localItems.find((i) => normalizeLooseNameKey(i.name) === looseKey);
  if (hit) return hit;
  if (looseKey.length >= 3) {
    return (
      localItems.find((i) => {
        const n = normalizeLooseNameKey(i.name);
        return n.includes(looseKey) || looseKey.includes(n);
      }) ?? null
    );
  }
  return null;
}

/** Remote sale/purchase lineItems → owned company ids (item + tax map) */
function mapRemoteSalePurchaseLineItems(params: {
  remoteLineItems: unknown;
  remoteItems: ItemRef[];
  localItems: ItemRef[];
  remoteAccounts: ScopedAccountRef[];
  localAccounts: ScopedAccountRef[];
  remoteCtx: ReconciliationSideContext;
  myCtx: ReconciliationSideContext;
  fallbackAmount: number;
}): Array<Record<string, unknown>> {
  const raw = Array.isArray(params.remoteLineItems) ? params.remoteLineItems : [];
  if (raw.length === 0) {
    return [
      {
        type: "item",
        itemId: "",
        quantity: 1,
        rate: params.fallbackAmount,
        unit: "",
        amount: params.fallbackAmount,
        taxAccountId: "",
        taxAmount: 0,
        isTaxInclusive: false,
        allowManualRate: true,
      },
    ];
  }
  return raw.map((li) => {
    const row = li as Record<string, unknown>;
    const localItem = findLocalItemForRemote(String(row.itemId || ""), params.remoteItems, params.localItems);
    let taxAccountId = "";
    const remoteTaxId = String(row.taxAccountId || "").trim();
    if (remoteTaxId) {
      const mappedTax = mapRemoteAccountToLocal({
        remoteAccountId: remoteTaxId,
        remoteEntityType: "tax",
        remoteCtx: params.remoteCtx,
        myCtx: params.myCtx,
        remoteAccounts: params.remoteAccounts,
        localAccounts: params.localAccounts,
      });
      taxAccountId = mappedTax?.id || "";
    }
    const qty = Number(row.quantity) || 1;
    const rate = Number(row.rate) || Number(row.amount) || 0;
    const amount = Number(row.amount) || qty * rate;
    return {
      type: String(row.type || "item"),
      itemId: localItem?.id || "",
      quantity: qty,
      rate,
      unit: String(row.unit || ""),
      amount,
      taxAccountId,
      taxAmount: Number(row.taxAmount) || 0,
      tdsAccountId: String(row.tdsAccountId ?? "").trim(),
      tdsAmount: Number(row.tdsAmount) || 0,
      isTaxInclusive: Boolean(row.isTaxInclusive),
      allowManualRate: row.allowManualRate !== false,
    };
  });
}

/** Remote PUR → owned Sale (aur ulta): party + counter account + line items map */
async function buildSalePurchaseDraftFromRemoteVoucher(params: {
  remoteVoucher: Record<string, unknown>;
  remoteRow: ReconciliationLedgerRow;
  remoteCtx: ReconciliationSideContext;
  myCtx: ReconciliationSideContext;
  localCompanyId: string;
  mirroredType: "sale" | "purchase";
  date: Date;
  narration: string;
}): Promise<Record<string, unknown>> {
  const [remoteSnap, localSnap, remoteIcEntities, localIcEntities, remoteItems, localItems] =
    await Promise.all([
      loadJournalLedgerScopeSnapshot(params.remoteCtx.companyId),
      loadJournalLedgerScopeSnapshot(params.localCompanyId),
      fetchInterCompanyEntitiesForCompany(params.remoteCtx.companyId),
      fetchInterCompanyEntitiesForCompany(params.localCompanyId),
      loadCompanyItems(params.remoteCtx.companyId),
      loadCompanyItems(params.localCompanyId),
    ]);
  const remoteAccounts = buildAccountIndexFromIcAndSnap(remoteSnap, remoteIcEntities);
  const localAccounts = buildAccountIndexFromIcAndSnap(localSnap, localIcEntities);

  const remoteType = String(params.remoteVoucher.type || "").toLowerCase();
  const remoteCounterField = remoteType === "purchase" ? "purchaseAccountId" : "salesAccountId";
  const localCounterField = params.mirroredType === "sale" ? "salesAccountId" : "purchaseAccountId";
  const defaultCounter = params.mirroredType === "sale" ? "sales_account" : "purchase_account";

  let counterAccountId = defaultCounter;
  const remoteCounterId = String(params.remoteVoucher[remoteCounterField] || "").trim();
  if (remoteCounterId) {
    const mappedCounter = mapRemoteAccountToLocal({
      remoteAccountId: remoteCounterId,
      remoteEntityType: params.mirroredType === "sale" ? "expense" : "party",
      remoteCtx: params.remoteCtx,
      myCtx: params.myCtx,
      remoteAccounts,
      localAccounts,
    });
    if (mappedCounter?.id) counterAccountId = mappedCounter.id;
  }

  const fallbackAmount = reconciliationRowAmount(params.remoteRow);
  const lineItems = mapRemoteSalePurchaseLineItems({
    remoteLineItems: params.remoteVoucher.lineItems,
    remoteItems,
    localItems,
    remoteAccounts,
    localAccounts,
    remoteCtx: params.remoteCtx,
    myCtx: params.myCtx,
    fallbackAmount,
  });

  const total = Number(params.remoteVoucher.total) || fallbackAmount;
  const subTotal = Number(params.remoteVoucher.subTotal) || total;
  const discount = Number(params.remoteVoucher.discount) || 0;
  const tax = Number(params.remoteVoucher.tax) || 0;

  return {
    type: params.mirroredType,
    defaultTab: params.mirroredType,
    date: params.date,
    partyId: params.myCtx.accountId,
    [localCounterField]: counterAccountId,
    voucherNumber: "",
    narration: params.narration,
    lineItems,
    subTotal,
    discount,
    tax,
    total,
    amount: total,
  };
}

/** Remote voucher ki dono legs → owned company me flip Dr/Cr + dono account fields */
async function buildJournalDraftFromRemoteVoucher(params: {
  remoteVoucher: Record<string, unknown>;
  remoteRow: ReconciliationLedgerRow;
  remoteCtx: ReconciliationSideContext;
  myCtx: ReconciliationSideContext;
  localCompanyId: string;
  date: Date;
  narration: string;
}): Promise<Record<string, unknown>> {
  const [remoteSnap, localSnap, remoteIcEntities, localIcEntities] = await Promise.all([
    loadJournalLedgerScopeSnapshot(params.remoteCtx.companyId),
    loadJournalLedgerScopeSnapshot(params.localCompanyId),
    fetchInterCompanyEntitiesForCompany(params.remoteCtx.companyId),
    fetchInterCompanyEntitiesForCompany(params.localCompanyId),
  ]);
  const remoteAccounts = buildAccountIndexFromIcAndSnap(remoteSnap, remoteIcEntities);
  const localAccounts = buildAccountIndexFromIcAndSnap(localSnap, localIcEntities);

  let legs = parseRemoteJournalLegs(params.remoteVoucher).filter((l) => l.amount > 0);

  // Voucher shape alag ho to snapshot row se recon leg fallback
  if (legs.length === 0) {
    const amount = reconciliationRowAmount(params.remoteRow);
    const remoteDebit = Number(params.remoteRow.debit) || 0;
    const remoteCredit = Number(params.remoteRow.credit) || 0;
    const remoteSide: "debit" | "credit" = remoteDebit > 0 ? "debit" : remoteCredit > 0 ? "credit" : "debit";
    legs = [{ accountId: params.remoteCtx.accountId, side: remoteSide, amount }];
  }

  const mapped: Array<{
    accountId: string;
    entityType: string;
    type: "debit" | "credit";
    amount: number;
    isAutoLine: boolean;
  }> = [];

  for (const leg of legs) {
    const localAcc = mapRemoteAccountToLocal({
      remoteAccountId: leg.accountId,
      remoteEntityType: leg.entityType,
      remoteCtx: params.remoteCtx,
      myCtx: params.myCtx,
      remoteAccounts,
      localAccounts,
    });
    if (!localAcc?.id) continue;
    mapped.push({
      accountId: localAcc.id,
      entityType: journalFormEntityType(localAcc.entityType),
      type: flipJournalSide(leg.side), // remote Dr → owned Cr
      amount: leg.amount,
      isAutoLine: false,
    });
  }

  // Remote voucher order rakho — recon connected account pehli line (owned linked id)
  mapped.sort((a, b) => {
    if (a.accountId === params.myCtx.accountId) return -1;
    if (b.accountId === params.myCtx.accountId) return 1;
    return 0;
  });

  const fallbackAmount = reconciliationRowAmount(params.remoteRow);
  const myLineType = mirroredAccountLineSideFromRemoteRow(params.remoteRow);
  const oppLineType = myLineType === "debit" ? "credit" : "debit";

  if (mapped.length === 0) {
    mapped.push({
      accountId: params.myCtx.accountId,
      entityType: journalFormEntityType(reconciliationCollectionToEntityType(params.myCtx.collection)),
      type: myLineType,
      amount: fallbackAmount,
      isAutoLine: false,
    });
  }

  while (mapped.length < 2) {
    mapped.push({
      accountId: "",
      entityType: "",
      type: mapped.length === 1 ? oppLineType : "debit",
      amount: mapped[0]?.amount ?? fallbackAmount,
      isAutoLine: mapped.length >= 1,
    });
  }
  if (mapped.length > 2) mapped.splice(2);
  if (mapped.length >= 2) mapped[1].isAutoLine = true;

  const amount = Math.max(...mapped.map((m) => m.amount), fallbackAmount);

  return {
    type: "journal",
    defaultTab: "journal",
    date: params.date,
    amount,
    total: amount,
    voucherNumber: "",
    narration: params.narration,
    ...applyMyReconciliationAccountFields(params.myCtx, "journal"),
    entries: mapped.map((m) => ({
      accountId: m.accountId,
      debit: m.type === "debit" ? m.amount : 0,
      credit: m.type === "credit" ? m.amount : 0,
    })),
    lines: mapped,
  };
}

/** Payment/contra — reconciliation field ko overwrite na karke sirf opposite slot bharo */
function applyOppositePaymentField(
  draft: Record<string, unknown>,
  localAcc: ScopedAccountRef,
  myAccountId: string
): void {
  if (!localAcc.id || localAcc.id === myAccountId) return;
  const myId = String(myAccountId || "");

  if (localAcc.entityType === "party") {
    if (String(draft.partyId || "") === myId) return;
    draft.partyId = localAcc.id;
    draft.payeeType = "party";
    return;
  }
  if (localAcc.entityType === "staff") {
    if (String(draft.staffId || "") === myId) return;
    draft.payeeType = "staff";
    draft.staffId = localAcc.id;
    return;
  }
  if (localAcc.entityType === "account") {
    if (String(draft.accountId || "") === myId) return;
    draft.accountId = localAcc.id;
    return;
  }
  if (localAcc.entityType === "expense") {
    if (String(draft.expenseAccountId || "") === myId || String(draft.toAccountId || "") === myId) return;
    draft.payeeType = "expense";
    draft.expenseAccountId = localAcc.id;
    draft.toAccountId = localAcc.id;
    return;
  }
  if (localAcc.entityType === "tax") {
    if (String(draft.taxAccountId || "") === myId) return;
    draft.payeeType = "tax";
    draft.taxAccountId = localAcc.id;
  }
}

export type ReconciliationSideContext = {
  entityType: ReconciliationEntityType;
  accountId: string;
  accountName: string;
  collection: string;
  companyId: string;
};

/** Share se meri (you) side ka account context — uid participant ya shared staff (selected company). */
export function getMyReconciliationSideContext(
  share: ReconciliationShare,
  userId: string,
  companyId: string
): ReconciliationSideContext | null {
  const cid = String(companyId || "").trim();
  const viewerSide = reconciliationViewerSide(share, userId, cid);

  if (viewerSide === "sender" && share.senderAccountId) {
    return {
      entityType: share.senderEntityType,
      accountId: share.senderAccountId,
      accountName: share.senderAccountName,
      collection: share.senderCollection,
      companyId: share.senderCompanyId,
    };
  }
  if (viewerSide === "receiver" && share.receiverCompanyId && share.receiverAccountId) {
    return {
      entityType: share.receiverEntityType ?? "party",
      accountId: share.receiverAccountId ?? "",
      accountName: share.receiverAccountName ?? "",
      collection: share.receiverCollection || reconciliationEntityCollection(share.receiverEntityType ?? "party"),
      companyId: share.receiverCompanyId,
    };
  }
  return null;
}

/** Remote (dusri) side context — crossCopySourceRef ke liye */
export function getRemoteReconciliationSideContext(
  share: ReconciliationShare,
  userId: string,
  companyId?: string
): ReconciliationSideContext | null {
  const mine = getMyReconciliationSideContext(share, userId, companyId ?? "");
  if (!mine) return null;
  if (mine.companyId === share.senderCompanyId) {
    if (!share.receiverCompanyId || !share.receiverAccountId) return null;
    return {
      entityType: share.receiverEntityType ?? "party",
      accountId: share.receiverAccountId ?? "",
      accountName: share.receiverAccountName ?? "",
      collection: share.receiverCollection || reconciliationEntityCollection(share.receiverEntityType ?? "party"),
      companyId: share.receiverCompanyId,
    };
  }
  return {
    entityType: share.senderEntityType,
    accountId: share.senderAccountId,
    accountName: share.senderAccountName,
    collection: share.senderCollection,
    companyId: share.senderCompanyId,
  };
}

/** Remote Dr/Cr se ya type se opposite voucher type */
export function mirrorReconciliationVoucherType(
  remoteType: string,
  remoteDebit: number,
  remoteCredit: number
): string {
  const t = String(remoteType || "").trim().toLowerCase();
  if (RECON_MIRROR_VOUCHER_TYPE[t]) return RECON_MIRROR_VOUCHER_TYPE[t];
  // Ledger Dr/Cr: unke credit → hamara debit (payment in), unke debit → hamara credit (payment out)
  if (remoteCredit > 0) return "payment_in";
  if (remoteDebit > 0) return "payment_out";
  return "journal";
}

function reconciliationRowAmount(row: ReconciliationLedgerRow): number {
  return Math.max(Number(row.debit) || 0, Number(row.credit) || 0, Number(row.amount) || 0);
}

/** Remote ledger Dr → apni reconciliation line Cr; remote Cr → apni line Dr */
function mirroredAccountLineSideFromRemoteRow(row: ReconciliationLedgerRow): "debit" | "credit" {
  const remoteDebit = Number(row.debit) || 0;
  const remoteCredit = Number(row.credit) || 0;
  if (remoteDebit > 0) return "credit";
  if (remoteCredit > 0) return "debit";
  return "credit";
}

function reconciliationRowDate(row: ReconciliationLedgerRow): Date {
  if (!row.rawDate) return startOfDay(new Date());
  const d = new Date(row.rawDate);
  return Number.isFinite(d.getTime()) ? startOfDay(d) : startOfDay(new Date());
}

function buildSyncNarration(remoteRow: ReconciliationLedgerRow, remoteAccountName: string): string {
  const base = String(remoteRow.narration || "").trim();
  const ref = `Re: ${remoteRow.voucherNumber || "—"} (${remoteAccountName || "other side"})`;
  return base ? `${base}\n${ref}` : ref;
}

/** Recon owned entity → Note form "Link to" context. */
function reconciliationEntityTypeToNoteContext(entityType: string): string {
  switch (entityType) {
    case "bank":
      return "Bank/Cash";
    case "staff":
      return STAFF_ENTITY_LABEL;
    case "tax":
      return "Tax";
    case "expense":
      return "Expense";
    default:
      return "Party";
  }
}

/** Remote NOTE → owned company Note form fields (title, link to, entity, narration). */
function buildNoteSyncDraft(params: {
  remoteRow: ReconciliationLedgerRow;
  myCtx: ReconciliationSideContext;
  date: Date;
  narration: string;
  remoteVoucher?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const remoteTitle = String(params.remoteVoucher?.title || "").trim();
  const rowTitle = String(params.remoteRow.title || "").trim();
  const rowNarr = String(params.remoteRow.narration || "").trim();
  const title =
    remoteTitle ||
    rowTitle ||
    (rowNarr && rowNarr !== "-" ? rowNarr : "") ||
    "Note";

  const remoteContent = String(params.remoteVoucher?.content || "").trim();
  const content = remoteContent || params.narration;

  return {
    type: "note",
    defaultTab: "note",
    date: params.date,
    voucherNumber: "",
    title,
    content,
    context: reconciliationEntityTypeToNoteContext(params.myCtx.entityType),
    entityId: params.myCtx.accountId,
    amount: 0,
    total: 0,
  };
}

/** Entity + mirrored type → form field pre-fill */
function applyMyReconciliationAccountFields(
  ctx: ReconciliationSideContext,
  mirroredType: string
): Record<string, unknown> {
  const { entityType, accountId } = ctx;
  switch (entityType) {
    case "party":
      return { payeeType: "party", partyId: accountId };
    case "staff":
      return { payeeType: "staff", staffId: accountId };
    case "tax":
      return { payeeType: "tax", taxAccountId: accountId };
    case "bank":
      return { accountId };
    case "expense":
      if (mirroredType === "direct_income" || mirroredType === "payment_in") {
        return { payeeType: "income", incomeAccountId: accountId };
      }
      return { payeeType: "expense", expenseAccountId: accountId, toAccountId: accountId };
    default:
      return { payeeType: "party", partyId: accountId };
  }
}

/** Journal — remote Dr/Cr ka ulta apni reconciliation account line pe */
function buildJournalSyncDraft(
  remoteRow: ReconciliationLedgerRow,
  ctx: ReconciliationSideContext,
  mirroredType: string,
  amount: number,
  date: Date,
  narration: string
): Record<string, unknown> {
  const entityType = journalFormEntityType(reconciliationCollectionToEntityType(ctx.collection));
  const myLineType = mirroredAccountLineSideFromRemoteRow(remoteRow);
  const oppLineType = myLineType === "debit" ? "credit" : "debit";

  return {
    type: mirroredType,
    defaultTab: mirroredType,
    date,
    amount,
    total: amount,
    voucherNumber: "",
    narration,
    ...applyMyReconciliationAccountFields(ctx, mirroredType),
    entries: [
      {
        accountId: ctx.accountId,
        debit: myLineType === "debit" ? amount : 0,
        credit: myLineType === "credit" ? amount : 0,
      },
      {
        accountId: "",
        debit: oppLineType === "debit" ? amount : 0,
        credit: oppLineType === "credit" ? amount : 0,
      },
    ],
    lines: [
      {
        accountId: ctx.accountId,
        entityType,
        type: myLineType,
        amount,
        isAutoLine: false,
      },
      {
        accountId: "",
        entityType: "",
        type: oppLineType,
        amount, // opposite side balancing amount — user sirf account choose kare
        isAutoLine: true, // last line auto-rebalance jab pehli line amount change ho
      },
    ],
  };
}

export type BuildSyncVoucherDraftResult = {
  defaultTab: string;
  defaultVoucherData: Record<string, unknown>;
};

/**
 * Remote side snapshot row → apni company me naya opposite voucher draft.
 * Voucher number khali — form apni company ka next serial auto fetch karega.
 */
export function buildSyncVoucherDraftFromRemoteRow(params: {
  remoteRow: ReconciliationLedgerRow;
  share: ReconciliationShare;
  userId: string;
  companyId: string;
}): BuildSyncVoucherDraftResult | null {
  const { remoteRow, share, userId, companyId } = params;
  const myCtx = getMyReconciliationSideContext(share, userId, companyId);
  const remoteCtx = getRemoteReconciliationSideContext(share, userId, companyId);
  if (!myCtx?.accountId) return null;

  const mirroredType = mirrorReconciliationVoucherType(
    remoteRow.type,
    Number(remoteRow.debit) || 0,
    Number(remoteRow.credit) || 0
  );
  const amount = reconciliationRowAmount(remoteRow);
  const date = reconciliationRowDate(remoteRow);
  const narration = buildSyncNarration(remoteRow, remoteCtx?.accountName ?? "");

  const baseFields = applyMyReconciliationAccountFields(myCtx, mirroredType);
  const crossCopySourceRef =
    remoteCtx?.companyId && remoteRow.id
      ? { companyId: remoteCtx.companyId, voucherId: remoteRow.id }
      : undefined;

  if (mirroredType === "journal") {
    const draft = buildJournalSyncDraft(remoteRow, myCtx, mirroredType, amount, date, narration);
    const mySide = mirroredAccountLineSideFromRemoteRow(remoteRow);
    draft._journalFocusSide = mySide;
    if (crossCopySourceRef) draft.crossCopySourceRef = crossCopySourceRef;
    return { defaultTab: mirroredType, defaultVoucherData: draft };
  }

  if (mirroredType === "note") {
    const draft = buildNoteSyncDraft({ remoteRow, myCtx, date, narration });
    if (crossCopySourceRef) draft.crossCopySourceRef = crossCopySourceRef;
    return { defaultTab: "note", defaultVoucherData: draft };
  }

  const draft: Record<string, unknown> = {
    type: mirroredType,
    defaultTab: mirroredType,
    date,
    amount,
    total: amount,
    voucherNumber: "",
    narration,
    ...baseFields,
  };

  if (mirroredType === "sale" || mirroredType === "purchase") {
    draft.partyId = myCtx.accountId;
    draft.lineItems = [
      {
        type: "item",
        itemId: "",
        quantity: 1,
        rate: amount,
        unit: "",
        amount,
        taxAccountId: "",
        taxAmount: 0,
        isTaxInclusive: false,
        allowManualRate: true,
      },
    ];
    draft.subTotal = amount;
    draft.discount = 0;
    draft.tax = 0;
    if (mirroredType === "sale") draft.salesAccountId = "sales_account";
    else draft.purchaseAccountId = "purchase_account";
  }

  if (crossCopySourceRef) draft.crossCopySourceRef = crossCopySourceRef;

  return { defaultTab: mirroredType, defaultVoucherData: draft };
}

/**
 * Sync draft + remote voucher fetch — opposite party/account name se apni company me match.
 */
export async function buildSyncVoucherDraftFromRemoteRowAsync(params: {
  remoteRow: ReconciliationLedgerRow;
  share: ReconciliationShare;
  userId: string;
  companyId: string;
}): Promise<BuildSyncVoucherDraftResult | null> {
  const built = buildSyncVoucherDraftFromRemoteRow(params);
  if (!built) return null;

  const remoteCtx = getRemoteReconciliationSideContext(params.share, params.userId, params.companyId);
  if (!remoteCtx?.companyId || !remoteCtx.accountId || !params.remoteRow.id) return built;

  try {
    const remoteVoucher = await fetchVoucherForReconciliationEdit(remoteCtx.companyId, params.remoteRow.id);
    if (!remoteVoucher) return built;

    const mirroredType = built.defaultTab;

    if (mirroredType === "journal") {
      const myCtx = getMyReconciliationSideContext(params.share, params.userId, params.companyId);
      if (myCtx?.accountId) {
        const journalDraft = await buildJournalDraftFromRemoteVoucher({
          remoteVoucher,
          remoteRow: params.remoteRow,
          remoteCtx,
          myCtx,
          localCompanyId: params.companyId,
          date: reconciliationRowDate(params.remoteRow),
          narration: buildSyncNarration(params.remoteRow, remoteCtx.accountName ?? ""),
        });
        journalDraft._journalFocusSide = mirroredAccountLineSideFromRemoteRow(params.remoteRow);
        if (remoteCtx.companyId && params.remoteRow.id) {
          journalDraft.crossCopySourceRef = { companyId: remoteCtx.companyId, voucherId: params.remoteRow.id };
        }
        built.defaultVoucherData = journalDraft;
      }
      return built;
    }

    if (mirroredType === "note") {
      const myCtx = getMyReconciliationSideContext(params.share, params.userId, params.companyId);
      if (myCtx?.accountId) {
        const noteDraft = buildNoteSyncDraft({
          remoteRow: params.remoteRow,
          myCtx,
          date: reconciliationRowDate(params.remoteRow),
          narration: buildSyncNarration(params.remoteRow, remoteCtx.accountName ?? ""),
          remoteVoucher,
        });
        if (remoteCtx.companyId && params.remoteRow.id) {
          noteDraft.crossCopySourceRef = { companyId: remoteCtx.companyId, voucherId: params.remoteRow.id };
        }
        built.defaultVoucherData = noteDraft;
        built.defaultTab = "note";
      }
      return built;
    }

    // Remote PUR → owned Sale (inter-co mirror) — poora voucher: item, sales/purchase account, tax
    if (mirroredType === "sale" || mirroredType === "purchase") {
      const myCtx = getMyReconciliationSideContext(params.share, params.userId, params.companyId);
      if (myCtx?.accountId) {
        const spDraft = await buildSalePurchaseDraftFromRemoteVoucher({
          remoteVoucher,
          remoteRow: params.remoteRow,
          remoteCtx,
          myCtx,
          localCompanyId: myCtx.companyId,
          mirroredType,
          date: reconciliationRowDate(params.remoteRow),
          narration: buildSyncNarration(params.remoteRow, remoteCtx.accountName ?? ""),
        });
        if (remoteCtx.companyId && params.remoteRow.id) {
          spDraft.crossCopySourceRef = { companyId: remoteCtx.companyId, voucherId: params.remoteRow.id };
        }
        built.defaultVoucherData = spDraft;
        built.defaultTab = mirroredType;
      }
      return built;
    }

    // Payment types — opposite ref id se name match karke second field pre-fill
    const [remoteSnap, localSnap, remoteIcEntities, localIcEntities] = await Promise.all([
      loadJournalLedgerScopeSnapshot(remoteCtx.companyId),
      loadJournalLedgerScopeSnapshot(params.companyId),
      fetchInterCompanyEntitiesForCompany(remoteCtx.companyId),
      fetchInterCompanyEntitiesForCompany(params.companyId),
    ]);
    const remoteAccounts = buildAccountIndexFromIcAndSnap(remoteSnap, remoteIcEntities);
    const localAccounts = buildAccountIndexFromIcAndSnap(localSnap, localIcEntities);

    const oppositeRemoteId = collectOppositeReferenceIdsForCompare(remoteVoucher, remoteCtx.accountId)[0];
    if (!oppositeRemoteId) return built;

    const myCtx = getMyReconciliationSideContext(params.share, params.userId, params.companyId);
    if (!myCtx?.accountId) return built;

    const localAcc = mapRemoteAccountToLocal({
      remoteAccountId: String(oppositeRemoteId),
      remoteCtx,
      myCtx,
      remoteAccounts,
      localAccounts,
    });
    if (!localAcc) return built;

    applyOppositePaymentField(built.defaultVoucherData, localAcc, myCtx.accountId);
  } catch {
    /* fetch/match fail — base draft still open, user manually select kare */
  }

  return built;
}
