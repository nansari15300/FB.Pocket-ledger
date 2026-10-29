"use client";

/**
 * Master form — entity ka prefixed Inter Co. A/c No (P/B/S/T/E).
 */
import { useEffect, useState } from "react";
import type { InterCompanyEntityKind } from "@/components/inter-company/InterCompanyEntitySide";
import { useCompany } from "@/hooks/useCompany";
import { ensureEntityInterCompanyAcNo } from "@/lib/interCompany/ensureEntityInterCompanyAcNo";
import {
  firestoreCollectionForEntityKind,
  isValidInterCompanyAcNo,
  normalizeInterCompanyAcNo,
  readInterCompanyAcNoFromDoc,
} from "@/lib/interCompany/interCompanyAccountNo";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

type Options = {
  entityKind: InterCompanyEntityKind;
  entityId?: string | null;
  autoEnsure?: boolean;
};

export function useEntityInterCompanyAcNo({
  entityKind,
  entityId,
  autoEnsure = false,
}: Options) {
  const { companyId } = useCompany();
  const [acNo, setAcNo] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isInterCompanySystemEnabled() || !entityId || !companyId) {
      setAcNo("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const coll = firestoreCollectionForEntityKind(entityKind);
        const local = await getCompanyDocFromBrowserDb(companyId, coll, entityId);
        const fromLocal = readInterCompanyAcNoFromDoc(local as { interCompanyAccountNo?: string });
        if (isValidInterCompanyAcNo(fromLocal, entityKind)) {
          if (!cancelled) setAcNo(normalizeInterCompanyAcNo(fromLocal));
          return;
        }
        if (autoEnsure) {
          const next = await ensureEntityInterCompanyAcNo(companyId, entityKind, entityId);
          if (!cancelled) setAcNo(next);
        } else if (!cancelled) {
          setAcNo("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, companyId, entityKind, autoEnsure]);

  return { acNo, loading };
}
