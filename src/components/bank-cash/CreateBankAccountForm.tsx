
"use client";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { MasterGroupTreeCombobox } from "@/components/entity/MasterGroupTreeCombobox";
import { BANK_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { useVouchers } from "@/hooks/useVouchers";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PlusCircle } from "lucide-react";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { collection, doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MasterOpeningBalanceAmountField } from "@/components/common/MasterOpeningBalanceAmountField";
import { BankAccountToggleFlagsRow } from "@/components/bank-cash/BankAccountToggleFlagsRow";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import type { AccountGroup } from "@/components/bank-cash/types";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { CreateAccountGroupDialog } from "./CreateAccountGroupDialog";
import {
  BANK_SYSTEM_BANK_BRANCH_ID,
  BANK_SYSTEM_CASH_BRANCH_ID,
  getDefaultSystemGroupId,
  normalizeBankGroupIdForStorage,
} from "@/lib/masterEntitySystemGroups";
import { resolveMasterGroupTreeBranchIdForGroup } from "@/lib/masterGroupTreeCombobox";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import {
  MasterFormNameAcNoRow,
  MasterFormTwoColGrid,
  MasterMobileNoField,
} from "@/components/inter-company/MasterFormLayout";
import { interCompanyAcNoForNewEntity } from "@/lib/interCompany/interCompanyAccountNo";

function createLocalEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

const formSchema = z.object({
  accountName: z.string().min(2, "Account name must be at least 2 characters."),
  aliasName: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.boolean().optional(),
  accountType: z.enum(["Bank", "Cash"], { message: "Account type is required." }),
  openingBalance: z.coerce.number().min(0),
  groupId: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  allowVoucherMinusBalance: z.boolean(),
  isClearing: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateBankAccountForm({ onAccountCreated, groups }: { onAccountCreated?: () => void, groups: AccountGroup[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const { processedAccountGroups } = useVouchers();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      accountName: "", aliasName: "",
      phone: "",
      accountType: "Bank",
      openingBalance: 0,
      bankName: "",
      accountNumber: "",
      ifscCode: "",
      allowVoucherMinusBalance: false,
      isClearing: false,
      // Default to system branch (Bank Accounts / Cash-in-Hand).
      groupId: getDefaultSystemGroupId("bank", { accountType: "Bank" }),
    },
  });

  const accountType = form.watch("accountType");

  async function onSubmit(values: FormValues): Promise<void> {
    if (!user || !companyId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in and have a company selected.",
      });
      return;
    }

    setIsLoading(true);
    try {
      if (apkEntityWriteUsesLocalSqliteMirror(company)) {
        // Local-only mode: save account in browser DB and queue cloud backup sync.
        const localId = createLocalEntityId("bank");
        const interCompanyAccountNo = await interCompanyAcNoForNewEntity("bank");
        const normalizedGroupId = normalizeBankGroupIdForStorage(values.groupId, values.accountType);
        const payload = {
          id: localId,
          ...values,
          phone: values.phone?.trim() || null,
          ownerId: user.uid,
          companyId,
          groupId: normalizedGroupId,
          balance: values.openingBalance,
          createdAt: new Date().toISOString(),
          isDeleted: false,
          interCompanyAccountNo,
        };
        await upsertCompanyDocInBrowserDb(companyId, "bank_accounts", localId, payload);
        await enqueueCompanyDocOutbox(companyId, "bank_accounts", "create", localId, payload);
        // Local save success toast keeps wording consistent across local-first forms.
        const showSyncHint = process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "1" && user.uid !== "local_guest_user";
        toast({
          title: showSyncHint ? "Saved. Will sync when online." : "Saved.",
          description: showSyncHint
            ? `"${values.accountName}" was saved locally and will sync when online.`
            : `"${values.accountName}" was saved locally.`,
        });
        form.reset({ accountName: "", aliasName: "", accountType: "Bank", openingBalance: 0, bankName: "", accountNumber: "", ifscCode: "", groupId: getDefaultSystemGroupId("bank", { accountType: "Bank" }) });
        onAccountCreated?.();
        return;
      }

      const normalizedGroupId = normalizeBankGroupIdForStorage(values.groupId, values.accountType);
      const bankRef = doc(collection(firestore, `companies/${companyId}/bank_accounts`));
      const interCompanyAccountNo = await interCompanyAcNoForNewEntity("bank");
      await setDoc(bankRef, {
        ...values,
        phone: values.phone?.trim() || null,
        ownerId: user.uid,
        companyId,
        groupId: normalizedGroupId,
        balance: values.openingBalance,
        createdAt: serverTimestamp(),
        isDeleted: false,
        interCompanyAccountNo,
      });
      
      toast({
        title: "Account Created!",
        description: `"${values.accountName}" has been successfully created.`,
      });
      
      // Keep default on system branch for next quick entry.
      form.reset({ accountName: "", aliasName: "", accountType: "Bank", openingBalance: 0, bankName: "", accountNumber: "", ifscCode: "", groupId: getDefaultSystemGroupId("bank", { accountType: "Bank" }) });
      if (onAccountCreated) {
        onAccountCreated();
      }

    } catch (error) {
      console.error("Error creating bank account:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create account. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
            <FormField
              control={form.control}
              name="accountType"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Account Type</FormLabel>
                  <RadioGroup
                    className="flex flex-col gap-2 sm:flex-row sm:gap-6"
                    value={field.value}
                    onValueChange={(next: "Bank" | "Cash") => {
                      field.onChange(next);
                      const currentBranch = resolveMasterGroupTreeBranchIdForGroup(
                        form.getValues("groupId"),
                        processedAccountGroups as AccountGroup[],
                        BANK_ENTITY_GROUP_PRESET
                      );
                      const expectedBranch =
                        next === "Cash" ? BANK_SYSTEM_CASH_BRANCH_ID : BANK_SYSTEM_BANK_BRANCH_ID;
                      if (currentBranch !== expectedBranch) {
                        form.setValue(
                          "groupId",
                          getDefaultSystemGroupId("bank", { accountType: next }),
                          { shouldDirty: true }
                        );
                      }
                    }}
                  >
                    <FormItem className="flex items-center space-x-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="Bank" />
                      </FormControl>
                      <FormLabel className="cursor-pointer font-normal">Bank Account</FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-2 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="Cash" />
                      </FormControl>
                      <FormLabel className="cursor-pointer font-normal">Cash in Hand</FormLabel>
                    </FormItem>
                  </RadioGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
            <MasterFormNameAcNoRow
              entityKind="bank"
              mode="create"
              nameField={
                <div className="space-y-2"><FormField
                  control={form.control}
                  name="accountName"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Primary Savings" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                /><FormField
                  control={form.control}
                  name="aliasName"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>Alias Name <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input placeholder="Other name on bills / short name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                /></div>
              }
            />
            <MasterMobileNoField control={form.control} />
            <MasterFormTwoColGrid>
              <FormField
              control={form.control}
              name="groupId"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Group (Optional)</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <MasterGroupTreeCombobox
                          preset={BANK_ENTITY_GROUP_PRESET}
                          groups={groups}
                          processedGroups={processedAccountGroups as AccountGroup[]}
                          popoverModal={false}
                          confirmWithOk
                          value={field.value}
                          onBranchChange={(branchId) => {
                            if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                              form.setValue("accountType", "Bank", { shouldDirty: true });
                            } else if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                              form.setValue("accountType", "Cash", { shouldDirty: true });
                            }
                          }}
                          onChange={(val) => {
                            const gid = val === "none" ? "" : val;
                            field.onChange(gid);
                            if (gid) {
                              const branchId = resolveMasterGroupTreeBranchIdForGroup(
                                gid,
                                processedAccountGroups as AccountGroup[],
                                BANK_ENTITY_GROUP_PRESET
                              );
                              if (branchId === BANK_SYSTEM_CASH_BRANCH_ID) {
                                form.setValue("accountType", "Cash", { shouldDirty: true });
                              } else if (branchId === BANK_SYSTEM_BANK_BRANCH_ID) {
                                form.setValue("accountType", "Bank", { shouldDirty: true });
                              }
                            }
                          }}
                          placeholder="Select or search a group"
                          searchPlaceholder="Search groups..."
                          addNewLabel="Create New Group"
                          disabled={isLoading}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsCreateGroupOpen(true)}
                      >
                        <PlusCircle className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {accountType === "Bank" ? (
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }: any) => (
                  <FormItem>
                    <FormLabel>Bank Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., State Bank of India" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div aria-hidden className="hidden sm:block" />
            )}
            </MasterFormTwoColGrid>

            <MasterFormTwoColGrid>
            <MasterOpeningBalanceAmountField control={form.control} />
            <div />
            </MasterFormTwoColGrid>

            {accountType === "Bank" && (
                <MasterFormTwoColGrid>
                    <FormField
                        control={form.control}
                        name="accountNumber"
                        render={({ field }: any) => (
                            <FormItem>
                                <FormLabel>Account Number</FormLabel>
                                <FormControl>
                                    <Input placeholder="Enter bank account number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="ifscCode"
                        render={({ field }: any) => (
                            <FormItem>
                                <FormLabel>IFSC Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="Enter IFSC code" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </MasterFormTwoColGrid>
            )}
            <BankAccountToggleFlagsRow control={form.control} />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading || !companyId}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Account
        </Button>
      </form>
    </Form>
    <CreateAccountGroupDialog onGroupCreated={() => setIsCreateGroupOpen(false)} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={groups} />
    </>
  );
}

    
