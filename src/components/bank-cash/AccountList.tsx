
"use client";

import { bankAccountDisplayName } from "@/lib/bankAccountDisplayName";
import type { Account } from "@/components/bank-cash/types";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils"
import { masterListShellCn, masterListRowUnselectedCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { useRowChangeHighlight } from "@/hooks/useRowChangeHighlight";
import { Landmark, Crown } from "lucide-react";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { userCanViewSpecialAccountBalance, userIsSpecialAccountOwner } from "@/lib/specialAccountUsage";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { MasterAliasSearchHint } from "@/components/entity/MasterAliasSearchHint";
import {
  compareEntityListQuickFilterSort,
  masterEntityTextMatchesSearch,
  shouldHideEntityListSettledRow,
} from "@/lib/filterMasterEntityListRows";
import { useBankLedgerDrCrPerspective } from "@/hooks/useBankLedgerDrCrPerspective";
import { flipLedgerSignedBalance } from "@/lib/bankLedgerDrCrPerspective";

export function AccountList({
  accounts,
  selectedAccount,
  onSelectAccount,
  searchTerm,
  pendingApprovalByAccountId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
}: {
  accounts: Account[];
  selectedAccount: Account | null;
  onSelectAccount: (account: Account) => void;
  searchTerm: string;
  /** Pending approval count per account id (only when approve notifications on list). */
  pendingApprovalByAccountId?: Record<string, number>;
  /** When provided, use Link for navigation (mobile/Capacitor) – static export ke liye query params */
  getItemHref?: (account: Account) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
}) {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { can } = usePermissions();
  const { perspective: bankDrCrPerspective } = useBankLedgerDrCrPerspective();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } = useMasterListRowMotion();
  const canViewSpecialAccount = can("view_special_bank_accounts");
  const { user } = useAuth();
  const isSpecialAccountOwner = userIsSpecialAccountOwner(
    String(user?.email || user?.uid || ""),
    company
  );
  const highlightSearch = searchTerm.trim();

  const filteredAndSortedAccounts = useMemo(() => {
      const isSettled = (bal: number) => Math.abs(Number(bal || 0)) < 1e-6;
      return accounts
        .filter(account => {
            if (account.isSpecial && !canViewSpecialAccount) return false;
            const label = bankAccountDisplayName(account);
            if (!label || !(masterEntityTextMatchesSearch(label, searchTerm) || masterEntityTextMatchesSearch((account as { aliasName?: string }).aliasName || "\u0000", searchTerm))) return false;
            const bal = Number(account.balance || 0);
            // Footer quick filters: list short/filter from same control on mobile + desktop.
            if (quickFilter === "dr") return bal > 0;
            if (quickFilter === "cr") return bal < 0;
            if (shouldHideEntityListSettledRow(bal, hideSettled, quickFilter)) return false;
            if (quickFilter === "settled") return isSettled(bal);
            if (quickFilter === "non_settled") return !isSettled(bal);
            return true;
        })
        .sort((a, b) =>
          compareEntityListQuickFilterSort(
            a,
            b,
            quickFilter,
            (row) => bankAccountDisplayName(row),
            lastVoucherMsById
          )
        );
  }, [accounts, searchTerm, canViewSpecialAccount, quickFilter, lastVoucherMsById, hideSettled]);

  const visibleAccountAttachmentUrls = useMemo(
    () =>
      filteredAndSortedAccounts
        .map((a) => trimEntityFileUrlForPreview(a.fileUrl))
        .filter((u): u is string => Boolean(u)),
    [filteredAndSortedAccounts]
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
    <div className={masterListShellCn} data-theme-list="account-list">
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
              const isSpecial = account.isSpecial;
              const displayName = bankAccountDisplayName(account);
              const href = getItemHref?.(account);
              const attachmentPreviewUrl = trimEntityFileUrlForPreview(account.fileUrl);
              const cardClassName = masterListRowUnselectedCn(isSelected);
              const displayBalance = flipLedgerSignedBalance(
                Number(account.balance) || 0,
                bankDrCrPerspective
              );
              const canViewSpecialBalance = userCanViewSpecialAccountBalance(
                account,
                user?.email,
                isSpecialAccountOwner
              );
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
                          companyId={account.companyId}
                          src={attachmentPreviewUrl ?? undefined}
                          alt={displayName}
                          fallbackSlot={
                            isSpecial ? (
                              <Crown className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Landmark className="h-4 w-4 text-muted-foreground" />
                            )
                          }
                        />
                      </EntityFileAttachmentHover>
                      <MasterListPendingBadge count={pendingApprovalByAccountId[account.id] ?? 0} />
                    </div>
                    <div className="flex min-w-0 flex-col">
                    <MasterListNameTooltip
                      measureKey={displayName}
                      className={isSpecial ? "text-amber-600" : undefined}
                      tooltipContent={
                        <>
                          <p>{displayName}</p>
                          {(pendingApprovalByAccountId[account.id] ?? 0) > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {pendingApprovalByAccountId[account.id]} pending approval
                            </p>
                          )}
                        </>
                      }
                    >
                      {highlightSearch ? highlightQueryInText(displayName, highlightSearch) : displayName}
<MasterAliasSearchHint alias={(account as { aliasName?: string }).aliasName} name={displayName} search={highlightSearch} />
                    </MasterListNameTooltip>
                    {readMasterAccountFrozen(account) ? (
                      <MasterAccountFreezeListBadge className="mt-0.5" />
                    ) : null}
                    </div>
                  </div>
                  {/* data-pl-list-balance: mobile list chrome me Dr/Cr color force (globals.css) */}
                  <p
                    data-pl-list-balance={displayBalance >= 0 ? "dr" : "cr"}
                    className={cn(
                      "ml-2 shrink-0 pl-master-list-row-amount",
                      masterDetailBalanceToneClass(displayBalance),
                      isSelected &&
                        (displayBalance >= 0 ? "text-green-700" : "text-red-700")
                    )}
                  >
                    {isSpecial && !canViewSpecialBalance
                      ? "*****"
                      : formatCurrency(displayBalance, { showDrCr: true })}
                  </p>
                </div>
              );
              return (
                <motion.li key={account.id} layoutDependency={displayOrderKey} {...rowMotionProps} className={rowChangeHighlight.highlightClassName(account.id)}>
                  {href ? (
                    // Master list navigation: per-row auto-prefetch off rakho to avoid repeat background bursts on revisit.
                    <Link
                      prefetch={false}
                      href={href}
                      onClick={() => onSelectAccount(account)}
                      className="block min-w-0 max-w-full overflow-hidden"
                    >
                      <MasterListRow selected={isSelected} className={cardClassName}>{cardContent}</MasterListRow>
                    </Link>
                  ) : (
                    <MasterListRow selected={isSelected} className={cardClassName} onClick={() => onSelectAccount(account)}>
                      {cardContent}
                    </MasterListRow>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
          {displayListRows.length === 0 && (
            <div className="text-center text-muted-foreground p-8">
              No accounts found.
            </div>
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
