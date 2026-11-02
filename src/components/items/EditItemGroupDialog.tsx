
"use client";

import { DialogPlainOpener } from "@/components/ui/dialog-plain-opener";
import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { NESTED_LEDGER_MASTER_EDIT_CONTENT_CN, NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN } from "@/lib/nestedLedgerMasterEditPresentation";
import { Loader2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { doc } from "@/lib/pbCompat/firestore";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { MasterDeleteConfirmAlertDialog } from "@/components/common/MasterDeleteConfirmAlertDialog";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/firebase";
import type { ItemGroup } from "@/components/items/types";
import { useCompany } from "@/hooks/useCompany";
import { useNavigatorOnline } from "@/hooks/useNavigatorOnline";
import { apkCloudCompanyOfflineViewOnly } from "@/lib/apkOnlineFirestoreWritePolicy";
import { MasterEntityGroupDeleteIconButton } from "@/components/entity/MasterEntityGroupDeleteControls";
import {
  permanentDeleteCompanySubdocFromRecycleBin,
  softDeleteCompanySubdocToRecycleBin,
} from "@/lib/recycleBinEntityLifecycle";
import { cn } from "@/lib/utils";
import {
  MASTER_ALERT_DIALOG_CANCEL_GRAY_CLASS,
  MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS,
  MASTER_DIALOG_FOOTER_ROW_CLASS,
} from "@/lib/masterDialogFooterStyles";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cnStaticMobileFullscreenDialog } from "@/lib/staticMobileFullscreenDialog";
import { toast as sonnerToast } from "sonner";
import { MasterEntityNestedGroupFields } from "@/components/entity/MasterEntityNestedGroupFields";
import {
  decodeMasterEntityGroupParentPath,
  resolveMasterEntityGroupParentIdFromPath,
  resolveMasterEntityGroupEditAddNewTarget,
  applyMasterEntityGroupEditAddNewGroupId,
} from "@/lib/masterEntityGroupTreeForm";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { createOneMasterEntityGroup } from "@/lib/masterEntityGroupWrite";
import { isSystemGroupName } from "@/lib/system-group-names";

export function EditItemGroupDialog({
  group, isOpen: controlledIsOpen, onOpenChange: controlledOnOpenChange,
  allGroups,
  onGroupUpdated,
  onGroupDeleted,
  children,
  hasAccounts,
}: {
  group: ItemGroup;
  allGroups: ItemGroup[];
  onGroupUpdated: () => void;
  onGroupDeleted: () => void;
  children?: React.ReactNode;
  /** External open (e.g. combobox pencil): controlled + nested above voucher dialog. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  hasAccounts?: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const externallyControlled = controlledIsOpen !== undefined;
  const isOpen = externallyControlled ? !!controlledIsOpen : internalIsOpen;
  const setIsOpen = (o: boolean) => {
    if (!externallyControlled) setInternalIsOpen(o);
    controlledOnOpenChange?.(o);
  };
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [systemBranch, setSystemBranch] = useState(ITEM_ENTITY_GROUP_PRESET.defaultBranch);
  const [parentPathIds, setParentPathIds] = useState<string[]>([]);
  const [childPathIds, setChildPathIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [aliasName, setAliasName] = useState("");
  const formResetKey = isOpen ? `edit-${group.id}` : "edit-closed";
  const { toast } = useToast();
  const { user } = useAuth();
  const { companyId, company } = useCompany();
  const isMobile = useIsMobile();
  const navigatorOnline = useNavigatorOnline();
  const apkOfflineViewOnly = useMemo(
    () => apkCloudCompanyOfflineViewOnly(company, navigatorOnline),
    [company, navigatorOnline]
  );
  const liveGroup = useMemo(
    () => allGroups.find((g) => g.id === group.id) || group,
    [allGroups, group]
  );
  const isSystemGroup = Boolean((group as { isSystemReserved?: boolean }).isSystemReserved);
  const hasDirectChildGroups = useMemo(
    () => allGroups.some((g) => g?.id && g.id !== group.id && String(g.parentId || "").trim() === group.id),
    [allGroups, group.id]
  );
  const canDeleteGroup =
    !isSystemGroup && !hasAccounts && !hasDirectChildGroups && !apkOfflineViewOnly;

  useEffect(() => {
    if (isOpen) {
      const decoded = decodeMasterEntityGroupParentPath(
        liveGroup,
        allGroups,
        ITEM_ENTITY_GROUP_PRESET.config
      );
      setGroupName(liveGroup.name || "");
      setAliasName(String((liveGroup as { aliasName?: string }).aliasName ?? ""));
      setSystemBranch(decoded.systemBranch);
      setParentPathIds(decoded.parentPathIds);
      setChildPathIds([]);
    }
  }, [isOpen, liveGroup, allGroups]);

  const handleAddNewParentAtLevel = useCallback(
    async (levelIndex: number, name: string) => {
      if (!user || !companyId || !name.trim()) return;
      if (isSystemGroupName("item", name.trim())) {
        toast({
          variant: "destructive",
          title: "System Group Name",
          description: `"${name}" is a system group name.`,
        });
        return;
      }
      const target = resolveMasterEntityGroupEditAddNewTarget(levelIndex, {
        ancestorCount: parentPathIds.length,
        systemBranch,
        parentPathIds,
        childPathIds,
        editingGroupId: group.id,
      });
      try {
        const newId = await createOneMasterEntityGroup({
          company,
          companyId,
          userId: user.uid,
          name: name.trim(),
          parentId: target.parentId,
          collection: ITEM_ENTITY_GROUP_PRESET.collection,
          localIdPrefix: ITEM_ENTITY_GROUP_PRESET.localIdPrefix,
        });
        const next = applyMasterEntityGroupEditAddNewGroupId(
          target,
          newId,
          parentPathIds,
          childPathIds
        );
        setParentPathIds(next.parentPathIds);
        setChildPathIds(next.childPathIds);
        toast({ title: "Group added", description: `"${name.trim()}" parent list me add ho gaya.` });
      } catch (error) {
        console.error("Error creating parent group:", error);
        toast({ variant: "destructive", title: "Error", description: "Parent group create nahi ho saka." });
      }
    },
    [user, companyId, company, group.id, childPathIds, parentPathIds, systemBranch, toast]
  );

  function handleSubmit(): void {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      return;
    }

    const editedName = groupName.trim();
    if (editedName.length < 2) {
      toast({
        variant: "destructive",
        title: "Invalid name",
        description: "Group name must be at least 2 characters.",
      });
      return;
    }
    if (isSystemGroupName("item", editedName)) {
      toast({
        variant: "destructive",
        title: "System Group Name",
        description: "This is a system group name. Please use another name.",
      });
      return;
    }

    const resolvedParentId = resolveMasterEntityGroupParentIdFromPath(systemBranch, parentPathIds);
    const gid = group.id;
    setIsOpen(false);

    void (async () => {
      setIsLoading(true);
      try {
        const groupRef = doc(firestore, `companies/${companyId}/item_groups`, gid);
        await updateDoc(groupRef, {
          name: editedName,
          aliasName: aliasName.trim(),
          parentId: resolvedParentId,
        });
        toast({ title: "Group Updated!", description: `"${editedName}" has been successfully updated.` });
        onGroupUpdated();
      } catch (error) {
        console.error("Error updating group:", error);
        toast({
          variant: "destructive",
          title: "Error Updating Group",
          description: "An error occurred. Please try again.",
        });
      } finally {
        setIsLoading(false);
      }
    })();
  }

  const handleMoveToBin = async () => {
    if (!companyId || !user?.uid) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (hasAccounts || hasDirectChildGroups) {
      sonnerToast.error("Cannot Delete", {
        description: hasDirectChildGroups
          ? "This group has nested child groups and cannot be deleted."
          : "This group has items and cannot be deleted.",
      });
      setIsDeleteDialogOpen(false);
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await softDeleteCompanySubdocToRecycleBin(
        companyId,
        ITEM_ENTITY_GROUP_PRESET.collection,
        group.id,
        user.uid
      );
      if (!res.ok) {
        throw new Error("error" in res ? res.error : "Move to bin failed");
      }
      toast({ title: "Group Moved to Recycle Bin", description: `"${group.name}" has been moved.` });
      onGroupDeleted();
      setIsOpen(false);
    } catch (error) {
      console.error("Error moving group to bin:", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "An error occurred while moving the group to the recycle bin.",
      });
    } finally {
      setIsLoading(false);
      setIsDeleteDialogOpen(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!companyId) {
      toast({ variant: "destructive", title: "Error", description: "No company selected." });
      return;
    }
    if (hasAccounts || hasDirectChildGroups) {
      sonnerToast.error("Cannot Delete", {
        description: hasDirectChildGroups
          ? "This group has nested child groups and cannot be deleted."
          : "This group has items and cannot be deleted.",
      });
      setIsDeleteDialogOpen(false);
      return;
    }
    if (apkOfflineViewOnly) {
      sonnerToast.error("Offline — view only.");
      setIsDeleteDialogOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      await permanentDeleteCompanySubdocFromRecycleBin(
        companyId,
        ITEM_ENTITY_GROUP_PRESET.collection,
        group.id
      );
      toast({
        title: "Group Deleted Permanently",
        description: `"${group.name}" has been permanently removed.`,
      });
      onGroupDeleted();
      setIsOpen(false);
    } catch (error) {
      console.error("Error permanently deleting group:", error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: "An error occurred while permanently deleting the group.",
      });
    } finally {
      setIsLoading(false);
      setIsDeleteDialogOpen(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {children ? <DialogPlainOpener onOpen={() => setIsOpen(true)}>{children}</DialogPlainOpener> : null}
        <DialogContent overlayClassName={externallyControlled ? NESTED_LEDGER_MASTER_EDIT_OVERLAY_CN : undefined} className={[cnStaticMobileFullscreenDialog(isMobile, "flex flex-col sm:max-w-md"), externallyControlled ? NESTED_LEDGER_MASTER_EDIT_CONTENT_CN : ""].join(" ")}>
          <DialogHeader>
            <DialogTitle>Edit Item Group</DialogTitle>
            <DialogDescription>
              System group → Users Parent group → Child group tree.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <MasterEntityNestedGroupFields
              allGroups={allGroups}
              config={ITEM_ENTITY_GROUP_PRESET.config}
              topParentOptions={ITEM_ENTITY_GROUP_PRESET.topParentOptions}
              excludeGroupId={group.id}
              systemBranch={systemBranch}
              onSystemBranchChange={setSystemBranch}
              parentPathIds={parentPathIds}
              onParentPathIdsChange={setParentPathIds}
              childPathIds={childPathIds}
              onChildPathIdsChange={setChildPathIds}
              onAddNewAtLevel={(level, name) => void handleAddNewParentAtLevel(level, name)}
              groupName={groupName}
              onGroupNameChange={setGroupName}
              mode="edit"
              editingGroup={liveGroup}
              disabled={isLoading || isSystemGroup || apkOfflineViewOnly}
              formResetKey={formResetKey}
              editLevel0Trailing={
                canDeleteGroup ? (
                  <MasterEntityGroupDeleteIconButton
                    isLoading={isLoading}
                    onClick={() => setIsDeleteDialogOpen(true)}
                  />
                ) : null
              }
            />
            <div className="space-y-1 pt-2">
              <label htmlFor="group-alias-name" className="text-sm font-medium">Alias Name <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <input id="group-alias-name" value={aliasName} onChange={(e) => setAliasName(e.target.value)} placeholder="Other name (e.g. as printed on bills)" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <DialogFooter className={MASTER_DIALOG_FOOTER_ROW_CLASS}>
              <DialogClose asChild>
                <Button type="button" variant="ghost" className={MASTER_DIALOG_CANCEL_GRAY_PILL_BTN_CLASS}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={() => handleSubmit()}
                disabled={isLoading || isSystemGroup || apkOfflineViewOnly}
                className="ml-auto shrink-0"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <MasterDeleteConfirmAlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete group?"
        entityKind="group"
        entityName={group.name}
        description={
          <>
            Choose how to remove{" "}
            <span className="font-semibold text-foreground">{group.name}</span>. This group has no
            items.
          </>
        }
        onMoveToBin={handleMoveToBin}
        onDeletePermanently={handlePermanentDelete}
        busy={isLoading}
        moveToBinDisabled={apkOfflineViewOnly}
        permanentDeleteDisabled={apkOfflineViewOnly}
      />
    </>
  );
}
