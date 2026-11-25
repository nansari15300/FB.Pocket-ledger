
"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
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
import { Copy, Info, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppFreshInfoButton } from '@/components/ui/AppFreshInfoButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/hooks/use-toast';
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore } from '@/lib/plClientSession';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { parseBillingPolicyDoc } from '@/lib/billingPolicyFlags';
import {
  emptyCountryWallet,
  parseCountryWallets,
  type CountryWallet,
  type CountryWalletEngine,
} from '@/lib/countryWallets';
import { updateCountryWallets } from '@/ai/flows/gateway-keys';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isPlServerPackedApp } from '@/lib/plServerPackedApp';
import { withWebAppBasePath } from '@/lib/webAppBasePath';

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

const WALLET_FIELD_INTRO = {
  name: "Display name on the Billing plan page (PayPay, Telr, JazzCash). Buyers tap this name to pay. Type it in the language your buyers use.",
  country: "The country this wallet belongs to (Japan, UAE, Pakistan). For your records. We do not keep a world list — you type the country yourself.",
  merchant: "Merchant id or shop name from your payment-provider dashboard. Buyers may see this as who they are paying.",
  apiKey: "Public or client key from the same dashboard. It stays on this server only. Used together with the secret so only your gateway can talk to us.",
  secret: "Private secret. Required for auto confirm. Your gateway must send this secret with the payment Ref to our webhook URL. If you leave it empty, choose Manual confirm.",
  payUrl: "Optional. If the provider gives you a checkout page, paste that URL so the buyer can be sent there to pay. Leave blank if they only follow the instructions or a QR.",
  instructions: "Text the buyer sees at checkout (account number, QR note, “pay then wait”). Write it in the language your buyers use.",
  engine: "Webhook (auto): when their gateway calls our webhook URL with the Ref and secret, the plan starts itself. Manual: you confirm the payment in Payments after the buyer pays.",
  showOnPlan: "On: this wallet appears as a pay option on Billing. Off: saved here but hidden from buyers.",
  webhookUrl: "Copy this into your gateway’s callback / IPN / webhook setting. After a successful pay they must POST the checkout Ref and the secret here. That is what auto-completes the plan.",
  successUrl: "Copy this into the provider’s success / return URL. After pay, the buyer lands back in Billing.",
  cancelUrl: "Copy this into the provider’s cancel / fail URL. If they abort pay, they return here.",
} as const;

function WalletFieldIntro({ tip }: { tip: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppFreshInfoButton size="xs" aria-label="Intro" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="z-[200] max-w-xs text-left text-xs leading-snug"
        data-pl-intro=""
      >
        {tip}
      </PopoverContent>
    </Popover>
  );
}

function WalletFieldLabel({
  htmlFor,
  children,
  tip,
}: {
  htmlFor?: string;
  children: ReactNode;
  tip: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{children}</Label>
      <WalletFieldIntro tip={tip} />
    </div>
  );
}

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
  const [countryWallets, setCountryWallets] = useState<CountryWallet[]>([]);
  const [walletDlgOpen, setWalletDlgOpen] = useState(false);
  const [walletDraft, setWalletDraft] = useState<CountryWallet | null>(null);
  const [walletDlgSaving, setWalletDlgSaving] = useState(false);

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
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        setGatewayFlags(parseGatewayPaymentFlags(raw));
        setCountryWallets(parseCountryWallets(raw?.wallets));
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

  const walletCallbackUrls = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
    const webhookPath = isPlServerPackedApp()
      ? '/api/pl/pay/wallet-webhook'
      : '/api/payments/wallet-webhook';
    return {
      webhookUrl: `${origin}${webhookPath}`,
      successUrl: `${origin}${withWebAppBasePath('/billing/success')}`,
      cancelUrl: `${origin}${withWebAppBasePath('/billing/cancel')}`,
    };
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied', description: label });
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: value });
    }
  };

  const openNewWallet = () => {
    setWalletDraft(emptyCountryWallet());
    setWalletDlgOpen(true);
  };

  const openEditWallet = (w: CountryWallet) => {
    setWalletDraft({ ...w });
    setWalletDlgOpen(true);
  };

  const saveWalletDraft = async () => {
    if (!walletDraft) return;
    const name = walletDraft.name.trim();
    const country = walletDraft.country.trim();
    if (!name || !country) {
      toast({ variant: 'destructive', title: 'Required', description: 'Gateway name and country are required.' });
      return;
    }
    if (walletDraft.engine === 'webhook' && !walletDraft.secret.trim() && !walletDraft.apiKey.trim()) {
      toast({
        variant: 'destructive',
        title: 'Required for auto confirm',
        description: 'Paste API key or webhook secret. Copy the callback URLs into your gateway dashboard.',
      });
      return;
    }
    setWalletDlgSaving(true);
    try {
      const next = countryWallets.some((w) => w.id === walletDraft.id)
        ? countryWallets.map((w) => (w.id === walletDraft.id ? walletDraft : w))
        : [...countryWallets, walletDraft];
      setCountryWallets(next);
      await updateCountryWallets(next);
      setWalletDlgOpen(false);
      setWalletDraft(null);
      toast({ title: 'Wallet saved', description: `${name} is on this server. Paste the redirect / webhook URLs in your ${country} gateway.` });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not save wallet',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setWalletDlgSaving(false);
    }
  };

  const removeWallet = async (id: string) => {
    const next = countryWallets.filter((w) => w.id !== id);
    setCountryWallets(next);
    try {
      await updateCountryWallets(next);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not remove wallet',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

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
    setIsSaving(true);
    try {
      await Promise.all([
        updateGatewayKeys(toGatewayFormDefaults(data)),
        updateGatewayPaymentFlags({ ...gatewayFlags }),
        updateCountryWallets(countryWallets),
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

                <Card className="w-full">
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <div>
                      <CardTitle className="text-lg leading-none">Country wallets (template)</CardTitle>
                      <p className="mt-2 text-xs text-muted-foreground max-w-3xl" data-pl-intro="">
                        Any country: Add wallet popup. Fill merchant, API key, and paste our redirect / webhook URLs into
                        their gateway. We do not list Japan / Dubai / Pakistan in code — you type your own.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={openNewWallet}>
                      <Plus className="mr-1 h-4 w-4" /> Add wallet
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {countryWallets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No extra wallets yet. Open Add wallet and fill the fields for auto confirm.
                      </p>
                    ) : (
                      countryWallets.map((w) => (
                        <div
                          key={w.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {w.name || "Untitled"}{" "}
                              <span className="text-muted-foreground font-normal">· {w.country || "—"}</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {w.engine === "webhook" ? "Auto (webhook)" : "Manual confirm"}
                              {w.merchant ? ` · ${w.merchant}` : ""}
                              {w.showOnPlan ? "" : " · hidden on plan page"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="icon" aria-label="Edit wallet" onClick={() => openEditWallet(w)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" aria-label="Remove wallet" onClick={() => void removeWallet(w.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Dialog open={walletDlgOpen} onOpenChange={setWalletDlgOpen}>
                  <DialogContent className="max-h-[95vh] w-[min(92vw,42rem)] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>
                        {walletDraft && countryWallets.some((w) => w.id === walletDraft.id)
                          ? "Edit wallet"
                          : "Add wallet"}
                      </DialogTitle>
                    </DialogHeader>
                    {walletDraft ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.name}>Gateway name</WalletFieldLabel>
                          <Input
                            value={walletDraft.name}
                            placeholder="PayPay / Telr / JazzCash / KOMOJU"
                            onChange={(e) => setWalletDraft({ ...walletDraft, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.country}>Country</WalletFieldLabel>
                          <Input
                            value={walletDraft.country}
                            placeholder="Japan"
                            onChange={(e) => setWalletDraft({ ...walletDraft, country: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.merchant}>Merchant name / ID</WalletFieldLabel>
                          <Input
                            value={walletDraft.merchant}
                            placeholder="Merchant id from their dashboard"
                            onChange={(e) => setWalletDraft({ ...walletDraft, merchant: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.apiKey}>API key</WalletFieldLabel>
                          <Input
                            type="password"
                            value={walletDraft.apiKey}
                            placeholder="Public / client key"
                            onChange={(e) => setWalletDraft({ ...walletDraft, apiKey: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.secret}>API / webhook secret</WalletFieldLabel>
                          <Input
                            type="password"
                            value={walletDraft.secret}
                            placeholder="Required for auto confirm"
                            onChange={(e) => setWalletDraft({ ...walletDraft, secret: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.payUrl}>Hosted pay URL (optional)</WalletFieldLabel>
                          <Input
                            value={walletDraft.payUrl}
                            placeholder="https://pay.their-gateway.com/checkout  — if they give you a pay page"
                            onChange={(e) => setWalletDraft({ ...walletDraft, payUrl: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.instructions}>Pay instructions (buyer sees this)</WalletFieldLabel>
                          <Input
                            value={walletDraft.instructions}
                            placeholder="Pay in the gateway window, then wait for auto confirm."
                            onChange={(e) => setWalletDraft({ ...walletDraft, instructions: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                          <WalletFieldLabel tip={WALLET_FIELD_INTRO.engine}>Auto confirm</WalletFieldLabel>
                          <select
                            className="flex h-10 min-w-[12rem] rounded-md border border-input bg-background px-3 text-sm"
                            value={walletDraft.engine}
                            onChange={(e) =>
                              setWalletDraft({ ...walletDraft, engine: e.target.value as CountryWalletEngine })
                            }
                          >
                            <option value="webhook">Webhook (auto)</option>
                            <option value="manual">Manual confirm</option>
                          </select>
                          <div className="ml-auto flex items-center gap-2">
                            <Switch
                              checked={walletDraft.showOnPlan}
                              onCheckedChange={(c) => setWalletDraft({ ...walletDraft, showOnPlan: c })}
                            />
                            <WalletFieldLabel tip={WALLET_FIELD_INTRO.showOnPlan}>Show on plan page</WalletFieldLabel>
                          </div>
                        </div>
                        {(
                          [
                            ["Webhook / callback URL", WALLET_FIELD_INTRO.webhookUrl, 0],
                            ["Success redirect URL", WALLET_FIELD_INTRO.successUrl, 1],
                            ["Cancel redirect URL", WALLET_FIELD_INTRO.cancelUrl, 2],
                          ] as const
                        ).map(([label, tip, idx]) => {
                            const urls = walletCallbackUrls();
                            const value =
                              idx === 0 ? urls.webhookUrl : idx === 1 ? urls.successUrl : urls.cancelUrl;
                            return (
                              <div key={label} className="space-y-1 sm:col-span-2">
                                <WalletFieldLabel tip={tip}>{label} — paste this in their gateway</WalletFieldLabel>
                                <div className="flex gap-2">
                                  <Input readOnly value={value} className="bg-muted font-mono text-xs" />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    aria-label={`Copy ${label}`}
                                    onClick={() => void copyText(label, value)}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          }
                        )}
                        <p className="text-[11px] text-muted-foreground sm:col-span-2" data-pl-intro="">
                          Auto confirm: their gateway must POST{" "}
                          <code data-pl-no-translate="">{`{ "pendingId": "<Ref from checkout>", "secret": "<API / webhook secret>" }`}</code>{" "}
                          to the webhook URL. Success / cancel URLs are the pages after pay.
                        </p>
                      </div>
                    ) : null}
                    <DialogFooter>
                      <Button type="button" variant="secondary" onClick={() => setWalletDlgOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={() => void saveWalletDraft()} disabled={walletDlgSaving}>
                        {walletDlgSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save wallet
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

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

    