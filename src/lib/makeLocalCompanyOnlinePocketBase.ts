"use client";

/**
 * Local-only company -> PocketBase online company (Pocket Ledger Server).
 *
 * Order matters: everything is uploaded first (company root, attachments `local:` -> `pbatt:`, every
 * document), and only when that succeeded is the local row flipped to PocketBase online. A failed
 * upload therefore leaves the company local and unchanged.
 */

import { Timestamp } from "@/lib/pbCompat/firestore";
import { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } from "@/lib/firestoreToLocalCompanyPull";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById, promoteLocalCompanyRowToOnline } from "@/lib/localCompanyStore";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";
import { ONLINE_DATA_SERVER_POCKETBASE_ID } from "@/lib/onlineDataServer";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { isPocketBaseSessionUser } from "@/lib/pocketbaseData/pbAppSession";
import { isServerOnlyLoginSession } from "@/lib/pocketbaseData/serverSessionCompanyScope";
import { registerPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { uploadRestoredCompanyToPocketBase, type PbRestoreDoc } from "@/lib/pocketbaseData/pbRestoreUpload";
import { ensureSuperAdminInSharedEmails } from "@/lib/superAdminEmails";
import { sharedWithEmailsLowerFromList } from "@/lib/sharedWithEmailsQuery";
import { yieldToMain } from "@/lib/yieldToMain";

export type MakeLocalCompanyOnlinePbProgress = (label: string, detail: string) => void;

export type MakeLocalCompanyOnlinePbResult = {
  ok: boolean;
  message?: string;
  /** Records written to the server. */
  uploaded: number;
  /** Files converted to server attachments. */
  attachments: number;
  /** `local:` file refs still on documents afterwards (file bytes were not on this device). */
  missingLocalFiles: number;
  missingSample: string[];
};

const LOCAL_ONLY_ROOT_KEYS = new Set([
  "id",
  "isOwned",
  "localOnly",
  "firestoreSyncDisabled",
  "localPersistence",
  "plServerShared",
  "plServerGateId",
  "plServerGateServerUrl",
  "plServerHostCompanyId",
  "localCompanyUsers",
  "authoritativeCompanyId",
  "demoteReason",
  "demotedFromOnlineAt",
]);

function toTs(v: unknown): Timestamp | null {
  if (v == null || v === "") return null;
  if (v instanceof Timestamp) return v;
  if (typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return d && !Number.isNaN(d.getTime()) ? Timestamp.fromDate(d) : null;
    } catch {
      return null;
    }
  }
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function collectLocalRefs(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    if (value.startsWith("local:")) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectLocalRefs(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectLocalRefs(v, out, depth + 1);
  }
}

/** Active Pocket Ledger Server (PocketBase) login for this page. */
export function isPocketBaseLoginActive(user: unknown): boolean {
  if (!getValidPocketBaseAuth()) return false;
  return isPocketBaseSessionUser(user) || isServerOnlyLoginSession();
}

/** True when the company row is a device-only company that can be moved to PocketBase. */
export function isLocalOnlyCompanyForPbUpgrade(
  c:
    | {
        storageOption?: unknown;
        syncPolicy?: unknown;
        syncedFromCloud?: unknown;
        onlineServerId?: unknown;
        onlineDataBackend?: unknown;
        plServerShared?: unknown;
        authoritativeCompanyId?: unknown;
        localOnly?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!c) return false;
  if (c.plServerShared === true) return false;
  if (String(c.onlineServerId ?? "").toLowerCase().trim() === "pocketbase") return false;
  if (String(c.onlineDataBackend ?? "").toLowerCase().trim() === "pocketbase") return false;
  if (c.syncedFromCloud === true) return false;
  if (String(c.syncPolicy ?? "").toLowerCase().trim() === "online") return false;
  if (String(c.authoritativeCompanyId ?? "").trim()) return false;
  const so = String(c.storageOption ?? "local").toLowerCase().trim();
  return so === "local" || so === "";
}

export async function makeLocalCompanyOnlinePocketBase(input: {
  companyId: string;
  user: { uid: string; email: string | null };
  isSuperAdmin?: boolean;
  superAdminEmail?: string | null;
  onProgress?: MakeLocalCompanyOnlinePbProgress;
}): Promise<MakeLocalCompanyOnlinePbResult> {
  const empty: MakeLocalCompanyOnlinePbResult = {
    ok: false,
    uploaded: 0,
    attachments: 0,
    missingLocalFiles: 0,
    missingSample: [],
  };
  const cid = String(input.companyId || "").trim();
  if (!cid) return { ...empty, message: "No company selected." };
  if (!input.user?.uid) return { ...empty, message: "Sign in first." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ...empty, message: "You are offline. Connect to the internet and try again." };
  }
  if (!getValidPocketBaseAuth()) {
    return { ...empty, message: "Pocket Ledger Server: sign in to the server first, then try again." };
  }
  const progress = input.onProgress ?? (() => {});

  const row = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!row) return { ...empty, message: "Company not found on this device." };
  if (!isLocalOnlyCompanyForPbUpgrade(row as Record<string, unknown>)) {
    return { ...empty, message: "This company is not local-only." };
  }

  try {
    // 1) Read every local document (small yields: low-end PCs).
    progress("Reading local data", "");
    const docs: PbRestoreDoc[] = [];
    const cols = COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS;
    for (let i = 0; i < cols.length; i++) {
      const coll = cols[i]!;
      progress("Reading local data", `${coll.replace(/_/g, " ")} (${i + 1}/${cols.length})`);
      await yieldToMain();
      const rows = await listCompanyDocsFromBrowserDb(cid, coll, { forBackupMerge: true });
      for (const r of rows) {
        const docId = String((r as { id?: unknown }).id ?? "").trim();
        if (!docId) continue;
        const { id: _omit, ...rest } = r as Record<string, unknown> & { id: string };
        const data: Record<string, unknown> = { ...rest };
        if (data.companyId == null || String(data.companyId).trim() === "") data.companyId = cid;
        docs.push({ coll, id: docId, data });
      }
    }

    // 2) Company root as a PocketBase online company.
    const ownerEmail = String(input.user.email ?? row.ownerEmail ?? "").trim();
    const sharedWithEmails = ensureSuperAdminInSharedEmails(
      ownerEmail ? [ownerEmail] : [],
      input.superAdminEmail ?? undefined,
      input.isSuperAdmin === true
    );
    const rootFromRow: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as unknown as Record<string, unknown>)) {
      if (v === undefined || LOCAL_ONLY_ROOT_KEYS.has(k)) continue;
      rootFromRow[k] = v;
    }
    const rootDoc: Record<string, unknown> = {
      ...rootFromRow,
      name: String(row.name ?? "").trim() || cid,
      fiscalYearStart: toTs((row as { fiscalYearStart?: unknown }).fiscalYearStart),
      fiscalYearEnd: toTs((row as { fiscalYearEnd?: unknown }).fiscalYearEnd),
      storageOption: "firebase",
      syncPolicy: "online",
      syncedFromCloud: false,
      onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
      onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
      ownerId: input.user.uid,
      ownerEmail: ownerEmail || null,
      ...pocketLedgerStorageDocFields(cid),
      sharedWith: (row as { sharedWith?: unknown }).sharedWith ?? [],
      sharedWithEmails,
      sharedWithEmailsLower: sharedWithEmailsLowerFromList(sharedWithEmails),
      planId: (row as { planId?: unknown }).planId ?? null,
      planOwnerUid: input.user.uid,
      isDeleted: false,
      createdAt: toTs((row as { createdAt?: unknown }).createdAt) ?? Timestamp.now(),
    };

    // 3) Upload first (root, files, documents). Throws on server error -> company stays local.
    const up = await uploadRestoredCompanyToPocketBase({
      companyId: cid,
      rootDoc,
      docs,
      replaceCurrent: false,
      onProgress: (label, detail) => progress(label, detail),
    });

    // 4) Only now flip the local row to PocketBase online.
    progress("Finalizing", "Switching company to PocketBase online");
    await promoteLocalCompanyRowToOnline(cid, {
      ...(row as unknown as Record<string, unknown>),
      id: cid,
      ownerId: input.user.uid,
      ownerEmail: ownerEmail || null,
      isOwned: true,
      storageOption: "firebase",
      syncPolicy: "online",
      syncedFromCloud: false,
      onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
      onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
      ...pocketLedgerStorageDocFields(cid),
    } as Parameters<typeof promoteLocalCompanyRowToOnline>[1]);
    registerPocketBaseCompanyId(cid);

    // 5) Report `local:` refs that are still on documents (file bytes missing on this device).
    const missing = new Set<string>();
    try {
      for (const coll of cols) {
        await yieldToMain();
        const after = await listCompanyDocsFromBrowserDb(cid, coll, { forBackupMerge: true });
        for (const r of after) collectLocalRefs(r, missing);
      }
    } catch {
      /* best-effort report */
    }

    return {
      ok: true,
      uploaded: up.uploaded,
      attachments: up.attachments,
      missingLocalFiles: missing.size,
      missingSample: Array.from(missing).slice(0, 5),
    };
  } catch (e) {
    return { ...empty, message: e instanceof Error ? e.message : String(e) };
  }
}