/**
 * PocketBase-aware writes for app code outside the gateway.
 * Same signatures as `firebase/firestore`; a Pocket Ledger Server company document goes to the server
 * (SQLite mirror + outbox / server batch), every other path falls through unchanged.
 * Use this instead of importing setDoc / updateDoc / deleteDoc / addDoc / writeBatch / runTransaction
 * from "@/lib/pbCompat/firestore" in components, pages and lib code.
 */
export { setDoc, updateDoc, deleteDoc, addDoc, writeBatch, runTransaction } from "./firestoreMutationsInternal";