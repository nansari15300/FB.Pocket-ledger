"use client";

import { addDoc, collection, query, serverTimestamp, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { buildPlServerGateInviteLink } from "@/lib/plServerGateInviteLink";
import { dedupePlServerListingUrls, rewritePlServerListingUrlsPort } from "@/lib/plServerPublicHostUrl";
import { appNavHref } from "@/lib/appNavHref";

export const LOCAL_SERVER_SHARE_ALERT_TYPE = "local_server_share";
export const LOCAL_SERVER_SHARE_ALERT_KIND = "local_server_share_invite";

async function resolveRecipientUidByEmail(email: string): Promise<string | null> {
  const raw = String(email || "").trim();
  const em = raw.toLowerCase();
  if (!em || !em.includes("@")) return null;
  const tryQuery = async (fieldEmail: string) => {
    const snap = await getDocs(query(collection(firestore, "users"), where("email", "==", fieldEmail)));
    if (snap.empty) return null;
    const row = snap.docs[0]!.data() as { uid?: string; email?: string };
    return String(row.uid || snap.docs[0]!.id || "").trim() || null;
  };
  return (await tryQuery(em)) || (raw !== em ? await tryQuery(raw) : null);
}

export function localServerShareAlertGatePath(n: Record<string, unknown>): string {
  const stored = String(n.gateInvitePath || "").trim();
  if (stored) return stored.startsWith("/") ? appNavHref(stored) : stored;
  const serverUrl = String(n.serverUrl || "").trim();
  const token = String(n.accessToken || "").trim();
  if (!serverUrl) return appNavHref("/gate");
  const params = new URLSearchParams();
  params.set("pl_gate_server", serverUrl);
  if (token) params.set("pl_gate_token", token);
  const label = String(n.gateLabel || "").trim();
  if (label) params.set("pl_gate_label", label);
  return appNavHref(`/gate?${params.toString()}`);
}

export type LocalServerShareUrlOption = {
  url: string;
  label: string;
};

function urlHostLabel(url: string): string {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === "127.0.0.1" || h === "localhost") return "This PC";
    if (/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return `LAN (${h})`;
    return `Public (${h})`;
  } catch {
    return url;
  }
}

/** All server URLs from alert — local + public when available. */
export function localServerShareAlertUrlOptions(n: Record<string, unknown>): LocalServerShareUrlOption[] {
  const raw: string[] = [];
  if (Array.isArray(n.serverUrls)) {
    for (const u of n.serverUrls) {
      const s = String(u || "").trim();
      if (s) raw.push(s);
    }
  }
  const primary = String(n.serverUrl || "").trim();
  if (primary) raw.push(primary);
  const port = Number(n.serverPort) || 0;
  const urls = port > 0 ? rewritePlServerListingUrlsPort(raw, port) : dedupePlServerListingUrls(raw);
  const out: LocalServerShareUrlOption[] = [];
  for (const u of urls) {
    out.push({ url: u, label: urlHostLabel(u) });
  }
  return out;
}

/** Messages → Alerts: local server gate invite with prefilled connect link. */
export async function sendLocalServerShareInviteAlert(input: {
  recipientEmail: string;
  senderUserId: string;
  senderEmail?: string | null;
  senderName?: string | null;
  serverUrl: string;
  serverUrls?: string[];
  serverPort?: number;
  accessToken: string;
  gateLabel?: string;
  tokenLabel?: string;
  companyNames?: string;
  companyId?: string | null;
  loginUsername?: string | null;
}): Promise<{ ok: true; recipientUserId: string } | { ok: false; reason: string }> {
  const recipientUid = await resolveRecipientUidByEmail(input.recipientEmail);
  if (!recipientUid) {
    return {
      ok: false,
      reason: `${input.recipientEmail} is not on Pocket Ledger yet. They must sign up with this Gmail first.`,
    };
  }

  const inviteLink = buildPlServerGateInviteLink({
    serverUrl: input.serverUrl,
    accessToken: "",
    gateLabel: input.gateLabel,
  });
  if (!inviteLink) {
    return { ok: false, reason: "Could not build invite link - check server URL." };
  }

  const fromLabel = String(input.senderName || input.senderEmail || "Server owner").trim();
  const companies = String(input.companyNames || "").trim();
  const tokenLabel = String(input.tokenLabel || "Shared access").trim();
  const loginHint = String(input.loginUsername || "").trim();
  const urlList = localServerShareAlertUrlOptions({
    serverUrl: input.serverUrl,
    serverUrls: input.serverUrls,
    serverPort: input.serverPort,
  });
  const message = [
    `${fromLabel} invited you to connect to their Pocket Ledger local server (${tokenLabel}).`,
    companies ? `Companies: ${companies}.` : "",
    loginHint ? `Login username: ${loginHint}.` : "",
    urlList.length
      ? `Server addresses: ${urlList.map((o) => o.label).join(", ")}. Open Messages → pick address → Connect.`
      : `Open Gate and connect: ${inviteLink}`,
  ]
    .filter(Boolean)
    .join(" ");

  const allUrls = urlList.map((o) => o.url);

  await addDoc(collection(firestore, "admin_notifications"), {
    recipientUserId: recipientUid,
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    message,
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
    isRead: false,
    type: LOCAL_SERVER_SHARE_ALERT_TYPE,
    kind: LOCAL_SERVER_SHARE_ALERT_KIND,
    companyId: input.companyId || null,
    serverUrl: input.serverUrl,
    serverUrls: allUrls.length ? allUrls : [input.serverUrl],
    serverPort: input.serverPort ?? null,
    accessToken: "",
    gateLabel: input.gateLabel || null,
    gateInvitePath: `/gate?pl_gate_server=${encodeURIComponent(input.serverUrl)}${input.gateLabel ? `&pl_gate_label=${encodeURIComponent(input.gateLabel)}` : ""}`,
    inviteLink,
    tokenLabel,
    loginUsername: loginHint || null,
    senderUserId: input.senderUserId,
    senderEmail: input.senderEmail || null,
    senderName: input.senderName || null,
  });

  return { ok: true, recipientUserId: recipientUid };
}
