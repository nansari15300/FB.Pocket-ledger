"use client";

/**
 * Data layer: Firestore vs Local API.
 * useCollectionFromSource – same shape as useCollection, works for both modes.
 * When local: fetch from local API, optional refetch interval. When firebase: use Firestore.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { collection, query, QuerySnapshot, DocumentData } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useDataSource } from "@/contexts/DataSourceContext";
import { createLocalApiClient } from "@/lib/localApiClient";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import {
  FIRESTORE_LISTENER_TOGGLES_EVENT,
  isLiveCollectionListenerEnabled,
} from "@/lib/firestoreListenerToggles";
import {
  BROWSER_DB_COLLECTION_BUMP,
  listCompanyDocsFromBrowserDb,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";

/** useCollectionFromSource: browser cache ko Firestore snapshot ke saath merge (static build). */
function mergeCollectionById<T extends { id: string }>(
  prev: T[] | null,
  cached: any[],
  orderByField?: string
): T[] {
  const base = prev || [];
  if (!cached.length) return base;
  const map = new Map(base.map((x) => [x.id, x]));
  for (const v of cached) map.set(v.id, v as T);
  const merged = [...map.values()];
  if (orderByField) {
    merged.sort((a: any, b: any) => {
      const dateA = a[orderByField]?.toDate ? a[orderByField].toDate() : new Date(a[orderByField]);
      const dateB = b[orderByField]?.toDate ? b[orderByField].toDate() : new Date(b[orderByField]);
      return dateA.getTime() - dateB.getTime();
    });
  }
  return merged;
}

export type UseCollectionFromSourceResult<T> = {
  data: (T & { id: string })[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

const REFETCH_INTERVAL_MS = 30_000;

/**
 * Fetch a company subcollection. When local mode uses local API; when firebase uses Firestore onSnapshot.
 * For local mode: optional updatedAfter for incremental sync (only docs updated after this timestamp).
 */
export function useCollectionFromSource<T = Record<string, unknown>>(
  companyId: string | null,
  collectionName: string,
  options?: { orderByField?: string; refetchIntervalMs?: number; updatedAfter?: number }
): UseCollectionFromSourceResult<T> {
  const { isLocalMode, localApiBaseUrl } = useDataSource();
  const [data, setData] = useState<(T & { id: string })[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const refetchRef = useRef<() => void>(() => {});
  const [listenerToggleEpoch, setListenerToggleEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setListenerToggleEpoch((n) => n + 1);
    window.addEventListener(FIRESTORE_LISTENER_TOGGLES_EVENT, bump);
    return () => window.removeEventListener(FIRESTORE_LISTENER_TOGGLES_EVENT, bump);
  }, []);

  const fetchLocal = useMemo(() => {
    if (!companyId || !isLocalMode) return null;
    const client = createLocalApiClient(localApiBaseUrl);
    const orderByField = options?.orderByField;
    const updatedAfter = options?.updatedAfter;
    return async () => {
      try {
        const params: Record<string, string> = {};
        if (updatedAfter != null) params.updatedAfter = String(updatedAfter);
        const list = await client.getCollection(companyId, collectionName, Object.keys(params).length ? params : undefined);
        let arr = (list || []).map((d) => ({ ...d, id: (d.id as string) || "" } as T & { id: string }));
        arr = arr.filter((item: any) => item.isDeleted !== true);
        if (orderByField) {
          arr.sort((a: any, b: any) => {
            const aVal = a[orderByField];
            const bVal = b[orderByField];
            const dateA = aVal?.toDate ? aVal.toDate() : new Date(aVal);
            const dateB = bVal?.toDate ? bVal.toDate() : new Date(bVal);
            return dateA.getTime() - dateB.getTime();
          });
        }
        setData(arr);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };
  }, [companyId, collectionName, isLocalMode, localApiBaseUrl, options?.orderByField, options?.updatedAfter]);

  // Local mode: fetch and optional refetch interval
  useEffect(() => {
    if (!companyId || !isLocalMode) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    if (!fetchLocal) return;
    let cancelled = false;
    const doFetch = () => { fetchLocal().then(() => {}); };
    refetchRef.current = doFetch;
    setIsLoading(true);
    doFetch();
    const intervalMs = options?.refetchIntervalMs ?? REFETCH_INTERVAL_MS;
    const tid = intervalMs > 0 ? setInterval(doFetch, intervalMs) : 0;
    return () => {
      cancelled = true;
      if (tid) clearInterval(tid);
      refetchRef.current = () => {};
    };
  }, [companyId, isLocalMode, fetchLocal, options?.refetchIntervalMs]);

  // Firebase mode: onSnapshot; static build mein browser SQLite prefetch + listen error fallback
  useEffect(() => {
    if (!companyId || isLocalMode) return;
    setIsLoading(true);
    setError(null);
    const orderByField = options?.orderByField;

    const applyBrowserMerge = (cached: any[]) => {
      const filtered = cached.filter((item: any) => item.isDeleted !== true);
      setData((prev) => mergeCollectionById<T & { id: string }>(prev, filtered, orderByField));
      setError(null);
      setIsLoading(false);
    };

    if (isStaticAppBuild()) {
      listCompanyDocsFromBrowserDb(companyId, collectionName)
        .then((cached) => {
          if (cached.length) applyBrowserMerge(cached);
        })
        .catch(() => {});
    }

    if (!isLiveCollectionListenerEnabled(collectionName)) {
      listCompanyDocsFromBrowserDb(companyId, collectionName)
        .then((cached) => {
          applyBrowserMerge(cached);
        })
        .catch(() => {
          setIsLoading(false);
        });
      return;
    }

    const q = query(collection(firestore, `companies/${companyId}/${collectionName}`));
    const unsub = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const list = snapshot.docs
          .map((d) => ({ ...d.data(), id: d.id } as T & { id: string }))
          .filter((item: any) => item.isDeleted !== true);
        let arr = list;
        if (orderByField) {
          arr = [...list].sort((a: any, b: any) => {
            const aVal = a[orderByField];
            const bVal = b[orderByField];
            const dateA = aVal?.toDate ? aVal.toDate() : new Date(aVal);
            const dateB = bVal?.toDate ? bVal.toDate() : new Date(bVal);
            return dateA.getTime() - dateB.getTime();
          });
        }
        setData(arr);
        setError(null);
        setIsLoading(false);
      },
      async (err) => {
        if (isStaticAppBuild()) {
          const cached = await listCompanyDocsFromBrowserDb(companyId, collectionName);
          if (cached.length) {
            applyBrowserMerge(cached);
            return;
          }
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [companyId, collectionName, isLocalMode, options?.orderByField, listenerToggleEpoch]);

  // Static: `notifyBrowserDbCollectionUpdated` par list merge (jab yeh hook use hoga)
  useEffect(() => {
    if (!companyId || isLocalMode || !isStaticAppBuild()) return;
    const onBump = (ev: Event) => {
      const d = (ev as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!d || d.companyId !== companyId || d.collection !== collectionName) return;
      const remoteIncoming = d.source === "pl_host_remote_write";
      void (async () => {
        if (remoteIncoming) {
          const { reloadBrowserDbFromIndexedDB } = await import("@/lib/localSqlite");
          await reloadBrowserDbFromIndexedDB();
        }
        const cached = await listCompanyDocsFromBrowserDb(companyId, collectionName);
        if (!cached.length) return;
        const filtered = cached.filter((item: any) => item.isDeleted !== true);
        setData((prev) => mergeCollectionById<T & { id: string }>(prev, filtered, options?.orderByField));
      })();
    };
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
  }, [companyId, collectionName, isLocalMode, options?.orderByField]);

  const refetch = () => {
    if (refetchRef.current) refetchRef.current();
  };

  return { data, isLoading, error, refetch };
}
