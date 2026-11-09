import "server-only";

/**
 * Caller identity used by the ownership checks. Structurally compatible with the Firebase
 * `DecodedIdToken` fields these helpers used to read, so callers can pass a Pocket Ledger Server
 * session (`CompanyApiCaller`) instead.
 */
export type OwnerCheckCaller = {
  uid: string;
  email?: string | null;
};

/** Same rules as extend-plan-expiry: UID match or normalized email match. */
export function isCompanyOwner(
  decoded: OwnerCheckCaller,
  data: { ownerId?: string; ownerEmail?: string }
): boolean {
  const ownerEmail = String(data.ownerEmail || "")
    .toLowerCase()
    .trim();
  const callerEmail = String(decoded.email || "")
    .toLowerCase()
    .trim();
  const isOwnerByUid = !!data.ownerId && data.ownerId === decoded.uid;
  const isOwnerByEmail = !!ownerEmail && !!callerEmail && ownerEmail === callerEmail;
  return isOwnerByUid || isOwnerByEmail;
}
