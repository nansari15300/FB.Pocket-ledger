"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense, Fragment, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_PLANS,
  PlanId,
  Plan,
  formatPrice,
  EntitlementKey,
  normalizePlanIdForClient,
  planTierIndex,
  isUnlimitedEntitlementCap,
  isZeroEntitlementCap,
  isOnlineEntitlementCapKey,
  plansVisibleOnBillingPage,
} from "@/config/plans";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import KhaltiCheckout from "khalti-checkout-web";
import { Badge } from "@/components/ui/badge";
import { Check, Download, Loader2, Printer, X } from "lucide-react";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/plClientSession";
import { getBillingApiIdToken, getServerLoginBillingAuthHeader } from "@/lib/firebaseAuthForApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableFooter } from "@/components/ui/table";
import { format as formatDateFns } from "date-fns";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useCompany, type Company as CompanyRow } from "@/hooks/useCompany";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useBillingPolicyFlags } from "@/hooks/useBillingPolicyFlags";
import { useBillingStatementWhenFormatters } from "@/hooks/useBillingStatementWhenFormatters";
import { useDate } from "@/hooks/useDate";
import { useBillingRegionPricing } from "@/hooks/useBillingRegionPricing";
import { PlanPricingBreakdown, PlanPricingLineCell } from "@/components/billing/PlanPricingBreakdown";
import { BillingFeatureLabelWithInfo } from "@/components/billing/BillingFeatureInfoButton";
import { BillingAddOnPurchaseCard } from "@/components/billing/BillingAddOnPurchaseCard";
import {
  BillingRenewTermExplainDialog,
  billingTermOptionLabel,
} from "@/components/billing/BillingRenewTermExplainDialog";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";
import { readAccountPlanLocalCache, writeAccountPlanLocalCache } from "@/lib/accountPlanLocalCache";
import { getLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { AdBillingPointsCard } from "@/components/ads/AdBillingPointsCard";
import { CountrySearchCombobox } from "@/components/shared/CountrySearchCombobox";
import type { BillingRegionId } from "@/lib/billingRegions";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBsFromAD } from "@/lib/bs-date";
import {
  BILLING_TERM_OPTIONS,
  PLAN_CHANGE_ONLY_SELECT_OPTION,
  classifyPlanChange,
  grossPriceNpr,
  quoteDowngradeNewExpiry,
  quotePaidPlanPurchase,
  creditDaysEquivalentAtTargetYearly,
  renewColumnFrozenUsageAndCreditDaysLeft,
  usageNprAccruedSinceCurrentTierStart,
  upgradeTargetCreditDaysCarried,
  daysLeftRounded,
  daysLeftPrecise,
  remainingPaidTimeValueNpr,
  termDurationMs,
  type SubscriptionTermKey,
} from "@/lib/subscriptionPlanMath";
import { getBillingApiUrl, getLocalDevAwareBillingApiUrl } from "@/lib/billingApiOrigin";

/** Dev localhost: plan-change must hit local Next API (stackOnExpiry fix). Hosted still has old zero-net. */
function planChangeCheckoutApiUrl(): string {
  return getLocalDevAwareBillingApiUrl("/api/payments/plan-change-checkout");
}
import { downloadBillingStatementPdf, openBillingStatementPdfPreview } from "@/lib/billingStatementPdf";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import {
  defaultPlansListFallback,
  readCachedPlansList,
  writeCachedPlansList,
} from "@/lib/plansCatalogCache";
import {
  PRORATION_PILL_CREDIT_CLASS,
  PRORATION_PILL_USAGE_CLASS,
  PRORATION_PILL_USAGE_FROZEN_CLASS,
  creditPillAdjustedDayWord,
  formatCreditPillDaysLeftDisplay,
  formatUsageLineSuffix,
} from "@/lib/billingProrationPillDisplay";
import {
  findFrozenSnapshotForPlan,
  parseBillingFrozenPlanLedger,
  parseBillingDowngradeBlockedPlanIds,
} from "@/lib/billingFrozenPlanSnapshots";

/** Per-column price — regional amounts (admin Nepal/SAARC/International ya live FX). */
function formatTermPriceFromKey(
  plan: Plan,
  termKey: SubscriptionTermKey,
  formatPlanTermPrice: (p: Plan, t: SubscriptionTermKey) => string
): string {
  const line = formatPlanTermPrice(plan, termKey);
  const label = BILLING_TERM_OPTIONS.find((o) => o.value === termKey)?.label ?? termKey;
  if (!line || line === "Free") return plan.isFree ? "" : "Free";
  return `${line} (${label})`;
}

/** Free plan UI — list price line-through ke liye formatted amount. */
function formatFreePlanCrossedPrice(
  plan: Plan,
  termKey: SubscriptionTermKey,
  formatPlanTermPrice: (p: Plan, t: SubscriptionTermKey) => string
): string {
  return formatTermPriceFromKey(plan, termKey, formatPlanTermPrice);
}

/** Safe Date extractor for Firestore Timestamp / Date / millis / ISO values. */
function toSafeDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw != null && typeof (raw as { toDate?: () => Date }).toDate === "function") {
    const d = (raw as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Owner + same SKU: kisi bhi owned row se joined / tier-start ms — billing par doosri company `N/A` na rahe. */
function maxJoinedTierStartMsAmongOwnerPeers(
  ownerUid: string,
  planIdNorm: PlanId,
  peers: readonly CompanyRow[]
): number | null {
  let best: number | null = null;
  for (const p of peers) {
    if (String(p.ownerId ?? "").trim() !== ownerUid) continue;
    if (normalizePlanIdForClient(p.planId) !== planIdNorm) continue;
    const r = p as Record<string, unknown>;
    const fromTs = toSafeDate(r.planUpgradedAt)?.getTime();
    const fromMs = typeof r.planUpgradedAtMs === "number" && Number.isFinite(r.planUpgradedAtMs) ? r.planUpgradedAtMs : null;
    const fromJoined = toSafeDate(r.planJoinedAt)?.getTime();
    const fromCreated = toSafeDate(r.createdAt)?.getTime();
    const fromCreatedOn = toSafeDate(r.createdOn)?.getTime();
    const ms = [fromTs, fromMs, fromJoined, fromCreated, fromCreatedOn].find((x) => x != null && !Number.isNaN(x)) ?? null;
    if (ms != null && (best == null || ms > best)) best = ms;
  }
  return best;
}

/** Shared feature order for table, mobile cards, and PDF export.
 * Online block → thick separator → offline/local block → shared (both).
 */
const BILLING_FEATURES_ONLINE: { key: EntitlementKey; label: string }[] = [
  { key: "maxCompanies", label: "Max Companies (online)" },
  { key: "maxUsers", label: "Max Users (online)" },
  { key: "maxDevices", label: "Max devices (online)" },
  { key: "hasMultiDeviceSync", label: "Multi device sync" },
  { key: "dailyVoucherLimit", label: "Daily Vouchers (online)" },
  { key: "monthlyVoucherLimit", label: "Monthly Vouchers (online)" },
  { key: "maxAttachmentsGB", label: "Attachments GB (online)" },
  { key: "maxStorageGB", label: "Storage GB (online)" },
  { key: "maxLocalToOnlineAttachmentMB", label: "Local→cloud attachments (MB)" },
];

const BILLING_FEATURES_OFFLINE: { key: EntitlementKey; label: string }[] = [
  { key: "maxCompaniesLocal", label: "Max Companies (local)" },
  { key: "maxUsersLocal", label: "Max Users (local)" },
  { key: "maxDevicesLocal", label: "Max devices (local)" },
  { key: "dailyVoucherLimitLocal", label: "Daily Vouchers (local)" },
  { key: "monthlyVoucherLimitLocal", label: "Monthly Vouchers (local)" },
  { key: "maxAttachmentsGBLocal", label: "Attachments GB (local)" },
  { key: "maxStorageGBLocal", label: "Storage GB (local)" },
];

const BILLING_FEATURES_SHARED: { key: EntitlementKey; label: string }[] = [
  { key: "googleDriveSyncEnabled", label: "Google Drive sync" },
  { key: "maxGoogleDriveSyncCompanies", label: "Google Drive sync companies" },
  { key: "maxGoogleDriveSyncUsers", label: "Google Drive users" },
  { key: "maxAttachmentBackupPerMonth", label: "Attachment backups / month" },
  { key: "maxAttachmentRestorePerMonth", label: "Attachment restores / month" },
  { key: "hasRoleBasedAccess", label: "Role-based access" },
  { key: "hasAuditLogs", label: "Audit logs" },
  { key: "hasPrioritySupport", label: "Priority support" },
];

const BILLING_FEATURES: { key: EntitlementKey; label: string }[] = [
  ...BILLING_FEATURES_ONLINE,
  ...BILLING_FEATURES_OFFLINE,
  ...BILLING_FEATURES_SHARED,
];

/** Insert thick online/offline divider before this feature index. */
const BILLING_ONLINE_OFFLINE_SPLIT_INDEX = BILLING_FEATURES_ONLINE.length;
const BILLING_OFFLINE_FEATURES_END_INDEX =
  BILLING_ONLINE_OFFLINE_SPLIT_INDEX + BILLING_FEATURES_OFFLINE.length;

/** Max companies (online/local) None → that scope’s whole column block looks deactivated. */
function isBillingFeatureScopeDeactivated(featureIdx: number, onlineCompaniesOn: boolean, offlineCompaniesOn: boolean): boolean {
  if (featureIdx < BILLING_ONLINE_OFFLINE_SPLIT_INDEX) return !onlineCompaniesOn;
  if (featureIdx < BILLING_OFFLINE_FEATURES_END_INDEX) return !offlineCompaniesOn;
  return false;
}

const BILLING_SCOPE_DEACTIVATED_CELL_CLASS = "opacity-40 bg-muted/50 text-muted-foreground";
const BILLING_SCOPE_DEACTIVATED_ICON_CLASS = "text-muted-foreground opacity-70";

/** Billing table/mobile: ✓/✗ wale rows (hasMultiDeviceSync = "Multi device sync" alag row). */
const BILLING_BOOLEAN_ICON_KEYS: EntitlementKey[] = [
  "hasMultiDeviceSync",
  "hasRoleBasedAccess",
  "hasAuditLogs",
  "hasPrioritySupport",
  "attachmentBackupRestoreEnabled",
  "googleDriveSyncEnabled",
];

/** Bahar wale boxes: user ne “bold” maanga — `border-2` + thoda dark outline (patle 1.5px se zyada dikhe). */
const BILLING_OUTLINE_CLASS = "border-2 border-foreground/30";

/** Features column header — company vs account scope (English). */
const BILLING_FEATURES_SCOPE_NOTE_EN =
  "Per company: users, daily/monthly vouchers, attachment & storage GB, and registered devices apply to each company on this plan. Per owner account: max companies (online/local) is the total number of companies you may create. Table lists all online features first, then offline/local features (thick line in between).";

/** Khalti success_url may already include `?pendingId=` — append token/amount with `&` when needed. */
function withKhaltiProrationReturnParams(returnUrl: string, token: string, amount: number): string {
  const sep = returnUrl.includes("?") ? "&" : "?";
  return `${returnUrl}${sep}token=${encodeURIComponent(token)}&amount=${encodeURIComponent(String(amount))}`;
}

// Purana export naam — agar dev bundle / HMR ne `PRORATION_PILL_SPENDED_CLASS` rakha ho to ReferenceError na aaye.
const PRORATION_PILL_SPENDED_CLASS = PRORATION_PILL_USAGE_CLASS;

const MS_DAY_PRORATION = 86400000;

/** Dropdown term se kitne din add honge — total expiry (730) nahi, sirf is term ka block (e.g. 365). */
function termAddedDaysRounded(term: SubscriptionTermKey): number {
  return Math.round(termDurationMs(term) / MS_DAY_PRORATION);
}

/** Renew column Balance / Usage — already-bought time; must not move when term dropdown changes. */
function renewColumnLiveBalance(args: {
  nowMs: number;
  expiryMs: number | null;
  planYearly: number;
  remainingMs: number;
}): { balanceNpr: number; balanceDays: number } {
  return {
    balanceNpr: remainingPaidTimeValueNpr(args.remainingMs, args.planYearly),
    balanceDays: daysLeftPrecise(args.nowMs, args.expiryMs),
  };
}

/** Paid user + Basic column band: expiry ke baad auto Basic notice — current-plan “Switch to Basic” link bhi hata diya. */
function PaidPlanBasicColumnLockedNotice() {
  return (
    <div className="text-xs text-center text-muted-foreground leading-snug px-1">
      {/* `text-xs` (~12px) — pehle 10px tha; notice thoda bada padhne ke liye. */}
      <p>
        When your <strong className="text-foreground">paid plan expires</strong>, this company{" "}
        <strong className="text-foreground">automatically becomes Basic (free)</strong>, when the free plan is available.
      </p>
    </div>
  );
}

/** `/api/payments/gateway-status` — null = abhi load; tab tak radios enable (flash avoid). */
type BillingGatewayAvailability = { stripe: boolean; khalti: boolean; esewa: boolean };

function firstAvailableBillingGateway(
  ga: BillingGatewayAvailability | null,
  preferred: "stripe" | "khalti" | "esewa"
): "stripe" | "khalti" | "esewa" {
  if (!ga) return preferred;
  if (ga[preferred]) return preferred;
  for (const g of ["stripe", "khalti", "esewa"] as const) {
    if (ga[g]) return g;
  }
  return "stripe";
}

type CheckoutFormProps = {
  plan: Plan;
  termKey: SubscriptionTermKey;
  userId: string;
  companyId: string;
  /** Checkout region + formatter — server `/api/payments/initiate` ke saath match. */
  billingRegion: BillingRegionId;
  getCheckoutForPlan: (plan: Plan, termKey: SubscriptionTermKey) => {
    amountMinor: number;
    currency: string;
    gross: number;
    symbol: string;
  };
  /** false = subscribe API disabled — user ko “back online” copy. */
  networkOnline?: boolean;
  /** Server keys miss par gateway radio band — initiate route jaisa. */
  gatewayAvailability?: BillingGatewayAvailability | null;
};

/** Terms checkbox (left) + pay button — pay stays disabled until ticked. */
function BillingTermsAndPayRow({
  termsId,
  termsAccepted,
  onTermsAcceptedChange,
  payDisabled,
  onPay,
  payLabel,
  loading,
  buttonSize = "default",
  buttonClassName,
}: {
  termsId: string;
  termsAccepted: boolean;
  onTermsAcceptedChange: (accepted: boolean) => void;
  payDisabled?: boolean;
  onPay: () => void;
  payLabel: ReactNode;
  loading?: boolean;
  buttonSize?: "default" | "sm";
  buttonClassName?: string;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Checkbox
          id={termsId}
          checked={termsAccepted}
          onCheckedChange={(v) => onTermsAcceptedChange(v === true)}
          aria-label="Accept Terms and Conditions"
        />
        <Link
          href="/billing/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-normal leading-tight underline underline-offset-2 hover:text-foreground"
        >
          Terms &amp; Conditions
        </Link>
      </div>
      <Button
        type="button"
        size={buttonSize}
        className={cn("min-w-0 flex-1", buttonClassName)}
        disabled={payDisabled || !termsAccepted || !!loading}
        onClick={onPay}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : payLabel}
      </Button>
    </div>
  );
}

const AUTO_RENEW_TIP_STRIPE =
  "On: Stripe renews automatically with your saved card. Off: no auto-renew after this period — renew manually with pay with … on this page.";
const AUTO_RENEW_TIP_NO_SUB =
  "Subscribe with Stripe recurring billing first; one-time renewals here do not use this toggle.";

/** Blue (i) next to Auto renew — click shows On/Off help. */
function AutoRenewInfoButton({ hasStripeSubscription }: { hasStripeSubscription: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="xs"
          aria-label="About Auto renew"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-w-xs text-left text-xs leading-snug" data-pl-intro="">
        {hasStripeSubscription ? AUTO_RENEW_TIP_STRIPE : AUTO_RENEW_TIP_NO_SUB}
      </PopoverContent>
    </Popover>
  );
}

/** Paid renew/upgrade: how many days this term adds (stack on Balance). */
function billingTermStackTip(planName: string, term: SubscriptionTermKey): string {
  const days = termAddedDaysRounded(term);
  const dayWord = days === 1 ? "day" : "days";
  return `This term adds about ${days} ${dayWord} of ${planName} access. After payment, this time is added on top of the Balance days you already have left.`;
}

/** Free→paid subscribe: days from payment date. */
function billingNewSubscriberTermTip(planName: string, term: SubscriptionTermKey): string {
  const days = termAddedDaysRounded(term);
  const dayWord = days === 1 ? "day" : "days";
  return `On this term, new subscribers get about ${days} ${dayWord} of ${planName} access from the payment date.`;
}

function BillingTipInfoButton({ tip, ariaLabel }: { tip: string; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="xs"
          aria-label={ariaLabel}
          aria-expanded={open}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="z-[160] max-w-xs text-left text-xs leading-snug"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {tip}
      </PopoverContent>
    </Popover>
  );
}

/** Term dropdown with blue (i) inside the trigger row (left of chevron). */
function BillingTermSelectWithInfo({
  value,
  onValueChange,
  tip,
}: {
  value: SubscriptionTermKey;
  onValueChange: (v: SubscriptionTermKey) => void;
  tip: string;
}) {
  return (
    <div className="relative w-full">
      <Select value={value} onValueChange={(v) => onValueChange(v as SubscriptionTermKey)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Term" />
        </SelectTrigger>
        <SelectContent>
          {BILLING_TERM_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Outside SelectTrigger so overflow-hidden + Select click pe info miss na ho */}
      <div
        className="absolute right-8 top-1/2 z-20 -translate-y-1/2"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <BillingTipInfoButton tip={tip} ariaLabel="About this term" />
      </div>
    </div>
  );
}

function CheckoutForm({
  plan,
  termKey,
  userId,
  companyId,
  billingRegion,
  getCheckoutForPlan,
  networkOnline = true,
  gatewayAvailability = null,
}: CheckoutFormProps) {
  const [gateway, setGateway] = useState<"stripe" | "khalti" | "esewa">("stripe");
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    setGateway((prev) => firstAvailableBillingGateway(gatewayAvailability, prev));
  }, [gatewayAvailability]);
  const [isLoading, setIsLoading] = useState(false);

  if (plan.isFree) return null;

  const checkout = getCheckoutForPlan(plan, termKey);
  const amountInMinor = checkout.amountMinor;
  const checkoutCurrency = checkout.currency;
  const stripeOk = gatewayAvailability == null || gatewayAvailability.stripe;
  const khaltiOk = gatewayAvailability == null || gatewayAvailability.khalti;
  const esewaOk = gatewayAvailability == null || gatewayAvailability.esewa;

  async function handleCheckout() {
    if (!termsAccepted) {
      toast({
        variant: "destructive",
        title: "Accept Terms",
        description: "Tick Terms & Conditions before paying.",
      });
      return;
    }
    if (!networkOnline) {
      toast({
        variant: "destructive",
        title: "Offline",
        description: "Back online to subscribe.",
      });
      return;
    }
    if (amountInMinor <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid Amount",
        description: "Please choose a paid plan to proceed.",
      });
      return;
    }

    if (!userId.trim()) {
      toast({ variant: "destructive", title: "Sign in required", description: "Please log in to complete payment." });
      return;
    }
    setIsLoading(true);
    try {
      // Online-only: server route JSON; optional NEXT_PUBLIC_BILLING_API_ORIGIN for static shell → hosted API
      const res = await fetch(getBillingApiUrl("/api/payments/initiate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getServerLoginBillingAuthHeader()) },
        body: JSON.stringify({
          planId: plan.id,
          gateway,
          amount: amountInMinor,
          currency: checkoutCurrency,
          billingRegion,
          userId: userId.trim(),
          companyId: companyId.trim(),
          billingCycle: termKey === "monthly" ? "monthly" : "yearly",
          periodYears: (() => {
            const m = /^year_(\d+)$/.exec(termKey);
            return m != null ? Math.min(10, Math.max(1, parseInt(m[1], 10))) : 1;
          })(),
          subscriptionTermKey: termKey,
          billingIntent: "subscribe",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate payment.");
      }

      if (gateway === "stripe" && data.url) {
        window.location.assign(data.url);
      } else if (gateway === "khalti") {
        const khaltiConfig = {
          publicKey: data.publicKey,
          productIdentity: data.product_identity,
          productName: data.product_name,
          productUrl: window.location.href,
          amount: data.amount,
          eventHandler: {
            onSuccess(payload: any) {
              window.location.assign(`${data.returnUrl}?token=${payload.token}&amount=${payload.amount}`);
            },
            onError(error: any) {
              console.error(error);
              toast({ variant: "destructive", title: "Khalti Error", description: "Payment failed. Please try again." });
            },
            onClose() {
              console.log("Khalti widget closed.");
            },
          },
        };
        const checkout = new (KhaltiCheckout as any)(khaltiConfig);
        checkout.show({ amount: data.amount });
      } else if (gateway === "esewa") {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.url;

        const fields: Record<string, string> = {
          amount: data.amount,
          failure_url: data.failUrl,
          product_delivery_charge: "0",
          product_service_charge: "0",
          product_code: data.merchantCode,
          signature: data.signature,
          signed_field_names: data.signedFieldNames,
          success_url: data.successUrl,
          tax_amount: "0",
          total_amount: data.amount,
          transaction_uuid: data.oid,
        };

        for (const key of Object.keys(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = fields[key];
          form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      toast({ variant: "destructive", title: "Checkout Error", description: msg });
    } finally {
      setIsLoading(false);
    }
  }

  const gatewayBlocked =
    gatewayAvailability != null &&
    !(gateway === "stripe"
      ? gatewayAvailability.stripe
      : gateway === "khalti"
        ? gatewayAvailability.khalti
        : gatewayAvailability.esewa);

  const payLabel = `pay with ${gateway}`;

  return (
    <div className="mt-8 border-t pt-8">
      <h3 className="text-xl font-semibold mb-4">Select Payment Method</h3>
      <RadioGroup value={gateway} onValueChange={(val) => setGateway(val as "stripe" | "khalti" | "esewa")} className="flex flex-wrap items-center gap-4 mb-6">
        <Label
          htmlFor="stripe"
          className={cn(
            "flex items-center gap-2 border rounded-lg p-3",
            stripeOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
            gateway === "stripe" && stripeOk && "border-primary"
          )}
        >
          <RadioGroupItem value="stripe" id="stripe" disabled={!stripeOk} />
          Stripe (Cards)
        </Label>
        <Label
          htmlFor="khalti"
          className={cn(
            "flex items-center gap-2 border rounded-lg p-3",
            khaltiOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
            gateway === "khalti" && khaltiOk && "border-primary"
          )}
        >
          <RadioGroupItem value="khalti" id="khalti" disabled={!khaltiOk} />
          Khalti
        </Label>
        <Label
          htmlFor="esewa"
          className={cn(
            "flex items-center gap-2 border rounded-lg p-3",
            esewaOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
            gateway === "esewa" && esewaOk && "border-primary"
          )}
        >
          <RadioGroupItem value="esewa" id="esewa" disabled={!esewaOk} />
          eSewa
        </Label>
      </RadioGroup>
      {!networkOnline ? (
        <p className="mb-3 text-sm text-muted-foreground">Back online to subscribe or complete checkout.</p>
      ) : null}
      <div className="max-w-sm">
        <BillingTermsAndPayRow
          termsId="checkout-terms-accept"
          termsAccepted={termsAccepted}
          onTermsAcceptedChange={setTermsAccepted}
          payDisabled={!networkOnline || gatewayBlocked}
          onPay={() => void handleCheckout()}
          payLabel={payLabel}
          loading={isLoading}
        />
      </div>
    </div>
  );
}

/**
 * “Upgrade path” sirf **current se upar** wale columns — `renew` / `downgrade` columns is helper tak aate hi nahi
 * (proration block `change !== "downgrade"` + upgrade paragraph `change === "upgrade"`).
 */
function billingShowUpgradePathParagraph(change: ReturnType<typeof classifyPlanChange>): boolean {
  return change === "upgrade";
}

/** `/api/company/billing-payments-statement` body — PDF row fields only (same contract as statement page). */
type BillingPaymentsStatementApiRow = {
  createdAtMs: number | null;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  planId: string;
  planChangeFrom: string | null;
  planChangeTo: string | null;
  planChangeOneTime: boolean;
  billingIntent: string | null;
};

type BillingPaymentsStatementApiResponse = {
  companyId: string;
  planId: string | null;
  planExpiryMs: number | null;
  payments: BillingPaymentsStatementApiRow[];
  error?: string;
};

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground" aria-busy="true">
          Loading billing…
        </div>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const { user, customUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const addonQuery = String(searchParams.get("addon") || "").toLowerCase();
  const addonInitialKind =
    addonQuery === "user" || addonQuery === "user-online"
      ? ("user-online" as const)
      : addonQuery === "user-local"
        ? ("user-local" as const)
        : addonQuery === "company" || addonQuery === "company-online"
          ? ("company-online" as const)
          : addonQuery === "company-local"
            ? ("company-local" as const)
            : addonQuery === "device-local"
              ? ("device-local" as const)
              : ("device-online" as const);
  const { companyId, company, loading: companyLoading, refreshAuthoritativePlan, allCompanies, reloadLocalCompanyRegistry, triggerSync } = useCompany();
  const hasSelectedCompany = Boolean(String(companyId || "").trim());
  /** User country picker — plan amounts is currency me convert dikhenge. */
  const [priceCountry, setPriceCountry] = useState("");
  useEffect(() => {
    const c = String(company?.country ?? "").trim();
    if (c) setPriceCountry(c);
  }, [company?.country]);

  const {
    country: billingPriceCountry,
    region: billingRegion,
    regionLabel,
    displaySymbol,
    displayCurrency,
    formatPlanTermPrice,
    getCheckoutForPlan,
    formatAmount,
    fx,
    pricingSettings,
    fxLoading: billingFxLoading,
  } = useBillingRegionPricing(priceCountry || company?.country);

  // `/api/payments/*` + `/api/company/*` Firestore `companies/{docId}` padhte hain — restore/merge me SQLite row `id` ≠ cloud doc ho to `authoritativeCompanyId` sahi doc khulta hai.
  const billingFirestoreCompanyId = useMemo(() => {
    const uid = String(user?.uid || "").trim();
    const pickId = (row: CompanyRow | null | undefined) => {
      const auth = String(row?.authoritativeCompanyId || "").trim();
      const id = String(row?.id || "").trim();
      if (auth) return auth;
      if (id && !isAdminPanelCompanyLocalId(id)) return id;
      return "";
    };
    const fromSelected = pickId(company as CompanyRow | null);
    if (fromSelected) return fromSelected;
    if (!uid || !allCompanies?.length) return String(companyId || "").trim();
    const owned = allCompanies.filter(
      (c) => c.isOwned === true || String(c.ownerId || "").trim() === uid
    );
    for (const row of owned) {
      const fid = pickId(row);
      if (fid) return fid;
    }
    return String(companyId || "").trim();
  }, [companyId, company, allCompanies, user?.uid]);
  // dateFormatBS: BS display key — formatBsFromAD mirrors NepaliDate.format + datex-bs for long AD expiries.
  const { dateSystem, formatDate, formatDateBS, dateFormatBS } = useDate();
  // Statement PDF “When” / plan expiry strings — shared hook with `/billing/statement` so Print matches.
  const { formatWhenSingleLine, formatPlanExpirySummary } = useBillingStatementWhenFormatters();
  const [plans, setPlans] = useState<Plan[]>(() => readCachedPlansList() ?? defaultPlansListFallback());
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>("basic");
  /** Each plan column’s term (dropdown max 1 yr) for Basic checkout + proration quotes. */
  const [colTerms, setColTerms] = useState<Record<PlanId, SubscriptionTermKey>>(() => {
    const o = {} as Record<PlanId, SubscriptionTermKey>;
    for (const id of ["basic", "advance", "pro", "pro-plus"] as PlanId[]) o[id] = "year_1";
    return o;
  });
  const [prorationLoading, setProrationLoading] = useState<string | null>(null);
  const [downgradeLoading, setDowngradeLoading] = useState<string | null>(null);
  /** `/api/company/billing-auto-renew` — checkbox save. */
  const [autoRenewSaving, setAutoRenewSaving] = useState(false);
  const isMobile = useIsMobile();
  /** Mobile plan carousel: one visible plan column at a time. */
  const [mobilePlanIndex, setMobilePlanIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  /** Gateway for paid-plan renew (proration): matches Basic checkout — admin/history get separate rows per gateway. */
  const [prorationGateway, setProrationGateway] = useState<"stripe" | "khalti" | "esewa">("stripe");
  /** Must tick Terms before renew/upgrade gateway pay. */
  const [billingPayTermsAccepted, setBillingPayTermsAccepted] = useState(false);
  /** Bank Settings + env merge — kaunse gateway initiate / plan-change chala sakte hain. */
  const [gatewayAvailability, setGatewayAvailability] = useState<BillingGatewayAvailability | null>(null);
  /** "Just change plan" pehle AlertDialog — seedha Stripe/page na khule (user request). */
  const [planChangeOnlyTargetId, setPlanChangeOnlyTargetId] = useState<PlanId | null>(null);
  /** Paid term dropdown: explain proration table before applying term. */
  const [termExplainDialog, setTermExplainDialog] = useState<{
    planId: PlanId;
    term: SubscriptionTermKey;
  } | null>(null);
  /** Browser network — paid checkout / plan-change APIs online; offline par cached plan dikhta rahe + buttons band. */
  const [billingNavigatorOnline, setBillingNavigatorOnline] = useState(
    () => typeof window !== "undefined" && navigator.onLine
  );
  useEffect(() => {
    const sync = () => setBillingNavigatorOnline(typeof navigator !== "undefined" && navigator.onLine);
    if (typeof window === "undefined") return;
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  const billingOfflineBlock = !billingNavigatorOnline;
  /** Paid footer: fetch statement API — preview (Print) ya file save (Download). */
  const [printStatementBusy, setPrintStatementBusy] = useState(false);
  const [downloadStatementBusy, setDownloadStatementBusy] = useState(false);
  const [onlineDemoPlanBusy, setOnlineDemoPlanBusy] = useState(false);
  /** Super Admin `app_settings/billing` — paid→cheaper paid downgrade policy. */
  const { planDowngradeEnabled, loading: billingPolicyLoading } = useBillingPolicyFlags();
  const formatBillingDate = useCallback(
    (dDate: Date | null | undefined) => {
      if (!dDate || isNaN(dDate.getTime())) return "N/A";
      if (dateSystem === "AD") return formatDate(dDate) || "N/A";
      if (dateSystem === "BS") return formatDateBS(dDate) || "N/A";
      // Both: only pair BS + AD when extended conversion succeeds — else single AD line (no duplicate).
      const ad = formatDate(dDate) || "N/A";
      const bs = formatBsFromAD(dDate, dateFormatBS);
      return bs ? `${bs} (${ad})` : ad;
    },
    [dateSystem, formatDate, formatDateBS, dateFormatBS]
  );

  /**
   * Plan expiry can land past nepali-date-converter BS 2090 — datex-bs extends to ~2200; beyond that, "(AD)" label.
   */
  const formatBillingExpiry = useCallback(
    (dDate: Date | null | undefined) => {
      if (!dDate || isNaN(dDate.getTime())) return "N/A";
      const ad = formatDate(dDate) || "N/A";
      if (dateSystem === "AD") return ad;
      const bs = formatBsFromAD(dDate, dateFormatBS);
      if (dateSystem === "BS") return bs || `${ad} (AD)`;
      return bs ? `${bs} (${ad})` : ad;
    },
    [dateSystem, formatDate, dateFormatBS]
  );

  /** Account plan owns subscriptions. Legacy company plan is fallback until migration is complete. */
  const currentPlanId = useMemo(
    (): PlanId =>
      normalizePlanIdForClient(
        customUser?.accountCanonicalPlanId || company?.planId
      ),
    [customUser?.accountCanonicalPlanId, company?.planId]
  );

  /** Plan matrix / mobile tabs — Super Admin hidden tiers omitted. */
  const billingCatalogPlans = useMemo(
    () => plansVisibleOnBillingPage(plans),
    [plans]
  );

  const billingFrozenLedger = useMemo(
    () => parseBillingFrozenPlanLedger(company?.billingFrozenUsageLedger),
    [company?.billingFrozenUsageLedger]
  );
  const billingDowngradeBlockedIds = useMemo(
    () => parseBillingDowngradeBlockedPlanIds(company?.billingBlockedDowngradePlanIds),
    [company?.billingBlockedDowngradePlanIds]
  );
  /** Neeche wala paid tier ledger me freeze ho (upgrade / Just change plan) — current tier Usage 0 se din hisaab se badhe. */
  const frozenLowerPaidTierInLedger = useMemo(() => {
    if (currentPlanId === "basic") return false;
    const cur = planTierIndex(currentPlanId);
    return billingFrozenLedger.some((s) => planTierIndex(normalizePlanIdForClient(s.planId)) < cur);
  }, [billingFrozenLedger, currentPlanId]);
  /** Firestore `planUpgradedAt` / mirror ms — ramp usage ke liye tier switch timestamp. */
  const planUpgradedAtMsForUsageRamp = useMemo(() => {
    const d = toSafeDate(company?.planUpgradedAt);
    if (d && !Number.isNaN(d.getTime())) return d.getTime();
    const ms = (company as { planUpgradedAtMs?: number } | undefined)?.planUpgradedAtMs;
    if (typeof ms === "number" && Number.isFinite(ms)) return ms;
    return null;
  }, [company]);
  const isPaidTierDowngradeBlocked = useCallback(
    (pid: PlanId) => billingDowngradeBlockedIds.includes(normalizePlanIdForClient(pid)),
    [billingDowngradeBlockedIds]
  );

  useEffect(() => {
    if (["basic", "advance", "pro", "pro-plus"].includes(currentPlanId)) {
      setSelectedPlanId(currentPlanId);
    }
  }, [currentPlanId]);

  // Pehle dropdown me `plan_change_only` / multi-year tha — ab sirf 4 option; invalid value `year_1` par clamp.
  useEffect(() => {
    const allowed = new Set(BILLING_TERM_OPTIONS.map((o) => o.value));
    setColTerms((prev) => {
      let touched = false;
      const next = { ...prev };
      (Object.keys(next) as PlanId[]).forEach((id) => {
        if (!allowed.has(next[id])) {
          next[id] = "year_1";
          touched = true;
        }
      });
      return touched ? next : prev;
    });
  }, []);

  /** Admin DB se list prices (Firebase Admin) — client persistence cache se zyada trustworthy. */
  const fetchServerPlanCatalog = useCallback(async () => {
    try {
      const res = await fetch(getBillingApiUrl("/api/payments/plan-catalog"), { cache: "no-store", headers: await getServerLoginBillingAuthHeader().catch(() => ({})) }); // TEMP-NOKEY: token header
      if (!res.ok) return;
      const data = (await res.json()) as { plans?: Plan[] };
      if (Array.isArray(data.plans) && data.plans.length > 0) {
        setPlans(data.plans);
        writeCachedPlansList(data.plans);
      }
    } catch {
      /* offline: onSnapshot / defaults */
    }
  }, []);

  // Mount + tab focus: server catalog (same amounts as `/api/payments/initiate`).
  useEffect(() => {
    void fetchServerPlanCatalog();
  }, [fetchServerPlanCatalog]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchServerPlanCatalog();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchServerPlanCatalog]);

  // Realtime: Firestore listener — agar data cache se ho to dubara server se align karo.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(firestore, "app_settings", "plans"),
      (docSnap) => {
        if (docSnap.exists()) {
          const raw = docSnap.data() as Record<string, unknown>;
          const mergedPlans = mergeAppSettingsPlansDoc(raw);
          setPlans(mergedPlans);
          writeCachedPlansList(mergedPlans);
          if (docSnap.metadata.fromCache) void fetchServerPlanCatalog();
        } else {
          setPlans(readCachedPlansList() ?? defaultPlansListFallback());
        }
        setLoading(false);
      },
      () => {
        const cached = readCachedPlansList();
        if (cached) setPlans(cached);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [fetchServerPlanCatalog]);

  // Gateway radios: server pe keys na hon to disabled — user pehle hi dekh le.
  const fetchGatewayAvailability = useCallback(async () => {
    try {
      const res = await fetch(getBillingApiUrl("/api/payments/gateway-status"), { cache: "no-store", headers: await getServerLoginBillingAuthHeader().catch(() => ({})) }); // TEMP-NOKEY: token header
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      const stripe = data.stripe === true;
      const khalti = data.khalti === true;
      const esewa = data.esewa === true;
      setGatewayAvailability({ stripe, khalti, esewa });
    } catch {
      /* offline: null = purana behaviour */
    }
  }, []);

  useEffect(() => {
    void fetchGatewayAvailability();
  }, [fetchGatewayAvailability]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchGatewayAvailability();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchGatewayAvailability]);

  useEffect(() => {
    setProrationGateway((prev) => firstAvailableBillingGateway(gatewayAvailability, prev));
  }, [gatewayAvailability]);

  const prorationStripeAvail = gatewayAvailability == null || gatewayAvailability.stripe;
  const prorationKhaltiAvail = gatewayAvailability == null || gatewayAvailability.khalti;
  const prorationEsewaAvail = gatewayAvailability == null || gatewayAvailability.esewa;
  const prorationPayEnabled =
    gatewayAvailability == null ||
    (prorationGateway === "stripe"
      ? gatewayAvailability.stripe
      : prorationGateway === "khalti"
        ? gatewayAvailability.khalti
        : gatewayAvailability.esewa);

  const selectedPlanDetails = plans.find((p) => p.id === selectedPlanId);

  /** Resolved display name for the company’s active SKU (merged Firestore plan names). */
  const currentSubscribedPlanLabel = useMemo(() => {
    const row = plans.find((p) => p.id === currentPlanId);
    if (row?.name) return row.name;
    if (currentPlanId === "pro-plus") return "Pro Plus";
    return currentPlanId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [plans, currentPlanId]);

  const joinedDate = useMemo(() => {
    // Pehle isi company doc; phir same owner + same `planId` ki koi aur row — plan multi-sync ke baad bhi purani row `N/A` na ho.
    const direct =
      toSafeDate(company?.planUpgradedAt) ??
      toSafeDate((company as Record<string, unknown> | undefined)?.planJoinedAt) ??
      toSafeDate((company as Record<string, unknown> | undefined)?.createdAt) ??
      toSafeDate((company as Record<string, unknown> | undefined)?.createdOn) ??
      null;
    if (direct) return direct;
    const uid = user?.uid?.trim();
    if (!uid || !company) return null;
    if (String(company.ownerId ?? "").trim() !== uid) return null;
    const planNorm = normalizePlanIdForClient(company.planId as PlanId | undefined);
    const peerMs = maxJoinedTierStartMsAmongOwnerPeers(uid, planNorm, allCompanies);
    if (peerMs == null) return null;
    const d = new Date(peerMs);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [company, allCompanies, user?.uid]);

  const expiryDate = useMemo(() => {
    const accountMs =
      typeof customUser?.accountCanonicalPlanExpiryMs === "number" &&
      Number.isFinite(customUser.accountCanonicalPlanExpiryMs)
        ? customUser.accountCanonicalPlanExpiryMs
        : readAccountPlanLocalCache(user?.uid)?.planExpiryMs ?? null;
    if (accountMs != null && Number.isFinite(accountMs)) {
      const d = new Date(accountMs);
      if (!Number.isNaN(d.getTime())) return d;
    }
    // Firestore `planExpiry` + legacy keys; SQLite mirror aksar sirf `planExpiryMs` rakhta hai — bina iske billing par "N/A".
    const fromTs =
      toSafeDate(company?.planExpiry) ??
      toSafeDate((company as Record<string, unknown> | undefined)?.expiryDate) ??
      toSafeDate((company as Record<string, unknown> | undefined)?.planExpiresAt) ??
      null;
    if (fromTs) return fromTs;
    const ms = (company as Record<string, unknown> | undefined)?.planExpiryMs;
    if (typeof ms === "number" && Number.isFinite(ms)) {
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }, [company, customUser?.accountCanonicalPlanExpiryMs, user?.uid]);

  /** Stripe sub active + Firestore expiry miss — server se `current_period_end` backfill (ek baar / mount). */
  const repairExpiryAttemptedRef = useRef(false);
  useEffect(() => {
    if (repairExpiryAttemptedRef.current || companyLoading || !user || !billingFirestoreCompanyId) return;
    const subId = typeof company?.stripeSubscriptionId === "string" ? company.stripeSubscriptionId.trim() : "";
    if (!subId || expiryDate != null) return;
    repairExpiryAttemptedRef.current = true;
    void (async () => {
      try {
        const token = await getBillingApiIdToken(user);
        const res = await fetch(getBillingApiUrl("/api/company/repair-stripe-plan-expiry"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ companyId: billingFirestoreCompanyId }),
        });
        if (!res.ok) repairExpiryAttemptedRef.current = false;
      } catch {
        repairExpiryAttemptedRef.current = false;
      }
    })();
  }, [user, companyLoading, billingFirestoreCompanyId, company?.stripeSubscriptionId, expiryDate]);

  useEffect(() => {
    if (mobilePlanIndex >= billingCatalogPlans.length) {
      setMobilePlanIndex(Math.max(0, billingCatalogPlans.length - 1));
    }
  }, [mobilePlanIndex, billingCatalogPlans.length]);

  useEffect(() => {
    if (billingCatalogPlans.length === 0) return;
    const visible = new Set(billingCatalogPlans.map((p) => p.id));
    if (!visible.has(selectedPlanId)) {
      const fallback =
        billingCatalogPlans.find((p) => p.id === currentPlanId)?.id ??
        billingCatalogPlans[0]?.id;
      if (fallback) setSelectedPlanId(fallback);
    }
  }, [billingCatalogPlans, selectedPlanId, currentPlanId]);

  const handleDownloadPlansPdf = useCallback(async () => {
    try {
      const jsPdfModule = await import("jspdf");
      const doc = new jsPdfModule.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      // One-page PC-style matrix: feature rows + 4 plan columns with line borders.
      const orderedPlanIds: PlanId[] = ["basic", "advance", "pro", "pro-plus"];
      const exportPlans = orderedPlanIds
        .map((id) => billingCatalogPlans.find((p) => p.id === id))
        .filter((p): p is Plan => p != null);
      if (exportPlans.length === 0) {
        throw new Error("No plan data available.");
      }

      const pageW = doc.internal.pageSize.getWidth();
      const left = 26;
      const right = pageW - 26;
      const tableW = right - left;
      const featureColW = 185;
      const planColW = (tableW - featureColW) / exportPlans.length;
      const top = 76;
      const rowH = 20;
      const headerH = 40;

      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      doc.text("Pocket Ledger - Billing Plans", left, 34);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${new Date().toLocaleString()}`, left, 50);

      // Outer border.
      const totalRows = BILLING_FEATURES.length + 1; // + price row
      const tableH = headerH + totalRows * rowH;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.8);
      doc.rect(left, top, tableW, tableH);

      // Vertical lines: feature + plan columns.
      doc.line(left + featureColW, top, left + featureColW, top + tableH);
      for (let i = 1; i < exportPlans.length; i++) {
        const x = left + featureColW + i * planColW;
        doc.line(x, top, x, top + tableH);
      }

      // Header separator — patli horizontal (neeche feature rows jaisa).
      doc.setLineWidth(0.4);
      doc.line(left, top + headerH, left + tableW, top + headerH);

      // Column headers.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Features", left + 6, top + 24);
      exportPlans.forEach((p, idx) => {
        const x = left + featureColW + idx * planColW + 6;
        doc.text(p.name, x, top + 16);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        const priceLine = p.isFree
          ? formatFreePlanCrossedPrice(p, colTerms[p.id], formatPlanTermPrice) || "Free"
          : formatTermPriceFromKey(p, colTerms[p.id], formatPlanTermPrice);
        const wrapped = doc.splitTextToSize(priceLine, planColW - 12) as string[];
        doc.text(wrapped.slice(0, 2), x, top + 30);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
      });

      // Row 1: Tagline
      let y = top + headerH + rowH - 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Tagline", left + 6, y);
      exportPlans.forEach((p, idx) => {
        const x = left + featureColW + idx * planColW + 6;
        const wrapped = doc.splitTextToSize(String(p.tagline || "-"), planColW - 12) as string[];
        doc.text(wrapped[0] || "-", x, y);
      });
      doc.setLineWidth(0.4);
      doc.line(left, top + headerH + rowH, left + tableW, top + headerH + rowH);

      // Feature rows with horizontal grid lines (0.4 ≈ outer 0.8 ka aadha).
      // Thick rule between online block and offline/local block.
      BILLING_FEATURES.forEach((feature, featureIdx) => {
        const rowTop = top + headerH + rowH + featureIdx * rowH;
        const rowTextY = rowTop + rowH - 6;
        if (featureIdx === BILLING_ONLINE_OFFLINE_SPLIT_INDEX) {
          // Normal grid ~0.4; +~1px only (not a heavy bar).
          doc.setLineWidth(0.75);
          doc.line(left, rowTop, left + tableW, rowTop);
          doc.setLineWidth(0.4);
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(feature.label, left + 6, rowTextY);
        exportPlans.forEach((p, idx) => {
          const fv = getFeatureValue(p, feature.key);
          const cellText = fv.text;
          const x = left + featureColW + idx * planColW + 6;
          const wrapped = doc.splitTextToSize(String(cellText), planColW - 12) as string[];
          doc.text(wrapped[0] || "-", x, rowTextY);
        });
        doc.line(left, rowTop + rowH, left + tableW, rowTop + rowH);
      });

      doc.save("pocket-ledger-plans.pdf");
      toast({ title: "Downloaded", description: "Plan chart PDF downloaded." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF download failed",
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  }, [colTerms, billingCatalogPlans]);

  const expiryMs = expiryDate != null && !Number.isNaN(expiryDate.getTime()) ? expiryDate.getTime() : null;

  /** Popup copy + “about N days” — `plan_change_only` server quote ke saath (upgrade par naya end date). */
  const planChangeOnlyDialogPreview = useMemo(() => {
    if (!planChangeOnlyTargetId) return null;
    const curRow = plans.find((x) => x.id === currentPlanId);
    const tgtRow = plans.find((x) => x.id === planChangeOnlyTargetId);
    if (!curRow || !tgtRow || curRow.isFree) return null;
    const nowMs = Date.now();
    const q = quotePaidPlanPurchase({
      nowMs,
      currentExpiryMs: expiryMs,
      currentYearly: curRow.price.yearly,
      targetMonthly: tgtRow.price.monthly,
      targetYearly: tgtRow.price.yearly,
      term: "plan_change_only",
    });
    const isUpgradeConversion =
      tgtRow.price.yearly > curRow.price.yearly && curRow.price.yearly > 0 && tgtRow.price.yearly > 0;
    const newDaysLeft = daysLeftRounded(nowMs, q.newExpiryMs);
    const remainingMsDialog =
      expiryMs != null && Number.isFinite(expiryMs) ? Math.max(0, expiryMs - nowMs) : 0;
    const leavingLedger = renewColumnFrozenUsageAndCreditDaysLeft({
      nowMs,
      currentExpiryMs: expiryMs,
      planYearly: curRow.price.yearly,
      remainingMs: remainingMsDialog,
    });
    return {
      fromLabel: curRow.name,
      toLabel: tgtRow.name,
      netNpr: q.netNpr,
      isUpgradeConversion,
      newDaysLeft,
      leavingUsageNpr: leavingLedger.frozenUsageNpr,
      leavingPlanYearly: curRow.price.yearly,
    };
  }, [planChangeOnlyTargetId, plans, currentPlanId, expiryMs]);

  /** Calendar days until plan expiry — shown beside expiry; null when no expiry timestamp. */
  const daysLeftOnPlan = useMemo(
    () => (expiryMs != null ? daysLeftRounded(Date.now(), expiryMs) : null),
    [expiryMs]
  );

  const termExplainDialogPreview = useMemo(() => {
    if (!termExplainDialog) return null;
    const tgt = plans.find((x) => x.id === termExplainDialog.planId);
    const curRow = plans.find((x) => x.id === currentPlanId);
    if (!tgt || tgt.isFree || !curRow || curRow.isFree) return null;
    const nowMs = Date.now();
    const term = termExplainDialog.term;
    const q = quotePaidPlanPurchase({
      nowMs,
      currentExpiryMs: expiryMs,
      currentYearly: curRow.price.yearly,
      targetMonthly: tgt.price.monthly,
      targetYearly: tgt.price.yearly,
      term,
      subtractUnusedCredit: false,
    });
    const stackFromMs = Math.max(nowMs, expiryMs ?? nowMs);
    const currentExpiryLabel =
      expiryMs != null && Number.isFinite(expiryMs)
        ? formatBillingExpiry(new Date(expiryMs))
        : formatBillingExpiry(new Date(stackFromMs));
    return {
      planName: tgt.name,
      selectedTermLabel: billingTermOptionLabel(term),
      termDays: termAddedDaysRounded(term),
      currentExpiryLabel,
      newExpiryLabel: formatBillingExpiry(new Date(q.newExpiryMs)),
      chargeNpr: q.grossNpr,
    };
  }, [termExplainDialog, plans, currentPlanId, expiryMs, formatBillingExpiry]);

  const requestPaidTermChange = useCallback(
    (planId: PlanId, term: SubscriptionTermKey) => {
      if (colTerms[planId] === term) return;
      setSelectedPlanId(planId);
      setTermExplainDialog({ planId, term });
    },
    [colTerms]
  );

  const confirmTermExplainDialog = useCallback(() => {
    if (!termExplainDialog) return;
    const { planId, term } = termExplainDialog;
    setColTerms((prev) => ({ ...prev, [planId]: term }));
    setTermExplainDialog(null);
  }, [termExplainDialog]);
  /** True when expiry is in the past (not "0 days" due to same-day rounding). */
  const planExpiredByClock = expiryMs != null && expiryMs <= Date.now();

  /** Prorated renew: Stripe redirect, Khalti widget, or eSewa form — server stores pending intent for NP gateways. */
  /** `termOverride`: "Just change plan" alag button se — dropdown click se plan change/commit nahi. */
  async function handleProratedPay(targetPlanId: PlanId, termOverride?: SubscriptionTermKey) {
    if (!user || !companyId) return;
    if (billingOfflineBlock) {
      toast({
        variant: "destructive",
        title: "Offline",
        description: "Back online to renew, upgrade, or change plan.",
      });
      return;
    }
    const term = termOverride ?? colTerms[targetPlanId];
    const stackOnExpiry = term !== "plan_change_only";
    // `plan_change_only` + paid downgrade: API 400 — neeche tier sirf Downgrade button (ya admin ne band kiya ho).
    if (term === "plan_change_only") {
      const ck = classifyPlanChange(currentPlanId, targetPlanId);
      if (ck === "downgrade") {
        if (!planDowngradeEnabled) {
          toast({
            variant: "destructive",
            title: "Downgrades disabled",
            description:
              "Lower paid plan downgrades are turned off. Contact support if you need to change your paid tier.",
          });
        } else {
          toast({
            variant: "destructive",
            title: "Use Downgrade",
            description:
              "To move down a paid tier, use the Downgrade button in that plan’s column. “Just change plan” is only for moving up without payment.",
          });
        }
        return;
      }
    }
    const loadKey = `pay:${targetPlanId}`;
    setProrationLoading(loadKey);
    try {
      const token = await getBillingApiIdToken(user);
      const res = await fetch(planChangeCheckoutApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyId: billingFirestoreCompanyId,
          targetPlanId,
          term,
          gateway: prorationGateway,
          billingRegion,
          stackOnExpiry,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.applied && data.ok) {
        let description: string;
        if (term === "plan_change_only") {
          const h = data.planChangeHistory as { oldExpiryMs?: number | null; newExpiryMs?: number } | undefined;
          const oldE = h?.oldExpiryMs;
          const newE = h?.newExpiryMs;
          // Upgrade “Just change plan”: naya expiry purane se pehle — value → nayi plan par din.
          if (typeof oldE === "number" && typeof newE === "number" && newE < oldE - 60_000) {
            description = "Remaining value became time on the new plan (end date updated). No charge.";
          } else {
            description = "Tier changed — subscription end date unchanged. No charge.";
          }
        } else {
          // Paid term must open gateway — silent date add = bug (unused-credit zero-net on hosted API).
          throw new Error(
            "Payment gateway did not open (server returned free apply). On localhost this should use the local API — hard-refresh and try again. If you still see this, restart `npm run dev`."
          );
        }
        await refreshAuthoritativePlan();
        toast({ title: "Plan updated", description });
        return;
      }
      if (prorationGateway === "stripe" && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }
      if (prorationGateway === "khalti" && data.gateway === "khalti") {
        const khaltiConfig = {
          publicKey: data.publicKey,
          productIdentity: data.product_identity,
          productName: data.product_name,
          productUrl: typeof window !== "undefined" ? window.location.href : "",
          amount: data.amount,
          eventHandler: {
            onSuccess(payload: { token: string; amount: number }) {
              window.location.assign(withKhaltiProrationReturnParams(data.returnUrl, payload.token, payload.amount));
            },
            onError() {
              toast({ variant: "destructive", title: "Khalti error", description: "Payment did not complete." });
            },
            onClose() {
              /* user closed widget */
            },
          },
        };
        const checkout = new (KhaltiCheckout as any)(khaltiConfig);
        checkout.show({ amount: data.amount });
        return;
      }
      if (prorationGateway === "esewa" && data.gateway === "esewa") {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.url;
        const fields: Record<string, string> = {
          amount: String(data.amount),
          failure_url: data.failUrl,
          product_delivery_charge: "0",
          product_service_charge: "0",
          product_code: data.merchantCode,
          signature: data.signature,
          signed_field_names: data.signedFieldNames,
          success_url: data.successUrl,
          tax_amount: "0",
          total_amount: String(data.amount),
          transaction_uuid: data.oid,
        };
        for (const key of Object.keys(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = fields[key];
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
        return;
      }
      throw new Error("Unexpected response from payment server.");
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not start checkout",
        description: e instanceof Error ? e.message : "Error",
      });
    } finally {
      setProrationLoading(null);
    }
  }

  /** Lower tier: remap remaining value into days on the cheaper yearly rate (Firestore only). */
  async function handleDowngrade(targetPlanId: PlanId) {
    if (!user || !companyId) return;
    if (billingOfflineBlock) {
      toast({
        variant: "destructive",
        title: "Offline",
        description: "Back online to change or downgrade your plan.",
      });
      return;
    }
    const tgtRow = plans.find((x) => x.id === targetPlanId);
    const changeKind = classifyPlanChange(currentPlanId, targetPlanId);
    if (changeKind === "downgrade" && tgtRow && !tgtRow.isFree && !planDowngradeEnabled) {
      toast({
        variant: "destructive",
        title: "Downgrades disabled",
        description: "Lower paid plan downgrades are turned off by the administrator.",
      });
      return;
    }
    const loadKey = `down:${targetPlanId}`;
    setDowngradeLoading(loadKey);
    try {
      const token = await getBillingApiIdToken(user);
      const res = await fetch(getBillingApiUrl("/api/company/downgrade-plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: billingFirestoreCompanyId, targetPlanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Downgrade failed");
      if (data.localOnly === true) {
        // Local-only company (not on PocketBase yet): account plan was saved on the server; apply it to this device's
        // account cache + local company row so online slots / user limit follow the new plan right away.
        const upMs = typeof data.planUpgradedAtMs === "number" ? data.planUpgradedAtMs : Date.now();
        writeAccountPlanLocalCache(user.uid, { planId: targetPlanId, planExpiryMs: null });
        const localId = String(companyId || "").trim();
        const row = localId ? await getLocalCompanyById(localId) : null;
        if (row) {
          const merged: Record<string, unknown> = {
            ...(row as unknown as Record<string, unknown>),
            planId: targetPlanId,
            planUpgradedAtMs: upMs,
          };
          delete merged.planExpiryMs;
          delete merged.planExpiry;
          await upsertLocalCompany(merged as unknown as LocalCompanyDoc);
        }
        reloadLocalCompanyRegistry();
        triggerSync();
      } else {
        await refreshAuthoritativePlan();
      }
      toast({ title: "Plan updated", description: "Your subscription tier was updated." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not downgrade",
        description: e instanceof Error ? e.message : "Error",
      });
    } finally {
      setDowngradeLoading(null);
    }
  }

  async function handleBillingAutoRenewChange(enabled: boolean) {
    if (!user || !billingFirestoreCompanyId) return;
    if (billingOfflineBlock) {
      toast({ variant: "destructive", title: "Offline", description: "Back online to change auto renew." });
      return;
    }
    setAutoRenewSaving(true);
    try {
      const token = await getBillingApiIdToken(user);
      const res = await fetch(getBillingApiUrl("/api/company/billing-auto-renew"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: billingFirestoreCompanyId, enabled }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast({
        title: enabled ? "Auto renew on" : "Auto renew off",
        description: enabled
          ? "Stripe will charge your saved card for the next billing cycles. If a charge fails, you may get 3 extra days and an alert here."
          : "Stripe will not auto-renew after this period ends. Renew manually with pay with … on this page before your access expires.",
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not update",
        description: e instanceof Error ? e.message : "Error",
      });
    } finally {
      setAutoRenewSaving(false);
    }
  }

  const allFeaturesConfig = BILLING_FEATURES;

  /** Feature cell: number / Unlimited / None; max devices = effective count (multi off → 1) bina side tick. */
  const getFeatureValue = (
    plan: Plan,
    key: EntitlementKey
  ): { text: string; enabled: boolean } => {
    const value = plan.entitlements[key];
    const allowOnline = plan.entitlements.allowFirebaseOnlineCompanies === true;
    const driveSyncOn = plan.entitlements.googleDriveSyncEnabled === true;

    // Allow online OFF → online-bucket rows always "None" (even if legacy store still has -1).
    if (!allowOnline && isOnlineEntitlementCapKey(key)) {
      return { text: "None", enabled: false };
    }

    // Drive sync OFF → company/user caps always "None" (0 must not become Unlimited).
    if (
      !driveSyncOn &&
      (key === "maxGoogleDriveSyncCompanies" || key === "maxGoogleDriveSyncUsers")
    ) {
      return { text: "None", enabled: false };
    }

    const formatCap = (raw: unknown): { text: string; enabled: boolean } => {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (isUnlimitedEntitlementCap(n)) return { text: "Unlimited", enabled: true };
      if (!Number.isFinite(n) || isZeroEntitlementCap(n)) return { text: "None", enabled: false };
      return { text: String(n), enabled: n > 0 };
    };

    // Caps: 0 = none; -1 = unlimited; >0 = hard cap (admin PlanDetails / enforce jaisa).
    if (
      key === "dailyVoucherLimit" ||
      key === "monthlyVoucherLimit" ||
      key === "dailyVoucherLimitLocal" ||
      key === "monthlyVoucherLimitLocal" ||
      key === "maxAttachmentBackupPerMonth" ||
      key === "maxAttachmentRestorePerMonth" ||
      key === "maxLocalToOnlineAttachmentMB"
    ) {
      return formatCap(value);
    }

    // GB caps: 0 = none; -1 = unlimited.
    if (
      key === "maxAttachmentsGB" ||
      key === "maxAttachmentsGBLocal" ||
      key === "maxStorageGB" ||
      key === "maxStorageGBLocal"
    ) {
      return formatCap(value);
    }

    // Multi-device band = single device (`useDeviceLimit` jaisa); sirf number — sync on/off alag row `hasMultiDeviceSync`.
    if (key === "maxDevices" || key === "maxDevicesLocal") {
      const raw =
        key === "maxDevicesLocal"
          ? (plan.entitlements.maxDevicesLocal ?? plan.entitlements.maxDevices)
          : plan.entitlements.maxDevices;
      const multi = plan.entitlements.hasMultiDeviceSync === true;
      if (!multi) return { text: "1", enabled: true };
      return formatCap(raw);
    }

    if (typeof value === "boolean") {
      return { text: value ? "Yes" : "No", enabled: value };
    }

    if (typeof value === "number") {
      return formatCap(value);
    }

    return { text: "No", enabled: false };
  };

  const isPaidCompany = currentPlanId !== "basic";

  /** Statement API + PDF — same gate as `/billing/statement` (owner-only). */
  const isBillingOwner = useMemo(
    () => Boolean(user?.uid && company?.ownerId && user.uid === company.ownerId),
    [user?.uid, company?.ownerId]
  );

  /** Ek hi API response — Print overlay aur Download file dono isi payload se. */
  const fetchBillingStatementPdfArgsForFooter = useCallback(async () => {
    const idToken = await getBillingApiIdToken(auth.currentUser).catch(() => null);
    if (!idToken) throw new Error("Not signed in.");
    const url = getBillingApiUrl(
      `/api/company/billing-payments-statement?companyId=${encodeURIComponent(billingFirestoreCompanyId)}`
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    const json = (await res.json()) as BillingPaymentsStatementApiResponse;
    if (!res.ok) {
      throw new Error(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
    }
    return {
      companyName: company?.name ?? null,
      companyId: json.companyId,
      planId: json.planId,
      planExpiryText: formatPlanExpirySummary(json.planExpiryMs),
      payments: json.payments.map((p) => ({
        createdAtMs: p.createdAtMs,
        whenDisplay: formatWhenSingleLine(p.createdAtMs),
        amount: p.amount,
        currency: p.currency,
        gateway: p.gateway,
        status: p.status,
        planId: p.planId,
        planChangeFrom: p.planChangeFrom,
        planChangeTo: p.planChangeTo,
        planChangeOneTime: p.planChangeOneTime,
        billingIntent: p.billingIntent,
      })),
    } satisfies Parameters<typeof openBillingStatementPdfPreview>[0];
  }, [
    billingFirestoreCompanyId,
    company?.name,
    formatPlanExpirySummary,
    formatWhenSingleLine,
  ]);

  const billingStatementFooterPdfBusy = printStatementBusy || downloadStatementBusy;

  /** Paid footer Print: `showInAppPdfPreview` (statement page jaisa). */
  const handlePrintStatementFromBillingFooter = useCallback(async () => {
    if (!String(billingFirestoreCompanyId).trim() || !user || billingOfflineBlock) return;
    if (!isBillingOwner) {
      toast({
        variant: "destructive",
        title: "Owner only",
        description: "Only the company owner can print the billing statement.",
      });
      return;
    }
    setPrintStatementBusy(true);
    try {
      const args = await fetchBillingStatementPdfArgsForFooter();
      await openBillingStatementPdfPreview(args);
    } catch (e: unknown) {
      toast({
        title: "Could not open print preview",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPrintStatementBusy(false);
    }
  }, [
    billingFirestoreCompanyId,
    billingOfflineBlock,
    fetchBillingStatementPdfArgsForFooter,
    isBillingOwner,
    user,
  ]);

  /** Paid footer Download: same PDF blob — `<a download>` (preview khole bina). */
  const handleDownloadStatementFromBillingFooter = useCallback(async () => {
    if (!String(billingFirestoreCompanyId).trim() || !user || billingOfflineBlock) return;
    if (!isBillingOwner) {
      toast({
        variant: "destructive",
        title: "Owner only",
        description: "Only the company owner can download the billing statement.",
      });
      return;
    }
    setDownloadStatementBusy(true);
    try {
      const args = await fetchBillingStatementPdfArgsForFooter();
      await downloadBillingStatementPdf(args);
    } catch (e: unknown) {
      toast({
        title: "Could not download PDF",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDownloadStatementBusy(false);
    }
  }, [
    billingFirestoreCompanyId,
    billingOfflineBlock,
    fetchBillingStatementPdfArgsForFooter,
    isBillingOwner,
    user,
  ]);

  /** SuperAdmin-configured demo — server writes the expiry, never this device's SQLite only. */
  const handleOnlineDemoPlan = useCallback(async (plan: Plan) => {
    if (!user?.uid) {
      toast({
        variant: "destructive",
        title: "Sign in required",
        description: "Sign in as the company owner to activate a demo.",
      });
      return;
    }
    if (!isBillingOwner) {
      toast({
        variant: "destructive",
        title: "Owner only",
        description: "Only the company owner can activate a demo.",
      });
      return;
    }
    setOnlineDemoPlanBusy(true);
    try {
      const token = await getBillingApiIdToken(user);
      const res = await fetch(getBillingApiUrl("/api/company/activate-plan-demo"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: billingFirestoreCompanyId, planId: plan.id }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        expiryMs?: number;
        days?: number;
        error?: string;
      };
      if (!res.ok || !result.ok || !result.expiryMs) {
        toast({
          variant: "destructive",
          title: "Demo plan not applied",
          description:
            result.error === "demo_renew_not_allowed"
              ? "This demo already ended. Super Admin has not allowed another demo period."
              : result.error || "The online demo could not be activated.",
        });
        return;
      }
      const expiryDate = new Date(result.expiryMs);
      toast({
        title: `${plan.name} demo activated`,
        description: `Online demo active for ${result.days ?? plan.demo?.days ?? 0} days (until ${formatBillingDate(expiryDate)}).`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Demo plan failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setOnlineDemoPlanBusy(false);
    }
  }, [
    billingFirestoreCompanyId,
    formatBillingDate,
    isBillingOwner,
    user,
  ]);

  const hasActiveStripeSubscription = useMemo(
    () => typeof company?.stripeSubscriptionId === "string" && company.stripeSubscriptionId.trim().length > 0,
    [company?.stripeSubscriptionId]
  );

  /** Firestore `false` = user ne off kiya; missing/`true` = Stripe-style default auto-renew on. */
  const autoRenewCheckboxChecked = useMemo(
    () => hasActiveStripeSubscription && company?.billingAutoRenew !== false,
    [hasActiveStripeSubscription, company?.billingAutoRenew]
  );

  /** Webhook `invoice.payment_failed` + `billingAutoRenew` — 3 din tak owner ko yahan dikhao. */
  const billingRenewFailureMessage = useMemo(() => {
    const raw = company as Record<string, unknown> | undefined;
    if (!raw) return null;
    const until = raw.billingAutoRenewFailureNoticeUntilMs;
    if (typeof until !== "number" || !Number.isFinite(until) || until <= Date.now()) return null;
    const en = raw.billingAutoRenewFailureNoticeEn;
    if (typeof en === "string" && en.trim()) return en.trim();
    return "Renewal failed: insufficient balance on your saved card. You have 3 extra days to renew manually — after that, this company will move to the Basic (free) plan.";
  }, [company]);

  /** Neeche wale paid columns: Firestore snapshot pills — live trailing-year math mat chalao. */
  const renderFrozenDowngradeSnapshot = useCallback(
    (columnPlanId: PlanId) => {
      const snap = findFrozenSnapshotForPlan(billingFrozenLedger, columnPlanId);
      if (!snap) return null;
      if (planTierIndex(currentPlanId) <= planTierIndex(columnPlanId)) return null;
      const colPlan = plans.find((x) => x.id === columnPlanId);
      if (!colPlan || colPlan.isFree) return null;
      const y = colPlan.price.yearly;
      // Advance column: Pro par bhi freeze ho = ladder Adv→Pro→Pro+ → copy me "… to Pro"; seedha Adv→Pro+ → "… to Pro Plus".
      let shiftedToPlanId: PlanId = currentPlanId;
      if (columnPlanId === "advance") {
        if (currentPlanId === "pro-plus") {
          const proFrozen = findFrozenSnapshotForPlan(billingFrozenLedger, "pro");
          shiftedToPlanId = proFrozen ? "pro" : "pro-plus";
        } else if (currentPlanId === "pro") {
          shiftedToPlanId = "pro";
        }
      }
      const shiftedToPlan = plans.find((x) => x.id === shiftedToPlanId);
      const shiftedToLabel =
        shiftedToPlan?.name ??
        shiftedToPlanId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return (
        <div className="flex flex-col items-center gap-1.5 mb-2 w-full max-w-[280px] mx-auto">
          <p className="text-[10px] text-muted-foreground text-center leading-snug px-1">
            {/* Past tense: upgrade ho chuka — “was” ke sath “shifted” consistent. */}
            When you shifted from <strong className="text-foreground">{colPlan.name}</strong> to{" "}
            <strong className="text-foreground">{shiftedToLabel}</strong>, your usage was:
          </p>
          {/* Pink Balance pill hide — sirf frozen Usage snapshot. */}
          <div className={PRORATION_PILL_USAGE_FROZEN_CLASS}>
            <span>
              Usage: {displaySymbol}{" "}{snap.frozenUsageNpr.toFixed(2)}
              {formatUsageLineSuffix(snap.frozenUsageNpr, y, y)}
            </span>
          </div>
        </div>
      );
    },
    [billingFrozenLedger, currentPlanId, plans]
  );

  /** Paid accounts: plan changes only via table (no free-plan checkout below). */
  const showStandardCheckout = !isPaidCompany && !selectedPlanDetails.isFree;
  const selectedMobilePlan = billingCatalogPlans[mobilePlanIndex] ?? selectedPlanDetails;
  /** Mobile: checkout only when a paid plan tab is selected. */
  const showMobileCheckoutSection = isMobile && !isPaidCompany && !selectedMobilePlan.isFree;

  if (loading || !selectedPlanDetails || billingPolicyLoading) {
    return (
      // Billing page: mobile true full-width vs viewport (2px side gap), ignores parent content padding.
      <div className="relative left-1/2 w-[calc(100vw-4px)] max-w-[calc(100vw-4px)] -translate-x-1/2 box-border py-4 sm:left-auto sm:w-[calc(100%-10px)] sm:max-w-[calc(100vw-10px)] sm:translate-x-0 sm:mx-[5px] sm:py-6">
        <Card className={cn("w-full max-w-none shadow-sm", BILLING_OUTLINE_CLASS)}>
          <CardHeader>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="flex justify-center items-center gap-2 my-6">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-10 w-40" />
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative left-1/2 w-[calc(100vw-4px)] max-w-[calc(100vw-4px)] -translate-x-1/2 box-border py-4 sm:left-auto sm:w-[calc(100%-10px)] sm:max-w-[calc(100vw-10px)] sm:translate-x-0 sm:mx-[5px] sm:py-6 flex flex-col min-h-[calc(100dvh-5rem)] gap-6">
      <Card className={cn("w-full max-w-none shadow-sm", BILLING_OUTLINE_CLASS)}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
            <CardTitle className="text-3xl font-bold">Billing & Plans</CardTitle>
            <CardDescription>Choose a plan that fits your needs.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleDownloadPlansPdf()}>
              {/* User asked for downloadable plan PDF on web/static. */}
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            {isBillingOwner
              ? billingCatalogPlans
                  .filter((plan) => !plan.isFree && plan.demo?.enabled === true)
                  .map((plan) => (
                    <Button
                      key={`demo-${plan.id}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={onlineDemoPlanBusy || companyLoading || billingOfflineBlock}
                      onClick={() => void handleOnlineDemoPlan(plan)}
                      title={`Online demo — ${plan.name} for ${plan.demo?.days ?? 0} days`}
                    >
                      {onlineDemoPlanBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Demo: {plan.name} ({plan.demo?.days ?? 0}d)
                    </Button>
                  ))
              : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AdBillingPointsCard />
          {/* Country choose → saare plan columns converted amount + symbol */}
          <div className="mb-4 max-w-md space-y-2">
            <Label htmlFor="billing-price-country">View prices in country</Label>
            <CountrySearchCombobox
              value={billingPriceCountry}
              onChange={setPriceCountry}
              placeholder="Search country…"
              symbolWithOne={false}
            />
            <p className="text-xs text-muted-foreground">
              Region: <span className="font-medium text-foreground">{regionLabel}</span> ·{" "}
              {displaySymbol} ({displayCurrency})
              {billingFxLoading ? " — updating rates…" : null}
            </p>
          </div>
          {billingOfflineBlock ? (
            <div
              className={cn(
                "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground mb-4 space-y-1.5",
                BILLING_OUTLINE_CLASS
              )}
            >
              {/* Offline par bhi SQLite + `companyPlanLocalCache` se current tier dikhe — sirf network wale actions band. */}
              <p className="font-medium">You&apos;re offline</p>
              <p className="text-muted-foreground leading-snug">
                New payments and server-side plan changes need internet. Your plan on this device stays on the last
                synced subscription and unlock session until you reconnect.
              </p>
            </div>
          ) : null}
          {!hasSelectedCompany ? (
            <div className="mx-auto mb-4 max-w-5xl rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              You are viewing your account plan. You can subscribe before creating a company; the plan will apply
              to every company you own. Shared companies continue to use their owner&apos;s plan.
            </div>
          ) : null}
          {isPaidCompany && billingRenewFailureMessage ? (
            <Alert variant="destructive" className={cn("mb-4", BILLING_OUTLINE_CLASS)}>
              <AlertTitle>Card renewal failed</AlertTitle>
              <AlertDescription className="text-sm">{billingRenewFailureMessage}</AlertDescription>
            </Alert>
          ) : null}
          {company && (
            <div className={cn("rounded-lg bg-muted/30 p-4 mb-6 text-sm space-y-3", BILLING_OUTLINE_CLASS)}>
              <div>
                <span className="text-muted-foreground">Subscribed plan — current: </span>
                <strong>{currentSubscribedPlanLabel}</strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-6">
                <div>
                  <span className="text-muted-foreground">Joined date: </span>
                  <strong className={cn("font-semibold", dateSystem === "Both" ? "whitespace-nowrap" : "")}>
                    {formatBillingDate(joinedDate)}
                  </strong>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={cn("text-muted-foreground", expiryMs == null && "line-through decoration-muted-foreground/70")}>
                    Expiry date:{" "}
                  </span>
                  <span className={cn(dateSystem === "Both" && "whitespace-nowrap", expiryMs == null && "line-through decoration-muted-foreground/70")}>
                    <strong
                      className={cn(
                        "font-semibold",
                        expiryMs == null && "text-muted-foreground font-normal"
                      )}
                    >
                      {formatBillingExpiry(expiryDate)}
                    </strong>
                    {daysLeftOnPlan != null ? (
                      <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                        {planExpiredByClock ? (
                          "(Expired)"
                        ) : (
                          <>
                            ({daysLeftOnPlan} {daysLeftOnPlan === 1 ? "day" : "days"} left)
                          </>
                        )}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          )}

          {isMobile ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-snug px-0.5">{BILLING_FEATURES_SCOPE_NOTE_EN}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {billingCatalogPlans.map((p, idx) => (
                  <Button
                    key={`mobile-tab-${p.id}`}
                    type="button"
                    size="sm"
                    variant={idx === mobilePlanIndex ? "default" : "outline"}
                    onClick={() => setMobilePlanIndex(idx)}
                    className="shrink-0"
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
              <div
                className={cn("rounded-lg overflow-hidden", BILLING_OUTLINE_CLASS)}
                onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
                onTouchEnd={(e) => {
                  // Swipe navigation: one column per screen.
                  const endX = e.changedTouches[0]?.clientX;
                  if (touchStartX == null || endX == null) return;
                  const delta = endX - touchStartX;
                  if (Math.abs(delta) < 40) return;
                  setMobilePlanIndex((prev) => {
                    if (delta < 0) return Math.min(billingCatalogPlans.length - 1, prev + 1);
                    return Math.max(0, prev - 1);
                  });
                }}
              >
                {(() => {
                  const p = billingCatalogPlans[mobilePlanIndex] ?? billingCatalogPlans[0];
                  if (!p) return null;
                  const isSelected = p.id === selectedPlanId;
                  return (
                    <div className={cn("p-3", isSelected && "bg-muted/30")}>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold">{p.name}</h3>
                        {p.highlight ? <Badge>Most Popular</Badge> : null}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{p.tagline}</p>
                      <div className="mt-2">
                        <PlanPricingBreakdown
                          plan={p}
                          country={billingPriceCountry}
                          fx={fx}
                          pricingSettings={pricingSettings}
                        />
                      </div>
                      <div className="mt-3 space-y-2">
                        {allFeaturesConfig.map((feature, featureIdx) => {
                          const { text, enabled } = getFeatureValue(p, feature.key);
                          const boolIcons = BILLING_BOOLEAN_ICON_KEYS.includes(feature.key);
                          const onlineCompaniesOn = getFeatureValue(p, "maxCompanies").enabled;
                          const offlineCompaniesOn = getFeatureValue(p, "maxCompaniesLocal").enabled;
                          const scopeDeactivated = isBillingFeatureScopeDeactivated(
                            featureIdx,
                            onlineCompaniesOn,
                            offlineCompaniesOn
                          );
                          return (
                            <Fragment key={`${p.id}-${feature.key}-mobile`}>
                              {featureIdx === BILLING_ONLINE_OFFLINE_SPLIT_INDEX ? (
                                <div
                                  className="h-[2px] bg-foreground/55 my-1"
                                  role="separator"
                                  aria-label="Online features above, offline features below"
                                />
                              ) : null}
                              <div
                                className={cn(
                                  "flex items-start justify-between gap-3 border-b-2 border-foreground/25 pb-1 text-sm rounded-sm px-1",
                                  scopeDeactivated && BILLING_SCOPE_DEACTIVATED_CELL_CLASS
                                )}
                                title={
                                  scopeDeactivated
                                    ? featureIdx < BILLING_ONLINE_OFFLINE_SPLIT_INDEX
                                      ? "Online service not available on this plan (Max Companies online: None)"
                                      : "Offline service not available on this plan (Max Companies local: None)"
                                    : undefined
                                }
                              >
                                <span className="min-w-0 flex-1 text-muted-foreground">
                                  <BillingFeatureLabelWithInfo helpKey={feature.key} label={feature.label} />
                                </span>
                                <span className="font-medium text-right inline-flex items-center justify-end gap-1">
                                  {boolIcons ? (
                                    enabled ? (
                                      <Check
                                        className={cn(
                                          "h-5 w-5 shrink-0",
                                          scopeDeactivated ? BILLING_SCOPE_DEACTIVATED_ICON_CLASS : "text-green-500"
                                        )}
                                        aria-hidden
                                      />
                                    ) : (
                                      <X
                                        className={cn(
                                          "h-5 w-5 shrink-0",
                                          scopeDeactivated ? BILLING_SCOPE_DEACTIVATED_ICON_CLASS : "text-red-500"
                                        )}
                                        aria-hidden
                                      />
                                    )
                                  ) : (
                                    <span
                                      className={cn(
                                        "tabular-nums",
                                        (!enabled || scopeDeactivated) && text !== "Unlimited" && "text-muted-foreground"
                                      )}
                                    >
                                      {text}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className={cn("rounded-lg p-3 space-y-2", BILLING_OUTLINE_CLASS)}>
                {/* Mobile action panel: parity with desktop "Term & action" row. */}
                <p className="text-sm font-medium">
                  <BillingFeatureLabelWithInfo helpKey="term-action" label="Term & action" />
                </p>
                {isPaidCompany ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      document.getElementById("billing-addons")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    Buy User/device
                  </Button>
                ) : null}
                {(() => {
                  const p = selectedMobilePlan;
                  const change = classifyPlanChange(currentPlanId, p.id);
                  const loadPay = prorationLoading === `pay:${p.id}`;
                  const loadDown = downgradeLoading === `down:${p.id}`;

                  if (p.id === currentPlanId) {
                    if (!isPaidCompany) {
                      return <p className="text-xs text-muted-foreground">Current plan. Choose a paid plan to upgrade.</p>;
                    }
                    return (
                      <div className="space-y-2">
                        <BillingTermSelectWithInfo
                          value={colTerms[p.id]}
                          onValueChange={(v) => requestPaidTermChange(p.id, v)}
                          tip={billingTermStackTip(p.name, colTerms[p.id])}
                        />
                        {/* Mobile: ek hi column dikhta hai — credit / net yahin (desktop jaisa breakdown). */}
                        {(() => {
                          const curRow = plans.find((x) => x.id === currentPlanId);
                          if (!curRow || curRow.isFree) return null;
                          const nowMs = Date.now();
                          const remainingMsRenew =
                            expiryMs != null && Number.isFinite(expiryMs) ? Math.max(0, expiryMs - nowMs) : 0;
                          const renewLedger = renewColumnFrozenUsageAndCreditDaysLeft({
                            nowMs,
                            currentExpiryMs: expiryMs,
                            planYearly: curRow.price.yearly,
                            remainingMs: remainingMsRenew,
                          });
                          const liveBalance = renewColumnLiveBalance({
                            nowMs,
                            expiryMs,
                            planYearly: curRow.price.yearly,
                            remainingMs: remainingMsRenew,
                          });
                          const usageNprRenewMobileCur = frozenLowerPaidTierInLedger
                            ? usageNprAccruedSinceCurrentTierStart({
                                nowMs,
                                planUpgradedAtMs: planUpgradedAtMsForUsageRamp,
                                planYearly: curRow.price.yearly,
                              })
                            : renewLedger.frozenUsageNpr;
                          const yearlyGross = curRow.price.yearly;
                          return (
                            <>
                              <div className="flex flex-col items-center gap-1.5">
                                <div className={PRORATION_PILL_CREDIT_CLASS}>
                                  <span>
                                    Balance ≈ {displaySymbol}{" "}{liveBalance.balanceNpr.toFixed(2)} ·{" "}
                                    <strong className="font-semibold text-pink-950 dark:text-pink-50">
                                      {formatCreditPillDaysLeftDisplay(liveBalance.balanceDays)}
                                    </strong>{" "}
                                    {creditPillAdjustedDayWord(liveBalance.balanceDays)} left
                                  </span>
                                </div>
                                <div className={PRORATION_PILL_USAGE_CLASS}>
                                  <span>
                                    Usage: {displaySymbol}{" "}{usageNprRenewMobileCur.toFixed(2)}
                                    {formatUsageLineSuffix(
                                      usageNprRenewMobileCur,
                                      yearlyGross,
                                      yearlyGross
                                    )}
                                  </span>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                        {/* Sirf current paid column: Stripe subscription + webhook grace. */}
                        <div className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-2 text-left">
                          <Checkbox
                            id="billing-auto-renew-mobile"
                            checked={autoRenewCheckboxChecked}
                            disabled={
                              !hasActiveStripeSubscription ||
                              autoRenewSaving ||
                              billingOfflineBlock ||
                              !billingFirestoreCompanyId
                            }
                            onCheckedChange={(v) => void handleBillingAutoRenewChange(v === true)}
                          />
                          <Label
                            htmlFor="billing-auto-renew-mobile"
                            className="min-w-0 text-xs font-medium cursor-pointer leading-tight"
                          >
                            Auto renew
                          </Label>
                          <AutoRenewInfoButton hasStripeSubscription={hasActiveStripeSubscription} />
                        </div>
                        <RadioGroup
                          value={prorationGateway}
                          onValueChange={(v) => setProrationGateway(v as "stripe" | "khalti" | "esewa")}
                          className="flex flex-col gap-2 text-xs"
                        >
                          <Label
                            className={cn(
                              "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                              prorationStripeAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                              prorationGateway === "stripe" && prorationStripeAvail && "border-primary"
                            )}
                          >
                            <RadioGroupItem
                              value="stripe"
                              id="proration-stripe-mobile"
                              className="shrink-0"
                              disabled={!prorationStripeAvail}
                            />
                            Stripe (cards)
                          </Label>
                          <Label
                            className={cn(
                              "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                              prorationKhaltiAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                              prorationGateway === "khalti" && prorationKhaltiAvail && "border-primary"
                            )}
                          >
                            <RadioGroupItem
                              value="khalti"
                              id="proration-khalti-mobile"
                              className="shrink-0"
                              disabled={!prorationKhaltiAvail}
                            />
                            Khalti
                          </Label>
                          <Label
                            className={cn(
                              "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                              prorationEsewaAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                              prorationGateway === "esewa" && prorationEsewaAvail && "border-primary"
                            )}
                          >
                            <RadioGroupItem
                              value="esewa"
                              id="proration-esewa-mobile"
                              className="shrink-0"
                              disabled={!prorationEsewaAvail}
                            />
                            eSewa
                          </Label>
                        </RadioGroup>
                        <BillingTermsAndPayRow
                          termsId="proration-terms-mobile"
                          termsAccepted={billingPayTermsAccepted}
                          onTermsAcceptedChange={setBillingPayTermsAccepted}
                          payDisabled={!companyId || billingOfflineBlock || !prorationPayEnabled}
                          onPay={() => void handleProratedPay(p.id)}
                          payLabel={`pay with ${prorationGateway}`}
                          loading={loadPay}
                        />
                        {isPaidCompany ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              document
                                .getElementById("billing-addons")
                                ?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                          >
                            Buy User/device
                          </Button>
                        ) : null}
                      </div>
                    );
                  }

                  if (change === "downgrade") {
                    const basicColumnLockedMobile = isPaidCompany && p.id === "basic";
                    const tierLockedMobile =
                      isPaidCompany && isPaidTierDowngradeBlocked(p.id) && !planDowngradeEnabled;
                    // Desktop footer jaisa: admin ne paid→paid downgrade band kiya ho to mobile par bhi actions hide/disable.
                    // `change === "downgrade"` + paid target ⇒ current plan already paid — `basic` comparison TS-narrow redundant.
                    const adminBlocksPaidLowerMobile = !p.isFree && isPaidCompany && !planDowngradeEnabled;
                    return (
                      <div className="flex flex-col gap-2">
                        {renderFrozenDowngradeSnapshot(p.id)}
                        {/* Admin ne paid→paid downgrade band: sirf chhota locked copy — Basic wala alag link current column me. */}
                        {adminBlocksPaidLowerMobile ? (
                          <p className="text-xs text-muted-foreground text-center leading-snug px-0.5">
                            This tier is locked after your upgrade — you can&apos;t switch back here.
                          </p>
                        ) : null}
                        {basicColumnLockedMobile ? <PaidPlanBasicColumnLockedNotice /> : null}
                        {!(adminBlocksPaidLowerMobile && !p.isFree) ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            disabled={
                              loadDown ||
                              !companyId ||
                              basicColumnLockedMobile ||
                              tierLockedMobile ||
                              billingOfflineBlock
                            }
                            onClick={() => handleDowngrade(p.id)}
                          >
                            {loadDown ? <Loader2 className="h-4 w-4 animate-spin" /> : p.isFree ? "Select this plan" : `Downgrade to ${p.name}`}
                          </Button>
                        ) : null}
                        {/* Neeche paid tier: sirf Downgrade — value → cheap plan par zyada din; "Just change plan" sirf upgrade columns par. */}
                      </div>
                    );
                  }

                  if (!p.isFree && isPaidCompany) {
                    return (
                      <div className="space-y-2">
                        <BillingTermSelectWithInfo
                          value={colTerms[p.id]}
                          onValueChange={(v) => requestPaidTermChange(p.id, v)}
                          tip={billingTermStackTip(p.name, colTerms[p.id])}
                        />
                        {(() => {
                          const curRow = plans.find((x) => x.id === currentPlanId);
                          if (!curRow || curRow.isFree) return null;
                          const nowMs = Date.now();
                          const remainingMsMob = expiryMs != null && Number.isFinite(expiryMs) ? Math.max(0, expiryMs - nowMs) : 0;
                          const remainingValueNprMob = remainingPaidTimeValueNpr(
                            remainingMsMob,
                            curRow.price.yearly
                          );
                          const renewLedgerMob = renewColumnFrozenUsageAndCreditDaysLeft({
                            nowMs,
                            currentExpiryMs: expiryMs,
                            planYearly: curRow.price.yearly,
                            remainingMs: remainingMsMob,
                          });
                          const creditDaysCarriedMob =
                            change === "upgrade" && p.price.yearly > 0
                              ? upgradeTargetCreditDaysCarried(remainingValueNprMob, p.price.yearly)
                              : 0;
                          const liveBalanceMob = renewColumnLiveBalance({
                            nowMs,
                            expiryMs,
                            planYearly: curRow.price.yearly,
                            remainingMs: remainingMsMob,
                          });
                          const yearlyGrossMob = curRow.price.yearly;
                          const targetYearlyMob = p.price.yearly;
                          return (
                            <>
                              {billingShowUpgradePathParagraph(change) ? (
                                <p className="text-[11px] text-muted-foreground leading-snug">
                                  Upgrade: {curRow.name} usage stays on {curRow.name}; on {p.name} usage starts at zero.
                                  Remaining value counts toward {p.name} (≈{" "}
                                  <strong className="tabular-nums text-foreground">
                                    {creditDaysCarriedMob.toFixed(2)}
                                  </strong>{" "}
                                  days at {p.name} list rate before your new term). Then your purchased term extends the
                                  end date.
                                </p>
                              ) : null}
                              {change === "upgrade" ? (
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className={PRORATION_PILL_CREDIT_CLASS}>
                                    <span>
                                      Balance ≈ {displaySymbol}{" "}{remainingValueNprMob.toFixed(2)} · ≈{" "}
                                      <strong className="font-semibold text-pink-950 dark:text-pink-50">
                                        {creditDaysCarriedMob.toFixed(2)}
                                      </strong>{" "}
                                      {creditPillAdjustedDayWord(creditDaysCarriedMob)} left
                                    </span>
                                  </div>
                                  <div className={PRORATION_PILL_USAGE_CLASS}>
                                    <span>
                                      Usage: {displaySymbol}{" "}{(0).toFixed(2)}
                                      {formatUsageLineSuffix(0, targetYearlyMob, targetYearlyMob)}
                                    </span>
                                  </div>
                                  {/* Upgrade: "Pay now" net Stripe line mat dikhao — primary flow zero-wala "Just change plan" (bacha credit → din). */}
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className={PRORATION_PILL_CREDIT_CLASS}>
                                    <span>
                                      Balance ≈ {displaySymbol}{" "}{liveBalanceMob.balanceNpr.toFixed(2)} ·{" "}
                                      <strong className="font-semibold text-pink-950 dark:text-pink-50">
                                        {formatCreditPillDaysLeftDisplay(liveBalanceMob.balanceDays)}
                                      </strong>{" "}
                                      {creditPillAdjustedDayWord(liveBalanceMob.balanceDays)} left
                                    </span>
                                  </div>
                                  <div className={PRORATION_PILL_USAGE_CLASS}>
                                    <span>
                                      Usage: {displaySymbol}{" "}{renewLedgerMob.frozenUsageNpr.toFixed(2)}
                                      {formatUsageLineSuffix(
                                        renewLedgerMob.frozenUsageNpr,
                                        yearlyGrossMob,
                                        yearlyGrossMob
                                      )}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <Button
                          type="button"
                          className="w-full"
                          disabled={loadPay || !companyId || billingOfflineBlock}
                          onClick={() => {
                            setSelectedPlanId(p.id);
                            void handleProratedPay(p.id);
                          }}
                        >
                          {loadPay ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : change === "upgrade" ? (
                            "Upgrade (prorated)"
                          ) : (
                            "Renew (prorated)"
                          )}
                        </Button>
                        {change === "upgrade" ? (
                          <>
                            <p className="text-[10px] text-muted-foreground text-center leading-snug px-0.5">
                              {PLAN_CHANGE_ONLY_SELECT_OPTION.label}: popup — credit → days on higher plan (end date
                              updates); no payment.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              disabled={loadPay || !companyId || billingOfflineBlock}
                              onClick={() => {
                                setSelectedPlanId(p.id);
                                setPlanChangeOnlyTargetId(p.id);
                              }}
                            >
                              {PLAN_CHANGE_ONLY_SELECT_OPTION.label}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    );
                  }

                  if (!p.isFree && currentPlanId === "basic") {
                    return (
                      <div className="space-y-2">
                        <BillingTermSelectWithInfo
                          value={colTerms[p.id]}
                          onValueChange={(v) => setColTerms((prev) => ({ ...prev, [p.id]: v }))}
                          tip={billingNewSubscriberTermTip(p.name, colTerms[p.id])}
                        />
                        <Button type="button" className="w-full" onClick={() => setSelectedPlanId(p.id)}>
                          Subscribe to {p.name} below
                        </Button>
                      </div>
                    );
                  }

                  if (p.isFree && p.id !== currentPlanId) {
                    const basicFreeLockedMob = isPaidCompany && p.id === "basic";
                    return (
                      <div className="flex flex-col gap-2">
                        {basicFreeLockedMob ? <PaidPlanBasicColumnLockedNotice /> : null}
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={loadDown || !companyId || basicFreeLockedMob}
                          onClick={() => handleDowngrade(p.id)}
                        >
                          {loadDown ? <Loader2 className="h-4 w-4 animate-spin" /> : "Select this plan"}
                        </Button>
                      </div>
                    );
                  }

                  return <p className="text-xs text-muted-foreground">No action for this plan.</p>;
                })()}
              </div>
              <p className="text-xs text-muted-foreground">Swipe left/right or use tabs to switch plan columns.</p>
            </div>
          ) : (
          /* scrollContainer=false: single horizontal scroll on outer div — avoids clipped first column. table-fixed + break-words keeps text inside each cell. */
          <div className={cn("rounded-lg overflow-x-auto", BILLING_OUTLINE_CLASS)}>
            <Table
              scrollContainer={false}
              className={cn(
                "w-full min-w-0 table-fixed border-collapse",
                // Matrix grid bhi outer jaisi bold — 2px + foreground/30 taaki vertical/horizontal ek jaise moti lagen.
                "[&_th]:!border-r-2 [&_td]:!border-r-2 [&_th]:!border-foreground/30 [&_td]:!border-foreground/30",
                "[&_tr>th:last-child]:border-r-0 [&_tr>td:last-child]:border-r-0",
                "[&_thead>tr]:!border-b-2 [&_thead>tr]:!border-foreground/30",
                "[&_tbody>tr]:!border-b-2 [&_tbody>tr]:!border-foreground/30",
                "[&_tfoot>tr]:!border-b-2 [&_tfoot>tr]:!border-foreground/30 [&_tfoot]:!border-t-2 [&_tfoot]:!border-foreground/30"
              )}
            >
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%] min-w-0 max-w-[22%] whitespace-normal break-words align-top !whitespace-normal px-2 py-3">
                    <div className="flex flex-col gap-1.5 text-left">
                      <span className="font-semibold text-base">Features</span>
                      <p className="text-[11px] sm:text-xs font-normal text-muted-foreground leading-snug">
                        {BILLING_FEATURES_SCOPE_NOTE_EN}
                      </p>
                    </div>
                  </TableHead>
                  {billingCatalogPlans.map((p) => {
                    const isSelected = p.id === selectedPlanId;
                    const offerDate = p.limitedTimeOfferDate ? (p.limitedTimeOfferDate as { toDate: () => Date }).toDate() : null;
                    const isOfferValid = offerDate && offerDate > new Date();
                    // Bank Settings downgrade ON ho to "Locked" badge mat dikhao — button/API tier lock override.
                    const tierLockedHeader =
                      isPaidCompany && isPaidTierDowngradeBlocked(p.id) && !planDowngradeEnabled;

                    return (
                      <TableHead
                        key={p.id}
                        className={cn(
                          "w-[19.5%] min-w-0 max-w-[19.5%] text-center align-top !whitespace-normal whitespace-normal break-words px-2 py-3",
                          isSelected && "bg-muted",
                          // Column tap = isi plan ke liye live credit / net lines (dropdown ke alawa).
                          "cursor-pointer select-none"
                        )}
                        onClick={() => setSelectedPlanId(p.id)}
                      >
                        <div className="p-2 min-w-0">
                          <div className="flex flex-wrap items-center justify-center gap-2 min-w-0">
                            <h3 className="text-xl font-bold break-words min-w-0 leading-tight">{p.name}</h3>
                            {p.id === currentPlanId ? (
                              <Badge className="shrink-0 text-[10px] sm:text-xs" variant="default">
                                Current
                              </Badge>
                            ) : null}
                            {tierLockedHeader ? (
                              <Badge className="shrink-0 text-[10px] sm:text-xs" variant="outline">
                                Locked
                              </Badge>
                            ) : null}
                            {p.highlight && <Badge className="shrink-0">Most Popular</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground break-words mt-1">{p.tagline}</p>
                          {isOfferValid && (
                            <Badge variant="destructive" className="mt-2 whitespace-normal text-center max-w-full break-words">
                              Offer ends {formatDateFns(offerDate, "MMM do, yyyy")}
                            </Badge>
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Pricing rows — monthly / yearly / save (country-converted) */}
                <TableRow>
                  <TableCell className="min-w-0 font-medium whitespace-normal break-words px-2 py-2 align-middle">
                    <BillingFeatureLabelWithInfo helpKey="price-monthly" label="Monthly" />
                  </TableCell>
                  {billingCatalogPlans.map((p) => (
                    <TableCell
                      key={`${p.id}-price-monthly`}
                      className={cn(
                        "min-w-0 text-center align-middle px-2 py-2",
                        p.id === selectedPlanId && "bg-muted"
                      )}
                    >
                      <PlanPricingLineCell
                        plan={p}
                        country={billingPriceCountry}
                        fx={fx}
                        pricingSettings={pricingSettings}
                        line="monthly"
                      />
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="min-w-0 font-medium whitespace-normal break-words px-2 py-2 align-middle">
                    <BillingFeatureLabelWithInfo helpKey="price-yearly" label="Yearly" />
                  </TableCell>
                  {billingCatalogPlans.map((p) => (
                    <TableCell
                      key={`${p.id}-price-yearly`}
                      className={cn(
                        "min-w-0 text-center align-middle px-2 py-2",
                        p.id === selectedPlanId && "bg-muted"
                      )}
                    >
                      <PlanPricingLineCell
                        plan={p}
                        country={billingPriceCountry}
                        fx={fx}
                        pricingSettings={pricingSettings}
                        line="yearly"
                      />
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="min-w-0 font-medium whitespace-normal break-words px-2 py-2 align-middle text-green-700 dark:text-green-500">
                    <BillingFeatureLabelWithInfo helpKey="price-save" label="Save" />
                  </TableCell>
                  {billingCatalogPlans.map((p) => (
                    <TableCell
                      key={`${p.id}-price-save`}
                      className={cn(
                        "min-w-0 text-center align-middle px-2 py-2",
                        p.id === selectedPlanId && "bg-muted"
                      )}
                    >
                      <PlanPricingLineCell
                        plan={p}
                        country={billingPriceCountry}
                        fx={fx}
                        pricingSettings={pricingSettings}
                        line="save"
                      />
                    </TableCell>
                  ))}
                </TableRow>
                {allFeaturesConfig.map((feature, featureIdx) => (
                  <Fragment key={feature.key}>
                    {featureIdx === BILLING_ONLINE_OFFLINE_SPLIT_INDEX ? (
                      <TableRow className="hover:bg-transparent border-0">
                        <TableCell
                          colSpan={billingCatalogPlans.length + 1}
                          className="p-0 border-0"
                        >
                          <div
                            className="h-[2px] bg-foreground/55"
                            role="separator"
                            aria-label="Online features above, offline features below"
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                    <TableRow>
                      <TableCell className="min-w-0 max-w-[22%] font-medium whitespace-normal break-words align-middle !whitespace-normal px-2 py-2">
                        <BillingFeatureLabelWithInfo helpKey={feature.key} label={feature.label} />
                      </TableCell>
                      {billingCatalogPlans.map((p) => {
                        const { text, enabled } = getFeatureValue(p, feature.key);
                        const isSelected = p.id === selectedPlanId;
                        const onlineCompaniesOn = getFeatureValue(p, "maxCompanies").enabled;
                        const offlineCompaniesOn = getFeatureValue(p, "maxCompaniesLocal").enabled;
                        const scopeDeactivated = isBillingFeatureScopeDeactivated(
                          featureIdx,
                          onlineCompaniesOn,
                          offlineCompaniesOn
                        );
                        return (
                          <TableCell
                            key={`${p.id}-${feature.key}`}
                            className={cn(
                              "min-w-0 max-w-[19.5%] text-center whitespace-normal break-words align-middle !whitespace-normal px-2 py-2",
                              isSelected && "bg-muted",
                              scopeDeactivated && BILLING_SCOPE_DEACTIVATED_CELL_CLASS
                            )}
                            title={
                              scopeDeactivated
                                ? featureIdx < BILLING_ONLINE_OFFLINE_SPLIT_INDEX
                                  ? "Online service not available on this plan (Max Companies online: None)"
                                  : "Offline service not available on this plan (Max Companies local: None)"
                                : undefined
                            }
                          >
                            {BILLING_BOOLEAN_ICON_KEYS.includes(feature.key) ? (
                              enabled ? (
                                <Check
                                  className={cn(
                                    "h-5 w-5 mx-auto shrink-0",
                                    scopeDeactivated ? BILLING_SCOPE_DEACTIVATED_ICON_CLASS : "text-green-500"
                                  )}
                                />
                              ) : (
                                <X
                                  className={cn(
                                    "h-5 w-5 mx-auto shrink-0",
                                    scopeDeactivated ? BILLING_SCOPE_DEACTIVATED_ICON_CLASS : "text-red-500"
                                  )}
                                />
                              )
                            ) : (
                              <span
                                className={cn(
                                  "inline-block max-w-full break-words",
                                  (!enabled || scopeDeactivated) && text !== "Unlimited" && "text-muted-foreground"
                                )}
                              >
                                {text}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="align-top text-muted-foreground text-sm min-w-0 max-w-[22%] whitespace-normal break-words !whitespace-normal px-2 py-3">
                    <div className="flex flex-col items-stretch gap-2">
                      <BillingFeatureLabelWithInfo helpKey="term-action" label="Term & action" />
                      {isPaidCompany ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full max-w-[200px]"
                          onClick={() => {
                            document
                              .getElementById("billing-addons")
                              ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          Buy User/device
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  {billingCatalogPlans.map((p) => {
                    const isSelected = p.id === selectedPlanId;
                    const change = classifyPlanChange(currentPlanId, p.id);
                    const curPlanRow = plans.find((x) => x.id === currentPlanId);
                    const loadPay = prorationLoading === `pay:${p.id}`;
                    const loadDown = downgradeLoading === `down:${p.id}`;

                    // Credit / Usage pills sirf highlighted column; upar wali line har paid column par = is term ke din + stack copy.
                    const prorationHint =
                      isPaidCompany && change !== "downgrade" && !p.isFree && curPlanRow && !curPlanRow.isFree ? (
                        (() => {
                          const nowMs = Date.now();
                          // Current plan column: hamesha apni Credit/Usage dikhao — warna Pro select karte hi Advance ki pills gayab (user confusion).
                          const showLiveProrationAmounts = p.id === selectedPlanId || p.id === currentPlanId;
                          const daysLeftCurrentPlan = daysLeftRounded(nowMs, expiryMs);
                          const remainingMsForPills =
                            expiryMs != null && Number.isFinite(expiryMs) ? Math.max(0, expiryMs - nowMs) : 0;
                          const remainingValueNprDesk = remainingPaidTimeValueNpr(
                            remainingMsForPills,
                            curPlanRow.price.yearly
                          );
                          const renewLedgerDesk = renewColumnFrozenUsageAndCreditDaysLeft({
                            nowMs,
                            currentExpiryMs: expiryMs,
                            planYearly: curPlanRow.price.yearly,
                            remainingMs: remainingMsForPills,
                          });
                          const creditCarriedDesk =
                            change === "upgrade" && p.price.yearly > 0
                              ? upgradeTargetCreditDaysCarried(remainingValueNprDesk, p.price.yearly)
                              : 0;
                          const liveBalanceDesk = renewColumnLiveBalance({
                            nowMs,
                            expiryMs,
                            planYearly: curPlanRow.price.yearly,
                            remainingMs: remainingMsForPills,
                          });
                          const yearlyGrossDesk = curPlanRow.price.yearly;
                          const targetYearlyDesk = p.price.yearly;
                          const usageNprRenewDesk = frozenLowerPaidTierInLedger
                            ? usageNprAccruedSinceCurrentTierStart({
                                nowMs,
                                planUpgradedAtMs: planUpgradedAtMsForUsageRamp,
                                planYearly: curPlanRow.price.yearly,
                              })
                            : renewLedgerDesk.frozenUsageNpr;
                          return (
                            <>
                              {billingShowUpgradePathParagraph(change) ? (
                                <p className="text-[11px] text-muted-foreground leading-snug">
                                  Upgrade path: your remaining{" "}
                                  <strong className="tabular-nums text-foreground">{daysLeftCurrentPlan}</strong> day
                                  {daysLeftCurrentPlan === 1 ? "" : "s"} on {curPlanRow.name} — usage on{" "}
                                  {curPlanRow.name} is frozen; on {p.name} usage starts at zero. Carried value ≈{" "}
                                  <strong className="tabular-nums text-foreground">
                                    {creditCarriedDesk.toFixed(2)}
                                  </strong>{" "}
                                  days on {p.name} before your new term extends the end date.
                                </p>
                              ) : null}
                              {showLiveProrationAmounts ? (
                                change === "upgrade" ? (
                                  <div className="flex flex-col items-center gap-1.5 max-w-[280px] mx-auto">
                                    <div className={PRORATION_PILL_CREDIT_CLASS}>
                                      <span>
                                        Balance ≈ {displaySymbol}{" "}{remainingValueNprDesk.toFixed(2)} · ≈{" "}
                                        <strong className="font-semibold text-pink-950 dark:text-pink-50">
                                          {creditCarriedDesk.toFixed(2)}
                                        </strong>{" "}
                                        {creditPillAdjustedDayWord(creditCarriedDesk)} left
                                      </span>
                                    </div>
                                    <div className={PRORATION_PILL_USAGE_CLASS}>
                                      <span>
                                        Usage: {displaySymbol}{" "}{(0).toFixed(2)}
                                        {formatUsageLineSuffix(0, targetYearlyDesk, targetYearlyDesk)}
                                      </span>
                                    </div>
                                    {/* Upgrade: Stripe net breakdown hide — user ko sirf credit/days + "Just change plan" dikhana hai. */}
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-1.5">
                                    <div className={PRORATION_PILL_CREDIT_CLASS}>
                                      <span>
                                        Balance ≈ {displaySymbol}{" "}{liveBalanceDesk.balanceNpr.toFixed(2)} ·{" "}
                                        <strong className="font-semibold text-pink-950 dark:text-pink-50">
                                          {formatCreditPillDaysLeftDisplay(liveBalanceDesk.balanceDays)}
                                        </strong>{" "}
                                        {creditPillAdjustedDayWord(liveBalanceDesk.balanceDays)} left
                                      </span>
                                    </div>
                                    <div className={PRORATION_PILL_USAGE_CLASS}>
                                      <span>
                                        Usage: {displaySymbol}{" "}{usageNprRenewDesk.toFixed(2)}
                                        {formatUsageLineSuffix(
                                          usageNprRenewDesk,
                                          yearlyGrossDesk,
                                          yearlyGrossDesk
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                )
                              ) : null}
                            </>
                          );
                        })()
                      ) : null;

                    const adminBlocksPaidLowerColumn =
                      change === "downgrade" && !p.isFree && isPaidCompany && !planDowngradeEnabled;

                    const downgradeHint =
                      change === "downgrade" && currentPlanId !== "basic" && isPaidCompany ? (
                        (() => {
                          if (p.isFree) return null;
                          if (!planDowngradeEnabled) {
                            return (
                              <p className="text-xs text-muted-foreground leading-snug">
                                This tier is locked after your upgrade — you can&apos;t switch back here.
                              </p>
                            );
                          }
                          const tgt = p;
                          const curY = curPlanRow?.price.yearly ?? 0;
                          const q = quoteDowngradeNewExpiry({
                            nowMs: Date.now(),
                            currentExpiryMs: expiryMs,
                            currentYearly: curY,
                            targetYearly: tgt.price.yearly,
                          });
                          return (
                            <p className="text-xs text-muted-foreground leading-snug">
                              If you downgrade, your remaining paid time converts to about{" "}
                              <strong className="tabular-nums text-foreground">
                                {q.extraDays.toFixed(2)}
                              </strong>{" "}
                              days on <span className="font-medium">{tgt.name}</span> at that plan&apos;s yearly rate.
                            </p>
                          );
                        })()
                      ) : null;

                    let footerInner: ReactNode = null;
                    // Per-column actions: Basic row uses `/api/payments/initiate`; paid rows use proration (`plan-change-checkout`) or `downgrade-plan`.
                    if (p.id === currentPlanId) {
                      footerInner =
                        isPaidCompany ? (
                          <div className="flex flex-col items-stretch gap-2 max-w-[240px] mx-auto">
                            <BillingTermSelectWithInfo
                              value={colTerms[p.id]}
                              onValueChange={(v) => requestPaidTermChange(p.id, v)}
                              tip={billingTermStackTip(p.name, colTerms[p.id])}
                            />
                            {prorationHint}
                            <div className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-2 text-left">
                              <Checkbox
                                id="billing-auto-renew-desk"
                                checked={autoRenewCheckboxChecked}
                                disabled={
                                  !hasActiveStripeSubscription ||
                                  autoRenewSaving ||
                                  billingOfflineBlock ||
                                  !billingFirestoreCompanyId
                                }
                                onCheckedChange={(v) => void handleBillingAutoRenewChange(v === true)}
                              />
                              <Label
                                htmlFor="billing-auto-renew-desk"
                                className="min-w-0 text-xs font-medium cursor-pointer leading-tight"
                              >
                                Auto renew
                              </Label>
                              <AutoRenewInfoButton hasStripeSubscription={hasActiveStripeSubscription} />
                            </div>
                            {/* Renew: same gateways as new subscription — each payment row in admin shows gateway separately. */}
                            <RadioGroup
                              value={prorationGateway}
                              onValueChange={(v) => setProrationGateway(v as "stripe" | "khalti" | "esewa")}
                              className="flex flex-col gap-2 text-xs"
                            >
                              <Label
                                className={cn(
                                  "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                                  prorationStripeAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                                  prorationGateway === "stripe" && prorationStripeAvail && "border-primary"
                                )}
                              >
                                <RadioGroupItem
                                  value="stripe"
                                  id="proration-stripe"
                                  className="shrink-0"
                                  disabled={!prorationStripeAvail}
                                />
                                Stripe (cards)
                              </Label>
                              <Label
                                className={cn(
                                  "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                                  prorationKhaltiAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                                  prorationGateway === "khalti" && prorationKhaltiAvail && "border-primary"
                                )}
                              >
                                <RadioGroupItem
                                  value="khalti"
                                  id="proration-khalti"
                                  className="shrink-0"
                                  disabled={!prorationKhaltiAvail}
                                />
                                Khalti
                              </Label>
                              <Label
                                className={cn(
                                  "flex items-center gap-2 border rounded-md px-2 py-1.5 font-normal",
                                  prorationEsewaAvail ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                                  prorationGateway === "esewa" && prorationEsewaAvail && "border-primary"
                                )}
                              >
                                <RadioGroupItem
                                  value="esewa"
                                  id="proration-esewa"
                                  className="shrink-0"
                                  disabled={!prorationEsewaAvail}
                                />
                                eSewa
                              </Label>
                            </RadioGroup>
                            <BillingTermsAndPayRow
                              termsId={`proration-terms-${p.id}`}
                              termsAccepted={billingPayTermsAccepted}
                              onTermsAcceptedChange={setBillingPayTermsAccepted}
                              payDisabled={!companyId || billingOfflineBlock || !prorationPayEnabled}
                              onPay={() => void handleProratedPay(p.id)}
                              payLabel={`pay with ${prorationGateway}`}
                              loading={loadPay}
                              buttonSize="sm"
                            />
                            {isPaidCompany ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  document
                                    .getElementById("billing-addons")
                                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                              >
                                Buy User/device
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <Button type="button" variant="outline" disabled className="w-full max-w-[220px]">
                            Current plan
                          </Button>
                        );
                    } else if (change === "downgrade") {
                      // Basic column + paid subscription: table se "Select this plan" band — upar current-plan link use karo.
                      const basicColumnLocked = isPaidCompany && p.id === "basic";
                      const tierLockedDesk =
                        isPaidCompany && isPaidTierDowngradeBlocked(p.id) && !planDowngradeEnabled;
                      footerInner = (
                        <div className="flex flex-col items-stretch gap-2 max-w-[240px] mx-auto">
                          {renderFrozenDowngradeSnapshot(p.id)}
                          {downgradeHint}
                          {basicColumnLocked ? <PaidPlanBasicColumnLockedNotice /> : null}
                          {/* Admin OFF: paid→paid Downgrade button mat dikhao — Basic (free) column alag (`adminBlocks` false jab p.isFree). */}
                          {!(adminBlocksPaidLowerColumn && !p.isFree) ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full"
                              disabled={
                                loadDown ||
                                !companyId ||
                                basicColumnLocked ||
                                tierLockedDesk ||
                                billingOfflineBlock
                              }
                              onClick={() => handleDowngrade(p.id)}
                            >
                              {loadDown ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : p.isFree ? (
                                "Select this plan"
                              ) : (
                                `Downgrade to ${p.name}`
                              )}
                            </Button>
                          ) : null}
                        </div>
                      );
                    } else if (p.isFree && p.id !== currentPlanId) {
                      const basicFreeColumnLocked = isPaidCompany && p.id === "basic";
                      footerInner = (
                        <div className="flex flex-col items-stretch gap-2 max-w-[240px] mx-auto">
                          <p className="text-xs text-muted-foreground text-center leading-snug px-1">
                            No payment — your company switches to this plan immediately.
                          </p>
                          {basicFreeColumnLocked ? <PaidPlanBasicColumnLockedNotice /> : null}
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            disabled={loadDown || !companyId || basicFreeColumnLocked || billingOfflineBlock}
                            onClick={() => handleDowngrade(p.id)}
                          >
                            {loadDown ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Select this plan"
                            )}
                          </Button>
                        </div>
                      );
                    } else if (!p.isFree && isPaidCompany) {
                      footerInner = (
                        <div className="flex flex-col items-stretch gap-2 max-w-[240px] mx-auto">
                          <BillingTermSelectWithInfo
                            value={colTerms[p.id]}
                            onValueChange={(v) => requestPaidTermChange(p.id, v)}
                            tip={billingTermStackTip(p.name, colTerms[p.id])}
                          />
                          {prorationHint}
                          <Button
                            type="button"
                            className="w-full"
                            disabled={loadPay || !companyId || billingOfflineBlock}
                            onClick={() => {
                              setSelectedPlanId(p.id);
                              void handleProratedPay(p.id);
                            }}
                          >
                            {loadPay ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : change === "upgrade" ? (
                              "Upgrade (Stripe, prorated)"
                            ) : (
                              "Renew (Stripe, prorated)"
                            )}
                          </Button>
                          {change === "upgrade" ? (
                            <>
                            <p className="text-[10px] text-muted-foreground text-center leading-snug px-0.5">
                              {PLAN_CHANGE_ONLY_SELECT_OPTION.label}: popup — remaining value becomes days on the higher
                              plan; no payment.
                            </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                disabled={loadPay || !companyId || billingOfflineBlock}
                                onClick={() => {
                                  setSelectedPlanId(p.id);
                                  setPlanChangeOnlyTargetId(p.id);
                                }}
                              >
                                {PLAN_CHANGE_ONLY_SELECT_OPTION.label}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      );
                    } else if (!p.isFree && currentPlanId === "basic") {
                      footerInner = (
                        <div className="flex flex-col items-stretch gap-2 max-w-[240px] mx-auto">
                          <BillingTermSelectWithInfo
                            value={colTerms[p.id]}
                            onValueChange={(v) =>
                              setColTerms((prev) => ({ ...prev, [p.id]: v }))
                            }
                            tip={billingNewSubscriberTermTip(p.name, colTerms[p.id])}
                          />
                          <Button
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            className="w-full"
                            onClick={() => setSelectedPlanId(p.id)}
                          >
                            {isSelected ? "Selected — pay below" : "Choose — pay below"}
                          </Button>
                        </div>
                      );
                    } else {
                      footerInner = (
                        <Button type="button" variant="ghost" disabled className="w-full max-w-[220px]">
                          —
                        </Button>
                      );
                    }

                    return (
                      <TableCell
                        key={`footer-${p.id}`}
                        className={cn(
                          "text-center p-2 sm:p-3 align-top min-w-0 max-w-[19.5%] whitespace-normal break-words !whitespace-normal",
                          isSelected && "bg-muted"
                        )}
                      >
                        {footerInner}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          )}

          {showStandardCheckout && !showMobileCheckoutSection ? (
            <CheckoutForm
              plan={selectedPlanDetails}
              termKey={colTerms[selectedPlanId]}
              userId={user?.uid ?? ""}
              companyId={billingFirestoreCompanyId}
              billingRegion={billingRegion}
              getCheckoutForPlan={getCheckoutForPlan}
              networkOnline={billingNavigatorOnline}
              gatewayAvailability={gatewayAvailability}
            />
          ) : null}

          {showMobileCheckoutSection && (
            <CheckoutForm
              // Mobile UX: selected tab plan should be payable/subscribable directly below.
              plan={selectedMobilePlan}
              termKey={colTerms[selectedMobilePlan.id]}
              userId={user?.uid ?? ""}
              companyId={billingFirestoreCompanyId}
              billingRegion={billingRegion}
              getCheckoutForPlan={getCheckoutForPlan}
              networkOnline={billingNavigatorOnline}
              gatewayAvailability={gatewayAvailability}
            />
          )}

          <AlertDialog
            open={planChangeOnlyTargetId != null}
            onOpenChange={(open) => {
              if (!open) setPlanChangeOnlyTargetId(null);
            }}
          >
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>{PLAN_CHANGE_ONLY_SELECT_OPTION.label}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-left text-sm text-muted-foreground">
                    {planChangeOnlyDialogPreview ? (
                      planChangeOnlyDialogPreview.isUpgradeConversion ? (
                        <div className="space-y-3">
                          <p>
                            Switch tier:{" "}
                            <strong className="text-foreground">{planChangeOnlyDialogPreview.fromLabel}</strong> →{" "}
                            <strong className="text-foreground">{planChangeOnlyDialogPreview.toLabel}</strong>. Your{" "}
                            <strong className="text-foreground">remaining subscription value</strong> (same NPR logic as
                            the prorated upgrade line above) becomes about{" "}
                            <strong className="text-foreground tabular-nums">
                              {planChangeOnlyDialogPreview.newDaysLeft}{" "}
                              {planChangeOnlyDialogPreview.newDaysLeft === 1 ? "day" : "days"}
                            </strong>{" "}
                            of {planChangeOnlyDialogPreview.toLabel} from today —{" "}
                            <strong className="text-foreground">end date moves earlier</strong>. No new paid term is
                            added. <strong className="text-foreground">No payment</strong>.
                          </p>
                          {typeof planChangeOnlyDialogPreview.leavingUsageNpr === "number" &&
                          planChangeOnlyDialogPreview.leavingPlanYearly > 0 ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <p className="text-[11px] text-muted-foreground text-center m-0">
                                {planChangeOnlyDialogPreview.fromLabel} — ab tak ka usage (confirm ke baad isi par{" "}
                                <strong className="text-foreground">freeze</strong>):
                              </p>
                              <div className={PRORATION_PILL_USAGE_FROZEN_CLASS}>
                                <span>
                                  Usage: {displaySymbol}{" "}{planChangeOnlyDialogPreview.leavingUsageNpr.toFixed(2)}
                                  {formatUsageLineSuffix(
                                    planChangeOnlyDialogPreview.leavingUsageNpr,
                                    planChangeOnlyDialogPreview.leavingPlanYearly,
                                    planChangeOnlyDialogPreview.leavingPlanYearly
                                  )}
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p>
                          Switch tier only:{" "}
                          <strong className="text-foreground">{planChangeOnlyDialogPreview.fromLabel}</strong> →{" "}
                          <strong className="text-foreground">{planChangeOnlyDialogPreview.toLabel}</strong>.{" "}
                          <strong className="text-foreground">End date stays the same</strong> (no extra purchased days).{" "}
                          <strong className="text-foreground">No payment</strong>.
                        </p>
                      )
                    ) : (
                      <p>Confirm this plan switch on the server.</p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  type="button"
                  disabled={billingOfflineBlock}
                  onClick={() => {
                    const tid = planChangeOnlyTargetId;
                    setPlanChangeOnlyTargetId(null);
                    if (tid) void handleProratedPay(tid, "plan_change_only");
                  }}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {termExplainDialogPreview ? (
            <BillingRenewTermExplainDialog
              open={termExplainDialog != null}
              onOpenChange={(open) => {
                if (!open) setTermExplainDialog(null);
              }}
              preview={termExplainDialogPreview}
              daysLeftOnPlan={daysLeftOnPlan}
              currencySymbol={displaySymbol}
              onConfirm={confirmTermExplainDialog}
            />
          ) : null}
        </CardContent>
      </Card>

      {isPaidCompany ? (
        <div className="mt-auto w-full space-y-4 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            You are on a paid plan — use the term dropdowns and Stripe actions in the table above to renew, upgrade
            (prorated), or downgrade.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/billing/statement" target="_blank" rel="noopener noreferrer">
                Statement
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                billingStatementFooterPdfBusy ||
                billingOfflineBlock ||
                !isBillingOwner ||
                !String(billingFirestoreCompanyId).trim()
              }
              onClick={() => void handleDownloadStatementFromBillingFooter()}
            >
              {downloadStatementBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-2 h-4 w-4" aria-hidden />
              )}
              Download
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                billingStatementFooterPdfBusy ||
                billingOfflineBlock ||
                !isBillingOwner ||
                !String(billingFirestoreCompanyId).trim()
              }
              onClick={() => void handlePrintStatementFromBillingFooter()}
            >
              {printStatementBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Printer className="mr-2 h-4 w-4" aria-hidden />
              )}
              Print
            </Button>
          </div>
          <BillingAddOnPurchaseCard
            userId={user?.uid ?? ""}
            companyId={billingFirestoreCompanyId}
            initialKind={addonInitialKind}
            networkOnline={billingNavigatorOnline}
            gatewayAvailability={gatewayAvailability}
            currentPlan={plans.find((plan) => plan.id === currentPlanId) ?? null}
          />
        </div>
      ) : null}
    </div>
  );
}
