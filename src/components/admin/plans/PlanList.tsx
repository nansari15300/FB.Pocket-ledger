"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ONLINE_DEMO_PLAN_IDS,
  formatPrice,
  type OnlineDemoOffer,
  type OnlineDemoPlanId,
  type Plan,
  type PlanId,
} from "@/config/plans";
import {
  DEFAULT_DEVICE_USER_ADDON_OFFER,
  type DeviceUserAddOnOffer,
} from "@/lib/planAddOns";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

/** Soft chrome tones — Subscription Plans header jaisa, har tier alag. */
const PLAN_LIST_CARD_TONE: Record<PlanId, string> = {
  basic: "pl-chrome-card pl-chrome-tone-sky border-slate-300/80",
  advance: "pl-chrome-card pl-chrome-tone-blue border-blue-300/80",
  pro: "pl-chrome-card pl-chrome-tone-amber border-amber-300/80",
  "pro-plus": "pl-chrome-card pl-chrome-tone-violet border-violet-300/80",
};

interface PlanListProps {
  plans: Plan[];
  selectedPlan: Plan | null;
  onSelectPlan: (plan: Plan) => void;
  onlineDemo: OnlineDemoOffer;
  onSaveOnlineDemo: (
    offer: OnlineDemoOffer,
    options?: { existingDemoAction?: "retain" | "reset" | "replace" }
  ) => Promise<boolean>;
  deviceUserAddOns?: DeviceUserAddOnOffer;
  onSaveDeviceUserAddOns?: (offer: DeviceUserAddOnOffer) => Promise<boolean>;
  onTogglePlanBillingVisibility?: (plan: Plan, showOnBilling: boolean) => Promise<void>;
}

export function PlanList({
  plans,
  selectedPlan,
  onSelectPlan,
  onlineDemo,
  onSaveOnlineDemo,
  deviceUserAddOns = DEFAULT_DEVICE_USER_ADDON_OFFER,
  onSaveDeviceUserAddOns,
  onTogglePlanBillingVisibility,
}: PlanListProps) {
  const [visibilityBusyId, setVisibilityBusyId] = useState<PlanId | null>(null);
  const [draft, setDraft] = useState<OnlineDemoOffer>(onlineDemo);
  const [addonDraft, setAddonDraft] = useState<DeviceUserAddOnOffer>(deviceUserAddOns);
  const [existingDemoAction, setExistingDemoAction] = useState<"retain" | "reset" | "replace">(
    "retain"
  );
  const [saving, setSaving] = useState(false);
  const [addonSaving, setAddonSaving] = useState(false);

  useEffect(() => {
    setDraft(onlineDemo);
  }, [onlineDemo]);

  useEffect(() => {
    setAddonDraft(deviceUserAddOns);
  }, [deviceUserAddOns]);

  const persistAddonDraft = (next: DeviceUserAddOnOffer) => {
    setAddonDraft(next);
    if (!onSaveDeviceUserAddOns) return;
    setAddonSaving(true);
    void onSaveDeviceUserAddOns(next).finally(() => setAddonSaving(false));
  };

  if (plans.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-8">No plans found.</div>
    );
  }

  const isTurningOff = onlineDemo.enabled === true && draft.enabled !== true;

  const handleSaveDemo = async () => {
    setSaving(true);
    try {
      await onSaveOnlineDemo(
        draft,
        isTurningOff ? { existingDemoAction } : undefined
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollArea className="h-full border rounded-lg" listChrome>
      <div className="pl-master-list-ul">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            data-pl-admin-plan-card={plan.id}
            data-pl-list-selected={selectedPlan?.id === plan.id ? "" : undefined}
            className={cn(
              "p-3 cursor-pointer",
              PLAN_LIST_CARD_TONE[plan.id] ?? "pl-chrome-card pl-chrome-tone-sky",
              selectedPlan?.id === plan.id && "border-primary ring-2 ring-primary/30"
            )}
            onClick={() => onSelectPlan(plan)}
          >
            <div className="flex justify-between items-center gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{plan.name}</p>
                <p className="text-xs text-muted-foreground">{plan.tagline}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {plan.highlight ? <Badge>Popular</Badge> : null}
                {plan.hiddenFromBilling ? (
                  <Badge variant="outline" className="text-[10px]">
                    Hidden
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex gap-4 mt-2 pt-2 border-t">
              <p className="text-sm font-medium">{formatPrice(plan, "monthly")}</p>
              <p className="text-sm font-medium">{formatPrice(plan, "yearly")}</p>
            </div>
            <div
              className="flex items-center gap-2 mt-2 pt-2 border-t"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                id={`plan-show-billing-${plan.id}`}
                checked={plan.hiddenFromBilling !== true}
                disabled={visibilityBusyId === plan.id || !onTogglePlanBillingVisibility}
                onCheckedChange={(checked) => {
                  if (!onTogglePlanBillingVisibility) return;
                  setVisibilityBusyId(plan.id);
                  void onTogglePlanBillingVisibility(plan, checked === true).finally(() =>
                    setVisibilityBusyId(null)
                  );
                }}
              />
              <Label
                htmlFor={`plan-show-billing-${plan.id}`}
                className="text-xs font-normal leading-snug cursor-pointer"
              >
                Show on billing page
              </Label>
            </div>
          </Card>
        ))}

        <Card
          data-pl-admin-plan-card="online-demo"
          className="p-3 border-dashed border-emerald-400/70 pl-chrome-card pl-chrome-tone-emerald space-y-3"
        >
          <div>
            <p className="font-semibold">Online Demo Offer</p>
            <p className="text-xs text-muted-foreground">
              Billing button uses the selected paid plan only.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="online-demo-list-switch" className="text-sm">
              Enabled
            </Label>
            <Switch
              id="online-demo-list-switch"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="online-demo-plan">Demo plan</Label>
            <select
              id="online-demo-plan"
              value={draft.planId}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  planId: e.target.value as OnlineDemoPlanId,
                }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ONLINE_DEMO_PLAN_IDS.map((id) => {
                const label =
                  id === "pro-plus" ? "Pro Plus" : id === "advance" ? "Advance" : "Pro";
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="online-demo-days-list">Demo days (1–999)</Label>
            <Input
              id="online-demo-days-list"
              type="number"
              min={1}
              max={999}
              value={draft.days}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  days: Math.min(999, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                }))
              }
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-border/60 bg-background/60 p-2">
            <Checkbox
              id="online-demo-allow-extend"
              checked={draft.allowExtendAfterExpiry === true}
              onCheckedChange={(checked) =>
                setDraft((prev) => ({
                  ...prev,
                  allowExtendAfterExpiry: checked === true,
                }))
              }
              className="mt-0.5"
            />
            <Label htmlFor="online-demo-allow-extend" className="text-sm font-normal leading-snug cursor-pointer">
              After demo expires, user may click Demo again to get another full period
            </Label>
          </div>

          {isTurningOff ? (
            <div className="space-y-1.5 rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/25">
              <Label htmlFor="existing-demo-action-list">Existing activated users</Label>
              <select
                id="existing-demo-action-list"
                value={existingDemoAction}
                onChange={(e) =>
                  setExistingDemoAction(e.target.value as "retain" | "reset" | "replace")
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="retain">Keep remaining days; stop new activations</option>
                <option value="reset">End demo now → Basic</option>
                <option value="replace">Apply new full day count above</option>
              </select>
            </div>
          ) : null}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={saving}
            onClick={() => void handleSaveDemo()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Demo Offer
          </Button>
        </Card>

        <Card
          data-pl-admin-plan-card="device-user-addons"
          className="p-3 border-dashed border-sky-400/70 pl-chrome-card pl-chrome-tone-sky space-y-3"
        >
          <div>
            <p className="font-semibold">Add-on service</p>
            <p className="text-xs text-muted-foreground">
              Separate online / local prices. Valid until plan expiry; renew re-charges.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="addon-service-enabled" className="text-sm">
              Enabled (master)
            </Label>
            <Switch
              id="addon-service-enabled"
              checked={addonDraft.enabled}
              disabled={addonSaving}
              onCheckedChange={(enabled) => persistAddonDraft({ ...addonDraft, enabled })}
            />
          </div>

          <div className="rounded-md border border-sky-300/70 bg-background/70 p-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Online add-ons</p>
                <p className="text-[11px] text-muted-foreground">Device · user · company (online)</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="addon-online-billing-visible" className="text-xs font-normal">
                  Show on billing
                </Label>
                <Switch
                  id="addon-online-billing-visible"
                  checked={addonDraft.billingOnlineVisible !== false}
                  disabled={addonSaving}
                  onCheckedChange={(visible) =>
                    persistAddonDraft({ ...addonDraft, billingOnlineVisible: visible })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-device-online">Online device (NPR)</Label>
              <Input
                id="addon-price-device-online"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerDeviceOnlineNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerDeviceOnlineNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-user-online">Online user (NPR)</Label>
              <Input
                id="addon-price-user-online"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerUserOnlineNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerUserOnlineNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-company-online">Online company slot (NPR)</Label>
              <Input
                id="addon-price-company-online"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerCompanyOnlineNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerCompanyOnlineNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
          </div>

          <div className="rounded-md border border-emerald-300/70 bg-background/70 p-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Offline / Local add-ons</p>
                <p className="text-[11px] text-muted-foreground">Device · user · company (local)</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="addon-local-billing-visible" className="text-xs font-normal">
                  Show on billing
                </Label>
                <Switch
                  id="addon-local-billing-visible"
                  checked={addonDraft.billingLocalVisible !== false}
                  disabled={addonSaving}
                  onCheckedChange={(visible) =>
                    persistAddonDraft({ ...addonDraft, billingLocalVisible: visible })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-device-local">Local device (NPR)</Label>
              <Input
                id="addon-price-device-local"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerDeviceLocalNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerDeviceLocalNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-user-local">Local user (NPR)</Label>
              <Input
                id="addon-price-user-local"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerUserLocalNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerUserLocalNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-price-company-local">Local company slot (NPR)</Label>
              <Input
                id="addon-price-company-local"
                type="number"
                min={0}
                step={1}
                value={addonDraft.pricePerCompanyLocalNpr}
                onChange={(e) =>
                  setAddonDraft((prev) => ({
                    ...prev,
                    pricePerCompanyLocalNpr: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug">
            &quot;Show on billing&quot; and master switch save immediately. Price changes still need{" "}
            <strong>Save Add-on Service</strong>. Turning off a section hides that tab on Billing only — purchased
            add-ons stay valid.
          </p>

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={addonSaving || !onSaveDeviceUserAddOns}
            onClick={() => {
              if (!onSaveDeviceUserAddOns) return;
              setAddonSaving(true);
              void onSaveDeviceUserAddOns(addonDraft).finally(() => setAddonSaving(false));
            }}
          >
            {addonSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Add-on Service
          </Button>
        </Card>
      </div>
    </ScrollArea>
  );
}
