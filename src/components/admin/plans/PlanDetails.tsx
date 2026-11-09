
"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useState, useEffect, useMemo, useRef, type ComponentProps } from "react";
import { doc, Timestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Calendar as CalendarIcon, Info } from "lucide-react";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { type Plan, type EntitlementKey, ONLINE_ENTITLEMENT_CAP_KEYS } from "@/config/plans";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBillingCatalogBase } from "@/hooks/useBillingCatalogBase";
import { BILLING_REGION_IDS, BILLING_REGIONS, type BillingRegionId } from "@/lib/billingRegions";
import {
    getNepalMarkupBaseAmounts,
    regionalPriceWithMarkup,
    type RegionalPlanPrice,
} from "@/lib/billingRegionalPricing";
import { convertWithFxRates, roundMoneyForCurrency } from "@/lib/liveFxRates";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";

/** Online column caps — "Allow online" off par sab 0. */
interface PlanDetailsProps {
    plan: Plan;
    onSave: (updatedPlan: Plan) => Promise<boolean>;
}

/** Blue (i) — click/tap se rule dikhe (hover-only tooltip mobile par miss ho jata hai). */
function PlanRuleInfo({ tip }: { tip: string }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <AppFreshInfoButton size="xs" aria-label="Rule" />
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="max-w-xs text-left text-xs leading-snug" data-pl-intro="">
                {tip}
            </PopoverContent>
        </Popover>
    );
}

const REGIONAL_PRICES_RULE =
    "Nepal is the base regional price in the catalog currency. SAARC and International use Markup % on Nepal’s monthly and yearly amounts (not on the top Monthly/Yearly fields alone). Changing Nepal or a region’s Markup % auto-fills that region’s Monthly and Yearly (those two fields stay read-only). Apply today’s FX fills all three regions from live FX rates.";

const REGIONAL_MARKUP_RULE =
    "Markup % = extra on Nepal’s price. Formula: Nepal amount × (1 + Markup% ÷ 100). Example: Nepal monthly Rs. 500 and Markup 15% → Monthly Rs. 575. Same for yearly. Leave blank or 0 for no markup (same as Nepal).";

/** Amount input — catalog base country ka symbol prefix. */
function AmountInput({
    symbol,
    className,
    ...props
}: ComponentProps<typeof Input> & { symbol: string }) {
    return (
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground pointer-events-none">
                {symbol}
            </span>
            <Input className={cn("pl-9", className)} {...props} />
        </div>
    );
}

const entitlementLabels: Partial<Record<EntitlementKey, string>> = {
    allowCompanyAdminRecycleBin: "Allow Restore Company",
    canAddAvatar: "Can add avatar (Profile & Company logo)",
    canAddFileImagePdf: "Can add file (image/PDF) on vouchers",
    interCompanyVoucherEnabled: "Inter-company voucher",
    maxInterCompanyPartners: "Max joined inter-company partners",
    shareForReconciliationEnabled: "Share for Reconciling (cross-user ledger match)",
    masterAccountFreezeEnabled: "Freeze master account (party / bank / staff / tax / expense)",
    ocrVoucherAutofillEnabled: "OCR (bill scan autofill in Add Voucher)",
    maxReconciliationLedgers: "Max reconciliation ledgers per user",
    savedAccountSwitchEnabled: "Saved account switch (APK/EXE quick login)",
    attachmentBackupRestoreEnabled: "Attachment backup & restore (embed files in .plbp)",
    allowFirebaseOnlineCompanies: "Online company (Firebase / Firestore sync)",
    googleDriveSyncEnabled: "Google Drive sync",
    maxGoogleDriveSyncCompanies: "Max Google Drive sync companies",
    maxGoogleDriveSyncUsers: "Google Drive users",
};

export function PlanDetails({ plan, onSave }: PlanDetailsProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    const { toast } = useToast();
    const [editablePlan, setEditablePlan] = useState<Plan>(plan);
    const { baseCountry, symbol: catalogSymbol, currencyCode: catalogCurrency } =
        useBillingCatalogBase();
    /** Untick Allow online → stash online caps; tick restores. */
    const onlineCapsSnapshotRef = useRef<Partial<Record<EntitlementKey, number>> | null>(null);

    useEffect(() => {
        setEditablePlan(plan);
        onlineCapsSnapshotRef.current = null;
    }, [plan]);

    // Catalog amounts = billing default region currency (Regional billing upar se)
    useEffect(() => {
        if (!catalogCurrency) return;
        setEditablePlan((prev) =>
            prev.currency === catalogCurrency ? prev : { ...prev, currency: catalogCurrency }
        );
    }, [catalogCurrency]);

    useEffect(() => {
        const monthly = editablePlan.price.monthly || 0;
        const yearly = editablePlan.price.yearly || 0;
        let newDiscount = 0;

        if (monthly > 0 && yearly > 0) {
            newDiscount = 100 - (yearly * 100) / (monthly * 12);
        }

        const currentDiscount = editablePlan.discountPercentage || 0;
        if (Math.abs(currentDiscount - newDiscount) > 0.01) {
             setEditablePlan(prev => ({
                ...prev,
                discountPercentage: parseFloat(newDiscount.toFixed(2))
            }));
        }
    }, [editablePlan.price.monthly, editablePlan.price.yearly]);

    // Nepal / plan base badle to SAARC/International % dubara calculate
    useEffect(() => {
        setEditablePlan((prev) => {
            let touched = false;
            const regionalPrices = { ...(prev.regionalPrices ?? {}) };
            const base = getNepalMarkupBaseAmounts(prev);
            for (const id of ["saarc", "international"] as const) {
                const row = regionalPrices[id];
                const pct = row?.markupPercent;
                if (pct == null || !Number.isFinite(Number(pct))) continue;
                const monthly = regionalPriceWithMarkup(base.monthly, pct);
                const yearly = regionalPriceWithMarkup(base.yearly, pct);
                if (row?.monthly === monthly && row?.yearly === yearly) continue;
                regionalPrices[id] = {
                    ...row,
                    monthly,
                    yearly,
                    markupPercent: pct,
                    currency: BILLING_REGIONS[id].defaultCurrency,
                };
                touched = true;
            }
            return touched ? { ...prev, regionalPrices } : prev;
        });
    }, [
        editablePlan.price.monthly,
        editablePlan.price.yearly,
        editablePlan.regionalPrices?.nepal?.monthly,
        editablePlan.regionalPrices?.nepal?.yearly,
    ]);

    const compressKbRangeValidation = useMemo(() => {
        const e = editablePlan.entitlements;
        const readKb = (key: EntitlementKey) => {
            const v = e[key];
            const n = typeof v === "number" ? v : Number(v ?? 0);
            return Number.isFinite(n) ? n : 0;
        };
        const onlineMin = readKb("minCompressImageKb");
        const onlineMax = readKb("maxCompressImageKb");
        const localMin = readKb("minCompressImageKbLocal");
        const localMax = readKb("maxCompressImageKbLocal");
        const invalidOnline = onlineMin > 0 && onlineMax > 0 && onlineMax < onlineMin;
        const invalidLocal = localMin > 0 && localMax > 0 && localMax < localMin;
        return {
            invalid: invalidOnline || invalidLocal,
            onlineMinFloor: invalidOnline ? onlineMin : null,
            localMinFloor: invalidLocal ? localMin : null,
        };
    }, [editablePlan.entitlements]);

    const handleSave = async () => {
        if (compressKbRangeValidation.invalid) {
            toast({
                variant: "destructive",
                title: "Invalid compress range",
                description: `${[
                    compressKbRangeValidation.localMinFloor != null ? "Local company" : null,
                    compressKbRangeValidation.onlineMinFloor != null ? "Online company" : null,
                ]
                    .filter(Boolean)
                    .join(" and ")}: Min KB cannot be greater than Max KB.`
            });
            return;
        }
        setIsUpdating(true);
        const success = await onSave(editablePlan);
        if (success) {
            toast({ title: "Success", description: `Plan '${editablePlan.name}' updated.` });
        } else {
            toast({ variant: "destructive", title: "Error", description: "Failed to update plan." });
        }
        setIsUpdating(false);
    }
    
    const handleTopLevelChange = (key: keyof Plan, value: any) => {
        setEditablePlan(prev => ({ ...prev, [key]: value }));
    }

    const handleEntitlementChange = (key: EntitlementKey, value: string | number | boolean) => {
        setEditablePlan(prev => ({
            ...prev,
            entitlements: {
                ...prev.entitlements,
                [key]: value === '' ? 0 : value
            }
        }));
    };

    /** Untick → stash online caps then set 0; tick → restore stash (or leave zeros for admin to fill). */
    const allowOnline = editablePlan.entitlements.allowFirebaseOnlineCompanies === true;

    const handleAllowOnlineChange = (checked: boolean) => {
        setEditablePlan((prev) => {
            const nextEnt = { ...prev.entitlements };
            if (!checked) {
                const snap: Partial<Record<EntitlementKey, number>> = {};
                for (const key of ONLINE_ENTITLEMENT_CAP_KEYS) {
                    const v = nextEnt[key];
                    if (typeof v === "number" && Number.isFinite(v)) snap[key] = v;
                    nextEnt[key] = 0;
                }
                onlineCapsSnapshotRef.current = snap;
                nextEnt.allowFirebaseOnlineCompanies = false;
            } else {
                nextEnt.allowFirebaseOnlineCompanies = true;
                const snap = onlineCapsSnapshotRef.current;
                if (snap) {
                    for (const key of ONLINE_ENTITLEMENT_CAP_KEYS) {
                        if (typeof snap[key] === "number") nextEnt[key] = snap[key]!;
                    }
                }
            }
            return { ...prev, entitlements: nextEnt };
        });
    };
    
    const handlePriceChange = (cycle: 'monthly' | 'yearly', value: string) => {
        setEditablePlan(prev => ({
            ...prev,
            price: {
                ...prev.price,
                [cycle]: value === '' ? 0 : Number(value)
            }
        }));
    }

    /** Nepal / SAARC / International — admin alag monthly & yearly rate. */
    const handleRegionalPriceChange = (
        region: BillingRegionId,
        field: "monthly" | "yearly",
        value: string
    ) => {
        setEditablePlan((prev) => {
            const cur = prev.regionalPrices?.[region] ?? {
                monthly: 0,
                yearly: 0,
                currency: BILLING_REGIONS[region].defaultCurrency,
            };
            const nextRow: RegionalPlanPrice = { ...cur };
            // Sirf monthly/yearly numeric — currency/markup alag handlers
            nextRow[field] = value === "" ? 0 : Number(value);
            return {
                ...prev,
                regionalPrices: { ...prev.regionalPrices, [region]: nextRow },
            };
        });
    };

    /** SAARC / International — Nepal amount + markup % → monthly & yearly fill. */
    const handleRegionalMarkupChange = (region: "saarc" | "international", value: string) => {
        const pct = value === "" ? 0 : Number(value);
        setEditablePlan((prev) => {
            const base = getNepalMarkupBaseAmounts(prev);
            return {
                ...prev,
                regionalPrices: {
                    ...prev.regionalPrices,
                    [region]: {
                        monthly: regionalPriceWithMarkup(base.monthly, pct),
                        yearly: regionalPriceWithMarkup(base.yearly, pct),
                        markupPercent: pct,
                        currency: BILLING_REGIONS[region].defaultCurrency,
                    },
                },
            };
        });
    };

    const applyLiveFxToRegional = async () => {
        try {
            const base = String(editablePlan.currency || "NPR").toUpperCase();
            const res = await fetch(getBillingApiUrl(`/api/billing/fx-rates?base=${encodeURIComponent(base)}`));
            const data = (await res.json().catch(() => ({}))) as { error?: string; rates?: Record<string, number>; base?: string };
            if (!res.ok || !data.rates) throw new Error(data.error || "FX failed");
            const rates = data.rates;
            const fxBase = data.base as string;
            setEditablePlan((prev) => {
                const regionalPrices = { ...prev.regionalPrices } as NonNullable<Plan["regionalPrices"]>;
                for (const id of BILLING_REGION_IDS) {
                    const target = BILLING_REGIONS[id].defaultCurrency;
                    regionalPrices[id] = {
                        monthly: roundMoneyForCurrency(
                            convertWithFxRates(prev.price.monthly, base, target, fxBase, rates),
                            target
                        ),
                        yearly: roundMoneyForCurrency(
                            convertWithFxRates(prev.price.yearly, base, target, fxBase, rates),
                            target
                        ),
                        currency: target,
                    };
                }
                return { ...prev, regionalPrices };
            });
            toast({ title: "Applied", description: "Regional prices filled from today's FX." });
        } catch (e: unknown) {
            toast({
                variant: "destructive",
                title: "FX apply failed",
                description: e instanceof Error ? e.message : String(e),
            });
        }
    };

    // Har numeric cap do fields: online (Firestore) + local (SQLite / storageOption local) — admin alag se set kar sake.
    const pairedNumericEntitlements: {
      online: EntitlementKey;
      local: EntitlementKey;
      onlineMin?: EntitlementKey;
      localMin?: EntitlementKey;
      label: string;
      tip: string;
      uiVariant?: "compressKb";
    }[] = [
      {
        online: "maxUsers",
        local: "maxUsersLocal",
        label: "Max users",
        tip: "0 = no users for that bucket; -1 = unlimited. Online = cloud company; Local = device/SQLite company.",
      },
      {
        online: "maxCompanies",
        local: "maxCompaniesLocal",
        label: "Max companies",
        tip: "0 = no companies for that bucket; -1 = unlimited. Does not change max online-upload slots separately.",
      },
      {
        online: "maxAttachmentsGB",
        local: "maxAttachmentsGBLocal",
        label: "Max attachments (GB)",
        tip: "0 = no attachment storage; -1 = unlimited GB for Online or Local.",
      },
      {
        online: "maxCompressImageKb",
        local: "maxCompressImageKbLocal",
        onlineMin: "minCompressImageKb",
        localMin: "minCompressImageKbLocal",
        label: "File Compress size range (KB)",
        tip: "From–To: compressed image stays in this KB band. 0 = platform default (Online 50–100, Local 50–150). Example: From 30 To 35 → output ~30–35 KB. Online = cloud and Pocket Ledger Server (PocketBase) companies; Offline/Local = device-local, Drive and local-gate companies. Output never goes below From unless the source image is already smaller. Editable even when Allow online is OFF.",
        uiVariant: "compressKb",
      },
      {
        online: "maxStorageGB",
        local: "maxStorageGBLocal",
        label: "Max storage (GB)",
        tip: "0 = no total storage; -1 = unlimited GB for Online or Local.",
      },
      {
        online: "dailyVoucherLimit",
        local: "dailyVoucherLimitLocal",
        label: "Daily voucher limit",
        tip: "0 = no vouchers that day; -1 = unlimited; positive = hard daily cap.",
      },
      {
        online: "monthlyVoucherLimit",
        local: "monthlyVoucherLimitLocal",
        label: "Monthly voucher limit",
        tip: "0 = no vouchers that month; -1 = unlimited; positive = hard monthly cap.",
      },
      // Multi-device switch off = dono 1; on = online/local alag caps (billing chart rows).
      {
        online: "maxDevices",
        local: "maxDevicesLocal",
        label: "Max devices",
        tip: "0 = no extra devices; -1 = unlimited when Multi-Device Sync is ON. Sync OFF forces both sides to 1.",
      },
    ];
    const entitlementBooleanFields: EntitlementKey[] = [
        "hasPrioritySupport",
        "hasAuditLogs",
        "hasRoleBasedAccess",
        "allowCompanyAdminRecycleBin",
        "canAddAvatar",
        "savedAccountSwitchEnabled",
        "attachmentBackupRestoreEnabled",
    ];

    const offerDate = editablePlan.limitedTimeOfferDate ? 
        (editablePlan.limitedTimeOfferDate.toDate ? editablePlan.limitedTimeOfferDate.toDate() : new Date(editablePlan.limitedTimeOfferDate))
        : undefined;

    return (
        <Card className="h-full min-h-0 overflow-hidden relative flex flex-col pl-chrome-card pl-chrome-tone-emerald">
             {isUpdating && (
                <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            )}
            <CardHeader className="shrink-0 flex flex-row items-start justify-between">
                <div>
                    <CardTitle>{editablePlan.name}</CardTitle>
                    <CardDescription>{editablePlan.tagline}</CardDescription>
                </div>
                 <div className="flex items-center gap-4">
                    <div className="space-y-1">
                        <Label className="text-xs">Commission Rate (%)</Label>
                        <Input
                            type="number"
                            value={editablePlan.commissionRate ?? ''}
                            onChange={(e) => handleTopLevelChange('commissionRate', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-24 h-9"
                        />
                    </div>
                    <Button
                        onClick={handleSave}
                        disabled={isUpdating || compressKbRangeValidation.invalid}
                        className="self-end"
                    >
                        <Save className="mr-2 h-4 w-4" /> Save Changes
                    </Button>
                </div>
            </CardHeader>

            <ScrollArea className="flex-1 min-h-0">
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 items-end">
                        <div className="space-y-2 md:col-span-2 xl:col-span-5">
                            <Label>Base country (catalog)</Label>
                            <div
                                className="flex h-10 w-full items-center rounded-md border border-input bg-muted/60 px-3 py-2 text-sm font-medium"
                                aria-readonly="true"
                            >
                                {baseCountry} · {catalogSymbol}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Set in <strong>Default billing region</strong> above — all amounts use {catalogSymbol}.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Monthly Price ({catalogSymbol})</Label>
                            <AmountInput
                                symbol={catalogSymbol}
                                type="number"
                                value={editablePlan.price.monthly}
                                onChange={(e) => handlePriceChange("monthly", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Yearly Price ({catalogSymbol})</Label>
                            <AmountInput
                                symbol={catalogSymbol}
                                type="number"
                                value={editablePlan.price.yearly}
                                onChange={(e) => handlePriceChange("yearly", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Discount (%)</Label>
                            <Input 
                                type="number" 
                                value={editablePlan.discountPercentage || ''} 
                                readOnly
                                className="bg-muted cursor-not-allowed"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Offer End Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                    variant={"outline"}
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !offerDate && "text-muted-foreground"
                                    )}
                                    >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {offerDate ? format(offerDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                    mode="single"
                                    selected={offerDate}
                                    onSelect={(date) => handleTopLevelChange('limitedTimeOfferDate', date ? Timestamp.fromDate(date) : null)}
                                    initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id={`isFree-${plan.id}`}
                                checked={editablePlan.isFree}
                                onCheckedChange={(checked) => handleTopLevelChange('isFree', checked)}
                            />
                            <Label htmlFor={`isFree-${plan.id}`}>Mark as Free Plan</Label>
                        </div>
                    </div>

                    <div className="space-y-3 rounded-lg border border-slate-200/80 p-4 bg-muted/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm flex items-center gap-1.5">
                                <span>
                                    Regional prices (Nepal · SAARC · International) — {catalogSymbol}
                                </span>
                                <PlanRuleInfo tip={REGIONAL_PRICES_RULE} />
                            </h3>
                            <Button type="button" variant="outline" size="sm" onClick={() => void applyLiveFxToRegional()}>
                                Apply today&apos;s FX to all 3
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {BILLING_REGION_IDS.map((regionId) => {
                                const row = editablePlan.regionalPrices?.[regionId];
                                const meta = BILLING_REGIONS[regionId];
                                const isMarkupRegion =
                                    regionId === "saarc" || regionId === "international";
                                return (
                                    <div key={regionId} className="space-y-2 rounded-md border border-slate-200/70 bg-background p-3">
                                        <div className="flex items-center gap-1.5">
                                            <Label className="font-semibold">{meta.label}</Label>
                                            {regionId === "nepal" ? (
                                                <PlanRuleInfo tip="Base region for regional pricing. Edit Monthly and Yearly here; SAARC and International Markup % apply on these Nepal amounts." />
                                            ) : null}
                                        </div>
                                        {isMarkupRegion && (
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5">
                                                    <Label className="text-xs">Markup %</Label>
                                                    <PlanRuleInfo tip={REGIONAL_MARKUP_RULE} />
                                                </div>
                                                <div className="relative">
                                                    <Input
                                                        type="number"
                                                        className="pr-8"
                                                        placeholder="0"
                                                        value={row?.markupPercent ?? ""}
                                                        onChange={(e) =>
                                                            handleRegionalMarkupChange(
                                                                regionId,
                                                                e.target.value
                                                            )
                                                        }
                                                    />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                                                        %
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        <div className="space-y-1">
                                            <Label className="text-xs">Monthly ({catalogSymbol})</Label>
                                            <AmountInput
                                                symbol={catalogSymbol}
                                                type="number"
                                                readOnly={isMarkupRegion}
                                                className={isMarkupRegion ? "bg-muted cursor-default" : undefined}
                                                value={row?.monthly ?? ""}
                                                onChange={(e) => {
                                                    if (!isMarkupRegion) {
                                                        handleRegionalPriceChange(regionId, "monthly", e.target.value);
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Yearly ({catalogSymbol})</Label>
                                            <AmountInput
                                                symbol={catalogSymbol}
                                                type="number"
                                                readOnly={isMarkupRegion}
                                                className={isMarkupRegion ? "bg-muted cursor-default" : undefined}
                                                value={row?.yearly ?? ""}
                                                onChange={(e) => {
                                                    if (!isMarkupRegion) {
                                                        handleRegionalPriceChange(regionId, "yearly", e.target.value);
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="md:col-span-2 lg:col-span-3 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                        <Info
                            data-pl-plan-rule-info=""
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500"
                            strokeWidth={2.5}
                            aria-hidden
                        />
                        <p>
                            <span className="font-medium">Rule:</span> for number caps,{" "}
                            <span className="font-semibold">0 = none / not allowed</span>,{" "}
                            <span className="font-semibold">-1 = unlimited</span>, positive = hard cap
                            (unless the field is off with its switch).
                            Click any blue (i) for the field-specific rule. Online = cloud company; Local = device/SQLite.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 lg:col-span-3">
                        <Switch
                            id={`${plan.id}-allow-online`}
                            checked={allowOnline}
                            onCheckedChange={(checked) => handleAllowOnlineChange(checked === true)}
                        />
                        <Label htmlFor={`${plan.id}-allow-online`} className="flex-1">
                            Allow online
                        </Label>
                        <PlanRuleInfo tip="ON keeps Online caps editable. OFF sets every Online cap to 0 (users, companies, storage, vouchers, devices, online slots, local→cloud MB) so you need not clear each field." />
                    </div>
                    {pairedNumericEntitlements.map(({ online, local, onlineMin, localMin, label, tip, uiVariant }) => {
                        const onlineVal = editablePlan.entitlements[online];
                        const localVal = editablePlan.entitlements[local];
                        const onlineNum = typeof onlineVal === "number" ? onlineVal : Number(onlineVal ?? 0);
                        const localNum = typeof localVal === "number" ? localVal : Number(localVal ?? 0);
                        const onlineMinVal = onlineMin ? editablePlan.entitlements[onlineMin] : 0;
                        const localMinVal = localMin ? editablePlan.entitlements[localMin] : 0;
                        const onlineMinNum = typeof onlineMinVal === "number" ? onlineMinVal : Number(onlineMinVal ?? 0);
                        const localMinNum = typeof localMinVal === "number" ? localMinVal : Number(localMinVal ?? 0);
                        const isMaxDevicesPair = online === "maxDevices" && local === "maxDevicesLocal";
                        const pairDisabled = isMaxDevicesPair && !editablePlan.entitlements.hasMultiDeviceSync;
                        const isCompressKb = uiVariant === "compressKb";
                        // Compress KB band is independent of Allow online (not an online company cap).
                        const onlineDisabled = isCompressKb ? false : !allowOnline || pairDisabled;
                        const parseCompressKb = (raw: string) => {
                            if (raw === "") return 0;
                            const n = parseInt(raw, 10);
                            if (!Number.isFinite(n) || n < 0) return 0;
                            return n;
                        };
                        const handleCompressRangeChange = (
                            minKey: EntitlementKey,
                            maxKey: EntitlementKey,
                            side: "min" | "max",
                            raw: string
                        ) => {
                            const value = parseCompressKb(raw);
                            setEditablePlan((prev) => ({
                                ...prev,
                                entitlements: {
                                    ...prev.entitlements,
                                    [side === "min" ? minKey : maxKey]: value,
                                },
                            }));
                        };
                        const compressInputCn =
                            "h-7 min-h-7 max-h-7 w-10 min-w-[2.25rem] flex-1 max-w-[3.25rem] px-1.5 py-0 text-xs text-center shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none";
                        const compressChipCn =
                            "flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-[11px] font-medium leading-none";
                        return (
                            <div
                                key={`${online}-${local}`}
                                className="rounded-lg border bg-card/50 p-2.5 space-y-2 md:col-span-1 min-w-0"
                            >
                                <div className="flex items-center gap-1.5 text-sm font-medium">
                                    <span>{label}</span>
                                    <PlanRuleInfo tip={tip} />
                                </div>
                                {uiVariant === "compressKb" && onlineMin && localMin ? (
                                    <div className="space-y-1.5">
                                        <div className="flex w-full min-w-0 items-start gap-1">
                                            <Input
                                                id={`${plan.id}-${onlineMin}`}
                                                type="number"
                                                min={0}
                                                value={String(Number.isFinite(onlineMinNum) ? onlineMinNum : 0)}
                                                onChange={(e) =>
                                                    handleCompressRangeChange(onlineMin, online, "min", e.target.value)
                                                }
                                                placeholder="50"
                                                data-pl-compress-online-min=""
                                                aria-label="Compress from KB online"
                                                className={compressInputCn}
                                            />
                                            <span className="mt-1.5 shrink-0 text-[10px] text-muted-foreground">–</span>
                                            <div className="flex min-w-0 flex-1 flex-col items-center">
                                                <Input
                                                    id={`${plan.id}-${online}`}
                                                    type="number"
                                                    min={0}
                                                    value={String(Number.isFinite(onlineNum) ? onlineNum : 0)}
                                                    onChange={(e) =>
                                                        handleCompressRangeChange(onlineMin, online, "max", e.target.value)
                                                    }
                                                    placeholder="100"
                                                    data-pl-compress-online-max=""
                                                    aria-label="Compress to KB online"
                                                    aria-invalid={compressKbRangeValidation.onlineMinFloor != null}
                                                    className={cn(
                                                        compressInputCn,
                                                        compressKbRangeValidation.onlineMinFloor != null &&
                                                            "border-destructive focus-visible:ring-destructive"
                                                    )}
                                                />
                                                {compressKbRangeValidation.onlineMinFloor != null ? (
                                                    <p className="mt-0.5 w-full text-center text-[10px] leading-tight text-destructive">
                                                        must be Morethan {compressKbRangeValidation.onlineMinFloor}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <span className={cn(compressChipCn, "mt-0 w-8 bg-muted/60 text-muted-foreground")}>
                                                KB
                                            </span>
                                            <span className={cn(compressChipCn, "mt-0 w-[3.75rem] border-blue-200 bg-blue-50/80 text-blue-900")}>
                                                Online
                                            </span>
                                        </div>
                                        <div className="flex w-full min-w-0 items-start gap-1">
                                            <Input
                                                id={`${plan.id}-${localMin}`}
                                                type="number"
                                                min={0}
                                                value={String(Number.isFinite(localMinNum) ? localMinNum : 0)}
                                                onChange={(e) =>
                                                    handleCompressRangeChange(localMin, local, "min", e.target.value)
                                                }
                                                placeholder="50"
                                                disabled={pairDisabled}
                                                aria-label="Compress from KB offline"
                                                className={compressInputCn}
                                            />
                                            <span className="mt-1.5 shrink-0 text-[10px] text-muted-foreground">–</span>
                                            <div className="flex min-w-0 flex-1 flex-col items-center">
                                                <Input
                                                    id={`${plan.id}-${local}`}
                                                    type="number"
                                                    min={0}
                                                    value={String(Number.isFinite(localNum) ? localNum : 0)}
                                                    onChange={(e) =>
                                                        handleCompressRangeChange(localMin, local, "max", e.target.value)
                                                    }
                                                    placeholder="150"
                                                    disabled={pairDisabled}
                                                    aria-label="Compress to KB offline"
                                                    aria-invalid={compressKbRangeValidation.localMinFloor != null}
                                                    className={cn(
                                                        compressInputCn,
                                                        compressKbRangeValidation.localMinFloor != null &&
                                                            "border-destructive focus-visible:ring-destructive"
                                                    )}
                                                />
                                                {compressKbRangeValidation.localMinFloor != null ? (
                                                    <p className="mt-0.5 w-full text-center text-[10px] leading-tight text-destructive">
                                                        must be Morethan {compressKbRangeValidation.localMinFloor}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <span className={cn(compressChipCn, "mt-0 w-8 bg-muted/60 text-muted-foreground")}>
                                                KB
                                            </span>
                                            <span className={cn(compressChipCn, "mt-0 w-[3.75rem] border-blue-200 bg-blue-50/80 text-blue-900")}>
                                                Offline
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-${online}`}>Online</Label>
                                            <Input
                                                id={`${plan.id}-${online}`}
                                                type="number"
                                                value={String(Number.isFinite(onlineNum) ? onlineNum : 0)}
                                                onChange={(e) => {
                                                    const raw = e.target.value;
                                                    handleEntitlementChange(online, raw === "" ? 0 : Number(raw));
                                                }}
                                                placeholder="-1 = unlimited"
                                                disabled={onlineDisabled}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-${local}`}>Local</Label>
                                            <Input
                                                id={`${plan.id}-${local}`}
                                                type="number"
                                                value={String(Number.isFinite(localNum) ? localNum : 0)}
                                                onChange={(e) => {
                                                    const raw = e.target.value;
                                                    handleEntitlementChange(local, raw === "" ? 0 : Number(raw));
                                                }}
                                                placeholder="-1 = unlimited"
                                                disabled={pairDisabled}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    
                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2">
                        <Switch
                            id={`${plan.id}-hasMultiDeviceSync`}
                            checked={!!editablePlan.entitlements.hasMultiDeviceSync}
                            onCheckedChange={(checked) => {
                                handleEntitlementChange('hasMultiDeviceSync', checked);
                                const dOnRaw = Number(editablePlan.entitlements.maxDevices);
                                const dLocRaw = Number(editablePlan.entitlements.maxDevicesLocal);
                                const dOn = Number.isFinite(dOnRaw) && dOnRaw !== 0 ? dOnRaw : 1;
                                const dLoc = Number.isFinite(dLocRaw) && dLocRaw !== 0 ? dLocRaw : 1;
                                if (!checked) {
                                    handleEntitlementChange('maxDevices', 1);
                                    handleEntitlementChange('maxDevicesLocal', 1);
                                } else {
                                    // Preserve -1 (unlimited) when turning sync back on.
                                    if (dOn < 0 || dLoc < 0) {
                                        handleEntitlementChange('maxDevices', -1);
                                        handleEntitlementChange('maxDevicesLocal', -1);
                                    } else {
                                        const next = Math.max(dOn, dLoc) <= 1 ? 3 : Math.max(dOn, dLoc);
                                        handleEntitlementChange('maxDevices', next);
                                        handleEntitlementChange('maxDevicesLocal', next);
                                    }
                                }
                            }}
                        />
                        <Label htmlFor={`${plan.id}-hasMultiDeviceSync`} className="flex-1">Multi-Device Sync</Label>
                        <PlanRuleInfo tip="OFF forces Max devices Online and Local to 1. ON unlocks device caps (0 = none; -1 = unlimited)." />
                    </div>

                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 flex-wrap">
                        <Switch
                            id={`${plan.id}-canAddFileImagePdf`}
                            checked={!!editablePlan.entitlements.canAddFileImagePdf}
                            onCheckedChange={(checked) => {
                                handleEntitlementChange('canAddFileImagePdf', checked);
                                if (!checked) {
                                    handleEntitlementChange('maxVoucherFileCount', 0);
                                } else if ((editablePlan.entitlements.maxVoucherFileCount as number) <= 0) {
                                    handleEntitlementChange('maxVoucherFileCount', 3);
                                }
                            }}
                        />
                        <Label htmlFor={`${plan.id}-canAddFileImagePdf`} className="flex-1">{entitlementLabels.canAddFileImagePdf}</Label>
                        <PlanRuleInfo tip="OFF clears Max files (0 = no files). ON allows 1–10 files per voucher." />
                        {editablePlan.entitlements.canAddFileImagePdf && (
                            <div className="flex items-center gap-2">
                                <Label htmlFor={`${plan.id}-maxVoucherFileCount`} className="text-sm whitespace-nowrap">Max files per voucher</Label>
                                <Input
                                    id={`${plan.id}-maxVoucherFileCount`}
                                    type="number"
                                    min={1}
                                    max={10}
                                    className="w-20 h-8"
                                    value={Math.max(0, Math.min(10, Number(editablePlan.entitlements.maxVoucherFileCount) || 0))}
                                    onChange={(e) => handleEntitlementChange('maxVoucherFileCount', Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0)))}
                                />
                            </div>
                        )}
                    </div>

                    <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-emerald-300 bg-emerald-50/50 p-3 space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Switch
                                id={`${plan.id}-googleDriveSyncEnabled`}
                                checked={!!editablePlan.entitlements.googleDriveSyncEnabled}
                                onCheckedChange={(checked) => {
                                    handleEntitlementChange("googleDriveSyncEnabled", checked);
                                    if (!checked) {
                                        handleEntitlementChange("maxGoogleDriveSyncCompanies", 0);
                                        handleEntitlementChange("maxGoogleDriveSyncUsers", 0);
                                    } else {
                                        if (Number(editablePlan.entitlements.maxGoogleDriveSyncCompanies ?? 0) <= 0) {
                                            handleEntitlementChange("maxGoogleDriveSyncCompanies", 1);
                                        }
                                        if (Number(editablePlan.entitlements.maxGoogleDriveSyncUsers ?? 0) <= 0) {
                                            handleEntitlementChange("maxGoogleDriveSyncUsers", 1);
                                        }
                                    }
                                }}
                            />
                            <Label htmlFor={`${plan.id}-googleDriveSyncEnabled`} className="flex-1">
                                {entitlementLabels.googleDriveSyncEnabled}
                            </Label>
                            <PlanRuleInfo tip="Set the Google Drive sync entitlement for this plan. The limits below use 0 = none, -1 = unlimited." />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Google Drive sync is separate from Firebase online sync. Company count is per owner account; user count is owner + Drive-shared users for each synced local company.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor={`${plan.id}-maxGoogleDriveSyncCompanies`} className="text-xs text-muted-foreground">
                                    {entitlementLabels.maxGoogleDriveSyncCompanies}
                                </Label>
                                <Input
                                    id={`${plan.id}-maxGoogleDriveSyncCompanies`}
                                    type="number"
                                    min={-1}
                                    value={String(Number(editablePlan.entitlements.maxGoogleDriveSyncCompanies ?? 0))}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        handleEntitlementChange(
                                            "maxGoogleDriveSyncCompanies",
                                            !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                        );
                                    }}
                                    placeholder="-1 = unlimited"
                                    disabled={!editablePlan.entitlements.googleDriveSyncEnabled}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor={`${plan.id}-maxGoogleDriveSyncUsers`} className="text-xs text-muted-foreground">
                                    {entitlementLabels.maxGoogleDriveSyncUsers}
                                </Label>
                                <Input
                                    id={`${plan.id}-maxGoogleDriveSyncUsers`}
                                    type="number"
                                    min={-1}
                                    value={String(Number(editablePlan.entitlements.maxGoogleDriveSyncUsers ?? 0))}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        handleEntitlementChange(
                                            "maxGoogleDriveSyncUsers",
                                            !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                        );
                                    }}
                                    placeholder="-1 = unlimited"
                                    disabled={!editablePlan.entitlements.googleDriveSyncEnabled}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                            <Switch
                                id={`${plan.id}-masterAccountFreezeEnabled`}
                                checked={!!editablePlan.entitlements.masterAccountFreezeEnabled}
                                onCheckedChange={(checked) => {
                                    handleEntitlementChange("masterAccountFreezeEnabled", checked);
                                }}
                            />
                            <Label htmlFor={`${plan.id}-masterAccountFreezeEnabled`} className="text-sm">
                                {entitlementLabels.masterAccountFreezeEnabled}
                            </Label>
                            <PlanRuleInfo tip="When enabled, users with Freeze Master Account permission can lock party, bank, staff, or tax accounts." />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                            <Switch
                                id={`${plan.id}-ocrVoucherAutofillEnabled`}
                                checked={editablePlan.entitlements.ocrVoucherAutofillEnabled !== false}
                                onCheckedChange={(checked) => {
                                    handleEntitlementChange("ocrVoucherAutofillEnabled", checked);
                                }}
                            />
                            <Label htmlFor={`${plan.id}-ocrVoucherAutofillEnabled`} className="text-sm">
                                {entitlementLabels.ocrVoucherAutofillEnabled}
                            </Label>
                            <PlanRuleInfo tip="Default ON for all plans. Off = OCR toggles, Refresh OCR and Find account are completely hidden for companies on this plan." />
                        </div>
                    </div>


                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                            <Switch
                                id={`${plan.id}-interCompanyVoucherEnabled`}
                                checked={!!editablePlan.entitlements.interCompanyVoucherEnabled}
                                onCheckedChange={(checked) => {
                                    handleEntitlementChange("interCompanyVoucherEnabled", checked);
                                }}
                            />
                            <Label htmlFor={`${plan.id}-interCompanyVoucherEnabled`} className="text-sm">
                                {entitlementLabels.interCompanyVoucherEnabled}
                            </Label>
                            <PlanRuleInfo tip="When enabled, Max joined partners: 0 = none; -1 = unlimited partner companies." />
                        </div>
                        <div className="flex items-center gap-2">
                            <Label
                                htmlFor={`${plan.id}-maxInterCompanyPartners`}
                                className="text-sm whitespace-nowrap"
                            >
                                {entitlementLabels.maxInterCompanyPartners}
                            </Label>
                            <Input
                                id={`${plan.id}-maxInterCompanyPartners`}
                                type="number"
                                min={-1}
                                className="w-24 h-8"
                                value={String(
                                    Number.isFinite(Number(editablePlan.entitlements.maxInterCompanyPartners))
                                        ? Number(editablePlan.entitlements.maxInterCompanyPartners)
                                        : 0
                                )}
                                onChange={(e) => {
                                    const n = parseInt(e.target.value, 10);
                                    handleEntitlementChange(
                                        "maxInterCompanyPartners",
                                        !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                    );
                                }}
                                placeholder="-1 = unlimited"
                                disabled={!editablePlan.entitlements.interCompanyVoucherEnabled}
                            />
                        </div>
                    </div>

                    {/* Attachment backup/restore + local→online MB — plan traffic control (0 = none; -1 = unlimited). */}
                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30 col-span-1 md:col-span-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-1">
                            <Switch
                                id={`${plan.id}-shareForReconciliationEnabled`}
                                checked={!!editablePlan.entitlements.shareForReconciliationEnabled}
                                onCheckedChange={(checked) => {
                                    handleEntitlementChange("shareForReconciliationEnabled", checked);
                                    if (!checked) handleEntitlementChange("maxReconciliationLedgers", 0);
                                }}
                            />
                            <Label htmlFor={`${plan.id}-shareForReconciliationEnabled`} className="text-sm">
                                {entitlementLabels.shareForReconciliationEnabled}
                            </Label>
                            <PlanRuleInfo tip="When enabled, Max reconciliation ledgers: 0 = none; -1 = unlimited ledgers per user." />
                        </div>
                        <div className="flex items-center gap-2">
                            <Label htmlFor={`${plan.id}-maxReconciliationLedgers`} className="text-sm whitespace-nowrap">
                                {entitlementLabels.maxReconciliationLedgers}
                            </Label>
                            <Input
                                id={`${plan.id}-maxReconciliationLedgers`}
                                type="number"
                                min={-1}
                                className="w-24 h-8"
                                value={String(Number(editablePlan.entitlements.maxReconciliationLedgers ?? 0))}
                                onChange={(e) => {
                                    const n = parseInt(e.target.value, 10);
                                    handleEntitlementChange(
                                        "maxReconciliationLedgers",
                                        !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                    );
                                }}
                                placeholder="-1 = unlimited"
                                disabled={!editablePlan.entitlements.shareForReconciliationEnabled}
                            />
                        </div>
                    </div>

                    <div className="md:col-span-2 lg:col-span-3 rounded-lg border bg-card/50 p-3 space-y-3">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                            <span>Attachment backup &amp; restore</span>
                            <PlanRuleInfo tip="Monthly backup/restore counts and Local→cloud MB: 0 = none; -1 = unlimited. Requires Attachment backup & restore switch ON for monthly caps." />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Monthly counts limit attachment-heavy .plbp export/import. Local→online MB caps one-time upload size when linking a local company to cloud. Use 0 for none, -1 for unlimited.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-maxAttachmentBackupPerMonth`}>
                                    Max attachment backups / month
                                </Label>
                                <Input
                                    id={`${plan.id}-maxAttachmentBackupPerMonth`}
                                    type="number"
                                    min={-1}
                                    value={String(Number(editablePlan.entitlements.maxAttachmentBackupPerMonth ?? 0))}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        handleEntitlementChange(
                                            "maxAttachmentBackupPerMonth",
                                            !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                        );
                                    }}
                                    placeholder="-1 = unlimited"
                                    disabled={!editablePlan.entitlements.attachmentBackupRestoreEnabled}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-maxAttachmentRestorePerMonth`}>
                                    Max attachment restores / month
                                </Label>
                                <Input
                                    id={`${plan.id}-maxAttachmentRestorePerMonth`}
                                    type="number"
                                    min={-1}
                                    value={String(Number(editablePlan.entitlements.maxAttachmentRestorePerMonth ?? 0))}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        handleEntitlementChange(
                                            "maxAttachmentRestorePerMonth",
                                            !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                        );
                                    }}
                                    placeholder="-1 = unlimited"
                                    disabled={!editablePlan.entitlements.attachmentBackupRestoreEnabled}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-maxLocalToOnlineAttachmentMB`}>
                                    Local → cloud max attachments (MB)
                                </Label>
                                <Input
                                    id={`${plan.id}-maxLocalToOnlineAttachmentMB`}
                                    type="number"
                                    min={-1}
                                    value={String(Number(editablePlan.entitlements.maxLocalToOnlineAttachmentMB ?? 0))}
                                    onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        handleEntitlementChange(
                                            "maxLocalToOnlineAttachmentMB",
                                            !Number.isFinite(n) ? 0 : n < 0 ? -1 : n
                                        );
                                    }}
                                    placeholder="-1 = unlimited"
                                    disabled={!allowOnline}
                                />
                            </div>
                        </div>
                    </div>

                    {entitlementBooleanFields.map((key) => {
                        const value = editablePlan.entitlements[key];
                        return (
                            <div key={key} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
                                <Switch
                                    id={`${plan.id}-${key}`}
                                    checked={!!value}
                                    onCheckedChange={(checked) => handleEntitlementChange(key, checked)}
                                />
                                <Label htmlFor={`${plan.id}-${key}`}>{entitlementLabels[key] || key.replace(/([A-Z])/g, ' $1').replace('Has ', '')}</Label>
                            </div>
                        )
                    })}
                </div>
                </CardContent>
            </ScrollArea>
        </Card>
    )
}
