"use client";

import type { Staff } from "@/components/staff/types";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import {
  masterListShellCn,
  masterListRowUnselectedCn,
  MASTER_LIST_AVATAR_CN,
  MASTER_LIST_AVATAR_FALLBACK_CN,
} from "@/lib/masterListChrome";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { useRowChangeHighlight } from "@/hooks/useRowChangeHighlight";
import { LoanLiabilityEntityIcon } from "@/components/entity/LoanLiabilityEntityIcon";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import {
  compareEntityListQuickFilterSort,
  masterEntityTextMatchesSearch,
  shouldHideEntityListSettledRow,
} from "@/lib/filterMasterEntityListRows";
import type { Loan } from "../types/loanTypes";
import { findLoanForAccount } from "../db/loanQueries";
import { resolveLoanAccountAvatarUrl } from "../utils/resolveLoanAccountAvatarUrl";

export function LoanAccountList({
  accounts,
  loans = [],
  selectedAccount,
  onSelectAccount,
  searchTerm,
  pendingApprovalByAccountId = {},
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
}: {
  accounts: Staff[];
  loans?: Loan[];
  selectedAccount: Staff | null;
  onSelectAccount: (account: Staff) => void;
  searchTerm: string;
  pendingApprovalByAccountId?: Record<string, number>;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
}) {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const { processedStaff, processedAccounts } = useVouchers();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const highlightSearch = searchTerm.trim();

  const loanTypeByAccountId = useMemo(() => {
    const out = new Map<string, string>();
    for (const account of accounts) {
      const loan = findLoanForAccount(loans, account.id, account);
      const label = String(loan?.loanType || "").trim();
      if (label) out.set(account.id, label);
    }
    return out;
  }, [accounts, loans]);

  const loanByAccountId = useMemo(() => {
    const out = new Map<string, Loan>();
    for (const account of accounts) {
      const loan = findLoanForAccount(loans, account.id, account);
      if (loan) out.set(account.id, loan);
    }
    return out;
  }, [accounts, loans]);

  const staffById = useMemo(() => {
    const out = new Map<string, Staff>();
    for (const row of processedStaff || []) out.set(row.id, row);
    return out;
  }, [processedStaff]);

  const filteredAndSortedAccounts = useMemo(() => {
    const isSettled = (bal: number) => Math.abs(Number(bal || 0)) < 1e-6;
    return accounts
      .filter((account) => {
        const label = String(account.name || "").trim();
        if (!label || !masterEntityTextMatchesSearch(label, searchTerm)) return false;
        const bal = Number(account.balance || 0);
        if (quickFilter === "dr") return bal > 0;
        if (quickFilter === "cr") return bal < 0;
        if (shouldHideEntityListSettledRow(bal, hideSettled, quickFilter)) return false;
        if (quickFilter === "settled") return isSettled(bal);
        if (quickFilter === "non_settled") return !isSettled(bal);
        return true;
      })
      .sort((a, b) =>
        compareEntityListQuickFilterSort(a, b, quickFilter, undefined, lastVoucherMsById)
      );
  }, [accounts, searchTerm, quickFilter, lastVoucherMsById, hideSettled]);

  const visibleAccountAttachmentUrls = useMemo(
    () =>
      filteredAndSortedAccounts
        .map((a) => {
          const live = staffById.get(a.id) ?? a;
          return resolveLoanAccountAvatarUrl(live, loanByAccountId.get(a.id), processedAccounts);
        })
        .filter((u): u is string => Boolean(u)),
    [filteredAndSortedAccounts, staffById, loanByAccountId, processedAccounts]
  );
  usePrewarmVisibleAttachments(visibleAccountAttachmentUrls, company?.id);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedAccounts.map((a) => a.id)),
    [filteredAndSortedAccounts]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedAccounts,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );
  /** Add/edit (naya ya data change) row par ~1s highlight; sort/filter/first load par nahi. */
  const rowChangeHighlight = useRowChangeHighlight(displayListRows, { getId: (row) => row.id });

  return (
    <div className={masterListShellCn}>
      <ScrollArea
        listChrome
        className="min-h-0 min-w-0 flex-1"
        onViewportScroll={markListScrolling}
        onViewportTouchMove={markListScrolling}
      >
        <ul className="pl-master-list-ul">
          <AnimatePresence mode={animatePresenceMode}>
            {displayListRows.map((account) => {
              const isSelected = selectedAccount?.id === account.id;
              const liveAccount = staffById.get(account.id) ?? account;
              const linkedLoan = loanByAccountId.get(account.id);
              const displayName = String(liveAccount.name || "").trim() || "Loan account";
              const accountTypeLabel = loanTypeByAccountId.get(account.id) || "";
              const attachmentPreviewUrl = resolveLoanAccountAvatarUrl(
                liveAccount,
                linkedLoan,
                processedAccounts
              );
              const avatarCompanyId =
                String(liveAccount.companyId || linkedLoan?.companyId || company?.id || "").trim() || undefined;
              const cardClassName = masterListRowUnselectedCn(isSelected);
              const displayBalance = Number(account.balance) || 0;
              const cardContent = (
                <div className="pl-master-list-row">
                  <div className="pl-master-list-row-leading">
                    <div className="relative flex-shrink-0">
                      <EntityFileAttachmentHover
                        fileUrl={attachmentPreviewUrl}
                        triggerClassName="inline-flex shrink-0 rounded-full"
                      >
                        <ResolvedEntityAvatar
                          className={MASTER_LIST_AVATAR_CN}
                          fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                          companyId={avatarCompanyId}
                          src={attachmentPreviewUrl ?? undefined}
                          alt={displayName}
                          fallbackSlot={<LoanLiabilityEntityIcon size="avatar" />}
                        />
                      </EntityFileAttachmentHover>
                      <MasterListPendingBadge count={pendingApprovalByAccountId[account.id] ?? 0} />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <MasterListNameTooltip
                        measureKey={displayName}
                        tooltipContent={
                          <>
                            <p>{displayName}</p>
                            {accountTypeLabel ? (
                              <p className="text-xs text-muted-foreground">{accountTypeLabel}</p>
                            ) : null}
                            {(pendingApprovalByAccountId[account.id] ?? 0) > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {pendingApprovalByAccountId[account.id]} pending approval
                              </p>
                            )}
                          </>
                        }
                      >
                        {highlightSearch ? highlightQueryInText(displayName, highlightSearch) : displayName}
                      </MasterListNameTooltip>
                      {accountTypeLabel ? (
                        <span
                          className="truncate text-[11px] leading-tight text-muted-foreground"
                          title={accountTypeLabel}
                        >
                          {accountTypeLabel}
                        </span>
                      ) : null}
                      {readMasterAccountFrozen(account) ? <MasterAccountFreezeListBadge className="mt-0.5" /> : null}
                    </div>
                  </div>
                  <p
                    data-pl-list-balance={displayBalance >= 0 ? "dr" : "cr"}
                    className={cn(
                      "ml-2 shrink-0 pl-master-list-row-amount",
                      masterDetailBalanceToneClass(displayBalance),
                      isSelected && (displayBalance >= 0 ? "text-green-700" : "text-red-700")
                    )}
                  >
                    {formatCurrency(displayBalance, { showDrCr: true })}
                  </p>
                </div>
              );
              return (
                <motion.li key={account.id} layoutDependency={displayOrderKey} {...rowMotionProps} className={rowChangeHighlight.highlightClassName(account.id)}>
                  <MasterListRow
                    selected={isSelected}
                    className={cardClassName}
                    onClick={() => onSelectAccount(account)}
                  >
                    {cardContent}
                  </MasterListRow>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {displayListRows.length === 0 && (
            <div className="text-center text-muted-foreground p-8">No accounts found.</div>
          )}
        </ul>
      </ScrollArea>
      {!hideQuickFilterBar ? (
        <EntityListQuickFilterBar
          active={quickFilter}
          onChange={setQuickFilter}
          hideSettled={hideSettled}
          onHideSettledChange={setHideSettled}
        />
      ) : null}
    </div>
  );
}
