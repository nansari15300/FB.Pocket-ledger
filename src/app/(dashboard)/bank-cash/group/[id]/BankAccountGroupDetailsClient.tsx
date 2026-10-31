'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams, useRouter } from 'next/navigation';
import { AccountGroupDetails as DesktopAccountGroupDetails } from '@/components/bank-cash/AccountGroupDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import type { Account } from '@/components/bank-cash/types';
import { filterMembersByMasterGroupScope } from '@/lib/masterGroupMemberScope';
import { BANK_ENTITY_GROUP_PRESET } from '@/lib/masterEntityGroupFormPresets';
import { isMasterEntitySystemGroupId, resolveBankListGroupBucketId } from '@/lib/masterEntitySystemGroups';
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/firebase';
import { useIsMobile } from '@/hooks/use-mobile';
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

export function BankAccountGroupDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedAccountGroups, processedAccounts, vouchers, loading } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const isMobile = useIsMobile();
  const groupId = params.id as string;
  const group = processedAccountGroups.find((g) => g.id === groupId);
  const accountsInGroup = filterMembersByMasterGroupScope<Account>(
    groupId,
    processedAccounts,
    processedAccountGroups,
    resolveBankListGroupBucketId,
    (id) => isMasterEntitySystemGroupId(BANK_ENTITY_GROUP_PRESET, id),
    (account, branchId) => resolveBankListGroupBucketId(account) === branchId
  );

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    return resolveUserDisplayName(userId, "Unknown");
  }, [userNames]);

  useEffect(() => {
    if (!vouchers) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    uids.forEach(async (uid) => {
      if (!userNames[uid as string]) {
        const name = await fetchUserName(uid as string);
        setUserNames((prev) => ({ ...prev, [uid as string]: name }));
      }
    });
  }, [vouchers, userNames, fetchUserName]);

  if (loading) return <LoadingSpinner />;
  if (!group) return <div className="flex items-center justify-center h-full"><p>Group not found.</p></div>;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopAccountGroupDetails
        group={group}
        allGroups={processedAccountGroups}
        accounts={accountsInGroup}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => router.push('/bank-cash')}
        onAccountUpdated={() => {}}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => router.push(`/bank-cash?view=groups&selected=${encodeURIComponent(groupId)}`)}
        userNames={userNames}
      />
    </div>
  );
}
