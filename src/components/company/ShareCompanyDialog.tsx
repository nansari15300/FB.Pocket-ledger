

"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff } from "lucide-react";
import {
  doc,
  arrayUnion,
  query,
  collection,
  where,
  serverTimestamp,
  deleteField,
} from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { updateCompanyRootFirestore } from "@/lib/writeGateway/companyRootFirestore";
import { type PlanId } from "@/config/plans";
import { resolveAccountPlanIdForEntitlements } from "@/lib/accountPlanForOwner";
import {
  bucketForCompanyUserCap,
  collectAccountBucketShareMemberEmails,
  formatShareUserCapMessage,
  resolveCompanyShareUserCap,
  wouldBlockNewShareInvite,
} from "@/lib/accountShareUserCap";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "../ui/button";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Company as CompanyData } from "@/hooks/useCompany";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { isLocalOnlyMode } from "@/lib/localMode";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import {
  mergeSharedWithIntoLocalCompanyUsers,
  parseLocalCompanyUserRows,
} from "@/lib/localCompanyUsers";
import { COMPANY_SHARE_ROLE_OPTIONS } from "@/lib/localCompanyAppRoles";
import { pushAllLocalCompanyDocsToFirestore } from "@/lib/migrateLocalCompanySubcollectionsToFirestore";


const inviteRoles = ["viewer", "data-entry", "accountant", "editor", "manager", "admin"] as const;
const allShareRoles = [...inviteRoles, "owner"] as const;

const formSchema = z.object({
  name: z.string().min(2, { message: "Please enter a name for the user." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  role: z.enum(allShareRoles, { message: "Please select a role." }),
  password: z.string().optional(),
});

export function ShareCompanyDialog({ 
    company, 
    children, 
    isOpen: parentIsOpen, 
    onOpenChange: parentOnOpenChange,
    isEditing = false,
    userToEdit
}: { 
    company?: CompanyData, 
    children: React.ReactNode, 
    isOpen?: boolean, 
    onOpenChange?: (open: boolean) => void,
    isEditing?: boolean,
    userToEdit?: any 
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const livePlans = useLivePlans();
  const { reloadLocalCompanyRegistry, triggerSync, allCompanies, allCompaniesRegistry } = useCompany();
  const { user, customUser } = useAuth();

  const isOpen = parentIsOpen !== undefined ? parentIsOpen : internalIsOpen;
  const setOpen = parentOnOpenChange !== undefined ? parentOnOpenChange : setInternalIsOpen;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "manager",
      password: "",
    },
  });
  
  useEffect(() => {
    if (isOpen && isEditing && userToEdit) {
        form.reset({
            name: userToEdit.name,
            email: userToEdit.email,
            role: userToEdit.role,
            password: userToEdit.password || "",
        });
    } else if (isOpen && !isEditing) {
        form.reset({ name: "", email: "", role: "manager", password: "" });
    }
  }, [isOpen, isEditing, userToEdit, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!company) {
        toast({
            variant: "destructive",
            title: "Error",
            description: "No company is selected to share.",
        });
        return;
    }

    if (!isEditing) {
      if (values.role === "owner") {
        toast({
          variant: "destructive",
          title: "Invalid role",
          description: "Owner cannot be assigned through online share. Choose Manager or another role.",
        });
        return;
      }
    }

    setIsLoading(true);
    try {
        const companyRef = doc(firestore, "companies", company.id);
        const companySnap = await getDoc(companyRef);
        
        // Check if document exists in Firestore
        if (!companySnap.exists()) {
            toast({
                variant: "destructive",
                title: "Cannot Share",
                description: "This company hasn't synced to the server yet. Connect to the internet and wait for sync, then try again.",
            });
            return;
        }

        // Local / backup-restore company: ledgers SQLite me hain; invitee sirf Firestore subcollections padhta hai.
        // Purana `authoritativeCompanyId` (doosri company id) ho to galat path + 0 vouchers — align + push.
        if (String(company.storageOption || "").toLowerCase() === "local") {
          try {
            await updateCompanyRootFirestore(companyRef.id, { authoritativeCompanyId: deleteField() });
          } catch {
            /* ignore */
          }
          const { pushed, errors } = await pushAllLocalCompanyDocsToFirestore(company.id);
          if (pushed === 0) {
            toast({
              variant: "destructive",
              title: "No data to share online",
              description: "This company has no documents in this browser’s local cache to upload. Restore backup again or use “Upload to cloud” first.",
            });
            return;
          }
          if (errors.length) {
            toast({
              title: "Partial cloud upload",
              description: `Uploaded ${pushed} document(s); some batches failed: ${errors.slice(0, 2).join(" · ")}. Sharing continues — invitee should re-open company after sync.`,
            });
          }
        }

        const currentData = companySnap.data();
        const currentSharedWith = (currentData?.sharedWith || []) as any[];
        const emailNorm = values.email.toLowerCase().trim();
        const existingIdx = !isEditing
          ? currentSharedWith.findIndex(
              (u: any) => String(u?.email || "").toLowerCase().trim() === emailNorm
            )
          : -1;

        if (isEditing) {
            const updatedSharedWith = currentSharedWith.map((u: any) =>
                u.email === values.email
                  ? {
                      ...u,
                      name: values.name,
                      role: values.role,
                      password: values.password?.trim() ? values.password : (u.password ?? null),
                    }
                  : u
            );
             await updateCompanyRootFirestore(companyRef.id, { sharedWith: updatedSharedWith, updatedAt: serverTimestamp() });
             toast({ title: "User updated", description: `Details for ${values.email} have been updated.` });

        } else if (existingIdx >= 0) {
            const existing = currentSharedWith[existingIdx];
            const nextPassword = values.password?.trim()
              ? values.password
              : (existing.password != null && existing.password !== "" ? existing.password : null);
            let sharedUid: string | null = existing.uid ?? null;
            if (!sharedUid) {
              try {
                const userSnap = await getDocs(query(collection(firestore, "users"), where("email", "==", values.email)));
                const first = userSnap.docs[0];
                const data = first?.data();
                sharedUid = (data?.uid as string) || first?.id || null;
              } catch {
                /* optional */
              }
            }
            const updatedSharedWith = [...currentSharedWith];
            updatedSharedWith[existingIdx] = {
              ...existing,
              name: values.name,
              email: existing.email || values.email,
              uid: sharedUid,
              role: values.role,
              password: nextPassword,
            };
            await updateCompanyRootFirestore(companyRef.id, {
              sharedWith: updatedSharedWith,
              updatedAt: serverTimestamp(),
            });
            toast({
              title: "Share updated",
              description: `Updated ${values.email} — name, role, or password saved.`,
            });
        } else {
            if (!String(values.password || "").trim()) {
              toast({
                variant: "destructive",
                title: "Password required",
                description: "Set a password for a new invite. If this person is already shared, use the same email to update without a new password.",
              });
              setIsLoading(false);
              return;
            }

            // Account-wide bucket cap: all online companies share maxUsers; all local share maxUsersLocal.
            const ownerUid = String(currentData?.ownerId || company.ownerId || user?.uid || "").trim();
            const ownerUserSnap = ownerUid
              ? await getDoc(doc(firestore, "users", ownerUid))
              : null;
            const ownerUserData = ownerUserSnap?.exists()
              ? (ownerUserSnap.data() as Record<string, unknown>)
              : null;
            const accountPlanId = resolveAccountPlanIdForEntitlements(
              ownerUserData,
              allCompanies,
              ownerUid,
              company.planId,
              customUser?.accountCanonicalPlanId
            ) as PlanId;
            const plan = getPlanFromPlans(livePlans, accountPlanId);
            const capCompany = {
              storageOption: currentData?.storageOption ?? company.storageOption,
              syncedFromCloud:
                currentData?.syncedFromCloud ?? (company as { syncedFromCloud?: boolean }).syncedFromCloud,
            };
            const maxUsers = resolveCompanyShareUserCap(plan, capCompany, ownerUserData);
            const bucket = bucketForCompanyUserCap(capCompany);
            const ownedSnap = ownerUid
              ? await getDocs(query(collection(firestore, "companies"), where("ownerId", "==", ownerUid)))
              : null;
            const ownedRows = (ownedSnap?.docs ?? []).map((row) => {
              const data = row.data() as {
                sharedWithEmails?: unknown;
                ownerEmail?: unknown;
                storageOption?: string | null;
                syncedFromCloud?: boolean;
              };
              return data;
            });
            const localRegistry = allCompaniesRegistry?.length ? allCompaniesRegistry : allCompanies;
            const memberEmails = collectAccountBucketShareMemberEmails({
              ownerEmail: String(currentData?.ownerEmail || company.ownerEmail || ""),
              ownerUid,
              bucket,
              firestoreOwnedCompanyRows: ownedRows,
              localRegistryRows: localRegistry ?? [],
            });
            if (
              wouldBlockNewShareInvite({
                memberEmails,
                inviteEmail: values.email,
                maxUsers,
              })
            ) {
                toast({
                    variant: "destructive",
                    title: "Plan limit reached",
                    description: formatShareUserCapMessage(maxUsers),
                });
                setIsLoading(false);
                return;
            }

            let sharedUid: string | null = null;
            try {
              const userSnap = await getDocs(query(collection(firestore, "users"), where("email", "==", values.email)));
              const first = userSnap.docs[0];
              const data = first?.data();
              sharedUid = (data?.uid as string) || first?.id || null;
            } catch {
              // keep optional; sharing should not fail if uid lookup is unavailable
            }
            const sharedEmailLower = String(values.email || "").trim().toLowerCase();
            await updateCompanyRootFirestore(companyRef.id, {
                sharedWith: arrayUnion({ name: values.name, email: values.email, uid: sharedUid, role: values.role, password: values.password || null }),
                sharedWithEmails: arrayUnion(sharedEmailLower),
                sharedWithEmailsLower: arrayUnion(sharedEmailLower),
                updatedAt: serverTimestamp(),
            });
            toast({
                title: "Company shared!",
                description: `"${company.name}" has been shared with ${values.email} as a(n) ${values.role}.`,
            });
        }

        const freshSnap = await getDoc(companyRef);
        if (freshSnap.exists() && isLocalOnlyMode()) {
          const sw = (freshSnap.data()?.sharedWith || []) as any[];
          const existingRow = await getLocalCompanyById(company.id, { includeDeleted: true });
          if (existingRow) {
            const prev = parseLocalCompanyUserRows(existingRow.localCompanyUsers);
            const merged = mergeSharedWithIntoLocalCompanyUsers(prev, sw);
            await upsertLocalCompany({
              ...(existingRow as any),
              localCompanyUsers: merged,
              updatedAt: Date.now(),
            } as any);
          }
        }

        form.reset();
        setOpen(false);
        reloadLocalCompanyRegistry();
        triggerSync();
    } catch (error: any) {
        console.error("Error sharing/updating company: ", error);
        const errorMessage = error?.message || "An error occurred. Please try again.";
        const isNotFoundError = error?.code === "not-found" || errorMessage.includes("No document to update");
        
        toast({
            variant: "destructive",
            title: isEditing ? "Update Failed" : "Sharing Failed",
            description: isNotFoundError 
                ? "This company hasn't synced to the server yet. Connect to the internet and wait for sync, then try again."
                : errorMessage,
        });
    } finally {
        setIsLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[480px] p-4">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Edit user: ${userToEdit?.name}` : `Online share — ${company?.name ?? "company"}`}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this person’s details. Email cannot be changed here."
              : "Invite by email. Login username matches the display name. Role and password apply in Manage Sharing / company access."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Company user name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Sales User" {...field} className="h-9 text-sm px-3 rounded-md"/>
                    </FormControl>
                    <FormDescription>Shown to the invited user; login id is kept the same.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Share online — login username</FormLabel>
                <FormControl>
                  <Input
                    readOnly
                    disabled
                    className="h-9 text-sm px-3 rounded-md bg-muted cursor-not-allowed"
                    value={form.watch("name") || ""}
                    placeholder="Same as company user name"
                  />
                </FormControl>
                <FormDescription>Automatically matches company user name.</FormDescription>
              </FormItem>
              <FormField
                control={form.control}
                name="email"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Email (online share)</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="name@example.com"
                        {...field}
                        disabled={isEditing}
                        className="h-9 text-sm px-3 rounded-md"
                      />
                    </FormControl>
                    <FormDescription>They must sign in with this email to open the company.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-9 text-sm px-3 rounded-md">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COMPANY_SHARE_ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                        {isEditing && userToEdit?.role === "owner" ? (
                          <SelectItem value="owner">Owner</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="password"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Company Password For shared user</FormLabel>
                    <div className="relative">
                        <FormControl>
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder={isEditing ? "Update password (optional)" : "Required for new invite"}
                            {...field}
                            className="h-9 text-sm px-3 rounded-md"
                          />
                        </FormControl>
                        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                    </div>
                    <FormDescription>
                      {isEditing
                        ? "Company access password for this user (not their email/Google password). Leave blank to keep the current one."
                        : "Company access password for this shared user (not their email/Google password). Required for a brand-new email. If that email is already shared, leave blank to keep their current password or enter a new one."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            <DialogFooter className="pt-4">
              <DialogClose asChild>
                <Button type="button" variant="ghost" className="h-9 text-sm px-4 rounded-md">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isLoading} className="h-9 text-sm px-4 rounded-md">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save changes" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    