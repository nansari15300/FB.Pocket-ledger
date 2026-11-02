
"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { HandoverManager } from "./HandoverManager";
import { Button } from "../ui/button";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Trash2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { softDeleteCompanyToRecycleBin } from "@/lib/companyRecycleRoot";
import { isCompanyNotFoundError, COMPANY_NOT_SYNCED_MESSAGE } from "@/lib/companyUpdateGuard";
import type { Company } from "@/hooks/useCompany";
import { sendRecycleBinMovedAlert } from "@/lib/transactionAlerts";
import {
  partitionCompaniesForSelector,
  buildDuplicateNameCountMap,
  companySelectOptionLabel,
  mergeOwnedCompaniesForUser,
} from "@/lib/companyStorageKind";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";

function normalizeCompanyConfirmName(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function DangerZone() {
  const { user, customUser } = useAuth();
  const { company, companyId, allCompanies, allCompaniesRegistry, clearCompanyId, reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCompanyToDeleteId, setSelectedCompanyToDeleteId] = useState<string>("");

  const ownedCompanies = useMemo(() => {
    const shareUser = { uid: user?.uid || "", email: user?.email ?? null };
    return mergeOwnedCompaniesForUser(
      [allCompaniesRegistry || [], allCompanies || []],
      user?.uid ? shareUser : null,
      (c, u) => {
        if (resolveCompanyIsOwnedForUser(c, u)) return true;
        if (customUser?.role === "SuperAdmin" && c.ownerEmail && u.email) {
          return c.ownerEmail.toLowerCase().trim() === u.email.toLowerCase().trim();
        }
        return false;
      }
    );
  }, [allCompanies, allCompaniesRegistry, user?.uid, user?.email, customUser?.role]);

  const companyToDelete = useMemo(
    () => ownedCompanies.find((c) => c.id === selectedCompanyToDeleteId),
    [ownedCompanies, selectedCompanyToDeleteId]
  );

  // Same source of truth as the company selector (partitionCompaniesForSelector):
  // Local / PL Server / PocketBase / Firebase (legacy) -- no separate "is local" guess here.
  const { localCompaniesToDelete, serverCompaniesToDelete, pocketbaseCompaniesToDelete, onlineCompaniesToDelete } =
    useMemo(() => {
      const buckets = partitionCompaniesForSelector(ownedCompanies);
      return {
        localCompaniesToDelete: buckets.localOwnedCompanies,
        serverCompaniesToDelete: buckets.serverSharedCompanies,
        pocketbaseCompaniesToDelete: buckets.pocketbaseTabCompanies,
        onlineCompaniesToDelete: buckets.cloudOwnedCompanies,
      };
    }, [ownedCompanies]);

  // Company whose books are on the server: hint "online" (PB root); everything else in the Local group is local.
  const storageHintForCompany = (c: Company | undefined | null): "local" | "online" | undefined => {
    if (!c) return undefined;
    if (localCompaniesToDelete.some((x) => x.id === c.id)) return "local";
    if (
      pocketbaseCompaniesToDelete.some((x) => x.id === c.id) ||
      onlineCompaniesToDelete.some((x) => x.id === c.id)
    ) {
      return "online";
    }
    return undefined;
  };

  const duplicateNameCountMap = useMemo(() => buildDuplicateNameCountMap(ownedCompanies), [ownedCompanies]);

  const handleDelete = async () => {
    const targetId = selectedCompanyToDeleteId || companyId;
    if (!targetId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Select a company to delete.",
      });
      return;
    }
    const targetCompany = companyToDelete ?? company;
    const targetName = companyToDelete?.name ?? company?.name;
    setIsLoading(true);
    try {
      const moved = await softDeleteCompanyToRecycleBin(targetId, {
        companyStorageSource: storageHintForCompany(targetCompany),
      });
      if (!moved.ok) {
        throw new Error(("error" in moved ? moved.error : null) || "Failed to move company to bin.");
      }
      toast({
        title: "Company Moved to Bin",
        description: `"${targetName}" has been moved to the recycle bin.`,
      });
      void sendRecycleBinMovedAlert(targetId, targetCompany ?? null, {
        entityKind: "company",
        entityId: targetId,
        entityName: String(targetName || "Company"),
        performedByUserId: user?.uid,
        performedByEmail: user?.email ?? undefined,
        performedByName: user?.displayName ?? customUser?.displayName ?? undefined,
      });
      if (companyId === targetId) clearCompanyId();
      setSelectedCompanyToDeleteId("");
      reloadLocalCompanyRegistry();
      triggerSync();
    } catch (error) {
      console.error("Error moving to bin:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: isCompanyNotFoundError(error)
          ? COMPANY_NOT_SYNCED_MESSAGE
          : error instanceof Error && error.message
            ? `Failed to move company to bin: ${error.message}`
            : "Failed to move company to bin.",
      });
    } finally {
      setIsLoading(false);
      setIsDeleteDialogOpen(false);
      setDeleteConfirmationText("");
    }
  };

  const BADGE_CLASS = {
    emerald:
      "rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-400",
    amber:
      "rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400",
    sky: "rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] font-medium text-sky-800 dark:text-sky-300",
  } as const;

  const renderGroup = (
    label: string,
    list: Company[],
    badge: string,
    tone: keyof typeof BADGE_CLASS
  ) =>
    list.length > 0 ? (
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold text-muted-foreground">{label}</SelectLabel>
        {list.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-2">
              <span className={BADGE_CLASS[tone]}>{badge}</span>
              <span className="truncate">{companySelectOptionLabel(c, duplicateNameCountMap)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectGroup>
    ) : null;

  return (
    <div className="space-y-8">
      <HandoverManager />

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Delete Company</CardTitle>
          <CardDescription>
            This action will move the company to the recycle bin. You can restore it later from there. This action cannot be undone immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select company to delete</Label>
            <Select
              value={selectedCompanyToDeleteId || undefined}
              onValueChange={setSelectedCompanyToDeleteId}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Choose company to delete..." />
              </SelectTrigger>
              <SelectContent>
                {renderGroup("Local", localCompaniesToDelete, "Local", "emerald")}
                {renderGroup("PL Server", serverCompaniesToDelete, "PL Server", "amber")}
                {renderGroup("PocketBase (online)", pocketbaseCompaniesToDelete, "PocketBase", "sky")}
                {renderGroup("Firebase (legacy)", onlineCompaniesToDelete, "Firebase", "sky")}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardFooter>
          <AlertDialog
            open={isDeleteDialogOpen}
            onOpenChange={(open) => {
              setIsDeleteDialogOpen(open);
              if (!open) setDeleteConfirmationText("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={ownedCompanies.length === 0 || !selectedCompanyToDeleteId}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Move Company to Recycle Bin
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will move the company &quot;{companyToDelete?.name ?? "selected"}&quot; to the recycle
                  bin. To confirm, please type the company name below.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="Type company name to confirm"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDelete();
                  }}
                  disabled={
                    isLoading ||
                    normalizeCompanyConfirmName(deleteConfirmationText) !==
                      normalizeCompanyConfirmName(companyToDelete?.name)
                  }
                  className="bg-destructive hover:bg-destructive/90"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Move to Bin
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  );
}
