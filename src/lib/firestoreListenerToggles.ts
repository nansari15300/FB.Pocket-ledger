"use client";

import { FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT } from "@/lib/firebaseLedgerSyncMode";
import { readCachedGlobalSyncModeSettings } from "@/lib/globalSyncModeSettings";

export const FIRESTORE_LISTENER_TOGGLES_EVENT = "pl-firestore-listener-toggles";
const STORAGE_KEY = "pl_firestore_listener_toggles_v1";

export type FirestoreListenerTab = "live" | "delta";

export type FirestoreListenerDef = {
  id: string;
  tab: FirestoreListenerTab;
  label: string;
  hint: string;
  collectionPath?: string;
};

/** Live mode: one Firestore collection onSnapshot each. */
export const LIVE_FIRESTORE_LISTENERS: FirestoreListenerDef[] = [
  { id: "live.vouchers", tab: "live", label: "Vouchers", hint: "Sale, purchase, payment, journal…", collectionPath: "vouchers" },
  { id: "live.parties", tab: "live", label: "Parties", hint: "Party master list", collectionPath: "parties" },
  { id: "live.groups", tab: "live", label: "Party groups", hint: "Party group list", collectionPath: "groups" },
  { id: "live.staff", tab: "live", label: "Staff", hint: "Staff master list", collectionPath: "staff" },
  { id: "live.staff_groups", tab: "live", label: "Staff groups", hint: "Staff group list", collectionPath: "staff_groups" },
  { id: "live.bank_accounts", tab: "live", label: "Bank / Cash", hint: "Bank and cash accounts", collectionPath: "bank_accounts" },
  { id: "live.account_groups", tab: "live", label: "Bank groups", hint: "Bank/cash groups", collectionPath: "account_groups" },
  { id: "live.taxes", tab: "live", label: "Tax", hint: "Tax master list", collectionPath: "taxes" },
  { id: "live.tax_groups", tab: "live", label: "Tax groups", hint: "Tax group list", collectionPath: "tax_groups" },
  { id: "live.items", tab: "live", label: "Items", hint: "Items and services", collectionPath: "items" },
  { id: "live.item_groups", tab: "live", label: "Item groups", hint: "Item group list", collectionPath: "item_groups" },
  { id: "live.expense_accounts", tab: "live", label: "Income & expense", hint: "Expense / income accounts", collectionPath: "expense_accounts" },
  { id: "live.expense_groups", tab: "live", label: "Expense groups", hint: "Expense group list", collectionPath: "expense_groups" },
];

/** Delta mode: one change-diary listener. */
export const DELTA_FIRESTORE_LISTENERS: FirestoreListenerDef[] = [
  {
    id: "delta.change_log",
    tab: "delta",
    label: "Change log",
    hint: "Only _pl_change_log. Other company lists stay on SQLite until a change line arrives.",
    collectionPath: "_pl_change_log",
  },
];

export const ALL_FIRESTORE_LISTENERS: FirestoreListenerDef[] = [
  ...LIVE_FIRESTORE_LISTENERS,
  ...DELTA_FIRESTORE_LISTENERS,
];

const PATH_TO_ID = new Map(
  ALL_FIRESTORE_LISTENERS.filter((l) => l.collectionPath).map((l) => [l.collectionPath as string, l.id])
);

export function adminSyncModeTab(): FirestoreListenerTab {
  return readCachedGlobalSyncModeSettings().mode === "local" ? "delta" : "live";
}

type ToggleMap = Record<string, boolean>;

function readMap(): ToggleMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ToggleMap;
  } catch {
    return {};
  }
}

function writeMap(next: ToggleMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(FIRESTORE_LISTENER_TOGGLES_EVENT));
  window.dispatchEvent(new CustomEvent(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, { detail: { source: "listener-toggles" } }));
}

export function isFirestoreListenerEnabled(id: string): boolean {
  const map = readMap();
  if (Object.prototype.hasOwnProperty.call(map, id)) return map[id] !== false;
  return true;
}

export function isLiveCollectionListenerEnabled(collectionPath: string): boolean {
  const id = PATH_TO_ID.get(collectionPath);
  if (!id) return true;
  return isFirestoreListenerEnabled(id);
}

export function setFirestoreListenerEnabled(id: string, enabled: boolean): void {
  const map = readMap();
  map[id] = enabled;
  writeMap(map);
}
