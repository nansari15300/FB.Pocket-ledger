"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, orderBy, query } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { fetchRecentOcrLinks, isGalleryServerApiUnavailable } from "@/modules/ocr/plGalleryServerApi";
import {
  mergeRecentOcrLinks,
  type RecentOcrLink,
} from "@/modules/ocr/recentOcrLinks";

/**
 * Source of truth for Recent OCR Trxn rows: OCR-created vouchers only
 * (gallery runner complete + autoOcrVoucherId), including hard-deleted
 * gallery tombstones that still keep those fields on the server.
 *
 * When the server hook is available, every PC uses that same list.
 * If the route is not deployed yet, the local unassigned_documents
 * snapshot is used (same as the previous behaviour).
 */
export function useRecentOcrLinks(companyId: string, fsCompanyId?: string): RecentOcrLink[] {
  const cid = String(companyId || "").trim();
  const fsId = String(fsCompanyId || cid).trim();
  const [localLinks, setLocalLinks] = useState<RecentOcrLink[]>([]);
  const [serverLinks, setServerLinks] = useState<RecentOcrLink[] | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !fsId) {
      setLocalLinks([]);
      return;
    }
    const q = query(collection(firestore, `companies/${fsId}/unassigned_documents`), orderBy("uploadedAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      const links: RecentOcrLink[] = [];
      snapshot.docs.forEach((docSnap) => {
        const row = docSnap.data() as {
          autoOcrStatus?: string;
          autoOcrVoucherId?: string;
          autoOcrProvider?: string;
          autoOcrRunnerMode?: string;
        };
        const voucherId = String(row.autoOcrVoucherId || "").trim();
        if (row.autoOcrStatus === "complete" && voucherId) {
          links.push({
            voucherId,
            provider: String(row.autoOcrProvider || "").trim(),
            mode: String(row.autoOcrRunnerMode || "").trim(),
          });
        }
      });
      setLocalLinks(links);
    }, (error) => console.warn("[Gallery Recent OCR] could not watch runner entries", error));
  }, [fsId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => setBump((n) => n + 1);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!cid) {
      setServerLinks(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const links = await fetchRecentOcrLinks(cid);
        if (!cancelled) setServerLinks(links);
      } catch (error) {
        if (cancelled) return;
        if (!isGalleryServerApiUnavailable(error)) {
          console.warn("[Gallery Recent OCR] server link list failed", error);
        }
        setServerLinks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, bump, localLinks.length]);

  return useMemo(
    () => (serverLinks != null ? mergeRecentOcrLinks([serverLinks]) : mergeRecentOcrLinks([localLinks])),
    [localLinks, serverLinks]
  );
}
