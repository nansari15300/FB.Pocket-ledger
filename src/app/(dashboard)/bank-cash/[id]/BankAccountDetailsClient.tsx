'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { AccountDetails as DesktopAccountDetails } from '@/components/bank-cash/AccountDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { Suspense, useState, useEffect, useCallback } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/firebase';
import { useIsMobile } from '@/hooks/use-mobile';
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";
import { mergeLedgerUserDisplayNameMaps } from "@/lib/ledgerUserColumnDisplay";

function BankAccountDetailsPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { processedAccounts, vouchers, loading, userNames: vouchersUserNames } = useVouchers();
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const isMobile = useIsMobile();

  const accountId = params.id as string;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (from && to) {
      return { from: new Date(from), to: new Date(to) };
    }
    return undefined;
  });

  const handleDateRangeChange = (newRange: DateRange | undefined) => {
    setDateRange(newRange);
    const currentParams = new URLSearchParams(window.location.search);
    if (newRange?.from && newRange?.to) {
      currentParams.set('from', newRange.from.toISOString());
      currentParams.set('to', newRange.to.toISOString());
    } else {
      currentParams.delete('from');
      currentParams.delete('to');
    }
    router.replace(`${window.location.pathname}?${currentParams.toString()}`);
  };

  const account = processedAccounts.find((a) => a.id === accountId);

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

  const displayUserNames = mergeLedgerUserDisplayNameMaps(vouchersUserNames || {}, userNames);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Account not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopAccountDetails
        account={account}
        allAccounts={processedAccounts}
        onAccountUpdated={() => {}}
        onAccountDeleted={() => router.push('/bank-cash')}
        dateRange={dateRange}
        onDateRangeChange={handleDateRangeChange}
        onBack={() => {
          router.push(`/bank-cash?selected=${encodeURIComponent(accountId)}`);
        }}
        userNames={displayUserNames}
      />
    </div>
  );
}

export function BankAccountDetailsClient() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BankAccountDetailsPageContent />
    </Suspense>
  );
}
