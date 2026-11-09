"use client";

import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import KhaltiCheckout from "khalti-checkout-web";
import {
  DEFAULT_DEVICE_USER_ADDON_OFFER,
  addonKindLabel,
  hasAnyAddonScopeVisibleOnBilling,
  isAddonScopeVisibleOnBilling,
  normalizeAddonKind,
  parsePurchasedPlanAddOns,
  readDeviceUserAddOnOfferFromPlansDoc,
  unitPriceForAddonKind,
  type AddonKind,
  type DeviceUserAddOnOffer,
  type PurchasedPlanAddOns,
} from "@/lib/planAddOns";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { getServerLoginBillingAuthHeader } from "@/lib/firebaseAuthForApi";
import { browserHistoryHref } from "@/lib/webAppBasePath";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Plan } from "@/config/plans";
import { planAllowsFirebaseOnline } from "@/lib/planSyncEntitlements";

type GatewayAvailability = { stripe: boolean; khalti: boolean; esewa: boolean };
type PayGateway = "stripe" | "khalti" | "esewa";

type Props = {
  userId: string;
  companyId: string;
  /** Prefill from ?addon=… */
  initialKind?: AddonKind | "device" | "user";
  networkOnline?: boolean;
  gatewayAvailability?: GatewayAvailability | null;
  /** Current account plan from Billing. Online add-ons require Firebase online-company access. */
  currentPlan?: Plan | null;
};

type AddonScope = "online" | "local";

function scopeFromKind(kind: AddonKind): AddonScope {
  return kind.endsWith("-local") ? "local" : "online";
}

function clampQty(n: unknown): number {
  return Math.min(20, Math.max(0, Math.floor(Number(n) || 0)));
}

function kindsForScope(scope: AddonScope): {
  device: AddonKind;
  user: AddonKind;
  company: AddonKind;
} {
  return scope === "local"
    ? { device: "device-local", user: "user-local", company: "company-local" }
    : { device: "device-online", user: "user-online", company: "company-online" };
}

function firstAvailableGateway(ga: GatewayAvailability | null, preferred: PayGateway): PayGateway {
  if (ga == null) return preferred;
  if (ga[preferred]) return preferred;
  if (ga.stripe) return "stripe";
  if (ga.khalti) return "khalti";
  if (ga.esewa) return "esewa";
  return preferred;
}

function gatewayPayLabel(gateway: PayGateway): string {
  if (gateway === "khalti") return "Khalti";
  if (gateway === "esewa") return "eSewa";
  return "Stripe";
}

/** Owner buys extra device/user slots (online/local) for the current plan period. */
export function BillingAddOnPurchaseCard({
  userId,
  companyId,
  initialKind = "device-online",
  networkOnline = true,
  gatewayAvailability = null,
  currentPlan = null,
}: Props) {
  const [offer, setOffer] = useState<DeviceUserAddOnOffer>(DEFAULT_DEVICE_USER_ADDON_OFFER);
  const [owned, setOwned] = useState<PurchasedPlanAddOns>({
    extraDevicesOnline: 0,
    extraDevicesLocal: 0,
    extraUsersOnline: 0,
    extraUsersLocal: 0,
    extraCompaniesOnline: 0,
    extraCompaniesLocal: 0,
    expiryMs: null,
  });
  const [scope, setScope] = useState<AddonScope>(() => scopeFromKind(normalizeAddonKind(initialKind)));
  const [deviceQty, setDeviceQty] = useState(0);
  const [userQty, setUserQty] = useState(0);
  const [companyQty, setCompanyQty] = useState(0);
  const [gateway, setGateway] = useState<PayGateway>("stripe");
  const [busy, setBusy] = useState(false);
  const onlineAddOnsAllowed = planAllowsFirebaseOnline(currentPlan?.id, currentPlan);

  useEffect(() => {
    const next = normalizeAddonKind(initialKind);
    setScope(scopeFromKind(next));
    if (next.startsWith("user")) {
      setUserQty(1);
      setDeviceQty(0);
      setCompanyQty(0);
    } else if (next.startsWith("company")) {
      setCompanyQty(1);
      setDeviceQty(0);
      setUserQty(0);
    } else {
      setDeviceQty(1);
      setUserQty(0);
      setCompanyQty(0);
    }
  }, [initialKind]);

  useEffect(() => {
    const onlineOk = isAddonScopeVisibleOnBilling(offer, "online") && onlineAddOnsAllowed;
    const localOk = isAddonScopeVisibleOnBilling(offer, "local");
    if (scope === "online" && !onlineOk) {
      if (localOk) setScope("local");
      return;
    }
    if (scope === "local" && !localOk) {
      if (onlineOk) setScope("online");
    }
  }, [offer, onlineAddOnsAllowed, scope]);

  useEffect(() => {
    setGateway((prev) => {
      const next = firstAvailableGateway(gatewayAvailability, prev);
      return next === prev ? prev : next;
    });
  }, [
    gatewayAvailability?.stripe,
    gatewayAvailability?.khalti,
    gatewayAvailability?.esewa,
  ]);

  useEffect(() => {
    const unsub = onSnapshot(doc(firestore, "app_settings", "plans"), (snap) => {
      setOffer(
        readDeviceUserAddOnOfferFromPlansDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null)
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userId.trim()) return;
    const unsub = onSnapshot(doc(firestore, "users", userId), (snap) => {
      setOwned(parsePurchasedPlanAddOns(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
    });
    return () => unsub();
  }, [userId]);

  if (!offer.enabled) {
    return (
      <Card id="billing-addons" className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Add-on service</CardTitle>
          <CardDescription>
            Extra devices and users are not enabled yet. Ask Super Admin to turn on{" "}
            <strong>Add-on service</strong> under Admin → Plans (below Pro Plus).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!hasAnyAddonScopeVisibleOnBilling(offer)) {
    return null;
  }

  const onlineTabVisible =
    isAddonScopeVisibleOnBilling(offer, "online") && onlineAddOnsAllowed;
  const localTabVisible = isAddonScopeVisibleOnBilling(offer, "local");

  const kinds = kindsForScope(scope);
  const ownedDevices = scope === "local" ? owned.extraDevicesLocal : owned.extraDevicesOnline;
  const ownedUsers = scope === "local" ? owned.extraUsersLocal : owned.extraUsersOnline;
  const ownedCompanySlots =
    scope === "local" ? owned.extraCompaniesLocal : owned.extraCompaniesOnline;
  const deviceUnit = unitPriceForAddonKind(offer, kinds.device);
  const userUnit = unitPriceForAddonKind(offer, kinds.user);
  const companyUnit = unitPriceForAddonKind(offer, kinds.company);
  const deviceLine = deviceUnit * deviceQty;
  const userLine = userUnit * userQty;
  const companyLine = companyUnit * companyQty;
  const total = deviceLine + userLine + companyLine;

  const stripeOk = gatewayAvailability == null || gatewayAvailability.stripe;
  const khaltiOk = gatewayAvailability == null || gatewayAvailability.khalti;
  const esewaOk = gatewayAvailability == null || gatewayAvailability.esewa;
  const gatewayBlocked =
    gatewayAvailability != null &&
    !(gateway === "stripe"
      ? gatewayAvailability.stripe
      : gateway === "khalti"
        ? gatewayAvailability.khalti
        : gatewayAvailability.esewa);

  const buy = async () => {
    if (!networkOnline) {
      toast({ variant: "destructive", title: "Offline", description: "Back online to buy add-ons." });
      return;
    }
    if (!userId.trim()) {
      toast({ variant: "destructive", title: "Sign in required", description: "Log in to buy add-ons." });
      return;
    }
    if (scope === "online" && !onlineAddOnsAllowed) {
      toast({
        variant: "destructive",
        title: "Online add-ons unavailable",
        description: "Your current plan does not include an online company. Upgrade your plan before buying online add-ons.",
      });
      return;
    }
    if (total <= 0 || (deviceQty <= 0 && userQty <= 0 && companyQty <= 0)) {
      toast({
        variant: "destructive",
        title: "Quantity required",
        description: "Enter quantity for device, user, and/or company slot (at least one).",
      });
      return;
    }
    if (gatewayBlocked) {
      toast({ variant: "destructive", title: "Gateway unavailable", description: "Pick another payment method." });
      return;
    }

    const items: { kind: AddonKind; quantity: number }[] = [];
    if (deviceQty > 0) items.push({ kind: kinds.device, quantity: deviceQty });
    if (userQty > 0) items.push({ kind: kinds.user, quantity: userQty });
    if (companyQty > 0) items.push({ kind: kinds.company, quantity: companyQty });

    setBusy(true);
    try {
      const res = await fetch(getBillingApiUrl("/api/payments/addon-checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getServerLoginBillingAuthHeader()) },
        body: JSON.stringify({
          gateway,
          userId,
          ...(companyId.trim() ? { companyId } : {}),
          items,
        }),
      });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        gateway?: string;
        publicKey?: string;
        amount?: number;
        product_identity?: string;
        product_name?: string;
        returnUrl?: string;
        pendingId?: string;
        oid?: string;
        successUrl?: string;
        failUrl?: string;
        merchantCode?: string;
        signature?: string;
        signedFieldNames?: string;
      };
      if (!res.ok) throw new Error(data.error || "Checkout failed");

      if (gateway === "stripe") {
        if (data.url) window.location.assign(data.url);
        else throw new Error("No checkout URL");
        return;
      }

      if (gateway === "khalti") {
        if (!data.publicKey || data.amount == null || !data.returnUrl) {
          throw new Error("Khalti checkout incomplete");
        }
        const khaltiConfig = {
          publicKey: data.publicKey,
          productIdentity: data.product_identity,
          productName: data.product_name,
          productUrl: window.location.href,
          amount: data.amount,
          eventHandler: {
            onSuccess(payload: { token?: string; amount?: number }) {
              const base = String(data.returnUrl || "");
              const join = base.includes("?") ? "&" : "?";
              window.location.assign(
                `${base}${join}token=${payload.token}&amount=${payload.amount}`
              );
            },
            onError() {
              toast({ variant: "destructive", title: "Khalti Error", description: "Payment failed. Please try again." });
            },
            onClose() {},
          },
        };
        const checkout = new (KhaltiCheckout as any)(khaltiConfig);
        checkout.show({ amount: data.amount });
        return;
      }

      if (gateway === "esewa") {
        if (!data.url || data.amount == null || !data.oid || !data.merchantCode || !data.signature) {
          throw new Error("eSewa checkout incomplete");
        }
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.url;
        const fields: Record<string, string> = {
          amount: String(data.amount),
          failure_url: data.failUrl || `${window.location.origin}${browserHistoryHref("/billing?addon=cancel")}`,
          product_delivery_charge: "0",
          product_service_charge: "0",
          product_code: data.merchantCode,
          signature: data.signature,
          signed_field_names: data.signedFieldNames || "total_amount,transaction_uuid,product_code",
          success_url: data.successUrl || `${window.location.origin}${browserHistoryHref("/billing/addon/esewa")}`,
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
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Add-on checkout",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const payLabelParts: string[] = [];
  if (deviceQty > 0) payLabelParts.push(`${deviceQty} ${addonKindLabel(kinds.device, deviceQty)}`);
  if (userQty > 0) payLabelParts.push(`${userQty} ${addonKindLabel(kinds.user, userQty)}`);
  if (companyQty > 0) payLabelParts.push(`${companyQty} ${addonKindLabel(kinds.company, companyQty)}`);
  const paySuffix = payLabelParts.length > 0 ? payLabelParts.join(" + ") : "set quantity";

  return (
    <Card id="billing-addons" className="border-sky-300/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Add-on service</CardTitle>
        <CardDescription>
          Extra online/local devices, users, and company slots for the rest of your current plan period. Renewing the
          plan requires buying add-ons again for the new period. Set quantities in one checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-snug">
          Owned extras: online devices{" "}
          <span className="font-medium text-foreground">{owned.extraDevicesOnline}</span>, local devices{" "}
          <span className="font-medium text-foreground">{owned.extraDevicesLocal}</span>, online users{" "}
          <span className="font-medium text-foreground">{owned.extraUsersOnline}</span>, local users{" "}
          <span className="font-medium text-foreground">{owned.extraUsersLocal}</span>, online company slots{" "}
          <span className="font-medium text-foreground">{owned.extraCompaniesOnline}</span>, local company slots{" "}
          <span className="font-medium text-foreground">{owned.extraCompaniesLocal}</span>
          {owned.expiryMs != null ? (
            <>
              {" "}
              (until {new Date(owned.expiryMs).toLocaleDateString()})
            </>
          ) : null}
        </p>

        <Tabs
          value={scope}
          onValueChange={(v) => setScope(v === "local" ? "local" : "online")}
        >
          <TabsList className="w-fit">
            {onlineTabVisible ? (
              <TabsTrigger value="online" className="px-4">
                Online
              </TabsTrigger>
            ) : null}
            {localTabVisible ? (
              <TabsTrigger value="local" className="px-4">
                Local / Offline
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
        {!onlineAddOnsAllowed && isAddonScopeVisibleOnBilling(offer, "online") ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
            Online add-ons are available only when your current plan includes at least one online company. Upgrade your
            plan to enable them.
          </p>
        ) : null}

        <div className="w-fit max-w-full overflow-x-auto rounded-md border">
          <table className="w-auto text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium text-right">Unit</th>
                <th className="px-3 py-2 font-medium text-right" title="Already purchased add-on slots for this plan period">
                  Added
                </th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {scope === "local" ? "Local device" : "Online device"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {deviceUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                  {ownedDevices}
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    className="h-8 w-16"
                    value={deviceQty}
                    onChange={(e) => setDeviceQty(clampQty(e.target.value))}
                    aria-label={`${scope} device quantity`}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {deviceLine}</td>
              </tr>
              <tr className="border-b">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {scope === "local" ? "Local user" : "Online user"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {userUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                  {ownedUsers}
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    className="h-8 w-16"
                    value={userQty}
                    onChange={(e) => setUserQty(clampQty(e.target.value))}
                    aria-label={`${scope} user quantity`}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {userLine}</td>
              </tr>
              <tr className="border-b">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {scope === "local" ? "Local company slot" : "Online company slot"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {companyUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                  {ownedCompanySlots}
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    className="h-8 w-16"
                    value={companyQty}
                    onChange={(e) => setCompanyQty(clampQty(e.target.value))}
                    aria-label={`${scope} company slot quantity`}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {companyLine}</td>
              </tr>
              <tr className="bg-muted/20">
                <td className="px-3 py-2 font-semibold" colSpan={4}>
                  Total
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">Rs. {total}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Payment method</p>
          <RadioGroup
            value={gateway}
            onValueChange={(val) => setGateway(val as PayGateway)}
            className="flex flex-wrap items-center gap-3"
          >
            <Label
              htmlFor="addon-stripe"
              className={cn(
                "flex items-center gap-2 border rounded-lg px-3 py-2 text-sm",
                stripeOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                gateway === "stripe" && stripeOk && "border-primary"
              )}
            >
              <RadioGroupItem value="stripe" id="addon-stripe" disabled={!stripeOk} />
              Stripe (Cards)
            </Label>
            <Label
              htmlFor="addon-khalti"
              className={cn(
                "flex items-center gap-2 border rounded-lg px-3 py-2 text-sm",
                khaltiOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                gateway === "khalti" && khaltiOk && "border-primary"
              )}
            >
              <RadioGroupItem value="khalti" id="addon-khalti" disabled={!khaltiOk} />
              Khalti
            </Label>
            <Label
              htmlFor="addon-esewa"
              className={cn(
                "flex items-center gap-2 border rounded-lg px-3 py-2 text-sm",
                esewaOk ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                gateway === "esewa" && esewaOk && "border-primary"
              )}
            >
              <RadioGroupItem value="esewa" id="addon-esewa" disabled={!esewaOk} />
              eSewa
            </Label>
          </RadioGroup>
        </div>

        <Button
          type="button"
          className="w-fit"
          disabled={busy || total <= 0 || gatewayBlocked || !networkOnline}
          onClick={() => void buy()}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {total <= 0
            ? `Pay Rs. 0 with ${gatewayPayLabel(gateway)} — set quantity`
            : `Pay Rs. ${total} with ${gatewayPayLabel(gateway)} — ${paySuffix}`}
        </Button>
      </CardContent>
    </Card>
  );
}
