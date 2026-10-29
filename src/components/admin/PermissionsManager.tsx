
"use client";

import { adminServerWriteBlocked, isAdminServerMode } from "@/lib/adminData/adminServerMode";
import React, { useEffect, useState, useMemo } from "react";
import { firestore } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { adminServerSetDoc, isAdminServerDataActive, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { Permission, PermissionGroups, type PermissionGroup } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { UserRole, PermissionConfig, initialPermissionConfig } from "@/hooks/usePermissions";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast as sonnerToast } from "sonner";


const flattenedPermissions = PermissionGroups.flatMap(group => group.permissions.map(p => p.key));

export default function PermissionsManager({ selectedGroup }: { selectedGroup: PermissionGroup }) {
  const [editablePermissionConfig, setEditablePermissionConfig] = useState<PermissionConfig | null>(null);
  const [firestorePermissionConfig, setFirestorePermissionConfig] = useState<PermissionConfig | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>("viewer");
  
  const docRef = useMemo(() => doc(firestore, "app_settings", "permissions"), []);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as PermissionConfig;
        setEditablePermissionConfig(data);
        setFirestorePermissionConfig(data);
      } else {
        import("@/hooks/usePermissions").then(module => {
            if (!isAdminServerMode()) setDoc(docRef, module.initialPermissionConfig);
            setEditablePermissionConfig(module.initialPermissionConfig);
            setFirestorePermissionConfig(module.initialPermissionConfig);
        });
      }
      setIsLoading(false);
    }, (error) => {
        console.error("Error fetching permissions:", error);
        sonnerToast.error("Load Failed", { description: "Could not load permissions config." });
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [docRef]);

  const handlePermissionChange = (permissionKey: Permission, checked: boolean) => {
    if (selectedRole === 'owner' || !editablePermissionConfig) return;

    const permissionIndex = flattenedPermissions.indexOf(permissionKey);
    if (permissionIndex === -1) return;
    
    setEditablePermissionConfig(prevConfig => {
      if (!prevConfig) return null;
      const newConfig = JSON.parse(JSON.stringify(prevConfig));
      newConfig.roles[selectedRole][permissionIndex] = checked;
      // delete_approved_voucher and edit_approved_voucher always move together
      if (permissionKey === 'delete_approved_voucher' || permissionKey === 'edit_approved_voucher') {
        const other = permissionKey === 'delete_approved_voucher' ? 'edit_approved_voucher' : 'delete_approved_voucher';
        const otherIdx = flattenedPermissions.indexOf(other);
        if (otherIdx !== -1) newConfig.roles[selectedRole][otherIdx] = checked;
      }
      return newConfig;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (selectedRole === 'owner' || !editablePermissionConfig) return;
    
    setEditablePermissionConfig(prevConfig => {
      if (!prevConfig) return null;
      const newConfig = JSON.parse(JSON.stringify(prevConfig));
      selectedGroup.permissions.forEach(permission => {
        const globalIndex = flattenedPermissions.indexOf(permission.key);
        if (globalIndex !== -1) {
           newConfig.roles[selectedRole][globalIndex] = checked;
        }
      })
      return newConfig;
    });
  }

  const handleSavePermissions = async () => {
    const viaServer = isAdminServerDataActive();
    if (!viaServer && adminServerWriteBlocked()) return;
    if (!editablePermissionConfig) return;
    setIsSaving(true);
    try {
      if (viaServer) {
        await adminServerSetDoc("app_settings/permissions", editablePermissionConfig as unknown as Record<string, unknown>, false);
      } else {
        await setDoc(docRef, editablePermissionConfig);
      }
      sonnerToast.success("Permissions saved successfully!");
    } catch (error) {
       console.error("Failed to save permissions:", error);
       sonnerToast.error("Save Failed", {description: "Could not save permission changes."});
    } finally {
        setIsSaving(false);
    }
  };

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(firestorePermissionConfig) !== JSON.stringify(editablePermissionConfig);
  }, [firestorePermissionConfig, editablePermissionConfig]);

  const handleReset = () => {
    setEditablePermissionConfig(firestorePermissionConfig);
  };
  

  if (isLoading || !editablePermissionConfig) {
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div>;
  }
  
  const permissionsForSelectedRole = editablePermissionConfig.roles[selectedRole] || [];
  const permissionsInGroup = selectedGroup.permissions.map(p => {
    const index = flattenedPermissions.indexOf(p.key);
    return { ...p, hasPermission: permissionsForSelectedRole[index] };
  });

  const allInGroupSelected = permissionsInGroup.every(p => p.hasPermission);


  return (
    <div className="space-y-6">
       <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{selectedGroup.title}</h2>
              <p className="text-sm text-muted-foreground">Editing permissions for role:</p>
               <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
                  <SelectTrigger className="w-[220px] mt-2">
                      <SelectValue placeholder="Select a role to edit" />
                  </SelectTrigger>
                  <SelectContent>
                      {Object.keys(editablePermissionConfig.roles).map(role => (
                          <SelectItem key={role} value={role} className="capitalize">
                              {role.replace('-', ' ')}
                          </SelectItem>
                      ))}
                  </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <Undo2 className="mr-2 h-4 w-4" /> Reset
                </Button>
              )}
              <Button onClick={handleSavePermissions} disabled={isSaving || !hasUnsavedChanges}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="mr-2 h-4 w-4" />
                  Save Permissions
              </Button>
            </div>
        </div>
        
          <div className="border rounded-lg">
             <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-semibold">Permissions</h3>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id={`select-all-${selectedGroup.title}`} 
                    checked={allInGroupSelected}
                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                    disabled={selectedRole === 'owner'}
                  />
                  <label htmlFor={`select-all-${selectedGroup.title}`} className="text-sm font-medium">Select All</label>
                </div>
            </div>
             <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {permissionsInGroup.map((permission) => {
                    const permissionKey = permission.key;
                    const globalIndex = flattenedPermissions.indexOf(permissionKey);
                    if (globalIndex === -1) return null;
                    const hasPermission = permissionsForSelectedRole[globalIndex];

                    return (
                    <div key={permission.key} className="flex items-center space-x-2 p-2 rounded-md border">
                        <Checkbox
                            id={`${selectedRole}-${permission.key}`}
                            checked={hasPermission}
                            onCheckedChange={(checked) => handlePermissionChange(permission.key, !!checked)}
                            disabled={selectedRole === "owner"}
                        />
                        <label
                            htmlFor={`${selectedRole}-${permission.key}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                            {permission.label}
                        </label>
                    </div>
                    )
                })}
            </div>
          </div>
    </div>
  );
}
