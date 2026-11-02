
"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/hooks/useCompany";
import type { Company as CompanyData } from "@/hooks/useCompany";
import { DEFAULT_PLANS, type PlanId } from "@/config/plans";
import { Input } from "../ui/input";
import { deleteCompanyComplete } from "@/lib/actions/deleteCompanyAction";
import { useAuth } from "@/hooks/useAuth";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { isDeviceLocalCompany } from "@/lib/companyStorageKind";
import {
  getPocketBaseCompanyDeleteMode,
  isDemoCompanyName,
  isPocketBaseRecycleCompany,
  permanentDeletePocketBaseCompany,
  type PbDeleteMode,
} from "@/lib/companyRecycleRoot";

export function DeleteCompanyDialog({
  company,
  onCompanyDeleted,
  children,
  isOpen,
  onOpenChange,
}: {
  company: CompanyData;
  onCompanyDeleted: () => void;
  children?: React.ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { clearCompanyId } = useCompany();
  const [confirmationText, setConfirmationText] = useState("");
  const { user } = useAuth(); // ✅ Get current user

  const allowRecycleBin = company.planId ? DEFAULT_PLANS[company.planId as PlanId].entitlements.allowCompanyAdminRecycleBin : false;

  // PocketBase company: the server's per-company Delete mode (Hard / Soft) decides what happens.
  const isPbCompanyShown = isPocketBaseRecycleCompany(company.id, company);
  const [pbMode, setPbMode] = useState<{ mode: PbDeleteMode; known: boolean } | null>(null);
  useEffect(() => {
    if (!isOpen || !isPbCompanyShown) {
      setPbMode(null);
      return;
    }
    let cancelled = false;
    setPbMode(null);
    void getPocketBaseCompanyDeleteMode(company.id, company.name).then((info) => {
      if (!cancelled) setPbMode({ mode: info.mode, known: info.known });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isPbCompanyShown, company.id, company.name]);

  const pbDescriptionText = !pbMode
    ? `Checking this company's Delete mode...`
    : pbMode.mode === "hard"
      ? `Delete mode: HARD. This will PERMANENTLY DELETE the company "${company.name}" and ALL its data on the server right now (vouchers, parties, items, uploaded files). This action cannot be undone.`
      : `Delete mode: SOFT. The company "${company.name}" will be hidden and its data stays on the server until the admin wipes it later. You will not see it in your Recycle Bin.${
          isDemoCompanyName(company.name) ? " (Demo Company is always Soft and is never hard-deleted.)" : pbMode.known ? "" : " (Delete mode could not be read from the server, so Soft is used.)"
        }`;

  const descriptionText = isPbCompanyShown
    ? pbDescriptionText
    : allowRecycleBin
    ? `This action will PERMANENTLY DELETE the company "${company.name}" and all associated data, including vouchers, parties, items, and uploaded files. This action cannot be undone.`
    : `You will not be able to see this company in your Recycle Bin. This company may be auto-deleted within a year.`;

  // ✅ Updated handleDelete to call the server action
  const handleDelete = async () => {
    if (!user) {
        toast({ variant: "destructive", title: "Authentication Error", description: "You are not logged in."});
        return;
    }
    setIsLoading(true);

    try {
      const localRow = await getLocalCompanyById(company.id, { includeDeleted: true });
      // PocketBase company (same markers as the company selector): never "local" -- delete it on PB.
      const isPbCompany =
        isPocketBaseRecycleCompany(company.id, company) ||
        isPocketBaseRecycleCompany(company.id, localRow as Parameters<typeof isPocketBaseRecycleCompany>[1]);
      if (isPbCompany) {
        const pbRes = await permanentDeletePocketBaseCompany(company.id, {
          quickDelete: true,
          userId: user.uid,
          companyName: company.name,
        });
        if (!pbRes.ok) throw new Error(("error" in pbRes ? pbRes.error : null) || "Permanent delete failed.");
        const pbHard = "mode" in pbRes && pbRes.mode === "hard";
        if (localRow && !pbHard) {
          await upsertLocalCompany({
            ...localRow,
            id: company.id,
            isDeleted: true,
            deletedAt: Date.now(),
            movedToAdminRecycleAt: Date.now(),
          } as Parameters<typeof upsertLocalCompany>[0]);
        }
        toast({
          title: pbHard ? "Company Permanently Deleted" : "Company Removed",
          description: pbHard
            ? `"${company.name}" and all its data were deleted from the server.`
            : `"${company.name}" was hidden. The admin can wipe its data later.`,
        });
        clearCompanyId();
        onCompanyDeleted();
        onOpenChange(false);
        return;
      }
      const isLocalCompany =
        isDeviceLocalCompany(company) ||
        isDeviceLocalCompany(localRow as Parameters<typeof isDeviceLocalCompany>[0]);
      if (isLocalCompany) {
        await upsertLocalCompany({
          ...(localRow || company),
          id: company.id,
          name: company.name,
          isDeleted: true,
          deletedAt: Date.now(),
          movedToAdminRecycleAt: null,
        } as Parameters<typeof upsertLocalCompany>[0]);
        toast({
          title: "Company Moved to Bin",
          description: `"${company.name}" has been moved to the recycle bin.`,
        });
        clearCompanyId();
        onCompanyDeleted();
        onOpenChange(false);
        return;
      }

      const result = await deleteCompanyComplete(company.id, user.uid);

      if (result.success) {
        toast({
          title: "Company Permanently Removed",
          description: `"${company.name}" and all its records have been deleted.`,
        });
        clearCompanyId();
        onCompanyDeleted(); // Refresh list
        onOpenChange(false);
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Deletion Failed",
        description: `An error occurred: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => {
        if (!open) setConfirmationText("");
        onOpenChange(open);
    }}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            {descriptionText} To confirm, please type the company name 
            <span className="font-bold text-foreground"> {company.name} </span> below.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input 
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder="Type company name to confirm"
        />
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isLoading || (isPbCompanyShown && !pbMode) || confirmationText.trim().toLowerCase() !== company.name.trim().toLowerCase()}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Permanently Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
