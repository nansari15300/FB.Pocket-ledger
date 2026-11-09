/**
 * `user_tokens/{uid}/google/drive` — OAuth token shard; sirf gateway se likho.
 */
import { doc, setDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { firestore } from "@/lib/plClientSession";

export async function setGoogleDriveUserTokenMerge(uid: string, patch: Record<string, unknown>): Promise<void> {
  const id = String(uid || "").trim();
  if (!id) throw new Error("setGoogleDriveUserTokenMerge: missing uid");
  await setDoc(doc(firestore, "user_tokens", id, "google", "drive"), patch, { merge: true });
}
