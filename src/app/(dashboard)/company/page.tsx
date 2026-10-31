
"use client";

import { CompanySelector } from "@/components/company/CompanySelector";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useMemo } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { isLocalOnlyMode } from "@/lib/localMode";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getLocalCompanyById, listLocalCompanies, localCompanyRowIsDeleted } from "@/lib/localCompanyStore";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import { filterSharedOnlyCompaniesForSuperAdminInMainApp } from "@/lib/companySuperAdminFilter";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";
import { activateOnlineGateForCompanyPicker } from "@/lib/gates/gateClientDefaults";
import { isLocalSelectorCompanyRow, stampPureLocalDeviceCompanyRow, isDeviceLocalCompany } from "@/lib/companyStorageKind";
import { normalizeRowForLocalDriveSyncUi } from "@/lib/localCloudSync/companyConfig";
import { filterPackedMyCompanyRows } from "@/lib/plServerPackedApp";

/** Device-local SQLite rows — online Firestore picker list me merge (Drive restore / join ke baad). */
function mergeDeviceLocalCompaniesIntoMap(
  companyMap: Map<string, Company>,
  localRows: Company[],
  user: { uid?: string | null; email?: string | null } | null | undefined
) {
  const isOwnedByUser = (c: Company) =>
    c.ownerId === user?.uid ||
    (!!c.ownerEmail &&
      !!user?.email &&
      c.ownerEmail.toLowerCase().trim() === user.email!.toLowerCase().trim());
  for (const c of localRows) {
    if (!isCompanyVisibleInCompanyPage(c)) continue;
    if (localCompanyRowIsDeleted(c as { isDeleted?: unknown })) continue;
    if (!isLocalSelectorCompanyRow(c)) continue;
    const driveSharedJoin =
      (c as Company & { driveSharedJoin?: boolean }).driveSharedJoin === true;
    const normalized = normalizeRowForLocalDriveSyncUi({
      ...c,
      id: c.id,
      name: typeof c.name === "string" ? c.name : c.id,
    });
    const stamped = stampPureLocalDeviceCompanyRow({
      ...normalized,
      storageOption: "local",
      syncedFromCloud: false,
    } as Company);
    const nextRow = {
      ...stamped,
      isOwned: driveSharedJoin ? false : isOwnedByUser(c),
    };
    if (companyMap.has(c.id)) {
      const existing = companyMap.get(c.id)!;
      if (isDeviceLocalCompany(stamped)) {
        companyMap.set(c.id, { ...existing, ...nextRow, isOwned: nextRow.isOwned ?? existing.isOwned });
        continue;
      }
    }
    companyMap.set(c.id, nextRow);
  }
}

export type Company = {
  id: string;
  name: string;
  isOwned: boolean;
  ownerId: string;
  /** Shared-company ownership check (align with useCompany Company) */
  ownerEmail?: string;
  isDeleted?: boolean;
  /** Admin recycle-bin hidden tab marker: normal company picker list se hide. */
  movedToAdminRecycleAt?: unknown;
  storageOption?: 'firebase' | 'drive' | 'local';
  syncedFromCloud?: boolean;
};

/** /company page list guard: deleted + admin-hidden rows ko normal app picker se hatao. */
function isCompanyVisibleInCompanyPage(c: Company): boolean {
  return c.isDeleted !== true && c.movedToAdminRecycleAt == null;
}

function SelectCompanyPageContent() {
  const searchParams = useSearchParams();
  const { user, customUser, loading: authLoading } = useAuth();
  const isSuperAdminByEmail = useMemo(() => {
    const e = (user?.email || "").toLowerCase().trim();
    if (!e) return false;
    return getSuperAdminEmails().some((x) => (x || "").toLowerCase().trim() === e);
  }, [user?.email]);
  const isSuperAdminUser = customUser?.role === "SuperAdmin" || isSuperAdminByEmail;
  const { isOnline } = useOnlineStatus();
  // Local mode: list Firestore snapshots se nahi, useCompany() ke local DB hydrate se aati hai (owned/shared wahi logic jo CompanySelector me).
  const {
    allCompanies: contextCompanies,
    allCompaniesRegistry,
    loading: companyContextLoading,
    reloadLocalCompanyRegistry,
    triggerSync,
    localCompanyRegistryEpoch,
  } = useCompany();
  const [newlyCreatedCompany, setNewlyCreatedCompany] = useState<Company | null>(null);
  const [sqliteLocalRows, setSqliteLocalRows] = useState<Company[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLocalCompanies();
        if (cancelled) return;
        setSqliteLocalRows((prev) => {
          const next = rows
            .filter((r) => !localCompanyRowIsDeleted(r))
            .map((r) => ({
              ...(r as Company),
              id: r.id,
              name: typeof r.name === "string" ? r.name : r.id,
            }));
          const prevSig = prev.map((c) => `${c.id}:${c.name}`).join("|");
          const nextSig = next.map((c) => `${c.id}:${c.name}`).join("|");
          return prevSig === nextSig ? prev : next;
        });
      } catch {
        if (!cancelled) setSqliteLocalRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localCompanyRegistryEpoch]);

  useEffect(() => {
    activateOnlineGateForCompanyPicker();
  }, []);

  useEffect(() => {
    if (authLoading || !user?.uid) return;
    reloadLocalCompanyRegistry();
    if (!isLocalOnlyMode()) triggerSync();
    // Full `user` object identity churned Auth context → registry reload → Popper update-depth loops.
  }, [reloadLocalCompanyRegistry, triggerSync, user?.uid, customUser?.email, authLoading, isOnline]);

  // When redirected from company create with ?new=companyId, fetch that company so it shows without refresh
  const newCompanyId = searchParams.get("new");
  useEffect(() => {
    if (!newCompanyId || !user?.uid) return;
    const registryRows = allCompaniesRegistry?.length ? allCompaniesRegistry : contextCompanies || [];
    const alreadyInList = registryRows.some((c) => c.id === newCompanyId);
    if (alreadyInList) {
      setNewlyCreatedCompany(null);
      return;
    }
    let cancelled = false;
    // Local APK/static: naya company Firestore read ke bina local row se dikhao.
    if (isLocalOnlyMode()) {
      getLocalCompanyById(newCompanyId)
        .then((row) => {
          if (cancelled || !row) return;
          if (row.ownerId !== user?.uid) return;
          setNewlyCreatedCompany({ id: newCompanyId, ...row, isOwned: true } as Company);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    getDoc(doc(firestore, "companies", newCompanyId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        if (data?.ownerId !== user?.uid) return;
        setNewlyCreatedCompany({ id: snap.id, ...data, isOwned: true } as Company);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [newCompanyId, user?.uid, allCompaniesRegistry, contextCompanies]);

  const allCompanies = useMemo(() => {
    const shareUser = { uid: user?.uid || "", email: user?.email ?? null };
    const resolveOwned = (c: Company) =>
      user?.uid ? resolveCompanyIsOwnedForUser(c, shareUser) : Boolean(c.isOwned);

    const companyMap = new Map<string, Company>();
    const registryRows = allCompaniesRegistry?.length ? allCompaniesRegistry : contextCompanies || [];
    registryRows.forEach((c) => {
      if (!isCompanyVisibleInCompanyPage(c as Company)) return;
      companyMap.set(c.id, { ...(c as Company), isOwned: resolveOwned(c as Company) });
    });
    if (newlyCreatedCompany && !companyMap.has(newlyCreatedCompany.id)) {
      companyMap.set(newlyCreatedCompany.id, newlyCreatedCompany);
    }
    mergeDeviceLocalCompaniesIntoMap(companyMap, sqliteLocalRows, user);
    return filterPackedMyCompanyRows(
      filterSharedOnlyCompaniesForSuperAdminInMainApp(
        Array.from(companyMap.values()),
        user ? { uid: user.uid, email: user.email } : null,
        isSuperAdminUser,
        "/company"
      )
    );
}, [user, newlyCreatedCompany, allCompaniesRegistry, contextCompanies, isSuperAdminUser, sqliteLocalRows]);

  if (authLoading || companyContextLoading) {
    return (
        <div className="flex h-dvh max-h-dvh items-center justify-center overflow-hidden p-3">
            <Card className="flex h-[90dvh] max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden">
                <CardHeader>
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-full max-w-sm" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </CardContent>
            </Card>
        </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Signing out…</CardContent>
        </Card>
      </div>
    );
  }

  return <CompanySelector key={user.uid} companies={allCompanies} />;
}

function SelectCompanyPageLoading() {
  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SelectCompanyPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<SelectCompanyPageLoading />}>
      <SelectCompanyPageContent />
    </Suspense>
  );
}
