/**
 * `users/*` + `app_settings/*` writes — UI/hooks yahan se call karein; raw `updateDoc`/`setDoc`/`writeBatch` hooks me nahi.
 */
import { doc, setDoc, updateDoc, writeBatch } from "@/lib/writeGateway/firestoreMutationsInternal";
import { serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";

/** Fire-and-forget user doc patch (auth bootstrap / presence). */
export function voidUpdateUsersDoc(userDocId: string, patch: Record<string, unknown>): void {
  const id = String(userDocId || "").trim();
  if (!id) return;
  void updateDoc(doc(firestore, "users", id), patch).catch(() => {});
}

/** Awaited user doc patch — error logging ke liye try/catch caller me. */
export async function updateUsersDocAwait(userDocId: string, patch: Record<string, unknown>): Promise<void> {
  const id = String(userDocId || "").trim();
  if (!id) return;
  await updateDoc(doc(firestore, "users", id), patch);
}

/** New user row seed — merge taaki partial retries safe. */
export function voidSetUsersDocMerge(userDocId: string, data: Record<string, unknown>): void {
  const id = String(userDocId || "").trim();
  if (!id) return;
  void setDoc(doc(firestore, "users", id), data, { merge: true }).catch(() => {});
}

/** SuperAdmin role mirror `users/{uid}` doc par (rules alignment). */
export async function setUsersUidDocRoleMerge(uid: string, partial: Record<string, unknown>): Promise<void> {
  const id = String(uid || "").trim();
  if (!id) return;
  await setDoc(doc(firestore, "users", id), partial, { merge: true });
}

/** Admin config shard — super-admin email list merge. */
export async function setAppSettingsAdminConfigSuperEmailsMerge(superAdminEmails: unknown[]): Promise<void> {
  await setDoc(doc(firestore, "app_settings", "admin_config"), { superAdminEmails }, { merge: true });
}

/** Presence heartbeat — `lastSeen` server time. */
export function voidUpdateUserPresence(userDocId: string, fields: { online: boolean }): void {
  voidUpdateUsersDoc(userDocId, { ...fields, lastSeen: serverTimestamp() } as Record<string, unknown>);
}

/** Legacy slug user doc → UID repoint: saari companies jinka `ownerId` purana doc id tha. */
export function voidBatchRepointCompanyOwnerIds(companyFirestoreIds: string[], newOwnerUid: string): void {
  if (!companyFirestoreIds.length) return;
  const b = writeBatch(firestore);
  for (const cid of companyFirestoreIds) {
    if (!cid) continue;
    b.update(doc(firestore, "companies", cid), { ownerId: newOwnerUid });
  }
  void b.commit().catch(() => {});
}
