
"use client";

import { updateDoc, deleteDoc } from "@/lib/writeGateway/pbWrites";
import { adminServerWriteBlocked, isAdminServerMode } from "@/lib/adminData/adminServerMode";
import { pbRequest } from "@/lib/pocketbaseData/pbClient";
import { useState, useEffect, useMemo } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { collection, query, where, doc, serverTimestamp, deleteField } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RecycleBinItem, type DeletedItem } from "@/components/recycle-bin/RecycleBinItem";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Loader2, Phone, Home, Hash, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { useCompany } from "@/hooks/useCompany";
import { deleteCompanyComplete, restoreCompany } from "@/lib/actions/deleteCompanyAction";
import { adminPermanentDeleteCompanyOnServer } from "@/lib/adminRecycleBinApiClient";
import { getRecycleBinConfig, setRecycleBinConfig, type RecycleBinConfig } from "@/lib/recycleBinConfig";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { reportFirestoreListenFailure } from "@/lib/classifyFirestoreClientError";


const COLLECTIONS_TO_CHECK = [
    { path: 'companies', nameField: 'name', type: 'Company' },
];

export default function AdminRecycleBinPage() {
    useAdminAccess(['SuperAdmin']);
    const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const [itemToConfirm, setItemToConfirm] = useState<{item: DeletedItem, action: 'restore' | 'delete'} | null>(null);
    const [isEmptydialogOpen, setIsEmptyDialogOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeTab, setActiveTab] = useState("visible");
    const { user } = useAuth();
    const { companyId } = useCompany();
    const [recycleBinConfig, setRecycleBinConfigState] = useState<RecycleBinConfig | null>(null);
    const [configSaving, setConfigSaving] = useState(false);
    const [quickDelete, setQuickDelete] = useState(false);
    const [autoDeleteAfterDaysSuperAdmin, setAutoDeleteAfterDaysSuperAdmin] = useState(90);
    const [autoDeleteAfterDaysCompanyAdmin, setAutoDeleteAfterDaysCompanyAdmin] = useState(90);
    const [countdownTick, setCountdownTick] = useState(0);
    const [userEmails, setUserEmails] = useState<Record<string, string>>({});
    /** users/{uid} se displayName — "Deleted by" ke liye (company delete karne wala user) */
    const [deletedByUserNamesMap, setDeletedByUserNamesMap] = useState<Record<string, string>>({});

    /**
     * Hidden tab/company permanent delete: pehle server Admin API se hard delete force karo.
     * Fallback sirf tab jab server admin config unavailable ho (503), taaki true delete guarantee rahe.
     */
    const hardDeleteCompanyAsSuperAdmin = async (companyId: string): Promise<{ success: boolean; error?: string }> => {
        if (isAdminServerMode()) {
            // Pocket Ledger Server login: the server's main-admin route hard-deletes the company and its records.
            try {
                await pbRequest("/api/pl/admin/recycle-delete", { method: "POST", body: { companyId } });
                return { success: true };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : "Server hard delete failed." };
            }
        }
        if (!user) return { success: false, error: "Authentication required to delete." };
        const serverRes = await adminPermanentDeleteCompanyOnServer({
            companyId,
            getIdToken: () => user.getIdToken(),
        });
        if (serverRes.ok) return { success: true };
        if (serverRes.ok === false && serverRes.tryClientFallback) {
            return deleteCompanyComplete(companyId, user.uid);
        }
        return { success: false, error: serverRes.ok === false ? (serverRes.error || "Server hard delete failed.") : "Server hard delete failed." };
    };

    // Fetch user login emails for company owners (for super admin list)
    useEffect(() => {
        const ownerIds = [...new Set((deletedItems || []).filter(i => i.isRootCollection && (i as DeletedItem & { ownerId?: string }).ownerId).map(i => (i as DeletedItem & { ownerId?: string }).ownerId).filter(Boolean))];
        if (ownerIds.length === 0) {
            setUserEmails({});
            return;
        }
        let cancelled = false;
        (async () => {
            const map: Record<string, string> = {};
            for (const uid of ownerIds) {
                if (!uid || cancelled) continue;
                try {
                    const snap = await getDoc(doc(firestore, 'users', uid));
                    if (snap.exists() && snap.data()?.email) map[uid] = snap.data()!.email;
                } catch {
                    // ignore
                }
            }
            if (!cancelled) setUserEmails(map);
        })();
        return () => { cancelled = true; };
    }, [deletedItems]);

    // Super admin list: deletedBy uid → display name (recycle bin "Deleted by")
    useEffect(() => {
        const fetchDeleterNames = async () => {
            const userIds = new Set<string>();
            deletedItems.forEach((item) => {
                if (item.deletedBy) userIds.add(item.deletedBy);
            });
            const newNames: Record<string, string> = {};
            for (const uid of userIds) {
                if (deletedByUserNamesMap[uid]) continue;
                try {
                    const userDoc = await getDoc(doc(firestore, "users", uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        newNames[uid] = userData.displayName || userData.email || "Unknown";
                    } else {
                        newNames[uid] = "Unknown";
                    }
                } catch {
                    newNames[uid] = "Unknown";
                }
            }
            if (Object.keys(newNames).length > 0) {
                setDeletedByUserNamesMap((prev) => ({ ...prev, ...newNames }));
            }
        };
        if (deletedItems.length > 0) fetchDeleterNames();
    }, [deletedItems, deletedByUserNamesMap]);

    // Update countdown every second when remaining time < 1 day
    useEffect(() => {
        const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        setLoading(true);
        let initialLoadComplete = false;

        const unsubscribers = COLLECTIONS_TO_CHECK.map(coll => {
            const q = query(
                collection(firestore, coll.path),
                where("isDeleted", "==", true)
            );
            return onSnapshot(q, (snapshot) => {
                if (!initialLoadComplete) {
                    setLoading(false);
                    initialLoadComplete = true;
                }

                const newItems = snapshot.docs.map(docSnap => {
                    const d = docSnap.data();
                    const movedAt = d.movedToAdminRecycleAt?.toDate?.() ?? d.movedToAdminRecycleAt;
                    return {
                        id: docSnap.id,
                        name: d[coll.nameField] || 'Unnamed',
                        type: coll.type,
                        deletedAt: d.deletedAt?.toDate(),
                        collectionPath: coll.path,
                        deletedBy: d.deletedBy,
                        allowCompanyAdminRecycleBin: d.settings?.allowCompanyAdminRecycleBin !== false,
                        pan: d.pan,
                        phone: d.phone,
                        address: d.address,
                        email: d.email ?? d.ownerEmail,
                        companyEmail: d.email,
                        ownerEmail: d.ownerEmail,
                        ownerId: d.ownerId,
                        country: d.country,
                        isRootCollection: true,
                        movedToAdminRecycleAt: movedAt ?? null,
                    };
                });

                setDeletedItems(newItems.sort((a,b) => (b.deletedAt?.getTime() || 0) - (a.deletedAt?.getTime() || 0)));

            }, (error) => {
                reportFirestoreListenFailure("admin-recycle-bin", coll.path, error);
                if (!initialLoadComplete) {
                   setLoading(false);
                   initialLoadComplete = true;
                }
            });
        });
        
        const loadingTimeout = setTimeout(() => {
            if (loading) setLoading(false);
        }, 5000);

        return () => {
            unsubscribers.forEach(unsub => unsub());
            clearTimeout(loadingTimeout);
        };
    }, []);

    // Load recycle bin config
    useEffect(() => {
        getRecycleBinConfig().then(c => {
            setRecycleBinConfigState(c);
            setQuickDelete(c.quickDelete);
            setAutoDeleteAfterDaysSuperAdmin(c.autoDeleteAfterDaysSuperAdmin);
            setAutoDeleteAfterDaysCompanyAdmin(c.autoDeleteAfterDaysCompanyAdmin);
        });
    }, []);

    // Move "Visible to Company admin" items to "Hidden" when company-admin days expire (do not permanently delete)
    useEffect(() => {
        if (!recycleBinConfig || deletedItems.length === 0) return;
        const days = recycleBinConfig.autoDeleteAfterDaysCompanyAdmin;
        const now = Date.now();
        const maxAge = days * 24 * 60 * 60 * 1000;
        const toMove = deletedItems.filter(
            i => !i.movedToAdminRecycleAt && i.deletedAt && (now - new Date(i.deletedAt).getTime() >= maxAge)
        );
        if (toMove.length === 0) return;
        if (isAdminServerMode()) return;
        (async () => {
            for (const item of toMove) {
                try {
                    await updateDoc(doc(firestore, "companies", item.id), { movedToAdminRecycleAt: serverTimestamp() });
                } catch (e) {
                    console.warn("Auto-move to Hidden failed:", item.id, e);
                }
            }
        })();
    }, [deletedItems, recycleBinConfig]);

    // Auto-delete companies that have been in Hidden tab longer than autoDeleteAfterDaysSuperAdmin
    useEffect(() => {
        if (!user?.uid || !recycleBinConfig || deletedItems.length === 0) return;
        const days = recycleBinConfig.autoDeleteAfterDaysSuperAdmin;
        const now = Date.now();
        const maxAge = days * 24 * 60 * 60 * 1000;
        const toDelete = deletedItems.filter(
            i => i.movedToAdminRecycleAt && (now - new Date(i.movedToAdminRecycleAt).getTime() >= maxAge)
        );
        if (toDelete.length === 0) return;
        (async () => {
            for (const item of toDelete) {
                try {
                    // Auto cleanup (Hidden tab): direct server hard delete so item normal app me wapas na aaye.
                    const result = await hardDeleteCompanyAsSuperAdmin(item.id);
                    if (!result.success) {
                        throw new Error(result.error || "Auto delete failed");
                    }
                } catch (e) {
                    console.warn("Auto-delete failed:", item.id, e);
                }
            }
        })();
    }, [deletedItems, recycleBinConfig, user?.uid]);

    const handleSaveConfig = async () => {
        setConfigSaving(true);
        try {
            const superDays = Number(autoDeleteAfterDaysSuperAdmin);
            const companyDays = Number(autoDeleteAfterDaysCompanyAdmin);
            await setRecycleBinConfig({
                quickDelete,
                autoDeleteAfterDaysSuperAdmin: Number.isFinite(superDays) && superDays > 0 ? superDays : 90,
                autoDeleteAfterDaysCompanyAdmin: Number.isFinite(companyDays) && companyDays > 0 ? companyDays : 90,
            });
            setRecycleBinConfigState(prev => ({
                ...(prev ?? { quickDelete: false, autoDeleteAfterDays: 90, autoDeleteAfterDaysSuperAdmin: 90, autoDeleteAfterDaysCompanyAdmin: 90 }),
                quickDelete,
                autoDeleteAfterDaysSuperAdmin: Number.isFinite(superDays) && superDays > 0 ? superDays : 90,
                autoDeleteAfterDaysCompanyAdmin: Number.isFinite(companyDays) && companyDays > 0 ? companyDays : 90,
            }));
            toast({ title: "Settings saved", description: "Recycle bin settings updated." });
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: "Failed to save settings." });
        } finally {
            setConfigSaving(false);
        }
    };
    
    const handleRestore = async (item: DeletedItem) => {
        if (adminServerWriteBlocked()) return;
        setIsProcessing(true);

        if (item.isRootCollection && user) {
            const userDocSnap = await getDoc(doc(firestore, "users", user.uid));
            if (userDocSnap.exists()) {
                const surrenderedList = userDocSnap.data()?.surrenderedCompanies || {};
                if (surrenderedList[item.id]) {
                    const info = surrenderedList[item.id];
                    const formattedDate = info.date?.toDate ? format(info.date.toDate(), "yyyy-MM-dd") : 'an unknown date';
                    toast({
                        variant: "destructive",
                        title: "Restore Blocked",
                        description: `You surrendered this company to "${info.surrenderedTo}" on ${formattedDate}. You cannot restore it.`,
                        duration: 10000,
                    });
                    setIsProcessing(false);
                    setItemToConfirm(null);
                    return;
                }
            }
        }
        
        try {
            if (item.isRootCollection) {
                const result = await restoreCompany(item.id);
                if (!result.success) throw new Error(result.error || "Server action failed.");
            } else {
                 if (!companyId) throw new Error("No active company selected for restoring sub-items.");
                 await updateDoc(doc(firestore, `companies/${companyId}/${item.collectionPath}`, item.id), {
                    isDeleted: false,
                    deletedAt: null,
                    deletedBy: deleteField(),
                });
            }
            toast({ title: "Restored!", description: `"${item.name}" has been restored.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message || "Failed to restore item." });
        }
        setItemToConfirm(null);
        setIsProcessing(false);
    };

    const handlePermanentDelete = async (item: DeletedItem) => {
        setIsProcessing(true);
        try {
            if (item.isRootCollection) {
                // Hidden tab action: super-admin delete => server hard delete first.
                const result = await hardDeleteCompanyAsSuperAdmin(item.id);
                if (!result.success) {
                    throw new Error(result.error);
                }
            } else {
                if(!companyId) throw new Error("No active company selected to delete from.");
                // This logic is still problematic if the admin is viewing items from a different company context.
                // For now, it assumes the active companyId is correct for sub-collection items.
                await deleteDoc(doc(firestore, `companies/${companyId}/${item.collectionPath}`, item.id));
            }
            toast({ title: "Permanently Deleted", description: `"${item.name}" has been deleted forever.` });
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Error", description: error.message || "Failed to permanently delete item." });
        } finally {
            setItemToConfirm(null);
            setIsProcessing(false);
        }
    };

    const handleEmptyBin = async () => {
        if (deletedItems.length === 0) return;
        if (!user?.uid) {
            toast({ variant: "destructive", title: "Error", description: "Authentication required." });
            return;
        }
        setIsProcessing(true);
        setIsEmptyDialogOpen(false);

        try {
            for (const item of deletedItems) {
                // Empty Bin from admin recycle-bin: each company ko server se hard delete karo.
                const result = await hardDeleteCompanyAsSuperAdmin(item.id);
                if (!result.success) {
                    toast({ variant: "destructive", title: "Error", description: result.error || "Failed to delete company." });
                    setIsProcessing(false);
                    return;
                }
            }
            toast({ title: "Recycle Bin Emptied", description: `Successfully permanently deleted ${deletedItems.length} companies from server.` });
            setDeletedItems([]);
        } catch (error) {
            console.error("Error emptying recycle bin:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not empty the recycle bin. Please try again." });
        } finally {
            setIsProcessing(false);
        }
    };
    
     const enrichedDeletedItems = useMemo(() => deletedItems.map(item => {
        const it = item as DeletedItem & { ownerId?: string; ownerEmail?: string; companyEmail?: string };
        const userLoginEmail = it.ownerId && userEmails[it.ownerId] ? userEmails[it.ownerId] : (it.ownerEmail ?? null);
        const deletedByUserName =
            item.deletedBy && deletedByUserNamesMap[item.deletedBy]
                ? deletedByUserNamesMap[item.deletedBy]
                : undefined;
        return { ...item, userLoginEmail, companyEmail: it.companyEmail ?? it.email ?? null, deletedByUserName };
    }), [deletedItems, userEmails, deletedByUserNamesMap]);

    const filteredItems = useMemo(() => {
        return enrichedDeletedItems.filter(item => {
            const lowerSearch = searchTerm.toLowerCase();
            const it = item as DeletedItem & { userLoginEmail?: string; companyEmail?: string };
            return (
                item.name.toLowerCase().includes(lowerSearch) ||
                item.id.toLowerCase().includes(lowerSearch) ||
                (item.pan || '').toLowerCase().includes(lowerSearch) ||
                (item.phone || '').toLowerCase().includes(lowerSearch) ||
                (item.address || '').toLowerCase().includes(lowerSearch) ||
                (item.email || '').toLowerCase().includes(lowerSearch) ||
                (it.companyEmail || '').toLowerCase().includes(lowerSearch) ||
                (it.userLoginEmail || '').toLowerCase().includes(lowerSearch) ||
                (item.country || '').toLowerCase().includes(lowerSearch) ||
                (item.deletedByUserName || '').toLowerCase().includes(lowerSearch)
            );
        });
    }, [enrichedDeletedItems, searchTerm]);

    // Visible to Company admin = company admin has NOT permanently deleted (no movedToAdminRecycleAt)
    const visibleItems = useMemo(() => filteredItems.filter(i => !i.movedToAdminRecycleAt), [filteredItems]);
    // Hidden from company Admin = company admin HAS permanently deleted (movedToAdminRecycleAt set)
    const hiddenItems = useMemo(() => filteredItems.filter(i => !!i.movedToAdminRecycleAt), [filteredItems]);
    
    if (loading) {
        return (
            <div className="p-4 space-y-4">
                <Skeleton className="h-12 w-1/4" />
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-64 w-full" />
            </div>
        )
    }

    const renderItemList = (items: DeletedItem[], disableActions: boolean, daysForCountdown: number, countdownSuffix: string) => (
        items.length === 0 ? (
            <Card className="text-center py-16">
                <CardHeader>
                    <CardTitle>This Section is Empty</CardTitle>
                    <CardDescription>No matching items found here.</CardDescription>
                </CardHeader>
            </Card>
        ) : (
             <Card>
                <CardContent className="p-0">
                    <ScrollArea className="h-[calc(100vh-25rem)]">
                        <ul className="divide-y" data-tick={countdownTick}>
                            {items.map(item => {
                                const days = daysForCountdown;
                                const movedAt = item.movedToAdminRecycleAt ? new Date(item.movedToAdminRecycleAt).getTime() : null;
                                const oneDayMs = 24 * 60 * 60 * 1000;
                                const dayMs = days * oneDayMs;
                                const deletedAtMs = item.deletedAt ? new Date(item.deletedAt).getTime() : null;
                                const startMs = movedAt ?? deletedAtMs;
                                const totalMs = startMs != null ? dayMs : 0;
                                const remainingMs = startMs != null ? Math.max(0, totalMs - (Date.now() - startMs)) : 0;
                                let daysText: string;
                                if (startMs == null) {
                                    daysText = `${days} days ${countdownSuffix}`;
                                } else if (remainingMs > oneDayMs) {
                                    const daysRemaining = Math.ceil(remainingMs / oneDayMs);
                                    daysText = `${daysRemaining} days ${countdownSuffix}`;
                                } else {
                                    const h = Math.floor(remainingMs / (60 * 60 * 1000));
                                    const m = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
                                    const s = Math.floor((remainingMs % (60 * 1000)) / 1000);
                                    daysText = `${h}h ${m}m ${s}s ${countdownSuffix}`;
                                }
                                return (
                                <RecycleBinItem 
                                    key={item.id} 
                                    item={item} 
                                    onRestore={() => setItemToConfirm({item, action: 'restore'})} 
                                    onDelete={() => setItemToConfirm({item, action: 'delete'})}
                                    daysToPermanentDeleteText={daysText}
                                    disableActions={disableActions}
                                />
                                );
                            })}
                        </ul>
                    </ScrollArea>
                </CardContent>
            </Card>
        )
    );

    return (
        <div className="p-4 sm:p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold font-headline">Admin Recycle Bin</h1>
                    <p className="text-muted-foreground">Manage deleted companies. They can be restored or permanently deleted.</p>
                </div>
                 <div className="flex items-center gap-4">
                     <Button variant="destructive" onClick={() => setIsEmptyDialogOpen(true)} disabled={deletedItems.length === 0 || isProcessing}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />} 
                        Empty Bin
                    </Button>
                </div>
            </div>

            <Card className="p-4">
                <CardHeader className="p-0 pb-3">
                    <CardTitle className="text-base">Recycle bin settings</CardTitle>
                    <CardDescription>When users click &quot;Delete permanently&quot;, either delete immediately (Quick delete) or move here and auto-delete after X days.</CardDescription>
                </CardHeader>
                <CardContent className="p-0 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <Label htmlFor="quick-delete">Quick delete</Label>
                            <p className="text-xs text-muted-foreground">If ON, user&apos;s &quot;Delete permanently&quot; deletes immediately. If OFF, items move here and are auto-deleted after the days below.</p>
                        </div>
                        <Switch id="quick-delete" checked={quickDelete} onCheckedChange={setQuickDelete} />
                    </div>
                    {!quickDelete && (
                            <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-4">
                                <div>
                                    <Label htmlFor="auto-days-company">Move to Hidden after (days) – Visible tab</Label>
                                    <p className="text-xs text-muted-foreground">For &quot;Visible to Company admin&quot; tab only: after this many days the company is moved to &quot;Hidden from company Admin&quot; tab (no permanent delete). User recycle bin is unchanged.</p>
                                </div>
                                <Input
                                    id="auto-days-company"
                                    type="number"
                                    min={0.01}
                                    max={365}
                                    step={0.1}
                                    value={autoDeleteAfterDaysCompanyAdmin}
                                    onChange={(e) => setAutoDeleteAfterDaysCompanyAdmin(parseFloat(e.target.value) || 90)}
                                    className="w-24"
                                />
                            </div>
                            <div className="flex items-center gap-4">
                                <div>
                                    <Label htmlFor="auto-days-super">Delete permanently after (days) – Hidden tab</Label>
                                    <p className="text-xs text-muted-foreground">Only for &quot;Hidden from company Admin&quot; tab: items will be permanently deleted after this many days from when they were moved to Hidden (e.g. 0.5, 1, 30, 90).</p>
                                </div>
                                <Input
                                    id="auto-days-super"
                                    type="number"
                                    min={0.01}
                                    max={365}
                                    step={0.1}
                                    value={autoDeleteAfterDaysSuperAdmin}
                                    onChange={(e) => setAutoDeleteAfterDaysSuperAdmin(parseFloat(e.target.value) || 90)}
                                    className="w-24"
                                />
                            </div>
                        </div>
                    )}
                    <Button size="sm" onClick={handleSaveConfig} disabled={configSaving}>
                        {configSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save settings
                    </Button>
                </CardContent>
            </Card>

            <div className="relative w-full max-w-lg">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by Name, ID, PAN, Phone, Address, Email, Country..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="visible">Visible to Company admin ({visibleItems.length})</TabsTrigger>
                    <TabsTrigger value="hidden">Hidden from company Admin ({hiddenItems.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="visible" className="mt-4">{renderItemList(visibleItems, true, recycleBinConfig?.autoDeleteAfterDaysCompanyAdmin ?? 90, "to move to Hidden from company Admin tab")}</TabsContent>
                <TabsContent value="hidden" className="mt-4">{renderItemList(hiddenItems, false, recycleBinConfig?.autoDeleteAfterDaysSuperAdmin ?? 90, "to delete permanently")}</TabsContent>
            </Tabs>


            <AlertDialog open={!!itemToConfirm} onOpenChange={() => setItemToConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                           {itemToConfirm?.action === 'delete'
                            ? "This action cannot be undone. This will permanently delete the item."
                            : "This will restore the item to its original location."
                           }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToConfirm?.action === 'delete') handlePermanentDelete(itemToConfirm.item);
                                if (itemToConfirm?.action === 'restore') handleRestore(itemToConfirm.item);
                            }}
                            className={itemToConfirm?.action === 'delete' ? 'bg-destructive hover:bg-destructive/90' : ''}
                            disabled={isProcessing}
                        >
                             {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {itemToConfirm?.action === 'delete' ? 'Delete Permanently' : 'Restore'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
             <AlertDialog open={isEmptydialogOpen} onOpenChange={setIsEmptyDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Empty the Recycle Bin?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete all {deletedItems.length} items in the recycle bin.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleEmptyBin} disabled={isProcessing} className="bg-destructive hover:bg-destructive/90">
                           {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                           Empty Bin
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
}
