"use client";

import { getDefaultCurrencyForCountry } from "@/lib/worldCurrencies";
import { getFiscalRangeForCountry } from "@/lib/fiscalRange";
import { patchFirebaseLedgerCompanySyncEntry } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";
import { initializeCompanyDataClient } from "@/lib/initializeCompanyDataClient";
import {
  getLocalCompanyById,
  listLocalCompanies,
  upsertLocalCompany,
  type LocalCompanyDoc,
} from "@/lib/localCompanyStore";
import { ONLINE_DATA_SERVER_POCKETBASE_ID } from "@/lib/onlineDataServer";
import { pullPocketBaseCompanyRegistry } from "@/lib/pocketbaseData/pbAppSession";
import { getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { registerPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { ensurePocketBaseCompany, pbWriteCompanyRoot } from "@/lib/pocketbaseData/pbSync";
import {
  SERVER_MANAGE_COMPANY_ID,
  SERVER_MANAGE_COMPANY_NAME,
} from "@/lib/plServerPackedApp";

export { SERVER_MANAGE_COMPANY_ID, SERVER_MANAGE_COMPANY_NAME };

function nameMatches(value: unknown): boolean {
  return String(value || "").trim().toLowerCase() === SERVER_MANAGE_COMPANY_NAME;
}

function findExistingId(
  remote: Array<{ id: string; name?: string }>,
  local: Array<{ id: string; name?: string }>
): string | null {
  const all = [...remote, ...local];
  const byId = all.find((r) => String(r.id || "").trim() === SERVER_MANAGE_COMPANY_ID);
  if (byId?.id) return String(byId.id);
  const byName = all.find((r) => nameMatches(r.name));
  if (byName?.id) return String(byName.id);
  return null;
}

function toIso(value: Date): string {
  try {
    return value.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

let inflight: Promise<{ id: string; created: boolean } | null> | null = null;

export async function ensureServerManageCompany(opts: {
  ownerId: string;
  ownerEmail?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  if (inflight) return inflight;
  inflight = runEnsure(opts);
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function runEnsure(opts: {
  ownerId: string;
  ownerEmail?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  const ownerId = String(opts.ownerId || "").trim();
  const ownerEmail = String(opts.ownerEmail || "").trim();
  if (!ownerId) return null;
  if (!getValidPocketBaseAuth()) return null;

  let remoteRows: Array<{ id: string; name: string; data: Record<string, unknown> }> = [];
  try {
    const remote = await pullPocketBaseCompanyRegistry();
    remoteRows = remote.rows.map((r) => ({
      id: r.id,
      name: String(r.data?.name || ""),
      data: r.data || {},
    }));
  } catch {
    remoteRows = [];
  }

  let localRows: LocalCompanyDoc[] = [];
  try {
    localRows = await listLocalCompanies({ includeDeleted: true });
  } catch {
    localRows = [];
  }

  const existingId = findExistingId(remoteRows, localRows);
  if (existingId) {
    registerPocketBaseCompanyId(existingId);
    const remoteHit = remoteRows.find((r) => r.id === existingId);
    const localHit = await getLocalCompanyById(existingId, { includeDeleted: true });
    if (!localHit && remoteHit) {
      await upsertLocalCompany({
        ...remoteHit.data,
        id: existingId,
        name: remoteHit.name || SERVER_MANAGE_COMPANY_NAME,
        ownerId: String(remoteHit.data.ownerId || ownerId),
        ownerEmail: String(remoteHit.data.ownerEmail || ownerEmail || "") || null,
        storageOption: "firebase",
        onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
        onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
        syncPolicy: "online",
        syncedFromCloud: true,
        authoritativeCompanyId: existingId,
        isOwned: true,
        isDeleted: false,
      } as LocalCompanyDoc);
    }
    try {
      await ensurePocketBaseCompany(existingId, {
        createIfMissing: true,
        info: {
          name: (remoteHit?.name || localHit?.name || SERVER_MANAGE_COMPANY_NAME) as string,
        },
      });
    } catch {
      /* already on server, or transient */
    }
    return { id: existingId, created: false };
  }

  const country = "Nepal";
  const currency = getDefaultCurrencyForCountry(country);
  const fy = getFiscalRangeForCountry(country);
  const now = Date.now();
  const planExpiryIso = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();
  const companyId = SERVER_MANAGE_COMPANY_ID;
  const fyStart = toIso(fy.start);
  const fyEnd = toIso(fy.end);
  const storageFields = pocketLedgerStorageDocFields(companyId);

  const row: LocalCompanyDoc = {
    id: companyId,
    name: SERVER_MANAGE_COMPANY_NAME,
    ownerId,
    ownerEmail: ownerEmail || null,
    address: "",
    phone: "",
    email: "",
    pan: "",
    country,
    currencyCode: currency.currencyCode,
    currencySymbol: currency.symbol,
    password: null,
    logoUrl: null,
    fiscalYearStart: fyStart,
    fiscalYearEnd: fyEnd,
    storageOption: "firebase",
    onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
    onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
    ...storageFields,
    createdAt: now,
    sharedWith: [],
    sharedWithEmails: ownerEmail ? [ownerEmail] : [],
    planId: "basic",
    planOwnerUid: ownerId,
    accountPlanAuthorityVersion: 1,
    planExpiry: planExpiryIso,
    isDeleted: false,
    syncedFromCloud: true,
    syncPolicy: "online",
    authoritativeCompanyId: companyId,
    isOwned: true,
    interCompanyAccountNo: "SMC-001",
    interCompanyCompanyCode: "SRVMNGCO",
    adminUsername: null,
  };

  registerPocketBaseCompanyId(companyId);
  patchFirebaseLedgerCompanySyncEntry(companyId, { data: true });
  await upsertLocalCompany(row);

  await ensurePocketBaseCompany(companyId, {
    createIfMissing: true,
    info: {
      name: SERVER_MANAGE_COMPANY_NAME,
      country,
      currencyCode: currency.currencyCode,
      fiscalYearStartMs: fy.start.getTime(),
      fiscalYearEndMs: fy.end.getTime(),
      planId: "basic",
    },
  });

  await pbWriteCompanyRoot(
    companyId,
    {
      name: SERVER_MANAGE_COMPANY_NAME,
      interCompanyAccountNo: "SMC-001",
      interCompanyCompanyCode: "SRVMNGCO",
      address: "",
      phone: "",
      email: "",
      pan: "",
      country,
      currencyCode: currency.currencyCode,
      currencySymbol: currency.symbol,
      password: null,
      logoUrl: null,
      fiscalYearStart: fyStart,
      fiscalYearEnd: fyEnd,
      storageOption: "firebase",
      onlineServerId: ONLINE_DATA_SERVER_POCKETBASE_ID,
      onlineDataBackend: ONLINE_DATA_SERVER_POCKETBASE_ID,
      ...storageFields,
      ownerId,
      ownerEmail,
      createdAt: now,
      sharedWith: [],
      sharedWithEmails: ownerEmail ? [ownerEmail] : [],
      planId: "basic",
      planOwnerUid: ownerId,
      accountPlanAuthorityVersion: 1,
      planExpiry: planExpiryIso,
      isDeleted: false,
    },
    "set",
    { throwOnError: true }
  );

  try {
    await initializeCompanyDataClient(companyId, ownerId);
  } catch (e) {
    console.warn("[ensureServerManageCompany] ledger defaults failed", e);
  }

  return { id: companyId, created: true };
}
