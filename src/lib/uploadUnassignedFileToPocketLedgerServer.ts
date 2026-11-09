"use client";

/**
 * Upload an unassigned-document file to the Pocket Ledger Server and get back a `pbatt:` ref —
 * the same shape `uploadFileClient` returns for Firebase.
 *
 * Why: Firebase Storage returns an https signed URL that paints in a desktop tab but fails inside
 * the Capacitor WebView. A photo added on the PC therefore showed a black tile (and could not be
 * opened) on the APK, while a photo added on the APK worked fine on both. Storing the bytes as a
 * `pbatt:` attachment makes every device resolve it the same way.
 *
 * Returns `null` when the company is not on the server or the upload fails; the caller then falls
 * back to `uploadFileClient`.
 */
export async function uploadUnassignedFileToPocketLedgerServer(input: {
  companyId: string;
  file: Blob;
  fileName: string;
}): Promise<{ url: string; path: string } | null> {
  try {
    const { uploadBlobAsPocketBaseAttachment } = await import("@/lib/pocketbaseData/pbAttachments");
    const { ensurePocketBaseCompany, pbDeviceId } = await import("@/lib/pocketbaseData/pbSync");
    const pbCompanyId = await ensurePocketBaseCompany(input.companyId);
    const appId = `unassigned_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 200);
    const ref = await uploadBlobAsPocketBaseAttachment({
      pbCompanyId,
      blob: input.file,
      fileName: input.fileName || "photo.jpg",
      sourceUrl: "",
      ownerColl: "unassigned_documents",
      ownerAppId: appId,
      deviceId: pbDeviceId(),
      appId,
    });
    if (!ref) return null;
    return { url: ref, path: ref };
  } catch (e) {
    console.warn("[uploadUnassignedFileToPocketLedgerServer] failed", e);
    return null;
  }
}
