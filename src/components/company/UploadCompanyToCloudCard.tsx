"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { doc, serverTimestamp, deleteField } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { promoteLocalCompanyRowToOnline } from "@/lib/localCompanyStore";
import { canUploadOneMoreOnline } from "@/lib/companyOnlineSlots";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { isLocalOnlyMode } from "@/lib/localMode";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { pushAllLocalCompanyDocsToFirestore } from "@/lib/migrateLocalCompanySubcollectionsToFirestore";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { removeLocalCompanyDeltaFromFolder } from "@/lib/liveDataFolderMirror";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";
import { isPocketBaseLoginActive } from "@/lib/makeLocalCompanyOnlinePocketBase";

/** Manual push of company root + local SQLite subcollections to Firestore (plan online slots). */
export function UploadCompanyToCloudCard() {
  const { company, companyId, allCompanies, triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();
  const livePlans = useLivePlans();
  const [loading, setLoading] = useState(false);

  const isOwner =
    !!company &&
    !!user &&
    (company.ownerId === user.uid ||
      (!!company.ownerEmail && !!user.email && company.ownerEmail.toLowerCase() === user.email.toLowerCase()));

  const isLocal =
    !!company && String(company.storageOption || "local").toLowerCase() === "local";

  const accountPlanId = resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId);
  const accountPlanLive = getPlanFromPlans(livePlans, accountPlanId);
  const { ok, max, current } = canUploadOneMoreOnline(
    allCompanies,
    accountPlanId,
    companyId || "",
    user?.uid ?? null,
    accountPlanLive
  );

  if (!company || !companyId || !isOwner) return null;

  // Pocket Ledger Server login: this card pushes to Firestore - use "Make online on PocketBase" instead.
  if (isPocketBaseLoginActive(user)) return null;

  // Online repair card hamesha hide — Force upload button docs + files handle karta hai.
  if (!isLocal) {
    return null;
  }

  const handleUpload = async () => {
    if (!user?.uid || !companyId) return;
    if (!ok) {
      toast({
        variant: "destructive",
        title: "Online slots full",
        description: `Your plan allows ${max} online compan${max === 1 ? "y" : "ies"}. Upgrade or make another company local-only.`,
      });
      return;
    }
    setLoading(true);
    try {
      await setDoc(
        doc(firestore, "companies", companyId),
        {
          name: company.name,
          address: company.address ?? "",
          phone: company.phone ?? "",
          email: company.email ?? "",
          pan: company.pan ?? "",
          country: company.country ?? "",
          logoUrl: company.logoUrl ?? null,
          ownerId: user.uid,
          ownerEmail: user.email ?? "",
          storageOption: "firebase",
          syncPolicy: "online",
          syncedFromCloud: false,
          demotedFromOnlineAt: deleteField(),
          demoteReason: deleteField(),
          planId: company.planId ?? "basic",
          sharedWith: company.sharedWith ?? [],
          sharedWithEmails: company.sharedWithEmails ?? (user.email ? [user.email] : []),
          updatedAt: serverTimestamp(),
          ...pocketLedgerStorageDocFields(companyId),
        },
        { merge: true }
      );
      const rest = { ...(company as Record<string, unknown>) };
      delete rest.demoteReason;
      delete rest.demotedFromOnlineAt;
      // Move SQLite folder local → online, then stamp cloud root (do not use upsertLocalCompany — it re-stamps local).
      await promoteLocalCompanyRowToOnline(companyId, {
        ...rest,
        id: companyId,
        storageOption: "firebase",
        syncPolicy: "online",
        syncedFromCloud: false,
        ...pocketLedgerStorageDocFields(companyId),
      } as Parameters<typeof promoteLocalCompanyRowToOnline>[1]);
      // Local SQLite me jo vouchers/parties pade hain — Firestore subcollections me bhi bhejo (sirf root pe pehle data nahi dikhta tha).
      const { pushed, errors } = await pushAllLocalCompanyDocsToFirestore(companyId);
      // Static build: company list + cloud mirror; online: listener bump.
      reloadLocalCompanyRegistry();
      triggerSync();
      void removeLocalCompanyDeltaFromFolder(companyId).catch(() => undefined);
      toast({
        title: "Uploaded",
        description:
          errors.length > 0
            ? `Saved ${pushed} document(s) to cloud. Some batches failed: ${errors.slice(0, 2).join(" · ")}`
            : pushed > 0
              ? `Company linked to cloud and ${pushed} local document(s) uploaded.`
              : "Company linked to cloud. No extra local cache rows found (new company or empty cache).",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Check your network connection and permissions.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CloudUpload className="h-5 w-5" />
          Upload this company to cloud
        </CardTitle>
        <CardDescription>
          Link this local company to Firestore (plan: <strong>{max}</strong> online slot
          {max === 1 ? "" : "s"}, currently using <strong>{current}</strong>
          {isLocalOnlyMode() ? " — in static/local APK builds this still requires an available network." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={loading || !ok || max === 0} onClick={() => void handleUpload()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
          <span className="ml-2">Upload now</span>
        </Button>
        {max === 0 && (
          <p className="text-sm text-muted-foreground">
            On Basic, only local companies are included.{" "}
            <Link href="/billing" className="font-medium text-primary underline">
              Plan upgrade
            </Link>
          </p>
        )}
        {max > 0 && !ok && (
          <p className="text-sm text-muted-foreground">
            Online slots are full. <Link href="/billing" className="underline">Upgrade</Link> or set another company to local-only first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
