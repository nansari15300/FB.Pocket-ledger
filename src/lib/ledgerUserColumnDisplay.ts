/**
 * Party / account statement "User" column helpers.
 * Recurring BS-month vouchers `userDisplayName: "Auto"` + `recurringMeta` save hote hain — sirf wahi rows "Auto".
 * `userDisplayName === "Auto"` alone se recurring mat samjho (IC / manual rows flicker na karein).
 */
import { isRecurringAutoUserDisplayLabel } from "@/lib/interCompany/interCompanyVoucherHistory";

const BAD_USER_LIST_LABEL = new Set(["unknown", "n/a"]);

/** Khali / placeholder ko merge me "missing" maano taaki doosri source se naam aaye. */
export function isMeaningfulLedgerUserListLabel(s: string | undefined | null): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  if (isRecurringAutoUserDisplayLabel(t)) return false;
  return !BAD_USER_LIST_LABEL.has(t.toLowerCase());
}

/**
 * PartyDetails / GroupDetails: `useVouchers` se aaya `userNames` (voucher `userDisplayName` se "Auto" bhi) ko
 * `localFetchedUserNames` se upar rakho jab dono meaningful hon — warna pehle wala overwrite ho jata tha.
 */
export function mergeLedgerUserDisplayNameMaps(
  voucherSide: Record<string, string | undefined>,
  fetchedSide: Record<string, string | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set([...Object.keys(voucherSide || {}), ...Object.keys(fetchedSide || {})]);
  for (const k of keys) {
    const v = voucherSide[k];
    const f = fetchedSide[k];
    if (isMeaningfulLedgerUserListLabel(v)) out[k] = String(v).trim();
    else if (isMeaningfulLedgerUserListLabel(f)) out[k] = String(f).trim();
  }
  return out;
}

/** Admin Panel Company — cloud subscription mirror (sale / receipt). */
export function isAdminPanelSubscriptionMirrorVoucherForLedgerUserDisplay(t: unknown): boolean {
  const o = t as { kind?: string; systemGenerated?: boolean } | null | undefined;
  if (!o || typeof o !== "object") return false;
  if (o.systemGenerated !== true) return false;
  const kind = String(o.kind ?? "").trim();
  return kind === "subscription-payment" || kind === "subscription-receipt";
}

/** BS-month recurring auto row — User cell me scheduler ki jagah "Auto" (sirf `recurringMeta`). */
export function isRecurringBsMonthlyAutoVoucherForLedgerUserDisplay(t: unknown): boolean {
  const o = t as { recurringMeta?: { generationKind?: string } } | null | undefined;
  if (!o || typeof o !== "object") return false;
  return o.recurringMeta?.generationKind === "recurring_bs_monthly";
}

/** Enabled recurring templates se abhi active trigger voucher ids — dashboard "N vouchers triggering" jaisa. */
export function buildActiveRecurringTriggerVoucherIdSet(
  templates: ReadonlyArray<{ tpl: { cloneSourceVoucherId?: string | null; sourceVoucherId?: string | null } }>,
): Set<string> {
  const out = new Set<string>();
  for (const { tpl } of templates) {
    const id = String(tpl.cloneSourceVoucherId || tpl.sourceVoucherId || "").trim();
    if (id) out.add(id);
  }
  return out;
}

/**
 * Auto recurring switch: sirf wahi voucher jiska recurring ab ON / active trigger hai.
 * Purane auto-generated rows "Auto" dikhte hain par switch nahi — unka `isActiveTriggerSource` false
 * ya `activeTriggerSourceVoucherId` kisi naye voucher ki taraf point karta hai.
 */
export function isActiveRecurringTriggerVoucherForLedgerSwitch(t: unknown): boolean {
  const o = t as { id?: string; recurringMeta?: { isActiveTriggerSource?: boolean; activeTriggerSourceVoucherId?: string | null } } | null | undefined;
  if (!o || typeof o !== "object") return false;
  const meta = o?.recurringMeta;
  if (meta?.isActiveTriggerSource !== true) return false;
  const activeId = String(meta?.activeTriggerSourceVoucherId || "").trim();
  const id = String(o?.id || "").trim();
  return !!activeId && !!id && activeId === id;
}

/**
 * PC/web/EXE ledger User column — active trigger par hi green ON switch.
 * Templates milne par `cloneSourceVoucherId` source of truth (stale voucher meta par switch nahi).
 */
export function shouldShowAutoRecurringSwitchInLedgerUserCell(
  t: unknown,
  activeTriggerIds?: ReadonlySet<string> | null,
): boolean {
  const id = String((t as { id?: string })?.id || "").trim();
  if (activeTriggerIds && id) {
    return activeTriggerIds.has(id);
  }
  return isActiveRecurringTriggerVoucherForLedgerSwitch(t);
}

function isLocalLedgerUserId(uid: string): boolean {
  return uid === "local" || uid === "local_guest_user" || uid.startsWith("local:");
}

/** Raw ids (uid / pb_xxx / local:xxx / long random tokens) are not human names. */
function looksLikeRawLedgerUserId(label: string, uid: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (uid && t === uid) return true;
  if (/^(pb_|local:)/i.test(t) || t === "local" || t === "local_guest_user") return true;
  return t.length > 15 && /^[a-zA-Z0-9_-]+$/.test(t) && !t.includes(" ");
}

function ledgerUserEmailPrefix(email: unknown): string {
  const e = String(email ?? "").trim();
  const at = e.indexOf("@");
  return at > 0 ? e.slice(0, at).trim() : "";
}

/** `userNames` lookup tolerant of id shapes: uid, pb_<id>, <id>, local:<id>. */
function lookupLedgerUserNameInMap(uid: string, userNames?: Record<string, string> | null): string {
  if (!uid || !userNames) return "";
  const keys = [uid];
  if (uid.startsWith("pb_")) keys.push(uid.slice(3));
  else keys.push(`pb_${uid}`);
  if (uid.startsWith("local:")) keys.push(uid.slice(6));
  for (const k of keys) {
    const v = userNames[k] ? String(userNames[k]).trim() : "";
    if (isMeaningfulLedgerUserListLabel(v)) return v;
  }
  return "";
}

/** Ledger / mobile card User column — stable naam, "Auto" sirf recurring BS-month par. */
export function resolveLedgerTransactionUserDisplayName(
  transaction: Record<string, unknown> | null | undefined,
  userNames?: Record<string, string> | null,
  opts?: { currentUserUid?: string | null; currentUserDisplayName?: string | null }
): string {
  if (!transaction) return "N/A";
  if (isAdminPanelSubscriptionMirrorVoucherForLedgerUserDisplay(transaction)) return "Auto";
  if (isRecurringBsMonthlyAutoVoucherForLedgerUserDisplay(transaction)) return "Auto";

  const uid = String(transaction.userId || "").trim();
  const fromMap = lookupLedgerUserNameInMap(uid, userNames);
  if (isMeaningfulLedgerUserListLabel(fromMap)) return fromMap;

  const fromDoc = String(transaction.userDisplayName || transaction.userName || "").trim();
  if (isMeaningfulLedgerUserListLabel(fromDoc)) return fromDoc;

  const curUid = String(opts?.currentUserUid || "").trim();
  const curName = String(opts?.currentUserDisplayName || "").trim();
  if (uid && curUid && uid === curUid) {
    return curName || "You";
  }

  // Lazy repair for rows saved without `userDisplayName` (older save path): other name-ish fields on the doc.
  const fromCreatedByName = String(transaction.createdByName || "").trim();
  if (isMeaningfulLedgerUserListLabel(fromCreatedByName) && !looksLikeRawLedgerUserId(fromCreatedByName, uid)) {
    return fromCreatedByName;
  }
  const emailPrefix = ledgerUserEmailPrefix(transaction.userEmail);
  if (isMeaningfulLedgerUserListLabel(emailPrefix) && !looksLikeRawLedgerUserId(emailPrefix, uid)) {
    return emailPrefix;
  }
  const fromLastEditor = String(transaction.lastEditedByUserName || "").trim();
  if (isMeaningfulLedgerUserListLabel(fromLastEditor) && !looksLikeRawLedgerUserId(fromLastEditor, uid)) {
    return fromLastEditor;
  }

  // Local-company ids ("local", "local_guest_user", "local:<id>"): any local user entry in the names map.
  if (isLocalLedgerUserId(uid)) {
    const localHit =
      lookupLedgerUserNameInMap("local", userNames) || lookupLedgerUserNameInMap("local_guest_user", userNames);
    if (isMeaningfulLedgerUserListLabel(localHit)) return localHit;
  }
  return "N/A";
}
