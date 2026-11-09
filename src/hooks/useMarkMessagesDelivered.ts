"use client";

import { writeBatch } from "@/lib/writeGateway/pbWrites";
import { useEffect, useRef } from "react";
import { collection, query, where, orderBy } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";

/**
 * When the current user (recipient) is online on any page, mark messages
 * addressed to them as "delivered" so the sender sees delivered status
 * even when the recipient is not on the Messages page.
 */
export function useMarkMessagesDelivered() {
  const { user, customUser } = useAuth();
  const myUserIds = [user?.uid, customUser?.userDocId].filter(Boolean) as string[];
  const messageUnsubsRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    if (!user || myUserIds.length === 0) return;

    const conversationsQuery = query(
      collection(firestore, "conversations"),
      where("participants", "array-contains", user.uid)
    );

    const unsubConvos = onSnapshot(conversationsQuery, (snapshot) => {
      const currentIds = new Set(snapshot.docs.map((d) => d.id));
      Object.keys(messageUnsubsRef.current).forEach((convId) => {
        if (!currentIds.has(convId)) {
          messageUnsubsRef.current[convId]?.();
          delete messageUnsubsRef.current[convId];
        }
      });
      snapshot.docs.forEach((convDoc) => {
        const convId = convDoc.id;
        if (messageUnsubsRef.current[convId]) return;
        const messagesQuery = query(
          collection(firestore, "conversations", convId, "messages"),
          orderBy("timestamp", "asc")
        );
        const unsubMsg = onSnapshot(messagesQuery, async (msgSnapshot) => {
          const batch = writeBatch(firestore);
          let hasUpdates = false;
          msgSnapshot.docs.forEach((docSnap) => {
            const msg = docSnap.data();
            if (myUserIds.includes(msg.receiverId) && msg.status === "sent") {
              batch.update(docSnap.ref, { status: "delivered" });
              hasUpdates = true;
            }
          });
          if (hasUpdates) await batch.commit();
        });
        messageUnsubsRef.current[convId] = unsubMsg;
      });
    });

    return () => {
      unsubConvos();
      Object.values(messageUnsubsRef.current).forEach((u) => u());
      messageUnsubsRef.current = {};
    };
  }, [user?.uid, customUser?.userDocId, myUserIds.length]);
}
