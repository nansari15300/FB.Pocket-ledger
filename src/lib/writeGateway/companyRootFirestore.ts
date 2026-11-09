/**
 * `companies/{companyId}` root document writes — `writeEntity` subcollection path se alag;
 * mutations sirf yahan (Firestore internal) taaki UI me raw `updateDoc`/`setDoc` na rahe.
 */
import { doc, setDoc, updateDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { firestore } from "@/lib/plClientSession";

/** Company profile/settings shard par partial patch. */
export async function updateCompanyRootFirestore(companyFirestoreId: string, patch: Record<string, unknown>): Promise<void> {
  const id = String(companyFirestoreId || "").trim();
  if (!id) throw new Error("updateCompanyRootFirestore: missing company id");
  await updateDoc(doc(firestore, "companies", id), patch);
}

/** Root doc merge create (seed / cloud upload card). */
export async function setCompanyRootFirestoreMerge(companyFirestoreId: string, data: Record<string, unknown>): Promise<void> {
  const id = String(companyFirestoreId || "").trim();
  if (!id) throw new Error("setCompanyRootFirestoreMerge: missing company id");
  await setDoc(doc(firestore, "companies", id), data, { merge: true });
}
