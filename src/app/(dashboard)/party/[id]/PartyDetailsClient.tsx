'use client';

import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { PartyDetails as DesktopPartyDetails } from '@/components/party/PartyDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/firebase';
import { useIsMobile } from '@/hooks/use-mobile';
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile, pocketBaseSessionUid } from "@/lib/pocketbaseData/pbAppSession";

function PartyDetailsPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { processedParties, vouchers, loading, journalAccountNames, userNames: vouchersUserNames } = useVouchers();
  const [localUserNames, setLocalUserNames] = useState<Record<string, string>>({});
  const isMobile = useIsMobile();
  const userNames = useMemo(() => ({ ...vouchersUserNames, ...localUserNames }), [vouchersUserNames, localUserNames]);
  const partyId = params.id as string;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (from && to) return { from: new Date(from), to: new Date(to) };
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

  const party = processedParties.find((p) => p.id === partyId);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    const existingName = vouchersUserNames?.[userId] || localUserNames[userId];
    if (existingName && existingName !== "Unknown" && existingName !== "N/A") return existingName;
    // Pocket Ledger Server session: no Firebase user, so Firestore would only fail ("client is offline").
    if (isPocketBaseAppSessionActive()) {
      const p = readPocketBaseAppProfile();
      if (p && (userId === pocketBaseSessionUid(p) || userId === p.id)) {
        const nm = p.name || p.email;
        if (nm) return nm;
      }
    } else try {
      const q = query(collection(firestore, "users"), where("uid", "==", userId));
      const snap = await getDocs(q);
      let data = snap.docs[0]?.data();
      if (!data) {
        const userDoc = await getDoc(doc(firestore, 'users', userId));
        if (userDoc.exists()) data = userDoc.data();
      }
      if (data) {
        const displayName = data.displayName || data.name || data.email || null;
        if (displayName && displayName !== userId && displayName !== "Unknown" && displayName !== "N/A") {
          const isUIDPattern = displayName.length > 15 && /^[a-zA-Z0-9_-]+$/.test(displayName) && !displayName.includes('@') && !displayName.includes(' ');
          if (!isUIDPattern) return displayName;
        }
      }
    } catch (e) { if ((e as { code?: unknown } | null)?.code === "unavailable") { console.debug('[PartyDetailsPage] userName lookup skipped (offline) for', userId); } else { console.error('[PartyDetailsPage] Error fetching userName for', userId, e); } }
    return "N/A";
  }, [vouchersUserNames, localUserNames]);

  useEffect(() => {
    if (!vouchers || vouchers.length === 0) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    const uidsToFetch = Array.from(uids).filter(uid => {
      const vouchersName = vouchersUserNames?.[uid];
      return !vouchersName || vouchersName === "Unknown" || vouchersName === "N/A" || !vouchersUserNames || Object.keys(vouchersUserNames).length === 0;
    });
    if (uidsToFetch.length === 0) return;
    Promise.all(uidsToFetch.map(async (uid) => ({ uid, name: await fetchUserName(uid) }))).then(results => {
      const newUserNames: Record<string, string> = {};
      results.forEach(({ uid, name }) => {
        if (name && name !== "Unknown" && name !== "N/A" && name !== uid && !name.match(/^[a-zA-Z0-9_-]{20,}$/)) newUserNames[uid] = name;
      });
      if (Object.keys(newUserNames).length > 0) setLocalUserNames((prev) => ({ ...prev, ...newUserNames }));
    });
  }, [vouchers, fetchUserName, vouchersUserNames]);

  if (loading) return <LoadingSpinner />;
  if (!party) return <div className="flex items-center justify-center h-full"><p>Party not found.</p></div>;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopPartyDetails
        party={party}
        allParties={processedParties}
        onPartyUpdated={() => {}}
        onPartyDeleted={() => router.push('/party')}
        dateRange={dateRange}
        onDateRangeChange={handleDateRangeChange}
        onBack={() => router.push(`/party?selected=${encodeURIComponent(partyId)}`)}
        userNames={userNames}
        journalAccountNames={journalAccountNames}
      />
    </div>
  );
}

export function PartyDetailsClient() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PartyDetailsPageContent />
    </Suspense>
  );
}
