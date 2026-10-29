'use client';

import { useParams } from 'next/navigation';
import { ExpenseGroupDetails as DesktopExpenseGroupDetails } from '@/components/expenses/ExpenseGroupDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { collectExpenseGroupScopeAccounts } from '@/lib/expenseGroupTree';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { masterDetailListHref } from '@/lib/masterDetailListPath';
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

export function ExpenseGroupDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedExpenseGroups, processedExpenseAccounts, vouchers, loading } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const groupId = params.id as string;
  const group = processedExpenseGroups.find((g) => g.id === groupId);
  const accountsInGroup = collectExpenseGroupScopeAccounts(
    groupId,
    processedExpenseGroups,
    processedExpenseAccounts
  );

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    return resolveUserDisplayName(userId, "Unknown");
  }, [userNames]);

  useEffect(() => {
    if (!vouchers) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    const newNames: Record<string, string> = {};
    let hasNewNames = false;
    const promises = Array.from(uids).map(async (uid) => {
      if (!userNames[uid]) { hasNewNames = true; newNames[uid] = await fetchUserName(uid); }
    });
    Promise.all(promises).then(() => { if (hasNewNames) setUserNames((prev) => ({ ...prev, ...newNames })); });
  }, [vouchers, userNames, fetchUserName]);

  if (loading) return <LoadingSpinner />;
  if (!group) return <div className="flex items-center justify-center h-full"><p>Group not found.</p></div>;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopExpenseGroupDetails
        group={group}
        allGroups={processedExpenseGroups}
        accounts={accountsInGroup}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => router.push('/incomes')}
        onAccountUpdated={() => {}}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => router.replace(`${masterDetailListHref("incomes")}?view=groups`, { scroll: false })}
        userNames={userNames}
      />
    </div>
  );
}
