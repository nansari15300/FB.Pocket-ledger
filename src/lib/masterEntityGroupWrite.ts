import { addDoc } from "@/lib/writeGateway/pbWrites";
import { collection, serverTimestamp } from "@/lib/pbCompat/firestore";
import type { Company } from "@/hooks/useCompany";
import { firestore } from "@/lib/plClientSession";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function createOneMasterEntityGroup(params: {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  name: string;
  parentId: string;
  collection: string;
  localIdPrefix: string;
  /** Optional other name (OCR / search). Omitted when empty. */
  aliasName?: string;
}): Promise<string> {
  const { company, companyId, userId, name, parentId, collection: coll, localIdPrefix } = params;
  const alias = String(params.aliasName ?? "").trim();
  const aliasField = alias ? { aliasName: alias } : {};
  if (apkEntityWriteUsesLocalSqliteMirror(company)) {
    const createdId = createLocalEntityId(localIdPrefix);
    const payload = {
      id: createdId,
      name: name.trim(),
      ownerId: userId,
      companyId,
      parentId,
      createdAt: new Date().toISOString(),
      isDeleted: false,
      ...aliasField,
    };
    await upsertCompanyDocInBrowserDb(companyId, coll, createdId, payload);
    await enqueueCompanyDocOutbox(companyId, coll, "create", createdId, payload);
    return createdId;
  }
  const docRef = await addDoc(collection(firestore, `companies/${companyId}/${coll}`), {
    name: name.trim(),
    ownerId: userId,
    companyId,
    parentId,
    createdAt: serverTimestamp(),
    isDeleted: false,
    ...aliasField,
  });
  return docRef.id;
}


export function sameGroupName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type MasterGroupLike = { id: string; name?: string; parentId?: string | null; isDeleted?: boolean };

const STOCK_ITEMS_ID = "stock_items";

export function mergeMasterGroups(
  ...lists: Array<readonly MasterGroupLike[] | null | undefined>
): MasterGroupLike[] {
  const byId = new Map<string, MasterGroupLike>();
  for (const list of lists) {
    for (const g of list ?? []) {
      if (!g?.id) continue;
      byId.set(g.id, g);
    }
  }
  return [...byId.values()];
}

function asMasterGroupLike(row: Record<string, unknown> & { id?: string }): MasterGroupLike | null {
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: String(row.name ?? ""),
    parentId: (row.parentId as string | null | undefined) ?? null,
    isDeleted: row.isDeleted === true,
  };
}

export async function listStoredItemGroups(companyId: string): Promise<MasterGroupLike[]> {
  if (!companyId) return [];
  try {
    const { listCompanyDocsFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    const rows = await listCompanyDocsFromBrowserDb(companyId, "item_groups");
    return (rows ?? []).map((r: Record<string, unknown> & { id?: string }) => asMasterGroupLike(r)).filter((g): g is MasterGroupLike => !!g);
  } catch {
    return [];
  }
}

function parentIsStockItemsLevel(parentId: string | null | undefined, groups: readonly MasterGroupLike[]): boolean {
  const p = String(parentId ?? "").trim();
  if (!p || p === STOCK_ITEMS_ID) return true;
  const parent = groups.find((g) => g.id === p);
  return !!parent && sameGroupName(String(parent.name ?? ""), "Stock Items");
}

function parentIsNamedSheet(parentId: string | null | undefined, groups: readonly MasterGroupLike[]): boolean {
  const p = String(parentId ?? "").trim();
  if (!p) return false;
  const parent = groups.find((g) => g.id === p);
  return !!parent && sameGroupName(String(parent.name ?? ""), "Sheet");
}

/**
 * Prefer a live group with the same name under parentId.
 * For "Sheet", also accept a match under Stock Items / any parent at that level.
 * For a size child, also accept a same-name child under another "Sheet" parent (do not create a second 3MM).
 * Never deletes or merges existing duplicates — returns the best existing row.
 */
export function findExistingMasterGroup(
  groups: readonly MasterGroupLike[],
  name: string,
  parentId?: string
): MasterGroupLike | undefined {
  const want = String(name ?? "").trim();
  if (!want) return undefined;
  const live = groups.filter((g) => !g.isDeleted && sameGroupName(String(g.name ?? ""), want));
  if (!live.length) return undefined;
  const wantParent = parentId != null ? String(parentId) : "";
  const underExact = wantParent ? live.find((g) => String(g.parentId ?? "") === wantParent) : undefined;
  if (underExact) return underExact;
  if (sameGroupName(want, "Sheet") || wantParent === STOCK_ITEMS_ID) {
    const atLevel = live.find((g) => parentIsStockItemsLevel(g.parentId, groups));
    if (atLevel) return atLevel;
  }
  if (wantParent) {
    const underSheet = live.find((g) => parentIsNamedSheet(g.parentId, groups));
    if (underSheet) return underSheet;
  }
  return live[0];
}

/** Find a user item group by name under a parent, or create it (PocketBase / local SQLite). */
export async function findOrCreateNamedItemGroup(params: {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  name: string;
  parentId: string;
  existing: readonly MasterGroupLike[];
}): Promise<string> {
  const stored = await listStoredItemGroups(params.companyId);
  const pool = mergeMasterGroups(params.existing, stored);
  const hit = findExistingMasterGroup(pool, params.name, params.parentId);
  if (hit) return hit.id;
  try {
    return await createOneMasterEntityGroup({
      company: params.company,
      companyId: params.companyId,
      userId: params.userId,
      name: params.name,
      parentId: params.parentId,
      collection: "item_groups",
      localIdPrefix: "item_group",
    });
  } catch (err) {
    const again = findExistingMasterGroup(mergeMasterGroups(pool, await listStoredItemGroups(params.companyId)), params.name, params.parentId);
    if (again) return again.id;
    throw err;
  }
}

/** Stock Items -> parent "Sheet" -> child size (e.g. 3.5MM). Reuses existing groups. Does not delete duplicates. */
export async function findOrCreateSheetSizeItemGroups(params: {
  company: Company | null | undefined;
  companyId: string;
  userId: string;
  size: string;
  existing: readonly MasterGroupLike[];
}): Promise<{ parentId: string; childId: string; groups: MasterGroupLike[] }> {
  const existing = mergeMasterGroups(params.existing, await listStoredItemGroups(params.companyId));
  const parentId = await findOrCreateNamedItemGroup({
    ...params,
    name: "Sheet",
    parentId: STOCK_ITEMS_ID,
    existing,
  });
  if (!existing.some((g) => g.id === parentId)) existing.push({ id: parentId, name: "Sheet", parentId: STOCK_ITEMS_ID });
  const childName = String(params.size ?? "").trim();
  const childId = await findOrCreateNamedItemGroup({
    ...params,
    name: childName,
    parentId,
    existing,
  });
  if (!existing.some((g) => g.id === childId)) existing.push({ id: childId, name: childName, parentId });
  return { parentId, childId, groups: existing };
}
