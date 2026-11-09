"use client";

import { useEffect, useRef, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import {
  BROWSER_DB_COLLECTION_BUMP,
  getCompanyDocFromBrowserDb,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import type { EntityProfileCollection } from "@/lib/entityProfileLocalFiles";

type LiveEntityAttachmentFields = {
  fileUrl?: string | null;
  documentFileUrls?: string[];
  avatarUrl?: string | null;
  fileUrls?: string[];
};

function readAttachmentFieldsFromRow(d: Record<string, unknown>): LiveEntityAttachmentFields {
  const out: LiveEntityAttachmentFields = {};
  if (Object.prototype.hasOwnProperty.call(d, "fileUrl")) {
    out.fileUrl = (d.fileUrl as string | null | undefined) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(d, "documentFileUrls")) {
    out.documentFileUrls = Array.isArray(d.documentFileUrls)
      ? d.documentFileUrls.filter((u): u is string => typeof u === "string")
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(d, "avatarUrl")) {
    out.avatarUrl = (d.avatarUrl as string | null | undefined) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(d, "fileUrls")) {
    out.fileUrls = Array.isArray(d.fileUrls)
      ? d.fileUrls.filter((u): u is string => typeof u === "string")
      : [];
  }
  return out;
}

/**
 * Entity edit dialog: Firestore / SQLite se avatar/docs live — save ke baad refresh ki zarurat kam.
 * `attachmentsDirty` true ho to user ke local picks overwrite na karo (ref se — listener band nahi).
 */
export function useLiveEntityDocAttachments(params: {
  enabled: boolean;
  companyId: string | null | undefined;
  collection: EntityProfileCollection | "items";
  entityId: string | null | undefined;
  attachmentsDirty: boolean;
  /** APK/SQLite mirror: Firestore ki jagah browser DB bump se fields apply */
  preferSqliteMirror?: boolean;
  onFields: (fields: LiveEntityAttachmentFields) => void;
}): void {
  const { enabled, companyId, collection, entityId, attachmentsDirty, preferSqliteMirror, onFields } = params;
  const [effectivePreferSqlite, setEffectivePreferSqlite] = useState<boolean | null>(
    preferSqliteMirror === true ? true : null
  );

  const attachmentsDirtyRef = useRef(attachmentsDirty);
  attachmentsDirtyRef.current = attachmentsDirty;
  const onFieldsRef = useRef(onFields);
  onFieldsRef.current = onFields;

  const applyFields = (fields: LiveEntityAttachmentFields) => {
    if (attachmentsDirtyRef.current) return;
    onFieldsRef.current(fields);
  };

  useEffect(() => {
    if (!enabled || !companyId) {
      setEffectivePreferSqlite(null);
      return;
    }
    if (preferSqliteMirror === true) {
      setEffectivePreferSqlite(true);
      return;
    }
    let cancelled = false;
    setEffectivePreferSqlite(null);
    void import("@/lib/plServerThinStaffClient")
      .then(({ isPlServerThinStaffCompany }) => isPlServerThinStaffCompany(companyId))
      .then((thinStaffCompany) => {
        if (!cancelled) setEffectivePreferSqlite(thinStaffCompany);
      })
      .catch(() => {
        if (!cancelled) setEffectivePreferSqlite(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, companyId, preferSqliteMirror]);

  useEffect(() => {
    if (!enabled || !companyId || !entityId || effectivePreferSqlite !== false) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void resolveAuthoritativeFirestoreCompanyId(companyId).then((fsCompanyId) => {
      if (cancelled) return;
      const ref = doc(firestore, `companies/${fsCompanyId}/${collection}`, entityId);
      unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        applyFields(readAttachmentFieldsFromRow(snap.data() as Record<string, unknown>));
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [enabled, companyId, collection, entityId, effectivePreferSqlite]);

  useEffect(() => {
    if (!enabled || !companyId || !entityId || effectivePreferSqlite == null) return;

    const loadFromSqlite = async () => {
      if (attachmentsDirtyRef.current) return;
      try {
        const row = await getCompanyDocFromBrowserDb(companyId, collection, entityId);
        if (!row || attachmentsDirtyRef.current) return;
        applyFields(readAttachmentFieldsFromRow(row as Record<string, unknown>));
      } catch {
        /* mirror optional */
      }
    };

    if (effectivePreferSqlite) void loadFromSqlite();

    const onBump = (event: Event) => {
      const detail = (event as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!detail || detail.companyId !== companyId || detail.collection !== collection) return;
      void loadFromSqlite();
    };

    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    return () => window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
  }, [enabled, companyId, collection, entityId, effectivePreferSqlite]);
}
