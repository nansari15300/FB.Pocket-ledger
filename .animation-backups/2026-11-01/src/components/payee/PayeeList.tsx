
"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { Receipt, DollarSign, Building } from "lucide-react";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { masterEntityAttachmentPreviewUrl } from "@/lib/masterEntityAttachmentPreviewUrl";
import { reportEntityInitials } from "@/lib/reportEntityInitials";
import { MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN, masterListShellCn } from "@/lib/masterListChrome";
import { useCompany } from "@/hooks/useCompany";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { filterAndSortMasterEntityListRows } from "@/lib/filterMasterEntityListRows";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";

export type UnifiedPayee = {
  id: string;
  name: string;
  type: 'Party' | 'Staff' | 'Tax' | 'Expense' | 'Other' | 'Income';
  balance: number;
  entity: any;
};

const payeeFallbackIconMap = {
  Tax: Receipt,
  Expense: DollarSign,
  Income: DollarSign,
  Other: Building,
} as const;

function payeeAvatarFallback(payee: UnifiedPayee): { fallbackText?: string; fallbackSlot?: React.ReactNode } {
  if (payee.type === "Party") {
    return { fallbackText: reportEntityInitials(payee.name) };
  }
  if (payee.type === "Staff") {
    return { fallbackSlot: <StaffAccountFallbackIcon staff={payee.entity} /> };
  }
  const Icon = payeeFallbackIconMap[payee.type] ?? Building;
  return { fallbackSlot: <Icon className="h-4 w-4 text-muted-foreground" /> };
}

/** Party/Tax masters jaisa — search + footer sort/filter. */
export function filterPayeeListRows(
  payees: UnifiedPayee[],
  searchTerm: string,
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null,
  hideSettled?: boolean
): UnifiedPayee[] {
  return filterAndSortMasterEntityListRows(
    payees.map((p) => ({
      ...p,
      openingBalanceDate: p.entity?.openingBalanceDate,
      createdAt: (p as { createdAt?: unknown }).createdAt ?? (p.entity as { createdAt?: unknown } | undefined)?.createdAt,
      updatedAt: (p as { updatedAt?: unknown }).updatedAt ?? (p.entity as { updatedAt?: unknown } | undefined)?.updatedAt,
      lastEditedAt:
        (p as { lastEditedAt?: unknown }).lastEditedAt ??
        (p.entity as { lastEditedAt?: unknown } | undefined)?.lastEditedAt,
    })),
    searchTerm,
    quickFilter,
    { lastVoucherMsById, hideSettled }
  );
}

export function PayeeList({
  payees,
  selectedPayee,
  onSelectPayee,
  searchTerm,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
}: {
  payees: UnifiedPayee[];
  selectedPayee: UnifiedPayee | null;
  onSelectPayee: (payee: UnifiedPayee) => void;
  searchTerm: string;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
}) {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const [internalQuickFilter, setInternalQuickFilter] = React.useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const filteredPayees = React.useMemo(
    () => filterPayeeListRows(payees, searchTerm, quickFilter, lastVoucherMsById, hideSettled),
    [payees, searchTerm, quickFilter, lastVoucherMsById, hideSettled]
  );

  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();

  const listOrderKey = React.useMemo(
    () => masterListOrderKey(filteredPayees.map((p) => `${p.type}-${p.id}`)),
    [filteredPayees]
  );

  const { displayRows: displayPayees, displayOrderKey } = useMasterListDisplayRows(
    filteredPayees,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );

  return (
    <div className={masterListShellCn} data-theme-list="account-list">
      <ScrollArea
        listChrome
        className="flex-1 min-h-0 min-w-0"
        onViewportScroll={markListScrolling}
        onViewportTouchMove={markListScrolling}
      >
        <ul className="pl-master-list-ul">
          <AnimatePresence mode={animatePresenceMode}>
          {displayPayees.map((payee) => {
            const isSelected = selectedPayee?.id === payee.id && selectedPayee?.type === payee.type;
            const attachmentPreviewUrl = masterEntityAttachmentPreviewUrl(payee.entity);
            const avatarFallback = payeeAvatarFallback(payee);
            return (
              <motion.li
                key={`${payee.type}-${payee.id}`}
                layoutDependency={displayOrderKey}
                {...rowMotionProps}
              >
                <MasterListRow
                  selected={isSelected}
                  className={cn(
                    !isSelected && "border-gray-300 dark:border-gray-600 border-[1.5px] hover:border-orange-300/80 hover:bg-orange-50/30"
                  )}
                  onClick={() => onSelectPayee(payee)}
                >
                  <div className="pl-master-list-row">
                    <div className="pl-master-list-row-leading">
                      <EntityFileAttachmentHover
                        fileUrl={attachmentPreviewUrl}
                        triggerClassName="inline-flex shrink-0 rounded-full"
                      >
                        <ResolvedEntityAvatar
                          className={MASTER_LIST_AVATAR_CN}
                          fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                          companyId={payee.entity?.companyId ?? company?.id}
                          src={attachmentPreviewUrl ?? undefined}
                          alt={payee.name}
                          fallbackText={avatarFallback.fallbackText}
                          fallbackSlot={avatarFallback.fallbackSlot}
                        />
                      </EntityFileAttachmentHover>
                      <MasterListNameTooltip measureKey={payee.name} tooltipContent={<p>{payee.name}</p>}>
                        {payee.name}
                      </MasterListNameTooltip>
                    </div>
                    <p
                      className={cn(
                        "pl-master-list-row-amount ml-2",
                        payee.balance >= 0 ? "text-green-600" : "text-red-600",
                        isSelected &&
                          (payee.balance >= 0
                            ? "text-green-800"
                            : "text-red-800")
                      )}
                    >
                      {formatCurrency(payee.balance, { showDrCr: true, context: "list" })}
                    </p>
                  </div>
                </MasterListRow>
              </motion.li>
            );
          })}
          </AnimatePresence>
          {displayPayees.length === 0 && (
            <div className="text-center text-muted-foreground p-8">
              No payees found.
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
