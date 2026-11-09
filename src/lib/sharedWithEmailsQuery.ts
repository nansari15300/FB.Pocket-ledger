/**
 * Firestore `sharedWithEmails` `array-contains` is case-sensitive.
 * `sharedWithEmailsLower` stores lowercase only — query + rules align reliably.
 */

import { auth } from "@/lib/plClientSession";

/** Shared query/listener: Firebase Auth token email (rules `request.auth.token.email` se match). */
export function resolveFirestoreAuthEmail(fallback?: string | null): string {
  try {
    const tokenEmail = auth.currentUser?.email;
    if (tokenEmail && String(tokenEmail).trim()) return String(tokenEmail).trim();
  } catch {
    /* ignore */
  }
  return String(fallback || "").trim();
}

export function toSharedWithEmailsLower(email: string): string {

  return String(email || "").trim().toLowerCase();

}



export function sharedWithEmailQueryVariants(email: string | null | undefined): string[] {
  const raw = String(email || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (lower === raw) return [lower];
  return [lower, raw];
}

/** Owned-company `ownerEmail` query — Firestore equality case-sensitive; auth + stored casing dono try karo. */
export function ownerEmailQueryVariants(email: string | null | undefined): string[] {
  const authEmail = resolveFirestoreAuthEmail(email);
  return sharedWithEmailQueryVariants(authEmail);
}



export function sharedWithEmailsLowerFromList(emails: string[]): string[] {

  return [...new Set(emails.map((e) => toSharedWithEmailsLower(e)).filter(Boolean))];

}



export type SharedCompanyQuerySpec = {

  field: "sharedWithEmails" | "sharedWithEmailsLower";

  value: string;

};



/** Firestore shared-company listeners: legacy `sharedWithEmails` pehle (purane rules), phir `sharedWithEmailsLower`. */
export function sharedCompanyQuerySpecs(
  email: string | null | undefined,
  opts?: { includeLegacySharedWithEmails?: boolean }
): SharedCompanyQuerySpec[] {
  const authEmail = resolveFirestoreAuthEmail(email);
  const lower = toSharedWithEmailsLower(authEmail);
  if (!lower) return [];

  const specs: SharedCompanyQuerySpec[] = [];

  if (opts?.includeLegacySharedWithEmails !== false) {
    for (const variant of sharedWithEmailQueryVariants(authEmail)) {
      if (!specs.some((s) => s.field === "sharedWithEmails" && s.value === variant)) {
        specs.push({ field: "sharedWithEmails", value: variant });
      }
    }
  }

  if (!specs.some((s) => s.field === "sharedWithEmailsLower" && s.value === lower)) {
    specs.push({ field: "sharedWithEmailsLower", value: lower });
  }

  return specs;
}



export function sharedCompanyQueryKey(spec: SharedCompanyQuerySpec): string {

  return `${spec.field}:${spec.value}`;

}


