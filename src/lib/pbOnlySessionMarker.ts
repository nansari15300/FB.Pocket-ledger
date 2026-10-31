/**
 * Dependency-free "Pocket Ledger Server login only" check (no Firebase session; PocketBase is the data server).
 * Same marker firebase.ts uses to keep Firestore offline for the page load (`pl_app_session_kind_v1`).
 * Kept import-free so quota / storage / sync modules can use it without import cycles.
 */
export const PB_ONLY_APP_SESSION_KIND_KEY = "pl_app_session_kind_v1";

export function isPocketBaseOnlyAppSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PB_ONLY_APP_SESSION_KIND_KEY) === "pocketbase";
  } catch {
    return false;
  }
}
