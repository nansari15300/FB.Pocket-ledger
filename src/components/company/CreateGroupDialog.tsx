
"use client";

import { addDoc } from "@/lib/writeGateway/pbWrites";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PlusCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { collection, serverTimestamp } from "@/lib/pbCompat/firestore";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { BTN_SAVE_NEW_CLASS } from "@/components/vouchers/voucherButtonStyles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import type { Group } from "@/components/party/types";
import { resolveRecycleBinDuplicate } from "@/lib/recycleBinDuplicate";

const formSchema = z.object({
  name: z.string().min(2, { message: "Group name must be at least 2 characters." }),
  parentId: z.string().optional(),
});

const systemGroups = [
    "Sundry Creditors",
    "Sundry Debtors",
    "Bank Accounts",
    "Capital Account",
    "Loans & Liabilities",
    "Duties & Taxes",
    "Cash-in-hand"
];


export function CreateGroupDialog({ onGroupCreated, children, groups = [], isOpen: parentIsOpen, onOpenChange: parentOnOpenChange }: { 
    onGroupCreated: (groupId: string) => void, 
    children?: React.ReactNode, 
    groups: Group[],
    isOpen?: boolean, 
    onOpenChange?: (open: boolean) => void 
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId } = useCompany();

  const isOpen = parentIsOpen !== undefined ? parentIsOpen : internalIsOpen;
  const setOpen = parentOnOpenChange !== undefined ? parentOnOpenChange : setInternalIsOpen;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      parentId: "main",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>, saveAndNew: boolean = false) {
    if (!user) {
        toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in." });
        return;
    }
     if (!companyId) {
        toast({ variant: "destructive", title: "Company Not Selected", description: "Please select a company first." });
        return;
    }
    setIsLoading(true);
    try {
      const trimmedName = values.name.trim();
      // Recycle-bin duplicate flow: restore or create-new on user choice.
      const duplicateDecision = await resolveRecycleBinDuplicate({
        companyId,
        collectionName: "groups",
        name: trimmedName,
        entityLabel: "Group",
      });
      if (duplicateDecision.decision === "active_exists") {
        toast({
          variant: "destructive",
          title: "Duplicate Group Name",
          description: "A group with this name already exists. Please choose a different name.",
        });
        setIsLoading(false);
        return;
      }
      if (duplicateDecision.decision === "restored" && duplicateDecision.restoredId) {
        toast({
          title: "Group Restored!",
          description: `"${trimmedName}" was restored from Recycle Bin.`,
        });
        onGroupCreated(duplicateDecision.restoredId);
        if (saveAndNew) {
          form.reset({ name: "", parentId: "main" });
        } else {
          form.reset({ name: "", parentId: "main" });
          if (parentOnOpenChange) parentOnOpenChange(false);
        }
        setIsLoading(false);
        return;
      }

      const payload = {
        name: values.name.trim(),
        ownerId: user.uid,
        companyId: companyId,
        parentId: values.parentId === "main" ? null : values.parentId,
        createdAt: serverTimestamp(),
      };
      const collRef = collection(firestore, `companies/${companyId}/groups`);

      const docRef = await addDoc(collRef, payload);
      toast({ title: "Group Created!", description: `"${values.name}" has been successfully created.` });
      onGroupCreated(docRef.id);
      if (saveAndNew) {
        form.reset({ name: "", parentId: "main" });
      } else {
        form.reset({ name: "", parentId: "main" });
        if (parentOnOpenChange) parentOnOpenChange(false);
      }
    } catch (error) {
      console.error("Error creating group:", error);
      toast({ variant: "destructive", title: "Error Creating Group", description: "Group details could not be saved. Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-md p-4">
        <DialogHeader>
          <DialogTitle>Create a New Group</DialogTitle>
          <DialogDescription>Add a new group to categorize your parties.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => onSubmit(data, false))} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Group Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Sundry Debtors" {...field} className="h-9 text-sm px-3 rounded-md" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Main Group (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a parent group" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="main">None (It's a main group)</SelectItem>
                      <SelectGroup>
                        <SelectLabel>System Groups</SelectLabel>
                        {systemGroups.map((groupName) => (
                            <SelectItem key={groupName} value={groupName}>
                                {groupName}
                            </SelectItem>
                        ))}
                      </SelectGroup>
                      {groups.filter(g => g.id).length > 0 && (
                        <SelectGroup>
                            <SelectLabel>Your Groups</SelectLabel>
                             {groups.filter(g => g.id).map((group) => (
                                <SelectItem key={group.id} value={group.id}>
                                {group.name}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}>Cancel</Button>
                </DialogClose>
                <div className="flex min-w-0 flex-1 justify-center px-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(BTN_SAVE_NEW_CLASS, "shrink-0 px-4")}
                    onClick={form.handleSubmit(data => onSubmit(data, true))}
                    disabled={isLoading}
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save & New
                  </Button>
                </div>
                <Button type="submit" disabled={isLoading || !companyId} className="shrink-0">
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Group
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
