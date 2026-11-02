"use client";

/**
 * PL server / local_server isolation:
 * - Online gate: Firebase Storage/Firestore URLs normal.
 * - PL thin staff / remote client: Storage URL hit → console + block (PC→PC only).
 * - Host on local_server / :3001: Storage/Firestore URL hit → console warn (detect kaunsa pull/push).
 *
 * Add-user on PL Manage Sharing already writes SQLite `localCompanyUsers` only —
 * ye module accidental Firebase Storage / companies-registry side-channel dikhane ke liye hai.
 */

import { getActiveGate } from "@/lib/gates/gateStore";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { isPlHubServerClientMode, isPlRemoteServerClientMode, isPlSharingServerPortOrigin } from "@/lib/plRemoteServerClient";

export type PlFirebaseHitKind =
  | "storage_https"
  | "storage_object_path"
  | "storage_getDownloadURL"
  | "firestore_companies"
  | "firestore_other"
  | "network_fetch";

/** Staff / remote client — Firebase Storage bytes mat lao; PL `/__pl_attachment` use karo. */
export function shouldBlockFirebaseStorageOnPlServer(): boolean {
  if (typeof window === "undefined") return false;
  if (isPlServerThinStaffClient()) return true;
  if (isPlRemoteServerClientMode() || isPlHubServerClientMode()) return true;
  return false;
}

/** Host ya staff — Firebase URL/path dikhe to console me trace. */
export function shouldLogFirebaseHitsOnPlServerGate(): boolean {
  if (typeof window === "undefined") return false;
  if (shouldBlockFirebaseStorageOnPlServer()) return true;
  if (isPlSharingServerPortOrigin()) return true;
  try {
    return getActiveGate().type === "local_server";
  } catch {
    return false;
  }
}

export function looksLikeFirebaseStorageUrlOrPath(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  const l = s.toLowerCase();
  if (
    l.includes("firebasestorage.googleapis.com") ||
    l.includes("firebasestorage.app") ||
    (l.includes("googleapis.com") && l.includes("/o/")) ||
    l.includes("storage.googleapis.com")
  ) {
    return true;
  }
  // Object path style (no https) — voucher-files / company attachments.
  if (!/^https?:\/\//i.test(s) && (l.includes("voucher-files/") || l.includes("%2f"))) {
    return /(?:^|\/)(?:voucher-files|company-files|attachments)\//i.test(s) || /%2f/i.test(s);
  }
  return false;
}

/**
 * Console noise: plan / auth / users / non-ledger Firestore hide.
 * Company masters + vouchers (+ storage) hits log me dikhao.
 */
export function shouldSuppressPlFirebaseHitConsoleLog(urlOrPath: string, kind: PlFirebaseHitKind): boolean {
  const raw = String(urlOrPath || "");
  const l = raw.toLowerCase();
  if (!l) return true;

  // Auth / install / App Check — company ledger nahi
  if (
    l.includes("identitytoolkit.googleapis.com") ||
    l.includes("securetoken.googleapis.com") ||
    l.includes("firebaseinstallations.googleapis.com") ||
    l.includes("firebaseappcheck.googleapis.com") ||
    l.includes("firebaselogging") ||
    l.includes("firebaseremoteconfig")
  ) {
    return true;
  }

  // Storage company bytes — hamesha dikhao (expected isolation signal)
  if (kind === "storage_https" || kind === "storage_object_path" || kind === "storage_getDownloadURL") {
    return false;
  }
  if (looksLikeFirebaseStorageUrlOrPath(raw)) return false;

  if (l.includes("firestore.googleapis.com") || kind === "firestore_companies" || kind === "firestore_other") {
    // Plan / users / billing — hide
    if (
      l.includes("plans") ||
      l.includes("billing") ||
      l.includes("stripe") ||
      l.includes("%2fusers%2f") ||
      l.includes("/users/") ||
      l.includes("collectionid%3dusers") ||
      l.includes("collectionid=users")
    ) {
      return true;
    }
    // Only company ledger subcollections (masters / vouchers)
    const ledgerish =
      /(vouchers|parties|groups|taxes|staff|accounts|bank_accounts|expense|items|journals|recurring)/i.test(
        l
      );
    return !ledgerish;
  }

  return false;
}

export function tracePlServerFirebaseHit(
  kind: PlFirebaseHitKind,
  detail: {
    source: string;
    url?: string;
    path?: string;
    action?: "blocked" | "logged" | "allowed_sidechannel";
  }
): void {
  // Console flood off — callers still use shouldBlock* for real blocking.
  void kind;
  void detail;
}

/** Header "Move Firebase files" only: one HTTPS download of that exact leftover URL, then PB rewrite. */
const migrateFetchAllow = new Set<string>();

export function beginFirebaseMigrateFetchAllow(url: string): () => void {
  const raw = String(url || "").trim();
  if (!raw) return () => {};
  migrateFetchAllow.add(raw);
  return () => {
    migrateFetchAllow.delete(raw);
  };
}

function isFirebaseMigrateFetchAllowed(raw: string): boolean {
  const s = String(raw || "").trim();
  return !!s && migrateFetchAllow.has(s);
}

/**
 * @returns true → caller must skip Firebase Storage SDK/fetch (PL isolation).
 */
export function blockFirebaseStorageHitOnPlServer(
  source: string,
  urlOrPath: string
): boolean {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return false;
  const isHttps = /^https?:\/\//i.test(raw);
  if (!looksLikeFirebaseStorageUrlOrPath(raw) && isHttps) return false;
  if (isFirebaseMigrateFetchAllowed(raw)) return false;

  // Pocket Ledger Server login only (PocketBase attachments `pbatt:`): Firebase Storage is not the file server and
  // there is no Firebase sign-in, so never fall back to a Storage read.
  if (isPocketBaseOnlyAppSession()) return true;

  if (shouldBlockFirebaseStorageOnPlServer()) {
    tracePlServerFirebaseHit(isHttps ? "storage_https" : "storage_object_path", {
      source,
      url: isHttps ? raw : undefined,
      path: !isHttps ? raw : undefined,
      action: "blocked",
    });
    return true;
  }

  if (shouldLogFirebaseHitsOnPlServerGate() && looksLikeFirebaseStorageUrlOrPath(raw)) {
    tracePlServerFirebaseHit(isHttps ? "storage_https" : "storage_object_path", {
      source,
      url: isHttps ? raw : undefined,
      path: !isHttps ? raw : undefined,
      action: "logged",
    });
  }
  return false;
}

/** Thin staff: company list PL share + SQLite se — Firestore `companies` onSnapshot mat chalao. */
export function shouldSkipFirestoreCompanyRegistryOnPlStaff(): boolean {
  return shouldBlockFirebaseStorageOnPlServer();
}

let fetchTraceInstalled = false;

/** Boot: `window.fetch` se Firebase Storage / Firestore hosts dikhen to console. Storage thin-staff pe block. */
export function installPlServerFirebaseNetworkTrace(): void {
  if (typeof window === "undefined" || fetchTraceInstalled) return;
  fetchTraceInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : typeof Request !== "undefined" && input instanceof Request
              ? input.url
              : String(input);
      const lower = String(raw || "").toLowerCase();
      const isStorage =
        lower.includes("firebasestorage.googleapis.com") ||
        lower.includes("firebasestorage.app") ||
        (lower.includes("storage.googleapis.com") && lower.includes("/o/"));
      if (
        isStorage &&
        !isFirebaseMigrateFetchAllowed(String(raw)) &&
        (isPocketBaseOnlyAppSession() || shouldBlockFirebaseStorageOnPlServer())
      ) {
        tracePlServerFirebaseHit("network_fetch", {
          source: "window.fetch",
          url: String(raw),
          action: "blocked",
        });
        return new Response(JSON.stringify({ error: "pl_server_blocks_firebase_storage" }), {
          status: 499,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (shouldLogFirebaseHitsOnPlServerGate()) {
        const isFirestore = lower.includes("firestore.googleapis.com");
        if (isStorage || isFirestore) {
          tracePlServerFirebaseHit(isFirestore ? "firestore_other" : "network_fetch", {
            source: "window.fetch",
            url: String(raw),
            action: "logged",
          });
        }
      }
    } catch {
      /* never break fetch */
    }
    return orig(input as RequestInfo, init);
  };
}
