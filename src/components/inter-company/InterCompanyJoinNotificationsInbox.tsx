"use client";

/**
 * Join → Notifications — pending Inter Com System join requests only.
 */
import { useEffect, useMemo, useState } from "react";
import { doc, query, collection, where, deleteDoc } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { IC_ALERTS_CHANGED, notifyInterCompanyAlertsChanged } from "@/lib/interCompany/interCompanyAlerts";
import { interCompanySettingsCardClass } from "@/lib/interCompany/interCompanyVoucherChrome";
import { cn } from "@/lib/utils";
import {
  acceptInterCompanySystemJoinRequest,
  declineInterCompanySystemJoinRequest,
  interCompanySystemJoinAlertVisibleForCompany,
  subscribeIncomingSystemJoinRequests,
  type IncomingSystemJoinRequest,
} from "@/lib/interCompany/interCompanySystemJoinRequest";

type InboxRow = {
  id: string;
  systemJoinRequestId: string;
  sourceCompanyId: string;
  sourceCompanyName: string;
  systemName?: string;
  message: string;
  createdAt: number;
  alertDocId?: string;
};

type Props = {
  companyId: string;
  enabled: boolean;
  onJoined?: () => void;
};

export function InterCompanyJoinNotificationsInbox({ companyId, enabled, onJoined }: Props) {
  const { user, customUser } = useAuth();
  const [systemJoinRequests, setSystemJoinRequests] = useState<IncomingSystemJoinRequest[]>([]);
  const [systemJoinAlertsByRecipient, setSystemJoinAlertsByRecipient] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Accept/Decline ke turant baad card hide — Firestore snapshot aane tak flash na ho */
  const [dismissedRowIds, setDismissedRowIds] = useState<Set<string>>(() => new Set());

  const recipientIds = useMemo(() => {
    const ids = new Set<string>();
    if (user?.uid) ids.add(user.uid);
    if (customUser?.userDocId) ids.add(customUser.userDocId);
    return Array.from(ids);
  }, [user?.uid, customUser?.userDocId]);

  useEffect(() => {
    if (!enabled || !user?.uid || !companyId) {
      setSystemJoinRequests([]);
      setSystemJoinAlertsByRecipient({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubs: Array<() => void> = [];

    unsubs.push(
      subscribeIncomingSystemJoinRequests(
        { targetOwnerUserId: user.uid, targetCompanyId: companyId },
        (rows) => {
          setSystemJoinRequests(rows);
          setLoadError(null);
          setLoading(false);
        }
      )
    );

    recipientIds.forEach((rid) => {
      const qSystemJoinAlert = query(
        collection(firestore, "admin_notifications"),
        where("recipientUserId", "==", rid),
        where("kind", "==", "ic_system_join_pending")
      );
      unsubs.push(
        onSnapshot(
          qSystemJoinAlert,
          (snap) => {
            const rows = snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((n) => interCompanySystemJoinAlertVisibleForCompany(n, companyId));
            setSystemJoinAlertsByRecipient((prev) => ({ ...prev, [rid]: rows }));
          },
          (err) => console.warn("[IC join] system join alerts:", err)
        )
      );
    });

    return () => unsubs.forEach((u) => u());
  }, [enabled, user?.uid, companyId, recipientIds]);

  const rows = useMemo(() => {
    const map = new Map<string, InboxRow>();
    const systemAlertRows = Object.values(systemJoinAlertsByRecipient).flat();

    // Request row par linked alert id — dedupe ke baad bhi dismiss ke liye zaroori
    const alertDocIdByRequestId = new Map<string, string>();
    systemAlertRows.forEach((n) => {
      const reqId = String(n.interCompanySystemJoinRequestId || "").trim();
      const alertId = String(n.id || "").trim();
      if (reqId && alertId) alertDocIdByRequestId.set(reqId, alertId);
    });

    for (const req of systemJoinRequests) {
      const ts = req.createdAt?.toDate?.()?.getTime() ?? Date.now();
      map.set(`sysjoin-${req.id}`, {
        id: `sysjoin-${req.id}`,
        systemJoinRequestId: req.id,
        sourceCompanyId: req.requesterCompanyId,
        sourceCompanyName: req.requesterCompanyName,
        systemName: req.systemName,
        message:
          req.message ||
          `${req.requesterCompanyName} requested to link with your company in ${req.systemName}.`,
        createdAt: ts,
        alertDocId: alertDocIdByRequestId.get(req.id),
      });
    }

    const pendingRequestIds = new Set(systemJoinRequests.map((r) => r.id));

    systemAlertRows.forEach((n) => {
      const reqId = String(n.interCompanySystemJoinRequestId || "").trim();
      const key = reqId ? `sysjoin-${reqId}` : `sysalert-${n.id}`;
      if (map.has(key)) return;
      // Request pehle accept/decline ho chuki — sirf admin_notification reh gaya ho to hide
      if (reqId && !pendingRequestIds.has(reqId)) return;
      const ts = (n.timestamp as { toDate?: () => Date })?.toDate?.()?.getTime() ?? Date.now();
      map.set(key, {
        id: key,
        systemJoinRequestId: reqId || key,
        sourceCompanyId: String(n.requesterCompanyId || ""),
        sourceCompanyName: String(n.requesterCompanyName || "Company"),
        systemName: String(n.systemName || ""),
        message: String(n.message || ""),
        createdAt: ts,
        alertDocId: String(n.id || ""),
      });
    });

    return Array.from(map.values())
      .filter((row) => !dismissedRowIds.has(row.id))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [systemJoinRequests, systemJoinAlertsByRecipient, dismissedRowIds]);

  const dismissRow = (rowId: string) => {
    setDismissedRowIds((prev) => new Set(prev).add(rowId));
  };

  const removeAlertDoc = async (alertDocId?: string) => {
    if (!alertDocId) return;
    try {
      await deleteDoc(doc(firestore, "admin_notifications", alertDocId));
      notifyInterCompanyAlertsChanged();
    } catch {
      /* optional — accept/decline helper bhi delete karta hai */
    }
  };

  const acceptSystemJoin = async (row: InboxRow) => {
    if (!user?.uid || !row.systemJoinRequestId) return;
    setBusyId(row.id);
    try {
      const result = await acceptInterCompanySystemJoinRequest({
        requestId: row.systemJoinRequestId,
        acceptedByUid: user.uid,
      });
      if (!result.ok) {
        toast.error("error" in result ? result.error : "Could not accept request.");
        return;
      }
      dismissRow(row.id);
      await removeAlertDoc(row.alertDocId);
      onJoined?.();
      toast.success(`Linked with ${row.sourceCompanyName}`);
    } catch {
      toast.error("Could not accept join request");
    } finally {
      setBusyId(null);
    }
  };

  const declineSystemJoin = async (row: InboxRow) => {
    setBusyId(row.id);
    try {
      if (row.systemJoinRequestId) {
        const result = await declineInterCompanySystemJoinRequest({
          requestId: row.systemJoinRequestId,
          declinedByUid: user?.uid || "",
        });
        if (!result.ok) {
          toast.error("error" in result ? result.error : "Could not decline request.");
          return;
        }
      }
      dismissRow(row.id);
      await removeAlertDoc(row.alertDocId);
      notifyInterCompanyAlertsChanged();
      toast.success("Join request declined");
    } catch {
      toast.error("Could not decline");
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled) {
    return (
      <p className="text-xs text-muted-foreground border-t pt-3 mt-1">
        Notifications off — system join requests will still appear in{" "}
        <strong>Messages → Alerts</strong>; this list is hidden.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground border-t mt-3 pt-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading notifications…
      </div>
    );
  }

  if (loadError) {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200 border-t mt-3 pt-3">{loadError}</p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border-t mt-3 pt-3">
        No pending system join requests. Alerts also appear in <strong>Messages → Alerts</strong>.
      </p>
    );
  }

  return (
    <ul className="space-y-2 border-t mt-3 pt-3 max-h-56 overflow-y-auto">
      {rows.map((row) => {
        const ago = row.createdAt
          ? formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })
          : "";
        return (
          <li key={row.id} className={cn(interCompanySettingsCardClass, "p-3 space-y-2 bg-muted/20")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{row.sourceCompanyName}</span>
              <Badge
                variant="outline"
                className="text-xs border-amber-600/50 bg-amber-50 text-amber-800"
              >
                System join
              </Badge>
              {ago ? <span className="text-xs text-muted-foreground">{ago}</span> : null}
            </div>
            {row.message ? (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{row.message}</p>
            ) : null}
            {row.systemName ? (
              <p className="text-xs text-muted-foreground">
                System: <strong>{row.systemName}</strong>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={busyId === row.id}
                onClick={() => void acceptSystemJoin(row)}
              >
                {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Accept"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busyId === row.id}
                onClick={() => void declineSystemJoin(row)}
              >
                Decline
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
