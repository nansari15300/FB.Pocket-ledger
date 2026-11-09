"use client";

import { getBlob, ref } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "@/lib/plClientSession";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";

/**
 * Firebase Storage download URL → path parse → `ref` + `getBlob` (modular SDK ma `refFromURL` chaina).
 * `fetch(..., cors)` WebView / private file ma fail/hang hun sakcha.
 */
export function looksLikeFirebaseStorageDownloadUrl(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes("firebasestorage.googleapis.com") ||
    l.includes("firebasestorage.app") ||
    (l.includes("googleapis.com") && l.includes("/o/")) ||
    l.includes("storage.googleapis.com")
  );
}

// Backup / large PDF: SDK getBlob ko zyada time — 10s par jaldi proxy/CORS fallback = error storm.
const GET_BLOB_RACE_MS = 45_000;

function shouldUseElectronFirebaseProxy(): boolean {
  if (typeof window === "undefined") return false;
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  const isElectron = ua.includes("electron");
  // Proxy route exists only in packaged Electron localhost server.
  return isElectron && window.location.hostname === "localhost";
}

async function tryFetchViaElectronProxy(url: string, signal?: AbortSignal): Promise<Blob | null> {
  if (!shouldUseElectronFirebaseProxy()) return null;
  try {
    const proxyUrl = `/__firebase_blob_proxy?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { method: "GET", signal });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Signed download URL — SDK fail/timeout par CORS fetch (web dev localhost + token URLs). */
export async function tryFetchFirebaseStorageDownloadUrlBlob(
  url: string,
  signal?: AbortSignal
): Promise<Blob | null> {
  return fetchFirebaseBlobFallback(url, signal);
}

async function fetchFirebaseBlobFallback(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const { blockFirebaseStorageHitOnPlServer } = await import("@/lib/plServerFirebaseHitTrace");
    if (blockFirebaseStorageHitOnPlServer("fetchFirebaseBlobFallback", url)) {
      return null;
    }
  } catch {
    /* optional guard */
  }
  // Electron packaged localhost: same-origin proxy — renderer par direct Firebase URL CORS fail hota hai.
  const viaProxy = await tryFetchViaElectronProxy(url, signal);
  if (viaProxy && viaProxy.size > 0) return viaProxy;
  if (shouldUseElectronFirebaseProxy()) return null;
  // Web (non-localhost Electron): bucket CORS configured ho to direct fetch.
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal });
    if (res.ok) return await res.blob();
    return null;
  } catch {
    return null;
  }
}

export type FirebaseStorageBlobFetchOpts = {
  companyId?: string | null;
  explicitUserRequest?: boolean;
  bypassVisiblePageCheck?: boolean;
};

export async function tryGetBlobFromFirebaseStorageDownloadUrl(
  url: string,
  signal?: AbortSignal,
  opts?: FirebaseStorageBlobFetchOpts
): Promise<Blob | null> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  if (!looksLikeFirebaseStorageDownloadUrl(url)) return null;
  if (signal?.aborted) return null;
  try {
    const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
    const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
    const companyId = opts?.companyId ?? readActiveAttachmentCompanyId() ?? null;
    if (
      !isRemoteAttachmentNetworkFetchAllowed(url, {
        companyId,
        explicitUserRequest: opts?.explicitUserRequest,
        bypassVisiblePageCheck: opts?.bypassVisiblePageCheck,
      })
    ) {
      return null;
    }
  } catch {
    /* gate optional */
  }
  try {
    const { blockFirebaseStorageHitOnPlServer } = await import("@/lib/plServerFirebaseHitTrace");
    if (blockFirebaseStorageHitOnPlServer("tryGetBlobFromFirebaseStorageDownloadUrl", url)) {
      return null;
    }
  } catch {
    /* optional guard */
  }
  const objectPath = tryGetStoragePathFromFirebaseDownloadUrl(url);
  if (!objectPath) {
    // Some Firebase/GCS URL variants may not decode into object path; still attempt network fallback.
    return await fetchFirebaseBlobFallback(url, signal);
  }
  // Use Storage SDK first so authenticated/mobile desktop-webview flows don't depend on bucket CORS for dynamic localhost origins.
  try {
    const reference = ref(storage, objectPath);
    if (signal?.aborted) return null;
    // getBlob hang (network / emulator) = thumbnail spinner stuck; race pachi fetch fallback
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), GET_BLOB_RACE_MS);
      signal?.addEventListener(
        "abort",
        () => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(null);
        },
        { once: true }
      );
    });
    const blob = await Promise.race([getBlob(reference), timedOut]);
    if (timeoutId) clearTimeout(timeoutId);
    if (blob === null) {
      return await fetchFirebaseBlobFallback(url, signal);
    }
    return blob;
  } catch {
    return await fetchFirebaseBlobFallback(url, signal);
  }
}
