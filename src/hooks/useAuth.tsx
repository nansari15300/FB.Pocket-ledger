
"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { auth, firestore, isFirestoreBlockedForServerSession } from "@/lib/firebase";
import { slugify } from "@/lib/slugify";
import { getCountryByIP } from "@/lib/getCountryByIP";
import { doc, onSnapshot, serverTimestamp, collection, query, where, getDocs, getDoc } from "firebase/firestore";
import {
  voidUpdateUsersDoc,
  voidSetUsersDocMerge,
  voidBatchRepointCompanyOwnerIds,
  setUsersUidDocRoleMerge,
  setAppSettingsAdminConfigSuperEmailsMerge,
  updateUsersDocAwait,
} from "@/lib/writeGateway/systemUserFirestore";
import { logFirestorePermissionDenied } from "@/lib/firestoreRuleDebug";
import type { Role } from "@/utils/rbac";
import { isLocalOnlyMode } from "@/lib/localMode";
import { clearAllLocalAuthSessions, getLocalAuthUser } from "@/lib/localApiClient";
import { restoreRememberedLocalCompanyForFastBoot } from "@/lib/postAuthCompanyRoute";
import { readSelectedCompanyId } from "@/lib/selectedCompanyStorage";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronEnvironment } from "@/hooks/use-mobile";
import { clearEmbeddedSessionUnlock } from "@/lib/embeddedDeviceLock";
import { isRecoveryRoutePath } from "@/lib/recovery/recoveryMode";
import { writeAccountPlanLocalCache } from "@/lib/accountPlanLocalCache";
import { applyAccountCanonicalPlanToAllLocalCompanies } from "@/lib/applyAccountCanonicalPlanToLocalCompanies";
import { writeCurrentAppAccountIdentity } from "@/lib/appAccountIdentity";
import { clearSelectedCompanyId } from "@/lib/selectedCompanyStorage";
import { clearPermissionRoleCache } from "@/lib/permissionRoleCache";
import {
  buildPocketBaseSessionUser,
  isPocketBaseAppSessionActive,
  isPocketBaseAppSessionMarked,
  isPocketBaseSessionUser,
  PB_APP_SESSION_EVENTS,
  readPocketBaseAppProfile,
} from "@/lib/pocketbaseData/pbAppSession";

/** PWA offline: `await getDoc`/`getDocs` indefinitely hang sakta hai — pehle `onSnapshot` laga ke UI unblock (Firestore persistence + yaz fire-and-forget). */
async function firebaseReadWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  try {
    return await Promise.race([
      promise,
      new Promise<T | undefined>((_, reject) =>
        setTimeout(() => reject(new Error("pl_firebase_read_deadline")), ms),
      ),
    ]);
  } catch {
    return undefined;
  }
}

/**
 * Sign-out / token revoke ke turant baad user-doc listeners `permission-denied` dete hain — expected, noise mat bhejo.
 * Real issue tab hi log karo jab yahi session ab bhi `auth.currentUser` ho.
 */
function shouldReportAuthBootstrapPermissionDenied(firebaseUser: User): boolean {
  try {
    const cu = auth.currentUser;
    return cu != null && cu.uid === firebaseUser.uid;
  } catch {
    return false;
  }
}

export type AppUser = {
  id: string
  uid: string
  /** Firestore document id in users collection (may be slug_uid, not uid); use for presence/updates */
  userDocId?: string
  displayName: string
  email: string
  role: Role
  companyId: string | null
  isActive: boolean
  /** Set at signup/login from IP (for User by country in admin) */
  country?: string
  online?: boolean
  lastSeen?: any
  accountCanonicalPlanId?: string | null
  accountCanonicalPlanExpiryMs?: number | null
  accountCanonicalStripeCustomerId?: string | null
  accountCanonicalStripeSubscriptionId?: string | null
}

/**
 * Remembered offline company unlock + selected company → synthetic Firebase-shaped user.
 * Pehle sirf `isLocalOnlyMode()` tha; ab PWA web bhi jahan valid local lock session ho — plan tier SQLite/cache se, network/auth baad mein.
 */
function tryApplyRememberedLocalCompanyAuth(
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
  setCustomUser: React.Dispatch<React.SetStateAction<AppUser | null>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  fastLocalAuthRef: React.MutableRefObject<boolean>,
): boolean {
  if (typeof window === "undefined") return false;
  const selectedCompanyId = readSelectedCompanyId();
  if (!selectedCompanyId || !restoreRememberedLocalCompanyForFastBoot()) return false;
  const localUser = getLocalAuthUser(selectedCompanyId);
  if (!localUser?.id) return false;
  fastLocalAuthRef.current = true;
  const displayName = localUser.displayName || localUser.username || "Local User";
  const localEmail = `${localUser.username || localUser.id}@local.pocket-ledger`;
  const syntheticUser = {
    uid: `local:${localUser.id}`,
    email: localEmail,
    displayName,
    isAnonymous: false,
    providerId: "local",
    getIdToken: async () => {
      throw new Error("LOCAL_FAST_START_NO_FIREBASE_TOKEN");
    },
  } as unknown as User;
  setUser(syntheticUser);
  setCustomUser({
    id: syntheticUser.uid,
    uid: syntheticUser.uid,
    userDocId: syntheticUser.uid,
    displayName,
    email: localEmail,
    role: (localUser.role || "User") as Role,
    companyId: selectedCompanyId,
    isActive: true,
  });
  setLoading(false);
  return true;
}

/**
 * Pocket Ledger Server login (`pl_users` email + password, no Firebase session) -> Firebase-shaped
 * user (`providerId: "pocketbase"`, no Firebase ID token). A Firebase session always wins.
 */
function tryApplyPocketBaseAppSession(
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
  setCustomUser: React.Dispatch<React.SetStateAction<AppUser | null>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  pbSessionRef: React.MutableRefObject<boolean>,
): boolean {
  if (typeof window === "undefined") return false;
  if (!isPocketBaseAppSessionActive()) return false;
  const profile = readPocketBaseAppProfile();
  if (!profile) return false;
  const sessionUser = buildPocketBaseSessionUser(profile);
  const identity = writeCurrentAppAccountIdentity(profile.email || sessionUser.uid);
  if (identity.changed) {
    clearPermissionRoleCache();
    clearAllLocalAuthSessions();
    clearSelectedCompanyId();
  }
  pbSessionRef.current = true;
  const role = (profile.appRole || "User") as Role;
  const displayName = sessionUser.displayName || profile.email.split("@")[0] || "User";
  setUser((prev) => (prev && isPocketBaseSessionUser(prev) && prev.uid === sessionUser.uid ? prev : sessionUser));
  setCustomUser((prev) =>
    prev && prev.uid === sessionUser.uid && prev.role === role && prev.email === profile.email
      ? prev
      : {
          id: sessionUser.uid,
          uid: sessionUser.uid,
          userDocId: sessionUser.uid,
          displayName,
          email: profile.email,
          role,
          companyId: null,
          isActive: true,
        }
  );
  setLoading(false);
  return true;
}

/** Static/APK/EXE: persisted Firebase session se turant UI — online par bhi network user-doc ka wait mat karo. */
function isEmbeddedFastAuthShell(): boolean {
  if (typeof window === "undefined") return false;
  return isStaticAppBuild() || isCapacitorNativeApp() || isElectronEnvironment();
}

/** Embedded shells (APK/EXE/static) me local synthetic auth se Firestore company list hide ho jati hai, isliye yahan real Firebase login mandatory. */
function canUseLocalSyntheticAuthFallback(): boolean {
  return !isEmbeddedFastAuthShell();
}

function applyEmbeddedFastAuthSession(
  firebaseUser: User,
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
  setCustomUser: React.Dispatch<React.SetStateAction<AppUser | null>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  setUser(firebaseUser);
  const displayNameEarly = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User";
  setCustomUser({
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    userDocId: firebaseUser.uid,
    displayName: displayNameEarly,
    email: firebaseUser.email || "",
    role: (firebaseUser.email === "nansari15300@gmail.com" ? "SuperAdmin" : "User") as Role,
    companyId: null,
    isActive: true,
  });
  setLoading(false);
}

type AuthContextType = {
  user: User | null;
  customUser: AppUser | null;
  loading: boolean;
};

type AuthProviderProps = {
    children: React.ReactNode;
    skipRedirects?: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  customUser: null,
  loading: true,
});

export const AuthProvider = ({ children, skipRedirects = false }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [customUser, setCustomUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const unsubUserDocRef = useRef<(() => void) | null>(null);
  const countryFetchedForRef = useRef<Set<string>>(new Set());
  /** Capacitor/static WebView: kabhi pehle `null` aata hai jabki IndexedDB session abhi restore ho raha ho — turant sign-out mat mano. */
  const pendingNullAuthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** APK/EXE fast-start: local remembered unlock se temporary user banta hai; Firebase aaye to replace ho jayega. */
  const fastLocalAuthRef = useRef(false);
  /** Signed in with the Pocket Ledger Server login only (no Firebase session). */
  const pbSessionRef = useRef(false);

  // `useEffect` se pehle paint: login/dashboard pe spinner flash kam — remembered local company turant hydrate.
  useLayoutEffect(() => {
    // Server login (no Firebase session): paint the account straight away.
    if (!auth.currentUser && tryApplyPocketBaseAppSession(setUser, setCustomUser, setLoading, pbSessionRef)) {
      return;
    }
    // Embedded runtime: app access ke liye real account login enforce karo (local synthetic session sirf web fallback ke liye).
    if (
      canUseLocalSyntheticAuthFallback() &&
      tryApplyRememberedLocalCompanyAuth(setUser, setCustomUser, setLoading, fastLocalAuthRef)
    ) {
      return;
    }
    // IndexedDB Firebase session: observer se pehle turant paint — hosted `/app/party` cold open par gate "Opening sign in" par na atake.
    if (auth.currentUser && !(isFirestoreBlockedForServerSession() && isPocketBaseAppSessionMarked())) {
      applyEmbeddedFastAuthSession(auth.currentUser, setUser, setCustomUser, setLoading);
    }
  }, []);

  useEffect(() => {
    // Auth flow is strictly login-based now; local guest bootstrap path intentionally removed.
    const clearPendingNullAuthTimer = () => {
      if (pendingNullAuthTimerRef.current) {
        clearTimeout(pendingNullAuthTimerRef.current);
        pendingNullAuthTimerRef.current = null;
      }
    };

    const finalizeSignedOut = () => {
      clearPendingNullAuthTimer();
      fastLocalAuthRef.current = false;
      pbSessionRef.current = false;
      // EXE/APK device-lock: agla open dubara PIN/biometric maange — Firebase session alag clear hoti hai.
      clearEmbeddedSessionUnlock();
      clearPermissionRoleCache();
      if (unsubUserDocRef.current) {
        unsubUserDocRef.current();
        unsubUserDocRef.current = null;
      }
      setUser(null);
      setCustomUser(null);
      setLoading(false);
    };

    const bootstrapUserSession = (firebaseUser: User) => {
      fastLocalAuthRef.current = false;
      pbSessionRef.current = false;
      const identity = writeCurrentAppAccountIdentity(firebaseUser.email || firebaseUser.uid);
      if (identity.changed) {
        clearPermissionRoleCache();
        clearAllLocalAuthSessions();
        clearSelectedCompanyId();
      }
      if (isLocalOnlyMode()) {
        // Local-only static/APK: Firebase session turant paint — mirror ke liye user + email zaroori.
        setUser(firebaseUser);
        const displayName = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User";
        setCustomUser({
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          userDocId: firebaseUser.uid,
          displayName,
          email: firebaseUser.email || "",
          role: (firebaseUser.email === "nansari15300@gmail.com" ? "SuperAdmin" : "User") as Role,
          companyId: null,
          isActive: true,
        });
        setLoading(false);
        void (async () => {
          const em = (firebaseUser.email || "").trim();
          const looksOffline = typeof navigator !== "undefined" && !navigator.onLine;
          const fetchCapMs = looksOffline ? 3200 : 22_000;
          const dn = firebaseUser.displayName || em.split("@")[0] || "user";
          const userDocIdByName = `${slugify(dn)}_${firebaseUser.uid}`;
          let resolvedRef: ReturnType<typeof doc> | null = null;
          try {
            const uidSnap = await firebaseReadWithDeadline(
              getDoc(doc(firestore, "users", firebaseUser.uid)),
              fetchCapMs,
            );
            if (uidSnap?.exists()) resolvedRef = doc(firestore, "users", uidSnap.id);
            else {
              const slugSnap = await firebaseReadWithDeadline(
                getDoc(doc(firestore, "users", userDocIdByName)),
                fetchCapMs,
              );
              if (slugSnap?.exists()) resolvedRef = doc(firestore, "users", slugSnap.id);
            }
            if (!resolvedRef && em && !looksOffline) {
              const snapshot = await firebaseReadWithDeadline(
                getDocs(query(collection(firestore, "users"), where("email", "==", em))),
                fetchCapMs,
              );
              const found =
                snapshot?.docs.find((d) => d.id === firebaseUser.uid || d.id === userDocIdByName) ??
                snapshot?.docs[0] ??
                null;
              if (found) resolvedRef = doc(firestore, "users", found.id);
            }
          } catch {
            return;
          }
          if (!resolvedRef) return;
          if (auth.currentUser?.uid !== firebaseUser.uid) return;
          const resolvedDocId = resolvedRef.id;
          void (async () => {
            const snap = await firebaseReadWithDeadline(getDoc(resolvedRef!), fetchCapMs);
            if (!snap?.exists()) return;
            const u = snap.data() as Record<string, unknown>;
            const planId = typeof u.accountCanonicalPlanId === "string" ? u.accountCanonicalPlanId : "";
            if (!planId.trim()) return;
            const planExpiryMs =
              typeof u.accountCanonicalPlanExpiryMs === "number" && Number.isFinite(u.accountCanonicalPlanExpiryMs)
                ? u.accountCanonicalPlanExpiryMs
                : null;
            writeAccountPlanLocalCache(firebaseUser.uid, {
              planId,
              planExpiryMs,
              stripeCustomerId:
                typeof u.accountCanonicalStripeCustomerId === "string" ? u.accountCanonicalStripeCustomerId : null,
              stripeSubscriptionId:
                typeof u.accountCanonicalStripeSubscriptionId === "string"
                  ? u.accountCanonicalStripeSubscriptionId
                  : null,
            });
            void applyAccountCanonicalPlanToAllLocalCompanies(firebaseUser.uid, {
              planId,
              planExpiryMs,
              stripeCustomerId:
                typeof u.accountCanonicalStripeCustomerId === "string" ? u.accountCanonicalStripeCustomerId : null,
              stripeSubscriptionId:
                typeof u.accountCanonicalStripeSubscriptionId === "string"
                  ? u.accountCanonicalStripeSubscriptionId
                  : null,
            });
          })();
          setCustomUser((prev) =>
            prev && prev.uid === firebaseUser.uid ? { ...prev, userDocId: resolvedDocId } : prev,
          );
        })();
        return;
      }
      // Static/APK/Electron: `users` onSnapshot / getDoc slow network par root spinner mat chipkao — SQLite UI pehle, profile baad mein merge.
      if (typeof window !== "undefined" && isEmbeddedFastAuthShell()) {
        applyEmbeddedFastAuthSession(firebaseUser, setUser, setCustomUser, setLoading);
      }
      const email = (firebaseUser.email || "").trim();
      (async () => {
        try {
          /** Airplane / captive portal: network reads cap — neeche user-doc seed writes `void` (offline resolve slow). */
          const looksOffline = typeof navigator !== "undefined" && !navigator.onLine;
          const fetchCapMs = looksOffline ? 3200 : 22_000;
          const displayName = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "user";
          const userDocIdByName = `${slugify(displayName)}_${firebaseUser.uid}`;
          let userDocRef = doc(firestore, "users", userDocIdByName);
          if (email) {
            // Prefer direct doc reads first (more rules-friendly than list query).
            let existingByEmail: any = null;
            try {
              const uidSnap = await firebaseReadWithDeadline(
                getDoc(doc(firestore, "users", firebaseUser.uid)),
                fetchCapMs,
              );
              if (uidSnap?.exists()) {
                existingByEmail = uidSnap;
              } else {
                try {
                  const slugSnap = await firebaseReadWithDeadline(
                    getDoc(doc(firestore, "users", userDocIdByName)),
                    fetchCapMs,
                  );
                  if (slugSnap?.exists()) existingByEmail = slugSnap;
                } catch (error) {
                  if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
                    logFirestorePermissionDenied({
                      page: "auth_bootstrap",
                      operation: "get",
                      path: `users/${userDocIdByName}`,
                      error,
                    });
                  }
                }
              }
            } catch (error) {
              if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
                logFirestorePermissionDenied({
                  page: "auth_bootstrap",
                  operation: "get",
                  path: `users/${firebaseUser.uid}`,
                  error,
                });
              }
            }

            // Fallback: email query for legacy docs with random IDs. If denied, continue without failing auth.
            if (!existingByEmail && !looksOffline) {
              try {
                const q = query(collection(firestore, "users"), where("email", "==", firebaseUser.email));
                const snapshot = await firebaseReadWithDeadline(getDocs(q), fetchCapMs);
                existingByEmail =
                  snapshot?.docs.find((d) => d.id === firebaseUser.uid || d.id === userDocIdByName) ??
                  snapshot?.docs[0] ??
                  null;
              } catch (error) {
                if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
                  logFirestorePermissionDenied({
                    page: "auth_bootstrap",
                    operation: "list",
                    path: "users?where=email",
                    error,
                  });
                }
              }
            }

            if (existingByEmail) {
              userDocRef = doc(firestore, "users", existingByEmail.id);
              if (existingByEmail.id !== firebaseUser.uid && existingByEmail.id !== userDocIdByName) {
                voidUpdateUsersDoc(userDocRef.id, {
                  uid: firebaseUser.uid,
                  id: firebaseUser.uid,
                  lastLogin: serverTimestamp(),
                } as Record<string, unknown>);
                void (async () => {
                  try {
                    const companiesSnap = await firebaseReadWithDeadline(
                      getDocs(
                        query(collection(firestore, "companies"), where("ownerId", "==", existingByEmail.id)),
                      ),
                      fetchCapMs,
                    );
                    if (!companiesSnap || companiesSnap.empty) return;
                    voidBatchRepointCompanyOwnerIds(
                      companiesSnap.docs.map((d) => d.id),
                      firebaseUser.uid,
                    );
                  } catch (error) {
                    if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
                      logFirestorePermissionDenied({
                        page: "auth_bootstrap",
                        operation: "list",
                        path: "companies?where=ownerId(legacy-migration)",
                        error,
                      });
                    }
                  }
                })();
              }
            } else {
              voidSetUsersDocMerge(userDocRef.id, {
                  id: firebaseUser.uid,
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0],
                  photoURL: firebaseUser.photoURL,
                  role: firebaseUser.email === "nansari15300@gmail.com" ? "SuperAdmin" : "User",
                  companyId: null,
                  isActive: true,
                  createdAt: serverTimestamp(),
                  lastLogin: serverTimestamp(),
                } as Record<string, unknown>);
            }
          } else {
            userDocRef = doc(firestore, "users", userDocIdByName);
            voidSetUsersDocMerge(userDocRef.id, {
                id: firebaseUser.uid,
                uid: firebaseUser.uid,
                email: null,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role: "User",
                companyId: null,
                isActive: true,
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
              } as Record<string, unknown>);
          }
          if (unsubUserDocRef.current) unsubUserDocRef.current();
          unsubUserDocRef.current = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            let userData = docSnap.data();
            if (userData.email === "nansari15300@gmail.com" && userData.role !== "SuperAdmin") {
              void (async () => {
                try {
                  await updateUsersDocAwait(docSnap.id, { role: "SuperAdmin" });
                } catch (error) {
                  if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
                    logFirestorePermissionDenied({
                      page: "auth_bootstrap",
                      operation: "update",
                      path: `users/${docSnap.id}`,
                      error,
                    });
                  }
                }
              })();
              userData = { ...userData, role: "SuperAdmin" };
            }
            // Sync admin role so Firestore rules (isAdmin()) allow companies/vouchers for admin dashboard
            const role = userData.role || "User";
            if (role === "SuperAdmin" || role === "CompanyAdmin") {
              const email = (firebaseUser.email ?? userData.email ?? "").trim();
              (async () => {
                try {
                  await setUsersUidDocRoleMerge(firebaseUser.uid, { id: firebaseUser.uid, uid: firebaseUser.uid, role });
                  if (email) {
                    const adminSnap = await getDoc(doc(firestore, "app_settings", "admin_config"));
                    const existing = (adminSnap.exists() ? adminSnap.data()?.superAdminEmails : null) ?? [];
                    const list = Array.isArray(existing) ? [...existing] : [];
                    if (!list.includes(email)) {
                      list.push(email);
                      await setAppSettingsAdminConfigSuperEmailsMerge(list);
                    }
                  }
                } catch (_) { /* ignore */ }
              })();
            }
            // Set user country from IP once per doc (for Admin "User by country" categorization)
            if (!userData.country && !countryFetchedForRef.current.has(docSnap.id)) {
              countryFetchedForRef.current.add(docSnap.id);
              getCountryByIP()
                .then((country) => {
                  if (country) {
                    voidUpdateUsersDoc(docSnap.id, { country } as Record<string, unknown>);
                  }
                })
                .catch(() => {});
            }

            const newCustomUser: AppUser = {
              id: firebaseUser.uid,
              uid: firebaseUser.uid,
              userDocId: docSnap.id,
              displayName: userData.displayName ?? firebaseUser.displayName ?? '',
              email: userData.email ?? firebaseUser.email ?? '',
              role: userData.role || 'User',
              companyId: userData.companyId ?? null,
              isActive: userData.isActive !== false,
              country: userData.country,
              online: userData.online,
              lastSeen: userData.lastSeen,
              accountCanonicalPlanId:
                typeof userData.accountCanonicalPlanId === "string" ? userData.accountCanonicalPlanId : null,
              accountCanonicalPlanExpiryMs:
                typeof userData.accountCanonicalPlanExpiryMs === "number" &&
                Number.isFinite(userData.accountCanonicalPlanExpiryMs)
                  ? userData.accountCanonicalPlanExpiryMs
                  : null,
              accountCanonicalStripeCustomerId:
                typeof userData.accountCanonicalStripeCustomerId === "string"
                  ? userData.accountCanonicalStripeCustomerId
                  : null,
              accountCanonicalStripeSubscriptionId:
                typeof userData.accountCanonicalStripeSubscriptionId === "string"
                  ? userData.accountCanonicalStripeSubscriptionId
                  : null,
            };

            if (newCustomUser.accountCanonicalPlanId) {
              writeAccountPlanLocalCache(firebaseUser.uid, {
                planId: newCustomUser.accountCanonicalPlanId,
                planExpiryMs: newCustomUser.accountCanonicalPlanExpiryMs,
                stripeCustomerId: newCustomUser.accountCanonicalStripeCustomerId,
                stripeSubscriptionId: newCustomUser.accountCanonicalStripeSubscriptionId,
              });
              void applyAccountCanonicalPlanToAllLocalCompanies(firebaseUser.uid, {
                planId: newCustomUser.accountCanonicalPlanId,
                planExpiryMs: newCustomUser.accountCanonicalPlanExpiryMs,
                stripeCustomerId: newCustomUser.accountCanonicalStripeCustomerId,
                stripeSubscriptionId: newCustomUser.accountCanonicalStripeSubscriptionId,
              });
            }

            setCustomUser((prevUser) => {
              if (prevUser &&
                  prevUser.id === newCustomUser.id &&
                  prevUser.displayName === newCustomUser.displayName &&
                  prevUser.email === newCustomUser.email &&
                  prevUser.role === newCustomUser.role &&
                  prevUser.companyId === newCustomUser.companyId &&
                  prevUser.isActive === newCustomUser.isActive &&
                  prevUser.accountCanonicalPlanId === newCustomUser.accountCanonicalPlanId &&
                  prevUser.accountCanonicalPlanExpiryMs === newCustomUser.accountCanonicalPlanExpiryMs
                 ) {
                // CRITICAL FIX: Ignore online/lastSeen changes from usePresence heartbeat
                // These updates happen every 30 seconds and should NOT trigger re-renders
                // Only update if online status actually changed (not just lastSeen timestamp)
                const onlineStatusChanged = prevUser.online !== newCustomUser.online;
                
                if (onlineStatusChanged) {
                    // Only update if online status actually changed (user went offline/online)
                    return {
                        ...prevUser,
                        online: newCustomUser.online,
                        lastSeen: newCustomUser.lastSeen,
                    };
                }
                // If only lastSeen changed (heartbeat), return same reference to prevent re-render
                return prevUser;
              }
              return newCustomUser;
            });
          } else {
            /** Offline / deadlines: snapshot empty ho to spinner infinite na rahe — local SQLite/PWA routes `customUser` bina crash na ho */
            const displayFallback = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User";
            setCustomUser({
              id: firebaseUser.uid,
              uid: firebaseUser.uid,
              userDocId: firebaseUser.uid,
              displayName: displayFallback,
              email: firebaseUser.email || "",
              role: (firebaseUser.email === "nansari15300@gmail.com" ? "SuperAdmin" : "User") as Role,
              companyId: null,
              isActive: true,
            });
          }
          setLoading(false);
        }, (err: any) => {
          // Logout: listener detach se pehle token invalid → permission-denied; bug nahi.
          if (shouldReportAuthBootstrapPermissionDenied(firebaseUser)) {
            logFirestorePermissionDenied({
              page: "auth_bootstrap",
              operation: "get",
              path: `users/${userDocRef.id}`,
              error: err,
            });
          }
          setLoading(false);
        });
        } catch (e) {
          console.error("useAuth: user doc setup failed", e);
          setLoading(false);
        }
      })();
    };

    const NULL_AUTH_DEBOUNCE_MS = 500;
    /** Hosted web: kabhi `onAuthStateChanged` late — signed-out ko unblock; signed-in ko currentUser se paint. */
    const authBootTimeout = window.setTimeout(() => {
      if (fastLocalAuthRef.current || pbSessionRef.current) return;
      const cu = auth.currentUser;
      if (cu && !(isFirestoreBlockedForServerSession() && isPocketBaseAppSessionMarked())) {
        applyEmbeddedFastAuthSession(cu, setUser, setCustomUser, setLoading);
        return;
      }
      setLoading(false);
    }, 4000);
    void auth.authStateReady().then(() => {
      if (fastLocalAuthRef.current) return;
      if (auth.currentUser) return;
      window.setTimeout(() => {
        if (auth.currentUser || fastLocalAuthRef.current) return;
        setLoading(false);
      }, NULL_AUTH_DEBOUNCE_MS + 120);
    }).catch(() => {
      setLoading(false);
    });
    // Teesra arg: token refresh / identity toolkit par network fail → kabhi-kabhi observer ke bagair error;
    // `auth/network-request-failed` pe session IndexedDB me ho to currentUser zinda rehta hai — logout mat karo.
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        clearPendingNullAuthTimer();
        if (!firebaseUser) {
          pendingNullAuthTimerRef.current = setTimeout(() => {
            pendingNullAuthTimerRef.current = null;
            const cu = auth.currentUser;
            if (cu && !(isFirestoreBlockedForServerSession() && isPocketBaseAppSessionMarked())) {
              setUser(cu);
              bootstrapUserSession(cu);
              return;
            }
            if (tryApplyPocketBaseAppSession(setUser, setCustomUser, setLoading, pbSessionRef)) {
              return;
            }
            if (
              canUseLocalSyntheticAuthFallback() &&
              fastLocalAuthRef.current &&
              tryApplyRememberedLocalCompanyAuth(setUser, setCustomUser, setLoading, fastLocalAuthRef)
            ) {
              return;
            }
            finalizeSignedOut();
          }, NULL_AUTH_DEBOUNCE_MS);
          return;
        }
        // Server-only login page: a Firebase user here is a stale IndexedDB restore (firebase.ts signs it
        // out) or a fresh Firebase sign-in (page reloads). Never bootstrap it - that would read plans /
        // web access through Firebase with its ID token.
        if (isFirestoreBlockedForServerSession() && isPocketBaseAppSessionMarked()) return;
        setUser(firebaseUser);
        bootstrapUserSession(firebaseUser);
      },
      (err) => {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
        if (code === "auth/network-request-failed") {
          const cu = auth.currentUser;
          if (cu && !(isFirestoreBlockedForServerSession() && isPocketBaseAppSessionMarked())) {
            setUser(cu);
            bootstrapUserSession(cu);
            return;
          }
        }
        console.warn("useAuth: onAuthStateChanged error", err);
        setLoading(false);
      }
    );

    /** Server login / logout (this tab or another tab). */
    const onPocketBaseSessionChanged = () => {
      if (auth.currentUser) return;
      if (tryApplyPocketBaseAppSession(setUser, setCustomUser, setLoading, pbSessionRef)) return;
      if (pbSessionRef.current) finalizeSignedOut();
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "pl_pb_data_auth_v1" || ev.key === "pl_app_session_kind_v1") onPocketBaseSessionChanged();
    };
    for (const name of PB_APP_SESSION_EVENTS) window.addEventListener(name, onPocketBaseSessionChanged);
    window.addEventListener("storage", onStorage);

    return () => {
      for (const name of PB_APP_SESSION_EVENTS) window.removeEventListener(name, onPocketBaseSessionChanged);
      window.removeEventListener("storage", onStorage);
      window.clearTimeout(authBootTimeout);
      clearPendingNullAuthTimer();
      unsubscribe();
      if (unsubUserDocRef.current) {
        unsubUserDocRef.current();
        unsubUserDocRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (skipRedirects || loading) return;

    const isAuthPage = pathname === "/";
    // Recovery mode page: no app/Firebase session there (it has its own marker check), so sending it
    // to "/" made the recovery gate send it straight back = endless /recovery <-> / loop.
    const isPublicPage = isAuthPage || isRecoveryRoutePath(pathname);
    if (!user && !isPublicPage) {
      /** IndexedDB hydrate: observer kabhi turant `null` bharta hai jab `auth.currentUser` already set hai — "/" pe bhagna + phir "/" se `/company` = 3× SPA jump / "auto refresh" jaisa lagta hai */
      if (auth.currentUser) return;
      router.push("/");
    }
  }, [user, loading, pathname, router, skipRedirects]);


  return (
    <AuthContext.Provider value={useMemo(() => ({ user, customUser, loading }), [user, customUser, loading])}>
      {/* Keep tree mounted during auth hydration to avoid full-app remount flicker that looks like double refresh. */}
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
  return context;
};
