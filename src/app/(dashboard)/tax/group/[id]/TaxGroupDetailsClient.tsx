'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams } from 'next/navigation';
import { TaxGroupDetails } from '@/components/tax/TaxGroupDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import type { Tax } from '@/components/tax/types';
import { filterMembersByMasterGroupScope } from '@/lib/masterGroupMemberScope';
import { TAX_ENTITY_GROUP_PRESET } from '@/lib/masterEntityGroupFormPresets';
import { isMasterEntitySystemGroupId, resolveTaxListGroupBucketId } from '@/lib/masterEntitySystemGroups';
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/plClientSession';
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

export function TaxGroupDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedTaxGroups, processedTaxes, vouchers, loading, journalAccountNames } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const groupId = params.id as string;
  const group = processedTaxGroups.find((g) => g.id === groupId);
  const taxesInGroup = filterMembersByMasterGroupScope<Tax>(
    groupId,
    processedTaxes,
    processedTaxGroups,
    resolveTaxListGroupBucketId,
    (id) => isMasterEntitySystemGroupId(TAX_ENTITY_GROUP_PRESET, id),
    (tax, branchId) => resolveTaxListGroupBucketId(tax) === branchId
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
      <TaxGroupDetails
        group={group}
        allGroups={processedTaxGroups}
        taxes={taxesInGroup}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => router.push('/tax')}
        onTaxUpdated={() => {}}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => router.push(`/tax?view=groups&selected=${encodeURIComponent(groupId)}`)}
        userNames={userNames}
        journalAccountNames={journalAccountNames}
      />
    </div>
  );
}
