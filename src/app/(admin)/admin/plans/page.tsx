
"use client"

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { getBillingApiIdToken } from "@/lib/firebaseAuthForApi";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDocFromServer } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore as db } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { OnlineDemoOffer, Plan, PlanId } from "@/config/plans";
import { DEFAULT_ONLINE_DEMO_OFFER } from "@/config/plans";
import {
  applyOnlineDemoOfferToPlans,
  buildDefaultPlansFirestoreDoc,
  buildOnlineDemoOfferWritePatch,
  mergeAppSettingsPlansDoc,
  readOnlineDemoOfferFromPlansDoc,
  sanitizePlanForFirestoreWrite,
} from "@/lib/mergeAppSettingsPlans";
import {
  buildDeviceUserAddOnOfferWritePatch,
  DEFAULT_DEVICE_USER_ADDON_OFFER,
  readDeviceUserAddOnOfferFromPlansDoc,
  sanitizeDeviceUserAddOnOffer,
  type DeviceUserAddOnOffer,
} from "@/lib/planAddOns";
import {
  defaultPlansListFallback,
  readAdminPlansSelectedPlanId,
  readCachedPlansList,
  writeAdminPlansSelectedPlanId,
  writeCachedPlansList,
} from "@/lib/plansCatalogCache";
import { PlanList } from "@/components/admin/plans/PlanList";
import { PlanDetails } from "@/components/admin/plans/PlanDetails";
import { BillingRegionalSettings } from "@/components/admin/plans/BillingRegionalSettings";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";

/**
 * Same origin as this page (np server: `/app/api/...`), data on PocketBase. Resolved lazily (at call time)
 * so it never bakes a pocket-ledger.com URL; never cross-origin.
 */
const adminPlansApiUrl = () => getBillingApiUrl("/api/admin/app-settings/plans");

/** Tell the PocketBase read seam that a global doc changed (drops stale admin read caches). */
function notifyPlansDocWritten() {
    try {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("pl-udoc-written"));
    } catch {
        /* ignore */
    }
}

export default function PlansPage() {
    useAdminAccess(['SuperAdmin']);
    const { user } = useAuth();
    const { toast } = useToast();
    // Pehli paint stale localStorage na ho — server read ke baad ya snapshot se fill.
    const [plans, setPlans] = useState<Plan[]>(() => defaultPlansListFallback());
    const [onlineDemo, setOnlineDemo] = useState<OnlineDemoOffer>(() => ({ ...DEFAULT_ONLINE_DEMO_OFFER }));
    const [deviceUserAddOns, setDeviceUserAddOns] = useState<DeviceUserAddOnOffer>(() => ({
      ...DEFAULT_DEVICE_USER_ADDON_OFFER,
    }));
    const [loading, setLoading] = useState(true);
    const [missingPlansDoc, setMissingPlansDoc] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    /** Sirf button se: refresh par kabhi defaults upload nahi. */
    const [seedBusy, setSeedBusy] = useState(false);
    /** `getDocFromServer` se hydrate ho chuka ho to purana IndexedDB `fromCache` snapshot UI mat dubara set karo. */
    const serverHydratedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        const plansRef = doc(db, "app_settings", "plans");

        // Refresh / open: seedha Firestore server — local cache / persistence se purane amount na dikhen.
        (async () => {
            try {
                const snap = await getDocFromServer(plansRef);
                if (cancelled) return;
                if (snap.exists()) {
                    const data = snap.data() as Record<string, unknown>;
                    const merged = mergeAppSettingsPlansDoc(data);
                    setPlans(merged);
                    setOnlineDemo(readOnlineDemoOfferFromPlansDoc(data));
                    setDeviceUserAddOns(readDeviceUserAddOnOfferFromPlansDoc(data));
                    writeCachedPlansList(merged);
                    setMissingPlansDoc(false);
                    serverHydratedRef.current = true;
                } else {
                    setMissingPlansDoc(true);
                    setPlans(readCachedPlansList() ?? defaultPlansListFallback());
                }
            } catch {
                if (!cancelled) {
                    const c = readCachedPlansList();
                    if (c?.length) setPlans(c);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        const unsub = onSnapshot(
            plansRef,
            (docSnap) => {
                // Hoist metadata: TS narrows `docSnap` after `exists()` so `metadata` can be typed as unusable in the missing-doc branch.
                const fromCache = docSnap.metadata.fromCache;
                if (!docSnap.exists()) {
                    // Server pe doc hai (`getDocFromServer`) lekin listener abhi cache miss dikhaye — defaults mat samjho.
                    if (!(fromCache && serverHydratedRef.current)) {
                        setMissingPlansDoc(true);
                        setPlans(readCachedPlansList() ?? defaultPlansListFallback());
                    }
                    setLoading(false);
                    return;
                }
                const mergedPlans = mergeAppSettingsPlansDoc(docSnap.data() as Record<string, unknown>);
                const online = typeof navigator !== "undefined" && navigator.onLine;
                const skipStaleCacheOverlay =
                    fromCache && online && serverHydratedRef.current;
                if (!skipStaleCacheOverlay) {
                    setPlans(mergedPlans);
                    setOnlineDemo(readOnlineDemoOfferFromPlansDoc(docSnap.data() as Record<string, unknown>));
                    setDeviceUserAddOns(
                      readDeviceUserAddOnOfferFromPlansDoc(docSnap.data() as Record<string, unknown>)
                    );
                }
                setMissingPlansDoc(false);
                if (!fromCache) {
                    writeCachedPlansList(mergedPlans);
                    serverHydratedRef.current = true;
                }
                setLoading(false);
            },
            (err) => {
                console.error("[admin/plans] Firestore listener", err);
                const cached = readCachedPlansList();
                if (cached) setPlans(cached);
                toast({
                    variant: "destructive",
                    title: "Plans load failed",
                    description: err?.message ?? "Showing last saved catalog from this device.",
                });
                setLoading(false);
            }
        );
        return () => {
            cancelled = true;
            unsub();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount par ek hi subscription
    }, []);

    /** Pehli baar project: sirf SuperAdmin button dabane par defaults Firestore me — refresh auto-upload band. */
    const handleCreateDefaultPlansDocOnce = useCallback(async () => {
        if (!user) {
            toast({ variant: "destructive", title: "Login required" });
            return;
        }
        setSeedBusy(true);
        try {
            const token = await getBillingApiIdToken(user);
            const res = await fetch(adminPlansApiUrl(), {
                signal: AbortSignal.timeout(25000),
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ seedDefaults: true }),
            });
            if (!res.ok) {
                await setDoc(doc(db, "app_settings", "plans"), buildDefaultPlansFirestoreDoc(), { merge: true });
            }
            const snap = await getDocFromServer(doc(db, "app_settings", "plans"));
            if (snap.exists()) {
                const data = snap.data() as Record<string, unknown>;
                const merged = mergeAppSettingsPlansDoc(data);
                setPlans(merged);
                setOnlineDemo(readOnlineDemoOfferFromPlansDoc(data));
                writeCachedPlansList(merged);
                setMissingPlansDoc(false);
            }
            toast({ title: "Done", description: "Default plans document created in Firestore." });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast({ variant: "destructive", title: "Create failed", description: msg });
        } finally {
            setSeedBusy(false);
        }
    }, [user, toast]);

    const handleSelectPlan = useCallback((plan: Plan) => {
        setSelectedPlan(plan);
        writeAdminPlansSelectedPlanId(plan.id as PlanId);
    }, []);

    useEffect(() => {
        if (plans.length === 0) return;
        if (!selectedPlan) {
            const stored = readAdminPlansSelectedPlanId();
            const fromStorage = stored ? plans.find((p) => p.id === stored) : undefined;
            setSelectedPlan(fromStorage ?? plans[0]);
            return;
        }
        const updatedSelectedPlan = plans.find((p) => p.id === selectedPlan.id);
        if (updatedSelectedPlan) {
            setSelectedPlan(updatedSelectedPlan);
        } else {
            const stored = readAdminPlansSelectedPlanId();
            const fromStorage = stored ? plans.find((p) => p.id === stored) : undefined;
            setSelectedPlan(fromStorage ?? plans[0]);
        }
    }, [plans, selectedPlan]);

    const handleUpdateAndSave = async (updatedPlan: Plan) => {
        setPlans(prev => prev.map(p => p.id === updatedPlan.id ? updatedPlan : p));

        if (!user) {
            toast({ variant: "destructive", title: "Not signed in", description: "Login required to save plans." });
            return false;
        }

        // Fallback write straight to the PocketBase document store (udoc), same document the API writes.
        const writeClientOnly = async () => {
            // Sirf is tier ka field - poora doc spread nahi (kam undefined / size issues).
            const { demo: _d, ...planWithoutDemo } = updatedPlan as Plan & { demo?: unknown };
            await setDoc(
                doc(db, "app_settings", "plans"),
                { [updatedPlan.id]: sanitizePlanForFirestoreWrite(planWithoutDemo as Plan) },
                { merge: true }
            );
        };

        /** Saved: keep the optimistic row (it has the new free flag etc.) and refresh caches. Never fails the save. */
        const markSaved = () => {
            serverHydratedRef.current = true;
            notifyPlansDocWritten();
            setPlans((prev) => {
                writeCachedPlansList(prev);
                return prev;
            });
        };

        try {
            const token = await getBillingApiIdToken(user);
            const { demo: _d, ...planWithoutDemo } = updatedPlan as Plan & { demo?: unknown };
            const planPayload = sanitizePlanForFirestoreWrite(planWithoutDemo as Plan);
            const res = await fetch(adminPlansApiUrl(), {
                signal: AbortSignal.timeout(25000),
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    planId: updatedPlan.id,
                    plan: planPayload,
                }),
            });
            const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };

            if (res.ok) {
                markSaved();
                return true;
            }

            if (res.status === 401) {
                toast({ variant: "destructive", title: "Save failed", description: j?.error ?? "Invalid session." });
                return false;
            }

            try {
                await writeClientOnly();
                markSaved();
                return true;
            } catch (clientErr: unknown) {
                const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
                toast({ variant: "destructive", title: "Save failed", description: j?.error ?? msg });
                return false;
            }
        } catch (error: unknown) {
            try {
                await writeClientOnly();
                markSaved();
                return true;
            } catch (clientErr: unknown) {
                const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
                toast({ variant: "destructive", title: "Save failed", description: msg });
                return false;
            }
        }
    };
    const handleSaveOnlineDemo = async (
        offer: OnlineDemoOffer,
        options?: { existingDemoAction?: "retain" | "reset" | "replace" }
    ) => {
        if (!user) {
            toast({ variant: "destructive", title: "Not signed in", description: "Login required to save demo offer." });
            return false;
        }
        try {
            const token = await getBillingApiIdToken(user);
            const res = await fetch(adminPlansApiUrl(), {
                signal: AbortSignal.timeout(25000),
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    onlineDemo: offer,
                    ...(options?.existingDemoAction
                        ? { existingDemoAction: options.existingDemoAction }
                        : {}),
                }),
            });
            if (!res.ok) {
                // Client fallback keeps admin usable if Admin SDK is down.
                await setDoc(doc(db, "app_settings", "plans"), buildOnlineDemoOfferWritePatch(offer), {
                    merge: true,
                });
            }
            setOnlineDemo(offer);
            setPlans((prev) => {
                const next = applyOnlineDemoOfferToPlans(prev, offer);
                writeCachedPlansList(next);
                return next;
            });
            toast({ title: "Saved", description: "Online demo offer updated." });
            return true;
        } catch (e: unknown) {
            toast({
                variant: "destructive",
                title: "Demo save failed",
                description: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    };

    const handleSaveDeviceUserAddOns = async (offer: DeviceUserAddOnOffer) => {
        if (!user) {
            toast({ variant: "destructive", title: "Not signed in", description: "Login required to save add-ons." });
            return false;
        }
        const sanitized = sanitizeDeviceUserAddOnOffer(offer);
        const writeClientOnly = async () => {
            await setDoc(doc(db, "app_settings", "plans"), buildDeviceUserAddOnOfferWritePatch(sanitized), {
                merge: true,
            });
        };
        const refreshAddonsFromServer = async () => {
            const snap = await getDocFromServer(doc(db, "app_settings", "plans"));
            if (!snap.exists()) return;
            const data = snap.data() as Record<string, unknown>;
            setDeviceUserAddOns(readDeviceUserAddOnOfferFromPlansDoc(data));
            serverHydratedRef.current = true;
        };
        try {
            const token = await getBillingApiIdToken(user);
            const res = await fetch(adminPlansApiUrl(), {
                signal: AbortSignal.timeout(25000),
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ deviceUserAddOns: sanitized }),
            });
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            if (res.ok) {
                await refreshAddonsFromServer();
                toast({ title: "Saved", description: "Add-on service updated." });
                return true;
            }
            if (res.status === 401) {
                toast({
                    variant: "destructive",
                    title: "Add-on save failed",
                    description: j?.error ?? "Invalid session — sign in again.",
                });
                return false;
            }
            await writeClientOnly();
            await refreshAddonsFromServer();
            toast({ title: "Saved", description: "Add-on service updated (direct Firestore)." });
            return true;
        } catch {
            try {
                await writeClientOnly();
                await refreshAddonsFromServer();
                toast({
                    title: "Saved",
                    description: "Add-on service updated (API unreachable — saved to Firestore).",
                });
                return true;
            } catch (clientErr: unknown) {
                toast({
                    variant: "destructive",
                    title: "Add-on save failed",
                    description: clientErr instanceof Error ? clientErr.message : String(clientErr),
                });
                return false;
            }
        }
    };

    const handleTogglePlanBillingVisibility = async (plan: Plan, showOnBilling: boolean) => {
        const hiddenFromBilling = !showOnBilling;
        const previous = plan.hiddenFromBilling === true;
        const updated = { ...plan, hiddenFromBilling };
        setPlans((prev) => {
            const next = prev.map((p) => (p.id === updated.id ? updated : p));
            writeCachedPlansList(next);
            return next;
        });
        setSelectedPlan((prev) => (prev?.id === updated.id ? updated : prev));

        if (!user) {
            toast({ variant: "destructive", title: "Not signed in", description: "Login required to save visibility." });
            const reverted = { ...plan, hiddenFromBilling: previous };
            setPlans((prev) => prev.map((p) => (p.id === reverted.id ? reverted : p)));
            setSelectedPlan((prev) => (prev?.id === reverted.id ? reverted : prev));
            return;
        }

        try {
            const token = await getBillingApiIdToken(user);
            const res = await fetch(adminPlansApiUrl(), {
                signal: AbortSignal.timeout(25000),
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    planBillingVisibility: { planId: plan.id, hiddenFromBilling },
                }),
            });
            if (!res.ok) {
                const j = (await res.json().catch(() => ({}))) as { error?: string };
                console.warn("[admin/plans] visibility API", res.status, j?.error);
            }
            await setDoc(
                doc(db, "app_settings", "plans"),
                { [plan.id]: { hiddenFromBilling } },
                { merge: true }
            );
            toast({
                title: hiddenFromBilling ? "Hidden from billing" : "Visible on billing",
                description: `${plan.name} billing page listing updated.`,
            });
        } catch (e: unknown) {
            const reverted = { ...plan, hiddenFromBilling: previous };
            setPlans((prev) => {
                const next = prev.map((p) => (p.id === reverted.id ? reverted : p));
                writeCachedPlansList(next);
                return next;
            });
            setSelectedPlan((prev) => (prev?.id === reverted.id ? reverted : prev));
            toast({
                variant: "destructive",
                title: "Visibility save failed",
                description: e instanceof Error ? e.message : String(e),
            });
        }
    };

    const filteredPlans = useMemo(() => {
        return plans.filter(plan =>
            plan.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            plan.tagline.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [plans, searchTerm]);

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-6 h-full p-6">
                <div>
                    <Skeleton className="h-12 w-full mb-4" />
                    <Skeleton className="h-20 w-full mb-2" />
                    <Skeleton className="h-20 w-full mb-2" />
                </div>
                <div>
                     <Skeleton className="h-full w-full" />
                </div>
            </div>
        )
    }

    return (
        <div className="h-full p-6 space-y-4">
            <BillingRegionalSettings />
            <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-6 h-full min-h-0">
                <div className="flex flex-col h-full min-h-0 gap-4">
                    {missingPlansDoc && (
                        <Card className="shrink-0 border-amber-500/50 bg-amber-500/5">
                            <CardHeader className="py-3">
                                <CardTitle className="text-sm">No `app_settings/plans` on server</CardTitle>
                                <CardDescription className="text-xs">
                                    Showing cached or bundled data only. Page refresh will not upload defaults anymore — use Download (server) or create once below.
                                </CardDescription>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-2 w-fit"
                                    disabled={seedBusy || !user}
                                    onClick={handleCreateDefaultPlansDocOnce}
                                >
                                    {seedBusy ? "Working…" : "Create default plans in Firestore (one-time)"}
                                </Button>
                            </CardHeader>
                        </Card>
                    )}
                    <Card className="shrink-0 pl-chrome-card pl-chrome-tone-emerald">
                        <CardHeader>
                            <CardTitle>Subscription Plans</CardTitle>
                            <CardDescription>Select a plan to view and edit its details.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search by name or tagline..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>
                    <div className="flex-1 min-h-0">
                        <PlanList
                            plans={filteredPlans}
                            selectedPlan={selectedPlan}
                            onSelectPlan={handleSelectPlan}
                            onlineDemo={onlineDemo}
                            onSaveOnlineDemo={handleSaveOnlineDemo}
                            deviceUserAddOns={deviceUserAddOns}
                            onSaveDeviceUserAddOns={handleSaveDeviceUserAddOns}
                            onTogglePlanBillingVisibility={handleTogglePlanBillingVisibility}
                        />
                    </div>
                </div>
                <div className="h-full min-h-0 overflow-hidden">
                    {selectedPlan ? (
                        <PlanDetails plan={selectedPlan} onSave={handleUpdateAndSave} />
                    ): (
                        <Card className="h-full flex items-center justify-center">
                            <CardContent className="text-center">
                                <p className="text-muted-foreground">No plan selected.</p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    )
}
