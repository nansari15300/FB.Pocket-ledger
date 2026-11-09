"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { useEffect, useRef } from "react";
import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { LOCAL_SERVER_SHARE_ALERT_KIND } from "@/lib/plServerShareInvite";
import {
  autoConnectFromPlServerShareNotification,
  markPlServerShareInviteProcessed,
  notificationToShareConnectInput,
  readProcessedPlServerShareInviteIds,
} from "@/lib/plServerShareInviteFlow";

/** Unread local-server share alerts → auto probe IPs, bind gate, mirror companies to selector. */
export function LocalServerShareAutoConnectManager() {
  const { user } = useAuth();
  const { reloadLocalCompanyRegistry } = useCompany();
  const busyRef = useRef(false);

  useEffect(() => {
    const uid = user?.uid?.trim();
    if (!uid) return;

    const qy = query(
      collection(firestore, "admin_notifications"),
      where("recipientUserId", "==", uid),
      where("kind", "==", LOCAL_SERVER_SHARE_ALERT_KIND)
    );

    const unsub = onSnapshot(qy, (snap) => {
      if (busyRef.current) return;
      void (async () => {
        busyRef.current = true;
        try {
          const processed = readProcessedPlServerShareInviteIds();
          for (const d of snap.docs) {
            if (processed.has(d.id)) continue;
            const data = d.data() as Record<string, unknown>;
            if (data.isRead === true) {
              markPlServerShareInviteProcessed(d.id);
              continue;
            }
            const input = notificationToShareConnectInput(data);
            if (!input) continue;

            const connected = await autoConnectFromPlServerShareNotification(input);
            if (connected) {
              markPlServerShareInviteProcessed(d.id);
              try {
                await updateDoc(doc(firestore, "admin_notifications", d.id), { isRead: true });
              } catch {
                /* ignore */
              }
              reloadLocalCompanyRegistry();
            }
          }
        } finally {
          busyRef.current = false;
        }
      })();
    });

    return () => unsub();
  }, [user?.uid, reloadLocalCompanyRegistry]);

  return null;
}
