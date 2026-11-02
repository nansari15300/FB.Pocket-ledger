
"use client";

import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { CreateCompanyDialog } from "@/components/company/CreateCompanyDialog";
import { useCreateCompanyAvailability } from "@/hooks/useCreateCompanyAvailability";
import { Button } from "@/components/ui/button";
import { collection, query, where } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isLocalOnlyMode } from "@/lib/localMode";
import { embeddedClientUsesFirestoreCompanyList } from "@/lib/planSyncClientPolicy";
import { registerCompanyPickerFirestoreDetach } from "@/lib/companyPickerFirestoreDetach";
import { sharedCompanyQueryKey, sharedCompanyQuerySpecs } from "@/lib/sharedWithEmailsQuery";

function CreateCompanyPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
        <p className="mt-4 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function CreateCompanyPageContent() {
  const { user, loading: authLoading } = useAuth();
  const { availability: createCompanyAvailability, loading: createAvailabilityLoading } =
    useCreateCompanyAvailability();
  /** `loading`: registry hydrate — iske pehle khali list mat maanho; `companyId` orphan ho sakta hai (list 0 par bhi) → /company bounce loop. */
  const { setCompanyId, loading: companyContextLoading } = useCompany();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [checkingCompanies, setCheckingCompanies] = useState(true);
  /** Save success pe close redirect skip — dashboard par navigate ho chuka hota hai. */
  const skipCloseRedirectRef = useRef(false);
  /** Pehli hydrate ke baad `companyContextLoading` dubara flip par create dialog mat kholo. */
  const initialHydrateDoneRef = useRef(false);
  /** Save success ke baad loading spinner / dialog re-open band — dashboard par navigate ho chuka ho. */
  const createCompletedRef = useRef(false);

  /** Create-company precheck: hidden-tab/deleted companies ko active company-count me include mat karo. */
  const isVisibleCompanyRow = (row: { isDeleted?: unknown; movedToAdminRecycleAt?: unknown }) =>
    row.isDeleted !== true && row.movedToAdminRecycleAt == null;

  // Hydrate: /company/create par pehli baar loading ke baad create dialog kholo — `allCompanies` yahan dependency me nahi (re-open bug).
  useEffect(() => {
    if (createCompletedRef.current) return;

    if (isLocalOnlyMode()) {
      registerCompanyPickerFirestoreDetach(null);
      // Local-first: jab tak SQLite/registry load ho rahi ho wait karo.
      if (authLoading || companyContextLoading) {
        if (!initialHydrateDoneRef.current) setCheckingCompanies(true);
        return;
      }
      setCheckingCompanies(false);
      initialHydrateDoneRef.current = true;
      if (createCompanyAvailability.canCreateAny) {
        setIsDialogOpen(true);
      }
      return;
    }

    if (authLoading || !user || !user.email) {
      registerCompanyPickerFirestoreDetach(null);
      if (!authLoading && !user) {
        router.replace("/");
      }
      return;
    }

    if (!initialHydrateDoneRef.current) setCheckingCompanies(true);
    let settled = false;
    const setSettled = () => {
      if (settled || createCompletedRef.current) return;
      settled = true;
      setCheckingCompanies(false);
      initialHydrateDoneRef.current = true;
      if (createCompanyAvailability.canCreateAny) {
        setIsDialogOpen(true);
      }
    };

    const ownedQuery = query(collection(firestore, "companies"), where("ownerId", "==", user.uid));
    const sharedQuerySpecs = sharedCompanyQuerySpecs(user.email);

    let ownedCount = 0;
    let sharedCount = 0;
    let ownedDone = false;
    let sharedDone = sharedQuerySpecs.length === 0;
    const sharedSnapsByVariant = new Map<string, { docs: readonly { id: string; data: () => Record<string, unknown> }[] }>();
    const sharedVariantsReady = new Set<string>();
    const maybeDone = () => {
      if (!ownedDone || !sharedDone) return;
      setSettled();
    };
    const mergeSharedCount = () => {
      if (sharedVariantsReady.size < sharedQuerySpecs.length) return;
      const seen = new Set<string>();
      let count = 0;
      for (const snap of sharedSnapsByVariant.values()) {
        for (const doc of snap.docs) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          if (isVisibleCompanyRow(doc.data() as { isDeleted?: unknown; movedToAdminRecycleAt?: unknown })) {
            count += 1;
          }
        }
      }
      sharedCount = count;
      sharedDone = true;
      maybeDone();
    };

    const unsubOwned = onSnapshot(ownedQuery, (snapshot) => {
      ownedCount = snapshot.docs.filter((doc) => isVisibleCompanyRow(doc.data() as { isDeleted?: unknown; movedToAdminRecycleAt?: unknown })).length;
      ownedDone = true;
      maybeDone();
    }, () => {
      setSettled();
    });

    const unsubShared = sharedQuerySpecs.map((spec) =>
      onSnapshot(
        query(collection(firestore, "companies"), where(spec.field, "array-contains", spec.value)),
        (snapshot) => {
          const key = sharedCompanyQueryKey(spec);
          sharedSnapsByVariant.set(key, snapshot);
          sharedVariantsReady.add(key);
          mergeSharedCount();
        },
        () => {
          setSettled();
        }
      )
    );

    const timeoutId = setTimeout(() => setSettled(), 10000);

    const cleanupListeners = () => {
      unsubOwned();
      unsubShared.forEach((unsub) => unsub());
      clearTimeout(timeoutId);
    };
    registerCompanyPickerFirestoreDetach(cleanupListeners);

    return () => {
      registerCompanyPickerFirestoreDetach(null);
      cleanupListeners();
    };
  }, [user, authLoading, router, companyContextLoading, createCompanyAvailability.canCreateAny]);

  const explicitReturnTo = searchParams.get("returnTo")?.trim();

  const handleCompanyCreated = (companyId: string) => {
    createCompletedRef.current = true;
    skipCloseRedirectRef.current = true;
    setCompanyId(companyId);
    setIsDialogOpen(false);
    setCheckingCompanies(false);
    if (explicitReturnTo) {
      const path = explicitReturnTo.startsWith("/") ? explicitReturnTo : `/${explicitReturnTo}`;
      router.replace(path);
      return;
    }
    router.replace("/dashboard");
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setIsDialogOpen(true);
      return;
    }
    setIsDialogOpen(false);
    if (skipCloseRedirectRef.current) {
      skipCloseRedirectRef.current = false;
      return;
    }
    router.replace("/company");
  };

  // Show loading while checking companies
  if (checkingCompanies || authLoading || createAvailabilityLoading) {
    return <CreateCompanyPageLoading />;
  }

  if (!createCompanyAvailability.canCreateAny) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Company creation unavailable</h1>
          <p className="text-sm text-muted-foreground">
            {createCompanyAvailability.blockReason ||
              "You cannot create a company with your current plan and account settings."}
          </p>
          <Button type="button" variant="outline" onClick={() => router.replace("/company")}>
            Back to companies
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <CreateCompanyDialog
        isOpen={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        onCompanyCreated={handleCompanyCreated}
        redirectTo={null}
        isDismissable
      />
    </div>
  );
}

export default function CreateCompanyPage() {
  return (
    // Next.js requires Suspense boundary around useSearchParams() consumers for static prerender.
    <Suspense fallback={<CreateCompanyPageLoading />}>
      <CreateCompanyPageContent />
    </Suspense>
  );
}

    