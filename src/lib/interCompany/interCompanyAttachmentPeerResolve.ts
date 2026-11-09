"use client";

import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { isLocalFileRef } from "@/lib/localPendingFiles";

function readRemoteFileUrls(data: Record<string, unknown> | undefined): string[] {
  if (!data || !Array.isArray(data.fileUrls)) return [];
  return data.fileUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

/**
 * Target IC copy par source ka `local:` / stale ref — peer source voucher se HTTPS resolve.
 */
export async function tryResolveInterCompanyPeerAttachmentUrl(args: {
  staleUrl: string;
  clientFileUrls?: readonly string[] | null;
  peerCompanyId: string;
  peerVoucherId: string;
}): Promise<string | null> {
  const peerCompanyId = String(args.peerCompanyId || "").trim();
  const peerVoucherId = String(args.peerVoucherId || "").trim();
  const staleUrl = String(args.staleUrl || "").trim();
  if (!peerCompanyId || !peerVoucherId || !staleUrl) return null;

  try {
    const snap = await getDoc(doc(firestore, "companies", peerCompanyId, "vouchers", peerVoucherId));
    if (!snap.exists()) return null;
    const peerUrls = readRemoteFileUrls(snap.data() as Record<string, unknown>);
    if (peerUrls.length === 0) return null;

    const client = (args.clientFileUrls || []).filter(
      (u): u is string => typeof u === "string" && u.trim().length > 0
    );
    const idx = client.findIndex((u) => u === staleUrl);
    if (idx >= 0 && peerUrls[idx]) return peerUrls[idx]!;

    if (client.length === peerUrls.length) {
      for (let i = 0; i < client.length; i++) {
        if (client[i] === staleUrl && peerUrls[i]) return peerUrls[i]!;
      }
    }

    if (isLocalFileRef(staleUrl)) {
      const remotePeer = peerUrls.filter((u) => !isLocalFileRef(u));
      if (remotePeer.length === 1) return remotePeer[0]!;
    }

    return null;
  } catch {
    return null;
  }
}
