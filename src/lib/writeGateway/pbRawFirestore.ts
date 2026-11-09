/**
 * The raw Firestore mutation functions, with NO PocketBase routing.
 *
 * `pbCompat/firestore` (the `setDoc` / `updateDoc` / … everyone imports) must route to the Pocket
 * Ledger Server, and `firestoreMutationsInternal` must be able to write a real Firebase document
 * for the few remaining Firebase-only paths. If both used the same module they would import each
 * other, and the routed call would land back in the router (`onSnapshot` recursing into itself,
 * `setDoc` wrapping itself).
 *
 * So the functions live here once and every other module takes them from this file:
 *
 *   pbCompat/firestore      re-exports these (typed the way the app annotates them)
 *   pbReadSeam              fallback for paths the seam cannot evaluate
 *   firestoreMutationsInternal  the "real" write for Firebase documents and Firebase-only devices
 *
 * None of these perform any network call by themselves unless the call actually reaches a
 * Firebase-backed path.
 */

export { serverTimestamp } from "@/lib/pocketbaseData/pbValues";

type AnyFn = (...args: any[]) => any;

/* ------------------------------------------------------------------ */
/* lazy slots — filled once by `pbCompat/firestore`                    */
/* ------------------------------------------------------------------ */

const slots: Record<string, AnyFn | undefined> = {};

/** `pbCompat/firestore` installs the implementations right after it defines them. */
export function __installFirestoreImpls(impls: Record<string, AnyFn>): void {
  for (const [name, fn] of Object.entries(impls)) slots[name] = fn;
}

function call(name: string, args: unknown[]): unknown {
  const fn = slots[name];
  if (!fn) throw new Error(`[pl] Firestore ${name}() is not initialised yet`);
  return fn(...args);
}

/* ------------------------------------------------------------------ */
/* mutations                                                           */
/* ------------------------------------------------------------------ */

export const rawSetDoc: AnyFn = (...args: unknown[]) => call("setDoc", args);
export const rawUpdateDoc: AnyFn = (...args: unknown[]) => call("updateDoc", args);
export const rawDeleteDoc: AnyFn = (...args: unknown[]) => call("deleteDoc", args);
export const rawAddDoc: AnyFn = (...args: unknown[]) => call("addDoc", args);
export const rawWriteBatch: AnyFn = (...args: unknown[]) => call("writeBatch", args);
export const rawRunTransaction: AnyFn = (...args: unknown[]) => call("runTransaction", args);

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

export const rawGetDoc: AnyFn = (...args: unknown[]) => call("getDoc", args);
export const rawGetDocFromServer: AnyFn = (...args: unknown[]) => call("getDocFromServer", args);
export const rawGetDocFromCache: AnyFn = (...args: unknown[]) => call("getDocFromCache", args);
export const rawGetDocs: AnyFn = (...args: unknown[]) => call("getDocs", args);
export const rawGetDocsFromServer: AnyFn = (...args: unknown[]) => call("getDocsFromServer", args);
export const rawGetDocsFromCache: AnyFn = (...args: unknown[]) => call("getDocsFromCache", args);
export const rawOnSnapshot: AnyFn = (...args: unknown[]) => call("onSnapshot", args);
export const rawGetCountFromServer: AnyFn = (...args: unknown[]) => call("getCountFromServer", args);
