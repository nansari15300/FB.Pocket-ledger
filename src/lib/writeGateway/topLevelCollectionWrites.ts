/**
 * Root-level collections (`payments`, `admin_notifications`, …) — sirf gateway;
 * webhooks / backup UI yahi se `addDoc` karein.
 */
import { serverTimestamp } from "@/lib/pbCompat/firestore";
import { addDoc, collection } from "@/lib/writeGateway/firestoreMutationsInternal";
import { firestore } from "@/lib/plClientSession";

/** Payment audit / webhook fallback row. */
export async function appendPaymentsCollectionDoc(data: Record<string, unknown>): Promise<void> {
  await addDoc(collection(firestore, "payments"), { ...data, createdAt: serverTimestamp() });
}

/** Admin inbox notification (backup restore, etc.). */
export async function appendAdminNotificationDoc(data: Record<string, unknown>): Promise<void> {
  await addDoc(collection(firestore, "admin_notifications"), { ...data, createdAt: serverTimestamp() });
}

/** Activity log row (admin / audit trail). */
export async function appendActivityLogDoc(data: Record<string, unknown>): Promise<void> {
  await addDoc(collection(firestore, "activity_logs"), { ...data, at: serverTimestamp() });
}
