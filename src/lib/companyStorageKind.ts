import type { Company } from "@/hooks/useCompany";
import { isDriveCloudSyncLocalRegistryRow } from "@/lib/driveRestoredLocalCompany";
import { isCloudLinkedCompanyStorage, isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import {
  getPlServerContextGateId,
  isServerTabCompanyRow,
  isPlServerSharedCompanyRow,
} from "@/lib/plServerAccessContext";
import { isPlRemoteServerClientMode, isPlSharingServerPortOrigin } from "@/lib/plRemoteServerClient";
import { filterPackedMyCompanyRows, isPlServerPackedApp } from "@/lib/plServerPackedApp";

export type CompanyStorageRow = {
  id?: string;
  name?: string;
  ownerId?: string;
  ownerEmail?: string | null;
  storageOption?: string | null;
  syncPolicy?: string | null;
  syncedFromCloud?: boolean;
  isOwned?: boolean;
  isDeleted?: boolean;
  plServerShared?: boolean;
  plServerGateId?: string;
  plServerGateServerUrl?: string;
  plServerHostCompanyId?: string;
  authoritativeCompanyId?: string;
  localOnly?: boolean;
  firestoreSyncDisabled?: boolean;
  localPersistence?: string | null;
};

function hasPlServerGateMarker(c: CompanyStorageRow | null | undefined): boolean {
  if (!c) return false;
  return (
    String(c.plServerGateId ?? "").trim().length > 0 ||
    String(c.plServerGateServerUrl ?? "").trim().length > 0 ||
    String(c.plServerHostCompanyId ?? "").trim().length > 0
  );
}

/** Explicit SQLite-only local company marker. These rows must never be purged/mirrored as Firestore companies. */
export function isStrictLocalOnlyCompany(c: CompanyStorageRow | null | undefined): boolean {
  if (!c || isServerGateCompany(c)) return false;
  if (c.localOnly === true) return true;
  if (c.firestoreSyncDisabled === true) return true;
  if (String(c.localPersistence ?? "").toLowerCase().trim() === "sqlite") return true;
  return false;
}

/**
 * Device-local / offline company — explicit `storageOption: local` ya `syncPolicy: offline` Firestore mirror se pehle.
 * Selector + Danger Zone me galat "online" bucket rokne ke liye.
 */
export function isDeviceLocalCompany(c: CompanyStorageRow | null | undefined): boolean {
  if (!c) return false;
  // Cloud markers win over storageOption:"local" (demoted Online mirrors / PL mix).
  if (c.syncedFromCloud === true) return false;
  const so = String(c.storageOption ?? "").toLowerCase().trim();
  if (so === "firebase" || so === "drive") return false;
  if (String(c.syncPolicy ?? "").toLowerCase() === "online") return false;
  if (String((c as { authoritativeCompanyId?: string }).authoritativeCompanyId ?? "").trim()) return false;
  if (isStrictLocalOnlyCompany(c)) return true;
  if (so === "local") return true;
  if (String(c.syncPolicy ?? "").toLowerCase() === "offline") return true;
  return true;
}

/** Ledger read/write SQLite-only — device-local, server gate, offline sync (web dev + static + EXE/APK). */
export function companyRowUsesSqliteLedgerWrites(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  // Temporary kill-switch: online company bhi SQLite-first — Firestore ledger upload skip.
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  if (!c) return false;
  const so = String(c.storageOption ?? "").toLowerCase().trim();
  if (so === "local") return true;
  if (shouldReadLedgerFromSqliteOnly(c)) return true;
  if (isCloudLinkedCompanyStorage(c) && !isServerGateCompany(c)) return false;
  return isOfflineCompanyStorage(c) || isDeviceLocalCompany(c);
}

/** Host admin on sharing port (`:3001`) — server PC ki native SQLite companies. */
export function isPlServerOriginHostMode(): boolean {
  if (typeof window === "undefined") return false;
  return isPlSharingServerPortOrigin() && !isPlRemoteServerClientMode();
}

/**
 * PL server URL origin (`:3001`) par company picker Server tab — Firebase gate → Online jaisa.
 * Sharing port par jo bhi non-cloud company dikhe, woh Server tab me (Local me nahi).
 */
export function isServerOriginSelectorCompanyRow(
  c: CompanyStorageRow | null | undefined
): boolean {
  if (!c || typeof window === "undefined") return false;
  if (!isPlSharingServerPortOrigin()) return false;
  if (isCloudLinkedCompanyStorage(c)) return false;
  return true;
}

/**
 * Company picker Server tab — PL server delta mirror / gate share (hub :3000 ya sharing :3001).
 * Local tab sirf is device par banayi hui company — Firebase Online tab me.
 */
export function isServerSelectorCompanyRow(
  c: CompanyStorageRow | null | undefined,
  gateId?: string | null
): boolean {
  if (!c) return false;
  // Firebase/Drive Online rows must never land in Server — even when PL markers pollute the registry row.
  if (isCloudLinkedCompanyStorage(c)) return false;
  if (c.plServerShared === true && hasPlServerGateMarker(c)) return true;
  // Stamped PL share (`plServerShared`) — Local tab me kabhi mat dikhao (gate list id mismatch pe bhi).
  // Gate page already Server-only; company picker pehle `!gid` / share-list miss se Local me leak karta tha.
  if (isServerGateCompany(c)) return true;
  if (isServerOriginSelectorCompanyRow(c)) return true;
  const gid = gateId ?? getPlServerContextGateId();
  // Restored local backups can retain old PL-server markers. Without an active gate/context,
  // those SQLite rows are local companies, not server-share rows — but `isServerGateCompany`
  // already returned above when stamp present; remaining host-id hints need a gate.
  if (!gid) return false;
  if (isServerTabCompanyRow(c, gid)) return true;
  if (isPlServerSharedCompanyRow(c, gid)) return true;
  // Bare `plServerHostCompanyId` without shared stamp caused Online⇄Server flicker after hydrate.
  if (c.plServerShared === true && String(c.plServerHostCompanyId ?? "").trim()) return true;
  return false;
}

/** Company picker Local tab — device-local, Drive folder sync (server URL origin alag tab). */
export function isLocalSelectorCompanyRow(
  c: (CompanyStorageRow & {
    cloudSyncDriveFolderId?: unknown;
    cloudSyncEnabled?: unknown;
    cloudSyncProvider?: unknown;
    driveSharedJoin?: unknown;
  }) | null | undefined
): boolean {
  if (!c) return false;
  // Firebase / Firestore mirror — kabhi Local tab me mat dikhao (cloud sync off / PL marker pollution pe bhi).
  if (isCloudLinkedCompanyStorage(c)) return false;
  if (c.plServerShared === true || hasPlServerGateMarker(c)) return false;
  if (isServerGateCompany(c)) return false;
  if (isServerSelectorCompanyRow(c)) return false;
  if (isDeviceLocalCompany(c)) return true;
  if (isDriveCloudSyncLocalRegistryRow(c as Record<string, unknown>)) return true;
  if (String(c.cloudSyncDriveFolderId ?? "").trim()) return true;
  if ((c as { driveSharedJoin?: unknown }).driveSharedJoin === true) return true;
  return false;
}

/** Handover / Delete dropdown: cloud-synced company (Firestore row as source of truth for handover) */
export function isOnlineCompanyRow(c: Company): boolean {
  return !isLocalSelectorCompanyRow(c) && !isServerSelectorCompanyRow(c);
}

export function isSharedOnlineCompany(c: CompanyStorageRow | null | undefined): boolean {
  if (!c) return false;
  if (isServerSelectorCompanyRow(c)) return false;
  return !c.isOwned && !isLocalSelectorCompanyRow(c);
}

/** Shared local / Drive join — Local tab "Shared" section (server-gate alag tab me). */
export function isSharedLocalCompany(c: CompanyStorageRow | null | undefined): boolean {
  if (!c || c.isOwned) return false;
  if (isSharedOnlineCompany(c)) return false;
  if (isServerSelectorCompanyRow(c)) return false;
  return isLocalSelectorCompanyRow(c);
}

/**
 * PL server delta-sync mirror — `plServerShared` stamp (gate meta sync timing par optional).
 */
export function isServerGateCompany(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  if (c?.plServerShared !== true) return false;
  // Cloud-linked first: polluted PL markers must not reclassify Firebase companies as PL.
  if (c.syncedFromCloud === true) return false;
  const so = String(c.storageOption ?? "").toLowerCase().trim();
  if (so === "firebase" || so === "drive") return false;
  if (isCloudLinkedCompanyStorage(c)) return false;
  if (hasPlServerGateMarker(c)) return true;
  return true;
}

/**
 * SQLite-only ledger row — device-local ya server-gate mirrored.
 * Firebase writes, outbox flush, aur online mirror reconcile in par mat chalao.
 */
export function isPureLocalLedgerCompany(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  if (!c) return false;
  if (isServerGateCompany(c)) return true;
  if (isStrictLocalOnlyCompany(c)) return true;
  if (c.syncedFromCloud === true) return false;
  if (String(c.syncPolicy ?? "").toLowerCase() === "online") return false;
  if (String((c as { authoritativeCompanyId?: string }).authoritativeCompanyId ?? "").trim()) return false;
  return isDeviceLocalCompany(c);
}

/**
 * SQLite-only ledger by company row shape — selector Local/Online/Server tabs isi se decide hote hain.
 * Cloud data sync kill-switch is par apply mat karo (warna online companies Local tab me leak ho jati hain).
 */
export function isStructuralSqliteOnlyLedgerCompany(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  if (!c) return false;
  if (isServerGateCompany(c)) return true;
  if (isDriveCloudSyncLocalRegistryRow(c as Record<string, unknown>)) return true;
  if (String(c.syncPolicy ?? "").toLowerCase() === "offline") return true;
  return isPureLocalLedgerCompany(c);
}

/** Local / PL Server ledger — browser `blob:` / `data:` preview URLs persist ya UI me na dikhein. */
export function shouldStripTransientVoucherAttachmentUrls(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  return isStructuralSqliteOnlyLedgerCompany(c);
}

/**
 * Cross-company voucher copy: masters SQLite se padho (local / PL server / restore / cloud-sync off).
 * Registry row galat `syncedFromCloud` ho to bhi device ledger read ho.
 */
export function companyLedgerMastersReadableFromSqlite(
  c: (CompanyStorageRow & { plServerShared?: boolean; localRestoredFromBackupAt?: unknown }) | null | undefined
): boolean {
  if (!c) return false;
  if (isOfflineCompanyStorage(c)) return true;
  if (isStructuralSqliteOnlyLedgerCompany(c)) return true;
  if (isServerGateCompany(c)) return true;
  if (isDeviceLocalCompany(c)) return true;
  const restoredAt = (c as { localRestoredFromBackupAt?: unknown }).localRestoredFromBackupAt;
  if (typeof restoredAt === "number" && Number.isFinite(restoredAt) && restoredAt > 0) return true;
  return false;
}

/** Ledger read/write SQLite only — Firestore listeners / pull skip (local restore, device-local). */
export function shouldReadLedgerFromSqliteOnly(
  c: (CompanyStorageRow & { plServerShared?: boolean }) | null | undefined
): boolean {
  // Temporary kill-switch: ledger I/O SQLite — company picker tab classification alag (`isStructuralSqliteOnlyLedgerCompany`).
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  return isStructuralSqliteOnlyLedgerCompany(c);
}

export type CompanyListTab = "local" | "online" | "server";

export type SelectorCompanyBuckets = {
  localOwnedCompanies: Company[];
  sharedLocalCompanies: Company[];
  serverSharedCompanies: Company[];
  cloudOwnedCompanies: Company[];
  sharedCloudCompanies: Company[];
  localTabCompanies: Company[];
  onlineTabCompanies: Company[];
  serverTabCompanies: Company[];
};

function dedupeCompaniesById(companies: Company[]): Company[] {
  return companies.filter((c): c is Company => c != null && Boolean(String(c?.id ?? "").trim()));
}

/**
 * Unlock credential dialog: Local tab me sirf explicit device-local / Drive rows.
 * Missing `storageOption` wali Firestore mirror rows ko online bucket me rakho.
 */
export function isStrictLocalUnlockTabCompany(
  c: (CompanyStorageRow & { cloudSyncDriveFolderId?: unknown; driveSharedJoin?: unknown }) | null | undefined
): boolean {
  if (!c || isCloudLinkedCompanyStorage(c)) return false;
  if (isServerGateCompany(c)) return false;
  if (isServerSelectorCompanyRow(c)) return false;
  if (isSharedOnlineCompany(c)) return false;
  if (isStrictLocalOnlyCompany(c)) return true;
  if (isDriveCloudSyncLocalRegistryRow(c as Record<string, unknown>)) return true;
  if (String(c.cloudSyncDriveFolderId ?? "").trim()) return true;
  if ((c as { driveSharedJoin?: unknown }).driveSharedJoin === true) return true;
  const so = String(c.storageOption ?? "").toLowerCase().trim();
  if (so === "local") return true;
  if (String(c.syncPolicy ?? "").toLowerCase() === "offline") return true;
  return false;
}

/** Credential popup — strict Local/Online split; company picker partition jaisa hi warna online Local me leak. */
export function partitionCompaniesForUnlockDialog(companies: Company[]): SelectorCompanyBuckets {
  const base = partitionCompaniesForSelector(companies);
  const misplaced = base.localTabCompanies.filter((c) => !isStrictLocalUnlockTabCompany(c));
  const localTabCompanies = base.localTabCompanies.filter((c) => isStrictLocalUnlockTabCompany(c));
  const onlineTabCompanies = dedupeCompaniesById([...base.onlineTabCompanies, ...misplaced]);
  const localOwnedCompanies = localTabCompanies.filter((c) => c.isOwned);
  const sharedLocalCompanies = localTabCompanies.filter((c) => isSharedLocalCompany(c));
  return {
    ...base,
    localOwnedCompanies,
    sharedLocalCompanies,
    localTabCompanies,
    onlineTabCompanies,
  };
}

/** Mutual-exclusive Local vs Online buckets for company picker / settings dropdowns. */
export function partitionCompaniesForSelector(companies: Company[]): SelectorCompanyBuckets {
  const rows = dedupeCompaniesById(companies.filter((c): c is Company => c != null && Boolean(c?.id)));
  if (isPlServerPackedApp()) {
    const packed = filterPackedMyCompanyRows(rows);
    return {
      localOwnedCompanies: [],
      sharedLocalCompanies: [],
      serverSharedCompanies: packed,
      cloudOwnedCompanies: [],
      sharedCloudCompanies: [],
      localTabCompanies: [],
      onlineTabCompanies: [],
      serverTabCompanies: packed,
    };
  }
  const gateId = getPlServerContextGateId();
  const owned = rows.filter((c) => c.isOwned);
  const nonServerRows = rows.filter((c) => !isServerSelectorCompanyRow(c, gateId));
  const nonServerOwned = owned.filter((c) => !isServerSelectorCompanyRow(c, gateId));
  const localOwnedCompanies = owned.filter((c) => isLocalSelectorCompanyRow(c));
  const cloudOwnedCompanies = nonServerOwned.filter((c) => !isLocalSelectorCompanyRow(c));
  const sharedCloudCompanies = nonServerRows.filter((c) => isSharedOnlineCompany(c));
  const serverSharedCompanies = rows.filter((c) => isServerSelectorCompanyRow(c, gateId));
  const sharedLocalCompanies = rows.filter((c) => isSharedLocalCompany(c));
  const localTabCompanies = dedupeCompaniesById([
    ...localOwnedCompanies.filter((c) => !isServerSelectorCompanyRow(c, gateId)),
    ...sharedLocalCompanies.filter((c) => !isServerSelectorCompanyRow(c, gateId)),
  ]);
  const onlineTabCompanies = dedupeCompaniesById([...cloudOwnedCompanies, ...sharedCloudCompanies]);
  const serverTabCompanies = dedupeCompaniesById([...serverSharedCompanies]);
  return {
    localOwnedCompanies,
    sharedLocalCompanies,
    serverSharedCompanies,
    cloudOwnedCompanies,
    sharedCloudCompanies,
    localTabCompanies,
    onlineTabCompanies,
    serverTabCompanies,
  };
}

/** CompanySelector `selectorCompanies` — drop server-gate rows before partition. */
export function filterCompaniesForSelectorPartition(companies: Company[]): Company[] {
  return dedupeCompaniesById(
    companies.filter((c): c is Company => c != null && Boolean(c?.id) && !c.isDeleted)
  ).filter((c) => !isServerGateCompany(c));
}

/** CompanySelector Online tab — same post-partition filter. */
export function filterOnlineTabCompaniesForSelector(companies: Company[]): Company[] {
  return companies.filter((c) => !isServerSelectorCompanyRow(c));
}

export function defaultSelectorTab(
  companyId: string | null | undefined,
  buckets: SelectorCompanyBuckets
): CompanyListTab {
  const id = companyId?.trim();
  if (id) {
    if (buckets.serverTabCompanies.some((c) => c.id === id)) return "server";
    const localHit = buckets.localTabCompanies.find((c) => c.id === id);
    if (localHit && isServerGateCompany(localHit)) return "server";
    if (localHit) return "local";
    if (buckets.onlineTabCompanies.some((c) => c.id === id)) return "online";
  }
  if (
    buckets.serverTabCompanies.length > 0 &&
    (isPlSharingServerPortOrigin() || isPlRemoteServerClientMode() || getPlServerContextGateId())
  ) {
    return "server";
  }
  if (buckets.localTabCompanies.length > 0) return "local";
  if (buckets.serverTabCompanies.length > 0) return "server";
  return "online";
}

/** Selected company sirf sahi tab me add — local ko online list me mat chipkao. */
export function ensureSelectedInTabList(
  list: Company[],
  selectedId: string | null | undefined,
  pool: Company[],
  tab: CompanyListTab
): Company[] {
  const id = selectedId?.trim();
  if (!id || list.some((c) => c.id === id)) return list;
  const selected = pool.find((c) => c.id === id);
  if (!selected) return list;
  const gateId = getPlServerContextGateId();
  if (tab === "server" && (isServerGateCompany(selected) || isServerSelectorCompanyRow(selected, gateId))) {
    return [selected, ...list];
  }
  if (tab === "local" && isLocalSelectorCompanyRow(selected) && isStrictLocalUnlockTabCompany(selected)) {
    return [selected, ...list];
  }
  if (tab === "online" && !isLocalSelectorCompanyRow(selected) && !isServerSelectorCompanyRow(selected, gateId)) {
    return [selected, ...list];
  }
  if (tab === "online" && isSharedOnlineCompany(selected)) return [selected, ...list];
  return list;
}

/** Web/dev: SQLite device-local row ko online mirror flags se overwrite mat karo. */
export function stampPureLocalDeviceCompanyRow<T extends CompanyStorageRow>(c: T): T {
  if (!c || isServerGateCompany(c)) return c;
  if (!isDeviceLocalCompany(c)) return c;
  return {
    ...c,
    localOnly: true,
    localPersistence: "sqlite",
    firestoreSyncDisabled: true,
    storageOption: "local",
    syncedFromCloud: false,
    syncPolicy: "offline",
  } as T;
}

/** Owned companies for settings (delete / handover) — registry + filtered list merge. */
export function mergeOwnedCompaniesForUser(
  lists: Company[][],
  user: { uid: string; email: string | null } | null | undefined,
  resolveOwned: (c: Company, user: { uid: string; email: string | null }) => boolean
): Company[] {
  const byId = new Map<string, Company>();
  if (!user?.uid) return [];
  for (const list of lists) {
    for (const c of list) {
      if (!c?.id || c.isDeleted) continue;
      if ((c as Company & { movedToAdminRecycleAt?: unknown }).movedToAdminRecycleAt != null) continue;
      if (!resolveOwned(c, user)) continue;
      byId.set(c.id, { ...c, isOwned: true });
    }
  }
  return Array.from(byId.values());
}

/** Same naam do companies par ho to Select me id se alag dikhao */
export function buildDuplicateNameCountMap(companies: { name?: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of companies) {
    const k = (c.name || "").trim().toLowerCase();
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function companySelectOptionLabel(c: Company, duplicateNameCountMap: Map<string, number>): string {
  const k = (c.name || "").trim().toLowerCase();
  const dup = (duplicateNameCountMap.get(k) || 0) > 1;
  return dup ? `${c.name} · ${String(c.id).slice(0, 8)}…` : (c.name || "");
}
