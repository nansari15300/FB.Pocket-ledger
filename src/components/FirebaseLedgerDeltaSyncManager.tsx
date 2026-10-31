"use client";

import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import { pullCompanyDocFromFirestoreToLocalDb } from "@/lib/firestoreToLocalCompanyPull";
import {
  FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT,
} from "@/lib/firebaseLedgerSyncMode";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  FIREBASE_LEDGER_DATA_SYNC_STORAGE_KEY,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import {
  FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT,
  isFirebaseLedgerCompanyDataSyncEnabled,
} from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  shouldBindFirebaseLedgerChangeFeed,
} from "@/lib/firebaseLedgerSyncPolicy";
import { getCompanyDocFromBrowserDb, notifyBrowserDbCollectionUpdated } from "@/lib/localCompanyDocMirror";
import { LEDGER_STATEMENT_CHECKS_COLLECTION } from "@/lib/ledgerStatementCheckPersist";
import { VOUCHER_FORM_MASTER_COLLECTION_PATHS } from "@/lib/ledgerActiveMasterCollections";
import { dispatchMasterLivePatch, isMasterLivePatchCollection } from "@/lib/masterEntityLivePatch";

/** Cross-device master live: route se independent — voucher forms ko har screen par fresh masters chahiye. */
const FIREBASE_DELTA_MASTER_COLLECTIONS = new Set([
  ...VOUCHER_FORM_MASTER_COLLECTION_PATHS,
  LEDGER_STATEMENT_CHECKS_COLLECTION,
]);

export function FirebaseLedgerDeltaSyncManager() {
  const { companyId, company } = useCompany();
  const [policyTick, setPolicyTick] = useState(0);
  const policyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenChangeIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const bumpNow = () => setPolicyTick((n) => n + 1);
    const bumpDebounced = () => {
      if (policyDebounceRef.current) clearTimeout(policyDebounceRef.current);
      policyDebounceRef.current = setTimeout(() => {
        policyDebounceRef.current = null;
        bumpNow();
      }, 220);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === FIREBASE_LEDGER_DATA_SYNC_STORAGE_KEY) bumpDebounced();
    };
    window.addEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, bumpNow);
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, bumpDebounced);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bumpDebounced);
    window.addEventListener("storage", onStorage);
    return () => {
      if (policyDebounceRef.current) clearTimeout(policyDebounceRef.current);
      policyDebounceRef.current = null;
      window.removeEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, bumpNow);
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, bumpDebounced);
      window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bumpDebounced);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const activeCollections = FIREBASE_DELTA_MASTER_COLLECTIONS;

  useEffect(() => {
    // Single live feed in deltaa — no collection onSnapshot (web/EXE/APK/iOS).
    if (!shouldBindFirebaseLedgerChangeFeed()) return;
    if (!isFirebaseLedgerCompanyDataSyncEnabled(companyId, company)) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (!companyId?.trim() || !company || !isCloudBackedCompanyShape(company)) return;
    if (activeCollections.size === 0) return;

    const localCompanyId = companyId.trim();
    const fsCompanyId = String(
      (company as { authoritativeCompanyId?: string }).authoritativeCompanyId || localCompanyId
    ).trim();
    if (!fsCompanyId) return;

    const q = query(
      collection(firestore, `companies/${fsCompanyId}/_pl_change_log`),
      orderBy("at", "desc"),
      limit(20)
    );

    return onSnapshot(
      q,
      (snap) => {
        for (const change of snap.docChanges()) {
          const changeId = change.doc.id;
          if (seenChangeIdsRef.current.has(changeId)) continue;
          const data = change.doc.data() as {
            collectionName?: unknown;
            docId?: unknown;
            op?: unknown;
          };
          const collectionName = String(data.collectionName || "").trim();
          const docId = String(data.docId || "").trim();
          if (!collectionName || !docId || !activeCollections.has(collectionName)) continue;
          void pullCompanyDocFromFirestoreToLocalDb(
            fsCompanyId,
            localCompanyId,
            collectionName,
            docId,
            company,
            { op: String(data.op || "") }
          )
            .then(async () => {
              seenChangeIdsRef.current.add(changeId);
              if (seenChangeIdsRef.current.size > 300) {
                seenChangeIdsRef.current = new Set([...seenChangeIdsRef.current].slice(-150));
              }
              if (isMasterLivePatchCollection(collectionName)) {
                const row = await getCompanyDocFromBrowserDb(localCompanyId, collectionName, docId);
                if (row && (row as { isDeleted?: boolean }).isDeleted !== true) {
                  dispatchMasterLivePatch(
                    localCompanyId,
                    collectionName,
                    docId,
                    { ...(row as Record<string, unknown>), id: docId },
                    { insertIfMissing: String(data.op || "") === "create" }
                  );
                }
              }
              notifyBrowserDbCollectionUpdated(localCompanyId, collectionName, {
                immediate: true,
                source: "firebase_delta_pull",
              });
            })
            .catch((e) => {
              if (process.env.NODE_ENV !== "production") {
                console.warn("[FirebaseLedgerDeltaSyncManager] delta pull failed", {
                  collectionName,
                  docId,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            });
        }
      },
      (error) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[FirebaseLedgerDeltaSyncManager] change feed listener failed", error);
        }
      }
    );
  }, [activeCollections, company, companyId, policyTick]);

  return null;
}
