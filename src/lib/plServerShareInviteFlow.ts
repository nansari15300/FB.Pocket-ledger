"use client";

import { query, collection, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getElectronLocalServerApi, type LocalAppServerAccessTokenSummary, isLocalAppServerSharingActive, resolveLocalAppServerSharingPort } from "@/lib/electronLocalServer";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  getLocalCompanyUsersRecords,
  parseLocalCompanyUserRows,
  upsertUserInList,
  withLocalCompanyUsersWriteLock,
} from "@/lib/localCompanyUsers";
import { normalizeLocalCompanyAppRole } from "@/lib/localCompanyAppRoles";
import { sendLocalServerShareInviteAlert, localServerShareAlertUrlOptions } from "@/lib/plServerShareInvite";
import {
  buildPlServerInviteUrlList,
} from "@/lib/plServerPublicHostUrl";
import { preferPlServerUrlsForClient, orderPlServerUrlsWithPreferred } from "@/lib/plServerClientUrlPick";
import { pickDefaultPlServerShareUrl } from "@/lib/plServerGateInviteLink";
import { normalizeServerUrl, addLocalServerGate, listGates, updateLocalServerGate, getActiveGate, writeActiveGateId } from "@/lib/gates/gateStore";
import { fetchGateServerAccessContext, verifyPlSharingServerCapable } from "@/lib/gates/gateServerFetch";
import { rewritePlServerListingUrlsPort } from "@/lib/plServerPublicHostUrl";
import {
  applyPlServerAccessContextPayload,
  persistDevClientAccessToken,
} from "@/lib/plServerAccessContext";
import { refreshActiveLocalServerGateContext, dispatchGateChanged, applyActiveGateRuntime } from "@/lib/gates/gateRuntime";
import type { GateRecord } from "@/lib/gates/gateTypes";
import { bumpLocalCompanyRegistry } from "@/lib/applyStripePlanToLocalCompany";
import { flushPendingBrowserDbSave } from "@/lib/localSqlite";

const PL_SERVER_URL_PROBE_TIMEOUT_MS = 8_000;

export type PlServerShareUserRow = {
  tokenId: string;
  email: string;
  shareEmail?: string;
  loginUsername?: string;
  uid?: string | null;
  name: string;
  role: string;
  allowedCompanyIds: string[];
  createdAt: string | null;
  lastUsedAt: string | null;
};

const PROCESSED_INVITE_KEY = "pl_local_server_share_processed_v1";

/** Login username se Gmail guess — Add Person dialog Gmail require karta hai. */
export function guessGmailCandidatesForLoginUsername(raw: string): string[] {
  const login = String(raw || "").trim().toLowerCase();
  if (!login) return [];
  if (login.includes("@")) return [login];
  return [`${login}@gmail.com`, `${login}@googlemail.com`];
}

export type FirestoreUserProfileHint = {
  id: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  online?: boolean;
  lastSeen?: unknown;
};

export async function lookupFirestoreUserProfileByHint(input: {
  email?: string;
  loginUsername?: string;
}): Promise<FirestoreUserProfileHint | null> {
  const tries = new Set<string>();
  for (const raw of [input.email, input.loginUsername]) {
    for (const em of guessGmailCandidatesForLoginUsername(String(raw || ""))) {
      tries.add(em);
    }
  }
  for (const em of tries) {
    const snap = await getDocs(query(collection(firestore, "users"), where("email", "==", em)));
    if (snap.empty) continue;
    const d = snap.docs[0]!;
    return { id: d.id, ...(d.data() as object) } as FirestoreUserProfileHint;
  }
  return null;
}

export async function backfillLocalCompanyUserShareMeta(
  companyId: string,
  localUserId: string,
  meta: { shareEmail: string; uid?: string | null }
): Promise<void> {
  const cid = String(companyId || "").trim();
  const userId = String(localUserId || "").trim();
  const shareEmail = String(meta.shareEmail || "")
    .trim()
    .toLowerCase();
  const nextUid = meta.uid ? String(meta.uid).trim() : "";
  if (!cid || !userId || !shareEmail.includes("@")) return;

  await withLocalCompanyUsersWriteLock(cid, async () => {
    // Inside lock + fresh read — concurrent Manage Sharing role saves won't be stomped.
    const fresh = await getLocalCompanyById(cid, { includeDeleted: true });
    if (!fresh) return;
    const rows = parseLocalCompanyUserRows((fresh as { localCompanyUsers?: unknown }).localCompanyUsers);
    const idx = rows.findIndex((r) => r.id === userId);
    if (idx < 0) return;
    const row = rows[idx]!;
    if (row.shareEmail === shareEmail && row.uid) return;
    const patched = {
      ...row,
      shareEmail: row.shareEmail || shareEmail,
      uid: row.uid || (nextUid || null),
    };
    if (patched.shareEmail === row.shareEmail && patched.uid === row.uid) return;

    const nextRows = [...rows];
    nextRows[idx] = patched;
    await upsertLocalCompany({
      ...(fresh as LocalCompanyDoc),
      id: cid,
      localCompanyUsers: nextRows,
      updatedAt: Date.now(),
    });
    await flushPendingBrowserDbSave();
    bumpLocalCompanyRegistry();
    void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
      notifyPlServerHostCompanyMetaSaved(cid, { localCompanyUsers: nextRows })
    );
  });
}

async function resolveRecipientUidByEmail(email: string): Promise<string | null> {
  const em = String(email || "").trim().toLowerCase();
  if (!em.includes("@")) return null;
  const snap = await getDocs(query(collection(firestore, "users"), where("email", "==", em)));
  if (snap.empty) return null;
  const row = snap.docs[0]!.data() as { uid?: string };
  return String(row.uid || snap.docs[0]!.id || "").trim() || null;
}

export function orderPlServerUrlsForProbe(urls: string[], serverPort?: number): string[] {
  const port = Number(serverPort) || 0;
  const list = port > 0 ? rewritePlServerListingUrlsPort(urls, port) : urls;
  const ordered = preferPlServerUrlsForClient(list);
  if (port <= 0) return ordered;
  return [...ordered].sort((a, b) => {
    const portOf = (raw: string) => {
      try {
        return Number(new URL(raw).port) || port;
      } catch {
        return 0;
      }
    };
    const aHit = portOf(a) === port ? 0 : 1;
    const bHit = portOf(b) === port ? 0 : 1;
    return aHit - bHit;
  });
}

export async function tryPlServerUrlsUntilConnected(
  urls: string[],
  accessToken: string,
  preferredUrl?: string,
  serverPort?: number
): Promise<{ serverUrl: string; context: Awaited<ReturnType<typeof fetchGateServerAccessContext>> } | null> {
  const tok = accessToken.trim();
  const port = Number(serverPort) || 0;
  const normalizedUrls =
    port > 0 ? rewritePlServerListingUrlsPort(urls, port) : urls.map((u) => normalizeServerUrl(u)).filter(Boolean);
  const preferred =
    preferredUrl && port > 0
      ? rewritePlServerListingUrlsPort([preferredUrl], port)[0] || normalizeServerUrl(preferredUrl)
      : normalizeServerUrl(preferredUrl || "");
  const ordered = preferred
    ? orderPlServerUrlsWithPreferred(preferred, normalizedUrls)
    : orderPlServerUrlsForProbe(normalizedUrls, port);
  for (const url of ordered) {
    const ctx = await fetchGateServerAccessContext(url, tok, {
      timeoutMs: PL_SERVER_URL_PROBE_TIMEOUT_MS,
    });
    if (ctx.error) continue;
    const capable = await verifyPlSharingServerCapable(url, tok, {
      timeoutMs: PL_SERVER_URL_PROBE_TIMEOUT_MS,
    });
    if (!capable) continue;
    return { serverUrl: url, context: ctx };
  }
  return null;
}

function findGateByUrlAndToken(serverUrl: string, accessToken: string): GateRecord | null {
  const norm = normalizeServerUrl(serverUrl);
  const tok = accessToken.trim();
  const sameUrl = listGates().filter(
    (g) => g.type === "local_server" && normalizeServerUrl(g.serverUrl || "") === norm
  );
  if (!sameUrl.length) return null;
  const exactTok = sameUrl.find((g) => (g.accessToken || "").trim() === tok);
  if (exactTok) return exactTok;
  // Token badal gaya (naya share) — same URL pe latest gate reuse, naya duplicate mat banao
  return [...sameUrl].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))[0] ?? null;
}

/** Receiver: probe IPs, bind gate, mirror companies — ledger data local server se aata hai. */
export async function autoConnectFromPlServerShareNotification(input: {
  serverUrls: string[];
  accessToken: string;
  gateLabel?: string;
  companyId?: string | null;
  serverPort?: number;
}): Promise<{ gate: GateRecord; serverUrl: string } | null> {
  const accessToken = "";

  const hit = await tryPlServerUrlsUntilConnected(
    input.serverUrls,
    accessToken,
    undefined,
    input.serverPort
  );
  if (!hit) return null;

  persistDevClientAccessToken("");

  let gate = findGateByUrlAndToken(hit.serverUrl, accessToken);
  if (!gate) {
    gate = listGates().find(
      (g) =>
        g.type === "local_server" && normalizeServerUrl(g.serverUrl || "") === hit.serverUrl
    ) ?? null;
  }
  if (!gate) {
    gate = addLocalServerGate({
      label: input.gateLabel?.trim() || "Shared server",
      serverUrl: hit.serverUrl,
      accessToken: "",
    });
  } else {
    const { updateLocalServerGate } = await import("@/lib/gates/gateStore");
    gate = updateLocalServerGate(gate.id, {
      label: input.gateLabel?.trim() || gate.label,
      serverUrl: hit.serverUrl,
      accessToken: "",
    });
  }

  const ctx = await refreshActiveLocalServerGateContext(gate);
  if (ctx.error) return null;

  applyPlServerAccessContextPayload(
    {
      unrestricted: ctx.unrestricted,
      allowedCompanyIds: ctx.allowedCompanyIds,
      label: ctx.label ?? undefined,
      companies: ctx.companies ?? undefined,
    },
    gate.id
  );
  writeActiveGateId(gate.id);
  applyActiveGateRuntime(gate);
  dispatchGateChanged();

  const { syncPlServerSharedCompaniesToLocalSqlite } = await import("@/lib/plServerClientCompanyDelta");
  await syncPlServerSharedCompaniesToLocalSqlite({
    pullFullLedger: true,
  }).catch(() => undefined);

  const companyId = String(input.companyId || "").trim();
  if (companyId) {
    const { syncPlServerSharedCompanyById } = await import("@/lib/plServerClientCompanyDelta");
    await syncPlServerSharedCompanyById(companyId, { pullFullLedger: true }).catch(() => undefined);
  }

  return { gate, serverUrl: hit.serverUrl };
}

export function readProcessedPlServerShareInviteIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PROCESSED_INVITE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function markPlServerShareInviteProcessed(id: string): void {
  if (typeof window === "undefined" || !id) return;
  const set = readProcessedPlServerShareInviteIds();
  set.add(id);
  const trimmed = [...set].slice(-200);
  try {
    localStorage.setItem(PROCESSED_INVITE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

export function tokenRowsForCompany(
  tokens: LocalAppServerAccessTokenSummary[],
  companyId?: string | null
): PlServerShareUserRow[] {
  const cid = String(companyId || "").trim();
  return tokens
    .filter((t) => {
      if (!t.email) return false;
      if (!cid) return true;
      const ids = t.allowedCompanyIds || [];
      return ids.length === 0 || ids.includes(cid);
    })
    .map((t) => ({
      tokenId: t.id,
      email: String(t.email || "").trim().toLowerCase(),
      name: t.label || t.email || "User",
      role: "manager",
      allowedCompanyIds: t.allowedCompanyIds || [],
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));
}

/** Token-free PLServer: shared login users from company SQLite doc. */
export async function listPlServerShareUserRowsFromCompany(
  companyId: string,
  ownerEmail?: string | null
): Promise<PlServerShareUserRow[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const doc = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!doc) return [];
  const owner = String(ownerEmail || (doc as { ownerEmail?: string | null }).ownerEmail || "")
    .trim()
    .toLowerCase();
  const ownerLocal = owner.includes("@") ? owner.split("@")[0]!.trim() : owner;
  const users = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
  return users
    .filter((u) => {
      const role = String(u.role || "").trim().toLowerCase();
      if (role === "owner") return false;
      const un = u.username.trim().toLowerCase();
      if (owner && un === owner) return false;
      if (ownerLocal && un === ownerLocal) return false;
      return true;
    })
    .map((u) => {
      const username = u.username.trim();
      const emailLike = username.includes("@") ? username.toLowerCase() : "";
      let shareEmail =
        typeof u.shareEmail === "string" && u.shareEmail.includes("@")
          ? u.shareEmail.trim().toLowerCase()
          : emailLike;
      if (!shareEmail.includes("@")) {
        for (const other of users) {
          if (other.id === u.id) continue;
          const otherUn = other.username.trim().toLowerCase();
          if (otherUn.includes("@") && otherUn.split("@")[0] === username.toLowerCase()) {
            shareEmail = otherUn;
            break;
          }
          const otherShare = String(other.shareEmail || "")
            .trim()
            .toLowerCase();
          if (otherShare.includes("@") && otherShare.split("@")[0] === username.toLowerCase()) {
            shareEmail = otherShare;
            break;
          }
        }
      }
      const emailForLookup =
        shareEmail ||
        emailLike ||
        guessGmailCandidatesForLoginUsername(username)[0] ||
        "";
      return {
        tokenId: `lcu:${u.id}`,
        email: emailForLookup,
        shareEmail: shareEmail.includes("@") ? shareEmail : undefined,
        loginUsername: username,
        uid: u.uid ?? null,
        name: u.displayName?.trim() || username,
        role: normalizeLocalCompanyAppRole(u.role),
        allowedCompanyIds: [cid],
        createdAt: null,
        lastUsedAt: null,
      };
    });
}

async function resolveLocalServerShareInviteContext(): Promise<{
  serverUrls: string[];
  publicHost: string;
  serverPort: number | undefined;
  sharingActive: boolean;
}> {
  const api = getElectronLocalServerApi();
  if (!api?.getStatus) {
    return { serverUrls: [], publicHost: "", serverPort: undefined, sharingActive: false };
  }
  const [status, config] = await Promise.all([
    api.getStatus().catch(() => null),
    api.getConfig?.().catch(() => null),
  ]);
  const serverPort = resolveLocalAppServerSharingPort(status) ?? undefined;
  return {
    serverUrls: Array.isArray(status?.urls) ? status!.urls : [],
    publicHost: String(config?.publicHost || "").trim(),
    serverPort,
    sharingActive: isLocalAppServerSharingActive(status),
  };
}

async function ensureLocalLoginUserOnCompanies(input: {
  companyIds: string[];
  loginUsername: string;
  displayName: string;
  password: string;
  role: string;
  shareEmail: string;
  recipientUid?: string | null;
}): Promise<void> {
  const role = normalizeLocalCompanyAppRole(input.role);
  const recipientUid =
    input.recipientUid ??
    (await resolveRecipientUidByEmail(input.shareEmail.trim().toLowerCase()));
  for (const companyId of input.companyIds) {
    const cid = String(companyId || "").trim();
    if (!cid) continue;
    try {
      const doc = await getLocalCompanyById(cid, { includeDeleted: true });
      if (!doc) continue;
      const rows = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown }).localCompanyUsers);
      const gmail = input.shareEmail.trim().toLowerCase();
      const next = upsertUserInList(rows, {
        username: input.loginUsername.trim(),
        displayName: input.displayName.trim(),
        role,
        password: input.password,
        uid: recipientUid,
        shareEmail: gmail,
      });
      const gmailIdx = next.findIndex((u) => u.username.toLowerCase() === gmail);
      if (gmailIdx >= 0 && gmail !== input.loginUsername.trim().toLowerCase()) {
        next[gmailIdx] = {
          ...next[gmailIdx],
          role,
          displayName: next[gmailIdx].displayName || input.displayName.trim(),
          uid: input.recipientUid ? String(input.recipientUid).trim() : next[gmailIdx].uid,
        };
      }
      await upsertLocalCompany({
        ...(doc as LocalCompanyDoc),
        id: cid,
        localCompanyUsers: next,
        updatedAt: Date.now(),
      });
      await flushPendingBrowserDbSave();
      bumpLocalCompanyRegistry();
      void import("@/lib/plServerCompanyMetaSync").then(({ notifyPlServerHostCompanyMetaSaved }) =>
        notifyPlServerHostCompanyMetaSaved(cid)
      );
    } catch (e) {
      throw e;
    }
  }
}

export type InviteUserToPlServerShareInput = {
  recipientEmail: string;
  displayName: string;
  loginUsername: string;
  password: string;
  role: string;
  allowedCompanyIds: string[];
  senderUserId: string;
  senderEmail?: string | null;
  senderName?: string | null;
  serverUrls: string[];
  publicHost?: string;
  serverPort?: number;
  gateLabel?: string;
  companyNames?: string;
};

export async function inviteUserToPlServerShare(
  input: InviteUserToPlServerShareInput
): Promise<{ ok: true; tokenId: string } | { ok: false; reason: string }> {
  const email = input.recipientEmail.trim().toLowerCase();
  if (!email.includes("@")) {
    return { ok: false, reason: "Enter a valid Gmail address." };
  }

  const companyIds = input.allowedCompanyIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!companyIds.length) {
    return { ok: false, reason: "Select at least one local company to share." };
  }

  const loginUsername = input.loginUsername.trim();
  const password = input.password.trim();
  if (!loginUsername || !password) {
    return { ok: false, reason: "Login username and password are required for remote users." };
  }

  await ensureLocalLoginUserOnCompanies({
    companyIds,
    loginUsername,
    displayName: input.displayName.trim() || email,
    password,
    role: input.role,
    shareEmail: email,
    recipientUid: await resolveRecipientUidByEmail(email),
  });

  const tokenId = `share:${email}`;
  const serverCtx = await resolveLocalServerShareInviteContext();
  const urls = buildPlServerInviteUrlList({
    urls: input.serverUrls.length ? input.serverUrls : serverCtx.serverUrls,
    publicHost: input.publicHost || serverCtx.publicHost,
    port: input.serverPort ?? serverCtx.serverPort,
  });
  const primary = pickDefaultPlServerShareUrl(urls) || urls[0] || "";

  if (primary && input.senderUserId) {
    const invite = await sendLocalServerShareInviteAlert({
      recipientEmail: email,
      senderUserId: input.senderUserId,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      serverUrl: primary,
      serverUrls: urls.length ? urls : [primary],
      serverPort: input.serverPort ?? serverCtx.serverPort,
      accessToken: "",
      gateLabel: input.gateLabel || "Shared Pocket Ledger server",
      tokenLabel: input.displayName.trim() || email,
      companyNames: input.companyNames,
      companyId: companyIds.length === 1 ? companyIds[0]! : null,
      loginUsername,
    });

    if (invite.ok === false) {
      return { ok: false, reason: invite.reason || "Invite failed." };
    }
  }

  return { ok: true, tokenId };
}

async function resolveLoginUsernameForShareEmail(
  companyIds: string[],
  email: string
): Promise<string | null> {
  const em = email.trim().toLowerCase();
  if (!em) return null;
  for (const cid of companyIds) {
    const rows = await getLocalCompanyUsersRecords(cid);
    const match = rows.find(
      (r) =>
        r.username.toLowerCase() === em ||
        r.displayName.toLowerCase() === em ||
        r.username.toLowerCase() === em.split("@")[0]
    );
    if (match?.username) return match.username;
  }
  const localPart = em.split("@")[0];
  return localPart || null;
}

/** Fresh token + new Firebase invite — existing shared user ko dubara bhejo. */
export async function resendPlServerShareInvite(input: {
  tokenId: string;
  recipientEmail: string;
  displayName: string;
  allowedCompanyIds: string[];
  senderUserId: string;
  senderEmail?: string | null;
  senderName?: string | null;
  serverUrls: string[];
  publicHost?: string;
  serverPort?: number;
  gateLabel?: string;
  companyNames?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const email = input.recipientEmail.trim().toLowerCase();
  const companyIds = input.allowedCompanyIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!email.includes("@")) {
    return { ok: false, reason: "Invalid user email." };
  }
  if (!companyIds.length) {
    return { ok: false, reason: "No companies on this share." };
  }

  const recipientUid = await resolveRecipientUidByEmail(email);
  if (!recipientUid) {
    return {
      ok: false,
      reason: `${email} is not on Pocket Ledger yet. They must sign up with this Gmail first.`,
    };
  }

  const serverCtx = await resolveLocalServerShareInviteContext();
  const urls = buildPlServerInviteUrlList({
    urls: input.serverUrls.length ? input.serverUrls : serverCtx.serverUrls,
    publicHost: input.publicHost || serverCtx.publicHost,
    port: input.serverPort ?? serverCtx.serverPort,
  });
  const primary = pickDefaultPlServerShareUrl(urls) || urls[0] || "";
  if (!primary) {
    return { ok: false, reason: "Server is not running — start sharing first, then resend." };
  }

  const loginUsername = (await resolveLoginUsernameForShareEmail(companyIds, email)) || email.split("@")[0] || "";

  const invite = await sendLocalServerShareInviteAlert({
    recipientEmail: email,
    senderUserId: input.senderUserId,
    senderEmail: input.senderEmail,
    senderName: input.senderName,
    serverUrl: primary,
    serverUrls: urls.length ? urls : [primary],
    serverPort: input.serverPort ?? serverCtx.serverPort,
    accessToken: "",
    gateLabel: input.gateLabel || "Shared Pocket Ledger server",
    tokenLabel: input.displayName.trim() || email,
    companyNames: input.companyNames,
    companyId: companyIds.length === 1 ? companyIds[0]! : null,
    loginUsername,
  });

  if (invite.ok === false) {
    return { ok: false, reason: invite.reason };
  }

  return { ok: true };
}

export function notificationToShareConnectInput(n: Record<string, unknown>): {
  serverUrls: string[];
  accessToken: string;
  gateLabel?: string;
  companyId?: string | null;
  serverPort?: number;
} | null {
  const opts = localServerShareAlertUrlOptions(n);
  const serverUrls = opts.map((o) => o.url);
  if (!serverUrls.length) return null;
  const serverPort = Number(n.serverPort) || 0;
  return {
    serverUrls,
    accessToken: "",
    gateLabel: String(n.gateLabel || n.tokenLabel || "Shared server").trim() || undefined,
    companyId: String(n.companyId || "").trim() || null,
    serverPort: serverPort > 0 ? serverPort : undefined,
  };
}

/** Invite dropdown se URL pick hote hi stale gate (galat port) update karo. */
export function syncPlServerGateUrlForInvite(input: {
  serverUrl: string;
  accessToken: string;
  gateLabel?: string;
  serverPort?: number;
}): GateRecord | null {
  const port = Number(input.serverPort) || 0;
  let url = normalizeServerUrl(input.serverUrl);
  if (!url) return null;
  if (port > 0) {
    url = rewritePlServerListingUrlsPort([url], port)[0] || url;
  }
  let gate =
    findGateByUrlAndToken(url, "") ??
    null;
  if (!gate) {
    gate = addLocalServerGate({
      label: input.gateLabel?.trim() || "Shared server",
      serverUrl: url,
      accessToken: "",
    });
  } else {
    const prevUrl = normalizeServerUrl(gate.serverUrl || "");
    if (prevUrl !== url || (gate.accessToken || "").trim()) {
      gate = updateLocalServerGate(gate.id, {
        label: gate.label,
        serverUrl: url,
        accessToken: "",
      });
    }
  }
  const active = getActiveGate();
  if (
    active.type === "local_server" &&
    normalizeServerUrl(active.serverUrl || "") === url
  ) {
    writeActiveGateId(gate.id);
    applyActiveGateRuntime(gate);
    dispatchGateChanged();
  }
  return gate;
}
