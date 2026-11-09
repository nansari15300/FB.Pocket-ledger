'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams } from 'next/navigation';
import { TaxDetails as DesktopTaxDetails } from '@/components/tax/TaxDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/plClientSession';
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

export function TaxDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedTaxes, vouchers, loading, journalAccountNames } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const taxId = params.id as string;
  const tax = processedTaxes.find((t) => t.id === taxId);

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
  if (!tax) return <div className="flex items-center justify-center h-full"><p>Tax ledger not found.</p></div>;

  const relevantTransactions = vouchers.filter(v =>
    v.taxAccountId === tax.id ||
    (Array.isArray(v.lineItems) && v.lineItems.some((line: any) => line.taxAccountId === tax.id)) ||
    (v.type === 'note' && v.context === 'Tax' && v.entityId === tax.id) ||
    (v.type === 'journal' && Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === tax.id))
  );

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopTaxDetails
        tax={tax}
        allTaxes={processedTaxes}
        transactions={relevantTransactions}
        onTaxUpdated={() => {}}
        onTaxDeleted={() => router.push('/tax')}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => router.push(`/tax?selected=${encodeURIComponent(taxId)}`)}
        userNames={userNames}
        journalAccountNames={journalAccountNames}
      />
    </div>
  );
}
