
import type { StaffHrFields } from "@/modules/hr/types";

export type Staff = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: boolean;
  address?: string;
  salary?: number;
  openingBalance?: number;
  openingBalanceDate?: any;
  openingBalanceNarration?: string;
  documentFileUrls?: string[];
  salaryPeriod?: "Daily" | "Weekly" | "Monthly" | "Yearly";
  balance: number; 
  companyId: string;
  ownerId: string;
  groupId?: string;
  debit: number;
  credit: number;
  fileUrl?: string;
  isDeleted?: boolean;
  isFrozen?: boolean;
  freezeMessage?: string | null;
  anusuchi13ConfirmationByFy?: Record<string, { sent?: boolean; completed?: boolean; statementSent?: boolean }>;
  /** HR module fields (designation, department, joining date, status, salary). Written only by the HR module. */
  hr?: StaffHrFields;
};

export type StaffGroup = {
    id: string;
    name: string;
    companyId: string;
    parentId?: string;
    debit: number;
    credit: number;
    balance: number;
    openingBalance?: number;
    isDeleted?: boolean;
    isSystemReserved?: boolean;
};
