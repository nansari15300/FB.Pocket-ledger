import "server-only";

import { PB_BEARER_PREFIX, verifyPocketBaseBearer } from "@/lib/localCloudSync/server/pbBearerAuth";

/**
 * Signed-in caller of a company API route.
 *
 * Only Pocket Ledger Server sessions are accepted (`Authorization: Bearer plpb.<token>`); the token
 * is checked against the user's own `pl_users` record. Firebase ID tokens are no longer verified —
 * Firebase has no users any more and no data lives there.
 *
 * The shape mirrors the Firebase `DecodedIdToken` fields the routes read (`uid`, `email`) so the
 * existing ownership / sharing checks keep working unchanged.
 */
export type CompanyApiCaller = {
  uid: string;
  email?: string;
};

export function bearerFromRequest(req: Request): string {
  const header = req.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** `null` when the request carries no PB session; an error object otherwise. */
export async function resolveCompanyApiCaller(
  req: Request
): Promise<{ ok: true; caller: CompanyApiCaller } | { ok: false; status: number; error: string }> {
  const token = bearerFromRequest(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization Bearer token" };
  if (!token.startsWith(PB_BEARER_PREFIX)) {
    return { ok: false, status: 401, error: "Sign in with your Pocket Ledger Server account" };
  }
  const v = await verifyPocketBaseBearer(token);
  if ("error" in v) return { ok: false, status: v.status, error: v.error };
  return { ok: true, caller: { uid: v.uid, email: v.email ?? undefined } };
}

/**
 * Same as `resolveCompanyApiCaller`, but for the routes that already pulled the bearer out of the
 * header and used to call `admin.auth().verifyIdToken(token)`. Throws on a bad token so the
 * surrounding `try { ... } catch { 401 }` keeps working unchanged.
 */
export async function verifyCompanyApiCallerByToken(token: string): Promise<CompanyApiCaller> {
  if (!token) throw new Error("Missing Authorization Bearer token");
  if (!token.startsWith(PB_BEARER_PREFIX)) {
    throw new Error("Sign in with your Pocket Ledger Server account");
  }
  const v = await verifyPocketBaseBearer(token);
  if ("error" in v) throw new Error(v.error);
  return { uid: v.uid, email: v.email ?? undefined };
}
