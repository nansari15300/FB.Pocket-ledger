
"use client";

import { updateDoc, deleteDoc, writeBatch } from "@/lib/writeGateway/pbWrites";
import { useState, useEffect, useMemo, useCallback } from "react";
import { STAFF_ENTITY_GROUPS_LABEL, STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import { PermissionRouteGuard } from "@/components/permission/PermissionRouteGuard";
import { collection, query, where, doc, serverTimestamp, type QueryDocumentSnapshot } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
    RecycleBinItem,
    resolveDeletedVoucherAccountSides,
    type DeletedItem,
} from "@/components/recycle-bin/RecycleBinItem";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Loader2 } from "lucide-react";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions, { canForRecycleBinLocalCompany, type PermissionConfig } from "@/hooks/usePermissions";
import { assertCan, PermissionDeniedError } from "@/lib/permissions/enforcePermission";
import { PermissionButton } from "@/components/permission";
import { cn } from "@/lib/utils";
import { useVouchers } from "@/hooks/useVouchers";
import { deleteCompanyComplete } from "@/lib/actions/deleteCompanyAction";
import {
    companyRecycleMustSkipFirestore,
    getPocketBaseCompanyDeleteMode,
    isPocketBaseRecycleCompanyId,
    permanentDeletePocketBaseCompany,
    resolveCompanyRecycleRootForId,
    restoreCompanyFromRecycleBin,
} from "@/lib/companyRecycleRoot";
import { getRecycleBinConfig, subscribeRecycleBinConfig, type RecycleBinConfig } from "@/lib/recycleBinConfig";
import { removeRecycleBinAlerts } from "@/lib/transactionAlerts";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { numericEntitlement, isAtOrOverEntitlementCap, type PlanId } from "@/config/plans";
import { isLocalOnlyMode } from "@/lib/localMode";
import { reportFirestoreListenFailure } from "@/lib/classifyFirestoreClientError";
import {
    getLocalCompanyById,
    listLocalCompanies,
    localCompanyRowIsDeleted,
    upsertLocalCompany,
    type LocalCompanyDoc,
} from "@/lib/localCompanyStore";
import {
  permanentDeleteDriveFolderHint,
  permanentDeleteLocalCompanyWithDriveCleanup,
} from "@/lib/localCompanyPermanentDelete";
import { coerceDeletedAtToDate } from "@/lib/coerceDeletedAt";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import { BROWSER_DB_COLLECTION_BUMP, deleteCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import {
    companyUsesSqliteRecycleBinSource,
    loadDeletedSubdocsForRecycleBin,
    permanentDeleteCompanySubdocFromRecycleBin,
    restoreCompanySubdocFromRecycleBin,
    deleteFirebaseStorageFilesForDoc,
    subscribeOnlineRecycleBinFirestoreToSqliteMirror,
} from "@/lib/recycleBinEntityLifecycle";
import { LOCAL_AUTH_CHANGED_EVENT } from "@/lib/localApiClient";
import { ownerFinalizeRecycleBinCompanyOnServer } from "@/lib/ownerRecycleBinApiClient";
import { deleteCompanyFirebaseStorageFolder } from "@/lib/deleteCompanyStorageFolder";
import type { User } from "@/lib/pbCompat/auth";
import type { Permission } from "@/lib/permissions";

/** Recycle bin me company row — header me shared company select ho to bhi owner apni deleted company manage kar sake. */
function isRecycleBinOwnerCompanyItem(
    item: DeletedItem,
    user: { uid: string; email?: string | null } | null | undefined,
    customUser: { role?: string; email?: string | null } | null | undefined
): boolean {
    const isCompany = item.collectionPath === "companies" || item.isRootCollection === true;
    if (!isCompany || !user?.uid) return false;
    if (customUser?.role === "SuperAdmin") return true;
    if (item.ownerId && String(item.ownerId) === user.uid) return true;
    const ue = (user.email || "").toLowerCase().trim();
    const oe = String(item.ownerEmail || "").toLowerCase().trim();
    return Boolean(ue && oe && ue === oe);
}

async function assertRecycleBinAction(
    item: DeletedItem,
    can: (p: Permission) => boolean,
    permission: Permission,
    user: { uid: string; email?: string | null } | null | undefined,
    customUser: { role?: string; email?: string | null } | null | undefined
): Promise<void> {
    const isCompanyRow = item.collectionPath === "companies" || item.isRootCollection === true;
    if (isCompanyRow && item.companyStorageSource === "local") {
        let permissionConfig: PermissionConfig | undefined;
        try {
            const localRow = await getLocalCompanyById(item.id, { includeDeleted: true });
            permissionConfig = (localRow as { permissionConfig?: PermissionConfig })?.permissionConfig;
        } catch {
            /* optional */
        }
        const ok = canForRecycleBinLocalCompany(
            item.id,
            { ownerId: item.ownerId, ownerEmail: item.ownerEmail },
            user?.uid,
            user?.email ?? null,
            permission,
            permissionConfig
        );
        if (!ok) {
            throw new PermissionDeniedError("No permission for this local company.");
        }
        return;
    }
    if (isRecycleBinOwnerCompanyItem(item, user, customUser)) return;
    assertCan(can, permission);
}

function mergeDeletedCompanyFirestoreDocs(
    ownerDocs: QueryDocumentSnapshot[],
    emailDocs: QueryDocumentSnapshot[]
): DeletedItem[] {
    const byId = new Map<string, DeletedItem>();
    const add = (docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        if (data.movedToAdminRecycleAt) return;
        const storage = String(data.storageOption ?? "firebase").toLowerCase();
        byId.set(docSnap.id, {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name ? data.name : "Unnamed Company",
            type: "Company",
            deletedAt: coerceDeletedAtToDate(data.deletedAt) ?? undefined,
            collectionPath: "companies",
            isRootCollection: true,
            ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
            ownerEmail: typeof data.ownerEmail === "string" ? data.ownerEmail : undefined,
            companyStorageSource: storage === "local" ? "local" : "online",
        });
    };
    ownerDocs.forEach(add);
    emailDocs.forEach(add);
    return Array.from(byId.values());
}

/** SQLite row: device-local company — server doc optional; recycle bin delete sirf local DB. */
async function deletedCompanyUsesLocalStorageOnly(item: DeletedItem): Promise<boolean> {
    if (item.companyStorageSource === "local") return true;
    if (item.companyStorageSource === "online") return false;
    const row = await getLocalCompanyById(item.id, { includeDeleted: true });
    if (!row) return false;
    return String((row as { storageOption?: string }).storageOption || "local").toLowerCase() === "local";
}

/** Empty bin loop: `cid` ke liye row list me na ho to bhi SQLite se local detect karo. */
async function recycleBinCompanyIdIsLocalStorageOnly(companyId: string, items: DeletedItem[]): Promise<boolean> {
    const hint = items.find(
        (i) => i.id === companyId && (i.collectionPath === "companies" || i.isRootCollection === true)
    );
    if (hint) return deletedCompanyUsesLocalStorageOnly(hint);
    const row = await getLocalCompanyById(companyId, { includeDeleted: true });
    if (!row) return false;
    return String((row as { storageOption?: string }).storageOption || "local").toLowerCase() === "local";
}

/** Firestore pe `storageOption` na ho to assert / buttons se pehle SQLite se source set karo. */
async function ensureCompanyRecycleBinItemStorage(item: DeletedItem): Promise<DeletedItem> {
    const isCo = item.collectionPath === "companies" || item.isRootCollection === true;
    if (!isCo) return item;
    if (item.companyStorageSource === "local" || item.companyStorageSource === "online") return item;
    const row = await getLocalCompanyById(item.id, { includeDeleted: true });
    if (!row) {
        return { ...item, companyStorageSource: isLocalOnlyMode() ? "local" : "online" };
    }
    const src =
        String((row as { storageOption?: string }).storageOption || "firebase").toLowerCase() === "local"
            ? ("local" as const)
            : ("online" as const);
    return { ...item, companyStorageSource: src };
}

function localCompanyToRecycleBinItem(c: LocalCompanyDoc): DeletedItem {
    const storage = String((c as { storageOption?: string }).storageOption ?? "local").toLowerCase();
    return {
        id: c.id,
        name: String(c.name || "Unnamed Company"),
        type: "Company",
        deletedAt: coerceDeletedAtToDate(c.deletedAt) ?? undefined,
        collectionPath: "companies",
        isRootCollection: true,
        ownerId: typeof c.ownerId === "string" ? c.ownerId : undefined,
        ownerEmail: typeof c.ownerEmail === "string" ? c.ownerEmail : undefined,
        companyStorageSource: storage === "local" ? "local" : "online",
    };
}

async function finalizeOwnerDeletedCompanyOnline(
    companyId: string,
    firebaseUser: User,
    clientQuickDelete: boolean
): Promise<{ success: boolean; error?: string }> {
    const apiRes = await ownerFinalizeRecycleBinCompanyOnServer({
        companyId,
        getIdToken: () => firebaseUser.getIdToken(),
    });
    if (apiRes.ok) return { success: true };
    if (apiRes.ok === false && apiRes.tryClientFallback) {
        // Fallback when hosted API missing (static EXE/APK): same Super Admin quickDelete rule as server.
        if (clientQuickDelete) {
            return deleteCompanyComplete(companyId, firebaseUser.uid);
        }
        try {
            await updateDoc(doc(firestore, "companies", companyId), {
                movedToAdminRecycleAt: serverTimestamp(),
            });
            return { success: true };
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : "update_failed" };
        }
    }
    return { success: false, error: apiRes.ok === false ? apiRes.error : "finalize_failed" };
}

/** Online company finalize ke baad optional SQLite mirror (EXE caches online company locally). */
async function mirrorLocalCompanyAfterOnlineRecycleFinalize(
    companyId: string,
    quickDelete: boolean,
    firebaseUid: string | null | undefined
): Promise<void> {
    try {
        const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
        if (!localRow) return;
        if (quickDelete) {
            await permanentDeleteLocalCompanyWithDriveCleanup(companyId, { firebaseUid: firebaseUid ?? null });
        } else {
            await upsertLocalCompany({
                ...localRow,
                id: companyId,
                movedToAdminRecycleAt: Date.now(),
            });
        }
    } catch {
        /* optional mirror */
    }
}

const COLLECTIONS_TO_CHECK = [
    { path: 'parties', nameField: 'name', type: 'Party' },
    { path: 'groups', nameField: 'name', type: 'Party Group' },
    { path: 'bank_accounts', nameField: 'accountName', type: 'Bank/Cash Account' },
    { path: 'account_groups', nameField: 'name', type: 'Account Group' },
    { path: 'staff', nameField: 'name', type: STAFF_ENTITY_LABEL },
    { path: 'staff_groups', nameField: 'name', type: STAFF_ENTITY_GROUPS_LABEL },
    { path: 'items', nameField: 'name', type: 'Item' },
    { path: 'item_groups', nameField: 'name', type: 'Item Group' },
    { path: 'taxes', nameField: 'name', type: 'Tax' },
    { path: 'tax_groups', nameField: 'name', type: 'Tax Group' },
    { path: 'vouchers', nameField: 'voucherNumber', type: 'Voucher' },
    { path: 'quotations', nameField: 'quotationNumber', type: 'Quotation' },
    { path: 'unassigned_documents', nameField: 'name', type: 'Unassigned File' }
];

export default function RecycleBinPage() {
    return (
        <PermissionRouteGuard permission="delete_records">
            <RecycleBinContent />
        </PermissionRouteGuard>
    );
}

function RecycleBinContent() {
    const { user, customUser } = useAuth();
    const { can } = usePermissions();
    const { companyId, company, allCompanies, localCompanyRegistryEpoch, reloadLocalCompanyRegistry } = useCompany();
    const livePlans = useLivePlans();
    const { journalAccountNames } = useVouchers();
    const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const [itemToConfirm, setItemToConfirm] = useState<{item: DeletedItem, action: 'restore' | 'delete'} | null>(null);
    const [isEmptydialogOpen, setIsEmptyDialogOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const [recycleBinConfig, setRecycleBinConfig] = useState<RecycleBinConfig | null>(null);
    const [, setCountdownTick] = useState(0);
    const [atMaxCompanies, setAtMaxCompanies] = useState(false);
    /** Local company username/password change par recycle bin buttons dobara evaluate. */
    const [localPermEpoch, setLocalPermEpoch] = useState(0);
    /** Recycle bin voucher: read-only AddVoucherDialog + ribbon Restore. */
    const [viewVoucherOpen, setViewVoucherOpen] = useState(false);
    const [viewVoucherDoc, setViewVoucherDoc] = useState<Record<string, unknown> | null>(null);
    const [viewVoucherLoading, setViewVoucherLoading] = useState(false);
    const [viewVoucherBinItem, setViewVoucherBinItem] = useState<DeletedItem | null>(null);
    const [viewVoucherRestored, setViewVoucherRestored] = useState(false);
    const [viewVoucherRestoring, setViewVoucherRestoring] = useState(false);

    useEffect(() => {
        const onLocalAuth = () => setLocalPermEpoch((n) => n + 1);
        window.addEventListener(LOCAL_AUTH_CHANGED_EVENT, onLocalAuth);
        return () => window.removeEventListener(LOCAL_AUTH_CHANGED_EVENT, onLocalAuth);
    }, []);

    const removeDeletedItemFromState = useCallback((item: DeletedItem) => {
        setDeletedItems((prev) =>
            prev.filter((x) => !(x.id === item.id && x.collectionPath === item.collectionPath))
        );
    }, []);

    // Non-deleted company count vs plan limit (to disable company restore when at max)
    useEffect(() => {
        if (!user?.uid) {
            setAtMaxCompanies(false);
            return;
        }
        if (isLocalOnlyMode()) {
            // Local-only mode: company limit local registry se evaluate karo (non-deleted companies only).
            listLocalCompanies()
                .then((rows) => {
                    const count = rows.length;
                    const planId: PlanId = count === 0 ? "basic" : ((rows[0]?.planId as PlanId) || "basic");
                    const plan = getPlanFromPlans(livePlans, planId);
                    const max = numericEntitlement(plan?.entitlements, "maxCompanies", true);
                    setAtMaxCompanies(isAtOrOverEntitlementCap(count, max));
                })
                .catch(() => setAtMaxCompanies(false));
            return;
        }
        const q = query(
            collection(firestore, "companies"),
            where("ownerId", "==", user.uid),
            where("isDeleted", "!=", true)
        );
        const unsub = onSnapshot(q, (snap) => {
            const count = snap.size;
            const planId: PlanId = count === 0 ? "basic" : (snap.docs[0]?.data()?.planId as PlanId) || "basic";
            const plan = getPlanFromPlans(livePlans, planId);
            const max = numericEntitlement(plan?.entitlements, "maxCompanies", false);
            setAtMaxCompanies(isAtOrOverEntitlementCap(count, max));
        }, () => setAtMaxCompanies(false));
        return () => unsub();
    }, [user?.uid, livePlans]);

    // Recycle bin config (quick delete vs move to admin bin) – same as "Auto-delete after (days) – Company Admin" in super admin settings
    useEffect(() => {
        getRecycleBinConfig().then(setRecycleBinConfig);
        const unsub = subscribeRecycleBinConfig(setRecycleBinConfig);
        return unsub;
    }, []);

    // Re-render every second so any countdown (e.g. Xh Ym Zs) can run live
    useEffect(() => {
        const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    // Deleted companies: subscribe whenever user is set (so deleted companies show even when no company selected)
        useEffect(() => {
            if (!user?.uid) {
                setLoading(false);
                return;
            }
            if (isLocalOnlyMode()) {
                // Local-only mode: deleted companies local table se read karo.
                setLoading(true);
                listLocalCompanies({ includeDeleted: true })
                    .then((rows) => {
                        const companyItems: DeletedItem[] = rows
                            // Hidden-from-company-admin rows local recycle bin me dobara na dikhaye.
                            .filter((c) => localCompanyRowIsDeleted(c) && !(c as { movedToAdminRecycleAt?: unknown }).movedToAdminRecycleAt)
                            .map(localCompanyToRecycleBinItem);
                        setDeletedItems((prev) => {
                            const otherItems = prev.filter((item) => item.collectionPath !== "companies");
                            return [...otherItems, ...companyItems];
                        });
                    })
                    .catch((error) => {
                        console.error("Error fetching deleted local companies:", error);
                    })
                    .finally(() => setLoading(false));
                return;
            }
            setLoading(true);
            const ownerDocsRef: { current: QueryDocumentSnapshot[] } = { current: [] };
            const emailDocsRef: { current: QueryDocumentSnapshot[] } = { current: [] };

            const flushDeletedCompanies = () => {
                const emailDocs =
                    customUser?.role === "SuperAdmin" && user.email ? emailDocsRef.current : [];
                const companyItems = mergeDeletedCompanyFirestoreDocs(ownerDocsRef.current, emailDocs);
                setDeletedItems((prev) => {
                    const otherItems = prev.filter(
                        (item) => item.collectionPath !== "companies" || item.companyStorageSource === "local"
                    );
                    return [...otherItems, ...companyItems];
                });
                setLoading(false);
            };

            const qCompanies = query(
                collection(firestore, "companies"),
                where("ownerId", "==", user.uid),
                where("isDeleted", "==", true)
            );
            const unsubCompanies = onSnapshot(
                qCompanies,
                (snapshot) => {
                    ownerDocsRef.current = snapshot.docs;
                    flushDeletedCompanies();
                },
                (error) => {
                    console.error("Error fetching deleted companies:", error);
                    setLoading(false);
                }
            );

            let unsubEmail: (() => void) | undefined;
            if (customUser?.role === "SuperAdmin" && user.email) {
                const raw = user.email.trim();
                const lower = raw.toLowerCase();
                const variants = raw === lower ? [lower] : [raw, lower];
                const qByEmail = query(
                    collection(firestore, "companies"),
                    where("ownerEmail", "in", variants),
                    where("isDeleted", "==", true)
                );
                unsubEmail = onSnapshot(
                    qByEmail,
                    (snapshot) => {
                        emailDocsRef.current = snapshot.docs;
                        flushDeletedCompanies();
                    },
                    (error) => {
                        console.error("Error fetching deleted companies (ownerEmail):", error);
                    }
                );
            }

            const timeout = setTimeout(() => setLoading(false), 5000);
            return () => {
                unsubCompanies();
                unsubEmail?.();
                clearTimeout(timeout);
            };
        }, [user?.uid, user?.email, customUser?.role, localCompanyRegistryEpoch]);

    // Local companies can exist while the app is in Online/Server gate mode; keep their recycle-bin rows merged too.
    useEffect(() => {
        if (!user?.uid) return;
        let cancelled = false;
        listLocalCompanies({ includeDeleted: true })
            .then((rows) => {
                if (cancelled) return;
                const localDeletedCompanies = rows
                    .filter((c) => localCompanyRowIsDeleted(c) && !(c as { movedToAdminRecycleAt?: unknown }).movedToAdminRecycleAt)
                    .filter((c) => String((c as { storageOption?: string }).storageOption ?? "local").toLowerCase() === "local")
                    .map(localCompanyToRecycleBinItem);
                setDeletedItems((prev) => {
                    const byKey = new Map<string, DeletedItem>();
                    for (const item of prev) {
                        const isLocalCompany =
                            (item.collectionPath === "companies" || item.isRootCollection === true) &&
                            item.companyStorageSource === "local";
                        if (!isLocalCompany) byKey.set(`${item.collectionPath}:${item.id}`, item);
                    }
                    for (const item of localDeletedCompanies) {
                        byKey.set(`${item.collectionPath}:${item.id}`, item);
                    }
                    return [...byKey.values()];
                });
            })
            .catch((error) => {
                console.error("Error merging deleted local companies:", error);
            })
            .finally(() => {
                if (!cancelled && isLocalOnlyMode()) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [user?.uid, localCompanyRegistryEpoch]);

    // Online app: Firestore `storageOption` miss ho to SQLite se Local/Online badge align karo.
    useEffect(() => {
        if (isLocalOnlyMode() || !user?.uid) return;
        let cancelled = false;
        (async () => {
            const companyRows = deletedItems.filter(
                (i) => i.collectionPath === "companies" || i.isRootCollection === true
            );
            if (companyRows.length === 0) return;
            const patches = new Map<string, "local" | "online">();
            for (const it of companyRows) {
                const row = await getLocalCompanyById(it.id, { includeDeleted: true });
                if (cancelled || !row) continue;
                const src =
                    String((row as { storageOption?: string }).storageOption || "firebase").toLowerCase() === "local"
                        ? ("local" as const)
                        : ("online" as const);
                if (it.companyStorageSource !== src) patches.set(it.id, src);
            }
            if (cancelled || patches.size === 0) return;
            setDeletedItems((prev) =>
                prev.map((p) => {
                    if (!(p.collectionPath === "companies" || p.isRootCollection === true)) return p;
                    const s = patches.get(p.id);
                    return s ? { ...p, companyStorageSource: s } : p;
                })
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [deletedItems, user?.uid]);

        // Local + Drive / SQLite companies: Firestore listener ke saath SQLite deleted rows bhi (bin empty fix).
        useEffect(() => {
            if (!companyId || !user?.uid) return;
            let cancelled = false;

            const mergeSqliteDeletedIntoState = async () => {
                if (!(await companyUsesSqliteRecycleBinSource(companyId))) return;
                const sqliteItems = await loadDeletedSubdocsForRecycleBin(companyId, COLLECTIONS_TO_CHECK);
                if (cancelled) return;
                setDeletedItems((prev) => {
                    const byKey = new Map<string, DeletedItem>();
                    for (const it of prev) {
                        if (it.collectionPath === "companies" || it.isRootCollection) continue;
                        byKey.set(`${it.collectionPath}:${it.id}`, it);
                    }
                    for (const it of sqliteItems) {
                        byKey.set(`${it.collectionPath}:${it.id}`, it);
                    }
                    const mergedSub = [...byKey.values()];
                    const companiesOnly = prev.filter(
                        (p) => p.collectionPath === "companies" || p.isRootCollection === true
                    );
                    return [...companiesOnly, ...mergedSub];
                });
            };

            void mergeSqliteDeletedIntoState().finally(() => {
                if (!cancelled) setLoading(false);
            });
            const unsubFirestoreMirror = subscribeOnlineRecycleBinFirestoreToSqliteMirror(
                companyId,
                COLLECTIONS_TO_CHECK,
                () => {
                    if (!cancelled) void mergeSqliteDeletedIntoState();
                }
            );
            const onBump = (ev: Event) => {
                const d = (ev as CustomEvent<{ companyId?: string; collectionName?: string }>).detail;
                if (d?.companyId && d.companyId !== companyId) return;
                void mergeSqliteDeletedIntoState();
            };
            window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
            return () => {
                cancelled = true;
                unsubFirestoreMirror();
                window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
            };
        }, [companyId, user?.uid]);

        // EXE/local+Drive: SQLite bin source — Firestore `onSnapshot` empty list se SQLite rows flash hata deta tha (~29ms).
        useEffect(() => {
            if (!companyId || !user?.uid) return;

            let cancelled = false;
            let subcollectionUnsubs: Array<() => void> = [];
            let initialLoadComplete = false;

            void (async () => {
                if (await companyUsesSqliteRecycleBinSource(companyId)) {
                    if (!cancelled) setLoading(false);
                    return;
                }
                if (cancelled) return;

                const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
                const fsCompanyId = String(
                    (reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId
                ).trim();

                subcollectionUnsubs = COLLECTIONS_TO_CHECK.map((coll) => {
                    const q = query(
                        collection(firestore, `companies/${fsCompanyId}/${coll.path}`),
                        where("isDeleted", "==", true)
                    );
                    return onSnapshot(
                        q,
                        (snapshot) => {
                            if (!initialLoadComplete) {
                                setLoading(false);
                                initialLoadComplete = true;
                            }

                            const newItems = snapshot.docs
                                .filter((docSnap) => !docSnap.data().movedToAdminRecycleAt)
                                .map((docSnap) => {
                                    const data = docSnap.data();
                                    const item: DeletedItem = {
                                        id: docSnap.id,
                                        name:
                                            data[coll.nameField] ||
                                            data.title ||
                                            `Voucher ${data.voucherNumber}` ||
                                            "Unnamed",
                                        type: coll.type,
                                        deletedAt: coerceDeletedAtToDate(data.deletedAt) ?? undefined,
                                        collectionPath: coll.path,
                                        convertedToType: data.convertedToType,
                                        convertedToVoucherNumber: data.convertedToVoucherNumber,
                                    };

                                    if (coll.path === "vouchers") {
                                        item.voucherNumber = data.voucherNumber;
                                        item.voucherType = data.type;
                                        item.date = data.date?.toDate
                                            ? data.date.toDate()
                                            : data.date instanceof Date
                                              ? data.date
                                              : data.date
                                                ? new Date(data.date)
                                                : null;
                                        item.accountId = data.accountId;
                                        item.fromAccountId = data.fromAccountId;
                                        item.toAccountId = data.toAccountId;
                                        item.bankAccountId = data.bankAccountId;
                                        item.partyId = data.partyId;
                                        item.staffId = data.staffId;
                                        item.taxAccountId = data.taxAccountId;
                                        item.incomeAccountId = data.incomeAccountId;
                                        item.expenseAccountId = data.expenseAccountId;
                                        item.salesAccountId = data.salesAccountId;
                                        item.purchaseAccountId = data.purchaseAccountId;
                                        item.payeeName = data.payeeName;
                                        item.partyName = data.partyName;
                                        item.userId = data.userId;
                                        item.deletedBy = data.deletedBy || data.userId;

                                        const sides = resolveDeletedVoucherAccountSides(
                                            item,
                                            journalAccountNames
                                        );
                                        if (sides.from) item.fromAccountName = sides.from;
                                        if (sides.to) item.toAccountName = sides.to;
                                        if (sides.to || sides.from) {
                                            item.accountName = sides.to || sides.from;
                                        }
                                    }

                                    return item;
                                });

                            setDeletedItems((prev) => {
                                const otherItems = prev.filter((item) => item.collectionPath !== coll.path);
                                return [...otherItems, ...newItems];
                            });
                        },
                        (error) => {
                            reportFirestoreListenFailure("recycle-bin", coll.path, error);
                            if (!initialLoadComplete) {
                                setLoading(false);
                                initialLoadComplete = true;
                            }
                        }
                    );
                });
            })();

            return () => {
                cancelled = true;
                subcollectionUnsubs.forEach((unsub) => unsub());
            };
        }, [companyId, user?.uid, journalAccountNames]);

    // Fetch user names for deleted items — `deletedBy` is Auth UID; users doc often lives at `{slug}_{uid}`.
    useEffect(() => {
        const fetchUserNames = async () => {
            const userIds = new Set<string>();
            deletedItems.forEach((item) => {
                if (item.deletedBy) userIds.add(String(item.deletedBy).trim());
                if (item.userId && !item.deletedBy) userIds.add(String(item.userId).trim());
            });

            const sessionUid = String(user?.uid || "").trim();
            const sessionLabel = String(
                customUser?.displayName ||
                    user?.displayName ||
                    customUser?.email ||
                    user?.email ||
                    ""
            ).trim();

            const newUserNames: Record<string, string> = {};
            for (const uid of Array.from(userIds)) {
                if (!uid) continue;
                const cached = userNames[uid];
                if (cached && cached !== "Unknown" && cached !== "N/A") continue;

                // Same logged-in user → profile se turant (users/{uid} kabhi miss hota hai).
                if (sessionUid && uid === sessionUid && sessionLabel) {
                    newUserNames[uid] = sessionLabel;
                    continue;
                }

                try {
                    let displayName = "";
                    // Prefer query by `uid` field (slug_uid doc ids).
                    const qByUid = query(collection(firestore, "users"), where("uid", "==", uid));
                    const snap = await getDocs(qByUid);
                    const data = snap.docs[0]?.data();
                    if (data) {
                        displayName = String(data.displayName || data.name || data.email || "").trim();
                    }
                    if (!displayName) {
                        const userDoc = await getDoc(doc(firestore, "users", uid));
                        if (userDoc.exists()) {
                            const d = userDoc.data();
                            displayName = String(d.displayName || d.name || d.email || "").trim();
                        }
                    }
                    if (displayName) {
                        newUserNames[uid] = displayName;
                    }
                } catch (e) {
                    console.error("Error fetching user:", e);
                }
            }

            if (Object.keys(newUserNames).length > 0) {
                setUserNames((prev) => ({ ...prev, ...newUserNames }));
            }
        };

        if (deletedItems.length > 0) {
            void fetchUserNames();
        }
    }, [deletedItems, userNames, user?.uid, user?.displayName, user?.email, customUser?.displayName, customUser?.email]);

    const [accountNames, setAccountNames] = useState<Record<string, string>>({});

    // Fetch account names for vouchers if missing
    useEffect(() => {
        const fetchMissingAccountNames = async () => {
            const accountIdsToFetch = new Set<string>();
            deletedItems.forEach(item => {
                if (item.type === 'Voucher') {
                    for (const accountId of [
                        item.accountId,
                        item.fromAccountId,
                        item.toAccountId,
                        item.bankAccountId,
                        item.partyId,
                        item.staffId,
                        item.taxAccountId,
                        item.incomeAccountId,
                        item.expenseAccountId,
                        item.salesAccountId,
                        item.purchaseAccountId,
                    ]) {
                        if (accountId && !journalAccountNames[accountId] && !accountNames[accountId]) {
                            accountIdsToFetch.add(accountId);
                        }
                    }
                }
            });

            if (accountIdsToFetch.size === 0) return;

            const collectionsToSearch = ['parties', 'bank_accounts', 'staff', 'items', 'expense_accounts', 'taxes'];
            const nameFields = ['name', 'accountName', 'name', 'name', 'name', 'name'];

            const newAccountNames: Record<string, string> = {};
            for (const accountId of Array.from(accountIdsToFetch)) {
                let found = false;
                for (let i = 0; i < collectionsToSearch.length && !found; i++) {
                    try {
                        const docRef = doc(firestore, `companies/${companyId}/${collectionsToSearch[i]}`, accountId);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            const name = docSnap.data()?.[nameFields[i]] || 'Unknown';
                            newAccountNames[accountId] = name;
                            found = true;
                        }
                    } catch (error) {
                        // Continue to next collection
                    }
                }
                if (!found) {
                    newAccountNames[accountId] = 'Unknown Account';
                }
            }

            if (Object.keys(newAccountNames).length > 0) {
                setAccountNames(prev => ({ ...prev, ...newAccountNames }));
            }
        };

        if (deletedItems.length > 0 && companyId) {
            fetchMissingAccountNames();
        }
    }, [deletedItems, companyId, journalAccountNames, accountNames]);

    // Enrich deleted items with user names and account names
    const enrichedDeletedItems = useMemo(() => {
        return deletedItems.map(item => {
            const enriched = { ...item };
            // `companyStorageSource` Firestore merge / SQLite sync effect se aata hai — default "online" mat lagao (local row galat assert ho jata tha).

            // Add user name
            const userIdToUse = enriched.deletedBy || enriched.userId;
            if (userIdToUse) {
                const fromMap = userNames[userIdToUse];
                if (fromMap && fromMap !== "Unknown" && fromMap !== "N/A") {
                    enriched.deletedByUserName = fromMap;
                } else if (user?.uid && userIdToUse === user.uid) {
                    enriched.deletedByUserName =
                        customUser?.displayName ||
                        user.displayName ||
                        customUser?.email ||
                        user.email ||
                        undefined;
                }
            }

            // From → To for voucher title (payment_in: party → bank, not bank alone)
            if (enriched.type === "Voucher") {
                const nameMap = { ...journalAccountNames, ...accountNames };
                const sides = resolveDeletedVoucherAccountSides(enriched, nameMap);
                if (sides.from) enriched.fromAccountName = sides.from;
                if (sides.to) enriched.toAccountName = sides.to;
                if (!enriched.accountName) {
                    enriched.accountName = sides.to || sides.from || undefined;
                }
            }

            return enriched;
        });
    }, [deletedItems, userNames, journalAccountNames, accountNames, localPermEpoch, user?.uid, user?.displayName, user?.email, customUser?.displayName, customUser?.email]);
    
    // PocketBase companies: show the per-company Delete mode (Hard / Soft) in the confirm dialogs.
    const [pbModeNote, setPbModeNote] = useState<string | null>(null);
    const [pbEmptyNote, setPbEmptyNote] = useState<string | null>(null);
    useEffect(() => {
        const it = itemToConfirm && itemToConfirm.action === "delete" ? itemToConfirm.item : null;
        if (!it || !(it.collectionPath === "companies" || it.isRootCollection === true)) {
            setPbModeNote(null);
            return;
        }
        let cancelled = false;
        setPbModeNote(null);
        void (async () => {
            if (!(await isPocketBaseRecycleCompanyId(it.id))) return;
            const info = await getPocketBaseCompanyDeleteMode(it.id, it.name);
            if (cancelled) return;
            setPbModeNote(
                info.mode === "hard"
                    ? "Delete mode: HARD - this company and ALL its data will be deleted from the server immediately."
                    : "Delete mode: SOFT - the company is hidden; its data stays on the server until the admin wipes it later."
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [itemToConfirm]);
    useEffect(() => {
        if (!isEmptydialogOpen) {
            setPbEmptyNote(null);
            return;
        }
        const companies = enrichedDeletedItems.filter(
            (i) => i.collectionPath === "companies" || i.isRootCollection === true
        );
        if (companies.length === 0) {
            setPbEmptyNote(null);
            return;
        }
        let cancelled = false;
        setPbEmptyNote(null);
        void (async () => {
            let hard = 0;
            let soft = 0;
            for (const c of companies) {
                if (!(await isPocketBaseRecycleCompanyId(c.id))) continue;
                const info = await getPocketBaseCompanyDeleteMode(c.id, c.name);
                if (info.mode === "hard") hard += 1;
                else soft += 1;
            }
            if (cancelled || hard + soft === 0) return;
            setPbEmptyNote(
                `Online (PocketBase) companies: ${hard} with Delete mode HARD (deleted from the server immediately), ${soft} with Delete mode SOFT (hidden; the admin wipes the data later).`
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [isEmptydialogOpen, enrichedDeletedItems]);

    /** Deleted voucher Firestore / SQLite se load karke read-only edit dialog. */
    const handleViewVoucher = useCallback(
        async (item: DeletedItem) => {
            if (!companyId) {
                toast({
                    variant: "destructive",
                    title: "Select a company",
                    description: "Choose a company from the sidebar to view deleted vouchers.",
                });
                return;
            }
            setViewVoucherLoading(true);
            setViewVoucherOpen(true);
            setViewVoucherDoc(null);
            setViewVoucherBinItem(item);
            setViewVoucherRestored(false);
            try {
                const snap = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, item.id));
                let data: Record<string, unknown> | null = null;
                if (snap.exists()) {
                    data = { id: snap.id, ...(snap.data() as Record<string, unknown>) };
                } else {
                    data = await getCompanyDocFromBrowserDb(companyId, "vouchers", item.id, { includeDeleted: true });
                }
                if (!data) {
                    throw new Error("Voucher not found.");
                }
                const rawDate = data.date as { toDate?: () => Date } | Date | string | undefined;
                if (rawDate && typeof (rawDate as { toDate?: () => Date }).toDate === "function") {
                    data.date = (rawDate as { toDate: () => Date }).toDate();
                } else if (rawDate && !(rawDate instanceof Date)) {
                    const parsed = new Date(String(rawDate));
                    if (!Number.isNaN(parsed.getTime())) data.date = parsed;
                }
                setViewVoucherDoc(data);
            } catch (e) {
                console.error("[recycle-bin] view voucher", e);
                setViewVoucherOpen(false);
                toast({
                    variant: "destructive",
                    title: "Could not open voucher",
                    description: e instanceof Error ? e.message : "Try again when online.",
                });
            } finally {
                setViewVoucherLoading(false);
            }
        },
        [companyId, toast]
    );

    /** View dialog ribbon: restore voucher then edit mode. */
    const handleRestoreFromViewDialog = useCallback(async () => {
        if (!viewVoucherBinItem || !companyId) return;
        setViewVoucherRestoring(true);
        try {
            await assertRecycleBinAction(viewVoucherBinItem, can, "delete_records", user, customUser);
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                toast({ variant: "destructive", title: "Permission Denied", description: error.message });
            } else {
                toast({ variant: "destructive", title: "Error", description: "Failed to check permissions." });
            }
            setViewVoucherRestoring(false);
            return;
        }
        try {
            // SQLite + Drive: restore local row + cloud_sync; Firestore optional.
            await restoreCompanySubdocFromRecycleBin(companyId, "vouchers", viewVoucherBinItem.id);
            removeDeletedItemFromState(viewVoucherBinItem);
            await removeRecycleBinAlerts(companyId, viewVoucherBinItem.id);
            setViewVoucherDoc((prev) => (prev ? { ...prev, isDeleted: false, deletedAt: null } : prev));
            setViewVoucherRestored(true);
            toast({
                title: "Restored!",
                description: `"${viewVoucherBinItem.voucherNumber || viewVoucherBinItem.name}" is restored — you can edit now.`,
            });
        } catch (error) {
            console.error("[recycle-bin] restore from view", error);
            toast({ variant: "destructive", title: "Error", description: "Failed to restore voucher." });
        } finally {
            setViewVoucherRestoring(false);
        }
    }, [viewVoucherBinItem, companyId, can, user, customUser, toast, removeDeletedItemFromState]);

    const handleRestore = async (item: DeletedItem) => {
        const resolvedItem = await ensureCompanyRecycleBinItemStorage(item);
        const isCompany = resolvedItem.collectionPath === "companies" || resolvedItem.isRootCollection === true;
        if (!companyId && !isCompany) return;

        try {
            await assertRecycleBinAction(resolvedItem, can, "delete_records", user, customUser);
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                toast({
                    variant: "destructive",
                    title: "Permission Denied",
                    description: error.message,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to check permissions.",
                });
            }
            setItemToConfirm(null);
            return;
        }

        if (isCompany && user?.uid) {
            if (await deletedCompanyUsesLocalStorageOnly(resolvedItem)) {
                const nonDeletedLocalCompanies = await listLocalCompanies();
                const currentCount = nonDeletedLocalCompanies.length;
                // Create company jaisa: pehli local row ka planId account tier se match na ho to galat cap — highest owned SKU use karo.
                const planId: PlanId = resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId);
                const plan = getPlanFromPlans(livePlans, planId);
                const maxCompanies = numericEntitlement(plan?.entitlements, "maxCompanies", true);
                if (isAtOrOverEntitlementCap(currentCount, maxCompanies)) {
                    toast({
                        variant: "destructive",
                        title: "Plan limit reached",
                        description: `Your plan allows up to ${maxCompanies} compan${maxCompanies === 1 ? "y" : "ies"}. Move one to bin or upgrade to restore from recycle bin.`,
                    });
                    setItemToConfirm(null);
                    return;
                }
            } else {
            try {
                const ownedSnap = await getDocs(query(
                    collection(firestore, "companies"),
                    where("ownerId", "==", user.uid),
                    where("isDeleted", "!=", true)
                ));
                const currentCount = ownedSnap.size;
                const planId: PlanId = resolveEffectiveAccountPlanId(allCompanies, user?.uid, company?.planId);
                const plan = getPlanFromPlans(livePlans, planId);
                const maxCompanies = numericEntitlement(plan?.entitlements, "maxCompanies", false);
                if (isAtOrOverEntitlementCap(currentCount, maxCompanies)) {
                    toast({
                        variant: "destructive",
                        title: "Plan limit reached",
                        description: `Your plan allows up to ${maxCompanies} compan${maxCompanies === 1 ? "y" : "ies"}. Move one to bin or upgrade to restore from recycle bin.`,
                    });
                    setItemToConfirm(null);
                    return;
                }
            } catch (error) {
                // Offline fallback: context list se count nikaalo so restore action runtime error na de.
                const currentCount = (allCompanies || []).filter((c: any) => !c?.isDeleted).length;
                const planId: PlanId = (company?.planId as PlanId) || "basic";
                const plan = getPlanFromPlans(livePlans, planId);
                const maxCompanies = numericEntitlement(plan?.entitlements, "maxCompanies", false);
                if (isAtOrOverEntitlementCap(currentCount, maxCompanies)) {
                    toast({
                        variant: "destructive",
                        title: "Plan limit reached",
                        description: `Your plan allows up to ${maxCompanies} compan${maxCompanies === 1 ? "y" : "ies"}.`,
                    });
                    setItemToConfirm(null);
                    return;
                }
                console.warn("Restore company count fallback used due offline Firestore:", error);
            }
            }
        }
        
        setIsProcessing(true);
        try {
            if (isCompany) {
                const restored = await restoreCompanyFromRecycleBin(resolvedItem.id, {
                    companyStorageSource: resolvedItem.companyStorageSource,
                });
                if (!restored.ok) {
                    throw new Error(("error" in restored ? restored.error : null) || "Restore failed");
                }
            } else if (companyId) {
                await restoreCompanySubdocFromRecycleBin(companyId, resolvedItem.collectionPath, resolvedItem.id);
            } else {
                throw new Error("Select a company to restore this item.");
            }
            removeDeletedItemFromState(resolvedItem);
            if (isCompany) {
                await removeRecycleBinAlerts(resolvedItem.id, resolvedItem.id);
            } else if (companyId) {
                await removeRecycleBinAlerts(companyId, resolvedItem.id);
            }
            if (isCompany) {
              reloadLocalCompanyRegistry();
            }
            toast({ title: "Restored!", description: `"${resolvedItem.name}" has been restored.` });
        } catch (error) {
            console.error('Restore failed:', error);
            toast({
                variant: 'destructive',
                title: "Error",
                description: error instanceof Error && error.message ? error.message : "Failed to restore item.",
            });
        }
        setItemToConfirm(null);
        setIsProcessing(false);
    };

    const handlePermanentDelete = async (item: DeletedItem) => {
        const resolvedItem = await ensureCompanyRecycleBinItemStorage(item);
        const isCompany = resolvedItem.collectionPath === "companies" || resolvedItem.isRootCollection === true;
        if (!companyId && !isCompany) return;
        
        try {
            await assertRecycleBinAction(resolvedItem, can, "permanently_delete_records", user, customUser);
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                toast({
                    variant: "destructive",
                    title: "Permission Denied",
                    description: error.message,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to check permissions.",
                });
            }
            return;
        }
        
        // Quick delete OFF = only remove from company admin view; item stays in DB and shows in super admin recycle bin.
        // Quick delete ON  = delete from server (Firestore + Storage) immediately.
        const quickDelete = recycleBinConfig?.quickDelete ?? false;

        setIsProcessing(true);
        try {
            if (isCompany) {
                // PocketBase company: delete on PB (never the local-only purge, even if its row says storageOption "local").
                if (await isPocketBaseRecycleCompanyId(resolvedItem.id)) {
                    const pbDel = await permanentDeletePocketBaseCompany(resolvedItem.id, {
                        quickDelete,
                        userId: user?.uid ?? null,
                        companyName: resolvedItem.name,
                    });
                    if (!pbDel.ok) throw new Error(("error" in pbDel ? pbDel.error : null) || "Permanent delete failed.");
                    // Hard delete mode: the server already removed everything -> also purge the local row.
                    const pbHard = "mode" in pbDel && pbDel.mode === "hard";
                    await mirrorLocalCompanyAfterOnlineRecycleFinalize(resolvedItem.id, quickDelete || pbHard, user?.uid);
                    removeDeletedItemFromState(resolvedItem);
                    reloadLocalCompanyRegistry();
                    if (quickDelete || pbHard) {
                        toast({ title: "Success", description: `"${resolvedItem.name}" deleted permanently.` });
                    } else {
                        toast({ title: "Deleted permanently", description: `"${resolvedItem.name}" has been removed from your recycle bin.` });
                    }
                    return;
                }
                const { root } = await resolveCompanyRecycleRootForId(resolvedItem.id, {
                    companyStorageSource: resolvedItem.companyStorageSource,
                });
                // Local / PL-server: SQLite (+ Drive) only — same-id online Firestore doc mat chhedo.
                if (companyRecycleMustSkipFirestore(root) || (await deletedCompanyUsesLocalStorageOnly(resolvedItem))) {
                    const driveDel = await permanentDeleteLocalCompanyWithDriveCleanup(resolvedItem.id, {
                        firebaseUid: user?.uid ?? null,
                    });
                    removeDeletedItemFromState(resolvedItem);
                    reloadLocalCompanyRegistry();
                    toast({
                        title: quickDelete ? "Success" : "Deleted permanently",
                        description: quickDelete
                            ? `"${resolvedItem.name}" deleted permanently.${permanentDeleteDriveFolderHint(driveDel)}`
                            : `"${resolvedItem.name}" has been removed from your recycle bin.${permanentDeleteDriveFolderHint(driveDel)}`,
                    });
                    return;
                }
                if (!user) throw new Error("Please sign in to delete.");
                const finOnline = await finalizeOwnerDeletedCompanyOnline(resolvedItem.id, user, quickDelete);
                if (!finOnline.success) throw new Error(finOnline.error || "Permanent delete failed.");
                if (quickDelete) {
                    try {
                        await deleteCompanyFirebaseStorageFolder({
                            companyId: resolvedItem.id,
                            companyName: resolvedItem.name,
                        });
                    } catch (e) {
                        console.warn("[recycle-bin] client storage wipe after company delete", e);
                    }
                }
                await mirrorLocalCompanyAfterOnlineRecycleFinalize(resolvedItem.id, quickDelete, user?.uid);
                removeDeletedItemFromState(resolvedItem);
                if (quickDelete) {
                    toast({ title: "Success", description: `"${resolvedItem.name}" deleted permanently.` });
                } else {
                    toast({ title: "Deleted permanently", description: `"${resolvedItem.name}" has been removed from your recycle bin.` });
                }
                return;
            }

            const sqliteFullPurge = await companyUsesSqliteRecycleBinSource(companyId);
            if (quickDelete || sqliteFullPurge) {
                // Local SQLite + Drive attachments + cloud_sync purge — online Firestore bhi cleanup.
                await permanentDeleteCompanySubdocFromRecycleBin(
                    companyId,
                    resolvedItem.collectionPath,
                    resolvedItem.id
                );
                if (companyId) {
                  await removeRecycleBinAlerts(companyId, resolvedItem.id);
                }
                removeDeletedItemFromState(resolvedItem);
                toast({ title: "Success", description: `"${resolvedItem.name}" deleted permanently.` });
            } else {
                const docPath = `companies/${companyId}/${resolvedItem.collectionPath}/${resolvedItem.id}`;
                const docRef = doc(firestore, docPath);
                await updateDoc(docRef, { movedToAdminRecycleAt: serverTimestamp() });
                if (companyId) {
                  await removeRecycleBinAlerts(companyId, resolvedItem.id);
                }
                removeDeletedItemFromState(resolvedItem);
                toast({ title: "Deleted permanently", description: "Item has been removed from your recycle bin." });
            }
        } catch (error) {
            console.error("Delete Error:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error instanceof Error && error.message ? error.message : "Permanent delete failed.",
            });
        } finally {
            setItemToConfirm(null);
            setIsProcessing(false);
        }
    };

    const handleEmptyBin = async () => {
        if (deletedItems.length === 0) return;

        const resolvedBinItems = await Promise.all(deletedItems.map((it) => ensureCompanyRecycleBinItemStorage(it)));
        
        for (const item of resolvedBinItems) {
            try {
                await assertRecycleBinAction(item, can, "permanently_delete_records", user, customUser);
            } catch (error) {
                if (error instanceof PermissionDeniedError) {
                    toast({
                        variant: "destructive",
                        title: "Permission Denied",
                        description: error.message,
                    });
                } else {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Failed to check permissions.",
                    });
                }
                setIsEmptyDialogOpen(false);
                return;
            }
        }
        
        setIsProcessing(true);
        setIsEmptyDialogOpen(false);

        // Quick delete OFF = only remove from company admin list (movedToAdminRecycleAt); super admin bin keeps them.
        // Quick delete ON  = delete from server.
        const quickDelete = recycleBinConfig?.quickDelete ?? false;
        const sqliteFullPurge = companyId ? await companyUsesSqliteRecycleBinSource(companyId) : false;
        const companyIds: string[] = [];
        const nonCompanyItems: DeletedItem[] = [];
        for (const item of resolvedBinItems) {
            if (item.collectionPath === "companies" || item.isRootCollection === true) companyIds.push(item.id);
            else nonCompanyItems.push(item);
        }

        try {
            if (nonCompanyItems.length > 0 && !companyId) {
                toast({ variant: "destructive", title: "Error", description: "Select a company to remove these items from the bin." });
                setIsProcessing(false);
                return;
            }

            // Per company: local/PL → SQLite(+Drive); Online → Super Admin quickDelete finalize (web/EXE/APK same).
            // Static EXE `isLocalOnlyMode()` mat treat as "all companies are local" — Online rows bina Firestore finalize UI se hat jaati thin.
            const localOnlyCompanyIds: string[] = [];
            const onlineCompanyIds: string[] = [];
            const pocketBaseCompanyIds: string[] = [];
            for (const cid of companyIds) {
                if (await isPocketBaseRecycleCompanyId(cid)) {
                    pocketBaseCompanyIds.push(cid);
                    continue;
                }
                const hint = resolvedBinItems.find(
                    (i) => i.id === cid && (i.collectionPath === "companies" || i.isRootCollection === true)
                );
                const { root } = await resolveCompanyRecycleRootForId(cid, {
                    companyStorageSource: hint?.companyStorageSource,
                });
                if (
                    companyRecycleMustSkipFirestore(root) ||
                    (await recycleBinCompanyIdIsLocalStorageOnly(cid, resolvedBinItems))
                ) {
                    localOnlyCompanyIds.push(cid);
                } else {
                    onlineCompanyIds.push(cid);
                }
            }

            for (const cid of localOnlyCompanyIds) {
                await permanentDeleteLocalCompanyWithDriveCleanup(cid, { firebaseUid: user?.uid ?? null });
            }

            // PocketBase companies: delete on PB, then mirror/purge the SQLite row.
            for (const cid of pocketBaseCompanyIds) {
                const pbDel = await permanentDeletePocketBaseCompany(cid, {
                    quickDelete,
                    userId: user?.uid ?? null,
                });
                const pbHard = pbDel.ok && "mode" in pbDel && pbDel.mode === "hard";
                if (!pbDel.ok) {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: ("error" in pbDel ? pbDel.error : null) || "Failed to delete company.",
                    });
                    setIsProcessing(false);
                    return;
                }
                await mirrorLocalCompanyAfterOnlineRecycleFinalize(cid, quickDelete || pbHard, user?.uid);
            }

            if (onlineCompanyIds.length > 0) {
                if (!user) {
                    toast({ variant: "destructive", title: "Error", description: "Please sign in to empty the bin." });
                    setIsProcessing(false);
                    return;
                }
                for (const cid of onlineCompanyIds) {
                    const fin = await finalizeOwnerDeletedCompanyOnline(cid, user, quickDelete);
                    if (!fin.success) {
                        toast({
                            variant: "destructive",
                            title: "Error",
                            description: fin.error || (quickDelete ? "Failed to delete company." : "Failed to update company."),
                        });
                        setIsProcessing(false);
                        return;
                    }
                    if (quickDelete) {
                        const nameHint =
                            resolvedBinItems.find((i) => i.id === cid)?.name || cid;
                        try {
                            await deleteCompanyFirebaseStorageFolder({
                                companyId: cid,
                                companyName: nameHint,
                            });
                        } catch (e) {
                            console.warn("[recycle-bin] empty-bin client storage wipe", e);
                        }
                    }
                    await mirrorLocalCompanyAfterOnlineRecycleFinalize(cid, quickDelete, user.uid);
                }
            }

            if (nonCompanyItems.length > 0) {
                if (quickDelete || sqliteFullPurge) {
                    if (!user) {
                        toast({ variant: "destructive", title: "Error", description: "Please sign in to empty the bin." });
                        setIsProcessing(false);
                        return;
                    }
                    for (const item of nonCompanyItems) {
                        if (!companyId) continue;
                        await permanentDeleteCompanySubdocFromRecycleBin(companyId, item.collectionPath, item.id);
                        await removeRecycleBinAlerts(companyId, item.id);
                    }
                } else if (!isLocalOnlyMode()) {
                    if (!user) {
                        toast({ variant: "destructive", title: "Error", description: "Please sign in to empty the bin." });
                        setIsProcessing(false);
                        return;
                    }
                    const batch = writeBatch(firestore);
                    for (const item of nonCompanyItems) {
                        /* merge, not update: bin rows come from the local mirror and can be stale — the
                         * server may already have removed this doc. `update` on a missing doc throws
                         * "No document to update" and aborts the whole empty-bin batch. */
                        batch.set(
                            doc(firestore, `companies/${companyId}/${item.collectionPath}/${item.id}`),
                            { movedToAdminRecycleAt: serverTimestamp() },
                            { merge: true }
                        );
                    }
                    await batch.commit();
                    if (companyId) {
                        for (const item of nonCompanyItems) {
                            await removeRecycleBinAlerts(companyId, item.id);
                        }
                    }
                } else {
                    // Local-only gate: non-company rows SQLite purge (same as quick path for sqlite-backed bins).
                    for (const item of nonCompanyItems) {
                        if (!companyId) continue;
                        await permanentDeleteCompanySubdocFromRecycleBin(companyId, item.collectionPath, item.id);
                        await removeRecycleBinAlerts(companyId, item.id);
                    }
                }
            }

            for (const cid of companyIds) {
                await removeRecycleBinAlerts(cid, cid);
            }

            if (quickDelete || sqliteFullPurge) {
                toast({ title: "Bin Emptied", description: "All items permanently deleted from server." });
            } else {
                toast({
                    title: "Deleted permanently",
                    description: "All items have been removed from your recycle bin.",
                });
            }
            if (companyIds.length > 0) reloadLocalCompanyRegistry();
            setDeletedItems([]);
            setUserNames({});
        } catch (error) {
            console.error("Error emptying bin:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not empty bin." });
        } finally {
            setIsProcessing(false);
        }
    };
    
     const categorizedAndFilteredItems = useMemo(() => {
        return enrichedDeletedItems
            .filter(item => {
                const searchLower = searchTerm.toLowerCase();
                return item.name.toLowerCase().includes(searchLower) ||
                       item.voucherNumber?.toLowerCase().includes(searchLower) ||
                        item.accountName?.toLowerCase().includes(searchLower) ||
                       item.fromAccountName?.toLowerCase().includes(searchLower) ||
                       item.toAccountName?.toLowerCase().includes(searchLower) ||
                       item.deletedByUserName?.toLowerCase().includes(searchLower);
            })
            .reduce((acc, item) => {
                (acc[item.type] = acc[item.type] || []).push(item);
                return acc;
            }, {} as Record<string, DeletedItem[]>);
    }, [enrichedDeletedItems, searchTerm]);

    /** Shared company select par bhi jab sirf apni deleted companies hon to Empty Bin chale. */
    const canEmptyRecycleBin = useMemo(() => {
        if (enrichedDeletedItems.length === 0) return false;
        return enrichedDeletedItems.every((item) => {
            const isCompanyRow = item.collectionPath === "companies" || item.isRootCollection === true;
            if (isCompanyRow && item.companyStorageSource === "local") {
                return canForRecycleBinLocalCompany(
                    item.id,
                    { ownerId: item.ownerId, ownerEmail: item.ownerEmail },
                    user?.uid,
                    user?.email ?? null,
                    "permanently_delete_records"
                );
            }
            if (isCompanyRow && item.companyStorageSource === "online") {
                if (isRecycleBinOwnerCompanyItem(item, user, customUser)) return true;
                return can("permanently_delete_records");
            }
            if (isCompanyRow && item.companyStorageSource !== "local" && item.companyStorageSource !== "online") {
                if (isRecycleBinOwnerCompanyItem(item, user, customUser)) return true;
                if (
                    canForRecycleBinLocalCompany(
                        item.id,
                        { ownerId: item.ownerId, ownerEmail: item.ownerEmail },
                        user?.uid,
                        user?.email ?? null,
                        "permanently_delete_records"
                    )
                ) {
                    return true;
                }
                return can("permanently_delete_records");
            }
            return can("permanently_delete_records");
        });
    }, [enrichedDeletedItems, user, customUser, can, localPermEpoch]);
    
    if (loading) {
        return (
            <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4">
                <Skeleton className="h-10 sm:h-12 w-3/4 sm:w-1/4" />
                <Skeleton className="h-6 sm:h-8 w-full sm:w-1/2" />
                <Skeleton className="h-48 sm:h-64 w-full" />
            </div>
        )
    }

    return (
        <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex-shrink-0">
                    <h1 className="text-xl sm:text-2xl font-bold font-headline">Recycle Bin</h1>
                    <p className="text-sm sm:text-base text-muted-foreground mt-1">Deleted items are stored here. Converted vouchers are also shown for audit purposes.</p>
                </div>
                 <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
                     <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setIsEmptyDialogOpen(true)}
                        disabled={enrichedDeletedItems.length === 0 || isProcessing || !canEmptyRecycleBin}
                        className="w-full sm:w-auto"
                        title={!canEmptyRecycleBin && enrichedDeletedItems.length > 0 ? "Some items cannot be permanently deleted with your role in the selected company." : undefined}
                    >
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />} 
                        <span className="hidden sm:inline">Empty Bin</span>
                        <span className="sm:hidden">Empty</span>
                    </Button>
                    <div className="relative w-full sm:w-auto sm:max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search deleted items..."
                            className="pl-9 w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>
            
            {enrichedDeletedItems.length === 0 ? (
                <Card className="text-center py-16">
                    <CardHeader>
                        <CardTitle>The Recycle Bin is Empty</CardTitle>
                        <CardDescription>When you delete an item, it will appear here.</CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {Object.keys(categorizedAndFilteredItems).sort().map(category => {
                        const items = categorizedAndFilteredItems[category];
                        if (items.length === 0) return null;
                        return (
                             <Card key={category} className="flex flex-col overflow-hidden">
                                <CardHeader className="pb-3 flex-shrink-0">
                                    <CardTitle className="text-base sm:text-lg">{category} ({items.length})</CardTitle>
                                </CardHeader>
                                <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <div className="flex-1 max-h-[calc(100vh-20rem)] sm:max-h-[calc(100vh-24rem)] overflow-y-auto overflow-x-auto">
                                        <ul className="divide-y w-full">
                                            {items
                                                .sort((a,b) => (b.deletedAt?.getTime() || 0) - (a.deletedAt?.getTime() || 0))
                                                .map(item => (
                                                <RecycleBinItem 
                                                    key={item.id} 
                                                    item={item} 
                                                    onRestore={() => setItemToConfirm({item, action: 'restore'})} 
                                                    onDelete={() => setItemToConfirm({item, action: 'delete'})}
                                                    onViewVoucher={
                                                        item.collectionPath === "vouchers"
                                                            ? handleViewVoucher
                                                            : undefined
                                                    }
                                                    ownerScopedCompanyActions={
                                                        item.companyStorageSource === "online" &&
                                                        isRecycleBinOwnerCompanyItem(item, user, customUser)
                                                    }
                                                    localRecycleBinRestore={
                                                        item.companyStorageSource === "local"
                                                            ? canForRecycleBinLocalCompany(
                                                                  item.id,
                                                                  { ownerId: item.ownerId, ownerEmail: item.ownerEmail },
                                                                  user?.uid,
                                                                  user?.email ?? null,
                                                                  "delete_records"
                                                              )
                                                            : undefined
                                                    }
                                                    localRecycleBinPermanentDelete={
                                                        item.companyStorageSource === "local"
                                                            ? canForRecycleBinLocalCompany(
                                                                  item.id,
                                                                  { ownerId: item.ownerId, ownerEmail: item.ownerEmail },
                                                                  user?.uid,
                                                                  user?.email ?? null,
                                                                  "permanently_delete_records"
                                                              )
                                                            : undefined
                                                    }
                                                    restoreDisabled={item.isRootCollection || item.collectionPath === 'companies' ? atMaxCompanies : false}
                                                    compactView
                                                    daysToPermanentDeleteText={recycleBinConfig ? (() => {
                                                        // Company-admin recycle bin: quick-delete switch se countdown text hide mat karo.
                                                        const raw = recycleBinConfig.autoDeleteAfterDaysCompanyAdmin;
                                                        const d = (typeof raw === 'number' && raw > 0) ? raw : (Number(raw) || 90);
                                                        const oneDayMs = 24 * 60 * 60 * 1000;
                                                        const dayMs = d * oneDayMs;
                                                        const deletedAtMs = item.deletedAt != null ? new Date(item.deletedAt).getTime() : null;
                                                        if (deletedAtMs == null || !Number.isFinite(deletedAtMs)) {
                                                            return d <= 1 ? `${Math.floor(d * 24)}h 0m 0s to delete permanently` : `${d} days to delete permanently`;
                                                        }
                                                        const remainingMs = Math.max(0, dayMs - (Date.now() - deletedAtMs));
                                                        if (!Number.isFinite(remainingMs)) {
                                                            return `${d} days to delete permanently`;
                                                        }
                                                        if (remainingMs > oneDayMs) {
                                                            return `${Math.ceil(remainingMs / oneDayMs)} days to delete permanently`;
                                                        }
                                                        const h = Math.floor(remainingMs / (60 * 60 * 1000)) || 0;
                                                        const m = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000)) || 0;
                                                        const s = Math.floor((remainingMs % (60 * 1000)) / 1000) || 0;
                                                        return `${h}h ${m}m ${s}s to delete permanently`;
                                                    })() : undefined}
                                                />
                                            ))}
                                        </ul>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            <AlertDialog open={!!itemToConfirm} onOpenChange={() => setItemToConfirm(null)}>
                <AlertDialogContent className="max-w-[95vw] sm:max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-base sm:text-lg">Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription className="text-sm">
                           {itemToConfirm?.action === 'delete'
                            ? "This action cannot be undone. This will permanently delete the item." + (pbModeNote ? " " + pbModeNote : "")
                            : "This will restore the item to its original location."
                           }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel disabled={isProcessing} className="w-full sm:w-auto">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToConfirm?.action === 'delete') handlePermanentDelete(itemToConfirm.item);
                                if (itemToConfirm?.action === 'restore') handleRestore(itemToConfirm.item);
                            }}
                            className={cn(
                                itemToConfirm?.action === 'delete' ? 'bg-destructive hover:bg-destructive/90' : '',
                                "w-full sm:w-auto"
                            )}
                            disabled={isProcessing}
                        >
                             {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {itemToConfirm?.action === 'delete' ? 'Delete Permanently' : 'Restore'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
             <AlertDialog open={isEmptydialogOpen} onOpenChange={setIsEmptyDialogOpen}>
                <AlertDialogContent className="max-w-[95vw] sm:max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-base sm:text-lg">Empty the Recycle Bin?</AlertDialogTitle>
                        <AlertDialogDescription className="text-sm">
                            This action cannot be undone. This will permanently delete all {enrichedDeletedItems.length} items in the recycle bin.{pbEmptyNote ? " " + pbEmptyNote : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel disabled={isProcessing} className="w-full sm:w-auto">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleEmptyBin} disabled={isProcessing} className="bg-destructive hover:bg-destructive/90 w-full sm:w-auto">
                           {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                           Empty Bin
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AddVoucherDialog
                isOpen={viewVoucherOpen}
                onOpenChange={(open) => {
                    setViewVoucherOpen(open);
                    if (!open) {
                        setViewVoucherDoc(null);
                        setViewVoucherBinItem(null);
                        setViewVoucherRestored(false);
                    }
                }}
                voucher={viewVoucherDoc ?? undefined}
                forceViewOnly={!viewVoucherRestored}
                recycleBinOnRestore={viewVoucherRestored ? undefined : handleRestoreFromViewDialog}
                recycleBinRestoring={viewVoucherRestoring}
                onVoucherAction={() => {
                    setViewVoucherOpen(false);
                    setViewVoucherDoc(null);
                    setViewVoucherBinItem(null);
                    setViewVoucherRestored(false);
                }}
            />
            {viewVoucherOpen && viewVoucherLoading && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-background/60 pointer-events-none"
                    aria-busy
                    aria-label="Loading voucher"
                >
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
            )}

        </div>
    );
}
