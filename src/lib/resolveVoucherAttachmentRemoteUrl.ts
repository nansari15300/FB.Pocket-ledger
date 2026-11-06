"use client";

import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isLocalFileRef, LOCAL_FILE_PREFIX } from "@/lib/localPendingFiles";
import { normalizeFileUrlsField, getVoucherAttachmentUrlsForUi } from "@/lib/voucherAttachmentNormalize";
import { isLocalOnlyMode } from "@/lib/localMode";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { shouldReadLedgerFromSqliteOnly } from "@/lib/companyStorageKind";
import { isPbAttachmentRef } from "@/lib/pocketbaseData/pbAttachments";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";

/** HTTPS / Drive / blob — `local:` staging ke opposite; edit dialog merge me remote prefer karo. */
export function isRemoteAttachmentUrl(u: string): boolean {
  const s = String(u || "").trim();
  if (!s || s.startsWith(LOCAL_FILE_PREFIX)) return false;
  // Drive sync refs (`drive:...`) bhi remote attachment hi hain; stale local replace me inko accept karo.
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("blob:") ||
    s.startsWith("data:") ||
    isPbAttachmentRef(s) ||
    isDriveFileRef(s)
  );
}

/** Forensic: stale `local:` → remote HTTPS resolve path proof (`NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG=1`). */
function staleLocalResolveForensicEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG === "1";
}

/** Pending upload leaf is `{localId}_filename` — only that remote twin is a safe resolve. */
function remoteUrlEmbedsLocalFileId(remoteUrl: string, localId: string): boolean {
  const id = String(localId || "").trim();
  if (!id || id.length < 8) return false;
  const raw = String(remoteUrl || "");
  if (!raw) return false;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const needle = `${id}_`;
  return decoded.includes(needle) || raw.includes(needle) || decoded.includes(`/${id}.`) || raw.includes(`/${id}.`);
}

/** Registry / device `companyId` → Firestore `companies/{id}` (Storage + voucher doc same id) — read-only, voucherActionsClient jaisa. */
async function resolveAuthoritativeFirestoreCompanyIdForAttachmentRead(companyId: string): Promise<string> {
  try {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const cid = String((reg as Record<string, unknown> | null)?.authoritativeCompanyId ?? "").trim();
    return cid || companyId;
  } catch {
    return companyId;
  }
}

/**
 * Stale `local:` resolve ke liye `fileUrls` source:
 * - Local / SQLite ledger: **pehle ek voucher row** (`getCompanyDocFromBrowserDb`) — poori vouchers list scan mat.
 * - Online cloud miss: Firestore getDoc (HTTPS upgrade ho chuka ho to).
 */
async function readVoucherFileUrlsForStaleLocalResolve(
  registryCompanyId: string,
  voucherId: string
): Promise<{ fileUrls: string[]; source: "firestore_getDoc" | "sqlite_mirror_get" | "none" }> {
  const regCid = String(registryCompanyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!regCid || !vid) return { fileUrls: [], source: "none" };

  const readSqliteRow = async (): Promise<string[]> => {
    try {
      const row = (await getCompanyDocFromBrowserDb(regCid, "vouchers", vid)) as {
        fileUrls?: unknown;
      } | null;
      if (!row) return [];
      return normalizeFileUrlsField(row.fileUrls);
    } catch {
      return [];
    }
  };

  let sqliteFirst = isLocalOnlyMode();
  if (!sqliteFirst) {
    try {
      const reg = await getLocalCompanyById(regCid, { includeDeleted: true });
      sqliteFirst = shouldReadLedgerFromSqliteOnly(reg as Parameters<typeof shouldReadLedgerFromSqliteOnly>[0]);
    } catch {
      sqliteFirst = false;
    }
  }

  if (sqliteFirst) {
    const fileUrls = await readSqliteRow();
    if (fileUrls.length > 0) return { fileUrls, source: "sqlite_mirror_get" };
  }

  const tryFirestore =
    typeof navigator === "undefined" ||
    navigator.onLine !== false ||
    isCapacitorNativeApp();

  if (tryFirestore && !sqliteFirst) {
    try {
      const fsCid = await resolveAuthoritativeFirestoreCompanyIdForAttachmentRead(regCid);
      const snap = await getDoc(doc(firestore, "companies", fsCid, "vouchers", vid));
      if (snap.exists()) {
        const data = snap.data() as { fileUrls?: unknown };
        const fileUrls = normalizeFileUrlsField(data.fileUrls);
        if (fileUrls.length > 0) {
          return { fileUrls, source: "firestore_getDoc" };
        }
      }
    } catch {
      /* sqlite fallback niche */
    }
  }

  const fileUrls = await readSqliteRow();
  if (fileUrls.length > 0) return { fileUrls, source: "sqlite_mirror_get" };
  return { fileUrls: [], source: "none" };
}

/**
 * IndexedDB pending blob cleared / APK cache wipe — voucher row may still hold `local:` in UI
 * while Firestore (or SQLite mirror) already has the uploaded download URL.
 */
export async function tryResolveRemoteUrlForStaleLocalAttachment(
  companyId: string,
  voucherId: string,
  staleUrl: string,
  clientFileUrls?: readonly string[] | null
): Promise<string | null> {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid || !staleUrl) {
    if (staleLocalResolveForensicEnabled()) {
      console.warn("[FORENSIC_STALE_LOCAL_RESOLVE]", {
        outcome: "early_null_missing_ids",
        companyId: cid,
        voucherId: vid,
        staleUrl,
      });
    }
    return null;
  }

  let fileUrls: string[] = [];
  let source: "firestore_getDoc" | "sqlite_mirror_list" | "sqlite_mirror_get" | "none" = "none";
  try {
    const read = await readVoucherFileUrlsForStaleLocalResolve(cid, vid);
    fileUrls = read.fileUrls;
    source = read.source;
    if (fileUrls.length === 0 && staleLocalResolveForensicEnabled()) {
      console.warn("[FORENSIC_STALE_LOCAL_RESOLVE]", {
        outcome: source === "none" ? "no_rows_firestore_empty_then_sqlite_empty" : "empty_fileUrls_after_read",
        companyId: cid,
        voucherId: vid,
        staleUrl,
        source,
      });
    }
    if (fileUrls.length === 0) return null;
  } catch (e) {
    if (staleLocalResolveForensicEnabled()) {
      console.warn("[FORENSIC_STALE_LOCAL_RESOLVE]", {
        outcome: "read_throw",
        companyId: cid,
        voucherId: vid,
        staleUrl,
        source,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  }

  const client = (clientFileUrls || []).filter((u): u is string => typeof u === "string" && u.length > 0);
  const idx = client.findIndex((u) => u === staleUrl);
  let fallbackPath: string = "none";
  let resolved: string | null = null;

  // Only accept a remote twin that embeds this pending local id in the storage path/URL.
  // Index / "single remote" fallbacks resurrect removed attachments after replace/remove+save.
  const localId = isLocalFileRef(staleUrl)
    ? staleUrl.slice(LOCAL_FILE_PREFIX.length).trim()
    : "";
  if (localId) {
    for (const u of fileUrls) {
      if (!isRemoteAttachmentUrl(u)) continue;
      if (!remoteUrlEmbedsLocalFileId(u, localId)) continue;
      fallbackPath = "remote_url_embeds_local_id";
      resolved = u;
      break;
    }
  }
  // PocketBase: resolve ONLY the pl_attachments row for this local id (app_id = att_<id>).
  // Same-slot voucher fileUrls resurrected the previous pbatt after replace (same count), and
  // rememberServerAttachmentRefs wrote that whole old list back into SQLite.
  if (!resolved && localId && getValidPocketBaseAuth()) {
    try {
      const [{ ensurePocketBaseCompany }, { pbFirst, pbQuote }, { PB_ATTACHMENT_PREFIX }] = await Promise.all([
        import("@/lib/pocketbaseData/pbSync"),
        import("@/lib/pocketbaseData/pbClient"),
        import("@/lib/pocketbaseData/pbAttachments"),
      ]);
      const appId = `att_${localId}`.slice(0, 200);
      const companyRec = await ensurePocketBaseCompany(cid, { createIfMissing: false });
      const rec = await pbFirst<Record<string, unknown>>(
        "pl_attachments",
        `company = ${pbQuote(companyRec)} && app_id = ${pbQuote(appId)}`
      );
      if (rec) {
        const rid = String(rec.id || "").trim();
        const file = String(rec.file || "").trim();
        if (rid && file) {
          fallbackPath = "pocketbase_att_app_id";
          resolved = `${PB_ATTACHMENT_PREFIX}${rid}/${file}`;
        }
      }
    } catch {
      /* keep unresolved - pending upload / outbox flush will rewrite */
    }
  }
  // Same local: still present on the row (not yet upgraded) — nothing to resolve.
  if (!resolved && fileUrls.includes(staleUrl)) {
    fallbackPath = "row_still_has_same_local_ref";
  }

  if (staleLocalResolveForensicEnabled()) {
    console.warn("[FORENSIC_STALE_LOCAL_RESOLVE]", {
      outcome: resolved ? "resolved" : "unresolved_null",
      companyId: cid,
      voucherId: vid,
      staleUrl,
      clientFileUrls: client,
      remoteFileUrls: fileUrls,
      matchedClientIndex: idx,
      clientLength: client.length,
      remoteLength: fileUrls.length,
      lengthsAligned: client.length === fileUrls.length,
      fallbackPathChosen: fallbackPath,
      finalResolvedUrl: resolved,
      dataSource: source,
      isLocalOnlyMode: isLocalOnlyMode(),
    });
  }

  return resolved;
}

/**
 * Edit dialog: `liveVoucher` (onSnapshot) kabhi stale `local:` rakhe, table row / mirror pehle HTTPS patch kar chuka ho.
 * Sirf empty-live merge pehle tha — isliye tick preview chalta tha, form `local:` + missing pending par FILE icon.
 *
 * `liveExplicitEmpty`: live doc/cache ne `fileUrls: []` intentionally likha (user remove-all) —
 * stale daybook/table row se HTTPS wapas mat lao.
 */
export function mergeVoucherFileUrlsForEditDialog(
  liveUrls: readonly string[],
  rowUrls: readonly string[],
  opts?: { liveExplicitEmpty?: boolean }
): string[] {
  const live = liveUrls.map((u) => String(u || "").trim()).filter(Boolean);
  const row = rowUrls.map((u) => String(u || "").trim()).filter(Boolean);
  if (opts?.liveExplicitEmpty) return live;
  // Empty live stays empty — do not revive HTTPS from a stale daybook/table row after remove-all.
  if (live.length === 0) return live;
  if (row.length === 0) return live;
  if (live.length === row.length) {
    return live.map((liveRef, i) => {
      const rowRef = row[i]!;
      if (
        isLocalFileRef(liveRef) &&
        isRemoteAttachmentUrl(rowRef) &&
        remoteUrlEmbedsLocalFileId(rowRef, liveRef.slice(LOCAL_FILE_PREFIX.length).trim())
      ) {
        return rowRef;
      }
      if (isRemoteAttachmentUrl(liveRef)) return liveRef;
      return liveRef || rowRef;
    });
  }
  // Length mismatch (remove/replace) — live list is authoritative; never expand from row remotes.
  return live;
}

/**
 * P2P / live pull merge: stale export kabhi `fileUrls` khali bhejta hai — local attachments mat hatao.
 */
export function mergeVoucherMirrorPullAttachments(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
  opts?: { existingEditTimeMs?: number; incomingEditTimeMs?: number }
): Record<string, unknown> {
  const merged = { ...incoming };
  const existingUrls = getVoucherAttachmentUrlsForUi(existing);
  const incomingUrls = getVoucherAttachmentUrlsForUi(incoming);
  const hasIncomingFileUrls = Object.prototype.hasOwnProperty.call(incoming, "fileUrls");
  const existingMs = opts?.existingEditTimeMs ?? 0;
  const incomingMs = opts?.incomingEditTimeMs ?? 0;

  if (existingUrls.length === 0) return merged;

  if (!hasIncomingFileUrls) {
    merged.fileUrls = existingUrls;
    return merged;
  }
  // Explicit empty on newer/equal incoming = intentional remove — purani HTTPS mat wapas lao.
  if (incomingUrls.length === 0) {
    if (incomingMs >= existingMs) {
      merged.fileUrls = [];
      return merged;
    }
    merged.fileUrls = existingUrls;
    return merged;
  }
  if (incomingUrls.length > 0) {
    const existingHasPendingLocal = existingUrls.some((u) => isLocalFileRef(u));
    // Replace-in-one-save: local already has local:NEW while server still has pbatt:OLD (same length).
    // Prefer newer/equal local list until outbox flush upgrades it.
    if (existingHasPendingLocal && existingMs >= incomingMs) {
      merged.fileUrls = mergeVoucherFileUrlsForEditDialog(existingUrls, incomingUrls);
      return merged;
    }
    merged.fileUrls = mergeVoucherFileUrlsForEditDialog(incomingUrls, existingUrls);
  }
  return merged;
}
