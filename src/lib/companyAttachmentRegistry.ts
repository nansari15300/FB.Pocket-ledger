"use client";

/**
 * Firebase Storage attachment helpers.
 * Default reuse model = copy-as-new upload (see attachmentReuseCopyAsNewEnabled).
 * Registry ref-count still helps cleanup of *legacy* shared URLs and permanent-delete safety.
 */
import { runTransaction, setDoc } from "@/lib/writeGateway/pbWrites";
import { collection, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { ref, deleteObject, getBlob } from "@/lib/pocketbaseData/pbStorage";
import { firestore, storage } from "@/lib/firebase";
import { companyAttachmentRegistryEnabled } from "@/lib/firebaseBillingOptimization";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { uploadFileClient } from "@/lib/storageClient";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { isLocalFileRef } from "@/lib/localPendingFiles";

/** Same Storage object even if download token / encoding differs. */
export function attachmentPersistableRefsMatch(a: string, b: string): boolean {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (isLocalFileRef(x) || isLocalFileRef(y) || isDriveFileRef(x) || isDriveFileRef(y)) {
    return x === y;
  }
  const px = tryGetStoragePathFromFirebaseDownloadUrl(x);
  const py = tryGetStoragePathFromFirebaseDownloadUrl(y);
  if (px && py && px === py) return true;
  const stripToken = (u: string): string => {
    try {
      const url = new URL(u);
      url.searchParams.delete("token");
      url.searchParams.delete("alt");
      return url.href;
    } catch {
      return u.split("?")[0] || u;
    }
  };
  return stripToken(x) === stripToken(y);
}

type RegistryRow = {
  url: string;
  storagePath?: string | null;
  refCount: number;
  updatedAt?: unknown;
};

/** Session hints — local / Drive / pre-save paste pe badge + delete guard (Firestore registry ke bina). */
const sessionReuseHints = new Map<string, number>();
/** First place that owned this URL in this browser session (hold-copy source). */
const sessionOriginHints = new Map<string, string>();

function sessionReuseUrlKey(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  const path = tryGetStoragePathFromFirebaseDownloadUrl(u);
  return path || u;
}

function sessionReuseKey(companyId: string, url: string): string {
  return `${String(companyId || "").trim()}::${sessionReuseUrlKey(url)}`;
}

/** Prefer Firestore id so paste/badge/count share one key across local↔online ids. */
async function normalizeCompanyIdForReuse(companyId: string): Promise<string> {
  const cid = String(companyId || "").trim();
  if (!cid) return cid;
  try {
    const { resolveAuthoritativeFirestoreCompanyId } = await import(
      "@/lib/resolveAuthoritativeFirestoreCompanyId"
    );
    return String((await resolveAuthoritativeFirestoreCompanyId(cid)) || "").trim() || cid;
  } catch {
    return cid;
  }
}

async function companyIdsForAttachmentScan(companyId: string): Promise<string[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const ids = new Set<string>([cid]);
  try {
    const fsId = await normalizeCompanyIdForReuse(cid);
    if (fsId) ids.add(fsId);
  } catch {
    /* keep cid */
  }
  try {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    const auth = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || "").trim();
    if (auth) ids.add(auth);
  } catch {
    /* keep cid */
  }
  return [...ids];
}

function isCountableAttachmentRef(url: string): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  return (
    u.startsWith("http://") ||
    u.startsWith("https://") ||
    isLocalFileRef(u) ||
    isDriveFileRef(u)
  );
}

export const ATTACHMENT_REUSE_COUNT_EVENT = "pl-attachment-reuse-count";

/**
 * Paste/reuse — session floor = SQLite live + new links.
 * Persistable link paste always means ≥2 places (source + target).
 */
export async function bumpAttachmentReuseSessionHint(
  companyId: string,
  url: string,
  by = 1
): Promise<void> {
  const cid = await normalizeCompanyIdForReuse(companyId);
  const u = String(url || "").trim();
  if (!cid || !isCountableAttachmentRef(u)) return;
  const key = sessionReuseKey(cid, u);
  const prev = sessionReuseHints.get(key) || 0;
  let live = 0;
  try {
    live = await countAttachmentUsageInCompany(cid, u);
  } catch {
    live = 0;
  }
  const delta = Math.max(1, by);
  // live miss (race) par bhi paste/reuse = kam se kam 2 jagah.
  const next = Math.max(prev + delta, live + delta, 2);
  sessionReuseHints.set(key, next);
  broadcastAttachmentReuseCount(cid, u, next);
  // Also notify under the raw id so FilePreview listeners match either key.
  const raw = String(companyId || "").trim();
  if (raw && raw !== cid) broadcastAttachmentReuseCount(raw, u, next);
}

export function getAttachmentReuseSessionHint(companyId: string, url: string): number {
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!raw || !u) return 0;
  const direct = Math.max(0, sessionReuseHints.get(sessionReuseKey(raw, u)) || 0);
  // sync path may have written under authoritative id only
  return direct;
}

export async function getAttachmentReuseSessionHintAsync(
  companyId: string,
  url: string
): Promise<number> {
  const cid = await normalizeCompanyIdForReuse(companyId);
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!u) return 0;
  return Math.max(
    raw ? sessionReuseHints.get(sessionReuseKey(raw, u)) || 0 : 0,
    cid ? sessionReuseHints.get(sessionReuseKey(cid, u)) || 0 : 0
  );
}

/** Form se ek jagah URL hata — session count −1 (live floor keep). */
export async function noteAttachmentUnlinkedInUi(
  companyId: string,
  url: string
): Promise<number> {
  const cid = await normalizeCompanyIdForReuse(companyId);
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!cid || !isCountableAttachmentRef(u)) return 0;
  const live = await countAttachmentUsageInCompany(cid, u);
  const prev = Math.max(
    getAttachmentReuseSessionHint(cid, u),
    raw ? getAttachmentReuseSessionHint(raw, u) : 0
  );
  const next = Math.max(live, Math.max(0, prev - 1));
  for (const id of new Set([cid, raw].filter(Boolean))) {
    const key = sessionReuseKey(id, u);
    if (next <= 0) sessionReuseHints.delete(key);
    else sessionReuseHints.set(key, next);
    broadcastAttachmentReuseCount(id, u, next);
  }
  return next;
}

function broadcastAttachmentReuseCount(companyId: string, url: string, count: number): void {
  if (typeof window === "undefined") return;
  try {
    invalidateAttachmentUsagePlacesCache(companyId, url);
    window.dispatchEvent(
      new CustomEvent(ATTACHMENT_REUSE_COUNT_EVENT, {
        detail: { companyId, url, count },
      })
    );
  } catch {
    /* ignore */
  }
}

function registryCollection(companyId: string) {
  return collection(firestore, `companies/${companyId}/attachment_registry`);
}

function registryDocId(url: string): string {
  const key = url.trim();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `r_${h.toString(36)}_${key.length}`;
}

function isRegistryEligibleHttpsUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith("http://") || u.startsWith("https://");
}

async function registryEnabledForCompany(companyId: string): Promise<boolean> {
  if (!companyAttachmentRegistryEnabled()) return false;
  // Quota/billing pause: skip every Firestore registry read/transaction (they fail with resource-exhausted and
  // retry for seconds). Registry is advisory; local usage scan decides deletes.
  try {
    const { isServerQuotaHoldActive } = await import("@/lib/serverQuotaHold");
    if (isServerQuotaHoldActive()) return false;
  } catch {
    /* ignore */
  }
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (reg && isOfflineCompanyStorage(reg as { storageOption?: string })) return false;
  return true;
}

export async function registerFirebaseAttachmentRef(
  companyId: string,
  url: string,
  initialRefCount = 1
): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const trimmed = url.trim();
  if (!isRegistryEligibleHttpsUrl(trimmed)) return;
  const storagePath = tryGetStoragePathFromFirebaseDownloadUrl(trimmed);
  const refDoc = doc(registryCollection(companyId), registryDocId(trimmed));
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(refDoc);
    if (snap.exists()) {
      const prev = (snap.data() as RegistryRow).refCount ?? 0;
      tx.update(refDoc, {
        refCount: Math.max(prev, 0) + Math.max(1, initialRefCount),
        url: trimmed,
        storagePath: storagePath ?? null,
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.set(refDoc, {
        url: trimmed,
        storagePath: storagePath ?? null,
        refCount: Math.max(1, initialRefCount),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** Reuse picker / IC link — increment before voucher save. */
export async function linkFirebaseAttachmentRefs(companyId: string, urls: string[]): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const uniq = [...new Set(urls.map((u) => u.trim()).filter(isRegistryEligibleHttpsUrl))];
  await Promise.all(uniq.map((url) => registerFirebaseAttachmentRef(companyId, url, 1)));
}

/** Voucher reuse — Firebase HTTPS refs + `drive:` / `local:` (same-company link, no re-upload). */
export async function linkCloudAttachmentRefs(companyId: string, urls: string[]): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const countable = urls.map((u) => u.trim()).filter(isCountableAttachmentRef);
  for (const url of countable) {
    await bumpAttachmentReuseSessionHint(cid, url, 1);
  }
  const https = countable.filter(isRegistryEligibleHttpsUrl);
  if (https.length > 0) await linkFirebaseAttachmentRefs(cid, https);
}

/**
 * Company-wide kitni documents is URL/ref use karti hain (distinct place).
 * https / local: / drive: — online + local + PL + Drive.
 */
export async function countAttachmentUsageInCompany(
  companyId: string,
  url: string
): Promise<number> {
  const places = await listAttachmentUsagePlacesInCompany(companyId, url);
  return places.length;
}

function coerceDocTimeMs(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object") {
    const o = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === "function") {
      try {
        const t = o.toMillis();
        return Number.isFinite(t) ? t : 0;
      } catch {
        /* ignore */
      }
    }
    const sec = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null;
    if (sec != null && Number.isFinite(sec)) return sec * 1000;
  }
  return 0;
}

function rowEarliestMs(row: Record<string, unknown>): number {
  // Attachment origin = pehli attachment place — NOT voucher business `date`
  // (warna purani sale-date wale voucher pe green galat lagta hai).
  for (const c of [row.createdAt, row.lastEditedAt, row.updatedAt]) {
    const ms = coerceDocTimeMs(c);
    if (ms > 0) return ms;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Green badge = pehli jagah jahan yeh URL lagi (master ya voucher) — earliest `atMs`. */
export function pickAttachmentReuseOriginPlaceKey(
  places: readonly AttachmentUsagePlace[]
): string | null {
  if (!places.length) return null;
  const sorted = [...places].sort(
    (a, b) => a.atMs - b.atMs || a.placeKey.localeCompare(b.placeKey)
  );
  return sorted[0]?.placeKey ?? null;
}

export type AttachmentUsagePlace = { placeKey: string; atMs: number };

const PLACES_CACHE_TTL_MS = 20_000;
const placesListCache = new Map<string, { at: number; places: AttachmentUsagePlace[] }>();
const placesListInflight = new Map<string, Promise<AttachmentUsagePlace[]>>();

function placesListCacheKey(companyId: string, url: string): string {
  return `${String(companyId || "").trim()}::${sessionReuseUrlKey(url)}`;
}

function invalidateAttachmentUsagePlacesCache(companyId?: string, url?: string): void {
  const cid = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!cid && !u) {
    placesListCache.clear();
    return;
  }
  if (cid && u) {
    placesListCache.delete(placesListCacheKey(cid, u));
    return;
  }
  const urlPart = u ? `::${sessionReuseUrlKey(u)}` : "";
  for (const key of [...placesListCache.keys()]) {
    if (cid && key.startsWith(`${cid}::`)) placesListCache.delete(key);
    else if (urlPart && key.endsWith(urlPart)) placesListCache.delete(key);
  }
}

/** Public: rewrite / recompress ke baad places cache bust. */
export function invalidateAttachmentUsagePlacesCacheForCompany(
  companyId?: string,
  url?: string
): void {
  invalidateAttachmentUsagePlacesCache(companyId, url);
}

async function listAttachmentUsagePlacesInCompanyUncached(
  companyId: string,
  url: string
): Promise<AttachmentUsagePlace[]> {
  const needle = String(url || "").trim();
  if (!String(companyId || "").trim() || !isCountableAttachmentRef(needle)) return [];
  try {
    const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
    const { listCompanyDocsFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    const byKey = new Map<string, number>();
    const rowHasNeedle = (value: unknown): boolean => {
      if (typeof value === "string") return attachmentPersistableRefsMatch(value, needle);
      if (Array.isArray(value)) return value.some((item) => rowHasNeedle(item));
      if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some((v) => rowHasNeedle(v));
      }
      return false;
    };
    const scanIds = await companyIdsForAttachmentScan(companyId);
    /** IC shared attachments: peer company copies may reference the same Storage object. */
    const icPeerIds = new Set<string>();
    for (const cid of scanIds) {
      for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
        const rows = await listCompanyDocsFromBrowserDb(cid, coll);
        for (const row of rows) {
          const id = String((row as { id?: unknown }).id || "").trim();
          if (!id) continue;
          // Recycle Bin (soft-deleted) refs Storage delete / reuse count me mat gin —
          // warna permanent delete pe source-only file bhi SKIPPED_REFCOUNT ho jati.
          if ((row as { isDeleted?: unknown }).isDeleted === true) continue;
          // Strict usage (Phase 2): ANY field of the live doc counts (IC interCompanyOwnFileUrls, peer pending
          // proposals, loan_documents, recurring templates, ...). Only `history` (audit trail of old values)
          // is excluded, as before, so edit-time recompress can still free the old object.
          const hit = Object.entries(row as Record<string, unknown>).some(
            ([k, v]) => k !== "history" && rowHasNeedle(v)
          );
          if (coll === "vouchers") {
            const peer = String(
              ((row as Record<string, unknown>).interCompanyLink as { peerCompanyId?: string } | undefined)
                ?.peerCompanyId || ""
            ).trim();
            if (peer && !scanIds.includes(peer)) icPeerIds.add(peer);
          }
          if (!hit) continue;
          const placeKey = `${coll}/${id}`;
          const atMs = rowEarliestMs(row as Record<string, unknown>);
          const prev = byKey.get(placeKey);
          if (prev == null || atMs < prev) byKey.set(placeKey, atMs);
        }
      }
    }
    // Peer companies (only those mirrored on this device): count IC vouchers that still use the URL.
    for (const peerId of icPeerIds) {
      try {
        const rows = await listCompanyDocsFromBrowserDb(peerId, "vouchers");
        for (const row of rows) {
          const id = String((row as { id?: unknown }).id || "").trim();
          if (!id || (row as { isDeleted?: unknown }).isDeleted === true) continue;
          const hit = Object.entries(row as Record<string, unknown>).some(
            ([k, v]) => k !== "history" && rowHasNeedle(v)
          );
          if (!hit) continue;
          const placeKey = `peer:${peerId}:vouchers/${id}`;
          byKey.set(placeKey, rowEarliestMs(row as Record<string, unknown>));
        }
      } catch {
        /* peer not mirrored here */
      }
    }
    return [...byKey.entries()]
      .map(([placeKey, atMs]) => ({ placeKey, atMs }))
      .sort((a, b) => a.atMs - b.atMs || a.placeKey.localeCompare(b.placeKey));
  } catch {
    return [];
  }
}

/** Sab jagah jahan yeh URL lagi hai — placeKey = `collection/docId`. */
export async function listAttachmentUsagePlacesInCompany(
  companyId: string,
  url: string
): Promise<AttachmentUsagePlace[]> {
  const cid = String(companyId || "").trim();
  const needle = String(url || "").trim();
  if (!cid || !isCountableAttachmentRef(needle)) return [];
  const key = placesListCacheKey(cid, needle);
  const hit = placesListCache.get(key);
  if (hit && Date.now() - hit.at < PLACES_CACHE_TTL_MS) return hit.places;
  let inflight = placesListInflight.get(key);
  if (!inflight) {
    inflight = listAttachmentUsagePlacesInCompanyUncached(cid, needle)
      .then((places) => {
        placesListCache.set(key, { at: Date.now(), places });
        return places;
      })
      .finally(() => {
        placesListInflight.delete(key);
      });
    placesListInflight.set(key, inflight);
  }
  return inflight;
}

/**
 * Pehli / earliest linked place — us voucher pe reuse badge green; baaki pe blue.
 * Prefer earliest voucher; session hold-copy source as fallback jab scan empty.
 */
export async function resolveAttachmentReuseOriginPlaceKey(
  companyId: string,
  url: string
): Promise<string | null> {
  const places = await listAttachmentUsagePlacesInCompany(companyId, url);
  const fromPlaces = pickAttachmentReuseOriginPlaceKey(places);
  if (fromPlaces) return fromPlaces;
  return getAttachmentReuseSessionOriginPlace(companyId, url);
}

/** Transaction File column + forms — ek scan se count + sticky origin (green/blue). */
export async function resolveAttachmentReuseUiMeta(
  companyId: string,
  url: string,
  opts?: { includeFormBoost?: boolean; formPeerCount?: number }
): Promise<{ count: number; originPlaceKey: string | null; originDetached: boolean }> {
  const cid = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!cid || !u) return { count: 0, originPlaceKey: null, originDetached: false };
  // Copy-as-new model: never show shared-URL badges / colors.
  try {
    const { attachmentReuseShareUrlBadgesEnabled } = await import("@/lib/firebaseBillingOptimization");
    if (!attachmentReuseShareUrlBadgesEnabled()) {
      return { count: 1, originPlaceKey: null, originDetached: false };
    }
  } catch {
    return { count: 1, originPlaceKey: null, originDetached: false };
  }
  const [registryCount, places, sessionHint] = await Promise.all([
    getFirebaseAttachmentRefCount(cid, u),
    listAttachmentUsagePlacesInCompany(cid, u),
    getAttachmentReuseSessionHintAsync(cid, u),
  ]);
  const formPeers = Math.max(0, Number(opts?.formPeerCount) || 0);
  const count = Math.max(
    registryCount,
    places.length,
    sessionHint,
    formPeers,
    opts?.includeFormBoost ? 1 : 0
  );

  const earliest = pickAttachmentReuseOriginPlaceKey(places);
  let sticky = await getAttachmentReuseSessionOriginPlaceAsync(cid, u);
  // First time shared (2+ places): lock earliest as source — later mat promote.
  if (!sticky && places.length >= 2 && earliest) {
    rememberAttachmentReuseOriginPlace(cid, u, earliest);
    sticky = earliest;
  }
  const originPlaceKey = sticky || earliest || null;
  const originDetached = Boolean(
    sticky && places.length > 0 && !places.some((p) => p.placeKey === sticky)
  );
  return { count, originPlaceKey, originDetached };
}

/** Hold-copy source place — pehli baar set; paste target overwrite nahi karta. */
export function rememberAttachmentReuseOriginPlace(
  companyId: string,
  url: string,
  placeKey: string | null | undefined
): void {
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  const pk = String(placeKey || "").trim();
  if (!raw || !isCountableAttachmentRef(u) || !pk) return;
  const key = sessionReuseKey(raw, u);
  if (!sessionOriginHints.has(key)) sessionOriginHints.set(key, pk);
  void normalizeCompanyIdForReuse(raw).then((cid) => {
    if (!cid || cid === raw) return;
    const k2 = sessionReuseKey(cid, u);
    if (!sessionOriginHints.has(k2)) sessionOriginHints.set(k2, pk);
  });
}

export function getAttachmentReuseSessionOriginPlace(
  companyId: string,
  url: string
): string | null {
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!raw || !u) return null;
  return sessionOriginHints.get(sessionReuseKey(raw, u)) || null;
}

export async function getAttachmentReuseSessionOriginPlaceAsync(
  companyId: string,
  url: string
): Promise<string | null> {
  const cid = await normalizeCompanyIdForReuse(companyId);
  const raw = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!u) return null;
  return (
    (raw ? sessionOriginHints.get(sessionReuseKey(raw, u)) : null) ||
    (cid ? sessionOriginHints.get(sessionReuseKey(cid, u)) : null) ||
    null
  );
}

/** UI helper — `vouchers/xyz`, `parties/abc`. */
export function buildAttachmentReusePlaceKey(
  collection: string,
  entityId?: string | null
): string | null {
  const coll = String(collection || "").trim();
  const id = String(entityId || "").trim();
  if (!coll || !id) return null;
  return `${coll}/${id}`;
}

/** @deprecated use countAttachmentUsageInCompany */
export async function countHttpsAttachmentUsageInCompany(
  companyId: string,
  url: string
): Promise<number> {
  return countAttachmentUsageInCompany(companyId, url);
}

/** Firestore registry refCount (0 if missing / offline registry off / local/Drive). */
export async function getFirebaseAttachmentRefCount(
  companyId: string,
  url: string
): Promise<number> {
  if (!(await registryEnabledForCompany(companyId))) return 0;
  const trimmed = String(url || "").trim();
  if (!isRegistryEligibleHttpsUrl(trimmed)) return 0;
  try {
    const snap = await getDoc(doc(registryCollection(companyId), registryDocId(trimmed)));
    if (!snap.exists()) return 0;
    return Math.max(0, Number((snap.data() as RegistryRow).refCount) || 0);
  } catch {
    return 0;
  }
}

/** UI badge: max(registry, live SQLite, session paste hints) — local/PL/Drive/online. */
export async function resolveAttachmentReuseDisplayCount(
  companyId: string,
  url: string,
  opts?: { includeFormBoost?: boolean; formPeerCount?: number }
): Promise<number> {
  const cid = String(companyId || "").trim();
  const u = String(url || "").trim();
  if (!cid || !u) return 0;
  const [registryCount, liveCount, sessionHint] = await Promise.all([
    getFirebaseAttachmentRefCount(cid, u),
    countAttachmentUsageInCompany(cid, u),
    getAttachmentReuseSessionHintAsync(cid, u),
  ]);
  const formPeers = Math.max(0, Number(opts?.formPeerCount) || 0);
  const n = Math.max(
    registryCount,
    liveCount,
    sessionHint,
    formPeers,
    opts?.includeFormBoost ? 1 : 0
  );
  return n;
}

/** True jab company me yeh ref abhi aur kahin nahi — bytes/pending/Drive delete OK. */
export async function shouldDeleteAttachmentBytesOnRemove(
  companyId: string,
  url: string
): Promise<boolean> {
  const live = await countAttachmentUsageInCompany(companyId, url);
  if (live > 0) return false;
  const registry = await getFirebaseAttachmentRefCount(companyId, url);
  if (registry > 0) return false;
  // Session hint after unlink already excluded this doc — still warn if hint > 1 from unsaved siblings.
  const hint = getAttachmentReuseSessionHint(companyId, url);
  return hint <= 1;
}

/** Voucher permanent delete — decrement; delete Storage bytes only when unreferenced. */
function fileNameFromStoragePath(path: string): string {
  const base = path.split("/").pop() || "attachment";
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

/**
 * Cross-company reuse copies bytes into the target company. Same URL across
 * companies would make delete/ref-count ownership unsafe.
 */
export async function copyCloudAttachmentRefToCompany(params: {
  sourceUrl: string;
  targetCompanyId: string;
  targetCompanyName?: string;
}): Promise<string> {
  return copyAttachmentRefAsNewUpload(params);
}

/**
 * Reuse as copy: read source bytes → upload a NEW object for the target company.
 * Handles Firebase https (+ prefers Storage getBlob). Caller may prefer File→form save instead.
 */
export async function copyAttachmentRefAsNewUpload(params: {
  sourceUrl: string;
  targetCompanyId: string;
  targetCompanyName?: string;
}): Promise<string> {
  const sourceUrl = String(params.sourceUrl || "").trim();
  const targetCompanyId = String(params.targetCompanyId || "").trim();
  if (!targetCompanyId) throw new Error("Target company is missing.");
  if (!sourceUrl) throw new Error("Source attachment is missing.");

  let blob: Blob | null = null;
  let fileName = fileNameFromStoragePath(sourceUrl);

  if (isRegistryEligibleHttpsUrl(sourceUrl)) {
    const sourcePath = tryGetStoragePathFromFirebaseDownloadUrl(sourceUrl);
    if (sourcePath) {
      try {
        blob = await getBlob(ref(storage, sourcePath));
        fileName = fileNameFromStoragePath(sourcePath);
      } catch {
        blob = null;
      }
    }
    if (!blob || blob.size === 0) {
      const res = await fetch(sourceUrl, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error("Could not read the source attachment.");
      blob = await res.blob();
    }
  } else if (isLocalFileRef(sourceUrl) || isDriveFileRef(sourceUrl)) {
    const { getBlobFromAttachmentRefPreferLocalFirst } = await import(
      "@/lib/attachmentPreviewResolve"
    );
    blob = await getBlobFromAttachmentRefPreferLocalFirst(sourceUrl, {
      companyId: targetCompanyId,
    });
    fileName = fileNameFromStoragePath(sourceUrl.replace(/^local:/i, "").replace(/^drive:/i, ""));
  } else {
    throw new Error("This attachment type cannot be copied yet.");
  }

  if (!blob || blob.size === 0) throw new Error("Could not read the source attachment.");

  const uploaded = await uploadFileClient(
    {
      name: fileName || "attachment",
      type: blob.type || "application/octet-stream",
      arrayBuffer: await blob.arrayBuffer(),
    },
    targetCompanyId,
    params.targetCompanyName,
    new Date()
  );
  if (uploaded.success === false) throw new Error(uploaded.error || "Could not copy attachment.");
  await registerFirebaseAttachmentRef(targetCompanyId, uploaded.url, 1);
  return uploaded.url;
}
export async function unlinkFirebaseAttachmentRefsForDoc(
  companyId: string,
  fileUrls: string[],
  traceOpts?: { entityId?: string }
): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const uniq = [...new Set(fileUrls.map((u) => u.trim()).filter(isRegistryEligibleHttpsUrl))];
  const trace =
    typeof process !== "undefined" && process.env.NODE_ENV !== "production"
      ? await import("@/lib/attachmentDeleteTrace")
      : null;
  for (const url of uniq) {
    const refDoc = doc(registryCollection(companyId), registryDocId(url));
    let storagePath: string | null = null;
    let shouldDelete = false;
    let refCountAfter: number | null = null;
    try {
      await runTransaction(firestore, async (tx) => {
        const snap = await tx.get(refDoc);
        if (!snap.exists()) {
          shouldDelete = true;
          storagePath = tryGetStoragePathFromFirebaseDownloadUrl(url);
          refCountAfter = 0;
          return;
        }
        const data = snap.data() as RegistryRow;
        const prev = Math.max(0, Number(data.refCount) || 0);
        const next = prev - 1;
        refCountAfter = next;
        storagePath =
          (typeof data.storagePath === "string" && data.storagePath.trim()) ||
          tryGetStoragePathFromFirebaseDownloadUrl(url);
        if (next <= 0) {
          shouldDelete = true;
          tx.delete(refDoc);
        } else {
          tx.update(refDoc, { refCount: next, updatedAt: serverTimestamp() });
        }
      });
    } catch (e) {
      shouldDelete = true;
      storagePath = tryGetStoragePathFromFirebaseDownloadUrl(url);
      trace?.traceStorageDeleteUrlResult({
        phase: "registry_unlink",
        companyId,
        entityId: traceOpts?.entityId,
        url,
        storagePath,
        outcome: "failed",
        error: e,
        detail: { note: "registry transaction failed — will attempt deleteObject" },
      });
    }
    if (!shouldDelete) {
      trace?.traceStorageDeleteUrlResult({
        phase: "registry_unlink",
        companyId,
        entityId: traceOpts?.entityId,
        url,
        storagePath,
        outcome: "skipped_refcount",
        detail: { refCountAfter },
      });
    } else if (shouldDelete && storagePath) {
      // Safety: registry 0 ho lekin SQLite me URL abhi reuse ho — Storage mat mitao.
      let liveRefs = 0;
      try {
        liveRefs = await countHttpsAttachmentUsageInCompany(companyId, url);
      } catch {
        liveRefs = 0;
      }
      if (liveRefs > 0) {
        try {
          await setDoc(
            refDoc,
            {
              url,
              storagePath,
              refCount: liveRefs,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch {
          /* best-effort heal */
        }
        trace?.traceStorageDeleteUrlResult({
          phase: "registry_unlink",
          companyId,
          entityId: traceOpts?.entityId,
          url,
          storagePath,
          outcome: "skipped_refcount",
          detail: { refCountAfter: liveRefs, note: "sqlite still references — healed registry" },
        });
        continue;
      }
      try {
        await deleteObject(ref(storage, storagePath));
        trace?.traceStorageDeleteUrlResult({
          phase: "registry_unlink",
          companyId,
          entityId: traceOpts?.entityId,
          url,
          storagePath,
          outcome: "deleted",
          detail: { refCountAfter },
        });
      } catch (e) {
        const code = (e as { code?: string })?.code || "";
        trace?.traceStorageDeleteUrlResult({
          phase: "registry_unlink",
          companyId,
          entityId: traceOpts?.entityId,
          url,
          storagePath,
          outcome: code === "storage/object-not-found" ? "not_found" : "failed",
          error: e,
          detail: { refCountAfter },
        });
        console.warn("[attachmentRegistry] Storage delete failed", storagePath, e);
      }
    } else if (shouldDelete && !storagePath) {
      trace?.traceStorageDeleteUrlResult({
        phase: "registry_unlink",
        companyId,
        entityId: traceOpts?.entityId,
        url,
        storagePath: null,
        outcome: "skipped_no_path",
      });
      console.warn("[attachmentRegistry] Storage delete skipped — could not parse path from URL", url);
    }
  }
}

async function forceDeleteStorageUrls(
  urls: string[],
  traceCtx?: { companyId: string; entityId?: string }
): Promise<void> {
  const { deleteObject: delObj } = await import("@/lib/pocketbaseData/pbStorage");
  const { storage: st } = await import("@/lib/firebase");
  const trace =
    typeof process !== "undefined" && process.env.NODE_ENV !== "production"
      ? await import("@/lib/attachmentDeleteTrace")
      : null;
  const cid = String(traceCtx?.companyId || "").trim();
  for (const raw of urls) {
    const trimmed = String(raw || "").trim();
    if (!isRegistryEligibleHttpsUrl(trimmed)) {
      trace?.traceStorageDeleteUrlResult({
        phase: "force_delete",
        companyId: cid,
        entityId: traceCtx?.entityId,
        url: trimmed,
        outcome: "skipped_not_eligible",
      });
      continue;
    }
    // Reuse-safe: registry off / force me bhi live SQLite places check — shared journal/source mat mitao.
    if (cid) {
      let live = 0;
      try {
        live = await countAttachmentUsageInCompany(cid, trimmed);
      } catch {
        live = 0;
      }
      if (live > 0) {
        trace?.traceStorageDeleteUrlResult({
          phase: "force_delete",
          companyId: cid,
          entityId: traceCtx?.entityId,
          url: trimmed,
          outcome: "skipped_refcount",
          detail: { note: "live vouchers still reference — skip Storage delete", live },
        });
        continue;
      }
    }
    const path = tryGetStoragePathFromFirebaseDownloadUrl(trimmed);
    if (!path) {
      trace?.traceStorageDeleteUrlResult({
        phase: "force_delete",
        companyId: cid,
        entityId: traceCtx?.entityId,
        url: trimmed,
        storagePath: null,
        outcome: "skipped_no_path",
      });
      console.warn("[attachmentRegistry] force delete skipped — bad URL path", raw);
      continue;
    }
    try {
      await delObj(ref(st, path));
      trace?.traceStorageDeleteUrlResult({
        phase: "force_delete",
        companyId: cid,
        entityId: traceCtx?.entityId,
        url: trimmed,
        storagePath: path,
        outcome: "deleted",
      });
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      trace?.traceStorageDeleteUrlResult({
        phase: "force_delete",
        companyId: cid,
        entityId: traceCtx?.entityId,
        url: trimmed,
        storagePath: path,
        outcome: code === "storage/object-not-found" ? "not_found" : "failed",
        error: e,
      });
      console.warn("[attachmentRegistry] force Storage delete failed", path, e);
    }
  }
}

/** Legacy path: no registry row → delete immediately (pre-registry vouchers). */
export async function deleteFirebaseStorageUrlsWithRegistry(
  companyId: string,
  urls: string[],
  opts?: { forceDeleteBytes?: boolean; traceEntityId?: string }
): Promise<void> {
  const cid = String(companyId || "").trim();
  const uniq = [...new Set(urls.map((u) => String(u || "").trim()).filter(Boolean))];
  if (!uniq.length) return;
  const registryOn = await registryEnabledForCompany(cid);
  const trace =
    typeof process !== "undefined" && process.env.NODE_ENV !== "production"
      ? await import("@/lib/attachmentDeleteTrace")
      : null;
  trace?.traceStorageDeleteBatchStart({
    companyId: cid,
    entityId: opts?.traceEntityId,
    registryEnabled: registryOn,
    forceDeleteBytes: opts?.forceDeleteBytes === true,
    urlCount: uniq.length,
  });
  const traceCtx = { companyId: cid, entityId: opts?.traceEntityId };
  if (!registryOn) {
    await forceDeleteStorageUrls(uniq, traceCtx);
    return;
  }
  await unlinkFirebaseAttachmentRefsForDoc(cid, uniq, { entityId: opts?.traceEntityId });
  // Default: refCount > 0 pe Storage mat mitao (reuse-safe).
  // `forceDeleteBytes` sirf emergency / orphan cleanup ke liye.
  if (opts?.forceDeleteBytes === true) {
    // Even force: skip URLs still referenced elsewhere in this company.
    const stillLive: string[] = [];
    const orphaned: string[] = [];
    for (const u of uniq) {
      const live = await countHttpsAttachmentUsageInCompany(cid, u);
      if (live > 0) stillLive.push(u);
      else orphaned.push(u);
    }
    if (stillLive.length) {
      for (const u of stillLive) {
        try {
          await ensureRegistryDocForUrl(cid, u);
          const live = await countHttpsAttachmentUsageInCompany(cid, u);
          const refDoc = doc(registryCollection(cid), registryDocId(u));
          await setDoc(
            refDoc,
            { url: u, refCount: Math.max(1, live), updatedAt: serverTimestamp() },
            { merge: true }
          );
        } catch {
          /* heal best-effort */
        }
        trace?.traceStorageDeleteUrlResult({
          phase: "force_delete",
          companyId: cid,
          entityId: opts?.traceEntityId,
          url: u,
          outcome: "skipped_refcount",
          detail: { note: "forceDelete blocked — URL still used in company" },
        });
      }
    }
    if (orphaned.length) await forceDeleteStorageUrls(orphaned, traceCtx);
  }
}

/** Best-effort bump after immediate Storage upload (forms that still use uploadBytes). */
export async function touchRegistryAfterStorageUpload(
  companyId: string,
  httpsUrl: string
): Promise<void> {
  try {
    await registerFirebaseAttachmentRef(companyId, httpsUrl, 1);
  } catch {
    /* non-fatal */
  }
}

/** Ensure registry doc exists with at least refCount 1 (idempotent). */
export async function ensureRegistryDocForUrl(companyId: string, url: string): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const trimmed = url.trim();
  if (!isRegistryEligibleHttpsUrl(trimmed)) return;
  const refDoc = doc(registryCollection(companyId), registryDocId(trimmed));
  const snap = await getDoc(refDoc);
  if (snap.exists()) return;
  await setDoc(refDoc, {
    url: trimmed,
    storagePath: tryGetStoragePathFromFirebaseDownloadUrl(trimmed) ?? null,
    refCount: 1,
    updatedAt: serverTimestamp(),
  });
}

/** Recompress reuse rewrite: set exact refCount for new HTTPS URL. */
export async function setFirebaseAttachmentRegistryRefCount(
  companyId: string,
  url: string,
  refCount: number
): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const cid = await normalizeCompanyIdForReuse(companyId);
  const trimmed = String(url || "").trim();
  if (!cid || !isRegistryEligibleHttpsUrl(trimmed)) return;
  const refDoc = doc(registryCollection(cid), registryDocId(trimmed));
  await setDoc(
    refDoc,
    {
      url: trimmed,
      storagePath: tryGetStoragePathFromFirebaseDownloadUrl(trimmed) ?? null,
      refCount: Math.max(1, Math.floor(refCount) || 1),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Recompress reuse rewrite: drop old URL registry row after live usage is 0. */
export async function removeFirebaseAttachmentRegistryDoc(
  companyId: string,
  url: string
): Promise<void> {
  if (!(await registryEnabledForCompany(companyId))) return;
  const cid = await normalizeCompanyIdForReuse(companyId);
  const trimmed = String(url || "").trim();
  if (!cid || !isRegistryEligibleHttpsUrl(trimmed)) return;
  const { deleteDoc } = await import("@/lib/pbCompat/firestore");
  const refDoc = doc(registryCollection(cid), registryDocId(trimmed));
  try {
    await deleteDoc(refDoc);
  } catch {
    /* already gone */
  }
  invalidateAttachmentUsagePlacesCache(cid, trimmed);
}
