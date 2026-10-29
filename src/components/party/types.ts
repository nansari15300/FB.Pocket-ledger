
export type Party = {
  id: string;
  name: string;
  /** Optional other name (bills / OCR / combobox search). */
  aliasName?: string;
  openingBalance: number;
  openingBalanceDate?: any;
  openingBalanceNarration?: string;
  documentFileUrls?: string[];
  debit: number;
  credit: number;
  balance: number;
  companyId: string;
  groupId?: string;
  fileUrl?: string;
  address?: string;
  pan?: string;
  phone?: string;
  whatsapp?: boolean;
  email?: string;
  /** Packed My Company — subscriber / agent row. */
  type?: string;
  /** Packed My Company — companies owned (or referred) by this party. */
  companyCount?: number;
  isDeleted?: boolean;
  /** Owner freeze — no new vouchers; visible disabled in dropdowns. */
  isFrozen?: boolean;
  freezeMessage?: string | null;
  isInterCompanyCounterparty?: boolean;
  /** Linked peer company for IC clearing row (`ic_peer_*` / `ic_acct_*`). */
  interCompanyPeerCompanyId?: string;
  /** Peer company display name — Account→Account list wrap line. */
  interCompanyPeerCompanyName?: string;
  /** `company` = Company→Company; `account` = Account→Account. */
  interCompanyClearingMode?: "company" | "account";
  interCompanyPeerEntityKind?: string;
  interCompanyPeerEntityId?: string;
  interCompanyPeerEntityLabel?: string;
  isInterCompanyMirroredEntity?: boolean;
  /** IC / Ac — company filter view (merged peer company row). */
  isIcPeerCompanyGroup?: boolean;
  icPeerCompanyId?: string;
  icMemberParties?: Party[];
  /** Nepal Anusuchi 13 — FY-keyed confirmation / statement send. */
  anusuchi13ConfirmationByFy?: Record<
    string,
    { sent?: boolean; completed?: boolean; statementSent?: boolean }
  >;
};

export type Group = {
  id: string;
  name: string;
  aliasName?: string;
  companyId: string;
  parentId?: string;
  debit: number;
  credit: number;
  balance: number;
  openingBalance?: number;
  isDeleted?: boolean;
};
