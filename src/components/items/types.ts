
export type StockView = 'qty' | 'amount';

export type Item = {
  id: string;
  name: string;
  type: 'item' | 'service' | 'finished_good';
  openingBalance: number;
  openingBalanceUnit?: string;
  openingBalanceRate?: number;
  openingBalanceDate?: any;
  openingBalanceNarration?: string;
  stockQty?: number;
  lowStockWarning?: number;
  /** Low stock threshold kis unit me hai (Pcs/Kg/Gm …). */
  lowStockWarningUnit?: string;
  salePrice: number;
  purchasePrice: number;
  debit: number;
  credit: number;
  balance: number;
  companyId: string;
  groupId?: string;
  fileUrls?: string[];
  isDeleted?: boolean;
  unitConversions?: any;
  salePriceUnit?: string;
  purchasePriceUnit?: string;
  saleTaxId?: string;
  purchaseTaxId?: string;
  displayStockQty?: number;
};

export type ItemGroup = {
  id: string;
  name: string;
  companyId: string;
  parentId?: string;
  debit: number;
  credit: number;
  balance: number;
  openingBalance?: number;
  isDeleted?: boolean;
};
