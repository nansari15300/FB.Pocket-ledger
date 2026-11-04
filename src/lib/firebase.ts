
import { initializeApp, getApps } from '@/lib/pbCompat/app';
import { getAuth, onAuthStateChanged, signOut as firebaseAuthSignOut, type Auth } from '@/lib/pbCompat/auth';
import {
  disableNetwork,
  enableNetwork,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
} from '@/lib/pbCompat/firestore';
import { getStorage } from '@/lib/pbCompat/storage';
import { setLogLevel } from '@/lib/pbCompat/app';
import { detachCompanyPickerFirestoreListenersIfAny } from '@/lib/companyPickerFirestoreDetach';
import { computeIsLocalOnlyMode } from '@/lib/dataSourceModeDefaults';
import {
  isExpectedFirestoreSnapshotPermissionDenial,
  shouldSuppressFirestorePermissionConsole,
} from '@/lib/firestorePermissionSuppress';
import { isEmbeddedOfflinePreloadClient } from '@/lib/isEmbeddedOfflinePreloadClient';
import { getEmbeddedLockShellKind } from '@/lib/embeddedDeviceLock';
import { isClientNavigatorOffline } from '@/lib/apkOnlineFirestoreWritePolicy';
import { clearEmbeddedWarmBootstrapFlags } from '@/lib/embeddedWarmBootstrapFlags';
import { isFirestoreWatchTeardownAssertionMessage } from '@/lib/firestoreWatchAssertionGuard';
import { notifyQuotaErrorForAdmin, quotaErrorKind } from '@/lib/quotaAdminNotice';

export { isFirestoreWatchTeardownAssertionMessage } from '@/lib/firestoreWatchAssertionGuard';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ""
};

/** Google OAuth "Web client" ID (google-services.json → oauth_client client_type 3). Capacitor `GoogleAuth.initialize` needs this; static APK build often omits NEXT_PUBLIC_* — same-project fallback keeps native Google login working. */
export const FIREBASE_WEB_OAUTH_CLIENT_ID =
  "469450068553-h848203thcqi3u8mvl8bvnm7gh8v5icl.apps.googleusercontent.com";

// Initialize Firebase
const apps = getApps();
const app = apps.length > 0 ? apps[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

function isFirestorePersistenceLeaseError(message: string): boolean {
  return (
    message.includes('Failed to obtain exclusive access to the persistence layer') ||
    message.includes('multi-tab synchronization has to be enabled') ||
    message.includes('Failed to obtain primary lease') ||
    (message.includes('Firestore') && message.includes('primary lease'))
  );
}

/** APK/static single WebView: single-tab cache. EXE tab strip + browser: multi-tab IndexedDB lease. */
function useFirestoreSingleTabPersistence(): boolean {
  if (typeof window === 'undefined') return false;
  if (getEmbeddedLockShellKind() === 'exe') return false;
  return isEmbeddedOfflinePreloadClient();
}

/** Extra mute window during / after `signOutWithFirestoreTeardown` (ca9 / b815). */
let firestoreWatchTeardownSuppressionUntil = 0;
/** Rate-limit user-visible warn + file trace for the same SDK assert. */
let lastFirestoreWatchAssertionReportAt = 0;

function reportSuppressedFirestoreWatchAssertion(source: string, message: string): void {
  const now = Date.now();
  if (now - lastFirestoreWatchAssertionReportAt < 2500) return;
  lastFirestoreWatchAssertionReportAt = now;
  const clipped = message.length > 500 ? `${message.slice(0, 500)}…` : message;
  try {
    // Keep one visible line so "check console" is not empty; do not use console.error (Next overlay).
    console.warn(
      `[Firestore] Suppressed SDK watch assertion (${source}). App kept running. See pl-trace.log if on EXE.`,
      clipped
    );
  } catch {
    /* ignore */
  }
  try {
    const bridge = (
      window as Window & {
        plElectronTrace?: { log?: (tag: string, event: string, detail?: unknown) => void };
      }
    ).plElectronTrace;
    bridge?.log?.('PL-FIRESTORE', 'internal_assertion_failed', {
      source,
      message: clipped,
      at: new Date(now).toISOString(),
    });
  } catch {
    /* ignore */
  }
}

function swallowFirestoreWatchAssertionEvent(
  event: Event & { preventDefault(): void; stopImmediatePropagation?: () => void },
  source: string,
  message: string
): boolean {
  if (!isFirestoreWatchTeardownAssertionMessage(message)) return false;
  try {
    event.preventDefault();
  } catch {
    /* ignore */
  }
  try {
    event.stopImmediatePropagation?.();
  } catch {
    /* ignore */
  }
  reportSuppressedFirestoreWatchAssertion(source, message);
  return true;
}

// Suppress Firebase console errors for offline/unavailable; track PERMISSION_DENIED (skip when logged out)
if (typeof window !== 'undefined') {
  const originalError = console.error;
  const isLocalFirstEnabled = () => computeIsLocalOnlyMode();
  console.error = (...args: any[]) => {
    const errorMessage = args
      .map((a) => {
        if (a == null) return "";
        if (typeof a === "string") return a;
        if (a instanceof Error) return `${a.name} ${a.message} ${a.stack || ""}`;
        if (typeof a === "object") {
          const o = a as { code?: unknown; message?: unknown; status?: unknown };
          return `${String(o.code || "")} ${String(o.message || "")} ${String(o.status || "")} ${String(a)}`;
        }
        return String(a);
      })
      .join(" ");
    // Don't log Firebase offline/unavailable errors
    if (
      errorMessage.includes('Could not reach Cloud Firestore backend') ||
      errorMessage.includes('code=unavailable') ||
      errorMessage.includes('healthy Internet connection') ||
      errorMessage.includes('operate in offline mode') ||
      (errorMessage.includes('Firestore') && errorMessage.includes('Connection failed'))
    ) {
      return;
    }
    // Firestore billing/quota cap — expected on dev; SDK backoff spam console mat bhare.
    // Storage quota (402 storage/quota-exceeded) / billing disabled: never console (no Next overlay);
    // super admins get an in-app card instead. Network layer still counts it in the online trigger log.
    if (quotaErrorKind(errorMessage) === 'storage' || quotaErrorKind(errorMessage) === 'billing') {
      notifyQuotaErrorForAdmin(errorMessage, auth.currentUser?.email);
      return;
    }
    if (
      errorMessage.includes('resource-exhausted') ||
      errorMessage.includes('Quota exceeded') ||
      (errorMessage.includes('Firestore') &&
        errorMessage.includes('maximum backoff delay to prevent overloading'))
    ) {
      void import("@/lib/onlineTriggerLog").then((m) => m.reportOnlineTriggerQuotaExceeded(errorMessage)).catch(() => undefined);
      notifyQuotaErrorForAdmin(errorMessage, auth.currentUser?.email);
      return;
    }
    // Firestore 12.x: multi-tab IndexedDB lease races during Next dev HMR / duplicate listeners.
    if (isFirestorePersistenceLeaseError(errorMessage)) {
      return;
    }
    // Firestore 12.x: signOut / wake / enableNetwork races → ca9/b815 (SDK bug). Never console.error
    // (Next turns that into "Application error / check console" with an empty console on EXE).
    if (isFirestoreWatchTeardownAssertionMessage(errorMessage)) {
      reportSuppressedFirestoreWatchAssertion('console.error', errorMessage);
      return;
    }
    // PERMISSION_DENIED after logout is expected (listeners still firing with null auth) — don't log
    if (
      (errorMessage.includes('permission-denied') ||
        errorMessage.includes('PERMISSION_DENIED') ||
        errorMessage.includes('Missing or insufficient permissions') ||
        errorMessage.includes('[Firestore Rules][Permission Denied]')) &&
      auth.currentUser == null
    ) {
      return;
    }
    // Suppress PERMISSION_DENIED during company create flow (company still creates; init may fail on rules)
    if (
      (errorMessage.includes('permission-denied') ||
        errorMessage.includes('PERMISSION_DENIED') ||
        errorMessage.includes('Missing or insufficient permissions')) &&
      (errorMessage.includes('Initialization error') ||
        args.some((a) => typeof a === 'string' && (a.includes('CreateCompanyDialog') || a.includes('initializeCompanyData'))) ||
        args.some((a) => a && typeof a === 'object' && typeof (a as Error).stack === 'string' && ((a as Error).stack?.includes('CreateCompanyDialog') || (a as Error).stack?.includes('initializeCompanyData'))))
    ) {
      return;
    }
    // PERMISSION_DENIED: local / Drive-shared SQLite — Firestore listeners expected fail; Next overlay mat dikhao.
    if (
      errorMessage.includes('permission-denied') ||
      errorMessage.includes('PERMISSION_DENIED') ||
      errorMessage.includes('Missing or insufficient permissions')
    ) {
      if (
        isLocalFirstEnabled() ||
        shouldSuppressFirestorePermissionConsole() ||
        isExpectedFirestoreSnapshotPermissionDenial(errorMessage)
      ) {
        return;
      }
      const err = args.find((a) => a && typeof a === 'object' && 'code' in a) as { code?: string; message?: string; path?: string } | undefined;
      originalError.apply(console, [
        '[Firestore PERMISSION_DENIED]',
        err?.message ?? errorMessage,
        err?.path != null ? { path: err.path } : {},
        'Stack/args:',
        ...args,
      ]);
      return;
    }
    originalError.apply(console, args);
  };

  const stringifyReason = (reason: unknown): string => {
    if (reason instanceof Error) return `${reason.message}\n${reason.stack ?? ''}`;
    if (typeof reason === 'string') return reason;
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  };

  let firestorePersistenceLeaseLogged = false;

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      const msg = stringifyReason(event.reason);
      if (isFirestorePersistenceLeaseError(msg)) {
        event.preventDefault();
        if (!firestorePersistenceLeaseLogged) {
          firestorePersistenceLeaseLogged = true;
          console.warn(
            '[Firestore persistence] IndexedDB lease conflict (multiple tabs). Using multi-tab cache where configured; reload if data looks stale.',
            event.reason
          );
        }
        return;
      }
      if (swallowFirestoreWatchAssertionEvent(event, 'unhandledrejection', msg)) {
        return;
      }
      // Uncaught Storage/Firestore quota or billing rejection: no console / overlay; admin card only.
      const reasonCode = String((event.reason as { code?: unknown } | null)?.code || '');
      if (quotaErrorKind(`${reasonCode} ${msg}`)) {
        event.preventDefault();
        notifyQuotaErrorForAdmin(`${reasonCode} ${msg}`, auth.currentUser?.email);
        return;
      }
    },
    { capture: true }
  );

  window.addEventListener(
    'error',
    (event) => {
      const msg = `${event.message ?? ''}\n${(event.error as Error)?.message ?? ''}\n${(event.error as Error)?.stack ?? ''}`;
      if (swallowFirestoreWatchAssertionEvent(event, 'window.error', msg)) {
        return;
      }
    },
    { capture: true }
  );
}
/**
 * WebChannel `Listen/channel` par kabhi-kabhi **400 Unknown SID** (stale session) — zyada parallel snapshots / tab sleep par.
 * `experimentalAutoDetectLongPolling` WebChannel fail hone par XMLHttpRequest transport use kar sakta hai; company-specific "freeze + Firestore URL error" isse kam ho sakti hai (data corrupt hone ki zarurat nahi).
 *
 * **PWA/offline:** default Firestore cache memory-only hai; IndexedDB persistence se pehli online visits ke docs `onSnapshot`/`getDoc` APK/PWA airplane mode me usable rehte (`useAuth` bootstrap `await setDoc` bina bhi snapshot chalu).
 */
/**
 * Pocket Ledger Server login (pl_users, no Firebase session): Firestore is never used in that
 * session. No listener, read or write reaches the Firestore server (no watch stream, so the
 * Firestore 12.12 ca9 assertion cannot happen). Fixed once per page load from the session
 * marker; signing in or out of the server login reloads the page.
 */
const PB_APP_SESSION_KIND_KEY = 'pl_app_session_kind_v1';

function readPocketBaseSessionMarker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PB_APP_SESSION_KIND_KEY) === 'pocketbase';
  } catch {
    return false;
  }
}

const firestoreBlockedForServerSession = readPocketBaseSessionMarker();

/** True when this page load runs a Pocket Ledger Server login: Firestore is offline and unused. */
export function isFirestoreBlockedForServerSession(): boolean {
  return firestoreBlockedForServerSession;
}

function initFirestoreInstance() {
  if (typeof window === 'undefined') {
    return getFirestore(app);
  }
  if (firestoreBlockedForServerSession) {
    try {
      // Memory cache: no IndexedDB copy of Firebase data in a server-login session.
      return initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch {
      return getFirestore(app);
    }
  }
  const forceLongPolling = process.env.NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING === '1';
  const useSingleTabPersistence = useFirestoreSingleTabPersistence();
  try {
    return initializeFirestore(app, {
      /** Hosted web + EXE tab strip: multi-tab IndexedDB; APK/static embed: single WebView tab. */
      localCache: persistentLocalCache({
        tabManager: useSingleTabPersistence
          ? persistentSingleTabManager({})
          : persistentMultipleTabManager(),
      }),
      /** Agar avi bhi Listen/channel 400 dikhe: `.env.local` me `NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING=1` + restart. */
      ...(forceLongPolling
        ? { experimentalForceLongPolling: true as const }
        : { experimentalAutoDetectLongPolling: true as const }),
    });
  } catch {
    // HMR / dobara import: Firestore already started — purana singleton wapas lo.
    return getFirestore(app);
  }
}

const firestore = initFirestoreInstance();
const storage = getStorage(app);

if (firestoreBlockedForServerSession) {
  // Network off before anything can listen: queued writes / listeners never reach the server.
  void disableNetwork(firestore).catch(() => {
    /* ignore */
  });
}

/**
 * Firestore 12.8: parallel / stacked `enableNetwork` + `disableNetwork` → PersistentWriteStream INTERNAL ASSERTION (da08).
 * Sab toggle ek hi serial chain pe — storage events, admin shell, outbox flush overlap na karein.
 */
let firestoreNetworkOpChain: Promise<unknown> = Promise.resolve();

export function queueFirestoreNetworkOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = firestoreNetworkOpChain.then(fn, fn);
  firestoreNetworkOpChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * `enableNetwork` ke turant baad active `onSnapshot` + watch stream retarget overlap → Firestore 12.12 INTERNAL ASSERTION (ca9, ve:-1).
 * Microtask + short delay se multiplexer state settle; idle/wake races ke liye pehle se thoda zyada wait.
 */
export async function settleAfterFirestoreNetworkEnabled(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => setTimeout(r, 250));
}

/**
 * Sirf jab `disableNetwork(firestore)` successfully apply ho chuka ho — flush tab hi `enableNetwork` chalayega.
 * Har flush par `enableNetwork` + active `onSnapshot` race = Firestore 12.x INTERNAL ASSERTION (ca9 / ve:-1) offline→online.
 */
export let firestoreNetworkDisabledByApi = false;
/** Embedded runtime: startup par ek hi baar proactive `enableNetwork` karo; repeat calls watcher churn badhate hain. */
let embeddedInitialNetworkEnsureDone = false;

/** Admin panel / tests: `disableNetwork` yahan ke alawa bhi ho sakta hai — outbox flush ko sahi `enableNetwork` chahiye. */
export function markFirestoreNetworkDisabledByApi(disabled: boolean): void {
  // Server-login session: Firestore stays off; never let a later flush turn it back on.
  if (firestoreBlockedForServerSession) return;
  firestoreNetworkDisabledByApi = disabled;
}

async function syncFirestoreNetworkFromLocalConfigInner(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (firestoreBlockedForServerSession) return;
  try {
    // Web par missing `dataSourceMode` ab Firebase treat — `DISABLE_FIRESTORE_NETWORK` sirf local-first + flag par.
    const localFirst = computeIsLocalOnlyMode();
    const forceOff =
      process.env.NEXT_PUBLIC_DISABLE_FIRESTORE_NETWORK === '1' && localFirst;
    if (forceOff) {
      await disableNetwork(firestore);
      firestoreNetworkDisabledByApi = true;
    } else {
      if (firestoreNetworkDisabledByApi) {
        await enableNetwork(firestore);
        await settleAfterFirestoreNetworkEnabled();
      }
      firestoreNetworkDisabledByApi = false;
    }
  } catch {
    // non-blocking
  }
}

export async function enqueueSyncFirestoreNetworkFromLocalConfig(): Promise<void> {
  await queueFirestoreNetworkOp(syncFirestoreNetworkFromLocalConfigInner);
}

/**
 * APK/static/EXE: company list / mirror se pehle Firestore server on — cache khali fresh install par "no company".
 */
export async function ensureEmbeddedFirestoreOnlineForCloudCompanyLoad(): Promise<void> {
  if (typeof window === "undefined") return;
  if (firestoreBlockedForServerSession) return;
  if (!isEmbeddedOfflinePreloadClient()) return;
  if (isClientNavigatorOffline()) return;
  await queueFirestoreNetworkOp(async () => {
    try {
      // Firestore already online ho aur pehle ensure ho chuka ho to duplicate `enableNetwork` skip (Target ID churn guard).
      if (!firestoreNetworkDisabledByApi && embeddedInitialNetworkEnsureDone) return;
      await enableNetwork(firestore);
      await settleAfterFirestoreNetworkEnabled();
      firestoreNetworkDisabledByApi = false;
      embeddedInitialNetworkEnsureDone = true;
    } catch {
      /* non-blocking */
    }
  });
}

/**
 * APK/static/EXE: offline par Firestore Write/Listen streams band — SQLite/outbox only;
 * online par dubara enable taaki `flushVoucherOutbox` / plan sync chal sake.
 */
export async function syncEmbeddedFirestoreTransportFromNavigator(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (firestoreBlockedForServerSession) return;
  if (!isEmbeddedOfflinePreloadClient()) return;
  await queueFirestoreNetworkOp(async () => {
    const offline = isClientNavigatorOffline();
    try {
      if (offline) {
        await disableNetwork(firestore);
        firestoreNetworkDisabledByApi = true;
        // Offline transition ke baad next online event par ek controlled re-enable allow karo.
        embeddedInitialNetworkEnsureDone = false;
        return;
      }
      // Online: tabhi enable jab app ne network disable kiya ho; unnecessary repeat enable se watch target collisions aate hain.
      if (!firestoreNetworkDisabledByApi) {
        embeddedInitialNetworkEnsureDone = true;
        return;
      }
      await enableNetwork(firestore);
      await settleAfterFirestoreNetworkEnabled();
      firestoreNetworkDisabledByApi = false;
      embeddedInitialNetworkEnsureDone = true;
    } catch {
      /* non-blocking */
    }
  });
}

/**
 * Logout: `disableNetwork` immediately before/after `signOut` often *worsens* Firestore 12.12 watch races (ca9 → b815).
 * Strategy: sign out only, short pause so listeners can detach, then mute known SDK assertion noise briefly.
 */
/** Logout helper: forget the server login (marker + token). Never throws. */
export async function clearPocketBaseAppSessionOnLogout(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const m = await import('@/lib/pocketbaseData/pbAppSession');
    m.clearPocketBaseAppSession({ signOutServer: true });
  } catch {
    /* ignore */
  }
}

export async function signOutWithFirestoreTeardown(authInstance: Auth): Promise<void> {
  if (typeof window !== 'undefined') {
    firestoreWatchTeardownSuppressionUntil = Date.now() + 20_000;
    // Logout: warm-ok flags hatao taaki agli login pe startup plan-sync/token dubara chale
    try {
      clearEmbeddedWarmBootstrapFlags();
    } catch {
      /* ignore */
    }
  }
  // Company picker: dual onSnapshot (owned + shared) + signOut = Firestore 12.12 ca9/b815 — detach first.
  detachCompanyPickerFirestoreListenersIfAny();
  // Pocket Ledger Server login too (server-only session + server token) - before Firebase sign-out
  // so the auth observer does not pick the server session up again.
  await clearPocketBaseAppSessionOnLogout();
  await new Promise<void>((r) => setTimeout(r, 80));
  await firebaseAuthSignOut(authInstance);
  // Let snapshot teardown run before navigation unmounts the dashboard tree.
  await new Promise<void>((r) => setTimeout(r, 450));
}

if (typeof window !== 'undefined') {
  // Pehle yahan local-first = disableNetwork() tha — outbox flush / getDocFromServer tab server tak kabhi nahi pahunchte.
  // Optional: NEXT_PUBLIC_DISABLE_FIRESTORE_NETWORK=1 se purani "offline-only" behaviour.
  const applyFirestoreNetworkMode = async () => {
    await enqueueSyncFirestoreNetworkFromLocalConfig();
  };

  void applyFirestoreNetworkMode();
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== 'dataSourceMode') return;
    void applyFirestoreNetworkMode();
  });

  // Firestore on/off is fixed per page load (server login = off), so a session switch reloads once.
  let sessionSwitchReloadScheduled = false;
  const reloadForSessionSwitch = () => {
    if (sessionSwitchReloadScheduled) return;
    sessionSwitchReloadScheduled = true;
    window.setTimeout(() => window.location.reload(), 1200);
  };
  if (firestoreBlockedForServerSession) {
    // Server sign-out (logout): leave the Firestore-off mode with a fresh page.
    window.addEventListener('pl-pb-app-session-changed', () => {
      if (!readPocketBaseSessionMarker()) reloadForSessionSwitch();
    });
    // A Firebase user showing up here is either a deliberate Firebase sign-in (LoginForm clears the
    // marker right after it) or an old Firebase login restored from IndexedDB persistence. Check after a
    // short delay: marker gone = real Firebase sign-in, reload fresh; marker still set = stale restored
    // user, sign it out so the server-only session never turns into a Firebase session.
    // Page load: a Firebase user restored from IndexedDB while the server-only marker is set is always
    // stale - sign it out at once, before anything can use its ID token (web-access / plan API routes).
    let initialAuthRestoreDone = false;
    void auth
      .authStateReady()
      .then(() => {
        initialAuthRestoreDone = true;
        if (auth.currentUser && readPocketBaseSessionMarker()) {
          void firebaseAuthSignOut(auth).catch(() => {
            /* ignore */
          });
        }
      })
      .catch(() => {
        initialAuthRestoreDone = true;
      });
    onAuthStateChanged(auth, (u) => {
      if (!u || !initialAuthRestoreDone) return;
      window.setTimeout(() => {
        if (!readPocketBaseSessionMarker()) {
          reloadForSessionSwitch();
          return;
        }
        if (!auth.currentUser) return;
        void firebaseAuthSignOut(auth).catch(() => {
          /* ignore */
        });
      }, 1500);
    });
  }
}

export { app, auth, firestore, storage };
