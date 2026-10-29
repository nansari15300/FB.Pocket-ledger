import type { Party } from "@/components/party/types";
import { isPackedMyCompanyOnly } from "@/lib/plServerPackedApp";

/** Packed My Company ledger — no IC company system; party list uses Parties / Groups / Agents. */
export function isPackedMyCompanyPartyPage(): boolean {
  return isPackedMyCompanyOnly();
}

export function parsePackedMyCompanyPartyTab(value: string): "parties" | "groups" | "agents" {
  if (value === "groups") return "groups";
  if (value === "agents" || value === "ic_ac") return "agents";
  return "parties";
}

export function isMyCompanyAgentParty(party: { id?: string; type?: string }): boolean {
  const t = String(party.type ?? "").toLowerCase();
  return t === "agent" || String(party.id ?? "").startsWith("agent-");
}

export function isMyCompanySubscriberParty(party: { id?: string; type?: string }): boolean {
  const t = String(party.type ?? "").toLowerCase();
  return t === "subscriber" || String(party.id ?? "").startsWith("sub-");
}

function companyCountOf(party: Party): number {
  const rec = party as Party & { companyCount?: unknown; companyIds?: unknown };
  const n = Number(rec.companyCount);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  if (Array.isArray(rec.companyIds) && rec.companyIds.length > 0) return rec.companyIds.length;
  return 0;
}

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

/** Alias field, else account name (never an email). */
function partyAliasOrAccountName(party: Party): string {
  const alias = String(party.aliasName ?? "").trim();
  if (alias) return alias;
  const name = String(party.name ?? "").trim();
  const email = String(party.email ?? "").trim();
  if (name && !looksLikeEmail(name) && name.toLowerCase() !== email.toLowerCase()) return name;
  if (name && !looksLikeEmail(name)) return name;
  return "";
}

/** Details header: account name / alias — never the raw email. */
export function myCompanyDetailsTitle(party: Party): string {
  const aliasOrName = partyAliasOrAccountName(party);
  if (aliasOrName) return aliasOrName;
  const email = String(party.email ?? "").trim();
  if (email) return email.split("@")[0] || "Subscriber";
  return String(party.name ?? "").trim() || "Subscriber";
}

/**
 * Packed My Company list card: email on the first line;
 * second line = alias name (or "No alias name") + company count.
 */
export function myCompanyPartyListTitleLines(
  party: Party
): { primary: string; secondary?: string | null } {
  const email = String(party.email ?? "").trim();
  const accountName = String(party.name ?? "").trim();
  const booksRow =
    isMyCompanySubscriberParty(party) ||
    isMyCompanyAgentParty(party) ||
    Boolean(email) ||
    party.companyCount != null;
  if (!booksRow) {
    return { primary: accountName || "Party", secondary: null };
  }
  const primary = email || accountName || "Subscriber";
  const countLabel = `${companyCountOf(party)} company`;
  const aliasLabel = partyAliasOrAccountName(party) || "No alias name";
  return {
    primary,
    secondary: `${aliasLabel} · ${countLabel}`,
  };
}
