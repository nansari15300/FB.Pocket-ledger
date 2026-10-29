import type { Party } from "@/components/party/types";
import { masterEntityTextMatchesSearch } from "@/lib/filterMasterEntityListRows";
import { getInterCompanyPartyListTitleLines } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import {
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";

/** PartyList + header count — naam, IC Company subtitle, member account names. */
export function partyListRowMatchesSearch(party: Party, searchTerm: string): boolean {
  const email = String(party.email || "").trim();
  if (!party.name && !email) return false;

  const isIcPeerCompanyGroup = Boolean(
    (party as Party & { isIcPeerCompanyGroup?: boolean }).isIcPeerCompanyGroup
  );
  const title = isIcPeerCompanyGroup
    ? icPeerCompanyGroupListTitleLines(party)
    : getInterCompanyPartyListTitleLines(party);

  const memberSearchMatch =
    party.icMemberParties?.some((member) => {
      const accountLabel = interCompanyClearingAccountDisplayName(member);
      return (
        masterEntityTextMatchesSearch(accountLabel, searchTerm) ||
        masterEntityTextMatchesSearch(member.name, searchTerm)
      );
    }) ?? false;

  return (
    masterEntityTextMatchesSearch(party.name, searchTerm) ||
    (email ? masterEntityTextMatchesSearch(email, searchTerm) : false) ||
    masterEntityTextMatchesSearch((party as Party & { aliasName?: string }).aliasName || "\u0000", searchTerm) ||
    (title.secondary ? masterEntityTextMatchesSearch(title.secondary, searchTerm) : false) ||
    memberSearchMatch ||
    (isIcPeerCompanyGroup &&
      (masterEntityTextMatchesSearch("IC Company Account", searchTerm) ||
        masterEntityTextMatchesSearch("IC Company Accounts", searchTerm) ||
        masterEntityTextMatchesSearch("IC Com Account", searchTerm) ||
        masterEntityTextMatchesSearch("IC Com Accounts", searchTerm)))
  );
}
