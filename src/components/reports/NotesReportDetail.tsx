"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Landmark, LayoutGrid, Package, PlusCircle, Receipt, Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { NoteDetails } from "@/components/notes/NoteDetails";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { collection, query, orderBy, where } from "@/lib/pbCompat/firestore";
import type { Party } from "@/components/party/types";
import type { Staff } from "@/components/staff/types";
import type { Account } from "@/components/bank-cash/types";
import type { Tax } from "@/components/tax/types";
import type { Item } from "@/components/items/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportRegisterDesktopSplit } from "@/components/reports/ReportRegisterDesktopSplit";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";
import {
    MASTER_LIST_AVATAR_CN,
    MASTER_LIST_AVATAR_FALLBACK_CN,
    masterListRowUnselectedCn,
    masterListShellCn,
} from "@/lib/masterListChrome";
import { MasterListRow } from "@/components/ui/master-list-row";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import { masterEntityAttachmentPreviewUrl } from "@/lib/masterEntityAttachmentPreviewUrl";
import { reportEntityInitials } from "@/lib/reportEntityInitials";
import {
    EntityListQuickFilterBar,
    type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { filterAndSortMasterEntityListRows } from "@/lib/filterMasterEntityListRows";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";

const ALL_NOTES_LIST_ROW_NAME = "All";

type NotedEntity = {
    id: string;
    name: string;
    type: 'Party' | 'Bank/Cash' | 'Staff' | 'Tax' | 'Items';
    entity: any;
    /** Latest note on this account — footer "By Date" sort. */
    openingBalanceDate?: unknown;
    /** Note count — footer "Default" sort (most notes first). */
    balance?: number;
};

function notedEntityAvatarFallback(entity: NotedEntity): {
    fallbackText?: string;
    fallbackSlot?: ReactNode;
} {
    switch (entity.type) {
        case "Party":
            return { fallbackText: reportEntityInitials(entity.name) };
        case "Staff":
            return { fallbackSlot: <StaffAccountFallbackIcon staff={entity.entity} /> };
        case "Tax":
            return { fallbackSlot: <Receipt className="h-4 w-4 text-muted-foreground" /> };
        case "Bank/Cash":
            return { fallbackSlot: <Landmark className="h-4 w-4 text-muted-foreground" /> };
        case "Items":
            return { fallbackSlot: <Package className="h-4 w-4 text-muted-foreground" /> };
        default:
            return { fallbackText: reportEntityInitials(entity.name) };
    }
}

function NotedEntityList({
    entities,
    selectedEntity,
    onSelectEntity,
    searchTerm,
    companyId,
    quickFilter,
    onQuickFilterChange,
    showAllSelected,
    onSelectAll,
}: {
    entities: NotedEntity[];
    selectedEntity: NotedEntity | null;
    onSelectEntity: (entity: NotedEntity) => void;
    searchTerm: string;
    companyId?: string | null;
    quickFilter: EntityListQuickFilter;
    onQuickFilterChange: (next: EntityListQuickFilter) => void;
    showAllSelected: boolean;
    onSelectAll: () => void;
}) {
    const lastVoucherMsById = useLastVoucherMsByEntityId();
    const filteredEntities = useMemo(
        () =>
            filterAndSortMasterEntityListRows(
                entities.map((e) => ({
                    ...e,
                    name: e.name,
                    balance: e.balance,
                    openingBalanceDate: e.openingBalanceDate ?? e.entity?.openingBalanceDate,
                })),
                searchTerm,
                quickFilter,
                { lastVoucherMsById }
            ),
        [entities, searchTerm, quickFilter, lastVoucherMsById]
    );

    const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
        useMasterListRowMotion();

    const listOrderKey = useMemo(
        () => masterListOrderKey(filteredEntities.map((e) => `${e.type}-${e.id}`)),
        [filteredEntities]
    );

    const { displayRows: displayEntities, displayOrderKey } = useMasterListDisplayRows(
        filteredEntities,
        listOrderKey,
        { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
    );

    const showAllRow = useMemo(() => {
        if (!searchTerm.trim()) return true;
        return ALL_NOTES_LIST_ROW_NAME.toLowerCase().includes(searchTerm.trim().toLowerCase());
    }, [searchTerm]);

    return (
        <div className={masterListShellCn} data-theme-list="account-list">
        <ScrollArea
            listChrome
            className="flex-1 min-h-0 min-w-0"
            onViewportScroll={markListScrolling}
            onViewportTouchMove={markListScrolling}
        >
            <ul className="pl-master-list-ul">
                {showAllRow ? (
                    <li key="all-notes">
                        <MasterListRow
                            selected={showAllSelected}
                            className={cn("cursor-pointer", masterListRowUnselectedCn(showAllSelected))}
                            onClick={onSelectAll}
                        >
                            <div className="pl-master-list-row">
                                <div className="pl-master-list-row-leading min-w-0 flex-1">
                                    <div className={cn(MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN, "flex items-center justify-center")}>
                                        <LayoutGrid className="h-4 w-4" />
                                    </div>
                                    <MasterListNameTooltip
                                        measureKey={ALL_NOTES_LIST_ROW_NAME}
                                        tooltipContent={<p>{ALL_NOTES_LIST_ROW_NAME}</p>}
                                    >
                                        {ALL_NOTES_LIST_ROW_NAME}
                                    </MasterListNameTooltip>
                                </div>
                            </div>
                        </MasterListRow>
                    </li>
                ) : null}
                <AnimatePresence mode={animatePresenceMode}>
                {displayEntities.map((entity) => {
                    const isSelected = selectedEntity?.id === entity.id && selectedEntity?.type === entity.type;
                    const attachmentPreviewUrl = masterEntityAttachmentPreviewUrl(entity.entity);
                    const avatarFallback = notedEntityAvatarFallback(entity);
                    return (
                        <motion.li
                            key={`${entity.type}-${entity.id}`}
                            layoutDependency={displayOrderKey}
                            {...rowMotionProps}
                        >
                            <MasterListRow
                                selected={isSelected}
                                className={cn("cursor-pointer", masterListRowUnselectedCn(isSelected))}
                                onClick={() => onSelectEntity(entity)}
                            >
                                <div className="pl-master-list-row">
                                    <div className="pl-master-list-row-leading min-w-0 flex-1">
                                        <EntityFileAttachmentHover
                                            fileUrl={attachmentPreviewUrl}
                                            triggerClassName="inline-flex shrink-0 rounded-full"
                                        >
                                            <ResolvedEntityAvatar
                                                className={MASTER_LIST_AVATAR_CN}
                                                fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                                                companyId={entity.entity?.companyId ?? companyId ?? undefined}
                                                src={attachmentPreviewUrl ?? undefined}
                                                alt={entity.name}
                                                fallbackText={avatarFallback.fallbackText}
                                                fallbackSlot={avatarFallback.fallbackSlot}
                                            />
                                        </EntityFileAttachmentHover>
                                        <div className="min-w-0 flex-1">
                                            <MasterListNameTooltip
                                                measureKey={entity.name}
                                                tooltipContent={<p>{entity.name}</p>}
                                            >
                                                {entity.name}
                                            </MasterListNameTooltip>
                                            <span className="text-xs text-muted-foreground">({entity.type})</span>
                                        </div>
                                    </div>
                                </div>
                            </MasterListRow>
                        </motion.li>
                    );
                })}
                </AnimatePresence>
            </ul>
        </ScrollArea>
        <EntityListQuickFilterBar
            active={quickFilter}
            onChange={onQuickFilterChange}
            only={["default", "name", "date"]}
        />
        </div>
    );
}

export function NotesReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { formatCurrency } = useDate();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { companyId } = useCompany();
  const { vouchers: allVouchers, loading: vouchersLoading, processedParties } = useFyScopedVouchers();
  const [selectedEntity, setSelectedEntity] = useState<NotedEntity | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [listQuickFilter, setListQuickFilter] = useState<EntityListQuickFilter>("default");
  const [showAllNotes, setShowAllNotes] = useState(false);
  const hasAutoSelected = useRef(false);

  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const noteVouchers = useMemo(() => allVouchers.filter((v) => v.type === "note"), [allVouchers]);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    try {
      const userDoc = await getDoc(doc(firestore, "users", userId));
      if (userDoc.exists()) {
        return userDoc.data().displayName || userDoc.data().email || "Unknown";
      }
    } catch (_) {}
    return "Unknown";
  }, []);

  useEffect(() => {
    const uids = new Set(allVouchers.map((t) => t.userId).filter(Boolean) as string[]);
    uids.forEach(async (uid) => {
      if (!userNames[uid]) {
        const name = await fetchUserName(uid);
        setUserNames((prev) => ({ ...prev, [uid]: name }));
      }
    });
  }, [allVouchers, userNames, fetchUserName]);

  useEffect(() => {
    if (!companyId) {
      setParties([]);
      setAccounts([]);
      setStaff([]);
      setTaxes([]);
      setItems([]);
      return;
    }

    const unsubs = [
      onSnapshot(query(collection(firestore, `companies/${companyId}/parties`)), (snap) => {
        setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)));
      }),
      onSnapshot(query(collection(firestore, `companies/${companyId}/bank_accounts`)), (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Account)));
      }),
      onSnapshot(query(collection(firestore, `companies/${companyId}/staff`)), (snap) => {
        setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as Staff)));
      }),
      onSnapshot(query(collection(firestore, `companies/${companyId}/taxes`)), (snap) => {
        setTaxes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Tax)));
      }),
      onSnapshot(query(collection(firestore, `companies/${companyId}/items`)), (snap) => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
      }),
    ];

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [companyId]);

  const notedEntities = useMemo(() => {
    if (vouchersLoading || noteVouchers.length === 0) return [];

    const latestNoteMsByKey = new Map<string, number>();
    for (const v of noteVouchers) {
      const key = `${v.context}-${v.entityId}`;
      const raw = v.date as { toDate?: () => Date } | Date | string | number | undefined;
      let ms = 0;
      if (raw && typeof (raw as { toDate?: () => Date }).toDate === "function") {
        const d = (raw as { toDate: () => Date }).toDate();
        ms = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      } else if (raw instanceof Date) {
        ms = Number.isNaN(raw.getTime()) ? 0 : raw.getTime();
      } else if (raw != null) {
        const d = new Date(raw as string | number);
        ms = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      }
      latestNoteMsByKey.set(key, Math.max(latestNoteMsByKey.get(key) ?? 0, ms));
    }
    
    const getEntitiesWithNotes = <T extends { id: string, name?: string, accountName?: string }>(entities: T[], context: string): NotedEntity[] => {
        const entityIdsWithNotes = new Set(noteVouchers.filter(v => v.context === context).map(v => v.entityId));
        return entities
            .filter(e => entityIdsWithNotes.has(e.id))
            .map(e => {
                const type = context as NotedEntity['type'];
                const noteCount = noteVouchers.filter(
                    (v) => v.context === context && v.entityId === e.id
                ).length;
                return {
                    id: e.id,
                    name: e.name || e.accountName || 'Unknown',
                    type,
                    entity: e,
                    openingBalanceDate: latestNoteMsByKey.get(`${type}-${e.id}`) ?? 0,
                    balance: noteCount,
                };
            });
    };

    return [
        ...getEntitiesWithNotes(parties, 'Party'),
        ...getEntitiesWithNotes(accounts, 'Bank/Cash'),
        ...getEntitiesWithNotes(staff, 'Staff'),
        ...getEntitiesWithNotes(taxes, 'Tax'),
        ...getEntitiesWithNotes(items, 'Items'),
    ];

  }, [noteVouchers, parties, accounts, staff, items, taxes, vouchersLoading]);

  const totalNotes = useMemo(() => noteVouchers.length, [noteVouchers]);

  const entityTransactions = useMemo(() => {
    if (!selectedEntity) return [];
    return noteVouchers.filter((v) => v.entityId === selectedEntity.id && v.context === selectedEntity.type);
  }, [noteVouchers, selectedEntity]);

  const allNotesEntity = useMemo(() => {
    if (!showAllNotes) return null;
    return {
      id: "all",
      name: "All Notes",
      type: 'Party' as const,
      entity: { 
        id: "all", 
        name: "All Notes",
        type: 'Party' as const,
      },
    };
  }, [showAllNotes]);

  const currentEntity = showAllNotes ? allNotesEntity : selectedEntity;
  const currentTransactions = showAllNotes ? noteVouchers : entityTransactions;
  
  const entityForDetails = useMemo(() => {
    if (!currentEntity) return null;
    // NoteDetails expects entity with id, name, and type
    return {
      id: currentEntity.entity.id,
      name: currentEntity.entity.name || currentEntity.entity.accountName || currentEntity.name,
      type: currentEntity.type,
    };
  }, [currentEntity]);

  const filteredEntities = useMemo(() => {
    return filterAndSortMasterEntityListRows(
      notedEntities.map((e) => ({
        ...e,
        name: e.name,
        balance: e.balance,
        openingBalanceDate: e.openingBalanceDate ?? e.entity?.openingBalanceDate,
      })),
      searchTerm,
      listQuickFilter,
      { lastVoucherMsById }
    );
  }, [notedEntities, searchTerm, listQuickFilter, lastVoucherMsById]);

  const REPORT_MEMORY_KEY = "reportNotesState";

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllNotes(true);
        setSelectedEntity(null);
      }
      return;
    }
    if (notedEntities.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { entityId?: string }) : null;
      const entityId = saved?.entityId;
      if (entityId === "all") {
        setShowAllNotes(true);
        setSelectedEntity(null);
        return;
      }
      if (entityId) {
        const found = notedEntities.find((e) => e.id === entityId);
        if (found) {
          setSelectedEntity(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedEntity(notedEntities[0]);
  }, [notedEntities, isMobile, searchParams]);

  const handleSelectEntity = useCallback((entity: NotedEntity) => {
    setShowAllNotes(false);
    setSelectedEntity(entity);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ entityId: entity.id }));
    } catch (_) {}
  }, []);

  const handleSelectAll = useCallback(() => {
    setShowAllNotes(true);
    setSelectedEntity(null);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ entityId: "all" }));
    } catch (_) {}
  }, []);

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  // Mobile: show list first, then details when selected (like party page)
  if (isMobile) {
    if (entityForDetails) {
      return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <NoteDetails
              entity={entityForDetails}
              transactions={currentTransactions}
              userNames={userNames}
              onShowAll={() => setShowAllNotes(true)}
              isAllVouchersView={showAllNotes}
              mobileFooterVariant="report"
              mobileReportStickyTitle={showAllNotes ? "All Notes" : "Notes"}
              onBack={() => {
                setSelectedEntity(null);
                setShowAllNotes(false);
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <ReportRegisterMobileListChrome
        title="Notes"
        actionSlot={
          <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="note">
            <PermissionButton permission="create_records" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Note
            </PermissionButton>
          </AddVoucherDialog>
        }
        summary={{
          label: "Total Notes",
          amountText: String(totalNotes),
          amountClassName: "text-green-600",
        }}
        searchPlaceholder="Search accounts..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        listSectionTitle={`Note accounts (${filteredEntities.length})`}
      >
        <NotedEntityList
          entities={notedEntities}
          onSelectEntity={handleSelectEntity}
          selectedEntity={selectedEntity}
          searchTerm={searchTerm}
          companyId={companyId}
          quickFilter={listQuickFilter}
          onQuickFilterChange={setListQuickFilter}
          showAllSelected={showAllNotes}
          onSelectAll={handleSelectAll}
        />
      </ReportRegisterMobileListChrome>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ReportRegisterDesktopSplit
        listPanel={
          <>
            <div className="p-4 border-b space-y-3 flex-shrink-0">
              <ReportRegisterListHeading>Notes</ReportRegisterListHeading>
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Notes</p>
                <p className="text-xl font-bold text-green-600">
                  {totalNotes}
                </p>
              </Card>
            </div>
            <ReportRegisterListSearchRow
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={setSearchTerm}
            />
            <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
              <h3 className="text-sm font-semibold">Note accounts ({filteredEntities.length})</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <NotedEntityList
                entities={notedEntities}
                onSelectEntity={handleSelectEntity}
                selectedEntity={selectedEntity}
                searchTerm={searchTerm}
                companyId={companyId}
                quickFilter={listQuickFilter}
                onQuickFilterChange={setListQuickFilter}
                showAllSelected={showAllNotes}
                onSelectAll={handleSelectAll}
              />
            </div>
          </>
        }
        detailPanel={
          entityForDetails ? (
            <NoteDetails
              entity={entityForDetails}
              transactions={currentTransactions}
              userNames={userNames}
              onShowAll={() => setShowAllNotes(true)}
              isAllVouchersView={showAllNotes}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>Select an account</CardTitle>
                  <CardDescription>
                    Choose a note account from the list to view notes.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {notedEntities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No notes recorded yet. Create a note to see accounts here.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )
        }
      />
    </div>
  );
}
