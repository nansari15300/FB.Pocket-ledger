
"use client";

import { adminServerWriteBlocked } from "@/lib/adminData/adminServerMode";
import { useState, useEffect, type ReactNode } from 'react';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  getGatewayKeys,
  updateGatewayKeys,
  updateGatewayPaymentFlags,
  parseGatewayPaymentFlags,
  ESEWA_UAT_MERCHANT_CODE,
  ESEWA_UAT_SECRET_KEY,
  KHALTI_UAT_PUBLIC_KEY,
  type GatewayKeys,
  type GatewayPaymentFlags,
  type BillingGatewayId,
} from '@/ai/flows/gateway-keys';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Info, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  doc,
  setDoc,
} from 'firebase/firestore';
import { getDoc } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore } from '@/lib/firebase';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { parseBillingPolicyDoc } from '@/lib/billingPolicyFlags';

/**
 * Stripe / Khalti / eSewa / Billing: wide = 1 row (4), mid = 2×2, narrow = 1 column.
 * Header text wrap allowed — “Show on plan page” card width ke hisaab se neeche aa sakta hai.
 */
const adminGatewayCardsGridCn =
  'grid w-full gap-[15px] grid-cols-1 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-4';

const formSchema = z.object({
  stripeSecretKey: z.string().optional(),
  khaltiPublicKey: z.string().optional(),
  esewaMerchantCode: z.string().optional(),
  esewaSecretKey: z.string().optional(),
});

type GatewayFormValues = z.infer<typeof formSchema>;

/** Section / toggle ke bagal — lambi help copy sirf (i) tooltip me. */
function SettingsInfoTip({
  label,
  ariaLabel = 'More information',
}: {
  label: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label={ariaLabel}
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[20rem] text-xs leading-snug">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Title row ke saath — gateway naam + “Show on plan page” switch ek line. */
function GatewayPlanPaymentRow({
  id,
  info,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  info: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
      <div className="flex shrink-0 flex-nowrap items-center gap-1">
        <Label htmlFor={id} className="cursor-default shrink-0 text-sm whitespace-nowrap">
          Show on plan page
        </Label>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                aria-label="About show on plan page"
              >
                <Info className="h-4 w-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[16rem] text-xs leading-snug">
              {info}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="shrink-0"
      />
    </div>
  );
}

/** Firestore / spread `keys` can omit keys → `undefined`; `<Input {...field} />` must always get string (controlled). */
function toGatewayFormDefaults(raw: Partial<GatewayKeys>): GatewayFormValues {
  return {
    stripeSecretKey: typeof raw.stripeSecretKey === 'string' ? raw.stripeSecretKey : '',
    khaltiPublicKey: typeof raw.khaltiPublicKey === 'string' ? raw.khaltiPublicKey : '',
    esewaMerchantCode: typeof raw.esewaMerchantCode === 'string' ? raw.esewaMerchantCode : '',
    esewaSecretKey: typeof raw.esewaSecretKey === 'string' ? raw.esewaSecretKey : '',
  };
}

export default function BankSettingsPage() {
  useAdminAccess(['SuperAdmin']);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  /** `app_settings/billing` — downgrade policy only (plan page payment toggles gateway cards me). */
  const [billingPolicyLoading, setBillingPolicyLoading] = useState(true);
  /** Draft — Firestore par sirf Save Settings click se likhega. */
  const [planDowngradeEnabled, setPlanDowngradeEnabled] = useState(true);
  /** `app_settings/payment_gateways` — har card ka “Show on plan page” (draft). */
  const [gatewayFlagsLoading, setGatewayFlagsLoading] = useState(true);
  const [gatewayFlags, setGatewayFlags] = useState<GatewayPaymentFlags>({
    stripePaymentEnabled: true,
    khaltiPaymentEnabled: true,
    esewaPaymentEnabled: true,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      stripeSecretKey: '',
      khaltiPublicKey: '',
      esewaMerchantCode: '',
      esewaSecretKey: '',
    },
  });

  useEffect(() => {
    async function fetchKeys() {
      try {
        const keys = await getGatewayKeys();
        const base = toGatewayFormDefaults(keys);
        // `next dev`: pre-fill official Khalti/eSewa UAT when Firestore empty — save once or pay without saving.
        const devPrefill =
          process.env.NODE_ENV === 'development'
            ? {
                khaltiPublicKey: base.khaltiPublicKey.trim() || KHALTI_UAT_PUBLIC_KEY,
                esewaMerchantCode: base.esewaMerchantCode.trim() || ESEWA_UAT_MERCHANT_CODE,
                esewaSecretKey: base.esewaSecretKey.trim() || ESEWA_UAT_SECRET_KEY,
              }
            : {};
        form.reset({ ...base, ...devPrefill });
        const snap = await getDoc(doc(firestore, 'app_settings', 'payment_gateways'));
        setGatewayFlags(
          parseGatewayPaymentFlags(snap.exists() ? (snap.data() as Record<string, unknown>) : null)
        );
      } catch (error) {
        console.error("Failed to fetch gateway keys:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not load existing keys.' });
      } finally {
        setLoading(false);
        setGatewayFlagsLoading(false);
      }
    }
    fetchKeys();
  }, [form]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'app_settings', 'billing'));
        if (cancelled) return;
        const flags = parseBillingPolicyDoc(
          snap.exists() ? (snap.data() as Record<string, unknown>) : null
        );
        setPlanDowngradeEnabled(flags.planDowngradeEnabled);
      } catch (error) {
        console.error('Failed to load billing policy:', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not load billing policy.' });
      } finally {
        if (!cancelled) setBillingPolicyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gatewayFlagKey = (id: BillingGatewayId): keyof GatewayPaymentFlags => {
    if (id === 'stripe') return 'stripePaymentEnabled';
    if (id === 'khalti') return 'khaltiPaymentEnabled';
    return 'esewaPaymentEnabled';
  };

  /** Card switch — local draft; Firestore Save Settings par. */
  const setGatewayPlanPaymentDraft = (id: BillingGatewayId, next: boolean) => {
    const key = gatewayFlagKey(id);
    setGatewayFlags((f) => ({ ...f, [key]: next }));
  };

  /** Keys + payment toggles + downgrade — ek hi Save button. */
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    if (adminServerWriteBlocked()) return;
    setIsSaving(true);
    try {
      await Promise.all([
        updateGatewayKeys(toGatewayFormDefaults(data)),
        updateGatewayPaymentFlags({ ...gatewayFlags }),
        setDoc(
          doc(firestore, 'app_settings', 'billing'),
          { planDowngradeEnabled },
          { merge: true }
        ),
      ]);
      toast({ title: 'Success', description: 'All bank and billing settings have been saved.' });
    } catch (error) {
      console.error('Failed to save bank settings:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save settings. Try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const settingsBusy = isSaving || gatewayFlagsLoading || billingPolicyLoading;

  if (loading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4 sm:p-6">
        <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-4">
                <CardTitle className="leading-none">Payment Gateway Settings</CardTitle>
                <SettingsInfoTip
                  ariaLabel="About payment gateway settings"
                  label={
                    <>
                      Manage API keys for Stripe, Khalti, and eSewa (stored in Firestore). In development, Khalti sandbox
                      public key and eSewa EPAYTEST apply when fields are empty; Stripe still needs your test secret or{' '}
                      <code className="text-[11px]">.env.local</code> — see <code className="text-[11px]">.env.example</code>.
                    </>
                  }
                />
            </CardHeader>
        </Card>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex w-full flex-col gap-4">
                <div className={adminGatewayCardsGridCn}>
                <Card className="pl-dashboard-ribbon-indigo flex h-full min-w-0 w-full flex-col">
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
                        <CardTitle className="shrink-0 text-xl leading-none">Stripe</CardTitle>
                        <GatewayPlanPaymentRow
                          id="stripe-plan-payment"
                          info="Off: Stripe is hidden on the Billing plan page only — API keys stay saved."
                          checked={gatewayFlags.stripePaymentEnabled}
                          disabled={settingsBusy}
                          onCheckedChange={(c) => setGatewayPlanPaymentDraft('stripe', c)}
                        />
                    </CardHeader>
                    <CardContent className="flex-1 pt-0">
                        <FormField
                            control={form.control}
                            name="stripeSecretKey"
                            render={({ field }: any) => (
                                <FormItem>
                                <FormLabel>Stripe Secret Key</FormLabel>
                                <FormControl>
                                    <Input
                                      type="password"
                                      placeholder="sk_test_... or sk_live_..."
                                      {...field}
                                      value={field.value ?? ''}
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                 <Card className="pl-dashboard-ribbon-violet flex h-full min-w-0 w-full flex-col">
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
                        <CardTitle className="shrink-0 text-xl leading-none">Khalti</CardTitle>
                        <GatewayPlanPaymentRow
                          id="khalti-plan-payment"
                          info="Off: Khalti is hidden on the Billing plan page only — API keys stay saved."
                          checked={gatewayFlags.khaltiPaymentEnabled}
                          disabled={settingsBusy}
                          onCheckedChange={(c) => setGatewayPlanPaymentDraft('khalti', c)}
                        />
                    </CardHeader>
                    <CardContent className="flex-1 pt-0">
                       <FormField
                            control={form.control}
                            name="khaltiPublicKey"
                            render={({ field }: any) => (
                                <FormItem>
                                <FormLabel>Khalti Public Key</FormLabel>
                                <FormControl>
                                    <Input
                                      placeholder="test_public_key_... or live_public_key_..."
                                      {...field}
                                      value={field.value ?? ''}
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                 <Card className="pl-dashboard-ribbon-emerald flex h-full min-w-0 w-full flex-col">
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
                        <CardTitle className="shrink-0 text-xl leading-none">eSewa</CardTitle>
                        <GatewayPlanPaymentRow
                          id="esewa-plan-payment"
                          info="Off: eSewa is hidden on the Billing plan page only — API keys stay saved."
                          checked={gatewayFlags.esewaPaymentEnabled}
                          disabled={settingsBusy}
                          onCheckedChange={(c) => setGatewayPlanPaymentDraft('esewa', c)}
                        />
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4 pt-0">
                        <FormField
                            control={form.control}
                            name="esewaMerchantCode"
                            render={({ field }: any) => (
                                <FormItem>
                                <FormLabel>eSewa Merchant Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g., EPAYTEST" {...field} value={field.value ?? ''} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="esewaSecretKey"
                            render={({ field }: any) => (
                                <FormItem>
                                <FormLabel>eSewa Secret Key</FormLabel>
                                <FormControl>
                                    <Input
                                      type="password"
                                      placeholder="8gBmPxtryL2mUplJd4E9I4A6u4y7SgC5"
                                      {...field}
                                      value={field.value ?? ''}
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>
                <Card className="pl-dashboard-ribbon-amber flex h-full min-w-0 w-full flex-col">
          <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 pb-4">
            <CardTitle className="leading-none">Billing behaviour</CardTitle>
            <SettingsInfoTip
              ariaLabel="About billing behaviour"
              label={
                <>
                  Control whether company owners can use the Downgrade button to move to a cheaper paid tier (remaining
                  value converts to more days at that plan&apos;s rate). &quot;Just change plan&quot; is only for upgrading
                  tiers. Switching to Basic (free) from the current plan column stays available when Basic is free.
                </>
              }
            />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <Label htmlFor="plan-downgrade-enabled" className="cursor-default min-w-0 text-base">
                  Allow downgrade to lower paid plans
                </Label>
                <SettingsInfoTip
                  ariaLabel="About allow downgrade setting"
                  label={
                    <>
                      {/* `app_settings/billing.planDowngradeEnabled` — billing page + downgrade API */}
                      Off: owners cannot move to a cheaper paid tier (button hidden, API 403); post-upgrade
                      &quot;locked&quot; tiers stay blocked. On: Downgrade works including back to tiers that were locked
                      after an upgrade. Basic (free) from the current plan column is unchanged when Off.
                    </>
                  }
                />
              </div>
              <Switch
                id="plan-downgrade-enabled"
                checked={planDowngradeEnabled}
                disabled={settingsBusy}
                onCheckedChange={setPlanDowngradeEnabled}
                className="shrink-0"
              />
            </div>
          </CardContent>
        </Card>
                </div>

                {/* Sab changes — keys, plan-page toggles, downgrade — ek hi Save (page ke niche) */}
                <div className="flex w-full justify-end pt-1">
                    <Button type="submit" disabled={settingsBusy}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Settings
                    </Button>
                </div>
            </form>
        </Form>
    </div>
  );
}

    