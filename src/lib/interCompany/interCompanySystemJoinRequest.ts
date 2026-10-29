/**
 * Inter Com System — join request from visitor to target company owner (Other companies row).
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/firebase";
import type { InterCompanyGroupCompanyOwner } from "@/lib/interCompany/interCompanyGroups";
import { ensureJoinPairCompaniesInInterCompanySystem } from "@/lib/interCompany/interCompanyGroups";
import { notifyInterCompanyAlertsChanged } from "@/lib/interCompany/interCompanyAlerts";
import { loadInterCompanyJoinSettings, saveInterCompanyJoinSettings } from "@/lib/interCompany/interCompanyJoinSettingsSync";
import { addPermanentInterCompanyJoin } from "@/lib/interCompany/interCompanyPermanentJoin";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

const REQUESTS = () => collection(firestore, "inter_company_system_join_requests");

function requestDocId(systemId: string, requesterUserId: string, targetCompanyId: string): string {
  return `${systemId}__${requesterUserId}__${targetCompanyId}`;
}

export type PendingSystemJoinRequest = {
  id?: string;
  targetCompanyId: string;
  requesterCompanyId: string;
  targetCompanyName?: string;
  requesterCompanyName?: string;
};

export type IncomingSystemJoinRequest = {
  id: string;
  systemId: string;
  systemName: string;
  targetCompanyId: string;
  targetCompanyName: string;
  requesterUserId: string;
  requesterCompanyId: string;
  requesterCompanyName: string;
  message?: string;
  createdAt?: { toDate?: () => Date };
};

/** Alerts / Messages — kis company row par dikhe */
export function interCompanySystemJoinAlertVisibleForCompany(
  n: Record<string, unknown>,
  companyId: string
): boolean {
  if (!companyId) return false;
  if (String(n.kind || "") !== "ic_system_join_pending") return false;
  const primary = String(n.companyId || "").trim();
  if (primary === companyId) return true;
  const target = String(n.targetCompanyId || "").trim();
  return target === companyId;
}

/** Messages → Alerts card body — Firestore `message` ya readable fallback */
export function formatInterCompanySystemJoinAlertMessage(n: Record<string, unknown>): string {
  const stored = String(n.message || "").trim();
  if (stored) return stored;
  const requester = String(n.requesterCompanyName || "A company").trim();
  const target = String(n.targetCompanyName || "your company").trim();
  const system = String(n.systemName || "Inter Com System").trim();
  return `${requester} wants to join ${target} in "${system}".`;
}

/** Accept/Decline ke baad Messages + Join inbox se pending alert hatao */
export async function removeInterCompanySystemJoinPendingAlerts(requestId: string): Promise<void> {
  const rid = String(requestId || "").trim();
  if (!rid || rid.startsWith("sysalert-")) return;
  try {
    const snap = await getDocs(
      query(
        collection(firestore, "admin_notifications"),
        where("interCompanySystemJoinRequestId", "==", rid)
      )
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.warn("[IC system join] clear pending alerts:", err);
  }
}

/** Alerts "Go to" — Join ribbon + target company select (Accept/Decline wahi) */
export function interCompanySystemJoinAlertsGoToPath(
  n: Record<string, unknown>,
  fallbackCompanyId?: string
): string {
  const cid = String(n.targetCompanyId || n.companyId || fallbackCompanyId || "").trim();
  const params = new URLSearchParams({ icTab: "join" });
  if (cid) params.set("companyId", cid);
  return `/inter-company?${params.toString()}`;
}

/** Target company owner — public profile / group doc (companies read permission ki zaroorat nahi) */
async function resolveTargetCompanyOwnerUserId(args: {
  targetCompanyId: string;
  rowOwnerUserId?: string;
  companyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
}): Promise<string> {
  const targetCompanyId = args.targetCompanyId.trim();
  if (!targetCompanyId) return "";

  const rowOwner = String(args.rowOwnerUserId || "").trim();
  if (rowOwner) return rowOwner;

  const fromGroup = String(args.companyOwners?.[targetCompanyId]?.ownerUserId || "").trim();
  if (fromGroup) return fromGroup;

  try {
    const profileSnap = await getDoc(doc(firestore, "inter_company_public_profiles", targetCompanyId));
    if (profileSnap.exists()) {
      const uid = String((profileSnap.data() as { ownerUserId?: string }).ownerUserId || "").trim();
      if (uid) return uid;
    }
  } catch {
    /* optional */
  }

  try {
    const snap = await getDoc(doc(firestore, "companies", targetCompanyId));
    if (snap.exists()) {
      return String((snap.data() as { ownerId?: string }).ownerId || "").trim();
    }
  } catch {
    /* permission — public profile / group owner use karo */
  }

  return "";
}

function joinRequestWriteError(err: unknown): string {
  const code = String((err as { code?: string })?.code || "");
  if (code === "permission-denied") {
    return "Firestore permission denied. Deploy updated firestore.rules and retry.";
  }
  if (code === "unavailable") {
    return "Offline — connect and try again.";
  }
  return "Could not send join request.";
}

/** Pending join requests by requester for one system — Join vs Requested button */
export async function fetchPendingSystemJoinRequests(args: {
  systemId: string;
  requesterUserId: string;
}): Promise<PendingSystemJoinRequest[]> {
  const pending: PendingSystemJoinRequest[] = [];
  if (!args.systemId || !args.requesterUserId) return pending;
  try {
    const snap = await getDocs(
      query(
        REQUESTS(),
        where("systemId", "==", args.systemId),
        where("requesterUserId", "==", args.requesterUserId),
        where("status", "==", "pending")
      )
    );
    snap.docs.forEach((d) => {
      const data = d.data();
      const targetCompanyId = String(data.targetCompanyId || "").trim();
      const requesterCompanyId = String(data.requesterCompanyId || "").trim();
      if (targetCompanyId) {
        pending.push({
          id: d.id,
          targetCompanyId,
          requesterCompanyId,
          targetCompanyName: String(data.targetCompanyName || "").trim() || undefined,
          requesterCompanyName: String(data.requesterCompanyName || "").trim() || undefined,
        });
      }
    });
  } catch (err) {
    console.warn("[IC system join] fetch pending:", err);
  }
  return pending;
}

/** Realtime — aapke bheje hue pending requests (Other table par Requested) */
export function subscribePendingSystemJoinRequests(
  args: {
    systemId: string;
    requesterUserId: string;
  },
  onData: (rows: PendingSystemJoinRequest[]) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !args.systemId || !args.requesterUserId) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(
      REQUESTS(),
      where("systemId", "==", args.systemId),
      where("requesterUserId", "==", args.requesterUserId),
      where("status", "==", "pending")
    ),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          targetCompanyId: String(data.targetCompanyId || "").trim(),
          requesterCompanyId: String(data.requesterCompanyId || "").trim(),
          targetCompanyName: String(data.targetCompanyName || "").trim() || undefined,
          requesterCompanyName: String(data.requesterCompanyName || "").trim() || undefined,
        } satisfies PendingSystemJoinRequest;
      });
      onData(rows.filter((r) => r.targetCompanyId));
    },
    (err) => {
      console.warn("[IC system join] subscribe pending:", err);
      onData([]);
    }
  );
}

/** Target owner ke liye pending requests — notifications inbox */
export async function fetchIncomingSystemJoinRequests(args: {
  targetOwnerUserId: string;
  targetCompanyId?: string;
}): Promise<IncomingSystemJoinRequest[]> {
  if (!args.targetOwnerUserId) return [];
  try {
    const snap = await getDocs(
      query(
        REQUESTS(),
        where("targetOwnerUserId", "==", args.targetOwnerUserId),
        where("status", "==", "pending")
      )
    );
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          systemId: String(data.systemId || ""),
          systemName: String(data.systemName || ""),
          targetCompanyId: String(data.targetCompanyId || ""),
          targetCompanyName: String(data.targetCompanyName || ""),
          requesterUserId: String(data.requesterUserId || ""),
          requesterCompanyId: String(data.requesterCompanyId || ""),
          requesterCompanyName: String(data.requesterCompanyName || ""),
          message: String(data.message || data.requestMessage || ""),
          createdAt: data.createdAt as IncomingSystemJoinRequest["createdAt"],
        } satisfies IncomingSystemJoinRequest;
      })
      .filter((r) => !args.targetCompanyId || r.targetCompanyId === args.targetCompanyId);
  } catch (err) {
    console.warn("[IC system join] fetch incoming:", err);
    return [];
  }
}

/** Realtime — target company par pending count (system card / company row badge) */
export function subscribeIncomingSystemJoinRequests(
  args: {
    targetOwnerUserId: string;
    targetCompanyId?: string;
    systemId?: string;
  },
  onData: (rows: IncomingSystemJoinRequest[]) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !args.targetOwnerUserId) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(
      REQUESTS(),
      where("targetOwnerUserId", "==", args.targetOwnerUserId),
      where("status", "==", "pending")
    ),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          systemId: String(data.systemId || ""),
          systemName: String(data.systemName || ""),
          targetCompanyId: String(data.targetCompanyId || ""),
          targetCompanyName: String(data.targetCompanyName || ""),
          requesterUserId: String(data.requesterUserId || ""),
          requesterCompanyId: String(data.requesterCompanyId || ""),
          requesterCompanyName: String(data.requesterCompanyName || ""),
          message: String(data.message || data.requestMessage || ""),
          createdAt: data.createdAt as IncomingSystemJoinRequest["createdAt"],
        } satisfies IncomingSystemJoinRequest;
      });
      onData(
        rows.filter((r) => {
          if (args.targetCompanyId && r.targetCompanyId !== args.targetCompanyId) return false;
          if (args.systemId && r.systemId !== args.systemId) return false;
          return true;
        })
      );
    },
    (err) => {
      console.warn("[IC system join] subscribe incoming:", err);
      onData([]);
    }
  );
}

/** Join click — target company owner ko notify; auto-link mat karo */
export async function sendInterCompanySystemJoinRequest(args: {
  systemId: string;
  systemName: string;
  systemOwnerUserId: string;
  targetCompanyId: string;
  targetCompanyName: string;
  requesterUserId: string;
  requesterCompanyId: string;
  requesterCompanyName: string;
  requesterName?: string;
  /** View com row / group doc — target owner resolve ke liye */
  targetOwnerUserIdHint?: string;
  companyOwners?: Record<string, InterCompanyGroupCompanyOwner>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authUid = auth.currentUser?.uid?.trim() || "";
  const requesterUserId = authUid || args.requesterUserId.trim();
  if (!args.systemId || !args.targetCompanyId || !requesterUserId) {
    return { ok: false, error: "Missing system or company." };
  }
  if (!authUid) {
    return { ok: false, error: "Sign in required to send a join request." };
  }
  if (args.requesterUserId.trim() && args.requesterUserId.trim() !== authUid) {
    return { ok: false, error: "Session mismatch — refresh and try again." };
  }
  if (args.requesterCompanyId === args.targetCompanyId) {
    return { ok: false, error: "Cannot join the same company." };
  }

  const targetOwnerUserId = await resolveTargetCompanyOwnerUserId({
    targetCompanyId: args.targetCompanyId,
    rowOwnerUserId: args.targetOwnerUserIdHint,
    companyOwners: args.companyOwners,
  });
  if (!targetOwnerUserId) {
    return {
      ok: false,
      error: "Could not find the target company owner. Sync public profile and retry.",
    };
  }

  const message =
    `${args.requesterName || "A user"} (${args.requesterCompanyName}) requested to link with ` +
    `${args.targetCompanyName} in Inter Com System "${args.systemName}".`;

  const reqId = requestDocId(args.systemId, requesterUserId, args.targetCompanyId);
  const reqRef = doc(REQUESTS(), reqId);

  const payload = {
    systemId: args.systemId,
    systemName: args.systemName,
    systemOwnerUserId: args.systemOwnerUserId,
    targetCompanyId: args.targetCompanyId,
    targetCompanyName: args.targetCompanyName,
    targetOwnerUserId,
    requesterUserId,
    requesterCompanyId: args.requesterCompanyId,
    requesterCompanyName: args.requesterCompanyName,
    message,
    status: "pending" as const,
    requesterLinkApplied: false,
    createdAt: serverTimestamp(),
  };

  try {
    let existingSnap: Awaited<ReturnType<typeof getDoc>> | null = null;
    try {
      existingSnap = await getDoc(reqRef);
    } catch (readErr) {
      // Legacy row / rules — id me requester uid hai to create/update dubara try
      console.warn("[IC system join] read existing request:", readErr);
    }

    if (existingSnap?.exists()) {
      const prevStatus = String((existingSnap.data() as { status?: string })?.status || "").trim();
      if (prevStatus === "pending") {
        return { ok: false, error: "Join request already pending." };
      }
      if (prevStatus === "accepted") {
        return { ok: false, error: "These companies are already linked." };
      }
      // declined / legacy / broken — pending par overwrite (update rule)
      await updateDoc(reqRef, {
        systemId: args.systemId,
        systemName: args.systemName,
        systemOwnerUserId: args.systemOwnerUserId,
        targetCompanyId: args.targetCompanyId,
        targetCompanyName: args.targetCompanyName,
        targetOwnerUserId,
        requesterUserId,
        requesterCompanyId: args.requesterCompanyId,
        requesterCompanyName: args.requesterCompanyName,
        message,
        status: "pending",
        requesterLinkApplied: false,
        resentAt: serverTimestamp(),
      });
    } else {
      try {
        await setDoc(reqRef, payload);
      } catch (writeErr) {
        const code = (writeErr as { code?: string })?.code;
        // Doc pehle se ho lekin read fail — pending par update try
        if (code === "permission-denied" || code === "already-exists") {
          await updateDoc(reqRef, {
            systemId: args.systemId,
            systemName: args.systemName,
            systemOwnerUserId: args.systemOwnerUserId,
            targetCompanyId: args.targetCompanyId,
            targetCompanyName: args.targetCompanyName,
            targetOwnerUserId,
            requesterUserId,
            requesterCompanyId: args.requesterCompanyId,
            requesterCompanyName: args.requesterCompanyName,
            message,
            status: "pending",
            requesterLinkApplied: false,
            resentAt: serverTimestamp(),
          });
        } else {
          throw writeErr;
        }
      }
    }

    try {
      await addDoc(collection(firestore, "admin_notifications"), {
        recipientUserId: targetOwnerUserId,
        companyId: args.targetCompanyId,
        message,
        timestamp: serverTimestamp(),
        isRead: false,
        type: "inter_company_system_join",
        kind: "ic_system_join_pending",
        systemId: args.systemId,
        systemName: args.systemName,
        targetCompanyId: args.targetCompanyId,
        targetCompanyName: args.targetCompanyName,
        requesterUserId,
        requesterCompanyId: args.requesterCompanyId,
        requesterCompanyName: args.requesterCompanyName,
        interCompanySystemJoinRequestId: reqId,
        attemptedBy: {
          uid: requesterUserId,
          ...(args.requesterName ? { name: args.requesterName } : {}),
        },
      });
    } catch (notifErr) {
      console.warn("[IC system join] notification failed (request saved):", notifErr);
    }

    notifyInterCompanyAlertsChanged();
    return { ok: true };
  } catch (err) {
    console.warn("[IC system join] send failed:", err);
    return { ok: false, error: joinRequestWriteError(err) };
  }
}

/** Target owner accept — dono companies link (requester side listener se sync) */
export async function acceptInterCompanySystemJoinRequest(args: {
  requestId: string;
  acceptedByUid: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reqRef = doc(REQUESTS(), args.requestId);
  try {
    const snap = await getDoc(reqRef);
    if (!snap.exists()) return { ok: false, error: "Request not found." };
    const data = snap.data() as Record<string, unknown>;
    if (String(data.status || "") !== "pending") {
      return { ok: false, error: "Request is no longer pending." };
    }

    const targetCompanyId = String(data.targetCompanyId || "").trim();
    const requesterCompanyId = String(data.requesterCompanyId || "").trim();
    const systemId = String(data.systemId || "").trim();
    if (!targetCompanyId || !requesterCompanyId) {
      return { ok: false, error: "Invalid request." };
    }

    await updateDoc(reqRef, {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedByUid: args.acceptedByUid,
    });

    // Dono companies system card me — View com Owned/Other me dikhein
    if (systemId) {
      try {
        await ensureJoinPairCompaniesInInterCompanySystem({
          systemId,
          requesterCompanyId,
          targetCompanyId,
          actingUserId: args.acceptedByUid,
        });
      } catch (err) {
        console.warn("[IC system join] ensure system companies:", err);
      }
    }

    const { settings, companyGroupId } = await loadInterCompanyJoinSettings(targetCompanyId);
    if (!settings.joinedCompanyIds.includes(requesterCompanyId)) {
      await saveInterCompanyJoinSettings({
        companyId: targetCompanyId,
        settings: {
          ...settings,
          joinedCompanyIds: [...settings.joinedCompanyIds, requesterCompanyId],
        },
        companyGroupId,
        updatedByUid: args.acceptedByUid,
      });
      addPermanentInterCompanyJoin(targetCompanyId, requesterCompanyId);
    }

    notifyInterCompanyAlertsChanged();
    await removeInterCompanySystemJoinPendingAlerts(args.requestId);
    return { ok: true };
  } catch (err) {
    console.warn("[IC system join] accept failed:", err);
    return { ok: false, error: "Could not accept join request." };
  }
}

export async function declineInterCompanySystemJoinRequest(args: {
  requestId: string;
  declinedByUid: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateDoc(doc(REQUESTS(), args.requestId), {
      status: "declined",
      declinedAt: serverTimestamp(),
      declinedByUid: args.declinedByUid,
    });
    notifyInterCompanyAlertsChanged();
    await removeInterCompanySystemJoinPendingAlerts(args.requestId);
    return { ok: true };
  } catch (err) {
    console.warn("[IC system join] decline failed:", err);
    return { ok: false, error: "Could not decline join request." };
  }
}

/** Requester client — accepted requests par apni company me link apply */
export function subscribeAcceptedSystemJoinLinksForRequester(
  requesterUserId: string,
  onSynced?: () => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !requesterUserId) return () => undefined;

  return onSnapshot(
    query(
      REQUESTS(),
      where("requesterUserId", "==", requesterUserId),
      where("status", "==", "accepted")
    ),
    (snap) => {
      void (async () => {
        for (const d of snap.docs) {
          const data = d.data();
          if (data.requesterLinkApplied === true) continue;
          const requesterCompanyId = String(data.requesterCompanyId || "").trim();
          const targetCompanyId = String(data.targetCompanyId || "").trim();
          if (!requesterCompanyId || !targetCompanyId) continue;
          try {
            const { settings, companyGroupId } = await loadInterCompanyJoinSettings(requesterCompanyId);
            if (!settings.joinedCompanyIds.includes(targetCompanyId)) {
              await saveInterCompanyJoinSettings({
                companyId: requesterCompanyId,
                settings: {
                  ...settings,
                  joinedCompanyIds: [...settings.joinedCompanyIds, targetCompanyId],
                },
                companyGroupId,
                updatedByUid: requesterUserId,
              });
              addPermanentInterCompanyJoin(requesterCompanyId, targetCompanyId);
            }
            await updateDoc(d.ref, { requesterLinkApplied: true });
          } catch (err) {
            console.warn("[IC system join] apply requester link:", err);
          }
        }
        onSynced?.();
      })();
    },
    (err) => console.warn("[IC system join] accepted subscribe:", err)
  );
}

export type AcceptedSystemJoinLink = {
  partnerCompanyId: string;
  systemId: string;
  systemName: string;
  partnerCompanyName?: string;
};

function mapAcceptedJoinDoc(
  data: Record<string, unknown>,
  sourceCompanyId: string
): AcceptedSystemJoinLink | null {
  const requesterCompanyId = String(data.requesterCompanyId || "").trim();
  const targetCompanyId = String(data.targetCompanyId || "").trim();
  const systemName = String(data.systemName || "").trim();
  const systemId = String(data.systemId || "").trim();
  if (!systemName || !systemId) return null;

  if (requesterCompanyId === sourceCompanyId && targetCompanyId) {
    return {
      partnerCompanyId: targetCompanyId,
      systemId,
      systemName,
      partnerCompanyName: String(data.targetCompanyName || "").trim() || undefined,
    };
  }
  if (targetCompanyId === sourceCompanyId && requesterCompanyId) {
    return {
      partnerCompanyId: requesterCompanyId,
      systemId,
      systemName,
      partnerCompanyName: String(data.requesterCompanyName || "").trim() || undefined,
    };
  }
  return null;
}

/** Source company ke saare accepted system joins — dropdown system name ke liye */
export function subscribeAcceptedSystemJoinsForCompany(
  sourceCompanyId: string,
  onData: (links: AcceptedSystemJoinLink[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !sourceCompanyId) {
    onData([]);
    return () => undefined;
  }

  let asRequester: AcceptedSystemJoinLink[] = [];
  let asTarget: AcceptedSystemJoinLink[] = [];

  const push = () => {
    const byPartner = new Map<string, AcceptedSystemJoinLink>();
    for (const row of [...asRequester, ...asTarget]) {
      const prev = byPartner.get(row.partnerCompanyId);
      if (!prev || row.systemName.localeCompare(prev.systemName) < 0) {
        byPartner.set(row.partnerCompanyId, row);
      }
    }
    onData([...byPartner.values()]);
  };

  const unsubA = onSnapshot(
    query(
      REQUESTS(),
      where("requesterCompanyId", "==", sourceCompanyId),
      where("status", "==", "accepted")
    ),
    (snap) => {
      asRequester = snap.docs
        .map((d) => mapAcceptedJoinDoc(d.data() as Record<string, unknown>, sourceCompanyId))
        .filter((x): x is AcceptedSystemJoinLink => x != null);
      push();
    },
    (err) => {
      onError?.(err);
      asRequester = [];
      push();
    }
  );

  const unsubB = onSnapshot(
    query(
      REQUESTS(),
      where("targetCompanyId", "==", sourceCompanyId),
      where("status", "==", "accepted")
    ),
    (snap) => {
      asTarget = snap.docs
        .map((d) => mapAcceptedJoinDoc(d.data() as Record<string, unknown>, sourceCompanyId))
        .filter((x): x is AcceptedSystemJoinLink => x != null);
      push();
    },
    (err) => {
      onError?.(err);
      asTarget = [];
      push();
    }
  );

  return () => {
    unsubA();
    unsubB();
  };
}

export type AcceptedSystemJoinPair = {
  requesterCompanyId: string;
  targetCompanyId: string;
};

/** View com — is system ke saare accepted joins (dono side partner dikhe) */
export function subscribeAcceptedSystemJoinsForSystem(
  systemId: string,
  onData: (rows: AcceptedSystemJoinPair[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !systemId) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(REQUESTS(), where("systemId", "==", systemId), where("status", "==", "accepted")),
    (snap) => {
      const rows = snap.docs
        .map((d) => {
          const data = d.data();
          const requesterCompanyId = String(data.requesterCompanyId || "").trim();
          const targetCompanyId = String(data.targetCompanyId || "").trim();
          if (!requesterCompanyId || !targetCompanyId) return null;
          return { requesterCompanyId, targetCompanyId } satisfies AcceptedSystemJoinPair;
        })
        .filter((x): x is AcceptedSystemJoinPair => x != null);
      onData(rows);
    },
    (err) => {
      onError?.(err);
      onData([]);
    }
  );
}
