import { setDoc } from "@/lib/writeGateway/pbWrites";
import { collection, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import { apkCloudCompanyOfflineViewOnly, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { baseUnitConversions, normalizeItemUnitName } from "@/components/items/itemUnitPrices";

export function createLocalItemId(prefix = "item"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function itemNamesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const y = String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!x && x === y;
}

export function findExistingItemByName(
  items: readonly { id: string; name?: string; isDeleted?: boolean }[] | undefined,
  name: string
): { id: string; name?: string } | undefined {
  const want = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!want) return undefined;
  return (items ?? []).find((it) => !it.isDeleted && itemNamesMatch(it.name, want));
}

/** Persist a new item row (local SQLite mirror + outbox, or PocketBase). Does not open UI. */
export async function writeNewItemRecord(opts: {
  company: Company | null | undefined;
  companyId: string;
  payload: Record<string, unknown>;
  id?: string;
}): Promise<string> {
  const { company, companyId, payload } = opts;
  if (apkEntityWriteUsesLocalSqliteMirror(company)) {
    const id = opts.id || String(payload.id ?? "") || createLocalItemId("item");
    const body = {
      ...payload,
      id,
      companyId,
      createdAt: payload.createdAt ?? new Date().toISOString(),
      isDeleted: payload.isDeleted ?? false,
    };
    await upsertCompanyDocInBrowserDb(companyId, "items", id, body);
    await enqueueCompanyDocOutbox(companyId, "items", "create", id, body);
    return id;
  }
  const col = collection(firestore, `companies/${companyId}/items`);
  const itemRef = opts.id ? doc(col, opts.id) : doc(col);
  const data: Record<string, unknown> = { ...payload, companyId: payload.companyId ?? companyId };
  delete data.id;
  if (data.createdAt == null) data.createdAt = serverTimestamp();
  if (data.isDeleted == null) data.isDeleted = false;
  await setDoc(itemRef, data);
  return itemRef.id;
}

export type SilentItemCreateInput = {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  name: string;
  type?: "item" | "service" | "finished_good";
  groupId?: string | null;
  purchasePrice?: number;
  salePrice?: number;
  purchasePriceUnit?: string | null;
  salePriceUnit?: string | null;
  unitConversions?: unknown[];
  purchaseTaxId?: string | null;
  saleTaxId?: string | null;
  existingItems?: readonly { id: string; name?: string; isDeleted?: boolean }[];
  /** navigator.onLine; defaults to true when unknown. */
  online?: boolean;
};

export type SilentItemCreateResult =
  | { ok: true; id: string; reused: boolean }
  | { ok: false; reason: "offline" | "auth" | "failed"; message: string };

/** Create an item without the form, or reuse an existing live item with the same name. No recycle-bin modal. */
export async function createItemSilent(input: SilentItemCreateInput): Promise<SilentItemCreateResult> {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!input.companyId || !input.userId) {
    return { ok: false, reason: "auth", message: "You must be logged in and have a company selected." };
  }
  if (!name || name.length < 2) {
    return { ok: false, reason: "failed", message: "Item name must be at least 2 characters." };
  }
  const online = input.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  if (apkCloudCompanyOfflineViewOnly(input.company, online)) {
    return { ok: false, reason: "offline", message: "Offline - view only. Connect to the internet to create an item." };
  }
  const existing = findExistingItemByName(input.existingItems, name);
  if (existing) return { ok: true, id: existing.id, reused: true };
  try {
    const unit = normalizeItemUnitName(input.purchasePriceUnit || input.salePriceUnit) || null;
    const unitConversions = baseUnitConversions(unit, Array.isArray(input.unitConversions) ? (input.unitConversions as { fromUnit?: string; toUnit?: string; conversionFactor?: number }[]) : []);
    const id = await writeNewItemRecord({
      company: input.company,
      companyId: input.companyId,
      payload: {
        name,
        aliasName: "",
        type: input.type ?? "item",
        hsCode: null,
        ownerId: input.userId,
        companyId: input.companyId,
        groupId: input.groupId || null,
        salePrice: Number(input.salePrice ?? 0) || 0,
        purchasePrice: Number(input.purchasePrice ?? 0) || 0,
        openingBalance: 0,
        openingBalanceUnit: unit,
        openingBalanceTaxId: null,
        isOpeningBalanceTaxInclusive: false,
        openingBalanceDate: null,
        openingBalanceRate: 0,
        unitConversions,
        fileUrls: [],
        openingBalanceNarration: null,
        debit: 0,
        credit: 0,
        balance: 0,
        stockQty: 0,
        salePriceUnit: normalizeItemUnitName(input.salePriceUnit) || unit,
        purchasePriceUnit: normalizeItemUnitName(input.purchasePriceUnit) || unit,
        saleTaxId: input.saleTaxId || null,
        purchaseTaxId: input.purchaseTaxId || null,
        isPurchasePriceTaxInclusive: false,
        isSalePriceTaxInclusive: false,
        isDeleted: false,
      },
    });
    return { ok: true, id, reused: false };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : "Item could not be saved." };
  }
}