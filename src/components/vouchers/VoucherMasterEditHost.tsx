"use client";
/**
 * Global combobox pencil → master Edit dialog, for every <Combobox> inside the voucher add/edit dialog.
 * Resolves the option id across master collections (offline SQLite mirror first, Firestore fallback) and opens the
 * existing Edit dialog in nested mode (z-100/101, above AddVoucherDialog z-81). The option is never selected; after
 * save the voucher's live master lists refresh (`pl-master-edited` event also fired) and the current value stays.
 */
import React, { useCallback, useMemo, useState } from "react";
import { doc, collection } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { toast } from "sonner";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { getCompanyDocFromBrowserDb, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { ComboboxEditOptionContext, type ComboboxEditOptionResolver } from "@/components/ui/comboboxEditOption";
import { EditPartyDialog } from "@/components/party/EditPartyDialog";
import { EditItemDialog } from "@/components/items/EditItemDialog";
import { EditAccountDialog } from "@/components/bank-cash/EditAccountDialog";
import { EditStaffDialog } from "@/components/staff/EditStaffDialog";
import { EditExpenseAccountDialog } from "@/components/expenses/EditExpenseAccountDialog";
import { EditTaxDialog } from "@/components/tax/EditTaxDialog";
import { EditGroupDialog } from "@/components/party/EditGroupDialog";
import { EditItemGroupDialog } from "@/components/items/EditItemGroupDialog";
import { EditAccountGroupDialog } from "@/components/bank-cash/EditAccountGroupDialog";
import { EditStaffGroupDialog } from "@/components/staff/EditStaffGroupDialog";
import { EditExpenseGroupDialog } from "@/components/expenses/EditExpenseGroupDialog";
import { EditTaxGroupDialog } from "@/components/tax/EditTaxGroupDialog";

const MASTER_COLLECTIONS = [
  "parties", "items", "bank_accounts", "staff", "expense_accounts", "taxes",
  "groups", "item_groups", "account_groups", "staff_groups", "expense_groups", "tax_groups",
] as const;
type Coll = (typeof MASTER_COLLECTIONS)[number];
type Target = { coll: Coll; row: Record<string, unknown> & { id: string }; list: Record<string, unknown>[] };

/** System / pseudo ids (e.g. "purchase_account", "all", "sundry_creditors") are not editable docs. */
const looksLikeDocId = (v: string) => !!v && v !== "all" && !/^(new|add|none|__)/i.test(v);

export function VoucherMasterEditHost({ children }: { children: React.ReactNode }) {
  const { companyId } = useCompany();
  const [target, setTarget] = useState<Target | null>(null);

  const loadList = useCallback(
    async (coll: Coll): Promise<Record<string, unknown>[]> => {
      if (!companyId) return [];
      const local = await listCompanyDocsFromBrowserDb(companyId, coll).catch(() => [] as unknown[]);
      if (local.length) return local as Record<string, unknown>[];
      try {
        const snap = await getDocs(collection(firestore, `companies/${companyId}/${coll}`));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch {
        return [];
      }
    },
    [companyId]
  );

  const open = useCallback(
    async (id: string) => {
      if (!companyId) return;
      for (const coll of MASTER_COLLECTIONS) {
        let row: Record<string, unknown> | null = await getCompanyDocFromBrowserDb(companyId, coll, id).catch(() => null);
        if (!row) {
          try {
            const snap = await getDoc(doc(firestore, `companies/${companyId}/${coll}`, id));
            row = snap.exists() ? { id: snap.id, ...snap.data() } : null;
          } catch {
            row = null;
          }
        }
        if (row && !row.isDeleted) {
          const needsList = coll.endsWith("groups") || coll === "taxes" || coll === "bank_accounts" || coll === "staff";
          const list = needsList ? await loadList(coll) : [];
          setTarget({ coll, row: { ...row, id } as Target["row"], list });
          return;
        }
      }
      toast.message("This entry has no editable master record");
    },
    [companyId, loadList]
  );

  const resolver = useMemo<ComboboxEditOptionResolver>(() => (v) => (looksLikeDocId(v) ? () => void open(v) : null), [open]);

  const close = () => setTarget(null);
  const saved = () => {
    window.dispatchEvent(new CustomEvent("pl-master-edited", { detail: { coll: target?.coll, id: target?.row.id } }));
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const r = target?.row as any;
  const list = (target?.list ?? []) as any[];
  const common = { isOpen: true, onOpenChange: (o: boolean) => { if (!o) close(); } };
  const groupCommon = { ...common, group: r, allGroups: list, onGroupUpdated: () => { saved(); close(); }, onGroupDeleted: close };

  return (
    <ComboboxEditOptionContext.Provider value={resolver}>
      {children}
      {target?.coll === "parties" ? (
        <EditPartyDialog {...common} presentationMode="nested-ledger" party={r} hasTransactions onPartyUpdated={saved} onPartyDeleted={close}>{null}</EditPartyDialog>
      ) : target?.coll === "items" ? (
        <EditItemDialog {...common} item={r} hasTransactions onItemUpdated={saved} onItemDeleted={close} />
      ) : target?.coll === "bank_accounts" ? (
        <EditAccountDialog {...common} presentationMode="nested-ledger" account={r} allAccounts={list} hasTransactions onAccountUpdated={saved} onAccountDeleted={close}>{null}</EditAccountDialog>
      ) : target?.coll === "staff" ? (
        <EditStaffDialog {...common} presentationMode="nested-ledger" staff={r} allStaff={list} hasTransactions onStaffUpdated={saved} onStaffDeleted={close}>{null}</EditStaffDialog>
      ) : target?.coll === "expense_accounts" ? (
        <EditExpenseAccountDialog {...common} presentationMode="nested-ledger" account={r} hasTransactions onAccountUpdated={saved} onAccountDeleted={close}>{null}</EditExpenseAccountDialog>
      ) : target?.coll === "taxes" ? (
        <EditTaxDialog {...common} presentationMode="nested-ledger" tax={r} allTaxes={list} hasTransactions onTaxUpdated={saved} onTaxDeleted={close}>{null}</EditTaxDialog>
      ) : target?.coll === "groups" ? (
        <EditGroupDialog {...groupCommon} hasAccounts />
      ) : target?.coll === "item_groups" ? (
        <EditItemGroupDialog {...groupCommon} hasAccounts />
      ) : target?.coll === "account_groups" ? (
        <EditAccountGroupDialog {...groupCommon} hasAccounts />
      ) : target?.coll === "staff_groups" ? (
        <EditStaffGroupDialog {...groupCommon} hasAccounts />
      ) : target?.coll === "expense_groups" ? (
        <EditExpenseGroupDialog {...groupCommon} hasAccounts />
      ) : target?.coll === "tax_groups" ? (
        <EditTaxGroupDialog {...groupCommon} hasAccounts />
      ) : null}
    </ComboboxEditOptionContext.Provider>
  );
}
