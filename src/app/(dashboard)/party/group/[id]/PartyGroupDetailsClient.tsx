'use client';

import { useParams } from 'next/navigation';
import { GroupDetails as DesktopGroupDetails } from '@/components/party/GroupDetails';
import { useVouchers } from '@/hooks/useVouchers';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { doc, getDoc, collection, query, getDocs, where } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile, pocketBaseSessionUid } from "@/lib/pocketbaseData/pbAppSession";

export function PartyGroupDetailsClient() {
  const params = useParams();
  const router = useRouter();
  const { processedGroups, processedParties, vouchers, loading, userNames: vouchersUserNames } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [localUserNames, setLocalUserNames] = useState<Record<string, string>>({});
  const userNames = useMemo(() => ({ ...vouchersUserNames, ...localUserNames }), [vouchersUserNames, localUserNames]);
  const groupId = params.id as string;
  const group = processedGroups.find((g) => g.id === groupId);
  const partiesInGroup = processedParties.filter(p => p.groupId === groupId);

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
    } catch (e) { if ((e as { code?: unknown } | null)?.code === "unavailable") { console.debug('[GroupDetailsPage] userName lookup skipped (offline) for', userId); } else { console.error('[GroupDetailsPage] Error fetching userName for', userId, e); } }
    return "N/A";
  }, [vouchersUserNames, localUserNames]);

  useEffect(() => {
    if (!vouchers || vouchers.length === 0) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    const uidsToFetch = Array.from(uids).filter(uid => !vouchersUserNames?.[uid] || vouchersUserNames?.[uid] === "Unknown" || vouchersUserNames?.[uid] === "N/A" || !vouchersUserNames || Object.keys(vouchersUserNames).length === 0);
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
  if (!group) return <div className="flex items-center justify-center h-full"><p>Group not found.</p></div>;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <DesktopGroupDetails
        group={group}
        allGroups={processedGroups}
        allParties={processedParties}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => router.push('/party')}
        onPartyUpdated={() => {}}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => router.push(`/party?view=groups&selected=${encodeURIComponent(groupId)}`)}
        userNames={userNames}
      />
    </div>
  );
}
