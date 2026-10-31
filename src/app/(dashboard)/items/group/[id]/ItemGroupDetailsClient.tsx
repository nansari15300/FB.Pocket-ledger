'use client';

import { useParams } from 'next/navigation';
import { ItemGroupDetails } from '@/components/items/ItemGroupDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

export function ItemGroupDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedItemGroups, processedItems, vouchers, loading } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const groupId = params.id as string;
  const group = processedItemGroups.find((g) => g.id === groupId);
  const itemsInGroup = processedItems.filter(p => p.groupId === groupId);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    try {
      const userDoc = await getDoc(doc(firestore, 'users', userId));
      if (userDoc.exists()) return userDoc.data().displayName || userDoc.data().email || "Unknown";
    } catch {}
    return "Unknown";
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ItemGroupDetails
        group={group}
        allGroups={processedItemGroups}
        items={itemsInGroup}
        allItems={processedItems}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => router.push('/items')}
        onItemUpdated={() => {}}
        stockView={'amount'}
        onBack={() => router.push(`/items?view=groups&selected=${encodeURIComponent(groupId)}`)}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userNames={userNames}
        transactions={vouchers}
      />
    </div>
  );
}
