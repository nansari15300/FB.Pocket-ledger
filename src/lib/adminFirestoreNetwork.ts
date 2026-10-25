"use client";

/**
 * Static / local-first build me `firebase.ts` globally `disableNetwork(firestore)` karta hai.
 * Admin Panel ko Firestore server se data chahiye — `/admin` par aate hi network on, chhodte waqt local mode me wapas off.
 */
import { disableNetwork, enableNetwork } from "firebase/firestore";
import {
  firestore,
  firestoreNetworkDisabledByApi,
  isFirestoreBlockedForServerSession,
  markFirestoreNetworkDisabledByApi,
  queueFirestoreNetworkOp,
  settleAfterFirestoreNetworkEnabled,
} from "@/lib/firebase";
import { isLocalOnlyMode } from "@/lib/localMode";

let adminShellMountDepth = 0;

/** AdminShell mount: Firestore server reachable (global features, plans, users, etc.). */
export async function enterAdminFirestoreOnline(): Promise<void> {
  adminShellMountDepth += 1;
  // Pocket Ledger Server login: Firestore stays off for the whole session.
  if (isFirestoreBlockedForServerSession()) return;
  if (adminShellMountDepth === 1) {
    await queueFirestoreNetworkOp(async () => {
      try {
        // `/admin` tab hi enable jahan pehle `disableNetwork` lag chuka ho — warna duplicate enable = da08.
        if (firestoreNetworkDisabledByApi) {
          await enableNetwork(firestore);
          await settleAfterFirestoreNetworkEnabled();
          markFirestoreNetworkDisabledByApi(false);
        }
      } catch {
        /* ignore */
      }
    });
  }
}

/** AdminShell unmount: local-only app me wapas dashboard jaisa offline Firestore. */
export async function leaveAdminFirestoreOnline(): Promise<void> {
  adminShellMountDepth = Math.max(0, adminShellMountDepth - 1);
  if (adminShellMountDepth > 0) return;
  if (isFirestoreBlockedForServerSession()) return;
  if (!isLocalOnlyMode()) return;
  await queueFirestoreNetworkOp(async () => {
    try {
      await disableNetwork(firestore);
      markFirestoreNetworkDisabledByApi(true);
    } catch {
      /* ignore */
    }
  });
}
